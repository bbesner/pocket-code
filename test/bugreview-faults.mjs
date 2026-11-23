// bugreview-faults.mjs: fault injection for blind bug-review tests (Node 20+, node:test). Copy into the repo's test/
// directory. Everything here is synthetic: temp dirs, fake clocks, throwaway child processes.
import { after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const dirs = [], pids = new Set(), restores = [];
after(() => {
  while (restores.length) { try { restores.pop()(); } catch {} }
  for (const pid of pids) { try { process.kill(-pid, 'SIGKILL'); } catch {} try { process.kill(pid, 'SIGKILL'); } catch {} }
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
});

/** A temp dir removed after the file's tests. */
export function tmpDir(prefix = 'bugreview-') { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); dirs.push(d); return d; }

/** A controllable clock: pass `clock.now` wherever the code takes a `now` function. */
export function fakeClock(start = Date.parse('2026-01-01T00:00:00Z')) {
  const c = { t: start, now: () => c.t, advance(ms) { c.t += ms; return c.t; }, set(ms) { c.t = ms; return c.t; } };
  return c;
}

/** Wrap a function so it throws on chosen calls. `on`: call numbers (1-based) or a predicate (args, n) => bool. */
export function failing(real, { on = () => true, error = () => Object.assign(new Error('injected failure'), { code: 'EIO' }) } = {}) {
  let n = 0;
  const f = (...args) => { n += 1; const hit = Array.isArray(on) ? on.includes(n) : on(args, n); if (hit) throw error(args, n); return real(...args); };
  f.calls = () => n; return f;
}

/** Replace obj[name] (e.g. fs, 'renameSync') until the returned restore runs (or the file's tests end).
 *  For node:fs the ESM named exports are re-synced so `import { renameSync } from 'node:fs'` sees the patch too. */
export function patch(obj, name, impl) {
  const orig = obj[name]; obj[name] = impl; if (obj === fs) syncBuiltinESMExports();
  const restore = () => { obj[name] = orig; if (obj === fs) syncBuiltinESMExports(); };
  restores.push(restore); return restore;
}

/** Fail an fs call only for paths matching `match` (string or RegExp); other paths pass through. */
export function failFsFor(name, match, { after: skip = 0, code = 'EIO' } = {}) {
  const real = fs[name]; let seen = 0;
  const hit = p => (typeof match === 'string' ? String(p).includes(match) : match.test(String(p)));
  return patch(fs, name, (...args) => { if (hit(args[0]) && ++seen > skip) throw Object.assign(new Error(`injected ${name} failure`), { code }); return real.apply(fs, args); });
}

/** Byte snapshot of a file (null if missing), and equality against it. */
export const snapshot = f => (fs.existsSync(f) ? fs.readFileSync(f) : null);
export const unchanged = (f, snap) => { const now = snapshot(f); return now === snap || (now && snap && now.equals(snap)); };

/** True once the process ignores SIGTERM (Linux: SigIgn bit 15 in /proc/<pid>/status). */
export function ignoresTerm(pid) { try { const m = /SigIgn:\s*([0-9a-f]+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8')); return Boolean(m && (BigInt('0x' + m[1]) & 0x4000n)); } catch { return false; } }
/** A child that ignores SIGTERM, in its own process group, tracked for cleanup. Await `ready` before signalling it:
 *  a TERM sent before the shell installs its trap kills it, which makes a test pass or fail by luck. */
export function stubbornChild({ seconds = 30, holdPipes = false } = {}) {
  const child = spawn('sh', ['-c', `trap '' TERM; exec sleep ${seconds}`], { detached: true, stdio: holdPipes ? ['ignore', 'pipe', 'pipe'] : 'ignore' });
  pids.add(child.pid); if (!holdPipes) child.unref();
  const ready = until(() => ignoresTerm(child.pid), 3000).then(ok => { if (!ok) throw new Error('stubborn child never ignored SIGTERM'); });
  return { pid: child.pid, child, ready };
}
/** Track a pid you started some other way so it is killed after the tests. */
export const track = pid => { if (pid) pids.add(pid); return pid; };
/** True while the process exists (zombies count as gone only once reaped). */
export function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
/** Wait until `fn()` is true or `ms` pass; resolves to the last value. */
export async function until(fn, ms = 3000, step = 25) { const end = Date.now() + ms; let v; while (!(v = fn()) && Date.now() < end) await new Promise(r => setTimeout(r, step)); return v; }
