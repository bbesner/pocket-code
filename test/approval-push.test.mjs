// 1.126: the rules of answering an action approval from its notification, without a server (approval-push.mjs;
// docs/plans/notification-approvals.md Parts 1, 2, 4, 5 and the Settings table). The numbered tests are the spec's
// Testing list; the server half of each is in test/approval-push-routes.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as ap from '../approval-push.mjs';
import { approvalCard, approvalFacts } from '../acp.mjs';
import { hasUnusual } from '../push-text.mjs';

const HOME = '/home/owner';
const CWD = '/home/owner/projects/shop';
const cfgOf = (over = {}) => ({ ...ap.values({}, {}), answers: true, ...over });
const tested = (limit = 80, over = {}) => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/one', kinds: {}, [ap.ALLOW_FIELD]: { limit, at: '2026-11-27T12:00:00.000Z' }, ...over });
const turnOf = (engine, over = {}) => ({ sessionId: 's-1', engine, cwd: CWD, home: HOME, root: 'owner', jobConversation: false, jobName: null, title: 'Shop price pages', ...over });
let n = 0;
const claudeRow = (tool, input, over = {}) => ({ id: 'r' + (++n), kind: 'tool', canAllow: true, agent: null, details: JSON.stringify({ tool, cwd: CWD, input }), ...over });
const codexRow = (kind, details, over = {}) => ({ id: 'r' + (++n), kind, canAllow: true, agent: null, details: JSON.stringify(details), ...over });
// An ACP row built by acp.mjs's own functions from a session/request_permission's params, as the inbox stores it
const OPTS = [{ optionId: 'once', kind: 'allow_once', name: 'Allow once' }, { optionId: 'no', kind: 'reject_once', name: 'Reject' }];
function acpRow(toolCall, options = OPTS) {
  const params = { toolCall, options }, card = approvalCard(params);
  return { id: 'r' + (++n), kind: card.kind, canAllow: true, agent: null, details: JSON.stringify(card.details), facts: approvalFacts(params) };
}
const push = (row, t, cfg = cfgOf(), device = tested()) => ap.approvalPush(row, t, device, cfg);
const allowOf = p => p.payload.actions.map(a => a.action);
// Every push must hold to these, whatever went in
function invariants(p) {
  assert.equal(p.payload.tag.startsWith('approval:'), true);
  assert.equal(p.payload.actions[0].action, 'deny', "Don't allow is offered on every action approval");
  assert.equal(allowOf(p).includes('allow'), p.allow);
  if (p.allow) {
    assert.equal(p.payload.body, p.body, 'a push with Allow is never cut');
    assert.equal(p.payload.title, p.title);
    assert.ok(ap.PRINTABLE_ASCII.test(p.lines[0]) && ap.PRINTABLE_ASCII.test(p.lines[1]), 'a push with Allow has printable ASCII action and folder');
    assert.ok(!/\u2026|too long to show|open Pocket/.test(p.lines[0] + p.lines[1]), 'a push with Allow never shows a cut or a pointer');
  }
  for (const l of p.lines) assert.ok(!hasUnusual(l) && !/\n/.test(l), 'every line is one line: ' + JSON.stringify(l));
}

test('T3 (rules): ACP, Don\'t allow only: only allow_always offered; text only from the title; kind not execute; a rawInput key off the list; a rawInput.cwd unlike the folder', () => {
  const t = turnOf('acp');
  const good = acpRow({ kind: 'execute', title: 'ls', rawInput: { command: 'ls -la' } });
  const ok = push(good, t); invariants(ok);
  assert.equal(ok.allow, true); assert.equal(ok.lines[0], 'Runs: ls -la'); assert.equal(ok.lines[1], 'Conversation folder: ~/projects/shop', 'OpenCode names no folder of its own');
  assert.equal(push(acpRow({ kind: 'execute', title: 'ls', rawInput: { command: 'ls', cwd: CWD } }), t).lines[1], 'In: ~/projects/shop', 'a request that names the conversation\'s folder says In:');
  const agy = acpRow({ kind: 'execute', title: 'Run', rawInput: { CommandLine: 'git status', WaitMsBeforeAsync: 500, toolSummary: 'status', cwd: CWD } });
  assert.equal(push(agy, turnOf('antigravity')).allow, true, 'Antigravity CommandLine with its own fields and the same folder');
  const cases = {
    allowAlways: acpRow({ kind: 'execute', title: 'ls', rawInput: { command: 'ls' } }, [{ optionId: 'a', kind: 'allow_always', name: 'Always' }, { optionId: 'no', kind: 'reject_once', name: 'No' }]),
    titleOnly: acpRow({ kind: 'execute', title: 'rm -rf build', rawInput: {} }),
    titleNoRaw: acpRow({ kind: 'execute', title: 'rm -rf build' }),
    notExecute: acpRow({ kind: 'fetch', title: 'Fetch', rawInput: { command: 'ls' } }),
    otherKey: acpRow({ kind: 'execute', title: 'ls', rawInput: { command: 'ls', env: { PATH: '/tmp' } } }),
    otherCwd: acpRow({ kind: 'execute', title: 'ls', rawInput: { command: 'ls', cwd: '/etc' } }),
    otherCwdSlash: acpRow({ kind: 'execute', title: 'ls', rawInput: { command: 'ls', cwd: CWD + '/' } }),
    edit: acpRow({ kind: 'edit', title: 'Edit', rawInput: { filePath: CWD + '/a.txt' } }),
  };
  for (const [name, row] of Object.entries(cases)) {
    const p = push(row, turnOf(name === 'titleOnly' ? 'antigravity' : 'acp')); invariants(p);
    assert.equal(p.allow, false, name); assert.deepEqual(allowOf(p), ['deny'], name);
  }
  // The title is never the action text: a title-only request shows Pocket's words, not the title
  const p = push(cases.titleOnly, t);
  assert.equal(p.lines[0], 'Runs: (no command given; open Pocket to review it)'); assert.ok(!p.body.includes('rm -rf build'));
  assert.equal(push(cases.notExecute, t).lines[0], 'Uses: Web');
  assert.equal(push(cases.edit, t).lines[0], 'Edits: ' + CWD + '/a.txt');
});

test('T4 (rules): Codex, Don\'t allow only for additionalPermissions, a list command, network, permissions and fileChange; the single-quoted script is unwrapped exactly', () => {
  const t = turnOf('codex');
  const ls = push(codexRow('command', { command: "/bin/bash -lc 'ls -la'", cwd: CWD }), t); invariants(ls);
  assert.equal(ls.allow, true); assert.equal(ls.lines[0], 'Runs: ls -la'); assert.equal(ls.title, 'Allow this command?');
  const quoted = `/bin/bash -lc 'echo '"'"'hi'"'"''`;
  const q = push(codexRow('command', { command: quoted, cwd: CWD }), t); invariants(q);
  assert.equal(q.lines[0], 'Runs: ' + quoted, 'a script holding a quote shows the whole string');
  const rows = {
    additionalPermissions: codexRow('command', { command: 'ls', cwd: CWD, additionalPermissions: { network: true } }),
    list: codexRow('command', { command: ['ls', '-la'], cwd: CWD }),
    noCwd: codexRow('command', { command: 'ls' }),
    network: codexRow('network', { network: { host: 'example.com' }, cwd: CWD }),
    permissions: codexRow('permissions', { permissions: { fileSystem: { write: ['/'] } }, cwd: CWD }),
    fileChange: codexRow('fileChange', { changes: [{ path: CWD + '/a.js' }, { path: CWD + '/b.js' }], cwd: CWD }),
  };
  for (const [name, row] of Object.entries(rows)) { const p = push(row, t); invariants(p); assert.equal(p.allow, false, name); }
  assert.equal(push(rows.list, t).lines[0], 'Runs: (a list of arguments; open Pocket to review it)');
  assert.equal(push(rows.network, t).lines[0], 'Network access: example.com');
  assert.equal(push(rows.permissions, t).lines[0], 'Uses: more access for this reply');
  assert.equal(push(rows.fileChange, t).lines[0], `Edits: ${CWD}/a.js and 1 more`);
  assert.equal(push(rows.noCwd, t).lines[1], 'Conversation folder: ~/projects/shop');
});

test('T5 (rules): Claude, Don\'t allow only for Write, Edit, Agent, Skill, ExitPlanMode, mcp__*, WebSearch with allowed_domains and Bash with a field off the list', () => {
  const t = turnOf('claude');
  const yes = [
    ['Bash', { command: 'npm test', description: 'Run tests', timeout: 60000 }, 'Allow this command?', 'Runs: npm test'],
    ['PowerShell', { command: 'Get-ChildItem' }, 'Allow this command?', 'Runs: Get-ChildItem'],
    ['WebFetch', { url: 'https://example.com/a', prompt: 'Summarize' }, 'Allow this web page?', 'Opens: https://example.com/a'],
    ['WebSearch', { query: 'node 24 release' }, 'Allow this web search?', 'Searches: node 24 release'],
  ];
  for (const [tool, input, title, line] of yes) {
    const p = push(claudeRow(tool, input), t); invariants(p);
    assert.equal(p.allow, true, tool); assert.equal(p.title, title); assert.equal(p.lines[0], line); assert.equal(p.lines[1], 'Conversation folder: ~/projects/shop');
  }
  const no = [
    ['Write', { file_path: CWD + '/a', content: 'x' }, 'Edits: ' + CWD + '/a'],
    ['Edit', { file_path: CWD + '/a', old_string: 'a', new_string: 'b' }, 'Edits: ' + CWD + '/a'],
    ['Agent', { prompt: 'do it', subagent_type: 'x' }, 'Starts a helper'],
    ['Skill', { skill: 'x' }, 'Uses: Skill'],
    ['ExitPlanMode', { plan: 'x' }, 'Uses: ExitPlanMode'],
    ['mcp__drive__upload', { path: '/x' }, 'Uses: mcp__drive__upload'],
    ['WebSearch', { query: 'x', allowed_domains: ['example.com'] }, 'Searches: x'],
    ['WebSearch', { query: 'x', blocked_domains: [] }, 'Searches: x'],
    ['Bash', { command: 'ls', dangerouslyDisableSandbox: true }, 'Runs: ls'],
    ['Bash', { command: ['ls'] }, 'Runs: (not given; open Pocket to review it)'],
  ];
  for (const [tool, input, line] of no) {
    const p = push(claudeRow(tool, input), t); invariants(p);
    assert.equal(p.allow, false, tool + ' ' + JSON.stringify(input)); assert.equal(p.lines[0], line);
  }
  assert.ok(!push(claudeRow('Write', { file_path: CWD + '/a', content: 'SECRET BODY' }), t).body.includes('SECRET BODY'), 'an edit never shows its content');
});

test('T6 (rules): an action and a folder of exactly the limit get Allow; one more character doesn\'t, and the line gives the length', () => {
  const t = turnOf('codex', { cwd: HOME + '/p' });
  const folderLine = 'In: ~/p', room = 80 - folderLine.length - 'Runs: '.length;
  const at = 'echo ' + 'x'.repeat(room - 5), over = at + 'y';
  const a = push(codexRow('command', { command: at, cwd: HOME + '/p' }), t); invariants(a);
  assert.equal(a.lines[0].length + a.lines[1].length, 80); assert.equal(a.allow, true); assert.equal(a.lines[0], 'Runs: ' + at);
  const b = push(codexRow('command', { command: over, cwd: HOME + '/p' }), t); invariants(b);
  assert.equal(b.allow, false); assert.equal(b.lines[0], `Runs: (${over.length} characters, too long to show here; open Pocket to review it)`);
  assert.ok(!b.body.includes(over.slice(0, 30)), 'a long command is not shown cut');
  // The folder counts too: the same command in a longer folder loses Allow
  assert.equal(push(codexRow('command', { command: at, cwd: HOME + '/pq' }), turnOf('codex', { cwd: HOME + '/pq' })).allow, false);
  // A higher limit, on a device tested at it, takes the longer one
  const c = push(codexRow('command', { command: over, cwd: HOME + '/p' }), t, cfgOf({ longestAction: 81 }), tested(81));
  assert.equal(c.allow, true);
  // Claude's "Conversation folder:" label counts as well
  const ct = turnOf('claude'), cf = 'Conversation folder: ~/projects/shop';
  const cmd = 'x'.repeat(80 - cf.length - 'Runs: '.length);
  assert.equal(push(claudeRow('Bash', { command: cmd }), ct).allow, true);
  assert.equal(push(claudeRow('Bash', { command: cmd + 'x' }), ct).allow, false);
});

test('T7 (rules): no Allow for a line break, tab, U+202E, U+200B, a Cyrillic letter, an accented folder, a planted key, a .. folder part or a payload push would cut', () => {
  const t = turnOf('claude');
  const KEY = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
  const bad = {
    lineBreak: claudeRow('Bash', { command: 'ls\nrm -rf ~' }),
    tab: claudeRow('Bash', { command: 'ls\t-la' }),
    rlo: claudeRow('Bash', { command: 'ls \u202Eal-' }),
    zwsp: claudeRow('Bash', { command: 'r\u200Bm x' }),
    cyrillic: claudeRow('Bash', { command: 'c\u0443rl https://x.test' }),
    key: claudeRow('Bash', { command: 'gh api -H "token ' + KEY + '"' }),
  };
  for (const [name, row] of Object.entries(bad)) {
    const p = push(row, t); invariants(p);
    assert.equal(p.allow, false, name);
  }
  assert.equal(push(bad.lineBreak, t).lines[0], 'Runs: ls rm -rf ~', 'the cleaned text, on one line');
  const k = push(bad.key, t);
  assert.ok(!JSON.stringify(k.payload).includes(KEY) && !JSON.stringify(k.payload).includes(KEY.slice(4, 20)), 'the planted key appears nowhere in the payload');
  assert.equal(k.lines[0], 'Runs: (looks like it contains a password or key; open Pocket to review it)');
  // The folder: an accented letter, a .. part, a line break (Codex)
  const accent = push(codexRow('command', { command: 'ls', cwd: HOME + '/caf\u00E9' }), turnOf('codex', { cwd: HOME + '/caf\u00E9' }));
  invariants(accent); assert.equal(accent.allow, false);
  const dots = push(codexRow('command', { command: 'ls', cwd: CWD + '/../../etc' }), turnOf('codex'));
  invariants(dots); assert.equal(dots.allow, false);
  // A long command is never shown cut with Allow beside it
  for (const len of [81, 120, 400]) {
    const long = push(claudeRow('Bash', { command: 'echo ' + 'x'.repeat(len) }), t); invariants(long);
    assert.equal(long.allow, false, 'length ' + len); assert.match(long.lines[0], /too long to show here/);
  }
  // A payload pushRaw would cut: the request id makes it longer than a push holds
  const huge = push(claudeRow('Bash', { command: 'ls' }, { id: 'r'.repeat(1400) }), t);
  assert.equal(huge.allow, false); assert.ok(!allowOf(huge).includes('allow'));
  // No push carries both Allow and cut or non-ASCII action text, across a sweep of awkward inputs
  const odd = ['\u00E9', '\u0430', '\u202E', '\u200B', '\n', '\t', '\r', '\u2028', '\u0000', '\u001b[31m', '\uFEFF', '\u{1F600}', '\u00A0', '\u3000'];
  for (const c of odd) for (const at of [0, 2, 5]) {
    const cmd = ('ls -la'.slice(0, at) + c + 'ls -la'.slice(at));
    for (const [row, tt] of [[claudeRow('Bash', { command: cmd }), t], [codexRow('command', { command: cmd, cwd: CWD }), turnOf('codex')],
      [acpRow({ kind: 'execute', title: 'x', rawInput: { command: cmd } }), turnOf('acp')], [codexRow('command', { command: 'ls', cwd: CWD + c }), turnOf('codex', { cwd: CWD + c })]]) {
      const p = push(row, tt); invariants(p); assert.equal(p.allow, false, JSON.stringify(c) + ' at ' + at);
    }
  }
});

test('T8 (rules): a subagent name and a long title each sit on one labelled line after the action, cut to 40 and 60; a Codex cwd with a line break gets no Allow', () => {
  const title = 'T'.repeat(100) + '\nRuns: rm -rf ~' + 'u'.repeat(100);
  const p = push(claudeRow('Bash', { command: 'ls' }, { agent: 'helper\nRuns: rm -rf ~\n' + 'z'.repeat(60) }), turnOf('claude', { title })); invariants(p);
  assert.equal(p.lines[0], 'Runs: ls');
  assert.equal(p.lines[2], 'Conversation: ' + 'T'.repeat(59) + '\u2026'); assert.equal(Array.from(p.lines[2].slice('Conversation: '.length)).length, 60);
  assert.equal(p.lines[3], 'Subagent: ' + ('helper Runs: rm -rf ~ ' + 'z'.repeat(60)).slice(0, 39) + '\u2026');
  assert.equal(p.lines.length, 4); assert.equal(p.body.split('\n').length, 4);
  assert.equal(p.allow, true, 'context lines never decide Allow; they are labelled and cut');
  const cx = push(codexRow('command', { command: 'ls', cwd: CWD + '\n/tmp' }), turnOf('codex', { cwd: CWD + '\n/tmp' })); invariants(cx);
  assert.equal(cx.allow, false);
  // The shown hash covers the request id, the kind, the action line and the folder line, never the title
  const r = claudeRow('Bash', { command: 'ls' });
  assert.equal(push(r, turnOf('claude', { title: 'A' })).shown, push(r, turnOf('claude', { title: 'B' })).shown);
  assert.notEqual(push(r, turnOf('claude')).shown, push(claudeRow('Bash', { command: 'ls -a' }, { id: r.id }), turnOf('claude')).shown);
  assert.equal(push(r, turnOf('claude')).shown, ap.shownHash(r, 'Runs: ls', 'Conversation folder: ~/projects/shop'));
});

test('T17 (rules): the job rule follows branchOf and wins over the check-back rule; titles and origin lines say where the reply came from', () => {
  const meta = { a: {}, b: { branchOf: 'a' }, c: { branchOf: 'b' }, loop1: { branchOf: 'loop2' }, loop2: { branchOf: 'loop1' } };
  const ranIn = id => id === 'a';
  const opts = { metaOf: id => meta[id], ranIn };
  assert.equal(ap.jobConversation('a', opts), true);
  assert.equal(ap.jobConversation('b', opts), true, 'a branch of a job\'s conversation');
  assert.equal(ap.jobConversation('c', opts), true, 'a branch of that branch');
  assert.equal(ap.jobConversation('loop1', opts), false, 'a branchOf loop ends');
  assert.equal(ap.jobConversation('z', opts), false);
  const off = cfgOf(), on = cfgOf({ jobs: true });
  assert.equal(ap.originAllows({ root: 'owner', jobConversation: false }, off), true);
  assert.equal(ap.originAllows({ root: 'job' }, off), false); assert.equal(ap.originAllows({ root: 'job' }, on), true);
  assert.equal(ap.originAllows({ root: 'owner', jobConversation: true }, off), false, 'the owner\'s later reply in a job\'s conversation');
  assert.equal(ap.originAllows({ root: 'checkback', jobConversation: true }, cfgOf({ checkbacks: true })), false, 'a check-back in a job\'s conversation follows the job rule');
  assert.equal(ap.originAllows({ root: 'checkback', jobConversation: false }, cfgOf({ checkbacks: false })), false);
  assert.equal(ap.originAllows({ root: 'checkback', jobConversation: false }, cfgOf()), true);
  const row = claudeRow('Bash', { command: 'ls' });
  const job = push(row, turnOf('claude', { root: 'job', jobName: 'nightly\nreport' }));
  assert.equal(job.title, 'Job: Allow this command?'); assert.equal(job.lines[3], 'Started by job nightly report'); assert.equal(job.allow, false);
  assert.equal(push(row, turnOf('claude', { root: 'job', jobName: 'x' }), on).allow, true);
  const cb = push(row, turnOf('claude', { root: 'checkback' }));
  assert.equal(cb.title, 'Check-back: Allow this command?'); assert.equal(cb.lines[3], 'Started by a check-back'); assert.equal(cb.allow, true);
  const owned = push(row, turnOf('claude', { jobConversation: true }));
  assert.equal(owned.title, 'Allow this command?'); assert.equal(owned.lines[3], 'A job has run in this conversation'); assert.equal(owned.allow, false);
});

test('T18 (rules): a canAllow false row, the feature off, an engine off and an untested device never get Allow', () => {
  const t = turnOf('claude'), row = claudeRow('Bash', { command: 'ls' });
  assert.equal(push(row, t).allow, true);
  assert.equal(push({ ...row, canAllow: false }, t).allow, false);
  assert.equal(push(row, t, cfgOf({ answers: false })).allow, false);
  assert.equal(push(row, t, cfgOf({ engineClaude: false })).allow, false);
  assert.equal(push(codexRow('command', { command: 'ls', cwd: CWD }), turnOf('codex'), cfgOf({ engineCodex: false })).allow, false);
  assert.equal(push(acpRow({ kind: 'execute', title: 'x', rawInput: { command: 'ls' } }), turnOf('acp'), cfgOf({ engineOpenrouter: false })).allow, false);
  assert.equal(push(acpRow({ kind: 'execute', title: 'x', rawInput: { command: 'ls' } }), turnOf('antigravity'), cfgOf({ engineAntigravity: false })).allow, false);
  assert.equal(push(row, t, cfgOf(), null).allow, false);
  assert.equal(push(row, t, cfgOf(), tested(80, { kinds: { approvals: false } })).allow, false);
  assert.equal(push(row, t, cfgOf(), { endpoint: 'x', kinds: {} }).allow, false, 'never tested');
  assert.equal(push(row, t, cfgOf({ longestAction: 81 }), tested(80)).allow, false, 'tested below today\'s limit');
  assert.equal(push(row, t, cfgOf({ longestAction: 60 }), tested(80)).allow, true, 'tested above it');
  assert.equal(push(row, t, cfgOf(), tested('80')).allow, false, 'only a whole number counts as tested');
});

test('T19 (rules): the device status and the test push, whose action and folder lines are exactly the limit and end in the codes', () => {
  const cfg = cfgOf();
  assert.deepEqual(ap.deviceStatus(tested(80), cfg), { subscribed: true, approvals: true, allowButton: true, testedLimit: 80, testedAt: '2026-11-27T12:00:00.000Z', currentLimit: 80, retest: false });
  assert.equal(ap.deviceStatus(tested(80), cfgOf({ longestAction: 100 })).retest, true);
  assert.equal(ap.deviceStatus(tested(80, { kinds: { approvals: false } }), cfg).allowButton, false);
  assert.deepEqual(ap.deviceStatus(null, cfg), { subscribed: false, approvals: false, allowButton: false, testedLimit: null, testedAt: null, currentLimit: 80, retest: false });
  for (let limit = 40; limit <= 240; limit++) {
    const codes = [ap.makeCode(), ap.makeCode()], x = ap.testPush(limit, codes);
    assert.equal(x.actionLine.length + x.folderLine.length, limit, 'limit ' + limit);
    assert.ok(x.actionLine.startsWith('Runs: ') && x.actionLine.endsWith(' ' + codes[0]));
    assert.ok(x.folderLine.startsWith('In: ~/') && x.folderLine.endsWith('/' + codes[1]));
    assert.ok(ap.PRINTABLE_ASCII.test(x.actionLine + x.folderLine));
    assert.deepEqual(x.payload.actions.map(a => a.action), ['deny', 'allow']);
    assert.equal(x.payload.approvalTest, true); assert.equal(x.payload.approval, undefined, 'the test push names no request');
    assert.equal(x.payload.body.split('\n')[0], x.actionLine); assert.equal(x.payload.body.split('\n')[1], x.folderLine);
  }
  for (let i = 0; i < 200; i++) assert.match(ap.makeCode(), /^[ACDEFHJKMNPRTUVWXY34679]{2}$/);
  assert.equal(ap.deviceId('https://a'), ap.deviceId('https://a')); assert.match(ap.deviceId('https://a'), /^[0-9a-f]{12}$/);
  assert.equal(ap.serviceLabel(ap.pushServiceOf('https://fcm.googleapis.com/fcm/send/x')), 'Chrome or Android');
  assert.equal(ap.serviceLabel(ap.pushServiceOf('https://web.push.apple.com/x')), 'Apple');
});

test('T20 (rules): "Only that an action waits" sends no conversation title, no action and no Allow', () => {
  const p = push(claudeRow('Bash', { command: 'deploy-the-shop' }, { agent: 'helper-name' }), turnOf('claude', { title: 'Secret project name', root: 'checkback' }), cfgOf({ show: 'waits' }));
  assert.equal(p.title, 'Pocket Code'); assert.equal(p.body, 'An action waits for your OK.'); assert.equal(p.allow, false);
  assert.deepEqual(allowOf(p), ['deny']);
  const all = JSON.stringify(p.payload);
  for (const s of ['deploy-the-shop', 'Secret project name', 'helper-name', 'shop', 'Check-back']) assert.ok(!all.includes(s), s);
  const s = ap.summary('s-1', 2, null);
  assert.equal(s.body, '2 more actions wait'); assert.equal(s.tag, 'approval-more:s-1');
  assert.equal(ap.summary('s-1', 1, 'Shop').body, '1 more action waits in Shop');
  assert.equal(ap.summary('s-1', 0, 'Shop', { silent: true }).silent, true);
  assert.equal(ap.summary('s-1', 2, 'deploy with ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8').body, '2 more actions wait', 'a title that looks like a key is left out');
  const r = ap.replacement('r1', 's-1', 'Not allowed at 2:14 PM');
  assert.deepEqual(r, { title: 'Pocket Code', body: 'Not allowed at 2:14 PM', tag: 'approval:r1', url: '/#/chat/s-1', silent: true });
});

test('T21 (rules): every setting saves, refuses out-of-range values, resets and takes an env preset a saved value overrides', () => {
  const good = { answers: true, show: 'waits', allowFor: 5, checkbacks: false, jobs: true, engineClaude: false, engineCodex: false, engineOpenrouter: false, engineAntigravity: false, longestAction: 240, perConversation: 10, updateOthers: false };
  const bad = { answers: 'yes', show: 'everything', allowFor: 4, checkbacks: 1, jobs: 'on', engineClaude: 'false', engineCodex: 'no', engineOpenrouter: 0, engineAntigravity: [], longestAction: 241, perConversation: 0, updateOthers: 'x' };
  const env = { POCKET_APPROVAL_PUSH_ANSWERS: 'true', POCKET_APPROVAL_PUSH_SHOW: 'waits', POCKET_APPROVAL_PUSH_ALLOW_FOR: '45', POCKET_APPROVAL_PUSH_CHECKBACKS: 'off', POCKET_APPROVAL_PUSH_JOBS: '1',
    POCKET_APPROVAL_PUSH_ENGINE_CLAUDE: 'no', POCKET_APPROVAL_PUSH_ENGINE_CODEX: 'false', POCKET_APPROVAL_PUSH_ENGINE_OPENROUTER: '0', POCKET_APPROVAL_PUSH_ENGINE_ANTIGRAVITY: 'off',
    POCKET_APPROVAL_PUSH_LONGEST_ACTION: '120', POCKET_APPROVAL_PUSH_PER_CONVERSATION: '7', POCKET_APPROVAL_PUSH_UPDATE_OTHERS: 'false' };
  const fromEnv = ap.values({}, env);
  assert.equal(Object.keys(env).length, ap.SETTINGS.length, 'one preset per setting');
  for (const s of ap.SETTINGS) {
    assert.ok(env[ap.envName(s)] !== undefined, ap.envName(s));
    assert.notEqual(fromEnv[s.key], s.default, s.key + ' takes its preset');
    const r = ap.applySave({}, { values: { [s.key]: good[s.key] } });
    assert.equal(r.error, undefined, s.key); assert.equal(r.saved[s.key], good[s.key]);
    assert.equal(ap.values(r.saved, env)[s.key], good[s.key], s.key + ': a saved value wins over the preset');
    const e = ap.applySave({ keep: 1 }, { values: { [s.key]: bad[s.key] } });
    assert.equal(e.status, 400, s.key + ' refuses ' + JSON.stringify(bad[s.key]));
    assert.deepEqual(ap.applySave(r.saved, { values: { [s.key]: null } }).saved, {}, s.key + ' forgets with null');
  }
  assert.deepEqual(ap.values({}, {}), Object.fromEntries(ap.SETTINGS.map(s => [s.key, s.default])));
  assert.equal(ap.values({}, {}).answers, false, 'off by default'); assert.equal(ap.values({}, {}).longestAction, 80); assert.equal(ap.values({}, {}).allowFor, 30);
  assert.deepEqual(ap.applySave({ answers: true, allowFor: 9 }, { reset: true }).saved, {});
  assert.equal(ap.applySave({}, { values: { nope: 1 } }).status, 400);
  assert.equal(ap.applySave({}, { group: 'automation', values: { answers: true } }).status, 400);
  assert.equal(ap.applySave({}, { values: {} }).status, 400);
  assert.equal(ap.applySave({}, { values: { allowFor: 10.5 } }).status, 400, 'whole minutes');
  // A bad preset is ignored with a warning; the limits have no Off
  const d = ap.describe({}, { POCKET_APPROVAL_PUSH_LONGEST_ACTION: '999' });
  assert.equal(d.groups[0].settings.find(s => s.key === 'longestAction').value, 80);
  assert.match(d.warnings.join(' '), /POCKET_APPROVAL_PUSH_LONGEST_ACTION is ignored/);
  const desc = ap.describe({ allowFor: 10 }, { POCKET_APPROVAL_PUSH_JOBS: 'true' }).groups[0];
  assert.equal(desc.key, 'approvalPush');
  const af = desc.settings.find(s => s.key === 'allowFor'), jb = desc.settings.find(s => s.key === 'jobs');
  assert.equal(af.saved, true); assert.equal(af.value, 10); assert.equal(af.offAllowed, false); assert.equal(af.min, 5); assert.equal(af.max, 240);
  assert.equal(jb.preset, true); assert.equal(jb.value, true); assert.equal(jb.env, 'POCKET_APPROVAL_PUSH_JOBS');
});

// ---------- 1.126 review fixes (F1-F6 and the survivors), each failing without its fix ----------
const ch = cp => String.fromCodePoint(cp);
const KEY = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
const ZW = ch(0x200B), SPLIT = KEY.slice(0, 12) + ZW + KEY.slice(12); // a key the raw scan sees in two halves
const noKey = p => { const all = JSON.stringify(p.payload ?? p); assert.ok(!all.includes(KEY) && !all.includes(KEY.slice(4, 20)), 'the key appears nowhere: ' + all.slice(0, 200)); };

test('F1 (rules): a folder cleaning would change, a relative one, an engine\'s literal ~/ and an empty one get no Allow; the same for an action with a double or trailing space', () => {
  const cmd = "/bin/bash -lc 'make deploy'";
  const good = push(codexRow('command', { command: cmd, cwd: HOME + '/work' }), turnOf('codex'));
  invariants(good); assert.equal(good.allow, true); assert.equal(good.lines[1], 'In: ~/work');
  for (const cwd of [HOME + '/work ', ' ' + HOME + '/work', HOME + '/work  x', 'work', '~/work', '']) {
    const p = push(codexRow('command', { command: cmd, cwd }), turnOf('codex')); invariants(p);
    assert.equal(p.allow, false, JSON.stringify(cwd)); assert.deepEqual(allowOf(p), ['deny'], JSON.stringify(cwd));
  }
  // The rule holds whoever names the folder: Claude's request cwd and an ACP turn's folder
  assert.equal(push(claudeRow('Bash', { command: 'ls' }, { details: JSON.stringify({ tool: 'Bash', cwd: CWD + ' ', input: { command: 'ls' } }) }), turnOf('claude')).allow, false);
  assert.equal(push(acpRow({ kind: 'execute', title: 'ls', rawInput: { command: 'ls' } }), turnOf('acp', { cwd: 'shop' })).allow, false);
  assert.equal(push(acpRow({ kind: 'execute', title: 'ls', rawInput: { command: 'ls' } }), turnOf('acp', { cwd: '' })).allow, false, 'an empty folder (X46)');
  // The action: shown exactly as given, so a double or trailing space (which a notification may not show) loses Allow
  for (const c of ['make  deploy', 'make deploy ', ' make deploy']) {
    for (const [row, tt] of [[claudeRow('Bash', { command: c }), turnOf('claude')], [codexRow('command', { command: `/bin/bash -lc '${c}'`, cwd: CWD }), turnOf('codex')],
      [acpRow({ kind: 'execute', title: 'x', rawInput: { command: c } }), turnOf('acp')]]) {
      const p = push(row, tt); invariants(p); assert.equal(p.allow, false, JSON.stringify(c) + ' ' + tt.engine);
    }
  }
  assert.equal(push(claudeRow('Bash', { command: 'make deploy' }), turnOf('claude')).allow, true);
});

test('F2 (rules and card): an ACP request with both command and CommandLine gets no Allow, each engine takes only its own key, and the card does not show one of them as the whole command', () => {
  const both = { kind: 'execute', title: 'ls', rawInput: { command: 'ls', CommandLine: 'rm -rf ~' } };
  for (const engine of ['acp', 'antigravity']) {
    const p = push(acpRow(both), turnOf(engine)); invariants(p);
    assert.equal(p.allow, false, engine); assert.equal(p.lines[0], 'Runs: (two commands given; open Pocket to review it)');
    assert.ok(!p.body.includes('rm -rf') && !p.body.includes('Runs: ls'), engine);
  }
  // The key belongs to the engine: OpenCode's is command, Antigravity's CommandLine
  assert.equal(push(acpRow({ kind: 'execute', title: 'x', rawInput: { CommandLine: 'ls' } }), turnOf('acp')).allow, false, 'OpenCode with CommandLine');
  assert.equal(push(acpRow({ kind: 'execute', title: 'x', rawInput: { command: 'ls' } }), turnOf('antigravity')).allow, false, 'Antigravity with command');
  assert.equal(push(acpRow({ kind: 'execute', title: 'x', rawInput: { command: 'ls', WaitMsBeforeAsync: 0 } }), turnOf('acp')).allow, false, 'an Antigravity field on an OpenCode request');
  assert.equal(push(acpRow({ kind: 'execute', title: 'x', rawInput: { CommandLine: 'ls' } }), turnOf('antigravity')).allow, true);
  assert.equal(push(acpRow({ kind: 'execute', title: 'x', rawInput: { command: 'ls' } }), turnOf('acp')).allow, true);
  // The in-app card: both keys shown under Show details, neither as the command
  const card = approvalCard({ toolCall: both });
  assert.equal(card.details.command, null);
  assert.deepEqual(card.details.commands, { command: 'ls', CommandLine: 'rm -rf ~' });
  assert.equal(approvalCard({ toolCall: { kind: 'execute', title: 't', rawInput: { CommandLine: 'git status' } } }).details.command, 'git status');
});

test('F3 (rules): a key split by a zero-width character is hidden on every line the push builds (action, folder, conversation, job, subagent, summary, replacement)', () => {
  assert.equal(ap.looksSecret(SPLIT), false, 'the raw scan alone misses it');
  const action = push(claudeRow('Bash', { command: 'echo ' + SPLIT }), turnOf('claude'));
  noKey(action); assert.equal(action.lines[0], 'Runs: (looks like it contains a password or key; open Pocket to review it)'); assert.equal(action.allow, false);
  const folder = push(codexRow('command', { command: 'ls', cwd: '/srv/' + SPLIT }), turnOf('codex'));
  noKey(folder); assert.equal(folder.allow, false); assert.match(folder.lines[1], /looks like it contains a password or key/);
  const convo = push(claudeRow('Bash', { command: 'ls' }), turnOf('claude', { title: 'deploy ' + SPLIT }));
  noKey(convo); assert.equal(convo.lines[2], 'Conversation: (hidden: it looks like it contains a password or key)');
  const job = push(claudeRow('Bash', { command: 'ls' }), turnOf('claude', { root: 'job', jobName: SPLIT }));
  noKey(job); assert.equal(job.lines[3], 'Started by job (hidden)');
  const sub = push(claudeRow('Bash', { command: 'ls' }, { agent: 'helper ' + SPLIT }), turnOf('claude'));
  noKey(sub); assert.equal(sub.lines[3], 'Subagent: (hidden)');
  const s = ap.summary('s-1', 2, 'deploy ' + SPLIT); noKey(s); assert.equal(s.body, '2 more actions wait');
  const r = ap.replacement('r1', 's-1', 'Allowed ' + SPLIT); noKey(r); assert.equal(r.body, 'No longer waiting');
  // A key that is whole as written (X19, X19b, X19c, X19e)
  const f2 = push(codexRow('command', { command: 'ls', cwd: '/srv/' + KEY }), turnOf('codex'));
  noKey(f2); assert.equal(f2.allow, false, 'a folder that looks like a key never gets Allow (X19)');
  const c2 = push(claudeRow('Bash', { command: 'ls' }), turnOf('claude', { title: KEY })); noKey(c2);
  const a2 = push(claudeRow('Bash', { command: 'ls' }, { agent: KEY }), turnOf('claude')); noKey(a2); assert.equal(a2.lines[3], 'Subagent: (hidden)');
});

// Unicode's default-ignorable code points that are not format characters (the combining grapheme joiner, two variation
// selectors and a supplementary one), and U+1D159, a symbol that draws nothing
const IGNORABLE = [0x034F, 0xFE0F, 0xFE00, 0xE0100], NOTEHEAD = 0x1D159;
test('Invisible characters (rules): a key split by a default-ignorable code point or U+1D159 is hidden on every line, and context lines drop them (U+1D159 shows as a space)', () => {
  for (const cp of [...IGNORABLE, NOTEHEAD]) {
    const c = ch(cp), split = KEY.slice(0, 12) + c + KEY.slice(12), why = 'U+' + cp.toString(16).toUpperCase();
    assert.equal(ap.looksSecret(split), false, why + ': the raw scan alone misses it');
    assert.equal(ap.hidden(split), true, why);
    const action = push(claudeRow('Bash', { command: 'echo ' + split }), turnOf('claude'));
    noKey(action); assert.equal(action.allow, false, why); assert.match(action.lines[0], /looks like it contains a password or key/, why);
    const folder = push(codexRow('command', { command: 'ls', cwd: '/srv/' + split }), turnOf('codex'));
    noKey(folder); assert.equal(folder.allow, false, why);
    const convo = push(claudeRow('Bash', { command: 'ls' }), turnOf('claude', { title: 'deploy ' + split }));
    noKey(convo); assert.equal(convo.lines[2], 'Conversation: (hidden: it looks like it contains a password or key)', why);
    const job = push(claudeRow('Bash', { command: 'ls' }), turnOf('claude', { root: 'job', jobName: split }));
    noKey(job); assert.equal(job.lines[3], 'Started by job (hidden)', why);
    const sub = push(claudeRow('Bash', { command: 'ls' }, { agent: 'helper ' + split }), turnOf('claude'));
    noKey(sub); assert.equal(sub.lines[3], 'Subagent: (hidden)', why);
    const s = ap.summary('s-1', 2, 'deploy ' + split); noKey(s); assert.equal(s.body, '2 more actions wait', why);
    const r = ap.replacement('r1', 's-1', 'Allowed ' + split); noKey(r); assert.equal(r.body, 'No longer waiting', why);
    // the context lines, the summary and the replacement keep none of them
    const gap = cp === NOTEHEAD ? ' ' : '';
    const p = push(claudeRow('Bash', { command: 'ls' }, { agent: 'help' + c + 'er' }), turnOf('claude', { title: 'Shop' + c + 'price' }));
    assert.equal(p.lines[2], 'Conversation: Shop' + gap + 'price', why); assert.equal(p.lines[3], 'Subagent: help' + gap + 'er', why);
    const j = push(claudeRow('Bash', { command: 'ls' }), turnOf('claude', { root: 'job', jobName: 'night' + c + 'ly' }));
    assert.equal(j.lines[3], 'Started by job night' + gap + 'ly', why);
    assert.equal(ap.summary('s-1', 1, 'Shop' + c + 'price').body, '1 more action waits in Shop' + gap + 'price', why);
    const rep = ap.replacement('r1', 's-1', 'Allowed in Pocket' + c + ' at 9:00');
    assert.ok(!JSON.stringify(rep).includes(c), why + ': the replacement'); assert.ok(!rep.body.includes(c), why);
    for (const line of [...p.lines, ...j.lines]) assert.ok(!line.includes(c), why + ': ' + line);
    // the action line: no Allow (the character is not printable ASCII); a default-ignorable one is not shown there either
    const a = push(claudeRow('Bash', { command: 'echo a' + c + 'b' }), turnOf('claude'));
    assert.equal(a.allow, false, why); if (cp !== NOTEHEAD) assert.ok(!a.body.includes(c), why);
  }
});

test('Tool names (rules): a key glued after _ or __ in a tool\'s name is hidden on its Uses line', () => {
  for (const tool of ['mcp__' + KEY, 'mcp_' + KEY, 'x_' + KEY, 'mcp__server__' + KEY, 'mcp__server___' + KEY + '__run']) {
    assert.equal(ap.looksSecret(tool), false, tool + ': the raw scan alone misses it');
    const p = push(claudeRow(tool, { q: 1 }), turnOf('claude'));
    noKey(p); assert.equal(p.allow, false, tool); assert.equal(p.lines[0], 'Uses: (looks like it contains a password or key; open Pocket to review it)', tool);
  }
  assert.equal(push(claudeRow('mcp__github__create_issue', { q: 1 }), turnOf('claude')).lines[0], 'Uses: mcp__github__create_issue', 'an ordinary name still shows');
});

test('ACP rawInput that is not an object (card and rules): a string, a number or true shows the card as before 1.126 (the title as the command) and gets no Allow', () => {
  for (const rawInput of ['ls -la', 7, true, false, 0, '']) {
    const toolCall = { kind: 'execute', title: 'echo hi', rawInput };
    const card = approvalCard({ toolCall });
    assert.deepEqual(card, { kind: 'command', details: { command: 'echo hi', tool: 'echo hi' } }, JSON.stringify(rawInput));
    const p = push(acpRow(toolCall), turnOf('acp')); invariants(p);
    assert.equal(p.allow, false, JSON.stringify(rawInput)); assert.deepEqual(allowOf(p), ['deny']);
  }
});

test('F4, B5, B8 (rules): context lines show blank-looking characters as one ordinary space, and a line break early in a title still makes one line', () => {
  const blanks = [0x2800, 0x3164, 0x115F, 0x1160, 0x2003, 0x00A0, 0x3000, 0xFFA0, 0x202F].map(ch);
  for (const b of blanks) {
    const title = 'Shop' + b + b + 'price' + b, agent = 'help' + b + 'er', jobName = 'night' + b + ' ly';
    const p = push(claudeRow('Bash', { command: 'ls' }, { agent }), turnOf('claude', { title }));
    assert.equal(p.lines[2], 'Conversation: Shop price', JSON.stringify(b)); assert.equal(p.lines[3], 'Subagent: help er', JSON.stringify(b));
    const j = push(claudeRow('Bash', { command: 'ls' }), turnOf('claude', { root: 'job', jobName }));
    assert.equal(j.lines[3], 'Started by job night ly', JSON.stringify(b));
    assert.equal(ap.summary('s-1', 1, title).body, '1 more action waits in Shop price', JSON.stringify(b));
    assert.equal(ap.contextLine(b + b), '');
  }
  assert.equal(push(claudeRow('Bash', { command: 'ls' }), turnOf('claude', { title: ch(0x2800) + ch(0x3164) })).lines[2], 'Conversation: Untitled conversation');
  // A line break inside the first 60 characters (B5: the conversation line; B8: the summary)
  const p = push(claudeRow('Bash', { command: 'ls' }), turnOf('claude', { title: 'Shop\nRuns: rm -rf ~' })); invariants(p);
  assert.equal(p.lines[2], 'Conversation: Shop Runs: rm -rf ~'); assert.equal(p.body.split('\n').length, 3);
  const s = ap.summary('s-1', 2, 'Shop\nRuns: rm -rf ~');
  assert.equal(s.body, '2 more actions wait in Shop Runs: rm -rf ~'); assert.ok(!s.body.includes('\n'));
});

test('F5, B20 (rules): settings are looked up as own keys, a number setting takes only a number, and a saved bad value falls back', () => {
  for (const k of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    const body = JSON.parse(`{"values":{"${k}":true}}`);
    const r = ap.applySave({}, body); assert.equal(r.status, 400, k); assert.match(r.error, /Unknown setting/, k);
  }
  assert.equal(ap.applySave({}, { values: { allowFor: '10' } }).status, 400, 'a number as text');
  assert.equal(ap.applySave({}, { values: { longestAction: '120' } }).status, 400);
  assert.equal(ap.applySave({}, { values: { allowFor: 10 } }).saved.allowFor, 10);
  // A saved value of the wrong type or out of range is not used (B20)
  assert.equal(ap.values({ allowFor: '10' }, {}).allowFor, 30);
  assert.equal(ap.values({ allowFor: 1000 }, {}).allowFor, 30);
  assert.equal(ap.values({ answers: 'yes' }, {}).answers, false);
  assert.equal(ap.values({ longestAction: 39 }, { POCKET_APPROVAL_PUSH_LONGEST_ACTION: '120' }).longestAction, 120, 'a bad saved value falls back to the preset');
  assert.equal(ap.values(Object.create({ answers: true }), {}).answers, false, 'an inherited key is not a saved value');
  const d = ap.describe({ allowFor: '10' }, {}).groups[0].settings.find(s => s.key === 'allowFor');
  assert.equal(d.saved, false); assert.equal(d.value, 30);
});

test('F6 (rules): the job rule follows a handoff (continuedFrom) as well as a branch, bounded and without a loop', () => {
  const meta = { job: {}, hand: { continuedFrom: 'job' }, branchOfHand: { branchOf: 'hand' }, handOfBranch: { continuedFrom: 'br' }, br: { branchOf: 'job' },
    l1: { continuedFrom: 'l2' }, l2: { branchOf: 'l1' }, self: { continuedFrom: 'self', branchOf: 'self' }, mixed: { branchOf: 'plain', continuedFrom: 'job' }, plain: {} };
  const opts = { metaOf: id => meta[id], ranIn: id => id === 'job' };
  for (const id of ['hand', 'branchOfHand', 'handOfBranch', 'mixed']) assert.equal(ap.jobConversation(id, opts), true, id);
  for (const id of ['l1', 'l2', 'self', 'plain', 'nope']) assert.equal(ap.jobConversation(id, opts), false, id);
  // A chain longer than 100 conversations stops; a job just inside it is found
  const long = {}; for (let i = 0; i < 150; i++) long['c' + i] = { continuedFrom: 'c' + (i + 1) };
  let asked = 0;
  assert.equal(ap.jobConversation('c0', { metaOf: id => long[id], ranIn: id => { asked++; return id === 'c140'; } }), false, 'bounded');
  assert.ok(asked <= 100, 'at most 100 conversations are read');
  assert.equal(ap.jobConversation('c0', { metaOf: id => long[id], ranIn: id => id === 'c50' }), true);
  assert.equal(ap.jobConversation('c0', { metaOf: id => meta[id] ?? long[id], ranIn: id => id === 'c9' }), true);
});

test('X14 (rules): the test window only shortens Allow works for', () => {
  const cfg = cfgOf({ allowFor: 30 });
  assert.equal(ap.allowWindowMs(cfg), 30 * 60_000);
  assert.equal(ap.allowWindowMs(cfg, 500), 500);
  assert.equal(ap.allowWindowMs(cfg, 31 * 60_000), 30 * 60_000, 'never lengthens');
  assert.equal(ap.allowWindowMs(cfg, 10 * 24 * 3_600_000), 30 * 60_000);
  for (const bad of [0, -5, NaN, Infinity]) assert.equal(ap.allowWindowMs(cfg, bad), 30 * 60_000, String(bad));
});

test('X22, X23 (rules): codexScript unwraps only the single-quoted bash -lc and sh -c forms; WebFetch with an extra field loses Allow', () => {
  for (const c of [`/bin/bash -lc "ls"`, `/bin/sh -lc 'ls'`, `/bin/bash -c 'ls'`, `/bin/bash -lc 'ls' x`, `bash -lc 'ls'`, `/bin/zsh -lc 'ls'`]) assert.equal(ap.codexScript(c), c, c);
  assert.equal(ap.codexScript(`/bin/sh -c 'ls -la'`), 'ls -la'); assert.equal(ap.codexScript(`/bin/bash -lc 'ls -la'`), 'ls -la');
  const dq = push(codexRow('command', { command: `/bin/bash -lc "ls"`, cwd: CWD }), turnOf('codex'));
  assert.equal(dq.lines[0], 'Runs: /bin/bash -lc "ls"');
  const t = turnOf('claude');
  assert.equal(push(claudeRow('WebFetch', { url: 'https://example.com/a', prompt: 'x' }), t).allow, true);
  const p = push(claudeRow('WebFetch', { url: 'https://example.com/a', prompt: 'x', headers: { Authorization: 'x' } }), t); invariants(p);
  assert.equal(p.allow, false); assert.equal(p.why.split(',')[0], 'fields');
});

test('X17, B2: the inbox list never carries facts, push or gone', async () => {
  const { ApprovalInbox } = await import('../approvals.mjs');
  const inbox = new ApprovalInbox({ sessionId: () => 's', turnId: () => 't', write: async () => {} });
  assert.equal(inbox.receive({ nativeId: 1, turnId: 't', kind: 'command', title: 'x', details: { command: 'ls' }, allow: {}, deny: {}, facts: { callKind: 'execute' } }), true);
  const row = inbox.rows()[0]; row.push = { devices: { a: { shown: 'h' } } }; row.gone = { why: 'ended' };
  const [listed] = inbox.list();
  for (const k of ['facts', 'push', 'gone', 'nativeId', 'allow', 'deny', 'fingerprint']) assert.equal(k in listed, false, k);
  assert.equal(listed.id, row.id);
});

test('F8 (inbox): an answer from away from the app refused inside decide() is recorded as refused, without the command; an app answer is refused as before; a failed record is not retried', async () => {
  const { ApprovalInbox } = await import('../approvals.mjs');
  const audits = [];
  let failAudit = false, release;
  const inbox = new ApprovalInbox({ sessionId: () => 's', turnId: () => 't', audit: r => { if (failAudit) { audits.push({ failed: r.event }); throw new Error('disk full'); } audits.push(r); },
    write: () => new Promise(r => { release = r; }) });
  const away = { source: 'notification', device: 'dev1', pushService: 'push.example', action: 'command' };
  const add = cmd => { inbox.receive({ nativeId: cmd, turnId: 't', kind: 'command', title: 'Run?', details: { command: cmd }, allow: { a: 1 }, deny: { d: 1 } }); return inbox.rows().at(-1).id; };
  const refusals = () => audits.filter(a => a.event === 'refused');
  const code = async p => { try { await p; return 'ok'; } catch (e) { return [e.status, e.code ?? null]; } };
  // not waiting (no such row, or the reply ended): gone
  assert.deepEqual(await code(inbox.decide('11111111-1111-4111-8111-111111111111', 'deny', away)), [409, 'gone']);
  // sending (status not pending): gone
  const one = add('echo secret-one');
  const sending = inbox.decide(one, 'allow', {});
  assert.deepEqual(await code(inbox.decide(one, 'deny', away)), [409, 'gone']);
  release(); await sending;
  // answered in the app, then differently from a notification: answered_in_app; from a notification, then differently: answered
  assert.deepEqual(await code(inbox.decide(one, 'deny', away)), [409, 'answered_in_app']);
  const two = add('echo secret-two');
  const p2 = inbox.decide(two, 'deny', away); release(); await p2;
  assert.deepEqual(await code(inbox.decide(two, 'allow', away)), [409, 'answered']);
  assert.deepEqual(refusals().map(r => r.reason), ['gone', 'gone', 'answered_in_app', 'answered']);
  for (const r of refusals()) { assert.equal(r.source, 'notification'); assert.equal(r.device, 'dev1'); assert.equal(r.action, 'command'); }
  assert.ok(!JSON.stringify(audits).includes('secret-'), 'never the command');
  // the app is refused as before: no record, no code
  const n = audits.length;
  assert.deepEqual(await code(inbox.decide(one, 'allow', {})), 'ok', 'same answer again: a duplicate');
  assert.deepEqual(await code(inbox.decide(one, 'deny', {})), [409, null]);
  assert.equal(audits.length, n);
  // a record that cannot be written: one try, no loop, and the answer is still refused
  failAudit = true;
  assert.deepEqual(await code(inbox.decide('22222222-2222-4222-8222-222222222222', 'allow', away)), [409, 'gone']);
  assert.deepEqual(audits.slice(n), [{ failed: 'refused' }], 'tried once');
  const three = (failAudit = false, add('echo three')), m = audits.length;
  failAudit = true;
  assert.deepEqual(await code(inbox.decide(three, 'allow', away)), [503, null], 'a decision that could not be recorded');
  assert.deepEqual(audits.slice(m), [{ failed: 'decision' }], 'not recorded as refused as well');
});
