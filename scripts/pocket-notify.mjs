#!/usr/bin/env node
// pocket-notify: send the owner an alert from an agent or a job on the server (1.58.1).
// Talks to the running Pocket Code server over loopback with the token it writes to <data dir>/cli-token.
// A push goes to every device that wants alerts; --email also mails the address saved in Settings → Notifications.
//
//   pocket-notify --title "…" (--body "…" | --file <path|->) [--url </#/start/<id> or another Pocket path>] [--tag <key>] [--email] [--json]
//                                                  prints "push=<devices|off> mail=<yes|no|off|failed>" (or the JSON reply)
// Environment: POCKET_DATA_DIR and PORT as for the server (the server's .env is read for both); POCKET_URL overrides.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const envFile = process.env.POCKET_ENV_FILE ?? path.join(root, '.env');
const fileEnv = {};
try { for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line); if (m && !m[1].startsWith('#')) fileEnv[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2'); } } catch { }
const env = k => process.env[k] ?? fileEnv[k];
const dataDir = env('POCKET_DATA_DIR') || root;
const base = (() => { if (env('POCKET_URL')) return env('POCKET_URL'); try { const u = fs.readFileSync(path.join(dataDir, 'cli-url'), 'utf8').trim(); if (/^http:\/\/127\.0\.0\.1:\d+$/.test(u)) return u; } catch { } return `http://127.0.0.1:${Number(fileEnv.PORT) || Number(process.env.PORT) || 3610}`; })();
const argv = process.argv.slice(2);
const opts = { _: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--json' || a === '--email') opts[a.slice(2)] = true;
  else if (a.startsWith('--')) { const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase()); opts[k] = argv[++i] ?? ''; }
  else opts._.push(a);
}
const die = (msg, code = 1) => { console.error(msg); process.exit(code); };
if (!argv.length || opts._[0] === 'help' || argv.includes('--help')) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 8).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
let token;
try { token = fs.readFileSync(path.join(dataDir, 'cli-token'), 'utf8').trim(); } catch { die('Pocket Code is not running here (no cli-token in ' + dataDir + ').', 2); }
const title = String(opts.title || '').trim();
if (!title) die('--title is needed.');
let body = opts.body;
if (opts.file !== undefined) body = opts.file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(opts.file, 'utf8');
body = String(body || '').trim();
const payload = { title, body, url: opts.url || '', tag: opts.tag || '', email: Boolean(opts.email) };
let r;
try {
  r = await fetch(base + '/api/notify', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000) }); // 1.73.8
} catch (e) { die('Pocket Code did not answer at ' + base + ': ' + e.message, 2); }
const data = await r.json().catch(() => ({}));
if (!r.ok) die(data.error || ('HTTP ' + r.status), r.status === 401 ? 2 : 1);
if (opts.json) console.log(JSON.stringify(data));
else console.log(`push=${data.push ?? 'off'} mail=${data.mail === true ? 'yes' : data.mail === false ? 'no' : data.mail}`);
