const $ = (id) => document.getElementById(id);
const LABEL = { connected: '브리지 연결됨', connecting: '연결 중…', disconnected: '연결 안 됨', auth_failed: '토큰 오류' };
const SITE_LABEL = { ready: '준비됨', login_required: '로그인 필요', not_ready: '준비 안 됨', busy: '응답 생성 중', blocked: '사람 확인 필요', no_tab: '탭 없음', error: '오류' };

async function load() {
  const s = await chrome.storage.local.get({ token: '', port: 8787 });
  $('token').value = s.token;
  $('port').value = s.port;
  refresh();
}

async function refresh() {
  $('state').textContent = '확인 중…';
  const r = await chrome.runtime.sendMessage({ kind: 'popup-status' });
  $('state').textContent = `${LABEL[r.state] || r.state}${r.lastError ? ` — ${r.lastError}` : ''}`;
  $('sites').innerHTML = '';
  for (const [site, v] of Object.entries(r.sites || {})) {
    const li = document.createElement('li');
    li.textContent = `${site}: ${SITE_LABEL[v.state] || v.state}${v.detail && v.state !== 'ready' ? ` (${v.detail})` : ''}`;
    $('sites').append(li);
  }
}

$('save').onclick = async () => {
  const token = $('token').value.trim();
  if (token && !/^[a-f0-9]{32}$/.test(token)) {
    $('state').textContent = '토큰 형식이 올바르지 않습니다(32자리 16진수).';
    return;
  }
  await chrome.storage.local.set({ token, port: Number($('port').value) || 8787 });
  await chrome.runtime.sendMessage({ kind: 'popup-reconnect' });
  setTimeout(refresh, 800);
};
$('refresh').onclick = refresh;
for (const b of document.querySelectorAll('[data-open]')) b.onclick = () => chrome.runtime.sendMessage({ kind: 'popup-open', site: b.dataset.open });
load();
