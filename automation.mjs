// 1.117: unattended work foundation (docs/plans/unattended-work.md, Part 1).
// What started a turn (its origin), the owner's Unattended work settings (Pause all and the limits on unattended work),
// the gate every unattended start passes through, the day's counts and the audit file. Pure where it can be: the
// gate takes its state as an argument so it is unit-tested without a server (test/automation.test.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { atomicWrite } from './usage.mjs';
import { readStore } from './store-file.mjs';

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
const pct = (key, label, dflt, env, help) => ({ key, label, type: 'number', default: dflt, min: 10, max: 100, step: 1, unit: '%', integer: true, offAllowed: true, env, help });
export const GROUPS = [
  {
    key: 'pause', title: 'Pause all', settings: [
      { key: 'ownMessages', label: 'Your own messages while paused', type: 'choice', default: 'run',
        choices: [{ value: 'run', label: 'Run, with a banner' }, { value: 'blocked', label: 'Blocked until you resume' }],
        help: 'Whether a message you send yourself still runs while paused, with a banner reminding you, or waits until you resume.' },
      { key: 'inboxWatch', label: 'Also pause Inbox Watch', type: 'bool', default: true,
        help: 'Pause all also stops Inbox Watch\'s email checks, digests and look-aheads.' },
      { key: 'backgroundJobs', label: 'Also stop background commands', type: 'bool', default: true,
        help: 'Pause all also stops commands that agents left running in the background. Off: they keep running, but if one starts a reply, Pocket stops it.' },
      { key: 'rearmRetries', label: 'On Resume, restart held retries', type: 'bool', default: true,
        help: 'When a reply hits your plan\'s usage limit, Pocket retries it once the limit resets. On: those retries start again when you resume. Off: they wait until you start them.' },
      { key: 'runOverdue', label: 'On Resume, run late check-backs', type: 'bool', default: true, // 1.119
        help: 'A check-back that came due while paused runs when you resume, if it is within the catch-up window. Off: it is marked missed.' },
      { key: 'confirm', label: 'Ask before pausing', type: 'bool', default: true,
        help: 'Shows what will stop and asks you to confirm. Off: one tap pauses.' },
    ],
  },
  {
    key: 'limits', title: 'Limits', settings: [
      { key: 'dailyReplies', label: 'Unattended replies per day', type: 'number', default: 40, min: 1, max: 1000, step: 1, unit: '', integer: true, offAllowed: true,
        help: 'The most replies that can run without you in a day, counted in your time zone. Check-backs and job runs always count.' },
      { key: 'longestReply', label: 'Longest unattended reply', type: 'number', default: 60, min: 5, max: 480, step: 5, unit: 'min', integer: true, offAllowed: true,
        help: 'A check-back or job reply still running after this many minutes is stopped. This is the only limit that stops a reply already running.' },
      { key: 'openrouterDaily', label: 'OpenRouter spend per day', type: 'number', default: 5, min: 0.5, max: 500, step: 0.5, unit: '$', offAllowed: true,
        help: 'The most unattended work can spend on OpenRouter in a day, in dollars.' },
      pct('claudeWeekly', 'Claude plan, weekly: stop unattended work at', 80, ['CLAUDE_WEEKLY_CEILING', 'WEEKLY_CEILING'],
        'Once your Claude plan\'s weekly usage passes this percentage, check-backs and jobs wait, so the rest is kept for you. Messages you send are never held.'),
      pct('claudeFiveHour', 'Claude plan, 5-hour: stop unattended work at', 90, ['CLAUDE_FIVE_HOUR_CEILING', 'FIVE_HOUR_CEILING'],
        'The same, for your Claude plan\'s 5-hour usage.'),
      pct('codexWeekly', 'Codex plan, weekly: stop unattended work at', 80, ['CODEX_WEEKLY_CEILING', 'WEEKLY_CEILING'],
        'The same, for your Codex plan\'s weekly usage.'),
      pct('codexFiveHour', 'Codex plan, 5-hour: stop unattended work at', 90, ['CODEX_FIVE_HOUR_CEILING', 'FIVE_HOUR_CEILING'],
        'The same, for your Codex plan\'s 5-hour usage.'),
      { key: 'notice', label: 'Tell me when a limit is reached', type: 'choice', default: 'push',
        choices: [{ value: 'push', label: 'Push and Usage page, once per reason a day' }, { value: 'settings', label: 'Usage page only' }],
        help: 'When a limit holds work back, tell you by push and on the Usage page (once per reason a day), or only on the Usage page.' },
      { key: 'countOwnerWork', label: 'Count my queued messages and retries toward the daily limits', type: 'bool', default: false, advanced: true,
        help: 'Off: work you started yourself does not use up the daily reply count or OpenRouter spend. That covers messages you queued, usage-limit retries, and a conversation woken by another conversation.' },
      { key: 'ceilingsHoldOwnerWork', label: 'Plan limits also hold my queued messages and retries', type: 'bool', default: false, advanced: true,
        help: 'Off: the plan percentages hold back only check-backs and jobs.' },
      { key: 'countWaiting', label: 'Count time waiting for me toward the longest reply', type: 'bool', default: false, advanced: true,
        help: 'Off: time a reply spends waiting for your approval or answer does not count toward Longest unattended reply.' },
      { key: 'staleHours', label: 'Treat a plan reading older than this as stale', type: 'number', default: 6, min: 1, max: 24, step: 1, unit: 'h', integer: true, advanced: true,
        help: 'Pocket learns your plan usage from each reply. A reading older than this many hours does not hold work back; the next reply refreshes it.' },
    ],
  },
  // 1.119: check-backs (Part 2). Off until the owner turns them on. The keys name the feature so the env presets
  // (POCKET_AUTOMATION_<KEY>) don't clash with other groups'.
  {
    key: 'checkbacks', title: 'Check-backs', settings: [
      { key: 'checkbacks', label: 'Check-backs', type: 'bool', default: false,
        help: 'Off: none can be set and none run. Waiting ones are kept.' },
      { key: 'checkbackAccess', label: 'Permissions for a check-back', type: 'choice', default: 'same',
        choices: [{ value: 'same', label: 'Same as the reply that set it' }, { value: 'review', label: 'Always Review actions' }],
        help: '"Same as the reply that set it" keeps that conversation\'s setting. "Always Review actions" makes it stop for your approval before anything that changes files. Where Full access is turned off on this server, it always asks.' },
      { key: 'checkbackClaude', label: 'In Claude Code conversations', type: 'bool', default: true,
        help: 'Lets Claude Code conversations set check-backs.' },
      { key: 'checkbackCodex', label: 'In Codex conversations', type: 'bool', default: true,
        help: 'Lets Codex conversations set check-backs. Codex can only set one under Full access, because Review actions keeps it from reaching Pocket.' },
      { key: 'pushWhenMuted', label: 'Push the result even when the conversation is muted', type: 'bool', default: true,
        help: 'A muted conversation still notifies you when its check-back runs.' },
      { key: 'showInTasks', label: 'Show check-backs in Tasks', type: 'bool', default: true,
        help: 'Lists waiting check-backs in Tasks, where you can see and cancel them.' },
      { key: 'perConversation', label: 'Waiting per conversation', type: 'number', default: 10, min: 1, max: 50, step: 1, unit: '', integer: true, advanced: true,
        help: 'The most check-backs one conversation can have waiting.' },
      { key: 'perInstall', label: 'Waiting in total', type: 'number', default: 50, min: 1, max: 500, step: 1, unit: '', integer: true, advanced: true,
        help: 'The most check-backs waiting across all conversations.' },
      { key: 'chainLimit', label: 'Check-backs one can set in a row', type: 'number', default: 5, min: 0, max: 20, step: 1, unit: '', integer: true, advanced: true,
        help: 'Stops check-backs from setting more check-backs without end. 0: a check-back can\'t set another.' },
      { key: 'furthestHours', label: 'Furthest ahead', type: 'number', default: 2160, min: 1, max: 8760, step: 1, unit: 'h', integer: true, advanced: true,
        help: 'How far ahead a check-back can be set, in hours. 2,160 hours is 90 days.' },
      { key: 'soonestMin', label: 'Soonest', type: 'number', default: 1, min: 1, max: 60, step: 1, unit: 'min', integer: true, advanced: true,
        help: 'How soon a check-back can be set, in minutes.' },
      { key: 'noteMax', label: 'Longest note', type: 'number', default: 1000, min: 200, max: 4000, step: 50, unit: 'characters', integer: true, advanced: true,
        help: 'The most characters a check-back\'s note can have.' },
      { key: 'catchUpHours', label: 'Catch-up window after Pocket was down', type: 'number', default: 12, min: 0, max: 72, step: 1, unit: 'h', integer: true, advanced: true,
        help: 'If Pocket was down when a check-back came due, it still runs if it is no later than this many hours, and it says how late it is. Later ones are marked missed. 0: never run late.' },
      { key: 'busyWaitMin', label: 'Wait for a busy conversation', type: 'number', default: 60, min: 5, max: 480, step: 5, unit: 'min', integer: true, advanced: true,
        help: 'If the conversation is busy when a check-back comes due, how many minutes it waits before it is marked missed.' },
      { key: 'spacingSec', label: 'Spacing between late check-backs', type: 'number', default: 15, min: 0, max: 300, step: 1, unit: 's', integer: true, advanced: true,
        help: 'Seconds between late check-backs when several run after Pocket comes back, so they do not all start at once.' },
    ],
  },
  // Job keys (Part 3). Off until the owner turns them on. The access, instructions, per-key limits and push rows are the
  // defaults a new key starts with; each key keeps its own copy (job-keys.json) that the owner can change per key.
  {
    key: 'jobs', title: 'Job keys', settings: [
      { key: 'jobs', label: 'Job keys', type: 'bool', default: false,
        help: 'Off: every call from a program is refused. Keys are kept.' },
      { key: 'jobsInTasks', label: 'Show job keys in Tasks', type: 'bool', default: true,
        help: 'Adds a Jobs group to Tasks: each key, whether it is on, its last run and any requests waiting for you.' },
      // Full access by default since 1.125.2 (the owner, 2026-11-27): work he asked to run unattended runs freely. A server
      // with Full access off still makes new keys "ask" (jobDefaults and jobKeyFields in server.mjs).
      { key: 'jobAccess', label: 'Access', type: 'choice', default: 'full',
        choices: [{ value: 'ask', label: 'Ask me for every action' }, { value: 'full', label: 'Full access (only where this server allows it)' }],
        help: 'Full access runs without asking, where this server allows it; where it doesn\'t, a new key asks. "Ask me for every action" stops for your approval.' },
      { key: 'jobAddInstructions', label: 'Job may add its own instructions', type: 'bool', default: false,
        help: 'Lets the program send instructions as well as data. Off: everything it sends is treated as data, so it can\'t change what the job does.' },
      { key: 'jobPerHour', label: 'Runs per hour', type: 'number', default: 6, min: 1, max: 120, step: 1, unit: '', integer: true, offAllowed: true,
        help: 'The most runs one key can start in an hour.' },
      { key: 'jobPerDay', label: 'Runs per day', type: 'number', default: 24, min: 1, max: 1000, step: 1, unit: '', integer: true, offAllowed: true,
        help: 'The most runs one key can start in 24 hours. These also count toward Unattended replies per day.' },
      { key: 'jobAtOnce', label: 'Runs at once', type: 'number', default: 1, min: 1, max: 5, step: 1, unit: '', integer: true,
        help: 'How many runs of one key can work at the same time. Another call is turned away as busy.' },
      { key: 'jobPush', label: 'Push when a job finishes', type: 'bool', default: true,
        help: 'Sends a push with the first line of the reply when a run finishes.' },
      { key: 'jobPushRespectsMute', label: 'Job pushes respect the conversation\'s mute', advanced: true, type: 'bool', default: true,
        help: 'A job whose conversation is muted does not push.' },
      { key: 'jobDataMax', label: 'Most data per run', advanced: true, type: 'number', default: 20000, min: 1000, max: 100000, step: 1000, unit: 'characters', integer: true,
        help: 'The most text a program can send in one call, in characters. More is refused, not cut short.' },
      { key: 'jobWaitMax', label: 'Longest wait a job may ask for', advanced: true, type: 'number', default: 300, min: 30, max: 900, step: 10, unit: 's', integer: true,
        help: 'A program can wait for the reply before carrying on. This is the longest it may wait, in seconds.' },
      { key: 'jobRepeatDays', label: 'Ignore a repeated call for', advanced: true, type: 'number', default: 7, min: 1, max: 30, step: 1, unit: 'd', integer: true,
        help: 'If a program sends the same run id again within this many days, it gets the first run\'s result back and nothing new starts. This prevents double runs.' },
      { key: 'jobKeyFolder', label: 'Where new keys are saved', advanced: true, type: 'folder', default: '~/.config/pocket/jobs/',
        help: 'The folder in your home folder where new key files go. Only you can read them.' },
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
  if (s.type === 'folder') return 'a folder in your home folder, written like ~/.config/pocket/jobs/';
  const lo = s.unit === '$' ? `$${s.min.toFixed(2)}` : fmtNum(s, s.min);
  return `${lo} to ${fmtNum(s, s.max)}${s.offAllowed ? ', or No limit' : ''}`;
}
// A folder in the owner's home, as the setting stores it: '~/' plus the path inside home, ending in '/' ('~/' for home
// itself). Takes '~', '~/x' or an absolute path inside home; null for anything else (outside home, '..', control
// characters, over 400 characters). Where a symlink inside home leads is checked when a key file is written (job-keys.mjs).
export function homeFolder(v, home = os.homedir()) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > 400 || /[\0-\x1f\x7f]/.test(s)) return null;
  let rel;
  if (s === '~') rel = '';
  else if (s.startsWith('~/')) rel = s.slice(2);
  else if (path.isAbsolute(s)) { const r = path.relative(home, s); if (r.startsWith('..') || path.isAbsolute(r)) return null; rel = r; }
  else return null;
  const parts = rel.split('/').filter(p => p && p !== '.');
  if (parts.some(p => p === '..')) return null;
  return '~/' + (parts.length ? parts.join('/') + '/' : '');
}
// One value checked against its setting: { value } (normalized) or { error } naming the allowed range.
export function checkValue(s, v) {
  const bad = () => ({ error: `${s.label} must be ${rangeText(s)}.` });
  if (s.type === 'bool') return typeof v === 'boolean' ? { value: v } : bad();
  if (s.type === 'choice') return s.choices.some(c => c.value === v) ? { value: v } : bad();
  if (s.type === 'folder') { const f = homeFolder(v); return f == null ? bad() : { value: f }; }
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
// What Settings → Unattended work shows: each setting with its effective value and where it came from, plus warnings.
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
  // An engine where a person must send every message (engines.mjs unattended:false, Antigravity) takes no unattended
  // start of any kind, whatever the limits say.
  if (info?.attendedOnly) return { ok: false, reason: 'attended_only' };
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
const ENGINE_LABEL = { claude: 'Claude Code', codex: 'Codex', acp: 'OpenRouter', antigravity: 'Antigravity' };
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
  constructor(file, { zone = () => '', now = () => Date.now(), write = atomicWrite, log = (...a) => console.log(new Date().toISOString(), ...a) } = {}) {
    this.file = file; this.zone = zone; this.now = now; this.write = write; this.log = log; this.saveError = null;
    // 1.124.4: a file that is there but cannot be read or parsed is kept aside as <name>.corrupt-<UTC time> and logged
    // (store-file.mjs, as the other stores), and the day starts empty; it was read as empty and the next save replaced it
    const s = readStore(file, { log });
    this.state = typeof s.today?.day === 'string' ? { today: { ...EMPTY_DAY(s.today.day), ...s.today }, days: Array.isArray(s.days) ? s.days : [] } : { today: EMPTY_DAY(dayKey(this.now(), this.zone())), days: [] };
  }
  // 1.124.4: a failed write keeps the counts in memory (rolling them back would loosen the limits while Pocket runs,
  // and a throw would break a reply that has already started), but no longer silently: save() returns false, saveError
  // holds when and why (the Unattended work page warns from it), and the log has one line for a run of failures and one when
  // a save works again. A restart before then reads the last good save, so the day's counts can come back lower.
  save() {
    try { this.write(this.file, this.state); } catch (e) {
      const code = e.code || e.message;
      if (!this.saveError) this.log(`${this.file} could not be saved (${code}): today's unattended counts are kept in memory, but a restart before a save works again would forget them and the daily limits could be passed. Check that the data folder has space and can be written.`);
      this.saveError = { at: this.saveError?.at || new Date(this.now()).toISOString(), code };
      return false;
    }
    if (this.saveError) { this.saveError = null; this.log(`${this.file} saved again: today's unattended counts are on disk.`); }
    return true;
  }
  // A new day starts fresh counts; yesterday's totals go into the 7-day history. Only forward: a time zone moved
  // west (or a clock stepped back) gives an earlier day key, and that must not reset today's count early.
  rollover() {
    const day = dayKey(this.now(), this.zone()), t = this.state.today;
    if (day <= t.day) return t;
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
// 1.124.4: a line a full disk cut short ends without a newline. The next line then starts on a line of its own, so only
// the torn line is lost and not the first good one after it. One byte is read per audit line; audit lines are rare.
function endsMidLine(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try { const { size } = fs.fstatSync(fd), b = Buffer.alloc(1); return size > 0 && fs.readSync(fd, b, 0, 1, size - 1) === 1 && b[0] !== 10; } finally { fs.closeSync(fd); }
  } catch { return false; } // no file yet, or it cannot be read: the append says whether it can be written
}
export function appendAudit(file, entry) {
  const clean = Object.fromEntries(Object.entries(entry || {}).filter(([k, v]) => !NO_TEXT.has(k) && v !== undefined));
  try {
    const row = JSON.stringify({ at: new Date().toISOString(), ...clean }) + '\n';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, endsMidLine(file) ? '\n' + row : row, { mode: 0o600 });
    return true;
  } catch { return false; } // the audit is best effort; it must never stop a turn. 1.124.4: false says the line is lost
}
// 1.124.4: the audit as the server writes it. A line that could not be written is logged, never with its contents, at
// most once a minute with the number lost since the last note, so a full disk or a lost permission does not go unseen.
export function auditWriter(file, { log = (...a) => console.log(new Date().toISOString(), ...a), now = Date.now } = {}) {
  let noted = -Infinity, lost = 0;
  return entry => {
    if (appendAudit(file, entry)) return true;
    lost++;
    if (now() - noted >= 60_000) {
      log(`${file} could not be written: ${lost} audit line${lost === 1 ? '' : 's'} lost since the last note. Check that the data folder has space and can be written.`);
      noted = now(); lost = 0;
    }
    return false;
  };
}
