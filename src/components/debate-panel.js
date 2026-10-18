import { h } from './dom.js';
import { messageCard } from './message-card.js';
import { roundTitle } from '../debate/transcript.js';

// 라운드별 타임라인. 접힘 상태는 collapsed 집합에 보관해 다시 그려도 유지한다.
export function debatePanel({ debate, drafts, collapsed, onSubmit, onRetry }) {
  if (!debate.rounds.length) return h('section', { class: 'timeline empty' }, h('p', {}, '토론을 시작하면 라운드별 발언이 여기에 표시됩니다.'));
  const current = debate.rounds.at(-1);
  const finished = ['completed', 'cancelled', 'failed'].includes(debate.status);
  return h('section', { class: 'timeline', 'aria-label': '토론 타임라인' },
    debate.rounds.map((r) => {
      const key = `${debate.id}:${r.no}`;
      const done = r.utterances.filter((u) => u.status === 'done').length;
      const isOpen = collapsed.has(key) ? false : true;
      return h('details', { class: `round${r === current ? ' current' : ''}`, open: isOpen, ontoggle: (e) => (e.currentTarget.open ? collapsed.delete(key) : collapsed.add(key)) },
        h('summary', {}, h('span', {}, roundTitle(r)), h('span', { class: 'count' }, `${done}/${r.utterances.filter((u) => u.status !== 'excluded').length} 완료`)),
        h('div', { class: 'msgs' }, r.utterances.map((u) => messageCard({ u, editable: r === current && !finished, drafts, onSubmit, onRetry }))),
      );
    }),
  );
}
