// 1.62 choosing the model: router.mjs (tiers onto offered models, the effort ceiling, both providers, failing open)
// and the server (Assistant mode routes a typed request, a conversation keeps its choice, maxEffortLevel caps every
// turn). A local fake decision endpoint and the fake CLI only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {ModelRouter, tierChoice, capEffort, TIERS, routerContext} from '../router.mjs';
import {CLAUDE_MODELS} from '../models.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const seat = CLAUDE_MODELS.filter(m => ['claude-opus-5-5[1m]', 'claude-sonnet-5-5'].includes(m.id));
const json = (o, status = 200) => ({ ok: status < 400, status, json: async () => o });

test('tiers map onto the offered models; a missing family falls back a tier; the ceiling caps effort', () => {
  assert.deepEqual(tierChoice('quick', seat), { model: 'claude-sonnet-5-5', effort: 'low', tier: 'quick' });
  assert.deepEqual(tierChoice('deep', seat), { model: 'claude-opus-5-5[1m]', effort: 'high', tier: 'deep' });
  assert.deepEqual(tierChoice('deep', seat.filter(m => m.alias === 'sonnet')), { model: 'claude-sonnet-5-5', effort: 'high', tier: 'careful' }, 'no Opus: the next tier down');
  assert.deepEqual(tierChoice('deep', seat, 'medium'), { model: 'claude-opus-5-5[1m]', effort: 'medium', tier: 'deep' });
  assert.equal(tierChoice('nonsense', seat), null);
  assert.equal(capEffort('max', 'high'), 'high'); assert.equal(capEffort('low', 'high'), 'low'); assert.equal(capEffort('high', null), 'high');
  assert.equal(TIERS.length, 4);
});

test('Jev and OpenAI answers become a choice; errors, timeouts, refusals and low confidence fail open', async () => {
  const sent = [];
  const jev = new ModelRouter({ provider: 'jev', key: 'k', fetchImpl: async (url, o) => { sent.push([url, JSON.parse(o.body), o.headers]); return json({ answers: { tier: { choice: 'deep', probabilities: { deep: 0.81, quick: 0.19 } } } }); } });
  const a = await jev.pick('Make a proposal from QT-10432', { offered: seat });
  assert.equal(a.model, 'claude-opus-5-5[1m]'); assert.equal(a.effort, 'high'); assert.equal(a.confidence, 0.81);
  assert.match(sent[0][0], /openrouter\.ai\/api\/alpha\/decisions$/); assert.equal(sent[0][2].authorization, 'Bearer k');
  assert.deepEqual(Object.keys(sent[0][1].questions.tier.criteria), ['quick', 'standard', 'careful', 'deep']);
  assert.equal(sent[0][1].state.first_message, 'Make a proposal from QT-10432');

  const oa = new ModelRouter({ provider: 'openai', key: 'k', fetchImpl: async (url, o) => { sent.push([url, JSON.parse(o.body)]); return json({ answers: [{ type: 'choice', name: 'tier', choice: 'quick', confidence: 0.9 }] }); } });
  assert.equal((await oa.pick('Any quotes expiring?', { offered: seat })).effort, 'low');
  assert.match(sent[1][0], /api\.openai\.com\/v1\/decisions$/); assert.equal(sent[1][1].model, 'gpt-6-luna');

  const cases = {
    'HTTP error': async () => json({ error: 'no' }, 500),
    refusal: async () => json({ answers: [{ type: 'refusal', name: 'tier' }] }),
    'unknown tier': async () => json({ answers: { tier: { choice: 'ultra', probabilities: { ultra: 1 } } } }),
    'low confidence': async () => json({ answers: { tier: { choice: 'deep', probabilities: { deep: 0.2 } } } }),
    // AbortSignal.timeout's timer doesn't hold the event loop open; the server's does, so keep one here too.
    timeout: (u, o) => new Promise((_, rej) => { const hold = setTimeout(() => { }, 2000); o.signal.addEventListener('abort', () => { clearTimeout(hold); rej(Object.assign(new Error('t'), { name: 'TimeoutError' })); }); }),
  };
  for (const [name, fetchImpl] of Object.entries(cases)) {
    const r = new ModelRouter({ provider: name === 'refusal' ? 'openai' : 'jev', key: 'k', timeoutMs: 100, fetchImpl });
    assert.equal(await r.pick('x', { offered: seat }), null, name + ' runs the default');
  }
  assert.equal(new ModelRouter({ provider: 'jev', key: '' }).on, false, 'no key: off');
  assert.equal(new ModelRouter({ provider: 'gemini', key: 'k' }).on, false, 'unknown provider: off');
  assert.equal(await jev.pick('x', { offered: [] }), null, 'nothing offered: default');
});

test('1.81: the prompt names no business; POCKET_ROUTER_CONTEXT is added after the neutral context (#174)', async () => {
  const sent = [];
  const fetchImpl = async (url, o) => { sent.push(JSON.parse(o.body)); return json({ answers: { tier: { choice: 'quick', probabilities: { quick: 0.9 } } } }); };
  await new ModelRouter({ provider: 'jev', key: 'k', fetchImpl }).pick('Any quotes expiring?', { offered: seat });
  const plain = sent[0].state.context + ' ' + sent[0].questions.tier.instructions;
  assert.doesNotMatch(plain, /security|account manager|warehouse|office employee/i);
  assert.match(sent[0].questions.tier.instructions, /from an AI work assistant\?/);
  await new ModelRouter({ provider: 'jev', key: 'k', fetchImpl, context: '  A bakery with two shops;\n orders and invoices are routine.  ' }).pick('x', { offered: seat });
  assert.equal(sent[1].state.context, sent[0].state.context + ' A bakery with two shops; orders and invoices are routine.');
  const oa = new ModelRouter({ provider: 'openai', key: 'k', context: 'A bakery.', fetchImpl: async (url, o) => { sent.push(JSON.parse(o.body)); return json({ answers: [{ type: 'choice', name: 'tier', choice: 'quick', confidence: 0.9 }] }); } });
  await oa.pick('Hello', { offered: seat });
  assert.ok(sent[2].input[0].content[0].text.startsWith(sent[0].state.context + ' A bakery.\n\nRequest:\nHello'));
  assert.equal(routerContext('x'.repeat(5000)).length, routerContext().length + 1001, 'capped at 1000 characters');
});

async function server(t, port, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-router-')); let logs = '';
  const secret = randomUUID(), exp = Date.now() + 3600000;
  const headers = { 'content-type': 'application/json', cookie: 'pc_auth=' + exp + '.' + createHmac('sha256', secret).update(String(exp)).digest('hex') };
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true }); fs.mkdirSync(path.join(dir, 'managed'));
  fs.writeFileSync(path.join(dir, 'managed', 'managed-settings.json'), JSON.stringify({ availableModels: ['claude-opus-5-5', 'claude-sonnet-5-5'], maxEffortLevel: 'medium' }));
  const child = spawn(process.execPath, ['server.mjs'], { cwd: repo, env: { ...cleanEnv(), POCKET_SKILLS: '0', PORT: String(port), POCKET_ENV_FILE: '', POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret,
    POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: path.join(dir, 'data'), POCKET_TEST_CALLS: path.join(dir, 'calls'), POCKET_CLAUDE_MANAGED_DIR: path.join(dir, 'managed'),
    CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'), CODEX_BIN: path.join(repo, 'test/fake-codex.mjs'), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', b => { logs += b }); child.stderr.on('data', b => { logs += b });
  t.after(async () => { if (child.exitCode === null) { const e = new Promise(r => child.once('exit', r)); child.kill(); await e; } fs.rmSync(dir, { recursive: true, force: true }); });
  for (let i = 0; i < 100; i++) { if (child.exitCode !== null) break; try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { } await sleep(30); }
  if (child.exitCode !== null) throw Error('Test server failed: ' + logs);
  const call = async (p, body) => { const r = await fetch(`http://127.0.0.1:${port}/api${p}`, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const calls = () => fs.existsSync(path.join(dir, 'calls')) ? fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  return { call, calls, logs: () => logs };
}
const waitCalls = async (s, n) => { for (let i = 0; i < 100; i++) { if (s.calls().length >= n) return s.calls(); await sleep(50); } return s.calls(); };
const waitIdle = async (s, id) => { for (let i = 0; i < 100; i++) { const r = (await s.call('/sessions')).body.sessions.find(x => x.id === id); if (r && r.state?.kind !== 'running') return; await sleep(80); } };

test('server: Assistant mode routes a typed request, the conversation keeps it, the policy caps effort, Try harder sticks', async t => {
  let tier = 'deep'; const asked = [];
  const fake = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { asked.push(JSON.parse(b)); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ answers: { tier: { choice: tier, probabilities: { [tier]: 0.9 } } } })); }); });
  await new Promise(r => fake.listen(0, '127.0.0.1', r)); t.after(() => fake.close());
  const s = await server(t, 18679, { POCKET_ASSISTANT_MODE: 'locked', POCKET_ROUTER: 'jev', POCKET_ROUTER_KEY: 'test-key', POCKET_ROUTER_URL: `http://127.0.0.1:${fake.address().port}/decisions` });

  const id = (await s.call('/new', { cwd: repo, text: 'Make a proposal from QT-10432', provider: 'claude', clientMessageId: randomUUID() })).body.id;
  let c = await waitCalls(s, 1);
  assert.equal(asked[0].state.first_message, 'Make a proposal from QT-10432');
  assert.equal(c[0].model, 'claude-opus-5-5[1m]', 'the deep tier runs Opus');
  assert.equal(c[0].effort, 'medium', 'high is capped by maxEffortLevel');
  await waitIdle(s, id);
  await s.call(`/session/${id}/message`, { text: 'And a short cover note', clientMessageId: randomUUID() });
  c = await waitCalls(s, 2);
  assert.equal(c[1].model, 'claude-opus-5-5[1m]', 'a later reply keeps the routed model'); assert.equal(asked.length, 1, 'only the first message is routed');
  await waitIdle(s, id);
  // Try harder: an explicit choice in Assistant mode is remembered for the rest of the conversation.
  await s.call(`/session/${id}/message`, { text: 'Please take another pass', model: 'claude-sonnet-5-5', effort: 'low', clientMessageId: randomUUID() });
  c = await waitCalls(s, 3); assert.equal(c[2].model, 'claude-sonnet-5-5'); assert.equal(c[2].effort, 'low');
  await waitIdle(s, id);
  await s.call(`/session/${id}/message`, { text: 'Thanks', clientMessageId: randomUUID() });
  c = await waitCalls(s, 4); assert.equal(c[3].model, 'claude-sonnet-5-5', 'the explicit choice sticks');

  // A light request: Sonnet at low effort. A router failure: the default runs.
  tier = 'quick';
  await s.call('/new', { cwd: repo, text: 'Any quotes expiring this week?', provider: 'claude', clientMessageId: randomUUID() });
  c = await waitCalls(s, 5); assert.equal(c[4].model, 'claude-sonnet-5-5'); assert.equal(c[4].effort, 'low');
  fake.close(); await sleep(50);
  await s.call('/new', { cwd: repo, text: 'What is on my calendar?', provider: 'claude', clientMessageId: randomUUID() });
  c = await waitCalls(s, 6); assert.notEqual(c[5].model, 'claude-opus-5-5[1m]', 'the router is down: the default model');
  const st = (await s.call('/settings')).body.router;
  assert.equal(st.provider, 'jev'); assert.equal(st.maxEffort, 'medium'); assert.ok(st.last.error, 'Settings shows the last failure');
});
