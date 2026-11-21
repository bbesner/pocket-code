// 1.117: Pause all and Settings → Automation on the real server.mjs, with the fake Claude Code, Codex and OpenRouter CLIs.
// Pause stops running replies on all three engines, holds a usage-limit retry, keeps the queue and coordination wakes
// from starting anything, lets the owner's own messages run (or refuses them when Blocked), and survives a restart. The
// settings route saves, refuses out of range, resets, beats an env preset, and refuses the CLI token. The gate's
// own cases (ceilings, the 41st reply, one notice a day) are unit-tested in test/automation.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';

const repo = path.resolve(import.meta.dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE|OPENCODE)_/.test(k)));

// One server on `dir` (a fresh temp dir unless given, so a second boot is a restart on the same data).
async function boot(t, port, { dir = null, env = {} } = {}) {
  dir = dir || fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pause-')));
  const home = path.join(dir, 'home'), cwd = path.join(home, 'work'), data = path.join(dir, 'data');
  for (const d of [home, cwd, path.join(home, 'pocket-uploads'), path.join(dir, 'sessions')]) fs.mkdirSync(d, { recursive: true });
  const secret = 'pause-' + port, exp = Date.now() + 3600_000;
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
  return { dir, data, cwd, call, e, until, start, session, running, idle, claudeCalls, audit, bearer, stop, logs: () => logs };
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
  assert.deepEqual(before.would, { replies: { claude: 1, codex: 1, openrouter: 1 }, retries: 1, checkbacks: 0, inboxWatch: false });
  assert.deepEqual([before.ownMessages, before.confirm], ['run', true]);

  // same-site JSON only, the cookie only
  assert.equal((await s.call('/pause', {}, { cookie: '', ...s.bearer() })).status, 401, 'the CLI token is refused');
  const cross = await fetch(`http://127.0.0.1:18943/api/pause`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.ok([401, 403].includes(cross.status));

  const p = await s.call('/pause', {});
  assert.equal(p.status, 200); assert.equal(p.body.ok, true); assert.ok(Date.parse(p.body.paused.at)); assert.equal(p.body.paused.by, 'owner');
  assert.deepEqual(p.body.stopped.replies, { claude: 1, codex: 1, openrouter: 1 }); assert.equal(p.body.stopped.retries, 1);
  for (const engine of ['claude', 'codex', 'acp']) await s.idle(ids[engine]);
  const marker = JSON.parse(fs.readFileSync(path.join(s.data, 'turnlogs', `${limited}.retry.json`), 'utf8'));
  assert.equal(marker.held, true); assert.equal(marker.rootOrigin, 'owner');
  const held = await s.session(limited);
  assert.deepEqual([held.state.kind, held.state.label, held.state.held], ['waiting', 'Retry held', true]);
  assert.deepEqual((await s.call('/pause')).body.held, { retries: 1, checkbacks: 0 });
  assert.equal((await s.call('/pause', {})).status, 200, 'pausing twice is fine');
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
  assert.deepEqual(r.body, { ok: true, paused: null, rearmed: 1 });
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
  assert.ok(!JSON.stringify(log).includes('pause limit'), 'never message text');
});

test('Blocked own messages, coordination wakes while paused, and the Automation settings route', { timeout: 120_000 }, async t => {
  const s = await boot(t, 18945, { env: { POCKET_AUTOMATION_DAILY_REPLIES: '1', POCKET_AUTOMATION_COUNT_OWNER_WORK: 'on', POCKET_AUTOMATION_WEEKLY_CEILING: '60', POCKET_INBOX_RUNNER: '0' } });

  // ---- the settings route ----
  let a = (await s.call('/automation')).body;
  assert.deepEqual(a.groups.map(g => g.key), ['pause', 'limits']);
  const L = key => a.groups[1].settings.find(x => x.key === key);
  assert.deepEqual([L('dailyReplies').value, L('dailyReplies').preset, L('dailyReplies').saved, L('dailyReplies').default], [1, true, false, 40], 'the env preset sets the starting value');
  assert.deepEqual([L('claudeWeekly').value, L('codexWeekly').value], [60, 60]);
  assert.deepEqual(Object.keys(a).sort(), ['groups', 'notices', 'paused', 'usage', 'warnings']);
  assert.equal(a.usage.days.length, 7);
  for (const [p, body] of [['/automation/settings', { group: 'limits', values: { dailyReplies: 5 } }], ['/pause', {}], ['/resume', {}]]) {
    assert.equal((await s.call(p, body, s.bearer())).status, 401, `${p}: the CLI token is refused`);
  }
  assert.equal((await s.call('/automation', null, s.bearer())).status, 401);
  // every setting saves and is refused out of range (all or nothing)
  const good = { pause: { ownMessages: 'blocked', inboxWatch: false, rearmRetries: false, confirm: false },
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
  // reset: the table values, or this install's presets
  for (const group of ['pause', 'limits']) assert.equal((await s.call('/automation/settings', { group, reset: true })).status, 200);
  a = (await s.call('/automation')).body;
  assert.ok(a.groups.every(g => g.settings.every(x => !x.saved)));
  assert.deepEqual(a.groups[0].settings.map(x => x.value), ['run', true, true, true]);
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
  assert.equal((await s.call('/resume', {})).status, 200);
  assert.equal((await s.call('/inbox/watch')).body.settings, null, 'back to the config file, as before the pause');
  pz = await s.call('/pause', {});
  const mine = { ...(await s.call('/inbox/watch')).body.settings, paused: true, every: 30 };
  assert.equal((await s.call('/inbox/watch', { settings: mine })).status, 200, 'the owner changes Inbox Watch while paused');
  assert.equal((await s.call('/resume', {})).status, 200);
  assert.equal((await s.call('/inbox/watch')).body.settings.paused, true, 'Resume leaves a pause the owner set alone');
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
