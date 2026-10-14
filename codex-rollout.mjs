// codex-rollout.mjs — context size and prompt-cache warmth for a Codex thread, read from the
// rollout file Codex writes (`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<time>-<threadId>.jsonl`).
//
// Every model call lands there as an `event_msg` of type `token_count`, whose
// `last_token_usage` is this call's breakdown. Two things about Codex's figures differ from
// Claude's and matter here:
//
//   - `input_tokens` already includes `cached_input_tokens`. The cached figure is a subset,
//     not a separate bucket the way Claude's `cache_read_input_tokens` is. The context in use
//     is the input alone; input plus cached counts nearly the whole context twice.
//   - Codex reports no cache lifetime. OpenAI's published guidance is five to ten minutes;
//     measured over 45,660 consecutive calls in 2,234 rollouts on brads-server (2026-10-14),
//     every return after an idle gap of 60 to 120 minutes still read from cache (21 of 21),
//     and every return after 150 minutes or more started cold (12 of 15, the rest partial).
//     Pocket uses two hours and the panel says it is measured, not published.
//
// The rollout is the source of truth: it covers threads run outside Pocket (code-server, a
// terminal) and corrects context figures saved by builds that double-counted. The in-memory
// figure from `thread/tokenUsage/updated` fills in only when no rollout can be read.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const TTL_CODEX = 2 * 60 * 60_000;
export const TTL_CODEX_NOTE = 'measured; not published';
const num = v => (Number.isFinite(v) ? v : 0);

// Both spellings: the app-server's tokenUsage notification is camelCase, the rollout file snake_case.
export const contextUsed = last => num(last?.inputTokens ?? last?.input_tokens);
export const cachedTokens = last => Math.min(num(last?.cachedInputTokens ?? last?.cached_input_tokens), contextUsed(last));

// Scan rollout lines (oldest first) for the last call's context and the first call of the last turn.
// Returns null when no call carries token figures.
export function scanRollout(lines) {
  let model = null, window = null, last = null, lastAt = null, turnFirst = null, turnAt = null, awaiting = false;
  for (const line of lines) {
    if (!line || (!line.includes('token_count') && !line.includes('task_started') && !line.includes('turn_context'))) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const p = o?.payload;
    if (o?.type === 'turn_context') { if (p?.model) model = p.model; continue; }
    if (o?.type !== 'event_msg' || !p) continue;
    if (p.type === 'task_started') { awaiting = true; if (p.model_context_window > 0) window = p.model_context_window; continue; }
    if (p.type !== 'token_count' || !p.info) continue;
    const l = p.info.last_token_usage, used = contextUsed(l), cached = cachedTokens(l), ts = Date.parse(o.timestamp);
    if (!(used > 0) || !Number.isFinite(ts)) continue;
    if (p.info.model_context_window > 0) window = p.info.model_context_window;
    last = { used, cached }; lastAt = ts;
    if (awaiting) { turnFirst = last; turnAt = ts; awaiting = false; }
  }
  if (!last) return null;
  return {
    context: { used: last.used, window, model, at: lastAt },
    // `cached` is what a cold turn processes again: the whole prompt, same as Claude's read + written.
    cache: {
      at: lastAt, ttlMs: TTL_CODEX, ttlKnown: false, ttlNote: TTL_CODEX_NOTE, cached: last.used,
      lastTurn: turnFirst ? { at: turnAt, read: turnFirst.cached, written: turnFirst.used - turnFirst.cached, input: 0, hit: turnFirst.cached / turnFirst.used } : null,
    },
  };
}

// ---------- locating a thread's rollout ----------
const defaultDir = () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
const FILE_RE = /rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const RESCAN_MS = 15_000;
const indexes = new Map(); // dir -> { at, files: Map<threadId, path> }

async function indexDir(dir, fsp) {
  const files = new Map();
  let names = [];
  try { names = await fsp.readdir(dir, { recursive: true }); } catch { /* no sessions yet */ }
  for (const name of names) {
    const m = FILE_RE.exec(String(name));
    if (m) files.set(m[1].toLowerCase(), path.join(dir, String(name)));
  }
  const idx = { at: Date.now(), files };
  indexes.set(dir, idx);
  return idx;
}

// A thread written after the last scan is found by rescanning, at most once per RESCAN_MS, so a
// burst of lookups for unknown ids (archived threads) does not walk the store each time.
export async function findRolloutFile(threadId, { dir = defaultDir(), fsp = fs } = {}) {
  const id = String(threadId || '').toLowerCase();
  if (!id) return null;
  let idx = indexes.get(dir) || await indexDir(dir, fsp);
  if (!idx.files.has(id) && Date.now() - idx.at > RESCAN_MS) idx = await indexDir(dir, fsp);
  return idx.files.get(id) || null;
}

// The tail is enough: the last call is at the end, and a turn that started further back than the
// window simply reports no last-turn figure. Memoised on the file's mtime and size.
const memo = new Map(); // file + tail size -> { mtimeMs, size, value }
export async function rolloutState(threadId, { maxBytes = 1024 * 1024, dir, fsp = fs } = {}) {
  const file = await findRolloutFile(threadId, { dir, fsp });
  if (!file) return null;
  let st; try { st = await fsp.stat(file); } catch { return null; }
  const key = file + '\0' + maxBytes, hit = memo.get(key);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.value;
  const start = Math.max(0, st.size - maxBytes);
  let text = '';
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(st.size - start);
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    text = buf.toString('utf8', 0, bytesRead);
  } finally { await fh.close(); }
  const lines = text.split('\n'); if (start > 0) lines.shift(); // first line is partial
  const value = scanRollout(lines);
  memo.set(key, { mtimeMs: st.mtimeMs, size: st.size, value });
  if (memo.size > 500) memo.delete(memo.keys().next().value);
  return value;
}
