// 탭 안에서 background의 명령을 받아 사이트 어댑터를 실행한다.
(() => {
  if (globalThis.__RT_RUNNER) return;
  globalThis.__RT_RUNNER = true;

  const host = location.hostname;
  const site = host === 'gemini.google.com' ? 'gemini' : host === 'chatgpt.com' ? 'chatgpt' : host === 'claude.ai' ? 'claude' : null;
  const adapter = site && globalThis.__RT.adapters[site];
  const jobs = new Map(); // taskId -> AbortController

  const errOut = (e) => ({ ok: false, error: { code: e.code || 'ERROR', message: e.message || String(e), retryable: !!e.retryable } });

  async function run({ taskId, prompt, timeoutMs }) {
    if (!adapter) return { ok: false, error: { code: 'UNSUPPORTED_SITE', message: '지원하지 않는 사이트입니다.' } };
    if (jobs.size) return { ok: false, error: { code: 'BUSY', message: '이 탭에서 다른 작업이 진행 중입니다.', retryable: true } };
    const ac = new AbortController();
    jobs.set(taskId, ac);
    const progress = (p) => chrome.runtime.sendMessage({ kind: 'rt-progress', taskId, ...p }).catch(() => {});
    try {
      const conn = adapter.checkConnection();
      if (conn.state === 'login_required') return { ok: false, error: { code: 'NOT_LOGGED_IN', message: conn.detail } };
      if (conn.state === 'blocked') return { ok: false, error: { code: 'BLOCKED', message: conn.detail } };
      progress({ state: 'sending' });
      await adapter.sendMessage(prompt, { signal: ac.signal });
      progress({ state: 'responding' });
      await adapter.waitForResponse({ timeout: timeoutMs, signal: ac.signal, onProgress: progress });
      const text = adapter.readLatestResponse();
      return { ok: true, text };
    } catch (e) {
      if (e.code === 'CANCELLED') {
        try { adapter.cancelResponse(); } catch {}
      }
      return errOut(e);
    } finally {
      jobs.delete(taskId);
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.kind === 'rt-ping') {
      reply({ ok: true, site });
      return;
    }
    if (msg?.kind === 'rt-check') {
      reply(adapter ? adapter.checkConnection() : { state: 'unsupported', detail: '' });
      return;
    }
    if (msg?.kind === 'rt-run') {
      run(msg).then(reply);
      return true; // 비동기 응답
    }
    if (msg?.kind === 'rt-cancel') {
      jobs.get(msg.taskId)?.abort();
      reply({ ok: true });
    }
  });
})();
