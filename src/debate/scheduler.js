// 라운드 계획과 작업 타이머. 엔진에서 상태와 무관한 순수 로직만 분리했다.

export const MIN_ROUNDS = 2;
export const MAX_ROUNDS = 6;

export function clampRounds(n) {
  const v = Math.round(Number(n) || 3);
  return Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, v));
}

// 토론 라운드 수(totalRounds)는 종합 단계를 뺀 발언 라운드 수다.
// 1: 독립 의견, 2: 상호 비평, 3..N: 재검토 및 반론, 그다음 최종 종합.
export function roundKind(no, totalRounds) {
  if (no === 1) return 'independent';
  if (no === 2) return 'critique';
  if (no <= totalRounds) return 'revision';
  if (no === totalRounds + 1) return 'synthesis';
  return null;
}

export function nextRoundNo(debate) {
  const last = debate.rounds.at(-1);
  const no = last ? last.no + 1 : 1;
  return roundKind(no, debate.totalRounds) ? no : null;
}

// 약속을 제한 시간 안에 끝내지 못하면 TIMEOUT 오류로 거부한다.
export function withTimeout(promise, ms, onTimeout) {
  if (!ms || ms <= 0) return promise;
  let timer;
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      const e = new Error(`응답 제한 시간(${Math.round(ms / 1000)}초)을 넘었습니다.`);
      e.code = 'TIMEOUT';
      reject(e);
    }, ms);
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

// 같은 참가자가 직전과 거의 같은 내용을 반복했는지 대략 판정한다.
export function isRepetition(prev, next) {
  if (!prev || !next) return false;
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const a = norm(prev);
  const b = norm(next);
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 80) return false;
  const grams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 4; i += 3) set.add(s.slice(i, i + 5));
    return set;
  };
  const ga = grams(a);
  const gb = grams(b);
  let hit = 0;
  for (const g of gb) if (ga.has(g)) hit++;
  return hit / Math.max(1, gb.size) > 0.9;
}
