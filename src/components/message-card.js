import { h, fmtTime, copyText, STATUS_LABEL } from './dom.js';
import { PARTICIPANTS } from '../debate/participants.js';

// 발언 카드. 수동 입력이 필요한 상태면 프롬프트 복사·사이트 열기·붙여넣기 칸을 함께 보여 준다.
export function messageCard({ u, editable, drafts, onSubmit, onRetry }) {
  const p = PARTICIPANTS[u.participantId];
  const needsInput = editable && ['awaiting', 'failed', 'queued', 'pending', 'responding'].includes(u.status);
  const showManual = editable && (u.status === 'awaiting' || u.status === 'failed');
  return h('article', { class: `msg st-${u.status}`, style: `--ai:${p.color}`, 'data-uid': u.id },
    h('header', {},
      h('span', { class: 'glyph', 'aria-hidden': 'true' }, p.glyph),
      h('strong', {}, p.name),
      h('span', { class: `st st-${u.status}` }, STATUS_LABEL[u.status] || u.status),
      u.source === 'manual' ? h('span', { class: 'tag' }, '수동 입력') : null,
      u.attempts > 1 ? h('span', { class: 'tag' }, `시도 ${u.attempts}`) : null,
      h('time', { datetime: new Date(u.updatedAt).toISOString() }, fmtTime(u.updatedAt)),
      u.status === 'done' ? h('button', { class: 'btn sm ghost', onclick: (e) => copyText(u.content, e.currentTarget), 'aria-label': `${p.name} 발언 복사` }, '복사') : null,
    ),
    u.warning ? h('p', { class: 'warn-line', role: 'note' }, `⚠ ${u.warning}`) : null,
    u.status === 'done' ? h('div', { class: 'content' }, u.content) : null,
    u.status === 'responding' && u.preview ? h('div', { class: 'content preview' }, u.preview) : null,
    u.status === 'failed' ? h('p', { class: 'err-line', role: 'alert' }, `✕ ${u.error || '오류'} ${u.errorCode ? `(${u.errorCode})` : ''}`) : null,
    needsInput
      ? h('details', { class: 'manual', open: showManual || drafts.open.has(u.id), ontoggle: (e) => (e.currentTarget.open ? drafts.open.add(u.id) : drafts.open.delete(u.id)) },
          h('summary', {}, showManual ? '수동으로 진행' : '프롬프트 보기 / 직접 붙여넣기'),
          h('div', { class: 'manual-row' },
            h('button', { class: 'btn sm', onclick: (e) => copyText(u.prompt, e.currentTarget) }, '프롬프트 복사'),
            h('a', { class: 'btn sm ghost', href: p.url, target: '_blank', rel: 'noopener noreferrer' }, `${p.name} 열기 ↗`),
            u.status === 'failed' ? h('button', { class: 'btn sm ghost', onclick: () => onRetry(u.id) }, '자동 재시도') : null,
          ),
          h('pre', { class: 'prompt' }, u.prompt),
          h('label', { class: 'sr', for: `paste-${u.id}` }, `${p.name} 답변 붙여넣기`),
          h('textarea', {
            id: `paste-${u.id}`,
            'data-key': `paste-${u.id}`,
            rows: 5,
            placeholder: `${p.name}의 답변을 여기에 붙여넣으세요`,
            value: drafts.text.get(u.id) || '',
            oninput: (e) => drafts.text.set(u.id, e.target.value),
          }),
          h('button', {
            class: 'btn sm primary',
            onclick: () => {
              const t = drafts.text.get(u.id) || '';
              if (!t.trim()) return;
              if (onSubmit(u.id, t)) drafts.text.delete(u.id);
            },
          }, '답변 등록'),
        )
      : null,
  );
}
