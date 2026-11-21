/* Pocket Code — 1.117: Pause all, the paused banner, origin labels and Settings → Automation.
   Server contract: GET/POST /api/pause, POST /api/resume, GET /api/automation, POST /api/automation/settings;
   /api/me carries paused and features.automation; a list row carries lastOrigin/lastOriginRef. Loaded before app.js:
   everything here runs only when called, so app.js's helpers (api, esc, toast, mountSheet) are there by then. */
const Automation = (() => {
  const PAUSE_ICON = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5.5" width="3.2" height="13" rx="1"/><rect x="13.8" y="5.5" width="3.2" height="13" rx="1"/></svg>';
  const RESUME_ICON = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
  const ORIGIN = { queue: 'Queued message', retry: 'Continued after a usage limit', coordination: 'Woken by a hold', checkback: 'Started by a check-back' };
  let state = { paused: null, ownMessages: 'run', confirm: true, held: null }, lastPoll = 0, polling = null, banner = null;

  const on = () => Boolean(window.pocketFeatures?.automation) && !(typeof PANE !== 'undefined' && PANE);
  const isPaused = () => Boolean(state.paused);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const timeOf = at => { const d = new Date(at); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };

  // The words shared with the server: owner work has no label.
  function originLabel(origin, ref) {
    if (!origin || origin === 'owner') return '';
    if (origin === 'job') return ref ? `Started by job ${ref}` : 'Started by a job';
    return ORIGIN[origin] || '';
  }
  // The server sends lastOrigin on list rows and the session (set when the turn starts, cleared by the owner's next one),
  // and origin on a running non-owner reply's state (list rows, the session) or turn (the status route).
  const originOf = s => originLabel(s?.lastOrigin ?? s?.state?.origin ?? s?.turn?.origin, s?.lastOriginRef ?? s?.state?.originRef ?? s?.turn?.originRef);

  // "3 replies running (2 Claude, 1 Codex), 1 usage-limit retry, Inbox Watch."
  function wouldText(w) {
    if (!w) return '';
    const r = w.replies || {}, engines = [['claude', 'Claude'], ['codex', 'Codex'], ['openrouter', 'OpenRouter']].filter(([k]) => r[k] > 0);
    const replies = engines.reduce((n, [k]) => n + r[k], 0), parts = [];
    if (replies) parts.push(`${plural(replies, 'reply', 'replies')} running (${engines.map(([k, l]) => `${r[k]} ${l}`).join(', ')})`);
    if (w.retries > 0) parts.push(plural(w.retries, 'usage-limit retry', 'usage-limit retries'));
    if (w.checkbacks > 0) parts.push(plural(w.checkbacks, 'check-back', 'check-backs'));
    if (w.inboxWatch) parts.push('Inbox Watch');
    return parts.length ? parts.join(', ') + '.' : '';
  }
  const ownLine = () => state.ownMessages === 'blocked' ? 'Your own messages wait until you resume.' : 'Your own messages still run.';

  /* ---------- state ---------- */
  // What the page shows of the state. A refresh that leaves it the same touches nothing: no banner, header, control or
  // list repaint (the regular list refresh and the return to the tab both bring a /api/pause; see test/automation-browser.mjs).
  const shown = () => JSON.stringify([state.paused?.at || null, state.ownMessages, state.held?.retries || 0, on()]);
  let lastShown = null;
  function apply(d) {
    if (!d || typeof d !== 'object') return;
    const was = isPaused();
    if ('paused' in d) state.paused = d.paused || null;
    if (d.ownMessages) state.ownMessages = d.ownMessages;
    if (typeof d.confirm === 'boolean') state.confirm = d.confirm;
    if ('held' in d) state.held = d.held || null;
    if (shown() !== lastShown) paint();
    if (was !== isPaused()) for (const fn of listeners) try { fn(); } catch { }
  }
  const listeners = [];
  // /api/me on every route: paused or not, and whether this server has the feature. The full state (held retries, own
  // messages) follows with the next check, at once when /api/me shows a change, else on the regular 5-second cadence,
  // so moving between views adds no request.
  function fromMe(me) {
    if (!on()) { state.paused = null; paint(); return; }
    const was = state.paused?.at || null;
    if (me && 'paused' in me) apply({ paused: me.paused ? { ...state.paused, ...me.paused } : null });
    poll((state.paused?.at || null) !== was);
  }
  // On the app's regular list refresh (every 5 s while visible) and on return to the tab, so a second device
  // shows the banner too. One request at a time; a failure leaves the last known state.
  function poll(force = false) {
    if (!on() || document.querySelector('.login')) return Promise.resolve();
    if (polling) return polling;
    if (!force && Date.now() - lastPoll < 4500) return Promise.resolve();
    lastPoll = Date.now();
    polling = api('/pause').then(apply, () => { }).finally(() => { polling = null; });
    return polling;
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(true); });

  /* ---------- the banner: calm and factual, across the top while paused ---------- */
  function paint() {
    lastShown = shown();
    const show = on() && isPaused();
    document.documentElement.classList.toggle('pocket-paused', show);
    if (!show) { banner?.remove(); banner = null; paintControls(); return; }
    if (!banner) {
      banner = document.createElement('div'); banner.className = 'pause-banner'; banner.setAttribute('role', 'region'); banner.setAttribute('aria-label', 'Paused');
      banner.innerHTML = `<span class="pause-mark">${PAUSE_ICON}</span><p class="pause-text" role="status"></p><button type="button" class="chip pause-resume" data-resume>${RESUME_ICON}Resume</button>`;
      banner.querySelector('[data-resume]').onclick = e => resume(e.currentTarget);
      document.body.prepend(banner);
    }
    const held = state.held?.retries > 0 ? ` ${plural(state.held.retries, 'usage-limit retry is', 'usage-limit retries are')} held.` : '';
    const text = `Pocket is paused. ${ownLine()}${held}`;
    const p = banner.querySelector('.pause-text'); if (p.textContent !== text) p.textContent = text;
    const title = state.paused?.at ? 'Paused at ' + timeOf(state.paused.at) : '';
    if (banner.title !== title) banner.title = title;
    paintControls();
  }
  // Every Pause all control reads Resume while paused.
  const painted = new WeakMap();
  function paintControls() {
    document.querySelectorAll('[data-pause-toggle]').forEach(b => {
      // Compared with the HTML last written, not b.innerHTML: the browser serializes the SVG differently, so that
      // comparison never matched and every check rewrote the control.
      const html = controlHTML(b.dataset.pauseToggle), label = isPaused() ? 'Resume: Pocket is paused' : 'Pause all';
      if (painted.get(b) !== html) { if (b.innerHTML !== html) b.innerHTML = html; painted.set(b, html); }
      if (b.getAttribute('aria-label') !== label) b.setAttribute('aria-label', label);
    });
  }
  function controlHTML(kind) {
    const p = isPaused();
    const sub = p ? `Paused${state.paused?.at ? ' since ' + esc(timeOf(state.paused.at)) : ''}. ${esc(ownLine())}`
      : 'Stops every reply and holds everything automatic. Your own messages still run.';
    return `${p ? RESUME_ICON : PAUSE_ICON}<span>${p ? 'Resume' : 'Pause all'}<span class="sub">${kind === 'settings' && !p ? 'Running normally. ' + sub : sub}</span></span>`;
  }
  const toggleHTML = kind => on() ? `<button type="button" class="opt pause-toggle" data-pause-toggle="${kind}" aria-label="${isPaused() ? 'Resume: Pocket is paused' : 'Pause all'}">${controlHTML(kind)}</button>` : '';
  // In the More menu and the switcher the row is a command, so that sheet closes (focus goes back to its opener, and a
  // confirmation opens from there); in Settings it is a row that stays and changes its words.
  function bindToggles(root) {
    root.querySelectorAll('[data-pause-toggle]').forEach(b => { b.onclick = () => {
      const command = b.dataset.pauseToggle !== 'settings';
      if (command) closeCurrentSheet?.();
      return isPaused() ? resume(command ? null : b) : pauseAll();
    }; });
  }

  /* ---------- Pause all ---------- */
  // Returns 'confirm' (the sheet is open), 'paused', 'already' or 'failed', so the voice command can say what happened.
  async function pauseAll() {
    let d;
    try { d = await api('/pause'); } catch (e) { toast(e.message || 'Could not reach Pocket.'); return 'failed'; }
    apply(d);
    if (d.paused) { toast('Pocket is already paused.'); return 'already'; }
    if (d.confirm === false) return await doPause() ? 'paused' : 'failed';
    confirmSheet(d);
    return 'confirm';
  }
  function confirmSheet(d) {
    const scrim = document.createElement('div'); scrim.className = 'scrim';
    const sh = document.createElement('div'); sh.className = 'sheet pause-sheet';
    const would = wouldText(d.would);
    sh.innerHTML = `<h2>Pause all</h2>
      <p class="pause-would" data-pause-would>${would ? 'This stops ' + esc(would) : 'Nothing is running or waiting right now. Pausing holds anything automatic that comes up.'}</p>
      <p class="sheet-help">${esc(ownLine())} Anything automatic waits until you resume. Queued messages stay in their queue until you start them.</p>
      <div class="pause-actions"><button type="button" class="chip claude-stop" data-pause-go>${PAUSE_ICON}Pause all</button><button type="button" class="chip" data-pause-keep>Keep running</button></div>
      <p class="question-error" data-pause-error role="alert"></p>`;
    mountSheet(scrim, sh);
    const go = sh.querySelector('[data-pause-go]');
    sh.querySelector('[data-pause-keep]').onclick = () => closeCurrentSheet?.();
    go.onclick = async () => {
      go.disabled = true;
      if (await doPause(sh.querySelector('[data-pause-error]'))) closeCurrentSheet?.();
      else go.disabled = false;
    };
    go.focus();
  }
  async function doPause(errorEl = null) {
    try {
      const r = await api('/pause', { method: 'POST', body: '{}' });
      apply({ paused: r.paused || { at: new Date().toISOString() } });
      // Replies stop; retries and check-backs are held, not stopped: "Paused. Stopped 2 replies running (2 Claude). Held 1 usage-limit retry."
      const s = r.stopped || {}, stopped = wouldText({ replies: s.replies });
      const held = wouldText({ retries: s.retries, checkbacks: s.checkbacks });
      toast(['Paused.', stopped && 'Stopped ' + stopped, held && 'Held ' + held].filter(Boolean).join(' '));
      poll(true); if (typeof refreshSessions === 'function') refreshSessions();
      return true;
    } catch (e) {
      if (errorEl) errorEl.textContent = e.message || 'Could not pause.'; else toast(e.message || 'Could not pause.');
      return false;
    }
  }
  async function resume(button = null) {
    if (button) button.disabled = true;
    try {
      const r = await api('/resume', { method: 'POST', body: '{}' });
      apply({ paused: null, held: null });
      toast(r.rearmed > 0 ? `Resumed. ${plural(r.rearmed, 'held retry runs', 'held retries run')} again.` : 'Resumed.');
      poll(true); if (typeof refreshSessions === 'function') refreshSessions();
      // Focus would be lost with the banner; the message box or the page heading takes it.
      if (button?.closest('.pause-banner')) (document.querySelector('#box:not([readonly])') || document.querySelector('#first') || document.querySelector('header.bar h1'))?.focus?.({ preventScroll: true });
    } catch (e) { toast(e.message || 'Could not resume.'); }
    finally { if (button?.isConnected) button.disabled = false; }
  }
  // A send the server refused because own messages are blocked while paused: keep the draft, say so, offer Resume.
  function refused() {
    apply({ paused: state.paused || { at: new Date().toISOString() }, ownMessages: 'blocked' });
    poll(true);
    return 'Not sent: Pocket is paused, and your own messages wait until you resume. Your message is kept here.';
  }

  /* ---------- the More menu beside the conversation list ---------- */
  function moreMenu() {
    const scrim = document.createElement('div'); scrim.className = 'scrim';
    const sh = document.createElement('div'); sh.className = 'sheet more-menu';
    sh.innerHTML = `<h2>More</h2>${toggleHTML('menu')}
      <button type="button" class="opt" data-automation-settings>${typeof IC !== 'undefined' ? IC.sliders : ''}<span>Automation settings<span class="sub">What Pause all stops, and limits on work that runs without you</span></span></button>`;
    mountSheet(scrim, sh);
    bindToggles(sh);
    sh.querySelector('[data-automation-settings]').onclick = () => settingsSheet({ category: 'automation' });
    sh.querySelector('[data-pause-toggle]')?.focus();
  }

  /* ---------- Settings → Automation ---------- */
  let data = null, host = null;
  const advancedOpen = new Set();
  const unitText = (u, v) => u === '$' ? (Number.isInteger(Number(v)) ? '$' + v : money(v)) : u === '%' ? v + '%' : u === 'min' ? v + ' min' : u === 'h' ? v + ' h' : String(v);
  const rangeText = s => s.type !== 'number' ? '' : `${unitText(s.unit, s.min)} to ${unitText(s.unit, s.max)}${s.offAllowed ? ', or No limit' : ''}.`;
  const money = n => n == null ? '—' : '$' + Number(n).toFixed(2);
  const tokens = n => n == null || !n ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n);
  const dayName = d => { const t = new Date(d + 'T12:00:00'); return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); };

  function settingsHTML() {
    return `<div class="title-settings model-offer automation-settings" id="s-automation" role="group" aria-label="Automation">
      ${toggleHTML('settings')}
      <div class="automation-body" id="s-automation-body" aria-busy="true"><p class="title-note">Loading the automation settings…</p></div></div>`;
  }
  function settingRowHTML(g, s) {
    const id = `auto-${g.key}-${s.key}`, err = `<p class="vault-field-error" id="${id}-err" role="alert"></p>`;
    const note = [s.help, rangeText(s), s.preset && !s.saved ? 'Preset on this server.' : ''].filter(Boolean).join(' ');
    const noteHTML = note ? `<p class="title-note" id="${id}-note">${esc(note)}</p>` : '';
    const described = [note ? id + '-note' : '', id + '-err'].filter(Boolean).join(' ');
    if (s.type === 'bool') return `<div class="automation-row" data-auto-row="${esc(s.key)}"><button type="button" class="opt automation-bool" id="${id}" data-auto-key="${esc(s.key)}" aria-pressed="${s.value === true}" aria-describedby="${id}-err"><span class="dot${s.value === true ? ' on' : ''}"></span><span>${esc(s.label)}${note ? `<span class="sub">${esc(note)}</span>` : ''}</span></button>${err}</div>`;
    if (s.type === 'choice') return `<div class="automation-row" data-auto-row="${esc(s.key)}"><label class="voice-field">${esc(s.label)}<select id="${id}" data-auto-key="${esc(s.key)}" aria-describedby="${described}">${(s.choices || []).map(c => `<option value="${esc(c.value)}"${String(c.value) === String(s.value) ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>${noteHTML}${err}</div>`;
    const off = s.value === 'off';
    return `<div class="automation-row automation-number" data-auto-row="${esc(s.key)}">
      <label class="automation-label" for="${id}">${esc(s.label)}</label>
      <span class="automation-input${s.unit === '$' ? ' unit-before' : ''}">${s.unit === '$' ? '<span class="automation-unit" aria-hidden="true">$</span>' : ''}<input type="number" id="${id}" data-auto-key="${esc(s.key)}" inputmode="decimal" ${s.min != null ? `min="${s.min}"` : ''} ${s.max != null ? `max="${s.max}"` : ''} step="${s.step ?? 'any'}" value="${off ? '' : esc(s.value)}" placeholder="${off ? 'No limit' : ''}" ${off ? 'disabled' : ''} aria-describedby="${described}">${s.unit && s.unit !== '$' ? `<span class="automation-unit" aria-hidden="true">${esc(s.unit)}</span>` : ''}</span>
      ${s.offAllowed ? `<button type="button" class="chip automation-off" data-auto-off="${esc(s.key)}" aria-pressed="${off}" aria-label="No limit: ${esc(s.label)}">No limit</button>` : ''}
      ${noteHTML}${err}</div>`;
  }
  function groupHTML(g) {
    const rows = s => s.map(x => settingRowHTML(g, x)).join('');
    const main = g.settings.filter(s => !s.advanced), adv = g.settings.filter(s => s.advanced);
    return `<section class="automation-group" data-auto-group="${esc(g.key)}" aria-labelledby="auto-${esc(g.key)}-h">
      <h3 class="vault-set-head" id="auto-${esc(g.key)}-h">${esc(g.title)}</h3>
      ${rows(main)}
      ${adv.length ? `<details class="settings-details automation-advanced" data-auto-advanced="${esc(g.key)}"${advancedOpen.has(g.key) ? ' open' : ''}><summary>Advanced</summary>${rows(adv)}</details>` : ''}
      <span class="vault-set-actions"><button type="button" class="chip" data-auto-reset="${esc(g.key)}">Reset to defaults</button></span>
      <p class="title-note" data-auto-status="${esc(g.key)}" role="status"></p></section>`;
  }
  function usageHTML(u, notices) {
    const days = (u?.days || []).slice(-7).reverse(), t = u?.today || {}; // the server sends oldest first; the table reads newest first
    return `<section class="automation-group automation-usage" aria-labelledby="auto-usage-h"><h3 class="vault-set-head" id="auto-usage-h">Unattended replies</h3>
      <p class="title-note" data-auto-today>Today: ${plural(t.replies || 0, 'reply', 'replies')}${t.cost != null ? ' · ' + money(t.cost) : ''}${t.tokens ? ' · ' + tokens(t.tokens) + ' tokens' : ''}</p>
      ${days.length ? `<table class="watch-usage"><caption class="title-note">Last 7 days. Claude reports a cost per reply, which on a plan is what the same tokens would cost; Codex reports tokens.</caption><thead><tr><th scope="col">Day</th><th scope="col">Replies</th><th scope="col">Tokens</th><th scope="col">Cost</th></tr></thead><tbody>
        ${days.map(d => `<tr><th scope="row">${esc(dayName(d.date))}</th><td>${d.replies || 0}</td><td>${tokens(d.tokens)}</td><td>${money(d.cost)}</td></tr>`).join('')}</tbody></table>` : ''}
      <h3 class="vault-set-head" id="auto-notices-h">Limits reached today</h3>
      ${notices?.length ? `<ul class="automation-notices" aria-labelledby="auto-notices-h">${notices.map(n => `<li><span class="automation-when">${esc(timeOf(n.at))}</span>${esc(n.text)}</li>`).join('')}</ul>` : '<p class="title-note">None today.</p>'}</section>`;
  }
  function paintSettings() {
    const body = host?.querySelector('#s-automation-body'); if (!body || !data) return;
    const focusKey = document.activeElement?.closest?.('#s-automation') && (document.activeElement.dataset.autoKey || document.activeElement.dataset.autoOff || document.activeElement.dataset.autoReset);
    const focusAttr = document.activeElement?.dataset.autoKey ? 'data-auto-key' : document.activeElement?.dataset.autoOff ? 'data-auto-off' : 'data-auto-reset';
    body.setAttribute('aria-busy', 'false');
    body.innerHTML = `${(data.warnings || []).map(w => `<p class="title-note automation-warning" role="note">${esc(w)}</p>`).join('')}
      ${(data.groups || []).map(groupHTML).join('')}${usageHTML(data.usage, data.notices)}`;
    bindSettingsBody(body);
    if (focusKey) body.querySelector(`[${focusAttr}="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }
  const settingOf = (group, key) => data?.groups?.find(g => g.key === group)?.settings.find(s => s.key === key);
  async function save(group, payload, { key = '', control = null, done = '' } = {}) {
    const row = key ? host.querySelector(`[data-auto-group="${CSS.escape(group)}"] [data-auto-row="${CSS.escape(key)}"]`) : null;
    const errEl = row?.querySelector('.vault-field-error'), status = host.querySelector(`[data-auto-status="${CSS.escape(group)}"]`);
    if (errEl) errEl.textContent = '';
    try {
      data = await api('/automation/settings', { method: 'POST', body: JSON.stringify({ group, ...payload }) });
      apply({ paused: data.paused ?? state.paused });
      paintSettings();
      const st = host.querySelector(`[data-auto-status="${CSS.escape(group)}"]`); if (st) st.textContent = done || 'Saved.';
      return true;
    } catch (e) {
      const message = e.message || 'Could not save.';
      if (errEl) { errEl.textContent = message; } else if (status) status.textContent = message; else toast(message);
      // The old value returns; the field keeps the error beside it.
      const s = key && settingOf(group, key);
      if (s && control) {
        if (control.matches('input')) { control.value = s.value === 'off' ? '' : s.value; control.setAttribute('aria-invalid', 'true'); }
        else if (control.matches('select')) control.value = String(s.value);
      }
      return false;
    }
  }
  function bindSettingsBody(body) {
    body.querySelectorAll('[data-auto-group]').forEach(sec => {
      const group = sec.dataset.autoGroup;
      sec.querySelectorAll('[data-auto-key]').forEach(el => {
        const key = el.dataset.autoKey, s = settingOf(group, key); if (!s) return;
        if (s.type === 'bool') el.onclick = () => save(group, { values: { [key]: !(s.value === true) } }, { key, control: el });
        else if (s.type === 'choice') el.onchange = () => save(group, { values: { [key]: el.value } }, { key, control: el });
        else {
          el.oninput = () => el.removeAttribute('aria-invalid');
          el.onchange = () => {
            const raw = el.value.trim(), n = Number(raw);
            if (raw === '' || !Number.isFinite(n)) { const errEl = el.closest('[data-auto-row]').querySelector('.vault-field-error'); errEl.textContent = `Enter a number. ${rangeText(s)}`; el.value = s.value === 'off' ? '' : s.value; el.setAttribute('aria-invalid', 'true'); return; }
            if (String(n) === String(s.value)) return;
            save(group, { values: { [key]: n } }, { key, control: el });
          };
          el.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); el.dispatchEvent(new Event('change')); } };
        }
      });
      sec.querySelectorAll('[data-auto-off]').forEach(b => {
        const key = b.dataset.autoOff, s = settingOf(group, key); if (!s) return;
        b.onclick = () => save(group, { values: { [key]: s.value === 'off' ? s.default : 'off' } }, { key, control: b, done: s.value === 'off' ? 'Limit set.' : 'No limit. The warning above stays while it is off.' });
      });
      const adv = sec.querySelector('[data-auto-advanced]'); if (adv) adv.ontoggle = () => adv.open ? advancedOpen.add(group) : advancedOpen.delete(group);
      const reset = sec.querySelector('[data-auto-reset]');
      if (reset) reset.onclick = () => save(group, { reset: true }, { done: 'Back to the defaults.' });
    });
  }
  async function bindSettings(sh) {
    host = sh;
    bindToggles(sh);
    const body = sh.querySelector('#s-automation-body'); if (!body) return;
    if (!on()) { body.innerHTML = '<p class="title-note">This server does not offer automation settings yet.</p>'; body.setAttribute('aria-busy', 'false'); return; }
    try { data = await api('/automation'); if (!sh.isConnected) return; apply({ paused: data.paused ?? null }); paintSettings(); }
    catch (e) { if (sh.isConnected) { body.innerHTML = `<p class="title-note">${esc(e.message || 'Could not load the automation settings.')}</p>`; body.setAttribute('aria-busy', 'false'); } }
  }
  // The Pause all row in an open Settings follows the state.
  listeners.push(() => { if (host?.isConnected) paintControls(); });

  return { on, isPaused, apply, fromMe, poll, paint, pauseAll, resume, refused, moreMenu, toggleHTML, bindToggles,
    originLabel, originOf, wouldText, settingsHTML, bindSettings, onChange: fn => listeners.push(fn) };
})();
