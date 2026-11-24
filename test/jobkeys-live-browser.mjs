// Job keys, the app on the real server. public/jobs.js and public/automation.js run against the real server.mjs and the
// fake Claude Code CLI on temp data, so a field the app reads that the server does not send fails here. It follows the
// owner: Settings → Features → Job keys (off, the folder setting saved, refused and reset, a number refused), the
// switch on, the empty key list, New job key (refusals beside their fields, Create), the key shown once with Copy and the
// example line and then nowhere in the page, a real call with that key (the row says Running, then its last run; the run
// shows under Recent runs and opens its conversation; Needs you), Folder and Agent read-only after a run, Turn off and on,
// Rotate (the old key refused, the new one shown once), Delete, Pause all counting a running job, the origin label on a
// job's conversation, an unchanged refresh writing nothing, and switched off, only the group. Screenshots go to
// POCKET_JOBKEYS_SHOTS (default /tmp/unattended-jobkeys-shots), at 1440 and 390, light and dark. With
// POCKET_DESIGN_SCANNER (impeccable's detect-antipatterns-browser.js) the detector runs on the list and the sheets, and
// its findings are written beside the screenshots.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import puppeteer from 'puppeteer-core';
import { killStrays } from './stray-runners.mjs';
import { elementShot, showSetting } from './ui-controls.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jobkeys-live-')));
const home = path.join(dir, 'home'), cwd = path.join(home, 'work'), data = path.join(dir, 'data'), hangFile = path.join(dir, 'hang');
for (const d of [home, cwd, data, path.join(home, 'pocket-uploads'), path.join(dir, 'sessions'), path.join(dir, 'documents')]) fs.mkdirSync(d, { recursive: true });
const shots = process.env.POCKET_JOBKEYS_SHOTS || '/tmp/unattended-jobkeys-shots'; fs.mkdirSync(shots, { recursive: true });
const secret = 'jobkeys-live-secret', port = 19071, base = `http://127.0.0.1:${port}`;
const exp = String(Date.now() + 3600_000), cookie = exp + '.' + createHmac('sha256', secret).update(exp).digest('hex');

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE|OPENCODE|FAKE)_/.test(k)));
const server = spawn(process.execPath, ['server.mjs'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: {
  ...env, HOME: home, PORT: String(port), POCKET_SKILLS: '0', POCKET_UPDATE_CHECK: '0', POCKET_ENV_FILE: '', POCKET_AUTO_TITLES: '0',
  POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret, POCKET_CODEX: '0', POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: data,
  POCKET_DOCUMENTS_DIR: path.join(dir, 'documents'), POCKET_TEST_CALLS: path.join(dir, 'calls'), CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'),
  FAKE_CLAUDE_HANG_FILE: hangFile, POCKET_RETRY_BUFFER_MS: '0',
} });
let logs = ''; server.stdout.on('data', d => logs += d); server.stderr.on('data', d => logs += d);
const exited = new Promise(r => server.once('exit', r));
for (let i = 0; ; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { } if (i > 300) throw new Error('server did not start: ' + logs); await sleep(30); }

const call = async (p, body, headers = { cookie: 'pc_auth=' + cookie }) => {
  const r = await fetch(base + '/api' + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { } return { status: r.status, body: j };
};
// A script on this server: straight to the port, with the key and nothing else.
const job = (key, body = {}) => call('/jobs/run', body, { authorization: 'Bearer ' + key });
const until = async (fn, what, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}; log tail: ${logs.slice(-1500)}`); await sleep(60); } };
const e = id => encodeURIComponent(id);
const session = id => call('/session/' + e(id)).then(r => r.body);
const idle = id => until(async () => { const s = await session(id); return s && !s.active && s.state?.kind !== 'running' ? s : null; }, `${id} to end`);
const runOf = async (keyId, run) => (await call(`/jobs/keys/${keyId}/runs`)).body.runs.find(r => r.run === run);
const clockText = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
const isToday = iso => new Date(iso).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
const whenText = iso => isToday(iso) ? clockText(iso) : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + ', ' + clockText(iso);

const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
const errors = [], t0 = Date.now(), scans = [];
let p = null;
try {
  p = await browser.newPage(); p.setDefaultTimeout(10000);
  p.on('pageerror', x => errors.push(x.message));
  await p.setBypassCSP(true); // the real server's CSP blocks the injected axe and design detector
  await p.emulateTimezone('UTC');
  await p.setCookie({ name: 'pc_auth', value: cookie, url: base });
  await p.evaluateOnNewDocument(() => { if (!localStorage.getItem('pc-theme')) localStorage.setItem('pc-theme', '"dark"'); });
  const desk = () => p.setViewport({ width: 1440, height: 900, isMobile: false, hasTouch: false });
  const phone = () => p.setViewport({ width: 390, height: 844, isMobile: false, hasTouch: false }); // isMobile or hasTouch changing would reload the page
  const theme = mode => p.evaluate(m => PocketTheme.setPreference(m), mode);
  await desk();
  const hideToast = () => p.evaluate(() => document.querySelector('#toast')?.classList.remove('show'));
  const shot = async name => { await hideToast(); await p.screenshot({ path: path.join(shots, name + '.png') }); };
  const elShot = async (name, sel) => { await hideToast(); const el = await p.$(sel); await el.evaluate(x => x.scrollIntoView({ block: 'center' })); await elementShot(el, { path: path.join(shots, name + '.png') }); };
  // The same view at 1440 and 390, dark and light (the theme is put back to dark after).
  const fourWays = async (name, prepare = async () => { }) => {
    for (const [w, set] of [['1440', desk], ['390', phone]]) for (const mode of ['dark', 'light']) { await set(); await theme(mode); await prepare(); await sleep(120); await shot(`${name}-${w}-${mode}`); }
    await desk(); await theme('dark'); await sleep(80);
  };
  const scan = async (name, sel) => {
    await sleep(400); // the theme and the sheet settle first
    const axeOk = await p.evaluate(() => typeof axe !== 'undefined');
    if (!axeOk) await p.addScriptTag({ path: path.join(repo, 'node_modules/axe-core/axe.min.js') });
    assert.deepEqual(await p.evaluate(async s => (await axe.run(s)).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => [n.target, n.any?.[0]?.message || '']) })), sel), [], 'axe: ' + name);
    if (!process.env.POCKET_DESIGN_SCANNER) return;
    await p.evaluate(() => { window.__IMPECCABLE_CONFIG__ = { autoScan: false }; });
    if (!await p.evaluate(() => Boolean(window.impeccableDetectAsync))) { const t = await p.addScriptTag({ path: process.env.POCKET_DESIGN_SCANNER }); await t.evaluate(x => x.remove()); }
    const r = await p.evaluate(() => window.impeccableDetectAsync({ scrollOffscreen: false }));
    scans.push({ name, findings: r }); fs.writeFileSync(path.join(shots, 'design-' + name + '.json'), JSON.stringify(r, null, 1));
  };
  // 1.124.9: the switch is a row of Settings → Features; the group (the key list, its settings, Reset) is its page under Features.
  const SWITCH = '#s-jobs-switch [data-auto-key="jobs"]', FULL = '[data-auto-group="jobs"]:not(.automation-switch)';
  const automation = async () => { await p.evaluate(() => settingsSheet({ category: 'f-jobs' })); await showSetting(p, FULL); };
  const featuresSwitch = async () => { await p.evaluate(() => settingsSheet({ category: 'features' })); await showSetting(p, SWITCH); };
  const closeSheet = async () => { await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.sheet')); };
  const status = () => p.$eval('[data-auto-status="jobs"]', x => x.textContent);
  const fieldErr = f => p.$eval(`.job-key-sheet [data-job-err="${f}"]`, x => x.textContent);
  const setValue = (sel, v) => p.$eval(sel, (x, v) => { x.focus(); x.value = v; x.dispatchEvent(new Event('input', { bubbles: true })); x.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const rowText = name => p.$$eval('[data-job-keys] .job-key-row', (rows, n) => rows.find(r => r.querySelector('.job-key-name').textContent === n)?.innerText.replace(/\s+/g, ' ').trim() || null, name);
  // Nowhere in the page: the DOM (attributes, text and form values), storage, the address.
  const keyAnywhere = k => p.evaluate(k => {
    const values = [...document.querySelectorAll('input,textarea')].map(x => x.value).join('\n');
    return [document.documentElement.outerHTML.includes(k), values.includes(k), JSON.stringify({ ...localStorage }).includes(k), JSON.stringify({ ...sessionStorage }).includes(k), location.href.includes(k)];
  }, k);
  await p.goto(base + '/#/all'); await p.waitForSelector('.session-home');

  console.log('Job keys: off by default; only the settings group shows');
  assert.equal(await p.evaluate(() => window.pocketFeatures.jobs), false);
  assert.equal((await call('/jobs/keys')).status, 404);
  await automation();
  assert.deepEqual(await p.$$eval('[data-auto-group]:not(.automation-switch)', x => x.map(g => g.dataset.autoGroup)), (await call('/automation')).body.groups.map(g => g.key));
  assert.equal(await p.$eval(FULL + ' > h3', x => x.textContent), 'Job keys');
  assert.equal(await p.$eval(FULL, x => x.classList.contains('automation-group-off')), true, 'reads inactive while off');
  assert.equal(await p.$(FULL + ' [data-auto-key="jobs"]'), null, 'the switch is in Features, not on the page');
  assert.equal(await p.$eval(FULL + ' .automation-inactive-note', x => x.textContent), 'Job keys are off. Turn them on in Features.');
  assert.equal(await p.$('[data-job-keys]'), null, 'no key list while off');
  assert.equal(await p.$('[data-auto-dependent="jobs"]'), null, 'off: only the switch and its help');
  assert.equal(await p.$('[data-auto-reset="jobs"]'), null, 'off: no Reset either');
  await elShot('group-off-1440-dark', FULL);
  await closeSheet(); await featuresSwitch();
  assert.equal(await p.$eval(SWITCH, x => x.getAttribute('aria-pressed')), 'false', 'the switch is in Features, off');

  console.log('Job keys: the switch turns it on; the empty list says what a key is');
  await p.click(SWITCH);
  await p.waitForFunction(() => window.pocketFeatures.jobs === true);
  assert.equal(await p.$eval('#s-jobs-switch .vault-field-error', x => x.textContent), '', 'no error beside the switch');
  await showSetting(p, FULL + ' [data-job-keys] [data-job-new]');
  await p.waitForFunction(() => document.querySelector('[data-job-keys] [data-job-loading]')?.hidden === true);
  assert.equal(await p.$eval('[data-job-keys] [data-job-empty]', x => x.hidden), false);
  assert.match(await p.$eval('[data-job-keys] [data-job-empty]', x => x.textContent), /^A job key lets a script on this server start a reply/);
  assert.equal(await p.$eval('[data-job-new]', x => x.textContent.trim()), 'New job key');
  await elShot('group-on-empty-1440-dark', FULL);
  await scan('group-on-empty', FULL);

  console.log('Job keys: the folder setting is a text field; it refuses, saves and resets');
  await p.$eval('[data-auto-advanced="jobs"] > summary', x => x.click());
  assert.equal(await p.$eval('[data-auto-key="jobKeyFolder"]', x => x.type), 'text');
  assert.equal(await p.$eval('[data-auto-key="jobKeyFolder"]', x => x.value), '~/.config/pocket/jobs/');
  await setValue('[data-auto-key="jobKeyFolder"]', '/etc/pocket/');
  await p.waitForFunction(() => document.querySelector('#auto-jobs-jobKeyFolder-err')?.textContent);
  const folderRefusal = (await call('/automation/settings', { group: 'jobs', values: { jobKeyFolder: '/etc/pocket/' } })).body.error;
  assert.equal(await p.$eval('#auto-jobs-jobKeyFolder-err', x => x.textContent), folderRefusal, "the server's words, under the field");
  assert.equal(await p.$eval('[data-auto-key="jobKeyFolder"]', x => [x.value, x.getAttribute('aria-invalid')].join()), '~/.config/pocket/jobs/,true', 'the old value comes back');
  await elShot('folder-refused-1440-dark', '[data-auto-row="jobKeyFolder"]');
  await setValue('[data-auto-key="jobKeyFolder"]', '~/keys/');
  await p.waitForFunction(() => document.querySelector('[data-auto-status="jobs"]')?.textContent === 'Saved.');
  assert.equal((await call('/automation')).body.groups.find(g => g.key === 'jobs').settings.find(s => s.key === 'jobKeyFolder').value, '~/keys/');
  // a number out of range
  await setValue('[data-auto-key="jobPerHour"]', '500');
  await p.waitForFunction(() => document.querySelector('#auto-jobs-jobPerHour-err')?.textContent);
  assert.match(await p.$eval('#auto-jobs-jobPerHour-err', x => x.textContent), /must be 1 to 120, or No limit/);
  await p.click('[data-auto-reset="jobs"]');
  await p.waitForFunction(() => document.querySelector('[data-auto-status="jobs"]')?.textContent === 'Back to the defaults.');
  assert.equal((await call('/automation')).body.groups.find(g => g.key === 'jobs').settings.find(s => s.key === 'jobKeyFolder').value, '~/.config/pocket/jobs/');
  // the reset also turned Job keys off (off is their default): on again
  await p.waitForFunction(() => window.pocketFeatures.jobs === false);
  await featuresSwitch(); await p.click(SWITCH);
  await p.waitForFunction(() => window.pocketFeatures.jobs === true);
  await showSetting(p, FULL + ' [data-job-keys] [data-job-new]');
  assert.equal(await p.$eval('[data-auto-advanced="jobs"]', x => x.open), true, 'Advanced stays as the owner left it');
  await p.$eval('[data-auto-advanced="jobs"] > summary', x => x.click());

  console.log('Job keys: New job key; refusals show beside the field they name');
  await p.click('[data-job-new]'); await p.waitForSelector('.job-key-sheet form');
  const defaults = (await call('/jobs/keys')).body.defaults;
  assert.deepEqual(await p.$$eval('.job-key-sheet select[name="engine"] option', x => x.map(o => o.value)), defaults.engines.filter(x => x !== 'antigravity'));
  assert.equal(await p.$eval('.job-key-sheet [data-job-bool="mayAddInstructions"]', x => x.getAttribute('aria-pressed')), String(defaults.mayAddInstructions));
  assert.equal(await p.$eval('.job-key-sheet [data-job-limit="perHour"]', x => x.value), String(defaults.limits.perHour));
  assert.equal(await p.$eval('.job-key-sheet [data-job-limit="perDay"]', x => x.value), String(defaults.limits.perDay));
  assert.equal(await p.$eval('.job-key-sheet [data-job-limit="atOnce"]', x => x.value), String(defaults.limits.atOnce));
  assert.match(await p.$eval('.job-key-sheet [data-job-bool="save"]', x => x.textContent), /~\/\.config\/pocket\/jobs\/<name>\.key/);
  assert.equal(await p.$eval('.job-key-sheet select[name="access"]', x => [...x.options].map(o => o.textContent).join('|')), defaults.fullAccessAllowed ? 'Ask first|Full access' : 'Ask first');
  await p.waitForFunction(() => document.querySelector('.job-key-sheet input[name="workspace"]').value !== '');
  await p.type('.job-key-sheet input[name="name"]', 'Disk Check');
  await p.click('.job-key-sheet button[type="submit"]');
  await p.waitForFunction(() => document.querySelector('.job-key-sheet [data-job-err="name"]').textContent);
  assert.match(await fieldErr('name'), /^A job key's name is 1 to 48 lowercase letters/);
  assert.equal(await p.$eval('.job-key-sheet input[name="name"]', x => x.getAttribute('aria-invalid')), 'true');
  await setValue('.job-key-sheet input[name="name"]', 'disk-check');
  await p.click('.job-key-sheet button[type="submit"]');
  await p.waitForFunction(() => document.querySelector('.job-key-sheet [data-job-err="instruction"]').textContent);
  assert.equal(await fieldErr('instruction'), 'Write the standing instruction: what every run of this job does.');
  assert.equal(await fieldErr('name'), '', 'the earlier refusal went');
  await setValue('.job-key-sheet textarea[name="instruction"]', 'Read the disk report in the data and say which volumes need attention. Change nothing.');
  await setValue('.job-key-sheet [data-job-limit="atOnce"]', '9');
  await p.click('.job-key-sheet button[type="submit"]');
  await p.waitForFunction(() => document.querySelector('.job-key-sheet [data-job-err="atOnce"]').textContent);
  assert.match(await fieldErr('atOnce'), /^Runs at once must be 1 to 5/);
  await setValue('.job-key-sheet [data-job-limit="atOnce"]', '1');
  await p.$eval('.job-key-sheet [data-job-err="atOnce"]', x => { x.textContent = ''; });
  await fourWays('new-key-sheet', () => p.$eval('.job-key-sheet', x => { x.scrollTop = 0; }));
  await scan('new-key-sheet', '.job-key-sheet');

  console.log('Job keys: Create shows the key once, with Copy and the example line');
  await p.click('.job-key-sheet button[type="submit"]');
  await p.waitForSelector('.job-key-once [data-job-secret]');
  const key1 = await p.$eval('.job-key-once [data-job-secret]', x => x.value);
  assert.match(key1, /^pjk_[A-Za-z0-9_-]{43}$/);
  const file1 = path.join(home, '.config/pocket/jobs/disk-check.key');
  assert.equal(fs.readFileSync(file1, 'utf8').trim(), key1, 'the file Pocket wrote holds the key shown');
  assert.equal(await p.$eval('.job-key-once .vault-key-note', x => x.textContent), 'This is the only time the key is shown.');
  assert.equal(await p.$eval('.job-key-once [data-job-file]', x => x.textContent), `Saved to ${file1}, readable only by you.`);
  assert.equal(await p.$eval('#job-once-example', x => x.value), `pocket-run --key-file ${file1} --data-file report.txt`);
  assert.equal(await p.$eval('.job-key-once [data-job-copy-key]', x => x.textContent.trim()), 'Copy');
  assert.equal(await p.$eval('.job-key-once', x => x.matches('[role=dialog]')), true);
  await fourWays('key-shown-once');
  await scan('key-shown-once', '.job-key-once');
  await p.click('.job-key-once [data-job-done]');
  await p.waitForSelector('.settings-sheet [data-job-keys]'); // back to Settings → Features → Job keys
  await sleep(100);
  assert.deepEqual(await keyAnywhere(key1), [false, false, false, false, false], 'the key is nowhere in the page after the sheet closed');

  console.log('Job keys: the key list');
  await p.waitForFunction(() => document.querySelectorAll('[data-job-keys] .job-key-row').length === 1);
  assert.equal(await rowText('disk-check'), `disk-check ${home} · Claude Code · Default model Ask first · On · Never ran`);
  await fourWays('key-list', () => p.$eval(FULL, x => x.scrollIntoView({ block: 'end' })));
  await scan('key-list', FULL);

  console.log('Job keys: an unchanged refresh writes nothing in the list');
  const listWrites = await p.evaluate(async () => {
    const el = document.querySelector('[data-job-keys]'), recs = [], mo = new MutationObserver(r => recs.push(...r));
    mo.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
    for (let i = 0; i < 3; i++) await JobKeys.load();
    await new Promise(r => setTimeout(r, 5600)); // the 5-second refresh too
    recs.push(...mo.takeRecords()); mo.disconnect();
    return recs.length;
  });
  assert.equal(listWrites, 0, 'the list is not rewritten');

  console.log('Job keys: a key\'s sheet before any run');
  await p.click('[data-job-open]'); await p.waitForSelector('.job-key-sheet [data-job-runs-note]');
  await p.waitForFunction(() => document.querySelector('[data-job-runs-note]').textContent.startsWith('No runs yet'));
  assert.equal(await p.$eval('.job-key-sheet input[name="workspace"]', x => x.readOnly), false);
  assert.equal(await p.$eval('.job-key-sheet select[name="engine"]', x => x.disabled), false);
  assert.equal(await p.$eval('.job-key-sheet [data-job-status]', x => x.textContent), 'On · Never ran');
  const keyId = (await call('/jobs/keys')).body.keys[0].id;

  console.log('Job keys: a real call; the row says Running, the run shows under Recent runs');
  fs.writeFileSync(hangFile, '1'); // the reply keeps running until stopped
  const started = await job(fs.readFileSync(file1, 'utf8').trim(), { data: 'sda1 91% used' });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  assert.equal(started.body.status, 'working');
  const run1 = started.body.run, convo1 = started.body.conversation;
  await p.waitForFunction(() => document.querySelector('.job-key-sheet [data-job-status]')?.textContent.startsWith('Running · Last run '), { timeout: 15000 });
  await p.waitForFunction(r => document.querySelector(`[data-job-run="${r}"] .job-run-status`)?.textContent === 'Working', { timeout: 15000 }, run1);
  assert.equal(await p.$eval(`[data-job-run="${run1}"] a.job-run`, x => x.getAttribute('href')), '#/chat/' + e(convo1));
  // the list row too
  await p.click('.job-key-sheet .sheet-back'); await p.waitForSelector('.settings-sheet [data-job-keys] .job-key-row');
  const rowNode = await p.$('[data-job-keys] .job-key-row'), h0 = await rowNode.evaluate(x => x.getBoundingClientRect().height);
  await p.waitForFunction(() => /Ask first · Running · Last run /.test(document.querySelector('[data-job-keys] .job-key-row').innerText), { timeout: 15000 });
  await elShot('key-list-running-1440-dark', FULL);
  fs.rmSync(hangFile);
  assert.equal((await call(`/session/${e(convo1)}/stop`, {})).status, 200); await idle(convo1);
  const ended1 = await until(async () => { const r = await runOf(keyId, run1); return r && r.status !== 'working' ? r : null; }, 'the first run to end');
  await p.waitForFunction(w => document.querySelector('[data-job-keys] .job-key-row')?.innerText.includes('Ask first · On · Last run ' + w), { timeout: 15000 }, whenText(ended1.startedAt));
  assert.equal(await rowNode.evaluate(x => x.isConnected && x.getBoundingClientRect().height), h0, 'the same row, the same height');

  console.log('Job keys: a second run finishes Done; a third needs the owner');
  const done = await job(key1, { data: 'sdb1 40% used', wait: 20 });
  assert.equal(done.body.status, 'done', JSON.stringify(done.body));
  const ask = await job(key1, { data: 'check __APPROVAL__ please' });
  assert.equal(ask.status, 202, JSON.stringify(ask.body));
  await until(async () => (await runOf(keyId, ask.body.run))?.status === 'needs_you', 'a run that needs the owner');
  await p.click('[data-job-open]'); await p.waitForSelector('.job-key-sheet [data-job-runs]');
  await p.waitForFunction(r => document.querySelector(`[data-job-run="${r}"] .job-run-status`)?.textContent === 'Needs you', { timeout: 15000 }, ask.body.run);
  await p.waitForFunction(r => document.querySelector(`[data-job-run="${r}"] .job-run-status`)?.textContent === 'Done', {}, done.body.run);
  assert.equal(await p.$eval(`[data-job-run="${done.body.run}"] .job-run-reply`, x => x.textContent), (await runOf(keyId, done.body.run)).reply);
  assert.equal(await p.$eval(`[data-job-run="${run1}"] .job-run-status`, x => x.textContent), ended1.status === 'done' ? 'Done' : 'Failed');
  assert.deepEqual(await p.$$eval('[data-job-runs] > li', x => x.map(l => l.dataset.jobRun)), [ask.body.run, done.body.run, run1], 'newest first');
  assert.equal(await p.$('[data-job-runs] .job-run-status[data-status="refused"]'), null, 'a refusal is not a run');

  console.log('Job keys: an unchanged refresh writes nothing in the runs list');
  const runWrites = await p.evaluate(async () => {
    const el = document.querySelector('[data-job-runs]'), recs = [], mo = new MutationObserver(r => recs.push(...r));
    mo.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
    await new Promise(r => setTimeout(r, 11000)); // two 5-second refreshes
    recs.push(...mo.takeRecords()); mo.disconnect();
    return recs.length;
  });
  assert.equal(runWrites, 0, 'the runs list is not rewritten');

  console.log('Job keys: Folder and Agent are read-only after a run');
  assert.equal(await p.$eval('.job-key-sheet input[name="workspace"]', x => x.readOnly), true);
  assert.equal(await p.$eval('.job-key-sheet select[name="engine"]', x => x.disabled), true);
  assert.equal(await p.$eval('#job-workspace-hint', x => x.textContent), 'This key has run, so its folder and agent stay as they are. Create a new key for another folder or agent.');
  await fourWays('key-sheet-runs', () => p.$eval('.job-key-sheet', x => { x.scrollTop = x.scrollHeight; }));
  await scan('key-sheet-runs', '.job-key-sheet');
  // a change that the server refuses, beside its field; then one it takes
  await setValue('.job-key-sheet [data-job-limit="perDay"]', '5000');
  await p.click('.job-key-sheet button[type="submit"]');
  await p.waitForFunction(() => document.querySelector('.job-key-sheet [data-job-err="perDay"]').textContent);
  assert.match(await fieldErr('perDay'), /^Runs per day must be 1 to 1,000, or No limit/);
  await setValue('.job-key-sheet [data-job-limit="perDay"]', '30');
  await p.click('.job-key-sheet button[type="submit"]');
  await p.waitForFunction(() => document.querySelector('#toast')?.textContent === 'Saved.');
  assert.equal((await call('/jobs/keys')).body.keys[0].limits.perDay, 30);
  // the run that needs the owner: stopped, so the next call is not busy
  assert.equal((await call(`/session/${e(ask.body.conversation)}/stop`, {})).status, 200); await idle(ask.body.conversation);

  console.log('Job keys: Turn off and Turn on');
  await p.click('.job-key-sheet [data-job-toggle]');
  await p.waitForFunction(() => document.querySelector('.job-key-sheet [data-job-toggle]').textContent === 'Turn on');
  assert.match(await p.$eval('.job-key-sheet [data-job-status]', x => x.textContent), /^Off · Last run /);
  assert.equal((await job(key1, { data: 'x' })).status, 401, 'a key that is off is refused');
  await p.click('.job-key-sheet [data-job-toggle]');
  await p.waitForFunction(() => document.querySelector('.job-key-sheet [data-job-toggle]').textContent === 'Turn off');
  assert.equal((await job(key1, { data: 'y', wait: 20 })).body.status, 'done', 'on again, it runs');

  console.log('Job keys: Rotate key; the old key is refused, the new one shown once');
  await p.click('.job-key-sheet [data-job-rotate]'); await p.waitForSelector('.job-confirm[data-job-confirm="rotate"]');
  assert.equal(await p.$eval('.job-confirm h2', x => x.textContent), 'Rotate the key for disk-check?');
  assert.match(await p.$eval('.job-confirm .sheet-help', x => x.textContent), /^The old key stops working at once\./);
  await fourWays('rotate-confirm');
  await p.click('.job-confirm [data-no]'); await p.waitForSelector('.job-key-sheet [data-job-rotate]'); // Keep: back to the key
  await p.click('.job-key-sheet [data-job-rotate]'); await p.waitForSelector('.job-confirm [data-yes]');
  await p.click('.job-confirm [data-yes]');
  await p.waitForSelector('.job-key-once [data-job-secret]');
  const key2 = await p.$eval('.job-key-once [data-job-secret]', x => x.value);
  assert.match(key2, /^pjk_/); assert.notEqual(key2, key1);
  assert.equal(await p.$eval('.job-key-once .vault-key-note', x => x.textContent), 'This is the only time the key is shown. The old key stopped working.');
  assert.equal(fs.readFileSync(file1, 'utf8').trim(), key2, 'the key file now holds the new key');
  assert.equal((await job(key1, { data: 'old' })).status, 401, 'the old key is refused');
  assert.equal((await job(key2, { data: 'new', wait: 20 })).body.status, 'done', 'the new key works');
  await shot('key-rotated-1440-dark');
  await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.job-key-once'));
  await sleep(100);
  assert.deepEqual(await keyAnywhere(key2), [false, false, false, false, false], 'the new key is nowhere after the sheet closed');
  assert.deepEqual(await keyAnywhere(key1), [false, false, false, false, false]);

  console.log('Job keys: a job\'s conversation says it was started by the job');
  assert.equal((await call(`/session/${e(convo1)}/pin`, { pinned: true })).status, 200);
  await p.goto(base + '/#/all'); await p.waitForSelector(`.session-home [data-item="${convo1}"]`);
  assert.equal(await p.$eval(`.session-home [data-item="${convo1}"] .origin-label`, x => x.textContent), 'Started by job disk-check');
  await elShot('origin-row-1440-dark', `.session-home [data-item="${convo1}"]`);
  await p.goto(base + '/#/chat/' + e(convo1)); await p.waitForSelector('#box');
  await p.waitForFunction(() => document.querySelector('#origin-line')?.textContent === 'Started by job disk-check');
  assert.equal(await p.$eval('#origin-line', x => x.hidden), false);
  await shot('origin-chat-1440-dark');
  await phone(); await sleep(150); await shot('origin-chat-390-dark'); await desk();

  console.log('Job keys: Pause all counts a running job');
  fs.writeFileSync(hangFile, '1');
  const running = await job(key2, { data: 'long one' });
  assert.equal(running.status, 202, JSON.stringify(running.body));
  await p.goto(base + '/#/all'); await p.waitForSelector('.session-home');
  await p.click('#listmore'); await p.waitForSelector('.more-menu [data-pause-toggle]');
  await p.click('.more-menu [data-pause-toggle]'); await p.waitForSelector('.pause-sheet [data-pause-would]');
  assert.equal(await p.$eval('[data-pause-would]', x => x.textContent), 'This stops 1 reply running (1 Claude; 1 started by a job).');
  await sleep(400); await shot('pause-sheet-1440-dark');
  await p.click('[data-pause-go]'); await p.waitForSelector('.pause-banner');
  await p.waitForFunction(() => document.querySelector('#toast')?.textContent === 'Paused. Stopped 1 reply running (1 Claude; 1 started by a job).');
  fs.rmSync(hangFile);
  await p.click('.pause-banner [data-resume]'); await p.waitForFunction(() => !document.querySelector('.pause-banner'));
  await until(async () => (await runOf(keyId, running.body.run))?.status !== 'working', 'the paused run to end');

  console.log('Job keys: Delete');
  await automation(); await p.waitForSelector('[data-job-open]');
  await p.click('[data-job-open]'); await p.waitForSelector('.job-key-sheet [data-job-delete]');
  await p.click('.job-key-sheet [data-job-delete]'); await p.waitForSelector('.job-confirm[data-job-confirm="delete"]');
  assert.equal(await p.$eval('.job-confirm h2', x => x.textContent), 'Delete disk-check?');
  assert.equal(await p.$eval('.job-confirm .sheet-help', x => x.textContent), 'Calls with its key are refused from now on. A run already working is not stopped. Pocket removes its key file too.');
  await fourWays('delete-confirm');
  await scan('delete-confirm', '.job-confirm');
  await p.click('.job-confirm [data-yes]');
  await p.waitForSelector('.settings-sheet [data-job-keys]');
  await p.waitForFunction(() => document.querySelector('[data-job-keys] [data-job-empty]')?.hidden === false);
  await p.waitForFunction(() => /^Deleted disk-check\./.test(document.querySelector('#toast')?.textContent || ''));
  assert.equal(fs.existsSync(file1), false, 'its key file went too');
  assert.equal((await job(key2, { data: 'z' })).status, 401);
  await fourWays('group-on-empty', () => p.$eval(FULL, x => x.scrollIntoView({ block: 'end' })));
  // the group off, for the manual
  await closeSheet();

  console.log('Job keys: switched off, only the group shows');
  await featuresSwitch();
  await p.click(SWITCH);
  await p.waitForFunction(() => window.pocketFeatures.jobs === false);
  await p.waitForFunction(() => !document.querySelector('[data-job-keys]'));
  assert.equal(await p.$eval(SWITCH, x => x.getAttribute('aria-pressed')), 'false', 'the switch stays in Features, so it can be turned on');
  await showSetting(p, FULL);
  assert.equal(await p.$eval(FULL + ' .automation-inactive-note', x => x.textContent), 'Job keys are off. Turn them on in Features.');
  assert.equal((await call('/jobs/keys')).status, 404);
  await fourWays('group-off', () => p.$eval(FULL, x => x.scrollIntoView({ block: 'start' })));
  await closeSheet();

  assert.deepEqual(errors, []);
  if (scans.length) fs.writeFileSync(path.join(shots, 'design-scan.json'), JSON.stringify(scans, null, 1));
  console.log(JSON.stringify({ ok: true, jobKeysLive: true, seconds: Math.round((Date.now() - t0) / 1000), screenshots: shots }));
} catch (x) { await p?.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => { }); console.error('Page URL:', p?.url(), 'Page errors:', errors); console.error('Server log tail:', logs.slice(-2000)); throw x; }
finally { await browser.close(); server.kill('SIGKILL'); await exited; killStrays(data); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
