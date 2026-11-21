#!/usr/bin/env node
// pocket-docs: keep files in Pocket Code's Files library from a terminal or an agent session (1.30; called Documents before 1.34).
// Talks to the running Pocket Code server over loopback with the token it writes to <data dir>/cli-token;
// it never touches the library's folder itself. Files are private unless the user asks to share.
//
//   pocket-docs add <path> [--title "…"] [--project <id>] [--session <id>] [--visibility private|link|public]
//   pocket-docs list [--project <id>] [--q text] [--json]
//   pocket-docs show <id> [--json]                      a shared link's address is not shown: Pocket keeps only its hash
//   pocket-docs share <id> [--expires <n>d|none]        make it link-visible and print the URL (once); on a file already
//                                                        shared by link it makes a fresh link, and the old one stops working
//   pocket-docs set <id> [--title "…"] [--project <id>] [--visibility private|link|public] [--expires <n>d|none]
//   pocket-docs wait <request-id> [--wait <s>]          continue a share or publish the owner was asked to allow
//   pocket-docs trash <id> | restore <id>
//   pocket-docs import <dashboard-files-meta.json>       one-time import of an older dashboard's documents metadata
// Sharing or publishing (a link, a new or longer link, a public address) asks the owner first: the command waits --wait
// seconds (default 90, at most 300) for Allow, then prints `pending <id>` and exits 6. Exit codes: 3 Files is off ·
// 4 not signed in · 5 no such file · 6 pending (run `wait <id>`) · 7 denied, expired, or the file changed first.
// Environment: POCKET_DATA_DIR and PORT as for the server (the server's .env is read for both); POCKET_URL overrides;
// POCKET_PUBLIC_URL (e.g. https://claude.example.com) makes printed share URLs absolute.
import fs from 'node:fs';
import path from 'node:path';
import { ownerZone, whenIn } from './owner-zone.mjs';
import { readEnvFile } from '../env-file.mjs';

const root = path.resolve(import.meta.dirname, '..');
const envFile = process.env.POCKET_ENV_FILE ?? path.join(root, '.env');
const fileEnv = readEnvFile(envFile);
const env = k => process.env[k] ?? fileEnv[k];
const dataDir = env('POCKET_DATA_DIR') || root;
// The daemon writes its address to <data dir>/cli-url at start (1.43.1). Read that first, then this checkout's .env, and only
// then an inherited PORT: an app the agent is working on may export PORT, and the CLI token must never go to it.
const base = (() => { if (env('POCKET_URL')) return env('POCKET_URL'); try { const u = fs.readFileSync(path.join(dataDir, 'cli-url'), 'utf8').trim(); if (/^http:\/\/127\.0\.0\.1:\d+$/.test(u)) return u; } catch { } return `http://127.0.0.1:${Number(fileEnv.PORT) || Number(process.env.PORT) || 3610}`; })();
const publicBase = (env('POCKET_PUBLIC_URL') || '').replace(/\/$/, '');

const argv = process.argv.slice(2), opts = { _: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--json') opts.json = true;
  else if (a.startsWith('--')) { const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase()); opts[k] = argv[++i] ?? ''; }
  else opts._.push(a);
}
const [cmd, ...rest] = opts._;
const die = (msg, code = 1) => { console.error(msg); process.exit(code); };
if (!cmd || cmd === 'help' || cmd === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 19).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
let token = '';
try { token = fs.readFileSync(path.join(dataDir, 'cli-token'), 'utf8').trim(); } catch { die(`No CLI token at ${path.join(dataDir, 'cli-token')}. Is Pocket Code running from this checkout? (POCKET_DATA_DIR=${dataDir})`); }
// 1.118 (PC-04): how long a share or publish waits for the owner's answer before printing `pending <id>`.
const waitFor = (() => { if (opts.wait === undefined) return 90; const n = Number(opts.wait); if (!Number.isInteger(n) || n < 0 || n > 300) die('--wait takes a number of seconds from 0 to 300'); return n; })();
// The session's runner token tells Pocket which conversation asked, so the owner's card names it and only it can continue.
const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...(process.env.POCKET_RUNNER_TOKEN ? { 'x-pocket-runner': process.env.POCKET_RUNNER_TOKEN } : {}) };
async function call(p, body, method) {
  let r; const secs = body && body.wait ? body.wait + 30 : 30;
  try { r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(secs * 1000) }); } // 1.73.8: a hung daemon is not waited on for undici's 5 minutes
  catch (e) { die(`Pocket Code is not reachable at ${base}: ${e.name === 'TimeoutError' ? `no answer in ${secs} seconds` : e.cause?.code || e.message}`); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (data.code === 'documents_off') die('Files is off for this Pocket Code. Turn it on in Settings → Projects, files, tasks & vault.', 3);
    if (['denied', 'expired', 'request_stale', 'request_used', 'request_gone', 'request_mismatch'].includes(data.code)) die(data.error, 7);
    die(data.error || `${r.status} from ${p}`, r.status === 401 ? 4 : 1);
  }
  if (r.status === 202 && data.pending) pending(data);
  return data;
}
// The owner has not answered yet: say what was asked, and how to continue. Nothing is shared until the owner allows it.
function pending(data) {
  if (opts.json) console.log(JSON.stringify(data, null, 1));
  console.error(`pending ${data.request}\nThe owner was asked to allow this in Pocket Code: ${data.what || 'share the file'}. Until they do, the file stays ${data.document?.visibility || 'as it is'}.\nTell the user it is waiting for their Allow in Files (or on the notification), and continue with: pocket-docs wait ${data.request}`);
  process.exit(6);
}
const abs = u => !u ? '' : publicBase ? publicBase + u : u;
const when = whenIn(ownerZone(dataDir, env('POCKET_TZ')));
const line = d => `${d.id}  ${d.visibility.padEnd(7)} ${d.kind.padEnd(6)} ${d.title}${d.project ? `  [${d.project}]` : ''}  (${d.file}, ${when(d.added)})`;
function card(d, token) {
  const out = [line(d)];
  if (d.session) out.push(`  Session: ${d.session}`);
  if (d.visibility === 'public') out.push(`  Public URL: ${abs(d.url)}`);
  // 1.118 (PC-05): Pocket keeps only a hash of a share link, so the address is printed only by the command that made it.
  // Later the card says a link exists and when it expires; `share` would make a new one and break the one already given out.
  const expires = d.share?.expiresAt ? `expires ${when(d.share.expiresAt)}` : 'no expiry';
  if (d.visibility === 'link') out.push(token ? `  Share URL: ${abs('/share/' + token)}  (${expires}; shown this once, Pocket keeps only a fingerprint of it)` : `  Shared by link (${expires}). Pocket cannot show the address again; ask the user for the one they were given. pocket-docs share ${d.id} makes a new link and the old one stops working.`);
  return out.join('\n');
}
const out = (data, text) => console.log(opts.json ? JSON.stringify(data, null, 1) : text);
const expiresFrom = v => !v || v === 'none' ? null : (() => { const m = /^([1-9]\d{0,3})d$/.exec(v); if (!m) die('--expires takes a number of days, like 7d or 30d, or none'); return new Date(Date.now() + Number(m[1]) * 86400000).toISOString(); })();

switch (cmd) {
  case 'add': {
    if (!rest[0]) die('add needs a file path');
    const p = path.resolve(rest[0]);
    const d = await call('/api/documents/add', { path: p, title: opts.title || '', project: opts.project || '', session: opts.session || '', visibility: opts.visibility || 'private', wait: waitFor });
    out(d, 'Kept in Files:\n' + card(d, d.token)); break;
  }
  case 'list': {
    const q = new URLSearchParams(); if (opts.project) q.set('project', opts.project); if (opts.q) q.set('q', opts.q);
    const r = await call('/api/documents?' + q);
    if (opts.json) { console.log(JSON.stringify(r, null, 1)); break; }
    if (!r.documents.length) { console.log('No files.'); break; }
    for (const d of r.documents) console.log(line(d));
    if (r.trash?.length) console.log(`(${r.trash.length} in the trash)`);
    break;
  }
  case 'show': { if (!rest[0]) die('show needs a file id'); const r = await call('/api/documents'); const d = r.documents.find(x => x.id === rest[0]) || r.trash?.find(x => x.id === rest[0]); if (!d) die('No file with id ' + rest[0], 5); out(d, card(d)); break; }
  case 'share': {
    if (!rest[0]) die('share needs a file id');
    const r = await call('/api/documents'), d = r.documents.find(x => x.id === rest[0]); if (!d) die('No file with id ' + rest[0], 5);
    const body = d.visibility === 'link' ? { action: 'reshare' } : { visibility: 'link' };
    const e = expiresFrom(opts.expires); if (opts.expires) body.expiresAt = e;
    body.wait = waitFor;
    const u = await call('/api/documents/' + encodeURIComponent(d.id), body);
    out(u, `Share URL: ${abs('/share/' + u.token)}${u.share?.expiresAt ? `  (expires ${when(u.share.expiresAt)})` : ''}\nThis address is shown once: Pocket keeps only a fingerprint of it.${body.action === 'reshare' ? '\nThe previous link no longer works.' : ''}`); break;
  }
  case 'set': {
    if (!rest[0]) die('set needs a file id');
    const body = {}; for (const [k, v] of [['title', opts.title], ['project', opts.project], ['visibility', opts.visibility]]) if (v !== undefined) body[k] = v;
    if (opts.expires !== undefined) body.expiresAt = expiresFrom(opts.expires);
    if (!Object.keys(body).length) die('set needs --title, --project, --visibility or --expires');
    body.wait = waitFor;
    const u = await call('/api/documents/' + encodeURIComponent(rest[0]), body); out(u, card(u, u.token)); break;
  }
  case 'wait': {
    if (!rest[0]) die('wait needs the request id printed with pending');
    const u = await call('/api/documents/requests/' + encodeURIComponent(rest[0]) + '/wait', { wait: waitFor });
    const said = u.visibility === 'public' ? 'Allowed. Published' : 'Allowed. Shared';
    out(u, `${said}:\n` + card(u, u.token)); break;
  }
  case 'trash': case 'restore': { if (!rest[0]) die(`${cmd} needs a file id`); const u = await call('/api/documents/' + encodeURIComponent(rest[0]), { action: cmd }); out(u, `${cmd === 'trash' ? 'Moved to the trash (restorable for 30 days)' : 'Restored'}: ${u.title}`); break; }
  case 'import': {
    if (!rest[0]) die('import needs the path of the metadata file');
    let meta; try { meta = JSON.parse(fs.readFileSync(rest[0], 'utf8')); } catch (e) { die(`Could not read ${rest[0]}: ${e.message}`); }
    const r = await call('/api/documents/import', meta);
    out(r, `Imported: ${r.counts.public} public, ${r.counts.link} link, ${r.counts.private} private; ${r.counts.skipped} already here; ${r.adopted} file(s) adopted from the folder.` + (r.links.length ? '\nShare links (replace the old staff URLs):\n' + r.links.map(l => `  ${l.file}: ${abs(l.url)}`).join('\n') : '') + (r.missing.length ? `\nIn the metadata but not in the folder: ${r.missing.join(', ')}` : '') + (r.held?.length ? `\nKept private (an agent cannot share or publish on its own; ask the owner, then use pocket-docs share or set --visibility): ${r.held.map(h => `${h.file} (${h.wanted})`).join(', ')}` : ''));
    break;
  }
  default: die(`Unknown command ${cmd}. Run pocket-docs help.`);
}
