import test from 'node:test';
import assert from 'node:assert/strict';
import { DebateEngine } from '../src/debate/engine.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async (n = 10) => { for (let i = 0; i < n; i++) await tick(); };

// 호출을 기록하고 테스트가 직접 응답을 결정하는 더미 제공자.
function fakeProvider() {
  const calls = [];
  return {
    calls,
    cancelled: [],
    check: async () => ({ ok: true }),
    run(task) {
      return new Promise((resolve, reject) => calls.push({ task, resolve, reject }));
    },
    cancel(id) { this.cancelled.push(id); },
    answerAll(fn = (t) => `${t.participantId} 답변 r${t.prompt.match(/라운드 (\d)/)?.[1] ?? 'S'} ${Math.random()}`) {
      const open = calls.splice(0);
      for (const c of open) c.resolve({ text: fn(c.task) });
      return open;
    },
  };
}

function mk(opts = {}) {
  const provider = fakeProvider();
  const engine = new DebateEngine({ provider, timeoutMs: opts.timeoutMs ?? 0 });
  engine.create({ topic: '원격 근무가 생산성을 높이는가?', mode: 'bridge', totalRounds: 3, moderator: 'claude', ...opts });
  return { provider, engine };
}

test('라운드 1은 세 참가자에게 같은 독립 질문을 동시에 보낸다', async () => {
  const { provider, engine } = mk();
  await engine.start();
  assert.equal(provider.calls.length, 3);
  const prompts = new Set(provider.calls.map((c) => c.task.prompt));
  assert.equal(prompts.size, 1);
  assert.ok(provider.calls.every((c) => c.task.newChat));
});

test('모든 응답이 오기 전에는 다음 라운드를 시작하지 않는다', async () => {
  const { provider, engine } = mk();
  await engine.start();
  const [a, b] = provider.calls.splice(0, 2);
  a.resolve({ text: 'gemini 의견' });
  b.resolve({ text: 'chatgpt 의견' });
  await flush();
  assert.equal(engine.debate.rounds.length, 1);
  provider.answerAll();
  await flush();
  assert.equal(engine.debate.rounds.length, 2);
  assert.equal(engine.debate.rounds[1].kind, 'critique');
});

test('비평 라운드는 다른 두 참가자의 답변을 이름과 함께 정확히 전달한다', async () => {
  const { provider, engine } = mk();
  await engine.start();
  provider.answerAll((t) => `<<${t.participantId}의 고유 의견>>`);
  await flush();
  const toClaude = provider.calls.find((c) => c.task.participantId === 'claude').task.prompt;
  assert.match(toClaude, /\[Gemini\] 의 발언 시작 =====\n<<gemini의 고유 의견>>/);
  assert.match(toClaude, /\[ChatGPT\] 의 발언 시작 =====\n<<chatgpt의 고유 의견>>/);
  assert.match(toClaude, /너의 이전 의견\]\n<<claude의 고유 의견>>/);
  assert.ok(!toClaude.includes('[Claude] 의 발언 시작'));
});

test('전체 흐름: 독립→비평→재검토→사회자 종합 후 completed', async () => {
  const { provider, engine } = mk();
  await engine.start();
  for (let i = 0; i < 3; i++) { provider.answerAll(); await flush(); }
  assert.equal(engine.debate.rounds.at(-1).kind, 'synthesis');
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].task.participantId, 'claude');
  assert.match(provider.calls[0].task.prompt, /## 추가 검증이 필요한 주장/);
  provider.answerAll(() => '## 최종 결론\n좋다');
  await flush();
  assert.equal(engine.debate.status, 'completed');
  assert.match(engine.debate.final, /최종 결론/);
});

test('실패한 참가자 때문에 무한 대기하지 않고 waiting → 실패한 것만 재시도', async () => {
  const { provider, engine } = mk();
  await engine.start();
  const calls = provider.calls.splice(0);
  calls[0].resolve({ text: 'ok1' });
  calls[1].resolve({ text: 'ok2' });
  calls[2].reject(Object.assign(new Error('로그인 필요'), { code: 'NOT_LOGGED_IN' }));
  await flush();
  assert.equal(engine.debate.status, 'waiting');
  const failed = engine.currentRound().utterances.find((u) => u.status === 'failed');
  engine.retry(failed.id);
  assert.equal(provider.calls.length, 1, '실패한 참가자만 다시 요청');
  assert.equal(provider.calls[0].task.participantId, failed.participantId);
  provider.answerAll();
  await flush();
  assert.equal(engine.debate.rounds.length, 2);
});

test('타임아웃이 나면 실패로 처리하고 제공자에 취소를 보낸다', async () => {
  const { provider, engine } = mk({ timeoutMs: 30 });
  await engine.start();
  await new Promise((r) => setTimeout(r, 60));
  await flush();
  assert.equal(engine.debate.status, 'waiting');
  assert.ok(engine.currentRound().utterances.every((u) => u.errorCode === 'TIMEOUT'));
  assert.equal(provider.cancelled.length, 3);
});

test('제외하면 남은 참가자로 진행한다', async () => {
  const { provider, engine } = mk();
  await engine.start();
  const calls = provider.calls.splice(0);
  calls[0].resolve({ text: 'g' });
  calls[1].resolve({ text: 'c' });
  await flush();
  engine.exclude('claude');
  await flush();
  assert.equal(engine.debate.rounds.length, 2);
  assert.deepEqual(provider.calls.map((c) => c.task.participantId).sort(), ['chatgpt', 'gemini']);
  assert.notEqual(engine.debate.moderator, 'claude');
  calls[2].resolve({ text: '늦게 온 claude 답변' });
  await flush();
  assert.equal(engine.debate.rounds[0].utterances[2].status, 'excluded');
});

test('중복 응답 방지: 재시도 후 늦게 도착한 이전 시도 응답은 버린다', async () => {
  const { provider, engine } = mk({ timeoutMs: 0 });
  await engine.start();
  const old = provider.calls.splice(0);
  old[0].reject(new Error('일시 오류'));
  old[1].resolve({ text: 'b' });
  old[2].resolve({ text: 'c' });
  await flush();
  const u = engine.currentRound().utterances[0];
  engine.retry(u.id);
  old[0].resolve({ text: '이전 시도 응답' }); // 이미 reject된 약속이라 무시되지만 명시적 확인
  provider.calls[0].resolve({ text: '새 응답' });
  provider.calls.splice(0, 1);
  await flush();
  assert.equal(engine.debate.rounds[0].utterances[0].content, '새 응답');
  const done = engine.debate.rounds[0].utterances.filter((x) => x.participantId === 'gemini');
  assert.equal(done.length, 1);
});

test('수동 입력과 자동 응답이 겹쳐도 한 번만 등록된다', async () => {
  const { provider, engine } = mk();
  await engine.start();
  const u = engine.currentRound().utterances[0];
  assert.ok(engine.submitManual(u.id, '수동 답변'));
  provider.calls[0].resolve({ text: '자동 답변' });
  await flush();
  assert.equal(u.content, '수동 답변');
  assert.equal(engine.submitManual(u.id, '또 입력'), false);
});

test('일시 정지 중에는 다음 라운드를 보내지 않고 재개하면 이어간다', async () => {
  const { provider, engine } = mk();
  await engine.start();
  engine.pause();
  provider.answerAll();
  await flush();
  assert.equal(engine.debate.status, 'paused');
  assert.equal(engine.debate.rounds.length, 1);
  assert.equal(engine.currentRound().utterances.filter((u) => u.status === 'done').length, 3);
  engine.resume();
  assert.equal(engine.debate.rounds.length, 2);
  assert.equal(provider.calls.length, 3);
});

test('취소하면 진행 중 작업을 중단하고 이후 응답을 무시한다', async () => {
  const { provider, engine } = mk();
  await engine.start();
  engine.cancel();
  assert.equal(engine.debate.status, 'cancelled');
  assert.equal(provider.cancelled.length, 3);
  provider.answerAll();
  await flush();
  assert.ok(engine.currentRound().utterances.every((u) => u.status === 'failed'));
});

test('새로고침 복구: JSON으로 저장한 토론을 불러오면 paused, 재개 시 중단된 것만 재요청', async () => {
  const { provider, engine } = mk();
  await engine.start();
  provider.calls.splice(0, 1)[0].resolve({ text: '끝난 답변' });
  await flush();
  const saved = JSON.parse(JSON.stringify(engine.debate));

  const p2 = fakeProvider();
  const e2 = new DebateEngine({ provider: p2, timeoutMs: 0 });
  e2.load(saved);
  assert.equal(e2.debate.status, 'paused');
  e2.resume();
  assert.equal(p2.calls.length, 2);
  assert.equal(e2.debate.rounds[0].utterances[0].content, '끝난 답변');
});

test('수동 모드: 제공자 호출 없이 붙여넣기로 라운드를 진행한다', async () => {
  const provider = fakeProvider();
  const engine = new DebateEngine({ provider });
  engine.create({ topic: 't', mode: 'manual', participants: ['gemini', 'claude'], totalRounds: 2 });
  await engine.start();
  assert.equal(provider.calls.length, 0);
  for (const u of engine.currentRound().utterances) engine.submitManual(u.id, `${u.participantId} 의견`);
  assert.equal(engine.debate.rounds.length, 2);
  for (const u of engine.currentRound().utterances) engine.submitManual(u.id, `${u.participantId} 비평`);
  assert.equal(engine.currentRound().kind, 'synthesis');
  engine.submitManual(engine.currentRound().utterances[0].id, '결론');
  assert.equal(engine.debate.status, 'completed');
});

test('반복 발언과 과도한 응답에 경고를 붙인다', async () => {
  const provider = fakeProvider();
  const engine = new DebateEngine({ provider, maxResponseChars: 500 });
  engine.create({ topic: 't', mode: 'manual', participants: ['gemini', 'claude'], totalRounds: 3 });
  await engine.start();
  const long = '같은 말을 반복합니다. '.repeat(30);
  for (const u of engine.currentRound().utterances) engine.submitManual(u.id, long);
  const g = engine.currentRound().utterances[0];
  engine.submitManual(g.id, long);
  assert.match(g.warning, /반복/);
  const c = engine.currentRound().utterances[1];
  engine.submitManual(c.id, 'x'.repeat(900));
  assert.equal(c.content.length, 500);
  assert.match(c.warning, /잘랐/);
});

test('참가자 1명, 빈 주제는 거부한다', () => {
  const engine = new DebateEngine({});
  assert.throws(() => engine.create({ topic: '', participants: ['gemini', 'claude'] }));
  assert.throws(() => engine.create({ topic: 'a', participants: ['gemini'] }));
});
