// 1.117 Pause all and Settings → Automation, the app on the real server. The app half was built against synthetic
// responses (test/automation-browser.mjs); this runs public/automation.js against the real server.mjs and the fake
// Claude Code CLI, so a field the app reads that the server does not send fails here. It follows what the owner does:
// Settings → Automation renders both groups from GET /api/automation, a number saves, an out-of-range number shows the
// server's own error beside the field and the old value comes back, No limit brings the server's warning, Reset to
// defaults; then Pause all from the More menu with replies running (the confirmation counts them, they stop, the banner
// shows, /api/me says paused, a reload is still paused, an owner message still runs, a held usage-limit retry and a
// queue drain read sensibly in the list), Resume; and with own messages Blocked a send is refused and the draft kept.
// Screenshots go to POCKET_AUTOMATION_LIVE_SHOTS (default /tmp/unattended-1.117-live).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import puppeteer from 'puppeteer-core';
import { clickControl, showSetting } from './ui-controls.mjs';
import * as auto from '../automation.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'automation-live-')));
const home = path.join(dir, 'home'), cwd = path.join(home, 'work'), data = path.join(dir, 'data');
for (const d of [home, cwd, path.join(home, 'pocket-uploads'), path.join(dir, 'sessions'), path.join(dir, 'documents')]) fs.mkdirSync(d, { recursive: true });
const shots = process.env.POCKET_AUTOMATION_LIVE_SHOTS || '/tmp/unattended-1.117-live'; fs.mkdirSync(shots, { recursive: true });
const secret = 'automation-live-secret', port = 18957, base = `http://127.0.0.1:${port}`;
const exp = String(Date.now() + 3600_000), cookie = exp + '.' + createHmac('sha256', secret).update(exp).digest('hex');

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE|OPENCODE)_/.test(k)));
const server = spawn(process.execPath, ['server.mjs'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: {
  ...env, HOME: home, PORT: String(port), POCKET_SKILLS: '0', POCKET_UPDATE_CHECK: '0', POCKET_ENV_FILE: '', POCKET_AUTO_TITLES: '0',
  POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret, POCKET_CODEX: '0', POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: data,
  POCKET_DOCUMENTS_DIR: path.join(dir, 'documents'), POCKET_TEST_CALLS: path.join(dir, 'calls'), CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'),
  POCKET_RETRY_BUFFER_MS: '60000', // the __LIMIT__ retry fires a minute out, so it is still armed (and then held) whatever the machine's load
} });
let logs = ''; server.stdout.on('data', d => logs += d); server.stderr.on('data', d => logs += d);
const exited = new Promise(r => server.once('exit', r));
for (let i = 0; ; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { } if (i > 300) throw new Error('server did not start: ' + logs); await sleep(30); }

const call = async (p, body) => {
  const r = await fetch(base + '/api' + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', cookie: 'pc_auth=' + cookie }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { } return { status: r.status, body: j };
};
const until = async (fn, what, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}; log tail: ${logs.slice(-1500)}`); await sleep(60); } };
const session = id => call('/session/' + encodeURIComponent(id)).then(r => r.body);
const start = async text => { const r = await call('/new', { provider: 'claude', cwd, text, approvalMode: 'full' }); assert.equal(r.status, 202, JSON.stringify(r.body)); return r.body.id; };
const claudeTexts = () => { try { return fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l).text); } catch { return []; } };
const savedAutomation = () => JSON.parse(fs.readFileSync(path.join(data, 'pocket-settings.json'), 'utf8')).automation;
const setting = (group, key) => auto.GROUPS.find(g => g.key === group).settings.find(s => s.key === key);

// ---- the conversations: an owner reply that ended, one still running, a queue drain still running, a usage-limit retry ----
const owner = await start('live owner hello');
await until(async () => { const s = await session(owner); return s && !s.active && s.state?.kind !== 'running'; }, 'the owner reply to end');
const hang = await start('live owner hang __HANG__');
const queued = await start('live queue host __SLOW__');
assert.equal((await call(`/session/${encodeURIComponent(queued)}/message`, { text: 'live queued follow-up __HANG__', mode: 'queue', approvalMode: 'full' })).status, 202);
const limited = await start('live limit __LIMIT__');
await until(async () => (await session(limited))?.state?.label === 'Waiting for usage reset', 'the retry to be armed');
await until(async () => { const s = await session(queued); return s?.state?.kind === 'running' && s.lastOrigin === 'queue'; }, 'the queue drain to run');
await until(async () => (await session(hang))?.state?.kind === 'running', 'the owner reply to run');
// The list leaves out conversations in /tmp unless they run or are pinned; these rest (or will, once paused), so they are pinned.
for (const id of [owner, limited, queued]) assert.equal((await call(`/session/${encodeURIComponent(id)}/pin`, { pinned: true })).status, 200);

const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
const errors = [], t0 = Date.now();
let p = null;
try {
  p = await browser.newPage(); p.setDefaultTimeout(10000);
  p.on('pageerror', e => errors.push(e.message));
  await p.setCookie({ name: 'pc_auth', value: cookie, url: base });
  await p.evaluateOnNewDocument(() => { localStorage.setItem('pc-theme', '"dark"'); });
  const desk = () => p.setViewport({ width: 1440, height: 900, isMobile: false, hasTouch: false });
  const phone = () => p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  // A sheet fades in: the picture waits for the page's animations to finish (finite ones; the running ember loops).
  const shot = async name => { await p.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity)); await p.screenshot({ path: path.join(shots, name + '.png') }); };
  const home = async () => { await p.goto(base + '/#/all'); await p.waitForSelector(`.session-home [data-item="${owner}"]`); };
  const chat = async id => { await p.goto(base + '/#/chat/' + encodeURIComponent(id)); await p.waitForSelector('#box'); };
  const input = key => `[data-auto-key="${key}"]`;
  const setNumber = (key, v) => p.$eval(input(key), (e, v) => { e.focus(); e.value = String(v); e.dispatchEvent(new Event('change')); }, v);
  const openAutomation = async () => {
    await clickControl(p, '#settings'); await p.waitForSelector('.settings-index [data-settings-category="unattended"]');
    await showSetting(p, `[data-auto-group="limits"] ${input('claudeWeekly')}`); // 1.124.9: Unattended work holds Pause all and the limits
    await p.waitForSelector(`[data-settings-panel="unattended"]:not([hidden]) [data-auto-group="limits"] ${input('claudeWeekly')}`);
  };
  const closeSheet = async () => { await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.sheet')); };
  const status = group => p.$eval(`[data-auto-status="${group}"]`, e => e.textContent);
  const pauseFromMenu = async () => {
    await p.click('#listmore'); await p.waitForSelector('.more-menu [data-pause-toggle]');
    await p.click('.more-menu [data-pause-toggle]'); await p.waitForSelector('.pause-sheet [data-pause-would]');
  };
  await desk();

  console.log('Live: a queue drain says who started it in the list and in the chat');
  await home();
  await p.waitForFunction(id => document.querySelector(`[data-item="${id}"] .origin-label`), {}, queued);
  assert.equal(await p.$eval(`[data-item="${queued}"] .origin-label`, e => e.textContent), auto.originLabel('queue'));
  assert.equal(await p.$(`[data-item="${owner}"] .origin-label`), null, 'owner work has no label');
  assert.equal(await p.$(`[data-item="${hang}"] .origin-label`), null, 'a running owner reply has no label');
  await shot('list-origin-1440-dark');
  await chat(queued); await p.waitForFunction(() => document.querySelector('#origin-line')?.hidden === false);
  assert.equal(await p.$eval('#origin-line', e => e.textContent), 'Queued message');

  console.log('Live: Settings → Automation renders both groups from the server');
  await home(); await openAutomation();
  const served = (await call('/automation')).body;
  // 1.124.9: a feature's group is also in Features (its switch) and Tasks (its "in Tasks" switch), as sections of their own.
  assert.deepEqual(await p.$$eval('[data-auto-group]:not(.automation-switch):not([data-auto-group="approvalPush"])', e => e.map(x => x.dataset.autoGroup)), served.groups.map(g => g.key));
  assert.deepEqual(await p.$$eval('[data-auto-group]:not(.automation-switch):not([data-auto-group="approvalPush"]) > h3', e => e.map(x => x.textContent)), served.groups.map(g => g.title));
  // Job keys while off: the switch and its help only (its settings come with the switch on, under Advanced).
  const bareOff = g => g.key === 'jobs' && g.settings[0]?.value !== true;
  // Where each control is: a feature's own switch in Features, its "in Tasks" switch in Tasks, the rest in the group.
  const inTasks = { checkbacks: 'showInTasks', jobs: 'jobsInTasks' };
  for (const g of served.groups) for (const s of g.settings) {
    const where = s.key === g.key ? `.automation-switch[data-auto-group="${g.key}"]` : s.key === inTasks[g.key] ? `#s-tasks-auto .automation-switch[data-auto-group="${g.key}"]` : `[data-auto-group="${g.key}"]:not(.automation-switch)`;
    if (bareOff(g) && s.key !== g.key && s.key !== inTasks[g.key]) { assert.equal(await p.$(`${where} ${input(s.key)}`), null, `no control for ${g.key}.${s.key} while it is off`); continue; }
    assert.ok(await p.$(`${where} ${input(s.key)}`), `a control for ${g.key}.${s.key}`);
  }
  assert.ok(await p.$(`#s-checkbacks-switch ${input('checkbacks')}`) && await p.$(`#s-jobs-switch ${input('jobs')}`), 'the two feature switches are in Features');
  assert.equal(await p.$eval(input('ownMessages'), e => e.value), 'run');
  assert.deepEqual(await p.$$eval(`${input('ownMessages')} option`, e => e.map(o => o.textContent)), setting('pause', 'ownMessages').choices.map(c => c.label));
  assert.equal(await p.$eval(input('claudeWeekly'), e => e.value), '80');
  assert.equal(await p.$eval(input('confirm'), e => e.getAttribute('aria-pressed')), 'true');
  assert.equal(await p.$eval(input('staleHours'), e => e.checkVisibility()), false, 'an advanced setting starts under Advanced');
  await showSetting(p, '[data-auto-today]'); // the history is on the Usage page
  assert.equal(await p.$eval('[data-auto-today]', e => e.textContent), 'Today: 0 replies · $0.00');
  assert.equal(await p.$$eval('.automation-usage tbody tr', e => e.length), 7);
  assert.equal(await p.$eval('.automation-usage tbody tr th', e => e.textContent), await p.evaluate(d => new Date(d + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }), served.usage.days.at(-1).date), 'newest day first: the server sends oldest first');
  await showSetting(p, `[data-auto-group="limits"] ${input('claudeWeekly')}`);
  assert.equal(await p.$('.automation-warning:not([data-auto-group="approvalPush"] *)'), null);
  await p.$eval('#s-automation', e => e.scrollIntoView());
  await shot('automation-1440-dark');

  console.log('Live: a number saves; out of range shows the server\'s error and the old value returns');
  await setNumber('claudeWeekly', 70);
  await p.waitForFunction(() => document.querySelector('[data-auto-status="limits"]')?.textContent === 'Saved.');
  assert.equal(savedAutomation().limits.claudeWeekly, 70);
  assert.equal(await p.$eval(input('claudeWeekly'), e => e.value), '70');
  await setNumber('claudeWeekly', 150);
  await p.waitForFunction(() => document.querySelector('#auto-limits-claudeWeekly-err')?.textContent);
  assert.equal(await p.$eval('#auto-limits-claudeWeekly-err', e => e.textContent), auto.checkValue(setting('limits', 'claudeWeekly'), 150).error);
  assert.equal(await p.$eval(input('claudeWeekly'), e => e.value), '70');
  assert.equal(await p.$eval(input('claudeWeekly'), e => e.getAttribute('aria-invalid')), 'true');
  assert.equal(savedAutomation().limits.claudeWeekly, 70, 'nothing saved');
  await shot('automation-error-1440-dark');

  console.log('Live: No limit brings the server\'s warning; Reset to defaults clears it');
  await p.click('[data-auto-off="dailyReplies"]');
  await p.waitForSelector('.automation-warning:not([data-auto-group="approvalPush"] *)');
  assert.equal(savedAutomation().limits.dailyReplies, 'off');
  assert.deepEqual(await p.$$eval('.automation-warning:not([data-auto-group="approvalPush"] *)', e => e.map(x => x.textContent)), [`${setting('limits', 'dailyReplies').label} has no limit.`]);
  assert.equal(await p.$eval(input('dailyReplies'), e => e.disabled), true);
  await shot('automation-off-1440-dark');
  await p.click('[data-auto-reset="limits"]');
  await p.waitForFunction(() => document.querySelector('[data-auto-status="limits"]')?.textContent === 'Back to the defaults.');
  assert.equal(savedAutomation(), undefined, 'the saved values are gone');
  assert.equal(await p.$eval(input('claudeWeekly'), e => e.value), '80');
  assert.equal(await p.$('.automation-warning:not([data-auto-group="approvalPush"] *)'), null);
  await closeSheet();
  await phone(); await home(); await openAutomation(); await p.$eval('#s-automation', e => e.scrollIntoView());
  await shot('automation-390-dark');
  assert.equal(await p.$eval('.settings-sheet', e => e.scrollWidth <= e.clientWidth), true, 'no sideways scroll at 390');
  await closeSheet(); await desk();

  console.log('Live: Pause all from the More menu counts what runs, stops it, and shows the banner');
  await home();
  assert.equal(await p.$eval(`[data-item="${limited}"] .session-status`, e => e.textContent), 'Waiting for usage reset');
  await p.click('#listmore'); await p.waitForSelector('.more-menu [data-pause-toggle]');
  await shot('more-1440-dark');
  await p.click('.more-menu [data-pause-toggle]'); await p.waitForSelector('.pause-sheet [data-pause-would]');
  assert.equal(await p.$eval('[data-pause-would]', e => e.textContent), 'This stops 2 replies running (2 Claude). It holds 1 usage-limit retry.');
  assert.match(await p.$eval('.pause-sheet .sheet-help', e => e.textContent), /^Your own messages still run\./);
  await shot('confirm-1440-dark');
  await p.click('[data-pause-go]'); await p.waitForSelector('.pause-banner');
  await p.waitForFunction(() => !document.querySelector('.pause-sheet'));
  await p.waitForFunction(() => document.querySelector('#toast')?.textContent === 'Paused. Stopped 2 replies running (2 Claude). Held 1 usage-limit retry.');
  assert.ok((await call('/me')).body.paused?.at, '/api/me says paused');
  for (const id of [hang, queued]) await until(async () => { const s = await session(id); return s && !s.active && s.state?.kind !== 'running'; }, `${id} to stop`);
  await p.waitForFunction(id => /^Retry held$/.test(document.querySelector(`[data-item="${id}"] .session-status`)?.textContent || ''), {}, limited);
  assert.equal(await p.$eval(`[data-item="${limited}"] .session-status`, e => e.textContent), 'Retry held');
  assert.doesNotMatch(await p.$eval(`[data-item="${limited}"] .activity-detail`, e => e.textContent), /^Retry at/, 'a held retry has no retry time');
  assert.equal(await p.$eval(`[data-item="${queued}"] .origin-label`, e => e.textContent), 'Queued message', 'the stopped drain keeps its label');
  assert.equal(await p.$eval('.pause-banner .pause-text', e => e.textContent), 'Pocket is paused. Your own messages still run. 1 usage-limit retry is held.');
  await shot('banner-list-1440-dark');

  console.log('Live: a reload is still paused; the owner\'s own message runs');
  await p.reload(); await p.waitForSelector('.pause-banner');
  await chat(owner); await p.waitForSelector('.pause-banner');
  await shot('banner-chat-1440-dark');
  await p.type('#box', 'live owner while paused'); await p.click('#send');
  await until(() => claudeTexts().includes('live owner while paused'), 'the owner message to run');
  await until(async () => { const s = await session(owner); return s && !s.active && s.state?.kind !== 'running'; }, 'the owner reply to end');
  assert.equal((await call('/me')).body.paused !== null, true, 'still paused');
  await phone(); await home(); await p.waitForSelector('.pause-banner');
  await shot('banner-list-390-dark');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll with the banner');
  await chat(limited); await p.waitForSelector('.pause-banner');
  await p.waitForFunction(() => document.querySelector('#run-confirmed-state')?.textContent === 'Retry held');
  await shot('banner-chat-390-dark');
  await desk();

  console.log('Live: Resume from the banner');
  await p.click('.pause-banner [data-resume]'); await p.waitForFunction(() => !document.querySelector('.pause-banner'));
  assert.equal((await call('/me')).body.paused, null);
  assert.equal((await call('/pause')).body.held.retries, 0, 'the held retry is armed again');

  console.log('Live: with own messages Blocked a send is refused and the draft kept');
  await home(); await openAutomation();
  await p.select(input('ownMessages'), 'blocked');
  await p.waitForFunction(() => document.querySelector('[data-auto-status="pause"]')?.textContent === 'Saved.');
  assert.equal(savedAutomation().pause.ownMessages, 'blocked');
  await closeSheet();
  await pauseFromMenu();
  assert.match(await p.$eval('.pause-sheet .sheet-help', e => e.textContent), /^Your own messages wait until you resume\./);
  await p.click('[data-pause-go]'); await p.waitForSelector('.pause-banner');
  await chat(owner);
  await p.waitForFunction(() => /wait until you resume/.test(document.querySelector('.pause-banner .pause-text')?.textContent || ''));
  await p.type('#box', 'live blocked while paused'); await p.click('#send');
  await p.waitForFunction(() => /Pocket is paused/.test(document.querySelector('#delivery-status')?.textContent || ''));
  assert.equal(await p.$eval('#box', e => e.value), 'live blocked while paused', 'the draft stays');
  assert.ok(!claudeTexts().includes('live blocked while paused'), 'nothing reached the CLI');
  await shot('blocked-1440-dark');
  await p.click('.pause-banner [data-resume]'); await p.waitForFunction(() => !document.querySelector('.pause-banner'));
  assert.equal((await call('/me')).body.paused, null);
  assert.equal((await call('/automation/settings', { group: 'pause', reset: true })).status, 200);

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, automationLive: true, seconds: Math.round((Date.now() - t0) / 1000), screenshots: shots }));
} catch (e) { await p?.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => { }); console.error('Page URL:', p?.url(), 'Page errors:', errors); console.error('Server log tail:', logs.slice(-2000)); throw e; }
finally { await browser.close(); server.kill('SIGKILL'); await exited; fs.rmSync(dir, { recursive: true, force: true }); }
