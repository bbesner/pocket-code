/* Pocket Code — 1.119: check-backs, the app half. An agent, asked by the owner, sets one later reply in its own
   conversation (pocket-checkback); Pocket starts it at the time. Here: the card under the reply that set it, the clock
   on a list row, the Tasks group, Cancel all in Settings → Features → Check-backs, and the words for all of them.
   Server contract: GET /api/checkbacks, POST /api/checkbacks/cancel and /cancel-all; /api/me features.checkbacks;
   /api/session/:id `checkbacks` (oldest first); a list row's `checkback: { pending, running, nextAt }`; /api/tasks
   `checkbacks`. Loaded before app.js: everything here runs only when called, so app.js's helpers (api, esc, toast,
   allSessions, chatId) are there by then. Nothing here repaints when the data did not change: each card keeps the
   HTML it last wrote and is moved only when it is not where it belongs. */
const CheckBacks = (() => {
  const CLOCK = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
  const ACTIVE = new Set(['pending', 'held', 'running']);
  const HELD = { paused: 'held while Pocket is paused', busy: 'waiting for the conversation to finish', usage_reset: 'waiting for a usage limit to reset', plan_ceiling: 'held by a plan ceiling', daily_limit: 'held by the daily limit' };
  const DONE = { failed: 'the reply didn’t finish', stopped: 'stopped', limit: 'hit a usage limit', interrupted: 'cut off by a restart' };
  const MISSED = { restarted: 'Pocket restarted while it was starting', late: 'it was past the catch-up window', busy: 'the conversation stayed busy', paused: 'Pocket was paused when it fell due', gone: 'the conversation is gone', failed: 'it could not start' };
  const on = () => Boolean(window.pocketFeatures?.checkbacks);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const valid = at => Number.isFinite(Date.parse(at || ''));

  /* ---------- times: the device's zone ---------- */
  const clockOf = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const today = d => d.toDateString() === new Date().toDateString();
  // "2:30 PM" today, "Nov 22, 9:00 AM" another day (with the year when it is not this one).
  function when(at) {
    const d = new Date(at); if (!valid(at)) return '';
    if (today(d)) return clockOf(d);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) }) + ', ' + clockOf(d);
  }
  const at = iso => valid(iso) && today(new Date(iso)) ? 'at ' + when(iso) : when(iso); // "at 2:30 PM" / "Nov 22, 9:00 AM"
  const full = iso => valid(iso) ? new Date(iso).toLocaleString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : '';
  const timeHTML = (iso, words) => `<time datetime="${esc(iso)}" title="${esc(full(iso))}">${esc(words)}</time>`;

  /* ---------- the words, one place: the card, Tasks and the manual read the same ---------- */
  // { lead (with the time as HTML), leadText, detail, cancel } for one check-back.
  function words(c) {
    const due = c.dueAt, will = valid(due) ? 'Will check back ' + at(due) : 'Will check back';
    const willHTML = valid(due) ? 'Will check back ' + (today(new Date(due)) ? 'at ' : '') + timeHTML(due, when(due)) : 'Will check back';
    if (c.status === 'pending') return { leadText: will, lead: willHTML, detail: '', cancel: true };
    if (c.status === 'held') return { leadText: will, lead: willHTML, detail: HELD[c.held?.reason] || 'held', cancel: true };
    if (c.status === 'running') return { leadText: 'Checking back now', lead: 'Checking back now', detail: '', cancel: false };
    if (c.status === 'done') {
      const t = [c.startedAt, c.outcome?.at, due].find(valid);
      return { leadText: 'Checked back ' + when(t), lead: 'Checked back ' + timeHTML(t, when(t)), detail: DONE[c.outcome?.kind] || '', cancel: false };
    }
    if (c.status === 'missed') { const s = c.outcome?.summary || MISSED[c.outcome?.kind] || 'it did not run'; return { leadText: 'Missed:', lead: 'Missed:', detail: s, sep: ' ', cancel: false }; }
    if (c.status === 'cancelled') return { leadText: 'Cancelled', lead: 'Cancelled', detail: '', cancel: false };
    return { leadText: '', lead: '', detail: '', cancel: false };
  }
  // The whole line in plain text: "Will check back at 2:30 PM · held while Pocket is paused", "Missed: …".
  const lineOf = c => { const w = words(c); return w.leadText + (w.detail ? (w.sep ?? ' · ') + w.detail : ''); };

  /* ---------- the card under the reply that set it ---------- */
  let chat = { id: null, list: [] }, rowSig = '', fetchedAt = 0, fetching = null;
  const sigOfRow = id => JSON.stringify([(typeof allSessions !== 'undefined' ? allSessions : []).find(s => s.id === id)?.checkback || null, typeof sessionsPause !== 'undefined' ? sessionsPause?.paused?.at || null : null]);
  // From GET /api/session/:id, on every render and resync of the conversation.
  function fromSession(id, s) {
    if (chat.id !== id) fetchedAt = 0;
    chat = { id, list: on() && Array.isArray(s?.checkbacks) ? s.checkbacks.map(c => ({ ...c })) : [] };
    rowSig = sigOfRow(id);
  }
  // The note (what the agent will check) is not on the card's face: it is in the tooltip and the card's accessible description
  // (a hidden line the card points to), so a note the owner didn't write is visible where the owner looks.
  const noteLine = c => c.note ? 'What to check: ' + c.note : '';
  const noteId = c => 'checkback-note-' + c.id;
  function cardInner(c) {
    const w = words(c), title = `${lineOf(c)}${valid(c.dueAt) ? '. Due ' + full(c.dueAt) : ''}${c.note ? '\n' + noteLine(c) : ''}`;
    return `<span class="checkback-mark">${CLOCK}</span><p class="checkback-text" title="${esc(title)}" aria-live="polite"><span class="checkback-lead">${w.lead}</span>${w.detail ? `<span class="checkback-detail">${esc((w.sep ?? ' · ') + w.detail)}</span>` : ''}</p>`
      + (c.note ? `<span class="vh" id="${esc(noteId(c))}">${esc(noteLine(c))}</span>` : '')
      + (w.cancel ? `<button type="button" class="chip checkback-cancel" data-checkback-cancel="${esc(c.id)}" aria-label="Cancel the check-back: ${esc(w.leadText)}">Cancel</button>` : '');
  }
  // Where a card goes: before the first owner message after the one that started its reply (and the day or "New since"
  // divider above that message), or under the last message when the reply is the newest. The reply's own message is the
  // first one the transcript records at or after the second its reply started (the CLI writes the line once the turn has
  // started, and the server keeps times to the second), and no later than the moment it was set; without the reply's
  // start, the last one sent at or before that moment.
  function boundary(c, rows) {
    const set = Date.parse(c.createdAt || c.turnStartedAt || '') + 999, began = Date.parse(c.turnStartedAt || ''), ts = e => Date.parse(e.dataset.ts || '');
    let anchor = -1;
    if (Number.isFinite(set) && Number.isFinite(began)) anchor = rows.findIndex(e => e.classList.contains('m-user') && ts(e) >= began && ts(e) <= set);
    if (anchor < 0 && Number.isFinite(set)) rows.forEach((e, i) => { if (e.classList.contains('m-user') && ts(e) <= set) anchor = i; });
    if (anchor < 0 && Number.isFinite(set)) {
      const first = rows.find(e => Number.isFinite(ts(e)));
      if (first && ts(first) > set) return above(rows[0]); // the reply is above the part of the conversation on screen
    }
    const next = anchor < 0 ? null : rows.slice(anchor + 1).find(e => e.classList.contains('m-user'));
    if (next) return above(next);
    let n = rows.at(-1)?.nextElementSibling || null;
    while (n && n.matches('[data-checkback], .turnmeta')) n = n.nextElementSibling;
    return n;
  }
  const above = el => { let b = el; while (b.previousElementSibling?.matches('.day-divider, .away-divider')) b = b.previousElementSibling; return b; };
  const written = new WeakMap(); // card → the HTML last written into it
  function paintChat(msgs = document.getElementById('msgs')) {
    if (!msgs) return;
    const want = on() && typeof chatId !== 'undefined' && chat.id === chatId ? chat.list : [];
    msgs.querySelectorAll(':scope > [data-checkback]').forEach(el => { if (!want.some(c => c.id === el.dataset.checkback)) el.remove(); });
    if (!want.length) return;
    const rows = [...msgs.children].filter(e => e.matches('.m-user, .m-asst') && !e.classList.contains('live'));
    const groups = new Map();
    for (const c of want) {
      let el = msgs.querySelector(`:scope > [data-checkback="${CSS.escape(c.id)}"]`);
      if (!el) { el = document.createElement('div'); el.className = 'checkback-card'; el.dataset.checkback = c.id; el.tabIndex = -1; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Check-back'); }
      const html = cardInner(c);
      if (written.get(el) !== html) { el.innerHTML = html; written.set(el, html); bindCard(el); if (c.note) el.setAttribute('aria-describedby', noteId(c)); else el.removeAttribute('aria-describedby'); }
      if (el.dataset.state !== c.status) el.dataset.state = c.status;
      const before = boundary(c, rows);
      if (!groups.has(before)) groups.set(before, []);
      groups.get(before).push(el);
    }
    // Oldest first, together, right before their boundary; a card already in place is not touched.
    for (const [before, els] of groups) {
      let next = before;
      for (let i = els.length - 1; i >= 0; i--) { const el = els[i]; if (el.parentNode !== msgs || el.nextElementSibling !== next) msgs.insertBefore(el, next); next = el; }
    }
  }
  function bindCard(el) {
    const b = el.querySelector('[data-checkback-cancel]');
    if (b) b.onclick = () => cancel(b.dataset.checkbackCancel, { button: b, card: el });
  }
  // A changed check-back (a cancel here or in Tasks, a refresh): the open conversation's card follows.
  function update(v) {
    if (!v?.id || v.sessionId !== chat.id) return;
    const i = chat.list.findIndex(c => c.id === v.id);
    if (i < 0) chat.list.push({ ...v }); else chat.list[i] = { ...chat.list[i], ...v };
    paintChat();
  }
  // The list refresh (every 5 s while the app shows): ask for the open conversation's check-backs when its row's clock or
  // the pause changed, and every refresh while one of its cards still waits or runs (a hold for a busy conversation or a
  // limit shows nowhere else). One request at a time; an answer that changes nothing writes nothing.
  function onList() {
    if (!on() || typeof chatId === 'undefined' || !chatId || chat.id !== chatId || document.visibilityState !== 'visible') return;
    const sig = sigOfRow(chatId), active = chat.list.some(c => ACTIVE.has(c.status));
    if (sig === rowSig && !(active && Date.now() - fetchedAt >= 4500)) return;
    rowSig = sig; refresh();
  }
  function refresh() {
    if (!on() || !chat.id) return Promise.resolve();
    if (fetching) return fetching;
    const id = chat.id; fetchedAt = Date.now();
    fetching = api('/checkbacks', { cache: 'no-store' }).then(d => {
      if (chat.id !== id) return;
      for (const v of (d.checkbacks || []).filter(c => c.sessionId === id)) {
        const i = chat.list.findIndex(c => c.id === v.id), { title, ...view } = v;
        if (i < 0) chat.list.push(view); else chat.list[i] = view;
      }
      paintChat();
    }, () => { }).finally(() => { fetching = null; });
    return fetching;
  }

  /* ---------- Cancel: from the card or the Tasks group ---------- */
  async function cancel(id, { button = null, card = null } = {}) {
    if (button) button.disabled = true;
    try {
      const r = await api('/checkbacks/cancel', { method: 'POST', body: JSON.stringify({ id }) });
      update(r.checkback);
      if (card?.isConnected && (!document.activeElement || document.activeElement === document.body)) card.focus({ preventScroll: true }); // the button went with the state
      toast('Check-back cancelled.');
      afterChange();
      return r.checkback;
    } catch (e) {
      toast(e.message || 'Could not cancel the check-back.');
      if (button?.isConnected) button.disabled = false;
      if (e.status === 409 || e.status === 404) { refresh(); afterChange(); }
      return null;
    }
  }
  // Whatever else shows check-backs catches up: the list's clock, the Tasks group, the automation count.
  function afterChange() {
    if (typeof refreshSessions === 'function') refreshSessions();
    if (typeof loadTasks === 'function' && typeof tasksOn === 'function' && tasksOn()) loadTasks(true).then(() => { if (typeof paintTasksView === 'function') paintTasksView(); }).catch(() => { });
  }
  // Settings → Features → Check-backs's Cancel all, after a confirmation (the sheets' own confirm: a title, a line of help, the two
  // options). Running ones finish. Either answer goes back to Settings → Features → Check-backs, which then shows the new count.
  function confirmCancelAll(n) {
    const scrim = document.createElement('div'); scrim.className = 'scrim';
    const sh = document.createElement('div'); sh.className = 'sheet';
    sh.innerHTML = `<h2>${esc(`Cancel ${plural(n, 'check-back', 'check-backs')}?`)}</h2><p class="sheet-help">They won’t run. One that is running now finishes.</p>`
      + `<button type="button" class="opt" data-yes>${IC.tick}<span>Cancel all</span></button><button type="button" class="opt" data-no>${IC.x}<span>Keep it as it is</span></button>`;
    mountSheet(scrim, sh);
    const back = () => { const b = sh._settingsParent; if (b) b(); else closeCurrentSheet?.(); };
    const yes = sh.querySelector('[data-yes]');
    sh.querySelector('[data-no]').onclick = back;
    yes.onclick = async () => {
      yes.disabled = true;
      try {
        const r = await api('/checkbacks/cancel-all', { method: 'POST', body: '{}' });
        toast(r.cancelled ? `Cancelled ${plural(r.cancelled, 'check-back', 'check-backs')}.` : 'Nothing was waiting.');
        refresh(); afterChange();
      } catch (e) { toast(e.message || 'Could not cancel the check-backs.'); }
      if (sh.isConnected) back();
    };
    yes.focus({ preventScroll: true });
  }

  /* ---------- the list row's clock ---------- */
  function rowLabel(cb) {
    const p = cb.pending || 0, r = cb.running === true ? 1 : Number(cb.running) || 0, total = p + r; // the server sends running as true/false
    if (!p) return r > 1 ? `${r} check-backs running now` : 'Checking back now';
    const next = at(cb.nextAt);
    if (total === 1) return `Check-back ${next}`;
    return `${total} check-backs, ${r ? (r === 1 ? 'one running now, ' : `${r} running now, `) : ''}next ${next}`;
  }
  function rowClock(s) {
    const cb = on() && s?.checkback;
    if (!cb || !((cb.pending || 0) > 0 || cb.running === true || cb.running > 0)) return '';
    const label = rowLabel(cb);
    return `<span class="checkback-clock" role="img" aria-label="${esc(label)}" title="${esc(label)}">${CLOCK}</span>`;
  }

  /* ---------- Tasks: a read-only group ---------- */
  function tasksHTML(snap) {
    const list = on() && Array.isArray(snap?.checkbacks) ? snap.checkbacks : [];
    if (!list.length) return '';
    const row = c => {
      const due = typeof fmtDue === 'function' ? fmtDue(c.dueAt) : when(c.dueAt);
      const state = c.status === 'running' ? 'Checking back now' : c.status === 'held' ? HELD[c.held?.reason] || 'Held' : '';
      const title = c.title || (typeof sessionName === 'function' ? sessionName(c.sessionId) : '') || 'Conversation';
      const facts = [`<span>${timeHTML(c.dueAt, due)}</span>`, `<span>${esc(title)}</span>`, state ? `<span>${esc(state[0].toUpperCase() + state.slice(1))}</span>` : ''].filter(Boolean).join('<span aria-hidden="true">·</span>');
      return `<div class="session-item task-item checkback-item" data-checkback-item="${esc(c.id)}">
  <span class="checkback-slot" aria-hidden="true">${CLOCK}</span>
  <a class="row" href="#/chat/${encodeURIComponent(c.sessionId)}" data-checkback-open="${esc(c.sessionId)}" aria-label="${esc(c.note)}. Check-back ${esc(at(c.dueAt))} in ${esc(title)}. Open the conversation"><span class="body"><span class="title">${esc(c.note)}</span><span class="session-status">${facts}</span></span></a>
  ${c.status === 'running' ? '' : `<button type="button" class="chip checkback-cancel" data-checkback-cancel="${esc(c.id)}" aria-label="Cancel the check-back: ${esc(c.note)}">Cancel</button>`}</div>`;
    };
    return `<section class="session-group project-group checkback-group" aria-labelledby="tk-checkbacks-h"><h2 id="tk-checkbacks-h">Check-backs <span>${list.length}</span></h2>${list.map(row).join('')}</section>`;
  }
  function bindTasks(root) {
    root.querySelectorAll('.checkback-item [data-checkback-cancel]').forEach(b => { b.onclick = () => cancel(b.dataset.checkbackCancel, { button: b }); });
  }

  return { on, when, words, lineOf, fromSession, paintChat, onList, refresh, update, cancel, confirmCancelAll, rowClock, rowLabel, tasksHTML, bindTasks, CLOCK };
})();
