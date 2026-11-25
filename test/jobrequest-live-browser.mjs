// Job key requests, the owner's side, on the real server. An agent in a conversation the owner started proposes a job key
// through the real agent route (the fake Claude Code CLI's runner token and the CLI token, as pocket-jobkey does); the
// owner sees it in Settings → Features → Job keys under "Waiting for you" with every field and the whole instruction,
// and answers it. Covered: switched off there is no card and no key list; the layout order (Waiting for you, the
// key list, Advanced closed; the switch is in Features) at 1440 and 390; the count on the Features entry, the Job keys › and the group heading, and it clearing;
// the whole instruction with no inner scroll (60 lines at 390 and 1440: nothing hidden in the block, a long token wraps,
// Allow below its last line); a refresh with no change keeping the card's nodes; Full access in the warning colour; Allow
// never focused for you and Enter never allowing, on the card or in any field of Edit first; the push link opening the card (and a gone id's line); the conversation's "Waiting for you" line
// and row; a card appearing without a reload; Allow (the key file path, no key anywhere, the key in the list, "Open the
// conversation"); Edit first (prefilled, Cancel back to the card, a name clash under the field, the server reporting the
// instruction edited); Deny (no key made); a request answered elsewhere; Recently answered; and, after a restart with a
// short time limit, a request that expired showing the server's words. Port 19072. Screenshots go to
// POCKET_JOBREQUEST_SHOTS (default /tmp/unattended-jobkeys-shots2). With POCKET_DESIGN_SCANNER (impeccable's
// detect-antipatterns-browser.js) the detector runs on the group and the Edit sheet and its findings go beside them.
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
const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jobrequest-live-')));
const home = path.join(dir, 'home'), cwd = path.join(home, 'work'), data = path.join(dir, 'data');
for (const d of [home, cwd, data, path.join(home, 'pocket-uploads'), path.join(dir, 'sessions'), path.join(dir, 'documents')]) fs.mkdirSync(d, { recursive: true });
const shots = process.env.POCKET_JOBREQUEST_SHOTS || '/tmp/unattended-jobkeys-shots2'; fs.mkdirSync(shots, { recursive: true });
const secret = 'jobrequest-live-secret', port = 19072, base = `http://127.0.0.1:${port}`;
const exp = String(Date.now() + 3600_000), cookie = exp + '.' + createHmac('sha256', secret).update(exp).digest('hex');
const keyFolder = path.join(home, '.config/pocket/jobs');

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE|OPENCODE|FAKE)_/.test(k)));
let server = null, exited = null, logs = '';
async function boot(extra = {}) {
  server = spawn(process.execPath, ['server.mjs'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...env, HOME: home, PORT: String(port), POCKET_SKILLS: '0', POCKET_UPDATE_CHECK: '0', POCKET_ENV_FILE: '', POCKET_AUTO_TITLES: '0',
    POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret, POCKET_CODEX: '0', POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: data,
    POCKET_DOCUMENTS_DIR: path.join(dir, 'documents'), POCKET_TEST_CALLS: path.join(dir, 'calls'), CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'),
    POCKET_RETRY_BUFFER_MS: '0', ...extra,
  } });
  server.stdout.on('data', d => logs += d); server.stderr.on('data', d => logs += d);
  exited = new Promise(r => server.once('exit', r));
  for (let i = 0; ; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { } if (i > 300) throw new Error('server did not start: ' + logs); await sleep(30); }
}
async function halt() { if (!server) return; server.kill('SIGKILL'); await exited; killStrays(data); server = null; }
await boot();

const call = async (p, body, headers = { cookie: 'pc_auth=' + cookie }) => {
  const r = await fetch(base + '/api' + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { } return { status: r.status, body: j };
};
const until = async (fn, what, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}; log tail: ${logs.slice(-1500)}`); await sleep(60); } };
const e = id => encodeURIComponent(id);
// The agent's side, as pocket-jobkey calls it: the CLI token plus the runner token of a reply the owner started.
const calls = () => { try { return fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const cliToken = () => fs.readFileSync(path.join(data, 'cli-token'), 'utf8').trim();
const startConversation = async text => { const r = await call('/new', { provider: 'claude', cwd, text: text + ' __HANG__', approvalMode: 'full' }); assert.equal(r.status, 202, JSON.stringify(r.body)); return r.body.id; };
const tokenFor = id => until(() => calls().filter(c => c.id === id).at(-1)?.runnerToken, `the runner token of ${id}`);
const agent = token => ({ authorization: 'Bearer ' + cliToken(), 'x-pocket-runner': token });
async function propose(conversation, fields) {
  const r = await call('/jobs/agent/propose', { workspace: cwd, ...fields }, agent(await tokenFor(conversation)));
  assert.equal(r.status, 202, JSON.stringify(r.body));
  return r.body.request;
}
const agentRead = async (conversation, id) => (await call(`/jobs/agent/requests/${e(id)}`, undefined, agent(await tokenFor(conversation)))).body;

// 60 lines, one of them a 200-character token with no break in it, the last one a marker.
const TOKEN = 'token-' + 'x'.repeat(194);
const LONG = ['Read the disk report in the data.', '', ...Array.from({ length: 55 }, (_, i) => `${i + 1}. Check volume ${i + 1} and say whether it is over 80% full.`), TOKEN, '', 'Change nothing. Marker-end-of-instruction.'].join('\n');
assert.equal(LONG.split('\n').length, 60);
const SHORT = 'Summarise the nightly report in the data in five lines.\nDon’t change anything.';

const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
const errors = [], t0 = Date.now(), scans = [];
let p = null;
try {
  p = await browser.newPage(); p.setDefaultTimeout(10000);
  p.on('pageerror', x => errors.push(x.message));
  await p.setBypassCSP(true);
  await p.emulateTimezone('UTC');
  await p.setCookie({ name: 'pc_auth', value: cookie, url: base });
  await p.evaluateOnNewDocument(() => { if (location.protocol === 'http:' && !localStorage.getItem('pc-theme')) localStorage.setItem('pc-theme', '"dark"'); });
  const desk = () => p.setViewport({ width: 1440, height: 900, isMobile: false, hasTouch: false });
  const phone = () => p.setViewport({ width: 390, height: 844, isMobile: false, hasTouch: false });
  const theme = mode => p.evaluate(m => PocketTheme.setPreference(m), mode);
  await desk();
  const hideToast = () => p.evaluate(() => document.querySelector('#toast')?.classList.remove('show'));
  const shot = async name => { await hideToast(); await p.screenshot({ path: path.join(shots, name + '.png') }); };
  const elShot = async (name, sel) => { await hideToast(); const el = await p.$(sel); await el.evaluate(x => x.scrollIntoView({ block: 'center' })); await elementShot(el, { path: path.join(shots, name + '.png') }); };
  const fourWays = async (name, prepare = async () => { }) => {
    for (const [w, set] of [['1440', desk], ['390', phone]]) for (const mode of ['dark', 'light']) { await set(); await theme(mode); await prepare(); await sleep(1000); /* the card's background eases over .9s after a theme change */ await shot(`${name}-${w}-${mode}`); }
    await desk(); await theme('dark'); await sleep(80);
  };
  const scan = async (name, sel) => {
    await sleep(400);
    // 1.124.10: a request card eases its background over .9s after a theme change (app.css .vault-request), and fourWays
    // ends by switching back to dark. On a loaded CI runner axe measured mid-fade (#a99e93 on a half-way #3e3c3b, 4.17:1)
    // and failed main on 07f2dd0, so the scan waits for running transitions to finish before measuring.
    for (let i = 0; i < 60 && await p.evaluate(() => document.getAnimations().some(a => a instanceof CSSTransition && a.playState === 'running')); i++) await sleep(50);
    if (!await p.evaluate(() => typeof axe !== 'undefined')) await p.addScriptTag({ path: path.join(repo, 'node_modules/axe-core/axe.min.js') });
    assert.deepEqual(await p.evaluate(async s => (await axe.run(s)).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => [n.target, n.any?.[0]?.message || '']) })), sel), [], 'axe: ' + name);
    if (!process.env.POCKET_DESIGN_SCANNER) return;
    await p.evaluate(() => { window.__IMPECCABLE_CONFIG__ = { autoScan: false }; });
    if (!await p.evaluate(() => Boolean(window.impeccableDetectAsync))) { const t = await p.addScriptTag({ path: process.env.POCKET_DESIGN_SCANNER }); await t.evaluate(x => x.remove()); }
    const r = await p.evaluate(() => window.impeccableDetectAsync({ scrollOffscreen: false }));
    scans.push({ name, findings: r }); fs.writeFileSync(path.join(shots, 'design-' + name + '.json'), JSON.stringify(r, null, 1));
  };
  // 1.124.9: the switch is a row of Settings → Features; the group (waiting requests, the key list, Advanced) is its page under Features.
  const FULL = '[data-auto-group="jobs"]:not(.automation-switch)';
  const BADGES = '.settings-index [data-settings-category="features"] [data-job-requests-badge], .feature-open[data-settings-category="f-jobs"] [data-job-requests-badge]';
  const automation = async () => { await p.evaluate(() => settingsSheet({ category: 'f-jobs' })); await showSetting(p, FULL); };
  const closeSheet = async () => { await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.sheet')); };
  // A full load each time (a goto that only changes the hash would not reload the page).
  const visit = async h => { await p.goto('about:blank'); await p.goto(base + '/' + h); };
  const card = id => `[data-job-request="${id}"]`;
  const outcome = id => `[data-job-outcome="${id}"]`;
  const keys = async () => (await call('/jobs/keys')).body.keys.map(k => k.name).sort();
  const pending = async () => (await call('/jobs/keys')).body.requests.map(r => r.id);
  // Nowhere in the page: the DOM (attributes, text and form values), storage, the address.
  const inPage = k => p.evaluate(k => [document.documentElement.outerHTML.includes(k), [...document.querySelectorAll('input,textarea')].some(x => x.value.includes(k)),
    JSON.stringify({ ...localStorage }).includes(k), JSON.stringify({ ...sessionStorage }).includes(k), location.href.includes(k)].some(Boolean), k);
  // The group's parts, top to bottom: which come first on the page.
  const order = () => p.$eval(FULL, g => {
    const top = sel => { const el = g.querySelector(sel); return el && !el.hidden && el.getClientRects().length ? el.getBoundingClientRect().top : null; };
    return { switchHere: g.querySelector('[data-auto-row="jobs"]') !== null, waiting: top('[data-job-requests]'), list: top('[data-job-key-block]'), advanced: top('[data-auto-advanced="jobs"]'), advancedOpen: g.querySelector('[data-auto-advanced="jobs"]')?.open ?? null };
  });
  const assertOrder = (o, withWaiting, label) => {
    assert.ok(o.list != null && o.advanced != null, label + ': every part shows ' + JSON.stringify(o));
    assert.equal(o.switchHere, false, label + ': the switch is in Features, not on the page');
    if (withWaiting) assert.ok(o.waiting != null && o.waiting < o.list && o.list < o.advanced, label + ': Waiting for you, key list, Advanced ' + JSON.stringify(o));
    else assert.ok(o.waiting == null && o.list < o.advanced, label + ': key list, Advanced ' + JSON.stringify(o));
    assert.equal(o.advancedOpen, false, label + ': Advanced is closed');
  };
  await visit('#/all'); await p.waitForSelector('.session-home');

  console.log('Job key requests: switched off, no card and no key list');
  await automation();
  assert.equal(await p.$('[data-job-keys]'), null, 'no key list');
  assert.equal(await p.$('[data-job-request]'), null, 'no card');
  assert.equal(await p.$('[data-job-requests-badge]:not([hidden])'), null, 'no count');
  await closeSheet();
  assert.equal((await call('/automation/settings', { group: 'jobs', values: { jobs: true } })).status, 200);
  const full = (await call('/jobs/keys')).body.defaults.fullAccessAllowed === true;

  console.log('Job key requests: on, nothing waiting; the key list leads its page, the settings under Advanced');
  await visit('#/all'); await p.waitForSelector('.session-home');
  await automation(); await p.waitForFunction(() => document.querySelector('[data-job-keys] [data-job-loading]')?.hidden === true);
  assertOrder(await order(), false, '1440, no request');
  await fourWays('group-no-request-advanced-closed', () => p.$eval(FULL, x => x.scrollIntoView({ block: 'start' })));
  await p.$eval('[data-auto-advanced="jobs"] > summary', x => x.click());
  await elShot('group-no-request-advanced-open-1440-dark', FULL);
  await p.$eval('[data-auto-advanced="jobs"] > summary', x => x.click());
  await closeSheet();

  console.log('Job key requests: an agent proposes; the count shows on the Features entry, the Job keys › and the group heading');
  const convA = await startConversation('Set up a disk check job for me');
  const reqA = await propose(convA, { name: 'disk-check', instruction: LONG, access: full ? 'full' : 'ask', limits: { perHour: 4 } });
  await visit('#/all'); await p.waitForSelector('.session-home');
  await p.evaluate(() => settingsSheet());
  await p.waitForFunction(() => document.querySelector('.settings-index [data-settings-category="features"] [data-job-requests-badge]')?.textContent === '1');
  assert.equal(await p.$eval('.settings-index [data-settings-category="features"] [data-job-requests-badge]', x => x.hidden), false);
  await p.click('.settings-index [data-settings-category="features"]');
  await p.waitForFunction(() => document.querySelector('.feature-open[data-settings-category="f-jobs"] [data-job-requests-badge]')?.textContent === '1');
  assert.equal(await p.$eval('.feature-open[data-settings-category="f-jobs"] [data-job-requests-badge]', x => x.hidden), false, 'the Job keys › counts it too');
  await p.click('.feature-open[data-settings-category="f-jobs"]');
  await p.waitForSelector(card(reqA));
  assert.equal(await p.$eval('#auto-jobs-h [data-job-requests-badge]', x => x.textContent), '1', 'the group heading counts it');
  assert.equal(await p.$eval('[data-job-requests-count]', x => x.textContent), '1');

  console.log('Job key requests: the card shows every field and the whole instruction, every line in the page, Allow after it');
  const view = (await call('/jobs/keys')).body.requests.find(r => r.id === reqA);
  assert.equal(await p.$eval(`${card(reqA)} .job-request-instruction`, x => x.textContent), LONG, 'the whole instruction, line breaks kept');
  // Nothing hidden inside the block (no inner scroll, no sideways scroll, no clamp), the last line drawn inside it, and the
  // note and the three answers below its bottom edge: the owner reaches Allow only past the last line.
  const measure = () => p.$eval(card(reqA), c => {
    const x = c.querySelector('.job-request-instruction'), cs = getComputedStyle(x), br = x.getBoundingClientRect();
    const node = x.firstChild, at = node.textContent.indexOf('Marker-end-of-instruction'), range = document.createRange();
    range.setStart(node, at); range.setEnd(node, at + 'Marker-end-of-instruction'.length);
    const mr = range.getBoundingClientRect();
    const t = node.textContent.indexOf('token-'), tr = document.createRange(); tr.setStart(node, t); tr.setEnd(node, t + 200);
    const below = sel => c.querySelector(sel).getBoundingClientRect().top >= br.bottom;
    return { ws: cs.whiteSpace, overflowY: cs.overflowY, maxHeight: cs.maxHeight, client: x.clientHeight, scroll: x.scrollHeight, sideways: x.scrollWidth > x.clientWidth + 1,
      clamp: cs.webkitLineClamp, ellipsis: cs.textOverflow, lastLineInside: mr.height > 0 && mr.top >= br.top && mr.bottom <= br.bottom + 0.5,
      tokenRows: tr.getClientRects().length, tokenInside: [...tr.getClientRects()].every(r => r.right <= br.right + 0.5),
      noteBelow: below('.vault-request-note'), denyBelow: below('[data-jr-deny]'), editBelow: below('[data-jr-edit]'), allowBelow: below('[data-jr-allow]'), height: Math.round(br.height) };
  });
  for (const [w, set] of [['390', phone], ['1440', desk]]) {
    await set(); await sleep(200);
    const m = await measure();
    assert.equal(m.ws, 'pre-wrap', w + ': line breaks kept');
    assert.equal(m.maxHeight, 'none', w + ': no height cap ' + JSON.stringify(m));
    assert.equal(m.client, m.scroll, w + ': nothing hidden inside the block ' + JSON.stringify(m));
    assert.equal(m.sideways, false, w + ': no sideways scroll inside the block');
    assert.ok(m.clamp === 'none' || m.clamp === '' || m.clamp == null, w + ': never clamped');
    assert.equal(m.ellipsis, 'clip', w + ': never cut with an ellipsis');
    assert.equal(m.lastLineInside, true, w + ': the last line is drawn inside the block ' + JSON.stringify(m));
    assert.ok(m.tokenRows > 1 && m.tokenInside, w + ': the long token wraps inside the block ' + JSON.stringify(m));
    assert.deepEqual([m.noteBelow, m.denyBelow, m.editBelow, m.allowBelow], [true, true, true, true], w + ': the note and the answers come after the block ' + JSON.stringify(m));
    // The last line can be brought into view in the sheet (the page scrolls, not the block).
    const seen = await p.$eval(card(reqA), c => {
      const x = c.querySelector('.job-request-instruction'), node = x.firstChild, at = node.textContent.indexOf('Marker-end-of-instruction');
      const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + 10);
      x.closest('.sheet').scrollTop += range.getBoundingClientRect().bottom - innerHeight + 40;
      const r = range.getBoundingClientRect(), a = c.querySelector('[data-jr-allow]').getBoundingClientRect();
      return { inView: r.top >= 0 && r.bottom <= innerHeight, allowAfter: a.top > r.bottom };
    });
    assert.deepEqual(seen, { inView: true, allowAfter: true }, w + ': the last line scrolls into view in the sheet, Allow after it');
  }
  const facts = await p.$$eval(`${card(reqA)} .job-request-facts > div`, x => x.map(d => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]));
  assert.deepEqual(facts.map(f => f[0]), ['Folder', 'Agent', 'Model', 'Effort', 'Access', 'Limits', 'Its own instructions', 'Push when it finishes']);
  assert.deepEqual(Object.fromEntries(facts), {
    Folder: cwd, Agent: 'Claude Code', Model: 'Default model', Effort: 'Default',
    Access: full ? 'Full access. It acts without asking you first.' : 'Ask first. Every action waits for your OK in the conversation.',
    Limits: `4 per hour · ${view.fields.limits.perDay} per day · ${view.fields.limits.atOnce} at once`,
    'Its own instructions': 'Not allowed. Whatever a script sends is treated as data.', 'Push when it finishes': 'Yes',
  });
  if (full) assert.equal(await p.$eval(`${card(reqA)} .job-request-full`, x => getComputedStyle(x).color), await p.evaluate(() => { const s = document.createElement('span'); s.style.color = 'var(--warn)'; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c; }), 'Full access in the warning colour');
  const title = await p.$eval(`${card(reqA)} [data-job-request-chat]`, x => [x.textContent, x.getAttribute('href')]);
  assert.deepEqual(title, [view.sessionTitle, '#/chat/' + e(convA)], 'the conversation that asked, as a link');
  assert.match(await p.$eval(`${card(reqA)} .vault-request-where`, x => [...x.children].filter(c => !c.ariaHidden).map(c => c.textContent).join(',')), /^Asked .+,Expires .+ if you don’t answer$/);
  assert.equal(await p.$eval(`${card(reqA)} .vault-request-note`, x => x.textContent), 'On Allow, Pocket makes this key and saves it to a file in ~/.config/pocket/jobs/. The conversation gets the file’s path, not the key. From then on a script with that file can start this job without asking you.');
  assert.deepEqual(await p.$$eval(`${card(reqA)} .job-request-actions button`, x => x.map(b => b.textContent)), ['Deny', 'Edit first', 'Allow']);
  assert.notEqual(await p.evaluate(() => document.activeElement?.hasAttribute('data-jr-allow')), true, 'Allow is not focused for you');
  assert.equal(await p.$eval(`${card(reqA)} [data-jr-allow]`, x => x.type), 'button', 'not a submit button');
  // The 60-line card at 390 and 1440: the sheet scrolled to the card's top, then to its bottom (the answers).
  for (const [w, set] of [['390', phone], ['1440', desk]]) {
    await set(); await sleep(200);
    await p.$eval(card(reqA), c => c.scrollIntoView({ block: 'start' })); await sleep(150); await shot(`request-60-lines-${w}-top-dark`);
    await p.$eval(card(reqA), c => c.scrollIntoView({ block: 'end' })); await sleep(150); await shot(`request-60-lines-${w}-bottom-dark`);
  }
  await desk();

  console.log('Job key requests: a refresh that brings no change keeps the card, its buttons and the scroll position');
  const marked = await p.$eval(card(reqA), c => { c.scrollIntoView({ block: 'end' }); const s = c.closest('.sheet'); window.__jrAllow = c.querySelector('[data-jr-allow]'); window.__jrCard = c; return s.scrollTop; });
  await p.evaluate(() => JobKeys.load());
  await sleep(5600); // and one real 5-second refresh
  const after = await p.$eval(card(reqA), c => ({ sameAllow: c.querySelector('[data-jr-allow]') === window.__jrAllow, sameCard: c === window.__jrCard, top: c.closest('.sheet').scrollTop }));
  assert.deepEqual(after, { sameAllow: true, sameCard: true, top: marked }, 'nothing repainted under a finger');

  console.log('Job key requests: the layout with a request waiting, at 1440 and 390');
  assertOrder(await order(), true, '1440');
  await phone(); await sleep(150); assertOrder(await order(), true, '390');
  assert.equal(await p.evaluate(() => document.querySelector('.settings-sheet').scrollWidth <= document.querySelector('.settings-sheet').clientWidth + 1), true, 'no sideways scroll at 390');
  const heights = await p.$$eval(`${card(reqA)} .job-request-actions button`, x => x.map(b => Math.round(b.getBoundingClientRect().height)));
  assert.ok(heights.every(h => h >= 44), '44px answers: ' + heights);
  await desk();
  await fourWays('group-request-waiting', () => p.$eval(FULL, x => x.scrollIntoView({ block: 'start' })));
  await scan('group-request-waiting', FULL);

  console.log('Job key requests: Enter never allows, not on the card and not on Allow itself');
  for (const sel of [`${card(reqA)} h4`, `${card(reqA)} [data-jr-allow]`]) {
    await p.$eval(sel, x => x.focus());
    await p.keyboard.press('Enter');
  }
  await sleep(800);
  assert.deepEqual(await pending(), [reqA], 'still waiting');
  assert.deepEqual(await keys(), [], 'no key was made');
  assert.ok(await p.$(card(reqA)), 'the card is still there');

  console.log('Job key requests: the push link opens the card; a gone id says so');
  await closeSheet();
  await visit('#/settings/jobs/request/' + reqA);
  await p.waitForSelector(`.settings-sheet ${card(reqA)}`);
  await p.waitForFunction(id => document.activeElement === document.querySelector(`[data-job-request="${id}"] h4`), {}, reqA);
  assert.equal(await p.$eval(card(reqA), x => x.classList.contains('vault-flash')), true, 'marked');
  assert.equal(await p.$eval(card(reqA), x => { const r = x.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }), true, 'in view');
  assert.equal(await p.evaluate(() => location.hash), '#/');
  assert.equal(await p.$eval('[data-settings-panel="f-jobs"]', x => x.hidden), false, 'Settings → Features → Job keys');
  await visit('#/settings/jobs/request/jp-00000000');
  await p.waitForFunction(() => document.querySelector('[data-job-request-missing]')?.hidden === false);
  assert.equal(await p.$eval('[data-job-request-missing]', x => x.textContent), 'That request was already answered or expired.');
  await closeSheet();

  console.log('Job key requests: the conversation and its row say it waits for you; the line opens the request');
  assert.equal((await call(`/session/${e(convA)}/pin`, { pinned: true })).status, 200);
  await visit('#/all'); await p.waitForSelector(`.session-home [data-item="${convA}"]`);
  await p.waitForFunction(id => document.querySelector(`.session-home [data-item="${id}"] .job-request-label`)?.textContent === 'Waiting for you: job key disk-check', {}, convA);
  await elShot('conversation-row-waiting-1440-dark', `.session-home [data-item="${convA}"]`);
  await visit('#/chat/' + e(convA)); await p.waitForSelector('#box');
  await p.waitForFunction(() => document.querySelector('#job-request-line')?.hidden === false);
  assert.equal(await p.$eval('#job-request-link', x => x.textContent), 'Waiting for you: job key disk-check');
  assert.equal(await p.$eval('#job-request-link', x => x.getAttribute('href')), '#/settings/jobs/request/' + reqA);
  await shot('conversation-waiting-line-1440-dark');
  await phone(); await sleep(150); await shot('conversation-waiting-line-390-dark'); await desk();
  await p.click('#job-request-link');
  await p.waitForFunction(id => document.activeElement === document.querySelector(`[data-job-request="${id}"] h4`), {}, reqA);
  assert.equal(await p.evaluate(() => location.hash), '#/chat/' + e(convA), 'the conversation stays behind Settings');

  console.log('Job key requests: Allow makes the key; the card says where its file is, never the key');
  await p.click(`${card(reqA)} [data-jr-allow]`);
  await p.waitForSelector(outcome(reqA));
  const fileA = path.join(keyFolder, 'disk-check.key');
  assert.equal(await p.$eval(`${outcome(reqA)} [data-job-outcome-text]`, x => x.textContent), `Allowed. Key file: ${fileA}`);
  assert.equal(await p.$eval(`${outcome(reqA)} .job-request-next`, x => x.textContent), 'Tell the conversation to continue. Open the conversation');
  assert.equal(await p.$eval(`${outcome(reqA)} a`, x => [x.textContent, x.getAttribute('href')].join(' ')), `Open the conversation #/chat/${e(convA)}`);
  assert.equal(await p.evaluate(id => document.activeElement === document.querySelector(`[data-job-outcome="${id}"]`), reqA), true, 'the line takes focus');
  const keyA = fs.readFileSync(fileA, 'utf8').trim();
  assert.match(keyA, /^pjk_/);
  assert.equal(await inPage(keyA), false, 'the key is nowhere in the page');
  await p.waitForFunction(() => [...document.querySelectorAll('[data-job-keys] .job-key-name')].some(x => x.textContent === 'disk-check'));
  assert.deepEqual(await keys(), ['disk-check']);
  await p.waitForFunction(b => document.querySelector('#auto-jobs-h [data-job-requests-badge]')?.hidden === true && [...document.querySelectorAll(b)].length === 2 && [...document.querySelectorAll(b)].every(x => x.hidden), {}, BADGES);
  assert.equal(await p.$eval('[data-job-requests-count]', x => x.hidden), true, 'the count went to zero');
  assert.equal((await call('/automation')).body.jobs.requests, 0);
  await elShot('after-allow-1440-dark', FULL);
  assert.equal((await agentRead(convA, reqA)).status, 'allowed');
  await p.click(`${outcome(reqA)} a`);
  await p.waitForFunction(id => location.hash === '#/chat/' + encodeURIComponent(id) && !document.querySelector('.settings-sheet'), {}, convA);
  await p.waitForFunction(() => document.querySelector('#job-request-line')?.hidden === true, { timeout: 12000 });

  console.log('Job key requests: a request appears while Settings is open, without a reload');
  await visit('#/all'); await p.waitForSelector('.session-home');
  await automation(); await p.waitForFunction(() => document.querySelector('[data-job-keys] [data-job-loading]')?.hidden === true);
  const convB = await startConversation('Make me a nightly report job');
  const reqB = await propose(convB, { name: 'nightly-report', instruction: SHORT, access: 'ask' });
  await p.waitForSelector(card(reqB), { timeout: 12000 });
  await p.waitForFunction(() => document.querySelector('#auto-jobs-h [data-job-requests-badge]')?.textContent === '1');

  console.log('Job key requests: Edit first opens the sheet with the request\'s fields; Cancel goes back to the card');
  await p.click(`${card(reqB)} [data-jr-edit]`);
  await p.waitForSelector('.job-request-edit form');
  assert.equal(await p.$eval('.job-request-edit h2', x => x.textContent), 'Edit before you allow');
  assert.equal(await p.$eval('.job-request-edit input[name="name"]', x => x.value), 'nightly-report');
  assert.equal(await p.$eval('.job-request-edit textarea[name="instruction"]', x => x.value), SHORT);
  assert.equal(await p.$eval('.job-request-edit input[name="workspace"]', x => x.value), cwd.replace(home, '~') === cwd ? cwd : await p.evaluate(c => projShort(c), cwd));
  assert.equal(await p.$eval('.job-request-edit [data-jr-allow-edit]', x => x.textContent), 'Allow with these changes');
  assert.equal(await p.$eval('.job-request-edit [data-jr-allow-edit]', x => x.type), 'button', 'not a submit button');
  assert.equal(await p.$('.job-request-edit form button[type="submit"]'), null, 'the form has no submit button');
  assert.equal(await p.$('.job-request-edit [data-job-bool="save"]'), null, 'the key file is always written');
  assert.notEqual(await p.evaluate(() => document.activeElement?.hasAttribute('data-jr-allow-edit')), true, 'Allow with these changes is not focused for you');
  await p.$eval('.job-request-edit', x => { x.scrollTop = 0; });
  await fourWays('edit-before-allow', () => p.$eval('.job-request-edit', x => { x.scrollTop = 0; }));
  await scan('edit-before-allow', '.job-request-edit');
  await p.click('.job-request-edit [data-jr-cancel]');
  await p.waitForFunction(id => document.activeElement === document.querySelector(`.settings-sheet [data-job-request="${id}"] h4`), {}, reqB);
  assert.deepEqual(await pending(), [reqB], 'Cancel answered nothing');

  console.log('Job key requests: a refused change shows under its field; then the edited Allow');
  await p.click(`${card(reqB)} [data-jr-edit]`); await p.waitForSelector('.job-request-edit form');
  const setValue = (sel, v) => p.$eval(sel, (x, v) => { x.focus(); x.value = v; x.dispatchEvent(new Event('input', { bubbles: true })); }, v);

  console.log('Job key requests: in Edit first, Enter in a field never allows (Name, Folder, each limit; in the instruction it adds a line)');
  await setValue('.job-request-edit input[name="name"]', 'renamed-check');
  for (const sel of ['input[name="name"]', 'input[name="workspace"]', '[data-job-limit="perHour"]', '[data-job-limit="perDay"]', '[data-job-limit="atOnce"]']) {
    await p.$eval('.job-request-edit ' + sel, x => { x.disabled = false; x.focus(); });
    await p.keyboard.press('Enter');
    await sleep(300);
    assert.ok(await p.$('.job-request-edit form'), 'the sheet stays after Enter in ' + sel);
  }
  await p.$eval('.job-request-edit textarea[name="instruction"]', x => { x.focus(); x.setSelectionRange(x.value.length, x.value.length); });
  await p.keyboard.press('Enter');
  assert.equal(await p.$eval('.job-request-edit textarea[name="instruction"]', x => x.value), SHORT + '\n', 'Enter in the instruction adds a line');
  // The Go key on a phone keyboard submits the form without a button: still nothing.
  await p.$eval('.job-request-edit form', f => f.requestSubmit());
  await sleep(1200);
  assert.deepEqual(await pending(), [reqB], 'still waiting after Enter in every field');
  assert.deepEqual(await keys(), ['disk-check'], 'no key was made by Enter');
  assert.equal(fs.existsSync(path.join(keyFolder, 'renamed-check.key')), false);
  await setValue('.job-request-edit textarea[name="instruction"]', SHORT);

  await setValue('.job-request-edit input[name="name"]', 'disk-check');
  await p.click('.job-request-edit [data-jr-allow-edit]');
  await p.waitForFunction(() => document.querySelector('.job-request-edit [data-job-err="name"]')?.textContent);
  assert.equal(await p.$eval('.job-request-edit [data-job-err="name"]', x => x.textContent), 'There is already a job key named "disk-check".');
  assert.equal(await p.$eval('.job-request-edit input[name="name"]', x => x.getAttribute('aria-invalid')), 'true');
  await setValue('.job-request-edit input[name="name"]', 'nightly-report');
  await setValue('.job-request-edit textarea[name="instruction"]', 'Summarise the nightly report in the data in three lines.');
  await p.click('.job-request-edit [data-jr-allow-edit]');
  await p.waitForSelector(`.settings-sheet ${outcome(reqB)}`);
  const fileB = path.join(keyFolder, 'nightly-report.key');
  assert.equal(await p.$eval(`${outcome(reqB)} [data-job-outcome-text]`, x => x.textContent), `Allowed. Key file: ${fileB} You changed: instruction.`);
  assert.equal(await p.$eval(`${outcome(reqB)} .job-request-next`, x => x.textContent), 'Tell the conversation to continue. Open the conversation');
  const readB = await agentRead(convB, reqB);
  assert.deepEqual([readB.status, readB.edited, readB.changed], ['allowed', true, ['instruction']], 'the server reports the instruction edited');
  assert.equal((await call('/jobs/keys')).body.keys.find(k => k.name === 'nightly-report').instruction, 'Summarise the nightly report in the data in three lines.');
  assert.equal(await inPage(fs.readFileSync(fileB, 'utf8').trim()), false);

  console.log('Job key requests: Deny makes nothing');
  const convC = await startConversation('Make a cleanup job');
  const reqC = await propose(convC, { name: 'cleanup-check', instruction: SHORT });
  await p.waitForSelector(card(reqC), { timeout: 12000 });
  await p.click(`${card(reqC)} [data-jr-deny]`);
  await p.waitForSelector(outcome(reqC));
  assert.equal(await p.$eval(`${outcome(reqC)} [data-job-outcome-text]`, x => x.textContent), 'Denied. No key was made.');
  assert.equal(await p.$eval(`${outcome(reqC)} .job-request-next`, x => x.textContent), 'Open the conversation', 'no "continue" after Deny');
  assert.equal(await p.$eval(`${outcome(reqC)} a`, x => [x.textContent, x.getAttribute('href')].join(' ')), `Open the conversation #/chat/${e(convC)}`);
  assert.deepEqual(await keys(), ['disk-check', 'nightly-report'], 'no key made');
  assert.equal(fs.existsSync(path.join(keyFolder, 'cleanup-check.key')), false);
  assert.equal((await agentRead(convC, reqC)).status, 'denied');
  await elShot('after-deny-1440-dark', FULL);

  console.log('Job key requests: answered elsewhere, the card says so in the server\'s words');
  const convD = await startConversation('Make a backup check job');
  const reqD = await propose(convD, { name: 'backup-check', instruction: SHORT });
  await p.waitForSelector(card(reqD), { timeout: 12000 });
  assert.equal((await call(`/jobs/requests/${reqD}/answer`, { answer: 'deny' })).status, 200);
  await p.click(`${card(reqD)} [data-jr-allow]`);
  await p.waitForSelector(outcome(reqD));
  assert.equal(await p.$eval(`${outcome(reqD)} [data-job-outcome-text]`, x => x.textContent), 'That request was already denied.');
  assert.equal(await p.$eval(outcome(reqD), x => x.dataset.kind), 'gone');

  console.log('Job key requests: Recently answered');
  await p.waitForFunction(() => document.querySelectorAll('[data-job-answered-list] li').length === 4);
  assert.equal(await p.$eval('[data-job-answered]', x => x.open), false, 'closed');
  await p.$eval('[data-job-answered] > summary', x => x.click());
  const answered = await p.$$eval('[data-job-answered-list] li', x => x.map(l => l.innerText.replace(/\s+/g, ' ')));
  assert.match(answered.find(x => x.startsWith('nightly-report')), /^nightly-report Allowed · .+ · edited$/);
  assert.match(answered.find(x => x.startsWith('cleanup-check')), /^cleanup-check Denied · /);
  assert.match(answered.find(x => x.startsWith('disk-check')), /^disk-check Allowed · [^·]+$/);
  await elShot('recently-answered-1440-dark', '[data-job-answered]');
  await closeSheet();
  for (const c of [convA, convB, convC, convD]) await call(`/session/${e(c)}/stop`, {});

  console.log('Job key requests: an expired request shows the server\'s words (a restart with a short time limit)');
  await halt();
  // 8 s, not 6: the server's first periodic pass runs 5 s after it starts and marks a request past its time expired, which
  // takes the card off the page. With 6 s (the time is kept to the second) that pass could land between the request's
  // expiry and the click below, about one run in forty. At 8 s it always comes before the expiry; the next is a minute on.
  await boot({ POCKET_JOB_REQUEST_TTL_MS: '8000' });
  await visit('#/all'); await p.waitForSelector('.session-home');
  const convE = await startConversation('Make a log check job');
  const reqE = await propose(convE, { name: 'log-check', instruction: SHORT });
  const expiresAt = Date.parse((await call('/jobs/keys')).body.requests.find(r => r.id === reqE).expiresAt);
  await automation(); await p.waitForSelector(card(reqE));
  const wait = expiresAt - Date.now() + 300; if (wait > 0) await sleep(wait);
  await p.click(`${card(reqE)} [data-jr-allow]`);
  await p.waitForSelector(outcome(reqE));
  assert.equal(await p.$eval(`${outcome(reqE)} [data-job-outcome-text]`, x => x.textContent), 'That request expired before it was answered. Ask the agent to propose it again.');
  assert.equal(await p.$(`${outcome(reqE)} a`), null, 'nothing to open for a request that went');
  assert.equal(fs.existsSync(path.join(keyFolder, 'log-check.key')), false);
  await p.waitForFunction(() => document.querySelector('#auto-jobs-h [data-job-requests-badge]')?.hidden !== false);
  await closeSheet();
  await call(`/session/${e(convE)}/stop`, {});

  assert.deepEqual(errors, []);
  if (scans.length) fs.writeFileSync(path.join(shots, 'design-scan.json'), JSON.stringify(scans, null, 1));
  console.log(JSON.stringify({ ok: true, jobRequestLive: true, seconds: Math.round((Date.now() - t0) / 1000), screenshots: shots }));
} catch (x) { await p?.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => { }); console.error('Page URL:', p?.url(), 'Page errors:', errors); console.error('Server log tail:', logs.slice(-2000)); throw x; }
finally { await browser.close(); await halt(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
