import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  UsageStore, estimateWindow, pickMainModel, contextTotal,
  contextFromTranscriptTail, getSessionContext,
} from '../usage.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('estimateWindow: 1M label, or tokens already past 200k, else 200k', () => {
  assert.equal(estimateWindow('claude-opus-5-5[1m]', 1000), 1_000_000);
  assert.equal(estimateWindow('claude-sonnet-5', 1000), 200_000);
  assert.equal(estimateWindow('claude-sonnet-5', 250_000), 1_000_000);
  assert.equal(estimateWindow(null, 1000), 200_000);
});

test('pickMainModel: prefers the turn\'s own model, otherwise skips Haiku side-calls', () => {
  const modelUsage = { 'claude-haiku-4-5-20251001': {}, 'claude-opus-5-5[1m]': {} };
  assert.equal(pickMainModel(modelUsage, 'claude-opus-5-5[1m]'), 'claude-opus-5-5[1m]');
  assert.equal(pickMainModel(modelUsage, null), 'claude-opus-5-5[1m]');
  assert.equal(pickMainModel({ 'claude-haiku-4-5-20251001': {} }, null), 'claude-haiku-4-5-20251001');
  assert.equal(pickMainModel(null, null), null);
});

test('contextTotal: sums input + cache read + cache creation, both naming conventions', () => {
  assert.equal(contextTotal({ input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 2 }), 17);
  assert.equal(contextTotal({ inputTokens: 10, cacheReadInputTokens: 5, cacheCreationInputTokens: 2 }), 17);
  assert.equal(contextTotal(null), 0);
});

test('UsageStore.observe: records account rate-limit snapshot and persists to disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-usage-'));
  const file = path.join(dir, 'usage-state.json');
  const store = new UsageStore(file);
  const ev = store.observe('sess-1', {
    type: 'rate_limit_event',
    rate_limit_info: {
      status: 'allowed', isUsingOverage: false, overageStatus: 'rejected', overageDisabledReason: 'out_of_credits',
      unifiedWindows: { five_hour: { utilization: 0.07, resetsAt: 1791141000 }, seven_day: { utilization: 0.02, resetsAt: 1791295200 } },
    },
  });
  assert.equal(ev.kind, 'account');
  const summary = store.accountSummary();
  assert.equal(summary.status, 'allowed');
  assert.equal(summary.windows.five_hour.utilization, 0.07);
  assert.equal(summary.windows.five_hour.resetsAt, 1791141000 * 1000);
  assert.equal(summary.overage.reason, 'out_of_credits');
  // persisted and reloadable — an account snapshot survives a restart
  const reloaded = new UsageStore(file);
  assert.equal(reloaded.accountSummary().status, 'allowed');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('UsageStore.observe: session context from assistant usage + result modelUsage, ignoring Haiku', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-usage-'));
  const store = new UsageStore(path.join(dir, 'usage-state.json'));
  store.observe('sess-2', { type: 'assistant', message: { model: 'claude-opus-5-5[1m]', usage: { input_tokens: 1200, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 } } });
  // partial state before the result line: estimated, no confirmed window yet
  let summary = store.sessionSummary('sess-2');
  assert.equal(summary.used, 2000);
  assert.equal(summary.estimated, true);
  const ev = store.observe('sess-2', {
    type: 'result',
    modelUsage: {
      'claude-opus-5-5[1m]': { inputTokens: 1200, cacheReadInputTokens: 800, cacheCreationInputTokens: 0, contextWindow: 1_000_000 },
      'claude-haiku-4-5-20251001': { inputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, contextWindow: 200_000 },
    },
  });
  assert.equal(ev.kind, 'session');
  summary = store.sessionSummary('sess-2');
  assert.equal(summary.used, 2000);
  assert.equal(summary.window, 1_000_000);
  assert.ok(Math.abs(summary.pct - 0.002) < 1e-9);
  assert.equal(summary.estimated, false);
  assert.equal(summary.model, 'claude-opus-5-5[1m]');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('contextFromTranscriptTail + getSessionContext: fallback for a session Pocket never drove', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-usage-'));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'claude-sonnet-5', usage: { input_tokens: 90_000, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 0 } } }),
  ].join('\n') + '\n');
  const direct = await contextFromTranscriptTail(file, fsp);
  assert.equal(direct.total, 100_000);
  assert.equal(direct.window, 200_000);
  assert.equal(direct.estimated, true);

  const store = new UsageStore(path.join(dir, 'usage-state.json'));
  assert.equal(store.sessionSummary('ext-sess'), null);
  const ctx = await getSessionContext(store, 'ext-sess', { transcriptFile: file, fsp });
  assert.equal(ctx.used, 100_000);
  assert.equal(ctx.window, 200_000);
  assert.equal(ctx.estimated, true);
  // now recorded — a second lookup doesn't need the transcript at all
  assert.ok(store.sessionSummary('ext-sess'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('contextFromTranscriptTail: a 1M-context model implies a 1M window even past only moderate usage', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-usage-'));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'assistant', message: { model: 'claude-fable-5-1[1m]', usage: { input_tokens: 5000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) + '\n');
  const ctx = await contextFromTranscriptTail(file, fsp);
  assert.equal(ctx.window, 1_000_000);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- API: the same events as they arrive over the real stream-json wire ----------
test('API: /api/usage and /api/session/:id/context reflect a turn that reported usage', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-usage-api-')); let port = 18362;
  const secret = randomUUID(), exp = Date.now() + 3600000;
  const cookie = exp + '.' + createHmac('sha256', secret).update(String(exp)).digest('hex');
  const headers = { 'content-type': 'application/json', cookie: 'pc_auth=' + cookie };
  const repo = path.resolve(import.meta.dirname, '..');
  const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID)_/.test(k)));
  let child;
  const start = async () => {
    child = spawn(process.execPath, ['server.mjs'], { cwd: repo, env: { ...cleanEnv(), PORT: String(port), POCKET_ENV_FILE: '', POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret, POCKET_CODEX: '0', POCKET_ALLOW_FULL_ACCESS: '0', POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: path.join(dir, 'data'), POCKET_TEST_CALLS: path.join(dir, 'calls'), CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs') }, stdio: ['ignore', 'pipe', 'pipe'] });
    for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
  if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=41;logs='';return start();} // the port was taken: move, never talk to a foreign server
    throw Error('Test server failed to start');
  };
  t.after(async () => { if (child && child.exitCode === null) { const exit = new Promise(r => child.once('exit', r)); child.kill(); await exit; } fs.rmSync(dir, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(dir, 'sessions', 'test-workspace'), { recursive: true });
  await start();
  const call = async (p, body, method) => { const r = await fetch(`http://127.0.0.1:${port}/api${p}`, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };

  const started = await call('/new', { cwd: repo, text: '__USAGE__ run a report', clientMessageId: randomUUID() });
  assert.equal(started.status, 202);
  const id = started.body.id;
  // turn still running: release without stop must refuse, not silently end it
  await sleep(100);
  const blocked = await call(`/session/${id}/release`, { stop: false });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.running, true);

  await sleep(700); // fake CLI resolves in ~300ms
  const usageResp = await call('/usage');
  assert.equal(usageResp.status, 200);
  assert.equal(usageResp.body.claude.status, 'allowed');
  assert.equal(usageResp.body.claude.windows.five_hour.utilization, 0.07);
  assert.ok(usageResp.body.claude.observedAt > 0);

  const ctx = await call(`/session/${id}/context`);
  assert.equal(ctx.status, 200);
  assert.equal(ctx.body.context.used, 2000);
  assert.equal(ctx.body.context.window, 1_000_000);
  assert.equal(ctx.body.context.estimated, false);

  // turn finished: release ends the session's idle process
  const released = await call(`/session/${id}/release`, {});
  assert.equal(released.status, 200);
  assert.equal(released.body.released, true);

  // release+stop on a running turn actually stops it
  const slow = await call('/new', { cwd: repo, text: '__SLOW__ long job', clientMessageId: randomUUID() });
  await sleep(100);
  const stopRelease = await call(`/session/${slow.body.id}/release`, { stop: true });
  assert.equal(stopRelease.status, 200);
  assert.equal(stopRelease.body.released, true);

  assert.equal((await fetch(`http://127.0.0.1:${port}/api/usage`)).status, 401, 'usage route requires auth');
});

test('a reported 1M window survives the next turn even though the transcript says "claude-opus-5-5"', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-usage-'));
  const store = new UsageStore(path.join(dir, 'usage-state.json'));
  const file = path.join(dir, 'session.jsonl');
  const line = (model, input) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', model, usage: { input_tokens: input, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
  // turn 1 (Pocket ran it): streamed line uses the API name; the result reports the real window under the CLI name
  store.observe('s', { type: 'assistant', message: { model: 'claude-opus-5-5', usage: { input_tokens: 120_000 } } });
  store.observe('s', { type: 'result', modelUsage: { 'claude-opus-5-5[1m]': { inputTokens: 2, contextWindow: 1_000_000 }, 'claude-haiku-4-5-20251001': { inputTokens: 1216, contextWindow: 200_000 } } });
  assert.equal(store.sessionSummary('s').window, 1_000_000);
  // turn 2 starts: a streamed line marks it estimated, the transcript moves on, the ring re-reads it
  store.observe('s', { type: 'assistant', message: { model: 'claude-opus-5-5', usage: { input_tokens: 150_000 } } });
  await sleep(20); fs.writeFileSync(file, line('claude-opus-5-5', 164_000) + '\n');
  const ctx = await getSessionContext(store, 's', { transcriptFile: file, fsp });
  assert.equal(ctx.used, 164_000);
  assert.equal(ctx.window, 1_000_000, 'not the 200k guess');
  // a real model change does take a new estimate
  await sleep(20); fs.writeFileSync(file, line('claude-sonnet-5', 50_000) + '\n');
  assert.equal((await getSessionContext(store, 's', { transcriptFile: file, fsp })).window, 200_000);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('without a reported window, the model Pocket launched decides the estimate', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-usage-'));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 150_000 } } }) + '\n');
  const a = new UsageStore(path.join(dir, 'a.json')), b = new UsageStore(path.join(dir, 'b.json'));
  assert.equal((await getSessionContext(a, 'x', { transcriptFile: file, fsp, modelHint: 'claude-opus-5-5[1m]' })).window, 1_000_000);
  assert.equal((await getSessionContext(b, 'x', { transcriptFile: file, fsp })).window, 200_000, 'no hint: still the conservative guess');
  fs.rmSync(dir, { recursive: true, force: true });
});
