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
  info: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
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
  columns: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M12 4.5v15"/></svg>',
  swap: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h13l-3.5-3.5M19 16H6l3.5 3.5"/></svg>',
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
    const { models, defaultLabel, defaultEffort, pocketDefault } = await api('/claude/models');
    if (models?.length) {
      // 4th field = chip text, so Default shows the model it actually runs
      MODELS = [['default', 'Default', `${defaultLabel || 'Global'} · ${pocketDefault ? 'Pocket default' : 'your global setting'}`, defaultLabel || 'Default'],
        ...models.map(m => [m.id, m.label || m.id, m.sub || ''])];
      providerDefaults.claude = { effort: defaultEffort, pocket: pocketDefault };
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
    const { models, defaultModel, defaultEffort, pocketDefault } = await api('/codex/models');
    if (models?.length) {
      const label = defaultModel && (models.find(m => m.id === defaultModel)?.label || defaultModel);
      CODEX_MODELS = [['default', 'Default', label ? `${label} · Pocket default` : 'Your Codex config', label || 'Default'],
        ...models.slice(0, 8).map(m => [m.id, m.label || m.id, ''])];
      providerDefaults.codex = { effort: defaultEffort, pocket: pocketDefault };
    }
  } catch { }
  return CODEX_MODELS;
}
const modelList = () => (tb?.provider === 'codex' ? CODEX_MODELS : MODELS);
// Default effort row names the level Pocket will send; without one it's the CLI's own setting.
const effortList = () => {
  const d = providerDefaults[tb?.provider === 'codex' ? 'codex' : 'claude'], name = d.effort && EFFORT_NAMES[d.effort];
  return [['default', 'Default', name ? `${name} · Pocket default` : tb?.provider === 'codex' ? 'Your Codex config' : 'Your global setting', name || 'Default'], ...EFFORTS];
};
const providerDefaults = { claude: {}, codex: {} };
const EFFORTS = [
  ['max', 'Max', 'Deepest reasoning'],
  ['xhigh', 'X-High', 'Slightly leaner than max'],
  ['high', 'High', 'Balanced'],
  ['medium', 'Medium', 'Quicker, cheaper'],
  ['low', 'Low', 'Snappy, simple tasks'],
];
const EFFORT_NAMES = Object.fromEntries([...EFFORTS.map(([v, l]) => [v, l]), ['ultra', 'Ultra']]);
function getPrefs(key) {
  try {
    const p = { model: 'default', effort: 'default', ...JSON.parse(localStorage.getItem('pc-prefs-' + key) || '{}') };
    if (LEGACY_MODELS[p.model]) p.model = LEGACY_MODELS[p.model];
    return p;
  }
  catch { return { model: 'default', effort: 'default' }; }
}
function setPrefs(key, p) { localStorage.setItem('pc-prefs-' + key, JSON.stringify(p)); }

let closeCurrentSheet = null, sheetReturnFocus = null;
function mountSheet(scrim, sh, trigger = document.activeElement) {
  // A replacement sheet inherits the original, still-connected opener.
  if (trigger?.closest?.('[role="dialog"]')) trigger = sheetReturnFocus;
  closeCurrentSheet?.();
  sheetReturnFocus = trigger;
  const heading = sh.querySelector('h2');
  if (heading) { heading.id = 'sheet-title'; sh.setAttribute('aria-labelledby', heading.id); }
  sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.tabIndex = -1;
  const closeButton = document.createElement('button'); closeButton.className = 'sheet-close icon';
  closeButton.setAttribute('aria-label', 'Close dialog'); closeButton.innerHTML = IC.x;
  sh.prepend(closeButton);
  const close = () => {
    sh.removeEventListener('keydown', keydown); scrim.remove(); sh.remove(); app.inert = false;
    if (closeCurrentSheet === close) { closeCurrentSheet = null; sheetReturnFocus = null; }
    const target = [trigger, $('#chatmore'), $('#railsettings'), $('#settings'), $('#box'), $('#first')]
      .find(el => el?.isConnected && el.getClientRects().length && !el.disabled);
    target?.focus({preventScroll:true});
  };
  // Closed <details> content keeps layout boxes in newer Chrome (content-visibility), so rects alone
  // would count hidden links as tabbable and the trap would let focus escape past the last summary.
  const visible = el => (typeof el.checkVisibility === 'function' ? el.checkVisibility({contentVisibilityAuto:true}) : true) && el.getClientRects().length;
  const focusables = () => [...sh.querySelectorAll('button,input,textarea,select,summary,a[href],[tabindex="0"]')].filter(el => !el.disabled && el.tabIndex >= 0 && visible(el));
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
function tbLabel(list, v) { const o = list.find(o => o[0] === v) || list[0]; return o[3] || o[1]; }
function renderToolbar() {
  const bar = $('#tbar'); if (!bar || !tb) return;
  $('#composer-actions #c-att')?.remove();
  bar.innerHTML = `
    ${tb.allowAttach ? `<button class="chip" id="c-att" aria-label="Attach files">${IC.clip}Attach</button>` : ''}
    <button class="chip ${tb.prefs.model !== 'default' ? 'set' : ''}" id="c-model">${IC.model}${esc(tbLabel(modelList(), tb.prefs.model))}</button>
    <button class="chip ${tb.prefs.effort !== 'default' ? 'set' : ''}" id="c-eff">${IC.gauge}${esc(tbLabel(effortList(), tb.prefs.effort))}</button>
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
  const actions=$('#composer-actions');
  if(att&&actions){att.className='icon composer-attach';att.innerHTML=IC.clip;actions.prepend(att);}
  if (att) att.onclick = () => sheet('Attach a file or screenshot',[['file','Choose files','Select from this device'],['paste','Paste screenshot','Use an image from your clipboard']],null,v=>{if(v==='file')$('#fpick')?.click();else pasteClipboardImage();});
  $('#c-model').onclick = () => sheet('Model for this turn', modelList(), tb.prefs.model,
    v => { tb.prefs.model = v; setPrefs(tb.key, tb.prefs); renderToolbar(); });
  $('#c-eff').onclick = () => sheet('Reasoning effort', effortList(), tb.prefs.effort,
    v => { tb.prefs.effort = v; setPrefs(tb.key, tb.prefs); renderToolbar(); });
  if (loadOutbox(tb.key)) {
    bar.querySelectorAll('button:not(#c-mute)').forEach(b => { b.disabled = true; });
    if(att)att.disabled=true;
    ar?.querySelectorAll('button').forEach(b => { b.disabled = true; });
  }
  const mode=$('#c-mode');if(mode)mode.onclick=()=>sheet('Codex mode for the next turn',[['work','Work normally','Carry out your request'],['plan','Plan first','Explore an approach and answer native questions before implementation']],tb.prefs.executionMode||'work',v=>{tb.prefs.executionMode=v;setPrefs(tb.key,tb.prefs);renderToolbar();});
  $('#c-approval').onclick=()=>chooseApprovalMode();
  paintComposerDensity();
  paintUploadStatus();
  const mu = $('#c-mute');
  if (mu) mu.onclick = () => toggleMute();
  bindToolbarScroll(bar);
}
/* ---------- session options: pin + rename (overlay metadata, server-side) ---------- */
function sessionSheet(s, refresh) { // s: {id, title, pinned}
  if (document.querySelector('.scrim')) return; // one sheet at a time
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const sh = document.createElement('div'); sh.className = 'sheet';
  sh.innerHTML = `
    <h2>Session options</h2>
    <p class="sheet-name">${esc(s.title)}</p>
    ${chatTextControlsHTML()}
    ${s.id===chatId?'<button class="opt" id="so-find">'+IC.search+'<span>Find in conversation</span></button><button class="opt" id="so-changes">'+IC.diff+'<span>Changed files</span></button>':''}
    ${!PANE && chatId && s.id !== chatId && isWide() ? '<button class="opt" id="so-beside">'+IC.columns+'<span>Open beside<span class="sub">Show it next to the current conversation</span></span></button>' : ''}
    ${!PANE && s.id === chatId ? '<button class="opt" id="so-close">'+IC.x+'<span>Close session process<span class="sub">Release its server process. If work is running, choose whether to keep it running or stop it</span></span></button>' : ''}
    ${s.id===chatId?'<button class="opt" id="so-usage">'+IC.gauge+'<span>Plan usage<span class="sub">5-hour and weekly limits, extra-usage status</span></span></button>':''}
    <button class="opt" id="so-permissions">${IC.cog}<span>Permissions for the next turn<span class="sub">${permissionLabel(nextApprovalMode(getPrefs(s.id)))}. Running work keeps its current permissions.</span></span></button>
    <button class="opt" id="so-pin">${IC.pin}<span>${s.pinned ? 'Unpin session' : 'Pin session'}<span class="sub">${s.pinned ? 'Back to its place by recency' : 'Keep it at the top of the list'}</span></span></button>
    <button class="opt" id="so-hide">${IC.folder}<span>${isHiddenSession(allSessions.find(r=>r.id===s.id)||s)?'Restore to session list':'Hide from this device'}<span class="sub">History stays intact. New activity brings it back.</span></span></button>
    <button class="opt" id="so-ren">${IC.pen}<span>Rename<span class="sub">Your title, on every device — clear it to go back to the automatic one</span></span></button>
    ${s.id===chatId?'<button class="opt" id="so-version">'+IC.info+'<span>Version & updates<span class="sub" id="so-version-sub">'+esc(appVersionLabel())+'</span></span></button>':''}`;
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
  sh.querySelector('#so-beside')?.addEventListener('click',()=>{close();openBeside(s.id);});
  sh.querySelector('#so-close')?.addEventListener('click',()=>{close();closeMainPane();});
  sh.querySelector('#so-permissions').onclick=()=>{close();chooseApprovalMode(s.id);};
  sh.querySelector('#so-usage')?.addEventListener('click',openUsagePanel);
  sh.querySelector('#so-version')?.addEventListener('click',()=>settingsSheet({about:true}));
  if (sh.querySelector('#so-version')) loadAppRelease().then(()=>{const sub=sh.querySelector('#so-version-sub');if(sub)sub.textContent=appVersionLabel();});
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
  if (tb.key !== NEW_KEY && composerWorking) { toast('Attach files after this turn finishes.'); return null; }
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
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
// Stale-build notice: an open window keeps running the build it loaded, even after the server updates and
// the service worker swaps the cache. Ask the server once a minute and when the app returns to the
// foreground; if its build is newer and nothing is mid-send, offer a reload.
let staleBannerShown = false;
async function checkStaleBuild() {
  if (!APP_V || staleBannerShown || document.visibilityState !== 'visible' || document.querySelector('.login')) return;
  try {
    const r = await fetch('/api/about', { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    if (!r.ok) return;                                   // /api/about reports the build the running server started with
    const j = await r.json(); const v = Number(j?.assetV) || 0;
    if (v > APP_V && sendsInFlight.size === 0) {
      staleBannerShown = true;
      const b = document.createElement('button'); b.className = 'stale-banner'; b.type = 'button';
      b.innerHTML = `New Pocket Code build ${v} is on the server (you are on ${APP_V}). Tap to reload.`;
      b.onclick = () => location.reload();
      document.body.append(b);
    }
  } catch { }
}
setInterval(checkStaleBuild, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(checkStaleBuild, 1500); });
setTimeout(checkStaleBuild, 4000);
async function api(path, opts) {
  const r = await fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...opts });
  if (r.status === 401) { renderLogin(); throw new Error('login'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status, code: j.code });
  return j;
}

function renderUnreachable(e) {
  app.innerHTML = `<div class="login" data-offline><h1>Pocket Code</h1><p class="sub">${navigator.onLine === false ? 'You’re offline.' : 'The server didn’t answer' + (e?.status ? ' (' + esc(String(e.status)) + ')' : '') + '.'} Your drafts are kept.</p><button class="chip" id="retry-route">Try again</button></div>`;
  $('#retry-route').onclick = () => route();
  clearTimeout(renderUnreachable.timer);
  renderUnreachable.timer = setTimeout(() => { if (document.querySelector('[data-offline]')) route(); }, 10000);
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
// A failed registration must never hold the rest of the interface hostage.
async function pushRegistration() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  let timer;
  try {
    return await Promise.race([navigator.serviceWorker.ready, new Promise(resolve => { timer = setTimeout(() => resolve(null), 1500); })]);
  } catch { return null; }
  finally { clearTimeout(timer); }
}
async function pushState() {
  try { const reg = await pushRegistration(); return reg ? await reg.pushManager.getSubscription() : null; }
  catch { return null; }
}
async function togglePush(btn) {
  if (btn) btn.disabled = true;
  try {
    const reg = await pushRegistration();
    if (!reg) { toast('Notifications unavailable. Reload the app and try again.'); return; }
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
      toast('Turn-finished notifications off');
    } else {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return toast('Notifications blocked. Allow notifications in this site’s browser settings.');
      const { key } = await api('/push/key');
      if (!key) return toast('Push not configured on server');
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(key) });
      await api('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
      toast('You’ll get a notification when a turn finishes');
    }
    const now = await pushState();
    if (btn?.id === 'bell') { btn.innerHTML = now ? IC.bell : IC.bellOff; btn.classList.toggle('on', Boolean(now)); }
  } catch (e) { toast('Notification setup failed: ' + e.message); }
  finally { if (btn) btn.disabled = false; }
}

/* ---------- settings sheet (version, update check, chime, notifications) ---------- */
// This browser's release metadata (semantic version + notes), fetched once and only
// trusted when it matches the loaded asset build.
let appRelease = null, appReleaseLoad = null;
const loadAppRelease = () => appReleaseLoad ??= fetch('/release.json?v=' + APP_V, {signal:AbortSignal.timeout(8000)})
  .then(r => r.ok ? r.json() : null).then(r => { if (r?.assetV === APP_V) appRelease = r; return appRelease; })
  .catch(() => { appReleaseLoad = null; return null; });
const appVersionLabel = () => `Pocket Code ${appRelease?.version ? appRelease.version + ' · ' : ''}build ${APP_V ?? '?'}`;
const REPO_URL = 'https://github.com/bbesner/pocket-code';
// GitHub issue forms accept field ids as query parameters; `version` prefills the form's version field.
const issueUrl = (template, version) => `${REPO_URL}/issues/new?template=${template}.yml&version=${encodeURIComponent(version || ('build ' + (APP_V ?? '?')))}`;
const APP_V = Number((document.querySelector('script[src*="app.js"]')?.src.match(/v=(\d+)/) || [])[1]) || null;
async function hardRefresh() {
  try {
    if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch { }
  location.reload();
}
async function settingsSheet({about = false} = {}) {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const sh = document.createElement('div'); sh.className = 'sheet settings-sheet';
  const chimeOn = localStorage.getItem('pc-chime') !== 'off';
  let srv = null;
  sh.innerHTML = `
    <h2>Settings</h2>
    ${chatTextControlsHTML()}
    ${accentControlsHTML()}
    <button class="opt" id="s-environment">${IC.model}<span>Accounts & instance<span class="sub">Provider sign-ins and supported controls</span></span></button>
    <button class="opt" id="s-usage">${IC.gauge}<span>Plan usage<span class="sub">5-hour and weekly limits, extra-usage status</span></span></button>
    <button class="opt" id="s-keys">${IC.term}<span>Keyboard & workspace<span class="sub">Shortcuts and open-session tabs</span></span></button>
    <button class="opt" id="s-chime" aria-pressed="${chimeOn}"><span class="dot ${chimeOn ? 'on' : ''}"></span><span>Completion chime<span class="sub">Two-note blip when a turn finishes on screen</span></span></button>
    <button class="opt" id="s-tools" aria-pressed="${toolsCollapsed()}"><span class="dot ${toolsCollapsed() ? 'on' : ''}"></span><span>Collapse tool calls<span class="sub">Fold Bash, Edit and other actions behind a one-line summary</span></span></button>
    <button class="opt" id="s-push" aria-pressed="false"><span class="dot"></span><span>Turn notifications<span class="sub" id="s-push-state">Checking notification support…</span></span></button>
    <button class="opt" id="s-sync" disabled aria-pressed="false"><span class="dot"></span><span>Sync names with code-server<span class="sub" id="s-sync-state">Loading name-sync setting…</span></span></button>
    <button class="chip" id="s-sync-retry" hidden>Retry name-sync setting</button>
    ${Voice.settingsHTML()}
    <details class="settings-details" id="s-about"${about ? ' open' : ''}><summary>About & updates<span class="summary-meta" id="s-about-version"></span></summary>
      <div class="about" id="s-version-info"></div><p id="s-version-state" role="status">Checking for updates…</p>
      <button class="chip" id="s-check">Check again</button><button class="primary" id="s-refresh" hidden></button>
    </details>
    <details class="settings-details" id="s-notes"><summary>What's new</summary><div class="whatsnew" id="s-notes-body">Loading release notes…</div></details>
    <details class="settings-details" id="s-feedback"><summary>Bugs & feature requests</summary>
      <div class="feedback">
        <p>Pocket Code is developed in the open. Reports go to GitHub Issues, with your version filled in.</p>
        <div class="feedback-links">
          <a class="chip" id="s-report-bug" href="${esc(issueUrl('bug_report'))}" target="_blank" rel="noopener noreferrer">Report a bug</a>
          <a class="chip" id="s-request-feature" href="${esc(issueUrl('feature_request'))}" target="_blank" rel="noopener noreferrer">Request a feature</a>
        </div>
        <p>Found a security problem? <a href="${REPO_URL}/security/advisories/new" target="_blank" rel="noopener noreferrer">Report it privately</a>, not as a public issue.</p>
      </div>
    </details>`;
  mountSheet(scrim, sh);
  if (about) sh.querySelector('#s-about').scrollIntoView({block:'start'});
  bindChatTextControls(sh);
  bindAccentControls(sh);
  Voice.bindSettings(sh);
  sh.querySelector('#s-environment').onclick = openEnvironment;
  sh.querySelector('#s-usage').onclick = openUsagePanel;
  sh.querySelector('#s-keys').onclick = keyboardHelp;
  sh.querySelector('#s-tools').onclick = e => {
    const on = !toolsCollapsed();
    writeLocal('pc-tools-collapsed', on);
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.querySelector('.dot').classList.toggle('on', on);
    document.querySelectorAll('details.ledgerwrap').forEach(d => { d.open = !on; });
  };
  sh.querySelector('#s-chime').onclick = e => {
    const on = localStorage.getItem('pc-chime') === 'off';
    localStorage.setItem('pc-chime', on ? 'on' : 'off');
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.querySelector('.dot').classList.toggle('on', on);
  };
  const refreshPush = async () => {
    const reg = await pushRegistration();
    let sub = null;
    try { if (reg) sub = await reg.pushManager.getSubscription(); } catch { }
    if (!sh.isConnected) return;
    const btn = sh.querySelector('#s-push');
    btn.setAttribute('aria-pressed', String(Boolean(sub)));
    btn.querySelector('.dot').classList.toggle('on', Boolean(sub));
    sh.querySelector('#s-push-state').textContent = reg ? 'Push to this device when a turn finishes' : 'Unavailable. Reload the app or tap to retry.';
  };
  sh.querySelector('#s-push').onclick = async e => { await togglePush(e.currentTarget); await refreshPush(); };
  const loadSettings = async () => {
    const btn = sh.querySelector('#s-sync'), retry = sh.querySelector('#s-sync-retry');
    btn.disabled = true; retry.hidden = true;
    try {
      srv = await api('/settings', {signal:AbortSignal.timeout(8000)});
      if (!sh.isConnected) return;
      btn.disabled = false; btn.setAttribute('aria-pressed', String(Boolean(srv.titleSync)));
      btn.querySelector('.dot').classList.toggle('on', Boolean(srv.titleSync));
      sh.querySelector('#s-sync-state').textContent = "Session names follow Claude Code's titles, and renames here show there too";
    } catch {
      if (sh.isConnected) { sh.querySelector('#s-sync-state').textContent = 'Could not load this setting.'; retry.hidden = false; }
    }
  };
  sh.querySelector('#s-sync-retry').onclick = loadSettings;
  sh.querySelector('#s-sync').onclick = async e => {
    const btn = e.currentTarget; if (!srv) return; btn.disabled = true;
    try {
      srv = await api('/settings', { method: 'POST', body: JSON.stringify({ titleSync: !srv.titleSync }), signal:AbortSignal.timeout(8000) });
      if (!sh.isConnected) return;
      btn.querySelector('.dot').classList.toggle('on', Boolean(srv.titleSync)); btn.setAttribute('aria-pressed', String(Boolean(srv.titleSync)));
      toast(srv.titleSync ? 'Session names now sync with code-server' : 'Name sync off. Pocket names stay local');
    } catch (err) { toast('Could not save: ' + err.message); }
    finally { btn.disabled = false; }
  };
  const checkVersion = async () => {
    const check = sh.querySelector('#s-check'), status = sh.querySelector('#s-version-state'), refresh = sh.querySelector('#s-refresh');
    check.disabled = true; status.textContent = 'Checking for updates…'; refresh.hidden = true;
    const [about, release] = await Promise.allSettled([
      api('/about', {signal:AbortSignal.timeout(8000)}),
      fetch('/release.json?v=' + APP_V, {signal:AbortSignal.timeout(8000),cache:'no-store'}).then(r => {if (!r.ok) throw Error('release unavailable');return r.json();}),
    ]);
    if (!sh.isConnected) return;
    const a = about.status === 'fulfilled' && about.value && typeof about.value === 'object' ? about.value : {};
    const client = release.status === 'fulfilled' && release.value?.assetV === APP_V ? release.value : null;
    if (client) appRelease = client;
    sh.querySelector('#s-about-version').textContent = appVersionLabel().replace('Pocket Code ', '');
    const notes = client?.notes || a.notes;
    const up = a.uptime ? (a.uptime > 5400 ? Math.round(a.uptime / 3600) + 'h' : Math.round(a.uptime / 60) + 'm') : '?';
    sh.querySelector('#s-version-info').innerHTML = `
      <div class="arow"><span>App</span><b>${esc(client?.version || 'Pocket Code')} · build ${APP_V ?? '?'}</b></div>
      <div class="arow"><span>Server</span><b>build ${a.assetV ?? '?'} · ${esc(a.commit || '?')}</b></div>
      <div class="arow"><span>Claude CLI</span><b>${esc(a.cli || '?')}</b></div>
      <div class="arow"><span>Codex CLI</span><b>${esc(a.codex || '?')}</b></div>
      <div class="arow"><span>Box</span><b>${esc(a.host || '?')} · up ${up}</b></div>`;
    const checked = about.status === 'fulfilled' && Number.isFinite(a.assetV) && a.assetV > 0;
    const newer = Math.max(checked ? a.assetV : 0, release.status === 'fulfilled' ? Number(release.value?.assetV) || 0 : 0);
    status.textContent = !checked ? 'Could not check for updates. Try again.' : newer > APP_V ? 'An update is available.' : a.assetV < APP_V ? 'This browser is newer than the server. Server update pending.' : 'Up to date';
    if (newer > APP_V) { refresh.hidden = false; refresh.textContent = 'Update available: refresh to build ' + newer; }
    const serverBuild = checked && a.assetV !== APP_V ? ` (server build ${a.assetV}${a.commit ? ' · ' + a.commit : ''})` : '';
    const versionLabel = `${client?.version || 'Pocket Code'} / build ${APP_V ?? '?'}${serverBuild}`;
    sh.querySelector('#s-report-bug').href = issueUrl('bug_report', versionLabel);
    sh.querySelector('#s-request-feature').href = issueUrl('feature_request', versionLabel);
    sh.querySelector('#s-notes-body').innerHTML = Array.isArray(notes) && notes.length ? '<ul>' + notes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '<p>Release notes are unavailable. Check again to retry.</p>';
    check.disabled = false;
  };
  sh.querySelector('#s-check').onclick = checkVersion;
  sh.querySelector('#s-refresh').onclick = hardRefresh;
  // The sheet is already usable; these independent services update only their own rows.
  refreshPush(); loadSettings(); checkVersion();
}

/* ---------- sessions list ---------- */
let allSessions = [], sessionFilter = 'all', sessionQuery = '', sessionCheckedAt = 0, sessionWarnings = [], sessionsStale = false;
let sessionFetch = null;
let sessionProofReceivedAt=0,sessionProofReceivedWallAt=0;
const seenAt = id => { try { return Number(localStorage.getItem('pc-seen-' + id)) || 0; } catch { return 0; } };
const needsAttention = s => s.state?.kind === 'input' || s.state?.kind === 'failed' && (s.state.at || 0) > seenAt(s.id);
const isUnread = s => s.state?.kind === 'finished' && (s.state.at || 0) > seenAt(s.id);
// The Attention filter and count: anything waiting on you, including a finished reply (Response ready) you
// have not opened yet. Grouping and voice keep needsAttention, which means a question, approval or failure.
const inAttention = s => needsAttention(s) || isUnread(s);
// A reply that finishes while its conversation is already on screen counts as read only after you engage
// with the page (tap, click, type, scroll, return to the tab or navigate). Voice mode keeps the screen awake
// while you wait for a spoken reply, so a visible page alone no longer proves you saw it.
const awaitingEngagement = new Set();
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, () => awaitingEngagement.clear(), { capture: true, passive: true });
addEventListener('hashchange', () => awaitingEngagement.clear());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') awaitingEngagement.clear(); });
function markRead(id, state) { if (document.visibilityState === 'visible' && state?.at && !awaitingEngagement.has(id)) { try { localStorage.setItem('pc-seen-' + id, String(state.at)); } catch { } } }
function rowState(s) { return s.state || { kind: s.active ? 'observed' : 'idle', label: s.active ? 'Activity elsewhere' : 'Recent' }; }
// The list announces a finished reply only until it has been opened; afterwards it is an ordinary recent session.
function listState(s) { const state = rowState(s); return state.kind === 'finished' && !isUnread(s) ? { ...state, kind: 'idle', label: 'Recent' } : state; }
function sessionCounts() {
  if(sessionsStale)return {running:0,input:0,observed:0,attention:allSessions.filter(inAttention).length,fresh:allSessions.filter(isUnread).length};
  return { running: allSessions.filter(s => rowState(s).kind === 'running').length,
    input:allSessions.filter(s=>rowState(s).kind==='input').length,
    observed: allSessions.filter(s => rowState(s).kind === 'observed').length,
    attention: allSessions.filter(inAttention).length,
    fresh: allSessions.filter(isUnread).length };
}
function sessionSummary() {
  if (sessionsStale) return 'Status unavailable. Showing the last saved list.';
  if (!sessionCheckedAt) return 'Checking your sessions…';
  const c = sessionCounts();
  return [c.running ? `${c.running} running` : 'No confirmed runs', c.observed ? `${c.observed} with activity elsewhere` : '', c.attention ? `${c.attention} need attention` : ''].filter(Boolean).join(' · ');
}
function filterButtons(keys) {
  const c = sessionCounts();
  return [['all','All',null],['active','Active',c.running+c.observed+c.input],['attention','Attention',c.attention],['new','New',c.fresh],['pinned','Pinned',null],['hidden','Hidden',null]].filter(([key]) => !keys || keys.includes(key)).map(([key,label,count]) =>
    `<button type="button" data-filter="${key}" aria-pressed="${sessionFilter === key}">${label}${count ? `<span>${count}</span>` : ''}</button>`).join('');
}
function filteredSessions() {
  const needle = sessionQuery.trim().toLowerCase();
  return allSessions.filter(s => (!workspaceFilter||s.cwd===workspaceFilter)&&(!providerFilter||s.provider===providerFilter)&&(sessionFilter==='hidden'?isHiddenSession(s):!isHiddenSession(s))&&(!needle || (s.title + ' ' + (s.cwd || '')).toLowerCase().includes(needle)) &&
    (sessionFilter === 'all' || sessionFilter === 'active' && ['running','observed','input'].includes(rowState(s).kind) ||
     sessionFilter === 'attention' && inAttention(s) || sessionFilter === 'new' && isUnread(s) || sessionFilter==='pinned'&&s.pinned || sessionFilter==='hidden'));
}
function sessionRowHTML(s) {
  const state = listState(s), running = state.kind === 'running';
  const detail = running && state.startedAt ? `Started ${rel(state.startedAt)}`
    : state.kind === 'observed' ? 'Recent transcript activity; run status unconfirmed'
    : state.kind === 'waiting' && state.retryAt ? `Retry at ${new Date(state.retryAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}` : `Updated ${rel(s.mtimeMs)}`;
  return `<div class="session-item ${s.id === chatId ? 'cur' : ''} ${s.pinned ? 'pinned' : ''}">
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
    // Pinned sessions first inside each group, then an accent-coloured rule before the rest.
    const pinned = rows.filter(s => s.pinned), rest = rows.filter(s => !s.pinned);
    const body = pinned.map(sessionRowHTML).join('') + (pinned.length && rest.length ? '<div class="pin-divider" role="separator" aria-label="Pinned sessions above, others below"></div>' : '') + rest.map(sessionRowHTML).join('');
    return rows.length ? `<section class="session-group"><h2>${label}<span>${rows.length}</span></h2>${body}</section>` : '';
  }).join('');
}
function paintSessionPanels() {
  paintWorkspaceFilters();
  paintWorkspaceDensity();
  document.querySelectorAll('[data-session-summary]').forEach(el => { el.textContent = sessionSummary(); });
  document.querySelectorAll('[data-session-filters]').forEach(el => {
    const focused = el.contains(document.activeElement) ? document.activeElement.dataset.filter : null;
    el.innerHTML = filterButtons(el.dataset.filterKeys?.split(' '));
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
  const ab=$('#approvals-open');if(ab){ab.hidden=!current?.state?.approvals;if(current?.state?.approvals)ab.textContent=(current.state.label||'Action needs approval')+' · Review';}
  if (current && $('#chat-state')) { $('#chat-state').textContent = sessionsStale ? 'Unconfirmed' : rowState(current).label; if (!sessionsStale) markRead(chatId, current.state); }
  const queueButton=$('#queue-open');if(queueButton)queueButton.textContent='Queue'+(current?.state?.queued?' ('+current.state.queued+')':'');
  if(current?.state?.confirmed&&['finished','failed','stopped','ended'].includes(current.state.kind)&&!sessionsStale&&!loadOutbox(chatId)){deliveryNotices.delete(chatId);paintDelivery(chatId);}
  paintSessionFilterSummaries();
  paintRunConfirmation();
  const quick = $('#session-switch');
  if (quick) { const c = sessionCounts(); quick.textContent = sessionsStale ? 'Sessions · status unavailable' : `Sessions · ${c.running} running${c.observed ? ` · ${c.observed} elsewhere` : ''}`; }
}
async function refreshSessions() {
  if (sessionFetch) return sessionFetch;
  sessionFetch = (async () => {
    try { const d = await api('/sessions?limit=200&statusCheck='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(8000)}); allSessions = d.sessions; sessionWarnings = d.warnings || []; if(!Number.isFinite(d.checkedAt)||d.checkedAt<=0||d.checkedAt<=sessionCheckedAt)throw new Error('No fresh server confirmation');sessionCheckedAt = d.checkedAt;sessionProofReceivedAt=performance.now();sessionProofReceivedWallAt=Date.now(); sessionsStale = false; const current = allSessions.find(s => s.id === chatId); if (current) markRead(chatId, current.state); }
    catch { sessionsStale = true; }
    finally { sessionFetch = null; paintSessionPanels(); if (!sessionsStale) Voice.onSessions(allSessions); }
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
    ${rail ? `<div id="rail-filter-summary" class="rail-filter-summary" hidden><span></span><button id="clear-rail-filters">Clear filters</button></div><div id="rail-filter-controls">${summary}${filters}</div>` : `<nav class="session-filters" data-session-filters data-filter-keys="all active attention" aria-label="Session shortcuts">${filterButtons(['all','active','attention'])}</nav><details class="session-more-filters" data-more-filters ${readLocal('pc-session-filters-open',false)?'open':''}><summary>Filters<span data-filter-summary></span></summary>${`<div data-workspace-filters></div><nav class="session-filters" data-session-filters data-filter-keys="new pinned hidden" aria-label="More session filters">${filterButtons(['new','pinned','hidden'])}</nav>`}</details><button class="chip clear-more-filters" data-clear-more-filters hidden>Clear filters</button>`}
    <p class="session-warning" data-session-warning hidden></p>
    <div class="session-results" data-session-results></div>
    <p class="session-footnote">Recent history and all runs owned by Pocket Code. External activity is an estimate.</p>
  </div>`;
}
function bindSessionPanel(container) {
  container.querySelectorAll('[data-session-search]').forEach(input => input.oninput = e => { sessionQuery = e.target.value; paintSessionPanels(); });
  container.querySelectorAll('[data-more-filters]').forEach(el => {
    el.querySelector('summary').onclick = e => {e.preventDefault();el.open=!el.open;writeLocal('pc-session-filters-open',el.open);};
  });
  container.querySelectorAll('[data-clear-more-filters]').forEach(el => {el.onclick = () => {workspaceFilter='';providerFilter='';sessionFilter='all';writeLocal('pc-workspace-filter','');writeLocal('pc-provider-filter','');container.querySelector('[data-more-filters] summary')?.focus();paintSessionPanels();};});
  paintSessionPanels();
}
async function renderList() {
  Voice.onLeave();
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
window.addEventListener('online', () => { if (document.querySelector('[data-offline]')) return route(); refreshSessions(); if (chatId) openES(); });

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

// One fold per run of tool calls, even when Claude emits each call as its own transcript message: after a
// render, consecutive folds (end of one assistant message -> start of the next, or back-to-back inside one)
// are merged into the first, so a turn reads prose / one fold / prose. The summary shows the count and the
// latest call, so it keeps changing while a turn runs; expanding shows every call in order.
function foldSummary(d) {
  const items = d.querySelectorAll('.ledgerlist > .ledger');
  const last = items[items.length - 1];
  const name = last?.querySelector('.name')?.textContent || '', det = last?.querySelector('.det')?.textContent || '';
  const sum = d.querySelector(':scope > summary'); if (!sum) return;
  const html = `<span class="tc-count">${items.length} tool call${items.length === 1 ? '' : 's'}</span><span class="tc-last">${esc(name)} ${esc(det)}</span>`;
  if (sum.innerHTML !== html) sum.innerHTML = html;
}
function mergeToolFolds(container) {
  if (!container) return;
  const isFold = el => el?.matches?.('details.ledgerwrap');
  const content = el => [...el.children].filter(c => !c.matches('.copybtn'));
  for (const d of [...container.querySelectorAll('details.ledgerwrap')]) {
    if (!d.isConnected) continue;
    let target = null;
    const prevEl = d.previousElementSibling;
    if (isFold(prevEl)) target = prevEl;                       // back-to-back inside one message
    else {
      const msg = d.closest('.m-asst');
      if (msg && content(msg)[0] === d) {                       // first thing in this message
        // Walk back over empty streaming placeholders (.m-asst.live with no text) and attachment rows so a
        // run of single-tool messages still collapses into one fold while the turn is streaming.
        let q = msg.previousElementSibling;
        while (q && ((q.matches('.m-asst.live') && !q.textContent.trim()) || q.matches('.m-files'))) q = q.previousElementSibling;
        if (q?.matches('.m-asst') && isFold(q.lastElementChild)) target = q.lastElementChild;
      }
    }
    if (!target) { foldSummary(d); continue; }
    const list = target.querySelector('.ledgerlist');
    for (const li of [...d.querySelectorAll('.ledgerlist > .ledger')]) list.append(li);
    if (d.open) target.open = true;
    const msg = d.closest('.m-asst'); d.remove();
    if (msg && content(msg).length === 0) msg.remove();
    foldSummary(target);
  }
}
function toolsCollapsed() { return readLocal('pc-tools-collapsed', true) !== false; }
// Reply suggestions: the agent ends a question with a ```choices block (see choices.mjs); the server turns it
// into {t:'choices', options}. They show only under the latest reply of a finished turn, while the message
// box is empty, until dismissed. A tap sends the option as the next message.
function choicesHTML(options) {
  if (!options.length) return '';
  return `<div class="choices" role="group" aria-label="Suggested replies" data-choices="${esc(options.join('\u241e'))}" hidden>${
    options.map(o => `<button type="button" class="choice" data-choice="${esc(o)}">${esc(o)}</button>`).join('')
  }<button type="button" class="choice-x" aria-label="Dismiss suggested replies and type your own" title="Dismiss">${IC.x}</button></div>`;
}
function paintChoices() {
  const msgs = $('#msgs'); if (!msgs) return;
  const sets = msgs.querySelectorAll('[data-choices]'); if (!sets.length) return;
  const last = [...msgs.children].filter(e => e.matches('.m-user, .m-asst:not(.live)')).pop();
  const box = $('#box'), dismissed = readLocal('pc-choices-dismissed', {})[chatId];
  const open = !composerWorking && !sendsInFlight.has(chatId) && !loadOutbox(chatId) && !box?.value.trim() && !box?.readOnly;
  sets.forEach(c => { c.hidden = !(open && c.closest('.m-asst') === last && c.dataset.choices !== dismissed); });
}
document.addEventListener('click', e => {
  const x = e.target.closest?.('.choice-x');
  if (x) {
    const set = x.closest('[data-choices]'), m = readLocal('pc-choices-dismissed', {});
    delete m[chatId]; m[chatId] = set.dataset.choices;                          // newest last, so pruning drops the oldest
    const keys = Object.keys(m); keys.slice(0, Math.max(0, keys.length - 100)).forEach(k => delete m[k]);
    writeLocal('pc-choices-dismissed', m); set.hidden = true; $('#box')?.focus();
    return;
  }
  const b = e.target.closest?.('.choice');
  if (b && chatId) { b.closest('[data-choices]').hidden = true; sendMsg(b.dataset.choice); }
});
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
    let h = `<div class="m-user enter${m.pending ? ' pending' : ''}">${esc(m.text)}</div>`;   // pending: sent, not in the transcript yet
    if (m.files?.length) h += `<div class="m-files">${m.files.map(fileChip).join('')}</div>`;
    return h;
  }
  const parts = [];
  let tools = [];
  // Tool calls are folded behind a one-line summary (Settings > Collapse tool calls, default on) so a
  // reply reads as prose; open the fold to see the Bash/Edit/Read ledger. Copy-message skips it either way.
  const flush = () => {
    if (tools.length) {
      parts.push(`<details class="ledgerwrap"${toolsCollapsed() ? '' : ' open'}><summary></summary><div class="ledgerlist">${tools.join('')}</div></details>`);
      tools = [];
    }
  };
  for (const b of m.blocks || []) {
    if (b.t === 'tool') tools.push(ledgerHTML(b.name, b.detail));
    else if (b.t === 'todo') { flush(); parts.push(todoHTML(b.todos || [])); }
    else if (b.t === 'choices') { flush(); parts.push(choicesHTML(b.options || [])); }
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
    clone.querySelectorAll('.copybtn, .ledgerwrap, .choices').forEach(n => n.remove()); // prose + code, not machinery
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
  const inputId = colHtml.includes('id="first"') ? 'first' : 'box';
  if (PANE) return `<div class="split"><div class="chatcol">${colHtml}</div></div>`; // the outer window has the rail and tabs
  if (!railOpen()) return `<div class="split"><div class="chatcol"><nav id="open-sessions" class="open-sessions" aria-label="Open sessions"></nav>${colHtml}</div></div>`;
  return `<div class="split">
    <aside class="rail" style="width:${railW()}px"><a class="skip-chat" href="#${inputId}">${inputId==='first'?'Skip to task':'Skip to message'}</a>
      <div class="railhead"><span>Sessions</span><button id="rail-filter-toggle" class="density-toggle" aria-expanded="true" aria-controls="rail-filter-controls" title="Collapse session filters">Filters ${IC.up1}</button><button class="icon" id="railsettings" aria-label="App settings">${IC.cog}</button><button class="icon" id="railnew" aria-label="New session">${IC.plus}</button></div>
      <div id="rail"></div>
    </aside>
    <div class="rail-resize-region" role="region" aria-label="Session list layout"><div class="railgrip" id="grip" role="separator" tabindex="0" aria-orientation="vertical" aria-valuemin="220" aria-valuemax="480" aria-valuenow="${railW()}" aria-label="Resize session list"></div></div>
    <div class="chatcol"><nav id="open-sessions" class="open-sessions" aria-label="Open sessions"></nav>${colHtml}</div>
  </div>`;
}
function wireShell() {
  paintOpenSessions();
  if (typeof sizeMainForSplit === 'function') sizeMainForSplit();
  bindWorkspaceDensity();
  if (PANE || !railOpen()) return;
  paintRail();
  $('#railsettings').onclick=settingsSheet;
  $('#railnew').onclick = () => { location.hash = '#/new'; };
  const grip = $('#grip'), rail = document.querySelector('aside.rail');
  grip.onkeydown = e => { if (!['ArrowLeft','ArrowRight'].includes(e.key)) return; e.preventDefault(); const w = Math.min(480, Math.max(220, railW() + (e.key === 'ArrowRight' ? 20 : -20))); rail.style.width = w + 'px'; localStorage.setItem('pc-railw', String(w)); grip.setAttribute('aria-valuenow', String(w)); };
  document.querySelector('.skip-chat').onclick = e => { e.preventDefault(); document.getElementById(e.currentTarget.hash.slice(1))?.focus(); };
  grip.onpointerdown = e => {
    grip.setPointerCapture(e.pointerId);
    grip.onpointermove = ev => {
      const w = Math.min(480, Math.max(220, ev.clientX));
      rail.style.width = w + 'px';
      localStorage.setItem('pc-railw', String(w)); grip.setAttribute('aria-valuenow', String(w));
      if (typeof sizeMainForSplit === 'function') sizeMainForSplit();
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

let chatOffset = 0, chatTurnEvents = null, chatAttachKey = null, chatLastItem = null, extT = null;
function extPulse() { // ember while another surface (code-server) drives this session
  const h = $('#hember'); if (!h) return;
  if (!composerWorking) h.innerHTML = '<span class="ember"></span>';
  clearTimeout(extT);
  extT = setTimeout(() => { const h2 = $('#hember'); if (h2 && !composerWorking) h2.innerHTML = ''; }, 45000);
}

async function renderChat(id) {
  const renderVersion = ++chatRenderVersion;
  stashAttachments();rememberReading();
  if (chatId !== id) Voice.onLeave();
  chatId = id; closeES();
  fmarks = []; fidx = -1; // marks from the previous render are gone with the DOM
  const chatCol = `
    <header class="bar">
      ${PANE ? `<button class="icon" id="pane-main" aria-label="Make this the main conversation">${IC.swap}</button>` : `<button class="icon" id="back" aria-label="Back">${IC.back}</button>
      <button class="icon desk" id="railtog" aria-label="Show or hide the session list">${IC.panel}</button>`}
      <h1><span class="one" id="ctitle">Session</span><span class="tag" id="cproj"></span></h1>
      <span id="hember"></span>
      <button class="icon" id="chgb" aria-label="Changed files">${IC.diff}</button>
      <button class="icon" id="findb" aria-label="Find in conversation">${IC.search}</button>
      <button class="icon" id="chatmore" aria-label="Session options">${IC.more}</button>
      ${PANE ? '' : `<button class="icon desk" id="splitb" aria-label="Split view">${IC.columns}</button>`}
      <button class="icon" id="header-toggle" aria-label="Collapse conversation header" title="Collapse conversation header" aria-expanded="true" aria-controls="open-sessions cproj chat-statebar run-confirmation">${IC.up1}</button>
      ${PANE ? `<button class="icon" id="pane-close" aria-label="Close this pane">${IC.x}</button>` : ''}
    </header>
    <section class="conversation-controls" id="conversation-controls" aria-label="Conversation controls"><div class="run-confirmation" id="run-confirmation" data-state="unknown"><span id="run-confirmed-state" role="status">Checking server…</span><span id="run-confirmed-at" aria-live="off"></span></div>
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
    <div class="fmore" id="fmore" hidden></div></section>
    <main class="scroll"><div class="msgs" id="msgs"></div></main>
    <section class="composerwrap" aria-label="Message composer"><div class="delivery-status" id="delivery-status" role="status" hidden></div><div class="slash" id="slash" hidden></div><div class="voice-strip" id="voice-strip" role="status" aria-live="polite" hidden></div><div class="composer" id="comp"></div></section>`;
  app.innerHTML = withShell(chatCol) + '<input type="file" id="fpick" multiple hidden>';
  wireShell();
  if (PANE) { $('#pane-main').onclick = () => paneSay('main'); $('#pane-close').onclick = () => paneSay('close'); }
  else { $('#back').onclick = () => { location.hash = '#/'; }; $('#splitb').onclick = chooseBeside; }
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
  if (PANE) paneSay('route', { id, title: s.title }); else rememberOpenSession({...s,id});
  chatTitle = s.title; chatPinned = Boolean(s.pinned);
  const h1 = $('#ctitle').closest('h1');
  h1.classList.add('tappable');
  $('#chatmore').onclick = h1.onclick = () => sessionSheet({ id: chatId, title: chatTitle, pinned: chatPinned }, r => {
    if (typeof r.pinned === 'boolean') chatPinned = r.pinned;
    else if (r.name) { chatTitle = r.name; const t = $('#ctitle'); if (t) t.textContent = r.name; }
    else { renderChat(chatId); return; } // name cleared → resync the derived title
    railCache.at = 0; if (isWide()) paintRail();
  });
  chatOffset = s.size || 0; chatTurnEvents = Number.isInteger(s.turnEvents) ? s.turnEvents : null; chatAttachKey = null; chatLastItem = null;
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
  msgs.innerHTML = s.messages.map(msgHTML).join('') + steeredHTML(id, s.messages);
  mergeToolFolds(msgs);
  openLastTodo();
  paintChoices();
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
  paintContextMeter(id);
  openES(); // always: daemon turns stream events, idle sessions mirror the transcript live
}

/* ---------- usage visibility (1.7): context meter + plan-usage panel ---------- */
function fmtTokens(n) {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000) { const m = n / 1_000_000; return (Math.round(m * 10) / 10).toString().replace(/\.0$/, '') + 'M'; }
  if (n >= 1000) return Math.round(n / 1000) + 'k';
  return String(n);
}
// Context ring (1.13): a small gauge in the composer that fills as the session's context window fills.
// Hover or focus shows window, used and percentage; a click opens this session's usage (context + plan).
const ctxCache = new Map(); // sessionId -> context summary from /api/session/:id/context
const CTX_RING = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ctx-track" cx="12" cy="12" r="8.5"/><circle class="ctx-fill" cx="12" cy="12" r="8.5" pathLength="100" stroke-dasharray="0 100" transform="rotate(-90 12 12)"/></svg>';
const ctxRingHTML = () => `<button type="button" class="icon ctx-ring" id="ctx-ring" aria-haspopup="dialog">${CTX_RING}</button>`;
function modelLabel(id) {
  if (!id) return '';
  const bare = String(id).replace(/\[1m\]$/, '');
  const known = MODELS.find(m => String(m[0]).replace(/\[1m\]$/, '') === bare)?.[1];
  if (known) return known;
  const m = bare.match(/^claude-([a-z]+)-(\d+(?:-\d+)*?)(?:-\d{8})?$/);  // claude-opus-5-5 → Opus 5.5 (not in the picker list)
  return m ? m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2].replace(/-/g, '.') : String(id);
}
function ctxPctText(ctx) { return ctx.used > 0 && ctx.pct < 0.005 ? '<1' : String(Math.round(ctx.pct * 100)); }
function ctxLine(ctx) { return `${fmtTokens(ctx.used)} of ${fmtTokens(ctx.window)} tokens used (${ctxPctText(ctx)}%${ctx.estimated ? ', estimated' : ''})`; }
function paintCtxRing() {
  const el = $('#ctx-ring'); if (!el) return;
  const ctx = ctxCache.get(chatId);
  const fill = el.querySelector('.ctx-fill');
  if (!ctx || !ctx.window) {
    fill.setAttribute('stroke-dasharray', '0 100'); el.dataset.level = '';
    el.dataset.tip = 'Context window: shown after the next turn reports it. Click for plan usage.';
    el.setAttribute('aria-label', 'Context window not reported yet. Open usage');
    return;
  }
  const pct = Math.max(0, Math.min(1, ctx.pct || 0));
  fill.setAttribute('stroke-dasharray', `${Math.max(pct * 100, ctx.used > 0 ? 2 : 0).toFixed(1)} 100`);
  el.dataset.level = pct >= 0.9 ? 'red' : pct >= 0.7 ? 'amber' : '';
  const model = modelLabel(ctx.model);
  el.dataset.tip = `${model ? model + ' · ' : ''}${ctxLine(ctx)}`;
  el.setAttribute('aria-label', `Context window${model ? ' for ' + model : ''}: ${ctxLine(ctx)}. Open usage`);
}
async function paintContextMeter(id) {
  let ctx;
  try { ({ context: ctx } = await api('/session/' + id + '/context')); } catch { return; }
  if (ctx) ctxCache.set(id, ctx); else ctxCache.delete(id);
  if (chatId === id) paintCtxRing();
}
async function openContextPanel() {
  const id = chatId; if (!id) return;
  const ctx = ctxCache.get(id), codexSession = String(id).startsWith('cx:');
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const sh = document.createElement('div'); sh.className = 'sheet usage-sheet';
  const model = modelLabel(ctx?.model);
  const ctxBlock = ctx?.window
    ? `<div class="usage-block"><h3>This session${model ? ' · ' + esc(model) : ''}</h3>${usageWindowRow('Context window', ctx.pct, null)}
       <dl class="ctx-facts"><div><dt>Window</dt><dd>${esc(fmtTokens(ctx.window))} tokens</dd></div><div><dt>Used</dt><dd>${esc(fmtTokens(ctx.used))} tokens</dd></div><div><dt>Free</dt><dd>${esc(fmtTokens(Math.max(0, ctx.window - ctx.used)))} tokens</dd></div></dl>
       <p class="usage-asof">${ctx.estimated ? 'Estimated from the transcript. ' : ''}As of ${esc(fmtAsOfET(ctx.lastAt))}</p></div>`
    : '<div class="usage-block"><h3>This session</h3><p class="usage-empty">Context use appears after the next turn reports it.</p></div>';
  sh.innerHTML = `<h2>Usage</h2><p class="sheet-help">Only updates when a turn runs, not live.</p><div class="usage-body">${ctxBlock}</div><div class="usage-body" id="usage-body">Loading plan usage…</div>`;
  mountSheet(scrim, sh);
  let d;
  try { d = await api('/usage'); } catch (e) { sh.querySelector('#usage-body').innerHTML = `<p class="usage-empty">Plan usage could not be loaded: ${esc(e.message)}</p>`; return; }
  if (!sh.isConnected) return;
  sh.querySelector('#usage-body').innerHTML = codexSession ? (d.codex ? codexUsageBlockHTML(d.codex) : '<div class="usage-block"><h3>Codex</h3><p class="usage-empty">No Codex usage reported.</p></div>') : claudeUsageBlockHTML(d.claude || {});
}
document.addEventListener('click', e => { if (e.target.closest?.('#ctx-ring')) openContextPanel(); });
function fmtResetET(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' }) + ' '
    + d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET';
}
function fmtAsOfET(ms) {
  if (!ms) return 'not yet observed';
  const d = new Date(ms), opts = { timeZone: 'America/New_York' };
  const today = d.toLocaleDateString('en-US', opts) === new Date().toLocaleDateString('en-US', opts);
  return (today ? '' : d.toLocaleDateString('en-US', { ...opts, month: 'short', day: 'numeric' }) + ', ')
    + d.toLocaleTimeString('en-US', { ...opts, hour: 'numeric', minute: '2-digit' }) + ' ET';
}
function usageWindowRow(label, pct, resetsAt) {
  const safePct = Math.max(0, Math.min(1, pct || 0));
  const level = safePct >= 0.9 ? 'red' : safePct >= 0.7 ? 'amber' : '';
  const reset = fmtResetET(resetsAt), passed = resetsAt && resetsAt < Date.now();
  // a window that reset since the last observation is not at this percentage any more
  const resetText = !reset ? '' : passed ? `Reset ${reset} — the figure is from before that` : `Resets ${reset}`;
  return `<div class="usage-row">
    <div class="usage-row-head"><span>${esc(label)}</span><span class="usage-pct" data-level="${passed ? '' : level}">${passed ? 'was ' : ''}${Math.round(safePct * 100)}%</span></div>
    <div class="meter" role="img" aria-label="${esc(label)}: ${Math.round(safePct * 100)}% used${resetText ? ', ' + resetText : ''}"><div class="meter-fill" data-level="${passed ? '' : level}" style="width:${Math.round(safePct * 100)}%"></div></div>
    ${resetText ? `<p class="usage-reset">${esc(resetText)}</p>` : ''}
  </div>`;
}
function claudeUsageBlockHTML(d) {
  const w = d.windows || {};
  const rows = [
    w.five_hour && usageWindowRow('5-hour', w.five_hour.utilization, w.five_hour.resetsAt),
    w.seven_day && usageWindowRow('Weekly', w.seven_day.utilization, w.seven_day.resetsAt),
    w.seven_day_overage_included && usageWindowRow('Weekly + extra usage', w.seven_day_overage_included.utilization, w.seven_day_overage_included.resetsAt),
  ].filter(Boolean);
  if (!rows.length) return '<div class="usage-block"><h3>Claude Code</h3><p class="usage-empty">No usage observed yet — it reports usage on the next turn.</p></div>';
  const overage = d.overage ? `<div class="usage-row-head"><span>Extra usage</span><span>${d.overage.using ? 'On' : 'Off'}${d.overage.reason ? ' · ' + esc(String(d.overage.reason).replace(/_/g, ' ')) : ''}</span></div>` : '';
  return `<div class="usage-block"><h3>Claude Code</h3>${rows.join('')}${overage}<p class="usage-asof">As of ${esc(fmtAsOfET(d.observedAt))}</p></div>`;
}
function codexUsageBlockHTML(d) {
  const label = w => w?.windowDurationMins ? Math.round(w.windowDurationMins / 60) + 'h window' : 'Window';
  const rows = [
    d.primary && usageWindowRow(label(d.primary), (d.primary.usedPercent || 0) / 100, d.primary.resetsAt ? d.primary.resetsAt * 1000 : null),
    d.secondary && usageWindowRow(label(d.secondary), (d.secondary.usedPercent || 0) / 100, d.secondary.resetsAt ? d.secondary.resetsAt * 1000 : null),
  ].filter(Boolean);
  if (!rows.length) return '<div class="usage-block"><h3>Codex</h3><p class="usage-empty">Rate limits aren’t available from this Codex build.</p></div>';
  return `<div class="usage-block"><h3>Codex</h3>${rows.join('')}<p class="usage-asof">As of ${esc(fmtAsOfET(d.observedAt))}</p></div>`;
}
async function paintUsageBody(sh) {
  const body = sh.querySelector('#usage-body'); if (!body) return;
  let d;
  try { d = await api('/usage'); } catch (e) { body.innerHTML = `<p class="usage-empty">Usage could not be loaded: ${esc(e.message)}</p>`; return; }
  if (!sh.isConnected) return;
  body.innerHTML = [claudeUsageBlockHTML(d.claude || {}), d.codex ? codexUsageBlockHTML(d.codex) : null].filter(Boolean).join('');
}
async function openUsagePanel() {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const sh = document.createElement('div'); sh.className = 'sheet usage-sheet';
  sh.innerHTML = '<h2>Plan usage</h2><p class="sheet-help">Only updates when a turn runs, not live.</p><div class="usage-body" id="usage-body">Loading…</div>';
  mountSheet(scrim, sh);
  await paintUsageBody(sh);
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
        ${ctxRingHTML()}<button class="icon wbell ${chatMuted ? 'on' : ''}" id="muteb" aria-label="Toggle notifications for this session">${chatMuted ? IC.bellOff : IC.bell}</button>
        <button class="chip stopchip" id="stopb" aria-label="Stop this turn">${IC.stop}Stop</button></div>`
      : `<div class="toolbar" id="tbar"></div><div class="attachrow" id="attrow"></div>`}
    ${working ? '<div class="send-mode" role="group" aria-label="When to send"><button data-mode="steer" title="Steer now" aria-label="Steer now">Steer<span class="sm-x"> now</span></button><button data-mode="queue" title="After this turn" aria-label="After this turn">After <span class="sm-x">this </span>turn</button></div>' : ''}
    ${!working ? `<div class="composer-actions" id="composer-actions"><button class="icon" id="composer-toggle" aria-label="Hide message settings" aria-expanded="true" aria-controls="tbar">${IC.cog}</button>${ctxRingHTML()}</div>` : ''}
    <textarea id="box" rows="1" placeholder="${working ? 'Steer this turn…' : 'Message this session…'}" enterkeyhint="send"></textarea>
    ${Voice.micHTML()}<button class="send" id="send" aria-label="Send">${IC.up}</button>`;
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
    paintChoices();                                   // typing your own answer hides the suggested replies
  };
  box.onkeydown = e => { // desktop: Enter sends, Shift+Enter for a newline
    if (e.key === 'Enter' && !e.shiftKey && isWide()) { e.preventDefault(); sendMsg(box.value); }
  };
  $('#send').onclick = () => sendMsg(box.value);
  Voice.bindComposer();
  paintDelivery(chatId);
  paintChoices();
  paintCtxRing();
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
  // Optimistic echo: show the message the instant Send is hit instead of after the server acknowledges and
  // the transcript is re-fetched. A message with files renders as two elements (bubble + file chips), so
  // track every node it adds; all are removed if delivery fails, and the canonical re-render replaces them.
  const ghost = [];
  if (chatId === id && !composerWorking) {
    const msgs = $('#msgs');
    if (msgs) {
      const mark = msgs.lastElementChild;
      msgs.insertAdjacentHTML('beforeend', msgHTML({ role: 'user', text: pending.text, files: pending.files }));
      for (let n = mark ? mark.nextElementSibling : msgs.firstElementChild; n; n = n.nextElementSibling) { n.classList.add('pending'); ghost.push(n); }
      paintChoices();
      const box = $('#box'); if (box) box.value = '';
      scrollBottom();
    }
  }
  try {
    const result = await api(`/session/${id}/message`, { method: 'POST', body: JSON.stringify({ text: pending.text, ...pending.opts, clientMessageId: pending.clientMessageId }) });
    saveOutbox(id, null); clearDraft(id);
    if (pending.files.length) localStorage.removeItem('pc-attachments-' + id);
    if (result.steered) steeredEchoes.set(id, [...(steeredEchoes.get(id) || []), { text: pending.text.trim(), at: Date.now() }]);
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
    ghost.forEach(n => n.remove());
    if (chatId === id && $('#box')) $('#box').value = pending.text;
  } finally { sendsInFlight.delete(id); paintDelivery(id); if (chatId === id) paintChoices(); }
}

let recentSends = []; // for deduping our own messages when they echo back via the mirror
// A steered message reaches the agent at once but only enters the transcript at the
// agent's next step; until then the canonical re-render would hide it. Keep showing it.
const steeredEchoes = new Map(); // sessionId -> [{text, at}]
function steeredHTML(id, messages) {
  const recentUser = messages.slice(-40).filter(m => m.role === 'user').map(m => (m.text || '').trim());
  const left = (steeredEchoes.get(id) || []).filter(x => Date.now() - x.at < 30 * 60000 && !recentUser.some(t => t === x.text || t.endsWith(x.text)));
  if (left.length) steeredEchoes.set(id, left); else steeredEchoes.delete(id);
  return left.map(x => msgHTML({ role: 'user', text: x.text })).join('');
}
function openES() {
  closeES();
  if (!chatId) return;
  const streamId = chatId;
  // A fresh connection has no Last-Event-ID; without ?from the server would replay the
  // whole running turn on top of the transcript just rendered (every message twice).
  es = new EventSource(`/api/session/${chatId}/events?offset=${chatOffset}${chatTurnEvents != null ? `&from=${chatTurnEvents}` : ''}${chatLastItem ? `&after=${encodeURIComponent(chatLastItem)}` : ''}`);
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
    // attach names the turn + daemon boot: a different key after a reconnect means the
    // turn was rebuilt (daemon restart) and event numbers no longer line up — resync
    if (d.type === 'attach') { if (chatAttachKey && chatAttachKey !== d.key) { chatAttachKey = null; closeES(); renderChat(streamId); } else chatAttachKey = d.key; return; }
    if (d.offset) chatOffset = d.offset; // watch mode: where a reopen should continue from
    if (d.itemId) chatLastItem = d.itemId;
    if(d.type==='questions'){refreshQuestions(streamId);refreshSessions();Voice.onAttention(streamId,'questions');return;}
    if(d.type==='approvals'){refreshApprovals(streamId);refreshSessions();Voice.onAttention(streamId,'approvals');return;}
    if(d.type==='usage'){paintContextMeter(streamId);return;}
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
      live.raw = (live.raw || '') + d.text;                   // the suggested-replies block never shows as raw text
      const cut = live.raw.indexOf('```choices'); live.textContent = cut < 0 ? live.raw : live.raw.slice(0, cut);
      scrollBottom();
    }
    else if (d.type === 'assistant') {
      dropLive(); Voice.onAssistant(streamId, d.msg);
      msgs.insertAdjacentHTML('beforeend', msgHTML(d.msg));
      mergeToolFolds(msgs);
      openLastTodo();
      paintChoices();
      if (watching) extPulse();
      scrollBottom();
    }
    else if (d.type === 'result') {
      awaitingEngagement.add(streamId); // finished on screen: stays Response ready / New until you engage
      if (document.visibilityState === 'visible' && !Voice.replacesChime()) chime(); // not watching → push already notified; spoken alerts replace the chime
      Voice.onTurnEnd(streamId, d.ok, d.error);
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
    else if (d.type === 'idle') { dropLive(); closeES(); setComposer(false); Voice.onIdle(streamId); }
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
  const pendingNew = loadOutbox(NEW_KEY);
  const col = `
    <header class="bar">
      ${PANE ? `<button class="icon" id="pane-close" aria-label="Close this pane">${IC.x}</button>` : `<button class="icon" id="back" aria-label="Back">${IC.back}</button>`}
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
  if (PANE) $('#pane-close').onclick = () => paneSay('close'); else $('#back').onclick = () => { location.hash = '#/'; };
  tb = { key: NEW_KEY, prefs: pendingNew ? { model: pendingNew.payload.model || 'default', effort: pendingNew.payload.effort || 'default' } : getPrefs(NEW_KEY), attachments: loadAttachments(NEW_KEY), allowAttach: true, provider: 'claude' };
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
      x.classList.toggle('sel', on); x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1;
    });
    tb.provider = a;
    const fm = $('#first');
    if (fm) fm.placeholder = a === 'codex' ? 'What should Codex work on?' : 'What should Claude work on?';
    renderToolbar();
    (a === 'codex' ? loadCodexModels() : loadClaudeModels()).then(renderToolbar);context();
  };
  ap.querySelectorAll('.row').forEach(r => r.onclick = () => pickAgent(r.dataset.a));
  pickAgent(provider);
  bindRadioGroup(ap);
  $('#fpick').onchange = e => { uploadFiles([...e.target.files]); e.target.value = ''; };
  const first = $('#first');
  first.value = pendingNew?.payload.text || loadDraft(NEW_KEY);
  first.oninput = () => saveDraft(NEW_KEY, first.value);
  try {
    const { projects, defaultCwd } = await api('/projects');
    if(viewVersion!==chatRenderVersion)return;
    const pl = $('#plist');
    pl.innerHTML = projects.slice(0, 10).map((p, i) => `
      <button class="row" role="radio" aria-checked="false" data-p="${esc(p)}">
        <span class="dot"></span>${IC.folder}<span class="p">${esc(projName(p))}<span class="workspace-path">${esc(projShort(p))}</span></span>
      </button>`).join('');
    const pick = r => {
      pl.querySelectorAll('.row').forEach(x => { x.classList.remove('sel'); x.setAttribute('aria-checked', 'false'); x.tabIndex = -1; });
      r.classList.add('sel'); r.setAttribute('aria-checked', 'true'); r.tabIndex = 0;
      sel = r.dataset.p; $('#cpath').value = '';context();
    };
    pl.querySelectorAll('.row').forEach(r => r.onclick = () => pick(r));
    // preselect the instance's default workspace, else where you last started a session
    const last = defaultCwd || localStorage.getItem('pc-lastproj');
    const lastRow = last && pl.querySelector(`.row[data-p="${CSS.escape(last)}"]`);
    if (lastRow) pick(lastRow);
    bindRadioGroup(pl);
  } catch { }
  if(viewVersion!==chatRenderVersion)return;
  if (pendingNew) $('#cpath').value = pendingNew.payload.cwd;context();
  const paintNewDelivery = () => {
    const pending = loadOutbox(NEW_KEY), note = $('#new-delivery');
    if (!note) return;
    note.hidden = !pending;
    note.innerHTML = pending ? '<p>Start request not yet confirmed. Retry checks the same request.</p><button class="chip" id="discard-new">Discard retry</button>' : '';
    const discard = $('#discard-new'); if (discard) discard.onclick = () => { saveOutbox(NEW_KEY, null); clearDraft(NEW_KEY); renderNew(); };
    app.querySelectorAll('.pane input,.pane textarea,.pane button:not(#start)').forEach(el => { el.disabled = Boolean(pending); });
    $('#start').textContent = pending ? 'Retry start' : 'Start session';
  };
  paintNewDelivery();
  let newPending = null;
  $('#start').onclick = async () => {
    if(uploadsInFlight.get(NEW_KEY))return toast('Wait for the attachment upload to finish.');
    const savedStart = loadOutbox(NEW_KEY);
    const cwd = savedStart?.payload.cwd || $('#cpath').value.trim() || sel;
    const text = savedStart?.payload.text || $('#first').value.trim();
    if (!cwd) {$('#new-setup').open=true;$('#new-setup').scrollIntoView({block:'start'});return toast('Choose a workspace or enter its path');}
    if (!text) return toast('Write the first message');
    $('#start').disabled = true; $('#start').textContent = 'Starting…';
    try {
      const payload = savedStart?.payload || { cwd, text, provider, ...turnOpts() };
      const saved = loadOutbox(NEW_KEY);
      if (saved && JSON.stringify(saved.payload) !== JSON.stringify(payload)) return toast('Retry the saved new-session request before changing it.');
      newPending = saved || { payload, clientMessageId: crypto.randomUUID() };
      saveOutbox(NEW_KEY, newPending);
      const { id } = await api('/new', { method: 'POST', body: JSON.stringify({ ...newPending.payload, clientMessageId: newPending.clientMessageId }) });
      setPrefs(id,{model:payload.model||'default',effort:payload.effort||'default',executionMode:payload.executionMode||'work',approvalMode:payload.approvalMode||approvalPolicy.defaultMode});
      saveOutbox(NEW_KEY, null);
      clearDraft(NEW_KEY); localStorage.removeItem('pc-attachments-'+NEW_KEY); if (tb?.key === NEW_KEY) tb.attachments = [];
      try { localStorage.setItem('pc-lastproj', cwd); } catch { }
      location.hash = '#/chat/' + id;
    } catch (e) {
      if (e.status >= 400 && e.status < 500 && e.code !== 'delivery_uncertain') saveOutbox(NEW_KEY, null);
      toast(e.message || 'Delivery not confirmed. Retry the same request.');
    } finally { const start = $('#start'); if (start) { start.disabled = false; paintNewDelivery(); } }
  };
}

/* ---------- router ---------- */
async function route() {
  rememberReading();stashAttachments(); closeCurrentSheet?.(); ++chatRenderVersion;
  closeES(); chatId = null;
  try { await api('/me'); }
  catch (e) { // 401 rendered the login; anything else (offline, deploy restart) gets a retry view
    if (e.message !== 'login') renderUnreachable(e);
    reportWorkspaceChrome(); return;
  }
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
  if (inChat && !PANE && !document.querySelector('.scrim')) location.hash = '#/';
});
window.addEventListener('hashchange', route);
route();
if (!PANE && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* The online app remains usable without installation support. */ });

/* ---------- update announcement ---------- */
// First load after an asset bump: tell an existing install once that it updated and
// where the notes are. Fresh installs (no pc-* keys yet) get no toast.
(() => {
  if (!APP_V || PANE) return;
  const prev = localStorage.getItem('pc-seenv');
  if (prev === String(APP_V)) return;
  localStorage.setItem('pc-seenv', String(APP_V));
  const existing = prev || ['pc-chime', 'pc-rail', 'pc-agent', 'pc-draft'].some(k => localStorage.getItem(k) != null);
  if (existing) setTimeout(() => toast(`Updated to v${APP_V} — see What's new in Settings`), 1500);
})();
