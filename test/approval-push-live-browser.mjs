// 1.126 Answers from notifications, the app on the real server (docs/plans/notification-approvals.md, Testing 26 and 27).
// public/approvals.js, public/automation.js and public/app.js run against the real server.mjs, the fake Claude Code CLI
// and a push service on this machine that decrypts every payload, so the test reads the codes the device test sent, as a
// person reads them off the notification. It follows the owner:
//   27: Settings → Features → Answers from notifications (every setting saves, refuses out of range and resets; raising
//       the longest action warns before saving and reports the devices turned off after), Notifications → This device
//       only (Action approvals, the Allow button: the test notification and its two codes, wrong codes, five wrong tries,
//       an expired test, a changed limit, an undelivered test, success, needs a new test, Off, the test link), and Usage →
//       Answered away from the app (empty, then with rows).
//   26: an approval link with ?missed=<why> shows its line above the request's card and moves focus to it, for every why;
//       the line stays, focused, through a reload of the list; it is text, never HTML; a link more than 60 seconds old
//       opens nothing, unless a sign-in on Pocket's own screen came in between; a link without missed opens nothing for a
//       request that no longer waits; a conversation title in Answered away from the app is text, never HTML.
// Screenshots at 1440 and 390 go to POCKET_APPROVAL_PUSH_SHOTS (default /tmp/np-shots). axe runs on every new screen in
// dark and light. With POCKET_DESIGN_DETECT (the path of impeccable's launcher), the design detector scans the rendered
// screens through Chrome's DevTools port and its findings are written beside the screenshots.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { createHmac, createECDH, randomBytes } from 'node:crypto';
import puppeteer from 'puppeteer-core';
import webpush from 'web-push';
import ece from 'http_ece';
import { killStrays } from './stray-runners.mjs';
import { showSetting } from './ui-controls.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apush-live-')));
const home = path.join(dir, 'home'), cwd = path.join(home, 'work'), data = path.join(dir, 'data');
for (const d of [home, cwd, data, path.join(home, 'pocket-uploads'), path.join(dir, 'sessions'), path.join(dir, 'documents')]) fs.mkdirSync(d, { recursive: true });
const shots = process.env.POCKET_APPROVAL_PUSH_SHOTS || '/tmp/np-shots'; fs.mkdirSync(shots, { recursive: true });
const secret = 'apush-live-secret', port = 19241, base = `http://127.0.0.1:${port}`;
const exp = String(Date.now() + 3600_000), cookie = exp + '.' + createHmac('sha256', secret).update(exp).digest('hex');

// ---- a push service on this machine: every push is decrypted and kept; `fail` makes one device's push refused ----
const devices = new Map(), got = [], fail = new Map();
const certDir = path.join(dir, 'cert'); fs.mkdirSync(certDir);
execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', path.join(certDir, 'key.pem'), '-out', path.join(certDir, 'cert.pem'), '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
const pushServer = https.createServer({ key: fs.readFileSync(path.join(certDir, 'key.pem')), cert: fs.readFileSync(path.join(certDir, 'cert.pem')) }, (req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const name = req.url.split('/').pop(), d = devices.get(name);
    let payload; try { payload = JSON.parse(ece.decrypt(Buffer.concat(chunks), { version: 'aes128gcm', privateKey: d.ecdh, authSecret: d.auth }).toString('utf8')); } catch (err) { payload = { error: err.message }; }
    const status = fail.get(name) || 201;
    got.push({ device: name, payload, accepted: status < 300 });
    res.writeHead(status); res.end();
  });
});
await new Promise(r => pushServer.listen(0, '127.0.0.1', r));
const pushHost = `127.0.0.1:${pushServer.address().port}`;
const endpointOf = name => `https://${pushHost}/push/${name}`;
const subOf = name => {
  if (!devices.has(name)) { const ecdh = createECDH('prime256v1'); ecdh.generateKeys(); devices.set(name, { ecdh, auth: randomBytes(16).toString('base64url') }); }
  const d = devices.get(name); return { endpoint: endpointOf(name), keys: { p256dh: d.ecdh.getPublicKey('base64url'), auth: d.auth } };
};
const subsFile = path.join(data, 'push-subs.json');
const subs = () => JSON.parse(fs.readFileSync(subsFile, 'utf8'));
const writeSubs = rows => fs.writeFileSync(subsFile, JSON.stringify(rows));
// This page is device "page" (untested); "other" is a phone tested at 80 characters.
writeSubs([subOf('page'), { ...subOf('other'), approvalAllow: { limit: 80, at: '2026-11-20T12:00:00.000Z' } }]);
const pageEndpoint = endpointOf('page');
const vapid = webpush.generateVAPIDKeys();

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE|OPENCODE|FAKE)_/.test(k)));
const server = spawn(process.execPath, ['server.mjs'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: {
  ...env, HOME: home, PORT: String(port), POCKET_SKILLS: '0', POCKET_UPDATE_CHECK: '0', POCKET_ENV_FILE: '', POCKET_AUTO_TITLES: '0',
  POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret, POCKET_CODEX: '0', POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: data,
  POCKET_DOCUMENTS_DIR: path.join(dir, 'documents'), POCKET_TEST_CALLS: path.join(dir, 'calls'), CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'),
  POCKET_RETRY_BUFFER_MS: '0', VAPID_PUBLIC: vapid.publicKey, VAPID_PRIVATE: vapid.privateKey, NODE_TLS_REJECT_UNAUTHORIZED: '0',
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
// every regex metacharacter, the backslash included, so a value matches only as itself
const reEscape = v => String(v).replace(/[\\^$.*+?()[\]{}|\/-]/g, '\\$&');
const values = async () => Object.fromEntries((await call('/approval-push')).body.groups[0].settings.map(s => [s.key, s.value]));
const DEFAULTS = { answers: false, show: 'action', allowFor: 30, checkbacks: true, jobs: false, engineClaude: true, engineCodex: true, engineOpenrouter: true, engineAntigravity: true, longestAction: 80, perConversation: 3, updateOthers: true };
const waitingIn = id => until(async () => { const r = (await call(`/session/${e(id)}/approvals`)).body?.requests || []; return r.length ? r : null; }, 'an approval in ' + id);
const startWaiting = async (text, command) => {
  const r = await call('/new', { provider: 'claude', cwd, text: text + ' __TOOLREQ__ ' + JSON.stringify({ tool: 'Bash', input: { command } }), approvalMode: 'review' });
  assert.equal(r.status, 202, JSON.stringify(r.body)); const id = r.body.id; return { id, req: (await waitingIn(id))[0] };
};
const testCodes = async n => { const sent = await until(() => { const l = got.filter(g => g.device === 'page' && g.payload.tag === 'approval-test'); return l.length >= n ? l.at(-1) : null; }, 'the test notification'); const [run, dirLine] = sent.payload.body.split('\n'); return [run.slice(-2), dirLine.slice(-2), sent.payload]; };

const DETECT = process.env.POCKET_DESIGN_DETECT || '', CDP = 19243;
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox', ...(DETECT ? [`--remote-debugging-port=${CDP}`] : [])] });
const errors = [], t0 = Date.now(), scans = [];
let p = null;
try {
  p = await browser.newPage(); p.setDefaultTimeout(10000);
  p.on('pageerror', x => errors.push(x.message));
  await p.setBypassCSP(true); // the real server's CSP blocks the injected axe
  await p.emulateTimezone('UTC');
  await p.setCookie({ name: 'pc_auth', value: cookie, url: base });
  await p.evaluateOnNewDocument(ep => {
    if (!localStorage.getItem('pc-theme')) localStorage.setItem('pc-theme', '"dark"');
    // This page is the subscribed device "page" (the real Push API needs a real push service; the server side is real).
    addEventListener('DOMContentLoaded', () => { window.pushRegistration = async () => ({ pushManager: { getSubscription: async () => ({ endpoint: ep, unsubscribe: async () => true }) } }); });
  }, pageEndpoint);
  const desk = () => p.setViewport({ width: 1440, height: 900, isMobile: false, hasTouch: false });
  const phone = () => p.setViewport({ width: 390, height: 844, isMobile: false, hasTouch: false });
  const theme = mode => p.evaluate(m => PocketTheme.setPreference(m), mode);
  await desk();
  const hideToast = () => p.evaluate(() => document.querySelector('#toast')?.classList.remove('show'));
  const shot = async name => { await hideToast(); await sleep(150); await p.screenshot({ path: path.join(shots, name + '.png') }); };
  // At 1440 and 390 (dark), with `focus` scrolled to the middle first.
  const twoWidths = async (name, focus) => {
    for (const [w, set] of [['1440', desk], ['390', phone]]) { await set(); await sleep(150); if (focus) await p.$eval(focus, x => x.scrollIntoView({ block: 'center' })); await shot(`${name}-${w}`); }
    await desk();
  };
  const axeOn = async (name, sel) => {
    if (!await p.evaluate(() => typeof axe !== 'undefined')) await p.addScriptTag({ path: path.join(repo, 'node_modules/axe-core/axe.min.js') });
    for (const mode of ['dark', 'light']) {
      await theme(mode); await sleep(250);
      assert.deepEqual(await p.evaluate(async s => (await axe.run(s)).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => [n.target, n.any?.[0]?.message || '']) })), sel), [], `axe (${mode}): ${name}`);
    }
    await theme('dark');
  };
  const detect = async name => {
    if (!DETECT) return;
    for (const [w, set] of [['1440', desk], ['390', phone]]) {
      await set(); await sleep(250);
      const r = spawnSync(DETECT, ['detect', '--json', '--cdp', String(CDP), '--target', '127.0.0.1:' + port], { encoding: 'utf8', timeout: 120000 });
      let findings; try { findings = JSON.parse(r.stdout); } catch { findings = { raw: r.stdout, stderr: r.stderr, status: r.status }; }
      scans.push({ name: `${name}-${w}`, findings }); fs.writeFileSync(path.join(shots, `design-${name}-${w}.json`), JSON.stringify(findings, null, 1));
    }
    await desk();
  };
  const closeSheet = async () => { await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.sheet')); };
  // The status line is emptied first, so a wait for "Saved." waits for this save, not the last one.
  const setValue = (sel, v) => p.$eval(sel, (x, v) => { const st = document.querySelector('[data-auto-status="approvalPush"]'); if (st) st.textContent = ''; x.focus(); x.value = v; x.dispatchEvent(new Event('input', { bubbles: true })); x.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const typeValue = (sel, v) => p.$eval(sel, (x, v) => { x.focus(); x.value = v; x.dispatchEvent(new Event('input', { bubbles: true })); }, v);
  const text = sel => p.$eval(sel, x => x.textContent);
  const PAGE = '#s-answers-auto [data-auto-group="approvalPush"]', STATUS = '[data-auto-status="approvalPush"]', LIST_SWITCH = '#s-answers-switch [data-auto-key="answers"]';
  const status = () => text(STATUS);
  const savedAs = async want => { await p.waitForFunction((s, w) => document.querySelector(s)?.textContent === w, {}, STATUS, want); };
  const answersPage = async () => { await p.evaluate(() => settingsSheet({ category: 'f-answers' })); await showSetting(p, PAGE); };
  const rowErr = key => text(`#auto-approvalPush-${key}-err`);
  await p.goto(base + '/#/all'); await p.waitForSelector('.session-home');

  console.log('27: Usage → Answered away from the app, empty');
  await p.evaluate(() => settingsSheet({ category: 'usage' }));
  await p.waitForSelector('#s-answers-usage .automation-usage');
  assert.equal(await text('#auto-answers-h'), 'Answered away from the app');
  assert.equal(await p.$eval('#s-answers-usage .automation-usage', x => x.lastElementChild.textContent), 'No approvals were answered away from the app in the last 7 days.');
  await twoWidths('usage-empty', '#s-answers-usage');
  await axeOn('usage-empty', '#s-answers-usage');
  await closeSheet();

  console.log('27: Features lists the switch, off; its › opens the page');
  await p.evaluate(() => settingsSheet({ category: 'features' }));
  await showSetting(p, LIST_SWITCH);
  assert.equal(await p.$eval(LIST_SWITCH, x => x.getAttribute('aria-pressed')), 'false');
  assert.match(await p.$eval(LIST_SWITCH, x => x.textContent), /^Answer approvals from notifications/);
  await p.click('.feature-row[data-feature="f-answers"] .feature-open');
  await p.waitForSelector('[data-settings-panel="f-answers"]:not([hidden]) ' + PAGE);
  assert.equal(await text('#sheet-title'), 'Answers from notifications');
  assert.equal(await text('#ap-lead'), "Answer an agent's action approval from its notification, without opening Pocket. Allow appears only on a device you tested, only for a short action in plain characters, once per request, and never as Always allow. Don't allow appears on every approval notification.");
  assert.equal(await p.$eval(PAGE, x => x.classList.contains('automation-group-off')), true, 'reads inactive while off');
  assert.equal(await text(PAGE + ' .automation-inactive-note'), 'These apply when Answer approvals from notifications is on.');
  const shownKeys = await p.$$eval(PAGE + ' [data-auto-key]', x => x.map(k => k.dataset.autoKey));
  assert.deepEqual(shownKeys, ['answers', 'show', 'allowFor', 'checkbacks', 'jobs', 'longestAction', 'perConversation', 'updateOthers', 'engineClaude', 'engineCodex', 'engineOpenrouter', 'engineAntigravity'], 'every setting, the Engines last under Advanced');
  assert.deepEqual(await p.$$eval(PAGE + ' [data-auto-advanced] [data-auto-key]', x => x.map(k => k.dataset.autoKey)), ['longestAction', 'perConversation', 'updateOthers', 'engineClaude', 'engineCodex', 'engineOpenrouter', 'engineAntigravity']);
  assert.equal(await text(PAGE + ' [data-auto-advanced] h4'), 'Engines');
  assert.match(await text('#auto-approvalPush-jobs'), /Covers every reply in a conversation a job has run in/);

  console.log('27: the switch on the page turns it on; the one in Features follows');
  await p.click(PAGE + ' [data-auto-key="answers"]');
  await savedAs('Saved.');
  assert.equal((await call('/approval-push')).body.on, true);
  assert.equal(await p.$eval(LIST_SWITCH, x => x.getAttribute('aria-pressed')), 'true');
  assert.equal(await p.$eval(PAGE, x => x.classList.contains('automation-group-off')), false);
  await twoWidths('features-page', '#ap-lead');
  await axeOn('features-page', '[data-settings-panel="f-answers"]');
  await detect('features-page');

  console.log('27: each setting saves and refuses out of range');
  await setValue(PAGE + ' [data-auto-key="show"]', 'waits'); await savedAs('Saved.');
  assert.equal((await values()).show, 'waits');
  await setValue(PAGE + ' [data-auto-key="allowFor"]', '4');
  await p.waitForFunction(() => document.querySelector('#auto-approvalPush-allowFor-err')?.textContent);
  assert.equal(await rowErr('allowFor'), 'Allow works for must be 5 min to 240 min.');
  assert.equal(await p.$eval(PAGE + ' [data-auto-key="allowFor"]', x => [x.value, x.getAttribute('aria-invalid')].join()), '30,true', 'the old value returns, marked');
  assert.equal((await values()).allowFor, 30, 'nothing saved');
  await setValue(PAGE + ' [data-auto-key="allowFor"]', '45'); await savedAs('Saved.');
  assert.equal(await rowErr('allowFor'), '');
  assert.equal((await values()).allowFor, 45);
  await p.click(PAGE + ' [data-auto-key="checkbacks"]'); await p.waitForFunction(s => document.querySelector(s)?.getAttribute('aria-pressed') === 'false', {}, PAGE + ' [data-auto-key="checkbacks"]');
  await p.click(PAGE + ' [data-auto-key="jobs"]'); await p.waitForFunction(s => document.querySelector(s)?.getAttribute('aria-pressed') === 'true', {}, PAGE + ' [data-auto-key="jobs"]');
  await p.$eval(PAGE + ' [data-auto-advanced] > summary', x => x.click());
  for (const k of ['engineClaude', 'engineCodex', 'engineOpenrouter', 'engineAntigravity', 'updateOthers']) {
    await p.click(`${PAGE} [data-auto-key="${k}"]`); await p.waitForFunction(s => document.querySelector(s)?.getAttribute('aria-pressed') === 'false', {}, `${PAGE} [data-auto-key="${k}"]`);
  }
  assert.equal(await p.$eval(PAGE + ' [data-auto-advanced]', x => x.open), true, 'Advanced stays open across saves');
  await setValue(PAGE + ' [data-auto-key="perConversation"]', '11');
  await p.waitForFunction(() => document.querySelector('#auto-approvalPush-perConversation-err')?.textContent);
  assert.equal(await rowErr('perConversation'), 'Notifications with buttons per conversation must be 1 to 10.');
  await setValue(PAGE + ' [data-auto-key="perConversation"]', '5'); await savedAs('Saved.');
  assert.deepEqual(await values(), { ...DEFAULTS, answers: true, show: 'waits', allowFor: 45, checkbacks: false, jobs: true, engineClaude: false, engineCodex: false, engineOpenrouter: false, engineAntigravity: false, updateOthers: false, perConversation: 5 });

  console.log('27: raising the longest action warns before saving, and says how many devices were turned off after');
  const RAISE = 'Saving a higher number turns the Allow button off on every device. Each one needs a new test before it shows Allow again.';
  await typeValue(PAGE + ' [data-auto-key="longestAction"]', '100');
  assert.equal(await text(PAGE + ' [data-ap-raise]'), RAISE);
  await typeValue(PAGE + ' [data-auto-key="longestAction"]', '60');
  assert.equal(await text(PAGE + ' [data-ap-raise]'), '', 'lowering it keeps the buttons; no warning');
  await typeValue(PAGE + ' [data-auto-key="longestAction"]', '100');
  await twoWidths('features-page-advanced', PAGE + ' [data-auto-key="longestAction"]');
  await axeOn('features-page-advanced', '[data-settings-panel="f-answers"]');
  await detect('features-page-advanced');
  await p.$eval(PAGE + ' [data-auto-key="longestAction"]', x => x.dispatchEvent(new Event('change', { bubbles: true })));
  await savedAs('Saved. The Allow button is now off on 1 device. Each needs a new test in Notifications before it shows Allow again.');
  assert.ok(!('approvalAllow' in subs().find(s => s.endpoint === endpointOf('other'))), 'the tested phone was turned off');
  assert.equal((await values()).longestAction, 100);
  await setValue(PAGE + ' [data-auto-key="longestAction"]', '90'); await savedAs('Saved.');
  await setValue(PAGE + ' [data-auto-key="longestAction"]', '39');
  await p.waitForFunction(() => document.querySelector('#auto-approvalPush-longestAction-err')?.textContent);
  assert.equal(await rowErr('longestAction'), 'Longest action with an Allow button must be 40 characters to 240 characters.');
  assert.equal((await values()).longestAction, 90, 'nothing saved');

  console.log('27: Reset to defaults');
  await p.click(PAGE + ' [data-auto-reset="approvalPush"]');
  await savedAs('Back to the defaults.');
  assert.deepEqual(await values(), DEFAULTS);
  assert.equal(await p.$eval(LIST_SWITCH, x => x.getAttribute('aria-pressed')), 'false');
  await closeSheet(); await p.evaluate(() => settingsSheet({ category: 'features' }));
  await showSetting(p, LIST_SWITCH); await p.click(LIST_SWITCH); await p.waitForFunction(s => document.querySelector(s)?.getAttribute('aria-pressed') === 'true', {}, LIST_SWITCH);
  assert.equal((await values()).answers, true, 'the Features switch saves too');
  await closeSheet();

  console.log('27: Notifications → This device only: Action approvals and the Allow button, off');
  const DEV = '#s-allow-device', STATE = '#s-allow-device-state', ERR = '#s-allow-error';
  const notifications = async (q = '') => {
    if (q) { await p.goto(base + '/#/settings/notifications' + q); } else await p.evaluate(() => settingsSheet({ category: 'notifications' }));
    await p.waitForSelector('[data-settings-panel="notifications"]:not([hidden]) ' + DEV);
    await p.waitForFunction(s => !/Checking/.test(document.querySelector(s)?.textContent || 'Checking'), {}, STATE);
  };
  await notifications();
  await p.waitForFunction(() => document.querySelector('#s-push-approvals')?.disabled === false);
  assert.equal(await p.$eval('#s-push-approvals', x => x.getAttribute('aria-pressed')), 'true', 'on by default with push on');
  const OFF = "Off. Approval notifications on this device offer Don't allow only.";
  assert.equal(await text(STATE), OFF);
  assert.equal(await p.$eval('#s-allow-off', x => x.hidden), true, 'no Turn off while off');
  assert.equal(await p.$eval('#s-allow-form', x => x.hidden), true, 'no code fields before a test');
  assert.match(await text('#s-allow-device-lead'), /Turning Push to this device off and on again turns the Allow button off; it then needs a new test\.$/);
  await p.click('#s-push-approvals');
  await p.waitForFunction(() => document.querySelector('#s-push-approvals').getAttribute('aria-pressed') === 'false');
  assert.equal(subs().find(s => s.endpoint === pageEndpoint).kinds.approvals, false, 'saved for this device');
  assert.equal(await text(STATE), 'Action approvals are off for this device above, so it gets no approval notifications.');
  await p.click('#s-push-approvals');
  await p.waitForFunction(s => document.querySelector(s).textContent === "Off. Approval notifications on this device offer Don't allow only.", {}, STATE);
  await twoWidths('notifications-device-off', DEV);
  await axeOn('notifications-device-off', '[data-settings-panel="notifications"]');
  await detect('notifications-device-off');

  console.log('27: an undelivered test says so');
  fail.set('page', 500);
  await p.click('#s-allow-test');
  await p.waitForFunction(s => document.querySelector(s)?.textContent, {}, ERR);
  assert.equal(await text(ERR), "The test notification didn't reach this device. Check that notifications are allowed for Pocket on it, then send another test.");
  assert.equal(await p.$eval('#s-allow-form', x => x.hidden), true);
  fail.delete('page');

  console.log('27: the test notification, then the code fields; wrong codes; empty; five wrong tries end it');
  await p.click('#s-allow-test');
  await p.waitForFunction(() => document.querySelector('#s-allow-form')?.hidden === false);
  assert.equal(await p.evaluate(() => document.activeElement?.id), 's-allow-code-action', 'the first code field has focus');
  assert.equal(await text(ERR), '', 'the earlier error is cleared');
  let [, , testPayload] = await testCodes(1);
  assert.equal(testPayload.url, '/#/settings/notifications?approvalTest=1');
  assert.equal(await text('#s-allow-sent'), 'Look at the test notification collapsed, expanded and on the lock screen. Then type the code at the end of its “Runs:” line and the code at the end of its “In:” line. The codes work for 10 minutes.');
  await twoWidths('notifications-device-test-sent', '#s-allow-form');
  await axeOn('notifications-device-test-sent', '[data-settings-panel="notifications"]');
  await detect('notifications-device-test-sent');
  await p.click('#s-allow-confirm');
  assert.equal(await text(ERR), 'Type both codes. Each is two characters.');
  const WRONG = "Those codes don't match. Type the two characters at the end of the “Runs:” line, then the two at the end of the “In:” line.";
  for (let i = 1; i <= 5; i++) {
    await typeValue('#s-allow-code-action', 'QQ'); await typeValue('#s-allow-code-folder', 'QQ');
    await p.click('#s-allow-confirm');
    await p.waitForFunction((s, w) => document.querySelector(s)?.textContent === w, {}, ERR, i < 5 ? WRONG : "Those codes didn't match five times, so this test has ended. Send a new test notification.");
    if (i < 5) { assert.equal(await p.$eval('#s-allow-code-action', x => x.getAttribute('aria-invalid')), 'true'); await p.$eval(ERR, x => { x.textContent = ''; }); }
  }
  assert.equal(await p.$eval('#s-allow-form', x => x.hidden), true, 'the fields go with the test');
  assert.equal(await p.evaluate(() => document.activeElement?.id), 's-allow-test', 'focus on Send a test notification');

  console.log('27: the test link opens the code fields, focused; a test that has ended is refused');
  await closeSheet();
  await notifications('?approvalTest=1');
  await p.waitForFunction(() => document.querySelector('#s-allow-form')?.hidden === false && document.activeElement?.id === 's-allow-code-action');
  assert.equal(await p.evaluate(() => location.hash), '#/', 'the address loses the link');
  await typeValue('#s-allow-code-action', 'AA'); await typeValue('#s-allow-code-folder', 'AA');
  await p.click('#s-allow-confirm');
  await p.waitForFunction(s => document.querySelector(s)?.textContent, {}, ERR);
  assert.equal(await text(ERR), 'This test has expired or was never sent. Send a new test notification.');

  console.log('27: a changed limit refuses the test');
  await p.click('#s-allow-test'); await p.waitForFunction(() => document.querySelector('#s-allow-form')?.hidden === false);
  let [ac, fc] = await testCodes(2);
  assert.equal((await call('/approval-push/settings', { values: { longestAction: 70 } })).status, 200); // lower: the test is kept, but no longer matches
  await typeValue('#s-allow-code-action', ac); await typeValue('#s-allow-code-folder', fc);
  await p.click('#s-allow-confirm');
  await p.waitForFunction(s => document.querySelector(s)?.textContent, {}, ERR);
  assert.equal(await text(ERR), 'The longest action with an Allow button changed after the test was sent. Send a new test notification.');
  assert.equal((await call('/approval-push/settings', { values: { longestAction: null } })).status, 200);

  console.log('27: the right codes (any case, spaces) turn it on');
  await p.click('#s-allow-test'); await p.waitForFunction(() => document.querySelector('#s-allow-form')?.hidden === false);
  [ac, fc] = await testCodes(3);
  await typeValue('#s-allow-code-action', ' ' + ac.toLowerCase()); await typeValue('#s-allow-code-folder', fc[0] + ' ' + fc[1]);
  await p.click('#s-allow-confirm');
  const day = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  await p.waitForFunction((s, w) => document.querySelector(s)?.textContent === w, {}, STATE, `On. Tested at 80 characters on ${day}.`);
  assert.equal(await p.$eval('#s-allow-form', x => x.hidden), true);
  assert.equal(await p.$eval('#s-allow-off', x => x.hidden), false);
  assert.equal(await text(ERR), '');
  assert.equal(subs().find(s => s.endpoint === pageEndpoint).approvalAllow.limit, 80);
  await twoWidths('notifications-device-on', DEV);
  await axeOn('notifications-device-on', '[data-settings-panel="notifications"]');
  await detect('notifications-device-on');

  console.log('27: Turn off');
  await p.click('#s-allow-off');
  await p.waitForFunction((s, w) => document.querySelector(s)?.textContent === w, {}, STATE, OFF);
  assert.ok(!('approvalAllow' in subs().find(s => s.endpoint === pageEndpoint)));
  assert.equal(await p.evaluate(() => document.activeElement?.id), 's-allow-test');
  await closeSheet();

  console.log('27: tested at a lower limit than today\'s reads as needing a new test');
  writeSubs(subs().map(s => s.endpoint === pageEndpoint ? { ...s, approvalAllow: { limit: 40, at: '2026-11-20T12:00:00.000Z' } } : s));
  await notifications();
  assert.equal(await text(STATE), "Needs a new test. This device was tested at 40 characters, and the longest action is now 80. Until then its approval notifications offer Don't allow only.");
  assert.equal(await p.$eval('#s-allow-off', x => x.hidden), false, 'Turn off is offered');
  await p.click('#s-allow-off'); await p.waitForFunction((s, w) => document.querySelector(s)?.textContent === w, {}, STATE, OFF);
  await closeSheet();

  console.log('26: an approval link with ?missed=<why> puts its line above the card and focuses it');
  const convo = await startWaiting('browser missed lines', 'echo missed');
  const MISSED = {
    signin: 'This device was signed out of Pocket.',
    refused: 'Pocket refused the answer from the address the notification used. Answer it here.',
    off: 'Answering from notifications is turned off.',
    gone: 'It was no longer waiting.',
    answered: 'It was no longer waiting: it was answered in Pocket.',
    changed: "Pocket couldn't match it to what the notification showed, or a setting changed. Review it here.",
    old: 'The notification was too old. Review it here.',
    uncertain: 'Delivery of this decision is uncertain. Stop the reply and review the conversation; do not approve it again.',
    offline: 'This device was offline.',
    error: "Pocket couldn't take the answer. Review it here.",
  };
  const openMissed = async (id, req, why, tap) => {
    await p.goto(`${base}/#/chat/${e(id)}?approval=${e(req)}${why ? `&missed=${why}&tap=${tap}` : ''}`);
    await p.waitForSelector('.approvals-sheet [data-approval-list]');
  };
  for (const [i, [why, words]] of Object.entries(MISSED).entries()) {
    const tap = i % 2 ? 'deny' : 'allow';
    await openMissed(convo.id, convo.req.id, why, tap);
    await p.waitForSelector('.approvals-sheet .approval-missed');
    const seen = await p.evaluate(() => { const l = document.querySelector('.approvals-sheet .approval-missed'); return { text: l.textContent, focused: document.activeElement === l, next: l.nextElementSibling?.dataset.approvalRequest, role: l.getAttribute('role'), live: l.getAttribute('aria-live'), hash: location.hash }; });
    assert.deepEqual(seen, { text: `Your ${tap === 'allow' ? 'Allow' : "Don't allow"} didn't go through. ${words}`, focused: true, next: convo.req.id, role: null, live: 'off', hash: '#/chat/' + convo.id }, why);
    if (why === 'changed') {
      // F13: a reload of the list (Refresh, or another card answered) keeps the line above its card, and its focus
      await p.$eval('.approvals-sheet [data-refresh-approvals]', b => b.onclick());
      await sleep(400);
      assert.deepEqual(await p.evaluate(() => { const l = document.querySelectorAll('.approvals-sheet .approval-missed'); return { n: l.length, focused: document.activeElement === l[0], next: l[0]?.nextElementSibling?.dataset.approvalRequest }; }), { n: 1, focused: true, next: convo.req.id }, 'kept through a reload');
      await twoWidths('missed-line', '.approvals-sheet .approval-missed');
      await axeOn('missed-line', '.approvals-sheet');
      await detect('missed-line');
    }
    await closeSheet();
  }
  console.log('26: a reload does not repeat it; without missed the card is brought into view and nothing else');
  await p.reload(); await p.waitForSelector('#box');
  await sleep(500); assert.equal(await p.$('.approvals-sheet'), null, 'a reload opens nothing');
  await openMissed(convo.id, convo.req.id, '', '');
  await p.waitForSelector(`.approvals-sheet [data-approval-request="${convo.req.id}"]`);
  assert.equal(await p.$('.approval-missed'), null);
  await closeSheet();
  console.log('26: gone, for a request answered from another device, says where and when');
  const other = await startWaiting('browser answered elsewhere', 'echo elsewhere');
  const denied = await call(`/session/${e(other.id)}/approvals/${e(other.req.id)}/decision`, { decision: 'deny', via: 'notification', endpoint: endpointOf('other') });
  assert.equal(denied.status, 200, JSON.stringify(denied.body));
  const refusedAllow = await call(`/session/${e(convo.id)}/approvals/${e(convo.req.id)}/decision`, { decision: 'allow', via: 'notification', shown: 'x'.repeat(64), endpoint: endpointOf('other') });
  assert.equal(refusedAllow.body.code, 'not_offered');
  await openMissed(other.id, other.req.id, 'gone', 'allow');
  await p.waitForSelector('.approvals-sheet .approval-missed');
  const atTime = (await call('/approval-push/answers')).body.answers.find(a => a.requestId === other.req.id).at;
  const time = new Date(atTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  assert.equal(await text('.approvals-sheet .approval-missed'), `Your Allow didn't go through. It was no longer waiting: it was not allowed at ${time} from ${pushHost}.`);
  assert.equal(await p.evaluate(() => document.activeElement?.classList.contains('approval-missed')), true);
  assert.equal(await p.$eval('.approvals-sheet .approval-missed', x => x.parentElement.matches('[data-approval-list]') && x === x.parentElement.firstChild), true, 'no card: the line heads the list');
  await closeSheet();

  console.log('27: Usage → Answered away from the app, with rows');
  await p.evaluate(() => settingsSheet({ category: 'usage' }));
  await p.waitForSelector('#s-answers-usage .answers-away li');
  const rows = await p.$$eval('#s-answers-usage .answers-away li', x => x.map(li => ({ text: li.textContent, href: li.querySelector('a')?.getAttribute('href'), request: li.dataset.answer })));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].request, convo.req.id, 'newest first');
  assert.match(rows[0].text, new RegExp(`browser missed lines.* · Command · Refused: Allow was no longer offered for it · from ${reEscape(pushHost)}$`));
  assert.equal(rows[0].href, '#/chat/' + e(convo.id));
  assert.match(rows[1].text, new RegExp(`browser answered elsewhere.* · Command · Not allowed · from ${reEscape(pushHost)}$`));
  await twoWidths('usage-rows', '#auto-answers-h');
  await axeOn('usage-rows', '#s-answers-usage');
  await detect('usage-rows');
  await closeSheet();

  console.log('A5: a conversation title in Answered away from the app is text, never HTML');
  const TRAP = '<img src=x onerror="window.__trap=1">';
  assert.equal((await call(`/session/${e(convo.id)}/rename`, { name: 'A5 ' + TRAP })).status, 200);
  await p.evaluate(() => settingsSheet({ category: 'usage' }));
  await p.waitForSelector('#s-answers-usage .answers-away li');
  const a5 = await p.$eval(`#s-answers-usage .answers-away li[data-answer="${convo.req.id}"]`, li => ({ text: li.querySelector('a').textContent, img: li.querySelectorAll('img').length }));
  assert.deepEqual(a5, { text: 'A5 ' + TRAP, img: 0 });
  await sleep(200); assert.equal(await p.evaluate(() => window.__trap), undefined);
  await closeSheet();

  console.log('A14: the missed line is text, never HTML (an answer recorded with markup in where it came from)');
  const decisions = path.join(data, 'approval-decisions.jsonl');
  fs.appendFileSync(decisions, JSON.stringify({ at: new Date().toISOString(), event: 'decision', sessionId: convo.id, requestId: convo.req.id, kind: 'command', decision: 'allow', source: 'notification', device: 'd', pushService: TRAP }) + '\n');
  await openMissed(convo.id, convo.req.id, 'gone', 'deny');
  await p.waitForSelector('.approvals-sheet .approval-missed');
  const a14 = await p.$eval('.approvals-sheet .approval-missed', l => ({ text: l.textContent, img: l.querySelectorAll('*').length }));
  assert.match(a14.text, new RegExp(`^Your Don't allow didn't go through\\. It was no longer waiting: it was allowed at .+ from ${reEscape(TRAP)}\\.$`));
  assert.equal(a14.img, 0, 'no element inside the line');
  await sleep(200); assert.equal(await p.evaluate(() => window.__trap), undefined);
  await closeSheet();

  console.log('A1: a link more than 60 seconds old opens nothing; a sign-in on Pocket\'s own screen in between restarts the 60 seconds');
  const signedOutAt = async why => {
    await p.deleteCookie({ name: 'pc_auth', url: base });
    await p.goto(`${base}/#/chat/${e(convo.id)}?approval=${e(convo.req.id)}&missed=${why}&tap=allow`);
    await p.waitForSelector('#pw');
    await p.evaluate(() => { approvalFocus.at -= 61_000; }); // the owner took more than a minute to get here
  };
  await signedOutAt('offline');
  await p.setCookie({ name: 'pc_auth', value: cookie, url: base });
  await p.evaluate(() => route()); // signed in some other way: no sign-in on this screen
  await p.waitForSelector('#box'); await sleep(800);
  assert.equal(await p.$('.approvals-sheet'), null, 'too old: nothing opens');
  await signedOutAt('offline');
  await p.type('#pw', 'test-only'); await p.click('#go');
  await p.waitForSelector('.approvals-sheet .approval-missed');
  assert.equal(await text('.approvals-sheet .approval-missed'), "Your Allow didn't go through. This device was offline.");
  await p.setCookie({ name: 'pc_auth', value: cookie, url: base });
  await closeSheet();

  console.log('A7: a link without missed, for a request that no longer waits, opens nothing');
  await p.goto(`${base}/#/chat/${e(other.id)}?approval=${e(other.req.id)}`);
  await p.waitForSelector('#box'); await sleep(800);
  assert.equal(await p.$('.approvals-sheet'), null);

  console.log('F9: a record longer than one listing reads, every row of it recent, says older answers are not listed');
  const pad = JSON.stringify({ at: new Date().toISOString(), event: 'decision', sessionId: 'pad', requestId: 'p'.repeat(200), kind: 'command', decision: 'deny', source: 'notification', device: 'd' }) + '\n';
  fs.appendFileSync(decisions, pad.repeat(Math.ceil(4.2 * 1024 * 1024 / pad.length)));
  await p.evaluate(() => settingsSheet({ category: 'usage' }));
  await p.waitForSelector('#s-answers-usage [data-answers-older]');
  assert.equal(await text('#s-answers-usage [data-answers-older]'), 'Older answers from these 7 days are not listed: the record is too long to read in full here.');
  await axeOn('usage-older', '#s-answers-usage');
  await closeSheet();
  await call(`/session/${e(convo.id)}/approvals/${e(convo.req.id)}/decision`, { decision: 'deny' });

  assert.deepEqual(errors, []);
  if (DETECT) fs.writeFileSync(path.join(shots, 'design-scans.json'), JSON.stringify(scans, null, 1));
  console.log(JSON.stringify({ ok: true, approvalPushLive: true, seconds: Math.round((Date.now() - t0) / 1000), screenshots: shots }));
} catch (x) { await p?.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => { }); console.error('Page URL:', p?.url(), 'Page errors:', errors); console.error('Server log tail:', logs.slice(-2000)); throw x; }
finally { await browser.close(); server.kill('SIGKILL'); await exited; pushServer.close(); killStrays(data); fs.rmSync(dir, { recursive: true, force: true }); }
