// 1.56: actions that run without asking in Review actions (Claude only).
//
// Review mode keeps its blanket ask rules (they outrank any allow rule in the user's or the
// project's Claude settings). The owner lists read-only actions here; when Claude asks to run
// one of them, Pocket answers Allow itself and records it instead of showing a card. Anything
// that does not match, or that the matcher cannot be sure about, still shows the card.
//
// This is a convenience, not a security boundary: a trusted command runs with every argument
// the agent gives it, so list only commands that cannot change anything whatever they are given.
//
// Rule syntax, a subset of Claude Code's permission rules:
//   Bash(<command prefix>:*)   the command, alone or followed by arguments (`Bash(<prefix> *)` too)
//   Bash(<exact command>)      exactly that command
//   mcp__<server>__<tool>      one MCP tool
//   mcp__<server>__*           every tool from one MCP server
//   WebSearch, WebFetch        those tools, whatever they are given
export const TRUSTED_LIMIT = 50;
export const RULE_MAX = 300;
const COMMAND_MAX = 4000;
const PLAIN_TOOLS = new Set(['WebSearch', 'WebFetch']);
// Bash input keys a trusted command may carry. Anything else (dangerouslyDisableSandbox, a key
// a newer CLI adds) shows the card.
const BASH_KEYS = new Set(['command', 'description', 'timeout', 'run_in_background']);
// Anything that can join, nest, redirect or substitute commands, escape a character, or start
// a new line. Tab is the only control character allowed (it separates words).
const SHELL_SYNTAX = /[;&|`$()<>{}\\\u0000-\u0008\u000a-\u001f\u007f]/;
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const MCP_EXACT = /^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$/;
const MCP_SERVER = /^[A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*$/; // no "__", which separates server and tool
const MCP_TOOL_REST = /^[A-Za-z0-9-][A-Za-z0-9_-]*$/;

const SYNTAX_HELP = 'Use Bash(command:*), Bash(exact command), mcp__server__tool, mcp__server__* or WebSearch.';

// A command's words as written, quotes included, or null when it is not one simple command
// (shell syntax, a line break, an unbalanced quote, an unquoted * ? or [, a VAR=value prefix). Paths and aliases are
// not resolved: the first word is compared as written.
export function commandWords(command) {
  if (typeof command !== 'string' || !command.length || command.length > COMMAND_MAX) return null;
  if (SHELL_SYNTAX.test(command)) return null;
  const words = []; let cur = '', inWord = false, quote = '';
  for (const ch of command) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === ' ' || ch === '\t') { if (inWord) { words.push(cur); cur = ''; inWord = false; } continue; }
    if (ch === '*' || ch === '?' || ch === '[') return null; // an unquoted glob could expand to an option
    inWord = true; cur += ch;
    if (ch === "'" || ch === '"') quote = ch;
  }
  if (quote) return null;
  if (inWord) words.push(cur);
  if (!words.length || ENV_ASSIGNMENT.test(words[0])) return null;
  return words;
}

// Parse one rule. {ok:true, rule} with rule.text normalised, or {ok:false, error} in words the
// owner can act on.
export function parseRule(input) {
  if (typeof input !== 'string') return { ok: false, error: 'A rule is text, for example Bash(git status).' };
  const text = input.trim();
  if (!text) return { ok: false, error: 'Type a rule first.' };
  if (text.length > RULE_MAX) return { ok: false, error: `Keep a rule under ${RULE_MAX} characters.` };
  const name = text.match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0] || '';
  if (/^(Edit|Write|NotebookEdit|MultiEdit)$/.test(name)) return { ok: false, error: `${name} changes files, so it always asks.` };
  if (/^(Agent|Task)$/.test(name)) return { ok: false, error: `${name} starts a subagent that can do anything, so it always asks.` };
  if (name === 'PowerShell') return { ok: false, error: 'PowerShell always asks. Only Bash commands can run without asking.' };
  if (name === 'Bash') {
    if (text === 'Bash') return { ok: false, error: 'Name the command: Bash(command:*) or Bash(exact command). Every Bash command always asks.' };
    const m = text.match(/^Bash\(([\s\S]*)\)$/);
    if (!m) return { ok: false, error: 'Write it as Bash(command:*) or Bash(exact command).' };
    let body = m[1].trim(), prefix = false;
    if (body.endsWith(':*')) { prefix = true; body = body.slice(0, -2).trim(); }
    else if (/\s\*$/.test(body)) { prefix = true; body = body.slice(0, -1).trim(); }
    if (!body || body === '*') return { ok: false, error: 'Name the command: Bash(command:*) or Bash(exact command). Every Bash command always asks.' };
    if (body.includes('*')) return { ok: false, error: 'The only wildcard is :* at the end, as in Bash(git log:*).' };
    if (SHELL_SYNTAX.test(body)) return { ok: false, error: 'A trusted command is one simple command: no ; & | ` $ ( ) < > { } \\ or line breaks.' };
    const words = commandWords(body);
    if (!words) return { ok: false, error: ENV_ASSIGNMENT.test(body) ? 'Start with the command itself, not a VAR=value setting.' : 'Write the command as plain words: close every quote, and quote any ? or [.' };
    return { ok: true, rule: { type: 'bash', words, prefix, text: `Bash(${words.join(' ')}${prefix ? ':*' : ''})` } };
  }
  if (text.startsWith('mcp__')) {
    if (text === 'mcp__*' || text === 'mcp__' || text === 'mcp__*__*') return { ok: false, error: 'Name a server: mcp__server__* or mcp__server__tool.' };
    if (text.endsWith('__*')) {
      const server = text.slice(5, -3);
      if (!MCP_SERVER.test(server)) return { ok: false, error: 'Write a server wildcard as mcp__server__*, with the server name as Claude Code shows it.' };
      return { ok: true, rule: { type: 'mcp-server', prefix: `mcp__${server}__`, text } };
    }
    if (MCP_EXACT.test(text)) return { ok: true, rule: { type: 'mcp', name: text, text } };
    if (/^mcp__[A-Za-z0-9_-]+$/.test(text)) return { ok: false, error: `Add the tool, or __* for every tool from that server: ${text}__*.` };
    return { ok: false, error: 'Write an MCP rule as mcp__server__tool or mcp__server__*.' };
  }
  if (PLAIN_TOOLS.has(text)) return { ok: true, rule: { type: 'tool', name: text, text } };
  if (/^(WebSearch|WebFetch)\(/.test(text)) return { ok: false, error: `${name} rules name the tool only: ${name}.` };
  if (/^(Read|Glob|Grep|LS)$/.test(text)) return { ok: false, error: `${text} does not need a rule.` };
  return { ok: false, error: SYNTAX_HELP };
}

// Validate a list from Settings. {rules:[normalised text…]} or {error, rule, index} for the first bad one.
export function validateRules(list) {
  if (!Array.isArray(list)) return { error: 'Send a list of rules.' };
  if (list.length > TRUSTED_LIMIT) return { error: `Keep the list to ${TRUSTED_LIMIT} rules.` };
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const p = parseRule(list[i]);
    if (!p.ok) return { error: p.error, rule: typeof list[i] === 'string' ? list[i].trim().slice(0, RULE_MAX) : '', index: i };
    if (!out.includes(p.rule.text)) out.push(p.rule.text);
  }
  return { rules: out };
}

// POCKET_TRUSTED_ACTIONS: one rule per line, or several on a line separated by commas outside
// parentheses (so a Bash rule may itself contain a comma). Bad rules are reported and skipped.
export function parseRuleList(raw) {
  const items = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    let depth = 0, cur = '';
    for (const ch of line) {
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) { items.push(cur); cur = ''; } else cur += ch;
    }
    items.push(cur);
  }
  const rules = [], ignored = [];
  for (const item of items.map(s => s.trim()).filter(Boolean)) {
    const p = parseRule(item);
    if (!p.ok) ignored.push({ rule: item.slice(0, RULE_MAX), error: p.error });
    else if (!rules.includes(p.rule.text)) rules.push(p.rule.text);
  }
  if (rules.length > TRUSTED_LIMIT) for (const rule of rules.splice(TRUSTED_LIMIT)) ignored.push({ rule, error: `Only the first ${TRUSTED_LIMIT} rules are used.` });
  return { rules, ignored };
}

// The rule (its text) that lets this tool request run without asking, or null.
export function matchTrusted(ruleTexts, tool, input) {
  if (!Array.isArray(ruleTexts) || !ruleTexts.length || typeof tool !== 'string' || !input || typeof input !== 'object' || Array.isArray(input)) return null;
  const rules = ruleTexts.map(t => parseRule(t)).filter(p => p.ok).map(p => p.rule);
  if (tool === 'Bash') {
    if (Object.keys(input).some(k => !BASH_KEYS.has(k))) return null;
    const words = commandWords(input.command);
    if (!words) return null;
    for (const r of rules) {
      if (r.type !== 'bash' || words.length < r.words.length || (!r.prefix && words.length !== r.words.length)) continue;
      if (r.words.every((w, i) => words[i] === w)) return r.text;
    }
    return null;
  }
  if (tool.startsWith('mcp__')) {
    for (const r of rules) {
      if (r.type === 'mcp' && r.name === tool) return r.text;
      if (r.type === 'mcp-server' && tool.startsWith(r.prefix) && MCP_TOOL_REST.test(tool.slice(r.prefix.length))) return r.text;
    }
    return null;
  }
  for (const r of rules) if (r.type === 'tool' && r.name === tool) return r.text;
  return null;
}
