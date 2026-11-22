#!/usr/bin/env node
// pocket-run: start a job's run on this server's Pocket Code with a job key (Settings → Automation → Job keys).
//
//   pocket-run --key-file ~/.config/pocket/jobs/disk-check.key [--data-file <path> | --data -] [--id <idempotency key>]
//              [--instructions-file <path>] [--conversation <id>] [--wait <seconds>] [--json]
//   pocket-run --key-file <file> --run <run id> [--wait <seconds>] [--json]     look at a run again
//
// The key comes from --key-file or POCKET_JOB_KEY; there is no --key flag, because other programs can read a command line.
// --data - reads the data from stdin. --wait waits up to that many seconds for the run to finish (Pocket caps it).
// Exit codes: 0 done (the reply on stdout) · 3 needs you (an approval or question waits) · 4 still working (poll with --run)
// · 5 refused (paused, a limit, a wrong or disabled key, busy; the reason on stderr) · 1 error.
// With --json the whole answer is printed on stdout whatever the exit code. The key is never printed.
// Address: <data dir>/cli-url (POCKET_DATA_DIR, else this checkout), POCKET_URL overrides. Works from cron: no terminal,
// a bare environment; call it with the full path of node if node is not on cron's PATH.
import fs from 'node:fs';
import path from 'node:path';
import { readEnvFile } from '../env-file.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fileEnv = readEnvFile(process.env.POCKET_ENV_FILE ?? path.join(root, '.env'));
const env = k => process.env[k] ?? fileEnv[k];
const dataDir = env('POCKET_DATA_DIR') || root;
// The daemon's own address first: the key must only ever go to this server's Pocket, on loopback.
const base = (() => {
  if (env('POCKET_URL')) return env('POCKET_URL').replace(/\/$/, '');
  try { const u = fs.readFileSync(path.join(dataDir, 'cli-url'), 'utf8').trim(); if (/^http:\/\/127\.0\.0\.1:\d+$/.test(u)) return u; } catch { }
  return `http://127.0.0.1:${Number(fileEnv.PORT) || Number(process.env.PORT) || 3610}`;
})();

const EXIT = { done: 0, needs_you: 3, working: 4, refused: 5, error: 1 };
const die = (msg, code = EXIT.error) => { process.stderr.write(msg.replace(/\s*$/, '\n')); process.exit(code); };
const FLAGS = new Set(['--json', '--help', '-h']);
const VALUES = new Set(['--key-file', '--data-file', '--data', '--id', '--instructions-file', '--conversation', '--wait', '--run']);
const opts = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--key' || a.startsWith('--key=')) die('There is no --key flag: other programs can read a command line. Use --key-file <file> or POCKET_JOB_KEY.');
  if (FLAGS.has(a)) { opts[a.replace(/^-+/, '')] = true; continue; }
  const [flag, inline] = a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
  if (!VALUES.has(flag)) die(`Unknown argument ${a}. Run pocket-run --help.`);
  const v = inline ?? argv[++i];
  if (v === undefined) die(`${flag} needs a value.`);
  opts[flag.slice(2)] = v;
}
if (opts.help || opts.h) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 15).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }

const readFile = (f, what) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { die(`Can't read the ${what} file ${f}: ${e.code || e.message}`); } };
let key = '';
if (opts['key-file']) key = readFile(opts['key-file'], 'key').trim();
else if (process.env.POCKET_JOB_KEY) key = process.env.POCKET_JOB_KEY.trim();
else die('Give the job key: --key-file <file> (written when the key was created) or POCKET_JOB_KEY.');
if (!/^pjk_[A-Za-z0-9_-]{43}$/.test(key)) die('That is not a job key (they start with pjk_). Check the key file.');

let wait = 0;
if (opts.wait !== undefined) { wait = Number(opts.wait); if (!Number.isFinite(wait) || wait < 0) die('--wait is a number of seconds.'); }

async function readStdin() { const chunks = []; for await (const c of process.stdin) chunks.push(c); return Buffer.concat(chunks).toString('utf8'); }

async function call(method, p, body) {
  let r;
  try {
    r = await fetch(base + p, { method, headers: { authorization: 'Bearer ' + key, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout((wait + 60) * 1000) });
  } catch (e) { die(`Pocket Code is not reachable at ${base}: ${e.name === 'TimeoutError' ? 'no answer in time' : e.cause?.code || e.message}`); }
  let data = null; try { data = await r.json(); } catch { }
  return { http: r.status, data: data && typeof data === 'object' ? data : {} };
}

const { http, data } = opts.run
  ? (/^jr-[0-9a-f]{12}$/.test(opts.run) ? await call('GET', `/api/jobs/runs/${opts.run}${wait ? `?wait=${encodeURIComponent(wait)}` : ''}`) : die('--run takes a run id like jr-0123456789ab.'))
  : await (async () => {
    if (opts.data !== undefined && opts.data !== '-') die('--data takes only "-" (read stdin); use --data-file <path> for a file, so the data stays off the command line.');
    if (opts.data !== undefined && opts['data-file'] !== undefined) die('Use --data - or --data-file, not both.');
    const body = {
      data: opts.data === '-' ? await readStdin() : opts['data-file'] !== undefined ? readFile(opts['data-file'], 'data') : '',
      ...(opts['instructions-file'] !== undefined ? { instructions: readFile(opts['instructions-file'], 'instructions') } : {}),
      ...(opts.id ? { idempotencyKey: opts.id } : {}), ...(opts.conversation ? { conversation: opts.conversation } : {}), ...(wait ? { wait } : {}),
    };
    return call('POST', '/api/jobs/run', body);
  })();

const status = data.status || (http === 401 || data.code === 'jobs_off' ? 'refused' : 'error');
if (opts.json) process.stdout.write(JSON.stringify({ ...data, ...(data.status ? {} : { status }), http }, null, 1) + '\n');
switch (status) {
  case 'done':
    if (!opts.json) process.stdout.write(String(data.reply ?? '').replace(/\s*$/, '\n'));
    process.exit(EXIT.done);
  case 'needs_you':
    if (!opts.json) process.stderr.write(`Needs you: run ${data.run} is waiting for an approval or an answer.${data.link ? ` ${data.link}` : ''}\n`);
    process.exit(EXIT.needs_you);
  case 'working':
    if (!opts.json) process.stderr.write(`Still working: run ${data.run}. Look again with pocket-run --key-file <file> --run ${data.run} --wait 300\n`);
    process.exit(EXIT.working);
  case 'refused':
    if (!opts.json) process.stderr.write(`Refused (${data.reason || data.code || http}): ${data.error || 'no reason given'}\n`);
    process.exit(EXIT.refused);
  default:
    if (!opts.json) process.stderr.write(`${status === 'failed' ? `Run ${data.run} failed${data.outcome ? ` (${data.outcome})` : ''}` : `Error ${http}`}: ${data.error || 'see the conversation in Pocket Code'}${data.link ? ` ${data.link}` : ''}\n`);
    process.exit(EXIT.error);
}
