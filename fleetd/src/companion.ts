/**
 * FLEET-HUB-001 M1 — companion face ④: a single-file, mobile-friendly page
 * served by fleetd at GET /companion (token-authed like every route).
 *
 * Killer scenario (mobile design §1): 远程权限应答 — watch pending
 * permissions live (SSE /events) and answer allow/reject from any device on
 * the LAN, plus a read-only fleet status board. Zero dependencies; the page
 * asks for the hub token once and keeps it in localStorage.
 */
export function companionPageHtml(): string {
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>fleet companion</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; background: #0b0e14; color: #e6e9ef; padding-bottom: env(safe-area-inset-bottom); }
  header { position: sticky; top: 0; background: #0b0e14e6; backdrop-filter: blur(8px); padding: 12px 16px; border-bottom: 1px solid #1d2330; display: flex; justify-content: space-between; align-items: center; }
  header h1 { font-size: 16px; margin: 0; font-weight: 600; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #3fb950; margin-right: 6px; }
  .dot.off { background: #f85149; }
  main { padding: 16px; max-width: 640px; margin: 0 auto; display: grid; gap: 16px; }
  section { background: #11151d; border: 1px solid #1d2330; border-radius: 12px; padding: 14px; }
  section h2 { font-size: 13px; margin: 0 0 10px; color: #8b96a8; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
  .perm { border: 1px solid #2a3346; border-radius: 10px; padding: 12px; margin-bottom: 10px; }
  .perm .tool { font-weight: 600; }
  .perm .meta { color: #8b96a8; font-size: 13px; margin: 4px 0 10px; }
  .row { display: flex; gap: 10px; }
  button { flex: 1; border: 0; border-radius: 10px; padding: 12px; font-size: 15px; font-weight: 600; cursor: pointer; }
  button.allow { background: #238636; color: #fff; }
  button.reject { background: #3d1d20; color: #f85149; border: 1px solid #6e2a2e; }
  .empty { color: #8b96a8; text-align: center; padding: 8px 0; }
  .stat { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #1d2330; font-variant-numeric: tabular-nums; }
  .stat:last-child { border: 0; }
  .token-box input { width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #2a3346; background: #0b0e14; color: #e6e9ef; font: inherit; }
  .err { color: #f85149; font-size: 13px; margin-top: 6px; min-height: 1em; }
</style>
</head>
<body>
<header><h1><span class="dot" id="conn"></span>fleet companion</h1><span id="clock" style="color:#8b96a8;font-size:13px"></span></header>
<main>
  <section id="tokenBox" class="token-box" hidden>
    <h2>连接 fleetd</h2>
    <input id="token" placeholder="粘贴 fleetd token（发现文件 ~/.local/state/fleet/fleetd.json）" autocomplete="off">
    <div class="err" id="tokenErr"></div>
  </section>
  <section>
    <h2>待应答权限</h2>
    <div id="perms"><div class="empty">加载中…</div></div>
  </section>
  <section>
    <h2>舰队状态</h2>
    <div id="stats"><div class="empty">…</div></div>
  </section>
</main>
<script>
const $ = (id) => document.getElementById(id);
let token = localStorage.getItem('fleetd_token') || '';
let es = null;

function fmtTime(ts) { return ts ? new Date(ts).toLocaleTimeString() : '--'; }

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'x-secret-key': token, ...(opts.headers || {}) } });
  if (res.status === 401) throw new Error('token 无效');
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function refreshStatus() {
  try {
    const s = await api('/status');
    const n = await api('/nodes');
    $('conn').classList.remove('off');
    $('stats').innerHTML =
      '<div class="stat"><span>fleetd</span><span>v' + s.version + '</span></div>' +
      '<div class="stat"><span>节点</span><span>' + n.nodes.length + ' (' + n.nodes.map(x => x.driver).join(', ') + ')</span></div>' +
      '<div class="stat"><span>派发</span><span>' + s.counters.dispatches + '（失败 ' + s.counters.dispatchFailures + '）</span></div>' +
      '<div class="stat"><span>权限：已答 / 过期</span><span>' + (s.counters.dispatches >= 0 ? answered + ' / ' + expired : '') + '</span></div>' +
      '<div class="stat"><span>启动于</span><span>' + fmtTime(s.startedAt) + '</span></div>';
  } catch (e) { $('conn').classList.add('off'); }
}
let answered = 0, expired = 0;

function renderPerms(list) {
  const box = $('perms');
  if (!list.length) { box.innerHTML = '<div class="empty">无待应答权限</div>'; return; }
  box.innerHTML = '';
  for (const p of list) {
    const el = document.createElement('div');
    el.className = 'perm';
    el.innerHTML = '<div class="tool">' + (p.toolName || '工具调用') + '</div>' +
      '<div class="meta">' + p.node + ' · 会话 ' + String(p.sessionId).slice(0, 8) + ' · ' + Math.round((p.deadlineMs - (Date.now() - p.receivedAt)) / 1000) + 's 后过期</div>' +
      '<div class="row"><button class="allow">允许</button><button class="reject">拒绝</button></div>';
    el.querySelector('.allow').onclick = () => answer(p.id, 'allow');
    el.querySelector('.reject').onclick = () => answer(p.id, 'reject');
    box.appendChild(el);
  }
}

async function answer(id, kind) {
  try {
    await api('/permissions/' + id + '/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(kind === 'allow'
        ? { outcome: 'selected', optionId: firstAllowId(id) || 'allow' }
        : { outcome: 'cancelled' }),
    });
    refreshPerms();
  } catch (e) { alert('应答失败: ' + e.message); }
}
function firstAllowId(id) {
  const p = pendingCache.find((x) => x.id === id);
  const allow = p && p.options && p.options.find((o) => (o.kind || '').startsWith('allow'));
  return allow ? allow.optionId : '';
}
let pendingCache = [];
async function refreshPerms() {
  try { pendingCache = (await api('/permissions')).pending || []; renderPerms(pendingCache); }
  catch (e) { /* token flow handles */ }
}

function openEvents() {
  if (es) es.close();
  es = new EventSource('/events');
  // EventSource cannot set headers; fleetd also accepts ?token= for SSE.
  // We reconnect with query auth below instead when 401 fires.
  es.onmessage = () => {};
  es.addEventListener('permission_pending', refreshPerms);
  es.addEventListener('permission_settled', refreshPerms);
  es.onerror = () => { es.close(); es = null; setTimeout(openEventsSSE, 3000); };
}
function openEventsSSE() {
  if (es) es.close();
  es = new EventSource('/events?token=' + encodeURIComponent(token));
  es.addEventListener('permission_pending', refreshPerms);
  es.addEventListener('permission_settled', refreshPerms);
  es.onerror = () => { $('conn').classList.add('off'); };
}

function boot() {
  if (!token) { $('tokenBox').hidden = false; $('token').focus(); return; }
  start();
}
function start() {
  $('tokenBox').hidden = true;
  refreshPerms(); refreshStatus(); openEventsSSE();
  setInterval(refreshPerms, 5000);
  setInterval(refreshStatus, 15000);
  setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString(); }, 1000);
}
$('token').addEventListener('change', async () => {
  token = $('token').value.trim();
  try {
    await api('/status');
    localStorage.setItem('fleetd_token', token);
    $('tokenErr').textContent = '';
    start();
  } catch (e) { $('tokenErr').textContent = '连接失败：' + e.message; }
});
boot();
</script>
</body>
</html>`;
}
