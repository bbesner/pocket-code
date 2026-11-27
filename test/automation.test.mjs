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
  assert.deepEqual(auto.GROUPS.map(g => g.key), ['pause', 'limits', 'checkbacks', 'jobs']);
  assert.deepEqual(auto.groupValues({}, 'pause', {}), { ownMessages: 'run', inboxWatch: true, backgroundJobs: true, rearmRetries: true, runOverdue: true, confirm: true });
  assert.deepEqual(auto.groupValues({}, 'limits', {}), { claudeWeekly: 80, claudeFiveHour: 90, codexWeekly: 80, codexFiveHour: 90, dailyReplies: 40, countOwnerWork: false,
    ceilingsHoldOwnerWork: false, openrouterDaily: 5, longestReply: 60, countWaiting: false, notice: 'push', staleHours: 6 });
  // 1.119: the Check-backs table, off by default, the two engine switches on
  assert.deepEqual(auto.groupValues({}, 'checkbacks', {}), { checkbacks: false, checkbackAccess: 'same', checkbackClaude: true, checkbackCodex: true, pushWhenMuted: true, showInTasks: true,
    perConversation: 10, perInstall: 50, chainLimit: 5, furthestHours: 2160, soonestMin: 1, noteMax: 1000, catchUpHours: 12, busyWaitMin: 60, spacingSec: 15 });
  // job keys: the Settings table of Part 3, off by default; new keys Full access since 1.125.2
  assert.deepEqual(auto.groupValues({}, 'jobs', {}), { jobs: false, jobsInTasks: true, jobAccess: 'full', jobAddInstructions: false, jobPerHour: 6, jobPerDay: 24, jobAtOnce: 1,
    jobDataMax: 20000, jobWaitMax: 300, jobRepeatDays: 7, jobPush: true, jobPushRespectsMute: true, jobKeyFolder: '~/.config/pocket/jobs/' });
  const cbg = auto.GROUPS[2].settings;
  assert.deepEqual(cbg.filter(s => s.advanced).map(s => s.key), ['perConversation', 'perInstall', 'chainLimit', 'furthestHours', 'soonestMin', 'noteMax', 'catchUpHours', 'busyWaitMin', 'spacingSec']);
  assert.ok(!cbg.some(s => s.offAllowed), 'no check-back limit has No limit');
  const stale = auto.GROUPS[1].settings.find(s => s.key === 'staleHours');
  assert.equal(stale.advanced, true); assert.ok(!stale.offAllowed, 'the stale setting has no Off');
});

test('every setting saves a value in range, refuses one out of range by naming the range, and resets to its default', () => {
  const good = { ownMessages: 'blocked', inboxWatch: false, backgroundJobs: false, rearmRetries: false, confirm: false,
    claudeWeekly: 60, claudeFiveHour: 70, codexWeekly: 55, codexFiveHour: 65, dailyReplies: 1000, countOwnerWork: true, ceilingsHoldOwnerWork: true,
    openrouterDaily: 0.5, longestReply: 480, countWaiting: true, notice: 'settings', staleHours: 24, runOverdue: false,
    checkbacks: true, checkbackAccess: 'review', checkbackClaude: false, checkbackCodex: false, pushWhenMuted: false, showInTasks: false,
    perConversation: 50, perInstall: 500, chainLimit: 0, furthestHours: 8760, soonestMin: 60, noteMax: 4000, catchUpHours: 0, busyWaitMin: 480, spacingSec: 0,
    jobs: true, jobsInTasks: false, jobAccess: 'full', jobAddInstructions: true, jobPerHour: 120, jobPerDay: 1000, jobAtOnce: 5, jobDataMax: 100000, jobWaitMax: 30, jobRepeatDays: 30,
    jobPush: false, jobPushRespectsMute: false, jobKeyFolder: '~/keys/' };
  const bad = { ownMessages: 'maybe', inboxWatch: 'yes', backgroundJobs: 'no', rearmRetries: 1, confirm: 'on',
    claudeWeekly: 9, claudeFiveHour: 101, codexWeekly: 50.5, codexFiveHour: 'lots', dailyReplies: 1001, countOwnerWork: 'off', ceilingsHoldOwnerWork: 0,
    openrouterDaily: 0.49, longestReply: 4, countWaiting: 'true', notice: 'email', staleHours: 'off', runOverdue: 'yes',
    checkbacks: 1, checkbackAccess: 'full', checkbackClaude: 'on', checkbackCodex: 'no', pushWhenMuted: 0, showInTasks: 'false',
    perConversation: 0, perInstall: 501, chainLimit: -1, furthestHours: 8761, soonestMin: 0, noteMax: 199, catchUpHours: 73, busyWaitMin: 4, spacingSec: 301,
    jobs: 'yes', jobsInTasks: 'no', jobAccess: 'root', jobAddInstructions: 1, jobPerHour: 121, jobPerDay: 0, jobAtOnce: 6, jobDataMax: 999, jobWaitMax: 901, jobRepeatDays: 31,
    jobPush: 'on', jobPushRespectsMute: 'off', jobKeyFolder: '/etc/' };
  const ranges = { claudeWeekly: /must be 10% to 100%, or No limit\.$/, claudeFiveHour: /10% to 100%, or No limit/, dailyReplies: /1 to 1,000, or No limit/,
    openrouterDaily: /\$0\.50 to \$500, or No limit/, longestReply: /5 min to 480 min, or No limit/, staleHours: /1 h to 24 h\.$/, ownMessages: /'run' or 'blocked'/, inboxWatch: /On or Off/,
    perConversation: /1 to 50\.$/, perInstall: /1 to 500\.$/, chainLimit: /0 to 20\.$/, furthestHours: /1 h to 8,760 h\.$/, soonestMin: /1 min to 60 min\.$/,
    noteMax: /200 characters to 4,000 characters\.$/, catchUpHours: /0 h to 72 h\.$/, busyWaitMin: /5 min to 480 min\.$/, spacingSec: /0 s to 300 s\.$/ };
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
  assert.equal(auto.applySave(saved, { group: 'nope', values: { x: 1 } }).status, 400, 'an unknown group is refused');
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

test('No limit is saved as off where the table allows it, and the page warns while a limit has none', () => {
  for (const key of ['claudeWeekly', 'claudeFiveHour', 'codexWeekly', 'codexFiveHour', 'dailyReplies', 'openrouterDaily', 'longestReply']) {
    const r = auto.applySave({}, { group: 'limits', values: { [key]: 'off' } });
    assert.equal(r.automation.limits[key], 'off', key);
    const d = auto.describe(r.automation, {});
    assert.equal(d.groups[1].settings.find(s => s.key === key).value, 'off');
    assert.ok(d.warnings.some(w => w.endsWith(' has no limit.')), key);
    assert.ok(!d.warnings.some(w => /\bOff\b/.test(w)), 'the warning says No limit, not Off');
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

test('a saved value or preset for a key the schema does not have is ignored without an error', () => {
  const saved = { pause: { overdueCheckbacks: false, confirm: false }, jobs: { anything: 1 } };
  const env = { POCKET_AUTOMATION_OVERDUE_CHECKBACKS: '0', POCKET_AUTOMATION_NOT_A_SETTING: 'x' };
  assert.deepEqual(auto.groupValues(saved, 'pause', env), { ownMessages: 'run', inboxWatch: true, backgroundJobs: true, rearmRetries: true, runOverdue: true, confirm: false });
  const d = auto.describe(saved, env);
  assert.deepEqual(d.warnings, []);
  assert.ok(!d.groups[0].settings.some(s => s.key === 'overdueCheckbacks'));
  // a later save in the group keeps working with the old key still on disk
  assert.ok(!auto.applySave(saved, { group: 'pause', values: { inboxWatch: false } }).error);
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

test('the day only rolls forward: a zone moved west, or a clock stepped back, keeps today\'s count', () => {
  let now = Date.parse('2026-11-22T01:00:00Z'), zone = 'Asia/Tokyo'; // 10:00 on the 22nd in Tokyo, 20:00 on the 21st in New York
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'auto-')), 'automation-state.json');
  const st = new auto.AutomationState(file, { now: () => now, zone: () => zone });
  st.recordStart({ rootOrigin: 'job' }); st.recordFinish({ rootOrigin: 'job', engine: 'claude', cost: 0.5 });
  assert.equal(st.counts().day, '2026-11-22');
  zone = 'America/New_York'; // the owner's browser now reports New York: that day key is the 21st
  assert.deepEqual([st.counts().day, st.counts().startedRoot, st.counts().replies], ['2026-11-22', 1, 1], 'the count is not reset early');
  assert.deepEqual(st.usage().days.filter(d => d.replies), [{ date: '2026-11-22', replies: 1, cost: 0.5, tokens: 0 }], 'and no day is filed twice');
  now -= 3600_000; zone = 'Asia/Tokyo'; // a clock stepped back an hour, still the 22nd
  assert.equal(st.counts().startedRoot, 1);
  now = Date.parse('2026-11-23T05:30:00Z'); zone = 'America/New_York'; // the 23rd in New York: a new day starts
  assert.deepEqual([st.counts().day, st.counts().startedRoot], ['2026-11-23', 0]);
  assert.deepEqual(new auto.AutomationState(file, { now: () => now, zone: () => zone }).usage().days.at(-2), { date: '2026-11-22', replies: 1, cost: 0.5, tokens: 0 });
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

// 1.124.4: a state write that fails (here a real read-only data folder) keeps today's counts in memory, so the limits
// hold while Pocket runs, and says so: save() is false, saveError is set and one line is logged for the run of failures.
// A restart before the next good save would read the lower count from the file; that is what the Automation page warns of.
test('a daily count that cannot be saved is kept in memory, flagged and logged once, and the next good save clears it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-')), file = path.join(dir, 'automation-state.json');
  const logged = [], opts = { now: () => NOW, zone: () => 'UTC', log: (...a) => logged.push(a.join(' ')) };
  try {
    const st = new auto.AutomationState(file, opts);
    st.recordStart({ rootOrigin: 'job' }); st.recordFinish({ rootOrigin: 'job', engine: 'acp', cost: 0.75 });
    assert.equal(st.saveError, null); assert.deepEqual(logged, []);
    const committed = fs.readFileSync(file);
    fs.chmodSync(dir, 0o555);
    st.recordStart({ rootOrigin: 'job' }); st.recordFinish({ rootOrigin: 'job', engine: 'acp', cost: 0.75 });
    assert.equal(st.save(), false);
    assert.deepEqual([st.counts().startedRoot, st.counts().openrouterRoot], [2, 1.5], 'memory keeps the counts');
    assert.equal(st.saveError.code, 'EACCES'); assert.match(st.saveError.at, /^2026-11-21T15:00:00/);
    assert.equal(logged.length, 1, 'logged once for the run of failures');
    assert.match(logged[0], /automation-state\.json could not be saved \(EACCES\)/);
    assert.ok(fs.readFileSync(file).equals(committed), 'the file is as it was');
    assert.equal(new auto.AutomationState(file, { ...opts, log: () => {} }).counts().startedRoot, 1, 'a restart now would read the last good save');
    fs.chmodSync(dir, 0o755);
    assert.equal(st.save(), true); assert.equal(st.saveError, null);
    assert.equal(logged.length, 2); assert.match(logged[1], /saved again/);
    assert.equal(new auto.AutomationState(file, opts).counts().startedRoot, 2);
  } finally { fs.chmodSync(dir, 0o755); fs.rmSync(dir, { recursive: true, force: true }); }
});

// 1.124.4: a state file that does not parse (torn by a power cut) or cannot be read (mode 000) is kept aside as
// automation-state.json.corrupt-<UTC time> and logged, as the other stores are (store-file.mjs), and the day starts
// empty. Before, the day silently started at zero and the next save replaced the only copy.
test('a daily-state file that cannot be read or parsed is kept aside and logged, not overwritten', () => {
  for (const [why, prepare] of [
    ['not valid JSON', f => fs.writeFileSync(f, '{"today":{"day":"2026-11-21","startedRoot":40,"replies":40')],
    ['EACCES', f => new auto.AutomationState(f, { now: () => NOW, zone: () => 'UTC', log: () => {} }).recordStart({ rootOrigin: 'job' })],
  ]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-')), file = path.join(dir, 'automation-state.json');
    try {
      prepare(file); const before = fs.readFileSync(file);
      if (why === 'EACCES') fs.chmodSync(file, 0o000); // a valid file the daemon cannot read
      const logged = [];
      const st = new auto.AutomationState(file, { now: () => NOW, zone: () => 'UTC', log: (...a) => logged.push(a.join(' ')) });
      assert.equal(st.counts().startedRoot, 0, why);
      assert.equal(logged.length, 1, why); assert.match(logged[0], new RegExp(`automation-state\\.json could not be read \\(${why}\\): kept it as `));
      const kept = fs.readdirSync(dir).filter(n => n.startsWith('automation-state.json.corrupt-'));
      assert.equal(kept.length, 1, why);
      st.recordStart({ rootOrigin: 'job' });
      fs.chmodSync(path.join(dir, kept[0]), 0o600);
      assert.ok(fs.readFileSync(path.join(dir, kept[0])).equals(before), `${why}: the kept copy holds the old bytes`);
      assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).today.startedRoot, 1, `${why}: the new day is saved beside it`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

// 1.124.4: a full disk (here a real 1 KB file-size limit, `ulimit -f 1`) can leave part of an audit line in the file.
// The next line starts on a line of its own, so only the torn line is lost, not the first good one after it.
test('an audit line torn by a full disk does not swallow the next one', async () => {
  const { spawnSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-')), file = path.join(dir, 'automation-audit.jsonl');
  try {
    fs.writeFileSync(file, JSON.stringify({ at: '2026-11-21T15:00:00.000Z', action: 'pause', pad: 'x'.repeat(880) }) + '\n', { mode: 0o600 });
    const script = `const auto = await import(process.env.MOD); auto.appendAudit(process.env.FILE, { action: 'settings', group: 'limits', keys: ['dailyReplies', 'openrouterDaily', 'longestReply', 'countWaiting'] });`;
    const r = spawnSync('bash', ['-c', 'ulimit -f 1; exec "$0" --input-type=module -e "$1"', process.execPath, script], { env: { ...process.env, MOD: new URL('../automation.mjs', import.meta.url).href, FILE: file }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.statSync(file).size, 1024, 'the limit cut the line short');
    auto.appendAudit(file, { action: 'resume', rearmed: 0 }); // space is back
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    assert.equal(lines.at(-1), '', 'the file ends with a newline');
    assert.deepEqual(JSON.parse(lines.at(-2)), { at: JSON.parse(lines.at(-2)).at, action: 'resume', rearmed: 0 }, 'the line after the torn one reads whole');
    assert.equal(JSON.parse(lines[0]).action, 'pause');
    assert.equal(lines.length, 4, 'the earlier line, the torn one, the new one');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 1.124.4: the audit stays best effort (it never stops a turn), but a line that could not be written is no longer
// silent: appendAudit answers false, and the server's writer logs it at most once a minute, never with the line itself.
test('an audit line that cannot be written is reported, at most once a minute and without its contents', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-')), file = path.join(dir, 'automation-audit.jsonl');
  try {
    assert.equal(auto.appendAudit(file, { action: 'pause' }), true);
    fs.chmodSync(file, 0o400); // a file Pocket can no longer write
    assert.equal(auto.appendAudit(file, { action: 'resume' }), false);
    let now = NOW; const logged = [];
    const write = auto.auditWriter(file, { now: () => now, log: (...a) => logged.push(a.join(' ')) });
    assert.equal(write({ action: 'settings', group: 'limits', keys: ['dailyReplies'], sessionId: 'secret-session-id' }), false);
    now += 30_000; write({ action: 'settings' }); write({ action: 'settings' });
    assert.equal(logged.length, 1, 'once a minute at most');
    assert.match(logged[0], /automation-audit\.jsonl could not be written: 1 audit line lost/);
    assert.ok(!/limits|dailyReplies|secret-session-id|settings/.test(logged[0]), 'nothing of the line itself');
    now += 30_000; write({ action: 'settings' });
    assert.equal(logged.length, 2); assert.match(logged[1], /3 audit lines lost since the last note/);
    fs.chmodSync(file, 0o600);
    assert.equal(write({ action: 'resume' }), true); assert.equal(logged.length, 2);
    assert.deepEqual(fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l).action), ['pause', 'resume']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
