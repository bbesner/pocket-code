#!/usr/bin/env node
// pocket-tasks: keep the user's to-dos from a terminal or an agent session (1.36).
// Talks to the running Pocket Code server over loopback with the token it writes to <data dir>/cli-token;
// it never opens tasks.json itself. Create a task only when the user asked for one.
//
//   pocket-tasks add "text" [--due "YYYY-MM-DDTHH:MM"] [--session <id>] [--summary "…"] [--dir <path>]
//   pocket-tasks list [--all] [--json]            open tasks, due first; --all includes finished ones
//   pocket-tasks show <id> [--json]
//   pocket-tasks done <id> | reopen <id>
//   pocket-tasks edit <id> [--text "…"] [--due "…" | --clear-due] [--summary "…"]
//   pocket-tasks remove <id>
// A due time without an offset is in the server's time zone (POCKET_TZ). --summary is the context a task
// carries: two to four plain sentences on what the session was doing and what the task needs.
// Environment: POCKET_DATA_DIR and PORT as for the server (the server's .env is read for both); POCKET_URL overrides.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const envFile = process.env.POCKET_ENV_FILE ?? path.join(root, '.env');
const fileEnv = {};
try { for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line); if (m && !m[1].startsWith('#')) fileEnv[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2'); } } catch { }
const env = k => process.env[k] ?? fileEnv[k];
const dataDir = env('POCKET_DATA_DIR') || root;
const base = env('POCKET_URL') || `http://127.0.0.1:${Number(env('PORT')) || 3610}`;

const argv = process.argv.slice(2);
const opts = { _: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (['--json', '--all', '--clear-due'].includes(a)) opts[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
  else if (a.startsWith('--')) { const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase()); opts[k] = argv[++i] ?? ''; }
  else opts._.push(a);
}
const [cmd, ...rest] = opts._;
const die = (msg, code = 1) => { console.error(msg); process.exit(code); };
if (!cmd || cmd === 'help' || cmd === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 15).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }

let token = '';
try { token = fs.readFileSync(path.join(dataDir, 'cli-token'), 'utf8').trim(); } catch { die(`No CLI token at ${path.join(dataDir, 'cli-token')}. Is Pocket Code running from this checkout? (POCKET_DATA_DIR=${dataDir})`); }
async function call(p, body) {
  let r;
  try { r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); }
  catch (e) { die(`Pocket Code is not reachable at ${base}: ${e.cause?.code || e.message}`); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (data.code === 'tasks_off') die('Tasks is off for this Pocket Code. Turn it on in Settings → Projects, files & tasks.', 3);
    if (r.status === 409 && data.task) die(`${data.error}\n` + line(data.task), 2);
    die(data.error || `${r.status} from ${p}`, r.status === 401 ? 4 : 1);
  }
  return data;
}
const when = v => v ? new Date(v).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';
const line = t => `[${t.done ? 'x' : ' '}] ${t.text}  (${t.id})${t.dueAt ? `  ${t.due ? 'DUE' : 'due'} ${when(t.dueAt)}` : ''}`;
function card(t) {
  const lines = [line(t)];
  if (t.session) lines.push(`  Session: ${t.sessionTitle ? t.sessionTitle + ' · ' : ''}${t.session}`);
  if (t.directory) lines.push(`  Directory: ${t.directory}`);
  if (t.summary) lines.push('  Context: ' + t.summary.split('\n').join('\n           '));
  lines.push(`  Added ${when(t.created)} by ${t.by === 'cli' ? 'an agent' : 'the user'}${t.done ? `, finished ${when(t.doneAt)}` : ''}`);
  return lines.join('\n');
}
const out = (data, text) => console.log(opts.json ? JSON.stringify(data, null, 1) : text);
async function act(body) { const data = await call('/api/tasks/act', body); out(data.task, card(data.task)); }

switch (cmd) {
  case 'list': {
    const snap = await call('/api/tasks');
    const rows = opts.all ? snap.tasks : snap.tasks.filter(t => !t.done);
    if (opts.json) { console.log(JSON.stringify(rows, null, 1)); break; }
    if (!rows.length) { console.log(opts.all ? 'No tasks.' : 'No open tasks.'); break; }
    for (const t of rows) console.log(line(t));
    break;
  }
  case 'show': {
    if (!rest[0]) die('show needs a task id');
    const snap = await call('/api/tasks'), t = snap.tasks.find(x => x.id === rest[0]);
    if (!t) die(`No task with id ${rest[0]}.`, 5);
    out(t, card(t)); break;
  }
  case 'add': {
    if (!rest[0]) die('add needs the task text: pocket-tasks add "Call the supplier"');
    await act({ action: 'add', text: rest[0], dueAt: opts.due || undefined, session: opts.session || undefined, summary: opts.summary || '', directory: opts.dir || '' });
    break;
  }
  case 'done': case 'reopen': { if (!rest[0]) die(`${cmd} needs a task id`); await act({ action: 'update', task: rest[0], done: cmd === 'done' }); break; }
  case 'edit': {
    if (!rest[0]) die('edit needs a task id');
    const body = { action: 'update', task: rest[0] };
    if (opts.text !== undefined) body.text = opts.text;
    if (opts.clearDue) body.dueAt = null; else if (opts.due !== undefined) body.dueAt = opts.due;
    if (opts.summary !== undefined) body.summary = opts.summary;
    await act(body); break;
  }
  case 'remove': { if (!rest[0]) die('remove needs a task id'); const r = await call('/api/tasks/act', { action: 'remove', task: rest[0] }); out(r.task, `Removed: ${r.task.text}`); break; }
  default: die(`Unknown command ${cmd}. Run pocket-tasks help.`);
}
