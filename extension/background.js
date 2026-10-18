// 서비스 워커: 로컬 브리지(ws://127.0.0.1)와 연결하고, 작업을 해당 사이트 탭의 어댑터에 전달한다.
// 쿠키·토큰 등 로그인 정보는 읽거나 보내지 않는다. 열 수 있는 URL은 아래 세 공식 주소뿐이다.
const SITES = {
  gemini: { home: 'https://gemini.google.com/app', match: 'https://gemini.google.com/*', files: ['content/common.js', 'adapters/gemini.js', 'content/runner.js'] },
  chatgpt: { home: 'https://chatgpt.com/', match: 'https://chatgpt.com/*', files: ['content/common.js', 'adapters/chatgpt.js', 'content/runner.js'] },
  claude: { home: 'https://claude.ai/new', match: 'https://claude.ai/*', files: ['content/common.js', 'adapters/claude.js', 'content/runner.js'] },
};

let ws = null;
let state = 'disconnected'; // disconnected | connecting | connected | auth_failed
let lastError = '';
let backoff = 1000;
const running = new Map(); // taskId -> { site, tabId }

async function settings() {
  const s = await chrome.storage.local.get({ token: '', port: 8787, enabled: true });
  return s;
}

function setState(s, err = '') {
  state = s;
  lastError = err;
  chrome.action.setBadgeText({ text: s === 'connected' ? 'ON' : s === 'auth_failed' ? '!' : '' });
  chrome.action.setBadgeBackgroundColor({ color: s === 'connected' ? '#19c37d' : '#d9534f' });
}

function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

async function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const { token, port, enabled } = await settings();
  if (!enabled) return setState('disconnected', '꺼져 있음');
  if (!token) return setState('disconnected', '브리지 토큰을 팝업에 입력하세요.');
  setState('connecting');
  let sock;
  try {
    sock = new WebSocket(`ws://127.0.0.1:${Number(port) || 8787}`);
  } catch (e) {
    return scheduleReconnect(String(e));
  }
  ws = sock;
  sock.onopen = () => sock.send(JSON.stringify({ type: 'hello', role: 'extension', token, version: 1 }));
  sock.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === 'welcome') {
      backoff = 1000;
      setState('connected');
    } else if (msg.type === 'ping') send({ type: 'pong' });
    else if (msg.type === 'check') reportSites();
    else if (msg.type === 'task') handleTask(msg);
    else if (msg.type === 'cancel') cancelTask(msg.taskId);
  };
  sock.onclose = (ev) => {
    if (ws !== sock) return;
    ws = null;
    if (ev.code === 4003) setState('auth_failed', '토큰이 맞지 않습니다. 브리지 콘솔의 토큰을 다시 입력하세요.');
    else scheduleReconnect('브리지 서버에 연결할 수 없습니다. npm run bridge 가 실행 중인지 확인하세요.');
  };
  sock.onerror = () => {};
}

function scheduleReconnect(err) {
  if (state !== 'auth_failed') setState('disconnected', err);
  setTimeout(connect, backoff);
  backoff = Math.min(backoff * 2, 30_000);
}

async function findTab(site) {
  const tabs = await chrome.tabs.query({ url: SITES[site].match });
  return tabs.find((t) => t.active) || tabs[0] || null;
}

async function waitTabComplete(tabId, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) throw Object.assign(new Error('탭이 닫혔습니다.'), { code: 'TAB_CLOSED', retryable: true });
    if (t.status === 'complete') return t;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw Object.assign(new Error('페이지 로딩이 끝나지 않았습니다.'), { code: 'TAB_LOADING', retryable: true });
}

// 콘텐츠 스크립트가 없으면(확장 설치 전에 열린 탭 등) 주입한다.
async function ensureRunner(site, tabId) {
  const ping = () => chrome.tabs.sendMessage(tabId, { kind: 'rt-ping' }).catch(() => null);
  if (await ping()) return;
  await chrome.scripting.executeScript({ target: { tabId }, files: SITES[site].files });
  for (let i = 0; i < 10; i++) {
    if (await ping()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw Object.assign(new Error('탭에 어댑터를 불러오지 못했습니다.'), { code: 'INJECT_FAILED', retryable: true });
}

async function prepareTab(site, newChat) {
  let tab = await findTab(site);
  if (!tab) {
    tab = await chrome.tabs.create({ url: SITES[site].home, active: false });
  } else if (newChat) {
    await chrome.tabs.update(tab.id, { url: SITES[site].home });
    await new Promise((r) => setTimeout(r, 800));
  }
  await waitTabComplete(tab.id);
  await new Promise((r) => setTimeout(r, newChat ? 1500 : 300)); // SPA 초기 렌더링 대기
  await ensureRunner(site, tab.id);
  return tab.id;
}

async function reportSites(requestId) {
  const sites = {};
  for (const site of Object.keys(SITES)) {
    const tab = await findTab(site);
    if (!tab) {
      sites[site] = { state: 'no_tab', detail: '탭이 열려 있지 않음(작업 시 자동으로 엽니다)' };
      continue;
    }
    try {
      await ensureRunner(site, tab.id);
      sites[site] = await chrome.tabs.sendMessage(tab.id, { kind: 'rt-check' });
    } catch (e) {
      sites[site] = { state: 'error', detail: String(e.message || e).slice(0, 300) };
    }
  }
  send({ type: 'sites', sites, requestId });
  return sites;
}

async function handleTask(task) {
  const { taskId, participantId: site } = task;
  if (!SITES[site]) return send({ type: 'result', taskId, ok: false, error: { code: 'UNSUPPORTED_SITE', message: site } });
  try {
    const tabId = await prepareTab(site, task.newChat);
    running.set(taskId, { site, tabId });
    const res = await chrome.tabs.sendMessage(tabId, { kind: 'rt-run', taskId, prompt: task.prompt, timeoutMs: task.timeoutMs });
    send({ type: 'result', taskId, ...(res || { ok: false, error: { code: 'NO_REPLY', message: '탭에서 응답이 없습니다.', retryable: true } }) });
  } catch (e) {
    send({ type: 'result', taskId, ok: false, error: { code: e.code || 'TAB_ERROR', message: String(e.message || e), retryable: e.retryable ?? true } });
  } finally {
    running.delete(taskId);
    reportSites();
  }
}

async function cancelTask(taskId) {
  const r = running.get(taskId);
  if (r) await chrome.tabs.sendMessage(r.tabId, { kind: 'rt-cancel', taskId }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.kind === 'rt-progress') {
    if (running.has(msg.taskId)) send({ type: 'progress', taskId: msg.taskId, state: msg.state, preview: msg.preview || '' });
    return;
  }
  // 팝업 전용 명령(확장 내부 페이지에서만 허용)
  if (sender.id !== chrome.runtime.id || sender.tab) return;
  if (msg?.kind === 'popup-status') {
    reportSites().then((sites) => reply({ state, lastError, sites })).catch(() => reply({ state, lastError, sites: {} }));
    return true;
  }
  if (msg?.kind === 'popup-reconnect') {
    ws?.close();
    ws = null;
    backoff = 1000;
    connect().then(() => reply({ ok: true }));
    return true;
  }
  if (msg?.kind === 'popup-open') {
    if (SITES[msg.site]) chrome.tabs.create({ url: SITES[msg.site].home });
    reply({ ok: true });
  }
});

chrome.alarms.create('rt-keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'rt-keepalive') connect();
});
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.storage.onChanged.addListener(() => {
  ws?.close();
  ws = null;
  connect();
});
connect();
