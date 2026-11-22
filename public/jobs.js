/* Pocket Code — job keys, the app half. The owner creates a key with a fixed instruction, folder, agent, model and access;
   a script on this server calls POST /api/jobs/run with it and some data, and Pocket starts a reply the owner can watch.
   Here: the key list under Settings → Automation → Job keys, the New job key sheet, the key shown once (after Create and
   Rotate), a key's own sheet with Turn off / Turn on, Rotate key, Delete and Recent runs.
   Server contract: GET/POST /api/jobs/keys, POST /api/jobs/keys/:id (and /enable, /disable, /rotate, /delete),
   GET /api/jobs/keys/:id/runs; /api/me features.jobs. Loaded before app.js: everything here runs only when called, so
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

  /* ---------- the list under Settings → Automation → Job keys ---------- */
  function rowInner(k) {
    return `${KEY_ICON}<span class="job-key-text"><span class="job-key-name">${esc(k.name)}</span><span class="sub job-key-facts">${esc(factsA(k))}</span><span class="sub job-key-facts" data-job-key-state="${esc(stateOf(k))}">${esc(factsB(k))}</span></span>`;
  }
  const rowHTML = k => `<li class="job-key-item" data-job-key="${esc(k.id)}"><button type="button" class="opt job-key-row" data-job-open="${esc(k.id)}">${rowInner(k)}</button></li>`;
  function listInner() {
    const keys = data?.keys || [];
    return `<p class="title-note job-keys-lead" data-job-empty${keys.length ? ' hidden' : ''}>${esc(LEAD)}</p>
      <ul class="job-key-list" aria-label="Job keys" data-job-list${keys.length ? '' : ' hidden'}>${keys.map(rowHTML).join('')}</ul>
      <p class="title-note" data-job-loading${data ? ' hidden' : ''}>Loading the job keys…</p>
      <span class="vault-set-actions"><button type="button" class="chip" data-job-new>${IC.plus}New job key</button></span>
      <p class="vault-field-error" data-job-list-error role="alert"></p>`;
  }
  const listHTML = () => on() ? `<div class="job-keys" data-job-keys>${listInner()}</div>` : '';
  const hostEl = () => document.querySelector('[data-job-keys]');
  const written = new WeakMap(); // row button → the HTML last written into it
  // Called after Settings → Automation paints its body: the rows came in as HTML, so what they hold is recorded first.
  function bind(root) {
    const host = root.querySelector('[data-job-keys]'); if (!host) return;
    for (const b of host.querySelectorAll('[data-job-open]')) { const k = data?.keys.find(x => x.id === b.dataset.jobOpen); if (k) written.set(b, rowInner(k)); }
    host.addEventListener('click', e => {
      const open = e.target.closest('[data-job-open]'); if (open) return keySheet(open.dataset.jobOpen);
      if (e.target.closest('[data-job-new]')) newSheet();
    });
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
      if (sig !== lastSig) { lastSig = sig; data = d; ensureModels(); }
      paintList();
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
      if (!hostEl() && !sheet) { clearInterval(timer); timer = null; return; }
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
  function formHTML(k, d) {
    const isNew = !k, fixed = Boolean(k?.hasRun || k?.lastRunAt), locked = Boolean(d.workspace);
    const engine = k?.engine || (d.engines || []).find(e => AGENT[e]) || 'claude', model = k?.model || 'default', effort = k?.effort || null;
    const limits = k?.limits || d.limits || {}, folder = short(k?.workspace || d.workspace || '');
    const fileName = (d.folder || '~/.config/pocket/jobs/') + '<name>.key';
    return `<form class="project-form vault-form job-key-form" autocomplete="off" novalidate>
      ${isNew ? `<label class="voice-field">Name<input type="text" name="name" maxlength="48" placeholder="disk-check" spellcheck="false" autocapitalize="none" autocorrect="off" class="vault-name-input" aria-describedby="job-name-hint job-name-err"></label>
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
      <label class="voice-field">Instruction<textarea name="instruction" rows="4" maxlength="20000" placeholder="Read the disk report in the data and tell me which volumes need attention. Don’t change anything." aria-describedby="job-instruction-hint job-instruction-err">${esc(k?.instruction || '')}</textarea></label>
      <p class="vault-hint" id="job-instruction-hint">Required. Every run follows this; what the job sends comes after it as data.</p>${fieldErr('instruction')}
      ${switchHTML('mayAddInstructions', 'The job may add its own instructions', 'Off: everything the job sends is treated as data.', k ? k.mayAddInstructions === true : d.mayAddInstructions === true)}
      <div class="job-limits" role="group" aria-labelledby="job-limits-h"><p class="vault-set-head" id="job-limits-h">Limits for this key</p>${LIMITS.map(l => limitHTML(l, limits[l[0]])).join('')}</div>
      ${switchHTML('pushWhenDone', 'Push when a job finishes', 'The reply’s first line, on the devices that get check-backs and job results.', k ? k.pushWhenDone !== false : d.pushWhenDone !== false)}
      ${isNew ? switchHTML('save', 'Save the key to a file', fileName, true) + fieldErr('save') : k.keyFile ? `<p class="vault-hint job-key-file">Key file: <span class="vault-path">${esc(short(k.keyFile))}</span></p>` : ''}
      <p class="vault-form-error" data-job-err="form" role="alert"></p>
      <button class="primary" type="submit">${isNew ? 'Create' : 'Save changes'}</button>
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
  function bindForm(sh, form, k) {
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
        const f = fieldFor(e), el = sh.querySelector(`[data-job-err="${f}"]`) || sh.querySelector('[data-job-err="form"]');
        el.textContent = e.message || 'Could not save the job key.';
        const control = f === 'save' ? sh.querySelector('[data-job-bool="save"]') : f in { perHour: 1, perDay: 1, atOnce: 1 } ? sh.querySelector(`[data-job-limit="${f}"]`) : form.elements[f];
        if (control && control.matches?.('input,select,textarea')) control.setAttribute('aria-invalid', 'true');
        (control?.disabled || control?.readOnly ? null : control)?.focus?.({ preventScroll: false });
        el.scrollIntoView?.({ block: 'nearest' });
      }
    };
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
  const FAILED = { not_started: 'It could not start.', stopped: 'Stopped.', interrupted: 'Cut off by a restart.', error: 'The reply ended with an error.' };
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
    ul.querySelectorAll(':scope > [data-job-run]').forEach(li => { if (!runs.some(r => r.run === li.dataset.jobRun)) li.remove(); });
    let prev = null;
    for (const r of runs.slice(0, 20)) {
      let li = ul.querySelector(`:scope > [data-job-run="${CSS.escape(r.run)}"]`);
      if (!li) {
        // A run opens its conversation; one that never started has none, so it is a line, not a link.
        li = document.createElement('li'); li.dataset.jobRun = r.run;
        const a = document.createElement(r.conversation ? 'a' : 'div'); a.className = 'job-run';
        if (r.conversation) { a.href = '#/chat/' + encodeURIComponent(r.conversation); a.onclick = () => closeCurrentSheet?.(); }
        li.append(a);
      }
      const a = li.firstElementChild, html = runInner(r);
      if (s.runsWritten.get(a) !== html) { a.innerHTML = html; s.runsWritten.set(a, html); }
      const want = prev ? prev.nextElementSibling : ul.firstElementChild;
      if (want !== li) ul.insertBefore(li, want);
      prev = li;
    }
  }

  return { on, listHTML, bind, load, keySheet, newSheet, stateOf, lastRun, STATUS, ACCESS };
})();
