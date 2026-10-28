#!/usr/bin/env node
// Integration-only ACP agent: JSON-RPC 2.0 over stdio, never calls a model. Mirrors the
// shape OpenCode's `opencode acp` speaks (verified live), so acp.mjs can be tested with no
// network or real runtime. Session state persists to POCKET_ACP_STORE so a fresh process can
// session/load it (the crash+resume case).
//
// Env flags: POCKET_ACP_STORE (required, dir) · FAKE_ACP_NO_LOADSESSION (advertise loadSession:false)
// · FAKE_ACP_ELICIT (ask an elicitation/create instead of permission) · FAKE_ACP_NO_ASK (skip permission).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';

const STORE = process.env.POCKET_ACP_STORE;
if (!STORE) throw new Error('POCKET_ACP_STORE required');
fs.mkdirSync(STORE, { recursive: true });
const sessFile = id => path.join(STORE, encodeURIComponent(id) + '.json');
const loadSess = id => { try { return JSON.parse(fs.readFileSync(sessFile(id), 'utf8')); } catch { return null; } };
const saveSess = (id, s) => fs.writeFileSync(sessFile(id), JSON.stringify(s));

// Exit cleanly when the client goes away, so a test never leaks this child.
process.stdin.on('end', () => process.exit(0));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
const send = o => process.stdout.write(JSON.stringify(o) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, message) => send({ jsonrpc: '2.0', id, error: { code: -32600, message } });
const notify = (method, params) => send({ jsonrpc: '2.0', method, params });

// The fake's own outgoing requests (server->client), awaiting the client's response.
let seq = 1_000_000;
const clientPending = new Map();
const askClient = (method, params) => new Promise(res => { const id = ++seq; clientPending.set(id, res); send({ jsonrpc: '2.0', id, method, params }); });

const cancelled = new Set(); // sessionIds cancelled mid-turn

async function handlePrompt(id, params) {
  const sid = params.sessionId;
  const text = (params.prompt || []).map(p => p.text || '').join('');
  const s = loadSess(sid) || { updates: [] };
  s.lastPrompt = text;
  // stream a tool call
  const toolId = randomUUID();
  notify('session/update', { sessionId: sid, update: { sessionUpdate: 'tool_call', toolCallId: toolId, title: 'bash', kind: 'execute', status: 'pending' } });
  // ask the client before "running" the tool (permission), or an elicitation question
  if (process.env.FAKE_ACP_ELICIT) {
    const ans = await askClient('elicitation/create', { sessionId: sid, message: 'Pick one', mode: 'form' });
    s.elicitOutcome = ans?.outcome;
  } else if (!process.env.FAKE_ACP_NO_ASK) {
    const ans = await askClient('session/request_permission', { sessionId: sid, toolCallId: toolId,
      options: [{ optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' }] });
    if (cancelled.has(sid) || ans?.cancelled) { cancelled.delete(sid); saveSess(sid, s); return reply(id, { stopReason: 'cancelled' }); }
    s.permissionOutcome = ans?.outcome?.outcome;
    if (ans?.outcome?.outcome !== 'selected' || /reject/.test(ans?.outcome?.optionId || '')) {
      saveSess(sid, s); return reply(id, { stopReason: 'refusal' });
    }
  }
  if (cancelled.has(sid)) { cancelled.delete(sid); saveSess(sid, s); return reply(id, { stopReason: 'cancelled' }); }
  notify('session/update', { sessionId: sid, update: { sessionUpdate: 'tool_call_update', toolCallId: toolId, status: 'completed', title: 'echo ACP_OK' } });
  const answer = `ran it; echo of ${text.slice(0, 40)}`;
  notify('session/update', { sessionId: sid, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: answer } } });
  s.updates.push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: answer } });
  saveSess(sid, s);
  reply(id, { stopReason: 'end_turn' });
}

readline.createInterface({ input: process.stdin }).on('line', line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  // a response to one of OUR outgoing client-requests
  if (m.id != null && (m.result !== undefined || m.error !== undefined) && clientPending.has(m.id)) {
    const res = clientPending.get(m.id); clientPending.delete(m.id); res(m.result); return;
  }
  if (!m.method) return;
  if (m.id == null) { // notification
    if (m.method === 'session/cancel' && m.params?.sessionId) {
      cancelled.add(m.params.sessionId);
      // abort any permission the turn is blocked on, as a real agent does on cancel
      for (const [id, res] of clientPending) { clientPending.delete(id); res({ cancelled: true }); }
    }
    return;
  }
  switch (m.method) {
    case 'initialize': return reply(m.id, {
      protocolVersion: 1,
      agentCapabilities: { loadSession: !process.env.FAKE_ACP_NO_LOADSESSION, sessionCapabilities: { list: {}, resume: {}, fork: {}, close: {} }, promptCapabilities: { embeddedContext: true, image: true }, mcpCapabilities: { http: true, sse: true } },
      agentInfo: { name: 'FakeACP', version: '0.0.1' },
    });
    case 'session/list': {
      let files = []; try { files = fs.readdirSync(STORE).filter(f => f.endsWith('.json')); } catch { }
      const sessions = files.map(f => { const sid = decodeURIComponent(f.replace(/\.json$/, '')); let st; try { st = fs.statSync(path.join(STORE, f)); } catch { } return { sessionId: sid, cwd: '/tmp', title: 'Session ' + sid.slice(0, 8), updatedAt: new Date(st?.mtimeMs || Date.now()).toISOString() }; });
      return reply(m.id, { sessions });
    }
    case 'session/new': { const sid = 'ses_' + randomUUID(); saveSess(sid, { updates: [] }); return reply(m.id, { sessionId: sid }); }
    case 'session/load': {
      if (process.env.FAKE_ACP_NO_LOADSESSION) return fail(m.id, 'loadSession not supported');
      const s = loadSess(m.params?.sessionId); if (!s) return fail(m.id, 'unknown session');
      for (const u of s.updates) notify('session/update', { sessionId: m.params.sessionId, update: u });
      return reply(m.id, {});
    }
    case 'session/prompt': return void handlePrompt(m.id, m.params || {});
    default: return fail(m.id, 'method not found: ' + m.method);
  }
});
