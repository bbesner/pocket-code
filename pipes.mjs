// Where session input pipes live (1.73.2). They used to sit in turnlogs/ beside the logs,
// where a recursive search of the install opened one and read it: from then on the
// session's approvals, steered messages and stops went to the search, not the CLI
// (2026-10-20, an agent grepping turnlogs/ for a session id). Pipes now live in a
// private directory outside the data directory, one per install so two daemons'
// startup sweeps never remove each other's pipes, with a subdirectory per provider.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function pipeDirs(dataDir, env = process.env) {
  let top, root;
  if (env.POCKET_PIPE_DIR) top = root = path.resolve(env.POCKET_PIPE_DIR);
  else {
    top = path.join(os.tmpdir(), `pocket-code-pipes-${process.getuid()}`);
    root = path.join(top, createHash('sha256').update(path.resolve(dataDir)).digest('hex').slice(0, 12));
  }
  return { top, claude: path.join(root, 'claude'), codex: path.join(root, 'codex') };
}

// Create (or re-create: tmp cleaning may remove an idle directory) and refuse a symlink or a
// directory another account owns, from the pipe directory up to `top`; tighten loose modes.
export function ensurePipeDir(dir, top) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (let d = dir; ; d = path.dirname(d)) {
    const st = fs.lstatSync(d);
    if (!st.isDirectory() || st.uid !== process.getuid()) throw new Error(`Pipe directory ${d} is not a directory owned by this account`);
    if (st.mode & 0o077) fs.chmodSync(d, 0o700);
    if (d === top || d === path.dirname(d)) break;
  }
  return dir;
}
