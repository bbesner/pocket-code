// 1.81: inbox-watch/bin/inbox-monitor finds a Python 3.11+ on PATH (no fixed /usr/bin/python3), honours INBOX_MONITOR_PYTHON,
// and its usage line names real subcommands only. Fake interpreters stand in for Python; nothing real is run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const wrapper = path.resolve(import.meta.dirname, '..', 'inbox-watch', 'bin', 'inbox-monitor');
const fake = (dir, name, { ok }) => {
  const f = path.join(dir, name);
  fs.writeFileSync(f, `#!/bin/sh\ncase "$*" in *version_info*) exit ${ok ? 0 : 1};; esac\necho "ran ${name}"\n`, { mode: 0o755 });
  return f;
};
// PATH is the temporary folder alone (plus the two tools the wrapper itself needs), so no real python is found.
const dir = () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-wrapper-'));
  for (const t of ['dirname', 'readlink']) fs.symlinkSync(['/usr/bin', '/bin'].map(d => path.join(d, t)).find(f => fs.existsSync(f)), path.join(bin, t));
  return bin;
};
const run = (bin, env = {}) => spawnSync(process.env.BASH || '/bin/bash', [wrapper, '--config', 'x.toml'], { encoding: 'utf8', env: { PATH: bin, HOME: bin, ...env } });

test('uses the first python on PATH that is 3.11 or newer', () => {
  const bin = dir();
  fake(bin, 'python3', { ok: false }); // an old system python3 in front
  fake(bin, 'python3.12', { ok: true });
  const r = run(bin);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'ran python3.12');
  fake(bin, 'python3', { ok: true });
  assert.equal(run(bin).stdout.trim(), 'ran python3');
});

test('INBOX_MONITOR_PYTHON names the interpreter; a bad one is refused in words', () => {
  const bin = dir();
  fake(bin, 'python3', { ok: true });
  const mine = fake(bin, 'my-python', { ok: true }), old = fake(bin, 'old-python', { ok: false });
  assert.equal(run(bin, { INBOX_MONITOR_PYTHON: mine }).stdout.trim(), 'ran my-python');
  const r = run(bin, { INBOX_MONITOR_PYTHON: old });
  assert.equal(r.status, 127);
  assert.match(r.stderr, /INBOX_MONITOR_PYTHON .* is not Python 3\.11 or newer/);
});

test('no suitable python says what is needed', () => {
  const bin = dir();
  fake(bin, 'python3', { ok: false });
  const r = run(bin);
  assert.equal(r.status, 127);
  assert.match(r.stderr, /needs Python 3\.11 or newer on PATH/);
});

test('the usage line lists real subcommands only', () => {
  const head = fs.readFileSync(wrapper, 'utf8').split('\n').find(l => l.startsWith('# Usage:'));
  const listed = /\[([^\]]+)\]/.exec(head)[1].split('|');
  const engine = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'inbox-watch', 'inbox_monitor', 'engine.py'), 'utf8');
  const real = [...engine.matchAll(/sub\.add_parser\("([a-z-]+)"/g)].map(m => m[1]);
  assert.ok(real.length >= 8);
  assert.deepEqual([...listed].sort(), [...real].sort());
});
