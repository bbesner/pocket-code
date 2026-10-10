#!/usr/bin/env node
// pocket-docs: keep files in Pocket Code's Files library from a terminal or an agent session (1.30; called Documents before 1.34).
// Talks to the running Pocket Code server over loopback with the token it writes to <data dir>/cli-token;
// it never touches the library's folder itself. Files are private unless the user asks to share.
//
//   pocket-docs add <path> [--title "…"] [--project <id>] [--session <id>] [--visibility private|link|public]
//   pocket-docs list [--project <id>] [--q text] [--json]
//   pocket-docs show <id> [--json]
//   pocket-docs share <id> [--expires 7d|30d|none]      make it link-visible (or a fresh link) and print the URL
//   pocket-docs set <id> [--title "…"] [--project <id>] [--visibility private|link|public]
//   pocket-docs trash <id> | restore <id>
//   pocket-docs import <dashboard-files-meta.json>       one-time import of Mission Control's documents metadata
// Environment: POCKET_DATA_DIR and PORT as for the server (the server's .env is read for both); POCKET_URL overrides;
// POCKET_PUBLIC_URL (e.g. https://claude.example.com) makes printed share URLs absolute.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const envFile = process.env.POCKET_ENV_FILE ?? path.join(root, '.env');
const fileEnv = {};
try { for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line); if (m && !m[1].startsWith('#')) fileEnv[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2'); } } catch { }
const env = k => process.env[k] ?? fileEnv[k];
const dataDir = env('POCKET_DATA_DIR') || root;
const base = env('POCKET_URL') || `http://127.0.0.1:${Number(env('PORT')) || 3610}`;
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
if (!cmd || cmd === 'help' || cmd === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 15).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
let token = '';
try { token = fs.readFileSync(path.join(dataDir, 'cli-token'), 'utf8').trim(); } catch { die(`No CLI token at ${path.join(dataDir, 'cli-token')}. Is Pocket Code running from this checkout? (POCKET_DATA_DIR=${dataDir})`); }
async function call(p, body, method) {
  let r;
  try { r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); }
  catch (e) { die(`Pocket Code is not reachable at ${base}: ${e.cause?.code || e.message}`); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (data.code === 'documents_off') die('Files is off for this Pocket Code. Turn it on in Settings → Projects & files.', 3);
    die(data.error || `${r.status} from ${p}`, r.status === 401 ? 4 : 1);
  }
  return data;
}
const abs = u => !u ? '' : publicBase ? publicBase + u : u;
const when = v => v ? new Date(v).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';
const line = d => `${d.id}  ${d.visibility.padEnd(7)} ${d.kind.padEnd(6)} ${d.title}${d.project ? `  [${d.project}]` : ''}  (${d.file}, ${when(d.added)})`;
function card(d, token) {
  const out = [line(d)];
  if (d.session) out.push(`  Session: ${d.session}`);
  if (d.visibility === 'public') out.push(`  Public URL: ${abs(d.url)}`);
  if (d.visibility === 'link') out.push(`  Share URL: ${token ? abs('/share/' + token) : '(set when the link was made; run pocket-docs share ' + d.id + ' for a fresh one)'}${d.share?.expiresAt ? `  expires ${when(d.share.expiresAt)}` : ''}`);
  return out.join('\n');
}
const out = (data, text) => console.log(opts.json ? JSON.stringify(data, null, 1) : text);
const expiresFrom = v => !v || v === 'none' ? null : (() => { const m = /^(\d+)d$/.exec(v); if (!m) die('--expires takes 7d, 30d or none'); return new Date(Date.now() + Number(m[1]) * 86400000).toISOString(); })();

switch (cmd) {
  case 'add': {
    if (!rest[0]) die('add needs a file path');
    const p = path.resolve(rest[0]);
    const d = await call('/api/documents/add', { path: p, title: opts.title || '', project: opts.project || '', session: opts.session || '', visibility: opts.visibility || 'private' });
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
  case 'show': { if (!rest[0]) die('show needs a file id'); const r = await call('/api/documents?all=1'); const d = r.documents.find(x => x.id === rest[0]) || r.trash?.find(x => x.id === rest[0]); if (!d) die('No file with id ' + rest[0], 5); out(d, card(d)); break; }
  case 'share': {
    if (!rest[0]) die('share needs a file id');
    const r = await call('/api/documents?all=1'), d = r.documents.find(x => x.id === rest[0]); if (!d) die('No file with id ' + rest[0], 5);
    const body = d.visibility === 'link' ? { action: 'reshare' } : { visibility: 'link' };
    const e = expiresFrom(opts.expires); if (opts.expires) body.expiresAt = e;
    const u = await call('/api/documents/' + encodeURIComponent(d.id), body);
    out(u, `Share URL: ${abs('/share/' + u.token)}${u.share?.expiresAt ? `  (expires ${when(u.share.expiresAt)})` : ''}`); break;
  }
  case 'set': {
    if (!rest[0]) die('set needs a file id');
    const body = {}; for (const [k, v] of [['title', opts.title], ['project', opts.project], ['visibility', opts.visibility]]) if (v !== undefined) body[k] = v;
    if (!Object.keys(body).length) die('set needs --title, --project or --visibility');
    const u = await call('/api/documents/' + encodeURIComponent(rest[0]), body); out(u, card(u, u.token)); break;
  }
  case 'trash': case 'restore': { if (!rest[0]) die(`${cmd} needs a file id`); const u = await call('/api/documents/' + encodeURIComponent(rest[0]), { action: cmd }); out(u, `${cmd === 'trash' ? 'Moved to the trash (restorable for 30 days)' : 'Restored'}: ${u.title}`); break; }
  case 'import': {
    if (!rest[0]) die('import needs the path of the metadata file');
    let meta; try { meta = JSON.parse(fs.readFileSync(rest[0], 'utf8')); } catch (e) { die(`Could not read ${rest[0]}: ${e.message}`); }
    const r = await call('/api/documents/import', meta);
    out(r, `Imported: ${r.counts.public} public, ${r.counts.link} link, ${r.counts.private} private; ${r.counts.skipped} already here; ${r.adopted} file(s) adopted from the folder.` + (r.links.length ? '\nShare links (replace the old staff URLs):\n' + r.links.map(l => `  ${l.file}: ${abs(l.url)}`).join('\n') : '') + (r.missing.length ? `\nIn the metadata but not in the folder: ${r.missing.join(', ')}` : ''));
    break;
  }
  default: die(`Unknown command ${cmd}. Run pocket-docs help.`);
}
