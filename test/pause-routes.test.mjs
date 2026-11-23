// 1.117: Pause all and Settings → Automation on the real server.mjs, with the fake Claude Code, Codex and OpenRouter CLIs.
// Pause stops running replies on all three engines, holds a usage-limit retry, keeps the queue and coordination wakes
// from starting anything, lets the owner's own messages run (or refuses them when Blocked), and survives a restart. The
// settings route saves, refuses out of range, resets, beats an env preset, and refuses the CLI token. The gate's
// own cases (ceilings, the 41st reply, one notice a day) are unit-tested in test/automation.test.mjs. A Pause that lands
// after a start's gate passed is opened on purpose: FAKE_CODEX_SLOW_RESUME and FAKE_ACP_SLOW_LOAD slow a reopen in the
// fakes, and POCKET_TEST_START_GAP holds a Claude queue or retry start for 1.5 s after its gate (server.mjs).
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
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE|OPENCODE)_/.test(k)));

// One server on `dir` (a fresh temp dir unless given, so a second boot is a restart on the same data).
async function boot(t, port, { dir = null, env = {} } = {}) {
  dir = dir || fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pause-')));
  const home = path.join(dir, 'home'), cwd = path.join(home, 'work'), data = path.join(dir, 'data');
  for (const d of [home, cwd, path.join(home, 'pocket-uploads'), path.join(dir, 'sessions')]) fs.mkdirSync(d, { recursive: true });
  // One secret per data folder: a restart keeps it, as a real one does. Since 1.118 the password mark in auth-state.json is
  // keyed by POCKET_SECRET, so a restart with another secret reads as a new password and starts a new sign-in generation.
  const secret = 'pause-' + path.basename(dir), exp = Date.now() + 3600_000;
  const cookie = 'pc_auth=' + exp + '.' + createHmac('sha256', secret).update(String(exp)).digest('hex');
  const child = spawn(process.execPath, ['server.mjs'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...cleanEnv(), HOME: home, PORT: String(port), POCKET_SKILLS: '0', POCKET_ENV_FILE: '', POCKET_AUTO_TITLES: '0', POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret,
    POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: data, POCKET_TEST_CALLS: path.join(dir, 'calls'),
    CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'), CODEX_BIN: path.join(repo, 'test/fake-codex.mjs'),
    POCKET_ACP_ENABLE: '1', POCKET_ACP_CMD: process.execPath, POCKET_ACP_ARGS: path.join(repo, 'test/fake-acp.mjs'), POCKET_ACP_STORE: path.join(dir, 'acp-store'),
    POCKET_RETRY_BUFFER_MS: '0', POCKET_COORD_SWEEP_MS: '200', ...env,
  } });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  const exited = new Promise(r => child.once('exit', r));
  const stop = async () => { try { child.kill('SIGKILL'); } catch { } await exited; };
  t.after(stop);
  t.after(async () => { await exited; killStrays(data); }); // after the server is dead; a restart on this dir leaves its runners to the final teardown
  for (let i = 0; ; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { } if (i > 300) throw new Error('server did not start: ' + logs); await sleep(30); }
  const call = async (p, body, headers = { cookie }, method) => {
    const r = await fetch(`http://127.0.0.1:${port}/api${p}`, { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch { } return { status: r.status, body: j };
  };
  const e = id => encodeURIComponent(id);
  const until = async (fn, ms = 15000, what = 'condition') => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}; log tail: ${logs.slice(-1500)}`); await sleep(60); } };
  const start = async (engine, text, extra = {}) => { const r = await call('/new', { provider: engine, cwd, text, approvalMode: 'full', ...extra }); assert.equal(r.status, 202, `${engine} start: ${JSON.stringify(r.body)}`); return r.body.id; };
  const session = id => call('/session/' + e(id)).then(r => r.body);
  const running = id => until(async () => { const b = await session(id); return b?.state?.kind === 'running' ? b : null; }, 15000, `${id} to run`);
  const idle = id => until(async () => { const b = await session(id); return b && !b.active && b.state?.kind !== 'running' ? b : null; }, 15000, `${id} to end`);
  const claudeCalls = () => { try { return fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
  const audit = () => { try { return fs.readFileSync(path.join(data, 'automation-audit.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
  const bearer = () => ({ authorization: 'Bearer ' + fs.readFileSync(path.join(data, 'cli-token'), 'utf8').trim() });
  // What each engine's fake was asked (every prompt's text), and the per-conversation records Pocket keeps.
  const lines = f => { try { return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
  const prompts = engine => engine === 'claude' ? claudeCalls().map(c => c.text)
    : engine === 'codex' ? lines(path.join(dir, 'calls.codex')).map(c => c.text)
      : (() => { try { return fs.readdirSync(path.join(dir, 'acp-store')).flatMap(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'acp-store', f), 'utf8')).prompts || []; } catch { return []; } }); } catch { return []; } })();
  const smeta = () => { try { return JSON.parse(fs.readFileSync(path.join(data, 'session-meta.json'), 'utf8')); } catch { return {}; } };
  const queue = id => call(`/session/${e(id)}/queue`).then(r => r.body);
  return { dir, data, cwd, cookie, call, e, until, start, session, running, idle, claudeCalls, prompts, smeta, queue, lines, audit, bearer, stop, logs: () => logs };
}
const tmpDir = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pause-')));
// A push service on this machine, so a test can read what each push said. web-push speaks only HTTPS, so it serves a
// throwaway self-signed certificate (the server under test runs with NODE_TLS_REJECT_UNAUTHORIZED=0), and every push is
// decrypted with the one subscribed device's keys. seed() writes that device into a data folder before the server boots.
async function pushService(t) {
  const dir = tmpDir(), key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
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
    seed: data => { fs.mkdirSync(data, { recursive: true }); fs.writeFileSync(path.join(data, 'push-subs.json'), JSON.stringify([{ endpoint: `https://127.0.0.1:${server.address().port}/push/device`, keys: { p256dh: device.getPublicKey('base64url'), auth } }])); },
    for: id => got.filter(m => m.tag === id).map(m => m.body),
    all: got,
  };
}
// The owner-only controls refuse a request that carries the valid cookie but is not same-site JSON: a form post
// (text/plain) and a cross-site fetch both get 403, whatever the route would have done.
async function ownerControlRefuses(s, port) {
  for (const [p, body] of [['/pause', {}], ['/resume', {}], ['/automation/settings', { group: 'limits', values: { dailyReplies: 3 } }]]) {
    const plain = await fetch(`http://127.0.0.1:${port}/api${p}`, { method: 'POST', headers: { cookie: s.cookie, 'content-type': 'text/plain' }, body: JSON.stringify(body) });
    assert.equal(plain.status, 403, `${p}: text/plain with the cookie`);
    const cross = await s.call(p, body, { cookie: s.cookie, 'sec-fetch-site': 'cross-site' });
    assert.equal(cross.status, 403, `${p}: cross-site with the cookie`);
    assert.deepEqual(cross.body, { error: 'Open this control from Pocket Code.' });
  }
}

test('Pause all stops every engine, holds a usage-limit retry, keeps the queue still, survives a restart, and Resume re-arms', { timeout: 120_000 }, async t => {
  let s = await boot(t, 18943);
  assert.deepEqual((await s.call('/me')).body.paused, null);
  assert.equal((await s.call('/me')).body.features.automation, true);
  const ids = {};
  for (const engine of ['claude', 'codex', 'acp']) { ids[engine] = await s.start(engine, `pause hang ${engine} __HANG__`); await s.running(ids[engine]); }
  // a usage limit: the retry is armed (it fires 5 s on at the earliest)
  const limited = await s.start('claude', 'pause limit __LIMIT__');
  await s.until(async () => (await s.session(limited))?.state?.label === 'Waiting for usage reset', 10000, 'the retry to be armed');

  const before = (await s.call('/pause')).body;
  assert.deepEqual(before.paused, null);
  assert.deepEqual(before.would, { replies: { claude: 1, codex: 1, openrouter: 1 }, background: 0, retries: 1, checkbacks: 0, inboxWatch: false, jobs: 0 });
  assert.deepEqual([before.ownMessages, before.confirm], ['run', true]);

  // same-site JSON only, the cookie only
  assert.equal((await s.call('/pause', {}, { cookie: '', ...s.bearer() })).status, 401, 'the CLI token is refused');
  await ownerControlRefuses(s, 18943);
  assert.equal((await s.call('/me')).body.paused, null, 'the refused calls paused nothing');

  const p = await s.call('/pause', {});
  assert.equal(p.status, 200); assert.equal(p.body.ok, true); assert.ok(Date.parse(p.body.paused.at)); assert.equal(p.body.paused.by, 'owner');
  assert.deepEqual(p.body.stopped.replies, { claude: 1, codex: 1, openrouter: 1 }); assert.equal(p.body.stopped.retries, 1);
  for (const engine of ['claude', 'codex', 'acp']) await s.idle(ids[engine]);
  const marker = JSON.parse(fs.readFileSync(path.join(s.data, 'turnlogs', `${limited}.retry.json`), 'utf8'));
  assert.equal(marker.held, true); assert.equal(marker.rootOrigin, 'owner');
  const held = await s.session(limited);
  assert.deepEqual([held.state.kind, held.state.label, held.state.held], ['waiting', 'Retry held', true]);
  assert.deepEqual((await s.call('/pause')).body.held, { retries: 1, checkbacks: 0 });
  // the list carries the banner's part, so the app reads it with the list instead of a request of its own
  assert.deepEqual((await s.call('/sessions')).body.pause, { paused: p.body.paused, held: { retries: 1, checkbacks: 0 }, ownMessages: 'run', confirm: true });
  const twice = await s.call('/pause', {});
  assert.equal(twice.status, 200, 'pausing twice is fine');
  assert.deepEqual(twice.body.stopped, { replies: { claude: 0, codex: 0, openrouter: 0 }, background: 0, retries: 0, checkbacks: 0, inboxWatch: false, jobs: 0 }, 'and changes nothing');
  assert.equal(s.audit().filter(x => x.action === 'pause').length, 1, 'one audit line for one pause');
  assert.equal((await s.call('/me')).body.paused.at, p.body.paused.at, 'the first pause time stands');
  await sleep(6000); // past the retry's time: held, it does not run
  assert.ok(!s.claudeCalls().some(c => /interrupted by an API rate limit/.test(c.text || '')), 'the held retry did not run');

  // a restart keeps the pause and the held retry
  await s.stop();
  s = await boot(t, 18944, { dir: s.dir });
  const after = (await s.call('/pause')).body;
  assert.equal(after.paused.at, p.body.paused.at); assert.deepEqual(after.held, { retries: 1, checkbacks: 0 });
  assert.equal((await s.session(limited)).state.label, 'Retry held');

  // the owner's own message runs while paused
  const own = await s.start('claude', 'pause owner message');
  const done = await s.idle(own);
  assert.equal(done.state.kind, 'finished', JSON.stringify(done.state));
  assert.ok(s.claudeCalls().some(c => c.text === 'pause owner message'), 'it reached Claude');
  // a queued message does not drain while paused; it shows as paused, as after Stop
  const q = await s.start('claude', 'pause queue host __SLOW__');
  const qr = await s.call(`/session/${s.e(q)}/message`, { text: 'pause queued follow-up', mode: 'queue', approvalMode: 'full' });
  assert.equal(qr.status, 202); assert.equal(qr.body.queued, true);
  await s.idle(q);
  await sleep(800);
  const qs = await s.session(q);
  assert.deepEqual([qs.state.kind, qs.state.label], ['waiting', 'Queue paused']);
  assert.equal((await s.call(`/session/${s.e(q)}/queue`)).body.items.length, 1);
  assert.ok(!s.claudeCalls().some(c => c.text === 'pause queued follow-up'));

  // Resume re-arms the held retry; the queue stays as it is until the owner starts it
  assert.equal((await s.call('/resume', {}, { cookie: '', ...s.bearer() })).status, 401, 'the CLI token cannot resume');
  const r = await s.call('/resume', {});
  assert.deepEqual(r.body, { ok: true, paused: null, rearmed: 1, inboxWatch: null, checkbacks: { run: 0, missed: 0 } });
  assert.deepEqual((await s.call('/me')).body.paused, null);
  await s.until(() => s.claudeCalls().some(c => /interrupted by an API rate limit/.test(c.text || '')), 15000, 'the retry to run after Resume');
  await s.idle(limited);
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.data, 'session-meta.json'), 'utf8'))[limited].lastOrigin, 'retry', 'smeta records who started the newest turn');
  assert.equal((await s.call(`/session/${s.e(q)}/queue`)).body.items.length, 1, 'the queue stays paused until started');
  const item = (await s.call(`/session/${s.e(q)}/queue`)).body.items[0];
  assert.equal((await s.call(`/session/${s.e(q)}/queue/start`, { itemId: item.id })).status, 200);
  await s.until(() => s.claudeCalls().some(c => c.text === 'pause queued follow-up'), 10000, 'the started queue row');

  const log = s.audit();
  assert.ok(log.some(x => x.action === 'pause' && x.replies?.claude === 1 && x.retries === 1));
  assert.ok(log.some(x => x.action === 'resume' && x.rearmed === 1));
  assert.ok(log.some(x => x.action === 'reply' && x.origin === 'retry' && x.engine === 'claude'), 'the finished unattended reply is recorded');
  assert.equal(log.find(x => x.action === 'reply' && x.origin === 'retry').model, 'claude-opus-5-5', 'with the model it ran on (the conversation is on the default)');
  assert.ok(!JSON.stringify(log).includes('pause limit'), 'never message text');
});

test('Blocked own messages, coordination wakes while paused, and the Automation settings route', { timeout: 120_000 }, async t => {
  const s = await boot(t, 18945, { env: { POCKET_AUTOMATION_DAILY_REPLIES: '1', POCKET_AUTOMATION_COUNT_OWNER_WORK: 'on', POCKET_AUTOMATION_WEEKLY_CEILING: '60', POCKET_INBOX_RUNNER: '0' } });

  // ---- the settings route ----
  let a = (await s.call('/automation')).body;
  assert.deepEqual(a.groups.map(g => g.key), ['pause', 'limits', 'checkbacks', 'jobs']);
  const L = key => a.groups[1].settings.find(x => x.key === key);
  assert.deepEqual([L('dailyReplies').value, L('dailyReplies').preset, L('dailyReplies').saved, L('dailyReplies').default], [1, true, false, 40], 'the env preset sets the starting value');
  assert.deepEqual([L('claudeWeekly').value, L('codexWeekly').value], [60, 60]);
  assert.deepEqual(Object.keys(a).sort(), ['checkbacks', 'groups', 'jobs', 'notices', 'paused', 'usage', 'warnings']);
  assert.deepEqual(a.checkbacks, { on: false, pending: 0, running: 0 }, '1.119: off by default');
  assert.equal(a.usage.days.length, 7);
  for (const [p, body] of [['/automation/settings', { group: 'limits', values: { dailyReplies: 5 } }], ['/pause', {}], ['/resume', {}]]) {
    assert.equal((await s.call(p, body, s.bearer())).status, 401, `${p}: the CLI token is refused`);
  }
  assert.equal((await s.call('/automation', null, s.bearer())).status, 401);
  // every setting saves and is refused out of range (all or nothing)
  const good = { pause: { ownMessages: 'blocked', inboxWatch: false, backgroundJobs: false, rearmRetries: false, confirm: false },
    limits: { claudeWeekly: 70, claudeFiveHour: 'off', codexWeekly: 75, codexFiveHour: 95, dailyReplies: 2, countOwnerWork: true, ceilingsHoldOwnerWork: true, openrouterDaily: 12.5,
      longestReply: 30, countWaiting: true, notice: 'settings', staleHours: 12 } };
  for (const [group, values] of Object.entries(good)) {
    const r = await s.call('/automation/settings', { group, values });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    for (const [k, v] of Object.entries(values)) { const x = r.body.groups.find(g => g.key === group).settings.find(y => y.key === k); assert.deepEqual([x.value, x.saved], [v, true], k); }
  }
  a = (await s.call('/automation')).body;
  assert.ok(a.warnings.some(w => w === 'Plan ceiling, 5-hour (Claude Code) has no limit.'));
  const bad = await s.call('/automation/settings', { group: 'limits', values: { dailyReplies: 9, longestReply: 2 } });
  assert.equal(bad.status, 400); assert.match(bad.body.error, /Longest unattended reply must be 5 min to 480 min, or No limit\./);
  assert.equal((await s.call('/automation')).body.groups[1].settings.find(x => x.key === 'dailyReplies').value, 2, 'nothing saved');
  for (const v of [0, 1001, 'many', 2.5]) assert.equal((await s.call('/automation/settings', { group: 'limits', values: { dailyReplies: v } })).status, 400, String(v));
  assert.equal((await s.call('/automation/settings', { group: 'limits', values: { dailyReplies: 3 } }, { 'sec-fetch-site': 'cross-site', cookie: '' })).status, 401);
  await ownerControlRefuses(s, 18945);
  assert.equal((await s.call('/automation')).body.groups[1].settings.find(x => x.key === 'dailyReplies').value, 2, 'the refused saves changed nothing');
  // reset: the table values, or this install's presets
  for (const group of ['pause', 'limits', 'checkbacks', 'jobs']) assert.equal((await s.call('/automation/settings', { group, reset: true })).status, 200);
  a = (await s.call('/automation')).body;
  assert.ok(a.groups.every(g => g.settings.every(x => !x.saved)));
  assert.deepEqual(a.groups[0].settings.map(x => [x.key, x.value]), [['ownMessages', 'run'], ['inboxWatch', true], ['backgroundJobs', true], ['rearmRetries', true], ['runOverdue', true], ['confirm', true]]);
  assert.equal(a.groups[1].settings.find(x => x.key === 'dailyReplies').value, 1, 'back to the preset');
  assert.equal(a.groups[1].settings.find(x => x.key === 'longestReply').value, 60);
  assert.ok(s.audit().some(x => x.action === 'settings' && x.group === 'limits' && x.reset === true));

  // ---- the daily count (preset 1, owner work counted): the first queue drain runs, the second is held, once noticed ----
  const c = await s.start('claude', 'limit host __SLOW__');
  for (const text of ['limit drain one __SLOW__', 'limit drain two']) assert.equal((await s.call(`/session/${s.e(c)}/message`, { text, mode: 'queue', approvalMode: 'full' })).status, 202);
  await s.until(() => s.claudeCalls().some(x => x.text === 'limit drain one __SLOW__'), 15000, 'the first drain');
  const first = await s.running(c);
  assert.equal(first.state.origin, 'queue', 'the running reply says who started it');
  await s.idle(c); await sleep(800);
  assert.ok(!s.claudeCalls().some(x => x.text === 'limit drain two'), 'the second drain is over the daily limit');
  assert.equal((await s.session(c)).state.label, 'Queue paused');
  a = (await s.call('/automation')).body;
  assert.deepEqual(a.notices.map(n => n.reason), ['daily_limit']); assert.match(a.notices[0].text, /1 unattended replies ran today/);
  assert.equal(a.usage.today.replies, 1);
  // a changed limit applies to the next start: raised, the next drain runs
  assert.equal((await s.call('/automation/settings', { group: 'limits', values: { dailyReplies: 5 } })).status, 200);
  assert.equal((await s.call(`/session/${s.e(c)}/message`, { text: 'limit owner again', approvalMode: 'full' })).status, 202);
  await s.until(() => s.claudeCalls().some(x => x.text === 'limit drain two'), 15000, 'the drain under the raised limit');
  await s.idle(c);

  // ---- Blocked: the owner's sends get 409 while paused; adding to the queue still works ----
  assert.equal((await s.call('/automation/settings', { group: 'pause', values: { ownMessages: 'blocked' } })).status, 200);
  assert.equal((await s.call('/pause')).body.ownMessages, 'blocked');
  assert.equal((await s.call('/pause', {})).status, 200);
  const refused = await s.call('/new', { provider: 'claude', cwd: s.cwd, text: 'blocked new', approvalMode: 'full' });
  assert.deepEqual([refused.status, refused.body], [409, { error: 'Pocket is paused. Resume to send.', paused: true }]);
  const msg = await s.call(`/session/${s.e(c)}/message`, { text: 'blocked message', approvalMode: 'full' });
  assert.equal(msg.status, 409); assert.equal(msg.body.paused, true);
  assert.equal((await s.call(`/session/${s.e(c)}/branch`, { text: 'blocked branch', approvalMode: 'full' })).status, 409);
  assert.equal((await s.call(`/session/${s.e(c)}/message`, { text: 'blocked but queued', mode: 'queue', approvalMode: 'full' })).status, 202);
  assert.ok(!s.claudeCalls().some(x => /^blocked/.test(x.text || '')));
  assert.equal((await s.call('/resume', {})).body.ok, true);
  assert.equal((await s.call('/new', { provider: 'claude', cwd: s.cwd, text: 'after resume', approvalMode: 'full' })).status, 202);

  // ---- Inbox Watch: paused through its own flag, and Resume clears only what Pause all set ----
  assert.equal((await s.call('/settings', { inbox: true })).status, 200);
  assert.equal((await s.call('/pause')).body.would.inboxWatch, true);
  let pz = await s.call('/pause', {});
  assert.equal(pz.body.stopped.inboxWatch, true);
  assert.equal((await s.call('/inbox/watch')).body.settings.paused, true);
  let rz = await s.call('/resume', {});
  assert.equal(rz.status, 200); assert.equal(rz.body.inboxWatch, 'resumed');
  assert.equal((await s.call('/inbox/watch')).body.settings, null, 'back to the config file, as before the pause');
  pz = await s.call('/pause', {});
  const mine = { ...(await s.call('/inbox/watch')).body.settings, paused: true, every: 30 };
  assert.equal((await s.call('/inbox/watch', { settings: mine })).status, 200, 'the owner changes Inbox Watch while paused');
  rz = await s.call('/resume', {});
  assert.equal(rz.status, 200); assert.equal(rz.body.inboxWatch, 'left_paused', 'Resume says Inbox Watch was left paused');
  assert.ok(s.audit().some(x => x.action === 'resume' && x.inboxWatch === 'left_paused'));
  assert.equal((await s.call('/inbox/watch')).body.settings.paused, true, 'Resume leaves a pause the owner set alone');
  assert.equal((await s.call('/inbox/watch', { settings: null })).status, 200);
  // the owner's change while paused set it running again: Resume does not say it was left paused
  pz = await s.call('/pause', {});
  assert.equal(pz.body.stopped.inboxWatch, true);
  const running = { ...(await s.call('/inbox/watch')).body.settings, paused: false };
  assert.equal((await s.call('/inbox/watch', { settings: running })).status, 200);
  rz = await s.call('/resume', {});
  assert.equal(rz.status, 200); assert.equal(rz.body.inboxWatch, null, 'Inbox Watch is running, so nothing was left paused');
  assert.equal(s.audit().filter(x => x.action === 'resume').at(-1).inboxWatch, undefined, 'nor does the audit line say so');
  assert.equal((await s.call('/inbox/watch')).body.settings.paused, false);
  assert.equal((await s.call('/inbox/watch', { settings: null })).status, 200);
  assert.equal((await s.call('/automation/settings', { group: 'pause', values: { inboxWatch: false } })).status, 200);
  assert.equal((await s.call('/pause')).body.would.inboxWatch, false, 'the owner can keep Inbox Watch out of Pause all');

  // ---- a coordination wake while paused queues its message and starts nothing ----
  assert.equal((await s.call('/automation/settings', { group: 'pause', reset: true })).status, 200);
  assert.equal((await s.call('/settings', { coordination: true })).status, 200);
  const runnerOf = id => s.until(() => s.claudeCalls().find(x => x.id === id)?.runnerToken, 10000, 'the runner token');
  const holder = await s.start('claude', 'coord holder __HANG__'), th = await runnerOf(holder);
  const waiter = await s.start('claude', 'coord waiter __HANG__'), tw = await runnerOf(waiter);
  assert.equal((await s.call('/coordination/hold', { name: 'pause-test', reason: 'Testing' }, { ...s.bearer(), 'x-pocket-runner': th })).status, 200);
  const w = await s.call('/coordination/wait', { name: 'pause-test' }, { ...s.bearer(), 'x-pocket-runner': tw });
  assert.equal(w.body.free, false);
  assert.equal((await s.call(`/session/${s.e(waiter)}/stop`, {})).status, 200); await s.idle(waiter);
  assert.equal((await s.call('/pause', {})).status, 200); await s.idle(holder);
  assert.equal((await s.call('/coordination/owner-release', { name: 'pause-test' })).status, 200, 'the holder was stopped by Pause all, so the owner releases it');
  const woke = await s.until(async () => { const r = (await s.call(`/session/${s.e(waiter)}/queue`)).body; return r.items.length ? r : null; }, 10000, 'the wake row');
  assert.match(woke.items[0].text, /^\[Pocket coordination\] pause-test is free/);
  assert.equal(woke.items[0].origin, 'coordination'); assert.equal(woke.items[0].rootOrigin, 'owner');
  await sleep(800);
  assert.equal(woke.active, false); assert.ok(!s.claudeCalls().some(x => /^\[Pocket coordination\]/.test(x.text || '')), 'the wake did not start while paused');
  assert.equal((await s.call('/resume', {})).body.ok, true);
});

// A server with one subscribed device on a local push service (pushService above).
async function bootWithPush(t, port, env = {}) {
  const push = await pushService(t), dir = tmpDir();
  push.seed(path.join(dir, 'data'));
  return { push, s: await boot(t, port, { dir, env: { ...push.env, ...env } }) };
}
const RETRIED = /interrupted by an API rate limit/;

test('Background jobs and replies the agent starts: Pause all stops them on Claude and Codex, with no push', { timeout: 120_000 }, async t => {
  const { s, push } = await bootWithPush(t, 18946, { POCKET_TEST_BG_MS: '2500', POCKET_TEST_AUTOTURN_MS: '1500' });
  // A Claude conversation Working in background: Pause all stops its job, so the reply the CLI starts when it ends never comes
  const bg = await s.start('claude', 'bg job __BG__');
  const would = await s.until(async () => { const w = (await s.call('/pause')).body.would; return w.background === 1 ? w : null; }, 10000, 'the background job to count');
  assert.deepEqual(would.replies, { claude: 0, codex: 0, openrouter: 0 }, 'the reply itself has ended');
  const p = await s.call('/pause', {});
  assert.equal(p.body.stopped.background, 1);
  assert.match(s.logs(), /stopping 1 background job\(s\) \(Pause all\) session=/);
  assert.equal(s.audit().find(x => x.action === 'pause').background, 1);
  await sleep(3500); // past the job's end
  assert.ok(!s.logs().includes(`turn start (started by the agent) session=${bg}`), 'the CLI started no reply');
  assert.deepEqual(push.for(bg), [], 'and nothing was pushed');
  assert.equal((await s.call('/resume', {})).status, 200);

  // Off: the job keeps running until it starts a reply, and that reply is stopped at once (its process ends with it). It is nobody's queue row, so lastOrigin clears.
  assert.equal((await s.call('/automation/settings', { group: 'pause', values: { backgroundJobs: false } })).status, 200);
  const host = await s.start('claude', 'bg host __SLOW__');
  assert.equal((await s.call(`/session/${s.e(host)}/message`, { text: 'bg queued __BG__', mode: 'queue', approvalMode: 'full' })).status, 202);
  await s.until(() => s.prompts('claude').includes('bg queued __BG__'), 10000, 'the queued message to start');
  await s.idle(host); await sleep(300);
  assert.equal(s.smeta()[host].lastOrigin, 'queue');
  const p2 = await s.call('/pause', {});
  assert.deepEqual([p2.body.stopped.background, p2.body.stopped.replies.claude], [0, 0], 'Off: nothing stopped now');
  await s.until(() => s.logs().includes(`stop requested (paused; the agent started a reply) session=${host}`), 8000, 'the reply the job started to be stopped');
  await s.idle(host); await sleep(500);
  assert.ok(!s.smeta()[host].lastOrigin, 'a reply the agent started is not the queue\'s');
  assert.deepEqual(push.for(host), [], 'no push for the stopped reply (the queued one before it left a job running)');

  // Codex starts a turn by itself (a background terminal finished) while paused: interrupted at once, with no push
  assert.equal((await s.call('/resume', {})).status, 200);
  const cx = await s.start('codex', 'cx auto __AUTOTURN__');
  await s.until(() => push.for(cx).length === 1, 10000, 'the Codex reply\'s push');
  assert.equal((await s.call('/pause', {})).status, 200);
  await s.until(() => /stop requested \(paused; the agent started a reply\) thread=/.test(s.logs()), 8000, 'the turn Codex started to be stopped');
  await s.idle(cx); await sleep(800);
  assert.ok(!fs.existsSync(path.join(s.dir, 'calls.autoturns')), 'the turn was interrupted before it finished');
  assert.equal(push.for(cx).length, 1, 'no push for it');
  assert.ok(!s.smeta()[cx]?.lastOrigin);

  // A Claude reply still running with a background job: stopping the reply ends its process (the process group, as Stop
  // does) and the job with it, counted once. That holds with the switch Off too: the job can't outlive its process.
  assert.equal((await s.call('/resume', {})).status, 200);
  const runnerPid = id => { const d = path.join(s.data, 'turnlogs'); return JSON.parse(fs.readFileSync(path.join(d, fs.readdirSync(d).find(f => f.startsWith(id) && f.endsWith('.runner.json'))), 'utf8')).pid; };
  for (const on of [true, false]) {
    assert.equal((await s.call('/automation/settings', { group: 'pause', values: { backgroundJobs: on } })).status, 200);
    const id = await s.start('claude', `bg running ${on} __BGHANG__`);
    const w = await s.until(async () => { const x = (await s.call('/pause')).body.would; return x.background === 1 ? x : null; }, 10000, 'the running reply\'s job to count');
    assert.equal(w.replies.claude, 1, 'the reply counts as a reply');
    const pid = runnerPid(id);
    const pz = await s.call('/pause', {});
    assert.deepEqual([pz.body.stopped.replies.claude, pz.body.stopped.background], [1, 1], `switch ${on ? 'On' : 'Off'}: one reply, one job`);
    assert.equal(s.audit().filter(x => x.action === 'pause').at(-1).background, 1);
    await s.idle(id);
    await s.until(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, 5000, 'the process and its job to end');
    assert.match(s.logs(), new RegExp(`stopping 1 background job\\(s\\) with the running reply \\(Pause all\\) session=${id}`));
    assert.equal((await s.call('/resume', {})).status, 200);
  }
});

test('Paused while a queued message or a retry reopens its Codex conversation: nothing starts, the row stays and the retry is held', { timeout: 120_000 }, async t => {
  const dirSlow = tmpDir(), slow = path.join(dirSlow, 'slow-resume');
  const { s, push } = await bootWithPush(t, 18947, { FAKE_CODEX_SLOW_RESUME: slow, POCKET_IDLE_CLOSE_MS: '1500' });
  const resumes = () => s.lines(path.join(s.dir, 'calls.resumes')).length;
  fs.writeFileSync(slow, ''); // every reopen answers 1.5 s late, so Pause all lands after the gate and before the turn

  // a queued message that needs a fresh process (Review actions; the reply before it ran with Full access)
  const q = await s.start('codex', 'gap host __SLOW__');
  assert.equal((await s.call(`/session/${s.e(q)}/message`, { text: 'gap queued', mode: 'queue', approvalMode: 'review' })).status, 202);
  let n = resumes();
  await s.until(() => resumes() > n, 15000, 'the queued message to reopen the conversation');
  assert.equal((await s.call('/pause', {})).status, 200);
  await sleep(2500);
  assert.ok(!s.prompts('codex').includes('gap queued'), 'the queued message did not start');
  assert.deepEqual((await s.queue(q)).items.map(i => [i.text, i.status]), [['gap queued', 'pending']], 'its row is back to pending');
  assert.equal((await s.session(q)).state.label, 'Queue paused');
  assert.match(s.logs(), /queue start held \(paused\) session=/);
  assert.equal(push.for(q).length, 1, 'nothing started after the reply, so its own push went out');
  assert.equal((await s.call('/resume', {})).status, 200);

  // a usage-limit retry that reopens the conversation (closed while it waited)
  const lim = await s.start('codex', 'gap limit __LIMIT__');
  await s.until(async () => (await s.session(lim))?.state?.label === 'Waiting for usage reset', 10000, 'the retry to be armed');
  n = resumes();
  await s.until(() => resumes() > n, 20000, 'the retry to reopen the conversation');
  assert.equal((await s.call('/pause', {})).status, 200);
  await sleep(2500);
  assert.ok(!s.prompts('codex').some(x => RETRIED.test(x)), 'the retry did not start');
  const st = (await s.session(lim)).state;
  assert.deepEqual([st.label, st.held], ['Retry held', true]);
  assert.deepEqual((await s.call('/pause')).body.held, { retries: 1, checkbacks: 0 });
  fs.unlinkSync(slow);
  assert.equal((await s.call('/resume', {})).body.rearmed, 1);
  await s.until(() => s.prompts('codex').some(x => RETRIED.test(x)), 15000, 'the retry after Resume');
});

test('A queued message the daily limit holds: the reply before it is still pushed, on all three engines', { timeout: 120_000 }, async t => {
  const { s, push } = await bootWithPush(t, 18948, { POCKET_AUTOMATION_DAILY_REPLIES: '1', POCKET_AUTOMATION_COUNT_OWNER_WORK: 'on' });
  // the day's one unattended reply is the first drain on Claude; the second is held, and the reply before it is pushed
  const c = await s.start('claude', 'daily host __SLOW__');
  for (const text of ['daily drain one', 'daily drain two']) assert.equal((await s.call(`/session/${s.e(c)}/message`, { text, mode: 'queue', approvalMode: 'full' })).status, 202);
  await s.until(() => s.prompts('claude').includes('daily drain one'), 15000, 'the first drain');
  await s.idle(c);
  await s.until(() => push.for(c).length, 5000, 'the push for the reply before the held row');
  const ids = { claude: c };
  for (const engine of ['codex', 'acp']) {
    const id = ids[engine] = await s.start(engine, `daily host ${engine} __SLOW__`);
    assert.equal((await s.call(`/session/${s.e(id)}/message`, { text: `daily drain ${engine}`, mode: 'queue', approvalMode: 'full' })).status, 202);
    await s.idle(id);
    await s.until(() => push.for(id).length, 5000, `the ${engine} reply's push`);
  }
  await sleep(1000);
  assert.ok(!s.prompts('claude').includes('daily drain two'));
  for (const engine of ['codex', 'acp']) assert.ok(!s.prompts(engine).includes(`daily drain ${engine}`), `${engine}: held`);
  for (const [engine, id] of Object.entries(ids)) {
    assert.equal(push.for(id).length, 1, `${engine}: one push`);
    assert.equal((await s.session(id)).state.label, 'Queue paused', engine);
  }
  assert.deepEqual((await s.call('/automation')).body.notices.map(x => x.reason), ['daily_limit']);
});

test('Paused on Codex and OpenRouter: the owner\'s message runs, the queue stays, a usage limit\'s retry is held and its push says so; Resume re-arms', { timeout: 120_000 }, async t => {
  const { s, push } = await bootWithPush(t, 18949);
  assert.equal((await s.call('/pause', {})).status, 200);
  const limited = {};
  for (const engine of ['codex', 'acp']) {
    const id = await s.start(engine, `paused own ${engine} __SLOW__`);
    assert.equal((await s.call(`/session/${s.e(id)}/message`, { text: `paused queued ${engine}`, mode: 'queue', approvalMode: 'full' })).status, 202);
    await s.idle(id); await sleep(1000);
    assert.ok(s.prompts(engine).includes(`paused own ${engine} __SLOW__`), `${engine}: the owner's message ran`);
    assert.ok(!s.prompts(engine).includes(`paused queued ${engine}`), `${engine}: the queue did not drain`);
    assert.equal((await s.session(id)).state.label, 'Queue paused', engine);
    limited[engine] = await s.start(engine, `paused limit ${engine} __LIMIT__`);
  }
  await s.until(() => push.for(limited.codex).length && push.for(limited.acp).length, 10000, 'the Codex and OpenRouter limit pushes');
  // Claude too, with Resume set not to re-arm: its push says a message carries on
  assert.equal((await s.call('/automation/settings', { group: 'pause', values: { rearmRetries: false } })).status, 200);
  limited.claude = await s.start('claude', 'paused limit claude __LIMIT__');
  for (const [engine, id] of Object.entries(limited)) await s.until(async () => (await s.session(id))?.state?.label === 'Retry held', 10000, `${engine}: the retry held`);
  await s.until(() => Object.values(limited).every(id => push.for(id).length), 5000, 'the limit pushes');
  assert.deepEqual(push.for(limited.codex), ['Usage limit reached. The retry is held until you resume']);
  assert.deepEqual(push.for(limited.acp), ['Rate limited. The retry is held until you resume']);
  assert.deepEqual(push.for(limited.claude), ['Usage limit reached. The retry is held; send a message to carry on']);
  assert.match(s.logs(), /auto-resume held \(paused\)/);
  await sleep(6000); // past every retry's time
  for (const engine of ['claude', 'codex', 'acp']) assert.ok(!s.prompts(engine).some(x => RETRIED.test(x)), `${engine}: the held retry did not run`);
  assert.equal((await s.call('/automation/settings', { group: 'pause', values: { rearmRetries: true } })).status, 200);
  assert.equal((await s.call('/resume', {})).body.rearmed, 3);
  for (const engine of ['claude', 'codex', 'acp']) await s.until(() => s.prompts(engine).some(x => RETRIED.test(x)), 15000, `${engine}: the retry after Resume`);
});

test('Plan ceilings that hold owner work: a queue drain and a retry wait, with one notice each, and the retry shows its next try', { timeout: 120_000 }, async t => {
  const dir = tmpDir(), data = path.join(dir, 'data'), now = Date.now(), reset = now + 3 * 86400_000;
  fs.mkdirSync(data, { recursive: true });
  // Claude's last reading: the weekly window at 93%, over a 90% ceiling, until it resets in 3 days
  fs.writeFileSync(path.join(data, 'usage-state.json'), JSON.stringify({ account: { status: 'allowed', windows: { seven_day: { utilization: 0.93, resetsAt: reset }, five_hour: { utilization: 0.2, resetsAt: now + 3600_000 } }, overage: {}, observedAt: now }, sessions: {} }));
  // Codex's 5-hour window reads 12% (the fake), over a 10% ceiling
  const s = await boot(t, 18950, { dir, env: { POCKET_AUTOMATION_CEILINGS_HOLD_OWNER_WORK: 'on', POCKET_AUTOMATION_CLAUDE_WEEKLY_CEILING: '90', POCKET_AUTOMATION_CODEX_FIVE_HOUR_CEILING: '10', POCKET_AUTOMATION_TICK_MS: '2000' } });
  for (const engine of ['claude', 'codex']) {
    const id = await s.start(engine, `ceiling host ${engine} __SLOW__`);
    assert.equal((await s.call(`/session/${s.e(id)}/message`, { text: `ceiling drain ${engine}`, mode: 'queue', approvalMode: 'full' })).status, 202);
    await s.idle(id); await sleep(1000);
    assert.ok(s.prompts(engine).includes(`ceiling host ${engine} __SLOW__`), `${engine}: the owner's own message is not held`);
    assert.ok(!s.prompts(engine).includes(`ceiling drain ${engine}`), `${engine}: the drain is held`);
    assert.equal((await s.session(id)).state.label, 'Queue paused');
  }
  const lim = await s.start('claude', 'ceiling limit __LIMIT__');
  await s.until(async () => (await s.session(lim))?.state?.label === 'Waiting for usage reset', 10000, 'the retry to be armed');
  await s.until(() => s.logs().includes(`auto-resume re-armed (plan_ceiling) session=${lim}`), 15000, 'the retry to meet the ceiling');
  assert.ok(!s.prompts('claude').some(x => RETRIED.test(x)), 'the retry did not run');
  const st = (await s.session(lim)).state;
  assert.deepEqual([st.label, st.retryAt], ['Waiting for usage reset', reset], 'the conversation shows the re-armed time (the window\'s reset)');
  const a = (await s.call('/automation')).body;
  assert.deepEqual(a.notices.map(x => [x.reason, x.engine]).sort(), [['plan_ceiling', 'claude'], ['plan_ceiling', 'codex']], 'one notice for each window, however many starts it held');
  assert.match(a.notices.find(x => x.engine === 'claude').text, /weekly window is at 93%, over the 90% ceiling/);
  assert.equal(s.audit().filter(x => x.action === 'limit').length, 2);
});

test('Side chats: Pause all stops one that is answering, and Blocked refuses a new message', { timeout: 60_000 }, async t => {
  const s = await boot(t, 18951);
  const c = await s.start('claude', 'side parent'); await s.idle(c);
  const side = await s.call(`/session/${s.e(c)}/side`, { text: 'side question __SIDEHANG__' });
  assert.equal(side.status, 202, JSON.stringify(side.body));
  const chat = () => s.call(`/session/${s.e(c)}/side`).then(r => r.body.chat);
  await s.until(async () => (await chat())?.busy, 5000, 'the side chat to answer');
  assert.deepEqual((await s.call('/pause')).body.would.replies, { claude: 1, codex: 0, openrouter: 0 }, 'counted with Claude\'s replies');
  const p = await s.call('/pause', {});
  assert.deepEqual(p.body.stopped.replies, { claude: 1, codex: 0, openrouter: 0 });
  await s.until(async () => !(await chat())?.busy, 5000, 'the side chat to stop');
  assert.match(s.logs(), /side chat stop requested \(Pause all\) session=/);
  assert.equal((await s.call('/automation/settings', { group: 'pause', values: { ownMessages: 'blocked' } })).status, 200);
  const refused = await s.call(`/session/${s.e(c)}/side`, { text: 'side while blocked', side: side.body.side });
  assert.deepEqual([refused.status, refused.body], [409, { error: 'Pocket is paused. Resume to send.', paused: true }]);
  assert.equal((await s.call('/resume', {})).status, 200);
  assert.equal((await s.call(`/session/${s.e(c)}/side`, { text: 'side after resume', side: side.body.side })).status, 202);
});

test('A message the owner sent while background jobs held the earlier Claude login starts while paused, unless own messages are Blocked', { timeout: 120_000 }, async t => {
  const dir = tmpDir(); fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  const s = await boot(t, 18952, { dir, env: { POCKET_AFTER_JOBS_GRACE_MS: '50', CLAUDE_CONFIG_DIR: path.join(dir, 'config') } });
  const a = await s.start('claude', 'jobs a __BG_LONG__'); await s.idle(a);
  const b = await s.start('claude', 'jobs b __BG_LONG__'); await s.idle(b);
  // a sign-in to another account: both processes keep the earlier login while their jobs run
  const login = (await s.call('/claude/login/start', {})).body; assert.ok(login.id, JSON.stringify(login));
  await s.until(async () => (await s.call('/claude/login')).body.status === 'waiting', 5000, 'the sign-in to wait for its code');
  assert.equal((await s.call('/claude/login/code', { id: login.id, code: 'test-code#test-state' })).status, 200);
  await s.until(async () => (await s.call('/claude/login')).body.status === 'success', 5000, 'the sign-in');
  for (const [id, text] of [[a, 'after jobs a'], [a, 'after jobs a2'], [b, 'after jobs b']]) {
    const r = await s.call(`/session/${s.e(id)}/message`, { text, approvalMode: 'full' });
    assert.equal(r.status, 202); assert.equal(r.body.afterJobs, true, 'held for the jobs');
  }
  assert.equal((await s.call('/automation/settings', { group: 'pause', values: { backgroundJobs: false } })).status, 200);
  assert.equal((await s.call('/pause', {})).status, 200);
  // a job ends (the CLI says so in its output): the message held for it starts, paused or not, as the owner's own; the
  // second one held for the same jobs starts when the first one's reply ends (finalizeTurn), as the owner's own too
  const jobEnds = id => { const d = path.join(s.data, 'turnlogs'); fs.appendFileSync(path.join(d, fs.readdirSync(d).find(f => f.startsWith(id) && f.endsWith('.out.ndjson'))), JSON.stringify({ type: 'system', subtype: 'background_tasks_changed', tasks: [] }) + '\n'); };
  jobEnds(a);
  await s.until(() => s.prompts('claude').includes('after jobs a'), 15000, 'the held message to start while paused');
  await s.until(() => s.prompts('claude').includes('after jobs a2'), 15000, 'the second held message to start after the first, while paused');
  await s.idle(a); await sleep(300);
  assert.deepEqual((await s.queue(a)).items, []);
  assert.ok(!s.smeta()[a]?.lastOrigin, 'started as the owner\'s, not the queue\'s');
  // Blocked: it stays held, and Resume starts it (its jobs have ended)
  assert.equal((await s.call('/automation/settings', { group: 'pause', values: { ownMessages: 'blocked' } })).status, 200);
  jobEnds(b); await sleep(1500);
  assert.ok(!s.prompts('claude').includes('after jobs b'), 'Blocked: it does not start');
  assert.deepEqual((await s.queue(b)).items.map(i => [i.text, i.status]), [['after jobs b', 'pending']]);
  assert.equal((await s.call('/resume', {})).status, 200);
  await s.until(() => s.prompts('claude').includes('after jobs b'), 10000, 'the message kept while Blocked to start on Resume');
  await s.idle(b); await sleep(300);
  assert.deepEqual((await s.queue(b)).items, []);
  assert.equal(s.prompts('claude').filter(x => x === 'after jobs b').length, 1, 'once');
});

const outFile = (s, id) => { const d = path.join(s.data, 'turnlogs'); return path.join(d, fs.readdirSync(d).find(f => f.startsWith(id) && f.endsWith('.out.ndjson'))); };

test('Paused: a background agent\'s permission request that turns into a reply the agent started is stopped, with no push', { timeout: 60_000 }, async t => {
  const { s, push } = await bootWithPush(t, 18953);
  assert.equal((await s.call('/pause', {})).status, 200);
  const id = await s.start('claude', 'stand-in __BG_ASK__', { approvalMode: 'review' }); // the owner's own message runs while paused
  await s.until(() => s.logs().includes(`turn start (a background job asked for permission) session=${id}`), 10000, 'the stand-in turn');
  await s.until(() => push.for(id).length, 5000, 'the request\'s push');
  const before = push.for(id);
  assert.deepEqual(before, ['Open Pocket Code to review the pending action.']);
  // the agent itself starts replying while the request waits (another job of its finished, say)
  fs.appendFileSync(outFile(s, id), [{ type: 'system', subtype: 'init', session_id: id },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Another job finished; carrying on.' }] } },
    { type: 'result', subtype: 'success', result: 'done', duration_ms: 10 }].map(o => JSON.stringify(o) + '\n').join(''));
  await s.until(() => s.logs().includes(`stop requested (paused; the agent started a reply) session=${id}`), 8000, 'the reply to be stopped');
  await s.idle(id); await sleep(800);
  assert.deepEqual(push.for(id), before, 'no push for the stopped reply');
  assert.ok(!s.smeta()[id]?.lastOrigin);
  assert.equal(s.audit().filter(x => x.action === 'reply').length, 0, 'the agent\'s reply is not counted as a finished unattended reply');
});

test('Paused after the gate passed on Claude: a queued message stays pending and a retry is held; each runs once after Resume', { timeout: 120_000 }, async t => {
  const gap = path.join(tmpDir(), 'start-gap');
  const s = await boot(t, 18954, { env: { POCKET_TEST_START_GAP: gap } }); // while `gap` exists, a queue or retry start waits 1.5 s after its gate
  const gatePassed = (origin, id) => !s.logs().includes(`unattended start held (paused) origin=${origin} session=${id}`);

  // a queued message: the gate passes as the reply before it ends, Pause all lands before startTurn
  const q = await s.start('claude', 'gap host __SLOW__');
  assert.equal((await s.call(`/session/${s.e(q)}/message`, { text: 'gap queued', mode: 'queue', approvalMode: 'full' })).status, 202);
  fs.writeFileSync(gap, '');
  await s.until(() => s.logs().includes(`test start gap session=${q}`), 15000, 'the queued message to pass its gate');
  assert.equal((await s.call('/pause', {})).status, 200);
  await sleep(2500);
  assert.ok(gatePassed('queue', q), 'Pause all landed after the gate');
  assert.ok(!s.prompts('claude').includes('gap queued'), 'the queued message did not start');
  assert.deepEqual((await s.queue(q)).items.map(i => [i.text, i.status]), [['gap queued', 'pending']]);
  assert.equal((await s.session(q)).state.label, 'Queue paused');
  assert.match(s.logs(), new RegExp(`queue start held \\(paused\\) session=${q}`));
  fs.unlinkSync(gap);
  assert.equal((await s.call('/resume', {})).status, 200);
  const item = (await s.queue(q)).items[0];
  assert.equal((await s.call(`/session/${s.e(q)}/queue/start`, { itemId: item.id })).status, 200);
  await s.until(() => s.prompts('claude').includes('gap queued'), 10000, 'the row started after Resume');
  await s.idle(q); await sleep(500);
  assert.equal(s.prompts('claude').filter(x => x === 'gap queued').length, 1, 'once');
  assert.deepEqual((await s.queue(q)).items, []);

  // a usage-limit retry: its timer and marker are gone by then, so the refusal must hold it again
  const lim = await s.start('claude', 'gap limit __LIMIT__');
  await s.until(async () => (await s.session(lim))?.state?.label === 'Waiting for usage reset', 10000, 'the retry to be armed');
  fs.writeFileSync(gap, '');
  await s.until(() => s.logs().includes(`test start gap session=${lim}`), 20000, 'the retry to pass its gate');
  assert.equal((await s.call('/pause', {})).status, 200);
  await sleep(2500);
  assert.ok(gatePassed('retry', lim), 'Pause all landed after the gate');
  assert.ok(!s.prompts('claude').some(x => RETRIED.test(x)), 'the retry did not start');
  const st = (await s.session(lim)).state;
  assert.deepEqual([st.label, st.held], ['Retry held', true]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.data, 'turnlogs', `${lim}.retry.json`), 'utf8')).held, true, 'its marker is back, held');
  assert.deepEqual((await s.call('/pause')).body.held, { retries: 1, checkbacks: 0 });
  fs.unlinkSync(gap);
  assert.equal((await s.call('/resume', {})).body.rearmed, 1);
  await s.until(() => s.prompts('claude').some(x => RETRIED.test(x)), 15000, 'the retry after Resume');
  await s.idle(lim); await sleep(500);
  assert.equal(s.prompts('claude').filter(x => RETRIED.test(x)).length, 1, 'once');
});

test('Paused after the gate passed on OpenRouter (a retry reopening its conversation after a restart): held, and runs once after Resume', { timeout: 120_000 }, async t => {
  const dir = tmpDir(), slow = path.join(tmpDir(), 'slow-load'), env = { FAKE_ACP_SLOW_LOAD: slow };
  let s = await boot(t, 18955, { dir, env });
  const lim = await s.start('acp', 'acp gap limit __LIMIT__');
  await s.until(async () => (await s.session(lim))?.state?.label === 'Waiting for usage reset', 10000, 'the retry to be armed');
  // a restart closes the OpenCode process, so the retry reopens it; while `slow` exists the reopen answers 1.5 s late
  await s.stop();
  fs.writeFileSync(slow, '');
  s = await boot(t, 18956, { dir, env });
  const loads = () => { try { return fs.readFileSync(slow + '.loads', 'utf8').trim().split('\n').filter(Boolean); } catch { return []; } };
  await s.until(() => loads().length, 20000, 'the retry to reopen the conversation');
  assert.equal((await s.call('/pause', {})).status, 200);
  await sleep(2500);
  assert.ok(!s.logs().includes(`unattended start held (paused) origin=retry session=${lim}`), 'Pause all landed after the gate');
  assert.ok(!s.prompts('acp').some(x => RETRIED.test(x)), 'the retry did not start');
  assert.match(s.logs(), new RegExp(`auto-resume held \\(paused\\) session=${lim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  const st = (await s.session(lim)).state;
  assert.deepEqual([st.label, st.held], ['Retry held', true]);
  fs.unlinkSync(slow);
  assert.equal((await s.call('/resume', {})).body.rearmed, 1);
  await s.until(() => s.prompts('acp').some(x => RETRIED.test(x)), 15000, 'the retry after Resume');
  await s.idle(lim); await sleep(500);
  assert.equal(s.prompts('acp').filter(x => RETRIED.test(x)).length, 1, 'once');
});

// 1.124.1 (unattended-01): Pause all is the emergency stop, so it must work when Pocket cannot write its settings (a full
// disk, a read-only data folder). Here pocket-settings.json.tmp is a directory, so every settings save throws. The pause
// still stops and holds everything, holds in memory, and says it was not saved; a later save or press saves it.
const settingsWriteFails = s => fs.mkdirSync(path.join(s.data, 'pocket-settings.json.tmp'));
const settingsWriteWorks = s => fs.rmdirSync(path.join(s.data, 'pocket-settings.json.tmp'));
const savedSettings = s => JSON.parse(fs.readFileSync(path.join(s.data, 'pocket-settings.json'), 'utf8'));
const armedRetry = async (s, text) => {
  const id = await s.start('claude', text);
  await s.until(async () => (await s.session(id))?.state?.label === 'Waiting for usage reset', 10000, 'the retry to be armed');
  return id;
};
const retried = (s, id) => s.claudeCalls().some(c => c.id === id && /interrupted by an API rate limit/.test(c.text || ''));
test('Pause all when the settings cannot be saved: everything stops and is held, the answer and the banner say it was not saved, and a later save keeps it', { timeout: 120_000 }, async t => {
  const s = await boot(t, 18958);
  assert.equal((await s.call('/automation/settings', { group: 'checkbacks', values: { checkbacks: true, spacingSec: 0 } })).status, 200);
  const id = await s.start('claude', 'unsaved runaway __HANG__');
  await s.running(id);
  const token = await s.until(() => s.claudeCalls().filter(c => c.id === id).at(-1)?.runnerToken, 15000, 'the runner token');
  const added = await s.call('/checkbacks/agent/add', { at: '+15m', note: 'Look again' }, { ...s.bearer(), 'x-pocket-runner': token });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  const limited = await armedRetry(s, 'unsaved limit __LIMIT__');

  settingsWriteFails(s);
  const p = await s.call('/pause', {});
  await s.idle(id); // the running reply stopped
  assert.equal(p.status, 200, `the pause happens: ${JSON.stringify(p.body)}`);
  assert.equal(p.body.paused.unsaved, true, 'and the answer says it was not saved');
  assert.deepEqual([p.body.stopped.replies, p.body.stopped.retries, p.body.stopped.checkbacks], [{ claude: 1, codex: 0, openrouter: 0 }, 1, 1]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.data, 'turnlogs', `${limited}.retry.json`), 'utf8')).held, true, 'the retry is held');
  assert.equal((await s.call('/checkbacks')).body.checkbacks.find(c => c.id === added.body.checkback.id).status, 'held', 'the check-back is held');
  assert.equal(s.audit().filter(x => x.action === 'pause').length, 1, 'the pause is in the audit');
  assert.match(s.logs(), /Pause all: the pause could not be saved/);
  assert.equal(savedSettings(s).paused, undefined, 'the saved file does not have it');
  assert.equal((await s.call('/me')).body.paused.at, p.body.paused.at);
  assert.equal((await s.call('/pause')).body.paused.unsaved, true, 'the confirmation and the banner read it too');
  assert.equal((await s.call('/sessions')).body.pause.paused.unsaved, true);

  // a second press while it still cannot be saved: no ordinary success
  const again = await s.call('/pause', {});
  assert.equal(again.status, 200);
  assert.deepEqual([again.body.paused.at, again.body.paused.unsaved], [p.body.paused.at, true], 'still paused, still not saved');
  assert.deepEqual(again.body.stopped.replies, { claude: 0, codex: 0, openrouter: 0 });
  assert.equal(s.audit().filter(x => x.action === 'pause').length, 1, 'one audit line for one pause');
  await sleep(6000); // past the retry's time: held, it does not run
  assert.ok(!retried(s, limited), 'the held retry did not run');

  // the write works again: the next settings change saves the pause with it, and the answer no longer warns
  settingsWriteWorks(s);
  assert.equal((await s.call('/automation/settings', { group: 'pause', values: { confirm: false } })).status, 200);
  assert.equal(savedSettings(s).paused.at, p.body.paused.at, 'saved now, so a restart keeps it');
  assert.equal((await s.call('/pause')).body.paused.unsaved, undefined);
  const third = await s.call('/pause', {});
  assert.deepEqual([third.status, third.body.paused.at, third.body.paused.unsaved], [200, p.body.paused.at, undefined]);
  const r = await s.call('/resume', {});
  assert.deepEqual(r.body, { ok: true, paused: null, rearmed: 1, inboxWatch: null, checkbacks: { run: 0, missed: 0 } });
  assert.equal(savedSettings(s).paused, undefined);
  await s.until(() => retried(s, limited), 15000, 'the retry to run after Resume');
  assert.equal((await s.call('/checkbacks')).body.checkbacks.find(c => c.id === added.body.checkback.id).status, 'pending', 'the check-back is let go');
});

test('Resume when the settings cannot be saved: a saved pause stays paused and held, and says so; a pause that was never saved resumes', { timeout: 120_000 }, async t => {
  const s = await boot(t, 18959);
  // a pause that was never saved: the saved file already says running, so Resume goes ahead
  const first = await armedRetry(s, 'resume unsaved limit __LIMIT__');
  settingsWriteFails(s);
  assert.equal((await s.call('/pause', {})).body.paused.unsaved, true);
  const r1 = await s.call('/resume', {});
  assert.deepEqual([r1.status, r1.body.paused, r1.body.rearmed], [200, null, 1], JSON.stringify(r1.body));
  assert.equal((await s.call('/me')).body.paused, null);
  await s.until(() => retried(s, first), 15000, 'the retry to run after Resume');
  await s.idle(first);

  // a saved pause, then the write fails: Resume refuses, and Pocket stays paused with everything held
  settingsWriteWorks(s);
  const limited = await armedRetry(s, 'resume saved limit __LIMIT__');
  const p = await s.call('/pause', {});
  assert.deepEqual([p.status, p.body.paused.unsaved, p.body.stopped.retries], [200, undefined, 1]);
  assert.equal(savedSettings(s).paused.at, p.body.paused.at);
  settingsWriteFails(s);
  const r = await s.call('/resume', {});
  assert.equal(r.status, 503, JSON.stringify(r.body));
  assert.match(r.body.error, /could not save/i); assert.match(r.body.error, /still paused/i);
  assert.equal(r.body.paused.at, p.body.paused.at);
  assert.equal((await s.call('/me')).body.paused.at, p.body.paused.at, 'still paused');
  assert.deepEqual((await s.call('/pause')).body.held, { retries: 1, checkbacks: 0 }, 'the retry is still held, and the banner shows it with Resume');
  assert.ok(!s.audit().some(x => x.action === 'resume' && Date.parse(x.at) >= Date.parse(p.body.paused.at)), 'no resume in the audit');
  // a settings change that cannot be saved is not kept either
  const before = (await s.call('/automation')).body.groups[0].settings.find(x => x.key === 'confirm').value;
  const change = await s.call('/automation/settings', { group: 'pause', values: { confirm: !before } });
  assert.equal(change.status, 503, JSON.stringify(change.body)); assert.match(change.body.error, /could not save/i);
  assert.equal((await s.call('/automation')).body.groups[0].settings.find(x => x.key === 'confirm').value, before, 'nothing changed');
  await sleep(6000);
  assert.ok(!retried(s, limited), 'the held retry did not run');
  const again = await s.call('/resume', {});
  assert.equal(again.status, 503, 'a second Resume still sees the pause');

  settingsWriteWorks(s);
  const ok = await s.call('/resume', {});
  assert.deepEqual(ok.body, { ok: true, paused: null, rearmed: 1, inboxWatch: null, checkbacks: { run: 0, missed: 0 } });
  assert.equal(savedSettings(s).paused, undefined);
  await s.until(() => retried(s, limited), 15000, 'the retry to run after Resume');
});

test('Pause all when the check-backs cannot be saved: the rest is still stopped and held, and the pause is recorded', { timeout: 60_000 }, async t => {
  const s = await boot(t, 18960);
  assert.equal((await s.call('/automation/settings', { group: 'checkbacks', values: { checkbacks: true, spacingSec: 0 } })).status, 200);
  const id = await s.start('claude', 'cb store runaway __HANG__');
  await s.running(id);
  const token = await s.until(() => s.claudeCalls().filter(c => c.id === id).at(-1)?.runnerToken, 15000, 'the runner token');
  for (const at of ['+15m', '+30m']) assert.equal((await s.call('/checkbacks/agent/add', { at, note: 'Look again' }, { ...s.bearer(), 'x-pocket-runner': token })).status, 201);
  const limited = await armedRetry(s, 'cb store limit __LIMIT__');
  fs.mkdirSync(path.join(s.data, 'checkbacks.json.tmp')); // the check-back store's write fails
  const p = await s.call('/pause', {});
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.deepEqual([p.body.stopped.replies.claude, p.body.stopped.retries, p.body.paused.unsaved], [1, 1, undefined]);
  await s.idle(id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.data, 'turnlogs', `${limited}.retry.json`), 'utf8')).held, true);
  assert.equal(s.audit().filter(x => x.action === 'pause').length, 1, 'the pause is in the audit');
  assert.equal((s.logs().match(/pause: check-back not held/g) || []).length, 2, 'each check-back it could not hold is logged');
  fs.rmdirSync(path.join(s.data, 'checkbacks.json.tmp'));
  assert.equal((await s.call('/resume', {})).body.rearmed, 1);
});
