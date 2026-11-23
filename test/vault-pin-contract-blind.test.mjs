// The contract of vault-pin.mjs as a blind bug review wrote it (2026-11-23, Pocket Code 1.124.3): one agent wrote a behaviour
// spec from the source, another wrote these tests from that spec alone, without sight of the source. The tests the verifier
// ruled not to be faults were turned round to assert what the code does on purpose, each with its reason (1.124.4).
// Everything is synthetic: temp dirs, stand-in executables, invented values. Nothing is spawned.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { tmpDir, patch, failFsFor, snapshot, unchanged } from './bugreview-faults.mjs';
import * as P from '../vault-pin.mjs';

const { PIN_VERSION, PIN_LIMITS, runPath, findProgram, exposedFolders, replaceable, prepareRun, pinCommand, pinDiff, pinKey, withData, pinView } = P;

const SYS = '/usr/bin:/bin';
const H = c => c.repeat(64);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms));
function exe(dir, name, body = '#!/bin/sh\nexit 0\n', mode = 0o755) { const p = path.join(dir, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); fs.chmodSync(p, mode); return p; }
function put(dir, name, body = 'plain data\n') { const p = path.join(dir, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); return p; }
function fdsInto(dir) { let n = 0; for (const fd of fs.readdirSync('/proc/self/fd')) { try { if (fs.readlinkSync(`/proc/self/fd/${fd}`).startsWith(dir)) n += 1; } catch {} } return n; }
const row = (pin, p) => pin.files.find(r => r.path === p);
const paths = pin => pin.files.map(r => r.path);
const fdNum = fd => (typeof fd === 'object' && fd !== null ? fd.fd : fd);
function patchP(name, impl) { const r = patch(fs.promises, name, impl); syncBuiltinESMExports(); return () => { r(); syncBuiltinESMExports(); }; }
/** Pass-through fs.promises.open that records every handle; `wrap(path, fh)` may return a proxy. */
function trackOpens(wrap) {
  const handles = []; const real = fs.promises.open;
  const restore = patchP('open', async (...a) => { const fh = await real.apply(fs.promises, a); handles.push(fh); return wrap ? wrap(String(a[0]), fh) : fh; });
  return { handles, restore };
}
function proxyHandle(fh, overrides) {
  return new Proxy(fh, { get(t, k) { if (Object.prototype.hasOwnProperty.call(overrides, k)) return overrides[k]; const v = Reflect.get(t, k); return typeof v === 'function' ? v.bind(t) : v; } });
}
const notFound = msg => e => { assert.equal(e.message, msg); assert.equal(e.status, 400); assert.equal(e.code, 'not_found'); return true; };
function copyFd(plan) {
  for (const [i, raw] of (plan.fds || []).entries()) {
    const fd = fdNum(raw);
    try { const st = fs.fstatSync(fd); if (st.nlink === 0 && (st.mode & 0o777) === 0o400) return { fd, i }; } catch {}
  }
  return null;
}
const pvDirs = d => fs.readdirSync(d).filter(n => n.startsWith('pocket-vault-'));
const view = v => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------------------------------------
describe('constants and runPath', () => {
  test('PIN_VERSION and PIN_LIMITS', () => {
    assert.equal(PIN_VERSION, 2);
    assert.deepEqual({ ...PIN_LIMITS }, { fileBytes: 536870912, cache: 1000, small: 262144, tokens: 200, depth: 4 });
  });
  test('runPath keeps absolute entries, in order, with duplicates', () => {
    assert.equal(runPath(':/opt/bin:relative:.:/usr/bin:'), '/opt/bin:/usr/bin');
    assert.equal(runPath('/a:/b:/a'), '/a:/b:/a');
  });
  test('runPath falls back to the default when nothing survives', () => {
    for (const raw of [undefined, null, '', 'relative:.', ':::', 123]) assert.equal(runPath(raw), '/usr/local/bin:/usr/bin:/bin', String(raw));
  });
});

describe('findProgram', () => {
  test('searches PATH folders in order, skipping non-executable files and folders', async () => {
    const a = tmpDir('pin-'), b = tmpDir('pin-'), c = tmpDir('pin-');
    exe(a, 'tool', 'x', 0o644);          // not executable
    fs.mkdirSync(path.join(b, 'tool'));   // folder
    const good = exe(c, 'tool');
    assert.equal(await findProgram('tool', a, `${a}:${b}:${c}`), good);
    const first = exe(a, 'tool2'); exe(c, 'tool2');
    assert.equal(await findProgram('tool2', a, `${a}:${c}`), first);
  });
  test('returns null when nothing matches; relative PATH entries are ignored', async () => {
    const cwd = tmpDir('pin-');
    exe(cwd, 'relbin/zz-stand-in-tool');
    assert.equal(await findProgram('zz-stand-in-tool', cwd, 'relbin'), null);
    assert.equal(await findProgram('zz-missing-tool', cwd, SYS), null);
  });
  test('a name with a slash resolves against cwd and is not canonicalized', async () => {
    const cwd = tmpDir('pin-');
    const real = exe(cwd, 'sub/tool');
    fs.symlinkSync(real, path.join(cwd, 'link'));
    assert.equal(await findProgram('./sub/tool', cwd, SYS), real);
    assert.equal(await findProgram('./link', cwd, SYS), path.join(cwd, 'link'));
    assert.equal(await findProgram('./sub/none', cwd, SYS), null);
  });
  test('PATH comes from the argument, not the environment', async () => {
    const bin = tmpDir('pin-'); const p = exe(bin, 'zz-only-here');
    assert.ok(!String(process.env.PATH).split(':').includes(bin));
    assert.equal(await findProgram('zz-only-here', bin, bin), p);
  });
});

describe('exposedFolders and replaceable', () => {
  test('writable, missing and parent folders are reported once each; system folders are not', () => {
    const w = tmpDir('pin-');
    const ro = path.join(w, 'ro'); fs.mkdirSync(ro); fs.chmodSync(ro, 0o555);
    const missing = path.join(w, 'nope', 'deeper');
    try {
      const out = exposedFolders(`${w}:${w}:relative:${missing}:${ro}:/usr/bin:/bin`);
      assert.deepEqual(view(out), [{ dir: w, why: 'writable' }, { dir: missing, why: 'missing' }, { dir: ro, why: 'parent' }]);
    } finally { fs.chmodSync(ro, 0o755); }
  });
  test('sticky ancestor counts only when the entry below it belongs to uid', () => {
    assert.ok(fs.statSync('/tmp').mode & 0o1000, 'precondition: /tmp is sticky');
    const d = tmpDir('pin-'); const x = path.join(d, 'x'); fs.mkdirSync(x);
    const f = put(d, 'f'); fs.chmodSync(f, 0o444);
    fs.chmodSync(x, 0o555); fs.chmodSync(d, 0o555);
    try {
      assert.deepEqual(view(exposedFolders(x, process.getuid())), [{ dir: x, why: 'parent' }]);
      assert.deepEqual(view(exposedFolders(x, 54321)), []);
      assert.equal(replaceable(f, process.getuid()), true);
      assert.equal(replaceable(f, 54321), false);
    } finally { fs.chmodSync(d, 0o755); fs.chmodSync(x, 0o755); }
  });
  test('replaceable: writable file true, missing path false, system file false', () => {
    const w = tmpDir('pin-'); const f = put(w, 'f');
    assert.equal(replaceable(f), true);
    assert.equal(replaceable(path.join(w, 'no', 'such')), false);
    assert.equal(replaceable('/usr/bin/true'), false);
  });
});

// ---------------------------------------------------------------------------------------------
describe('prepareRun: errors', () => {
  test('missing bare program: 400 not_found with the PATH phrase; no files written', async () => {
    const cwd = tmpDir('pin-'), td = tmpDir('pin-');
    await assert.rejects(prepareRun({ argv: ['zz-missing-prog'], cwd }, { PATH: SYS, forRun: true, tmpDir: td }),
      notFound("zz-missing-prog was not found on the Vault's PATH, or is not executable."));
    assert.deepEqual(fs.readdirSync(td), []);
  });
  test('missing program with a slash omits the PATH phrase', async () => {
    const cwd = tmpDir('pin-');
    await assert.rejects(prepareRun({ argv: ['./nope'], cwd }, { PATH: SYS }), notFound('./nope was not found, or is not executable.'));
  });
  test('non-executable program is not_found; a retry succeeds once it is executable', async () => {
    const cwd = tmpDir('pin-'); const p = exe(cwd, 'tool', '#!/bin/sh\nexit 0\n', 0o644);
    const before = snapshot(p);
    await assert.rejects(prepareRun({ argv: ['./tool'], cwd }, { PATH: SYS }), notFound('./tool was not found, or is not executable.'));
    assert.ok(unchanged(p, before));
    fs.chmodSync(p, 0o755);
    const plan = await prepareRun({ argv: ['./tool'], cwd }, { PATH: SYS });
    try { assert.equal(row(plan.pin, p).sha256, sha(before)); } finally { plan.close(); }
  });
  test('PATH is taken from the option: without it the default PATH is used', async () => {
    const bin = tmpDir('pin-'); exe(bin, 'zz-opt-tool');
    await assert.rejects(prepareRun({ argv: ['zz-opt-tool'], cwd: bin }, {}), e => e.status === 400 && e.code === 'not_found');
    const pin = await pinCommand({ argv: ['zz-opt-tool'], cwd: bin }, { PATH: bin });
    assert.equal(pin.program, path.join(bin, 'zz-opt-tool'));
  });
  test('missing program started by a launcher (bare name and slash forms)', async () => {
    const cwd = tmpDir('pin-');
    await assert.rejects(prepareRun({ argv: ['env', 'zz-missing-inner'], cwd }, { PATH: SYS }),
      notFound("zz-missing-inner (started by env) was not found on the Vault's PATH, or is not executable."));
    await assert.rejects(prepareRun({ argv: ['env', './zz-missing-inner'], cwd }, { PATH: SYS }),
      notFound('./zz-missing-inner (started by env) was not found, or is not executable.'));
  });
});

describe('prepareRun / pinCommand: pin construction', () => {
  test('ELF program row: v, absolute program, sha256 of bytes', async () => {
    const pin = await pinCommand({ argv: ['true'], cwd: tmpDir('pin-') }, { PATH: SYS });
    assert.equal(pin.v, 2);
    assert.equal(pin.program, '/usr/bin/true');
    const r = row(pin, '/usr/bin/true');
    assert.equal(r.role, 'program');
    assert.equal(r.sha256, sha(fs.readFileSync('/usr/bin/true')));
    assert.match(r.sha256, /^[0-9a-f]{64}$/);
  });
  test('arguments that are regular files are pinned, including --flag=file and NAME=file', async () => {
    const cwd = tmpDir('pin-');
    const f1 = put(cwd, 'one.txt', 'one'), f2 = put(cwd, 'two.txt', 'two'), f3 = put(cwd, 'three.txt', 'three');
    const pin = await pinCommand({ argv: ['true', 'one.txt', `--in=${f2}`, `X=${f3}`, 'not-a-file', cwd], cwd }, { PATH: SYS });
    for (const [f, b] of [[f1, 'one'], [f2, 'two'], [f3, 'three']]) {
      const r = row(pin, f); assert.ok(r, `missing row ${path.basename(f)}`);
      assert.equal(r.role, 'argument'); assert.equal(r.sha256, sha(Buffer.from(b)));
    }
    assert.ok(!paths(pin).some(p => p.endsWith('not-a-file')));
    assert.ok(!paths(pin).includes(cwd), 'a folder argument is not pinned');
  });
  test('each path is added once; the first role wins', async () => {
    const cwd = tmpDir('pin-'); const s = put(cwd, 'job.sh', 'echo hi\n');
    const pin = await pinCommand({ argv: ['sh', s, s], cwd }, { PATH: SYS });
    const rows = pin.files.filter(r => r.path === s);
    assert.equal(rows.length, 1); assert.equal(rows[0].role, 'script');
  });
  test('shebang interpreter is pinned (CR stripped)', async () => {
    const cwd = tmpDir('pin-'); const s = exe(cwd, 'crlf.sh', '#!/bin/sh\r\necho "$0"\r\n');
    const pin = await pinCommand({ argv: [s], cwd }, { PATH: SYS });
    assert.equal(row(pin, s).role, 'program');
    assert.equal(row(pin, '/bin/sh')?.role, 'interpreter');
  });
  test('#!/usr/bin/env <program> pins env and the program found on the Vault PATH', async () => {
    const cwd = tmpDir('pin-'), bin = tmpDir('pin-');
    const tool = exe(bin, 'zz-interp');
    const s = exe(cwd, 'envbang', '#!/usr/bin/env zz-interp\nbody\n');
    const pin = await pinCommand({ argv: [s], cwd }, { PATH: `${bin}:${SYS}` });
    assert.ok(row(pin, '/usr/bin/env'), 'env pinned');
    assert.ok(row(pin, tool), 'program selected on the Vault PATH pinned');
  });
  test('unreadable file (open EACCES, stat ok) gets why:unreadable and a decimal stamp; restart rehashes', async () => {
    const cwd = tmpDir('pin-'); const f = put(cwd, 'secretish.txt', 'abc');
    const st = fs.statSync(f); const before = snapshot(f);
    const real = fs.promises.open;
    const restore = patchP('open', async (...a) => { if (String(a[0]) === f) throw Object.assign(new Error('EACCES: denied'), { code: 'EACCES' }); return real.apply(fs.promises, a); });
    let pin;
    try { pin = await pinCommand({ argv: ['true', f], cwd }, { PATH: SYS }); } finally { restore(); }
    const r = row(pin, f);
    assert.equal(r.why, 'unreadable'); assert.equal(r.sha256, undefined);
    assert.equal(r.stamp.size, String(st.size));
    for (const k of ['size', 'mtime', 'ctime']) assert.match(r.stamp[k], /^\d+$/);
    assert.ok(unchanged(f, before));
    const pin2 = await pinCommand({ argv: ['true', f], cwd }, { PATH: SYS });
    assert.equal(row(pin2, f).sha256, sha(before));
    assert.deepEqual(view(pinDiff(pin, pin2)), [{ path: f, how: 'changed' }]);
  });
  test('file over 512 MiB gets why:large with a stamp', async () => {
    const cwd = tmpDir('pin-'); const f = path.join(cwd, 'big.bin');
    fs.writeFileSync(f, ''); fs.truncateSync(f, 536870912 + 1);
    const pin = await pinCommand({ argv: ['true', f], cwd }, { PATH: SYS });
    const r = row(pin, f);
    assert.equal(r.why, 'large'); assert.equal(r.stamp.size, '536870913'); assert.equal(r.sha256, undefined);
  });
  test('streamed (>256 KiB) file is hashed correctly', async () => {
    const cwd = tmpDir('pin-'); const b = crypto.randomBytes(262144 + 4097); const f = put(cwd, 'mid.bin', b);
    const pin = await pinCommand({ argv: ['true', f], cwd }, { PATH: SYS });
    assert.equal(row(pin, f).sha256, sha(b));
  });
  test('a script that is a folder is recorded with kind:folder', async () => {
    const cwd = tmpDir('pin-'); const d = path.join(cwd, 'dir'); fs.mkdirSync(d);
    const pin = await pinCommand({ argv: ['sh', d], cwd }, { PATH: SYS });
    const r = row(pin, d);
    assert.equal(r?.role, 'script'); assert.equal(r.kind, 'folder'); assert.equal(r.sha256, undefined);
  });
  test('a non-copied script in a writable folder is marked writable:true', async () => {
    const cwd = tmpDir('pin-'); const s = exe(cwd, 'self.sh', '#!/bin/sh\necho "$0"\n');
    const plan = await prepareRun({ argv: [s], cwd }, { PATH: SYS, forRun: true, tmpDir: tmpDir('pin-') });
    try { assert.equal(row(plan.pin, s).writable, true); assert.equal(copyFd(plan), null); } finally { plan.close(); }
  });
});

describe('launchers', () => {
  test('env resolves the nested program, rewrites it to an absolute path, and pinView.runs names it', async () => {
    const cwd = tmpDir('pin-');
    const plan = await prepareRun({ argv: ['env', 'true'], cwd }, { PATH: SYS, forRun: true });
    try {
      assert.equal(row(plan.pin, '/usr/bin/true')?.role, 'launched');
      assert.ok(plan.args.includes('/usr/bin/true'), 'nested bare name rewritten');
      assert.equal(pinView(plan.pin).runs, '/usr/bin/true');
      assert.ok(!plan.pin.unknown);
    } finally { plan.close(); }
  });
  test('known options are skipped: timeout, nice -n, env -C changes the resolution folder', async () => {
    const cwd = tmpDir('pin-'); const sub = path.join(cwd, 'sub'); const tool = exe(sub, 'tool');
    for (const argv of [['timeout', '5', 'true'], ['nice', '-n', '5', 'true']]) {
      const pin = await pinCommand({ argv, cwd }, { PATH: SYS });
      assert.equal(pinView(pin).runs, '/usr/bin/true', argv.join(' ')); assert.ok(!pin.unknown, argv.join(' '));
    }
    const pin = await pinCommand({ argv: ['env', '-C', sub, './tool'], cwd }, { PATH: SYS });
    assert.equal(row(pin, tool)?.role, 'launched');
  });
  test('unknown launcher option sets pin.unknown', async () => {
    const pin = await pinCommand({ argv: ['nice', '--zz-bogus-option', 'true'], cwd: tmpDir('pin-') }, { PATH: SYS });
    assert.ok(pin.unknown);
  });
  test('four launcher layers are followed; five set unknown "launchers inside launchers"', async () => {
    const cwd = tmpDir('pin-');
    const four = await pinCommand({ argv: ['nice', 'nice', 'nice', 'nice', 'true'], cwd }, { PATH: SYS });
    assert.ok(!four.unknown); assert.equal(pinView(four).runs, '/usr/bin/true');
    const five = await pinCommand({ argv: ['nice', 'nice', 'nice', 'nice', 'nice', 'true'], cwd }, { PATH: SYS });
    assert.equal(five.unknown, 'launchers inside launchers');
  });
  test('xargs with no command falls back to the Vault PATH echo', async () => {
    const pin = await pinCommand({ argv: ['xargs'], cwd: tmpDir('pin-') }, { PATH: SYS });
    assert.ok(row(pin, '/usr/bin/echo'), 'echo pinned');
  });
  test('scp with a separate -S helper is refused or pins the helper (control for DIV-2)', async () => {
    const bin = tmpDir('pin-'); fs.copyFileSync('/usr/bin/true', path.join(bin, 'scp')); fs.chmodSync(path.join(bin, 'scp'), 0o755);
    const helper = exe(bin, 'helper');
    const pin = await pinCommand({ argv: ['scp', '-S', helper, 'src.txt', 'example.invalid:dst'], cwd: bin }, { PATH: `${bin}:${SYS}` });
    assert.ok(pin.refuse || pin.unknown || row(pin, helper), 'helper neither refused nor pinned');
  });
});

describe('interpreters', () => {
  const NODE = path.dirname(process.execPath);
  test('node job searches job.js; -r ./mod is pinned as a module', async () => {
    const cwd = tmpDir('pin-'); const job = put(cwd, 'job.js', '1'); const mod = put(cwd, 'mod.js', '2');
    const p1 = await pinCommand({ argv: ['node', 'job'], cwd }, { PATH: `${NODE}:${SYS}` });
    assert.equal(row(p1, job)?.role, 'script');
    const p2 = await pinCommand({ argv: ['node', '-r', './mod.js', 'job.js'], cwd }, { PATH: `${NODE}:${SYS}` });
    assert.equal(row(p2, mod)?.role, 'module'); assert.ok(row(p2, job));
  });
  test('python -m pins local module, or package __init__ and __main__; library modules are not refused', async () => {
    const cwd = tmpDir('pin-'); const m = put(cwd, 'zzmod.py', 'x=1\n');
    const p1 = await pinCommand({ argv: ['python3', '-m', 'zzmod'], cwd }, { PATH: SYS });
    assert.ok(row(p1, m), 'local module pinned'); assert.ok(!p1.refuse);
    const i = put(cwd, 'zzpkg/__init__.py', ''), mm = put(cwd, 'zzpkg/__main__.py', 'print(1)\n');
    const p2 = await pinCommand({ argv: ['python3', '-m', 'zzpkg'], cwd }, { PATH: SYS });
    assert.ok(row(p2, i) && row(p2, mm), 'package files pinned');
    const p3 = await pinCommand({ argv: ['python3', '-m', 'json'], cwd }, { PATH: SYS });
    assert.ok(!p3.refuse);
  });
  // Not ambiguous: Python runs the package when both amb.py and amb/ exist, so the pin holds the package's files.
  test('python -m with both amb.py and a package amb/ pins the package files that run, not amb.py', async () => {
    const cwd = tmpDir('pin-'); const file = put(cwd, 'amb.py', ''); const i = put(cwd, 'amb/__init__.py', ''); const m = put(cwd, 'amb/__main__.py', '');
    const pin = await pinCommand({ argv: ['python3', '-m', 'amb'], cwd }, { PATH: SYS });
    assert.equal(pin.refuse, undefined);
    assert.equal(row(pin, m)?.role, 'script'); assert.equal(row(pin, i)?.role, 'module');
    assert.equal(row(pin, file), undefined, 'amb.py is never loaded');
  });
  test('make pins GNUmakefile first, -f files, -C folder; --eval sets inline', async () => {
    const cwd = tmpDir('pin-'); const g = put(cwd, 'GNUmakefile', 'all:\n'); const mk = put(cwd, 'Makefile', 'all:\n');
    const p1 = await pinCommand({ argv: ['make'], cwd }, { PATH: SYS });
    assert.ok(row(p1, g)); assert.ok(!row(p1, mk));
    const o = put(cwd, 'other.mk', 'all:\n');
    const p2 = await pinCommand({ argv: ['make', '-f', 'other.mk'], cwd }, { PATH: SYS });
    assert.ok(row(p2, o));
    const sub = path.join(cwd, 'sub'); const sm = put(sub, 'makefile', 'all:\n');
    const p3 = await pinCommand({ argv: ['make', '-C', 'sub'], cwd }, { PATH: SYS });
    assert.ok(row(p3, sm), '-C makefile pinned');
    const p4 = await pinCommand({ argv: ['make', '--eval=all:'], cwd }, { PATH: SYS });
    assert.ok(p4.inline);
  });
  test('inline shell code: files it names are pinned, inline names the kind not the code, no value leaks', async () => {
    const cwd = tmpDir('pin-'); const d = put(cwd, 'data.txt', 'd');
    const code = 'cat data.txt; echo Zq9FakeSecretValue7 >/dev/null';
    const pin = await pinCommand({ argv: ['sh', '-c', code], cwd }, { PATH: SYS });
    assert.ok(pin.inline); assert.equal(typeof pin.inline, 'string');
    assert.ok(row(pin, d), 'data.txt pinned');
    for (const s of [JSON.stringify(pin), JSON.stringify(pinView(pin))]) {
      assert.ok(!s.includes('Zq9FakeSecretValue7'), 'inline code leaked'); assert.ok(!s.includes('cat data.txt'));
    }
  });
  test('inline code: only the first 200 surviving tokens are checked; dash tokens are discarded', async () => {
    const cwd = tmpDir('pin-'); const d = put(cwd, 'data.txt', 'd');
    const words = n => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
    const dashes = Array.from({ length: 50 }, (_, i) => `-o${i}`).join(' ');
    const in200 = await pinCommand({ argv: ['sh', '-c', `${words(199)} ${dashes} data.txt`], cwd }, { PATH: SYS });
    assert.ok(row(in200, d), '200th token should be checked');
    const out = await pinCommand({ argv: ['sh', '-c', `${words(200)} data.txt`], cwd }, { PATH: SYS });
    assert.ok(!row(out, d), '201st token should not be checked');
  });
});

// ---------------------------------------------------------------------------------------------
describe('plans for a run (Linux fds and private copy)', () => {
  test('ELF top program starts from its open handle', async () => {
    const plan = await prepareRun({ argv: ['true'], cwd: tmpDir('pin-') }, { PATH: SYS, forRun: true, tmpDir: tmpDir('pin-') });
    try {
      assert.equal(plan.file, '/proc/self/fd/3');
      assert.equal(plan.argv0, 'true');
      assert.equal(fs.fstatSync(fdNum(plan.fds[0])).ino, fs.statSync('/usr/bin/true').ino);
      for (const k of ['pin', 'file', 'args', 'argv0', 'fds']) assert.ok(k in plan, k);
      assert.equal(typeof plan.verify, 'function'); assert.equal(typeof plan.close, 'function');
      assert.doesNotThrow(() => plan.verify());
    } finally { plan.close(); }
  });
  test('shell script runs from a private 0400 unlinked copy passed as /proc/self/fd/N', async () => {
    const cwd = tmpDir('pin-'), td = tmpDir('pin-'); const body = '#!/bin/sh\necho copied\n'; const s = exe(cwd, 'job.sh', body);
    const plan = await prepareRun({ argv: [s], cwd }, { PATH: SYS, forRun: true, tmpDir: td });
    let c;
    try {
      c = copyFd(plan); assert.ok(c, 'no private copy fd');
      const buf = Buffer.alloc(Buffer.byteLength(body)); fs.readSync(c.fd, buf, 0, buf.length, 0);
      assert.equal(buf.toString(), body);
      assert.ok(plan.args.includes(`/proc/self/fd/${3 + c.i}`), 'copy passed as its child fd');
      assert.ok(!plan.args.includes(s));
      assert.deepEqual(pvDirs(td), [], 'copy pathname already removed');
      assert.doesNotThrow(() => plan.verify());
    } finally { plan.close(); }
    assert.throws(() => fs.fstatSync(c.fd), { code: 'EBADF' });
  });
  test('script passed to a shell is replaced by its copy', async () => {
    const cwd = tmpDir('pin-'), td = tmpDir('pin-'); const s = put(cwd, 'plain.sh', 'echo hi\n');
    const plan = await prepareRun({ argv: ['sh', s], cwd }, { PATH: SYS, forRun: true, tmpDir: td });
    try { const c = copyFd(plan); assert.ok(c); assert.ok(!plan.args.includes(s)); assert.ok(plan.args.includes(`/proc/self/fd/${3 + c.i}`)); }
    finally { plan.close(); }
  });
  test('no copy for $0 / BASH_SOURCE scripts or after an fd-unsafe launcher', async () => {
    const cwd = tmpDir('pin-'), td = tmpDir('pin-');
    const a = exe(cwd, 'a.sh', '#!/bin/sh\necho ${0}\n'); const b = exe(cwd, 'b.sh', '#!/bin/bash\necho $BASH_SOURCE\n'); const c = exe(cwd, 'c.sh', '#!/bin/sh\necho hi\n');
    for (const argv of [[a], [b], ['xargs', c]]) {
      const plan = await prepareRun({ argv, cwd }, { PATH: SYS, forRun: true, tmpDir: td });
      try { assert.equal(copyFd(plan), null, argv.join(' ')); } finally { plan.close(); }
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('fail every step: reading files', () => {
  test('fh.stat failure rejects with the native error and closes every handle', async () => {
    const cwd = tmpDir('pin-'); const f = put(cwd, 'arg.txt', 'abc'); const before = snapshot(f);
    const { handles, restore } = trackOpens((p, fh) => (p === f ? proxyHandle(fh, { stat: async () => { throw Object.assign(new Error('injected stat'), { code: 'EIO' }); } }) : fh));
    try {
      await assert.rejects(prepareRun({ argv: ['true', f], cwd }, { PATH: SYS, forRun: true, tmpDir: tmpDir('pin-') }), { code: 'EIO' });
    } finally { restore(); }
    await settle();
    assert.ok(handles.length >= 1);
    for (const h of handles) assert.equal(h.fd, -1, 'a handle was left open');
    assert.ok(unchanged(f, before));
  });
  test('file changing while hashed rejects 409 (no code); handles closed; retry hashes current bytes', async () => {
    const cwd = tmpDir('pin-'); const f = put(cwd, 'arg.txt', 'abc');
    let n = 0;
    const { handles, restore } = trackOpens((p, fh) => (p === f ? proxyHandle(fh, { stat: async (...a) => { const s = await fh.stat(...a); if (++n === 1) fs.appendFileSync(f, 'MORE'); return s; } }) : fh));
    try {
      await assert.rejects(prepareRun({ argv: ['true', f], cwd }, { PATH: SYS }), e => {
        assert.equal(e.message, `${f} changed while the Vault was checking it; try again.`); assert.equal(e.status, 409); assert.equal(e.code, undefined); return true;
      });
    } finally { restore(); }
    await settle();
    for (const h of handles) assert.equal(h.fd, -1, 'a handle was left open');
    const pin = await pinCommand({ argv: ['true', f], cwd }, { PATH: SYS });
    assert.equal(row(pin, f).sha256, sha(Buffer.from('abcMORE')));
  });
  test('large file changing while hashed is not cached: the retry hashes the current bytes', async () => {
    const cwd = tmpDir('pin-'); const b = crypto.randomBytes(300000); const f = put(cwd, 'big.bin', b);
    let n = 0;
    const { restore } = trackOpens((p, fh) => (p === f ? proxyHandle(fh, { stat: async (...a) => { const s = await fh.stat(...a); if (++n === 1) fs.appendFileSync(f, 'Z'); return s; } }) : fh));
    try { await assert.rejects(prepareRun({ argv: ['true', f], cwd }, { PATH: SYS }), { status: 409 }); } finally { restore(); }
    const pin = await pinCommand({ argv: ['true', f], cwd }, { PATH: SYS });
    assert.equal(row(pin, f).sha256, sha(Buffer.concat([b, Buffer.from('Z')])));
  });
  test('nested executable removed: 400 not_found and prior handles closed; retry re-resolves', async () => {
    const cwd = tmpDir('pin-'), bin = tmpDir('pin-'); const t = exe(bin, 'zz-inner');
    const f = put(cwd, 'arg.txt', 'x');
    fs.rmSync(t);
    const { handles, restore } = trackOpens();
    try {
      await assert.rejects(prepareRun({ argv: ['env', 'zz-inner', f], cwd }, { PATH: `${bin}:${SYS}` }), e => e.status === 400 && e.code === 'not_found');
    } finally { restore(); }
    await settle();
    for (const h of handles) assert.equal(h.fd, -1, 'a handle was left open');
    exe(bin, 'zz-inner');
    const pin = await pinCommand({ argv: ['env', 'zz-inner', f], cwd }, { PATH: `${bin}:${SYS}` });
    assert.equal(pinView(pin).runs, t);
  });
});

describe('fail every step: private copy', () => {
  async function copyCase(name, match, opts, check) {
    const cwd = tmpDir('pin-'), td = tmpDir('pin-'); const s = exe(cwd, 'job.sh', '#!/bin/sh\necho hi\n'); const before = snapshot(s);
    const restore = failFsFor(name, td, opts);
    let err, plan;
    try { plan = await prepareRun({ argv: [s], cwd }, { PATH: SYS, forRun: true, tmpDir: td }); } catch (e) { err = e; } finally { restore(); }
    if (plan) plan.close();
    await settle();
    await check({ err, plan, td, cwd, s, before });
  }
  for (const [name, opts] of [['mkdtempSync', {}], ['writeFileSync', {}], ['openSync', {}]]) {
    test(`${name} failure rejects, leaves no copy or fd, and a retry succeeds`, async () => {
      await copyCase(name, null, opts, async ({ err, plan, td, cwd, s, before }) => {
        assert.equal(plan, undefined, 'should reject'); assert.equal(err.code, 'EIO');
        assert.deepEqual(fs.readdirSync(td), [], 'temp residue');
        assert.equal(fdsInto(td), 0, 'copy fd left open'); assert.equal(fdsInto(cwd), 0, 'script handle left open');
        assert.ok(unchanged(s, before));
        const again = await prepareRun({ argv: [s], cwd }, { PATH: SYS, forRun: true, tmpDir: td });
        try { assert.ok(copyFd(again)); } finally { again.close(); }
      });
    });
  }
  test('rmSync failure rejects and closes the copy fd and handles', async () => {
    await copyCase('rmSync', null, {}, async ({ err, plan, td, cwd }) => {
      assert.equal(plan, undefined, 'should reject'); assert.ok(err);
      assert.equal(fdsInto(td), 0, 'copy fd left open'); assert.equal(fdsInto(cwd), 0, 'script handle left open');
    });
  });
  // Rewritten from the blind form, which made every later rmSync fail: then nothing can remove anything, under any fix. One
  // failure at each of the two steps instead: a failed removal of the copy still rejects the run (a copy still reachable by
  // its path must not be run from) but the folder removal clears it; a failure on only the empty folder lets the run go on.
  test('DIV-4: a failed rmSync in the copy step must not leave the private copy on disk', async () => {
    const residue = td => pvDirs(td).flatMap(d => [d, ...fs.readdirSync(path.join(td, d)).map(f => `${d}/${f}`)]);
    for (const step of [1, 2]) {
      const cwd = tmpDir('pin-'), td = tmpDir('pin-'); const s = exe(cwd, 'job.sh', '#!/bin/sh\necho hi\n');
      const real = fs.rmSync; let n = 0;
      const restore = patch(fs, 'rmSync', (...a) => { if (String(a[0]).startsWith(td) && ++n === step) throw Object.assign(new Error('injected rmSync failure'), { code: 'EIO' }); return real.apply(fs, a); });
      let err, plan;
      try { plan = await prepareRun({ argv: [s], cwd }, { PATH: SYS, forRun: true, tmpDir: td }); } catch (e) { err = e; } finally { restore(); }
      try {
        if (step === 1) {
          assert.equal(plan, undefined, 'a copy whose removal failed is not run from'); assert.equal(err.code, 'EIO');
          assert.deepEqual(residue(td), [], 'the folder removal still clears the copy');
        } else {
          assert.ok(plan, `only the empty folder could not be removed; the run goes on: ${err?.message}`);
          assert.ok(copyFd(plan), 'the run uses the unlinked copy');
          assert.deepEqual(residue(td).filter(r => r.includes('/')), [], 'no copy left in the folder');
        }
      } finally { plan?.close(); }
      await settle();
      assert.equal(fdsInto(td), 0, 'copy fd left open'); assert.equal(fdsInto(cwd), 0, 'script handle left open');
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('plan.verify', () => {
  const stale = f => e => {
    assert.equal(e.message, `${f} changed just before the command started; nothing ran. Run it again.`);
    assert.equal(e.status, 409); assert.equal(e.code, 'request_stale'); assert.equal(e.changedPath, f); return true;
  };
  test('same-size byte change of a small file is caught', async () => {
    const cwd = tmpDir('pin-'); const f = put(cwd, 'a.txt', 'aaaa');
    const plan = await prepareRun({ argv: ['true', f], cwd }, { PATH: SYS, forRun: true });
    try { plan.verify(); fs.writeFileSync(f, 'bbbb'); assert.throws(() => plan.verify(), stale(f)); } finally { plan.close(); }
  });
  test('replacement by rename is caught', async () => {
    const cwd = tmpDir('pin-'); const f = put(cwd, 'a.txt', 'aaaa'); const n = put(cwd, 'n.txt', 'aaaa');
    const plan = await prepareRun({ argv: ['true', f], cwd }, { PATH: SYS, forRun: true });
    try { fs.renameSync(n, f); assert.throws(() => plan.verify(), stale(f)); } finally { plan.close(); }
  });
  test('streamed file changed in place is caught', async () => {
    const cwd = tmpDir('pin-'); const f = put(cwd, 'm.bin', crypto.randomBytes(300000));
    const plan = await prepareRun({ argv: ['true', f], cwd }, { PATH: SYS, forRun: true });
    try { const fd = fs.openSync(f, 'r+'); fs.writeSync(fd, Buffer.from('X'), 0, 1, 10); fs.closeSync(fd); assert.throws(() => plan.verify(), stale(f)); } finally { plan.close(); }
  });
  test('oversize file stamp change is caught', async () => {
    const cwd = tmpDir('pin-'); const f = path.join(cwd, 'big.bin'); fs.writeFileSync(f, ''); fs.truncateSync(f, 536870913);
    const plan = await prepareRun({ argv: ['true', f], cwd }, { PATH: SYS, forRun: true });
    try { plan.verify(); fs.truncateSync(f, 536870914); assert.throws(() => plan.verify(), stale(f)); } finally { plan.close(); }
  });
  test('SPEC? deleted pinned file is reported as 409 request_stale', async () => {
    const cwd = tmpDir('pin-'); const f = put(cwd, 'a.txt', 'aaaa');
    const plan = await prepareRun({ argv: ['true', f], cwd }, { PATH: SYS, forRun: true });
    try { fs.rmSync(f); assert.throws(() => plan.verify(), stale(f)); } finally { plan.close(); }
  });
  test('statSync failure throws; close still releases the plan; a fresh plan sees the file', async () => {
    const cwd = tmpDir('pin-'); const f = put(cwd, 'a.txt', 'aaaa');
    const plan = await prepareRun({ argv: ['true', f], cwd }, { PATH: SYS, forRun: true });
    const restore = failFsFor('statSync', f);
    try { assert.throws(() => plan.verify()); } finally { restore(); plan.close(); }
    await settle();
    assert.equal(fdsInto(cwd), 0);
    const pin = await pinCommand({ argv: ['true', f], cwd }, { PATH: SYS });
    assert.equal(row(pin, f).sha256, sha(Buffer.from('aaaa')));
  });
});

describe('plan.close', () => {
  test('returns undefined, releases handles and copy fds, and is idempotent without closing a reused fd', async () => {
    const cwd = tmpDir('pin-'), td = tmpDir('pin-'); const s = exe(cwd, 'job.sh', '#!/bin/sh\necho hi\n'); const f = put(cwd, 'arg.txt', 'x');
    const plan = await prepareRun({ argv: [s, f], cwd }, { PATH: SYS, forRun: true, tmpDir: td });
    const c = copyFd(plan); assert.ok(c);
    assert.equal(plan.close(), undefined);
    const reused = fs.openSync(f, 'r');
    try {
      assert.equal(plan.close(), undefined);
      assert.doesNotThrow(() => fs.fstatSync(reused), 'second close() closed an fd it no longer owns');
    } finally { fs.closeSync(reused); }
    await settle();
    assert.equal(fdsInto(cwd), 0); assert.equal(fdsInto(td), 0);
  });
  test('closeSync errors are swallowed', async () => {
    const cwd = tmpDir('pin-'), td = tmpDir('pin-'); const s = exe(cwd, 'job.sh', '#!/bin/sh\necho hi\n');
    const plan = await prepareRun({ argv: [s], cwd }, { PATH: SYS, forRun: true, tmpDir: td });
    const real = fs.closeSync;
    const restore = patch(fs, 'closeSync', fd => { real(fd); throw Object.assign(new Error('injected close'), { code: 'EIO' }); });
    try { assert.doesNotThrow(() => plan.close()); } finally { restore(); }
    await settle();
    assert.equal(fdsInto(td), 0); assert.equal(fdsInto(cwd), 0);
  });
  test('async FileHandle.close rejection is swallowed (no unhandled rejection)', async () => {
    const cwd = tmpDir('pin-'); const f = put(cwd, 'arg.txt', 'x');
    const probe = await fs.promises.open(f, 'r'); const proto = Object.getPrototypeOf(probe); await probe.close();
    const realClose = proto.close; const seen = [];
    const onRej = e => seen.push(e);
    process.on('unhandledRejection', onRej);
    const restore = patch(proto, 'close', function () { return realClose.call(this).then(() => { throw Object.assign(new Error('injected async close'), { code: 'EIO' }); }); });
    try {
      const plan = await prepareRun({ argv: ['true', f], cwd }, { PATH: SYS, forRun: true });
      assert.doesNotThrow(() => plan.close());
      await settle(150);
    } finally { restore(); process.off('unhandledRejection', onRej); }
    assert.deepEqual(seen, []);
  });
  test('pinCommand does not resolve while its file handles are still open', async () => {
    const cwd = tmpDir('pin-'); const f = put(cwd, 'arg.txt', 'x');
    await pinCommand({ argv: ['true', f], cwd }, { PATH: SYS });
    assert.equal(fdsInto(cwd), 0, 'pinCommand resolved before FileHandle.close() finished');
  });
});

// ---------------------------------------------------------------------------------------------
describe('concurrency and cache', () => {
  test('overlapping plans are independent: closing one keeps the other valid', async () => {
    const cwd = tmpDir('pin-'), td = tmpDir('pin-'); const s = exe(cwd, 'job.sh', '#!/bin/sh\necho hi\n');
    const [a, b] = await Promise.all([1, 2].map(() => prepareRun({ argv: [s], cwd }, { PATH: SYS, forRun: true, tmpDir: td })));
    try {
      a.close(); await settle();
      assert.doesNotThrow(() => b.verify());
      for (const fd of b.fds) assert.doesNotThrow(() => fs.fstatSync(fdNum(fd)));
      assert.ok(copyFd(b));
    } finally { a.close(); b.close(); }
  });
  test('cached hash is not reused after an in-place rewrite with the same size and mtime', async () => {
    const cwd = tmpDir('pin-'); const A = crypto.randomBytes(300000), B = crypto.randomBytes(300000); const f = put(cwd, 'c.bin', A);
    const p1 = await pinCommand({ argv: ['true', f], cwd }, { PATH: SYS });
    assert.equal(row(p1, f).sha256, sha(A));
    const st = fs.statSync(f); fs.writeFileSync(f, B); fs.utimesSync(f, st.atime, st.mtime);
    const p2 = await pinCommand({ argv: ['true', f], cwd }, { PATH: SYS });
    assert.equal(row(p2, f).sha256, sha(B));
    assert.deepEqual(view(pinDiff(p1, p2)), [{ path: f, how: 'changed' }]);
  });
  test('a concurrent rename swap yields a complete current digest or a 409, never a mixed one', async () => {
    const cwd = tmpDir('pin-'); const A = crypto.randomBytes(400000), B = crypto.randomBytes(400000);
    const f = put(cwd, 's.bin', A); const ok = new Set([sha(A), sha(B)]);
    let i = 0; const timer = setInterval(() => { const t = path.join(cwd, `t${i}`); fs.writeFileSync(t, i % 2 ? A : B); fs.renameSync(t, f); i += 1; }, 1);
    try {
      for (let k = 0; k < 20; k += 1) {
        try { const pin = await pinCommand({ argv: ['true', f], cwd }, { PATH: SYS }); const r = row(pin, f); assert.ok(ok.has(r.sha256), `mixed digest on run ${k}`); }
        catch (e) { assert.equal(e.status, 409, e.message); }
      }
    } finally { clearInterval(timer); }
  });
  test('restart (cache-busted import) rehashes from bytes', async () => {
    const cwd = tmpDir('pin-'); const A = crypto.randomBytes(300000); const f = put(cwd, 'r.bin', A);
    await pinCommand({ argv: ['true', f], cwd }, { PATH: SYS });
    const fresh = await import(`../vault-pin.mjs?restart=${Date.now()}`);
    const pin = await fresh.pinCommand({ argv: ['true', f], cwd }, { PATH: SYS });
    assert.equal(row(pin, f).sha256, sha(A));
  });
});

// ---------------------------------------------------------------------------------------------
const base = () => ({
  v: 2, program: '/p',
  files: [
    { role: 'program', path: '/p', sha256: H('a') },
    { role: 'argument', path: '/gone', sha256: H('b') },
    { role: 'argument', path: '/c', sha256: H('c') },
    { role: 'argument', path: '/d', data: true },
  ],
});

describe('pinDiff', () => {
  test('nullish and malformed inputs', () => {
    assert.deepEqual(view(pinDiff(null, undefined)), []);
    assert.deepEqual(view(pinDiff(null, base())), [{ path: '', how: 'unpinned' }]);
    assert.deepEqual(view(pinDiff(base(), { v: 2, program: '/p' })), [{ path: '', how: 'unpinned' }]);
    assert.deepEqual(view(pinDiff({ v: 2, program: '/p', files: 'x' }, base())), [{ path: '', how: 'unpinned' }]);
  });
  test('identical pins differ in nothing; role/writable/inline/unknown/refuse are ignored', () => {
    const now = base(); now.files[2] = { ...now.files[2], role: 'script', writable: true }; now.inline = 'shell'; now.unknown = 'x'; now.refuse = { why: 'w', how: 'h' };
    assert.deepEqual(view(pinDiff(base(), base())), []);
    assert.deepEqual(view(pinDiff(base(), now)), []);
  });
  test('gone, changed, new in order; saved data paths are excluded on both sides', () => {
    const now = { v: 2, program: '/p', files: [
      { role: 'program', path: '/p', sha256: H('a') },
      { role: 'argument', path: '/c', sha256: H('e') },
      { role: 'argument', path: '/n', sha256: H('f') },
      { role: 'argument', path: '/d', sha256: H('9') },
    ] };
    assert.deepEqual(view(pinDiff(base(), now)), [{ path: '/gone', how: 'gone' }, { path: '/c', how: 'changed' }, { path: '/n', how: 'new' }]);
  });
  test('program change comes first and suppresses its own gone/new rows', () => {
    const saved = { v: 2, program: '/a', files: [{ role: 'program', path: '/a', sha256: H('a') }, { role: 'argument', path: '/x', sha256: H('1') }] };
    const now = { v: 2, program: '/b', files: [{ role: 'program', path: '/b', sha256: H('b') }, { role: 'argument', path: '/x', sha256: H('2') }] };
    assert.deepEqual(view(pinDiff(saved, now)), [{ path: '/b', how: 'program', was: '/a' }, { path: '/x', how: 'changed' }]);
  });
  test('stamp and kind evidence comparisons', () => {
    const st = { size: '1', mtime: '2', ctime: '3' };
    const mk = ev => ({ v: 2, program: '/p', files: [{ role: 'program', path: '/p', sha256: H('a') }, { role: 'script', path: '/s', ...ev }] });
    assert.deepEqual(view(pinDiff(mk({ why: 'unreadable', stamp: st }), mk({ why: 'large', stamp: { ...st } }))), []);
    assert.deepEqual(view(pinDiff(mk({ why: 'unreadable', stamp: st }), mk({ why: 'unreadable', stamp: { ...st, ctime: '4' } }))), [{ path: '/s', how: 'changed' }]);
    assert.deepEqual(view(pinDiff(mk({ why: 'unreadable', stamp: st }), mk({ sha256: H('1') }))), [{ path: '/s', how: 'changed' }]);
    assert.deepEqual(view(pinDiff(mk({ kind: 'folder' }), mk({ kind: 'folder' }))), []);
    assert.deepEqual(view(pinDiff(mk({ kind: 'folder' }), mk({ kind: 'pipe' }))), [{ path: '/s', how: 'changed' }]);
  });
  // On purpose: a recipe under an earlier pin version that still agrees runs; one that no longer agrees asks once more. The
  // comparison is by content, so anything a later version pins (a launched program, a module) shows as a `new` row.
  test('an older pin version that agrees compares equal; one that lacks a file the current pin holds does not', () => {
    const old = { ...base(), v: 1 };
    assert.deepEqual(view(pinDiff(old, base())), []);
    const now = base(), narrower = { ...now, v: 1, files: now.files.filter(f => f.path !== '/c') };
    assert.deepEqual(view(pinDiff(narrower, now)), [{ path: '/c', how: 'new' }]);
  });
});

describe('pinKey, withData, pinView', () => {
  test('pinKey', () => {
    assert.equal(pinKey(null), null); assert.equal(pinKey({ v: 2, program: '/p' }), null); assert.equal(pinKey({ v: 2, program: '/p', files: [] }), null);
    const pin = { v: 2, program: '/p', files: [{ role: 'program', path: '/p', sha256: H('a') }, { role: 'script', path: '/k', kind: 'folder' }, { role: 'argument', path: '/d', data: true }, { role: 'argument', path: '/z' }] };
    assert.equal(pinKey(pin), JSON.stringify(['/p', [['/p', H('a')], ['/k', 'folder'], ['/z', null]]]));
    const st = { ...pin, files: [{ role: 'program', path: '/p', why: 'large', stamp: { size: '1', mtime: '2', ctime: '3' } }] };
    assert.notEqual(pinKey(st), pinKey({ ...pin, files: [{ role: 'program', path: '/p', why: 'large', stamp: { size: '1', mtime: '2', ctime: '4' } }] }));
  });
  test('withData', () => {
    const pin = base();
    assert.equal(withData(pin, []), pin);
    assert.equal(withData(null, ['/c']), null);
    const out = withData(pin, new Set(['/c', '/new', '/p']));
    assert.notEqual(out, pin); assert.notEqual(out.files, pin.files);
    assert.deepEqual(view(base()), view(pin), 'input pin mutated');
    assert.deepEqual(view(out.files.find(r => r.path === '/c')), { role: 'argument', path: '/c', data: true });
    assert.deepEqual(view(out.files.find(r => r.path === '/new')), { role: 'argument', path: '/new', data: true });
    assert.equal(out.files.filter(r => r.path === '/new').length, 1);
    assert.deepEqual(view(out.files.find(r => r.path === '/p')), view(pin.files[0]), 'non-argument row must not be marked');
    assert.equal(out.program, '/p'); assert.equal(out.v, 2);
  });
  test('pinView', () => {
    assert.deepEqual(pinView(null), {}); assert.deepEqual(pinView({ v: 2, files: 'x' }), {});
    const pin = { v: 2, program: '/e', inline: 'shell', unknown: 'x', refuse: { why: 'w', how: 'h', extra: 1 }, files: [
      { role: 'program', path: '/e', sha256: H('a') },
      { role: 'launched', path: '/l1', sha256: H('b') },
      { role: 'launched', path: '/l2', why: 'unreadable', stamp: { size: '1', mtime: '2', ctime: '3' } },
      { role: 'script', path: '/s', kind: 'folder' },
      { role: 'argument', path: '/a', data: true },
      { role: 'script', path: '/w', sha256: H('c'), writable: true },
    ] };
    assert.deepEqual(view(pinView(pin)), {
      files: [{ path: '/e', role: 'program' }, { path: '/l1', role: 'launched' }, { path: '/l2', role: 'launched', why: 'unreadable' }, { path: '/s', role: 'script', kind: 'folder' }, { path: '/a', role: 'argument', data: true }, { path: '/w', role: 'script', writable: true }],
      runs: '/l2', inline: 'shell', unknown: 'x', refuse: { why: 'w', how: 'h' },
    });
    assert.ok(!JSON.stringify(pinView(pin)).includes(H('a')));
    assert.equal('runs' in view(pinView(base())), false);
  });
  test('vault.mjs re-exports the pin API except withData and pinView', async () => {
    const v = await import('../vault.mjs');
    assert.equal(v.pinDiff, pinDiff); assert.equal(v.prepareRun, prepareRun);
    assert.ok(!('withData' in v)); assert.ok(!('pinView' in v));
  });
});

// ---------------------------------------------------------------------------------------------
describe('divergences', () => {
  test('DIV-1: an env -S PATH=... shebang must pin the tool from that PATH or be unpinnable', async () => {
    const cwd = tmpDir('pin-'), dirA = tmpDir('pin-'), dirB = tmpDir('pin-');
    const toolA = exe(dirA, 'zz-tool', '#!/bin/sh\necho A\n'); exe(dirB, 'zz-tool', '#!/bin/sh\necho B\n');
    const s = exe(cwd, 'job', `#!/usr/bin/env -S PATH=${dirA} zz-tool\nbody\n`);
    const pin = await pinCommand({ argv: [s], cwd }, { PATH: `${dirB}:${SYS}` });
    assert.ok(row(pin, toolA) || pin.refuse || pin.unknown, `pinned ${JSON.stringify(paths(pin).map(p => p.replace(/\/tmp\/pin-\w+/, '<tmp>')))} instead of the tool env -S will run`);
  });
  test('DIV-2: scp with an attached -S<helper> must be refused or pin the helper', async () => {
    const bin = tmpDir('pin-'); fs.copyFileSync('/usr/bin/true', path.join(bin, 'scp')); fs.chmodSync(path.join(bin, 'scp'), 0o755);
    const helper = exe(bin, 'helper');
    const pin = await pinCommand({ argv: ['scp', `-S${helper}`, 'src.txt', 'example.invalid:dst'], cwd: bin }, { PATH: `${bin}:${SYS}` });
    assert.ok(pin.refuse || pin.unknown || row(pin, helper), 'attached -S helper neither refused nor pinned');
  });
});
