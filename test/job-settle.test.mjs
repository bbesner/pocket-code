// A job's run always ends (review of 1.122, findings 1, 2 and 6): a run whose reply stopped at a usage limit ends when its
// retry is dropped (the owner's message replaced it, Pause all held it and Resume did not re-arm it, Job keys went off),
// and a run that nothing carries on any more (a restart, a retry skipped) is ended by the backstop: a pass shortly after
// boot, every automation tick, and the key's busy check. None of these needs anyone to read the key's runs. A reply that
// survived the restart (its runner re-adopted) is not ended. The `finished` audit line has a fixed set of fields.
// On the real server.mjs with the fake Claude Code, Codex and OpenRouter CLIs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { killStrays } from './stray-runners.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE|OPENCODE|FAKE)_/.test(k)));
const tmpDir = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jobsettle-')));
const ENDED = {
  stopped: 'The reply stopped at a usage limit, and a message sent in its conversation replaced the retry.',
  limit: 'The reply stopped at a usage limit and was not retried.',
  jobs_off: 'The reply stopped at a usage limit, and Job keys were switched off before it was retried.',
  interrupted: 'The reply was cut off (Pocket restarted, or the agent\'s process ended) and did not finish.',
};
// The `finished` line: these fields always, cost and tokens when known, nothing else (never text from the reply or the data).
const FINISHED_FIELDS = ['action', 'at', 'endedAt', 'engine', 'event', 'keyId', 'name', 'outcome', 'run', 'sessionId', 'startedAt'];
function assertFinishedFields(line) {
  const keys = Object.keys(line).filter(k => k !== 'cost' && k !== 'tokens').sort();
  assert.deepEqual(keys, FINISHED_FIELDS, JSON.stringify(line));
  for (const k of ['cost', 'tokens']) if (k in line) assert.equal(typeof line[k], 'number', k);
}

async function boot(t, port, { dir = null, env = {} } = {}) {
  dir = dir || tmpDir();
  const home = path.join(dir, 'home'), cwd = path.join(home, 'work'), data = path.join(dir, 'data');
  for (const d of [home, cwd, path.join(home, 'pocket-uploads'), path.join(dir, 'sessions'), data]) fs.mkdirSync(d, { recursive: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  const secret = 'jobsettle-' + port, exp = Date.now() + 3600_000;
  const cookie = 'pc_auth=' + exp + '.' + createHmac('sha256', secret).update(String(exp)).digest('hex');
  const child = spawn(process.execPath, ['server.mjs'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...cleanEnv(), HOME: home, PORT: String(port), POCKET_SKILLS: '0', POCKET_ENV_FILE: '', POCKET_AUTO_TITLES: '0', POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret,
    POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: data, POCKET_TEST_CALLS: path.join(dir, 'calls'),
    CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'), CODEX_BIN: path.join(repo, 'test/fake-codex.mjs'),
    POCKET_ACP_ENABLE: '1', POCKET_ACP_CMD: process.execPath, POCKET_ACP_ARGS: path.join(repo, 'test/fake-acp.mjs'), POCKET_ACP_STORE: path.join(dir, 'acp-store'),
    POCKET_RETRY_BUFFER_MS: '0', FAKE_CLAUDE_HANG_FILE: path.join(dir, 'hang'), FAKE_ACP_NO_ASK: '1', ...env,
  } });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  const exited = new Promise(r => child.once('exit', r));
  const stop = async () => { try { child.kill('SIGKILL'); } catch { } await exited; };
  t.after(async () => { await stop(); killStrays(data); });
  for (let i = 0; ; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { } if (i > 300) throw new Error('server did not start: ' + logs); await sleep(30); }
  const raw = async (method, p, body, headers = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { }
    return { status: r.status, body: j, text };
  };
  const call = (p, body, headers = { cookie }) => raw(body !== undefined ? 'POST' : 'GET', '/api' + p, body, headers);
  const job = (key, body = {}) => raw('POST', '/api/jobs/run', body, { authorization: 'Bearer ' + key });
  const poll = (key, run) => raw('GET', `/api/jobs/runs/${run}`, undefined, { authorization: 'Bearer ' + key });
  const e = id => encodeURIComponent(id);
  const until = async (fn, ms = 15000, what = 'condition') => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}; log tail: ${logs.slice(-2500)}`); await sleep(50); } };
  const lines = f => { try { return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
  const claudeCalls = () => lines(path.join(dir, 'calls'));
  const codexCalls = () => lines(path.join(dir, 'calls.codex'));
  const audit = () => lines(path.join(data, 'automation-audit.jsonl'));
  const finished = run => audit().find(a => a.action === 'job' && a.event === 'finished' && a.run === run) || null;
  const settings = async (group, values) => { const r = await call('/automation/settings', { group, values }); assert.equal(r.status, 200, JSON.stringify(r.body)); };
  const turnOn = () => settings('jobs', { jobs: true });
  const makeKey = async (over = {}) => {
    const r = await call('/jobs/keys', { name: 'disk-check', workspace: cwd, engine: 'claude', model: 'default', instruction: 'Look at the disk and say what grew.', ...over });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return { key: r.body.key, secret: r.body.secret };
  };
  const session = id => call('/session/' + e(id)).then(r => r.body);
  const idle = id => until(async () => { const b = await session(id); return b && !b.active && b.state?.kind !== 'running' ? b : null; }, 15000, `${id} to end`);
  const waitingReset = id => until(async () => (await session(id))?.state?.label === 'Waiting for usage reset', 10000, 'the retry to be armed');
  return { dir, data, home, cwd, cookie, raw, call, job, poll, e, until, claudeCalls, codexCalls, audit, finished, settings, turnOn, makeKey, session, idle, waitingReset, stop, logs: () => logs };
}

test('A job\'s retry that is dropped ends its run: the owner\'s message (stopped), Pause all with no re-arm at Resume (limit); no read needed, the next call starts, and the finished line has fixed fields', { timeout: 120_000 }, async t => {
  const s = await boot(t, 19046, { env: { POCKET_RETRY_BUFFER_MS: '600000' } }); // the retry waits ten minutes
  await s.turnOn();
  const { secret } = await s.makeKey({ name: 'limit-job' });
  // the owner writes in the job's conversation while its retry waits: the retry is replaced, the run ends stopped
  const lim = await s.job(secret, { data: 'go __LIMIT__', wait: 1 });
  assert.equal(lim.body.status, 'working', JSON.stringify(lim.body));
  const id = lim.body.conversation;
  await s.waitingReset(id);
  assert.equal((await s.call(`/session/${s.e(id)}/message`, { text: 'never mind, I will look myself' })).status, 202);
  const line = await s.until(() => s.finished(lim.body.run), 10000, 'the run to end without a read');
  assert.equal(line.outcome, 'stopped');
  assertFinishedFields(line);
  assert.equal(line.sessionId, id); assert.equal(line.name, 'limit-job'); assert.equal(line.engine, 'claude');
  const read = (await s.poll(secret, lim.body.run)).body;
  assert.deepEqual([read.status, read.outcome, read.error], ['failed', 'stopped', ENDED.stopped]);
  await s.idle(id);
  // the key is free at once
  const next = await s.job(secret, { data: 'the next scheduled call', wait: 20 });
  assert.equal(next.status, 200, JSON.stringify(next.body)); assert.equal(next.body.status, 'done');
  assertFinishedFields(s.finished(next.body.run));
  assert.equal(s.finished(next.body.run).outcome, 'ok');
  // Pause all holds the retry; Resume with "re-arm held retries" off leaves it held for the owner and ends the run
  const lim2 = await s.job(secret, { data: 'again __LIMIT__', wait: 1 });
  await s.waitingReset(lim2.body.conversation);
  assert.equal((await s.call('/pause', {})).status, 200);
  await s.settings('pause', { rearmRetries: false });
  assert.equal(s.finished(lim2.body.run), null, 'held, the run still waits');
  assert.equal((await s.call('/resume', {})).status, 200);
  const held = await s.until(() => s.finished(lim2.body.run), 10000, 'the held run to end at Resume');
  assert.equal(held.outcome, 'limit'); assertFinishedFields(held);
  const read2 = (await s.poll(secret, lim2.body.run)).body;
  assert.deepEqual([read2.status, read2.outcome, read2.error], ['failed', 'limit', ENDED.limit]);
  assert.equal((await s.job(secret, { data: 'after Resume', wait: 20 })).body.status, 'done');
  // no line ever carries text from the data or the reply
  for (const l of s.audit().filter(a => a.action === 'job' && a.event === 'finished')) assertFinishedFields(l);
  assert.ok(!fs.readFileSync(path.join(s.data, 'automation-audit.jsonl'), 'utf8').includes('Test response'));
});

// A job's reply stops at a usage limit; another app (code-server, a terminal) adds a turn to the transcript after it, so the
// retry skips itself and nothing settles the run but the backstop. 1.124.1: a real turn, not only a newer file time, which
// Pocket's own idle close gives the file too (the next test).
async function skippedRetry(s) {
  await s.turnOn();
  const { secret } = await s.makeKey({ name: 'limit-job' });
  const lim = await s.job(secret, { data: 'go __LIMIT__', wait: 1 });
  const id = lim.body.conversation;
  await s.waitingReset(id);
  const file = path.join(s.dir, 'sessions', 'test-workspace', id + '.jsonl');
  assert.ok(fs.existsSync(file), 'the transcript');
  fs.appendFileSync(file, JSON.stringify({ type: 'user', sessionId: id, timestamp: new Date().toISOString(), message: { role: 'user', content: 'carry on from the terminal' } }) + '\n');
  await s.until(() => s.logs().includes(`retry skipped (session continued elsewhere) session=${id}`), 15000, 'the retry to skip itself');
  return { secret, run: lim.body.run, id };
}
test('A retry skipped because the conversation moved on elsewhere: the automation tick ends the run (limit) with nobody reading it; with no tick, the key\'s busy check does', { timeout: 90_000 }, async t => {
  let s = await boot(t, 19090, { env: { POCKET_AUTOMATION_TICK_MS: '300', POCKET_JOB_SETTLE_BOOT_MS: '200' } });
  let { secret, run, id } = await skippedRetry(s);
  const line = await s.until(() => s.finished(run), 10000, 'the tick to end the run');
  assert.equal(line.outcome, 'limit'); assertFinishedFields(line);
  const read = (await s.poll(secret, run)).body;
  assert.deepEqual([read.status, read.outcome, read.error], ['failed', 'limit', ENDED.limit]);
  assert.equal(s.claudeCalls().filter(c => c.id === id).length, 1, 'nothing retried');
  assert.equal((await s.job(secret, { data: 'next', wait: 20 })).body.status, 'done');
  await s.stop(); killStrays(s.data);
  // no tick (0 turns it off): only calls of the key look; the first finds the run uncarried, one 3 s later ends it
  s = await boot(t, 19090, { env: { POCKET_AUTOMATION_TICK_MS: '0', POCKET_JOB_SETTLE_BOOT_MS: '200' } });
  ({ secret, run, id } = await skippedRetry(s));
  const first = await s.job(secret, { data: 'too soon' });
  assert.equal(first.body.reason, 'busy', 'first seen with nothing carrying it on');
  await sleep(3300);
  assert.equal(s.finished(run), null, 'nothing else ended it');
  const next = await s.job(secret, { data: 'later', wait: 20 });
  assert.equal(next.body.status, 'done', JSON.stringify(next.body));
  assert.equal(s.finished(run).outcome, 'limit');
});

// 1.124.1: Pocket closes the conversation's idle process while the retry waits (an idle hour, or the process limit), and
// the CLI appends its exit bookkeeping to the transcript as it goes. Nobody continued the conversation: the retry runs
// and its reply ends the run.
test('A job\'s retry survives Pocket\'s own idle close of its process during the wait: the retry runs and the run ends ok', { timeout: 90_000 }, async t => {
  // the idle close comes 16 s after the reply (past the 15 s the old file-time test allowed), the retry 20 s after it
  const s = await boot(t, 19133, { env: { POCKET_IDLE_CLOSE_MS: '16000', POCKET_RETRY_BUFFER_MS: '20000' } });
  await s.turnOn();
  const { secret } = await s.makeKey({ name: 'limit-job' });
  const lim = await s.job(secret, { data: 'go __LIMIT__', wait: 1 });
  const id = lim.body.conversation;
  await s.waitingReset(id);
  await s.until(() => new RegExp(`session process closing session=${id} pid=\\d+ reason=idle`).test(s.logs()), 25000, 'the idle close');
  const file = path.join(s.dir, 'sessions', 'test-workspace', id + '.jsonl');
  await s.until(() => fs.readFileSync(file, 'utf8').includes('"type":"cost-state"'), 5000, 'the exit bookkeeping');
  const line = await s.until(() => s.finished(lim.body.run), 30000, 'the run to end');
  assert.ok(!s.logs().includes(`retry skipped (session continued elsewhere) session=${id}`), 'not skipped');
  assert.ok(s.claudeCalls().some(c => c.id === id && /interrupted by an API rate limit/.test(c.text)), 'the retry ran');
  assert.equal(line.outcome, 'ok'); assertFinishedFields(line);
  assert.equal((await s.poll(secret, lim.body.run)).body.status, 'done');
});

test('A restart in the middle of a run (the runners gone): the runs of Claude, Codex and OpenRouter end interrupted shortly after boot, nobody reading; the keys take the next call', { timeout: 120_000 }, async t => {
  let s = await boot(t, 19047);
  await s.turnOn();
  const keys = { claude: await s.makeKey({ name: 'cl-job' }), codex: await s.makeKey({ name: 'cx-job', engine: 'codex' }), openrouter: await s.makeKey({ name: 'or-job', engine: 'openrouter' }) };
  const runs = {};
  for (const [engine, k] of Object.entries(keys)) {
    const r = await s.job(k.secret, { data: 'long __HANG__' });
    assert.equal(r.status, 202, JSON.stringify(r.body)); runs[engine] = r.body;
  }
  await s.until(() => s.claudeCalls().some(c => c.id === runs.claude.conversation) && s.codexCalls().length, 10000, 'the replies to start');
  await sleep(800);
  await s.stop(); killStrays(s.data);
  const dir = s.dir;
  s = await boot(t, 19047, { dir, env: { POCKET_JOB_SETTLE_BOOT_MS: '1500' } });
  // nothing reads the runs, the keys or the automation summary: the boot pass alone ends them
  const ended = await s.until(() => { const l = Object.values(runs).map(r => s.finished(r.run)); return l.every(Boolean) ? l : null; }, 15000, 'the boot pass to end the runs');
  for (const l of ended) { assert.equal(l.outcome, 'interrupted'); assertFinishedFields(l); }
  for (const [engine, k] of Object.entries(keys)) {
    const read = (await s.poll(k.secret, runs[engine].run)).body;
    assert.deepEqual([read.status, read.outcome, read.error], ['failed', 'interrupted', ENDED.interrupted], engine);
    const next = await s.job(k.secret, { data: 'after the restart', wait: 20 });
    assert.equal(next.body.status, 'done', `${engine}: ${JSON.stringify(next.body)}`);
  }
});

test('A restart while a Claude reply runs on (its runner re-adopted): the run is not ended, and ends with the reply', { timeout: 120_000 }, async t => {
  let s = await boot(t, 19048);
  await s.turnOn();
  const { secret } = await s.makeKey({ name: 'cl-job' });
  const r = await s.job(secret, { data: 'long __HANG__' });
  const id = r.body.conversation;
  await s.until(() => s.claudeCalls().some(c => c.id === id), 10000, 'the reply to start');
  await s.stop(); // the runner outlives the server
  s = await boot(t, 19048, { dir: s.dir, env: { POCKET_JOB_SETTLE_BOOT_MS: '500', POCKET_AUTOMATION_TICK_MS: '300' } });
  await s.until(() => s.logs().includes(`adopted session process session=${id}`), 10000, 'the runner to be adopted');
  await sleep(4500); // past the boot settle, the orphan grace and many ticks
  assert.equal(s.finished(r.body.run), null, 'not ended');
  assert.equal((await s.poll(secret, r.body.run)).body.status, 'working');
  assert.equal((await s.job(secret, { data: 'second' })).body.reason, 'busy', 'still its one run');
  assert.equal((await s.call(`/session/${s.e(id)}/stop`, {})).status, 200);
  await s.idle(id);
  const line = await s.until(() => s.finished(r.body.run), 10000, 'the run to end with its reply');
  assertFinishedFields(line); assert.equal(line.outcome, 'stopped', 'the adopted reply kept its job (its run ends as the reply did)');
  assert.equal((await s.poll(secret, r.body.run)).body.status, 'failed');
  assert.equal((await s.job(secret, { data: 'third', wait: 20 })).body.status, 'done');
});

test('Job keys switched off while a job\'s retry waits: the retry is dropped once (not re-armed every tick), never starts, and the run ends jobs_off', { timeout: 60_000 }, async t => {
  const s = await boot(t, 19049, { env: { POCKET_AUTOMATION_TICK_MS: '1000' } });
  await s.turnOn();
  const { secret } = await s.makeKey({ name: 'limit-job' });
  const lim = await s.job(secret, { data: 'go __LIMIT__', wait: 1 });
  const id = lim.body.conversation;
  await s.waitingReset(id);
  await s.settings('jobs', { jobs: false });
  await s.until(() => s.logs().includes(`auto-resume dropped (job keys off) session=${id}`), 15000, 'the retry to be dropped');
  await sleep(3000);
  assert.ok(!s.logs().includes('auto-resume re-armed (feature_off)'), 'not re-armed');
  assert.equal(s.logs().split('\n').filter(l => l.includes(`unattended start held (feature_off) origin=retry session=${id}`)).length, 1, 'refused once');
  assert.equal(s.claudeCalls().filter(c => c.id === id).length, 1, 'the retry never started');
  const line = s.finished(lim.body.run);
  assert.ok(line, 'ended while off'); assert.equal(line.outcome, 'jobs_off'); assertFinishedFields(line);
  await s.turnOn();
  await sleep(1500);
  assert.equal(s.claudeCalls().filter(c => c.id === id).length, 1, 'nothing starts when they come back on');
  const read = (await s.poll(secret, lim.body.run)).body;
  assert.deepEqual([read.status, read.outcome, read.error], ['failed', 'jobs_off', ENDED.jobs_off]);
  assert.equal((await s.job(secret, { data: 'next', wait: 20 })).body.status, 'done');
});
