// 1.119: check-backs (docs/plans/unattended-work.md, Part 2). A conversation, asked by the owner, schedules one later
// reply in itself ("check the page in 15 minutes and tell me"). This file is the store (checkbacks.json, written
// atomically like tasks.json) and the pure helpers: reading the time an agent gives, and the message the later reply
// starts with. Who may set one, the limits, the gate and the start are the server's (server.mjs, "check-backs").
//
// An entry: { id, sessionId, engine, note, dueAt, createdAt, createdByTurn: { startedAt, origin, originRef? },
//   chainDepth (0 for one the owner asked for), run: { approvalMode, model, effort, executionMode } (the reply that set
//   it), status, held?: { reason, since, until? }, heldReasons (each reason audited once), busySince?, startedAt?,
//   outcome?: { at, kind, summary } }.
// status: pending (waiting for its time) · held (due or paused, and something holds it: Pause all, a plan ceiling, the
// daily count, a busy conversation) · running (marked before anything starts, so a crash never runs it twice) · done ·
// missed · cancelled.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseWhen } from './projects.mjs';
import { shellArg } from './skills.mjs';
import { readStore } from './store-file.mjs';

export const STATUSES = ['pending', 'held', 'running', 'done', 'missed', 'cancelled'];
export const ACTIVE = new Set(['pending', 'held', 'running']);
// Finished entries are kept for the chat's cards and the list for this long, and at most this many.
export const KEEP = { finishedMs: 30 * 86400_000, finished: 300 };
const SESSION_RE = /^(cx:|acp:)?[0-9A-Za-z_-]{6,80}$/;
const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const newId = () => 'cb-' + randomBytes(4).toString('hex');

// ---------- time ----------
// "+15m", "+2h", "+1d" (also "+15 min", "+2 hours"), or what parseWhen reads ("2026-11-22 09:00" in the owner's zone, or
// an ISO time with an offset). -> ms. Throws a plain error the command shows as it is.
const UNIT = { m: 60_000, h: 3600_000, d: 86400_000 };
export function parseCheckbackWhen(input, { now = Date.now(), zone } = {}) {
  const s = String(input ?? '').trim();
  if (!s) throw fail('Say when: --at "+15m", "+2h", "+1d" or "2026-11-22 09:00" (your time zone).');
  const rel = /^\+\s*(\d{1,6})\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?)$/i.exec(s);
  if (rel) return now + Number(rel[1]) * UNIT[rel[2][0].toLowerCase()];
  try { return Date.parse(parseWhen(s, zone || undefined)); }
  catch { throw fail('Use a time like "+15m", "+2h", "+1d" or "2026-11-22 09:00" (your time zone). Convert a day name such as Friday to its date.'); }
}
// "1 minute", "90 days", "36 hours".
export function spanText(ms) {
  const plural = (n, w) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;
  if (ms % 86400_000 === 0) return plural(ms / 86400_000, 'day');
  if (ms % 3600_000 === 0) return plural(ms / 3600_000, 'hour');
  return plural(Math.round(ms / 60_000), 'minute');
}
// How late, in words: "40 minutes", "3 h 10 min", "2 days 4 h".
export function lateText(ms) {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'}`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24), hh = h % 24;
  return hh ? `${d} days ${hh} h` : `${d} days`;
}
// Within the owner's limits? -> null, or the refusal naming the range.
export function rangeError(dueAt, { now = Date.now(), soonestMin, furthestHours }) {
  const lo = soonestMin * 60_000, hi = furthestHours * 3600_000;
  if (!Number.isFinite(dueAt) || dueAt - now < lo - 1000 || dueAt - now > hi) return `A check-back can be set from ${spanText(lo)} to ${spanText(hi)} ahead.`;
  return null;
}

// ---------- the message the check-back reply starts with ----------
// fmt formats a time in the owner's zone. `late` is ms late beyond the tick's own slack (0: on time).
export function checkbackMessage(cb, { now = Date.now(), fmt, chainLimit, late = 0 }) {
  const n = (cb.chainDepth || 0) + 1, of = (Number(chainLimit) || 0) + 1;
  const who = cb.chainDepth ? 'by an earlier check-back' : 'at your request';
  const more = cb.chainDepth < chainLimit
    ? 'If it isn\'t settled yet you may set one more check-back; say when.'
    : 'This is the last check-back this chain may set. If it isn\'t settled, say what is still open so the owner can decide.';
  const lateLine = late > 0 ? ` This check-back was due at ${fmt(Date.parse(cb.dueAt))} and runs ${lateText(late)} late.` : '';
  return [
    `[Pocket check-back · set at ${fmt(Date.parse(cb.createdAt))} ${who} · ${n} of ${of}]`,
    `What to check: ${cb.note}`,
    `It is now ${fmt(now)}.${lateLine} Do the check and reply briefly with the result. ${more}`,
  ].join('\n');
}

// The first line of a reply, for the push: the last message with text (the result usually comes after the working
// notes), its first line that has words, without Markdown marks.
export function firstLine(msgs, max = 160) {
  const texts = (Array.isArray(msgs) ? msgs : []).map(m => (Array.isArray(m?.blocks) ? m.blocks : []).filter(b => b?.t === 'text').map(b => String(b.text || '')).join('\n')).filter(t => t.trim());
  const last = texts.at(-1) || '';
  const line = last.split('\n').map(l => l.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s*|\d+\.\s+)/, '').replace(/[*_`]+/g, '').trim()).find(l => l && !/^```/.test(l)) || '';
  return line.length > max ? line.slice(0, max - 1).trimEnd() + '…' : line;
}

// ---------- the agent's instructions while check-backs are on ----------
export function checkbackInstructions(script, engine) {
  const cli = shellArg(script), skill = path.join(path.dirname(path.dirname(script)), 'skills', 'pocket-checkback', 'SKILL.md');
  return [
    'This Pocket Code can check back: this conversation takes one more turn later, at a time the user asked for, and Pocket tells the user the result.',
    'Set a check-back only when the user asked for one in this conversation ("check back", "look again in 15 minutes", "let me know when it is live") or accepted your offer of one.',
    `Then run \`node ${cli} add --at "+15m" --note "<what to check and what done looks like>"\` (also "+2h", "+1d", or "YYYY-MM-DD HH:MM" in the user's time zone), say when it will check back, and end your reply.`,
    'When the work will need this conversation to look again later and the user did not ask, offer it once as a suggested reply that names when ("Check back in 15 minutes"); never set one the user did not ask for or accept.',
    'A task is still right when the user has to do something themselves.',
    engine === 'codex' ? 'In Codex a check-back works only under Full access; under Review actions the command cannot reach Pocket, so say so and offer a task instead.' : '',
    `\`list\` shows this conversation's check-backs and \`cancel <id>\` cancels one. The pocket-checkback skill (\`${skill}\`) has the procedure.`,
  ].filter(Boolean).join(' ');
}

// ---------- the store ----------
export class CheckbackStore {
  constructor(file, { write, now, log } = {}) {
    this.file = file;
    this.now = now || Date.now;
    this.write = write || ((f, data) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 }); fs.renameSync(tmp, f); });
    const d = readStore(file, { log, now: this.now }); // 1.124.3: one that does not parse is kept aside and logged
    this.items = Array.isArray(d.checkbacks) ? d.checkbacks.filter(c => c && typeof c.id === 'string' && typeof c.sessionId === 'string' && STATUSES.includes(c.status) && !Number.isNaN(Date.parse(c.dueAt))).map(c => this.normalize(c)) : [];
  }
  normalize(c) {
    return { ...c, note: String(c.note || ''), chainDepth: Number.isInteger(c.chainDepth) && c.chainDepth >= 0 ? c.chainDepth : 0, run: c.run && typeof c.run === 'object' ? c.run : {},
      heldReasons: Array.isArray(c.heldReasons) ? c.heldReasons : [] };
  }
  // A change is computed on a copy, written, and installed only once the file holds it; a failed write changes nothing.
  commit(items) {
    const now = this.now(), finished = items.filter(c => !ACTIVE.has(c.status));
    const keep = new Set(finished.filter(c => now - Date.parse(c.outcome?.at || c.createdAt) < KEEP.finishedMs)
      .sort((a, b) => Date.parse(b.outcome?.at || b.createdAt) - Date.parse(a.outcome?.at || a.createdAt)).slice(0, KEEP.finished));
    const next = items.filter(c => ACTIVE.has(c.status) || keep.has(c));
    this.write(this.file, { version: 1, checkbacks: next });
    this.items = next;
  }
  get(id) { return this.items.find(c => c.id === id) || null; }
  must(id) { const c = this.get(id); if (!c) throw fail('There is no check-back with that id.', 404); return c; }
  active() { return this.items.filter(c => ACTIVE.has(c.status)); }
  waiting() { return this.items.filter(c => c.status === 'pending' || c.status === 'held'); }
  forSession(id) { return this.items.filter(c => c.sessionId === id); }
  // title: the conversation's title when it was set (1.124.4: in this one save; a second save for it could fail after the first).
  add({ sessionId, engine, note, dueAt, createdByTurn, chainDepth = 0, run = {}, status = 'pending', held = null, title = '' }) {
    if (!SESSION_RE.test(String(sessionId || ''))) throw fail('That is not a conversation id.');
    const at = iso(this.now());
    const c = { id: newId(), sessionId, engine, note, dueAt: iso(dueAt), createdAt: at, createdByTurn: createdByTurn || null, chainDepth, run,
      status, ...(held ? { held } : {}), heldReasons: [], ...(title ? { title } : {}) };
    while (this.get(c.id)) c.id = newId();
    this.commit([...this.items, c]);
    return c;
  }
  // patch: fields to set; a field set to undefined is removed.
  update(id, patch) {
    const live = this.must(id), c = { ...live, ...patch };
    for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
    this.commit(this.items.map(x => x === live ? c : x));
    return c;
  }
  // The finish of a check-back's reply, an owner's or agent's cancel, a miss: the outcome and the end status at once.
  finish(id, status, kind, summary = '') {
    return this.update(id, { status, outcome: { at: iso(this.now()), kind, ...(summary ? { summary } : {}) }, held: undefined, busySince: undefined });
  }
}

// What the app and the command see of one check-back: no field that moves between list refreshes when nothing changed.
export function view(c) {
  return {
    id: c.id, sessionId: c.sessionId, engine: c.engine, note: c.note, dueAt: c.dueAt, createdAt: c.createdAt, status: c.status, chainDepth: c.chainDepth,
    turnStartedAt: c.createdByTurn?.startedAt || null,
    ...(c.held ? { held: { reason: c.held.reason, since: c.held.since, ...(c.held.until ? { until: c.held.until } : {}) } } : {}),
    ...(c.startedAt ? { startedAt: c.startedAt } : {}),
    ...(c.outcome ? { outcome: { ...c.outcome } } : {}),
  };
}
