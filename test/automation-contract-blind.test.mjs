// A contract for automation.mjs, written from a behaviour spec without sight of the source (bug review of 2026-11-23,
// Pocket Code 1.124.3). Every step that writes state is failed in turn and a restart is checked; where the review's
// ruling changed what a test asks for, a comment on the test says why.
// Synthetic values only; no processes, no network, temp dirs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  tmpDir, fakeClock, failing, patch, failFsFor, snapshot, unchanged,
} from './bugreview-faults.mjs';
import {
  ORIGINS, ROOT_ORIGINS, normOrigin, normRoot, originLabel, GROUPS, envNames, rangeText, homeFolder,
  checkValue, groupValues, values, applySave, describe, limitsApply, ceilingHit, unattendedGate,
  noticeFor, replyOverLimit, dayKey, nextDayStart, AutomationState, appendAudit,
} from '../automation.mjs';

// ---------- helpers ----------
const groupList = Array.isArray(GROUPS) ? GROUPS : Object.entries(GROUPS).map(([key, g]) => ({ key, ...g }));
const S = key => {
  for (const g of groupList) { const s = g.settings.find(x => x.key === key); if (s) return s; }
  throw new Error('no setting ' + key);
};
const groupOf = key => groupList.find(g => g.settings.some(s => s.key === key)).key;
const titleOf = gk => describe({}, {}).groups.find(g => g.key === gk).title;
const HOUR = 3600000, DAY = 86400000;
const T0 = Date.parse('2026-01-01T12:00:00Z');
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);

function myWrite(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}
function setup(extra = {}) {
  const dir = tmpDir('auto-');
  const file = path.join(dir, 'automation-state.json');
  const clock = fakeClock(T0);
  const opts = { now: clock.now, zone: () => 'UTC', ...extra };
  return { dir, file, clock, opts, st: new AutomationState(file, opts) };
}
const disk = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const tryCall = fn => { try { return { threw: false, ret: fn() }; } catch (e) { return { threw: true, err: e }; } };

const DEFAULTS = {
  pause: { ownMessages: 'run', inboxWatch: true, backgroundJobs: true, rearmRetries: true, runOverdue: true, confirm: true },
  limits: {
    claudeWeekly: 80, claudeFiveHour: 90, codexWeekly: 80, codexFiveHour: 90, dailyReplies: 40, countOwnerWork: false,
    ceilingsHoldOwnerWork: false, openrouterDaily: 5, longestReply: 60, countWaiting: false, notice: 'push', staleHours: 6,
  },
  checkbacks: {
    checkbacks: false, checkbackAccess: 'same', checkbackClaude: true, checkbackCodex: true, pushWhenMuted: true,
    showInTasks: true, perConversation: 10, perInstall: 50, chainLimit: 5, furthestHours: 2160, soonestMin: 1,
    noteMax: 1000, catchUpHours: 12, busyWaitMin: 60, spacingSec: 15,
  },
  jobs: {
    jobs: false, jobsInTasks: true, jobAccess: 'ask', jobAddInstructions: false, jobPerHour: 6, jobPerDay: 24,
    jobAtOnce: 1, jobDataMax: 20000, jobWaitMax: 300, jobRepeatDays: 7, jobPush: true, jobPushRespectsMute: true,
    jobKeyFolder: '~/.config/pocket/jobs/',
  },
};
// [key, min, max, integer?, offAllowed?]
const NUMBERS = [
  ['claudeWeekly', 10, 100, true, true], ['claudeFiveHour', 10, 100, true, true], ['codexWeekly', 10, 100, true, true],
  ['codexFiveHour', 10, 100, true, true], ['dailyReplies', 1, 1000, true, true], ['openrouterDaily', 0.5, 500, false, true],
  ['longestReply', 5, 480, true, true], ['staleHours', 1, 24, true, false],
  ['perConversation', 1, 50, true, false], ['perInstall', 1, 500, true, false], ['chainLimit', 0, 20, true, false],
  ['furthestHours', 1, 8760, true, false], ['soonestMin', 1, 60, true, false], ['noteMax', 200, 4000, true, false],
  ['catchUpHours', 0, 72, true, false], ['busyWaitMin', 5, 480, true, false], ['spacingSec', 0, 300, true, false],
  ['jobPerHour', 1, 120, true, true], ['jobPerDay', 1, 1000, true, true], ['jobAtOnce', 1, 5, true, false],
  ['jobDataMax', 1000, 100000, true, false], ['jobWaitMax', 30, 900, true, false], ['jobRepeatDays', 1, 30, true, false],
];

// ======================= 2. origins =======================
test('origins: exact arrays and normalisers', () => {
  assert.deepEqual(ORIGINS, ['owner', 'queue', 'retry', 'coordination', 'checkback', 'job']);
  assert.deepEqual(ROOT_ORIGINS, ['owner', 'checkback', 'job']);
  for (const o of ORIGINS) assert.equal(normOrigin(o), o);
  assert.equal(normOrigin('nope'), 'owner'); assert.equal(normOrigin(undefined), 'owner');
  assert.equal(normRoot('job'), 'job'); assert.equal(normRoot('checkback'), 'checkback');
  assert.equal(normRoot('queue'), 'owner'); assert.equal(normRoot(null), 'owner');
});

test('originLabel: labels, null cases, no escaping', () => {
  assert.equal(originLabel(undefined), null); assert.equal(originLabel('owner'), null); assert.equal(originLabel('zzz'), null);
  assert.equal(originLabel('queue'), 'Queued message');
  assert.equal(originLabel('retry'), 'Continued after a usage limit');
  assert.equal(originLabel('coordination'), 'Woken by a hold');
  assert.equal(originLabel('checkback'), 'Started by a check-back');
  assert.equal(originLabel('job', 'nightly-x'), 'Started by job nightly-x');
  assert.equal(originLabel('job'), 'Started by job');
  assert.equal(originLabel('job', '<b>&'), 'Started by job <b>&');
});

// ======================= 2. schema =======================
test('GROUPS: order and exact setting keys per group', () => {
  assert.deepEqual(groupList.map(g => g.key), ['pause', 'limits', 'checkbacks', 'jobs']);
  for (const g of groupList) assert.deepEqual(g.settings.map(s => s.key).sort(), Object.keys(DEFAULTS[g.key]).sort(), g.key);
});

test('values/groupValues: defaults with empty saved and env', () => {
  for (const gk of Object.keys(DEFAULTS)) assert.deepEqual(groupValues({}, gk, {}), DEFAULTS[gk], gk);
  const v = values({}, {});
  assert.deepEqual(Object.keys(v), ['pause', 'limits', 'checkbacks', 'jobs']);
  assert.deepEqual(v, DEFAULTS);
});

test('groupValues: unknown group throws TypeError', () => {
  assert.throws(() => groupValues({}, 'nope', {}), TypeError);
});

test('envNames: POCKET_AUTOMATION_ upper snake, ceiling aliases after', () => {
  assert.deepEqual(envNames(S('dailyReplies')), ['POCKET_AUTOMATION_DAILY_REPLIES']);
  assert.deepEqual(envNames(S('openrouterDaily')), ['POCKET_AUTOMATION_OPENROUTER_DAILY']);
  assert.deepEqual(envNames(S('jobKeyFolder')), ['POCKET_AUTOMATION_JOB_KEY_FOLDER']);
  for (const [key, eng, shared] of [['claudeWeekly', 'CLAUDE_WEEKLY_CEILING', 'WEEKLY_CEILING'], ['claudeFiveHour', 'CLAUDE_FIVE_HOUR_CEILING', 'FIVE_HOUR_CEILING'],
    ['codexWeekly', 'CODEX_WEEKLY_CEILING', 'WEEKLY_CEILING'], ['codexFiveHour', 'CODEX_FIVE_HOUR_CEILING', 'FIVE_HOUR_CEILING']]) {
    const n = envNames(S(key));
    assert.equal(n[0], 'POCKET_AUTOMATION_' + key.replace(/[A-Z]/g, c => '_' + c).toUpperCase());
    assert.equal(n.length, 3, key + ' ' + JSON.stringify(n));
    assert.ok(n[1].endsWith(eng), JSON.stringify(n));
    assert.ok(n[2].endsWith(shared) && !n[2].includes('CLAUDE') && !n[2].includes('CODEX'), JSON.stringify(n));
  }
});

test('rangeText: Boolean, choice, folder, numbers', () => {
  assert.equal(rangeText(S('inboxWatch')), 'On or Off');
  assert.equal(rangeText(S('ownMessages')), "'run' or 'blocked'");
  assert.equal(rangeText(S('jobKeyFolder')), 'a folder in your home folder, written like ~/.config/pocket/jobs/');
  assert.equal(rangeText(S('dailyReplies')), '1 to 1,000, or No limit');
  assert.equal(rangeText(S('openrouterDaily')), '$0.50 to $500, or No limit');
  assert.ok(!rangeText(S('staleHours')).includes('No limit'));
  assert.ok(!rangeText(S('jobAtOnce')).includes('No limit'));
});

test('checkValue: exact error messages from spec section 5', () => {
  assert.deepEqual(checkValue(S('dailyReplies'), 0), { error: 'Unattended replies per day must be 1 to 1,000, or No limit.' });
  assert.deepEqual(checkValue(S('openrouterDaily'), 0.49), { error: 'OpenRouter spend per day (unattended) must be $0.50 to $500, or No limit.' });
  assert.deepEqual(checkValue(S('ownMessages'), 'Run'), { error: "Your own messages while paused must be 'run' or 'blocked'." });
  assert.deepEqual(checkValue(S('jobKeyFolder'), 'a/b'), { error: 'Where Pocket offers to save new keys must be a folder in your home folder, written like ~/.config/pocket/jobs/.' });
  const s = S('inboxWatch');
  assert.deepEqual(checkValue(s, 'true'), { error: s.label + ' must be On or Off.' });
  for (const k of ['staleHours', 'longestReply', 'jobKeyFolder']) {
    const r = checkValue(S(k), {});
    assert.equal(r.error, S(k).label + ' must be ' + rangeText(S(k)) + '.');
    assert.equal(Object.keys(r).length, 1, 'no status/code');
  }
});

test('checkValue: Boolean and choice strictness', () => {
  assert.deepEqual(checkValue(S('inboxWatch'), true), { value: true });
  assert.deepEqual(checkValue(S('inboxWatch'), false), { value: false });
  for (const bad of [1, 0, 'on', 'false', null, undefined]) assert.ok(checkValue(S('inboxWatch'), bad).error, String(bad));
  assert.deepEqual(checkValue(S('ownMessages'), 'blocked'), { value: 'blocked' });
  assert.ok(checkValue(S('ownMessages'), ' run').error);
  assert.deepEqual(checkValue(S('notice'), 'settings'), { value: 'settings' });
  assert.deepEqual(checkValue(S('jobAccess'), 'full'), { value: 'full' });
  assert.ok(checkValue(S('jobAccess'), 'FULL').error);
  assert.deepEqual(checkValue(S('checkbackAccess'), 'review'), { value: 'review' });
});

for (const [key, min, max, int, off] of NUMBERS) {
  test(`checkValue boundaries: ${key} ${min}..${max}${int ? ' int' : ''}${off ? ' off' : ''}`, () => {
    const s = S(key);
    assert.deepEqual(checkValue(s, min), { value: min });
    assert.deepEqual(checkValue(s, max), { value: max });
    assert.deepEqual(checkValue(s, String(max)), { value: max });
    assert.deepEqual(checkValue(s, `  ${min} `), { value: min });
    assert.ok(checkValue(s, min - (int ? 1 : 0.01)).error, 'below min');
    assert.ok(checkValue(s, max + 1).error, 'above max');
    assert.ok(checkValue(s, Infinity).error); assert.ok(checkValue(s, -Infinity).error); assert.ok(checkValue(s, NaN).error);
    assert.ok(checkValue(s, '1e2').error, 'exponent'); assert.ok(checkValue(s, '+' + max).error, 'plus sign');
    assert.ok(checkValue(s, '').error, 'empty'); assert.ok(checkValue(s, null).error, 'null');
    if (int) { assert.ok(checkValue(s, min + 0.5).error, 'decimal'); assert.ok(checkValue(s, `${min}.5`).error, 'decimal string'); }
    if (off) assert.deepEqual(checkValue(s, 'off'), { value: 'off' });
    else { const r = checkValue(s, 'off'); assert.ok(r.error); assert.ok(!r.error.includes('No limit')); }
    assert.ok(checkValue(s, 'OFF').error, 'saved off is case-sensitive');
  });
}

test('checkValue: step not enforced, money rounding, negative string', () => {
  assert.deepEqual(checkValue(S('longestReply'), 7), { value: 7 });
  assert.deepEqual(checkValue(S('openrouterDaily'), 0.51), { value: 0.51 });
  assert.deepEqual(checkValue(S('openrouterDaily'), 1.234), { value: 1.23 });
  assert.deepEqual(checkValue(S('openrouterDaily'), '2.5'), { value: 2.5 });
  assert.ok(checkValue(S('openrouterDaily'), '.5').error);
  assert.ok(checkValue(S('chainLimit'), '-5').error);
  assert.deepEqual(checkValue(S('chainLimit'), '0'), { value: 0 });
  assert.deepEqual(checkValue(S('dailyReplies'), 1e2), { value: 100 });
});

// ======================= homeFolder =======================
test('homeFolder: accepted forms and normalisation', () => {
  const H = '/home/fakeuser';
  assert.equal(homeFolder('~', H), '~/');
  assert.equal(homeFolder('~/', H), '~/');
  assert.equal(homeFolder('  ~/x  ', H), '~/x/');
  assert.equal(homeFolder('~/a//./b', H), '~/a/b/');
  assert.equal(homeFolder('~/a/./b/', H), '~/a/b/');
  assert.equal(homeFolder('~/.config/pocket/jobs', H), '~/.config/pocket/jobs/');
  assert.equal(homeFolder('~/...', H), '~/.../');
  assert.equal(homeFolder(H, H), '~/');
  assert.equal(homeFolder(H + '/a/b', H), '~/a/b/');
  assert.equal(homeFolder('~/' + 'a'.repeat(398), H), '~/' + 'a'.repeat(398) + '/');
});

test('homeFolder: rejected forms return null', () => {
  const H = '/home/fakeuser';
  for (const v of ['', '   ', 'a/b', '~other/a', '/home/other/a', '/home/fakeuserX/a', '/etc', '~/a/../b', '~/..', '~/a/..',
    H + '/../x', '~/a\u0000b', '~/a\u001fb', '~/a\u007fb', '~/a\nb', '~/' + 'a'.repeat(399)]) {
    assert.equal(homeFolder(v, H), null, JSON.stringify(v.length > 40 ? v.length : v));
  }
  assert.equal(homeFolder('  ' + '~/' + 'a'.repeat(398) + '  ', H), '~/' + 'a'.repeat(398) + '/', 'length measured after trim');
});

// ======================= presets / describe =======================
test('groupValues: saved > env (first valid nonempty) > default', () => {
  const [own, eng, shared] = envNames(S('claudeWeekly'));
  assert.equal(groupValues({}, 'limits', { [shared]: '55' }).claudeWeekly, 55);
  assert.equal(groupValues({}, 'limits', { [shared]: '55' }).codexWeekly, 55);
  assert.equal(groupValues({}, 'limits', { [eng]: '60', [shared]: '55' }).claudeWeekly, 60);
  assert.equal(groupValues({}, 'limits', { [own]: '70', [eng]: '60' }).claudeWeekly, 70);
  assert.equal(groupValues({}, 'limits', { [own]: '5', [eng]: '60' }).claudeWeekly, 60, 'invalid preset skipped');
  assert.equal(groupValues({}, 'limits', { [own]: '', [eng]: '61' }).claudeWeekly, 61, 'empty preset skipped');
  assert.equal(groupValues({}, 'limits', { POCKET_AUTOMATION_DAILY_REPLIES: 'OfF' }).dailyReplies, 'off');
  assert.equal(groupValues({}, 'limits', { POCKET_AUTOMATION_DAILY_REPLIES: ' 7 ' }).dailyReplies, 7);
  assert.equal(groupValues({}, 'limits', { POCKET_AUTOMATION_DAILY_REPLIES: '0' }).dailyReplies, 40);
  const saved = applySave({}, { group: 'limits', values: { dailyReplies: 12 } }).automation;
  assert.equal(groupValues(saved, 'limits', { POCKET_AUTOMATION_DAILY_REPLIES: '7' }).dailyReplies, 12);
});

test('groupValues: preset Booleans accept words ignoring case', () => {
  for (const [v, want] of [['1', true], [' TRUE ', true], ['Yes', true], ['on', true], ['0', false], ['False', false], ['NO', false], [' off', false]]) {
    assert.equal(groupValues({}, 'pause', { POCKET_AUTOMATION_INBOX_WATCH: v }).inboxWatch, want, v);
  }
  assert.equal(groupValues({}, 'pause', { POCKET_AUTOMATION_INBOX_WATCH: 'maybe' }).inboxWatch, true);
  assert.equal(groupValues({}, 'pause', { POCKET_AUTOMATION_OWN_MESSAGES: 'blocked' }).ownMessages, 'blocked');
});

test('groupValues: invalid saved value ignored', () => {
  const saved = applySave({}, { group: 'limits', values: { dailyReplies: 12 } }).automation;
  const bad = JSON.parse(JSON.stringify(saved).replace('12', '0'));
  assert.equal(groupValues(bad, 'limits', {}).dailyReplies, 40);
  assert.equal(groupValues(bad, 'limits', { POCKET_AUTOMATION_DAILY_REPLIES: '9' }).dailyReplies, 9);
});

test('describe: shape, flags, choices copied', () => {
  const saved = applySave({}, { group: 'limits', values: { dailyReplies: 12 } }).automation;
  const d = describe(saved, { POCKET_AUTOMATION_LONGEST_REPLY: '30' });
  assert.deepEqual(d.groups.map(g => g.key), ['pause', 'limits', 'checkbacks', 'jobs']);
  for (const g of d.groups) {
    assert.equal(typeof g.title, 'string');
    for (const s of g.settings) {
      for (const f of ['key', 'label', 'type', 'value', 'default', 'saved', 'preset']) assert.ok(f in s, `${s.key}.${f}`);
      assert.equal(typeof s.saved, 'boolean'); assert.equal(typeof s.preset, 'boolean');
      assert.deepEqual(s.default, DEFAULTS[g.key][s.key], s.key);
    }
  }
  const all = Object.fromEntries(d.groups.flatMap(g => g.settings.map(s => [s.key, s])));
  assert.equal(all.dailyReplies.value, 12); assert.equal(all.dailyReplies.saved, true); assert.equal(all.dailyReplies.preset, false);
  assert.equal(all.longestReply.value, 30); assert.equal(all.longestReply.preset, true); assert.equal(all.longestReply.saved, false);
  for (const [key, min, max, , off] of NUMBERS) {
    const s = all[key];
    assert.equal(s.min, min, key); assert.equal(s.max, max, key); assert.equal(s.offAllowed, off, key);
    assert.ok('step' in s && 'unit' in s, key);
  }
  const cv = c => (c && typeof c === 'object' ? c.value : c);
  assert.deepEqual(all.ownMessages.choices.map(cv), ['run', 'blocked']);
  const origLen = S('ownMessages').choices.length;
  assert.notEqual(all.ownMessages.choices, S('ownMessages').choices, 'choices array must be a copy');
  all.ownMessages.choices.push('zzz');
  assert.equal(S('ownMessages').choices.length, origLen, 'choices array must be a copy');
  assert.deepEqual(d.warnings, []);
});

test('describe: warnings for bad presets and off, deduped, bad preset warns despite saved', () => {
  const saved = applySave({}, { group: 'limits', values: { dailyReplies: 'off' } }).automation;
  const d = describe(saved, { POCKET_AUTOMATION_DAILY_REPLIES: '0', POCKET_AUTOMATION_JOB_PER_HOUR: 'OFF' });
  assert.ok(d.warnings.includes('POCKET_AUTOMATION_DAILY_REPLIES is ignored: Unattended replies per day must be 1 to 1,000, or No limit.'), JSON.stringify(d.warnings));
  assert.ok(d.warnings.includes('Unattended replies per day has no limit.'));
  assert.ok(d.warnings.includes(S('jobPerHour').label + ' has no limit.'));
  assert.equal(new Set(d.warnings).size, d.warnings.length, 'deduplicated');
  const d2 = describe({}, {});
  assert.deepEqual(d2.warnings, []);
});

// ======================= applySave =======================
test('applySave: exact 400 errors', () => {
  const unk = { error: 'Unknown settings group. Use one of: pause, limits, checkbacks, jobs.', status: 400 };
  assert.deepEqual(applySave({}, { group: 'nope', values: { x: 1 } }), unk);
  assert.deepEqual(applySave({}, { values: { dailyReplies: 5 } }), unk);
  const sv = { error: 'Send values to save, or reset: true.', status: 400 };
  for (const v of [undefined, {}, [], 'x', null, [1]]) assert.deepEqual(applySave({}, { group: 'limits', values: v }), sv, JSON.stringify(v));
  assert.deepEqual(applySave({}, { group: 'limits', values: { zzz: 1 } }), { error: `Unknown setting "zzz" in ${titleOf('limits')}.`, status: 400 });
  assert.deepEqual(applySave({}, { group: 'pause', values: { dailyReplies: 5 } }), { error: `Unknown setting "dailyReplies" in ${titleOf('pause')}.`, status: 400 });
  assert.deepEqual(applySave({}, { group: 'limits', values: { dailyReplies: 0 } }), { error: checkValue(S('dailyReplies'), 0).error, status: 400 });
});

test('applySave: saves normalised values, null deletes, empty group removed, no mutation, all-or-nothing', () => {
  const r1 = applySave({}, { group: 'limits', values: { dailyReplies: '12', openrouterDaily: 1.234 } });
  assert.ok(r1.automation, JSON.stringify(r1));
  assert.equal(groupValues(r1.automation, 'limits', {}).dailyReplies, 12);
  assert.equal(groupValues(r1.automation, 'limits', {}).openrouterDaily, 1.23);
  const before = JSON.stringify(r1.automation);
  const r2 = applySave(r1.automation, { group: 'pause', values: { inboxWatch: false } });
  assert.equal(JSON.stringify(r1.automation), before, 'argument not mutated');
  assert.equal(groupValues(r2.automation, 'pause', {}).inboxWatch, false);
  const bad = applySave(r2.automation, { group: 'limits', values: { dailyReplies: 20, longestReply: 1 } });
  assert.equal(bad.status, 400); assert.equal(bad.automation, undefined);
  assert.equal(groupValues(r2.automation, 'limits', {}).dailyReplies, 12);
  const r3 = applySave(r2.automation, { group: 'limits', values: { dailyReplies: null, openrouterDaily: null } });
  assert.equal(groupValues(r3.automation, 'limits', {}).dailyReplies, 40);
  assert.ok(!('limits' in r3.automation), 'empty group removed: ' + JSON.stringify(r3.automation));
  assert.ok('pause' in r3.automation);
});

test('applySave: reset clears only that group and ignores values', () => {
  let s = applySave({}, { group: 'limits', values: { dailyReplies: 12 } }).automation;
  s = applySave(s, { group: 'jobs', values: { jobAtOnce: 3 } }).automation;
  const r = applySave(s, { group: 'limits', reset: true, values: { dailyReplies: 'bad' } });
  assert.deepEqual(Object.keys(r), ['automation']);
  assert.equal(groupValues(r.automation, 'limits', {}).dailyReplies, 40);
  assert.equal(groupValues(r.automation, 'jobs', {}).jobAtOnce, 3);
  assert.ok(!('limits' in r.automation));
});

test('applySave: saved shape is {group:{key:value}}', () => {
  assert.deepEqual(applySave({}, { group: 'limits', values: { dailyReplies: 12 } }), { automation: { limits: { dailyReplies: 12 } } });
});

// ======================= limitsApply / ceilingHit =======================
test('limitsApply', () => {
  for (const r of ['job', 'checkback']) assert.deepEqual(limitsApply(r, {}), { ceilings: true, daily: true });
  assert.deepEqual(limitsApply('owner', { ceilingsHoldOwnerWork: false, countOwnerWork: false }), { ceilings: false, daily: false });
  assert.deepEqual(limitsApply('owner', { ceilingsHoldOwnerWork: true, countOwnerWork: true }), { ceilings: true, daily: true });
  assert.deepEqual(limitsApply('owner', { ceilingsHoldOwnerWork: 'yes', countOwnerWork: 1 }), { ceilings: false, daily: false });
});

const LIM = { ...DEFAULTS.limits };
const claudeReading = (sd, fh, observedAt = T0 - 1000) => ({ observedAt, windows: { seven_day: sd, five_hour: fh } });

test('ceilingHit claude: order, rounding, resets, off, stale boundary', () => {
  const r = claudeReading({ utilization: 0.85, resetsAt: T0 + HOUR }, { utilization: 0.95, resetsAt: T0 + 600000 });
  const h = ceilingHit('claude', r, LIM, T0);
  assert.equal(h.engine, 'claude'); assert.equal(h.used, 85); assert.equal(h.ceiling, 80);
  const h5 = ceilingHit('claude', claudeReading({ utilization: 0.5 }, { utilization: 0.95 }), LIM, T0);
  assert.equal(h5.window, 'five_hour'); assert.equal(h5.used, 95); assert.equal(h5.ceiling, 90);
  assert.equal(ceilingHit('claude', claudeReading({ utilization: 0.85, resetsAt: T0 }, { utilization: 0.1 }), LIM, T0), null, 'reset at now skipped');
  assert.equal(ceilingHit('claude', claudeReading({ utilization: 0.85, resetsAt: T0 }, { utilization: 0.95 }), LIM, T0).window, 'five_hour');
  assert.ok(ceilingHit('claude', claudeReading({ utilization: 0.85, resetsAt: T0 + 1 }, null), LIM, T0));
  assert.equal(ceilingHit('claude', claudeReading({ utilization: 0.794 }, null), LIM, T0), null);
  assert.equal(ceilingHit('claude', claudeReading({ utilization: 0.795 }, null), LIM, T0)?.used, 80);
  assert.equal(ceilingHit('claude', claudeReading({ utilization: 0.85 }, { utilization: 0.1 }), { ...LIM, claudeWeekly: 'off' }, T0), null);
  assert.equal(ceilingHit('claude', claudeReading({ utilization: NaN }, { utilization: Infinity }), LIM, T0), null);
  assert.equal(ceilingHit('claude', claudeReading({ utilization: 0.99 }, null, T0 - 6 * HOUR - 1), LIM, T0), null, 'stale passes');
  assert.ok(ceilingHit('claude', claudeReading({ utilization: 0.99 }, null, T0 - 6 * HOUR), LIM, T0), 'exact boundary counts');
  assert.equal(ceilingHit('claude', claudeReading({ utilization: 0.99 }, null, T0 - 2 * HOUR - 1), { ...LIM, staleHours: 2 }, T0), null);
  assert.equal(ceilingHit('claude', { windows: { seven_day: { utilization: 0.99 } } }, LIM, T0), null, 'missing observedAt');
  assert.equal(ceilingHit('claude', { observedAt: T0 }, LIM, T0), null, 'missing windows');
  assert.equal(ceilingHit('claude', null, LIM, T0), null);
  assert.equal(ceilingHit('acp', r, LIM, T0), null); assert.equal(ceilingHit('antigravity', r, LIM, T0), null);
});

test('ceilingHit claude: seven_day reported as window "weekly"', () => {
  const h = ceilingHit('claude', claudeReading({ utilization: 0.85 }, null), LIM, T0);
  assert.equal(h.window, 'weekly');
});

test('ceilingHit codex: windows, raw compare, until seconds', () => {
  const sec = T0 / 1000;
  assert.deepEqual(ceilingHit('codex', { primary: { usedPercent: 80, windowDurationMins: 10080, resetsAt: sec + 3600 }, secondary: { usedPercent: 10, windowDurationMins: 300 } }, LIM, T0),
    { engine: 'codex', window: 'weekly', used: 80, ceiling: 80, until: T0 + HOUR });
  assert.equal(ceilingHit('codex', { primary: { usedPercent: 79.6, windowDurationMins: 10080 } }, LIM, T0), null, 'raw compare');
  assert.equal(ceilingHit('codex', { primary: { usedPercent: 89.6, windowDurationMins: 300 } }, LIM, T0), null);
  const h = ceilingHit('codex', { primary: { usedPercent: 90.4, windowDurationMins: 300 } }, LIM, T0);
  assert.equal(h.window, 'five_hour'); assert.equal(h.used, 90); assert.equal(h.ceiling, 90); assert.equal(h.until, undefined);
  assert.equal(ceilingHit('codex', { primary: { usedPercent: 85 } }, LIM, T0), null, 'missing duration -> five_hour ceiling 90');
  assert.equal(ceilingHit('codex', { primary: { usedPercent: 85, windowDurationMins: 1440 } }, LIM, T0)?.window, 'weekly');
  assert.equal(ceilingHit('codex', { primary: { usedPercent: 85, windowDurationMins: 1439 } }, LIM, T0), null);
  assert.equal(ceilingHit('codex', { primary: { usedPercent: 99, windowDurationMins: 10080, resetsAt: sec } }, LIM, T0), null, 'reset at now skipped');
  const s = ceilingHit('codex', { primary: { usedPercent: 10, windowDurationMins: 10080 }, secondary: { usedPercent: 95, windowDurationMins: 300 } }, LIM, T0);
  assert.equal(s.window, 'five_hour');
  assert.equal(ceilingHit('codex', { primary: { usedPercent: 99, windowDurationMins: 10080 } }, { ...LIM, codexWeekly: 'off' }, T0), null);
  assert.equal(ceilingHit('codex', { primary: { usedPercent: '99', windowDurationMins: 10080 } }, LIM, T0), null);
  assert.equal(ceilingHit('codex', null, LIM, T0), null);
});

// ======================= unattendedGate =======================
// ctx/info field names `limits`, `now`, `claude`/`codex` readings and `info.rootOrigin` are not given by the spec;
// they were found by black-box probing (Proxy on ctx), not by reading the source.
const ctxBase = (o = {}) => {
  const { lim, ...rest } = o;
  return { paused: false, ownBlocked: false, features: { checkback: true, job: true }, busy: false, now: T0,
    counts: { startedRoot: 0, startedOwnerRoot: 0, openrouterRoot: 0, openrouterOwnerRoot: 0 }, limits: lim || { ...LIM }, nextDay: 123456, ...rest };
};

test('unattendedGate: owner bypasses everything except paused+ownBlocked', () => {
  const full = ctxBase({ busy: true, features: {}, counts: { startedRoot: 9999, openrouterRoot: 9999 }, lim: { ...LIM, dailyReplies: 1, openrouterDaily: 0.5 } });
  assert.deepEqual(unattendedGate({ origin: 'owner', engine: 'acp', attendedOnly: true }, full), { ok: true });
  assert.deepEqual(unattendedGate({ origin: 'owner' }, { ...full, paused: true }), { ok: true });
  assert.deepEqual(unattendedGate({ origin: 'owner' }, { ...full, paused: true, ownBlocked: true }), { ok: false, reason: 'paused' });
  assert.deepEqual(unattendedGate({ origin: 'mystery' }, { ...full, paused: true }), { ok: true }, 'unknown -> owner');
  assert.deepEqual(unattendedGate({}, ctxBase({ busy: true })), { ok: true });
});

test('unattendedGate: non-owner order paused > attended_only > feature_off > busy', () => {
  const info = { origin: 'checkback', attendedOnly: true };
  assert.deepEqual(unattendedGate(info, ctxBase({ paused: true, features: {}, busy: true })), { ok: false, reason: 'paused' });
  assert.deepEqual(unattendedGate(info, ctxBase({ features: {}, busy: true })), { ok: false, reason: 'attended_only' });
  assert.deepEqual(unattendedGate({ origin: 'checkback' }, ctxBase({ features: {}, busy: true })), { ok: false, reason: 'feature_off', feature: 'checkback' });
  assert.deepEqual(unattendedGate({ origin: 'checkback', rootOrigin: 'job' }, ctxBase({ features: {} })), { ok: false, reason: 'feature_off', feature: 'checkback' });
  assert.deepEqual(unattendedGate({ origin: 'retry', rootOrigin: 'job' }, ctxBase({ features: { checkback: true } })), { ok: false, reason: 'feature_off', feature: 'job' });
  assert.deepEqual(unattendedGate({ origin: 'queue', rootOrigin: 'checkback' }, ctxBase({ features: { job: true } })), { ok: false, reason: 'feature_off', feature: 'checkback' });
  assert.deepEqual(unattendedGate({ origin: 'job' }, ctxBase({ features: { checkback: true, job: 0 } })), { ok: false, reason: 'feature_off', feature: 'job' });
  assert.deepEqual(unattendedGate({ origin: 'queue' }, ctxBase({ features: {} })), { ok: true }, 'queue with owner root needs no feature');
  assert.deepEqual(unattendedGate({ origin: 'job' }, ctxBase({ busy: true })), { ok: false, reason: 'busy' });
  assert.deepEqual(unattendedGate({ origin: 'queue' }, ctxBase({ paused: true })), { ok: false, reason: 'paused' });
  assert.deepEqual(unattendedGate({ origin: 'job' }, ctxBase()), { ok: true });
});

test('unattendedGate: daily replies limit', () => {
  const lim = { ...LIM, dailyReplies: 3 };
  assert.deepEqual(unattendedGate({ origin: 'job', engine: 'claude' }, ctxBase({ lim, counts: { startedRoot: 3 } })),
    { ok: false, reason: 'daily_limit', limit: 'replies', count: 3, max: 3, until: 123456 });
  assert.deepEqual(unattendedGate({ origin: 'job' }, ctxBase({ lim, counts: { startedRoot: 2, startedOwnerRoot: 5 } })), { ok: true });
  assert.deepEqual(unattendedGate({ origin: 'job' }, ctxBase({ lim: { ...lim, countOwnerWork: true }, counts: { startedRoot: 1, startedOwnerRoot: 2 } })),
    { ok: false, reason: 'daily_limit', limit: 'replies', count: 3, max: 3, until: 123456 });
  assert.deepEqual(unattendedGate({ origin: 'job' }, ctxBase({ lim: { ...lim, dailyReplies: 'off' }, counts: { startedRoot: 1e6 } })), { ok: true });
  assert.deepEqual(unattendedGate({ origin: 'job' }, ctxBase({ lim, counts: {} })), { ok: true });
});

test('unattendedGate: OpenRouter daily spend only for acp', () => {
  const lim = { ...LIM, openrouterDaily: 5 };
  assert.deepEqual(unattendedGate({ origin: 'checkback', engine: 'acp' }, ctxBase({ lim, counts: { openrouterRoot: 5 } })),
    { ok: false, reason: 'daily_limit', limit: 'openrouter', spent: 5, max: 5, until: 123456 });
  assert.deepEqual(unattendedGate({ origin: 'checkback', engine: 'claude' }, ctxBase({ lim, counts: { openrouterRoot: 5 } })), { ok: true });
  assert.deepEqual(unattendedGate({ origin: 'checkback', engine: 'acp' }, ctxBase({ lim, counts: { openrouterRoot: 4.99 } })), { ok: true });
  assert.deepEqual(unattendedGate({ origin: 'checkback', engine: 'acp' }, ctxBase({ lim: { ...lim, countOwnerWork: true }, counts: { openrouterRoot: 2, openrouterOwnerRoot: 3 } })),
    { ok: false, reason: 'daily_limit', limit: 'openrouter', spent: 5, max: 5, until: 123456 });
  assert.deepEqual(unattendedGate({ origin: 'checkback', engine: 'acp' }, ctxBase({ lim: { ...lim, openrouterDaily: 'off' }, counts: { openrouterRoot: 1e6 } })), { ok: true });
  assert.equal(unattendedGate({ origin: 'job', engine: 'acp' }, ctxBase({ lim: { ...lim, dailyReplies: 1 }, counts: { startedRoot: 1, openrouterRoot: 9 } })).limit, 'replies', 'replies checked first');
});

test('unattendedGate: plan ceiling applies to job/check-back roots, after busy, before daily', () => {
  const claude = claudeReading({ utilization: 0.85, resetsAt: T0 + HOUR }, null);
  const codex = { primary: { usedPercent: 95, windowDurationMins: 300, resetsAt: T0 / 1000 + 60 } };
  const g = unattendedGate({ origin: 'job', engine: 'claude' }, ctxBase({ claude, counts: { startedRoot: 1e6 } }));
  assert.equal(g.ok, false); assert.equal(g.reason, 'plan_ceiling'); assert.equal(g.engine, 'claude'); assert.equal(g.used, 85); assert.equal(g.ceiling, 80);
  assert.deepEqual(unattendedGate({ origin: 'retry', rootOrigin: 'checkback', engine: 'codex' }, ctxBase({ codex })),
    { ok: false, reason: 'plan_ceiling', engine: 'codex', window: 'five_hour', used: 95, ceiling: 90, until: T0 + 60000 });
  assert.deepEqual(unattendedGate({ origin: 'job', engine: 'claude' }, ctxBase({ claude, busy: true })), { ok: false, reason: 'busy' });
  assert.deepEqual(unattendedGate({ origin: 'queue', engine: 'claude' }, ctxBase({ claude })), { ok: true }, 'owner root, ceilingsHoldOwnerWork false');
  assert.equal(unattendedGate({ origin: 'queue', engine: 'claude' }, ctxBase({ claude, lim: { ...LIM, ceilingsHoldOwnerWork: true } })).reason, 'plan_ceiling');
  assert.deepEqual(unattendedGate({ origin: 'owner', engine: 'claude' }, ctxBase({ claude, lim: { ...LIM, ceilingsHoldOwnerWork: true } })), { ok: true }, 'owner origin bypasses');
  assert.deepEqual(unattendedGate({ origin: 'job', engine: 'claude' }, ctxBase({ claude, lim: { ...LIM, claudeWeekly: 'off' } })), { ok: true });
  assert.deepEqual(unattendedGate({ origin: 'job', engine: 'codex' }, ctxBase({ codex: null })), { ok: true }, 'unavailable reading passes');
});

test('unattendedGate: daily limit does not apply to owner-root work when countOwnerWork is false', () => {
  assert.deepEqual(unattendedGate({ origin: 'queue', engine: 'claude' }, ctxBase({ lim: { ...LIM, dailyReplies: 1 }, counts: { startedRoot: 5 } })), { ok: true });
});

// ======================= noticeFor =======================
test('noticeFor: exact objects and texts', () => {
  const U = Date.parse('2026-02-03T04:05:06.000Z');
  assert.equal(noticeFor(null), null); assert.equal(noticeFor(undefined), null);
  assert.equal(noticeFor({ ok: true }), null); assert.equal(noticeFor({ ok: false, reason: 'busy' }), null);
  assert.deepEqual(noticeFor({ ok: false, reason: 'plan_ceiling', engine: 'claude', window: 'weekly', used: 85, ceiling: 80, until: U }), {
    key: 'plan_ceiling:claude:weekly', reason: 'plan_ceiling', engine: 'claude',
    text: 'Claude Code weekly window is at 85%, over the 80% ceiling. Unattended work is held until 2026-02-03T04:05:06.000Z.' });
  assert.deepEqual(noticeFor({ ok: false, reason: 'plan_ceiling', engine: 'codex', window: 'five_hour', used: 91, ceiling: 90 }), {
    key: 'plan_ceiling:codex:five_hour', reason: 'plan_ceiling', engine: 'codex',
    text: 'Codex 5-hour window is at 91%, over the 90% ceiling. Unattended work is held.' });
  assert.equal(noticeFor({ ok: false, reason: 'plan_ceiling', engine: 'acp', window: 'weekly', used: 1, ceiling: 1, until: 0 }).text,
    'OpenRouter weekly window is at 1%, over the 1% ceiling. Unattended work is held.');
  assert.ok(noticeFor({ ok: false, reason: 'plan_ceiling', engine: 'antigravity', window: 'five_hour', used: 1, ceiling: 1 }).text.startsWith('Antigravity 5-hour window'));
  assert.deepEqual(noticeFor({ ok: false, reason: 'daily_limit', limit: 'openrouter', spent: 5, max: 5, until: U }, ms => 'T' + ms), {
    key: 'daily_limit:openrouter', reason: 'daily_limit', engine: 'acp',
    text: `Unattended OpenRouter spend reached $5.00 today. Unattended OpenRouter replies are held until T${U}.` });
  assert.equal(noticeFor({ ok: false, reason: 'daily_limit', limit: 'openrouter', spent: 1, max: 0.5 }).text,
    'Unattended OpenRouter spend reached $0.50 today. Unattended OpenRouter replies are held.');
  assert.deepEqual(noticeFor({ ok: false, reason: 'daily_limit', limit: 'replies', count: 40, max: 40, until: U }, () => 'tomorrow'), {
    key: 'daily_limit:replies', reason: 'daily_limit', text: '40 unattended replies ran today, the daily limit. Unattended work is held until tomorrow.' });
});

// ======================= replyOverLimit =======================
test('replyOverLimit: guards, waiting accounting, boundary', () => {
  const M = 60000, base = { rootOrigin: 'job', startedAt: 0, limit: 60 };
  assert.equal(replyOverLimit({ ...base, now: 60 * M }), true);
  assert.equal(replyOverLimit({ ...base, now: 60 * M - 1 }), false);
  assert.equal(replyOverLimit({ ...base, rootOrigin: 'checkback', now: 61 * M }), true);
  for (const r of ['owner', 'queue', 'retry', undefined]) assert.equal(replyOverLimit({ ...base, rootOrigin: r, now: 1e9 }), false, String(r));
  for (const l of ['off', NaN, Infinity, undefined, null, '60']) assert.equal(replyOverLimit({ ...base, limit: l, now: 1e9 }), false, String(l));
  for (const s of [undefined, NaN, null, '0']) assert.equal(replyOverLimit({ ...base, startedAt: s, now: 1e9 }), false, String(s));
  assert.equal(replyOverLimit({ ...base, waitingMs: 10 * M, now: 60 * M }), false);
  assert.equal(replyOverLimit({ ...base, waitingMs: 10 * M, now: 70 * M }), true);
  assert.equal(replyOverLimit({ ...base, waitingMs: 10 * M, countWaiting: true, now: 60 * M }), true);
  assert.equal(replyOverLimit({ ...base, waitingSince: 60 * M, now: 70 * M }), true, '70-10=60');
  assert.equal(replyOverLimit({ ...base, waitingSince: 60 * M - 1, now: 70 * M }), false, '70-(10+1ms) < 60');
  assert.equal(replyOverLimit({ ...base, waitingMs: 5 * M, waitingSince: 65 * M, now: 70 * M }), true, '70-5-5=60');
  assert.equal(replyOverLimit({ ...base, waitingMs: 5 * M, waitingSince: 65 * M - 1, now: 70 * M }), false);
  assert.equal(replyOverLimit({ ...base, waitingSince: 60 * M, countWaiting: true, now: 60 * M }), true);
  assert.equal(typeof replyOverLimit({ ...base, startedAt: Date.now() }), 'boolean', 'default now');
});

// ======================= dayKey / nextDayStart =======================
test('dayKey: zones, invalid zone fallback, cache by zone', () => {
  const t = Date.parse('2026-03-08T03:00:00Z');
  assert.equal(dayKey(t, 'UTC'), '2026-03-08');
  assert.equal(dayKey(t, 'America/New_York'), '2026-03-07');
  assert.equal(dayKey(t, 'UTC'), '2026-03-08', 'cache keyed by zone');
  assert.equal(dayKey(t, 'Asia/Tokyo'), '2026-03-08');
  assert.equal(dayKey(t, 'Not/AZone'), dayKey(t, ''));
  assert.equal(dayKey(t, 'Not/AZone'), dayKey(t, undefined));
  assert.match(dayKey(t, ''), /^\d{4}-\d{2}-\d{2}$/);
});

test('nextDayStart: UTC, DST 23h and 25h days, exact boundary', () => {
  assert.equal(nextDayStart(Date.parse('2026-03-08T12:00:00Z'), 'UTC'), Date.parse('2026-03-09T00:00:00Z'));
  assert.equal(nextDayStart(Date.parse('2026-03-08T23:59:59.999Z'), 'UTC'), Date.parse('2026-03-09T00:00:00Z'));
  assert.equal(nextDayStart(Date.parse('2026-03-09T00:00:00Z'), 'UTC'), Date.parse('2026-03-10T00:00:00Z'));
  const ny = 'America/New_York';
  const s1 = Date.parse('2026-03-08T05:00:00Z');
  const b1 = nextDayStart(s1, ny);
  assert.equal(b1, Date.parse('2026-03-09T04:00:00Z')); assert.equal(b1 - s1, 23 * HOUR);
  const s2 = Date.parse('2026-11-01T04:00:00Z');
  const b2 = nextDayStart(s2, ny);
  assert.equal(b2, Date.parse('2026-11-02T05:00:00Z')); assert.equal(b2 - s2, 25 * HOUR);
  assert.notEqual(dayKey(b2 - 1, ny), dayKey(b2, ny));
  assert.equal(nextDayStart(b2 - 1, ny), b2);
});

// ======================= AutomationState contract =======================
test('state: fresh instance, recordStart/recordFinish, compact file, restart', () => {
  const { file, opts, st, clock } = setup();
  assert.deepEqual(st.counts(), { day: '2026-01-01', startedRoot: 0, startedOwnerRoot: 0, openrouterRoot: 0, openrouterOwnerRoot: 0, replies: 0, cost: 0, tokens: 0, notices: [] });
  assert.equal(st.nextDay(), Date.parse('2026-01-02T00:00:00Z'));
  assert.equal(st.recordStart({ rootOrigin: 'job' }), undefined);
  st.recordStart({ rootOrigin: 'checkback' }); st.recordStart({ rootOrigin: 'owner' }); st.recordStart({ rootOrigin: 'queue' });
  assert.equal(st.counts().startedRoot, 2); assert.equal(st.counts().startedOwnerRoot, 2);
  assert.equal(st.recordFinish({ rootOrigin: 'job', engine: 'acp', cost: 0.1234567, tokens: 1000 }), undefined);
  st.recordFinish({ rootOrigin: 'owner', engine: 'acp', cost: 0.2, tokens: 1.5 });
  st.recordFinish({ rootOrigin: 'job', engine: 'claude', cost: -1, tokens: NaN });
  st.recordFinish({ rootOrigin: 'job', engine: 'claude', cost: Infinity, tokens: -5 });
  const c = st.counts();
  assert.equal(c.replies, 4); assert.equal(c.cost, 0.323457); assert.equal(c.tokens, 1001.5);
  assert.equal(c.openrouterRoot, 0.123457); assert.equal(c.openrouterOwnerRoot, 0.2);
  const bytes = fs.readFileSync(file);
  const txt = bytes.toString('utf8');
  assert.equal(txt, JSON.stringify(JSON.parse(txt)), 'compact JSON'); assert.ok(!txt.endsWith('\n'));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.ok(!fs.existsSync(file + '.tmp'));
  const r = new AutomationState(file, { now: clock.now, zone: () => 'UTC' });
  assert.deepEqual(r.counts(), c);
  void opts;
});

test('state: existing target mode replaced by 0600', () => {
  const { file, st } = setup();
  st.recordStart({ rootOrigin: 'job' });
  fs.chmodSync(file, 0o644);
  st.recordStart({ rootOrigin: 'job' });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('state: counts() shallow copy sharing notices reference', () => {
  const { st } = setup();
  const a = st.counts(); a.replies = 99;
  assert.equal(st.counts().replies, 0);
  assert.equal(st.counts().notices, st.counts().notices);
});

test('state: rollover archives totals, resets, saves; earlier day no-op; zone west no-op', () => {
  let zone = 'UTC';
  const { file, st, clock } = setup({ zone: () => zone });
  st.recordStart({ rootOrigin: 'job' });
  st.recordFinish({ rootOrigin: 'job', engine: 'acp', cost: 0.5, tokens: 10 });
  assert.equal(st.rollover().day, '2026-01-01');
  clock.set(T0 - DAY); assert.equal(st.rollover().day, '2026-01-01'); assert.equal(st.counts().replies, 1);
  clock.set(Date.parse('2026-01-02T02:00:00Z'));
  zone = 'America/New_York';
  assert.equal(st.rollover().day, '2026-01-01', 'zone west earlier day'); assert.equal(st.counts().startedRoot, 1);
  zone = 'UTC';
  const row = st.rollover();
  assert.equal(row.day, '2026-01-02'); assert.equal(row.replies, 0); assert.equal(row.startedRoot, 0); assert.deepEqual(row.notices, []);
  const d = disk(file);
  assert.equal(d.today.day, '2026-01-02');
  assert.deepEqual(d.days, [{ date: '2026-01-01', replies: 1, cost: 0.5, tokens: 10 }]);
});

test('state: rollover of idle day (starts only) adds no history row', () => {
  const { file, st, clock } = setup();
  st.recordStart({ rootOrigin: 'job' });
  clock.advance(DAY); st.rollover();
  assert.deepEqual(disk(file).days, []);
});

test('state: history keeps last 14, same-date row replaced', () => {
  const { file, st, clock } = setup();
  for (let i = 0; i < 20; i++) { st.recordFinish({ rootOrigin: 'job', engine: 'claude', cost: 0, tokens: i + 1 }); clock.advance(DAY); st.rollover(); }
  const d = disk(file).days;
  assert.equal(d.length, 14);
  assert.equal(d.at(-1).date, isoDay(T0 + 19 * DAY)); assert.equal(d[0].date, isoDay(T0 + 6 * DAY));
  const { file: f2, clock: c2 } = setup();
  fs.writeFileSync(f2, JSON.stringify({ today: { day: '2026-01-01', replies: 2, cost: 0, tokens: 0 }, days: [{ date: '2026-01-01', replies: 9, cost: 0, tokens: 0 }] }));
  const s2 = new AutomationState(f2, { now: c2.now, zone: () => 'UTC' });
  c2.advance(DAY); s2.rollover();
  assert.deepEqual(disk(f2).days, [{ date: '2026-01-01', replies: 2, cost: 0, tokens: 0 }]);
});

test('state: usage() seven rows oldest to today with zero rows for gaps', () => {
  const { st, clock } = setup();
  st.recordFinish({ rootOrigin: 'job', engine: 'claude', cost: 0.25, tokens: 5 });
  st.recordFinish({ rootOrigin: 'job', engine: 'claude', cost: 0.25, tokens: 5 });
  clock.advance(2 * DAY);
  st.recordFinish({ rootOrigin: 'job', engine: 'claude', cost: 0.1, tokens: 1 });
  const u = st.usage();
  assert.deepEqual(u.today, { replies: 1, cost: 0.1, tokens: 1 });
  assert.equal(u.days.length, 7);
  assert.deepEqual(u.days.map(r => r.date), [6, 5, 4, 3, 2, 1, 0].map(k => isoDay(clock.now() - k * DAY)));
  assert.deepEqual(u.days[6], { date: isoDay(clock.now()), replies: 1, cost: 0.1, tokens: 1 });
  assert.deepEqual(u.days[4], { date: '2026-01-01', replies: 2, cost: 0.5, tokens: 10 });
  assert.deepEqual(u.days[5], { date: '2026-01-02', replies: 0, cost: 0, tokens: 0 });
});

test('state: noticeOnce / notices', () => {
  const { file, st, clock, opts } = setup();
  const snap = snapshot(file);
  assert.equal(st.noticeOnce(null), false); assert.ok(unchanged(file, snap));
  const n = noticeFor({ ok: false, reason: 'plan_ceiling', engine: 'codex', window: 'weekly', used: 90, ceiling: 80 });
  assert.equal(st.noticeOnce(n), true);
  assert.equal(st.noticeOnce({ ...n, text: 'other' }), false);
  assert.deepEqual(st.notices(), [{ reason: 'plan_ceiling', engine: 'codex', at: new Date(T0).toISOString(), text: n.text }]);
  assert.equal(st.counts().notices[0].key, n.key, 'key still stored');
  assert.equal(disk(file).today.notices.length, 1);
  const r = new AutomationState(file, opts);
  assert.equal(r.noticeOnce(n), false, 'restart remembers');
  clock.advance(DAY);
  assert.equal(st.noticeOnce(n), true, 'new day allows again');
});

// 1.124.4 (D2): bytes that are not a JSON object are kept aside (store-file.mjs) rather than left for the next save to
// replace; an object without a usable day starts an empty day and stays as it is until the next save.
test('state: constructor tolerance and pass-through', () => {
  const { dir, file, opts } = setup();
  const quiet = { ...opts, log: () => {} };
  for (const bad of ['{not json', '[]', '42', 'null', '{"today":{"replies":3}}', '{"today":{"day":5,"replies":3}}']) {
    for (const n of fs.readdirSync(dir)) if (n.includes('.corrupt-')) fs.unlinkSync(path.join(dir, n));
    fs.writeFileSync(file, bad);
    const s = new AutomationState(file, quiet);
    assert.equal(s.counts().replies, 0, bad); assert.equal(s.counts().day, '2026-01-01');
    const kept = fs.readdirSync(dir).find(n => n.includes('.corrupt-'));
    if (bad.startsWith('{"today"')) assert.equal(fs.readFileSync(file, 'utf8'), bad, 'not rewritten at construction');
    else { assert.equal(fs.existsSync(file), false, bad); assert.equal(fs.readFileSync(path.join(dir, kept), 'utf8'), bad, 'kept aside whole'); }
  }
  fs.writeFileSync(file, JSON.stringify({ today: { day: '2026-01-01', replies: 3, extra: 'x' }, days: [] }));
  const s = new AutomationState(file, opts);
  assert.equal(s.counts().extra, 'x'); assert.equal(s.counts().replies, 3); assert.equal(s.counts().startedRoot, 0);
});

test('state: restart ignores a newer .tmp', () => {
  const { file, st, opts } = setup();
  st.recordStart({ rootOrigin: 'job' });
  fs.writeFileSync(file + '.tmp', JSON.stringify({ today: { day: '2026-01-01', startedRoot: 50 }, days: [] }));
  assert.equal(new AutomationState(file, opts).counts().startedRoot, 1);
});

test('state: injected writer receives (file, state)', () => {
  const calls = [];
  const { file, st } = setup({ write: (f, s) => calls.push([f, JSON.parse(JSON.stringify(s))]) });
  st.recordStart({ rootOrigin: 'job' });
  assert.equal(calls.length, 1); assert.equal(calls[0][0], file);
  assert.equal(calls[0][1].today.startedRoot, 1); assert.ok(Array.isArray(calls[0][1].days));
});

// ======================= fail-every-step: AutomationState =======================
const MODES = {
  mkdirSync: (dir) => failFsFor('mkdirSync', dir),
  'writeFileSync temp': () => failFsFor('writeFileSync', /automation-state\.json\.tmp$/, { code: 'ENOSPC' }),
  'writeFileSync temp partial': () => {
    const real = fs.writeFileSync;
    return patch(fs, 'writeFileSync', function (p, d, o) {
      if (String(p).endsWith('automation-state.json.tmp')) { real.call(fs, p, String(d).slice(0, 9), o); throw Object.assign(new Error('injected short write'), { code: 'ENOSPC' }); }
      return real.apply(fs, arguments);
    });
  },
  renameSync: (dir, file) => failFsFor('renameSync', file),
};
const NOTICE = noticeFor({ ok: false, reason: 'daily_limit', limit: 'replies', count: 40, max: 40 });
const OPS = {
  recordStart: { run: st => st.recordStart({ rootOrigin: 'job' }), mem: st => st.counts().startedRoot, dsk: d => d.today.startedRoot, base: 1 },
  'recordFinish(acp)': { run: st => st.recordFinish({ rootOrigin: 'job', engine: 'acp', cost: 0.25, tokens: 5 }), mem: st => st.counts().openrouterRoot, dsk: d => d.today.openrouterRoot, base: 0.5 },
  noticeOnce: { run: st => st.noticeOnce(NOTICE), mem: st => st.counts().notices.length, dsk: d => d.today.notices.length, base: 0 },
  rollover: { pre: c => c.advance(DAY), run: st => st.rollover(), mem: st => st.counts().day, dsk: d => d.today.day, base: '2026-01-01' },
  save: { run: st => st.save(), signal: true, mem: st => st.counts().startedRoot, dsk: d => d.today.startedRoot, base: 1 },
};

// D1, fixed in 1.124.4. The blind test asked for a throw or for memory to equal disk; neither is right. Rolling memory
// back would loosen the daily limits while Pocket runs, and a throw out of recordStart/recordFinish breaks a reply that
// has already started (1.124.2 removed exactly that throw). So the count stays in memory, and what is required is that
// the file is left as it was, a restart reads the last committed record, and the failure is surfaced: save() returns
// false, saveError is set, the log is called once for a run of failures, and once more when a save works again.
for (const [opName, op] of Object.entries(OPS)) {
  for (const [modeName, arm] of Object.entries(MODES)) {
    test(`fail-step ${opName} at ${modeName}: final bytes unchanged, restart sees last commit, failure surfaced once`, () => {
      const logged = [];
      const { dir, file, st, clock, opts } = setup({ log: (...a) => logged.push(a.join(' ')) });
      st.recordStart({ rootOrigin: 'job' });
      st.recordFinish({ rootOrigin: 'job', engine: 'acp', cost: 0.5, tokens: 10 });
      const snap = snapshot(file);
      op.pre?.(clock);
      const restore = arm(dir, file);
      let res, again;
      try { res = tryCall(() => op.run(st)); again = tryCall(() => st.save()); } finally { restore(); }
      assert.equal(res.threw, false, 'a failed save never throws out of the method');
      assert.ok(unchanged(file, snap), 'final file bytes must be unchanged');
      const d = disk(file);
      assert.equal(d.today.startedRoot, 1); assert.equal(d.today.replies, 1);
      const r = new AutomationState(file, { ...opts, log: () => {} });
      if (opName === 'rollover') {
        r.rollover();
        assert.deepEqual(disk(file).days, [{ date: '2026-01-01', replies: 1, cost: 0.5, tokens: 10 }], 'restart recovers old day and archives it');
      } else {
        assert.equal(op.mem(r), op.base, 'restart sees last committed value');
        assert.equal(r.counts().replies, 1);
      }
      if (op.signal) assert.equal(res.ret, false, 'save() reports the failure');
      else assert.notDeepEqual(op.mem(st), op.dsk(d), 'memory is not rolled back');
      assert.equal(again.ret, false, 'a second failed save reports it too');
      assert.ok(st.saveError && typeof st.saveError.at === 'string' && st.saveError.code, `saveError set: ${JSON.stringify(st.saveError)}`);
      assert.equal(logged.length, 1, 'one log line for the run of failures: ' + JSON.stringify(logged));
      assert.match(logged[0], /automation-state\.json could not be saved/);
      // the next save that works clears the flag, says so, and carries what memory held
      const mem = op.mem(st);
      assert.equal(st.save(), true);
      assert.equal(st.saveError, null);
      assert.equal(logged.length, 2); assert.match(logged[1], /saved again/);
      assert.deepEqual(op.mem(new AutomationState(file, { ...opts, log: () => {} })), mem);
    });
  }
}

// D2, fixed in 1.124.4 with the house pattern for every store (store-file.mjs readStore). The blind test asked for the
// count to be kept or the constructor to throw; instead a file that is there but cannot be read is renamed to
// automation-state.json.corrupt-<UTC time> with its bytes intact, one line names both paths, and the day starts at zero.
// The kept copy is what a repair starts from, and no later save touches it.
test('fail-step constructor readFileSync throws on a valid committed file: kept aside whole, logged, the day starts empty (D2)', () => {
  const { dir, file, st, opts } = setup();
  for (let i = 0; i < 5; i++) st.recordStart({ rootOrigin: 'job' });
  const snap = snapshot(file);
  const logged = [];
  const restore = failFsFor('readFileSync', file);
  let res;
  try { res = tryCall(() => new AutomationState(file, { ...opts, log: (...a) => logged.push(a.join(' ')) })); } finally { restore(); }
  assert.equal(res.threw, false);
  const kept = fs.readdirSync(dir).filter(n => n.startsWith('automation-state.json.corrupt-'));
  assert.equal(kept.length, 1, fs.readdirSync(dir).join(','));
  assert.ok(unchanged(path.join(dir, kept[0]), snap), 'the kept copy holds the committed bytes');
  assert.equal(logged.length, 1);
  assert.match(logged[0], /automation-state\.json could not be read \(EIO\): kept it as \S+automation-state\.json\.corrupt-\d{8}-\d{6}/);
  assert.equal(res.ret.counts().startedRoot, 0);
  res.ret.recordStart({ rootOrigin: 'job' });
  assert.ok(unchanged(path.join(dir, kept[0]), snap), 'the next save leaves the kept copy alone');
});

test('overlap: first save fails, second succeeds and persists both increments', () => {
  let armed = false;
  const w = failing(myWrite, { on: () => armed });
  const { file, st, opts } = setup({ write: w });
  armed = true; tryCall(() => st.recordStart({ rootOrigin: 'job' })); armed = false;
  st.recordStart({ rootOrigin: 'job' });
  assert.equal(disk(file).today.startedRoot, 2);
  assert.equal(new AutomationState(file, opts).counts().startedRoot, 2);
});

test('overlap: two instances on one file, last writer wins (class-level)', () => {
  const { file, st: a, opts } = setup();
  const b = new AutomationState(file, opts);
  a.recordStart({ rootOrigin: 'job' }); a.recordStart({ rootOrigin: 'job' });
  b.recordStart({ rootOrigin: 'job' });
  assert.equal(disk(file).today.startedRoot, 1);
});

test('state encoding: notice text with quotes, backslash, control, non-ASCII round-trips', () => {
  const { file, st, opts } = setup();
  const n = { key: 'k☃', reason: 'x', text: 'a "q" \\ \n\u0001 é 雪 \u{1F600}' };
  assert.equal(st.noticeOnce(n), true);
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('\n'));
  assert.equal(new AutomationState(file, opts).notices()[0].text, n.text);
});

// ======================= appendAudit =======================
function withFixedDate(iso, fn) {
  const Real = Date, fixed = Real.parse(iso);
  class F extends Real { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } }
  globalThis.Date = F;
  try { return fn(); } finally { globalThis.Date = Real; }
}
const lines = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);

test('appendAudit: scrubs top-level text keys and undefined, keeps others, creates dir 0600', () => {
  const dir = tmpDir('auto-');
  const file = path.join(dir, 'nested', 'deeper', 'audit.jsonl');
  const ret = withFixedDate('2026-05-06T07:08:09.010Z', () => appendAudit(file, {
    kind: 'settings', group: 'limits', keys: ['dailyReplies'], nested: { a: [1, { b: 2 }] }, u: undefined, n: null, zero: 0,
    text: 'S1', userText: 'S2', prompt: 'S3', message: 'S4', body: 'S5', note: 'S6', reply: 'S7',
  }));
  assert.equal(ret, undefined);
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(raw.endsWith('\n')); assert.equal(raw.split('\n').length, 2);
  for (const s of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']) assert.ok(!raw.includes(s), s);
  assert.deepEqual(JSON.parse(raw), { at: '2026-05-06T07:08:09.010Z', kind: 'settings', group: 'limits', keys: ['dailyReplies'], nested: { a: [1, { b: 2 }] }, n: null, zero: 0 });
  assert.ok(!('u' in JSON.parse(raw)));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(raw.indexOf('"at"'), 1, 'at first');
});

test('appendAudit: appends rows; mode only on creation; encoding', () => {
  const dir = tmpDir('auto-');
  const file = path.join(dir, 'audit.jsonl');
  appendAudit(file, { kind: 'pause' });
  fs.chmodSync(file, 0o640);
  appendAudit(file, { kind: 'resume', label: 'é "x" \\ \n\t\u0001 \u{1F600}' });
  assert.equal(fs.statSync(file).mode & 0o777, 0o640);
  const L = lines(file);
  assert.equal(L.length, 2);
  assert.equal(JSON.parse(L[1]).label, 'é "x" \\ \n\t\u0001 \u{1F600}');
  assert.match(JSON.parse(L[0]).at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(fs.readFileSync(file).includes(Buffer.from('é', 'utf8')));
});

test('appendAudit fail-step: mkdirSync throws -> no throw, no bytes', () => {
  const dir = tmpDir('auto-');
  const file = path.join(dir, 'audit.jsonl');
  appendAudit(file, { kind: 'a' });
  const snap = snapshot(file);
  const restore = failFsFor('mkdirSync', dir);
  let res; try { res = tryCall(() => appendAudit(file, { kind: 'b' })); } finally { restore(); }
  assert.equal(res.threw, false); assert.equal(res.ret, undefined);
  assert.ok(unchanged(file, snap));
});

test('appendAudit fail-step: cyclic metadata -> no throw, no bytes', () => {
  const dir = tmpDir('auto-');
  const file = path.join(dir, 'audit.jsonl');
  appendAudit(file, { kind: 'a' });
  const snap = snapshot(file);
  const cyc = { kind: 'b' }; cyc.self = cyc;
  const res = tryCall(() => appendAudit(file, cyc));
  assert.equal(res.threw, false); assert.equal(res.ret, undefined);
  assert.ok(unchanged(file, snap));
  assert.equal(tryCall(() => appendAudit(file, { kind: 'big', n: 10n })).threw, false, 'BigInt');
  assert.ok(unchanged(file, snap));
});

test('appendAudit fail-step: appendFileSync throws before bytes -> no throw, old rows intact', () => {
  const dir = tmpDir('auto-');
  const file = path.join(dir, 'audit.jsonl');
  appendAudit(file, { kind: 'a' });
  const snap = snapshot(file);
  const restore = patch(fs, 'appendFileSync', failing(fs.appendFileSync, { error: () => Object.assign(new Error('injected'), { code: 'ENOSPC' }) }));
  let res; try { res = tryCall(() => appendAudit(file, { kind: 'b' })); } finally { restore(); }
  assert.equal(res.threw, false); assert.equal(res.ret, undefined);
  assert.ok(unchanged(file, snap));
  appendAudit(file, { kind: 'c' });
  assert.deepEqual(lines(file).map(l => JSON.parse(l).kind), ['a', 'c']);
});

// ======================= divergences =======================
// D1, fixed in 1.124.4 (see the fail-step table above for why memory stays ahead): a run of failed saves across
// recordStart, recordFinish and noticeOnce is surfaced once, and the next save that works writes everything memory held.
// noticeOnce still answers true: a restart before that save can push the same notice once more, an extra push, not a lost one.
test('a run of failed daily-state writes is surfaced once, and the next good save catches the file up', () => {
  let armed = false;
  const logged = [];
  const { file, st, opts } = setup({ write: failing(myWrite, { on: () => armed }), log: (...a) => logged.push(a.join(' ')) });
  st.recordStart({ rootOrigin: 'job' });
  armed = true;
  const a = tryCall(() => st.recordStart({ rootOrigin: 'job' }));
  const b = tryCall(() => st.recordFinish({ rootOrigin: 'job', engine: 'acp', cost: 1, tokens: 1 }));
  const c = tryCall(() => st.noticeOnce(NOTICE));
  armed = false;
  assert.deepEqual([a.threw, b.threw, c.threw, c.ret], [false, false, false, true]);
  assert.ok(st.saveError); assert.equal(logged.length, 1, JSON.stringify(logged));
  const r = new AutomationState(file, { ...opts, log: () => {} });
  assert.deepEqual([r.counts().startedRoot, r.counts().openrouterRoot, r.counts().notices.length], [1, 0, 0], 'restart reads the last committed record');
  assert.deepEqual([st.counts().startedRoot, st.counts().openrouterRoot], [2, 1], 'memory keeps the counts, so the limits hold while Pocket runs');
  st.recordStart({ rootOrigin: 'job' });
  assert.equal(st.saveError, null); assert.equal(logged.length, 2);
  const r2 = new AutomationState(file, { ...opts, log: () => {} });
  assert.deepEqual([r2.counts().startedRoot, r2.counts().openrouterRoot, r2.counts().notices.length], [3, 1, 1]);
});

// D2, fixed in 1.124.4.
test('malformed daily-state bytes are preserved for repair and logged, not overwritten by the next save', () => {
  const { dir, file, opts } = setup();
  const bad = '{"today":{"day":"2026-01-01","startedRoot":37,"replies":4';
  fs.writeFileSync(file, bad);
  const logged = [];
  const res = tryCall(() => { const s = new AutomationState(file, { ...opts, log: (...a) => logged.push(a.join(' ')) }); s.recordStart({ rootOrigin: 'job' }); return s; });
  const preserved = fs.readdirSync(dir).some(n => fs.readFileSync(path.join(dir, n), 'utf8') === bad);
  assert.ok(res.threw || preserved, 'corrupt state silently replaced: no copy of the bad bytes remains and no error was raised');
  assert.equal(logged.filter(l => /could not be read \(not valid JSON\)/.test(l)).length, 1, JSON.stringify(logged));
});

// D3, fixed in 1.124.4; test/automation.test.mjs proves the same through a real file-size limit.
test('a torn audit append does not corrupt the next successful row', () => {
  const dir = tmpDir('auto-');
  const file = path.join(dir, 'audit.jsonl');
  appendAudit(file, { kind: 'first' });
  const real = fs.appendFileSync;
  const restore = patch(fs, 'appendFileSync', function (p, d, o) {
    real.call(fs, p, String(d).slice(0, 12), o);
    throw Object.assign(new Error('injected short write'), { code: 'ENOSPC' });
  });
  try { appendAudit(file, { kind: 'torn' }); } finally { restore(); }
  appendAudit(file, { kind: 'after' });
  const L = lines(file);
  let last; try { last = JSON.parse(L.at(-1)); } catch { last = null; }
  assert.equal(last?.kind, 'after', 'row after a torn append is not individually decodable: ' + JSON.stringify(L.at(-1)));
});

test('DIV-4: audit must not serialise nested text, and at must be generated, not caller-controlled', () => {
  const dir = tmpDir('auto-');
  const file = path.join(dir, 'audit.jsonl');
  withFixedDate('2026-05-06T07:08:09.010Z', () => appendAudit(file, { kind: 'job', at: '1999-01-01T00:00:00.000Z', meta: { text: 'NESTED-SECRET', prompt: 'NESTED-PROMPT' } }));
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(JSON.parse(raw).at, '2026-05-06T07:08:09.010Z', 'caller-supplied at overrides generated timestamp');
  assert.ok(!raw.includes('NESTED-SECRET') && !raw.includes('NESTED-PROMPT'), 'nested text serialised');
});
