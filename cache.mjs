// cache.mjs — prompt-cache warmth (1.28).
//
// Every main-thread assistant line in a Claude transcript carries the request's cache
// figures: how many prompt tokens were read from cache, how many were written, and (since
// the CLI split them) which lifetime the writes used — `ephemeral_1h_input_tokens` or
// `ephemeral_5m_input_tokens`. A cached prefix stays alive for its lifetime after the last
// request that used it, so the last request's time plus that lifetime estimates when the
// next turn stops being a cheap cache read and becomes a full cache write.
//
// This is an estimate, never an observation: the provider can evict earlier, and a request
// in flight at the moment of reading is not in the transcript yet. The UI says so.
import fs from 'node:fs/promises';

export const TTL_5M = 5 * 60_000;
export const TTL_1H = 60 * 60_000;
const num = v => (Number.isFinite(v) ? v : 0);

// Figures for one request. ttlMs is null when the line wrote nothing (pure read: the
// lifetime is whatever the prefix was written with) or predates the split (ttlKnown false).
export function cacheFromUsage(u) {
  if (!u || typeof u !== 'object') return null;
  const read = num(u.cache_read_input_tokens), written = num(u.cache_creation_input_tokens), input = num(u.input_tokens);
  const split = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation : null;
  let ttlMs = null;
  if (split) {
    const long = num(split.ephemeral_1h_input_tokens), short = num(split.ephemeral_5m_input_tokens);
    // Mixed writes: the 5-minute part is the end of the prompt, so it expires first and the next
    // turn rewrites it. Report the shorter lifetime rather than promise the longer one.
    if (short > 0) ttlMs = TTL_5M; else if (long > 0) ttlMs = TTL_1H;
  }
  return { read, written, input, ttlMs, split: Boolean(split) };
}

// Share of the request's prompt that came from cache: 1 = fully warm, ~0 = cold start.
export function hitShare(c) {
  const total = c ? c.read + c.written + c.input : 0;
  return total > 0 ? c.read / total : null;
}

const isMainAssistant = o => o?.type === 'assistant' && !o.isSidechain && o.message?.usage && o.message.model !== '<synthetic>';
// A person's message (or a steer), not a tool result or a CLI meta line.
function isPrompt(o) {
  if (o?.type !== 'user' || o.isSidechain || o.isMeta || o.isCompactSummary) return false;
  const c = o.message?.content;
  if (typeof c === 'string') return !c.startsWith('<command-') && !c.startsWith('<local-command');
  return Array.isArray(c) && c.some(b => b?.type === 'text') && !c.some(b => b?.type === 'tool_result');
}

// Scan transcript lines (oldest first) for the cache state after the last request and the
// first request of the last turn. Returns null when no main-thread request carries usage.
export function scanCache(lines) {
  let last = null, lastTs = null, ttlMs = null, ttlKnown = false, model = null;
  let turnFirst = null, turnAt = null, awaitingFirst = false, sawPrompt = false;
  for (const line of lines) {
    if (!line || (!line.includes('"usage"') && !line.includes('"user"'))) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (isPrompt(o)) { awaitingFirst = true; sawPrompt = true; continue; }
    if (!isMainAssistant(o)) continue;
    const c = cacheFromUsage(o.message.usage);
    const ts = Date.parse(o.timestamp);
    if (!c || !Number.isFinite(ts)) continue;
    // A streamed message is logged once per content block with the same usage: count the request once.
    if (last && o.message.id && o.message.id === last.id) { lastTs = Math.max(lastTs, ts); continue; }
    if (c.ttlMs) { ttlMs = c.ttlMs; ttlKnown = true; }
    last = { ...c, id: o.message.id || null }; lastTs = ts; model = o.message.model || model;
    if (awaitingFirst) { turnFirst = c; turnAt = ts; awaitingFirst = false; }
  }
  if (!last) return null;
  // No lifetime seen (an old CLI, or only pure reads in view): the API default is five minutes.
  return {
    at: lastTs, ttlMs: ttlMs || TTL_5M, ttlKnown, model,
    cached: last.read + last.written,
    lastTurn: sawPrompt && turnFirst ? { at: turnAt, read: turnFirst.read, written: turnFirst.written, input: turnFirst.input, hit: hitShare(turnFirst) } : null,
  };
}

// The transcript tail is enough: the last request is near the end, and a turn that started
// further back than this window simply reports no last-turn figure.
const memo = new Map(); // file + tail size -> { mtimeMs, size, value }
export async function cacheFromTranscript(file, { maxBytes = 1024 * 1024, fsp = fs } = {}) {
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
  const value = scanCache(lines);
  memo.set(key, { mtimeMs: st.mtimeMs, size: st.size, value });
  if (memo.size > 500) memo.delete(memo.keys().next().value);
  return value;
}

// The per-turn figure the live stream reports with the result line: the turn's first
// request is the one that shows whether the session resumed warm or cold.
export function turnCacheSummary(usage) {
  const c = cacheFromUsage(usage);
  if (!c) return null;
  const hit = hitShare(c);
  return hit == null ? null : { hit, read: c.read, written: c.written };
}
