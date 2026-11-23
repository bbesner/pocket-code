// 1.124.5: faults found by the flow tests (lane b) and fixed. Each test failed on the code before its fix.
// Servers listen on port 0 or in 21200-21299, and every child is stopped at the end; every secret here is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import readline from 'node:readline';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { createHmac, createECDH, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import ece from 'http_ece';
import { newKey } from '../vault.mjs';
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
async function boot(t, env = {}, { seed } = {}) {
  const dir = fs.realpathSync(tmp('pc-flowsb-')), home = path.join(dir, 'home'), cwd = path.join(home, 'work'), data = path.join(dir, 'data');
  for (const d of [home, cwd, data, path.join(home, 'pocket-uploads'), path.join(dir, 'sessions')]) fs.mkdirSync(d, { recursive: true });
  seed?.(data);
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
// A push service on this machine (as in pause-routes.test.mjs), so a test can read what each push said.
async function pushService(t) {
  const dir = tmp('pc-flowsb-push-'), key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
  const device = createECDH('prime256v1'); device.generateKeys();
  const auth = randomBytes(16).toString('base64url'), got = [];
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => { try { got.push(JSON.parse(ece.decrypt(Buffer.concat(chunks), { version: 'aes128gcm', privateKey: device, authSecret: auth }).toString('utf8'))); } catch (err) { got.push({ error: err.message }); } res.writeHead(201); res.end(); });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r); fs.rmSync(dir, { recursive: true, force: true }); }));
  const vapid = webpush.generateVAPIDKeys();
  return {
    env: { VAPID_PUBLIC: vapid.publicKey, VAPID_PRIVATE: vapid.privateKey, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    seed: data => fs.writeFileSync(path.join(data, 'push-subs.json'), JSON.stringify([{ endpoint: `https://127.0.0.1:${server.address().port}/push/device`, keys: { p256dh: device.getPublicKey('base64url'), auth } }])),
    got,
  };
}
const runCli = (script, args, env, cwd = repo) => new Promise(res => { const p = spawn(process.execPath, [path.join(repo, 'scripts', script), ...args], { cwd, env: { ...cleanEnv(), POCKET_ENV_FILE: '', ...env } }); let out = '', err = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d); p.on('close', code => res({ code, out, err })); });

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

// ---------- b-07a and b-10: Vault pushes and Links sent name the OpenRouter conversation that asked ----------
test('b-07a, b-10: the Ready and Vault request pushes use the conversation\'s title; an agent\'s relinked intake says who made it and that it is link 2', { timeout: 90_000 }, async t => {
  const push = await pushService(t), acpStore = tmp('pc-flowsb-acp-'); t.after(() => fs.rmSync(acpStore, { recursive: true, force: true }));
  const s = await boot(t, { POCKET_ACP_ENABLE: '1', POCKET_ACP_CMD: process.execPath, POCKET_ACP_ARGS: path.join(repo, 'test/fake-acp.mjs'), POCKET_ACP_STORE: acpStore, FAKE_ACP_NO_ASK: '1',
    POCKET_VAULT_KEY: newKey(), POCKET_VAULT_PATH: '/usr/bin:/bin', ...push.env }, { seed: data => { push.seed(data); } });
  assert.equal((await s.call('/settings', { vault: true })).status, 200);
  assert.equal((await s.call('/vault/act', { action: 'add', name: 'demo-key', kind: 'token', values: { value: 'made-up-not-real-0042' } })).status, 200);
  const r = await s.call('/new', { provider: 'acp', cwd: s.cwd, text: 'Deploy the staging site', approvalMode: 'full' });
  assert.equal(r.status, 202, JSON.stringify(r.body)); const id = r.body.id;
  const ready = await s.until(() => push.got.find(p => p.tag === id), 15000, 'the Ready push');
  assert.equal(ready.title, 'Deploy the staging site', 'the Ready push is titled as the list shows it, not "OpenRouter conversation"');
  // A scratch folder in /tmp is left out of the list unless pinned; pinned, its row shows the title the pushes use.
  assert.equal((await s.call(`/session/${encodeURIComponent(id)}/pin`, { pinned: true })).status, 200);
  await s.until(async () => (await s.call('/sessions')).body.sessions.find(x => x.id === id)?.title === 'Deploy the staging site', 15000, 'the list row');
  const store = JSON.parse(fs.readFileSync(path.join(acpStore, encodeURIComponent(id.slice(4)) + '.json'), 'utf8'));
  const agent = args => runCli('pocket-vault.mjs', args, { POCKET_DATA_DIR: s.data, POCKET_RUNNER_TOKEN: store.runnerToken }, s.cwd);
  const run = await agent(['run', '--env', 'DEMO=demo-key', '--wait', '1', '--', 'sh', '-c', 'true']);
  assert.notEqual(run.code, 0, 'the owner is asked first');
  const asked = await s.until(() => push.got.find(p => p.title === 'Allow demo-key?'), 10000, 'the Vault request push');
  assert.match(asked.body, /^Deploy the staging site wants to use it /, 'not "An agent wants to use it"');
  // b-10: the agent's own link, replaced once, then filled in.
  assert.equal((await agent(['request', 'export-api', '--kind', 'token', '--for', 'Pat Lee (Example IT)'])).code, 0);
  const re = await agent(['relink', 'export-api']); assert.equal(re.code, 0, re.err);
  const link = /\/intake\/[A-Za-z0-9_-]{43}/.exec(re.out)[0], base = `http://127.0.0.1:${s.port}`;
  const nonce = /name="nonce" value="([0-9a-f]{32})"/.exec(await (await fetch(base + link)).text())[1];
  const filled = await fetch(base + link, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ nonce, v_value: 'made-up-export-key-77' }).toString() });
  assert.equal(filled.status, 303);
  const fill = await s.until(() => push.got.find(p => p.title === 'Pat Lee (Example IT) filled in export-api'), 10000, 'the fill push');
  assert.match(fill.body, /^The agent in "Deploy the staging site" asked for it\. It is in the Vault now\./);
  const row = (await s.call('/vault')).body.intakes.find(x => x.name === 'export-api');
  assert.deepEqual([row.by, row.sessionTitle, row.links, row.state], ['agent', 'Deploy the staging site', 2, 'filled']);
  assert.equal(JSON.stringify(push.got).includes('made-up'), false, 'no value in any push');
});

// ---------- b-14a: a message sent while the self-update restarts this daemon is refused and kept, not cut ----------
test('b-14a: while the update restarts this version, a new message is refused with "restarting" and nothing runs; the new version and other phases send', { timeout: 60_000 }, async t => {
  const s = await boot(t);
  const version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
  const c = await s.start('First message'); await s.idle(c);
  const job = (phase, from = version) => fs.writeFileSync(path.join(s.data, 'pocket-self-update.json'), JSON.stringify({ id: 'job-1', from, to: '99.0.0', phase, startedAt: Date.now() - 60_000, updatedAt: Date.now() }));
  const refused = [409, { error: 'Pocket is restarting for its update; your message is kept.', code: 'restarting' }];
  job('restarting');
  const fresh = await s.call('/new', { provider: 'claude', cwd: s.cwd, text: 'restart new', approvalMode: 'full' });
  assert.deepEqual([fresh.status, fresh.body], refused, 'a new conversation');
  const msg = await s.call(`/session/${encodeURIComponent(c)}/message`, { text: 'restart message', approvalMode: 'full' });
  assert.deepEqual([msg.status, msg.body], refused, 'a message');
  assert.deepEqual((await s.call(`/session/${encodeURIComponent(c)}/message`, { text: 'restart queued', mode: 'queue', approvalMode: 'full' })).status, 409, 'adding to the queue too (an idle conversation would start it)');
  assert.equal((await s.call(`/session/${encodeURIComponent(c)}/branch`, { text: 'restart branch', approvalMode: 'full' })).status, 409, 'a branch');
  await sleep(300);
  assert.ok(!s.calls().some(x => /^restart /.test(x.text || '')), 'nothing reached the agent');
  // Installing (before the restart's own wait), and the new version (the job still reads restarting until it says complete): sent.
  job('installing');
  assert.equal((await s.call(`/session/${encodeURIComponent(c)}/message`, { text: 'while installing', approvalMode: 'full' })).status, 202);
  await s.idle(c);
  job('restarting', '0.0.1');
  assert.equal((await s.call(`/session/${encodeURIComponent(c)}/message`, { text: 'on the new version', approvalMode: 'full' })).status, 202);
  await s.until(() => s.calls().some(x => x.text === 'on the new version'), 15000, 'the message on the new version');
});
