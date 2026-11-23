// 1.124.5: faults the flow test of lane a found (review 2026-11-23, flows-a-findings.md), on the real server.mjs with the
// fake Claude Code CLI. Each test failed on the code before its fix. Ports 21180-21199, one per test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { spawn, execFileSync } from 'node:child_process';
import { createHmac, createECDH, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import ece from 'http_ece';
import { killStrays } from './stray-runners.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE|OPENCODE|FAKE)_/.test(k)));
const tmpDir = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flows-a-')));

// One server on `dir` (a fresh temp dir unless given, so a second boot is a restart on the same data).
async function boot(t, port, { dir = null, env = {} } = {}) {
  dir = dir || tmpDir();
  const home = path.join(dir, 'home'), cwd = path.join(home, 'work'), data = path.join(dir, 'data');
  for (const d of [home, cwd, path.join(home, 'pocket-uploads'), path.join(dir, 'sessions'), data]) fs.mkdirSync(d, { recursive: true });
  const secret = 'flows-a-' + path.basename(dir), exp = Date.now() + 3600_000;
  const cookie = 'pc_auth=' + exp + '.' + createHmac('sha256', secret).update(String(exp)).digest('hex');
  const child = spawn(process.execPath, ['server.mjs'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...cleanEnv(), HOME: home, PORT: String(port), POCKET_SKILLS: '0', POCKET_ENV_FILE: '', POCKET_AUTO_TITLES: '0', POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret,
    POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: data, POCKET_TEST_CALLS: path.join(dir, 'calls'), POCKET_CODEX: '0',
    CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'), POCKET_RETRY_BUFFER_MS: '0', POCKET_INBOX_RUNNER: '0', ...env,
  } });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  const exited = new Promise(r => child.once('exit', r));
  const stop = async (sig = 'SIGKILL') => { try { child.kill(sig); } catch { } await exited; };
  t.after(() => stop());
  t.after(async () => { await exited; killStrays(data); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); });
  for (let i = 0; ; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { } if (i > 300) throw new Error('server did not start: ' + logs); await sleep(30); }
  const call = async (p, body, headers = { cookie }, method) => {
    const r = await fetch(`http://127.0.0.1:${port}/api${p}`, { method: method || (body !== undefined ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    let j = null; try { j = await r.json(); } catch { } return { status: r.status, body: j };
  };
  const e = id => encodeURIComponent(id);
  const until = async (fn, ms = 15000, what = 'condition') => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}; log tail: ${logs.slice(-2500)}`); await sleep(60); } };
  const start = async (text, extra = {}) => { const r = await call('/new', { provider: 'claude', cwd, text, approvalMode: 'full', ...extra }); assert.equal(r.status, 202, JSON.stringify(r.body)); return r.body.id; };
  const session = id => call('/session/' + e(id)).then(r => r.body);
  const idle = id => until(async () => { const b = await session(id); return b && !b.active && b.state?.kind !== 'running' ? b : null; }, 15000, `${id} to end`);
  const calls = () => { try { return fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
  const bearer = () => ({ authorization: 'Bearer ' + fs.readFileSync(path.join(data, 'cli-token'), 'utf8').trim() });
  return { dir, data, cwd, cookie, port, call, e, until, start, session, idle, calls, bearer, stop, logs: () => logs };
}

// a-05: a usage limit with a message queued behind it read "Queue paused" (the retry time dropped), the queue sheet said
// "Paused" with Run next instruction, and that button sent the message straight into the limit.
test('a-05: with a message queued, a usage-limit wait reads Waiting for usage reset with its time, and Run next instruction is refused until the retry', { timeout: 90_000 }, async t => {
  const s = await boot(t, 21181, { env: { POCKET_RETRY_BUFFER_MS: '12000' } }); // the reset is 2 s on, the retry 14 s on
  const id = await s.start('limited task __LIMIT__ __SLOW__');
  await s.until(async () => (await s.session(id))?.active, 8000, 'the reply to start');
  const q = await s.call(`/session/${s.e(id)}/message`, { text: 'queued behind the limit', mode: 'queue', approvalMode: 'full' });
  assert.equal(q.status, 202, JSON.stringify(q.body));
  await s.until(() => s.logs().includes(`rate limited session=${id}`), 10000, 'the limit to be seen');
  const st = (await s.session(id)).state;
  assert.equal(st.label, 'Waiting for usage reset', JSON.stringify(st));
  assert.equal(st.kind, 'waiting'); assert.ok(st.retryAt > Date.now(), 'the retry time is kept'); assert.equal(st.queued, 1);
  const row = (await s.call('/sessions')).body.sessions.find(x => x.id === id);
  assert.deepEqual([row.state.label, row.state.retryAt, row.state.queued], ['Waiting for usage reset', st.retryAt, 1], 'the list row says the same');
  // the queue says what it waits for, and the row is not started into the limit
  const qv = (await s.call(`/session/${s.e(id)}/queue`)).body;
  assert.equal(qv.retryAt, st.retryAt, 'the queue carries the retry time');
  const r = await s.call(`/session/${s.e(id)}/queue/start`, { itemId: qv.items[0].id });
  assert.equal(r.status, 409, JSON.stringify(r.body)); assert.equal(r.body.code, 'usage_wait');
  assert.match(r.body.error, /^Waiting for the usage limit to reset\. Pocket retries the reply at .+, then runs the queue\.$/);
  await sleep(800);
  assert.ok(!s.calls().some(c => c.id === id && c.text === 'queued behind the limit'), 'the queued message did not start');
  // the retry runs, then the queued message
  await s.until(() => s.calls().some(c => c.id === id && c.text === 'queued behind the limit'), 30000, 'the queued message after the retry');
  const order = s.calls().filter(c => c.id === id).map(c => /interrupted by an API rate limit/.test(c.text) ? 'retry' : c.text === 'queued behind the limit' ? 'queued' : 'first');
  assert.deepEqual(order, ['first', 'retry', 'queued']);
});
