// 브리지 메시지 형식과 검증. 웹사이트나 확장 프로그램에서 온 메시지는 모두 여기서 검사한다.
export const PROTOCOL_VERSION = 1;
export const SITES = ['gemini', 'chatgpt', 'claude'];
export const MAX_MESSAGE_BYTES = 256 * 1024;
export const MAX_PROMPT_CHARS = 60_000;
export const MAX_RESULT_CHARS = 100_000;
export const MIN_TIMEOUT_MS = 10_000;
export const MAX_TIMEOUT_MS = 15 * 60_000;

const ID_RE = /^[A-Za-z0-9_#:.-]{1,120}$/;

export function parse(raw) {
  if (typeof raw !== 'string' && !(raw instanceof Buffer)) throw new Error('bad frame');
  const s = raw.toString();
  if (Buffer.byteLength(s) > MAX_MESSAGE_BYTES) throw new Error('message too large');
  const msg = JSON.parse(s);
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') throw new Error('bad message');
  return msg;
}

const str = (v, max) => typeof v === 'string' && v.length <= max;
const err = (m) => { throw new Error(m); };

// 웹사이트 → 브리지
export function validateFromWeb(msg) {
  switch (msg.type) {
    case 'hello':
    case 'ping':
    case 'check':
      return msg;
    case 'task': {
      if (!ID_RE.test(msg.taskId ?? '')) err('invalid taskId');
      if (!SITES.includes(msg.participantId)) err('invalid participant');
      if (!str(msg.prompt, MAX_PROMPT_CHARS) || !msg.prompt.trim()) err('invalid prompt');
      const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Number(msg.timeoutMs) || 240_000));
      return { type: 'task', taskId: msg.taskId, participantId: msg.participantId, prompt: msg.prompt, newChat: msg.newChat === true, timeoutMs };
    }
    case 'cancel':
      if (!ID_RE.test(msg.taskId ?? '')) err('invalid taskId');
      return { type: 'cancel', taskId: msg.taskId };
    default:
      err(`unknown type ${msg.type}`);
  }
}

// 확장 프로그램 → 브리지
export function validateFromExtension(msg) {
  switch (msg.type) {
    case 'hello':
    case 'ping':
    case 'pong':
      return msg;
    case 'sites': {
      const sites = {};
      for (const s of SITES) {
        const v = msg.sites?.[s];
        if (v) sites[s] = { state: str(v.state, 40) ? v.state : 'unknown', detail: str(v.detail, 500) ? v.detail : '' };
      }
      return { type: 'sites', sites, requestId: str(msg.requestId, 80) ? msg.requestId : undefined };
    }
    case 'progress':
      if (!ID_RE.test(msg.taskId ?? '')) err('invalid taskId');
      return { type: 'progress', taskId: msg.taskId, state: str(msg.state, 40) ? msg.state : 'responding', preview: str(msg.preview, 2000) ? msg.preview : '' };
    case 'result': {
      if (!ID_RE.test(msg.taskId ?? '')) err('invalid taskId');
      const ok = msg.ok === true;
      if (ok && (!str(msg.text, MAX_RESULT_CHARS) || !msg.text.trim())) err('invalid text');
      const error = ok ? null : {
        code: str(msg.error?.code, 40) ? msg.error.code : 'ERROR',
        message: str(msg.error?.message, 1000) ? msg.error.message : '알 수 없는 오류',
        retryable: msg.error?.retryable === true,
      };
      return { type: 'result', taskId: msg.taskId, ok, text: ok ? msg.text : undefined, error };
    }
    default:
      err(`unknown type ${msg.type}`);
  }
}
