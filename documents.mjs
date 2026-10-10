// Documents (1.30): the library of files that came out of the work. Files live in the documents folder
// (POCKET_DOCUMENTS_DIR, default <data dir>/documents); records live in <data dir>/documents.json, written
// atomically by the server alone. Files dropped straight into the folder are adopted as private records on
// the next listing; the scan only ever adds. Visibility is private (login), link (an unguessable signed URL,
// optional expiry, revocable) or public (/files/<name>, the path Mission Control's public links used).
// Removing a document moves it to .trash for 30 days, then purges it. HTML is served sandboxed, never under
// the app origin's authority.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

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
  if (kind === 'html' && text) { const m = text.slice(0, 20000).match(/<title[^>]*>([\s\S]*?)<\/title>/i); if (m) { const t = m[1].replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim(); if (t) return t.slice(0, LIMITS.title); } }
  if (kind === 'md' && text) { const m = text.slice(0, 20000).match(/^#{1,3}\s+(.+)$/m); if (m) return m[1].replace(/[*_`#]/g, '').trim().slice(0, LIMITS.title); }
  return path.basename(file, path.extname(file)).replace(/[_-]+/g, ' ').trim().slice(0, LIMITS.title) || file;
}
// One line for an agent's instructions when Documents is on.
export function documentInstructions(cli, sessionId) {
  const sid = sessionId ? ` --session ${sessionId}` : '';
  return `This Pocket Code keeps a My Files library. When you produce a deliverable for the user to read (an HTML report or dashboard, a PDF, an image, a Markdown write-up, a CSV), keep it with \`node ${cli} add <path>${sid} [--title "…"] [--project <id>]\` so it appears in Pocket's My Files, linked to this session; link it to the directory's tracked project when there is one. Files there are private unless the user asks to share; use \`node ${cli} share <id>\` for a link only when asked. Mention the file by title in your reply, not by server path.`;
}

export class DocumentStore {
  constructor(dir, metaFile, { write, now } = {}) {
    this.dir = dir; this.file = metaFile; this.now = now || Date.now;
    this.write = write || ((f, data) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 }); fs.renameSync(tmp, f); });
    fs.mkdirSync(dir, { recursive: true });
    let d = {}; try { d = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { }
    this.documents = Array.isArray(d.documents) ? d.documents.filter(r => r && typeof r.id === 'string' && typeof r.file === 'string') : [];
  }
  save() { this.write(this.file, { version: 1, documents: this.documents }); }
  get(id) { const r = this.documents.find(x => x.id === id); if (!r) throw fail('That file does not exist.', 404); return r; }
  trashDir() { return path.join(this.dir, '.trash'); }
  filePath(r) { return r.trashedAt ? path.join(this.trashDir(), r.id + '-' + r.file) : path.join(this.dir, r.file); }
  // The record as the UI and CLI see it: a share URL only for link/public, never the token hash.
  view(r) {
    const { shareHash, ...rest } = r;
    return { ...rest, share: r.share ? { expiresAt: r.share.expiresAt, url: r.share.url } : null, url: r.visibility === 'public' ? '/files/' + encodeURIComponent(r.file) : null, inline: INLINE_KINDS.has(r.kind) && (r.kind !== 'html' || r.size <= LIMITS.inlineHtml) };
  }
  uniqueFile(name, except = null) {
    let file = name, n = 2; const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
    while (this.documents.some(r => r.file === file && r.id !== except) || fs.existsSync(path.join(this.dir, file))) file = `${stem}-${n++}${ext}`;
    return file;
  }
  record(file, { title, project, session, visibility, addedBy, size, at }) {
    if (this.documents.length >= LIMITS.documents) throw fail(`My Files holds up to ${LIMITS.documents} files.`, 409);
    if (session && !SESSION_RE.test(session)) throw fail('That is not a session id.');
    if (visibility && !VISIBILITIES.includes(visibility)) throw fail('Visibility must be private, link or public.');
    const r = { id: randomBytes(6).toString('hex'), file, title: str(title, LIMITS.title) || titleFor(file, this.peek(path.join(this.dir, file))), kind: kindOf(file), size, added: at, addedBy, updated: at, session: session || null, project: str(project, 80) || null, visibility: visibility || 'private', share: null, shareHash: null, trashedAt: null };
    this.pendingToken = r.visibility === 'link' ? this.mintShare(r, null) : null;
    this.documents.push(r);
    return r;
  }
  peek(p) { try { return kindOf(p) === 'html' || kindOf(p) === 'md' ? fs.readFileSync(p, 'utf8').slice(0, 20000) : ''; } catch { return ''; } }
  // Files in the folder that have no record become private records (addedBy: folder). Missing files are flagged, never dropped.
  scan() {
    let changed = false;
    const known = new Set(this.documents.filter(r => !r.trashedAt).map(r => r.file));
    let names = []; try { names = fs.readdirSync(this.dir); } catch { }
    for (const name of names.sort()) {
      if (name.startsWith('.') || known.has(name) || !kindOf(name)) continue;
      if (this.documents.length >= LIMITS.documents) break;
      let st; try { st = fs.statSync(path.join(this.dir, name)); } catch { continue; }
      if (!st.isFile()) continue;
      this.record(name, { addedBy: 'folder', size: st.size, at: iso(st.mtimeMs) });
      changed = true;
    }
    for (const r of this.documents) { const missing = !fs.existsSync(this.filePath(r)); if (Boolean(r.missing) !== missing) { r.missing = missing || undefined; if (!missing) delete r.missing; changed = true; } }
    if (changed) this.save();
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
    const name = safeName(src); if (!name) throw fail('That file type cannot be kept in My Files.');
    const st = fs.statSync(src); if (!st.isFile()) throw fail('That is not a file.');
    const file = this.uniqueFile(name), at = iso(this.now());
    fs.copyFileSync(src, path.join(this.dir, file)); fs.chmodSync(path.join(this.dir, file), 0o600);
    const r = this.record(file, { ...opts, size: st.size, at }), token = this.pendingToken;
    this.save(); return { ...this.view(r), ...(token ? { token } : {}) };
  }
  addFromBuffer(name, buffer, opts = {}) {
    const safe = safeName(name); if (!safe) throw fail('That file type cannot be kept in My Files.');
    if (!buffer?.length) throw fail('The upload is empty.');
    const file = this.uniqueFile(safe), at = iso(this.now());
    fs.writeFileSync(path.join(this.dir, file), buffer, { mode: 0o600 });
    const r = this.record(file, { ...opts, size: buffer.length, at }), token = this.pendingToken;
    this.save(); return { ...this.view(r), ...(token ? { token } : {}) };
  }
  mintShare(r, expiresAt) {
    const token = randomBytes(32).toString('base64url');
    r.shareHash = hash(token); r.share = { expiresAt: expiresAt || null, url: '/share/' + token };
    return token;
  }
  update(id, input, { actor = 'ui' } = {}) {
    const r = this.get(id); if (r.trashedAt) throw fail('This file is in the trash. Restore it first.', 409);
    const at = iso(this.now()); let token = null;
    if ('title' in input) { const t = str(input.title, LIMITS.title); if (!t) throw fail('Give the file a title.'); r.title = t; }
    if ('project' in input) r.project = str(input.project, 80) || null;
    if ('session' in input) { const s = str(input.session, 64); if (s && !SESSION_RE.test(s)) throw fail('That is not a session id.'); r.session = s || null; }
    if ('expiresAt' in input) { const e = input.expiresAt ? Date.parse(input.expiresAt) : NaN; if (input.expiresAt && Number.isNaN(e)) throw fail('That expiry is not a valid time.'); if (r.share) r.share.expiresAt = input.expiresAt ? iso(e) : null; }
    if ('visibility' in input) {
      if (!VISIBILITIES.includes(input.visibility)) throw fail('Visibility must be private, link or public.');
      if (input.visibility !== r.visibility) {
        r.visibility = input.visibility;
        if (r.visibility === 'link') token = this.mintShare(r, input.expiresAt ? iso(Date.parse(input.expiresAt)) : null);
        else { r.share = null; r.shareHash = null; } // leaving link revokes the old URL
      }
    }
    if (input.action === 'reshare') { if (r.visibility !== 'link') throw fail('Only a file shared by link has a share link.'); token = this.mintShare(r, r.share?.expiresAt || null); }
    r.updated = at; r.updatedBy = actor; this.save();
    return { ...this.view(r), ...(token ? { token } : {}) };
  }
  trash(id) {
    const r = this.get(id); if (r.trashedAt) return this.view(r);
    fs.mkdirSync(this.trashDir(), { recursive: true });
    const from = path.join(this.dir, r.file), at = iso(this.now());
    r.trashedAt = at; r.updated = at;
    try { fs.renameSync(from, this.filePath(r)); } catch (e) { if (e.code !== 'ENOENT') { r.trashedAt = null; throw e; } }
    r.share = null; r.shareHash = null; r.visibility = 'private'; // a trashed document is reachable by nobody
    this.save(); return this.view(r);
  }
  restore(id) {
    const r = this.get(id); if (!r.trashedAt) return this.view(r);
    const from = this.filePath(r), file = this.uniqueFile(r.file, r.id);
    r.trashedAt = null; r.file = file; r.updated = iso(this.now());
    try { fs.renameSync(from, path.join(this.dir, file)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    this.save(); return this.view(r);
  }
  purge(now = this.now()) {
    const cutoff = now - LIMITS.trashDays * 86400000, gone = [];
    for (const r of this.documents) if (r.trashedAt && Date.parse(r.trashedAt) < cutoff) { try { fs.unlinkSync(this.filePath(r)); } catch { } gone.push(r.id); }
    if (gone.length) { this.documents = this.documents.filter(r => !gone.includes(r.id)); this.save(); }
    return gone;
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
  // One-time import of Mission Control's dashboard-files-meta.json ({ name: { visibility, access?, updated } }).
  // public → public; private + access techpro → link (tokens returned once); private → private. Files without a
  // record are adopted private by the scan. Names the metadata lists that are not in the folder are reported.
  importMeta(meta) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw fail('That is not a documents metadata file.');
    const at = iso(this.now()), links = [], missing = [], counts = { public: 0, link: 0, private: 0, skipped: 0 };
    for (const [name, m] of Object.entries(meta)) {
      if (!m || typeof m !== 'object') continue;
      const file = path.basename(name);
      if (this.documents.some(r => r.file === file)) { counts.skipped++; continue; }
      let st; try { st = fs.statSync(path.join(this.dir, file)); } catch { missing.push(file); continue; }
      if (!st.isFile() || !kindOf(file)) { missing.push(file); continue; }
      const visibility = m.visibility === 'public' ? 'public' : m.access === 'techpro' ? 'link' : 'private';
      const r = this.record(file, { addedBy: 'import', size: st.size, at: m.updated && !Number.isNaN(Date.parse(m.updated)) ? iso(Date.parse(m.updated)) : iso(st.mtimeMs), visibility });
      counts[visibility]++;
      if (visibility === 'link') links.push({ id: r.id, file, url: r.share.url });
    }
    this.save();
    const before = this.documents.length; this.scan();
    return { counts, links, missing, adopted: this.documents.length - before };
  }
}
