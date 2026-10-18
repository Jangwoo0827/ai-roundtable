// AI Roundtable 로컬 브리지: 웹사이트 ↔ 확장 프로그램 메시지 중계.
// 127.0.0.1에만 바인딩하고, Origin + 연결 토큰을 검사한다. API 키나 쿠키는 다루지 않는다.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { parse, validateFromWeb, validateFromExtension, MAX_MESSAGE_BYTES, PROTOCOL_VERSION } from './protocol.js';
import { TaskQueue } from './queue.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.BRIDGE_PORT || 8787);
const WEB_ORIGINS = new Set(
  (process.env.ALLOWED_WEB_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173,https://jangwoo0827.github.io')
    .split(',').map((s) => s.trim()).filter(Boolean),
);
// 비워 두면 모든 chrome-extension:// 출처를 허용(토큰은 여전히 필요). 설치 후 ID를 넣어 고정하는 것을 권장.
const EXTENSION_IDS = new Set((process.env.ALLOWED_EXTENSION_IDS || '').split(',').map((s) => s.trim()).filter(Boolean));

const here = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(here, '.bridge-token');

function loadToken() {
  if (!process.argv.includes('--rotate')) {
    try {
      const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
      if (/^[a-f0-9]{32}$/.test(t)) return t;
    } catch {}
  }
  const t = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(TOKEN_FILE, t, { mode: 0o600 });
  return t;
}
const TOKEN = loadToken();

function originKind(origin) {
  if (!origin) return null;
  if (WEB_ORIGINS.has(origin)) return 'web';
  const m = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
  if (m && (EXTENSION_IDS.size === 0 || EXTENSION_IDS.has(m[1]))) return 'extension';
  return null;
}

const safeEq = (a, b) => typeof a === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

let extension = null;
const webClients = new Set();
let siteStatus = {};

const queue = new TaskQueue({
  send: (msg) => {
    if (!extension || extension.readyState !== 1) return false;
    extension.send(JSON.stringify(msg));
    return true;
  },
  report: (task, msg) => {
    if (task.owner?.readyState === 1) task.owner.send(JSON.stringify(msg));
    if (msg.type === 'result') log(`[${task.participantId}] ${task.taskId} → ${msg.ok ? `완료 ${msg.text?.length}자` : `실패 ${msg.error?.code}`}`);
  },
});

function broadcastStatus() {
  const msg = JSON.stringify({ type: 'status', extension: !!extension, sites: siteStatus, queue: queue.snapshot() });
  for (const c of webClients) if (c.readyState === 1) c.send(msg);
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  const kind = originKind(origin);
  // 공개 사이트(GitHub Pages) → 127.0.0.1 요청에 Chrome이 보내는 사설망 접근 사전 요청(preflight)
  if (req.method === 'OPTIONS') {
    if (kind !== 'web') {
      res.writeHead(403).end();
      return;
    }
    res.writeHead(204, { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET', 'access-control-allow-private-network': 'true', vary: 'Origin' });
    res.end();
    return;
  }
  // 허용된 웹 출처에만 토큰을 알려 준다(다른 사이트의 브라우저 요청은 Origin을 위조할 수 없다).
  if (req.method === 'GET' && req.url === '/pair') {
    if (kind !== 'web') {
      res.writeHead(403).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': origin, vary: 'Origin', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ token: TOKEN, version: PROTOCOL_VERSION }));
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', ...(kind === 'web' ? { 'access-control-allow-origin': origin } : {}) });
    res.end(JSON.stringify({ ok: true, extension: !!extension }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({
  server,
  maxPayload: MAX_MESSAGE_BYTES,
  verifyClient: ({ origin, req }, cb) => {
    const kind = originKind(origin);
    if (!kind || req.socket.remoteAddress !== '127.0.0.1') return cb(false, 403, 'origin not allowed');
    req.kind = kind;
    cb(true);
  },
});

wss.on('connection', (ws, req) => {
  const kind = req.kind;
  let authed = false;
  const authTimer = setTimeout(() => ws.close(4001, 'auth timeout'), 5000);
  let strikes = 0;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = parse(raw);
      if (!authed) {
        if (msg.type !== 'hello' || msg.role !== kind || !safeEq(msg.token, TOKEN)) {
          ws.close(4003, 'bad token');
          return;
        }
        authed = true;
        clearTimeout(authTimer);
        if (kind === 'extension') {
          if (extension && extension !== ws) extension.close(4000, 'replaced');
          extension = ws;
          queue.setExtensionReady(true);
          log('확장 프로그램 연결됨');
          ws.send(JSON.stringify({ type: 'welcome' }));
          ws.send(JSON.stringify({ type: 'check' }));
        } else {
          webClients.add(ws);
          log('웹사이트 연결됨');
          ws.send(JSON.stringify({ type: 'welcome' }));
        }
        broadcastStatus();
        return;
      }
      msg = kind === 'web' ? validateFromWeb(msg) : validateFromExtension(msg);
    } catch (e) {
      // 잘못된 메시지는 무시하고, 계속되면 연결을 끊는다.
      if (++strikes > 5 || !authed) ws.close(4002, 'bad message');
      else ws.send(JSON.stringify({ type: 'error', message: String(e.message).slice(0, 200) }));
      return;
    }

    if (msg.type === 'ping') return ws.send(JSON.stringify({ type: 'pong' }));
    if (kind === 'web') {
      if (msg.type === 'task') {
        const r = queue.submit(msg, ws);
        if (r === 'duplicate') ws.send(JSON.stringify({ type: 'error', taskId: msg.taskId, message: 'duplicate taskId' }));
        else if (!extension) ws.send(JSON.stringify({ type: 'progress', taskId: msg.taskId, state: 'queued', preview: '확장 프로그램 연결을 기다리는 중' }));
      } else if (msg.type === 'cancel') queue.cancel(msg.taskId);
      else if (msg.type === 'check') {
        if (extension) extension.send(JSON.stringify({ type: 'check' }));
        broadcastStatus();
      }
    } else {
      if (msg.type === 'sites') {
        siteStatus = msg.sites;
        broadcastStatus();
      } else if (msg.type === 'progress') queue.onProgress(msg);
      else if (msg.type === 'result') queue.onResult(msg);
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimer);
    if (ws === extension) {
      extension = null;
      siteStatus = {};
      queue.setExtensionReady(false);
      log('확장 프로그램 연결 끊김');
      broadcastStatus();
    }
    if (webClients.delete(ws)) {
      queue.dropOwner(ws);
      log('웹사이트 연결 끊김');
    }
  });
  ws.on('error', () => {});
});

// 확장 프로그램 서비스 워커가 잠들지 않도록 주기적으로 ping을 보낸다.
setInterval(() => {
  if (extension?.readyState === 1) extension.send(JSON.stringify({ type: 'ping' }));
}, 20_000).unref();

server.listen(PORT, HOST, () => {
  log(`AI Roundtable 브리지: ws://${HOST}:${PORT}`);
  log(`허용 웹 출처: ${[...WEB_ORIGINS].join(', ')}`);
  log(`확장 프로그램 연결 토큰: ${TOKEN}`);
  log('(토큰은 bridge/.bridge-token 에 저장되며 --rotate 로 새로 만들 수 있습니다)');
});
