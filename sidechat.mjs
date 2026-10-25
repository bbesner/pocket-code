// 1.78: side chat. A private aside next to a Claude conversation: ask about it while it keeps working,
// without adding to it. Each side chat is one Claude Code process started from the conversation's transcript
// with --fork-session --no-session-persistence, so it has the whole conversation as context, writes nothing
// (the conversation's transcript is never touched, and no new session is saved) and remembers its own turns
// only in memory. It can read and search (Read, Grep, Glob, WebSearch) but not change anything: no Bash, no
// edits, no MCP servers, no hooks, and a spending cap. It ends when closed, after a quiet spell, when the daemon
// restarts (its stdin closes) or when the Claude sign-in changes.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';

export const SIDE_TOOLS = ['Read', 'Grep', 'Glob', 'WebSearch'];
export const SIDE_PROMPT = 'You are in a side chat: a private aside branched from the conversation above. The person is asking about '
  + 'that conversation while it carries on separately, and nothing said here reaches it. Answer questions about the conversation, '
  + 'its files, its decisions and its progress. You can read files and search the web, but you cannot run commands, edit files or '
  + 'continue the main task from here. If they want something done, say so briefly and suggest asking in the main conversation. '
  + 'Keep answers short and direct. Do not end with a choices block.';

export function sideChatArgs({ parentId, model, budgetUsd }) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--resume', parentId, '--fork-session', '--no-session-persistence',
    '--permission-mode', 'default', '--tools', SIDE_TOOLS.join(','), '--allowedTools', SIDE_TOOLS.join(','), '--strict-mcp-config',
    '--settings', JSON.stringify({ disableAllHooks: true }), '--append-system-prompt', SIDE_PROMPT];
  if (model) args.push('--model', model);
  if (budgetUsd > 0) args.push('--max-budget-usd', String(budgetUsd));
  return args;
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
  constructor({ bin, env, normalize, log = () => { }, budgetUsd = 5, idleMs = 30 * 60_000, max = 4 }) {
    Object.assign(this, { bin, env, normalize, log, budgetUsd, idleMs, max });
    this.chats = new Map();
  }
  get(id) { return this.chats.get(id) || null; }
  forParent(parentId) { return [...this.chats.values()].find(c => c.parentId === parentId && !c.closed) || null; }
  open({ parentId, cwd, model }) {
    const previous = this.forParent(parentId);
    if (previous) this.close(previous, 'replaced');
    const live = [...this.chats.values()].filter(c => !c.closed);
    if (live.length >= this.max) {
      const idle = live.filter(c => !c.busy).sort((a, b) => a.lastAt - b.lastAt)[0];
      if (!idle) throw Object.assign(new Error('Too many side chats are answering right now. Try again when one finishes.'), { code: 429 });
      this.close(idle, 'limit');
    }
    const id = randomUUID();
    const proc = spawn(this.bin, sideChatArgs({ parentId, model, budgetUsd: this.budgetUsd }), { cwd, env: typeof this.env === 'function' ? this.env() : this.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const chat = { id, parentId, cwd, model: model || null, proc, pid: proc.pid, events: [], subs: new Set(), busy: false, turns: 0, total: 0, startedAt: Date.now(), lastAt: Date.now(), closed: null, stderr: '' };
    this.chats.set(id, chat);
    proc.stdin.on('error', () => { });
    readline.createInterface({ input: proc.stdout }).on('line', line => this.line(chat, line));
    proc.stderr.on('data', b => { chat.stderr = (chat.stderr + b).slice(-2000); });
    proc.on('exit', code => this.exited(chat, code));
    proc.on('error', e => { chat.stderr += e.message; this.exited(chat, -1); });
    this.arm(chat);
    this.log(`side chat start side=${id} parent=${parentId} pid=${proc.pid} model=${model || 'default'}`);
    return chat;
  }
  send(chat, text) {
    if (chat.closed) throw Object.assign(new Error('This side chat has ended. Start a new one.'), { code: 410 });
    if (chat.busy) throw Object.assign(new Error('Wait for the answer, or stop it, before asking again.'), { code: 409 });
    chat.busy = true; chat.turns++; chat.lastAt = Date.now();
    this.emit(chat, { type: 'user', msg: { role: 'user', text, ts: new Date().toISOString() } });
    chat.proc.stdin.write(userLine(text));
    this.arm(chat);
  }
  stop(chat) {
    if (chat.closed || !chat.busy) return false;
    chat.proc.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'side-stop-' + Date.now(), request: { subtype: 'interrupt' } }) + '\n');
    return true;
  }
  close(chat, why = 'closed') {
    if (chat.closed) return;
    chat.closed = why; clearTimeout(chat.idleTimer);
    this.emit(chat, { type: 'closed', why });
    for (const res of chat.subs) { try { res.end(); } catch { } }
    chat.subs.clear();
    try { chat.proc.stdin.end(); } catch { }
    const proc = chat.proc;
    setTimeout(() => { if (proc.exitCode === null && proc.signalCode === null) try { proc.kill('SIGTERM'); } catch { } }, 3000).unref();
    setTimeout(() => this.chats.delete(chat.id), 10 * 60_000).unref(); // a reconnecting panel still learns why it ended
    this.log(`side chat close side=${chat.id} parent=${chat.parentId} why=${why} turns=${chat.turns} cost=${chat.total.toFixed(4)}`);
  }
  closeAll(why) { for (const c of this.chats.values()) this.close(c, why); }
  arm(chat) {
    clearTimeout(chat.idleTimer);
    if (this.idleMs > 0) { chat.idleTimer = setTimeout(() => chat.busy ? this.arm(chat) : this.close(chat, 'idle'), this.idleMs); chat.idleTimer.unref?.(); }
  }
  emit(chat, ev) {
    chat.events.push(ev);
    if (chat.events.length > 2000) chat.events.splice(0, chat.events.length - 2000);
    const data = `id: ${chat.events.length - 1}\ndata: ${JSON.stringify(ev)}\n\n`;
    for (const res of chat.subs) { try { res.write(data); } catch { } }
  }
  // Replay from an event number (a reconnect's Last-Event-ID + 1), then stream live.
  subscribe(chat, res, from = 0) {
    for (let i = Math.max(0, from); i < chat.events.length; i++) res.write(`id: ${i}\ndata: ${JSON.stringify(chat.events[i])}\n\n`);
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
