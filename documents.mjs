// Documents (1.30): the library of files that came out of the work. Files live in the documents folder
// (POCKET_DOCUMENTS_DIR, default <data dir>/documents); records live in <data dir>/documents.json, written
// atomically by the server alone. Files dropped straight into the folder are adopted as private records on
// the next listing; the scan only ever adds. Visibility is private (login), link (an unguessable signed URL,
// optional expiry, revocable) or public (/files/<name>, the path the older dashboard's public links used).
// Removing a document moves it to .trash for 30 days, then purges it; since 1.45 the owner can also delete a
// trashed file at once (Delete forever, Empty trash), which takes its file, its thumbnails and its record. HTML is
// served sandboxed, never under the app origin's authority.
// 1.118 (PC-05): a share link's token is never stored in the clear, only its hash; the address is handed out when it is made.
// Copy link: a store given a `linkKey` (the server derives one from POCKET_SECRET) also keeps the token sealed with it
// (AES-256-GCM, bound to the record's id), so the owner can copy a link's address again later. The sealed token is never in
// a record's view; shareLink() opens it, and the server answers that to the signed-in owner only, never to the CLI token.
// 1.118 (PC-04): an agent (the CLI token) may keep and edit private files, and make a file less exposed, but a change that
// exposes a file more (a link, a new or longer-lived link, a public address) waits for the owner's Allow, the way a Vault
// request does: one request per document and change, answered once by the owner, and carried out only if the file's content
// and its sharing are still what the owner was shown.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash, createHmac, createCipheriv, createDecipheriv } from 'node:crypto';
import { shellArg } from './skills.mjs';
import { LIMITS as VAULT_LIMITS } from './vault.mjs';
import { openChecked } from './thumbnails.mjs';

export const KINDS = { '.html': 'html', '.htm': 'html', '.pdf': 'pdf', '.md': 'md', '.txt': 'txt', '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image', '.csv': 'table', '.tsv': 'table', '.json': 'json', '.docx': 'office', '.xlsx': 'office', '.pptx': 'office', '.mp4': 'video' };
export const MIME = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.pdf': 'application/pdf', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.csv': 'text/csv; charset=utf-8', '.tsv': 'text/tab-separated-values; charset=utf-8', '.json': 'application/json; charset=utf-8', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.mp4': 'video/mp4' };
export const LIMITS = { documents: 5000, title: 200, inlineHtml: 10 * 1024 * 1024, trashDays: 30, name: 120 };
export const VISIBILITIES = ['private', 'link', 'public'];
// Only these render inside Pocket; office files and video open in the device's viewer or download.
export const INLINE_KINDS = new Set(['html', 'pdf', 'md', 'txt', 'image', 'table', 'json']);
const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const SESSION_RE = /^(cx:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hash = t => createHash('sha256').update(t).digest('hex');
// The key a share link's token is sealed with, from the server's secret: a use of its own, so it is no other key.
export const linkKeyFrom = secret => createHmac('sha256', String(secret)).update('pocket-share-link\0v1').digest();
const SHARE_PATH_RE = /^\/share\/([A-Za-z0-9_-]{20,100})$/;
// PC-04: a request waits for the Vault's request time (15 minutes) and a call waits on it for at most the Vault's wait.
export const REQUEST_LIMITS = { ttlMs: VAULT_LIMITS.requestTtlMs, waitMax: VAULT_LIMITS.waitMax, waiting: 50 };
const sameCaller = (a, b) => (a?.actor || 'terminal') === (b?.actor || 'terminal') && (a?.session || null) === (b?.session || null);
// The change as one input to update(): exactly what the owner allowed, nothing the caller can add to.
const changeInput = c => c.to === 'public' ? { visibility: 'public' } : c.reshare ? { action: 'reshare', expiresAt: c.expiresAt } : c.extend ? { expiresAt: c.expiresAt } : { visibility: 'link', expiresAt: c.expiresAt };
export const kindOf = name => KINDS[path.extname(String(name)).toLowerCase()] || null;
export const mimeOf = name => MIME[path.extname(String(name)).toLowerCase()] || 'application/octet-stream';
// A file name that is safe on disk and in a URL: the base name, odd characters replaced, extension kept.
export function safeName(name) {
  const base = path.basename(String(name || '')).replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '').slice(-LIMITS.name);
  return base && kindOf(base) ? base : null;
}
// Title: the HTML <title>, the first Markdown heading, else the file name without its extension.
export function titleFor(file, text) {
  const kind = kindOf(file);
  if (kind === 'html' && text) { const m = text.slice(0, 20000).match(/<title[^>]*>([\s\S]*?)<\/title>/i); if (m) { const t = m[1].replace(/\s+/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim(); /* &amp; last: "&amp;lt;" is the text "&lt;" */ if (t) return t.slice(0, LIMITS.title); } }
  if (kind === 'md' && text) { const m = text.slice(0, 20000).match(/^#{1,3}\s+(.+)$/m); if (m) return m[1].replace(/[*_`#]/g, '').trim().slice(0, LIMITS.title); }
  return path.basename(file, path.extname(file)).replace(/[_-]+/g, ' ').trim().slice(0, LIMITS.title) || file;
}
// One line for an agent's instructions when Files (the documents feature) is on.
export function documentInstructions(cli, sessionId) {
  cli = shellArg(cli); // 1.73.8: one shell word even with a space in the install path
  const sid = sessionId ? ` --session ${sessionId}` : '';
  return `This Pocket Code keeps a Files library. When the user says files, my files, documents, my documents or docs, they mean this library (not a folder on the server or another drive, unless they name one); the pocket-files skill (\`${path.join(path.dirname(cli), '..', 'skills', 'pocket-files', 'SKILL.md')}\`) has the full procedure. When you produce a deliverable for the user to read (an HTML report or dashboard, a PDF, an image, a Markdown write-up, a CSV or spreadsheet), or the user asks to save something there, keep it with \`node ${cli} add <path>${sid} [--title "…"] [--project <id>]\` so it appears in Pocket's Files, linked to this session; link it to the directory's tracked project when there is one. Files are private unless the user asks to share; use \`node ${cli} share <id>\` for a link only when asked. Sharing or publishing asks the user to allow it in Pocket: if the command prints \`pending <id>\`, tell the user it is waiting for their Allow and continue with \`node ${cli} wait <id>\`. Mention the file by its title in your reply, not by server path.`;
}

export class DocumentStore {
  constructor(dir, metaFile, { write, now, linkKey = null } = {}) {
    this.dir = dir; this.file = metaFile; this.now = now || Date.now;
    this.linkKey = Buffer.isBuffer(linkKey) && linkKey.length === 32 ? linkKey : null;
    this.write = write || ((f, data) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 }); fs.renameSync(tmp, f); });
    fs.mkdirSync(dir, { recursive: true });
    let d = {}; try { d = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { }
    this.documents = Array.isArray(d.documents) ? d.documents.filter(r => r && typeof r.id === 'string' && typeof r.file === 'string') : [];
    this.requests = new Map(); // PC-04: id -> a request for the owner; memory only, so a restart drops it and changes nothing
    this.migrated = this.dropStoredLinks();
  }
  // PC-05: records written before 1.118 kept the share address (`share.url`, the token in plain text) beside its hash. The
  // address goes and the hash stays, so links already handed out keep working; a record with an address and no hash gets the
  // hash of the address's token first. The file is written back at once so the tokens leave the disk. Returns how many changed.
  dropStoredLinks() {
    let n = 0;
    this.documents = this.documents.map(r => {
      if (!r.share || typeof r.share !== 'object' || !('url' in r.share)) return r;
      const { url, ...share } = r.share, m = typeof url === 'string' ? SHARE_PATH_RE.exec(url) : null;
      n++; return { ...r, share, shareHash: r.shareHash || (m ? hash(m[1]) : null) };
    });
    if (n) { try { this.save(); } catch (e) { this.migrateError = e.message; } }
    return n;
  }
  // 1.73.6: a change is computed on a copy of the record, written, and installed only once the file holds it; the checks
  // come before any file is copied, so a refused add leaves nothing in the folder for the scan to adopt.
  save(documents = this.documents) { this.write(this.file, { version: 1, documents }); }
  commit(documents) { this.save(documents); this.documents = documents; }
  replace(live, next) { return this.documents.map(x => x === live ? next : x); }
  get(id) { const r = this.documents.find(x => x.id === id); if (!r) throw fail('That file does not exist.', 404); return r; }
  trashDir() { return path.join(this.dir, '.trash'); }
  filePath(r) { return r.trashedAt ? path.join(this.trashDir(), r.id + '-' + r.file) : path.join(this.dir, r.file); }
  // The record as the UI and CLI see it: the public address for a public file; for a link only that it exists and when it
  // expires (PC-05: the address itself is in the answer that made it, and nowhere after). Never the token hash.
  view(r) {
    const { shareHash, shareSealed, ...rest } = r;
    return { ...rest, share: r.share ? { expiresAt: r.share.expiresAt || null, ...(this.openLink(r) ? { kept: true } : {}) } : null, url: r.visibility === 'public' ? '/files/' + encodeURIComponent(r.file) : null, inline: INLINE_KINDS.has(r.kind) && (r.kind !== 'html' || r.size <= LIMITS.inlineHtml) };
  }
  uniqueFile(name, except = null) {
    let file = name, n = 2; const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
    while (this.documents.some(r => r.file === file && r.id !== except) || fs.existsSync(path.join(this.dir, file))) file = `${stem}-${n++}${ext}`;
    return file;
  }
  // What a new record must satisfy; checked before a file is copied in. `count` is the library size the record would join.
  check({ session, visibility } = {}, count = this.documents.length) {
    if (count >= LIMITS.documents) throw fail(`The Files library holds up to ${LIMITS.documents} files.`, 409);
    if (session && !SESSION_RE.test(session)) throw fail('That is not a session id.');
    if (visibility && !VISIBILITIES.includes(visibility)) throw fail('Visibility must be private, link or public.');
  }
  // A new record (not yet in the list: the caller writes the list it joins, then installs it).
  record(file, { title, project, session, visibility, addedBy, size, at, source }, count) {
    this.check({ session, visibility }, count);
    const r = { id: randomBytes(6).toString('hex'), file, title: str(title, LIMITS.title) || titleFor(file, this.peek(path.join(this.dir, file))), kind: kindOf(file), size, added: at, addedBy, updated: at, session: session || null, project: str(project, 80) || null, visibility: visibility || 'private', share: null, shareHash: null, trashedAt: null };
    if (source) r.source = String(source).slice(0, 1000); // 1.61: the kept file's original path
    this.pendingToken = r.visibility === 'link' ? this.mintShare(r, null) : null;
    return r;
  }
  peek(p) { try { return kindOf(p) === 'html' || kindOf(p) === 'md' ? fs.readFileSync(p, 'utf8').slice(0, 20000) : ''; } catch { return ''; } }
  // Files in the folder that have no record become private records (addedBy: folder). Missing files are flagged, never dropped.
  scan() {
    let changed = false, next = [...this.documents];
    const known = new Set(this.documents.filter(r => !r.trashedAt).map(r => r.file));
    let names = []; try { names = fs.readdirSync(this.dir); } catch { }
    for (const name of names.sort()) {
      if (name.startsWith('.') || known.has(name) || !kindOf(name)) continue;
      if (next.length >= LIMITS.documents) break;
      let st; try { st = fs.statSync(path.join(this.dir, name)); } catch { continue; }
      if (!st.isFile()) continue;
      next.push(this.record(name, { addedBy: 'folder', size: st.size, at: iso(st.mtimeMs) }, next.length));
      changed = true;
    }
    next = next.map(r => { const missing = !fs.existsSync(this.filePath(r)); if (Boolean(r.missing) === missing) return r; changed = true; const { missing: _, ...rest } = r; return missing ? { ...rest, missing: true } : rest; });
    if (changed) this.commit(next);
    return changed;
  }
  list({ project = '', q = '', trashed = false } = {}) {
    this.scan();
    const needle = q.trim().toLowerCase();
    return this.documents.filter(r => Boolean(r.trashedAt) === trashed && (!project || r.project === project) && (!needle || (r.title + ' ' + r.file).toLowerCase().includes(needle)))
      .sort((a, b) => Date.parse(b.added) - Date.parse(a.added)).map(r => this.view(r));
  }
  // Copy a file in (the server checks the source path first). The name is made safe and unique.
  addFromPath(src, opts = {}) {
    const name = safeName(src); if (!name) throw fail('That file type cannot be kept in Files.');
    const st = fs.statSync(src); if (!st.isFile()) throw fail('That is not a file.');
    this.check(opts);
    const file = this.uniqueFile(name), at = iso(this.now()), dest = path.join(this.dir, file);
    fs.copyFileSync(src, dest); fs.chmodSync(dest, 0o600);
    return this.keep(dest, this.record(file, { ...opts, size: st.size, at }));
  }
  // The new record joins the list on disk, then in memory; if the write fails the copied file goes too.
  keep(dest, r) {
    const token = this.pendingToken;
    try { this.commit([...this.documents, r]); } catch (e) { try { fs.unlinkSync(dest); } catch { } throw e; }
    return { ...this.view(r), ...(token ? { token } : {}) };
  }
  addFromBuffer(name, buffer, opts = {}) {
    const safe = safeName(name); if (!safe) throw fail('That file type cannot be kept in Files.');
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw fail('The upload is empty.'); // 1.118: a JSON body arrives parsed (an array has a length too)
    this.check(opts);
    const file = this.uniqueFile(safe), at = iso(this.now()), dest = path.join(this.dir, file);
    fs.writeFileSync(dest, buffer, { mode: 0o600 });
    return this.keep(dest, this.record(file, { ...opts, size: buffer.length, at }));
  }
  // PC-05: the hash is kept, and with a link key the token sealed with it; the caller hands the token out.
  mintShare(r, expiresAt) {
    const token = randomBytes(32).toString('base64url');
    r.shareHash = hash(token); r.share = { expiresAt: expiresAt || null };
    delete r.shareSealed;
    if (this.linkKey) {
      const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', this.linkKey, iv); c.setAAD(Buffer.from(r.id));
      r.shareSealed = Buffer.concat([iv, c.update(token, 'utf8'), c.final(), c.getAuthTag()]).toString('base64url');
    }
    return token;
  }
  // The token of a record's open link, when this store kept it and can still open it (same key, same record, and it is the
  // token the hash was made from); else null: a link made before links were kept, or sealed under another secret.
  openLink(r) {
    if (!this.linkKey || r.visibility !== 'link' || r.trashedAt || !r.shareHash || typeof r.shareSealed !== 'string') return null;
    try {
      const b = Buffer.from(r.shareSealed, 'base64url'); if (b.length < 29) return null;
      const d = createDecipheriv('aes-256-gcm', this.linkKey, b.subarray(0, 12)); d.setAAD(Buffer.from(r.id)); d.setAuthTag(b.subarray(b.length - 16));
      const token = Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()]).toString('utf8');
      return hash(token) === r.shareHash ? token : null;
    } catch { return null; }
  }
  // Copy link: the owner asks for an open link's address again. An expired link is still the owner's to read.
  shareLink(id) {
    const r = this.get(id);
    if (r.visibility !== 'link' || r.trashedAt) throw fail('This file has no share link.', 409);
    const token = this.openLink(r);
    if (!token) throw fail('Pocket did not keep this link’s address: it was made before links were kept. Use the address you copied, or make a new link (the old one stops working).', 404, { code: 'link_not_kept' });
    return { id: r.id, token, expiresAt: r.share?.expiresAt || null };
  }
  update(id, input, { actor = 'ui' } = {}) {
    const live = this.get(id); if (live.trashedAt) throw fail('This file is in the trash. Restore it first.', 409);
    const r = structuredClone(live), at = iso(this.now()); let token = null;
    if ('title' in input) { const t = str(input.title, LIMITS.title); if (!t) throw fail('Give the file a title.'); r.title = t; }
    if ('project' in input) r.project = str(input.project, 80) || null;
    if ('session' in input) { const s = str(input.session, 64); if (s && !SESSION_RE.test(s)) throw fail('That is not a session id.'); r.session = s || null; }
    if ('expiresAt' in input) { const e = input.expiresAt ? Date.parse(input.expiresAt) : NaN; if (input.expiresAt && Number.isNaN(e)) throw fail('That expiry is not a valid time.'); if (r.share) r.share.expiresAt = input.expiresAt ? iso(e) : null; }
    if ('visibility' in input) {
      if (!VISIBILITIES.includes(input.visibility)) throw fail('Visibility must be private, link or public.');
      if (input.visibility !== r.visibility) {
        r.visibility = input.visibility;
        if (r.visibility === 'link') token = this.mintShare(r, input.expiresAt ? iso(Date.parse(input.expiresAt)) : null);
        else { r.share = null; r.shareHash = null; delete r.shareSealed; } // leaving link revokes the old URL
      }
    }
    if (input.action === 'reshare') { if (r.visibility !== 'link') throw fail('Only a file shared by link has a share link.'); token = this.mintShare(r, r.share?.expiresAt || null); }
    r.updated = at; r.updatedBy = actor; this.commit(this.replace(live, r));
    return { ...this.view(r), ...(token ? { token } : {}) };
  }
  // ---------- PC-04: changes that expose a file more wait for the owner ----------
  // The exposure part of an update(), normalised, when it would make the file more exposed than it is: to link or public, a
  // new link (replacing one, or from public), or a link that lasts longer. Null when it exposes nothing more (to private, a
  // shorter expiry, title or project only). Checks the input the way update() does, so a bad value is refused here too.
  exposureChange(id, input = {}) {
    const r = this.get(id); if (r.trashedAt) throw fail('This file is in the trash. Restore it first.', 409);
    let expiry; // undefined: not given
    if ('expiresAt' in input) { const e = input.expiresAt ? Date.parse(input.expiresAt) : NaN; if (input.expiresAt && Number.isNaN(e)) throw fail('That expiry is not a valid time.'); expiry = input.expiresAt ? iso(e) : null; }
    if ('visibility' in input && input.visibility !== r.visibility) {
      if (!VISIBILITIES.includes(input.visibility)) throw fail('Visibility must be private, link or public.');
      if (input.visibility === 'private') return null;
      return input.visibility === 'public' ? { to: 'public', expiresAt: null } : { to: 'link', expiresAt: expiry ?? null };
    }
    if (input.action === 'reshare') { if (r.visibility !== 'link') throw fail('Only a file shared by link has a share link.'); return { to: 'link', reshare: true, expiresAt: expiry !== undefined ? expiry : r.share?.expiresAt || null }; }
    if (expiry !== undefined && r.visibility === 'link') {
      const now = r.share?.expiresAt || null;
      if (now && (expiry === null || Date.parse(expiry) > Date.parse(now))) return { to: 'link', extend: true, expiresAt: expiry };
    }
    return null;
  }
  // The file as it would be served, by content: opened once without following a link, inside the library, hashed from that
  // descriptor. Taken when the request is raised and again when the owner allows it.
  async fingerprint(r) {
    if (r.trashedAt || r.missing) throw fail('That file is not in the library.', 409);
    const root = fs.realpathSync(this.dir);
    let file; try { file = openChecked(this.filePath(r), real => real.startsWith(root + path.sep)); }
    catch { throw fail('That file is not a regular file inside the library, so it cannot be shared.', 409); }
    try {
      const h = createHash('sha256');
      await new Promise((ok, no) => fs.createReadStream(null, { fd: file.fd, autoClose: false, start: 0 }).on('data', c => h.update(c)).on('error', no).on('end', ok));
      return { sha256: h.digest('hex'), size: file.stat.size };
    } finally { file.close(); }
  }
  // Why a request can no longer be carried out (the document went, or its sharing or name moved on), or null.
  staleReason(row, r = this.documents.find(x => x.id === row.doc)) {
    if (!r || r.trashedAt || r.missing) return 'The file was removed or is missing.';
    if (r.file !== row.from.file) return 'The file was renamed.';
    if (r.visibility !== row.from.visibility || (r.shareHash || null) !== row.from.shareHash || (r.share?.expiresAt || null) !== row.from.expiresAt) return 'The file’s sharing changed since the request was made.';
    return null;
  }
  // A request for one document and one change. `source` is the path the agent kept the file from, when it has one.
  async raiseRequest(id, change, { caller = null, session = null, sessionTitle = '', source = '' } = {}) {
    this.expireRequests();
    if ([...this.requests.values()].filter(x => !x.answer).length >= REQUEST_LIMITS.waiting) throw fail(`Up to ${REQUEST_LIMITS.waiting} requests can wait for the owner at once. Wait for an answer first.`, 429);
    const before = this.get(id), fp = await this.fingerprint(before), r = this.get(id);
    const now = this.now();
    let rid = randomBytes(8).toString('hex'); while (this.requests.has(rid)) rid = randomBytes(8).toString('hex');
    const row = { id: rid, doc: r.id, title: r.title, file: r.file, kind: r.kind, size: fp.size, sha256: fp.sha256, path: str(source, 1000) || r.source || path.join(this.dir, r.file),
      from: { visibility: r.visibility, shareHash: r.shareHash || null, expiresAt: r.share?.expiresAt || null, file: r.file },
      change: { to: change.to, expiresAt: change.expiresAt || null, ...(change.reshare ? { reshare: true } : {}), ...(change.extend ? { extend: true } : {}) },
      url: change.to === 'public' ? '/files/' + encodeURIComponent(r.file) : null,
      session, sessionTitle: str(sessionTitle, 200), by: caller?.actor || 'terminal', caller: { actor: caller?.actor || 'terminal', session: caller?.session || null },
      created: iso(now), expiresAt: iso(now + REQUEST_LIMITS.ttlMs), answer: null, answering: false, token: null, collected: false, waiters: [] };
    if (r !== before) throw fail('The file changed while Pocket was checking it; try again.', 409); // a commit replaces the record
    this.requests.set(rid, row);
    return row;
  }
  // What the owner's card and the agent see: never the share hash, the caller's details or an address.
  requestView(row) { const { waiters, token, caller, sha256, answering, from, ...rest } = row; return { ...rest, fromVisibility: from.visibility, pending: !row.answer }; }
  pendingRequests() { this.expireRequests(); return [...this.requests.values()].filter(r => !r.answer).map(r => this.requestView(r)); }
  answeredRequests() { return [...this.requests.values()].filter(r => r.answer).map(r => ({ id: r.id, doc: r.doc, title: r.title, decision: r.answer.decision, at: r.answer.at })); }
  settle(row, answer) { row.answer = { ...answer, at: iso(this.now()) }; row.answering = false; for (const w of row.waiters.splice(0)) w(row); return this.requestView(row); }
  // The owner's answer (the server lets only the owner's cookie reach this). Deny changes nothing. Allow checks, at this
  // moment, that the document, its name, its sharing and its content are what the request recorded, then makes exactly the
  // recorded change; anything else ends the request as stale and changes nothing. A request is answered once.
  async answerRequest(id, decision) {
    this.expireRequests();
    const row = this.requests.get(String(id)); if (!row) throw fail('That request does not exist or has expired.', 404);
    if (row.answer || row.answering) throw fail('That request was already answered.', 409);
    if (decision !== 'allow' && decision !== 'deny') throw fail('Answer allow or deny.');
    if (decision === 'deny') return this.settle(row, { decision: 'deny' });
    row.answering = true; // a second Allow (a double tap, the notification and the card) is refused while this one checks
    let stale = this.staleReason(row);
    if (!stale) {
      let fp = null; try { fp = await this.fingerprint(this.get(row.doc)); } catch { stale = 'The file can no longer be read.'; }
      if (fp && (fp.sha256 !== row.sha256 || fp.size !== row.size)) stale = 'The file’s content changed since the request was made.';
      stale = stale || this.staleReason(row); // and nothing moved while it was being read
    }
    if (stale) { this.settle(row, { decision: 'stale', reason: stale }); throw fail(stale + ' Nothing was shared.', 409, { code: 'request_stale' }); }
    let out; try { out = this.update(row.doc, changeInput(row.change), { actor: 'cli' }); } catch (e) { row.answering = false; throw e; }
    row.token = out.token || null;
    return { ...this.settle(row, { decision: 'allow' }), document: out.token ? (({ token, ...v }) => v)(out) : out };
  }
  // Resolves with the request once answered, or null when `ms` pass first.
  waitRequest(id, ms) {
    this.expireRequests();
    const row = this.requests.get(String(id)); if (!row) throw fail('That request does not exist or has expired.', 404, { code: 'request_gone' });
    if (row.answer || !ms) return Promise.resolve(row.answer ? row : null);
    return new Promise(resolve => { const t = setTimeout(() => { row.waiters = row.waiters.filter(w => w !== done); resolve(null); }, ms); const done = () => { clearTimeout(t); resolve(row); }; row.waiters.push(done); });
  }
  // The raiser's continuation: only the caller that raised it (same actor and session), before and after the answer.
  continuation(id, caller) {
    this.expireRequests();
    const row = this.requests.get(String(id)); if (!row) throw fail('That request does not exist or has expired.', 404, { code: 'request_gone' });
    if (!sameCaller(row.caller, caller)) throw fail('That request was raised by another session.', 403, { code: 'request_mismatch' });
    if (row.collected) throw fail('That request was already used.', 409, { code: 'request_used' });
    return row;
  }
  // What the raiser learns, once: the document as it is now, and a new link's address. Refusals say why and that nothing changed.
  collectRequest(id, caller) {
    const row = this.continuation(id, caller);
    if (!row.answer) return null;
    const d = row.answer.decision;
    if (d === 'deny') throw fail('The owner did not allow this. The file was not shared.', 403, { code: 'denied' });
    if (d === 'expired') throw fail('The request expired before the owner answered. The file was not shared.', 403, { code: 'expired' });
    if (d === 'stale') throw fail(`${row.answer.reason} Nothing was shared; ask again if it is still wanted.`, 409, { code: 'request_stale' });
    row.collected = true; const token = row.token; row.token = null;
    const r = this.documents.find(x => x.id === row.doc);
    return { document: r ? this.view(r) : null, token, change: row.change, url: row.url };
  }
  // An unanswered request ends as expired after the Vault's request time; an answered one is forgotten that long after its
  // answer, with any address nobody collected.
  expireRequests(now = this.now()) {
    for (const [id, row] of this.requests) {
      if (!row.answer) { if (!row.answering && Date.parse(row.expiresAt) <= now) this.settle(row, { decision: 'expired' }); continue; } // kept a while so the agent learns it expired
      if (Date.parse(row.answer.at) + REQUEST_LIMITS.ttlMs <= now) { row.token = null; this.requests.delete(id); }
    }
  }
  // Trash and restore move the file first, then the record (a bulk step installs each record and saves once at the end).
  trash(id, { save = true } = {}) {
    const live = this.get(id); if (live.trashedAt) return this.view(live);
    fs.mkdirSync(this.trashDir(), { recursive: true });
    const from = path.join(this.dir, live.file), at = iso(this.now());
    const { shareSealed: _sealed, ...kept } = live;
    const r = { ...kept, trashedAt: at, updated: at, share: null, shareHash: null, visibility: 'private' }; // a trashed document is reachable by nobody
    try { fs.renameSync(from, this.filePath(r)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const next = this.replace(live, r); if (save) this.commit(next); else this.documents = next;
    return this.view(r);
  }
  restore(id, { save = true } = {}) {
    const live = this.get(id); if (!live.trashedAt) return this.view(live);
    const from = this.filePath(live), file = this.uniqueFile(live.file, live.id);
    const r = { ...live, trashedAt: null, file, updated: iso(this.now()) };
    try { fs.renameSync(from, path.join(this.dir, file)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const next = this.replace(live, r); if (save) this.commit(next); else this.documents = next;
    return this.view(r);
  }
  // 1.45: Delete forever. Only a file already in the trash; the file, its thumbnails and the record go now.
  destroy(id, { save = true } = {}) {
    const r = this.get(id); if (!r.trashedAt) throw fail('Remove the file first. Only files in the trash can be deleted.', 409);
    const [problem] = this.forget([r]); if (problem) throw fail(problem.error, 500);
    if (save) this.save();
    return { id: r.id, file: r.file, deleted: true };
  }
  // 1.45: several files in one step (the library's select mode). Each id succeeds or fails alone; one save at the end.
  bulk(action, ids) {
    const run = { trash: id => this.trash(id, { save: false }), restore: id => this.restore(id, { save: false }), delete: id => this.destroy(id, { save: false }) }[action];
    if (!run) throw fail('The action must be trash, restore or delete.');
    if (!Array.isArray(ids) || !ids.length || ids.length > LIMITS.documents || ids.some(id => typeof id !== 'string')) throw fail('Choose the files first.');
    const done = [], failed = [];
    for (const id of [...new Set(ids)]) { try { done.push(run(id)); } catch (e) { failed.push({ id, error: e.message }); } }
    if (done.length) this.save();
    return { done, failed };
  }
  emptyTrash() {
    const rows = this.documents.filter(r => r.trashedAt), failed = this.forget(rows);
    const done = rows.filter(r => !failed.some(f => f.id === r.id)).map(r => r.id);
    if (done.length) this.save();
    return { done, failed };
  }
  purge(now = this.now()) {
    const cutoff = now - LIMITS.trashDays * 86400000;
    const rows = this.documents.filter(r => r.trashedAt && Date.parse(r.trashedAt) < cutoff), failed = this.forget(rows);
    const gone = rows.filter(r => !failed.some(f => f.id === r.id)).map(r => r.id);
    if (gone.length) this.save();
    return gone;
  }
  // Unlink each file (already gone is fine) and drop its record; a file that cannot be unlinked keeps its record and is
  // reported. Then the thumbnails nobody owns any more go too.
  forget(rows) {
    const failed = [];
    for (const r of rows) {
      try { fs.unlinkSync(this.filePath(r)); } catch (e) { if (e.code !== 'ENOENT') { failed.push({ id: r.id, error: `Could not delete ${r.file}: ${e.code || e.message}` }); continue; } }
      this.documents = this.documents.filter(x => x !== r);
    }
    this.pruneThumbs();
    return failed;
  }
  // Thumbnails (thumbnails.mjs) are <documents dir>/.thumbs/<id>-<size>-<mtime>.<ext>; a picture whose record is gone is removed.
  pruneThumbs() {
    const dir = path.join(this.dir, '.thumbs'), ids = new Set(this.documents.map(r => r.id));
    let names = []; try { names = fs.readdirSync(dir); } catch { return 0; }
    let n = 0;
    for (const name of names) { const m = /^([0-9a-f]{12})-/.exec(name); if (m && !ids.has(m[1])) { try { fs.unlinkSync(path.join(dir, name)); n++; } catch { } } }
    return n;
  }
  // Unauthenticated lookups: public by exact file name; link (or public) by token, expiry enforced.
  resolvePublic(name) { const r = this.documents.find(x => x.file === name && !x.trashedAt && x.visibility === 'public'); return r && !r.missing ? r : null; }
  resolveShare(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const h = hash(token), r = this.documents.find(x => x.shareHash === h && !x.trashedAt && x.visibility === 'link');
    if (!r || r.missing) return null;
    if (r.share?.expiresAt && Date.parse(r.share.expiresAt) <= this.now()) return null;
    return r;
  }
  // One-time import of an older dashboard's dashboard-files-meta.json ({ name: { visibility, access?, updated } }).
  // public → public; private with an `access` value (the old format used one value, for staff) → link (tokens returned
  // once); private with `access` null or absent → private. Files without a record are adopted private by the scan. Names the metadata lists that are not in the folder are reported.
  // PC-04: with `hold` (an agent's import), every file comes in private and the ones the metadata had shared are listed in
  // `held` with what they were; the owner shares them, or the agent asks for each one.
  importMeta(meta, { hold = false } = {}) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw fail('That is not a documents metadata file.');
    const at = iso(this.now()), links = [], missing = [], held = [], counts = { public: 0, link: 0, private: 0, skipped: 0 }, next = [...this.documents];
    for (const [name, m] of Object.entries(meta)) {
      if (!m || typeof m !== 'object') continue;
      const file = path.basename(name);
      if (next.some(r => r.file === file)) { counts.skipped++; continue; }
      let st; try { st = fs.statSync(path.join(this.dir, file)); } catch { missing.push(file); continue; }
      if (!st.isFile() || !kindOf(file)) { missing.push(file); continue; }
      const wanted = m.visibility === 'public' ? 'public' : m.access ? 'link' : 'private', visibility = hold ? 'private' : wanted;
      const r = this.record(file, { addedBy: 'import', size: st.size, at: m.updated && !Number.isNaN(Date.parse(m.updated)) ? iso(Date.parse(m.updated)) : iso(st.mtimeMs), visibility }, next.length);
      next.push(r); counts[visibility]++;
      if (wanted !== visibility) held.push({ id: r.id, file, wanted });
      if (visibility === 'link') links.push({ id: r.id, file, url: '/share/' + this.pendingToken }); // PC-05: in this answer only
    }
    this.commit(next);
    const before = this.documents.length; this.scan();
    return { counts, links, missing, held, adopted: this.documents.length - before };
  }
}
