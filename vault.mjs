// The Vault (1.39): credentials agents use by name. One encrypted file in the data directory
// (<data dir>/vault.enc, AES-256-GCM over the whole store under POCKET_VAULT_KEY) holds every item, its
// policy and the commands the owner has approved for it; nothing about the store is readable on disk
// without the key. The daemon decrypts it into memory at boot. `pocket-vault run` sends the daemon a command
// and the variables to bind, the daemon spawns the child itself with the values in its environment, and the
// output comes back with every value scrubbed. That keeps values out of the conversation in normal use; it does
// not keep them from the command, or from an agent that asks for a browser fill (SECURITY.md, Vault). Every release of a value,
// every request and answer, and every owner view is appended to vault-audit.jsonl, which never holds a value.
// Design: docs/plans/1.39.0-vault.md.
import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { signalGroup } from './proctree.mjs';
import { shellArg } from './skills.mjs';
import { PIN_VERSION, pinDiff, pinView, withData } from './vault-pin.mjs';

// Fixed fields by kind; any item may carry custom fields beside them (1.39.1), and `credentials` has only custom ones.
export const KINDS = { api_key: ['value'], token: ['value'], login: ['username', 'password'], credentials: [], note: ['text'] };
export const FIELD_RE = /^[a-z][a-z0-9_]{0,31}$/;
// A stored secret named in text: {{vault:name}} or (1.43) {{vault:name.field}}.
export const PLACEHOLDER_RE = /\{\{vault:[a-z0-9-]+(?:\.[a-z][a-z0-9_]*)?\}\}/;
export const PLACEHOLDER_ALL = /\{\{vault:([a-z0-9-]+(?:\.[a-z][a-z0-9_]*)?)\}\}/g;
export const fieldNames = i => [...KINDS[i.kind], ...(i.custom || [])];
// 1.41: how freely agents may use secrets is a dial. The install-wide Agent access setting is free (no prompts), once
// (a new command is approved once, then remembered) or every (every use is approved); an item follows it ('default')
// or overrides it (auto = free rein, ask = once per command, every, owner = agents cannot use it).
export const POLICIES = ['default', 'auto', 'ask', 'every', 'owner'];
export const ACCESS = ['free', 'once', 'every'];
const ACCESS_POLICY = { free: 'auto', once: 'ask', every: 'every' };
const STORE_SCHEMA = 2; // 2 (1.41): 'default' exists; a version-1 store's 'ask' items are the old default and become 'default'
export const ACTIONS = ['add', 'update', 'remove', 'restore', 'recipe-remove', 'answer'];
export const LIMITS = { items: 500, name: 64, url: 500, notes: 2000, tags: 20, tag: 40, value: 64 * 1024, argv: 200, arg: 4096, cwd: 1024, env: 32,
  customFields: 20, output: 1 << 20, timeoutMax: 3600, timeoutDefault: 600, waitMax: 300, requestTtlMs: 15 * 60_000, trashDays: 30, recipes: 50, auditRows: 200, concurrent: 8 };
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ENV_RE = /^[A-Z_][A-Z0-9_]{0,63}$/;
// Variable names a value may not be bound to (PC-02 follow-up). An approved command's recipe records which variable gets
// which item and the card shows it, so a rerun under another name asks again; these names are refused outright because a
// program acts on them by itself, before or instead of anything the approved command does with the value: it loads, runs
// or parses the value as code, options or a command line (a part of the value then shows in an error the scrubber does not
// recognise), creates a file or folder named after it (an agent then sees the value as a name in a listing), or sends it to
// another computer. The second review showed node creating a folder named after the value from NODE_V8_COVERAGE.
//   Pocket's own and the run's: POCKET_*, PATH, HOME. The loader: LD_*, DYLD_*.
//   Interpreter start-up: NODE_* (NODE_OPTIONS, NODE_V8_COVERAGE, NODE_COMPILE_CACHE, NODE_REDIRECT_WARNINGS, …; not
//     NODE_AUTH_TOKEN, which node does not read and npm's setup convention uses for a registry token), NPM_CONFIG_* (npm
//     reads npm_config_* in any case: script-shell, userconfig, cache), PYTHON*, PERL*, RUBY*, the JVM's option variables.
//   Shells: BASH_ENV, ENV, IFS (splits words on the value's characters), PS0-PS9 (expanded on every traced line),
//     PROMPT_COMMAND, SHELLOPTS, BASHOPTS, ZDOTDIR, SHELL.
//   git: GIT_* (it runs programs from GIT_SSH_COMMAND, GIT_ASKPASS, GIT_EXTERNAL_DIFF, GIT_PAGER, GIT_EDITOR,
//     GIT_PROXY_COMMAND, takes any setting from GIT_CONFIG_*, writes traces to files named in GIT_TRACE*); GIT_TOKEN,
//     GIT_PASSWORD, GIT_USERNAME, GIT_CREDENTIALS and GIT_AUTH_TOKEN are not git's and stay allowed.
//   Programs started by name: PAGER, MANPAGER, EDITOR, VISUAL, BROWSER, LESS* (LESSOPEN runs a command), SSH_ASKPASS,
//     SUDO_ASKPASS, MAKEFLAGS, MFLAGS, MAKEFILES.
//   Folders and files a program creates: TMPDIR, TMP, TEMP, TEMPDIR, XDG_*, SSLKEYLOGFILE, HISTFILE, GNUPGHOME, DOCKER_CONFIG.
//   Sent along or echoed in part: LANG, LANGUAGE, LC_* (ssh sends them to the other computer by default), TZ.
// Ordinary credential names are not touched: GITHUB_TOKEN, GH_TOKEN, AWS_SECRET_ACCESS_KEY, NPM_TOKEN, PGPASSWORD,
// HTTPS_PROXY, SSH_KEY, SUDO_PW and the like (checked against the names agents on real installs bind). The list cannot
// name every variable every program reads; the card's variable line is what tells the owner the rest.
const REFUSED_ENV = new RegExp('^(?:' + ['POCKET_.*', 'PATH', 'HOME', 'LD_.*', 'DYLD_.*',
  'NODE_(?!AUTH_TOKEN$).*', 'NPM_CONFIG_.*', 'PYTHON.*', 'PERL.*', 'RUBY.*', 'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS',
  'BASH_ENV', 'ENV', 'IFS', 'PS[0-9]', 'PROMPT_COMMAND', 'SHELLOPTS', 'BASHOPTS', 'ZDOTDIR', 'SHELL',
  'GIT_(?!(?:TOKEN|PASSWORD|USERNAME|CREDENTIALS|AUTH_TOKEN)$).*',
  'PAGER', 'MANPAGER', 'EDITOR', 'VISUAL', 'BROWSER', 'LESS.*', 'SSH_ASKPASS', 'SUDO_ASKPASS', 'MAKEFLAGS', 'MFLAGS', 'MAKEFILES',
  'TMPDIR', 'TMP', 'TEMP', 'TEMPDIR', 'XDG_.*', 'SSLKEYLOGFILE', 'HISTFILE', 'GNUPGHOME', 'DOCKER_CONFIG',
  'LANG', 'LANGUAGE', 'LC_.*', 'TZ'].join('|') + ')$');
export const refusedVariable = v => REFUSED_ENV.test(String(v));
const SESSION_RE = /^(cx:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
// 1.81 (#177): notes past the limit are refused, not cut: the editor allowed 4,000 characters and the store kept 2,000 silently.
const notesIn = v => { const n = typeof v === 'string' ? v.trim() : ''; if (n.length > LIMITS.notes) throw fail(`Notes can be up to ${LIMITS.notes.toLocaleString('en-US')} characters.`); return n; };
const shortId = () => randomBytes(6).toString('hex');
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
// 1.110: intake links. The owner or an agent reserves a name and gets a one-time link; someone outside (a customer's IT
// contact) opens it, types the values into a plain page, and they land here as a new item under that name with the default
// policy. Only a hash of the link's token is kept, inside the encrypted store with the items, so a locked store cannot tell
// one link from another. A link works once, expires (72 hours by default, 7 days at most) and can be cancelled or replaced.
export const INTAKE_KINDS = ['login', 'api_key', 'token', 'credentials', 'note'];
export const INTAKE = { hoursDefault: 72, hoursMax: 168, hoursMin: 1, pending: 50, fields: 10, for: 120, from: 80, note: 300, keepDays: 30 };
export const INTAKE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const tokenHash = t => createHash('sha256').update(String(t)).digest('hex');
// What a field is called on the intake page and in its errors: the kind's own word for its one value, otherwise the field name in words.
export const INTAKE_LABEL = (f, kind) => f === 'value' ? (kind === 'token' ? 'token' : 'API key') : f === 'text' ? 'note' : f.replace(/_/g, ' ');
const POLICY_WORDS = { auto: 'Free rein', ask: 'Asks once per command', every: 'Asks every time', owner: 'Only you' };

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
// Two file formats, told apart by the first byte (which is also the associated data, so a record cannot be replayed
// under the other one). 1: [1][iv 12][tag 16][ciphertext], opened by the raw key from POCKET_VAULT_KEY.
// 2 (1.40, passphrase mode): [2][salt 16][iv 12][tag 16][ciphertext], opened by a key derived from the owner's
// passphrase with scrypt over the salt; the daemon holds that key in memory only, so a restart locks the store.
export const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
export const PASSPHRASE_MIN = 12;
export function deriveKey(passphrase, salt) {
  const pw = String(passphrase || ''); if (pw.length < PASSPHRASE_MIN) throw fail(`The passphrase must be at least ${PASSPHRASE_MIN} characters.`);
  return scryptSync(pw.normalize('NFKC'), salt, 32, SCRYPT);
}
export function storeHeader(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 29) throw new Error('The vault file is not in a known format.');
  if (buf[0] === 1) return { version: 1, salt: null, offset: 1 };
  if (buf[0] === 2 && buf.length >= 45) return { version: 2, salt: buf.subarray(1, 17), offset: 17 };
  throw new Error('The vault file is not in a known format.');
}
export function encryptStore(key, data, { salt = null } = {}) {
  const iv = randomBytes(12), aad = salt ? Buffer.concat([Buffer.from([2]), salt]) : Buffer.from([1]);
  const c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(aad);
  const body = Buffer.concat([c.update(Buffer.from(JSON.stringify(data), 'utf8')), c.final()]);
  return Buffer.concat([aad, iv, c.getAuthTag(), body]);
}
// `keys` are raw 32-byte keys (for format 2, already derived from the passphrase and the file's salt).
export function decryptStore(keys, buf) {
  const h = storeHeader(buf), o = h.offset;
  const iv = buf.subarray(o, o + 12), tag = buf.subarray(o + 12, o + 28), body = buf.subarray(o + 28);
  for (const key of keys) {
    try {
      const d = createDecipheriv('aes-256-gcm', key, iv); d.setAAD(buf.subarray(0, o)); d.setAuthTag(tag);
      return JSON.parse(Buffer.concat([d.update(body), d.final()]).toString('utf8'));
    } catch { /* next key */ }
  }
  throw new Error(h.version === 2 ? 'Wrong passphrase.' : 'The vault cannot be opened with this key.');
}
// An export is a format-2 file of its own under a passphrase the owner types for it: the same items, portable.
export const EXPORT_FORMAT = 'pocket-vault-export';

// ---------- what agents are told ----------
export function vaultInstructions(cli, sessionId) {
  // 1.82.1: the skill's path is built from the CLI's own path, then quoted on its own; built from the quoted CLI path it
  // carried a stray quote when the install path had a space.
  const skill = shellArg(path.join(path.dirname(String(cli)), '..', 'skills', 'pocket-vault', 'SKILL.md'));
  cli = shellArg(cli); // 1.73.8: one shell word even with a space in the install path
  return [
    'This Pocket Code keeps a Vault of credentials (API keys, tokens, logins) that agents use by name, without looking at the values.',
    `Run commands that need one with \`node ${cli} run --env VAR=<name>[.field] -- <command…>\`: Pocket runs the command with the value in that variable and returns the output with the value scrubbed. Keep values out of arguments, output, files, messages and your context; never print, echo, write down or ask for one.`,
    'If the command answers `pending <id>`, the owner is being asked to allow it (a push with Allow and Deny went to their devices): say so in one line and end your reply offering "Allow <name> for this command" and "Deny <name>" as the choices; the owner answering either way, by the notification, the Vault view or that reply, settles the request, and you then continue with `wait <id>`. If it is refused, say so and stop; do not look for another way to the value.',
    'To type a stored value into a web page with the Playwright browser tools (a login form, say), put `{{vault:<name>.<field>}}` as the text to type or fill; Pocket fills in the real value on the way to the browser and removes it from what comes back. Never read a filled value back out of the page. Values go into typing and form-filling tools only, and once one has been typed, screenshots and other pictures from that browser are unavailable for the rest of the session (a value cannot be scrubbed out of a picture): use text snapshots.',
    `When you meet a secret in a file, a result or a message, store it at once with \`node ${cli} put <name> --kind <api_key|token|login|credentials|note> --stdin\` (or --from-file), tell the owner it was seen, and use the name from then on. \`list\` shows what exists. When someone outside (a customer, a vendor) has a credential the work needs, never ask for it by email, chat or phone: make a one-time link with \`node ${cli} request <name> --kind login --for "<who>" --note "<what it is>"\` and send that. A \`{{vault:name}}\` in a message is the owner handing you a stored secret by name.`,
    `The pocket-vault skill (\`${skill}\`) has the procedure.${sessionId ? '' : ' Pass --cwd when the command depends on the working directory.'}`,
  ].join(' ');
}

// ---------- the store ----------
export class VaultStore {
  // `key` (from POCKET_VAULT_KEY) opens a format-1 file; `oldKeys` are retired keys still accepted while a rotation is
  // pending a restart. A format-2 file (passphrase mode) starts LOCKED: nothing is decrypted until unlock(passphrase).
  constructor(file, { key = null, oldKeys = [], auditFile, now, write, log = () => {} } = {}) {
    if (key != null && (!Buffer.isBuffer(key) || key.length !== 32)) throw new Error('A 32-byte key is required.');
    this.file = file; this.envKey = key; this.keys = key ? [key, ...oldKeys] : []; this.salt = null; this.openedWith = null;
    this.auditFile = auditFile || path.join(path.dirname(file), 'vault-audit.jsonl');
    this.now = now || Date.now; this.log = log;
    // 1.73.6: the one file whose loss is every secret at once is synced before and after the rename (the other stores keep tmp+rename alone).
    this.write = write || ((f, buf) => {
      fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = f + '.tmp';
      const fd = fs.openSync(tmp, 'w', 0o600); try { fs.writeSync(fd, buf); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, f);
      let dir = null; try { dir = fs.openSync(path.dirname(f), 'r'); fs.fsyncSync(dir); } catch { } finally { if (dir !== null) fs.closeSync(dir); }
    });
    this.requests = new Map(); // id -> request (pending ones live in memory only; they expire in minutes)
    this.running = 0; this.items = null; this.intakes = null; this.lastActivityAt = this.now();
    this.access = () => 'once'; // the server points this at the Agent access setting
    if (!fs.existsSync(file)) { if (!key) throw new Error('POCKET_VAULT_KEY is not set.'); this.items = []; this.intakes = []; return; }
    const buf = fs.readFileSync(file), h = storeHeader(buf);
    if (h.version === 2) { this.salt = Buffer.from(h.salt); return; } // locked until the owner unlocks it
    if (!key) throw new Error('POCKET_VAULT_KEY is not set.');
    // 1.76.3: the key that opened the store is remembered: when it is a previous key, a rotation stopped between its two
    // .env saves, and the daemon rolls .env back to it rather than carry a key the owner was never shown.
    let data = null; for (const k of this.keys) { try { data = decryptStore([k], buf); this.openedWith = k; break; } catch { } }
    if (!data) decryptStore(this.keys, buf); // throws: the daemon reports "cannot be opened" and serves nothing
    this.load(data);
  }
  load(data) { const legacy = !(data.version >= STORE_SCHEMA); this.intakes = (Array.isArray(data.intakes) ? data.intakes : []).filter(r => r && typeof r.id === 'string' && NAME_RE.test(r.name || '') && /^[0-9a-f]{64}$/.test(r.tokenHash || '')); this.items = (Array.isArray(data.items) ? data.items : []).filter(i => i && typeof i.id === 'string' && NAME_RE.test(i.name || '')).map(i => this.normalize(legacy && i.policy === 'ask' ? { ...i, policy: 'default' } : i)); this.lastActivityAt = this.now(); }
  get mode() { return this.salt ? 'passphrase' : 'key'; }
  get locked() { return this.items === null; }
  open() { if (this.locked) throw fail('The Vault is locked. Ask the owner to unlock it in Pocket Code.', 423, { code: 'vault_locked' }); this.lastActivityAt = this.now(); return this; }
  // Passphrase mode: unlock derives the key from the passphrase and the file's salt and decrypts; lock forgets both the
  // key and every item. Switching modes rewrites the file under the other key.
  unlock(passphrase) {
    if (!this.locked) return true;
    // 1.73.6: the salt comes from the file being opened, not from memory, so it is always the one the file was written with.
    const buf = fs.readFileSync(this.file), h = storeHeader(buf), salt = h.version === 2 ? Buffer.from(h.salt) : this.salt;
    const k = deriveKey(passphrase, salt);
    // 1.82.1: a failed audit write must not turn a wrong passphrase into a status-less error: the server would answer 500 and not
    // count the try toward the hourly limit. The failure is logged instead.
    let data; try { data = decryptStore([k], buf); } catch {
      try { this.audit({ action: 'unlock-failed', by: 'owner' }); } catch (e) { this.log(`vault: could not record a failed unlock: ${e.message}`); }
      throw fail('Wrong passphrase.', 401);
    }
    this.salt = salt; this.keys = [k]; this.load(data); this.audit({ action: 'unlock', by: 'owner' }); return true;
  }
  lock() {
    if (this.mode !== 'passphrase') throw fail('The Vault is opened by the server key; set a passphrase to be able to lock it.');
    if (this.locked) return;
    this.items = null; this.intakes = null; this.keys = [];
    // 1.73.3: a request still waiting is answered "locked" before its waiters wake, so no continuation meets an unanswered row.
    const at = iso(this.now());
    for (const r of this.requests.values()) { if (!r.answer) r.answer = { decision: 'locked', at }; for (const w of r.waiters.splice(0)) w(r); }
    this.requests.clear();
    this.audit({ action: 'lock', by: 'owner' });
  }
  setPassphrase(passphrase, confirm) {
    this.open();
    if (String(passphrase) !== String(confirm)) throw fail('The passphrases do not match.');
    const salt = randomBytes(16), k = deriveKey(passphrase, salt);
    this.save({ key: k, salt }); this.salt = salt; this.keys = [k]; // 1.73.6: the new material is taken up only once the file holds it
    this.audit({ action: 'passphrase-set', by: 'owner' });
  }
  checkPassphrase(passphrase) { if (this.mode !== 'passphrase') return false; try { decryptStore([deriveKey(passphrase, this.salt)], fs.readFileSync(this.file)); return true; } catch { return false; } }
  removePassphrase(passphrase) {
    this.open();
    if (this.mode !== 'passphrase') throw fail('The Vault is not protected by a passphrase.');
    if (!this.envKey) throw fail('POCKET_VAULT_KEY is not set, so the Vault cannot go back to the server key.', 409, { code: 'vault_no_key' });
    try { decryptStore([deriveKey(passphrase, this.salt)], fs.readFileSync(this.file)); } catch { throw fail('Wrong passphrase.', 401); }
    this.save({ key: this.envKey, salt: null }); this.salt = null; this.keys = [this.envKey]; this.audit({ action: 'passphrase-removed', by: 'owner' });
  }
  // Idle lock: the owner's setting, in minutes; 0 never.
  idleLockDue(minutes, now = this.now()) { return this.mode === 'passphrase' && !this.locked && minutes > 0 && now - this.lastActivityAt >= minutes * 60_000; }
  // 1.73.6: writes a state and changes nothing in memory: every change computes its next items (and key or salt) on a copy,
  // writes them, and installs them only once the file holds them, so a failed write leaves memory and disk agreeing.
  save({ items = this.items, intakes = this.intakes, key = this.keys[0], salt = this.salt } = {}) { this.open(); this.write(this.file, encryptStore(key, { version: STORE_SCHEMA, savedAt: iso(this.now()), items, intakes: intakes || [] }, { salt })); }
  // The live list with one item replaced by its edited copy (or removed when `next` is null).
  withItem(i, next) { return next ? this.items.map(x => x === i ? next : x) : this.items.filter(x => x !== i); }
  // Rotation (key mode): the store is rewritten under the new key; the old one stays accepted until the daemon restarts with the new .env.
  rotate(newKeyRaw) { this.open(); if (this.mode !== 'key') throw fail('Rotation applies to the server key; the Vault is protected by a passphrase.'); const k = parseKey(newKeyRaw); this.save({ key: k }); this.keys = [k, ...this.keys]; this.envKey = k; return k; }
  // Export: every item (values included) as a format-2 file under a passphrase of its own; import merges by name.
  exportBundle(passphrase, confirm) {
    this.open();
    if (String(passphrase) !== String(confirm)) throw fail('The passphrases do not match.');
    const salt = randomBytes(16), k = deriveKey(passphrase, salt);
    const items = this.items.filter(i => !i.trashedAt).map(({ lastUsedAt, lastUsedBy, trashedAt, ...i }) => i);
    this.audit({ action: 'export', by: 'owner', decision: String(items.length) });
    return encryptStore(k, { format: EXPORT_FORMAT, version: STORE_SCHEMA, exportedAt: iso(this.now()), items }, { salt });
  }
  importBundle(buf, passphrase) {
    this.open();
    let h; try { h = storeHeader(buf); } catch { throw fail('That is not a Vault export file.'); }
    if (h.version !== 2) throw fail('That is not a Vault export file.');
    let data; try { data = decryptStore([deriveKey(passphrase, h.salt)], buf); } catch (e) { throw fail(e.message === 'Wrong passphrase.' ? 'Wrong passphrase.' : 'That is not a Vault export file.'); }
    if (data?.format !== EXPORT_FORMAT || !Array.isArray(data.items)) throw fail('That is not a Vault export file.');
    const skipped = [], added = [], legacy = !(data.version >= STORE_SCHEMA), next = [...this.items];
    for (const raw of data.items) {
      if (!raw || typeof raw !== 'object') continue;
      const i = this.normalize({ ...raw, ...(legacy && raw.policy === 'ask' ? { policy: 'default' } : {}), id: shortId(), addedIn: undefined, lastUsedAt: null, lastUsedBy: null, trashedAt: null }); // 1.93: the conversation that added it belongs to the other install
      if (!NAME_RE.test(i.name || '')) continue;
      if (next.some(x => x.name === i.name) || this.pendingIntake(i.name)) { skipped.push(i.name); continue; }
      if (next.length >= LIMITS.items) throw fail(`You can keep up to ${LIMITS.items} items.`, 409);
      try { this.checkValues({ kind: i.kind, custom: [] }, i.values, { all: false }); } catch (e) { throw fail(`${i.name}: ${e.message}`); } // 1.73.6: an export is held to the same value rules
      i.created = i.created || iso(this.now()); i.updated = iso(this.now()); i.revision = 1;
      next.push(i); added.push(i.name);
    }
    this.audit({ action: 'import', by: 'owner', decision: `${added.length} added, ${skipped.length} skipped` });
    if (added.length) { this.save({ items: next }); this.items = next; }
    return { added: added.length, skipped };
  }
  normalize(i) {
    const kind = KINDS[i.kind] ? i.kind : 'note';
    const custom = [...new Set((Array.isArray(i.custom) ? i.custom : []).filter(f => typeof f === 'string' && FIELD_RE.test(f) && !KINDS[kind].includes(f)))].slice(0, LIMITS.customFields);
    const values = {}; for (const f of [...KINDS[kind], ...custom]) values[f] = typeof i.values?.[f] === 'string' ? i.values[f] : '';
    return { ...i, kind, custom, values, url: str(i.url, LIMITS.url), notes: str(i.notes, LIMITS.notes), tags: Array.isArray(i.tags) ? i.tags.map(t => str(t, LIMITS.tag)).filter(Boolean).slice(0, LIMITS.tags) : [],
      policy: POLICIES.includes(i.policy) ? i.policy : 'default', recipes: Array.isArray(i.recipes) ? i.recipes.filter(r => r && Array.isArray(r.argv)).slice(0, LIMITS.recipes) : [],
      expiresAt: i.expiresAt && !Number.isNaN(Date.parse(i.expiresAt)) ? i.expiresAt : null, lastUsedAt: i.lastUsedAt || null, lastUsedBy: i.lastUsedBy || null,
      trashedAt: i.trashedAt || null, revision: Number.isInteger(i.revision) && i.revision > 0 ? i.revision : 1 };
  }

  // The audit row is written before the action is final; if it cannot be written the action fails (no unrecorded release).
  audit(record) {
    const row = { at: iso(this.now()), ...record };
    for (const k of ['argv', 'cwd', 'decision', 'session', 'sessionTitle', 'request', 'name', 'item', 'by', 'action']) if (row[k] === undefined || row[k] === null || row[k] === '') delete row[k];
    const fd = fs.openSync(this.auditFile, 'a+', 0o600);
    // 1.73.8: a short write is continued, so a row is never left half-written for the next one to merge into.
    // 1.76.3: an append that failed part-way (a full disk, an I/O error) still leaves a torn row with no newline; the next row
    // starts on a line of its own, so the torn one is the only line lost.
    let lead = '';
    try { const { size } = fs.fstatSync(fd); if (size > 0) { const last = Buffer.alloc(1); fs.readSync(fd, last, 0, 1, size - 1); if (last[0] !== 0x0a) lead = '\n'; } } catch { }
    const buf = Buffer.from(lead + JSON.stringify(row) + '\n');
    try { for (let at = 0; at < buf.length;) { const n = fs.writeSync(fd, buf, at, buf.length - at); if (!(n > 0)) throw new Error('The Vault record could not be written.'); at += n; } fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
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

  get(id) { this.open(); const i = this.items.find(x => x.id === id); if (!i) throw fail('That item does not exist.', 404); return i; }
  byName(name) { this.open(); return this.items.find(x => x.name === name && !x.trashedAt) || null; }
  // The item as the UI and CLI see it: never a value; notes only for the owner.
  view(i, { owner = false, now = this.now() } = {}) {
    const { values, notes, ...rest } = i;
    const eff = this.effective(i);
    return { ...rest, fields: fieldNames(i), custom: i.custom, effectivePolicy: eff, policyWord: POLICY_WORDS[eff], ...(owner ? { notes } : {}), expiring: Boolean(i.expiresAt) && Date.parse(i.expiresAt) - now < 14 * 86400_000 };
  }
  // PC-02: the card gets the files a run is checked by (paths and roles, never hashes), what cannot be checked, and the
  // program a launcher starts.
  // Second review: and each variable with the item (and field) it gets; `was`, when the command was allowed always with
  // other variables.
  requestView(r) {
    const { env, waiters, caller, bindings, pin, was, ...rest } = r;
    const vars = list => (list || []).map(b => ({ v: b.v, name: b.name, field: b.field }));
    return { ...rest, ...(r.action === 'run' ? { ...pinView(pin), variables: vars(bindings), ...(was ? { was: vars(was) } : {}) } : {}), pending: !r.answer, allowAlways: r.allowAlways !== false };
  }
  // The policy that applies to an item now: its own, or the Agent access setting's when it follows the default.
  effective(i) { if (i.policy !== 'default') return i.policy; const a = this.access(); return ACCESS_POLICY[ACCESS.includes(a) ? a : 'once']; }
  snapshot({ owner = false, now = this.now() } = {}) {
    this.open();
    this.expireRequests(now);
    const live = this.items.filter(i => !i.trashedAt).sort((a, b) => a.name.localeCompare(b.name)).map(i => this.view(i, { owner, now }));
    const trash = owner ? this.items.filter(i => i.trashedAt).sort((a, b) => Date.parse(b.trashedAt) - Date.parse(a.trashedAt)).map(i => this.view(i, { owner, now })) : [];
    const requests = [...this.requests.values()].filter(r => !r.answer).map(r => this.requestView(r));
    // 1.93: requests answered or expired in the last 15 minutes, as id, answer and time only, so a link to one (a notification
    // tapped late, an Allow that did not go through) can say what happened to it instead of finding nothing.
    const answered = owner ? [...this.requests.values()].filter(r => r.answer).map(r => ({ id: r.id, itemNames: r.itemNames, decision: r.answer.decision, at: r.answer.at })) : [];
    return { version: 1, now, ready: true, access: ACCESS.includes(this.access()) ? this.access() : 'once', items: live, trash, requests, answered, openRequests: requests.length, intakes: this.intakeViews(now) };
  }
  touch(i) { i.updated = iso(this.now()); i.revision += 1; }

  // Every change goes through here. Agents may only add (create-only); everything else is the owner's.
  act(input, { actor = 'owner', session = null, sessionTitle = '' } = {}) {
    this.open();
    const action = str(input?.action, 40);
    if (!ACTIONS.includes(action)) throw fail('Unknown action.');
    const owner = actor === 'owner', by = owner ? 'owner' : actor === 'agent' ? 'agent' : 'terminal';
    const at = iso(this.now());
    if (action === 'add') {
      const name = str(input.name, LIMITS.name + 1).toLowerCase();
      if (!NAME_RE.test(name)) throw fail('The name must be 1 to 64 characters: lower-case letters, digits and hyphens.');
      if (this.items.some(i => i.name === name)) throw fail(owner ? 'An item with that name already exists.' : `An item named ${name} already exists; agents cannot replace it. Use another name or ask the owner.`, 409);
      if (this.pendingIntake(name)) throw fail(`${name} is reserved by an intake link that is waiting to be filled in. Use another name, or cancel the link first.`, 409, { code: 'intake_reserved' });
      const kind = str(input.kind, 20); if (!KINDS[kind]) throw fail('The kind must be api_key, token, login, credentials or note.');
      if (this.items.length >= LIMITS.items) throw fail(`You can keep up to ${LIMITS.items} items.`, 409);
      const { values, custom } = this.checkValues({ kind, custom: [] }, input.values, { all: true });
      const item = { id: shortId(), name, kind, custom, values, url: str(input.url, LIMITS.url), notes: owner ? notesIn(input.notes) : '', tags: this.checkTags(input.tags),
        policy: owner && POLICIES.includes(input.policy) ? input.policy : 'default', recipes: [], expiresAt: this.checkWhen(input.expiresAt),
        created: at, updated: at, by, ...(session ? { addedIn: { session: str(session, 80), sessionTitle: str(sessionTitle, 200) } } : {}), lastUsedAt: null, lastUsedBy: null, trashedAt: null, revision: 1 };
      this.audit({ action: 'put', item: item.id, name, by, session, sessionTitle });
      const next = [...this.items, item]; this.save({ items: next }); this.items = next;
      return this.view(item, { owner });
    }
    if (action === 'answer') {
      if (!owner) throw fail('Only the owner answers requests.', 403);
      return this.answer(str(input.request, 40), str(input.decision, 10), { data: input.data });
    }
    if (!owner) throw fail('Agents cannot change items. Ask the owner.', 403);
    const live = this.get(str(input.item, 40));
    if (input.expected_revision != null && Number(input.expected_revision) !== live.revision) throw fail('This item changed since you loaded it. Review it and try again.', 409, { item: this.view(live, { owner }) });
    // 1.73.6: the edit is made on a copy; the copy replaces the item only once the file holds it, so a check that fails
    // halfway (or a write that fails) leaves the item as it was.
    const i = structuredClone(live), commit = () => { const next = this.withItem(live, i); this.save({ items: next }); this.items = next; };
    if (action === 'remove') { if (i.trashedAt) throw fail('Already removed.'); i.trashedAt = at; this.touch(i); this.audit({ action: 'remove', item: i.id, name: i.name, by }); commit(); return { ...this.view(i, { owner }), removed: true }; }
    if (action === 'restore') {
      if (!i.trashedAt) throw fail('This item is not removed.');
      if (this.items.some(x => x !== live && x.name === i.name && !x.trashedAt)) throw fail('Another item now has that name. Rename it first.', 409);
      if (this.pendingIntake(i.name)) throw fail('An intake link waiting to be filled in has that name. Cancel it first.', 409, { code: 'intake_reserved' });
      i.trashedAt = null; this.touch(i); this.audit({ action: 'restore', item: i.id, name: i.name, by }); commit(); return this.view(i, { owner });
    }
    if (action === 'recipe-remove') {
      const id = str(input.recipe, 40); if (!i.recipes.some(r => r.id === id)) throw fail('That approved command does not exist.', 404);
      i.recipes = i.recipes.filter(r => r.id !== id); this.touch(i); this.audit({ action: 'update', item: i.id, name: i.name, by, decision: 'recipe-removed' }); commit(); return this.view(i, { owner });
    }
    let changed = false;
    const touched = []; // field names an edit changed, added or removed: recorded in the audit, never a value
    if ('name' in input) { const name = str(input.name, LIMITS.name + 1).toLowerCase(); if (!NAME_RE.test(name)) throw fail('The name must be 1 to 64 characters: lower-case letters, digits and hyphens.'); if (this.items.some(x => x !== live && x.name === name)) throw fail('An item with that name already exists.', 409); if (name !== live.name && this.pendingIntake(name)) throw fail(`${name} is reserved by an intake link that is waiting to be filled in.`, 409, { code: 'intake_reserved' }); i.name = name; changed = true; }
    if (Array.isArray(input.removeFields)) { // custom fields only; a fixed field cannot be dropped
      for (const f of input.removeFields.map(x => str(x, 40))) { if (!i.custom.includes(f)) throw fail(`${f} is not a custom field of this item.`); i.custom = i.custom.filter(x => x !== f); delete i.values[f]; touched.push(f); changed = true; }
    }
    if (input.values && typeof input.values === 'object') {
      const { values, custom } = this.checkValues(i, input.values, { all: false });
      for (const [f, val] of Object.entries(values)) if (val !== '') { if (val !== i.values[f]) touched.push(f); i.values[f] = val; changed = true; }
      for (const f of custom) if (!i.custom.includes(f)) { i.custom.push(f); changed = true; }
      if (i.custom.length > LIMITS.customFields) throw fail(`An item can have up to ${LIMITS.customFields} custom fields.`);
    }
    if ('url' in input) { i.url = str(input.url, LIMITS.url); changed = true; }
    if ('notes' in input) { i.notes = notesIn(input.notes); changed = true; }
    if ('tags' in input) { i.tags = this.checkTags(input.tags); changed = true; }
    if ('policy' in input) { if (!POLICIES.includes(input.policy)) throw fail('The policy must be default, auto, ask, every or owner.'); i.policy = input.policy; changed = true; }
    if ('expiresAt' in input) { i.expiresAt = this.checkWhen(input.expiresAt); changed = true; }
    if (!changed) throw fail('Nothing to change.');
    this.touch(i); this.audit({ action: 'update', item: i.id, name: i.name, by, ...(touched.length ? { fields: [...new Set(touched)] } : {}) }); commit();
    return this.view(i, { owner });
  }
  // Fixed fields are required on add; any other key is a custom field (named by the rule, not clashing with a fixed one).
  checkValues(item, values, { all }) {
    const fixed = KINDS[item.kind], out = {}, custom = [];
    const check = (f, v) => { if (v.length > LIMITS.value) throw fail(`The ${f} is too long.`); if (PLACEHOLDER_RE.test(v)) throw fail(`The ${f} looks like a placeholder, not a value.`); };
    for (const f of fixed) { const v = typeof values?.[f] === 'string' ? values[f] : ''; check(f, v); if (all && !v.trim()) throw fail(`The ${f} is required.`); out[f] = v; }
    for (const [f, raw] of Object.entries(values && typeof values === 'object' ? values : {})) {
      if (fixed.includes(f)) continue;
      if (!FIELD_RE.test(f)) throw fail(`${f} is not a field name: lowercase letters, digits and underscores, up to 32 characters, starting with a letter.`);
      const v = typeof raw === 'string' ? raw : ''; check(f, v);
      const exists = (item.custom || []).includes(f);
      if (!exists && !v.trim()) { if (all) throw fail(`The ${f} field needs a value.`); continue; } // a blank new field is ignored on edit
      out[f] = v; if (!exists) custom.push(f);
    }
    if (all && !fixed.length && !custom.length) throw fail('Give at least one field, for example client_id.');
    if ((item.custom || []).length + custom.length > LIMITS.customFields) throw fail(`An item can have up to ${LIMITS.customFields} custom fields.`);
    return { values: out, custom };
  }
  checkTags(tags) { const list = Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(',') : []; return [...new Set(list.map(t => str(t, LIMITS.tag).toLowerCase()).filter(Boolean))].slice(0, LIMITS.tags); }
  checkWhen(v) { if (!v) return null; const t = Date.parse(v); if (Number.isNaN(t)) throw fail('The expiry must be a date.'); return iso(t); }

  // The owner reads one field at a time; each read is recorded.
  field(id, field) {
    this.open();
    const i = this.get(id);
    if (!fieldNames(i).includes(field)) throw fail('That field does not exist.', 404);
    this.audit({ action: 'owner-view', item: i.id, name: i.name, by: 'owner', decision: field });
    return i.values[field];
  }

  // ---------- 1.110: intake links ----------
  // A link is pending until it is filled in, cancelled or replaced, or its time runs out; only a pending link holds its name.
  intakeState(r, now = this.now()) { return r.state === 'pending' && Date.parse(r.expiresAt) <= now ? 'expired' : r.state; }
  pendingIntake(name, now = this.now()) { return (this.intakes || []).find(r => r.name === name && this.intakeState(r, now) === 'pending') || null; }
  intakeView(r, now = this.now()) {
    const { tokenHash: _t, nonce: _n, ...rest } = r;
    return { ...rest, state: this.intakeState(r, now), fields: [...KINDS[r.kind], ...(r.fields || [])] };
  }
  // Pending links, and the ones that ended in the last week (so the owner and the agent can see what happened).
  intakeViews(now = this.now()) {
    return (this.intakes || []).filter(r => { const st = this.intakeState(r, now), end = st === 'expired' ? r.expiresAt : r.endedAt; return st === 'pending' || (end && Date.parse(end) + 7 * 86400_000 > now); })
      .sort((a, b) => Date.parse(b.created) - Date.parse(a.created)).map(r => this.intakeView(r, now));
  }
  intakeById(id) { this.open(); const r = this.intakes.find(x => x.id === id); if (!r) throw fail('That intake link does not exist.', 404); return r; }
  // A new link: the name is reserved until the link ends. Returns the view and the token, which is never kept.
  createIntake(input, { actor = 'owner', session = null, sessionTitle = '' } = {}) {
    this.open();
    const now = this.now(), by = actor === 'owner' ? 'owner' : actor === 'agent' ? 'agent' : 'terminal';
    const name = str(input?.name, LIMITS.name + 1).toLowerCase();
    if (!NAME_RE.test(name)) throw fail('The name must be 1 to 64 characters: lower-case letters, digits and hyphens.');
    if (this.items.some(i => i.name === name)) throw fail(`An item named ${name} already exists${this.items.some(i => i.name === name && i.trashedAt) ? ' (it is in Removed)' : ''}. Choose another name.`, 409);
    if (this.pendingIntake(name, now)) throw fail(`An intake link for ${name} is already waiting. Cancel it or send a new link instead.`, 409, { code: 'intake_reserved' });
    const kind = str(input?.kind, 20) || 'login'; if (!INTAKE_KINDS.includes(kind)) throw fail('The kind must be login, api_key, token, credentials or note.');
    const raw = Array.isArray(input?.fields) ? input.fields : typeof input?.fields === 'string' ? input.fields.split(',') : [];
    const fields = [...new Set(raw.map(f => str(f, 40).toLowerCase()).filter(Boolean))];
    for (const f of fields) { if (!FIELD_RE.test(f)) throw fail(`${f} is not a field name: lowercase letters, digits and underscores, up to 32 characters, starting with a letter.`); if (KINDS[kind].includes(f)) throw fail(`${f} is already a field of a ${kind}.`); }
    if (fields.length > INTAKE.fields) throw fail(`A link can ask for up to ${INTAKE.fields} extra fields.`);
    if (kind === 'credentials' && !fields.length) throw fail('Name the fields to ask for, for example client_id,client_secret.');
    const hours = input?.hours == null || input.hours === '' ? INTAKE.hoursDefault : Number(input.hours);
    if (!Number.isFinite(hours) || hours < INTAKE.hoursMin || hours > INTAKE.hoursMax) throw fail(`A link can last from ${INTAKE.hoursMin} hour to ${INTAKE.hoursMax / 24} days.`);
    const who = str(input?.for, INTAKE.for + 1); if (who.length > INTAKE.for) throw fail(`Who it is for can be up to ${INTAKE.for} characters.`);
    const from = str(input?.from, INTAKE.from + 1); if (from.length > INTAKE.from) throw fail(`Who is asking can be up to ${INTAKE.from} characters.`);
    const note = str(input?.note, INTAKE.note + 1); if (note.length > INTAKE.note) throw fail(`What it is for can be up to ${INTAKE.note} characters.`);
    for (const [label, v] of [['who it is for', who], ['who is asking', from], ['what it is for', note]]) if (PLACEHOLDER_RE.test(v) || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(v)) throw fail(`The text for ${label} has characters it cannot hold.`);
    if (this.intakes.filter(r => this.intakeState(r, now) === 'pending').length >= INTAKE.pending) throw fail(`Up to ${INTAKE.pending} intake links can wait at once. Cancel one first.`, 409);
    const token = randomBytes(32).toString('base64url');
    const r = { id: shortId(), name, kind, fields, for: who, from, note, tokenHash: tokenHash(token), nonce: randomBytes(16).toString('hex'), created: iso(now), expiresAt: iso(now + Math.round(hours * 3600_000)), by, ...(session ? { session: str(session, 80), sessionTitle: str(sessionTitle, 200) } : {}), state: 'pending', endedAt: null, item: null, links: 1 };
    this.audit({ action: 'intake-create', request: r.id, name, by, session, sessionTitle, decision: who || undefined });
    const next = [...this.intakes, r]; this.save({ intakes: next }); this.intakes = next;
    return { intake: this.intakeView(r, now), token };
  }
  // A new link for a pending request (the old one stops working), or a cancel. Agents may do both: neither reveals a value.
  relinkIntake(id, { actor = 'owner' } = {}) {
    const live = this.intakeById(id), now = this.now();
    if (this.intakeState(live, now) !== 'pending') throw fail('This intake link has ended. Create a new one.', 409);
    const token = randomBytes(32).toString('base64url'), r = { ...live, tokenHash: tokenHash(token), nonce: randomBytes(16).toString('hex'), links: (live.links || 1) + 1 };
    this.audit({ action: 'intake-relink', request: r.id, name: r.name, by: actor === 'owner' ? 'owner' : actor === 'agent' ? 'agent' : 'terminal' });
    const next = this.intakes.map(x => x === live ? r : x); this.save({ intakes: next }); this.intakes = next;
    return { intake: this.intakeView(r, now), token };
  }
  cancelIntake(id, { actor = 'owner' } = {}) {
    const live = this.intakeById(id), now = this.now();
    if (this.intakeState(live, now) !== 'pending') throw fail('This intake link has already ended.', 409);
    const r = { ...live, state: 'cancelled', endedAt: iso(now) };
    this.audit({ action: 'intake-cancel', request: r.id, name: r.name, by: actor === 'owner' ? 'owner' : actor === 'agent' ? 'agent' : 'terminal' });
    const next = this.intakes.map(x => x === live ? r : x); this.save({ intakes: next }); this.intakes = next;
    return this.intakeView(r, now);
  }
  // The link a token opens, whatever its state, or null. Every stored hash is compared, in constant time, with no early
  // return, so how long the lookup takes says nothing about which links exist.
  resolveIntake(token) {
    this.open();
    if (typeof token !== 'string' || !INTAKE_TOKEN_RE.test(token)) return null;
    const h = Buffer.from(tokenHash(token), 'hex'); let found = null;
    for (const r of this.intakes) if (timingSafeEqual(Buffer.from(r.tokenHash, 'hex'), h) && !found) found = r;
    return found ? { intake: found, state: this.intakeState(found) } : null;
  }
  static intakeNonceOk(r, nonce) { const a = Buffer.from(String(r?.nonce || '')), b = Buffer.from(String(nonce || '')); return a.length === 32 && a.length === b.length && timingSafeEqual(a, b); }
  // The submitter's values become a new item under the reserved name, with the default policy, and the link ends: both are
  // written in one save, so a failed write leaves the link open and nothing stored. Only the fields the link asked for are
  // taken; the kind's fixed fields are required (a credentials link needs at least one of its fields).
  submitIntake(token, { nonce, values, notes = '' } = {}) {
    this.open();
    const hit = this.resolveIntake(token); if (!hit || hit.state !== 'pending') throw fail('This link is no longer active.', 404, { code: 'intake_inactive' });
    const r = hit.intake, now = this.now(), at = iso(now);
    if (!VaultStore.intakeNonceOk(r, nonce)) throw fail('This form is out of date. Open the link again.', 403, { code: 'intake_nonce' });
    if (this.items.some(i => i.name === r.name)) throw fail('This link is no longer active.', 409, { code: 'intake_inactive' }); // the owner took the name another way
    const asked = [...KINDS[r.kind], ...(r.fields || [])], given = {};
    for (const f of asked) { const v = typeof values?.[f] === 'string' ? values[f].replace(/\r\n/g, '\n') : ''; if (v.trim()) given[f] = r.kind === 'note' && f === 'text' ? v : v.replace(/^\s+|\s+$/g, ''); }
    for (const f of KINDS[r.kind]) if (!given[f]) throw fail(`The ${INTAKE_LABEL(f, r.kind)} is required.`, 400, { field: f });
    if (!Object.keys(given).length) throw fail('Fill in at least one field.', 400, { field: asked[0] });
    const { values: kept, custom } = this.checkValues({ kind: r.kind, custom: [] }, given, { all: false });
    const note = typeof notes === 'string' ? notes.trim() : '';
    if (note.length > LIMITS.notes) throw fail(`Notes can be up to ${LIMITS.notes.toLocaleString('en-US')} characters.`, 400, { field: 'notes' });
    if (this.items.length >= LIMITS.items) throw fail('The vault is full.', 409);
    const item = { id: shortId(), name: r.name, kind: r.kind, custom, values: kept, url: '', notes: note, tags: [], policy: 'default', recipes: [], expiresAt: null,
      created: at, updated: at, by: 'intake', intake: { request: r.id, for: r.for, note: r.note }, ...(r.session ? { addedIn: { session: r.session, sessionTitle: r.sessionTitle || '' } } : {}), lastUsedAt: null, lastUsedBy: null, trashedAt: null, revision: 1 };
    const done = { ...r, state: 'filled', endedAt: at, item: item.id };
    this.audit({ action: 'put', item: item.id, name: r.name, by: 'intake', request: r.id, decision: r.for || undefined, fields: Object.keys(kept) });
    const items = [...this.items, item], intakes = this.intakes.map(x => x === r ? done : x);
    this.save({ items, intakes }); this.items = items; this.intakes = intakes;
    return { item: this.view(item, { owner: true }), intake: this.intakeView(done, now) };
  }

  // ---------- runs ----------
  // Bindings: { VAR: 'name' | 'name.field' } → the items and the field each variable needs. Nothing is released here.
  resolveBindings(env) {
    this.open();
    if (!env || typeof env !== 'object') throw fail('Nothing to bind: give at least one --env VAR=name.');
    const entries = Object.entries(env); if (!entries.length) throw fail('Nothing to bind: give at least one --env VAR=name.');
    if (entries.length > LIMITS.env) throw fail('Too many variables.');
    const bound = [];
    for (const [v, ref] of entries) {
      if (!ENV_RE.test(v)) throw fail(`${v} is not a variable name.`);
      if (REFUSED_ENV.test(v)) throw fail(`${v} cannot be bound.`);
      const m = /^([a-z0-9-]+)(?:\.([a-z][a-z0-9_]*))?$/.exec(String(ref || '')); if (!m) throw fail(`${ref} is not an item name.`);
      const item = this.byName(m[1]); if (!item) throw fail(`There is no item named ${m[1]}. \`list\` shows what exists.`, 404);
      const fields = fieldNames(item);
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
  // 1.73.4: a command is a run or a browser fill; a recipe saved before 1.73.4 carries no action and is read from its argv.
  static actionOf(x) { return x?.action === 'fill' || (!x?.action && x?.argv?.[0] === 'pocket-fill') ? 'fill' : 'run'; }
  static sameCommand(a, b) { return a.cwd === b.cwd && VaultStore.actionOf(a) === VaultStore.actionOf(b) && a.argv.length === b.argv.length && a.argv.every((x, k) => x === b.argv[k]); }
  // PC-02: a run recipe also holds what the command executes (vault-pin.mjs: the program, its interpreter, the program a
  // launcher starts, the script and every file argument, by path and content hash), and matches only while all of it is
  // unchanged (pinDiff). A file that could not be hashed compares by size and times; an argument the owner marked as data
  // is not compared. A recipe saved before pins, or under an earlier pin version that no longer agrees, asks once more.
  // A fill runs nothing of the agent's, so its recipe has no pin. A command with no pin object at all is one the store
  // was handed without a check (only direct callers of the store do that; every HTTP run is pinned), and matches only a
  // recipe without one.
  static samePin(a, b) { if (VaultStore.actionOf(b) === 'fill') return true; return VaultStore.pinsMatch(a?.pin, b?.pin); }
  static pinsMatch(a, b) { if (!a && !b) return true; return Boolean(a && b) && pinDiff(a, b).length === 0; }
  // Second review: a run recipe also holds its variables, each name with the item (by id, so a renamed item still matches)
  // and field it gets, and matches only the same set: a rerun that binds the value under another name (one a program acts on
  // by itself, say), adds a binding or swaps fields asks again. A recipe saved before this has none and asks once more.
  static bindingsOf(list) { return (list || []).map(b => ({ v: b.v, item: b.item?.id ?? b.item, field: b.field, name: b.item?.name ?? b.name })).sort((a, b) => a.v < b.v ? -1 : a.v > b.v ? 1 : 0); }
  static bindingKey(list) { return JSON.stringify(VaultStore.bindingsOf(list).map(b => [b.v, b.item, b.field])); }
  static sameBindings(recipe, cmd) { if (VaultStore.actionOf(cmd) === 'fill') return true; return Array.isArray(recipe.bindings) && Array.isArray(cmd.bindings) && VaultStore.bindingKey(recipe.bindings) === VaultStore.bindingKey(cmd.bindings); }
  static withBindings(cmd, bound) { return VaultStore.actionOf(cmd) === 'run' ? { ...cmd, bindings: VaultStore.bindingsOf(bound) } : cmd; }
  static recipeFor(item, cmd) { if (VaultStore.unpinnable(cmd.pin)) return null; return item.recipes.find(r => VaultStore.sameCommand(r, cmd) && VaultStore.samePin(r, cmd) && VaultStore.sameBindings(r, cmd) && !VaultStore.unpinnable(r.pin)) || null; }
  // Never allowed always, so every run is asked about: a script that is not a regular file (a pipe, a device, a folder python
  // runs) has no content to compare; and (second review) a command whose launcher Pocket cannot read (`unknown`), or that
  // Pocket cannot pin (`refuse`: a script it cannot find, find -exec, npm run, npx, docker run, ssh with a command, …).
  static unpinnable(pin) { return Boolean(pin?.files?.some(f => f?.role === 'script' && f.kind) || pin?.unknown || pin?.refuse); }
  // Why an approved command asks again: { why: 'changed', files } (what differs from the closest recipe: [{path, how}]),
  // { why: 'variables', was } (the same command allowed with other variables), { why: 'unpinned' } (approved before content
  // was checked as it is now), { why: 'unbound' } (approved before its variables were recorded), { why: 'refused' } (allowed
  // always before, but Pocket no longer offers that for this command), or null when no recipe has this text.
  static recipeChange(items, cmd) {
    if (VaultStore.actionOf(cmd) === 'fill') return null;
    const same = items.flatMap(i => i.recipes.filter(r => VaultStore.sameCommand(r, cmd))); if (!same.length) return null;
    if (VaultStore.unpinnable(cmd.pin)) return { why: 'refused' };
    const miss = same.filter(r => !(VaultStore.samePin(r, cmd) && VaultStore.sameBindings(r, cmd))); if (!miss.length) return null;
    const was = r => Array.isArray(r.bindings) && !VaultStore.sameBindings(r, cmd) ? { was: r.bindings.map(({ v, name, field }) => ({ v, name, field })) } : {};
    // What runs is unchanged: only the variables differ, or the recipe was saved before they were recorded.
    const pinOk = miss.filter(r => VaultStore.samePin(r, cmd));
    if (pinOk.length) { const r = pinOk.find(x => Array.isArray(x.bindings)); return r ? { why: 'variables', ...was(r) } : { why: 'unbound' }; }
    const current = miss.filter(r => r.pin?.v === PIN_VERSION);
    if (!current.length) return { why: 'unpinned' };
    const best = current.map(r => ({ r, d: pinDiff(r.pin, cmd.pin) })).sort((a, b) => a.d.length - b.d.length)[0];
    return { why: 'changed', files: best.d.slice(0, 20).map(({ path: p, how }) => ({ path: p, how })), ...was(best.r) };
  }
  // The arguments an earlier Always for this command text marked as data: a new Always keeps them unless the owner says otherwise.
  static dataPaths(items, cmd) { return [...new Set(items.flatMap(i => i.recipes.filter(r => VaultStore.sameCommand(r, cmd)).flatMap(r => (r.pin?.files || []).filter(f => f?.data).map(f => f.path))))]; }
  // D-4: the bound items as the store holds them now (an await, such as hashing a large file, may have let the owner edit,
  // remove or lock them); by item id, as claim() does.
  rebind(bound) {
    this.open();
    return bound.map(b => {
      const item = this.items.find(x => x.id === b.item.id);
      if (!item || item.trashedAt || !fieldNames(item).includes(b.field)) throw fail(`${b.item.name} changed while the command was being checked; run it again.`, 409, { code: 'request_stale' });
      return { ...b, item };
    });
  }
  // What the policies say about running this command with these items: 'run', or 'ask' with the items that need the owner's word.
  decide(bound, cmd) {
    const need = []; cmd = VaultStore.withBindings(cmd, bound);
    for (const { item: boundItem } of new Map(bound.map(b => [b.item.id, b])).values()) {
      const item = this.items.find(x => x.id === boundItem.id) || boundItem; // 1.73.6: an edit replaces the item object; the policy read is the one in the store now
      const p = this.effective(item);
      if (p === 'owner') throw fail(`${item.name} is for the owner only; agents cannot use it. Ask the owner to change its policy.`, 403, { code: 'owner_only' });
      if (p === 'every' || (p === 'ask' && !VaultStore.recipeFor(item, cmd))) need.push(item);
    }
    return need;
  }
  // A request for the owner: one per command, naming every item that needs approval. 1.73.4: the row also records the kind
  // of use (`action`: run or fill), every binding by item id, and the caller (actor, session, and the SHA-256 of the runner
  // token when there is one), so a continuation can be held to the same use by the same caller.
  request({ bound, cmd, need, env, session = null, sessionTitle = '', by = 'agent', tokenHash = null }) {
    this.expireRequests();
    const now = this.now();
    let id = shortId(); for (let n = 0; this.requests.has(id); n++) { if (n >= 8) throw fail('Could not number the request; try again.', 500); id = shortId(); } // never over an existing row
    // PC-02: the row keeps the pin of what was asked about (an Always saves it, a continuation must still match it) and says
    // when an approved command asks again because what it runs changed, or because it was approved before content was checked.
    // 1.118 (D-3): it also names the files that changed, and carries the arguments an earlier Always marked as data.
    cmd = VaultStore.withBindings(cmd, bound);
    const change = VaultStore.recipeChange(need, cmd), data = cmd.pin ? VaultStore.dataPaths(need, cmd) : [];
    const r = { id, action: VaultStore.actionOf(cmd), items: need.map(i => i.id), itemNames: need.map(i => i.name), argv: cmd.argv, cwd: cmd.cwd, env, session, sessionTitle, by, created: iso(now), expiresAt: iso(now + LIMITS.requestTtlMs), answer: null, consumed: false, waiters: [], allowAlways: need.every(i => this.effective(i) !== 'every') && !VaultStore.unpinnable(cmd.pin),
      pin: cmd.pin || null, program: cmd.pin?.program || null, changed: change?.why || null, ...(change?.files?.length ? { changedFiles: change.files } : {}), ...(change?.was ? { was: change.was } : {}), ...(data.length ? { data } : {}),
      bindings: bound.map(b => ({ v: b.v, item: b.item.id, name: b.item.name, field: b.field })), caller: { actor: by, session, tokenHash } };
    this.audit({ action: 'request', request: r.id, item: need[0].id, name: need.map(i => i.name).join(','), by, session, sessionTitle, argv: cmd.argv, cwd: cmd.cwd });
    this.requests.set(r.id, r);
    return r;
  }
  // 1.73.4: who may continue a request. An agent inside a Pocket session is its session (the token the daemon put in that
  // process names it; a restarted process of the same session still counts); terminal and code-server callers share the one
  // identity `terminal`, since nothing tells them apart.
  static sameCaller(a, b) { return (a?.actor || 'terminal') === (b?.actor || 'terminal') && (a?.session || null) === (b?.session || null); }
  // The continuation of a request (pocket-vault wait, or the relay calling again with the id): the row must exist, be the same
  // kind of use, belong to this caller and not be used up. Checked before waiting on the answer, and again inside claim().
  continuation(id, { action = 'run', caller = null } = {}) {
    this.open(); this.expireRequests();
    const r = this.requests.get(String(id)); if (!r) throw fail('That request does not exist or has expired.', 404);
    if (r.action !== action) throw fail(r.action === 'fill' ? 'That request is for a browser fill, not a command.' : 'That request is for a command, not a browser fill.', 409, { code: 'request_mismatch' });
    if (!VaultStore.sameCaller(r.caller, caller)) throw fail('That request was raised by another session.', 403, { code: 'request_mismatch' });
    if (r.consumed) throw fail('That request was already used.', 409, { code: 'request_used' });
    return r;
  }
  // The one step between the owner's answer and the release, synchronous so that two continuations of one answer cannot
  // both pass: the bindings are resolved again by item id against the store as it is now (a removed item or field voids the
  // approval; a renamed item does not), the policy decision is run again (an item that is now the owner's only refuses; one
  // that now needs approval and was not in the answered set sends the agent back to ask), and the row is marked used.
  // PC-02: `pin` is what the command runs now (pinCommand, just before the claim); it must be what the owner was asked about,
  // so a script rewritten while the request waited is not run on the strength of an answer about its old content.
  claim(id, { action = 'run', caller = null, pin = null } = {}) {
    const r = this.continuation(id, { action, caller });
    if (!r.answer || !['once', 'always'].includes(r.answer.decision)) throw fail('The owner has not allowed that request.', 409);
    const bound = [];
    for (const b of r.bindings) {
      const item = this.items.find(x => x.id === b.item);
      if (!item || item.trashedAt || !fieldNames(item).includes(b.field)) throw fail(`${b.name} changed since the owner was asked; ask again.`, 409, { code: 'request_stale' });
      bound.push({ v: b.v, item, field: b.field });
    }
    if (r.action === 'run' && !VaultStore.pinsMatch(r.pin, pin)) {
      const d = r.pin && pin ? pinDiff(r.pin, pin) : [], first = d[0]?.path ? (path.relative(r.cwd, d[0].path).startsWith('..') ? d[0].path : path.relative(r.cwd, d[0].path)) : '';
      throw fail(`${first ? (d[0].how === 'program' ? `The program (now ${d[0].path})` : first) : 'The program or a file the command names'} changed since the owner was asked; ask again.`, 409, { code: 'request_stale' });
    }
    const cmd = { argv: r.argv, cwd: r.cwd, action: r.action, ...(r.action === 'run' && pin ? { pin } : {}) };
    const need = this.decide(bound, cmd);
    if (need.some(i => !r.items.includes(i.id))) throw fail('A policy changed since the owner was asked; ask again.', 409, { code: 'request_stale' });
    r.consumed = true;
    return { request: r, bound, cmd };
  }
  // 1.118 (D-3): `data` lists arguments the owner says the command writes itself (an output, log or state file); an
  // Always saves them unchecked. Only a file the command names as a plain argument can be marked (never the program, an
  // interpreter, a launched program or the script); left out, the marks an earlier Always made for this command stay.
  answer(id, decision, { data } = {}) {
    this.expireRequests();
    const r = this.requests.get(id); if (!r) throw fail('That request does not exist or has expired.', 404);
    if (r.answer) throw fail('That request was already answered.', 409);
    if (!['once', 'always', 'deny'].includes(decision)) throw fail('Answer once, always or deny.');
    let marks = r.data || [];
    if (data !== undefined && data !== null) {
      const ok = new Set([...(r.pin?.files || []).filter(f => f.role === 'argument').map(f => f.path), ...(r.data || [])]);
      if (!Array.isArray(data) || data.length > LIMITS.argv || data.some(p => typeof p !== 'string' || !ok.has(p))) throw fail('Only a file the command names as an argument can be left unchecked.');
      marks = [...new Set(data)];
    }
    const answer = { decision, at: iso(this.now()) };
    // 1.73.6: the recipes an Always saves are written first; the row is answered, and its waiters woken, only once they are on disk.
    let next = null;
    if (decision === 'always') {
      // PC-02: a run recipe keeps the pin of what the owner was asked about; a recipe with the same text whose pin no longer
      // matches (the script changed, or it was saved before pins) takes the new pin instead of gaining a twin.
      const pinned = r.action === 'run' ? { pin: withData(r.pin, marks), bindings: VaultStore.bindingsOf(r.bindings) } : {};
      next = this.items.map(live => {
        if (!r.items.includes(live.id) || live.trashedAt || this.effective(live) === 'every' || VaultStore.unpinnable(r.pin) || VaultStore.recipeFor(live, { ...r, ...pinned })) return live;
        const i = structuredClone(live), old = i.recipes.find(x => VaultStore.sameCommand(x, r));
        if (old) { if (r.pin) Object.assign(old, pinned, { pinned: answer.at }); else if (pinned.bindings) old.bindings = pinned.bindings; } // never unpins a recipe
        else { i.recipes.push({ id: shortId(), argv: r.argv, cwd: r.cwd, action: r.action, ...pinned, created: answer.at }); if (i.recipes.length > LIMITS.recipes) i.recipes.shift(); }
        this.touch(i); return i;
      });
    }
    this.audit({ action: 'request-answered', request: r.id, item: r.items[0], name: r.itemNames.join(','), by: 'owner', decision, session: r.session, sessionTitle: r.sessionTitle, argv: r.argv, cwd: r.cwd });
    if (next) { this.save({ items: next }); this.items = next; }
    r.answer = answer;
    for (const w of r.waiters.splice(0)) w(r);
    return this.requestView(r);
  }
  // The pending requests a session raised, oldest first (for answers the owner types in that conversation).
  pendingFor(session) { this.expireRequests(); return [...this.requests.values()].filter(r => !r.answer && r.session && r.session === session); }
  // Resolves with the request once answered, or null when `ms` pass first.
  waitAnswer(id, ms) {
    this.expireRequests();
    const r = this.requests.get(id); if (!r) throw fail('That request does not exist or has expired.', 404);
    if (r.answer) return Promise.resolve(r);
    return new Promise(resolve => { const t = setTimeout(() => { r.waiters = r.waiters.filter(w => w !== done); resolve(null); }, ms); const done = () => { clearTimeout(t); resolve(r); }; r.waiters.push(done); });
  }
  expireRequests(now = this.now()) {
    // 1.82.1: an answered request lives until 15 minutes after the answer, as the second clause always meant; the first
    // clause used to delete it at the request's own expiry first, so an approval given near the end of the window was gone
    // a minute later. An unanswered request still expires at its own time.
    for (const [id, r] of this.requests) {
      const dead = r.answer ? Date.parse(r.answer.at) + LIMITS.requestTtlMs <= now : Date.parse(r.expiresAt) <= now;
      if (!dead) continue;
      if (!r.answer) { r.answer = { decision: 'expired', at: iso(now) }; for (const w of r.waiters.splice(0)) w(r); }
      this.requests.delete(id);
    }
  }
  // Values for a run that policy allows; recorded first. Returns the secrets to bind and the scrub list.
  // `action` is 'run' (a command the daemon spawns) or 'fill' (1.43: a value typed into a browser tool by pocket-mcp-proxy).
  release(bound, cmd, { session = null, sessionTitle = '', by = 'agent', request = null, action = 'run' } = {}) {
    this.open();
    const items = [...new Map(bound.map(b => [b.item.id, b.item])).values()];
    for (const item of items) this.audit({ action, item: item.id, name: item.name, by, session, sessionTitle, argv: cmd.argv, cwd: cmd.cwd, request });
    const at = iso(this.now());
    const next = this.items.map(live => items.includes(live) ? { ...live, lastUsedAt: at, lastUsedBy: { session, sessionTitle, kind: by } } : live);
    this.save({ items: next }); this.items = next;
    const secrets = {}; for (const b of bound) secrets[b.v] = b.item.values[b.field];
    return secrets;
  }
  // Removed items are purged after 30 days.
  purge(now = this.now()) {
    if (this.locked) { this.expireRequests(now); return []; }
    const gone = this.items.filter(i => i.trashedAt && Date.parse(i.trashedAt) + LIMITS.trashDays * 86400_000 <= now);
    // 1.110: an intake link that ended (filled, cancelled or expired) more than 30 days ago goes with them.
    const old = this.intakes.filter(r => { const end = r.endedAt || (r.state === 'pending' ? r.expiresAt : null); return end && Date.parse(end) + INTAKE.keepDays * 86400_000 <= now; });
    if (gone.length || old.length) { const next = this.items.filter(i => !gone.includes(i)), nextIn = this.intakes.filter(r => !old.includes(r)); this.save({ items: next, intakes: nextIn }); this.items = next; this.intakes = nextIn; }
    this.expireRequests(now);
    return gone.map(i => i.name);
  }
}

// What a run executes (PC-02): vault-pin.mjs.
export { PIN_LIMITS, PIN_VERSION, runPath, findProgram, pinCommand, prepareRun, pinKey, pinDiff, exposedFolders, replaceable } from './vault-pin.mjs';

// ---------- scrubbing ----------
// Every form a value is likely to take in a program's output: as typed, base64, base64url, URL-encoded, JSON-escaped
// (1.73.3: in the spellings other JSON writers use too, and escaped twice).
export function needlesFor(values) {
  const out = new Set();
  // 1.73.8: a value with a lone surrogate reaches a child's environment as U+FFFD; that spelling is a form too.
  for (const v of values.flatMap(x => typeof x === 'string' && x.toWellFormed && x.toWellFormed() !== x ? [x, x.toWellFormed()] : [x])) {
    if (typeof v !== 'string' || v.length < 4) continue; // a 1–3 character value would shred the output; it is not a secret anyone can keep
    out.add(v);
    const bytes = Buffer.from(v, 'utf8'), std = bytes.toString('base64');
    out.add(std); out.add(bytes.toString('base64url')); out.add(std.replace(/=+$/, '')); // 1.82.1: unpadded standard base64 too
    // 1.82.1: a value inside a longer base64 text (an HTTP Basic header is base64 of "user:password"; tokens and config
    // blobs carry values the same way) is spelled by one of three alignments. The characters of each alignment that depend
    // on the value alone are a form, in standard and URL-safe spelling, when there are at least 7 of them (every value of 6
    // characters or more; a 4–5 character value is caught only when it is encoded on its own).
    for (let k = 0; k < 3; k++) {
      const core = Buffer.concat([Buffer.alloc(k), bytes]).toString('base64').slice(Math.ceil(k * 8 / 6), Math.floor((k + bytes.length) * 8 / 6));
      if (core.length >= 7) { out.add(core); out.add(core.replace(/\+/g, '-').replace(/\//g, '_')); }
    }
    // PC-02: hex (either case) and reversed, as defence in depth. Scrubbing is not the control: a command can always
    // spell a value some other way; what may run is decided by the recipe and its pin.
    const hex = bytes.toString('hex'); out.add(hex); out.add(hex.toUpperCase());
    const rev = [...v].reverse().join(''); if (rev !== v) out.add(rev);
    try { const e = encodeURIComponent(v); if (e !== v) out.add(e); } catch { }
    const j = JSON.stringify(v).slice(1, -1); if (j !== v) out.add(j);
    // PHP's json_encode writes "/" as "\/" and, like Python's json.dumps, non-ASCII as \uXXXX; a JSON string carried inside
    // another JSON string (a log line, an API body echoed back) is escaped once more.
    const slashed = j.replace(/\//g, '\\/'); if (slashed !== j) out.add(slashed);
    const ascii = t => t.replace(/[^\x00-\x7f]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    for (const t of [j, slashed]) { const a = ascii(t); if (a !== t) out.add(a); }
    const twice = JSON.stringify(j).slice(1, -1); if (twice !== j) out.add(twice);
  }
  return [...out].filter(Boolean).sort((a, b) => b.length - a.length);
}
// A streaming replacer: text arrives in chunks; the tail of each chunk (one less than the longest form) is held
// back until the next chunk or the end, and the cut is moved back to the start of any form that straddles it, so a
// value split across two chunks is still caught. (1.73.8: it used to move forward past the form, which could leave
// the start of an overlapping occurrence at the very end with nothing held to complete it.) `table` is [{forms, ph}]
// with the longest forms first.
export function makeScrubStream(table) {
  const forms = table.flatMap(p => p.forms), hold = Math.max(0, ...forms.map(f => f.length - 1));
  let carry = '';
  const rep = t => { for (const p of table) for (const f of p.forms) t = t.split(f).join(p.ph); return t; };
  return {
    push(chunk) {
      const t = carry + chunk; let cut = Math.max(0, t.length - hold), moved = true;
      while (moved) { moved = false; for (const f of forms) { const i = t.indexOf(f, Math.max(0, cut - f.length + 1)); if (i !== -1 && i < cut) { cut = i; moved = true; } } }
      carry = t.slice(cut); return rep(t.slice(0, cut));
    },
    end() { const t = rep(carry); carry = ''; return t; },
  };
}
export function scrubber(values, placeholder = '{{vault}}') { return makeScrubStream([{ forms: needlesFor(values), ph: placeholder }]); }

// ---------- the run ----------
// Spawns the command with the secrets in its environment (never its arguments), no TTY, output piped through the
// scrubber and capped. `onOut`/`onErr` get scrubbed text as it arrives. Resolves when the child is gone.
// 1.73.7: the command leads its own process group. Timeout, abort and the output cap signal the whole group (TERM, then
// KILL after five seconds), and so does the command's own exit: whatever it started and left running is ended, so a run
// cannot leave a daemon behind holding the values or the output pipes. The run resolves within about two seconds of the
// command's exit even if something outside the group still holds a pipe.
// PC-02: `file` is the program pinCommand found (run by full path, with argv[0] kept as the program's own name). 1.118:
// `plan` (prepareRun) says how to start what was checked: the file (a /proc/self/fd path when the program runs from the
// handle that was hashed), the arguments (a shell script's replaced by its private copy), argv[0], and the handles the
// child gets as fd 3 and up. The caller checks the plan (plan.verify()) immediately before this call; the spawn happens
// synchronously inside it.
export function runWithSecrets({ argv, file = null, plan = null, cwd, env, secrets, placeholders, timeoutMs = LIMITS.timeoutDefault * 1000, maxOutput = LIMITS.output, onOut = () => {}, onErr = () => {}, signal }) {
  return new Promise(resolve => {
    // One replacer per stream: every form of every value becomes that value's own placeholder, longest values first.
    const table = Object.values(secrets).map(v => ({ forms: needlesFor([v]), ph: placeholders?.[v] ? `{{vault:${placeholders[v]}}}` : '{{vault}}' })).filter(p => p.forms.length).sort((a, b) => b.forms[0].length - a.forms[0].length);
    const out = makeScrubStream(table), err = makeScrubStream(table);
    let total = 0, truncated = false, done = false, timedOut = false, child, exited = null, grace = null, aborted = false;
    const group = sig => signalGroup(child?.pid, sig);
    const finish = (code, signalName, error) => { if (done) return; done = true; clearTimeout(timer); clearTimeout(grace); signal?.removeEventListener?.('abort', abort); resolve({ code, signal: signalName, truncated, timedOut, error }); };
    const abort = () => { if (!child?.pid || aborted || done) return; aborted = true; group('SIGTERM'); setTimeout(() => group('SIGKILL'), 5000).unref(); };
    const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
    signal?.addEventListener?.('abort', abort);
    try {
      child = plan ? spawn(plan.file, plan.args, { cwd, env: { ...env, ...secrets }, argv0: plan.argv0, stdio: ['ignore', 'pipe', 'pipe', ...plan.fds], windowsHide: true, detached: true })
        : spawn(file || argv[0], argv.slice(1), { cwd, env: { ...env, ...secrets }, ...(file ? { argv0: argv[0] } : {}), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: true });
    }
    catch (e) { return finish(null, null, e.message); }
    child.on('error', e => finish(null, null, e.message));
    const emit = (fn, text) => { if (!text) return; total += text.length; if (total > maxOutput) { if (!truncated) { truncated = true; fn(text.slice(0, Math.max(0, text.length - (total - maxOutput)))); abort(); } return; } fn(text); };
    const settle = (code, sig) => { if (done) return; emit(onOut, out.end()); emit(onErr, err.end()); finish(code, sig, null); };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', c => emit(onOut, out.push(c))); child.stderr.on('data', c => emit(onErr, err.push(c)));
    // The command is done: end what it left in its group, give the pipes a second to drain, then stop waiting for them.
    // 1.82.1: the KILL a second later is its own timer, not part of the drain wait: when the pipes closed at once, settling
    // cancelled the drain timer and the KILL with it, and a group member that ignored TERM outlived the run.
    child.on('exit', (code, sig) => {
      exited = [code, sig]; group('SIGTERM');
      setTimeout(() => group('SIGKILL'), 1000);
      grace = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); settle(...exited); }, 2000);
    });
    child.on('close', (code, sig) => settle(...(exited || [code, sig])));
  });
}
