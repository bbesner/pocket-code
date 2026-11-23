// A contract for Pocket's self-update (self-update.mjs + scripts/pocket-self-update.sh), written from a behaviour spec
// without sight of the source, in the bug review of 2026-11-23 (Pocket Code 1.124.3). The faults it found are fixed in
// 1.124.4; the tests whose failures were ruled not to be faults are turned round to pin what the code does, or removed.
// Every name, repo, path and secret here is fictional.
// The shell is only ever run against a disposable git repository in a temp dir, with stand-in
// pm2/npm/git/tar/df/date/mkdir/chmod/sleep on a curated PATH that cannot reach a real pm2 or npm.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as mod from '../self-update.mjs';
import { SelfUpdate, SELF_UPDATE_FILE, SELF_UPDATE_LOG } from '../self-update.mjs';
import { tmpDir, fakeClock, failing, patch, failFsFor, snapshot, unchanged, track, alive, until } from './bugreview-faults.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'pocket-self-update.sh');
const REPO = 'fict-owner/fict-app';
const T0 = Date.parse('2026-01-01T00:00:00Z');
const STALE = 1_200_000;
const SHA_A = 'a'.repeat(40), SHA_B = 'b'.repeat(40), SHA_C = 'c'.repeat(40), SHA_D = 'd'.repeat(40), SHA_E = 'e'.repeat(40);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET = 'fict-secret-value-0000-zz';
const JOB_KEYS = ['backup', 'error', 'finishedAt', 'from', 'id', 'phase', 'running', 'startedAt', 'to', 'updatedAt'];
const RUNNING_PHASES = ['queued', 'checking', 'backing-up', 'installing', 'restarting', 'rolling-back'];

const M = {
  disabled: 'Pocket Code updates are installed by whoever manages this server.',
  pm2: 'Pocket is not running under PM2 here, so it cannot restart itself. Update it from the server.',
  git: 'This install is not a git checkout. Update it from the server.',
  version: 'No newer Pocket Code release was found. Check again.',
  head: 'Could not read the installed checkout. Update it from the server.',
  running: 'A Pocket Code update is already running.',
  other: 'A CLI update check or upgrade is running. Try again when it finishes.',
  busy: 'Replies are running. Update when they finish, so the restart does not cut them short.',
  interrupted: 'The update stopped without finishing, probably because the server restarted. Check the version shown here before you try again.',
  // 1.124.5: from installing on, the checkout may have moved and the packages may be gone (flow test b-12a)
  interruptedInstalling: dir => `The update stopped while installing 1.1.0, probably because the server restarted. Pocket's files may have moved to 1.1.0 and its packages may not be installed, so Pocket may not start after its next restart. On the server, run npm ci in ${dir} before Pocket restarts, then check the version shown here.`,
  startFail: 'Could not start the update. Nothing was changed.',
  notStarted: "The update did not start. Nothing was changed. The log is pocket-self-update.log in Pocket's data folder.",
};
const GRACE = 120_000; // 1.124.4: a queued job whose script has not taken its lock by then did not start

// ---------------------------------------------------------------- class fixture
function fixture({ enabled = true, pmId = '3', git = 'dir', headContent = SHA_A + '\n', envExtra = {}, setsid = true, clock = fakeClock(T0) } = {}) {
  const base = tmpDir('su-cls-');
  const checkout = path.join(base, 'co'), dataDir = path.join(base, 'data'), home = path.join(base, 'home');
  for (const d of [checkout, dataDir, home]) fs.mkdirSync(d);
  if (git === 'dir') { fs.mkdirSync(path.join(checkout, '.git')); if (headContent !== null) fs.writeFileSync(path.join(checkout, '.git', 'HEAD'), headContent); }
  else if (git === 'file') fs.writeFileSync(path.join(checkout, '.git'), 'gitdir: /fict/worktrees/x\n');
  const env = { PATH: '/fict/bin:/usr/bin', HOME: home, ...envExtra };
  if (enabled) env.POCKET_SELF_UPDATE = '1';
  if (pmId !== null) env.pm_id = pmId;
  const calls = [];
  const spawner = (cmd, args, opts) => {
    const c = new EventEmitter(); c.unrefCalls = 0; c.unref = () => { c.unrefCalls += 1; };
    calls.push({ cmd, args, opts, child: c }); return c;
  };
  const make = (over = {}) => new SelfUpdate({ checkout, dataDir, env, port: '3999', repo: REPO, now: clock.now, spawner, node: '/fict/node', setsid, ...over });
  return { base, checkout, dataDir, home, env, calls, spawner, make, clock, file: path.join(dataDir, SELF_UPDATE_FILE), log: path.join(dataDir, SELF_UPDATE_LOG) };
}
const writeJob = (f, obj) => fs.writeFileSync(f.file, JSON.stringify(obj, null, 2));
const OLD = { id: 'old-id', from: '0.9.0', to: '1.0.0', phase: 'complete', startedAt: T0 - 10_000, updatedAt: T0 - 5_000, finishedAt: T0 - 5_000 };
const live = (over = {}) => ({ id: 'live-id', from: '1.0.0', to: '1.1.0', phase: 'installing', startedAt: T0, updatedAt: T0, ...over });
function rejects(fn, message) {
  let err; try { fn(); } catch (e) { err = e; }
  assert.ok(err, `expected a throw with "${message}"`);
  assert.equal(err.message, message); assert.equal(err.status, 409); assert.equal(err.code, undefined);
  return err;
}
function noStart(f, snap) {
  assert.equal(f.calls.length, 0, 'no child may be spawned');
  assert.equal(fs.existsSync(f.log), false, 'no log may be written');
  if (snap !== undefined) assert.ok(unchanged(f.file, snap), 'progress bytes must be unchanged');
}
const begin11 = (su, extra = {}) => su.begin({ from: '1.0.0', to: '1.1.0', ...extra });

// ================================================================= module surface
describe('module surface', () => {
  test('§Harness: exactly three exports with exact file names', () => {
    assert.deepEqual(Object.keys(mod).sort(), ['SELF_UPDATE_FILE', 'SELF_UPDATE_LOG', 'SelfUpdate']);
    assert.equal(SELF_UPDATE_FILE, 'pocket-self-update.json');
    assert.equal(SELF_UPDATE_LOG, 'pocket-self-update.log');
  });

  test('§1 constructor: file/log/script paths, no file created, works with a missing dataDir', () => {
    const f = fixture();
    const su = f.make();
    assert.equal(su.file, path.join(f.dataDir, SELF_UPDATE_FILE));
    assert.equal(su.log, path.join(f.dataDir, SELF_UPDATE_LOG));
    assert.equal(su.script, path.join(f.checkout, 'scripts', 'pocket-self-update.sh'));
    assert.equal(f.make({ script: '/fict/other.sh' }).script, '/fict/other.sh');
    assert.deepEqual(fs.readdirSync(f.dataDir), []);
    const missing = path.join(f.base, 'nope');
    assert.doesNotThrow(() => new SelfUpdate({ checkout: f.checkout, dataDir: missing, env: f.env, port: '1', repo: REPO }));
    assert.equal(fs.existsSync(missing), false);
  });

  test('§1 constructor: enabled only for the exact string "1"', () => {
    for (const [v, want] of [['1', true], ['true', false], ['01', false], ['1 ', false], [' 1', false], ['', false], ['yes', false]]) {
      const f = fixture({ enabled: false, envExtra: { POCKET_SELF_UPDATE: v } });
      assert.equal(f.make().enabled, want, `POCKET_SELF_UPDATE=${JSON.stringify(v)}`);
      assert.equal(f.make().snapshot().enabled, want);
    }
    const f = fixture({ enabled: false });
    assert.equal(f.make().enabled, false);
  });

  test('§1 constructor: default setsid on Linux with setsid present launches through setsid', { skip: process.platform !== 'linux' }, () => {
    const has = fs.existsSync('/usr/bin/setsid') || fs.existsSync('/bin/setsid');
    const f = fixture();
    const su = new SelfUpdate({ checkout: f.checkout, dataDir: f.dataDir, env: f.env, port: '3999', repo: REPO, now: f.clock.now, spawner: f.spawner, node: '/fict/node' });
    begin11(su);
    assert.equal(f.calls[0].cmd, has ? 'setsid' : 'bash');
  });
});

// ================================================================= reason()
describe('§2 reason()', () => {
  test('disabled returns null even with every prerequisite missing', () => {
    assert.equal(fixture({ enabled: false, pmId: null, git: 'none' }).make().reason(), null);
  });
  test('enabled without pm_id: PM2 message (checked first)', () => {
    assert.equal(fixture({ pmId: null, git: 'none' }).make().reason(), M.pm2);
  });
  test('empty pm_id passes the PM2 check', () => {
    assert.equal(fixture({ pmId: '' }).make().reason(), process.platform === 'linux' || process.platform === 'darwin' ? null : 'Updating from Pocket works on Linux and macOS servers only.');
  });
  test('no .git: git checkout message', () => {
    assert.equal(fixture({ git: 'none' }).make().reason(), M.git);
  });
  test('.git file (linked worktree) passes reason() but head() is ""', () => {
    const su = fixture({ git: 'file' }).make();
    assert.equal(su.reason(), null);
    assert.equal(su.head(), '');
  });
});

// ================================================================= job()
describe('§3 job()', () => {
  test('null for missing, invalid JSON, null, array and scalars', () => {
    const f = fixture(); const su = f.make();
    assert.equal(su.job(), null);
    for (const raw of ['{"id":', 'null', '[]', '[{"phase":"queued"}]', '5', '"queued"', 'true', '']) {
      fs.writeFileSync(f.file, raw);
      assert.equal(su.job(), null, `raw ${JSON.stringify(raw)}`);
    }
  });
  test('projection has exactly the ten keys; missing finishedAt/error/backup become null', () => {
    const f = fixture(); writeJob(f, { id: 'j1', phase: 'complete', extra: 'x', token: SECRET });
    const j = f.make().job();
    assert.deepEqual(Object.keys(j).sort(), JOB_KEYS);
    assert.equal(j.id, 'j1'); assert.equal(j.from, undefined); assert.equal(j.to, undefined);
    assert.equal(j.startedAt, undefined); assert.equal(j.updatedAt, undefined);
    assert.equal(j.finishedAt, null); assert.equal(j.error, null); assert.equal(j.backup, null);
    assert.equal(j.running, false);
    writeJob(f, { ...OLD, error: 'e', backup: '/fict/b' });
    const k = f.make().job();
    assert.equal(k.finishedAt, OLD.finishedAt); assert.equal(k.error, 'e'); assert.equal(k.backup, '/fict/b');
  });
  test('running is true exactly for the six running phases', () => {
    const f = fixture();
    for (const phase of [...RUNNING_PHASES, 'complete', 'failed', 'interrupted', 'weird']) {
      writeJob(f, live({ phase }));
      assert.equal(f.make().job().running, RUNNING_PHASES.includes(phase), phase);
    }
  });
  test('stale (> 20 min) running job projects interrupted; disk is not rewritten; finishedAt keeps old value', () => {
    const f = fixture(); writeJob(f, live({ updatedAt: T0 - STALE - 1, finishedAt: 777 }));
    const snap = snapshot(f.file);
    const j = f.make().job();
    assert.equal(j.running, false); assert.equal(j.phase, 'interrupted'); assert.equal(j.error, M.interruptedInstalling(f.checkout));
    assert.equal(j.finishedAt, 777);
    assert.ok(unchanged(f.file, snap));
    writeJob(f, live({ phase: 'checking', updatedAt: T0 - STALE - 1 }));
    assert.equal(f.make().job().error, M.interrupted, 'before installing nothing moved');
  });
  test('exactly 20 minutes is still running', () => {
    const f = fixture(); writeJob(f, live({ updatedAt: T0 - STALE }));
    const j = f.make().job(); assert.equal(j.running, true); assert.equal(j.phase, 'installing');
  });
  test('missing updatedAt falls back to startedAt', () => {
    const f = fixture(); writeJob(f, { id: 'x', from: '1.0.0', to: '1.1.0', phase: 'checking', startedAt: T0 - STALE - 1 });
    assert.equal(f.make().job().phase, 'interrupted');
    writeJob(f, { id: 'x', from: '1.0.0', to: '1.1.0', phase: 'checking', startedAt: T0 - 1000 });
    assert.equal(f.make().job().running, true);
  });
  test('a fresher lock mtime keeps a job running; an old lock does not', () => {
    const f = fixture(); writeJob(f, live({ updatedAt: T0 - STALE - 60_000 }));
    const lock = f.file + '.lock'; fs.writeFileSync(lock, '');
    fs.utimesSync(lock, (T0 - 1000) / 1000, (T0 - 1000) / 1000);
    assert.equal(f.make().job().running, true);
    fs.utimesSync(lock, (T0 - STALE - 5000) / 1000, (T0 - STALE - 5000) / 1000);
    assert.equal(f.make().job().phase, 'interrupted');
  });
  test('clock jumps: forward past 20 min projects interrupted, backward delays staleness', () => {
    const f = fixture(); writeJob(f, live());
    const su = f.make();
    assert.equal(su.job().running, true);
    f.clock.advance(STALE + 1); assert.equal(su.job().phase, 'interrupted');
    f.clock.set(T0 - 10 * STALE); assert.equal(su.job().running, true);
  });
  test('a finished job never becomes interrupted', () => {
    const f = fixture(); writeJob(f, { ...OLD, updatedAt: T0 - 10 * STALE });
    const j = f.make().job(); assert.equal(j.phase, 'complete'); assert.equal(j.running, false); assert.equal(j.error, null);
  });
});

// ================================================================= head()
describe('§4 head()', () => {
  const at = (files) => {
    const f = fixture({ headContent: null });
    for (const [rel, body] of Object.entries(files)) { const p = path.join(f.checkout, '.git', rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); }
    return f.make().head();
  };
  test('detached HEAD: 40 lowercase hex (with or without newline)', () => {
    assert.equal(at({ HEAD: SHA_A + '\n' }), SHA_A);
    assert.equal(at({ HEAD: SHA_A }), SHA_A);
  });
  test('detached HEAD: uppercase or wrong length is ""', () => {
    assert.equal(at({ HEAD: SHA_A.toUpperCase() + '\n' }), '');
    assert.equal(at({ HEAD: SHA_A.slice(1) + '\n' }), '');
    assert.equal(at({ HEAD: SHA_A + 'a\n' }), '');
  });
  test('symbolic HEAD reads the loose ref', () => {
    assert.equal(at({ HEAD: 'ref: refs/heads/main\n', 'refs/heads/main': SHA_B + '\n' }), SHA_B);
    assert.equal(at({ HEAD: 'ref: refs/heads/feat/x-1.2_a\n', 'refs/heads/feat/x-1.2_a': SHA_C + '\n' }), SHA_C);
  });
  test('symbolic HEAD falls back to the first matching packed-refs line', () => {
    const packed = `# pack-refs with: peeled fully-peeled sorted\n${SHA_E} refs/heads/main-old\n${SHA_C} refs/heads/main\n${SHA_D} refs/heads/main\n`;
    assert.equal(at({ HEAD: 'ref: refs/heads/main\n', 'packed-refs': packed }), SHA_C);
    assert.equal(at({ HEAD: 'ref: refs/heads/main\n', 'refs/heads/main': 'garbage\n', 'packed-refs': packed }), SHA_C);
  });
  test('bad refs, unmatched packed ref and missing HEAD are ""', () => {
    assert.equal(at({ HEAD: 'ref: refs/heads/a..b\n', 'refs/heads/a..b': SHA_B + '\n' }), '');
    assert.equal(at({ HEAD: 'ref: refs/remotes/origin/main\n', 'refs/remotes/origin/main': SHA_B + '\n' }), '');
    assert.equal(at({ HEAD: 'ref: refs/heads/a b\n', 'refs/heads/a b': SHA_B + '\n' }), '');
    assert.equal(at({ HEAD: 'ref: refs/heads/main\n', 'packed-refs': `${SHA_C} refs/heads/other\n` }), '');
    assert.equal(at({}), '');
  });
});

// ================================================================= snapshot()
describe('§5 snapshot()', () => {
  test('exact shape; available = enabled && !reason()', () => {
    const f = fixture();
    assert.deepEqual(f.make().snapshot(), { enabled: true, available: true, reason: null, job: null });
    assert.deepEqual(fixture({ enabled: false, pmId: null }).make().snapshot(), { enabled: false, available: false, reason: null, job: null });
    assert.deepEqual(fixture({ pmId: null }).make().snapshot(), { enabled: true, available: false, reason: M.pm2, job: null });
  });
  test('calls reason() twice and job() once, no cache', () => {
    const f = fixture(); const su = f.make();
    let r = 0, j = 0; const realR = su.reason.bind(su), realJ = su.job.bind(su);
    su.reason = () => { r += 1; return realR(); }; su.job = () => { j += 1; return realJ(); };
    su.snapshot(); assert.equal(r, 2); assert.equal(j, 1);
    writeJob(f, OLD); assert.equal(su.snapshot().job.id, 'old-id');
  });
});

// ================================================================= begin() validation
describe('§6 begin() validation order, 409, no start', () => {
  test('disabled is checked first', () => {
    const f = fixture({ enabled: false, pmId: null, git: 'none' });
    rejects(() => f.make().begin({ from: 'x', to: 'y', head: 'z', busy: 9, otherJob: true }), M.disabled);
    noStart(f, null);
  });
  test('reason() is checked before versions', () => {
    const f = fixture({ pmId: null, git: 'none' });
    rejects(() => f.make().begin({ from: 'x', to: 'y', head: 'z' }), M.pm2);
    const g = fixture({ git: 'none' });
    rejects(() => g.make().begin({ from: 'x', to: 'y', head: 'z' }), M.git);
    noStart(f, null); noStart(g, null);
  });
  test('invalid from/to versions (before head)', () => {
    const bad = ['02.3.4', '2.03.4', '2.3.04', '2.3', 'v2.3.4', ' 2.3.4', '2.3.4 ', '2.3.4-beta.1', '2.3.4+build', '', '2.3.4.5', undefined];
    for (const v of bad) {
      const f = fixture(); writeJob(f, OLD); const snap = snapshot(f.file);
      rejects(() => f.make().begin({ from: v, to: '2.3.4', head: 'nothex' }), M.version);
      rejects(() => f.make().begin({ from: '2.3.4', to: v, head: 'nothex' }), M.version);
      noStart(f, snap);
    }
  });
  test('valid version forms are accepted (begin does not compare versions)', () => {
    for (const [from, to] of [['2.3.4', '0.0.0'], ['0.0.0', '10.20.30'], ['1.1.0', '1.1.0']]) {
      const f = fixture(); f.make().begin({ from, to }); assert.equal(f.calls.length, 1, `${from} -> ${to}`);
    }
  });
  test('head must be 40 lowercase hex (checked before running job)', () => {
    for (const head of [SHA_A.toUpperCase(), SHA_A.slice(1), '', 'g'.repeat(40)]) {
      const f = fixture(); writeJob(f, live()); const snap = snapshot(f.file);
      rejects(() => begin11(f.make(), { head, otherJob: true, busy: 2 }), M.head);
      noStart(f, snap);
    }
    const f = fixture({ headContent: 'ref: refs/heads/main\n' });
    rejects(() => begin11(f.make()), M.head);
  });
  test('running job, then otherJob, then busy', () => {
    let f = fixture(); writeJob(f, live()); let snap = snapshot(f.file);
    rejects(() => begin11(f.make(), { otherJob: true, busy: 3 }), M.running); noStart(f, snap);
    f = fixture(); writeJob(f, OLD); snap = snapshot(f.file);
    rejects(() => begin11(f.make(), { otherJob: true, busy: 3 }), M.other); noStart(f, snap);
    f = fixture(); writeJob(f, OLD); snap = snapshot(f.file);
    rejects(() => begin11(f.make(), { busy: 1 }), M.busy); noStart(f, snap);
    const j = f.make().job(); assert.equal(j.phase, 'complete');
  });
  test('negative, NaN and nonnumeric busy are not rejected', () => {
    for (const busy of [-1, NaN, 'abc', 0]) { const f = fixture(); begin11(f.make(), { busy }); assert.equal(f.calls.length, 1, String(busy)); }
  });
});

// ================================================================= begin() success
describe('§6/§7 begin() success', () => {
  test('setsid launch: exact command, arguments, options and restricted env', () => {
    const f = fixture({ envExtra: { FICT_API_KEY: SECRET, ANTHROPIC_API_KEY: SECRET, PM2_HOME: '/fict/pm2' } });
    const su = f.make();
    const snap = begin11(su);
    assert.equal(f.calls.length, 1);
    const { cmd, args, opts, child } = f.calls[0];
    assert.equal(cmd, 'setsid');
    assert.deepEqual(args, ['-f', 'bash', su.script, f.checkout, '1.1.0', SHA_A, '3', '3999', f.file, '/fict/node', REPO, '1.0.0']);
    assert.equal(opts.cwd, f.checkout); assert.equal(opts.detached, true);
    assert.equal(opts.stdio[0], 'ignore'); assert.equal(typeof opts.stdio[1], 'number'); assert.equal(opts.stdio[1], opts.stdio[2]);
    assert.deepEqual(opts.env, { PATH: '/fict/bin:/usr/bin', HOME: f.home, LANG: 'C.UTF-8', PM2_HOME: '/fict/pm2' });
    assert.ok(child.listenerCount('error') >= 1, 'error listener registered');
    assert.equal(child.unrefCalls, 1);
    assert.throws(() => fs.fstatSync(opts.stdio[1]), { code: 'EBADF' }, 'log fd closed after spawn');
    assert.equal(snap.enabled, true); assert.equal(snap.available, true); assert.equal(snap.reason, null);
    assert.equal(snap.job.phase, 'queued'); assert.equal(snap.job.running, true);
    assert.ok(!fs.readFileSync(f.file, 'utf8').includes(SECRET)); assert.ok(!fs.readFileSync(f.log, 'utf8').includes(SECRET));
  });
  test('bash launch when setsid is false; env defaults; PM2_HOME omitted when empty', () => {
    const f = fixture({ setsid: false, envExtra: { PM2_HOME: '' } });
    delete f.env.PATH; delete f.env.HOME;
    const su = f.make(); begin11(su);
    const { cmd, args, opts } = f.calls[0];
    assert.equal(cmd, 'bash');
    assert.deepEqual(args, [su.script, f.checkout, '1.1.0', SHA_A, '3', '3999', f.file, '/fict/node', REPO, '1.0.0']);
    assert.deepEqual(opts.env, { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: os.homedir(), LANG: 'C.UTF-8' });
  });
  test('explicit head and numeric pm_id are passed as strings', () => {
    const f = fixture({ pmId: 12 }); begin11(f.make({ port: 4567 }), { head: SHA_B });
    assert.deepEqual(f.calls[0].args.slice(4, 8), ['1.1.0', SHA_B, '12', '4567']);
  });
  test('queued record: UUID, exact keys, clock values, 2-space JSON, no newline, mode 0600', () => {
    const f = fixture(); begin11(f.make());
    const raw = fs.readFileSync(f.file, 'utf8'); const j = JSON.parse(raw);
    assert.deepEqual(Object.keys(j).sort(), ['from', 'id', 'phase', 'startedAt', 'to', 'updatedAt']);
    assert.match(j.id, UUID_RE);
    assert.deepEqual({ from: j.from, to: j.to, phase: j.phase, startedAt: j.startedAt, updatedAt: j.updatedAt }, { from: '1.0.0', to: '1.1.0', phase: 'queued', startedAt: T0, updatedAt: T0 });
    assert.equal(raw, JSON.stringify(j, null, 2)); assert.ok(!raw.endsWith('\n'));
    assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(f.file + '.tmp'), false);
  });
  test('log header: newline, ===, ISO UTC, update from -> to (job id); mode 0600; appended', () => {
    const f = fixture(); fs.writeFileSync(f.log, 'earlier\n', { mode: 0o600 });
    begin11(f.make());
    const id = JSON.parse(fs.readFileSync(f.file, 'utf8')).id;
    const log = fs.readFileSync(f.log, 'utf8');
    assert.ok(log.startsWith('earlier\n'));
    assert.match(log.slice('earlier\n'.length), new RegExp(`^\\n=== ?\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d(\\.\\d{3})?Z update 1\\.0\\.0 -> 1\\.1\\.0 \\(job ${id}\\)\\n$`));
    const g = fixture(); begin11(g.make()); assert.equal(fs.statSync(g.log).mode & 0o777, 0o600);
  });
  test('restart (fresh instance) sees queued; a second begin in the same loop gets 409', () => {
    const f = fixture(); const su = f.make(); begin11(su);
    rejects(() => begin11(su), M.running);
    rejects(() => begin11(f.make()), M.running);
    assert.equal(f.calls.length, 1);
    const j = f.make().job(); assert.equal(j.phase, 'queued'); assert.equal(j.running, true);
  });
  test('a stale running job does not block a new begin (overwrites progress)', () => {
    const f = fixture(); writeJob(f, live({ updatedAt: T0 - STALE - 1 }));
    begin11(f.make());
    assert.notEqual(JSON.parse(fs.readFileSync(f.file, 'utf8')).id, 'live-id');
  });
  test('child error event: durable failed record, restart sees failed, nothing thrown', () => {
    const f = fixture(); begin11(f.make());
    const before = JSON.parse(fs.readFileSync(f.file, 'utf8'));
    f.clock.advance(5000);
    assert.doesNotThrow(() => f.calls[0].child.emit('error', Object.assign(new Error('spawn bash ENOENT'), { code: 'ENOENT' })));
    const after = JSON.parse(fs.readFileSync(f.file, 'utf8'));
    assert.equal(after.id, before.id); assert.equal(after.startedAt, T0); assert.equal(after.from, '1.0.0'); assert.equal(after.to, '1.1.0');
    assert.equal(after.phase, 'failed'); assert.equal(after.error, M.startFail);
    assert.equal(after.updatedAt, T0 + 5000); assert.equal(after.finishedAt, T0 + 5000);
    const j = f.make().job(); assert.equal(j.phase, 'failed'); assert.equal(j.running, false); assert.equal(j.error, M.startFail);
  });
});

// ================================================================= fail every step (class)
describe('FES class begin', () => {
  const setup = () => { const f = fixture(); writeJob(f, OLD); return { f, snap: snapshot(f.file) }; };
  const nativeThrow = (fn, code) => {
    let err; try { fn(); } catch (e) { err = e; }
    assert.ok(err, 'begin must throw the native error'); assert.equal(err.status, undefined); assert.equal(err.code, code);
    return err;
  };
  const oldIntact = (f, snap) => {
    noStart(f, snap);
    const j = f.make().job(); assert.equal(j.id, 'old-id'); assert.equal(j.phase, 'complete');
  };
  test('FES open status.tmp fails: native error, old bytes, no child/log', () => {
    const { f, snap } = setup();
    const restore = failFsFor('openSync', '.json.tmp');
    try { nativeThrow(() => begin11(f.make()), 'EIO'); } finally { restore(); }
    oldIntact(f, snap);
  });
  test('FES write tmp fails: old bytes, no child/log', () => {
    const { f, snap } = setup();
    let hits = 0; const pred = (args) => { const hit = /"queued"/.test(String(args[1])); if (hit) hits += 1; return hit; };
    const err = () => Object.assign(new Error('injected write failure'), { code: 'ENOSPC' });
    const r1 = patch(fs, 'writeFileSync', failing(fs.writeFileSync, { on: pred, error: err }));
    const r2 = patch(fs, 'writeSync', failing(fs.writeSync, { on: pred, error: err }));
    try { nativeThrow(() => begin11(f.make()), 'ENOSPC'); } finally { r2(); r1(); }
    assert.ok(hits > 0, 'harness: write injection was hit');
    oldIntact(f, snap);
  });
  test('FES fsync tmp fails: old bytes, no child/log', () => {
    const { f, snap } = setup();
    const r = patch(fs, 'fsyncSync', failing(fs.fsyncSync, { on: [1] }));
    try { nativeThrow(() => begin11(f.make()), 'EIO'); } finally { r(); }
    oldIntact(f, snap);
  });
  test('FES close tmp fails: old bytes, no child/log', () => {
    const { f, snap } = setup();
    const r = patch(fs, 'closeSync', failing(fs.closeSync, { on: [1] }));
    try { nativeThrow(() => begin11(f.make()), 'EIO'); } finally { r(); }
    oldIntact(f, snap);
  });
  test('FES rename tmp fails: old bytes, no child/log', () => {
    const { f, snap } = setup();
    const r = failFsFor('renameSync', '.json.tmp');
    try { nativeThrow(() => begin11(f.make()), 'EIO'); } finally { r(); }
    oldIntact(f, snap);
  });
  test('FES log open fails: native error, no child', () => {
    const { f } = setup();
    const r = failFsFor('openSync', SELF_UPDATE_LOG);
    try { nativeThrow(() => begin11(f.make()), 'EIO'); } finally { r(); }
    assert.equal(f.calls.length, 0);
  });
  test('FES log header write fails: native error, no child', () => {
    const { f } = setup();
    const pred = (args) => String(args[1]).startsWith('\n===');
    const r1 = patch(fs, 'writeSync', failing(fs.writeSync, { on: pred }));
    const r2 = patch(fs, 'writeFileSync', failing(fs.writeFileSync, { on: pred }));
    try { nativeThrow(() => begin11(f.make()), 'EIO'); } finally { r2(); r1(); }
    assert.equal(f.calls.length, 0);
  });
  test('FES spawn throws synchronously: native error, header logged', () => {
    const { f } = setup();
    const su = f.make({ spawner: () => { throw Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }); } });
    nativeThrow(() => begin11(su), 'EACCES');
    assert.match(fs.readFileSync(f.log, 'utf8'), /update 1\.0\.0 -> 1\.1\.0 \(job /);
  });
  test('FES child error event after a write failure is swallowed (not thrown)', () => {
    const { f } = setup(); begin11(f.make());
    const r = failFsFor('renameSync', '.json.tmp');
    try { assert.doesNotThrow(() => f.calls[0].child.emit('error', new Error('spawn failed'))); } finally { r(); }
  });
});

// ================================================================= divergences (class)
describe('divergences (class)', () => {
  const freshNotRunning = (f, msg) => {
    const j = f.make().job();
    assert.notEqual(j?.running, true, msg);
  };
  // 1.124.4: begin() still throws the native error (the route answers 503), and the record it wrote says the start failed.
  const startFailed = (f, threw) => {
    assert.ok(threw && threw.status === undefined && threw.code, 'begin rethrows the native error');
    const j = f.make().job(); assert.equal(j.phase, 'failed'); assert.equal(j.running, false); assert.equal(j.error, M.startFail);
    assert.equal(typeof j.finishedAt, 'number');
  };
  test('DIV-1: log-open failure must not leave a running queued job', () => {
    const f = fixture(); const r = failFsFor('openSync', SELF_UPDATE_LOG);
    let threw; try { try { begin11(f.make()); } catch (e) { threw = e; } } finally { r(); }
    assert.equal(f.calls.length, 0);
    freshNotRunning(f, 'log-open failure left a running job: no updater exists, but retry is blocked for 20 minutes');
    startFailed(f, threw);
  });
  test('DIV-2: log-header write failure must not leave a running queued job', () => {
    const f = fixture(); const pred = (args) => String(args[1]).startsWith('\n===');
    const r1 = patch(fs, 'writeSync', failing(fs.writeSync, { on: pred }));
    const r2 = patch(fs, 'writeFileSync', failing(fs.writeFileSync, { on: pred }));
    let threw; try { try { begin11(f.make()); } catch (e) { threw = e; } } finally { r2(); r1(); }
    freshNotRunning(f, 'log-header failure left a running job that blocks another press');
    startFailed(f, threw);
  });
  test('DIV-3: synchronous spawn failure must leave a failed (not running) record', () => {
    const f = fixture();
    let threw; try { begin11(f.make({ spawner: () => { throw Object.assign(new Error('spawn E2BIG'), { code: 'E2BIG' }); } })); } catch (e) { threw = e; }
    const j = f.make().job();
    assert.notEqual(j?.running, true, 'synchronous spawn failure left queued/running');
    assert.equal(j?.phase, 'failed', 'synchronous spawn failure should record phase failed');
    startFailed(f, threw);
    assert.equal(f.make().begin({ from: '1.0.0', to: '1.1.0' }).job.phase, 'queued', 'a second press is let through');
  });
  // Ruled not a fault on its own (two faults at once: the child fails AND the data folder refuses writes). Since 1.124.4 the
  // not-started rule in job() covers it: the job reads running only for the two-minute grace, then as not started.
  test('a failed error-listener write leaves the job queued only until the start grace, then reads as not started', () => {
    const f = fixture(); begin11(f.make());
    const r = failFsFor('renameSync', '.json.tmp');
    try { f.calls[0].child.emit('error', new Error('spawn failed')); } finally { r(); }
    assert.equal(f.make().job().running, true, 'within the grace the job may still be starting');
    f.clock.advance(GRACE + 1);
    const j = f.make().job();
    assert.equal(j.running, false); assert.equal(j.phase, 'failed'); assert.equal(j.error, M.notStarted);
  });
  // Removed after the 2026-11-23 review: DIV-5 (on()/unref() throwing) is guarded, since the daemon passes Node's spawn, whose
  // ChildProcess does not throw there; DIV-14 (corrupt progress while the lock is held) is not a fault, since every writer is
  // tmp + rename and a second script stops at flock (pinned by '§Shell flock rejects while another updater holds the lock').

  // Ruled not a fault (DIV-6: close of a local file does not fail in practice); 1.124.4's always-close in begin() makes it hold.
  test('a log close failure after spawn does not report a failed start while the updater runs', async () => {
    const f = fixture(); let logFd = -1, pid;
    const su = f.make({ spawner: (cmd, args, opts) => {
      logFd = opts.stdio[1];
      const c = spawn('/usr/bin/sleep', ['30'], { detached: true, stdio: 'ignore' }); pid = track(c.pid); return c;
    } });
    const r = patch(fs, 'closeSync', failing(fs.closeSync, { on: (args) => args[0] === logFd }));
    let threw = false; try { begin11(su); } catch { threw = true; } finally { r(); }
    try { if (logFd >= 0) fs.closeSync(logFd); } catch {}
    const running = alive(pid);
    try { process.kill(pid, 'SIGKILL'); } catch {}
    assert.ok(!(threw && running), 'begin threw (route says the update did not start) while the spawned updater is running');
  });
  // Rewritten in 1.124.4 to the requirement that can be met: nothing watches the script (under setsid -f the daemon's child
  // exits at once whatever happens), so a script that dies before taking its lock is reported once the start grace has
  // passed, not the moment it exits. Before the grace it still reads as running.
  test('DIV-7: an updater that exits before taking its lock is reported as not started once the grace has passed', async () => {
    const f = fixture({ setsid: false, envExtra: { PATH: '/usr/bin:/bin' } });
    const early = path.join(f.base, 'early.sh'); fs.writeFileSync(early, 'exit 3\n');
    let child;
    const su = f.make({ script: early, spawner: (c, a, o) => { child = spawn(c, a, o); track(child.pid); return child; } });
    begin11(su);
    await until(() => child.exitCode !== null, 3000);
    assert.equal(child.exitCode, 3, 'harness: stand-in updater exited 3');
    f.clock.advance(GRACE - 1000);
    let j = f.make().job(); assert.equal(j.phase, 'queued'); assert.equal(j.running, true, 'within the grace it is still running');
    f.clock.advance(2000);
    j = f.make().job();
    assert.equal(j.running, false, 'updater exited with code 3 and the grace has passed, but restart still reports a running job');
    assert.equal(j.phase, 'failed'); assert.equal(j.error, M.notStarted);
    assert.equal(f.make().begin({ from: '1.0.0', to: '1.1.0' }).job.phase, 'queued', 'a second press is let through');
  });
  // Ruled not a fault (DIV-13): bash reads its script through one open descriptor, and git replaces a file it changes (unlink,
  // then create) instead of rewriting it in place, so a running script finishes its own version. Each of the three moves the
  // script makes (merge --ff-only, reset --hard, checkout --detach) is pinned here to give the script file a new inode.
  test('each git move the script makes replaces the script file rather than rewriting it in place', () => {
    const base = tmpDir('su-inode-'); const home = path.join(base, 'home'); fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, '.gitconfig'), gitconfig());
    const co = path.join(base, 'co'); fs.mkdirSync(path.join(co, 'scripts'), { recursive: true });
    const file = path.join(co, 'scripts', 'pocket-self-update.sh');
    g(co, ['init', '-q', '-b', 'main'], home);
    fs.writeFileSync(file, 'echo "v1"\n'); g(co, ['add', '-A'], home); g(co, ['commit', '-qm', 'v1'], home);
    const v1 = g(co, ['rev-parse', 'HEAD'], home);
    fs.writeFileSync(file, 'echo "v2, a different text at the same offset"\n'); g(co, ['commit', '-qam', 'v2'], home);
    const v2 = g(co, ['rev-parse', 'HEAD'], home);
    g(co, ['reset', '-q', '--hard', v1], home);
    // A descriptor held open across the move, as bash holds the running script (with none held, the file system may hand
    // the freed inode number straight to the new file).
    for (const args of [['merge', '--ff-only', '-q', v2], ['reset', '-q', '--hard', v1], ['checkout', '-q', '--detach', v2]]) {
      const text = fs.readFileSync(file, 'utf8'), fd = fs.openSync(file, 'r');
      try {
        g(co, args, home);
        assert.notEqual(fs.readFileSync(file, 'utf8'), text, `harness: git ${args[0]} changed the script`);
        assert.notEqual(fs.fstatSync(fd).ino, fs.statSync(file).ino, `git ${args[0]} rewrote the script in place`);
        const buf = Buffer.alloc(200); assert.equal(buf.toString('utf8', 0, fs.readSync(fd, buf, 0, 200, 0)), text, `git ${args[0]}: the open script no longer reads its own text`);
      } finally { fs.closeSync(fd); }
    }
  });
});

// ================================================================= shell harness
const WL = ['bash', 'sh', 'env', 'cat', 'sed', 'head', 'tail', 'mktemp', 'ls', 'cp', 'mv', 'sort', 'wc', 'tr', 'cut', 'id', 'uname', 'stat', 'find', 'xargs', 'gzip', 'gunzip', 'zcat', 'readlink', 'dirname', 'printf', 'true', 'false', 'tee', 'realpath', 'rm', 'seq', 'kill', 'touch', 'basename', 'grep', 'awk', 'flock', 'setsid', 'ln', 'echo', 'test', '[', 'sync', 'du', 'timeout', 'comm', 'uniq', 'expr', 'nice', 'nohup', 'tac', 'od', 'sha256sum', 'whoami', 'hostname', 'rmdir', 'chown', 'nproc', 'getconf'];
const realBin = n => ['/usr/bin', '/bin'].map(d => path.join(d, n)).find(p => fs.existsSync(p));
const sh = lines => '#!/usr/bin/bash\n' + lines.join('\n') + '\n';
const WRAP = {
  git: sh([
    'S="$HOME/.standin"', 'has() { [ -e "$S/f.$1" ]; }', 'hit() { echo "$1" >> "$S/hits"; }',
    'for a in "$@"; do', '  case "$a" in',
    '    ls-files) if has lsfiles; then hit lsfiles; exit 128; fi ;;',
    '    merge|checkout) if has move; then hit move; echo "error: fict move failure" >&2; exit 1; fi ;;',
    '    reset) if has gitreset; then hit gitreset; echo "fatal: fict reset failure" >&2; exit 128; fi ;;',
    '  esac', 'done',
    'if has revparsetag; then rp=0; tg=0; for a in "$@"; do [ "$a" = rev-parse ] && rp=1; case "$a" in *v1.1.0*) tg=1;; esac; done',
    '  if [ $rp = 1 ] && [ $tg = 1 ]; then hit revparsetag; exit 128; fi; fi',
    'exec /usr/bin/git "$@"']),
  tar: sh([
    'S="$HOME/.standin"',
    'if [ "$1" = --version ]; then if [ -e "$S/f.tarnotgnu" ]; then echo "bsdtar 3.7.2 - libarchive 3.7.2"; exit 0; fi; exec /usr/bin/tar "$@"; fi',
    'if [ ! -e "$S/tar.created" ]; then : > "$S/tar.created"',
    '  if [ -e "$S/f.tarrc2" ]; then echo tarrc2 >> "$S/hits"; echo "tar: fict fatal" >&2; exit 2; fi',
    '  if [ -e "$S/f.tarrc1" ]; then /usr/bin/tar "$@"; echo tarrc1 >> "$S/hits"; exit 1; fi',
    '  if [ -e "$S/f.tarrc2ok" ]; then /usr/bin/tar "$@"; echo tarrc2ok >> "$S/hits"; exit 2; fi',
    '  if [ -e "$S/f.tarempty" ]; then echo tarempty >> "$S/hits"; o=""; p=""; for a in "$@"; do [ "$p" = -czf ] && o=$a; p=$a; done; exec /usr/bin/tar -czf "$o" -T /dev/null; fi', 'fi',
    'exec /usr/bin/tar "$@"']),
  df: sh([
    'if [ -e "$HOME/.standin/space" ]; then printf "Filesystem     1024-blocks    Used Available Capacity Mounted on\\n/dev/fict 20000000 1000 %s 50%% /\\n" "$(cat "$HOME/.standin/space")"; exit 0; fi',
    'if [ -e "$HOME/.standin/f.lowspace" ]; then echo lowspace >> "$HOME/.standin/hits"',
    '  for a in "$@"; do case "$a" in --output*) printf "Avail\\n1000\\n"; exit 0;; esac; done',
    '  printf "Filesystem     1024-blocks    Used Available Capacity Mounted on\\n/dev/fict 10000000 9999000 1000 100%% /\\n"; exit 0; fi',
    'exec /usr/bin/df "$@"']),
  date: sh([
    'if [ -e "$HOME/.standin/f.datefixed" ]; then for a in "$@"; do case "$a" in *%Y%m%d*) echo 20260101-000000; exit 0;; esac; done; fi',
    'exec /usr/bin/date "$@"']),
  mkdir: sh([
    'if [ -e "$HOME/.standin/f.mkdir" ]; then for a in "$@"; do case "$a" in *pocket-code-*) echo mkdir >> "$HOME/.standin/hits"; echo "mkdir: fict denied" >&2; exit 1;; esac; done; fi',
    'exec /usr/bin/mkdir "$@"']),
  chmod: sh([
    'if [ -e "$HOME/.standin/f.chmod" ]; then for a in "$@"; do case "$a" in */backups/*) echo chmod >> "$HOME/.standin/hits"; echo "chmod: fict denied" >&2; exit 1;; esac; done; fi',
    'exec /usr/bin/chmod "$@"']),
  sleep: sh(['s=$(/usr/bin/awk -v s="$1" \'BEGIN{printf "%.3f", s/20}\')', 'exec /usr/bin/sleep "$s"']),
};
const NODE_SHEBANG = '#!' + process.execPath + '\n';
const PM2 = NODE_SHEBANG + `
const fs = require('fs'), path = require('path');
const S = path.join(process.env.HOME, '.standin'), A = path.join(S, 'app.json');
const has = f => fs.existsSync(path.join(S, 'f.' + f));
const st = JSON.parse(fs.readFileSync(A, 'utf8'));
const args = process.argv.slice(2);
fs.appendFileSync(path.join(S, 'calls.log'), 'pm2 ' + args.join(' ') + ' busy=' + st.busy + '\\n');
const save = () => { fs.writeFileSync(A + '.w', JSON.stringify(st)); fs.renameSync(A + '.w', A); };
if (args[0] === 'jlist') { process.stdout.write(JSON.stringify([{ pm_id: 9, name: 'other', pid: 55 }, { pm_id: 7, name: 'fict-app', pid: st.pid }])); process.exit(0); }
if (args[0] === 'restart') {
  const co = fs.readFileSync(path.join(S, 'checkout'), 'utf8');
  const v = JSON.parse(fs.readFileSync(path.join(co, 'package.json'), 'utf8')).version;
  st.pid += 1; st.health = 'ok';
  if (has('boot.' + v)) { st.version = ''; st.ok = false; } else { st.version = v; st.ok = true; }
  save(); process.exit(0);
}
if (args[0] === 'save') process.exit(has('pm2save') ? 1 : 0);
process.exit(0);
`;
const NPM = NODE_SHEBANG + `
const fs = require('fs'), path = require('path');
const S = path.join(process.env.HOME, '.standin');
const has = f => fs.existsSync(path.join(S, 'f.' + f));
const args = process.argv.slice(2), cwd = process.cwd();
let v = ''; try { v = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).version; } catch {}
fs.appendFileSync(path.join(S, 'calls.log'), 'npm ' + args.join(' ') + ' v=' + v + '\\n');
if (has('npmsecret')) { console.log('npm notice auth token=${SECRET}'); console.error('npm warn token=${SECRET}'); }
function main() {
  if (args[0] === 'ci') {
    if (has('npmhang')) { fs.writeFileSync(path.join(S, 'npmhang.pid'), String(process.pid)); setTimeout(() => process.exit(0), 20000); return; }
    if (has('npmci.' + v)) { console.error('npm ERR! fict install failure'); process.exit(1); }
    fs.rmSync(path.join(cwd, 'node_modules'), { recursive: true, force: true });
    fs.mkdirSync(path.join(cwd, 'node_modules')); fs.writeFileSync(path.join(cwd, 'node_modules', '.installed'), v);
    process.exit(0);
  }
  if (args[0] === 'run') process.exit(has('check') ? 1 : 0);
  process.exit(0);
}
main();
`;

let TPL; // template repos, built once
function g(cwd, args, home) {
  const r = spawnSync('/usr/bin/git', args, { cwd, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', LANG: 'C.UTF-8' } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
const gitconfig = (extra = '') => '[user]\n\tname = Fict Dev\n\temail = dev@example.invalid\n[init]\n\tdefaultBranch = main\n[advice]\n\tdetachedHead = false\n[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n' + extra;
function buildTemplate() {
  const base = tmpDir('su-tpl-'); const home = path.join(base, 'home'); fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, '.gitconfig'), gitconfig());
  const seed = path.join(base, 'seed'); fs.mkdirSync(seed);
  g(seed, ['init', '-q', '-b', 'main'], home);
  const pkg = v => JSON.stringify({ name: 'fict-app', version: v, private: true }, null, 2) + '\n';
  fs.writeFileSync(path.join(seed, 'package.json'), pkg('1.0.0'));
  fs.writeFileSync(path.join(seed, '.gitignore'), 'node_modules/\n.env\ndata/\n.impeccable/\n');
  fs.writeFileSync(path.join(seed, 'README.md'), 'fictional app\n');
  g(seed, ['add', '-A'], home); g(seed, ['commit', '-qm', 'v1.0.0'], home); g(seed, ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0'], home);
  const sha10 = g(seed, ['rev-parse', 'HEAD'], home);
  fs.writeFileSync(path.join(seed, 'package.json'), pkg('1.1.0'));
  g(seed, ['commit', '-qam', 'v1.1.0'], home); g(seed, ['tag', '-a', 'v1.1.0', '-m', 'v1.1.0'], home);
  const sha11 = g(seed, ['rev-parse', 'HEAD'], home);
  const good = path.join(base, 'good.git'); g(base, ['clone', '-q', '--bare', seed, good], home);
  const notag = path.join(base, 'notag.git'); g(base, ['clone', '-q', '--bare', seed, notag], home); g(notag, ['tag', '-d', 'v1.1.0'], home);
  const seed2 = path.join(base, 'seed2'); g(base, ['clone', '-q', seed, seed2], home);
  g(seed2, ['tag', '-d', 'v1.1.0'], home); g(seed2, ['checkout', '-q', '-b', 'side', sha10], home);
  fs.writeFileSync(path.join(seed2, 'package.json'), pkg('1.1.0')); fs.writeFileSync(path.join(seed2, 'SIDE.md'), 'side\n');
  g(seed2, ['add', '-A'], home); g(seed2, ['commit', '-qm', 'side'], home); g(seed2, ['tag', '-a', 'v1.1.0', '-m', 'side'], home);
  g(seed2, ['checkout', '-q', 'main'], home);
  const offmain = path.join(base, 'offmain.git'); g(base, ['clone', '-q', '--bare', seed2, offmain], home);
  const co = path.join(base, 'co'); g(base, ['clone', '-q', good, co], home);
  g(co, ['remote', 'set-url', 'origin', 'https://github.com/' + REPO], home);
  g(co, ['reset', '-q', '--hard', 'v1.0.0'], home); g(co, ['tag', '-d', 'v1.1.0'], home);
  g(co, ['update-ref', 'refs/remotes/origin/main', sha10], home);
  fs.writeFileSync(path.join(co, '.env'), 'FICT_TOKEN=fict-not-real\n');
  fs.mkdirSync(path.join(co, 'data')); fs.writeFileSync(path.join(co, 'data', 'state.json'), '{"x":1}');
  fs.mkdirSync(path.join(co, 'node_modules')); fs.writeFileSync(path.join(co, 'node_modules', '.installed'), '1.0.0');
  fs.mkdirSync(path.join(co, 'sub', 'node_modules'), { recursive: true }); fs.writeFileSync(path.join(co, 'sub', 'node_modules', 'y.txt'), 'y');
  fs.mkdirSync(path.join(co, '.impeccable')); fs.writeFileSync(path.join(co, '.impeccable', 'cache.txt'), 'c');
  return { base, sha10, sha11, origins: { good, notag, offmain }, co };
}

function startApp(file) {
  const server = http.createServer((req, res) => {
    let st; try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { res.writeHead(500); return res.end('x'); }
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/release.json') return st.version ? json(200, { version: st.version }) : json(503, { error: 'down' });
    if (req.url === '/api/health') {
      if (st.health === 'bad' || st.badLeft > 0) {
        server.badProbes = (server.badProbes || 0) + 1;
        if (st.badLeft > 0) { st.badLeft -= 1; fs.writeFileSync(file + '.w', JSON.stringify(st)); fs.renameSync(file + '.w', file); }
        res.writeHead(500, { 'content-type': 'text/html' }); return res.end('<html>oops</html>');
      }
      if (!st.ok) return json(503, { ok: false });
      json(200, { ok: true, busy: st.busy });
      if (st.flip && st.busy === 0) { st.busy = 1; st.flipped = true; fs.writeFileSync(file + '.w', JSON.stringify(st)); fs.renameSync(file + '.w', file); }
      else if (st.flipped && st.busy === 1 && st.flipEnds !== undefined && --st.flipEnds <= 0) { st.busy = 0; st.flip = false; fs.writeFileSync(file + '.w', JSON.stringify(st)); fs.renameSync(file + '.w', file); }
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

async function shellEnv({ origin = 'good', faults = [], sayfail = [], sayonce = [], saysecond = [], app = {}, drop = [], prep, writeStatus = true, home: sharedHome } = {}) {
  const dir = tmpDir('su-sh-');
  const home = sharedHome || path.join(dir, 'home'); const S = path.join(home, '.standin');
  fs.mkdirSync(S, { recursive: true });
  const co = path.join(dir, 'co');
  const cp = spawnSync('/usr/bin/cp', ['-a', TPL.co, co]); if (cp.status !== 0) throw new Error('cp failed');
  const data = path.join(dir, 'data'); fs.mkdirSync(data);
  const originPath = origin === 'missing' ? path.join(dir, 'nowhere.git') : TPL.origins[origin];
  if (!sharedHome) fs.writeFileSync(path.join(home, '.gitconfig'), gitconfig(`[url "${originPath}"]\n\tinsteadOf = https://github.com/${REPO}\n\tinsteadOf = git@github.com:${REPO}.git\n`));
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  for (const n of WL) { const p = realBin(n); if (p) fs.symlinkSync(p, path.join(bin, n)); }
  for (const [n, body] of Object.entries(WRAP)) fs.writeFileSync(path.join(bin, n), body, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'pm2'), PM2, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'npm'), NPM, { mode: 0o755 });
  const nodeWrapper = path.join(bin, 'node');
  fs.writeFileSync(nodeWrapper, sh(['Z="$HOME/.standin"; for a in "$@"; do',
    '  if [ -e "$Z/sayfail.$a" ]; then echo "sayfail.$a" >> "$Z/hits"; exit 1; fi',
    '  if [ -e "$Z/sayonce.$a" ]; then /usr/bin/rm -f "$Z/sayonce.$a"; echo "sayonce.$a" >> "$Z/hits"; exit 1; fi',
    '  if [ -e "$Z/saysecond.$a" ]; then /usr/bin/mv "$Z/saysecond.$a" "$Z/sayfail.$a"; fi',
    'done', `exec ${process.execPath} "$@"`]), { mode: 0o755 });
  for (const n of drop) fs.rmSync(path.join(bin, n), { force: true });
  for (const f of faults) fs.writeFileSync(path.join(S, 'f.' + f), '');
  for (const p of sayfail) fs.writeFileSync(path.join(S, 'sayfail.' + p), '');
  for (const p of sayonce) fs.writeFileSync(path.join(S, 'sayonce.' + p), '');
  for (const p of saysecond) fs.writeFileSync(path.join(S, 'saysecond.' + p), '');
  const appFile = path.join(S, 'app.json');
  fs.writeFileSync(appFile, JSON.stringify({ pid: 4100, version: '1.0.0', ok: true, busy: 0, health: 'ok', ...app }));
  fs.writeFileSync(path.join(S, 'checkout'), co);
  const server = await startApp(appFile);
  const E = { dir, home, S, co, data, bin, nodeWrapper, server, appFile, port: server.address().port, status: path.join(data, SELF_UPDATE_FILE) };
  if (prep) prep(E);
  E.head = g(co, ['rev-parse', 'HEAD'], home);
  E.args = (over = {}) => { const a = { co, to: '1.1.0', head: E.head, pm: '7', port: String(E.port), status: E.status, node: nodeWrapper, repo: REPO, from: '1.0.0', ...over }; return [a.co, a.to, a.head, a.pm, a.port, a.status, a.node, a.repo, a.from]; };
  if (writeStatus) fs.writeFileSync(E.status, JSON.stringify({ id: '00000000-0000-4000-8000-000000000001', from: '1.0.0', to: '1.1.0', phase: 'queued', startedAt: Date.now(), updatedAt: Date.now() }, null, 2), { mode: 0o600 });
  return E;
}
async function withShell(opts, fn) {
  const E = await shellEnv(opts);
  try { return await fn(E); } finally { E.server.closeAllConnections?.(); await new Promise(r => E.server.close(r)); }
}
function killGroup(pid) { try { process.kill(-pid, 'SIGKILL'); } catch {} }
async function runShell(E, { args, extraEnv = {}, timeoutMs = 25_000, onStart, keepGroup = false } = {}) {
  const logPath = path.join(E.data, 'shell.log');
  const fd = fs.openSync(logPath, 'a', 0o600);
  const env = { PATH: E.bin, HOME: E.home, LANG: 'C.UTF-8', POCKET_SELF_UPDATE_TRIES: '3', POCKET_SELF_UPDATE_SETTLE: '1', POCKET_SELF_UPDATE_BEAT: '2', POCKET_SELF_UPDATE_IDLE_TRIES: '2', ...extraEnv };
  const child = spawn('/usr/bin/bash', [SCRIPT, ...(args || E.args())], { cwd: E.dir, env, detached: true, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd); track(child.pid);
  if (onStart) onStart(child);
  const res = await new Promise(resolve => {
    const timer = setTimeout(() => killGroup(child.pid), timeoutMs);
    child.on('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  if (!keepGroup) killGroup(child.pid);
  res.pid = child.pid; res.out = fs.readFileSync(logPath, 'utf8');
  return res;
}
const tail = s => s.slice(-1500);
const readStatus = E => { try { return JSON.parse(fs.readFileSync(E.status, 'utf8')); } catch { return null; } };
const headOf = E => g(E.co, ['rev-parse', 'HEAD'], E.home);
const callLines = E => { try { return fs.readFileSync(path.join(E.S, 'calls.log'), 'utf8').split('\n').filter(Boolean); } catch { return []; } };
const restarts = E => callLines(E).filter(l => /^pm2 restart\b/.test(l));
const hits = E => { try { return fs.readFileSync(path.join(E.S, 'hits'), 'utf8'); } catch { return ''; } };
const installed = E => { try { return fs.readFileSync(path.join(E.co, 'node_modules', '.installed'), 'utf8'); } catch { return null; } };
const restartView = (E, data = E.data) => new SelfUpdate({ checkout: E.co, dataDir: data, env: { POCKET_SELF_UPDATE: '1', pm_id: '7', PATH: E.bin, HOME: E.home }, port: String(E.port), repo: REPO, setsid: false }).job();
const backups = E => { try { return fs.readdirSync(path.join(E.home, 'backups')); } catch { return []; } };

async function expectFailure(E, r, msg, { headSame = true, nRestarts = 0, pkgs = '1.0.0', hit } = {}) {
  const ctx = `\n--- log tail ---\n${tail(r.out)}`;
  if (hit) assert.match(hits(E), new RegExp(hit), `harness: fault ${hit} was not hit${ctx}`);
  const st = readStatus(E);
  assert.equal(st?.phase, 'failed', `phase${ctx}`);
  if (msg instanceof RegExp) assert.match(st.error, msg, ctx); else assert.equal(st.error, msg, ctx);
  assert.equal(r.code, 1, `exit code${ctx}`);
  if (headSame) assert.equal(headOf(E), E.head, `HEAD must be unchanged${ctx}`);
  assert.equal(restarts(E).length, nRestarts, `pm2 restart count${ctx}`);
  if (pkgs) assert.equal(installed(E), pkgs, `installed packages${ctx}`);
  const j = restartView(E); assert.equal(j.phase, 'failed'); assert.equal(j.running, false);
  assert.equal(j.error, st.error);
  return st;
}

const T = '1.1.0', F = '1.0.0';
const SM = {
  origin: `This checkout does not come from github.com/${REPO}, so Pocket will not update it by itself. Update it from the server.`,
  branch: b => `The checkout is on branch ${b}, not main. Update it from the server.`,
  dirty: 'Files in the Pocket Code folder were changed by hand. Update it from the server.',
  head: 'The checkout changed since the update started. Check again.',
  upstream: 'Could not reach GitHub. Nothing was changed; try again.',
  tagFetch: `Could not fetch release v${T}. Nothing was changed.`,
  tagMain: `Release v${T} is not on main. Nothing was changed.`,
  tagMissing: `Release v${T} was not found. Nothing was changed.`,
  ahead: 'The checkout has commits that are not in the release. Update it from the server.',
  space: 'The server has less than 5 GB free, and Pocket needs room for its backup. Free some space, then try again. Nothing was changed.',
  backup: 'The backup could not be written, so Pocket removed it. Nothing was changed. Check that the server has room for the backup, then try again.',
  move: `Could not move to v${T}. Nothing was changed.`,
  npm: `Installing v${T}'s packages failed. Pocket stays on ${F}.`,
  check: `v${T} did not pass its release check. Pocket stays on ${F}.`,
  busy: `Replies kept running while Pocket waited to restart, so it did not restart and stays on ${F}. Update again when they finish.`,
  boot: `${T} did not start, so Pocket went back to ${F}. The log is pocket-self-update.log in Pocket's data folder.`,
  cd: 'Could not open the Pocket Code folder. Nothing was changed.',
  tool: t => `${t} is not on Pocket's PATH, so it cannot update itself. Update it from the server.`,
  notGnu: /^Pocket's backup needs GNU tar, and \S+ is not GNU tar\. Install it \(on macOS: brew install gnu-tar\), or update Pocket from the server\. Nothing was changed\.$/,
  flock: 'Another Pocket Code update is running.',
  unwritten: "Pocket could not write the update's progress to its data folder, so it stopped. Nothing was changed.",
  unwrittenMoved: `Pocket could not write the update's progress to its data folder, so it did not restart and stays on ${F}.`,
  mkdir: 'Could not make the backup folder. Nothing was changed.',
  list: "Could not list Pocket's private files for the backup, so it stopped. Nothing was changed.",
};
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const both = (lead, E) => new RegExp('^' + esc(`${lead}, and putting ${F}'s packages back failed too. Pocket keeps running for now but will not start again after a restart until you run npm ci in ${E.co} on the server. Backup: `) + '\\S+$');

// ================================================================= shell tests
describe('shell (stand-in repository)', { concurrency: 6 }, () => {
  before(() => { TPL = buildTemplate(); });

  test('§Shell success on main: complete, exit 0, moved, packages, PM2, backup, status format, restart view', () => withShell({}, async E => {
    const r = await runShell(E);
    const ctx = `\n${tail(r.out)}`;
    assert.equal(r.code, 0, ctx);
    const st = readStatus(E);
    assert.equal(st.phase, 'complete', ctx); assert.equal(typeof st.finishedAt, 'number');
    assert.equal(st.id, '00000000-0000-4000-8000-000000000001'); assert.equal(st.from, F); assert.equal(st.to, T);
    assert.equal(st.error, undefined);
    const raw = fs.readFileSync(E.status, 'utf8'); assert.equal(raw, JSON.stringify(st, null, 2)); assert.ok(!raw.endsWith('\n'));
    assert.equal(fs.statSync(E.status).mode & 0o777, 0o600);
    assert.equal(headOf(E), TPL.sha11); assert.equal(g(E.co, ['symbolic-ref', '--short', 'HEAD'], E.home), 'main');
    assert.equal(installed(E), T);
    assert.equal(restarts(E).length, 1); assert.ok(callLines(E).some(l => /^pm2 save\b/.test(l)), 'pm2 save called');
    assert.ok(callLines(E).some(l => /^npm run -s check:release -- --released\b/.test(l)), 'release check called');
    assert.ok(fs.existsSync(E.status + '.lock'));
    assert.match(r.out, /\b\d\d:\d\d:\d\d\b.*\bchecking\b/); assert.match(r.out, /\b\d\d:\d\d:\d\d\b.*\bcomplete\b/);
    const bs = backups(E); assert.equal(bs.length, 1); assert.match(bs[0], /^pocket-code-1\.1\.0-update-\d{8}-\d{6}$/);
    const bdir = path.join(E.home, 'backups', bs[0]);
    assert.equal(st.backup, bdir);
    assert.equal(fs.statSync(bdir).mode & 0o777, 0o700);
    for (const n of ['files.nul', 'private-state.tar.gz', 'prev-head.txt', 'prev-branch.txt']) {
      assert.ok(fs.existsSync(path.join(bdir, n)), n); assert.equal(fs.statSync(path.join(bdir, n)).mode & 0o777, 0o600, n);
    }
    assert.equal(fs.readFileSync(path.join(bdir, 'prev-head.txt'), 'utf8'), TPL.sha10 + '\n');
    assert.equal(fs.readFileSync(path.join(bdir, 'prev-branch.txt'), 'utf8'), 'main\n');
    const listed = fs.readFileSync(path.join(bdir, 'files.nul'), 'utf8').split('\0').filter(Boolean);
    const arch = spawnSync('/usr/bin/tar', ['-tzf', path.join(bdir, 'private-state.tar.gz')], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
    for (const list of [listed, arch]) {
      for (const want of ['.env', 'data/state.json', 'sub/node_modules/y.txt']) assert.ok(list.includes(want), `${want} in ${list}`);
      assert.ok(!list.some(n => n.startsWith('node_modules/') || n.startsWith('.impeccable/')), `filtered: ${list}`);
    }
    const j = restartView(E); assert.equal(j.phase, 'complete'); assert.equal(j.running, false);
  }));

  test('§Shell success detached: checks out the release detached', () => withShell({ prep: E => g(E.co, ['checkout', '-q', '--detach'], E.home) }, async E => {
    const r = await runShell(E);
    assert.equal(r.code, 0, tail(r.out)); assert.equal(readStatus(E).phase, 'complete');
    assert.equal(headOf(E), TPL.sha11);
    assert.notEqual(spawnSync('/usr/bin/git', ['symbolic-ref', '-q', 'HEAD'], { cwd: E.co, env: { PATH: '/usr/bin', HOME: E.home } }).status, 0, 'still detached');
  }));

  test('§Shell origin forms: git@github.com:<repo>.git and .git suffix are accepted', () => withShell({ prep: E => g(E.co, ['remote', 'set-url', 'origin', `git@github.com:${REPO}.git`], E.home) }, async E => {
    const r = await runShell(E); assert.equal(r.code, 0, tail(r.out)); assert.equal(readStatus(E).phase, 'complete');
  }));

  test('§Shell missing positional args: unbound-variable error before progress is written', () => withShell({ writeStatus: false }, async E => {
    const r = await runShell(E, { args: E.args().slice(0, 3) });
    assert.notEqual(r.code, 0); assert.match(r.out, /unbound variable/);
    assert.equal(fs.existsSync(E.status), false);
  }));

  test('§Shell cd fails', () => withShell({}, async E => {
    const r = await runShell(E, { args: E.args({ co: path.join(E.dir, 'nope') }) });
    await expectFailure(E, r, SM.cd);
  }));
  test('§Shell required command absent (pm2)', () => withShell({ drop: ['pm2'] }, async E => {
    await expectFailure(E, await runShell(E), SM.tool('pm2'));
  }));
  test('§Shell tar is not GNU tar', () => withShell({ faults: ['tarnotgnu'] }, async E => {
    await expectFailure(E, await runShell(E), SM.notGnu);
  }));
  test('§Shell flock rejects while another updater holds the lock', () => withShell({}, async E => {
    const holder = spawn('/usr/bin/flock', [E.status + '.lock', '-c', 'echo ready; exec /usr/bin/sleep 30'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    track(holder.pid);
    try {
      let out = ''; holder.stdout.on('data', d => { out += d; });
      assert.ok(await until(() => out.includes('ready'), 3000));
      const r = await runShell(E);
      assert.equal(r.code, 1, tail(r.out)); assert.equal(readStatus(E).error, SM.flock); assert.equal(readStatus(E).phase, 'failed');
      assert.equal(headOf(E), E.head); assert.equal(restarts(E).length, 0);
    } finally { killGroup(holder.pid); }
  }));
  // 1.124.4: job() takes a queued job with no lock file newer than its start for one that never started. That rests on the
  // script's lock open (exec 9>, a truncate) setting the file's time within seconds of launch, also when the file is already
  // there and empty, as an earlier run leaves it. Here another holder has the lock, so the script stops at flock before its
  // heartbeat could touch the file: only the open can have moved the time.
  test('the script refreshes its lock file time within seconds of launch, also when the file is already there and empty', () => withShell({}, async E => {
    const lock = E.status + '.lock'; fs.writeFileSync(lock, '');
    const holder = spawn('/usr/bin/flock', [lock, '-c', 'echo ready; exec /usr/bin/sleep 30'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    track(holder.pid);
    try {
      let out = ''; holder.stdout.on('data', d => { out += d; });
      assert.ok(await until(() => out.includes('ready'), 3000));
      const old = Date.now() / 1000 - 3600; fs.utimesSync(lock, old, old);
      assert.equal(fs.statSync(lock).size, 0, 'harness: the lock file is there and empty');
      const launched = Date.now();
      const r = await runShell(E);
      assert.equal(readStatus(E).error, SM.flock, tail(r.out));
      const t = fs.statSync(lock).mtimeMs;
      assert.ok(t >= launched - 1000 && t - launched < 5000, `lock time ${t - launched} ms from launch`);
    } finally { killGroup(holder.pid); }
  }));
  test('§Shell wrong origin', () => withShell({ prep: E => g(E.co, ['remote', 'set-url', 'origin', 'https://github.com/other-owner/fict-app'], E.home) }, async E => {
    await expectFailure(E, await runShell(E), SM.origin);
  }));
  test('§Shell not on main', () => withShell({ prep: E => g(E.co, ['checkout', '-q', '-b', 'feature'], E.home) }, async E => {
    await expectFailure(E, await runShell(E), SM.branch('feature'));
  }));
  test('§Shell tracked files changed by hand', () => withShell({ prep: E => fs.appendFileSync(path.join(E.co, 'README.md'), 'edit\n') }, async E => {
    await expectFailure(E, await runShell(E), SM.dirty);
  }));
  test('§Shell HEAD changed since start', () => withShell({}, async E => {
    await expectFailure(E, await runShell(E, { args: E.args({ head: SHA_D }) }), SM.head);
  }));
  test('§Shell GitHub unreachable', () => withShell({ origin: 'missing' }, async E => {
    await expectFailure(E, await runShell(E), SM.upstream);
  }));
  test('§Shell release tag cannot be fetched', () => withShell({ origin: 'notag' }, async E => {
    await expectFailure(E, await runShell(E), SM.tagFetch);
  }));
  test('§Shell release tag not on main', () => withShell({ origin: 'offmain' }, async E => {
    await expectFailure(E, await runShell(E), SM.tagMain);
  }));
  test('§Shell local tag dereference fails', () => withShell({ faults: ['revparsetag'] }, async E => {
    await expectFailure(E, await runShell(E), SM.tagMissing, { hit: 'revparsetag' });
  }));
  test('§Shell local main has commits not in the release', () => withShell({ prep: E => { fs.writeFileSync(path.join(E.co, 'LOCAL.md'), 'x\n'); g(E.co, ['add', 'LOCAL.md'], E.home); g(E.co, ['commit', '-qm', 'local'], E.home); } }, async E => {
    await expectFailure(E, await runShell(E), SM.ahead);
  }));
  test('§Shell less than 5 GB free', () => withShell({ faults: ['lowspace'] }, async E => {
    await expectFailure(E, await runShell(E), SM.space, { hit: 'lowspace' });
    assert.deepEqual(backups(E), []);
  }));
  // Mutation misses of 2026-11-23 (second pass): the floor is exactly 5 GB, and tar's own status 2 fails the backup even when
  // the archive it left is whole and lists back.
  test('one KB under 5 GB free is refused before the backup; exactly 5 GB is enough', () => withShell({ prep: E => fs.writeFileSync(path.join(E.S, 'space'), '5242879') }, async E => {
    await expectFailure(E, await runShell(E), SM.space);
    assert.deepEqual(backups(E), []);
    fs.writeFileSync(path.join(E.S, 'space'), '5242880');
    const ok = await runShell(E);
    assert.equal(ok.code, 0, tail(ok.out)); assert.equal(readStatus(E).phase, 'complete');
  }));
  test('GNU tar exit 2 fails the backup even when the archive it left lists back', () => withShell({ faults: ['tarrc2ok'] }, async E => {
    await expectFailure(E, await runShell(E), SM.backup, { hit: 'tarrc2ok' });
    assert.deepEqual(backups(E), [], 'backup folder removed');
  }));
  test('§Shell backup folder cannot be made', () => withShell({ faults: ['mkdir'] }, async E => {
    await expectFailure(E, await runShell(E), SM.mkdir, { hit: 'mkdir' });
  }));
  test('§Shell GNU tar exit >1: backup removed, nothing changed', () => withShell({ faults: ['tarrc2'] }, async E => {
    await expectFailure(E, await runShell(E), SM.backup, { hit: 'tarrc2' });
    assert.deepEqual(backups(E), [], 'backup folder removed');
  }));
  test('§Shell GNU tar exit 1 with a listable archive is accepted', () => withShell({ faults: ['tarrc1'] }, async E => {
    const r = await runShell(E);
    assert.match(hits(E), /tarrc1/); assert.equal(r.code, 0, tail(r.out)); assert.equal(readStatus(E).phase, 'complete');
  }));
  test('§Shell git move to target fails', () => withShell({ faults: ['move'] }, async E => {
    await expectFailure(E, await runShell(E), SM.move, { hit: 'move' });
  }));
  test('§Shell target npm ci fails: old checkout and packages restored', () => withShell({ faults: ['npmci.1.1.0'] }, async E => {
    await expectFailure(E, await runShell(E), SM.npm);
  }));
  test('§Shell release check fails: old checkout and packages restored', () => withShell({ faults: ['check'] }, async E => {
    await expectFailure(E, await runShell(E), SM.check);
  }));
  test('§Shell replies stay busy: no restart, restored', () => withShell({ app: { busy: 2 } }, async E => {
    await expectFailure(E, await runShell(E), SM.busy);
  }));
  test('§Shell target does not boot: rolled back, old version confirmed, still failed', () => withShell({ faults: ['boot.1.1.0'] }, async E => {
    await expectFailure(E, await runShell(E), SM.boot, { nRestarts: 2 });
    assert.equal(JSON.parse(fs.readFileSync(E.appFile, 'utf8')).version, F);
  }));
  test('§Shell target npm ci and old npm ci both fail', () => withShell({ faults: ['npmci.1.1.0', 'npmci.1.0.0'] }, async E => {
    await expectFailure(E, await runShell(E), both(`Installing v${T}'s packages failed`, E), { pkgs: null });
  }));
  test('§Shell release check and old npm ci both fail', () => withShell({ faults: ['check', 'npmci.1.0.0'] }, async E => {
    await expectFailure(E, await runShell(E), both(`v${T} did not pass its release check`, E), { pkgs: null });
  }));
  test('§Shell replies stay busy and old npm ci fails', () => withShell({ app: { busy: 2 }, faults: ['npmci.1.0.0'] }, async E => {
    await expectFailure(E, await runShell(E), both('Replies kept running while Pocket waited to restart', E), { pkgs: null });
  }));
  test('§Shell target does not boot and put_back (old npm ci) fails: no old restart', () => withShell({ faults: ['boot.1.1.0', 'npmci.1.0.0'] }, async E => {
    const re = new RegExp('^' + esc(`${T} did not start, and putting ${F} back failed too. Pocket may not be running: on the server, check out ${F} in ${E.co} (its commit is in prev-head.txt in the backup), run npm ci in ${E.co} and restart it with PM2. Backup: `) + '\\S+$');
    await expectFailure(E, await runShell(E), re, { nRestarts: 1, pkgs: null });
  }));
  test('§Shell target does not boot and put_back (git reset) fails: no old restart, manual instructions', () => withShell({ faults: ['boot.1.1.0', 'gitreset'] }, async E => {
    const re = new RegExp('^' + esc(`${T} did not start, and putting ${F} back failed too.`));
    await expectFailure(E, await runShell(E), re, { nRestarts: 1, pkgs: null, headSame: false, hit: 'gitreset' });
  }));
  test('§Shell target and old both fail to boot: old not confirmed', () => withShell({ faults: ['boot.1.1.0', 'boot.1.0.0'] }, async E => {
    const re = new RegExp('^' + esc(`${T} did not start, and Pocket could not confirm ${F} came back. Check the server. Backup: `) + '\\S+$');
    await expectFailure(E, await runShell(E), re, { nRestarts: 2 });
  }));
  test('§Shell pm2 save failure is ignored: still complete, exit 0', () => withShell({ faults: ['pm2save'] }, async E => {
    const r = await runShell(E);
    assert.equal(r.code, 0, tail(r.out)); assert.equal(readStatus(E).phase, 'complete'); assert.ok(callLines(E).some(l => /^pm2 save/.test(l)));
  }));
  test('FES shell say complete fails: exit 0 only with a durable complete status', () => withShell({ sayfail: ['complete'] }, async E => {
    const r = await runShell(E);
    assert.match(hits(E), /sayfail\.complete/, 'harness: say complete fault hit');
    const st = readStatus(E);
    assert.ok(!(r.code === 0 && st.phase !== 'complete'), `exit 0 while status says ${st.phase}`);
    // 1.124.4: tried twice, then a non-zero exit and a line in the log; the install itself is updated.
    assert.equal((hits(E).match(/sayfail\.complete/g) || []).length, 2, 'say complete is retried once');
    assert.equal(r.code, 2, tail(r.out)); assert.equal(st.phase, 'restarting');
    assert.match(r.out, /1\.1\.0 is installed and running, but the result could not be recorded in pocket-self-update\.json/);
    assert.equal(headOf(E), TPL.sha11); assert.equal(restarts(E).length, 1);
  }));
  test('say complete that fails once is retried and recorded: complete, exit 0', () => withShell({ sayonce: ['complete'] }, async E => {
    const r = await runShell(E);
    assert.match(hits(E), /sayonce\.complete/, 'harness: the first say complete failed');
    assert.equal(r.code, 0, tail(r.out)); assert.equal(readStatus(E).phase, 'complete');
  }));
  test('say backing-up fails: stops before the backup, nothing changed', () => withShell({ sayfail: ['backing-up'] }, async E => {
    await expectFailure(E, await runShell(E), SM.unwritten, { hit: 'sayfail\\.backing-up' });
    assert.deepEqual(backups(E), []);
  }));
  test('say backing-up with the backup path fails: the unrecorded backup is removed, nothing changed', () => withShell({ saysecond: ['backing-up'] }, async E => {
    const r = await runShell(E);
    assert.equal((r.out.match(/^\d\d:\d\d:\d\d backing-up$/gm) || []).length, 2, `harness: the backup was made before its path was recorded\n${tail(r.out)}`);
    await expectFailure(E, r, SM.unwritten, { hit: 'sayfail\\.backing-up' });
    assert.deepEqual(backups(E), []);
  }));
  test('say installing fails: stops before the checkout moves', () => withShell({ sayfail: ['installing'] }, async E => {
    await expectFailure(E, await runShell(E), SM.unwritten, { hit: 'sayfail\\.installing' });
    assert.ok(!callLines(E).some(l => l.startsWith('npm ci')), 'no package install');
  }));
  test('say restarting fails: the running version is put back and PM2 is not restarted', () => withShell({ sayfail: ['restarting'] }, async E => {
    await expectFailure(E, await runShell(E), SM.unwrittenMoved, { hit: 'sayfail\\.restarting' });
    assert.equal(callLines(E).filter(l => l.startsWith('npm ci')).length, 2, 'packages installed, then put back');
  }));

  // ------------------------------------------------------------- divergences (shell)
  test('DIV-8: a failed progress write (say checking) must stop before the checkout moves', () => withShell({ sayfail: ['checking'] }, async E => {
    const r = await runShell(E);
    assert.match(hits(E), /sayfail\.checking/, 'harness: say checking fault hit');
    assert.equal(headOf(E), E.head, `checkout moved after the checking progress write failed (exit ${r.code})`);
    assert.equal(restarts(E).length, 0, 'PM2 restarted after a failed progress write');
    assert.notEqual(r.code, 0);
    await expectFailure(E, r, SM.unwritten);
    assert.ok(!callLines(E).some(l => l.startsWith('npm ')), 'nothing installed');
  }));
  test('DIV-9: a failed backup file listing must fail before the checkout moves', () => withShell({ faults: ['lsfiles'] }, async E => {
    const r = await runShell(E);
    assert.match(hits(E), /lsfiles/, 'harness: ls-files fault hit');
    assert.equal(headOf(E), E.head, `checkout moved although the private-file listing failed (exit ${r.code}, phase ${readStatus(E)?.phase})`);
    assert.equal(r.code, 1); assert.equal(readStatus(E).phase, 'failed');
    await expectFailure(E, r, SM.list);
    assert.deepEqual(backups(E), [], 'the half-made backup folder is removed');
    assert.equal(readStatus(E).backup, undefined);
  }));
  test('an archive with no entries is not a backup when the listing named files', () => withShell({ faults: ['tarempty'] }, async E => {
    await expectFailure(E, await runShell(E), SM.backup, { hit: 'tarempty' });
    assert.deepEqual(backups(E), [], 'backup folder removed');
  }));
  // Removed after the 2026-11-23 review, as not faults: DIV-10 (chmod on the backup files fails: the folder is made 0700, so
  // the files' modes widen nothing), DIV-15 (killing the shell leaves npm ci running: nothing in the real flow kills it, and
  // stopping npm ci halfway would leave node_modules half removed), DIV-16 (a tool's output in the log: the log is 0600 in the
  // data folder and the script's environment carries no secrets, both pinned by '§6/§7 begin() success'), DIV-17 (two runs
  // in one second share a backup folder: flock serialises runs on one install).
  test('DIV-11: a health probe that keeps failing is retried, logged as unknown, and the restart goes ahead', () => withShell({ app: { health: 'bad' } }, async E => {
    const r = await runShell(E);
    assert.ok(E.server.badProbes >= 3 && E.server.badProbes % 3 === 0, `three tries per check, got ${E.server.badProbes} failed probes`);
    const line = r.out.indexOf('/api/health did not answer, so the number of running replies is unknown; restarting anyway');
    assert.ok(line >= 0, tail(r.out));
    assert.ok(line < r.out.search(/^\d\d:\d\d:\d\d restarting$/m), 'the line comes before the restart');
    assert.equal(restarts(E).length, 1); assert.equal(r.code, 0, tail(r.out)); assert.equal(readStatus(E).phase, 'complete');
  }));
  test('a health probe that fails twice and then answers is used, with nothing logged', () => withShell({ app: { badLeft: 2 } }, async E => {
    const r = await runShell(E);
    assert.equal(E.server.badProbes, 2);
    assert.ok(!r.out.includes('did not answer'), tail(r.out));
    assert.equal(restarts(E).length, 1); assert.equal(readStatus(E).phase, 'complete');
  }));
  test('a good health answer without busy (an older daemon) counts as no replies, silently', () => withShell({ app: { busy: undefined } }, async E => {
    const r = await runShell(E);
    assert.ok(!r.out.includes('did not answer') && !r.out.includes('waiting for'), tail(r.out));
    assert.equal(restarts(E).length, 1); assert.equal(r.code, 0); assert.equal(readStatus(E).phase, 'complete');
  }));
  // 1.124.4: the stand-in starts a reply right after its first zero answer. The script says restarting, reads the PID and asks
  // once more right before the PM2 command, so it sees that reply and goes back to waiting. The window left is the PM2
  // command itself (a reply that starts after the last answer and before PM2 stops the process); the daemon has no gate.
  test('DIV-12: no reply may start between the zero-busy probe and the PM2 restart', () => withShell({ app: { flip: true } }, async E => {
    const r = await runShell(E);
    const first = restarts(E)[0];
    assert.ok(!first || /busy=0$/.test(first), `PM2 restarted while a reply that began after the busy probe was running: "${first}" (exit ${r.code})`);
    assert.ok(JSON.parse(fs.readFileSync(E.appFile, 'utf8')).flipped, 'harness: a reply started after the first zero answer');
    await expectFailure(E, r, SM.busy);
  }));
  test('a reply that starts after the first zero answer and then ends is waited for, and the restart follows it', () => withShell({ app: { flip: true, flipEnds: 1 } }, async E => {
    const r = await runShell(E, { extraEnv: { POCKET_SELF_UPDATE_IDLE_TRIES: '4' } });
    assert.equal(r.code, 0, tail(r.out)); assert.equal(readStatus(E).phase, 'complete');
    assert.match(r.out, /waiting for 1 replies to finish/);
    assert.deepEqual(restarts(E).map(l => l.replace(/^.* busy=/, '')), ['0']);
  }));
  test('§6+Shell end to end: begin() launches the updater, restart view sees complete', () => withShell({ writeStatus: false }, async E => {
    const spawned = [];
    const opts = { checkout: E.co, dataDir: E.data, env: { POCKET_SELF_UPDATE: '1', pm_id: '7', PATH: E.bin, HOME: E.home, FICT_API_KEY: SECRET }, port: String(E.port), repo: REPO, node: E.nodeWrapper, script: SCRIPT, setsid: false };
    const su = new SelfUpdate({ ...opts, spawner: (c, a, o) => { const ch = spawn(c, a, o); track(ch.pid); spawned.push(ch); return ch; } });
    try {
      const snap = su.begin({ from: F, to: T });
      assert.equal(snap.job.phase, 'queued'); assert.equal(snap.job.running, true);
      const done = await until(() => { const j = new SelfUpdate(opts).job(); return j && !j.running ? j : null; }, 40_000, 100);
      const log = fs.readFileSync(path.join(E.data, SELF_UPDATE_LOG), 'utf8');
      assert.ok(done, `updater did not finish\n${tail(log)}`);
      assert.equal(done.phase, 'complete', tail(log));
      assert.equal(headOf(E), TPL.sha11);
      assert.match(log, /update 1\.0\.0 -> 1\.1\.0 \(job [0-9a-f-]{36}\)/);
      assert.ok(!log.includes(SECRET) && !fs.readFileSync(E.status, 'utf8').includes(SECRET));
      assert.ok(await until(() => spawned[0].exitCode !== null, 5000), 'updater shell exited');
    } finally { for (const ch of spawned) killGroup(ch.pid); }
  }));
});
