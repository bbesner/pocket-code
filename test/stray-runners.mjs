// Test helper (not a test file): stop what a test server left running after the test killed it.
//
// Why there is anything left: server.mjs spawns each Claude CLI (and Codex's app server) detached, in its own session,
// reading a FIFO whose write end a `pocket-keeper` shell holds, so the work survives a daemon restart and is adopted.
// The keeper loops while the CLI lives, and the CLI waits on its stdin while the keeper holds it open, so when a test
// SIGKILLs the server both carry on for ever, re-parented to 1 (the fake CLIs never exit on their own).
//
// killStrays(dataDir) finds every process whose environment carries POCKET_DATA_DIR=<dataDir> (the server passes its
// own environment, that variable included, to everything it spawns: CLIs, keepers, hooks) and SIGKILLs it. Call it only
// after the server is dead (or the server would spawn more), and only at the end of a test: a restart in the middle of a
// test relies on the runners outliving the server. Linux only; elsewhere (no /proc) it does nothing.
import fs from 'node:fs';

export function killStrays(dataDir) {
  if (!dataDir || !fs.existsSync('/proc')) return 0;
  const mark = Buffer.from('\0POCKET_DATA_DIR=' + dataDir + '\0');
  let n = 0;
  for (const name of fs.readdirSync('/proc')) {
    const pid = Number(name);
    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) continue;
    let env;
    try { env = fs.readFileSync(`/proc/${pid}/environ`); } catch { continue; } // gone, or not ours
    if (!Buffer.concat([Buffer.from('\0'), env]).includes(mark)) continue;
    try { process.kill(pid, 'SIGKILL'); n++; } catch { }
  }
  return n;
}
