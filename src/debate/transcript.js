import { participantName } from './participants.js';
import { clip } from './prompts.js';

export const ROUND_LABELS = {
  independent: '독립 의견',
  critique: '상호 비평',
  revision: '재검토 및 반론',
  synthesis: '최종 종합',
};

export function roundTitle(round) {
  return round.kind === 'synthesis' ? ROUND_LABELS.synthesis : `라운드 ${round.no} · ${ROUND_LABELS[round.kind]}`;
}

// 사회자에게 넘기는 압축 기록. 각 발언을 잘라 전체 길이를 제한한다.
export function compactTranscript(debate, perUtterance = 2500) {
  return debate.rounds
    .filter((r) => r.kind !== 'synthesis')
    .map((r) => {
      const lines = r.utterances
        .filter((u) => u.status === 'done')
        .map((u) => `### ${participantName(u.participantId)}\n${clip(u.content, perUtterance)}`);
      return `## ${roundTitle(r)}\n${lines.join('\n\n')}`;
    })
    .join('\n\n');
}

export function toMarkdown(debate) {
  const out = [`# AI Roundtable: ${debate.topic}`, '', `- 토론 ID: ${debate.id}`, `- 생성: ${new Date(debate.createdAt).toLocaleString()}`, `- 참가자: ${debate.participants.map(participantName).join(', ')}`, `- 사회자: ${participantName(debate.moderator)}`, `- 상태: ${debate.status}`, ''];
  for (const r of debate.rounds) {
    out.push(`## ${roundTitle(r)}`, '');
    for (const u of r.utterances) {
      out.push(`### ${participantName(u.participantId)} (${u.status}) — ${new Date(u.createdAt).toLocaleString()}`, '');
      out.push(u.status === 'done' ? u.content : `_${u.error || u.status}_`, '');
    }
  }
  return out.join('\n');
}
