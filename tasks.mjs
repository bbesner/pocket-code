// Tasks (1.36): to-dos kept beside sessions, projects and files. One JSON file in the data directory, written
// atomically. A task is a line of text with an optional due time, the session it came from and, when the user
// wants the context, a short summary of that session. Open tasks sort due first, then by when they were added;
// a dated task is announced once when it comes due, like a project reminder. The server, the UI and the CLI all
// write through here; nothing creates a task the user did not ask for.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseWhen } from './projects.mjs';

export const LIMITS = { text: 600, summary: 2000, tasks: 500, title: 160 };
export const ACTIONS = ['add', 'update', 'remove'];
const SESSION_RE = /^(cx:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const shortId = () => randomBytes(6).toString('hex');
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const checkSession = id => { const s = str(id, 64); if (!SESSION_RE.test(s)) throw fail('That is not a session id.'); return s; };
const checkDirectory = dir => { if (!dir) return ''; if (!path.isAbsolute(dir)) throw fail('The directory must be a full path.'); return path.normalize(dir).replace(/\/+$/, '') || '/'; };

// One line for an agent's instructions when Tasks is on: a task is created only when the user asks, by voice
// or text; the summary is the agent's own words about the session, written only when the user wants the context.
export function taskInstructions(cli, sessionId) {
  const sid = sessionId ? ` --session ${sessionId}` : '';
  return `This Pocket Code keeps tasks (to-dos). Only when the user asks to create a task, add a to-do, or note something to do later, run \`node ${cli} add "<text>"${sid} [--due "YYYY-MM-DDTHH:MM"] [--summary "…"]\`; the pocket-tasks skill (\`${path.join(path.dirname(cli), '..', 'skills', 'pocket-tasks', 'SKILL.md')}\`) has the procedure. Give a task a due time only when the user names one (a time without an offset is this server's time zone). When the user wants the task to carry the context of this session, write --summary yourself: two to four plain sentences on what is being worked on, where it stands and what the task needs. \`list\` shows the open tasks and \`done <id>\` finishes one. Never create a task the user did not ask for.`;
}

export class TaskStore {
  constructor(file, { write, now } = {}) {
    this.file = file;
    this.now = now || Date.now;
    this.write = write || ((f, data) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 }); fs.renameSync(tmp, f); });
    let d = {};
    try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { }
    this.tasks = Array.isArray(d.tasks) ? d.tasks.filter(t => t && typeof t.id === 'string' && typeof t.text === 'string').map(t => this.normalize(t)) : [];
  }
  normalize(t) {
    return { ...t, dueAt: t.dueAt && !Number.isNaN(Date.parse(t.dueAt)) ? t.dueAt : null, done: Boolean(t.done), doneAt: t.done ? t.doneAt || t.updated : null,
      session: SESSION_RE.test(t.session || '') ? t.session : null, sessionTitle: str(t.sessionTitle, LIMITS.title), directory: t.directory || '', summary: str(t.summary, LIMITS.summary),
      notifiedAt: t.notifiedAt || null, revision: Number.isInteger(t.revision) && t.revision > 0 ? t.revision : 1 };
  }
  save() { this.write(this.file, { version: 1, tasks: this.tasks }); }
  get(id) { const t = this.tasks.find(x => x.id === id); if (!t) throw fail('That task does not exist.', 404); return t; }

  // The task as the UI and CLI see it: `due` says whether a dated, open task has come due.
  view(t, now = this.now()) { return { ...t, due: !t.done && Boolean(t.dueAt) && Date.parse(t.dueAt) <= now }; }
  // Open tasks: dated ones first, soonest first; then the undated, newest first. Done tasks: most recently finished first.
  snapshot({ now = this.now() } = {}) {
    const open = this.tasks.filter(t => !t.done).map(t => this.view(t, now))
      .sort((a, b) => (a.dueAt && b.dueAt) ? Date.parse(a.dueAt) - Date.parse(b.dueAt) : a.dueAt ? -1 : b.dueAt ? 1 : Date.parse(b.created) - Date.parse(a.created));
    const done = this.tasks.filter(t => t.done).map(t => this.view(t, now)).sort((a, b) => Date.parse(b.doneAt) - Date.parse(a.doneAt));
    return { version: 1, now, tasks: [...open, ...done], openCount: open.length, dueCount: open.filter(t => t.due).length };
  }
  touch(t) { t.updated = iso(this.now()); t.revision += 1; }

  // Every change goes through here. `actor` is 'ui' or 'cli'; `expected_revision` refuses a stale edit with the current task.
  act(input, { actor = 'ui' } = {}) {
    const action = str(input?.action, 40);
    if (!ACTIONS.includes(action)) throw fail('Unknown action.');
    const at = iso(this.now());
    if (action === 'add') {
      const text = str(input.text, LIMITS.text).replace(/\s+/g, ' '); if (!text) throw fail('The task needs some text.');
      if (this.tasks.length >= LIMITS.tasks) throw fail(`You can keep up to ${LIMITS.tasks} tasks. Remove some finished ones first.`, 409);
      const t = { id: shortId(), text, dueAt: input.dueAt ? parseWhen(input.dueAt) : null, done: false, doneAt: null,
        session: input.session ? checkSession(input.session) : null, sessionTitle: str(input.sessionTitle, LIMITS.title), directory: checkDirectory(str(input.directory, 1024)),
        summary: str(input.summary, LIMITS.summary), by: actor, created: at, updated: at, notifiedAt: null, revision: 1 };
      this.tasks.push(t); this.save();
      return this.view(t);
    }
    const t = this.get(str(input.task, 40));
    if (input.expected_revision != null && Number(input.expected_revision) !== t.revision) throw fail('This task changed since you loaded it. Review it and try again.', 409, { task: this.view(t) });
    if (action === 'remove') { this.tasks = this.tasks.filter(x => x !== t); this.save(); return { ...this.view(t), removed: true }; }
    let changed = false;
    if ('text' in input) { const text = str(input.text, LIMITS.text).replace(/\s+/g, ' '); if (!text) throw fail('The task needs some text.'); t.text = text; changed = true; }
    if ('dueAt' in input) { const dueAt = input.dueAt ? parseWhen(input.dueAt) : null; if (dueAt !== t.dueAt) { t.dueAt = dueAt; t.notifiedAt = null; } changed = true; } // a new time is announced again
    if ('summary' in input) { t.summary = str(input.summary, LIMITS.summary); changed = true; }
    if ('session' in input) { t.session = input.session ? checkSession(input.session) : null; t.sessionTitle = str(input.sessionTitle, LIMITS.title); changed = true; }
    if ('directory' in input) { t.directory = checkDirectory(str(input.directory, 1024)); changed = true; }
    if ('done' in input) { const done = Boolean(input.done); if (done !== t.done) { t.done = done; t.doneAt = done ? at : null; } changed = true; }
    if (!changed) throw fail('Nothing to change.');
    this.touch(t); this.save();
    return this.view(t);
  }

  // Dated tasks that have come due and were not announced. The caller announces them (push, hook) and marks each one.
  due(now = this.now()) {
    return this.tasks.filter(t => !t.done && t.dueAt && !t.notifiedAt && Date.parse(t.dueAt) <= now).map(t => ({ task: t.id, text: t.text, dueAt: t.dueAt, session: t.session }));
  }
  markNotified(id, now = this.now()) { const t = this.get(id); t.notifiedAt = iso(now); this.save(); }
}
