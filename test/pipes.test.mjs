import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeDirs, ensurePipeDir } from '../pipes.mjs';

test('pipe directories sit outside the data directory, one per install', () => {
  const a = pipeDirs('/srv/pocket-a', {}), b = pipeDirs('/srv/pocket-b', {});
  assert.equal(a.top, path.join(os.tmpdir(), `pocket-code-pipes-${process.getuid()}`));
  assert.ok(a.claude.startsWith(a.top + path.sep) && a.codex.startsWith(a.top + path.sep));
  assert.notEqual(path.dirname(a.claude), path.dirname(b.claude), 'two installs never share a sweep');
  assert.notEqual(a.claude, a.codex, 'Claude and Codex sweeps never share a directory');
  assert.deepEqual(pipeDirs('/srv/pocket-a', {}), a, 'stable across restarts');
  const set = pipeDirs('/srv/pocket-a', { POCKET_PIPE_DIR: '/run/pocket' });
  assert.deepEqual(set, { top: '/run/pocket', claude: '/run/pocket/claude', codex: '/run/pocket/codex' });
});

test('ensurePipeDir creates private directories and refuses a symlink', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-pipedir-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const top = path.join(tmp, 'top'), dir = path.join(top, 'x', 'claude');
  fs.mkdirSync(top, { mode: 0o755 });
  ensurePipeDir(dir, top);
  for (const d of [dir, path.dirname(dir), top]) assert.equal(fs.statSync(d).mode & 0o777, 0o700, d);
  ensurePipeDir(dir, top); // idempotent
  const real = path.join(tmp, 'elsewhere'), link = path.join(tmp, 'link');
  fs.mkdirSync(real); fs.symlinkSync(real, link);
  assert.throws(() => ensurePipeDir(path.join(link, 'claude'), link), /not a directory owned/);
});
