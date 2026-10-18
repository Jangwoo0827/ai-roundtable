import { participantName } from './participants.js';

// 다음 라운드에 끼워 넣는 답변 하나의 최대 길이. 과도한 응답이 프롬프트를 폭주시키지 않게 한다.
export const MAX_QUOTED_CHARS = 6000;

export function clip(text, max = MAX_QUOTED_CHARS) {
  const t = String(text ?? '').trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + `\n…(이하 ${t.length - max}자 생략)`;
}

function quote(id, text) {
  return `===== [${participantName(id)}] 의 발언 시작 =====\n${clip(text)}\n===== [${participantName(id)}] 의 발언 끝 =====`;
}

const HEADER = (topic, roundNo, total) =>
  `[AI Roundtable 토론 — 라운드 ${roundNo}/${total}]\n토론 주제: ${topic}\n`;

export function independentPrompt({ topic, roundNo, totalRounds }) {
  return `${HEADER(topic, roundNo, totalRounds)}
너는 여러 AI가 참여하는 토론의 참가자다. 다른 참가자의 의견은 아직 볼 수 없다.
위 주제에 대해 너의 독립적인 의견을 제시하라.
- 핵심 주장을 먼저 밝히고, 근거를 번호로 정리하라.
- 확실하지 않은 사실은 불확실하다고 표시하라.
- 1500자 이내로 답하라.`;
}

export function critiquePrompt({ topic, roundNo, totalRounds, self, own, others }) {
  return `${HEADER(topic, roundNo, totalRounds)}
너는 이 토론에서 "${participantName(self)}" 참가자다.

[너의 이전 의견]
${clip(own)}

아래는 같은 주제에 대한 다른 참가자들의 의견이다. 각 의견의 장점, 논리적 허점, 근거가 부족한 주장, 네 의견과 다른 부분을 분석하라. 타당한 주장은 인정하고, 실제로 반박할 근거가 있을 때만 반박하라.

${others.map((o) => quote(o.id, o.text)).join('\n\n')}

참가자별로 소제목을 달아 분석하고, 1500자 이내로 답하라.`;
}

export function revisionPrompt({ topic, roundNo, totalRounds, self, own, others }) {
  return `${HEADER(topic, roundNo, totalRounds)}
너는 이 토론에서 "${participantName(self)}" 참가자다.

[너의 직전 발언]
${clip(own)}

[다른 참가자들의 직전 발언 — 너에 대한 비판이 포함될 수 있다]
${others.map((o) => quote(o.id, o.text)).join('\n\n')}

이제 너의 입장을 재검토하라.
1. 기존 주장을 유지할지 판단하고 이유를 밝혀라.
2. 타당한 비판은 받아들여 주장에 반영하라.
3. 필요하면 주장을 수정하고, 무엇이 바뀌었는지 명시하라.
4. 동의하지 않는 의견이 있다면 구체적인 이유를 설명하라.
억지로 합의할 필요는 없다. 이전과 같은 내용을 반복하지 말고, 1500자 이내로 답하라.`;
}

export function synthesisPrompt({ topic, moderator, transcript }) {
  return `[AI Roundtable 토론 — 최종 종합]
토론 주제: ${topic}

너("${participantName(moderator)}")는 이 토론의 사회자로서 최종 결과를 작성한다. 너 자신의 발언도 다른 참가자와 같은 기준으로 공정하게 다뤄라.

[토론 기록]
${transcript}

아래 항목을 이 순서대로, 각 항목을 마크다운 소제목(##)으로 작성하라.
## 토론 주제
## 세 AI의 초기 의견 요약
## 핵심 쟁점
## 주요 반론과 재검토 결과
## 합의한 부분
## 여전히 의견이 다른 부분
## 최종 결론
## 추가 검증이 필요한 주장`;
}
