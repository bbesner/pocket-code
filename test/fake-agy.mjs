#!/usr/bin/env node
// Integration-only stand-in for Google's Antigravity CLI in ACP mode (`agy acp`): JSON-RPC 2.0 over stdio, never signs
// in anywhere and never calls a model. It answers the way agy 1.5.14 did when probed live (2026-11-20), where that
// differs from OpenCode (test/fake-acp.mjs):
//   · it runs only as `<this file> acp [flags]`, and notes how it was started (launch.json in the store: its arguments,
//     which Google API-key variables reached it, and how the client named itself at initialize)
//   · session ids are bare UUIDs; the plan's name comes with session/new (_meta.antigravity.tier)
//   · the config options are `model`, `thought_level` and `mode` (default | accept-edits | plan)
//   · not signed in: session/new and session/load fail with -32000 "Authentication required"
//   · instructions arrive as _meta.antigravity.systemPrompt.append on session/new and session/load, MCP servers as
//     mcpServers; both are noted with the session
//   · approvals: session/request_permission with a string id and the options allow (allow_once) / deny (reject_once)
//   · questions: a hidden ask_question tool call, then elicitation/create with a form
//   · a second session/prompt during a reply ends the first with end_turn and carries on with the new text
//   · a background command: the prompt returns while the command still runs; its end, the model's last words and a
//     usage_update come afterwards with no prompt open
//
// Env: FAKE_AGY_STORE (required, dir) · FAKE_AGY_SIGNED_OUT (a marker file: while it exists nobody is signed in) ·
// FAKE_AGY_HISTORY_DELAY_MS (a session/load that only reads the history answers this much later) ·
// FAKE_AGY_LIST_DELAY_MS (session/list answers this much later, with the list as it was when asked) ·
// FAKE_AGY_CANCEL_WAITS (on session/cancel the reply ends, but a permission it is asking about waits for the client's
// answer, which ACP requires the client to send as the cancelled outcome) · FAKE_AGY_IGNORE_CANCEL (session/cancel is
// ignored: a wedged agent)
// Prompt markers, the same the Claude, Codex and OpenCode fakes take (test/engine-parity.test.mjs): __SLOW__ (1.5 s) ·
// __HANG__ (waits to be stopped or steered) · __CHOICES__ / __DONE__ (ends with that block) · __QUESTION__ (asks "Which
// color?" with Blue and Red) · __PLAN__ (a plan of two steps) · __EDIT__ (edits parity.txt, "old line" to "new line") ·
// __LIMIT__ (a 429) · __COST__ (a reply slow enough to watch). Its own: __NOASK__ (no approval) · __BG__ (a background
// command that ends 400 ms after the prompt returns) · __BGHANG__ (one that never ends) · __BGMORE__ (after the
// background command, a step whose usage_update comes before its next command, which asks for approval; the answer is
// noted as permission2) · __BGASK__ (after the background command, a question, as __QUESTION__ asks it; the answer is
// noted as elicit) · __SIGNOUT__ (fails as signed out). Each prompt notes what reached it (session-<id>.json: prompts, seen, ranOn, runnerToken).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';

const STORE = process.env.FAKE_AGY_STORE;
if (!STORE) throw new Error('FAKE_AGY_STORE required');
fs.mkdirSync(STORE, { recursive: true });
const argv = process.argv.slice(2);
if (argv[0] !== 'acp') { process.stderr.write('fake agy: only `acp` is supported\n'); process.exit(2); }
const launch = { argv, env: Object.fromEntries(['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'POCKET_RUNNER_TOKEN'].map(k => [k, Boolean(process.env[k])])) };
const writeJson = (file, o) => { const tmp = `${STORE}.${process.pid}.${randomUUID()}.tmp`; fs.writeFileSync(tmp, JSON.stringify(o)); fs.renameSync(tmp, file); };
const noteLaunch = () => writeJson(path.join(STORE, 'launch.json'), launch);
noteLaunch();
const sessFile = id => path.join(STORE, 'session-' + id + '.json');
const loadSess = id => { try { return JSON.parse(fs.readFileSync(sessFile(id), 'utf8')); } catch { return null; } };
const saveSess = (id, s) => writeJson(sessFile(id), s);
const signedOut = () => Boolean(process.env.FAKE_AGY_SIGNED_OUT && fs.existsSync(process.env.FAKE_AGY_SIGNED_OUT));

process.stdin.on('end', () => process.exit(0));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
const send = o => process.stdout.write(JSON.stringify(o) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, message, code = -32600) => send({ jsonrpc: '2.0', id, error: { code, message } });
const update = (sid, u) => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: sid, update: u } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// This program's own requests to the client (string ids, as agy sends), awaiting the answer.
const clientPending = new Map();
const askClient = (sid, method, params) => new Promise(res => { const id = 'srv-' + randomUUID(); clientPending.set(id, { res, sid }); send({ jsonrpc: '2.0', id, method, params }); });
const abortAsks = sid => { for (const [id, p] of clientPending) if (p.sid === sid) { clientPending.delete(id); p.res({ aborted: true }); } };

// The models a Google AI Pro plan lists, each with its thinking levels and the one it starts on (null: no setting).
const MODELS = {
  'gemini-4-neon': { name: 'Gemini 4 Neon', levels: ['low', 'medium', 'high', 'xhigh'], start: 'medium' },
  'gemini-3.8-flash': { name: 'Gemini 3.8 Flash', levels: ['low', 'medium', 'high'], start: 'low' },
  'claude-opus-5-5': { name: 'Claude Opus 5.5', levels: null, start: null },
};
const MODES = ['default', 'accept-edits', 'plan'];
const conf = new Map(); // sessionId -> { model, level, mode }: in this process's memory, as in agy
const confOf = sid => { if (!conf.has(sid)) conf.set(sid, { model: 'gemini-4-neon', level: 'medium', mode: 'default' }); return conf.get(sid); };
const configOptions = c => {
  const out = [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: c.model, options: Object.entries(MODELS).map(([value, m]) => ({ value, name: m.name })) }];
  const m = MODELS[c.model];
  if (m.levels) out.push({ id: 'thought_level', name: 'Thinking', category: 'thought_level', type: 'select', currentValue: c.level, options: m.levels.map(v => ({ value: v, name: v })) });
  out.push({ id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: c.mode, options: MODES.map(v => ({ value: v, name: v })) });
  return out;
};
const COMMANDS = [{ name: 'goal', description: 'Work toward a goal' }, { name: 'compact', description: 'Summarize the conversation so far' }, { name: 'schedule', description: 'Run something later' }];
const metaAppend = params => params?._meta?.antigravity?.systemPrompt?.append ?? null;

const running = new Map(); // sessionId -> { id, steered, cancelled }: the prompt in flight
const live = new Map(); // sessionId -> its record, while this process works on it

async function handlePrompt(id, params) {
  // one object per session in this process, so a steered prompt and the one it replaced write the same record
  const sid = params.sessionId, s = live.get(sid) || loadSess(sid);
  if (s) live.set(sid, s);
  if (!s) return fail(id, 'unknown session');
  const text = (params.prompt || []).map(p => p.text || '').join('');
  // A prompt during a reply goes into it: the earlier prompt ends with end_turn and this one carries on.
  const before = running.get(sid);
  if (before) { before.steered = true; abortAsks(sid); }
  const me = { id, steered: false, cancelled: false };
  running.set(sid, me);
  const over = () => me.steered || me.cancelled;
  const end = () => { if (running.get(sid) === me) running.delete(sid); saveSess(sid, s); return reply(id, { stopReason: me.cancelled ? 'cancelled' : 'end_turn', usage: { inputTokens: 1200, outputTokens: 30, totalTokens: 1230 } }); };
  const push = u => { update(sid, u); s.updates.push(u); };
  const c = confOf(sid);
  (s.prompts ||= []).push(text);
  s.ranOn = { model: c.model, effort: MODELS[c.model].levels ? c.level : null, mode: c.mode };
  s.seen = { text, images: (params.prompt || []).filter(p => p.type === 'image').length };
  s.runnerToken = process.env.POCKET_RUNNER_TOKEN || null;
  s.updates.push({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text } });
  if (!s.title) { s.title = text.replace(/__\w+__/g, '').trim().slice(0, 40) || 'Conversation'; update(sid, { sessionUpdate: 'session_info_update', title: s.title }); }
  s.updatedAt = Date.now();
  saveSess(sid, s);
  if (text.includes('__SIGNOUT__')) { running.delete(sid); return fail(id, 'Authentication required', -32000); }
  if (text.includes('__LIMIT__')) { running.delete(sid); return fail(id, 'Resource exhausted (429). Retry after 2 seconds.', -32603); }
  update(sid, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Checking with a quick command.' } });

  if (text.includes('__HANG__')) { while (!over()) await sleep(40); return end(); }
  if (text.includes('__SLOW__')) { for (let i = 0; i < 30 && !over(); i++) await sleep(50); if (over()) return end(); }

  if (text.includes('__QUESTION__')) {
    const tid = randomUUID();
    update(sid, { sessionUpdate: 'tool_call', toolCallId: tid, name: 'ask_question', kind: 'other', status: 'in_progress', title: 'Run ask_question', args: {} });
    const ans = await askClient(sid, 'elicitation/create', { sessionId: sid, toolCallId: tid, mode: 'form', message: 'The agent has a question.',
      requestedSchema: { type: 'object', properties: {
        q1: { type: 'string', title: 'Which color?', oneOf: [{ const: '1', title: 'Blue' }, { const: '2', title: 'Red' }] },
        q1_other: { type: 'string', title: 'Other', description: 'Optional free-form answer to: Which color?' } } } });
    s.elicit = ans?.aborted ? { action: 'aborted' } : ans;
    update(sid, { sessionUpdate: 'tool_call_update', toolCallId: tid, name: 'ask_question', status: 'completed' });
    if (over()) return end();
    const picked = ans?.action !== 'accept' ? `no answer (${ans?.action})` : ans.content?.q1_other ? `your own answer: ${ans.content.q1_other}` : ans.content?.q1 === '1' ? 'Blue' : ans.content?.q1 === '2' ? 'Red' : 'nothing';
    push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `You chose ${picked}.` } });
    update(sid, { sessionUpdate: 'usage_update', used: 21000, size: 1048576 });
    return end();
  }

  if (text.includes('__PLAN__')) push({ sessionUpdate: 'plan', entries: [{ content: 'Read the code', status: 'completed', priority: 'medium' }, { content: 'Fix the bug', status: 'in_progress', priority: 'high' }] });
  if (text.includes('__EDIT__')) {
    const eid = randomUUID(), file = path.join(s.cwd || '/tmp', 'parity.txt');
    push({ sessionUpdate: 'tool_call', toolCallId: eid, name: 'write_file', kind: 'edit', status: 'in_progress', title: 'File parity.txt', locations: [{ path: file }], rawInput: { Content: 'new line', Overwrite: true, Path: file } });
    push({ sessionUpdate: 'tool_call_update', toolCallId: eid, name: 'write_file', kind: 'edit', status: 'completed', title: 'File parity.txt', locations: [{ path: file }], content: [{ type: 'diff', path: file, oldText: 'old line', newText: 'new line' }] });
  }

  // A command, shown first without its text and then with it, as agy sends it; asked about before it runs.
  const tid = randomUUID(), cmd = /__BG(HANG|MORE|ASK)?__/.test(text) ? 'sleep 30 && echo BG_DONE' : 'echo AGY_OK';
  const call = { sessionUpdate: 'tool_call', toolCallId: tid, name: 'run_command', kind: 'execute', status: 'in_progress', title: cmd, rawInput: { CommandLine: cmd, WaitMsBeforeAsync: 500, toolSummary: 'Run a quick check' } };
  push(call);
  if (!text.includes('__NOASK__')) {
    update(sid, { sessionUpdate: 'tool_call_update', toolCallId: tid, name: 'run_command', status: 'pending' });
    const ans = await askClient(sid, 'session/request_permission', { sessionId: sid,
      toolCall: { toolCallId: tid, title: cmd, kind: 'execute', status: 'pending', rawInput: call.rawInput },
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'deny', name: 'Deny', kind: 'reject_once' }] });
    s.permission = ans?.aborted ? 'aborted' : ans?.outcome?.outcome === 'selected' ? ans.outcome.optionId : ans?.outcome?.outcome || null;
    if (over()) return end();
    if (s.permission !== 'allow') {
      push({ sessionUpdate: 'tool_call_update', toolCallId: tid, name: 'run_command', status: 'failed', rawOutput: { output: 'The user denied this command.' } });
      push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'I did not run it.' } });
      update(sid, { sessionUpdate: 'usage_update', used: 21000, size: 1048576 });
      return end();
    }
    update(sid, { sessionUpdate: 'tool_call_update', toolCallId: tid, name: 'run_command', status: 'in_progress' });
  }
  if (/__BG(HANG|MORE|ASK)?__/.test(text)) {
    // The command went to the background: the model says so and the prompt returns while it runs.
    push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Started it in the background.' } });
    update(sid, { sessionUpdate: 'usage_update', used: 22000, size: 1048576 });
    end();
    if (text.includes('__BGHANG__')) return;
    await sleep(400);
    push({ sessionUpdate: 'tool_call_update', toolCallId: tid, name: 'run_command', status: 'completed', rawOutput: { output: 'BG_DONE\n', exit_code: 0 } });
    if (text.includes('__BGASK__')) {
      // The step after the background command asks the owner something before it goes on.
      const qid = randomUUID();
      update(sid, { sessionUpdate: 'tool_call', toolCallId: qid, name: 'ask_question', kind: 'other', status: 'in_progress', title: 'Run ask_question', args: {} });
      const ans = await askClient(sid, 'elicitation/create', { sessionId: sid, toolCallId: qid, mode: 'form', message: 'The agent has a question.',
        requestedSchema: { type: 'object', properties: { q1: { type: 'string', title: 'Copy it where?', oneOf: [{ const: '1', title: 'Claim folder' }, { const: '2', title: 'Nowhere' }] } } } });
      s.elicit = ans?.aborted ? { action: 'aborted' } : ans;
      update(sid, { sessionUpdate: 'tool_call_update', toolCallId: qid, name: 'ask_question', status: 'completed' });
      push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ans?.action === 'accept' ? 'Copied it: ANSWERED_OK.' : `Left it (${ans?.action || 'aborted'}).` } });
      update(sid, { sessionUpdate: 'usage_update', used: 23000, size: 1048576 });
      s.updatedAt = Date.now(); saveSess(sid, s);
      return;
    }
    if (text.includes('__BGMORE__')) {
      // The step after the background command calls another tool. agy 1.5.14 sends the step's usage_update first and
      // its tool call a moment later (measured live: 2 ms), then asks about it like any command.
      update(sid, { sessionUpdate: 'usage_update', used: 22500, size: 1048576 });
      await sleep(30);
      const tid2 = randomUUID(), cmd2 = 'cp render.mp4 claim/';
      const call2 = { sessionUpdate: 'tool_call', toolCallId: tid2, name: 'run_command', kind: 'execute', status: 'in_progress', title: cmd2, rawInput: { CommandLine: cmd2, toolSummary: 'Copy the render' } };
      push(call2);
      update(sid, { sessionUpdate: 'tool_call_update', toolCallId: tid2, name: 'run_command', status: 'pending' });
      const ans2 = await askClient(sid, 'session/request_permission', { sessionId: sid,
        toolCall: { toolCallId: tid2, title: cmd2, kind: 'execute', status: 'pending', rawInput: call2.rawInput },
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'deny', name: 'Deny', kind: 'reject_once' }] });
      s.permission2 = ans2?.aborted ? 'aborted' : ans2?.outcome?.outcome === 'selected' ? ans2.outcome.optionId : ans2?.outcome?.outcome || null;
      if (s.permission2 !== 'allow') {
        // what the real CLI did when Pocket refused it: the command is not run and agy stops
        push({ sessionUpdate: 'tool_call_update', toolCallId: tid2, name: 'run_command', status: 'failed', rawOutput: { output: 'The user denied this command.' } });
        s.updatedAt = Date.now(); saveSess(sid, s);
        return;
      }
      push({ sessionUpdate: 'tool_call_update', toolCallId: tid2, name: 'run_command', status: 'completed', rawOutput: { output: '', exit_code: 0 } });
      await sleep(100); // the model's next answer
      push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Copied it: FOLLOWUP_OK.' } });
      update(sid, { sessionUpdate: 'usage_update', used: 23000, size: 1048576 });
      s.updatedAt = Date.now(); saveSess(sid, s);
      return;
    }
    push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'The background command finished: BG_DONE.' } });
    update(sid, { sessionUpdate: 'usage_update', used: 23000, size: 1048576 });
    s.updatedAt = Date.now(); saveSess(sid, s);
    return;
  }
  push({ sessionUpdate: 'tool_call_update', toolCallId: tid, name: 'run_command', status: 'completed', rawOutput: { output: 'AGY_OK\n', exit_code: 0 } });
  // a real reply takes longer than a test takes to open its stream; these are read from the live stream
  if (/__(CHOICES|PLAN|COST)__/.test(text)) await sleep(800);
  const answer = text.includes('__DONE__') ? 'The release is out and the tests pass.\n\n```done\nReleased 2.4.1; tests pass\n```'
    : text.includes('__CHOICES__') ? 'Tests pass. Should I merge and deploy?\n\n```choices\nMerge and deploy\nNot yet\n```'
    : `ran it; heard: ${text.replace(/__\w+__/g, '').trim()}`;
  push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: answer } });
  update(sid, { sessionUpdate: 'usage_update', used: 24000, size: 1048576 });
  return end();
}

readline.createInterface({ input: process.stdin }).on('line', line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id != null && (m.result !== undefined || m.error !== undefined) && clientPending.has(m.id)) {
    const p = clientPending.get(m.id); clientPending.delete(m.id); p.res(m.result ?? { error: m.error }); return;
  }
  if (!m.method) return;
  if (m.id == null) { // notification
    if (m.method === 'session/cancel' && m.params?.sessionId && !process.env.FAKE_AGY_IGNORE_CANCEL) {
      const r = running.get(m.params.sessionId); if (r) r.cancelled = true;
      if (!process.env.FAKE_AGY_CANCEL_WAITS) abortAsks(m.params.sessionId);
    }
    return;
  }
  const p = m.params || {};
  switch (m.method) {
    case 'initialize':
      launch.clientInfo = p.clientInfo || null; launch.clientCapabilities = p.clientCapabilities || null; noteLaunch();
      return reply(m.id, { protocolVersion: 1,
        agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} }, promptCapabilities: { image: true, embeddedContext: true } },
        agentInfo: { name: 'antigravity-cli', title: 'Antigravity CLI', version: '1.5.14' } });
    case 'session/list': {
      let files = []; try { files = fs.readdirSync(STORE).filter(f => /^session-.*\.json$/.test(f)); } catch { }
      const sessions = files.map(f => { const sid = f.slice(8, -5), d = loadSess(sid) || {}; return { sessionId: sid, cwd: d.cwd || '/tmp', title: d.title || '', updatedAt: new Date(d.updatedAt || d.createdAt || 0).toISOString() }; });
      const late = Number(process.env.FAKE_AGY_LIST_DELAY_MS) || 0;
      return late ? void setTimeout(() => reply(m.id, { sessions }), late) : reply(m.id, { sessions });
    }
    case 'session/new': {
      if (signedOut()) return fail(m.id, 'Authentication required', -32000);
      const sid = randomUUID();
      saveSess(sid, { updates: [], cwd: p.cwd, createdAt: Date.now(), append: metaAppend(p), mcpServers: p.mcpServers || [], opened: 'new' });
      reply(m.id, { sessionId: sid, configOptions: configOptions(confOf(sid)), _meta: { antigravity: { tier: { name: 'Google AI Pro' } } } });
      return void setTimeout(() => update(sid, { sessionUpdate: 'available_commands_update', availableCommands: COMMANDS }), 20);
    }
    case 'session/load': {
      if (signedOut()) return fail(m.id, 'Authentication required', -32000);
      const load = () => {
        const s = loadSess(p.sessionId); if (!s) return fail(m.id, 'unknown session');
        for (const u of s.updates) update(p.sessionId, u);
        // Reopened to carry on (Pocket's instructions come with it): noted. Reopened only to read the history: counted.
        if (metaAppend(p) != null) { s.append = metaAppend(p); s.mcpServers = p.mcpServers || []; s.opened = 'load'; }
        s.loads = (s.loads || 0) + 1; saveSess(p.sessionId, s); live.set(p.sessionId, s);
        conf.delete(p.sessionId); // a session opened in this process starts on the CLI's own model again
        return reply(m.id, { configOptions: configOptions(confOf(p.sessionId)) });
      };
      // a slow read of the history, so a test can have a reply end while it is being read
      const wait = metaAppend(p) == null ? Number(process.env.FAKE_AGY_HISTORY_DELAY_MS) || 0 : 0;
      return wait ? void setTimeout(load, wait) : load();
    }
    case 'session/set_config_option': {
      if (!loadSess(p.sessionId)) return fail(m.id, 'unknown session');
      const c = confOf(p.sessionId);
      if (p.configId === 'model') { if (!(p.value in MODELS)) return fail(m.id, 'unknown model ' + p.value); c.model = p.value; c.level = MODELS[p.value].start; }
      else if (p.configId === 'thought_level') { if (!MODELS[c.model].levels?.includes(p.value)) return fail(m.id, 'unknown thinking level ' + p.value); c.level = p.value; }
      else if (p.configId === 'mode') { if (!MODES.includes(p.value)) return fail(m.id, 'unknown mode ' + p.value); c.mode = p.value; }
      else return fail(m.id, 'unknown config option ' + p.configId);
      return reply(m.id, { configOptions: configOptions(c) });
    }
    case 'session/prompt': return void handlePrompt(m.id, p);
    default: return fail(m.id, 'method not found: ' + m.method, -32601);
  }
});
