// Answering an action approval from its notification (docs/plans/notification-approvals.md, Parts 1, 2, 4, 5 and 7).
// Kept apart from server.mjs so the rules can be tested without a server (test/approval-push.test.mjs): which request
// gets Allow, the words of every notification, the hash that ties an answer to them, the device test and the settings.
//
// The rule: Allow only when the whole effect of the request is one short line of printable ASCII the server can state
// exactly, on a device the owner tested at a limit at least today's. Every word in the notification is Pocket's; the
// agent's own description of what it is doing never appears. Don't allow is offered on every action approval.
import { createHash, randomInt } from 'node:crypto';
import { checkValue, rangeText } from './automation.mjs';
import { pushShape, hasUnusual, PUSH_TITLE_MAX } from './push-text.mjs';
import './public/secret-detect.js'; // defines globalThis.PocketSecrets, the detector the message route runs

// ---------- settings (install-wide; the device rows live with each push subscription) ----------
// Same shape as automation.mjs's groups, so the app can reuse its settings page code. A saved value wins over the
// preset POCKET_APPROVAL_PUSH_<KEY>, which wins over the default. The limits have no Off.
export const GROUP_KEY = 'approvalPush';
export const GROUP_TITLE = 'Answers from notifications';
const engineRow = (key, label) => ({ key, label, type: 'bool', default: true, advanced: true, section: 'Engines',
  help: `Allow on notifications for ${label} replies. Off: its notifications offer Don't allow only.` });
export const SETTINGS = [
  { key: 'answers', label: 'Answer approvals from notifications', type: 'bool', default: false,
    help: 'Off: approval notifications are as before, with no buttons, and an answer from a notification is refused.' },
  { key: 'show', label: 'What approval notifications show', type: 'choice', default: 'action',
    choices: [{ value: 'action', label: 'The action' }, { value: 'waits', label: 'Only that an action waits' }],
    help: '"Only that an action waits" shows no conversation and no action, and offers Don\'t allow only.' },
  { key: 'allowFor', label: 'Allow works for', type: 'number', default: 30, min: 5, max: 240, step: 1, unit: 'min', integer: true,
    help: 'An Allow from a notification older than this many minutes is refused; review the request in Pocket instead.' },
  { key: 'checkbacks', label: 'Allow on a check-back\'s actions', type: 'bool', default: true,
    help: 'Off: a check-back\'s notifications offer Don\'t allow only.' },
  { key: 'jobs', label: 'Allow on a job\'s actions', type: 'bool', default: false,
    help: 'Covers every reply in a conversation a job has run in, yours included. Off: they offer Don\'t allow only.' },
  engineRow('engineClaude', 'Claude Code'),
  engineRow('engineCodex', 'Codex'),
  engineRow('engineOpenrouter', 'OpenRouter'),
  engineRow('engineAntigravity', 'Antigravity'),
  { key: 'longestAction', label: 'Longest action with an Allow button', type: 'number', default: 80, min: 40, max: 240, step: 1, unit: 'characters', integer: true, advanced: true,
    help: 'The action line and the folder line together. Raising it turns the Allow button off on every device until each is tested again.' },
  { key: 'perConversation', label: 'Notifications with buttons per conversation', type: 'number', default: 3, min: 1, max: 10, step: 1, unit: '', integer: true, advanced: true,
    help: 'More requests than this wait behind one summary notification.' },
  { key: 'updateOthers', label: 'Update other devices after an answer', type: 'bool', default: true, advanced: true,
    help: 'Replaces the notification on your other devices once the request is answered or withdrawn.' },
];
const BY_KEY = new Map(SETTINGS.map(s => [s.key, s])); // a Map: "constructor" or "__proto__" is no setting
// A value as saved or sent: a number setting takes a number only (the app sends Number(raw)); the env preset, which is
// text, goes through checkValue alone.
const checkSaved = (s, v) => s.type === 'number' && typeof v !== 'number' ? { error: `${s.label} must be a number.` } : checkValue(s, v);
const savedOf = (saved, s) => saved && typeof saved === 'object' && Object.hasOwn(saved, s.key) ? saved[s.key] : undefined;
const camelToEnv = k => k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
export const envName = s => 'POCKET_APPROVAL_PUSH_' + camelToEnv(s.key);
function presetOf(s, env, warnings) {
  const name = envName(s), raw = env?.[name];
  if (raw == null || raw === '') return null;
  let v = String(raw).trim();
  if (s.type === 'bool') v = /^(1|true|yes|on)$/i.test(v) ? true : /^(0|false|no|off)$/i.test(v) ? false : v;
  const r = checkValue(s, v);
  if (r.error) { warnings?.push(`${name} is ignored: ${r.error}`); return null; }
  return { value: r.value, name };
}
// The effective value of every setting: saved, else the env preset, else the default.
export function values(saved, env = process.env) {
  const out = {};
  for (const s of SETTINGS) {
    const sv = savedOf(saved, s);
    if (sv !== undefined && !checkSaved(s, sv).error) { out[s.key] = sv; continue; } // a bad saved value falls back
    const p = presetOf(s, env);
    out[s.key] = p ? p.value : s.default;
  }
  return out;
}
// A save, all or nothing: { values: { key: value | null } } (null forgets the saved value) or { reset: true }. `group`, when
// sent, must be this group's key. Returns { saved } (a new object) or { error, status }.
export function applySave(saved, body) {
  if (body?.group !== undefined && body.group !== GROUP_KEY) return { error: `Unknown settings group. Use ${GROUP_KEY}.`, status: 400 };
  if (body?.reset === true) return { saved: {} };
  const vals = body?.values;
  if (!vals || typeof vals !== 'object' || Array.isArray(vals) || !Object.keys(vals).length) return { error: 'Send values to save, or reset: true.', status: 400 };
  const next = { ...(saved && typeof saved === 'object' ? saved : {}) };
  for (const [k, v] of Object.entries(vals)) {
    const s = BY_KEY.get(k);
    if (!s) return { error: `Unknown setting "${k}" in ${GROUP_TITLE}.`, status: 400 };
    if (v === null) { delete next[k]; continue; }
    const r = checkSaved(s, v);
    if (r.error) return { error: r.error, status: 400 };
    next[k] = r.value;
  }
  return { saved: next };
}
// What the settings page shows: each setting with its value and where it came from, in automation.mjs's describe() shape.
export function describe(saved, env = process.env) {
  const warnings = [];
  const settings = SETTINGS.map(s => {
    const sv = savedOf(saved, s), isSaved = sv !== undefined && !checkSaved(s, sv).error, p = presetOf(s, env, warnings);
    const out = { key: s.key, label: s.label, type: s.type, value: isSaved ? sv : p ? p.value : s.default, default: s.default, saved: isSaved, preset: Boolean(p), env: envName(s), range: rangeText(s) };
    if (s.help) out.help = s.help;
    if (s.type === 'number') Object.assign(out, { min: s.min, max: s.max, step: s.step, unit: s.unit, offAllowed: false });
    if (s.type === 'choice') out.choices = s.choices.map(c => ({ ...c }));
    if (s.advanced) out.advanced = true;
    if (s.section) out.section = s.section;
    return out;
  });
  return { groups: [{ key: GROUP_KEY, title: GROUP_TITLE, settings }], warnings: [...new Set(warnings)] };
}
export const ENGINE_SETTING = { claude: 'engineClaude', codex: 'engineCodex', acp: 'engineOpenrouter', antigravity: 'engineAntigravity' };
// How long an Allow from a notification works, in ms. `testMs` (POCKET_TEST_APPROVAL_WINDOW_MS, tests only) can only
// shorten it: a value above the setting, zero, negative or not a number leaves the setting as it is.
export const allowWindowMs = (cfg, testMs = 0) => { const ms = cfg.allowFor * 60_000; return Number.isFinite(testMs) && testMs > 0 && testMs < ms ? testMs : ms; };

// ---------- text ----------
// Invisible characters, dropped: every format character (\p{Cf}: zero-width, direction-changing) and every
// default-ignorable code point (\p{Default_Ignorable_Code_Point}: variation selectors, the combining grapheme joiner,
// the Hangul and Khmer fillers, the tag characters and the rest Unicode marks so). Unicode's own classes, not a list.
const FORMAT = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
const BREAKS = /[\p{Cc}\u2028\u2029]+/gu; // line breaks, tabs and other control characters: one space
export const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
const chars = s => Array.from(s);
// One line: no line break, tab, control or invisible character (FORMAT), spaces collapsed.
export const oneLine = v => String(v ?? '').replace(FORMAT, '').replace(BREAKS, ' ').replace(/ {2,}/g, ' ').trim();
// A context line's text, cut to n characters with … (the … counts).
export const cut = (s, n) => { const c = chars(s); return c.length <= n ? s : c.slice(0, n - 1).join('') + '…'; };
// Characters that show as blank space or nothing but are not an ordinary space: every space separator (no-break, em,
// ideographic and the rest), the braille blank, the Hangul and Khmer fillers and the musical null notehead (U+1D159, a
// symbol to Unicode that draws nothing). A context line shows each run as one space. A list: Unicode has no class for it.
const BLANKS = /[\p{Zs}\u2800\u3164\u115F\u1160\uFFA0\u17B4\u17B5\u{1D159}]+/gu;
const BLANK_ONE = /[\p{Zs}\u2800\u3164\u115F\u1160\uFFA0\u17B4\u17B5\u{1D159}]/gu;
// A context line (conversation, subagent, job name, summary): one line, every blank-looking run one ordinary space.
export const contextLine = v => oneLine(String(v ?? '').replace(BLANKS, ' '));
export const looksSecret = s => { try { return Boolean(globalThis.PocketSecrets?.scan(String(s ?? ''), { mode: 'message' }).length); } catch { return true; } };
// Hide a text if it looks like a key as written or as cleaned for the notification: cleaning drops an invisible character
// and so can join the two halves of a key the raw scan saw apart. Also scanned with every blank-looking character other
// than an ordinary space removed (a key split by one would otherwise show as two harmless halves).
export const hidden = v => {
  const s = String(v ?? '');
  return looksSecret(s) || looksSecret(oneLine(s)) || looksSecret(contextLine(s)) || looksSecret(oneLine(s.replace(BLANK_ONE, c => c === ' ' ? ' ' : '')));
};
// A tool's name (mcp__server__tool): the scanner does not see a key glued after `_`, so each part after a `__` and the
// rest of the name after every run of `_` are scanned too.
export const hiddenName = v => {
  const s = oneLine(v);
  return hidden(v) || s.split(/__+/).some(looksSecret) || [...s.matchAll(/_+/g)].some(m => looksSecret(s.slice(m.index + m[0].length)));
};
export const tilde = (p, home) => typeof p === 'string' && home && (p === home || p.startsWith(home.endsWith('/') ? home : home + '/')) ? '~' + p.slice(home.replace(/\/$/, '').length) : p;
const hasDotDot = p => String(p).split(/[\\/]/).some(x => x === '..');
const SECRET_NOTE = '(looks like it contains a password or key; open Pocket to review it)';
const tooLong = n => `(${n} characters, too long to show here; open Pocket to review it)`;

// ---------- what a request does, per engine (Part 1) ----------
const CLAUDE_FIELDS = {
  Bash: ['command', 'description', 'timeout', 'run_in_background'],
  PowerShell: ['command', 'description', 'timeout', 'run_in_background'],
  WebFetch: ['url', 'prompt'],
  WebSearch: ['query', 'allowed_domains', 'blocked_domains'],
};
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
// Each ACP engine's own command key and the rawInput keys its command request may carry. OpenCode's bash permission
// sends rawInput { command } (its ShellTool.ask metadata, checked in opencode 1.19.4); Antigravity's run_command sends
// CommandLine with its own fields. A request with the other engine's key, or with both, gets no Allow: which one runs
// is the agent's business, not something the notification can state.
const ACP_KEYS = {
  acp: { key: 'command', other: 'CommandLine', fields: new Set(['command', 'cwd']) },
  antigravity: { key: 'CommandLine', other: 'command', fields: new Set(['CommandLine', 'cwd', 'WaitMsBeforeAsync', 'toolSummary']) },
};
const ACP_KIND_NAMES = { read: 'Read', search: 'Search', fetch: 'Web', think: 'Thinking' };
const TITLES = { command: 'Allow this command?', page: 'Allow this web page?', search: 'Allow this web search?', edit: 'Allow this edit?', action: 'Allow this action?' };
const onlyFields = (o, list) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every(k => list.includes(k));
const empty = v => v == null || (Array.isArray(v) ? !v.length : typeof v === 'object' ? !Object.keys(v).length : v === '' || v === false);
const parse = s => { try { return JSON.parse(s); } catch { return null; } };
// A Codex command as it runs. Only the exact single-quoted form is unwrapped: between single quotes the shell takes every
// character as written, so the script is exactly what runs. Pocket's trusted-rule matcher reads a wider form; not here.
export function codexScript(cmd) {
  const m = /^(?:\/bin\/bash -lc|\/bin\/sh -c) '([^']*)'$/.exec(cmd);
  return m ? m[1] : cmd;
}
// The action of one inbox row: { what (TITLES key), label, text (raw, or null for a fixed line), fixed (a whole line of
// Pocket's words), folder (raw), folderLabel, allowable, why }. `allowable` is the engine and request rule of Part 1 only.
export function actionOf(row, t) {
  const d = parse(row.details) || {}, engine = t.engine;
  if (engine === 'claude') {
    const tool = String(d.tool ?? ''), input = d.input, base = { folder: d.cwd ?? t.cwd, folderLabel: 'Conversation folder' };
    const fields = CLAUDE_FIELDS[tool];
    if (tool === 'Bash' || tool === 'PowerShell') {
      const ok = onlyFields(input, fields) && typeof input.command === 'string';
      return { ...base, what: 'command', label: 'Runs', text: typeof input?.command === 'string' ? input.command : null, allowable: ok, why: ok ? null : 'fields' };
    }
    if (tool === 'WebFetch') {
      const ok = onlyFields(input, fields) && typeof input.url === 'string';
      return { ...base, what: 'page', label: 'Opens', text: typeof input?.url === 'string' ? input.url : null, allowable: ok, why: ok ? null : 'fields' };
    }
    if (tool === 'WebSearch') {
      const domains = input && typeof input === 'object' && (input.allowed_domains != null || input.blocked_domains != null);
      const ok = onlyFields(input, fields) && typeof input.query === 'string' && !domains;
      return { ...base, what: 'search', label: 'Searches', text: typeof input?.query === 'string' ? input.query : null, allowable: ok, why: ok ? null : domains ? 'domains' : 'fields' };
    }
    if (EDIT_TOOLS.has(tool)) { const f = input?.file_path ?? input?.notebook_path; return { ...base, what: 'edit', label: 'Edits', text: typeof f === 'string' ? f : null, allowable: false, why: 'edit' }; }
    if (tool === 'Agent' || tool === 'Task') return { ...base, what: 'action', fixed: 'Starts a helper', allowable: false, why: 'helper' };
    return { ...base, what: 'action', label: 'Uses', text: tool || 'a tool', name: true, allowable: false, why: 'tool' };
  }
  if (engine === 'codex') {
    const base = { folder: d.cwd ?? t.cwd, folderLabel: d.cwd == null ? 'Conversation folder' : 'In' };
    if (row.kind === 'command') {
      const extra = !empty(d.additionalPermissions);
      if (typeof d.command !== 'string') return { ...base, what: 'command', fixed: 'Runs: (a list of arguments; open Pocket to review it)', allowable: false, why: 'list' };
      const ok = !extra && d.cwd != null;
      return { ...base, what: 'command', label: 'Runs', text: codexScript(d.command), allowable: ok, why: ok ? null : extra ? 'permissions' : 'folder' };
    }
    if (row.kind === 'network') { const host = d.network && typeof d.network.host === 'string' ? d.network.host : 'an address'; return { ...base, what: 'action', label: 'Network access', text: host, allowable: false, why: 'network' }; }
    if (row.kind === 'fileChange') return { ...base, ...editLine(d.changes), allowable: false, why: 'edit' };
    return { ...base, what: 'action', fixed: 'Uses: more access for this reply', allowable: false, why: 'permissions' };
  }
  // OpenRouter (OpenCode) and Antigravity, through ACP. `row.facts` is what acp.mjs saw in the request (approvalFacts).
  // The folder line says "In:" only when the request named its folder (and it is the conversation's); OpenCode's names
  // none, and its command may run in a folder of its own (its workdir), so the line says what Pocket knows.
  const f = row.facts || {}, base = { folder: t.cwd, folderLabel: f.rawCwd === undefined ? 'Conversation folder' : 'In' };
  if (row.kind === 'fileChange') return { ...base, ...editLine(d.changes), allowable: false, why: 'edit' };
  if (f.callKind !== 'execute') return { ...base, what: 'action', label: 'Uses', text: ACP_KIND_NAMES[f.callKind] || 'a tool', allowable: false, why: 'kind' };
  const keys = Array.isArray(f.rawKeys) ? f.rawKeys : [];
  if (keys.includes('command') && keys.includes('CommandLine')) return { ...base, what: 'command', fixed: 'Runs: (two commands given; open Pocket to review it)', allowable: false, why: 'fields' };
  if (f.from !== 'command' && f.from !== 'CommandLine') return { ...base, what: 'command', fixed: 'Runs: (no command given; open Pocket to review it)', allowable: false, why: 'title' };
  const own = ACP_KEYS[engine];
  const keysOk = Boolean(own) && f.from === own.key && keys.length > 0 && keys.every(k => own.fields.has(k));
  const cwdOk = f.rawCwd === undefined || f.rawCwd === t.cwd;
  const ok = keysOk && cwdOk && f.allowOnce === true && typeof d.command === 'string';
  return { ...base, what: 'command', label: 'Runs', text: typeof d.command === 'string' ? d.command : null, allowable: ok, why: ok ? null : !f.allowOnce ? 'no_allow_once' : !keysOk ? 'fields' : 'folder' };
}
function editLine(changes) {
  const paths = Array.isArray(changes) ? changes.map(c => c?.path).filter(p => typeof p === 'string') : [];
  return { what: 'edit', label: 'Edits', text: paths.length > 1 ? `${paths[0]} and ${paths.length - 1} more` : paths[0] ?? null };
}

// ---------- the origin rule (Part 5) ----------
// A conversation a job has run in, or one that came from such a conversation: a branch (branchOf) holds its messages and a
// handoff (continuedFrom) carries its work on. Both links are followed, at most 100 conversations, each once (no loop).
export function jobConversation(id, { metaOf, ranIn }) {
  const seen = new Set(), next = [id];
  while (next.length && seen.size < 100) {
    const x = next.shift();
    if (typeof x !== 'string' || !x || seen.has(x)) continue;
    seen.add(x);
    if (ranIn(x)) return true;
    const m = metaOf(x);
    if (m && typeof m === 'object') next.push(m.branchOf, m.continuedFrom);
  }
  return false;
}
// May this reply's origin have Allow? `t.root` is the turn's root origin, `t.jobConversation` the rule above.
export function originAllows(t, cfg) {
  if (t.root === 'job' || t.jobConversation) return cfg.jobs === true; // the job rule wins over the check-back rule
  if (t.root === 'checkback') return cfg.checkbacks === true;
  return true;
}

// ---------- devices (Part 4) ----------
export const deviceId = endpoint => createHash('sha256').update(String(endpoint ?? '')).digest('hex').slice(0, 12);
export const pushServiceOf = endpoint => { try { return new URL(endpoint).host || 'unknown'; } catch { return 'unknown'; } };
export function serviceLabel(host) {
  if (/(^|\.)fcm\.googleapis\.com$|(^|\.)android\.googleapis\.com$/.test(host)) return 'Chrome or Android';
  if (/(^|\.)push\.apple\.com$/.test(host)) return 'Apple';
  if (/(^|\.)push\.services\.mozilla\.com$/.test(host)) return 'Firefox';
  if (/(^|\.)notify\.windows\.com$/.test(host)) return 'Windows';
  return host || 'unknown';
}
export const ALLOW_FIELD = 'approvalAllow'; // { limit, at } in push-subs.json, set only by the device test
export const wantsApprovals = s => s?.kinds?.approvals !== false;
export const deviceAllows = (s, cfg) => Boolean(s && wantsApprovals(s) && s[ALLOW_FIELD] && Number.isInteger(s[ALLOW_FIELD].limit) && s[ALLOW_FIELD].limit >= cfg.longestAction);
// What a device's status says (the Notifications page): tested at a lower limit than today's reads as off.
export function deviceStatus(s, cfg) {
  const a = s?.[ALLOW_FIELD];
  return { subscribed: Boolean(s), approvals: Boolean(s) && wantsApprovals(s), allowButton: deviceAllows(s, cfg), testedLimit: a && Number.isInteger(a.limit) ? a.limit : null,
    testedAt: a?.at || null, currentLimit: cfg.longestAction, retest: Boolean(a && Number.isInteger(a.limit) && a.limit < cfg.longestAction) };
}

// ---------- the notification (Part 2) ----------
// `row`: the inbox's own row (details as JSON text, kind, canAllow, agent, facts). `t`: { sessionId, engine, cwd, home,
// root, jobConversation, jobName, title }. `device`: the push subscription it is for, or null. `cfg`: values() above.
// Returns { title, lines, body, allow, shown, why, payload } where payload is exactly what the device is sent.
export function approvalPush(row, t, device, cfg) {
  const url = `/#/chat/${t.sessionId}?approval=${encodeURIComponent(row.id)}`;
  const deny = { action: 'deny', title: "Don't allow" }, allowBtn = { action: 'allow', title: 'Allow' };
  if (cfg.show === 'waits') {
    const title = 'Pocket Code', lines = ['An action waits for your OK.'];
    const shown = shownHash(row, lines[0], '');
    return finish({ title, lines, allow: false, why: 'waits', shown, url, row, t, actions: [deny] });
  }
  const a = actionOf(row, t);
  const why = [];
  if (!a.allowable) why.push(a.why || 'request');
  if (row.canAllow === false) why.push('can_allow');
  // The folder: Allow only for an absolute path, as the engine gave it, that cleaning leaves unchanged (no leading,
  // trailing or double space). "~/" comes only from Pocket's own swap of the home folder; an engine's literal "~/work",
  // "work" or "" is not a folder the notification can state.
  const folderRaw = typeof a.folder === 'string' ? a.folder : '';
  const folderShown = tilde(folderRaw, t.home);
  const folderSecret = hidden(folderRaw) || hidden(folderShown);
  const folderLine = `${a.folderLabel}: ${folderSecret ? SECRET_NOTE : cut(oneLine(folderShown), 240)}`;
  if (!folderRaw) why.push('folder');
  else if (!folderRaw.startsWith('/')) why.push('relative');
  if (folderSecret) why.push('secret');
  if (!PRINTABLE_ASCII.test(folderShown)) why.push('characters');
  else if (oneLine(folderShown) !== folderShown) why.push('spacing');
  if (hasDotDot(folderRaw)) why.push('dotdot');
  let actionLine;
  if (a.fixed) actionLine = a.fixed;
  else if (a.text == null || a.text === '') { actionLine = `${a.label}: (not given; open Pocket to review it)`; why.push('no_text'); }
  else if (a.name ? hiddenName(a.text) : hidden(a.text)) { actionLine = `${a.label}: ${SECRET_NOTE}`; why.push('secret'); }
  else {
    const whole = `${a.label}: ${a.text}`;
    if (chars(whole).length + chars(folderLine).length > cfg.longestAction) { actionLine = `${a.label}: ${tooLong(chars(a.text).length)}`; why.push('length'); }
    else {
      // The same rule as the folder: the action shows exactly as given, so a text cleaning would change (a leading,
      // trailing or double space, which a notification may not show) gets no Allow
      if (!PRINTABLE_ASCII.test(a.text)) why.push('characters');
      else if (oneLine(a.text) !== a.text) why.push('spacing');
      actionLine = PRINTABLE_ASCII.test(a.text) ? whole : `${a.label}: ${oneLine(a.text)}`;
    }
  }
  if (!cfg.answers) why.push('off');
  if (cfg[ENGINE_SETTING[t.engine]] !== true) why.push('engine');
  if (!originAllows(t, cfg)) why.push('origin');
  if (!deviceAllows(device, cfg)) why.push('device');
  const prefix = t.root === 'job' ? 'Job: ' : t.root === 'checkback' ? 'Check-back: ' : '';
  const title = prefix + TITLES[a.what];
  const lines = [actionLine, folderLine];
  // Context lines: one line each, blank-looking characters shown as one space, hidden when the text looks like a key as
  // written or as cleaned, then cut
  const convo = contextLine(t.title) || 'Untitled conversation';
  lines.push('Conversation: ' + (hidden(t.title) ? '(hidden: it looks like it contains a password or key)' : cut(convo, 60)));
  const job = contextLine(t.jobName);
  const origin = t.root === 'job' ? contextLine(`Started by job ${hidden(t.jobName) ? '(hidden)' : job}`) : t.jobConversation ? 'A job has run in this conversation' : t.root === 'checkback' ? 'Started by a check-back' : null;
  if (origin) lines.push(cut(origin, 64));
  if (typeof row.agent === 'string' && row.agent) { const n = contextLine(row.agent); lines.push('Subagent: ' + (hidden(row.agent) ? '(hidden)' : cut(n, 40))); }
  const shown = shownHash(row, actionLine, folderLine);
  const allow = !why.length;
  return finish({ title, lines, allow, why: why.join(',') || null, shown, url, row, t, actions: allow ? [deny, allowBtn] : [deny] });
}
// The SHA-256 of the request id, the kind, the action line and the folder line as built for this device (Part 3). The
// conversation title is left out: titles change while a request waits.
export const shownHash = (row, actionLine, folderLine) => createHash('sha256').update(JSON.stringify([row.id, row.kind, actionLine, folderLine])).digest('hex');
function finish({ title, lines, allow, why, shown, url, row, t, actions }) {
  const body = lines.join('\n');
  const fields = { tag: 'approval:' + row.id, url, approval: { session: t.sessionId, request: row.id, shown }, actions };
  // The whole payload must go out uncut: pushShape (what pushRaw sends) cuts the title and body to fit and drops Allow from
  // anything it cut. It also reads the line breaks between the labelled lines as unusual characters; here each line is
  // checked on its own instead (every line has been made one line already, so this is a safety net).
  const { base, why: shapeWhy } = pushShape(title, body, fields);
  const odd = shapeWhy === 'characters' && (hasUnusual(title) || lines.some(hasUnusual));
  if (shapeWhy === 'title' || shapeWhy === 'body' || odd || title.length > PUSH_TITLE_MAX) { allow = false; why = [why, 'payload'].filter(Boolean).join(','); }
  base.actions = allow ? actions : actions.filter(x => x.action !== 'allow');
  return { title, lines, body, allow, shown, why, payload: base };
}

// A notification that replaces one after its request was answered or withdrawn: same tag, no buttons, silent.
// Its text is Pocket's own words; it is made one line and checked like a context line all the same.
export function replacement(rowId, sessionId, text) {
  const body = hidden(text) ? 'No longer waiting' : contextLine(text) || 'No longer waiting';
  return { title: 'Pocket Code', body, tag: 'approval:' + rowId, url: '/#/chat/' + sessionId, silent: true };
}
// The summary beyond the per-conversation limit. `title` is null under "Only that an action waits".
export function summary(sessionId, count, title, { silent = false } = {}) {
  const where = title && !hidden(title) && contextLine(title) ? ' in ' + cut(contextLine(title), 60) : ''; // a title that looks like a key is left out, as on the Conversation line
  const body = count > 0 ? `${count} more action${count === 1 ? '' : 's'} wait${count === 1 ? 's' : ''}${where}` : `Nothing more waits${where}`;
  return { title: 'Pocket Code', body, tag: 'approval-more:' + sessionId, url: '/#/chat/' + sessionId, ...(silent ? { silent: true } : {}) };
}

// ---------- the device test (Part 4) ----------
const CODE_CHARS = 'ACDEFHJKMNPRTUVWXY34679'; // no 0/O, 1/I/L, 2/Z, 5/S, 8/B
export const makeCode = () => CODE_CHARS[randomInt(CODE_CHARS.length)] + CODE_CHARS[randomInt(CODE_CHARS.length)];
const fill = (pattern, n) => pattern.repeat(Math.ceil(n / pattern.length) + 1).slice(0, n);
// A sample in the real layout at its worst case: a "Runs:" line and an "In:" line that together are exactly `limit`
// characters, each ending in its code, then the longest context lines, with both buttons (which only open Settings).
export function testPush(limit, codes) {
  const room = limit - 'Runs: '.length - 'In: '.length; // characters of the command and the folder together
  const cmdLen = Math.ceil(room * 0.6), dirLen = room - cmdLen;
  const command = fill('echo whole-line-check ', cmdLen - 3).replace(/ $/, '-') + ' ' + codes[0];
  const folder = '~/' + fill('pocket/test/', dirLen - 5).replace(/\/$/, '-') + '/' + codes[1];
  const actionLine = 'Runs: ' + command, folderLine = 'In: ' + folder;
  const lines = [actionLine, folderLine, 'Conversation: ' + fill('Test conversation title ', 60).trimEnd().padEnd(60, '.'),
    'Started by job ' + fill('test-job-name-', 48).replace(/-$/, 'x'), 'Subagent: ' + fill('Test subagent name ', 40).trimEnd().padEnd(40, '.')];
  const fields = { tag: 'approval-test', url: '/#/settings/notifications?approvalTest=1', approvalTest: true,
    actions: [{ action: 'deny', title: "Don't allow" }, { action: 'allow', title: 'Allow' }] };
  const { base } = pushShape('Test: Allow this command?', lines.join('\n'), fields);
  base.actions = fields.actions; // pushShape reads the line breaks as unusual; every line here is printable ASCII
  return { actionLine, folderLine, payload: base };
}
