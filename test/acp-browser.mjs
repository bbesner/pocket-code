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
] })); });
await new Promise(r => catalog.listen(0, '127.0.0.1', r));

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE)_/.test(k)));
const server = spawn(process.execPath, ['server.mjs'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: {
  ...env, PORT: String(port), POCKET_SKILLS: '0', POCKET_ENV_FILE: '', POCKET_AUTO_TITLES: '0', POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret,
  POCKET_CODEX: '0', POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: path.join(dir, 'data'), CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'),
  POCKET_ACP_ENABLE: '1', POCKET_ACP_CMD: process.execPath, POCKET_ACP_ARGS: path.join(repo, 'test/fake-acp.mjs'), POCKET_ACP_STORE: store,
  POCKET_OPENROUTER_MODELS_URL: `http://127.0.0.1:${catalog.address().port}/models`,
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
  const ran = JSON.parse(fs.readFileSync(path.join(store, encodeURIComponent(id.slice(4)) + '.json'), 'utf8')).ranOn;
  assert.deepEqual(ran, { model: 'openrouter/deepseek/deepseek-v4.1-flash-1017', effort: 'max' }, 'the reply ran on the picked model and effort');

  console.log('OpenRouter: reopening the conversation shows the exchange');
  await page.reload();
  await page.waitForFunction(() => [...document.querySelectorAll('#msgs .m-asst')].some(e => /echo of do the thing/.test(e.textContent)), { timeout: 15000 });
  assert.ok(await page.$eval('#c-eff', e => /Max/.test(e.textContent)), 'the conversation keeps its effort pick');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, openrouter: { effortChip: true, approvalBanner: true, modelAndEffortApplied: true, reopen: true } }));
} catch (e) {
  console.error('Page errors:', errors); console.error('Server log tail:', logs.slice(-2000)); throw e;
} finally {
  await browser.close(); server.kill('SIGKILL'); catalog.close(); fs.rmSync(dir, { recursive: true, force: true });
}
