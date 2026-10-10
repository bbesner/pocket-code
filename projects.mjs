// Projects (1.29): the tracked-project board. One JSON file in the data directory, written atomically, with a
// per-project revision so a stale edit is refused with the current card. A project is tracked only when the user
// asks (Track, or an agent passing --requested); nothing enrolls a project by inference. States active, waiting
// and done; the remaining steps are a checklist on the card; reminders belong to the project or to one task.
// Projects link to the sessions that worked on them. The server, the CLI and the import all write through here.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const LIMITS = { name: 120, text: 600, task: 300, projects: 200, tasks: 200, reminders: 50, sessions: 50, history: 200, link: 1024, directory: 1024 };
export const STATUSES = ['active', 'waiting', 'done'];
export const ACTIONS = ['track', 'update', 'task-add', 'task-update', 'remind', 'reminder-dismiss', 'note', 'link-session', 'unlink-session'];
const SESSION_RE = /^(cx:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const shortId = () => randomBytes(6).toString('hex');
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function checkLink(link) {
  if (!link) return '';
  let u; try { u = new URL(link); } catch { throw fail('The link must be a full http or https address.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw fail('The link must be a full http or https address.');
  return link;
}
function checkDirectory(dir) {
  if (!dir) return '';
  if (!path.isAbsolute(dir)) throw fail('The directory must be a full path.');
  return path.normalize(dir).replace(/\/+$/, '') || '/';
}
function checkSession(id) {
  const s = str(id, 64);
  if (!SESSION_RE.test(s)) throw fail('That is not a session id.');
  return s;
}
export function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project';
}

// A time for a reminder: an ISO string with an offset is taken as written; one without an offset means the
// install's time zone (POCKET_TZ, else the system zone), never UTC by accident. Returns UTC ISO or throws.
export function parseWhen(input, tz = process.env.POCKET_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const s = str(input, 40);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) throw fail('Use a time like 2026-10-14T09:00 (your time zone) or an ISO time with an offset.');
  const [, Y, Mo, D, h, mi, sec = '00', off] = m;
  if (off) { const d = new Date(`${Y}-${Mo}-${D}T${h}:${mi}:${sec}${off.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')}`); if (Number.isNaN(d.getTime())) throw fail('That time is not valid.'); return iso(d.getTime()); }
  // Wall time in tz → UTC: guess UTC, measure how tz renders it, correct by the difference (twice for DST edges).
  const want = Date.UTC(+Y, +Mo - 1, +D, +h, +mi, +sec), w = new Date(want);
  if (Number.isNaN(want) || w.getUTCMonth() + 1 !== +Mo || w.getUTCDate() !== +D || +h > 23 || +mi > 59 || +sec > 59) throw fail('That time is not valid.');
  const parts = ms => { const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)); const g = t => +f.find(p => p.type === t).value; return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')); };
  let utc = want;
  for (let i = 0; i < 2; i++) utc += want - parts(utc);
  return iso(utc);
}

// One line for an agent's instructions when Projects is on: how to track the session as a project when, and only
// when, the user asks. The CLI path is the install's; the session id is this session's (null when not yet known).
export function projectInstructions(cli, sessionId) {
  const sid = sessionId ? ` --session ${sessionId}` : '';
  return `This Pocket Code tracks projects. Only when the user asks to track this work, make it a project, or add it to one, use the pocket-board command (\`node ${cli}\`); the pocket-projects skill (\`${path.join(path.dirname(cli), '..', 'skills', 'pocket-projects', 'SKILL.md')}\`) has the full procedure, which questions to ask and when to set reminders. Check \`node ${cli} status --all\` first and link this session to a matching project (\`link-session ${sessionId || '<this session id>'} -p <project-id>\`) rather than duplicating it; otherwise run \`node ${cli} track --requested --name "<name>"${sid} --summary … --next …\` from the working directory. Ask at most one question, and set a reminder (\`remind --at\`) only when the user asks or agrees to a time. When a tracked project's work reaches a stopping point, keep its card current with \`update --summary … --next …\`, \`task add|done\` and \`note\`. Never track a project the user did not ask for.`;
}

export class ProjectStore {
  constructor(file, { write, now } = {}) {
    this.file = file;
    this.now = now || Date.now;
    this.write = write || ((f, data) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 }); fs.renameSync(tmp, f); });
    let d = {};
    try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { }
    this.projects = Array.isArray(d.projects) ? d.projects.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string').map(p => this.normalize(p)) : [];
  }
  normalize(p) {
    const arr = (v, max) => Array.isArray(v) ? v.slice(-max) : [];
    return { ...p, summary: p.summary || '', next: p.next || '', waitingFor: p.waitingFor || '', directory: p.directory || '', link: p.link || '',
      status: STATUSES.includes(p.status) ? p.status : 'active', revision: Number.isInteger(p.revision) && p.revision > 0 ? p.revision : 1,
      enrollment: p.enrollment === 'suggested' ? 'suggested' : 'requested',
      sessions: arr(p.sessions, LIMITS.sessions).filter(s => SESSION_RE.test(s)),
      tasks: arr(p.tasks, LIMITS.tasks).filter(t => t && t.id && typeof t.text === 'string'),
      reminders: arr(p.reminders, LIMITS.reminders).filter(r => r && r.id && r.dueAt),
      history: arr(p.history, LIMITS.history) };
  }
  save() { this.write(this.file, { version: 1, projects: this.projects }); }
  get(id) { const p = this.projects.find(x => x.id === id); if (!p) throw fail('That project does not exist.', 404); return p; }

  // The card as the UI and CLI see it: open reminders carry `due`, the project carries `dueCount`.
  view(p, now = this.now()) {
    const reminders = p.reminders.filter(r => r.state === 'open').map(r => ({ ...r, due: Date.parse(r.dueAt) <= now }));
    return { ...p, reminders, dueCount: reminders.filter(r => r.due).length, openTasks: p.tasks.filter(t => !t.done).length };
  }
  snapshot({ now = this.now(), dir } = {}) {
    const projects = this.projects.map(p => this.view(p, now));
    const order = { active: 0, waiting: 1, done: 2 };
    projects.sort((a, b) => order[a.status] - order[b.status] || b.dueCount - a.dueCount || Date.parse(b.updated) - Date.parse(a.updated));
    const scheduled = projects.flatMap(p => p.reminders.map(r => ({ ...r, project: p.id, projectName: p.name, projectStatus: p.status, taskText: r.task ? p.tasks.find(t => t.id === r.task)?.text || '' : '' })))
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
    const out = { version: 1, now, projects, scheduled, dueCount: scheduled.filter(r => r.due).length };
    if (dir) out.match = this.matchDirectory(dir)?.id || null;
    return out;
  }
  // The project whose directory is, or contains, the given path; the deepest match wins. Done projects do not match.
  matchDirectory(dir) {
    let best = null; const d = checkDirectory(dir);
    for (const p of this.projects) {
      if (p.status === 'done' || !p.directory) continue;
      if (d === p.directory || d.startsWith(p.directory.replace(/\/$/, '') + '/')) if (!best || p.directory.length > best.directory.length) best = p;
    }
    return best;
  }
  uniqueId(name) {
    const base = slugify(name); let id = base, n = 2;
    while (this.projects.some(p => p.id === id)) id = `${base}-${n++}`;
    return id;
  }
  history(p, actor, action, detail, at) {
    p.history.push({ at, actor, action, detail: typeof detail === 'string' ? detail.slice(0, LIMITS.text) : JSON.stringify(detail).slice(0, LIMITS.text) });
    if (p.history.length > LIMITS.history) p.history.splice(0, p.history.length - LIMITS.history);
  }
  touch(p, at, { verified = true } = {}) { p.updated = at; if (verified) p.verified = at; p.revision += 1; }

  // Every change goes through here. `actor` is 'ui', 'cli' or 'import'; `expected_revision` refuses stale edits with 409.
  act(input, { actor = 'ui' } = {}) {
    const action = str(input?.action, 40);
    if (!ACTIONS.includes(action)) throw fail('Unknown action.');
    const at = iso(this.now());
    if (action === 'track') return this.track(input, actor, at);
    const p = this.get(str(input.project, 80));
    if (input.expected_revision != null && Number(input.expected_revision) !== p.revision) throw fail('This project changed since you loaded it. Review the current card and try again.', 409, { project: this.view(p) });
    if (p.status === 'done' && !['update', 'note', 'link-session', 'unlink-session'].includes(action)) throw fail('This project is finished. Resume it first.', 409, { project: this.view(p) });
    switch (action) {
      case 'update': {
        const changes = {};
        if ('name' in input) { const name = str(input.name, LIMITS.name).replace(/\s+/g, ' '); if (!name) throw fail('Give the project a name.'); changes.name = name; }
        for (const k of ['summary', 'next', 'waitingFor']) if (k in input) changes[k] = str(input[k], LIMITS.text);
        if ('link' in input) changes.link = checkLink(str(input.link, LIMITS.link));
        if ('directory' in input) changes.directory = checkDirectory(str(input.directory, LIMITS.directory));
        if ('status' in input) { if (!STATUSES.includes(input.status)) throw fail('Status must be active, waiting or done.'); changes.status = input.status; }
        if (!Object.keys(changes).length) throw fail('Nothing to change.');
        Object.assign(p, changes);
        if (changes.status === 'done') for (const r of p.reminders) if (r.state === 'open') { r.state = 'cancelled'; r.updated = at; }
        if (changes.status === 'active') changes.waitingFor === undefined && (p.waitingFor = p.waitingFor); // resuming never restores cancelled reminders
        this.history(p, actor, changes.status ? `status-${changes.status}` : 'updated', changes, at);
        this.touch(p, at); break;
      }
      case 'task-add': {
        const text = str(input.text, LIMITS.task); if (!text) throw fail('The step needs some text.');
        if (p.tasks.length >= LIMITS.tasks) throw fail(`A project keeps up to ${LIMITS.tasks} steps.`, 409);
        p.tasks.push({ id: shortId(), text, done: false, created: at, updated: at });
        this.history(p, actor, 'task-added', text, at); this.touch(p, at); break;
      }
      case 'task-update': {
        const t = p.tasks.find(x => x.id === str(input.task, 40)); if (!t) throw fail('That step does not exist.', 404);
        if ('text' in input) { const text = str(input.text, LIMITS.task); if (!text) throw fail('The step needs some text.'); t.text = text; }
        if ('done' in input) {
          t.done = Boolean(input.done);
          if (t.done) for (const r of p.reminders) if (r.state === 'open' && r.task === t.id) { r.state = 'done'; r.updated = at; } // finishing a step stops its reminder
        }
        t.updated = at;
        this.history(p, actor, 'done' in input ? (t.done ? 'task-done' : 'task-reopened') : 'task-updated', t.text, at); this.touch(p, at); break;
      }
      case 'remind': {
        const task = input.task ? str(input.task, 40) : null;
        if (task && !p.tasks.some(x => x.id === task)) throw fail('That step does not exist.', 404);
        if (task && p.tasks.find(x => x.id === task).done) throw fail('That step is already done.', 409);
        const dueAt = parseWhen(input.at);
        const label = str(input.text, LIMITS.text) || (task ? p.tasks.find(x => x.id === task).text : `Revisit ${p.name}`);
        // One open reminder per project or per step: a new one replaces it (that is how "Remind later" works).
        for (const r of p.reminders) if (r.state === 'open' && (r.task || null) === task) { r.state = 'replaced'; r.updated = at; }
        p.reminders.push({ id: shortId(), task, label, dueAt, state: 'open', notifiedAt: null, created: at, updated: at });
        if (p.reminders.length > LIMITS.reminders) p.reminders = p.reminders.filter(r => r.state === 'open').concat(p.reminders.filter(r => r.state !== 'open').slice(-10));
        this.history(p, actor, 'reminder-set', { at: dueAt, label }, at); this.touch(p, at, { verified: false }); break;
      }
      case 'reminder-dismiss': {
        const r = p.reminders.find(x => x.id === str(input.reminder, 40) && x.state === 'open'); if (!r) throw fail('That reminder is not open.', 404);
        r.state = 'cancelled'; r.updated = at;
        this.history(p, actor, 'reminder-dismissed', r.label, at); this.touch(p, at, { verified: false }); break;
      }
      case 'note': {
        const text = str(input.text, LIMITS.text); if (!text) throw fail('The note is empty.');
        this.history(p, actor, 'note', text, at); this.touch(p, at, { verified: false }); break;
      }
      case 'link-session': {
        const id = checkSession(input.session);
        if (!p.sessions.includes(id)) { if (p.sessions.length >= LIMITS.sessions) throw fail(`A project links up to ${LIMITS.sessions} sessions.`, 409); p.sessions.push(id); this.history(p, actor, 'session-linked', id, at); this.touch(p, at, { verified: false }); }
        break;
      }
      case 'unlink-session': {
        const id = checkSession(input.session), i = p.sessions.indexOf(id);
        if (i >= 0) { p.sessions.splice(i, 1); this.history(p, actor, 'session-unlinked', id, at); this.touch(p, at, { verified: false }); }
        break;
      }
    }
    this.save();
    return this.view(p);
  }
  track(input, actor, at) {
    const name = str(input.name, LIMITS.name).replace(/\s+/g, ' '); if (!name) throw fail('Give the project a name.');
    if (this.projects.length >= LIMITS.projects) throw fail(`You can track up to ${LIMITS.projects} projects. Finish or remove one first.`, 409);
    const p = { id: this.uniqueId(name), name, summary: str(input.summary, LIMITS.text), next: str(input.next, LIMITS.text), waitingFor: '', status: 'active',
      directory: checkDirectory(str(input.directory, LIMITS.directory)), link: checkLink(str(input.link, LIMITS.link)), sessions: [],
      created: at, updated: at, verified: at, revision: 1, enrollment: input.requested === false ? 'suggested' : 'requested', tasks: [], reminders: [], history: [] };
    if (input.session) p.sessions.push(checkSession(input.session));
    this.history(p, actor, 'tracked', { name, enrollment: p.enrollment }, at);
    this.projects.push(p); this.save();
    return this.view(p);
  }

  // Reminders that are due and not yet announced. The caller announces them (push, hook) and marks each one.
  due(now = this.now()) {
    return this.projects.flatMap(p => p.reminders.filter(r => r.state === 'open' && !r.notifiedAt && Date.parse(r.dueAt) <= now).map(r => ({ project: p.id, projectName: p.name, reminder: r.id, label: r.label, dueAt: r.dueAt, task: r.task, taskText: r.task ? p.tasks.find(t => t.id === r.task)?.text || '' : '' })));
  }
  markNotified(projectId, reminderId, now = this.now()) {
    const r = this.get(projectId).reminders.find(x => x.id === reminderId); if (!r) return;
    r.notifiedAt = iso(now); this.save();
  }

  // One-time import of a Mission Control board snapshot (`board snapshot` JSON, version 2). Existing ids are skipped.
  importSnapshot(snap, { actor = 'import' } = {}) {
    const rows = Array.isArray(snap?.projects) ? snap.projects : null;
    if (!rows) throw fail('That is not a board snapshot.');
    const at = iso(this.now()), added = [], skipped = [];
    const when = v => { const t = Date.parse(v); return Number.isNaN(t) ? at : iso(t); };
    for (const r of rows) {
      const id = str(r.id, 80) || this.uniqueId(str(r.name, LIMITS.name) || 'project');
      if (!str(r.name, LIMITS.name)) { skipped.push({ id, reason: 'no name' }); continue; }
      if (this.projects.some(p => p.id === id)) { skipped.push({ id, reason: 'already here' }); continue; }
      let link = '', directory = '';
      try { link = checkLink(str(r.link, LIMITS.link)); } catch { }
      try { directory = checkDirectory(str(r.directory, LIMITS.directory)); } catch { }
      const p = { id, name: str(r.name, LIMITS.name), summary: str(r.summary, LIMITS.text), next: str(r.next_step ?? r.next, LIMITS.text), waitingFor: str(r.waiting_for ?? r.waitingFor, LIMITS.text),
        status: STATUSES.includes(r.status) ? r.status : 'active', directory, link, sessions: [],
        created: when(r.created), updated: when(r.updated), verified: when(r.verified), revision: Number.isInteger(r.revision) && r.revision > 0 ? r.revision : 1,
        enrollment: /suggest/.test(String(r.enrollment)) ? 'suggested' : 'requested',
        tasks: (Array.isArray(r.tasks) ? r.tasks : []).slice(0, LIMITS.tasks).map(t => ({ id: str(t.id, 40) || shortId(), text: str(t.text, LIMITS.task), done: Boolean(t.done), created: when(t.created), updated: when(t.updated) })).filter(t => t.text),
        reminders: (Array.isArray(r.reminders) ? r.reminders : []).slice(0, LIMITS.reminders).map(x => ({ id: str(x.id, 40) || shortId(), task: x.task ? str(x.task, 40) : null, label: str(x.label, LIMITS.text) || `Revisit ${r.name}`, dueAt: when(x.due_at ?? x.dueAt), state: x.state === 'open' || x.state == null ? 'open' : 'cancelled', notifiedAt: x.notified_at ?? x.notifiedAt ?? null, created: when(x.created ?? x.updated), updated: when(x.updated) })),
        history: (Array.isArray(r.history) ? r.history : []).slice(-LIMITS.history + 1).map(h => ({ at: when(h.at), actor: str(h.actor, 40) || 'import', action: str(h.action, 40) || 'note', detail: typeof h.detail === 'string' ? h.detail.slice(0, LIMITS.text) : JSON.stringify(h.detail ?? '').slice(0, LIMITS.text) })) };
      p.reminders = p.reminders.filter(x => !x.task || p.tasks.some(t => t.id === x.task));
      this.history(p, actor, 'imported', { from: 'mission-control', revision: p.revision }, at);
      this.projects.push(p); added.push(id);
    }
    if (added.length) this.save();
    return { added, skipped };
  }
}
