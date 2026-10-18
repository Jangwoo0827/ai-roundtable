// 세 어댑터가 공유하는 DOM 도우미. 접근성 속성·역할·버튼 이름을 우선하고
// 클래스 하나에만 기대지 않도록 여러 후보 선택자를 순서대로 시도한다.
(() => {
  if (globalThis.__RT) return;

  class AdapterError extends Error {
    constructor(code, message, retryable = false) {
      super(message);
      this.code = code;
      this.retryable = retryable;
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  }

  function first(selectors, root = document) {
    for (const sel of selectors) {
      for (const el of root.querySelectorAll(sel)) if (visible(el)) return el;
    }
    return null;
  }

  function all(selectors, root = document) {
    for (const sel of selectors) {
      const list = [...root.querySelectorAll(sel)];
      if (list.length) return list;
    }
    return [];
  }

  // 버튼 이름(aria-label, title, 텍스트)으로 찾는다. 한국어/영어 UI 모두 대응.
  function buttonByName(patterns, root = document) {
    for (const b of root.querySelectorAll('button, [role="button"]')) {
      if (!visible(b)) continue;
      const name = `${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''} ${b.getAttribute('data-testid') || ''} ${b.textContent || ''}`.trim();
      if (patterns.some((p) => p.test(name))) return b;
    }
    return null;
  }

  async function waitFor(fn, { timeout = 15000, interval = 250, signal } = {}) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (signal?.aborted) throw new AdapterError('CANCELLED', '취소되었습니다.');
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  // ProseMirror(ChatGPT·Claude), Quill(Gemini), textarea 모두에서 동작하도록 사용자 입력과 같은 경로로 넣는다.
  async function insertText(el, text) {
    el.focus();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const sel = getSelection();
    sel.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.addRange(range);
    document.execCommand('delete');
    // insertText는 편집기의 입력 처리(beforeinput)를 그대로 거친다.
    let ok = document.execCommand('insertText', false, text);
    await sleep(150);
    if (!ok || !el.textContent.trim()) {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      await sleep(150);
    }
    const norm = (s) => s.replace(/\s+/g, '');
    if (!norm(el.innerText || el.textContent || '').includes(norm(text).slice(0, 40))) {
      throw new AdapterError('INPUT_FAILED', '입력창에 프롬프트를 넣지 못했습니다. 사이트 구조가 바뀌었을 수 있습니다.');
    }
  }

  function textOf(el) {
    if (!el) return '';
    return (el.innerText || el.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  // 사이트가 자동화를 막거나 로그인·사람 확인을 요구하는지 확인한다. 우회하지 않고 중단한다.
  function detectBlock() {
    if (document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="recaptcha"], #challenge-form, [id*="captcha" i]')) {
      return new AdapterError('BLOCKED', '사람 확인(CAPTCHA)이 표시되었습니다. 해당 탭에서 직접 확인한 뒤 다시 시도하세요.');
    }
    const body = (document.body?.innerText || '').slice(0, 20000);
    if (/too many requests|rate limit|usage limit|you've reached|한도에 도달|사용량 한도|잠시 후 다시/i.test(body.slice(-4000))) {
      return new AdapterError('RATE_LIMITED', '사이트에서 사용량 한도 또는 요청 제한을 표시했습니다. 직접 확인 후 진행하세요.');
    }
    return null;
  }

  // 응답이 생성 중인지(stop 버튼 등)와 텍스트 안정 여부를 함께 보고 완료를 판정한다.
  async function waitForCompletion({ isGenerating, readText, timeout, signal, onProgress, stableMs = 2500, startTimeout = 60000 }) {
    const start = Date.now();
    let last = '';
    let lastChange = Date.now();
    let started = false;
    let lastReport = 0;
    while (true) {
      if (signal?.aborted) throw new AdapterError('CANCELLED', '취소되었습니다.');
      if (Date.now() - start > timeout) throw new AdapterError('TIMEOUT', '응답 생성 완료를 제한 시간 안에 확인하지 못했습니다.', false);
      const block = detectBlock();
      if (block && block.code === 'BLOCKED') throw block;
      const gen = isGenerating();
      const t = readText();
      if (t !== last) {
        last = t;
        lastChange = Date.now();
      }
      if (gen || t) started = true;
      if (!started && Date.now() - start > startTimeout) {
        throw block || new AdapterError('NO_RESPONSE', '전송 후 응답이 시작되지 않았습니다.', true);
      }
      if (started && Date.now() - lastReport > 1500) {
        lastReport = Date.now();
        onProgress?.({ state: 'responding', preview: t.slice(-300) });
      }
      if (started && !gen && t && Date.now() - lastChange >= stableMs) return t;
      await sleep(400);
    }
  }

  // 사이트별 설정으로 공통 인터페이스(checkConnection/sendMessage/waitForResponse/readLatestResponse/cancelResponse)를 만든다.
  // 각 사이트 어댑터 파일이 선택자와 판정 함수를 직접 정의한다.
  function createAdapter(spec) {
    let baseline = { count: 0, lastText: '' };
    const responses = () => all(spec.responseSelectors).filter((el) => !spec.ignoreResponse?.(el));
    const latestEl = () => responses().at(-1) ?? null;
    const readLatest = () => (latestEl() ? (spec.extractText ? spec.extractText(latestEl()) : textOf(latestEl())) : '');
    const input = () => first(spec.inputSelectors);
    const stopButton = () => first(spec.stopSelectors || []) || (spec.stopNames ? buttonByName(spec.stopNames) : null);
    const isGenerating = () => !!stopButton() || !!spec.isStreaming?.();
    const sendButton = () => first(spec.sendSelectors || []) || buttonByName(spec.sendNames || []);

    return {
      id: spec.id,
      checkConnection() {
        const block = detectBlock();
        if (block?.code === 'BLOCKED') return { state: 'blocked', detail: block.message };
        if (spec.isLoggedOut?.()) return { state: 'login_required', detail: '로그인이 필요합니다. 이 탭에서 직접 로그인하세요.' };
        if (!input()) return { state: 'not_ready', detail: '입력창을 찾지 못했습니다. 페이지 로딩 중이거나 구조가 바뀌었을 수 있습니다.' };
        if (isGenerating()) return { state: 'busy', detail: '이전 응답을 생성 중입니다.' };
        return { state: 'ready', detail: '연결됨' };
      },
      async sendMessage(prompt, { signal } = {}) {
        const box = await waitFor(input, { timeout: 20000, signal });
        if (!box) throw new AdapterError(spec.isLoggedOut?.() ? 'NOT_LOGGED_IN' : 'INPUT_NOT_FOUND', spec.isLoggedOut?.() ? '로그인이 필요합니다.' : '입력창을 찾지 못했습니다.', !spec.isLoggedOut?.());
        if (isGenerating()) throw new AdapterError('BUSY', '이전 응답이 아직 생성 중입니다.', true);
        baseline = { count: responses().length, lastText: readLatest() };
        await insertText(box, prompt);
        const btn = await waitFor(() => {
          const b = sendButton();
          return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' ? b : null;
        }, { timeout: 8000, signal });
        if (btn) btn.click();
        else box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        const sent = await waitFor(() => isGenerating() || responses().length > baseline.count || !textOf(input()), { timeout: 15000, signal });
        if (!sent) {
          const block = detectBlock();
          if (block) throw block;
          throw new AdapterError('SEND_FAILED', '전송 버튼을 누르지 못했거나 사이트가 전송을 거부했습니다.', true);
        }
        return { ok: true };
      },
      async waitForResponse({ timeout = 240000, signal, onProgress } = {}) {
        const text = await waitForCompletion({
          isGenerating,
          readText: () => (responses().length > baseline.count ? readLatest() : ''),
          timeout,
          signal,
          onProgress,
          stableMs: spec.stableMs ?? 2500,
        });
        return text;
      },
      readLatestResponse() {
        if (responses().length <= baseline.count) throw new AdapterError('NO_RESPONSE', '새 응답을 찾지 못했습니다.');
        const t = readLatest();
        if (!t) throw new AdapterError('NO_RESPONSE', '응답 텍스트가 비어 있습니다.');
        return t;
      },
      cancelResponse() {
        const b = stopButton();
        if (!b) throw new AdapterError('NOT_SUPPORTED', '중지 버튼을 찾지 못해 생성을 중단할 수 없습니다.');
        b.click();
        return { ok: true };
      },
      _debug: () => ({ input: !!input(), send: !!sendButton(), stop: !!stopButton(), responses: responses().length, baseline }),
    };
  }

  globalThis.__RT = { createAdapter, AdapterError, sleep, visible, first, all, buttonByName, waitFor, insertText, textOf, detectBlock, waitForCompletion, adapters: {} };
})();
