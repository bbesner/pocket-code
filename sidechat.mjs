// 1.78: side chat. A private aside next to a conversation: ask about it while it keeps working, without adding to
// it. Each side chat is one agent process started from a copy of the conversation that is never saved, so it has the
// whole conversation as context, writes nothing (the conversation is never touched, and no new session is saved) and
// remembers its own turns only in memory. It reads but does not change anything, has no MCP servers, and ends when
// closed, after a quiet spell, when the daemon restarts or when the sign-in changes.
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
export const sidePrompt = allowSearch => 'You are in a side chat: a private aside branched from the conversation above. The person is asking about '
  + 'that conversation while it carries on separately, and nothing said here reaches it. Answer questions about the conversation, '
  + `its files, its decisions and its progress. You can read files${allowSearch ? ' and search the web' : ''}, but you cannot run commands, edit files or `
  + 'continue the main task from here. If they want something done, say so briefly and suggest asking in the main conversation, '
  + 'or using Branch to start a new conversation that carries on from here. Keep answers short and direct. Do not end with a choices block.';
export const SIDE_PROMPT = sidePrompt(false);
export const CODEX_SIDE_PROMPT = 'You are in a side chat: a private aside branched from the conversation above. The person is asking about '
  + 'that conversation while it carries on separately, and nothing said here reaches it. Answer questions about the conversation, '
  + 'its files, its decisions and its progress. You may read files and run read-only commands; the sandbox is read-only, so do not try '
  + 'to change anything or continue the main task from here. If they want something done, say so briefly and suggest asking in the '
  + 'main conversation, or using Branch to start a new conversation that carries on from here. Keep answers short and direct. '
  + 'Do not end with a choices block.';

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
  send(chat, text) {
    if (chat.closed) throw Object.assign(new Error('This side chat has ended. Start a new one.'), { code: 410 });
    if (chat.busy) throw Object.assign(new Error('Wait for the answer, or stop it, before asking again.'), { code: 409 });
    chat.busy = true; chat.turns++; chat.lastAt = Date.now(); chat.turnAt = Date.now();
    this.emit(chat, { type: 'user', msg: { role: 'user', text, ts: new Date().toISOString() } });
    if (chat.provider === 'codex') {
      chat.turnId = null;
      chat.conn.request('turn/start', { threadId: chat.threadId, input: [{ type: 'text', text }] }, 120_000)
        .then(r => { if (r?.turn?.id) chat.turnId = r.turn.id; })
        .catch(e => { if (!chat.busy || chat.closed) return; chat.busy = false; this.emit(chat, { type: 'result', ok: false, error: String(e.message).slice(0, 300), cost: null, total: null }); });
    } else chat.proc.stdin.write(userLine(text));
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
      if (m?.role === 'assistant') this.emit(chat, { type: 'assistant', msg: { ...m, blocks: m.blocks.filter(b => b.t !== 'choices') } });
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
