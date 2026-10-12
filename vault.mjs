// The Vault (1.39): credentials agents use without seeing. One encrypted file in the data directory
// (<data dir>/vault.enc, AES-256-GCM over the whole store under POCKET_VAULT_KEY) holds every item, its
// policy and the commands the owner has approved for it; nothing about the store is readable on disk
// without the key. The daemon decrypts it into memory at boot. Agents never receive a value: `pocket-vault
// run` sends the daemon a command and the variables to bind, the daemon spawns the child itself with the
// values in its environment, and the output comes back with every value scrubbed. Every release of a value,
// every request and answer, and every owner view is appended to vault-audit.jsonl, which never holds a value.
// Design: docs/plans/1.39.0-vault.md.
import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';

export const KINDS = { api_key: ['value'], token: ['value'], login: ['username', 'password'], note: ['text'] };
export const POLICIES = ['ask', 'auto', 'owner'];
export const ACTIONS = ['add', 'update', 'remove', 'restore', 'recipe-remove', 'answer'];
export const LIMITS = { items: 500, name: 64, url: 500, notes: 2000, tags: 20, tag: 40, value: 64 * 1024, argv: 200, arg: 4096, cwd: 1024, env: 32,
  output: 1 << 20, timeoutMax: 3600, timeoutDefault: 600, waitMax: 300, requestTtlMs: 15 * 60_000, trashDays: 30, recipes: 50, auditRows: 200, concurrent: 8 };
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ENV_RE = /^[A-Z_][A-Z0-9_]{0,63}$/;
const SESSION_RE = /^(cx:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const shortId = () => randomBytes(6).toString('hex');
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const POLICY_WORDS = { ask: 'Agents ask', auto: 'Agents may use', owner: 'Only you' };

// ---------- the key and the file format ----------
// POCKET_VAULT_KEY is 32 random bytes, base64 (`openssl rand -base64 32`).
export function parseKey(raw) {
  const s = String(raw || '').trim().replace(/^(["'])(.*)\1$/, '$2');
  if (!s) throw new Error('POCKET_VAULT_KEY is not set.');
  let b; try { b = Buffer.from(s, 'base64'); } catch { b = Buffer.alloc(0); }
  if (b.length !== 32) throw new Error('POCKET_VAULT_KEY must be 32 random bytes, base64 (openssl rand -base64 32).');
  return b;
}
export const newKey = () => randomBytes(32).toString('base64');
const FORMAT = 1;
// [version 1][iv 12][tag 16][ciphertext]; the version byte is the associated data, so a record cannot be replayed under another format.
export function encryptStore(key, data) {
  const iv = randomBytes(12), aad = Buffer.from([FORMAT]);
  const c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(aad);
  const body = Buffer.concat([c.update(Buffer.from(JSON.stringify(data), 'utf8')), c.final()]);
  return Buffer.concat([aad, iv, c.getAuthTag(), body]);
}
export function decryptStore(keys, buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 29 || buf[0] !== FORMAT) throw new Error('The vault file is not in a known format.');
  const iv = buf.subarray(1, 13), tag = buf.subarray(13, 29), body = buf.subarray(29);
  for (const key of keys) {
    try {
      const d = createDecipheriv('aes-256-gcm', key, iv); d.setAAD(buf.subarray(0, 1)); d.setAuthTag(tag);
      return JSON.parse(Buffer.concat([d.update(body), d.final()]).toString('utf8'));
    } catch { /* next key */ }
  }
  throw new Error('The vault cannot be opened with this key.');
}

// ---------- what agents are told ----------
export function vaultInstructions(cli, sessionId) {
  return [
    'This Pocket Code keeps a Vault of credentials (API keys, tokens, logins) that agents use by name and never see.',
    `Run commands that need one with \`node ${cli} run --env VAR=<name>[.field] -- <command…>\`: Pocket runs the command with the value in that variable and returns the output with the value scrubbed. Values never appear in arguments, output, files, messages or your context; never print, echo, write down or ask for one.`,
    'If the command answers `pending <id>`, the owner is being asked to allow it: say so and continue with `wait <id>` when told. If it is refused, say so and stop; do not look for another way to the value.',
    `When you meet a secret in a file, a result or a message, store it at once with \`node ${cli} put <name> --kind <api_key|token|login|note> --stdin\` (or --from-file), tell the owner it was seen, and use the name from then on. \`list\` shows what exists. A \`{{vault:name}}\` in a message is the owner handing you a stored secret by name.`,
    `The pocket-vault skill (\`${path.join(path.dirname(cli), '..', 'skills', 'pocket-vault', 'SKILL.md')}\`) has the procedure.${sessionId ? '' : ' Pass --cwd when the command depends on the working directory.'}`,
  ].join(' ');
}

// ---------- the store ----------
export class VaultStore {
  // `key` opens the file; `oldKeys` are retired keys still accepted while a rotation is pending a restart.
  constructor(file, { key, oldKeys = [], auditFile, now, write, log = () => {} } = {}) {
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('A 32-byte key is required.');
    this.file = file; this.keys = [key, ...oldKeys]; this.auditFile = auditFile || path.join(path.dirname(file), 'vault-audit.jsonl');
    this.now = now || Date.now; this.log = log;
    this.write = write || ((f, buf) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = f + '.tmp'; fs.writeFileSync(tmp, buf, { mode: 0o600 }); fs.renameSync(tmp, f); });
    this.requests = new Map(); // id -> request (pending ones live in memory only; they expire in minutes)
    this.running = 0;
    let data = { version: 1, items: [] };
    if (fs.existsSync(file)) data = decryptStore(this.keys, fs.readFileSync(file)); // throws: the daemon reports "cannot be opened" and serves nothing
    this.items = (Array.isArray(data.items) ? data.items : []).filter(i => i && typeof i.id === 'string' && NAME_RE.test(i.name || '')).map(i => this.normalize(i));
  }
  normalize(i) {
    const kind = KINDS[i.kind] ? i.kind : 'note';
    const values = {}; for (const f of KINDS[kind]) values[f] = typeof i.values?.[f] === 'string' ? i.values[f] : '';
    return { ...i, kind, values, url: str(i.url, LIMITS.url), notes: str(i.notes, LIMITS.notes), tags: Array.isArray(i.tags) ? i.tags.map(t => str(t, LIMITS.tag)).filter(Boolean).slice(0, LIMITS.tags) : [],
      policy: POLICIES.includes(i.policy) ? i.policy : 'ask', recipes: Array.isArray(i.recipes) ? i.recipes.filter(r => r && Array.isArray(r.argv)).slice(0, LIMITS.recipes) : [],
      expiresAt: i.expiresAt && !Number.isNaN(Date.parse(i.expiresAt)) ? i.expiresAt : null, lastUsedAt: i.lastUsedAt || null, lastUsedBy: i.lastUsedBy || null,
      trashedAt: i.trashedAt || null, revision: Number.isInteger(i.revision) && i.revision > 0 ? i.revision : 1 };
  }
  save() { this.write(this.file, encryptStore(this.keys[0], { version: 1, savedAt: iso(this.now()), items: this.items })); }
  // Rotation: the store is rewritten under the new key; the old one stays accepted until the daemon restarts with the new .env.
  rotate(newKeyRaw) { const k = parseKey(newKeyRaw); this.keys = [k, ...this.keys]; this.save(); return k; }

  // The audit row is written before the action is final; if it cannot be written the action fails (no unrecorded release).
  audit(record) {
    const row = { at: iso(this.now()), ...record };
    for (const k of ['argv', 'cwd', 'decision', 'session', 'sessionTitle', 'request', 'name', 'item', 'by', 'action']) if (row[k] === undefined || row[k] === null || row[k] === '') delete row[k];
    const fd = fs.openSync(this.auditFile, 'a', 0o600);
    try { fs.writeSync(fd, JSON.stringify(row) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  // The newest rows, newest first. Owners see everything; an agent sees only its own session's rows.
  auditRows({ item, session, owner = false, limit = 50 } = {}) {
    let text = ''; try { text = fs.readFileSync(this.auditFile, 'utf8'); } catch { return []; }
    const rows = [];
    for (const line of text.trim().split('\n').reverse()) {
      if (!line) continue; let r; try { r = JSON.parse(line); } catch { continue; }
      if (item && r.item !== item) continue;
      if (!owner && (!session || r.session !== session)) continue;
      rows.push(r); if (rows.length >= Math.min(limit, LIMITS.auditRows)) break;
    }
    return rows;
  }

  get(id) { const i = this.items.find(x => x.id === id); if (!i) throw fail('That item does not exist.', 404); return i; }
  byName(name) { return this.items.find(x => x.name === name && !x.trashedAt) || null; }
  // The item as the UI and CLI see it: never a value; notes only for the owner.
  view(i, { owner = false, now = this.now() } = {}) {
    const { values, notes, ...rest } = i;
    return { ...rest, fields: KINDS[i.kind], policyWord: POLICY_WORDS[i.policy], ...(owner ? { notes } : {}), expiring: Boolean(i.expiresAt) && Date.parse(i.expiresAt) - now < 14 * 86400_000 };
  }
  requestView(r) { const { env, waiters, ...rest } = r; return { ...rest, pending: !r.answer }; }
  snapshot({ owner = false, now = this.now() } = {}) {
    this.expireRequests(now);
    const live = this.items.filter(i => !i.trashedAt).sort((a, b) => a.name.localeCompare(b.name)).map(i => this.view(i, { owner, now }));
    const trash = owner ? this.items.filter(i => i.trashedAt).sort((a, b) => Date.parse(b.trashedAt) - Date.parse(a.trashedAt)).map(i => this.view(i, { owner, now })) : [];
    const requests = [...this.requests.values()].filter(r => !r.answer).map(r => this.requestView(r));
    return { version: 1, now, ready: true, items: live, trash, requests, openRequests: requests.length };
  }
  touch(i) { i.updated = iso(this.now()); i.revision += 1; }

  // Every change goes through here. Agents may only add (create-only); everything else is the owner's.
  act(input, { actor = 'owner', session = null, sessionTitle = '' } = {}) {
    const action = str(input?.action, 40);
    if (!ACTIONS.includes(action)) throw fail('Unknown action.');
    const owner = actor === 'owner', by = owner ? 'owner' : actor === 'agent' ? 'agent' : 'terminal';
    const at = iso(this.now());
    if (action === 'add') {
      const name = str(input.name, LIMITS.name + 1).toLowerCase();
      if (!NAME_RE.test(name)) throw fail('The name must be 1 to 64 characters: lower-case letters, digits and hyphens.');
      if (this.items.some(i => i.name === name)) throw fail(owner ? 'An item with that name already exists.' : `An item named ${name} already exists; agents cannot replace it. Use another name or ask the owner.`, 409);
      const kind = str(input.kind, 20); if (!KINDS[kind]) throw fail('The kind must be api_key, token, login or note.');
      if (this.items.length >= LIMITS.items) throw fail(`You can keep up to ${LIMITS.items} items.`, 409);
      const values = this.checkValues(kind, input.values, { all: true });
      const item = { id: shortId(), name, kind, values, url: str(input.url, LIMITS.url), notes: owner ? str(input.notes, LIMITS.notes) : '', tags: this.checkTags(input.tags),
        policy: owner && POLICIES.includes(input.policy) ? input.policy : 'ask', recipes: [], expiresAt: this.checkWhen(input.expiresAt),
        created: at, updated: at, by, lastUsedAt: null, lastUsedBy: null, trashedAt: null, revision: 1 };
      this.audit({ action: 'put', item: item.id, name, by, session, sessionTitle });
      this.items.push(item); this.save();
      return this.view(item, { owner });
    }
    if (action === 'answer') {
      if (!owner) throw fail('Only the owner answers requests.', 403);
      return this.answer(str(input.request, 40), str(input.decision, 10));
    }
    if (!owner) throw fail('Agents cannot change items. Ask the owner.', 403);
    const i = this.get(str(input.item, 40));
    if (input.expected_revision != null && Number(input.expected_revision) !== i.revision) throw fail('This item changed since you loaded it. Review it and try again.', 409, { item: this.view(i, { owner }) });
    if (action === 'remove') { if (i.trashedAt) throw fail('Already removed.'); i.trashedAt = at; this.touch(i); this.audit({ action: 'remove', item: i.id, name: i.name, by }); this.save(); return { ...this.view(i, { owner }), removed: true }; }
    if (action === 'restore') {
      if (!i.trashedAt) throw fail('This item is not removed.');
      if (this.items.some(x => x !== i && x.name === i.name && !x.trashedAt)) throw fail('Another item now has that name. Rename it first.', 409);
      i.trashedAt = null; this.touch(i); this.audit({ action: 'restore', item: i.id, name: i.name, by }); this.save(); return this.view(i, { owner });
    }
    if (action === 'recipe-remove') {
      const id = str(input.recipe, 40); if (!i.recipes.some(r => r.id === id)) throw fail('That approved command does not exist.', 404);
      i.recipes = i.recipes.filter(r => r.id !== id); this.touch(i); this.audit({ action: 'update', item: i.id, name: i.name, by, decision: 'recipe-removed' }); this.save(); return this.view(i, { owner });
    }
    let changed = false;
    if ('name' in input) { const name = str(input.name, LIMITS.name + 1).toLowerCase(); if (!NAME_RE.test(name)) throw fail('The name must be 1 to 64 characters: lower-case letters, digits and hyphens.'); if (this.items.some(x => x !== i && x.name === name)) throw fail('An item with that name already exists.', 409); i.name = name; changed = true; }
    if (input.values && typeof input.values === 'object') { const v = this.checkValues(i.kind, input.values, { all: false }); for (const [f, val] of Object.entries(v)) if (val !== '') { i.values[f] = val; changed = true; } }
    if ('url' in input) { i.url = str(input.url, LIMITS.url); changed = true; }
    if ('notes' in input) { i.notes = str(input.notes, LIMITS.notes); changed = true; }
    if ('tags' in input) { i.tags = this.checkTags(input.tags); changed = true; }
    if ('policy' in input) { if (!POLICIES.includes(input.policy)) throw fail('The policy must be ask, auto or owner.'); i.policy = input.policy; changed = true; }
    if ('expiresAt' in input) { i.expiresAt = this.checkWhen(input.expiresAt); changed = true; }
    if (!changed) throw fail('Nothing to change.');
    this.touch(i); this.audit({ action: 'update', item: i.id, name: i.name, by }); this.save();
    return this.view(i, { owner });
  }
  checkValues(kind, values, { all }) {
    const out = {};
    for (const f of KINDS[kind]) {
      const v = typeof values?.[f] === 'string' ? values[f] : '';
      if (v.length > LIMITS.value) throw fail(`The ${f} is too long.`);
      if (all && !v.trim()) throw fail(`The ${f} is required.`);
      if (/\{\{vault:[a-z0-9-]+\}\}/.test(v)) throw fail(`The ${f} looks like a placeholder, not a value.`);
      out[f] = v;
    }
    return out;
  }
  checkTags(tags) { const list = Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(',') : []; return [...new Set(list.map(t => str(t, LIMITS.tag).toLowerCase()).filter(Boolean))].slice(0, LIMITS.tags); }
  checkWhen(v) { if (!v) return null; const t = Date.parse(v); if (Number.isNaN(t)) throw fail('The expiry must be a date.'); return iso(t); }

  // The owner reads one field at a time; each read is recorded.
  field(id, field) {
    const i = this.get(id);
    if (!KINDS[i.kind].includes(field)) throw fail('That field does not exist.', 404);
    this.audit({ action: 'owner-view', item: i.id, name: i.name, by: 'owner', decision: field });
    return i.values[field];
  }

  // ---------- runs ----------
  // Bindings: { VAR: 'name' | 'name.field' } → the items and the field each variable needs. Nothing is released here.
  resolveBindings(env) {
    if (!env || typeof env !== 'object') throw fail('Nothing to bind: give at least one --env VAR=name.');
    const entries = Object.entries(env); if (!entries.length) throw fail('Nothing to bind: give at least one --env VAR=name.');
    if (entries.length > LIMITS.env) throw fail('Too many variables.');
    const bound = [];
    for (const [v, ref] of entries) {
      if (!ENV_RE.test(v)) throw fail(`${v} is not a variable name.`);
      if (/^POCKET_|^PATH$|^HOME$|^LD_|^NODE_OPTIONS$/.test(v)) throw fail(`${v} cannot be bound.`);
      const m = /^([a-z0-9-]+)(?:\.([a-z]+))?$/.exec(String(ref || '')); if (!m) throw fail(`${ref} is not an item name.`);
      const item = this.byName(m[1]); if (!item) throw fail(`There is no item named ${m[1]}. \`list\` shows what exists.`, 404);
      const fields = KINDS[item.kind];
      const field = m[2] || (fields.length === 1 ? fields[0] : null);
      if (!field) throw fail(`${item.name} has the fields ${fields.join(' and ')}; name one, for example ${item.name}.${fields[0]}.`);
      if (!fields.includes(field)) throw fail(`${item.name} has no field ${field}.`);
      bound.push({ v, item, field });
    }
    return bound;
  }
  checkCommand(argv, cwd) {
    if (!Array.isArray(argv) || !argv.length || argv.length > LIMITS.argv || argv.some(a => typeof a !== 'string' || a.length > LIMITS.arg)) throw fail('Give the command after --.');
    if (!argv[0].trim()) throw fail('Give the command after --.');
    const dir = str(cwd, LIMITS.cwd);
    if (!dir || !path.isAbsolute(dir)) throw fail('The working directory must be a full path.');
    let st; try { st = fs.statSync(dir); } catch { throw fail('The working directory does not exist.'); }
    if (!st.isDirectory()) throw fail('The working directory is not a directory.');
    return { argv: argv.map(String), cwd: path.normalize(dir).replace(/\/+$/, '') || '/' };
  }
  static sameCommand(a, b) { return a.cwd === b.cwd && a.argv.length === b.argv.length && a.argv.every((x, k) => x === b.argv[k]); }
  // What the policies say about running this command with these items: 'run', or 'ask' with the items that need the owner's word.
  decide(bound, cmd) {
    const need = [];
    for (const { item } of new Map(bound.map(b => [b.item.id, b])).values()) {
      if (item.policy === 'owner') throw fail(`${item.name} is for the owner only; agents cannot use it. Ask the owner to change its policy.`, 403, { code: 'owner_only' });
      if (item.policy === 'ask' && !item.recipes.some(r => VaultStore.sameCommand(r, cmd))) need.push(item);
    }
    return need;
  }
  // A request for the owner: one per command, naming every item that needs approval.
  request({ bound, cmd, need, env, session = null, sessionTitle = '', by = 'agent' }) {
    this.expireRequests();
    const now = this.now();
    const r = { id: shortId(), items: need.map(i => i.id), itemNames: need.map(i => i.name), argv: cmd.argv, cwd: cmd.cwd, env, session, sessionTitle, by, created: iso(now), expiresAt: iso(now + LIMITS.requestTtlMs), answer: null, consumed: false, waiters: [] };
    this.audit({ action: 'request', request: r.id, item: need[0].id, name: need.map(i => i.name).join(','), by, session, sessionTitle, argv: cmd.argv, cwd: cmd.cwd });
    this.requests.set(r.id, r);
    return r;
  }
  answer(id, decision) {
    const r = this.requests.get(id); if (!r) throw fail('That request does not exist or has expired.', 404);
    if (r.answer) throw fail('That request was already answered.', 409);
    if (!['once', 'always', 'deny'].includes(decision)) throw fail('Answer once, always or deny.');
    r.answer = { decision, at: iso(this.now()) };
    if (decision === 'always') {
      for (const id of r.items) { const i = this.items.find(x => x.id === id); if (!i || i.trashedAt) continue; if (!i.recipes.some(x => VaultStore.sameCommand(x, r))) { i.recipes.push({ id: shortId(), argv: r.argv, cwd: r.cwd, created: r.answer.at }); if (i.recipes.length > LIMITS.recipes) i.recipes.shift(); this.touch(i); } }
      this.save();
    }
    this.audit({ action: 'request-answered', request: r.id, item: r.items[0], name: r.itemNames.join(','), by: 'owner', decision, session: r.session, sessionTitle: r.sessionTitle, argv: r.argv, cwd: r.cwd });
    for (const w of r.waiters.splice(0)) w(r);
    return this.requestView(r);
  }
  // Resolves with the request once answered, or null when `ms` pass first.
  waitAnswer(id, ms) {
    const r = this.requests.get(id); if (!r) throw fail('That request does not exist or has expired.', 404);
    if (r.answer) return Promise.resolve(r);
    return new Promise(resolve => { const t = setTimeout(() => { r.waiters = r.waiters.filter(w => w !== done); resolve(null); }, ms); const done = () => { clearTimeout(t); resolve(r); }; r.waiters.push(done); });
  }
  expireRequests(now = this.now()) {
    for (const [id, r] of this.requests) if (Date.parse(r.expiresAt) <= now || (r.answer && Date.parse(r.answer.at) + LIMITS.requestTtlMs <= now)) { if (!r.answer) { r.answer = { decision: 'expired', at: iso(now) }; for (const w of r.waiters.splice(0)) w(r); } this.requests.delete(id); }
  }
  // Values for a run that policy allows; recorded first. Returns the secrets to bind and the scrub list.
  release(bound, cmd, { session = null, sessionTitle = '', by = 'agent', request = null } = {}) {
    const items = [...new Map(bound.map(b => [b.item.id, b.item])).values()];
    for (const item of items) this.audit({ action: 'run', item: item.id, name: item.name, by, session, sessionTitle, argv: cmd.argv, cwd: cmd.cwd, request });
    const at = iso(this.now());
    for (const item of items) { item.lastUsedAt = at; item.lastUsedBy = { session, sessionTitle, kind: by }; }
    this.save();
    const secrets = {}; for (const b of bound) secrets[b.v] = b.item.values[b.field];
    return secrets;
  }
  // Removed items are purged after 30 days.
  purge(now = this.now()) {
    const gone = this.items.filter(i => i.trashedAt && Date.parse(i.trashedAt) + LIMITS.trashDays * 86400_000 <= now);
    if (gone.length) { this.items = this.items.filter(i => !gone.includes(i)); this.save(); }
    this.expireRequests(now);
    return gone.map(i => i.name);
  }
}

// ---------- scrubbing ----------
// Every form a value is likely to take in a program's output: as typed, base64, base64url, URL-encoded, JSON-escaped.
export function needlesFor(values) {
  const out = new Set();
  for (const v of values) {
    if (typeof v !== 'string' || v.length < 4) continue; // a 1–3 character value would shred the output; it is not a secret anyone can keep
    out.add(v);
    out.add(Buffer.from(v, 'utf8').toString('base64')); out.add(Buffer.from(v, 'utf8').toString('base64url'));
    try { const e = encodeURIComponent(v); if (e !== v) out.add(e); } catch { }
    const j = JSON.stringify(v).slice(1, -1); if (j !== v) out.add(j);
  }
  return [...out].filter(Boolean).sort((a, b) => b.length - a.length);
}
// A streaming replacer: text arrives in chunks; the tail of each chunk (one less than the longest form) is held
// back until the next chunk or the end, and the cut is moved past any form that straddles it, so a value split
// across two chunks is still caught. `table` is [{forms, ph}] with the longest forms first.
export function makeScrubStream(table) {
  const forms = table.flatMap(p => p.forms), hold = Math.max(0, ...forms.map(f => f.length - 1));
  let carry = '';
  const rep = t => { for (const p of table) for (const f of p.forms) t = t.split(f).join(p.ph); return t; };
  return {
    push(chunk) {
      const t = carry + chunk; let cut = Math.max(0, t.length - hold), moved = true;
      while (moved) { moved = false; for (const f of forms) { let i = t.indexOf(f, Math.max(0, cut - f.length + 1)); while (i !== -1 && i < cut) { if (i + f.length > cut) { cut = i + f.length; moved = true; } i = t.indexOf(f, i + 1); } } }
      carry = t.slice(cut); return rep(t.slice(0, cut));
    },
    end() { const t = rep(carry); carry = ''; return t; },
  };
}
export function scrubber(values, placeholder = '{{vault}}') { return makeScrubStream([{ forms: needlesFor(values), ph: placeholder }]); }

// ---------- the run ----------
// Spawns the command with the secrets in its environment (never its arguments), no TTY, output piped through the
// scrubber and capped. `onOut`/`onErr` get scrubbed text as it arrives. Resolves when the child is gone.
export function runWithSecrets({ argv, cwd, env, secrets, placeholders, timeoutMs = LIMITS.timeoutDefault * 1000, maxOutput = LIMITS.output, onOut = () => {}, onErr = () => {}, signal }) {
  return new Promise(resolve => {
    // One replacer per stream: every form of every value becomes that value's own placeholder, longest values first.
    const table = Object.values(secrets).map(v => ({ forms: needlesFor([v]), ph: placeholders?.[v] ? `{{vault:${placeholders[v]}}}` : '{{vault}}' })).filter(p => p.forms.length).sort((a, b) => b.forms[0].length - a.forms[0].length);
    const out = makeScrubStream(table), err = makeScrubStream(table);
    let total = 0, truncated = false, done = false, timedOut = false, child;
    const finish = (code, signalName, error) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener?.('abort', abort); resolve({ code, signal: signalName, truncated, timedOut, error }); };
    const abort = () => { if (child && child.exitCode === null) { try { child.kill('SIGTERM'); } catch { } setTimeout(() => { try { child.kill('SIGKILL'); } catch { } }, 5000).unref(); } };
    const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
    signal?.addEventListener?.('abort', abort);
    try { child = spawn(argv[0], argv.slice(1), { cwd, env: { ...env, ...secrets }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
    catch (e) { return finish(null, null, e.message); }
    child.on('error', e => finish(null, null, e.message));
    const emit = (fn, text) => { if (!text) return; total += text.length; if (total > maxOutput) { if (!truncated) { truncated = true; fn(text.slice(0, Math.max(0, text.length - (total - maxOutput)))); abort(); } return; } fn(text); };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', c => emit(onOut, out.push(c))); child.stderr.on('data', c => emit(onErr, err.push(c)));
    child.on('close', (code, sig) => { emit(onOut, out.end()); emit(onErr, err.end()); finish(code, sig, null); });
  });
}
