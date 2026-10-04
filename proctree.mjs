// proctree.mjs — CPU used by a process's descendants, from /proc (Linux).
// Watchdogs use it as a last sign of life for a turn that has gone quiet: programs the
// turn started are still working. Callers exclude processes that were already running
// when the turn began (MCP servers and the like).
import fs from 'node:fs';

export function descendantCpu(rootPid) {
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
  const pids = new Set(), stack = [...(kids.get(rootPid) || [])];
  while (stack.length) { const p = stack.pop(); if (pids.has(p)) continue; pids.add(p); stack.push(...(kids.get(p) || [])); }
  return { pids, cpu };
}

