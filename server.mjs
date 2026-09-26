// Pocket Code — mobile web UI for the Claude Code and Codex sessions on this box.
// The daemon owns every turn: a message POSTed here spawns `claude -p --resume`
// server-side, so the phone can disconnect/sleep and the turn still completes.
// Transcripts stay in ~/.claude/projects — the same store code-server reads.

import express from 'express';
import webpush from 'web-push';
import { spawn, execSync } from 'node:child_process';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import * as codex from './codex.mjs';

// ---------- config ----------
const HOME = os.homedir();
const PROJECTS_ROOT = path.join(HOME, '.claude', 'projects');
const ENV_FILE = path.join(import.meta.dirname, '.env');
for (const line of (fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8').split('\n') : [])) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
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
const TURN_KILL_MS = 2 * 60 * 60 * 1000; // safety net for runaway turns
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
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(HOME, '.claude', 'settings.json'), 'utf8')).model; } catch { }
  if (!raw) return 'CLI default';
  const base = raw.replace(/\[1m\]$/i, ''), big = base !== raw ? ' · 1M' : '';
  const hit = CLAUDE_MODELS.find(m => m.alias === base || m.id.replace(/\[1m\]$/, '') === base);
  return hit ? hit.label + big : raw;
}
const EFFORTS = new Set(['max', 'xhigh', 'high', 'medium', 'low']);

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- web push (turn-completion notifications) ----------
const SUBS_FILE = path.join(import.meta.dirname, 'push-subs.json');
const pushReady = Boolean(process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE);
// VAPID subject: the operator contact push services may use — an email (mailto: added) or an https URL.
const vapidSubject = (c => !c ? 'https://github.com/bbesner/pocket-code' : /^(mailto:|https:)/.test(c) ? c : `mailto:${c}`)(process.env.VAPID_CONTACT);
if (pushReady) webpush.setVapidDetails(vapidSubject, process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
else log('push disabled: VAPID keys not set');
const loadSubs = () => { try { return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')); } catch { return []; } };
const saveSubs = s => fs.writeFileSync(SUBS_FILE, JSON.stringify(s, null, 1));
// per-session mute: a chatty background session shouldn't buzz the phone every turn
const MUTES_FILE = path.join(import.meta.dirname, 'mutes.json');
const loadMutes = () => { try { return new Set(JSON.parse(fs.readFileSync(MUTES_FILE, 'utf8'))); } catch { return new Set(); } };
let mutes = loadMutes();
const saveMutes = () => fs.writeFileSync(MUTES_FILE, JSON.stringify([...mutes]));
// per-session pin + custom name: the CLI's session store has no field for either, so they
// live in an overlay here (same pattern as mutes) — transcripts stay untouched
const SMETA_FILE = path.join(import.meta.dirname, 'session-meta.json');
const loadSmeta = () => { try { return JSON.parse(fs.readFileSync(SMETA_FILE, 'utf8')); } catch { return {}; } };
let smeta = loadSmeta();
const saveSmeta = () => fs.writeFileSync(SMETA_FILE, JSON.stringify(smeta, null, 1));
const isPinned = id => Boolean(smeta[id]?.pin);
// server-wide options (one tenant per install). titleSync: share session names with
// Claude Code itself — read the CLI/code-server's custom-title/ai-title records from the
// transcript and write renames back as custom-title lines (their own rename mechanism).
const SETTINGS_FILE = path.join(import.meta.dirname, 'pocket-settings.json');
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
  for (const x of sorted.slice(recent.length)) if (isPinned(x.id)) recent.push(x); // pins never age out
  const seen = new Map(); // title+cwd -> listed entry (resumed sessions repeat both)
  for (const x of recent) {
    const pinned = isPinned(x.id);
    const meta = await sessionMeta(x.file, x.id);
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
  return [...pins, ...out.filter(e => !e.pinned).slice(0, Math.max(0, limit - pins.length))];
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
        extActivity.set(id, Date.now());
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

// ---------- turn runner ----------
// Turns run DETACHED (own process group, stdio to files under turnlogs/) and PM2 runs
// this server with --no-treekill. Together those mean restarting pocket-claude — even
// from inside one of its own turns (the 2026-08-14 self-kill incident) — no longer
// kills in-flight turns: the claude process survives, and the next server instance
// adopts it from its .turn.json marker and resumes streaming from the log file.
const turns = new Map(); // sessionId -> {pid, events[], subs:Set<res>, cwd, startedAt, queue[]}
const TURNLOG_DIR = path.join(import.meta.dirname, 'turnlogs');
fs.mkdirSync(TURNLOG_DIR, { recursive: true });
const turnFiles = id => ({
  out: path.join(TURNLOG_DIR, id + '.out.ndjson'),
  err: path.join(TURNLOG_DIR, id + '.err.log'),
  meta: path.join(TURNLOG_DIR, id + '.turn.json'),
  retry: path.join(TURNLOG_DIR, id + '.retry.json'),
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
    model: turn.model, effort: turn.effort, attempt: (turn.retryAttempt || 0) + 1,
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
  const opts = { sessionId: m.sessionId, cwd: m.cwd, model: m.model, effort: m.effort, retryAttempt: m.attempt };
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
  const env = { ...process.env };
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

function handleTurnLine(turn, line) {
  let o; try { o = JSON.parse(line); } catch { return; }
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
    // signal no-more-input; the CLI drains any steer already written, then exits
    try { turn.stdin?.end(); } catch { }
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

function trackTurn(sessionId, turn) {
  turns.set(sessionId, turn);
  turn.tailOffset = 0; turn.tailRem = '';
  turn.tailTimer = setInterval(() => drainTurnLog(turn), 300);
  const remaining = Math.max(60_000, TURN_KILL_MS - (Date.now() - turn.startedAt));
  turn.killTimer = setTimeout(() => { log(`turn TIMEOUT session=${sessionId}`); signalTurn(turn); }, remaining);
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

function finalizeTurn(sessionId, turn, code) {
  if (turn.finalized) return;
  turn.finalized = true;
  restampEntrypoint(sessionId);
  clearInterval(turn.tailTimer); clearInterval(turn.pollTimer); clearTimeout(turn.killTimer);
  drainTurnLog(turn);
  let stderrTail = '';
  try { stderrTail = fs.readFileSync(turn.files.err, 'utf8').slice(-500); } catch { }
  if (turn.stopped && !turn.events.some(e => e.type === 'result')) {
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
  if (!turn.stopped && !turn.queue.length && (turn.retryAttempt || 0) < RETRY_MAX_ATTEMPTS) {
    const failed = turn.events.find(e => e.type === 'result' && !e.ok);
    if (failed) {
      const rl = detectRateLimit(`${failed.error || ''} ${stderrTail}`);
      if (rl) { retryAt = rl.resetAt; broadcast(turn, { type: 'retry', at: retryAt }); }
    }
  }
  const watching = turn.subs.size > 0;
  broadcast(turn, { type: 'done' });
  for (const res of turn.subs) { try { res.end(); } catch { } }
  turns.delete(sessionId);
  try { fs.unlinkSync(turn.files.meta); } catch { }
  if (retryAt) scheduleRetry(sessionId, turn, retryAt); // after turns.delete — cancelRetry in startTurn
  // queued follow-ups run as the next turn; notify only when everything is finished
  if (turn.queue.length && !turn.stopped) {
    const q = turn.queue;
    try {
      startTurn({
        sessionId, cwd: turn.cwd, resume: true,
        text: q.map(x => x.text).join('\n\n'),
        model: q[q.length - 1].model, effort: q[q.length - 1].effort,
        attachments: q.flatMap(x => x.attachments || []),
      });
      return;
    } catch (e) { log(`queued turn failed to start session=${sessionId}: ${e.message}`); }
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

function startTurn({ sessionId, cwd, text, resume, model, effort, attachments, retryAttempt }) {
  if (turns.has(sessionId)) throw Object.assign(new Error('busy'), { code: 409 });
  cancelRetry(sessionId); // a manually-started turn supersedes any pending auto-resume
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'bypassPermissions'];
  if (model && MODELS.has(model)) args.push('--model', model);
  if (effort && EFFORTS.has(effort)) args.push('--settings', JSON.stringify({ effortLevel: effort }));
  if (resume) args.push('--resume', sessionId); else args.push('--session-id', sessionId);
  const files = turnFiles(sessionId);
  fs.writeFileSync(files.out, ''); fs.writeFileSync(files.err, '');
  const outFd = fs.openSync(files.out, 'a'), errFd = fs.openSync(files.err, 'a');
  const proc = spawn(CLAUDE_BIN, args, { cwd, env: spawnEnv(), detached: true, stdio: ['pipe', outFd, errFd] });
  fs.closeSync(outFd); fs.closeSync(errFd);
  proc.unref();
  proc.stdin.on('error', () => { }); // EPIPE if the CLI dies first — finalize handles it
  try { proc.stdin.write(userJSON(promptText(text, attachments))); } catch { }
  const turn = { pid: proc.pid, stdin: proc.stdin, events: [], subs: new Set(), cwd, startedAt: Date.now(), userText: text, model, effort, retryAttempt, queue: [], files };
  fs.writeFileSync(files.meta, JSON.stringify({ sessionId, pid: proc.pid, cwd, startedAt: turn.startedAt, userText: text }));
  trackTurn(sessionId, turn);
  log(`turn start session=${sessionId} resume=${!!resume} pid=${proc.pid} cwd=${cwd}`);
  proc.on('exit', code => finalizeTurn(sessionId, turn, code));
  proc.on('error', () => finalizeTurn(sessionId, turn, -1));
  return turn;
}

// Reattach turns that survived a server restart; sweep stale turn logs.
function adoptOrphans() {
  let entries = []; try { entries = fs.readdirSync(TURNLOG_DIR); } catch { return; }
  for (const f of entries) {
    const full = path.join(TURNLOG_DIR, f);
    if (f.endsWith('.turn.json')) {
      let m; try { m = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { try { fs.unlinkSync(full); } catch { } continue; }
      if (m.sessionId && m.pid && pidAlive(m.pid) && isTurnProc(m.pid, m.sessionId)) {
        const turn = {
          pid: m.pid, adopted: true, events: [], subs: new Set(), cwd: m.cwd,
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
    } else if (/\.(out\.ndjson|err\.log)$/.test(f)) {
      try { if (Date.now() - fs.statSync(full).mtimeMs > 48 * 3600_000) fs.unlinkSync(full); } catch { }
    }
  }
}
adoptOrphans();

// ---------- app ----------
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(import.meta.dirname, 'public'), { index: 'index.html', maxAge: '5m' }));

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
async function listAllSessions(limit) {
  const claude = (await listSessions(limit)).map(s => ({ ...s, provider: s.provider || 'claude' }));
  if (!CODEX_ON) return claude;
  let cx = [];
  try { cx = await codex.listCodexSessions(limit); }
  catch (e) { log(`codex list failed: ${e.message}`); return claude; }
  const cxRows = cx.map(s => {
    const tid = codex.bareId(s.id);
    return {
      ...s,
      title: smeta[s.id]?.name || s.title,
      active: codex.codexTurnActive(tid) || codex.codexExtActive(tid),
      pinned: isPinned(s.id) || undefined,
    };
  });
  const all = [...claude, ...cxRows];
  const pins = all.filter(e => e.pinned);
  const rest = all.filter(e => !e.pinned).sort((a, b) => b.mtimeMs - a.mtimeMs);
  return [...pins, ...rest.slice(0, Math.max(0, limit - pins.length))];
}

app.get('/api/sessions', requireAuth, async (req, res) => {
  res.json({ sessions: await listAllSessions(Math.min(Number(req.query.limit) || 60, 200)) });
});

app.get('/api/projects', requireAuth, async (_req, res) => {
  const seen = new Map(); // cwd -> latest mtime
  for (const s of await listAllSessions(200)) {
    if (!s.cwd || s.cwd.startsWith('/tmp/') || s.cwd.includes('/.claude/')) continue;
    if (!seen.has(s.cwd) || seen.get(s.cwd) < s.mtimeMs) seen.set(s.cwd, s.mtimeMs);
  }
  const projects = [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([cwd]) => cwd);
  if (!projects.includes(HOME)) projects.push(HOME);
  res.json({ projects });
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
      active: Boolean(turn), ext: codex.codexExtActive(tid),
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
        active: true, messages: turn.userText ? [{ role: 'user', text: turn.userText }] : [],
      });
    }
    return res.status(404).json({ error: 'not found' });
  }
  const meta = await sessionMeta(file, req.params.id);
  const { msgs: messages, total } = await readTranscript(file);
  res.json({ ...meta, active: turns.has(req.params.id), ext: extActive(req.params.id), muted: mutes.has(req.params.id), pinned: isPinned(req.params.id), messages, total });
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
  const next = turn.queue.shift();
  if (!mutes.has(id) && !next) {
    const meta = await codex.codexThreadMeta(codex.bareId(id)).catch(() => null);
    const last = [...turn.events].reverse().find(e => e.type === 'assistant');
    const body = last?.msg?.blocks?.filter(b => b.t === 'text').map(b => b.text).join(' ').slice(0, 160)
      || (ev.ok ? 'Turn finished' : `Turn failed: ${ev.error || ''}`);
    pushNotify(id, meta?.title || 'Codex session', body);
  }
  if (next) {
    try {
      const t = await codex.startCodexTurn({
        threadId: codex.bareId(id), text: next.text, model: next.model, effort: next.effort,
        attachments: next.attachments, onFinish: (e, nt) => codexTurnFinished(id, nt, e),
      });
      t.queue = turn.queue; // carry the rest of the backlog forward
      log(`codex queued message started thread=${id}`);
    } catch (e) { log(`codex queue drain failed thread=${id}: ${e.message}`); }
  }
}

async function startCodexFromApi({ id, threadId, cwd, text, body }) {
  const opts = turnOpts(body);
  // onFinish takes the turn as an argument: a turn that fails during resume finishes
  // before this function has returned, so the closure can't reach a local binding yet.
  return codex.startCodexTurn({
    threadId, cwd, text, ...opts,
    onFinish: (ev, turn) => codexTurnFinished(id || (codex.CX + turn.threadId), turn, ev),
  });
}

app.post('/api/session/:id/message', requireAuth, async (req, res) => {
  const id = req.params.id;
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'empty message' });
  if (isCx(id)) {
    const tid = codex.bareId(id);
    const running = codex.codexTurns.get(tid);
    if (running) {
      const opts = turnOpts(req.body);
      if (codex.steerCodexTurn(tid, promptText(text, opts.attachments))) {
        log(`steered message into running codex turn thread=${tid}`);
        return res.status(202).json({ ok: true, steered: true });
      }
      if (running.queue.length >= 10) return res.status(429).json({ error: 'queue full' });
      running.queue.push({ text, ...opts });
      return res.status(202).json({ ok: true, queued: true });
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
  if (running) {
    const opts = turnOpts(req.body);
    // steer first: inject into the running turn (model sees it at the next boundary);
    // fall back to the queue for adopted turns (no stdin) or a just-closed pipe
    if (steerTurn(running, promptText(text, opts.attachments))) {
      broadcast(running, { type: 'user', msg: { role: 'user', text, ts: new Date().toISOString() } });
      log(`steered message into running turn session=${id}`);
      return res.status(202).json({ ok: true, steered: true });
    }
    if (running.queue.length >= 10) return res.status(429).json({ error: 'queue full' });
    running.queue.push({ text, ...opts });
    log(`queued message session=${id} depth=${running.queue.length}`);
    return res.status(202).json({ ok: true, queued: true });
  }
  try {
    startTurn({ sessionId: id, cwd, text, resume: true, ...turnOpts(req.body) });
    res.status(202).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post('/api/new', requireAuth, async (req, res) => {
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
});

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
    const m = head.match(/^description:\s*(.+)$/m);
    return m ? m[1].replace(/^['"]|['"]$/g, '').slice(0, 90) : '';
  } catch { return ''; }
}
app.get('/api/commands', requireAuth, (req, res) => {
  const cwd = String(req.query.cwd || '');
  const out = new Map();
  const scan = base => {
    for (const kind of ['skills', 'commands']) {
      const dir = path.join(base, '.claude', kind);
      let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        // skills may be symlinked dirs (house convention) — probe for SKILL.md directly
        const sk = path.join(dir, e.name, 'SKILL.md');
        if (fs.existsSync(sk)) {
          if (!out.has(e.name)) out.set(e.name, readSkillDesc(sk));
        } else if (e.isFile() && e.name.endsWith('.md')) {
          const name = e.name.replace(/\.md$/, '');
          if (!out.has(name)) out.set(name, readSkillDesc(path.join(dir, e.name)));
        }
      }
    }
  };
  scan(HOME);
  if (cwd.startsWith('/') && cwd !== HOME && fs.existsSync(cwd)) scan(cwd);
  res.json({ commands: [...out.entries()].map(([name, desc]) => ({ name, desc })).sort((a, b) => a.name.localeCompare(b.name)) });
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
  ok: true, active: turns.size + codex.codexTurns.size, codexActive: codex.codexTurns.size, uptime: process.uptime(),
}));

// model picker options — Claude's from CLAUDE_MODELS, Codex's straight from its app-server
app.get('/api/claude/models', requireAuth, (_req, res) => res.json({
  models: CLAUDE_MODELS.map(({ id, label, sub }) => ({ id, label, sub })),
  defaultLabel: claudeDefaultLabel(),
}));
app.get('/api/codex/models', requireAuth, async (_req, res) => {
  if (!CODEX_ON) return res.json({ models: [] });
  res.json({ models: await codex.codexModels().catch(() => []) });
});

// What changed in the current asset version — shown under "What's new" in the settings
// sheet. Replace (don't append) on each release; the ledger keeps the history.
const RELEASE_NOTES = [
  'Pocket Code 1.0 — now published as an open-source project, with a full README, changelog and MIT license.',
  'Project paths shorten to ~ under any home directory, not only /home/ubuntu.',
];

// version/about info, computed once at boot. assetV comes from index.html, so the
// settings sheet can tell a stale cached client "the server has something newer".
const ABOUT = (() => {
  const sh = cmd => { try { return execSync(cmd, { cwd: import.meta.dirname, timeout: 5000 }).toString().trim(); } catch { return null; } };
  let assetV = null;
  try { assetV = Number((fs.readFileSync(path.join(import.meta.dirname, 'public', 'index.html'), 'utf8').match(/app\.js\?v=(\d+)/) || [])[1]) || null; } catch { }
  return {
    assetV,
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
app.get('/api/about', requireAuth, (_req, res) => res.json({
  ...ABOUT, uptime: process.uptime(),
  cli: binVersion(CLAUDE_BIN), codex: CODEX_ON ? binVersion(codex.CODEX_BIN) : null,
}));

app.listen(PORT, '127.0.0.1', () => log(`pocket-claude listening on 127.0.0.1:${PORT}`));
