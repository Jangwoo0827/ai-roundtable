import './styles/main.css';
import { h, copyText, download, DEBATE_LABEL, fmtTime } from './components/dom.js';
import { participantCard } from './components/participant-card.js';
import { debatePanel } from './components/debate-panel.js';
import { roundControls } from './components/round-controls.js';
import { DebateEngine } from './debate/engine.js';
import { PARTICIPANTS, PARTICIPANT_IDS } from './debate/participants.js';
import { MIN_ROUNDS, MAX_ROUNDS } from './debate/scheduler.js';
import { toMarkdown } from './debate/transcript.js';
import { localStore } from './storage/local-store.js';
import { manualProvider } from './providers/manual-provider.js';
import { BridgeProvider } from './providers/bridge-provider.js';
import { assertProvider } from './providers/provider-interface.js';

const settings = localStore.settings();
const bridge = new BridgeProvider({ port: settings.port });
const engine = new DebateEngine({ provider: manualProvider, store: localStore, timeoutMs: settings.timeoutSec * 1000 });
let conn = bridge.status;
const ui = { drafts: { text: new Map(), open: new Set() }, collapsed: new Set(), topic: '', dialog: null, notice: '' };

function providerFor(mode) {
  return assertProvider(mode === 'manual' ? manualProvider : bridge);
}

function applyMode(mode) {
  settings.mode = mode;
  localStore.saveSettings(settings);
  engine.setProvider(providerFor(mode));
  if (mode === 'bridge') bridge.connect();
  if (engine.debate && !['completed', 'cancelled', 'failed'].includes(engine.debate.status)) engine.setMode(mode);
  render();
}

// ---------- 렌더링 ----------
const app = document.getElementById('app');
let queued = false;
function render() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    const active = document.activeElement;
    const focusKey = active?.dataset?.key;
    const sel = focusKey ? [active.selectionStart, active.selectionEnd] : null;
    const scroll = window.scrollY;
    app.replaceChildren(view());
    if (focusKey) {
      const el = app.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
      if (el) {
        el.focus();
        if (sel && el.setSelectionRange) el.setSelectionRange(...sel);
      }
    }
    window.scrollTo(0, scroll);
  });
}

function connSummary() {
  if (settings.mode === 'manual') return { text: '수동 모드 · 자동 연결 없음', tone: 'muted' };
  if (conn.bridge === 'connecting') return { text: '브리지 연결 중…', tone: 'warn' };
  if (conn.bridge !== 'connected') return { text: `브리지 꺼짐${conn.error ? ` — ${conn.error}` : ''}`, tone: 'bad' };
  if (!conn.extension) return { text: '브리지 연결됨 · 확장 프로그램 미연결', tone: 'warn' };
  return { text: '브리지 + 확장 프로그램 연결됨', tone: 'good' };
}

function view() {
  const d = engine.debate;
  const c = connSummary();
  return h('div', { class: 'shell' },
    h('header', { class: 'topbar' },
      h('div', { class: 'logo' }, h('span', { class: 'logo-mark', 'aria-hidden': 'true' }, '◉'), h('span', {}, 'AI Roundtable')),
      h('span', { class: `pill ${c.tone}`, role: 'status', title: c.text }, c.text),
      h('div', { class: 'top-actions' },
        h('button', { class: 'btn ghost', onclick: () => openDialog('history') }, '기록'),
        h('button', { class: 'btn ghost', onclick: newDebate }, '＋ 새 토론'),
        h('button', { class: 'btn ghost', onclick: () => openDialog('settings'), 'aria-label': '설정' }, '⚙ 설정'),
      ),
    ),
    h('main', {},
      !d || d.status === 'idle' ? setupForm(d) : debateHeader(d),
      ui.notice ? h('p', { class: 'notice', role: 'alert' }, ui.notice, h('button', { class: 'btn sm ghost', onclick: () => { ui.notice = ''; render(); } }, '닫기')) : null,
      h('section', { class: 'pgrid', 'aria-label': '참가자' },
        PARTICIPANT_IDS.map((id) => participantCard({ id, debate: d, conn, mode: d?.mode ?? settings.mode, onRetry: (uid) => engine.retry(uid), onExclude: (pid) => confirm(`${PARTICIPANTS[pid].name}을(를) 남은 토론에서 제외할까요?`) && engine.exclude(pid) })),
      ),
      d ? debatePanel({ debate: d, drafts: ui.drafts, collapsed: ui.collapsed, onSubmit: (uid, t) => engine.submitManual(uid, t), onRetry: (uid) => engine.retry(uid) }) : null,
      d?.log.length ? logView(d) : null,
    ),
    roundControls({
      debate: d,
      on: {
        pause: () => engine.pause(),
        resume: () => engine.resume(),
        retryFailed: () => engine.retryFailed(),
        cancel: () => confirm('토론을 종료할까요? 진행 중인 응답 수집이 취소됩니다.') && engine.cancel(),
        showFinal: () => openDialog('final'),
        exportMd: () => download(`roundtable-${d.id}.md`, toMarkdown(d), 'text/markdown'),
        exportJson: () => download(`roundtable-${d.id}.json`, JSON.stringify(d, null, 2), 'application/json'),
      },
    }),
    ui.dialog ? dialogView(ui.dialog) : null,
  );
}

function setupForm(d) {
  const s = settings;
  const startable = () => s.participants.length >= 2;
  return h('section', { class: 'setup', 'aria-label': '토론 설정' },
    h('label', { for: 'topic', class: 'lbl' }, '토론 주제'),
    h('textarea', { id: 'topic', 'data-key': 'topic', rows: 3, placeholder: '예: 생성형 AI가 대학 과제 평가 방식을 바꿔야 하는가?', value: ui.topic || d?.topic || '', oninput: (e) => (ui.topic = e.target.value) }),
    h('div', { class: 'setup-row' },
      h('fieldset', { class: 'chips' },
        h('legend', {}, '참가자'),
        PARTICIPANT_IDS.map((id) => h('label', { class: 'chip', style: `--ai:${PARTICIPANTS[id].color}` },
          h('input', { type: 'checkbox', checked: s.participants.includes(id), onchange: (e) => {
            s.participants = e.target.checked ? [...new Set([...s.participants, id])] : s.participants.filter((x) => x !== id);
            if (!s.participants.includes(s.moderator)) s.moderator = s.participants[0] || 'claude';
            localStore.saveSettings(s);
            render();
          } }),
          h('span', { 'aria-hidden': 'true' }, PARTICIPANTS[id].glyph), PARTICIPANTS[id].name)),
      ),
      h('label', { class: 'field' }, '토론 라운드',
        h('select', { onchange: (e) => { s.totalRounds = Number(e.target.value); localStore.saveSettings(s); } },
          Array.from({ length: MAX_ROUNDS - MIN_ROUNDS + 1 }, (_, i) => MIN_ROUNDS + i).map((n) => h('option', { value: String(n), selected: n === s.totalRounds }, `${n}라운드 + 종합`)))),
      h('label', { class: 'field' }, '최종 사회자',
        h('select', { onchange: (e) => { s.moderator = e.target.value; localStore.saveSettings(s); } },
          s.participants.map((id) => h('option', { value: id, selected: id === s.moderator }, PARTICIPANTS[id].name)))),
      h('label', { class: 'field' }, '진행 방식',
        h('select', { onchange: (e) => applyMode(e.target.value) },
          h('option', { value: 'manual', selected: s.mode === 'manual' }, '수동 (복사·붙여넣기)'),
          h('option', { value: 'bridge', selected: s.mode === 'bridge' }, '자동 (확장 프로그램)'))),
    ),
    d?.lastError ? h('p', { class: 'err-line', role: 'alert' }, `✕ ${d.lastError}`) : null,
    h('div', { class: 'setup-row' },
      h('button', { class: 'btn primary lg', disabled: !startable(), onclick: startDebate }, '토론 시작'),
      h('span', { class: 'muted' }, s.mode === 'manual' ? '각 AI 사이트에 프롬프트를 붙여넣고 답변을 다시 붙여넣는 방식입니다.' : '로그인된 공식 웹 채팅 탭에 확장 프로그램이 직접 입력합니다.'),
    ),
  );
}

function debateHeader(d) {
  return h('section', { class: 'dhead' },
    h('div', {},
      h('span', { class: `pill st-d-${d.status}` }, DEBATE_LABEL[d.status]),
      h('span', { class: 'muted' }, ` ${d.mode === 'manual' ? '수동' : '자동'} · ${d.totalRounds}라운드 + 종합 · 사회자 ${PARTICIPANTS[d.moderator].name} · ${new Date(d.createdAt).toLocaleString()}`),
    ),
    h('h1', {}, d.topic),
    d.lastError ? h('p', { class: 'err-line', role: 'alert' }, `✕ ${d.lastError}`) : null,
    !['completed', 'cancelled', 'failed'].includes(d.status)
      ? h('div', { class: 'setup-row' },
          h('label', { class: 'field inline' }, '진행 방식 전환',
            h('select', { onchange: (e) => applyMode(e.target.value) },
              h('option', { value: 'manual', selected: d.mode === 'manual' }, '수동'),
              h('option', { value: 'bridge', selected: d.mode === 'bridge' }, '자동'))))
      : null,
  );
}

function logView(d) {
  return h('details', { class: 'log' },
    h('summary', {}, `진행 로그 (${d.log.length})`),
    h('ul', {}, d.log.slice(-60).reverse().map((l) => h('li', { class: `lv-${l.level}` }, h('time', {}, fmtTime(l.at)), ' ', l.msg))),
  );
}

// ---------- 동작 ----------
async function startDebate() {
  const topic = (ui.topic || engine.debate?.topic || '').trim();
  try {
    if (!engine.debate || engine.debate.status !== 'idle' || engine.debate.topic !== topic) {
      engine.create({ topic, participants: settings.participants, moderator: settings.moderator, totalRounds: settings.totalRounds, mode: settings.mode });
    } else engine.debate.mode = settings.mode;
    engine.setProvider(providerFor(settings.mode));
    engine.timeoutMs = settings.timeoutSec * 1000;
    ui.topic = '';
    ui.notice = '';
    await engine.start();
  } catch (e) {
    ui.notice = e.message;
    render();
  }
}

function newDebate() {
  const d = engine.debate;
  if (d && ['running', 'waiting', 'connecting'].includes(d.status) && !confirm('진행 중인 토론을 종료하고 새 토론을 만들까요? (기록은 남습니다)')) return;
  if (d && !['completed', 'cancelled', 'failed', 'idle'].includes(d.status)) engine.cancel();
  engine.cancelInflight();
  engine.debate = null;
  localStore.clearCurrent();
  ui.topic = '';
  render();
}

function openDialog(kind) {
  ui.dialog = kind;
  render();
}

function closeDialog() {
  ui.dialog = null;
  render();
}

function dialogView(kind) {
  const close = h('button', { class: 'btn ghost sm', onclick: closeDialog, 'aria-label': '닫기' }, '✕');
  let body;
  if (kind === 'final') {
    const d = engine.debate;
    body = [
      h('h2', {}, '최종 결론'),
      h('div', { class: 'content final' }, d?.final || '아직 최종 종합이 없습니다.'),
      h('div', { class: 'setup-row' }, h('button', { class: 'btn', onclick: (e) => copyText(d.final, e.currentTarget) }, '복사'), h('button', { class: 'btn ghost', onclick: () => download(`roundtable-${d.id}.md`, toMarkdown(d), 'text/markdown') }, 'Markdown 내보내기')),
    ];
  } else if (kind === 'history') {
    const list = localStore.list();
    body = [
      h('h2', {}, '저장된 토론'),
      h('p', { class: 'muted' }, '기록은 이 브라우저(localStorage)에만 저장됩니다.'),
      h('label', { class: 'btn sm ghost file' }, 'JSON 가져오기', h('input', { type: 'file', accept: 'application/json,.json', onchange: async (e) => {
        try {
          const d = localStore.importJSON(await e.target.files[0].text());
          engine.load(d);
          closeDialog();
        } catch (err) {
          alert(err.message);
        }
      } })),
      list.length ? h('ul', { class: 'hist' }, list.map((x) => h('li', {},
        h('div', {}, h('strong', {}, x.topic), h('div', { class: 'muted' }, `${new Date(x.createdAt).toLocaleString()} · ${DEBATE_LABEL[x.status] || x.status}`)),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', onclick: () => { const d = localStore.load(x.id); if (d) { engine.load(d); settings.mode = d.mode; engine.setProvider(providerFor(d.mode)); if (d.mode === 'bridge') bridge.connect(); } closeDialog(); } }, '불러오기'),
          h('button', { class: 'btn sm ghost', onclick: () => { if (confirm('이 기록을 삭제할까요?')) { localStore.remove(x.id); if (engine.debate?.id === x.id) engine.debate = null; render(); } } }, '삭제'),
        )))) : h('p', {}, '저장된 토론이 없습니다.'),
    ];
  } else {
    body = [
      h('h2', {}, '설정'),
      h('label', { class: 'field' }, '응답 제한 시간(초)', h('input', { type: 'number', min: 30, max: 900, value: String(settings.timeoutSec), onchange: (e) => { settings.timeoutSec = Math.min(900, Math.max(30, Number(e.target.value) || 240)); engine.timeoutMs = settings.timeoutSec * 1000; localStore.saveSettings(settings); } })),
      h('label', { class: 'field' }, '브리지 포트', h('input', { type: 'number', value: String(settings.port), onchange: (e) => { settings.port = Number(e.target.value) || 8787; bridge.port = settings.port; localStore.saveSettings(settings); bridge.disconnect(); if (settings.mode === 'bridge') bridge.connect(); } })),
      h('div', { class: 'setup-row' },
        h('button', { class: 'btn', onclick: () => { bridge.connect(); bridge.refreshSites(); } }, '연결 다시 확인'),
      ),
      h('h3', {}, '연결 상태'),
      h('ul', { class: 'hist' },
        h('li', {}, `브리지: ${conn.bridge}${conn.error ? ` (${conn.error})` : ''}`),
        h('li', {}, `확장 프로그램: ${conn.extension ? '연결됨' : '미연결'}`),
        PARTICIPANT_IDS.map((id) => h('li', {}, `${PARTICIPANTS[id].name}: ${conn.sites?.[id]?.state ?? '-'} ${conn.sites?.[id]?.detail ?? ''}`)),
      ),
      h('p', { class: 'muted' }, 'API 키를 사용하지 않습니다. 자동 모드는 로컬 브리지(npm run bridge)와 Chrome 확장 프로그램이 필요하며, 각 사이트에는 직접 로그인해야 합니다.'),
    ];
  }
  return h('div', { class: 'backdrop', onclick: (e) => e.target === e.currentTarget && closeDialog() },
    h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'dialog-close' }, close), body));
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.dialog) closeDialog();
});

// ---------- 시작 ----------
engine.on(render);
bridge.onStatus((s) => {
  conn = { ...s };
  render();
});
const saved = localStore.current();
if (saved) {
  engine.load(saved);
  settings.mode = saved.mode;
}
engine.setProvider(providerFor(settings.mode));
if (settings.mode === 'bridge') bridge.connect();
render();
