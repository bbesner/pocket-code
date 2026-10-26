// proctree.mjs — CPU used by a process's descendants, and a process's command line.
// Linux reads /proc. macOS (and anything else without /proc) asks `ps` instead (1.47).
// Watchdogs use the CPU figure as a last sign of life for a turn that has gone quiet: programs the
// turn started are still working. Callers exclude processes that were already running when the turn
// began (MCP servers and the like). Unit: hundredths of a second of CPU on both backends (Linux
// jiffies at the usual 100 Hz; ps TIME converted), so a caller's "+100 means one more second" holds.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export const HAS_PROC = (() => { try { return fs.existsSync('/proc/self/stat'); } catch { return false; } })();
const runPs = (args, env) => execFileSync('ps', args, { encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024, env: env ? { ...process.env, ...env } : undefined });
const runSysctl = args => execFileSync('sysctl', args, { encoding: 'utf8', timeout: 5000 });

// ps TIME / cputime: [[dd-]hh:]mm:ss[.cc] (macOS prints "0:00.05", Linux "00:00:00" or "1-02:03:04") → hundredths.
export function parseCpuTime(s) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)(?:\.(\d+))?$/.exec(String(s).trim()); if (!m) return 0;
  const [, d, h, min, sec, frac] = m;
  return ((Number(d || 0) * 24 + Number(h || 0)) * 3600 + Number(min) * 60 + Number(sec)) * 100 + Math.round(Number('0.' + (frac || '0')) * 100);
}
// Rows of "pid ppid time" (ps -axo pid=,ppid=,time=) → parent→children map and per-pid CPU.
export function parsePsTable(text) {
  const kids = new Map(), cpu = new Map();
  for (const line of String(text).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)/.exec(line); if (!m) continue;
    const pid = Number(m[1]), ppid = Number(m[2]);
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid); cpu.set(pid, parseCpuTime(m[3]));
  }
  return { kids, cpu };
}
function fromProc() {
  const kids = new Map(), cpu = new Map();
  let entries = []; try { entries = fs.readdirSync('/proc'); } catch { }
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    try {
      const s = fs.readFileSync(`/proc/${e}/stat`, 'utf8');
      const f = s.slice(s.lastIndexOf(')') + 2).split(' ');
      const ppid = Number(f[1]);
      if (!kids.has(ppid)) kids.set(ppid, []);
      kids.get(ppid).push(Number(e));
      cpu.set(Number(e), Number(f[11]) + Number(f[12]));
    } catch { }
  }
  return { kids, cpu };
}
function fromPs(run) { try { return parsePsTable(run(['-axo', 'pid=,ppid=,time='])); } catch { return { kids: new Map(), cpu: new Map() }; } }

// { pids: Set of every descendant of rootPid, cpu: Map pid → CPU used }. `proc` and `run` are for tests.
export function descendantCpu(rootPid, { proc = HAS_PROC, run = runPs } = {}) {
  const { kids, cpu } = proc ? fromProc() : fromPs(run);
  const pids = new Set(), stack = [...(kids.get(rootPid) || [])];
  while (stack.length) { const p = stack.pop(); if (pids.has(p)) continue; pids.add(p); stack.push(...(kids.get(p) || [])); }
  return { pids, cpu };
}
// The command line of a live process, '' when it is gone. Linux cmdline keeps its NUL separators; ps gives spaces.
export function commandLine(pid, { proc = HAS_PROC, run = runPs } = {}) {
  if (proc) { try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch { return ''; } }
  try { return run(['-o', 'command=', '-p', String(pid)]).trim(); } catch { return ''; }
}

// 1.73.7: Pocket's short jobs (Vault runs, thumbnail renderers, reminder hooks) are spawned detached, each the leader
// of its own process group, so a timeout or a stop reaches everything the job started and not just its first process.
// Signals the process alone only on Windows, which has no groups: elsewhere the leader may be gone and its pid reused.
// True when a signal was delivered.
export function signalGroup(pid, sig) {
  if (!pid) return false;
  try { process.kill(process.platform === 'win32' ? pid : -pid, sig); return true; } catch { return false; }
}
// 1.73.7: proof that a pid recorded earlier is still the same process: this boot's id and the process's start time
// (clock ticks since boot, /proc/<pid>/stat field 22).
// 1.81 (#171): without /proc (macOS) there is no boot id, and the start time is the one ps prints (lstart, read in UTC and
// the C locale so a changed TZ or language cannot alter it). A live process with the recorded pid, start time and command
// is the one Pocket started, whatever the boot; a reused pid has a later start.
export const BOOT_ID = (() => { try { return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() || null; } catch { return null; } })();
export function startTime(pid, { proc = HAS_PROC, run = runPs } = {}) {
  if (!pid) return null;
  if (proc) { try { const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return s.slice(s.lastIndexOf(')') + 2).split(' ')[19] || null; } catch { return null; } }
  try { return run(['-o', 'lstart=', '-p', String(pid)], { TZ: 'UTC', LC_ALL: 'C' }).trim() || null; } catch { return null; }
}
// When this boot began, in ms: /proc/stat's btime, or on macOS `sysctl -n kern.boottime` ("{ sec = 1761480000, usec = … } …").
export function bootedAt({ proc = HAS_PROC, sysctl = runSysctl } = {}) {
  if (proc) { try { const btime = /^btime (\d+)/m.exec(fs.readFileSync('/proc/stat', 'utf8')); return btime ? Number(btime[1]) * 1000 : null; } catch { return null; } }
  try { const sec = /\bsec = (\d+)/.exec(sysctl(['-n', 'kern.boottime'])); return sec ? Number(sec[1]) * 1000 : null; } catch { return null; }
}
