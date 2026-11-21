// Inbox (1.69): what the owner's inbox watcher (inbox-monitor, or any job) sent, kept where it can be read and answered.
// One JSON file in the data directory, written atomically: entries (an alert, a digest or a look-ahead) and, per source,
// when it last reported. The owner opens, dismisses, resolves or marks an entry not useful; the worker reads those
// decisions back through feedback() and acks them, which is how an X in Pocket changes what the watcher sends next.
// Nothing here sends anything: the server pushes and mails on add, the worker runs on its own timer outside Pocket.
// 1.70: per source, the owner's settings for the watcher (when it checks, which models judge) and the watcher's profile
// (its defaults, the choices it offers, what is in force, what it cost per day), which it sends with every heartbeat.
// The worker reads the settings back each minute; with none stored it uses its own config file.
// 1.75: Check now. The owner's request is a time stamp per source, handed to the worker with the settings; the worker runs a
// check on its next tick whatever the schedule says and reports the stamp back as done in its heartbeat.
// 1.77: an entry remembers the conversations started from its start link (newest last), and an opened entry can be marked
// unread again. Neither reaches the worker: they are the owner's bookkeeping, not decisions about the alert.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { shellArg } from './skills.mjs';

// 1.95: a digest carries its items (one per story: title, text, story, Gmail thread, a `ref` the watcher knows), each with
// its own decision: Add to Inbox (action 'alert'), Resolved, Not useful, and Restore to undo. A look-ahead's items work the same way
// (section 'ahead', in the order the look-ahead gave them). Item decisions are feedback too
// (kind 'digest-item', id '<entry>/<ref>'), so the watcher can promote a line to an alert, close a story or learn a rule
// from one line of the digest instead of from the whole digest. A digest's text may run to digestText characters.
export const LIMITS = { entries: 500, text: 2000, digestText: 12000, title: 160, story: 120, source: 60, items: 200, itemText: 1200, ref: 40, keepDays: 60, dismissedDays: 30 };
export const KINDS = ['alert', 'digest', 'lookahead'];
export const PRIORITIES = ['critical', 'high', 'normal', 'low'];
export const STATES = ['new', 'opened', 'dismissed', 'resolved', 'not_useful'];
export const ACTIONS = ['open', 'unread', 'dismiss', 'resolve', 'not_useful', 'restore'];
export const SECTIONS = ['held', 'resolved', 'worth', 'tidied', 'listed', 'ahead']; // where a digest item sat: held overnight, resolved overnight, worth knowing, taken off by the tidy pass, already on the list (an open alert on that story: the item links to it, no card)
const HISTORY = ['resolved', 'tidied', 'listed']; // items that take no decision: the story is closed, gone, or decided on its own entry
export const ITEM_STATES = ['open', 'alerted', 'resolved', 'not_useful', 'dismissed'];
export const ITEM_ACTIONS = ['alert', 'resolve', 'not_useful', 'dismiss', 'restore'];
const ACTED = ['dismissed', 'resolved', 'not_useful'];
const TARGET = { dismiss: 'dismissed', resolve: 'resolved', not_useful: 'not_useful' };
const ITEM_TARGET = { alert: 'alerted', resolve: 'resolved', not_useful: 'not_useful', dismiss: 'dismissed', restore: 'open' };
const ITEM_ACTED = ['alerted', 'resolved', 'not_useful', 'dismissed'];
const sameStory = (a, b) => Boolean((a.story && a.story === b.story) || (a.gmail && a.gmail === b.gmail));
// 1.113.1: `seen` is how much of the entry's `news` the conversation has (it starts with all of it); `story` marks one that came
// with a merged entry and has not had this entry's story yet.
const remember = (x, id, at, extra = {}) => { if (x.sessions.some(s => s.id === id)) return false; x.sessions = [...x.sessions, { id, at, ...(x.newsN ? { seen: x.newsN } : {}), ...extra }].slice(-SESSIONS_MAX); return true; };
const WHY_MAX = 200; // 1.105: why an entry pushed, or why it did not
const NOTE_MAX = 300, URL_MAX = 500, DEDUPE_MAX = 200, SESSIONS_MAX = 5, DAY = 86400_000;
// 1.113 (owner request): one entry per story. What an entry took in from other entries or earlier alerts on its story: the Gmail thread,
// title, start link and (for a merged entry) its id. The watcher reads `merged` to take the Gmail label off those threads, so
// only the entry's own thread carries it. EARLIER marks where an updated entry's previous text begins.
const MERGED_MAX = 10, EARLIER = '\n\nEarlier on this entry: ';
const checkMerged = v => Array.isArray(v) ? v.filter(m => m && typeof m === 'object').map(m => {
  const keep = (f, x) => { try { return f(x); } catch { return ''; } };
  return { id: typeof m.id === 'string' && /^[0-9a-f]{12}$/.test(m.id) ? m.id : '', title: line(m.title, LIMITS.title), gmail: keep(checkGmail, m.gmail), url: keep(checkUrl, m.url), at: Number.isNaN(ms(m.at)) ? null : m.at };
}).filter(m => m.gmail || m.url || m.id).slice(-MERGED_MAX) : [];
const DOC_RE = /^[0-9a-f]{12}$/, START_RE = /^[0-9a-f]{12}$/, SESSION_RE = /^(cx:)?[0-9A-Za-z][0-9A-Za-z_-]{7,79}$/;
const checkSessions = v => Array.isArray(v) ? v.filter(s => s && SESSION_RE.test(String(s.id)) && !Number.isNaN(ms(s.at))).slice(-SESSIONS_MAX)
  .map(s => ({ id: s.id, at: s.at, ...(Number.isInteger(s.seen) && s.seen >= 0 ? { seen: s.seen } : {}), ...(s.story === true ? { story: true } : {}), ...(s.handed === true ? { handed: true } : {}) })) : [];
// 1.113.1 (owner request): what reached an entry after a conversation started from it, so that conversation can catch up instead of a
// second one starting. `n` counts up per entry (newsN); the last NEWS_MAX are kept.
// 1.115: each also keeps what taking it back off needs (split): the alert's own start link and priority, the merged entry's
// id (`from`), and what the entry was before the update (`was`: title, links, priority, time, read or not).
const NEWS_MAX = 6, ENTRY_RE = /^[0-9a-f]{12}$/;
const checkWas = w => {
  if (!w || typeof w !== 'object') return null;
  const keep = (f, x) => { try { return f(x); } catch { return ''; } };
  return { title: line(w.title, LIMITS.title), gmail: keep(checkGmail, w.gmail), url: keep(checkUrl, w.url), priority: PRIORITIES.includes(w.priority) ? w.priority : '', at: Number.isNaN(ms(w.at)) ? null : w.at, state: w.state === 'new' ? 'new' : 'opened' };
};
const checkNews = v => Array.isArray(v) ? v.filter(x => x && Number.isInteger(x.n) && x.n > 0).map(x => {
  const keep = (f, y) => { try { return f(y); } catch { return ''; } };
  const was = checkWas(x.was);
  return { n: x.n, at: Number.isNaN(ms(x.at)) ? null : x.at, kind: x.kind === 'merge' ? 'merge' : 'update', title: line(x.title, LIMITS.title), text: str(x.text, LIMITS.text), gmail: keep(checkGmail, x.gmail),
    ...(keep(checkUrl, x.url) ? { url: keep(checkUrl, x.url) } : {}), ...(PRIORITIES.includes(x.priority) ? { priority: x.priority } : {}), ...(typeof x.from === 'string' && ENTRY_RE.test(x.from) ? { from: x.from } : {}), ...(was ? { was } : {}) };
}).slice(-NEWS_MAX) : [];
const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const line = (v, max) => str(typeof v === 'string' ? v.replace(/\s+/g, ' ') : v, max);
const shortId = () => randomBytes(6).toString('hex');
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const ms = v => v ? Date.parse(v) : NaN;
// A link the row opens: a Pocket path (/#/start/<id>, /#/chat/<id>) or an absolute web address. `//host` is neither.
const checkUrl = v => { const u = str(v, URL_MAX); if (!u) return ''; if ((u.startsWith('/') && !u.startsWith('//')) || /^https?:\/\/[^\s/]+/i.test(u)) return u; throw fail('The link must be a Pocket path (/#/…) or a web address.', 400, { code: 'bad_url' }); };
const checkGmail = v => { const u = str(v, URL_MAX); if (!u) return ''; if (u.startsWith('https://mail.google.com/')) return u; throw fail('The Gmail link must start with https://mail.google.com/.', 400, { code: 'bad_gmail' }); };
const checkDoc = v => { const d = str(v, 40); if (!d) return ''; if (DOC_RE.test(d)) return d; throw fail('The file must be a Files id (12 letters and digits).', 400, { code: 'bad_doc' }); };
const pick = (v, list, fallback, what) => { const s = str(v, 40); if (!s) return fallback; if (list.includes(s)) return s; throw fail(`Unknown ${what}. Use ${list.join(', ')}.`, 400, { code: 'bad_' + what }); };
const checkSince = v => { if (v == null || v === '') return null; const t = Date.parse(String(v)); if (Number.isNaN(t)) throw fail('since must be a date and time (ISO).', 400, { code: 'bad_since' }); return t; };
const source = v => line(v, LIMITS.source) || 'inbox-monitor';
const textMax = kind => kind === 'alert' ? LIMITS.text : LIMITS.digestText;
// 1.95: a digest's items. `ref` is the watcher's handle (an alert id, say) and must be unique within the entry; a bad item is refused
// on add (the watcher's call) and dropped on load (a file edited by hand). `url` is the item's own briefed start link, when the
// watcher made one, so the owner can start a conversation about that one line.
const REF_RE = /^[0-9A-Za-z][0-9A-Za-z:_.-]{0,39}$/;
function checkItem(raw, i, { strict }) {
  const bad = msg => fail(`Item ${i + 1}: ${msg}`, 400, { code: 'bad_item' });
  if (!raw || typeof raw !== 'object') { if (strict) throw bad('not an item.'); return null; }
  const ref = str(raw.ref, LIMITS.ref), title = line(raw.title, LIMITS.title);
  if (!REF_RE.test(ref)) { if (strict) throw bad('ref is letters, digits, : _ . - (up to 40).'); return null; }
  if (!title) { if (strict) throw bad('needs a title.'); return null; }
  const keep = (f, v) => { try { return f(v); } catch (e) { if (strict) throw bad(e.message); return ''; } };
  const ok = (v, list, d) => list.includes(v) ? v : d;
  return { ref, section: strict ? pick(raw.section, SECTIONS, 'worth', 'section') : ok(raw.section, SECTIONS, 'worth'), title, text: str(raw.text, LIMITS.itemText), story: line(raw.story, LIMITS.story),
    gmail: keep(checkGmail, raw.gmail), url: keep(checkUrl, raw.url), priority: strict ? pick(raw.priority, PRIORITIES, 'normal', 'priority') : ok(raw.priority, PRIORITIES, 'normal'),
    state: ok(raw.state, ITEM_STATES, 'open'), actedAt: raw.actedAt || null, ackedAt: raw.ackedAt || null, note: str(raw.note, NOTE_MAX), lastAction: ITEM_ACTIONS.includes(raw.lastAction) ? raw.lastAction : null, sessions: checkSessions(raw.sessions) };
}
function checkItems(raw, { strict }) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) { if (strict) throw fail('items is a list.', 400, { code: 'bad_items' }); return []; }
  if (raw.length > LIMITS.items) { if (strict) throw fail(`items: at most ${LIMITS.items}.`, 400, { code: 'bad_items' }); raw = raw.slice(0, LIMITS.items); }
  const out = [], seen = new Set();
  raw.forEach((r, i) => { const it = checkItem(r, i, { strict }); if (!it) return; if (seen.has(it.ref)) { if (strict) throw fail(`Item ${i + 1}: ref ${it.ref} is used twice.`, 400, { code: 'bad_item' }); return; } seen.add(it.ref); out.push(it); });
  return out;
}

// ---- 1.70: Inbox Watch settings. The worker normalizes again; here a bad value is refused with a reason the owner can read.
export const WATCH = { periods: 12, every: 240, name: 40, model: 80, profileBytes: 24000, reasoning: ['default', 'low', 'medium', 'high', 'xhigh', 'max'], firstPass: ['jev', 'openai', 'both'], tidyEvery: [1, 2, 4, 8, 12, 24], rules: 12000, scope: ['all', 'inbox', 'inbox_labels'], scopeLabels: 20, scopeLabel: 60,
  push: { modes: ['urgent', 'all', 'none'], kinds: ['emergency', 'outage', 'money', 'security', 'waiting', 'deadline'], perDay: [3, 5, 8, 12, 20, 0], repeat: ['worse', 'every'] } };
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
export function checkWatch(raw, profile = null) {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail('settings must be an object (or null for the config file\'s).', 400, { code: 'bad_watch' });
  const bad = (msg) => fail(msg, 400, { code: 'bad_watch' });
  const out = {};
  if ('paused' in raw) { if (typeof raw.paused !== 'boolean') throw bad('paused is true or false.'); out.paused = raw.paused; }
  if ('every' in raw) { if (!isInt(raw.every, 0, WATCH.every)) throw bad(`every is whole minutes from 0 (no checks) to ${WATCH.every}.`); out.every = raw.every; }
  if ('periods' in raw) {
    if (!Array.isArray(raw.periods) || raw.periods.length > WATCH.periods) throw bad(`periods is a list of at most ${WATCH.periods}.`);
    out.periods = raw.periods.map((p, i) => {
      const n = i + 1;
      if (!p || typeof p !== 'object') throw bad(`Period ${n} is not a period.`);
      const days = Array.isArray(p.days) ? [...new Set(p.days)].sort() : null;
      if (!days || !days.length || !days.every(d => isInt(d, 0, 6))) throw bad(`Period ${n} needs at least one day.`);
      if (!TIME_RE.test(String(p.from)) || !TIME_RE.test(String(p.to))) throw bad(`Period ${n} needs a start and an end time (HH:MM).`);
      if (!isInt(p.every, 0, WATCH.every)) throw bad(`Period ${n}: every is whole minutes from 0 (no checks) to ${WATCH.every}.`);
      return { name: line(p.name, WATCH.name), days, from: p.from, to: p.to, every: p.every };
    });
  }
  if ('quietHours' in raw) { const q = raw.quietHours; if (!Array.isArray(q) || q.length !== 2 || !q.every(h => isInt(h, 0, 23))) throw bad('quietHours is [start hour, end hour].'); out.quietHours = q; }
  if ('digestHour' in raw) { if (raw.digestHour !== null && !isInt(raw.digestHour, 0, 23)) throw bad('digestHour is an hour, 0 to 23, or null for off.'); out.digestHour = raw.digestHour; } // 1.95: null, no digest; held alerts go out on their own
  if ('lookahead' in raw) {
    const l = raw.lookahead; if (!l || typeof l !== 'object') throw bad('lookahead is {morning, evening}.');
    out.lookahead = {};
    for (const k of ['morning', 'evening']) if (k in l) { if (l[k] !== null && !isInt(l[k], 0, 23)) throw bad(`The ${k} look-ahead is an hour or off.`); out.lookahead[k] = l[k]; }
  }
  if ('firstPass' in raw) { // a decision model that skips routine mail before the judge
    const f = raw.firstPass; if (!f || typeof f !== 'object') throw bad('firstPass is {enabled, provider, threshold}.');
    out.firstPass = {};
    if ('enabled' in f) { if (typeof f.enabled !== 'boolean') throw bad('firstPass.enabled is true or false.'); out.firstPass.enabled = f.enabled; }
    if ('provider' in f) { if (!WATCH.firstPass.includes(f.provider)) throw bad(`The first pass is one of ${WATCH.firstPass.join(', ')}.`); out.firstPass.provider = f.provider; }
    if ('threshold' in f) { if (typeof f.threshold !== 'number' || f.threshold < 0.5 || f.threshold > 0.99) throw bad('The first pass confidence is between 0.5 and 0.99.'); out.firstPass.threshold = Math.round(f.threshold * 100) / 100; }
  }
  if ('rules' in raw) { // the owner's own rules for the watcher, plain text (1.73)
    if (typeof raw.rules !== 'string') throw bad('rules is text.');
    if (raw.rules.length > WATCH.rules) throw bad(`Your rules are over ${WATCH.rules.toLocaleString('en-US')} characters.`);
    out.rules = raw.rules.replace(/\r\n/g, '\n');
  }
  if ('tidy' in raw) { // take resolved or handled entries off the list (inbox-monitor's tidy pass)
    const t = raw.tidy; if (!t || typeof t !== 'object') throw bad('tidy is {enabled, every}.');
    out.tidy = {};
    if ('enabled' in t) { if (typeof t.enabled !== 'boolean') throw bad('tidy.enabled is true or false.'); out.tidy.enabled = t.enabled; }
    if ('every' in t) { if (!WATCH.tidyEvery.includes(t.every)) throw bad(`Tidy runs every ${WATCH.tidyEvery.join(', ')} hours.`); out.tidy.every = t.every; }
  }
  if ('scope' in raw) { // 1.100: which mail the watcher reads at all: everything, the inbox, or the inbox plus chosen Gmail labels
    const sc = raw.scope; if (!sc || typeof sc !== 'object') throw bad('scope is {mode, labels}.');
    const mode = str(sc.mode, 20) || 'all';
    if (!WATCH.scope.includes(mode)) throw bad(`scope.mode is one of ${WATCH.scope.join(', ')}.`);
    let labels = [];
    if ('labels' in sc) {
      if (!Array.isArray(sc.labels) || sc.labels.some(x => typeof x !== 'string')) throw bad('scope.labels is a list of Gmail label names.');
      labels = [...new Set(sc.labels.map(x => line(x, WATCH.scopeLabel)).filter(Boolean))];
      if (labels.length > WATCH.scopeLabels) throw bad(`scope.labels: at most ${WATCH.scopeLabels} labels.`);
    }
    out.scope = { mode, labels };
  }
  if ('push' in raw) { // 1.105: which alerts also push to the owner's devices; every alert still goes on the list
    const p = raw.push, P = WATCH.push; if (!p || typeof p !== 'object') throw bad('push is {mode, kinds, perDay, repeat}.');
    out.push = {};
    if ('mode' in p) { if (!P.modes.includes(p.mode)) throw bad(`push.mode is one of ${P.modes.join(', ')}.`); out.push.mode = p.mode; }
    if ('kinds' in p) { if (!Array.isArray(p.kinds) || p.kinds.some(k => !P.kinds.includes(k))) throw bad(`push.kinds is a list of ${P.kinds.join(', ')}.`); out.push.kinds = P.kinds.filter(k => p.kinds.includes(k)); }
    if ('perDay' in p) { if (!P.perDay.includes(p.perDay)) throw bad(`push.perDay is one of ${P.perDay.join(', ')} (0: no limit).`); out.push.perDay = p.perDay; }
    if ('repeat' in p) { if (!P.repeat.includes(p.repeat)) throw bad(`push.repeat is ${P.repeat.join(' or ')}.`); out.push.repeat = p.repeat; }
  }
  if ('gmailLabel' in raw) { // 1.75: the Pocket Inbox label in Gmail, kept in step with this list both ways
    const g = raw.gmailLabel; if (!g || typeof g !== 'object' || typeof g.enabled !== 'boolean') throw bad('gmailLabel is {enabled: true or false}.');
    out.gmailLabel = { enabled: g.enabled };
  }
  if ('models' in raw) {
    const m = raw.models; if (!m || typeof m !== 'object') throw bad('models is {decisions, lookahead}.');
    const offered = Array.isArray(profile?.options?.models) ? profile.options.models.map(x => x?.id).filter(Boolean) : null;
    out.models = {};
    for (const job of ['decisions', 'lookahead']) if (job in m) {
      const j = m[job] || {}, model = str(j.model, WATCH.model), reasoning = str(j.reasoning, 20) || 'default';
      if (!model || (offered && offered.length && !offered.includes(model))) throw bad(`Choose one of the models Inbox Watch offers for ${job === 'decisions' ? 'decisions' : 'the look-ahead'}.`);
      if (!WATCH.reasoning.includes(reasoning)) throw bad(`Reasoning is one of ${WATCH.reasoning.join(', ')}.`);
      out.models[job] = { model, reasoning };
    }
  }
  return out;
}
// The watcher's own report: kept as sent (it is the worker's to describe itself), but bounded.
function checkProfile(p) {
  if (p == null) return null;
  if (typeof p !== 'object' || Array.isArray(p)) throw fail('profile must be an object.', 400, { code: 'bad_profile' });
  if (JSON.stringify(p).length > WATCH.profileBytes) throw fail(`profile is over ${WATCH.profileBytes} characters.`, 400, { code: 'bad_profile' });
  return structuredClone(p);
}

// The agent's one line while Inbox Watch is on. It reads the list when the user asks about it and records a decision only
// when the user makes one; it never dismisses or resolves on its own judgment.
export function inboxInstructions(cli, sessionId) {
  cli = shellArg(cli); // 1.73.8: one shell word even with a space in the install path
  // 1.113: a conversation started from an entry may fold a same-story duplicate into it; the session id finds that entry
  const sid = typeof sessionId === 'string' && SESSION_RE.test(sessionId) ? sessionId : '<this conversation id>';
  return `This Pocket Code keeps Inbox Watch: the alerts, digests and look-aheads the user's inbox watcher sent. \`node ${cli} list\` shows the new ones (\`--state all\` for the rest, \`show <id>\` for one in full), and \`node ${cli} act <id> resolve|not_useful|dismiss\` records what the user decided; act only when the user asks. In a conversation started from an Inbox entry, \`node ${cli} merge <other id> --session ${sid}\` folds another open entry on the same story into it; say which you merged. The pocket-inbox skill (\`${path.join(path.dirname(cli), '..', 'skills', 'pocket-inbox', 'SKILL.md')}\`) has the procedure.`;
}

const listedLast = e => e.kind === 'digest' ? [...e.items.filter(i => i.section !== 'listed'), ...e.items.filter(i => i.section === 'listed')] : e.items; // the watcher's order otherwise; a look-ahead stays in its order, most pressing first

export class InboxStore {
  constructor(file, { write, now } = {}) {
    this.file = file;
    this.now = now || Date.now;
    this.write = write || ((f, data) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 }); fs.renameSync(tmp, f); });
    let d = {};
    try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { }
    this.entries = Array.isArray(d.entries) ? d.entries.filter(e => e && typeof e.id === 'string' && typeof e.title === 'string' && !Number.isNaN(ms(e.at))).map(e => this.normalize(e)) : [];
    this.sources = {};
    if (d.sources && typeof d.sources === 'object') for (const [k, v] of Object.entries(d.sources)) if (v && !Number.isNaN(ms(v.lastReportAt))) this.sources[source(k)] = { lastReportAt: v.lastReportAt };
    this.profiles = {}; this.watch = {}; this.checks = {};
    if (d.profiles && typeof d.profiles === 'object') for (const [k, v] of Object.entries(d.profiles)) if (v && typeof v === 'object' && v.profile && typeof v.profile === 'object') this.profiles[source(k)] = { at: v.at || null, profile: v.profile };
    if (d.watch && typeof d.watch === 'object') for (const [k, v] of Object.entries(d.watch)) {
      if (!v || typeof v !== 'object') continue;
      let settings = null; try { settings = checkWatch(v.settings ?? null); } catch { settings = null; }
      this.watch[source(k)] = { settings, revision: Number.isInteger(v.revision) && v.revision > 0 ? v.revision : 1, updatedAt: v.updatedAt || null, by: v.by === 'cli' ? 'cli' : 'ui' };
    }
    if (d.checks && typeof d.checks === 'object') for (const [k, v] of Object.entries(d.checks)) if (v && !Number.isNaN(ms(v.at))) this.checks[source(k)] = { at: v.at };
  }
  // A file from an earlier build, or edited by hand, comes back with every field the UI reads.
  normalize(e) {
    const ok = (v, list, d) => list.includes(v) ? v : d;
    const keep = (f, v) => { try { return f(v); } catch { return ''; } };
    const kind = ok(e.kind, KINDS, 'alert');
    return { id: e.id, kind, priority: ok(e.priority, PRIORITIES, 'normal'), title: line(e.title, LIMITS.title), text: str(e.text, textMax(kind)),
      story: line(e.story, LIMITS.story), source: source(e.source), url: keep(checkUrl, e.url), gmail: keep(checkGmail, e.gmail), doc: keep(checkDoc, e.doc), dedupe: str(e.dedupe, DEDUPE_MAX),
      state: ok(e.state, STATES, 'new'), at: e.at, seenAt: e.seenAt || null, actedAt: e.actedAt || null, ackedAt: e.ackedAt || null, note: str(e.note, NOTE_MAX),
      by: e.by === 'ui' ? 'ui' : 'cli', actedBy: e.actedBy === 'ui' || e.actedBy === 'cli' ? e.actedBy : null, revision: Number.isInteger(e.revision) && e.revision > 0 ? e.revision : 1, lastAction: typeof e.lastAction === 'string' ? e.lastAction : null,
      sessions: checkSessions(e.sessions), items: checkItems(e.items, { strict: false }), pushed: e.pushed !== false, why: line(e.why, WHY_MAX),
      updates: Number.isInteger(e.updates) && e.updates > 0 ? e.updates : 0, merged: checkMerged(e.merged), mergedInto: typeof e.mergedInto === 'string' && /^[0-9a-f]{12}$/.test(e.mergedInto) ? e.mergedInto : '',
      news: checkNews(e.news), newsN: Number.isInteger(e.newsN) && e.newsN > 0 ? e.newsN : 0,
      splitFrom: typeof e.splitFrom === 'string' && ENTRY_RE.test(e.splitFrom) ? e.splitFrom : '', fromStory: line(e.fromStory, LIMITS.story), splitAt: e.splitAt || null, splitAcked: e.splitAcked || null };
  }
  save() { this.write(this.file, { version: 1, entries: this.entries, sources: this.sources, profiles: this.profiles, watch: this.watch, checks: this.checks }); }
  get(id) { const e = this.entries.find(x => x.id === id); if (!e) throw fail('That Inbox entry does not exist.', 404, { code: 'inbox_missing' }); return e; }
  view(e) { return { ...e, new: e.state === 'new' }; }
  lastReportAt() { let best = null; for (const s of Object.values(this.sources)) if (!best || ms(s.lastReportAt) > ms(best)) best = s.lastReportAt; return best; }

  // Old entries go: everything after keepDays, a dismissed one after dismissedDays (counted from when it was dismissed).
  prune(now = this.now()) {
    const before = this.entries.length;
    this.entries = this.entries.filter(e => ms(e.at) >= now - LIMITS.keepDays * DAY && !(e.state === 'dismissed' && ms(e.actedAt || e.at) < now - LIMITS.dismissedDays * DAY));
    const gone = before - this.entries.length;
    if (gone) this.save();
    return gone;
  }
  // Over the cap, the oldest entries the owner has already seen go first; unread ones only when nothing else is left.
  cap() {
    let over = this.entries.length - LIMITS.entries;
    if (over <= 0) return;
    const byAge = [...this.entries].sort((a, b) => ms(a.at) - ms(b.at));
    const drop = new Set([...byAge.filter(e => e.state !== 'new'), ...byAge.filter(e => e.state === 'new')].slice(0, over).map(e => e.id));
    this.entries = this.entries.filter(e => !drop.has(e.id));
  }

  // `actor` is 'ui' or 'cli'. A `dedupe` key seen in the last 24 hours returns that entry, marked duplicate, and changes nothing.
  add(input = {}, { actor = 'cli' } = {}) {
    const now = this.now();
    this.prune(now);
    const title = line(input.title, LIMITS.title);
    if (!title) throw fail('An Inbox entry needs a title.', 400, { code: 'no_title' });
    const kind = pick(input.kind, KINDS, 'alert', 'kind');
    const e = { id: shortId(), kind, priority: pick(input.priority, PRIORITIES, 'normal', 'priority'), title, text: str(input.text, textMax(kind)),
      story: line(input.story, LIMITS.story), source: source(input.source), url: checkUrl(input.url), gmail: checkGmail(input.gmail), doc: checkDoc(input.doc), dedupe: str(input.dedupe, DEDUPE_MAX),
      state: 'new', at: iso(now), seenAt: null, actedAt: null, ackedAt: null, note: '', by: actor === 'ui' ? 'ui' : 'cli', actedBy: null, revision: 1, lastAction: null, sessions: [], items: checkItems(input.items, { strict: true }),
      pushed: input.push !== false, why: line(input.why, WHY_MAX), updates: 0, merged: [], mergedInto: '', news: [], newsN: 0, // 1.105: whether the add asked for a push, and the watcher's reason
      splitFrom: '', fromStory: '', splitAt: null, splitAcked: null };
    this.foldListed(e);
    if (e.dedupe) {
      const seen = this.entries.find(x => x.dedupe === e.dedupe && ms(x.at) >= now - DAY);
      if (seen) return { ...this.view(seen), duplicate: true };
    }
    // 1.113 (owner request): an alert on a story that already has an open alert entry updates that entry instead of adding a second one.
    // `merge: false` keeps the old behaviour for a job that wants separate entries.
    const host = input.merge === false ? null : this.splitOn(e) || this.openOnStory(e);
    if (host) return this.update(host, e, now);
    this.entries.push(e); this.foldCards(e); this.cap(); this.save();
    return this.view(e);
  }

  // The open alert entry (new or seen) from the same source on the same story, newest first. Only alerts: a digest or look-ahead
  // links its lines to alerts instead (foldListed).
  openOnStory(e, skip = null) {
    if (e.kind !== 'alert' || !e.story) return null;
    const hits = this.entries.filter(x => x !== skip && x.kind === 'alert' && (x.state === 'new' || x.state === 'opened') && x.source === e.source && x.story === e.story);
    return hits.sort((a, b) => ms(b.at) - ms(a.at))[0] || null;
  }
  // 1.115: the owner split a thread off a story as a separate subject. Until the watcher has moved that thread to its own story
  // (the next check), an alert on it still arrives under the old story: it belongs to the split entry, not back on the old one.
  splitOn(e) {
    if (e.kind !== 'alert' || !e.story || !e.gmail) return null;
    return this.entries.find(x => x.kind === 'alert' && (x.state === 'new' || x.state === 'opened') && x.source === e.source && x.splitFrom && x.fromStory === e.story && x.gmail === e.gmail) || null;
  }
  // The new alert becomes the entry's text, title and links; what the entry said before follows it under EARLIER (one level: an
  // earlier text's own EARLIER part is dropped), cut to fit. The entry is unread again and goes to the top, keeping its id, the
  // conversations started from it and their links. A different Gmail thread joins `merged`, so its label comes off.
  update(host, e, now) {
    const had = { id: '', title: host.title, gmail: host.gmail, url: host.url, at: host.at }, was = { ...had, priority: host.priority, state: host.state };
    if (host.gmail && e.gmail && host.gmail !== e.gmail) host.merged = checkMerged([...host.merged.filter(m => m.gmail !== host.gmail), had]);
    else if (host.url && e.url && host.url !== e.url) host.merged = checkMerged([...host.merged, { ...had, gmail: '' }]); // the old start link still finds this entry
    if (e.gmail) host.merged = host.merged.filter(m => m.gmail !== e.gmail || m.id); // the thread is the entry's own again
    const before = host.text.split(EARLIER)[0].trim(), room = LIMITS.text - e.text.length - EARLIER.length;
    host.text = before && room > 40 ? e.text + EARLIER + (before.length > room ? before.slice(0, room - 1).trimEnd() + '…' : before) : e.text;
    const rank = p => PRIORITIES.length - PRIORITIES.indexOf(p);
    Object.assign(host, { title: e.title, priority: rank(e.priority) >= rank(host.priority) ? e.priority : host.priority, url: e.url || host.url, gmail: e.gmail || host.gmail,
      doc: e.doc || host.doc, dedupe: e.dedupe || host.dedupe, pushed: e.pushed, why: e.why, state: 'new', at: iso(now), by: e.by });
    host.updates += 1; host.revision += 1;
    if (host.sessions.length) this.addNews(host, { kind: 'update', title: e.title, text: e.text, gmail: e.gmail, url: e.url, priority: e.priority, was }, now); // 1.113.1
    this.entries = [...this.entries.filter(x => x !== host), host]; // newest last, as an add would be
    this.foldCards(host); this.save();
    return { ...this.view(host), updated: true };
  }

  // 1.113 (owner request): a conversation started from an entry found another open entry on the same story. The other entry leaves the
  // list (dismissed, with a note naming the entry it went into) and the entry keeps its thread, title and conversations, so the
  // Gmail label comes off the other thread and only one carries it. `into` is the entry's id; `session` finds it from the
  // conversation instead (the entry that conversation was started from). Restore undoes it.
  merge({ id, into, session, note } = {}, { actor = 'cli' } = {}) {
    const e = this.get(str(id, 40));
    let host = null;
    if (into) host = this.get(str(into, 40));
    else if (session) {
      const sid = str(session, 90);
      host = this.entries.filter(x => x.kind === 'alert' && x.sessions.some(s => s.id === sid)).sort((a, b) => ms(b.at) - ms(a.at))[0] || null;
      if (!host) throw fail('No Inbox entry was started from that conversation.', 404, { code: 'inbox_missing' });
    } else throw fail('merge needs the entry to merge into (into) or the conversation started from it (session).', 400, { code: 'bad_merge' });
    if (host === e) throw fail('An entry cannot be merged into itself.', 400, { code: 'bad_merge' });
    if (e.kind !== 'alert' || host.kind !== 'alert') throw fail('Only alerts can be merged.', 400, { code: 'bad_merge' });
    if (!(host.state === 'new' || host.state === 'opened')) throw fail('The entry to merge into is no longer on the list; restore it first.', 400, { code: 'bad_merge' });
    if (!(e.state === 'new' || e.state === 'opened')) throw fail('That entry is no longer on the list.', 400, { code: 'bad_merge' });
    if (e.source !== host.source) throw fail('Both entries must come from the same watcher.', 400, { code: 'bad_merge' });
    if (e.splitFrom === host.id || host.splitFrom === e.id) throw fail('The owner split these two apart as separate subjects. Leave them separate.', 400, { code: 'bad_merge' }); // 1.115
    const at = iso(this.now()), n = typeof note === 'string' && note.trim() ? str(note, NOTE_MAX) : `Merged into "${host.title}".`.slice(0, NOTE_MAX);
    host.merged = checkMerged([...host.merged.filter(m => m.id !== e.id && !(e.gmail && m.gmail === e.gmail)), { id: e.id, title: e.title, gmail: e.gmail === host.gmail ? '' : e.gmail, url: e.url, at: e.at }]);
    // 1.113.1: the host's conversations have not seen the merged entry; the merged entry's conversations have not seen the host's
    // story. The conversation that did the merge (session) found it itself, so it is not behind.
    if (host.sessions.length) this.addNews(host, { kind: 'merge', title: e.title, text: e.text, gmail: e.gmail, from: e.id }, this.now());
    for (const s of e.sessions) remember(host, s.id, s.at, { story: true });
    if (session) this.markCaughtUp(host, str(session, 90));
    host.revision += 1;
    Object.assign(e, { state: 'dismissed', actedAt: at, ackedAt: null, lastAction: 'dismissed', note: n, mergedInto: host.id, actedBy: actor === 'ui' ? 'ui' : 'cli' });
    e.seenAt ||= at; e.revision += 1;
    this.mirrorToCards(e, 'dismiss', at);
    this.save();
    return { entry: this.view(e), into: this.view(host) };
  }

  // 1.113.1 (owner request): an entry updated after a conversation started from it. The conversation catches up (Bring it in, or steered
  // into a reply that is running) instead of a second conversation starting on the same story.
  addNews(host, { kind, title, text, gmail, ...more }, now) {
    host.newsN = (host.newsN || 0) + 1;
    host.news = checkNews([...(host.news || []), { n: host.newsN, at: iso(now), kind, title, text, gmail, ...more }]);
  }
  // What a conversation has not seen on this entry: the news after its `seen`, or the whole story for one that came with a merge.
  // Older news than the kept ones is gone; the entry's text still has the latest under it.
  behindOf(e, sess) {
    if (!sess || sess.handed) return null; // 1.115: handed off; the conversation that took over gets the news
    if (sess.story) return { story: true, news: [] };
    const news = (e.news || []).filter(x => x.n > (sess.seen ?? 0));
    return news.length ? { story: false, news } : null;
  }
  // The open alerts a conversation was started from (or took in by a merge) that have something it has not seen.
  newsFor(session) {
    const sid = str(session, 90); if (!SESSION_RE.test(sid)) return [];
    const out = [];
    for (const e of this.entries) {
      if (e.kind !== 'alert' || !(e.state === 'new' || e.state === 'opened')) continue;
      const b = this.behindOf(e, e.sessions.find(x => x.id === sid));
      if (b) out.push({ id: e.id, title: e.title, story: e.story, gmail: e.gmail, at: e.at, newsN: e.newsN, ...b });
    }
    return out.sort((a, b) => ms(b.at) - ms(a.at));
  }
  // Every conversation of this entry that is behind, for the server to steer the news into a running reply.
  behind(e) { return e.sessions.map(s => ({ session: s.id, behind: this.behindOf(e, s) })).filter(x => x.behind); }
  markCaughtUp(e, sid) {
    const s = e.sessions.find(x => x.id === sid); if (!s) return false;
    s.seen = e.newsN || 0; delete s.story; return true;
  }
  // POST /api/inbox/caught-up: the conversation was given the news (by Bring it in, or steered). `upTo` is the newsN the message
  // carried, so news that arrived in between still shows.
  caughtUp({ session, id, upTo } = {}) {
    const sid = str(session, 90); if (!SESSION_RE.test(sid)) throw fail('caught-up needs the conversation id.', 400, { code: 'bad_session' });
    const list = id ? [this.get(str(id, 40))] : this.entries.filter(e => e.sessions.some(x => x.id === sid));
    let n = 0;
    for (const e of list) {
      const s = e.sessions.find(x => x.id === sid); if (!s) continue;
      const to = Number.isInteger(upTo) && upTo >= 0 ? Math.min(upTo, e.newsN || 0) : e.newsN || 0;
      if (s.story || (s.seen ?? 0) < to) { s.seen = Math.max(s.seen ?? 0, to); delete s.story; n++; }
    }
    if (n) this.save();
    return n;
  }
  // The message that catches a conversation up: written as the owner's next message (Bring it in) or steered into a running reply.
  catchUpText(e, behind, { fmt = v => v, running = false, handoff = false } = {}) {
    const cut = t => t.split(EARLIER)[0].trim();
    // 1.115: New conversation, hand-off from the last one. This conversation does not work the mail; its briefing carries it.
    const ask = handoff ? 'Do not work on this here. Hand this off: write a briefing for a new conversation to pick up from here, with this new mail as the first thing it deals with, and give me the handoff card.'
      : running ? 'When you reach a good point, take this into account and tell me in a few lines what it changes.'
      : 'Read what is new, check it against what we have so far, and tell me in a few lines what it changes.';
    if (behind.story) return `The Inbox entry this conversation started from was merged into "${e.title}", the entry for the same story. What that entry says:\n\n`
      + `${cut(e.text)}${e.gmail ? `\nGmail: ${e.gmail}` : ''}\n\n${ask}`;
    const parts = behind.news.map(x => `${x.kind === 'merge' ? 'Merged in' : 'Update'}, ${fmt(x.at)}: ${x.title}\n${cut(x.text)}${x.gmail ? `\nGmail: ${x.gmail}` : ''}`);
    return `New on this Inbox story since this conversation started ("${e.title}"):\n\n${parts.join('\n\n')}\n\n${ask}`;
  }

  // 1.115 (owner request): a conversation started from an entry was handed off. The conversation that continues it takes its place on the
  // entry (and on any digest card): it is the one later mail goes to, with as much of the news as the old one had. The old one
  // stays listed as handed off and is offered nothing more.
  linkHandoff(from, to) {
    const a = str(from, 90), b = str(to, 90);
    if (!SESSION_RE.test(a) || !SESSION_RE.test(b) || a === b) return [];
    const at = iso(this.now()), out = [];
    const carry = (x, news) => {
      const s = x.sessions.find(y => y.id === a);
      if (!s || s.handed || x.sessions.some(y => y.id === b)) return false;
      const extra = news ? { ...(Number.isInteger(s.seen) ? { seen: s.seen } : x.newsN ? { seen: 0 } : {}), ...(s.story ? { story: true } : {}) } : {};
      s.handed = true;
      x.sessions = [...x.sessions, { id: b, at, ...extra }];
      if (x.sessions.length > SESSIONS_MAX) x.sessions = x.sessions.slice(-SESSIONS_MAX);
      return true;
    };
    for (const e of this.entries) {
      let hit = carry(e, true);
      for (const it of e.items) if (carry(it, false)) hit = true;
      if (hit) { e.revision += 1; out.push(this.view(e)); }
    }
    if (out.length) this.save();
    return out;
  }

  // 1.115 (owner request): "it's really a separate subject". The newest mail an entry took in comes back off as an entry of its own, under
  // a story of its own, and the watcher is told (feedback action 'split') so later mail on that thread stays with it.
  // An update leaves as a new entry and the host goes back to what it said before; a merged entry is restored. `session` is the
  // conversation asking: one that came with a merged entry splits that entry back out.
  splitStory(host, title) {
    const slug = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'separate-subject';
    // The watcher keeps stories Pocket no longer lists, so the key carries a few random characters: it must be a new story there.
    let key;
    do { key = `${slug}-${shortId().slice(0, 4)}`; } while (key === host.story || this.entries.some(x => x.source === host.source && x.story === key));
    return key;
  }
  split({ id, session } = {}, { actor = 'ui' } = {}) {
    const sid = str(session, 90);
    let host = null;
    if (id) host = this.get(str(id, 40));
    else if (sid) host = this.entries.filter(x => x.kind === 'alert' && (x.state === 'new' || x.state === 'opened') && x.sessions.some(s => s.id === sid && !s.handed)).sort((a, b) => ms(b.at) - ms(a.at))[0] || null; // the open entry it is on: a merged entry it came with is off the list
    if (!host) throw fail(id || sid ? 'No Inbox entry was started from that conversation.' : 'split needs the entry (id) or the conversation started from it (session).', id || sid ? 404 : 400, { code: id || sid ? 'inbox_missing' : 'bad_split' });
    if (host.kind !== 'alert') throw fail('Only an alert can be split.', 400, { code: 'bad_split' });
    if (!(host.state === 'new' || host.state === 'opened')) throw fail('That entry is no longer on the list; restore it first.', 400, { code: 'bad_split' });
    const now = this.now(), at = iso(now), who = actor === 'cli' ? 'cli' : 'ui';
    const sess = sid ? host.sessions.find(s => s.id === sid) : null;
    const mergedIn = pick => this.entries.filter(e => e.mergedInto === host.id && e.state === 'dismissed' && pick(e)).sort((a, b) => ms(b.actedAt || b.at) - ms(a.actedAt || a.at))[0] || null;
    let out = sess?.story ? mergedIn(e => e.sessions.some(s => s.id === sid)) : null, x = null;
    if (!out) {
      x = host.news.at(-1) || null;
      if (!x) out = mergedIn(() => true); // no conversation was on the entry, so no news was kept: the last entry merged in, if any
      if (!x && !out) throw fail('Nothing new has come in on this entry, so there is nothing to split off.', 400, { code: 'bad_split' });
      if (x?.kind === 'merge') {
        out = mergedIn(e => x.from ? e.id === x.from : e.title === x.title);
        if (!out) throw fail('The entry that was merged in is gone, so it cannot be split back out.', 400, { code: 'bad_split' });
      }
    }
    let briefUrl = '';
    if (out) { // a merged entry comes back out, as Restore would bring it, and under a story of its own
      briefUrl = out.url;
      Object.assign(out, { state: 'opened', actedAt: at, ackedAt: at, lastAction: 'restore', note: '', mergedInto: '', actedBy: who });
      out.seenAt ||= at;
      if (!out.story || out.story === host.story) out.story = this.splitStory(host, out.title);
      host.merged = host.merged.filter(m => m.id !== out.id);
      host.sessions = host.sessions.filter(s => !(s.story && out.sessions.some(y => y.id === s.id)));
      host.news = host.news.filter(n => !(n.kind === 'merge' && (n.from ? n.from === out.id : n.title === out.title)));
      this.mirrorToCards(out, 'restore', at); this.foldCards(out);
    } else { // an update leaves as a new entry; the host says what it said before
      const was = x.was || null, earlier = host.text.split(EARLIER)[1];
      briefUrl = x.url || host.url;
      out = { id: shortId(), kind: 'alert', priority: x.priority || host.priority, title: x.title, text: x.text, story: this.splitStory(host, x.title), source: host.source, url: briefUrl, gmail: x.gmail || host.gmail, doc: '', dedupe: '',
        state: 'opened', at: x.at || at, seenAt: at, actedAt: null, ackedAt: null, note: '', by: host.by, actedBy: who, revision: 0, lastAction: null, sessions: [], items: [], pushed: false, why: '', updates: 0, merged: [], mergedInto: '', news: [], newsN: 0,
        splitFrom: '', fromStory: '', splitAt: null, splitAcked: null };
      if (earlier) host.text = earlier.trim();
      if (was) {
        if (was.title) host.title = was.title;
        if (was.priority) host.priority = was.priority;
        if (was.at) host.at = was.at;
        if (was.gmail && x.gmail && host.gmail === x.gmail && was.gmail !== x.gmail) host.gmail = was.gmail;
        if (was.url && host.url === briefUrl && was.url !== briefUrl) host.url = was.url;
        host.merged = host.merged.filter(m => m.id || !((m.gmail && m.gmail === host.gmail) || (m.url && m.url === host.url))); // its own thread and start link again
      }
      host.state = 'opened'; host.seenAt ||= at; // the owner has just dealt with what made it unread
      host.updates = Math.max(0, host.updates - 1);
      host.news = host.news.filter(n => n !== x);
      this.entries.push(out);
    }
    Object.assign(out, { splitFrom: host.id, fromStory: host.story, splitAt: at, splitAcked: null });
    host.revision += 1; out.revision += 1;
    this.cap(); this.save();
    // `session`: a conversation the split entry already has (it came back out with its own), so nothing new needs starting
    return { entry: this.view(out), from: this.view(host), briefUrl, session: out.sessions.filter(s => !s.handed).at(-1)?.id || '' };
  }
  // The split entry's own start link, minted by the server once the entry exists.
  relink(id, url) { const e = this.get(str(id, 40)); e.url = checkUrl(url); e.revision += 1; this.save(); return this.view(e); }

  // 1.95 (owner request): nothing already on the owner's list comes back as a new card. A digest item whose story (or Gmail thread) has an
  // open alert entry becomes a 'listed' line that links to that entry (/#/inbox/<id>), whatever section the watcher gave it.
  foldListed(e) {
    if (!e.items.length) return;
    const open = this.entries.filter(x => x.kind === 'alert' && (x.state === 'new' || x.state === 'opened') && x.source === e.source);
    for (const it of e.items) {
      if (HISTORY.includes(it.section)) continue;
      const hit = open.find(x => (it.story && x.story === it.story) || (it.gmail && x.gmail === it.gmail));
      if (hit) { it.section = 'listed'; it.url = '/#/inbox/' + hit.id; }
    }
    e.items = listedLast(e);
  }
  // Every card on the same story or Gmail thread as `x`, in any digest or look-ahead from this source. A history line is never one.
  cards(x, src, skip) {
    const out = [];
    for (const e of this.entries) if (e.source === src) for (const it of e.items) if (it !== skip && it.section !== 'resolved' && it.section !== 'tidied' && sameStory(x, it)) out.push({ e, it });
    return out;
  }
  // One status per item (owner request): an alert that reaches the list after the digest, or comes back to it by Restore, takes over the
  // open cards on its story. Each becomes the line that links to it, and a conversation started from the card moves to the alert.
  // A card already decided Resolved, Not useful or Dismissed stays as it is: this alert is news since that decision.
  foldCards(a) {
    if (a.kind !== 'alert' || !(a.state === 'new' || a.state === 'opened')) return false;
    let changed = false;
    for (const { e, it } of this.cards(a, a.source)) {
      if (it.section === 'listed' || !(it.state === 'open' || it.state === 'alerted')) continue;
      it.section = 'listed'; it.url = '/#/inbox/' + a.id;
      for (const s of it.sessions) remember(a, s.id, s.at);
      e.items = listedLast(e); e.revision += 1; changed = true;
    }
    return changed;
  }
  // The other way: a decision on an alert shows on the lines that link to it, at once. It is the alert's decision, so the worker
  // hears it once, from the alert; these lines are acked as they are written and never reach feedback().
  mirrorToCards(a, action, at) {
    const url = '/#/inbox/' + a.id, target = ITEM_TARGET[action];
    for (const { e, it } of this.cards(a, a.source)) {
      if (it.section !== 'listed' || it.url !== url || it.state === target) continue;
      Object.assign(it, { state: target, actedAt: at, ackedAt: at, lastAction: action }); e.revision += 1;
    }
  }

  // state: 'new' (unread), 'all' (everything but dismissed) or 'dismissed'. Newest first; `since` keeps entries at or after it.
  snapshot({ state = 'new', since, now = this.now() } = {}) {
    if (!['new', 'all', 'dismissed'].includes(state)) throw fail('Unknown filter. Use new, all or dismissed.', 400, { code: 'bad_state' });
    const from = checkSince(since);
    this.prune(now);
    const keep = e => (state === 'new' ? e.state === 'new' : state === 'dismissed' ? e.state === 'dismissed' : e.state !== 'dismissed') && (from == null || ms(e.at) >= from);
    const entries = this.entries.map((e, i) => [e, i]).filter(([e]) => keep(e)).sort(([a, i], [b, j]) => ms(b.at) - ms(a.at) || j - i).map(([e]) => this.view(e));
    return { version: 1, now, entries, newCount: this.entries.filter(e => e.state === 'new').length, lastReportAt: this.lastReportAt(), sources: structuredClone(this.sources), paused: this.paused(), gmailLabel: this.gmailLabel() };
  }
  // 1.103: the Gmail label, when it is on and the watcher can change it ({name}), else null. Dismiss and the row's X say
  // the label comes off in Gmail only when it will.
  gmailLabel() {
    const key = this.watchSource(), p = this.profiles[key]?.profile, opt = p?.options?.gmailLabel;
    if (!opt || typeof opt !== 'object' || opt.available === false) return null;
    const on = this.watch[key]?.settings?.gmailLabel?.enabled ?? p?.defaults?.gmailLabel?.enabled;
    return on === true ? { name: typeof opt.name === 'string' && opt.name.trim() ? opt.name.trim().slice(0, 60) : 'Pocket Inbox' } : null;
  }

  // open marks it seen and unread takes that back; dismiss / resolve / not_useful record the owner's decision for the worker;
  // restore undoes one.
  // A repeat of what is already recorded changes nothing, so the worker never applies the same decision twice.
  // 1.95: with `item` (a digest item's ref) the decision is the item's: alert (promote it to an alert of its own), resolve,
  // not_useful, or restore to undo. Deciding on an item also reads the entry.
  act({ action, id, item, note } = {}, { actor = 'ui' } = {}) {
    const a = str(action, 40);
    if (item != null && item !== '') return this.actItem({ action: a, id, item, note }, { actor });
    if (!ACTIONS.includes(a)) throw fail('Unknown action. Use open, unread, dismiss, resolve, not_useful or restore.', 400, { code: 'bad_action' });
    const e = this.get(str(id, 40));
    const at = iso(this.now()), n = typeof note === 'string' ? str(note, NOTE_MAX) : null;
    let changed = false;
    if (a === 'open') {
      if (e.state === 'new') { e.state = 'opened'; changed = true; }
      if (!e.seenAt) { e.seenAt = at; changed = true; }
    } else if (a === 'unread') {
      if (e.state === 'opened') { e.state = 'new'; changed = true; } // a finished entry stays finished; restore it first
    } else if (a === 'restore') {
      if (ACTED.includes(e.state)) {
        e.state = 'opened'; e.seenAt ||= at; e.actedAt = at; e.ackedAt = null; e.lastAction = 'restore'; if (n != null) e.note = n; changed = true; this.mirrorToCards(e, 'restore', at); this.foldCards(e);
        if (e.mergedInto) { const h = this.entries.find(x => x.id === e.mergedInto); if (h) { h.merged = h.merged.filter(m => m.id !== e.id); h.sessions = h.sessions.filter(x => !(x.story && e.sessions.some(y => y.id === x.id))); h.revision += 1; } e.mergedInto = ''; } // 1.113: out of the entry it went into
      }
    } else {
      const target = TARGET[a];
      if (e.state !== target || (n != null && n !== e.note)) { e.state = target; e.actedAt = at; e.ackedAt = null; e.lastAction = target; if (n != null) e.note = n; changed = true; this.mirrorToCards(e, a, at); }
    }
    if (changed) { e.revision += 1; e.actedBy = actor === 'cli' ? 'cli' : 'ui'; this.save(); }
    return this.view(e);
  }
  actItem({ action, id, item, note } = {}, { actor = 'ui' } = {}) {
    if (!ITEM_ACTIONS.includes(action)) throw fail('Unknown item action. Use alert, resolve, not_useful, dismiss or restore.', 400, { code: 'bad_action' });
    const e = this.get(str(id, 40)), ref = str(item, LIMITS.ref);
    const it = e.items.find(x => x.ref === ref);
    if (!it) throw fail('That entry has no such item.', 404, { code: 'item_missing' });
    if (HISTORY.includes(it.section)) throw fail(it.section === 'listed' ? 'That line is already on your list; decide on its own entry.' : 'That line is history; there is nothing to decide.', 400, { code: 'item_history' });
    const at = iso(this.now()), n = typeof note === 'string' ? str(note, NOTE_MAX) : null, target = ITEM_TARGET[action];
    const was = it.state;
    let changed = false;
    if (action === 'restore') {
      if (ITEM_ACTED.includes(it.state)) { it.state = 'open'; it.actedAt = at; it.ackedAt = null; it.lastAction = 'restore'; if (n != null) it.note = n; changed = true; }
    } else if (it.state !== target || (n != null && n !== it.note)) { it.state = target; it.actedAt = at; it.ackedAt = null; it.lastAction = action; if (n != null) it.note = n; changed = true; }
    // The same story on another morning's digest follows this card. The worker hears the decision once, from this card.
    if (it.state !== was) for (const { e: o, it: c } of this.cards(it, e.source, it)) {
      if (c.section === 'listed' || c.state !== was) continue;
      Object.assign(c, { state: it.state, actedAt: at, ackedAt: at, lastAction: action }); o.revision += 1;
    }
    if (e.state === 'new') { e.state = 'opened'; changed = true; }
    if (!e.seenAt) { e.seenAt = at; changed = true; }
    if (changed) { e.revision += 1; e.actedBy = actor === 'cli' ? 'cli' : 'ui'; this.save(); }
    return this.view(e);
  }

  // 1.77: a conversation was started from a start link. Every entry that opens that link remembers it (at most SESSIONS_MAX,
  // the oldest dropped), and an unread one is read: starting from it means it was read, even straight from a push.
  // Returns the entries changed; an unknown link or a session already recorded changes nothing.
  linkStart(startId, session) {
    const sid = str(startId, 20), sess = str(session, 90);
    if (!START_RE.test(sid) || !SESSION_RE.test(sess)) return [];
    const tail = '#/start/' + sid, at = iso(this.now()), out = [];
    for (const e of this.entries) {
      let hit = (e.url.endsWith(tail) || e.merged.some(m => m.url.endsWith(tail))) && remember(e, sess, at, e.url.endsWith(tail) ? {} : { story: true }); // 1.113: a start link the entry took in (briefed with older news, so it catches up on the story)
      for (const it of e.items) if (it.url.endsWith(tail) && remember(it, sess, at)) { // 1.95: a card's own start link; a card on the same story elsewhere shows it too
        hit = true;
        for (const { it: c } of this.cards(it, e.source, it)) remember(c, sess, at);
      }
      if (!hit) continue;
      if (e.state === 'new') e.state = 'opened';
      e.seenAt ||= at;
      out.push(this.view(e));
    }
    if (out.length) this.save();
    return out;
  }

  // The owner's decisions the worker has not applied yet, newest first.
  // 1.95: a digest item's decision is listed too, as kind 'digest-item' with id '<entry>/<ref>', `entry`, `item` (the ref) and
  // action 'alert', 'resolved', 'not_useful' or 'restore'; its title and story are the item's.
  feedback({ since } = {}) {
    const from = checkSince(since);
    const out = this.entries.filter(e => e.actedAt && e.ackedAt == null && (ACTED.includes(e.state) || e.lastAction === 'restore') && (from == null || ms(e.actedAt) >= from))
      .map(e => ({ id: e.id, action: e.lastAction === 'restore' ? 'restore' : e.state, at: e.actedAt, note: e.note, title: e.title, story: e.story, source: e.source, kind: e.kind,
        ...(e.mergedInto && e.state === 'dismissed' ? { mergedInto: e.mergedInto, intoStory: this.entries.find(x => x.id === e.mergedInto)?.story || '' } : {}) })); // 1.113
    // 1.115: a split is told on its own id ('<entry>:split'), so a later decision on the entry never replaces it
    for (const e of this.entries) if (e.splitAt && e.splitAcked == null && (from == null || ms(e.splitAt) >= from))
      out.push({ id: `${e.id}:split`, entry: e.id, action: 'split', at: e.splitAt, note: '', title: e.title, story: e.story, source: e.source, kind: e.kind, from: e.splitFrom, fromStory: e.fromStory, gmail: e.gmail });
    for (const e of this.entries) for (const it of e.items) {
      if (!it.actedAt || it.ackedAt != null || !(ITEM_ACTED.includes(it.state) || it.lastAction === 'restore') || (from != null && ms(it.actedAt) < from)) continue;
      out.push({ id: `${e.id}/${it.ref}`, entry: e.id, item: it.ref, action: it.lastAction === 'restore' ? 'restore' : it.state === 'alerted' ? 'alert' : it.state, at: it.actedAt, note: it.note, title: it.title, story: it.story, text: it.text, gmail: it.gmail, priority: it.priority, source: e.source, kind: 'digest-item' });
    }
    return out.sort((a, b) => ms(b.at) - ms(a.at));
  }
  // The worker applied these; they leave feedback until the owner decides again. An item's id is '<entry>/<ref>'.
  ack(ids) {
    if (!Array.isArray(ids) || ids.length > LIMITS.entries * 4 || ids.some(x => typeof x !== 'string')) throw fail('ids: a list of Inbox entry ids.', 400, { code: 'bad_ids' });
    const want = new Set(ids), at = iso(this.now());
    let n = 0;
    for (const e of this.entries) {
      if (want.has(e.id) && e.actedAt && e.ackedAt == null) { e.ackedAt = at; n++; }
      if (want.has(`${e.id}:split`) && e.splitAt && e.splitAcked == null) { e.splitAcked = at; n++; }
      for (const it of e.items) if (want.has(`${e.id}/${it.ref}`) && it.actedAt && it.ackedAt == null) { it.ackedAt = at; n++; }
    }
    if (n) this.save();
    return n;
  }
  // A worker's heartbeat: when each source last reported, so Pocket can say "hasn't reported since …". Never moves back.
  // 1.70: it may carry the worker's profile (defaults, choices, status, usage), which replaces the last one.
  seen(src, at = this.now(), profile) {
    const t = typeof at === 'number' ? at : Date.parse(String(at));
    if (Number.isNaN(t)) throw fail('at must be a date and time (ISO).', 400, { code: 'bad_at' });
    const p = profile === undefined ? undefined : checkProfile(profile);
    const key = source(src), when = iso(Math.min(t, this.now()));
    const prev = this.sources[key]?.lastReportAt;
    let changed = false;
    if (!prev || ms(when) > ms(prev)) { this.sources[key] = { lastReportAt: when }; changed = true; }
    if (p) { this.profiles[key] = { at: when, profile: p }; changed = true; }
    if (changed) this.save();
    return this.sources[key];
  }
  // The watcher to show in Settings: the one that reported a profile most recently, else the default name.
  watchSource() {
    let best = null;
    for (const [k, v] of Object.entries(this.profiles)) if (!best || ms(v.at) > ms(this.profiles[best].at)) best = k;
    return best || 'inbox-monitor';
  }
  // Everything Settings → Inbox Watch needs: the owner's settings (null = the watcher's config file), and the watcher's report.
  watchView(src) {
    const key = src ? source(src) : this.watchSource(), w = this.watch[key] || { settings: null, revision: 0, updatedAt: null, by: null };
    return { source: key, settings: w.settings, revision: w.revision, updatedAt: w.updatedAt, by: w.by, profile: this.profiles[key]?.profile || null,
      profileAt: this.profiles[key]?.at || null, lastReportAt: this.sources[key]?.lastReportAt || null, checkRequestedAt: this.checks[key]?.at || null };
  }
  // 1.75: Check now. A second press while the first is still on its way changes nothing; once the watcher reports it done
  // (or ten minutes on, if it never does) a press is a new request.
  requestCheck(src) {
    const key = src ? source(src) : this.watchSource(), at = iso(this.now()), prev = this.checks[key]?.at;
    const done = this.profiles[key]?.profile?.status?.checkRequestDone;
    if (!prev || (done && ms(done) >= ms(prev)) || this.now() - ms(prev) > 10 * 60_000) { this.checks[key] = { at: prev && ms(prev) >= ms(at) ? iso(ms(prev) + 1000) : at }; this.save(); }
    return this.watchView(key);
  }
  // null goes back to the watcher's config file. Each save is a new revision; the worker reports which one it applied.
  setWatch(src, settings, { actor = 'ui' } = {}) {
    const key = source(src), profile = this.profiles[key]?.profile || null;
    const clean = checkWatch(settings === undefined ? null : settings, profile);
    const prev = this.watch[key];
    this.watch[key] = { settings: clean, revision: (prev?.revision || 0) + 1, updatedAt: iso(this.now()), by: actor === 'cli' ? 'cli' : 'ui' };
    this.save();
    return this.watchView(key);
  }
  // Paused, as the owner set it (or the watcher last reported it): the list does not call a paused watcher silent.
  paused() {
    const key = this.watchSource(), w = this.watch[key]?.settings;
    if (w && typeof w.paused === 'boolean') return w.paused;
    return Boolean(this.profiles[key]?.profile?.status?.paused);
  }
}
