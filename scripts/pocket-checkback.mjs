#!/usr/bin/env node
// pocket-checkback: this conversation takes one more turn later, when the owner asked for it (1.119).
// Talks to the running Pocket Code server over loopback with the token it writes to <data dir>/cli-token; it never opens
// checkbacks.json itself. Which conversation it is comes from the runner token Pocket put in the environment.
//
//   pocket-checkback add --at "+15m" --note "what to check and what done looks like"
//                        --at also takes "+2h", "+1d" or "2026-11-22 09:00" (the owner's time zone)
//   pocket-checkback list [--all] [--json]   this conversation's check-backs (--all: finished ones too)
//   pocket-checkback cancel <id>             cancel one of this conversation's that hasn't run yet
// Only a reply the owner started (or a check-back's reply, up to the chain limit) can set one; anything else is refused
// with the reason. Exit codes: 0 done, 1 refused or failed, 2 a limit or no reply running, 5 check-backs are off.
// Environment: POCKET_DATA_DIR and PORT as for the server (the server's .env is read for both); POCKET_URL overrides.
import fs from 'node:fs';
import path from 'node:path';
import { readEnvFile } from '../env-file.mjs';

const root = path.resolve(import.meta.dirname, '..');
const envFile = process.env.POCKET_ENV_FILE ?? path.join(root, '.env');
const fileEnv = readEnvFile(envFile);
const env = k => process.env[k] ?? fileEnv[k];
const dataDir = env('POCKET_DATA_DIR') || root;
// The daemon's own address first, then this checkout's .env, and only then an inherited PORT: an app the agent is working on
// may export PORT, and the CLI token must never go to it.
const base = (() => { if (env('POCKET_URL')) return env('POCKET_URL'); try { const u = fs.readFileSync(path.join(dataDir, 'cli-url'), 'utf8').trim(); if (/^http:\/\/127\.0\.0\.1:\d+$/.test(u)) return u; } catch { } return `http://127.0.0.1:${Number(fileEnv.PORT) || Number(process.env.PORT) || 3610}`; })();

const argv = process.argv.slice(2);
const opts = { _: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (['--json', '--all'].includes(a)) opts[a.slice(2)] = true;
  else if (a.startsWith('--')) opts[a.slice(2)] = argv[++i] ?? '';
  else opts._.push(a);
}
const [cmd, arg] = opts._;
const die = (msg, code = 1) => { console.error(msg); process.exit(code); };
if (!cmd || cmd === 'help' || cmd === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 13).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
if (!process.env.POCKET_RUNNER_TOKEN) die('pocket-checkback works only inside a Pocket conversation, and this command is not running in one (no runner token: a terminal or code-server). Offer the user a task instead.');

let token = '';
try { token = fs.readFileSync(path.join(dataDir, 'cli-token'), 'utf8').trim(); } catch { die(`No CLI token at ${path.join(dataDir, 'cli-token')}. Is Pocket Code running from this checkout?`); }
const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-pocket-runner': process.env.POCKET_RUNNER_TOKEN };
async function call(p, body) {
  let r;
  try { r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) }); }
  catch (e) { die(`Pocket Code is not reachable at ${base}: ${e.name === 'TimeoutError' ? 'no answer in 30 seconds' : e.cause?.code || e.message}`); }
  const data = await r.json().catch(() => ({}));
  if (r.ok) return data;
  if (data.code === 'checkbacks_off') die('Check-backs are switched off on this Pocket. Offer the user a task instead.', 5);
  die(data.error || `${r.status} from ${p}`, r.status === 401 ? 4 : r.status === 409 ? 2 : 1);
}
const out = (data, text) => console.log(opts.json ? JSON.stringify(data, null, 1) : text);
const STATUS = { pending: 'waiting', held: 'held', running: 'running now', done: 'done', missed: 'missed', cancelled: 'cancelled' };
const line = c => `${c.id}  ${c.dueText || c.dueAt}  ${STATUS[c.status] || c.status}${c.held ? ` (${c.held.reason.replace('_', ' ')})` : ''}  ${c.note.length > 80 ? c.note.slice(0, 79) + '…' : c.note}`;

switch (cmd) {
  case 'add': {
    if (!opts.at) die('Say when: --at "+15m", "+2h", "+1d" or "2026-11-22 09:00" (your time zone).');
    if (!opts.note) die('Say what to check and what done looks like: --note "…".');
    const d = await call('/api/checkbacks/agent/add', { at: opts.at, note: opts.note });
    out(d, `Check-back ${d.checkback.id} set for ${d.dueText}.${d.paused ? ' Pocket is paused, so it waits for Resume.' : ''} Tell the user when it will check back, then end your reply.`);
    break;
  }
  case 'list': {
    const d = await call('/api/checkbacks/agent' + (opts.all ? '?all=1' : ''));
    if (opts.json) { console.log(JSON.stringify(d, null, 1)); break; }
    if (!d.checkbacks.length) console.log(opts.all ? 'This conversation has no check-backs.' : 'This conversation has no check-backs waiting.');
    for (const c of d.checkbacks) console.log(line(c));
    break;
  }
  case 'cancel': {
    if (!arg) die('Name the check-back to cancel: pocket-checkback cancel <id> (pocket-checkback list shows them).');
    const d = await call('/api/checkbacks/agent/cancel', { id: arg });
    out(d, `Cancelled ${d.checkback.id}.`);
    break;
  }
  default: die(`Unknown command: ${cmd}. Run pocket-checkback help.`);
}
