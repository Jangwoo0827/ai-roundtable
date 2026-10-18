import test from 'node:test';
import assert from 'node:assert/strict';
import { roundKind, clampRounds, withTimeout, isRepetition } from '../src/debate/scheduler.js';

test('라운드 종류', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => roundKind(n, 3)), ['independent', 'critique', 'revision', 'synthesis', null]);
  assert.deepEqual([1, 2, 3, 4].map((n) => roundKind(n, 2)), ['independent', 'critique', 'synthesis', null]);
});

test('라운드 수 제한', () => {
  assert.equal(clampRounds(1), 2);
  assert.equal(clampRounds(99), 6);
  assert.equal(clampRounds('4'), 4);
});

test('withTimeout', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 10), { code: 'TIMEOUT' });
  assert.equal(await withTimeout(Promise.resolve(1), 100), 1);
});

test('반복 판정', () => {
  const a = '원격 근무는 집중 시간을 늘리고 출퇴근 시간을 줄여 생산성을 높인다. 다만 협업 비용이 증가한다. 결론적으로 혼합형이 좋다.';
  assert.ok(isRepetition(a, a + ' '));
  assert.ok(!isRepetition(a, '완전히 다른 주장입니다. 사무실 근무가 혁신에 유리하다는 연구가 많고, 신입 교육 측면에서도 대면이 낫다는 근거가 있다.'));
});
