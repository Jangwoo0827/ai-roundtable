// 작은 DOM 생성 도우미. AI 응답은 신뢰할 수 없는 텍스트이므로 innerHTML 대신 textContent로만 넣는다.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'value') el.value = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const fmtTime = (t) => (t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');

export async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const old = btn.textContent;
      btn.textContent = '복사됨';
      setTimeout(() => (btn.textContent = old), 1200);
    }
  } catch {
    prompt('복사할 내용:', text);
  }
}

export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const STATUS_LABEL = {
  queued: '대기열',
  pending: '응답 대기 중',
  responding: '응답 중',
  awaiting: '붙여넣기 대기',
  done: '완료',
  failed: '오류',
  excluded: '제외됨',
};

export const DEBATE_LABEL = {
  idle: '준비',
  connecting: '연결 확인 중',
  running: '진행 중',
  paused: '일시 정지',
  waiting: '조치 필요',
  completed: '완료',
  failed: '실패',
  cancelled: '종료됨',
};
