#!/usr/bin/env node
// pocket-board: keep a tracked project current from a terminal or an agent session (1.29).
// Talks to the running Pocket Code server over loopback with the token it writes to <data dir>/cli-token;
// it never opens projects.json itself. Track a project only when the user asked for it (--requested).
//
//   pocket-board track --requested --name "Name" [--summary …] [--next …] [--dir …] [--link …] [--session <id>]
//   pocket-board status [--all] [--json]          the current directory's project, or every project with --all
//   pocket-board update [--name|--summary|--next|--waiting-for|--link|--dir|--status active|waiting|done]
//   pocket-board task add "text" | done <id> | reopen <id> | edit <id> --text "…"
//   pocket-board remind --at "YYYY-MM-DDTHH:MM" [--task <id>] [--text "…"]     (no offset = the server's time zone)
//   pocket-board dismiss <reminder-id>
//   pocket-board note "text"
//   pocket-board link-session <id> | unlink-session <id>
//   pocket-board scheduled [--json]               every open reminder, due first
//   pocket-board context [--hook]                 the current directory's unfinished project, for an agent's session start;
//                                                 silent (exit 0) when there is none, the feature is off, or Pocket is down
//   pocket-board import <snapshot.json>            one-time import of a Mission Control board snapshot
// Options: -p/--project <id> names the project (default: the one whose directory contains the current directory).
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
  if (['--json', '--all', '--requested', '--hook'].includes(a)) opts[a.slice(2)] = true;
  else if (a === '-p' || a === '--project') opts.project = argv[++i];
  else if (a.startsWith('--')) { const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase()); opts[k] = argv[++i] ?? ''; }
  else opts._.push(a);
}
const [cmd, ...rest] = opts._;
const die = (msg, code = 1) => { console.error(msg); process.exit(code); };
if (!cmd || cmd === 'help' || cmd === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 19).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }

const quiet = cmd === 'context'; // a session-start hook must never fail the session
let token = '';
try { token = fs.readFileSync(path.join(dataDir, 'cli-token'), 'utf8').trim(); } catch { if (quiet) process.exit(0); die(`No CLI token at ${path.join(dataDir, 'cli-token')}. Is Pocket Code running from this checkout? (POCKET_DATA_DIR=${dataDir})`); }
async function call(p, body) {
  let r;
  try { r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); }
  catch (e) { if (quiet) process.exit(0); die(`Pocket Code is not reachable at ${base}: ${e.cause?.code || e.message}`); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (quiet) process.exit(0);
    if (data.code === 'projects_off') die('Projects is off for this Pocket Code. Turn it on in Settings → Projects & files.', 3);
    if (r.status === 409 && data.project) die(`${data.error}\n` + card(data.project), 2);
    die(data.error || `${r.status} from ${p}`, r.status === 401 ? 4 : 1);
  }
  return data;
}
const when = v => v ? new Date(v).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';
function card(p) {
  const lines = [`${p.name}  [${p.status}]  id ${p.id}  rev ${p.revision}`];
  if (p.summary) lines.push(`  Where we left off: ${p.summary}`);
  if (p.next) lines.push(`  Next: ${p.next}`);
  if (p.waitingFor) lines.push(`  Waiting for: ${p.waitingFor}`);
  if (p.directory) lines.push(`  Directory: ${p.directory}`);
  if (p.link) lines.push(`  Link: ${p.link}`);
  if (p.sessions?.length) lines.push(`  Sessions: ${p.sessions.join(', ')}`);
  for (const t of p.tasks || []) lines.push(`  [${t.done ? 'x' : ' '}] ${t.text}  (${t.id})`);
  for (const r of p.reminders || []) lines.push(`  ${r.due ? 'DUE' : 'Reminder'} ${when(r.dueAt)}: ${r.label}  (${r.id})`);
  lines.push(`  Updated ${when(p.updated)}, verified ${when(p.verified)}`);
  return lines.join('\n');
}
const out = (data, text) => console.log(opts.json ? JSON.stringify(data, null, 1) : text);
const cwd = process.cwd();
async function pick() {
  if (opts.project) return opts.project;
  const snap = await call('/api/board?dir=' + encodeURIComponent(cwd));
  if (!snap.match) die(`No tracked project contains ${cwd}. Name one with -p <id>, or track it with: pocket-board track --requested --name "…"`, 5);
  return snap.match;
}
async function act(body) {
  const data = await call('/api/board/act', body);
  out(data.project, card(data.project));
}

switch (cmd) {
  case 'status': {
    const snap = await call('/api/board?dir=' + encodeURIComponent(cwd));
    if (opts.all || (!opts.project && !snap.match)) {
      if (opts.json) { console.log(JSON.stringify(snap, null, 1)); break; }
      if (!snap.projects.length) { console.log('No tracked projects.'); break; }
      for (const p of snap.projects) console.log(`${p.status.padEnd(7)} ${p.id.padEnd(40)} ${p.name}${p.dueCount ? `  (${p.dueCount} due)` : ''}${p.openTasks ? `  ${p.openTasks} open step${p.openTasks === 1 ? '' : 's'}` : ''}`);
      if (!opts.all && !snap.match) console.log(`\n(No tracked project contains ${cwd}.)`);
      break;
    }
    const id = opts.project || snap.match, p = snap.projects.find(x => x.id === id);
    if (!p) die(`No project with id ${id}.`, 5);
    out(p, card(p)); break;
  }
  case 'context': {
    const snap = await call('/api/board?dir=' + encodeURIComponent(cwd)), p = snap.match && snap.projects.find(x => x.id === snap.match);
    if (!p || p.status === 'done') break;
    const open = p.tasks.filter(t => !t.done).map(t => '- ' + t.text), due = p.reminders.filter(r => r.due).map(r => r.label);
    const text = [`Tracked project for this directory: ${p.name} (id ${p.id}, ${p.status}).`, p.summary ? `Where we left off: ${p.summary}` : '', p.next ? `Next: ${p.next}` : '', p.waitingFor ? `Waiting for: ${p.waitingFor}` : '',
      open.length ? `Remaining steps:\n${open.join('\n')}` : '', due.length ? `Due reminders: ${due.join('; ')}` : '', `Keep the card current with pocket-board (update, task, remind, note) when this work reaches a stopping point.`].filter(Boolean).join('\n');
    console.log(opts.hook ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }) : text);
    break;
  }
  case 'scheduled': {
    const snap = await call('/api/board');
    if (opts.json) { console.log(JSON.stringify(snap.scheduled, null, 1)); break; }
    if (!snap.scheduled.length) { console.log('No open reminders.'); break; }
    for (const r of snap.scheduled) console.log(`${r.due ? 'DUE     ' : when(r.dueAt).padEnd(8)} ${r.projectName}: ${r.label}  (${r.project} / ${r.id})`);
    break;
  }
  case 'track': {
    if (!opts.name) die('track needs --name "…"');
    if (!opts.requested) die('Track a project only when the user asked for it; pass --requested to say so.', 6);
    await act({ action: 'track', name: opts.name, summary: opts.summary || '', next: opts.next || '', directory: opts.dir || cwd, link: opts.link || '', session: opts.session || undefined, requested: true });
    break;
  }
  case 'update': {
    const body = { action: 'update', project: await pick() };
    for (const [k, v] of [['name', opts.name], ['summary', opts.summary], ['next', opts.next], ['waitingFor', opts.waitingFor], ['link', opts.link], ['directory', opts.dir], ['status', opts.status]]) if (v !== undefined) body[k] = v;
    await act(body); break;
  }
  case 'task': {
    const [verb, value] = rest, project = await pick();
    if (verb === 'add') await act({ action: 'task-add', project, text: value });
    else if (verb === 'done' || verb === 'reopen') await act({ action: 'task-update', project, task: value, done: verb === 'done' });
    else if (verb === 'edit') await act({ action: 'task-update', project, task: value, text: opts.text });
    else die('task add "text" | done <id> | reopen <id> | edit <id> --text "…"');
    break;
  }
  case 'remind': { if (!opts.at) die('remind needs --at "YYYY-MM-DDTHH:MM"'); await act({ action: 'remind', project: await pick(), at: opts.at, task: opts.task || undefined, text: opts.text || '' }); break; }
  case 'dismiss': { if (!rest[0]) die('dismiss needs a reminder id'); await act({ action: 'reminder-dismiss', project: await pick(), reminder: rest[0] }); break; }
  case 'note': { if (!rest[0]) die('note needs some text'); await act({ action: 'note', project: await pick(), text: rest[0] }); break; }
  case 'link-session': case 'unlink-session': { if (!rest[0]) die(`${cmd} needs a session id`); await act({ action: cmd, project: await pick(), session: rest[0] }); break; }
  case 'import': {
    if (!rest[0]) die('import needs the path of a board snapshot (board snapshot --no-body > snapshot.json)');
    let snap; try { snap = JSON.parse(fs.readFileSync(rest[0], 'utf8')); } catch (e) { die(`Could not read ${rest[0]}: ${e.message}`); }
    const r = await call('/api/board/import', snap);
    out(r, `Imported ${r.added.length} project(s)${r.added.length ? ': ' + r.added.join(', ') : ''}.` + (r.skipped.length ? `\nSkipped ${r.skipped.length}: ` + r.skipped.map(s => `${s.id} (${s.reason})`).join(', ') : ''));
    break;
  }
  default: die(`Unknown command ${cmd}. Run pocket-board help.`);
}
