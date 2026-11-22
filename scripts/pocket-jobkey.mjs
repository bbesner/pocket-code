#!/usr/bin/env node
// pocket-jobkey: propose a job key from inside a Pocket conversation; the owner allows or denies it in Settings.
//
//   pocket-jobkey propose --name <name> --instruction-file <path|-> [--workspace <dir>] [--engine claude|codex|openrouter]
//                         [--model <id>] [--effort <e>] [--access ask|full] [--per-hour n|off] [--per-day n|off]
//                         [--at-once n] [--may-add-instructions] [--no-push] [--wait <seconds>] [--json]
//   pocket-jobkey wait <request> [--wait <seconds>] [--json]     wait for the owner's answer (default 300 seconds)
//   pocket-jobkey status <request> [--json]                      the answer so far, at once
// Only a reply the owner started can propose one. Nothing exists until the owner reads the whole instruction and taps
// Allow in Settings → Automation → Job keys. On Allow it prints the key file's path, never the key.
// Exit codes: 0 allowed · 6 waiting for the owner (run `wait <request>` later) · 7 denied or expired · 5 job keys are off
// · 1 refused or failed. --workspace defaults to this conversation's folder, --engine to its agent.
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
const base = (() => { if (env('POCKET_URL')) return env('POCKET_URL').replace(/\/$/, ''); try { const u = fs.readFileSync(path.join(dataDir, 'cli-url'), 'utf8').trim(); if (/^http:\/\/127\.0\.0\.1:\d+$/.test(u)) return u; } catch { } return `http://127.0.0.1:${Number(fileEnv.PORT) || Number(process.env.PORT) || 3610}`; })();
const RUN_CLI = path.join(root, 'scripts', 'pocket-run.mjs');
const shellArg = p => /^[A-Za-z0-9_./:@%+,=-]+$/.test(String(p)) ? String(p) : `'${String(p).replace(/'/g, `'\\''`)}'`;

const EXIT = { allowed: 0, pending: 6, denied: 7, expired: 7, off: 5, error: 1 };
const FLAGS = new Set(['json', 'may-add-instructions', 'no-push', 'help']);
const argv = process.argv.slice(2);
const opts = { _: [] };
const die = (msg, code = EXIT.error) => { process.stderr.write(String(msg).replace(/\s*$/, '\n')); process.exit(code); };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { opts._.push(a); continue; }
  const [flag, inline] = a.includes('=') ? [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a.slice(2), undefined];
  if (FLAGS.has(flag)) { opts[flag] = true; continue; }
  const v = inline ?? argv[++i];
  if (v === undefined) die(`--${flag} needs a value.`);
  opts[flag] = v;
}
const [cmd, arg] = opts._;
if (!cmd || cmd === 'help' || opts.help) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 13).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
const KNOWN = { propose: ['name', 'instruction-file', 'workspace', 'engine', 'model', 'effort', 'access', 'per-hour', 'per-day', 'at-once', 'may-add-instructions', 'no-push', 'wait', 'json'], wait: ['wait', 'json'], status: ['json'] };
if (!KNOWN[cmd]) die(`Unknown command: ${cmd}. Run pocket-jobkey help.`);
const stray = Object.keys(opts).filter(k => k !== '_' && !KNOWN[cmd].includes(k));
if (stray.length) die(`${cmd} does not take --${stray.join(', --')}. Run pocket-jobkey help.`);
if (!process.env.POCKET_RUNNER_TOKEN) die('pocket-jobkey works only inside a Pocket conversation, and this command is not running in one (no runner token: a terminal or code-server). The owner can make the key in Settings → Automation → Job keys.');

let token = '';
try { token = fs.readFileSync(path.join(dataDir, 'cli-token'), 'utf8').trim(); } catch { die(`No CLI token at ${path.join(dataDir, 'cli-token')}. Is Pocket Code running from this checkout?`); }
const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-pocket-runner': process.env.POCKET_RUNNER_TOKEN };
async function call(p, body, waitS = 0) {
  let r; const secs = waitS + 30;
  try { r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(secs * 1000) }); }
  catch (e) { die(`Pocket Code is not reachable at ${base}: ${e.name === 'TimeoutError' ? `no answer in ${secs} seconds` : e.cause?.code || e.message}`); }
  const data = await r.json().catch(() => ({}));
  if (r.ok) return data;
  if (data.code === 'jobs_off') die('Job keys are switched off on this Pocket. The owner turns them on in Settings → Automation → Job keys.', EXIT.off);
  die(data.error || `${r.status} from ${p}`);
}
const seconds = (v, dflt) => { if (v === undefined) return dflt; const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 300) die('--wait takes a number of seconds from 0 to 300.'); return n; };
const limit = (v, flag) => { if (v === undefined) return undefined; if (v === 'off') return 'off'; const n = Number(v); if (!Number.isInteger(n)) die(`${flag} takes a whole number${flag === '--at-once' ? '' : ', or off'}.`); return n; };

// The answer, in words; the exit code says which.
function finish(d) {
  if (opts.json) console.log(JSON.stringify(d, null, 1));
  if (d.status === 'pending') {
    if (!opts.json) process.stderr.write(`pending ${d.request}\nThe owner was asked to allow the job key in Pocket Code. Nothing exists until they do. Tell the user it waits for their Allow in Settings → Automation → Job keys, where they can read the whole instruction, then end your reply. Continue later with: pocket-jobkey wait ${d.request}\n`);
    process.exit(EXIT.pending);
  }
  if (d.status === 'allowed') {
    if (!opts.json) {
      const lines = [`Allowed. Key file: ${d.file}`, `Run it: node ${shellArg(RUN_CLI)} --key-file ${shellArg(d.file)} --data-file <file>`];
      if (d.edited) lines.push(`The owner changed ${d.changed.join(', ')} before allowing it. Tell the user, and check your script still fits.`);
      lines.push('The key file is readable only by this user. Never print it, copy it into a script or put it in a message.');
      console.log(lines.join('\n'));
    }
    process.exit(EXIT.allowed);
  }
  if (!opts.json) process.stderr.write(`${d.status === 'denied' ? 'Denied' : 'Expired'}: ${d.reason || ''}\n`);
  process.exit(EXIT[d.status] ?? EXIT.error);
}

switch (cmd) {
  case 'propose': {
    if (!opts.name) die('Name the job: --name disk-check (lowercase letters, digits, - or _).');
    if (!opts['instruction-file']) die('Write the standing instruction to a file and pass it: --instruction-file <path> (or - for stdin).');
    let instruction;
    try { instruction = opts['instruction-file'] === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(opts['instruction-file'], 'utf8'); }
    catch (e) { die(`Can't read the instruction file ${opts['instruction-file']}: ${e.code || e.message}`); }
    const wait = seconds(opts.wait, 0);
    const body = { name: opts.name, instruction, workspace: opts.workspace ? path.resolve(opts.workspace) : process.cwd(), wait };
    for (const f of ['engine', 'model', 'effort', 'access']) if (opts[f] !== undefined) body[f] = opts[f];
    const limits = { perHour: limit(opts['per-hour'], '--per-hour'), perDay: limit(opts['per-day'], '--per-day'), atOnce: limit(opts['at-once'], '--at-once') };
    if (Object.values(limits).some(v => v !== undefined)) body.limits = Object.fromEntries(Object.entries(limits).filter(([, v]) => v !== undefined));
    if (opts['may-add-instructions']) body.mayAddInstructions = true;
    if (opts['no-push']) body.pushWhenDone = false;
    finish(await call('/api/jobs/agent/propose', body, wait));
    break;
  }
  case 'wait': case 'status': {
    if (!arg) die(`${cmd} needs the request id printed with pending.`);
    const wait = cmd === 'wait' ? seconds(opts.wait, 300) : 0;
    finish(await call(`/api/jobs/agent/requests/${encodeURIComponent(arg)}${wait ? '?wait=' + wait : ''}`, null, wait));
    break;
  }
}
