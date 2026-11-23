// A contract for approvals.mjs, access.mjs and trusted.mjs, written from a behaviour spec without sight of the source
// (bug review of 2026-11-23, Pocket Code 1.124.3). Every step that writes state is failed in turn; a test whose failure
// was ruled deliberate asserts what the code does, with the reason beside it.
// All values are synthetic: temp dirs, made-up keys and names, fake fetch. No network, no processes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { tmpDir, fakeClock, failing, patch, snapshot, unchanged, until } from './bugreview-faults.mjs';
import {
  approvalMode, claudePermissionSettings, codexPermissionSettings, approvalAudit, ApprovalInbox, codexApproval,
} from '../approvals.mjs';
import { AccessVerifier } from '../access.mjs';
import {
  TRUSTED_LIMIT, RULE_MAX, commandWords, parseRule, validateRules, parseRuleList, matchTrusted,
} from '../trusted.mjs';

// ---------------------------------------------------------------- helpers
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const sha = s => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
const fp = r => sha(JSON.stringify({ kind: r.kind, title: r.title, details: r.details, allow: r.allow, deny: r.deny }));
const tick = () => new Promise(r => setImmediate(r));

const NOT_WAITING = 'This action is no longer waiting. Refresh the approvals.';
const ALREADY_SENT = 'The decision was already sent or could not be confirmed. Refresh before continuing.';
const NO_RECORD = 'Could not record this decision. Nothing was approved; try again.';
const UNCERTAIN = 'Delivery of this decision is uncertain. Stop the reply and review the conversation; do not approve it again.';

async function rejectsWith(fn, message, status) {
  await assert.rejects(async () => fn(), e => {
    assert.equal(e.message, message);
    assert.equal(e.status, status);
    assert.equal(e.code, undefined);
    return true;
  });
}
function throwsWith(fn, message, status) {
  assert.throws(fn, e => { assert.equal(e.message, message); assert.equal(e.status, status); assert.equal(e.code, undefined); return true; });
}

let seq = 0;
function req(over = {}) {
  seq += 1;
  return {
    nativeId: `native-${seq}`, turnId: 't1', kind: 'command', title: 'Run this command?',
    details: { command: 'ls -la', cwd: '/tmp/example' }, allow: { behavior: 'allow' }, deny: { behavior: 'deny' },
    ...over,
  };
}

function mk(opts = {}) {
  const state = { turn: 't1', writes: [], audits: [], changes: 0, autoErrors: [] };
  const inbox = new ApprovalInbox({
    sessionId: () => 'sess-1',
    turnId: () => state.turn,
    write: opts.write || (async (id, resp) => { state.writes.push([id, resp]); }),
    audit: opts.audit || (rec => { state.audits.push(JSON.parse(JSON.stringify(rec))); }),
    onChange: opts.onChange || (() => { state.changes += 1; }),
    onAutoError: opts.onAutoError || ((e, meta) => { state.autoErrors.push([e, meta]); }),
  });
  return { inbox, state };
}

function deferred() { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; }

// Watch the fds the module opens for `file` and optionally fault write/fsync/close on exactly those fds.
function fdWatch(file, { writeImpl, fsyncImpl, closeImpl } = {}) {
  const fds = new Set(); const opened = []; const closed = []; const restores = [];
  const realOpen = fs.openSync, realWrite = fs.writeSync, realFsync = fs.fsyncSync, realClose = fs.closeSync;
  restores.push(patch(fs, 'openSync', (...a) => {
    const fd = realOpen.apply(fs, a);
    if (path.resolve(String(a[0])) === path.resolve(file)) { fds.add(fd); opened.push({ fd, flags: a[1], mode: a[2] }); }
    return fd;
  }));
  restores.push(patch(fs, 'writeSync', (...a) => (fds.has(a[0]) && writeImpl ? writeImpl(realWrite, ...a) : realWrite.apply(fs, a))));
  restores.push(patch(fs, 'fsyncSync', (...a) => (fds.has(a[0]) && fsyncImpl ? fsyncImpl(realFsync, ...a) : realFsync.apply(fs, a))));
  restores.push(patch(fs, 'closeSync', (...a) => {
    if (fds.has(a[0])) { closed.push(a[0]); if (closeImpl) return closeImpl(realClose, ...a); }
    return realClose.apply(fs, a);
  }));
  return { opened, closed, restore() { while (restores.length) restores.pop()(); } };
}
const eio = (msg, code = 'EIO') => Object.assign(new Error(msg), { code });
const lines = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
const completeRows = file => lines(file).split('\n').slice(0, -1).map(l => JSON.parse(l));

function assertRestart(file, ids) {
  // Restart = a fresh inbox on the same audit file: nothing pending, old ids not actionable, bytes untouched.
  const snap = snapshot(file);
  const { inbox, state } = mk({ audit: approvalAudit(file) });
  assert.deepEqual(inbox.list(), []);
  return Promise.all(ids.map(id => rejectsWith(() => inbox.decide(id, 'allow'), NOT_WAITING, 409))).then(() => {
    assert.ok(unchanged(file, snap), 'restart must not rewrite the audit file');
    assert.equal(state.writes.length, 0);
  });
}

// ---------------------------------------------------------------- approvalMode / settings
describe('approvalMode', () => {
  test('null/undefined select the default; exact review/full accepted', () => {
    assert.equal(approvalMode(null), 'review');
    assert.equal(approvalMode(undefined), 'review');
    assert.equal(approvalMode(undefined, 'full'), 'full');
    assert.equal(approvalMode('review'), 'review');
    assert.equal(approvalMode('full'), 'full');
    assert.equal(approvalMode('review', 'review', false), 'review');
  });
  test('invalid values throw 400 without normalising case or space', () => {
    for (const v of ['Review', ' full', 'FULL', 'x', '', 0, {}]) throwsWith(() => approvalMode(v), 'Choose Review actions or Full access.', 400);
  });
  test('full with falsy allowFull throws 403', () => {
    for (const allow of [false, 0, '', null]) throwsWith(() => approvalMode('full', 'review', allow), 'Full access is disabled on this instance.', 403);
  });
  test('default full with allowFull false is also refused', () => {
    throwsWith(() => approvalMode(null, 'full', false), 'Full access is disabled on this instance.', 403);
  });
});

describe('permission settings', () => {
  test('claudePermissionSettings', () => {
    assert.deepEqual(claudePermissionSettings('full'), { permissionMode: 'bypassPermissions', permissions: { ask: ['AskUserQuestion'] } });
    const review = { permissionMode: 'default', permissions: { ask: ['AskUserQuestion', 'Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit', 'Agent', 'Task', 'WebFetch', 'WebSearch', 'mcp__*'] } };
    for (const m of ['review', 'Full', undefined, null, 'anything']) assert.deepEqual(claudePermissionSettings(m), review);
  });
  test('codexPermissionSettings', () => {
    assert.deepEqual(codexPermissionSettings('full'), { sandbox: 'danger-full-access', approvalPolicy: 'never' });
    for (const m of ['review', 'FULL', undefined]) assert.deepEqual(codexPermissionSettings(m), { sandbox: 'read-only', approvalPolicy: 'untrusted', config: { approvals_reviewer: 'user' } });
  });
});

// ---------------------------------------------------------------- approvalAudit
describe('approvalAudit contract', () => {
  test('appends one JSONL row {at,...record} per call, creates file 0600, returns undefined', () => {
    const file = path.join(tmpDir('br-audit-'), 'approval-decisions.jsonl');
    const w = fdWatch(file);
    try {
      const a = approvalAudit(file);
      assert.equal(typeof a, 'function');
      assert.equal(fs.existsSync(file), false, 'nothing written before first record');
      assert.equal(a({ event: 'requested', n: 1 }), undefined);
      a({ event: 'decision', n: 2, text: 'é😀' });
    } finally { w.restore(); }
    const raw = fs.readFileSync(file, 'utf8');
    assert.ok(raw.endsWith('\n'));
    const rows = raw.split('\n');
    assert.equal(rows.length, 3);
    const r1 = JSON.parse(rows[0]); const r2 = JSON.parse(rows[1]);
    assert.equal(Object.keys(r1)[0], 'at');
    assert.match(r1.at, ISO);
    assert.ok(Math.abs(Date.parse(r1.at) - Date.now()) < 60000);
    assert.deepEqual({ ...r1, at: undefined }, { at: undefined, event: 'requested', n: 1 });
    assert.equal(r2.text, 'é😀');
    assert.equal(rows[1], JSON.stringify(r2));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(w.opened.length, 2, 'opens per call');
    assert.deepEqual(w.closed.sort(), w.opened.map(o => o.fd).sort(), 'every fd closed');
  });
  test('pre-existing broader mode is not changed and prior bytes are kept', () => {
    const file = path.join(tmpDir('br-audit-'), 'a.jsonl');
    fs.writeFileSync(file, '{"old":1}\n', { mode: 0o644 }); fs.chmodSync(file, 0o644);
    approvalAudit(file)({ event: 'x' });
    assert.equal(fs.statSync(file).mode & 0o777, 0o644);
    assert.ok(fs.readFileSync(file, 'utf8').startsWith('{"old":1}\n'));
    assert.equal(completeRows(file).length, 2);
  });
  test('record may override nothing but is spread after at (later keys win)', () => {
    const file = path.join(tmpDir('br-audit-'), 'a.jsonl');
    approvalAudit(file)({ event: 'e', at: 'custom' });
    assert.equal(completeRows(file)[0].at, 'custom');
  });
});

describe('approvalAudit fail-every-step', () => {
  test('step 1 openSync fails: native error propagates, prior bytes intact, no fd', () => {
    const file = path.join(tmpDir('br-audit-'), 'a.jsonl');
    fs.writeFileSync(file, '{"old":1}\n'); const snap = snapshot(file);
    const realOpen = fs.openSync;
    const r = patch(fs, 'openSync', (...a) => { if (path.resolve(String(a[0])) === path.resolve(file)) throw eio('open failed'); return realOpen.apply(fs, a); });
    try {
      assert.throws(() => approvalAudit(file)({ event: 'x' }), e => e.code === 'EIO' && e.message === 'open failed' && e.status === undefined);
    } finally { r(); }
    assert.ok(unchanged(file, snap));
  });
  test('step 2 JSON.stringify fails (BigInt): TypeError, fd closed, bytes unchanged', () => {
    const file = path.join(tmpDir('br-audit-'), 'a.jsonl');
    fs.writeFileSync(file, '{"old":1}\n'); const snap = snapshot(file);
    const w = fdWatch(file);
    try { assert.throws(() => approvalAudit(file)({ event: 'x', big: 1n }), TypeError); } finally { w.restore(); }
    assert.ok(unchanged(file, snap));
    assert.equal(w.closed.length, w.opened.length, 'any opened fd is closed');
  });
  test('step 3 writeSync throws: error propagates, fd closed, no complete new row', () => {
    const file = path.join(tmpDir('br-audit-'), 'a.jsonl');
    fs.writeFileSync(file, '{"old":1}\n'); const snap = snapshot(file);
    const w = fdWatch(file, { writeImpl: () => { throw eio('write failed'); } });
    try { assert.throws(() => approvalAudit(file)({ event: 'x' }), e => e.code === 'EIO' && e.message === 'write failed'); } finally { w.restore(); }
    assert.ok(unchanged(file, snap));
    assert.equal(w.opened.length, 1); assert.deepEqual(w.closed, [w.opened[0].fd]);
  });
  test('step 3 partial write then throw: incomplete tail, fd closed', () => {
    const file = path.join(tmpDir('br-audit-'), 'a.jsonl');
    fs.writeFileSync(file, '{"old":1}\n');
    const w = fdWatch(file, { writeImpl: (real, fd, data) => { real.call(fs, fd, Buffer.from(data).subarray(0, 5)); throw eio('ENOSPC mid-write', 'ENOSPC'); } });
    try { assert.throws(() => approvalAudit(file)({ event: 'x' }), e => e.code === 'ENOSPC'); } finally { w.restore(); }
    assert.equal(completeRows(file).length, 1, 'only the prior row is complete');
    assert.equal(w.closed.length, 1);
  });
  test('step 4 fsyncSync throws: error propagates, fd closed', () => {
    const file = path.join(tmpDir('br-audit-'), 'a.jsonl');
    const w = fdWatch(file, { fsyncImpl: () => { throw eio('fsync failed'); } });
    try { assert.throws(() => approvalAudit(file)({ event: 'x' }), e => e.message === 'fsync failed' && e.code === 'EIO'); } finally { w.restore(); }
    assert.equal(w.closed.length, 1);
  });
  test('step 5 closeSync throws after fsync: error propagates, full row present', () => {
    const file = path.join(tmpDir('br-audit-'), 'a.jsonl');
    const w = fdWatch(file, { closeImpl: (real, fd) => { real.call(fs, fd); throw eio('close failed', 'EBADF'); } });
    try { assert.throws(() => approvalAudit(file)({ event: 'x' }), e => e.code === 'EBADF'); } finally { w.restore(); }
    assert.equal(completeRows(file).length, 1);
  });
  test('write and close both throw: the close error replaces the write error', () => {
    const file = path.join(tmpDir('br-audit-'), 'a.jsonl');
    const w = fdWatch(file, {
      writeImpl: () => { throw eio('write failed', 'EIO'); },
      closeImpl: (real, fd) => { real.call(fs, fd); throw eio('close failed', 'EBADF'); },
    });
    try { assert.throws(() => approvalAudit(file)({ event: 'x' }), e => e.code === 'EBADF' && e.message === 'close failed'); } finally { w.restore(); }
  });
  // Fixed in 1.124.4 (was DIV-3): a short write throws and leaves the file as it was. test/approvals.test.mjs proves the
  // same through a real file-size limit.
  test('a short successful writeSync throws and leaves no fragment', () => {
    const file = path.join(tmpDir('br-audit-'), 'a.jsonl');
    fs.writeFileSync(file, '{"old":1}\n'); const snap = snapshot(file);
    let shorted = false;
    const w = fdWatch(file, { writeImpl: (real, fd, data, ...rest) => {
      if (!shorted) { shorted = true; const b = Buffer.from(data); return real.call(fs, fd, b.subarray(0, Math.floor(b.length / 2))); }
      return real.call(fs, fd, data, ...rest);
    } });
    try { assert.throws(() => approvalAudit(file)({ event: 'decision', decision: 'allow' }), e => e.code === 'EIO'); } finally { w.restore(); }
    assert.ok(unchanged(file, snap), 'the file holds exactly the bytes it had before the row');
    assert.equal(w.closed.length, 1);
  });
});

// ---------------------------------------------------------------- ApprovalInbox.receive
describe('ApprovalInbox.receive contract', () => {
  test('new row: audit first, then row + onChange, returns true; list shape', () => {
    const order = [];
    let inboxRef;
    const { inbox, state } = mk({
      audit: rec => { order.push(['audit', inboxRef.list().length]); state.audits.push(rec); },
      onChange: () => { order.push(['change', inboxRef.list().length]); },
    });
    inboxRef = inbox;
    const r = req({ details: { command: 'make build', nested: [1, { a: 'b' }] } });
    const restore = patch(Date, 'now', () => 1767225600123);
    let ok;
    try { ok = inbox.receive(r); } finally { restore(); }
    assert.equal(ok, true);
    assert.deepEqual(order, [['audit', 0], ['change', 1]]);
    assert.equal(state.audits.length, 1);
    const a = state.audits[0];
    assert.match(a.requestId, UUID);
    assert.deepEqual(a, { event: 'requested', sessionId: 'sess-1', turnId: 't1', requestId: a.requestId, kind: 'command', fingerprint: fp(r) });
    assert.deepEqual(inbox.list(), [{
      id: a.requestId, turnId: 't1', kind: 'command', title: 'Run this command?',
      details: JSON.stringify(r.details, null, 2), canAllow: true, createdAt: 1767225600123, status: 'pending', agent: null,
    }]);
  });
  test('list returns fresh copies in insertion order', () => {
    const { inbox } = mk();
    const r1 = req(), r2 = req();
    inbox.receive(r1); inbox.receive(r2);
    const l = inbox.list();
    assert.deepEqual(l.map(x => x.title), [r1.title, r2.title]);
    l[0].status = 'tampered'; l.pop();
    assert.equal(inbox.list().length, 2);
    assert.equal(inbox.list()[0].status, 'pending');
    for (const row of inbox.list()) for (const k of ['nativeId', 'allow', 'deny', 'fingerprint']) assert.ok(!(k in row), k);
  });
  test('agent label: nonempty string cut to 240 UTF-16 units, else null; canAllow stored', () => {
    const { inbox } = mk();
    inbox.receive(req({ agent: 'x'.repeat(300), canAllow: false }));
    inbox.receive(req({ agent: '' }));
    inbox.receive(req({ agent: 42 }));
    inbox.receive(req({ agent: 'helper' }));
    const l = inbox.list();
    assert.equal(l[0].agent, 'x'.repeat(240)); assert.equal(l[0].canAllow, false);
    assert.equal(l[1].agent, null); assert.equal(l[2].agent, null); assert.equal(l[3].agent, 'helper');
  });
  test('guards return false without audit or onChange', () => {
    const { inbox, state } = mk();
    assert.equal(inbox.receive(req({ nativeId: null })), false);
    assert.equal(inbox.receive(req({ nativeId: undefined })), false);
    assert.equal(inbox.receive(req({ turnId: '' })), false);
    assert.equal(inbox.receive(req({ turnId: 't-old' })), false);
    assert.equal(inbox.receive(req({ details: undefined })), false);
    assert.equal(inbox.receive(req({ details: () => 1 })), false);
    assert.equal(inbox.receive(req({ details: 'a'.repeat(199999) })), false, '200001 units rejected');
    assert.equal(state.audits.length, 0); assert.equal(state.changes, 0);
    assert.equal(inbox.receive(req({ details: 'a'.repeat(199998) })), true, 'exactly 200000 units accepted');
    assert.equal(inbox.receive(req({ nativeId: 0 })), true, 'nativeId 0 is not null/undefined');
  });
  test('circular details throws TypeError before audit', () => {
    const { inbox, state } = mk();
    const d = {}; d.self = d;
    assert.throws(() => inbox.receive(req({ details: d })), TypeError);
    assert.equal(state.audits.length, 0); assert.deepEqual(inbox.list(), []);
  });
  test('20-card cap', () => {
    const { inbox, state } = mk();
    for (let i = 0; i < 20; i++) assert.equal(inbox.receive(req()), true);
    assert.equal(inbox.receive(req()), false);
    assert.equal(state.audits.length, 20); assert.equal(inbox.list().length, 20);
  });
  test('same nativeId pending: identical fingerprint true (no audit/notify), changed false; canAllow/agent not fingerprinted', () => {
    const { inbox, state } = mk();
    const r = req();
    inbox.receive(r);
    assert.equal(inbox.receive({ ...r, canAllow: false, agent: 'other' }), true);
    assert.equal(inbox.receive({ ...r, title: 'Different?' }), false);
    assert.equal(inbox.receive({ ...r, details: { command: 'rm -rf x' } }), false);
    assert.equal(state.audits.length, 1); assert.equal(state.changes, 1); assert.equal(inbox.list().length, 1);
  });
  test('fingerprint covers UTF-8 of compact JSON', () => {
    const { inbox, state } = mk();
    const r = req({ title: 'Ünïcode 😀', details: { s: '中文' } });
    inbox.receive(r);
    assert.equal(state.audits[0].fingerprint, fp(r));
    assert.match(state.audits[0].fingerprint, /^[0-9a-f]{64}$/);
  });
  test('closed inbox (after clear) refuses', () => {
    const { inbox, state } = mk();
    inbox.clear();
    assert.equal(inbox.receive(req()), false);
    assert.equal(state.audits.length, 0);
  });
});

describe('ApprovalInbox.receive fail-every-step', () => {
  test('step 2 audit throws: false, no row, no onChange; restart empty', async () => {
    const file = path.join(tmpDir('br-inbox-'), 'a.jsonl');
    const { inbox, state } = mk({ audit: failing(approvalAudit(file)) });
    assert.equal(inbox.receive(req()), false);
    assert.deepEqual(inbox.list(), []); assert.equal(state.changes, 0);
    assert.equal(lines(file), '');
    await assertRestart(file, []);
  });
  test('step 2 real fsync failure: false, no row; restart empty', async () => {
    const file = path.join(tmpDir('br-inbox-'), 'a.jsonl');
    const { inbox, state } = mk({ audit: approvalAudit(file) });
    const w = fdWatch(file, { fsyncImpl: () => { throw eio('fsync'); } });
    try { assert.equal(inbox.receive(req()), false); } finally { w.restore(); }
    assert.deepEqual(inbox.list(), []); assert.equal(state.changes, 0);
    await assertRestart(file, []);
  });
  test('step 4 onChange throws: receive throws, row remains, audit row exists; restart empty', async () => {
    const file = path.join(tmpDir('br-inbox-'), 'a.jsonl');
    const { inbox } = mk({ audit: approvalAudit(file), onChange: () => { throw new Error('publish failed'); } });
    assert.throws(() => inbox.receive(req()), /publish failed/);
    const l = inbox.list();
    assert.equal(l.length, 1);
    const rows = completeRows(file);
    assert.equal(rows.length, 1); assert.equal(rows[0].event, 'requested'); assert.equal(rows[0].requestId, l[0].id);
    await assertRestart(file, [l[0].id]);
  });
});

// ---------------------------------------------------------------- autoAllow
describe('ApprovalInbox.autoAllow', () => {
  test('audits, remembers, writes in a microtask, returns true; no card, no onChange', async () => {
    const { inbox, state } = mk();
    const r = req({ rule: 'Bash(ls:*)', tool: 'Bash' });
    assert.equal(inbox.autoAllow(r), true);
    assert.equal(state.writes.length, 0, 'write is not synchronous');
    assert.equal(state.audits.length, 1);
    const a = state.audits[0];
    assert.match(a.requestId, UUID);
    assert.deepEqual(a, { event: 'auto-allowed', sessionId: 'sess-1', turnId: 't1', requestId: a.requestId, kind: 'command', tool: 'Bash', fingerprint: fp(r), decision: 'allow', source: 'auto-trusted', rule: 'Bash(ls:*)' });
    await tick();
    assert.deepEqual(state.writes, [[r.nativeId, r.allow]]);
    assert.deepEqual(inbox.list(), []); assert.equal(state.changes, 0);
  });
  test('repeat nativeId returns true without new audit or write', async () => {
    const { inbox, state } = mk();
    const r = req({ rule: 'WebSearch', tool: 'WebSearch' });
    inbox.autoAllow(r); await tick();
    assert.equal(inbox.autoAllow(r), true); await tick();
    assert.equal(state.audits.length, 1); assert.equal(state.writes.length, 1);
  });
  test('guards return false without audit or write', async () => {
    const { inbox, state } = mk();
    const base = { rule: 'Bash(ls)', tool: 'Bash' };
    assert.equal(inbox.autoAllow(req({ ...base, nativeId: null })), false);
    assert.equal(inbox.autoAllow(req({ ...base, turnId: '' })), false);
    assert.equal(inbox.autoAllow(req({ ...base, turnId: 'other' })), false);
    assert.equal(inbox.autoAllow(req({ ...base, rule: '' })), false);
    assert.equal(inbox.autoAllow(req({ ...base, details: undefined })), false);
    assert.equal(inbox.autoAllow(req({ ...base, details: 'a'.repeat(199999) })), false);
    const pend = req(); inbox.receive(pend);
    const audits = state.audits.length;
    assert.equal(inbox.autoAllow({ ...pend, ...base }), false, 'pending card with same nativeId');
    inbox.clear();
    assert.equal(inbox.autoAllow(req(base)), false, 'closed');
    await tick();
    assert.equal(state.audits.length, audits); assert.equal(state.writes.length, 0);
  });
  test('step 2 audit failure: false, not remembered, no write; later retry audits again', async () => {
    let fail = true;
    const { inbox, state } = mk({ audit: rec => { if (fail) throw eio('audit'); state.audits.push(rec); } });
    const r = req({ rule: 'Bash(ls)', tool: 'Bash' });
    assert.equal(inbox.autoAllow(r), false); await tick();
    assert.equal(state.writes.length, 0);
    fail = false;
    assert.equal(inbox.autoAllow(r), true); await tick();
    assert.equal(state.audits.length, 1); assert.equal(state.writes.length, 1);
  });
  test('step 5 write rejection calls onAutoError(error,{tool,rule}); no card', async () => {
    const boom = new Error('pipe closed');
    const { inbox, state } = mk({ write: async () => { throw boom; } });
    assert.equal(inbox.autoAllow(req({ rule: 'mcp__srv__*', tool: 'mcp__srv__read' })), true);
    await until(() => state.autoErrors.length > 0, 1000, 5);
    assert.equal(state.autoErrors.length, 1);
    assert.equal(state.autoErrors[0][0], boom);
    assert.deepEqual(state.autoErrors[0][1], { tool: 'mcp__srv__read', rule: 'mcp__srv__*' });
    assert.deepEqual(inbox.list(), []);
  });
  test('synchronous write throw is also routed to onAutoError', async () => {
    const { inbox, state } = mk({ write: () => { throw new Error('sync'); } });
    assert.equal(inbox.autoAllow(req({ rule: 'WebSearch', tool: 'WebSearch' })), true);
    await until(() => state.autoErrors.length > 0, 1000, 5);
    assert.equal(state.autoErrors.length, 1);
  });
  test('remembered set is FIFO capped at 500', async () => {
    const { inbox, state } = mk();
    const ids = [];
    for (let i = 0; i < 501; i++) { const r = req({ rule: 'WebSearch', tool: 'WebSearch' }); ids.push(r); inbox.autoAllow(r); }
    await tick();
    assert.equal(state.audits.length, 501);
    assert.equal(inbox.autoAllow(ids[500]), true); assert.equal(state.audits.length, 501, 'newest still remembered');
    assert.equal(inbox.autoAllow(ids[0]), true); assert.equal(state.audits.length, 502, 'oldest evicted, audited again');
  });
  test('restart after auto-allow: audit line stays, no replay', async () => {
    const file = path.join(tmpDir('br-auto-'), 'a.jsonl');
    const { inbox } = mk({ audit: approvalAudit(file) });
    inbox.autoAllow(req({ rule: 'WebSearch', tool: 'WebSearch' })); await tick();
    assert.equal(completeRows(file)[0].event, 'auto-allowed');
    await assertRestart(file, []);
  });
  // Deliberate: failed transport is uncertain, never permission to retry an Allow (a failed write means the pipe is gone).
  test('a failed automatic Allow is reported to onAutoError and never retried', async () => {
    let fail = true;
    const { inbox, state } = mk({ write: async (id, resp) => { if (fail) throw new Error('pipe gone'); state.writes.push([id, resp]); } });
    const r = req({ rule: 'Bash(ls)', tool: 'Bash' });
    assert.equal(inbox.autoAllow(r), true);
    await until(() => state.autoErrors.length > 0, 1000, 5);
    assert.equal(state.autoErrors.length, 1);
    assert.equal(state.autoErrors[0][0].message, 'pipe gone');
    assert.deepEqual(state.autoErrors[0][1], { tool: 'Bash', rule: 'Bash(ls)' });
    fail = false;
    assert.equal(inbox.autoAllow(r), true, 'the same request is already answered');
    await tick();
    assert.equal(state.writes.length, 0, 'no second Allow is written');
    assert.deepEqual(inbox.list(), [], 'and no card is opened for it');
    assert.equal(state.audits.length, 1, 'and nothing more is recorded');
  });
});

// ---------------------------------------------------------------- decide
describe('ApprovalInbox.decide contract', () => {
  test('allow: audit before write, sending visible, resolves {ok,decision}, duplicate/conflict', async () => {
    const file = path.join(tmpDir('br-decide-'), 'a.jsonl');
    const seen = [];
    let inboxRef;
    const { inbox, state } = mk({
      audit: approvalAudit(file),
      write: async (id, resp) => { seen.push({ id, resp, statuses: inboxRef.list().map(x => x.status), rows: completeRows(file).map(x => x.event) }); },
    });
    inboxRef = inbox;
    const r = req();
    inbox.receive(r);
    const id = inbox.list()[0].id;
    const changesBefore = state.changes;
    assert.deepEqual(await inbox.decide(id, 'allow'), { ok: true, decision: 'allow' });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].id, r.nativeId); assert.deepEqual(seen[0].resp, r.allow);
    assert.deepEqual(seen[0].statuses, ['sending']);
    assert.deepEqual(seen[0].rows, ['requested', 'decision'], 'decision durable before native write');
    assert.equal(state.changes - changesBefore, 2, 'onChange at sending and after success');
    const dec = completeRows(file)[1];
    assert.match(dec.at, ISO);
    assert.deepEqual({ ...dec, at: undefined }, { at: undefined, event: 'decision', sessionId: 'sess-1', turnId: 't1', requestId: id, kind: 'command', fingerprint: fp(r), decision: 'allow' });
    assert.deepEqual(inbox.list(), []);
    assert.deepEqual(await inbox.decide(id, 'allow'), { ok: true, duplicate: true });
    await rejectsWith(() => inbox.decide(id, 'deny'), 'This action was already answered differently.', 409);
    assert.equal(seen.length, 1);
    await assertRestart(file, [id]);
  });
  test('deny sends the deny response', async () => {
    const { inbox, state } = mk();
    const r = req({ canAllow: false }); inbox.receive(r);
    assert.deepEqual(await inbox.decide(inbox.list()[0].id, 'deny'), { ok: true, decision: 'deny' });
    assert.deepEqual(state.writes, [[r.nativeId, r.deny]]);
  });
  test('validation: bad decision 400 (checked first), missing 409, canAllow false 400', async () => {
    const { inbox, state } = mk();
    for (const d of ['Allow', 'yes', undefined, '']) await rejectsWith(() => inbox.decide('nope', d), "Choose Allow or Don't allow.", 400);
    await rejectsWith(() => inbox.decide('nope', 'allow'), NOT_WAITING, 409);
    inbox.receive(req({ canAllow: false }));
    const id = inbox.list()[0].id;
    const audits = state.audits.length;
    await rejectsWith(() => inbox.decide(id, 'allow'), 'This request cannot be approved safely here. Deny it and ask for a supported action.', 400);
    assert.equal(state.audits.length, audits); assert.equal(inbox.list()[0].status, 'pending');
  });
  test('old turn and closed inbox: 409 no longer waiting, no audit', async () => {
    const { inbox, state } = mk();
    inbox.receive(req()); const id = inbox.list()[0].id;
    state.turn = 't2';
    await rejectsWith(() => inbox.decide(id, 'allow'), NOT_WAITING, 409);
    state.turn = 't1';
    inbox.clear();
    await rejectsWith(() => inbox.decide(id, 'allow'), NOT_WAITING, 409);
    assert.equal(state.audits.length, 1); assert.equal(state.writes.length, 0);
  });
  test('answered map survives clear: duplicate still reported', async () => {
    const { inbox } = mk();
    inbox.receive(req()); const id = inbox.list()[0].id;
    await inbox.decide(id, 'deny');
    inbox.clear();
    assert.deepEqual(await inbox.decide(id, 'deny'), { ok: true, duplicate: true });
  });
  test('answered FIFO cap 200', async () => {
    const { inbox } = mk();
    const ids = [];
    for (let i = 0; i < 201; i++) { inbox.receive(req()); const id = inbox.list()[0].id; ids.push(id); await inbox.decide(id, 'allow'); }
    assert.deepEqual(await inbox.decide(ids[1], 'allow'), { ok: true, duplicate: true });
    await rejectsWith(() => inbox.decide(ids[0], 'allow'), NOT_WAITING, 409);
  });
  test('audit and request details: no command, title text or secret in audit bytes', async () => {
    const file = path.join(tmpDir('br-secret-'), 'a.jsonl');
    const { inbox } = mk({ audit: approvalAudit(file) });
    const secret = 'sk-FAKE-not-a-real-key-000';
    inbox.receive(req({ title: 'Run curl with token?', details: { command: `curl -H "Authorization: ${secret}" x` } }));
    await inbox.decide(inbox.list()[0].id, 'allow');
    inbox.autoAllow(req({ rule: 'Bash(echo:*)', tool: 'Bash', details: { command: `echo ${secret}` } }));
    await tick();
    const raw = lines(file);
    assert.equal(completeRows(file).length, 3);
    for (const bad of [secret, 'curl', 'Authorization', 'echo ', 'Run curl']) assert.ok(!raw.includes(bad), bad);
  });
});

describe('ApprovalInbox.decide fail-every-step', () => {
  test('step 2 decision audit fails: 503, row stays pending, no write; retry succeeds', async () => {
    const file = path.join(tmpDir('br-decide-'), 'a.jsonl');
    const real = approvalAudit(file);
    let fail = false;
    const { inbox, state } = mk({ audit: rec => { if (fail) throw eio('disk'); real(rec); } });
    inbox.receive(req()); const id = inbox.list()[0].id;
    const snap = snapshot(file);
    fail = true;
    await rejectsWith(() => inbox.decide(id, 'allow'), NO_RECORD, 503);
    assert.equal(inbox.list()[0].status, 'pending'); assert.equal(state.writes.length, 0);
    assert.ok(unchanged(file, snap));
    await assertRestart(file, [id]);
    fail = false;
    assert.deepEqual(await inbox.decide(id, 'allow'), { ok: true, decision: 'allow' });
    assert.equal(state.writes.length, 1);
  });
  for (const step of ['open', 'write', 'fsync', 'close']) {
    test(`step 2 real audit ${step} failure: 503 and no native write`, async () => {
      const file = path.join(tmpDir('br-decide-'), 'a.jsonl');
      const { inbox, state } = mk({ audit: approvalAudit(file) });
      inbox.receive(req()); const id = inbox.list()[0].id;
      let w, r;
      if (step === 'open') {
        const realOpen = fs.openSync;
        r = patch(fs, 'openSync', (...a) => { if (path.resolve(String(a[0])) === path.resolve(file)) throw eio('open'); return realOpen.apply(fs, a); });
      } else {
        w = fdWatch(file, {
          writeImpl: step === 'write' ? () => { throw eio('w'); } : undefined,
          fsyncImpl: step === 'fsync' ? () => { throw eio('f'); } : undefined,
          closeImpl: step === 'close' ? (real, fd) => { real.call(fs, fd); throw eio('c'); } : undefined,
        });
      }
      try { await rejectsWith(() => inbox.decide(id, 'allow'), NO_RECORD, 503); } finally { if (w) w.restore(); if (r) r(); }
      assert.equal(state.writes.length, 0);
      assert.equal(inbox.list()[0].status, 'pending');
      if (w) assert.equal(w.closed.length, w.opened.length, 'fd closed');
      await assertRestart(file, [id]);
    });
  }
  test('step 4 onChange throws at sending: rejects, stays sending, no write; next decide 409 already sent', async () => {
    let n = 0;
    const { inbox, state } = mk({ onChange: () => { n += 1; if (n === 2) throw new Error('publish failed'); } });
    inbox.receive(req()); const id = inbox.list()[0].id;
    await assert.rejects(async () => inbox.decide(id, 'allow'), /publish failed/);
    assert.equal(inbox.list()[0].status, 'sending'); assert.equal(state.writes.length, 0);
    await rejectsWith(() => inbox.decide(id, 'allow'), ALREADY_SENT, 409);
  });
  test('step 5 write rejects: uncertain + 503; no retry accepted; restart', async () => {
    const file = path.join(tmpDir('br-decide-'), 'a.jsonl');
    let calls = 0;
    const { inbox, state } = mk({ audit: approvalAudit(file), write: async () => { calls += 1; throw new Error('stdin closed'); } });
    inbox.receive(req()); const id = inbox.list()[0].id;
    const changes = state.changes;
    await rejectsWith(() => inbox.decide(id, 'allow'), UNCERTAIN, 503);
    assert.equal(inbox.list()[0].status, 'uncertain');
    assert.equal(state.changes - changes, 2, 'onChange at sending and at uncertain');
    await rejectsWith(() => inbox.decide(id, 'allow'), ALREADY_SENT, 409);
    await rejectsWith(() => inbox.decide(id, 'deny'), ALREADY_SENT, 409);
    assert.equal(calls, 1);
    assert.deepEqual(completeRows(file).map(x => x.event), ['requested', 'decision']);
    await assertRestart(file, [id]);
  });
  test('step 7 onChange throws after delivery: rejects, but decision is answered', async () => {
    let n = 0;
    const { inbox, state } = mk({ onChange: () => { n += 1; if (n === 3) throw new Error('publish after'); } });
    inbox.receive(req()); const id = inbox.list()[0].id;
    await assert.rejects(async () => inbox.decide(id, 'allow'), /publish after/);
    assert.equal(state.writes.length, 1); assert.deepEqual(inbox.list(), []);
    assert.deepEqual(await inbox.decide(id, 'allow'), { ok: true, duplicate: true });
  });
});

describe('ApprovalInbox concurrency, resolve, clear', () => {
  test('overlapping decide on one id: only one write; second gets 409 while first pending', async () => {
    const d = deferred(); let calls = 0;
    const { inbox } = mk({ write: () => { calls += 1; return d.p; } });
    inbox.receive(req()); const id = inbox.list()[0].id;
    const p1 = inbox.decide(id, 'allow');
    await rejectsWith(() => inbox.decide(id, 'allow'), ALREADY_SENT, 409);
    await rejectsWith(() => inbox.decide(id, 'deny'), ALREADY_SENT, 409);
    d.resolve();
    assert.deepEqual(await p1, { ok: true, decision: 'allow' });
    assert.equal(calls, 1);
  });
  test('resolve during pending decide removes card but cannot cancel the write', async () => {
    const d = deferred(); let calls = 0;
    const { inbox, state } = mk({ write: () => { calls += 1; return d.p; } });
    const r = req(); inbox.receive(r); const id = inbox.list()[0].id;
    const p = inbox.decide(id, 'allow');
    await tick();
    const before = state.changes;
    assert.equal(inbox.resolve(r.nativeId), undefined);
    assert.deepEqual(inbox.list(), []); assert.equal(state.changes - before, 1);
    d.resolve();
    await p.catch(() => {});
    assert.equal(calls, 1);
  });
  test('clear during pending decide: card gone, write already invoked', async () => {
    const d = deferred(); let calls = 0;
    const { inbox } = mk({ write: () => { calls += 1; return d.p; } });
    inbox.receive(req()); const id = inbox.list()[0].id;
    const p = inbox.decide(id, 'deny');
    await tick();
    inbox.clear();
    assert.deepEqual(inbox.list(), []);
    d.resolve(); await p.catch(() => {});
    assert.equal(calls, 1);
  });
  test('resolve: deletes rows for nativeId, onChange once even if none, no audit', () => {
    const { inbox, state } = mk();
    const a = req(), b = req();
    inbox.receive(a); inbox.receive(b);
    const audits = state.audits.length, ch = state.changes;
    assert.equal(inbox.resolve(a.nativeId), undefined);
    assert.deepEqual(inbox.list().map(x => x.title).length, 1);
    assert.equal(inbox.resolve('missing'), undefined);
    assert.equal(state.changes - ch, 2); assert.equal(state.audits.length, audits); assert.equal(state.writes.length, 0);
  });
  test('clear: closes, empties, onChange once, returns undefined', () => {
    const { inbox, state } = mk();
    inbox.receive(req()); inbox.receive(req());
    const ch = state.changes;
    assert.equal(inbox.clear(), undefined);
    assert.deepEqual(inbox.list(), []); assert.equal(state.changes - ch, 1);
  });
  test('resolve/clear with a throwing onChange still leave deleted/closed state', () => {
    const { inbox } = mk({ onChange: failing(() => {}, { on: [3, 4] }) });
    const a = req(); inbox.receive(a); inbox.receive(req());
    assert.throws(() => inbox.resolve(a.nativeId));
    assert.equal(inbox.list().length, 1);
    assert.throws(() => inbox.clear());
    assert.deepEqual(inbox.list(), []);
    assert.equal(inbox.receive(req()), false, 'closed');
  });
});

// ---------------------------------------------------------------- codexApproval
describe('codexApproval', () => {
  const turn = { threadId: 'th1', turnId: 'tu1', cwd: '/tmp/work', approvalItems: new Map([['it1', { changes: [{ path: 'a.txt' }] }], ['it2', { changes: [] }]]) };
  const R = (method, p, id = 7) => ({ id, method, params: { threadId: 'th1', turnId: 'tu1', ...p } });
  test('ID guards and unknown methods return null', () => {
    assert.equal(codexApproval(R('item/commandExecution/requestApproval', { command: 'ls', threadId: 'th2' }), turn), null);
    assert.equal(codexApproval(R('item/commandExecution/requestApproval', { command: 'ls', turnId: '' }), turn), null);
    assert.equal(codexApproval(R('item/commandExecution/requestApproval', { command: 'ls', turnId: 'tu2' }), turn), null);
    assert.equal(codexApproval(R('item/other/requestApproval', { command: 'ls' }), turn), null);
  });
  test('command request', () => {
    const a = codexApproval(R('item/commandExecution/requestApproval', { command: 'ls', cwd: '/w', reason: 'why' }), turn);
    assert.equal(a.nativeId, 7); assert.equal(a.turnId, 'tu1');
    assert.equal(a.kind, 'command'); assert.equal(a.title, 'Run this command?');
    assert.deepEqual(a.allow, { decision: 'accept' }); assert.deepEqual(a.deny, { decision: 'decline' });
    assert.equal(a.details.command, 'ls'); assert.equal(a.details.cwd, '/w'); assert.equal(a.details.reason, 'why'); assert.equal(a.details.kind, 'command');
    assert.equal(a.canAllow, true);
  });
  test('command canAllow rules and network kind', () => {
    const m = 'item/commandExecution/requestApproval';
    assert.equal(codexApproval(R(m, { command: '' }), turn).canAllow, false);
    assert.equal(codexApproval(R(m, { command: 'ls', availableDecisions: ['decline'] }), turn).canAllow, false);
    assert.equal(codexApproval(R(m, { command: 'ls', availableDecisions: ['accept', 'decline'] }), turn).canAllow, true);
    const n = codexApproval(R(m, { networkApprovalContext: { host: 'example.test' } }), turn);
    assert.equal(n.kind, 'network'); assert.equal(n.title, 'Allow network access?'); assert.equal(n.canAllow, true);
    assert.equal(codexApproval(R(m, { command: 'ls', kind: 'custom' }), turn).details.kind, 'custom');
  });
  test('file change request', () => {
    const m = 'item/fileChange/requestApproval';
    const a = codexApproval(R(m, { itemId: 'it1', reason: 'edit' }), turn);
    assert.equal(a.kind, 'fileChange'); assert.equal(a.title, 'Apply these file changes?');
    assert.equal(a.details.cwd, '/tmp/work'); assert.deepEqual(a.details.changes, [{ path: 'a.txt' }]); assert.equal(a.details.reason, 'edit');
    assert.equal(a.canAllow, true);
    assert.deepEqual(a.allow, { decision: 'accept' }); assert.deepEqual(a.deny, { decision: 'decline' });
    assert.equal(codexApproval(R(m, { itemId: 'it1', grantRoot: '/' }), turn).canAllow, false);
    assert.equal(codexApproval(R(m, { itemId: 'it2' }), turn).canAllow, false);
    assert.equal(codexApproval(R(m, { itemId: 'missing' }), turn).canAllow, false);
  });
  test('permissions request', () => {
    const m = 'item/permissions/requestApproval';
    const perms = { network: true };
    const a = codexApproval(R(m, { permissions: perms, cwd: '/c', reason: 'r' }), turn);
    assert.equal(a.kind, 'permissions'); assert.equal(a.title, 'Allow access for this reply?');
    assert.deepEqual(a.allow, { permissions: perms, scope: 'turn' }); assert.deepEqual(a.deny, { permissions: {}, scope: 'turn' });
    assert.equal(a.details.cwd, '/c'); assert.deepEqual(a.details.permissions, perms); assert.equal(a.canAllow, true);
    assert.equal(codexApproval(R(m, { permissions: [] }), turn).canAllow, false);
    assert.equal(codexApproval(R(m, { permissions: null }), turn).canAllow, false);
  });
  test('result registers in an inbox on the same turn', () => {
    const a = codexApproval(R('item/commandExecution/requestApproval', { command: 'ls' }, 99), turn);
    const { inbox, state } = mk(); state.turn = 'tu1';
    assert.equal(inbox.receive(a), true);
    assert.equal(inbox.list()[0].kind, 'command');
  });
});

// ---------------------------------------------------------------- AccessVerifier
const TEAM = 'acme-test', AUD = 'aud-0123456789', ISS = `https://${TEAM}.cloudflareaccess.com`;
const CERTS = `${ISS}/cdn-cgi/access/certs`;
const kp1 = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const kp2 = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk1 = { ...kp1.publicKey.export({ format: 'jwk' }), kid: 'kid-one', alg: 'RS256', use: 'sig' };
const jwk2 = { ...kp2.publicKey.export({ format: 'jwk' }), kid: 'kid-two', alg: 'RS256', use: 'sig' };
const b64u = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function jwt(payload, { header = { alg: 'RS256', kid: 'kid-one', typ: 'JWT' }, key = kp1.privateKey } = {}) {
  const h = b64u(header), p = b64u(payload);
  return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url')}`;
}
function fetcher(keysFn = () => [jwk1]) {
  const f = async (url, opts) => {
    f.calls.push({ url, opts });
    if (f.impl) return f.impl(url, opts);
    return { ok: true, status: 200, json: async () => ({ keys: keysFn() }) };
  };
  f.calls = []; f.impl = null; return f;
}
function mkV(over = {}) {
  const clock = fakeClock(Date.parse('2026-03-01T12:00:00Z'));
  const f = fetcher(over.keysFn);
  const logs = [];
  const v = new AccessVerifier({ team: TEAM, aud: AUD, emails: ['User@Example.test'], fetchImpl: f, now: clock.now, log: m => logs.push(m), ...over.opts });
  const sec = () => Math.floor(clock.t / 1000);
  const payload = (o = {}) => ({ iss: ISS, aud: [AUD], exp: sec() + 600, nbf: sec() - 5, email: 'user@example.test', ...o });
  return { v, f, clock, logs, sec, payload };
}

describe('AccessVerifier constructor and on', () => {
  test('on requires valid team, aud and emails', () => {
    const on = o => new AccessVerifier({ team: TEAM, aud: AUD, emails: ['a@example.test'], fetchImpl: fetcher(), ...o }).on;
    assert.equal(on({}), true);
    assert.equal(on({ team: ' ACME-Test ' }), true);
    assert.equal(on({ team: 'a'.repeat(63) }), true);
    assert.equal(on({ team: 'a'.repeat(64) }), false);
    assert.equal(on({ team: 'acme.test' }), false);
    assert.equal(on({ team: 'acme_test' }), false);
    assert.equal(on({ team: '' }), false);
    assert.equal(on({ aud: '  ' }), false);
    assert.equal(on({ emails: [] }), false);
    assert.equal(on({ emails: ' , ,' }), false);
    assert.equal(on({ emails: 'a@example.test, b@example.test' }), true);
    assert.equal(new AccessVerifier().on, false);
  });
  test('verify when off returns {error:off} without fetching', async () => {
    const f = fetcher();
    const v = new AccessVerifier({ team: '', aud: AUD, emails: ['a@example.test'], fetchImpl: f });
    assert.deepEqual(await v.verify('a.b.c'), { error: 'off' });
    assert.equal(f.calls.length, 0);
  });
  test('team/emails normalised; default certs URL used; success shape', async () => {
    const clock = fakeClock(Date.parse('2026-03-01T12:00:00Z'));
    const f = fetcher();
    const v = new AccessVerifier({ team: '  ACME-TEST ', aud: ` ${AUD} `, emails: ' Other@Example.test ,USER@example.TEST, user@example.test', fetchImpl: f, now: clock.now });
    const s = Math.floor(clock.t / 1000);
    const r = await v.verify(jwt({ iss: ISS, aud: AUD, exp: s + 100, email: ' User@EXAMPLE.test ' }));
    assert.deepEqual(r, { email: 'user@example.test', exp: s + 100, through: true });
    assert.equal(f.calls[0].url, CERTS);
    assert.ok(f.calls[0].opts && f.calls[0].opts.signal instanceof AbortSignal);
  });
  test('certsUrl override is used', async () => {
    const f = fetcher();
    const v = new AccessVerifier({ team: TEAM, aud: AUD, emails: ['a@example.test'], certsUrl: 'http://127.0.0.1:9/fake-certs', fetchImpl: f });
    await v.loadKeys();
    assert.equal(f.calls[0].url, 'http://127.0.0.1:9/fake-certs');
  });
});

describe('AccessVerifier.verify', () => {
  test('malformed tokens', async () => {
    const { v, f } = mkV();
    const good = jwt({ a: 1 }); const [h, p, s] = good.split('.');
    for (const t of [undefined, null, '', 'abc', 'a.b', 'a.b.c.d', `${h}..${s}`, `${h}.${p}.${s}=`, `${h}.${p}.${s}+`,
      `${b64u('not json')}.${p}.${s}`, `${b64u('null')}.${p}.${s}`, `${b64u('5')}.${p}.${s}`, `${h}.${b64u('null')}.${s}`, `${h}.${b64u('"str"')}.${s}`]) {
      assert.deepEqual(await v.verify(t), { error: 'malformed' }, String(t).slice(0, 40));
    }
    assert.equal(f.calls.length, 0, 'no key fetch for malformed');
  });
  test('algorithm', async () => {
    const { v, payload } = mkV();
    assert.deepEqual(await v.verify(jwt(payload(), { header: { alg: 'HS256', kid: 'kid-one' } })), { error: 'algorithm' });
    assert.deepEqual(await v.verify(jwt(payload(), { header: { alg: 'RS256', kid: 7 } })), { error: 'algorithm' });
    assert.deepEqual(await v.verify(jwt(payload(), { header: { alg: 'RS256' } })), { error: 'algorithm' });
  });
  test('happy path and claim checks in order', async () => {
    const { v, payload, sec, logs } = mkV();
    const ok = await v.verify(jwt(payload()));
    assert.deepEqual(ok, { email: 'user@example.test', exp: sec() + 600, through: true });
    assert.deepEqual(await v.verify(jwt(payload({ iss: ISS + '/' }))), { error: 'issuer' });
    assert.deepEqual(await v.verify(jwt(payload({ aud: AUD }))).then(r => r.email), 'user@example.test');
    assert.deepEqual(await v.verify(jwt(payload({ aud: ['other', AUD] }))).then(r => r.email), 'user@example.test');
    assert.deepEqual(await v.verify(jwt(payload({ aud: ['other'] }))), { error: 'audience' });
    assert.deepEqual(await v.verify(jwt(payload({ aud: undefined }))), { error: 'audience' });
    assert.deepEqual(await v.verify(jwt(payload({ exp: sec() - 61 }))), { error: 'expired' });
    assert.equal((await v.verify(jwt(payload({ exp: sec() - 60 })))).email, 'user@example.test');
    assert.deepEqual(await v.verify(jwt(payload({ exp: undefined }))), { error: 'expired' });
    assert.deepEqual(await v.verify(jwt(payload({ exp: String(sec() + 100) }))), { error: 'expired' });
    assert.deepEqual(await v.verify(jwt(payload({ nbf: sec() + 61 }))), { error: 'not yet valid' });
    assert.equal((await v.verify(jwt(payload({ nbf: sec() + 60 })))).email, 'user@example.test');
    assert.equal((await v.verify(jwt(payload({ nbf: 'soon' })))).email, 'user@example.test', 'non-finite nbf ignored');
    assert.equal(logs.length, 0);
  });
  test('email checks return {error:email,through:true}', async () => {
    const { v, payload } = mkV();
    for (const email of [undefined, 42, 'ab', 'nobody@example.test', 'usér@example.test', 'user @example.test', 'x'.repeat(255)]) {
      assert.deepEqual(await v.verify(jwt(payload({ email }))), { error: 'email', through: true }, String(email).slice(0, 30));
    }
    assert.equal((await v.verify(jwt(payload({ email: '\tUSER@Example.Test ' })))).email, 'user@example.test');
  });
  test('signature: tampered payload or wrong key', async () => {
    const { v, payload } = mkV();
    const t = jwt(payload()); const [h, , s] = t.split('.');
    assert.deepEqual(await v.verify(`${h}.${b64u(payload({ email: 'other@example.test' }))}.${s}`), { error: 'signature' });
    assert.deepEqual(await v.verify(jwt(payload(), { key: kp2.privateKey })), { error: 'signature' });
    const forged = jwt(payload({ iss: 'https://evil.example.test' }), { key: kp2.privateKey });
    assert.deepEqual(await v.verify(forged), { error: 'signature' }, 'signature checked before claims; no through');
  });
  test('keys unavailable: logs message, returns {error:keys}; token not logged', async () => {
    const { v, f, logs, payload } = mkV();
    f.impl = async () => { throw new Error('connect refused'); };
    const t = jwt(payload());
    assert.deepEqual(await v.verify(t), { error: 'keys' });
    assert.deepEqual(logs, ['access: signing keys unavailable: connect refused']);
    assert.ok(!logs.join('').includes(t.split('.')[1]));
  });
  test('unknown kid: one forced refresh, rate limited to once per 60 s', async () => {
    const { v, f, clock, payload } = mkV();
    const t = jwt(payload(), { header: { alg: 'RS256', kid: 'kid-two' }, key: kp2.privateKey });
    assert.deepEqual(await v.verify(t), { error: 'unknown key' });
    assert.equal(f.calls.length, 2, 'initial load + forced refresh');
    assert.deepEqual(await v.verify(t), { error: 'unknown key' });
    assert.equal(f.calls.length, 2, 'no refresh within 60 s');
    clock.advance(60001);
    assert.deepEqual(await v.verify(t), { error: 'unknown key' });
    assert.equal(f.calls.length, 3);
  });
  test('unknown kid that appears after refresh verifies', async () => {
    let keys = [jwk1];
    const { v, f, payload } = mkV({ keysFn: () => keys });
    await v.loadKeys();
    keys = [jwk1, jwk2];
    const r = await v.verify(jwt(payload(), { header: { alg: 'RS256', kid: 'kid-two' }, key: kp2.privateKey }));
    assert.equal(r.email, 'user@example.test');
    assert.equal(f.calls.length, 2);
  });
  test('forced refresh failure is swallowed -> unknown key', async () => {
    const { v, f, payload } = mkV();
    await v.loadKeys();
    f.impl = async () => ({ ok: false, status: 500, json: async () => ({}) });
    assert.deepEqual(await v.verify(jwt(payload(), { header: { alg: 'RS256', kid: 'nope' } })), { error: 'unknown key' });
    assert.equal((await v.verify(jwt(payload()))).email, 'user@example.test', 'cached key still usable');
  });
  test('fetch timeout (5 s real) -> {error:keys}', async () => {
    const { v, f, logs, payload } = mkV();
    f.impl = (url, { signal }) => new Promise((res, rej) => {
      if (signal.aborted) return rej(signal.reason);
      signal.addEventListener('abort', () => rej(signal.reason), { once: true });
    });
    const t0 = Date.now();
    const keepAlive = setTimeout(() => {}, 15000); // AbortSignal.timeout timers are unref'd
    let r;
    try { r = await v.verify(jwt(payload())); } finally { clearTimeout(keepAlive); }
    assert.deepEqual(r, { error: 'keys' });
    const dt = Date.now() - t0;
    assert.ok(dt >= 4500 && dt < 15000, `timeout took ${dt} ms`);
    assert.equal(logs.length, 1); assert.ok(logs[0].startsWith('access: signing keys unavailable: '));
  });
});

describe('AccessVerifier.loadKeys fail-every-step and cache', () => {
  test('cache: no fetch while age < refreshMs; refetch at refreshMs', async () => {
    const { v, f, clock } = mkV({ opts: { refreshMs: 10000 } });
    assert.equal(await v.loadKeys(), undefined);
    clock.advance(9999); await v.loadKeys();
    assert.equal(f.calls.length, 1);
    clock.advance(1); await v.loadKeys();
    assert.equal(f.calls.length, 2);
    await v.loadKeys(true);
    assert.equal(f.calls.length, 3, 'force bypasses cache');
  });
  test('overlapping loads share one fetch', async () => {
    const { v, f } = mkV();
    const d = deferred();
    f.impl = () => d.p;
    const p1 = v.loadKeys(), p2 = v.loadKeys(), p3 = v.loadKeys(true);
    await tick();
    assert.equal(f.calls.length, 1);
    d.resolve({ ok: true, status: 200, json: async () => ({ keys: [jwk1] }) });
    await Promise.all([p1, p2, p3]);
    assert.equal(f.calls.length, 1);
  });
  const failures = {
    'fetch rejects': [async () => { throw new Error('net down'); }, 'net down'],
    'HTTP status': [async () => ({ ok: false, status: 503, json: async () => ({ keys: [jwk1] }) }), 'certs HTTP 503'],
    'JSON parse': [async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }), 'bad json'],
    'no usable JWK': [async () => ({ ok: true, status: 200, json: async () => ({ keys: [{ kid: 'e', kty: 'EC', crv: 'P-256', x: 'a', y: 'b' }, { kid: 'bad', kty: 'RSA', e: 'AQAB' }, { kty: 'RSA', n: jwk1.n, e: jwk1.e }] }) }), 'no signing keys'],
    'empty body': [async () => ({ ok: true, status: 200, json: async () => null }), 'no signing keys'],
  };
  for (const [name, [impl, msg]] of Object.entries(failures)) {
    test(`no cache + ${name}: rejects with underlying error, then 60 s cooldown, then refetch; restart refetches`, async () => {
      const { v, f, clock } = mkV();
      f.impl = impl;
      await assert.rejects(v.loadKeys(), e => e.message === msg);
      assert.equal(f.calls.length, 1);
      clock.advance(59000);
      await assert.rejects(v.loadKeys(), e => e.message === 'signing keys unavailable');
      assert.equal(f.calls.length, 1, 'no fetch during cooldown');
      clock.advance(1001);
      f.impl = null;
      await v.loadKeys();
      assert.equal(f.calls.length, 2);
      const v2 = new AccessVerifier({ team: TEAM, aud: AUD, emails: ['a@example.test'], fetchImpl: f, now: clock.now });
      await v2.loadKeys();
      assert.equal(f.calls.length, 3, 'restart has an empty cache');
    });
  }
  test('bad individual JWKs are skipped when a good one exists', async () => {
    const { v, payload } = mkV({ keysFn: () => [{ kid: 'bad', kty: 'RSA', e: 'AQAB' }, { kid: 'k', kty: 'EC' }, jwk1] });
    assert.equal((await v.verify(jwt(payload()))).email, 'user@example.test');
  });
  test('stale cache (<24h) survives a failure; cooldown; then too old', async () => {
    const { v, f, clock, payload } = mkV({ opts: { refreshMs: 1000 } });
    await v.loadKeys();
    clock.advance(86399000);
    f.impl = async () => { throw new Error('down'); };
    assert.equal(await v.loadKeys(), undefined, 'failure swallowed with young-enough keys');
    assert.equal((await v.verify(jwt(payload()))).email, 'user@example.test');
    const calls = f.calls.length;
    clock.advance(2000);
    await assert.rejects(v.loadKeys(), e => e.message === 'signing keys too old');
    assert.equal(f.calls.length, calls, 'no fetch during cooldown');
  });
  test('cache older than 24h + failure: rejects with the underlying error', async () => {
    const { v, f, clock } = mkV({ opts: { refreshMs: 1000 } });
    await v.loadKeys();
    clock.advance(86400001);
    f.impl = async () => ({ ok: false, status: 502, json: async () => ({}) });
    await assert.rejects(v.loadKeys(), e => e.message === 'certs HTTP 502');
  });
  test('success atomically replaces the key map', async () => {
    let keys = [jwk1];
    const { v, clock, payload } = mkV({ keysFn: () => keys, opts: { refreshMs: 1000 } });
    assert.equal((await v.verify(jwt(payload()))).email, 'user@example.test');
    keys = [jwk2];
    clock.advance(61000);
    assert.deepEqual(await v.verify(jwt(payload())), { error: 'unknown key' }, 'old kid gone after replace');
  });
  test('a failed refresh does not partially replace the map', async () => {
    const { v, f, clock, payload } = mkV({ opts: { refreshMs: 1000 } });
    await v.loadKeys();
    clock.advance(2000);
    f.impl = async () => ({ ok: true, status: 200, json: async () => ({ keys: [{ kid: 'kid-one', kty: 'RSA', e: 'AQAB' }] }) });
    await v.loadKeys();
    assert.equal((await v.verify(jwt(payload()))).email, 'user@example.test');
  });
});

// ---------------------------------------------------------------- trusted.mjs
describe('commandWords', () => {
  test('spec examples', () => {
    assert.deepEqual(commandWords('acme "two words"'), ['acme', '"two words"']);
    assert.notDeepEqual(commandWords('"acme" x'), commandWords('acme x'));
    assert.deepEqual(commandWords('"acme" x'), ['"acme"', 'x']);
    assert.deepEqual(commandWords('acme x#y'), ['acme', 'x#y']);
    assert.equal(commandWords('acme #y'), null);
    assert.deepEqual(commandWords('acme x\ty'), ['acme', 'x', 'y']);
    assert.deepEqual(commandWords("  acme   'a b'  c "), ['acme', "'a b'", 'c']);
  });
  test('type, empty and length bounds', () => {
    for (const v of [null, undefined, 5, {}, ['ls'], '', '   ', '\t']) assert.equal(commandWords(v), null);
    assert.deepEqual(commandWords('a'.repeat(4000)), ['a'.repeat(4000)]);
    assert.equal(commandWords('a'.repeat(4001)), null);
  });
  test('shell metacharacters and control characters rejected', () => {
    for (const c of [';', '&', '|', '`', '$', '(', ')', '<', '>', '{', '}', '\\', '\x00', '\x08', '\n', '\r', '\x0b', '\x1f', '\x7f']) {
      assert.equal(commandWords(`ls a${c}b`), null, JSON.stringify(c));
      assert.equal(commandWords(`ls "a${c}b"`), null, `quoted ${JSON.stringify(c)}`);
    }
  });
  test('globs, comments, quotes, env assignments', () => {
    for (const s of ['ls *', 'ls a?', 'ls [ab]', 'ls "unterminated', "ls 'x", 'X=1 ls', 'X+=1 ls', '_a9=1', 'A=']) assert.equal(commandWords(s), null, s);
    assert.deepEqual(commandWords('ls "*" \'?\' "[x]"'), ['ls', '"*"', "'?'", '"[x]"']);
    assert.deepEqual(commandWords('ls X=1'), ['ls', 'X=1']);
    assert.deepEqual(commandWords('9X=1 ls'), ['9X=1', 'ls']);
    assert.deepEqual(commandWords('ls "#x"'), ['ls', '"#x"']);
    assert.deepEqual(commandWords('ls é😀'), ['ls', 'é😀']);
  });
});

describe('parseRule', () => {
  const err = (input, error) => assert.deepEqual(parseRule(input), { ok: false, error }, String(input));
  test('constants', () => { assert.equal(TRUSTED_LIMIT, 50); assert.equal(RULE_MAX, 300); });
  test('scalar errors', () => {
    for (const v of [5, null, undefined, {}, true]) err(v, 'A rule is text, for example Bash(git status).');
    err('   ', 'Type a rule first.');
    err('Bash(' + 'a'.repeat(300) + ')', 'Keep a rule under 300 characters.');
    assert.equal(parseRule('  ' + 'Bash(' + 'a'.repeat(294) + ')  ').ok, true, 'exactly 300 after trim');
  });
  test('tools that always ask', () => {
    for (const n of ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']) err(n, `${n} changes files, so it always asks.`);
    for (const n of ['Agent', 'Task']) err(n, `${n} starts a subagent that can do anything, so it always asks.`);
    err('PowerShell', 'PowerShell always asks. Only Bash commands can run without asking.');
    err('Edit(src/x.js)', 'Edit changes files, so it always asks.');
  });
  test('Bash shapes', () => {
    const name = 'Name the command: Bash(command:*) or Bash(exact command). Every Bash command always asks.';
    err('Bash', name); err('Bash()', name); err('Bash(*)', name); err('Bash(   )', name);
    err('Bash(ls', 'Write it as Bash(command:*) or Bash(exact command).');
    err('Bash(git * log)', 'The only wildcard is :* at the end, as in Bash(git log:*).');
    err('Bash(git log*)', 'The only wildcard is :* at the end, as in Bash(git log:*).');
    const shell = 'A trusted command is one simple command: no ; & | ` $ ( ) < > { } \\ or line breaks.';
    err('Bash(ls; rm x)', shell); err('Bash(echo $HOME)', shell); err('Bash(ls | wc)', shell);
    err('Bash(X=1 ls)', 'Start with the command itself, not a VAR=value setting.');
    err('Bash(ls "a)', 'Write the command as plain words: close every quote, and quote any ? or [.');
    err('Bash(ls a?)', 'Write the command as plain words: close every quote, and quote any ? or [.');
  });
  test('valid Bash rules normalise', () => {
    assert.deepEqual(parseRule('Bash(git status)'), { ok: true, rule: { type: 'bash', words: ['git', 'status'], prefix: false, text: 'Bash(git status)' } });
    assert.deepEqual(parseRule('  Bash(git   log:*)  '), { ok: true, rule: { type: 'bash', words: ['git', 'log'], prefix: true, text: 'Bash(git log:*)' } });
    assert.deepEqual(parseRule('Bash(git log *)').rule.text, 'Bash(git log:*)');
    assert.deepEqual(parseRule('Bash(git\tlog  "a b")').rule, { type: 'bash', words: ['git', 'log', '"a b"'], prefix: false, text: 'Bash(git log "a b")' });
  });
  test('MCP rules', () => {
    for (const s of ['mcp__*', 'mcp__', 'mcp__*__*']) err(s, 'Name a server: mcp__server__* or mcp__server__tool.');
    assert.deepEqual(parseRule('mcp__my-srv_1__*'), { ok: true, rule: { type: 'mcp-server', prefix: 'mcp__my-srv_1__', text: 'mcp__my-srv_1__*' } });
    err('mcp__a__b__*', 'Write a server wildcard as mcp__server__*, with the server name as Claude Code shows it.');
    err('mcp__a.b__*', 'Write a server wildcard as mcp__server__*, with the server name as Claude Code shows it.');
    assert.deepEqual(parseRule('mcp__srv__read_file'), { ok: true, rule: { type: 'mcp', name: 'mcp__srv__read_file', text: 'mcp__srv__read_file' } });
    err('mcp__srv', 'Add the tool, or __* for every tool from that server: mcp__srv__*.');
    err('mcp__srv__to.ol', 'Write an MCP rule as mcp__server__tool or mcp__server__*.');
  });
  test('Web tools and others', () => {
    assert.deepEqual(parseRule(' WebSearch '), { ok: true, rule: { type: 'tool', name: 'WebSearch', text: 'WebSearch' } });
    assert.deepEqual(parseRule('WebFetch'), { ok: true, rule: { type: 'tool', name: 'WebFetch', text: 'WebFetch' } });
    err('WebFetch(domain:example.test)', 'WebFetch rules name the tool only: WebFetch.');
    err('WebSearch(x)', 'WebSearch rules name the tool only: WebSearch.');
    for (const n of ['Read', 'Glob', 'Grep', 'LS']) err(n, `${n} does not need a rule.`);
    err('Frobnicate', 'Use Bash(command:*), Bash(exact command), mcp__server__tool, mcp__server__* or WebSearch.');
    err('bash(ls)', 'Use Bash(command:*), Bash(exact command), mcp__server__tool, mcp__server__* or WebSearch.');
  });
});

describe('validateRules / parseRuleList', () => {
  test('validateRules', () => {
    assert.deepEqual(validateRules('Bash(ls)'), { error: 'Send a list of rules.' });
    assert.deepEqual(validateRules(null), { error: 'Send a list of rules.' });
    assert.deepEqual(validateRules(Array(51).fill('WebSearch')), { error: 'Keep the list to 50 rules.' });
    assert.deepEqual(validateRules(Array(50).fill('WebSearch')), { rules: ['WebSearch'] });
    assert.deepEqual(validateRules([]), { rules: [] });
    assert.deepEqual(validateRules(['Bash(git  status)', 'WebSearch', 'Bash(git status)', 'mcp__s__t']), { rules: ['Bash(git status)', 'WebSearch', 'mcp__s__t'] });
    assert.deepEqual(validateRules(['WebSearch', '  Edit  ', 'Write']), { error: 'Edit changes files, so it always asks.', rule: 'Edit', index: 1 });
    const long = 'x'.repeat(400);
    const r = validateRules([long]);
    assert.equal(r.rule, 'x'.repeat(300)); assert.equal(r.index, 0); assert.equal(r.error, 'Keep a rule under 300 characters.');
    assert.deepEqual(validateRules(['WebSearch', 7]), { error: 'A rule is text, for example Bash(git status).', rule: '', index: 1 });
  });
  test('parseRuleList splitting and ignored', () => {
    assert.deepEqual(parseRuleList(null), { rules: [], ignored: [] });
    assert.deepEqual(parseRuleList(''), { rules: [], ignored: [] });
    const r = parseRuleList('Bash(git status), WebSearch\r\nBash(echo a, b)\n\n , Edit ,mcp__s__*');
    assert.deepEqual(r.rules, ['Bash(git status)', 'WebSearch', 'Bash(echo a, b)', 'mcp__s__*']);
    assert.deepEqual(r.ignored, [{ rule: 'Edit', error: 'Edit changes files, so it always asks.' }]);
    const neg = parseRuleList(') , WebSearch');
    assert.deepEqual(neg.rules, ['WebSearch']);
    assert.equal(neg.ignored.length, 1); assert.equal(neg.ignored[0].rule, ')');
    assert.deepEqual(parseRuleList('WebSearch, WebSearch,Bash(ls  -l)').rules, ['WebSearch', 'Bash(ls -l)']);
    const longBad = 'Z'.repeat(400);
    assert.equal(parseRuleList(longBad).ignored[0].rule, 'Z'.repeat(300));
  });
  test('parseRuleList overflow beyond 50', () => {
    const raw = Array.from({ length: 52 }, (_, i) => `Bash(cmd${i})`).join('\n');
    const r = parseRuleList(raw);
    assert.equal(r.rules.length, 50);
    assert.equal(r.rules[49], 'Bash(cmd49)');
    assert.deepEqual(r.ignored, [{ rule: 'Bash(cmd50)', error: 'Only the first 50 rules are used.' }, { rule: 'Bash(cmd51)', error: 'Only the first 50 rules are used.' }]);
  });
});

describe('matchTrusted', () => {
  test('shape guards', () => {
    assert.equal(matchTrusted([], 'Bash', { command: 'ls' }), null);
    assert.equal(matchTrusted('Bash(ls)', 'Bash', { command: 'ls' }), null);
    assert.equal(matchTrusted(['Bash(ls)'], 5, { command: 'ls' }), null);
    assert.equal(matchTrusted(['Bash(ls)'], 'Bash', null), null);
    assert.equal(matchTrusted(['Bash(ls)'], 'Bash', ['ls']), null);
    assert.equal(matchTrusted(['Bash(ls)'], 'Bash', 'ls'), null);
  });
  test('Bash exact and prefix', () => {
    const rules = ['Bash(git status)', 'Bash(git log:*)'];
    assert.equal(matchTrusted(rules, 'Bash', { command: 'git status' }), 'Bash(git status)');
    assert.equal(matchTrusted(rules, 'Bash', { command: '  git\tstatus ' }), 'Bash(git status)');
    assert.equal(matchTrusted(rules, 'Bash', { command: 'git status -s' }), null);
    assert.equal(matchTrusted(rules, 'Bash', { command: 'git' }), null);
    assert.equal(matchTrusted(rules, 'Bash', { command: 'git log' }), 'Bash(git log:*)');
    assert.equal(matchTrusted(rules, 'Bash', { command: 'git log --oneline -5' }), 'Bash(git log:*)');
    assert.equal(matchTrusted(rules, 'Bash', { command: 'git status; rm -rf x' }), null);
    assert.equal(matchTrusted(rules, 'Bash', { command: 'git log $(whoami)' }), null);
    assert.equal(matchTrusted(rules, 'Bash', { command: 'git "status"' }), null, 'quotes are significant');
    assert.equal(matchTrusted(['Bash(git "status")'], 'Bash', { command: 'git "status"' }), 'Bash(git "status")');
    assert.equal(matchTrusted(['Bash(git:*)', 'Bash(git status)'], 'Bash', { command: 'git status' }), 'Bash(git:*)', 'first match wins');
    assert.equal(matchTrusted(['Edit', 'bogus', 'Bash(  ls  )'], 'Bash', { command: 'ls' }), 'Bash(ls)', 'invalid rules dropped');
    assert.equal(matchTrusted(['Bash(ls)'], 'Bash', {}), null);
    assert.equal(matchTrusted(['Bash(ls)'], 'Bash', { command: 5 }), null);
  });
  test('Bash input keys are restricted', () => {
    assert.equal(matchTrusted(['Bash(ls)'], 'Bash', { command: 'ls', description: 'list', timeout: 1000, run_in_background: false }), 'Bash(ls)');
    assert.equal(matchTrusted(['Bash(ls)'], 'Bash', { command: 'ls', dangerouslyDisableSandbox: true }), null);
  });
  test('MCP and Web tools', () => {
    assert.equal(matchTrusted(['mcp__safe__*'], 'mcp__safe__read', {}), 'mcp__safe__*');
    assert.equal(matchTrusted(['mcp__safe__*'], 'mcp__safe__other__tool', {}), null);
    assert.equal(matchTrusted(['mcp__safe__*'], 'mcp__safe__', {}), null);
    assert.equal(matchTrusted(['mcp__safe__*'], 'mcp__unsafe__read', {}), null);
    assert.equal(matchTrusted(['mcp__safe__read'], 'mcp__safe__read', { anything: [1] }), 'mcp__safe__read');
    assert.equal(matchTrusted(['mcp__safe__read'], 'mcp__safe__write', {}), null);
    assert.equal(matchTrusted(['WebSearch'], 'WebSearch', { query: 'x' }), 'WebSearch');
    assert.equal(matchTrusted(['WebSearch'], 'WebFetch', { url: 'x' }), null);
    assert.equal(matchTrusted(['WebSearch', 'Bash(ls)', 'mcp__s__*'], 'Edit', { file_path: '/x' }), null);
    assert.equal(matchTrusted(['WebSearch'], 'mcp__WebSearch', {}), null);
    assert.equal(matchTrusted(['mcp__safe__*'], 'Bash', { command: 'mcp__safe__x' }), null);
    assert.equal(matchTrusted(['WebSearch'], 'WebSearch', []), null);
  });
});
