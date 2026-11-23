// The browser relay's contract (scripts/pocket-mcp-proxy.mjs): written by the bug review of 2026-11-23 on Pocket Code
// 1.124.3 from a behaviour spec, without sight of the source, and kept as a regression suite since. Tests that failed
// there were ruled on by a verifier with the source; what each became is said at the test.
// Blind bug-review tests for the MCP relay, written from the behaviour spec only (never from the source).
// The relay is driven as a child process against a stand-in MCP server (child) and a stand-in daemon (loopback HTTP,
// port 0). Every secret below is made up. Test names carry the spec section they check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tmpDir, snapshot, unchanged, track, alive, until } from './bugreview-faults.mjs';

const RELAY = path.resolve(import.meta.dirname, '../scripts/pocket-mcp-proxy.mjs');
const SHARED = tmpDir('br-mcp-shared-');
const FAKE = path.join(SHARED, 'fake-mcp.mjs');
const PRELOAD = path.join(SHARED, 'shim.mjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- encodings shared by the stand-in server and the assertions ----------
function FORMS(s) {
  const b = Buffer.from(s, 'utf8');
  const j = JSON.stringify(s).slice(1, -1);
  const ascii = j.replace(/[\u0080-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const wrap = p => Buffer.from(p + s + '!', 'utf8').toString('base64');
  return [
    ['literal', s], ['b64', b.toString('base64')], ['b64url', b.toString('base64url')],
    ['b64nopad', b.toString('base64').replace(/=+$/, '')], ['hex', b.toString('hex')], ['HEX', b.toString('hex').toUpperCase()],
    ['reversed', [...s].reverse().join('')], ['uri', encodeURIComponent(s)], ['json', j], ['jsonslash', j.replace(/\//g, '\\/')],
    ['jsonascii', ascii], ['json2', JSON.stringify(JSON.stringify(s)).slice(1, -1)],
    ['b64in1', wrap('x')], ['b64in2', wrap('xy')], ['b64in3', wrap('xyz')],
  ];
}

// ---------- stand-in MCP server ----------
async function fakeMain() {
  const fs = (await import('node:fs')).default;
  const readline = (await import('node:readline')).default;
  const LOG = process.env.FAKE_LOG, MODE = process.env.FAKE_MODE || '';
  const rec = o => { if (LOG) fs.appendFileSync(LOG, JSON.stringify(o) + '\n'); };
  rec({ kind: 'start', pid: process.pid, argv: process.argv.slice(2), envKeys: Object.keys(process.env).sort(), runner: process.env.POCKET_RUNNER_TOKEN ?? null });
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => { rec({ kind: 'signal', sig }); if (MODE !== 'stubborn') process.exit(0); });
  if (MODE === 'closeStdin') { process.stdin.destroy(); try { fs.closeSync(0); } catch {} rec({ kind: 'closed' }); setInterval(() => {}, 1000); return; }
  const out = s => process.stdout.write(s + '\n');
  const reply = (id, result) => out(JSON.stringify({ jsonrpc: '2.0', id, result }));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', async line => {
    rec({ kind: 'line', raw: line });
    let m; try { m = JSON.parse(line); } catch { return; }
    if (!m || typeof m !== 'object' || m.method !== 'tools/call') { if (m && typeof m === 'object' && 'id' in m) reply(m.id, { echoed: true }); return; }
    const a = (m.params && m.params.arguments) || {};
    const t = typeof a.text === 'string' ? a.text : '';
    switch (a._fake || 'echo') {
      case 'silent': return;
      case 'raw': out(a.raw); return;
      case 'stderr': { const k = a.split ?? 3; process.stderr.write('err: ' + t.slice(0, k)); await wait(120); process.stderr.write(t.slice(k)); await wait(120); process.stderr.write(' done\n'); reply(m.id, { content: [{ type: 'text', text: 'logged' }] }); return; }
      case 'quiet': process.stderr.write(a.raw); reply(m.id, { content: [{ type: 'text', text: 'quiet' }] }); return;
      case 'errexit': process.stderr.write(a.raw); await wait(100); process.exit(0); return;
      case 'encoded': reply(m.id, { content: FORMS(t).map(([k, f]) => ({ type: 'text', text: k + '=[' + f + ']' })) }); return;
      case 'key': reply(m.id, { [t]: 'v', content: [] }); return;
      case 'num': reply(m.id, { n: Number(t), content: [] }); return;
      case 'image': reply(m.id, { content: [
        { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
        { type: 'audio', data: 'UklGRg==', mimeType: 'audio/wav' },
        { type: 'resource', resource: { uri: 'file:///tmp/x.png', mimeType: 'image/png', blob: 'iVBORw0KGgo=' } },
        { type: 'text', text: 'still here' }] }); return;
      case 'exit': process.exit(a.code); return;
      case 'selfkill': process.kill(process.pid, 'SIGKILL'); return;
      default: reply(m.id, { content: [{ type: 'text', text: 'args=' + JSON.stringify(a) }] });
    }
  });
  rl.on('close', () => { rec({ kind: 'eof' }); if (MODE === 'ignoreEof' || MODE === 'stubborn') { setInterval(() => {}, 1000); return; } setTimeout(() => process.exit(0), 20); });
}
fs.writeFileSync(FAKE, `${FORMS.toString()}\n(${fakeMain.toString()})();\n`);

// ---------- preload shim for the relay process (timers) ----------
async function shimMain() {
  const fs = (await import('node:fs')).default;
  const tlog = process.env.SHIM_TIMEOUT_LOG, scale = Number(process.env.SHIM_TIMEOUT_SCALE || 1);
  if (tlog) {
    const orig = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = ms => { fs.appendFileSync(tlog, ms + '\n'); return orig(Math.max(1, Math.round(ms * scale))); };
  }
}
fs.writeFileSync(PRELOAD, `await (${shimMain.toString()})();\n`);

// ---------- stand-in daemon ----------
const json = (res, status, obj, type = 'application/json') => { res.writeHead(status, { 'content-type': type }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
const pick = (map, refs) => Object.fromEntries((refs || []).map(k => [k, map[k]]));
async function startDaemon(handler) {
  const d = { reqs: [], values: {}, handler: handler || ((r, res, d) => json(res, 200, { ok: true, values: pick(d.values, r.body && r.body.refs) })) };
  const srv = http.createServer((req, res) => {
    let raw = ''; req.setEncoding('utf8');
    req.on('data', c => { raw += c; });
    req.on('end', async () => {
      let body = null; try { body = JSON.parse(raw); } catch {}
      const r = { method: req.method, url: req.url, headers: req.headers, body, raw, at: Date.now(), n: d.reqs.length };
      d.reqs.push(r);
      try { await d.handler(r, res, d); } catch { res.destroy(); }
    });
  });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  d.port = srv.address().port; d.url = `http://127.0.0.1:${d.port}`;
  d.close = () => new Promise(ok => { srv.closeAllConnections(); srv.close(() => ok()); });
  return d;
}
async function closedPort() { const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const p = s.address().port; await new Promise(ok => s.close(ok)); return p; }

// ---------- relay driver ----------
async function makeCtx(t, { handler, token = 'sample-cli-token-0001\n' } = {}) {
  const dir = fs.realpathSync(tmpDir('br-mcp-'));
  const data = path.join(dir, 'data'); fs.mkdirSync(data);
  if (token !== null) fs.writeFileSync(path.join(data, 'cli-token'), token);
  const daemon = await startDaemon(handler);
  const ctx = { dir, data, daemon, relays: [], n: 0 };
  ctx.start = (o = {}) => startRelay(ctx, o);
  ctx.tokenFile = path.join(data, 'cli-token'); ctx.urlFile = path.join(data, 'cli-url');
  t.after(async () => { for (const r of ctx.relays) await r.dispose(); await daemon.close(); });
  return ctx;
}
function startRelay(ctx, o = {}) {
  const log = path.join(ctx.dir, `child-${ctx.n++}.jsonl`);
  const child = o.child ?? [process.execPath, FAKE, ...(o.extraChild || [])];
  const args = o.args ?? [...(o.name === null ? [] : ['--name', o.name ?? 'fake-browser']), '--', ...child];
  const env = { PATH: process.env.PATH, POCKET_ENV_FILE: path.join(ctx.dir, 'absent.env'), POCKET_DATA_DIR: ctx.data, FAKE_LOG: log, FAKE_MODE: o.mode || '' };
  if (o.url !== false) env.POCKET_URL = ctx.daemon.url;
  Object.assign(env, o.env || {});
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  const nodeArgs = o.preload ? ['--import', pathToFileURL(PRELOAD).href, RELAY, ...args] : [RELAY, ...args];
  const p = spawn(process.execPath, nodeArgs, { cwd: o.cwd || ctx.dir, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  track(p.pid);
  const r = { p, log, out: '', err: '', exit: null };
  p.stdout.setEncoding('utf8'); p.stdout.on('data', c => { r.out += c; });
  p.stderr.setEncoding('utf8'); p.stderr.on('data', c => { r.err += c; });
  p.stdin.on('error', () => {}); p.stdout.on('error', () => {});
  r.exited = new Promise(res => {
    p.on('exit', (code, signal) => { r.exit = { code, signal }; setTimeout(() => res(r.exit), 700); });
    p.on('close', (code, signal) => { r.exit = r.exit || { code, signal }; res(r.exit); });
  });
  r.send = m => { try { p.stdin.write((typeof m === 'string' ? m : JSON.stringify(m)) + '\n'); } catch {} };
  r.outLines = () => r.out.split('\n').slice(0, -1);
  r.msgs = () => r.outLines().map(l => { try { return JSON.parse(l); } catch { return { _raw: l }; } });
  r.resp = (id, ms = 5000) => until(() => r.msgs().find(m => m && typeof m === 'object' && m.id === id), ms);
  r.recs = () => { let s = ''; try { s = fs.readFileSync(log, 'utf8'); } catch {} return s.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return {}; } }); };
  r.got = () => r.recs().filter(x => x.kind === 'line').map(x => x.raw);
  r.gotMsgs = () => r.got().map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(m => m && typeof m === 'object');
  r.gotId = id => r.gotMsgs().some(m => m.id === id);
  r.start = () => r.recs().find(x => x.kind === 'start');
  r.ready = async () => { const s = await until(() => r.start(), 5000); if (s) track(s.pid); return s; };
  r.waitExit = ms => Promise.race([r.exited, sleep(ms).then(() => null)]);
  r.dispose = async () => {
    if (!r.exit) { try { p.stdin.end(); } catch {} await r.waitExit(1500); }
    try { process.kill(-p.pid, 'SIGKILL'); } catch {}
    if (!r.exit) await r.waitExit(1000);
    const s = r.start(); if (s && alive(s.pid)) { try { process.kill(s.pid, 'SIGKILL'); } catch {} }
  };
  ctx.relays.push(r);
  return r;
}

let nid = 100, sn = 0;
const call = (name, args, id = ++nid) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const sec = tag => `SAMPLEsecret9-${tag}-${++sn}`;
const LE = (id, text) => (id === undefined ? { jsonrpc: '2.0', result: { content: [{ type: 'text', text }], isError: true } } : { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } });
const PIC = tool => `Pocket: ${tool} was not taken: a Vault value was typed into this browser session, so no screenshot, PDF or other picture of it is made for the rest of the session (a value cannot be scrubbed out of a picture, and the browser tool would save it to a file). Use text snapshots instead.`;
const FNAME = tool => `Pocket: ${tool} was not run: a Vault value was typed into this browser session, so nothing from it is saved to a file for the rest of the session (a file cannot be scrubbed; what comes back here is). Call it again without filename.`;
const DIS = (listed, tool) => `Pocket types Vault values into ${listed} only, not ${tool}: a value may be typed into a field, never handed to code or put in an address. Use a fill tool; the owner can set POCKET_VAULT_FILL_TOOLS for this relay if another tool should count.`;
const UNREACH = (refs, cause) => `Pocket Code is not reachable, so the Vault could not fill ${refs.join(', ')}: ${cause}`;
const PENDING = (items, tool, req) => `The Vault is asking the owner to allow filling ${items.join(', ')} into ${tool} (request ${req}). Tell the owner, and call this tool again with the same arguments once they allow it.`;
const OFF = 'The Vault is off in this Pocket Code, so it cannot fill that value. Ask the owner.';
const LOCKED = 'The Vault is locked. Ask the owner to unlock it in Pocket Code, then call the tool again.';
const OTHER = (refs, status) => `The Vault could not fill ${refs.join(', ')} (${status}).`;
const MALFORMED = refs => `Pocket Code answered the fill of ${refs.join(', ')} in a form the relay does not understand; nothing was typed. Try again, and tell the owner if it repeats.`;
const REMOVED = 'Removed by Pocket: a Vault value was typed into this browser session, so images, audio and other binary content are not returned from it (a value cannot be scrubbed out of a picture). Use text snapshots instead.';
const DEFAULT_FILL = ['browser_type', 'browser_fill_form', 'type', 'fill'];

async function fillOne(r, ref, { tool = 'browser_type', extra = {} } = {}) {
  const m = call(tool, { element: 'field', text: `{{vault:${ref}}}`, ...extra });
  r.send(m); const resp = await r.resp(m.id); return { m, resp };
}
const textOf = resp => resp && resp.result && resp.result.content && resp.result.content[0] && resp.result.content[0].text;
const T = { timeout: 30000 };

// ================================ §1 startup / configuration ================================
test('§1 startup: no child command -> exact stderr, exit 2', T, async t => {
  const ctx = await makeCtx(t);
  for (const args of [[], ['--name', 'x', '--'], ['--']]) {
    const r = ctx.start({ args });
    const ex = await r.waitExit(5000);
    assert.ok(ex, `relay ${JSON.stringify(args)} did not exit`);
    assert.equal(ex.code, 2, `exit code for ${JSON.stringify(args)}`);
    assert.equal(r.err, 'pocket-mcp-proxy: give the MCP server command after --\n');
    assert.equal(r.out, '');
  }
});

test('§4 startup step 4: spawn error exits 1 with exact message, disk unchanged, restart works', T, async t => {
  const ctx = await makeCtx(t);
  fs.writeFileSync(ctx.urlFile, ctx.daemon.url);
  const tok = snapshot(ctx.tokenFile), url = snapshot(ctx.urlFile);
  const bad = path.join(ctx.dir, 'no-such-server-bin');
  const r = ctx.start({ child: [bad] });
  const ex = await r.waitExit(5000);
  assert.ok(ex, 'relay did not exit on spawn error');
  assert.equal(ex.code, 1);
  assert.equal(r.err, `pocket-mcp-proxy: could not start ${bad}: spawn ${bad} ENOENT\n`);
  assert.equal(ctx.daemon.reqs.length, 0);
  assert.ok(unchanged(ctx.tokenFile, tok) && unchanged(ctx.urlFile, url), 'temp files changed');
  const r2 = ctx.start(); await r2.ready();
  r2.send({ jsonrpc: '2.0', id: 'p1', method: 'ping' });
  assert.ok(await r2.resp('p1'), 'restarted relay does not relay');
});

test('§1 startup: server name derivation from last child argument and no-`--` form', T, async t => {
  const ctx = await makeCtx(t);
  const cases = [[['dir/Ünï cødé!!.x'], 'ncd.x'], [['a'.repeat(70) + '.js'], 'a'.repeat(64)], [['!!!'], 'mcp'], [['some/dir/tool-x.v2'], 'tool-x.v2'], [[], 'fake-mcp.mjs']];
  for (const [extra, want] of cases) {
    const v = sec('name'); ctx.daemon.values.nm = v;
    const r = ctx.start({ name: null, extraChild: extra });
    const before = ctx.daemon.reqs.length;
    await fillOne(r, 'nm');
    const req = ctx.daemon.reqs[before];
    assert.ok(req, `no release for ${JSON.stringify(extra)}`);
    assert.equal(req.body.server, want, `name for ${JSON.stringify(extra)}`);
  }
  // no `--`: every argument is the child command
  const v = sec('nodash'); ctx.daemon.values.nd = v;
  const r = ctx.start({ args: [process.execPath, FAKE] });
  const before = ctx.daemon.reqs.length;
  const { resp } = await fillOne(r, 'nd');
  assert.ok(resp, 'no response without --');
  assert.equal(ctx.daemon.reqs[before].body.server, 'fake-mcp.mjs');
  assert.ok(r.got().length >= 1, 'child without -- did not get the call');
});

test('§1 startup: child env strips service secrets, keeps runner token; no shell', T, async t => {
  const ctx = await makeCtx(t);
  const stripped = ['POCKET_PASSWORD', 'POCKET_SECRET', 'VAPID_PRIVATE', 'POCKET_VAULT_KEY', 'POCKET_VAULT_KEY_PREVIOUS', 'POCKET_SMTP_URL', 'POCKET_SMTP_FROM', 'POCKET_ROUTER_KEY'];
  const env = Object.fromEntries(stripped.map(k => [k, 'made-up-value-123']));
  env.POCKET_RUNNER_TOKEN = 'runner-sample-01'; env.FAKE_KEEP = '1';
  const odd = ['$(touch PWNED1)', '; touch PWNED2 #', '`touch PWNED3`'];
  const r = ctx.start({ env, extraChild: odd });
  const s = await r.ready();
  assert.ok(s, 'child did not start');
  for (const k of stripped) assert.ok(!s.envKeys.includes(k), `child env still has ${k}`);
  assert.ok(s.envKeys.includes('FAKE_KEEP'));
  assert.equal(s.runner, 'runner-sample-01');
  assert.deepEqual(s.argv, odd, 'child argv not passed literally');
  await sleep(200);
  for (const f of ['PWNED1', 'PWNED2', 'PWNED3']) assert.ok(!fs.existsSync(path.join(ctx.dir, f)), `shell ran: ${f}`);
});

test('§1 config: process POCKET_URL beats env-file POCKET_URL; env-file POCKET_URL used when process lacks it', T, async t => {
  const ctx = await makeCtx(t);
  const B = await startDaemon(); t.after(() => B.close());
  const envFile = path.join(ctx.dir, 'test.env');
  fs.writeFileSync(envFile, `POCKET_URL=${B.url}\n`);
  ctx.daemon.values.u1 = sec('u1'); B.values.u1 = ctx.daemon.values.u1;
  const r1 = ctx.start({ env: { POCKET_ENV_FILE: envFile } });
  await fillOne(r1, 'u1');
  assert.equal(ctx.daemon.reqs.length, 1, 'process POCKET_URL daemon not used'); assert.equal(B.reqs.length, 0);
  const r2 = ctx.start({ url: false, env: { POCKET_ENV_FILE: envFile } });
  await fillOne(r2, 'u1');
  assert.equal(B.reqs.length, 1, 'env-file POCKET_URL daemon not used');
});

test('§1/§6 config: valid cli-url used, inherited PORT daemon never gets the token', T, async t => {
  const ctx = await makeCtx(t);
  const B = await startDaemon(); t.after(() => B.close());
  fs.writeFileSync(ctx.urlFile, `http://127.0.0.1:${ctx.daemon.port}`);
  ctx.daemon.values.cu = sec('cu');
  const r = ctx.start({ url: false, env: { PORT: String(B.port) } });
  const { resp } = await fillOne(r, 'cu');
  assert.ok(resp);
  assert.equal(ctx.daemon.reqs.length, 1, 'cli-url daemon not used');
  assert.equal(B.reqs.length, 0, 'token sent to inherited PORT');
});

test('§1 config: invalid cli-url ignored; env-file PORT beats process PORT', T, async t => {
  const ctx = await makeCtx(t);
  const B = await startDaemon(); t.after(() => B.close());
  const envFile = path.join(ctx.dir, 'port.env');
  fs.writeFileSync(envFile, `PORT=${ctx.daemon.port}\n`);
  for (const bad of ['http://example.test:80', 'http://127.0.0.1:12ab', `http://localhost:${B.port}`, `https://127.0.0.1:${B.port}`]) {
    fs.writeFileSync(ctx.urlFile, bad);
    ctx.daemon.values.ip = sec('ip');
    const before = ctx.daemon.reqs.length;
    const r = ctx.start({ url: false, env: { POCKET_ENV_FILE: envFile, PORT: String(B.port) } });
    await fillOne(r, 'ip');
    assert.equal(ctx.daemon.reqs.length, before + 1, `env-file PORT daemon not used with cli-url ${bad}`);
    assert.equal(B.reqs.length, 0, `wrong daemon used with cli-url ${bad}`);
  }
});

test('§4 startup step 1/2: unreadable env file and unreadable cli-url fall back to process PORT', T, async t => {
  const ctx = await makeCtx(t);
  fs.mkdirSync(ctx.urlFile); // cli-url is a directory: unreadable
  const envDir = path.join(ctx.dir, 'envdir'); fs.mkdirSync(envDir);
  ctx.daemon.values.fb = sec('fb');
  const r = ctx.start({ url: false, env: { POCKET_ENV_FILE: envDir, PORT: String(ctx.daemon.port) } });
  const { resp } = await fillOne(r, 'fb');
  assert.ok(resp, 'no response');
  assert.equal(ctx.daemon.reqs.length, 1, 'fallback PORT not used');
});

test('§1 config: data dir from env file when process lacks it; process value wins', T, async t => {
  const ctx = await makeCtx(t);
  const d2 = path.join(ctx.dir, 'data2'); fs.mkdirSync(d2);
  fs.writeFileSync(path.join(d2, 'cli-token'), 'token-from-envfile-dir\n');
  const envFile = path.join(ctx.dir, 'dd.env'); fs.writeFileSync(envFile, `POCKET_DATA_DIR=${d2}\n`);
  ctx.daemon.values.dd = sec('dd');
  const r1 = ctx.start({ env: { POCKET_ENV_FILE: envFile, POCKET_DATA_DIR: undefined } });
  await fillOne(r1, 'dd');
  assert.equal(ctx.daemon.reqs[0].headers.authorization, 'Bearer token-from-envfile-dir');
  const r2 = ctx.start({ env: { POCKET_ENV_FILE: envFile } });
  await fillOne(r2, 'dd');
  assert.equal(ctx.daemon.reqs[1].headers.authorization, 'Bearer sample-cli-token-0001');
});

test('§2 release: request method, path, headers and first body', T, async t => {
  const ctx = await makeCtx(t, { token: '  sample-cli-token-0002 \n' });
  ctx.daemon.values['site-1.password'] = sec('hdr');
  const r = ctx.start({ env: { POCKET_RUNNER_TOKEN: 'runner-sample-02' } });
  await fillOne(r, 'site-1.password');
  const q = ctx.daemon.reqs[0];
  assert.equal(q.method, 'POST'); assert.equal(q.url, '/api/vault/release');
  assert.match(q.headers['content-type'], /^application\/json/);
  assert.equal(q.headers.authorization, 'Bearer sample-cli-token-0002');
  assert.equal(q.headers['x-pocket-runner'], 'runner-sample-02');
  assert.deepEqual(q.body, { refs: ['site-1.password'], server: 'fake-browser', tool: 'browser_type', cwd: ctx.dir, wait: 90 });
  const r2 = ctx.start();
  await fillOne(r2, 'site-1.password');
  assert.equal(ctx.daemon.reqs[1].headers['x-pocket-runner'], undefined, 'runner header sent without POCKET_RUNNER_TOKEN');
});

test('§1 release: POCKET_VAULT_FILL_WAIT parsing', T, async t => {
  const ctx = await makeCtx(t);
  for (const [w, want] of [['5', 5], ['0', 90], ['0.25', 1], ['abc', 90], ['-3', 1]]) {
    ctx.daemon.values.w = sec('w');
    const before = ctx.daemon.reqs.length;
    const r = ctx.start({ env: { POCKET_VAULT_FILL_WAIT: w } });
    await fillOne(r, 'w');
    assert.equal(ctx.daemon.reqs[before].body.wait, want, `wait for ${w}`);
  }
});

test('§1/§5 release: HTTP abort is (WAIT+15)*1000 ms and a timeout becomes a transport error', T, async t => {
  const ctx = await makeCtx(t, { handler: () => {} }); // never answers
  const tlog = path.join(ctx.dir, 'timeouts.log');
  const r = ctx.start({ preload: true, env: { SHIM_TIMEOUT_LOG: tlog, SHIM_TIMEOUT_SCALE: '0.01', POCKET_VAULT_FILL_WAIT: '7' } });
  const { m, resp } = await fillOne(r, 'to');
  assert.ok(resp, 'no answer after timeout');
  assert.equal(fs.readFileSync(tlog, 'utf8').split('\n')[0], '22000');
  assert.ok(textOf(resp).startsWith(UNREACH(['to'], '')), `got: ${textOf(resp)}`);
  assert.equal(resp.result.isError, true);
  assert.ok(!r.gotId(m.id), 'child got the call');
  const tlog2 = path.join(ctx.dir, 'timeouts2.log');
  const r2 = ctx.start({ preload: true, env: { SHIM_TIMEOUT_LOG: tlog2, SHIM_TIMEOUT_SCALE: '0.001' } });
  await fillOne(r2, 'to');
  assert.equal(fs.readFileSync(tlog2, 'utf8').split('\n')[0], '105000');
});

test('§4 fill step 2: token is re-read per release; absent token sends empty bearer and the daemon refusal is returned', T, async t => {
  const ctx = await makeCtx(t, { handler: (q, res, d) => (q.headers.authorization === 'Bearer sample-cli-token-0001' || q.headers.authorization === 'Bearer second-token-0002'
    ? json(res, 200, { ok: true, values: pick(d.values, q.body.refs) }) : json(res, 401, { error: 'Sign in first.' })) });
  ctx.daemon.values.tk = sec('tk');
  const r = ctx.start();
  await fillOne(r, 'tk');
  fs.writeFileSync(ctx.tokenFile, '  second-token-0002  \n');
  await fillOne(r, 'tk');
  assert.equal(ctx.daemon.reqs[1].headers.authorization, 'Bearer second-token-0002');
  fs.unlinkSync(ctx.tokenFile);
  const r2 = ctx.start();
  const { m, resp } = await fillOne(r2, 'tk');
  assert.match(ctx.daemon.reqs[2].headers.authorization || '', /^Bearer\s*$/);
  assert.deepEqual(resp, LE(m.id, 'Sign in first.'));
  assert.ok(!r2.gotId(m.id), 'child got a call after refusal');
  const shot = call('browser_take_screenshot', {}); r2.send(shot); await r2.resp(shot.id);
  assert.ok(r2.gotId(shot.id), 'filled became true after a refused release');
});

// ================================ §2 agent stdin ================================
test('§2 stdin: invalid JSON byte-for-byte, other JSON re-serialised compactly (pre and post fill)', T, async t => {
  const ctx = await makeCtx(t);
  const r = ctx.start(); await r.ready();
  const lines = ['this is {not json} ü {{vault:a}}', '{ "jsonrpc" : "2.0", "id" : 3, "method" : "ping" }', '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":null}', '42'];
  for (const l of lines) r.send(l);
  await until(() => r.got().length >= 4, 3000);
  assert.deepEqual(r.got().slice(0, 4), ['this is {not json} ü {{vault:a}}', '{"jsonrpc":"2.0","id":3,"method":"ping"}', '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":null}', '42']);
  ctx.daemon.values.a = sec('ij');
  await fillOne(r, 'a');
  r.send('still {not json} {{vault:a}}  ');
  await until(() => r.got().includes('still {not json} {{vault:a}}  '), 3000);
  assert.ok(r.got().includes('still {not json} {{vault:a}}  '), 'post-fill invalid JSON not forwarded byte-for-byte');
});

test('§2 stdin: a bare JSON null line is forwarded and the relay keeps running', T, async t => {
  const ctx = await makeCtx(t);
  const r = ctx.start(); await r.ready();
  r.send('null');
  r.send({ jsonrpc: '2.0', id: 'after-null', method: 'ping' });
  assert.ok(await r.resp('after-null', 3000), 'relay stopped relaying after a null line');
  assert.equal(r.got()[0], 'null');
});

test('§2 refs: malformed placeholders are not refs (forwarded unchanged, no release)', T, async t => {
  const ctx = await makeCtx(t);
  const r = ctx.start();
  const bad = ['{{vault:Login}}', '{{ vault:a }}', '{{vault:a.Pass}}', '{{vault:a.1x}}', '{{vault:}}', '{{vault:a_b}}', '{{vault:{{vault:a}}}', '{{vault:a.b.c}}'];
  for (const b of bad.filter(x => x !== '{{vault:{{vault:a}}}')) {
    const m = call('browser_navigate', { url: `https://example.test/?q=${b}` });
    r.send(m); await r.resp(m.id);
    const g = r.gotMsgs().find(x => x.id === m.id);
    assert.ok(g, `${b} was not forwarded`);
    assert.deepEqual(g, m, `${b} not forwarded unchanged`);
  }
  assert.equal(ctx.daemon.reqs.length, 0, 'a malformed placeholder triggered a release');
  // keys and non-strings are never refs
  const k = call('browser_type', { ['{{vault:a}}']: 'x', n: 5, flag: true, list: [1, false] });
  r.send(k); await r.resp(k.id);
  assert.deepEqual(r.gotMsgs().find(x => x.id === k.id), k);
  assert.equal(ctx.daemon.reqs.length, 0, 'a key placeholder triggered a release');
});

test('§2 refs: distinct refs in first-encounter order, nested arrays/objects', T, async t => {
  const ctx = await makeCtx(t);
  Object.assign(ctx.daemon.values, { 'b.user': sec('bu'), a: sec('a'), c: sec('c') });
  const r = ctx.start();
  const m = call('browser_fill_form', { fields: [{ value: '{{vault:b.user}}' }, { value: '{{vault:a}} and {{vault:b.user}}' }], note: '{{vault:c}}' });
  r.send(m); await r.resp(m.id);
  assert.deepEqual(ctx.daemon.reqs[0].body.refs, ['b.user', 'a', 'c']);
  assert.equal(ctx.daemon.reqs[0].body.tool, 'browser_fill_form');
});

test('§2 disallowed fill: refs in a non-fill tool are refused locally (default list, unnamed tool)', T, async t => {
  const ctx = await makeCtx(t);
  const r = ctx.start();
  const m = call('browser_navigate', { url: 'https://example.test/{{vault:a}}' });
  r.send(m); const resp = await r.resp(m.id);
  const txt = textOf(resp);
  assert.equal(resp.result.isError, true);
  const pre = 'Pocket types Vault values into ', suf = ' only, not browser_navigate: a value may be typed into a field, never handed to code or put in an address. Use a fill tool; the owner can set POCKET_VAULT_FILL_TOOLS for this relay if another tool should count.';
  assert.ok(txt.startsWith(pre) && txt.endsWith(suf), `text: ${txt}`);
  const mid = txt.slice(pre.length, txt.length - suf.length); let at = -1;
  for (const tool of DEFAULT_FILL) { const i = mid.indexOf(tool, at + 1); assert.ok(i > at, `listed tools missing/out of order: ${mid}`); at = i; }
  assert.deepEqual(Object.keys(resp).sort(), ['id', 'jsonrpc', 'result']);
  assert.ok(!r.gotId(m.id)); assert.equal(ctx.daemon.reqs.length, 0);
  const u = { jsonrpc: '2.0', id: 'noname', method: 'tools/call', params: { arguments: { text: '{{vault:a}}' } } };
  r.send(u); const ru = await r.resp('noname');
  assert.ok(textOf(ru).endsWith(' only, not tool: a value may be typed into a field, never handed to code or put in an address. Use a fill tool; the owner can set POCKET_VAULT_FILL_TOOLS for this relay if another tool should count.'), textOf(ru));
  // string id and absent id
  r.send(call('browser_evaluate', { fn: '{{vault:a}}' }, 'str-id-1'));
  const rs = await r.resp('str-id-1'); assert.equal(rs.result.isError, true);
  const noId = { jsonrpc: '2.0', method: 'tools/call', params: { name: 'browser_evaluate', arguments: { fn: '{{vault:a}}' } } };
  const before = r.outLines().length; r.send(noId);
  await until(() => r.outLines().length > before, 3000);
  const line = JSON.parse(r.outLines()[before]);
  assert.ok(!('id' in line), 'id property present for a request without id');
  assert.equal(line.result.isError, true);
});

test('§1 POCKET_VAULT_FILL_TOOLS replaces the default list (trimmed, empties/duplicates dropped)', T, async t => {
  const ctx = await makeCtx(t);
  ctx.daemon.values.mf = sec('mf');
  const r = ctx.start({ env: { POCKET_VAULT_FILL_TOOLS: ' my_fill , ,my_fill' } });
  const m = call('browser_type', { text: '{{vault:mf}}' });
  r.send(m); assert.deepEqual(await r.resp(m.id), LE(m.id, DIS('my_fill', 'browser_type')));
  const { m: m2, resp } = await fillOne(r, 'mf', { tool: 'my_fill' });
  assert.ok(resp && !resp.result.isError, 'custom fill tool not allowed');
  assert.ok(r.gotId(m2.id));
});

test('§2 fill: substitution only in string values; message fields preserved; replacement is literal', T, async t => {
  const ctx = await makeCtx(t);
  const v = 'p$&q$1r$$s$`t$\'u-' + (++sn); ctx.daemon.values.x = v;
  const r = ctx.start();
  const m = { jsonrpc: '2.0', id: 'sub-1', method: 'tools/call', extra: 'keep', params: { name: 'fill', meta: { k: 1 }, arguments: {
    text: '{{vault:x}}', nested: { arr: ['pre {{vault:x}} post', 7, true, null] }, ['{{vault:x}}']: 'key stays', n: 5 } } };
  r.send(m); await r.resp('sub-1');
  const got = r.gotMsgs().find(x => x.id === 'sub-1');
  assert.ok(got, 'child did not get the filled call');
  assert.deepEqual(got, { ...m, params: { ...m.params, arguments: { text: v, nested: { arr: [`pre ${v} post`, 7, true, null] }, ['{{vault:x}}']: 'key stays', n: 5 } } });
});

test('§2 fill: an empty-string value is valid, substituted, and turns on the post-fill lockout', T, async t => {
  const ctx = await makeCtx(t);
  ctx.daemon.values.e = '';
  const r = ctx.start();
  const { m } = await fillOne(r, 'e');
  const got = r.gotMsgs().find(x => x.id === m.id);
  assert.ok(got, 'empty value not typed'); assert.equal(got.params.arguments.text, '');
  const s = call('browser_take_screenshot', {}); r.send(s);
  assert.deepEqual(await r.resp(s.id), LE(s.id, PIC('browser_take_screenshot')));
});

// ================================ §2 post-fill checks ================================
test('§2 post-fill: picture tools forwarded before a fill, refused after (default and added tools)', T, async t => {
  const ctx = await makeCtx(t);
  ctx.daemon.values.p = sec('pic');
  const r = ctx.start({ env: { POCKET_VAULT_PICTURE_TOOLS: ' snap , ,snap,cam' } });
  for (const tool of ['browser_take_screenshot', 'snap']) {
    const m = call(tool, {}); r.send(m); await r.resp(m.id); assert.ok(r.gotId(m.id), `${tool} not forwarded pre-fill`);
  }
  await fillOne(r, 'p');
  for (const tool of ['browser_take_screenshot', 'browser_pdf_save', 'screenshot', 'snap', 'cam']) {
    const m = call(tool, { type: 'png' }); r.send(m);
    assert.deepEqual(await r.resp(m.id), LE(m.id, PIC(tool)), tool);
    await sleep(50); assert.ok(!r.gotId(m.id), `${tool} forwarded after fill`);
  }
  const m = call('browser_take_screenshot', { text: '{{vault:p}}' }); r.send(m);
  assert.deepEqual(await r.resp(m.id), LE(m.id, PIC('browser_take_screenshot')), 'picture check must precede ref check');
});

test('§2 post-fill: a pre-fill picture call naming a ref is a disallowed fill', T, async t => {
  const ctx = await makeCtx(t);
  const r = ctx.start({ env: { POCKET_VAULT_FILL_TOOLS: 'browser_type' } });
  const m = call('browser_take_screenshot', { text: '{{vault:p}}' }); r.send(m);
  assert.deepEqual(await r.resp(m.id), LE(m.id, DIS('browser_type', 'browser_take_screenshot')));
});

test('§2 post-fill: top-level filename refused after a fill (even for fill tools, no release); nested filename allowed', T, async t => {
  const ctx = await makeCtx(t);
  ctx.daemon.values.f = sec('fn');
  const r = ctx.start();
  const pre = call('browser_snapshot', { filename: 'page.md' }); r.send(pre); await r.resp(pre.id);
  assert.ok(r.gotId(pre.id), 'filename call not forwarded pre-fill');
  await fillOne(r, 'f');
  const n0 = ctx.daemon.reqs.length;
  for (const [tool, args] of [['browser_snapshot', { filename: 'page.md' }], ['browser_type', { filename: 'x', text: '{{vault:f}}' }], ['browser_network_requests', { filename: '' }]]) {
    const m = call(tool, args); r.send(m);
    assert.deepEqual(await r.resp(m.id), LE(m.id, FNAME(tool)), tool);
    await sleep(50); assert.ok(!r.gotId(m.id), `${tool} with filename forwarded`);
  }
  assert.equal(ctx.daemon.reqs.length, n0, 'release requested for a filename call');
  const nested = call('browser_snapshot', { opts: { filename: 'x' } }); r.send(nested); await r.resp(nested.id);
  assert.ok(r.gotId(nested.id), 'nested filename refused (check is top-level only)');
});

// ================================ §2 release outcomes ================================
test('§2 release: pending approval, continuation by request id, then fresh request', T, async t => {
  const seq = [{ pending: true, request: 'req-AAA', items: ['Site login'] }, 'ok', 'ok'];
  const ctx = await makeCtx(t, { handler: (q, res, d) => { const s = seq[q.n]; s === 'ok' ? json(res, 200, { ok: true, values: { 'site.password': d.values['site.password'] } }) : json(res, 202, s); } });
  ctx.daemon.values['site.password'] = sec('pend');
  const r = ctx.start();
  const { m, resp } = await fillOne(r, 'site.password');
  assert.deepEqual(resp, LE(m.id, PENDING(['Site login'], 'browser_type', 'req-AAA')));
  assert.ok(!r.gotId(m.id), 'pending call reached child');
  const s = call('browser_take_screenshot', {}); r.send(s); await r.resp(s.id);
  assert.ok(r.gotId(s.id), 'pending set filled=true');
  const { m: m2 } = await fillOne(r, 'site.password');
  assert.deepEqual(ctx.daemon.reqs[1].body, { request: 'req-AAA', wait: 90 });
  assert.ok(r.gotId(m2.id), 'approved continuation not typed');
  await fillOne(r, 'site.password');
  assert.deepEqual(ctx.daemon.reqs[2].body.refs, ['site.password'], 'key not deleted after success');
});

test('§2 release: pending without items names refs; a repeated pending stores the new id; errors delete the key', T, async t => {
  const seq = [{ pending: true, request: 'req-1' }, { pending: true, request: 'req-2' }, { error: 'Denied by owner.' }, { pending: true, request: 'req-3' }];
  const ctx = await makeCtx(t, { handler: (q, res) => json(res, q.n === 2 ? 403 : 202, seq[q.n]) });
  const r = ctx.start();
  const m = call('browser_fill_form', { a: '{{vault:a}}', b: '{{vault:b.pw}}' });
  r.send(m); assert.deepEqual(await r.resp(m.id), LE(m.id, PENDING(['a', 'b.pw'], 'browser_fill_form', 'req-1')));
  const m2 = { ...m, id: ++nid }; r.send(m2); assert.deepEqual(await r.resp(m2.id), LE(m2.id, PENDING(['a', 'b.pw'], 'browser_fill_form', 'req-2')));
  assert.deepEqual(ctx.daemon.reqs[1].body, { request: 'req-1', wait: 90 });
  const m3 = { ...m, id: ++nid }; r.send(m3); assert.deepEqual(await r.resp(m3.id), LE(m3.id, 'Denied by owner.'));
  assert.deepEqual(ctx.daemon.reqs[2].body, { request: 'req-2', wait: 90 });
  const m4 = { ...m, id: ++nid }; r.send(m4); await r.resp(m4.id);
  assert.deepEqual(ctx.daemon.reqs[3].body.refs, ['a', 'b.pw'], 'key kept after an error answer');
});

test('§2/§5 release: a 404 on continuation drops the key and requests afresh in the same call', T, async t => {
  const ctx = await makeCtx(t, { handler: (q, res, d) => {
    if (q.n === 0) return json(res, 202, { pending: true, request: 'req-X' });
    if (q.n === 1) return json(res, 404, { error: 'No such request.' });
    return json(res, 200, { ok: true, values: pick(d.values, q.body.refs) });
  } });
  ctx.daemon.values.k = sec('404');
  const r = ctx.start();
  await fillOne(r, 'k');
  const { m } = await fillOne(r, 'k');
  assert.equal(ctx.daemon.reqs.length, 3);
  assert.deepEqual(ctx.daemon.reqs[1].body, { request: 'req-X', wait: 90 });
  assert.deepEqual(ctx.daemon.reqs[2].body.refs, ['k']);
  assert.ok(r.gotId(m.id), 'fresh request after 404 not typed');
});

test('§5 pending key is per ordered (tool, refs)', T, async t => {
  let n = 0;
  const ctx = await makeCtx(t, { handler: (q, res) => json(res, 202, { pending: true, request: `req-${++n}` }) });
  const r = ctx.start();
  const ab = () => call('browser_fill_form', { x: '{{vault:a}}', y: '{{vault:b}}' });
  const ba = () => call('browser_fill_form', { x: '{{vault:b}}', y: '{{vault:a}}' });
  let m = ab(); r.send(m); await r.resp(m.id);
  m = ba(); r.send(m); await r.resp(m.id);
  assert.deepEqual(ctx.daemon.reqs[1].body.refs, ['b', 'a'], 'different order reused a pending key');
  m = call('fill', { x: '{{vault:a}}', y: '{{vault:b}}' }); r.send(m); await r.resp(m.id);
  assert.deepEqual(ctx.daemon.reqs[2].body.refs, ['a', 'b'], 'different tool reused a pending key');
  m = ab(); r.send(m); await r.resp(m.id);
  assert.deepEqual(ctx.daemon.reqs[3].body, { request: 'req-1', wait: 90 });
});

test('§2 release: vault_off, vault_locked, error verbatim, status fallback', T, async t => {
  const answers = [[409, { code: 'vault_off', error: 'raw off text' }], [423, { code: 'vault_locked', error: 'raw locked text' }], [403, { error: 'This item may not be filled here.' }], [403, { error: '' , pending: false }], [400, { ok: false, error: null, code: 'other' }]];
  const ctx = await makeCtx(t, { handler: (q, res) => json(res, answers[q.n][0], answers[q.n][1]) });
  const r = ctx.start();
  const want = [OFF, LOCKED, 'This item may not be filled here.', OTHER(['q'], 403), OTHER(['q'], 400)];
  for (const w of want) {
    const { m, resp } = await fillOne(r, 'q');
    assert.deepEqual(resp, LE(m.id, w));
    assert.ok(!r.gotId(m.id));
  }
});

test('§4 daemon audit failure: 500 with error, dropped connection, refused connection never type a value', T, async t => {
  const ctx = await makeCtx(t, { handler: (q, res) => (q.n === 0 ? json(res, 500, { error: 'audit append failed' }) : res.socket.destroy()) });
  fs.writeFileSync(ctx.urlFile, ctx.daemon.url);
  const tok = snapshot(ctx.tokenFile), url = snapshot(ctx.urlFile);
  const r = ctx.start();
  let { m, resp } = await fillOne(r, 'au');
  assert.deepEqual(resp, LE(m.id, 'audit append failed'));
  ({ m, resp } = await fillOne(r, 'au'));
  assert.ok(textOf(resp).startsWith(UNREACH(['au'], '')), textOf(resp));
  assert.ok(textOf(resp).length > UNREACH(['au'], '').length, 'empty cause');
  const port = await closedPort();
  const r2 = ctx.start({ env: { POCKET_URL: `http://127.0.0.1:${port}` } });
  const mm = call('browser_fill_form', { a: '{{vault:au}}', b: '{{vault:other}}' }); r2.send(mm);
  assert.deepEqual(await r2.resp(mm.id), LE(mm.id, UNREACH(['au', 'other'], 'ECONNREFUSED')));
  for (const rr of [r, r2]) { const s = call('browser_take_screenshot', {}); rr.send(s); await rr.resp(s.id); assert.ok(rr.gotId(s.id), 'filled set after a failed release'); }
  assert.equal(r.gotMsgs().filter(x => x.params && x.params.name === 'browser_type').length, 0, 'child got a fill');
  assert.ok(unchanged(ctx.tokenFile, tok) && unchanged(ctx.urlFile, url));
  // restart on the same files with a healthy daemon
  ctx.daemon.handler = (q, res) => json(res, 200, { ok: true, values: { au: 'restart-value-0001' } });
  const r3 = ctx.start(); const { m: m3 } = await fillOne(r3, 'au');
  assert.ok(r3.gotId(m3.id), 'restart could not fill');
});

test('§1/§4 a 500 answer carrying ok:true values is not treated as a release', T, async t => {
  const ctx = await makeCtx(t, { handler: (q, res) => json(res, 500, { ok: true, values: { v5: 'should-not-type-0001' } }) });
  const r = ctx.start();
  const { m, resp } = await fillOne(r, 'v5');
  assert.ok(!r.gotId(m.id), 'a value from an HTTP 500 answer was typed');
  assert.equal(resp && resp.result && resp.result.isError, true);
});

test('§2 release: malformed answer logs only status/type/length, retries once after 1.5 s, then status fallback', T, async t => {
  const body = 'BODYMARK-SAMPLEsecret9-not-json';
  const ctx = await makeCtx(t, { handler: (q, res) => json(res, 500, body, 'text/plain') });
  const r = ctx.start();
  const t0 = Date.now();
  const { m, resp } = await fillOne(r, 'mal');
  const dt = Date.now() - t0;
  assert.deepEqual(resp, LE(m.id, OTHER(['mal'], 500)));
  assert.equal(ctx.daemon.reqs.length, 2, 'not exactly one retry');
  assert.deepEqual(ctx.daemon.reqs[1].body, ctx.daemon.reqs[0].body);
  assert.ok(dt >= 1400, `retry too fast: ${dt} ms`);
  assert.ok(!r.err.includes('BODYMARK'), 'response body logged');
  assert.ok(r.err.includes('500') && r.err.includes('text/plain') && r.err.includes(String(body.length)), `diagnostic: ${r.err}`);
  assert.ok(!r.gotId(m.id));
});

test('§2 release: 200 with invalid JSON twice is an error, nothing typed', T, async t => {
  const ctx = await makeCtx(t, { handler: (q, res) => json(res, 200, '<html>oops</html>', 'text/html') });
  const r = ctx.start();
  const { m, resp } = await fillOne(r, 'h');
  assert.equal(resp.result.isError, true);
  assert.ok([OTHER(['h'], 200), MALFORMED(['h'])].includes(textOf(resp)), textOf(resp));
  assert.ok(!r.gotId(m.id));
});

test('§2 release: object lacking ok/pending/error, then a valid answer, fills after one retry', T, async t => {
  const ctx = await makeCtx(t, { handler: (q, res, d) => (q.n === 0 ? json(res, 200, { hello: 1 }) : json(res, 200, { ok: true, values: { rt: d.values.rt } })) });
  ctx.daemon.values.rt = sec('retry');
  const r = ctx.start();
  const t0 = Date.now();
  const { m } = await fillOne(r, 'rt');
  assert.ok(Date.now() - t0 >= 1400);
  assert.ok(r.gotId(m.id), 'value not typed after retry');
  // a JSON string (non-object) also triggers the retry
  ctx.daemon.handler = (q, res, d) => (q.n === 2 ? json(res, 200, '"just a string"') : json(res, 200, { ok: true, values: { rt: d.values.rt } }));
  const { m: m2 } = await fillOne(r, 'rt');
  assert.equal(ctx.daemon.reqs.length, 4); assert.ok(r.gotId(m2.id));
});

test('§2/§4 fill step 5: malformed successful values type nothing and leave filled=false', T, async t => {
  const bad = [{ ok: true, values: {} }, { ok: true, values: { mv: 'value-0001', extra: 'x-0001' } }, { ok: true, values: { mv: 12345 } }, { ok: true, values: ['value-0001'] }, { ok: true }, { ok: true, values: null }, { ok: true, values: 'mv' }];
  const ctx = await makeCtx(t, { handler: (q, res) => json(res, 200, bad[q.n]) });
  const r = ctx.start();
  for (const b of bad) {
    const { m, resp } = await fillOne(r, 'mv');
    assert.deepEqual(resp, LE(m.id, MALFORMED(['mv'])), JSON.stringify(b));
    assert.ok(!r.gotId(m.id), `typed for ${JSON.stringify(b)}`);
  }
  const s = call('browser_take_screenshot', {}); r.send(s); await r.resp(s.id);
  assert.ok(r.gotId(s.id), 'filled=true after malformed values');
});

test('§5 the same ref in two calls makes two full release requests', T, async t => {
  const ctx = await makeCtx(t); ctx.daemon.values.tw = sec('twice');
  const r = ctx.start();
  await fillOne(r, 'tw'); await fillOne(r, 'tw');
  assert.equal(ctx.daemon.reqs.length, 2);
  assert.deepEqual(ctx.daemon.reqs[1].body.refs, ['tw']);
});

// ================================ §2/§6 scrubbing ================================
test('§2 output: before a fill child output passes unchanged; after it JSON is compacted and scrubbed', T, async t => {
  const ctx = await makeCtx(t);
  const v = 'Alnum' + sec('cmp').replace(/-/g, ''); ctx.daemon.values.x = v;
  const r = ctx.start();
  const spaced = '{ "jsonrpc" : "2.0" , "id" : "rawpre" , "result" : { "x" : 1 } }';
  r.send(call('browser_snapshot', { _fake: 'raw', raw: spaced }));
  await until(() => r.outLines().includes(spaced), 3000);
  assert.ok(r.outLines().includes(spaced), 'pre-fill line was altered');
  const img = call('browser_snapshot', { _fake: 'image' }); r.send(img);
  const pre = await r.resp(img.id);
  assert.equal(pre.result.content[0].type, 'image', 'binary stripped before any fill');
  r.send(call('browser_type', { _fake: 'raw', raw: '{ "jsonrpc" : "2.0" , "id" : "rawpost" , "result" : { "t" : "{{vault:x}}" } }' }));
  await until(() => r.outLines().some(l => l.includes('rawpost')), 3000);
  assert.ok(r.outLines().includes('{"jsonrpc":"2.0","id":"rawpost","result":{"t":"{{vault:x}}"}}'), r.outLines().join('\n'));
  r.send(call('browser_snapshot', { _fake: 'raw', raw: `note: ${v} end` }));
  await until(() => r.outLines().some(l => l.startsWith('note:')), 3000);
  assert.ok(r.outLines().includes('note: {{vault:x}} end'));
  assert.ok(!r.out.includes(v), 'value leaked to stdout');
});

test('§2/§6 scrub: echoed value, JSON-escaped spellings, and every listed encoding are replaced', T, async t => {
  const ctx = await makeCtx(t);
  const v = `SAMPLE/sé"cret€😀9-enc-${++sn}`; ctx.daemon.values['enc.pw'] = v;
  const r = ctx.start();
  const { resp } = await fillOne(r, 'enc.pw');
  assert.ok(textOf(resp).includes('{{vault:enc.pw}}'), textOf(resp));
  const m = call('browser_snapshot', { _fake: 'encoded', text: v }); r.send(m);
  const out = await r.resp(m.id);
  const items = out.result.content;
  for (const [k, f] of FORMS(v)) {
    const it = items.find(x => x.text.startsWith(k + '='));
    assert.ok(it, `missing ${k}`);
    assert.ok(!it.text.includes(f), `${k} form not scrubbed: ${it.text}`);
    assert.ok(it.text.includes('{{vault:enc.pw}}'), `${k} has no placeholder: ${it.text}`);
  }
  for (const [, f] of FORMS(v).slice(0, 12)) assert.ok(!r.out.includes(f), 'raw stdout carries a secret spelling');
});

test('§2 scrub: object keys and numeric spellings become placeholders', T, async t => {
  const ctx = await makeCtx(t);
  const k = sec('key'), num = String(424200000 + (++sn)); Object.assign(ctx.daemon.values, { kk: k, nn: num });
  const r = ctx.start();
  const { resp } = await fillOne(r, 'kk', { extra: { _fake: 'key' } });
  assert.ok(resp, 'no response'); assert.ok(!Object.keys(resp.result).includes(k)); assert.ok('{{vault:kk}}' in resp.result, JSON.stringify(resp.result));
  const { resp: rn } = await fillOne(r, 'nn', { extra: { _fake: 'num' } });
  assert.equal(rn.result.n, '{{vault:nn}}');
});

test('§2 scrub: images, audio and blobs are withheld after a fill; text stays', T, async t => {
  const ctx = await makeCtx(t); ctx.daemon.values.i = sec('img');
  const r = ctx.start(); await fillOne(r, 'i');
  const m = call('browser_snapshot', { _fake: 'image' }); r.send(m);
  const out = await r.resp(m.id);
  assert.deepEqual(out.result.content, [
    { type: 'text', text: REMOVED }, { type: 'text', text: REMOVED },
    { type: 'resource', resource: { uri: 'file:///tmp/x.png', mimeType: 'text/plain', text: REMOVED } },
    { type: 'text', text: 'still here' }]);
});

test('§2 scrub: literal substring (no word boundary), longest value first, old and new value under one ref', T, async t => {
  const ctx = await makeCtx(t);
  const base = 'abcdEFGH' + (++sn), longer = base + 'zzLONGER';
  let turn = 0;
  ctx.daemon.handler = (q, res) => json(res, 200, { ok: true, values: q.body.refs.length === 2 ? { a: base, b: longer } : { a: turn++ === 0 ? 'rotA-' + sn : 'rotB-' + sn } });
  const r = ctx.start();
  const m = call('fill', { x: '{{vault:a}}', y: '{{vault:b}}' }); r.send(m); await r.resp(m.id);
  const e = call('browser_snapshot', { text: `xx${longer}yy ${base}` }); r.send(e);
  const t1 = textOf(await r.resp(e.id));
  assert.ok(t1.includes('xx{{vault:b}}yy') && t1.includes(' {{vault:a}}'), t1);
  await fillOne(r, 'a'); await fillOne(r, 'a');
  const e2 = call('browser_snapshot', { text: `old rotA-${sn} new rotB-${sn}`, _fake: 'echo' }); r.send(e2);
  const t2 = textOf(await r.resp(e2.id));
  assert.ok(!t2.includes(`rotA-${sn}`) && !t2.includes(`rotB-${sn}`), t2);
});

test('§2 scrub: values under four code units are not scrubbed (deliberate)', T, async t => {
  const ctx = await makeCtx(t); ctx.daemon.values.sh = 'q7z';
  const r = ctx.start();
  const { m } = await fillOne(r, 'sh');
  assert.equal(r.gotMsgs().find(x => x.id === m.id).params.arguments.text, 'q7z');
  const e = call('browser_snapshot', { text: 'short q7z here' }); r.send(e);
  assert.ok(textOf(await r.resp(e.id)).includes('q7z'));
});

test('§2 fill/scrub: a value with a lone surrogate is either refused (error 10) or typed and scrubbed', T, async t => {
  const ctx = await makeCtx(t);
  const v = 'lone\uD800surrogate-' + (++sn); ctx.daemon.values.ls = v;
  const r = ctx.start();
  const { m, resp } = await fillOne(r, 'ls');
  assert.ok(resp, 'no response');
  if (resp.result.isError) {
    assert.ok(textOf(resp).startsWith('The relay could not fill ls: '), textOf(resp));
    assert.ok(!r.gotId(m.id));
  } else {
    const e = call('browser_snapshot', { text: `x ${v} y ${v.toWellFormed()} z` }); r.send(e);
    const t1 = textOf(await r.resp(e.id));
    assert.ok(!t1.includes(v) && !t1.includes(v.toWellFormed()), JSON.stringify(t1));
  }
});

test('§2/§6 stderr: pre-fill passthrough; post-fill split chunks scrubbed; flush on silence and on exit', T, async t => {
  const ctx = await makeCtx(t);
  const v = sec('err'); ctx.daemon.values.se = v;
  const r = ctx.start();
  const pre = call('browser_snapshot', { _fake: 'quiet', raw: 'pre-fill stderr text\n' }); r.send(pre); await r.resp(pre.id);
  await until(() => r.err.includes('pre-fill stderr text\n'), 1500);
  assert.ok(r.err.includes('pre-fill stderr text\n'));
  await fillOne(r, 'se', { extra: { _fake: 'stderr', split: 6 } });
  await until(() => r.err.includes(' done'), 3000);
  assert.ok(!r.err.includes(v), 'value leaked to stderr across chunks');
  assert.ok(r.err.includes('{{vault:se}}'), r.err);
  const q = call('browser_snapshot', { _fake: 'quiet', raw: 'quiet-XYZW' }); r.send(q); await r.resp(q.id);
  assert.ok(await until(() => r.err.includes('quiet-XYZW'), 2000), 'held stderr not flushed after silence');
  const x = call('browser_snapshot', { _fake: 'errexit', raw: 'bye-QRST' }); r.send(x);
  const ex = await r.waitExit(4000);
  assert.ok(ex, 'relay did not exit with child'); assert.equal(ex.code, 0);
  assert.ok(r.err.includes('bye-QRST'), 'stderr carry not flushed on exit');
});

// ================================ §5 concurrency ================================
test('§5 fills run serially in input order; nonfill calls overtake; a failed fill frees the queue', T, async t => {
  const ctx = await makeCtx(t);
  Object.assign(ctx.daemon.values, { s1: sec('s1'), s2: sec('s2'), s3: sec('s3') });
  ctx.daemon.handler = async (q, res, d) => {
    if (q.body.refs[0] === 's1') await sleep(500);
    if (q.body.refs[0] === 's3') return json(res, 500, { error: 'boom' });
    json(res, 200, { ok: true, values: pick(d.values, q.body.refs) }); q.doneAt = Date.now();
  };
  const r = ctx.start(); await r.ready();
  const a = call('browser_type', { text: '{{vault:s1}}' }), n = call('browser_snapshot', {}), b = call('browser_type', { text: '{{vault:s2}}' });
  r.send(a); r.send(n); r.send(b);
  await r.resp(b.id);
  assert.equal(ctx.daemon.reqs.length, 2);
  assert.deepEqual(ctx.daemon.reqs.map(q => q.body.refs[0]), ['s1', 's2']);
  assert.ok(ctx.daemon.reqs[1].at >= ctx.daemon.reqs[0].doneAt, 'second release started before first finished');
  const ids = r.gotMsgs().map(x => x.id);
  assert.ok(ids.indexOf(n.id) < ids.indexOf(a.id), 'nonfill call waited for the fill');
  assert.ok(ids.indexOf(a.id) < ids.indexOf(b.id), 'fills typed out of order');
  const c = call('browser_type', { text: '{{vault:s3}}' }), d = call('browser_type', { text: '{{vault:s1}}' });
  r.send(c); r.send(d);
  assert.deepEqual(await r.resp(c.id), LE(c.id, 'boom'));
  await r.resp(d.id); assert.ok(r.gotId(d.id), 'queue blocked by a failed fill');
});

// ================================ §2/§4 lifecycle ================================
test('§4 stop: stdin EOF waits for a queued fill, then ends child stdin; relay exits 0', T, async t => {
  const ctx = await makeCtx(t);
  ctx.daemon.values.eo = sec('eof');
  const base = ctx.daemon.handler; ctx.daemon.handler = async (q, res, d) => { await sleep(400); base(q, res, d); };
  const r = ctx.start(); await r.ready();
  const m = call('browser_type', { text: '{{vault:eo}}', _fake: 'silent' }); r.send(m);
  r.p.stdin.end();
  const ex = await r.waitExit(5000);
  assert.ok(ex, 'relay did not exit after EOF'); assert.equal(ex.code, 0);
  const recs = r.recs(); const li = recs.findIndex(x => x.kind === 'line'), ei = recs.findIndex(x => x.kind === 'eof');
  assert.ok(li >= 0 && ei > li, 'child stdin ended before the queued fill was typed');
});

test('§2 lifecycle: child exit code propagates; child killed by a signal gives 1', T, async t => {
  const ctx = await makeCtx(t);
  const r = ctx.start(); await r.ready();
  r.send(call('browser_snapshot', { _fake: 'exit', code: 7 }));
  assert.equal((await r.waitExit(4000))?.code, 7);
  const r2 = ctx.start(); await r2.ready();
  r2.send(call('browser_snapshot', { _fake: 'selfkill' }));
  assert.equal((await r2.waitExit(4000))?.code, 1);
});

// Bug review DIV-2 (NOT-A-FAULT) asked that no descendant of the server outlive a stop; the real browser tool's tree
// exits on TERM, INT and HUP by itself. What the relay guarantees is pinned here and in the next test.
test('§2/§4 signals: TERM, INT and HUP are forwarded to the child', T, async t => {
  const ctx = await makeCtx(t);
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    const r = ctx.start(); const s = await r.ready();
    process.kill(r.p.pid, sig);
    const ex = await r.waitExit(4000);
    assert.ok(ex, `relay did not exit after ${sig}`);
    assert.ok(r.recs().some(x => x.kind === 'signal' && x.sig === sig), `${sig} not forwarded`);
    assert.ok(!alive(s.pid), 'child survived');
  }
});

test('§4 signal: a child ignoring TERM is KILLed within the 5 s grace and the relay exits', T, async t => {
  const ctx = await makeCtx(t);
  const r = ctx.start({ mode: 'stubborn' }); const s = await r.ready();
  const t0 = Date.now();
  process.kill(r.p.pid, 'SIGTERM');
  const gone = await until(() => !alive(s.pid), 8000, 50);
  assert.ok(gone, 'stubborn child still alive 8 s after SIGTERM');
  assert.ok(Date.now() - t0 >= 4500, 'KILL came before the grace period');
  const ex = await r.waitExit(3000);
  assert.ok(ex, 'relay did not exit'); assert.equal(ex.code, 1);
});

test('§4 child output step 5: closing the agent stdout read end never leaks; child does not outlive; restart is pre-fill', T, async t => {
  const ctx = await makeCtx(t); const v = sec('out'); ctx.daemon.values.co = v;
  const r = ctx.start(); const s = await r.ready();
  await fillOne(r, 'co');
  r.p.stdout.destroy();
  r.send(call('browser_snapshot', { text: `leak? ${v}` }));
  await sleep(800);
  r.p.stdin.end();
  await r.waitExit(3000);
  assert.ok(!r.err.includes(v), 'value in relay diagnostics');
  if (r.exit) assert.ok(await until(() => !alive(s.pid), 3000), 'child outlived the relay');
  const r2 = ctx.start();
  const sh = call('browser_take_screenshot', {}); r2.send(sh); await r2.resp(sh.id);
  assert.ok(r2.gotId(sh.id), 'fresh relay is not pre-fill');
});

// ================================ §3 restart ================================
test('§3 restart: filled, scrub table and pending map reset; temp files byte-identical', T, async t => {
  const ctx = await makeCtx(t, { handler: (q, res, d) => (q.body.refs && q.body.refs[0] === 'pp'
    ? json(res, 202, { pending: true, request: 'req-keep' }) : json(res, 200, { ok: true, values: pick(d.values, q.body.refs) })) });
  fs.writeFileSync(ctx.urlFile, ctx.daemon.url);
  const tok = snapshot(ctx.tokenFile), url = snapshot(ctx.urlFile);
  const v = sec('rs'); ctx.daemon.values.rs = v;
  const r1 = ctx.start(); await fillOne(r1, 'rs'); await fillOne(r1, 'pp');
  r1.p.stdin.end(); assert.ok(await r1.waitExit(4000), 'relay 1 did not stop');
  assert.ok(unchanged(ctx.tokenFile, tok) && unchanged(ctx.urlFile, url), 'relay changed temp files');
  const r2 = ctx.start();
  const sh = call('browser_take_screenshot', {}); r2.send(sh); await r2.resp(sh.id);
  assert.ok(r2.gotId(sh.id), 'filled survived restart');
  const e = call('browser_snapshot', { text: `pre ${v}` }); r2.send(e);
  assert.ok(textOf(await r2.resp(e.id)).includes(v), 'scrub table survived restart (pre-fill output must pass unchanged)');
  const n0 = ctx.daemon.reqs.length; await fillOne(r2, 'pp');
  assert.deepEqual(ctx.daemon.reqs[n0].body.refs, ['pp'], 'pending id survived restart');
  assert.ok(unchanged(ctx.tokenFile, tok) && unchanged(ctx.urlFile, url));
});

// ================================ §7 divergences ================================
// Bug review DIV-1 (REAL, fixed in 1.124.4): these calls used to reach the server while the fill waited for its release.
test('§5 picture and filename calls sent while a fill waits are held, then refused if it fills or forwarded if it fails', T, async t => {
  let open, gate; const shut = () => { gate = new Promise(r => { open = r; }); }; shut();
  const ctx = await makeCtx(t, { handler: async (q, res, d) => { await gate; q.body.refs[0] === 'd1' ? json(res, 200, { ok: true, values: pick(d.values, q.body.refs) }) : json(res, 403, { error: 'Not allowed here.' }); } });
  ctx.daemon.values.d1 = sec('d1');
  const r = ctx.start(); await r.ready();
  const f = call('browser_type', { text: '{{vault:d1}}' }); r.send(f);
  await until(() => ctx.daemon.reqs.length === 1, 3000);
  const shot = call('browser_take_screenshot', {}), file = call('browser_snapshot', { filename: 'page.md' });
  r.send(shot); r.send(file);
  await sleep(300); open();
  await r.resp(f.id); await sleep(300);
  assert.ok(!r.gotId(shot.id), 'screenshot reached the child across an in-flight fill');
  assert.ok(!r.gotId(file.id), 'filename call reached the child across an in-flight fill');
  assert.deepEqual(r.msgs().find(x => x.id === shot.id), LE(shot.id, PIC('browser_take_screenshot')));
  assert.deepEqual(r.msgs().find(x => x.id === file.id), LE(file.id, FNAME('browser_snapshot')));
  // A fill that fails types nothing, so the held calls then go through.
  shut(); const r2 = ctx.start(); await r2.ready();
  const f2 = call('browser_type', { text: '{{vault:nope}}' }); r2.send(f2);
  await until(() => ctx.daemon.reqs.length === 2, 3000);
  const shot2 = call('browser_take_screenshot', {}); r2.send(shot2);
  await sleep(200); assert.ok(!r2.gotId(shot2.id), 'screenshot went ahead of the fill it should wait for'); open();
  assert.deepEqual(await r2.resp(f2.id), LE(f2.id, 'Not allowed here.'));
  assert.ok(await r2.resp(shot2.id), 'held screenshot not answered'); assert.ok(r2.gotId(shot2.id), 'held screenshot refused after a failed fill');
});

// Bug review DIV-3 (NOT-A-FAULT): the real browser tool exits on end of input, and one that does not would linger as long
// unwrapped. What the relay does guarantee: it passes the end of input on, and leaves when its server does, not before.
test('§4 stop: closing the agent input closes the server input, and the relay exits when the server does', T, async t => {
  const ctx = await makeCtx(t);
  const r = ctx.start({ mode: 'ignoreEof' }); const s = await r.ready();
  r.p.stdin.end();
  assert.ok(await until(() => r.recs().some(x => x.kind === 'eof'), 3000), 'server input not closed');
  await sleep(500); assert.equal(r.exit, null, 'relay left while its server was still running');
  process.kill(s.pid, 'SIGTERM');
  const ex = await r.waitExit(3000);
  assert.ok(ex, 'relay did not exit when its server did'); assert.equal(ex.code, 0);
});

// Bug review DIV-4 (TEST-BUG): the blind test made the write throw at once, which Node never does for a child's pipe.
// This is the real condition: a server that closes its input and keeps running, so the write fails later with EPIPE.
test('§4 a server that closes its input: the fill being written gets a tool error, the server is stopped, the relay exits non-zero', T, async t => {
  const ctx = await makeCtx(t);
  const v = sec('d4'); ctx.daemon.values.d4 = v;
  const r = ctx.start({ mode: 'closeStdin' }); const s = await r.ready();
  assert.ok(await until(() => r.recs().some(x => x.kind === 'closed'), 3000), 'server did not close its input');
  const f = call('browser_type', { text: '{{vault:d4}}' }); r.send(f);
  const resp = await r.resp(f.id, 5000);
  assert.equal(ctx.daemon.reqs.length, 1, 'release did not happen');
  assert.equal(resp?.result?.isError, true, 'the fill being written got no answer');
  const ex = await r.waitExit(8000);
  assert.ok(ex, 'relay still running after its server closed its input'); assert.notEqual(ex.code, 0, 'relay exited 0');
  assert.ok(await until(() => !alive(s.pid), 2000), 'server outlived the relay');
  assert.ok(!r.err.includes(v) && !r.out.includes(v), 'value in the relay output');
});
