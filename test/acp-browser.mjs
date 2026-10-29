// 1.84.1 The OpenRouter engine in the app, end to end: the real server.mjs with the engine on, pointed at the fake
// ACP agent (test/fake-acp.mjs, which keeps model and effort as session config options the way OpenCode 1.19 does)
// and at a local copy of the OpenRouter catalog, driven in Chrome at phone size. It follows what the first real use
// did: New conversation, OpenRouter, pick an effort, send, answer the approval from the banner, read the reply.
// Before 1.84.1 the conversation said "Recent" with Stop showing and no Allow card (the server never reported the
// waiting approval), there was no effort chip, and the reply ran on OpenCode's own default model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import puppeteer from 'puppeteer-core';

const repo = path.resolve(import.meta.dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-browser-'));
const cwd = path.join(dir, 'work'); fs.mkdirSync(cwd, { recursive: true });
const store = path.join(dir, 'acp-store');
const secret = 'acp-browser-secret', port = 18871;

// a three-model catalog: DeepSeek (None/Low/High/Max), Sonnet (Low…Max), Llama (no effort setting)
const catalog = http.createServer((_q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ data: [
  { id: 'deepseek/deepseek-v4.1-flash-1017', name: 'DeepSeek V4.1 Flash', context_length: 131072, supported_parameters: ['tools'] },
  { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', context_length: 1000000, supported_parameters: ['tools'] },
  { id: 'meta-llama/llama-4-scout', name: 'Llama 4 Scout', context_length: 131072, supported_parameters: ['tools'] },
  // 1.88: enough rows that the model sheet offers its find box
  ...Array.from({ length: 12 }, (_, i) => ({ id: `filler/model-${i}`, name: `Filler Model ${i}`, context_length: 32768, supported_parameters: ['tools'] })),
] })); });
await new Promise(r => catalog.listen(0, '127.0.0.1', r));

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE)_/.test(k)));
const server = spawn(process.execPath, ['server.mjs'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: {
  ...env, PORT: String(port), POCKET_SKILLS: '0', POCKET_ENV_FILE: '', POCKET_AUTO_TITLES: '0', POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret,
  POCKET_CODEX: '0', POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: path.join(dir, 'data'), CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'),
  POCKET_ACP_ENABLE: '1', POCKET_ACP_CMD: process.execPath, POCKET_ACP_ARGS: path.join(repo, 'test/fake-acp.mjs'), POCKET_ACP_STORE: store,
  POCKET_OPENROUTER_MODELS_URL: `http://127.0.0.1:${catalog.address().port}/models`,
  FAKE_ACP_DELAY_MS: '1500', // a real reply takes seconds; one that ends before the chat's stream attaches shows no cost line
} });
let logs = ''; server.stdout.on('data', d => logs += d); server.stderr.on('data', d => logs += d);
const base = `http://127.0.0.1:${port}`;
for (let i = 0; ; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { } if (i > 200) throw new Error('server did not start: ' + logs); await sleep(30); }

const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
const errors = [];
try {
  const page = await browser.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.POCKET_DESIGN_SCANNER) await page.setBypassCSP(true); // the real server's CSP blocks the injected detector
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const exp = String(Date.now() + 3600_000);
  await page.setCookie({ name: 'pc_auth', value: exp + '.' + createHmac('sha256', secret).update(exp).digest('hex'), url: base });
  await page.evaluateOnNewDocument(() => { if (!localStorage.getItem('acp-browser-init')) { localStorage.setItem('acp-browser-init', '1'); localStorage.setItem('pc-provider', 'acp'); } });
  const chipText = sel => page.$eval(sel, e => e.textContent.trim());
  const sheetOptions = () => page.$$eval('.sheet .opt', es => es.map(e => e.dataset.v));
  const pick = async (chip, value) => { await page.click(chip); await page.waitForSelector('.sheet .opt'); await page.click(`.sheet .opt[data-v="${value}"]`); await page.waitForFunction(() => !document.querySelector('.sheet'), { timeout: 5000 }).catch(() => { }); };

  console.log('OpenRouter: New conversation offers the model\'s own effort levels');
  await page.goto(base + '/#/new');
  await page.waitForSelector('#apick [data-a="acp"]:not([hidden])');
  await page.waitForSelector('#c-eff');
  assert.equal(await page.$eval('#apick [data-a="acp"]', e => e.getAttribute('aria-checked')), 'true', 'OpenRouter is the agent');
  await page.click('#c-eff'); await page.waitForSelector('.sheet .opt');
  assert.deepEqual(await sheetOptions(), ['default', 'max', 'high', 'low', 'none'], 'DeepSeek V4.1 Flash: its own levels, strongest first');
  // POCKET_DESIGN_SCANNER + POCKET_ACP_BROWSER_OUT: a screenshot and the impeccable detector on the open sheet
  const out = process.env.POCKET_ACP_BROWSER_OUT;
  if (out) { fs.mkdirSync(out, { recursive: true }); await sleep(300); await page.screenshot({ path: path.join(out, 'acp-effort-390.png') }); }
  if (out && process.env.POCKET_DESIGN_SCANNER) {
    await page.evaluate(() => { window.__IMPECCABLE_CONFIG__ = { autoScan: false }; });
    const t = await page.addScriptTag({ path: process.env.POCKET_DESIGN_SCANNER }); await t.evaluate(e => e.remove());
    fs.writeFileSync(path.join(out, 'acp-effort-design.json'), JSON.stringify(await page.evaluate(() => window.impeccableDetectAsync({ scrollOffscreen: false })), null, 1));
  }
  await page.click('.sheet .opt[data-v="high"]'); await sleep(200);
  assert.match(await chipText('#c-eff'), /High/);
  // a model with no effort setting has no chip; a model with other levels offers those
  await pick('#c-model', 'openrouter/meta-llama/llama-4-scout');
  assert.equal(await page.$('#c-eff'), null, 'Llama 4 Scout takes no effort, so there is no chip');
  await pick('#c-model', 'openrouter/anthropic/claude-sonnet-5.5');
  await page.click('#c-eff'); await page.waitForSelector('.sheet .opt');
  assert.deepEqual(await sheetOptions(), ['default', 'max', 'xhigh', 'high', 'medium', 'low']);
  await page.click('.sheet .opt[data-v="xhigh"]'); await sleep(200);
  // back on DeepSeek, X-High is not one of its levels, so the pick goes back to Default
  await pick('#c-model', 'default');
  assert.match(await chipText('#c-eff'), /Default/, 'an effort the model lacks resets to Default');
  await pick('#c-eff', 'max');

  console.log('OpenRouter: the model sheet finds a model by any words of its name');
  await page.click('#c-model'); await page.waitForSelector('.sheet .sheet-find input');
  assert.notEqual(await page.evaluate(() => document.activeElement?.type), 'search', 'on a phone the keyboard does not open by itself');
  const visibleRows = () => page.$$eval('.sheet .opt', es => es.filter(e => !e.hidden).map(e => e.dataset.v));
  const status = () => page.$eval('.sheet-search-status', e => e.textContent);
  assert.equal((await visibleRows()).length, 16, 'every model before typing');
  await page.type('.sheet-find input', 'sonnet 5.5');
  assert.deepEqual(await visibleRows(), ['openrouter/anthropic/claude-sonnet-5.5']);
  assert.equal(await status(), '1 of 16 models');
  await page.$eval('.sheet-find input', e => { e.value = ''; }); await page.type('.sheet-find input', 'nothing like this');
  assert.deepEqual(await visibleRows(), []);
  assert.match(await status(), /^No models match “nothing like this”$/);
  await page.keyboard.press('Escape');
  assert.ok(await page.$('.sheet'), 'the first Escape clears the box and leaves the sheet open');
  assert.equal((await visibleRows()).length, 16);
  await page.type('.sheet-find input', 'llama');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.sheet'));
  assert.match(await chipText('#c-model'), /Llama 4 Scout/, 'Enter picks the first match');
  await pick('#c-model', 'default');
  await pick('#c-eff', 'max');

  console.log('OpenRouter: the approval shows on the banner, Allow runs it, the reply arrives');
  await page.click('#new-setup summary'); await page.type('#cpath', cwd);
  await page.type('#first', 'do the thing');
  await page.click('#start');
  await page.waitForFunction(() => location.hash.startsWith('#/chat/acp%3A') || location.hash.startsWith('#/chat/acp:'), { timeout: 15000 });
  const id = decodeURIComponent(await page.evaluate(() => location.hash.slice('#/chat/'.length)));
  await page.waitForSelector('#approvals-open:not([hidden]) [data-act]', { timeout: 15000 });
  const banner = await page.$eval('#approvals-open', e => e.textContent);
  assert.match(banner, /echo ACP_OK/, 'the banner names the command: ' + banner);
  const labels = await page.$$eval('#approvals-open [data-act]', es => es.map(e => e.textContent.trim()));
  assert.ok(labels.some(l => /^Allow/.test(l)), 'Allow on the banner: ' + labels);
  // it stays up: the list refresh that follows the approval event used to hide it again (the server said "Recent")
  await sleep(2500);
  assert.equal(await page.$eval('#approvals-open', e => e.hidden), false, 'the approval banner is still showing after the list refresh');
  await page.reload();
  await page.waitForSelector('#approvals-open:not([hidden]) [data-act]', { timeout: 15000 });
  const state = await page.evaluate(async id => (await (await fetch('/api/session/' + encodeURIComponent(id))).json()).state, id);
  assert.equal(state.kind, 'input'); assert.equal(state.label, 'Needs approval');
  await page.evaluate(() => [...document.querySelectorAll('#approvals-open [data-act]')].find(b => /^Allow/.test(b.textContent.trim())).click());
  await page.waitForFunction(() => [...document.querySelectorAll('#msgs .m-asst')].some(e => /echo of do the thing/.test(e.textContent)), { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('#approvals-open')?.hidden !== false, { timeout: 10000 });
  // 1.84.2: what it did shows as it happens (Thinking, then the command), and the reply's cost is under it
  const steps = await page.$$eval('#msgs .ledger', es => es.map(e => [e.querySelector('.name')?.textContent, e.querySelector('.det')?.textContent]));
  assert.deepEqual(steps, [['Thinking', 'Checking with a quick command.'], ['Bash', 'echo ACP_OK']], 'tool lines: ' + JSON.stringify(steps));
  await page.waitForSelector('#msgs .turnmeta');
  assert.match(await page.$eval('#msgs .turnmeta', e => e.textContent), /^\$0\.0021 · /, 'a fraction of a cent, not $0.00');
  const ran = JSON.parse(fs.readFileSync(path.join(store, encodeURIComponent(id.slice(4)) + '.json'), 'utf8')).ranOn;
  assert.deepEqual(ran, { model: 'openrouter/deepseek/deepseek-v4.1-flash-1017', effort: 'max' }, 'the reply ran on the picked model and effort');

  console.log('OpenRouter: reopening the conversation shows the exchange');
  await page.reload();
  await page.waitForFunction(() => [...document.querySelectorAll('#msgs .m-asst')].some(e => /echo of do the thing/.test(e.textContent)), { timeout: 15000 });
  assert.ok(await page.$eval('#c-eff', e => /Max/.test(e.textContent)), 'the conversation keeps its effort pick');
  assert.equal((await page.$$('#msgs .ledger')).length, 2, 'the tool lines are there after a reload too');

  console.log('OpenRouter: Full access runs the next reply without asking');
  await page.click('#c-approval'); await page.waitForSelector('.sheet .opt[data-v="full"]'); await page.click('.sheet .opt[data-v="full"]'); await sleep(200);
  await page.evaluate(() => { window.__askedFull = false; new MutationObserver(() => { const b = document.querySelector('#approvals-open'); if (b && !b.hidden) window.__askedFull = true; }).observe(document.body, { subtree: true, childList: true, attributes: true }); });
  await page.type('#box', 'and again'); await page.click('#send');
  await page.waitForFunction(() => [...document.querySelectorAll('#msgs .m-asst')].some(e => /echo of and again/.test(e.textContent)), { timeout: 15000 });
  assert.equal(await page.evaluate(() => window.__askedFull), false, 'no approval banner with Full access');
  await page.waitForFunction(() => document.querySelectorAll('#msgs .turnmeta').length >= 1 && /\$0\.0021/.test([...document.querySelectorAll('#msgs .turnmeta')].at(-1).textContent), { timeout: 10000 });

  console.log('OpenRouter: the everyday features of the other agents (1.86)');
  // the composer is redrawn as a reply ends: wait for it, then send through its handler (a pointer click can land mid-redraw)
  const send = async text => { await page.waitForSelector('#tbar'); await sleep(400); await page.waitForSelector('#box:not([disabled])'); await page.$eval('#box', (e, v) => { e.focus(); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, text); await page.$eval('#send', e => e.click()); };
  // Plan first is offered (OpenCode's plan mode); Side chat and Branch, which OpenRouter cannot do yet, are not
  await page.waitForSelector('#tbar', { timeout: 10000 }); // the composer is back once the reply has fully ended
  assert.ok(await page.$('#c-mode'), 'Plan first chip');
  assert.equal(await page.$eval('#side-open', e => e.hidden), true, 'no Side chat'); assert.equal(await page.$eval('#branch-open', e => e.hidden), true, 'no Branch');
  // your message shows at once, stays through a reload while the reply runs, and there is no Steer toggle (OpenRouter cannot steer)
  await send('parity slow __SLOW__');
  const mine = () => page.waitForFunction(() => [...document.querySelectorAll('#msgs .m-user')].some(e => /parity slow/.test(e.textContent)), { timeout: 8000 });
  await mine(); await page.reload(); await mine();
  assert.equal(await page.$('.send-mode'), null, 'no Steer / After this reply toggle while it runs');
  await page.waitForFunction(() => [...document.querySelectorAll('#msgs .m-asst')].some(e => /echo of parity slow/.test(e.textContent)), { timeout: 15000 });
  // a ```choices block becomes reply buttons
  await send('parity choices __CHOICES__');
  await page.waitForFunction(() => [...document.querySelectorAll('.choices:not([hidden]) button')].some(b => /Merge and deploy/.test(b.textContent)), { timeout: 15000 });
  assert.ok(!(await page.$eval('#msgs', e => e.textContent)).includes('```choices'), 'the raw block is not shown');
  // a question from the model is a card with its options as buttons; tapping one answers it
  await send('parity question __QUESTION__');
  await page.waitForSelector('#questions-open:not([hidden]) [data-act]', { timeout: 15000 });
  assert.match(await page.$eval('#questions-open', e => e.textContent), /OpenRouter is waiting for your answer|Which color/);
  await page.evaluate(() => [...document.querySelectorAll('#questions-open [data-act]')].find(b => /Blue/.test(b.textContent)).click());
  await page.waitForFunction(() => [...document.querySelectorAll('#msgs .m-asst')].some(e => /Answer: Blue/.test(e.textContent)), { timeout: 15000 });

  // 1.87: the Changes view draws a unified diff (Codex records edits that way) as removed and added lines
  const drawn = await page.evaluate(() => { const d = document.createElement('div'); d.innerHTML = diffHTML({ tool: 'Edit', patch: '--- a/parity.txt\n+++ b/parity.txt\n@@ -1 +1 @@\n-old line\n+new line\n' }); return [...d.querySelectorAll('pre span')].map(x => [x.className, x.textContent]); });
  assert.deepEqual(drawn.filter(([c]) => c !== 'dx'), [['dd', '- old line'], ['da', '+ new line']], JSON.stringify(drawn));
  assert.ok(!drawn.some(([, t]) => /parity\.txt/.test(t)), 'file headers are left out');

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, unifiedDiff: true, openrouter: { messageAtOnce: true, replyButtons: true, questionCards: true, planFirst: true, unsupportedHidden: true, effortChip: true, approvalBanner: true, modelAndEffortApplied: true, toolLines: true, costLine: true, fullAccess: true, reopen: true } }));
} catch (e) {
  console.error('Page errors:', errors); console.error('Server log tail:', logs.slice(-2000)); throw e;
} finally {
  await browser.close(); server.kill('SIGKILL'); catalog.close(); fs.rmSync(dir, { recursive: true, force: true });
}
