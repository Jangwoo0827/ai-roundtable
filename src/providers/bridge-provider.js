// 로컬 브리지(WebSocket)를 통해 확장 프로그램에 작업을 보내는 제공자.
import { providerError } from './provider-interface.js';

const SITE_BLOCKING = { login_required: '로그인 필요', blocked: '사람 확인(CAPTCHA) 필요', error: '오류' };

export class BridgeProvider {
  constructor({ port = 8787 } = {}) {
    this.port = port;
    this.ws = null;
    this.token = null;
    this.status = { bridge: 'disconnected', extension: false, sites: {}, error: '' };
    this.pending = new Map(); // taskId -> { resolve, reject, onProgress }
    this.listeners = new Set();
    this.retryTimer = null;
    this.stopped = true;
  }

  onStatus(fn) {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  _set(patch) {
    Object.assign(this.status, patch);
    for (const fn of this.listeners) fn(this.status);
  }

  async connect() {
    this.stopped = false;
    clearTimeout(this.retryTimer);
    if (this.ws && this.ws.readyState <= 1) return;
    this._set({ bridge: 'connecting', error: '' });
    try {
      const r = await fetch(`http://127.0.0.1:${this.port}/pair`, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status === 403 ? '이 웹사이트 주소는 브리지에서 허용되지 않았습니다.' : `브리지 응답 ${r.status}`);
      this.token = (await r.json()).token;
    } catch (e) {
      this._set({ bridge: 'disconnected', extension: false, error: e.message.includes('Failed to fetch') ? '브리지 서버가 꺼져 있습니다 (npm run bridge).' : e.message });
      return this._retry();
    }
    const ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', role: 'web', token: this.token, version: 1 }));
    ws.onmessage = (ev) => this._onMessage(ev.data);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this._set({ bridge: 'disconnected', extension: false, sites: {} });
      for (const [id, p] of this.pending) p.reject(providerError('BRIDGE_DISCONNECTED', '브리지 연결이 끊겼습니다.'));
      this.pending.clear();
      this._retry();
    };
  }

  disconnect() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this._set({ bridge: 'disconnected', extension: false, sites: {} });
  }

  _retry() {
    if (this.stopped) return;
    this.retryTimer = setTimeout(() => this.connect(), 3000);
  }

  _send(msg) {
    if (this.ws?.readyState !== 1) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'welcome') this._set({ bridge: 'connected', error: '' });
    else if (msg.type === 'status') this._set({ extension: !!msg.extension, sites: msg.sites || {} });
    else if (msg.type === 'progress') this.pending.get(msg.taskId)?.onProgress?.(msg);
    else if (msg.type === 'result') {
      const p = this.pending.get(msg.taskId);
      if (!p) return; // 모르는/이미 처리한 결과는 버린다
      this.pending.delete(msg.taskId);
      if (msg.ok) p.resolve({ text: msg.text });
      else p.reject(providerError(msg.error?.code || 'ERROR', msg.error?.message || '자동화 오류'));
    } else if (msg.type === 'error' && msg.taskId) {
      const p = this.pending.get(msg.taskId);
      this.pending.delete(msg.taskId);
      p?.reject(providerError('BRIDGE_REJECTED', msg.message));
    }
  }

  refreshSites() {
    this._send({ type: 'check' });
  }

  async check(participantIds) {
    if (this.status.bridge !== 'connected') await this.connect();
    if (this.status.bridge !== 'connected') return { ok: false, error: this.status.error || '브리지 서버에 연결되지 않았습니다.' };
    if (!this.status.extension) return { ok: false, error: '확장 프로그램이 브리지에 연결되지 않았습니다. 확장 팝업에 토큰을 입력하세요.' };
    this.refreshSites();
    await new Promise((r) => setTimeout(r, 2500));
    const bad = participantIds
      .map((id) => [id, this.status.sites[id]?.state])
      .filter(([, s]) => SITE_BLOCKING[s]);
    if (bad.length) return { ok: false, error: `연결 불가: ${bad.map(([id, s]) => `${id}(${SITE_BLOCKING[s]})`).join(', ')}. 해당 탭에서 직접 해결하거나 참가자에서 빼세요.` };
    return { ok: true };
  }

  run(task, { signal, onProgress } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(providerError('CANCELLED', '취소됨'));
      this.pending.set(task.taskId, { resolve, reject, onProgress });
      const ok = this._send({ type: 'task', taskId: task.taskId, participantId: task.participantId, prompt: task.prompt, newChat: task.newChat, timeoutMs: task.timeoutMs });
      if (!ok) {
        this.pending.delete(task.taskId);
        reject(providerError('BRIDGE_DISCONNECTED', '브리지에 연결되지 않았습니다.'));
      }
      signal?.addEventListener('abort', () => {
        if (this.pending.delete(task.taskId)) reject(providerError('CANCELLED', '취소됨'));
      });
    });
  }

  cancel(taskId) {
    this._send({ type: 'cancel', taskId });
    const p = this.pending.get(taskId);
    this.pending.delete(taskId);
    p?.reject(providerError('CANCELLED', '취소됨'));
  }
}
