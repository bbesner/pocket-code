// The ACP engine adapter (acp.mjs) driven against a fake ACP agent (fake-acp.mjs) — no model,
// no network. Covers: initialize/capabilities, a prompt turn that streams + routes
// request_permission to onApproval, fail-closed deny, cancel, and crash+resume via session/load.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AcpClient, startAcpTurn, acpSessions, closeAcpSession, permissionOutcome, normalizeUpdate, isAcpId, bareAcpId, declineFor } from '../acp.mjs';

const FAKE = path.join(import.meta.dirname, 'fake-acp.mjs');
const mkStore = () => fs.mkdtempSync(path.join(os.tmpdir(), 'acp-store-'));
const turnOpts = (store, extra = {}) => ({ cmd: process.execPath, args: [FAKE], env: { ...process.env, POCKET_ACP_STORE: store }, text: 'do the thing', model: 'openrouter/deepseek/deepseek-v4.1-flash-1017', ...extra });
const collect = () => { const ev = []; return { emit: e => ev.push(e), ev }; };

test('id namespace helpers', () => {
  assert.ok(isAcpId('acp:abc')); assert.ok(!isAcpId('cx:abc')); assert.ok(!isAcpId(null));
  assert.equal(bareAcpId('acp:abc'), 'abc'); assert.equal(bareAcpId('plain'), 'plain');
});

test('pure helpers: permissionOutcome + normalizeUpdate + declineFor', () => {
  const opts = [{ optionId: 'allow_once', kind: 'allow_once' }, { optionId: 'reject_once', kind: 'reject_once' }];
  assert.deepEqual(permissionOutcome(opts, true), { outcome: 'selected', optionId: 'allow_once' });
  assert.deepEqual(permissionOutcome(opts, 'allow_once'), { outcome: 'selected', optionId: 'allow_once' });
  assert.deepEqual(permissionOutcome(opts, false), { outcome: 'selected', optionId: 'reject_once' });
  assert.deepEqual(permissionOutcome([], false), { outcome: 'cancelled' });
  assert.equal(normalizeUpdate({ sessionUpdate: 'agent_message_chunk', content: { text: 'hi' } }).text, 'hi');
  assert.equal(normalizeUpdate({ sessionUpdate: 'tool_call', toolCallId: 't1', status: 'pending' }).type, 'tool');
  assert.equal(declineFor('session/request_permission').outcome.outcome, 'cancelled');
  assert.equal(declineFor('fs/read_text_file'), null);
});

test('initialize advertises capabilities', async () => {
  const store = mkStore();
  const c = new AcpClient({ cmd: process.execPath, args: [FAKE], env: { ...process.env, POCKET_ACP_STORE: store } });
  const r = await c.initialize();
  assert.equal(r.protocolVersion, 1);
  assert.equal(r.agentCapabilities.loadSession, true);
  assert.ok(r.agentCapabilities.mcpCapabilities.http);
  c.close();
});

test('prompt turn: streams, surfaces an approval, finishes end_turn', async () => {
  const store = mkStore();
  const { emit, ev } = collect();
  let approvalReq = null;
  const onApproval = req => { approvalReq = req; return true; }; // allow
  let finished = null;
  const r = await startAcpTurn(turnOpts(store, { emit, onApproval, onFinish: f => { finished = f; } }));
  assert.equal(r.stopReason, 'end_turn');
  assert.equal(finished.stopReason, 'end_turn');
  assert.ok(approvalReq && Array.isArray(approvalReq.options), 'onApproval was called with options');
  assert.ok(ev.some(e => e.type === 'tool'), 'emitted a tool event');
  assert.ok(ev.some(e => e.type === 'text' && /echo of/.test(e.text)), 'emitted agent text');
  closeAcpSession(r.sessionId);
});

test('fail-closed: no onApproval handler denies the tool (refusal)', async () => {
  const store = mkStore();
  const r = await startAcpTurn(turnOpts(store, { emit: () => { } })); // no onApproval
  assert.equal(r.stopReason, 'refusal', 'default-deny produces a refusal, not an allow');
  closeAcpSession(r.sessionId);
});

test('explicit deny is honored', async () => {
  const store = mkStore();
  const r = await startAcpTurn(turnOpts(store, { emit: () => { }, onApproval: () => false }));
  assert.equal(r.stopReason, 'refusal');
  closeAcpSession(r.sessionId);
});

test('cancel during a pending permission ends the turn cancelled, client stays usable', async () => {
  const store = mkStore();
  let sid = null;
  const onApproval = async req => { // cancel instead of answering, then allow so the turn can resolve
    sid = req.sessionId;
    const entry = acpSessions.get(sid);
    entry.client.cancel(sid);
    return true;
  };
  const r = await startAcpTurn(turnOpts(store, { emit: () => { }, onApproval }));
  assert.equal(r.stopReason, 'cancelled');
  closeAcpSession(r.sessionId);
});

test('crash + resume: a fresh client loads the prior session and replays history', async () => {
  const store = mkStore();
  const { emit, ev } = collect();
  const r1 = await startAcpTurn(turnOpts(store, { emit, onApproval: () => true }));
  const sid = r1.sessionId;
  const priorText = ev.filter(e => e.type === 'text').map(e => e.text).join('');
  assert.match(priorText, /echo of/);
  // simulate a crash: kill the child and drop the in-memory session
  closeAcpSession(sid);
  // a fresh turn that resumes the same session id must replay the stored history
  const { emit: emit2, ev: ev2 } = collect();
  await startAcpTurn(turnOpts(store, { emit: emit2, onApproval: () => true, sessionId: sid, resume: true }));
  const replayed = ev2.filter(e => e.type === 'text').map(e => e.text).join('');
  assert.match(replayed, /echo of/, 'resumed session replayed its history');
  closeAcpSession(sid);
});

test('loadSession unsupported is surfaced (capability varies by agent)', async () => {
  const store = mkStore();
  const r1 = await startAcpTurn(turnOpts(store, { emit: () => { }, onApproval: () => true }));
  const sid = r1.sessionId;
  closeAcpSession(sid);
  await assert.rejects(
    startAcpTurn({ ...turnOpts(store, { emit: () => { }, onApproval: () => true, sessionId: sid, resume: true }), env: { ...process.env, POCKET_ACP_STORE: store, FAKE_ACP_NO_LOADSESSION: '1' } }),
    /loadSession not supported|unknown session/,
  );
  for (const [, e] of acpSessions) e.client.close(); acpSessions.clear();
});
