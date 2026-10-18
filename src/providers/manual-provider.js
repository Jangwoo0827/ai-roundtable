// 수동 모드: 엔진은 프롬프트를 만들고, 사용자가 공식 사이트에 붙여넣은 뒤 답변을 다시 붙여넣는다.
export const manualProvider = {
  manual: true,
  async check() {
    return { ok: true };
  },
  run() {
    throw new Error('수동 모드에서는 자동 전송을 하지 않습니다.');
  },
  cancel() {},
};
