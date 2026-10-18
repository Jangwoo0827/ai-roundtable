// 토론 진행 상태를 관리하는 단일 엔진. UI와 확장 프로그램은 라운드를 직접 진행하지 않고
// 엔진의 명령(start/pause/resume/cancel/retry/exclude/submitManual)만 호출한다.
import { PARTICIPANT_IDS, participantName } from './participants.js';
import { independentPrompt, critiquePrompt, revisionPrompt, synthesisPrompt } from './prompts.js';
import { compactTranscript } from './transcript.js';
import { clampRounds, nextRoundNo, roundKind, withTimeout, isRepetition } from './scheduler.js';

export const DEBATE_STATES = ['idle', 'connecting', 'running', 'paused', 'waiting', 'completed', 'failed', 'cancelled'];
// 발언 상태: queued(대기열) → pending(전송·응답 대기) → responding(응답 중) → done | failed | excluded
// 수동 모드: queued → awaiting(붙여넣기 대기) → done
const OPEN = ['pending', 'responding', 'awaiting'];
const FINISHED = ['completed', 'cancelled', 'failed'];

let seq = 0;
const defaultId = (p) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export class DebateEngine {
  constructor({ provider, store = null, timeoutMs = 4 * 60_000, maxResponseChars = 20_000, now = () => Date.now(), idGen = defaultId } = {}) {
    this.provider = provider;
    this.store = store;
    this.timeoutMs = timeoutMs;
    this.maxResponseChars = maxResponseChars;
    this.now = now;
    this.idGen = idGen;
    this.debate = null;
    this.listeners = new Set();
    this.inflight = new Map(); // taskId -> AbortController
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _changed() {
    if (!this.debate) return;
    this.debate.updatedAt = this.now();
    this.store?.save(this.debate);
    for (const fn of this.listeners) fn(this.debate);
  }

  _log(level, msg) {
    this.debate.log.push({ at: this.now(), level, msg });
    if (this.debate.log.length > 200) this.debate.log.splice(0, this.debate.log.length - 200);
  }

  setProvider(provider) {
    this.provider = provider;
  }

  // 진행 중 모드 전환(예: 자동 연결이 안 될 때 수동으로). 대기열의 발언부터 새 모드로 처리한다.
  setMode(mode) {
    const d = this.debate;
    if (!d || d.mode === mode || FINISHED.includes(d.status)) return;
    d.mode = mode;
    for (const u of this.currentRound()?.utterances ?? []) {
      if (mode === 'manual' && u.status === 'failed') u.status = 'awaiting';
      if (mode !== 'manual' && u.status === 'awaiting') u.status = 'queued';
    }
    this._log('info', `모드를 ${mode === 'manual' ? '수동' : '자동(브리지)'}으로 바꿨습니다.`);
    if (d.status === 'waiting') d.status = 'running';
    this._advance();
    this._changed();
  }

  create({ topic, participants = PARTICIPANT_IDS, moderator, totalRounds = 3, mode = 'manual' }) {
    const t = String(topic ?? '').trim();
    if (!t) throw new Error('토론 주제를 입력하세요.');
    if (t.length > 4000) throw new Error('주제는 4000자 이하로 입력하세요.');
    const ps = PARTICIPANT_IDS.filter((p) => participants.includes(p));
    if (ps.length < 2) throw new Error('참가자를 2명 이상 선택하세요.');
    this.cancelInflight();
    this.debate = {
      id: this.idGen('debate'),
      topic: t,
      createdAt: this.now(),
      updatedAt: this.now(),
      participants: ps,
      excluded: [],
      moderator: ps.includes(moderator) ? moderator : ps[0],
      totalRounds: clampRounds(totalRounds),
      mode,
      status: 'idle',
      rounds: [],
      final: null,
      lastError: null,
      log: [],
    };
    this._changed();
    return this.debate;
  }

  // 저장된 토론을 불러온다. 새로고침으로 끊긴 자동 작업은 INTERRUPTED 실패로 바꾸고 일시 정지한다.
  load(debate) {
    this.cancelInflight();
    this.debate = debate;
    let interrupted = 0;
    for (const r of debate.rounds) {
      for (const u of r.utterances) {
        if (u.status === 'pending' || u.status === 'responding') {
          u.status = 'failed';
          u.error = '페이지 새로고침으로 응답 수집이 중단되었습니다.';
          u.errorCode = 'INTERRUPTED';
          u.taskId = null;
          interrupted++;
        }
      }
    }
    if (['running', 'connecting', 'waiting'].includes(debate.status)) debate.status = 'paused';
    if (interrupted) this._log('warn', `새로고침으로 중단된 발언 ${interrupted}개를 재개 시 다시 요청합니다.`);
    this._changed();
    return debate;
  }

  active() {
    const d = this.debate;
    return d.participants.filter((p) => !d.excluded.includes(p));
  }

  currentRound() {
    return this.debate?.rounds.at(-1) ?? null;
  }

  async start() {
    const d = this.debate;
    if (!d || d.status !== 'idle') return;
    d.status = 'connecting';
    d.lastError = null;
    this._changed();
    if (d.mode !== 'manual' && this.provider?.check) {
      let res;
      try {
        res = await this.provider.check(this.active());
      } catch (e) {
        res = { ok: false, error: e.message };
      }
      if (this.debate !== d || d.status !== 'connecting') return;
      if (!res?.ok) {
        d.status = 'idle';
        d.lastError = res?.error || '자동 연결을 확인하지 못했습니다.';
        this._log('error', d.lastError);
        this._changed();
        return;
      }
    }
    d.status = 'running';
    this._log('info', '토론을 시작했습니다.');
    this._advance();
  }

  pause() {
    const d = this.debate;
    if (!d || !['running', 'waiting', 'connecting'].includes(d.status)) return;
    d.status = 'paused';
    this._log('info', '일시 정지: 진행 중인 응답은 기록하지만 새 요청은 보내지 않습니다.');
    this._changed();
  }

  resume() {
    const d = this.debate;
    if (!d || d.status !== 'paused') return;
    for (const r of d.rounds)
      for (const u of r.utterances)
        if (u.status === 'failed' && u.errorCode === 'INTERRUPTED') u.status = 'queued';
    d.status = 'running';
    this._log('info', '재개했습니다.');
    this._advance();
  }

  cancel() {
    const d = this.debate;
    if (!d || FINISHED.includes(d.status)) return;
    this.cancelInflight();
    for (const r of d.rounds)
      for (const u of r.utterances)
        if (u.status === 'queued' || OPEN.includes(u.status)) {
          u.status = 'failed';
          u.error = '토론이 종료되어 취소되었습니다.';
          u.errorCode = 'CANCELLED';
          u.taskId = null;
        }
    d.status = 'cancelled';
    this._log('info', '토론을 종료했습니다.');
    this._changed();
  }

  cancelInflight() {
    for (const [taskId, ac] of this.inflight) {
      ac.abort();
      try {
        this.provider?.cancel?.(taskId);
      } catch {}
    }
    this.inflight.clear();
  }

  _find(utteranceId) {
    for (const r of this.debate?.rounds ?? []) {
      const u = r.utterances.find((x) => x.id === utteranceId);
      if (u) return { round: r, u };
    }
    return {};
  }

  // 실패한 발언 하나만 다시 요청한다(현재 라운드 한정).
  retry(utteranceId) {
    const d = this.debate;
    const { round, u } = this._find(utteranceId);
    if (!u || u.status !== 'failed' || FINISHED.includes(d.status)) return false;
    if (round !== this.currentRound()) return false;
    u.status = 'queued';
    u.error = null;
    u.errorCode = null;
    if (d.status === 'waiting') d.status = 'running';
    this._advance();
    if (d.status === 'paused') this._changed();
    return true;
  }

  retryFailed() {
    const r = this.currentRound();
    if (!r) return 0;
    let n = 0;
    for (const u of r.utterances) if (u.status === 'failed' && this.retry(u.id)) n++;
    return n;
  }

  // 참가자를 남은 토론에서 제외한다. 현재 라운드의 미완료 발언은 excluded가 된다.
  exclude(participantId) {
    const d = this.debate;
    if (!d || FINISHED.includes(d.status) || d.excluded.includes(participantId)) return;
    const remaining = this.active().filter((p) => p !== participantId);
    if (remaining.length < 1) return;
    d.excluded.push(participantId);
    const r = this.currentRound();
    for (const u of r?.utterances ?? []) {
      if (u.participantId === participantId && u.status !== 'done') {
        if (u.taskId && this.inflight.has(u.taskId)) {
          this.inflight.get(u.taskId).abort();
          this.provider?.cancel?.(u.taskId);
          this.inflight.delete(u.taskId);
        }
        u.status = 'excluded';
        u.taskId = null;
      }
    }
    if (d.moderator === participantId) {
      d.moderator = remaining[0];
      this._log('warn', `사회자를 ${participantName(remaining[0])}(으)로 변경했습니다.`);
    }
    // 사회자 발언이 제외되었다면 새 사회자에게 다시 맡긴다.
    if (r?.kind === 'synthesis' && r.utterances.every((u) => u.status === 'excluded')) {
      r.utterances.push(this._utterance(r, d.moderator, r.utterances[0].prompt.replace(/너\("[^"]+"\)/, `너("${participantName(d.moderator)}")`)));
    }
    this._log('warn', `${participantName(participantId)}을(를) 토론에서 제외했습니다.`);
    if (d.status === 'waiting') d.status = 'running';
    this._advance();
    this._changed();
  }

  // 수동 입력(또는 자동 실패 후 직접 붙여넣기). 답변은 한 번만 등록된다.
  submitManual(utteranceId, text) {
    const d = this.debate;
    const { round, u } = this._find(utteranceId);
    if (!u || FINISHED.includes(d.status) || round !== this.currentRound()) return false;
    if (!['queued', 'awaiting', 'failed', 'pending', 'responding'].includes(u.status)) return false;
    const t = String(text ?? '').trim();
    if (!t) return false;
    if (u.taskId && this.inflight.has(u.taskId)) {
      this.inflight.get(u.taskId).abort();
      this.provider?.cancel?.(u.taskId);
      this.inflight.delete(u.taskId);
    }
    this._complete(u, round, t, 'manual');
    if (d.status === 'waiting') d.status = 'running';
    if (d.status === 'idle') d.status = 'running';
    this._advance();
    this._changed();
    return true;
  }

  _utterance(round, participantId, prompt) {
    return {
      id: this.idGen('utt'),
      debateId: this.debate.id,
      roundNo: round.no,
      participantId,
      content: '',
      prompt,
      status: 'queued',
      createdAt: this.now(),
      updatedAt: this.now(),
      attempts: 0,
      taskId: null,
      error: null,
      errorCode: null,
      warning: null,
      source: null,
      preview: '',
    };
  }

  _prevContent(no, participantId) {
    const prev = this.debate.rounds.find((r) => r.no === no - 1);
    return prev?.utterances.find((u) => u.participantId === participantId && u.status === 'done')?.content ?? '';
  }

  _makeRound(no) {
    const d = this.debate;
    const kind = roundKind(no, d.totalRounds);
    const round = { no, kind, startedAt: this.now(), utterances: [] };
    const base = { topic: d.topic, roundNo: no, totalRounds: d.totalRounds };
    if (kind === 'synthesis') {
      round.utterances.push(this._utterance(round, d.moderator, synthesisPrompt({ topic: d.topic, moderator: d.moderator, transcript: compactTranscript(d) })));
      return round;
    }
    const prev = d.rounds.find((r) => r.no === no - 1);
    for (const p of this.active()) {
      let prompt;
      if (kind === 'independent') prompt = independentPrompt(base);
      else {
        const others = (prev?.utterances ?? [])
          .filter((u) => u.participantId !== p && u.status === 'done')
          .map((u) => ({ id: u.participantId, text: u.content }));
        const own = this._prevContent(no, p);
        prompt = (kind === 'critique' ? critiquePrompt : revisionPrompt)({ ...base, self: p, own, others });
      }
      round.utterances.push(this._utterance(round, p, prompt));
    }
    return round;
  }

  _roundDone(round) {
    return round.utterances.every((u) => u.status === 'done' || u.status === 'excluded') && round.utterances.some((u) => u.status === 'done');
  }

  _advance() {
    const d = this.debate;
    if (!d || d.status !== 'running') return;
    for (let guard = 0; guard < 20; guard++) {
      let round = this.currentRound();
      if (!round || this._roundDone(round)) {
        if (round?.kind === 'synthesis') {
          d.final = round.utterances.find((u) => u.status === 'done')?.content ?? null;
          d.status = 'completed';
          this._log('info', '최종 종합까지 완료했습니다.');
          this._changed();
          return;
        }
        if (this.active().length < 1) {
          d.status = 'failed';
          d.lastError = '남은 참가자가 없습니다.';
          this._changed();
          return;
        }
        const no = nextRoundNo(d);
        if (no == null) {
          d.status = 'completed';
          this._changed();
          return;
        }
        round = this._makeRound(no);
        d.rounds.push(round);
        this._log('info', `${round.kind === 'synthesis' ? '최종 종합' : `라운드 ${no}`}을(를) 시작합니다.`);
      }
      for (const u of round.utterances) if (u.status === 'queued') this._dispatch(u, round);
      const open = round.utterances.some((u) => OPEN.includes(u.status));
      const failed = round.utterances.some((u) => u.status === 'failed');
      if (!open && failed) {
        d.status = 'waiting';
        this._log('warn', '일부 참가자가 실패했습니다. 재시도하거나 제외하세요.');
      }
      // 같은 동기 실행 안에서 끝난 라운드(예: 즉시 응답하는 테스트 제공자)는 다음 라운드로 이어진다.
      if (!this._roundDone(round) || d.status !== 'running') break;
    }
    this._changed();
  }

  _dispatch(u, round) {
    const d = this.debate;
    if (d.mode === 'manual' || !this.provider || this.provider.manual) {
      u.status = 'awaiting';
      u.updatedAt = this.now();
      return;
    }
    u.attempts += 1;
    const taskId = `${u.id}#${u.attempts}`;
    u.taskId = taskId;
    u.status = 'pending';
    u.error = null;
    u.errorCode = null;
    u.preview = '';
    u.updatedAt = this.now();
    const ac = new AbortController();
    this.inflight.set(taskId, ac);
    const task = { taskId, debateId: d.id, participantId: u.participantId, prompt: u.prompt, newChat: round.no === 1 && u.attempts === 1, timeoutMs: this.timeoutMs };
    const onProgress = (p) => {
      if (u.taskId !== taskId || !OPEN.includes(u.status)) return;
      if (p?.state === 'responding') u.status = 'responding';
      if (typeof p?.preview === 'string') u.preview = p.preview.slice(-400);
      this._changed();
    };
    let run;
    try {
      run = Promise.resolve(this.provider.run(task, { signal: ac.signal, onProgress }));
    } catch (e) {
      run = Promise.reject(e);
    }
    withTimeout(run, this.timeoutMs, () => this.provider?.cancel?.(taskId))
      .then((res) => this._accept(u.id, taskId, res?.text))
      .catch((err) => this._fail(u.id, taskId, err));
  }

  _accept(utteranceId, taskId, text) {
    const { round, u } = this._find(utteranceId);
    this.inflight.delete(taskId);
    // 이전 시도, 취소된 시도, 이미 등록된 발언의 응답은 버린다(중복 방지).
    if (!u || u.taskId !== taskId || !['pending', 'responding'].includes(u.status)) return;
    const t = String(text ?? '').trim();
    if (!t) return this._fail(utteranceId, taskId, Object.assign(new Error('빈 응답을 받았습니다.'), { code: 'EMPTY' }));
    this._complete(u, round, t, 'auto');
    this._advance();
    this._changed();
  }

  _complete(u, round, text, source) {
    let t = text;
    u.warning = null;
    if (t.length > this.maxResponseChars) {
      t = t.slice(0, this.maxResponseChars);
      u.warning = `응답이 너무 길어 ${this.maxResponseChars}자로 잘랐습니다.`;
    }
    if (round.kind !== 'synthesis' && isRepetition(this._prevContent(round.no, u.participantId), t)) {
      u.warning = '직전 라운드와 거의 같은 내용을 반복했습니다.';
      this._log('warn', `${participantName(u.participantId)}: ${u.warning}`);
    }
    u.content = t;
    u.status = 'done';
    u.source = source;
    u.taskId = null;
    u.error = null;
    u.errorCode = null;
    u.preview = '';
    u.updatedAt = this.now();
  }

  _fail(utteranceId, taskId, err) {
    const { u } = this._find(utteranceId);
    this.inflight.delete(taskId);
    if (!u || u.taskId !== taskId || !['pending', 'responding'].includes(u.status)) return;
    u.status = 'failed';
    u.error = err?.message || String(err);
    u.errorCode = err?.code || 'ERROR';
    u.taskId = null;
    u.updatedAt = this.now();
    this._log('error', `${participantName(u.participantId)}: ${u.error}`);
    if (this.debate.status === 'running') this._advance();
    this._changed();
  }
}
