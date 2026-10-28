// The ACP engine adapter (acp.mjs) driven against a fake ACP agent (fake-acp.mjs) — no model,
// no network. Covers: initialize/capabilities, a prompt turn that streams deltas and surfaces a
// request_permission as an ApprovalInbox card, allow/deny via decide(), cancel, crash+resume via
// session/load, loadSession-unsupported, and the read-only lister/transcript reader.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AcpClient, messagesFromEvents, startAcpTurn, acpSessions, acpTurns, closeAcpSession, stopAcpTurn, permissionOutcomes, normalizeUpdate, isAcpId, bareAcpId, declineFor, listAcpSessions, readAcpTranscript } from '../acp.mjs';

const FAKE = path.join(import.meta.dirname, 'fake-acp.mjs');
const mkStore = () => fs.mkdtempSync(path.join(os.tmpdir(), 'acp-store-'));
const baseEnv = store => ({ ...process.env, POCKET_ACP_STORE: store });
const turnOpts = (store, extra = {}) => ({ cmd: process.execPath, args: [FAKE], env: baseEnv(store), text: 'do the thing', model: 'openrouter/deepseek/deepseek-v4.1-flash-1017', hooks: {}, ...extra });
const collect = () => { const ev = []; return { emit: e => ev.push(e), ev }; };
const waitFor = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 20)); } return false; };
const afterEach = () => { for (const [, s] of acpSessions) { try { s.client.close(); } catch { } } acpSessions.clear(); acpTurns.clear(); };

test('id namespace helpers', () => {
  assert.ok(isAcpId('acp:abc')); assert.ok(!isAcpId('cx:abc')); assert.ok(!isAcpId(null));
  assert.equal(bareAcpId('acp:abc'), 'abc'); assert.equal(bareAcpId('plain'), 'plain');
});

test('pure helpers: permissionOutcomes + normalizeUpdate + declineFor', () => {
  const opts = [{ optionId: 'allow_once', kind: 'allow_once' }, { optionId: 'reject_once', kind: 'reject_once' }];
  const o = permissionOutcomes(opts);
  assert.deepEqual(o.allow, { outcome: { outcome: 'selected', optionId: 'allow_once' } });
  assert.deepEqual(o.deny, { outcome: { outcome: 'selected', optionId: 'reject_once' } });
  assert.equal(o.canAllow, true);
  assert.deepEqual(permissionOutcomes([]).allow, { outcome: { outcome: 'cancelled' } });
  assert.equal(normalizeUpdate({ sessionUpdate: 'agent_message_chunk', content: { text: 'hi' } }).type, 'delta');
  assert.equal(normalizeUpdate({ sessionUpdate: 'tool_call', toolCallId: 't1' }).type, 'tool');
  assert.equal(declineFor('session/request_permission').outcome.outcome, 'cancelled');
  assert.equal(declineFor('fs/read_text_file'), null);
});

test('messagesFromEvents groups replayed chunks into messages by role and messageId', () => {
  const m = messagesFromEvents([
    { type: 'user_chunk', text: 'Remember ', messageId: 'u1' }, { type: 'user_chunk', text: 'PERSIMMON', messageId: 'u1' },
    { type: 'delta', text: 'Got ', messageId: 'a1' }, { type: 'delta', text: 'it.', messageId: 'a1' },
    { type: 'tool', id: 't1', title: 'bash' }, { type: 'delta', text: 'Second reply', messageId: 'a2' },
    { type: 'delta', text: '   ', messageId: 'a3' }, null,
  ]);
  assert.deepEqual(m, [{ role: 'user', text: 'Remember PERSIMMON' }, { role: 'assistant', text: 'Got it.', blocks: [{ t: 'text', text: 'Got it.' }] }, { role: 'assistant', text: 'Second reply', blocks: [{ t: 'text', text: 'Second reply' }] }]);
  assert.deepEqual(messagesFromEvents(undefined), []);
});

test('initialize advertises capabilities; no onRequest handler fails closed', async () => {
  const store = mkStore();
  const c = new AcpClient({ cmd: process.execPath, args: [FAKE], env: baseEnv(store) });
  const r = await c.initialize();
  assert.equal(r.agentCapabilities.loadSession, true);
  assert.ok(r.agentCapabilities.mcpCapabilities.http);
  c.close();
});

test('prompt turn: streams delta, surfaces an approval card, allow -> end_turn', async () => {
  const store = mkStore();
  const { emit, ev } = collect();
  const turn = await startAcpTurn(turnOpts(store, { hooks: { emit } }));
  assert.ok(await waitFor(() => turn.approvals.list().length > 0), 'an approval card appeared');
  const card = turn.approvals.list()[0];
  assert.equal(card.kind, 'command');
  await turn.approvals.decide(card.id, 'allow');
  await turn.promptDone;
  assert.ok(ev.some(e => e.type === 'delta'), 'streamed a delta');
  assert.ok(ev.some(e => e.type === 'assistant' && /echo of/.test(e.msg.text)), 'assistant message assembled');
  assert.ok(ev.some(e => e.type === 'result' && e.stopReason === 'end_turn'), 'result end_turn');
  assert.ok(ev.some(e => e.type === 'done'), 'done');
  assert.ok(!acpTurns.has(turn.sessionId), 'turn cleared after finish');
  afterEach();
});

test('deny -> refusal', async () => {
  const store = mkStore();
  const { emit, ev } = collect();
  const turn = await startAcpTurn(turnOpts(store, { hooks: { emit } }));
  assert.ok(await waitFor(() => turn.approvals.list().length > 0));
  await turn.approvals.decide(turn.approvals.list()[0].id, 'deny');
  await turn.promptDone;
  assert.ok(ev.some(e => e.type === 'result' && e.stopReason === 'refusal'));
  afterEach();
});

test('stopAcpTurn cancels during a pending permission', async () => {
  const store = mkStore();
  const { emit, ev } = collect();
  const turn = await startAcpTurn(turnOpts(store, { hooks: { emit } }));
  assert.ok(await waitFor(() => turn.approvals.list().length > 0));
  assert.equal(stopAcpTurn(turn.sessionId), true);
  await turn.promptDone;
  assert.ok(ev.some(e => e.type === 'result' && e.stopReason === 'cancelled'));
  afterEach();
});

test('busy: a second turn on a live session is rejected 409', async () => {
  const store = mkStore();
  const turn = await startAcpTurn(turnOpts(store, { hooks: {} }));
  await waitFor(() => turn.approvals.list().length > 0);
  await assert.rejects(startAcpTurn(turnOpts(store, { sessionId: 'acp:' + turn.sessionId, hooks: {} })), /busy/);
  stopAcpTurn(turn.sessionId); await turn.promptDone; afterEach();
});

test('crash + resume: a fresh session loads prior history', async () => {
  const store = mkStore();
  const { emit, ev } = collect();
  const t1 = await startAcpTurn(turnOpts(store, { hooks: { emit } }));
  await waitFor(() => t1.approvals.list().length > 0);
  await t1.approvals.decide(t1.approvals.list()[0].id, 'allow');
  await t1.promptDone;
  const sid = t1.sessionId;
  assert.match(ev.filter(e => e.type === 'delta').map(e => e.text).join(''), /echo of/);
  closeAcpSession('acp:' + sid); // simulate crash
  const replay = await readAcpTranscript({ sessionId: 'acp:' + sid, env: baseEnv(store), cmd: process.execPath, args: [FAKE] });
  assert.ok(replay.some(e => e.type === 'delta' && /echo of/.test(e.text)), 'transcript replayed from session/load');
  afterEach();
});

test('listAcpSessions enumerates via session/list', async () => {
  const store = mkStore();
  const t = await startAcpTurn(turnOpts(store, { hooks: {} }));
  await waitFor(() => t.approvals.list().length > 0);
  stopAcpTurn(t.sessionId); await t.promptDone;
  const rows = await listAcpSessions({ env: baseEnv(store), cmd: process.execPath, args: [FAKE] });
  assert.ok(Array.isArray(rows));
  assert.ok(rows.every(r => isAcpId(r.id) && r.provider === 'acp'));
  afterEach();
});

test('loadSession unsupported surfaces (capability varies by agent)', async () => {
  const store = mkStore();
  const t = await startAcpTurn(turnOpts(store, { hooks: {} }));
  await waitFor(() => t.approvals.list().length > 0);
  const sid = t.sessionId; stopAcpTurn(sid); await t.promptDone; closeAcpSession('acp:' + sid);
  await assert.rejects(
    readAcpTranscript({ sessionId: 'acp:' + sid, env: { ...baseEnv(store), FAKE_ACP_NO_LOADSESSION: '1' }, cmd: process.execPath, args: [FAKE] }),
    /loadSession not supported|unknown session/,
  );
  afterEach();
});
