// 토론 기록은 사용자 브라우저 localStorage에만 저장한다. 외부 업로드 없음.
const INDEX = 'rt:index';
const CURRENT = 'rt:current';
const SETTINGS = 'rt:settings';
const key = (id) => `rt:debate:${id}`;

function read(k, fallback) {
  try {
    const v = localStorage.getItem(k);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function write(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch (e) {
    console.warn('저장 실패', e);
    return false;
  }
}

export const localStore = {
  save(debate) {
    write(key(debate.id), debate);
    const idx = read(INDEX, []).filter((x) => x.id !== debate.id);
    idx.unshift({ id: debate.id, topic: debate.topic.slice(0, 120), createdAt: debate.createdAt, updatedAt: debate.updatedAt, status: debate.status });
    write(INDEX, idx.slice(0, 100));
    write(CURRENT, debate.id);
  },
  load(id) {
    return read(key(id), null);
  },
  list() {
    return read(INDEX, []);
  },
  current() {
    const id = read(CURRENT, null);
    return id ? this.load(id) : null;
  },
  clearCurrent() {
    localStorage.removeItem(CURRENT);
  },
  remove(id) {
    localStorage.removeItem(key(id));
    write(INDEX, read(INDEX, []).filter((x) => x.id !== id));
    if (read(CURRENT, null) === id) localStorage.removeItem(CURRENT);
  },
  // 가져온 JSON은 최소한의 형태 검사를 거친다.
  importJSON(text) {
    const d = JSON.parse(text);
    if (!d || typeof d.id !== 'string' || typeof d.topic !== 'string' || !Array.isArray(d.rounds) || !Array.isArray(d.participants)) throw new Error('AI Roundtable 토론 JSON이 아닙니다.');
    d.excluded ??= [];
    d.log ??= [];
    this.save(d);
    return d;
  },
  settings() {
    return { mode: 'manual', totalRounds: 3, moderator: 'claude', participants: ['gemini', 'chatgpt', 'claude'], timeoutSec: 240, port: 8787, ...read(SETTINGS, {}) };
  },
  saveSettings(s) {
    write(SETTINGS, s);
  },
};
