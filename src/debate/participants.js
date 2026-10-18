// 참가자 정의. 색상만으로 구분하지 않도록 아이콘(글리프)과 이름을 함께 쓴다.
export const PARTICIPANTS = {
  gemini: { id: 'gemini', name: 'Gemini', glyph: '✦', color: '#5b8def', url: 'https://gemini.google.com/app' },
  chatgpt: { id: 'chatgpt', name: 'ChatGPT', glyph: '◎', color: '#19c37d', url: 'https://chatgpt.com/' },
  claude: { id: 'claude', name: 'Claude', glyph: '✺', color: '#d97757', url: 'https://claude.ai/new' },
};

export const PARTICIPANT_IDS = Object.keys(PARTICIPANTS);

export function participantName(id) {
  return PARTICIPANTS[id]?.name ?? id;
}
