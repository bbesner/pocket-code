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
// OpenCode asks its questions through Pocket's ask tool (acp-ask-mcp.mjs), not ACP elicitation. fs/terminal
// are NOT advertised, so the agent stays the executor under a client-gated permission policy and
// Pocket stays the orchestrator (spec §6).
//
// A second runtime, Google's Antigravity CLI (`agy acp`), runs on the same adapter (RUNTIMES below): signed in on the
// server with the owner's own Google plan, its questions arrive as ACP elicitation forms, a message sent during a reply
// goes into it, and a reply that started a background command ends when that command does. Pocket only ever starts
// `agy acp`: never `agy -p`, never a flag that skips approvals or names another program, and it never reads the
// sign-in token (antigravityArgs, runtimeEnv).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { LineBuffer } from './codex.mjs';
import { ApprovalInbox } from './approvals.mjs';
import { QuestionInbox } from './questions.mjs';
import { textBlocks } from './choices.mjs';
import { DEFAULT_CURATED } from './openrouter.mjs';

const HOME = os.homedir();
const POCKET_VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'package.json'), 'utf8')).version || '0'; } catch { return '0'; } })();

// ---------- runtimes ----------
// The ACP engine drives more than one agent program. A runtime profile says what differs between them; everything
// else in this file is ACP in general. Each runtime is its own engine in engines.mjs (its own agent in the app) with
// its own session-id prefix, so a conversation always reopens on the program it started on.
//   engine / prefix    the engines.mjs entry and the id prefix of its conversations
//   name / label       the program ("OpenCode") and the agent the app shows ("OpenRouter")
//   idRe               the shape of the ids the program mints
//   options            its session config option ids: model, effort, mode, and the mode values for Plan first and work
//   clientCapabilities what Pocket advertises at initialize; clientInfo names Pocket (never another program's name)
//   questions          'tool' = Pocket's ask tool over MCP (acp-ask-mcp.mjs); 'elicitation' = ACP elicitation forms
//   instructions       'file' = a file the program reads each request; 'meta' = appended to its system prompt when the
//                      session is opened or reopened (systemAppend builds the _meta for session/new and session/load)
//   steer              a prompt sent during a reply goes into that reply
//   settle             a reply can go on after its prompt returns (a command moved to the background): wait for it
//   cost               it reports what each reply cost (a runtime on a plan does not; its reply line shows tokens)
//   signIn             the message shown when the program says nobody is signed in (it has no API key to check)
//   dropEnv            variables removed from the program's environment
//   hiddenCommands     commands of its own that Pocket does not list
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const RUNTIMES = {
  opencode: {
    id: 'opencode', engine: 'acp', prefix: 'acp:', name: 'OpenCode', label: 'OpenRouter',
    idRe: /^ses_[0-9a-zA-Z-]{1,64}$/,
    options: { model: 'model', effort: 'effort', mode: 'mode', plan: 'plan', work: 'build' },
    clientCapabilities: {}, clientInfo: null,
    questions: 'tool', instructions: 'file', steer: false, settle: false, cost: true, signIn: null, dropEnv: [], hiddenCommands: [],
    untitled: /^New session - /, // OpenCode names a session "New session - <iso time>" until it titles it
  },
  // Google's Antigravity CLI (`agy acp`), signed in with the owner's own Google plan. Google says wrapping `agy` in
  // other applications is not supported on consumer plans, so this runtime keeps to its documented ACP interface and
  // to the rules in docs/manual/sessions.md: a person sends every message (engines.mjs unattended:false), the API
  // keys that would bill another way are removed, and the flags in AGY_FORBIDDEN_ARGS are never passed.
  antigravity: {
    id: 'antigravity', engine: 'antigravity', prefix: 'agy:', name: 'Antigravity', label: 'Antigravity',
    idRe: UUID_RE,
    options: { model: 'model', effort: 'thought_level', mode: 'mode', plan: 'plan', work: 'default' },
    clientCapabilities: { elicitation: { form: {} } }, clientInfo: { name: 'pocket-code', title: 'Pocket Code', version: POCKET_VERSION },
    questions: 'elicitation', instructions: 'meta', steer: true, settle: true, cost: false,
    systemAppend: text => ({ antigravity: { systemPrompt: { append: text } } }),
    signIn: 'Antigravity is not signed in on this server. Run `agy acp --login` there as the user Pocket Code runs as, then send again.',
    dropEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI'], hiddenCommands: ['schedule'],
    untitled: null,
  },
};
const runtimeOf = r => (typeof r === 'string' ? RUNTIMES[r] : r) || RUNTIMES.opencode;
// Session-id namespace: each runtime's sessions are prefixed so engineForSessionId() routes them, the same way Codex
// ids carry 'cx:'. ACP is OpenCode's prefix; an id with any runtime's prefix is an ACP id.
export const ACP = RUNTIMES.opencode.prefix;
export const AGY = RUNTIMES.antigravity.prefix;
export const runtimeForId = id => (typeof id === 'string' && Object.values(RUNTIMES).find(r => id.startsWith(r.prefix))) || null;
export const isAcpId = id => Boolean(runtimeForId(id));
export const bareAcpId = id => { const r = runtimeForId(id); return r ? id.slice(r.prefix.length) : id; };
// A well-formed id of one of the runtimes (prefix and the shape that runtime mints).
export const validAcpId = id => { const r = runtimeForId(id); return Boolean(r && r.idRe.test(id.slice(r.prefix.length))); };
// The program's environment: Pocket's own, minus what the runtime must not see.
export function runtimeEnv(runtime, env = process.env) {
  const out = { ...env };
  for (const k of runtimeOf(runtime).dropEnv) delete out[k];
  return out;
}

const log = (...a) => console.log(new Date().toISOString(), '[acp]', ...a);

// What Pocket advertises to the agent at initialize. Deliberately NOT fs/terminal: Pocket stays
// the orchestrator and lets the agent execute tools under its own (client-gated) permission
// policy (spec §6). elicitation.form is advertised but model questions are declined in v1.
// No elicitation: OpenCode 1.19 never sends it, and its own question tool waits on an answer ACP cannot deliver,
// so questions reach Pocket through Pocket's ask tool (acp-ask-mcp.mjs) instead.
export const CLIENT_CAPABILITIES = {};
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
    this.onExit = null;          // (err) => void: the process exited or could not start (not called after close())
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
    try { this.onExit?.(err); } catch (e) { log(`exit handler threw: ${e.message}`); }
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
  initialize(clientCapabilities = CLIENT_CAPABILITIES, clientInfo = null) { return this.request('initialize', { protocolVersion: PROTOCOL_VERSION, clientCapabilities, ...(clientInfo ? { clientInfo } : {}) }); }
  newSession(params) { return this.request('session/new', params); }
  loadSession(params) { return this.request('session/load', params); }
  listSessions(params = {}, timeoutMs) { return this.request('session/list', params, timeoutMs); }
  prompt(params, timeoutMs) { return this.request('session/prompt', params, timeoutMs); }
  // OpenCode takes the model and its reasoning effort as session config options, not as prompt fields
  // (a `model` on session/prompt is ignored, and the turn runs on OpenCode's own default model).
  setConfigOption(sessionId, configId, value) { return this.request('session/set_config_option', { sessionId, configId, value }); }
  cancel(sessionId) { this.notify('session/cancel', { sessionId }); }
  close() {
    this.closed = true;
    // 1.124.2: requests still waiting are answered now, as codex.mjs AppServer.close does (1.73.8). The exit that follows
    // finds the client closed and rejects nothing, so an open session/prompt used to wait out its one-hour timer.
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('acp client closed')); }
    this.pending.clear();
    try { this.proc.kill('SIGTERM'); } catch { }
  }
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
  // A question tool's own line says nothing the question card does not (Antigravity's ask_question, verified live).
  if ((u === 'tool_call' || u === 'tool_call_update') && HIDDEN_TOOLS.has(update.name)) return null;
  // 1.87: an edit's ACP `diff` content (path, oldText, newText) rides along for the Changes view
  const diffs = Array.isArray(update.content) ? update.content.filter(c => c?.type === 'diff' && c.path).map(c => ({ path: c.path, old: c.oldText ?? null, new: c.newText ?? '' })) : [];
  if (u === 'tool_call') return { type: 'tool', id: update.toolCallId, title: update.title, kind: update.kind, status: update.status || 'pending', input: update.rawInput || null, path: update.locations?.[0]?.path || null, ...(diffs.length ? { diffs } : {}) };
  // Live, OpenCode sends the call first with only its folder ({title:'bash', rawInput:{cwd}}) and the command a moment later
  // in an in_progress update (verified live, 1.19.4), so updates carry the same fields and are merged by id.
  if (u === 'tool_call_update') return { type: 'tool', id: update.toolCallId, title: update.title, kind: update.kind, status: update.status, input: update.rawInput || null, path: update.locations?.[0]?.path || null, ...(diffs.length ? { diffs } : {}), update: true };
  // OpenCode's running cost for the whole session, after each model step (verified live, 1.19.4)
  if (u === 'usage_update') return { type: 'acp_usage', cost: Number.isFinite(update.cost?.amount) ? update.cost.amount : null, used: update.used ?? null, size: update.size ?? null };
  if (u === 'plan') return { type: 'plan', entries: update.entries || [] };
  if (u === 'available_commands_update') return { type: 'acp_commands', commands: (update.availableCommands || []).map(c => ({ name: c?.name, description: c?.description || '' })).filter(c => typeof c.name === 'string') };
  return null;
}

// A tool call as one of the UI's ledger lines ({t:'tool', name, detail}), the same shape Codex's items take.
const clip = (v, n = 140) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, n));
const TOOL_NAMES = { execute: 'Bash', read: 'Read', edit: 'Edit', delete: 'Edit', move: 'Edit', search: 'Search', fetch: 'Web', think: 'Thinking' };
const HIDDEN_TOOLS = new Set(['ask_question']);
// What a call did, from its input. OpenCode names its fields command, filePath and so on; Antigravity capitalizes
// them (CommandLine, Path: verified live, 1.5.14) and always titles the call, which toolBlock falls back to.
const toolDetail = e => { const i = e.input || {}; return i.command || i.CommandLine || i.filePath || i.path || i.Path || i.pattern || i.url || i.query || ''; };
const toolFile = e => e.input?.filePath || e.input?.Path || e.path;
export function toolBlock(e) {
  // a command's folder is not what it did: an execute call without its command falls back to the title, never the folder
  const detail = toolDetail(e) || (e.kind === 'execute' ? (e.title !== 'bash' ? e.title : '') : e.path || e.title) || '';
  const b = { t: 'tool', name: TOOL_NAMES[e.kind] || clip(e.title, 40) || 'Tool', detail: clip(detail) };
  // 1.87: an edit carries its full path(s) and, when OpenCode sent them, the before/after text (the Changes view's, never the phone's)
  if (Array.isArray(e.diffs) && e.diffs.length) { b.paths = [...new Set(e.diffs.map(d => d.path))]; b.changes = e.diffs.slice(0, 40).map(d => ({ path: d.path, kind: d.old == null ? 'add' : 'update', old: d.old == null ? null : String(d.old).slice(0, 40_000), new: String(d.new ?? '').slice(0, 40_000) })); }
  else if (b.name === 'Edit' && toolFile(e)) b.paths = [toolFile(e)];
  return b;
}
// What a message carries to the phone: the before/after text stays on the server for the Changes view.
export const forClient = msg => msg?.blocks?.some(b => b.changes) ? { ...msg, blocks: msg.blocks.map(({ changes, ...b }) => b) } : msg;
// What an approval card shows under its title: the command, or the files an edit touches (the shapes the
// app's approval card reads for Codex requests).
export function approvalCard(params) {
  const call = params?.toolCall || {}, i = call.rawInput || {};
  const files = [i.filePath, i.path, i.Path, ...(call.locations || []).map(l => l?.path)].filter(Boolean);
  if (call.kind === 'edit' || call.kind === 'delete' || call.kind === 'move') return { kind: 'fileChange', details: { changes: [...new Set(files)].map(p => ({ path: p })), tool: call.title || null } };
  return { kind: 'command', details: { command: i.command || i.CommandLine || call.title || null, tool: call.title || null } };
}
// An ACP elicitation form (elicitation/create, mode form) as Pocket questions, and the way back: `content(answers)`
// turns the inbox's answers ({questionId: {answers: [text]}}) into the form's content. One question per property; a
// property named <other>_other beside a choice is that choice's free-text answer (Antigravity's ask_question sends
// q1 with oneOf [{const, title}] and q1_other, verified live), so it is not a question of its own. Null when the
// request is not a form Pocket can show.
export function elicitationForm(params) {
  const props = params?.requestedSchema?.properties;
  if ((params?.mode && params.mode !== 'form') || !props || typeof props !== 'object') return null;
  const names = Object.keys(props).filter(n => props[n] && typeof props[n] === 'object');
  const otherOf = n => (props[n + '_other'] && n + '_other') || null;
  const fields = names.filter(n => !(n.endsWith('_other') && names.includes(n.slice(0, -6)))).slice(0, 10).map(n => {
    const p = props[n], items = p.type === 'array' ? p.items || {} : null, src = items || p;
    const choices = (src.oneOf || src.anyOf || []).filter(o => o && o.const != null).map(o => ({ value: o.const, label: String(o.title ?? o.const) }));
    if (!choices.length && Array.isArray(src.enum)) choices.push(...src.enum.map((v, i) => ({ value: v, label: String(src.enumNames?.[i] ?? v) })));
    if (!choices.length && p.type === 'boolean') choices.push({ value: true, label: 'Yes' }, { value: false, label: 'No' });
    return { name: n, multiple: Boolean(items), choices, number: p.type === 'number' || p.type === 'integer', other: otherOf(n),
      question: String(p.title || p.description || n).slice(0, 20_000), detail: p.title && p.description && !otherOf(n) ? String(p.description) : '' };
  });
  if (!fields.length) return null;
  const lead = typeof params.message === 'string' && fields.length > 1 ? params.message.trim() : '';
  const questions = fields.map((f, i) => ({ id: f.name, header: i === 0 ? lead.slice(0, 60) : '', question: f.detail ? `${f.question}\n${f.detail}` : f.question,
    options: f.choices.length ? f.choices.slice(0, 30).map(c => ({ label: c.label, description: '' })) : undefined, multiple: f.multiple }));
  const content = answers => {
    const out = {};
    for (const f of fields) {
      const given = (answers?.[f.name]?.answers || []).map(a => String(a));
      if (!given.length) continue;
      if (!f.choices.length) { out[f.name] = f.number && Number.isFinite(Number(given[0])) ? Number(given[0]) : given[0]; continue; }
      const picked = given.map(a => f.choices.find(c => c.label === a)).filter(Boolean).map(c => c.value);
      const typed = given.filter(a => !f.choices.some(c => c.label === a));
      if (picked.length) out[f.name] = f.multiple ? picked : picked[0];
      if (!typed.length) continue; // an answer of your own: the form's free-text field when it has one
      if (f.other) out[f.other] = typed.join('\n');
      else if (f.multiple) out[f.name] = [...picked, ...typed];
      else if (!picked.length) out[f.name] = typed[0];
    }
    return out;
  };
  return { questions, content };
}
// Merge a tool call's events (by id): later fields win, an empty input never replaces a known one.
const mergeTool = (a, e) => ({ ...a, ...Object.fromEntries(Object.entries(e).filter(([k, v]) => v != null && k !== 'update' && !(k === 'input' && !toolDetail(e) && toolDetail(a)))) });
const thinkingBlock = text => ({ t: 'tool', name: 'Thinking', detail: clip(text) });
// An ACP plan (entries of {content, status}) as the UI's checklist block, the shape Claude's TodoWrite takes.
export const planBlock = entries => ({ t: 'todo', todos: (entries || []).map(e => ({ s: ['completed', 'in_progress'].includes(e?.status) ? e.status : 'pending', c: String(e?.content || '') })) });
// Text the way the other engines show it: a trailing ```choices block becomes reply buttons.
const shownText = text => textBlocks(text);

// Fold replayed events into Pocket transcript messages. A user message is {role, text}; everything the agent
// did until the next user message is one assistant message whose blocks keep the order: Thinking and tool
// lines, then text (consecutive text chunks of one messageId are one block). Shown the way the live turn was.
export function messagesFromEvents(events) {
  const out = []; let asst = null, thought = ''; const calls = new Map(); // tool id -> { info, block }
  const flushThought = () => { if (thought.trim()) asst.blocks.push(thinkingBlock(thought)); thought = ''; };
  for (const e of events || []) {
    if (!e) continue;
    if (e.type === 'user_chunk') {
      if (asst) { flushThought(); asst = null; }
      const last = out[out.length - 1];
      if (last && last.role === 'user' && last.mid === e.messageId) last.text += e.text || '';
      else out.push({ role: 'user', text: e.text || '', mid: e.messageId });
      continue;
    }
    if (e.type === 'tool' && calls.has(e.id)) { const c = calls.get(e.id); c.info = mergeTool(c.info, e); Object.assign(c.block, toolBlock(c.info)); continue; }
    if (!['delta', 'reasoning', 'tool', 'plan'].includes(e.type) || (e.type === 'tool' && e.update)) continue;
    if (!asst) { asst = { role: 'assistant', blocks: [] }; out.push(asst); }
    if (e.type === 'reasoning') { thought += e.text || ''; continue; }
    flushThought();
    if (e.type === 'plan') { const last = asst.blocks.findLastIndex(b => b.t === 'todo'); if (last >= 0) asst.blocks[last] = planBlock(e.entries); else asst.blocks.push(planBlock(e.entries)); continue; }
    if (e.type === 'tool') { const block = toolBlock(e); asst.blocks.push(block); calls.set(e.id, { info: e, block }); continue; }
    const last = asst.blocks[asst.blocks.length - 1];
    if (last?.t === 'text' && (e.messageId == null || last.mid === e.messageId)) last.text += e.text || '';
    else asst.blocks.push({ t: 'text', text: e.text || '', mid: e.messageId });
  }
  if (asst) flushThought();
  // assistant messages render from `blocks` in the UI (msgHTML), user messages from `text`.
  return out.map(m => {
    if (m.role === 'user') return { role: 'user', text: m.text };
    const blocks = m.blocks.flatMap(({ mid, ...b }) => b.t === 'text' ? (b.text.trim() ? shownText(b.text) : []) : [b]);
    return { role: 'assistant', text: blocks.filter(b => b.t === 'text').map(b => b.text).join('\n\n'), blocks };
  }).filter(m => m.role === 'user' ? m.text.trim() : m.blocks.length);
}

// ---------- sessions + turns ----------
// sessionId (bare) -> { client, cwd, model, turn, hooks }. One child per session, kept between
// turns, so concurrent sessions are independent processes (like Codex sessions today).
export const acpSessions = new Map();
let trustedMatch = null; // 1.87: (command, cwd) -> the trusted rule it matches, or null (server.mjs sets it)
export const setTrustedMatcher = fn => { trustedMatch = fn; };
// The commands (skills) each runtime last listed for this machine, from any of its processes, for the / list.
const knownCommands = {};
const noteCommands = (rt, commands) => { if (commands.length) knownCommands[rt.id] = commands.filter(c => !rt.hiddenCommands.includes(c.name)); };
export const acpCommands = (runtime = 'opencode') => knownCommands[runtimeOf(runtime).id] || [];
// A runtime's failure in words the owner can act on: nobody signed in is a sign-in message, not a failed reply.
const SIGNED_OUT = /authentication required|not (?:logged|signed) in|unauthenticated/i;
export function runtimeError(runtime, e) {
  const rt = runtimeOf(runtime);
  if (rt.signIn && SIGNED_OUT.test(e?.message || '')) return Object.assign(new Error(rt.signIn), { code: 'signin', status: 409, signIn: true });
  return e;
}
// sessionId (bare) -> active turn. server.mjs's watch/approve/stop endpoints find turns here.
export const acpTurns = new Map();
// sessionId (bare) -> the promise of its process being opened, while it is (startAcpTurn).
const acpOpening = new Map();

export function acpTurnActive(sessionId) { return acpTurns.has(bareAcpId(sessionId)); }
export function ownedAcpTurn(sessionId) { return acpTurns.get(bareAcpId(sessionId)); }

// Build the Pocket turn object for an ACP session: emit→SSE subscribers, an ApprovalInbox fed by
// request_permission, tracked in acpTurns. Mirrors codex.mjs makeTurn.
function makeAcpTurn(session, { text, model, approvalMode, executionMode, hooks, origin, originRef, rootOrigin }) {
  const { emit, onFinish, onApproval, onQuestion, auditApproval } = hooks;
  const client = session.client;
  const turn = {
    sessionId: session.sessionId, fullId: session.fullId, cwd: session.cwd, startedAt: Date.now(), userText: text,
    openPrompts: 0, promptStarted: false, lastStop: null, settling: false, settleTimer: null, afterStep: false, // steering and background commands (runPrompt, settleOrFinish)
    model, approvalMode: approvalMode === 'full' ? 'full' : 'review', events: [], subs: new Set(), done: false, turnId: randomUUID(),
    client, session, onFinish, text: '', thought: '', costStart: session.costTotal ?? null, costTotal: null, usage: null,
    executionMode: executionMode === 'plan' ? 'plan' : 'work', stopped: false, stopNote: null, lastActivityAt: Date.now(), context: null, asks: new Map(),
    ...(origin ? { origin, ...(originRef ? { originRef } : {}), rootOrigin: rootOrigin || 'owner' } : {}), // 1.117: what started it (automation.mjs)
  };
  // The reply's text and thinking since the last tool line, shown as their own message when the next tool
  // line or the end of the turn arrives, so a turn reads in order: thinking, tools, text.
  turn.tools = new Map(); // tool id -> { info (merged events), shown }
  turn.showTool = info => { turn.flush(); turn.emit({ type: 'assistant', msg: forClient({ role: 'assistant', text: '', blocks: [toolBlock(info)], ts: new Date().toISOString() }) }); };
  turn.flush = () => {
    const blocks = [];
    if (turn.thought.trim()) blocks.push(thinkingBlock(turn.thought));
    if (turn.text.trim()) blocks.push(...shownText(turn.text));
    turn.thought = ''; turn.text = '';
    if (blocks.length) turn.emit({ type: 'assistant', msg: { role: 'assistant', text: blocks.filter(b => b.t === 'text').map(b => b.text).join(''), blocks, ts: new Date().toISOString() } });
  };
  turn.emit = ev => {
    turn.events.push(ev);
    const data = `id: ${turn.events.length - 1}\ndata: ${JSON.stringify(ev)}\n\n`;
    for (const res of turn.subs) { try { res.write(data); } catch { } }
    emit?.(ev);
  };
  turn.approvals = new ApprovalInbox({
    sessionId: () => turn.fullId, turnId: () => turn.turnId, audit: auditApproval || (() => { }),
    write: (nativeId, result) => new Promise((resolve, reject) => {
      if (!client.writable()) return reject(new Error('Approval connection closed'));
      try { client.respond(nativeId, result); resolve(); } catch (e) { reject(e); }
    }),
    onChange: () => { turn.emit({ type: 'approvals' }); if (turn.approvals?.list().length) onApproval?.(turn); },
  });
  // Questions from Pocket's ask tool: the same inbox Claude's and Codex's questions use. The native id is the ask's
  // id; answering resolves the ask the tool is polling, skipping or ending the turn resolves it with no answer.
  turn.questions = new QuestionInbox({
    threadId: () => turn.sessionId,
    write: (reply, opts) => { const a = turn.asks.get(reply.id); if (!a) throw new Error('Question expired'); turn.asks.delete(reply.id); a.done({ answers: reply.result?.answers || {}, skipped: opts?.skipped || null }); },
    onChange: () => { turn.emit({ type: 'questions' }); if (turn.questions?.list().length) onQuestion?.(turn); },
  });
  session.turn = turn;
  acpTurns.set(turn.sessionId, turn);
  return turn;
}

// A question from Pocket's ask tool, in Claude's AskUserQuestion shape ({question, header, options[{label,
// description}], multiSelect}). Returns the ask id; the answer arrives on askState(id). Throws when the turn
// cannot take it (finished, malformed).
const askStates = new Map(); // ask id -> { state: 'pending'|'answered'|'gone', answers, at }
export function askAcpQuestion(turn, questions) {
  if (!turn || turn.done) throw Object.assign(new Error('This reply has ended.'), { status: 409 });
  const qs = (Array.isArray(questions) ? questions : []).map((q, i) => ({ id: 'question-' + i, header: String(q?.header || '').slice(0, 60), question: String(q?.question || ''),
    options: Array.isArray(q?.options) ? q.options.map(o => ({ label: String(o?.label ?? o ?? ''), description: String(o?.description || '') })).filter(o => o.label) : undefined, multiple: Boolean(q?.multiSelect) }));
  const id = randomUUID();
  const ok = turn.questions.receive({ id, method: 'item/tool/requestUserInput', params: { threadId: turn.sessionId, turnId: turn.turnId, isBlocking: true, questions: qs } }, turn.turnId);
  if (!ok) throw Object.assign(new Error('The question could not be shown.'), { status: 400 });
  askStates.set(id, { state: 'pending', at: Date.now() });
  turn.asks.set(id, { done: r => askStates.set(id, { state: 'answered', at: Date.now(), answers: Object.fromEntries(qs.map(q => [q.question, (r.answers[q.id]?.answers || [])])), skipped: r.skipped }) });
  for (const [k, v] of askStates) if (Date.now() - v.at > 86_400_000) askStates.delete(k);
  return id;
}
export const askState = id => askStates.get(id) || { state: 'gone' };
const endAsks = turn => { for (const [id, a] of turn.asks) { askStates.set(id, { state: 'gone', at: Date.now() }); try { a.cancel?.(); } catch { } } turn.asks.clear(); turn.questions?.clear(); };

// A reply that goes on after its prompt returned (runtime.settle). Antigravity moves a command that runs longer than
// about ten seconds to the background: session/prompt returns end_turn while the command still runs, and when it
// finishes the agent carries on by itself, sending more session/update messages with no prompt open and no closing
// message (verified live, 1.5.14). So the reply is over when no prompt is open, no tool call is still running, and the
// model has reported a step that called no tool. 1.123.1: agy sends a step's usage_update when the model's answer is in
// and BEFORE that step's tool calls (measured live on 1.5.14: usage_update, then tool_call 2 ms later), so a
// usage_update alone does not mean the step called nothing. Before 1.123.1 the reply ended on it, the step's next
// command then asked for approval on a finished reply, was refused, and agy stopped there (a render followed by "copy
// the files into the claim folder" ended as "Response ready" with the copy never run). Now a usage_update starts
// SETTLE_STEP_MS of grace; anything else the agent sends in it (a tool call, text, a question) cancels the grace and the
// reply goes on. Three timers keep a reply from hanging: SETTLE_STEP_MS after a step with nothing after it,
// SETTLE_QUIET_MS with every tool finished and nothing more said, SETTLE_MAX_MS of silence while a tool still runs (a
// server the agent started and left running); each ends the reply without stopping anything.
const SETTLE_STEP_MS = Number(process.env.POCKET_ACP_SETTLE_STEP_MS) || 5_000;
const SETTLE_QUIET_MS = Number(process.env.POCKET_ACP_SETTLE_QUIET_MS) || 120_000;
const SETTLE_MAX_MS = Number(process.env.POCKET_ACP_SETTLE_MAX_MS) || 600_000;
const TOOL_OVER = new Set(['completed', 'failed', 'cancelled']);
const openTools = turn => [...turn.tools.values()].some(t => t.info.status && !TOOL_OVER.has(t.info.status));
function armSettle(turn) {
  clearTimeout(turn.settleTimer);
  if (turn.done || !turn.settling) return;
  const wait = openTools(turn) ? SETTLE_MAX_MS : turn.afterStep ? SETTLE_STEP_MS : SETTLE_QUIET_MS;
  turn.settleTimer = setTimeout(() => { if (!turn.done && turn.settling && turn.openPrompts === 0) finishAcpTurn(turn, { stopReason: turn.lastStop || 'end_turn' }); }, wait);
  turn.settleTimer.unref?.();
}
// Called when a prompt returns: finish, or wait for what is still running.
function settleOrFinish(turn) {
  if (turn.done || turn.openPrompts > 0) return;
  if (turn.session.runtime.settle && !turn.stopped && turn.lastStop === 'end_turn' && openTools(turn)) { turn.settling = true; return armSettle(turn); }
  finishAcpTurn(turn, { stopReason: turn.lastStop || 'end_turn', ...(turn.lastError ? { error: turn.lastError } : {}) });
}
// One session/prompt of a turn: the message that started it, or one steered into it. A turn ends after its last one.
function runPrompt(turn, blocks) {
  const session = turn.session;
  turn.openPrompts++; turn.promptStarted = true; turn.settling = false; turn.afterStep = false; clearTimeout(turn.settleTimer);
  return session.client.prompt({ sessionId: session.sessionId, prompt: blocks }, PROMPT_TIMEOUT_MS).then(r => {
    turn.openPrompts--;
    if (r?.usage) turn.usage = r.usage;
    turn.lastStop = r?.stopReason || 'end_turn'; turn.lastError = null;
    settleOrFinish(turn);
  }, e => {
    turn.openPrompts--;
    if (turn.openPrompts > 0) return; // an earlier prompt a steered message replaced: the newer one decides
    finishAcpTurn(turn, { stopReason: 'error', error: runtimeError(session.runtime, e).message });
  });
}
const promptBlocks = (text, images = []) => [{ type: 'text', text }, ...images.filter(i => i?.data && i?.mimeType).map(i => ({ type: 'image', mimeType: i.mimeType, data: i.data }))];

// Route a live session/update + server->client request onto the turn. Set as the client handlers
// for the duration of the turn.
function wireTurnHandlers(turn) {
  const client = turn.client, rt = turn.session.runtime;
  // After the reply: what a finished reply's process still sends is not shown (it is in the history when the
  // conversation is next opened), and nothing it asks for is allowed, since nobody is there to be asked.
  const declined = method => method === 'elicitation/create' && rt.questions === 'elicitation' ? { action: 'cancel' } : declineFor(method);
  client.onNotify = (method, params) => {
    if (turn.done) return;
    if (method === 'session/update' && params?.sessionId === turn.sessionId) {
      turn.lastActivityAt = Date.now();
      const ev = normalizeUpdate(params.update);
      if (ev?.type !== 'acp_usage') turn.afterStep = false; // the step goes on (a tool call, text, thinking)
      if (turn.settling) armSettle(turn); // still alive: the wait starts again
      if (!ev) return;
      if (ev.type === 'acp_commands') { turn.session.commands = ev.commands; noteCommands(rt, ev.commands); return; }
      if (ev.type === 'plan') { turn.flush(); turn.emit({ type: 'assistant', msg: { role: 'assistant', text: '', blocks: [planBlock(ev.entries)], ts: new Date().toISOString() } }); return; }
      if (ev.type === 'delta') { turn.text += ev.text; turn.emit(ev); return; }
      if (ev.type === 'reasoning') { turn.thought += ev.text; return; }
      if (ev.type === 'acp_usage') {
        if (ev.cost != null) turn.costTotal = ev.cost;
        if (Number.isFinite(ev.used) && Number.isFinite(ev.size)) { turn.context = turn.session.context = { used: ev.used, size: ev.size }; turn.emit({ type: 'usage' }); }
        // a model step after the last background command: the reply is over unless the step's tool calls follow in the
        // grace (armSettle with afterStep; 1.123.1)
        if (turn.settling && turn.openPrompts === 0 && !openTools(turn)) { turn.afterStep = true; armSettle(turn); }
        return;
      }
      if (ev.type === 'tool') {
        const t = turn.tools.get(ev.id) || { info: {}, shown: false };
        t.info = mergeTool(t.info, ev); turn.tools.set(ev.id, t);
        if (!t.shown && (toolDetail(t.info) || (t.info.status && t.info.status !== 'pending'))) { t.shown = true; turn.showTool(t.info); }
        if (turn.settling) armSettle(turn); // the wait is shorter once the last tool has finished
        return;
      }
      turn.emit(ev);
    }
  };
  client.onRequest = (method, params, id) => {
    if (turn.done) return client.respond(id, declined(method));
    turn.lastActivityAt = Date.now();
    turn.afterStep = false; // an approval or a question: the step goes on
    if (turn.settling) armSettle(turn);
    if (method === 'session/request_permission') {
      const { allow, deny, canAllow } = permissionOutcomes(params.options);
      // Full access: allow at once, as Claude (bypassPermissions) and Codex (approval never) run without asking.
      // OpenCode itself is configured to ask, so Review actions still shows every request as an approval card.
      if (turn.approvalMode === 'full' && canAllow) return client.respond(id, allow);
      const card = approvalCard(params);
      // 1.87: in Review actions, a command matching one of the owner's trusted read-only rules runs without a card (audited)
      if (canAllow && card.kind === 'command' && trustedMatch && card.details.command) {
        const rule = trustedMatch(String(card.details.command), turn.cwd);
        if (rule && turn.approvals.autoAllow({ nativeId: id, turnId: turn.turnId, kind: 'command', title: params.toolCall?.title || 'Run this command?', details: card.details, allow, deny, rule, tool: 'Bash' })) return;
      }
      const ok = turn.approvals.receive({
        nativeId: id, turnId: turn.turnId, kind: card.kind,
        title: params.toolCall?.title || params.title || 'Allow this action?',
        details: card.details,
        allow, deny, canAllow,
      });
      if (!ok) client.respond(id, declineFor(method)); // couldn't register (closed/old turn) -> fail closed
      return; // the response is sent later by the inbox's write when the user decides
    }
    if (method === 'elicitation/create') {
      if (rt.questions !== 'elicitation') return client.respond(id, { outcome: 'cancelled' }); // OpenCode: questions come through Pocket's ask tool
      // A question form as a question card, in the inbox Claude's and Codex's questions use. Answered: accept with the
      // form's content. Skipped (a message typed instead): decline. The reply ended or was stopped: cancel.
      const form = elicitationForm(params), askId = 'elicit:' + id;
      const ok = form && turn.questions.receive({ id: askId, method: 'item/tool/requestUserInput', params: { threadId: turn.sessionId, turnId: turn.turnId, isBlocking: true, questions: form.questions } }, turn.turnId);
      if (!ok) return client.respond(id, { action: 'cancel' });
      turn.asks.set(askId, {
        done: r => client.respond(id, r.skipped || !Object.keys(r.answers || {}).length ? { action: 'decline' } : { action: 'accept', content: form.content(r.answers) }),
        cancel: () => client.respond(id, { action: 'cancel' }),
      });
      return;
    }
    client.respond(id, declineFor(method)); // fs/* terminal/* not advertised
  };
}

// Open (or resume) an ACP session: spawn the child, initialize, new/load the session.
async function openAcpSession({ sessionId, cwd, model, cmd, args, env, resume, runtime, mcpServers = [], instructions = null, instructionsFile = null, askKey = null }) {
  const rt = runtimeOf(runtime);
  const client = new AcpClient({ cmd, args, cwd, env, name: sessionId || 'new' });
  try {
    await client.initialize(rt.clientCapabilities, rt.clientInfo);
    let sid = sessionId;
    // Instructions a runtime takes with the session (rt.instructions 'meta'): Pocket's, for this conversation. A new
    // conversation has no id yet, so they name none; a reopened one gets them again with its id and today's settings.
    const said = rt.instructions === 'meta' && instructions ? instructions(resume && sessionId ? rt.prefix + sessionId : null) : '';
    const meta = said ? { _meta: rt.systemAppend(said) } : {};
    // session/load requires {sessionId, cwd, mcpServers} (cwd a string). On resume the caller may
    // not know the original cwd; recover it from session/list. (Verified against real OpenCode.)
    let opened;
    if (resume && sessionId) { const c = cwd || await sessionCwd(client, sessionId); opened = await client.loadSession({ sessionId, cwd: c && !fs.existsSync(c) ? HOME : c || '/', mcpServers, ...meta }); } // 1.98: its folder may be gone
    else { opened = await client.newSession({ cwd, mcpServers, ...meta }); sid = opened?.sessionId; }
    if (!sid) throw new Error('acp: no session id');
    const config = opened?.configOptions || [];
    const session = { sessionId: sid, fullId: rt.prefix + sid, runtime: rt, client, cwd, config, turn: null, instructionsFile, askKey, runnerToken: env?.POCKET_RUNNER_TOKEN || null, lastActivityAt: Date.now(), commands: [], context: null,
      // the level each model itself starts on, which Default goes back to: the session's first model here, the others as it switches to them
      effortDefaults: { [config.find(o => o.id === rt.options.model)?.currentValue ?? '']: config.find(o => o.id === rt.options.effort)?.currentValue ?? null } };
    acpSessions.set(sid, session);
    // 1.124.2: a process that dies (a crash, an out-of-memory kill) is no longer the conversation's, as Codex drops an
    // exited session; the next message opens a new one. It used to stay registered, and every later message failed.
    client.onExit = () => { if (acpSessions.get(sid) === session) dropSession(session, `${rt.name} exited during this reply.`); };
    return session;
  } catch (e) { client.close(); throw runtimeError(rt, e); }
}
// 1.99: which conversation a command came from, as with Claude and Codex.
const sameToken = (a, b) => Boolean(a && b) && timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
export function sessionForRunnerToken(token) {
  for (const s of acpSessions.values()) if (sameToken(s.runnerToken, token) && !s.client.closed) return s;
  return null;
}

// Point the session at the model (and effort) this turn asked for, through OpenCode's config options.
// Fail closed: a model OpenCode does not confirm stops the turn, rather than letting it run on OpenCode's
// own default model (before 1.84.1 every OpenRouter turn ran on that default, opencode/big-pickle).
// Effort: the model's own levels; 'default' or a level the model lacks resets to the model's default.
export async function applyAcpConfig(session, { model, effort, executionMode }) {
  const rt = session.runtime || RUNTIMES.opencode, ids = rt.options;
  const opt = id => session.config.find(o => o.id === id);
  if (!model) throw new Error(`No ${rt.label} model was chosen for this reply.`);
  // Set and confirm it every turn (one local call): nothing that resets the session between turns can
  // leave a reply on another model.
  if (opt(ids.model) && !(opt(ids.model).options || []).some(o => o.value === model)) throw new Error(`${rt.name} does not offer ${model}. Pick another model.`);
  const before = opt(ids.model)?.currentValue;
  const r = await session.client.setConfigOption(session.sessionId, ids.model, model);
  if (Array.isArray(r?.configOptions)) session.config = r.configOptions;
  const now = opt(ids.model)?.currentValue;
  const defaults = session.effortDefaults ||= {};
  if (before !== model && now === model && !(model in defaults)) defaults[model] = opt(ids.effort)?.currentValue ?? null; // just switched: the model's own level
  if (now !== model) throw new Error(`${rt.name} did not switch to ${model}${now ? ` (it is on ${now})` : ''}, so the reply was not sent.`);
  // Plan first: the runtime's own plan mode (edits disallowed), set every turn since a reopened session starts in its work mode.
  const mode = opt(ids.mode), wantMode = executionMode === 'plan' ? ids.plan : ids.work;
  if (mode && (mode.options || []).some(o => o.value === wantMode) && mode.currentValue !== wantMode) {
    const r = await session.client.setConfigOption(session.sessionId, ids.mode, wantMode);
    if (Array.isArray(r?.configOptions)) session.config = r.configOptions;
  }
  const eff = opt(ids.effort);
  if (!eff) return { model, effort: null };
  const levels = (eff.options || []).map(o => o.value);
  // Default: OpenCode has a level of that name; a runtime without one goes back to the level the model started on.
  const dflt = levels.includes('default') ? 'default' : levels.includes(defaults[model]) ? defaults[model] : null;
  const picked = effort && effort !== 'default' && levels.includes(effort) ? effort : null;
  const want = picked || dflt;
  if (want && eff.currentValue !== want) {
    const r = await session.client.setConfigOption(session.sessionId, ids.effort, want);
    if (Array.isArray(r?.configOptions)) session.config = r.configOptions;
  }
  return { model, effort: picked };
}

// The effort probe's session. Every probe (at start and every 6 hours) used to make a new one, and OpenCode cannot
// delete a session over ACP, so they piled up in the probe folder (over a hundred within a month). Now the newest
// session already in the probe folder is opened again and reused; a folder with none, or one that does not open,
// gets a new one. Being signed out is passed on.
async function probeSession(client, rt, cwd) {
  try {
    const r = await client.listSessions({ cwd });
    const mine = (r?.sessions || []).filter(s => s.cwd === cwd && rt.idRe.test(String(s.sessionId || ''))).sort(newestFirst)[0];
    if (mine) { const s = await client.loadSession({ sessionId: mine.sessionId, cwd, mcpServers: [] }); if (Array.isArray(s?.configOptions)) return { ...s, sessionId: mine.sessionId }; }
  } catch (e) { if (runtimeError(rt, e).signIn) throw e; }
  return client.newSession({ cwd, mcpServers: [] });
}

// The reasoning-effort levels OpenCode offers for each OpenRouter model, read by pointing one throwaway
// session at every model in turn (all ~360 take well under a second, all local). {slug: [levels]} without
// 'default'; a model with no effort setting maps to []. The probe session lives in `cwd`, which the
// conversation list hides, and is opened again by the next probe (probeSession).
export async function probeAcpEfforts({ cmd, args, env, cwd }) {
  const client = new AcpClient({ cmd, args, cwd, env, name: 'effort-probe' });
  client.onNotify = (method, params) => { const ev = method === 'session/update' ? normalizeUpdate(params?.update) : null; if (ev?.type === 'acp_commands') noteCommands(RUNTIMES.opencode, ev.commands); };
  try {
    await client.initialize();
    const s = await probeSession(client, RUNTIMES.opencode, cwd);
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

// What a runtime that lists its own models offers this account, read from one throwaway session (all local calls,
// no model is run): the models with each one's effort levels, the model and level it starts on, and the plan the
// account is on when the runtime says (Antigravity: _meta.antigravity.tier). Nobody signed in: { signedIn: false }.
export async function probeAcpModels({ cmd, args, env, cwd, runtime }) {
  const rt = runtimeOf(runtime), ids = rt.options;
  const client = new AcpClient({ cmd, args, cwd, env, name: 'model-probe' });
  client.onNotify = (method, params) => { const ev = method === 'session/update' ? normalizeUpdate(params?.update) : null; if (ev?.type === 'acp_commands') noteCommands(rt, ev.commands); };
  try {
    await client.initialize(rt.clientCapabilities, rt.clientInfo);
    let s;
    try { s = await client.newSession({ cwd, mcpServers: [] }); }
    catch (e) { const err = runtimeError(rt, e); if (err.signIn) return { signedIn: false, message: err.message, models: [], defaultModel: null, plan: null }; throw err; }
    const opt = (cfg, id) => (cfg || []).find(o => o.id === id);
    const start = opt(s?.configOptions, ids.model), models = [];
    for (const m of start?.options || []) {
      // A model the plan lists but will not switch to still appears, with no levels, and the rest are still read.
      const r = await client.setConfigOption(s.sessionId, ids.model, m.value).catch(() => null);
      const eff = opt(r?.configOptions, ids.effort);
      models.push({ id: m.value, label: m.name || m.value, efforts: eff ? (eff.options || []).map(o => o.value).filter(v => v !== 'default') : [], defaultEffort: eff?.currentValue ?? null });
    }
    if (start?.currentValue) await client.setConfigOption(s.sessionId, ids.model, start.currentValue).catch(() => { });
    await new Promise(r => setTimeout(r, 150)); // the command list arrives just after the session opens
    return { signedIn: true, models, defaultModel: start?.currentValue || models[0]?.id || null, plan: s?._meta?.[rt.id]?.tier?.name || null };
  } finally { client.close(); }
}

// Start (or continue/resume) a turn. hooks mirror startCodexTurn: {emit, onFinish, onApproval,
// auditApproval}. Returns the turn; the reply streams through turn.emit / turn.approvals.
export async function startAcpTurn({ sessionId, cwd, text, prompt = null, images = [], model, effort, approvalMode, executionMode, costBaseline = null, cmd, args = [], env, runtime = null, mcpServers = [], instructionsFile = null, askKey = null, resume = false, hooks = {}, origin, originRef, rootOrigin, mayStart = null }) {
  const bare = sessionId ? bareAcpId(sessionId) : null;
  const rt = runtime ? runtimeOf(runtime) : runtimeForId(sessionId) || RUNTIMES.opencode;
  let session = bare && acpSessions.get(bare);
  if (session?.client.closed) { closeAcpSession(bare); session = null; } // 1.124.2: its process is gone: open a new one, as Codex does
  if (session && acpTurns.has(session.sessionId)) throw Object.assign(new Error('busy'), { code: 409 });
  if (!session) {
    // 1.124.2: a second start while this conversation's process is still opening (two devices sending at once) waits for
    // that process instead of opening its own, then finds the first reply running, as Codex re-checks after its open.
    // Before, both opened a process and ran a prompt on the one session, and the first reply could not be stopped.
    let opening = bare && acpOpening.get(bare);
    if (!opening) {
      opening = openAcpSession({ sessionId: bare, cwd, model, cmd, args, env, resume, runtime: rt, mcpServers, instructions: hooks.instructions, instructionsFile, askKey })
        .then(s => { s.costTotal = resume ? costBaseline : 0; return s; });
      if (bare) { acpOpening.set(bare, opening); opening.catch(() => { }).finally(() => { if (acpOpening.get(bare) === opening) acpOpening.delete(bare); }); }
    }
    session = await opening;
    if (instructionsFile && instructionsFile !== session.instructionsFile) fs.rm(instructionsFile, { force: true }, () => { }); // made for a process this start did not open
    if (acpTurns.has(session.sessionId)) throw Object.assign(new Error('busy'), { code: 409 });
  }
  mayStart?.(); // 1.117: refused just before the turn exists (Pocket was paused meanwhile); the opened process idles out as usual
  const turn = makeAcpTurn(session, { text, model, approvalMode, executionMode, hooks, origin, originRef, rootOrigin }); // 1.117: origin
  turn.effort = effort && effort !== 'default' ? effort : null;
  wireTurnHandlers(turn);
  turn.emit({ type: 'user', msg: { role: 'user', text, ts: new Date().toISOString() } });
  // Run the prompt in the background; the HTTP caller returns 202 immediately (like the codex path).
  turn.promptDone = (async () => {
    try {
      // A turn can wait on an approval for as long as the user takes; the per-turn watchdog, not this
      // timeout, bounds a genuinely stuck turn, so allow a generous ceiling (default 120 s killed turns
      // whose approval was not answered within two minutes).
      const used = await applyAcpConfig(session, { model: turn.model, effort: turn.effort, executionMode: turn.executionMode });
      turn.effort = used.effort;
      // Pocket's instructions for this conversation, written where this OpenCode process reads them (it reads its
      // instruction files when it builds each request, verified live), so they carry the session id and today's settings.
      if (session.instructionsFile && hooks.instructions) fs.writeFileSync(session.instructionsFile, hooks.instructions(session.fullId) || '', { mode: 0o600 });
      if (turn.stopped) return finishAcpTurn(turn, { stopReason: 'cancelled' }); // stopped before the message went out
      await runPrompt(turn, promptBlocks(prompt ?? text, images));
    } catch (e) {
      finishAcpTurn(turn, { stopReason: 'error', error: runtimeError(session.runtime, e).message });
    }
  })();
  return turn;
}

function finishAcpTurn(turn, result) {
  if (turn.done) return;
  turn.done = true; turn.settling = false; clearTimeout(turn.settleTimer);
  // Stopped (by you, or by the watchdog): a stop, not a finished reply, the way the other engines report it.
  if (turn.stopped || result.stopReason === 'cancelled') { turn.stopped = true; result = { ...result, stopReason: 'cancelled', error: turn.stopNote || 'Stopped by you' }; }
  turn.session.lastActivityAt = Date.now();
  endAsks(turn);
  for (const t of turn.tools.values()) if (!t.shown) { t.shown = true; turn.showTool(t.info); }
  turn.flush();
  turn.approvals?.clear();
  // Cost: OpenCode reports the session's running total, so this reply's cost is the change across it. With no
  // known starting total (a conversation reopened before Pocket kept one) there is no cost line, never a wrong one.
  if (turn.costTotal != null) turn.session.costTotal = turn.costTotal;
  const cost = turn.costTotal != null && turn.costStart != null ? Math.round(Math.max(0, turn.costTotal - turn.costStart) * 1e9) / 1e9 : null; // OpenCode's precision
  const u = turn.usage, read = Number(u?.cachedReadTokens) || 0, fresh = Number(u?.inputTokens) || 0;
  const cache = read + fresh > 0 ? { hit: read / (read + fresh) } : null;
  // A runtime on a plan has no cost to show; its reply line carries the tokens instead, as Codex's does.
  const tokens = !turn.session.runtime?.cost && Number.isFinite(Number(u?.totalTokens)) && Number(u.totalTokens) > 0 ? Number(u.totalTokens) : null;
  turn.emit({ type: 'result', ok: !turn.stopped && result.stopReason !== 'error', stopReason: result.stopReason, ...(result.error ? { error: result.error } : {}),
    ...(cost != null ? { cost } : {}), ...(tokens != null ? { tokens } : {}), duration_ms: Date.now() - turn.startedAt, ...(cache ? { cache } : {}) });
  turn.emit({ type: 'done' });
  if (acpTurns.get(turn.sessionId) === turn) acpTurns.delete(turn.sessionId); // 1.124.2: never a newer reply's entry
  try { turn.onFinish?.(result, turn); } catch (e) { log(`onFinish threw: ${e.message}`); }
}

// A message sent during a reply. Where the runtime takes one (Antigravity: a second session/prompt ends the first and
// the reply goes on with the new instruction, verified live), it goes into the running reply and true is returned.
// False: this runtime has no mid-reply input (OpenCode), or the reply cannot take it now; the caller queues it or says so.
export function steerAcpTurn(sessionId, text, { prompt = null, images = [] } = {}) {
  const turn = acpTurns.get(bareAcpId(sessionId));
  if (!turn || turn.done || turn.stopped || !turn.session.runtime.steer || !turn.promptStarted) return false;
  turn.flush(); // what the reply said so far stays above the new message
  turn.emit({ type: 'user', msg: { role: 'user', text, ts: new Date().toISOString() } });
  turn.lastActivityAt = Date.now();
  runPrompt(turn, promptBlocks(prompt ?? text, images));
  return true;
}

export function stopAcpTurn(sessionId, note = null) {
  const turn = acpTurns.get(bareAcpId(sessionId));
  if (!turn) return false;
  turn.stopped = true; if (note) turn.stopNote = note;
  turn.approvals?.clear();
  endAsks(turn);
  try { turn.client.cancel(turn.sessionId); } catch { }
  // No prompt is open (the reply was waiting on a background command): nothing will answer the cancel, so end it here.
  if (turn.promptStarted && turn.openPrompts === 0) finishAcpTurn(turn, { stopReason: 'cancelled' });
  return true;
}

export function closeAcpSession(sessionId) {
  const bare = bareAcpId(sessionId);
  const s = acpSessions.get(bare);
  if (!s) return;
  try { s.client.close(); } catch { }
  dropSession(s, `${s.runtime.name} was closed during this reply.`);
}
function dropSession(s, error) {
  if (acpSessions.get(s.sessionId) === s) acpSessions.delete(s.sessionId);
  // 1.124.2: a reply still running on it ends here, as stopped when Stop came first (the release route's Stop the reply).
  // It used to be dropped from acpTurns only, and stayed open, unreachable, until its prompt timed out an hour later.
  if (s.turn && !s.turn.done) finishAcpTurn(s.turn, { stopReason: 'error', error });
  if (s.instructionsFile) fs.rm(s.instructionsFile, { force: true }, () => { });
}
// The session whose OpenCode process was started with this ask key (Pocket's ask tool presents it).
export const acpSessionByAskKey = key => [...acpSessions.values()].find(s => s.askKey && s.askKey === key) || null;
// Idle OpenCode processes (no reply running) are closed after `idleMs`, as Codex's are; the next message reopens.
export function closeIdleAcpSessions(idleMs) {
  let n = 0;
  for (const s of [...acpSessions.values()]) if (!acpTurns.has(s.sessionId) && Date.now() - (s.lastActivityAt || 0) > idleMs) { closeAcpSession(s.sessionId); n++; }
  return n;
}
// Replies with no sign of life for `quietMs` that are not waiting on you (an approval or a question).
export const stalledAcpTurns = quietMs => [...acpTurns.values()].filter(t => !t.done && Date.now() - t.lastActivityAt > quietMs && !t.approvals?.list().length && !t.questions?.list().length);

// ---------- read-only listing + transcript (a short-lived reader client) ----------
// How OpenCode 1.19 answers ACP session/list (read from its code, ACP.listSessions and Session.list, and checked
// read-only against a real store, 2026-11-22):
//   · {} lists the sessions of the PROJECT of the folder the program runs in (a git repository, or one shared
//     "global" project for every folder outside a repository), all its folders mixed;
//   · { cwd } lists only the sessions started in exactly that folder (in that folder's project);
//   · either way it answers with the newest 100 and no more: the store is asked for 100, and nextCursor only pages
//     through those (it never reaches the 101st).
// So one {} from Pocket's own folder saw only that folder's project, and once Pocket's effort probe had made 100
// sessions in its folder inside that project they were the whole answer, all hidden, and the list was empty.
// The list is now read folder by folder: { cwd } for every folder Pocket knows conversations in, plus one {} from the
// reader's folder to find folders it does not know yet. A folder's own 100 newest cannot be crowded out by another
// folder (the probe's included), hidden folders are dropped before the list is cut, and a conversation Pocket knows
// (id, folder, time) that the program's answer missed is still listed.
export const LIST_CAP = 100; // OpenCode answers at most this many; an answer this long may have been cut
// Bounds of one read (hardened 2026-11-22; the first per-folder version could take minutes when OpenCode hung):
//   · LIST_FOLDERS folders at most (the caller orders them newest first), LIST_PARALLEL at a time;
//   · LIST_REQUEST_MS per question: a healthy answer takes 7 to 30 ms, so a folder that has not answered in 10 s is
//     left out (it keeps its previous rows) and its worker moves on;
//   · LIST_DEADLINE_MS for the whole read, reader start included: whatever answered by then is used and every folder
//     that did not keep its previous rows. A healthy read of a real store takes about 1 s (0.9 s is the reader's start).
export const LIST_FOLDERS = 32, LIST_REQUEST_MS = 10_000, LIST_DEADLINE_MS = 25_000;
const LIST_PAGES = 10, LIST_PARALLEL = 8;
// Pocket records a conversation's time at the start and end of each reply; OpenCode's own time of it can differ by
// the length of the reply's last step. A known conversation newer than a cut folder answer by more than this was
// inside the answer's range, so its absence means the program no longer has it.
export const LIST_SLACK_MS = 120_000;
// 1.122.1: a session nobody ever used. Another program can make empty sessions in a folder (on one install two every
// six hours, 268 of them), and the per-folder read of 1.122.0 listed each as "(untitled conversation)" and spent a
// title call on it. OpenCode names a session "New session - <iso time>" until it titles it, and an empty one is never
// updated. Measured read-only on a real store (523 sessions, 2026-11-22): all 469 empty ones were last updated within
// 1 ms of the time in their title; a used session that kept the default title (13 of 54) was updated at least 88 ms
// after it, usually seconds. So a default title with a last update no more than UNUSED_MS from its time is a session
// nobody used. It is left out unless Pocket started it; a missing or unparsable time lists it (fail open), and a
// runtime with no default title (Antigravity) lists everything as before.
// 5 ms, not more: the first message of a used session was written as early as 15 ms after the session was made.
// Both times must carry milliseconds (as OpenCode writes them); a rounded time would make the comparison meaningless.
export const UNUSED_MS = 5;
const HAS_MS = /\.\d{3}/;
export function unusedSession(runtime, s) {
  const rt = runtimeOf(runtime), title = typeof s?.title === 'string' ? s.title : '';
  if (!rt.untitled || !rt.untitled.test(title)) return false;
  const stamp = title.replace(rt.untitled, '').trim();
  if (typeof s.updatedAt !== 'string' || !HAS_MS.test(stamp) || !HAS_MS.test(s.updatedAt)) return false;
  const made = Date.parse(stamp), at = Date.parse(s.updatedAt);
  return Number.isFinite(made) && Number.isFinite(at) && Math.abs(at - made) <= UNUSED_MS;
}
const newestFirst = (a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
const normDir = d => typeof d === 'string' && path.isAbsolute(d) ? path.resolve(d) : null;
const listLate = () => Object.assign(new Error('session/list timed out (the whole read took too long)'), { late: true });
// One session/list question and the pages that follow it (nextCursor). complete: nothing was left out (no nextCursor
// on the last page, and fewer sessions on it than the program cuts at). oldest: the oldest time in the answer (ms), the
// edge below which a cut answer may have left sessions out. Each question waits at most requestMs, and never past the
// read's deadline.
async function listPages(client, params, take, { requestMs = LIST_REQUEST_MS, deadline = Infinity } = {}) {
  let cursor = null, oldest = Infinity;
  for (let page = 0; page < LIST_PAGES; page++) {
    const left = deadline - Date.now();
    if (left <= 0) throw listLate();
    const r = await client.listSessions(cursor ? { ...params, cursor } : params, Math.max(1, Math.min(requestMs, left)));
    const got = Array.isArray(r?.sessions) ? r.sessions : [];
    for (const s of got) { const t = Date.parse(s?.updatedAt); if (t < oldest) oldest = t; }
    take(got);
    if (!r?.nextCursor) return { complete: got.length < LIST_CAP, oldest };
    if (!got.length || String(r.nextCursor) === cursor) return { complete: false, oldest };
    cursor = String(r.nextCursor);
  }
  return { complete: false, oldest };
}
// The conversation list of one runtime, read by a throwaway reader started in `cwd`. `folders`: the folders to ask
// one by one (newest first; the first LIST_FOLDERS are asked). `known`: conversations Pocket started, [{ id, cwd, at }];
// their folders are asked too. `previous`: the rows of the last read. `hideCwd`: a folder (or folders) whose sessions
// never show. Sessions nobody used (UNUSED_MS) never show either, unless they are in `known` (1.122.1).
//
// A conversation that is in no answer (the ghost-row rule): it stays listed, with its previous row or else from what
// Pocket knows (untitled until Pocket's own title or name covers it), when its folder could not be read this time
// (not asked, failed, or not answered before the deadline), or when the folder's answer was cut (100) and the
// conversation is older than that answer's oldest row (it may simply be past the cut). It is dropped when its folder
// answered in full (fewer than 100, no cursor left), when its folder's cut answer reaches back past it (by more than
// LIST_SLACK_MS), and when its folder no longer exists (the program files the sessions of a gone folder elsewhere,
// so Pocket cannot tell; it still opens by link).
//
// Returns { rows, complete: [folders answered in full], late: whether the deadline cut the read, asked, answered }.
export async function readAcpList({ cmd, args, env, cwd = null, limit = 60, hideCwd = null, folders = [], known = [], previous = [], runtime = null,
  requestMs = LIST_REQUEST_MS, deadlineMs = LIST_DEADLINE_MS, maxFolders = LIST_FOLDERS } = {}) {
  const rt = runtimeOf(runtime);
  const deadline = Date.now() + deadlineMs;
  const hidden = new Set([hideCwd].flat().map(normDir).filter(Boolean));
  const found = new Map(); // bare session id -> the program's row
  const bare = x => typeof x?.id === 'string' && x.id.startsWith(rt.prefix) ? x.id.slice(rt.prefix.length) : '';
  // 1.122.1: sessions nobody used (unusedSession) that Pocket did not start are dropped here with the hidden folders,
  // and remembered so the ghost-row rule below cannot bring one back from `previous`.
  const mine = new Set(known.map(bare).filter(Boolean)), unused = new Set();
  const take = list => {
    for (const s of list) {
      const sid = String(s?.sessionId || '');
      if (!rt.idRe.test(sid) || hidden.has(normDir(s.cwd))) continue; // dropped before the cut, so they never use up the limit
      if (!mine.has(sid) && unusedSession(rt, s)) { unused.add(sid); continue; } // the same
      const had = found.get(sid);
      if (!had || newestFirst(had, s) > 0) found.set(sid, s);
    }
  };
  const dirs = [];
  for (const f of [...folders, ...known.map(k => k?.cwd)]) { const d = normDir(f); if (d && !hidden.has(d) && !dirs.includes(d)) dirs.push(d); }
  dirs.splice(Math.max(0, maxFolders));
  const client = new AcpClient({ cmd, args, env, cwd: cwd && fs.existsSync(cwd) ? cwd : undefined, name: 'reader' });
  let timer = null;
  const overtime = new Promise(r => { timer = setTimeout(r, Math.max(0, deadline - Date.now()), 'late'); });
  try {
    if (await Promise.race([client.initialize(rt.clientCapabilities, rt.clientInfo), overtime]) === 'late') throw listLate();
    const answered = new Map(); // folder -> { complete, oldest }: every question about it answered
    let next = 0, late = false;
    const askFolders = async () => {
      while (next < dirs.length && !late) {
        const d = dirs[next++], asks = [d];
        try { const real = fs.realpathSync(d); if (real !== d) asks.push(real); } catch { }
        let ok = true, all = true, oldest = -Infinity; // oldest: the highest edge of the cut answers
        for (const c of asks) {
          try { const r = await listPages(client, { cwd: c }, take, { requestMs, deadline }); if (!r.complete) { all = false; if (r.oldest > oldest) oldest = r.oldest; } }
          catch { ok = false; } // a folder that fails or times out only leaves its rows out
        }
        if (ok) answered.set(d, { complete: all, oldest });
      }
    };
    let whole = null;
    const wholeRead = listPages(client, {}, take, { requestMs, deadline }).then(() => { whole = { ok: true }; }, e => { whole = { ok: false, e }; });
    const done = await Promise.race([Promise.all([wholeRead, ...Array.from({ length: Math.min(LIST_PARALLEL, dirs.length) }, askFolders)]), overtime]);
    if (done === 'late' || Date.now() >= deadline) late = true; // (a question cut short by the deadline ends with it)
    // An error answer to {} fails the read (a signed-out program says so there); a {} that did not answer in time does
    // not: what the folders answered is used.
    if (whole && !whole.ok && !late && !/^session\/list timed out/.test(whole.e?.message || '')) throw whole.e;
    if (!whole?.ok) late = true;
    // Conversations in no answer: keep or drop by the rule above.
    const keep = (d, at) => {
      if (!fs.existsSync(d)) return false;
      const a = answered.get(d);
      if (!a) return true; // not read this time: as before
      if (a.complete) return false;
      return !(at > a.oldest + LIST_SLACK_MS);
    };
    // (1.122.1: a previous row of a session this read found unused is not kept. One past a cut answer would be, but
    // previous rows come from this process's reads, which never list such a session.)
    for (const p of previous) {
      const sid = bare(p), d = normDir(p?.cwd);
      if (!rt.idRe.test(sid) || found.has(sid) || unused.has(sid) || !d || hidden.has(d) || !keep(d, Number(p.mtimeMs) || 0)) continue;
      found.set(sid, { sessionId: sid, cwd: d, title: p.untitled ? '' : (p.title || ''), updatedAt: new Date(Number(p.mtimeMs) || 0).toISOString() });
    }
    for (const k of known) {
      const sid = bare(k), d = normDir(k?.cwd);
      if (!rt.idRe.test(sid) || found.has(sid) || !d || hidden.has(d) || !keep(d, Number(k.at) || 0)) continue;
      found.set(sid, { sessionId: sid, cwd: d, title: '', updatedAt: new Date(Number(k.at) || 0).toISOString() });
    }
    // OpenCode names a session "New session - <iso time>" until it titles it; treat that as untitled. Ids of another
    // shape than this runtime mints are left out (they could not be opened again).
    const rows = [...found.values()].sort(newestFirst).slice(0, limit)
      .map(s => { const t = rt.untitled?.test(s.title || '') ? '' : (s.title || ''); return { id: rt.prefix + s.sessionId, title: t || '(untitled conversation)', untitled: !t, cwd: s.cwd || null, mtimeMs: Date.parse(s.updatedAt) || 0, provider: rt.engine }; });
    return { rows, complete: [...answered].filter(([, a]) => a.complete).map(([d]) => d), late, asked: dirs.length, answered: answered.size };
  } catch (e) { throw runtimeError(rt, e); } finally { clearTimeout(timer); client.close(); }
}
// List ACP sessions for the session picker (the rows of readAcpList).
export async function listAcpSessions(opts = {}) { return (await readAcpList(opts)).rows; }

// The cwd a session was created in, from session/list — session/load requires it (real OpenCode).
async function sessionCwd(client, bareSessionId) {
  try { const r = await client.listSessions(); return (r?.sessions || []).find(s => s.sessionId === bareSessionId)?.cwd || null; }
  catch { return null; }
}

// Read a session's transcript by replaying session/load into normalized events. Resolves the
// session's original cwd (session/load requires it) via session/list when not supplied.
export async function readAcpTranscript({ sessionId, cwd, cmd, args, env, runtime = null } = {}) {
  const bare = bareAcpId(sessionId), rt = runtime ? runtimeOf(runtime) : runtimeForId(sessionId) || RUNTIMES.opencode;
  const client = new AcpClient({ cmd, args, env, name: 'reader' });
  const events = [];
  client.onNotify = (method, params) => { if (method === 'session/update' && params?.sessionId === bare) { const e = normalizeUpdate(params.update); if (e) events.push(e); } };
  try {
    await client.initialize(rt.clientCapabilities, rt.clientInfo);
    const c = cwd || await sessionCwd(client, bare);
    await client.loadSession({ sessionId: bare, cwd: c && !fs.existsSync(c) ? HOME : c || '/', mcpServers: [] }); // its folder may be gone, as in openAcpSession
    return events;
  } catch (e) { throw runtimeError(rt, e); } finally { client.close(); }
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

// ---------- the Antigravity runtime ----------
// Flags Pocket never passes to `agy`, whatever POCKET_AGY_ARGS says: the ones that skip approvals, present Pocket as
// another program, run a one-off prompt outside ACP, or start the sign-in (the owner signs in themselves, in a terminal).
export const AGY_FORBIDDEN_ARGS = ['--dangerously-skip-permissions', '--override_user_agent_name', '--override-user-agent-name', '-p', '--print', '--prompt', '--login'];
const forbiddenArg = a => AGY_FORBIDDEN_ARGS.some(f => a === f || a.startsWith(f + '='));
// `agy acp` plus the extra flags the operator set (POCKET_AGY_ARGS, for example --disable-telemetry). A forbidden flag
// is dropped together with the value that follows it, and named in `dropped` so the server can log it.
export function antigravityArgs(extra = '') {
  const words = String(extra || '').split(/\s+/).filter(Boolean), args = ['acp'], dropped = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (i === 0 && w === 'acp') continue;
    if (forbiddenArg(w)) { dropped.push(w); if (!w.includes('=') && words[i + 1] && !words[i + 1].startsWith('-')) i++; continue; }
    args.push(w);
  }
  return { args, dropped };
}
export function findAntigravity(env = process.env) {
  const explicit = (env.POCKET_AGY_CMD || '').trim();
  if (explicit) return explicit;
  const home = env.HOME || HOME;
  const fixed = [path.join(home, '.local', 'bin', 'agy'), '/usr/local/bin/agy', '/usr/bin/agy'];
  const onPath = (env.PATH || '').split(path.delimiter).filter(Boolean).map(d => path.join(d, 'agy'));
  return [...fixed, ...onPath].find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) || null;
}
// Opt-in gate, as for OpenRouter: Antigravity is OFF unless POCKET_AGY_ENABLE is set AND `agy` is found.
// POCKET_AGY_MODEL names the model a reply on Default runs (else the one the CLI starts on).
// Returns { cmd, args, dropped, model } or null.
export function antigravityConfig(env = process.env) {
  if (!/^(1|true|yes|on)$/i.test(String(env.POCKET_AGY_ENABLE || '').trim())) return null;
  const cmd = findAntigravity(env);
  if (!cmd) return null;
  const { args, dropped } = antigravityArgs(env.POCKET_AGY_ARGS);
  const model = (env.POCKET_AGY_MODEL || '').trim();
  return { cmd, args, dropped, model: /^[\w.-]{1,80}$/.test(model) ? model : null };
}
// The MCP servers Antigravity's own config lists (~/.gemini/config/mcp_config.json, {mcpServers: {name: {command,
// args, env}}}), in the shape ACP's session/new takes. `agy acp` does not load that file itself (verified live,
// 1.5.14: a server listed there is missing in ACP mode and present when the client passes it), so Pocket passes them
// and a conversation in Pocket has the tools the same person's terminal has. Only local (command) servers: remote
// ones need another launch mode. A missing or unreadable file is no servers.
export function antigravityMcpServers(env = process.env) {
  const file = env.POCKET_AGY_MCP_CONFIG || path.join(env.HOME || HOME, '.gemini', 'config', 'mcp_config.json');
  let cfg = null; try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
  const servers = cfg?.mcpServers && typeof cfg.mcpServers === 'object' ? cfg.mcpServers : {};
  return Object.entries(servers).filter(([, s]) => s && typeof s.command === 'string' && s.command && s.disabled !== true).slice(0, 20).map(([name, s]) => ({
    name, command: s.command, args: Array.isArray(s.args) ? s.args.map(String) : [],
    env: Object.entries(s.env && typeof s.env === 'object' ? s.env : {}).map(([k, v]) => ({ name: k, value: String(v) })),
  }));
}
