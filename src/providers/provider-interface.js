// 제공자 공통 인터페이스. 엔진은 이 형태만 알고 실제 전달 방식(수동/브리지)은 모른다.
//
//   manual?: boolean                         true면 엔진이 호출하지 않고 사용자의 붙여넣기를 기다린다
//   check(participantIds) => Promise<{ ok: boolean, error?: string }>
//   run(task, { signal, onProgress }) => Promise<{ text: string }>
//       task = { taskId, debateId, participantId, prompt, newChat, timeoutMs }
//       실패 시 Error(code 포함)로 거부한다. 응답을 꾸며 내지 않는다.
//   cancel(taskId) => void

export function assertProvider(p) {
  if (p.manual) return p;
  for (const k of ['check', 'run', 'cancel']) if (typeof p[k] !== 'function') throw new Error(`provider.${k} 가 없습니다.`);
  return p;
}

export function providerError(code, message) {
  return Object.assign(new Error(message), { code });
}
