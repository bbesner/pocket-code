/* Pocket Code — job keys, the app half. The owner creates a key with a fixed instruction, folder, agent, model and access;
   a script on this server calls POST /api/jobs/run with it and some data, and Pocket starts a reply the owner can watch.
   Here: the key list under Settings → Automation → Job keys, the New job key sheet, the key shown once (after Create and
   Rotate), a key's own sheet with Turn off / Turn on, Rotate key, Delete and Recent runs.
   Requests: an agent in a conversation the owner started proposes a key (pocket-jobkey). It waits under "Waiting for you"
   above the list, with every field and the whole instruction (no inner scroll: the card grows, so Allow is reached only
   past the instruction's last line), and Deny / Edit first / Allow. Allow is never focused for the owner and Enter never
   allows, on the card or in a field of Edit first. Allow writes the key to a file and the card says the file's path, never the key.
   Edit first opens the New job key form as "Edit before you allow". The push link #/settings/jobs/request/<id> opens the
   card (app.js's router calls openRequest); the count shows on the Automation entry and the group heading.
   Server contract: GET/POST /api/jobs/keys (with requests and answered), POST /api/jobs/keys/:id (and /enable,
   /disable, /rotate, /delete), GET /api/jobs/keys/:id/runs, POST /api/jobs/requests/:id/answer; /api/me features.jobs. Loaded before app.js: everything here runs only when called, so
   app.js's helpers (api, esc, toast, mountSheet, IC, the model lists) are there by then.
   The key itself lives only in the sheet that shows it: never in a variable that outlives that sheet, localStorage, the
   URL or the list. The lists refresh every 5 seconds while they show, and a refresh that changes nothing writes nothing. */
const JobKeys = (() => {
  const on = () => Boolean(window.pocketFeatures?.jobs);
  const AGENT = { claude: 'Claude Code', codex: 'Codex', acp: 'OpenRouter' };
  const ACCESS = { ask: 'Ask first', full: 'Full access' };
  const STATUS = { starting: 'Working', working: 'Working', needs_you: 'Needs you', done: 'Done', failed: 'Failed' };
  const KEY_ICON = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15.5" r="4"/><path d="M11 12.5l8.5-8.5M16.5 7l2.5 2.5M14 9.5l2 2"/></svg>';
  const LEAD = 'A job key lets a script on this server start a reply with the instruction, folder and agent you set here, and send it data to work on.';
  const FIXED = 'This key has run, so its folder and agent stay as they are. Create a new key for another folder or agent.';
  const REFRESH_MS = 5000;
  let data = null, loading = null, timer = null, models = new Set();

  /* ---------- words ---------- */
  const when = at => typeof CheckBacks !== 'undefined' ? CheckBacks.when(at) : new Date(at).toLocaleString();
  const short = p => typeof projShort === 'function' ? projShort(p) : p;
  const listFor = engine => engine === 'codex' ? CODEX_MODELS : engine === 'acp' ? ACP_MODELS : MODELS;
  function modelLabel(engine, model) {
    if (!model || model === 'default') return 'Default model';
    const row = listFor(engine).find(m => m[0] === model);
    return row ? row[1] : model;
  }
  const effortLabel = e => e ? (EFFORT_NAMES[e] || e) : '';
  const stateOf = k => k.running > 0 ? 'Running' : k.enabled === false ? 'Off' : 'On';
  const lastRun = k => k.lastRunAt ? 'Last run ' + when(k.lastRunAt) : 'Never ran';
  // Two fixed lines under the name, so a row keeps its height whatever its state says.
  const factsA = k => [short(k.workspace), AGENT[k.engine] || k.engine, modelLabel(k.engine, k.model) + (k.effort ? ' · ' + effortLabel(k.effort) : '')].join(' · ');
  const factsB = k => [ACCESS[k.access] || k.access, stateOf(k), lastRun(k)].join(' · ');

  /* ---------- requests: a conversation asked for a job key (pocket-jobkey propose) ----------
     GET /api/jobs/keys carries `requests` (waiting, oldest first, every field and the whole instruction) and `answered`.
     The owner answers with POST /api/jobs/requests/:id/answer {answer:'allow'|'deny', fields?}. Allow writes the key to a
     file in the key folder; no key ever comes back on this path. A card the owner answered here is replaced in place by
     one line saying what happened (kept while Settings stays open). */
  let pendingFocus = null; // a request to scroll to and mark once the list is painted (the push link, Edit first's Cancel)
  const outcomes = new Map(); // request id → { kind: 'allowed'|'denied'|'gone', text, at }
  const cardErrors = new Map(); // request id → the server's refusal of an Allow, shown on the card
  const GONE = new Set(['request_expired', 'request_allowed', 'request_denied', 'not_found']);
  const CHANGED_WORDS = { name: 'name', workspace: 'folder', engine: 'agent', model: 'model', effort: 'effort', access: 'access', instruction: 'instruction',
    mayAddInstructions: 'its own instructions', limits: 'limits', pushWhenDone: 'push when it finishes' };
  const MISSING = 'That request was already answered or expired.';
  const keyFolder = () => data?.defaults?.folder || '~/.config/pocket/jobs/';
  const pendingCount = () => (data?.requests || []).filter(r => !outcomes.has(r.id)).length;
  function limitsText(l = {}) {
    const one = (v, unit) => v === 'off' || v == null ? 'no limit ' + unit : `${v} ${unit}`;
    return [one(l.perHour, 'per hour'), one(l.perDay, 'per day'), `${l.atOnce ?? 1} at once`].join(' · ');
  }
  const fact = (label, value) => `<div class="job-request-fact"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
  function requestHTML(r) {
    const f = r.fields || {}, hid = 'jr-' + r.id, err = cardErrors.get(r.id) || r.error?.error || '';
    const title = r.sessionTitle || 'a conversation';
    const access = f.access === 'full'
      ? `<span class="job-request-full">Full access.</span> It acts without asking you first.`
      : 'Ask first. Every action waits for your OK in the conversation.';
    return `<article class="vault-request job-request" data-job-request="${esc(r.id)}" aria-labelledby="${hid}">
      <h4 id="${hid}" tabindex="-1"><a class="vault-request-who job-request-from" href="#/chat/${esc(encodeURIComponent(r.session || ''))}" data-job-request-chat>${esc(title)}</a> asks for a job key named <span class="vault-name">${esc(f.name || '')}</span></h4>
      <p class="vault-request-where"><span>Asked ${esc(when(r.proposedAt))}</span><span aria-hidden="true">·</span><span>Expires ${esc(when(r.expiresAt))} if you don’t answer</span></p>
      <dl class="job-request-facts">
        ${fact('Folder', `<span class="vault-path">${esc(short(f.workspace || ''))}</span>`)}
        ${fact('Agent', esc(AGENT[f.engine] || f.engine || ''))}
        ${fact('Model', esc(modelLabel(f.engine, f.model)))}
        ${fact('Effort', esc(f.effort ? effortLabel(f.effort) : 'Default'))}
        ${fact('Access', access)}
        ${fact('Limits', esc(limitsText(f.limits)))}
        ${fact('Its own instructions', f.mayAddInstructions ? 'Allowed. A script may add instructions to the one below.' : 'Not allowed. Whatever a script sends is treated as data.')}
        ${fact('Push when it finishes', f.pushWhenDone === false ? 'No' : 'Yes')}
      </dl>
      <p class="job-request-label" id="${hid}-i">Instruction</p>
      <div class="job-request-instruction" role="region" aria-labelledby="${hid}-i">${esc(f.instruction || '')}</div>
      <p class="vault-request-note">On Allow, Pocket makes this key and saves it to a file in <span class="vault-path">${esc(keyFolder())}</span>. The conversation gets the file’s path, not the key. From then on a script with that file can start this job without asking you.</p>
      <p class="vault-request-changed job-request-error" data-job-request-error role="alert"${err ? '' : ' hidden'}>${esc(err)}${err && r.error ? ' Allow again, or Edit first to change the name.' : ''}</p>
      <div class="approval-actions vault-request-actions job-request-actions"><button type="button" class="vault-answer vault-deny" data-jr-deny>Deny</button><button type="button" class="chip" data-jr-edit>Edit first</button><button type="button" class="vault-answer vault-allow" data-jr-allow>Allow</button></div>
    </article>`;
  }
  // The server doesn't wake the conversation on an answer: the agent goes on when the owner writes to it, so the line
  // after Allow says so and opens the conversation that asked (after Deny, only the link).
  // What became of a request answered here: the key file's path after Allow (never the key), then the next step. The server
  // doesn't wake the conversation, so after Allow the owner is told to tell it to continue; after Allow or Deny, a link to it.
  function outcomeHTML(id, o) {
    const head = o.kind === 'allowed' ? `Allowed. Key file: <span class="vault-path">${esc(o.file)}</span>${o.changed ? ' ' + esc(o.changed) : ''}` : esc(o.text);
    const next = o.session && o.kind !== 'gone' ? `<p class="job-request-next">${o.kind === 'allowed' ? 'Tell the conversation to continue. ' : ''}<a class="job-request-open" href="#/chat/${esc(encodeURIComponent(o.session))}" data-job-request-chat>Open the conversation</a></p>` : '';
    return `<div class="job-request-outcome" data-job-outcome="${esc(id)}" data-kind="${esc(o.kind)}" tabindex="-1" role="status"><p data-job-outcome-text>${head}</p>${next}</div>`;
  }
  function requestItems() {
    const items = (data?.requests || []).filter(r => !outcomes.has(r.id)).map(r => ({ id: r.id, at: r.proposedAt || '', html: requestHTML(r) }));
    for (const [id, o] of outcomes) items.push({ id, at: o.at || '', html: outcomeHTML(id, o) });
    return items.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
  }
  const slotHTML = i => `<div class="job-request-slot" data-job-slot="${esc(i.id)}">${i.html}</div>`;
  function requestsHTML() {
    const items = requestItems(), n = pendingCount();
    return `<p class="vault-request-changed job-request-missing" data-job-request-missing role="status" tabindex="-1" hidden>${esc(MISSING)}</p>
      <section class="job-requests" data-job-requests aria-labelledby="job-requests-h"${items.length ? '' : ' hidden'}>
        <h4 class="vault-set-head job-requests-head" id="job-requests-h">Waiting for you<span class="badge" data-job-requests-count${n ? '' : ' hidden'}>${n || ''}</span></h4>
        <div class="job-request-list" data-job-request-list>${items.map(slotHTML).join('')}</div>
      </section>`;
  }
  const ANSWERED = { allowed: 'Allowed', denied: 'Denied', expired: 'Expired' };
  const answeredRow = a => `<li data-job-answered-row="${esc(a.id)}"><span class="job-answered-name">${esc(a.name || '')}</span><span class="job-answered-facts">${esc([ANSWERED[a.status] || a.status, when(a.answeredAt || a.proposedAt), a.edited?.length ? 'edited' : ''].filter(Boolean).join(' · '))}</span></li>`;
  let answeredOpen = false;
  function answeredHTML() {
    const list = data?.answered || [];
    return `<details class="settings-details job-answered" data-job-answered${answeredOpen ? ' open' : ''}${list.length ? '' : ' hidden'}><summary>Recently answered<span class="summary-meta" data-job-answered-count>${list.length || ''}</span></summary>
      <ul class="job-answered-list" data-job-answered-list>${list.map(answeredRow).join('')}</ul></details>`;
  }
  const writtenSlots = new WeakMap(); // request slot → the HTML last written into it
  function paintRequests() {
    const host = hostEl(); if (!host || !data) return;
    const sec = host.querySelector('[data-job-requests]'), list = host.querySelector('[data-job-request-list]'); if (!sec || !list) return;
    const items = requestItems(), n = pendingCount();
    setHidden(sec, items.length === 0);
    const count = host.querySelector('[data-job-requests-count]'), word = n ? String(n) : '';
    if (count.textContent !== word) count.textContent = word;
    setHidden(count, !n);
    list.querySelectorAll(':scope > [data-job-slot]').forEach(s => { if (!items.some(i => i.id === s.dataset.jobSlot)) s.remove(); });
    let prev = null;
    for (const i of items) {
      let slot = list.querySelector(`:scope > [data-job-slot="${CSS.escape(i.id)}"]`);
      if (!slot) { const t = document.createElement('template'); t.innerHTML = slotHTML(i); slot = t.content.firstElementChild; writtenSlots.set(slot, i.html); }
      if (!writtenSlots.has(slot)) writtenSlots.set(slot, slot.innerHTML === i.html ? i.html : null);
      if (writtenSlots.get(slot) !== i.html) { slot.innerHTML = i.html; writtenSlots.set(slot, i.html); }
      const want = prev ? prev.nextElementSibling : list.firstElementChild;
      if (want !== slot) list.insertBefore(slot, want);
      prev = slot;
    }
    // Recently answered
    const det = host.querySelector('[data-job-answered]'), ul = host.querySelector('[data-job-answered-list]'), ans = data.answered || [];
    if (det && ul) {
      setHidden(det, ans.length === 0);
      const html = ans.map(answeredRow).join('');
      if (writtenSlots.get(ul) !== html) { ul.innerHTML = html; writtenSlots.set(ul, html); }
      const c = det.querySelector('[data-job-answered-count]'), cw = ans.length ? String(ans.length) : '';
      if (c.textContent !== cw) c.textContent = cw;
    }
    paintBadges();
    resolveFocus();
  }
  // The count while requests wait: on the Automation entry of Settings and on the Job keys heading (the app's badge).
  let knownCount = 0;
  function paintBadges(n) {
    if (Number.isFinite(n)) knownCount = n;
    else if (data && on()) knownCount = pendingCount();
    if (!on()) knownCount = 0;
    const label = `${knownCount} job key ${knownCount === 1 ? 'request' : 'requests'} waiting for you`;
    for (const el of document.querySelectorAll('[data-settings-category="automation"], #auto-jobs-h')) {
      let b = el.querySelector(':scope > [data-job-requests-badge]');
      if (!b && !knownCount) continue;
      if (!b) { b = document.createElement('span'); b.className = 'badge job-requests-badge'; b.dataset.jobRequestsBadge = ''; const chevron = el.querySelector(':scope > svg'); el.insertBefore(b, chevron || null); }
      const word = knownCount ? String(knownCount) : '';
      if (b.textContent !== word) b.textContent = word;
      setHidden(b, !knownCount);
      if (b.title !== (knownCount ? label : '')) b.title = knownCount ? label : '';
    }
  }
  const flash = el => { if (!el) return; el.classList.remove('vault-flash'); void el.offsetWidth; el.classList.add('vault-flash'); setTimeout(() => el.classList.remove('vault-flash'), 2600); };
  function resolveFocus() {
    if (!pendingFocus || !data) return;
    const host = hostEl(); if (!host) return;
    const id = pendingFocus; pendingFocus = null;
    const slot = host.querySelector(`[data-job-slot="${CSS.escape(id)}"]`), missing = host.querySelector('[data-job-request-missing]');
    if (slot) {
      setHidden(missing, true);
      const target = slot.querySelector('[data-job-request] h4, [data-job-outcome]');
      flash(slot.firstElementChild);
      slot.scrollIntoView({ block: 'center' });
      target?.focus({ preventScroll: true });
    } else if (missing) {
      setHidden(missing, false);
      missing.scrollIntoView({ block: 'center' });
      missing.focus({ preventScroll: true });
    }
  }
  // The push link (/#/settings/jobs/request/<id>): Settings → Automation, the request's card in view and marked.
  function openRequest(id) {
    pendingFocus = String(id || '');
    if (typeof settingsSheet === 'function') settingsSheet({ category: 'automation' });
  }
  const requestFromHash = h => { const m = /^#\/settings\/jobs\/request\/([^/?#]+)$/.exec(h || ''); return m ? decodeURIComponent(m[1]) : null; };
  // Allow or Deny, from the card or from Edit first. Returns the answer, or throws the server's refusal (after showing it).
  async function answer(r, payload, { fromCard = true } = {}) {
    cardErrors.delete(r.id);
    try {
      const res = await api('/jobs/requests/' + encodeURIComponent(r.id) + '/answer', { method: 'POST', body: JSON.stringify(payload), cache: 'no-store' });
      const at = r.proposedAt || '', session = r.session || '';
      if (payload.answer === 'deny') outcomes.set(r.id, { kind: 'denied', text: 'Denied. No key was made.', at, session });
      else {
        const changed = (res.edited || []).map(f => CHANGED_WORDS[f] || f);
        outcomes.set(r.id, { kind: 'allowed', file: res.file || res.key?.keyFile || '', changed: changed.length ? `You changed: ${changed.join(', ')}.` : '', at, session });
      }
      await load();
      return res;
    } catch (e) {
      if (e.message === 'login') throw e;
      if (GONE.has(e.code) || e.status === 404) { outcomes.set(r.id, { kind: 'gone', text: e.message || MISSING, at: r.proposedAt || '' }); await load(); throw e; }
      // A refusal (a name made since, a folder that went, the key file): the card stays, with the server's words.
      if (fromCard) cardErrors.set(r.id, e.message || 'Could not answer the request.');
      if (e.body?.request) { const i = (data?.requests || []).findIndex(x => x.id === r.id); if (i >= 0) data.requests[i] = e.body.request; }
      paintRequests();
      load();
      throw e;
    }
  }
  async function onCardClick(e) {
    const card = e.target.closest('[data-job-request]'); if (!card) return false;
    const r = (data?.requests || []).find(x => x.id === card.dataset.jobRequest); if (!r) return true;
    if (e.target.closest('[data-job-request-chat]')) { closeCurrentSheet?.(); return true; }
    const allow = e.target.closest('[data-jr-allow]'), deny = e.target.closest('[data-jr-deny]');
    if (e.target.closest('[data-jr-edit]')) { editRequestSheet(r); return true; }
    if (!allow && !deny) return true;
    const buttons = [...card.querySelectorAll('button')], slot = card.closest('[data-job-slot]');
    buttons.forEach(b => { b.disabled = true; });
    try { await answer(r, { answer: allow ? 'allow' : 'deny' }); }
    catch { }
    buttons.forEach(b => { if (b.isConnected) b.disabled = false; });
    // The card went: the line that replaced it takes focus, so the keyboard doesn't fall back to the top of the sheet.
    // A refusal keeps the card (rewritten with the server's words): focus goes to Edit first, never to Allow.
    const now = hostEl()?.querySelector(`[data-job-slot="${CSS.escape(r.id)}"]`) || slot;
    (now?.querySelector('[data-job-outcome]') || now?.querySelector('[data-jr-edit]'))?.focus({ preventScroll: true });
    return true;
  }

  /* ---------- the list under Settings → Automation → Job keys ---------- */
  function rowInner(k) {
    return `${KEY_ICON}<span class="job-key-text"><span class="job-key-name">${esc(k.name)}</span><span class="sub job-key-facts">${esc(factsA(k))}</span><span class="sub job-key-facts" data-job-key-state="${esc(stateOf(k))}">${esc(factsB(k))}</span></span>`;
  }
  const rowHTML = k => `<li class="job-key-item" data-job-key="${esc(k.id)}"><button type="button" class="opt job-key-row" data-job-open="${esc(k.id)}">${rowInner(k)}</button></li>`;
  function listInner() {
    const keys = data?.keys || [];
    return `${requestsHTML()}
      <div class="job-key-block" data-job-key-block>
      <p class="title-note job-keys-lead" data-job-empty${keys.length ? ' hidden' : ''}>${esc(LEAD)}</p>
      <ul class="job-key-list" aria-label="Job keys" data-job-list${keys.length ? '' : ' hidden'}>${keys.map(rowHTML).join('')}</ul>
      <p class="title-note" data-job-loading${data ? ' hidden' : ''}>Loading the job keys…</p>
      <span class="vault-set-actions"><button type="button" class="chip" data-job-new>${IC.plus}New job key</button></span>
      <p class="vault-field-error" data-job-list-error role="alert"></p>
      ${answeredHTML()}</div>`;
  }
  const listHTML = () => on() ? `<div class="job-keys" data-job-keys>${listInner()}</div>` : '';
  const hostEl = () => document.querySelector('[data-job-keys]');
  const written = new WeakMap(); // row button → the HTML last written into it
  // Called after Settings → Automation paints its body: the rows came in as HTML, so what they hold is recorded first.
  function bind(root) {
    const host = root.querySelector('[data-job-keys]');
    if (!host) {
      // Job keys are off: a push link lands on the group, with the line that the request is gone.
      if (pendingFocus) { pendingFocus = null; const st = root.querySelector('[data-auto-status="jobs"]'); if (st) { st.textContent = MISSING; st.closest('[data-auto-group]')?.scrollIntoView({ block: 'center' }); } }
      paintBadges(0);
      return;
    }
    for (const b of host.querySelectorAll('[data-job-open]')) { const k = data?.keys.find(x => x.id === b.dataset.jobOpen); if (k) written.set(b, rowInner(k)); }
    const items = requestItems();
    for (const s of host.querySelectorAll('[data-job-slot]')) { const i = items.find(x => x.id === s.dataset.jobSlot); if (i) writtenSlots.set(s, i.html); }
    const ans = host.querySelector('[data-job-answered-list]'); if (ans) writtenSlots.set(ans, (data?.answered || []).map(answeredRow).join(''));
    const det = host.querySelector('[data-job-answered]'); if (det) det.addEventListener('toggle', () => { answeredOpen = det.open; });
    host.addEventListener('click', e => {
      if (e.target.closest('[data-job-outcome] [data-job-request-chat]')) { closeCurrentSheet?.(); return; } // the link then opens the conversation
      if (e.target.closest('[data-job-request]')) return onCardClick(e);
      const open = e.target.closest('[data-job-open]'); if (open) return keySheet(open.dataset.jobOpen);
      if (e.target.closest('[data-job-new]')) newSheet();
    });
    // Enter never allows: not on the card, not on Allow itself (Space or a click/tap does). Allow is never focused for you.
    host.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest?.('[data-jr-allow]')) e.preventDefault(); });
    paintBadges();
    ensureModels();
    load();
    tick();
  }
  const setHidden = (el, h) => { if (el && el.hidden !== h) el.hidden = h; };
  function paintList() {
    const host = hostEl(); if (!host || !data) return;
    const keys = data.keys || [], ul = host.querySelector('[data-job-list]');
    setHidden(host.querySelector('[data-job-loading]'), true);
    setHidden(host.querySelector('[data-job-empty]'), keys.length > 0);
    setHidden(ul, keys.length === 0);
    // Rows that went, then each key's row in order: written only when its HTML changed, moved only when out of place.
    ul.querySelectorAll(':scope > [data-job-key]').forEach(li => { if (!keys.some(k => k.id === li.dataset.jobKey)) li.remove(); });
    let prev = null;
    for (const k of keys) {
      let li = ul.querySelector(`:scope > [data-job-key="${CSS.escape(k.id)}"]`);
      if (!li) { const t = document.createElement('template'); t.innerHTML = rowHTML(k); li = t.content.firstElementChild; written.set(li.firstElementChild, rowInner(k)); }
      const b = li.firstElementChild, html = rowInner(k);
      if (written.get(b) !== html) { b.innerHTML = html; written.set(b, html); }
      const want = prev ? prev.nextElementSibling : ul.firstElementChild;
      if (want !== li) ul.insertBefore(li, want);
      prev = li;
    }
  }
  const sigOf = d => JSON.stringify(d);
  let lastSig = '';
  function load() {
    if (!on()) return Promise.resolve(null);
    if (loading) return loading;
    loading = api('/jobs/keys', { cache: 'no-store' }).then(d => {
      const err = hostEl()?.querySelector('[data-job-list-error]'); if (err && err.textContent) err.textContent = '';
      const sig = sigOf(d);
      if (sig !== lastSig) { lastSig = sig; data = d; ensureModels(); for (const id of cardErrors.keys()) if (!d.requests?.some(r => r.id === id)) cardErrors.delete(id); }
      paintList();
      paintRequests();
      return data;
    }, e => {
      const err = hostEl()?.querySelector('[data-job-list-error]'), msg = e.message === 'login' ? '' : e.message || 'Could not load the job keys.';
      if (err && err.textContent !== msg) err.textContent = msg;
      return null;
    }).finally(() => { loading = null; });
    return loading;
  }
  // The model lists the rows name models from (loaded once per agent; a list that arrives repaints the names).
  function ensureModels() {
    for (const e of new Set([...(data?.keys || []).map(k => k.engine), ...(data?.defaults?.engines || [])])) {
      if (models.has(e) || typeof loadModelsFor !== 'function') continue;
      models.add(e);
      loadModelsFor(e).then(() => { paintList(); paintOpenSheet(); }).catch(() => { });
    }
  }
  // Every 5 seconds while the list or a key's sheet shows and the page is visible; stops by itself when neither does.
  function tick() {
    if (timer) return;
    timer = setInterval(() => {
      const sheet = openSheet();
      // Settings closed: the lines that replaced answered cards go with it.
      if (!hostEl() && !sheet) { if (document.querySelector('.settings-sheet')) return; clearInterval(timer); timer = null; outcomes.clear(); cardErrors.clear(); return; }
      if (document.visibilityState !== 'visible' || !on()) return;
      load().then(() => paintOpenSheet());
      if (sheet?.id) loadRuns(sheet);
    }, REFRESH_MS);
  }

  /* ---------- a key's sheet, and the New job key sheet ---------- */
  let current = null; // { el, id } while a key's sheet (or the New sheet, id null) shows
  const openSheet = () => current?.el?.isConnected ? current : null;
  const keyOf = id => data?.keys.find(k => k.id === id) || null;
  const fieldErr = (name, extra = '') => `<p class="vault-field-error" data-job-err="${name}" id="job-${name}-err" role="alert">${extra}</p>`;
  // Which field a server refusal names. Anything else shows under the form.
  const FIELD_OF = { bad_name: 'name', name_taken: 'name', bad_workspace: 'workspace', fixed_after_run: 'workspace', bad_engine: 'engine', engine_off: 'engine',
    attended_only: 'engine', bad_model: 'model', bad_effort: 'effort', bad_access: 'access', full_access_off: 'access', instruction_required: 'instruction',
    instruction_too_long: 'instruction', outside_home: 'save', file_exists: 'save', file_error: 'save' };
  function fieldFor(e) {
    if (e.code === 'bad_limit') return /^Runs per day/.test(e.message) ? 'perDay' : /^Runs at once/.test(e.message) ? 'atOnce' : 'perHour';
    return FIELD_OF[e.code] || 'form';
  }
  function engineOptions(engine) {
    const list = (data?.defaults?.engines || []).filter(e => AGENT[e]);
    if (engine && !list.includes(engine)) list.push(engine); // a key's agent that has since been switched off still shows
    return list.map(e => `<option value="${e}"${e === engine ? ' selected' : ''}>${AGENT[e]}</option>`).join('');
  }
  function modelOptions(engine, model) {
    const seen = new Set(), rows = listFor(engine).filter(m => !seen.has(m[0]) && seen.add(m[0]));
    if (model && model !== 'default' && !rows.some(m => m[0] === model)) rows.push([model, model]);
    return rows.map(([v, l, , chip]) => `<option value="${esc(v)}"${v === (model || 'default') ? ' selected' : ''}>${esc(v === 'default' && chip && chip !== 'Default' ? `Default (${chip})` : l)}</option>`).join('');
  }
  // The effort levels the composer offers for that agent and model.
  function effortLevels(engine, model) {
    const ids = EFFORTS.map(e => e[0]);
    if (engine === 'acp') { const m = model === 'default' || !model ? providerDefaults.acp?.model : model; return (acpEfforts.get(m) || []).filter(v => ids.includes(v)).sort((a, b) => ids.indexOf(a) - ids.indexOf(b)); }
    if (engine === 'codex') { const m = model === 'default' || !model ? providerDefaults.codex?.model : model; return [...(codexEfforts.get(m)?.includes('ultra') ? ['ultra'] : []), ...ids]; }
    const cap = providerDefaults.claude?.maxEffort; return cap ? ids.filter(v => ids.indexOf(v) >= ids.indexOf(cap)) : ids;
  }
  function effortOptions(engine, model, effort) {
    const levels = effortLevels(engine, model);
    if (effort && !levels.includes(effort)) levels.unshift(effort);
    return `<option value="default"${!effort ? ' selected' : ''}>Default</option>` + levels.map(v => `<option value="${v}"${v === effort ? ' selected' : ''}>${esc(EFFORT_NAMES[v] || v)}</option>`).join('');
  }
  const switchHTML = (key, label, sub, on) => `<button type="button" class="opt job-bool" data-job-bool="${key}" aria-pressed="${on}"><span class="dot${on ? ' on' : ''}"></span><span>${esc(label)}<span class="sub">${esc(sub)}</span></span></button>`;
  const LIMITS = [['perHour', 'jobPerHour', 'Runs per hour'], ['perDay', 'jobPerDay', 'Runs per day'], ['atOnce', 'jobAtOnce', 'Runs at once']];
  function limitHTML([f, setting, label], value) {
    const s = typeof Automation !== 'undefined' && Automation.settingOf('jobs', setting) || {}, off = value === 'off', id = 'job-limit-' + f;
    const range = s.min != null ? `${s.min} to ${s.max}${s.offAllowed ? ', or No limit' : ''}.` : '';
    return `<div class="automation-row automation-number" data-job-row="${f}">
      <label class="automation-label" for="${id}">${esc(label)}</label>
      <span class="automation-input"><input type="number" id="${id}" data-job-limit="${f}" inputmode="numeric" ${s.min != null ? `min="${s.min}" max="${s.max}"` : ''} step="1" value="${off ? '' : esc(value ?? '')}" placeholder="${off ? 'No limit' : ''}" ${off ? 'disabled' : ''} aria-describedby="${id}-note job-${f}-err"></span>
      ${s.offAllowed ? `<button type="button" class="chip automation-off" data-job-nolimit="${f}" aria-pressed="${off}" aria-label="No limit: ${esc(label)}">No limit</button>` : ''}
      <p class="title-note" id="${id}-note">${esc(range)}</p>${fieldErr(f)}</div>`;
  }
  // The form: the same fields for a new key and an existing one (Folder and Agent read-only once it has run).
  // `pre`: a request's fields (Edit first), the values a new key starts from; its key file is always written on Allow.
  function formHTML(key, d, pre = null) {
    const k = key || pre, isNew = !key, fixed = Boolean(key?.hasRun || key?.lastRunAt), locked = Boolean(d.workspace);
    const engine = k?.engine || (d.engines || []).find(e => AGENT[e]) || 'claude', model = k?.model || 'default', effort = k?.effort || null;
    const limits = k?.limits || d.limits || {}, folder = short(k?.workspace || d.workspace || '');
    const fileName = (d.folder || '~/.config/pocket/jobs/') + '<name>.key';
    const saveLine = pre ? `<p class="vault-hint job-key-file" id="job-save-hint">Pocket saves the key to <span class="vault-path">${esc(fileName)}</span>. The conversation gets the file’s path, not the key.</p>${fieldErr('save')}`
      : isNew ? switchHTML('save', 'Save the key to a file', fileName, true) + fieldErr('save') : '';
    return `<form class="project-form vault-form job-key-form" autocomplete="off" novalidate>
      ${isNew ? `<label class="voice-field">Name<input type="text" name="name" maxlength="48" placeholder="disk-check" value="${esc(pre?.name || '')}" spellcheck="false" autocapitalize="none" autocorrect="off" class="vault-name-input" aria-describedby="job-name-hint job-name-err"></label>
      <p class="vault-hint" id="job-name-hint">1 to 48 lowercase letters, digits, - or _, like disk-check. It names the conversations and pushes.</p>${fieldErr('name')}`
        : `<label class="voice-field">Name<input type="text" name="name" maxlength="48" value="${esc(k.name)}" spellcheck="false" autocapitalize="none" autocorrect="off" class="vault-name-input" aria-describedby="job-name-hint job-name-err"></label>
      <p class="vault-hint" id="job-name-hint">Renaming does not rename its key file.</p>${fieldErr('name')}`}
      <label class="voice-field">Folder<input type="text" name="workspace" value="${esc(folder)}" placeholder="~/projects/disk-check" list="job-folders" spellcheck="false" autocapitalize="none" autocorrect="off"${fixed || locked ? ' readonly aria-readonly="true"' : ''} aria-describedby="job-workspace-hint job-workspace-err"></label>
      <datalist id="job-folders"></datalist>
      <p class="vault-hint" id="job-workspace-hint">${esc(fixed ? FIXED : locked ? 'Every conversation on this Pocket starts in this folder.' : 'Every run works here. The job can’t choose another folder.')}</p>${fieldErr('workspace')}
      <label class="voice-field">Agent<select name="engine"${fixed ? ' disabled aria-describedby="job-workspace-hint job-engine-err"' : ' aria-describedby="job-engine-err"'}>${engineOptions(engine)}</select></label>${fieldErr('engine')}
      <div class="job-model-pair">
        <label class="voice-field">Model<select name="model" aria-describedby="job-model-err">${modelOptions(engine, model)}</select></label>
        <label class="voice-field" data-job-effort-wrap>Effort<select name="effort" aria-describedby="job-effort-err">${effortOptions(engine, model, effort)}</select></label>
      </div>${fieldErr('model')}${fieldErr('effort')}
      <label class="voice-field">Access<select name="access" aria-describedby="job-access-hint job-access-err">
        <option value="ask"${(k?.access || d.access) !== 'full' ? ' selected' : ''}>Ask first</option>${d.fullAccessAllowed || k?.access === 'full' ? `<option value="full"${(k?.access || d.access) === 'full' ? ' selected' : ''}>Full access</option>` : ''}</select></label>
      <p class="vault-hint" id="job-access-hint">${esc(d.fullAccessAllowed ? 'Ask first puts an approval card in the conversation for every action.' : 'Ask first puts an approval card in the conversation for every action. Full access is turned off on this server.')}</p>${fieldErr('access')}
      <label class="voice-field">Instruction<textarea name="instruction" rows="${pre ? 8 : 4}" maxlength="20000" placeholder="Read the disk report in the data and tell me which volumes need attention. Don’t change anything." aria-describedby="job-instruction-hint job-instruction-err">${esc(k?.instruction || '')}</textarea></label>
      <p class="vault-hint" id="job-instruction-hint">Required. Every run follows this; what the job sends comes after it as data.</p>${fieldErr('instruction')}
      ${switchHTML('mayAddInstructions', 'The job may add its own instructions', 'Off: everything the job sends is treated as data.', k ? k.mayAddInstructions === true : d.mayAddInstructions === true)}
      <div class="job-limits" role="group" aria-labelledby="job-limits-h"><p class="vault-set-head" id="job-limits-h">Limits for this key</p>${LIMITS.map(l => limitHTML(l, limits[l[0]])).join('')}</div>
      ${switchHTML('pushWhenDone', 'Push when a job finishes', 'The reply’s first line, on the devices that get check-backs and job results.', k ? k.pushWhenDone !== false : d.pushWhenDone !== false)}
      ${isNew ? saveLine : k.keyFile ? `<p class="vault-hint job-key-file">Key file: <span class="vault-path">${esc(short(k.keyFile))}</span></p>` : ''}
      <p class="vault-form-error" data-job-err="form" role="alert"></p>
      ${pre ? `<div class="job-request-edit-actions"><button type="button" class="chip" data-jr-cancel>Cancel</button><button type="button" class="primary" data-jr-allow-edit>Allow with these changes</button></div>`
        : `<button class="primary" type="submit">${isNew ? 'Create' : 'Save changes'}</button>`}
    </form>`;
  }
  function runsHTML() {
    return `<section class="job-runs-wrap" aria-labelledby="job-runs-h"><p class="vault-set-head" id="job-runs-h">Recent runs</p>
      <p class="title-note" data-job-runs-note>Loading the runs…</p><ul class="job-runs" data-job-runs hidden></ul></section>`;
  }
  // The sheet for a key (id) or a new one (no id).
  async function keySheet(id = null) {
    if (!data) await load();
    const k = id ? keyOf(id) : null;
    if (id && !k) { toast('That job key is gone.'); return; }
    const d = data?.defaults || {};
    let folders = [];
    const scrim = document.createElement('div'); scrim.className = 'scrim';
    const sh = document.createElement('div'); sh.className = 'sheet job-key-sheet';
    sh.innerHTML = `<h2>${k ? 'Job key' : 'New job key'}</h2>${k ? `<p class="sheet-name job-key-title">${esc(k.name)}</p>
      <div class="job-key-actions"><button type="button" class="chip" data-job-toggle>${k.enabled === false ? 'Turn on' : 'Turn off'}</button><button type="button" class="chip" data-job-rotate>${KEY_ICON}Rotate key</button><button type="button" class="chip doc-danger" data-job-delete>Delete</button></div>
      <p class="title-note job-key-status" data-job-status role="status">${esc(statusLine(k))}</p>` : `<p class="sheet-help job-key-help">${esc(LEAD)} It can’t change any of this.</p>`}
      ${formHTML(k, d)}${k ? runsHTML() : ''}`;
    mountSheet(scrim, sh);
    current = { el: sh, id, runsWritten: new WeakMap(), runsSig: '' };
    const form = sh.querySelector('form');
    bindForm(sh, form, k);
    if (k) bindKeyActions(sh, k.id);
    if (k) loadRuns(current);
    tick();
    if (!k) form.name.focus();
    // The folders conversations started in, as suggestions (New's list).
    if (!d.workspace) api('/projects').then(r => {
      folders = (r.projects || []).slice(0, 12);
      const list = sh.querySelector('#job-folders'); if (list) list.innerHTML = folders.map(p => `<option value="${esc(short(p))}">`).join('');
      if (!k && form.workspace && !form.workspace.value) form.workspace.value = short(r.defaultCwd || folders[0] || '');
    }).catch(() => { });
  }
  const newSheet = () => keySheet(null);
  // Edit first: the New job key sheet with the request's fields, titled "Edit before you allow". Its button allows the
  // request with the fields the owner changed; Cancel goes back to the card. A refusal shows under its field.
  function editRequestSheet(r) {
    const d = data?.defaults || {};
    const scrim = document.createElement('div'); scrim.className = 'scrim';
    const sh = document.createElement('div'); sh.className = 'sheet job-key-sheet job-request-edit'; sh.dataset.jobRequestEdit = r.id;
    const from = r.sessionTitle ? `“${r.sessionTitle}”` : 'A conversation';
    sh.innerHTML = `<h2>Edit before you allow</h2>
      <p class="sheet-help job-key-help">${esc(from)} asked for this job key. Change what you want, then allow it. The conversation is told which fields you changed.</p>
      ${formHTML(null, d, r.fields || {})}`;
    mountSheet(scrim, sh);
    current = { el: sh, id: null, request: r.id };
    const form = sh.querySelector('form');
    bindForm(sh, form, null, r);
    sh.querySelector('[data-jr-cancel]').onclick = () => { pendingFocus = r.id; backToSettings(sh); };
    tick();
    form.instruction.focus({ preventScroll: true });
    form.instruction.setSelectionRange(0, 0);
    if (!d.workspace) api('/projects').then(x => {
      const list = sh.querySelector('#job-folders'); if (list) list.innerHTML = (x.projects || []).slice(0, 12).map(p => `<option value="${esc(short(p))}">`).join('');
    }).catch(() => { });
  }
  // The fields the owner changed from the request, as the answer route takes them.
  function requestChanges(sh, form, r) {
    const all = collect(sh, form, null), pre = r.fields || {}, out = {};
    delete all.save;
    const cur = { ...pre, workspace: short(pre.workspace || ''), model: pre.model || 'default', effort: pre.effort || null, mayAddInstructions: pre.mayAddInstructions === true, pushWhenDone: pre.pushWhenDone !== false };
    for (const f of ['name', 'workspace', 'engine', 'model', 'effort', 'access', 'instruction', 'mayAddInstructions', 'pushWhenDone']) {
      if (f === 'instruction' ? all[f].trim() !== (cur[f] || '').trim() : JSON.stringify(all[f]) !== JSON.stringify(cur[f])) out[f] = all[f];
    }
    if (['perHour', 'perDay', 'atOnce'].some(f => JSON.stringify(all.limits[f]) !== JSON.stringify(pre.limits?.[f]))) out.limits = all.limits;
    return out;
  }
  const statusLine = k => [stateOf(k), lastRun(k)].join(' · ');
  // A refresh while a key's sheet shows: its status line and its On/Off button follow; the fields are left alone.
  function paintOpenSheet() {
    const s = openSheet(); if (!s?.id) return;
    const k = keyOf(s.id); if (!k) return;
    const st = s.el.querySelector('[data-job-status]'), line = statusLine(k);
    if (st && st.textContent !== line) st.textContent = line;
    const t = s.el.querySelector('[data-job-toggle]'), word = k.enabled === false ? 'Turn on' : 'Turn off';
    if (t && t.textContent !== word) t.textContent = word;
  }
  function bindForm(sh, form, k, req = null) {
    const clear = () => sh.querySelectorAll('[data-job-err]').forEach(e => { if (e.textContent) e.textContent = ''; });
    sh.querySelectorAll('[data-job-bool]').forEach(b => { b.onclick = () => { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); b.querySelector('.dot').classList.toggle('on', on); }; });
    sh.querySelectorAll('[data-job-nolimit]').forEach(b => { b.onclick = () => {
      const off = b.getAttribute('aria-pressed') !== 'true', input = sh.querySelector(`[data-job-limit="${b.dataset.jobNolimit}"]`);
      b.setAttribute('aria-pressed', String(off)); input.disabled = off; input.placeholder = off ? 'No limit' : '';
      if (!off && !input.value) { const s = Automation.settingOf('jobs', LIMITS.find(l => l[0] === b.dataset.jobNolimit)[1]); input.value = s?.default ?? ''; }
    }; });
    // Model and effort follow the agent, and effort follows the model (OpenRouter models differ in the levels they take).
    const paintEffort = () => {
      const wrap = sh.querySelector('[data-job-effort-wrap]'), levels = effortLevels(form.engine.value, form.model.value);
      wrap.hidden = levels.length === 0;
      const keep = form.effort.value, html = effortOptions(form.engine.value, form.model.value, keep !== 'default' && levels.includes(keep) ? keep : null);
      if (form.effort.innerHTML !== html) form.effort.innerHTML = html;
    };
    form.engine.onchange = () => {
      const e = form.engine.value;
      form.model.innerHTML = modelOptions(e, 'default'); paintEffort();
      if (typeof loadModelsFor === 'function') loadModelsFor(e).then(() => { if (form.isConnected && form.engine.value === e) { const m = form.model.value; form.model.innerHTML = modelOptions(e, m); paintEffort(); } });
    };
    form.model.onchange = paintEffort;
    paintEffort();
    form.querySelectorAll('input,textarea,select').forEach(el => el.addEventListener('input', () => el.removeAttribute('aria-invalid')));
    // Edit before you allow: no key press in a field allows. The form has no submit button, and a submit that comes anyway
    // (the Go key on a phone keyboard) is dropped; only a click or tap on Allow with these changes, or Enter/Space on that
    // button once the owner has moved focus there, answers the request. The owner's own New job key sheet submits as usual.
    if (req) {
      form.onsubmit = ev => ev.preventDefault();
      const btn = form.querySelector('[data-jr-allow-edit]');
      btn.onclick = async () => {
        if (btn.disabled) return;
        clear();
        btn.disabled = true;
        const fields = requestChanges(sh, form, req);
        try {
          await answer(req, { answer: 'allow', ...(Object.keys(fields).length ? { fields } : {}) }, { fromCard: false });
          pendingFocus = req.id; backToSettings(sh);
        } catch (e) {
          if (!sh.isConnected || e.message === 'login') return;
          if (GONE.has(e.code) || e.status === 404) { pendingFocus = req.id; backToSettings(sh); return; }
          btn.disabled = false;
          showFieldError(sh, form, e);
        }
      };
      return;
    }
    form.onsubmit = async ev => {
      ev.preventDefault(); clear();
      const btn = form.querySelector('button[type=submit]');
      const body = collect(sh, form, k);
      if (k && !Object.keys(body).length) { setStatus(sh, 'Nothing changed.'); return; }
      btn.disabled = true;
      try {
        if (!k) {
          const r = await api('/jobs/keys', { method: 'POST', body: JSON.stringify(body), cache: 'no-store' });
          await load();
          shownOnce(r, { name: body.name });
        } else {
          const r = await api('/jobs/keys/' + encodeURIComponent(k.id), { method: 'POST', body: JSON.stringify(body), cache: 'no-store' });
          await load();
          if (sh.isConnected) { setStatus(sh, r.changed?.length ? 'Saved.' : 'Nothing changed.'); btn.disabled = false; }
        }
      } catch (e) {
        if (!sh.isConnected) return;
        btn.disabled = false;
        if (e.message === 'login') return;
        showFieldError(sh, form, e);
      }
    };
  }
  // A refusal under the field it names, in the server's words (anything else under the form).
  function showFieldError(sh, form, e) {
    const f = fieldFor(e), el = sh.querySelector(`[data-job-err="${f}"]`) || sh.querySelector('[data-job-err="form"]');
    el.textContent = e.message || 'Could not save the job key.';
    const control = f === 'save' ? sh.querySelector('[data-job-bool="save"]') || form.name : f in { perHour: 1, perDay: 1, atOnce: 1 } ? sh.querySelector(`[data-job-limit="${f}"]`) : form.elements[f];
    if (control && control.matches?.('input,select,textarea')) control.setAttribute('aria-invalid', 'true');
    (control?.disabled || control?.readOnly ? null : control)?.focus?.({ preventScroll: false });
    el.scrollIntoView?.({ block: 'nearest' });
  }
  const setStatus = (sh, text) => { const st = sh.querySelector('[data-job-err="form"]'); if (st) st.textContent = ''; toast(text); };
  // The fields as the server takes them; for an existing key, only the ones that changed.
  function collect(sh, form, k) {
    const pressed = key => sh.querySelector(`[data-job-bool="${key}"]`)?.getAttribute('aria-pressed') === 'true';
    const limits = {};
    for (const [f] of LIMITS) {
      const off = sh.querySelector(`[data-job-nolimit="${f}"]`)?.getAttribute('aria-pressed') === 'true', raw = sh.querySelector(`[data-job-limit="${f}"]`).value.trim();
      limits[f] = off ? 'off' : raw === '' ? raw : Number(raw);
    }
    const effortShown = !sh.querySelector('[data-job-effort-wrap]').hidden;
    const all = { name: form.name.value.trim(), workspace: form.workspace.value.trim(), engine: form.engine.value, model: form.model.value,
      effort: effortShown && form.effort.value !== 'default' ? form.effort.value : null, access: form.access.value, instruction: form.instruction.value,
      mayAddInstructions: pressed('mayAddInstructions'), pushWhenDone: pressed('pushWhenDone'), limits };
    if (!k) return { ...all, ...(pressed('save') ? { save: true } : {}) };
    const out = {}, cur = { ...k, workspace: short(k.workspace), model: k.model || 'default', effort: k.effort || null };
    for (const f of ['name', 'workspace', 'engine', 'model', 'effort', 'access', 'instruction', 'mayAddInstructions', 'pushWhenDone']) {
      if (f === 'instruction' ? all[f].trim() !== (cur[f] || '').trim() : JSON.stringify(all[f]) !== JSON.stringify(cur[f])) out[f] = all[f];
    }
    const changed = Object.fromEntries(Object.entries(limits).filter(([f, v]) => JSON.stringify(v) !== JSON.stringify(k.limits?.[f])));
    if (Object.keys(changed).length) out.limits = changed;
    // A key that has run sends neither folder nor agent (they show read-only).
    if (k.hasRun || k.lastRunAt) { delete out.workspace; delete out.engine; }
    return out;
  }

  /* ---------- Turn off / on, Rotate, Delete ---------- */
  function bindKeyActions(sh, id) {
    sh.querySelector('[data-job-toggle]').onclick = async e => {
      const b = e.currentTarget, k = keyOf(id); if (!k) return;
      b.disabled = true;
      try {
        await api(`/jobs/keys/${encodeURIComponent(id)}/${k.enabled === false ? 'enable' : 'disable'}`, { method: 'POST', body: '{}' });
        await load(); paintOpenSheet();
        toast(keyOf(id)?.enabled === false ? `${k.name} is off. Calls with its key are refused.` : `${k.name} is on.`);
      } catch (x) { if (x.message !== 'login') toast(x.message || 'Could not change the job key.'); }
      if (b.isConnected) { b.disabled = false; b.focus({ preventScroll: true }); }
    };
    sh.querySelector('[data-job-rotate]').onclick = () => confirm(id, 'rotate');
    sh.querySelector('[data-job-delete]').onclick = () => confirm(id, 'delete');
  }
  // The confirmations: the sheets' own confirm (a title, a line of help, the two options). Keep returns to the key's sheet.
  function confirm(id, what) {
    const k = keyOf(id); if (!k) return;
    const scrim = document.createElement('div'); scrim.className = 'scrim';
    const sh = document.createElement('div'); sh.className = 'sheet job-confirm'; sh.dataset.jobConfirm = what;
    const title = what === 'rotate' ? `Rotate the key for ${k.name}?` : `Delete ${k.name}?`;
    const help = what === 'rotate' ? 'The old key stops working at once. Pocket shows the new key once' + (k.keyFile ? ' and writes it to the key file.' : '.')
      : `Calls with its key are refused from now on. A run already working is not stopped.${k.keyFile ? ' Pocket removes its key file too.' : ''}`;
    sh.innerHTML = `<h2>${esc(title)}</h2><p class="sheet-help">${esc(help)}</p>`
      + `<button type="button" class="opt${what === 'delete' ? ' doc-danger' : ''}" data-yes>${IC.tick}<span>${what === 'rotate' ? 'Rotate key' : 'Delete'}</span></button><button type="button" class="opt" data-no>${IC.x}<span>Keep it as it is</span></button>`;
    mountSheet(scrim, sh);
    const yes = sh.querySelector('[data-yes]');
    sh.querySelector('[data-no]').onclick = () => keySheet(id);
    yes.onclick = async () => {
      yes.disabled = true;
      try {
        if (what === 'rotate') {
          const r = await api(`/jobs/keys/${encodeURIComponent(id)}/rotate`, { method: 'POST', body: '{}', cache: 'no-store' });
          await load();
          shownOnce(r, { name: k.name, rotated: true });
        } else {
          const r = await api(`/jobs/keys/${encodeURIComponent(id)}/delete`, { method: 'POST', body: '{}' });
          await load();
          toast(`Deleted ${k.name}.${r.fileRemoved ? ' Its key file was removed.' : ''}`);
          backToSettings(sh);
        }
      } catch (x) { if (x.message === 'login') return; toast(x.message || 'Could not change the job key.'); if (sh.isConnected) yes.disabled = false; }
    };
    yes.focus({ preventScroll: true });
  }
  const backToSettings = sh => { const b = sh._settingsParent; if (b) b(); else closeCurrentSheet?.(); };

  /* ---------- the key, shown once ---------- */
  // The answer to Create or Rotate is the only place the key exists in the app. It goes into the sheet's read-only field
  // and nowhere else; when the sheet leaves the page (Done, Escape, the scrim, another sheet) the field is emptied, and
  // the answer object is not kept.
  function shownOnce(r, { name, rotated = false }) {
    const scrim = document.createElement('div'); scrim.className = 'scrim';
    const sh = document.createElement('div'); sh.className = 'sheet vault-key-sheet job-key-once';
    const file = r.file || '', fileError = r.fileError?.error || '';
    const example = `pocket-run --key-file ${file ? shellPath(file) : '<path>'} --data-file report.txt`;
    sh.innerHTML = `<h2>${esc(rotated ? 'New key for ' + name : 'Key for ' + name)}</h2>
      <p class="vault-key-note">${esc(r.note || 'This is the only time the key is shown.')}</p>
      <label class="vault-key-label" for="job-once-key">Key</label>
      <textarea class="vault-key" id="job-once-key" readonly rows="2" spellcheck="false" autocapitalize="none" autocorrect="off" autocomplete="off" data-job-secret></textarea>
      <div class="vault-key-actions"><button type="button" class="chip" data-job-copy-key>${IC.copy}Copy</button></div>
      <p class="sheet-help job-once-file" data-job-file>${file ? `Saved to <span class="vault-path">${esc(file)}</span>, readable only by you.` : fileError ? esc('The key was not saved to a file: ' + fileError) + ' Copy it now and keep it somewhere only you can read.' : 'Not saved to a file. Copy it now into a file only you can read.'}</p>
      <label class="vault-key-label" for="job-once-example">Run the job from a script on this server</label>
      <textarea class="vault-key" id="job-once-example" readonly rows="1" spellcheck="false" autocapitalize="none" autocorrect="off" autocomplete="off"></textarea>
      <div class="vault-key-actions"><button type="button" class="chip" data-job-copy-example>${IC.copy}Copy</button><button type="button" class="primary" data-job-done>Done</button></div>`;
    const field = sh.querySelector('[data-job-secret]'), ex = sh.querySelector('#job-once-example');
    field.value = r.secret || ''; ex.value = example;
    field.addEventListener('focus', () => field.select());
    ex.addEventListener('focus', () => ex.select());
    sh.querySelector('[data-job-copy-key]').onclick = e => copy(field.value, e.currentTarget, 'Key');
    sh.querySelector('[data-job-copy-example]').onclick = e => copy(ex.value, e.currentTarget, 'Command');
    sh.querySelector('[data-job-done]').onclick = () => backToSettings(sh);
    mountSheet(scrim, sh);
    if (typeof onSheetGone === 'function') onSheetGone(sh, () => { field.value = ''; });
    sh.querySelector('[data-job-copy-key]').focus({ preventScroll: true });
  }
  // A path as a shell reads it: plain when it is safe, else in single quotes.
  const shellPath = p => /^[\w@%+=:,./~-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`;
  function copy(text, btn, what) {
    if (typeof vaultCopy === 'function') return vaultCopy(text, btn, what);
    navigator.clipboard?.writeText(text).then(() => toast(what + ' copied'), () => toast('Copy failed'));
  }

  /* ---------- Recent runs ---------- */
  function runInner(r) {
    const t = r.startedAt ? `<time datetime="${esc(r.startedAt)}">${esc(when(r.startedAt))}</time>` : '';
    const status = STATUS[r.status] || r.status;
    const reply = r.reply || (r.status === 'failed' ? FAILED[r.outcome] || '' : '');
    return `<span class="job-run-head">${t}<span class="job-run-status" data-status="${esc(r.status)}">${esc(status)}</span></span>${reply ? `<span class="job-run-reply">${esc(reply)}</span>` : ''}`;
  }
  const FAILED = { not_started: 'It could not start.', stopped: 'Stopped.', interrupted: 'Cut off by a restart.', error: 'The reply ended with an error.',
    limit: 'Stopped at a usage limit and was not retried.', jobs_off: 'Stopped at a usage limit. Job keys were switched off before the retry.' };
  function loadRuns(s) {
    if (!s?.id || s.fetching) return;
    s.fetching = api(`/jobs/keys/${encodeURIComponent(s.id)}/runs`, { cache: 'no-store' }).then(d => paintRuns(s, d.runs || []), e => {
      const note = s.el.querySelector('[data-job-runs-note]'), msg = e.message === 'login' ? '' : e.message || 'Could not load the runs.';
      if (note && note.textContent !== msg) { note.textContent = msg; note.hidden = !msg; }
    }).finally(() => { s.fetching = null; });
  }
  function paintRuns(s, runs) {
    if (!s.el.isConnected) return;
    const ul = s.el.querySelector('[data-job-runs]'), note = s.el.querySelector('[data-job-runs-note]');
    const empty = runs.length === 0, noteText = empty ? 'No runs yet. A run shows here when a script calls Pocket with this key.' : '';
    if (note.textContent !== noteText) note.textContent = noteText;
    setHidden(note, !empty); setHidden(ul, empty);
    // 1.124.3: the rows are the newest 20 runs, so a row pushed past the 20th goes (it grew while the sheet stayed open).
    const shown = runs.slice(0, 20);
    ul.querySelectorAll(':scope > [data-job-run]').forEach(li => { if (!shown.some(r => r.run === li.dataset.jobRun)) li.remove(); });
    let prev = null;
    for (const r of shown) {
      let li = ul.querySelector(`:scope > [data-job-run="${CSS.escape(r.run)}"]`);
      if (!li) { li = document.createElement('li'); li.dataset.jobRun = r.run; }
      // A run opens its conversation; one that never started has none, so it is a line, not a link. 1.124.3: a run first
      // drawn before its conversation was recorded becomes the link once it is.
      if (li.firstElementChild?.tagName !== (r.conversation ? 'A' : 'DIV')) {
        const a = document.createElement(r.conversation ? 'a' : 'div'); a.className = 'job-run';
        if (r.conversation) { a.href = '#/chat/' + encodeURIComponent(r.conversation); a.onclick = () => closeCurrentSheet?.(); }
        li.replaceChildren(a);
      }
      const a = li.firstElementChild, html = runInner(r);
      if (s.runsWritten.get(a) !== html) { a.innerHTML = html; s.runsWritten.set(a, html); }
      const want = prev ? prev.nextElementSibling : ul.firstElementChild;
      if (want !== li) ul.insertBefore(li, want);
      prev = li;
    }
  }

  /* ---------- 1.124: Tasks, a read-only Jobs group ----------
     GET /api/tasks `jobs: { keys, requests }` (only while Job keys and Show job keys in the Tasks list are on). The requests
     waiting for you lead, then each key in the Settings order. A row opens what it names: a request's card in Settings →
     Automation, a key's own sheet (Turn off, Rotate, Delete, Recent runs). The group itself changes nothing. */
  function taskFacts(k) {
    const s = k.lastRun?.status, needs = s === 'needs_you';
    const state = needs ? 'Needs you' : stateOf(k);
    const ran = k.lastRunAt ? `${lastRun(k)}${s && s !== 'working' && s !== 'starting' && !needs ? ` · ${STATUS[s] || s}` : ''}` : lastRun(k);
    return [state, ran, short(k.workspace)].filter(Boolean);
  }
  // `urgent`: the first fact asks for the owner (Needs you), in the due colour as a request's Waiting for you is.
  const factsHTML = (list, urgent = false) => list.map((f, i) => `<span${urgent && !i ? ' class="due-label"' : ''}>${esc(f)}</span>`).join('<span aria-hidden="true">·</span>');
  function tasksHTML(snap) {
    const g = on() && snap?.jobs && typeof snap.jobs === 'object' ? snap.jobs : null;
    const keys = Array.isArray(g?.keys) ? g.keys : [], reqs = Array.isArray(g?.requests) ? g.requests : [];
    if (!keys.length && !reqs.length) return '';
    const reqRow = r => {
      const from = r.sessionTitle || (typeof sessionName === 'function' ? sessionName(r.session) : '') || 'a conversation';
      const facts = [`From ${from}`, r.expiresAt ? `Expires ${when(r.expiresAt)}` : ''].filter(Boolean);
      return `<div class="session-item task-item job-task-item job-task-request" data-job-task-request="${esc(r.id)}">
  <span class="job-task-slot" aria-hidden="true">${KEY_ICON}</span>
  <button type="button" class="row" data-job-task-answer="${esc(r.id)}" aria-label="${esc(`Job key request: ${r.name}. ${facts.join('. ')}. Open it in Settings to allow or deny`)}"><span class="body"><span class="title">Job key request: ${esc(r.name)}</span><span class="session-status"><span class="due-label">Waiting for you</span><span aria-hidden="true">·</span>${factsHTML(facts)}</span></span></button></div>`;
    };
    const keyRow = k => {
      const facts = taskFacts(k), title = k.title || k.name, needs = k.lastRun?.status === 'needs_you' && k.lastRun.conversation;
      return `<div class="session-item task-item job-task-item" data-job-task-key="${esc(k.id)}">
  <span class="job-task-slot" aria-hidden="true">${KEY_ICON}</span>
  <button type="button" class="row" data-job-task-open="${esc(k.id)}" aria-label="${esc(`${title}, job key ${k.name}. ${facts.join('. ')}. Open the job key`)}"><span class="body"><span class="title">${esc(title)}</span><span class="session-status">${factsHTML(facts, Boolean(needs))}</span></span></button>
  ${needs ? `<a class="chip job-task-chat" href="#/chat/${encodeURIComponent(k.lastRun.conversation)}" aria-label="${esc(`Open the run that needs you: ${title}`)}">Open</a>` : ''}</div>`;
    };
    const count = `${keys.length}${reqs.length ? ` · ${reqs.length} waiting for you` : ''}`;
    return `<section class="session-group project-group job-task-group" aria-labelledby="tk-jobs-h"><h2 id="tk-jobs-h">Jobs <span>${esc(count)}</span></h2>${reqs.map(reqRow).join('')}${keys.map(keyRow).join('')}</section>`;
  }
  function bindTasks(root) {
    root.querySelectorAll('[data-job-task-open]').forEach(b => { b.onclick = () => keySheet(b.dataset.jobTaskOpen); });
    root.querySelectorAll('[data-job-task-answer]').forEach(b => { b.onclick = () => openRequest(b.dataset.jobTaskAnswer); });
  }

  return { on, listHTML, bind, load, keySheet, newSheet, stateOf, lastRun, STATUS, ACCESS, openRequest, requestFromHash, paintBadges, tasksHTML, bindTasks };
})();
