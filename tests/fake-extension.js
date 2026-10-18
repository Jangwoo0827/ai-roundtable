// 개발용 가짜 확장 프로그램: 브리지에 extension 역할로 접속해 더미 응답을 돌려준다.
// 실제 AI 연결 검증이 아니라 웹사이트 ↔ 브리지 ↔ 확장 프로토콜 검증용이다.
//   node tests/fake-extension.js [--fail=claude] [--delay=1500]
import fs from 'node:fs';
import WebSocket from 'ws';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const failSite = arg('fail', '');
const delay = Number(arg('delay', 1500));
const token = fs.readFileSync(new URL('../bridge/.bridge-token', import.meta.url), 'utf8').trim();
const ws = new WebSocket('ws://127.0.0.1:8787', { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' });
const sites = { gemini: { state: 'ready', detail: '가짜' }, chatgpt: { state: 'ready', detail: '가짜' }, claude: { state: 'ready', detail: '가짜' } };
let failedOnce = false;

ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', role: 'extension', token })));
ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  if (msg.type === 'welcome') console.log('fake extension connected');
  if (msg.type === 'check') ws.send(JSON.stringify({ type: 'sites', sites }));
  if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
  if (msg.type === 'task') {
    console.log('task', msg.participantId, msg.taskId, 'newChat=' + msg.newChat);
    ws.send(JSON.stringify({ type: 'progress', taskId: msg.taskId, state: 'responding', preview: '작성 중…' }));
    setTimeout(() => {
      if (msg.participantId === failSite && !failedOnce) {
        failedOnce = true;
        ws.send(JSON.stringify({ type: 'result', taskId: msg.taskId, ok: false, error: { code: 'NOT_LOGGED_IN', message: '로그인 필요(가짜)' } }));
        return;
      }
      const round = msg.prompt.match(/라운드 (\d)/)?.[1] ?? '종합';
      ws.send(JSON.stringify({ type: 'result', taskId: msg.taskId, ok: true, text: `[더미 ${msg.participantId} 응답 · ${round}] ${msg.prompt.length}자 프롬프트를 받았습니다.` }));
      // 같은 결과를 한 번 더 보내 중복 차단을 확인한다.
      ws.send(JSON.stringify({ type: 'result', taskId: msg.taskId, ok: true, text: '중복 결과 — 무시되어야 함' }));
    }, delay);
  }
});
ws.on('close', (c, r) => console.log('closed', c, String(r)));
