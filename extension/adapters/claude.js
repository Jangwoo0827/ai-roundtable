// Claude (claude.ai) 어댑터. ProseMirror 입력창과 data-is-streaming 속성이 있는 응답 블록을 사용한다.
(() => {
  const { createAdapter, textOf } = globalThis.__RT;
  globalThis.__RT.adapters.claude = createAdapter({
    id: 'claude',
    inputSelectors: [
      'div[contenteditable="true"][data-testid="chat-input"]',
      'fieldset div.ProseMirror[contenteditable="true"]',
      'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][aria-label*="Claude" i]',
    ],
    sendSelectors: ['button[aria-label="Send message"]', 'button[aria-label="Send Message"]', 'button[aria-label*="메시지 보내기"]'],
    sendNames: [/^send message$/i, /메시지 보내기/],
    stopSelectors: ['button[aria-label="Stop response"]', 'button[aria-label*="응답 중지"]'],
    stopNames: [/stop response/i, /응답 중지/],
    // 사용자 메시지에는 data-is-streaming이 없고, Claude 응답 컨테이너에만 붙는다.
    responseSelectors: ['div[data-is-streaming]', '.font-claude-response', '.font-claude-message'],
    extractText: (el) => textOf(el.querySelector('.font-claude-response, .font-claude-message, .standard-markdown, .progressive-markdown') || el),
    isStreaming: () => !!document.querySelector('div[data-is-streaming="true"]'),
    isLoggedOut: () => /^\/(login|signup|logout)/.test(location.pathname) || !!document.querySelector('a[href="/login"], button[data-testid="login-button"]'),
    stableMs: 2500,
  });
})();
