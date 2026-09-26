/* Pocket Code client — hash router: #/ sessions · #/chat/<id> · #/new */
'use strict';
const $ = sel => document.querySelector(sel);
const app = $('#app');

/* ---------- drawn icons (1.8px stroke, round caps) ---------- */
const IC = {
  back: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  plus: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  up: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V6M6 12l6-6 6 6"/></svg>',
  term: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7l4 5-4 5M12 17h7"/></svg>',
  doc: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7zM14 3v4h4"/></svg>',
  globe: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c-5 5.7-5 11.3 0 17 5-5.7 5-11.3 0-17z"/></svg>',
  cog: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 4v2.4M12 17.6V20M4 12h2.4M17.6 12H20M6.3 6.3l1.7 1.7M16 16l1.7 1.7M17.7 6.3L16 8M8 16l-1.7 1.7"/></svg>',
  folder: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2.5h9v10h-17z"/></svg>',
  clip: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5l-8.3 8.3a5 5 0 01-7-7L13 4.5a3.4 3.4 0 014.8 4.8L9.7 17.4a1.8 1.8 0 01-2.5-2.5L15 7.2"/></svg>',
  stop: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
  x: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  gauge: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14a8 8 0 0116 0M12 14l3.5-4.5"/><circle cx="12" cy="14" r="1.6"/></svg>',
  bell: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10a6 6 0 0112 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6zM10 19.5a2.2 2.2 0 004 0"/></svg>',
  bellOff: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10a6 6 0 0112 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6zM10 19.5a2.2 2.2 0 004 0M4 4l16 16"/></svg>',
  search: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  panel: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/></svg>',
  model: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 2.5v2.5M15 2.5v2.5M9 19v2.5M15 19v2.5M2.5 9h2.5M2.5 15h2.5M19 9h2.5M19 15h2.5"/></svg>',
  copy: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15 6.5V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7a2 2 0 002 2h.5"/></svg>',
  tick: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  up1: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14l6-6 6 6"/></svg>',
  down1: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10l6 6 6-6"/></svg>',
  diff: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7zM14 3v4h4M10.5 10.5h4M12.5 8.5v4M10.5 16h4"/></svg>',
  pin: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 3.5h7M10 3.5l-.6 6L6 12.5V14h12v-1.5L14.6 9.5l-.6-6M12 14v6.5"/></svg>',
  pen: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l.9-3.9L16 5a2.1 2.1 0 013 3L7.9 19.1 4 20zM13.8 7.2l3 3"/></svg>',
};

/* ---------- per-turn options: model / effort / attachments ---------- */
// Claude's list lives on the server (server.mjs CLAUDE_MODELS) so a new model is a
// one-line server change; this copy is only the offline fallback until it loads.
let MODELS = [
  ['default', 'Default', 'Your global setting'],
  ['claude-fable-5-1[1m]', 'Fable 5.1', 'Top tier · 1M context'],
  ['claude-opus-5-5[1m]', 'Opus 5.5', 'Strong + cheaper than Fable · 1M'],
  ['claude-sonnet-5', 'Sonnet 5', 'Fast, near-Opus on coding'],
  ['claude-haiku-4-5', 'Haiku 4.5', 'Fastest, light tasks'],
];
let claudeModelsLoaded = false;
async function loadClaudeModels() {
  if (claudeModelsLoaded) return MODELS;
  try {
    const { models, defaultLabel } = await api('/claude/models');
    if (models?.length) {
      MODELS = [['default', 'Default', `${defaultLabel || 'Global'} · your global setting`],
        ...models.map(m => [m.id, m.label || m.id, m.sub || ''])];
      claudeModelsLoaded = true;
    }
  } catch { }
  return MODELS;
}
// per-session picks saved under retired ids carry forward to their successor
const LEGACY_MODELS = { 'claude-opus-5': 'claude-opus-5-5[1m]', 'claude-fable-5': 'claude-fable-5-1[1m]' };
// Codex advertises its own models; fetched once and cached so the picker in a Codex
// session offers real options instead of Claude's list.
let CODEX_MODELS = [['default', 'Default', 'Your Codex config']];
async function loadCodexModels() {
  if (CODEX_MODELS.length > 1) return CODEX_MODELS;
  try {
    const { models } = await api('/codex/models');
    if (models?.length) {
      CODEX_MODELS = [['default', 'Default', 'Your Codex config'],
        ...models.slice(0, 8).map(m => [m.id, m.label || m.id, ''])];
    }
  } catch { }
  return CODEX_MODELS;
}
const modelList = () => (tb?.provider === 'codex' ? CODEX_MODELS : MODELS);
const EFFORTS = [
  ['default', 'Max', 'Your global default'],
  ['xhigh', 'X-High', 'Slightly leaner than max'],
  ['high', 'High', 'Balanced'],
  ['medium', 'Medium', 'Quicker, cheaper'],
  ['low', 'Low', 'Snappy, simple tasks'],
];
function getPrefs(key) {
  try {
    const p = { model: 'default', effort: 'default', ...JSON.parse(localStorage.getItem('pc-prefs-' + key) || '{}') };
    if (LEGACY_MODELS[p.model]) p.model = LEGACY_MODELS[p.model];
    return p;
  }
  catch { return { model: 'default', effort: 'default' }; }
}
function setPrefs(key, p) { localStorage.setItem('pc-prefs-' + key, JSON.stringify(p)); }

function sheet(title, options, current, onPick) {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const sh = document.createElement('div'); sh.className = 'sheet';
  sh.innerHTML = `<h2>${esc(title)}</h2>` + options.map(([val, label, sub]) => `
    <button class="opt ${val === current ? 'sel' : ''}" data-v="${esc(val)}">
      <span class="dot"></span><span>${esc(label)}<span class="sub">${esc(sub)}</span></span>
    </button>`).join('');
  const close = () => { scrim.remove(); sh.remove(); };
  scrim.onclick = close;
  sh.querySelectorAll('.opt').forEach(b => b.onclick = () => { onPick(b.dataset.v); close(); });
  document.body.append(scrim, sh);
}

/* Toolbar state shared by chat + new views */
let tb = null; // {key, prefs, attachments:[{path,name}], allowAttach}
function tbLabel(list, v) { return (list.find(o => o[0] === v) || list[0])[1]; }
function renderToolbar() {
  const bar = $('#tbar'); if (!bar || !tb) return;
  bar.innerHTML = `
    ${tb.allowAttach ? `<button class="chip" id="c-att" aria-label="Attach files">${IC.clip}Attach</button>` : ''}
    <button class="chip ${tb.prefs.model !== 'default' ? 'set' : ''}" id="c-model">${IC.model}${esc(tbLabel(modelList(), tb.prefs.model))}</button>
    <button class="chip ${tb.prefs.effort !== 'default' ? 'set' : ''}" id="c-eff">${IC.gauge}${esc(tbLabel(EFFORTS, tb.prefs.effort))}</button>
    ${tb.allowMute ? `<button class="chip ${chatMuted ? 'set' : ''}" id="c-mute" aria-label="Toggle notifications for this session">${chatMuted ? IC.bellOff : IC.bell}${chatMuted ? 'Muted' : 'Alerts'}</button>` : ''}`;
  const ar = $('#attrow');
  if (ar) {
    ar.innerHTML = tb.attachments.map((a, i) => `
      <span class="afile">${isImg(a.path)
        ? `<img class="athumb" src="/api/file?path=${encodeURIComponent(a.path)}" alt="">` : IC.clip}<span class="n">${esc(a.name)}</span>
        <button data-i="${i}" aria-label="Remove ${esc(a.name)}">${IC.x}</button></span>`).join('');
    ar.querySelectorAll('button').forEach(b => b.onclick = () => { tb.attachments.splice(Number(b.dataset.i), 1); renderToolbar(); });
  }
  const att = $('#c-att');
  if (att) att.onclick = () => $('#fpick').click();
  $('#c-model').onclick = () => sheet('Model for this turn', modelList(), tb.prefs.model,
    v => { tb.prefs.model = v; setPrefs(tb.key, tb.prefs); renderToolbar(); });
  $('#c-eff').onclick = () => sheet('Reasoning effort', EFFORTS, tb.prefs.effort,
    v => { tb.prefs.effort = v; setPrefs(tb.key, tb.prefs); renderToolbar(); });
  const mu = $('#c-mute');
  if (mu) mu.onclick = () => toggleMute();
}
/* ---------- session options: pin + rename (overlay metadata, server-side) ---------- */
function sessionSheet(s, refresh) { // s: {id, title, pinned}
  if (document.querySelector('.scrim')) return; // one sheet at a time
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const sh = document.createElement('div'); sh.className = 'sheet';
  sh.innerHTML = `
    <h2>${esc(s.title)}</h2>
    <button class="opt" id="so-pin">${IC.pin}<span>${s.pinned ? 'Unpin session' : 'Pin session'}<span class="sub">${s.pinned ? 'Back to its place by recency' : 'Keep it at the top of the list'}</span></span></button>
    <button class="opt" id="so-ren">${IC.pen}<span>Rename<span class="sub">Your title, on every device — clear it to go back to the automatic one</span></span></button>`;
  const close = () => { scrim.remove(); sh.remove(); };
  scrim.onclick = close;
  sh.querySelector('#so-pin').onclick = async () => {
    close();
    try {
      const r = await api(`/session/${s.id}/pin`, { method: 'POST', body: JSON.stringify({ pinned: !s.pinned }) });
      toast(r.pinned ? 'Pinned to the top' : 'Unpinned');
      refresh?.(r);
    } catch (e) { toast('Pin failed: ' + e.message); }
  };
  sh.querySelector('#so-ren').onclick = () => { close(); renameSheet(s, refresh); };
  document.body.append(scrim, sh);
}
function renameSheet(s, refresh) {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const sh = document.createElement('div'); sh.className = 'sheet';
  sh.innerHTML = `
    <h2>Rename session</h2>
    <input type="text" class="rename" id="rn" maxlength="120" placeholder="Session title" enterkeyhint="done" autocomplete="off">
    <button class="primary" id="rn-save">Save</button>`;
  const close = () => { scrim.remove(); sh.remove(); };
  scrim.onclick = close;
  const box = sh.querySelector('#rn');
  box.value = s.title === '(untitled session)' ? '' : s.title;
  const save = async () => {
    close();
    try {
      const r = await api(`/session/${s.id}/rename`, { method: 'POST', body: JSON.stringify({ name: box.value }) });
      toast(r.name ? 'Renamed' : 'Back to the automatic title');
      refresh?.(r);
    } catch (e) { toast('Rename failed: ' + e.message); }
  };
  sh.querySelector('#rn-save').onclick = save;
  box.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); save(); } };
  document.body.append(scrim, sh);
  box.focus(); box.select();
}
// long-press (touch) or right-click (desktop) opens the options sheet for a row
function wireRowMenu(el, getS, refresh) {
  let t = null, sx = 0, sy = 0, held = false;
  el.addEventListener('contextmenu', e => { e.preventDefault(); held = true; sessionSheet(getS(), refresh); });
  el.addEventListener('touchstart', e => {
    held = false; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    t = setTimeout(() => { held = true; sessionSheet(getS(), refresh); }, 500);
  }, { passive: true });
  el.addEventListener('touchmove', e => { // scrolling, not holding
    if (Math.hypot(e.touches[0].clientX - sx, e.touches[0].clientY - sy) > 12) clearTimeout(t);
  }, { passive: true });
  el.addEventListener('touchend', () => clearTimeout(t));
  el.addEventListener('touchcancel', () => clearTimeout(t));
  el.addEventListener('click', e => { // swallow the tap that ended the long-press
    if (held) { e.preventDefault(); e.stopImmediatePropagation(); held = false; }
  }, true);
}

/* per-session push mute — server-side, so it silences every device */
let chatMuted = false;
async function toggleMute() {
  try {
    const r = await api(`/session/${chatId}/mute`, { method: 'POST', body: JSON.stringify({ muted: !chatMuted }) });
    chatMuted = r.muted;
    toast(chatMuted ? 'Notifications muted for this session' : 'Notifications back on for this session');
    renderToolbar();
    const wb = $('#muteb'); if (wb) { wb.innerHTML = chatMuted ? IC.bellOff : IC.bell; wb.classList.toggle('on', chatMuted); }
  } catch (e) { toast('Mute failed: ' + e.message); }
}
async function uploadFiles(fileList) {
  for (const f of fileList) {
    if (f.size > 30 * 1024 * 1024) { toast(`${f.name} is over 30 MB`); continue; }
    try {
      const r = await fetch('/api/upload', { method: 'POST', headers: { 'x-filename': f.name, 'content-type': 'application/octet-stream' }, body: f });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      tb.attachments.push({ path: j.path, name: j.name });
    } catch (e) { toast('Upload failed: ' + e.message); }
  }
  renderToolbar();
}
function turnOpts() {
  if (!tb) return {};
  return {
    model: tb.prefs.model !== 'default' ? tb.prefs.model : undefined,
    effort: tb.prefs.effort !== 'default' ? tb.prefs.effort : undefined,
    attachments: tb.attachments.length ? tb.attachments.map(a => a.path) : undefined,
  };
}
function toolIcon(name) {
  if (/^(Bash|Skill)/.test(name)) return IC.term;
  if (/^(Read|Write|Edit|Notebook)/.test(name)) return IC.doc;
  if (/^(WebFetch|WebSearch)/.test(name)) return IC.globe;
  return IC.cog;
}

/* ---------- tiny helpers ---------- */
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// code block with its own copy affordance — selecting text on a touchscreen is miserable
const codeHTML = t => `<div class="codewrap"><button class="copybtn" data-copy aria-label="Copy code">${IC.copy}</button><pre><code>${esc(t)}</code></pre></div>`;
function md(src) { // minimal, safe markdown: fences, inline code, bold, links, lists, headings
  const out = [];
  const lines = src.split('\n');
  let i = 0, inFence = false, fence = [];
  const inline = t => esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  let list = null; // 'ul' | 'ol'
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (; i < lines.length; i++) {
    const L = lines[i];
    if (/^```/.test(L)) {
      if (inFence) { out.push(codeHTML(fence.join('\n'))); fence = []; }
      inFence = !inFence; continue;
    }
    if (inFence) { fence.push(L); continue; }
    // inline images: markdown image syntax, or a bare local image path on its own line
    const img = L.trim().match(/^!\[[^\]]*\]\((\S+)\)$/) || L.trim().match(/^(\/home\/\S+\.(?:png|jpe?g|gif|webp))$/i)
      || L.trim().match(/^`(\/home\/\S+\.(?:png|jpe?g|gif|webp))`$/i);
    if (img) {
      closeList();
      const src = /^https?:/.test(img[1]) ? img[1] : '/api/file?path=' + encodeURIComponent(img[1]);
      out.push(`<a href="${esc(src)}" target="_blank" rel="noopener"><img class="genimg" src="${esc(src)}" alt="image" loading="lazy"></a>`);
      continue;
    }
    const h = L.match(/^(#{1,4})\s+(.*)/);
    const ul = L.match(/^\s*[-*]\s+(.*)/);
    const ol = L.match(/^\s*\d+[.)]\s+(.*)/);
    if (h) { closeList(); out.push(`<h3>${inline(h[2])}</h3>`); }
    else if (ul) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(ul[1])}</li>`); }
    else if (ol) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(ol[1])}</li>`); }
    else if (!L.trim()) { closeList(); }
    else { closeList(); out.push(`<p>${inline(L)}</p>`); }
  }
  if (inFence && fence.length) out.push(codeHTML(fence.join('\n')));
  closeList();
  return out.join('');
}
function rel(ms) {
  const d = Date.now() - ms;
  if (d < 90e3) return 'just now';
  if (d < 3600e3) return `${Math.round(d / 60e3)}m ago`;
  if (d < 86400e3) return `${Math.round(d / 3600e3)}h ago`;
  if (d < 7 * 86400e3) return `${Math.round(d / 86400e3)}d ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
// home dir = /home/<user>, /Users/<user> or /root; shown as ~
const HOME_RE = /^\/(?:home\/[^/]+|Users\/[^/]+|root)(?=\/|$)/;
const projShort = cwd => !cwd ? '' : cwd.replace(HOME_RE, '~');
// list rows + chat tag show just the project folder name — the full path is noise there
// (search still matches the full path; the New screen still shows full paths)
const projName = cwd => !cwd ? '' : projShort(cwd) === '~' ? '~' : (cwd.split('/').pop() || cwd);
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200);
}
async function api(path, opts) {
  const r = await fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...opts });
  if (r.status === 401) { renderLogin(); throw new Error('login'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status });
  return j;
}

/* ---------- login ---------- */
function renderLogin() {
  app.innerHTML = `
    <div class="login">
      <h1>Pocket Code</h1>
      <p class="sub">Your Claude Code sessions, from anywhere.</p>
      <input type="password" id="pw" placeholder="Password" autocomplete="current-password" enterkeyhint="go">
      <p class="err" id="lerr"></p>
      <button class="primary" id="go">Unlock</button>
    </div>`;
  const go = async () => {
    try {
      await api('/login', { method: 'POST', body: JSON.stringify({ password: $('#pw').value }) });
      route();
    } catch (e) { $('#lerr').textContent = e.status === 429 ? 'Too many attempts — wait an hour.' : 'Wrong password.'; }
  };
  $('#go').onclick = go;
  $('#pw').onkeydown = e => { if (e.key === 'Enter') go(); };
  $('#pw').focus();
}

/* ---------- push notifications ---------- */
const urlB64 = s => {
  const pad = '='.repeat((4 - s.length % 4) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
};
async function pushState() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch { return null; }
}
async function togglePush(btn) {
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
      toast('Turn-finished notifications off');
    } else {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return toast('Notifications blocked — allow them for this site in Android settings');
      const { key } = await api('/push/key');
      if (!key) return toast('Push not configured on server');
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(key) });
      await api('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
      toast('You’ll get a notification when a turn finishes');
    }
    const now = await pushState();
    if (btn) { btn.innerHTML = now ? IC.bell : IC.bellOff; btn.classList.toggle('on', Boolean(now)); }
  } catch (e) { toast('Notification setup failed: ' + e.message); }
}

/* ---------- settings sheet (version, update check, chime, notifications) ---------- */
const APP_V = Number((document.querySelector('script[src*="app.js"]')?.src.match(/v=(\d+)/) || [])[1]) || null;
async function hardRefresh() {
  try {
    if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch { }
  location.reload();
}
async function settingsSheet() {
  let a = {}, srv = {};
  try { a = await api('/about'); } catch { }
  try { srv = await api('/settings'); } catch { }
  const stale = a.assetV && APP_V && a.assetV !== APP_V;
  const up = a.uptime ? (a.uptime > 90 * 60 ? Math.round(a.uptime / 3600) + 'h' : Math.round(a.uptime / 60) + 'm') : '?';
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const sh = document.createElement('div'); sh.className = 'sheet';
  const chimeOff = localStorage.getItem('pc-chime') === 'off';
  const pushed = await pushState();
  sh.innerHTML = `
    <h2>Pocket Code</h2>
    <div class="about">
      <div class="arow"><span>App</span><b>v${APP_V ?? '?'}</b></div>
      <div class="arow"><span>Server</span><b>v${a.assetV ?? '?'} · ${esc(a.commit || '?')}${a.commitAt ? ' · ' + new Date(a.commitAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</b></div>
      <div class="arow"><span>Claude CLI</span><b>${esc(a.cli || '?')}</b></div>
      <div class="arow"><span>Box</span><b>${esc(a.host || '?')} · up ${up}</b></div>
      ${stale ? `<button class="primary" id="s-refresh">Update available — refresh to v${a.assetV}</button>`
        : `<div class="arow ok"><span>Status</span><b>Up to date</b></div>`}
    </div>
    ${Array.isArray(a.notes) && a.notes.length ? `<div class="about whatsnew"><div class="arow"><span>What's new in v${a.assetV ?? APP_V ?? '?'}</span></div><ul>${a.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
    <button class="opt" id="s-chime"><span class="dot ${chimeOff ? '' : 'on'}"></span><span>Completion chime<span class="sub">Two-note blip when a turn finishes on screen</span></span></button>
    <button class="opt" id="s-push"><span class="dot ${pushed ? 'on' : ''}"></span><span>Turn notifications<span class="sub">Push to this device when a turn finishes</span></span></button>
    <button class="opt" id="s-sync"><span class="dot ${srv.titleSync ? 'on' : ''}"></span><span>Sync names with code-server<span class="sub">Session names follow Claude Code's titles, and renames here show there too</span></span></button>`;
  const close = () => { scrim.remove(); sh.remove(); };
  scrim.onclick = close;
  const r = sh.querySelector('#s-refresh'); if (r) r.onclick = hardRefresh;
  sh.querySelector('#s-chime').onclick = e => {
    const on = localStorage.getItem('pc-chime') === 'off'; // toggling to…
    localStorage.setItem('pc-chime', on ? 'on' : 'off');
    e.currentTarget.querySelector('.dot').classList.toggle('on', on);
  };
  sh.querySelector('#s-push').onclick = async e => {
    await togglePush($('#bell'));
    e.currentTarget.querySelector('.dot').classList.toggle('on', Boolean(await pushState()));
  };
  sh.querySelector('#s-sync').onclick = async e => {
    const dot = e.currentTarget.querySelector('.dot');
    try {
      srv = await api('/settings', { method: 'POST', body: JSON.stringify({ titleSync: !srv.titleSync }) });
      dot.classList.toggle('on', Boolean(srv.titleSync));
      toast(srv.titleSync ? 'Session names now sync with code-server' : 'Name sync off — Pocket names stay local');
    } catch (err) { toast('Could not save: ' + err.message); }
  };
  document.body.append(scrim, sh);
}

/* ---------- sessions list ---------- */
let allSessions = [];
function paintList(q) {
  const m = app.querySelector('main'); if (!m) return;
  const needle = (q || '').trim().toLowerCase();
  const list = needle
    ? allSessions.filter(s => (s.title + ' ' + (s.cwd || '')).toLowerCase().includes(needle))
    : allSessions;
  if (!list.length) { m.innerHTML = `<div class="empty">${needle ? 'No sessions match.' : 'No sessions yet. Tap + to start one.'}</div>`; return; }
  m.innerHTML = list.map(s => `
    <button class="row" data-id="${s.id}">
      ${s.active ? '<span class="ember" title="working"></span>' : ''}
      <span class="body">
        <span class="title">${esc(s.title)}</span>
        <span class="meta">${s.pinned ? `<span class="pinmark">${IC.pin}</span>` : ''}${s.provider === 'codex' ? '<span class="prov">codex</span>' : ''}<span class="proj">${esc(projName(s.cwd))}</span> · ${rel(s.mtimeMs)}${s.dupes ? ` · +${s.dupes} older` : ''}</span>
      </span>
    </button>`).join('');
  m.querySelectorAll('.row').forEach(r => {
    r.onclick = () => { location.hash = '#/chat/' + r.dataset.id; };
    const s = list.find(x => x.id === r.dataset.id);
    if (s) wireRowMenu(r, () => ({ id: s.id, title: s.title, pinned: Boolean(s.pinned) }), refreshSessions);
  });
}
async function refreshSessions() {
  try { allSessions = (await api('/sessions?limit=120')).sessions; } catch { return; }
  paintList($('#q')?.value);
}
async function renderList() {
  app.innerHTML = `
    <header class="bar">
      <h1>Pocket Code</h1>
      <button class="icon bell" id="bell" aria-label="Toggle turn-finished notifications">${IC.bellOff}</button>
      <button class="icon bell" id="settings" aria-label="Settings and version">${IC.cog}</button>
    </header>
    <div class="searchrow">${IC.search}<input type="search" id="q" placeholder="Search sessions" autocomplete="off"></div>
    <main class="scroll"><div class="empty">Loading sessions…</div></main>
    <button class="fab" id="new" aria-label="New session">${IC.plus}</button>`;
  $('#new').onclick = () => { location.hash = '#/new'; };
  $('#settings').onclick = () => settingsSheet();
  const bell = $('#bell');
  pushState().then(sub => { if (sub) { bell.innerHTML = IC.bell; bell.classList.add('on'); } });
  bell.onclick = () => togglePush(bell);
  $('#q').oninput = e => paintList(e.target.value);
  let data;
  try { data = await api('/sessions?limit=120'); } catch { return; }
  allSessions = data.sessions;
  paintList($('#q')?.value);
}

/* ---------- chat ---------- */
let es = null, chatId = null, lastMeta = null, chatTitle = '', chatPinned = false;
function closeES() { if (es) { es.close(); es = null; } }

function ledgerHTML(name, detail) {
  return `<div class="ledger enter">${toolIcon(name)}<span class="name">${esc(name)}</span><span class="det">${esc(detail || '')}</span></div>`;
}
// the plan, as a checklist — collapsed history, newest one open (see openLastTodo)
function todoHTML(todos) {
  const done = todos.filter(t => t.s === 'completed').length;
  const cur = todos.find(t => t.s === 'in_progress');
  const head = `Plan · ${done}/${todos.length}${cur ? ' · ' + cur.c : ''}`;
  return `<details class="todo enter"><summary><span class="thead">${esc(head)}</span></summary><ul>${todos.map(t =>
    `<li class="t-${esc(t.s)}"><span class="tbox">${t.s === 'completed' ? IC.tick : ''}</span><span>${esc(t.c)}</span></li>`).join('')}</ul></details>`;
}
function openLastTodo() {
  const all = $('#msgs')?.querySelectorAll('details.todo');
  if (all?.length) all.forEach((d, i) => { d.open = i === all.length - 1; });
}
const isImg = p => /\.(png|jpe?g|gif|webp)$/i.test(p || '');
function fileChip(f) { // f: {n,p} from the server, plain name string from optimistic sends
  const n = typeof f === 'string' ? f : f.n, p = typeof f === 'string' ? null : f.p;
  if (p && isImg(p)) {
    const src = '/api/file?path=' + encodeURIComponent(p);
    return `<a href="${esc(src)}" target="_blank" rel="noopener"><img class="athumb big" src="${esc(src)}" alt="${esc(n)}" loading="lazy"></a>`;
  }
  return `<div class="ledger">${IC.clip}<span class="det">${esc(n)}</span></div>`;
}
function msgHTML(m) {
  if (m.role === 'user') {
    let h = `<div class="m-user enter">${esc(m.text)}</div>`;
    if (m.files?.length) h += `<div class="m-files">${m.files.map(fileChip).join('')}</div>`;
    return h;
  }
  const parts = [];
  let tools = [];
  const flush = () => { if (tools.length) { parts.push(`<div class="ledgerwrap">${tools.join('')}</div>`); tools = []; } };
  for (const b of m.blocks || []) {
    if (b.t === 'tool') tools.push(ledgerHTML(b.name, b.detail));
    else if (b.t === 'todo') { flush(); parts.push(todoHTML(b.todos || [])); }
    else { flush(); parts.push(md(b.text)); }
  }
  flush();
  return `<div class="m-asst enter"><button class="copybtn msgcopy" data-copy-msg aria-label="Copy message">${IC.copy}</button>${parts.join('')}</div>`;
}

/* ---------- copy affordances (delegated: messages + code blocks) ---------- */
async function copyText(t, btn) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(t);
    else { const ta = document.createElement('textarea'); ta.value = t; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    if (btn) { btn.innerHTML = IC.tick; btn.classList.add('ok'); setTimeout(() => { btn.innerHTML = IC.copy; btn.classList.remove('ok'); }, 1400); }
  } catch { toast('Copy failed'); }
}
document.addEventListener('click', e => {
  const code = e.target.closest?.('[data-copy]');
  if (code) { e.stopPropagation(); return copyText(code.closest('.codewrap')?.querySelector('code')?.textContent || '', code); }
  const msg = e.target.closest?.('[data-copy-msg]');
  if (msg) {
    e.stopPropagation();
    const clone = msg.closest('.m-asst')?.cloneNode(true);
    if (!clone) return;
    clone.querySelectorAll('.copybtn, .ledgerwrap').forEach(n => n.remove()); // prose + code, not machinery
    return copyText((clone.innerText || '').trim(), msg);
  }
});

/* ---------- find in conversation (an installed PWA has no browser find bar) ---------- */
let fmarks = [], fidx = -1;
function findClear() {
  const msgs = $('#msgs');
  if (msgs) {
    for (const m of msgs.querySelectorAll('mark.fmark')) m.replaceWith(document.createTextNode(m.textContent));
    msgs.normalize();
  }
  fmarks = []; fidx = -1;
}
function findRun(q) {
  findClear();
  const msgs = $('#msgs'), count = $('#fcount');
  q = (q || '').trim();
  if (!msgs || q.length < 2) { if (count) count.textContent = ''; return; }
  const needle = q.toLowerCase();
  const walker = document.createTreeWalker(msgs, NodeFilter.SHOW_TEXT);
  const hits = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue && n.nodeValue.toLowerCase().includes(needle)) hits.push(n);
  }
  for (const node of hits) { // collected first, then replaced — mutating mid-walk skips nodes
    const text = node.nodeValue, frag = document.createDocumentFragment();
    let i = 0;
    for (;;) {
      const at = text.toLowerCase().indexOf(needle, i);
      if (at < 0) break;
      if (at > i) frag.append(document.createTextNode(text.slice(i, at)));
      const mk = document.createElement('mark');
      mk.className = 'fmark'; mk.textContent = text.slice(at, at + q.length);
      frag.append(mk); fmarks.push(mk);
      i = at + q.length;
    }
    frag.append(document.createTextNode(text.slice(i)));
    node.replaceWith(frag);
  }
  if (count) count.textContent = fmarks.length ? `1/${fmarks.length}` : 'none';
  if (fmarks.length) { fidx = -1; findStep(1); }
}
function findStep(d) {
  if (!fmarks.length) return;
  if (fidx >= 0) fmarks[fidx].classList.remove('cur');
  fidx = (fidx + d + fmarks.length) % fmarks.length;
  const m = fmarks[fidx];
  m.classList.add('cur');
  const det = m.closest('details'); if (det) det.open = true; // reveal a hit inside a collapsed plan
  m.scrollIntoView({ block: 'center' });
  const c = $('#fcount'); if (c) c.textContent = `${fidx + 1}/${fmarks.length}`;
}
const findIsOpen = () => { const b = $('#findbar'); return Boolean(b) && !b.hidden; };
function findOpen(on) {
  const bar = $('#findbar'); if (!bar) return;
  bar.hidden = !on;
  const box = $('#fq');
  if (on) { box.focus(); box.select(); }
  else {
    findClear(); if (box) box.value = ''; const c = $('#fcount'); if (c) c.textContent = '';
    clearTimeout(srchT); srchSeq++; const fm = $('#fmore'); if (fm) fm.hidden = true;
  }
}

/* ---------- full-transcript search (rendered chat is only the last ~400 messages) ---------- */
let chatTotal = 0, chatRendered = 0, srchT = null, srchSeq = 0;
function hl(text, q) { // escaped text with query hits wrapped in <mark>
  const lc = text.toLowerCase(), needle = q.toLowerCase(), out = [];
  let i = 0;
  for (;;) {
    const at = lc.indexOf(needle, i);
    if (at < 0) break;
    out.push(esc(text.slice(i, at)), `<mark class="fmark">${esc(text.slice(at, at + q.length))}</mark>`);
    i = at + q.length;
  }
  out.push(esc(text.slice(i)));
  return out.join('');
}
function findDeep(q) { // called from findRun once the local pass is done
  clearTimeout(srchT);
  const my = ++srchSeq;
  const fm = $('#fmore'); if (fm) fm.hidden = true;
  if (!q || q.length < 2 || chatTotal <= chatRendered) return;
  srchT = setTimeout(async () => {
    let d; try { d = await api(`/session/${chatId}/search?q=${encodeURIComponent(q)}`); } catch { return; }
    if (my !== srchSeq) return; // a newer query superseded this one
    const older = d.matches.filter(m => m.i < d.total - chatRendered);
    const fm2 = $('#fmore'); if (!fm2 || !older.length) return;
    fm2.innerHTML = `<button id="fmoreb">${older.length}${d.more ? '+' : ''} match${older.length === 1 ? '' : 'es'} in older messages — view</button>`;
    fm2.hidden = false;
    $('#fmoreb').onclick = () => openOlderMatches(q, older);
  }, 450);
}
function openOlderMatches(q, matches) {
  const ov = document.createElement('div'); ov.className = 'overlay'; ov.id = 'srchov';
  ov.innerHTML = `
    <header class="bar"><button class="icon" id="srchx" aria-label="Close">${IC.back}</button>
      <h1><span class="one">Older matches</span><span class="tag">“${esc(q)}” · before the rendered history</span></h1></header>
    <main class="scroll"><div class="srlist">${matches.map(m => `
      <div class="srow">
        <span class="smeta">${m.role === 'user' ? 'You' : 'Claude'}${m.ts ? ' · ' + rel(new Date(m.ts).getTime()) : ''}${m.hits > 1 ? ` · ${m.hits}×` : ''}</span>
        <span class="stext">${hl(m.text, q)}</span>
      </div>`).join('')}</div></main>`;
  document.body.append(ov);
  $('#srchx').onclick = () => ov.remove();
}

/* ---------- changed files (read-only: what did this session do to my code) ---------- */
function diffHTML(op) {
  const CTX = 2, CAP = 300;
  const rows = [];
  if (op.old == null) {
    for (const l of String(op.new ?? '').split('\n')) rows.push(['+', l]);
  } else {
    const a = op.old.split('\n'), b = String(op.new ?? '').split('\n');
    let pre = 0; while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    let suf = 0; while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
    for (let i = Math.max(0, pre - CTX); i < pre; i++) rows.push([' ', a[i]]);
    for (let i = pre; i < a.length - suf; i++) rows.push(['-', a[i]]);
    for (let i = pre; i < b.length - suf; i++) rows.push(['+', b[i]]);
    for (let i = a.length - suf; i < Math.min(a.length, a.length - suf + CTX); i++) rows.push([' ', a[i]]);
  }
  const head = `${op.tool}${op.all ? ' · replace all' : ''}${op.ts ? ' · ' + rel(new Date(op.ts).getTime()) : ''}${op.trunc ? ' · truncated' : ''}`;
  return `<div class="diff"><div class="dhead">${esc(head)}</div><pre>${rows.slice(0, CAP).map(([c, l]) =>
    `<span class="${c === '+' ? 'da' : c === '-' ? 'dd' : 'dx'}">${esc(c + ' ' + l)}</span>`).join('')}${
    rows.length > CAP ? `<span class="dx">… ${rows.length - CAP} more lines</span>` : ''}</pre></div>`;
}
async function openChanges() {
  if (!chatId || $('#chgov')) return;
  const ov = document.createElement('div'); ov.className = 'overlay'; ov.id = 'chgov';
  ov.innerHTML = `
    <header class="bar"><button class="icon" id="chgx" aria-label="Close">${IC.back}</button>
      <h1><span class="one">Changed files</span></h1></header>
    <main class="scroll"><div class="empty">Reading transcript…</div></main>`;
  document.body.append(ov);
  $('#chgx').onclick = () => ov.remove();
  let d; try { d = await api(`/session/${chatId}/changes`); } catch (e) { ov.remove(); return toast('Could not load changes: ' + e.message); }
  const m = ov.querySelector('main'); if (!m) return;
  if (!d.files.length) { m.innerHTML = '<div class="empty">This session hasn’t edited any files.</div>'; return; }
  const n = (k, w) => k ? `${k} ${w}${k > 1 ? 's' : ''}` : '';
  m.innerHTML = d.files.map((f, i) => {
    const edits = f.ops.filter(o => o.tool === 'Edit').length, writes = f.ops.length - edits;
    return `<details class="chg"${d.files.length === 1 ? ' open' : ''}>
      <summary><span class="fname">&lrm;${esc(projShort(f.path))}</span>
        <span class="fmeta">${[n(edits, 'edit'), n(writes, 'write')].filter(Boolean).join(' · ')}</span></summary>
      ${f.ops.map(diffHTML).join('')}</details>`;
  }).join('') + (d.failed ? `<div class="chgnote">${d.failed} failed edit${d.failed > 1 ? 's' : ''} not shown</div>` : '');
}

/* ---------- completion chime (push covers the screen-off case; this covers watching) ---------- */
let actx = null;
function chime() {
  if (localStorage.getItem('pc-chime') === 'off') return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const t0 = actx.currentTime;
    [660, 880].forEach((f, i) => {
      const at = t0 + i * 0.13;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(0.08, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
      o.connect(g).connect(actx.destination);
      o.start(at); o.stop(at + 0.3);
    });
  } catch { /* audio unavailable — silence is fine */ }
}

/* ---------- composer drafts (Android kills backgrounded PWAs mid-sentence) ---------- */
const draftKey = id => 'pc-draft-' + (id || 'new');
const saveDraft = (id, v) => { try { v.trim() ? localStorage.setItem(draftKey(id), v) : localStorage.removeItem(draftKey(id)); } catch { } };
const loadDraft = id => { try { return localStorage.getItem(draftKey(id)) || ''; } catch { return ''; } };
const clearDraft = id => { try { localStorage.removeItem(draftKey(id)); } catch { } };

const isWide = () => matchMedia('(min-width: 900px)').matches;
const railOpen = () => localStorage.getItem('pc-rail') !== 'closed';
const railW = () => Math.min(480, Math.max(220, Number(localStorage.getItem('pc-railw')) || 320));
function withShell(colHtml) { // desktop: session rail + resize grip beside the content column
  if (!isWide()) return colHtml;
  if (!railOpen()) return `<div class="split"><div class="chatcol">${colHtml}</div></div>`;
  return `<div class="split">
    <aside class="rail" style="width:${railW()}px">
      <div class="railhead"><span>Sessions</span><button class="icon" id="railnew" aria-label="New session">${IC.plus}</button></div>
      <div id="rail"></div>
    </aside>
    <div class="railgrip" id="grip" role="separator" aria-label="Resize session list"></div>
    <div class="chatcol">${colHtml}</div>
  </div>`;
}
function wireShell() {
  if (!isWide() || !railOpen()) return;
  paintRail();
  $('#railnew').onclick = () => { location.hash = '#/new'; };
  const grip = $('#grip'), rail = document.querySelector('aside.rail');
  grip.onpointerdown = e => {
    grip.setPointerCapture(e.pointerId);
    grip.onpointermove = ev => {
      const w = Math.min(480, Math.max(220, ev.clientX));
      rail.style.width = w + 'px';
      localStorage.setItem('pc-railw', String(w));
    };
    grip.onpointerup = () => { grip.onpointermove = null; grip.onpointerup = null; };
  };
}
let railCache = { at: 0, sessions: [] };
async function paintRail() {
  const el = $('#rail'); if (!el) return;
  if (Date.now() - railCache.at > 20000) {
    try { railCache = { at: Date.now(), sessions: (await api('/sessions?limit=60')).sessions }; } catch { }
  }
  el.innerHTML = railCache.sessions.map(s => `
    <button class="row ${s.id === chatId ? 'cur' : ''}" data-id="${s.id}">
      ${s.active ? '<span class="ember"></span>' : ''}
      <span class="body"><span class="title">${esc(s.title)}</span>
      <span class="meta">${s.pinned ? `<span class="pinmark">${IC.pin}</span>` : ''}${s.provider === 'codex' ? '<span class="prov">codex</span>' : ''}<span class="proj">${esc(projName(s.cwd))}</span> · ${rel(s.mtimeMs)}${s.dupes ? ` · +${s.dupes} older` : ''}</span></span>
    </button>`).join('');
  el.querySelectorAll('.row').forEach(r => {
    r.onclick = () => { location.hash = '#/chat/' + r.dataset.id; };
    const s = railCache.sessions.find(x => x.id === r.dataset.id);
    if (s) wireRowMenu(r, () => ({ id: s.id, title: s.title, pinned: Boolean(s.pinned) }),
      () => { railCache.at = 0; paintRail(); });
  });
}

let chatOffset = 0, extT = null;
function extPulse() { // ember while another surface (code-server) drives this session
  const h = $('#hember'); if (!h) return;
  if (!composerWorking) h.innerHTML = '<span class="ember"></span>';
  clearTimeout(extT);
  extT = setTimeout(() => { const h2 = $('#hember'); if (h2 && !composerWorking) h2.innerHTML = ''; }, 45000);
}

async function renderChat(id) {
  chatId = id; closeES();
  fmarks = []; fidx = -1; // marks from the previous render are gone with the DOM
  const chatCol = `
    <header class="bar">
      <button class="icon" id="back" aria-label="Back">${IC.back}</button>
      <button class="icon desk" id="railtog" aria-label="Show or hide the session list">${IC.panel}</button>
      <h1><span class="one" id="ctitle">Session</span><span class="tag" id="cproj"></span></h1>
      <span id="hember"></span>
      <button class="icon" id="chgb" aria-label="Changed files">${IC.diff}</button>
      <button class="icon" id="findb" aria-label="Find in conversation">${IC.search}</button>
      <button class="icon" id="newchat" aria-label="Start a new session">${IC.plus}</button>
    </header>
    <div class="findbar" id="findbar" hidden>
      <input type="search" id="fq" placeholder="Find in conversation" autocomplete="off" enterkeyhint="search">
      <span class="fcount" id="fcount"></span>
      <button class="icon" id="fprev" aria-label="Previous match">${IC.up1}</button>
      <button class="icon" id="fnext" aria-label="Next match">${IC.down1}</button>
      <button class="icon" id="fclose" aria-label="Close find">${IC.x}</button>
    </div>
    <div class="fmore" id="fmore" hidden></div>
    <main class="scroll"><div class="msgs" id="msgs"></div></main>
    <div class="composerwrap"><div class="slash" id="slash" hidden></div><div class="composer" id="comp"></div></div>`;
  app.innerHTML = withShell(chatCol) + '<input type="file" id="fpick" multiple hidden>';
  wireShell();
  $('#back').onclick = () => { location.hash = '#/'; };
  $('#newchat').onclick = () => { location.hash = '#/new'; };
  $('#chgb').onclick = () => openChanges();
  $('#findb').onclick = () => findOpen(!findIsOpen());
  $('#fq').oninput = e => { findRun(e.target.value); findDeep(e.target.value.trim()); };
  $('#fq').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); } };
  $('#fprev').onclick = () => findStep(-1);
  $('#fnext').onclick = () => findStep(1);
  $('#fclose').onclick = () => findOpen(false);
  const tog = $('#railtog');
  if (tog) tog.onclick = () => { localStorage.setItem('pc-rail', railOpen() ? 'closed' : 'open'); renderChat(chatId); };
  let s;
  try { s = await api('/session/' + id); }
  catch (e) { toast(e.status === 404 ? 'Session not found' : 'Could not open session: ' + (e.message || 'error')); location.hash = '#/'; return; }
  $('#ctitle').textContent = s.title;
  $('#cproj').textContent = projName(s.cwd);
  chatTitle = s.title; chatPinned = Boolean(s.pinned);
  const h1 = $('#ctitle').closest('h1');
  h1.classList.add('tappable');
  h1.onclick = () => sessionSheet({ id: chatId, title: chatTitle, pinned: chatPinned }, r => {
    if (typeof r.pinned === 'boolean') chatPinned = r.pinned;
    else if (r.name) { chatTitle = r.name; const t = $('#ctitle'); if (t) t.textContent = r.name; }
    else { renderChat(chatId); return; } // name cleared → resync the derived title
    railCache.at = 0; if (isWide()) paintRail();
  });
  chatOffset = s.size || 0;
  chatTotal = s.total || s.messages.length; chatRendered = s.messages.length;
  const isCx = id.startsWith('cx:');
  tb = { key: id, prefs: getPrefs(id), attachments: [], allowAttach: true, allowMute: true, provider: isCx ? 'codex' : 'claude' };
  (isCx ? loadCodexModels() : loadClaudeModels()).then(renderToolbar);
  chatMuted = Boolean(s.muted);
  chatCmds = null;
  api('/commands?cwd=' + encodeURIComponent(s.cwd || '')).then(r => { chatCmds = r.commands; }).catch(() => { });
  $('#fpick').onchange = e => { uploadFiles([...e.target.files]); e.target.value = ''; };
  const msgs = $('#msgs');
  msgs.innerHTML = s.messages.map(msgHTML).join('');
  openLastTodo();
  if (lastMeta && lastMeta.id === id) { msgs.insertAdjacentHTML('beforeend', lastMeta.html); lastMeta = null; }
  scrollBottom(true);
  setComposer(s.active);
  if (s.ext && !s.active) extPulse();
  openES(); // always: daemon turns stream events, idle sessions mirror the transcript live
}

function scrollBottom(force) {
  const m = app.querySelector('main.scroll');
  if (!m) return;
  const near = m.scrollHeight - m.scrollTop - m.clientHeight < 240;
  if (force || near) m.scrollTop = m.scrollHeight;
}

let chatCmds = null;
function slashUpdate(box) {
  const panel = $('#slash'); if (!panel) return;
  const v = box.value;
  const m = v.match(/^\/([\w:-]*)$/);
  if (!m || !chatCmds) { panel.hidden = true; return; }
  const hits = chatCmds.filter(c => c.name.startsWith(m[1])).slice(0, 8);
  if (!hits.length) { panel.hidden = true; return; }
  panel.innerHTML = hits.map(c => `
    <button data-n="${esc(c.name)}"><span class="cmd">/${esc(c.name)}</span>${c.desc ? `<span class="d">${esc(c.desc)}</span>` : ''}</button>`).join('');
  panel.querySelectorAll('button').forEach(b => b.onclick = () => {
    box.value = '/' + b.dataset.n + ' '; panel.hidden = true; box.focus();
  });
  panel.hidden = false;
}

let composerWorking = false;
function setComposer(working) {
  const c = $('#comp'); if (!c) return;
  composerWorking = working;
  $('#hember').innerHTML = working ? '<span class="ember"></span>' : '';
  const p = $('#slash'); if (p) p.hidden = true;
  c.innerHTML = `
    ${working ? `
      <div class="workrow"><span class="ember"></span><span>Working — messages steer the turn</span>
        <button class="icon wbell ${chatMuted ? 'on' : ''}" id="muteb" aria-label="Toggle notifications for this session">${chatMuted ? IC.bellOff : IC.bell}</button>
        <button class="chip stopchip" id="stopb" aria-label="Stop this turn">${IC.stop}Stop</button></div>`
      : `<div class="toolbar" id="tbar"></div><div class="attachrow" id="attrow"></div>`}
    <textarea id="box" rows="1" placeholder="${working ? 'Steer this turn…' : 'Message this session…'}" enterkeyhint="send"></textarea>
    <button class="send" id="send" aria-label="Send">${IC.up}</button>`;
  if (working) {
    $('#stopb').onclick = async () => {
      try { await api(`/session/${chatId}/stop`, { method: 'POST', body: '{}' }); }
      catch (e) { toast(e.message); if (chatId) renderChat(chatId); } // stale "Working" → resync
    };
    $('#muteb').onclick = () => toggleMute();
  } else {
    renderToolbar();
  }
  const box = $('#box');
  const grow = () => { box.style.height = 'auto'; box.style.height = Math.min(box.scrollHeight, innerHeight * .4) + 'px'; };
  const draft = loadDraft(chatId);
  if (draft) { box.value = draft; grow(); }
  box.oninput = () => {
    grow();
    saveDraft(chatId, box.value);
    if (!working) slashUpdate(box);
  };
  box.onkeydown = e => { // desktop: Enter sends, Shift+Enter for a newline
    if (e.key === 'Enter' && !e.shiftKey && isWide()) { e.preventDefault(); sendMsg(box.value); }
  };
  $('#send').onclick = () => sendMsg(box.value);
}

async function sendMsg(text) {
  text = text.trim(); if (!text || !chatId) return;
  clearDraft(chatId); // before setComposer, or the rebuilt box restores what we just sent
  const wasWorking = composerWorking;
  const opts = wasWorking ? {} : turnOpts();
  const files = wasWorking ? [] : (tb?.attachments || []).map(a => ({ n: a.name, p: a.path }));
  const msgs = $('#msgs');
  msgs.insertAdjacentHTML('beforeend', msgHTML({ role: 'user', text, files }));
  recentSends = [...recentSends.slice(-4), { text, at: Date.now() }];
  scrollBottom(true);
  if (!wasWorking && tb) tb.attachments = [];
  if (!wasWorking) setComposer(true); else { const b = $('#box'); if (b) { b.value = ''; b.style.height = 'auto'; } }
  try {
    const r = await api(`/session/${chatId}/message`, { method: 'POST', body: JSON.stringify({ text, ...opts }) });
    if (r.queued) toast('Queued — runs when the current turn finishes');
    if (!wasWorking) openES();
  } catch (e) {
    toast('Send failed: ' + e.message);
    if (!wasWorking) setComposer(false);
  }
}

let recentSends = []; // for deduping our own messages when they echo back via the mirror
function openES() {
  closeES();
  if (!chatId) return;
  es = new EventSource(`/api/session/${chatId}/events?offset=${chatOffset}`);
  const msgs = $('#msgs');
  let live = null; // word-by-word streaming buffer, replaced by the formatted message
  let watching = false; // mirror mode: session is idle here, may be driven elsewhere
  const dropLive = () => { if (live) { live.remove(); live = null; } };
  es.onmessage = ev => {
    let d; try { d = JSON.parse(ev.data); } catch { return; }
    // watch = the daemon has no turn for this session; if we still show "Working",
    // we missed the turn-end events (SSE drop + reconnect after finalize) — clear it
    if (d.type === 'watch') { watching = true; if (composerWorking) setComposer(false); }
    else if (d.type === 'user') { // mirror: a message sent from another surface
      if (recentSends.some(x => x.text === d.msg.text && Date.now() - x.at < 120000)) return;
      msgs.insertAdjacentHTML('beforeend', msgHTML(d.msg));
      if (watching) extPulse();
      scrollBottom();
    }
    else if (d.type === 'delta') {
      if (!live || !msgs.contains(live)) {
        msgs.insertAdjacentHTML('beforeend', '<div class="m-asst live enter"></div>');
        live = msgs.lastElementChild;
      }
      live.textContent += d.text;
      scrollBottom();
    }
    else if (d.type === 'assistant') {
      dropLive();
      msgs.insertAdjacentHTML('beforeend', msgHTML(d.msg));
      openLastTodo();
      if (watching) extPulse();
      scrollBottom();
    }
    else if (d.type === 'result') {
      if (document.visibilityState === 'visible') chime(); // not watching → push already notified
      if (!d.ok && d.error) msgs.insertAdjacentHTML('beforeend', `<div class="turn-err enter">Turn failed: ${esc(String(d.error)).slice(0, 600)}</div>`);
      if (d.cost != null) {
        const secs = d.duration_ms ? Math.round(d.duration_ms / 1000) : null;
        lastMeta = { id: chatId, html: `<div class="turnmeta">$${d.cost.toFixed(2)}${secs ? ` · ${secs >= 90 ? Math.round(secs / 60) + 'm' : secs + 's'}` : ''}</div>` };
        msgs.insertAdjacentHTML('beforeend', lastMeta.html);
      }
      scrollBottom();
    }
    else if (d.type === 'retry') { // rate limited — the server scheduled its own resume
      const t = new Date(d.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      msgs.insertAdjacentHTML('beforeend', `<div class="turnmeta">Rate limited — auto-resume at ${esc(t)}</div>`);
      scrollBottom();
    }
    else if (d.type === 'done') { dropLive(); closeES(); if (chatId) renderChat(chatId); } // resync from canonical transcript
    else if (d.type === 'idle') { dropLive(); closeES(); setComposer(false); }
  };
  es.onerror = () => { /* transient drop: resync on next visibility/focus */ };
}

/* resync when the phone comes back — the turn kept running server-side */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (location.hash.startsWith('#/chat/') && chatId) renderChat(chatId);
  else if (location.hash === '' || location.hash === '#/') renderList();
});

/* ---------- new session ---------- */
async function renderNew() {
  const col = `
    <header class="bar">
      <button class="icon" id="back" aria-label="Back">${IC.back}</button>
      <h1>New session</h1>
    </header>
    <main class="scroll"><div class="pane">
      <div><span class="h" id="agenth">Agent</span><div class="projlist" id="apick" role="radiogroup" aria-labelledby="agenth">
        <button class="row" role="radio" aria-checked="false" data-a="claude"><span class="dot"></span>${IC.term}<span class="p">Claude Code</span></button>
        <button class="row" role="radio" aria-checked="false" data-a="codex"><span class="dot"></span>${IC.term}<span class="p">Codex</span></button>
      </div></div>
      <div><span class="h" id="projh">Project</span><div class="projlist" id="plist" role="radiogroup" aria-labelledby="projh"><div class="empty">Loading…</div></div></div>
      <div><label class="h" for="cpath">Or a custom path</label><input type="text" id="cpath" placeholder="/full/path/to/project" autocapitalize="off" autocorrect="off"></div>
      <div><label class="h" for="first">First message</label><textarea id="first" placeholder="What should Claude work on?"></textarea></div>
      <div class="toolbar" id="tbar"></div>
      <div class="attachrow" id="attrow"></div>
      <button class="primary" id="start">Start session</button>
    </div></main>`;
  app.innerHTML = withShell(col) + '<input type="file" id="fpick" multiple hidden>';
  wireShell();
  $('#back').onclick = () => { location.hash = '#/'; };
  tb = { key: 'new', prefs: getPrefs('new'), attachments: [], allowAttach: true, provider: 'claude' };
  renderToolbar();
  // which agent runs this session — remembered, since most days you stay on one
  let provider = localStorage.getItem('pc-provider') === 'codex' ? 'codex' : 'claude';
  const ap = $('#apick');
  const pickAgent = a => {
    provider = a;
    localStorage.setItem('pc-provider', a);
    ap.querySelectorAll('.row').forEach(x => {
      const on = x.dataset.a === a;
      x.classList.toggle('sel', on); x.setAttribute('aria-checked', String(on));
    });
    tb.provider = a;
    const fm = $('#first');
    if (fm) fm.placeholder = a === 'codex' ? 'What should Codex work on?' : 'What should Claude work on?';
    renderToolbar();
    (a === 'codex' ? loadCodexModels() : loadClaudeModels()).then(renderToolbar);
  };
  ap.querySelectorAll('.row').forEach(r => r.onclick = () => pickAgent(r.dataset.a));
  pickAgent(provider);
  $('#fpick').onchange = e => { uploadFiles([...e.target.files]); e.target.value = ''; };
  const first = $('#first');
  first.value = loadDraft('new');
  first.oninput = () => saveDraft('new', first.value);
  let sel = null;
  try {
    const { projects } = await api('/projects');
    const pl = $('#plist');
    pl.innerHTML = projects.slice(0, 10).map((p, i) => `
      <button class="row" role="radio" aria-checked="false" data-p="${esc(p)}">
        <span class="dot"></span>${IC.folder}<span class="p">${esc(projShort(p))}</span>
      </button>`).join('');
    const pick = r => {
      pl.querySelectorAll('.row').forEach(x => { x.classList.remove('sel'); x.setAttribute('aria-checked', 'false'); });
      r.classList.add('sel'); r.setAttribute('aria-checked', 'true');
      sel = r.dataset.p; $('#cpath').value = '';
    };
    pl.querySelectorAll('.row').forEach(r => r.onclick = () => pick(r));
    // preselect where you last started a session — most people work out of one root
    const last = localStorage.getItem('pc-lastproj');
    const lastRow = last && pl.querySelector(`.row[data-p="${CSS.escape(last)}"]`);
    if (lastRow) pick(lastRow);
  } catch { }
  $('#start').onclick = async () => {
    const cwd = $('#cpath').value.trim() || sel;
    const text = $('#first').value.trim();
    if (!cwd) return toast('Pick a project or enter a path');
    if (!text) return toast('Write the first message');
    $('#start').disabled = true; $('#start').textContent = 'Starting…';
    try {
      const { id } = await api('/new', { method: 'POST', body: JSON.stringify({ cwd, text, provider, ...turnOpts() }) });
      clearDraft('new');
      try { localStorage.setItem('pc-lastproj', cwd); } catch { }
      location.hash = '#/chat/' + id;
    } catch (e) { toast(e.message); $('#start').disabled = false; $('#start').textContent = 'Start session'; }
  };
}

/* ---------- router ---------- */
async function route() {
  closeES(); chatId = null;
  try { await api('/me'); } catch { return; } // renders login on 401
  const h = location.hash;
  if (h.startsWith('#/chat/')) return renderChat(h.slice(7));
  if (h === '#/new') return renderNew();
  return renderList();
}
document.addEventListener('load', e => { if (e.target?.classList?.contains('genimg')) scrollBottom(); }, true);
document.addEventListener('keydown', e => {
  const inChat = location.hash.startsWith('#/chat/');
  if (inChat && (e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); findOpen(true); return; }
  if (e.key !== 'Escape') return;
  const ov = document.querySelector('.overlay');
  if (ov) return ov.remove();
  if (findIsOpen()) return findOpen(false);
  if (inChat && !document.querySelector('.scrim')) location.hash = '#/';
});
window.addEventListener('hashchange', route);
route();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

/* ---------- update announcement ---------- */
// First load after an asset bump: tell an existing install once that it updated and
// where the notes are. Fresh installs (no pc-* keys yet) get no toast.
(() => {
  if (!APP_V) return;
  const prev = localStorage.getItem('pc-seenv');
  if (prev === String(APP_V)) return;
  localStorage.setItem('pc-seenv', String(APP_V));
  const existing = prev || ['pc-chime', 'pc-rail', 'pc-agent', 'pc-draft'].some(k => localStorage.getItem(k) != null);
  if (existing) setTimeout(() => toast(`Updated to v${APP_V} — see What's new in Settings`), 1500);
})();
