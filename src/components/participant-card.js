import { h, STATUS_LABEL } from './dom.js';
import { PARTICIPANTS } from '../debate/participants.js';
import { roundTitle } from '../debate/transcript.js';

const SITE_LABEL = { ready: '준비됨', login_required: '로그인 필요', not_ready: '준비 안 됨', busy: '생성 중', blocked: '사람 확인 필요', no_tab: '탭 없음(자동으로 열림)', error: '오류' };

export function connectionLabel(id, mode, conn) {
  if (mode === 'manual') return { text: '수동 모드', tone: 'muted' };
  if (conn.bridge !== 'connected') return { text: '브리지 꺼짐', tone: 'bad' };
  if (!conn.extension) return { text: '확장 미연결', tone: 'bad' };
  const s = conn.sites?.[id];
  if (!s) return { text: '확인 중', tone: 'muted' };
  return { text: SITE_LABEL[s.state] || s.state, tone: s.state === 'ready' || s.state === 'no_tab' ? 'good' : s.state === 'busy' ? 'warn' : 'bad', detail: s.detail };
}

export function participantCard({ id, debate, conn, mode, onRetry, onExclude }) {
  const p = PARTICIPANTS[id];
  const excluded = debate?.excluded.includes(id);
  const inDebate = debate?.participants.includes(id);
  let latest = null;
  let stage = null;
  for (const r of debate?.rounds ?? []) {
    const u = r.utterances.find((x) => x.participantId === id && x.status !== 'excluded');
    if (u) {
      latest = u;
      stage = r;
    }
  }
  const c = connectionLabel(id, mode, conn);
  const status = excluded ? '제외됨' : latest ? STATUS_LABEL[latest.status] : !debate || inDebate ? '대기' : '불참';
  const preview = latest?.status === 'done' ? latest.content : latest?.preview || latest?.error || '';
  return h('article', { class: `pcard${excluded || (debate && !inDebate) ? ' off' : ''}`, style: `--ai:${p.color}`, 'aria-label': `${p.name} 참가자` },
    h('header', {},
      h('span', { class: 'glyph', 'aria-hidden': 'true' }, p.glyph),
      h('strong', {}, p.name),
      h('span', { class: `pill ${c.tone}`, title: c.detail || '' }, c.text),
    ),
    h('div', { class: 'pmeta' },
      h('span', {}, stage ? roundTitle(stage) : '시작 전'),
      h('span', { class: `st st-${latest?.status || 'none'}` }, status),
    ),
    h('p', { class: 'ppreview' }, preview ? preview.slice(0, 280) : '아직 발언이 없습니다.'),
    h('div', { class: 'pactions' },
      latest?.status === 'failed' && !excluded ? h('button', { class: 'btn sm', onclick: () => onRetry(latest.id) }, '재시도') : null,
      debate && inDebate && !excluded && !['completed', 'cancelled', 'failed'].includes(debate.status) && debate.rounds.length
        ? h('button', { class: 'btn sm ghost', onclick: () => onExclude(id) }, '제외')
        : null,
    ),
  );
}
