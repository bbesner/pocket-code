// 1.119 check-backs, the app on the real server. The app half was built against synthetic responses
// (test/checkback-browser.mjs); this runs public/checkbacks.js and public/automation.js against the real server.mjs and the
// fake Claude Code CLI, so a field the app reads that the server does not send fails here. An agent sets real check-backs
// with the agent route (the CLI token plus its reply's runner token, as pocket-checkback does), and the check-back clock is
// moved with POCKET_TEST_CHECKBACK_CLOCK, so nothing waits a real minute. It follows the owner: switch Check-backs on in
// Settings; the card under the message whose reply set it; Cancel on the card; a check-back that runs (Checking back now,
// then Checked back, in place); the list row's clock; the Tasks group and its Cancel; Cancel all; Pause all counting it;
// the push toggle; and switched off, none of it but the push toggle. Screenshots go to POCKET_CHECKBACK_LIVE_SHOTS
// (default /tmp/unattended-1.119-shots/live).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { killStrays } from './stray-runners.mjs';
import { createHmac, createECDH, randomBytes } from 'node:crypto';
import puppeteer from 'puppeteer-core';
import { showSetting } from './ui-controls.mjs';
import webpush from 'web-push';

const repo = path.resolve(import.meta.dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'checkback-live-')));
const home = path.join(dir, 'home'), cwd = path.join(home, 'work'), data = path.join(dir, 'data'), clock = path.join(dir, 'clock'), hangFile = path.join(dir, 'hang');
for (const d of [home, cwd, data, path.join(home, 'pocket-uploads'), path.join(dir, 'sessions'), path.join(dir, 'documents')]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(clock, '0');
const shots = process.env.POCKET_CHECKBACK_LIVE_SHOTS || '/tmp/unattended-1.119-shots/live'; fs.mkdirSync(shots, { recursive: true });
const secret = 'checkback-live-secret', port = 19021, base = `http://127.0.0.1:${port}`;
const exp = String(Date.now() + 3600_000), cookie = exp + '.' + createHmac('sha256', secret).update(exp).digest('hex');
// One subscribed device (this page). Nothing listens at its endpoint: the check is what the app reads and saves.
const device = createECDH('prime256v1'); device.generateKeys();
const endpoint = 'https://127.0.0.1:9/push/this-device', vapid = webpush.generateVAPIDKeys();
fs.writeFileSync(path.join(data, 'push-subs.json'), JSON.stringify([{ endpoint, keys: { p256dh: device.getPublicKey('base64url'), auth: randomBytes(16).toString('base64url') } }]));

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE|OPENCODE|FAKE)_/.test(k)));
const server = spawn(process.execPath, ['server.mjs'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: {
  ...env, HOME: home, PORT: String(port), POCKET_SKILLS: '0', POCKET_UPDATE_CHECK: '0', POCKET_ENV_FILE: '', POCKET_AUTO_TITLES: '0',
  POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret, POCKET_CODEX: '0', POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: data,
  POCKET_DOCUMENTS_DIR: path.join(dir, 'documents'), POCKET_TEST_CALLS: path.join(dir, 'calls'), CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'),
  POCKET_CHECKBACK_TICK_MS: '200', POCKET_TEST_CHECKBACK_CLOCK: clock, FAKE_CLAUDE_HANG_FILE: hangFile,
  VAPID_PUBLIC: vapid.publicKey, VAPID_PRIVATE: vapid.privateKey,
} });
let logs = ''; server.stdout.on('data', d => logs += d); server.stderr.on('data', d => logs += d);
const exited = new Promise(r => server.once('exit', r));
for (let i = 0; ; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { } if (i > 300) throw new Error('server did not start: ' + logs); await sleep(30); }

const call = async (p, body, headers = { cookie: 'pc_auth=' + cookie }) => {
  const r = await fetch(base + '/api' + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { } return { status: r.status, body: j };
};
const until = async (fn, what, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}; log tail: ${logs.slice(-1500)}`); await sleep(60); } };
const e = id => encodeURIComponent(id);
const session = id => call('/session/' + e(id)).then(r => r.body);
const idle = id => until(async () => { const s = await session(id); return s && !s.active && s.state?.kind !== 'running' ? s : null; }, `${id} to end`);
const start = async text => { const r = await call('/new', { provider: 'claude', cwd, text, approvalMode: 'full' }); assert.equal(r.status, 202, JSON.stringify(r.body)); return r.body.id; };
const send = async (id, text) => { const r = await call(`/session/${e(id)}/message`, { text, approvalMode: 'full' }); assert.equal(r.status, 202, JSON.stringify(r.body)); };
const calls = () => { try { return fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const tokenFor = (id, text) => until(() => calls().filter(c => c.id === id && (c.text || '').includes(text)).at(-1)?.runnerToken, `the runner token for "${text}"`);
const bearer = () => ({ authorization: 'Bearer ' + fs.readFileSync(path.join(data, 'cli-token'), 'utf8').trim() });
// The owner asks; the agent, mid-reply, sets a check-back with the command's route; the reply is then stopped.
const ownerSets = async (id, text, at, note) => {
  await send(id, text + ' __HANG__');
  const token = await tokenFor(id, text);
  const r = await call('/checkbacks/agent/add', { at, note }, { ...bearer(), 'x-pocket-runner': token });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await call(`/session/${e(id)}/stop`, {})).status, 200); await idle(id);
  return r.body.checkback;
};
const one = async id => (await call('/checkbacks')).body.checkbacks.find(c => c.id === id);
const advance = ms => fs.writeFileSync(clock, String(Number(fs.readFileSync(clock, 'utf8')) + ms));
// The words for a time, as the page (in UTC) says them: "at 2:30 PM" today, "Nov 22, 9:00 AM" another day.
const clockText = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).replace(/ /g, ' ');
const isToday = iso => new Date(iso).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
const dayText = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + ', ' + clockText(iso);
const willText = iso => 'Will check back ' + (isToday(iso) ? 'at ' + clockText(iso) : dayText(iso));
const backText = iso => 'Checked back ' + (isToday(iso) ? clockText(iso) : dayText(iso));

const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
const errors = [], t0 = Date.now();
let p = null;
try {
  // ---- the conversation: an owner reply that finished, pinned so the /tmp list shows it ----
  const convo = await start('live checkback hello');
  await idle(convo);
  assert.equal((await call(`/session/${e(convo)}/pin`, { pinned: true })).status, 200);
  assert.equal((await call('/settings', { tasks: true })).status, 200);

  p = await browser.newPage(); p.setDefaultTimeout(10000);
  p.on('pageerror', x => errors.push(x.message));
  await p.emulateTimezone('UTC');
  await p.setCookie({ name: 'pc_auth', value: cookie, url: base });
  await p.evaluateOnNewDocument(ep => {
    localStorage.setItem('pc-theme', '"dark"');
    // This page is the subscribed device (the real Push API needs a push service; the server side is real).
    addEventListener('DOMContentLoaded', () => { window.pushRegistration = async () => ({ pushManager: { getSubscription: async () => ({ endpoint: ep }) } }); });
  }, endpoint);
  await p.setViewport({ width: 1440, height: 900, isMobile: false, hasTouch: false });
  const shot = async name => { await p.evaluate(() => document.querySelector('#toast')?.classList.remove('show')); await p.screenshot({ path: path.join(shots, name + '.png') }); };
  const homeList = async () => { await p.goto(base + '/#/all'); await p.waitForSelector(`.session-home [data-item="${convo}"]`); };
  const chat = async () => { await p.goto(base + '/#/chat/' + e(convo)); await p.waitForSelector('#box'); await p.waitForSelector('#msgs .m-user'); };
  const card = id => `#msgs > [data-checkback="${id}"]`;
  const cardText = id => p.$eval(card(id) + ' .checkback-text', x => x.textContent).catch(() => null);
  // 1.124.9: the switch is a row of Settings → Features; the group (its settings, Reset, Cancel all) is its page under Features.
  const SWITCH = '#s-checkbacks-switch [data-auto-key="checkbacks"]', FULL = '[data-auto-group="checkbacks"]:not(.automation-switch)';
  const automation = async () => { await p.evaluate(() => settingsSheet({ category: 'features' })); await showSetting(p, SWITCH); };
  const checkbackPage = async () => { await p.evaluate(() => settingsSheet({ category: 'f-checkbacks' })); await showSetting(p, FULL); };
  const closeSheet = async () => { await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.sheet')); };

  console.log('Live: switched off, none of it shows');
  await homeList();
  assert.equal(await p.evaluate(() => window.pocketFeatures.checkbacks), false);
  await automation();
  assert.equal(await p.$eval(SWITCH, x => x.getAttribute('aria-pressed')), 'false');
  await closeSheet(); await checkbackPage();
  const served = (await call('/automation')).body;
  assert.deepEqual(await p.$$eval('[data-auto-group]:not(.automation-switch):not([data-auto-group="approvalPush"])', x => x.map(g => g.dataset.autoGroup)), served.groups.map(g => g.key));
  assert.equal(await p.$eval(FULL, x => x.classList.contains('automation-group-off')), true);
  assert.ok(await p.$('[data-auto-group="pause"] [data-auto-key="runOverdue"]'), 'On Resume, run late check-backs, from the schema');

  console.log('Live: the switch turns it on, and the page follows without a reload');
  await closeSheet(); await automation();
  await p.click(SWITCH);
  await p.waitForFunction(s => document.querySelector(s)?.getAttribute('aria-pressed') === 'true', {}, SWITCH);
  assert.equal((await call('/me')).body.features.checkbacks, true);
  await p.waitForFunction(() => window.pocketFeatures.checkbacks === true);
  assert.equal(await p.$eval('#s-checkbacks-switch .vault-field-error', x => x.textContent), '', 'no error beside the switch');
  // the spacing between overdue ones, out of range then in (on the page under Features)
  await showSetting(p, FULL + ' [data-auto-advanced]');
  await p.$eval('[data-auto-advanced="checkbacks"]', x => { x.open = true; });
  await p.$eval('[data-auto-key="spacingSec"]', x => { x.focus(); x.value = '900'; x.dispatchEvent(new Event('change')); });
  await p.waitForFunction(() => document.querySelector('#auto-checkbacks-spacingSec-err')?.textContent);
  assert.match(await p.$eval('#auto-checkbacks-spacingSec-err', x => x.textContent), /must be 0 s to 300 s|must be 0 to 300/);
  await p.$eval('[data-auto-key="spacingSec"]', x => { x.focus(); x.value = '0'; x.dispatchEvent(new Event('change')); });
  await p.waitForFunction(() => document.querySelector('[data-auto-status="checkbacks"]')?.textContent === 'Saved.' && !document.querySelector('#auto-checkbacks-spacingSec-err')?.textContent);
  assert.equal((await call('/automation')).body.groups.find(g => g.key === 'checkbacks').settings.find(s => s.key === 'spacingSec').value, 0);
  await shot('settings-on-1440-dark');
  await closeSheet();

  console.log('Live: an agent sets one; the card is under the message whose reply set it');
  const a = await ownerSets(convo, 'live set one for later', '+30m', 'Confirm the status page shows the new version');
  await send(convo, 'live a later message'); await idle(convo);
  await chat(); await p.waitForSelector(card(a.id));
  assert.equal(await cardText(a.id), willText(a.dueAt));
  const order = await p.$$eval('#msgs > :is(.m-user,[data-checkback])', x => x.map(m => m.dataset.checkback || m.textContent.trim().replace(/\s*\d{1,2}:\d{2}\s*[AP]M$/, '')));
  const at = order.indexOf(a.id);
  assert.ok(at > 0 && order[at - 1].startsWith('live set one for later') && order[at + 1].startsWith('live a later message'), `between the message that set it and the next (${order.join(' | ')})`);
  assert.match(await p.$eval(card(a.id) + ' time', x => x.title), /UTC$/, 'the full date and time in a title');
  await shot('card-waiting-1440-dark');
  // an unchanged refresh writes nothing in the card
  const writes = await p.evaluate(async sel => {
    const el = document.querySelector(sel), recs = [], mo = new MutationObserver(r => recs.push(...r));
    mo.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
    for (let i = 0; i < 2; i++) { await refreshSessions(); await CheckBacks.refresh(); }
    await new Promise(r => setTimeout(r, 80)); recs.push(...mo.takeRecords()); mo.disconnect();
    return { kept: el.isConnected && document.querySelector(sel) === el, n: recs.length };
  }, card(a.id));
  assert.deepEqual(writes, { kept: true, n: 0 }, 'the card is not rewritten');

  console.log('Live: Cancel on the card; it says Cancelled in place');
  await p.click(card(a.id) + ' [data-checkback-cancel]');
  await p.waitForFunction(s => document.querySelector(s + ' .checkback-text')?.textContent === 'Cancelled', {}, card(a.id));
  assert.equal((await one(a.id)).status, 'cancelled');
  await shot('card-cancelled-1440-dark');

  console.log('Live: the row clock appears with a waiting one');
  const b = await ownerSets(convo, 'live set one that runs', '+5m', 'Check the import finished');
  await homeList();
  await p.waitForSelector(`[data-item="${convo}"] .checkback-clock`);
  assert.equal(await p.$eval(`[data-item="${convo}"] .checkback-clock`, x => x.getAttribute('aria-label')), 'Check-back ' + (isToday(b.dueAt) ? 'at ' + clockText(b.dueAt) : dayText(b.dueAt)));
  await shot('row-1440-dark');

  console.log('Live: it runs: Checking back now, then Checked back, in place');
  await chat(); await p.waitForSelector(card(b.id));
  const node = await p.$(card(b.id)), h0 = await node.evaluate(x => x.getBoundingClientRect().height);
  fs.writeFileSync(hangFile, '1'); // the check-back's reply keeps running until stopped
  advance(6 * 60_000);
  await until(async () => (await one(b.id))?.status === 'running', 'the check-back to run');
  await p.waitForFunction(s => document.querySelector(s + ' .checkback-text')?.textContent === 'Checking back now', { timeout: 15000 }, card(b.id));
  // 1.124.5: the page now reads the conversation again when a reply starts that it did not send (so it shows Working
  // and Stop), which redraws the transcript. The card is the same card to the eye: one of it, same place in the
  // transcript, same height, no fade-in.
  const seen = async () => p.evaluate(s => { const all = [...document.querySelectorAll(s)], x = all[0]; return { count: all.length, state: x?.dataset.state, height: x?.getBoundingClientRect().height, fading: Boolean(x?.closest('.enter')) }; }, card(b.id));
  assert.deepEqual(await seen(), { count: 1, state: 'running', height: h0, fading: false }, 'the same card, no shift');
  await shot('card-running-1440-dark');
  fs.rmSync(hangFile);
  assert.equal((await call(`/session/${e(convo)}/stop`, {})).status, 200); await idle(convo);
  const ran = await until(async () => { const c = await one(b.id); return c?.status === 'done' ? c : null; }, 'the check-back to finish');
  await p.waitForFunction((s, w) => document.querySelector(s + ' .checkback-text')?.textContent === w, { timeout: 15000 }, card(b.id), backText(ran.startedAt) + (ran.outcome?.kind === 'stopped' ? ' · stopped' : ''));
  { const { count, height, fading } = await seen(); assert.deepEqual({ count, height, fading }, { count: 1, height: h0, fading: false }, 'the same card, no shift'); }
  await shot('card-done-stopped-1440-dark');
  // One that runs to the end says plainly that it checked back.
  const c = await ownerSets(convo, 'live set one that finishes', '+5m', 'Look at the nightly report');
  await chat(); await p.waitForSelector(card(c.id));
  advance(6 * 60_000);
  const fin = await until(async () => { const x = await one(c.id); return x?.status === 'done' ? x : null; }, 'the check-back to finish');
  await p.waitForFunction((s, w) => document.querySelector(s + ' .checkback-text')?.textContent === w, { timeout: 15000 }, card(c.id), backText(fin.startedAt));
  await shot('card-done-1440-dark');
  await homeList();
  await p.waitForFunction(id => !document.querySelector(`[data-item="${id}"] .checkback-clock`), {}, convo);

  console.log('Live: the Tasks group, and its Cancel');
  const d = await ownerSets(convo, 'live set one for tasks', '+2h', 'Recount aisle 4 after the delivery');
  await p.goto(base + '/#/tasks'); await p.waitForSelector('.checkback-group');
  assert.equal(await p.$eval('#tk-checkbacks-h', x => x.textContent), 'Check-backs 1');
  assert.equal(await p.$eval(`[data-checkback-item="${d.id}"] .title`, x => x.textContent), 'Recount aisle 4 after the delivery');
  assert.equal(await p.$eval(`[data-checkback-item="${d.id}"] a.row`, x => x.getAttribute('href')), '#/chat/' + e(convo));
  await shot('tasks-1440-dark');
  await p.click(`[data-checkback-item="${d.id}"] [data-checkback-cancel]`);
  await p.waitForFunction(() => !document.querySelector('.checkback-group'));
  assert.equal((await one(d.id)).status, 'cancelled');

  console.log('Live: Pause all counts check-backs; the banner holds them; Resume');
  const f1 = await ownerSets(convo, 'live set one to hold', '+1h', 'Check the supplier feed');
  await homeList();
  await p.click('#listmore'); await p.waitForSelector('.more-menu [data-pause-toggle]');
  await p.click('.more-menu [data-pause-toggle]'); await p.waitForSelector('.pause-sheet [data-pause-would]');
  assert.equal(await p.$eval('[data-pause-would]', x => x.textContent), 'This holds 1 check-back.');
  await shot('pause-sheet-1440-dark');
  await p.click('[data-pause-go]'); await p.waitForSelector('.pause-banner');
  await p.waitForFunction(() => document.querySelector('#toast')?.textContent === 'Paused. Held 1 check-back.');
  await p.waitForFunction(() => document.querySelector('.pause-banner .pause-text')?.textContent === 'Pocket is paused. Your own messages still run. 1 check-back is held.');
  await chat(); await p.waitForFunction((s, w) => document.querySelector(s + ' .checkback-text')?.textContent === w, {}, card(f1.id), willText(f1.dueAt) + ' · held while Pocket is paused');
  await shot('card-held-1440-dark');
  await p.click('.pause-banner [data-resume]'); await p.waitForFunction(() => !document.querySelector('.pause-banner'));
  await p.waitForFunction((s, w) => document.querySelector(s + ' .checkback-text')?.textContent === w, { timeout: 15000 }, card(f1.id), willText(f1.dueAt));

  console.log('Live: Cancel all from Settings');
  const f2 = await ownerSets(convo, 'live set a second one', '+3h', 'Check the overnight sync');
  await homeList(); await checkbackPage(); await showSetting(p, '[data-checkbacks-waiting]');
  assert.equal(await p.$eval('.automation-waiting-count', x => x.textContent), '2 waiting');
  await p.click('[data-checkbacks-cancel-all]'); await p.waitForSelector('.sheet [data-yes]');
  assert.equal(await p.$eval('.sheet:has([data-yes]) h2', x => x.textContent), 'Cancel 2 check-backs?');
  await p.click('.sheet [data-yes]');
  await p.waitForFunction(() => document.querySelector('#toast')?.textContent === 'Cancelled 2 check-backs.');
  assert.deepEqual([(await one(f1.id)).status, (await one(f2.id)).status], ['cancelled', 'cancelled']);
  await p.waitForSelector('.settings-sheet ' + FULL); // back to Settings → Features → Check-backs
  assert.equal(await p.$('[data-checkbacks-waiting]'), null, 'nothing waiting now');
  await closeSheet();

  console.log('Live: the push toggle saves for this device');
  await p.evaluate(() => settingsSheet({ category: 'notifications' }));
  await p.waitForFunction(() => document.querySelector('#s-push-automation')?.disabled === false);
  assert.equal(await p.$eval('#s-push-automation', x => x.hidden), false);
  assert.equal(await p.$eval('#s-push-automation', x => x.getAttribute('aria-pressed')), 'true', 'on by default');
  await p.click('#s-push-automation');
  await p.waitForFunction(() => document.querySelector('#s-push-automation').getAttribute('aria-pressed') === 'false');
  const saved = JSON.parse(fs.readFileSync(path.join(data, 'push-subs.json'), 'utf8')).find(s => s.endpoint === endpoint);
  assert.equal(saved.kinds?.automation, false, 'saved on the server for this device');
  await shot('push-1440-dark');
  await closeSheet();

  console.log('Live: switched off again, the cards, the clock and the group go');
  const g = await ownerSets(convo, 'live set one before off', '+1h', 'Check the backup');
  await automation(); await p.click(SWITCH);
  await p.waitForFunction(() => window.pocketFeatures.checkbacks === false);
  await closeSheet();
  assert.equal(await p.$('.checkback-clock'), null);
  await chat(); assert.equal(await p.$('#msgs > [data-checkback]'), null);
  await p.goto(base + '/#/tasks'); await p.waitForSelector('#tasks-main'); assert.equal(await p.$('.checkback-group'), null);
  await p.evaluate(() => settingsSheet({ category: 'notifications' })); await p.waitForSelector('#s-push-alerts');
  assert.equal(await p.$eval('#s-push-automation', x => x.hidden), false, 'the push toggle stays while off (it also carries the limit notices)');
  assert.ok(g.id);

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, checkbackLive: true, seconds: Math.round((Date.now() - t0) / 1000), screenshots: shots }));
} catch (x) { await p?.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => { }); console.error('Page URL:', p?.url(), 'Page errors:', errors); console.error('Server log tail:', logs.slice(-2000)); throw x; }
finally { await browser.close(); server.kill('SIGKILL'); await exited; killStrays(data); fs.rmSync(dir, { recursive: true, force: true }); } // the detached fake CLIs and keepers too (test/stray-runners.mjs)
