// ChatGPT (chatgpt.com) 어댑터. ProseMirror 입력창과 assistant 메시지 블록을 사용한다.
// 2026-10 기준 UI: 입력창에 #prompt-textarea id가 없고, 응답은 data-content-search-unit-key="…:assistant…"
// 단위 안의 [data-markdown-copy] 블록에 있으며, 턴 상태는 data-talvt-turn-state로 표시된다.
(() => {
  const { createAdapter, textOf } = globalThis.__RT;
  globalThis.__RT.adapters.chatgpt = createAdapter({
    id: 'chatgpt',
    inputSelectors: [
      '#prompt-textarea[contenteditable="true"]',
      'textarea#prompt-textarea',
      'form div[contenteditable="true"][role="textbox"]',
      'div.ProseMirror[contenteditable="true"][role="textbox"]',
    ],
    sendSelectors: ['button[data-testid="send-button"]', '#composer-submit-button', 'button[aria-label="Send prompt"]', 'button[aria-label*="프롬프트 보내기"]', 'button[aria-label="보내기"]'],
    sendNames: [/send prompt/i, /프롬프트 보내기/, /^send$/i, /^보내기$/],
    stopSelectors: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop streaming" i]', 'button[aria-label*="스트리밍 중지"]'],
    stopNames: [/stop streaming/i, /스트리밍 중지/, /^stop$/i, /^중지$/],
    responseSelectors: ['[data-message-author-role="assistant"]', '[data-content-search-unit-key*=":assista"]'],
    extractText: (el) => {
      const blocks = [...el.querySelectorAll('[data-markdown-copy], .markdown')];
      return blocks.length ? blocks.map(textOf).filter(Boolean).join('\n\n') : textOf(el);
    },
    isStreaming: () =>
      !!document.querySelector('[data-message-author-role="assistant"] .result-streaming, .result-thinking, [data-talvt-turn-state]:not([data-talvt-turn-state="complete"])'),
    isLoggedOut: () => !!document.querySelector('[data-testid="login-button"], [data-testid="signup-button"], a[href*="/auth/login"]'),
    stableMs: 2500,
  });
})();
