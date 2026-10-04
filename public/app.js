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
  more: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
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

let closeCurrentSheet = null;
function mountSheet(scrim, sh, trigger = document.activeElement) {
  closeCurrentSheet?.();
  const heading = sh.querySelector('h2');
  if (heading) { heading.id = 'sheet-title'; sh.setAttribute('aria-labelledby', heading.id); }
  sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.tabIndex = -1;
  const closeButton = document.createElement('button'); closeButton.className = 'sheet-close icon';
  closeButton.setAttribute('aria-label', 'Close dialog'); closeButton.innerHTML = IC.x;
  sh.prepend(closeButton);
  const close = () => {
    sh.removeEventListener('keydown', keydown); scrim.remove(); sh.remove(); app.inert = false;
    if (closeCurrentSheet === close) closeCurrentSheet = null;
    if (trigger?.isConnected) trigger.focus();
  };
  const focusables = () => [...sh.querySelectorAll('button,input,textarea,a[href],[tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
  const keydown = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    if (e.key === 'Tab') {
      const items = focusables(), first = items[0], last = items.at(-1);
      if (!first) { e.preventDefault(); sh.focus(); }
      else if (e.shiftKey && (document.activeElement === first || document.activeElement === sh)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  scrim.onclick = close; closeButton.onclick = close; sh.addEventListener('keydown', keydown);
  app.inert = true; document.body.append(scrim, sh); closeCurrentSheet = close;
  (sh.querySelector('input') || closeButton).focus();
  return close;
}

function sheet(title, options, current, onPick) {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const sh = document.createElement('div'); sh.className = 'sheet';
  sh.innerHTML = `<h2>${esc(title)}</h2>` + options.map(([val, label, sub]) => `
    <button class="opt ${val === current ? 'sel' : ''}" data-v="${esc(val)}">
      <span class="dot"></span><span>${esc(label)}<span class="sub">${esc(sub)}</span></span>
    </button>`).join('');
  const close = () => closeCurrentSheet?.();
  scrim.onclick = close;
  sh.querySelectorAll('.opt').forEach(b => b.onclick = () => { close(); onPick(b.dataset.v); });
  mountSheet(scrim, sh);
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
    <button class="chip" id="c-approval" title="Permissions for the next turn">${permissionLabel(nextApprovalMode())}</button>
    ${tb.provider==='codex'?`<button class="chip ${tb.prefs.executionMode==='plan'?'set':''}" id="c-mode">${tb.prefs.executionMode==='plan'?'Plan first':'Work normally'}</button>`:''}
    ${tb.allowMute ? `<button class="chip ${chatMuted ? 'set' : ''}" id="c-mute" aria-label="Toggle notifications for this session">${chatMuted ? IC.bellOff : IC.bell}${chatMuted ? 'Muted' : 'Alerts'}</button>` : ''}`;
  const ar = $('#attrow');
  if (ar) {
    ar.innerHTML = tb.attachments.map((a, i) => `
      <span class="afile">${isImg(a.path)
        ? `<img class="athumb" src="/api/file?path=${encodeURIComponent(a.path)}" alt="">` : IC.clip}<span class="n">${esc(a.name)}</span>
        <button data-i="${i}" aria-label="Remove ${esc(a.name)}">${IC.x}</button></span>`).join('');
    ar.querySelectorAll('button').forEach(b => b.onclick = () => { tb.attachments.splice(Number(b.dataset.i), 1); stashAttachments(); renderToolbar(); });
  }
  const att = $('#c-att');
  if (att) att.onclick = () => sheet('Attach a file or screenshot',[['file','Choose files','Select from this device'],['paste','Paste screenshot','Use an image from your clipboard']],null,v=>{if(v==='file')$('#fpick')?.click();else pasteClipboardImage();});
  $('#c-model').onclick = () => sheet('Model for this turn', modelList(), tb.prefs.model,
    v => { tb.prefs.model = v; setPrefs(tb.key, tb.prefs); renderToolbar(); });
  $('#c-eff').onclick = () => sheet('Reasoning effort', EFFORTS, tb.prefs.effort,
    v => { tb.prefs.effort = v; setPrefs(tb.key, tb.prefs); renderToolbar(); });
  if (loadOutbox(tb.key)) {
    bar.querySelectorAll('button:not(#c-mute)').forEach(b => { b.disabled = true; });
    ar?.querySelectorAll('button').forEach(b => { b.disabled = true; });
  }
  const mode=$('#c-mode');if(mode)mode.onclick=()=>sheet('Codex mode for the next turn',[['work','Work normally','Carry out your request'],['plan','Plan first','Explore an approach and answer native questions before implementation']],tb.prefs.executionMode||'work',v=>{tb.prefs.executionMode=v;setPrefs(tb.key,tb.prefs);renderToolbar();});
  $('#c-approval').onclick=()=>chooseApprovalMode();
  paintUploadStatus();
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
    ${chatTextControlsHTML()}
    ${s.id===chatId?'<button class="opt" id="so-find">'+IC.search+'<span>Find in conversation</span></button><button class="opt" id="so-changes">'+IC.diff+'<span>Changed files</span></button>':''}
    <button class="opt" id="so-permissions">${IC.cog}<span>Permissions for the next turn<span class="sub">${permissionLabel(nextApprovalMode(getPrefs(s.id)))}. Running work keeps its current permissions.</span></span></button>
    <button class="opt" id="so-pin">${IC.pin}<span>${s.pinned ? 'Unpin session' : 'Pin session'}<span class="sub">${s.pinned ? 'Back to its place by recency' : 'Keep it at the top of the list'}</span></span></button>
    <button class="opt" id="so-hide">${IC.folder}<span>${isHiddenSession(allSessions.find(r=>r.id===s.id)||s)?'Restore to session list':'Hide from this device'}<span class="sub">History stays intact. New activity brings it back.</span></span></button>
    <button class="opt" id="so-ren">${IC.pen}<span>Rename<span class="sub">Your title, on every device — clear it to go back to the automatic one</span></span></button>`;
  const close = () => closeCurrentSheet?.();
  scrim.onclick = close;
  sh.querySelector('#so-pin').onclick = async () => {
    close();
    try {
      const r = await api(`/session/${s.id}/pin`, { method: 'POST', body: JSON.stringify({ pinned: !s.pinned }) });
      toast(r.pinned ? 'Pinned to the top' : 'Unpinned');
      refresh?.(r);
    } catch (e) { toast('Pin failed: ' + e.message); }
  };
  sh.querySelector('#so-hide').onclick=()=>{const row=allSessions.find(r=>r.id===s.id)||s;if(['running','observed','waiting','input'].includes(rowState(row).kind))return toast('Active or waiting sessions stay visible.');if(hiddenSessions[s.id])delete hiddenSessions[s.id];else hiddenSessions[s.id]=Math.max(row.mtimeMs||0,row.state?.at||0,Date.now());writeLocal('pc-hidden-sessions',hiddenSessions);close();paintSessionPanels();};
  sh.querySelector('#so-ren').onclick = () => { close(); renameSheet(s, refresh); };
  bindChatTextControls(sh);
  sh.querySelector('#so-find')?.addEventListener('click',()=>{close();findOpen(true);});
  sh.querySelector('#so-changes')?.addEventListener('click',()=>{close();openChanges();});
  sh.querySelector('#so-permissions').onclick=()=>{close();chooseApprovalMode(s.id);};
  mountSheet(scrim, sh);
}
function renameSheet(s, refresh) {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const sh = document.createElement('div'); sh.className = 'sheet';
  sh.innerHTML = `
    <h2>Rename session</h2>
    <input type="text" class="rename" id="rn" maxlength="120" placeholder="Session title" enterkeyhint="done" autocomplete="off">
    <button class="primary" id="rn-save">Save</button>`;
  const close = () => closeCurrentSheet?.();
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
  mountSheet(scrim, sh);
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
const uploadsInFlight = new Map();
function attachmentTarget() {
  if (!tb?.allowAttach || loadOutbox(tb.key)) { toast('Finish or discard the pending message before attaching files.'); return null; }
  if (tb.key !== 'new' && composerWorking) { toast('Attach files after this turn finishes.'); return null; }
  return tb.key;
}
function paintUploadStatus() {
  const row = $('#attrow'); if (!row || !tb) return;
  row.querySelector('.upload-status')?.remove();
  const n = uploadsInFlight.get(tb.key) || 0;
  if (n) { const note=document.createElement('span');note.className='upload-status';note.role='status';note.textContent='Uploading '+n+' file'+(n===1?'':'s')+'…';row.append(note); }
}
async function uploadFiles(fileList, target = attachmentTarget()) {
  if (!target || !fileList.length) return;
  uploadsInFlight.set(target,(uploadsInFlight.get(target)||0)+fileList.length);paintUploadStatus();
  for (const f of fileList) {
    try {
      if (f.size > 30 * 1024 * 1024) throw new Error(`${f.name} is over 30 MB`);
      const r = await fetch('/api/upload', { method: 'POST', headers: { 'x-filename': f.name, 'content-type': 'application/octet-stream' }, body: f });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      // Uploads belong to the initiating session, even if navigation happens meanwhile.
      const files=loadAttachments(target);files.push({path:j.path,name:j.name});
      localStorage.setItem('pc-attachments-'+target,JSON.stringify(files));
      if(tb?.key===target)tb.attachments=files;
    } catch (e) { toast('Upload failed: ' + e.message); }
    finally { const n=(uploadsInFlight.get(target)||1)-1;if(n)uploadsInFlight.set(target,n);else uploadsInFlight.delete(target); }
  }
  if(tb?.key===target){renderToolbar();paintUploadStatus();}
}
function clipboardFile(blob, index=0) {
  const ext=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'})[blob.type]||'png';
  return new File([blob],`screenshot-${Date.now()}-${index}.${ext}`,{type:blob.type});
}
async function pasteClipboardImage() {
  const target=attachmentTarget();if(!target)return;
  if(!navigator.clipboard?.read){toast('This browser cannot read clipboard images. Try pasting into the message box or choose a file.');return;}
  uploadsInFlight.set(target,(uploadsInFlight.get(target)||0)+1);paintUploadStatus();
  try {
    const items=await navigator.clipboard.read(),files=[];
    for(const item of items){const type=item.types.find(t=>t.startsWith('image/'));if(type)files.push(clipboardFile(await item.getType(type),files.length));}
    if(!files.length){toast('No image on the clipboard. Copy a screenshot first.');return;}
    await uploadFiles(files,target);
  } catch {toast('Clipboard access was not available. Try pasting into the message box or choose a file.');}
  finally{const n=(uploadsInFlight.get(target)||1)-1;if(n)uploadsInFlight.set(target,n);else uploadsInFlight.delete(target);paintUploadStatus();}
}
document.addEventListener('paste',event=>{
  if(!event.target.matches?.('#box,#first'))return;
  const files=[...(event.clipboardData?.items||[])].filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);
  if(!files.length)return; // Ordinary text keeps the browser's normal paste behavior.
  event.preventDefault();const target=attachmentTarget();if(target)uploadFiles(files.map(clipboardFile),target);
});

function turnOpts() {
  if (!tb) return {};
  return {
    approvalMode:nextApprovalMode(),
    executionMode:tb.provider==='codex'&&tb.prefs.executionMode==='plan'?'plan':'work',
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
function md(src) { return PocketFormat.render(src, chatId); }

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
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status, code: j.code });
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
  let clientRelease=null;
  try {const response=await fetch('/release.json?v='+APP_V);if(response.ok){const release=await response.json();if(release.assetV===APP_V)clientRelease=release;}}catch{}
  const clientNotes=clientRelease?.notes||a.notes;
  const stale = a.assetV && APP_V && a.assetV > APP_V;
  const up = a.uptime ? (a.uptime > 90 * 60 ? Math.round(a.uptime / 3600) + 'h' : Math.round(a.uptime / 60) + 'm') : '?';
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const sh = document.createElement('div'); sh.className = 'sheet';
  const chimeOff = localStorage.getItem('pc-chime') === 'off';
  const pushed = await pushState();
  sh.innerHTML = `
    <h2>Pocket Code</h2>
    ${chatTextControlsHTML()}
    <div class="about">
      <div class="arow"><span>App</span><b>${esc(clientRelease?.version || a.version || 'Pocket Code')} · build ${APP_V ?? '?'}</b></div>
      <div class="arow"><span>Server</span><b>v${a.assetV ?? '?'} · ${esc(a.commit || '?')}${a.commitAt ? ' · ' + new Date(a.commitAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</b></div>
      <div class="arow"><span>Claude CLI</span><b>${esc(a.cli || '?')}</b></div>
      <div class="arow"><span>Box</span><b>${esc(a.host || '?')} · up ${up}</b></div>
      ${stale ? `<button class="primary" id="s-refresh">Update available — refresh to v${a.assetV}</button>`
        : `<div class="arow ok"><span>Status</span><b>Up to date</b></div>`}
    </div>
    ${Array.isArray(clientNotes) && clientNotes.length ? `<div class="about whatsnew"><div class="arow"><span>What's new in v${APP_V ?? a.assetV ?? '?'}</span></div><ul>${clientNotes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
    <button class="opt" id="s-environment">${IC.model}<span>Accounts & instance<span class="sub">Provider sign-ins and supported controls</span></span></button><button class="opt" id="s-keys">${IC.term}<span>Keyboard & workspace<span class="sub">Shortcuts and open-session tabs</span></span></button><button class="opt" id="s-chime"><span class="dot ${chimeOff ? '' : 'on'}"></span><span>Completion chime<span class="sub">Two-note blip when a turn finishes on screen</span></span></button>
    <button class="opt" id="s-push"><span class="dot ${pushed ? 'on' : ''}"></span><span>Turn notifications<span class="sub">Push to this device when a turn finishes</span></span></button>
    <button class="opt" id="s-sync"><span class="dot ${srv.titleSync ? 'on' : ''}"></span><span>Sync names with code-server<span class="sub">Session names follow Claude Code's titles, and renames here show there too</span></span></button>`;
  const close = () => closeCurrentSheet?.();
  scrim.onclick = close;
  const r = sh.querySelector('#s-refresh'); if (r) r.onclick = hardRefresh;
  sh.querySelector('#s-environment').onclick=openEnvironment;
  bindChatTextControls(sh);
  sh.querySelector('#s-keys').onclick=keyboardHelp;
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
  mountSheet(scrim, sh);
}

/* ---------- sessions list ---------- */
let allSessions = [], sessionFilter = 'all', sessionQuery = '', sessionCheckedAt = 0, sessionWarnings = [], sessionsStale = false;
let sessionFetch = null;
let sessionProofReceivedAt=0,sessionProofReceivedWallAt=0;
const seenAt = id => { try { return Number(localStorage.getItem('pc-seen-' + id)) || 0; } catch { return 0; } };
const needsAttention = s => s.state?.kind === 'input' || s.state?.kind === 'failed' && (s.state.at || 0) > seenAt(s.id);
const isUnread = s => s.state?.kind === 'finished' && (s.state.at || 0) > seenAt(s.id);
function markRead(id, state) { if (document.visibilityState === 'visible' && state?.at) { try { localStorage.setItem('pc-seen-' + id, String(state.at)); } catch { } } }
function rowState(s) { return s.state || { kind: s.active ? 'observed' : 'idle', label: s.active ? 'Activity elsewhere' : 'Recent' }; }
function sessionCounts() {
  if(sessionsStale)return {running:0,input:0,observed:0,attention:allSessions.filter(needsAttention).length,fresh:allSessions.filter(isUnread).length};
  return { running: allSessions.filter(s => rowState(s).kind === 'running').length,
    input:allSessions.filter(s=>rowState(s).kind==='input').length,
    observed: allSessions.filter(s => rowState(s).kind === 'observed').length,
    attention: allSessions.filter(needsAttention).length,
    fresh: allSessions.filter(isUnread).length };
}
function sessionSummary() {
  if (sessionsStale) return 'Status unavailable. Showing the last saved list.';
  if (!sessionCheckedAt) return 'Checking your sessions…';
  const c = sessionCounts();
  return [c.running ? `${c.running} running` : 'No confirmed runs', c.observed ? `${c.observed} with activity elsewhere` : '', c.attention ? `${c.attention} need attention` : ''].filter(Boolean).join(' · ');
}
function filterButtons() {
  const c = sessionCounts();
  return [['all','All',null],['active','Active',c.running+c.observed+c.input],['attention','Attention',c.attention],['new','New',c.fresh],['pinned','Pinned',null],['hidden','Hidden',null]].map(([key,label,count]) =>
    `<button type="button" data-filter="${key}" aria-pressed="${sessionFilter === key}">${label}${count ? `<span>${count}</span>` : ''}</button>`).join('');
}
function filteredSessions() {
  const needle = sessionQuery.trim().toLowerCase();
  return allSessions.filter(s => (!workspaceFilter||s.cwd===workspaceFilter)&&(!providerFilter||s.provider===providerFilter)&&(sessionFilter==='hidden'?isHiddenSession(s):!isHiddenSession(s))&&(!needle || (s.title + ' ' + (s.cwd || '')).toLowerCase().includes(needle)) &&
    (sessionFilter === 'all' || sessionFilter === 'active' && ['running','observed','input'].includes(rowState(s).kind) ||
     sessionFilter === 'attention' && needsAttention(s) || sessionFilter === 'new' && isUnread(s) || sessionFilter==='pinned'&&s.pinned || sessionFilter==='hidden'));
}
function sessionRowHTML(s) {
  const state = rowState(s), running = state.kind === 'running';
  const detail = running && state.startedAt ? `Started ${rel(state.startedAt)}`
    : state.kind === 'observed' ? 'Recent transcript activity; run status unconfirmed'
    : state.kind === 'waiting' && state.retryAt ? `Retry at ${new Date(state.retryAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}` : `Updated ${rel(s.mtimeMs)}`;
  return `<div class="session-item ${s.id === chatId ? 'cur' : ''}">
    <button class="row" data-id="${esc(s.id)}">
      <span class="body"><span class="title">${esc(s.title)}</span>
      <span class="meta">${s.pinned ? `<span class="pinmark">${IC.pin}</span>` : ''}${esc(projName(s.cwd))} · ${s.provider === 'codex' ? 'Codex' : 'Claude'}</span>
      <span class="session-status state-${sessionsStale ? 'unknown' : state.kind}">${running && !sessionsStale ? '<span class="ember" aria-hidden="true"></span>' : ''}${sessionsStale ? 'Status unavailable' : esc(state.label)}${isUnread(s) ? '<span class="unread">New</span>' : ''}${running && state.queued ? ` · ${state.queued} queued` : ''}</span>
      <span class="activity-detail">${esc(detail)}${running?' · <span data-run-age></span>':''}</span></span>
    </button><button class="session-more icon" data-more="${esc(s.id)}" aria-label="Options for ${esc(s.title)}">${IC.more}</button>
  </div>`;
}
function bindSessionRows(container) {
  container.querySelectorAll('[data-id]').forEach(row => {
    row.onclick = () => { closeCurrentSheet?.(); location.hash = '#/chat/' + row.dataset.id; };
    const session = allSessions.find(s => s.id === row.dataset.id);
    wireRowMenu(row, () => session, refreshSessions);
  });
  container.querySelectorAll('[data-more]').forEach(b => b.onclick = () => {
    const session = allSessions.find(s => s.id === b.dataset.more);
    if (session) { closeCurrentSheet?.(); sessionSheet(session, refreshSessions); }
  });
}
function groupedSessionsHTML(list) {
  const groups = [['running','Running'],['observed','Activity elsewhere'],['failed','Needs attention'],['waiting','Waiting'],['recent','Recent']];
  if (!list.length) return `<div class="empty">${sessionsStale ? 'Could not load sessions. Use Refresh to try again.' : sessionQuery || workspaceFilter || providerFilter || ['pinned','hidden'].includes(sessionFilter) ? 'No sessions match these filters.' : sessionFilter === 'active' ? 'No runs or recent external activity.' : sessionFilter === 'attention' ? 'No recorded failed turns.' : sessionFilter === 'new' ? 'No new recorded responses.' : 'No sessions yet. Start a conversation to begin.'}</div>`;
  if(sessionsStale)return `<section class="session-group"><h2>Status unconfirmed<span>${list.length}</span></h2>${list.map(sessionRowHTML).join('')}</section>`;
  return groups.map(([key,label]) => {
    const rows = list.filter(s => key === 'recent' ? !['running','observed','waiting','input'].includes(rowState(s).kind) && !needsAttention(s) : key === 'failed' ? needsAttention(s) : rowState(s).kind === key);
    return rows.length ? `<section class="session-group"><h2>${label}<span>${rows.length}</span></h2>${rows.map(sessionRowHTML).join('')}</section>` : '';
  }).join('');
}
function paintSessionPanels() {
  paintWorkspaceFilters();
  paintWorkspaceDensity();
  document.querySelectorAll('[data-session-summary]').forEach(el => { el.textContent = sessionSummary(); });
  document.querySelectorAll('[data-session-filters]').forEach(el => {
    const focused = el.contains(document.activeElement) ? document.activeElement.dataset.filter : null;
    el.innerHTML = filterButtons();
    el.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { sessionFilter = b.dataset.filter; paintSessionPanels(); el.querySelector(`[data-filter="${sessionFilter}"]`)?.focus(); });
    if (focused) el.querySelector(`[data-filter="${focused}"]`)?.focus({preventScroll:true});
  });
  document.querySelectorAll('[data-session-results]').forEach(el => {
    const focus = el.contains(document.activeElement) ? document.activeElement?.dataset : null;
    const id = focus?.id, more = focus?.more;
    el.innerHTML = groupedSessionsHTML(filteredSessions()); bindSessionRows(el);
    if (id || more) el.querySelector(`[${more ? 'data-more' : 'data-id'}="${CSS.escape(more || id)}"]`)?.focus({preventScroll:true});
  });
  document.querySelectorAll('[data-session-warning]').forEach(el => { el.textContent = sessionWarnings.join(' '); el.hidden = !sessionWarnings.length; });
  const current = allSessions.find(s => s.id === chatId);
  const qb=$('#questions-open');if(qb)qb.hidden=!current?.state?.questions;
  const ab=$('#approvals-open');if(ab){ab.hidden=!current?.state?.approvals;if(current?.state?.approvals)ab.textContent='Action needs approval · Review';}
  if (current && $('#chat-state')) { $('#chat-state').textContent = sessionsStale ? 'Unconfirmed' : rowState(current).label; if (!sessionsStale) markRead(chatId, current.state); }
  const queueButton=$('#queue-open');if(queueButton)queueButton.textContent='Queue'+(current?.state?.queued?' ('+current.state.queued+')':'');
  if(current?.state?.confirmed&&['finished','failed','stopped','ended'].includes(current.state.kind)&&!sessionsStale&&!loadOutbox(chatId)){deliveryNotices.delete(chatId);paintDelivery(chatId);}
  paintRunConfirmation();
  const quick = $('#session-switch');
  if (quick) { const c = sessionCounts(); quick.textContent = sessionsStale ? 'Sessions · status unavailable' : `Sessions · ${c.running} running${c.observed ? ` · ${c.observed} elsewhere` : ''}`; }
}
async function refreshSessions() {
  if (sessionFetch) return sessionFetch;
  sessionFetch = (async () => {
    try { const d = await api('/sessions?limit=200&statusCheck='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(8000)}); allSessions = d.sessions; sessionWarnings = d.warnings || []; if(!Number.isFinite(d.checkedAt)||d.checkedAt<=0||d.checkedAt<=sessionCheckedAt)throw new Error('No fresh server confirmation');sessionCheckedAt = d.checkedAt;sessionProofReceivedAt=performance.now();sessionProofReceivedWallAt=Date.now(); sessionsStale = false; const current = allSessions.find(s => s.id === chatId); if (current) markRead(chatId, current.state); }
    catch { sessionsStale = true; }
    finally { sessionFetch = null; paintSessionPanels(); }
  })();
  return sessionFetch;
}
// This timestamp advances ONLY on a fresh authenticated server status response.
// Local animation, SSE keepalives and transcript activity never prove an owned run.
function paintRunConfirmation(){
 const elapsed=sessionProofReceivedAt?Math.max(0,Math.floor(Math.max(performance.now()-sessionProofReceivedAt,Date.now()-sessionProofReceivedWallAt)/1000)):null;
 const fresh=!sessionsStale&&elapsed!==null&&elapsed<=15;
 const current=allSessions.find(s=>s.id===chatId),state=current?.state;
 const box=document.getElementById('run-confirmation');
 const name=document.getElementById('run-confirmed-state'),stamp=document.getElementById('run-confirmed-at');
 if(box&&name&&stamp){
  let label='Checking server…',kind='unknown';
  if(!fresh&&sessionProofReceivedAt)label='Status unconfirmed. Reconnecting…';
  else if(!fresh&&sessionsStale)label='Status unavailable';
  else if(fresh){
   if(state?.kind==='running'&&state.confirmed===true){label='Running on server';kind='running';}
   else if(state?.kind==='running'||state?.kind==='observed'){label='Activity seen. Run unconfirmed';}
   else if(state?.confirmed===true){label=state.label;kind=state.kind;}
   else {label='No active run here';kind='idle';}
  }
  if(name.textContent!==label)name.textContent=label;
  box.dataset.state=kind;
  stamp.textContent=elapsed===null?'':(fresh?'Checked ':'Last check ')+elapsed+'s ago';
  box.title=sessionCheckedAt?'Server confirmation: '+new Date(sessionCheckedAt).toLocaleTimeString()+'. '+(state?.startedAt?'Turn started: '+new Date(state.startedAt).toLocaleTimeString()+'. ':'')+'Checks every 5 seconds. Running means the server owns an active turn; it does not guarantee continuous output.':'';
 }
 const headerLamp=document.getElementById('hember');
 if(headerLamp)headerLamp.hidden=!(fresh&&state?.kind==='running'&&state.confirmed===true);
 const workingLabel=document.getElementById('work-label');
 if(workingLabel){
  const label=!fresh?'Run status unconfirmed':state?.kind==='running'&&state.confirmed===true?'Working on server':state?.label||'No active run confirmed';
  if(workingLabel.textContent!==label)workingLabel.textContent=label;
  const lamp=workingLabel.parentElement.querySelector('.ember');if(lamp)lamp.hidden=!(fresh&&state?.kind==='running'&&state.confirmed===true);
 }
 document.querySelectorAll('[data-run-age]').forEach(el=>el.textContent=fresh?'confirmed '+elapsed+'s ago':'not currently confirmed');
}
function sessionPanelHTML(rail = false) {
  const summary = `<p class="session-summary" data-session-summary role="status">${esc(sessionSummary())}</p>`;
  const filters = `<div data-workspace-filters></div><nav class="session-filters" data-session-filters aria-label="Filter sessions">${filterButtons()}</nav>`;
  return `<div class="session-panel ${rail ? 'compact' : ''}">
    ${rail ? '' : summary}
    <div class="session-search">${IC.search}<input type="search" data-session-search aria-label="Search recent sessions" placeholder="Search recent sessions" value="${esc(sessionQuery)}" autocomplete="off"></div>
    ${rail ? `<div id="rail-filter-summary" class="rail-filter-summary" hidden><span></span><button id="clear-rail-filters">Clear filters</button></div><div id="rail-filter-controls">${summary}${filters}</div>` : filters}
    <p class="session-warning" data-session-warning hidden></p>
    <div class="session-results" data-session-results></div>
    <p class="session-footnote">Recent history and all runs owned by Pocket Code. External activity is an estimate.</p>
  </div>`;
}
function bindSessionPanel(container) {
  container.querySelectorAll('[data-session-search]').forEach(input => input.oninput = e => { sessionQuery = e.target.value; paintSessionPanels(); });
  paintSessionPanels();
}
async function renderList() {
  app.innerHTML = `<header class="bar"><h1>Pocket Code</h1>
    <button class="icon bell" id="bell" aria-label="Toggle turn-finished notifications">${IC.bellOff}</button>
    <button class="icon bell" id="settings" aria-label="Settings and version">${IC.cog}</button></header>
    <main class="scroll session-home"><div class="session-home-head"><h2>Your sessions</h2><button class="chip" id="refresh-sessions">Refresh</button></div>
    <div id="resume-last"></div>${sessionPanelHTML()}</main><button class="fab" id="new" aria-label="New session">${IC.plus}</button>`;
  $('#new').onclick = () => { location.hash = '#/new'; };
  $('#settings').onclick = settingsSheet; $('#refresh-sessions').onclick = refreshSessions;
  pushState().then(sub => { const bell = $('#bell'); if (bell && sub) { bell.innerHTML = IC.bell; bell.classList.add('on'); } });
  $('#bell').onclick = () => togglePush($('#bell'));
  bindSessionPanel(app); await refreshSessions();
  const last=openSessions.find(s=>s.id===readLocal('pc-last-session',''));if(last&&$('#resume-last'))$('#resume-last').innerHTML=`<a class="resume-last" href="#/chat/${esc(last.id)}">Resume: ${esc(last.title)}</a>`;
}
function openSessionSwitcher() {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const sh = document.createElement('div'); sh.className = 'sheet session-switcher';
  sh.innerHTML = `<h2>Switch session</h2>${sessionPanelHTML(true)}`;
  mountSheet(scrim, sh); bindSessionPanel(sh); refreshSessions();
}
// Refresh state without rebuilding the conversation or discarding its draft.
setInterval(() => { if (document.visibilityState === 'visible' && !document.querySelector('.login')) refreshSessions(); }, 5000);
setInterval(()=>{
 if(sessionProofReceivedAt&&Math.max(performance.now()-sessionProofReceivedAt,Date.now()-sessionProofReceivedWallAt)>15000&&!sessionsStale){sessionsStale=true;paintSessionPanels();}
 else paintRunConfirmation();
},1000);
window.addEventListener('offline', () => { sessionsStale = true; paintSessionPanels(); setConnection('Offline. Your draft is kept on this device.'); });
window.addEventListener('online', () => { refreshSessions(); if (chatId) openES(); });

/* ---------- saved follow-ups ---------- */
async function openQueue(id) {
  const scrim=document.createElement('div');scrim.className='scrim';
  const sh=document.createElement('div');sh.className='sheet queue-sheet';
  sh.innerHTML='<h2>Queued instructions</h2><p class="sheet-help">Each saved instruction runs as a separate turn. Stopping the current turn pauses the queue.</p><button class="chip" id="queue-refresh">Refresh</button><div id="queue-items" role="status">Loading queue…</div>';
  workspaceMount(scrim,sh,'queue');
  const load=async()=>{
    try{
      const d=await api('/session/'+encodeURIComponent(id)+'/queue');if(!sh.isConnected)return;
      const target=sh.querySelector('#queue-items');
      target.innerHTML=d.items.length?d.items.map((r,i)=>`<article class="queue-item"><div class="result-detail">${i+1} · ${r.status==='pending'?(d.active?'After the current turn':'Paused'):r.status==='editing'?'Editing · paused':r.status==='dispatching'?'Starting…':'Needs review'}</div><p>${esc(r.text)}</p><div class="result-detail">${permissionLabel(r.approvalMode||approvalPolicy.defaultMode)}</div>${r.error?`<p class="sheet-help">${esc(r.error)}</p>`:''}<div class="queue-actions">${['pending','editing'].includes(r.status)?`<button class="chip" data-edit="${r.id}">${r.status==='editing'?'Continue editing':'Edit'}</button>`:''}${r.status!=='dispatching'?`<button class="chip" data-remove="${r.id}">Remove</button>`:''}</div></article>`).join(''):'<p class="empty">No queued instructions. While the agent works, choose After this turn before sending.</p>';
      if(d.items[0]?.status==='pending'&&!d.active)target.insertAdjacentHTML('beforeend',`<button class="primary" id="queue-start" ${d.external?'disabled':''}>Run next instruction</button>${d.external?'<p class="sheet-help">Recent activity was seen elsewhere. Refresh after that turn finishes.</p>':''}`);
      target.querySelectorAll('[data-remove]').forEach(b=>b.onclick=async()=>{const r=d.items.find(x=>x.id===b.dataset.remove);b.disabled=true;
        try{await api('/session/'+id+'/queue/'+r.id,{method:'DELETE',body:JSON.stringify({revision:r.revision})});await load();refreshSessions();}catch(e){toast(e.message);b.disabled=false;}
      });
      target.querySelectorAll('[data-edit]').forEach(b=>b.onclick=async()=>{
        let r=d.items.find(x=>x.id===b.dataset.edit);const article=b.closest('article');b.disabled=true;
        try{r=(await api('/session/'+id+'/queue/'+r.id,{method:'PATCH',body:JSON.stringify({editing:true,revision:r.revision})})).item;}
        catch(err){toast(err.message);b.disabled=false;return;}
        if(!article.isConnected)return;
        article.innerHTML='<p class="sheet-help">This instruction is paused until you save or cancel.</p><label class="sheet-help">Queued instruction<textarea class="queue-editor" aria-label="Edit queued instruction"></textarea></label><div class="queue-actions"><button class="chip" data-save>Save changes</button><button class="chip" data-cancel>Cancel edit</button></div>';
        const key='pc-queue-draft-'+id+'-'+r.id,input=article.querySelector('textarea');input.value=readLocal(key,null)??r.text;input.focus();input.oninput=()=>writeLocal(key,input.value);
        const save=async(text,button)=>{button.disabled=true;try{await api('/session/'+id+'/queue/'+r.id,{method:'PATCH',body:JSON.stringify({text,revision:r.revision})});localStorage.removeItem(key);await load();refreshSessions();}catch(err){toast(err.message);button.disabled=false;}};
        article.querySelector('[data-cancel]').onclick=e=>save(r.text,e.currentTarget);
        article.querySelector('[data-save]').onclick=e=>save(input.value,e.currentTarget);
      });
      const start=target.querySelector('#queue-start');if(start)start.onclick=async()=>{start.disabled=true;
        try{await api('/session/'+id+'/queue/start',{method:'POST',body:JSON.stringify({itemId:d.items[0].id})});closeCurrentSheet?.();if(chatId===id)renderChat(id);}
        catch(e){toast(e.message);await load();}
      };
    }catch(e){if(sh.isConnected)sh.querySelector('#queue-items').textContent=e.message;}
  };
  sh.querySelector('#queue-refresh').onclick=load;await load();
}

/* ---------- session results ---------- */
async function openResults(id) {
  const scrim=document.createElement('div');scrim.className='scrim';
  const sh=document.createElement('div');sh.className='sheet results-sheet';
  sh.innerHTML='<h2>Results & links</h2><p class="sheet-help">Reports, files and links shared in this conversation.</p><div class="results-tools"><input type="search" id="result-query" placeholder="Find a result" aria-label="Find a result"><button class="chip" id="result-refresh">Refresh</button></div><div id="result-list" role="status">Loading results…</div>';
  workspaceMount(scrim,sh,'results');let data={results:[]};
  const paint=()=>{
    const q=sh.querySelector('#result-query').value.trim().toLowerCase();
    const rows=data.results.filter(r=>(r.label+' '+r.detail+' '+r.target).toLowerCase().includes(q));
    sh.querySelector('#result-list').innerHTML=rows.map(r=>{
      const href=r.kind==='file'?'/api/session/'+encodeURIComponent(id)+'/artifact?path='+encodeURIComponent(r.target):PocketFormat.href(r.target);
      if(!href)return '';
      return `<article class="result-row"><a href="${esc(href)}" target="_blank" rel="noopener noreferrer"><span class="result-name">${esc(r.label)}</span><span class="result-detail">${esc(r.detail)}${r.at?' · '+esc(rel(new Date(r.at).getTime())):''}${r.kind==='file'?' · Download':''}</span></a><button class="chip result-copy" data-url="${esc(r.kind==='file'?new URL(href,location.origin).href:r.target)}" aria-label="Copy link for ${esc(r.label)}">Copy link</button></article>`;
    }).join('') || `<p class="empty">${q?'No matching results.':'No results linked yet. Ask the agent to share a report or file link.'}</p>`;
    if(data.truncated||data.limited)sh.querySelector('#result-list').insertAdjacentHTML('beforeend','<p class="sheet-help">Showing recent references. Older results may still be in the conversation.</p>');
    sh.querySelectorAll('.result-copy').forEach(b=>b.onclick=()=>copyText(b.dataset.url,b));
  };
  const load=async()=>{const b=sh.querySelector('#result-refresh');b.disabled=true;
    try {data=await api('/session/'+encodeURIComponent(id)+'/results');if(sh.isConnected)paint();}
    catch(e){if(sh.isConnected)sh.querySelector('#result-list').innerHTML=`<p class="sheet-help">${esc(e.message)}</p>`;}
    finally{b.disabled=false;}
  };
  sh.querySelector('#result-query').oninput=paint;sh.querySelector('#result-refresh').onclick=load;await load();
}

/* ---------- chat ---------- */
let chatRenderVersion = 0;
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
const readingPositions = (()=>{try{return JSON.parse(localStorage.getItem('pc-reading')||'{}');}catch{return {};}})();
let readingTimer;
function rememberReading() {
  const m=$('#msgs')?.closest('main.scroll');if(!m||!chatId)return;
  readingPositions[chatId]={top:m.scrollTop,bottom:m.scrollHeight-m.scrollTop-m.clientHeight<100};
  const keys=Object.keys(readingPositions);if(keys.length>80)delete readingPositions[keys[0]];
  try{localStorage.setItem('pc-reading',JSON.stringify(readingPositions));}catch{}
}
const draftKey = id => 'pc-draft-' + (id || 'new');
const saveDraft = (id, v) => { try { v.trim() ? localStorage.setItem(draftKey(id), v) : localStorage.removeItem(draftKey(id)); } catch { } };
const loadDraft = id => { try { return localStorage.getItem(draftKey(id)) || ''; } catch { return ''; } };
const clearDraft = id => { try { localStorage.removeItem(draftKey(id)); } catch { } };

const isWide = () => matchMedia('(min-width: 900px)').matches;
const railOpen = () => localStorage.getItem('pc-rail') !== 'closed';
const railW = () => Math.min(480, Math.max(220, Number(localStorage.getItem('pc-railw')) || 320));
function withShell(colHtml) { // desktop: session rail + resize grip beside the content column
  if (!railOpen()) return `<div class="split"><div class="chatcol"><nav id="open-sessions" class="open-sessions" aria-label="Open sessions"></nav>${colHtml}</div></div>`;
  return `<div class="split">
    <aside class="rail" style="width:${railW()}px"><a class="skip-chat" href="#conversation">Skip to conversation</a>
      <div class="railhead"><span>Sessions</span><button id="rail-filter-toggle" class="density-toggle" aria-expanded="true" aria-controls="rail-filter-controls" title="Collapse session filters">Filters ${IC.up1}</button><button class="icon" id="railsettings" aria-label="App settings">${IC.cog}</button><button class="icon" id="railnew" aria-label="New session">${IC.plus}</button></div>
      <div id="rail"></div>
    </aside>
    <div class="railgrip" id="grip" role="separator" tabindex="0" aria-orientation="vertical" aria-valuemin="220" aria-valuemax="480" aria-valuenow="${railW()}" aria-label="Resize session list"></div>
    <div class="chatcol"><nav id="open-sessions" class="open-sessions" aria-label="Open sessions"></nav>${colHtml}</div>
  </div>`;
}
function wireShell() {
  paintOpenSessions();
  bindWorkspaceDensity();
  if (!railOpen()) return;
  paintRail();
  $('#railsettings').onclick=settingsSheet;
  $('#railnew').onclick = () => { location.hash = '#/new'; };
  const grip = $('#grip'), rail = document.querySelector('aside.rail');
  grip.onkeydown = e => { if (!['ArrowLeft','ArrowRight'].includes(e.key)) return; e.preventDefault(); const w = Math.min(480, Math.max(220, railW() + (e.key === 'ArrowRight' ? 20 : -20))); rail.style.width = w + 'px'; localStorage.setItem('pc-railw', String(w)); grip.setAttribute('aria-valuenow', String(w)); };
  document.querySelector('.skip-chat').onclick = e => { e.preventDefault(); $('#box')?.focus(); };
  grip.onpointerdown = e => {
    grip.setPointerCapture(e.pointerId);
    grip.onpointermove = ev => {
      const w = Math.min(480, Math.max(220, ev.clientX));
      rail.style.width = w + 'px';
      localStorage.setItem('pc-railw', String(w)); grip.setAttribute('aria-valuenow', String(w));
    };
    grip.onpointerup = () => { grip.onpointermove = null; grip.onpointerup = null; };
  };
}
let railCache = { at: 0, sessions: [] };
async function paintRail() {
  const el = $('#rail'); if (!el) return;
  if (!el.querySelector('.session-panel')) { el.innerHTML = sessionPanelHTML(true); bindSessionPanel(el); }
  await refreshSessions();
}

let chatOffset = 0, extT = null;
function extPulse() { // ember while another surface (code-server) drives this session
  const h = $('#hember'); if (!h) return;
  if (!composerWorking) h.innerHTML = '<span class="ember"></span>';
  clearTimeout(extT);
  extT = setTimeout(() => { const h2 = $('#hember'); if (h2 && !composerWorking) h2.innerHTML = ''; }, 45000);
}

async function renderChat(id) {
  const renderVersion = ++chatRenderVersion;
  stashAttachments();rememberReading();
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
      <button class="icon" id="chatmore" aria-label="Session options">${IC.more}</button>
      <button class="icon" id="header-toggle" aria-label="Collapse conversation header" title="Collapse conversation header" aria-expanded="true" aria-controls="open-sessions cproj chat-statebar">${IC.up1}</button>
    </header>
    <div class="run-confirmation" id="run-confirmation" data-state="unknown"><span id="run-confirmed-state" role="status">Checking server…</span><span id="run-confirmed-at" aria-live="off"></span></div>
    <div class="chat-statebar" id="chat-statebar"><button id="session-switch" class="session-switch">Sessions</button><span id="chat-state"></span><button id="results-open" class="session-switch">Results</button><button id="queue-open" class="session-switch">Queue</button><button id="git-open" class="session-switch">Git</button></div>
    <button class="question-banner" id="questions-open" hidden>Agent needs your answer</button>
    <button class="question-banner" id="approvals-open" hidden>Action needs approval · Review</button>
    <p id="connection-state" class="connection-state" role="status" hidden></p>
    <div class="findbar" id="findbar" hidden>
      <input type="search" id="fq" placeholder="Find in conversation" autocomplete="off" enterkeyhint="search">
      <span class="fcount" id="fcount"></span>
      <button class="icon" id="fprev" aria-label="Previous match">${IC.up1}</button>
      <button class="icon" id="fnext" aria-label="Next match">${IC.down1}</button>
      <button class="icon" id="fclose" aria-label="Close find">${IC.x}</button>
    </div>
    <div class="fmore" id="fmore" hidden></div>
    <main class="scroll"><div class="msgs" id="msgs"></div></main>
    <div class="composerwrap"><div class="delivery-status" id="delivery-status" role="status" hidden></div><div class="slash" id="slash" hidden></div><div class="composer" id="comp"></div></div>`;
  app.innerHTML = withShell(chatCol) + '<input type="file" id="fpick" multiple hidden>';
  wireShell();
  $('#back').onclick = () => { location.hash = '#/'; };
  $('#session-switch').onclick = openSessionSwitcher;
  $('#results-open').onclick = () => openResults(chatId);
  $('#queue-open').onclick = () => openQueue(chatId);
  $('#git-open').onclick = () => openGit(chatId);
  $('#questions-open').onclick=()=>openQuestions(chatId);
  $('#approvals-open').onclick=()=>openApprovals(chatId);
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
  catch (e) { if (renderVersion !== chatRenderVersion) return; toast(e.status === 404 ? 'Session not found' : 'Could not open session: ' + (e.message || 'error')); location.hash = '#/'; return; }
  if (renderVersion !== chatRenderVersion || chatId !== id) return;
  markRead(id, s.state);
  $('#ctitle').textContent = s.title;
  $('#ctitle').title = s.title;
  $('#chat-state').textContent = s.state?.label || (s.active ? 'Running' : s.ext ? 'Activity elsewhere' : 'Recent');
  $('#cproj').textContent = projName(s.cwd);
  rememberOpenSession({...s,id});
  chatTitle = s.title; chatPinned = Boolean(s.pinned);
  const h1 = $('#ctitle').closest('h1');
  h1.classList.add('tappable');
  $('#chatmore').onclick = h1.onclick = () => sessionSheet({ id: chatId, title: chatTitle, pinned: chatPinned }, r => {
    if (typeof r.pinned === 'boolean') chatPinned = r.pinned;
    else if (r.name) { chatTitle = r.name; const t = $('#ctitle'); if (t) t.textContent = r.name; }
    else { renderChat(chatId); return; } // name cleared → resync the derived title
    railCache.at = 0; if (isWide()) paintRail();
  });
  chatOffset = s.size || 0;
  chatTotal = s.total || s.messages.length; chatRendered = s.messages.length;
  const isCx = id.startsWith('cx:');
  tb = { key: id, prefs: getPrefs(id), attachments: loadAttachments(id), allowAttach: true, allowMute: true, provider: isCx ? 'codex' : 'claude' };
  (isCx ? loadCodexModels() : loadClaudeModels()).then(renderToolbar);
  chatMuted = Boolean(s.muted);
  if(s.executionMode){tb.prefs.executionMode=s.executionMode;setPrefs(id,tb.prefs);}
  chatCmds = null;
  api('/commands?provider=' + (isCx?'codex':'claude') + '&cwd=' + encodeURIComponent(s.cwd || '')).then(r => { chatCmds = r.commands; }).catch(() => { });
  $('#fpick').onchange = e => { uploadFiles([...e.target.files]); e.target.value = ''; };
  const msgs = $('#msgs');
  msgs.innerHTML = s.messages.map(msgHTML).join('');
  openLastTodo();
  if (lastMeta && lastMeta.id === id) { msgs.insertAdjacentHTML('beforeend', lastMeta.html); lastMeta = null; }
  setComposer(s.active);
  const reading=readingPositions[id],scroller=msgs.closest('main.scroll');
  if(reading&&!reading.bottom)scroller.scrollTop=reading.top;else scrollBottom(true);
  scroller.addEventListener('scroll',()=>{clearTimeout(readingTimer);readingTimer=setTimeout(rememberReading,200);},{passive:true});
  if (s.ext && !s.active) extPulse();
  paintDelivery(id); refreshSessions();
  refreshQuestions(id);
  refreshApprovals(id);
  restoreDock();
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
    const skill=chatCmds.find(s=>s.name===b.dataset.n);
    box.value = (tb?.provider==='codex'?(skill?.invocation||'Use the $'+b.dataset.n+' skill.'):'/'+b.dataset.n)+' ';
    saveDraft(chatId,box.value);panel.hidden = true; box.focus();
  });
  panel.hidden = false;
}

const sendModes = new Map();
let composerWorking = false;
function setComposer(working) {
  const c = $('#comp'); if (!c) return;
  composerWorking = working;
  $('#hember').innerHTML = working ? '<span class="ember"></span>' : '';
  const p = $('#slash'); if (p) p.hidden = true;
  c.innerHTML = `
    ${working ? `
      <div class="workrow"><span class="ember"></span><span id="work-label">Working</span>
        <button class="icon wbell ${chatMuted ? 'on' : ''}" id="muteb" aria-label="Toggle notifications for this session">${chatMuted ? IC.bellOff : IC.bell}</button>
        <button class="chip stopchip" id="stopb" aria-label="Stop this turn">${IC.stop}Stop</button></div>`
      : `<div class="toolbar" id="tbar"></div><div class="attachrow" id="attrow"></div>`}
    ${working ? '<div class="send-mode" role="group" aria-label="When to send"><button data-mode="steer">Steer now</button><button data-mode="queue">After this turn</button></div>' : ''}
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
  const modeButtons=c.querySelectorAll('[data-mode]');
  const paintMode=()=>modeButtons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===(sendModes.get(chatId)||'steer'))));
  modeButtons.forEach(b=>b.onclick=()=>{sendModes.set(chatId,b.dataset.mode);paintMode();$('#box').placeholder=b.dataset.mode==='queue'?'Run this after the current turn…':'Steer this turn…';});paintMode();
  const box = $('#box');
  const grow = () => sizeComposerBox();
  const draft = loadOutbox(chatId)?.text || loadDraft(chatId);
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
  paintDelivery(chatId);
}

const sendsInFlight = new Set(), deliveryNotices = new Map();
function loadAttachments(id) { try { return JSON.parse(localStorage.getItem('pc-attachments-' + id) || '[]'); } catch { return []; } }
function stashAttachments() { if (tb?.key) { try { localStorage.setItem('pc-attachments-' + tb.key, JSON.stringify(tb.attachments)); } catch { } } }
function loadOutbox(id) { try { return JSON.parse(localStorage.getItem('pc-outbox-' + id) || 'null'); } catch { return null; } }
function saveOutbox(id, value) {
  if (value) localStorage.setItem('pc-outbox-' + id, JSON.stringify(value));
  else localStorage.removeItem('pc-outbox-' + id);
}
function setConnection(message = '') {
  const el = $('#connection-state'); if (!el) return;
  el.textContent = message; el.hidden = !message;
}
function paintDelivery(id = chatId) {
  if (id !== chatId) return;
  const el = $('#delivery-status'); if (!el) return;
  const pending = loadOutbox(id), sending = sendsInFlight.has(id), notice = deliveryNotices.get(id);
  el.hidden = !pending && !notice;
  el.classList.toggle('delivery-problem', Boolean(pending && !sending));
  if (pending) {
    const label = sending ? 'Sending…' : pending.error || 'Delivery was not confirmed. Retry checks the same message.';
    el.innerHTML = `<p>${esc(label)}</p>${!sending ? `<div class="delivery-actions"><button class="chip" id="retry-message">Retry same message</button>${pending.rejected ? '<button class="chip" id="edit-message">Edit message</button>' : '<button class="chip" id="review-message">Review conversation</button>'}<button class="chip" id="discard-message">Discard retry</button></div>` : ''}`;
    const retry = $('#retry-message'); if (retry) retry.onclick = () => submitPending(id);
    const edit = $('#edit-message'); if (edit) edit.onclick = () => { saveOutbox(id, null); deliveryNotices.delete(id); paintDelivery(id); $('#box')?.focus(); };
    const review = $('#review-message'); if (review) review.onclick = () => renderChat(id);
    const discard = $('#discard-message'); if (discard) discard.onclick = () => { saveOutbox(id, null); clearDraft(id); deliveryNotices.delete(id); const box = $('#box'); if (box) box.value = ''; paintDelivery(id); };
  } else el.textContent = notice || '';
  const box = $('#box'), send = $('#send');
  if (box) box.readOnly = Boolean(pending);
  document.querySelectorAll('#c-att,#c-model,#c-eff,#attrow button,[data-mode]').forEach(b => { b.disabled = Boolean(pending); });
  if (send) { send.disabled = Boolean(pending); send.setAttribute('aria-label', pending ? 'Resolve pending delivery first' : 'Send'); }
}
async function sendMsg(text) {
  text = text.trim(); const id = chatId;
  if(uploadsInFlight.get(id)){toast('Wait for the attachment upload to finish.');return;}
  if (!text || !id || sendsInFlight.has(id) || loadOutbox(id)) return;
  const opts = composerWorking ? {mode:sendModes.get(id)||'steer',approvalMode:nextApprovalMode()} : turnOpts();
  const pending = { text, opts, clientMessageId: crypto.randomUUID(),
    files: composerWorking ? [] : [...(tb?.attachments || [])], createdAt: Date.now() };
  try { saveDraft(id, text); saveOutbox(id, pending); }
  catch { toast('Could not save this message on the device. Copy it before trying again.'); return; }
  await submitPending(id);
}
async function submitPending(id) {
  if (sendsInFlight.has(id)) return;
  const pending = loadOutbox(id); if (!pending) return;
  sendsInFlight.add(id); deliveryNotices.delete(id); paintDelivery(id);
  recentSends = [...recentSends.slice(-4), { text: pending.text, at: Date.now() }];
  try {
    const result = await api(`/session/${id}/message`, { method: 'POST', body: JSON.stringify({ text: pending.text, ...pending.opts, clientMessageId: pending.clientMessageId }) });
    saveOutbox(id, null); clearDraft(id);
    if (pending.files.length) localStorage.removeItem('pc-attachments-' + id);
    deliveryNotices.set(id, result.queued ? result.paused ? 'Saved in Queue. Open Queue to start it when ready.' : 'Queued after the current turn.' : result.steered ? 'Sent to the running turn.' : 'Message delivered.');
    if (chatId === id) {
      if (tb?.key === id && pending.files.length) tb.attachments = [];
      const box = $('#box'); if (box) box.value = '';
      // Render the canonical transcript after acknowledgment; no unsent ghost
      // bubble remains on failure, and a replayed receipt adds no duplicate.
      await renderChat(id);
    }
    refreshSessions();
  } catch (e) {
    const rejected = e.status >= 400 && e.status < 500 && e.code !== 'delivery_uncertain';
    pending.rejected = rejected;
    pending.error = e.code === 'delivery_uncertain' ? e.message
      : rejected ? `Not sent: ${e.message}` : 'Delivery not confirmed. Your message is saved. Retry checks the same request.';
    try { saveOutbox(id, pending); } catch { }
    if (chatId === id && $('#box')) $('#box').value = pending.text;
  } finally { sendsInFlight.delete(id); paintDelivery(id); }
}

let recentSends = []; // for deduping our own messages when they echo back via the mirror
function openES() {
  closeES();
  if (!chatId) return;
  const streamId = chatId;
  es = new EventSource(`/api/session/${chatId}/events?offset=${chatOffset}`);
  es.onopen = () => { if (chatId === streamId) setConnection(); };
  const msgs = $('#msgs');
  let live = null; // word-by-word streaming buffer, replaced by the formatted message
  let watching = false; // mirror mode: session is idle here, may be driven elsewhere
  const dropLive = () => { if (live) { live.remove(); live = null; } };
  es.onmessage = ev => {
    if (chatId !== streamId) return;
    let d; try { d = JSON.parse(ev.data); } catch { return; }
    // watch = the daemon has no turn for this session; if we still show "Working",
    // we missed the turn-end events (SSE drop + reconnect after finalize) — clear it
    if(d.type==='questions'){refreshQuestions(streamId);refreshSessions();return;}
    if(d.type==='approvals'){refreshApprovals(streamId);refreshSessions();return;}
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
  es.onerror = () => { if (chatId === streamId) setConnection('Connection interrupted. Reconnecting; your draft is kept.'); };
}

/* resync when the phone comes back — the turn kept running server-side */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') {rememberReading();return;}
  if (location.hash.startsWith('#/chat/') && chatId) renderChat(chatId);
  else if (location.hash === '' || location.hash === '#/') renderList();
});

/* ---------- discover existing agent skills ---------- */
async function openSkills(provider,cwd,box) {
  const scrim=document.createElement('div');scrim.className='scrim';
  const sh=document.createElement('div');sh.className='sheet skills-sheet';
  sh.innerHTML='<h2>Choose a skill</h2><p class="sheet-help">Choose a starting point, then add your instructions before sending.</p><input class="skill-search" type="search" aria-label="Search skills" placeholder="Search skills and tasks"><div class="skill-list" role="status">Loading installed skills…</div>';
  mountSheet(scrim,sh);let skills=[];
  const paint=()=>{
    const q=sh.querySelector('input').value.toLowerCase().trim();
    const hits=skills.filter(s=>(s.name+' '+(s.label||'')+' '+s.desc).toLowerCase().includes(q));
    sh.querySelector('.skill-list').innerHTML=hits.map((s,i)=>`<button class="skill-choice" data-skill="${i}"><span>${esc(s.label||s.name.replace(/[-_]/g,' '))}</span><span class="skill-description">${esc(s.desc||s.name)}</span></button>`).join('')||'<p class="empty">No matching skills. You can still describe your task directly.</p>';
    sh.querySelectorAll('[data-skill]').forEach(b=>b.onclick=()=>{
      const s=hits[Number(b.dataset.skill)];closeCurrentSheet?.();if(!box.isConnected)return;
      box.value=(s.invocation || (provider==='codex'?'Use the $'+s.name+' skill.':'Use the /'+s.name+' skill.'))+'\n\n'+box.value;
      box.dispatchEvent(new Event('input',{bubbles:true}));box.focus();box.setSelectionRange(box.value.length,box.value.length);
    });
  };
  sh.querySelector('input').oninput=paint;
  try{const d=await api('/commands?provider='+provider+'&cwd='+encodeURIComponent(cwd));if(!sh.isConnected)return;skills=d.commands||[];paint();if(d.warning)sh.querySelector('.sheet-help').textContent=d.warning;}
  catch(e){if(sh.isConnected)sh.querySelector('.skill-list').textContent=e.message;}
}

/* ---------- new session ---------- */
async function renderNew() {
  const viewVersion=++chatRenderVersion;
  const pendingNew = loadOutbox('new');
  const col = `
    <header class="bar">
      <button class="icon" id="back" aria-label="Back">${IC.back}</button>
      <h1>New session</h1>
    </header>
    <div id="new-delivery" class="delivery-status" role="status" hidden></div>
    <main class="scroll"><div class="pane task-pane">
      <div><label class="task-heading" for="first">What would you like done?</label><textarea id="first" placeholder="Describe the task, or choose a skill below."></textarea></div>
      <div class="task-actions"><button class="chip" id="choose-skill">Choose a skill</button><button class="chip" id="choose-workspace">Choose workspace</button></div>
      <p class="task-context" id="task-context"></p>
      <div class="toolbar" id="tbar"></div><div class="attachrow" id="attrow"></div>
      <button class="primary" id="start">Start session</button>
      <details id="new-setup"><summary>Workspace & agent settings</summary><div class="setup-fields">
      <div><span class="h" id="agenth">Agent</span><div class="projlist" id="apick" role="radiogroup" aria-labelledby="agenth">
        <button class="row" role="radio" aria-checked="false" data-a="claude"><span class="dot"></span>${IC.term}<span class="p">Claude Code</span></button>
        <button class="row" role="radio" aria-checked="false" data-a="codex"><span class="dot"></span>${IC.term}<span class="p">Codex</span></button>
      </div></div>
      <div><span class="h" id="projh">Project</span><div class="projlist" id="plist" role="radiogroup" aria-labelledby="projh"><div class="empty">Loading…</div></div></div>
      <div><label class="h" for="cpath">Or a custom path</label><input type="text" id="cpath" placeholder="/full/path/to/project" autocapitalize="off" autocorrect="off"></div>
      </div></details>
    </div></main>`;
  app.innerHTML = withShell(col) + '<input type="file" id="fpick" multiple hidden>';
  wireShell();
  $('#back').onclick = () => { location.hash = '#/'; };
  tb = { key: 'new', prefs: pendingNew ? { model: pendingNew.payload.model || 'default', effort: pendingNew.payload.effort || 'default' } : getPrefs('new'), attachments: loadAttachments('new'), allowAttach: true, provider: 'claude' };
  renderToolbar();
  // which agent runs this session — remembered, since most days you stay on one
  let provider = pendingNew?.payload.provider || (localStorage.getItem('pc-provider') === 'codex' ? 'codex' : 'claude');
  let sel = null;
  const context = () => {const cwd=$('#cpath')?.value.trim()||sel;const el=$('#task-context');if(el)el.textContent=(cwd?projName(cwd):'Choose a workspace before starting')+' · '+(provider==='codex'?'Codex':'Claude Code');};
  $('#choose-workspace').onclick=()=>{$('#new-setup').open=true;$('#new-setup').scrollIntoView({block:'start'});};
  $('#cpath').oninput=context;
  $('#choose-skill').onclick=()=>openSkills(provider,$('#cpath').value.trim()||sel||'', $('#first'));
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
    (a === 'codex' ? loadCodexModels() : loadClaudeModels()).then(renderToolbar);context();
  };
  ap.querySelectorAll('.row').forEach(r => r.onclick = () => pickAgent(r.dataset.a));
  pickAgent(provider);
  $('#fpick').onchange = e => { uploadFiles([...e.target.files]); e.target.value = ''; };
  const first = $('#first');
  first.value = pendingNew?.payload.text || loadDraft('new');
  first.oninput = () => saveDraft('new', first.value);
  try {
    const { projects } = await api('/projects');
    if(viewVersion!==chatRenderVersion)return;
    const pl = $('#plist');
    pl.innerHTML = projects.slice(0, 10).map((p, i) => `
      <button class="row" role="radio" aria-checked="false" data-p="${esc(p)}">
        <span class="dot"></span>${IC.folder}<span class="p">${esc(projName(p))}<span class="workspace-path">${esc(projShort(p))}</span></span>
      </button>`).join('');
    const pick = r => {
      pl.querySelectorAll('.row').forEach(x => { x.classList.remove('sel'); x.setAttribute('aria-checked', 'false'); });
      r.classList.add('sel'); r.setAttribute('aria-checked', 'true');
      sel = r.dataset.p; $('#cpath').value = '';context();
    };
    pl.querySelectorAll('.row').forEach(r => r.onclick = () => pick(r));
    // preselect where you last started a session — most people work out of one root
    const last = localStorage.getItem('pc-lastproj');
    const lastRow = last && pl.querySelector(`.row[data-p="${CSS.escape(last)}"]`);
    if (lastRow) pick(lastRow);
  } catch { }
  if(viewVersion!==chatRenderVersion)return;
  if (pendingNew) $('#cpath').value = pendingNew.payload.cwd;context();
  const paintNewDelivery = () => {
    const pending = loadOutbox('new'), note = $('#new-delivery');
    if (!note) return;
    note.hidden = !pending;
    note.innerHTML = pending ? '<p>Start request not yet confirmed. Retry checks the same request.</p><button class="chip" id="discard-new">Discard retry</button>' : '';
    const discard = $('#discard-new'); if (discard) discard.onclick = () => { saveOutbox('new', null); clearDraft('new'); renderNew(); };
    app.querySelectorAll('.pane input,.pane textarea,.pane button:not(#start)').forEach(el => { el.disabled = Boolean(pending); });
    $('#start').textContent = pending ? 'Retry start' : 'Start session';
  };
  paintNewDelivery();
  let newPending = null;
  $('#start').onclick = async () => {
    if(uploadsInFlight.get('new'))return toast('Wait for the attachment upload to finish.');
    const savedStart = loadOutbox('new');
    const cwd = savedStart?.payload.cwd || $('#cpath').value.trim() || sel;
    const text = savedStart?.payload.text || $('#first').value.trim();
    if (!cwd) {$('#new-setup').open=true;$('#new-setup').scrollIntoView({block:'start'});return toast('Choose a workspace or enter its path');}
    if (!text) return toast('Write the first message');
    $('#start').disabled = true; $('#start').textContent = 'Starting…';
    try {
      const payload = savedStart?.payload || { cwd, text, provider, ...turnOpts() };
      const saved = loadOutbox('new');
      if (saved && JSON.stringify(saved.payload) !== JSON.stringify(payload)) return toast('Retry the saved new-session request before changing it.');
      newPending = saved || { payload, clientMessageId: crypto.randomUUID() };
      saveOutbox('new', newPending);
      const { id } = await api('/new', { method: 'POST', body: JSON.stringify({ ...newPending.payload, clientMessageId: newPending.clientMessageId }) });
      setPrefs(id,{model:payload.model||'default',effort:payload.effort||'default',executionMode:payload.executionMode||'work',approvalMode:payload.approvalMode||approvalPolicy.defaultMode});
      saveOutbox('new', null);
      clearDraft('new'); localStorage.removeItem('pc-attachments-new'); if (tb?.key === 'new') tb.attachments = [];
      try { localStorage.setItem('pc-lastproj', cwd); } catch { }
      location.hash = '#/chat/' + id;
    } catch (e) {
      if (e.status >= 400 && e.status < 500 && e.code !== 'delivery_uncertain') saveOutbox('new', null);
      toast(e.message || 'Delivery not confirmed. Retry the same request.');
    } finally { const start = $('#start'); if (start) { start.disabled = false; paintNewDelivery(); } }
  };
}

/* ---------- router ---------- */
async function route() {
  rememberReading();stashAttachments(); closeCurrentSheet?.(); ++chatRenderVersion;
  closeES(); chatId = null;
  try { await api('/me'); } catch { return; } // renders login on 401
  await loadApprovalPolicy();
  dockSurface?.remove();dockSurface=null;
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
  if (closeCurrentSheet) { e.preventDefault(); closeCurrentSheet(); return; }
  const ov = document.querySelector('.overlay');
  if (ov) return ov.remove();
  if (findIsOpen()) return findOpen(false);
  if(dockSurface?.contains(document.activeElement)){e.preventDefault();return dockSurface.querySelector('[data-close-dock]').click();}
  if (inChat && !document.querySelector('.scrim')) location.hash = '#/';
});
window.addEventListener('hashchange', route);
route();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* The online app remains usable without installation support. */ });

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
