// 1.117: unattended work foundation (docs/plans/unattended-work.md, Part 1).
// What started a turn (its origin), the owner's Automation settings (Pause all and the limits on unattended work),
// the gate every unattended start passes through, the day's counts and the audit file. Pure where it can be: the
// gate takes its state as an argument so it is unit-tested without a server (test/automation.test.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './usage.mjs';

// ---------- origin ----------
// `origin` is what started this turn; `rootOrigin` is who asked for the work in the first place (a retry carries the
// root of the turn it retries, a queue row the origin of whoever wrote it). Only `owner` is attended.
export const ORIGINS = ['owner', 'queue', 'retry', 'coordination', 'checkback', 'job'];
export const ROOT_ORIGINS = ['owner', 'checkback', 'job'];
const LABELS = { queue: 'Queued message', retry: 'Continued after a usage limit', coordination: 'Woken by a hold', checkback: 'Started by a check-back' };
export const normOrigin = o => ORIGINS.includes(o) ? o : 'owner';
export const normRoot = o => ROOT_ORIGINS.includes(o) ? o : 'owner';
// The words the app and the push show for a turn the owner did not start; null for owner.
export function originLabel(origin, ref) {
  if (!origin || origin === 'owner') return null;
  if (origin === 'job') return `Started by job ${ref || ''}`.trim();
  return LABELS[origin] || null;
}

// ---------- settings schema ----------
// One group per feature; adding check-backs or job keys later is a new entry here, not new code. Each setting:
// key, label, help, type ('choice' | 'bool' | 'number'), default, and for numbers min/max/step/unit/offAllowed/integer;
// for choices the list. `env` names extra preset variables (POCKET_AUTOMATION_<NAME>) besides the one derived from the key.
const pct = (key, label, dflt, env) => ({ key, label, type: 'number', default: dflt, min: 10, max: 100, step: 1, unit: '%', integer: true, offAllowed: true, env });
export const GROUPS = [
  {
    key: 'pause', title: 'Pause all', settings: [
      { key: 'ownMessages', label: 'Your own messages while paused', type: 'choice', default: 'run',
        choices: [{ value: 'run', label: 'Run, with a banner' }, { value: 'blocked', label: 'Blocked until you resume' }] },
      { key: 'inboxWatch', label: 'Pause all also pauses Inbox Watch', type: 'bool', default: true },
      { key: 'rearmRetries', label: 'On Resume, re-arm held usage-limit retries', type: 'bool', default: true,
        help: 'Off: they stay held until you start them.' },
      { key: 'confirm', label: 'Show what will stop before pausing', type: 'bool', default: true,
        help: 'Off: Pause all pauses on one tap.' },
    ],
  },
  {
    key: 'limits', title: 'Limits on unattended work', settings: [
      pct('claudeWeekly', 'Plan ceiling, weekly (Claude Code)', 80, ['CLAUDE_WEEKLY_CEILING', 'WEEKLY_CEILING']),
      pct('claudeFiveHour', 'Plan ceiling, 5-hour (Claude Code)', 90, ['CLAUDE_FIVE_HOUR_CEILING', 'FIVE_HOUR_CEILING']),
      pct('codexWeekly', 'Plan ceiling, weekly (Codex)', 80, ['CODEX_WEEKLY_CEILING', 'WEEKLY_CEILING']),
      pct('codexFiveHour', 'Plan ceiling, 5-hour (Codex)', 90, ['CODEX_FIVE_HOUR_CEILING', 'FIVE_HOUR_CEILING']),
      { key: 'dailyReplies', label: 'Unattended replies per day', type: 'number', default: 40, min: 1, max: 1000, step: 1, unit: '', integer: true, offAllowed: true,
        help: 'Counted in your time zone. Check-back and job replies always count.' },
      { key: 'countOwnerWork', label: 'Count queue drains, retries and coordination wakes toward the daily limit', type: 'bool', default: false,
        help: 'Off: work you asked for yourself does not use up the daily limit.' },
      { key: 'ceilingsHoldOwnerWork', label: 'Plan ceilings also hold queued messages, retries and coordination wakes', type: 'bool', default: false,
        help: 'Off: the ceilings hold only check-backs and jobs.' },
      { key: 'openrouterDaily', label: 'OpenRouter spend per day (unattended)', type: 'number', default: 5, min: 0.5, max: 500, step: 0.5, unit: '$', offAllowed: true },
      { key: 'longestReply', label: 'Longest unattended reply', type: 'number', default: 60, min: 5, max: 480, step: 5, unit: 'min', integer: true, offAllowed: true,
        help: 'The one limit that stops a running reply: a check-back or job reply still running at this is stopped.' },
      { key: 'countWaiting', label: 'Count time waiting on an approval or question toward the longest reply', type: 'bool', default: false },
      { key: 'notice', label: 'Notice when a limit is reached', type: 'choice', default: 'push',
        choices: [{ value: 'push', label: 'Push and Settings, once per reason per day' }, { value: 'settings', label: 'Settings only' }] },
      { key: 'staleHours', label: 'Treat a plan reading older than this as stale', type: 'number', default: 6, min: 1, max: 24, step: 1, unit: 'h', integer: true, advanced: true,
        help: 'A Claude reading this old does not hold work back; the reply that runs refreshes it.' },
    ],
  },
];
const GROUP = Object.fromEntries(GROUPS.map(g => [g.key, g]));
const camelToEnv = k => k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
export const envNames = s => [camelToEnv(s.key), ...(s.env || [])].map(n => 'POCKET_AUTOMATION_' + n);

const fmtNum = (s, v) => s.unit === '$' ? `$${Number(v).toFixed(2).replace(/\.00$/, '')}` : `${Number(v).toLocaleString('en-US')}${s.unit === '%' ? '%' : s.unit ? ' ' + s.unit : ''}`;
// "10% to 100%, or No limit", "$0.50 to $500, or No limit", "5 min to 480 min, or No limit", "1 h to 24 h". The stored
// and API value for a limit that is switched off stays 'off'; the words match the app's No limit button.
export function rangeText(s) {
  if (s.type === 'bool') return 'On or Off';
  if (s.type === 'choice') return s.choices.map(c => `'${c.value}'`).join(' or ');
  const lo = s.unit === '$' ? `$${s.min.toFixed(2)}` : fmtNum(s, s.min);
  return `${lo} to ${fmtNum(s, s.max)}${s.offAllowed ? ', or No limit' : ''}`;
}
// One value checked against its setting: { value } (normalized) or { error } naming the allowed range.
export function checkValue(s, v) {
  const bad = () => ({ error: `${s.label} must be ${rangeText(s)}.` });
  if (s.type === 'bool') return typeof v === 'boolean' ? { value: v } : bad();
  if (s.type === 'choice') return s.choices.some(c => c.value === v) ? { value: v } : bad();
  if (v === 'off') return s.offAllowed ? { value: 'off' } : bad();
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < s.min || n > s.max) return bad();
  if (s.integer && !Number.isInteger(n)) return bad();
  return { value: s.unit === '$' ? Math.round(n * 100) / 100 : n };
}
// The preset an install's env sets for one setting (first valid name wins); a bad value is ignored with a warning.
function presetOf(s, env, warnings) {
  for (const name of envNames(s)) {
    const raw = env[name];
    if (raw == null || raw === '') continue;
    let v = String(raw).trim();
    if (s.type === 'bool') v = /^(1|true|yes|on)$/i.test(v) ? true : /^(0|false|no|off)$/i.test(v) ? false : v;
    else if (/^off$/i.test(v)) v = 'off';
    const r = checkValue(s, v);
    if (r.error) { warnings?.push(`${name} is ignored: ${r.error}`); continue; }
    return { value: r.value, name };
  }
  return null;
}
// Effective value of every setting in a group: saved, else env preset, else the default.
export function groupValues(saved, groupKey, env = process.env) {
  const g = GROUP[groupKey], out = {};
  for (const s of g.settings) {
    const sv = saved?.[groupKey]?.[s.key];
    if (sv !== undefined && !checkValue(s, sv).error) { out[s.key] = sv; continue; }
    const p = presetOf(s, env);
    out[s.key] = p ? p.value : s.default;
  }
  return out;
}
export const values = (saved, env = process.env) => Object.fromEntries(GROUPS.map(g => [g.key, groupValues(saved, g.key, env)]));

// A save from Settings: all or nothing. `values` maps keys to a value, 'off', or null (forget the saved value and use
// the preset or default). Returns { automation } (the new saved object; the input is not changed) or { error, status }.
export function applySave(saved, body) {
  const g = GROUP[body?.group];
  if (!g) return { error: `Unknown settings group. Use one of: ${GROUPS.map(x => x.key).join(', ')}.`, status: 400 };
  const next = JSON.parse(JSON.stringify(saved && typeof saved === 'object' ? saved : {}));
  if (body.reset === true) { delete next[g.key]; return { automation: next }; }
  const vals = body.values;
  if (!vals || typeof vals !== 'object' || Array.isArray(vals) || !Object.keys(vals).length) return { error: 'Send values to save, or reset: true.', status: 400 };
  const grp = { ...(next[g.key] || {}) };
  for (const [k, v] of Object.entries(vals)) {
    const s = g.settings.find(x => x.key === k);
    if (!s) return { error: `Unknown setting "${k}" in ${g.title}.`, status: 400 };
    if (v === null) { delete grp[k]; continue; }
    const r = checkValue(s, v);
    if (r.error) return { error: r.error, status: 400 };
    grp[k] = r.value;
  }
  if (Object.keys(grp).length) next[g.key] = grp; else delete next[g.key];
  return { automation: next };
}
// What Settings → Automation shows: each setting with its effective value and where it came from, plus warnings.
export function describe(saved, env = process.env) {
  const warnings = [];
  const groups = GROUPS.map(g => ({
    key: g.key, title: g.title,
    settings: g.settings.map(s => {
      const sv = saved?.[g.key]?.[s.key];
      const isSaved = sv !== undefined && !checkValue(s, sv).error;
      const p = presetOf(s, env, warnings);
      const value = isSaved ? sv : p ? p.value : s.default;
      const out = { key: s.key, label: s.label, type: s.type, value, default: s.default, saved: isSaved, preset: Boolean(p) };
      if (s.help) out.help = s.help;
      if (s.type === 'number') Object.assign(out, { min: s.min, max: s.max, step: s.step, unit: s.unit, offAllowed: Boolean(s.offAllowed) });
      if (s.type === 'choice') out.choices = s.choices.map(c => ({ ...c }));
      if (s.advanced) out.advanced = true;
      if (value === 'off') warnings.push(`${s.label} has no limit.`);
      return out;
    }),
  }));
  return { groups, warnings: [...new Set(warnings)] };
}

// ---------- the gate ----------
// Which limits hold this work: always for check-back and job work, and for owner-rooted queue drains, retries and
// coordination wakes only when the owner switched that on (both Off by default, so such work behaves as in 1.116).
export function limitsApply(rootOrigin, lim) {
  const unattendedRoot = rootOrigin === 'checkback' || rootOrigin === 'job';
  return { ceilings: unattendedRoot || lim.ceilingsHoldOwnerWork === true, daily: unattendedRoot || lim.countOwnerWork === true };
}
const WINDOW_LABEL = { weekly: 'weekly', five_hour: '5-hour' };
// A plan window over its ceiling, or null. Claude: usage.mjs accountSummary() (utilization 0..1, resetsAt ms); a reading
// older than the stale setting passes, because the reply refreshes it. Codex: codexRateLimits() read live (usedPercent,
// resetsAt in unix seconds, windowDurationMins). A window whose reset has passed passes.
export function ceilingHit(engine, reading, lim, now = Date.now()) {
  if (!reading) return null;
  if (engine === 'claude') {
    if (!reading.windows || !Number.isFinite(reading.observedAt) || now - reading.observedAt > lim.staleHours * 3600_000) return null;
    for (const [win, key, which] of [['seven_day', 'claudeWeekly', 'weekly'], ['five_hour', 'claudeFiveHour', 'five_hour']]) {
      const c = lim[key], w = reading.windows[win];
      if (c === 'off' || !w || !Number.isFinite(w.utilization)) continue;
      if (Number.isFinite(w.resetsAt) && w.resetsAt <= now) continue;
      const used = Math.round(w.utilization * 100);
      if (used >= c) return { engine, window: which, used, ceiling: c, until: Number.isFinite(w.resetsAt) ? w.resetsAt : undefined };
    }
    return null;
  }
  if (engine === 'codex') {
    for (const w of [reading.primary, reading.secondary]) {
      if (!w || !Number.isFinite(w.usedPercent)) continue;
      const which = (w.windowDurationMins || 0) >= 1440 ? 'weekly' : 'five_hour';
      const c = lim[which === 'weekly' ? 'codexWeekly' : 'codexFiveHour'];
      if (c === 'off') continue;
      const resetMs = Number.isFinite(w.resetsAt) ? w.resetsAt * 1000 : undefined;
      if (resetMs && resetMs <= now) continue;
      if (w.usedPercent >= c) return { engine, window: which, used: Math.round(w.usedPercent), ceiling: c, until: resetMs };
    }
  }
  return null;
}
// unattendedGate({ origin, originRef, rootOrigin, engine, sessionId }, ctx) -> { ok: true } | { ok: false, reason, until?, ... }
// ctx: { paused, ownBlocked, features: { checkback, job }, busy, limits (groupValues 'limits'), claude (accountSummary),
// codex (codexRateLimits), counts (state.counts()), nextDay (ms the owner's day ends), now }.
// Order: pause, feature, busy, plan ceiling, daily limit. Owner sends never call it; an owner origin passes unless
// paused with own messages Blocked.
export function unattendedGate(info, ctx) {
  const origin = normOrigin(info?.origin), root = normRoot(info?.rootOrigin ?? (ROOT_ORIGINS.includes(origin) ? origin : 'owner'));
  if (origin === 'owner') return ctx.paused && ctx.ownBlocked ? { ok: false, reason: 'paused' } : { ok: true };
  if (ctx.paused) return { ok: false, reason: 'paused' };
  for (const f of ['checkback', 'job']) if ((origin === f || root === f) && !ctx.features?.[f]) return { ok: false, reason: 'feature_off', feature: f };
  if (ctx.busy) return { ok: false, reason: 'busy' };
  const lim = ctx.limits, apply = limitsApply(root, lim), now = ctx.now ?? Date.now();
  if (apply.ceilings) {
    const hit = ceilingHit(info.engine, info.engine === 'claude' ? ctx.claude : info.engine === 'codex' ? ctx.codex : null, lim, now);
    if (hit) return { ok: false, reason: 'plan_ceiling', ...hit };
  }
  if (apply.daily) {
    const c = ctx.counts || {};
    const started = (c.startedRoot || 0) + (lim.countOwnerWork ? c.startedOwnerRoot || 0 : 0);
    if (lim.dailyReplies !== 'off' && started >= lim.dailyReplies) return { ok: false, reason: 'daily_limit', limit: 'replies', count: started, max: lim.dailyReplies, until: ctx.nextDay };
    const spent = (c.openrouterRoot || 0) + (lim.countOwnerWork ? c.openrouterOwnerRoot || 0 : 0);
    if (info.engine === 'acp' && lim.openrouterDaily !== 'off' && spent >= lim.openrouterDaily) return { ok: false, reason: 'daily_limit', limit: 'openrouter', spent, max: lim.openrouterDaily, until: ctx.nextDay };
  }
  return { ok: true };
}
const ENGINE_LABEL = { claude: 'Claude Code', codex: 'Codex', acp: 'OpenRouter' };
// The once-a-day notice key and words for a refusal. `fmtTime` formats a reset time in the owner's zone.
// The owner paused it themselves, so a refusal for pause (or a busy conversation, or a feature that is off) has no notice.
export function noticeFor(r, fmtTime = ms => new Date(ms).toISOString()) {
  if (!r || r.ok || !['plan_ceiling', 'daily_limit'].includes(r.reason)) return null;
  const at = r.until ? ` until ${fmtTime(r.until)}` : '';
  if (r.reason === 'plan_ceiling') return { key: `plan_ceiling:${r.engine}:${r.window}`, reason: 'plan_ceiling', engine: r.engine,
    text: `${ENGINE_LABEL[r.engine] || r.engine} ${WINDOW_LABEL[r.window]} window is at ${r.used}%, over the ${r.ceiling}% ceiling. Unattended work is held${at}.` };
  if (r.limit === 'openrouter') return { key: 'daily_limit:openrouter', reason: 'daily_limit', engine: 'acp',
    text: `Unattended OpenRouter spend reached $${Number(r.max).toFixed(2)} today. Unattended OpenRouter replies are held${at}.` };
  return { key: 'daily_limit:replies', reason: 'daily_limit', text: `${r.max} unattended replies ran today, the daily limit. Unattended work is held${at}.` };
}

// ---------- longest unattended reply ----------
// Only check-back and job replies have this limit. `limit` is the value snapshotted when the reply started (a changed
// setting applies to the next start); waiting on an approval or question is excluded unless countWaiting was on.
export function replyOverLimit({ rootOrigin, startedAt, waitingMs = 0, waitingSince = null, limit, countWaiting = false, now = Date.now() }) {
  if (rootOrigin !== 'checkback' && rootOrigin !== 'job') return false;
  if (limit === 'off' || !Number.isFinite(limit) || !Number.isFinite(startedAt)) return false;
  const waited = countWaiting ? 0 : waitingMs + (waitingSince ? now - waitingSince : 0);
  return now - startedAt - waited >= limit * 60_000;
}

// ---------- the owner's day ----------
const fmtCache = new Map();
export function dayKey(ms, zone) {
  const z = zone || undefined, k = z || '';
  let f = fmtCache.get(k);
  if (!f) { try { f = new Intl.DateTimeFormat('en-CA', { timeZone: z, year: 'numeric', month: '2-digit', day: '2-digit' }); } catch { f = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }); } fmtCache.set(k, f); }
  return f.format(new Date(ms));
}
// When the owner's day that contains `ms` ends (first ms of the next day), found by bisection so DST days work.
export function nextDayStart(ms, zone) {
  const today = dayKey(ms, zone);
  let lo = ms, hi = ms + 26 * 3600_000;
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (dayKey(mid, zone) === today) lo = mid; else hi = mid; }
  return hi;
}
const shiftDay = (key, n) => { const d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ---------- automation-state.json: the day's counts and notices ----------
const EMPTY_DAY = day => ({ day, startedRoot: 0, startedOwnerRoot: 0, openrouterRoot: 0, openrouterOwnerRoot: 0, replies: 0, cost: 0, tokens: 0, notices: [] });
export class AutomationState {
  constructor(file, { zone = () => '', now = () => Date.now(), write = atomicWrite } = {}) {
    this.file = file; this.zone = zone; this.now = now; this.write = write;
    let s = null;
    try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { }
    this.state = s && typeof s === 'object' && typeof s.today?.day === 'string' ? { today: { ...EMPTY_DAY(s.today.day), ...s.today }, days: Array.isArray(s.days) ? s.days : [] } : { today: EMPTY_DAY(dayKey(this.now(), this.zone())), days: [] };
  }
  save() { try { this.write(this.file, this.state); } catch { /* counts are best effort */ } }
  // A new day starts fresh counts; yesterday's totals go into the 7-day history.
  rollover() {
    const day = dayKey(this.now(), this.zone()), t = this.state.today;
    if (t.day === day) return t;
    if (t.replies || t.cost || t.tokens) this.state.days = [...this.state.days.filter(d => d.date !== t.day), { date: t.day, replies: t.replies, cost: t.cost, tokens: t.tokens }].slice(-14);
    this.state.today = EMPTY_DAY(day);
    this.save();
    return this.state.today;
  }
  counts() { return { ...this.rollover() }; }
  nextDay() { return nextDayStart(this.now(), this.zone()); }
  // An unattended start that went ahead. Root check-back/job work always counts; owner-rooted work is kept apart so
  // the countOwnerWork setting can include it or not without losing the tally.
  recordStart({ rootOrigin }) {
    const t = this.rollover();
    if (rootOrigin === 'checkback' || rootOrigin === 'job') t.startedRoot++; else t.startedOwnerRoot++;
    this.save();
  }
  // A finished unattended reply: what it cost, for Settings and the OpenRouter daily limit.
  recordFinish({ rootOrigin, engine, cost, tokens }) {
    const t = this.rollover(), c = Number.isFinite(cost) && cost > 0 ? cost : 0;
    t.replies++; t.cost = Math.round((t.cost + c) * 1e6) / 1e6; t.tokens += Number.isFinite(tokens) && tokens > 0 ? tokens : 0;
    if (engine === 'acp') { const k = rootOrigin === 'checkback' || rootOrigin === 'job' ? 'openrouterRoot' : 'openrouterOwnerRoot'; t[k] = Math.round((t[k] + c) * 1e6) / 1e6; }
    this.save();
  }
  // Once per reason per day: true the first time today (the caller then pushes, if the owner wants a push).
  noticeOnce(n) {
    if (!n) return false;
    const t = this.rollover();
    if (t.notices.some(x => x.key === n.key)) return false;
    t.notices.push({ key: n.key, reason: n.reason, ...(n.engine ? { engine: n.engine } : {}), at: new Date(this.now()).toISOString(), text: n.text });
    this.save();
    return true;
  }
  notices() { return this.rollover().notices.map(({ key, ...n }) => n); }
  usage() {
    const t = this.rollover(), byDate = new Map(this.state.days.map(d => [d.date, d]));
    byDate.set(t.day, { date: t.day, replies: t.replies, cost: t.cost, tokens: t.tokens });
    const days = [];
    for (let i = 6; i >= 0; i--) { const date = shiftDay(t.day, -i); const d = byDate.get(date); days.push({ date, replies: d?.replies || 0, cost: d?.cost || 0, tokens: d?.tokens || 0 }); }
    return { today: { replies: t.replies, cost: t.cost, tokens: t.tokens }, days };
  }
}

// ---------- automation-audit.jsonl ----------
// One line per pause, resume, settings change and finished unattended reply. Never message text: callers pass counts,
// ids, origins and outcomes only, and any key that could carry text is dropped here as well.
const NO_TEXT = new Set(['text', 'userText', 'prompt', 'message', 'body', 'note', 'reply']);
export function appendAudit(file, entry) {
  const clean = Object.fromEntries(Object.entries(entry || {}).filter(([k, v]) => !NO_TEXT.has(k) && v !== undefined));
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...clean }) + '\n', { mode: 0o600 });
  } catch { /* the audit is best effort; it must never stop a turn */ }
}
