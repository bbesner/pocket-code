// acp.mjs — the ACP (Agent Client Protocol) engine adapter.
//
// A third engine alongside Claude Code and Codex: Pocket drives a model-agnostic ACP agent
// (OpenCode today — `opencode acp`) pointed at OpenRouter, so a user can pick DeepSeek V4.1
// Flash or any OpenRouter model. ACP is JSON-RPC 2.0 over stdio — the same wire shape as
// Codex's app-server — so this reuses codex.mjs's LineBuffer framing and mirrors codex.mjs's
// turn-object pattern: each turn builds an ApprovalInbox (request_permission maps straight onto
// it), streams session/update events through turn.emit to SSE subscribers, and is tracked in
// acpTurns so server.mjs's watch/approve endpoints find it. See docs/openrouter-acp-engine-spec.md.
//
// Elicitation (model questions) is declined for v1: OpenCode delivers questions as plain text
// (verified live), so there is no structured question inbox to wire yet (spec §7). fs/terminal
// are NOT advertised, so the agent stays the executor under a client-gated permission policy and
// Pocket stays the orchestrator (spec §6).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { LineBuffer } from './codex.mjs';
import { ApprovalInbox } from './approvals.mjs';
import { DEFAULT_CURATED } from './openrouter.mjs';

const HOME = os.homedir();

// Session-id namespace: ACP sessions are prefixed so engineForSessionId() routes them, the
// same way Codex ids carry 'cx:'. (engines.mjs already registers 'acp' with this prefix.)
export const ACP = 'acp:';
export const isAcpId = id => typeof id === 'string' && id.startsWith(ACP);
export const bareAcpId = id => isAcpId(id) ? id.slice(ACP.length) : id;

const log = (...a) => console.log(new Date().toISOString(), '[acp]', ...a);

// What Pocket advertises to the agent at initialize. Deliberately NOT fs/terminal: Pocket stays
// the orchestrator and lets the agent execute tools under its own (client-gated) permission
// policy (spec §6). elicitation.form is advertised but model questions are declined in v1.
export const CLIENT_CAPABILITIES = { elicitation: { form: {} } };
export const PROTOCOL_VERSION = 1;
// A prompt turn may sit on a pending approval for a long time; don't time it out from under the user.
export const PROMPT_TIMEOUT_MS = Number(process.env.POCKET_ACP_TURN_TIMEOUT_MS) || 3_600_000;

// ---------- JSON-RPC-2.0-over-stdio client for one ACP agent child ----------
// Newline-delimited both ways. Requests carry an id; `method` + no id is a notification; `method`
// + id is a server->client request Pocket must answer (deferred — the handler responds via
// respond(id, result) when ready, e.g. after the user decides an approval).
export class AcpClient {
  constructor({ cmd, args = [], cwd, env = process.env, onNotify, onRequest, name = 'acp' } = {}) {
    this.name = name;
    this.onNotify = onNotify;    // (method, params) => void
    this.onRequest = onRequest;  // (method, params, id) => void — MUST call respond(id, ...) eventually
    this.seq = 0;
    this.pending = new Map();    // our outgoing request id -> {resolve, reject, timer}
    this.closed = false;
    this.buf = new LineBuffer();
    this.stderr = '';
    this.proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd, env });
    this.pid = this.proc.pid;
    this.proc.stdin.on('error', () => { });
    this.proc.stderr.on('data', d => { this.stderr = (this.stderr + d).slice(-4000); });
    this.proc.stdout.on('data', d => { for (const line of this.buf.push(d.toString())) this._line(line); });
    this.proc.on('error', e => this._fail(new Error(`acp spawn failed: ${e.message}`)));
    this.proc.on('exit', () => this._fail(new Error('acp agent exited')));
  }
  writable() { return !this.closed; }
  _fail(err) {
    if (this.closed) return;
    this.closed = true;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }
  _write(obj, cb) { try { this.proc.stdin.write(JSON.stringify(obj) + '\n', cb); } catch (e) { cb?.(e); } }
  _line(line) {
    if (!line.trim()) return;
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.id != null && (m.result !== undefined || m.error !== undefined)) {
      const p = this.pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer); this.pending.delete(m.id);
      if (m.error) p.reject(Object.assign(new Error(m.error.message || 'acp rpc error'), { rpc: m.error }));
      else p.resolve(m.result);
    } else if (m.method && m.id == null) {
      try { this.onNotify?.(m.method, m.params || {}); } catch (e) { log(`notify handler threw: ${e.message}`); }
    } else if (m.method && m.id != null) {
      if (this.onRequest) { try { this.onRequest(m.method, m.params || {}, m.id); } catch (e) { this.respond(m.id, declineFor(m.method)); log(`request handler threw: ${e.message}`); } }
      else this.respond(m.id, declineFor(m.method)); // no handler -> fail closed
    }
  }
  // Answer a server->client request (the deferred half of an approval/elicitation).
  respond(id, result) { this._write({ jsonrpc: '2.0', id, result }); }
  request(method, params = {}, timeoutMs = 120_000) {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('acp client closed'));
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this._write({ jsonrpc: '2.0', id, method, params }, e => { if (e && this.pending.has(id)) { this.pending.delete(id); clearTimeout(timer); reject(e); } });
    });
  }
  notify(method, params = {}) { this._write({ jsonrpc: '2.0', method, params }); }
  initialize(clientCapabilities = CLIENT_CAPABILITIES) { return this.request('initialize', { protocolVersion: PROTOCOL_VERSION, clientCapabilities }); }
  newSession(params) { return this.request('session/new', params); }
  loadSession(params) { return this.request('session/load', params); }
  listSessions() { return this.request('session/list', {}); }
  prompt(params, timeoutMs) { return this.request('session/prompt', params, timeoutMs); }
  // OpenCode takes the model and its reasoning effort as session config options, not as prompt fields
  // (a `model` on session/prompt is ignored, and the turn runs on OpenCode's own default model).
  setConfigOption(sessionId, configId, value) { return this.request('session/set_config_option', { sessionId, configId, value }); }
  cancel(sessionId) { this.notify('session/cancel', { sessionId }); }
  close() { this.closed = true; try { this.proc.kill('SIGTERM'); } catch { } }
}

// Fail-closed default answer to a server->client request Pocket chose not to handle.
export function declineFor(method) {
  if (method === 'session/request_permission') return { outcome: { outcome: 'cancelled' } };
  if (method === 'elicitation/create') return { outcome: 'cancelled' };
  return null; // fs/* and terminal/* are not advertised; a well-behaved agent won't call them
}

// Pick the ACP outcome payload for an allow/deny decision from the request's options[].
export function permissionOutcomes(options) {
  const opts = Array.isArray(options) ? options : [];
  const byKind = k => opts.find(o => o && o.kind === k)?.optionId;
  const allowId = byKind('allow_once') || byKind('allow_always') || opts[0]?.optionId;
  const rejectId = byKind('reject_once') || byKind('reject_always');
  return {
    allow: allowId ? { outcome: { outcome: 'selected', optionId: allowId } } : { outcome: { outcome: 'cancelled' } },
    deny: rejectId ? { outcome: { outcome: 'selected', optionId: rejectId } } : { outcome: { outcome: 'cancelled' } },
    canAllow: Boolean(allowId),
  };
}

// Normalize a session/update notification into a Pocket SSE transcript event. Text streams as
// `delta` (the UI's incremental-text event); tool calls stream as `tool`; the rest is best-effort.
export function normalizeUpdate(update) {
  if (!update || typeof update !== 'object') return null;
  const u = update.sessionUpdate;
  // session/load replays the user's own messages too (verified against real OpenCode), grouped by messageId.
  if (u === 'user_message_chunk') return { type: 'user_chunk', text: update.content?.text ?? '', messageId: update.messageId };
  if (u === 'agent_message_chunk' || u === 'agent_message') return { type: 'delta', text: update.content?.text ?? '', messageId: update.messageId };
  if (u === 'agent_thought_chunk') return { type: 'reasoning', text: update.content?.text ?? '' };
  if (u === 'tool_call') return { type: 'tool', id: update.toolCallId, title: update.title, kind: update.kind, status: update.status || 'pending' };
  if (u === 'tool_call_update') return { type: 'tool', id: update.toolCallId, title: update.title, status: update.status, update: true };
  if (u === 'plan') return { type: 'plan', entries: update.entries || [] };
  return null;
}

// Fold replayed events into Pocket transcript messages ({role, text}): consecutive chunks of the same
// role and messageId are one message. Text only for now: tool calls are not part of the history view.
export function messagesFromEvents(events) {
  const out = [];
  for (const e of events || []) {
    const role = e?.type === 'user_chunk' ? 'user' : e?.type === 'delta' ? 'assistant' : null;
    if (!role) continue;
    const last = out[out.length - 1];
    if (last && last.role === role && (e.messageId == null || last.mid === e.messageId)) last.text += e.text || '';
    else out.push({ role, text: e.text || '', mid: e.messageId });
  }
  // assistant messages render from `blocks` in the UI (msgHTML), user messages from `text`.
  return out.filter(m => m.text.trim()).map(({ role, text }) => role === 'assistant' ? { role, text, blocks: [{ t: 'text', text }] } : { role, text });
}

// ---------- sessions + turns ----------
// sessionId (bare) -> { client, cwd, model, turn, hooks }. One child per session, kept between
// turns, so concurrent sessions are independent processes (like Codex sessions today).
export const acpSessions = new Map();
// sessionId (bare) -> active turn. server.mjs's watch/approve/stop endpoints find turns here.
export const acpTurns = new Map();

export function acpTurnActive(sessionId) { return acpTurns.has(bareAcpId(sessionId)); }
export function ownedAcpTurn(sessionId) { return acpTurns.get(bareAcpId(sessionId)); }

// Build the Pocket turn object for an ACP session: emit→SSE subscribers, an ApprovalInbox fed by
// request_permission, tracked in acpTurns. Mirrors codex.mjs makeTurn.
function makeAcpTurn(session, { text, model, hooks }) {
  const { emit, onFinish, onApproval, auditApproval } = hooks;
  const client = session.client;
  const turn = {
    sessionId: session.sessionId, cwd: session.cwd, startedAt: Date.now(), userText: text,
    model, events: [], subs: new Set(), done: false, turnId: randomUUID(),
    client, session, onFinish,
  };
  turn.emit = ev => {
    turn.events.push(ev);
    const data = `id: ${turn.events.length - 1}\ndata: ${JSON.stringify(ev)}\n\n`;
    for (const res of turn.subs) { try { res.write(data); } catch { } }
    emit?.(ev);
  };
  turn.approvals = new ApprovalInbox({
    sessionId: () => ACP + turn.sessionId, turnId: () => turn.turnId, audit: auditApproval || (() => { }),
    write: (nativeId, result) => new Promise((resolve, reject) => {
      if (!client.writable()) return reject(new Error('Approval connection closed'));
      try { client.respond(nativeId, result); resolve(); } catch (e) { reject(e); }
    }),
    onChange: () => { turn.emit({ type: 'approvals' }); if (turn.approvals?.list().length) onApproval?.(turn); },
  });
  session.turn = turn;
  acpTurns.set(turn.sessionId, turn);
  return turn;
}

// Route a live session/update + server->client request onto the turn. Set as the client handlers
// for the duration of the turn.
function wireTurnHandlers(turn) {
  const client = turn.client;
  client.onNotify = (method, params) => {
    if (method === 'session/update' && params?.sessionId === turn.sessionId) {
      const ev = normalizeUpdate(params.update);
      if (ev) turn.emit(ev);
    }
  };
  client.onRequest = (method, params, id) => {
    if (method === 'session/request_permission') {
      const { allow, deny, canAllow } = permissionOutcomes(params.options);
      const ok = turn.approvals.receive({
        nativeId: id, turnId: turn.turnId, kind: 'command',
        title: params.toolCall?.title || params.title || 'Allow this action?',
        details: { tool: params.toolCall || params.toolCallId || null, sessionId: params.sessionId },
        allow, deny, canAllow,
      });
      if (!ok) client.respond(id, declineFor(method)); // couldn't register (closed/old turn) -> fail closed
      return; // the response is sent later by the inbox's write when the user decides
    }
    if (method === 'elicitation/create') return client.respond(id, { outcome: 'cancelled' }); // v1: questions arrive as text
    client.respond(id, declineFor(method)); // fs/* terminal/* not advertised
  };
}

// Open (or resume) an ACP session: spawn the child, initialize, new/load the session.
async function openAcpSession({ sessionId, cwd, model, cmd, args, env, resume }) {
  const client = new AcpClient({ cmd, args, cwd, env, name: sessionId || 'new' });
  try {
    await client.initialize();
    let sid = sessionId;
    // session/load requires {sessionId, cwd, mcpServers} (cwd a string). On resume the caller may
    // not know the original cwd; recover it from session/list. (Verified against real OpenCode.)
    let opened;
    if (resume && sessionId) { const c = cwd || await sessionCwd(client, sessionId); opened = await client.loadSession({ sessionId, cwd: c || '/', mcpServers: [] }); }
    else { opened = await client.newSession({ cwd, mcpServers: [] }); sid = opened?.sessionId; }
    if (!sid) throw new Error('acp: no session id');
    const session = { sessionId: sid, client, cwd, config: opened?.configOptions || [], turn: null };
    acpSessions.set(sid, session);
    return session;
  } catch (e) { client.close(); throw e; }
}

// Point the session at the model (and effort) this turn asked for, through OpenCode's config options.
// Fail closed: a model OpenCode does not confirm stops the turn, rather than letting it run on OpenCode's
// own default model (before 1.84.1 every OpenRouter turn ran on that default, opencode/big-pickle).
// Effort: the model's own levels; 'default' or a level the model lacks resets to the model's default.
export async function applyAcpConfig(session, { model, effort }) {
  const opt = id => session.config.find(o => o.id === id);
  if (!model) throw new Error('No OpenRouter model was chosen for this reply.');
  // Set and confirm it every turn (one local call): nothing that resets the session between turns can
  // leave a reply on another model.
  if (opt('model') && !(opt('model').options || []).some(o => o.value === model)) throw new Error(`OpenCode does not offer ${model}. Pick another model.`);
  const r = await session.client.setConfigOption(session.sessionId, 'model', model);
  if (Array.isArray(r?.configOptions)) session.config = r.configOptions;
  const now = opt('model')?.currentValue;
  if (now !== model) throw new Error(`OpenCode did not switch to ${model}${now ? ` (it is on ${now})` : ''}, so the reply was not sent.`);
  const eff = opt('effort');
  if (!eff) return { model, effort: null };
  const levels = (eff.options || []).map(o => o.value);
  const want = effort && effort !== 'default' && levels.includes(effort) ? effort : levels.includes('default') ? 'default' : null;
  if (want && eff.currentValue !== want) {
    const r = await session.client.setConfigOption(session.sessionId, 'effort', want);
    if (Array.isArray(r?.configOptions)) session.config = r.configOptions;
  }
  return { model, effort: want === 'default' ? null : want };
}

// The reasoning-effort levels OpenCode offers for each OpenRouter model, read by pointing one throwaway
// session at every model in turn (all ~360 take well under a second, all local). {slug: [levels]} without
// 'default'; a model with no effort setting maps to []. The probe session lives in `cwd`, which the
// conversation list hides.
export async function probeAcpEfforts({ cmd, args, env, cwd }) {
  const client = new AcpClient({ cmd, args, cwd, env, name: 'effort-probe' });
  try {
    await client.initialize();
    const s = await client.newSession({ cwd, mcpServers: [] });
    const models = (s?.configOptions || []).find(o => o.id === 'model')?.options?.map(o => o.value).filter(v => v.startsWith('openrouter/')) || [];
    const out = {};
    for (const m of models) {
      const r = await client.setConfigOption(s.sessionId, 'model', m);
      const eff = (r?.configOptions || []).find(o => o.id === 'effort');
      out[m] = eff ? (eff.options || []).map(o => o.value).filter(v => v !== 'default') : [];
    }
    return out;
  } finally { client.close(); }
}

// Start (or continue/resume) a turn. hooks mirror startCodexTurn: {emit, onFinish, onApproval,
// auditApproval}. Returns the turn; the reply streams through turn.emit / turn.approvals.
export async function startAcpTurn({ sessionId, cwd, text, model, effort, cmd, args = [], env, resume = false, hooks = {} }) {
  const bare = sessionId ? bareAcpId(sessionId) : null;
  let session = bare && acpSessions.get(bare);
  if (session && acpTurns.has(session.sessionId)) throw Object.assign(new Error('busy'), { code: 409 });
  if (!session) session = await openAcpSession({ sessionId: bare, cwd, model, cmd, args, env, resume });
  const turn = makeAcpTurn(session, { text, model, hooks });
  turn.effort = effort && effort !== 'default' ? effort : null;
  wireTurnHandlers(turn);
  turn.emit({ type: 'user', msg: { role: 'user', text, ts: new Date().toISOString() } });
  // Run the prompt in the background; the HTTP caller returns 202 immediately (like the codex path).
  turn.promptDone = (async () => {
    try {
      // A turn can wait on an approval for as long as the user takes; the per-turn watchdog, not this
      // timeout, bounds a genuinely stuck turn, so allow a generous ceiling (default 120 s killed turns
      // whose approval was not answered within two minutes).
      const used = await applyAcpConfig(session, { model: turn.model, effort: turn.effort });
      turn.effort = used.effort;
      const r = await session.client.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text }] }, PROMPT_TIMEOUT_MS);
      finishAcpTurn(turn, { stopReason: r?.stopReason || 'end_turn' });
    } catch (e) {
      finishAcpTurn(turn, { stopReason: 'error', error: e.message });
    }
  })();
  return turn;
}

function finishAcpTurn(turn, result) {
  if (turn.done) return;
  turn.done = true;
  const text = turn.events.filter(e => e.type === 'delta').map(e => e.text).join('');
  if (text) turn.emit({ type: 'assistant', msg: { role: 'assistant', text, blocks: [{ t: 'text', text }], ts: new Date().toISOString() } });
  turn.approvals?.clear();
  turn.emit({ type: 'result', ok: result.stopReason !== 'error', stopReason: result.stopReason, ...(result.error ? { error: result.error } : {}) });
  turn.emit({ type: 'done' });
  acpTurns.delete(turn.sessionId);
  try { turn.onFinish?.(result, turn); } catch (e) { log(`onFinish threw: ${e.message}`); }
}

export function steerAcpTurn(sessionId, text) {
  const turn = acpTurns.get(bareAcpId(sessionId));
  if (!turn) return false;
  // ACP has no mid-turn steer; cancel so the user can send a fresh message (the UI treats a
  // failed steer as "queue / send after"). Returning false lets the caller fall back to queue.
  return false;
}

export function stopAcpTurn(sessionId) {
  const turn = acpTurns.get(bareAcpId(sessionId));
  if (!turn) return false;
  turn.approvals?.clear();
  try { turn.client.cancel(turn.sessionId); } catch { }
  return true;
}

export function closeAcpSession(sessionId) {
  const bare = bareAcpId(sessionId);
  const s = acpSessions.get(bare);
  if (s) { try { s.client.close(); } catch { } acpSessions.delete(bare); acpTurns.delete(bare); }
}

// ---------- read-only listing + transcript (a short-lived reader client) ----------
// List ACP sessions for the session picker. Spawns a throwaway reader, enumerates via session/list.
export async function listAcpSessions({ cmd, args, env, limit = 60, hideCwd = null } = {}) {
  const client = new AcpClient({ cmd, args, env, name: 'reader' });
  try {
    await client.initialize();
    const r = await client.listSessions();
    // OpenCode names a session "New session - <iso time>" until it titles it; treat that as untitled.
    const rows = (r?.sessions || []).filter(s => !hideCwd || s.cwd !== hideCwd).slice(0, limit).map(s => { const t = /^New session - /.test(s.title || '') ? '' : (s.title || ''); return { id: ACP + s.sessionId, title: t || '(untitled conversation)', untitled: !t, cwd: s.cwd || null, mtimeMs: Date.parse(s.updatedAt) || 0, provider: 'acp' }; });
    return rows;
  } finally { client.close(); }
}

// The cwd a session was created in, from session/list — session/load requires it (real OpenCode).
async function sessionCwd(client, bareSessionId) {
  try { const r = await client.listSessions(); return (r?.sessions || []).find(s => s.sessionId === bareSessionId)?.cwd || null; }
  catch { return null; }
}

// Read a session's transcript by replaying session/load into normalized events. Resolves the
// session's original cwd (session/load requires it) via session/list when not supplied.
export async function readAcpTranscript({ sessionId, cwd, cmd, args, env } = {}) {
  const bare = bareAcpId(sessionId);
  const client = new AcpClient({ cmd, args, env, name: 'reader' });
  const events = [];
  client.onNotify = (method, params) => { if (method === 'session/update' && params?.sessionId === bare) { const e = normalizeUpdate(params.update); if (e) events.push(e); } };
  try {
    await client.initialize();
    const c = cwd || await sessionCwd(client, bare);
    await client.loadSession({ sessionId: bare, cwd: c || '/', mcpServers: [] });
    return events;
  } finally { client.close(); }
}

// ---------- runtime discovery + opt-in config ----------
// Resolve the ACP runtime (OpenCode) launch command. POCKET_ACP_CMD overrides it (with
// POCKET_ACP_ARGS, default "acp"); otherwise look for `opencode` in the usual spots and on PATH.
// Returns { cmd, args } or null when no runtime is installed — mirrors codex.mjs findCodex.
export function findAcpRuntime(env = process.env) {
  const explicit = (env.POCKET_ACP_CMD || '').trim();
  if (explicit) return { cmd: explicit, args: (env.POCKET_ACP_ARGS || 'acp').split(/\s+/).filter(Boolean) };
  const home = env.HOME || HOME;
  const fixed = [path.join(home, '.npm-global', 'bin', 'opencode'), '/usr/local/bin/opencode', '/usr/bin/opencode'];
  const onPath = (env.PATH || '').split(path.delimiter).filter(Boolean).map(d => path.join(d, 'opencode'));
  const bin = [...fixed, ...onPath].find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
  return bin ? { cmd: bin, args: ['acp'] } : null;
}

// Opt-in gate: the ACP engine is OFF unless POCKET_ACP_ENABLE is set AND a runtime is found, so
// default installs are unaffected until an operator turns it on. POCKET_ACP_MODELS adds curated
// slugs beyond the probed default. Returns { cmd, args, curated } or null.
export function acpConfig(env = process.env) {
  if (!/^(1|true|yes|on)$/i.test(String(env.POCKET_ACP_ENABLE || '').trim())) return null;
  const rt = findAcpRuntime(env);
  if (!rt) return null;
  const extra = (env.POCKET_ACP_MODELS || '').split(/[\s,]+/).filter(Boolean);
  return { cmd: rt.cmd, args: rt.args, curated: [...new Set([...DEFAULT_CURATED, ...extra])] };
}

// Whether server.mjs should offer/route the ACP engine (opt-in + runtime present).
export const acpAvailable = (env = process.env) => Boolean(acpConfig(env));
