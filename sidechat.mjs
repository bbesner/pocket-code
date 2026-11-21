// 1.78: side chat. A private aside next to a conversation: ask about it while it keeps working, without adding to
// it. Each side chat is one agent process started from a copy of the conversation that is never saved, so it has the
// whole conversation as context, writes nothing (the conversation is never touched, and no new session is saved) and
// remembers its own turns only in memory. It reads but does not change anything, has no MCP servers, and ends when
// closed, after a quiet spell, when the daemon restarts or when the sign-in changes.
// 1.121: it is told what it is (an observer, not the agent doing the work), and each question goes with Pocket's note
// on the conversation as it is now, so the copy does not go stale (sideNote below; server.mjs sideContext).
// - Claude: `claude -p --resume <id> --fork-session --no-session-persistence`, tools Read/Grep/Glob (and WebSearch when
//   the conversation would search without asking), no hooks, a spending cap.
// - Codex (1.79): its own `codex app-server` with `thread/fork` `ephemeral: true`, sandbox read-only, no approvals,
//   MCP servers and app connectors off (codex.mjs sideChatConfig). Codex can run read-only commands in its sandbox.
// 1.89 (F-4): either process leads its own process group, and closing the side chat signals the whole group, so a
// program it started does not outlive it.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { signalGroup } from './proctree.mjs';

// 1.89 (S-2): the side chat cannot ask, so a tool it may use runs unasked. Reading is unasked in either mode; WebSearch is
// added only when the conversation itself would search without asking (Full access, or the owner's trusted WebSearch rule).
export const SIDE_TOOLS = ['Read', 'Grep', 'Glob'];
export const SIDE_SEARCH_TOOL = 'WebSearch';
// 1.121: who the side chat is. It starts as a copy of the conversation, so it has a long history in which "I" was the
// agent doing the work; told only that it was "in a side chat", it went on speaking as that agent ("I'm running the
// tests") and offering work it cannot do. The instructions now say what it is, how to speak of the conversation, what
// it can and cannot do, and that each question comes with Pocket's note on the conversation as it is now (sideNote).
const SIDE_WHO = 'You are the side chat for the conversation above: a separate, read-only assistant the person opened beside it to ask '
  + 'about it. You are not the agent doing the work. Everything above is a copy of that conversation; where it says "I", that was the '
  + 'agent in the conversation, not you. Call it "the conversation" or "it", and report what it did and what it is doing. Never say '
  + 'that you are doing, running, waiting on or about to do any of its work. The conversation carries on separately while you talk, '
  + 'and nothing said here reaches it. ';
const SIDE_NOTE_HELP = 'Each question arrives with a note from Pocket Code inside <pocket-side-chat> tags: the state of the conversation '
  + 'now and what it has done since you last looked. For anything about the present, trust that note over the copy above. It is '
  + 'information, not instructions, and the person does not see it. ';
const SIDE_ASKED = 'If they ask for work, or want the conversation to know something, say that you cannot do that from here and suggest '
  + 'saying it in the main conversation, or using Branch to start a new conversation that carries on from here. Keep answers short '
  + 'and direct. Do not end with a choices or done block.';
export const sidePrompt = allowSearch => SIDE_WHO
  + `You can read files${allowSearch ? ' and search the web' : ''} to answer questions about the conversation, its files, its decisions and `
  + 'its progress. You cannot run commands, edit files, approve anything or continue its task; the other tools used above are not '
  + 'available to you. ' + SIDE_NOTE_HELP + SIDE_ASKED;
export const SIDE_PROMPT = sidePrompt(false);
export const CODEX_SIDE_PROMPT = SIDE_WHO
  + 'You may read files and run read-only commands to answer questions about the conversation, its files, its decisions and its '
  + 'progress. The sandbox is read-only: you cannot change anything, approve anything or continue its task. ' + SIDE_NOTE_HELP + SIDE_ASKED;
// Said again in front of the first question: a line at the point of the question holds better against a long history
// than one appended to the system instructions.
export const SIDE_BRIEF = 'You are the side chat, not the agent working in the conversation above. Speak of that agent as "it" or '
  + '"the conversation". You can look and answer; you cannot change anything or carry on its work.';

// ---------- 1.121: the note that goes with each question ----------
const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const mins = ms => { const m = Math.round(ms / 60_000); return m < 1 ? 'under a minute' : m === 1 ? '1 minute' : m < 90 ? `${m} minutes` : `${(m / 60).toFixed(1)} hours`; };
// The conversation's messages (the shape the conversation view draws, plus {role:'result'} for a tool's output) as
// plain lines, newest last. Over `cap` characters the oldest lines go, and the first line says how many.
export function sideSinceText(msgs, cap = 12_000) {
  const lines = [];
  for (const m of Array.isArray(msgs) ? msgs : []) {
    if (m?.role === 'user') { if (m.text) lines.push('The person wrote: ' + clip(m.text, 1200)); continue; }
    if (m?.role === 'result') { if (m.text) lines.push(`  ${m.err ? 'It failed' : 'Output'}: ` + clip(m.text, 400)); continue; }
    for (const b of m?.blocks || []) {
      if (b.t === 'text' && b.text?.trim()) lines.push('It said: ' + clip(b.text, 1200));
      else if (b.t === 'tool') lines.push(`It ran ${b.name || 'a tool'}${b.detail ? ': ' + clip(b.detail, 300) : ''}`);
      else if (b.t === 'todo') lines.push('Its plan: ' + clip((b.todos || []).map(t => `[${t.s === 'completed' ? 'x' : t.s === 'in_progress' ? '>' : ' '}] ${t.c}`).join('; '), 600));
      else if (b.t === 'choices') lines.push('It offered the person these replies: ' + clip((b.options || []).join(' | '), 300));
      else if (b.t === 'done') lines.push('It marked the work complete' + (b.text ? ': ' + clip(b.text, 200) : '.'));
    }
  }
  let size = 0, keep = lines.length;
  while (keep > 0 && size + lines[keep - 1].length + 1 <= cap) size += lines[--keep].length + 1;
  const left = keep;
  return { text: (left ? [`(${left} earlier ${left === 1 ? 'line' : 'lines'} left out for length)`] : []).concat(lines.slice(keep)).join('\n'), lines: lines.length, left };
}
// state: the daemon's stateFor() row. Returns one sentence on what the conversation is doing now.
export function sideStateLine(state, now = Date.now()) {
  const s = state || {}, since = s.startedAt ? ` for ${mins(now - s.startedAt)}` : '';
  if (s.kind === 'running') return `It is working on a reply now${since}${s.startedBy ? ` (${s.startedBy})` : ''}.`;
  if (s.kind === 'input') return `It is waiting on the person: ${s.label || 'needs an answer'}.`;
  if (s.kind === 'background') return `Its last reply has ended, and it still has work running in the background (${s.background?.summary || 'jobs'}); it will carry on by itself when that finishes.`;
  if (s.kind === 'waiting') return `It is not working: ${s.label || 'waiting'}.`;
  if (s.kind === 'finished') return `It is not working. Its last reply finished${s.done ? ' and it marked the work complete' : ''}.`;
  if (s.kind === 'failed') return `It is not working. Its last reply did not finish${s.error ? `: ${clip(s.error, 200)}` : ''}.`;
  if (s.kind === 'stopped' || s.kind === 'ended') return 'It is not working. Its last reply was stopped.';
  if (s.kind === 'observed') return 'It looks active in another app, outside Pocket Code, so Pocket Code cannot see its steps as they happen.';
  return 'It is not working right now.';
}
// The whole note. first: this is the side chat's first question (the copy above was just taken).
// since: sideSinceText()'s result, or null when the new steps could not be read.
export function sideNote({ first = false, state, paused = false, approvals = [], questions = [], queue = [], jobs = [], since = null, now = Date.now() }) {
  const out = [];
  if (first) out.push(SIDE_BRIEF, '');
  out.push('The conversation now:', '- ' + sideStateLine(state, now));
  if (paused) out.push('- Pause all is on in Pocket Code: replies nobody started by hand are held.');
  for (const a of approvals.slice(0, 5)) out.push('- It asked for approval: ' + clip(a.title || a.kind || 'an action', 300));
  for (const q of questions.slice(0, 5)) for (const x of (q.questions || []).slice(0, 3)) out.push('- It asked the person: ' + clip(x.question, 300));
  for (const j of jobs.slice(0, 8)) out.push(`- Background ${j.kind === 'agent' ? 'agent' : 'job'}: ${clip(j.description || 'no description', 160)}`);
  if (queue.length) {
    out.push(`- ${queue.length === 1 ? 'One message from the person is' : `${queue.length} messages from the person are`} queued to send after this reply:`);
    for (const r of queue.slice(0, 5)) out.push('  - ' + clip(r.text, 300));
  }
  out.push('');
  if (first) out.push('The copy above was taken just now, so it is current.');
  else if (!since) out.push('Pocket Code could not read what the conversation has done since you last looked. Say so if it matters to the answer.');
  else if (!since.lines) out.push('Nothing new in the conversation since you last looked.');
  else out.push('Since you last looked, oldest first:', since.text);
  // the note's own closing tag inside quoted conversation text would end it early
  return out.join('\n').replace(/<\/?pocket-side-chat>/gi, '(tag)');
}
export const SIDE_NOTE_END = '</pocket-side-chat>\n\n';
export const sideInput = (note, text) => note ? `<pocket-side-chat>\n${note}\n${SIDE_NOTE_END}${text}` : text;

export function sideChatArgs({ parentId, model, budgetUsd, allowSearch = false }) {
  const tools = allowSearch ? [...SIDE_TOOLS, SIDE_SEARCH_TOOL] : SIDE_TOOLS;
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--resume', parentId, '--fork-session', '--no-session-persistence',
    '--permission-mode', 'default', '--tools', tools.join(','), '--allowedTools', tools.join(','), '--strict-mcp-config',
    '--settings', JSON.stringify({ disableAllHooks: true }), '--append-system-prompt', sidePrompt(allowSearch)];
  if (model) args.push('--model', model);
  if (budgetUsd > 0) args.push('--max-budget-usd', String(budgetUsd));
  return args;
}
// The thread/fork request for a Codex side chat.
export function codexSideFork(threadId, config = {}) {
  return { threadId, ephemeral: true, excludeTurns: true, sandbox: 'read-only', approvalPolicy: 'never', developerInstructions: CODEX_SIDE_PROMPT, config };
}

const userLine = text => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n';
// The CLI's own reason when it ends a turn early, in words for the panel.
function resultError(o) {
  if (o.subtype === 'success') return null;
  if (/budget/i.test(o.subtype)) return 'This side chat reached its spending cap. Start a new one to keep asking.';
  if (o.subtype === 'error_during_execution' && !o.result) return 'Stopped';
  return String(o.result || o.subtype || 'The reply failed').slice(0, 300);
}

export class SideChats {
  // normalize: the daemon's transcript-line normalizer (same message shape the conversation view draws).
  // codex: { AppServer, normalizeItem, config } from codex.mjs, when Codex is available.
  constructor({ bin, env, normalize, log = () => { }, budgetUsd = 5, idleMs = 30 * 60_000, max = 4, codex = null }) {
    Object.assign(this, { bin, env, normalize, log, budgetUsd, idleMs, max, codex });
    this.chats = new Map();
  }
  get(id) { return this.chats.get(id) || null; }
  forParent(parentId) { return [...this.chats.values()].find(c => c.parentId === parentId && !c.closed) || null; }
  make(parentId) {
    const previous = this.forParent(parentId);
    if (previous) this.close(previous, 'replaced');
    const live = [...this.chats.values()].filter(c => !c.closed);
    if (live.length >= this.max) {
      const idle = live.filter(c => !c.busy).sort((a, b) => a.lastAt - b.lastAt)[0];
      if (!idle) throw Object.assign(new Error('Too many side chats are answering right now. Try again when one finishes.'), { code: 429 });
      this.close(idle, 'limit');
    }
    // 1.89 (F-1): seq counts every event ever emitted and base is the id of events[0], so ids keep counting once the
    // list is trimmed to its last 2,000.
    return { id: randomUUID(), parentId, events: [], seq: 0, base: 0, subs: new Set(), busy: false, turns: 0, total: 0, startedAt: Date.now(), lastAt: Date.now(), closed: null, stderr: '' };
  }
  // Claude: synchronous; the process reports a bad conversation id by exiting.
  // allowSearch: the conversation would run WebSearch without asking (the caller decides; see SIDE_TOOLS).
  open({ parentId, cwd, model, allowSearch = false }) {
    const chat = Object.assign(this.make(parentId), { provider: 'claude', cwd, model: model || null, allowSearch: Boolean(allowSearch) });
    const proc = spawn(this.bin, sideChatArgs({ parentId, model, budgetUsd: this.budgetUsd, allowSearch }), { cwd, env: typeof this.env === 'function' ? this.env() : this.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    Object.assign(chat, { proc, pid: proc.pid });
    this.chats.set(chat.id, chat);
    proc.stdin.on('error', () => { });
    readline.createInterface({ input: proc.stdout }).on('line', line => this.line(chat, line));
    proc.stderr.on('data', b => { chat.stderr = (chat.stderr + b).slice(-2000); });
    proc.on('exit', code => this.exited(chat, code));
    proc.on('error', e => { chat.stderr += e.message; this.exited(chat, -1); });
    this.arm(chat);
    this.log(`side chat start side=${chat.id} parent=${parentId} pid=${proc.pid} model=${model || 'default'} search=${chat.allowSearch}`);
    return chat;
  }
  // 1.79 Codex: its own app-server, so the side chat's events never mix with the conversation's process.
  async openCodex({ parentId, threadId, cwd }) {
    if (!this.codex) throw Object.assign(new Error('Codex is not available on this server.'), { code: 400 });
    // 1.89 (S-1): the MCP servers to turn off come from Codex itself; when it cannot list them, no side chat starts.
    let config;
    try { config = (await this.codex.config?.(cwd)) || {}; }
    catch (e) { throw Object.assign(new Error('The side chat could not start: ' + String(e.message).slice(0, 400)), { code: 502 }); }
    const chat = Object.assign(this.make(parentId), { provider: 'codex', cwd, model: null });
    const conn = new this.codex.AppServer({ name: `side ${chat.id.slice(0, 8)}`, detached: true, onNotify: (m, p) => this.codexNote(chat, m, p) });
    Object.assign(chat, { conn, pid: conn.pid });
    conn.onExit = code => this.exited(chat, code);
    this.chats.set(chat.id, chat);
    try {
      await conn.init();
      const r = await conn.request('thread/fork', { ...codexSideFork(threadId, config), ...(cwd ? { cwd } : {}) }, 60_000);
      chat.threadId = r?.thread?.id; chat.model = r?.model || null;
      if (!chat.threadId) throw new Error('thread/fork returned no id');
    } catch (e) {
      this.close(chat, 'failed');
      throw Object.assign(new Error('The side chat could not start: ' + String(e.message).slice(0, 200)), { code: 502 });
    }
    this.arm(chat);
    this.log(`side chat start side=${chat.id} parent=${parentId} pid=${conn.pid} codex thread=${chat.threadId} model=${chat.model || 'default'}`);
    return chat;
  }
  // Whether send() would take a question now; throws what send() would. The caller checks before it builds the note.
  ready(chat) {
    if (chat.closed) throw Object.assign(new Error('This side chat has ended. Start a new one.'), { code: 410 });
    if (chat.busy) throw Object.assign(new Error('Wait for the answer, or stop it, before asking again.'), { code: 409 });
  }
  // note (1.121): Pocket's note on the conversation as it is now (sideNote). The model reads it in front of the
  // question; the panel shows only what the person typed.
  send(chat, text, note = null) {
    this.ready(chat);
    chat.busy = true; chat.turns++; chat.lastAt = Date.now(); chat.turnAt = Date.now();
    this.emit(chat, { type: 'user', msg: { role: 'user', text, ts: new Date().toISOString() } });
    const input = sideInput(note, text);
    if (chat.provider === 'codex') {
      chat.turnId = null;
      chat.conn.request('turn/start', { threadId: chat.threadId, input: [{ type: 'text', text: input }] }, 120_000)
        .then(r => { if (r?.turn?.id) chat.turnId = r.turn.id; })
        .catch(e => { if (!chat.busy || chat.closed) return; chat.busy = false; this.emit(chat, { type: 'result', ok: false, error: String(e.message).slice(0, 300), cost: null, total: null }); });
    } else chat.proc.stdin.write(userLine(input));
    this.arm(chat);
  }
  stop(chat) {
    if (chat.closed || !chat.busy) return false;
    // 1.89 (F-2): an interrupt that fails or goes unanswered for 20 s ends the side chat, as Stop does for a conversation
    // (codex.mjs stopCodexTurn); a hung app-server would otherwise keep it busy, never idle-closed, holding a slot.
    if (chat.provider === 'codex') {
      chat.conn.request('turn/interrupt', { threadId: chat.threadId, turnId: chat.turnId }, 20_000).catch(e => {
        if (chat.closed || !chat.busy) return;
        this.log(`side chat interrupt failed side=${chat.id}: ${e.message}`);
        this.emit(chat, { type: 'error', error: 'The side chat did not answer Stop, so it was ended. Ask again to start a new one.' });
        this.close(chat, 'interrupt failed');
      });
      return true;
    }
    chat.proc.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'side-stop-' + Date.now(), request: { subtype: 'interrupt' } }) + '\n');
    return true;
  }
  // 1.89 (F-4, F-2): the process leads its own group. Claude's CLI gets 3 s to exit on its own after stdin ends, Codex's
  // app-server a SIGTERM at once; then the group gets SIGTERM and, 3 s later if anything in it is left, SIGKILL. The group
  // is signalled whether or not its leader has exited, since a program it started can outlive it. `now` (the daemon is
  // exiting, so no timer will run) sends the group SIGTERM at once.
  close(chat, why = 'closed', { now = false } = {}) {
    if (chat.closed) return;
    chat.closed = why; chat.busy = false; clearTimeout(chat.idleTimer);
    this.emit(chat, { type: 'closed', why });
    for (const res of chat.subs) { try { res.end(); } catch { } }
    chat.subs.clear();
    const pid = chat.pid, codex = chat.provider === 'codex';
    if (codex) { try { chat.conn.close(); } catch { } }
    else { try { chat.proc.stdin.end(); } catch { } }
    if (pid && (now || codex)) signalGroup(pid, 'SIGTERM');
    if (pid && !now) setTimeout(() => {
      if (!codex) signalGroup(pid, 'SIGTERM');
      setTimeout(() => { if (signalGroup(pid, 0)) signalGroup(pid, 'SIGKILL'); }, 3000).unref();
    }, codex ? 0 : 3000).unref();
    setTimeout(() => this.chats.delete(chat.id), 10 * 60_000).unref(); // a reconnecting panel still learns why it ended
    this.log(`side chat close side=${chat.id} parent=${chat.parentId} why=${why} turns=${chat.turns}${chat.provider === 'codex' ? '' : ` cost=${chat.total.toFixed(4)}`}`);
  }
  closeAll(why, provider, opts) { for (const c of this.chats.values()) if (!provider || c.provider === provider) this.close(c, why, opts); }
  arm(chat) {
    clearTimeout(chat.idleTimer);
    if (this.idleMs > 0) { chat.idleTimer = setTimeout(() => chat.busy ? this.arm(chat) : this.close(chat, 'idle'), this.idleMs); chat.idleTimer.unref?.(); }
  }
  emit(chat, ev) {
    chat.events.push(ev);
    const id = chat.seq++;
    if (chat.events.length > 2000) { const cut = chat.events.length - 2000; chat.events.splice(0, cut); chat.base += cut; }
    const data = `id: ${id}\ndata: ${JSON.stringify(ev)}\n\n`;
    for (const res of chat.subs) { try { res.write(data); } catch { } }
  }
  // Replay from an event id (a reconnect's Last-Event-ID + 1), then stream live. An id older than the kept window
  // replays from the oldest event kept, as a fresh connect does.
  subscribe(chat, res, from = 0) {
    for (let i = Math.max(chat.base, from); i < chat.seq; i++) res.write(`id: ${i}\ndata: ${JSON.stringify(chat.events[i - chat.base])}\n\n`);
    if (chat.closed) return () => { };
    chat.subs.add(res);
    return () => chat.subs.delete(res);
  }
  line(chat, line) {
    if (!line.trim()) return;
    let o; try { o = JSON.parse(line); } catch { return; }
    chat.lastAt = Date.now();
    if (o.type === 'stream_event') {
      const ev = o.event;
      if (!o.parent_tool_use_id && ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) this.emit(chat, { type: 'delta', text: ev.delta.text });
    } else if (o.type === 'assistant' && !o.parent_tool_use_id) {
      const m = this.normalize({ ...o, timestamp: o.timestamp || new Date().toISOString() });
      if (m) this.emit(chat, { type: 'assistant', msg: m });
    } else if (o.type === 'result') {
      chat.busy = false;
      // total_cost_usd is the process's running total, not this turn's (an interrupted turn may report 0).
      const spent = Number(o.total_cost_usd), cost = Number.isFinite(spent) && spent > chat.total ? spent - chat.total : 0;
      chat.total += cost;
      this.emit(chat, { type: 'result', ok: o.subtype === 'success', error: resultError(o), cost, total: chat.total, duration_ms: o.duration_ms });
      this.arm(chat);
    }
  }
  // Codex app-server notifications for the side chat's own thread. Codex is paid by subscription: no cost figures.
  codexNote(chat, method, p) {
    if (chat.closed) return;
    chat.lastAt = Date.now();
    if (method === 'turn/started') { chat.turnId = p?.turn?.id || p?.turnId || chat.turnId; return; }
    if (method === 'item/agentMessage/delta' && p?.delta) return this.emit(chat, { type: 'delta', text: p.delta });
    if (method === 'item/completed' && p?.item && p.item.type !== 'userMessage') {
      const m = this.codex.normalizeItem(p.item, new Date().toISOString());
      if (m?.role === 'assistant') this.emit(chat, { type: 'assistant', msg: { ...m, blocks: m.blocks.filter(b => b.t !== 'choices' && b.t !== 'done') } });
      return;
    }
    if (method === 'turn/completed') {
      if (!chat.busy) return;
      chat.busy = false;
      const st = p?.turn?.status;
      const error = st === 'completed' ? null : st === 'interrupted' ? 'Stopped' : String(p?.turn?.error?.message || 'The reply did not finish.').slice(0, 300);
      this.emit(chat, { type: 'result', ok: st === 'completed', error, cost: null, total: null, duration_ms: Date.now() - (chat.turnAt || Date.now()) });
      this.arm(chat);
    }
  }
  exited(chat, code) {
    if (chat.closed) return;
    chat.busy = false;
    const said = chat.stderr.trim().split('\n').filter(Boolean).at(-1) || '';
    const why = /No conversation found/i.test(said) ? 'The conversation could not be read. Send a message in it first, then try again.'
      : said ? said.slice(0, 300) : `The side chat process ended (exit ${code}).`;
    if (chat.turns && code === 0 && !said) return this.close(chat, 'ended');
    this.emit(chat, { type: 'error', error: why });
    this.close(chat, 'failed');
  }
}
