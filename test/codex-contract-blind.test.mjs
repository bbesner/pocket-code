// A contract for codex.mjs written from a behaviour spec without sight of the source: the blind bug review of
// 2026-11-23, at Pocket Code 1.124.3. The faults it found were fixed in 1.124.4; the tests that pinned them stay here.
// Every process is a synthetic stand-in app-server generated below in temp dirs; no real codex, no network.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpDir, patch, failFsFor, snapshot, unchanged, track, alive, until } from './bugreview-faults.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOD = pathToFileURL(path.join(REPO, 'codex.mjs')).href;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- stand-in app-server
const FAKE_SRC = '#!' + process.execPath + '\n' + String.raw`'use strict';
const fs = require('fs'), path = require('path');
const D = process.env.FAKE_DIR;
const ctl = () => { try { return JSON.parse(fs.readFileSync(path.join(D, 'ctl.json'), 'utf8')); } catch { return {}; } };
let outFile = false; try { outFile = fs.fstatSync(1).isFile(); } catch {}
fs.appendFileSync(path.join(D, 'pids.log'), JSON.stringify({ pid: process.pid, ppid: process.ppid, argv: process.argv.slice(2), outFile, t: Date.now() }) + '\n');
const c0 = ctl();
if (c0.ignoreTerm) process.on('SIGTERM', () => {});
if (c0.stderr) { try { fs.writeSync(2, c0.stderr); } catch {} }
const recv = path.join(D, 'recv-' + process.pid + '.ndjson');
let T = null, TURN = null, turns = 0;
const out = s => { try { fs.writeSync(1, s); } catch {} };
const send = o => out(JSON.stringify(Object.assign({ jsonrpc: '2.0' }, o)) + '\n');
const sub = v => JSON.parse(JSON.stringify(v).split('$TURN').join(TURN || '').split('$T').join(T || ''));
function runScript(list) { let at = 0; for (const st of list || []) { at += st.delay || 0; setTimeout(() => { if (st.raw !== undefined) out(st.raw); else if (st.exit !== undefined) process.exit(st.exit); else send(sub(st.frame)); }, at); } }
const rid = () => '019ac' + Math.floor(Math.random() * 0xfff).toString(16).padStart(3, '0') + '-0000-7000-8000-' + String(process.pid).padStart(12, '0');
function defaults(m, c) { const p = m.params || {}; switch (m.method) {
  case 'initialize': return { userAgent: 'fake-app-server/0.0.0' };
  case 'thread/start': T = c.threadId || rid(); return { thread: { id: T, preview: '', cwd: p.cwd }, model: 'gpt-fake' };
  case 'thread/resume': if (c.lock) { const lf = path.join(D, 'lock-' + p.threadId); let holder = 0; try { fs.writeFileSync(lf, String(process.pid), { flag: 'wx' }); } catch { holder = Number(fs.readFileSync(lf, 'utf8')); } if (holder && holder !== process.pid) { let live = true; try { process.kill(holder, 0); } catch { live = false; } if (live) return { __error: { code: -32000, message: 'thread ' + p.threadId + ' has an active writer' } }; fs.writeFileSync(lf, String(process.pid)); } } T = p.threadId; return { thread: { id: T, preview: '' }, model: 'gpt-fake' };
  case 'thread/fork': T = c.forkId || rid(); return { thread: { id: T, preview: '' }, model: 'gpt-fake' };
  case 'turn/start': case 'thread/compact/start': case 'review/start': turns += 1; TURN = c.turnId || ('turn-' + turns); return { turn: { id: TURN, status: 'inProgress', items: [], error: null } };
  case 'turn/steer': return { turnId: TURN };
  case 'account/rateLimits/read': return { rateLimits: c.rateLimits || null };
  case 'model/list': return { data: [{ id: 'gpt-fake', model: 'gpt-fake', displayName: 'Fake', description: '', isDefault: true, supportedReasoningEfforts: [], defaultReasoningEffort: 'medium' }], nextCursor: null };
  default: return {};
} }
function handle(m) { const c = ctl(); const r = (c.methods || {})[m.method] || {};
  if (r.hang) return;
  if (r.die !== undefined) process.exit(r.die);
  const go = () => { const d = defaults(m, c); const err = r.error || (d && d.__error); const msg = err ? { id: m.id, error: err } : r.error ? { id: m.id, error: r.error } : { id: m.id, result: r.result !== undefined ? sub(r.result) : d }; send(msg); if (!err) runScript((c.on || {})[m.method]); };
  if (r.delayMs) setTimeout(go, r.delayMs); else go();
}
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.trim()) continue; let m; try { m = JSON.parse(l); } catch { continue; } fs.appendFileSync(recv, JSON.stringify(m) + '\n'); if (m.method && m.id !== undefined && m.id !== null) handle(m); } });
process.stdin.on('end', () => { if (!c0.ignoreTerm) process.exit(0); });
setInterval(() => {}, 1 << 30);
`;
const BIN = tmpDir('codex-bin-');
const FAKE = path.join(BIN, 'codex');
fs.writeFileSync(FAKE, FAKE_SRC, { mode: 0o755 });
const FAILBIN = tmpDir('codex-failbin-');
fs.writeFileSync(path.join(FAILBIN, 'mkfifo'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });

// ---------------------------------------------------------------- worlds (data/pipe/codex-home/fake dirs)
const worlds = [];
function newWorld() {
  const root = tmpDir('codex-');
  const w = { root, data: path.join(root, 'data'), pipes: path.join(root, 'pipes'), chome: path.join(root, 'chome'), fake: path.join(root, 'fake'), cwd: path.join(root, 'cwd') };
  for (const d of [w.data, w.chome, w.fake, w.cwd]) fs.mkdirSync(d, { recursive: true });
  worlds.push(w); return w;
}
const setCtl = (w, o) => fs.writeFileSync(path.join(w.fake, 'ctl.json'), JSON.stringify(o));
function readJsonl(f) { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } }
const fakes = w => readJsonl(path.join(w.fake, 'pids.log'));
function frames(w) { const out = []; let names = []; try { names = fs.readdirSync(w.fake); } catch {} for (const n of names) { const m = /^recv-(\d+)\.ndjson$/.exec(n); if (m) for (const f of readJsonl(path.join(w.fake, n))) out.push({ ...f, _pid: Number(m[1]) }); } return out; }
const responsesTo = (w, id) => frames(w).filter(f => f.id === id && !f.method);
const logDir = w => path.join(w.data, 'turnlogs-codex');
function markers(w) { let names = []; try { names = fs.readdirSync(logDir(w)); } catch {} return names.filter(n => n.endsWith('.session.json')).map(n => { const f = path.join(logDir(w), n); try { return { file: f, m: JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch { return { file: f, m: null }; } }); }
const markerFor = (w, T) => markers(w).find(x => x.m && x.m.threadId === T);
function pidForThread(w, T) { const f = frames(w).find(x => x.method && x.params && x.params.threadId === T && /^(thread\/resume|turn\/start)$/.test(x.method)); if (f) return f._pid; const st = frames(w).find(x => x.method === 'thread/start'); return st ? st._pid : null; }
const sessionFakesSince = (w, t0) => fakes(w).filter(f => f.outFile && f.t >= t0);
function walk(dir) { const out = []; let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; } for (const e of ents) { const p = path.join(dir, e.name); out.push(p); if (e.isDirectory()) out.push(...walk(p)); } return out; }
function keepersFor(pidSet) { const out = []; for (const d of fs.readdirSync('/proc')) { if (!/^\d+$/.test(d)) continue; let cl; try { cl = fs.readFileSync('/proc/' + d + '/cmdline', 'utf8').split('\0'); } catch { continue; } const i = cl.indexOf('pocket-keeper'); if (i >= 0 && pidSet.has(Number(cl[i + 1]))) out.push(Number(d)); } return out; }
function reap(w) { const set = new Set(fakes(w).map(f => f.pid)); for (const p of [...set, ...keepersFor(set)]) { track(p); try { process.kill(-p, 'SIGKILL'); } catch {} try { process.kill(p, 'SIGKILL'); } catch {} } }
const sizeOf = x => !x ? 0 : (x instanceof Map || x instanceof Set) ? x.size : Array.isArray(x) ? x.length : typeof x === 'object' ? Object.keys(x).length : 0;
const cards = x => (x && x.pending instanceof Map ? x.pending.size : sizeOf(x));
const isAllow = r => Boolean(r && r.result && /accept|approv|allow/i.test(String(r.result.decision)));
let uidN = 0;
const uid = () => '019ab' + (Date.now() % 4096).toString(16).padStart(3, '0') + '-0000-7000-8000-' + String(++uidN).padStart(12, '0');

// ---------------------------------------------------------------- scripted native traffic
const STARTED = { delay: 30, frame: { method: 'turn/started', params: { threadId: '$T', turn: { id: '$TURN', status: 'inProgress', items: [] } } } };
const usageFrame = (input, cached, win) => ({ delay: 20, frame: { method: 'thread/tokenUsage/updated', params: { threadId: '$T', turnId: '$TURN', tokenUsage: { total: { totalTokens: input + 100, inputTokens: input, cachedInputTokens: cached, outputTokens: 100, reasoningOutputTokens: 0 }, last: { totalTokens: input + 100, inputTokens: input, cachedInputTokens: cached, outputTokens: 100, reasoningOutputTokens: 0 }, modelContextWindow: win } } } });
const COMPLETED = (status = 'completed') => ({ delay: 30, frame: { method: 'turn/completed', params: { threadId: '$T', turn: { id: '$TURN', status, items: [], error: null } } } });
const COMPLETE = (input = 1000, cached = 400, win = 10000) => [STARTED, { delay: 20, frame: { method: 'item/agentMessage/delta', params: { threadId: '$T', turnId: '$TURN', itemId: 'm1', delta: 'Hi \u{1F30D}' } } }, usageFrame(input, cached, win), COMPLETED()];
const ON_INTERRUPT_COMPLETE = [COMPLETED('interrupted')];

// ---------------------------------------------------------------- main-process module instance
const W0 = newWorld();
Object.assign(process.env, { POCKET_DATA_DIR: W0.data, POCKET_PIPE_DIR: W0.pipes, CODEX_HOME: W0.chome, CODEX_BIN: FAKE, FAKE_DIR: W0.fake, POCKET_IDLE_CLOSE_MS: '0', PATH: BIN + ':' + process.env.PATH });
const LOGS = [];
for (const k of ['log', 'info', 'warn', 'error', 'debug']) { const o = console[k]; console[k] = (...a) => { LOGS.push(a.map(x => (x instanceof Error ? x.stack : typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })())).join(' ')); if (process.env.BR_DEBUG) o.apply(console, a); }; }
const C = await import(MOD);
const TOKENS = new Set();

function hooks() {
  const h = { events: [], finished: 0, questions: [], approvals: [], audits: [], autonomous: [], forked: [], auditFails: false };
  h.emit = (...a) => { h.events.push(a[0]); };
  h.onFinish = () => { h.finished++; };
  h.onQuestion = (...a) => { h.questions.push(a); };
  h.onApproval = (...a) => { h.approvals.push(a); };
  h.auditApproval = (...a) => { h.audits.push(a); if (h.auditFails) throw Object.assign(new Error('audit store unavailable'), { code: 'EIO' }); return true; };
  h.onAutonomous = (...a) => { h.autonomous.push(a); };
  h.onForked = id => { h.forked.push(id); };
  return h;
}
const start = (h, opts = {}) => C.startCodexTurn({ cwd: W0.cwd, text: 'hello', model: 'gpt-fake', effort: 'medium', emit: h.emit, onFinish: h.onFinish, onQuestion: h.onQuestion, onApproval: h.onApproval, auditApproval: h.auditApproval, onAutonomous: h.onAutonomous, onForked: h.onForked, ...opts });
const resultOf = (t, h) => [...((t && t.events) || []), ...((h && h.events) || [])].find(e => e && e.type === 'result');
async function closeQuiet(T) { const s = C.codexSessions.get(T); if (s) { try { await C.closeCodexSession(s, 'test'); } catch {} } }
function noteToken(w, T) { const x = markerFor(w, T); if (x && x.m && x.m.runnerToken) TOKENS.add(x.m.runnerToken); }

// ================================================================ 1. pure contracts
test('LineBuffer: newline framing, partials held in parts, empty lines kept', () => {
  const b = new C.LineBuffer();
  assert.deepEqual(b.push('ab\ncd'), ['ab']);
  assert.deepEqual(b.push('ef\n'), ['cdef']);
  assert.deepEqual(b.push('\n\nx'), ['', '']);
  assert.ok(b.parts !== undefined, 'LineBuffer holds partial text in parts');
  assert.equal([].concat(b.parts).join(''), 'x');
});

test('isCodexLimit: exact strings, own or inherited keys, else false', () => {
  assert.equal(C.isCodexLimit('usageLimitExceeded'), true);
  assert.equal(C.isCodexLimit('rateLimitExceeded'), true);
  assert.equal(C.isCodexLimit({ usageLimitExceeded: {} }), true);
  assert.equal(C.isCodexLimit(Object.create({ rateLimitExceeded: null })), true);
  for (const v of ['UsageLimitExceeded', 'usageLimitExceeded ', 'other', null, undefined, 0, {}, { other: 1 }, ['usageLimitExceeded']]) assert.equal(C.isCodexLimit(v), false, 'not a limit: ' + JSON.stringify(v));
});

test('setCodexBinary/codexAvailable: availability is the Boolean of the binary', () => {
  C.setCodexBinary('');
  assert.equal(C.codexAvailable(), false);
  C.setCodexBinary(FAKE);
  assert.equal(C.codexAvailable(), true);
});

test('unknown thread ids: no turn, no session, stop/steer false, null close resolves, empty context', async () => {
  const T = uid();
  assert.equal(C.codexTurnActive(T), false);
  assert.equal(C.sessionForRunnerToken('0'.repeat(32)), null);
  assert.equal(C.sessionForRunnerToken(''), null);
  assert.equal(C.sessionForRunnerToken(undefined), null);
  assert.equal(C.stopCodexTurn(T), false);
  assert.equal(await C.steerCodexTurn(T, 'x'), false);
  await C.closeCodexSession(null, 'test');
  assert.deepEqual(await C.codexContextAndCache(T), { context: null, cache: null });
});

test('sameBoot: bootId equality decides; without bootId the marker mtime must postdate boot', () => {
  const boot = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  const d = tmpDir('codex-sb-'); const f = path.join(d, 'x.session.json'); fs.writeFileSync(f, '{}');
  assert.equal(Boolean(C.sameBoot({ bootId: boot }, f)), true);
  assert.equal(Boolean(C.sameBoot({ bootId: '00000000-0000-0000-0000-000000000000' }, f)), false);
  assert.equal(Boolean(C.sameBoot({}, f)), true, 'fresh marker without bootId is from this boot');
  fs.utimesSync(f, new Date(1000), new Date(1000));
  assert.equal(Boolean(C.sameBoot({}, f)), false, 'marker older than boot is not this boot');
  assert.equal(Boolean(C.sameBoot({}, path.join(d, 'missing.json'))), false, 'stat failure => false');
});

// ================================================================ 2. AppServer
test('AppServer: init/request/notify/error/timeout/close contract', async () => {
  setCtl(W0, { methods: { 'echo/x': { result: { v: 1 } }, 'err/x': { error: { code: 1, message: 'nope' } }, 'err/nomsg': { error: { code: 2 } }, 'slow/x': { delayMs: 400, result: { late: true } } } });
  const before = Date.now();
  const srv = new C.AppServer({ name: 'bt1', onNotify: () => {} });
  try {
    const r = await srv.init();
    assert.equal(r.userAgent, 'fake-app-server/0.0.0', 'init returns the initialize result');
    const init = frames(W0).find(f => f.method === 'initialize' && f.id >= before);
    assert.ok(init, 'initialize frame written');
    assert.equal(init.jsonrpc, '2.0');
    assert.deepEqual(init.params.clientInfo, { name: 'pocket', title: 'Pocket', version: '1.0' });
    assert.equal(init.params.capabilities.experimentalApi, true);
    assert.ok(Number.isInteger(init.id) && init.id >= before && init.id <= Date.now(), 'request ids start at Date.now()');
    await until(() => frames(W0).some(f => f._pid === init._pid && f.method === 'initialized'), 2000);
    assert.ok(frames(W0).some(f => f._pid === init._pid && f.method === 'initialized' && f.id === undefined), 'initialized notification sent');
    assert.equal(srv.writable(), true);
    assert.equal(srv.notify('ping/x', { a: 1 }), undefined);
    assert.deepEqual(await srv.request('echo/x', {}), { v: 1 });
    const echo = frames(W0).find(f => f._pid === init._pid && f.method === 'echo/x');
    assert.equal(echo.id, init.id + 1, 'ids increment');
    await until(() => frames(W0).some(f => f._pid === init._pid && f.method === 'ping/x'), 2000);
    assert.deepEqual(frames(W0).find(f => f._pid === init._pid && f.method === 'ping/x').params, { a: 1 });
    await assert.rejects(srv.request('err/x'), e => e.message === 'nope' && e.rpc && e.rpc.code === 1);
    await assert.rejects(srv.request('err/nomsg'), e => e.message === 'rpc error' && e.rpc && e.rpc.code === 2);
    await assert.rejects(srv.request('slow/x', {}, 100), e => e.message === 'slow/x timed out');
    await sleep(600);
    assert.deepEqual(await srv.request('echo/x'), { v: 1 }, 'late response ignored, server still usable');
    const pending = srv.request('slow/x', {}, 5000);
    await sleep(50);
    assert.equal(srv.close(), undefined, 'close returns undefined');
    await assert.rejects(pending, e => e.message === 'app-server closed');
    assert.equal(srv.writable(), false);
    await assert.rejects(srv.request('echo/x'), e => e.message === 'app-server closed');
    assert.ok(await until(() => !alive(init._pid), 3000), 'spawned child killed by close');
  } finally { try { srv.close(); } catch {} }
});

test('AppServer: unclaimed native requests are answered fail-closed; claimed ones are left alone; junk frames ignored', async () => {
  const reqs = [
    [9001, 'item/tool/requestUserInput', { answers: {} }],
    [9002, 'item/commandExecution/requestApproval', { decision: 'decline' }],
    [9003, 'item/fileChange/requestApproval', { decision: 'decline' }],
    [9004, 'mcpServer/elicitation/request', { action: 'cancel', content: null }],
    [9005, 'vendor/doThingApproval', { decision: 'denied' }],
    [9006, 'something/else', {}],
  ];
  const script = [{ delay: 10, raw: '\n' }, { delay: 5, raw: 'not json\n' }, { delay: 5, raw: '[1,2]\n' }, { delay: 5, raw: '42\n' }, { delay: 5, frame: { id: 123456, result: { orphan: true } } }, { delay: 5, frame: { method: 'note/x', params: { boom: true } } }]
    .concat(reqs.map(([id, method]) => ({ delay: 5, frame: { id, method, params: { threadId: 't', turnId: 'u' } } })))
    .concat([{ delay: 5, frame: { id: 9007, method: 'claimed/thing', params: {} } }]);
  setCtl(W0, { on: { 'trigger/x': script } });
  const claimed = [];
  const srv = new C.AppServer({ name: 'bt2', onNotify: () => { throw new Error('notify callback blew up'); }, onRequest: f => { if (f.method === 'claimed/thing') { claimed.push(f); return true; } return false; } });
  try {
    await srv.init();
    await srv.request('trigger/x');
    await until(() => reqs.every(([id]) => responsesTo(W0, id).length > 0), 3000);
    for (const [id, method, want] of reqs) {
      const rs = responsesTo(W0, id);
      assert.equal(rs.length, 1, 'exactly one answer for ' + method);
      assert.deepEqual(rs[0].result, want, 'fail-closed answer for ' + method);
    }
    assert.equal(claimed.length, 1, 'onRequest saw the claimed request');
    await sleep(200);
    assert.equal(responsesTo(W0, 9007).length, 0, 'claimed request not answered by AppServer');
    assert.deepEqual(await srv.request('echo/none'), {}, 'still serving after junk frames and a throwing notify callback');
  } finally { srv.close(); }
});

test('AppServer: native permissions request is answered {permissions:{},scope:"turn"} when unclaimed', async () => {
  setCtl(W0, { on: { 'trigger/p': [{ delay: 10, frame: { id: 9101, method: 'item/permissions/requestApproval', params: { threadId: 't', turnId: 'u' } } }] } });
  const srv = new C.AppServer({ name: 'bt3' });
  try {
    await srv.init(); await srv.request('trigger/p');
    await until(() => responsesTo(W0, 9101).length > 0, 2000);
    assert.deepEqual((responsesTo(W0, 9101)[0] || {}).result, { permissions: {}, scope: 'turn' });
  } finally { srv.close(); }
});

test('AppServer: spawn error rejects pending with "app-server unavailable: ..." and calls onExit(-1) once', async () => {
  C.setCodexBinary(path.join(BIN, 'no-such-codex'));
  const exits = [];
  let srv;
  try {
    srv = new C.AppServer({ name: 'bt4', onExit: c => exits.push(c) });
    if (!srv.onExit) srv.onExit = c => exits.push(c);
    await assert.rejects(srv.request('x/y', {}, 3000), e => /^app-server unavailable: /.test(e.message));
    await until(() => exits.length > 0, 2000);
    await sleep(200);
    assert.deepEqual(exits, [-1]);
  } finally { C.setCodexBinary(FAKE); try { srv && srv.close(); } catch {} }
});

test('AppServer: child exit rejects pending with "app-server exited"; stderr diagnostics capped at 300 chars', async () => {
  setCtl(W0, { stderr: 'E'.repeat(2000) + '\n', methods: { 'die/x': { die: 3 } } });
  const mark = LOGS.length;
  const srv = new C.AppServer({ name: 'bt5' });
  try {
    await srv.init();
    await sleep(200);
    await assert.rejects(srv.request('die/x', {}, 5000), e => e.message === 'app-server exited');
    assert.equal(srv.writable(), false);
    assert.ok(!LOGS.slice(mark).some(l => l.includes('E'.repeat(301))), 'stderr logged at most 300 characters');
  } finally { setCtl(W0, {}); try { srv.close(); } catch {} }
});

// ================================================================ 3. makeTransport / drain
function mkTransport({ content = '', skipBefore = 0, offset = 0 } = {}) {
  const dir = tmpDir('codex-tr-');
  const files = { out: path.join(dir, 'k1.out.ndjson'), err: path.join(dir, 'k1.err.log'), fifo: path.join(dir, 'k1.in.fifo'), meta: path.join(dir, 'k1.session.json'), legacyFifo: path.join(dir, 'k1.legacy.fifo') };
  fs.writeFileSync(files.out, content); fs.writeFileSync(files.err, ''); fs.writeFileSync(files.fifo, ''); fs.writeFileSync(files.meta, '{}');
  const mk = () => { const c = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' }); c.unref(); track(c.pid); return c.pid; };
  const pid = mk(), keeperPid = mk();
  const writer = { writable: true, writableEnded: false, destroyed: false, writes: [], ended: 0, write(s, cb) { this.writes.push(String(s)); if (typeof cb === 'function') cb(); return true; }, end() { this.ended++; this.writableEnded = true; this.writable = false; }, destroy() { this.destroyed = true; this.writable = false; }, on() { return this; }, once() { return this; }, off() { return this; }, removeListener() { return this; } };
  const tr = C.makeTransport({ pid, keeperPid, key: 'k1', files, writer, offset, skipBefore });
  const got = [], exits = [];
  tr.onData = l => got.push(l);
  tr.onExit = c => exits.push(c);
  return { tr, files, writer, got, exits, pid, keeperPid, append: b => fs.appendFileSync(files.out, b) };
}
const remText = r => (Buffer.isBuffer(r) ? r.toString('utf8') : r == null ? '' : String(r));

test('makeTransport.drain: forwards complete LF lines, keeps the fragment, advances by bytes', async () => {
  const x = mkTransport({ content: '{"a":1}\n{"b":2}\n{"c":' });
  try {
    x.tr.drain();
    assert.equal(x.got.join(''), '{"a":1}\n{"b":2}\n');
    assert.equal(remText(x.tr.rem), '{"c":');
    assert.ok([16, 21].includes(x.tr.offset), 'offset is a byte position (consumed lines or bytes read), got ' + x.tr.offset);
    x.append('3}\n');
    x.tr.drain();
    assert.equal(x.got.join(''), '{"a":1}\n{"b":2}\n{"c":3}\n');
  } finally { x.tr.exit(0); }
});

// Deliberate (the spec's first reading was wrong): an adopted turn is read from its own offset, so lines before skipBefore
// are replayed and a completion written while Pocket was down still finishes it. Only a native request in that range is
// held as stale, and declined once the read reaches skipBefore; one the log shows resolved is dropped from that list.
test('makeTransport.drain: lines before skipBefore are replayed; a request there is held and declined once', async () => {
  const l1 = '{"old":"é"}\n', req = '{"jsonrpc":"2.0","id":7,"method":"item/commandExecution/requestApproval","params":{}}\n';
  const asked = '{"jsonrpc":"2.0","id":8,"method":"item/tool/requestUserInput","params":{}}\n', resolved = '{"method":"serverRequest/resolved","params":{"requestId":8}}\n';
  const l2 = '{"new":1}\n', before = l1 + req + asked + resolved;
  const x = mkTransport({ content: before + l2, skipBefore: Buffer.byteLength(before) });
  try {
    x.tr.drain(); x.tr.drain();
    assert.equal(x.got.join(''), l1 + resolved + l2, 'replayed, the requests held back');
    assert.deepEqual(x.writer.writes.map(w => JSON.parse(w)), [{ jsonrpc: '2.0', id: 7, result: { decision: 'decline' } }], 'the unresolved one declined once');
  } finally { x.tr.exit(0); }
});

test('DIV-5: drain keeps a multibyte UTF-8 character split across reads intact (2-, 3-, 4-byte)', async () => {
  for (const ch of ['é', '€', '\u{1F30D}']) {
    const line = JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: ch } }) + '\n';
    const bytes = Buffer.from(line, 'utf8');
    const cut = bytes.indexOf(Buffer.from(ch, 'utf8')) + 1;
    const x = mkTransport();
    try {
      x.append(bytes.subarray(0, cut)); x.tr.drain();
      x.append(bytes.subarray(cut)); x.tr.drain();
      const joined = x.got.join('');
      assert.ok(!joined.includes('�'), 'U+FFFD in forwarded line for ' + JSON.stringify(ch) + ': ' + JSON.stringify(joined));
      assert.equal(joined, line);
    } finally { x.tr.exit(0); }
  }
});

test('makeTransport.drain: >1 MiB of multibyte lines arrives complete across capped reads', async () => {
  let content = ''; let i = 0;
  while (Buffer.byteLength(content) < 1.6 * 1048576) content += JSON.stringify({ i: i++, s: 'é€\u{1F30D}'.repeat(40) }) + '\n';
  const x = mkTransport({ content });
  try {
    for (let k = 0; k < 6; k++) x.tr.drain();
    const joined = x.got.join('');
    assert.ok(!joined.includes('�'), 'no replacement characters');
    assert.equal(joined.length, content.length);
    assert.equal(joined, content);
  } finally { x.tr.exit(0); }
});

test('makeTransport: a failing open/stat on the log is retried by the timer, nothing skipped, no crash', async () => {
  const x = mkTransport();
  try {
    const restoreOpen = failFsFor('openSync', x.files.out);
    const restoreStat = failFsFor('statSync', x.files.out);
    x.append('{"n":1}\n{"n":2}\n');
    await sleep(500);
    restoreOpen(); restoreStat();
    assert.ok(await until(() => x.got.join('') === '{"n":1}\n{"n":2}\n', 2000), 'lines delivered after the fault cleared: ' + JSON.stringify(x.got));
  } finally { x.tr.exit(0); }
});

test('makeTransport.exit: idempotent; drains, never forwards an incomplete tail, destroys writer, unlinks FIFO+marker, ends keeper', async () => {
  const x = mkTransport({ content: '{"done":1}\n{"partial":' });
  x.tr.exit(0); x.tr.exit(1);
  await sleep(100);
  assert.deepEqual(x.exits, [0], 'onExit called once with the first code');
  assert.equal(x.got.join(''), '{"done":1}\n', 'incomplete JSON tail not forwarded');
  assert.equal(x.writer.destroyed, true, 'writer destroyed');
  assert.equal(fs.existsSync(x.files.fifo), false, 'FIFO unlinked');
  assert.equal(fs.existsSync(x.files.meta), false, 'marker unlinked');
  assert.ok(await until(() => !alive(x.keeperPid), 2000), 'keeper group signalled');
  assert.ok(alive(x.pid), 'transport exit does not itself signal the primary');
});

test('makeTransport.close: SIGTERMs the keeper group and ends the writer', async () => {
  const x = mkTransport();
  try {
    x.tr.close();
    assert.equal(x.writer.ended, 1, 'writer.end called');
    assert.ok(await until(() => !alive(x.keeperPid), 2000), 'keeper group terminated');
  } finally { x.tr.exit(0); }
});

// ================================================================ 4. live owned sessions (stand-in app-server)
test('startCodexTurn: happy path — marker, modes, events order, usage accounting, runner token lookup', async () => {
  const T = uid(); setCtl(W0, { threadId: T, turnId: 'turn-A', on: { 'turn/start': COMPLETE(1000, 400, 10000) } });
  const h = hooks(); const t0 = Date.now();
  const t = await start(h);
  assert.equal(t.threadId, T); assert.equal(t.turnId, 'turn-A');
  assert.ok(await until(() => h.finished > 0, 6000), 'onFinish called');
  noteToken(W0, T);
  const ev = t.events || h.events;
  const types = ev.map(e => e.type);
  assert.equal(types[0], 'user'); assert.equal(ev[0].msg.text, 'hello'); assert.equal(ev[0].msg.role, 'user');
  assert.ok(ev.some(e => e.type === 'delta' && e.text === 'Hi \u{1F30D}'), 'delta forwarded unchanged');
  const ri = types.indexOf('result'), di = types.lastIndexOf('done');
  assert.ok(ri >= 0 && di > ri && di === types.length - 1, 'result then done last: ' + types.join(','));
  assert.equal(ev[ri].ok, true);
  assert.equal(C.codexTurnActive(T), false);
  assert.ok(C.codexSessions.has(T), 'idle session kept (idle close disabled)');
  const x = markerFor(W0, T); assert.ok(x, 'session marker present');
  const m = x.m;
  for (const k of ['threadId', 'cliBin', 'pid', 'keeperPid', 'key', 'bootId', 'pidStart', 'keeperStart', 'approvalMode', 'cwd', 'model', 'effort', 'runnerToken', 'turn', 'waitingForInput', 'waitingForApproval']) assert.ok(k in m, 'marker field ' + k);
  assert.equal(m.turn, null, 'idle marker has turn:null');
  assert.match(m.key, /^[a-z0-9]+$/); assert.match(m.runnerToken, /^[0-9a-f]{32}$/);
  assert.equal(m.approvalMode, 'review'); assert.equal(m.cwd, W0.cwd);
  assert.equal(fs.statSync(x.file).mode & 0o777, 0o600, 'marker 0600');
  assert.equal(fs.statSync(logDir(W0)).mode & 0o777, 0o700, 'log dir 0700');
  assert.equal(fs.statSync(path.join(logDir(W0), m.key + '.out.ndjson')).mode & 0o777, 0o600, 'out log 0600');
  assert.equal(fs.statSync(path.join(logDir(W0), m.key + '.err.log')).mode & 0o777, 0o600, 'err log 0600');
  const fifo = walk(W0.pipes).find(p => path.basename(p) === m.key + '.in.fifo');
  assert.ok(fifo, 'FIFO in pipe dir'); const fst = fs.statSync(fifo); assert.ok(fst.isFIFO()); assert.equal(fst.mode & 0o777, 0o600, 'FIFO 0600');
  assert.ok(alive(m.pid), 'primary alive');
  assert.equal(C.sessionForRunnerToken(m.runnerToken), C.codexSessions.get(T));
  assert.equal(C.sessionForRunnerToken(m.runnerToken.replace(/.$/, c => (c === '0' ? '1' : '0'))), null);
  const ts = frames(W0).find(f => f.method === 'turn/start' && f.params.threadId === T);
  assert.equal(ts.jsonrpc, '2.0');
  assert.ok(JSON.stringify(ts.params.input).includes('hello'));
  assert.ok(JSON.stringify(ts.params).includes('"default"') && !JSON.stringify(ts.params).includes('"plan"'), 'collaboration mode default');
  const usageFile = path.join(W0.data, 'codex-usage-state.json');
  await until(() => { try { return T in JSON.parse(fs.readFileSync(usageFile, 'utf8')).context; } catch { return false; } }, 3000);
  const u = JSON.parse(fs.readFileSync(usageFile, 'utf8'));
  assert.equal(fs.statSync(usageFile).mode & 0o777, 0o600, 'usage file 0600');
  const ctx = u.context[T]; assert.ok(ctx, 'context keyed by bare thread id');
  assert.equal(ctx.used, 1000, 'used is input tokens including cached'); assert.equal(ctx.cached, 400); assert.equal(ctx.window, 10000);
  assert.ok(ctx.lastAt >= t0 && ctx.lastAt <= Date.now(), 'lastAt epoch ms');
  const cc = await C.codexContextAndCache(T);
  assert.equal(cc.context.used, 1000); assert.equal(cc.context.window, 10000); assert.equal(cc.context.pct, 0.1);
});

test('startCodexTurn: busy 409, steer contract, steer error does not echo, stop returns synchronously', async () => {
  const T = uid(); setCtl(W0, { threadId: T, turnId: 'turn-B', on: { 'turn/start': [STARTED], 'turn/interrupt': ON_INTERRUPT_COMPLETE } });
  const h = hooks(); const t = await start(h);
  noteToken(W0, T);
  assert.equal(C.codexTurnActive(T), true);
  await assert.rejects(start(hooks(), { threadId: T, text: 'again' }), e => e.message === 'busy' && e.code === 409);
  assert.equal(await C.steerCodexTurn(T, 'more'), true);
  const st = frames(W0).find(f => f.method === 'turn/steer' && f.params.threadId === T);
  assert.deepEqual(st.params, { threadId: T, expectedTurnId: 'turn-B', input: [{ type: 'text', text: 'more' }] });
  assert.ok((t.events || h.events).some(e => e.type === 'user' && e.msg.text === 'more'), 'steer echoes a user event');
  setCtl(W0, { threadId: T, methods: { 'turn/steer': { error: { code: -32600, message: 'expected turn id mismatch' } } }, on: { 'turn/interrupt': ON_INTERRUPT_COMPLETE } });
  await assert.rejects(C.steerCodexTurn(T, 'more2'), e => e.message === 'expected turn id mismatch');
  assert.ok(!(t.events || h.events).some(e => e.type === 'user' && e.msg.text === 'more2'), 'rejected steer not echoed');
  const r = C.stopCodexTurn(T);
  assert.equal(r, true, 'stop returns true synchronously');
  assert.ok(t.stopped, 'turn marked stopped immediately');
  assert.ok(await until(() => frames(W0).some(f => f.method === 'turn/interrupt' && f.params.threadId === T), 3000), 'turn/interrupt sent');
  assert.ok(await until(() => h.finished > 0, 4000), 'finished after interrupt completion');
  assert.equal(resultOf(t, h).ok, false, 'stopped turn result ok:false');
  assert.equal(C.stopCodexTurn(T), false);
  assert.equal(await C.steerCodexTurn(T, 'late'), false);
});

test('native inbox: valid approval/question cards appear after audit; malformed/mismatched questions declined; stop clears cards synchronously; no Allow afterwards', async () => {
  const T = uid();
  const q = (id, over) => ({ delay: 15, frame: { id, method: 'item/tool/requestUserInput', params: { threadId: '$T', turnId: '$TURN', itemId: 'q' + id, questions: [{ id: 'q1', header: 'H', question: 'Pick one?', options: [{ label: 'A', description: 'a' }] }], ...over } } });
  setCtl(W0, { threadId: T, turnId: 'turn-C', on: { 'turn/start': [STARTED,
    { delay: 20, frame: { id: 7101, method: 'item/commandExecution/requestApproval', params: { threadId: '$T', turnId: '$TURN', itemId: 'c1', command: 'echo SECRET-CMD-77', cwd: '/tmp', reason: 'test' } } },
    q(7301, { questions: Array.from({ length: 11 }, (_, i) => ({ id: 'q' + i, header: 'H', question: 'Q?', options: [] })) }),
    q(7302, { turnId: 'some-other-turn' }),
    q(7303, {})] } });
  const h = hooks(); const t = await start(h);
  noteToken(W0, T);
  assert.ok(await until(() => cards(t.approvals) >= 1 && cards(t.questions) >= 1, 3000), 'precondition: approval and question cards appear (approvals=' + cards(t.approvals) + ', questions=' + cards(t.questions) + ')');
  assert.ok(h.audits.length >= 1, 'request audited before card');
  assert.ok(await until(() => responsesTo(W0, 7301).length && responsesTo(W0, 7302).length, 2000), 'malformed and mismatched questions answered');
  assert.deepEqual(responsesTo(W0, 7301)[0].result, { answers: {} });
  assert.deepEqual(responsesTo(W0, 7302)[0].result, { answers: {} });
  assert.equal(cards(t.questions), 1, 'only the valid question is a card');
  setCtl(W0, { threadId: T, on: { 'turn/interrupt': ON_INTERRUPT_COMPLETE } });
  assert.equal(C.stopCodexTurn(T), true);
  assert.equal(cards(t.approvals), 0, 'approval cards cleared synchronously by stop');
  assert.equal(cards(t.questions), 0, 'question cards cleared synchronously by stop');
  assert.ok(await until(() => h.finished > 0, 4000));
  await sleep(200);
  assert.ok(!responsesTo(W0, 7101).some(isAllow), 'stopped approval never answered with Allow');
  assert.ok(!LOGS.some(l => l.includes('SECRET-CMD-77')), 'approval details not printed in diagnostics');
});

test('native approval: failed request audit => no card and no Allow', async () => {
  const T = uid();
  setCtl(W0, { threadId: T, turnId: 'turn-D', on: { 'turn/start': [STARTED, { delay: 20, frame: { id: 7201, method: 'item/commandExecution/requestApproval', params: { threadId: '$T', turnId: '$TURN', itemId: 'c2', command: 'touch /tmp/x', cwd: '/tmp' } } }], 'turn/interrupt': ON_INTERRUPT_COMPLETE } });
  const h = hooks(); h.auditFails = true;
  const t = await start(h);
  noteToken(W0, T);
  await until(() => h.audits.length > 0, 2000);
  await sleep(400);
  assert.equal(cards(t.approvals), 0, 'no card without a committed audit');
  assert.ok(!responsesTo(W0, 7201).some(isAllow), 'no Allow written');
  C.stopCodexTurn(T); await until(() => h.finished > 0, 3000);
});

test('startCodexTurn: active-writer lock remaps to 423 with the exact message', async () => {
  setCtl(W0, { methods: { 'thread/resume': { error: { code: -32000, message: 'thread is held by an active writer elsewhere' } } } });
  await assert.rejects(start(hooks(), { threadId: uid() }), e => e.code === 423 && e.message === 'This thread is open in another surface (code-server or a terminal). Close it there to send from Pocket.');
});

test('startCodexTurn: thread/start without id throws "thread/start returned no id"', async () => {
  setCtl(W0, { methods: { 'thread/start': { result: { thread: {} } } } });
  await assert.rejects(start(hooks()), e => e.message === 'thread/start returned no id');
});

test('startCodexTurn: mayStart exception propagates, no turn is created or sent', async () => {
  const T = uid(); setCtl(W0, { threadId: T, on: { 'turn/start': COMPLETE() } });
  const paused = Object.assign(new Error('Pocket is paused.'), { code: 409, status: 409, paused: true, keepPending: true });
  await assert.rejects(start(hooks(), { mayStart: () => { throw paused; } }), e => e === paused);
  assert.equal(C.codexTurnActive(T), false);
  await sleep(200);
  assert.ok(!frames(W0).some(f => f.method === 'turn/start' && f.params.threadId === T), 'no turn/start after refused mayStart');
  noteToken(W0, T); await closeQuiet(T);
});

test('startCodexTurn: attachment prompt suffix (singular/plural) and plan collaboration mode', async () => {
  const T = uid(); setCtl(W0, { threadId: T, on: { 'turn/start': COMPLETE() } });
  let h = hooks(); await start(h, { text: 'look', attachments: ['/tmp/x/a.txt'] }); await until(() => h.finished, 4000);
  noteToken(W0, T);
  const textOf = f => (f.params.input || []).filter(i => i.type === 'text').map(i => i.text).join('');
  let fr = frames(W0).filter(f => f.method === 'turn/start' && f.params.threadId === T);
  assert.equal(textOf(fr[0]), 'look\n\n[Attached file — read as needed:\n/tmp/x/a.txt\n]');
  h = hooks(); await start(h, { threadId: T, text: 'two', attachments: ['/tmp/x/a.txt', '/tmp/x/b.txt'], executionMode: 'plan' }); await until(() => h.finished, 4000);
  fr = frames(W0).filter(f => f.method === 'turn/start' && f.params.threadId === T);
  assert.equal(textOf(fr[1]), 'two\n\n[Attached files — read as needed:\n/tmp/x/a.txt\n/tmp/x/b.txt\n]');
  assert.ok(JSON.stringify(fr[1].params).includes('"plan"'), 'plan collaboration mode for executionMode plan');
});

test('startCodexTurn: compact and review actions use their native RPCs', async () => {
  const T = uid(); setCtl(W0, { threadId: T, on: { 'turn/start': COMPLETE(), 'thread/compact/start': COMPLETE(), 'review/start': COMPLETE() } });
  let h = hooks(); await start(h); await until(() => h.finished, 4000);
  noteToken(W0, T);
  h = hooks(); await start(h, { threadId: T, text: '', action: { kind: 'compact' } }); await until(() => h.finished, 4000);
  assert.ok(frames(W0).some(f => f.method === 'thread/compact/start' && f.params.threadId === T), 'thread/compact/start sent');
  h = hooks(); await start(h, { threadId: T, text: '', action: { kind: 'review', target: { type: 'uncommittedChanges' } } }); await until(() => h.finished, 4000);
  const rv = frames(W0).find(f => f.method === 'review/start' && f.params.threadId === T);
  assert.ok(rv, 'review/start sent');
  assert.deepEqual(rv.params.target, { type: 'uncommittedChanges' }); assert.equal(rv.params.delivery, 'inline');
});

test('fail step: initialize error — start rejects and the spawned child is terminated', async () => {
  setCtl(W0, { methods: { initialize: { error: { code: -1, message: 'init refused' } } } });
  const t0 = Date.now();
  await assert.rejects(start(hooks()), e => e.message === 'init refused');
  const sp = sessionFakesSince(W0, t0);
  assert.ok(sp.length >= 1, 'precondition: a session child was spawned');
  assert.ok(await until(() => sp.every(f => !alive(f.pid)), 6000), 'child left running after initialize failure');
});

test('fail step: turn/start error — rejects with .rpc, finish emits failure, close releases the process', async () => {
  const T = uid(); setCtl(W0, { threadId: T, methods: { 'turn/start': { error: { code: -5, message: 'turn refused' } } } });
  const h = hooks();
  await assert.rejects(start(h), e => e.message === 'turn refused' && e.rpc && e.rpc.code === -5 && e.status === undefined);
  assert.equal(C.codexTurnActive(T), false);
  const r = resultOf(null, h); assert.ok(r && r.ok === false, 'failure result emitted');
  const pid = pidForThread(W0, T);
  assert.ok(pid && await until(() => !alive(pid), 7000), 'process closed after turn RPC failure');
});

test('fail step: usage save — rename or write failure leaves prior bytes intact, turn still succeeds', async () => {
  const usageFile = path.join(W0.data, 'codex-usage-state.json');
  for (const [fn, match] of [['renameSync', 'codex-usage-state'], ['writeFileSync', 'codex-usage-state']]) {
    const T = uid(); setCtl(W0, { threadId: T, on: { 'turn/start': COMPLETE(2222, 1111, 20000) } });
    const before = snapshot(usageFile); assert.ok(before, 'precondition: usage file exists');
    const restore = failFsFor(fn, match);
    try {
      const h = hooks(); const t = await start(h); await until(() => h.finished, 5000);
      noteToken(W0, T);
      assert.equal(resultOf(t, h).ok, true, fn + ' failure does not fail the turn');
      assert.ok(unchanged(usageFile, before), fn + ' failure changed the committed usage file');
      JSON.parse(fs.readFileSync(usageFile, 'utf8'));
    } finally { restore(); }
    await closeQuiet(T);
  }
});

test('rate limits: merged snapshot saved; codexLimitReset picks full, then near-full, else null; read error keeps cache', async () => {
  const t0 = Date.now();
  setCtl(W0, { rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1900000000 }, secondary: { usedPercent: 95, windowDurationMins: 10080, resetsAt: 1900500000 } } });
  const r = await C.codexRateLimits();
  assert.equal(r.primary.usedPercent, 100); assert.equal(r.secondary.usedPercent, 95);
  assert.ok(r.observedAt >= t0 && r.observedAt <= Date.now() + 1000, 'observedAt epoch ms');
  const u = JSON.parse(fs.readFileSync(path.join(W0.data, 'codex-usage-state.json'), 'utf8'));
  assert.equal(u.rateLimits.primary.usedPercent, 100);
  assert.equal(await C.codexLimitReset(), 1900000000 * 1000, 'full window wins over near-full');
  setCtl(W0, { rateLimits: { primary: { usedPercent: 50, windowDurationMins: 300, resetsAt: 1900000000 }, secondary: { usedPercent: 92, windowDurationMins: 10080, resetsAt: 1900600000 } } });
  assert.equal(await C.codexLimitReset(), 1900600000 * 1000, 'near-full used when nothing is full');
  setCtl(W0, { rateLimits: { primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1900000000 }, secondary: { usedPercent: 20, windowDurationMins: 10080, resetsAt: 1900600000 } } });
  assert.equal(await C.codexLimitReset(), null);
  setCtl(W0, { methods: { 'account/rateLimits/read': { error: { code: -1, message: 'read failed' } } } });
  const cached = await C.codexRateLimits();
  assert.equal(cached.primary.usedPercent, 10, 'read error returns cached limits');
});

test('concurrency: two simultaneous starts of one thread yield at most one turn and one writer', async () => {
  const T = uid(); setCtl(W0, { lock: true, on: { 'turn/start': [STARTED], 'turn/interrupt': ON_INTERRUPT_COMPLETE } });
  const t0 = Date.now();
  const rs = await Promise.allSettled([start(hooks(), { threadId: T }), start(hooks(), { threadId: T })]);
  noteToken(W0, T);
  const ok = rs.filter(r => r.status === 'fulfilled');
  assert.ok(ok.length <= 1, 'at most one accepted');
  for (const r of rs.filter(r => r.status === 'rejected')) assert.ok([409, 423].includes(r.reason.code), 'loser gets 409/423, got ' + r.reason.code + ' ' + r.reason.message);
  await sleep(1500);
  const live = sessionFakesSince(W0, t0).filter(f => alive(f.pid) && frames(W0).some(x => x._pid === f.pid && x.method === 'thread/resume' && x.params.threadId === T));
  assert.ok(live.length <= 1, 'one writer-lock holder, found ' + live.length);
  if (C.codexTurnActive(T)) { C.stopCodexTurn(T); await sleep(300); }
  await closeQuiet(T);
});

test('closeCodexSession: shared promise, resolves on exit, removes map entry; already-closed resolves', async () => {
  const T = uid(); setCtl(W0, { threadId: T, on: { 'turn/start': COMPLETE() } });
  const h = hooks(); await start(h); await until(() => h.finished, 4000);
  noteToken(W0, T);
  const pid = markerFor(W0, T).m.pid;
  const s = C.codexSessions.get(T);
  const p1 = C.closeCodexSession(s, 'test'), p2 = C.closeCodexSession(s, 'test');
  assert.ok(p1 instanceof Promise); assert.equal(p1, p2, 'concurrent close shares the promise');
  await p1;
  assert.equal(alive(pid), false, 'resolved only after exit');
  assert.equal(C.codexSessions.has(T), false);
  await C.closeCodexSession(s, 'again');
});

test('closeCodexSession: active turn result is not success; a SIGTERM-ignoring child is SIGKILLed after grace', async () => {
  const T = uid(); setCtl(W0, { threadId: T, ignoreTerm: true, on: { 'turn/start': [STARTED] } });
  const h = hooks(); const t = await start(h);
  setCtl(W0, {});
  noteToken(W0, T);
  const { pid, keeperPid } = markerFor(W0, T).m;
  const t0 = Date.now();
  await C.closeCodexSession(C.codexSessions.get(T), 'test');
  assert.ok(Date.now() - t0 >= 4000, 'waited for the kill grace');
  assert.equal(alive(pid), false);
  assert.ok(await until(() => !alive(keeperPid), 6000), 'keeper gone');
  assert.equal(C.codexTurnActive(T), false);
  const r = resultOf(t, h); assert.ok(r && r.ok === false, 'closed active turn finishes ok:false');
});

test('closeCodexSession: process that survives SIGKILL => reject 423 with the exact message', async () => {
  const T = uid(); setCtl(W0, { threadId: T, ignoreTerm: true, on: { 'turn/start': COMPLETE() } });
  const h = hooks(); await start(h); await until(() => h.finished, 4000);
  setCtl(W0, {});
  noteToken(W0, T);
  const { pid } = markerFor(W0, T).m;
  const realKill = process.kill.bind(process);
  const restore = patch(process, 'kill', (p, sig) => { if (Math.abs(Number(p)) === pid && sig !== 0 && sig !== undefined) return true; return realKill(p, sig); });
  try {
    await assert.rejects(C.closeCodexSession(C.codexSessions.get(T), 'test'), e => e.code === 423 && e.message === 'The previous Codex process for this conversation has not exited yet, so a new one was not started. Try again in a minute; if this keeps happening, restart Pocket.');
  } finally { restore(); try { realKill(-pid, 'SIGKILL'); } catch {} }
});

test('scrubbing: runner tokens never appear in module diagnostics', () => {
  assert.ok(TOKENS.size > 0, 'precondition: tokens collected');
  for (const tok of TOKENS) assert.ok(!LOGS.some(l => l.includes(tok)), 'runner token printed in diagnostics');
});

// ================================================================ 5. fresh-process restarts and timing (child Node processes)
const PRELUDE = String.raw`
import fs from 'node:fs'; import path from 'node:path'; import cp from 'node:child_process'; import { syncBuiltinESMExports } from 'node:module';
const W = JSON.parse(process.env.WORLD);
const OPT = JSON.parse(process.env.OPT || '{}');
if (process.env.SCALE_TIMERS) { const k = Number(process.env.SCALE_TIMERS); const st = globalThis.setTimeout; globalThis.setTimeout = (fn, ms, ...a) => st(fn, Number(ms) >= 5000 ? Math.ceil(Number(ms) / k) : ms, ...a); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; let v; while (!(v = fn()) && Date.now() < end) await sleep(25); return v; };
const done = o => { process.stdout.write('\nRESULT:' + JSON.stringify(o) + '\n', () => process.exit(0)); };
function failFs(name, match, skip = 0) { const real = fs[name]; let seen = 0; fs[name] = (...a) => { if (String(a[0]).includes(match) && ++seen > skip) throw Object.assign(new Error('injected ' + name + ' failure'), { code: 'EIO' }); return real.apply(fs, a); }; syncBuiltinESMExports(); }
const size = x => (x && x.pending instanceof Map) ? x.pending.size : !x ? 0 : (x instanceof Map || x instanceof Set) ? x.size : Array.isArray(x) ? x.length : typeof x === 'object' ? Object.keys(x).length : 0;
function mkHooks() { const h = { events: [], finished: 0, autonomous: 0 }; h.emit = e => h.events.push(e); h.onFinish = () => { h.finished++; }; h.onQuestion = () => {}; h.onApproval = () => {}; h.auditApproval = () => true; h.onAutonomous = () => { h.autonomous++; }; h.onForked = () => {}; return h; }
const C = await import(process.env.CODEX_MOD);
const turnInfo = t => t && ({ threadId: t.threadId, turnId: t.turnId, autonomous: t.autonomous, origin: t.origin, originRef: t.originRef, rootOrigin: t.rootOrigin, stopped: !!t.stopped, approvals: size(t.approvals), questions: size(t.questions), results: (t.events || []).filter(e => e && e.type === 'result') });
const state = () => ({ sessions: [...C.codexSessions.keys()], turns: [...C.codexTurns.values()].map(turnInfo) });
async function startTurn(extra = {}) { const h = mkHooks(); try { const t = await C.startCodexTurn({ cwd: W.cwd, text: 'hello', model: 'gpt-fake', effort: 'medium', emit: h.emit, onFinish: h.onFinish, onQuestion: h.onQuestion, onApproval: h.onApproval, auditApproval: h.auditApproval, onAutonomous: h.onAutonomous, onForked: h.onForked, ...extra }); return { ok: true, t, h }; } catch (e) { return { ok: false, err: e.message, code: e.code, h }; } }
const ourFds = () => { const out = []; for (const fd of fs.readdirSync('/proc/self/fd')) { try { const l = fs.readlinkSync('/proc/self/fd/' + fd); if (l.startsWith(W.pipes) || l.startsWith(path.join(W.data, 'turnlogs-codex'))) out.push(l); } catch {} } return out; };
`;
let childN = 0;
function runChild(w, body, { opt = {}, env = {}, timeoutMs = 25000 } = {}) {
  const f = path.join(w.root, 'child-' + (++childN) + '.mjs');
  fs.writeFileSync(f, PRELUDE + body);
  const e = { ...process.env, POCKET_DATA_DIR: w.data, POCKET_PIPE_DIR: w.pipes, CODEX_HOME: w.chome, CODEX_BIN: FAKE, FAKE_DIR: w.fake, CODEX_MOD: MOD, POCKET_IDLE_CLOSE_MS: '0', POCKET_SKILLS: '0', WORLD: JSON.stringify(w), OPT: JSON.stringify(opt), ...env };
  return new Promise(resolve => {
    const c = spawn(process.execPath, [f], { env: e, cwd: w.root, stdio: ['ignore', 'pipe', 'pipe'] });
    track(c.pid);
    let out = '', err = '';
    c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => { try { c.kill('SIGKILL'); } catch {} }, timeoutMs);
    c.on('close', code => { clearTimeout(timer); const m = /\nRESULT:(.*)\n/.exec(out); let result = null; try { result = m ? JSON.parse(m[1]) : null; } catch {} resolve({ result, out, err, code }); });
  });
}
const need = (r, what) => { assert.ok(r.result, what + ' child produced no result (code ' + r.code + '): ' + r.err.slice(-1500)); return r.result; };
const ADOPT = String.raw`
C.adoptCodexSessions(() => mkHooks());
await sleep(OPT.wait || 1500);
done(state());
`;

describe('fresh-process restarts, timing and divergences', { concurrency: true }, () => {
  test('restart: active turn is adopted with origin; pre-restart approval declined once, card gone; tokens/details not printed', async () => {
    const w = newWorld(); const T = uid();
    setCtl(w, { threadId: T, turnId: 'turn-R', on: { 'turn/start': [STARTED, { delay: 20, frame: { id: 8101, method: 'item/commandExecution/requestApproval', params: { threadId: '$T', turnId: '$TURN', itemId: 'c1', command: 'echo SECRET-CMD-88', cwd: '/tmp' } } }] } });
    try {
      const a = await runChild(w, String.raw`
const r = await startTurn({ origin: 'job', originRef: 'job-42', rootOrigin: 'job' });
await until(() => r.ok && size(r.t.approvals) > 0, 3000);
await sleep(300);
done({ ok: r.ok, err: r.err, approvals: r.ok ? size(r.t.approvals) : -1 });`);
      const A = need(a, 'A');
      assert.equal(A.ok, true, 'precondition: start ' + A.err);
      assert.equal(A.approvals, 1, 'precondition: approval card before restart');
      const mk = markerFor(w, T); assert.ok(mk, 'marker exists');
      assert.equal(mk.m.waitingForApproval, true, 'waitingForApproval flag persisted');
      assert.equal(mk.m.turn && mk.m.turn.turnId, 'turn-R');
      const b = await runChild(w, ADOPT);
      const B = need(b, 'B');
      assert.ok(B.sessions.includes(T), 'live session adopted');
      const turn = B.turns.find(x => x.threadId === T);
      assert.ok(turn, 'active turn adopted');
      assert.equal(turn.turnId, 'turn-R');
      assert.equal(turn.origin, 'job'); assert.equal(turn.originRef, 'job-42');
      assert.equal(turn.approvals, 0, 'old card does not reappear');
      const resp = responsesTo(w, 8101);
      assert.equal(resp.length, 1, 'stale request answered exactly once');
      assert.deepEqual(resp[0].result, { decision: 'decline' });
      const all = a.out + a.err + b.out + b.err;
      assert.ok(!all.includes(mk.m.runnerToken), 'runner token printed');
      assert.ok(!all.includes('SECRET-CMD-88'), 'approval detail printed');
    } finally { reap(w); }
  });

  test('restart: unrelated/reused PIDs are never signalled or adopted; malformed marker ignored; old orphan logs swept', async () => {
    const w = newWorld(); fs.mkdirSync(logDir(w), { recursive: true, mode: 0o700 });
    const boot = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    const sl = () => { const c = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' }); c.unref(); track(c.pid); return c.pid; };
    const s1 = sl(), s2 = sl(), s3 = sl();
    const gone = spawn('true'); await new Promise(r => gone.on('exit', r)); const deadPid = gone.pid;
    const base = { cliBin: FAKE, bootId: boot, pidStart: 1, keeperStart: 1, approvalMode: 'review', cwd: w.cwd, model: 'gpt-fake', effort: 'medium', turn: null, waitingForInput: false, waitingForApproval: false };
    const write = (key, m) => fs.writeFileSync(path.join(logDir(w), key + '.session.json'), JSON.stringify(m), { mode: 0o600 });
    write('abc123', { ...base, key: 'abc123', threadId: uid(), pid: s1, keeperPid: s2, runnerToken: 'a'.repeat(32) });
    write('def456', { ...base, key: 'def456', threadId: uid(), pid: deadPid, keeperPid: s3, runnerToken: 'b'.repeat(32) });
    fs.writeFileSync(path.join(logDir(w), 'bad999.session.json'), '{nope');
    const old = path.join(logDir(w), 'old111.out.ndjson'), fresh = path.join(logDir(w), 'new222.out.ndjson');
    fs.writeFileSync(old, '{}\n'); fs.writeFileSync(fresh, '{}\n');
    const t = new Date(Date.now() - 72 * 3600e3); fs.utimesSync(old, t, t);
    try {
      const B = need(await runChild(w, ADOPT), 'B');
      assert.deepEqual(B.sessions, [], 'nothing adopted');
      assert.ok(alive(s1), 'unrelated primary PID signalled');
      assert.ok(alive(s2), 'unrelated keeper PID signalled');
      assert.ok(alive(s3), 'unproven keeper of dead primary signalled');
      assert.equal(fs.existsSync(path.join(logDir(w), 'def456.session.json')), false, 'marker of a dead primary removed');
      assert.equal(fs.existsSync(old), false, 'orphan log older than 48 h swept');
      assert.equal(fs.existsSync(fresh), true, 'recent orphan log kept');
    } finally { for (const p of [s1, s2, s3]) { try { process.kill(-p, 'SIGKILL'); } catch {} } }
  });

  test('restart: malformed usage state file does not crash import and is replaced by valid JSON', async () => {
    const w = newWorld(); const T = uid();
    fs.writeFileSync(path.join(w.data, 'codex-usage-state.json'), 'garbage{');
    setCtl(w, { threadId: T, on: { 'turn/start': COMPLETE(500, 100, 1000) } });
    try {
      const R = need(await runChild(w, String.raw`
const cc = await C.codexContextAndCache('019ab000-0000-7000-8000-000000000000');
const r = await startTurn(); await until(() => r.h.finished, 5000); await sleep(200);
done({ cc, ok: r.ok, err: r.err });`), 'child');
      assert.deepEqual(R.cc, { context: null, cache: null });
      assert.equal(R.ok, true, R.err);
      const u = JSON.parse(fs.readFileSync(path.join(w.data, 'codex-usage-state.json'), 'utf8'));
      assert.equal(u.context[T].used, 500); assert.ok('rateLimits' in u);
    } finally { reap(w); }
  });

  test('idle close: POCKET_IDLE_CLOSE_MS closes the process after the turn completes', async () => {
    const w = newWorld(); const T = uid();
    setCtl(w, { threadId: T, on: { 'turn/start': COMPLETE() } });
    try {
      const R = need(await runChild(w, String.raw`
const r = await startTurn(); await until(() => r.h.finished, 5000);
const idle = await until(() => !C.codexSessions.size, 4000);
done({ ok: r.ok, idle: !!idle });`, { env: { POCKET_IDLE_CLOSE_MS: '400' } }), 'child');
      assert.equal(R.ok, true);
      assert.equal(R.idle, true, 'session closed after idle timeout');
      const pid = pidForThread(w, T);
      assert.ok(await until(() => !alive(pid), 3000), 'idle process exited');
    } finally { reap(w); }
  });

  test('stall watchdog: silent turn is interrupted, then closed after grace (timers scaled 1/20)', async () => {
    const w = newWorld(); const T = uid();
    setCtl(w, { threadId: T, on: { 'turn/start': [STARTED] } });
    try {
      const R = need(await runChild(w, String.raw`
const r = await startTurn(); if (!r.ok) done({ ok: false, err: r.err });
const gone = await until(() => !C.codexTurns.size, 7000);
await sleep(300);
done({ ok: true, gone: !!gone, results: r.t.events.filter(e => e.type === 'result'), sessions: C.codexSessions.size });`, { env: { POCKET_STALL_MS: '1000', SCALE_TIMERS: '20' } }), 'child');
      assert.equal(R.ok, true, R.err);
      assert.ok(frames(w).some(f => f.method === 'turn/interrupt' && f.params.threadId === T), 'stall sent turn/interrupt');
      assert.equal(R.gone, true, 'stalled turn ended');
      assert.ok(R.results.length === 1 && R.results[0].ok === false, 'stalled turn result ok:false once');
      const pid = pidForThread(w, T);
      assert.ok(await until(() => !alive(pid), 3000), 'stalled process closed');
    } finally { reap(w); }
  });

  test('failed mkfifo leaves no process', async () => {
    const w = newWorld(); const T = uid();
    setCtl(w, { threadId: T, on: { 'turn/start': COMPLETE() } });
    try {
      const R = need(await runChild(w, String.raw`
const r = await startTurn(); await sleep(500); done({ ok: r.ok, err: r.err, state: state() });`, { env: { PATH: FAILBIN + ':' + process.env.PATH } }), 'child');
      assert.equal(R.ok, false, 'start must fail when mkfifo fails');
      assert.deepEqual(sessionFakesSince(w, 0), [], 'no session process spawned');
    } finally { reap(w); }
  });

  test('DIV-1: usage context retention is bounded (stale thread ids pruned on save)', async () => {
    const w = newWorld(); const T = uid();
    const ctx = {}; for (let i = 0; i < 3000; i++) ctx['019a0000-0000-7000-8000-' + String(i).padStart(12, '0')] = { used: 1, cached: 0, window: 1000, estimated: false, model: 'gpt-fake', lastAt: 1577836800000 + i };
    fs.writeFileSync(path.join(w.data, 'codex-usage-state.json'), JSON.stringify({ context: ctx, rateLimits: null }), { mode: 0o600 });
    setCtl(w, { threadId: T, on: { 'turn/start': COMPLETE() } });
    try {
      const R = need(await runChild(w, String.raw`
const r = await startTurn(); await until(() => r.h.finished, 5000); await sleep(200); done({ ok: r.ok, err: r.err });`), 'child');
      assert.equal(R.ok, true, R.err);
      const u = JSON.parse(fs.readFileSync(path.join(w.data, 'codex-usage-state.json'), 'utf8'));
      assert.ok(u.context[T], 'new thread recorded');
      assert.ok(Object.keys(u.context).length < 3001, 'context grows without retention: ' + Object.keys(u.context).length + ' entries, oldest from 2020 still kept');
    } finally { reap(w); }
  });

  test('DIV-2: keeper spawn failure after primary spawn leaves no unrecorded child and no open fds', async () => {
    const w = newWorld(); const T = uid();
    setCtl(w, { threadId: T, on: { 'turn/start': COMPLETE() } });
    try {
      const R = need(await runChild(w, String.raw`
const real = cp.spawn; cp.spawn = (...a) => { if (a[0] === 'sh' && Array.isArray(a[1]) && a[1].includes('pocket-keeper')) throw Object.assign(new Error('injected keeper spawn failure'), { code: 'EAGAIN' }); return real(...a); }; syncBuiltinESMExports();
const r = await startTurn(); await sleep(800);
done({ ok: r.ok, err: r.err, fds: ourFds() });`), 'child');
      assert.equal(R.ok, false, 'precondition: start fails when keeper cannot spawn (' + R.err + ')');
      await sleep(500);
      const orphans = sessionFakesSince(w, 0).filter(f => alive(f.pid) && !markers(w).some(x => x.m && x.m.pid === f.pid));
      assert.deepEqual({ orphanPrimaries: orphans.length, openFds: R.fds }, { orphanPrimaries: 0, openFds: [] }, 'failed spawn left an unrecorded detached primary and/or open session fds');
    } finally { reap(w); }
  });

  test('DIV-3: initial session marker write failure must not report success with an unrecorded live process', async () => {
    const w = newWorld(); const T = uid();
    setCtl(w, { threadId: T, on: { 'turn/start': [STARTED] } });
    try {
      const A = need(await runChild(w, String.raw`
failFs('renameSync', '.session.json');
const r = await startTurn(); await sleep(300); done({ ok: r.ok, err: r.err });`), 'A');
      await sleep(500);
      const liveFakes = sessionFakesSince(w, 0).filter(f => alive(f.pid));
      const B = need(await runChild(w, ADOPT), 'B');
      assert.ok(!A.ok || markerFor(w, T), 'startCodexTurn reported success but no session marker exists on disk');
      assert.ok(liveFakes.length === 0 || B.sessions.length === liveFakes.length, 'restart cannot find ' + liveFakes.length + ' surviving writer-lock holder(s); adopted ' + B.sessions.length);
    } finally { reap(w); }
  });

  test('DIV-4: active/turn-id marker write failure must not leave a live turn a restart treats as idle', async () => {
    const w = newWorld(); const T = uid();
    setCtl(w, { threadId: T, turnId: 'turn-L', on: { 'turn/start': [STARTED] } });
    try {
      const A = need(await runChild(w, String.raw`
failFs('renameSync', '.session.json', 1);
const r = await startTurn(); await sleep(300); done({ ok: r.ok, err: r.err, active: C.codexTurnActive(r.ok ? r.t.threadId : '') });`), 'A');
      const B = need(await runChild(w, ADOPT), 'B');
      const mk = markerFor(w, T);
      assert.ok(!A.ok || (mk && mk.m.turn && mk.m.turn.turnId === 'turn-L'), 'turn accepted but marker says turn=' + JSON.stringify(mk && mk.m.turn));
      assert.ok(!A.ok || B.turns.some(x => x.threadId === T), 'restart treats live turn as idle (adopted turns: ' + JSON.stringify(B.turns) + ')');
    } finally { reap(w); }
  });

  test('DIV-6: stop whose interrupt succeeds but never completes is ended by a grace (timers scaled 1/20)', async () => {
    const w = newWorld(); const T = uid();
    setCtl(w, { threadId: T, on: { 'turn/start': [STARTED] } });
    try {
      const R = need(await runChild(w, String.raw`
const r = await startTurn(); if (!r.ok) done({ ok: false, err: r.err });
const ret = C.stopCodexTurn(r.t.threadId);
const stopped = !!r.t.stopped;
const gone = await until(() => !C.codexTurns.size, 4500);
done({ ok: true, ret, stopped, gone: !!gone, results: r.t.events.filter(e => e.type === 'result') });`, { env: { SCALE_TIMERS: '20' } }), 'child');
      assert.equal(R.ok, true, R.err);
      assert.equal(R.ret, true); assert.equal(R.stopped, true);
      assert.ok(frames(w).some(f => f.method === 'turn/interrupt' && f.params.threadId === T), 'interrupt sent');
      assert.equal(R.gone, true, 'stopped turn still active ~90 s (scaled) after a successful interrupt with no completion');
    } finally { reap(w); }
  });

  test('DIV-7: usage-limit retry marker failure must not arm an undurable retry (server.mjs scheduleRetry)', () => {
    assert.equal(C.isCodexLimit('usageLimitExceeded'), true, 'precondition');
    assert.fail('scheduleRetry lives in server.mjs; it cannot be driven from codex.mjs without starting the service, which this review forbids');
  });

  test('DIV-8: adopted autonomous turn keeps its autonomous mark after restart', async () => {
    const w = newWorld(); const T = uid();
    setCtl(w, { threadId: T, turnId: 'turn-1', on: { 'turn/start': [...COMPLETE(), { delay: 300, frame: { method: 'turn/started', params: { threadId: '$T', turn: { id: 'turn-auto', status: 'inProgress', items: [] } } } }] } });
    try {
      const A = need(await runChild(w, String.raw`
const r = await startTurn(); if (!r.ok) done({ ok: false, err: r.err });
await until(() => C.codexTurns.get(r.t.threadId) && C.codexTurns.get(r.t.threadId).turnId === 'turn-auto', 4000);
await sleep(300);
const t = C.codexTurns.get(r.t.threadId);
done({ ok: true, auto: t ? t.autonomous : null, turnId: t ? t.turnId : null });`), 'A');
      assert.equal(A.ok, true, A.err);
      assert.equal(A.turnId, 'turn-auto', 'precondition: autonomous turn created');
      assert.equal(A.auto, true, 'precondition: autonomous before restart');
      const B = need(await runChild(w, ADOPT), 'B');
      const turn = B.turns.find(x => x.threadId === T);
      assert.ok(turn, 'autonomous turn adopted');
      assert.equal(turn.autonomous, true, 'autonomous mark lost on adoption');
    } finally { reap(w); }
  });
});

// ================================================================ cleanup (kept last)
test('cleanup: close main sessions and reap every stand-in process', async () => {
  for (const s of [...C.codexSessions.values()]) { try { await C.closeCodexSession(s, 'cleanup'); } catch {} }
  for (const w of worlds) reap(w);
  assert.ok(true);
});
after(() => { setTimeout(() => process.exit(), 3000).unref(); });
