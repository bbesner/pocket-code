// test/vault-spec.test.mjs: a behaviour contract for vault.mjs from the first blind bug review (2026-10-27, 1.82.0).
// One agent wrote a spec from the source without seeing the tests; another wrote these tests from that spec alone,
// without seeing the source. Section marks (§) refer to that spec. The review's five real faults are fixed in 1.82.1 and
// their tests are named "1.82.1 (bug review DIV-n)"; the flags it dismissed are recorded in docs/bug-review-decisions.md.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import {
  KINDS, FIELD_RE, PLACEHOLDER_RE, PLACEHOLDER_ALL, fieldNames, POLICIES, ACCESS, ACTIONS, LIMITS,
  parseKey, newKey, SCRYPT, PASSPHRASE_MIN, deriveKey, storeHeader, encryptStore, decryptStore, EXPORT_FORMAT,
  vaultInstructions, VaultStore, needlesFor, makeScrubStream, scrubber, runWithSecrets,
} from '../vault.mjs';

// ---------------------------------------------------------------------------------------------- helpers
const T0 = Date.parse('2026-01-01T00:00:00Z');
const MIN = 60000;
const DAY = 86400000;
const TTL = 900000;
const ISO = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const PW1 = 'correct horse battery';
const PW2 = 'another long passphrase';
const LOGIN = { username: 'octocat', password: 'hunter2-secret-pass' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tick = () => new Promise((r) => setImmediate(r));

const tmpDirs = [];
const livePids = new Set();
after(() => {
  for (const pid of livePids) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
});
function mkdir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-spec-')); tmpDirs.push(d); return d; }

function readRows(f) {
  let txt;
  try { txt = fs.readFileSync(f, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of txt.split('\n')) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch {} }
  return out;
}

function setup({ key = parseKey(newKey()), opts = {} } = {}) {
  const dir = mkdir();
  const file = path.join(dir, 'vault.enc');
  const auditFile = path.join(dir, 'vault-audit.jsonl');
  const clk = { t: T0 };
  const ctl = { failWrite: false, writes: 0 };
  const write = (f, buf) => { ctl.writes++; if (ctl.failWrite) throw new Error('disk full'); fs.writeFileSync(f, buf); };
  const s = { dir, file, auditFile, clk, ctl, key, write };
  s.mk = (o = {}) => new VaultStore(file, { key, auditFile, now: () => clk.t, write, ...o });
  s.store = s.mk(opts);
  s.bytes = () => fs.readFileSync(file);
  s.rows = () => readRows(auditFile);
  s.breakAudit = (st = s.store) => { const prev = st.auditFile; st.auditFile = path.join(dir, 'no-such-dir', 'a.jsonl'); return () => { st.auditFile = prev; }; };
  s.restart = (o = {}) => new VaultStore(file, { key, auditFile, ...o });
  s.openK = (k = key) => decryptStore([k], fs.readFileSync(file));
  s.openPw = (pw) => { const b = fs.readFileSync(file); return decryptStore([deriveKey(pw, storeHeader(b).salt)], b); };
  return s;
}
function craft(s, items, version = 2) {
  fs.writeFileSync(s.file, encryptStore(s.key, { version, savedAt: ISO(T0), items }));
  s.store = s.mk();
  return s.store;
}
function fakeItems(n, prefix = 'n') {
  return Array.from({ length: n }, (_, i) => ({ id: crypto.randomBytes(6).toString('hex'), name: `${prefix}${i}`, kind: 'note',
    values: { text: 't' }, created: ISO(T0), updated: ISO(T0), revision: 1 }));
}
function pwSetup() { const s = setup(); addLogin(s.store); s.store.setPassphrase(PW1, PW1); return s; }
function bundle(pw, items, { format = EXPORT_FORMAT, version = 2 } = {}) {
  const salt = crypto.randomBytes(16);
  return encryptStore(deriveKey(pw, salt), { format, version, exportedAt: ISO(T0), items }, { salt });
}

function catchErr(fn) { try { fn(); } catch (e) { return e; } assert.fail('expected the call to throw'); }
async function catchAsync(fn) { try { await fn(); } catch (e) { return e; } assert.fail('expected the call to throw'); }
function expectFail(fn, status, message, code) {
  const e = catchErr(fn);
  assert.equal(e.message, message);
  assert.equal(e.status, status, `status for "${message}"`);
  if (code !== undefined) assert.equal(e.code, code, `code for "${message}"`);
  return e;
}
function expectPlain(fn, message) {
  const e = catchErr(fn);
  assert.equal(e.message, message);
  assert.equal(e.status, undefined, `plain Error "${message}" must carry no status`);
  return e;
}
function addLogin(store, name = 'gh', extra = {}, ctx) {
  return store.act({ action: 'add', name, kind: 'login', values: { ...LOGIN }, ...extra }, ctx);
}
function addKey(store, name = 'k', value = 'api-key-value-123', extra = {}) {
  return store.act({ action: 'add', name, kind: 'api_key', values: { value }, ...extra });
}
function mkRequest(s, { env = { TOKEN: 'gh.password' }, session = 's1', argv = ['echo', 'hi'], action = 'run', by = 'agent' } = {}) {
  const bound = s.store.resolveBindings(env);
  const cmd = { argv, cwd: s.dir, action };
  const need = s.store.decide(bound, cmd);
  const row = s.store.request({ bound, cmd, need, env, session, sessionTitle: `Title ${session}`, by, tokenHash: 'th' });
  return { row, bound, cmd, need, caller: { actor: by, session } };
}
function patchFs(name, impl) {
  const orig = fs[name];
  fs[name] = impl(orig);
  syncBuiltinESMExports();
  return () => { fs[name] = orig; syncBuiltinESMExports(); };
}
function failAuditOpenOn(auditFile, n) {
  let count = 0;
  return patchFs('openSync', (orig) => function (p, ...rest) {
    if (String(p) === auditFile) { count++; if (count === n) throw Object.assign(new Error('injected audit failure'), { code: 'EIO' }); }
    return orig.call(this, p, ...rest);
  });
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } }
async function waitDead(pid, ms) { const end = Date.now() + ms; while (Date.now() < end) { if (!alive(pid)) return true; await sleep(25); } return !alive(pid); }

// ============================================================================================ §1 / §3 contract
test('contract §1.2/1.3: exported constants and fieldNames', () => {
  assert.deepEqual(KINDS, { api_key: ['value'], token: ['value'], login: ['username', 'password'], credentials: [], note: ['text'] });
  assert.ok(FIELD_RE.test('a') && FIELD_RE.test('a'.repeat(32)) && FIELD_RE.test('client_id9'));
  assert.ok(!FIELD_RE.test('a'.repeat(33)) && !FIELD_RE.test('_a') && !FIELD_RE.test('9a') && !FIELD_RE.test('A'));
  assert.equal(PLACEHOLDER_RE.global, false);
  assert.ok(PLACEHOLDER_RE.test('x {{vault:gh}} y') && PLACEHOLDER_RE.test('{{vault:gh.password}}'));
  assert.ok(!PLACEHOLDER_RE.test('{{vault:GH}}') && !PLACEHOLDER_RE.test('{{vault}}'));
  assert.equal(PLACEHOLDER_ALL.global, true);
  assert.deepEqual([...'a {{vault:gh.password}} b {{vault:k}}'.matchAll(PLACEHOLDER_ALL)].map((m) => m[1]), ['gh.password', 'k']);
  assert.deepEqual(POLICIES, ['default', 'auto', 'ask', 'every', 'owner']);
  assert.deepEqual(ACCESS, ['free', 'once', 'every']);
  assert.deepEqual(ACTIONS, ['add', 'update', 'remove', 'restore', 'recipe-remove', 'answer']);
  assert.deepEqual(LIMITS, { items: 500, name: 64, url: 500, notes: 2000, tags: 20, tag: 40, value: 65536, argv: 200, arg: 4096,
    cwd: 1024, env: 32, customFields: 20, output: 1048576, timeoutMax: 3600, timeoutDefault: 600, waitMax: 300,
    requestTtlMs: 900000, trashDays: 30, recipes: 50, auditRows: 200, concurrent: 8 });
  assert.deepEqual(SCRYPT, { N: 32768, r: 8, p: 1, maxmem: 134217728 });
  assert.equal(PASSPHRASE_MIN, 12);
  assert.equal(EXPORT_FORMAT, 'pocket-vault-export');
  assert.deepEqual(fieldNames({ kind: 'login', custom: ['x'] }), ['username', 'password', 'x']);
  assert.deepEqual(fieldNames({ kind: 'credentials' }), []);
  assert.throws(() => fieldNames({ kind: 'bogus' }), TypeError);
});

test('contract §3.1: newKey / parseKey', () => {
  const raw = newKey();
  assert.equal(raw.length, 44); assert.ok(raw.endsWith('='));
  const k = parseKey(raw);
  assert.ok(Buffer.isBuffer(k)); assert.equal(k.length, 32);
  assert.deepEqual(parseKey(`"${raw}"`), k);
  assert.deepEqual(parseKey(`'${raw}'`), k);
  assert.deepEqual(parseKey(`  ${raw}\n`), k);
  assert.deepEqual(parseKey(raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')), k, 'base64url accepted');
  for (const empty of ['', undefined, null, '   ', '""']) expectPlain(() => parseKey(empty), 'POCKET_VAULT_KEY is not set.');
  expectPlain(() => parseKey('abcd'), 'POCKET_VAULT_KEY must be 32 random bytes, base64 (openssl rand -base64 32).');
  expectPlain(() => parseKey(crypto.randomBytes(16).toString('base64')), 'POCKET_VAULT_KEY must be 32 random bytes, base64 (openssl rand -base64 32).');
});

test('contract §3.2: deriveKey', () => {
  const salt = crypto.randomBytes(16);
  for (const bad of ['short', 'a'.repeat(11), '', undefined]) expectFail(() => deriveKey(bad, salt), 400, 'The passphrase must be at least 12 characters.');
  const k = deriveKey('a'.repeat(12), salt);
  assert.ok(Buffer.isBuffer(k)); assert.equal(k.length, 32);
  assert.deepEqual(deriveKey('a'.repeat(12), salt), k, 'deterministic');
  assert.notDeepEqual(deriveKey('a'.repeat(12), crypto.randomBytes(16)), k);
  assert.deepEqual(deriveKey('Ａ'.repeat(12), salt), deriveKey('A'.repeat(12), salt), 'NFKC');
  assert.deepEqual(k, crypto.scryptSync('a'.repeat(12), salt, 32, SCRYPT));
});

test('contract §3.3: storeHeader', () => {
  const msg = 'The vault file is not in a known format.';
  expectPlain(() => storeHeader('x'.repeat(60)), msg);
  expectPlain(() => storeHeader(Buffer.alloc(28, 1)), msg);
  assert.deepEqual(storeHeader(Buffer.alloc(29, 1)), { version: 1, salt: null, offset: 1 });
  const b44 = Buffer.alloc(44, 7); b44[0] = 2;
  expectPlain(() => storeHeader(b44), msg);
  const b = crypto.randomBytes(45); b[0] = 2;
  const h = storeHeader(b);
  assert.equal(h.version, 2); assert.equal(h.offset, 17);
  assert.deepEqual(Buffer.from(h.salt), b.subarray(1, 17));
  b[1] ^= 0xff; assert.equal(h.salt[0], b[1], 'salt is a view into buf');
  const b3 = Buffer.alloc(60, 0); b3[0] = 3; expectPlain(() => storeHeader(b3), msg);
});

test('contract §3.4/3.5/1.6: encryptStore / decryptStore', () => {
  const k = parseKey(newKey()); const wrong = parseKey(newKey());
  const data = { hello: 'world', n: [1, 2] };
  const f1 = encryptStore(k, data);
  assert.equal(f1[0], 1);
  assert.notDeepEqual(encryptStore(k, data), f1, 'fresh IV');
  assert.deepEqual(decryptStore([k], f1), data);
  assert.deepEqual(decryptStore([wrong, k], f1), data);
  expectPlain(() => decryptStore([wrong], f1), 'The vault cannot be opened with this key.');
  const salt = crypto.randomBytes(16); const pk = deriveKey(PW1, salt);
  const f2 = encryptStore(pk, data, { salt });
  assert.equal(f2[0], 2); assert.deepEqual(Buffer.from(storeHeader(f2).salt), salt);
  assert.deepEqual(decryptStore([deriveKey(PW1, storeHeader(f2).salt)], f2), data);
  expectPlain(() => decryptStore([wrong], f2), 'Wrong passphrase.');
  for (const i of [0, 1, 5, 14, 20, f1.length - 1]) { const c = Buffer.from(f1); c[i] ^= 1; assert.throws(() => decryptStore([k], c), `flip f1[${i}]`); }
  for (const i of [0, 1, 10, 20, 35, 50, f2.length - 1]) { const c = Buffer.from(f2); c[i] ^= 1; assert.throws(() => decryptStore([pk], c), `flip f2[${i}]`); }
  const relab2 = Buffer.concat([Buffer.from([2]), salt, f1.subarray(1)]);
  assert.throws(() => decryptStore([k], relab2)); assert.throws(() => decryptStore([pk], relab2));
  const relab1 = Buffer.concat([Buffer.from([1]), f2.subarray(17)]);
  assert.throws(() => decryptStore([pk], relab1));
});

test('contract §3.6: vaultInstructions', () => {
  const cli = '/opt/pocket/scripts/pocket-vault.mjs';
  const a = vaultInstructions(cli, null);
  assert.equal(typeof a, 'string');
  assert.match(a, /`node \S+ run --env VAR=<name>\[\.field\] -- <command…>`/);
  assert.match(a, /`node \S+ put <name> --kind <api_key\|token\|login\|credentials\|note> --stdin`/);
  assert.ok(a.includes('skills/pocket-vault/SKILL.md'));
  assert.ok(a.endsWith(' Pass --cwd when the command depends on the working directory.'));
  assert.ok(!vaultInstructions(cli, 'sess-1').endsWith(' Pass --cwd when the command depends on the working directory.'));
});

// ============================================================================================ §1.4 constructor
test('contract §1.4: constructor cases', () => {
  const s = setup();
  for (const bad of ['string-key', Buffer.alloc(16), 42]) expectPlain(() => new VaultStore(path.join(s.dir, 'x.enc'), { key: bad }), 'A 32-byte key is required.');
  expectPlain(() => new VaultStore(path.join(s.dir, 'none.enc'), { key: null }), 'POCKET_VAULT_KEY is not set.');
  // missing file + key
  assert.deepEqual(s.store.items, []); assert.equal(s.store.mode, 'key'); assert.equal(s.store.locked, false);
  assert.equal(s.store.openedWith, null); assert.ok(!fs.existsSync(s.file), 'no file written at construction');
  assert.deepEqual(s.store.envKey, s.key); assert.equal(s.store.salt, null); assert.equal(s.store.running, 0);
  assert.ok(s.store.requests instanceof Map);
  addLogin(s.store);
  assert.ok(fs.existsSync(s.file));
  // format 1 cases
  expectPlain(() => new VaultStore(s.file, { key: null }), 'POCKET_VAULT_KEY is not set.');
  expectPlain(() => new VaultStore(s.file, { key: parseKey(newKey()) }), 'The vault cannot be opened with this key.');
  const viaOld = new VaultStore(s.file, { key: parseKey(newKey()), oldKeys: [parseKey(newKey()), s.key], auditFile: s.auditFile });
  assert.deepEqual(viaOld.openedWith, s.key); assert.equal(viaOld.items.length, 1);
  const direct = s.restart(); assert.deepEqual(direct.openedWith, s.key);
  // garbage
  const g = path.join(s.dir, 'garbage.enc'); fs.writeFileSync(g, 'hello');
  expectPlain(() => new VaultStore(g, { key: s.key }), 'The vault file is not in a known format.');
  // format 2
  s.store.setPassphrase(PW1, PW1);
  const salt = Buffer.from(storeHeader(s.bytes()).salt);
  const p = s.restart({ key: parseKey(newKey()) });
  assert.equal(p.locked, true); assert.equal(p.items, null); assert.equal(p.mode, 'passphrase');
  assert.deepEqual(Buffer.from(p.salt), salt);
  const pn = new VaultStore(s.file, { key: null, oldKeys: [s.key], auditFile: s.auditFile });
  assert.deepEqual(pn.keys, []); assert.equal(pn.locked, true);
  // null plaintext → TypeError
  const nf = path.join(s.dir, 'null.enc'); fs.writeFileSync(nf, encryptStore(s.key, null));
  assert.throws(() => new VaultStore(nf, { key: s.key }), TypeError);
});

test('contract §1.4: default writer (mode 0600, mkdir, atomic rename, .tmp left on failure)', () => {
  const dir = mkdir();
  const file = path.join(dir, 'sub', 'deeper', 'vault.enc');
  const key = parseKey(newKey());
  const store = new VaultStore(file, { key, auditFile: path.join(dir, 'a.jsonl'), now: () => T0 });
  addLogin(store);
  assert.ok(fs.existsSync(file));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.ok(!fs.existsSync(file + '.tmp'));
  assert.equal(decryptStore([key], fs.readFileSync(file)).items.length, 1);
  const before = fs.readFileSync(file); const itemsBefore = store.items;
  const restore = patchFs('renameSync', (orig) => function (a, b) { if (String(a) === file + '.tmp') throw new Error('injected rename failure'); return orig.call(this, a, b); });
  let e;
  try { e = catchErr(() => addKey(store)); } finally { restore(); }
  assert.equal(e.message, 'injected rename failure');
  assert.deepEqual(fs.readFileSync(file), before);
  assert.ok(fs.existsSync(file + '.tmp'), '.tmp left behind');
  assert.equal(store.items, itemsBefore); assert.equal(store.items.length, 1);
  assert.equal(new VaultStore(file, { key }).items.length, 1);
});

test('contract §2.2: load()/normalize of a crafted file; legacy ask → default', () => {
  const s = setup();
  craft(s, [
    { id: 'aaaaaaaaaaaa', name: 'ok', kind: 'weird', values: { text: 5, extra: 'drop' }, custom: ['x', 'x', 'text', 'Bad'],
      notes: ' ' + 'n'.repeat(2500), tags: [' A ', 5, '', 'b'.repeat(50)], policy: 'nope', recipes: [null, { argv: 'no' }, { argv: ['a'] }],
      expiresAt: 'garbage', revision: 0, url: '  https://e/' + 'u'.repeat(600), keep: 'me' },
    { id: 5, name: 'noid' }, { id: 'bbbbbbbbbbbb', name: 'BAD' }, null,
    { id: 'cccccccccccc', name: 'asky', kind: 'note', values: { text: 'a' }, policy: 'ask', revision: 4 },
  ]);
  const st = s.store;
  assert.equal(st.items.length, 2);
  const it = st.items.find((i) => i.name === 'ok');
  assert.equal(it.kind, 'note');
  assert.deepEqual(it.custom, ['x']);
  assert.deepEqual(it.values, { text: '', x: '' });
  assert.equal(it.notes.length, 2000); assert.ok(it.notes.startsWith('n'));
  assert.deepEqual(it.tags, ['A', 'b'.repeat(40)]);
  assert.equal(it.policy, 'default');
  assert.deepEqual(it.recipes, [{ argv: ['a'] }]);
  assert.equal(it.expiresAt, null); assert.equal(it.revision, 1);
  assert.equal(it.lastUsedAt, null); assert.equal(it.lastUsedBy, null); assert.equal(it.trashedAt, null);
  assert.equal(it.url.length, 500); assert.ok(it.url.startsWith('https://e/'));
  assert.equal(it.keep, 'me');
  const asky = st.items.find((i) => i.name === 'asky');
  assert.equal(asky.policy, 'ask'); assert.equal(asky.revision, 4);
  const s2 = setup();
  craft(s2, [{ id: 'dddddddddddd', name: 'leg', kind: 'note', values: { text: 'a' }, policy: 'ask' }], 1);
  assert.equal(s2.store.items[0].policy, 'default');
  // falsy JSON "items" → []
  fs.writeFileSync(s2.file, encryptStore(s2.key, { version: 2, items: 'nope' }));
  assert.deepEqual(s2.mk().items, []);
});

// ============================================================================================ §2 state model
test('contract §2.1: lastActivityAt touched only by open()-calling methods', () => {
  const s = setup(); const st = s.store;
  addLogin(st);
  const id = st.byName('gh').id;
  const check = (label, fn, touch) => {
    s.clk.t += 1000; const before = st.lastActivityAt; const r = fn();
    assert.equal(st.lastActivityAt, touch ? s.clk.t : before, `${label} should ${touch ? '' : 'not '}touch lastActivityAt`);
    return r;
  };
  check('get', () => st.get(id), true);
  check('byName', () => st.byName('gh'), true);
  check('snapshot', () => st.snapshot(), true);
  const bound = check('resolveBindings', () => st.resolveBindings({ TOKEN: 'gh.password' }), true);
  const cmd = { argv: ['echo', 'hi'], cwd: s.dir, action: 'run' };
  check('view', () => st.view(st.items[0]), false);
  check('auditRows', () => st.auditRows({ owner: true }), false);
  const need = check('decide', () => st.decide(bound, cmd), false);
  assert.equal(need.length, 1);
  const row = check('request', () => st.request({ bound, cmd, need, env: { TOKEN: 'gh.password' }, session: 's1' }), false);
  check('pendingFor', () => st.pendingFor('s1'), false);
  check('expireRequests', () => st.expireRequests(), false);
  check('idleLockDue', () => st.idleLockDue(5), false);
  check('purge (nothing)', () => st.purge(), false);
  check('unlock (already unlocked)', () => assert.equal(st.unlock('whatever-long-pw'), true), false);
  check("answer('once')", () => st.answer(row.id, 'once'), false);
  const r2 = check('request', () => st.request({ bound, cmd: { ...cmd, argv: ['echo', 'two'] }, need, env: {}, session: 's1' }), false);
  check("answer('deny')", () => st.answer(r2.id, 'deny'), false);
  const r3 = st.request({ bound, cmd: { ...cmd, argv: ['echo', 'three'] }, need, env: {}, session: 's1' });
  check("answer('always')", () => st.answer(r3.id, 'always'), true);
});

test('contract §2.3/5.1: effective policy, view, policyWord, expiring', () => {
  const s = setup(); const st = s.store;
  addKey(st, 'k', 'api-key-value-123', { notes: 'secret notes' });
  const it = () => st.byName('k');
  assert.equal(st.view(it()).effectivePolicy, 'ask');
  for (const [acc, eff] of [['free', 'auto'], ['once', 'ask'], ['every', 'every'], ['bogus', 'ask'], [undefined, 'ask']]) {
    st.access = () => acc; assert.equal(st.view(it()).effectivePolicy, eff, `access ${acc}`);
  }
  st.access = () => 'once';
  for (const [pol, word] of [['auto', 'Free rein'], ['ask', 'Asks once per command'], ['every', 'Asks every time'], ['owner', 'Only you']]) {
    st.act({ action: 'update', item: it().id, policy: pol });
    const v = st.view(it()); assert.equal(v.effectivePolicy, pol); assert.equal(v.policyWord, word);
  }
  const v = st.view(it());
  assert.ok(!('values' in v)); assert.ok(!('notes' in v));
  assert.deepEqual(v.fields, ['value']); assert.deepEqual(v.custom, []);
  for (const k of ['recipes', 'lastUsedBy', 'by', 'revision']) assert.ok(k in v, `view has ${k}`);
  assert.equal(st.view(it(), { owner: true }).notes, 'secret notes');
  const exp = (when) => { st.act({ action: 'update', item: it().id, expiresAt: when }); return st.view(it()).expiring; };
  assert.equal(exp(ISO(T0 + 13 * DAY)), true);
  assert.equal(exp(ISO(T0 + 15 * DAY)), false);
  assert.equal(exp(ISO(T0 - DAY)), true);
  assert.equal(exp(null), false);
  assert.equal(st.view(it(), { now: T0 + 2 * DAY }).expiring, false);
});

test('contract §2.5: audit rows, key stripping, torn line, write loop, write returning 0', () => {
  const s = setup(); const st = s.store;
  fs.writeFileSync(s.auditFile, '{"at":"x","action":"torn"');
  addLogin(st, 'gh', {}, { actor: 'agent', session: 's1', sessionTitle: 'T' });
  const raw = fs.readFileSync(s.auditFile, 'utf8').split('\n');
  assert.equal(raw[0], '{"at":"x","action":"torn"');
  const put = JSON.parse(raw[1]);
  assert.deepEqual(put, { at: ISO(T0), action: 'put', item: st.byName('gh').id, name: 'gh', by: 'agent', session: 's1', sessionTitle: 'T' });
  assert.ok(!fs.readFileSync(s.auditFile, 'utf8').includes(LOGIN.password), 'never a value');
  addKey(st); // owner: session null, sessionTitle '' removed
  const r = s.rows().at(-1);
  assert.ok(!('session' in r) && !('sessionTitle' in r));
  assert.equal(r.by, 'owner');
  // partial writes are looped to completion
  let auditFd = null;
  const r1 = patchFs('openSync', (orig) => function (p, ...rest) { const fd = orig.call(this, p, ...rest); if (String(p) === s.auditFile) auditFd = fd; return fd; });
  const r2 = patchFs('writeSync', (orig) => function (fd, data, ...rest) {
    if (fd === auditFd && typeof data !== 'string' && ArrayBuffer.isView(data)) {
      const off = typeof rest[0] === 'number' ? rest[0] : (rest[0]?.offset ?? 0);
      return orig.call(this, fd, data, off, 1);
    }
    return orig.call(this, fd, data, ...rest);
  });
  try { addKey(st, 'k2'); } finally { r2(); r1(); }
  assert.equal(s.rows().at(-1).name, 'k2', 'row intact after partial writes');
  // a write returning 0 → plain Error
  auditFd = null;
  const r3 = patchFs('openSync', (orig) => function (p, ...rest) { const fd = orig.call(this, p, ...rest); if (String(p) === s.auditFile) auditFd = fd; return fd; });
  const r4 = patchFs('writeSync', (orig) => function (fd, ...rest) { if (fd === auditFd) return 0; return orig.call(this, fd, ...rest); });
  let e;
  try { e = catchErr(() => addKey(st, 'k3')); } finally { r4(); r3(); }
  assert.equal(e.message, 'The Vault record could not be written.'); assert.equal(e.status, undefined);
  assert.equal(st.byName('k3'), null);
});

test('contract §2.5: auditRows filters, order, limits', () => {
  const s = setup(); const st = s.store;
  assert.deepEqual(st.auditRows({ owner: true }), [], 'missing file → []');
  addLogin(st, 'gh', {}, { actor: 'agent', session: 's1', sessionTitle: 'T1' });
  addKey(st, 'k', 'api-key-value-123');
  fs.appendFileSync(s.auditFile, '\n\nnot json\n');
  addLogin(st, 'gh2', {}, { actor: 'agent', session: 's2', sessionTitle: 'T2' });
  const all = st.auditRows({ owner: true });
  assert.deepEqual(all.map((r) => r.name), ['gh2', 'k', 'gh']);
  assert.deepEqual(st.auditRows({ session: 's1' }).map((r) => r.name), ['gh']);
  assert.deepEqual(st.auditRows({}), []);
  assert.deepEqual(st.auditRows({ owner: true, item: st.byName('k').id }).map((r) => r.name), ['k']);
  assert.equal(st.auditRows({ owner: true, limit: 2 }).length, 2);
  assert.ok(st.auditRows({ owner: true, limit: 0 }).length <= 1);
  assert.ok(st.auditRows({ owner: true, limit: -5 }).length <= 1);
  const lines = Array.from({ length: 250 }, (_, i) => JSON.stringify({ at: ISO(T0), action: 'put', name: `n${i}` })).join('\n') + '\n';
  fs.writeFileSync(s.auditFile, lines);
  assert.equal(st.auditRows({ owner: true, limit: 500 }).length, 200);
  assert.equal(st.auditRows({ owner: true }).length, 50);
  assert.equal(st.auditRows({ owner: true })[0].name, 'n249');
  st.setPassphrase(PW1, PW1); st.lock();
  assert.equal(st.auditRows({ owner: true }).length, 50, 'works while locked');
});

// ============================================================================================ §4 contract
test('contract §4.1/4.2: unlock and lock', () => {
  const s = pwSetup();
  expectFail(() => setup().store.lock(), 400, 'The Vault is opened by the server key; set a passphrase to be able to lock it.');
  const st = s.store; const D = s.bytes(); const salt = st.salt; const envKey = st.envKey;
  const n = s.rows().length;
  assert.equal(st.lock(), undefined);
  assert.equal(st.locked, true); assert.deepEqual(st.keys, []); assert.equal(st.salt, salt); assert.equal(st.envKey, envKey);
  assert.equal(s.rows().length, n + 1); assert.equal(s.rows().at(-1).action, 'lock'); assert.equal(s.rows().at(-1).by, 'owner');
  assert.equal(st.lock(), undefined); assert.equal(s.rows().length, n + 1, 'second lock writes nothing');
  expectFail(() => st.get('x'), 423, 'The Vault is locked. Ask the owner to unlock it in Pocket Code.', 'vault_locked');
  expectFail(() => st.snapshot(), 423, 'The Vault is locked. Ask the owner to unlock it in Pocket Code.', 'vault_locked');
  expectFail(() => st.act({ action: 'add', name: 'x', kind: 'note', values: { text: 'x' } }), 423, 'The Vault is locked. Ask the owner to unlock it in Pocket Code.', 'vault_locked');
  expectFail(() => st.unlock('short'), 400, 'The passphrase must be at least 12 characters.');
  assert.equal(s.rows().length, n + 1, 'short passphrase: no audit');
  expectFail(() => st.unlock(PW2), 401, 'Wrong passphrase.');
  assert.equal(s.rows().at(-1).action, 'unlock-failed'); assert.equal(s.rows().at(-1).by, 'owner');
  assert.equal(st.locked, true);
  s.clk.t += 5000;
  assert.equal(st.unlock(PW1), true);
  assert.equal(st.locked, false); assert.equal(st.items.length, 1); assert.equal(st.lastActivityAt, s.clk.t);
  assert.deepEqual(st.keys, [deriveKey(PW1, storeHeader(D).salt)]); assert.equal(st.envKey, envKey);
  assert.equal(s.rows().at(-1).action, 'unlock');
  const n2 = s.rows().length;
  assert.equal(st.unlock('anything-at-all'), true); assert.equal(s.rows().length, n2);
  assert.equal(setup().store.unlock('x'), true, 'key mode: always true');
  assert.deepEqual(s.bytes(), D, 'unlock/lock never change D');
});

test('contract §4.3/4.4: setPassphrase and checkPassphrase', () => {
  const s = setup(); const st = s.store; addLogin(st);
  assert.equal(st.checkPassphrase(PW1), false, 'key mode');
  expectFail(() => st.setPassphrase(PW1, PW2), 400, 'The passphrases do not match.');
  expectFail(() => st.setPassphrase('short', 'short'), 400, 'The passphrase must be at least 12 characters.');
  assert.equal(st.mode, 'key');
  assert.equal(st.setPassphrase(PW1, PW1), undefined);
  assert.equal(st.mode, 'passphrase'); assert.equal(storeHeader(s.bytes()).version, 2);
  assert.deepEqual(Buffer.from(st.salt), Buffer.from(storeHeader(s.bytes()).salt));
  assert.deepEqual(st.keys, [deriveKey(PW1, st.salt)]);
  assert.equal(s.openPw(PW1).items.length, 1);
  assert.equal(s.rows().at(-1).action, 'passphrase-set'); assert.equal(s.rows().at(-1).by, 'owner');
  assert.equal(st.checkPassphrase(PW1), true); assert.equal(st.checkPassphrase(PW2), false); assert.equal(st.checkPassphrase('short'), false);
  const oldSalt = Buffer.from(st.salt);
  st.setPassphrase(PW2, PW2); // passphrase mode: change without current one
  assert.notDeepEqual(Buffer.from(st.salt), oldSalt);
  assert.equal(s.openPw(PW2).items.length, 1); assert.throws(() => s.openPw(PW1));
  st.lock();
  const n = s.rows().length; const la = st.lastActivityAt; s.clk.t += 1000;
  assert.equal(st.checkPassphrase(PW2), true, 'works while locked');
  assert.equal(s.rows().length, n); assert.equal(st.lastActivityAt, la);
  expectFail(() => st.setPassphrase(PW1, PW1), 423, 'The Vault is locked. Ask the owner to unlock it in Pocket Code.', 'vault_locked');
});

test('contract §4.5: removePassphrase', () => {
  const s = pwSetup(); const st = s.store;
  expectFail(() => setup().store.removePassphrase(PW1), 400, 'The Vault is not protected by a passphrase.');
  const n = s.rows().length;
  expectFail(() => st.removePassphrase(PW2), 401, 'Wrong passphrase.');
  expectFail(() => st.removePassphrase('short'), 401, 'Wrong passphrase.');
  assert.equal(s.rows().length, n, 'no audit row for a wrong passphrase');
  assert.equal(st.removePassphrase(PW1), undefined);
  assert.equal(st.mode, 'key'); assert.equal(st.salt, null); assert.deepEqual(st.keys, [s.key]);
  assert.equal(storeHeader(s.bytes()).version, 1); assert.equal(s.openK().items.length, 1);
  assert.equal(s.rows().at(-1).action, 'passphrase-removed');
  const R = s.restart(); assert.equal(R.locked, false); assert.deepEqual(R.openedWith, s.key);
  // no envKey
  const s2 = pwSetup();
  const nk = new VaultStore(s2.file, { key: null, auditFile: s2.auditFile, write: s2.write });
  nk.unlock(PW1);
  expectFail(() => nk.removePassphrase(PW1), 409, 'POCKET_VAULT_KEY is not set, so the Vault cannot go back to the server key.', 'vault_no_key');
  nk.lock();
  expectFail(() => nk.removePassphrase(PW1), 423, 'The Vault is locked. Ask the owner to unlock it in Pocket Code.', 'vault_locked');
});

test('contract §4.6: idleLockDue', () => {
  const s = pwSetup(); const st = s.store; const t = st.lastActivityAt;
  assert.equal(t, T0);
  assert.equal(st.idleLockDue(5, t + 5 * MIN - 1), false);
  assert.equal(st.idleLockDue(5, t + 5 * MIN), true);
  assert.equal(st.idleLockDue(0, t + DAY), false);
  assert.equal(st.idleLockDue(-1, t + DAY), false);
  s.clk.t = t + 10 * MIN; assert.equal(st.idleLockDue(5), true, 'default now = store.now()');
  assert.equal(st.locked, false, 'does not lock by itself');
  st.lock(); assert.equal(st.idleLockDue(5, t + DAY), false, 'locked');
  const k = setup(); assert.equal(k.store.idleLockDue(5, T0 + DAY), false, 'key mode');
});

test('contract §4.7/4.8: save and rotate', () => {
  const s = setup(); const st = s.store; addLogin(st);
  s.clk.t += 3000;
  st.save();
  const plain = s.openK();
  assert.equal(plain.version, 2); assert.equal(plain.savedAt, ISO(s.clk.t)); assert.equal(plain.items.length, 1);
  assert.equal(st.lastActivityAt, s.clk.t);
  const old = s.key; const raw = newKey();
  expectPlain(() => st.rotate('abcd'), 'POCKET_VAULT_KEY must be 32 random bytes, base64 (openssl rand -base64 32).');
  expectPlain(() => st.rotate(''), 'POCKET_VAULT_KEY is not set.');
  const k = st.rotate(raw);
  assert.deepEqual(k, parseKey(raw));
  assert.deepEqual(st.keys, [k, old]); assert.deepEqual(st.envKey, k);
  assert.equal(s.openK(k).items.length, 1); assert.throws(() => s.openK(old));
  expectPlain(() => s.restart({ key: old }), 'The vault cannot be opened with this key.');
  assert.equal(s.restart({ key: k }).items.length, 1);
  const p = pwSetup();
  expectFail(() => p.store.rotate(newKey()), 400, 'Rotation applies to the server key; the Vault is protected by a passphrase.');
});

test('contract §4.9: exportBundle', () => {
  const s = setup(); const st = s.store;
  addLogin(st, 'gh', { notes: 'n1', tags: 'a,b' }); addKey(st, 'k');
  const bound = st.resolveBindings({ T: 'gh.password' });
  st.release(bound, { argv: ['x'], cwd: s.dir }, { session: 's1' });
  st.act({ action: 'remove', item: st.byName('k').id });
  const D = s.bytes();
  expectFail(() => st.exportBundle(PW1, PW2), 400, 'The passphrases do not match.');
  expectFail(() => st.exportBundle('short', 'short'), 400, 'The passphrase must be at least 12 characters.');
  s.clk.t += 7000;
  const buf = st.exportBundle(PW1, PW1);
  assert.ok(Buffer.isBuffer(buf)); assert.equal(storeHeader(buf).version, 2);
  const data = decryptStore([deriveKey(PW1, storeHeader(buf).salt)], buf);
  assert.equal(data.format, 'pocket-vault-export'); assert.equal(data.version, 2); assert.equal(data.exportedAt, ISO(s.clk.t));
  assert.equal(data.items.length, 1);
  const it = data.items[0]; const live = st.byName('gh');
  for (const k of ['lastUsedAt', 'lastUsedBy', 'trashedAt']) assert.ok(!(k in it), `${k} stripped`);
  for (const k of ['id', 'values', 'notes', 'recipes', 'policy', 'revision', 'created', 'updated', 'by', 'tags']) assert.deepEqual(it[k], live[k], k);
  const row = s.rows().at(-1);
  assert.equal(row.action, 'export'); assert.equal(row.by, 'owner'); assert.equal(row.decision, '1');
  assert.deepEqual(s.bytes(), D, 'no file write');
});

test('contract §4.10: importBundle', () => {
  const s = setup(); const st = s.store;
  addLogin(st, 'gh'); addKey(st, 'old'); st.act({ action: 'remove', item: st.byName('old').id });
  const notExport = 'That is not a Vault export file.';
  expectFail(() => st.importBundle(Buffer.from('nope'), PW1), 400, notExport);
  expectFail(() => st.importBundle(encryptStore(s.key, { format: EXPORT_FORMAT, items: [] }), PW1), 400, notExport);
  const good = bundle(PW1, []);
  expectFail(() => st.importBundle(good, PW2), 400, 'Wrong passphrase.');
  expectFail(() => st.importBundle(good, 'short'), 400, notExport);
  expectFail(() => st.importBundle(bundle(PW1, [], { format: 'other' }), PW1), 400, notExport);
  expectFail(() => st.importBundle(bundle(PW1, 'x'), PW1), 400, notExport);
  // a passphrase-mode vault.enc is refused
  const p = pwSetup();
  expectFail(() => st.importBundle(p.bytes(), PW1), 400, notExport);
  s.clk.t += 9000;
  const res = st.importBundle(bundle(PW1, [
    'not-an-object', 7,
    { name: 'Upper', kind: 'note', values: { text: 'x' } },
    { name: 'gh', kind: 'note', values: { text: 'x' } },
    { name: 'old', kind: 'note', values: { text: 'x' } },
    { id: 'ffffffffffff', name: 'imp', kind: 'api_key', values: { value: 'imported-value-1' }, policy: 'auto', tags: ['A'],
      created: '2025-01-01T00:00:00Z', revision: 7, lastUsedAt: '2025-02-02T00:00:00Z', trashedAt: '2025-03-03T00:00:00Z',
      extra: 'kept', notes: 'z'.repeat(2100), by: 'agent' },
    { name: 'imp', kind: 'note', values: { text: 'dup' } },
    { name: 'emptyok', kind: 'login', values: { username: 'u', password: '' } },
  ]), PW1);
  assert.deepEqual(res, { added: 2, skipped: ['gh', 'old', 'imp'] });
  const imp = st.byName('imp');
  assert.match(imp.id, /^[0-9a-f]{12}$/); assert.notEqual(imp.id, 'ffffffffffff');
  assert.equal(imp.revision, 1); assert.equal(imp.created, '2025-01-01T00:00:00Z'); assert.equal(imp.updated, ISO(s.clk.t));
  assert.equal(imp.lastUsedAt, null); assert.equal(imp.trashedAt, null); assert.equal(imp.lastUsedBy, null);
  assert.equal(imp.policy, 'auto'); assert.deepEqual(imp.tags, ['A']); assert.equal(imp.extra, 'kept');
  assert.equal(imp.notes.length, 2000); assert.equal(imp.by, 'agent');
  assert.equal(st.byName('emptyok').values.password, '');
  assert.equal(st.byName('upper'), null);
  const row = s.rows().at(-1);
  assert.equal(row.action, 'import'); assert.equal(row.by, 'owner'); assert.equal(row.decision, '2 added, 3 skipped');
  assert.ok(s.openK().items.some((i) => i.name === 'imp'));
  // legacy bundle: ask → default; nothing added → no save
  const lg = st.importBundle(bundle(PW1, [{ name: 'leg', kind: 'note', values: { text: 't' }, policy: 'ask' }], { version: 1 }), PW1);
  assert.equal(lg.added, 1); assert.equal(st.byName('leg').policy, 'default');
  const w = s.ctl.writes; const D = s.bytes();
  assert.deepEqual(st.importBundle(bundle(PW1, [{ name: 'gh', kind: 'note', values: { text: 'x' } }]), PW1), { added: 0, skipped: ['gh'] });
  assert.equal(s.ctl.writes, w); assert.deepEqual(s.bytes(), D);
  // value check message
  expectFail(() => st.importBundle(bundle(PW1, [{ name: 'gh9', kind: 'login', values: { username: 'u', password: '{{vault:gh}}' } }]), PW1),
    400, 'gh9: The password looks like a placeholder, not a value.');
  p.store.lock();
  expectFail(() => p.store.importBundle(good, PW1), 423, 'The Vault is locked. Ask the owner to unlock it in Pocket Code.', 'vault_locked');
});

// ============================================================================================ §5 contract
test('contract §5.1: get / byName / snapshot', () => {
  const s = setup(); const st = s.store;
  addKey(st, 'zeta'); addKey(st, 'alpha'); addKey(st, 'mid'); addKey(st, 'gone1'); addKey(st, 'gone2');
  s.clk.t += 1000; st.act({ action: 'remove', item: st.byName('gone1').id });
  s.clk.t += 1000; st.act({ action: 'remove', item: st.byName('gone2').id });
  const g1 = st.items.find((i) => i.name === 'gone1');
  assert.equal(st.get(g1.id), g1, 'get returns trashed');
  assert.equal(st.byName('gone1'), null);
  expectFail(() => st.get('nope'), 404, 'That item does not exist.');
  const snap = st.snapshot({ owner: true });
  assert.equal(snap.version, 1); assert.equal(snap.now, s.clk.t); assert.equal(snap.ready, true); assert.equal(snap.access, 'once');
  assert.deepEqual(snap.items.map((i) => i.name), ['alpha', 'mid', 'zeta']);
  assert.deepEqual(snap.trash.map((i) => i.name), ['gone2', 'gone1']);
  assert.deepEqual(snap.requests, []); assert.equal(snap.openRequests, 0);
  assert.deepEqual(st.snapshot().trash, []);
  st.access = () => 'weird'; assert.equal(st.snapshot().access, 'once');
  st.access = () => 'free'; assert.equal(st.snapshot().access, 'free');
  st.access = () => 'once';
  st.act({ action: 'update', item: st.byName('alpha').id, policy: 'ask' });
  const { row } = mkRequest(s, { env: { A: 'alpha' } });
  const sn = st.snapshot({ owner: true });
  assert.equal(sn.openRequests, 1);
  const rv = sn.requests[0];
  for (const k of ['env', 'waiters', 'caller', 'bindings']) assert.ok(!(k in rv), `requestView hides ${k}`);
  assert.equal(rv.pending, true); assert.equal(rv.allowAlways, true); assert.equal(rv.id, row.id);
  st.answer(row.id, 'deny');
  assert.equal(st.snapshot({ owner: true }).openRequests, 0);
});

test('contract §5.2: act common + add', () => {
  const s = setup(); const st = s.store;
  expectFail(() => st.act({ action: 'frobnicate' }), 400, 'Unknown action.');
  expectFail(() => st.act({ action: 5 }), 400, 'Unknown action.');
  const nameMsg = 'The name must be 1 to 64 characters: lower-case letters, digits and hyphens.';
  for (const n of ['', '-x', 'a_b', 'a'.repeat(65), 'a b']) expectFail(() => st.act({ action: 'add', name: n, kind: 'note', values: { text: 'x' } }), 400, nameMsg);
  const v = st.act({ action: 'add', name: '  GitHub ', kind: 'login', values: { ...LOGIN }, notes: '  my notes  ', tags: 'Prod, prod ,CI,,', policy: 'auto',
    url: '  https://github.com  ', expiresAt: '2026-03-01T10:20:30.456Z' });
  assert.equal(v.name, 'github'); assert.ok(!('values' in v)); assert.equal(v.notes, 'my notes');
  const it = st.byName('github');
  assert.match(it.id, /^[0-9a-f]{12}$/);
  assert.equal(it.kind, 'login'); assert.deepEqual(it.custom, []); assert.deepEqual(it.values, LOGIN);
  assert.equal(it.url, 'https://github.com'); assert.equal(it.notes, 'my notes'); assert.deepEqual(it.tags, ['prod', 'ci']);
  assert.equal(it.policy, 'auto'); assert.deepEqual(it.recipes, []); assert.equal(it.expiresAt, '2026-03-01T10:20:30Z');
  assert.equal(it.created, ISO(T0)); assert.equal(it.updated, ISO(T0)); assert.equal(it.by, 'owner');
  assert.equal(it.lastUsedAt, null); assert.equal(it.lastUsedBy, null); assert.equal(it.trashedAt, null); assert.equal(it.revision, 1);
  assert.ok(st.act({ action: 'add', name: 'a'.repeat(64), kind: 'note', values: { text: 'x' } }));
  expectFail(() => addLogin(st, 'github'), 409, 'An item with that name already exists.');
  expectFail(() => addLogin(st, 'github', {}, { actor: 'agent', session: 's1' }), 409, 'An item named github already exists; agents cannot replace it. Use another name or ask the owner.');
  st.act({ action: 'remove', item: it.id });
  expectFail(() => addLogin(st, 'github'), 409, 'An item with that name already exists.', undefined);
  expectFail(() => st.act({ action: 'add', name: 'x1', kind: 'bogus', values: {} }), 400, 'The kind must be api_key, token, login, credentials or note.');
  expectFail(() => st.act({ action: 'add', name: 'x1', kind: 'note', values: { text: 'x' }, notes: 'n'.repeat(2001) }), 400, 'Notes can be up to 2,000 characters.');
  expectFail(() => st.act({ action: 'add', name: 'x1', kind: 'note', values: { text: 'x' }, expiresAt: 'not a date' }), 400, 'The expiry must be a date.');
  st.act({ action: 'add', name: 'pol', kind: 'note', values: { text: 'x' }, policy: 'bogus' });
  assert.equal(st.byName('pol').policy, 'default', 'invalid owner policy silently default');
  st.act({ action: 'add', name: 'ag', kind: 'note', values: { text: 'x' }, policy: 'auto', notes: 'agent notes' }, { actor: 'agent', session: 's1', sessionTitle: 'T' });
  const ag = st.byName('ag');
  assert.equal(ag.by, 'agent'); assert.equal(ag.policy, 'default'); assert.equal(ag.notes, '');
  st.act({ action: 'add', name: 'term', kind: 'note', values: { text: 'x' } }, { actor: 'cli' });
  assert.equal(st.byName('term').by, 'terminal');
  st.act({ action: 'add', name: 'big', kind: 'note', values: { text: 'x' }, url: 'u'.repeat(600), tags: Array.from({ length: 30 }, (_, i) => `T${i}` + 'x'.repeat(50)) });
  assert.equal(st.byName('big').url.length, 500); assert.equal(st.byName('big').tags.length, 20); assert.equal(st.byName('big').tags[0].length, 40);
  assert.equal(st.byName('big').tags[0], ('t0' + 'x'.repeat(50)).slice(0, 40));
});

test('contract §5.2/5.3: add value checks', () => {
  const s = setup(); const st = s.store;
  const add = (kind, values, name = 'x') => () => st.act({ action: 'add', name, kind, values });
  expectFail(add('login', { password: 'p-123456' }), 400, 'The username is required.');
  expectFail(add('login', { username: '  ', password: 'p' }), 400, 'The username is required.');
  expectFail(add('api_key', { value: 'v'.repeat(65537) }), 400, 'The value is too long.');
  expectFail(add('api_key', { value: 'abc {{vault:gh}}' }), 400, 'The value looks like a placeholder, not a value.');
  expectFail(add('credentials', { 'Bad-Name': 'v' }), 400, 'Bad-Name is not a field name: lowercase letters, digits and underscores, up to 32 characters, starting with a letter.');
  expectFail(add('credentials', { client_id: '' }), 400, 'The client_id field needs a value.');
  expectFail(add('credentials', {}), 400, 'Give at least one field, for example client_id.');
  const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${i}`, 'v']));
  expectFail(add('credentials', many), 400, 'An item can have up to 20 custom fields.');
  expectFail(add('credentials', { client_id: 'c'.repeat(65537) }), 400, 'The client_id is too long.');
  expectFail(add('credentials', { client_id: 'cid-1', other: 5 }), 400, 'The other field needs a value.');
  assert.equal(st.items.length, 0);
  st.act({ action: 'add', name: 'cr', kind: 'credentials', values: { client_id: 'cid-1', client_secret: 'csec-1' } });
  const cr = st.byName('cr');
  assert.deepEqual(cr.custom, ['client_id', 'client_secret']); assert.deepEqual(cr.values, { client_id: 'cid-1', client_secret: 'csec-1' });
  assert.deepEqual(st.view(cr).fields, ['client_id', 'client_secret']);
  st.act({ action: 'add', name: 'lg', kind: 'login', values: { ...LOGIN, username: 'u', api_url: 'https://e', } });
  assert.deepEqual(st.byName('lg').custom, ['api_url']);
  assert.deepEqual(Object.keys(st.byName('lg').values).sort(), ['api_url', 'password', 'username']);
  // 500-item limit (trashed count)
  const s5 = setup(); craft(s5, fakeItems(500));
  expectFail(() => addKey(s5.store, 'one-more'), 409, 'You can keep up to 500 items.');
});

test('contract §5.2: update / remove / restore / recipe-remove / answer via act', () => {
  const s = setup(); const st = s.store;
  addLogin(st, 'gh', { policy: 'ask' }); addKey(st, 'k');
  const id = st.byName('gh').id;
  const agent = { actor: 'agent', session: 's1' };
  for (const action of ['update', 'remove', 'restore', 'recipe-remove']) expectFail(() => st.act({ action, item: id, url: 'x' }, agent), 403, 'Agents cannot change items. Ask the owner.');
  expectFail(() => st.act({ action: 'answer', request: 'x', decision: 'once' }, agent), 403, 'Only the owner answers requests.');
  expectFail(() => st.act({ action: 'update', item: 'nope', url: 'x' }), 404, 'That item does not exist.');
  const e = expectFail(() => st.act({ action: 'update', item: id, url: 'x', expected_revision: 5 }), 409, 'This item changed since you loaded it. Review it and try again.');
  assert.equal(e.item.revision, 1); assert.equal(e.item.name, 'gh'); assert.ok(!('values' in e.item));
  // update steps
  s.clk.t += 1000;
  let v = st.act({ action: 'update', item: id, name: 'gh', expected_revision: 1 });
  assert.equal(v.revision, 2); assert.equal(st.get(id).updated, ISO(s.clk.t));
  expectFail(() => st.act({ action: 'update', item: id, name: 'k' }), 409, 'An item with that name already exists.');
  expectFail(() => st.act({ action: 'update', item: id, name: 'Bad Name' }), 400, 'The name must be 1 to 64 characters: lower-case letters, digits and hyphens.');
  expectFail(() => st.act({ action: 'update', item: id, removeFields: ['username'] }), 400, 'username is not a custom field of this item.');
  st.act({ action: 'update', item: id, values: { password: 'new-pass-123', api_url: 'https://e' } });
  assert.equal(st.get(id).values.password, 'new-pass-123'); assert.deepEqual(st.get(id).custom, ['api_url']);
  let row = s.rows().at(-1);
  assert.equal(row.action, 'update'); assert.equal(row.name, 'gh'); assert.equal(row.by, 'owner'); assert.deepEqual(row.fields, ['password', 'api_url']);
  st.act({ action: 'update', item: id, values: { password: '  ' } });
  assert.equal(st.get(id).values.password, '  ', "'  ' is stored");
  expectFail(() => st.act({ action: 'update', item: id, values: { password: '' } }), 400, 'Nothing to change.');
  expectFail(() => st.act({ action: 'update', item: id }), 400, 'Nothing to change.');
  st.act({ action: 'update', item: id, removeFields: ['api_url'] });
  assert.deepEqual(st.get(id).custom, []); assert.ok(!('api_url' in st.get(id).values));
  assert.deepEqual(s.rows().at(-1).fields, ['api_url']);
  st.act({ action: 'update', item: id, url: '  https://x  ' });
  assert.equal(st.get(id).url, 'https://x'); assert.ok(!('fields' in s.rows().at(-1)));
  expectFail(() => st.act({ action: 'update', item: id, notes: 'n'.repeat(2001) }), 400, 'Notes can be up to 2,000 characters.');
  st.act({ action: 'update', item: id, tags: ['B', 'b', ' c '] }); assert.deepEqual(st.get(id).tags, ['b', 'c']);
  expectFail(() => st.act({ action: 'update', item: id, policy: 'bogus' }), 400, 'The policy must be default, auto, ask, every or owner.');
  st.act({ action: 'update', item: id, expiresAt: '2027-01-01' }); assert.equal(st.get(id).expiresAt, '2027-01-01T00:00:00Z');
  st.act({ action: 'update', item: id, expiresAt: '' }); assert.equal(st.get(id).expiresAt, null);
  expectFail(() => st.act({ action: 'update', item: id, expiresAt: 'nope' }), 400, 'The expiry must be a date.');
  const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${i}`, 'v']));
  expectFail(() => st.act({ action: 'update', item: id, values: many }), 400, 'An item can have up to 20 custom fields.');
  // remove / restore
  const rev = st.get(id).revision;
  v = st.act({ action: 'remove', item: id });
  assert.equal(v.removed, true); assert.equal(st.get(id).trashedAt, ISO(s.clk.t)); assert.equal(st.get(id).revision, rev + 1);
  assert.equal(s.rows().at(-1).action, 'remove');
  expectFail(() => st.act({ action: 'remove', item: id }), 400, 'Already removed.');
  st.act({ action: 'update', item: id, url: 'https://trashed' }); assert.equal(st.get(id).url, 'https://trashed', 'update allowed on trashed');
  st.act({ action: 'restore', item: id });
  assert.equal(st.get(id).trashedAt, null); assert.equal(s.rows().at(-1).action, 'restore');
  expectFail(() => st.act({ action: 'restore', item: id }), 400, 'This item is not removed.');
  // recipe-remove
  expectFail(() => st.act({ action: 'recipe-remove', item: id, recipe: 'nope' }), 404, 'That approved command does not exist.');
  const { row: req } = mkRequest(s);
  const av = st.act({ action: 'answer', request: req.id, decision: 'always' });
  assert.equal(av.pending, false);
  const recipe = st.get(id).recipes[0];
  assert.match(recipe.id, /^[0-9a-f]{12}$/); assert.deepEqual(recipe.argv, ['echo', 'hi']); assert.equal(recipe.cwd, s.dir);
  assert.equal(recipe.action, 'run'); assert.equal(recipe.created, ISO(s.clk.t));
  st.act({ action: 'recipe-remove', item: id, recipe: recipe.id });
  assert.deepEqual(st.get(id).recipes, []);
  row = s.rows().at(-1); assert.equal(row.action, 'update'); assert.equal(row.decision, 'recipe-removed');
  // restore conflict, crafted file with duplicate names
  const s2 = setup();
  craft(s2, [{ id: 'aaaaaaaaaaaa', name: 'dup', kind: 'note', values: { text: 'x' }, trashedAt: ISO(T0) },
    { id: 'bbbbbbbbbbbb', name: 'dup', kind: 'note', values: { text: 'y' } }]);
  expectFail(() => s2.store.act({ action: 'restore', item: 'aaaaaaaaaaaa' }), 409, 'Another item now has that name. Rename it first.');
});

test('contract §5.4: field()', () => {
  const s = setup(); const st = s.store; addLogin(st); const id = st.byName('gh').id;
  assert.equal(st.field(id, 'password'), LOGIN.password);
  const r = s.rows().at(-1);
  assert.equal(r.action, 'owner-view'); assert.equal(r.by, 'owner'); assert.equal(r.decision, 'password'); assert.equal(r.item, id); assert.equal(r.name, 'gh');
  expectFail(() => st.field(id, 'nope'), 404, 'That field does not exist.');
  expectFail(() => st.field('nope', 'password'), 404, 'That item does not exist.');
  st.act({ action: 'remove', item: id });
  assert.equal(st.field(id, 'username'), LOGIN.username, 'trashed allowed');
});

test('contract §5.5: resolveBindings', () => {
  const s = setup(); const st = s.store; addLogin(st); addKey(st, 'k');
  const nothing = 'Nothing to bind: give at least one --env VAR=name.';
  expectFail(() => st.resolveBindings(null), 400, nothing);
  expectFail(() => st.resolveBindings('x'), 400, nothing);
  expectFail(() => st.resolveBindings({}), 400, nothing);
  expectFail(() => st.resolveBindings(Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`V${i}`, 'k']))), 400, 'Too many variables.');
  expectFail(() => st.resolveBindings(['k']), 400, '0 is not a variable name.');
  expectFail(() => st.resolveBindings({ lower: 'k' }), 400, 'lower is not a variable name.');
  for (const v of ['POCKET_X', 'PATH', 'HOME', 'LD_PRELOAD', 'NODE_OPTIONS']) expectFail(() => st.resolveBindings({ [v]: 'k' }), 400, `${v} cannot be bound.`);
  expectFail(() => st.resolveBindings({ A: 'Bad!' }), 400, 'Bad! is not an item name.');
  expectFail(() => st.resolveBindings({ A: 'missing' }), 404, 'There is no item named missing. `list` shows what exists.');
  expectFail(() => st.resolveBindings({ A: 'gh' }), 400, 'gh has the fields username and password; name one, for example gh.username.');
  expectFail(() => st.resolveBindings({ A: 'gh.nope' }), 400, 'gh has no field nope.');
  const n = s.rows().length;
  const b = st.resolveBindings({ A: 'gh.password', B: 'k' });
  assert.equal(b.length, 2);
  assert.equal(b[0].v, 'A'); assert.equal(b[0].item, st.byName('gh')); assert.equal(b[0].field, 'password');
  assert.equal(b[1].v, 'B'); assert.equal(b[1].item, st.byName('k')); assert.equal(b[1].field, 'value');
  assert.equal(s.rows().length, n, 'nothing audited');
  st.act({ action: 'remove', item: st.byName('k').id });
  expectFail(() => st.resolveBindings({ B: 'k' }), 404, 'There is no item named k. `list` shows what exists.');
});

test('contract §5.6: checkCommand', () => {
  const s = setup(); const st = s.store;
  const giveCmd = 'Give the command after --.';
  for (const argv of ['ls', [], ['  '], [5], ['x'.repeat(4097)], Array.from({ length: 201 }, () => 'a')]) expectFail(() => st.checkCommand(argv, s.dir), 400, giveCmd);
  expectFail(() => st.checkCommand(['ls'], ''), 400, 'The working directory must be a full path.');
  expectFail(() => st.checkCommand(['ls'], 'relative/dir'), 400, 'The working directory must be a full path.');
  expectFail(() => st.checkCommand(['ls'], path.join(s.dir, 'nope')), 400, 'The working directory does not exist.');
  fs.writeFileSync(path.join(s.dir, 'afile'), 'x');
  expectFail(() => st.checkCommand(['ls'], path.join(s.dir, 'afile')), 400, 'The working directory is not a directory.');
  const argv = ['ls', '-la'];
  const r = st.checkCommand(argv, `  ${s.dir}//./  `);
  assert.deepEqual(r, { argv: ['ls', '-la'], cwd: s.dir }); assert.notEqual(r.argv, argv);
  assert.equal(st.checkCommand(['ls'], '/').cwd, '/');
});

test('contract §5.7: statics', () => {
  assert.equal(VaultStore.actionOf({ action: 'fill', argv: ['x'] }), 'fill');
  assert.equal(VaultStore.actionOf({ argv: ['pocket-fill', 'a'] }), 'fill');
  assert.equal(VaultStore.actionOf({ action: 'run', argv: ['pocket-fill'] }), 'run');
  assert.equal(VaultStore.actionOf({ argv: ['ls'] }), 'run');
  const a = { argv: ['a', 'b'], cwd: '/x' };
  assert.equal(VaultStore.sameCommand(a, { argv: ['a', 'b'], cwd: '/x', action: 'run' }), true);
  assert.equal(VaultStore.sameCommand(a, { argv: ['a', 'b'], cwd: '/x/' }), false);
  assert.equal(VaultStore.sameCommand(a, { argv: ['a'], cwd: '/x' }), false);
  assert.equal(VaultStore.sameCommand(a, { argv: ['a', 'c'], cwd: '/x' }), false);
  assert.equal(VaultStore.sameCommand(a, { argv: ['a', 'b'], cwd: '/x', action: 'fill' }), false);
  assert.equal(VaultStore.sameCaller({ actor: 'agent', session: 's', tokenHash: 'a' }, { actor: 'agent', session: 's', tokenHash: 'b' }), true);
  assert.equal(VaultStore.sameCaller(null, { actor: 'terminal', session: null }), true);
  assert.equal(VaultStore.sameCaller(undefined, {}), true);
  assert.equal(VaultStore.sameCaller({ actor: 'agent', session: 's' }, { actor: 'agent', session: 't' }), false);
  assert.equal(VaultStore.sameCaller({ actor: 'agent', session: 's' }, { actor: 'owner', session: 's' }), false);
});

test('contract §5.8: decide', () => {
  const s = setup(); const st = s.store;
  addLogin(st, 'gh'); addKey(st, 'k');
  const cmd = { argv: ['echo', 'hi'], cwd: s.dir, action: 'run' };
  const b = st.resolveBindings({ A: 'gh.password', B: 'gh.username', C: 'k' });
  assert.deepEqual(st.decide(b, cmd).map((i) => i.name), ['gh', 'k'], 'default/once → ask, de-duplicated');
  st.access = () => 'free'; assert.deepEqual(st.decide(b, cmd), []);
  st.access = () => 'once';
  st.act({ action: 'update', item: st.byName('k').id, policy: 'auto' });
  assert.deepEqual(st.decide(b, cmd).map((i) => i.name), ['gh'], 'reads current item by id');
  st.act({ action: 'update', item: st.byName('gh').id, policy: 'owner' });
  expectFail(() => st.decide(b, cmd), 403, 'gh is for the owner only; agents cannot use it. Ask the owner to change its policy.', 'owner_only');
  st.act({ action: 'update', item: st.byName('gh').id, policy: 'every' });
  const { row } = mkRequest(s, { env: { A: 'gh.password' } });
  assert.equal(row.allowAlways, false);
  st.act({ action: 'update', item: st.byName('gh').id, policy: 'ask' });
  const r2 = mkRequest(s, { env: { A: 'gh.password' } });
  assert.equal(r2.row.allowAlways, true);
  st.answer(r2.row.id, 'always');
  const b2 = st.resolveBindings({ A: 'gh.password' });
  assert.deepEqual(st.decide(b2, cmd), [], 'ask + matching recipe');
  assert.equal(st.decide(b2, { ...cmd, argv: ['echo', 'other'] }).length, 1);
  assert.equal(st.decide(b2, { ...cmd, action: 'fill' }).length, 1);
});

test('contract §5.9: request row, audit, pendingFor', () => {
  const s = setup(); const st = s.store; addLogin(st); addKey(st, 'k');
  const env = { A: 'gh.password', B: 'k' };
  const { row, need } = mkRequest(s, { env, argv: ['deploy', '--x'] });
  assert.match(row.id, /^[0-9a-f]{12}$/);
  assert.equal(row.action, 'run'); assert.deepEqual(row.items, need.map((i) => i.id)); assert.deepEqual(row.itemNames, ['gh', 'k']);
  assert.deepEqual(row.argv, ['deploy', '--x']); assert.equal(row.cwd, s.dir); assert.deepEqual(row.env, env);
  assert.equal(row.session, 's1'); assert.equal(row.sessionTitle, 'Title s1'); assert.equal(row.by, 'agent');
  assert.equal(row.created, ISO(T0)); assert.equal(row.expiresAt, ISO(T0 + TTL)); assert.equal(row.answer, null);
  assert.equal(row.consumed, false); assert.ok(Array.isArray(row.waiters)); assert.equal(row.allowAlways, true);
  assert.deepEqual(row.caller, { actor: 'agent', session: 's1', tokenHash: 'th' });
  assert.deepEqual(row.bindings.map((b) => [b.v, b.item, b.name, b.field]), [['A', st.byName('gh').id, 'gh', 'password'], ['B', st.byName('k').id, 'k', 'value']]);
  assert.equal(st.requests.get(row.id), row);
  const a = s.rows().at(-1);
  assert.deepEqual(a, { at: ISO(T0), action: 'request', request: row.id, item: st.byName('gh').id, name: 'gh,k', by: 'agent', session: 's1',
    sessionTitle: 'Title s1', argv: ['deploy', '--x'], cwd: s.dir });
  assert.throws(() => st.request({ bound: [], cmd: { argv: ['x'], cwd: s.dir }, need: [], env: {} }), TypeError);
  const r2 = mkRequest(s, { session: 's2' }).row; const r3 = mkRequest(s, { session: 's1', argv: ['b'] }).row;
  mkRequest(s, { session: null, argv: ['c'] });
  assert.deepEqual(st.pendingFor('s1').map((r) => r.id), [row.id, r3.id]);
  assert.deepEqual(st.pendingFor(null), []);
  st.answer(row.id, 'deny');
  assert.deepEqual(st.pendingFor('s1').map((r) => r.id), [r3.id]);
  assert.deepEqual(st.pendingFor('s2').map((r) => r.id), [r2.id]);
});

test('contract §5.9: continuation / claim / answer', async () => {
  const s = setup(); const st = s.store; addLogin(st); addKey(st, 'k', 'api-key-value-123', { policy: 'auto' });
  const { row, caller } = mkRequest(s, { env: { A: 'gh.password', B: 'k' } });
  expectFail(() => st.continuation('nope', { caller }), 404, 'That request does not exist or has expired.');
  expectFail(() => st.continuation(row.id, { action: 'fill', caller }), 409, 'That request is for a command, not a browser fill.', 'request_mismatch');
  expectFail(() => st.continuation(row.id, { caller: { actor: 'agent', session: 's2' } }), 403, 'That request was raised by another session.', 'request_mismatch');
  assert.equal(st.continuation(row.id, { caller }), row, 'does not check the answer; default action run');
  expectFail(() => st.claim(row.id, { action: 'run', caller }), 409, 'The owner has not allowed that request.');
  expectFail(() => st.answer('nope', 'once'), 404, 'That request does not exist or has expired.');
  expectFail(() => st.answer(row.id, 'maybe'), 400, 'Answer once, always or deny.');
  s.clk.t += 2000;
  const v = st.answer(row.id, 'once');
  assert.equal(v.pending, false); assert.ok(!('env' in v)); assert.deepEqual(row.answer, { decision: 'once', at: ISO(s.clk.t) });
  const ra = s.rows().at(-1);
  assert.deepEqual(ra, { at: ISO(s.clk.t), action: 'request-answered', request: row.id, item: st.byName('gh').id, name: 'gh', by: 'owner',
    decision: 'once', session: 's1', sessionTitle: 'Title s1', argv: ['echo', 'hi'], cwd: s.dir });
  expectFail(() => st.answer(row.id, 'deny'), 409, 'That request was already answered.');
  const c = st.claim(row.id, { action: 'run', caller });
  assert.equal(c.request, row); assert.equal(row.consumed, true);
  assert.deepEqual(c.cmd, { argv: ['echo', 'hi'], cwd: s.dir, action: 'run' });
  const secrets = st.release(c.bound, c.cmd, { session: 's1', sessionTitle: 'Title s1', by: 'agent', request: row.id });
  assert.deepEqual(secrets, { A: LOGIN.password, B: 'api-key-value-123' });
  expectFail(() => st.continuation(row.id, { caller }), 409, 'That request was already used.', 'request_used');
  // fill row
  const f = mkRequest(s, { env: { A: 'gh.password' }, argv: ['pocket-fill', 'srv', 'tool'], action: 'fill' });
  assert.equal(f.row.action, 'fill');
  expectFail(() => st.claim(f.row.id, { action: 'run', caller: f.caller }), 409, 'That request is for a browser fill, not a command.', 'request_mismatch');
  // terminal caller with null session
  const t = mkRequest(s, { env: { A: 'gh.password' }, session: null, by: 'terminal' });
  st.answer(t.row.id, 'once');
  assert.ok(st.claim(t.row.id, { action: 'run', caller: { actor: 'terminal', session: null, tokenHash: 'other' } }));
});

test('contract §5.9: claim staleness (trash, field gone, policy change, owner_only, rename)', () => {
  const mk = () => { const s = setup(); const st = s.store; addLogin(st, 'gh', { policy: 'ask' }); addKey(st, 'k', 'api-key-value-123', { policy: 'auto' });
    st.act({ action: 'update', item: st.byName('gh').id, values: { extra_tok: 'extra-token-1' } });
    const r = mkRequest(s, { env: { A: 'gh.password', B: 'k', C: 'gh.extra_tok' } }); st.answer(r.row.id, 'once'); return { s, st, ...r }; };
  let x = mk();
  x.st.act({ action: 'remove', item: x.st.byName('gh').id });
  expectFail(() => x.st.claim(x.row.id, { action: 'run', caller: x.caller }), 409, 'gh changed since the owner was asked; ask again.', 'request_stale');
  assert.equal(x.row.consumed, false);
  x = mk();
  x.st.act({ action: 'update', item: x.st.byName('gh').id, removeFields: ['extra_tok'] });
  expectFail(() => x.st.claim(x.row.id, { action: 'run', caller: x.caller }), 409, 'gh changed since the owner was asked; ask again.', 'request_stale');
  assert.equal(x.row.consumed, false);
  x = mk();
  x.st.act({ action: 'update', item: x.st.byName('k').id, policy: 'every' });
  expectFail(() => x.st.claim(x.row.id, { action: 'run', caller: x.caller }), 409, 'A policy changed since the owner was asked; ask again.', 'request_stale');
  assert.equal(x.row.consumed, false);
  x.st.act({ action: 'update', item: x.st.byName('k').id, policy: 'auto' });
  assert.ok(x.st.claim(x.row.id, { action: 'run', caller: x.caller }), 'a later claim re-evaluates');
  x = mk();
  x.st.act({ action: 'update', item: x.st.byName('gh').id, policy: 'owner' });
  expectFail(() => x.st.claim(x.row.id, { action: 'run', caller: x.caller }), 403, 'gh is for the owner only; agents cannot use it. Ask the owner to change its policy.', 'owner_only');
  assert.equal(x.row.consumed, false);
  x = mk();
  x.st.act({ action: 'update', item: x.st.byName('gh').id, name: 'gh-renamed' });
  const c = x.st.claim(x.row.id, { action: 'run', caller: x.caller });
  assert.equal(x.st.release(c.bound, c.cmd).A, LOGIN.password, 'rename alone does not void');
});

test('contract §5.10: release', () => {
  const s = setup(); const st = s.store; addLogin(st); addKey(st, 'k');
  const gh0 = st.byName('gh');
  const b = st.resolveBindings({ A: 'gh.password', U: 'gh.username', B: 'k' });
  s.clk.t += 4000;
  const out = st.release(b, { argv: ['pocket-fill', 'x'], cwd: s.dir }, { session: 's1', sessionTitle: 'T', by: 'agent', request: 'req1', action: 'fill' });
  assert.deepEqual(out, { A: LOGIN.password, U: LOGIN.username, B: 'api-key-value-123' });
  const rows = s.rows().slice(-2);
  assert.deepEqual(rows.map((r) => [r.action, r.name, r.by, r.session, r.sessionTitle, r.request, r.cwd]),
    [['fill', 'gh', 'agent', 's1', 'T', 'req1', s.dir], ['fill', 'k', 'agent', 's1', 'T', 'req1', s.dir]]);
  assert.deepEqual(rows[0].argv, ['pocket-fill', 'x']);
  const gh = st.byName('gh');
  assert.notEqual(gh, gh0);
  assert.equal(gh.lastUsedAt, ISO(s.clk.t)); assert.deepEqual(gh.lastUsedBy, { session: 's1', sessionTitle: 'T', kind: 'agent' });
  assert.equal(gh.revision, gh0.revision); assert.equal(gh.updated, gh0.updated);
  assert.equal(s.openK().items.find((i) => i.name === 'gh').lastUsedAt, ISO(s.clk.t));
  st.release(st.resolveBindings({ A: 'k' }), { argv: ['x'], cwd: s.dir });
  assert.equal(s.rows().at(-1).action, 'run');
  const p = pwSetup(); const pb = p.store.resolveBindings({ A: 'gh.password' }); p.store.lock();
  expectFail(() => p.store.release(pb, { argv: ['x'], cwd: p.dir }), 423, 'The Vault is locked. Ask the owner to unlock it in Pocket Code.', 'vault_locked');
});

test('contract §5.11: purge', () => {
  const s = setup(); const st = s.store; addKey(st, 'old'); addKey(st, 'keep');
  st.act({ action: 'remove', item: st.byName('old').id });
  const n = s.rows().length;
  assert.deepEqual(st.purge(T0 + 30 * DAY - 1000), []);
  assert.deepEqual(st.purge(T0 + 30 * DAY), ['old']);
  assert.deepEqual(st.items.map((i) => i.name), ['keep']);
  assert.deepEqual(s.openK().items.map((i) => i.name), ['keep']);
  assert.deepEqual(s.restart().items.map((i) => i.name), ['keep']);
  void n;
  const p = pwSetup(); p.store.lock(); assert.deepEqual(p.store.purge(T0 + 99 * DAY), []);
});

// ============================================================================================ §6 fail-every-step
test('FES §6.1 act add: validation, audit, save failures', () => {
  const s = setup(); const st = s.store; addLogin(st, 'base');
  const D = s.bytes(); const items0 = st.items; const snap = structuredClone(st.items); const n = s.rows().length;
  const same = (label) => {
    assert.equal(st.items, items0, `${label}: items array identity`); assert.deepEqual(st.items, snap, `${label}: M`);
    assert.deepEqual(s.bytes(), D, `${label}: D`);
    assert.deepEqual(s.restart().items, snap, `${label}: R`);
  };
  const bad = [
    { action: 'nope' }, { action: 'add', name: 'Bad Name', kind: 'note', values: { text: 'x' } },
    { action: 'add', name: 'base', kind: 'note', values: { text: 'x' } }, { action: 'add', name: 'n1', kind: 'bogus', values: {} },
    { action: 'add', name: 'n1', kind: 'login', values: { username: 'u' } }, { action: 'add', name: 'n1', kind: 'note', values: { text: 'x' }, notes: 'n'.repeat(2001) },
    { action: 'add', name: 'n1', kind: 'note', values: { text: 'x' }, expiresAt: 'never' },
  ];
  for (const input of bad) { const e = catchErr(() => st.act(input)); assert.equal(e.status >= 400, true, e.message); same(`validation ${e.message}`); }
  assert.equal(s.rows().length, n, 'no audit rows for validation failures');
  const restore = s.breakAudit();
  const ea = catchErr(() => addKey(st, 'n1'));
  restore();
  assert.equal(ea.status, undefined, 'raw audit error'); assert.equal(ea.code, 'ENOENT');
  same('audit failure'); assert.equal(s.rows().length, n);
  s.ctl.failWrite = true;
  const ew = catchErr(() => addKey(st, 'n1'));
  s.ctl.failWrite = false;
  assert.equal(ew.message, 'disk full');
  same('save failure');
  assert.equal(s.rows().at(-1).action, 'put'); assert.equal(s.rows().at(-1).name, 'n1');
  addKey(st, 'n1');
  assert.ok(s.restart().items.some((i) => i.name === 'n1'));
});

test('FES §6.2 update/remove/restore/recipe-remove: no half-applied edits', () => {
  const s = setup(); const st = s.store; addLogin(st, 'gh', { policy: 'ask' }); addKey(st, 'k');
  const id = st.byName('gh').id;
  const { row } = mkRequest(s); st.answer(row.id, 'always');
  const recipeId = st.get(id).recipes[0].id;
  let D, obj, snap, n;
  const capture = () => { D = s.bytes(); obj = st.get(id); snap = structuredClone(obj); n = s.rows().length; };
  const same = (label, rowsDelta = 0) => {
    assert.equal(st.get(id), obj, `${label}: identity (I2)`); assert.deepEqual(st.get(id), snap, `${label}: deep`);
    assert.deepEqual(s.bytes(), D, `${label}: D`); assert.equal(s.rows().length, n + rowsDelta, `${label}: audit rows`);
    assert.deepEqual(s.restart().get(id), snap, `${label}: R`);
  };
  capture();
  expectFail(() => st.act({ action: 'update', item: id, url: 'https://x', policy: 'bogus' }), 400, 'The policy must be default, auto, ask, every or owner.');
  same('url then bad policy');
  expectFail(() => st.act({ action: 'update', item: id, name: 'new-name', removeFields: ['username'] }), 400, 'username is not a custom field of this item.');
  same('name then bad removeFields');
  expectFail(() => st.act({ action: 'update', item: id, values: { password: 'changed-pass-1' }, notes: 'n'.repeat(2001) }), 400, 'Notes can be up to 2,000 characters.');
  same('values then bad notes');
  expectFail(() => st.act({ action: 'update', item: id, tags: 'a', expiresAt: 'bad date' }), 400, 'The expiry must be a date.');
  same('tags then bad expiry');
  expectFail(() => st.act({ action: 'update', item: id, url: 'y', expected_revision: 99 }), 409, 'This item changed since you loaded it. Review it and try again.');
  same('expected_revision');
  for (const [label, input] of [['update', { action: 'update', item: id, url: 'https://z' }], ['remove', { action: 'remove', item: id }],
    ['recipe-remove', { action: 'recipe-remove', item: id, recipe: recipeId }]]) {
    const r = s.breakAudit(); catchErr(() => st.act(input)); r();
    same(`${label} audit failure`);
    s.ctl.failWrite = true; const e = catchErr(() => st.act(input)); s.ctl.failWrite = false;
    assert.equal(e.message, 'disk full');
    same(`${label} save failure`, 1);
    n += 1;
  }
  st.act({ action: 'remove', item: id }); capture();
  s.ctl.failWrite = true; catchErr(() => st.act({ action: 'restore', item: id })); s.ctl.failWrite = false;
  same('restore save failure', 1);
  assert.ok(st.get(id).trashedAt);
});

test('FES §6.3 importBundle: all-or-nothing', () => {
  const s = setup(); const st = s.store; addLogin(st);
  const D = s.bytes(); const items0 = st.items; const n = s.rows().length;
  const same = (label, rows = 0) => { assert.equal(st.items, items0, `${label}: M`); assert.equal(st.items.length, 1); assert.deepEqual(s.bytes(), D, `${label}: D`);
    assert.equal(s.rows().length, n + rows, `${label}: audit`); assert.equal(s.restart().items.length, 1, `${label}: R`); };
  catchErr(() => st.importBundle(Buffer.from('junk'), PW1)); same('header');
  catchErr(() => st.importBundle(bundle(PW1, []), PW2)); same('decrypt');
  expectFail(() => st.importBundle(bundle(PW1, [{ name: 'a1', kind: 'api_key', values: { value: 'good-value-1' } },
    { name: 'a2', kind: 'api_key', values: { value: '{{vault:x}}' } }]), PW1), 400, 'a2: The value looks like a placeholder, not a value.');
  same('value check on item 2');
  const s5 = setup(); craft(s5, fakeItems(499)); const D5 = s5.bytes(); const n5 = s5.rows().length;
  expectFail(() => s5.store.importBundle(bundle(PW1, [{ name: 'z1', kind: 'note', values: { text: 'a' } }, { name: 'z2', kind: 'note', values: { text: 'b' } }]), PW1),
    409, 'You can keep up to 500 items.');
  assert.equal(s5.store.items.length, 499); assert.deepEqual(s5.bytes(), D5); assert.equal(s5.rows().length, n5);
  const b = bundle(PW1, [{ name: 'a1', kind: 'api_key', values: { value: 'good-value-1' } }]);
  const r = s.breakAudit(); catchErr(() => st.importBundle(b, PW1)); r(); same('audit');
  s.ctl.failWrite = true; const e = catchErr(() => st.importBundle(b, PW1)); s.ctl.failWrite = false;
  assert.equal(e.message, 'disk full'); same('save', 1);
  assert.equal(s.rows().at(-1).decision, '1 added, 0 skipped');
  assert.equal(st.importBundle(b, PW1).added, 1);
  assert.equal(s.restart().items.length, 2);
});

test('FES §6.4 answer: audit and save failures leave the request pending', async () => {
  const s = setup(); const st = s.store; addLogin(st);
  const { row, caller } = mkRequest(s);
  const D = s.bytes(); const items0 = st.items; const n = s.rows().length;
  let woke = 0; const p = st.waitAnswer(row.id, 3000); p.then(() => { woke++; });
  const r = s.breakAudit(); catchErr(() => st.answer(row.id, 'once')); r();
  await tick();
  assert.equal(row.answer, null); assert.equal(woke, 0); assert.equal(s.rows().length, n); assert.deepEqual(s.bytes(), D);
  s.ctl.failWrite = true; const e = catchErr(() => st.answer(row.id, 'always')); s.ctl.failWrite = false;
  await tick();
  assert.equal(e.message, 'disk full');
  assert.equal(row.answer, null, 'still pending'); assert.equal(woke, 0, 'waiters not woken');
  assert.equal(st.items, items0); assert.deepEqual(st.byName('gh').recipes, []); assert.deepEqual(s.bytes(), D);
  assert.equal(s.rows().at(-1).action, 'request-answered');
  st.answer(row.id, 'always');
  const res = await p;
  assert.equal(res.answer.decision, 'always'); assert.equal(woke, 1);
  assert.equal(s.openK().items[0].recipes.length, 1, 'recipe on disk before waking');
  const R = s.restart();
  assert.equal(R.items[0].recipes.length, 1); assert.equal(R.requests.size, 0);
  assert.ok(st.claim(row.id, { action: 'run', caller }));
});

test('FES §6.5 release: audit k fails / save fails → no value, M and D unchanged', () => {
  const s = setup(); const st = s.store; addLogin(st); addKey(st, 'k');
  const b = st.resolveBindings({ A: 'gh.password', B: 'k' });
  const D = s.bytes(); const items0 = st.items; const n = s.rows().length;
  let out;
  const restore = failAuditOpenOn(s.auditFile, 2);
  let e;
  try { e = catchErr(() => { out = st.release(b, { argv: ['x'], cwd: s.dir }); }); } finally { restore(); }
  assert.equal(out, undefined); assert.equal(e.message, 'injected audit failure');
  assert.equal(s.rows().length, n + 1); assert.equal(s.rows().at(-1).name, 'gh');
  assert.equal(st.items, items0); assert.deepEqual(s.bytes(), D);
  s.ctl.failWrite = true; catchErr(() => { out = st.release(b, { argv: ['x'], cwd: s.dir }); }); s.ctl.failWrite = false;
  assert.equal(out, undefined); assert.equal(s.rows().length, n + 3);
  assert.equal(st.items, items0); assert.equal(st.byName('gh').lastUsedAt, null); assert.deepEqual(s.bytes(), D);
  assert.equal(s.restart().byName('gh').lastUsedAt, null);
  out = st.release(b, { argv: ['x'], cwd: s.dir });
  assert.equal(out.A, LOGIN.password);
  assert.equal(s.restart().byName('gh').lastUsedAt, ISO(T0));
});

test('FES §6.6 setPassphrase: write failure keeps old secret; exactly one opens D', () => {
  const s = setup(); const st = s.store; addLogin(st);
  const D = s.bytes(); const keys0 = st.keys;
  s.ctl.failWrite = true; const e = catchErr(() => st.setPassphrase(PW1, PW1)); s.ctl.failWrite = false;
  assert.equal(e.message, 'disk full');
  assert.equal(st.mode, 'key'); assert.equal(st.salt, null); assert.deepEqual(st.keys, keys0); assert.deepEqual(s.bytes(), D);
  assert.equal(s.restart().items.length, 1, 'R opens with server key');
  st.setPassphrase(PW1, PW1);
  const D1 = s.bytes(); const salt1 = Buffer.from(st.salt); const keys1 = st.keys;
  assert.equal(s.openPw(PW1).items.length, 1);
  s.ctl.failWrite = true; catchErr(() => st.setPassphrase(PW2, PW2)); s.ctl.failWrite = false;
  assert.deepEqual(Buffer.from(st.salt), salt1); assert.deepEqual(st.keys, keys1); assert.deepEqual(s.bytes(), D1);
  assert.equal(s.openPw(PW1).items.length, 1); assert.throws(() => s.openPw(PW2));
  const R = s.restart(); assert.equal(R.locked, true);
  expectFail(() => R.unlock(PW2), 401, 'Wrong passphrase.'); assert.equal(R.unlock(PW1), true);
  st.setPassphrase(PW2, PW2);
  assert.throws(() => s.openPw(PW1)); assert.equal(s.openPw(PW2).items.length, 1);
  const R2 = s.restart(); assert.equal(R2.locked, true);
  expectFail(() => R2.unlock(PW1), 401, 'Wrong passphrase.'); assert.equal(R2.unlock(PW2), true);
});

test('FES §6.7 removePassphrase: write failure keeps passphrase mode', () => {
  const s = pwSetup(); const st = s.store; const D = s.bytes(); const salt = st.salt; const keys = st.keys;
  s.ctl.failWrite = true; const e = catchErr(() => st.removePassphrase(PW1)); s.ctl.failWrite = false;
  assert.equal(e.message, 'disk full');
  assert.equal(st.mode, 'passphrase'); assert.equal(st.salt, salt); assert.equal(st.keys, keys); assert.deepEqual(s.bytes(), D);
  assert.equal(s.restart().locked, true, 'R: passphrase still required');
  st.removePassphrase(PW1);
  const R = s.restart(); assert.equal(R.locked, false); assert.deepEqual(R.openedWith, s.key);
});

test('FES §6.8 unlock: failures keep it locked; D never changes', () => {
  const s = pwSetup(); const D = s.bytes();
  const R = s.restart();
  fs.renameSync(s.file, s.file + '.moved');
  const e = catchErr(() => R.unlock(PW1));
  fs.renameSync(s.file + '.moved', s.file);
  assert.equal(e.code, 'ENOENT'); assert.equal(R.locked, true);
  catchErr(() => R.unlock('short')); assert.equal(R.locked, true);
  catchErr(() => R.unlock(PW2)); assert.equal(R.locked, true);
  assert.deepEqual(s.bytes(), D);
  assert.equal(s.restart().locked, true);
});

test('FES §6.9 lock: audit failure still locks', async () => {
  const s = pwSetup(); const st = s.store;
  const { row } = mkRequest(s, { env: { A: 'gh.password' } });
  const p = st.waitAnswer(row.id, 3000);
  const D = s.bytes();
  const r = s.breakAudit(); const e = catchErr(() => st.lock()); r();
  assert.equal(e.code, 'ENOENT');
  assert.equal(st.locked, true); assert.deepEqual(st.keys, []); assert.equal(st.requests.size, 0);
  const res = await p; assert.equal(res.answer.decision, 'locked');
  assert.deepEqual(s.bytes(), D); assert.equal(s.restart().locked, true);
});

test('FES §6.10 rotate: write failure leaves the old key in force', () => {
  const s = setup(); const st = s.store; addLogin(st);
  const old = s.key; const D = s.bytes(); const raw = newKey(); const k = parseKey(raw);
  catchErr(() => st.rotate('bad')); assert.deepEqual(st.keys[0], old); assert.deepEqual(s.bytes(), D);
  s.ctl.failWrite = true; const e = catchErr(() => st.rotate(raw)); s.ctl.failWrite = false;
  assert.equal(e.message, 'disk full');
  assert.deepEqual(st.keys[0], old); assert.deepEqual(st.envKey, old); assert.deepEqual(s.bytes(), D);
  assert.deepEqual(s.restart({ key: k, oldKeys: [old] }).openedWith, old);
  assert.equal(s.restart({ key: old }).items.length, 1);
  st.rotate(raw);
  assert.deepEqual(s.restart({ key: k, oldKeys: [old] }).openedWith, k);
  expectPlain(() => s.restart({ key: old }), 'The vault cannot be opened with this key.');
});

test('FES §6.11/6.12 exportBundle and field(): audit failure → nothing returned', () => {
  const s = setup(); const st = s.store; addLogin(st); const D = s.bytes();
  let out;
  let r = s.breakAudit(); catchErr(() => { out = st.exportBundle(PW1, PW1); }); r();
  assert.equal(out, undefined); assert.deepEqual(s.bytes(), D);
  r = s.breakAudit(); catchErr(() => { out = st.field(st.byName('gh').id, 'password'); }); r();
  assert.equal(out, undefined);
});

test('FES §6.13 request: audit failure issues no request; restart drops requests', () => {
  const s = setup(); const st = s.store; addLogin(st);
  const bound = st.resolveBindings({ A: 'gh.password' }); const cmd = { argv: ['x'], cwd: s.dir, action: 'run' };
  const need = st.decide(bound, cmd);
  const r = s.breakAudit(); catchErr(() => st.request({ bound, cmd, need, env: {}, session: 's1' })); r();
  assert.equal(st.requests.size, 0);
  st.request({ bound, cmd, need, env: {}, session: 's1' });
  assert.equal(st.requests.size, 1); assert.equal(s.restart().requests.size, 0);
});

test('FES §6.14 purge: save failure → nothing changes, requests not expired', () => {
  const s = setup(); const st = s.store; addLogin(st); addKey(st, 'old'); st.act({ action: 'remove', item: st.byName('old').id });
  const { row } = mkRequest(s);
  const D = s.bytes(); const items0 = st.items;
  s.clk.t = T0 + 31 * DAY;
  s.ctl.failWrite = true; const e = catchErr(() => st.purge()); s.ctl.failWrite = false;
  assert.equal(e.message, 'disk full');
  assert.equal(st.items, items0); assert.deepEqual(s.bytes(), D); assert.ok(st.requests.has(row.id), 'expireRequests not run');
  assert.deepEqual(st.purge(), ['old']); assert.ok(!st.requests.has(row.id));
  assert.equal(s.restart().items.some((i) => i.name === 'old'), false);
});

// ============================================================================================ §7 concurrency / timing
test('§7: two waiters on one request; first claim wins; deny path', async () => {
  const s = setup(); const st = s.store; addLogin(st);
  const { row, caller } = mkRequest(s);
  const p1 = st.waitAnswer(row.id, 3000); const p2 = st.waitAnswer(row.id, 3000);
  st.answer(row.id, 'once');
  const [a, b] = await Promise.all([p1, p2]);
  assert.equal(a.answer.decision, 'once'); assert.equal(b.answer.decision, 'once');
  assert.ok(st.claim(row.id, { action: 'run', caller }));
  expectFail(() => st.claim(row.id, { action: 'run', caller }), 409, 'That request was already used.', 'request_used');
  const d = mkRequest(s, { argv: ['two'] });
  const q1 = st.waitAnswer(d.row.id, 3000); const q2 = st.waitAnswer(d.row.id, 3000);
  st.answer(d.row.id, 'deny');
  assert.deepEqual((await Promise.all([q1, q2])).map((r) => r.answer.decision), ['deny', 'deny']);
  const e = expectFail(() => st.claim(d.row.id, { action: 'run', caller: d.caller }), 409, 'The owner has not allowed that request.');
  assert.equal(e.code, undefined);
  assert.equal((await st.waitAnswer(d.row.id, 3000)).answer.decision, 'deny', 'answered → resolves at once');
  expectFail(() => st.waitAnswer('nope', 100), 404, 'That request does not exist or has expired.');
});

test('§7: waitAnswer timeout resolves null and removes only its own waiter', async () => {
  const s = setup(); const st = s.store; addLogin(st);
  const { row } = mkRequest(s);
  const p1 = st.waitAnswer(row.id, 80); const p2 = st.waitAnswer(row.id, 3000);
  assert.equal(await p1, null);
  assert.equal(row.waiters.length, 1);
  st.answer(row.id, 'once');
  assert.equal((await p2).answer.decision, 'once');
});

test('§7: lock while waiting → locked; claim 423 then 404 after unlock', async () => {
  const s = pwSetup(); const st = s.store;
  const { row, caller } = mkRequest(s, { env: { A: 'gh.password' } });
  const b = mkRequest(s, { env: { A: 'gh.password' }, argv: ['b'] });
  st.answer(b.row.id, 'once');
  const p1 = st.waitAnswer(row.id, 3000); const p2 = st.waitAnswer(row.id, 3000);
  st.lock();
  for (const r of await Promise.all([p1, p2])) assert.equal(r.answer.decision, 'locked');
  assert.equal(b.row.answer.decision, 'once', 'answered rows keep their answer');
  expectFail(() => st.claim(row.id, { action: 'run', caller }), 423, 'The Vault is locked. Ask the owner to unlock it in Pocket Code.', 'vault_locked');
  st.unlock(PW1);
  expectFail(() => st.claim(row.id, { action: 'run', caller }), 404, 'That request does not exist or has expired.');
  expectFail(() => st.claim(b.row.id, { action: 'run', caller: b.caller }), 404, 'That request does not exist or has expired.');
});

test('§7: expiry at created + 15 min inclusive, lazy, wakes waiters with expired', async () => {
  const s = setup(); const st = s.store; addLogin(st);
  const { row, caller } = mkRequest(s);
  const p = st.waitAnswer(row.id, 3000);
  s.clk.t = T0 + TTL - 1000;
  assert.equal(st.continuation(row.id, { caller }), row);
  s.clk.t = T0 + TTL;
  assert.equal(row.answer, null, 'lazy: nothing ran yet');
  st.expireRequests();
  assert.deepEqual(row.answer, { decision: 'expired', at: ISO(T0 + TTL) });
  assert.equal((await p).answer.decision, 'expired');
  assert.equal(st.requests.size, 0);
  const r2 = mkRequest(s, { argv: ['z'] }).row;
  s.clk.t += TTL;
  assert.deepEqual(st.pendingFor('s1'), []); assert.ok(!st.requests.has(r2.id));
  const r3 = mkRequest(s, { argv: ['y'] }).row; st.answer(r3.id, 'once');
  st.expireRequests(s.clk.t + TTL);
  assert.ok(!st.requests.has(r3.id)); assert.equal(r3.answer.decision, 'once', 'answered rows are deleted, not re-answered');
});

test('§7: idle lock reset by owner activity only through open()', () => {
  const s = pwSetup(); const st = s.store;
  s.clk.t = T0 + 4 * MIN; st.get(st.byName('gh').id);
  s.clk.t = T0 + 8 * MIN; assert.equal(st.idleLockDue(5), false);
  s.clk.t = T0 + 9 * MIN; assert.equal(st.idleLockDue(5), true);
});

// ============================================================================================ §8 scrubbing
test('§8.1 needlesFor exact examples', () => {
  assert.deepEqual(needlesFor(['abc']), []);
  assert.deepEqual(needlesFor(['abcd']), ['YWJjZA==', 'YWJjZA', 'abcd']);
  assert.deepEqual(needlesFor([123, null, 'abcd']), ['YWJjZA==', 'YWJjZA', 'abcd']);
  // 1.82.1: the value's three alignments inside longer base64 ('YS9iImPDq', 'hL2IiY8Op', 'EvYiJjw6') are forms too.
  assert.deepEqual(needlesFor(['a/b"cé']), ['a%2Fb%22c%C3%A9', 'a\\/b\\"c\\u00e9', 'YS9iImPDqQ==', 'a/b\\"c\\u00e9', 'YS9iImPDqQ', 'YS9iImPDq', 'hL2IiY8Op', 'a/b\\\\\\"cé', 'EvYiJjw6', 'a\\/b\\"cé', 'a/b\\"cé', 'a/b"cé']);
  assert.deepEqual(needlesFor(['pa ss😀w']), ['pa%20ss%F0%9F%98%80w', 'pa ss\\ud83d\\ude00w', 'cGEgc3Pwn5iAdw==', 'cGEgc3Pwn5iAdw', 'cGEgc3Pwn5iAd', 'wYSBzc/CfmIB3', 'wYSBzc_CfmIB3', 'BhIHNz8J+YgH', 'BhIHNz8J-YgH', 'pa ss😀w']);
  const lone = needlesFor(['x\ud800yz']);
  assert.equal(lone.length, 11, '1.82.1: plus the U+FFFD spelling\'s alignments inside longer base64');
  assert.deepEqual([...lone].sort(), ['x%EF%BF%BDyz', 'x\\\\ud800yz', 'x\\ud800yz', 'x\\ufffdyz', 'eO+/vXl6', 'eO-_vXl6', 'jvv715e', '477+9eX', '477-9eX', 'x\ud800yz', 'x�yz'].sort());
  for (let i = 1; i < lone.length; i++) assert.ok(lone[i - 1].length >= lone[i].length, 'sorted by length desc');
  const ab = needlesFor(['ab?>c']);
  assert.ok(ab.includes('YWI/PmM=') && ab.includes('YWI_PmM') && ab.includes('YWI/PmM'), '1.82.1: unpadded standard base64 too');
});

test('§8.2 makeScrubStream / scrubber: chunking, hold, order, placeholders', () => {
  const s0 = makeScrubStream([]);
  assert.equal(s0.push('abc'), 'abc'); assert.equal(s0.end(), '');
  const h = makeScrubStream([{ forms: ['secret'], ph: 'X' }]);
  assert.equal(h.push('a'.repeat(100)), 'a'.repeat(95)); assert.equal(h.end(), 'aaaaa');
  const s = scrubber(['secret-value']);
  assert.equal(s.push('xx secr') + s.push('et-value yy') + s.end(), 'xx {{vault}} yy');
  const c = scrubber(['secret-value'], '<P>');
  assert.equal(c.push('a secret-value b') + c.end(), 'a <P> b');
  const o = makeScrubStream([{ forms: ['abcdef'], ph: '<1>' }, { forms: ['abc'], ph: '<2>' }]);
  assert.equal(o.push('abcdef abc') + o.end(), '<1> <2>');
  // chunk-split equivalence (deterministic PRNG)
  const vals = ['secret-value-1', 'tok/en+x==', 'pa ss😀w', 'a/b"cé-long'];
  const forms = vals.flatMap((v) => needlesFor([v]));
  const input = `start ${forms.join(' | ')} mid secret-value-1secret-value-1 ${JSON.stringify({ v: vals[3] })} end`;
  const whole = (() => { const x = scrubber(vals); return x.push(input) + x.end(); })();
  for (const v of vals) assert.ok(!whole.includes(v), `raw ${v} scrubbed`);
  for (const f of forms) assert.ok(!whole.includes(f), `form ${f} scrubbed`);
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let trial = 0; trial < 60; trial++) {
    const x = scrubber(vals); let out = ''; let i = 0;
    while (i < input.length) { const n = trial === 0 ? 1 : 1 + Math.floor(rnd() * 12); out += x.push(input.slice(i, i + n)); i += n; }
    out += x.end();
    assert.equal(out, whole, `trial ${trial}`);
  }
});

test('§8 scrubbing of common printed forms (JSON, URL, base64, ascii-escaped)', () => {
  const v = 'a/b"cé-long';
  const run = (text) => { const x = scrubber([v]); return x.push(text) + x.end(); };
  for (const text of [v, JSON.stringify({ v }), encodeURIComponent(v), Buffer.from(v).toString('base64'), Buffer.from(v).toString('base64url'),
    '"a\\/b\\"c\\u00e9-long"', JSON.stringify(JSON.stringify(v))]) {
    const out = run(text);
    assert.ok(out.includes('{{vault}}'), `placeholder in ${out}`);
    assert.ok(!out.includes('cé-long') && !out.includes('c\\u00e9-long'), `no secret left in ${out}`);
  }
  assert.equal(run('xx abcd yy'.replace('abcd', 'abcd')), 'xx abcd yy');
  const four = scrubber(['abcd']); assert.equal(four.push('x abcd y') + four.end(), 'x {{vault}} y', 'min length 4 scrubbed');
});

// ============================================================================================ §9 runWithSecrets
const PARENT_CJS = `
const { spawn } = require('child_process'); const fs = require('fs');
const [pidfile, mode] = process.argv.slice(2);
const code = "process.on('SIGTERM', () => {}); require('fs').writeFileSync(" + JSON.stringify(pidfile) + ", String(process.pid)); setInterval(() => {}, 1000);";
spawn(process.execPath, ['-e', code], { stdio: mode === 'hold' ? 'inherit' : 'ignore' });
const iv = setInterval(() => {
  let ok = false; try { ok = fs.readFileSync(pidfile, 'utf8').length > 0; } catch {}
  if (!ok) return;
  clearInterval(iv);
  if (mode === 'sleep') setInterval(() => {}, 1000); else process.exit(0);
}, 20);
`;
function groupScript() {
  const dir = mkdir(); const script = path.join(dir, 'parent.cjs'); fs.writeFileSync(script, PARENT_CJS);
  const pidfile = path.join(dir, 'gc.pid');
  const gpid = () => { try { const p = Number(fs.readFileSync(pidfile, 'utf8')); if (p) livePids.add(p); return p; } catch { return 0; } };
  return { dir, script, pidfile, gpid };
}
async function run(opts) {
  const out = []; const err = [];
  const t = Date.now();
  const res = await runWithSecrets({ cwd: os.tmpdir(), env: { PATH: process.env.PATH }, secrets: {}, onOut: (x) => out.push(x), onErr: (x) => err.push(x), ...opts });
  return { res, out: out.join(''), err: err.join(''), chunks: [...out, ...err], ms: Date.now() - t };
}

test('§9: secrets reach env only and are scrubbed from stdout/stderr', async () => {
  const secret = 's3cr3t-token-value';
  const sh = 'printf "%s\\n" "$TOKEN"; printf "%s" "$TOKEN" >&2; printf "%s" "$TOKEN" | base64; printf "len=%s\\n" "${#TOKEN}"';
  const a = await run({ argv: ['sh', '-c', sh], secrets: { TOKEN: secret }, placeholders: { [secret]: 'gh.password' } });
  assert.deepEqual(a.res, { code: 0, signal: null, truncated: false, timedOut: false, error: null });
  assert.ok(!a.out.includes(secret) && !a.err.includes(secret));
  assert.ok(!a.out.includes(Buffer.from(secret).toString('base64')));
  assert.ok(a.out.includes('{{vault:gh.password}}')); assert.ok(a.err.includes('{{vault:gh.password}}'));
  assert.ok(a.out.includes('len=18'), 'value present in the child environment');
  assert.ok(a.chunks.every((c) => c.length > 0), 'never empty strings');
  const b = await run({ argv: ['sh', '-c', 'printf "%s" "$TOKEN"; exit 3'], secrets: { TOKEN: secret } });
  assert.equal(b.out, '{{vault}}'); assert.equal(b.res.code, 3);
  const c = await run({ argv: ['sh', '-c', 'cat; echo after'], timeoutMs: 5000 });
  assert.equal(c.out, 'after\n'); assert.ok(c.ms < 4000, 'stdin closed');
});

test('§9: spawn errors, timeout, abort, output cap', async () => {
  const e = await run({ argv: ['nosuchcmd-vault-spec'] });
  assert.deepEqual(e.res, { code: null, signal: null, truncated: false, timedOut: false, error: 'spawn nosuchcmd-vault-spec ENOENT' });
  const t = await run({ argv: ['sleep', '5'], timeoutMs: 200 });
  assert.equal(t.res.timedOut, true); assert.equal(t.res.signal, 'SIGTERM'); assert.equal(t.res.code, null); assert.equal(t.res.error, null);
  assert.ok(t.ms < 3000, `timeout took ${t.ms}ms`);
  assert.ok(!('aborted' in t.res));
  const ac = new AbortController(); setTimeout(() => ac.abort(), 200);
  const a = await run({ argv: ['sleep', '5'], signal: ac.signal });
  assert.equal(a.res.signal, 'SIGTERM'); assert.equal(a.res.timedOut, false); assert.ok(a.ms < 3000);
  const cap = await run({ argv: [process.execPath, '-e', "process.stdout.write('x'.repeat(100))"], maxOutput: 10 });
  assert.equal(cap.out.length, 10); assert.equal(cap.res.truncated, true);
});

test('§9: a TERM-ignoring grandchild that holds the pipes is SIGKILLed', async () => {
  const g = groupScript();
  const r = await run({ argv: [process.execPath, g.script, g.pidfile, 'hold'], timeoutMs: 20000 });
  const pid = g.gpid();
  assert.ok(pid > 0, 'grandchild started');
  assert.ok(r.ms >= 800 && r.ms < 6000, `resolved after ${r.ms}ms`);
  assert.equal(r.res.code, 0);
  assert.ok(await waitDead(pid, 500), 'grandchild dead after the run');
});

// ============================================================================================ DIV tests (§11)
test('1.82.1 (bug review DIV-3): vaultInstructions prints the SKILL.md path without a stray quote when the install path has a space', () => {
  const cli = '/opt/my pocket/scripts/pocket-vault.mjs';
  const txt = vaultInstructions(cli, null);
  const want = '/opt/my pocket/skills/pocket-vault/SKILL.md';
  const i = txt.indexOf(want);
  assert.ok(i >= 0, `SKILL.md path ${want} present`);
  const pre = txt[i - 1]; const post = txt[i + want.length];
  assert.ok(!(pre === "'" || pre === '"') || post === pre, `SKILL.md path has a stray quote: ${JSON.stringify(txt.slice(i - 2, i + want.length + 2))}`);
});

test('1.82.1 (bug review DIV-7): an approval given late in the window stays claimable for 15 minutes after the answer', () => {
  const s = setup(); addLogin(s.store);
  const { row, caller } = mkRequest(s);
  s.clk.t = T0 + TTL - 1000; s.store.answer(row.id, 'once');
  s.clk.t = T0 + TTL + 60000;
  assert.ok(s.store.claim(row.id, { action: 'run', caller }), 'claim one minute after a late approval');
});

test('1.82.1 (bug review DIV-16): a wrong passphrase still answers 401 when the audit row cannot be written', () => {
  const s = pwSetup(); const R = s.restart();
  const r = s.breakAudit(R); const e = catchErr(() => R.unlock(PW2)); r();
  assert.equal(e.status, 401, `got ${e.message} with status ${e.status}`);
  assert.equal(R.locked, true);
});

test('1.82.1 (bug review DIV-20): the scrubber catches HTTP Basic user:password, base64 inside longer base64, and unpadded base64', () => {
  const s = scrubber(['octocat', 'hunter2-pass']);
  const basic = Buffer.from('octocat:hunter2-pass').toString('base64');
  const out = s.push(`Authorization: Basic ${basic}\n`) + s.end();
  assert.ok(!out.includes(basic), `Basic credential passed: ${out}`);
  for (const v of ['hunter2-pass', 'sk-live-0123456789', 'pässwörd😀']) for (let pre = 0; pre < 5; pre++) for (let post = 0; post < 3; post++) {
    const blob = Buffer.concat([Buffer.from('xyzw'.slice(0, pre)), Buffer.from(v), Buffer.from('qr'.slice(0, post))]);
    for (const enc of [blob.toString('base64'), blob.toString('base64url')]) { const sc = scrubber([v]); const got = sc.push(enc) + sc.end(); assert.ok(got.includes('{{vault}}'), `${v} at offset ${pre} missed in ${enc}`); }
  }
  const u = scrubber(['ab?>c']);
  const out2 = u.push('x YWI/PmM y') + u.end();
  assert.ok(!out2.includes('YWI/PmM'), `unpadded base64 passed: ${out2}`);
});

test('1.82.1 (bug review DIV-22): a TERM-ignoring group member that does not hold the pipes does not outlive the run', async () => {
  const g = groupScript();
  await run({ argv: [process.execPath, g.script, g.pidfile, 'exit'], timeoutMs: 20000 });
  const pid = g.gpid();
  assert.ok(pid > 0, 'grandchild started');
  await sleep(3000);
  const survived = alive(pid);
  try { process.kill(pid, 'SIGKILL'); } catch {}
  assert.equal(survived, false, 'group member survived the run');
});
