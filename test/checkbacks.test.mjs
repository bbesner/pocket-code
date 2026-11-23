// 1.119: check-backs, the pure parts (checkbacks.mjs): reading the time an agent gives, the range, the message the later
// reply starts with, the push's first line, the store (atomic, pruned, a stable view), the instruction lines and the skill.
// The routes, who may set one, and the runner are tested on the real server in test/checkback-routes.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCheckbackWhen, rangeError, spanText, lateText, checkbackMessage, firstLine, checkbackInstructions, CheckbackStore, view, KEEP } from '../checkbacks.mjs';
import { taskInstructions } from '../tasks.mjs';
import { syncSkills, SKILLS } from '../skills.mjs';

const NOW = Date.parse('2026-11-20T15:00:00Z');
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cb-unit-')));

test('the time: +Nm, +Nh, +Nd and their long forms, a date and time in the owner\'s zone, an ISO time; anything else is refused in words', () => {
  const at = s => parseCheckbackWhen(s, { now: NOW, zone: 'America/New_York' });
  assert.equal(at('+15m'), NOW + 15 * 60_000);
  assert.equal(at('+15 min'), NOW + 15 * 60_000);
  assert.equal(at('+2h'), NOW + 2 * 3600_000);
  assert.equal(at('+2 hours'), NOW + 2 * 3600_000);
  assert.equal(at('+1d'), NOW + 86400_000);
  assert.equal(at('+3 days'), NOW + 3 * 86400_000);
  assert.equal(at('2026-11-22 09:00'), Date.parse('2026-11-22T14:00:00Z'), 'a time without an offset is the owner\'s');
  assert.equal(at('2026-11-22T09:00:00Z'), Date.parse('2026-11-22T09:00:00Z'));
  for (const bad of ['', 'tomorrow', 'friday 9am', '+15', '+m', '15m', '+15s']) {
    assert.throws(() => at(bad), e => e.status === 400 && /"\+15m"/.test(e.message), JSON.stringify(bad));
  }
  assert.throws(() => at('friday 9am'), /Convert a day name such as Friday to its date/);
});

test('the range names its ends; the words for a span and for lateness', () => {
  const r = (ms, o = {}) => rangeError(NOW + ms, { now: NOW, soonestMin: 1, furthestHours: 2160, ...o });
  assert.equal(r(60_000), null);
  assert.equal(r(2160 * 3600_000), null);
  assert.equal(r(30_000), 'A check-back can be set from 1 minute to 90 days ahead.');
  assert.equal(r(2160 * 3600_000 + 60_000), 'A check-back can be set from 1 minute to 90 days ahead.');
  assert.equal(r(-60_000), 'A check-back can be set from 1 minute to 90 days ahead.', 'a time in the past');
  assert.equal(r(10 * 60_000, { soonestMin: 15, furthestHours: 36 }), 'A check-back can be set from 15 minutes to 36 hours ahead.');
  assert.equal(rangeError(NaN, { now: NOW, soonestMin: 1, furthestHours: 1 }), 'A check-back can be set from 1 minute to 1 hour ahead.');
  assert.equal(spanText(8760 * 3600_000), '365 days');
  assert.deepEqual([lateText(10_000), lateText(40 * 60_000), lateText(190 * 60_000), lateText(3 * 3600_000), lateText(52 * 3600_000)], ['1 minute', '40 minutes', '3 h 10 min', '3 h', '2 days 4 h']);
});

test('the message: who set it, where it is in its chain, what to check, the time now, how late, and whether it may set another', () => {
  const fmt = ms => new Date(ms).toISOString().slice(11, 16);
  const cb = { note: 'Check the status page shows 1.4.2', createdAt: '2026-11-20T14:45:00Z', dueAt: '2026-11-20T15:00:00Z', chainDepth: 0 };
  assert.equal(checkbackMessage(cb, { now: NOW, fmt, chainLimit: 5 }),
    '[Pocket check-back · set at 14:45 at your request · 1 of 6]\nWhat to check: Check the status page shows 1.4.2\n'
    + 'It is now 15:00. Do the check and reply briefly with the result. If it isn\'t settled yet you may set one more check-back; say when.');
  const late = checkbackMessage({ ...cb, chainDepth: 2 }, { now: NOW + 3 * 3600_000, fmt, chainLimit: 2, late: 3 * 3600_000 });
  assert.match(late, /^\[Pocket check-back · set at 14:45 by an earlier check-back · 3 of 3\]\n/);
  assert.match(late, /It is now 18:00\. This check-back was due at 15:00 and runs 3 h late\./);
  assert.match(late, /This is the last check-back this chain may set\. If it isn't settled, say what is still open so the owner can decide\.$/);
  assert.match(checkbackMessage(cb, { now: NOW, fmt, chainLimit: 0 }), /· 1 of 1\][\s\S]*This is the last check-back/, 'chain limit 0: the first is the last');
});

test('the push line: the last message with text, its first line with words, without Markdown, cut to length', () => {
  const m = (...texts) => ({ blocks: texts.map(t => ({ t: 'text', text: t })) });
  assert.equal(firstLine([m('Looking at the page.'), { blocks: [{ t: 'tool', name: 'Bash' }] }, m('\n## **Live:** the page shows `1.4.2`\n\nDetails follow.')]), 'Live: the page shows 1.4.2');
  assert.equal(firstLine([m('- Not yet: still 1.4.1')]), 'Not yet: still 1.4.1');
  assert.equal(firstLine([]), '');
  assert.equal(firstLine([m('x'.repeat(300))]).length, 160);
});

test('the store: added, updated and finished atomically, read back after a restart, finished ones pruned; the view has no moving field', () => {
  const dir = tmp(), file = path.join(dir, 'data', 'checkbacks.json');
  let clock = NOW;
  const st = new CheckbackStore(file, { now: () => clock });
  const a = st.add({ sessionId: '11111111-2222-3333-4444-555555555555', engine: 'claude', note: 'n1', dueAt: NOW + 60_000, chainDepth: 0, run: { approvalMode: 'full' }, createdByTurn: { startedAt: '2026-11-20T14:59:00Z', origin: 'owner' } });
  assert.match(a.id, /^cb-[0-9a-f]{8}$/);
  assert.deepEqual([a.status, a.dueAt, a.createdAt, a.heldReasons], ['pending', '2026-11-20T15:01:00Z', '2026-11-20T15:00:00Z', []]);
  assert.equal((fs.statSync(file).mode & 0o777), 0o600);
  assert.ok(!fs.existsSync(file + '.tmp'));
  const b = st.add({ sessionId: 'cx:11111111-2222-3333-4444-555555555556', engine: 'codex', note: 'n2', dueAt: NOW + 120_000 });
  st.update(b.id, { status: 'held', held: { reason: 'paused', since: '2026-11-20T15:00:00Z' } });
  assert.deepEqual(st.waiting().map(c => c.id), [a.id, b.id]);
  st.update(b.id, { held: undefined, status: 'pending' });
  assert.ok(!('held' in st.get(b.id)), 'undefined removes a field');
  const done = st.finish(a.id, 'done', 'ok', 'Live');
  assert.deepEqual(done.outcome, { at: '2026-11-20T15:00:00Z', kind: 'ok', summary: 'Live' });
  assert.throws(() => st.add({ sessionId: '../etc', engine: 'claude', note: 'x', dueAt: NOW }), /not a conversation id/);
  assert.throws(() => st.must('cb-00000000'), e => e.status === 404);
  // a restart reads the same entries
  const again = new CheckbackStore(file, { now: () => clock });
  assert.deepEqual(again.items, st.items);
  // a view is the same on every read while nothing changes
  assert.deepEqual(view(again.get(a.id)), view(st.get(a.id)));
  assert.deepEqual(Object.keys(view(st.get(a.id))).sort(), ['chainDepth', 'createdAt', 'dueAt', 'engine', 'id', 'note', 'outcome', 'sessionId', 'status', 'turnStartedAt']);
  // a finished entry older than the keep window is dropped at the next write; active ones stay however old
  clock = NOW + KEEP.finishedMs + 1000;
  st.update(b.id, { note: 'n2b' });
  assert.deepEqual(st.items.map(c => c.id), [b.id]);
  // a bad file reads as empty, and an entry with a bad status or time is dropped
  fs.writeFileSync(file, JSON.stringify({ version: 1, checkbacks: [{ id: 'cb-1', sessionId: 's-123456', status: 'weird', dueAt: '2026-11-20T15:00:00Z' }, { id: 'cb-2', sessionId: 's-123456', status: 'pending', dueAt: 'never' }] }));
  assert.deepEqual(new CheckbackStore(file).items, []);
  fs.writeFileSync(file, 'not json');
  assert.deepEqual(new CheckbackStore(file).items, []);
});

test('a failed write changes nothing in memory', () => {
  let fail = false;
  const st = new CheckbackStore(path.join(tmp(), 'cb.json'), { now: () => NOW, write: () => { if (fail) throw new Error('disk full'); } });
  const a = st.add({ sessionId: 'sess-123456', engine: 'claude', note: 'n', dueAt: NOW + 60_000 });
  fail = true;
  assert.throws(() => st.update(a.id, { status: 'running' }), /disk full/);
  assert.equal(st.get(a.id).status, 'pending');
});

test('the instruction lines: what to run, only when asked, Codex needs Full access; the Tasks line prefers a check-back only when on', () => {
  const claude = checkbackInstructions('/opt/pocket/scripts/pocket-checkback.mjs', 'claude');
  assert.match(claude, /`node \/opt\/pocket\/scripts\/pocket-checkback\.mjs add --at "\+15m" --note/);
  assert.match(claude, /only when the user asked for one in this conversation/);
  assert.match(claude, /\/opt\/pocket\/skills\/pocket-checkback\/SKILL\.md/);
  assert.doesNotMatch(claude, /Full access/);
  assert.match(checkbackInstructions('/opt/pocket/scripts/pocket-checkback.mjs', 'codex'), /In Codex a check-back works only under Full access/);
  assert.match(checkbackInstructions('/opt/my pocket/scripts/pocket-checkback.mjs', 'claude'), /node '\/opt\/my pocket\/scripts\/pocket-checkback\.mjs' add/, 'a path with a space is quoted');
  assert.doesNotMatch(taskInstructions('/x/pocket-tasks.mjs', 's1'), /check-back/);
  assert.doesNotMatch(taskInstructions('/x/pocket-tasks.mjs', 's1', { checkbacks: false }), /check-back/);
  assert.match(taskInstructions('/x/pocket-tasks.mjs', 's1', { checkbacks: true }), /offer a check-back instead of a task \(pocket-checkback\)/);
});

test('the skill is installed only while check-backs are on, names the command on this server, and goes when they are turned off', () => {
  const root = path.join(tmp(), 'skills'), commands = { board: '/p/b.mjs', docs: '/p/d.mjs', tasks: '/p/t.mjs', vault: '/p/v.mjs', inbox: '/p/i.mjs', coord: '/p/c.mjs', checkback: '/p/scripts/pocket-checkback.mjs' };
  const env = { HOME: path.dirname(root) };
  assert.ok(SKILLS.some(s => s.name === 'pocket-checkback' && s.feature === 'checkbacks'));
  syncSkills({ settings: { checkbacks: false }, commands, env, roots: [root], codexRoots: [] });
  assert.ok(!fs.existsSync(path.join(root, 'pocket-checkback')));
  syncSkills({ settings: { checkbacks: true }, commands, env, roots: [root], codexRoots: [] });
  const text = fs.readFileSync(path.join(root, 'pocket-checkback', 'SKILL.md'), 'utf8');
  assert.match(text, /On this server, run `pocket-checkback` as `node \/p\/scripts\/pocket-checkback\.mjs`/);
  assert.match(text, /docs\/manual\/automation\.md/);
  assert.match(text, /^name: pocket-checkback$/m);
  syncSkills({ settings: { checkbacks: false }, commands, env, roots: [root], codexRoots: [] });
  assert.ok(!fs.existsSync(path.join(root, 'pocket-checkback')), 'removed when turned off');
});

test('1.124.3: a checkbacks.json that does not parse is kept aside and logged, and the next change does not replace it', () => {
  const dir = tmp(), file = path.join(dir, 'checkbacks.json');
  const a = new CheckbackStore(file, { now: () => NOW });
  for (let i = 0; i < 3; i++) a.add({ sessionId: '11111111-2222-3333-4444-55555555555' + i, engine: 'claude', note: 'n' + i, dueAt: NOW + 60_000 });
  const torn = fs.readFileSync(file, 'utf8').slice(0, 20); fs.writeFileSync(file, torn);
  const said = [], b = new CheckbackStore(file, { now: () => Date.parse('2026-11-23T10:15:30Z'), log: m => said.push(m) });
  assert.deepEqual(b.items, []);
  const kept = path.join(dir, 'checkbacks.json.corrupt-20261123-101530');
  assert.equal(fs.readFileSync(kept, 'utf8'), torn, 'kept as it was'); assert.ok(said.length === 1 && said[0].includes(kept), said.join('\n'));
  b.add({ sessionId: '11111111-2222-3333-4444-555555555559', engine: 'claude', note: 'x', dueAt: NOW + 60_000 });
  assert.equal(fs.readFileSync(kept, 'utf8'), torn, 'the next change leaves the kept copy alone'); assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).checkbacks.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
