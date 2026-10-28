// acp.mjs — the ACP (Agent Client Protocol) engine adapter.
//
// A third engine alongside Claude Code and Codex: Pocket drives a model-agnostic ACP agent
// (OpenCode today — `opencode acp`) pointed at OpenRouter, so a user can pick DeepSeek V4.1
// Flash or any OpenRouter model. ACP is JSON-RPC 2.0 over stdio — the same wire shape as
// Codex's app-server — so this reuses codex.mjs's LineBuffer framing and mirrors
// startCodexTurn's callback contract ({emit, onApproval, onQuestion, onFinish}). See
// docs/openrouter-acp-engine-spec.md.
//
// SLICE 1 (this file): the protocol client + per-session child + a prompt turn that streams
// updates and routes request_permission / elicitation / cancel to callbacks. It is NOT yet
// wired into server.mjs's dispatch, so it cannot affect the two shipped engines. Server
// routing, the model picker, the key broker and MemStem ingest are follow-up slices.
import { spawn } from 'node:child_process';
import { LineBuffer } from './codex.mjs';

// Session-id namespace: ACP sessions are prefixed so engineForSessionId() routes them, the
// same way Codex ids carry 'cx:'. (engines.mjs already registers 'acp' with this prefix.)
export const ACP = 'acp:';
export const isAcpId = id => typeof id === 'string' && id.startsWith(ACP);
export const bareAcpId = id => isAcpId(id) ? id.slice(ACP.length) : id;

const log = (...a) => console.log(new Date().toISOString(), '[acp]', ...a);

// What Pocket advertises to the agent at initialize. Deliberately NOT fs/terminal: Pocket
// stays the orchestrator and lets the agent execute tools under its own (client-gated)
// permission policy, rather than becoming the executor (that would be Route B's burden —
// spec §6). `elicitation.form` is advertised so an agent that asks structured questions can.
export const CLIENT_CAPABILITIES = { elicitation: { form: {} } };
export const PROTOCOL_VERSION = 1;

// A JSON-RPC-2.0-over-stdio client for one ACP agent child. Newline-delimited both ways.
// Requests carry an id; a message with `method` and no id is a notification (the streaming
// channel); a message with `method` AND id is a server->client request we must answer.
export class AcpClient {
  constructor({ cmd, args = [], cwd, env = process.env, onNotify, onRequest, name = 'acp' } = {}) {
    this.name = name;
    this.onNotify = onNotify;    // (method, params) => void   — session/update etc.
    this.onRequest = onRequest;  // async (method, params) => result — request_permission, elicitation/create
    this.seq = 0;
    this.pending = new Map();    // id -> {resolve, reject, timer}
    this.closed = false;
    this.buf = new LineBuffer();
    this.proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd, env });
    this.pid = this.proc.pid;
    this.stderr = '';
    this.proc.stdin.on('error', () => { }); // EPIPE if it dies mid-write
    this.proc.stderr.on('data', d => { this.stderr = (this.stderr + d).slice(-4000); });
    this.proc.stdout.on('data', d => { for (const line of this.buf.push(d.toString())) this._line(line); });
    this.proc.on('error', e => this._fail(new Error(`acp spawn failed: ${e.message}`)));
    this.proc.on('exit', () => this._fail(new Error('acp agent exited')));
  }

  _fail(err) {
    if (this.closed) return;
    this.closed = true;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }

  _write(obj, cb) {
    try { this.proc.stdin.write(JSON.stringify(obj) + '\n', cb); } catch (e) { cb?.(e); }
  }

  async _line(line) {
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
      // Server->client request. The handler answers; anything it can't/won't handle is declined.
      let result;
      try { result = this.onRequest ? await this.onRequest(m.method, m.params || {}) : undefined; }
      catch (e) { return this._write({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: e.message } }); }
      this._write({ jsonrpc: '2.0', id: m.id, result: result === undefined ? declineFor(m.method) : result });
    }
  }

  request(method, params = {}, timeoutMs = 120_000) {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('acp client closed'));
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this._write({ jsonrpc: '2.0', id, method, params }, e => {
        if (e && this.pending.has(id)) { this.pending.delete(id); clearTimeout(timer); reject(e); }
      });
    });
  }

  notify(method, params = {}) { this._write({ jsonrpc: '2.0', method, params }); }

  initialize(clientCapabilities = CLIENT_CAPABILITIES) {
    return this.request('initialize', { protocolVersion: PROTOCOL_VERSION, clientCapabilities });
  }
  newSession(params) { return this.request('session/new', params); }
  loadSession(params) { return this.request('session/load', params); }
  prompt(params, timeoutMs) { return this.request('session/prompt', params, timeoutMs); }
  cancel(sessionId) { this.notify('session/cancel', { sessionId }); }

  close() { this.closed = true; try { this.proc.kill('SIGTERM'); } catch { } }
}

// Fail-closed default answer to a server->client request Pocket chose not to handle.
export function declineFor(method) {
  if (method === 'session/request_permission') return { outcome: { outcome: 'cancelled' } };
  if (method === 'elicitation/create') return { outcome: 'cancelled' };
  return null; // fs/* and terminal/* are not advertised; a well-behaved agent won't call them
}

// Pick the option id for an approval decision. `decision` is what onApproval returned:
// an explicit optionId string, true/'allow' (first allow-ish option), or false/null/'deny'
// (a reject option, else cancelled). Mirrors the request_permission options[] shape.
export function permissionOutcome(options, decision) {
  const opts = Array.isArray(options) ? options : [];
  const byKind = k => opts.find(o => o && o.kind === k)?.optionId;
  if (typeof decision === 'string' && opts.some(o => o?.optionId === decision)) return { outcome: 'selected', optionId: decision };
  if (decision === true || decision === 'allow') { const id = byKind('allow_once') || byKind('allow_always') || opts[0]?.optionId; return id ? { outcome: 'selected', optionId: id } : { outcome: 'cancelled' }; }
  const rej = byKind('reject_once') || byKind('reject_always');
  return rej ? { outcome: 'selected', optionId: rej } : { outcome: 'cancelled' };
}

// Normalize a session/update notification into a small, engine-neutral event for `emit`.
// The server-wiring slice maps these onto Pocket's transcript records.
export function normalizeUpdate(update) {
  if (!update || typeof update !== 'object') return null;
  const u = update.sessionUpdate;
  if (u === 'agent_message_chunk' || u === 'agent_message') return { type: 'text', text: update.content?.text ?? '' };
  if (u === 'agent_thought_chunk') return { type: 'thought', text: update.content?.text ?? '' };
  if (u === 'tool_call') return { type: 'tool', id: update.toolCallId, title: update.title, kind: update.kind, status: update.status || 'pending' };
  if (u === 'tool_call_update') return { type: 'tool_update', id: update.toolCallId, title: update.title, status: update.status };
  if (u === 'plan') return { type: 'plan', entries: update.entries || [] };
  return { type: 'other', update: u };
}

// Live sessions: sessionId (bare) -> { client, cwd, model }. One child per session, kept between
// turns, so concurrent sessions are independent processes (as Codex sessions are today).
export const acpSessions = new Map();

// Run one prompt turn. Mirrors startCodexTurn's callback contract:
//   emit(event)          — normalized stream events (text/tool/plan/...)
//   onApproval(req)      — async; return an optionId | true/'allow' | false/'deny' for a tool permission
//   onQuestion(req)      — async; return elicitation content, or undefined to cancel
//   onFinish({stopReason, error})
// `cmd`/`args` launch the agent; `model` is the OpenRouter slug. `sessionId` (bare) resumes.
export async function startAcpTurn({ cmd, args = [], cwd, env, text, model, sessionId, resume = false,
  emit = () => { }, onApproval, onQuestion, onFinish = () => { } }) {
  let entry = sessionId && acpSessions.get(sessionId);
  const onNotify = (method, params) => { if (method === 'session/update') { const e = normalizeUpdate(params.update); if (e) emit(e); } };
  const onRequest = async (method, params) => {
    if (method === 'session/request_permission') {
      const decision = onApproval ? await onApproval(params) : false; // fail-closed default: deny
      return { outcome: permissionOutcome(params.options, decision) };
    }
    if (method === 'elicitation/create') {
      const content = onQuestion ? await onQuestion(params) : undefined;
      return content === undefined ? { outcome: 'cancelled' } : { outcome: 'selected', content };
    }
    return undefined; // declined by declineFor
  };

  if (!entry) {
    const client = new AcpClient({ cmd, args, cwd, env, onNotify, onRequest, name: sessionId || 'new' });
    try {
      await client.initialize();
      let sid = sessionId;
      if (resume && sessionId) await client.loadSession({ sessionId, cwd, mcpServers: [] });
      else { const s = await client.newSession({ cwd, mcpServers: [] }); sid = s?.sessionId; }
      if (!sid) throw new Error('acp: no session id');
      entry = { client, cwd, model, sessionId: sid };
      acpSessions.set(sid, entry);
    } catch (e) {
      client.close(); // never leak the child on a failed handshake/resume
      onFinish({ stopReason: 'error', error: e.message });
      throw e;
    }
  } else { entry.client.onNotify = onNotify; entry.client.onRequest = onRequest; }

  emit({ type: 'user', text });
  try {
    const r = await entry.client.prompt({ sessionId: entry.sessionId, prompt: [{ type: 'text', text }], ...(model ? { model } : {}) });
    onFinish({ stopReason: r?.stopReason || 'end_turn' });
    return { sessionId: entry.sessionId, stopReason: r?.stopReason || 'end_turn' };
  } catch (e) {
    onFinish({ stopReason: 'error', error: e.message });
    throw e;
  }
}

export function closeAcpSession(sessionId) {
  const e = acpSessions.get(sessionId);
  if (e) { e.client.close(); acpSessions.delete(sessionId); }
}
