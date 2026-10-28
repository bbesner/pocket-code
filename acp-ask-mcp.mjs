#!/usr/bin/env node
// acp-ask-mcp.mjs — Pocket's "ask the user" tool for agents that reach Pocket over ACP (OpenCode today).
//
// Claude Code asks with AskUserQuestion and Codex with requestUserInput; both reach Pocket's question inbox and
// show as question cards. OpenCode 1.19 has a question tool, but over ACP it waits for an answer the protocol
// cannot carry, so Pocket starts each OpenCode process with this MCP server instead (in the config Pocket gives
// that process). The tool takes Claude's AskUserQuestion shape, hands the questions to the Pocket daemon on
// loopback, and polls until you answer in Pocket, then returns the answers to the model.
//
// Environment (set by Pocket per OpenCode process): POCKET_ASK_URL (the daemon's internal ask endpoint) and
// POCKET_ASK_KEY (a random key for this one process: it authorizes the call and names the conversation).
import readline from 'node:readline';

const URL_BASE = process.env.POCKET_ASK_URL, KEY = process.env.POCKET_ASK_KEY;
const POLL_MS = Number(process.env.POCKET_ASK_POLL_MS) || 1500;
const send = o => process.stdout.write(JSON.stringify(o) + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TOOL = {
  name: 'ask_user',
  description: 'Ask the user one or more multiple-choice questions and wait for their answers. Use it when you need the user to decide something before you continue (which option, which file, whether to proceed). The user sees each question as a card with your options as buttons and can also type their own answer. Do not ask the same thing again in plain text.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['questions'],
    properties: {
      questions: {
        type: 'array', minItems: 1, maxItems: 4,
        items: {
          type: 'object', additionalProperties: false, required: ['question', 'options'],
          properties: {
            question: { type: 'string', description: 'The question, ending with a question mark.' },
            header: { type: 'string', description: 'A very short label for the question (up to 12 characters).' },
            options: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['label'], properties: { label: { type: 'string' }, description: { type: 'string' } } } },
            multiSelect: { type: 'boolean', description: 'True when more than one option may be chosen.' },
          },
        },
      },
    },
  },
};

async function call(path, init) {
  const r = await fetch(URL_BASE + path, { ...init, headers: { 'content-type': 'application/json', 'x-pocket-ask-key': KEY || '' }, signal: AbortSignal.timeout(30_000) });
  let body = null; try { body = await r.json(); } catch { }
  if (!r.ok) throw new Error(body?.error || `Pocket answered ${r.status}`);
  return body;
}

async function ask(args) {
  if (!URL_BASE || !KEY) throw new Error('This tool only works inside Pocket Code.');
  const { id } = await call('', { method: 'POST', body: JSON.stringify({ questions: args?.questions }) });
  for (;;) {
    await sleep(POLL_MS);
    let st; try { st = await call('/' + encodeURIComponent(id), { method: 'GET' }); } catch { continue; } // a restart or a blip: keep waiting
    if (st.state === 'answered') {
      if (st.skipped) return `The user skipped the question and wrote instead: ${st.skipped}`;
      return Object.entries(st.answers || {}).map(([q, a]) => `${q}\nAnswer: ${(a || []).join(', ') || '(no answer)'}`).join('\n\n');
    }
    if (st.state === 'gone') return 'The question was withdrawn before the user answered (the reply was stopped or ended). Do not assume an answer.';
  }
}

readline.createInterface({ input: process.stdin }).on('line', async line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'pocket', version: '1' } } });
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: [TOOL] } });
  if (m.method === 'tools/call') {
    if (m.params?.name !== TOOL.name) return send({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'unknown tool' } });
    try { return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: await ask(m.params.arguments) }] } }); }
    catch (e) { return send({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text', text: `The question could not be asked: ${e.message}` }] } }); }
  }
  if (m.id !== undefined && m.method) send({ jsonrpc: '2.0', id: m.id, result: {} });
});
