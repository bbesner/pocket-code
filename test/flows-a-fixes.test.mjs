// 1.124.5: faults the flow test of lane a found (review 2026-11-23, flows-a-findings.md), on the real server.mjs with the
// fake Claude Code CLI. Each test failed on the code before its fix. Ports 21180-21199, one per test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { spawn, execFileSync } from 'node:child_process';
import { createHmac, createECDH, randomBytes, randomUUID } from 'node:crypto';
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

// a-07: a background agent asks permission while no reply runs; its request holds a control-only stand-in turn. Pause all
// counted that as a running reply and killed the process (the agent with it) even with "also stops background jobs" off,
// and logged the request as answered.
test('a-07: Pause all leaves a background agent\'s waiting request alone with the switch off; with it on, it is a background job and reads Stopped', { timeout: 90_000 }, async t => {
  const s = await boot(t, 21182);
  const runnerPid = id => { const d = path.join(s.data, 'turnlogs'); return JSON.parse(fs.readFileSync(path.join(d, fs.readdirSync(d).find(f => f.startsWith(id) && f.endsWith('.runner.json'))), 'utf8')).pid; };
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const standIn = async text => {
    const id = await s.start(text, { approvalMode: 'review' });
    await s.until(() => s.logs().includes(`turn start (a background job asked for permission) session=${id}`), 10000, 'the stand-in turn');
    await s.until(async () => (await s.session(id))?.state?.label === 'Needs approval', 5000, 'Needs approval');
    return id;
  };
  // the switch off: nothing of it is counted, nothing is stopped, the request stays answerable
  assert.equal((await s.call('/automation/settings', { group: 'pause', values: { backgroundJobs: false } })).status, 200);
  const a = await standIn('switch off __BG_ASK__'), pidA = runnerPid(a);
  const would = (await s.call('/pause')).body.would;
  assert.deepEqual([would.replies.claude, would.background], [0, 0], 'not a reply running: ' + JSON.stringify(would));
  const p = await s.call('/pause', {});
  assert.equal(p.status, 200); assert.equal(p.body.stopped.replies.claude, 0, JSON.stringify(p.body.stopped));
  await sleep(1500);
  assert.ok(!s.logs().includes(`stop requested (Pause all) session=${a}`), 'not stopped as a reply');
  assert.ok(alive(pidA), 'the process, and the background agent in it, still run');
  assert.equal((await s.call(`/session/${s.e(a)}/approvals`)).body.requests.length, 1, 'the request still waits');
  assert.equal((await s.session(a)).state.label, 'Needs approval');
  assert.equal((await s.call('/resume', {})).status, 200);

  // the switch on: it counts as a background job, is stopped with it, and the conversation says Stopped
  assert.equal((await s.call('/automation/settings', { group: 'pause', values: { backgroundJobs: true } })).status, 200);
  const b = await standIn('switch on __BG_ASK__'), pidB = runnerPid(b);
  const w2 = (await s.call('/pause')).body.would;
  assert.deepEqual([w2.replies.claude, w2.background], [0, 2], 'two background jobs (both stand-ins\' agents), no reply: ' + JSON.stringify(w2));
  const p2 = await s.call('/pause', {});
  assert.deepEqual([p2.body.stopped.replies.claude, p2.body.stopped.background], [0, 2]);
  await s.until(() => s.logs().includes(`turn done (background job's request withdrawn: stopped) session=${b}`), 8000, 'the stand-in to end stopped');
  assert.ok(!s.logs().includes(`turn done (background job's request answered) session=${b}`), 'not logged as answered');
  await s.until(() => !alive(pidB), 5000, 'the process to end');
  assert.equal((await s.session(b)).state.label, 'Stopped');
});

// a-11: Inbox decisions were stamped to the second, so an Undo (or Not useful) in the same second as the decision had the
// same `at`, and the watcher's '<id>@<at>' ack for the first decision acked the second one unapplied.
test('a-11: a change to an Inbox decision in the same second gets a later stamp, so the ack of the first leaves it pending', async t => {
  const { InboxStore } = await import('../inbox.mjs');
  const dir = tmpDir(), clock = Date.parse('2026-11-20T10:00:00.100Z');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = new InboxStore(path.join(dir, 'inbox.json'), { now: () => clock });
  const e = s.add({ title: 'Gate alert', story: 'gate' });
  s.act({ action: 'resolve', id: e.id });
  const first = s.feedback().find(f => f.id === e.id);
  s.act({ action: 'restore', id: e.id }); // the same second
  const undo = s.feedback().find(f => f.id === e.id);
  assert.equal(undo.action, 'restore');
  assert.ok(Date.parse(undo.at) > Date.parse(first.at), `the Undo is stamped after the decision: ${first.at} then ${undo.at}`);
  assert.equal(s.ack([`${e.id}@${first.at}`]), 0, 'the watcher\'s ack of the decision it read does not ack the Undo');
  assert.equal(s.feedback().find(f => f.id === e.id)?.action, 'restore');
  s.act({ action: 'not_useful', id: e.id }); // again the same second
  const nu = s.feedback().find(f => f.id === e.id);
  assert.ok(Date.parse(nu.at) > Date.parse(undo.at), 'and Not useful after the Undo');
  // a digest item's chip
  const d = s.add({ kind: 'digest', title: 'Digest', text: 'x', items: [{ ref: 'a1', section: 'worth', title: 'Fence', text: 't', story: 'fence' }] });
  s.act({ action: 'resolve', id: d.id, item: 'a1' });
  const ri = s.feedback().find(f => f.id === `${d.id}/a1`);
  s.act({ action: 'restore', id: d.id, item: 'a1' });
  const ui = s.feedback().find(f => f.id === `${d.id}/a1`);
  assert.equal(ui.action, 'restore'); assert.ok(Date.parse(ui.at) > Date.parse(ri.at), `the item's Undo is stamped after: ${ri.at} then ${ui.at}`);
  assert.equal(s.ack([`${d.id}/a1@${ri.at}`]), 0);
  assert.equal(s.feedback().find(f => f.id === `${d.id}/a1`)?.action, 'restore');
});

// a-20: /api/health's busy, which the self-update waits on, and the Update press's refusal left out a side chat that was
// answering, so an update cut its answer short.
test('a-20: a side chat that is answering counts as busy for /api/health (and so for the update)', { timeout: 60_000 }, async t => {
  const dir = tmpDir(), ws = path.join(dir, 'sessions', 'test-workspace'), work = path.join(dir, 'home', 'work'), id = randomUUID();
  fs.mkdirSync(ws, { recursive: true }); fs.mkdirSync(work, { recursive: true });
  const line = o => JSON.stringify({ ...o, cwd: work, sessionId: id, timestamp: new Date().toISOString() });
  fs.writeFileSync(path.join(ws, id + '.jsonl'), [line({ type: 'user', message: { role: 'user', content: 'Plan the upgrade' } }), line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Here is the plan.' }] } })].join('\n') + '\n');
  const s = await boot(t, 21185, { dir, env: { POCKET_VOICE: 'off', POCKET_MEMSTEM: '0' } });
  const busy = async () => (await (await fetch(`http://127.0.0.1:${s.port}/api/health`)).json()).busy;
  assert.equal(await busy(), 0);
  const r = await s.call(`/session/${id}/side`, { text: 'A long answer __SIDEHANG__' });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  await s.until(async () => (await s.call(`/session/${id}/side`)).body.chat?.busy, 8000, 'the side chat to answer');
  assert.equal(await busy(), 1, 'the side chat\'s answer counts');
  assert.equal((await s.call(`/side/${r.body.side}/stop`, {})).status, 200);
  await s.until(async () => (await s.call(`/session/${id}/side`)).body.chat?.busy === false, 8000, 'the side chat to stop');
  assert.equal(await busy(), 0);
});

// A push service on this machine (as in test/checkback-routes.test.mjs): one subscribed device, every push decrypted.
// `refuseOver`: bytes of request body above which it answers 413, as a real push service does above 4096.
async function pushService(t, { refuseOver = Infinity } = {}) {
  const dir = tmpDir(), key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
  const device = createECDH('prime256v1'); device.generateKeys();
  const auth = randomBytes(16).toString('base64url'), got = [];
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      if (raw.length > refuseOver) { got.push({ refused: raw.length }); res.writeHead(413); return res.end(); }
      try { got.push(JSON.parse(ece.decrypt(raw, { version: 'aes128gcm', privateKey: device, authSecret: auth }).toString('utf8'))); }
      catch (err) { got.push({ error: err.message }); }
      res.writeHead(201); res.end();
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const vapid = webpush.generateVAPIDKeys();
  return {
    env: { VAPID_PUBLIC: vapid.publicKey, VAPID_PRIVATE: vapid.privateKey, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    seed: data => { fs.mkdirSync(data, { recursive: true }); fs.writeFileSync(path.join(data, 'push-subs.json'), JSON.stringify([{ endpoint: `https://127.0.0.1:${server.address().port}/push/device`, keys: { p256dh: device.getPublicKey('base64url'), auth } }])); },
    all: got,
  };
}
async function bootWithPush(t, port, { env = {}, refuseOver } = {}) {
  const push = await pushService(t, { refuseOver }), dir = tmpDir();
  push.seed(path.join(dir, 'data'));
  return { push, s: await boot(t, port, { dir, env: { ...push.env, ...env } }) };
}

// a-x-1: a finished Claude reply's push was titled with the transcript's raw title. In a job's conversation that is the
// job's opening line ("[cron:job-disk-check Disk check] Look at the disk…"), where the list shows the job's name.
test('a-x-1: a Claude reply\'s push is titled as the list titles the conversation (a job\'s name, a rename)', { timeout: 60_000 }, async t => {
  const { push, s } = await bootWithPush(t, 21186);
  assert.equal((await s.call('/automation/settings', { group: 'jobs', values: { jobs: true } })).status, 200);
  const k = await s.call('/jobs/keys', { name: 'disk-check', workspace: s.cwd, engine: 'claude', model: 'default', instruction: 'Look at the disk and say what grew.', access: 'full' });
  assert.equal(k.status, 201, JSON.stringify(k.body));
  const run = await fetch(`http://127.0.0.1:${s.port}/api/jobs/run`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + k.body.secret }, body: JSON.stringify({ data: 'go', wait: 20 }), signal: AbortSignal.timeout(30000) }).then(r => r.json());
  const id = run.conversation;
  assert.ok(id, JSON.stringify(run));
  await s.idle(id);
  await s.call(`/session/${s.e(id)}/pin`, { pinned: true }); // a job's rows are grouped away from the list until pinned
  const row = await s.until(async () => (await s.call('/sessions')).body.sessions.find(x => x.id === id), 8000, 'the list row');
  assert.equal(row.title, 'Disk check', 'the list shows the job\'s name');
  // a later reply in that conversation (the agent's own follow-up takes the same path), and one after a rename
  const reply = async (text, what) => {
    const n = push.all.length;
    assert.equal((await s.call(`/session/${s.e(id)}/message`, { text, approvalMode: 'full' })).status, 202);
    return s.until(() => push.all.slice(n).find(x => x.tag === id), 10000, what);
  };
  assert.equal((await reply('and what grew?', 'the reply\'s push')).title, 'Disk check');
  assert.equal((await s.call(`/session/${s.e(id)}/rename`, { name: 'Disk report' })).status, 200);
  assert.equal((await reply('and since?', 'the push after the rename')).title, 'Disk report');
});

// a-x-2: project folders are watched from boot and then once a minute. A conversation driven from a terminal in a folder
// made after that missed every write of its first minute in Pocket's mirror; opening it did not watch the folder.
test('a-x-2: the mirror of a conversation in a folder made after boot shows a new line at once', { timeout: 60_000 }, async t => {
  const s = await boot(t, 21187);
  const id = randomUUID(), folder = path.join(s.dir, 'sessions', '-home-terminal-new-project'), file = path.join(folder, id + '.jsonl');
  fs.mkdirSync(folder, { recursive: true });
  const line = (type, content) => JSON.stringify({ type, message: { role: type, content }, cwd: s.cwd, sessionId: id, uuid: randomUUID(), timestamp: new Date().toISOString() }) + '\n';
  fs.writeFileSync(file, line('user', 'Run the tests'));
  const ac = new AbortController(); t.after(() => ac.abort());
  const r = await fetch(`http://127.0.0.1:${s.port}/api/session/${id}/events?offset=${fs.statSync(file).size}`, { headers: { cookie: s.cookie }, signal: ac.signal });
  assert.equal(r.status, 200);
  let text = ''; const dec = new TextDecoder();
  (async () => { try { for await (const c of r.body) text += dec.decode(c, { stream: true }); } catch { } })();
  await s.until(() => text.includes('"type":"watch"'), 5000, 'the watch stream');
  await sleep(300);
  fs.appendFileSync(file, line('assistant', [{ type: 'text', text: 'Running the tests.' }]));
  await s.until(() => text.includes('Running the tests.'), 5000, 'the new line in the mirror');
});

// a-x-http-1: while paused, an agent may change Inbox Watch if it stays paused. Resume then read that as the owner's change
// and left Inbox Watch paused ("changed while paused"), though the owner changed nothing.
test('a-x-http-1: Resume resumes Inbox Watch when the only change while paused was an agent\'s that kept it paused', { timeout: 60_000 }, async t => {
  const s = await boot(t, 21188);
  assert.equal((await s.call('/settings', { inbox: true })).status, 200);
  assert.equal((await s.call('/pause', {})).body.stopped.inboxWatch, true);
  const cur = (await s.call('/inbox/watch', undefined, s.bearer())).body.settings;
  assert.equal(cur.paused, true);
  for (const every of [30, 45]) { // two of the agent's saves
    const r = await s.call('/inbox/watch', { settings: { ...cur, every } }, s.bearer());
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.settings.paused, true);
  }
  const res = await s.call('/resume', {});
  assert.equal(res.body.inboxWatch, 'resumed', JSON.stringify(res.body));
  const w = (await s.call('/inbox/watch')).body.settings;
  assert.deepEqual([w.paused, w.every], [false, 45], 'running, with the agent\'s settings');
  // the owner's own change while paused is still left as the owner set it
  assert.equal((await s.call('/pause', {})).body.stopped.inboxWatch, true);
  assert.equal((await s.call('/inbox/watch', { settings: { ...w, paused: true, every: 60 } })).status, 200);
  assert.equal((await s.call('/inbox/watch', { settings: { ...w, paused: true, every: 30 } }, s.bearer())).status, 200);
  assert.equal((await s.call('/resume', {})).body.inboxWatch, 'left_paused');
});
