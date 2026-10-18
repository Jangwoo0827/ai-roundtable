// Gemini (gemini.google.com) 어댑터. Quill 기반 rich-textarea 입력창과 <model-response> 요소를 사용한다.
(() => {
  const { createAdapter, textOf } = globalThis.__RT;
  globalThis.__RT.adapters.gemini = createAdapter({
    id: 'gemini',
    inputSelectors: [
      'rich-textarea div[contenteditable="true"][role="textbox"]',
      'rich-textarea .ql-editor[contenteditable="true"]',
      'div[contenteditable="true"][aria-label*="prompt" i]',
      'div[contenteditable="true"][aria-label*="프롬프트"]',
    ],
    sendSelectors: ['button[aria-label*="Send message" i]', 'button[aria-label*="메시지 보내기"]', 'button.send-button:not([aria-disabled="true"])'],
    sendNames: [/^send message/i, /메시지 보내기/, /^보내기$/],
    stopSelectors: ['button[aria-label*="Stop response" i]', 'button[aria-label*="대답 생성 중지"]', 'button[aria-label*="응답 중지"]'],
    stopNames: [/stop response/i, /생성 중지/, /응답 중지/],
    responseSelectors: ['model-response message-content', 'model-response .model-response-text', 'model-response'],
    extractText: (el) => textOf(el.querySelector('.markdown') || el),
    isStreaming: () => !!document.querySelector('model-response [aria-busy="true"], .response-container-content .loading, pending-request'),
    isLoggedOut: () =>
      !!document.querySelector('a[href*="accounts.google.com/ServiceLogin"], a[href*="accounts.google.com/v3/signin"]') &&
      !document.querySelector('a[href*="accounts.google.com/SignOutOptions"], img.gb_P, [aria-label*="Google Account" i], [aria-label*="Google 계정"]'),
    lineByLine: true,
    stableMs: 3000,
  });
})();
