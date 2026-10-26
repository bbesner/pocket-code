#!/usr/bin/env node
// pocket-vault: use the owner's stored credentials by name, without ever seeing them (1.39).
// Talks to the running Pocket Code server over loopback with the token it writes to <data dir>/cli-token.
// Values never pass through this process: `run` asks the daemon to run the command with the values in
// its environment, and prints the output with every value replaced by {{vault:name}}.
//
//   pocket-vault list [--kind k] [--tag t] [--json]     names, kinds, urls, tags, policy; never values
//   pocket-vault show <name> [--json]                   one item's fields and approved commands; never values
//   pocket-vault run --env VAR=<name>[.field] [--env …] [--cwd <dir>] [--timeout <s>] [--wait <s>] -- <command…>
//   pocket-vault wait <request-id> [--wait <s>]         continue a run the owner was asked to allow
//   pocket-vault put <name> --kind <api_key|token|login|credentials|note> (--stdin | --from-file <path> [--map field=key,…] | --from-env VAR) [--url u] [--tags a,b]
//     One-field kinds take the value as plain text; a JSON object on stdin or in the file gives several fields at once,
//     fixed ones (username, password) and custom ones (client_id, signature_key …) alike.
//   pocket-vault history [--name <name>] [--json]       this session's uses of the vault
// Exit codes: 3 the Vault is off · 4 a request is pending (run `wait <id>`) · 5 denied or refused · the child's code after a run.
// Environment: POCKET_DATA_DIR and PORT as for the server (the server's .env is read for both); POCKET_URL overrides.
import fs from 'node:fs';
import path from 'node:path';
import { ownerZone, whenIn } from './owner-zone.mjs';
import { StringDecoder } from 'node:string_decoder';
import { readEnvFile } from '../env-file.mjs';

const root = path.resolve(import.meta.dirname, '..');
const envFile = process.env.POCKET_ENV_FILE ?? path.join(root, '.env');
const fileEnv = readEnvFile(envFile);
const env = k => process.env[k] ?? fileEnv[k];
const dataDir = env('POCKET_DATA_DIR') || root;
// The daemon writes its address to <data dir>/cli-url at start (1.43.1). Read that first, then this checkout's .env, and only
// then an inherited PORT: an app the agent is working on may export PORT, and the CLI token must never go to it.
const base = (() => { if (env('POCKET_URL')) return env('POCKET_URL'); try { const u = fs.readFileSync(path.join(dataDir, 'cli-url'), 'utf8').trim(); if (/^http:\/\/127\.0\.0\.1:\d+$/.test(u)) return u; } catch { } return `http://127.0.0.1:${Number(fileEnv.PORT) || Number(process.env.PORT) || 3610}`; })();

// Everything after -- is the command; everything before it is ours.
const raw = process.argv.slice(2);
const dash = raw.indexOf('--');
const argv = dash === -1 ? raw : raw.slice(0, dash), command = dash === -1 ? [] : raw.slice(dash + 1);
const opts = { _: [], env: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (['--json', '--stdin'].includes(a)) opts[a.slice(2)] = true;
  else if (a === '--env') opts.env.push(argv[++i] ?? '');
  else if (a.startsWith('--')) { const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase()); opts[k] = argv[++i] ?? ''; }
  else opts._.push(a);
}
const [cmd, ...rest] = opts._;
const die = (msg, code = 1) => { console.error(msg); process.exit(code); };
if (!cmd || cmd === 'help' || cmd === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 14).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }

let token = '';
try { token = fs.readFileSync(path.join(dataDir, 'cli-token'), 'utf8').trim(); } catch { die(`No CLI token at ${path.join(dataDir, 'cli-token')}. Is Pocket Code running from this checkout? (POCKET_DATA_DIR=${dataDir})`); }
// The runner token Pocket put in this agent process's environment ties the call to its session.
const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...(process.env.POCKET_RUNNER_TOKEN ? { 'x-pocket-runner': process.env.POCKET_RUNNER_TOKEN } : {}) };
const offMessage = 'The Vault is off for this Pocket Code. The owner can turn it on in Settings → Projects, files, tasks & vault.';
async function call(p, body, method) {
  let r;
  try { r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined }); }
  catch (e) { die(`Pocket Code is not reachable at ${base}: ${e.cause?.code || e.message}`); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (data.code === 'vault_off') die(offMessage, 3);
    if (data.code === 'vault_locked') die('The Vault is locked. Ask the owner to unlock it in Pocket Code (the Vault view); the owner has been notified.', 3);
    if (data.code === 'vault_unavailable') die('The Vault cannot be opened on this server. Tell the owner.', 3);
    if (data.code === 'owner_only') die(data.error, 5);
    die(data.error || `${r.status} from ${p}`, r.status === 401 ? 4 : 1);
  }
  return data;
}
const when = whenIn(ownerZone(dataDir, env('POCKET_TZ')));
const line = i => `${i.name}  (${i.kind}${i.fields.length > 1 || i.kind === 'credentials' ? ': ' + i.fields.join(', ') : ''})  ${i.policyWord}${i.url ? '  ' + i.url : ''}${i.tags.length ? '  #' + i.tags.join(' #') : ''}${i.expiresAt ? `  expires ${when(i.expiresAt)}` : ''}`;
function card(i) {
  const lines = [line(i), `  Use: --env VAR=${i.name}${i.fields.length > 1 ? '.' + i.fields[0] : ''}${i.fields.length > 1 ? ` (fields: ${i.fields.join(', ')})` : ''}`];
  if (i.lastUsedAt) lines.push(`  Last used ${when(i.lastUsedAt)}${i.lastUsedBy?.sessionTitle ? ' in ' + i.lastUsedBy.sessionTitle : ''}`);
  if (i.recipes?.length) { lines.push('  Approved commands:'); for (const r of i.recipes) lines.push(`    ${r.argv.join(' ')}  (in ${r.cwd})`); }
  return lines.join('\n');
}
const out = (data, text) => console.log(opts.json ? JSON.stringify(data, null, 1) : text);

// A run or a wait answers as a stream of JSON lines: out/err text as it happens, then exit, pending, denied or error.
async function stream(p, body) {
  let r;
  try { r = await fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body) }); }
  catch (e) { die(`Pocket Code is not reachable at ${base}: ${e.cause?.code || e.message}`); }
  if (!r.ok) { const data = await r.json().catch(() => ({})); if (data.code === 'vault_off') die(offMessage, 3); if (data.code === 'vault_locked') die('The Vault is locked. Ask the owner to unlock it in Pocket Code (the Vault view); the owner has been notified.', 3); if (data.code === 'vault_unavailable') die('The Vault cannot be opened on this server. Tell the owner.', 3); die(data.error || `${r.status} from ${p}`, data.code === 'owner_only' ? 5 : r.status === 401 ? 4 : 1); }
  let rem = '';
  const handle = ev => {
    if (ev.t === 'out') process.stdout.write(ev.s);
    else if (ev.t === 'err') process.stderr.write(ev.s);
    else if (ev.t === 'request') console.error(`Asking the owner to allow this command (request ${ev.id}, ${ev.items.join(', ')})…`);
    else if (ev.t === 'pending') { console.error(`pending ${ev.id}\nThe owner has not answered yet. Say so, and continue with: pocket-vault wait ${ev.id}`); process.exit(4); }
    else if (ev.t === 'denied') { console.error(ev.message || 'The owner did not allow this command.'); process.exit(5); }
    else if (ev.t === 'exit') { if (ev.truncated) console.error('[output truncated at 1 MB]'); if (ev.timedOut) console.error('[the command was stopped at the timeout]'); process.exit(ev.code ?? (ev.signal ? 128 : 1)); }
    else if (ev.t === 'error') die(ev.message, ev.code === 'owner_only' ? 5 : ev.code === 'vault_locked' ? 3 : 1);
  };
  const dec = new StringDecoder('utf8'); // 1.73.8: a character split across two chunks is joined, not shown as U+FFFD
  for await (const chunk of r.body) {
    rem += dec.write(Buffer.from(chunk));
    const lines = rem.split('\n'); rem = lines.pop();
    for (const l of lines) if (l.trim()) handle(JSON.parse(l));
  }
  rem += dec.end();
  if (rem.trim()) handle(JSON.parse(rem));
  die('The connection ended before the command finished.');
}

switch (cmd) {
  case 'list': {
    const snap = await call('/api/vault');
    if (snap.locked) die('The Vault is locked. Ask the owner to unlock it in Pocket Code (the Vault view).', 3);
    let rows = snap.items;
    if (opts.kind) rows = rows.filter(i => i.kind === opts.kind);
    if (opts.tag) rows = rows.filter(i => i.tags.includes(String(opts.tag).toLowerCase()));
    if (opts.json) { console.log(JSON.stringify(rows, null, 1)); break; }
    if (!rows.length) { console.log('No items.'); break; }
    for (const i of rows) console.log(line(i));
    break;
  }
  case 'show': {
    if (!rest[0]) die('show needs an item name');
    const snap = await call('/api/vault'); if (snap.locked) die('The Vault is locked. Ask the owner to unlock it in Pocket Code (the Vault view).', 3);
    const i = snap.items.find(x => x.name === rest[0]);
    if (!i) die(`No item named ${rest[0]}.`, 5);
    out(i, card(i)); break;
  }
  case 'run': {
    if (!command.length) die('run needs the command after --: pocket-vault run --env TOKEN=zoho-books -- node sync.mjs');
    if (!opts.env.length) die('run needs at least one --env VAR=<name>[.field]');
    const bind = {};
    for (const e of opts.env) { const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(e); if (!m) die(`--env needs VAR=<name>[.field], got ${e}`); bind[m[1]] = m[2]; }
    await stream('/api/vault/run', { argv: command, cwd: opts.cwd || process.cwd(), env: bind, timeout: opts.timeout ? Number(opts.timeout) : undefined, wait: opts.wait ? Number(opts.wait) : undefined });
    break;
  }
  case 'wait': {
    if (!rest[0]) die('wait needs the request id printed by run');
    await stream('/api/vault/wait', { request: rest[0], wait: opts.wait ? Number(opts.wait) : undefined });
    break;
  }
  case 'put': {
    const name = rest[0]; if (!name) die('put needs a name: pocket-vault put zoho-books --kind api_key --stdin');
    const kind = opts.kind; if (!kind) die('put needs --kind api_key, token, login, credentials or note');
    const fields = { api_key: ['value'], token: ['value'], login: ['username', 'password'], credentials: [], note: ['text'] }[kind]; if (!fields) die('--kind must be api_key, token, login, credentials or note');
    const values = {};
    const map = {}; for (const pair of String(opts.map || '').split(',').filter(Boolean)) { const [f, k] = pair.split('='); if (f && k) map[f.trim()] = k.trim(); }
    // A JSON object names every field: the kind's fixed ones (through --map when the keys differ) plus any custom ones.
    const fromObject = j => { for (const f of fields) values[f] = String(j[map[f] || f] ?? ''); for (const [k, v] of Object.entries(j)) if (!fields.includes(k) && !Object.values(map).includes(k) && v != null && typeof v !== 'object') values[k] = String(v); };
    const need = `For a ${kind}, give a JSON object${fields.length ? ' with ' + fields.join(' and ') : ' naming each field, for example {"client_id":"…","client_secret":"…"}'}.`;
    if (opts.stdin) {
      const text = fs.readFileSync(0, 'utf8');
      let j = null; if (/^\s*\{/.test(text)) { try { j = JSON.parse(text); } catch { die(need); } }
      if (j && typeof j === 'object') fromObject(j);
      else if (fields.length === 1) values[fields[0]] = text.replace(/\r?\n$/, '');
      else die(need);
    } else if (opts.fromFile) {
      let text; try { text = fs.readFileSync(opts.fromFile, 'utf8'); } catch (e) { die(`Cannot read ${opts.fromFile}: ${e.message}`); }
      let j = null; try { j = JSON.parse(text); } catch { }
      if (j && typeof j === 'object') fromObject(j);
      else if (fields.length === 1) values[fields[0]] = text.replace(/\r?\n$/, '');
      else die(need + ' (or --map field=key)');
    } else if (opts.fromEnv) {
      if (fields.length !== 1) die(`--from-env works for one-field kinds; for a ${kind} use --stdin or --from-file.`);
      const v = process.env[opts.fromEnv]; if (v == null) die(`${opts.fromEnv} is not set in this environment.`);
      values[fields[0]] = v;
    } else die('put needs the value from --stdin, --from-file <path> or --from-env VAR (never on the command line)');
    const r = await call('/api/vault/act', { action: 'add', name, kind, values, url: opts.url || '', tags: opts.tags ? String(opts.tags).split(',') : [] });
    console.log(r.item.name);
    break;
  }
  case 'history': {
    const r = await call('/api/vault/audit' + (opts.name ? '?name=' + encodeURIComponent(opts.name) : ''));
    if (opts.json) { console.log(JSON.stringify(r.rows, null, 1)); break; }
    if (!r.rows.length) { console.log('No vault use in this session yet.'); break; }
    for (const x of r.rows) console.log(`${when(x.at)}  ${x.action}  ${x.name || ''}${x.argv ? '  ' + x.argv.join(' ') : ''}${x.decision ? '  (' + x.decision + ')' : ''}`);
    break;
  }
  default: die(`Unknown command ${cmd}. Run pocket-vault help.`);
}
