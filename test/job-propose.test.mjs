// Job keys proposed by a conversation (pocket-jobkey): an agent in a reply the owner started proposes a key; the owner reads
// the whole proposal in Settings and allows or denies it; on Allow Pocket makes the key and writes it to its key file, and
// the agent gets the file's path, never the key. On the real server.mjs with the fake Claude Code CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
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
const tmpDir = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jobpropose-')));
const OFF = { error: 'Job keys are switched off on this Pocket.', code: 'jobs_off' };
const INSTRUCTION = 'Look at the disk and say what grew. Do not delete anything. Marker-7f3a.';

async function boot(t, port, { dir = null, env = {} } = {}) {
  dir = dir || tmpDir();
  const home = path.join(dir, 'home'), cwd = path.join(home, 'work'), data = path.join(dir, 'data'), clock = path.join(dir, 'clock');
  for (const d of [home, cwd, path.join(home, 'pocket-uploads'), path.join(dir, 'sessions'), data]) fs.mkdirSync(d, { recursive: true });
  if (!fs.existsSync(clock)) fs.writeFileSync(clock, '0');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  const secret = 'jobpropose-' + port, exp = Date.now() + 3600_000;
  const cookie = 'pc_auth=' + exp + '.' + createHmac('sha256', secret).update(String(exp)).digest('hex');
  const child = spawn(process.execPath, ['server.mjs'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...cleanEnv(), HOME: home, PORT: String(port), POCKET_SKILLS: '0', POCKET_ENV_FILE: '', POCKET_AUTO_TITLES: '0', POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret,
    POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: data, POCKET_TEST_CALLS: path.join(dir, 'calls'),
    CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'), CODEX_BIN: path.join(repo, 'test/fake-codex.mjs'), POCKET_RETRY_BUFFER_MS: '0',
    POCKET_CHECKBACK_TICK_MS: '200', POCKET_TEST_CHECKBACK_CLOCK: clock, FAKE_CLAUDE_HANG_FILE: path.join(dir, 'hang'), ...env,
  } });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  const exited = new Promise(r => child.once('exit', r));
  t.after(async () => { try { child.kill('SIGKILL'); } catch { } await exited; killStrays(data); });
  for (let i = 0; ; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { } if (i > 300) throw new Error('server did not start: ' + logs); await sleep(30); }
  const seen = []; // every response body, to check the key never comes back
  const raw = async (method, p, body, headers = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await r.text(); seen.push(text);
    let j = null; try { j = JSON.parse(text); } catch { }
    return { status: r.status, body: j, text };
  };
  const call = (p, body, headers = { cookie }) => raw(body !== undefined ? 'POST' : 'GET', '/api' + p, body, headers);
  const e = id => encodeURIComponent(id);
  const until = async (fn, ms = 15000, what = 'condition') => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}; log tail: ${logs.slice(-2500)}`); await sleep(50); } };
  const lines = f => { try { return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
  const claudeCalls = () => lines(path.join(dir, 'calls'));
  const audit = () => lines(path.join(data, 'automation-audit.jsonl'));
  const cliToken = () => fs.readFileSync(path.join(data, 'cli-token'), 'utf8').trim();
  const bearer = () => ({ authorization: 'Bearer ' + cliToken() });
  const turnOn = async (values = {}) => { const r = await call('/automation/settings', { group: 'jobs', values: { jobs: true, ...values } }); assert.equal(r.status, 200, JSON.stringify(r.body)); };
  const start = async (text, extra = {}) => { const r = await call('/new', { provider: 'claude', cwd, text, approvalMode: 'full', ...extra }); assert.equal(r.status, 202, JSON.stringify(r.body)); return r.body.id; };
  const session = id => call('/session/' + e(id)).then(r => r.body);
  const row = async id => (await call('/sessions')).body.sessions.find(x => x.id === id);
  const running = id => until(async () => { const b = await session(id); return b?.state?.kind === 'running' ? b : null; }, 15000, `${id} to run`);
  const idle = id => until(async () => { const b = await session(id); return b && !b.active && b.state?.kind !== 'running' ? b : null; }, 15000, `${id} to end`);
  const stopTurn = async id => { assert.equal((await call(`/session/${e(id)}/stop`, {})).status, 200); await idle(id); };
  // The runner token of the reply whose prompt matches (the newest such call).
  const tokenFor = (id, match = () => true) => until(() => claudeCalls().filter(c => c.id === id && match(c.text || '')).at(-1)?.runnerToken, 15000, `the runner token of ${id}`);
  const propose = (token, body) => call('/jobs/agent/propose', body, { ...bearer(), ...(token ? { 'x-pocket-runner': token } : {}) });
  const request = (token, id, wait = 0) => call(`/jobs/agent/requests/${e(id)}${wait ? '?wait=' + wait : ''}`, undefined, { ...bearer(), 'x-pocket-runner': token });
  const answer = (id, body, headers) => call(`/jobs/requests/${e(id)}/answer`, body, headers);
  const fields = (over = {}) => ({ name: 'disk-check', instruction: INSTRUCTION, workspace: cwd, access: 'ask', ...over });
  return { dir, data, home, cwd, cookie, raw, call, e, until, claudeCalls, audit, cliToken, bearer, turnOn, start, session, row, running, idle, stopTurn, tokenFor, propose, request, answer, fields, seen, clock, logs: () => logs };
}
// A push service on this machine (as in test/job-routes.test.mjs): one subscribed device, every push decrypted.
async function pushService(t) {
  const dir = tmpDir(), key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
  const device = createECDH('prime256v1'); device.generateKeys();
  const auth = randomBytes(16).toString('base64url'), got = [];
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { got.push(JSON.parse(ece.decrypt(Buffer.concat(chunks), { version: 'aes128gcm', privateKey: device, authSecret: auth }).toString('utf8'))); }
      catch (err) { got.push({ error: err.message }); }
      res.writeHead(201); res.end();
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const vapid = webpush.generateVAPIDKeys();
  return {
    env: { VAPID_PUBLIC: vapid.publicKey, VAPID_PRIVATE: vapid.privateKey, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    seed: (data, kinds) => { fs.mkdirSync(data, { recursive: true }); fs.writeFileSync(path.join(data, 'push-subs.json'), JSON.stringify([{ endpoint: `https://127.0.0.1:${server.address().port}/push/device`, keys: { p256dh: device.getPublicKey('base64url'), auth }, ...(kinds ? { kinds } : {}) }])); },
    tagged: tag => got.filter(m => m.tag === tag),
    all: got,
  };
}
async function bootWithPush(t, port, { env = {}, kinds } = {}) {
  const push = await pushService(t), dir = tmpDir();
  push.seed(path.join(dir, 'data'), kinds);
  return { push, s: await boot(t, port, { dir, env: { ...push.env, ...env } }) };
}
// pocket-jobkey as an agent runs it: inside a conversation (its runner token), in the conversation's folder.
function jobkey(s, args, { token, env = {}, input = null } = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(repo, 'scripts/pocket-jobkey.mjs'), ...args], { cwd: s.cwd, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, HOME: s.home, POCKET_DATA_DIR: s.data, POCKET_ENV_FILE: '', ...(token ? { POCKET_RUNNER_TOKEN: token } : {}), ...env } });
    let out = '', err = '';
    child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
    if (input != null) child.stdin.end(input);
    child.on('exit', code => resolve({ code, out, err }));
  });
}
// pocket-run as cron would run it.
function pocketRun(s, args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(repo, 'scripts/pocket-run.mjs'), ...args], { cwd: '/', stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', HOME: s.home, POCKET_DATA_DIR: s.data, POCKET_ENV_FILE: '' } });
    let out = '', err = '';
    child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
    child.on('exit', code => resolve({ code, out, err }));
  });
}

test('Off by default: every proposal route says off and the skill is not installed; on installs it, off removes it', { timeout: 60_000 }, async t => {
  const s = await boot(t, 19041, { env: { POCKET_SKILLS: '1' } });
  const skill = path.join(s.home, '.claude', 'skills', 'pocket-jobs');
  assert.ok(!fs.existsSync(skill), 'no skill while off');
  const agent = { ...s.bearer(), 'x-pocket-runner': 'not-a-token' };
  for (const [p, body, headers] of [['/jobs/agent/propose', s.fields(), agent], ['/jobs/agent/requests/jp-00000000', undefined, agent], ['/jobs/requests/jp-00000000/answer', { answer: 'allow' }, undefined]]) {
    const r = await s.call(p, body, headers);
    assert.equal(r.status, 404, p); assert.deepEqual(r.body, OFF, p);
  }
  assert.equal((await s.call('/automation')).body.jobs.requests, 0);
  await s.turnOn();
  const text = fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8');
  assert.match(text, /On this server, run `pocket-jobkey` as `node .*scripts\/pocket-jobkey\.mjs`/);
  assert.match(text, /^name: pocket-jobs$/m);
  assert.ok(fs.existsSync(path.join(skill, '.pocket-managed')));
  assert.equal((await s.call('/automation/settings', { group: 'jobs', reset: true })).status, 200);
  assert.ok(!fs.existsSync(skill), 'the skill is removed when job keys go off');
  assert.deepEqual((await s.call('/jobs/agent/propose', s.fields(), agent)).body, OFF);
});

test('Propose, allow, deny: only the conversation\'s agent proposes; the owner sees all of it; Allow writes the key file and the agent gets its path, never the key', { timeout: 180_000 }, async t => {
  const { s, push } = await bootWithPush(t, 19042);
  await s.turnOn();
  // a key the owner made already: its name is taken
  const made = await s.call('/jobs/keys', { name: 'nightly-report', workspace: s.cwd, engine: 'claude', instruction: 'Summarise the night.' });
  assert.equal(made.status, 201);
  const a = await s.start('owner asks for a job __HANG__'), ta = await s.tokenFor(a);
  // who may call: not the cookie, not the CLI token alone, not a token Pocket never gave, not a job key
  let r = await s.call('/jobs/agent/propose', s.fields());
  assert.deepEqual([r.status, r.body.code], [403, 'agent_only'], 'the owner\'s cookie');
  r = await s.propose(null, s.fields());
  assert.deepEqual([r.status, r.body.code], [403, 'no_runner'], 'the CLI token without a runner token');
  assert.match(r.body.error, /works only inside a Pocket conversation/);
  r = await s.propose('not-a-token', s.fields());
  assert.deepEqual([r.status, r.body.code], [403, 'no_runner']);
  r = await s.call('/jobs/agent/propose', s.fields(), { authorization: 'Bearer ' + made.body.secret, 'x-pocket-runner': ta });
  assert.equal(r.status, 401, 'a job key is not the CLI token');
  // what a proposal may carry, and the owner's create checks
  r = await s.propose(ta, s.fields({ save: true, folder: '~/elsewhere/' }));
  assert.deepEqual([r.status, r.body.code], [400, 'bad_field']); assert.match(r.body.error, /not save, folder/);
  r = await s.propose(ta, s.fields({ id: made.body.key.id }));
  assert.deepEqual([r.status, r.body.code], [400, 'bad_field'], 'no change to an existing key');
  r = await s.propose(ta, s.fields({ name: 'nightly-report' }));
  assert.deepEqual([r.status, r.body.code], [409, 'name_taken'], 'a key\'s name');
  r = await s.propose(ta, s.fields({ name: 'Bad Name' }));
  assert.deepEqual([r.status, r.body.code], [400, 'bad_name']);
  r = await s.propose(ta, s.fields({ instruction: '  ' }));
  assert.deepEqual([r.status, r.body.code], [400, 'instruction_required']);
  r = await s.propose(ta, s.fields({ engine: 'antigravity' }));
  assert.deepEqual([r.status, r.body.code], [400, 'attended_only']);
  // proposed: pending, nothing made
  const keyFolder = path.join(s.home, '.config/pocket/jobs');
  r = await s.propose(ta, s.fields({ limits: { perHour: 4 } }));
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body).sort(), ['expiresAt', 'request', 'status']);
  assert.equal(r.body.status, 'pending'); assert.match(r.body.request, /^jp-[0-9a-f]{8}$/);
  assert.ok(Math.abs(Date.parse(r.body.expiresAt) - Date.now() - 24 * 3600_000) < 10_000, 'expires in 24 hours');
  const reqA = r.body.request;
  let list = (await s.call('/jobs/keys')).body;
  assert.deepEqual(list.keys.map(k => k.name), ['nightly-report'], 'no key was made');
  assert.ok(!fs.existsSync(path.join(keyFolder, 'disk-check.key')), 'no key file');
  // the owner's list: the whole proposal
  assert.equal(list.requests.length, 1);
  const shown = list.requests[0];
  assert.deepEqual(Object.keys(shown).sort(), ['expiresAt', 'fields', 'id', 'proposedAt', 'session', 'sessionTitle']);
  assert.deepEqual([shown.id, shown.session, shown.fields.instruction, shown.fields.name, shown.fields.engine, shown.fields.access, shown.fields.workspace], [reqA, a, INSTRUCTION, 'disk-check', 'claude', 'ask', s.cwd]);
  assert.deepEqual(shown.fields.limits, { perHour: 4, perDay: 24, atOnce: 1 });
  assert.deepEqual([shown.fields.mayAddInstructions, shown.fields.pushWhenDone, shown.fields.model, shown.fields.effort], [false, true, 'default', null]);
  assert.ok(!('enabled' in shown.fields));
  assert.equal(typeof shown.sessionTitle, 'string');
  assert.equal((await s.call('/automation')).body.jobs.requests, 1);
  // the conversation waits on the owner: its row and its view say so
  assert.deepEqual((await s.row(a)).jobKeyRequest, { id: reqA, name: 'disk-check', proposedAt: shown.proposedAt, expiresAt: shown.expiresAt });
  assert.equal((await s.session(a)).jobKeyRequest.id, reqA);
  // the push: the Vault requests kind, no Allow or Deny on it, opening Settings at the request
  const pushed = await s.until(() => push.tagged('jobkey:' + reqA)[0], 10000, 'the request push');
  assert.equal(pushed.title, 'Allow a job key?');
  assert.match(pushed.body, /asks for a job key: disk-check\./);
  assert.equal(pushed.url, '/#/settings/jobs/request/' + reqA);
  assert.ok(!('actions' in pushed), 'no action buttons');
  assert.ok(!pushed.body.includes('Marker-7f3a'), 'not the instruction');
  // one per conversation; the name of a waiting proposal is taken; another conversation can't read this one
  r = await s.propose(ta, s.fields({ name: 'second-job' }));
  assert.deepEqual([r.status, r.body.code], [409, 'conversation_limit']); assert.match(r.body.error, new RegExp(`pocket-jobkey wait ${reqA}`));
  const b = await s.start('owner b __HANG__'), tb = await s.tokenFor(b);
  r = await s.propose(tb, s.fields());
  assert.deepEqual([r.status, r.body.code], [409, 'name_taken'], 'a waiting proposal\'s name');
  r = await s.request(tb, reqA);
  assert.deepEqual([r.status, r.body.code], [404, 'not_found'], 'another conversation\'s request');
  r = await s.request(ta, reqA);
  assert.deepEqual([r.status, r.body], [202, { status: 'pending', request: reqA, expiresAt: shown.expiresAt }]);
  // the CLI token and a job key can't list or answer; nor a cross-site post
  for (const headers of [s.bearer(), { ...s.bearer(), 'x-pocket-runner': ta }, { authorization: 'Bearer ' + made.body.secret }]) {
    assert.equal((await s.call('/jobs/keys', undefined, headers)).status, 401);
    assert.equal((await s.answer(reqA, { answer: 'allow' }, headers)).status, 401);
  }
  assert.equal((await s.answer(reqA, { answer: 'allow' }, { cookie: s.cookie, 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.deepEqual([(await s.answer(reqA, { answer: 'maybe' })).body.code], ['bad_answer']);
  assert.equal((await s.call('/jobs/keys')).body.keys.length, 1, 'nothing was made by those');
  // the key file can't be written: nothing is made, the request stays pending and carries the error
  const file = path.join(keyFolder, 'disk-check.key');
  fs.mkdirSync(keyFolder, { recursive: true }); fs.writeFileSync(file, 'not a key\n');
  r = await s.answer(reqA, { answer: 'allow' });
  assert.deepEqual([r.status, r.body.code, r.body.request.id, r.body.request.error.code], [409, 'file_exists', reqA, 'file_exists']);
  assert.ok(!('key' in r.body) && !('secret' in r.body));
  list = (await s.call('/jobs/keys')).body;
  assert.deepEqual([list.keys.length, list.requests[0].id, list.requests[0].error.code], [1, reqA, 'file_exists'], 'no key; still pending, with the error');
  assert.equal((await s.request(ta, reqA)).body.status, 'pending');
  assert.equal(fs.readFileSync(file, 'utf8'), 'not a key\n', 'the file is left as it was');
  fs.unlinkSync(file);
  // the owner edits two fields and allows
  const seenFrom = s.seen.length;
  r = await s.answer(reqA, { answer: 'allow', fields: { ...shown.fields, instruction: 'Look at the disk and list the three largest folders.', limits: { perHour: 2, perDay: 24, atOnce: 1 } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body).sort(), ['edited', 'file', 'key', 'ok', 'request', 'status']);
  assert.deepEqual(r.body.edited, ['instruction', 'limits']);
  assert.equal(r.body.file, file);
  assert.equal(r.body.key.name, 'disk-check'); assert.equal(r.body.key.instruction, 'Look at the disk and list the three largest folders.');
  assert.deepEqual(r.body.key.limits, { perHour: 2, perDay: 24, atOnce: 1 }); assert.equal(r.body.key.keyFile, file);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'the key file is 0600');
  const secret = fs.readFileSync(file, 'utf8').trim(), hash = createHash('sha256').update(secret).digest('hex');
  assert.match(secret, /^pjk_[A-Za-z0-9_-]{43}$/);
  // the agent's answer: the path, the fields that changed; never the key
  r = await s.request(ta, reqA, 5);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { status: 'allowed', request: reqA, key: { id: list.keys.length ? (await s.call('/jobs/keys')).body.keys.find(k => k.name === 'disk-check').id : null, name: 'disk-check' }, file, edited: true, changed: ['instruction', 'limits'] });
  assert.ok(!('jobKeyRequest' in (await s.row(a))), 'no longer waiting');
  assert.deepEqual((await s.answer(reqA, { answer: 'deny' })).body.code, 'request_allowed', 'answered once');
  // deny: nothing made; the agent hears it
  r = await s.propose(tb, s.fields({ name: 'nightly-check' }));
  assert.equal(r.status, 202);
  const reqB = r.body.request;
  r = await s.answer(reqB, { answer: 'deny' });
  assert.deepEqual([r.status, r.body.status, r.body.request.id], [200, 'denied', reqB]);
  assert.deepEqual((await s.call('/jobs/keys')).body.keys.map(k => k.name).sort(), ['disk-check', 'nightly-report']);
  assert.ok(!fs.existsSync(path.join(keyFolder, 'nightly-check.key')));
  r = await s.request(tb, reqB);
  assert.deepEqual([r.status, r.body], [200, { status: 'denied', request: reqB, reason: 'The owner denied it. No key was made.' }]);
  const answered = (await s.call('/jobs/keys')).body.answered;
  assert.deepEqual(answered.map(x => [x.id, x.status]), [[reqB, 'denied'], [reqA, 'allowed']]);
  // five waiting per install
  const more = [];
  for (const n of ['c', 'd', 'e', 'f']) { const id = await s.start(`owner ${n} __HANG__`); more.push({ id, token: await s.tokenFor(id) }); }
  for (const [i, who] of [{ token: ta }, { token: tb }, ...more.slice(0, 3)].entries()) assert.equal((await s.propose(who.token, s.fields({ name: 'job-' + i }))).status, 202, 'proposal ' + i);
  r = await s.propose(more[3].token, s.fields({ name: 'job-5' }));
  assert.deepEqual([r.status, r.body.code], [409, 'install_limit']); assert.match(r.body.error, /already has 5 job key proposals waiting/);
  assert.equal((await s.call('/automation')).body.jobs.requests, 5);
  // the key and its hash appear nowhere: no response, no log line, no audit line
  for (const text of [...s.seen.slice(seenFrom), s.logs(), fs.readFileSync(path.join(s.data, 'automation-audit.jsonl'), 'utf8')]) {
    assert.ok(!text.includes(secret), 'the key');
    assert.ok(!text.includes(hash), 'its hash');
  }
  // the audit: field names, never the instruction
  const lines = s.audit().filter(x => x.action === 'job');
  const allowed = lines.find(x => x.event === 'proposal_allowed');
  assert.deepEqual([allowed.request, allowed.session, allowed.name, allowed.edited], [reqA, a, 'disk-check', ['instruction', 'limits']]);
  assert.ok(allowed.fields.includes('instruction'));
  assert.ok(lines.some(x => x.event === 'created' && x.request === reqA));
  assert.ok(lines.some(x => x.event === 'proposed' && x.request === reqA && x.session === a));
  assert.ok(lines.some(x => x.event === 'proposal_denied' && x.request === reqB));
  assert.ok(lines.some(x => x.event === 'proposal_refused' && x.reason === 'install_limit'));
  assert.ok(lines.some(x => x.event === 'proposal_refused' && x.reason === 'name_taken' && x.name === 'nightly-report'));
  assert.ok(!JSON.stringify(s.audit()).includes('Marker-7f3a') && !JSON.stringify(s.audit()).includes('three largest'), 'no instruction text in the audit');
});

test('Replies the owner didn\'t start can\'t propose: a job, a check-back and the queue are refused, and say who started them', { timeout: 180_000 }, async t => {
  const s = await boot(t, 19043);
  await s.turnOn();
  assert.equal((await s.call('/automation/settings', { group: 'checkbacks', values: { checkbacks: true, spacingSec: 0 } })).status, 200);
  // a job's reply
  const key = await s.call('/jobs/keys', { name: 'disk-check', workspace: s.cwd, engine: 'claude', instruction: 'Hold on. __HANG__' });
  assert.equal(key.status, 201);
  const run = await s.raw('POST', '/api/jobs/run', { data: 'disk at 91%' }, { authorization: 'Bearer ' + key.body.secret, 'content-type': 'application/json' });
  assert.equal(run.status, 202, JSON.stringify(run.body));
  const jobConv = run.body.conversation;
  let r = await s.propose(await s.tokenFor(jobConv), s.fields({ name: 'from-job' }));
  assert.deepEqual([r.status, r.body.code], [403, 'not_owner_reply']);
  assert.match(r.body.error, /^Only a reply the owner started can propose a job key\. This reply was started by job disk-check\./);
  await s.stopTurn(jobConv);
  // a check-back's reply
  const owner = await s.start('owner sets a check-back __HANG__'), to = await s.tokenFor(owner);
  const cb = await s.call('/checkbacks/agent/add', { at: '+1m', note: 'Look again __HANG__' }, { ...s.bearer(), 'x-pocket-runner': to });
  assert.equal(cb.status, 201, JSON.stringify(cb.body));
  await s.stopTurn(owner);
  fs.writeFileSync(s.clock, String(61_000));
  const tc = await s.tokenFor(owner, x => /^\[Pocket check-back · /.test(x));
  r = await s.propose(tc, s.fields({ name: 'from-checkback' }));
  assert.deepEqual([r.status, r.body.code], [403, 'not_owner_reply']); assert.match(r.body.error, /This reply was started by a check-back\./);
  await s.stopTurn(owner);
  // a queued message
  const q = await s.start('queue host __SLOW__');
  await s.running(q);
  assert.equal((await s.call(`/session/${s.e(q)}/message`, { text: 'queued one __HANG__', mode: 'queue', approvalMode: 'full' })).status, 202);
  r = await s.propose(await s.tokenFor(q, x => x === 'queued one __HANG__'), s.fields({ name: 'from-queue' }));
  assert.deepEqual([r.status, r.body.code], [403, 'not_owner_reply']); assert.match(r.body.error, /This reply was started by the queue \(a queued message\)\./);
  await s.stopTurn(q);
  // a reply that ended: nothing from the owner to act on
  const done = await s.start('quick owner reply'); await s.idle(done);
  r = await s.propose(await s.tokenFor(done), s.fields({ name: 'after-the-end' }));
  assert.deepEqual([r.status, r.body.code], [409, 'no_reply']);
  assert.deepEqual((await s.call('/jobs/keys')).body.requests, [], 'none was proposed');
  assert.equal(s.audit().filter(x => x.event === 'proposal_refused' && x.reason === 'not_owner_reply').length, 3);
});

test('Full access off refuses full; a device with Vault requests off gets no push; unanswered, it expires once after the time limit', { timeout: 120_000 }, async t => {
  const { s, push } = await bootWithPush(t, 19044, { kinds: { vault: false }, env: { POCKET_ALLOW_FULL_ACCESS: '0', POCKET_JOB_REQUEST_TTL_MS: '2500' } });
  await s.turnOn();
  const a = await s.start('owner asks __HANG__', { approvalMode: 'review' }), ta = await s.tokenFor(a);
  let r = await s.propose(ta, s.fields({ access: 'full' }));
  assert.deepEqual([r.status, r.body.code], [403, 'full_access_off']);
  // 1.125.2: with no access, the proposal follows the default for new keys, which is Ask first where Full access is off
  r = await s.propose(ta, s.fields({ access: undefined }));
  assert.equal(r.status, 202);
  const id = r.body.request;
  assert.equal((await s.call('/jobs/keys')).body.requests.find(x => x.id === id).fields.access, 'ask');
  assert.ok(Date.parse(r.body.expiresAt) - Date.now() < 3000, 'the shortened time');
  // the expiry pass marks it, once, without any read
  await s.until(() => s.audit().some(x => x.event === 'proposal_expired'), 15000, 'the expiry pass');
  for (let i = 0; i < 3; i++) await s.request(ta, id);
  assert.equal(s.audit().filter(x => x.event === 'proposal_expired').length, 1, 'audited once');
  r = await s.request(ta, id);
  assert.deepEqual([r.status, r.body.status, r.body.reason], [200, 'expired', 'Nobody answered in time, so it expired. No key was made.']);
  r = await s.answer(id, { answer: 'allow' });
  assert.deepEqual([r.status, r.body.code], [409, 'request_expired']);
  const list = (await s.call('/jobs/keys')).body;
  assert.deepEqual([list.keys.length, list.requests.length, list.answered[0].status], [0, 0, 'expired']);
  assert.ok(!('jobKeyRequest' in (await s.row(a))));
  assert.equal(push.all.filter(m => String(m.tag || '').startsWith('jobkey:')).length, 0, 'the push is the Vault requests kind');
});

test('pocket-jobkey: 6 while it waits, 0 with the key file\'s path once allowed (never the key), 7 when denied; the key runs with pocket-run', { timeout: 180_000 }, async t => {
  const s = await boot(t, 19045);
  await s.turnOn();
  const a = await s.start('owner asks for a nightly job __HANG__'), ta = await s.tokenFor(a);
  const instr = path.join(s.dir, 'instruction.txt');
  fs.writeFileSync(instr, 'Read the data and say in one line how full the disk is.');
  // outside a conversation
  let r = await jobkey(s, ['propose', '--name', 'disk-check', '--instruction-file', instr]);
  assert.equal(r.code, 1); assert.match(r.err, /works only inside a Pocket conversation/);
  // proposed: pending
  r = await jobkey(s, ['propose', '--name', 'disk-check', '--instruction-file', instr, '--access', 'ask', '--per-hour', '3'], { token: ta });
  assert.equal(r.code, 6, r.err);
  const id = /^pending (jp-[0-9a-f]{8})$/m.exec(r.err)?.[1];
  assert.ok(id, r.err);
  assert.match(r.err, /Tell the user it waits for their Allow in Settings → Features → Job keys/);
  assert.match(r.err, new RegExp(`pocket-jobkey wait ${id}`));
  const shown = (await s.call('/jobs/keys')).body.requests[0];
  assert.deepEqual([shown.fields.workspace, shown.fields.engine, shown.fields.limits.perHour], [s.cwd, 'claude', 3], 'the folder it ran in, the conversation\'s agent');
  assert.equal((await jobkey(s, ['status', id], { token: ta })).code, 6);
  assert.equal((await jobkey(s, ['wait', id, '--wait', '1'], { token: ta })).code, 6);
  // allowed while the agent waits
  const waiting = jobkey(s, ['wait', id, '--wait', '30'], { token: ta });
  await sleep(500);
  assert.equal((await s.answer(id, { answer: 'allow' })).status, 200);
  r = await waiting;
  assert.equal(r.code, 0, r.err);
  const file = path.join(s.home, '.config/pocket/jobs/disk-check.key');
  assert.equal(r.out.split('\n')[0], `Allowed. Key file: ${file}`);
  assert.match(r.out, new RegExp(`^Run it: node \\S+/scripts/pocket-run\\.mjs --key-file ${file.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} --data-file <file>$`, 'm'));
  const secret = fs.readFileSync(file, 'utf8').trim();
  assert.ok(!r.out.includes(secret) && !r.err.includes(secret), 'never the key');
  r = await jobkey(s, ['status', id, '--json'], { token: ta });
  assert.equal(r.code, 0); assert.ok(!r.out.includes(secret)); assert.equal(JSON.parse(r.out).file, file);
  // end to end: the key made this way runs with pocket-run
  const data = path.join(s.dir, 'data.txt'); fs.writeFileSync(data, '/var/log is at 91%');
  const ran = await pocketRun(s, ['--key-file', file, '--data-file', data, '--wait', '30']);
  assert.equal(ran.code, 0, ran.err);
  assert.ok(ran.out.trim().length > 0, 'the reply');
  const runs = (await s.call(`/jobs/keys/${(await s.call('/jobs/keys')).body.keys[0].id}/runs`)).body.runs;
  assert.deepEqual(runs.map(x => x.status), ['done']);
  const prompt = s.claudeCalls().find(c => c.id === runs[0].conversation)?.text || '';
  assert.match(prompt, /^\[cron:job-disk-check Disk check\] \nRead the data and say in one line how full the disk is\./);
  // denied: 7
  const b = await s.start('owner b __HANG__'), tb = await s.tokenFor(b);
  r = await jobkey(s, ['propose', '--name', 'nightly-check', '--instruction-file', instr], { token: tb });
  assert.equal(r.code, 6);
  const idB = /^pending (jp-[0-9a-f]{8})$/m.exec(r.err)[1];
  assert.equal((await s.answer(idB, { answer: 'deny' })).status, 200);
  r = await jobkey(s, ['wait', idB], { token: tb });
  assert.equal(r.code, 7); assert.equal(r.err.trim(), 'Denied: The owner denied it. No key was made.');
  // a refusal from the server: 1, with its words
  r = await jobkey(s, ['propose', '--name', 'disk-check', '--instruction-file', instr], { token: tb });
  assert.equal(r.code, 1); assert.match(r.err, /There is already a job key named "disk-check"/);
  // job keys off: 5
  assert.equal((await s.call('/automation/settings', { group: 'jobs', values: { jobs: false } })).status, 200);
  r = await jobkey(s, ['status', idB], { token: tb });
  assert.equal(r.code, 5); assert.match(r.err, /Job keys are switched off/);
});

// 1.124.4 (bug review of 2026-11-23): test/store-fault.mjs, loaded into the server, fails the nth save of job-keys.json
// counted from when the rule was written. An Allow saves: 1 the key, 2 its file's path, 3 the request as allowed.
test('1.124.4: an Allow whose key or request could not be saved undoes the key and its file, keeps the request pending with the reason, and a second Allow makes it', { timeout: 90_000 }, async t => {
  const dir = tmpDir(), ctl = path.join(dir, 'store-fault');
  const s = await boot(t, 19056, { dir, env: { NODE_OPTIONS: '--import ' + path.join(repo, 'test/store-fault.mjs'), STORE_FAULT_FILE: ctl } });
  await s.turnOn();
  const a = await s.start('owner asks for a nightly job __HANG__'), ta = await s.tokenFor(a);
  let r = await s.propose(ta, s.fields());
  assert.equal(r.status, 202, JSON.stringify(r.body));
  const id = r.body.request, file = path.join(s.home, '.config/pocket/jobs/disk-check.key');
  for (const [n, what] of [[3, 'the request as allowed'], [2, 'the key file\'s path']]) {
    fs.writeFileSync(ctl, JSON.stringify({ store: 'job-keys.json', nth: n, times: 1, what }));
    r = await s.answer(id, { answer: 'allow' });
    fs.rmSync(ctl, { force: true });
    assert.equal(r.status, 500, `${what}: ${r.text}`);
    assert.deepEqual([r.body.code, r.body.error, r.body.request?.id, r.body.request?.error?.code], ['file_error', 'The key could not be saved: ENOSPC. Nothing was created.', id, 'file_error'], what);
    const list = (await s.call('/jobs/keys')).body;
    assert.deepEqual([list.keys.length, list.requests.map(q => q.id)], [0, [id]], `${what}: no key; the request still pending`);
    assert.ok(!fs.existsSync(file), `${what}: no key file`);
    assert.equal((await s.request(ta, id)).body.status, 'pending', `${what}: the agent still waits`);
  }
  r = await s.answer(id, { answer: 'allow' });
  assert.equal(r.status, 200, 'a second Allow makes it: ' + r.text);
  assert.equal(r.body.file, file);
  assert.equal((await s.request(ta, id)).body.status, 'allowed');
  assert.equal((await s.call('/jobs/keys')).body.keys.length, 1);
});

// 1.125.2: a new key's access is Full access by default where the server allows it (the owner, 2026-11-27). A proposal that
// leaves --access out follows the owner's default for new keys at the time it is proposed, and the card shows it.
test('1.125.2: a proposal with no access follows the owner\'s default: Full access by default, Ask first once the owner saved Ask', { timeout: 120_000 }, async t => {
  const s = await boot(t, 19057);
  await s.turnOn();
  assert.equal((await s.call('/jobs/keys')).body.defaults.access, 'full', 'the default for new keys');
  const a = await s.start('owner asks for a job __HANG__'), ta = await s.tokenFor(a);
  let r = await s.propose(ta, s.fields({ name: 'follows-default', access: undefined }));
  assert.equal(r.status, 202, JSON.stringify(r.body));
  const reqA = r.body.request;
  let list = (await s.call('/jobs/keys')).body;
  assert.equal(list.requests.find(x => x.id === reqA).fields.access, 'full', 'the owner sees Full access on the card');
  assert.equal(s.audit().find(x => x.event === 'proposed' && x.request === reqA)?.access, 'full', 'audited with its access');
  r = await s.answer(reqA, { answer: 'allow' });
  assert.equal(r.status, 200, r.text);
  assert.equal((await s.call('/jobs/keys')).body.keys.find(k => k.name === 'follows-default').access, 'full');
  await s.stopTurn(a);
  // the owner saves Ask me for every action: the next proposal with no access is Ask first
  await s.turnOn({ jobAccess: 'ask' });
  assert.equal((await s.call('/jobs/keys')).body.defaults.access, 'ask');
  const b = await s.start('owner asks again __HANG__'), tb = await s.tokenFor(b);
  r = await s.propose(tb, s.fields({ name: 'after-ask', access: undefined }));
  assert.equal(r.status, 202, JSON.stringify(r.body));
  list = (await s.call('/jobs/keys')).body;
  assert.equal(list.requests.find(x => x.id === r.body.request).fields.access, 'ask');
  // the key made before keeps its Full access
  assert.equal(list.keys.find(k => k.name === 'follows-default').access, 'full', 'an existing key keeps its access');
  await s.stopTurn(b);
});
