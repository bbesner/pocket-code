// Inbox (1.69): what the owner's inbox watcher (inbox-monitor, or any job) sent, kept where it can be read and answered.
// One JSON file in the data directory, written atomically: entries (an alert, a digest or a look-ahead) and, per source,
// when it last reported. The owner opens, dismisses, resolves or marks an entry not useful; the worker reads those
// decisions back through feedback() and acks them, which is how an X in Pocket changes what the watcher sends next.
// Nothing here sends anything: the server pushes and mails on add, the worker runs on its own timer outside Pocket.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const LIMITS = { entries: 500, text: 2000, title: 160, story: 120, source: 60, keepDays: 60, dismissedDays: 30 };
export const KINDS = ['alert', 'digest', 'lookahead'];
export const PRIORITIES = ['critical', 'high', 'normal', 'low'];
export const STATES = ['new', 'opened', 'dismissed', 'resolved', 'not_useful'];
export const ACTIONS = ['open', 'dismiss', 'resolve', 'not_useful', 'restore'];
const ACTED = ['dismissed', 'resolved', 'not_useful'];
const TARGET = { dismiss: 'dismissed', resolve: 'resolved', not_useful: 'not_useful' };
const NOTE_MAX = 300, URL_MAX = 500, DEDUPE_MAX = 200, DAY = 86400_000;
const DOC_RE = /^[0-9a-f]{12}$/;
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

// The agent's one line while Inbox Watch is on. It reads the list when the user asks about it and records a decision only
// when the user makes one; it never dismisses or resolves on its own judgment.
export function inboxInstructions(cli, sessionId) {
  void sessionId; // entries are not tied to a session; the argument keeps the shape of the other instruction lines
  return `This Pocket Code keeps Inbox Watch: the alerts, digests and look-aheads the user's inbox watcher sent. \`node ${cli} list\` shows the new ones (\`--state all\` for the rest, \`show <id>\` for one in full), and \`node ${cli} act <id> resolve|not_useful|dismiss\` records what the user decided; act only when the user asks. The pocket-inbox skill (\`${path.join(path.dirname(cli), '..', 'skills', 'pocket-inbox', 'SKILL.md')}\`) has the procedure.`;
}

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
  }
  // A file from an earlier build, or edited by hand, comes back with every field the UI reads.
  normalize(e) {
    const ok = (v, list, d) => list.includes(v) ? v : d;
    const keep = (f, v) => { try { return f(v); } catch { return ''; } };
    return { id: e.id, kind: ok(e.kind, KINDS, 'alert'), priority: ok(e.priority, PRIORITIES, 'normal'), title: line(e.title, LIMITS.title), text: str(e.text, LIMITS.text),
      story: line(e.story, LIMITS.story), source: source(e.source), url: keep(checkUrl, e.url), gmail: keep(checkGmail, e.gmail), doc: keep(checkDoc, e.doc), dedupe: str(e.dedupe, DEDUPE_MAX),
      state: ok(e.state, STATES, 'new'), at: e.at, seenAt: e.seenAt || null, actedAt: e.actedAt || null, ackedAt: e.ackedAt || null, note: str(e.note, NOTE_MAX),
      by: e.by === 'ui' ? 'ui' : 'cli', actedBy: e.actedBy === 'ui' || e.actedBy === 'cli' ? e.actedBy : null, revision: Number.isInteger(e.revision) && e.revision > 0 ? e.revision : 1, lastAction: typeof e.lastAction === 'string' ? e.lastAction : null };
  }
  save() { this.write(this.file, { version: 1, entries: this.entries, sources: this.sources }); }
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
    const e = { id: shortId(), kind: pick(input.kind, KINDS, 'alert', 'kind'), priority: pick(input.priority, PRIORITIES, 'normal', 'priority'), title, text: str(input.text, LIMITS.text),
      story: line(input.story, LIMITS.story), source: source(input.source), url: checkUrl(input.url), gmail: checkGmail(input.gmail), doc: checkDoc(input.doc), dedupe: str(input.dedupe, DEDUPE_MAX),
      state: 'new', at: iso(now), seenAt: null, actedAt: null, ackedAt: null, note: '', by: actor === 'ui' ? 'ui' : 'cli', actedBy: null, revision: 1, lastAction: null };
    if (e.dedupe) {
      const seen = this.entries.find(x => x.dedupe === e.dedupe && ms(x.at) >= now - DAY);
      if (seen) return { ...this.view(seen), duplicate: true };
    }
    this.entries.push(e); this.cap(); this.save();
    return this.view(e);
  }

  // state: 'new' (unread), 'all' (everything but dismissed) or 'dismissed'. Newest first; `since` keeps entries at or after it.
  snapshot({ state = 'new', since, now = this.now() } = {}) {
    if (!['new', 'all', 'dismissed'].includes(state)) throw fail('Unknown filter. Use new, all or dismissed.', 400, { code: 'bad_state' });
    const from = checkSince(since);
    this.prune(now);
    const keep = e => (state === 'new' ? e.state === 'new' : state === 'dismissed' ? e.state === 'dismissed' : e.state !== 'dismissed') && (from == null || ms(e.at) >= from);
    const entries = this.entries.map((e, i) => [e, i]).filter(([e]) => keep(e)).sort(([a, i], [b, j]) => ms(b.at) - ms(a.at) || j - i).map(([e]) => this.view(e));
    return { version: 1, now, entries, newCount: this.entries.filter(e => e.state === 'new').length, lastReportAt: this.lastReportAt(), sources: structuredClone(this.sources) };
  }

  // open marks it seen; dismiss / resolve / not_useful record the owner's decision for the worker; restore undoes one.
  // A repeat of what is already recorded changes nothing, so the worker never applies the same decision twice.
  act({ action, id, note } = {}, { actor = 'ui' } = {}) {
    const a = str(action, 40);
    if (!ACTIONS.includes(a)) throw fail('Unknown action. Use open, dismiss, resolve, not_useful or restore.', 400, { code: 'bad_action' });
    const e = this.get(str(id, 40));
    const at = iso(this.now()), n = typeof note === 'string' ? str(note, NOTE_MAX) : null;
    let changed = false;
    if (a === 'open') {
      if (e.state === 'new') { e.state = 'opened'; changed = true; }
      if (!e.seenAt) { e.seenAt = at; changed = true; }
    } else if (a === 'restore') {
      if (ACTED.includes(e.state)) { e.state = 'opened'; e.seenAt ||= at; e.actedAt = at; e.ackedAt = null; e.lastAction = 'restore'; if (n != null) e.note = n; changed = true; }
    } else {
      const target = TARGET[a];
      if (e.state !== target || (n != null && n !== e.note)) { e.state = target; e.actedAt = at; e.ackedAt = null; e.lastAction = target; if (n != null) e.note = n; changed = true; }
    }
    if (changed) { e.revision += 1; e.actedBy = actor === 'cli' ? 'cli' : 'ui'; this.save(); }
    return this.view(e);
  }

  // The owner's decisions the worker has not applied yet, newest first.
  feedback({ since } = {}) {
    const from = checkSince(since);
    return this.entries.filter(e => e.actedAt && e.ackedAt == null && (ACTED.includes(e.state) || e.lastAction === 'restore') && (from == null || ms(e.actedAt) >= from))
      .sort((a, b) => ms(b.actedAt) - ms(a.actedAt))
      .map(e => ({ id: e.id, action: e.lastAction === 'restore' ? 'restore' : e.state, at: e.actedAt, note: e.note, title: e.title, story: e.story, source: e.source, kind: e.kind }));
  }
  // The worker applied these; they leave feedback until the owner decides again.
  ack(ids) {
    if (!Array.isArray(ids) || ids.length > LIMITS.entries || ids.some(x => typeof x !== 'string')) throw fail('ids: a list of Inbox entry ids.', 400, { code: 'bad_ids' });
    const want = new Set(ids), at = iso(this.now());
    let n = 0;
    for (const e of this.entries) if (want.has(e.id) && e.actedAt && e.ackedAt == null) { e.ackedAt = at; n++; }
    if (n) this.save();
    return n;
  }
  // A worker's heartbeat: when each source last reported, so Pocket can say "hasn't reported since …". Never moves back.
  seen(src, at = this.now()) {
    const t = typeof at === 'number' ? at : Date.parse(String(at));
    if (Number.isNaN(t)) throw fail('at must be a date and time (ISO).', 400, { code: 'bad_at' });
    const key = source(src), when = iso(Math.min(t, this.now()));
    const prev = this.sources[key]?.lastReportAt;
    if (!prev || ms(when) > ms(prev)) { this.sources[key] = { lastReportAt: when }; this.save(); }
    return this.sources[key];
  }
}
