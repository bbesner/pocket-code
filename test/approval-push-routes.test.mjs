// 1.126: answering an action approval from its notification, on the real server.mjs with the fake Claude Code, Codex,
// OpenRouter and Antigravity CLIs (docs/plans/notification-approvals.md, Testing 1-21). A push service on this machine
// takes every push for several devices, records the urgency it was sent with, and decrypts each payload, so a test reads
// exactly what each device was sent. The rules without a server are in test/approval-push.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
// every regex metacharacter, the backslash included, so a value matches only as itself
const reEscape = v => String(v).replace(/[\\^$.*+?()[\]{}|\/-]/g, '\\$&');
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { spawn, execFileSync } from 'node:child_process';
import { createHmac, createHash, createECDH, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import ece from 'http_ece';
import { killStrays } from './stray-runners.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE|OPENCODE|FAKE)_/.test(k)));
const tmpDir = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apush-')));
const deviceId = endpoint => createHash('sha256').update(endpoint).digest('hex').slice(0, 12);
const TESTED = { limit: 80, at: '2026-11-27T12:00:00.000Z' };
const LEGACY = sid => ({ title: 'Waiting for your OK', body: 'Open Pocket Code to review the pending action.', tag: sid, url: '/#/chat/' + sid });

// A push service with several devices: each has its own path and key; `fail` makes a device's push service refuse.
async function pushService(t) {
  const dir = tmpDir(), key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
  const devices = new Map(), got = [], fail = new Map(), delay = new Map(); // delay: ms a device's push service waits before it answers
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const name = req.url.split('/').pop(), d = devices.get(name);
      let payload; try { payload = JSON.parse(ece.decrypt(Buffer.concat(chunks), { version: 'aes128gcm', privateKey: d.ecdh, authSecret: d.auth }).toString('utf8')); } catch (err) { payload = { error: err.message }; }
      const status = fail.get(name) || 201;
      got.push({ device: name, urgency: req.headers.urgency || null, payload, accepted: status < 300 });
      setTimeout(() => { res.writeHead(status); res.end(); }, delay.get(name) || 0);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const vapid = webpush.generateVAPIDKeys();
  const endpoint = name => `https://127.0.0.1:${server.address().port}/push/${name}`;
  const sub = name => {
    if (!devices.has(name)) { const ecdh = createECDH('prime256v1'); ecdh.generateKeys(); devices.set(name, { ecdh, auth: randomBytes(16).toString('base64url') }); }
    const d = devices.get(name);
    return { endpoint: endpoint(name), keys: { p256dh: d.ecdh.getPublicKey('base64url'), auth: d.auth } };
  };
  return {
    env: { VAPID_PUBLIC: vapid.publicKey, VAPID_PRIVATE: vapid.privateKey, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    // rows: { name: { kinds?, approvalAllow? } }
    seed: (data, rows) => { fs.mkdirSync(data, { recursive: true }); fs.writeFileSync(path.join(data, 'push-subs.json'), JSON.stringify(Object.entries(rows).map(([name, extra]) => ({ ...sub(name), ...extra })))); },
    sub, endpoint, got, fail, delay, host: () => `127.0.0.1:${server.address().port}`,
    of: (name, tag) => got.filter(g => g.device === name && (!tag || g.payload.tag === tag)),
  };
}

// APUSH_PORT_SHIFT moves every server port, so a second copy of this file can run beside `npm test` (which runs it too)
const PORT_SHIFT = Number(process.env.APUSH_PORT_SHIFT) || 0;
async function boot(t, port, { env = {}, devices = { a: { approvalAllow: TESTED } }, dir = tmpDir(), before = null } = {}) {
  port += PORT_SHIFT;
  const push = await pushService(t);
  const home = path.join(dir, 'home'), cwd = path.join(home, 'work'), data = path.join(dir, 'data');
  for (const d of [home, cwd, path.join(home, 'pocket-uploads'), path.join(dir, 'sessions'), data]) fs.mkdirSync(d, { recursive: true });
  push.seed(data, devices);
  before?.({ dir, home, data });
  const secret = 'apush-' + port, exp = Date.now() + 3600_000;
  const cookie = 'pc_auth=' + exp + '.' + createHmac('sha256', secret).update(String(exp)).digest('hex');
  const child = spawn(process.execPath, ['server.mjs'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...cleanEnv(), HOME: home, PORT: String(port), POCKET_SKILLS: '0', POCKET_ENV_FILE: '', POCKET_AUTO_TITLES: '0', POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret,
    POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: data, POCKET_TEST_CALLS: path.join(dir, 'calls'),
    CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'), CODEX_BIN: path.join(repo, 'test/fake-codex.mjs'),
    POCKET_ACP_ENABLE: '1', POCKET_ACP_CMD: process.execPath, POCKET_ACP_ARGS: path.join(repo, 'test/fake-acp.mjs'), POCKET_ACP_STORE: path.join(dir, 'acp-store'),
    POCKET_AGY_ENABLE: '1', POCKET_AGY_CMD: path.join(repo, 'test/fake-agy.mjs'), FAKE_AGY_STORE: path.join(dir, 'agy-store'),
    POCKET_RETRY_BUFFER_MS: '0', ...push.env, ...env,
  } });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  const exited = new Promise(r => child.once('exit', r));
  t.after(async () => { try { child.kill('SIGKILL'); } catch { } await exited; killStrays(data); });
  for (let i = 0; ; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { } if (i > 300) throw new Error('server did not start: ' + logs); await sleep(30); }
  const raw = async (method, p, body, headers = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch { } return { status: r.status, body: j };
  };
  const call = (p, body, headers = { cookie }) => raw(body !== undefined ? 'POST' : 'GET', '/api' + p, body, headers);
  const e = id => encodeURIComponent(id);
  const until = async (fn, ms = 15000, what = 'condition') => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}; log tail: ${logs.slice(-2500)}`); await sleep(50); } };
  const lines = f => { try { return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
  const on = async (values = {}) => { const r = await call('/approval-push/settings', { values: { answers: true, ...values } }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
  const set = async values => { const r = await call('/approval-push/settings', { values }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
  const start = async (provider, text, extra = {}) => { const r = await call('/new', { provider, cwd, text, approvalMode: 'review', ...extra }); assert.equal(r.status, 202, JSON.stringify(r.body)); return r.body.id; };
  const reqs = (list, more = {}) => '__REQS__ ' + JSON.stringify({ reqs: list.map(([id, tool, input]) => ({ id, tool, input })), ...more });
  const toolReq = (tool, input) => '__TOOLREQ__ ' + JSON.stringify({ tool, input });
  const waiting = async (id, n = 1) => (await until(async () => { const r = (await call(`/session/${e(id)}/approvals`)).body?.requests || []; return r.length >= n ? r : null; }, 15000, `${n} approvals in ${id}`));
  const pushed = (device, reqId, n = 1) => until(() => { const l = push.of(device, 'approval:' + reqId); return l.length >= n ? l : null; }, 10000, `push of ${reqId} to ${device}`);
  const answer = (id, req, body, headers) => call(`/session/${e(id)}/approvals/${e(req)}/decision`, body, headers);
  // An answer from a device's notification. The fake push service hears a push before the server has read its 201, so the
  // answer waits until the server has recorded every original push the service accepted for that device and request (its
  // "approval push accepted" line), as a phone can only tap a notification it was shown. `wait: false` posts at once (a
  // test of a push still on its way).
  const fromNote = async (id, req, device, decision, shown, { wait = true } = {}) => {
    const n = wait ? push.of(device, 'approval:' + req).filter(g => g.accepted && g.payload.approval).length : 0;
    if (n) {
      const line = `approval push accepted session=${id} request=${req} device=${deviceId(push.endpoint(device))}\n`;
      await until(() => logs.split(line).length - 1 >= n, 10000, `the server to record ${device}'s push of ${req}`);
    }
    return answer(id, req, { decision, via: 'notification', endpoint: push.endpoint(device), ...(shown !== undefined ? { shown } : {}) });
  };
  const audit = () => lines(path.join(data, 'approval-decisions.jsonl'));
  const responses = () => lines(path.join(dir, 'calls.responses'));
  const idle = id => until(async () => { const b = (await call('/session/' + e(id))).body; return b && !b.active && b.state?.kind !== 'running' ? b : null; }, 15000, `${id} to end`);
  const bearer = () => ({ authorization: 'Bearer ' + fs.readFileSync(path.join(data, 'cli-token'), 'utf8').trim() });
  const subs = () => JSON.parse(fs.readFileSync(path.join(data, 'push-subs.json'), 'utf8'));
  const writeSubs = rows => fs.writeFileSync(path.join(data, 'push-subs.json'), JSON.stringify(rows));
  return { dir, data, home, cwd, cookie, push, raw, call, e, until, lines, on, set, start, reqs, toolReq, waiting, pushed, answer, fromNote, audit, responses, idle, bearer, subs, writeSubs, logs: () => logs };
}
const lastOf = list => list.at(-1).payload;

test('T1: feature off, every approval push is exactly 1.125.3\'s, and a notification answer gets 404 answers_off', { timeout: 120_000 }, async t => {
  const s = await boot(t, 19521, { devices: { a: { approvalAllow: TESTED }, b: { kinds: { approvals: false } } } });
  assert.equal((await s.call('/approval-push')).body.on, false);
  const runs = [
    ['claude', s.toolReq('Bash', { command: 'echo T1' })],
    ['codex', '__CMDAPPROVAL__'],
    ['acp', 'go'],
    ['antigravity', 'go'],
  ];
  for (const [engine, text] of runs) {
    const id = await s.start(engine, text);
    const [req] = await s.waiting(id);
    for (const d of ['a', 'b']) {
      const got = await s.until(() => s.push.of(d, id).at(-1), 10000, `${engine} push to ${d}`);
      assert.deepEqual(got.payload, LEGACY(id), `${engine}: today's words, tag and link, no buttons, no request`);
      assert.equal(got.urgency, 'normal', `${engine}: today's priority`);
    }
    const r = await s.fromNote(id, req.id, 'a', 'allow', 'x'.repeat(64));
    assert.equal(r.status, 404); assert.equal(r.body.code, 'answers_off');
    assert.equal((await s.fromNote(id, req.id, 'a', 'deny')).body.code, 'answers_off');
    assert.equal((await s.answer(id, req.id, { decision: 'deny' })).status, 200, 'the app answers as before');
  }
  assert.ok(!s.push.got.some(g => /^approval/.test(g.payload.tag || '')), 'no approval: tag at all');
  const refused = s.audit().filter(a => a.event === 'refused');
  assert.equal(refused.length, 8); assert.ok(refused.every(a => a.reason === 'answers_off' && a.source === 'notification'));
});

test('T2: on, a tested device gets each engine\'s command with its own tag, urgent, the lines in order and both buttons', { timeout: 120_000 }, async t => {
  const s = await boot(t, 19522, { devices: { a: { approvalAllow: TESTED }, b: { kinds: { approvals: false }, approvalAllow: TESTED }, c: {} } });
  await s.on();
  const cases = [
    ['claude', s.toolReq('Bash', { command: 'echo T2', description: 'say T2' }), 'Allow this command?', 'Runs: echo T2', 'Conversation folder: ~/work'],
    ['claude', s.toolReq('PowerShell', { command: 'Get-Date' }), 'Allow this command?', 'Runs: Get-Date', 'Conversation folder: ~/work'],
    ['claude', s.toolReq('WebFetch', { url: 'https://example.com/', prompt: 'Read it' }), 'Allow this web page?', 'Opens: https://example.com/', 'Conversation folder: ~/work'],
    ['claude', s.toolReq('WebSearch', { query: 'pocket code' }), 'Allow this web search?', 'Searches: pocket code', 'Conversation folder: ~/work'],
    ['codex', '__CXREQ__ ' + JSON.stringify({ method: 'item/commandExecution/requestApproval', params: { command: "/bin/bash -lc 'echo CX_T2'", cwd: s.cwd } }), 'Allow this command?', 'Runs: echo CX_T2', 'In: ~/work'],
    ['acp', 'go', 'Allow this command?', 'Runs: echo ACP_OK', 'Conversation folder: ~/work'], // their requests name no folder
    ['antigravity', 'go', 'Allow this command?', 'Runs: echo AGY_OK', 'Conversation folder: ~/work'],
  ];
  for (const [engine, text, wantTitle, action, folder] of cases) {
    const id = await s.start(engine, text);
    const [req] = await s.waiting(id);
    const [a] = await s.pushed('a', req.id), [c] = await s.pushed('c', req.id);
    assert.equal(a.urgency, 'high', engine);
    const p = a.payload;
    assert.equal(p.tag, 'approval:' + req.id); assert.equal(p.title, wantTitle, engine);
    assert.equal(p.url, `/#/chat/${id}?approval=${encodeURIComponent(req.id)}`);
    assert.deepEqual(p.approval.session, id); assert.equal(p.approval.request, req.id); assert.match(p.approval.shown, /^[0-9a-f]{64}$/);
    const lines = p.body.split('\n');
    assert.deepEqual(lines.slice(0, 2), [action, folder], engine);
    assert.ok(lines[2].startsWith('Conversation: '), engine); assert.equal(lines.length, 3, engine);
    assert.deepEqual(p.actions, [{ action: 'deny', title: "Don't allow" }, { action: 'allow', title: 'Allow' }], engine);
    assert.deepEqual(c.payload.actions.map(x => x.action), ['deny'], 'a device never tested: Don\'t allow only');
    assert.equal(c.payload.approval.shown, p.approval.shown, 'the same words, so the same hash');
    assert.ok(!s.push.of('b').some(g => g.payload.tag === 'approval:' + req.id), 'Action approvals off: none');
    assert.ok(!s.push.got.some(g => g.payload.tag === id), 'and no 1.125.3 push beside it');
    assert.equal((await s.answer(id, req.id, { decision: 'deny' })).status, 200);
  }
});

test('T5 and T7 (server): Claude questions push as today; a planted key appears nowhere in the payload; a Write and a Bash with an extra field offer Don\'t allow only', { timeout: 120_000 }, async t => {
  const s = await boot(t, 19523);
  await s.on();
  const q = await s.start('claude', 'ask me __QUESTION__');
  await s.until(() => s.push.of('a', q).at(-1), 10000, 'the question push');
  assert.deepEqual(s.push.of('a', q).at(-1).payload, { title: 'Claude has a question', body: 'Open Pocket Code to answer it.', tag: q, url: '/#/chat/' + q });
  const KEY = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
  for (const [tool, input, allow] of [['Bash', { command: 'gh api -H "token ' + KEY + '"' }, false], ['Write', { file_path: s.cwd + '/x', content: 'y' }, false], ['Bash', { command: 'ls', dangerouslyDisableSandbox: true }, false], ['Bash', { command: 'ls' }, true]]) {
    const id = await s.start('claude', s.toolReq(tool, input), { allowSecrets: true }); // the owner sent it anyway
    const [req] = await s.waiting(id);
    const [a] = await s.pushed('a', req.id);
    assert.equal(a.payload.actions.some(x => x.action === 'allow'), allow, tool + JSON.stringify(input));
    assert.ok(!JSON.stringify(a.payload).includes(KEY.slice(4, 24)), 'the key is not in the payload, not even in the conversation title');
    await s.answer(id, req.id, { decision: 'deny' });
  }
});

test('T9, T10 and T16: a notification Allow with the right shown reaches the engine once and is recorded with where it came from; a wrong shown is refused; the CLI token, another site and a job key are refused', { timeout: 120_000 }, async t => {
  const s = await boot(t, 19524, { devices: { a: { approvalAllow: TESTED }, b: { approvalAllow: TESTED } } });
  await s.on();
  // T10 first: a wrong shown
  const id = await s.start('claude', s.reqs([['n1', 'Bash', { command: 'echo T9-one' }], ['n2', 'Bash', { command: 'echo T9-two' }]]));
  const rows = await s.waiting(id, 2);
  const [one, two] = rows;
  const [p1] = await s.pushed('a', one.id), [p2] = await s.pushed('a', two.id);
  const wrong = await s.fromNote(id, one.id, 'a', 'allow', p2.payload.approval.shown);
  assert.equal(wrong.status, 409); assert.equal(wrong.body.code, 'changed');
  assert.equal((await s.fromNote(id, one.id, 'a', 'allow')).body.code, 'changed', 'no shown at all');
  assert.equal(s.responses().length, 0, 'nothing was sent to the engine');
  const refusedRow = s.audit().find(a => a.event === 'refused' && a.reason === 'changed');
  assert.deepEqual([refusedRow.requestId, refusedRow.source, refusedRow.device, refusedRow.pushService, refusedRow.action], [one.id, 'notification', deviceId(s.push.endpoint('a')), s.push.host(), 'command']);
  // T16: the CLI token, another site's Origin, a job key; and a via that isn't app or notification
  assert.equal((await s.answer(id, one.id, { decision: 'allow', via: 'notification', shown: p1.payload.approval.shown, endpoint: s.push.endpoint('a') }, s.bearer())).status, 401);
  assert.equal((await s.answer(id, one.id, { decision: 'allow', via: 'notification', shown: p1.payload.approval.shown, endpoint: s.push.endpoint('a') }, { cookie: s.cookie, origin: 'https://elsewhere.example' })).status, 403);
  assert.equal((await s.answer(id, one.id, { decision: 'allow' }, { cookie: s.cookie, origin: 'https://elsewhere.example' })).status, 403, 'the app too');
  assert.equal((await s.answer(id, one.id, { decision: 'allow', via: 'notification', shown: p1.payload.approval.shown }, { authorization: 'Bearer pjk_' + 'a'.repeat(43) })).status, 401);
  const voice = await s.answer(id, one.id, { decision: 'allow', via: 'voice', shown: p1.payload.approval.shown, endpoint: s.push.endpoint('a') });
  assert.equal(voice.status, 400); assert.equal(voice.body.code, 'unknown_via');
  assert.equal(s.responses().length, 0);
  // T9: the right shown, from the device it was sent to
  const ok = await s.fromNote(id, one.id, 'a', 'allow', p1.payload.approval.shown);
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.decision, 'allow');
  await s.until(() => s.responses().length === 1, 5000, 'the engine to hear it');
  assert.deepEqual(s.responses().map(r => [r.request_id, r.behavior]), [['n1', 'allow']], 'allow, once, for that request');
  const row = s.audit().find(a => a.event === 'decision' && a.requestId === one.id);
  assert.deepEqual([row.decision, row.source, row.device, row.pushService, row.action], ['allow', 'notification', deviceId(s.push.endpoint('a')), s.push.host(), 'command']);
  assert.ok(!fs.readFileSync(path.join(s.data, 'approval-decisions.jsonl'), 'utf8').includes('T9-one'), 'never the command text');
  // the other device's notification is replaced; the one that answered gets nothing new
  const rep = await s.until(() => s.push.of('b', 'approval:' + one.id)[1], 5000, 'the replacement on b');
  assert.equal(rep.payload.silent, true); assert.match(rep.payload.body, /^Allowed on another device at \d{1,2}:\d{2} [AP]M$/);
  assert.equal(s.push.of('a', 'approval:' + one.id).length, 1);
  // Answered away from the app: this Allow and the refusals, newest first, no command
  const away = (await s.call('/approval-push/answers')).body;
  assert.equal(away.days, 7);
  const allowed = away.answers.find(a => a.result === 'allowed');
  assert.deepEqual(Object.keys(allowed).sort(), ['action', 'at', 'conversation', 'device', 'kind', 'pushService', 'requestId', 'result', 'sessionId', 'source', 'where']);
  assert.deepEqual([allowed.sessionId, allowed.requestId, allowed.action, allowed.kind, allowed.source, allowed.device, allowed.where], [id, one.id, 'command', 'tool', 'notification', deviceId(s.push.endpoint('a')), s.push.host()]);
  assert.deepEqual(away.answers.filter(a => a.result === 'refused').map(a => a.reason).sort(), ['changed', 'changed', 'unknown_via']);
  assert.equal(away.answers[0].result, 'allowed', 'newest first');
  assert.ok(!JSON.stringify(away).includes('T9-'));
  // a Don't allow from the notification needs no shown
  assert.equal((await s.fromNote(id, two.id, 'b', 'deny')).status, 200);
  assert.equal((await s.call('/approval-push/answers', undefined, s.bearer())).status, 401);
});

test('T11: not_offered for a row never pushed, a push that reached no device, and a device that got Don\'t allow only', { timeout: 120_000 }, async t => {
  const s = await boot(t, 19525, { devices: { a: { approvalAllow: TESTED }, c: {} } });
  await s.on({ perConversation: 1 });
  const id = await s.start('claude', s.reqs([['m1', 'Bash', { command: 'echo T11-one' }], ['m2', 'Bash', { command: 'echo T11-two' }]]));
  const [one, two] = await s.waiting(id, 2);
  const [p1] = await s.pushed('a', one.id);
  // never pushed: the second waits behind the summary
  await s.until(() => s.push.of('a', 'approval-more:' + id)[0], 5000, 'the summary');
  const never = await s.fromNote(id, two.id, 'a', 'allow', p1.payload.approval.shown);
  assert.equal(never.status, 409); assert.equal(never.body.code, 'not_offered');
  // a device that got Don't allow only, tested afterwards: its old notification still offers nothing
  const [c1] = await s.pushed('c', one.id);
  assert.deepEqual(c1.payload.actions.map(x => x.action), ['deny']);
  s.writeSubs(s.subs().map(x => x.endpoint === s.push.endpoint('c') ? { ...x, approvalAllow: TESTED } : x));
  const late = await s.fromNote(id, one.id, 'c', 'allow', c1.payload.approval.shown);
  assert.equal(late.status, 409); assert.equal(late.body.code, 'not_offered');
  // an endpoint that isn't subscribed
  assert.equal((await s.answer(id, one.id, { decision: 'allow', via: 'notification', shown: p1.payload.approval.shown, endpoint: 'https://push.example/none' })).body.code, 'not_offered');
  assert.equal(s.responses().length, 0);
  // a push that reached no device: the push service refused it everywhere
  s.push.fail.set('a', 500); s.push.fail.set('c', 500);
  const id2 = await s.start('claude', s.toolReq('Bash', { command: 'echo T11-three' }));
  const [three] = await s.waiting(id2);
  const [p3] = await s.pushed('a', three.id);
  assert.equal(p3.accepted, false); assert.ok(p3.payload.actions.some(x => x.action === 'allow'), 'it was built with Allow');
  await sleep(200);
  const nobody = await s.fromNote(id2, three.id, 'a', 'allow', p3.payload.approval.shown);
  assert.equal(nobody.status, 409); assert.equal(nobody.body.code, 'not_offered');
  s.push.fail.clear();
  assert.equal((await s.fromNote(id, one.id, 'a', 'allow', p1.payload.approval.shown)).status, 200, 'the one that was offered still works');
  assert.deepEqual(s.audit().filter(a => a.event === 'refused').map(a => a.reason), ['not_offered', 'not_offered', 'not_offered', 'not_offered']);
});

test('T12: a change after the push takes the old Allow back (not_offered): a lower limit, Only that an action waits, the engine off, the device\'s Allow button off (the job switch is in T17)', { timeout: 180_000 }, async t => {
  const s = await boot(t, 19526);
  await s.on({ perConversation: 6 });
  const list = [1, 2, 3, 4, 5, 6].map(i => ['c' + i, 'Bash', { command: 'echo step-' + i }]);
  const id = await s.start('claude', s.reqs(list));
  const rows = await s.waiting(id, 6);
  const shown = {};
  for (const r of rows) { const [p] = await s.pushed('a', r.id); assert.ok(p.payload.actions.some(x => x.action === 'allow')); shown[r.id] = p.payload.approval.shown; }
  const refusedFor = async (r, change, undo) => {
    await change();
    const out = await s.fromNote(id, r.id, 'a', 'allow', shown[r.id]);
    assert.equal(out.status, 409, JSON.stringify(out.body)); assert.equal(out.body.code, 'not_offered');
    await undo?.();
  };
  await refusedFor(rows[0], () => s.set({ longestAction: 40 }), () => s.set({ longestAction: null }));
  await refusedFor(rows[1], () => s.set({ show: 'waits' }), () => s.set({ show: null }));
  await refusedFor(rows[2], () => s.set({ engineClaude: false }), () => s.set({ engineClaude: null }));
  await refusedFor(rows[3], () => s.call('/push/approval-allow', { endpoint: s.push.endpoint('a'), on: false }));
  assert.equal(s.responses().length, 0, 'nothing reached the engine');
  // Each change undone (the device tested again), the same old notification works: it was the change that refused it
  s.writeSubs(s.subs().map(x => ({ ...x, approvalAllow: TESTED })));
  for (const r of rows.slice(0, 4)) assert.equal((await s.fromNote(id, r.id, 'a', 'allow', shown[r.id])).status, 200, r.id);
  // Lowering the limit keeps a device on; an action longer than the new limit is what loses Allow
  assert.equal((await s.set({ longestAction: 60 })).allowButtonsOff, undefined);
  assert.equal((await s.call('/push/prefs?endpoint=' + s.e(s.push.endpoint('a')))).body.approvals.allowButton, true);
  assert.equal((await s.fromNote(id, rows[4].id, 'a', 'allow', shown[rows[4].id])).status, 200, 'Runs: echo step-5 and its folder fit in 60');
});

test('T13: past Allow works for (shortened by an env var), an Allow gets 409 too_old; Don\'t allow still works', { timeout: 120_000 }, async t => {
  const s = await boot(t, 19527, { env: { POCKET_TEST_APPROVAL_WINDOW_MS: '5000' } });
  await s.on();
  const id = await s.start('claude', s.reqs([['o1', 'Bash', { command: 'echo T13-one' }], ['o2', 'Bash', { command: 'echo T13-two' }]]));
  const [one, two] = await s.waiting(id, 2);
  const [p1] = await s.pushed('a', one.id), [p2] = await s.pushed('a', two.id);
  assert.equal((await s.fromNote(id, one.id, 'a', 'allow', p1.payload.approval.shown)).status, 200, 'inside the window');
  await sleep(5300); // a window long enough that a loaded machine answers inside it (1.5 s was not, under npm test)
  const old = await s.fromNote(id, two.id, 'a', 'allow', p2.payload.approval.shown);
  assert.equal(old.status, 409); assert.equal(old.body.code, 'too_old');
  assert.equal((await s.fromNote(id, two.id, 'a', 'deny')).status, 200, 'Don\'t allow has no window');
  assert.deepEqual(s.responses().map(r => [r.request_id, r.behavior]), [['o1', 'allow'], ['o2', 'deny']]);
});

test('T14: feature on, the app answers as today: Allow on a Codex fileChange, on a muted conversation\'s Bash request and on a row never pushed', { timeout: 120_000 }, async t => {
  const s = await boot(t, 19528);
  await s.on({ perConversation: 1 });
  const fc = await s.start('codex', '__CXREQ__ ' + JSON.stringify({ method: 'item/fileChange/requestApproval', params: {}, item: { type: 'fileChange', id: 'fc-1', status: 'inProgress', changes: [{ path: s.cwd + '/notes.txt', kind: { type: 'add' }, diff: '+hello\n' }] } }));
  const [fcReq] = await s.waiting(fc);
  const [fcPush] = await s.pushed('a', fcReq.id);
  assert.deepEqual(fcPush.payload.actions.map(x => x.action), ['deny'], 'an edit: Don\'t allow only on the notification');
  assert.equal(fcPush.payload.title, 'Allow this edit?');
  assert.equal((await s.answer(fc, fcReq.id, { decision: 'allow' })).status, 200);
  await s.until(() => s.lines(path.join(s.dir, 'calls.cxapprovals')).some(x => x.decision === 'accept'), 5000, 'codex to hear accept');
  // a muted conversation: no approval push, and the app answers
  const m = await s.start('claude', 'hello');
  await s.idle(m);
  assert.equal((await s.call(`/session/${s.e(m)}/mute`, { muted: true })).status, 200);
  assert.equal((await s.call(`/session/${s.e(m)}/message`, { text: s.toolReq('Bash', { command: 'echo T14-muted' }) })).status, 202);
  const [mReq] = await s.waiting(m);
  await sleep(500);
  assert.ok(!s.push.got.some(g => (g.payload.tag || '').includes(mReq.id) || g.payload.tag === 'approval-more:' + m), 'a muted conversation sends none');
  assert.equal((await s.answer(m, mReq.id, { decision: 'allow' })).status, 200);
  // a row never pushed (one per conversation): the app's Allow is not checked against a push
  const id = await s.start('claude', s.reqs([['q1', 'Bash', { command: 'echo T14-one' }], ['q2', 'Bash', { command: 'echo T14-two' }]]));
  const [, two] = await s.waiting(id, 2);
  await s.until(() => s.push.of('a', 'approval-more:' + id)[0], 5000, 'the summary');
  assert.equal(s.push.of('a', 'approval:' + two.id).length, 0);
  const ok = await s.answer(id, two.id, { decision: 'allow' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await s.answer(id, two.id, { decision: 'allow', via: 'app' })).body.duplicate, true, 'via: app is the app');
  assert.ok(s.audit().filter(a => a.event === 'decision').every(a => a.source === 'app' && !('device' in a)), 'app answers are recorded as the app\'s');
  assert.equal(s.audit().filter(a => a.event === 'refused').length, 0);
});

test('T15: a withdrawal, Stop, Pause all and an answer each replace the notification silently, same tag, only on the devices that got it and not the one that answered; the app then the notification is a duplicate', { timeout: 180_000 }, async t => {
  const s = await boot(t, 19529, { devices: { a: { approvalAllow: TESTED }, b: { approvalAllow: TESTED }, c: { kinds: { approvals: false } } } });
  await s.on();
  const replaced = async (reqId, devices, body) => {
    for (const d of devices) {
      const r = await s.until(() => s.push.of(d, 'approval:' + reqId)[1], 8000, `the replacement of ${reqId} on ${d}`);
      assert.equal(r.payload.silent, true); assert.equal(r.payload.actions, undefined); assert.equal(r.payload.approval, undefined);
      assert.equal(r.payload.title, 'Pocket Code');
      if (body instanceof RegExp) assert.match(r.payload.body, body); else assert.equal(r.payload.body, body);
    }
  };
  // control_cancel_request
  const w = await s.start('claude', s.reqs([['w1', 'Bash', { command: 'echo T15-w' }]], { cancel: 'w1', cancelMs: 1500 }));
  const [wReq] = await s.waiting(w);
  await s.pushed('a', wReq.id); await s.pushed('b', wReq.id);
  await replaced(wReq.id, ['a', 'b'], 'No longer waiting: the agent withdrew it');
  // Stop
  const st = await s.start('claude', s.toolReq('Bash', { command: 'echo T15-stop' }));
  const [stReq] = await s.waiting(st);
  await s.pushed('a', stReq.id); await s.pushed('b', stReq.id);
  assert.equal((await s.call(`/session/${s.e(st)}/stop`, {})).status, 200);
  await replaced(stReq.id, ['a', 'b'], 'No longer waiting: the reply was stopped');
  // Pause all
  const pa = await s.start('claude', s.toolReq('Bash', { command: 'echo T15-pause' }));
  const [paReq] = await s.waiting(pa);
  await s.pushed('a', paReq.id); await s.pushed('b', paReq.id);
  assert.equal((await s.call('/pause', {})).status, 200);
  await replaced(paReq.id, ['a', 'b'], 'No longer waiting: Pocket was paused');
  assert.equal((await s.call('/resume', {})).status, 200);
  // Don't allow from b: a's is replaced, b gets nothing more
  const dn = await s.start('claude', s.reqs([['d1', 'Bash', { command: 'echo T15-d1' }], ['d2', 'Bash', { command: 'echo T15-d2' }]]));
  const [d1, d2] = await s.waiting(dn, 2);
  const [d1a] = await s.pushed('a', d1.id); await s.pushed('b', d1.id); await s.pushed('a', d2.id); await s.pushed('b', d2.id);
  assert.equal((await s.fromNote(dn, d2.id, 'b', 'deny')).status, 200);
  await replaced(d2.id, ['a'], /^Not allowed at \d{1,2}:\d{2} [AP]M$/);
  // the app first: both devices are told; then the same answer from a notification is a duplicate
  assert.equal((await s.answer(dn, d1.id, { decision: 'allow' })).status, 200);
  await replaced(d1.id, ['a', 'b'], /^Allowed in Pocket at \d{1,2}:\d{2} [AP]M$/);
  const dup = await s.fromNote(dn, d1.id, 'a', 'allow', d1a.payload.approval.shown);
  assert.equal(dup.status, 200); assert.equal(dup.body.duplicate, true);
  await sleep(300);
  assert.equal(s.push.of('b', 'approval:' + d2.id).length, 1, 'the device that answered got no replacement');
  for (const id of [wReq.id, stReq.id, paReq.id, d1.id, d2.id]) assert.equal(s.push.of('a', 'approval:' + id).length, 2, 'one replacement each, no more');
  assert.deepEqual(s.push.of('c').filter(g => /^approval/.test(g.payload.tag || '')).map(g => g.payload), [], 'a device with Action approvals off: none of these (it still gets the finished reply, kind turns)');
});

test('T17 (server): a job\'s reply and the owner\'s later reply in its conversation offer Don\'t allow only; with Allow on a job\'s actions they offer Allow, and switching it off takes it back', { timeout: 180_000 }, async t => {
  const s = await boot(t, 19530);
  await s.on();
  assert.equal((await s.call('/automation/settings', { group: 'jobs', values: { jobs: true } })).status, 200);
  const k = await s.call('/jobs/keys', { name: 'disk-check', workspace: s.cwd, engine: 'claude', model: 'default', instruction: 'Look at the disk.', access: 'ask' });
  assert.equal(k.status, 201, JSON.stringify(k.body));
  const run = await s.raw('POST', '/api/jobs/run', { data: s.reqs([['j1', 'Bash', { command: 'echo T17-job' }]]), wait: 1 }, { authorization: 'Bearer ' + k.body.secret });
  const conv = run.body.conversation;
  assert.ok(conv, JSON.stringify(run.body));
  const [j1] = await s.waiting(conv);
  const [p] = await s.pushed('a', j1.id);
  assert.equal(p.payload.title, 'Job: Allow this command?');
  assert.deepEqual(p.payload.body.split('\n').slice(0, 2), ['Runs: echo T17-job', 'Conversation folder: ~/work']);
  assert.equal(p.payload.body.split('\n')[3], 'Started by job disk-check');
  assert.deepEqual(p.payload.actions.map(x => x.action), ['deny']);
  assert.equal((await s.answer(conv, j1.id, { decision: 'deny' })).status, 200);
  await s.idle(conv);
  // the owner's later reply in the job's conversation
  assert.equal((await s.call(`/session/${s.e(conv)}/message`, { text: s.reqs([['o1', 'Bash', { command: 'echo T17-owner' }]]), approvalMode: 'review' })).status, 202);
  const [o1] = await s.waiting(conv);
  const [po] = await s.pushed('a', o1.id);
  assert.equal(po.payload.title, 'Allow this command?');
  assert.equal(po.payload.body.split('\n')[3], 'A job has run in this conversation');
  assert.deepEqual(po.payload.actions.map(x => x.action), ['deny']);
  const refused = await s.fromNote(conv, o1.id, 'a', 'allow', po.payload.approval.shown);
  assert.equal(refused.body.code, 'not_offered');
  assert.equal((await s.answer(conv, o1.id, { decision: 'deny' })).status, 200);
  await s.idle(conv);
  // Allow on a job's actions: the owner's next reply there offers Allow; switching it off takes the old one back
  await s.set({ jobs: true });
  assert.equal((await s.call(`/session/${s.e(conv)}/message`, { text: s.reqs([['o2', 'Bash', { command: 'echo T17-on' }], ['o3', 'Bash', { command: 'echo T17-on2' }]]), approvalMode: 'review' })).status, 202);
  const [o2, o3] = await s.waiting(conv, 2);
  const [p2] = await s.pushed('a', o2.id), [p3] = await s.pushed('a', o3.id);
  assert.deepEqual(p2.payload.actions.map(x => x.action), ['deny', 'allow']);
  await s.set({ jobs: false });
  assert.equal((await s.fromNote(conv, o2.id, 'a', 'allow', p2.payload.approval.shown)).body.code, 'not_offered', 'the job switch, after the push');
  await s.set({ jobs: true });
  assert.equal((await s.fromNote(conv, o2.id, 'a', 'allow', p2.payload.approval.shown)).status, 200);
  assert.equal((await s.fromNote(conv, o3.id, 'a', 'allow', p3.payload.approval.shown)).status, 200);
  await s.idle(conv);
  // a branch of the job's conversation follows the job rule
  await s.set({ jobs: false });
  const br = await s.call(`/session/${s.e(conv)}/branch`, { text: s.reqs([['b1', 'Bash', { command: 'echo T17-branch' }]]), approvalMode: 'review' });
  assert.equal(br.status, 202, JSON.stringify(br.body));
  const [b1] = await s.waiting(br.body.id);
  const [pb] = await s.pushed('a', b1.id);
  assert.equal(pb.payload.body.split('\n')[3], 'A job has run in this conversation');
  assert.deepEqual(pb.payload.actions.map(x => x.action), ['deny']);
});

test('T18: four approvals show three with buttons and a summary; answering one shows the fourth; a trusted-rule allow sends none; a canAllow false row never gets Allow', { timeout: 120_000 }, async t => {
  const s = await boot(t, 19531, { env: { POCKET_TRUSTED_ACTIONS: 'Bash(acme-lookup:*)' } });
  await s.on();
  const text = s.reqs([1, 2, 3, 4].map(i => ['f' + i, 'Bash', { command: 'echo T18-' + i }]));
  const id = await s.start('claude', text);
  const rows = await s.waiting(id, 4);
  for (const r of rows.slice(0, 3)) await s.pushed('a', r.id);
  const sum = await s.until(() => s.push.of('a', 'approval-more:' + id)[0], 5000, 'the summary');
  assert.equal(sum.payload.title, 'Pocket Code'); assert.match(sum.payload.body, /^1 more action waits in __REQS__ /); assert.equal(sum.payload.actions, undefined);
  assert.equal(sum.urgency, 'high');
  await sleep(300);
  assert.equal(s.push.of('a', 'approval:' + rows[3].id).length, 0, 'the fourth waits');
  assert.equal((await s.answer(id, rows[0].id, { decision: 'allow' })).status, 200);
  const [fourth] = await s.pushed('a', rows[3].id);
  assert.deepEqual(fourth.payload.actions.map(x => x.action), ['deny', 'allow']);
  const sum2 = await s.until(() => s.push.of('a', 'approval-more:' + id)[1], 5000, 'the summary updated');
  assert.match(sum2.payload.body, /^Nothing more waits in /); assert.equal(sum2.payload.silent, true);
  for (const r of rows.slice(1)) await s.answer(id, r.id, { decision: 'deny' });
  // a trusted rule's allow: no card, so no push
  const tr = await s.start('claude', s.toolReq('Bash', { command: 'acme-lookup widget' }));
  await s.idle(tr);
  assert.equal((await s.call(`/session/${s.e(tr)}/approvals`)).body.requests.length, 0);
  assert.ok(!s.push.got.some(g => /^approval/.test(g.payload.tag || '') && g.payload.url?.includes(tr)), 'none for a trusted action');
  // canAllow false (the request does not offer accept): Don't allow only, and the app can't Allow it either
  const cx = await s.start('codex', '__CXREQ__ ' + JSON.stringify({ method: 'item/commandExecution/requestApproval', params: { command: 'ls', cwd: s.cwd, availableDecisions: ['decline'] } }));
  const [cr] = await s.waiting(cx);
  const [cp] = await s.pushed('a', cr.id);
  assert.deepEqual(cp.payload.actions.map(x => x.action), ['deny']);
  assert.equal((await s.fromNote(cx, cr.id, 'a', 'allow', cp.payload.approval.shown)).body.code, 'not_offered');
});

test('T19: Action approvals and Allow button per device; the test push and both codes turn Allow on; prefs and subscribe never can; raising the limit turns it off everywhere', { timeout: 120_000 }, async t => {
  const s = await boot(t, 19532, { devices: { a: {}, b: { approvalAllow: TESTED }, off: { kinds: { approvals: false }, approvalAllow: TESTED } } });
  await s.on();
  const status = async d => (await s.call('/push/prefs?endpoint=' + s.e(s.push.endpoint(d)))).body.approvals;
  assert.deepEqual(await status('a'), { subscribed: true, approvals: true, allowButton: false, testedLimit: null, testedAt: null, currentLimit: 80, retest: false });
  assert.equal((await status('off')).allowButton, false, 'Action approvals off');
  // prefs and subscribe can't turn it on
  const viaPrefs = await s.call('/push/prefs', { endpoint: s.push.endpoint('a'), kinds: { approvals: true }, approvalAllow: { limit: 240, at: 'now' }, prefs: { approvalAllow: { limit: 240 } } });
  assert.equal(viaPrefs.status, 200); assert.equal(viaPrefs.body.approvals.allowButton, false);
  const viaSub = await s.call('/push/subscribe', { subscription: { ...s.push.sub('a'), approvalAllow: { limit: 240, at: 'now' } }, prefs: { approvalAllow: { limit: 240, at: 'now' }, kinds: { approvals: true } } });
  assert.equal(viaSub.status, 200);
  assert.equal((await status('a')).allowButton, false);
  assert.ok(!('approvalAllow' in s.subs().find(x => x.endpoint === s.push.endpoint('a'))));
  assert.equal((await s.call('/push/approval-allow', { endpoint: s.push.endpoint('a'), on: true })).body.code, 'test_needed');
  // the test push, to that device only
  const sent = await s.call('/push/approval-test', { endpoint: s.push.endpoint('a') });
  assert.equal(sent.status, 200, JSON.stringify(sent.body)); assert.equal(sent.body.limit, 80);
  assert.ok(Date.parse(sent.body.expiresAt) - Date.now() > 9 * 60_000 && Date.parse(sent.body.expiresAt) - Date.now() <= 10 * 60_000);
  const tp = await s.until(() => s.push.of('a', 'approval-test')[0], 5000, 'the test push');
  assert.equal(s.push.of('b', 'approval-test').length, 0);
  assert.equal(tp.urgency, 'high'); assert.equal(tp.payload.approvalTest, true); assert.equal(tp.payload.approval, undefined);
  const [actionLine, folderLine] = tp.payload.body.split('\n');
  assert.equal(actionLine.length + folderLine.length, 80, 'exactly at the limit');
  assert.deepEqual(tp.payload.actions.map(x => x.action), ['deny', 'allow']);
  const codes = [actionLine.slice(-2), folderLine.slice(-2)];
  // one code alone, or the codes from another device's endpoint, are refused
  assert.equal((await s.call('/push/approval-test/confirm', { endpoint: s.push.endpoint('a'), actionCode: codes[0], folderCode: 'ZZ' })).body.code, 'wrong_codes');
  assert.equal((await s.call('/push/approval-test/confirm', { endpoint: s.push.endpoint('a'), actionCode: codes[0] })).body.code, 'wrong_codes');
  assert.equal((await s.call('/push/approval-test/confirm', { endpoint: s.push.endpoint('b'), actionCode: codes[0], folderCode: codes[1] })).body.code, 'test_expired');
  assert.equal((await s.call('/push/approval-test/confirm', { endpoint: s.push.endpoint('a'), actionCode: codes[0], folderCode: codes[1] }, s.bearer())).status, 401);
  const ok = await s.call('/push/approval-test/confirm', { endpoint: s.push.endpoint('a'), actionCode: codes[0].toLowerCase(), folderCode: ' ' + codes[1] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.approvals.allowButton, true); assert.equal(ok.body.approvals.testedLimit, 80);
  assert.equal((await s.call('/push/approval-test/confirm', { endpoint: s.push.endpoint('a'), actionCode: codes[0], folderCode: codes[1] })).body.code, 'test_expired', 'the codes work once');
  // five wrong tries end a test
  await s.call('/push/approval-test', { endpoint: s.push.endpoint('b') });
  for (let i = 1; i <= 5; i++) { const r = await s.call('/push/approval-test/confirm', { endpoint: s.push.endpoint('b'), actionCode: 'QQ', folderCode: 'QQ' }); assert.equal(r.body.code, 'wrong_codes'); assert.equal(Boolean(r.body.expired), i === 5); }
  // X12: after the fifth, even the right codes are refused: the test is over
  const tb = await s.until(() => s.push.of('b', 'approval-test')[0], 5000, 'b\'s test push'), [bl1, bl2] = tb.payload.body.split('\n');
  assert.equal((await s.call('/push/approval-test/confirm', { endpoint: s.push.endpoint('b'), actionCode: bl1.slice(-2), folderCode: bl2.slice(-2) })).body.code, 'test_expired');
  // a tested device gets Allow, an untested one Don't allow only, Action approvals off none
  const id = await s.start('claude', s.toolReq('Bash', { command: 'echo T19' }));
  const [req] = await s.waiting(id);
  assert.deepEqual((await s.pushed('a', req.id))[0].payload.actions.map(x => x.action), ['deny', 'allow']);
  assert.deepEqual((await s.pushed('b', req.id))[0].payload.actions.map(x => x.action), ['deny', 'allow']);
  await sleep(200);
  assert.equal(s.push.of('off', 'approval:' + req.id).length, 0);
  // lowering the limit keeps them on; raising it turns them off on every device
  assert.equal((await s.set({ longestAction: 70 })).allowButtonsOff, undefined);
  assert.equal((await status('a')).allowButton, true);
  const raised = await s.set({ longestAction: 81 });
  assert.equal(raised.allowButtonsOff, 3);
  for (const d of ['a', 'b', 'off']) assert.equal((await status(d)).allowButton, false, d);
  assert.ok(s.subs().every(x => !('approvalAllow' in x)));
  const settingsLine = s.lines(path.join(s.data, 'automation-audit.jsonl')).find(x => x.allowButtonsOff === 3);
  assert.ok(settingsLine, 'the settings change is recorded');
  // a test push started before a raise can't be used after it
  await s.call('/push/approval-test', { endpoint: s.push.endpoint('a') });
  const tp2 = await s.until(() => s.push.of('a', 'approval-test')[1], 5000, 'the second test push');
  const [al2, fl2] = tp2.payload.body.split('\n');
  assert.equal(al2.length + fl2.length, 81);
  await s.set({ longestAction: 90 });
  assert.equal((await s.call('/push/approval-test/confirm', { endpoint: s.push.endpoint('a'), actionCode: al2.slice(-2), folderCode: fl2.slice(-2) })).body.code, 'test_expired');
  // subscribing again turns it off
  await s.call('/push/approval-test', { endpoint: s.push.endpoint('a') });
  const tp3 = await s.until(() => s.push.of('a', 'approval-test')[2], 5000, 'the third test push');
  const [al3, fl3] = tp3.payload.body.split('\n');
  assert.equal((await s.call('/push/approval-test/confirm', { endpoint: s.push.endpoint('a'), actionCode: al3.slice(-2), folderCode: fl3.slice(-2) })).status, 200);
  assert.equal((await status('a')).allowButton, true);
  await s.call('/push/subscribe', { subscription: s.push.sub('a') });
  assert.equal((await status('a')).allowButton, false);
  // turning it off
  s.writeSubs(s.subs().map(x => ({ ...x, approvalAllow: { limit: 90, at: 'x' } })));
  const offed = await s.call('/push/approval-allow', { endpoint: s.push.endpoint('b'), on: false });
  assert.equal(offed.status, 200); assert.equal(offed.body.approvals.allowButton, false);
  assert.equal((await s.call('/push/approval-test', { endpoint: 'https://push.example/none' })).body.code, 'not_subscribed');
  assert.equal((await s.call('/push/approval-test', { endpoint: s.push.endpoint('a') }, { cookie: s.cookie, origin: 'https://elsewhere.example' })).status, 403);
});

test('T20 (server): Only that an action waits sends no conversation title, no action and no Allow', { timeout: 120_000 }, async t => {
  const s = await boot(t, 19533);
  await s.on({ show: 'waits' });
  const id = await s.start('claude', s.toolReq('Bash', { command: 'echo T20-secret-word' }));
  const [req] = await s.waiting(id);
  const [p] = await s.pushed('a', req.id);
  assert.equal(p.payload.title, 'Pocket Code'); assert.equal(p.payload.body, 'An action waits for your OK.');
  assert.deepEqual(p.payload.actions.map(x => x.action), ['deny']);
  assert.ok(!JSON.stringify(p.payload).includes('T20-secret-word') && !JSON.stringify(p.payload).includes('__TOOLREQ__'));
  assert.equal((await s.fromNote(id, req.id, 'a', 'allow', p.payload.approval.shown)).body.code, 'not_offered');
  assert.equal((await s.fromNote(id, req.id, 'a', 'deny')).status, 200);
});

test('T21 (server): every setting saves through the route, refuses out-of-range values, resets, takes an env preset a saved value overrides; the CLI token, a job key and another site are refused', { timeout: 120_000 }, async t => {
  const s = await boot(t, 19534, { env: { POCKET_APPROVAL_PUSH_ALLOW_FOR: '45', POCKET_APPROVAL_PUSH_LONGEST_ACTION: '999' } });
  const view = await s.call('/approval-push');
  assert.equal(view.status, 200); assert.equal(view.body.on, false); assert.equal(view.body.pushReady, true);
  const g = view.body.groups[0], byKey = Object.fromEntries(g.settings.map(x => [x.key, x]));
  assert.equal(g.key, 'approvalPush'); assert.equal(g.title, 'Answers from notifications');
  assert.deepEqual(Object.keys(byKey), ['answers', 'show', 'allowFor', 'checkbacks', 'jobs', 'engineClaude', 'engineCodex', 'engineOpenrouter', 'engineAntigravity', 'longestAction', 'perConversation', 'updateOthers']);
  assert.deepEqual([byKey.allowFor.value, byKey.allowFor.preset, byKey.allowFor.saved], [45, true, false]);
  assert.equal(byKey.longestAction.value, 80, 'a bad preset is ignored'); assert.match(view.body.warnings.join(' '), /POCKET_APPROVAL_PUSH_LONGEST_ACTION/);
  const good = { answers: true, show: 'waits', allowFor: 240, checkbacks: false, jobs: true, engineClaude: false, engineCodex: false, engineOpenrouter: false, engineAntigravity: false, longestAction: 40, perConversation: 10, updateOthers: false };
  const bad = { answers: 'yes', show: 'all', allowFor: 241, checkbacks: 'no', jobs: 1, engineClaude: 'off', engineCodex: 'false', engineOpenrouter: [], engineAntigravity: {}, longestAction: 39, perConversation: 11, updateOthers: 'x' };
  for (const [k, v] of Object.entries(good)) {
    const r = await s.call('/approval-push/settings', { values: { [k]: v } });
    assert.equal(r.status, 200, k); assert.equal(r.body.groups[0].settings.find(x => x.key === k).value, v, k);
    const b = await s.call('/approval-push/settings', { values: { [k]: bad[k] } });
    assert.equal(b.status, 400, `${k} refuses ${JSON.stringify(bad[k])}`);
  }
  const saved = JSON.parse(fs.readFileSync(path.join(s.data, 'pocket-settings.json'), 'utf8')).approvalPush;
  assert.deepEqual(saved, good, 'saved values; a refused save changed nothing');
  assert.equal((await s.call('/approval-push')).body.groups[0].settings.find(x => x.key === 'allowFor').value, 240, 'the saved value wins over the preset');
  const all = await s.call('/approval-push/settings', { values: { answers: false, allowFor: 3 } });
  assert.equal(all.status, 400); assert.equal(JSON.parse(fs.readFileSync(path.join(s.data, 'pocket-settings.json'), 'utf8')).approvalPush.answers, true, 'all or nothing');
  const reset = await s.call('/approval-push/settings', { reset: true });
  assert.equal(reset.status, 200); assert.equal(reset.body.on, false);
  assert.equal(reset.body.groups[0].settings.find(x => x.key === 'allowFor').value, 45, 'back to the preset');
  assert.ok(!('approvalPush' in JSON.parse(fs.readFileSync(path.join(s.data, 'pocket-settings.json'), 'utf8'))));
  // who may change it
  assert.equal((await s.call('/approval-push/settings', { values: { answers: true } }, s.bearer())).status, 401);
  assert.equal((await s.call('/approval-push/settings', { values: { answers: true } }, { authorization: 'Bearer pjk_' + 'a'.repeat(43) })).status, 401);
  assert.equal((await s.call('/approval-push/settings', { values: { answers: true } }, { cookie: s.cookie, origin: 'https://elsewhere.example' })).status, 403);
  assert.equal((await s.call('/approval-push/settings', { values: { answers: true } }, { cookie: s.cookie, 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await s.call('/approval-push', undefined, s.bearer())).status, 401);
  await s.call('/settings', { approvalPush: { answers: true } });
  assert.equal((await s.call('/approval-push')).body.on, false, 'the general settings route cannot set it');
});

// ---------- 1.126 review fixes, on the real server (each fails without its fix) ----------
const cxReq = (command, cwd) => '__CXREQ__ ' + JSON.stringify({ method: 'item/commandExecution/requestApproval', params: { command, cwd } });
const actionsOf = p => p.payload.actions.map(x => x.action);

test('F1 (server) and Codex end to end: a cwd with a trailing, leading or double space, a relative one and a literal ~/work offer Don\'t allow only and refuse a notification Allow; the exact folder is allowed and Codex hears accept', { timeout: 180_000 }, async t => {
  const s = await boot(t, 19535);
  await s.on();
  const cmd = "/bin/bash -lc 'make deploy'";
  for (const cwd of [s.cwd + ' ', ' ' + s.cwd, s.cwd + '  x', 'work', '~/work']) {
    const id = await s.start('codex', cxReq(cmd, cwd));
    const [req] = await s.waiting(id);
    const [p] = await s.pushed('a', req.id);
    assert.deepEqual(actionsOf(p), ['deny'], JSON.stringify(cwd));
    const r = await s.fromNote(id, req.id, 'a', 'allow', p.payload.approval.shown);
    assert.equal(r.status, 409, JSON.stringify(cwd)); assert.equal(r.body.code, 'not_offered', JSON.stringify(cwd));
    assert.equal((await s.answer(id, req.id, { decision: 'deny' })).status, 200);
  }
  assert.ok(!s.lines(path.join(s.dir, 'calls.cxapprovals')).some(x => x.decision === 'accept'), 'Codex never heard accept');
  // the exact folder: Allow from the notification reaches Codex
  const id = await s.start('codex', cxReq(cmd, s.cwd));
  const [req] = await s.waiting(id);
  const [p] = await s.pushed('a', req.id);
  assert.deepEqual(actionsOf(p), ['deny', 'allow']); assert.deepEqual(p.payload.body.split('\n').slice(0, 2), ['Runs: make deploy', 'In: ~/work']);
  const ok = await s.fromNote(id, req.id, 'a', 'allow', p.payload.approval.shown);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  await s.until(() => s.lines(path.join(s.dir, 'calls.cxapprovals')).some(x => x.decision === 'accept'), 5000, 'codex to hear accept');
  assert.equal(s.audit().find(a => a.event === 'decision' && a.requestId === req.id).source, 'notification');
});

test('ACP end to end: a notification Allow reaches OpenCode as its allow-once option', { timeout: 120_000 }, async t => {
  const s = await boot(t, 19536);
  await s.on();
  const id = await s.start('acp', 'go');
  const [req] = await s.waiting(id);
  const [p] = await s.pushed('a', req.id);
  assert.deepEqual(actionsOf(p), ['deny', 'allow']);
  assert.equal((await s.fromNote(id, req.id, 'a', 'allow', p.payload.approval.shown)).status, 200);
  const store = path.join(s.dir, 'acp-store');
  await s.until(() => fs.readdirSync(store).some(f => /"permissionOutcome":"selected"/.test(fs.readFileSync(path.join(store, f), 'utf8'))), 8000, 'OpenCode to hear the allow');
  await s.idle(id);
});

test('F8 and the request id (server): a notification answer refused inside the inbox is recorded as refused, an app answer first says answered_in_app, and a malformed request id is 400 with no record', { timeout: 120_000 }, async t => {
  const s = await boot(t, 19537, { devices: { a: { approvalAllow: TESTED }, b: { approvalAllow: TESTED } } });
  await s.on();
  const id = await s.start('claude', s.reqs([['g1', 'Bash', { command: 'echo F8-one' }], ['g2', 'Bash', { command: 'echo F8-two' }], ['g3', 'Bash', { command: 'echo F8-three' }]]));
  const [one, two, three] = await s.waiting(id, 3);
  const [p1] = await s.pushed('a', one.id); await s.pushed('a', two.id); await s.pushed('b', two.id); await s.pushed('a', three.id);
  // answered in the app, then the other answer from a notification
  assert.equal((await s.answer(id, one.id, { decision: 'deny' })).status, 200);
  const late = await s.fromNote(id, one.id, 'a', 'allow', p1.payload.approval.shown);
  assert.equal(late.status, 409); assert.equal(late.body.code, 'answered_in_app');
  // answered from one device, then the other answer from another
  assert.equal((await s.fromNote(id, two.id, 'b', 'deny')).status, 200);
  const other = await s.fromNote(id, two.id, 'a', 'allow');
  assert.equal(other.status, 409); assert.equal(other.body.code, 'answered');
  const refused = s.audit().filter(a => a.event === 'refused');
  assert.deepEqual(refused.map(a => [a.requestId, a.reason, a.source]), [[one.id, 'answered_in_app', 'notification'], [two.id, 'answered', 'notification']]);
  assert.ok(!fs.readFileSync(path.join(s.data, 'approval-decisions.jsonl'), 'utf8').includes('F8-'), 'never the command');
  const away = (await s.call('/approval-push/answers')).body.answers;
  assert.ok(away.some(a => a.requestId === one.id && a.reason === 'answered_in_app'));
  // a malformed request id: 400, nothing recorded, from the app or a notification
  const before = s.audit().length;
  for (const bad of ['nope', 'x'.repeat(300), 'a.b', one.id.toUpperCase(), one.id + 'a', 'constructor']) {
    for (const body of [{ decision: 'deny' }, { decision: 'deny', via: 'notification', endpoint: s.push.endpoint('a') }]) {
      const r = await s.answer(id, bad, body);
      assert.equal(r.status, 400, bad); assert.equal(r.body.code, 'bad_request', bad);
    }
  }
  assert.equal(s.audit().length, before, 'no record for a malformed id');
  assert.equal((await s.answer(id, three.id, { decision: 'deny' })).status, 200, 'a real id still answers');
});

test('F6 (server): a handoff from a job\'s conversation follows the job rule', { timeout: 180_000 }, async t => {
  const s = await boot(t, 19538);
  await s.on();
  assert.equal((await s.call('/automation/settings', { group: 'jobs', values: { jobs: true } })).status, 200);
  const k = await s.call('/jobs/keys', { name: 'hand-check', workspace: s.cwd, engine: 'claude', model: 'default', instruction: 'Look.', access: 'ask' });
  assert.equal(k.status, 201, JSON.stringify(k.body));
  const run = await s.raw('POST', '/api/jobs/run', { data: s.reqs([['h1', 'Bash', { command: 'echo F6-job' }]]), wait: 1 }, { authorization: 'Bearer ' + k.body.secret });
  const conv = run.body.conversation;
  assert.ok(conv, JSON.stringify(run.body));
  await s.waiting(conv);
  // the job's reply, still waiting, hands its work to a new conversation (its runner token says who asks)
  const token = await s.until(() => s.lines(path.join(s.dir, 'calls')).filter(c => c.id === conv).at(-1)?.runnerToken, 10000, 'the job reply\'s runner token');
  const made = await s.call('/start', { text: 'Carry on', directory: s.cwd, kind: 'handoff' }, { ...s.bearer(), 'x-pocket-runner': token });
  assert.ok(made.body?.id, JSON.stringify(made.body));
  const startId = made.body.id;
  const child = await s.call('/new', { provider: 'claude', cwd: s.cwd, text: s.reqs([['h2', 'Bash', { command: 'echo F6-handoff' }]]), approvalMode: 'review', start: startId });
  assert.equal(child.status, 202, JSON.stringify(child.body));
  assert.equal((await s.call('/session/' + s.e(child.body.id))).body.continuedFrom?.id, conv, 'the new conversation carries on the job\'s');
  const [h2] = await s.waiting(child.body.id);
  const [p] = await s.pushed('a', h2.id);
  assert.equal(p.payload.body.split('\n')[3], 'A job has run in this conversation');
  assert.deepEqual(actionsOf(p), ['deny'], 'Allow on a job\'s actions is off');
  assert.equal((await s.fromNote(child.body.id, h2.id, 'a', 'allow', p.payload.approval.shown)).body.code, 'not_offered');
});

test('F9, X34, X35 (server): the answers list leaves out app answers and rows older than 7 days, and says when older answers are not listed', { timeout: 120_000 }, async t => {
  const day = 86_400_000, now = Date.now();
  const row = (at, extra = {}) => JSON.stringify({ at: new Date(at).toISOString(), event: 'decision', sessionId: 's', requestId: 'r', kind: 'tool', decision: 'deny', source: 'notification', device: 'd', ...extra });
  const padRow = row(now - day, { requestId: 'p'.repeat(200) }) + '\n';
  const pad = bytes => padRow.repeat(Math.ceil(bytes / padRow.length));
  const MB = 1024 * 1024;
  const file = data => path.join(data, 'approval-decisions.jsonl');
  // a short record: an app answer, a trusted rule's, an old one and a recent one
  const s = await boot(t, 19539, { before: ({ data }) => fs.writeFileSync(file(data), [row(now - 8 * day, { requestId: 'old' }), row(now - day, { requestId: 'app', source: 'app' }), row(now - day, { requestId: 'auto', source: 'auto-trusted' }), row(now - day, { requestId: 'new' })].join('\n') + '\n') });
  let r = (await s.call('/approval-push/answers')).body;
  assert.deepEqual(r.answers.map(a => a.requestId), ['new'], 'no app answer, no row older than 7 days');
  assert.equal(r.olderNotListed, undefined);
  // the record grows past what one listing reads, every row read recent: one line says older ones are not listed
  fs.appendFileSync(file(s.data), pad(4.2 * MB));
  r = (await s.call('/approval-push/answers')).body;
  assert.equal(r.olderNotListed, true);
  assert.ok(!r.answers.some(a => a.requestId === 'new'), 'the first rows are beyond the read');
  // a new row is listed at once (the kept read is renewed when the file changes)
  fs.appendFileSync(file(s.data), row(now, { requestId: 'newest' }) + '\n');
  assert.equal((await s.call('/approval-push/answers')).body.answers[0].requestId, 'newest');
  // under 4 MB: all of it was read, nothing more to say
  fs.writeFileSync(file(s.data), row(now - 9 * day, { requestId: 'way-old' }) + '\n' + pad(3.5 * MB));
  assert.equal((await s.call('/approval-push/answers')).body.olderNotListed, undefined);
  // over 4 MB, but the oldest row read is older than 7 days: nothing more to say either
  fs.writeFileSync(file(s.data), 'x'.repeat(MB) + '\n' + row(now - 9 * day, { requestId: 'way-old' }) + '\n' + pad(3.5 * MB));
  assert.ok(fs.statSync(file(s.data)).size > 4 * MB);
  assert.equal((await s.call('/approval-push/answers')).body.olderNotListed, undefined);
});

test('F10 (server): turning answers off, or muting the conversation, replaces the notifications already out once, silently, and the summary too; then nothing more', { timeout: 180_000 }, async t => {
  const s = await boot(t, 19541, { devices: { a: { approvalAllow: TESTED }, b: { approvalAllow: TESTED } } });
  await s.on({ perConversation: 1 });
  const id = await s.start('claude', s.reqs([['k1', 'Bash', { command: 'echo F10-one' }], ['k2', 'Bash', { command: 'echo F10-two' }]]));
  const [one, two] = await s.waiting(id, 2);
  await s.pushed('a', one.id); await s.pushed('b', one.id);
  await s.until(() => s.push.of('a', 'approval-more:' + id)[0], 5000, 'the summary');
  await s.set({ answers: false });
  for (const d of ['a', 'b']) {
    const r = await s.until(() => s.push.of(d, 'approval:' + one.id)[1], 5000, 'the replacement on ' + d);
    assert.equal(r.payload.silent, true); assert.equal(r.payload.actions, undefined); assert.equal(r.payload.body, 'Answering from notifications was turned off. Open Pocket to review it.');
    const m = await s.until(() => s.push.of(d, 'approval-more:' + id)[1], 5000, 'the summary replaced on ' + d);
    assert.equal(m.payload.silent, true); assert.equal(m.payload.body, 'Answering from notifications was turned off. Open Pocket to review it.');
  }
  assert.equal(s.push.of('a', 'approval:' + two.id).length, 0, 'the second never gets one');
  // answering now sends the 1.125.3 push path only (no more approval notifications)
  assert.equal((await s.answer(id, one.id, { decision: 'deny' })).status, 200);
  await sleep(400);
  assert.equal(s.push.of('a', 'approval:' + one.id).length, 2, 'replaced once, no more');
  assert.equal(s.push.of('a', 'approval-more:' + id).length, 2);
  assert.equal(s.push.of('a', 'approval:' + two.id).length, 0);
  assert.equal((await s.answer(id, two.id, { decision: 'deny' })).status, 200);
  // muting: the same, once
  await s.on({ perConversation: 3 });
  const m = await s.start('claude', s.reqs([['u1', 'Bash', { command: 'echo F10-mute' }]]));
  const [u1] = await s.waiting(m);
  await s.pushed('a', u1.id);
  assert.equal((await s.call(`/session/${s.e(m)}/mute`, { muted: true })).status, 200);
  const r = await s.until(() => s.push.of('a', 'approval:' + u1.id)[1], 5000, 'the replacement after mute');
  assert.equal(r.payload.silent, true); assert.equal(r.payload.body, 'Notifications for this conversation were muted. Open Pocket to review it.');
  assert.equal((await s.call(`/session/${s.e(m)}/mute`, { muted: true })).status, 200);
  assert.equal((await s.answer(m, u1.id, { decision: 'deny' })).status, 200);
  await sleep(400);
  assert.equal(s.push.of('a', 'approval:' + u1.id).length, 2, 'once');
});

test('X5b (server): a check-back\'s request offers Allow while check-backs may; switching that off after the push refuses the notification Allow', { timeout: 180_000 }, async t => {
  const clock = path.join(tmpDir(), 'clock'); fs.writeFileSync(clock, '0');
  const s = await boot(t, 19542, { env: { POCKET_CHECKBACK_TICK_MS: '200', POCKET_TEST_CHECKBACK_CLOCK: clock } });
  await s.on();
  assert.equal((await s.call('/automation/settings', { group: 'checkbacks', values: { checkbacks: true, spacingSec: 0 } })).status, 200);
  const owner = await s.start('claude', 'set one __HANG__');
  const token = await s.until(() => s.lines(path.join(s.dir, 'calls')).filter(c => c.id === owner).at(-1)?.runnerToken, 10000, 'the runner token');
  const note = s.reqs([['cb1', 'Bash', { command: 'echo X5b' }]]);
  const set = await s.call('/checkbacks/agent/add', { at: '+1m', note }, { ...s.bearer(), 'x-pocket-runner': token });
  assert.equal(set.status, 201, JSON.stringify(set.body));
  assert.equal((await s.call(`/session/${s.e(owner)}/stop`, {})).status, 200);
  await s.idle(owner);
  fs.writeFileSync(clock, String(2 * 60_000));
  const [req] = await s.waiting(owner);
  const [p] = await s.pushed('a', req.id);
  assert.equal(p.payload.title, 'Check-back: Allow this command?');
  assert.equal(p.payload.body.split('\n')[3], 'Started by a check-back');
  assert.deepEqual(actionsOf(p), ['deny', 'allow']);
  await s.set({ checkbacks: false });
  const r = await s.fromNote(owner, req.id, 'a', 'allow', p.payload.approval.shown);
  assert.equal(r.status, 409); assert.equal(r.body.code, 'not_offered');
  await s.set({ checkbacks: true });
  assert.equal((await s.fromNote(owner, req.id, 'a', 'allow', p.payload.approval.shown)).status, 200);
});

test('X13, X31, B15-B19 (server): a device test expires; the CLI token and another site are refused on every device route and the settings route; the codes are never in an answer or the log, differ between tests, and a second test cancels the first', { timeout: 120_000 }, async t => {
  const s = await boot(t, 19543, { devices: { a: {}, b: {} }, env: { POCKET_TEST_APPROVAL_TEST_MS: '1200' } });
  await s.on();
  const ep = s.push.endpoint('a');
  const routes = [['/push/approval-test', { endpoint: ep }], ['/push/approval-test/confirm', { endpoint: ep, actionCode: 'AA', folderCode: 'AA' }], ['/push/approval-allow', { endpoint: ep, on: false }], ['/approval-push/settings', { values: { answers: true } }]];
  for (const [p, body] of routes) {
    assert.equal((await s.call(p, body, s.bearer())).status, 401, p + ' with the CLI token');
    assert.equal((await s.call(p, body, { cookie: s.cookie, origin: 'https://elsewhere.example' })).status, 403, p + ' from another origin');
    assert.equal((await s.call(p, body, { cookie: s.cookie, 'sec-fetch-site': 'cross-site' })).status, 403, p + ' cross-site');
  }
  assert.equal(s.push.of('a', 'approval-test').length, 0, 'none of those sent a test');
  const codesOf = g => { const [l1, l2] = g.payload.body.split('\n'); return [l1.slice(-2), l2.slice(-2)]; };
  const send = async n => { const r = await s.call('/push/approval-test', { endpoint: ep }); assert.equal(r.status, 200); return { r, codes: codesOf(await s.until(() => s.push.of('a', 'approval-test')[n], 5000, 'test push ' + n)) }; };
  // B16, B17: never in the answer or the log
  const first = await send(0);
  for (const c of first.codes) assert.ok(!new RegExp('\\b' + reEscape(c) + '\\b').test(JSON.stringify(first.r.body)), 'not in the answer');
  // B19: a second test cancels the first's codes; B18: the codes differ from one test to the next
  const second = await send(1), third = await send(2);
  assert.ok(new Set([first.codes.join(''), second.codes.join(''), third.codes.join('')]).size > 1, 'the codes change');
  if (first.codes.join('') !== third.codes.join('')) {
    const old = await s.call('/push/approval-test/confirm', { endpoint: ep, actionCode: first.codes[0], folderCode: first.codes[1] });
    assert.equal(old.body.code, 'wrong_codes', 'the first test\'s codes no longer work');
  }
  const confirm = await s.call('/push/approval-test/confirm', { endpoint: ep, actionCode: third.codes[0], folderCode: third.codes[1] });
  assert.equal(confirm.status, 200);
  for (const c of [...first.codes, ...second.codes, ...third.codes]) assert.ok(!JSON.stringify(confirm.body).includes('"' + c + '"'), 'not in the confirm answer');
  const log = s.logs();
  for (const x of [first, second, third]) assert.ok(!log.includes(x.codes.join('')) && !log.includes(x.codes[0] + ' ') && !new RegExp('code[s]?[=: ]+' + reEscape(x.codes[0])).test(log), 'not in the log');
  // X13: a test expires (here after 1.2 s)
  const fourth = await (async () => { await s.call('/push/approval-test', { endpoint: s.push.endpoint('b') }); return codesOf(await s.until(() => s.push.of('b', 'approval-test')[0], 5000, 'b test')); })();
  await sleep(1500);
  assert.equal((await s.call('/push/approval-test/confirm', { endpoint: s.push.endpoint('b'), actionCode: fourth[0], folderCode: fourth[1] })).body.code, 'test_expired');
});

test('X7, X9, X71, B13 (server): no summary to a device with Action approvals off; under Only that an action waits the summary has no title; updateOthers off sends no replacement; an answer while the push is still sending still gets its replacement', { timeout: 180_000 }, async t => {
  const s = await boot(t, 19544, { devices: { a: { approvalAllow: TESTED }, b: { approvalAllow: TESTED }, off: { kinds: { approvals: false } } } });
  await s.on({ perConversation: 1, show: 'waits' });
  const id = await s.start('claude', s.reqs([['v1', 'Bash', { command: 'echo X9-one' }], ['v2', 'Bash', { command: 'echo X9-two' }]]));
  await s.waiting(id, 2);
  const sum = await s.until(() => s.push.of('a', 'approval-more:' + id)[0], 5000, 'the summary');
  assert.equal(sum.payload.body, '1 more action waits', 'X9: no title under Only that an action waits');
  await sleep(300);
  assert.equal(s.push.of('off', 'approval-more:' + id).length, 0, 'X7: none to a device with Action approvals off');
  await s.call(`/session/${s.e(id)}/stop`, {}); await s.idle(id);
  // X71: updateOthers off, an answer replaces nothing
  await s.set({ show: null, perConversation: 3, updateOthers: false });
  const u = await s.start('claude', s.toolReq('Bash', { command: 'echo X71' }));
  const [ur] = await s.waiting(u);
  await s.pushed('a', ur.id); await s.pushed('b', ur.id);
  assert.equal((await s.answer(u, ur.id, { decision: 'deny' })).status, 200);
  await sleep(500);
  assert.equal(s.push.of('a', 'approval:' + ur.id).length, 1); assert.equal(s.push.of('b', 'approval:' + ur.id).length, 1);
  // B13: b's push service is slow; the app answers while the push is still on its way; when it lands, both are replaced
  await s.set({ updateOthers: null });
  s.push.delay.set('b', 1500);
  const w = await s.start('claude', s.toolReq('Bash', { command: 'echo B13' }));
  const [wr] = await s.waiting(w);
  await s.pushed('a', wr.id); await s.pushed('b', wr.id); // received, b not yet answered
  assert.equal((await s.answer(w, wr.id, { decision: 'deny' })).status, 200);
  for (const d of ['a', 'b']) {
    const r = await s.until(() => s.push.of(d, 'approval:' + wr.id)[1], 6000, 'the replacement on ' + d);
    assert.equal(r.payload.silent, true); assert.match(r.payload.body, /^Not allowed at /);
  }
});

test('Slow push service (server): each device is recorded as its own push service accepts; the fast device\'s Allow works while the slow one is still on its way, and the slow device\'s Allow is refused until its own push is accepted', { timeout: 120_000 }, async t => {
  const s = await boot(t, 19545, { devices: { a: { approvalAllow: TESTED }, b: { approvalAllow: TESTED } } });
  await s.on();
  s.push.delay.set('b', 4000);
  const id = await s.start('claude', s.reqs([['w1', 'Bash', { command: 'echo slow-one' }], ['w2', 'Bash', { command: 'echo slow-two' }]]));
  const [one, two] = await s.waiting(id, 2);
  const [a1] = await s.pushed('a', one.id); const [b2] = await s.pushed('b', two.id); await s.pushed('b', one.id);
  const bRecorded = r => s.logs().includes(`approval push accepted session=${id} request=${r} device=${deviceId(s.push.endpoint('b'))}`);
  // the fast device answers while b's push service has not answered yet
  const ok = await s.fromNote(id, one.id, 'a', 'allow', a1.payload.approval.shown);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(bRecorded(one.id), false, 'b was still on its way');
  // the slow device: refused while its push is on its way, allowed once its push service accepted it
  const early = await s.fromNote(id, two.id, 'b', 'allow', b2.payload.approval.shown, { wait: false });
  assert.equal(bRecorded(two.id), false, 'b was still on its way');
  assert.equal(early.status, 409); assert.equal(early.body.code, 'not_offered');
  await s.until(() => bRecorded(two.id), 8000, 'b to be recorded');
  const late = await s.fromNote(id, two.id, 'b', 'allow', b2.payload.approval.shown);
  assert.equal(late.status, 200, JSON.stringify(late.body));
  assert.match(s.logs(), new RegExp(`approval push sent \\(2 devices, Allow on 2\\) session=${reEscape(id)} request=${reEscape(two.id)}`));
});

test('Push timeout (server): a push service that does not answer in time counts as not delivered: the push finishes, the device is not recorded and its Allow is refused', { timeout: 120_000 }, async t => {
  const s = await boot(t, 19546, { devices: { a: { approvalAllow: TESTED }, b: { approvalAllow: TESTED } }, env: { POCKET_TEST_PUSH_TIMEOUT_MS: '800' } });
  await s.on();
  s.push.delay.set('b', 3000);
  const id = await s.start('claude', s.toolReq('Bash', { command: 'echo timeout' }));
  const [req] = await s.waiting(id);
  const [b] = await s.pushed('b', req.id);
  const t0 = Date.now();
  const sent = new RegExp(`approval push sent \\(1 devices, Allow on 1\\) session=${reEscape(id)} request=${reEscape(req.id)}`);
  await s.until(() => sent.test(s.logs()), 2500, 'the push to finish without b');
  assert.ok(Date.now() - t0 < 2500, 'finished before b answered');
  assert.match(s.logs(), /push not delivered to a device \(Socket timeout\) kind=approvals/);
  await sleep(2600); // b's push service answers 201 now, to a request already given up
  assert.ok(!s.logs().includes(`approval push accepted session=${id} request=${req.id} device=${deviceId(s.push.endpoint('b'))}`), 'b never recorded');
  const r = await s.fromNote(id, req.id, 'b', 'allow', b.payload.approval.shown, { wait: false });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'not_offered');
  assert.equal((await s.fromNote(id, req.id, 'a', 'allow', b.payload.approval.shown)).status, 200, 'a was recorded');
});

for (const [n, raw] of [[0, '"ls -la"'], [1, '7'], [2, 'true']]) {
  test(`ACP rawInput ${raw} (server): a request whose rawInput is not an object shows its card as before 1.126, off and on, and its notification offers Don't allow only`, { timeout: 120_000 }, async t => {
    const s = await boot(t, 19547 + n, { env: { FAKE_ACP_RAW_INPUT: raw } });
    const off = await s.start('acp', 'go');
    const [card] = await s.waiting(off);
    assert.equal(card.kind, 'command'); assert.equal(JSON.parse(card.details).command, 'echo ACP_OK');
    assert.equal((await s.answer(off, card.id, { decision: 'deny' })).status, 200);
    await s.on();
    const id = await s.start('acp', 'go');
    const [req] = await s.waiting(id);
    assert.equal(req.kind, 'command'); assert.equal(JSON.parse(req.details).command, 'echo ACP_OK');
    const [p] = await s.pushed('a', req.id);
    assert.deepEqual(actionsOf(p), ['deny']);
    const r = await s.fromNote(id, req.id, 'a', 'allow', p.payload.approval.shown);
    assert.equal(r.status, 409); assert.equal(r.body.code, 'not_offered');
    assert.equal((await s.fromNote(id, req.id, 'a', 'deny')).status, 200);
  });
}

test('Muting refuses (server): an Allow from a muted conversation\'s notification is refused not_offered and recorded, also from a device whose push landed while another was on its way; Don\'t allow still works; N47: settling does not wait for Update other devices', { timeout: 120_000 }, async t => {
  const s = await boot(t, 19550, { devices: { a: { approvalAllow: TESTED }, b: { approvalAllow: TESTED } } });
  await s.on({ updateOthers: false });
  s.push.delay.set('b', 3000);
  const id = await s.start('claude', s.reqs([['m1', 'Bash', { command: 'echo mute-one' }], ['m2', 'Bash', { command: 'echo mute-two' }]]));
  const [one, two] = await s.waiting(id, 2);
  const [p1] = await s.pushed('a', one.id); const [p2] = await s.pushed('a', two.id); await s.pushed('b', one.id);
  await s.until(() => s.logs().includes(`approval push accepted session=${id} request=${two.id} device=${deviceId(s.push.endpoint('a'))}`), 5000, 'a recorded');
  assert.equal((await s.call(`/session/${s.e(id)}/mute`, { muted: true })).status, 200);
  // b is still on its way, so these requests are not settled yet and a's record is still there: the mute alone refuses
  const r = await s.fromNote(id, one.id, 'a', 'allow', p1.payload.approval.shown);
  assert.equal(r.status, 409); assert.equal(r.body.code, 'not_offered');
  assert.equal(r.body.error, 'Notifications for this conversation are muted. Review it in Pocket.');
  const rec = s.audit().filter(a => a.event === 'refused' && a.requestId === one.id);
  assert.deepEqual(rec.map(a => [a.reason, a.source, a.device]), [['not_offered', 'notification', deviceId(s.push.endpoint('a'))]]);
  const d = await s.fromNote(id, two.id, 'a', 'deny', undefined, { wait: false });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  // N47: when b lands, both devices' notifications lose their buttons although Update other devices is off
  for (const dev of ['a', 'b']) {
    const x = await s.until(() => s.push.of(dev, 'approval:' + one.id).find(g => !g.payload.approval), 8000, 'the settle on ' + dev);
    assert.equal(x.payload.body, 'Notifications for this conversation were muted. Open Pocket to review it.'); assert.equal(x.payload.actions, undefined);
  }
  assert.equal((await s.fromNote(id, one.id, 'b', 'allow', p1.payload.approval.shown, { wait: false })).body.code, 'not_offered');
  assert.equal((await s.answer(id, one.id, { decision: 'deny' })).status, 200, 'the app still answers');
  void p2;
});

test('Off then on, mute then unmute (server): settling forgets the devices, so the old Allow is not_offered; turning answers on again or unmuting sends the requests still waiting a fresh notification once, under the per-conversation limit (N23, N24, N26)', { timeout: 180_000 }, async t => {
  const s = await boot(t, 19551, { devices: { a: { approvalAllow: TESTED }, b: { approvalAllow: TESTED } } });
  await s.on({ perConversation: 1 });
  const id = await s.start('claude', s.reqs([['o1', 'Bash', { command: 'echo on-one' }], ['o2', 'Bash', { command: 'echo on-two' }]]));
  const [one, two] = await s.waiting(id, 2);
  const [p] = await s.pushed('a', one.id);
  await s.until(() => s.push.of('a', 'approval-more:' + id)[0], 5000, 'the summary');
  const originals = (dev, r) => s.push.of(dev, 'approval:' + r).filter(g => g.payload.approval);
  // off: replaced once; on again: the old record is gone, so until the fresh push is accepted the old Allow is refused
  await s.set({ answers: false });
  await s.until(() => s.push.of('a', 'approval:' + one.id)[1], 5000, 'the settle');
  s.push.delay.set('a', 3000);
  await s.set({ answers: true });
  await s.until(() => originals('a', one.id).length === 2, 5000, 'a fresh notification for the first');
  assert.equal(s.logs().match(/approval notifications synced after turned on: .*/g).at(-1), 'approval notifications synced after turned on: 1 with requests waiting, 1 replies kept', 'the last turn-on');
  const old = await s.fromNote(id, one.id, 'a', 'allow', p.payload.approval.shown, { wait: false });
  assert.equal(old.status, 409); assert.equal(old.body.code, 'not_offered', 'the old notification offers nothing');
  // N24: the settled one did not count as showing, and the limit still holds: the second gets none, the summary says 1 more
  assert.equal(originals('a', two.id).length, 0);
  const sum = await s.until(() => s.push.of('a', 'approval-more:' + id).find((g, i) => i >= 2), 5000, 'the summary again');
  assert.equal(sum.payload.body.split('\n')[0].includes('1 more'), true, JSON.stringify(sum.payload));
  s.push.delay.delete('a');
  const fresh = await s.fromNote(id, one.id, 'a', 'allow', originals('a', one.id)[1].payload.approval.shown);
  assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
  // the second now shows; N23: muted while b's push of it is on its way, it lands without buttons
  await s.pushed('a', two.id);
  s.push.delay.set('b', 2500);
  await s.until(() => s.logs().includes(`approval push accepted session=${id} request=${two.id} device=${deviceId(s.push.endpoint('a'))}`), 5000, 'a recorded');
  assert.equal((await s.call(`/session/${s.e(id)}/mute`, { muted: true })).status, 200);
  for (const dev of ['a', 'b']) await s.until(() => s.push.of(dev, 'approval:' + two.id).find(g => !g.payload.approval), 6000, 'the settle on ' + dev);
  s.push.delay.delete('b');
  // N26: unmuting sends no "muted" words, only a fresh notification, once
  const mutedWords = () => s.push.got.filter(g => g.payload.body === 'Notifications for this conversation were muted. Open Pocket to review it.').length;
  const before = mutedWords();
  assert.equal((await s.call(`/session/${s.e(id)}/mute`, { muted: false })).status, 200);
  for (const dev of ['a', 'b']) await s.until(() => originals(dev, two.id).length === 2, 5000, 'a fresh notification on ' + dev);
  await sleep(400);
  assert.equal(mutedWords(), before, 'unmuting settles nothing');
  assert.equal(originals('a', two.id).length, 2, 'once');
  const again = originals('b', two.id)[1];
  assert.equal((await s.fromNote(id, two.id, 'b', 'allow', again.payload.approval.shown)).status, 200);
});

test('Ended while muted (server): a reply that ends while muted or off is not kept (the leak); a later turn-on syncs nothing for it', { timeout: 120_000 }, async t => {
  const s = await boot(t, 19552);
  await s.on();
  const id = await s.start('claude', s.reqs([['e1', 'Bash', { command: 'echo ended' }]]));
  const [req] = await s.waiting(id);
  await s.pushed('a', req.id);
  assert.equal((await s.call(`/session/${s.e(id)}/mute`, { muted: true })).status, 200);
  assert.equal((await s.call(`/session/${s.e(id)}/stop`, {})).status, 200); await s.idle(id);
  const off = await s.start('claude', s.reqs([['e2', 'Bash', { command: 'echo ended-off' }]]));
  await s.waiting(off);
  await s.set({ answers: false });
  assert.equal((await s.call(`/session/${s.e(off)}/stop`, {})).status, 200); await s.idle(off);
  await s.set({ answers: true });
  assert.equal(s.logs().match(/approval notifications synced after turned on: .*/g).at(-1), 'approval notifications synced after turned on: 0 with requests waiting, 0 replies kept', 'the last turn-on');
});

test('N14b (server): after the reply ended, a notification answer to a request answered in Pocket says answered_in_app; one never answered says gone', { timeout: 120_000 }, async t => {
  const s = await boot(t, 19553);
  await s.on();
  const id = await s.start('claude', s.reqs([['h1', 'Bash', { command: 'echo n14-one' }], ['h2', 'Bash', { command: 'echo n14-two' }]]));
  const [one, two] = await s.waiting(id, 2);
  const [p1] = await s.pushed('a', one.id); const [p2] = await s.pushed('a', two.id);
  assert.equal((await s.answer(id, one.id, { decision: 'deny' })).status, 200);
  assert.equal((await s.call(`/session/${s.e(id)}/stop`, {})).status, 200); await s.idle(id);
  const a = await s.fromNote(id, one.id, 'a', 'allow', p1.payload.approval.shown);
  assert.equal(a.status, 409); assert.equal(a.body.code, 'answered_in_app'); assert.equal(a.body.error, 'This action was answered in Pocket.');
  const b = await s.fromNote(id, two.id, 'a', 'allow', p2.payload.approval.shown);
  assert.equal(b.status, 409); assert.equal(b.body.code, 'gone');
});
