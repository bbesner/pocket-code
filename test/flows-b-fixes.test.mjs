// 1.124.5: faults found by the flow tests (lane b) and fixed. Each test failed on the code before its fix.
// Servers listen on port 0 and every child is stopped at the end; every secret here is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { killStrays } from './stray-runners.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE|OPENCODE)_/.test(k)));

// A free port in 21200-21299, the range these checks may use.
async function lanePort() {
  for (let port = 21200 + Math.floor(Math.random() * 60); port < 21300; port++) {
    const ok = await new Promise(res => { const s = net.createServer(); s.once('error', () => res(false)); s.listen(port, '127.0.0.1', () => s.close(() => res(true))); });
    if (ok) return port;
  }
  throw new Error('no free port in 21200-21299');
}
// One real server with the stand-in agents, on its own temp data; killed with everything it started at the end.
async function boot(t, env = {}) {
  const dir = fs.realpathSync(tmp('pc-flowsb-')), home = path.join(dir, 'home'), cwd = path.join(home, 'work'), data = path.join(dir, 'data');
  for (const d of [home, cwd, data, path.join(home, 'pocket-uploads'), path.join(dir, 'sessions')]) fs.mkdirSync(d, { recursive: true });
  const port = await lanePort(), secret = 'flowsb-' + path.basename(dir), exp = Date.now() + 3600_000;
  const cookie = 'pc_auth=' + exp + '.' + createHmac('sha256', secret).update(String(exp)).digest('hex');
  const child = spawn(process.execPath, ['server.mjs'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...cleanEnv(), HOME: home, PORT: String(port), POCKET_SKILLS: '0', POCKET_ENV_FILE: '', POCKET_AUTO_TITLES: '0', POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret,
    POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: data, POCKET_TEST_CALLS: path.join(dir, 'calls'), CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'),
    POCKET_CODEX: '0', POCKET_VOICE: 'off', POCKET_MEMSTEM: '0', ...env,
  } });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  const exited = new Promise(r => child.once('exit', r));
  t.after(async () => { try { child.kill('SIGKILL'); } catch { } await exited; killStrays(data); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); });
  for (let i = 0; ; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { } if (i > 300) throw new Error('server did not start: ' + logs); await sleep(30); }
  const call = async (p, body, headers = { cookie }) => {
    const r = await fetch(`http://127.0.0.1:${port}/api${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}`, ...headers }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch { } return { status: r.status, body: j };
  };
  const bearer = () => ({ authorization: 'Bearer ' + fs.readFileSync(path.join(data, 'cli-token'), 'utf8').trim() });
  const until = async (fn, ms = 15000, what = 'condition') => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}; log tail: ${logs.slice(-1500)}`); await sleep(60); } };
  const calls = () => { try { return fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
  const start = async text => { const r = await call('/new', { provider: 'claude', cwd, text, approvalMode: 'full' }); assert.equal(r.status, 202, JSON.stringify(r.body)); return r.body.id; };
  const token = id => until(() => calls().find(c => c.id === id)?.runnerToken, 15000, `${id} to run`);
  const idle = id => until(async () => { const b = (await call('/session/' + encodeURIComponent(id))).body; return b && !b.active && b.state?.kind !== 'running'; }, 15000, `${id} to end`);
  return { dir, data, cwd, port, cookie, call, bearer, until, calls, start, token, idle, logs: () => logs };
}

// ---------- b-09a: the relay refuses the other capture tools after a fill ----------
async function relayCtx(t, extraEnv = {}) {
  const dir = tmp('pc-flowsb-relay-'), data = path.join(dir, 'data'); fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'cli-token'), 'sample-cli-token-0001\n');
  const daemon = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, values: Object.fromEntries((body.refs || []).map(r => [r, 'Made-up-Secret-77'])) }));
    });
  });
  await new Promise(ok => daemon.listen(0, '127.0.0.1', ok));
  const p = spawn(process.execPath, [path.join(repo, 'scripts/pocket-mcp-proxy.mjs'), '--name', 'browser', '--', process.execPath, path.join(repo, 'test/fake-mcp.mjs')],
    { cwd: dir, env: { PATH: process.env.PATH, POCKET_ENV_FILE: path.join(dir, 'absent.env'), POCKET_DATA_DIR: data, POCKET_URL: `http://127.0.0.1:${daemon.address().port}`, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map(); readline.createInterface({ input: p.stdout }).on('line', l => { const m = JSON.parse(l); waiting.get(m.id)?.(m); });
  let n = 0; const rpc = (method, params) => new Promise(res => { const id = ++n; waiting.set(id, res); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  t.after(async () => { if (p.exitCode === null) { const e = new Promise(r => p.once('exit', r)); p.kill('SIGKILL'); await e; } daemon.closeAllConnections(); await new Promise(ok => daemon.close(ok)); fs.rmSync(dir, { recursive: true, force: true }); });
  return { rpc };
}

test('b-09a: after a fill the relay refuses run_code, video, tracing and annotate like a screenshot; evaluate and snapshots still run', async t => {
  const { rpc } = await relayCtx(t, { POCKET_VAULT_PICTURE_TOOLS: 'shot' });
  const capture = ['browser_run_code_unsafe', 'browser_start_video', 'browser_stop_video', 'browser_start_tracing', 'browser_stop_tracing', 'browser_annotate'];
  // Before a fill they pass through (fake-mcp answers an unknown tool with an empty result).
  let r = await rpc('tools/call', { name: 'browser_start_video', arguments: {} }); assert.deepEqual(r.result, {}, 'passes before a fill');
  r = await rpc('tools/call', { name: 'type', arguments: { text: '{{vault:p}}' } }); assert.equal(r.result.isError, undefined, JSON.stringify(r.result));
  for (const tool of capture) {
    r = await rpc('tools/call', { name: tool, arguments: { code: 'async (page) => (await page.screenshot()).toString("base64")' } });
    assert.equal(r.result.isError, true, `${tool} refused after a fill`);
    assert.equal(r.result.content[0].text, `Pocket: ${tool} was not taken: a Vault value was typed into this browser session, so no screenshot, PDF or other picture of it is made for the rest of the session (a value cannot be scrubbed out of a picture, and the browser tool would save it to a file). Use text snapshots instead.`);
  }
  r = await rpc('tools/call', { name: 'shot', arguments: {} }); assert.equal(r.result.isError, true, 'POCKET_VAULT_PICTURE_TOOLS still adds to the list');
  r = await rpc('tools/call', { name: 'evaluate', arguments: { expression: 'document.title' } }); assert.equal(r.result.content[0].text, 'evaluated document.title', 'evaluate is not refused');
  r = await rpc('tools/call', { name: 'browser_snapshot', arguments: {} }); assert.equal(r.result.isError, undefined, 'a text snapshot is not refused');
  assert.match(r.result.content[0].text, /\{\{vault:p\}\}/, 'and the value in it is scrubbed');
});

// ---------- b-18: a coordination wake held by Pause all no longer keeps the name from the next waiter ----------
test('b-18: a wake that cannot start (paused) leaves no 10-minute window; the next waiter is offered it, and the free line is shown', { timeout: 60_000 }, async t => {
  const s = await boot(t, { POCKET_COORD_SWEEP_MS: '200' });
  assert.equal((await s.call('/settings', { coordination: true })).status, 200);
  const b = await s.start('Migrate staging DB __HANG__'), tb = await s.token(b);
  const c = await s.start('Seed demo data __HANG__'), tc = await s.token(c);
  const cli = runner => ({ ...s.bearer(), ...(runner ? { 'x-pocket-runner': runner } : {}) });
  assert.equal((await s.call('/coordination/hold', { name: 'staging-db', reason: 'Restoring a backup', new: true }, cli())).status, 200);
  assert.equal((await s.call('/coordination/wait', { name: 'staging-db' }, cli(tb))).body.position, 1);
  assert.equal((await s.call('/coordination/wait', { name: 'staging-db' }, cli(tc))).body.position, 2);
  assert.equal((await s.call('/pause', {})).status, 200);
  await s.idle(b); await s.idle(c);
  const rel = await s.call('/coordination/release', { name: 'staging-db', note: 'Backup restored' }, cli());
  assert.equal(rel.status, 200); assert.ok(rel.body.woke, 'the first in line is told');
  const queued = id => s.call(`/session/${encodeURIComponent(id)}/queue`).then(r => (r.body.items || []).some(i => /^\[Pocket coordination\] staging-db is free/.test(i.text)));
  assert.equal(await queued(b), true, 'B has its wake, held by the pause');
  // Before the fix C waited out the 10-minute window; now the next sweep (200 ms here) offers it the name.
  await s.until(() => queued(c), 5000, 'C to be offered the name');
  const view = (await s.call('/coordination')).body;
  assert.deepEqual(view.holds, []);
  const free = view.free.find(f => f.name === 'staging-db');
  assert.ok(free, 'the free name is in the view: ' + JSON.stringify(view.free));
  assert.equal(free.offer.session, c); assert.equal(free.offer.held, true, 'its start is held too');
  assert.equal(typeof free.offer.title, 'string');
  assert.match(s.logs(), /coordination wake held session=.* for staging-db/);
  const list = await new Promise(res => { const p = spawn(process.execPath, ['scripts/pocket-coord.mjs', 'list'], { cwd: repo, env: { ...cleanEnv(), POCKET_ENV_FILE: '', POCKET_DATA_DIR: s.data } }); let out = ''; p.stdout.on('data', d => out += d); p.on('close', () => res(out)); });
  assert.match(list, /^staging-db is free\. Offered to ".+" (under a minute|\d+ minutes?) ago; its start is held, so the next in line may have it\.$/m);
});
