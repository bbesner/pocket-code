// Antigravity in the app, end to end: the real server.mjs with the engine on, pointed at the stand-in for `agy acp`
// (test/fake-agy.mjs), driven in Chrome at phone size. New conversation offers Antigravity only where the server has it
// on, with the models the signed-in Google plan lists and each model's own thinking levels; signed out it names the
// command to run on the server and Check again reads the sign-in afresh; a reply asks before its command; and a message
// sent while a reply runs goes into that reply, with no queue to choose (a person sends each message).
// POCKET_AGY_BROWSER_OUT: screenshots of the views. POCKET_AGY_BROWSER_HOLD=<view>: stop at that view (new, signed-out,
// reply) and keep Chrome open on port POCKET_AGY_BROWSER_CDP so a design scanner can read the page as shown.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import puppeteer from 'puppeteer-core';
import { modelPanel } from './model-panel.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-browser-'));
const home = path.join(dir, 'home'), cwd = path.join(home, 'work'); fs.mkdirSync(cwd, { recursive: true });
const store = path.join(dir, 'agy-store'), signedOut = path.join(dir, 'signed-out');
const secret = 'agy-browser-secret', port = 18866;
const out = process.env.POCKET_AGY_BROWSER_OUT, hold = process.env.POCKET_AGY_BROWSER_HOLD, cdp = Number(process.env.POCKET_AGY_BROWSER_CDP) || 0;
const [vw, vh] = (process.env.POCKET_AGY_BROWSER_VIEWPORT || '390x844').split('x').map(Number);

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE|OPENCODE|GEMINI|GOOGLE)_/.test(k)));
const server = spawn(process.execPath, ['server.mjs'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: {
  ...env, HOME: home, PORT: String(port), POCKET_SKILLS: '0', POCKET_UPDATE_CHECK: '0', POCKET_ENV_FILE: '', POCKET_AUTO_TITLES: '0', POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret,
  POCKET_CODEX: '0', POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: path.join(dir, 'data'), CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'),
  POCKET_AGY_ENABLE: '1', POCKET_AGY_CMD: path.join(repo, 'test/fake-agy.mjs'), FAKE_AGY_STORE: store, FAKE_AGY_SIGNED_OUT: signedOut,
} });
let logs = ''; server.stdout.on('data', d => logs += d); server.stderr.on('data', d => logs += d);
const base = `http://127.0.0.1:${port}`;
for (let i = 0; ; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { } if (i > 200) throw new Error('server did not start: ' + logs); await sleep(30); }

const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox', ...(cdp ? ['--remote-debugging-port=' + cdp] : [])] });
const errors = [];
let held = false, page = null;
try {
  page = await browser.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: vw, height: vh, isMobile: vw < 700, hasTouch: vw < 700 });
  const exp = String(Date.now() + 3600_000);
  await page.setCookie({ name: 'pc_auth', value: exp + '.' + createHmac('sha256', secret).update(exp).digest('hex'), url: base });
  await page.evaluateOnNewDocument(() => { if (!localStorage.getItem('agy-browser-init')) { localStorage.setItem('agy-browser-init', '1'); localStorage.setItem('pc-provider', 'antigravity'); } });
  const mp = modelPanel(page);
  const closeSheet = () => page.waitForFunction(() => !document.querySelector('.sheet'), { timeout: 5000 }).catch(() => { });
  const shot = async name => { if (out) { fs.mkdirSync(out, { recursive: true }); await sleep(300); await page.screenshot({ path: path.join(out, `${name}-${vw}.png`) }); } };
  // POCKET_AGY_BROWSER_HOLD: leave this view up for a scanner on the DevTools port, until the process is stopped
  const view = async name => { await shot(name); if (hold === name) { held = true; console.log(JSON.stringify({ holding: name, cdp, viewport: `${vw}x${vh}` })); await new Promise(() => { }); } };

  console.log('Antigravity: New offers it where the server has it on, with the plan\'s models and each model\'s levels');
  await page.goto(base + '/#/new');
  await page.waitForSelector('#apick [data-a="antigravity"]:not([hidden])');
  await page.waitForFunction(() => /Gemini 4 Neon/.test(document.querySelector('#c-model')?.textContent || ''));
  assert.equal((await mp.chosen()).agent, 'antigravity', 'Antigravity is the agent');
  assert.equal((await mp.agents()).includes('acp'), false, 'OpenRouter is off on this server, so the panel does not offer it');
  await mp.close();
  assert.equal(await page.$eval('#first', e => e.placeholder), 'What should Antigravity work on?');
  assert.equal(await page.$eval('#agy-note', e => e.hidden), true, 'signed in: no sign-in note');
  assert.deepEqual(await mp.modelRows(),
    ['Default | Gemini 4 Neon · Antigravity default', 'Gemini 4 Neon', 'Gemini 3.8 Flash', 'Claude Opus 5.5'], 'the models the plan lists');
  assert.deepEqual(await mp.efforts(), ['default', 'xhigh', 'high', 'medium', 'low'], 'Gemini 4 Neon: its own levels, strongest first');
  assert.match(await mp.effortNote(), /^Medium · the model's own default\./);
  await mp.effort('xhigh');
  assert.match(await mp.chip(), /X-High$/);
  // a level the next model lacks goes back to Default; a model with no levels offers none
  await mp.model('gemini-3.8-flash');
  assert.equal((await mp.chosen()).effort, 'default', 'X-High is not one of Flash\'s levels');
  assert.deepEqual(await mp.efforts(), ['default', 'high', 'medium', 'low']);
  await mp.close();
  await mp.model('claude-opus-5-5');
  assert.deepEqual(await mp.efforts(), [], 'Claude Opus 5.5 lists no levels, so none is offered');
  await mp.close();
  await mp.model('gemini-3.8-flash');
  await mp.effort('high');
  await page.click('#c-approval'); await page.waitForSelector('.sheet .opt[data-v="review"]');
  assert.match(await page.$eval('.sheet .opt[data-v="review"]', e => e.textContent), /Ask before each command and file edit/);
  await page.keyboard.press('Escape'); await closeSheet();
  await page.$eval('#new-setup', e => { e.open = true; });
  await view('new');

  console.log('Antigravity: signed out, New names the command to run on the server, and Check again reads it afresh');
  fs.writeFileSync(signedOut, '');
  await page.evaluate(() => fetch('/api/antigravity/models?fresh=1').then(r => r.json()));
  await page.reload();
  await page.waitForSelector('#agy-note:not([hidden])');
  assert.equal(await page.$eval('#new-setup', e => e.open), true, 'the setup opens so the note is seen');
  assert.equal(await page.$eval('#agy-note p', e => e.textContent), 'Antigravity is not signed in to Google. On this server, run agy acp --login and follow the link it prints, then check again.');
  assert.equal(await page.$eval('#agy-note code', e => e.textContent), 'agy acp --login');
  assert.deepEqual(await mp.efforts(), [], 'no levels to offer signed out');
  assert.deepEqual(await mp.modelRows(), ['Not signed in | On this server, run agy acp --login']);
  await mp.close();
  await view('signed-out');
  fs.rmSync(signedOut);
  await page.click('#agy-recheck');
  await page.waitForFunction(() => document.querySelector('#agy-note')?.hidden === true);
  await page.waitForFunction(() => /Gemini 3.8 Flash/.test(document.querySelector('#c-model')?.textContent || ''), { timeout: 5000 });
  assert.match(await mp.chip(), /Gemini 3\.8 Flash · High$/, 'the picks made before are still there');

  console.log('Antigravity: the reply asks before its command, Allow runs it, and it ran on the picked model and level');
  await page.type('#first', 'do the thing');
  await page.click('#start');
  await page.waitForFunction(() => location.hash.startsWith('#/chat/agy%3A') || location.hash.startsWith('#/chat/agy:'), { timeout: 15000 });
  const id = decodeURIComponent(await page.evaluate(() => location.hash.slice('#/chat/'.length)));
  await page.waitForSelector('#approvals-open:not([hidden]) [data-act]', { timeout: 15000 });
  assert.match(await page.$eval('#approvals-open', e => e.textContent), /echo AGY_OK/, 'the banner names the command');
  assert.equal(await page.$('#queue-open'), null, 'no Queue on a conversation where a person sends each message');
  await view('reply');
  await page.evaluate(() => [...document.querySelectorAll('#approvals-open [data-act]')].find(b => /^Allow/.test(b.textContent.trim())).click());
  await page.waitForFunction(() => [...document.querySelectorAll('#msgs .m-asst')].some(e => /ran it; heard: do the thing/.test(e.textContent)), { timeout: 15000 });
  const ran = JSON.parse(fs.readFileSync(path.join(store, `session-${id.slice(4)}.json`), 'utf8')).ranOn;
  assert.deepEqual(ran, { model: 'gemini-3.8-flash', effort: 'high', mode: 'default' }, 'the reply ran on the picked model and level');
  await page.waitForSelector('#tbar', { timeout: 10000 }); // the composer is back once the reply has ended
  assert.ok(await page.$('#c-mode'), 'Plan first is offered');
  assert.equal(await page.$eval('#side-open', e => e.hidden), true, 'no Side chat'); assert.equal(await page.$eval('#branch-open', e => e.hidden), true, 'no Branch');

  console.log('Antigravity: a message sent while a reply runs goes into it; there is no After this reply');
  const send = async text => { await sleep(400); await page.waitForSelector('#box:not([disabled])'); await page.$eval('#box', (e, v) => { e.focus(); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, text); await page.$eval('#send', e => e.click()); };
  await page.click('#c-approval'); await page.waitForSelector('.sheet .opt[data-v="full"]'); await page.click('.sheet .opt[data-v="full"]'); await closeSheet();
  await send('a long look __HANG__');
  await page.waitForSelector('#stopb', { timeout: 10000 });
  assert.equal(await page.$('.send-mode'), null, 'no Steer / After this reply choice');
  assert.equal(await page.$eval('#box', e => e.placeholder), "Add to what it's doing…");
  await send('and the tests too');
  await page.waitForFunction(() => /Sent to the running reply/.test(document.querySelector('.delivery-status')?.textContent || ''), { timeout: 10000 });
  await page.waitForFunction(() => [...document.querySelectorAll('#msgs .m-asst')].some(e => /ran it; heard: and the tests too/.test(e.textContent)), { timeout: 15000 });
  const prompts = JSON.parse(fs.readFileSync(path.join(store, `session-${id.slice(4)}.json`), 'utf8')).prompts;
  assert.equal(prompts.length, 3, 'three prompts reached agy: the start, the long one, and the message sent into it');

  console.log('Antigravity: the conversation list names the agent');
  // The test's folder is under /tmp, and the list leaves such conversations out unless they are running or pinned.
  assert.equal(await page.evaluate(id => fetch(`/api/session/${encodeURIComponent(id)}/pin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pinned: true }) }).then(r => r.status), id), 200);
  await page.goto(base + '/#/'); await page.waitForSelector('.row .meta');
  assert.ok((await page.$$eval('.row .meta', es => es.map(e => e.textContent))).some(t => /Antigravity/.test(t)), 'the row says Antigravity');

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, antigravity: { agentRow: true, planModels: true, ownLevels: true, signedOutNote: true, checkAgain: true, approvalBanner: true, modelAndLevelApplied: true, steerNoQueue: true, listLabel: true } }));
} catch (e) {
  console.error('Page errors:', errors); console.error('Server log tail:', logs.slice(-2000));
  // what was on screen and what the stand-in CLI recorded, so a failed wait says which side it stopped on
  const shown = await page.evaluate(() => ({ hash: location.hash, msgs: document.querySelector('#msgs')?.innerText.slice(-600), approvals: document.querySelector('#approvals-open')?.innerText, delivery: document.querySelector('.delivery-status')?.textContent, stop: !!document.querySelector('#stopb'), view: document.querySelector('#app, main, body')?.innerText.slice(0, 400), rows: document.querySelectorAll('.row').length })).catch(err => String(err));
  const stored = fs.existsSync(store) ? fs.readdirSync(store).filter(f => f.startsWith('session-')).map(f => { try { const s = JSON.parse(fs.readFileSync(path.join(store, f), 'utf8')); return { cwd: s.cwd, title: s.title, updatedAt: s.updatedAt, prompts: s.prompts, permission: s.permission, ranOn: s.ranOn, last: (s.updates || []).slice(-4).map(u => u.sessionUpdate + (u.status ? ':' + u.status : '') + (u.content?.text ? ' ' + u.content.text.slice(0, 60) : '')) }; } catch { return f; } }) : [];
  const listed = await page.evaluate(() => fetch('/api/sessions').then(r => r.json()).then(j => ({ n: j.sessions?.length, ids: (j.sessions || []).map(x => x.id), warnings: j.warnings }))).catch(err => String(err));
  console.error('The list now:', JSON.stringify(listed));
  console.error('On screen:', JSON.stringify(shown)); console.error('Stand-in CLI:', JSON.stringify(stored));
  throw e;
} finally {
  if (!held) { await browser.close(); server.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}
