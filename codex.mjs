// codex.mjs — Codex provider for Pocket.
//
// Same shape as the Claude side (one shared session store, turns owned by this daemon
// so the phone can sleep), but Codex ships a first-party JSON-RPC API — `codex
// app-server` — so instead of parsing transcripts we speak the protocol the VS Code
// extension speaks. Threads created in code-server show up here and vice versa.
//
// Two facts drive the design, both verified against codex-cli 0.153.4 on 2026-09-06:
//   1. READS never take a lock. `thread/items/list` returns a thread the extension is
//      actively holding, without disturbing it. So the session list and every
//      transcript are always available, whatever else is running.
//   2. WRITES take a per-thread writer lock (~/.codex/thread-writer-locks/<id>.lock,
//      flock). While code-server has a thread open it owns that lock and `thread/resume`
//      fails with "already has an active writer". So a turn connection resumes, runs,
//      and CLOSES — the lock goes back the moment the turn ends.

import {agentEnv} from './environment.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {QuestionInbox} from './questions.mjs';
import {ApprovalInbox,codexApproval,codexPermissionSettings} from './approvals.mjs';

const HOME = os.homedir();
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, '.codex');
const LOCK_DIR = path.join(CODEX_HOME, 'thread-writer-locks');
// Resolve the binary once: explicit env, the usual install spots, then PATH. A box with no
// Codex at all resolves to null — and the provider stays off. (2026-09-09: on a box with
// no codex, the old fallback to the bare name 'codex' reported "available", the boot-time
// poll spawned it, and the unhandled ENOENT crash-looped the whole server.)
function findCodex() {
  if (process.env.CODEX_BIN) return fs.existsSync(process.env.CODEX_BIN) ? process.env.CODEX_BIN : null;
  const fixed = [path.join(HOME, '.npm-global', 'bin', 'codex'), '/usr/local/bin/codex', '/usr/bin/codex'];
  const onPath = (process.env.PATH || '').split(path.delimiter).filter(Boolean).map(d => path.join(d, 'codex'));
  return [...fixed, ...onPath].find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) || null;
}
export const CODEX_BIN = findCodex();
export const CX = 'cx:'; // id namespace: Codex thread ids are UUID-shaped too, so the
                         // prefix — not a regex — is what tells the two providers apart
export const isCodexId = id => typeof id === 'string' && id.startsWith(CX);
export const bareId = id => isCodexId(id) ? id.slice(CX.length) : id;
export const codexAvailable = () => Boolean(CODEX_BIN);
// Identity of an installed binary through its symlinks: npm upgrades replace the package
// dir, so the resolved file's inode/mtime change even though the path doesn't.
export function binStamp(bin) {
  try { const s = fs.statSync(fs.realpathSync(bin)); return `${s.ino}:${s.mtimeMs}`; } catch { return null; }
}

const log = (...a) => console.log(new Date().toISOString(), '[codex]', ...a);

// ---------- JSON-RPC over stdio ----------
// Newline-delimited JSON both ways. Requests carry an id; anything with a `method` and
// no `id` is a notification (the streaming channel).
class AppServer {
  constructor({ name = 'pocket', detached = false, onNotify, onRequest } = {}) {
    this.name = name;
    this.onNotify = onNotify;
    this.onRequest = onRequest;
    this.pending = new Map(); // id -> {resolve, reject, timer}
    this.nextId = 1;
    this.rem = '';
    this.closed = false;
    this.proc = spawn(CODEX_BIN, ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'], detached, env: agentEnv(process.env),
    });
    if (detached) this.proc.unref();
    this.pid = this.proc.pid;
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', c => this._feed(c));
    this.proc.stderr.on('data', c => { const s = String(c).trim(); if (s) log(`${name} stderr: ${s.slice(0, 300)}`); });
    // A spawn failure (binary missing, not executable) surfaces as an 'error' event; without
    // a listener Node throws it as an uncaught exception and takes the server down.
    this.proc.on('error', e => {
      this.closed = true;
      log(`${name} spawn failed: ${e.message}`);
      for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error(`app-server unavailable: ${e.message}`)); }
      this.pending.clear();
      this.onExit?.(-1);
    });
    this.proc.on('exit', code => {
      this.closed = true;
      for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('app-server exited')); }
      this.pending.clear();
      this.onExit?.(code);
    });
    this.proc.stdin.on('error', () => { }); // EPIPE if it dies mid-write
  }

  _feed(chunk) {
    const lines = (this.rem + chunk).split('\n');
    this.rem = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id != null && (m.result !== undefined || m.error !== undefined)) {
        const p = this.pending.get(m.id);
        if (!p) continue;
        this.pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.error) p.reject(Object.assign(new Error(m.error.message || 'rpc error'), { rpc: m.error }));
        else p.resolve(m.result);
      } else if (m.method && m.id == null) {
        try { this.onNotify?.(m.method, m.params || {}); } catch { }
      } else if (m.method && m.id != null) {
        // Owned turns can relay native questions; other request kinds fail closed.
        if(this.onRequest?.(m))continue;
        this._write({ jsonrpc: '2.0', id: m.id, result: this._declineFor(m.method) });
      }
    }
  }

  // Unknown or malformed requests must never be auto-approved.
  _declineFor(method) {
    if(method==='item/tool/requestUserInput')return {answers:{}};
    if(['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(method))return {decision:'decline'};
    if(method==='item/permissions/requestApproval')return {permissions:{},scope:'turn'};
    if(method==='mcpServer/elicitation/request')return {action:'cancel',content:null};
    if (/[Aa]pproval/.test(method)) return { decision: 'denied' };
    return {};
  }

  _write(obj) {
    if (this.closed) throw new Error('app-server closed');
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  notify(method, params = {}) {
    try { this._write({ jsonrpc: '2.0', method, params }); } catch { }
  }

  request(method, params = {}, timeoutMs = 60_000) {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('app-server closed'));
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this._write({ jsonrpc: '2.0', id, method, params }); }
      catch (e) { this.pending.delete(id); clearTimeout(timer); reject(e); }
    });
  }

  async init() {
    const r = await this.request('initialize', {
      clientInfo: { name: 'pocket', title: 'Pocket', version: '1.0' },
      capabilities: { experimentalApi: true },
    }, 30_000);
    this.notify('initialized', {});
    return r;
  }

  close() {
    this.closed = true;
    try { this.proc.stdin.end(); } catch { }
    try { this.proc.kill(); } catch { }
  }
}

// ---------- shared read connection ----------
// One warm process answers every list/read. It never resumes a thread, so it never
// competes with code-server for a lock.
// It is long-lived, so an in-place `npm i -g @openai/codex` upgrade would leave it running
// the old build forever (2026-09-25: model/list still served the pre-upgrade catalog 4 days
// after the upgrade). Each read checks the install's fingerprint and respawns on change.
// Turns are unaffected — each spawns its own app-server.
let reader = null, readerReady = null, readerStamp = null;
async function readConn() {
  if (reader && !reader.closed && binStamp(CODEX_BIN) !== readerStamp) {
    log('codex binary changed since the reader started — respawning on the new build');
    reader.close(); reader = null; modelCache = { at: 0, list: [] };
  }
  if (reader && !reader.closed) { await readerReady; return reader; }
  readerStamp = binStamp(CODEX_BIN);
  // handlers clear only their own instance — a retired reader exiting late must not
  // null out its replacement
  const r = reader = new AppServer({ name: 'reader' });
  r.onExit = code => { log(`reader exited (${code}) — will respawn on next read`); if (reader === r) reader = null; };
  readerReady = r.init().catch(e => { log(`reader init failed: ${e.message}`); if (reader === r) reader = null; throw e; });
  await readerReady;
  return r;
}
async function rpc(method, params, timeoutMs) {
  const c = await readConn();
  try { return await c.request(method, params, timeoutMs); }
  catch (e) {
    if (/closed|exited/.test(e.message)) { // one transparent retry across a respawn
      reader = null;
      const c2 = await readConn();
      return c2.request(method, params, timeoutMs);
    }
    throw e;
  }
}

// A held lock means some other surface (code-server, a terminal, `codex exec`) owns
// writes to that thread right now. We can still read it; we just can't send.
export function threadLocked(threadId) {
  const f = path.join(LOCK_DIR, `${threadId}.lock`);
  let fd;
  try { fd = fs.openSync(f, 'r+'); } catch { return false; } // no lock file = never opened
  try {
    // No flock in node core; the app-server itself is the authority. Fall back to
    // "lock file touched recently and a codex process is alive" — cheap and good
    // enough for a UI hint. The real answer comes from thread/resume failing.
    const st = fs.fstatSync(fd);
    return Date.now() - st.mtimeMs < 24 * 3600_000;
  } catch { return false; } finally { try { fs.closeSync(fd); } catch { } }
}

// ---------- item → Pocket display model ----------
// The client renders {role:'user',text} and {role:'assistant',blocks:[…]} where a block
// is {t:'text'} or {t:'tool',name,detail}. Codex items map onto that cleanly; anything
// unrecognized becomes a ledger line rather than disappearing.
const clip = (s, n = 140) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim().slice(0, n));

function itemBlocks(it) {
  switch (it.type) {
    case 'agentMessage':
      return it.text?.trim() ? [{ t: 'text', text: it.text }] : [];
    case 'reasoning': {
      // Codex keeps summaries separate from raw reasoning; show the summary only, and
      // only when there is one (most items come back empty).
      const parts = [...(it.summary || []), ...(it.content || [])]
        .map(p => typeof p === 'string' ? p : p?.text || '').filter(Boolean);
      return parts.length ? [{ t: 'tool', name: 'Thinking', detail: clip(parts.join(' ')) }] : [];
    }
    case 'commandExecution': {
      const cmd = (it.command || '').replace(/^\/bin\/(ba)?sh\s+-l?c\s+/, '');
      const bad = it.exitCode != null && it.exitCode !== 0;
      return [{ t: 'tool', name: 'Bash', detail: clip(cmd) + (bad ? ` (exit ${it.exitCode})` : '') }];
    }
    case 'fileChange': {
      const paths = (it.changes || []).map(c => c.path).filter(Boolean);
      const head = paths[0] ? paths[0].split('/').slice(-2).join('/') : '';
      return [{ t: 'tool', name: 'Edit', detail: head + (paths.length > 1 ? ` +${paths.length - 1} more` : '') }];
    }
    case 'webSearch':
      return [{ t: 'tool', name: 'Web', detail: clip(it.query || it.action?.url || '') }];
    case 'mcpToolCall':
      return [{ t: 'tool', name: `${it.server || 'mcp'}.${it.tool || ''}`, detail: clip(JSON.stringify(it.arguments || {})) }];
    case 'collabAgentToolCall':
      return [{ t: 'tool', name: it.tool || 'agent', detail: clip(it.prompt || '') }];
    case 'subAgentActivity':
      return [{ t: 'tool', name: 'Subagent', detail: `${(it.agentPath || '').split('/').pop() || 'agent'} ${it.kind || ''}`.trim() }];
    case 'imageView':
      return [{ t: 'tool', name: 'Image', detail: clip(it.path || '') }];
    case 'sleep':
      return [{ t: 'tool', name: 'Sleep', detail: it.durationMs ? `${Math.round(it.durationMs / 1000)}s` : '' }];
    case 'contextCompaction':
      return [{ t: 'tool', name: 'Compact', detail: 'context compacted' }];
    case 'error':
      return [{ t: 'text', text: `⚠︎ ${clip(it.message || it.text || 'error', 600)}` }];
    default:
      return it.type ? [{ t: 'tool', name: it.type, detail: '' }] : [];
  }
}

// A user message can carry non-text blocks (images); keep the text, note the rest.
function userText(it) {
  const c = it.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter(b => b?.type === 'text').map(b => b.text || '').join('\n');
}

export function normalizeItem(it, ts) {
  if (!it || typeof it !== 'object') return null;
  try {
    if (it.type === 'userMessage') {
      const txt = userText(it).trim();
      if (!txt) return null;
      return { role: 'user', text: txt, ts };
    }
    const blocks = itemBlocks(it);
    return blocks.length ? { role: 'assistant', blocks, ts } : null;
  } catch { return null; }
}

// Consecutive assistant items are separate rows in the store but one bubble in the UI —
// merge them so a turn reads as a document, not as 40 fragments.
function mergeAssistant(msgs) {
  const out = [];
  for (const m of msgs) {
    const prev = out[out.length - 1];
    if (m.role === 'assistant' && prev?.role === 'assistant') prev.blocks.push(...m.blocks);
    else out.push(m);
  }
  return out;
}

// ---------- session list ----------
const iso = secs => secs ? new Date(secs * 1000).toISOString() : undefined;

function threadToSession(t) {
  const title = t.name || clip(t.preview, 120) || '(untitled session)';
  return {
    id: CX + t.id,
    provider: 'codex',
    title,
    cwd: t.cwd || null,
    mtimeMs: (t.updatedAt || t.recencyAt || t.createdAt || 0) * 1000,
    model: t.model || undefined,
    source: t.source || undefined,
  };
}

// thread/list's default mode re-scans the JSONL rollouts to repair thread metadata, which
// grows with the whole store — 5.4s per list on 2,800 rollouts / 4.5 GB (2026-09-28). The
// state DB answers the same rows in ~20ms. Repair still happens: pollCodexActivity() runs
// the scanning form over the newest threads every 15s, off the request path.
// Codex builds that don't know useStateDbOnly get the scanning call instead.
async function threadList(params, timeoutMs) {
  try {
    return await rpc('thread/list', { ...params, useStateDbOnly: true }, timeoutMs);
  } catch (e) {
    if (e?.rpc?.code !== -32602 && e?.rpc?.code !== -32601) throw e;
    return rpc('thread/list', params, timeoutMs);
  }
}

export async function listCodexSessions(limit = 60) {
  // sorted like the merged list (by last update), so a long-lived thread resumed today
  // isn't pushed out of the page by newer-created ones
  const r = await threadList({ limit: Math.min(limit, 200), archived: false, sortKey: 'updated_at' }, 30_000);
  const rows = (r?.data || []).filter(t => t && t.id && !t.ephemeral);
  // subagent threads (spawned by a parent) are machinery, not sessions the user started
  return rows.filter(t => !t.parentThreadId).map(threadToSession);
}

export async function searchCodexSessions(term, limit = 40) {
  const r = await threadList({ limit, archived: false, searchTerm: term }, 30_000);
  return (r?.data || []).filter(t => t && t.id && !t.parentThreadId).map(threadToSession);
}

// ---------- transcript ----------
// Codex has two thread history formats. Threads written by 0.153.4+ (Pocket's own) are
// "paginated" and answer `thread/items/list`. Threads written by an older build — the
// code-server extension bundles 0.153.0 — are "legacy" and the app-server refuses to
// page them (-32601 "thread/items/list is not supported yet"), which used to surface on
// the phone as "Session not found" (2026-09-09). For those, `thread/read` with
// `includeTurns: true` still hands back the whole history, so fall back to it.
const legacyThreads = new Set(); // threadIds known to need the fallback

function isLegacyError(e) {
  return e?.rpc?.code === -32601 || /not supported yet/i.test(e?.message || '');
}

async function readLegacyItems(threadId) {
  const r = await rpc('thread/read', { threadId, includeTurns: true }, 60_000);
  const t = r?.thread || r;
  return (t?.turns || []).flatMap(turn => turn?.items || []).filter(Boolean);
}

// All items of a thread, oldest first, whichever format it is in.
async function listAllItems(threadId) {
  const items = [];
  if (!legacyThreads.has(threadId)) {
    try {
      let cursor = null, pages = 0;
      do {
        const r = await rpc('thread/items/list', { threadId, limit: 200, ...(cursor ? { cursor } : {}) }, 60_000);
        for (const row of r?.data || []) items.push(row.item || row);
        cursor = r?.nextCursor || null;
      } while (cursor && ++pages < 20);
      return items;
    } catch (e) {
      if (!isLegacyError(e)) throw e;
      legacyThreads.add(threadId);
      log(`thread=${threadId} is legacy-format; reading via thread/read`);
    }
  }
  return readLegacyItems(threadId);
}

export async function readCodexThread(threadId, maxMsgs = 400) {
  const items = await listAllItems(threadId);
  const msgs = mergeAssistant(items.map(it => normalizeItem(it)).filter(Boolean));
  return { msgs: msgs.slice(-maxMsgs), total: msgs.length, itemCount: items.length };
}

export async function codexThreadMeta(threadId) {
  const r = await rpc('thread/read', { threadId }, 30_000).catch(() => null);
  const t = r?.thread || r;
  if (!t?.id) return null;
  return threadToSession(t);
}

// ---------- turns ----------
// One dedicated connection per running turn: it resumes the thread (taking the writer
// lock), runs, then closes so code-server can have the thread back. Spawned detached so
// a `pm2 restart pocket-claude` mid-turn doesn't kill the work — the same rule the
// Claude side learned the hard way on 2026-08-14.
export const codexTurns = new Map(); // threadId -> turn

export function codexTurnActive(threadId) { return codexTurns.has(threadId); }

function finish(turn, ev) {
  if (turn.done) return;
  turn.done = true;
  ownedFinishedAt.set(turn.threadId,Date.now());
  if(ownedFinishedAt.size>1000)ownedFinishedAt.delete(ownedFinishedAt.keys().next().value);
  const priorActivity=extSeen.get(turn.threadId);if(priorActivity)priorActivity.at=0;
  turn.questions?.clear();
  turn.approvals?.clear();
  turn.emit(ev);
  turn.emit({ type: 'done' });
  codexTurns.delete(turn.threadId);
  setTimeout(() => { try { turn.conn.close(); } catch { } }, 500); // let the last frames drain
  // the daemon's own follow-ups (push, queue drain) must never be able to kill it
  try { turn.onFinish?.(ev, turn); } catch (e) { log(`onFinish threw thread=${turn.threadId}: ${e.message}`); }
}

export async function startCodexTurn({ threadId, cwd, text, model, effort, executionMode = 'work', approvalMode='review', attachments, emit, onFinish, onQuestion, onApproval, auditApproval }) {
  const existing = threadId && codexTurns.get(threadId);
  if (existing) throw Object.assign(new Error('busy'), { code: 409 });

  const turn = {
    threadId, cwd, startedAt: Date.now(), userText: text, model, effort,
    events: [], subs: new Set(), queue: [], turnId: null, done: false, onFinish, executionMode,approvalMode,approvalItems:new Map(),
  };
  // events fan out to SSE subscribers exactly like the Claude side
  turn.emit = ev => {
    turn.events.push(ev);
    const data = `id: ${turn.events.length - 1}\ndata: ${JSON.stringify(ev)}\n\n`;
    for (const res of turn.subs) { try { res.write(data); } catch { } }
    emit?.(ev);
  };

  const conn = new AppServer({
    name: `turn ${threadId || 'new'}`, detached: true,
    onNotify: (method, params) => onTurnNotify(turn, method, params),
    onRequest: request => {
      if(turn.questions?.receive(request,turn.turnId))return true;
      const approval=codexApproval(request,turn);
      return approval ? turn.approvals?.receive(approval) || false : false;
    },
  });
  turn.conn = conn;
  turn.questions=new QuestionInbox({threadId:()=>turn.threadId,write:reply=>conn._write(reply),onChange:()=>{turn.emit({type:'questions'});if(turn.questions?.list().length)onQuestion?.(turn);}});
  turn.approvals=new ApprovalInbox({sessionId:()=>CX+turn.threadId,turnId:()=>turn.turnId,audit:auditApproval,write:(id,result)=>new Promise((resolve,reject)=>{
    if(conn.closed||conn.proc.stdin.destroyed||conn.proc.stdin.writableEnded)return reject(new Error('Approval connection closed'));
    conn.proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n',e=>e?reject(e):resolve());
  }),onChange:()=>{turn.emit({type:'approvals'});if(turn.approvals?.list().length)onApproval?.(turn);}});
  conn.onExit = () => finish(turn, { type: 'result', ok: false, error: 'codex exited' });

  try {
    await conn.init();
    if (threadId) {
      // sandbox/approval ride on the resume, not the turn: turn/start's sandboxPolicy is
      // a tagged union, and setting it here keeps one code path for both entry points.
      const resumed = await conn.request('thread/resume', {
        threadId, ...codexPermissionSettings(approvalMode), ...(cwd ? { cwd } : {}),
      }, 60_000);
      turn.effectiveModel=model||resumed.model;
      turn.effectiveEffort=effort||resumed.reasoningEffort||null;
      turn.cwd=resumed.cwd||cwd;
    } else {
      const r = await conn.request('thread/start', {
        cwd, ...codexPermissionSettings(approvalMode),
        ...(model ? { model } : {}),
      }, 60_000);
      turn.effectiveModel=model||r.model;
      turn.effectiveEffort=effort||r.reasoningEffort||null;
      turn.threadId = r?.thread?.id || r?.threadId;
      if (!turn.threadId) throw new Error('thread/start returned no id');
    }
  } catch (e) {
    // the turn never started, so its exit isn't a turn ending — drop the handler first
    // or finish() fires into a caller that hasn't finished constructing yet
    conn.onExit = null;
    conn.close();
    // "already has an active writer" is the one failure worth naming precisely: the
    // thread is open somewhere else and the fix is a human action, not a retry.
    if (/active writer/i.test(e.message)) {
      throw Object.assign(new Error('This thread is open in another surface (code-server or a terminal). Close it there to send from Pocket.'), { code: 423 });
    }
    throw e;
  }

  codexTurns.set(turn.threadId, turn);
  turn.emit({ type: 'user', msg: { role: 'user', text, ts: new Date().toISOString() } });

  const input = [{ type: 'text', text: promptWithAttachments(text, attachments) }];
  try {
    const r=await conn.request('turn/start', {
      threadId:turn.threadId,input,
      collaborationMode:{mode:executionMode==='plan'?'plan':'default',settings:{model:turn.effectiveModel,reasoning_effort:turn.effectiveEffort,developer_instructions:null}},
      ...(model?{model}:{}),...(effort?{effort}:{}),
    },120_000);
    turn.turnId=r?.turn?.id || turn.turnId;
  }catch(e){
    finish(turn,{type:'result',ok:false,error:e.message});
    throw e;
  }

  log(`turn start thread=${turn.threadId} pid=${conn.pid} cwd=${cwd || '(thread cwd)'}`);
  return turn;
}

function promptWithAttachments(text, attachments) {
  if (!attachments?.length) return text;
  return text + '\n\n[Attached file' + (attachments.length > 1 ? 's' : '') + ' — read as needed:\n'
    + attachments.join('\n') + '\n]';
}

// The streaming channel. `item/agentMessage/delta` is the word-by-word feed; completed
// items become finished bubbles; `turn/completed` closes the turn out with usage.
function onTurnNotify(turn, method, params) {
  switch (method) {
    case 'serverRequest/resolved':
      turn.questions?.resolve(params.requestId);
      turn.approvals?.resolve(params.requestId);
      break;
    case 'turn/started':
      turn.turnId = params?.turnId || params?.turn?.id || turn.turnId;
      break;
    case 'item/agentMessage/delta': {
      const d = params?.delta ?? params?.text ?? '';
      if (d) turn.emit({ type: 'delta', text: d });
      break;
    }
    case 'item/started':
      if(params.item?.type==='fileChange')turn.approvalItems.set(params.item.id,params.item);
      break;
    case 'item/completed': {
      const it = params?.item || params;
      if(it?.id)turn.approvalItems.delete(it.id);
      // our own prompt comes back as a userMessage item ~2s later; we already echoed it
      if (it?.type === 'userMessage') break;
      const msg = normalizeItem(it, new Date().toISOString());
      if (msg) turn.emit({ type: 'assistant', msg });
      break;
    }
    case 'thread/tokenUsage/updated':
      turn.usage = params?.usage || params;
      break;
    case 'turn/completed': {
      const u = params?.usage || turn.usage || {};
      finish(turn, {
        type: 'result', ok: !turn.stopped && !['failed','interrupted'].includes(params?.turn?.status),
        error:turn.stopped?'Stopped by you':params?.turn?.error?.message,
        duration_ms: Date.now() - turn.startedAt,
        tokens: u.totalTokens ?? u.total_tokens ?? undefined,
      });
      break;
    }
    case 'turn/failed':
    case 'turn/aborted':
      finish(turn, { type: 'result', ok: false, error: params?.error?.message || params?.reason || method });
      break;
    default:
      break;
  }
}

// Mid-turn steering: same idea as writing to the CLI's stdin, but the protocol has a
// precondition — the turn id must still be the live one, so a steer can't land in the
// wrong turn after a race.
export async function steerCodexTurn(threadId, text) {
  const turn = codexTurns.get(threadId);
  if (!turn || turn.done || !turn.turnId) return false;
  await turn.conn.request('turn/steer', {
    threadId, expectedTurnId: turn.turnId, input: [{ type: 'text', text }],
  }, 30_000);
  turn.emit({ type: 'user', msg: { role: 'user', text, ts: new Date().toISOString() } });
  return true;
}

export function stopCodexTurn(threadId) {
  const turn = codexTurns.get(threadId);
  if (!turn) return false;
  turn.stopped = true;
  if (turn.turnId) {
    turn.conn.request('turn/interrupt', { threadId, turnId: turn.turnId }, 20_000)
      .catch(e => log(`interrupt failed thread=${threadId}: ${e.message}`));
  } else {
    turn.conn.close();
  }
  return true;
}

// ---------- external activity (threads driven from code-server / a terminal) ----------
// The Claude side watches transcript files. Codex's equivalent signal is the thread's
// updatedAt moving in the shared store, so a light poll gives the same live mirror.
const EXT_ACTIVE_MS = 45_000;
const ownedFinishedAt = new Map();
const extSeen = new Map(); // threadId -> {updatedAt, at}
export function codexExtActive(threadId) {
  const rec = extSeen.get(threadId);
  return Boolean(rec && Date.now() - rec.at < EXT_ACTIVE_MS);
}
export async function pollCodexActivity() {
  try {
    const r = await rpc('thread/list', { limit: 30, archived: false }, 20_000);
    const now = Date.now();
    for (const t of r?.data || []) {
      const prev = extSeen.get(t.id);
      const u = t.updatedAt || 0;
      if (!prev) { extSeen.set(t.id, { updatedAt: u, at: 0 }); continue; }
      const updatedMs=u<1e12?u*1000:u;
      if(codexTurns.has(t.id)||updatedMs<=(ownedFinishedAt.get(t.id)||0))extSeen.set(t.id,{updatedAt:u,at:0});
      else if (u > prev.updatedAt) extSeen.set(t.id, { updatedAt: u, at: now });
    }
  } catch { /* transient */ }
}

// Watch mode: mirror a thread being driven somewhere else (code-server, a terminal).
// Polls the newest items and emits the ones we haven't shown. Descending + small limit
// keeps this cheap on threads with thousands of items.
export function watchCodexThread(threadId, onMsg, { intervalMs = 2500 } = {}) {
  const seen = new Set();
  let stopped = false, priming = true, complained = false;
  const tick = async () => {
    if (stopped) return;
    try {
      let rows;
      if (legacyThreads.has(threadId)) rows = (await readLegacyItems(threadId)).slice(-20);
      else {
        try {
          const r = await rpc('thread/items/list', { threadId, limit: 20, sortDirection: 'desc' }, 30_000);
          rows = (r?.data || []).map(x => x.item || x).filter(Boolean).reverse();
        } catch (e) {
          if (!isLegacyError(e)) throw e;
          legacyThreads.add(threadId);
          rows = (await readLegacyItems(threadId)).slice(-20);
        }
      }
      for (const it of rows) {
        const key = it.id || JSON.stringify(it).slice(0, 120);
        if (seen.has(key)) continue;
        seen.add(key);
        if (priming) continue; // first pass establishes the baseline, it isn't news
        const msg = normalizeItem(it, new Date().toISOString());
        if (msg) onMsg({ type: msg.role === 'user' ? 'user' : 'assistant', msg });
      }
      priming = false;
    } catch (e) {
      // a poll that fails every tick is a silent blind spot — say it once, keep trying
      if (!complained) { complained = true; log(`watch poll failed thread=${threadId}: ${e.message}`); }
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  let timer = setTimeout(tick, 0);
  return () => { stopped = true; clearTimeout(timer); };
}

// Codex stores thread names itself, so a rename can be real rather than an overlay —
// code-server's picker shows it too. Same titleSync setting gates it.
export async function setCodexThreadName(threadId, name) {
  await rpc('thread/name/set', { threadId, name }, 20_000);
}

// ---------- models ----------
let modelCache = { at: 0, list: [] };
export async function codexModels() {
  if (Date.now() - modelCache.at < 10 * 60_000 && modelCache.list.length && modelCache.stamp === binStamp(CODEX_BIN)) return modelCache.list;
  try {
    const r = await rpc('model/list', {}, 20_000);
    const list = (r?.data || r?.models || []).map(m => ({
      id: m.id || m.model || m.slug,
      label: m.displayName || m.name || m.id,
      efforts: m.supportedReasoningEfforts || m.reasoningEfforts || undefined,
    })).filter(m => m.id);
    if (list.length) modelCache = { at: Date.now(), list, stamp: binStamp(CODEX_BIN) };
    return list;
  } catch { return modelCache.list; }
}

export async function codexVersion() {
  try {
    const c = await readConn();
    return c.userAgent || null;
  } catch { return null; }
}

// Let the installed runtime resolve project, user and plugin skills itself.
export async function listCodexSkills(cwd) {
  const r=await rpc('skills/list',{cwds:cwd?[cwd]:[],forceReload:false},30000);
  const rows=(r?.data||[]).flatMap(entry=>entry.skills||[]).filter(s=>s.enabled!==false);
  const unique=new Map(rows.map(s=>[s.path,s]));
  return [...unique.values()].map(s=>({name:s.name,label:s.interface?.displayName||s.name,
    desc:s.interface?.shortDescription||s.shortDescription||s.description||'',path:s.path,
    invocation:`Use the $${s.name} skill at ${s.path}.`}));
}

export async function accountSummary(){
 const r=await rpc('account/read',{refreshToken:false},15000);const a=r.account;
 return {provider:'codex',signedIn:Boolean(a),method:a?.type||'Not signed in',email:typeof a?.email==='string'?a.email:null,plan:typeof a?.planType==='string'?a.planType:null};
}
