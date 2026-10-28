// ACP runtime discovery + opt-in config (acp.mjs). The engine stays OFF unless an operator
// enables it AND a runtime is installed, so default installs are unaffected. No child spawned.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findAcpRuntime, acpConfig, acpAvailable } from '../acp.mjs';
import { DEFAULT_CURATED } from '../openrouter.mjs';

// A dir containing a fake executable `opencode`, to exercise PATH discovery without real OpenCode.
function fakeRuntimeDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-rt-'));
  const bin = path.join(d, 'opencode');
  fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n'); fs.chmodSync(bin, 0o755);
  return d;
}
// Empty PATH + a HOME with no opencode, so discovery sees only what each test sets up
// (isolates from any real OpenCode installed on this machine).
const EMPTY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-home-'));
const baseEnv = extra => ({ PATH: '/nonexistent', HOME: EMPTY_HOME, ...extra });

test('findAcpRuntime: explicit POCKET_ACP_CMD wins, with default/overridden args', () => {
  assert.deepEqual(findAcpRuntime(baseEnv({ POCKET_ACP_CMD: '/opt/oc' })), { cmd: '/opt/oc', args: ['acp'] });
  assert.deepEqual(findAcpRuntime(baseEnv({ POCKET_ACP_CMD: '/opt/oc', POCKET_ACP_ARGS: 'serve acp --x' })), { cmd: '/opt/oc', args: ['serve', 'acp', '--x'] });
});

test('findAcpRuntime: discovers opencode on PATH, null when absent', () => {
  const d = fakeRuntimeDir();
  const rt = findAcpRuntime(baseEnv({ PATH: d }));
  assert.deepEqual(rt, { cmd: path.join(d, 'opencode'), args: ['acp'] });
  assert.equal(findAcpRuntime(baseEnv({})), null, 'no runtime on an empty PATH');
});

test('acpConfig: OFF unless enabled AND a runtime exists', () => {
  const d = fakeRuntimeDir();
  assert.equal(acpConfig(baseEnv({ PATH: d })), null, 'runtime present but not enabled => off');
  assert.equal(acpConfig(baseEnv({ POCKET_ACP_ENABLE: '1' })), null, 'enabled but no runtime => off');
  const cfg = acpConfig(baseEnv({ POCKET_ACP_ENABLE: '1', PATH: d }));
  assert.ok(cfg && cfg.cmd === path.join(d, 'opencode'));
  assert.deepEqual(cfg.curated, DEFAULT_CURATED, 'curated defaults to the probed set');
});

test('acpConfig: POCKET_ACP_MODELS extends the curated set (deduped)', () => {
  const cfg = acpConfig(baseEnv({ POCKET_ACP_ENABLE: 'yes', POCKET_ACP_CMD: '/opt/oc', POCKET_ACP_MODELS: 'openrouter/z-ai/glm-5.3, deepseek/deepseek-v4.1-flash-1017' }));
  assert.ok(cfg.curated.includes('openrouter/z-ai/glm-5.3'));
  assert.ok(cfg.curated.includes('deepseek/deepseek-v4.1-flash-1017'));
  assert.equal(new Set(cfg.curated).size, cfg.curated.length, 'no duplicates');
});

test('acpAvailable mirrors acpConfig', () => {
  assert.equal(acpAvailable(baseEnv({})), false);
  assert.equal(acpAvailable(baseEnv({ POCKET_ACP_ENABLE: '1', POCKET_ACP_CMD: '/opt/oc' })), true);
});
