import { h } from './dom.js';

export function roundControls({ debate, on }) {
  const s = debate?.status;
  const live = ['running', 'waiting', 'connecting'].includes(s);
  const failedCount = debate?.rounds.at(-1)?.utterances.filter((u) => u.status === 'failed').length ?? 0;
  return h('footer', { class: 'controls', 'aria-label': '토론 제어' },
    h('button', { class: 'btn', disabled: !live, onclick: on.pause }, '⏸ 일시 정지'),
    h('button', { class: 'btn', disabled: s !== 'paused', onclick: on.resume }, '▶ 재개'),
    h('button', { class: 'btn', disabled: !failedCount || !['waiting', 'running', 'paused'].includes(s), onclick: on.retryFailed }, `↻ 실패 재시도${failedCount ? ` (${failedCount})` : ''}`),
    h('button', { class: 'btn danger', disabled: !debate || ['completed', 'cancelled', 'failed', 'idle'].includes(s), onclick: on.cancel }, '■ 토론 종료'),
    h('button', { class: 'btn', disabled: !debate?.final, onclick: on.showFinal }, '★ 최종 결론 보기'),
    h('button', { class: 'btn ghost', disabled: !debate, onclick: on.exportMd }, '⇩ Markdown'),
    h('button', { class: 'btn ghost', disabled: !debate, onclick: on.exportJson }, '⇩ JSON'),
  );
}
