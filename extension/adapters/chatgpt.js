// ChatGPT (chatgpt.com) 어댑터. ProseMirror 입력창(#prompt-textarea)과
// data-message-author-role="assistant" 메시지를 사용한다.
(() => {
  const { createAdapter, textOf } = globalThis.__RT;
  globalThis.__RT.adapters.chatgpt = createAdapter({
    id: 'chatgpt',
    inputSelectors: ['#prompt-textarea[contenteditable="true"]', 'div[contenteditable="true"]#prompt-textarea', 'textarea#prompt-textarea', 'form div[contenteditable="true"][role="textbox"]'],
    sendSelectors: ['button[data-testid="send-button"]', '#composer-submit-button', 'button[aria-label="Send prompt"]', 'button[aria-label*="프롬프트 보내기"]'],
    sendNames: [/send prompt/i, /프롬프트 보내기/, /^send$/i],
    stopSelectors: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop streaming" i]', 'button[aria-label*="스트리밍 중지"]'],
    stopNames: [/stop streaming/i, /스트리밍 중지/, /^stop$/i],
    responseSelectors: ['[data-message-author-role="assistant"]'],
    extractText: (el) => textOf(el.querySelector('.markdown') || el),
    isStreaming: () => !!document.querySelector('[data-message-author-role="assistant"] .result-streaming, .result-thinking'),
    isLoggedOut: () => !!document.querySelector('[data-testid="login-button"], [data-testid="signup-button"], a[href*="/auth/login"]'),
    stableMs: 2500,
  });
})();
