// 사이트별 작업 큐. 같은 사이트(탭 하나)에는 한 번에 한 작업만 보내고,
// 타임아웃·재시도·중복 결과 차단을 여기서 처리한다.
import { SITES } from './protocol.js';

export class TaskQueue {
  constructor({ send, report, maxRetries = 1, graceMs = 15_000 } = {}) {
    this.send = send; // (msg) => boolean  확장 프로그램으로 전송
    this.report = report; // (task, msg) => void  웹사이트로 결과/진행 상황 전달
    this.maxRetries = maxRetries;
    this.graceMs = graceMs;
    this.waiting = Object.fromEntries(SITES.map((s) => [s, []]));
    this.active = Object.fromEntries(SITES.map((s) => [s, null]));
    this.seen = new Set();
    this.extensionReady = false;
  }

  setExtensionReady(ready) {
    this.extensionReady = ready;
    if (!ready) {
      for (const s of SITES) {
        const t = this.active[s];
        if (t) this._finish(t, { ok: false, error: { code: 'EXTENSION_DISCONNECTED', message: '확장 프로그램 연결이 끊겼습니다.' } });
      }
    } else for (const s of SITES) this._pump(s);
  }

  submit(task, owner) {
    if (this.seen.has(task.taskId)) return 'duplicate';
    this._remember(task.taskId);
    this.waiting[task.participantId].push({ ...task, owner, attempts: 0, timer: null });
    this.report({ ...task, owner }, { type: 'progress', taskId: task.taskId, state: 'queued' });
    this._pump(task.participantId);
    return 'accepted';
  }

  _remember(id) {
    this.seen.add(id);
    if (this.seen.size > 5000) this.seen.delete(this.seen.values().next().value);
  }

  _pump(site) {
    if (!this.extensionReady || this.active[site]) return;
    const t = this.waiting[site].shift();
    if (!t) return;
    this.active[site] = t;
    t.attempts++;
    const ok = this.send({ type: 'task', taskId: t.taskId, participantId: t.participantId, prompt: t.prompt, newChat: t.newChat && t.attempts === 1, timeoutMs: t.timeoutMs });
    if (!ok) return this._finish(t, { ok: false, error: { code: 'EXTENSION_DISCONNECTED', message: '확장 프로그램에 전달하지 못했습니다.' } });
    // 확장 프로그램 쪽 대기 시간 + 여유. 그래도 결과가 없으면 실패 처리한다.
    t.timer = setTimeout(() => {
      this.send({ type: 'cancel', taskId: t.taskId });
      this._finish(t, { ok: false, error: { code: 'TIMEOUT', message: '브리지 대기 시간을 넘었습니다.' } });
    }, t.timeoutMs + this.graceMs);
    this.report(t, { type: 'progress', taskId: t.taskId, state: 'sending' });
  }

  onProgress(msg) {
    const t = this._activeById(msg.taskId);
    if (t) this.report(t, msg);
  }

  onResult(msg) {
    const t = this._activeById(msg.taskId);
    if (!t) return false; // 이미 끝났거나 모르는 작업 → 중복 결과 무시
    if (!msg.ok && msg.error?.retryable && t.attempts <= this.maxRetries) {
      clearTimeout(t.timer);
      this.active[t.participantId] = null;
      this.waiting[t.participantId].unshift(t);
      this.report(t, { type: 'progress', taskId: t.taskId, state: 'retrying', preview: msg.error.message });
      this._pump(t.participantId);
      return true;
    }
    this._finish(t, msg);
    return true;
  }

  cancel(taskId) {
    for (const s of SITES) {
      const i = this.waiting[s].findIndex((t) => t.taskId === taskId);
      if (i >= 0) {
        const [t] = this.waiting[s].splice(i, 1);
        this.report(t, { type: 'result', taskId, ok: false, error: { code: 'CANCELLED', message: '취소됨' } });
        return true;
      }
    }
    const t = this._activeById(taskId);
    if (!t) return false;
    this.send({ type: 'cancel', taskId });
    this._finish(t, { ok: false, error: { code: 'CANCELLED', message: '취소됨' } });
    return true;
  }

  dropOwner(owner) {
    for (const s of SITES) {
      this.waiting[s] = this.waiting[s].filter((t) => t.owner !== owner);
      const t = this.active[s];
      if (t?.owner === owner) {
        this.send({ type: 'cancel', taskId: t.taskId });
        this._finish(t, null);
      }
    }
  }

  _activeById(taskId) {
    return SITES.map((s) => this.active[s]).find((t) => t?.taskId === taskId) ?? null;
  }

  _finish(t, msg) {
    clearTimeout(t.timer);
    if (this.active[t.participantId] === t) this.active[t.participantId] = null;
    if (msg) this.report(t, { type: 'result', taskId: t.taskId, ok: msg.ok, text: msg.text, error: msg.error ?? null });
    this._pump(t.participantId);
  }

  snapshot() {
    return Object.fromEntries(SITES.map((s) => [s, { active: this.active[s]?.taskId ?? null, waiting: this.waiting[s].length }]));
  }
}
