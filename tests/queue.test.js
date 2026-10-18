import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskQueue } from '../bridge/queue.js';
import { validateFromWeb, validateFromExtension, parse } from '../bridge/protocol.js';

function mk() {
  const sent = [];
  const reports = [];
  const q = new TaskQueue({ send: (m) => (sent.push(m), true), report: (t, m) => reports.push(m), graceMs: 0 });
  q.setExtensionReady(true);
  return { q, sent, reports };
}
const task = (id, site = 'gemini') => ({ taskId: id, participantId: site, prompt: 'p', newChat: false, timeoutMs: 1000 });

test('사이트당 한 번에 하나만 보내고 끝나면 다음 작업', () => {
  const { q, sent } = mk();
  q.submit(task('a'), 'o');
  q.submit(task('b'), 'o');
  q.submit(task('c', 'claude'), 'o');
  assert.deepEqual(sent.map((m) => m.taskId), ['a', 'c']);
  q.onResult({ taskId: 'a', ok: true, text: 'x' });
  assert.deepEqual(sent.map((m) => m.taskId), ['a', 'c', 'b']);
});

test('중복 taskId와 중복 결과를 거부한다', () => {
  const { q, reports } = mk();
  assert.equal(q.submit(task('a'), 'o'), 'accepted');
  assert.equal(q.submit(task('a'), 'o'), 'duplicate');
  assert.equal(q.onResult({ taskId: 'a', ok: true, text: 'x' }), true);
  assert.equal(q.onResult({ taskId: 'a', ok: true, text: 'y' }), false);
  assert.equal(reports.filter((r) => r.type === 'result').length, 1);
});

test('retryable 오류는 한 번 재시도한다', () => {
  const { q, sent, reports } = mk();
  q.submit(task('a'), 'o');
  q.onResult({ taskId: 'a', ok: false, error: { code: 'TAB_LOADING', retryable: true } });
  assert.equal(sent.filter((m) => m.type === 'task').length, 2);
  q.onResult({ taskId: 'a', ok: false, error: { code: 'TAB_LOADING', retryable: true } });
  const r = reports.find((m) => m.type === 'result');
  assert.equal(r.ok, false);
});

test('브리지 타임아웃', async () => {
  const { q, reports, sent } = mk();
  q.submit({ ...task('a'), timeoutMs: 20 }, 'o');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(reports.find((m) => m.type === 'result').error.code, 'TIMEOUT');
  assert.ok(sent.some((m) => m.type === 'cancel'));
});

test('확장 연결이 끊기면 진행 중 작업을 실패 처리', () => {
  const { q, reports } = mk();
  q.submit(task('a'), 'o');
  q.setExtensionReady(false);
  assert.equal(reports.find((m) => m.type === 'result').error.code, 'EXTENSION_DISCONNECTED');
});

test('프로토콜 검증', () => {
  assert.throws(() => validateFromWeb({ type: 'task', taskId: 'a', participantId: 'evil', prompt: 'x' }));
  assert.throws(() => validateFromWeb({ type: 'task', taskId: 'a b<script>', participantId: 'gemini', prompt: 'x' }));
  assert.throws(() => validateFromWeb({ type: 'open', url: 'https://example.com' }));
  assert.equal(validateFromWeb({ type: 'task', taskId: 'a', participantId: 'gemini', prompt: 'x', timeoutMs: 1 }).timeoutMs, 10_000);
  assert.throws(() => validateFromExtension({ type: 'result', taskId: 'a', ok: true, text: '' }));
  assert.throws(() => parse('x'.repeat(300 * 1024)));
});
