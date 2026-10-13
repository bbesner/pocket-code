// proctree.mjs — CPU used by a process's descendants, and a process's command line.
// Linux reads /proc. macOS (and anything else without /proc) asks `ps` instead (1.47).
// Watchdogs use the CPU figure as a last sign of life for a turn that has gone quiet: programs the
// turn started are still working. Callers exclude processes that were already running when the turn
// began (MCP servers and the like). Unit: hundredths of a second of CPU on both backends (Linux
// jiffies at the usual 100 Hz; ps TIME converted), so a caller's "+100 means one more second" holds.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export const HAS_PROC = (() => { try { return fs.existsSync('/proc/self/stat'); } catch { return false; } })();
const runPs = args => execFileSync('ps', args, { encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024 });

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
