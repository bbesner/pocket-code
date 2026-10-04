// Pocket Code — mobile web UI for the Claude Code and Codex sessions on this box.
// The daemon owns every turn: a message POSTed here spawns `claude -p --resume`
// server-side, so the phone can disconnect/sleep and the turn still completes.
// Transcripts stay in ~/.claude/projects — the same store code-server reads.

import express from 'express';
import webpush from 'web-push';
import { spawn, execSync, execFileSync } from 'node:child_process';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import * as codex from './codex.mjs';
import { DeliveryReceipts, withDeliveryReceipt } from './delivery.mjs';
import { sessionState, prioritizeSessions } from './session-state.mjs';
import { collectResults } from './results.mjs';
import { FollowupQueue } from './queue.mjs';
import {workspaceStatus,workspaceDiff} from './workspace.mjs';
import {readClaudeIdentity,agentEnv} from './environment.mjs';
import {QuestionInbox} from './questions.mjs';
import {ApprovalInbox,approvalAudit,approvalMode,claudePermissionSettings} from './approvals.mjs';
import {UsageStore,getSessionContext} from './usage.mjs';

// ---------- config ----------
const HOME = os.homedir();
const ENV_FILE = path.join(import.meta.dirname, '.env');
for (const line of (fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8').split('\n') : [])) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const PROJECTS_ROOT = process.env.POCKET_SESSION_ROOT || path.join(HOME, '.claude', 'projects');
const DATA_DIR = process.env.POCKET_DATA_DIR || import.meta.dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
const deliveryReceipts = new DeliveryReceipts(path.join(DATA_DIR, 'delivery-receipts.json'));
const followups = new FollowupQueue(path.join(DATA_DIR, 'followup-queue.json'));
const usage = new UsageStore(path.join(DATA_DIR, 'usage-state.json'));
const ALLOW_FULL_ACCESS=process.env.POCKET_ALLOW_FULL_ACCESS!=='0';
const DEFAULT_APPROVAL_MODE=approvalMode(process.env.POCKET_APPROVAL_MODE,'review',ALLOW_FULL_ACCESS);
const auditApproval=approvalAudit(path.join(DATA_DIR,'approval-decisions.jsonl'));
const PORT = Number(process.env.PORT || 3610);
const PASSWORD = process.env.POCKET_PASSWORD;
const SECRET = process.env.POCKET_SECRET;
if (!PASSWORD || !SECRET) {
  console.error('POCKET_PASSWORD and POCKET_SECRET must be set in .env');
  process.exit(1);
}
const CLAUDE_BIN = process.env.CLAUDE_BIN
  || [path.join(HOME, '.npm-global', 'bin', 'claude'), '/usr/local/bin/claude', '/usr/bin/claude']
    .find(p => fs.existsSync(p)) || 'claude';
// A session's CLI process closes after this long with no turn and no background job.
const IDLE_CLOSE_MS = Number(process.env.POCKET_IDLE_CLOSE_MS ?? 60 * 60_000);
// A turn is stopped only after this long with no output, no background job, nothing
// waiting on the user and no CPU use by programs it started (replaces the 2h hard kill).
const STALL_MS = Number(process.env.POCKET_STALL_MS ?? 30 * 60_000);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Codex threads live behind a `cx:` prefix (see codex.mjs) — their ids are UUID-shaped
// too, so every id check below has to ask the prefix, not the regex.
const CODEX_ON = process.env.POCKET_CODEX !== '0' && codex.codexAvailable();
const isCx = codex.isCodexId;
const anyId = id => isCx(id) ? UUID_RE.test(codex.bareId(id)) : UUID_RE.test(id);
const UPLOAD_DIR = path.join(HOME, 'pocket-uploads');
// Claude model picker — the one list; the client fetches it from /api/claude/models.
// Each id verified with `claude -p --model <id>` on CLI 2.1.281 (2026-09-25). Fable and
// Opus use their [1m] ids so picking one on a long resumed session can't overflow the
// 200k window. 'default' = no --model flag, i.e. the box's ~/.claude/settings.json.
// Effort maps to settings.effortLevel.
const CLAUDE_MODELS = [
  { id: 'claude-fable-5-1[1m]', label: 'Fable 5.1', sub: 'Top tier · 1M context', alias: 'fable' },
  { id: 'claude-opus-5-5[1m]', label: 'Opus 5.5', sub: 'Strong + cheaper than Fable · 1M', alias: 'opus' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', sub: 'Fast, near-Opus on coding', alias: 'sonnet' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', sub: 'Fastest, light tasks', alias: 'haiku' },
];
const MODELS = new Set(CLAUDE_MODELS.map(m => m.id));
// Human label for whatever the global settings pin ('opus[1m]', 'claude-fable-5-1', …).
// Read per request so a settings change shows without a restart.
function claudeDefaultLabel() {
  if (POCKET_DEFAULTS.claude.model) return CLAUDE_MODELS.find(m => m.id === POCKET_DEFAULTS.claude.model).label;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(HOME, '.claude', 'settings.json'), 'utf8')).model; } catch { }
  if (!raw) return 'CLI default';
  const base = raw.replace(/\[1m\]$/i, ''), big = base !== raw ? ' · 1M' : '';
  const hit = CLAUDE_MODELS.find(m => m.alias === base || m.id.replace(/\[1m\]$/, '') === base);
  return hit ? hit.label + big : raw;
}
const EFFORTS = new Set(['max', 'xhigh', 'high', 'medium', 'low']);
const CODEX_EFFORTS = new Set([...EFFORTS, 'ultra']);
// Pocket-only defaults for turns that leave Model/Effort on Default. Unset = the CLI's
// own config (~/.claude/settings.json, ~/.codex/config.toml); terminal sessions never
// see these.
const envPick = (name, ok) => { const v = (process.env[name] || '').trim(); return v && ok(v) ? v : undefined; };
const POCKET_DEFAULTS = {
  claude: { model: envPick('POCKET_CLAUDE_MODEL', v => MODELS.has(v)), effort: envPick('POCKET_CLAUDE_EFFORT', v => EFFORTS.has(v)) },
  codex: { model: envPick('POCKET_CODEX_MODEL', v => /^[\w.-]{1,64}$/.test(v)), effort: envPick('POCKET_CODEX_EFFORT', v => CODEX_EFFORTS.has(v)) },
};
for (const [name, ok] of [['POCKET_CLAUDE_MODEL', POCKET_DEFAULTS.claude.model], ['POCKET_CLAUDE_EFFORT', POCKET_DEFAULTS.claude.effort], ['POCKET_CODEX_MODEL', POCKET_DEFAULTS.codex.model], ['POCKET_CODEX_EFFORT', POCKET_DEFAULTS.codex.effort]])
  if (process.env[name] && !ok) console.warn(`${name}=${process.env[name]} is not a supported value; using the CLI default`);
const withDefaults = (provider, opts) => ({ ...opts, model: opts.model || POCKET_DEFAULTS[provider].model, effort: opts.effort || POCKET_DEFAULTS[provider].effort });
// Workspace the New session screen preselects; unset = wherever you last started one.
const DEFAULT_CWD = envPick('POCKET_DEFAULT_CWD', v => path.isAbsolute(v) && fs.existsSync(v) && fs.statSync(v).isDirectory());

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- web push (turn-completion notifications) ----------
const SUBS_FILE = path.join(DATA_DIR, 'push-subs.json');
const pushReady = Boolean(process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE);
// VAPID subject: the operator contact push services may use — an email (mailto: added) or an https URL.
const vapidSubject = (c => !c ? 'https://github.com/bbesner/pocket-code' : /^(mailto:|https:)/.test(c) ? c : `mailto:${c}`)(process.env.VAPID_CONTACT);
if (pushReady) webpush.setVapidDetails(vapidSubject, process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
else log('push disabled: VAPID keys not set');
const loadSubs = () => { try { return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')); } catch { return []; } };
const saveSubs = s => fs.writeFileSync(SUBS_FILE, JSON.stringify(s, null, 1));
// per-session mute: a chatty background session shouldn't buzz the phone every turn
const MUTES_FILE = path.join(DATA_DIR, 'mutes.json');
const loadMutes = () => { try { return new Set(JSON.parse(fs.readFileSync(MUTES_FILE, 'utf8'))); } catch { return new Set(); } };
let mutes = loadMutes();
const saveMutes = () => fs.writeFileSync(MUTES_FILE, JSON.stringify([...mutes]));
// per-session pin + custom name: the CLI's session store has no field for either, so they
// live in an overlay here (same pattern as mutes) — transcripts stay untouched
const SMETA_FILE = path.join(DATA_DIR, 'session-meta.json');
const loadSmeta = () => { try { return JSON.parse(fs.readFileSync(SMETA_FILE, 'utf8')); } catch { return {}; } };
let smeta = loadSmeta();
const saveSmeta = () => fs.writeFileSync(SMETA_FILE, JSON.stringify(smeta, null, 1));
const isPinned = id => Boolean(smeta[id]?.pin);
// server-wide options (one tenant per install). titleSync: share session names with
// Claude Code itself — read the CLI/code-server's custom-title/ai-title records from the
// transcript and write renames back as custom-title lines (their own rename mechanism).
const SETTINGS_FILE = path.join(DATA_DIR, 'pocket-settings.json');
const loadSettings = () => { try { return { titleSync: false, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch { return { titleSync: false }; } };
let settings = loadSettings();
const saveSettings = () => fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 1));
const setSmeta = (id, patch) => {
  const m = { ...smeta[id], ...patch };
  for (const k of Object.keys(m)) if (m[k] == null) delete m[k];
  if (Object.keys(m).length) smeta[id] = m; else delete smeta[id];
  saveSmeta();
};
async function pushNotify(sessionId, title, body) {
  if (!pushReady) return;
  if (mutes.has(sessionId)) return log(`push muted session=${sessionId}`);
  const subs = loadSubs();
  if (!subs.length) return;
  const payload = JSON.stringify({ title: title.slice(0, 70), body, tag: sessionId, url: '/#/chat/' + sessionId });
  const dead = [];
  await Promise.all(subs.map(async s => {
    try { await webpush.sendNotification(s, payload); }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) dead.push(s.endpoint); }
  }));
  if (dead.length) saveSubs(loadSubs().filter(s => !dead.includes(s.endpoint)));
  log(`push sent (${subs.length - dead.length} devices) session=${sessionId}`);
}

// ---------- auth ----------
function sign(exp) {
  return createHmac('sha256', SECRET).update(String(exp)).digest('hex');
}
function makeCookie() {
  const exp = Date.now() + 90 * 24 * 3600 * 1000;
  return `${exp}.${sign(exp)}`;
}
function checkCookie(v) {
  if (!v) return false;
  const [exp, sig] = v.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const want = sign(exp);
  return sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}
const loginAttempts = new Map(); // ip -> {n, resetAt}
function rateLimited(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || rec.resetAt < now) { loginAttempts.set(ip, { n: 1, resetAt: now + 3600_000 }); return false; }
  rec.n++;
  return rec.n > 20;
}
function getCookie(req, name) {
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}
function requireAuth(req, res, next) {
  if (checkCookie(getCookie(req, 'pc_auth'))) return next();
  res.status(401).json({ error: 'unauthorized' });
}

// ---------- session store (read side) ----------
async function readFirstLines(file, maxBytes = 128 * 1024) {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return buf.toString('utf8', 0, bytesRead).split('\n');
  } finally { await fh.close(); }
}

// Cheap metadata: title + cwd from the head of the transcript.
const metaCache = new Map(); // file -> {mtimeMs, meta}
function scanMetaLine(line, acc) {
  if (!line.trim()) return;
  let o; try { o = JSON.parse(line); } catch { return; }
  if (!acc.cwd && o.cwd) acc.cwd = o.cwd;
  // Claude Code's own title records (what code-server / `claude --resume` display).
  // Appended over time — LAST occurrence wins, matching their reader.
  if (o.type === 'custom-title' && o.customTitle) acc.customTitle = o.customTitle;
  if (o.type === 'ai-title' && o.aiTitle) acc.aiTitle = o.aiTitle;
  if (!acc.title && o.type === 'summary' && o.summary) acc.title = o.summary;
  if (!acc.firstUser && o.type === 'user' && !o.isSidechain) {
    const c = o.message?.content;
    const txt = typeof c === 'string' ? c : (Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join(' ') : '');
    // "Workdir: /path." prefixes (a common session template) are boilerplate — the
    // project is already shown on the row; title should be the actual ask
    const clean = (txt || '').replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').replace(/\s+/g, ' ')
      .replace(/^\s*Workdir:\s*\S+\s*[.,;—-]*\s*/i, '').trim();
    if (clean) acc.firstUser = clean;
  }
}
// Title records live at the end of the transcript (appended on each rename), past the
// 128KB head window — read a generous tail chunk too. A record buried mid-file in a
// very large session can escape both windows; Pocket's own renames also land in the
// overlay, so only a deeply-buried code-server rename could lag.
async function readTailLines(file, size, maxBytes = 256 * 1024) {
  const start = Math.max(0, size - maxBytes);
  if (size <= 0 || start === 0) return []; // small file: the head read saw everything
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    return buf.toString('utf8', 0, bytesRead).split('\n').slice(1); // first line is partial
  } finally { await fh.close(); }
}

// titles compose on the way out — the cache keeps raw fields so a rename or a
// settings flip never requires re-reading the transcript.
// titleSync ON: Claude Code's own records win (custom-title = a rename on either
// surface, last one in the file wins — matching their reader), then Pocket's overlay,
// then their ai-title, then the derived title. OFF: overlay then derived, as before.
const composeTitle = m => {
  const ov = smeta[m.id]?.name;
  const title = settings.titleSync
    ? (m.customTitle || ov || m.aiTitle || m.title)
    : (ov || m.title);
  return { ...m, title };
};
async function sessionMeta(file, id) {
  const st = await fsp.stat(file);
  const cached = metaCache.get(file);
  if (cached && cached.mtimeMs === st.mtimeMs) return composeTitle({ ...cached.meta, mtimeMs: st.mtimeMs, size: st.size });
  const acc = { title: null, cwd: null, firstUser: null, customTitle: null, aiTitle: null };
  try {
    for (const line of await readFirstLines(file)) {
      scanMetaLine(line, acc);
      if (acc.cwd && acc.title && acc.firstUser) break;
    }
    // tail pass for title records appended after the head window (later line wins)
    for (const line of await readTailLines(file, st.size)) {
      if (!line.includes('"custom-title"') && !line.includes('"ai-title"')) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type === 'custom-title' && o.customTitle) acc.customTitle = o.customTitle;
      if (o.type === 'ai-title' && o.aiTitle) acc.aiTitle = o.aiTitle;
    }
    // Giant early lines (file-history snapshots, queue ops) can push the first real
    // user message past the 128KB head — a head-only verdict would hide a real session.
    // Deep-scan before calling it noise; skip pathological lines, stop at first hit.
    if (!acc.firstUser && !acc.title) {
      const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
      for await (const line of rl) {
        if (line.length > 500_000) continue;
        scanMetaLine(line, acc);
        if (acc.firstUser || acc.title) break;
      }
      rl.close();
    }
  } catch { /* unreadable — show what we have */ }
  const { title, cwd, firstUser, customTitle, aiTitle } = acc;
  // noise = no human message and no summary anywhere: hook runs, subagent scratch, warmups
  const meta = { id, title: title || firstUser || '(untitled session)', cwd, noise: !firstUser && !title, customTitle, aiTitle };
  metaCache.set(file, { mtimeMs: st.mtimeMs, meta });
  return composeTitle({ ...meta, mtimeMs: st.mtimeMs, size: st.size });
}

async function listSessions(limit = 60) {
  const out = [];
  let dirs = [];
  try { dirs = await fsp.readdir(PROJECTS_ROOT); } catch { return out; }
  const files = [];
  await Promise.all(dirs.map(async d => {
    const dir = path.join(PROJECTS_ROOT, d);
    let entries; try { entries = await fsp.readdir(dir); } catch { return; }
    for (const f of entries) {
      const id = f.replace(/\.jsonl$/, '');
      if (f.endsWith('.jsonl') && UUID_RE.test(id)) files.push({ file: path.join(dir, f), id });
    }
  }));
  const stats = await Promise.all(files.map(async x => {
    try { return { ...x, mtimeMs: (await fsp.stat(x.file)).mtimeMs }; } catch { return null; }
  }));
  // overshoot the limit: hygiene below drops noise rows and collapses duplicates
  const sorted = stats.filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const recent = sorted.slice(0, Math.min(limit * 2, 400));
  for (const x of sorted.slice(recent.length)) if (isPinned(x.id) || turns.has(x.id) || extActive(x.id) || followups.list(x.id).length) recent.push(x); // pins never age out
  // read metadata 8 files at a time — a cold cache (every restart) meant up to 400 serial
  // head/tail reads; the dedupe walk below is order-dependent, the reads aren't
  const metas = new Array(recent.length);
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < recent.length) { const i = next++; metas[i] = await sessionMeta(recent[i].file, recent[i].id); }
  }));
  const seen = new Map(); // title+cwd -> listed entry (resumed sessions repeat both)
  for (const [i, x] of recent.entries()) {
    const pinned = isPinned(x.id);
    const meta = metas[i];
    if (meta.cwd?.startsWith('/tmp/') && !pinned) continue; // scratch/test sessions
    const active = turns.has(x.id) || extActive(x.id);
    if (meta.noise && !active && !pinned) continue; // hook/subagent noise: no user message, no summary
    const key = meta.title + '\u0000' + (meta.cwd || '');
    const prev = seen.get(key);
    if (prev && !active && !pinned) { prev.dupes = (prev.dupes || 0) + 1; continue; } // older resume copy
    const entry = { ...meta, noise: undefined, active, pinned: pinned || undefined };
    if (!prev) seen.set(key, entry);
    out.push(entry);
  }
  // pins float; the limit applies to the unpinned remainder so a deep pin can't push
  // recent sessions out (dupes-collapsing needed the full walk anyway)
  const pins = out.filter(e => e.pinned);
  const active = out.filter(e => !e.pinned && e.active);
  return [...pins, ...active, ...out.filter(e => !e.pinned && !e.active).slice(0, Math.max(0, limit - pins.length - active.length))];
}

async function findSessionFile(id) {
  if (!UUID_RE.test(id)) return null;
  let dirs; try { dirs = await fsp.readdir(PROJECTS_ROOT); } catch { return null; }
  for (const d of dirs) {
    const f = path.join(PROJECTS_ROOT, d, id + '.jsonl');
    if (fs.existsSync(f)) return f;
  }
  return null;
}
function sessionFileSync(id) {
  if (!UUID_RE.test(id)) return null;
  let dirs; try { dirs = fs.readdirSync(PROJECTS_ROOT); } catch { return null; }
  for (const d of dirs) {
    const f = path.join(PROJECTS_ROOT, d, id + '.jsonl');
    if (fs.existsSync(f)) return f;
  }
  return null;
}

// ---------- transcript normalization ----------
function toolSummary(name, input) {
  if (!input) return name;
  if (name === 'Bash') return input.description || (input.command || '').slice(0, 140);
  if (name === 'Read' || name === 'Write' || name === 'Edit') return input.file_path || '';
  if (name === 'Skill') return input.skill || '';
  if (name === 'Agent' || name === 'Task') return input.description || '';
  if (name === 'WebFetch' || name === 'WebSearch') return input.url || input.query || '';
  try { return JSON.stringify(input).slice(0, 140); } catch { return ''; }
}

// The transcript format drifts across CLI versions — one surprising line must cost
// that line, never the whole session view.
function normalizeLine(o) {
  try { return normalizeLineInner(o); } catch { return null; }
}

function normalizeLineInner(o) {
  // returns a display message or null
  if (o.isSidechain) return null;
  // a message steered/queued into a running turn lands as an attachment line, not a user line
  if (o.type === 'attachment' && o.attachment?.type === 'queued_command') {
    // prompt was an array of content blocks in older CLI versions, a plain string in newer ones
    const p = o.attachment.prompt;
    const txt = (typeof p === 'string' ? p
      : Array.isArray(p) ? p.filter(b => b?.type === 'text').map(b => b.text).join('\n')
        : '').trim();
    if (!txt || /^\s*<(local-command|command-name|system-remind|task-notification)/.test(txt)) return null;
    return { role: 'user', text: txt, ts: o.timestamp };
  }
  if (o.type === 'user') {
    const c = o.message?.content;
    let txt = null;
    if (typeof c === 'string') txt = c;
    else if (Array.isArray(c)) {
      if (c.some(b => b.type === 'tool_result')) return null; // tool results ride user lines
      txt = c.filter(b => b.type === 'text').map(b => b.text).join('\n');
    }
    if (!txt || !txt.trim() || /^\s*<(local-command|command-name|system-remind)/.test(txt)) return null;
    // render our attachment block as file chips, not raw bracket text
    let files;
    const am = txt.match(/\n\n\[Attached files? — read as needed:\n([\s\S]*?)\n\]\s*$/);
    if (am) { // name + path so the client can thumbnail image attachments
      files = am[1].split('\n').filter(Boolean).map(p => ({ n: p.split('/').pop(), p }));
      txt = txt.slice(0, am.index);
    }
    return { role: 'user', text: txt.trim(), files, ts: o.timestamp };
  }
  if (o.type === 'assistant') {
    const blocks = [];
    for (const b of o.message?.content || []) {
      if (b.type === 'text' && b.text?.trim()) blocks.push({ t: 'text', text: b.text });
      if (b.type === 'tool_use') {
        // TodoWrite carries the plan — pass the list through so the client can draw a
        // live checklist instead of a truncated JSON blob on a ledger line.
        if (b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) {
          blocks.push({ t: 'todo', todos: b.input.todos.map(x => ({ c: String(x.content ?? ''), s: String(x.status ?? '') })) });
        } else blocks.push({ t: 'tool', name: b.name, detail: toolSummary(b.name, b.input) });
      }
    }
    return blocks.length ? { role: 'assistant', blocks, ts: o.timestamp } : null;
  }
  return null;
}

async function readTranscript(file, maxMsgs = 400) {
  const msgs = [];
  let total = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const m = normalizeLine(o);
    if (m) { total++; msgs.push(m); if (msgs.length > maxMsgs * 2) msgs.splice(0, msgs.length - maxMsgs); }
  }
  return { msgs: msgs.slice(-maxMsgs), total };
}

// ---------- changed files (what did it do to my code) ----------
// normalizeLine drops old_string/new_string on purpose (ledger lines stay small), so
// the changes view re-reads the .jsonl. Sidechain (subagent) edits are included — they
// touch the code just the same. Ops whose tool_result came back is_error are dropped.
const CHANGE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const CHANGE_CAP = 20_000; // per-string payload bound
async function collectChanges(file) {
  const clip = s => s == null ? null : String(s).slice(0, CHANGE_CAP);
  const recs = []; // {ops:[{path,tool,old,new,all,trunc}], ts, err}
  const byUse = new Map(); // tool_use id -> rec
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'assistant') {
      for (const b of o.message?.content || []) {
        if (b.type !== 'tool_use' || !CHANGE_TOOLS.has(b.name)) continue;
        const inp = b.input || {};
        const p = inp.file_path || inp.notebook_path;
        if (!p) continue;
        const op = (tool, old, nw, all) => ({
          path: p, tool, old: clip(old), new: clip(nw), all: Boolean(all),
          trunc: (old?.length > CHANGE_CAP) || (nw?.length > CHANGE_CAP) || undefined,
        });
        let ops;
        if (b.name === 'MultiEdit' && Array.isArray(inp.edits)) {
          ops = inp.edits.map(e => op('Edit', e.old_string, e.new_string, e.replace_all));
        } else if (b.name === 'Edit') ops = [op('Edit', inp.old_string, inp.new_string, inp.replace_all)];
        else if (b.name === 'Write') ops = [op('Write', null, inp.content)];
        else ops = [op('NotebookEdit', null, inp.new_source)];
        const rec = { ops, ts: o.timestamp, err: false };
        if (b.id) byUse.set(b.id, rec);
        recs.push(rec);
      }
    } else if (o.type === 'user' && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        if (b.type === 'tool_result' && b.is_error && byUse.has(b.tool_use_id)) byUse.get(b.tool_use_id).err = true;
      }
    }
  }
  const files = new Map(); // path -> ops in transcript order
  let failed = 0;
  for (const rec of recs) {
    if (rec.err) { failed += rec.ops.length; continue; }
    for (const op of rec.ops) {
      if (!files.has(op.path)) files.set(op.path, []);
      files.get(op.path).push({ ...op, path: undefined, ts: rec.ts });
    }
  }
  return { files: [...files.entries()].map(([path, ops]) => ({ path, ops })), failed };
}

// ---------- full-text search within one session ----------
function msgSearchText(m) {
  if (m.role === 'user') return m.text || '';
  return (m.blocks || []).map(b =>
    b.t === 'text' ? b.text
      : b.t === 'todo' ? b.todos.map(t => t.c).join('\n')
        : `${b.name} ${b.detail || ''}`).join('\n');
}
async function searchTranscript(file, q, maxMatches = 50) {
  const needle = q.toLowerCase();
  const matches = [];
  let total = 0, more = false;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const m = normalizeLine(o);
    if (!m) continue;
    total++;
    const text = msgSearchText(m), lc = text.toLowerCase();
    const at = lc.indexOf(needle);
    if (at < 0) continue;
    if (matches.length >= maxMatches) { more = true; continue; }
    let hits = 0;
    for (let i = at; i >= 0; i = lc.indexOf(needle, i + needle.length)) hits++;
    const s = Math.max(0, at - 120), e = Math.min(text.length, at + needle.length + 240);
    matches.push({
      i: total - 1, role: m.role, ts: m.ts, hits,
      text: (s ? '…' : '') + text.slice(s, e).replace(/\s+/g, ' ').trim() + (e < text.length ? '…' : ''),
    });
  }
  return { total, matches, more };
}

// Same matcher, but over already-normalized messages (Codex hands us objects, not a
// file of lines). Keeps one shape of search result for the client's find bar.
function searchMsgs(msgs, q, maxMatches = 50) {
  const needle = q.toLowerCase();
  const matches = [];
  let more = false;
  msgs.forEach((m, i) => {
    const text = msgSearchText(m), lc = text.toLowerCase();
    const at = lc.indexOf(needle);
    if (at < 0) return;
    if (matches.length >= maxMatches) { more = true; return; }
    let hits = 0;
    for (let j = at; j >= 0; j = lc.indexOf(needle, j + needle.length)) hits++;
    const s = Math.max(0, at - 120), e = Math.min(text.length, at + needle.length + 240);
    matches.push({
      i, role: m.role, ts: m.ts, hits,
      text: (s ? '…' : '') + text.slice(s, e).replace(/\s+/g, ' ').trim() + (e < text.length ? '…' : ''),
    });
  });
  return { total: msgs.length, matches, more };
}

// ---------- external activity watcher (live mirror of sessions driven elsewhere) ----------
// code-server / terminal sessions write the same transcript files; watching them lets
// the app stream those turns live and light the ember for work started anywhere.
const EXT_ACTIVE_MS = 45_000;
const ownedTranscriptMtime = new Map();
// Transcript size after our last turn (fork guard), kept across restarts so our own
// earlier turns are never mistaken for another app's.
const OWNED_FILE = path.join(DATA_DIR, 'owned-transcripts.json');
const ownedTranscriptSize = new Map((() => { try { return Object.entries(JSON.parse(fs.readFileSync(OWNED_FILE, 'utf8'))); } catch { return []; } })());
function rememberOwnedSize(id, size) {
  ownedTranscriptSize.delete(id); ownedTranscriptSize.set(id, size);
  while (ownedTranscriptSize.size > 500) ownedTranscriptSize.delete(ownedTranscriptSize.keys().next().value);
  try { fs.writeFileSync(OWNED_FILE, JSON.stringify(Object.fromEntries(ownedTranscriptSize)), { mode: 0o600 }); } catch { }
}
const extActivity = new Map(); // sessionId -> last transcript write (ms)
const tailers = new Map();     // sessionId -> Set<{res, offset, rem}>
const dirWatchers = new Map();
function watchDirs() {
  let dirs = []; try { dirs = fs.readdirSync(PROJECTS_ROOT); } catch { return; }
  for (const d of dirs) {
    const dir = path.join(PROJECTS_ROOT, d);
    if (dirWatchers.has(dir)) continue;
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      const w = fs.watch(dir, (_evt, fname) => {
        if (!fname || !fname.endsWith('.jsonl')) return;
        const id = fname.slice(0, -6);
        if (!UUID_RE.test(id)) return;
        if(!turns.has(id)){let mtime;try{mtime=fs.statSync(path.join(dir,fname)).mtimeMs;}catch{}if(mtime===undefined||ownedTranscriptMtime.get(id)!==mtime)extActivity.set(id,Date.now());}
        if (tailers.get(id)?.size) pumpTail(id, path.join(dir, fname));
      });
      w.on('error', () => { try { w.close(); } catch { } dirWatchers.delete(dir); });
      dirWatchers.set(dir, w);
    } catch { }
  }
}
watchDirs();
setInterval(watchDirs, 60_000).unref();
const extActive = id => (Date.now() - (extActivity.get(id) || 0)) < EXT_ACTIVE_MS;

// Codex has no per-file signal to watch (its store is a sqlite projection), so the
// equivalent "someone else is working in this thread" hint comes from polling recency.
if (CODEX_ON) {
  codex.pollCodexActivity();
  setInterval(() => codex.pollCodexActivity(), 15_000).unref();
}

const pumping = new Set();
async function pumpTail(id, file) {
  if (pumping.has(id)) return;
  pumping.add(id);
  try {
    const set = tailers.get(id);
    if (!set?.size) return;
    const size = (await fsp.stat(file)).size;
    for (const t of set) {
      if (size <= t.offset) continue;
      const fh = await fsp.open(file, 'r');
      try {
        const buf = Buffer.alloc(size - t.offset);
        await fh.read(buf, 0, buf.length, t.offset);
        t.offset = size;
        const lines = (t.rem + buf.toString('utf8')).split('\n');
        t.rem = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let o; try { o = JSON.parse(line); } catch { continue; }
          const m = normalizeLine(o);
          if (m) { try { t.res.write(`data: ${JSON.stringify({ type: m.role === 'user' ? 'user' : 'assistant', msg: m })}\n\n`); } catch { } }
        }
      } finally { await fh.close(); }
    }
  } catch { } finally {
    pumping.delete(id);
  }
}

// ---------- session runners and turns ----------
// Each session gets ONE long-lived CLI process (a "runner", 1.7). Messages are written to
// its stdin, a `result` line ends a turn, and the process then waits for the next
// message, keeping its working directory, MCP connections and background jobs. The CLI
// also starts turns by itself (e.g. when a background job finishes), so a turn can begin
// without a message. Runners close after IDLE_CLOSE_MS idle; the next message resumes
// the session from its transcript in a fresh process.
// Runners run DETACHED (own process group, stdout/stderr to files under turnlogs/) and
// PM2 runs this server with --no-treekill, so restarting pocket-claude — even from inside
// one of its own turns (the 2026-08-14 self-kill incident) — doesn't kill them. stdin is
// a named pipe that a tiny keeper process holds open, so a restarted server reattaches
// from the .runner.json marker. Closing a runner = kill the keeper and close our end;
// the CLI then reads EOF and exits 0.
const turns = new Map(); // sessionId -> active turn {pid, events[], subs:Set<res>, cwd, startedAt, runner}
const runners = new Map(); // sessionId -> live CLI process for that session
const TURNLOG_DIR = path.join(DATA_DIR, 'turnlogs');
fs.mkdirSync(TURNLOG_DIR, { recursive: true });
const turnFiles = id => ({
  out: path.join(TURNLOG_DIR, id + '.out.ndjson'),
  err: path.join(TURNLOG_DIR, id + '.err.log'),
  meta: path.join(TURNLOG_DIR, id + '.turn.json'), // pre-1.7 one-process-per-turn marker
  retry: path.join(TURNLOG_DIR, id + '.retry.json'),
});
// Per-runner files carry a key so a closing process never shares files with its successor.
const runnerFiles = (id, key) => ({
  out: path.join(TURNLOG_DIR, `${id}.${key}.out.ndjson`),
  err: path.join(TURNLOG_DIR, `${id}.${key}.err.log`),
  fifo: path.join(TURNLOG_DIR, `${id}.${key}.in.fifo`),
  meta: path.join(TURNLOG_DIR, `${id}.${key}.runner.json`),
});

// ---------- rate-limit auto-continue ----------
// A turn that dies on a usage/rate limit gets rescheduled for just after the reset
// instead of losing the whole overnight window. The pending retry survives server
// restarts via a .retry.json marker (armed again in adoptOrphans).
const RETRY_BUFFER_MS = Number(process.env.POCKET_RETRY_BUFFER_MS ?? 5 * 60_000);
const RETRY_MAX_ATTEMPTS = 6;
const RETRY_MAX_DELAY_MS = 12 * 3600_000;
const RETRY_PROMPT = 'You were interrupted by an API rate limit and were resumed automatically after the reset. '
  + 'Continue the task from where it left off. If the previous request already completed, just say so briefly.';
const retryTimers = new Map(); // sessionId -> timeout
const fmtET = ms => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET';

function detectRateLimit(text) {
  if (!/rate.?limit|usage limit|limit reached|overloaded|too many requests|\b429\b/i.test(text)) return null;
  let at = null;
  const epoch = text.match(/\|\s*(\d{10})\b/); // "Claude AI usage limit reached|<epoch>"
  if (epoch) at = Number(epoch[1]) * 1000;
  if (!at) {
    const t = text.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)?/i);
    if (t) { // CLI prints reset in its own (= this box's) local tz
      let h = Number(t[1]);
      if (t[3]) h = h % 12 + (t[3].toLowerCase() === 'pm' ? 12 : 0);
      const d = new Date(); d.setHours(h, Number(t[2] || 0), 0, 0);
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
      at = d.getTime();
    }
  }
  if (!at) {
    const ra = text.match(/retry.?after[:\s"]+(\d+)/i);
    if (ra) at = Date.now() + Number(ra[1]) * 1000;
  }
  if (!at || at < Date.now()) at = Date.now() + 3600_000; // unparseable → try in an hour
  return { resetAt: Math.min(at, Date.now() + RETRY_MAX_DELAY_MS) + RETRY_BUFFER_MS };
}

function cancelRetry(sessionId) {
  const t = retryTimers.get(sessionId);
  if (t) { clearTimeout(t); retryTimers.delete(sessionId); }
  try { fs.unlinkSync(turnFiles(sessionId).retry); } catch { }
}
function armRetry(m) {
  clearTimeout(retryTimers.get(m.sessionId));
  retryTimers.set(m.sessionId, setTimeout(() => fireRetry(m), Math.max(5_000, m.at - Date.now())));
}
function scheduleRetry(sessionId, turn, resetAt) {
  const m = {
    sessionId, cwd: turn.cwd, at: resetAt, createdAt: Date.now(), userText: turn.userText,
    model: turn.model, effort: turn.effort, approvalMode:turn.approvalMode, attempt: (turn.retryAttempt || 0) + 1,
  };
  try { fs.writeFileSync(turnFiles(sessionId).retry, JSON.stringify(m)); } catch { }
  armRetry(m);
  log(`rate limited session=${sessionId} — auto-resume at ${fmtET(resetAt)} (attempt ${m.attempt})`);
}
async function fireRetry(m) {
  retryTimers.delete(m.sessionId);
  try { fs.unlinkSync(turnFiles(m.sessionId).retry); } catch { }
  if (turns.has(m.sessionId)) return log(`retry skipped (turn already running) session=${m.sessionId}`);
  const file = await findSessionFile(m.sessionId);
  try { // the user (or code-server) may have moved the session along during the wait
    if (file && (await fsp.stat(file)).mtimeMs > m.createdAt + 15_000) {
      return log(`retry skipped (session continued elsewhere) session=${m.sessionId}`);
    }
  } catch { }
  const opts = { sessionId: m.sessionId, cwd: m.cwd, model: m.model, effort: m.effort, approvalMode:approvalMode(m.approvalMode,DEFAULT_APPROVAL_MODE,ALLOW_FULL_ACCESS), retryAttempt: m.attempt };
  try {
    if (file) startTurn({ ...opts, resume: true, text: RETRY_PROMPT });
    else startTurn({ ...opts, resume: false, text: m.userText }); // limit hit before the transcript existed
    log(`auto-resume after rate limit session=${m.sessionId} attempt=${m.attempt}`);
    const meta = file ? await sessionMeta(file, m.sessionId).catch(() => null) : null;
    pushNotify(m.sessionId, meta?.title || 'Claude session', 'Rate limit reset — picking the task back up');
  } catch (e) { log(`auto-resume failed session=${m.sessionId}: ${e.message}`); }
}

function broadcast(turn, ev) {
  turn.events.push(ev);
  const data = `id: ${turn.events.length - 1}\ndata: ${JSON.stringify(ev)}\n\n`;
  for (const res of turn.subs) { try { res.write(data); } catch { /* dropped */ } }
}

function spawnEnv() {
  const env = agentEnv(process.env);
  for (const k of Object.keys(env)) {
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete env[k];
  }
  return env;
}

const pidAlive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
// pid-reuse guard: only trust a marker whose pid's cmdline still names this session
const isTurnProc = (pid, id) => { try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(id); } catch { return false; } };
function signalTurn(turn, sig = 'SIGTERM') {
  try { process.kill(-turn.pid, sig); } // negative pid = whole (detached) process group
  catch { try { process.kill(turn.pid, sig); } catch { } }
}

function attachClaudeQuestions(turn,sessionId){
  const inputs=new Map();turn.questionInputs=inputs;
  turn.questions=new QuestionInbox({threadId:()=>sessionId,write:reply=>{
    if(!turn.stdin||turn.stdin.destroyed||turn.stdin.writableEnded)throw new Error('Question connection closed');
    const input=inputs.get(reply.id);if(!input)throw new Error('Question expired');
    const answers=Object.fromEntries(input.questions.map((q,i)=>[q.question,reply.result.answers['question-'+i].answers.join(', ')]));
    turn.stdin.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:reply.id,response:{behavior:'allow',updatedInput:{...input,answers}}}})+'\n');
    inputs.delete(reply.id);
  },onChange:()=>{
    const pending=turn.questions.list().length;
    try{const meta=JSON.parse(fs.readFileSync(turn.files.meta,'utf8'));meta.waitingForInput=Boolean(pending||turn.approvals?.list().length);fs.writeFileSync(turn.files.meta,JSON.stringify(meta),{mode:0o600});}catch{}
    broadcast(turn,{type:'questions'});
    const questionId=turn.questions.list().at(-1)?.id;
    if(pending&&turn.questionNotified!==questionId&&!mutes.has(sessionId)){turn.questionNotified=questionId;pushNotify(sessionId,'Claude needs your answer','Open Pocket Code to answer the agent’s question.').catch(()=>{});}
  }});
  turn.approvals=new ApprovalInbox({sessionId:()=>sessionId,turnId:()=>String(turn.startedAt),audit:auditApproval,write:(id,response)=>new Promise((resolve,reject)=>{
    if(!turn.stdin||turn.stdin.destroyed||turn.stdin.writableEnded)return reject(new Error('Approval connection closed'));
    turn.stdin.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:id,response}})+'\n',e=>e?reject(e):resolve());
  }),onChange:()=>{
    const requests=turn.approvals?.list()||[];
    try{const meta=JSON.parse(fs.readFileSync(turn.files.meta,'utf8'));meta.waitingForApproval=Boolean(requests.length);meta.waitingForInput=Boolean(requests.length||turn.questions.list().length);fs.writeFileSync(turn.files.meta,JSON.stringify(meta),{mode:0o600});}catch{}
    broadcast(turn,{type:'approvals'});
    const id=requests.at(-1)?.id;
    if(id&&turn.approvalNotified!==id&&!mutes.has(sessionId)){turn.approvalNotified=id;pushNotify(sessionId,'Action needs approval','Open Pocket Code to review the pending action.').catch(()=>{});}
  }});
}
function handleTurnLine(turn, line) {
  let o; try { o = JSON.parse(line); } catch { return; }
  const usageEvent = usage.observe(turn.sessionId, o);
  if (usageEvent) broadcast(turn, { type: 'usage', kind: usageEvent.kind });
  if(o.type==='control_request'){
    if(o.request?.subtype==='can_use_tool'&&o.request.tool_name==='AskUserQuestion'&&turn.questions){
      const input=o.request.input;const questions=Array.isArray(input?.questions)?input.questions.map((q,i)=>({id:'question-'+i,header:q.header,question:q.question,options:q.options,multiple:q.multiSelect})):[];
      turn.questionInputs.set(o.request_id,input);
      if(turn.questions.receive({id:o.request_id,method:'item/tool/requestUserInput',params:{threadId:turn.sessionId,turnId:String(turn.startedAt),isBlocking:true,questions}},String(turn.startedAt)))return;
      turn.questionInputs.delete(o.request_id);
    }
    if(o.request?.subtype==='can_use_tool'&&o.request.tool_name!=='AskUserQuestion'&&typeof o.request.tool_name==='string'&&o.request.input&&typeof o.request.input==='object'&&turn.approvals){
      const tool=o.request.tool_name;
      if(turn.approvals.receive({nativeId:o.request_id,turnId:String(turn.startedAt),kind:'tool',title:'Allow '+tool+'?',details:{tool,cwd:turn.cwd,input:o.request.input},allow:{behavior:'allow',updatedInput:o.request.input},deny:{behavior:'deny',message:'The user denied this action. Do not run it through another tool.'}}))return;
    }
    if(turn.stdin&&!turn.stdin.destroyed)turn.stdin.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:o.request_id,response:{behavior:'deny',message:'This interactive request is not supported in Pocket Code.'}}})+'\n');
    return;
  }
  if(o.type==='control_cancel_request'){turn.questions?.resolve(o.request_id);turn.approvals?.resolve(o.request_id);return;}
  if (o.type === 'stream_event') {
    const ev = o.event;
    if (!o.parent_tool_use_id && ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
      broadcast(turn, { type: 'delta', text: ev.delta.text });
    }
  } else if (o.type === 'assistant') {
    const m = normalizeLine(o);
    if (m) broadcast(turn, { type: 'assistant', msg: m });
  } else if (o.type === 'result') {
    broadcast(turn, {
      type: 'result', ok: o.subtype === 'success',
      error: o.subtype !== 'success' ? (o.result || o.subtype) : null,
      cost: o.total_cost_usd, duration_ms: o.duration_ms,
    });
    // The turn is over but the process stays up for the next message. Legacy pre-1.7
    // turns (no runner) still close stdin so their process exits as before.
    if (turn.runner) finalizeTurn(turn.sessionId, turn, 0);
    else try { turn.stdin?.end(); } catch { }
  }
}

function drainTurnLog(turn) {
  try {
    const size = fs.statSync(turn.files.out).size;
    if (size <= turn.tailOffset) return;
    const fh = fs.openSync(turn.files.out, 'r');
    try {
      const buf = Buffer.alloc(size - turn.tailOffset);
      fs.readSync(fh, buf, 0, buf.length, turn.tailOffset);
      turn.tailOffset = size;
      const lines = (turn.tailRem + buf.toString('utf8')).split('\n');
      turn.tailRem = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) handleTurnLine(turn, l);
    } finally { fs.closeSync(fh); }
  } catch { /* log file briefly absent — next tick */ }
}

// Pre-1.7 turns (one process per turn) still running when this version starts: stream
// them to the end, as before.
function trackTurn(sessionId, turn) {
  turns.set(sessionId, turn);
  turn.tailOffset = 0; turn.tailRem = '';
  turn.tailTimer = setInterval(() => drainTurnLog(turn), 300);
}

function writeRunnerMeta(r) {
  const t = r.turn;
  const meta = {
    sessionId: r.sessionId, pid: r.pid, keeperPid: r.keeperPid, key: r.key, cwd: r.cwd, startedAt: r.startedAt,
    model: r.model, effort: r.effort, approvalMode: r.approvalMode,
    turn: t ? { startedAt: t.startedAt, userText: t.userText, offset: t.offset, autonomous: Boolean(t.autonomous) } : null,
    waitingForInput: Boolean(t && (t.questions?.list().length || t.approvals?.list().length)),
    waitingForApproval: Boolean(t?.approvals?.list().length),
  };
  try { fs.writeFileSync(r.files.meta, JSON.stringify(meta), { mode: 0o600 }); } catch { }
}

function spawnRunner({ sessionId, cwd, resume, model, effort, mode }) {
  const policy = claudePermissionSettings(mode);
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', policy.permissionMode, '--permission-prompt-tool', 'stdio'];
  if (model && MODELS.has(model)) args.push('--model', model);
  args.push('--settings', JSON.stringify({ permissions: policy.permissions, ...(effort && EFFORTS.has(effort) ? { effortLevel: effort } : {}) }));
  args.push(resume ? '--resume' : '--session-id', sessionId);
  const key = Date.now().toString(36);
  const files = runnerFiles(sessionId, key);
  for (const file of [files.out, files.err]) { fs.writeFileSync(file, '', { mode: 0o600 }); fs.chmodSync(file, 0o600); }
  execFileSync('mkfifo', ['-m', '600', files.fifo]);
  // O_RDWR never blocks on a FIFO, and while it is open the read end opens without blocking too.
  const hold = fs.openSync(files.fifo, fs.constants.O_RDWR);
  const inFd = fs.openSync(files.fifo, 'r');
  const outFd = fs.openSync(files.out, 'a'), errFd = fs.openSync(files.err, 'a');
  const proc = spawn(CLAUDE_BIN, args, { cwd, env: spawnEnv(), detached: true, stdio: [inFd, outFd, errFd] });
  fs.closeSync(inFd); fs.closeSync(outFd); fs.closeSync(errFd);
  proc.unref();
  // The keeper holds a write end across server restarts and exits when the CLI does.
  const keeper = spawn('sh', ['-c', 'while kill -0 "$1" 2>/dev/null; do sleep 5; done', 'pocket-keeper', String(proc.pid)], { detached: true, stdio: ['ignore', hold, 'ignore'] });
  keeper.unref();
  const writer = fs.createWriteStream(null, { fd: hold });
  writer.on('error', () => { });
  const r = {
    sessionId, key, pid: proc.pid, keeperPid: keeper.pid, writer, cwd, model, effort, approvalMode: mode, files,
    startedAt: Date.now(), turn: null, bgTasks: [], lastLineAt: Date.now(), tailOffset: 0, tailRem: '',
  };
  runners.set(sessionId, r);
  r.tailTimer = setInterval(() => drainRunnerLog(r), 300);
  proc.on('exit', code => onRunnerExit(r, code));
  proc.on('error', () => onRunnerExit(r, -1));
  writeRunnerMeta(r);
  log(`session process start session=${sessionId} resume=${!!resume} pid=${proc.pid} cwd=${cwd}`);
  return r;
}

function beginTurn(r, { userText = '', retryAttempt, autonomous = false, offset }) {
  let size = r.tailOffset; try { size = fs.statSync(r.files.out).size; } catch { }
  const turn = {
    sessionId: r.sessionId, runner: r, pid: r.pid, stdin: r.writer, events: [], subs: new Set(), cwd: r.cwd,
    startedAt: Date.now(), userText, model: r.model, effort: r.effort, retryAttempt, approvalMode: r.approvalMode,
    queue: [], files: r.files, offset: offset ?? size, autonomous, baseline: descendantCpu(r.pid).pids,
  };
  attachClaudeQuestions(turn, r.sessionId);
  clearTimeout(r.idleTimer);
  r.turn = turn;
  turns.set(r.sessionId, turn);
  r.lastLineAt = Date.now();
  writeRunnerMeta(r);
  return turn;
}

function handleRunnerLine(r, line, lineOffset) {
  r.lastLineAt = Date.now();
  let o; try { o = JSON.parse(line); } catch { return; }
  if (o.type === 'system' && o.subtype === 'background_tasks_changed') {
    r.bgTasks = Array.isArray(o.tasks) ? o.tasks : [];
    if (!r.turn) scheduleIdle(r);
  }
  if (r.skipControlBefore && lineOffset < r.skipControlBefore && (o.type === 'control_request' || o.type === 'control_cancel_request')) return;
  let turn = r.turn;
  if (!turn) {
    // The CLI started a turn by itself, e.g. to report a finished background job.
    const wakes = o.type === 'assistant' || o.type === 'stream_event' || (o.type === 'system' && o.subtype === 'init');
    if (!wakes || r.exited) return;
    turn = beginTurn(r, { autonomous: true, offset: lineOffset });
    log(`turn start (started by the agent) session=${r.sessionId} pid=${r.pid}`);
    // Viewers in transcript-mirror mode resync on `done` and attach to this live turn.
    for (const t of tailers.get(r.sessionId) || []) { try { t.res.write('data: {"type":"done"}\n\n'); t.res.end(); } catch { } }
  }
  handleTurnLine(turn, line);
}

function drainRunnerLog(r) {
  try {
    const size = fs.statSync(r.files.out).size;
    if (size <= r.tailOffset) return;
    const fh = fs.openSync(r.files.out, 'r');
    try {
      const buf = Buffer.alloc(size - r.tailOffset);
      fs.readSync(fh, buf, 0, buf.length, r.tailOffset);
      const text = r.tailRem + buf.toString('utf8');
      let at = r.tailOffset - Buffer.byteLength(r.tailRem);
      r.tailOffset = size;
      const lines = text.split('\n');
      r.tailRem = lines.pop() ?? '';
      for (const l of lines) {
        const lineOffset = at; at += Buffer.byteLength(l) + 1;
        if (l.trim()) handleRunnerLine(r, l, lineOffset);
      }
    } finally { fs.closeSync(fh); }
  } catch { /* log file briefly absent — next tick */ }
}

function scheduleIdle(r) {
  clearTimeout(r.idleTimer);
  if (r.turn || r.closing || r.exited || !(IDLE_CLOSE_MS > 0)) return;
  if (r.bgTasks.length) return; // re-armed when the CLI reports its background jobs are done
  r.idleTimer = setTimeout(() => { if (!r.turn && !r.bgTasks.length) closeRunner(r, 'idle'); }, IDLE_CLOSE_MS);
}

function closeRunner(r, why) {
  if (r.closing || r.exited) return;
  r.closing = true;
  clearTimeout(r.idleTimer);
  log(`session process closing session=${r.sessionId} pid=${r.pid} reason=${why}`);
  try { process.kill(-r.keeperPid, 'SIGTERM'); } catch { try { process.kill(r.keeperPid, 'SIGTERM'); } catch { } }
  try { r.writer?.end(); } catch { } // last write end closed → the CLI reads EOF and exits 0
  r.forceTimer = setTimeout(() => { if (!r.exited) signalTurn(r); }, 30_000);
}

function onRunnerExit(r, code) {
  if (r.exited) return;
  r.exited = true;
  clearInterval(r.tailTimer); clearInterval(r.pollTimer); clearTimeout(r.idleTimer); clearTimeout(r.forceTimer);
  drainRunnerLog(r);
  if (runners.get(r.sessionId) === r) runners.delete(r.sessionId);
  try { r.writer?.destroy(); } catch { }
  try { process.kill(-r.keeperPid, 'SIGTERM'); } catch { }
  for (const f of [r.files.fifo, r.files.meta]) { try { fs.unlinkSync(f); } catch { } }
  log(`session process exit session=${r.sessionId} pid=${r.pid} code=${code}`);
  if (r.turn) finalizeTurn(r.sessionId, r.turn, code);
}

// CPU used by programs a turn started (MCP servers already running at turn start are
// excluded), as a last sign of life for a turn that has gone quiet.
function descendantCpu(rootPid) {
  const kids = new Map(), cpu = new Map();
  let entries = []; try { entries = fs.readdirSync('/proc'); } catch { }
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    try {
      const s = fs.readFileSync(`/proc/${e}/stat`, 'utf8');
      const f = s.slice(s.lastIndexOf(')') + 2).split(' ');
      const ppid = Number(f[1]);
      if (!kids.has(ppid)) kids.set(ppid, []);
      kids.get(ppid).push(Number(e));
      cpu.set(Number(e), Number(f[11]) + Number(f[12]));
    } catch { }
  }
  const pids = new Set(), stack = [...(kids.get(rootPid) || [])];
  while (stack.length) { const p = stack.pop(); if (pids.has(p)) continue; pids.add(p); stack.push(...(kids.get(p) || [])); }
  return { pids, cpu };
}

function stallCheck() {
  for (const r of runners.values()) {
    const t = r.turn;
    if (!t || r.exited || t.stopped || t.stalled) continue;
    const { pids, cpu } = descendantCpu(r.pid);
    let ticks = 0;
    for (const p of pids) if (!t.baseline.has(p)) ticks += cpu.get(p) || 0;
    if (t.cpuTicks === undefined || ticks > t.cpuTicks + 100) t.cpuBusyAt = Date.now(); // >1s of CPU since last check
    t.cpuTicks = ticks;
    const quietFor = Date.now() - Math.max(r.lastLineAt, t.cpuBusyAt || 0);
    if (quietFor < STALL_MS || r.bgTasks.length) continue;
    if (t.questions?.list().length || t.approvals?.list().length) continue;
    t.stalled = true;
    log(`turn STALLED session=${r.sessionId} quiet=${Math.round(quietFor / 60_000)}min — stopping`);
    signalTurn(r);
  }
}
setInterval(stallCheck, Math.min(60_000, Math.max(250, STALL_MS / 4))).unref();

// Turns another app (code-server, a terminal) added to the transcript after `from`.
// Title and summary records don't count — only user/assistant messages.
function foreignTurns(sessionId, from) {
  const file = sessionFileSync(sessionId);
  if (!file) return { since: false, recentAt: 0 };
  let size; try { size = fs.statSync(file).size; } catch { return { since: false, recentAt: 0 }; }
  const start = from === undefined ? Math.max(0, size - 65536) : Math.min(from, size);
  let since = from !== undefined && size < from, recentAt = 0;
  if (size > start) {
    const fh = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(Math.min(size - start, 4 << 20));
      fs.readSync(fh, buf, 0, buf.length, size - buf.length);
      for (const l of buf.toString('utf8').split('\n')) {
        let o; try { o = JSON.parse(l); } catch { continue; }
        if (o.type !== 'user' && o.type !== 'assistant') continue;
        if (from !== undefined) since = true;
        const at = Date.parse(o.timestamp || '') || 0;
        if (at > recentAt) recentAt = at;
      }
    } finally { fs.closeSync(fh); }
  }
  return { since, recentAt };
}

// The CLI stamps headless (-p) turns entrypoint:"sdk-cli", and the vscode extension
// (>=2.1.239) hides sdk-* sessions from its session picker — but ours are the user's real
// sessions, not automation, so restamp them "cli". The patch is byte-length-preserving
// ("sdk-cli" -> "cli" + 4 trailing spaces, still valid JSON) and written in place at
// the found offsets, so a concurrently-appending CLI or a tail reader with a saved
// offset is never disturbed.
const SDK_STAMP = Buffer.from('"entrypoint":"sdk-cli"');
const CLI_STAMP = Buffer.from('"entrypoint":"cli"    ');
async function restampEntrypoint(sessionId) {
  try {
    const file = await findSessionFile(sessionId);
    if (file) await restampFile(file);
  } catch (e) { log(`entrypoint restamp failed session=${sessionId}: ${e.message}`); }
}
async function restampFile(file) {
  const buf = await fsp.readFile(file);
  const offs = [];
  for (let i = buf.indexOf(SDK_STAMP); i >= 0; i = buf.indexOf(SDK_STAMP, i + 1)) offs.push(i);
  if (!offs.length) return false;
  const fh = await fsp.open(file, 'r+');
  try { for (const at of offs) await fh.write(CLI_STAMP, 0, CLI_STAMP.length, at); }
  finally { await fh.close(); }
  return true;
}

async function finalizeTurn(sessionId, turn, code) {
  if (turn.finalized) return;
  turn.finalized = true;
  const r = turn.runner;
  if (r && r.turn === turn) r.turn = null; // later lines from the process belong to the next turn
  turn.questions?.clear();
  turn.approvals?.clear();
  await restampEntrypoint(sessionId);
  try{const file=await findSessionFile(sessionId);if(file){const st=await fsp.stat(file);ownedTranscriptMtime.set(sessionId,st.mtimeMs);rememberOwnedSize(sessionId,st.size);}}catch{}
  extActivity.delete(sessionId);
  clearInterval(turn.tailTimer); clearInterval(turn.pollTimer);
  if (!r) drainTurnLog(turn);
  let stderrTail = '';
  try { stderrTail = fs.readFileSync(turn.files.err, 'utf8').slice(-500); } catch { }
  if (turn.stalled && !turn.events.some(e => e.type === 'result')) {
    broadcast(turn, { type: 'result', ok: false, error: `Stopped: no activity for ${Math.round(STALL_MS / 60_000)} minutes` });
    log(`turn STALL-STOPPED session=${sessionId}`);
  } else if (turn.stopped && !turn.events.some(e => e.type === 'result')) {
    broadcast(turn, { type: 'result', ok: false, error: 'Stopped by you' });
    log(`turn STOPPED session=${sessionId}`);
  } else if (code !== 0 && !turn.events.some(e => e.type === 'result')) {
    broadcast(turn, { type: 'result', ok: false, error: `claude exited ${code}: ${stderrTail}` });
    log(`turn FAIL session=${sessionId} code=${code} stderr=${stderrTail.slice(-300)}`);
  } else {
    log(`turn done session=${sessionId} code=${code} events=${turn.events.length}`);
  }
  // rate-limit auto-continue: schedule a resume for just after the reset
  let retryAt = null;
  if (!turn.stopped && !followups.list(sessionId).length && (turn.retryAttempt || 0) < RETRY_MAX_ATTEMPTS) {
    const failed = turn.events.find(e => e.type === 'result' && !e.ok);
    if (failed) {
      const rl = detectRateLimit(`${failed.error || ''} ${stderrTail}`);
      if (rl) { retryAt = rl.resetAt; broadcast(turn, { type: 'retry', at: retryAt }); }
    }
  }
  recordOutcome(sessionId, turn, [...turn.events].reverse().find(e => e.type === 'result'), retryAt);
  const watching = turn.subs.size > 0;
  broadcast(turn, { type: 'done' });
  for (const res of turn.subs) { try { res.end(); } catch { } }
  if (turns.get(sessionId) === turn) turns.delete(sessionId);
  if (!r) { try { fs.unlinkSync(turn.files.meta); } catch { } }
  else if (!r.exited) { writeRunnerMeta(r); scheduleIdle(r); }
  if (retryAt) scheduleRetry(sessionId, turn, retryAt); // after turns.delete — cancelRetry in startTurn
  // Drain one saved follow-up at a time; each entry gets its own turn.
  if (!turn.stopped && [...turn.events].reverse().find(e=>e.type==='result')?.ok && followups.list(sessionId)[0]?.status === 'pending') {
    runNextFollowup(sessionId, turn.cwd).catch(e => log(`queue start failed session=${sessionId}: ${e.message}`));
    return;
  }
  if (!watching && !turn.stopped) {
    const result = turn.events.find(e => e.type === 'result');
    const body = retryAt ? `Rate limited — auto-resume at ${fmtET(retryAt)}`
      : !result ? 'Turn ended'
        : !result.ok ? 'Turn failed — tap to see why'
          : `Done${result.cost != null ? ` · $${result.cost.toFixed(2)}` : ''}${result.duration_ms ? ` · ${Math.round(result.duration_ms / 1000)}s` : ''}`;
    findSessionFile(sessionId)
      .then(f => f ? sessionMeta(f, sessionId) : null)
      .then(m => pushNotify(sessionId, m?.title || 'Claude session', body))
      .catch(() => { });
  }
}

function promptText(text, attachments) {
  let prompt = text;
  if (attachments?.length) {
    prompt += '\n\n[Attached file' + (attachments.length > 1 ? 's' : '') + ' — read as needed:\n'
      + attachments.join('\n') + '\n]';
  }
  return prompt;
}
const userJSON = text => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n';
// mid-turn steering: while stdin is open, another user message can be written into the
// running turn — the CLI delivers it at the next model boundary (verified 2026-08-16).
// stdin closes when a result arrives; the CLI drains anything already written, then exits.
function steerTurn(turn, text) {
  if (!turn.stdin || turn.stdin.destroyed || turn.stdin.writableEnded) return false;
  try { turn.stdin.write(userJSON(text)); } catch { return false; }
  return true;
}

function startTurn({ sessionId, cwd, text, resume, model, effort, attachments, retryAttempt,approvalMode:requestedMode }) {
  if (turns.has(sessionId)) throw Object.assign(new Error('busy'), { code: 409 });
  cancelRetry(sessionId); // a manually-started turn supersedes any pending auto-resume
  ({ model, effort } = withDefaults('claude', { model, effort }));
  const mode=approvalMode(requestedMode,DEFAULT_APPROVAL_MODE,ALLOW_FULL_ACCESS);
  let r = runners.get(sessionId);
  if (r) {
    // A process can only carry on if nothing it was started with has changed, and if no
    // other app added turns since ours (its in-memory history would fork the transcript).
    const why = r.closing || r.exited ? 'closing'
      : r.cwd !== cwd ? 'workspace changed' : r.model !== model ? 'model changed'
        : r.effort !== effort ? 'effort changed' : r.approvalMode !== mode ? 'permissions changed'
          : foreignTurns(sessionId, ownedTranscriptSize.get(sessionId)).since ? 'continued in another app' : null;
    if (why) { if (why !== 'closing') closeRunner(r, why); r = null; }
  }
  const reused = Boolean(r);
  if (!r) r = spawnRunner({ sessionId, cwd, resume, model, effort, mode });
  const turn = beginTurn(r, { userText: text, retryAttempt });
  try { r.writer.write(userJSON(promptText(text, attachments))); } catch { }
  log(`turn start session=${sessionId} process=${reused ? 'reused' : 'new'} pid=${r.pid} cwd=${cwd}`);
  return turn;
}

// Another app (code-server, a terminal) wrote a turn to this session moments ago and may
// still be working: refuse rather than run two agents on one transcript.
const FOREIGN_BUSY_MS = 45_000;
function busyElsewhere(sessionId) {
  if (turns.has(sessionId)) return false;
  const { recentAt } = foreignTurns(sessionId, ownedTranscriptSize.get(sessionId));
  return Date.now() - recentAt < FOREIGN_BUSY_MS;
}

// Reattach session processes (and pre-1.7 turns) that survived a server restart; sweep
// stale logs.
function adoptOrphans() {
  let entries = []; try { entries = fs.readdirSync(TURNLOG_DIR); } catch { return; }
  for (const f of entries) {
    const full = path.join(TURNLOG_DIR, f);
    if (f.endsWith('.runner.json')) {
      let m; try { m = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { try { fs.unlinkSync(full); } catch { } continue; }
      const files = runnerFiles(m.sessionId, m.key);
      if (m.sessionId && m.pid && m.key && pidAlive(m.pid) && isTurnProc(m.pid, m.sessionId)) {
        let writer = null;
        try { writer = fs.createWriteStream(null, { fd: fs.openSync(files.fifo, fs.constants.O_RDWR) }); writer.on('error', () => { }); } catch { }
        let size = 0; try { size = fs.statSync(files.out).size; } catch { }
        const r = {
          sessionId: m.sessionId, key: m.key, pid: m.pid, keeperPid: m.keeperPid, writer, cwd: m.cwd, model: m.model, effort: m.effort,
          approvalMode: m.approvalMode || 'full', files, startedAt: m.startedAt || Date.now(), turn: null, bgTasks: [],
          lastLineAt: Date.now(), tailOffset: m.turn ? Math.min(m.turn.offset || 0, size) : size, tailRem: '', adopted: true,
          skipControlBefore: size, // requests answered (or lost) before the restart can't be answered now
        };
        runners.set(m.sessionId, r);
        if (m.turn) {
          const turn = beginTurn(r, { userText: m.turn.userText, autonomous: m.turn.autonomous, offset: r.tailOffset });
          turn.startedAt = m.turn.startedAt || turn.startedAt;
          Object.assign(turn, { adopted: true, inputUnavailable: Boolean(m.waitingForInput) && !m.waitingForApproval, approvalUnavailable: Boolean(m.waitingForApproval) });
        }
        if (!writer) { // can't send to it any more: drop the keeper so the CLI reads EOF after this turn
          log(`adopted session process without input pipe session=${m.sessionId} — it closes after this turn`);
          r.closing = true;
          try { process.kill(-m.keeperPid, 'SIGTERM'); } catch { }
          r.forceTimer = setTimeout(() => { if (!r.exited && !r.turn) signalTurn(r); }, 30_000);
        }
        r.tailTimer = setInterval(() => drainRunnerLog(r), 300);
        r.pollTimer = setInterval(() => { if (!pidAlive(r.pid)) onRunnerExit(r, null); }, 1000);
        if (!r.turn) scheduleIdle(r);
        log(`adopted session process session=${m.sessionId} pid=${m.pid} turn=${Boolean(m.turn)}`);
      } else {
        try { process.kill(-m.keeperPid, 'SIGTERM'); } catch { }
        for (const x of [full, files.fifo]) { try { fs.unlinkSync(x); } catch { } }
        if (m.sessionId) log(`session process ended while server was down session=${m.sessionId}`);
      }
    } else if (f.endsWith('.turn.json')) {
      let m; try { m = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { try { fs.unlinkSync(full); } catch { } continue; }
      if (m.sessionId && m.pid && pidAlive(m.pid) && isTurnProc(m.pid, m.sessionId)) {
        const turn = {
          sessionId:m.sessionId,inputUnavailable:Boolean(m.waitingForInput)&&!m.waitingForApproval,approvalUnavailable:Boolean(m.waitingForApproval)||m.approvalMode==='review',approvalMode:m.approvalMode||'full',pid: m.pid, adopted: true, events: [], subs: new Set(), cwd: m.cwd,
          startedAt: m.startedAt || Date.now(), userText: m.userText, queue: [], files: turnFiles(m.sessionId),
        };
        trackTurn(m.sessionId, turn);
        turn.pollTimer = setInterval(() => { if (!pidAlive(turn.pid)) finalizeTurn(m.sessionId, turn, null); }, 1000);
        log(`adopted in-flight turn session=${m.sessionId} pid=${m.pid}`);
      } else {
        try { fs.unlinkSync(full); } catch { }
        if (m.sessionId) log(`orphan turn finished while server was down session=${m.sessionId}`);
      }
    } else if (f.endsWith('.retry.json')) { // pending rate-limit resume survives restarts
      let m; try { m = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { try { fs.unlinkSync(full); } catch { } continue; }
      if (m.sessionId && m.at) { armRetry(m); log(`re-armed auto-resume session=${m.sessionId} at ${fmtET(m.at)}`); }
      else { try { fs.unlinkSync(full); } catch { } }
    }
  }
  // Sweep logs and pipes no live process is using.
  const live = new Set([...runners.values()].map(r => `${r.sessionId}.${r.key}.`));
  for (const f of fs.readdirSync(TURNLOG_DIR)) {
    const full = path.join(TURNLOG_DIR, f);
    if ([...live].some(p => f.startsWith(p))) continue;
    if (f.endsWith('.in.fifo')) { try { fs.unlinkSync(full); } catch { } continue; }
    if (/\.(out\.ndjson|err\.log)$/.test(f)) {
      try { if (Date.now() - fs.statSync(full).mtimeMs > 48 * 3600_000) fs.unlinkSync(full); } catch { }
    }
  }
}
adoptOrphans();

// ---------- app ----------
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(import.meta.dirname, 'public'), { index: 'index.html', maxAge: '5m',
  setHeaders(res, file) { if (['index.html', 'sw.js'].includes(path.basename(file))) res.setHeader('Cache-Control', 'no-cache'); },
}));

app.post('/api/login', (req, res) => {
  const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '?';
  if (rateLimited(ip)) return res.status(429).json({ error: 'too many attempts' });
  const given = String(req.body?.password || '');
  const want = Buffer.from(PASSWORD), got = Buffer.from(given.padEnd(PASSWORD.length).slice(0, PASSWORD.length));
  if (given.length === PASSWORD.length && timingSafeEqual(want, got)) {
    res.setHeader('Set-Cookie', `pc_auth=${makeCookie()}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${90 * 24 * 3600}`);
    return res.json({ ok: true });
  }
  log(`login FAIL from ${ip}`);
  res.status(403).json({ error: 'wrong password' });
});

app.get('/api/me', requireAuth, (_req, res) => res.json({ ok: true }));

// One list, both providers. Codex threads carry their own recency and titles, so the
// merge is just a sort — pins still float, and a Codex failure never costs the Claude
// list (the phone should degrade to half the sessions, not to an error screen).
function stateFor(s) {
  const cx = codex.isCodexId(s.id);
  const turn = cx ? codex.codexTurns.get(codex.bareId(s.id)) : turns.get(s.id);
  let retryAt = null;
  if (!cx && retryTimers.has(s.id)) {
    try { retryAt = JSON.parse(fs.readFileSync(turnFiles(s.id).retry, 'utf8')).at; } catch { }
  }
  const queue=followups.list(s.id);
  if(turn?.approvalUnavailable)return {kind:'input',label:'Approval connection interrupted',confirmed:true,approvals:1,queued:queue.length};
  const approvals=turn?.approvals?.list()||[];
  if(approvals.length)return {kind:'input',label:approvals.some(a=>a.status==='uncertain')?'Approval delivery uncertain':'Needs approval',confirmed:true,approvals:approvals.length,questions:turn.questions?.list().length||0,startedAt:turn.startedAt,queued:queue.length};
  if(turn?.inputUnavailable)return {kind:'input',label:'Question interrupted · review needed',confirmed:true,questions:1,queued:queue.length};
  const questions=turn?.questions?.list()||[];
  if(questions.length)return {kind:'input',label:questions.some(q=>q.blocking)?'Needs your answer':'Working · answer requested',confirmed:true,startedAt:turn.startedAt,queued:queue.length,questions:questions.length};
  const state=sessionState({ turn: turn ? {...turn,queue} : null, external: cx ? codex.codexExtActive(codex.bareId(s.id)) : extActive(s.id),
    retryAt, outcome: smeta[s.id]?.outcome, mtimeMs:s.mtimeMs });
  if(queue.length&&!turn && state.kind!=='failed')return {kind:'waiting',label:queue[0].status==='uncertain'?'Queue needs review':'Queue paused',queued:queue.length,confirmed:true};
  return {...state,...(queue.length?{queued:queue.length}:{})};
}
function recordOutcome(id, turn, result, retryAt = null) {
  const kind = retryAt ? 'waiting' : turn.stopped ? 'stopped' : result?.ok ? 'finished' : result ? 'failed' : 'ended';
  const labels = { waiting: 'Waiting for usage reset', stopped: 'Stopped', finished: 'Response ready', failed: 'Turn failed', ended: 'Turn ended' };
  try { setSmeta(id, { outcome: { kind, label: labels[kind], at: Date.now(), ...(retryAt ? { retryAt } : {}) } }); }
  catch (e) { log(`outcome not saved session=${id}: ${e.message}`); }
}
async function listAllSessions(limit) {
  let rows = (await listSessions(limit)).map(s => ({ ...s, provider: 'claude' }));
  const warnings = [];
  if (CODEX_ON) {
    try {
      rows.push(...(await codex.listCodexSessions(limit)).map(s => ({ ...s,
        title: smeta[s.id]?.name || s.title, pinned: isPinned(s.id) || undefined,
        active: codex.codexTurnActive(codex.bareId(s.id)) || codex.codexExtActive(codex.bareId(s.id)),
      })));
    } catch (e) { log(`codex list failed: ${e.message}`); warnings.push('Codex sessions are temporarily unavailable.'); }
  }
  // Owned runs must stay visible even before the CLI writes a transcript, or
  // after their last transcript update falls outside the recent-history window.
  const known = new Set(rows.map(s => s.id));
  const owned = [...turns.entries(), ...[...codex.codexTurns].map(([id, t]) => [codex.CX + id, t])];
  for (const [id, t] of owned) if (!known.has(id)) rows.push({ id, title: smeta[id]?.name || t.userText?.slice(0,120) || 'New session',
    cwd: t.cwd, provider: codex.isCodexId(id) ? 'codex' : 'claude', active: true, mtimeMs: t.startedAt, pinned: isPinned(id) });
  for(const id of new Set(followups.rows.map(r=>r.sessionId))){
    if(rows.some(s=>s.id===id))continue;
    const file=!isCx(id)?await findSessionFile(id):null;
    const meta=isCx(id)?await codex.codexThreadMeta(codex.bareId(id)).catch(()=>null):file?await sessionMeta(file,id):null;
    rows.push({...meta,id,provider:isCx(id)?'codex':'claude',title:smeta[id]?.name||meta?.title||'Queued session',mtimeMs:meta?.mtimeMs||followups.list(id)[0].createdAt});
  }
  rows = rows.map(s => ({ ...s, state: stateFor(s) })).sort((a,b) => b.mtimeMs-a.mtimeMs);
  const result = prioritizeSessions(rows, limit);
  result.warnings = warnings;
  return result;
}

app.get('/api/sessions', requireAuth, async (req, res) => {
  try {
    const sessions = await listAllSessions(Math.min(Number(req.query.limit) || 60, 200));
    res.json({ sessions, warnings: sessions.warnings, checkedAt: Date.now() });
  } catch { res.status(503).json({ error: 'Session status is unavailable. Please retry.' }); }
});

app.get('/api/projects', requireAuth, async (_req, res) => {
  const seen = new Map(); // cwd -> latest mtime
  for (const s of await listAllSessions(200)) {
    if (!s.cwd || s.cwd.startsWith('/tmp/') || s.cwd.includes('/.claude/')) continue;
    if (!seen.has(s.cwd) || seen.get(s.cwd) < s.mtimeMs) seen.set(s.cwd, s.mtimeMs);
  }
  const projects = [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([cwd]) => cwd);
  if (!projects.includes(HOME)) projects.push(HOME);
  if (DEFAULT_CWD) projects.splice(0, projects.length, DEFAULT_CWD, ...projects.filter(p => p !== DEFAULT_CWD));
  res.json({ projects, defaultCwd: DEFAULT_CWD || null });
});

app.get('/api/session/:id', requireAuth, async (req, res) => {
  if (isCx(req.params.id)) {
    const tid = codex.bareId(req.params.id);
    const meta = await codex.codexThreadMeta(tid).catch(() => null);
    const turn = codex.codexTurns.get(tid);
    if (!meta && !turn) return res.status(404).json({ error: 'not found' });
    let messages = [], total = 0;
    try { ({ msgs: messages, total } = await codex.readCodexThread(tid)); }
    catch (e) { // a brand-new thread has no history page yet — show the prompt we sent
      if (turn?.userText) { messages = [{ role: 'user', text: turn.userText }]; total = 1; }
      else return res.status(502).json({ error: String(e.message) });
    }
    return res.json({
      id: req.params.id, provider: 'codex',
      title: smeta[req.params.id]?.name || meta?.title || turn?.userText?.slice(0, 120) || 'New session',
      cwd: meta?.cwd || turn?.cwd || null, model: meta?.model, source: meta?.source,
      state: stateFor({ id: req.params.id, mtimeMs: meta?.mtimeMs || 0 }),
      executionMode:turn?.executionMode,active: Boolean(turn), ext: codex.codexExtActive(tid),
      locked: !turn && codex.threadLocked(tid),
      muted: mutes.has(req.params.id), pinned: isPinned(req.params.id),
      messages, total,
    });
  }
  const file = await findSessionFile(req.params.id);
  if (!file) {
    const turn = turns.get(req.params.id);
    if (turn) { // brand-new session: transcript file not written yet
      return res.json({
        id: req.params.id, title: turn.userText?.slice(0, 120) || 'New session', cwd: turn.cwd,
        state: stateFor({ id: req.params.id }), active: true, messages: turn.userText ? [{ role: 'user', text: turn.userText }] : [],
      });
    }
    return res.status(404).json({ error: 'not found' });
  }
  const meta = await sessionMeta(file, req.params.id);
  const { msgs: messages, total } = await readTranscript(file);
  res.json({ ...meta, state: stateFor({ ...meta, id: req.params.id }), active: turns.has(req.params.id), ext: extActive(req.params.id), muted: mutes.has(req.params.id), pinned: isPinned(req.params.id), messages, total });
});

// Extract references from assistant messages on demand; no second document store.
const resultCache = new Map();
async function sessionResults(id) {
  const cached = resultCache.get(id);
  if (cached && Date.now() - cached.at < 5000) return cached.value;
  let transcript;
  if (isCx(id)) transcript = await codex.readCodexThread(codex.bareId(id), 4000);
  else {
    const file = await findSessionFile(id);
    if (!file) throw Object.assign(new Error('Session not found'), {status:404});
    transcript = await readTranscript(file, 4000);
  }
  const refs = collectResults(transcript.msgs);
  const value = { ...refs, truncated: transcript.total > transcript.msgs.length,
    scannedMessages: transcript.msgs.length };
  resultCache.set(id, {at:Date.now(),value});
  if(resultCache.size > 40) resultCache.delete(resultCache.keys().next().value);
  return value;
}
async function workspaceCwd(id) {
  if(!anyId(id))throw Object.assign(new Error('Invalid session'),{status:400});
  if(isCx(id))return codex.codexTurns.get(codex.bareId(id))?.cwd || (await codex.codexThreadMeta(codex.bareId(id)))?.cwd;
  const file=await findSessionFile(id);
  return turns.get(id)?.cwd || (file ? (await sessionMeta(file,id))?.cwd : null);
}
app.get('/api/approval-policy',requireAuth,(_req,res)=>res.json({defaultMode:DEFAULT_APPROVAL_MODE,allowFullAccess:ALLOW_FULL_ACCESS}));
app.get('/api/session/:id/approvals',requireAuth,(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!anyId(req.params.id))return res.status(400).json({error:'Invalid session'});
  const turn=ownedTurn(req.params.id);
  res.json({requests:turn?.approvals?.list()||[],interrupted:Boolean(turn?.approvalUnavailable),activeMode:turn?.approvalMode||null,defaultMode:DEFAULT_APPROVAL_MODE,allowFullAccess:ALLOW_FULL_ACCESS});
});
app.post('/api/session/:id/approvals/:request/decision',requireAuth,async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!anyId(req.params.id))return res.status(400).json({error:'Invalid session'});
  const turn=ownedTurn(req.params.id);
  if(!turn?.approvals||turn.done||turn.finalized||turn.stopped)return res.status(409).json({error:'This action is no longer waiting. Refresh the conversation.'});
  try{res.json(await turn.approvals.decide(req.params.request,req.body.decision));}
  catch(e){res.status(e.status||503).json({error:e.status?e.message:'The approval connection is unavailable. Stop this turn before trying again.'});}
});

app.get('/api/session/:id/questions',requireAuth,(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  if(!anyId(req.params.id))return res.status(400).json({error:'Invalid session'});
  const turn=isCx(req.params.id)?codex.codexTurns.get(codex.bareId(req.params.id)):turns.get(req.params.id);
  res.json({supported:true,interrupted:Boolean(turn?.inputUnavailable),requests:turn?.questions?.list()||[]});
});
app.post('/api/session/:id/questions/:request/answer',requireAuth,(req,res)=>{
  const turn=isCx(req.params.id)?codex.codexTurns.get(codex.bareId(req.params.id)):turns.get(req.params.id);
  if(!turn?.questions||turn.done)return res.status(409).json({error:'This question is no longer active. Refresh the session.'});
  try{res.json(turn.questions.answer(req.params.request,req.body.answers));}
  catch(e){res.status(e.status||503).json({error:e.status?e.message:'Answer could not be confirmed. Refresh before trying again.'});}
});
app.get('/api/session/:id/workspace',requireAuth,async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  try {res.json(await workspaceStatus(await workspaceCwd(req.params.id),HOME));}
  catch(e){res.status(e.status||503).json({error:e.status?e.message:'Workspace could not be inspected. Try again.'});}
});
app.get('/api/session/:id/workspace/diff',requireAuth,async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  try {res.json(await workspaceDiff(await workspaceCwd(req.params.id),HOME,String(req.query.path||''),String(req.query.scope||'working')));}
  catch(e){res.status(e.status||503).json({error:e.status?e.message:'Diff could not be inspected. Try again.'});}
});
app.get('/api/session/:id/results', requireAuth, async (req,res) => {
  if(!anyId(req.params.id)) return res.status(400).json({error:'Invalid session'});
  try { res.json(await sessionResults(req.params.id)); }
  catch(e) { res.status(e.status || 503).json({error:e.status===404 ? e.message : 'Results could not be loaded. Try again.'}); }
});
app.get('/api/session/:id/artifact', requireAuth, async (req,res) => {
  if(!anyId(req.params.id)) return res.status(400).json({error:'Invalid session'});
  const requested=String(req.query.path || '');
  try {
    const {results}=await sessionResults(req.params.id);
    if(!results.some(r=>r.kind==='file'&&r.target===requested))return res.status(403).json({error:'This file is not a result referenced by the session.'});
    const real=await fsp.realpath(requested);
    if(!real.startsWith(HOME+'/')||real.slice(HOME.length+1).split('/').some(p=>p.startsWith('.')))return res.status(403).json({error:'File is outside the supported report location.'});
    const stat=await fsp.stat(real);if(!stat.isFile())return res.status(404).end();
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'");
    // HTML and other active documents must never execute under the app origin.
    res.download(real,path.basename(requested),err=>{if(err&&!res.headersSent)res.status(404).end();});
  }catch(e){res.status(e.code==='ENOENT'||e.status===404?404:503).json({error:'This result is not available. It may have moved or been removed.'});}
});

// ---------- usage visibility (Feature G) ----------
// Account-level plan usage (5-hour / weekly windows, extra-usage status). Values only
// change when a turn runs — the client labels them "as of <observedAt>", never live.
app.get('/api/usage', requireAuth, async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const claude = usage.accountSummary();
  const codexUsage = CODEX_ON ? await codex.codexRateLimits().catch(() => null) : null;
  res.json({ claude, codex: codexUsage });
});
// Per-session context meter ("70k / 1M · 7%"). Falls back to the transcript's last
// assistant usage line for sessions this daemon never ran a turn for.
app.get('/api/session/:id/context', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!anyId(req.params.id)) return res.status(400).json({ error: 'Invalid session' });
  try {
    if (isCx(req.params.id)) return res.json({ context: codex.getCodexContext(codex.bareId(req.params.id)) });
    const file = await findSessionFile(req.params.id);
    const context = await getSessionContext(usage, req.params.id, { transcriptFile: file, fsp });
    res.json({ context });
  } catch (e) { res.status(503).json({ error: 'Context could not be loaded. Try again.' }); }
});

// read-only "what did it do to my code": every Edit/Write with real before/after
app.get('/api/session/:id/changes', requireAuth, async (req, res) => {
  // Codex records edits as unified diff hunks, not before/after pairs — the view can't
  // render those yet, so report the touched files rather than pretending there's nothing.
  if (isCx(req.params.id)) {
    const { msgs } = await codex.readCodexThread(codex.bareId(req.params.id)).catch(() => ({ msgs: [] }));
    const paths = new Set();
    for (const m of msgs) for (const b of m.blocks || []) if (b.t === 'tool' && b.name === 'Edit' && b.detail) paths.add(b.detail);
    return res.json({ files: [...paths].map(p => ({ path: p, ops: [] })), failed: 0, diffless: true });
  }
  const file = await findSessionFile(req.params.id);
  if (!file) return res.status(404).json({ error: 'not found' });
  res.json(await collectChanges(file));
});

// full-transcript search — the client's find bar only sees the rendered tail
app.get('/api/session/:id/search', requireAuth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.status(400).json({ error: 'query too short' });
  if (isCx(req.params.id)) {
    const { msgs } = await codex.readCodexThread(codex.bareId(req.params.id), 5000).catch(() => ({ msgs: [] }));
    return res.json(searchMsgs(msgs, q));
  }
  const file = await findSessionFile(req.params.id);
  if (!file) return res.status(404).json({ error: 'not found' });
  res.json(await searchTranscript(file, q));
});

function turnOpts(body) {
  return {
    approvalMode:approvalMode(body?.approvalMode,DEFAULT_APPROVAL_MODE,ALLOW_FULL_ACCESS),
    executionMode:body?.executionMode==='plan'?'plan':'work',
    model: typeof body?.model === 'string' ? body.model : undefined,
    effort: typeof body?.effort === 'string' ? body.effort : undefined,
    attachments: Array.isArray(body?.attachments)
      ? body.attachments.filter(p => typeof p === 'string' && p.startsWith(UPLOAD_DIR) && fs.existsSync(p)).slice(0, 10)
      : undefined,
  };
}

// A Codex turn ends inside codex.mjs; the daemon-level follow-ups (notify the phone,
// run whatever was queued while it worked) mirror the Claude side's finalizeTurn.
async function codexTurnFinished(id, turn, ev) {
  recordOutcome(id, turn, ev);
  if (!turn.stopped && ev.ok && followups.list(id)[0]?.status === 'pending') {
    // Let the previous app-server release its writer lock before resuming.
    await new Promise(resolve=>setTimeout(resolve,600));
    if(ownedTurn(id))return;
    await runNextFollowup(id, turn.cwd).catch(e => log(`codex queue start failed thread=${id}: ${e.message}`));
    return;
  }
  if (!mutes.has(id)) {
    const meta = await codex.codexThreadMeta(codex.bareId(id)).catch(() => null);
    pushNotify(id, meta?.title || 'Codex session', ev.ok ? 'Response ready' : 'Turn ended — tap to review').catch(() => {});
  }
}
async function runNextFollowup(id, cwd) {
  return followups.dispatch(id, async row => {
    if (isCx(id)) return startCodexFromApi({id,threadId:codex.bareId(id),cwd,text:row.text,body:row});
    const file=await findSessionFile(id);
    const meta=file?await sessionMeta(file,id):null;
    return startTurn({sessionId:id,cwd:cwd||meta?.cwd||HOME,text:row.text,resume:true,...turnOpts(row)});
  });
}
function ownedTurn(id){return isCx(id)?codex.codexTurns.get(codex.bareId(id)):turns.get(id);}
function queueError(res,e){return res.status(e.status||503).json({error:e.status?e.message:'Queue could not be saved. Refresh and try again.'});}
app.get('/api/session/:id/queue',requireAuth,(req,res)=>{
  if(!anyId(req.params.id))return res.status(400).json({error:'Invalid session'});
  const id=req.params.id;
  res.json({items:followups.list(id),active:Boolean(ownedTurn(id)),external:isCx(id)?codex.codexExtActive(codex.bareId(id)):extActive(id)});
});
app.patch('/api/session/:id/queue/:item',requireAuth,(req,res)=>{
  if(req.body.editing===true){try{return res.json({item:followups.beginEdit(req.params.id,req.params.item,req.body.revision)});}catch(e){return queueError(res,e);}}
  const text=String(req.body.text||'').trim();if(!text||text.length>100000)return res.status(400).json({error:'Enter a message under 100,000 characters.'});
  try {res.json({item:followups.edit(req.params.id,req.params.item,req.body.revision,text)});}catch(e){queueError(res,e);}
});
app.delete('/api/session/:id/queue/:item',requireAuth,(req,res)=>{
  try {followups.remove(req.params.id,req.params.item,req.body.revision);res.json({ok:true});}catch(e){queueError(res,e);}
});
app.post('/api/session/:id/queue/start',requireAuth,async(req,res)=>{
  const id=req.params.id;if(!anyId(id))return res.status(400).json({error:'Invalid session'});
  if(ownedTurn(id)|| (isCx(id)?codex.codexExtActive(codex.bareId(id)):extActive(id)))return res.status(409).json({error:'A turn is running or activity was seen elsewhere. Wait before starting queued work.'});
  if(followups.list(id)[0]?.id!==req.body.itemId)return res.status(409).json({error:'The queue changed. Refresh before starting the next message.'});
  try {const started=await runNextFollowup(id);res.json({ok:true,started:Boolean(started)});}catch(e){queueError(res,e);}
});

async function startCodexFromApi({ id, threadId, cwd, text, body }) {
  const opts = withDefaults('codex', turnOpts(body));
  // onFinish takes the turn as an argument: a turn that fails during resume finishes
  // before this function has returned, so the closure can't reach a local binding yet.
  return codex.startCodexTurn({
    threadId, cwd, text, ...opts,
    auditApproval,onApproval:turn=>{const sid=id||(codex.CX+turn.threadId);const aid=turn.approvals.list().at(-1)?.id;if(aid&&turn.approvalNotified!==aid&&!mutes.has(sid)){turn.approvalNotified=aid;pushNotify(sid,'Action needs approval','Open Pocket Code to review the pending action.').catch(()=>{});}},
    onQuestion:turn=>{const sid=id||(codex.CX+turn.threadId);const qid=turn.questions.list().at(-1)?.id;if(!mutes.has(sid)&&turn.questionNotified!==qid){turn.questionNotified=qid;pushNotify(sid,'Codex needs your answer','Open Pocket Code to answer the agent’s question.').catch(()=>{});}},
    onFinish: (ev, turn) => codexTurnFinished(id || (codex.CX + turn.threadId), turn, ev),
  });
}

function validateApprovalMode(req,res,next){
  try{approvalMode(req.body?.approvalMode,DEFAULT_APPROVAL_MODE,ALLOW_FULL_ACCESS);next();}
  catch(e){res.status(e.status||400).json({error:e.message});}
}
app.post('/api/session/:id/message', requireAuth, validateApprovalMode, withDeliveryReceipt(deliveryReceipts, async (req, res) => {
  const id = req.params.id;
  if(!anyId(id))return res.status(400).json({error:'Invalid session'});
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'empty message' });
  const mode=req.body.mode || 'auto';
  if(!['auto','steer','queue'].includes(mode))return res.status(400).json({error:'Invalid delivery mode'});
  if(mode==='steer'&&!ownedTurn(id))return res.status(409).json({error:'The turn has ended. Review the conversation, then send a new message.'});
  if(mode==='queue'&&!ownedTurn(id)){
    if(isCx(id)?!await codex.codexThreadMeta(codex.bareId(id)):!await findSessionFile(id))return res.status(404).json({error:'Session not found'});
    try{const item=followups.add(id,{text,...turnOpts(req.body)});return res.status(202).json({ok:true,queued:true,paused:true,itemId:item.id});}
    catch(e){return queueError(res,e);}
  }
  if (isCx(id)) {
    const tid = codex.bareId(id);
    const running = codex.codexTurns.get(tid);
    if (running) {
      const opts = turnOpts(req.body);
      try { if (mode !== 'queue' && await codex.steerCodexTurn(tid, promptText(text, opts.attachments))) {
        log(`steered message into running codex turn thread=${tid}`);
        return res.status(202).json({ ok: true, steered: true });
      } } catch {return res.status(503).json({error:'Steering was not confirmed. Review the conversation before sending again.',code:'delivery_uncertain'});}
      if(mode==='steer')return res.status(409).json({error:'This turn cannot accept steering now. Choose After this turn to queue it.'});
      try {const item=followups.add(id,{text,...opts});return res.status(202).json({ok:true,queued:true,itemId:item.id});}
      catch(e){return queueError(res,e);}

    }
    try {
      await startCodexFromApi({ id, threadId: tid, text, body: req.body });
      return res.status(202).json({ ok: true });
    } catch (e) {
      return res.status(e.code === 409 ? 409 : e.code === 423 ? 423 : 500).json({ error: String(e.message) });
    }
  }
  const file = await findSessionFile(id);
  if (!file) return res.status(404).json({ error: 'not found' });
  const meta = await sessionMeta(file, id);
  const cwd = meta.cwd && fs.existsSync(meta.cwd) ? meta.cwd : HOME;
  const running = turns.get(id);
  if (!running && busyElsewhere(id)) return res.status(409).json({ error: 'This session is being used in another app right now (code-server or a terminal). Send again once that turn has finished.' });
  if (running) {
    const opts = turnOpts(req.body);
    // steer first: inject into the running turn (model sees it at the next boundary);
    // fall back to the queue for adopted turns (no stdin) or a just-closed pipe
    if (mode !== 'queue' && steerTurn(running, promptText(text, opts.attachments))) {
      broadcast(running, { type: 'user', msg: { role: 'user', text, ts: new Date().toISOString() } });
      log(`steered message into running turn session=${id}`);
      return res.status(202).json({ ok: true, steered: true });
    }
    if(mode==='steer')return res.status(409).json({error:'This turn cannot accept steering now. Choose After this turn to queue it.'});
    try {const item=followups.add(id,{text,...opts});return res.status(202).json({ok:true,queued:true,itemId:item.id});}
    catch(e){return queueError(res,e);}

  }
  try {
    startTurn({ sessionId: id, cwd, text, resume: true, ...turnOpts(req.body) });
    res.status(202).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
}));

app.post('/api/new', requireAuth, validateApprovalMode, withDeliveryReceipt(deliveryReceipts, async (req, res) => {
  const cwd = String(req.body?.cwd || '').trim();
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'empty message' });
  if (!cwd.startsWith('/') || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    return res.status(400).json({ error: 'invalid project directory' });
  }
  if (req.body?.provider === 'codex') {
    if (!CODEX_ON) return res.status(400).json({ error: 'codex not available on this box' });
    try { // Codex mints the thread id, so the client learns it from the response
      const turn = await startCodexFromApi({ threadId: null, cwd, text, body: req.body });
      return res.status(202).json({ id: codex.CX + turn.threadId });
    } catch (e) { return res.status(500).json({ error: String(e.message) }); }
  }
  const id = randomUUID();
  try {
    startTurn({ sessionId: id, cwd, text, resume: false, ...turnOpts(req.body) });
    res.status(202).json({ id });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
}));

app.post('/api/session/:id/pin', requireAuth, (req, res) => {
  const id = req.params.id;
  if (!anyId(id)) return res.status(400).json({ error: 'bad id' });
  setSmeta(id, { pin: req.body?.pinned ? true : null });
  log(`session ${isPinned(id) ? 'pinned' : 'unpinned'} session=${id}`);
  res.json({ ok: true, pinned: isPinned(id) });
});

// custom title overlay — empty name reverts to the transcript-derived title.
// With titleSync on, a rename is also appended to the transcript as a custom-title
// record — the exact line Claude Code's own rename writes — so code-server and the
// `claude --resume` picker show it too. (A reset can't retract those records: their
// reader keeps the last non-empty custom-title, so reset only clears the overlay.)
app.post('/api/session/:id/rename', requireAuth, async (req, res) => {
  const id = req.params.id;
  if (!anyId(id)) return res.status(400).json({ error: 'bad id' });
  const name = String(req.body?.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  setSmeta(id, { name: name || null });
  if (isCx(id)) {
    if (name && settings.titleSync) {
      try { await codex.setCodexThreadName(codex.bareId(id), name); }
      catch (e) { log(`codex rename failed session=${id}: ${e.message}`); }
    }
    log(`session renamed session=${id} name=${name ? JSON.stringify(name) : '(reset)'}`);
    return res.json({ ok: true, name: name || null });
  }
  if (name && settings.titleSync) {
    const file = await findSessionFile(id);
    if (file) {
      try { fs.appendFileSync(file, JSON.stringify({ type: 'custom-title', sessionId: id, customTitle: name }) + '\n'); }
      catch (e) { log(`custom-title append failed session=${id}: ${e.message}`); }
    }
  }
  log(`session renamed session=${id} name=${name ? JSON.stringify(name) : '(reset)'}${name && settings.titleSync ? ' (synced to transcript)' : ''}`);
  res.json({ ok: true, name: name || null });
});

// server-wide options (titleSync). One tenant per install, so no per-user scoping.
app.get('/api/settings', requireAuth, (_req, res) => res.json(settings));
app.post('/api/settings', requireAuth, (req, res) => {
  if (typeof req.body?.titleSync === 'boolean') settings.titleSync = req.body.titleSync;
  saveSettings();
  log(`settings updated: titleSync=${settings.titleSync}`);
  res.json(settings);
});

app.post('/api/session/:id/mute', requireAuth, (req, res) => {
  const id = req.params.id;
  if (!anyId(id)) return res.status(400).json({ error: 'bad id' });
  if (req.body?.muted) mutes.add(id); else mutes.delete(id);
  saveMutes();
  log(`push ${mutes.has(id) ? 'muted' : 'unmuted'} session=${id}`);
  res.json({ ok: true, muted: mutes.has(id) });
});

// Closing a session view ends its CLI process now rather than at the idle timeout.
// 409 while a turn (or a background job) is running unless the caller chose to stop it.
app.post('/api/session/:id/release', requireAuth, (req, res) => {
  const id = req.params.id, stop = req.body?.stop === true;
  if (!anyId(id)) return res.status(400).json({ error: 'Invalid session' });
  if (isCx(id)) {
    if (!codex.codexTurns.get(codex.bareId(id))) return res.json({ released: false });
    if (!stop) return res.status(409).json({ running: true });
    codex.stopCodexTurn(codex.bareId(id));
    return res.json({ released: true });
  }
  const turn = turns.get(id), r = runners.get(id);
  if ((turn || r?.bgTasks.length) && !stop) return res.status(409).json({ running: true, background: !turn });
  if (turn) { turn.stopped = true; signalTurn(turn); log(`stop requested (closed) session=${id}`); return res.json({ released: true }); }
  if (r && !r.closing && !r.exited) { if (r.bgTasks.length) signalTurn(r); else closeRunner(r, 'closed by you'); return res.json({ released: true }); }
  res.json({ released: false });
});

app.post('/api/session/:id/stop', requireAuth, (req, res) => {
  if (isCx(req.params.id)) {
    if (!codex.stopCodexTurn(codex.bareId(req.params.id))) return res.status(404).json({ error: 'no running turn' });
    log(`stop requested session=${req.params.id}`);
    return res.json({ ok: true });
  }
  const turn = turns.get(req.params.id);
  if (!turn) return res.status(404).json({ error: 'no running turn' });
  turn.stopped = true;
  signalTurn(turn);
  log(`stop requested session=${req.params.id}`);
  res.json({ ok: true });
});

// Attachments: raw body upload, filename via header. Files land in ~/pocket-uploads
// and are referenced by absolute path in the prompt (Claude Reads them; verified
// with an image 2026-08-14).
app.post('/api/upload', requireAuth, express.raw({ type: () => true, limit: '30mb' }), (req, res) => {
  const raw = String(req.headers['x-filename'] || 'file.bin');
  const safe = path.basename(raw).replace(/[^\w.\-]+/g, '_').slice(-80) || 'file.bin';
  if (!req.body?.length) return res.status(400).json({ error: 'empty upload' });
  const dir = path.join(UPLOAD_DIR, new Date().toISOString().slice(0, 7));
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${Date.now().toString(36)}-${safe}`);
  fs.writeFileSync(dest, req.body);
  log(`upload ${dest} (${req.body.length} bytes)`);
  res.json({ path: dest, name: safe, size: req.body.length });
});

// Slash-command discovery: user skills/commands + the session project's own.
function readSkillDesc(file) {
  try {
    const head = fs.readFileSync(file, 'utf8').slice(0, 2000);
    if(/^user-invocable:\s*false\s*$/mi.test(head))return null;
    const m = head.match(/^description:\s*(.+)$/m);
    return m ? m[1].replace(/^['"]|['"]$/g, '').slice(0, 90) : '';
  } catch { return ''; }
}
app.get('/api/commands', requireAuth, async (req, res) => {
  const cwd = String(req.query.cwd || '');
  if(req.query.provider==='codex'){
    if(!CODEX_ON)return res.json({commands:[],warning:'Codex is not available on this instance.'});
    try{return res.json({commands:await codex.listCodexSkills(cwd.startsWith('/')?cwd:HOME)});}
    catch{return res.status(503).json({error:'Codex skills are unavailable. Try again, or describe your task directly.'});}
  }
  const out = new Map();
  const scan = base => {
    for (const kind of ['skills', 'commands']) {
      const dir = path.join(base, '.claude', kind);
      let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        // skills may be symlinked dirs (house convention) — probe for SKILL.md directly
        const sk = path.join(dir, e.name, 'SKILL.md');
        if (fs.existsSync(sk)) {
          const desc=readSkillDesc(sk);if (desc!==null && !out.has(e.name)) out.set(e.name,desc);
        } else if (e.isFile() && e.name.endsWith('.md')) {
          const name = e.name.replace(/\.md$/, '');
          const desc=readSkillDesc(path.join(dir,e.name));if (desc!==null && !out.has(name)) out.set(name,desc);
        }
      }
    }
  };
  if (cwd.startsWith('/') && cwd !== HOME && fs.existsSync(cwd)) scan(cwd);
  scan(HOME);
  res.json({ commands: [...out.entries()].map(([name, desc]) => ({ name, desc, label:name.replace(/[-_]/g,' '), invocation:`Use the /${name} skill or command.` })).sort((a, b) => a.name.localeCompare(b.name)) });
});

app.get('/api/session/:id/events', requireAuth, async (req, res) => {
  const id = req.params.id;
  const turn = turns.get(id);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch { } }, 25000);
  if (isCx(id)) {
    const tid = codex.bareId(id);
    const cxTurn = codex.codexTurns.get(tid);
    if (cxTurn) { // our own turn: replay what the client missed, then stream live
      const from = Number(req.headers['last-event-id'] ?? -1) + 1;
      for (let i = from; i < cxTurn.events.length; i++) {
        res.write(`id: ${i}\ndata: ${JSON.stringify(cxTurn.events[i])}\n\n`);
      }
      cxTurn.subs.add(res);
      req.on('close', () => { clearInterval(ka); cxTurn.subs.delete(res); });
      return;
    }
    res.write(`data: {"type":"watch"}\n\n`);
    const stop = codex.watchCodexThread(tid, ev => { try { res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch { } });
    req.on('close', () => { clearInterval(ka); stop(); });
    return;
  }
  if (turn) { // a turn our daemon is running: replay + live events
    const from = Number(req.headers['last-event-id'] ?? -1) + 1;
    for (let i = from; i < turn.events.length; i++) {
      res.write(`id: ${i}\ndata: ${JSON.stringify(turn.events[i])}\n\n`);
    }
    turn.subs.add(res);
    req.on('close', () => { clearInterval(ka); turn.subs.delete(res); });
    return;
  }
  // watch mode: mirror the transcript live (turns driven by code-server / terminal)
  const file = await findSessionFile(id);
  if (!file) { clearInterval(ka); res.write(`data: {"type":"idle"}\n\n`); return res.end(); }
  let offset = Number(req.query.offset);
  const size = (await fsp.stat(file)).size;
  if (!Number.isFinite(offset) || offset < 0 || offset > size) offset = size;
  res.write(`data: {"type":"watch"}\n\n`);
  const t = { res, offset, rem: '' };
  if (!tailers.has(id)) tailers.set(id, new Set());
  tailers.get(id).add(t);
  req.on('close', () => { clearInterval(ka); tailers.get(id)?.delete(t); if (!tailers.get(id)?.size) tailers.delete(id); });
  pumpTail(id, file); // catch anything written between transcript fetch and connect
});

// ---------- push endpoints ----------
app.get('/api/push/key', requireAuth, (_req, res) => res.json({ key: pushReady ? process.env.VAPID_PUBLIC : null }));
app.post('/api/push/subscribe', requireAuth, (req, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint) return res.status(400).json({ error: 'bad subscription' });
  const subs = loadSubs().filter(s => s.endpoint !== sub.endpoint);
  subs.push(sub);
  saveSubs(subs);
  log(`push subscribed (${subs.length} devices)`);
  res.json({ ok: true });
});
app.post('/api/push/unsubscribe', requireAuth, (req, res) => {
  saveSubs(loadSubs().filter(s => s.endpoint !== req.body?.endpoint));
  res.json({ ok: true });
});

// serve local images referenced in chats (Claude-generated charts, screenshots, uploads)
app.get('/api/file', requireAuth, (req, res) => {
  const p = String(req.query.path || '');
  if (!/\.(png|jpe?g|gif|webp)$/i.test(p)) return res.status(400).end();
  let real; try { real = fs.realpathSync(p); } catch { return res.status(404).end(); }
  if (!real.startsWith(HOME + '/')) return res.status(403).end();
  res.sendFile(real);
});

app.get('/api/health', (_req, res) => res.json({
  ok: true, active: turns.size + codex.codexTurns.size, codexActive: codex.codexTurns.size, processes: runners.size, uptime: process.uptime(),
}));

// model picker options — Claude's from CLAUDE_MODELS, Codex's straight from its app-server
app.get('/api/claude/models', requireAuth, (_req, res) => res.json({
  models: CLAUDE_MODELS.map(({ id, label, sub }) => ({ id, label, sub })),
  defaultLabel: claudeDefaultLabel(),
  defaultEffort: POCKET_DEFAULTS.claude.effort || null,
  pocketDefault: Boolean(POCKET_DEFAULTS.claude.model || POCKET_DEFAULTS.claude.effort),
}));
app.get('/api/codex/models', requireAuth, async (_req, res) => {
  const { model, effort } = POCKET_DEFAULTS.codex;
  const defaults = { defaultModel: model || null, defaultEffort: effort || null, pocketDefault: Boolean(model || effort) };
  if (!CODEX_ON) return res.json({ models: [], ...defaults });
  res.json({ models: await codex.codexModels().catch(() => []), ...defaults });
});

// What changed in the current asset version — shown under "What's new" in the settings
// sheet. Replace (don't append) on each release; the ledger keeps the history.
const RELEASE_NOTES = [
  "Collapse the whole session header, including Mission Control navigation, on phone, tablet and desktop. Live status stays visible.",
  "Hide message settings independently with the gear beside the composer. Attachments and Send remain available; both choices are remembered in this browser.",
  "Each Claude Code session keeps one process between turns: faster turns, and background jobs, MCP connections and the working directory carry over.",
  "No more 2-hour turn limit. Long work keeps running; only a turn that has been completely silent for 30 minutes is stopped.",
  "When a background job finishes after a turn, the agent's follow-up appears live and notifies you.",
  "Context meter on each session, and a Plan usage panel with your 5-hour and weekly limits (reset times in Eastern).",
  "Close the main session from its header (session options on phones); it asks first if work is still running."
];

// version/about info, computed once at boot. assetV comes from index.html, so the
// settings sheet can tell a stale cached client "the server has something newer".
const ABOUT = (() => {
  const sh = cmd => { try { return execSync(cmd, { cwd: import.meta.dirname, timeout: 5000 }).toString().trim(); } catch { return null; } };
  let assetV = null;
  try { assetV = Number((fs.readFileSync(path.join(import.meta.dirname, 'public', 'index.html'), 'utf8').match(/app\.js\?v=(\d+)/) || [])[1]) || null; } catch { }
  return {
    assetV,
    version: JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'package.json'), 'utf8')).version,
    notes: RELEASE_NOTES,
    commit: sh('git log -1 --format=%h'),
    commitAt: sh('git log -1 --format=%cI'),
    node: process.version,
    host: os.hostname(),
    push: pushReady,
  };
})();
// CLI versions are re-read when the installed binary changes (npm upgrades swap the
// package in place while this server keeps running) — not frozen at boot.
const verCache = new Map(); // bin -> { stamp, v }
function binVersion(bin) {
  const stamp = codex.binStamp(bin);
  const hit = verCache.get(bin);
  if (hit && hit.stamp === stamp) return hit.v;
  let v = null;
  try { v = execSync(`'${bin}' --version`, { timeout: 5000 }).toString().trim(); } catch { }
  verCache.set(bin, { stamp, v });
  return v;
}
app.get('/api/environment',requireAuth,async(_req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  const [claude,cx]=await Promise.all([readClaudeIdentity(CLAUDE_BIN,spawnEnv()),CODEX_ON?codex.accountSummary().catch(()=>({provider:'codex',signedIn:null,method:'Status unavailable'})):Promise.resolve({provider:'codex',signedIn:false,method:'Not installed'})]);
  res.json({host:os.hostname(),checkedAt:Date.now(),providers:[claude,cx],permissions:'Selectable native tool approvals; not employee isolation',accountManagement:'Provider sign-ins are managed by the installed CLIs on this instance. Existing runs may keep the account they started with.',capabilities:{claudeQuestions:true,codexQuestions:CODEX_ON,approvalControls:true}});
});
app.get('/api/about', requireAuth, (_req, res) => res.json({
  ...ABOUT, uptime: process.uptime(),
  cli: binVersion(CLAUDE_BIN), codex: CODEX_ON ? binVersion(codex.CODEX_BIN) : null,
}));

app.listen(PORT, '127.0.0.1', () => log(`pocket-claude listening on 127.0.0.1:${PORT}`));
