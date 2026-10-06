// usage.mjs — usage visibility (Feature G).
//
// Two things worth showing on a phone that only talks to the CLI through stream-json:
//   (a) the account-level rate-limit snapshot the CLI reports on every turn
//       (`rate_limit_event` lines — five_hour / seven_day / seven_day_overage_included
//       windows; there is no monthly window, only the extra-usage dollar cap, which the
//       CLI never reports), and
//   (b) how much of the model's context window the session has used, from the last
//       assistant message's token usage plus the result's modelUsage for the turn's main
//       model (Haiku side-calls are ignored).
//
// Both only change when a turn actually runs, so everything persisted here carries an
// `observedAt`/`lastAt` timestamp and the UI must say "as of <time>", not imply it is live.
import fs from 'node:fs';
import path from 'node:path';

const WINDOW_KEYS = ['five_hour', 'seven_day', 'seven_day_overage_included'];

export function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// A model id/label implies a 1M window when it carries the "[1m]" CLI suffix or an
// otherwise-labeled "1m"/"1-million" marker. Anything else defaults to 200k, unless the
// observed token count already blew past 200k (which only a 1M-window model allows).
function impliesMillionWindow(label) {
  return typeof label === 'string' && /\[1m\]|(?:^|[^a-z0-9])1m(?:[^a-z0-9]|$)|1[\s-]?million/i.test(label);
}
// The CLI names a 1M model "claude-opus-5-5[1m]", but the API (and so the transcript and streamed lines)
// calls it "claude-opus-5-5". Compare models without the suffix.
const baseModel = m => String(m || '').replace(/\[1m\]$/i, '');
export function estimateWindow(label, totalTokens = 0) {
  if (impliesMillionWindow(label)) return 1_000_000;
  if (totalTokens > 200_000) return 1_000_000;
  return 200_000;
}

// Which modelUsage entry is "the turn's main model": ignore Haiku side-calls (titling,
// slash-command helpers, etc.) and prefer whichever model the assistant lines in this
// turn actually used, if we saw one.
export function pickMainModel(modelUsage, preferredModel) {
  if (!modelUsage || typeof modelUsage !== 'object') return null;
  const keys = Object.keys(modelUsage);
  if (!keys.length) return null;
  if (preferredModel && modelUsage[preferredModel]) return preferredModel;
  const bare = s => String(s).replace(/\[1m\]$/i, '');
  const sameModel = preferredModel && keys.find(k => bare(k) === bare(preferredModel));
  if (sameModel) return sameModel;
  const nonHaiku = keys.filter(k => !/haiku/i.test(k));
  return nonHaiku[0] || keys[0];
}

export function contextTotal(u) {
  if (!u) return 0;
  return (u.inputTokens ?? u.input_tokens ?? 0)
    + (u.cacheReadInputTokens ?? u.cache_read_input_tokens ?? 0)
    + (u.cacheCreationInputTokens ?? u.cache_creation_input_tokens ?? 0);
}

export class UsageStore {
  constructor(file) {
    this.file = file;
    try { this.state = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { this.state = { account: null, sessions: {} }; }
    this.state.account ??= null;
    this.state.sessions ??= {};
  }

  save() { try { atomicWrite(this.file, this.state); } catch { /* best effort — usage is a convenience view */ } }

  // Called once per stream-json line (and safe to call on every line: everything not
  // recognized is a no-op). `sessionId` is the Pocket-owned session the line belongs to.
  observe(sessionId, o) {
    if (!o || typeof o !== 'object') return null;
    if (o.type === 'rate_limit_event' && o.rate_limit_info) {
      const info = o.rate_limit_info;
      const windows = {};
      for (const key of WINDOW_KEYS) {
        const w = info.unifiedWindows?.[key];
        if (w) windows[key] = { utilization: w.utilization, resetsAt: w.resetsAt ? w.resetsAt * 1000 : null };
      }
      this.state.account = {
        status: info.status, windows,
        overage: { using: Boolean(info.isUsingOverage), status: info.overageStatus ?? null, reason: info.overageDisabledReason ?? null },
        observedAt: Date.now(),
      };
      this.save();
      return { kind: 'account' };
    }
    if (o.type === 'assistant' && o.message?.usage && sessionId) {
      const total = contextTotal(o.message.usage);
      const prev = this.state.sessions[sessionId];
      this.state.sessions[sessionId] = { ...prev, total, model: o.message.model || prev?.model, lastAt: Date.now(), estimated: true };
      this.save();
      return { kind: 'session-partial' };
    }
    if (o.type === 'result' && o.modelUsage && sessionId) {
      // modelUsage sums every API call of the turn (verified on CLI 2.1.281: a 19-call turn
      // reported 30M input tokens against a 506k context), so it is NOT the context size.
      // The context is the last assistant line's input (+cache) recorded above; the
      // result only contributes the model's real contextWindow and its name.
      const prev = this.state.sessions[sessionId];
      const mainModel = pickMainModel(o.modelUsage, prev?.model);
      const mu = mainModel && o.modelUsage[mainModel];
      if (!mu) return null;
      const total = Number.isFinite(prev?.total) ? prev.total : contextTotal(mu);
      const window = mu.contextWindow || estimateWindow(mainModel, total);
      // reportedWindow: the CLI's own figure. Estimates never replace it while the session stays on that model.
      this.state.sessions[sessionId] = { total, window, model: mainModel, estimated: !mu.contextWindow || !Number.isFinite(prev?.total), lastAt: Date.now(),
        reportedWindow: mu.contextWindow || (baseModel(prev?.model) === baseModel(mainModel) ? prev?.reportedWindow : undefined) };
      this.save();
      return { kind: 'session' };
    }
    return null;
  }

  // Record context observed from a provider that doesn't speak stream-json (Codex) or
  // was computed from a transcript tail for a session Pocket never drove.
  recordContext(sessionId, { total, window, model, estimated = false }) {
    if (!sessionId || !Number.isFinite(total)) return;
    const prev = this.state.sessions[sessionId];
    // A transcript estimate only knows "claude-opus-5-5", so it guesses 200k for a 1M session under 200k used.
    // Keep the window the CLI reported for this model instead (2026-10-06: the ring showed 164k of 200k).
    const reported = prev?.reportedWindow && baseModel(prev.model) === baseModel(model) ? prev.reportedWindow : undefined;
    this.state.sessions[sessionId] = { total, window: reported || window || estimateWindow(model, total), model, estimated, lastAt: Date.now(), reportedWindow: reported };
    this.save();
  }

  account() { return this.state.account; }
  rawSession(sessionId) { return this.state.sessions[sessionId] || null; }

  // Public shape for the API/UI: used/window/pct plus the estimated flag.
  sessionSummary(sessionId) {
    const rec = this.state.sessions[sessionId];
    if (!rec || !Number.isFinite(rec.total)) return null;
    const window = rec.window || estimateWindow(rec.model, rec.total);
    return {
      used: rec.total, window, pct: window ? Math.min(1, rec.total / window) : 0,
      estimated: Boolean(rec.estimated || !rec.window), model: rec.model || null, lastAt: rec.lastAt || null,
    };
  }

  accountSummary() {
    const a = this.state.account;
    if (!a) return null;
    return { status: a.status, windows: a.windows, overage: a.overage, observedAt: a.observedAt };
  }
}

// ---------- transcript fallback ----------
// For a session Pocket never drove a turn for (or a server restart lost the in-memory
// record), compute context from the last assistant line's usage in the transcript tail —
// the same shape `~/.claude/projects/<proj>/<id>.jsonl` carries for every CLI surface.
export async function contextFromTranscriptTail(file, fsp, { maxBytes = 512 * 1024 } = {}) {
  let size; try { size = (await fsp.stat(file)).size; } catch { return null; }
  const start = Math.max(0, size - maxBytes);
  const fh = await fsp.open(file, 'r');
  let text;
  try {
    const buf = Buffer.alloc(size - start);
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    text = buf.toString('utf8', 0, bytesRead);
  } finally { await fh.close(); }
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"usage"')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== 'assistant' || !o.message?.usage) continue;
    const total = contextTotal(o.message.usage);
    const model = o.message.model;
    return { total, window: estimateWindow(model, total), model, estimated: true };
  }
  return null;
}

// Best-effort context lookup used by the API route: prefer the live/persisted record,
// fall back to a transcript read, and label the fallback estimated either way.
// modelHint: the model Pocket started this session's process with ("claude-opus-5-5[1m]"), which knows the
// window when the transcript's model name does not.
export async function getSessionContext(store, sessionId, { transcriptFile, fsp, modelHint } = {}) {
  const have = store.sessionSummary(sessionId);
  if (have && !have.estimated) return have;
  if (!transcriptFile || !fsp) return have;
  // An estimated record came from the transcript (or a turn run elsewhere): recompute
  // when the transcript has moved on since, so the meter follows terminal turns too.
  if (have) { try { if ((await fsp.stat(transcriptFile)).mtimeMs <= (have.lastAt || 0)) return have; } catch { return have; } }
  const fallback = await contextFromTranscriptTail(transcriptFile, fsp).catch(() => null);
  if (!fallback) return have;
  if (modelHint && baseModel(modelHint) === baseModel(fallback.model)) fallback.window = estimateWindow(modelHint, fallback.total);
  store.recordContext(sessionId, fallback);
  return store.sessionSummary(sessionId);
}
