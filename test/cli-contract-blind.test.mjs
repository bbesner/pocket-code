// Blind contract tests for the Pocket CLI updater, written from
// /tmp/pocket-cli-updater-spec.md only. Failures labelled DIV-n are the
// spec's suspected divergences and are expected to fail until fixed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as mod from '../cli-updates.mjs';

const { PROVIDERS, version, newer, localSlot, cleanEnv, runChild, CliUpdates } = mod;

const tmpRoots = [];
const livePids = new Set();
const instances = new Set();

after(() => {
  for (const inst of instances) { try { inst.dispose(); } catch {} }
  for (const pid of livePids) {
    try { process.kill(-pid, 'SIGKILL'); } catch {}
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
  for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true });
});

function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-cli-blind-'));
  tmpRoots.push(d);
  return d;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(10); }
  return false;
}
function alive(pid) {
  try { process.kill(pid, 0); } catch { return false; }
  try { // zombie => effectively gone
    const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return st.slice(st.lastIndexOf(')') + 2)[0] !== 'Z';
  } catch { return false; }
}

const STATE_REL = path.join('cli-runtimes', 'state.json');
const UNREADABLE = 'CLI update state is unreadable; restore it before starting Pocket.';
const MISSING_BIN = 'A selected CLI installation is missing; restore it before starting Pocket.';
const RESTARTED = 'Pocket restarted during the upgrade. Check the selected versions, then retry.';
const BUSY = 'An update check or upgrade is already running.';
const DISABLED = 'CLI updates are disabled on this server.';
const CHOOSE = 'Choose one or both CLIs.';
const GONE = 'The selected version is no longer available. Check again.';
const PREV_GONE = 'The previous installation is unavailable.';
const PUB_FAIL = 'Could not check the publisher. Try Check now.';
const SOME_FAIL = 'Some release checks failed. Previously found updates are still shown.';
const MISMATCH = 'The downloaded CLI did not match the version you approved.';

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}

// Fixture: temp dir, fake baseline bins, injected run/test/fetch/persist.
function fixture({ baseline = { claude: '2.0.0', codex: '0.50.0' }, latest = { claude: '2.0.1', codex: '0.51.0' },
  state, failPersist, testVersion, runHook, fetchHook, enabled, overrides, now, noBins } = {}) {
  const dir = tmp();
  const binDir = path.join(dir, 'external');
  fs.mkdirSync(binDir);
  const bins = {};
  const versions = {};
  for (const key of ['claude', 'codex']) {
    const b = path.join(binDir, key);
    fs.writeFileSync(b, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    bins[key] = noBins?.includes(key) ? null : b;
    versions[b] = baseline[key];
  }
  if (state) atomicWrite(path.join(dir, STATE_REL), state);
  const calls = { run: [], test: [], fetch: [], activate: [], persist: [] };
  let saveN = 0;
  const persist = (file, data) => {
    saveN += 1;
    calls.persist.push(structuredClone(data));
    if (failPersist && failPersist(data, saveN)) throw new Error('injected persist failure');
    atomicWrite(file, data);
  };
  const run = async (bin, args, options = {}) => {
    calls.run.push({ bin, args, options });
    if (runHook) { const r = await runHook(bin, args, options); if (r !== undefined) return r; }
    if (args[0] === '--version') {
      const m = /-(\d+\.\d+\.\d+)-/.exec(bin);
      return `${m ? m[1] : versions[bin]} (fake)\n`;
    }
    const pi = args.indexOf('--prefix');
    if (pi >= 0) {
      const dest = args[pi + 1];
      const key = /\/(claude|codex)-[^/]*$/.exec(dest)[1];
      fs.mkdirSync(path.join(dest, 'node_modules', '.bin'), { recursive: true });
      fs.writeFileSync(path.join(dest, 'node_modules', '.bin', key), '#!/bin/sh\n', { mode: 0o755 });
      return '';
    }
    return '';
  };
  const testFn = async (key, bin, options) => {
    calls.test.push({ key, bin, options });
    if (testVersion) return testVersion(key, bin, options);
    const m = /-(\d+\.\d+\.\d+)-/.exec(bin);
    return m ? m[1] : versions[bin];
  };
  const fetcher = async (url, opts) => {
    calls.fetch.push({ url, opts });
    if (fetchHook) { const r = await fetchHook(url, opts); if (r !== undefined) return r; }
    const key = url.includes('codex') ? 'codex' : 'claude';
    const body = JSON.stringify({ name: PROVIDERS[key].pkg, version: latest[key] });
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };
  const opts = {
    dir, bins, zone: () => 'America/New_York', fetcher, run, test: testFn, persist,
    onActivate: (key, bin) => calls.activate.push({ key, bin }),
    now: now || (() => Date.parse('2026-10-28T16:00:00Z')),
  };
  if (enabled !== undefined) opts.enabled = enabled;
  if (overrides) opts.overrides = overrides;
  const make = () => { const i = new CliUpdates(opts); instances.add(i); return i; };
  return { dir, bins, versions, calls, opts, make, stateFile: path.join(dir, STATE_REL),
    disk: () => fs.readFileSync(path.join(dir, STATE_REL), 'utf8'),
    readState: () => JSON.parse(fs.readFileSync(path.join(dir, STATE_REL), 'utf8')) };
}

const knownState = (extra = {}) => ({
  providers: {
    claude: { installed: '2.0.0', latest: '2.0.1', checkedAt: 1 },
    codex: { installed: '0.50.0', latest: '0.51.0', checkedAt: 1 },
  },
  job: null, ...extra,
});

async function done(inst) {
  const ok = await until(() => inst.snapshot().job && inst.snapshot().job.running === false && !inst.busy);
  assert.ok(ok, 'upgrade job did not finish');
  return inst.snapshot().job;
}

function rejectsWith(fn, status, message) {
  let err;
  try { fn(); } catch (e) { err = e; }
  assert.ok(err, `expected throw: ${message}`);
  assert.equal(err.message, message);
  assert.equal(err.status, status);
  assert.equal(err.code, undefined);
}

// ---------- pure helpers ----------

test('module: exact named exports, no default', () => {
  assert.equal(mod.default, undefined);
  for (const n of ['PROVIDERS', 'version', 'newer', 'localSlot', 'cleanEnv', 'runChild', 'probe', 'CliUpdates'])
    assert.ok(n in mod, n);
});

test('version(): strict unsigned triples only', () => {
  for (const v of ['0.0.0', '1.2.3', '10.20.300', '0.10.0']) assert.equal(version(v), v);
  for (const v of ['1.2', '1.2.3.4', '01.2.3', '1.02.3', '1.2.03', '1.2.3-beta', '1.2.3+b', ' 1.2.3', '1.2.3\n',
    'v1.2.3', '-1.2.3', '', null, undefined, 123, {}, '1..3', 'a.b.c'])
    assert.equal(version(v), null, JSON.stringify(v));
});

test('newer(): numeric strict comparison; invalid => false', () => {
  assert.equal(newer('1.10.0', '1.9.0'), true);
  assert.equal(newer('2.0.0', '1.99.99'), true);
  assert.equal(newer('1.0.0', '1.0.0'), false);
  assert.equal(newer('1.0.0', '1.0.1'), false);
  assert.equal(newer('1.0.1-rc', '1.0.0'), false);
  assert.equal(newer('1.0.1', null), false);
  assert.equal(newer(undefined, '1.0.0'), false);
});

test('localSlot(): local day and 04-23 gate; invalid zone throws', () => {
  // 2026-10-28 is EDT (UTC-4)
  assert.deepEqual(localSlot(Date.parse('2026-10-28T07:59:00Z'), 'America/New_York'), { day: '2026-10-28', due: false });
  assert.deepEqual(localSlot(Date.parse('2026-10-28T08:00:00Z'), 'America/New_York'), { day: '2026-10-28', due: true });
  assert.deepEqual(localSlot(Date.parse('2026-10-29T03:59:00Z'), 'America/New_York'), { day: '2026-10-28', due: true });
  assert.deepEqual(localSlot(Date.parse('2026-10-29T04:00:00Z'), 'America/New_York'), { day: '2026-10-29', due: false });
  assert.throws(() => localSlot(Date.now(), 'Not/AZone'));
});

test('cleanEnv(): only the allow-listed keys, no secrets', () => {
  const saved = { ...process.env };
  try {
    process.env.ANTHROPIC_API_KEY = 'sk-secret';
    process.env.NPM_TOKEN = 'npm-secret';
    process.env.OPENAI_API_KEY = 'x';
    process.env.POCKET_PASSWORD = 'x';
    const env = cleanEnv('/home/fake');
    assert.deepEqual(Object.keys(env).sort(), ['DISABLE_AUTOUPDATER', 'DISABLE_TELEMETRY', 'DISABLE_UPDATES', 'HOME',
      'LANG', 'PATH', 'TMPDIR', 'npm_config_globalconfig', 'npm_config_userconfig'].sort());
    assert.equal(env.HOME, '/home/fake');
    assert.equal(env.PATH, process.env.PATH);
    assert.equal(env.LANG, 'C.UTF-8');
    assert.equal(env.DISABLE_AUTOUPDATER, '1');
    assert.equal(env.DISABLE_UPDATES, '1');
    assert.equal(env.DISABLE_TELEMETRY, '1');
    assert.equal(env.npm_config_userconfig, '/dev/null');
    assert.equal(env.npm_config_globalconfig, '/dev/null/pocket-global-npmrc');
    assert.ok(!JSON.stringify(env).includes('secret'));
    delete process.env.PATH;
    assert.equal(cleanEnv('/h').PATH, '/usr/local/bin:/usr/bin:/bin');
    assert.equal(cleanEnv().HOME, os.homedir());
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

// ---------- runChild with tiny real fake children ----------

const childDir = tmp();
const childScript = path.join(childDir, 'child.cjs');
fs.writeFileSync(childScript, `
const { spawn } = require('child_process');
const mode = process.argv[2];
if (mode === 'fail') { process.stderr.write('SECRET-STDERR'); process.stdout.write('partial'); process.exit(3); }
if (mode === 'ok') { process.stderr.write('noise'); process.stdout.write('hello\\nworld\\n'); process.exit(0); }
if (mode === 'big') { process.stdout.write('x'.repeat(600 * 1024)); setInterval(() => {}, 1000); }
if (mode === 'echo') { let s = ''; process.stdin.on('data', d => s += d); process.stdin.on('end', () => { process.stdout.write('got:' + s); process.exit(0); }); }
if (mode === 'hang' || mode === 'line') {
  const g = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  process.stdout.write('pids ' + process.pid + ' ' + g.pid + '\\n');
  if (mode === 'line') process.stdout.write('ready\\n');
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
}
`);
const track = (c) => { livePids.add(c.pid); };

test('runChild: zero exit resolves stdout, stderr discarded', async () => {
  const out = await runChild(process.execPath, [childScript, 'ok'], { onChild: track });
  assert.equal(out, 'hello\nworld\n');
});

test('runChild: nonzero exit rejects fixed message without stderr', async () => {
  await assert.rejects(runChild(process.execPath, [childScript, 'fail'], { onChild: track }), (e) => {
    assert.equal(e.message, 'The update command failed. The previous version is still selected.');
    assert.ok(!String(e.stack).includes('SECRET-STDERR'));
    return true;
  });
});

test('runChild: spawn failure rejects fixed message', async () => {
  await assert.rejects(runChild(path.join(childDir, 'does-not-exist'), []), { message: 'Could not start the update command.' });
});

test('runChild: input is written and stdin ended', async () => {
  const out = await runChild(process.execPath, [childScript, 'echo'], { input: 'abc', onChild: track });
  assert.equal(out, 'got:abc');
});

test('runChild: oversized stdout rejects and kills child', async () => {
  let child;
  await assert.rejects(runChild(process.execPath, [childScript, 'big'], { onChild: (c) => { child = c; track(c); } }),
    { message: 'The update command returned too much output.' });
  assert.ok(await until(() => !alive(child.pid), 2000), 'child still alive after oversized output');
});

test('runChild: onLine callback throw rejects with its message', async () => {
  let pids;
  await assert.rejects(runChild(process.execPath, [childScript, 'line'], {
    onChild: track,
    onLine: (line) => { if (line.startsWith('pids')) pids = line.split(' ').slice(1).map(Number); if (line === 'ready') throw new Error('parser broke'); },
  }), { message: 'parser broke' });
  assert.ok(await until(() => !alive(pids[0]) && !alive(pids[1]), 2000), 'group survived callback failure');
});

test('DIV-1 runChild: early finishSuccess settles only after the child group has exited', async () => {
  let child, pids;
  const out = runChild(process.execPath, [childScript, 'line'], {
    onChild: (c) => { child = c; track(c); },
    onLine: (line, c, finish) => {
      if (line.startsWith('pids')) { pids = line.split(' ').slice(1).map(Number); livePids.add(pids[1]); }
      if (line === 'ready') finish();
    },
  });
  await out;
  assert.ok(child.exitCode !== null || child.signalCode !== null,
    'DIV-1: promise resolved while detached child had not yet closed');
  assert.ok(await until(() => !alive(pids[1]), 2000), 'grandchild survived');
});

test('DIV-1 runChild: timeout settles only after the child group has exited', async () => {
  let child;
  await assert.rejects(runChild(process.execPath, [childScript, 'hang'], { timeout: 300, onChild: (c) => { child = c; track(c); } }),
    { message: 'The update command timed out. Try again.' });
  assert.ok(child.exitCode !== null || child.signalCode !== null,
    'DIV-1: timeout rejected while detached child had not yet closed');
});

// ---------- constructor / storage / restart ----------

test('constructor: missing state starts empty; corrupt state throws fixed message and is left intact', () => {
  const f = fixture();
  const inst = f.make();
  assert.deepEqual(inst.state, { providers: {}, job: null });
  const st = fs.statSync(path.join(f.dir, 'cli-runtimes'));
  assert.equal(st.mode & 0o777, 0o700);

  const g = fixture();
  fs.mkdirSync(path.dirname(g.stateFile), { recursive: true });
  fs.writeFileSync(g.stateFile, '{not json');
  assert.throws(() => g.make(), { message: UNREADABLE });
  assert.equal(fs.readFileSync(g.stateFile, 'utf8'), '{not json');
});

test('default persist: 0600 file, two-space JSON, no trailing newline, no .tmp left', async () => {
  const f = fixture({ state: knownState() });
  delete f.opts.persist;
  const inst = f.make();
  await inst.check();
  const text = f.disk();
  assert.equal(text, JSON.stringify(JSON.parse(text), null, 2));
  assert.equal(fs.statSync(f.stateFile).mode & 0o777, 0o600);
  assert.ok(!fs.existsSync(f.stateFile + '.tmp'));
});

test('default persist: rename failure leaves memory and disk at D0', async () => {
  const f = fixture({ state: knownState() });
  delete f.opts.persist;
  const inst = f.make();
  const d0 = f.disk();
  const mem0 = structuredClone(inst.state);
  const orig = fs.renameSync;
  const origP = fs.promises.rename;
  fs.renameSync = () => { throw new Error('EIO'); };
  fs.promises.rename = async () => { throw new Error('EIO'); };
  try {
    await assert.rejects(inst.check());
  } finally { fs.renameSync = orig; fs.promises.rename = origP; }
  assert.equal(f.disk(), d0);
  assert.deepEqual(inst.state, mem0);
  assert.equal(inst.checking, false);
});

test('restart: running job is marked interrupted, child null, never resumes', () => {
  const job = { id: 'j1', running: true, phase: 'installing', startedAt: 5, selections: [{ key: 'codex', version: '0.51.0' }],
    rollback: false, results: [], error: null, provider: 'codex', child: { pid: 999999, boot: 'not-this-boot', start: 1 } };
  const f = fixture({ state: knownState({ job }) });
  const inst = f.make();
  const disk = f.readState();
  assert.equal(disk.job.phase, 'interrupted');
  assert.equal(disk.job.running, false);
  assert.equal(disk.job.error, RESTARTED);
  assert.equal(disk.job.child, null);
  assert.deepEqual(disk.job.selections, job.selections);
  assert.deepEqual(inst.state.job, disk.job);
  assert.equal(f.calls.run.filter((c) => c.args.includes('install')).length, 0);
  assert.equal(inst.busy ?? false, false);
});

test('restart: interrupted-recovery save failure leaves no instance and the running record on disk', () => {
  const job = { id: 'j1', running: true, phase: 'queued', startedAt: 5, selections: [{ key: 'codex', version: '0.51.0' }],
    rollback: false, results: [], error: null };
  const f = fixture({ state: knownState({ job }), failPersist: () => true });
  const before = f.disk();
  assert.throws(() => f.make());
  assert.equal(f.disk(), before);
});

test('restart: missing selected managed binary aborts construction', () => {
  const f = fixture();
  const gone = path.join(f.dir, 'cli-runtimes', 'codex-0.51.0-x', 'node_modules', '.bin', 'codex');
  atomicWrite(f.stateFile, { providers: { codex: { installed: '0.51.0', active: { version: '0.51.0', bin: gone } } }, job: null });
  assert.throws(() => f.make(), { message: MISSING_BIN });
});

// ---------- check ----------

test('check: registry URL, redirect error, success records latest and clears errors', async () => {
  const f = fixture();
  const inst = f.make();
  const snap = await inst.check();
  assert.equal(f.calls.fetch.length, 2);
  const urls = f.calls.fetch.map((c) => c.url).sort();
  assert.deepEqual(urls, [`https://registry.npmjs.org/${encodeURIComponent('@anthropic-ai/claude-code')}/latest`,
    `https://registry.npmjs.org/${encodeURIComponent('@openai/codex')}/latest`].sort());
  for (const c of f.calls.fetch) { assert.equal(c.opts.redirect, 'error'); assert.ok(c.opts.signal); }
  const disk = f.readState();
  assert.equal(disk.providers.codex.latest, '0.51.0');
  assert.equal(disk.providers.claude.latest, '2.0.1');
  assert.equal(disk.checkError, null);
  assert.equal(typeof disk.checkedAt, 'number');
  assert.equal(inst.checking, false);
  assert.deepEqual(snap.providers.map((p) => p.key), Object.keys(PROVIDERS));
  const codex = snap.providers.find((p) => p.key === 'codex');
  assert.equal(codex.available, true);
  assert.equal(codex.canUpgrade, true);
  assert.equal(codex.installed, '0.50.0');
});

test('check: publisher failure keeps prior latest/checkedAt and sets fixed errors', async () => {
  const f = fixture({ state: knownState(), fetchHook: async (url) => {
    if (url.includes('codex')) throw new Error('ENOTFOUND secret-host');
    return { ok: true, status: 200, text: async () => JSON.stringify({ name: 'evil', version: '9.9.9' }) };
  } });
  const inst = f.make();
  await inst.check();
  const d = f.readState();
  assert.equal(d.providers.codex.latest, '0.51.0');
  assert.equal(d.providers.codex.checkedAt, 1);
  assert.equal(d.providers.codex.error, PUB_FAIL);
  assert.equal(d.providers.claude.latest, '2.0.1', 'name mismatch must not record version');
  assert.equal(d.providers.claude.error, PUB_FAIL);
  assert.equal(d.checkError, SOME_FAIL);
});

test('check: disabled and concurrent rejections are 409 without code', async () => {
  const f = fixture({ enabled: false });
  const inst = f.make();
  await assert.rejects(inst.check(), (e) => e.message === DISABLED && e.status === 409 && e.code === undefined);

  let release;
  const g = fixture({ fetchHook: () => new Promise((r) => { release = r; }) });
  const i2 = g.make();
  const first = i2.check();
  await assert.rejects(i2.check(), (e) => e.message === BUSY && e.status === 409 && e.code === undefined);
  rejectsWith(() => i2.begin([{ key: 'codex', version: '0.51.0' }]), 409, BUSY);
  await until(() => release);
  release({ ok: false, status: 500, text: async () => '' });
  await until(() => g.calls.fetch.length === 2);
  release({ ok: false, status: 500, text: async () => '' });
  await first;
  assert.equal(i2.checking, false);
});

test('check: final save failure leaves memory and disk D0, checking false', async () => {
  const f = fixture({ state: knownState({ providers: { codex: { installed: '0.50.0', latest: '0.50.5', checkedAt: 1 } } }),
    failPersist: () => true });
  const inst = f.make();
  const d0 = f.disk();
  const m0 = structuredClone(inst.state);
  await assert.rejects(inst.check());
  assert.equal(f.disk(), d0);
  assert.deepEqual(inst.state, m0);
  assert.equal(inst.checking, false);
});

// ---------- begin validation ----------

test('begin: validation order and messages', () => {
  const f = fixture({ state: knownState() });
  const inst = f.make();
  rejectsWith(() => inst.begin([]), 400, CHOOSE);
  rejectsWith(() => inst.begin('codex'), 400, CHOOSE);
  rejectsWith(() => inst.begin([{ key: 'codex', version: '0.51.0' }, { key: 'codex', version: '0.51.0' }]), 400, CHOOSE);
  rejectsWith(() => inst.begin([{ key: 'codex', version: '0.51.0' }, { key: 'claude', version: '2.0.1' }, { key: 'x', version: '1.0.0' }]), 400, CHOOSE);
  rejectsWith(() => inst.begin([{ key: 'codex', version: '0.52.0' }]), 409, GONE);
  rejectsWith(() => inst.begin([{ key: 'codex', version: '0.51.0-rc' }]), 409, GONE);
  rejectsWith(() => inst.begin([{ key: 'nope', version: '0.51.0' }]), 409, GONE);
  rejectsWith(() => inst.begin([{ key: 'codex', version: '0.51.0' }], { rollback: true }), 409, GONE);
  assert.equal(f.calls.persist.length, 0);
  assert.equal(inst.busy ?? false, false);

  const d = fixture({ state: knownState(), enabled: false });
  rejectsWith(() => d.make().begin([{ key: 'codex', version: '0.51.0' }]), 409, DISABLED);

  const notNewer = fixture({ state: { providers: { codex: { installed: '0.51.0', latest: '0.51.0' } }, job: null }, baseline: { claude: '2.0.0', codex: '0.51.0' } });
  rejectsWith(() => notNewer.make().begin([{ key: 'codex', version: '0.51.0' }]), 409, GONE);

  const ov = fixture({ state: knownState(), overrides: { codex: true } });
  const oi = ov.make();
  rejectsWith(() => oi.begin([{ key: 'codex', version: '0.51.0' }]), 409, GONE);
  assert.equal(oi.snapshot().providers.find((p) => p.key === 'codex').canUpgrade, false);

  const nb = fixture({ state: knownState(), noBins: ['codex'] });
  rejectsWith(() => nb.make().begin([{ key: 'codex', version: '0.51.0' }]), 409, GONE);
});

test('begin: queue save failure => busy false, no installer, D0', async () => {
  const f = fixture({ state: knownState(), failPersist: (d) => d.job && d.job.phase === 'queued' });
  const inst = f.make();
  const d0 = f.disk();
  const m0 = structuredClone(inst.state);
  assert.throws(() => inst.begin([{ key: 'codex', version: '0.51.0' }]));
  await sleep(50);
  assert.equal(inst.busy, false);
  assert.equal(f.disk(), d0);
  assert.deepEqual(inst.state, m0);
  assert.equal(f.calls.run.filter((c) => c.args.includes('install')).length, 0);
});

// ---------- upgrade flow ----------

test('upgrade: two selections install, probe, activate, complete; restart keeps active', async () => {
  const f = fixture({ state: knownState() });
  const inst = f.make();
  const snap = inst.begin([{ key: 'claude', version: '2.0.1' }, { key: 'codex', version: '0.51.0' }]);
  assert.equal(snap.job.running, true);
  assert.equal(snap.job.child, undefined);
  assert.equal(typeof snap.job.id, 'string');
  assert.equal(inst.busy, true);
  rejectsWith(() => inst.begin([{ key: 'codex', version: '0.51.0' }]), 409, BUSY);
  const job = await done(inst);
  assert.equal(job.phase, 'complete', JSON.stringify(job));
  assert.equal(job.error, null);
  assert.deepEqual(job.results, [{ key: 'claude', version: '2.0.1' }, { key: 'codex', version: '0.51.0' }]);
  assert.equal(inst.busy, false);

  const queued = f.calls.persist.find((d) => d.job && d.job.phase === 'queued').job;
  assert.match(queued.id, /^[0-9a-f-]{36}$/);
  assert.equal(queued.running, true);
  assert.equal(queued.rollback, false);
  assert.deepEqual(queued.results, []);
  assert.equal(queued.error, null);

  const npm = f.calls.run.filter((c) => c.args.includes('--prefix'));
  assert.equal(npm.length, 2);
  const root = path.join(f.dir, 'cli-runtimes');
  for (const [i, [key, v]] of [['claude', '2.0.1'], ['codex', '0.51.0']].entries()) {
    const a = npm[i].args;
    const dest = a[a.indexOf('--prefix') + 1];
    assert.match(dest, new RegExp(`^${root}/${key}-${v.replace(/\./g, '\\.')}-[0-9a-f-]{36}$`));
    assert.equal(fs.statSync(dest).mode & 0o777, 0o700);
    assert.deepEqual(a, ['install', '--prefix', dest, '--registry=https://registry.npmjs.org', '--ignore-scripts', '--no-audit',
      '--no-fund', '--package-lock=false', '--save-exact', `${PROVIDERS[key].pkg}@${v}`]);
    assert.equal(npm[i].options.timeout, 300000);
    // env omitted => runChild's cleanEnv() default; if passed it must be clean
    const env = npm[i].options.env;
    assert.ok(env === undefined || (env.npm_config_userconfig === '/dev/null' && !('ANTHROPIC_API_KEY' in env)),
      `npm env not clean: ${JSON.stringify(Object.keys(npm[i].options))}`);
  }
  for (const t of f.calls.test) {
    assert.ok(t.options.cwd.startsWith(path.join(root, 'probe-')));
    assert.ok(!fs.existsSync(t.options.cwd), 'probe scratch not removed');
    assert.equal(t.options.env.HOME, t.options.cwd === t.options.env.HOME ? t.options.cwd : t.options.env.HOME);
    assert.ok(t.options.env.CODEX_HOME && t.options.env.CLAUDE_CONFIG_DIR);
    assert.equal(typeof t.options.onChild, 'function');
  }
  const disk = f.readState();
  for (const [key, v] of [['claude', '2.0.1'], ['codex', '0.51.0']]) {
    assert.equal(disk.providers[key].active.version, v);
    assert.ok(disk.providers[key].active.bin.endsWith(`/node_modules/.bin/${key}`));
    assert.deepEqual(disk.providers[key].previous, { version: f.versions[f.bins[key]], bin: f.bins[key], external: true });
    assert.equal(disk.providers[key].installed, v);
    assert.equal(inst.binary(key), disk.providers[key].active.bin);
  }
  assert.deepEqual(f.calls.activate.map((a) => a.key), ['claude', 'codex']);
  // activation write contains active + result + activated phase together
  const actWrite = f.calls.persist.find((d) => d.job && d.job.phase === 'activated' && d.job.results.length === 1);
  assert.ok(actWrite);
  assert.equal(actWrite.providers.claude.active.version, '2.0.1');
  assert.equal(actWrite.job.child, null);
  assert.equal(disk.job.running, false);
  assert.equal(typeof disk.job.finishedAt, 'number');
  assert.equal(disk.job.child, null);

  inst.dispose();
  const again = f.make();
  assert.equal(again.binary('codex'), disk.providers.codex.active.bin);
  assert.equal(again.snapshot().providers.find((p) => p.key === 'codex').installed, '0.51.0');
});

test('upgrade: second provider failure keeps first activation, records failed job', async () => {
  const f = fixture({ state: knownState(), runHook: (bin, args) => {
    if (args.includes('--prefix') && args.at(-1).startsWith('@openai/codex')) throw new Error('The update command failed. The previous version is still selected.');
  } });
  const inst = f.make();
  inst.begin([{ key: 'claude', version: '2.0.1' }, { key: 'codex', version: '0.51.0' }]);
  const job = await done(inst);
  assert.equal(job.phase, 'failed');
  assert.equal(job.error, 'The update command failed. The previous version is still selected.');
  const disk = f.readState();
  assert.equal(disk.providers.claude.active.version, '2.0.1');
  assert.equal(disk.providers.codex.active, undefined);
  assert.equal(inst.binary('codex'), f.bins.codex);
  assert.deepEqual(disk.job.results, [{ key: 'claude', version: '2.0.1' }]);
  assert.equal(disk.job.running, false);
  assert.equal(disk.job.child, null);
  assert.deepEqual(f.calls.activate.map((a) => a.key), ['claude']);
  assert.equal(inst.busy, false);
});

test('upgrade: probe version mismatch fails with fixed message and no activation; scratch removed', async () => {
  const f = fixture({ state: knownState(), testVersion: () => '0.50.9' });
  const inst = f.make();
  inst.begin([{ key: 'codex', version: '0.51.0' }]);
  const job = await done(inst);
  assert.equal(job.error, MISMATCH);
  assert.equal(f.readState().providers.codex.active, undefined);
  assert.equal(f.calls.activate.length, 0);
  for (const t of f.calls.test) assert.ok(!fs.existsSync(t.options.cwd));
});

test('upgrade: probe throw still removes scratch and keeps old selection', async () => {
  const f = fixture({ state: knownState(), testVersion: () => { throw new Error('Codex did not pass the app-server compatibility check.'); } });
  const inst = f.make();
  inst.begin([{ key: 'codex', version: '0.51.0' }]);
  const job = await done(inst);
  assert.equal(job.phase, 'failed');
  assert.equal(job.error, 'Codex did not pass the app-server compatibility check.');
  assert.ok(!fs.existsSync(f.calls.test[0].options.cwd));
  assert.equal(inst.binary('codex'), f.bins.codex);
});

test('upgrade: activation save failure => no onActivate, old active on disk and in memory', async () => {
  const f = fixture({ state: knownState(), failPersist: (d) => d.job && d.job.phase === 'activated' });
  const inst = f.make();
  inst.begin([{ key: 'codex', version: '0.51.0' }]);
  await done(inst);
  assert.equal(f.calls.activate.length, 0);
  assert.equal(inst.binary('codex'), f.bins.codex);
  assert.equal(inst.state.providers.codex.active, undefined);
  assert.equal(f.readState().providers.codex.active, undefined);
  assert.equal(inst.snapshot().job.phase, 'failed');
});

test('rollback: previous external baseline is restored without npm', async () => {
  const f = fixture({ state: knownState() });
  const inst = f.make();
  inst.begin([{ key: 'codex', version: '0.51.0' }]);
  await done(inst);
  const npmBefore = f.calls.run.filter((c) => c.args.includes('--prefix')).length;
  inst.begin([{ key: 'codex', version: '0.50.0' }], { rollback: true });
  const job = await done(inst);
  assert.equal(job.phase, 'complete', JSON.stringify(job));
  assert.equal(job.rollback, true);
  assert.equal(f.calls.run.filter((c) => c.args.includes('--prefix')).length, npmBefore);
  const d = f.readState();
  assert.deepEqual(d.providers.codex.active, { version: '0.50.0', bin: f.bins.codex, external: true });
  assert.equal(d.providers.codex.previous.version, '0.51.0');
  assert.equal(inst.binary('codex'), f.bins.codex);
  assert.deepEqual(f.calls.activate.at(-1), { key: 'codex', bin: f.bins.codex });
});

test('rollback: missing previous installation => 409 fixed message', async () => {
  const f = fixture({ state: knownState() });
  const inst = f.make();
  inst.begin([{ key: 'codex', version: '0.51.0' }]);
  await done(inst);
  // previous is external baseline; remove it so validTarget fails
  fs.rmSync(f.bins.codex);
  rejectsWith(() => inst.begin([{ key: 'codex', version: '0.50.0' }], { rollback: true }), 409, PREV_GONE);
});

test('runChild: onChild callback throw rejects with its message and kills the child', async () => {
  let child;
  await assert.rejects(runChild(process.execPath, [childScript, 'hang'], {
    onChild: (c) => { child = c; track(c); throw new Error('track save failed'); },
  }), { message: 'track save failed' });
  assert.ok(await until(() => !alive(child.pid), 2000), 'child survived onChild failure');
});

test('track: save failure kills the just-spawned installer (real runChild composition)', async () => {
  let child;
  const f = fixture({ state: knownState(), runHook: (bin, args, options) => {
    if (!args.includes('--prefix')) return undefined;
    return runChild(process.execPath, [childScript, 'hang'], { ...options, env: undefined, timeout: 20000,
      onChild: (c) => { child = c; track(c); options.onChild(c); } });
  }, failPersist: (d) => d.job && d.job.child && d.job.child.pid });
  const inst = f.make();
  inst.begin([{ key: 'codex', version: '0.51.0' }]);
  assert.ok(await until(() => child && !alive(child.pid), 4000), 'child not killed after track save failure');
  const job = await done(inst);
  assert.equal(job.phase, 'failed');
  assert.equal(JSON.stringify(inst.snapshot()).includes(`"pid":${child.pid}`), false);
  assert.equal(f.readState().providers.codex.active, undefined);
});

test('dispose: SIGKILLs tracked child groups', async () => {
  let child;
  const f = fixture({ state: knownState(), runHook: async (bin, args, options) => {
    if (!args.includes('--prefix')) return undefined;
    const { spawn } = await import('node:child_process');
    child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
    livePids.add(child.pid);
    await new Promise((r) => child.once('spawn', r));
    options.onChild(child);
    await new Promise((r) => child.once('close', r));
    throw new Error('killed');
  } });
  const inst = f.make();
  inst.begin([{ key: 'codex', version: '0.51.0' }]);
  assert.ok(await until(() => child && inst.state.job?.child?.pid === child.pid));
  assert.equal(inst.snapshot().job.child, undefined, 'snapshot exposes child');
  const d = f.readState();
  assert.equal(d.job.child.pid, child.pid);
  assert.equal(d.job.child.boot, fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim());
  inst.dispose();
  assert.ok(await until(() => !alive(child.pid), 2000));
  await done(inst);
});

// ---------- tick / start ----------

test('tick: before 4 a.m. local does nothing; disabled start creates no timer', async () => {
  const f = fixture({ now: () => Date.parse('2026-10-28T07:00:00Z') }); // 03:00 EDT
  const inst = f.make();
  await inst.tick();
  assert.equal(f.calls.fetch.length, 0);
  const g = fixture({ enabled: false });
  const gi = g.make();
  gi.start();
  assert.ok(!gi.timer);
  await gi.tick();
  assert.equal(g.calls.fetch.length, 0);
});

test('tick: eligible day runs check once per day', async () => {
  const f = fixture();
  const inst = f.make();
  await inst.tick();
  await until(() => !inst.checking && f.calls.fetch.length === 2);
  await inst.tick();
  await sleep(30);
  assert.equal(f.calls.fetch.length, 2);
  assert.equal(f.readState().day, '2026-10-28');
});

test('tick: day save failure begins no check', async () => {
  const f = fixture({ failPersist: () => true });
  const inst = f.make();
  await inst.tick().catch(() => {});
  await sleep(30);
  assert.equal(f.calls.fetch.length, 0);
});

test('DIV-2 tick: restart after the day marker but before discovery still checks that day', async () => {
  let hung = false;
  const f = fixture({ fetchHook: () => { hung = true; return new Promise(() => {}); } });
  const inst = f.make();
  inst.tick().catch(() => {});
  await until(() => hung);
  inst.dispose(); // process "dies" mid-check
  const fetchesBefore = f.calls.fetch.length;
  f.opts.fetcher = async (url, opts) => {
    f.calls.fetch.push({ url, opts });
    const key = url.includes('codex') ? 'codex' : 'claude';
    const body = JSON.stringify({ name: PROVIDERS[key].pkg, version: key === 'codex' ? '0.51.0' : '2.0.1' });
    return { ok: true, status: 200, text: async () => body };
  };
  const again = f.make();
  await again.tick();
  await until(() => !again.checking && f.calls.fetch.length >= fetchesBefore + 2, 1000);
  assert.ok(f.calls.fetch.length >= fetchesBefore + 2, 'DIV-2: restarted daemon skipped the interrupted day\'s discovery');
});

// ---------- divergences 3, 4, 5 ----------

test('DIV-3 begin: extra selection fields are not persisted or returned', async () => {
  const f = fixture({ state: knownState() });
  const inst = f.make();
  const snap = inst.begin([{ key: 'codex', version: '0.51.0', note: 'injected', __proto_x: 1 }]);
  assert.deepEqual(snap.job.selections, [{ key: 'codex', version: '0.51.0' }], 'DIV-3: response echoes extra fields');
  await done(inst);
  assert.deepEqual(f.readState().job.selections, [{ key: 'codex', version: '0.51.0' }], 'DIV-3: disk stores extra fields');
});

test('failure-save failure displays an unsaved error but preserves durable selections (reviewed DIV-4)', async () => {
  const f = fixture({ state: knownState(),
    runHook: (bin, args) => { if (args.includes('--prefix')) throw new Error('The update command failed. The previous version is still selected.'); },
    failPersist: (d) => d.job && d.job.phase === 'failed' });
  const inst = f.make();
  inst.begin([{ key: 'codex', version: '0.51.0' }]);
  await until(() => !inst.busy);
  await sleep(20);
  const disk = f.readState();
  assert.equal(disk.job.running, true);
  assert.deepEqual(inst.state.providers, disk.providers, 'selected binaries must stay equal to disk');
  assert.equal(inst.state.job.phase,'failed');
  assert.match(inst.state.job.error,/Could not save update progress/);
  assert.equal(disk.job.running,true,'restart must recover the interrupted durable job');
  // and a restart must interrupt the still-running disk job
  inst.dispose();
  assert.equal(f.make().state.job.error, RESTARTED);
});

test('DIV-5 (partial): installer spawn happens only after durable intent; PID window itself untestable in-process', async () => {
  // Required: restart must not leave an untracked detached installer. The only
  // observable proxy: at onChild time, disk must already show a running job for
  // this provider, so a restart at least knows an install was in progress.
  let diskAtSpawn;
  const f = fixture({ state: knownState(), runHook: (bin, args) => {
    if (args.includes('--prefix')) diskAtSpawn = JSON.parse(fs.readFileSync(path.join(f.dir, STATE_REL), 'utf8'));
  } });
  const inst = f.make();
  inst.begin([{ key: 'codex', version: '0.51.0' }]);
  await done(inst);
  assert.equal(diskAtSpawn.job.running, true);
  assert.equal(diskAtSpawn.job.phase, 'installing');
  assert.equal(diskAtSpawn.job.provider, 'codex');
});
