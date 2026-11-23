// The ACP engine adapter (acp.mjs) driven against a fake ACP agent (fake-acp.mjs) — no model,
// no network. Covers: initialize/capabilities, a prompt turn that streams deltas and surfaces a
// request_permission as an ApprovalInbox card, allow/deny via decide(), cancel, crash+resume via
// session/load, loadSession-unsupported, and the read-only lister/transcript reader.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AcpClient, messagesFromEvents, startAcpTurn, acpSessions, acpTurns, closeAcpSession, stopAcpTurn, permissionOutcomes, normalizeUpdate, isAcpId, bareAcpId, declineFor, listAcpSessions, readAcpList, readAcpTranscript, probeAcpEfforts } from '../acp.mjs';

const FAKE = path.join(import.meta.dirname, 'fake-acp.mjs');
const mkStore = () => fs.mkdtempSync(path.join(os.tmpdir(), 'acp-store-'));
const baseEnv = store => ({ ...process.env, POCKET_ACP_STORE: store });
const turnOpts = (store, extra = {}) => ({ cmd: process.execPath, args: [FAKE], env: baseEnv(store), text: 'do the thing', model: 'openrouter/deepseek/deepseek-v4.1-flash-1017', hooks: {}, ...extra });
const collect = () => { const ev = []; return { emit: e => ev.push(e), ev }; };
const waitFor = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 20)); } return false; };
// A test that fails with a request still waiting would otherwise keep the run open until that request's timer.
const unhang = turn => { for (const [, p] of turn?.client?.pending || []) clearTimeout(p.timer); };
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

test('messagesFromEvents: a user message, then the agent\'s thinking, tool lines and text in order', () => {
  const m = messagesFromEvents([
    { type: 'user_chunk', text: 'Remember ', messageId: 'u1' }, { type: 'user_chunk', text: 'PERSIMMON', messageId: 'u1' },
    { type: 'reasoning', text: 'Look it ' }, { type: 'reasoning', text: 'up.' },
    { type: 'tool', id: 't1', kind: 'read', title: 'home/x/PROJECTS.md', input: { filePath: '/home/x/PROJECTS.md' } }, { type: 'tool', id: 't1', status: 'completed', update: true },
    { type: 'delta', text: 'Got ', messageId: 'a1' }, { type: 'delta', text: 'it.', messageId: 'a1' },
    { type: 'tool', id: 't2', kind: 'execute', title: 'ls', input: { command: 'ls -la' } }, { type: 'delta', text: 'Second part', messageId: 'a2' },
    { type: 'delta', text: '   ', messageId: 'a3' }, null,
    { type: 'user_chunk', text: 'next', messageId: 'u2' }, { type: 'delta', text: 'ok', messageId: 'a4' },
  ]);
  assert.deepEqual(m, [
    { role: 'user', text: 'Remember PERSIMMON' },
    { role: 'assistant', text: 'Got it.\n\nSecond part', blocks: [{ t: 'tool', name: 'Thinking', detail: 'Look it up.' }, { t: 'tool', name: 'Read', detail: '/home/x/PROJECTS.md' }, { t: 'text', text: 'Got it.' }, { t: 'tool', name: 'Bash', detail: 'ls -la' }, { t: 'text', text: 'Second part' }] },
    { role: 'user', text: 'next' }, { role: 'assistant', text: 'ok', blocks: [{ t: 'text', text: 'ok' }] }]);
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

// 1.124.2: closing the pane with "Stop the reply" stops the reply and closes its process at once (server.mjs release).
// The process exits before it answers the cancel; the reply used to stay open until its one-hour prompt timeout.
test('stop and close at once: the reply ends as stopped now, not at the prompt timeout', async () => {
  const store = mkStore();
  const { emit, ev } = collect(), finished = [];
  const turn = await startAcpTurn(turnOpts(store, { text: 'wait __HANG__', env: { ...baseEnv(store), FAKE_ACP_NO_ASK: '1' }, hooks: { emit, onFinish: r => finished.push(r) } }));
  try {
    assert.ok(await waitFor(() => turn.openPrompts === 1), 'the prompt is open');
    stopAcpTurn(turn.sessionId); closeAcpSession('acp:' + turn.sessionId);
    assert.ok(await waitFor(() => turn.done, 3000), 'the reply ended');
    const r = ev.find(e => e.type === 'result');
    assert.deepEqual([r.ok, r.stopReason, r.error], [false, 'cancelled', 'Stopped by you']);
    assert.ok(ev.some(e => e.type === 'done'), 'open streams are told it is over');
    assert.equal(finished.length, 1, 'onFinish ran once');
    assert.equal(turn.client.pending.size, 0, 'no request is left waiting on its timer');
    assert.ok(!acpTurns.has(turn.sessionId) && !acpSessions.has(turn.sessionId));
  } finally { unhang(turn); afterEach(); }
});

// 1.124.2: a process that dies between replies (a crash, an out-of-memory kill) used to stay registered, and every later
// message failed with "acp client closed" while each failure put off the idle close.
test('a process that dies between replies is dropped, and the next message opens a new one', async () => {
  const store = mkStore(), env = { ...baseEnv(store), FAKE_ACP_NO_ASK: '1' };
  const first = await startAcpTurn(turnOpts(store, { env }));
  await first.promptDone;
  const sid = first.sessionId, pid = first.client.pid;
  process.kill(pid, 'SIGKILL');
  assert.ok(await waitFor(() => first.client.closed, 3000), 'the process is gone');
  const { emit, ev } = collect();
  const next = await startAcpTurn(turnOpts(store, { env, sessionId: 'acp:' + sid, resume: true, text: 'again', hooks: { emit } }));
  await next.promptDone;
  const r = ev.find(e => e.type === 'result');
  assert.deepEqual([r.ok, r.stopReason, r.error], [true, 'end_turn', undefined]);
  assert.notEqual(next.client.pid, pid, 'a new process');
  afterEach();
  // and with no message after it, the dead process is not kept as the conversation's (the idle close never saw it)
  const lone = await startAcpTurn(turnOpts(store, { env }));
  await lone.promptDone;
  process.kill(lone.client.pid, 'SIGKILL');
  assert.ok(await waitFor(() => !acpSessions.has(lone.sessionId), 3000), 'dropped when it exits');
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

// ---------- 1.84.1: model and effort reach OpenCode as session config options ----------
// Before 1.84.1 the model rode on session/prompt, which OpenCode ignores, so every turn ran on OpenCode's own
// default model (opencode/big-pickle) while Pocket showed the chosen one.
const ranOn = (store, sid) => JSON.parse(fs.readFileSync(path.join(store, encodeURIComponent(sid) + '.json'), 'utf8')).ranOn;
async function runAllowed(opts) {
  const ev = []; const turn = await startAcpTurn({ ...opts, hooks: { emit: e => ev.push(e) } });
  for (let i = 0; i < 500 && !turn.approvals.list().length && !ev.some(e => e.type === 'done'); i++) await new Promise(r => setTimeout(r, 20));
  if (turn.approvals.list().length) await turn.approvals.decide(turn.approvals.list()[0].id, 'allow');
  await turn.promptDone; return { turn, ev };
}

test('a turn runs on the model and effort it asked for', async () => {
  const store = mkStore();
  const { turn, ev } = await runAllowed(turnOpts(store, { effort: 'high' }));
  assert.ok(ev.some(e => e.type === 'result' && e.ok), 'finished: ' + JSON.stringify(ev.at(-2)));
  assert.deepEqual(ranOn(store, turn.sessionId), { model: 'openrouter/deepseek/deepseek-v4.1-flash-1017', effort: 'high' });
  afterEach();
});

test('effort Default, or a level the model lacks, runs on the model default; the next turn can switch model and effort', async () => {
  const store = mkStore();
  const { turn } = await runAllowed(turnOpts(store, { effort: 'xhigh' })); // DeepSeek has no xhigh
  assert.deepEqual(ranOn(store, turn.sessionId), { model: 'openrouter/deepseek/deepseek-v4.1-flash-1017', effort: 'default' });
  assert.equal(turn.effort, null, 'the turn records that the default ran');
  const id = 'acp:' + turn.sessionId;
  await runAllowed(turnOpts(store, { sessionId: id, model: 'openrouter/anthropic/claude-sonnet-5.5', effort: 'xhigh' }));
  assert.deepEqual(ranOn(store, turn.sessionId), { model: 'openrouter/anthropic/claude-sonnet-5.5', effort: 'xhigh' });
  await runAllowed(turnOpts(store, { sessionId: id, model: 'openrouter/anthropic/claude-sonnet-5.5' }));
  assert.deepEqual(ranOn(store, turn.sessionId), { model: 'openrouter/anthropic/claude-sonnet-5.5', effort: 'default' }, 'Default resets a level set by an earlier turn');
  await runAllowed(turnOpts(store, { sessionId: id, model: 'openrouter/meta-llama/llama-4-scout', effort: 'high' }));
  assert.deepEqual(ranOn(store, turn.sessionId), { model: 'openrouter/meta-llama/llama-4-scout', effort: null }, 'a model with no effort setting ignores one');
  afterEach();
});

test('a reopened session is pointed at the model again (OpenCode reopens on its own default)', async () => {
  const store = mkStore();
  const { turn } = await runAllowed(turnOpts(store, { effort: 'max' }));
  closeAcpSession('acp:' + turn.sessionId);
  await runAllowed(turnOpts(store, { sessionId: 'acp:' + turn.sessionId, resume: true, effort: 'max' }));
  assert.deepEqual(ranOn(store, turn.sessionId), { model: 'openrouter/deepseek/deepseek-v4.1-flash-1017', effort: 'max' });
  afterEach();
});

test('fail closed: a runtime that does not switch model, or does not offer it, never gets the prompt', async () => {
  for (const [extra, env, re] of [[{}, { FAKE_ACP_IGNORE_MODEL: '1' }, /did not switch to openrouter\/deepseek\/deepseek-v4\.1-flash-1017 \(it is on opencode\/big-pickle\)/],
    [{ model: 'openrouter/nobody/no-such-model' }, {}, /does not offer openrouter\/nobody\/no-such-model/], [{ model: undefined }, {}, /No OpenRouter model/]]) {
    const store = mkStore();
    const o = turnOpts(store, extra); o.env = { ...o.env, ...env };
    const { turn, ev } = await runAllowed(o);
    const r = ev.find(e => e.type === 'result');
    assert.equal(r.ok, false); assert.match(r.error, re);
    assert.equal(ranOn(store, turn.sessionId), undefined, 'no prompt reached the runtime');
    afterEach();
  }
});

test('probeAcpEfforts maps each OpenRouter model to its effort levels; the probe folder is hidden from the list', async () => {
  const store = mkStore(), probe = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-probe-'));
  const map = await probeAcpEfforts({ cmd: process.execPath, args: [FAKE], env: baseEnv(store), cwd: probe });
  assert.deepEqual(map, {
    'openrouter/deepseek/deepseek-v4.1-flash-1017': ['none', 'low', 'high', 'max'],
    'openrouter/anthropic/claude-sonnet-5.5': ['low', 'medium', 'high', 'xhigh', 'max'],
    'openrouter/meta-llama/llama-4-scout': [],
  }, 'openrouter models only, without "default"');
  // 1.122.1: the probe's session is never prompted, so the list may leave it out as a session nobody used; named as a
  // conversation Pocket knows it is listed, and the hidden folder still hides it.
  const sids = fs.readdirSync(store).filter(f => f.endsWith('.json')).filter(f => JSON.parse(fs.readFileSync(path.join(store, f), 'utf8')).cwd === probe);
  assert.equal(sids.length, 1, 'one probe session');
  const known = [{ id: 'acp:' + decodeURIComponent(sids[0].replace(/\.json$/, '')), cwd: probe, at: Date.now() }];
  const all = await listAcpSessions({ env: baseEnv(store), cmd: process.execPath, args: [FAKE], folders: [probe], known });
  const shown = await listAcpSessions({ env: baseEnv(store), cmd: process.execPath, args: [FAKE], folders: [probe], known, hideCwd: probe });
  assert.equal(all.filter(r => r.cwd === probe).length, 1); assert.equal(shown.filter(r => r.cwd === probe).length, 0);
  // the next probe opens that session again instead of making another (OpenCode cannot delete one over ACP)
  assert.deepEqual(await probeAcpEfforts({ cmd: process.execPath, args: [FAKE], env: baseEnv(store), cwd: probe }), map);
  assert.equal(fs.readdirSync(store).filter(f => f.endsWith('.json')).filter(f => JSON.parse(fs.readFileSync(path.join(store, f), 'utf8')).cwd === probe).length, 1, 'still one probe session');
});

// ---------- the list, read folder by folder (OpenCode answers per project and per folder, 100 at most) ----------
const mkDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'acp-folder-'));
const seed = (store, sid, cwd, updatedAt) => fs.writeFileSync(path.join(store, encodeURIComponent(sid) + '.json'), JSON.stringify({ updates: [], cwd, createdAt: updatedAt, updatedAt, title: 'Seeded ' + sid, titled: true }));
const reader = (store, extra = {}, env = {}) => readAcpList({ env: { ...baseEnv(store), ...env }, cmd: process.execPath, args: [FAKE], limit: 200, ...extra });

test('readAcpList: hidden rows never use up the answer or the limit, and each known folder is asked on its own', async () => {
  const store = mkStore(), probe = mkDir(), one = mkDir(), two = mkDir(), now = Date.now();
  for (let i = 0; i < 150; i++) seed(store, `ses_probe${i}`, probe, now + 10_000 + i); // newest of their project
  seed(store, 'ses_one', one, now); seed(store, 'ses_two', two, now - 1000);
  // {} from a folder of the same project: 100 probe sessions and nothing else, all hidden
  const before = await reader(store, { cwd: os.tmpdir(), hideCwd: probe, limit: 2 });
  assert.deepEqual(before.rows, [], 'the whole-project answer is all probes');
  const r = await reader(store, { cwd: os.tmpdir(), hideCwd: probe, limit: 2, folders: [one, two, probe] });
  assert.deepEqual(r.rows.map(x => x.id), ['acp:ses_one', 'acp:ses_two'], 'both folders, the probe folder never');
  assert.deepEqual(r.rows.map(x => x.title), ['Seeded ses_one', 'Seeded ses_two']);
  assert.deepEqual(r.complete.sort(), [one, two].sort(), 'each folder answered in full');
});

test('readAcpList follows nextCursor; a folder answered with 100 is not complete, and a known conversation it missed is listed', async () => {
  const store = mkStore(), dir = mkDir(), now = Date.now();
  for (let i = 0; i < 20; i++) seed(store, `ses_p${i}`, dir, now - i * 1000);
  const paged = await reader(store, { folders: [dir] }, { FAKE_ACP_PAGE_SIZE: '7' });
  assert.equal(paged.rows.length, 20, 'three pages of 7, 7 and 6'); assert.deepEqual(paged.complete, [dir]);
  for (let i = 20; i < 130; i++) seed(store, `ses_p${i}`, dir, now + i * 1000); // 110 newer
  const known = [{ id: 'acp:ses_p19', cwd: dir, at: now - 19_000 }, { id: 'acp:ses_gone', cwd: mkDir(), at: now }];
  const full = await reader(store, { folders: [dir], known });
  assert.equal(full.complete.includes(dir), false, 'an answer of 100 may have been cut');
  const kept = full.rows.find(x => x.id === 'acp:ses_p19');
  assert.ok(kept, 'the known conversation the answer missed'); assert.equal(kept.cwd, dir); assert.equal(kept.untitled, true); assert.equal(kept.mtimeMs, now - 19_000);
  assert.ok(!full.rows.some(x => x.id === 'acp:ses_gone'), 'its folder answered in full without it: the program no longer has it');
  assert.equal(full.rows.length, 101);
});

// ---------- the read's bounds and the ghost-row rule (hardened 2026-11-22) ----------
test('readAcpList: the whole-project {} finds a folder nobody named; one failing folder leaves only its own rows out; a failing {} fails the read', async () => {
  const store = mkStore(), proj = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-proj-')), now = Date.now();
  fs.mkdirSync(path.join(proj, '.git')); const unnamed = path.join(proj, 'sub'); fs.mkdirSync(unnamed);
  const bad = mkDir(), good = mkDir();
  seed(store, 'ses_unnamed', unnamed, now); seed(store, 'ses_bad', bad, now - 1000); seed(store, 'ses_good', good, now - 2000);
  const r = await reader(store, { cwd: proj, folders: [bad, good] }, { FAKE_ACP_LIST_FAIL: bad });
  assert.ok(r.rows.some(x => x.id === 'acp:ses_unnamed'), 'found by the reader\'s own {} only');
  assert.ok(r.rows.some(x => x.id === 'acp:ses_good'), 'the other folder still answered');
  assert.ok(!r.rows.some(x => x.id === 'acp:ses_bad'), 'the failing folder\'s rows are left out');
  assert.equal(r.complete.includes(bad), false);
  await assert.rejects(reader(store, { cwd: proj, folders: [good] }, { FAKE_ACP_LIST_FAIL: '{}' }), /list failed/, 'the {} failing fails the read, as before');
});

test('readAcpList: a folder that never answers is given up after the per-question limit, and the rest is read', async () => {
  const store = mkStore(), stuck = mkDir(), dirs = Array.from({ length: 6 }, mkDir), now = Date.now();
  dirs.forEach((d, i) => seed(store, `ses_d${i}`, d, now - i * 1000));
  const t0 = Date.now();
  // the read waits for every folder's worker, so without the per-question limit it would run to the 20 s deadline
  const r = await reader(store, { folders: [stuck, ...dirs], requestMs: 300, deadlineMs: 20_000, previous: [{ id: 'acp:ses_stuck', cwd: stuck, title: 'Before', untitled: false, mtimeMs: now - 50_000 }] }, { FAKE_ACP_LIST_HANG: stuck });
  const took = Date.now() - t0;
  assert.ok(took < 5000, `given up after about 300 ms, not the deadline: ${took} ms`);
  assert.equal(r.late, false);
  assert.equal(r.rows.filter(x => /^acp:ses_d/.test(x.id)).length, 6, 'every other folder answered');
  assert.equal(r.rows.find(x => x.id === 'acp:ses_stuck')?.title, 'Before', 'the folder that did not answer keeps its previous row');
  // the whole-project {} not answering is the same: it is given up, and the folders' answers are used
  const t1 = Date.now();
  const w = await reader(store, { folders: dirs, requestMs: 300, deadlineMs: 20_000 }, { FAKE_ACP_LIST_HANG: '{}' });
  assert.ok(Date.now() - t1 < 5000, `{} given up after about 300 ms: ${Date.now() - t1} ms`);
  assert.equal(w.late, true, 'reported as not all answered');
  assert.equal(w.rows.length, 6);
});

test('readAcpList: the whole read stops at its deadline, keeps what answered and the previous rows of the rest', async () => {
  const store = mkStore(), stuck = mkDir(), fine = mkDir(), now = Date.now();
  seed(store, 'ses_fine', fine, now);
  const previous = [{ id: 'acp:ses_old', cwd: stuck, title: 'Kept', untitled: false, mtimeMs: now - 60_000 }];
  for (const hang of [stuck, `{},${stuck}`]) { // a folder hangs; then the {} hangs too
    const t0 = Date.now();
    const r = await reader(store, { folders: [fine, stuck], previous, requestMs: 60_000, deadlineMs: 800 }, { FAKE_ACP_LIST_HANG: hang });
    const took = Date.now() - t0;
    assert.ok(took < 3000, `${hang}: ended near the 800 ms deadline, not the 60 s per-question limit: ${took} ms`);
    assert.equal(r.late, true);
    assert.ok(r.rows.some(x => x.id === 'acp:ses_fine'), 'what answered is used');
    assert.equal(r.rows.find(x => x.id === 'acp:ses_old')?.title, 'Kept', 'the rest keep their previous rows');
  }
});

test('readAcpList ghost rows: dropped when the folder answered in full, when a cut answer reached past them, or when the folder is gone; kept when they may be past the cut or the folder was not read', async () => {
  const store = mkStore(), full = mkDir(), cut = mkDir(), unread = mkDir(), now = Date.now();
  const gone = path.join(os.tmpdir(), 'acp-gone-' + process.pid + '-' + now);
  seed(store, 'ses_here', full, now);
  for (let i = 0; i < 110; i++) seed(store, `ses_c${i}`, cut, now - 600_000 + i * 1000); // answer: the newest 100, oldest now-590 s
  const known = [
    { id: 'acp:ses_fullgone', cwd: full, at: now - 5000 },          // folder answered in full without it
    { id: 'acp:ses_pastcut', cwd: cut, at: now - 3_600_000 },       // older than the cut answer's oldest: may be past the cut
    { id: 'acp:ses_insidecut', cwd: cut, at: now - 60_000 },        // inside the answer's range, not in it: gone
    { id: 'acp:ses_gonedir', cwd: gone, at: now },                  // its folder no longer exists
    { id: 'acp:ses_unread', cwd: unread, at: now - 1000 },          // its folder is not asked (past maxFolders)
    { id: 'acp:ses_gonedir2', cwd: gone + '-2', at: now },          // a gone folder that is not asked either
  ];
  const previous = [{ id: 'acp:ses_prevfull', cwd: full, title: 'Was here', untitled: false, mtimeMs: now - 1000 }, { id: 'acp:ses_prevunread', cwd: unread, title: 'Still', untitled: false, mtimeMs: now - 2000 }];
  const r = await reader(store, { folders: [full, cut, gone], known, previous, maxFolders: 3 });
  const ids = new Set(r.rows.map(x => x.id));
  for (const id of ['acp:ses_fullgone', 'acp:ses_insidecut', 'acp:ses_gonedir', 'acp:ses_gonedir2', 'acp:ses_prevfull'])assert.ok(!ids.has(id), id + ' is dropped');
  for (const id of ['acp:ses_pastcut', 'acp:ses_unread', 'acp:ses_prevunread', 'acp:ses_here']) assert.ok(ids.has(id), id + ' stays');
  assert.equal(r.rows.find(x => x.id === 'acp:ses_prevunread').title, 'Still', 'a kept previous row keeps its title');
});

// ---------- 1.84.2: Full access, the cost line, and what the agent is doing ----------
test('Full access answers OpenCode\'s permission requests at once; Review actions still shows a card', async () => {
  const store = mkStore();
  let asked = 0;
  const { turn, ev } = await (async () => { const ev = []; const turn = await startAcpTurn({ ...turnOpts(store), approvalMode: 'full', hooks: { emit: e => ev.push(e), onApproval: () => asked++ } }); await turn.promptDone; return { turn, ev }; })();
  assert.ok(ev.some(e => e.type === 'result' && e.ok && e.stopReason === 'end_turn'), 'finished without anyone answering');
  assert.equal(asked, 0, 'no approval card');
  assert.equal(JSON.parse(fs.readFileSync(path.join(store, encodeURIComponent(turn.sessionId) + '.json'), 'utf8')).permissionOutcome, 'selected');
  afterEach();
  const r = await startAcpTurn({ ...turnOpts(mkStore()), approvalMode: 'review', hooks: {} });
  assert.ok(await waitFor(() => r.approvals.list().length > 0), 'review asks');
  stopAcpTurn(r.sessionId); await r.promptDone; afterEach();
});

test('the turn shows thinking and tool lines as they happen, then the text, and reports cost, time and cache', async () => {
  const store = mkStore();
  const { ev } = await runAllowed(turnOpts(store));
  const shown = ev.filter(e => e.type === 'assistant').map(e => e.msg.blocks);
  assert.deepEqual(shown, [[{ t: 'tool', name: 'Thinking', detail: 'Checking with a quick command.' }], [{ t: 'tool', name: 'Bash', detail: 'echo ACP_OK' }], [{ t: 'text', text: 'ran it; echo of do the thing' }]]);
  const r = ev.find(e => e.type === 'result');
  assert.equal(r.cost, 0.0021); assert.ok(Number.isFinite(r.duration_ms)); assert.equal(r.cache.hit, 24000 / 25000);
  assert.ok(!ev.some(e => e.type === 'acp_usage' || e.type === 'tool'), 'raw usage and tool events stay inside');
  afterEach();
});

test('cost per reply: the change in OpenCode\'s running total, across turns and a reopen; unknown start = no cost', async () => {
  const store = mkStore();
  const { turn } = await runAllowed(turnOpts(store));
  const id = 'acp:' + turn.sessionId;
  const second = (await runAllowed(turnOpts(store, { sessionId: id }))).ev.find(e => e.type === 'result');
  assert.equal(second.cost, 0.0021, 'the second reply alone, not the session so far');
  assert.equal(acpSessions.get(turn.sessionId).costTotal, 0.0042);
  closeAcpSession(id); // a restart: OpenCode does not report the total on reopen, so the caller passes the one it kept
  const kept = (await runAllowed(turnOpts(store, { sessionId: id, resume: true, costBaseline: 0.0042 }))).ev.find(e => e.type === 'result');
  assert.equal(kept.cost, 0.0021);
  closeAcpSession(id);
  const unknown = (await runAllowed(turnOpts(store, { sessionId: id, resume: true }))).ev.find(e => e.type === 'result');
  assert.equal(unknown.cost, undefined, 'no starting total: no cost line rather than the whole session\'s');
  assert.equal(acpSessions.get(turn.sessionId).costTotal, 0.0084, 'but the total is known for the next reply');
  afterEach();
});
