// 1.117: automation.mjs on its own: the Automation settings schema (save, range, Off, reset, env presets), the unattended
// gate with injected state (pause, feature, plan ceilings, daily limit), the day's counts and once-a-day notices, the
// longest-reply rule and the audit file. The routes that use them are in test/pause-routes.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as auto from '../automation.mjs';

const NOW = Date.parse('2026-11-21T15:00:00Z');
const limits = (over = {}) => ({ ...auto.groupValues({}, 'limits', {}), ...over });
const ctx = (over = {}) => ({ paused: false, ownBlocked: false, features: { checkback: true, job: true }, limits: limits(), claude: null, codex: null,
  counts: {}, nextDay: NOW + 9 * 3600_000, now: NOW, ...over });
const claudeAt = (weekly, fiveHour, { observedAt = NOW - 60_000, resetsAt = NOW + 3600_000 } = {}) =>
  ({ windows: { seven_day: { utilization: weekly, resetsAt }, five_hour: { utilization: fiveHour, resetsAt } }, observedAt });

test('origins and their labels', () => {
  assert.deepEqual(auto.ORIGINS, ['owner', 'queue', 'retry', 'coordination', 'checkback', 'job']);
  assert.equal(auto.originLabel('owner'), null);
  assert.equal(auto.originLabel('queue'), 'Queued message');
  assert.equal(auto.originLabel('retry'), 'Continued after a usage limit');
  assert.equal(auto.originLabel('coordination'), 'Woken by a hold');
  assert.equal(auto.originLabel('checkback'), 'Started by a check-back');
  assert.equal(auto.originLabel('job', 'dispatch-pager'), 'Started by job dispatch-pager');
  assert.equal(auto.normOrigin('nonsense'), 'owner'); assert.equal(auto.normRoot('queue'), 'owner', 'a root is owner, checkback or job');
});

test('the defaults are the spec tables, and the groups are data', () => {
  assert.deepEqual(auto.GROUPS.map(g => g.key), ['pause', 'limits']);
  assert.deepEqual(auto.groupValues({}, 'pause', {}), { ownMessages: 'run', inboxWatch: true, rearmRetries: true, overdueCheckbacks: true, confirm: true });
  assert.deepEqual(auto.groupValues({}, 'limits', {}), { claudeWeekly: 80, claudeFiveHour: 90, codexWeekly: 80, codexFiveHour: 90, dailyReplies: 40, countOwnerWork: false,
    ceilingsHoldOwnerWork: false, openrouterDaily: 5, longestReply: 60, countWaiting: false, notice: 'push', staleHours: 6 });
  const stale = auto.GROUPS[1].settings.find(s => s.key === 'staleHours');
  assert.equal(stale.advanced, true); assert.ok(!stale.offAllowed, 'the stale setting has no Off');
});

test('every setting saves a value in range, refuses one out of range by naming the range, and resets to its default', () => {
  const good = { ownMessages: 'blocked', inboxWatch: false, rearmRetries: false, overdueCheckbacks: false, confirm: false,
    claudeWeekly: 60, claudeFiveHour: 70, codexWeekly: 55, codexFiveHour: 65, dailyReplies: 1000, countOwnerWork: true, ceilingsHoldOwnerWork: true,
    openrouterDaily: 0.5, longestReply: 480, countWaiting: true, notice: 'settings', staleHours: 24 };
  const bad = { ownMessages: 'maybe', inboxWatch: 'yes', rearmRetries: 1, overdueCheckbacks: 'no', confirm: 'on',
    claudeWeekly: 9, claudeFiveHour: 101, codexWeekly: 50.5, codexFiveHour: 'lots', dailyReplies: 1001, countOwnerWork: 'off', ceilingsHoldOwnerWork: 0,
    openrouterDaily: 0.49, longestReply: 4, countWaiting: 'true', notice: 'email', staleHours: 'off' };
  const ranges = { claudeWeekly: /10–100% or Off/, claudeFiveHour: /10–100% or Off/, dailyReplies: /1–1,000 or Off/, openrouterDaily: /\$0\.50–\$500 or Off/,
    longestReply: /5–480 min or Off/, staleHours: /1–24 h\.$/, ownMessages: /'run' or 'blocked'/, inboxWatch: /On or Off/ };
  let saved = {};
  for (const g of auto.GROUPS) for (const s of g.settings) {
    const ok = auto.applySave(saved, { group: g.key, values: { [s.key]: good[s.key] } });
    assert.ok(!ok.error, `${s.key}: ${ok.error}`);
    assert.equal(auto.groupValues(ok.automation, g.key, {})[s.key], good[s.key], `${s.key} saved`);
    saved = ok.automation;
    const no = auto.applySave(saved, { group: g.key, values: { [s.key]: bad[s.key] } });
    assert.equal(no.status, 400, `${s.key} refuses ${JSON.stringify(bad[s.key])}`);
    assert.ok(no.error.startsWith(s.label), no.error);
    if (ranges[s.key]) assert.match(no.error, ranges[s.key]);
  }
  // all or nothing: one bad value and nothing in the save is kept
  const mixed = auto.applySave(saved, { group: 'limits', values: { dailyReplies: 7, claudeWeekly: 5 } });
  assert.equal(mixed.status, 400); assert.equal(auto.groupValues(saved, 'limits', {}).dailyReplies, 1000);
  assert.equal(auto.applySave(saved, { group: 'limits', values: { nope: 1 } }).status, 400, 'an unknown key is refused');
  assert.equal(auto.applySave(saved, { group: 'jobs', values: { x: 1 } }).status, 400, 'an unknown group is refused');
  // reset: the group's table values again
  for (const g of auto.GROUPS) saved = auto.applySave(saved, { group: g.key, reset: true }).automation;
  assert.deepEqual(saved, {});
  assert.deepEqual(auto.values(saved, {}), auto.values({}, {}));
  // null forgets one saved value
  const one = auto.applySave({ limits: { dailyReplies: 3, longestReply: 30 } }, { group: 'limits', values: { dailyReplies: null } }).automation;
  assert.deepEqual(one, { limits: { longestReply: 30 } });
  // dollars keep cents; a string number from a form is read
  assert.equal(auto.applySave({}, { group: 'limits', values: { openrouterDaily: 2.499 } }).automation.limits.openrouterDaily, 2.5);
  assert.equal(auto.applySave({}, { group: 'limits', values: { dailyReplies: '12' } }).automation.limits.dailyReplies, 12);
});

test('Off is saved as off where the table allows it, and the page warns while a limit is Off', () => {
  for (const key of ['claudeWeekly', 'claudeFiveHour', 'codexWeekly', 'codexFiveHour', 'dailyReplies', 'openrouterDaily', 'longestReply']) {
    const r = auto.applySave({}, { group: 'limits', values: { [key]: 'off' } });
    assert.equal(r.automation.limits[key], 'off', key);
    const d = auto.describe(r.automation, {});
    assert.equal(d.groups[1].settings.find(s => s.key === key).value, 'off');
    assert.ok(d.warnings.some(w => w.includes('is Off')), key);
  }
  assert.equal(auto.applySave({}, { group: 'limits', values: { staleHours: 'off' } }).status, 400);
  assert.deepEqual(auto.describe({}, {}).warnings, [], 'nothing Off, no warning');
});

test('an env preset sets the default for this install, and a saved value wins over it', () => {
  const env = { POCKET_AUTOMATION_WEEKLY_CEILING: '60', POCKET_AUTOMATION_DAILY_REPLIES: 'off', POCKET_AUTOMATION_COUNT_OWNER_WORK: 'yes',
    POCKET_AUTOMATION_OWN_MESSAGES: 'blocked', POCKET_AUTOMATION_LONGEST_REPLY: '3' };
  const v = auto.groupValues({}, 'limits', env);
  assert.equal(v.claudeWeekly, 60); assert.equal(v.codexWeekly, 60, 'the spec example covers both engines');
  assert.equal(v.dailyReplies, 'off'); assert.equal(v.countOwnerWork, true);
  assert.equal(v.longestReply, 60, 'a preset out of range is ignored');
  assert.equal(auto.groupValues({}, 'pause', env).ownMessages, 'blocked');
  assert.equal(auto.groupValues({}, 'limits', { ...env, POCKET_AUTOMATION_CODEX_WEEKLY: '70' }).codexWeekly, 70, 'the engine-specific name comes first');
  const d = auto.describe({ limits: { claudeWeekly: 85 } }, env);
  const cw = d.groups[1].settings.find(s => s.key === 'claudeWeekly'), xw = d.groups[1].settings.find(s => s.key === 'codexWeekly');
  assert.deepEqual([cw.value, cw.saved, cw.preset, cw.default], [85, true, true, 80], 'saved wins over the preset');
  assert.deepEqual([xw.value, xw.saved, xw.preset], [60, false, true]);
  assert.ok(d.warnings.some(w => w.startsWith('POCKET_AUTOMATION_LONGEST_REPLY is ignored')), 'a bad preset is named');
});

test('the gate: pause first, then the feature, then the plan ceiling, then the daily limit', () => {
  const g = (info, c) => auto.unattendedGate({ engine: 'claude', sessionId: 's1', ...info }, ctx(c));
  // pause holds everything but the owner, and the owner too when Blocked
  for (const origin of ['queue', 'retry', 'coordination', 'checkback', 'job']) assert.equal(g({ origin, rootOrigin: origin === 'checkback' || origin === 'job' ? origin : 'owner' }, { paused: true }).reason, 'paused', origin);
  assert.deepEqual(g({ origin: 'owner' }, { paused: true }), { ok: true });
  assert.equal(g({ origin: 'owner' }, { paused: true, ownBlocked: true }).reason, 'paused');
  // 1.117 has no check-backs or job keys: the gate says so
  assert.deepEqual(g({ origin: 'checkback', rootOrigin: 'checkback' }, { features: {} }), { ok: false, reason: 'feature_off', feature: 'checkback' });
  assert.equal(g({ origin: 'retry', rootOrigin: 'job' }, { features: { checkback: true } }).reason, 'feature_off', 'a retry of job work needs job keys on');
  assert.equal(g({ origin: 'queue' }, { busy: true }).reason, 'busy');
  // a window over its ceiling holds a check-back and refuses a job, with the reset as `until`
  const over = claudeAt(0.85, 0.2);
  const cb = g({ origin: 'checkback', rootOrigin: 'checkback' }, { claude: over });
  assert.deepEqual(cb, { ok: false, reason: 'plan_ceiling', engine: 'claude', window: 'weekly', used: 85, ceiling: 80, until: NOW + 3600_000 });
  assert.equal(g({ origin: 'job', rootOrigin: 'job', originRef: 'pager' }, { claude: claudeAt(0.1, 0.95) }).window, 'five_hour');
  // owner-rooted work passes the ceiling unless the owner switched that on
  assert.deepEqual(g({ origin: 'retry', rootOrigin: 'owner' }, { claude: over }), { ok: true });
  assert.equal(g({ origin: 'queue', rootOrigin: 'owner' }, { claude: over, limits: limits({ ceilingsHoldOwnerWork: true }) }).reason, 'plan_ceiling');
  // a stale reading passes (the reply refreshes it), as does a window whose reset has passed, and an Off ceiling
  assert.deepEqual(g({ origin: 'job', rootOrigin: 'job' }, { claude: claudeAt(0.99, 0.99, { observedAt: NOW - 7 * 3600_000 }) }), { ok: true });
  assert.equal(g({ origin: 'job', rootOrigin: 'job' }, { claude: claudeAt(0.99, 0.99, { observedAt: NOW - 7 * 3600_000 }), limits: limits({ staleHours: 8 }) }).reason, 'plan_ceiling', 'the stale setting moves the line');
  assert.deepEqual(g({ origin: 'job', rootOrigin: 'job' }, { claude: claudeAt(0.99, 0.99, { resetsAt: NOW - 1 }) }), { ok: true });
  assert.deepEqual(g({ origin: 'job', rootOrigin: 'job' }, { claude: over, limits: limits({ claudeWeekly: 'off' }) }), { ok: true }, 'Off removes the limit');
  // Codex: read live; windows told apart by their length
  const codexReading = { primary: { usedPercent: 50, windowDurationMins: 300, resetsAt: NOW / 1000 + 600 }, secondary: { usedPercent: 81, windowDurationMins: 10080, resetsAt: NOW / 1000 + 86400 } };
  const cx = auto.unattendedGate({ origin: 'job', rootOrigin: 'job', engine: 'codex' }, ctx({ codex: codexReading }));
  assert.deepEqual([cx.reason, cx.window, cx.used, cx.until], ['plan_ceiling', 'weekly', 81, NOW + 86400_000]);
  assert.deepEqual(auto.unattendedGate({ origin: 'job', rootOrigin: 'job', engine: 'codex' }, ctx({ codex: codexReading, limits: limits({ codexWeekly: 90 }) })), { ok: true });
  assert.deepEqual(auto.unattendedGate({ origin: 'job', rootOrigin: 'job', engine: 'acp' }, ctx({ claude: over })), { ok: true }, 'OpenRouter has no plan windows');
});

test('the daily limit: the 41st unattended reply is refused; owner-rooted work counts only when switched on', () => {
  const st = new auto.AutomationState(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'auto-')), 'automation-state.json'), { now: () => NOW, zone: () => 'America/New_York' });
  const g = (info, over = {}) => auto.unattendedGate({ engine: 'claude', ...info }, ctx({ counts: st.counts(), ...over }));
  for (let i = 0; i < 40; i++) { assert.deepEqual(g({ origin: 'checkback', rootOrigin: 'checkback' }), { ok: true }, `start ${i + 1}`); st.recordStart({ rootOrigin: 'checkback' }); }
  const r = g({ origin: 'job', rootOrigin: 'job' });
  assert.deepEqual([r.reason, r.limit, r.count, r.max], ['daily_limit', 'replies', 40, 40]);
  assert.ok(r.until > NOW);
  assert.deepEqual(g({ origin: 'job', rootOrigin: 'job' }, { limits: limits({ dailyReplies: 'off' }) }), { ok: true }, 'Off removes it');
  assert.deepEqual(g({ origin: 'job', rootOrigin: 'job' }, { limits: limits({ dailyReplies: 41 }) }), { ok: true }, 'a raised limit applies to the next start');
  assert.deepEqual(g({ origin: 'retry', rootOrigin: 'owner' }), { ok: true }, "the owner's own work does not use the limit by default");
  const own = new auto.AutomationState(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'auto-')), 's.json'), { now: () => NOW });
  for (let i = 0; i < 3; i++) own.recordStart({ rootOrigin: 'owner' });
  const c = own.counts();
  assert.deepEqual(auto.unattendedGate({ origin: 'queue', engine: 'claude' }, ctx({ counts: c, limits: limits({ dailyReplies: 3 }) })), { ok: true });
  assert.equal(auto.unattendedGate({ origin: 'queue', engine: 'claude' }, ctx({ counts: c, limits: limits({ dailyReplies: 3, countOwnerWork: true }) })).reason, 'daily_limit');
  // OpenRouter spend per day
  own.recordFinish({ rootOrigin: 'job', engine: 'acp', cost: 5.2 });
  const sp = auto.unattendedGate({ origin: 'job', rootOrigin: 'job', engine: 'acp' }, ctx({ counts: own.counts() }));
  assert.deepEqual([sp.reason, sp.limit], ['daily_limit', 'openrouter']);
  assert.deepEqual(auto.unattendedGate({ origin: 'job', rootOrigin: 'job', engine: 'claude' }, ctx({ counts: own.counts() })), { ok: true }, 'only OpenRouter replies are held by spend');
  assert.deepEqual(auto.unattendedGate({ origin: 'job', rootOrigin: 'job', engine: 'acp' }, ctx({ counts: own.counts(), limits: limits({ openrouterDaily: 10 }) })), { ok: true });
});

test('one notice per reason per day, kept with the day, and a new day starts fresh', () => {
  let now = NOW;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'auto-')), 'automation-state.json');
  const st = new auto.AutomationState(file, { now: () => now, zone: () => 'America/New_York' });
  const ceiling = auto.unattendedGate({ origin: 'job', rootOrigin: 'job', engine: 'claude' }, ctx({ claude: claudeAt(0.9, 0.1) }));
  const n = auto.noticeFor(ceiling, () => 'Mon 9:00 AM EST');
  assert.equal(n.text, 'Claude Code weekly window is at 90%, over the 80% ceiling. Unattended work is held until Mon 9:00 AM EST.');
  assert.equal(st.noticeOnce(n), true); assert.equal(st.noticeOnce(n), false); assert.equal(st.noticeOnce({ ...n }), false);
  const daily = auto.noticeFor({ ok: false, reason: 'daily_limit', limit: 'replies', max: 40, count: 40 });
  assert.equal(st.noticeOnce(daily), true, 'another reason gets its own notice');
  assert.equal(auto.noticeFor({ ok: false, reason: 'paused' }), null, 'a pause the owner chose has no notice');
  assert.equal(auto.noticeFor({ ok: false, reason: 'feature_off' }), null);
  assert.deepEqual(st.notices().map(x => x.reason), ['plan_ceiling', 'daily_limit']);
  // survives a restart
  const again = new auto.AutomationState(file, { now: () => now, zone: () => 'America/New_York' });
  assert.equal(again.noticeOnce(n), false);
  // the owner's midnight, not UTC's: 04:30 UTC is still the 21st in New York
  st.recordStart({ rootOrigin: 'job' }); st.recordFinish({ rootOrigin: 'job', engine: 'claude', cost: 0.25 });
  now = Date.parse('2026-11-22T04:30:00Z');
  assert.equal(st.counts().day, '2026-11-21'); assert.equal(st.noticeOnce(n), false);
  now = Date.parse('2026-11-22T05:30:00Z');
  assert.equal(st.counts().day, '2026-11-22'); assert.equal(st.counts().startedRoot, 0);
  assert.equal(st.noticeOnce(n), true, 'told again the next day');
  const u = st.usage();
  assert.equal(u.days.length, 7); assert.equal(u.days.at(-1).date, '2026-11-22'); assert.deepEqual(u.days.at(-2), { date: '2026-11-21', replies: 1, cost: 0.25, tokens: 0 });
  assert.deepEqual(u.today, { replies: 0, cost: 0, tokens: 0 });
  assert.equal(auto.nextDayStart(NOW, 'America/New_York'), Date.parse('2026-11-22T05:00:00Z'));
});

test('the longest unattended reply: check-back and job replies only, waiting time left out unless counted', () => {
  const base = { rootOrigin: 'job', startedAt: NOW - 61 * 60_000, limit: 60, now: NOW };
  assert.equal(auto.replyOverLimit(base), true);
  assert.equal(auto.replyOverLimit({ ...base, rootOrigin: 'owner' }), false, "the owner's replies have no time limit");
  assert.equal(auto.replyOverLimit({ ...base, limit: 'off' }), false);
  assert.equal(auto.replyOverLimit({ ...base, waitingMs: 5 * 60_000 }), false, 'waiting on an approval does not count');
  assert.equal(auto.replyOverLimit({ ...base, waitingSince: NOW - 2 * 60_000 }), false, 'nor does a wait still going on');
  assert.equal(auto.replyOverLimit({ ...base, waitingMs: 5 * 60_000, countWaiting: true }), true);
});

test('the audit file takes one line per event and never message text', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'auto-')), 'automation-audit.jsonl');
  auto.appendAudit(file, { action: 'reply', origin: 'queue', sessionId: 'abc', text: 'secret words', userText: 'more words', prompt: 'p', outcome: 'ok' });
  auto.appendAudit(file, { action: 'pause', replies: { claude: 1 } });
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.deepEqual(Object.keys(lines[0]).sort(), ['action', 'at', 'origin', 'outcome', 'sessionId']);
  assert.ok(!fs.readFileSync(file, 'utf8').includes('words'));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
