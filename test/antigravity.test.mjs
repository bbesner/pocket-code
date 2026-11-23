// The Antigravity runtime of the ACP engine (acp.mjs RUNTIMES.antigravity) against a stand-in for `agy acp`
// (fake-agy.mjs): no Google sign-in, no model, no network. Covers what differs from OpenCode: how it is started (only
// `agy acp`, never a flag that skips approvals, prints, signs in or names another program; no Gemini API key in its
// environment), its ids, its sign-in error, instructions and MCP servers passed with the session, questions as
// elicitation forms, a message steered into a reply, and a reply that waits for a background command.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.POCKET_ACP_SETTLE_QUIET_MS = '700'; // read when acp.mjs loads
process.env.POCKET_ACP_SETTLE_MAX_MS = '900';
process.env.POCKET_ACP_SETTLE_STEP_MS = '300';
process.env.POCKET_ACP_STOP_GRACE_MS = '1000';
const acp = await import('../acp.mjs');
const { ENGINES, engineForSessionId, takesUnattended, validateModelForEngine } = await import('../engines.mjs');
const { unattendedGate } = await import('../automation.mjs');

const FAKE = path.join(import.meta.dirname, 'fake-agy.mjs');
const FAKE_OPENCODE = path.join(import.meta.dirname, 'fake-acp.mjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const mkStore = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agy-store-'));
const launchOf = store => JSON.parse(fs.readFileSync(path.join(store, 'launch.json'), 'utf8'));
const sessOf = (store, sid) => JSON.parse(fs.readFileSync(path.join(store, `session-${sid}.json`), 'utf8'));
const opts = (store, extra = {}) => ({ cmd: FAKE, args: ['acp'], env: acp.runtimeEnv('antigravity', { ...process.env, FAKE_AGY_STORE: store, ...(extra.addEnv || {}) }), runtime: 'antigravity',
  cwd: os.tmpdir(), text: 'do the thing', model: 'gemini-4-neon', hooks: {}, ...extra });
const collect = () => { const ev = []; return { emit: e => ev.push(e), ev }; };
const waitFor = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 20)); } return false; };
const cleanup = () => { for (const [, s] of acp.acpSessions) { try { s.client.close(); } catch { } } acp.acpSessions.clear(); acp.acpTurns.clear(); };
afterEach(cleanup); // a failed test must not leave its agy process behind (the run would never end)
const said = ev => ev.filter(e => e.type === 'assistant').map(e => e.msg.text).join('\n');
const results = ev => ev.filter(e => e.type === 'result');

test('the registry: Antigravity is its own engine with its own ids, and takes no unattended work', () => {
  const e = ENGINES.antigravity;
  assert.equal(e.label, 'Antigravity'); assert.equal(e.idPrefix, 'agy:');
  assert.equal(e.features.steer, true); assert.equal(e.features.unattended, false);
  assert.equal(takesUnattended('antigravity'), false);
  for (const other of ['claude', 'codex', 'acp']) assert.equal(takesUnattended(other), true, other);
  const id = 'agy:0b9c2a44-6a51-4c0e-9d6e-3f1a1d7c9e10';
  assert.equal(engineForSessionId(id), 'antigravity');
  assert.equal(acp.runtimeForId(id).id, 'antigravity'); assert.equal(acp.runtimeForId('acp:ses_abc').id, 'opencode'); assert.equal(acp.runtimeForId('cx:x'), null);
  assert.ok(acp.isAcpId(id)); assert.equal(acp.bareAcpId(id), id.slice(4));
  assert.ok(acp.validAcpId(id)); assert.ok(acp.validAcpId('acp:ses_abc123'));
  assert.ok(!acp.validAcpId('agy:ses_abc123'), 'an OpenCode id behind the Antigravity prefix');
  assert.ok(!acp.validAcpId('acp:' + id.slice(4)), 'an Antigravity id behind the OpenRouter prefix');
  assert.ok(!acp.validAcpId('agy:../../etc/passwd'));
  validateModelForEngine('antigravity', 'gemini-4-neon'); validateModelForEngine('antigravity', 'claude-opus-5-5');
  assert.throws(() => validateModelForEngine('antigravity', 'openrouter/deepseek/deepseek-v4.1-flash-1017'), /Choose an Antigravity model/);
});

test('the gate: an engine where a person sends every message refuses every unattended origin', () => {
  const ctx = { paused: false, ownBlocked: false, features: { checkback: true, job: true }, limits: {}, counts: {}, now: Date.now() };
  for (const origin of ['queue', 'retry', 'coordination', 'checkback', 'job']) {
    const r = unattendedGate({ origin, rootOrigin: 'owner', engine: 'antigravity', attendedOnly: true }, ctx);
    assert.equal(r.ok, false, origin); assert.equal(r.reason, 'attended_only', origin);
  }
});

test('how agy is started: always `acp`, never a flag that skips approvals, prints, signs in or renames the client', () => {
  assert.deepEqual(acp.antigravityArgs(''), { args: ['acp'], dropped: [] });
  assert.deepEqual(acp.antigravityArgs('acp --disable-telemetry'), { args: ['acp', '--disable-telemetry'], dropped: [] });
  const r = acp.antigravityArgs('--dangerously-skip-permissions --override_user_agent_name codex-cli --disable-telemetry -p hello --print --override-user-agent-name=x --login');
  assert.deepEqual(r.args, ['acp', '--disable-telemetry']);
  assert.deepEqual(r.dropped, ['--dangerously-skip-permissions', '--override_user_agent_name', '-p', '--print', '--override-user-agent-name=x', '--login']);
});

test('off unless the server turns it on and agy is there', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-home-'));
  assert.equal(acp.antigravityConfig({ HOME: home, PATH: '' }), null, 'not enabled');
  assert.equal(acp.antigravityConfig({ HOME: home, PATH: '', POCKET_AGY_CMD: FAKE }), null, 'a path alone does not enable it');
  assert.equal(acp.antigravityConfig({ HOME: home, PATH: '', POCKET_AGY_ENABLE: '1' }), null, 'enabled, but no agy on this server');
  const on = acp.antigravityConfig({ HOME: home, PATH: '', POCKET_AGY_ENABLE: '1', POCKET_AGY_CMD: FAKE, POCKET_AGY_MODEL: 'gemini-4-neon', POCKET_AGY_ARGS: '--disable-telemetry --dangerously-skip-permissions' });
  assert.deepEqual(on, { cmd: FAKE, args: ['acp', '--disable-telemetry'], dropped: ['--dangerously-skip-permissions'], model: 'gemini-4-neon' });
  assert.equal(acp.antigravityConfig({ HOME: home, PATH: '', POCKET_AGY_ENABLE: '1', POCKET_AGY_CMD: FAKE, POCKET_AGY_MODEL: 'a model; rm -rf' }).model, null);
  // found in ~/.local/bin, where Google's installer puts it
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true }); fs.copyFileSync(FAKE, path.join(home, '.local', 'bin', 'agy')); fs.chmodSync(path.join(home, '.local', 'bin', 'agy'), 0o755);
  assert.equal(acp.antigravityConfig({ HOME: home, PATH: '', POCKET_AGY_ENABLE: 'true' }).cmd, path.join(home, '.local', 'bin', 'agy'));
  fs.rmSync(home, { recursive: true, force: true });
});

test('its environment has no Gemini API key, so a reply can only run on the signed-in plan', () => {
  const env = { PATH: '/bin', GEMINI_API_KEY: 'k1', GOOGLE_API_KEY: 'k2', GOOGLE_GENAI_USE_VERTEXAI: 'true', OPENROUTER_API_KEY: 'k3' };
  assert.deepEqual(acp.runtimeEnv('antigravity', env), { PATH: '/bin', OPENROUTER_API_KEY: 'k3' });
  assert.deepEqual(acp.runtimeEnv('opencode', env), env, 'OpenCode keeps its environment');
  assert.equal(env.GEMINI_API_KEY, 'k1', 'the caller\'s environment is not changed');
});

test('MCP servers: the ones the CLI\'s own config lists, in the shape session/new takes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mcp-')), file = path.join(dir, 'mcp_config.json');
  assert.deepEqual(acp.antigravityMcpServers({ POCKET_AGY_MCP_CONFIG: file }), [], 'no file');
  fs.writeFileSync(file, '{ not json');
  assert.deepEqual(acp.antigravityMcpServers({ POCKET_AGY_MCP_CONFIG: file }), [], 'unreadable');
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { memory: { command: '/usr/bin/mem', args: ['mcp'], env: { A: 1 } }, remote: { url: 'https://x.test/mcp' }, off: { command: 'x', disabled: true } } }));
  assert.deepEqual(acp.antigravityMcpServers({ POCKET_AGY_MCP_CONFIG: file }), [{ name: 'memory', command: '/usr/bin/mem', args: ['mcp'], env: [{ name: 'A', value: '1' }] }]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a question form becomes question cards, and the answers go back in the form\'s own terms', () => {
  const form = acp.elicitationForm({ mode: 'form', message: 'The agent has a question.', requestedSchema: { type: 'object', properties: {
    q1: { type: 'string', title: 'Which color?', oneOf: [{ const: '1', title: 'Blue' }, { const: '2', title: 'Red' }] },
    q1_other: { type: 'string', title: 'Other', description: 'Optional free-form answer to: Which color?' },
    q2: { type: 'array', title: 'Which sizes?', items: { type: 'string', enum: ['s', 'm', 'l'] } },
    q3: { type: 'integer', title: 'How many?' },
    q4: { type: 'boolean', title: 'Gift wrap?' } } } });
  assert.deepEqual(form.questions.map(q => [q.id, q.question, q.options?.map(o => o.label), q.multiple]), [
    ['q1', 'Which color?', ['Blue', 'Red'], false], ['q2', 'Which sizes?', ['s', 'm', 'l'], true], ['q3', 'How many?', undefined, false], ['q4', 'Gift wrap?', ['Yes', 'No'], false]]);
  assert.deepEqual(form.content({ q1: { answers: ['Red'] }, q2: { answers: ['s', 'l'] }, q3: { answers: ['3'] }, q4: { answers: ['No'] } }), { q1: '2', q2: ['s', 'l'], q3: 3, q4: false });
  assert.deepEqual(form.content({ q1: { answers: ['Teal, please'] } }), { q1_other: 'Teal, please' }, 'an answer of your own goes in the form\'s free-text field');
  assert.deepEqual(form.content({}), {});
  assert.equal(acp.elicitationForm({ mode: 'url', url: 'https://x.test' }), null, 'only forms');
  assert.equal(acp.elicitationForm({ mode: 'form', requestedSchema: { type: 'object', properties: {} } }), null);
});

test('not signed in reads as a sign-in instruction, on Antigravity only', () => {
  const e = acp.runtimeError('antigravity', new Error('Authentication required'));
  assert.equal(e.signIn, true); assert.equal(e.status, 409); assert.match(e.message, /agy acp --login/);
  const other = new Error('Authentication required');
  assert.equal(acp.runtimeError('opencode', other), other);
  const plain = new Error('boom');
  assert.equal(acp.runtimeError('antigravity', plain), plain);
});

test('the model menu: the plan\'s models with their thinking levels, the plan\'s name, and signed-out as a state', async () => {
  const store = mkStore(), marker = path.join(store, 'signed-out');
  const o = opts(store, { addEnv: { FAKE_AGY_SIGNED_OUT: marker } });
  const m = await acp.probeAcpModels({ cmd: o.cmd, args: o.args, env: o.env, cwd: os.tmpdir(), runtime: 'antigravity' });
  assert.equal(m.signedIn, true); assert.equal(m.plan, 'Google AI Pro'); assert.equal(m.defaultModel, 'gemini-4-neon');
  assert.deepEqual(m.models, [
    { id: 'gemini-4-neon', label: 'Gemini 4 Neon', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', efforts: ['low', 'medium', 'high'], defaultEffort: 'low' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', efforts: [], defaultEffort: null }]);
  assert.deepEqual(acp.acpCommands('antigravity').map(c => c.name), ['goal', 'compact'], 'its own commands, without the one that starts work later');
  fs.writeFileSync(marker, '');
  const out = await acp.probeAcpModels({ cmd: o.cmd, args: o.args, env: o.env, cwd: os.tmpdir(), runtime: 'antigravity' });
  assert.equal(out.signedIn, false); assert.match(out.message, /agy acp --login/); assert.deepEqual(out.models, []);
  await assert.rejects(acp.startAcpTurn(opts(store, { addEnv: { FAKE_AGY_SIGNED_OUT: marker } })), e => e.signIn === true && /not signed in/.test(e.message));
});

test('a reply: started as Pocket Code over `agy acp`, instructions and MCP servers with the session, an approval card, then done', async () => {
  const store = mkStore(), { emit, ev } = collect();
  const servers = [{ name: 'memory', command: '/usr/bin/mem', args: ['mcp'], env: [] }];
  const turn = await acp.startAcpTurn(opts(store, { addEnv: { GEMINI_API_KEY: 'k1', GOOGLE_API_KEY: 'k2' }, mcpServers: servers,
    hooks: { emit, instructions: sid => `Pocket rules for ${sid || 'a new conversation'}.` } }));
  assert.match(turn.sessionId, UUID); assert.equal(turn.fullId, 'agy:' + turn.sessionId);
  assert.ok(await waitFor(() => turn.approvals.list().length > 0), 'an approval card appeared');
  const card = turn.approvals.list()[0];
  assert.equal(card.kind, 'command'); assert.equal(JSON.parse(card.details).command, 'echo AGY_OK');
  await turn.approvals.decide(card.id, 'allow');
  await turn.promptDone;
  assert.ok(await waitFor(() => turn.done));
  assert.match(said(ev), /ran it; heard: do the thing/);
  const res = results(ev);
  assert.equal(res.length, 1); assert.equal(res[0].stopReason, 'end_turn'); assert.equal(res[0].tokens, 1230, 'tokens, not a cost: the reply ran on a plan');
  assert.equal(res[0].cost ?? null, null);
  const tools = ev.filter(e => e.type === 'assistant').flatMap(e => e.msg.blocks || []).filter(b => b.t === 'tool');
  assert.ok(tools.some(b => b.name === 'Bash' && b.detail === 'echo AGY_OK'), 'the command is shown: ' + JSON.stringify(tools));
  const l = launchOf(store);
  assert.deepEqual(l.argv, ['acp']);
  assert.deepEqual(l.clientInfo.name, 'pocket-code'); assert.deepEqual(l.clientCapabilities, { elicitation: { form: {} } });
  assert.deepEqual([l.env.GEMINI_API_KEY, l.env.GOOGLE_API_KEY], [false, false], 'no API key reached agy');
  const s = sessOf(store, turn.sessionId);
  assert.equal(s.append, 'Pocket rules for a new conversation.'); assert.deepEqual(s.mcpServers, servers);
  assert.deepEqual(s.ranOn, { model: 'gemini-4-neon', effort: 'medium', mode: 'default' });
  assert.equal(s.permission, 'allow');
});

test('deny: the command does not run and the reply says so', async () => {
  const store = mkStore(), { emit, ev } = collect();
  const turn = await acp.startAcpTurn(opts(store, { hooks: { emit } }));
  assert.ok(await waitFor(() => turn.approvals.list().length > 0));
  await turn.approvals.decide(turn.approvals.list()[0].id, 'deny');
  await turn.promptDone;
  assert.equal(sessOf(store, turn.sessionId).permission, 'deny'); assert.match(said(ev), /did not run it/);
});

test('model, thinking level and Plan first are set with the session\'s own options; a reopened conversation gets its instructions again', async () => {
  const store = mkStore();
  const first = await acp.startAcpTurn(opts(store, { text: 'one __NOASK__', model: 'gemini-3.8-flash', effort: 'high', executionMode: 'plan', hooks: { instructions: sid => `rules ${sid}` } }));
  await first.promptDone;
  const sid = first.sessionId;
  assert.deepEqual(sessOf(store, sid).ranOn, { model: 'gemini-3.8-flash', effort: 'high', mode: 'plan' });
  // Default goes back to the level the model starts on; work mode again
  const second = await acp.startAcpTurn(opts(store, { sessionId: 'agy:' + sid, text: 'two __NOASK__', model: 'gemini-3.8-flash', effort: 'default' }));
  await second.promptDone;
  assert.deepEqual(sessOf(store, sid).ranOn, { model: 'gemini-3.8-flash', effort: 'low', mode: 'default' });
  // a model with no thinking levels takes none
  const third = await acp.startAcpTurn(opts(store, { sessionId: 'agy:' + sid, text: 'three __NOASK__', model: 'claude-opus-5-5', effort: 'high' }));
  await third.promptDone;
  assert.deepEqual(sessOf(store, sid).ranOn, { model: 'claude-opus-5-5', effort: null, mode: 'default' });
  // a model the plan does not list: the reply ends with the reason, and nothing is sent
  const bad = collect(), fourth = await acp.startAcpTurn(opts(store, { sessionId: 'agy:' + sid, text: 'four', model: 'gemini-9-unobtainium', hooks: { emit: bad.emit } }));
  await fourth.promptDone;
  assert.match(results(bad.ev)[0].error, /Antigravity does not offer gemini-9-unobtainium/);
  // reopened in a new process: session/load, with Pocket's instructions naming the conversation
  acp.closeAcpSession('agy:' + sid);
  const again = await acp.startAcpTurn(opts(store, { sessionId: 'agy:' + sid, resume: true, text: 'five __NOASK__', hooks: { instructions: id => `rules for ${id}` } }));
  await again.promptDone;
  const s = sessOf(store, sid);
  assert.equal(s.opened, 'load'); assert.equal(s.append, `rules for agy:${sid}`);
  assert.deepEqual(s.prompts, ['one __NOASK__', 'two __NOASK__', 'three __NOASK__', 'five __NOASK__']);
});

test('a question: a card to answer, not a tool line; a choice, an answer of your own, a skip and a stop each reach agy', async () => {
  const store = mkStore();
  const ask = async answer => {
    const { emit, ev } = collect();
    const turn = await acp.startAcpTurn(opts(store, { text: 'pick __QUESTION__', hooks: { emit } }));
    assert.ok(await waitFor(() => turn.questions.list().length > 0), 'a question card appeared');
    const q = turn.questions.list()[0];
    await answer(turn, q);
    await turn.promptDone; await waitFor(() => turn.done);
    return { ev, q, s: sessOf(store, turn.sessionId) };
  };
  const picked = await ask((turn, q) => turn.questions.answer(q.id, { q1: ['Blue'] }));
  assert.deepEqual(picked.q.questions.map(x => [x.question, x.options.map(o => o.label)]), [['Which color?', ['Blue', 'Red']]]);
  assert.deepEqual(picked.s.elicit, { action: 'accept', content: { q1: '1' } });
  assert.match(said(picked.ev), /You chose Blue\./);
  const blocks = picked.ev.filter(e => e.type === 'assistant').flatMap(e => e.msg.blocks || []).filter(b => b.t === 'tool');
  assert.ok(!blocks.some(b => /ask_question/i.test(JSON.stringify(b))), 'the question tool is not shown as a tool line');
  const own = await ask((turn, q) => turn.questions.answer(q.id, { q1: ['Teal'] }));
  assert.deepEqual(own.s.elicit, { action: 'accept', content: { q1_other: 'Teal' } });
  assert.match(said(own.ev), /your own answer: Teal/);
  const skipped = await ask(turn => { turn.questions.skipBlocking('The user sent a message instead.'); });
  assert.deepEqual(skipped.s.elicit, { action: 'decline' });
  const stopped = await ask(turn => { acp.stopAcpTurn(turn.sessionId); });
  assert.ok(['cancel', 'aborted'].includes(stopped.s.elicit.action), JSON.stringify(stopped.s.elicit));
  assert.equal(results(stopped.ev)[0].stopReason, 'cancelled');
});

test('a message sent during a reply goes into it: one reply, both messages, one result', async () => {
  const store = mkStore(), { emit, ev } = collect();
  const turn = await acp.startAcpTurn(opts(store, { text: 'first __HANG__', hooks: { emit } }));
  assert.ok(await waitFor(() => turn.promptStarted));
  await new Promise(r => setTimeout(r, 100));
  assert.equal(acp.steerAcpTurn('agy:' + turn.sessionId, 'second __NOASK__', { images: [{ mimeType: 'image/png', data: 'aGk=' }] }), true);
  assert.ok(await waitFor(() => turn.done), 'the reply ended after the steered message');
  assert.deepEqual(ev.filter(e => e.type === 'user').map(e => e.msg.text), ['first __HANG__', 'second __NOASK__']);
  assert.match(said(ev), /ran it; heard: second/);
  assert.equal(results(ev).length, 1); assert.equal(results(ev)[0].stopReason, 'end_turn');
  const s = sessOf(store, turn.sessionId);
  assert.deepEqual(s.prompts, ['first __HANG__', 'second __NOASK__']); assert.equal(s.seen.images, 1);
  assert.equal(acp.steerAcpTurn('agy:' + turn.sessionId, 'too late'), false, 'nothing to steer into once the reply is over');
});

test('OpenCode still takes no message during a reply', async () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-store-'));
  const turn = await acp.startAcpTurn({ cmd: process.execPath, args: [FAKE_OPENCODE], env: { ...process.env, POCKET_ACP_STORE: store }, text: 'do the thing', model: 'openrouter/deepseek/deepseek-v4.1-flash-1017', hooks: {} });
  assert.ok(await waitFor(() => turn.approvals.list().length > 0));
  assert.equal(turn.fullId, 'acp:' + turn.sessionId);
  assert.equal(acp.steerAcpTurn('acp:' + turn.sessionId, 'more'), false);
  acp.stopAcpTurn(turn.sessionId); await turn.promptDone; cleanup();
});

test('a background command: the reply stays open until the command ends and the model has had its say', async () => {
  const store = mkStore(), { emit, ev } = collect();
  const turn = await acp.startAcpTurn(opts(store, { text: 'long job __BG__ __NOASK__', hooks: { emit } }));
  await turn.promptDone; // the prompt itself returned
  assert.equal(turn.done, false, 'the prompt returned, the reply has not');
  assert.equal(results(ev).length, 0);
  assert.ok(await waitFor(() => turn.done, 5000));
  assert.match(said(ev), /Started it in the background\.[\s\S]*The background command finished: BG_DONE\./);
  assert.equal(results(ev).length, 1); assert.equal(results(ev)[0].stopReason, 'end_turn');
  assert.ok(!acp.acpTurns.has(turn.sessionId));
});

test('1.123.1: a step after the background command reports itself before its next command; the reply waits for it', async () => {
  const store = mkStore(), { emit, ev } = collect();
  const turn = await acp.startAcpTurn(opts(store, { text: 'render then copy __BGMORE__ __NOASK__', approvalMode: 'full', hooks: { emit } }));
  await turn.promptDone;
  assert.equal(turn.done, false);
  assert.ok(await waitFor(() => turn.done, 5000));
  const s = sessOf(store, turn.sessionId);
  assert.equal(s.permission2, 'allow', 'the next command was asked about while the reply was still open, and allowed');
  assert.match(said(ev), /Started it in the background\.[\s\S]*Copied it: FOLLOWUP_OK\./);
  assert.equal(results(ev).length, 1); assert.equal(results(ev)[0].stopReason, 'end_turn');
});

// 1.124.2: the settle timers ended a reply that was waiting on the owner: an approval after the background command was
// dropped unanswered after SETTLE_MAX_MS, a question cancelled after SETTLE_QUIET_MS.
test('1.124.2: after a background command, an approval or a question waits for the owner, past every settle timer', async () => {
  const store = mkStore();
  const a = collect(), approve = await acp.startAcpTurn(opts(store, { text: 'render then copy __BGMORE__', hooks: { emit: a.emit } }));
  assert.ok(await waitFor(() => approve.approvals.list().length === 1));
  await approve.approvals.decide(approve.approvals.list()[0].id, 'allow'); // the command, which goes to the background
  await approve.promptDone;
  assert.ok(await waitFor(() => approve.approvals.list().length === 1, 3000), 'the next command asks');
  await new Promise(r => setTimeout(r, 1500)); // longer than every settle timer (300, 700 and 900 ms here)
  assert.equal(approve.done, false, 'the reply still waits on the approval');
  assert.equal(approve.approvals.list().length, 1, 'and the card is still there');
  await approve.approvals.decide(approve.approvals.list()[0].id, 'allow');
  assert.ok(await waitFor(() => approve.done, 3000));
  assert.equal(sessOf(store, approve.sessionId).permission2, 'allow', 'the late answer reached agy');
  assert.match(said(a.ev), /Copied it: FOLLOWUP_OK\./);
  assert.equal(results(a.ev).length, 1); assert.equal(results(a.ev)[0].stopReason, 'end_turn');

  const q = collect(), ask = await acp.startAcpTurn(opts(store, { text: 'render then ask __BGASK__ __NOASK__', hooks: { emit: q.emit } }));
  await ask.promptDone;
  assert.ok(await waitFor(() => ask.questions.list().length === 1, 3000), 'the question card is shown');
  await new Promise(r => setTimeout(r, 1500));
  assert.equal(ask.done, false, 'the reply still waits on the question');
  ask.questions.answer(ask.questions.list()[0].id, { q1: ['Claim folder'] });
  assert.ok(await waitFor(() => ask.done, 3000));
  assert.deepEqual(sessOf(store, ask.sessionId).elicit, { action: 'accept', content: { q1: '1' } });
  assert.match(said(q.ev), /Copied it: ANSWERED_OK\./);
  assert.equal(results(q.ev)[0].stopReason, 'end_turn');
});

test('1.123.1: the last step ends the reply after the short grace, not the two-minute wait', async () => {
  const store = mkStore(), { emit, ev } = collect();
  const turn = await acp.startAcpTurn(opts(store, { text: 'long job __BG__ __NOASK__', hooks: { emit } }));
  await turn.promptDone;
  assert.ok(await waitFor(() => /BG_DONE\./.test(said(ev)) || ev.some(e => e.type === 'delta' && /BG_DONE\./.test(e.text)), 3000));
  const t0 = Date.now();
  assert.equal(turn.done, false, 'not at the usage_update itself');
  assert.ok(await waitFor(() => turn.done, 3000));
  const waited = Date.now() - t0;
  assert.ok(waited >= 150 && waited < 700, `ended after the step grace (300 ms), not the quiet wait (700 ms): ${waited} ms`);
});

test('a background command that never ends: the reply ends by itself after the wait, stopping nothing', async () => {
  const store = mkStore(), { emit, ev } = collect();
  const turn = await acp.startAcpTurn(opts(store, { text: 'server __BGHANG__ __NOASK__', hooks: { emit } }));
  await turn.promptDone;
  assert.equal(turn.done, false);
  const t0 = Date.now();
  assert.ok(await waitFor(() => turn.done, 5000));
  assert.ok(Date.now() - t0 >= 600, 'it waited the long wait, since a command was still running');
  assert.equal(results(ev)[0].stopReason, 'end_turn'); assert.equal(turn.stopped, false);
});

test('stop: while a prompt runs, and while only a background command does', async () => {
  const store = mkStore();
  const a = collect(), running = await acp.startAcpTurn(opts(store, { text: 'wait __HANG__', hooks: { emit: a.emit } }));
  await waitFor(() => running.promptStarted);
  assert.equal(acp.stopAcpTurn('agy:' + running.sessionId), true);
  assert.ok(await waitFor(() => running.done));
  assert.equal(results(a.ev)[0].stopReason, 'cancelled');
  const b = collect(), bg = await acp.startAcpTurn(opts(store, { text: 'server __BGHANG__ __NOASK__', hooks: { emit: b.emit } }));
  await bg.promptDone;
  assert.equal(bg.done, false);
  acp.stopAcpTurn('agy:' + bg.sessionId, 'Stopped by Pause all');
  assert.equal(bg.done, true, 'no prompt is open to answer the cancel, so it ends at once');
  assert.deepEqual([results(b.ev)[0].stopReason, results(b.ev)[0].error], ['cancelled', 'Stopped by Pause all']);
});

// 1.124.2: Stop cleared the approval card without answering the agent, which ACP requires (the cancelled outcome), and
// nothing followed a cancel the agent did not act on: the reply stayed running until its one-hour prompt timeout.
test('1.124.2: Stop answers a waiting approval as cancelled, so an agent that waits for that answer ends the reply', async () => {
  const store = mkStore(), { emit, ev } = collect();
  const turn = await acp.startAcpTurn(opts(store, { addEnv: { FAKE_AGY_CANCEL_WAITS: '1' }, hooks: { emit } }));
  assert.ok(await waitFor(() => turn.approvals.list().length === 1));
  const pid = turn.client.pid;
  acp.stopAcpTurn('agy:' + turn.sessionId);
  assert.ok(await waitFor(() => turn.done, 700), 'the reply ended on the agent\'s own answer, before the grace');
  assert.equal(sessOf(store, turn.sessionId).permission, 'cancelled', 'the agent was told the request was cancelled');
  assert.deepEqual([results(ev)[0].stopReason, results(ev)[0].error], ['cancelled', 'Stopped by you']);
  assert.equal(acp.acpSessions.get(turn.sessionId)?.client.pid, pid, 'its process is kept for the next message');
});

test('1.124.2: Stop on an agent that does not act on the cancel closes its process after the grace and ends the reply', async () => {
  const store = mkStore(), { emit, ev } = collect(), finished = [];
  const turn = await acp.startAcpTurn(opts(store, { text: 'wait __HANG__', addEnv: { FAKE_AGY_IGNORE_CANCEL: '1' }, hooks: { emit, onFinish: r => finished.push(r) } }));
  try {
    assert.ok(await waitFor(() => turn.openPrompts === 1));
    acp.stopAcpTurn('agy:' + turn.sessionId, 'Stopped: no activity for 30 minutes');
    acp.stopAcpTurn('agy:' + turn.sessionId, 'Stopped: no activity for 30 minutes'); // the watchdog asks again a minute later
    await new Promise(r => setTimeout(r, 400));
    assert.equal(turn.done, false, 'the agent gets its grace to end the reply itself');
    assert.ok(await waitFor(() => turn.done, 3000), 'then the reply ends');
    assert.deepEqual([results(ev)[0].stopReason, results(ev)[0].error], ['cancelled', 'Stopped: no activity for 30 minutes']);
    assert.equal(finished.length, 1);
    assert.ok(!acp.acpSessions.has(turn.sessionId) && !acp.acpTurns.has(turn.sessionId), 'its process was closed; the next message opens a new one');
  } finally { for (const [, p] of turn.client.pending) clearTimeout(p.timer); }
});

test('the list and the history come from agy itself, under the Antigravity prefix', async () => {
  const store = mkStore();
  const turn = await acp.startAcpTurn(opts(store, { text: 'remember the walrus __NOASK__' }));
  await turn.promptDone; await waitFor(() => turn.done);
  fs.writeFileSync(path.join(store, 'session-ses_notours.json'), JSON.stringify({ updates: [], cwd: '/tmp' })); // an id of another shape
  const o = opts(store);
  const rows = await acp.listAcpSessions({ cmd: o.cmd, args: o.args, env: o.env, runtime: 'antigravity' });
  assert.deepEqual(rows.map(r => [r.id, r.provider, r.title, r.untitled]), [['agy:' + turn.sessionId, 'antigravity', 'remember the walrus', false]]);
  acp.closeAcpSession('agy:' + turn.sessionId);
  const replay = acp.messagesFromEvents(await acp.readAcpTranscript({ sessionId: 'agy:' + turn.sessionId, cmd: o.cmd, args: o.args, env: o.env, runtime: 'antigravity' }));
  assert.deepEqual(replay.map(m => m.role), ['user', 'assistant']);
  assert.match(replay[1].text, /ran it; heard: remember the walrus/);
});
