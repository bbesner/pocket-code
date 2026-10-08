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
//      fails with "already has an active writer". Since 1.7 Pocket keeps one app-server
//      per thread between turns, so it holds that lock until the session closes (idle,
//      Close session, a settings change) — code-server can't write to the thread meanwhile.

import {AgentActivity} from './subagents.mjs';
import {agentEnv} from './environment.mjs';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {QuestionInbox} from './questions.mjs';
import {ApprovalInbox,codexApproval,codexPermissionSettings} from './approvals.mjs';
import {estimateWindow} from './usage.mjs';
import {descendantCpu} from './proctree.mjs';
import {CHOICE_INSTRUCTIONS,textBlocks} from './choices.mjs';

const HOME = os.homedir();
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, '.codex');
const LOCK_DIR = path.join(CODEX_HOME, 'thread-writer-locks');
// Codex's own usage visibility store — kept in a file separate from the Claude side's
// usage-state.json so the two providers never race to overwrite one shared file.
const DATA_DIR = process.env.POCKET_DATA_DIR || import.meta.dirname;
const USAGE_FILE = path.join(DATA_DIR, 'codex-usage-state.json');
function loadCodexUsage() { try { return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); } catch { return { context: {}, rateLimits: null }; } }
const codexUsage = loadCodexUsage();
codexUsage.context ??= {};
function saveCodexUsage() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = USAGE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(codexUsage), { mode: 0o600 });
    fs.renameSync(tmp, USAGE_FILE);
  } catch { /* best effort — usage is a convenience view */ }
}
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

// The fail-closed answer to a server→client request Pocket cannot or will not relay.
function declineFor(method) {
  if(method==='item/tool/requestUserInput')return {answers:{}};
  if(['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(method))return {decision:'decline'};
  if(method==='item/permissions/requestApproval')return {permissions:{},scope:'turn'};
  if(method==='mcpServer/elicitation/request')return {action:'cancel',content:null};
  if (/[Aa]pproval/.test(method)) return { decision: 'denied' };
  return {};
}

// ---------- JSON-RPC over stdio ----------
// Newline-delimited JSON both ways. Requests carry an id; anything with a `method` and
// no `id` is a notification (the streaming channel).
class AppServer {
  constructor({ name = 'pocket', detached = false, onNotify, onRequest, transport } = {}) {
    this.name = name;
    this.onNotify = onNotify;
    this.onRequest = onRequest;
    this.pending = new Map(); // id -> {resolve, reject, timer}
    // Ids stay unique across server restarts: a reattached app-server may still answer
    // the previous server's requests, and those replies must not match ours.
    this.nextId = Date.now();
    this.rem = '';
    this.closed = false;
    if (transport) { // session process: stdin is a named pipe, stdout a log file (see spawnTransport)
      this.transport = transport;
      this.pid = transport.pid;
      transport.onData = c => this._feed(c);
      transport.onExit = code => this._exited(code);
      return;
    }
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
    this.proc.on('exit', code => this._exited(code));
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
  _declineFor(method) { return declineFor(method); }

  _exited(code) {
    this.closed = true;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('app-server exited')); }
    this.pending.clear();
    this.onExit?.(code);
  }

  writable() {
    if (this.closed) return false;
    return this.transport ? this.transport.writable() : !(this.proc.stdin.destroyed || this.proc.stdin.writableEnded);
  }

  _write(obj, cb) {
    if (this.closed) throw new Error('app-server closed');
    const line = JSON.stringify(obj) + '\n';
    if (this.transport) this.transport.write(line, cb); else this.proc.stdin.write(line, cb);
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
    if (this.transport) { this.transport.close(); return; }
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
// Session processes are unaffected — each thread gets its own app-server.
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

// Reply suggestions ride on the thread's developer instructions. A Codex config that sets its own
// developer_instructions keeps them: Pocket never replaces an operator's instructions.
function choiceInstructions() {
  if (process.env.POCKET_CHOICES === '0') return {};
  try { if (/^\s*developer_instructions\s*=/m.test(fs.readFileSync(path.join(CODEX_HOME, 'config.toml'), 'utf8'))) return {}; } catch { }
  return { developerInstructions: CHOICE_INSTRUCTIONS };
}

function itemBlocks(it) {
  switch (it.type) {
    case 'agentMessage':
      return it.text?.trim() ? textBlocks(it.text) : [];
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

export function promptOnlyName(t) {
  const name = String(t.name || '').trim(), preview = String(t.preview || '').trim();
  if (!name) return Boolean(preview);
  if (name.length > 80) return true;
  return Boolean(preview) && (preview === name || preview.startsWith(name.slice(0, 40)) && name.length >= 40);
}
function threadToSession(t) {
  const title = t.name || clip(t.preview, 120) || '(untitled session)';
  return {
    id: CX + t.id,
    provider: 'codex',
    title,
    // 1.19: Pocket may generate a short title (server.mjs finishTitle). Codex often stores the whole first
    // message as the thread name (1.19.1), so a name that is just the request still counts as untitled.
    untitled: promptOnlyName(t),
    prompt: promptOnlyName(t) ? String(t.preview || t.name).slice(0, 1500) : undefined,
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

export async function readCodexAgents(threadId) {
  const items = await listAllItems(threadId);
  const turn = codexTurns.get(threadId);
  const byId = new Map(items.map((it,i)=>[it.id || 'history-'+i,it]));
  for (const [id,it] of turn?.agentItems || []) byId.set(id,it);
  const activity = new AgentActivity();
  for (const it of byId.values()) activity.codex(it);
  return activity.snapshot({confirmed:Boolean(turn)});
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

// ---------- sessions and turns ----------
// 1.7: one app-server per thread, kept between turns, so MCP connections, tools and
// question handling stay up the way they do in code-server. While it is open it holds
// Codex's per-thread writer lock: code-server can't write to that thread until Pocket
// closes it (after IDLE_CLOSE_MS idle, the Close session control, or a settings change).
// Spawned detached so a `pm2 restart pocket-claude` mid-turn doesn't kill the work — the
// same rule the Claude side learned the hard way on 2026-08-14.
function msSetting(name, dflt) { // same rule as server.mjs: milliseconds, 0 disables, junk → default
  const raw = (process.env[name] ?? '').trim();
  if (!raw) return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}
const IDLE_CLOSE_MS = msSetting('POCKET_IDLE_CLOSE_MS', 60 * 60_000);
const STALL_MS = msSetting('POCKET_STALL_MS', 30 * 60_000);
export const codexTurns = new Map(); // threadId -> active turn
export const codexSessions = new Map(); // threadId -> {conn, approvalMode, cwd, model, effort, turn, hooks}

export function codexTurnActive(threadId) { return codexTurns.has(threadId); }

// Session processes read a named pipe and write to a log file instead of pipes to this
// server, so a Pocket restart doesn't end them (with plain pipes the app-server exits
// within a second of losing its parent — verified 2026-10-04). A keeper process holds
// the pipe's write end open across restarts; closing = kill keeper + end our end → EOF.
// Own directory: the Claude side's startup sweep removes pipes it doesn't own.
const CX_LOG_DIR = path.join(DATA_DIR, 'turnlogs-codex');
const cxFiles = key => ({
  out: path.join(CX_LOG_DIR, key + '.out.ndjson'), err: path.join(CX_LOG_DIR, key + '.err.log'),
  fifo: path.join(CX_LOG_DIR, key + '.in.fifo'), meta: path.join(CX_LOG_DIR, key + '.session.json'),
});
const pidAlive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

function makeTransport({ pid, keeperPid, key, files, writer, offset, skipBefore = 0 }) {
  const stale = new Map(); // requests logged before a restart, minus those the log shows resolved
  const t = {
    pid, keeperPid, key, files, writer, offset, rem: '', onData: null, onExit: null, exited: false,
    write: (line, cb) => writer.write(line, cb),
    writable: () => !writer.destroyed && !writer.writableEnded,
    close() { try { process.kill(-keeperPid, 'SIGTERM'); } catch { } try { writer.end(); } catch { } },
    drain() {
      let size; try { size = fs.statSync(files.out).size; } catch { return; }
      if (size <= t.offset) return;
      const fh = fs.openSync(files.out, 'r');
      try {
        const buf = Buffer.alloc(size - t.offset);
        fs.readSync(fh, buf, 0, buf.length, t.offset);
        let at = t.offset - Buffer.byteLength(t.rem);
        t.offset = size;
        const lines = (t.rem + buf.toString('utf8')).split('\n');
        t.rem = lines.pop() ?? '';
        for (const l of lines) {
          const lineAt = at; at += Buffer.byteLength(l) + 1;
          // requests the app-server sent the previous server can't be relayed from here;
          // the ones it never saw resolved are declined below so the turn carries on
          if (lineAt < skipBefore) {
            let o; try { o = JSON.parse(l); } catch { }
            if (o?.method && o.id != null) { stale.set(o.id, o.method); continue; }
            if (o?.method === 'serverRequest/resolved' && o.params?.requestId != null) stale.delete(o.params.requestId);
          }
          if (l.trim()) t.onData?.(l + '\n');
        }
        if (skipBefore && t.offset >= skipBefore && stale.size && !t.exited) {
          for (const [id, method] of stale) { try { t.write(JSON.stringify({ jsonrpc: '2.0', id, result: declineFor(method) }) + '\n'); log(`declined a pre-restart ${method} request`); } catch { } }
          stale.clear();
        }
      } finally { fs.closeSync(fh); }
    },
    exit(code) {
      if (t.exited) return;
      t.exited = true;
      clearInterval(t.timer); clearInterval(t.poll);
      t.drain();
      try { writer.destroy(); } catch { }
      try { process.kill(-keeperPid, 'SIGTERM'); } catch { }
      for (const f of [files.fifo, files.meta]) { try { fs.unlinkSync(f); } catch { } }
      t.onExit?.(code);
    },
  };
  t.timer = setInterval(() => t.drain(), 150);
  return t;
}

function spawnTransport() {
  fs.mkdirSync(CX_LOG_DIR, { recursive: true, mode: 0o700 });
  const key = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const files = cxFiles(key);
  for (const f of [files.out, files.err]) fs.writeFileSync(f, '', { mode: 0o600 });
  execFileSync('mkfifo', ['-m', '600', files.fifo]);
  const hold = fs.openSync(files.fifo, fs.constants.O_RDWR); // never blocks; lets the read end open
  const inFd = fs.openSync(files.fifo, 'r');
  const outFd = fs.openSync(files.out, 'a'), errFd = fs.openSync(files.err, 'a');
  const proc = spawn(CODEX_BIN, ['app-server', '--listen', 'stdio://'], { stdio: [inFd, outFd, errFd], detached: true, env: agentEnv(process.env) });
  fs.closeSync(inFd); fs.closeSync(outFd); fs.closeSync(errFd);
  proc.unref();
  const keeper = spawn('sh', ['-c', 'while kill -0 "$1" 2>/dev/null; do sleep 5; done', 'pocket-keeper', String(proc.pid)], { detached: true, stdio: ['ignore', hold, 'ignore'] });
  keeper.unref();
  const writer = fs.createWriteStream(null, { fd: hold });
  writer.on('error', () => { });
  const t = makeTransport({ pid: proc.pid, keeperPid: keeper.pid, key, files, writer, offset: 0 });
  proc.on('exit', code => t.exit(code));
  proc.on('error', () => t.exit(-1));
  return t;
}

function writeSessionMeta(s) {
  const t = s.conn?.transport, turn = s.turn;
  if (!t || !s.threadId || s.exited) return;
  const meta = {
    threadId: s.threadId, pid: t.pid, keeperPid: t.keeperPid, key: t.key, approvalMode: s.approvalMode, cwd: s.cwd, model: s.model, effort: s.effort,
    turn: turn ? { turnId: turn.turnId, startedAt: turn.startedAt, userText: turn.userText, offset: turn.offset, executionMode: turn.executionMode } : null,
    waitingForInput: Boolean(turn && (turn.questions?.list().length || turn.approvals?.list().length || turn.inputUnavailable || turn.approvalUnavailable)),
    waitingForApproval: Boolean(turn?.approvals?.list().length || turn?.approvalUnavailable),
  };
  try { fs.writeFileSync(t.files.meta, JSON.stringify(meta), { mode: 0o600 }); } catch { }
}

// After a Pocket restart: reattach to session processes that are still running and sweep
// files nothing uses. `hooksFor(threadId)` supplies the server's per-thread callbacks.
export function adoptCodexSessions(hooksFor) {
  let entries = []; try { entries = fs.readdirSync(CX_LOG_DIR); } catch { return; }
  const live = new Set();
  for (const f of entries.filter(n => n.endsWith('.session.json'))) {
    let m; try { m = JSON.parse(fs.readFileSync(path.join(CX_LOG_DIR, f), 'utf8')); } catch { continue; }
    const files = cxFiles(m.key);
    let cmd = ''; try { cmd = fs.readFileSync(`/proc/${m.pid}/cmdline`, 'utf8'); } catch { }
    if (!m.threadId || !m.pid || !pidAlive(m.pid) || !cmd.includes('app-server')) {
      try { process.kill(-m.keeperPid, 'SIGTERM'); } catch { }
      for (const x of [files.meta, files.fifo]) { try { fs.unlinkSync(x); } catch { } }
      log(`codex session ended while the server was down thread=${m.threadId}`);
      continue;
    }
    let writer;
    try { writer = fs.createWriteStream(null, { fd: fs.openSync(files.fifo, fs.constants.O_RDWR) }); writer.on('error', () => { }); }
    catch { try { process.kill(-m.pid, 'SIGTERM'); } catch { } continue; } // unreachable: let it go
    let size = 0; try { size = fs.statSync(files.out).size; } catch { }
    const offset = m.turn ? Math.min(m.turn.offset || 0, size) : size;
    const t = makeTransport({ pid: m.pid, keeperPid: m.keeperPid, key: m.key, files, writer, offset, skipBefore: size });
    t.poll = setInterval(() => { if (!pidAlive(m.pid)) t.exit(null); }, 1000);
    const s = { threadId: m.threadId, approvalMode: m.approvalMode, cwd: m.cwd, model: m.model, effort: m.effort, turn: null, hooks: hooksFor(m.threadId), lastActivityAt: Date.now() };
    wireSession(s, new AppServer({ name: `codex ${m.threadId}`, transport: t, onNotify: (method, params) => onSessionNotify(s, method, params), onRequest: request => onSessionRequest(s, request) }));
    codexSessions.set(s.threadId, s);
    live.add(m.key);
    if (m.turn) {
      const turn = makeTurn(s, { text: m.turn.userText, executionMode: m.turn.executionMode, hooks: s.hooks, offset });
      // A request the app-server sent before the restart was skipped above; the turn is
      // blocked on it until the user stops it. Say so instead of showing "Running".
      Object.assign(turn, { turnId: m.turn.turnId, startedAt: m.turn.startedAt || turn.startedAt, adopted: true,
        inputUnavailable: Boolean(m.waitingForInput) && !m.waitingForApproval, approvalUnavailable: Boolean(m.waitingForApproval) });
      writeSessionMeta(s);
    } else scheduleIdle(s);
    log(`adopted codex session thread=${m.threadId} pid=${m.pid} turn=${Boolean(m.turn)}`);
  }
  for (const f of fs.readdirSync(CX_LOG_DIR)) {
    if (live.has(f.split('.')[0])) continue;
    const full = path.join(CX_LOG_DIR, f);
    if (f.endsWith('.in.fifo')) { try { fs.unlinkSync(full); } catch { } continue; }
    if (/\.(out\.ndjson|err\.log)$/.test(f)) { try { if (Date.now() - fs.statSync(full).mtimeMs > 48 * 3600_000) fs.unlinkSync(full); } catch { } }
  }
}

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
  if (codexTurns.get(turn.threadId) === turn) codexTurns.delete(turn.threadId);
  const s = turn.session;
  if (s && s.turn === turn) { s.turn = null; writeSessionMeta(s); scheduleIdle(s); }
  else if (!s) setTimeout(() => { try { turn.conn.close(); } catch { } }, 500); // never opened a session
  // the daemon's own follow-ups (push, queue drain) must never be able to kill it
  try { turn.onFinish?.(ev, turn); } catch (e) { log(`onFinish threw thread=${turn.threadId}: ${e.message}`); }
}

function scheduleIdle(s) {
  clearTimeout(s.idleTimer);
  if (s.turn || s.closing || s.exited || !(IDLE_CLOSE_MS > 0)) return;
  s.idleTimer = setTimeout(() => { if (!s.turn) closeCodexSession(s, 'idle'); }, IDLE_CLOSE_MS);
}

// Resolves once the app-server has exited, i.e. the writer lock is free again.
export function closeCodexSession(s, why) {
  if (!s) return Promise.resolve();
  if (s.exited) return Promise.resolve();
  if (!s.closing) {
    s.closing = true;
    clearTimeout(s.idleTimer);
    log(`codex session closing thread=${s.threadId} pid=${s.conn.pid} reason=${why}`);
    s.closed = new Promise(resolve => { s.exitResolve = resolve; setTimeout(resolve, 5000); });
    try { process.kill(-s.conn.pid, 'SIGTERM'); } catch { } // its MCP servers go with it
    s.conn.close();
  }
  return s.closed;
}

// A turn object wired to the session's connection. `autonomous` turns are ones Codex
// started without a message from us.
function makeTurn(s, { text, model, effort, executionMode = 'work', hooks, autonomous = false, offset }) {
  const { emit, onFinish, onQuestion, onApproval, auditApproval } = hooks;
  const turn = {
    threadId: s.threadId, cwd: s.cwd, startedAt: Date.now(), userText: text, model, effort,
    events: [], subs: new Set(), queue: [], turnId: null, done: false, onFinish, executionMode, approvalMode: s.approvalMode, approvalItems: new Map(),
    conn: s.conn, session: s, autonomous, effectiveModel: model || s.model, effectiveEffort: effort || s.effort || null,
    baseline: descendantCpu(s.conn.pid).pids,
    offset: offset ?? (() => { try { return fs.statSync(s.conn.transport.files.out).size; } catch { return 0; } })(),
  };
  // events fan out to SSE subscribers exactly like the Claude side
  turn.emit = ev => {
    turn.events.push(ev);
    const data = `id: ${turn.events.length - 1}\ndata: ${JSON.stringify(ev)}\n\n`;
    for (const res of turn.subs) { try { res.write(data); } catch { } }
    emit?.(ev);
  };
  const conn = s.conn;
  turn.questions=new QuestionInbox({threadId:()=>turn.threadId,write:reply=>conn._write(reply),onChange:()=>{writeSessionMeta(s);turn.emit({type:'questions'});if(turn.questions?.list().length)onQuestion?.(turn);}});
  turn.approvals=new ApprovalInbox({sessionId:()=>CX+turn.threadId,turnId:()=>turn.turnId,audit:auditApproval,write:(id,result)=>new Promise((resolve,reject)=>{
    if(!conn.writable())return reject(new Error('Approval connection closed'));
    try{conn._write({jsonrpc:'2.0',id,result},e=>e?reject(e):resolve());}catch(e){reject(e);}
  }),onChange:()=>{writeSessionMeta(s);turn.emit({type:'approvals'});if(turn.approvals?.list().length)onApproval?.(turn);}});
  clearTimeout(s.idleTimer);
  s.turn = turn;
  s.lastActivityAt = Date.now();
  codexTurns.set(turn.threadId, turn);
  writeSessionMeta(s);
  return turn;
}

function onSessionNotify(s, method, params) {
  s.lastActivityAt = Date.now();
  if (!s.turn && method === 'turn/started' && s.threadId) { // Codex started a turn by itself
    makeTurn(s, { text: '', hooks: s.hooks, autonomous: true });
    log(`codex turn start (started by the agent) thread=${s.threadId}`);
  }
  if (s.turn) {
    onTurnNotify(s.turn, method, params);
    if (method === 'turn/started') writeSessionMeta(s);
  } else if (method === 'account/rateLimits/updated') mergeCodexRateLimits(params?.rateLimits);
}
function onSessionRequest(s, request) {
  s.lastActivityAt = Date.now();
  const turn = s.turn;
  if (!turn) return false;
  if(turn.questions?.receive(request,turn.turnId))return true;
  const approval=codexApproval(request,turn);
  return approval ? turn.approvals?.receive(approval) || false : false;
}
function wireSession(s, conn) {
  s.conn = conn;
  conn.onExit = () => {
    s.exited = true;
    clearTimeout(s.idleTimer);
    if (codexSessions.get(s.threadId) === s) codexSessions.delete(s.threadId);
    log(`codex session exit thread=${s.threadId} pid=${conn.pid}`);
    if (s.turn) finish(s.turn, { type: 'result', ok: false, error: s.turn.stalled ? `Stopped: no activity for ${Math.round(STALL_MS / 60_000)} minutes` : s.turn.stopped ? 'Stopped by you' : 'codex exited' });
    s.exitResolve?.();
  };
}

async function openCodexSession({ threadId, cwd, model, approvalMode, hooks }) {
  const s = { threadId, approvalMode, cwd, turn: null, hooks, lastActivityAt: Date.now() };
  const conn = new AppServer({
    name: `codex ${threadId || 'new'}`, transport: spawnTransport(),
    onNotify: (method, params) => onSessionNotify(s, method, params),
    onRequest: request => onSessionRequest(s, request),
  });
  s.conn = conn;
  conn.onExit = () => s.exitResolve?.(); // until the session is set up
  try {
    await conn.init();
    if (threadId) {
      // sandbox/approval ride on the resume, not the turn: turn/start's sandboxPolicy is
      // a tagged union, and setting it here keeps one code path for both entry points.
      const resumed = await conn.request('thread/resume', {
        threadId, ...codexPermissionSettings(approvalMode), ...(cwd ? { cwd } : {}), ...choiceInstructions(),
      }, 60_000);
      s.model = resumed.model; s.effort = resumed.reasoningEffort || null; s.cwd = resumed.cwd || cwd;
    } else {
      const r = await conn.request('thread/start', {
        cwd, ...codexPermissionSettings(approvalMode), ...choiceInstructions(),
        ...(model ? { model } : {}),
      }, 60_000);
      s.model = r.model; s.effort = r.reasoningEffort || null;
      s.threadId = r?.thread?.id || r?.threadId;
      if (!s.threadId) throw new Error('thread/start returned no id');
    }
  } catch (e) {
    try { process.kill(-conn.pid, 'SIGTERM'); } catch { }
    conn.close();
    // "already has an active writer" is the one failure worth naming precisely: the
    // thread is open somewhere else and the fix is a human action, not a retry.
    if (/active writer/i.test(e.message)) {
      throw Object.assign(new Error('This thread is open in another surface (code-server or a terminal). Close it there to send from Pocket.'), { code: 423 });
    }
    throw e;
  }
  wireSession(s, conn);
  codexSessions.set(s.threadId, s);
  writeSessionMeta(s);
  log(`codex session start thread=${s.threadId} pid=${conn.pid} resume=${Boolean(threadId)}`);
  return s;
}

export async function startCodexTurn({ threadId, cwd, text, model, effort, executionMode = 'work', approvalMode='review', attachments, emit, onFinish, onQuestion, onApproval, auditApproval }) {
  const existing = threadId && codexTurns.get(threadId);
  if (existing) throw Object.assign(new Error('busy'), { code: 409 });
  const hooks = { emit, onFinish, onQuestion, onApproval, auditApproval };
  let s = threadId && codexSessions.get(threadId);
  // Permissions ride on thread/resume, so a change needs a fresh process (after the old
  // one has let go of the writer lock).
  if (s && (s.closing || s.exited || s.approvalMode !== approvalMode || (cwd && s.cwd && cwd !== s.cwd))) {
    await closeCodexSession(s, s.closing || s.exited ? 'closing' : 'settings changed');
    s = null;
  }
  const reused = Boolean(s);
  if (!s) s = await openCodexSession({ threadId, cwd, model, approvalMode, hooks });
  s.hooks = hooks;
  if (codexTurns.get(s.threadId)) throw Object.assign(new Error('busy'), { code: 409 });
  const turn = makeTurn(s, { text, model, effort, executionMode, hooks });
  turn.emit({ type: 'user', msg: { role: 'user', text, ts: new Date().toISOString() } });

  const input = [{ type: 'text', text: promptWithAttachments(text, attachments) }];
  try {
    const r=await s.conn.request('turn/start', {
      threadId:turn.threadId,input,
      collaborationMode:{mode:executionMode==='plan'?'plan':'default',settings:{model:turn.effectiveModel,reasoning_effort:turn.effectiveEffort,developer_instructions:null}},
      ...(model?{model}:{}),...(effort?{effort}:{}),
    },120_000);
    turn.turnId=r?.turn?.id || turn.turnId;
    writeSessionMeta(s);
  }catch(e){
    finish(turn,{type:'result',ok:false,error:e.message});
    closeCodexSession(s, 'turn/start failed'); // don't hold the thread's writer lock on a failed start
    throw e;
  }

  log(`turn start thread=${turn.threadId} process=${reused ? 'reused' : 'new'} pid=${s.conn.pid} cwd=${s.cwd || '(thread cwd)'}`);
  return turn;
}

// Stall watchdog, same rule as the Claude side: stop a turn only after STALL_MS with no
// notification from the app-server, nothing waiting on the user and no CPU use by
// programs the turn started. Interrupt first; close the process if that goes unanswered.
function codexStallCheck() {
  if (!(STALL_MS > 0)) return;
  for (const s of codexSessions.values()) {
    const t = s.turn;
    if (!t || s.exited || t.stalled || t.done) continue;
    const { pids, cpu } = descendantCpu(s.conn.pid);
    let ticks = 0;
    for (const p of pids) if (!t.baseline.has(p)) ticks += cpu.get(p) || 0;
    if (t.cpuTicks === undefined || ticks > t.cpuTicks + 100) t.cpuBusyAt = Date.now();
    t.cpuTicks = ticks;
    const quietFor = Date.now() - Math.max(s.lastActivityAt, t.cpuBusyAt || 0);
    if (quietFor < STALL_MS) continue;
    if (t.questions?.list().length || t.approvals?.list().length) continue;
    t.stalled = true;
    log(`codex turn STALLED thread=${s.threadId} quiet=${Math.round(quietFor / 60_000)}min — stopping`);
    if (t.turnId) s.conn.request('turn/interrupt', { threadId: s.threadId, turnId: t.turnId }, 20_000).catch(() => { });
    setTimeout(() => { if (s.turn === t) closeCodexSession(s, 'stalled'); }, 30_000);
  }
}
setInterval(codexStallCheck, Math.min(60_000, Math.max(250, STALL_MS / 4))).unref();

function promptWithAttachments(text, attachments) {
  if (!attachments?.length) return text;
  return text + '\n\n[Attached file' + (attachments.length > 1 ? 's' : '') + ' — read as needed:\n'
    + attachments.join('\n') + '\n]';
}

// The streaming channel. `item/agentMessage/delta` is the word-by-word feed; completed
// items become finished bubbles; `turn/completed` closes the turn out with usage.
function onTurnNotify(turn, method, params) {
  if (['item/started','item/completed'].includes(method) && ['collabAgentToolCall','subAgentActivity'].includes(params?.item?.type)) {
    turn.agentItems ||= new Map();
    turn.agentItems.set(params.item.id, params.item);
  }
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
    case 'thread/tokenUsage/updated': {
      turn.usage = params?.usage || params;
      const tu = params?.tokenUsage;
      if (tu) {
        // "last" is this call's breakdown — the context fed into the model, same idea
        // as Claude's input + cache_read + cache_creation on the latest assistant line.
        const last = tu.last || tu.total || {};
        const used = (last.inputTokens || 0) + (last.cachedInputTokens || 0);
        const window = tu.modelContextWindow || null;
        codexUsage.context[turn.threadId] = {
          used, window: window || estimateWindow(turn.effectiveModel, used),
          estimated: !window, model: turn.effectiveModel || null, lastAt: Date.now(),
        };
        saveCodexUsage();
      }
      break;
    }
    case 'account/rateLimits/updated':
      mergeCodexRateLimits(params?.rateLimits);
      break;
    case 'turn/completed': {
      const u = params?.usage || turn.usage || {};
      finish(turn, {
        type: 'result', ok: !turn.stopped && !turn.stalled && !['failed','interrupted'].includes(params?.turn?.status),
        error:turn.stalled?`Stopped: no activity for ${Math.round(STALL_MS / 60_000)} minutes`:turn.stopped?'Stopped by you':params?.turn?.error?.message,
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
      .catch(e => { log(`interrupt failed thread=${threadId}: ${e.message}`); closeCodexSession(turn.session, 'interrupt failed'); });
  } else if (turn.session) closeCodexSession(turn.session, 'stopped before the turn began');
  else turn.conn.close();
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
export function watchCodexThread(threadId, onMsg, { intervalMs = 2500, after = null } = {}) {
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
      // A reconnect names the last item it saw: everything after it is news, not baseline.
      let resumeAt = priming && after ? rows.findIndex(it => it.id === after) : -1;
      for (const [i, it] of rows.entries()) {
        const key = it.id || JSON.stringify(it).slice(0, 120);
        if (seen.has(key)) continue;
        seen.add(key);
        if (priming && (resumeAt < 0 || i <= resumeAt)) continue; // baseline, it isn't news
        const msg = normalizeItem(it, new Date().toISOString());
        if (msg) onMsg({ type: msg.role === 'user' ? 'user' : 'assistant', msg, itemId: it.id || undefined });
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

// ---------- usage visibility (Feature G) ----------
// Sparse update: the backend sends only the fields that changed, so this merges onto
// whatever we last saw rather than replacing it (per AccountRateLimitsUpdatedNotification's
// own contract — nullable fields absent from an update don't clear a previously observed
// value). Shallow merge is good enough for the primary/secondary window objects we show.
function mergeCodexRateLimits(snap) {
  if (!snap) return;
  const prev = codexUsage.rateLimits || {};
  codexUsage.rateLimits = {
    ...prev, ...snap,
    primary: snap.primary ? { ...prev.primary, ...snap.primary } : prev.primary,
    secondary: snap.secondary ? { ...prev.secondary, ...snap.secondary } : prev.secondary,
    observedAt: Date.now(),
  };
  saveCodexUsage();
}

// Per-session context meter for the UI: same {used,window,pct,estimated,model} shape the
// Claude side exposes. Only populated for threads this daemon has actually run a turn on
// and received a tokenUsage/updated notification for — Codex gives us no transcript-based
// fallback the way Claude's assistant-line usage does.
export function getCodexContext(threadId) {
  const c = codexUsage.context[threadId];
  if (!c) return null;
  return { used: c.used, window: c.window, pct: c.window ? Math.min(1, c.used / c.window) : 0, estimated: Boolean(c.estimated), model: c.model || null, lastAt: c.lastAt || null };
}

// Best-effort account rate limits: try a live read on the shared reader connection (this
// is the one account/rateLimits/read call Pocket makes, so the plan-usage panel doesn't
// need an active turn to show something), falling back to whatever a running turn last
// pushed via the account/rateLimits/updated notification. Returns null — not an error —
// when this Codex CLI build doesn't expose the method at all.
export async function codexRateLimits() {
  try {
    const r = await rpc('account/rateLimits/read', {}, 15_000);
    if (r?.rateLimits) mergeCodexRateLimits(r.rateLimits);
  } catch (e) { log(`account/rateLimits/read unavailable: ${e.message}`); }
  return codexUsage.rateLimits || null;
}

export async function accountSummary(){
 const r=await rpc('account/read',{refreshToken:false},15000);const a=r.account;
 return {provider:'codex',signedIn:Boolean(a),method:a?.type||'Not signed in',email:typeof a?.email==='string'?a.email:null,plan:typeof a?.planType==='string'?a.planType:null};
}
