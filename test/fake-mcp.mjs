#!/usr/bin/env node
// Test-only stdio MCP server: `type` records what it received (FAKE_MCP_LOG) and echoes it like Playwright's generated
// code does; `peek` returns the last typed text without being given it, like a page snapshot showing a filled field.
import fs from 'node:fs';
import readline from 'node:readline';
let last = '';
const send = o => process.stdout.write(JSON.stringify(o) + '\n');
readline.createInterface({ input: process.stdin }).on('line', l => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } } });
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'type', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }, { name: 'peek', inputSchema: { type: 'object' } }] } });
  if (m.method === 'tools/call') {
    if (m.params.name === 'type') { last = String(m.params.arguments?.text ?? ''); if (process.env.FAKE_MCP_LOG) fs.appendFileSync(process.env.FAKE_MCP_LOG, JSON.stringify(m.params.arguments) + '\n'); process.stderr.write('typing ' + last + '\n'); return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `await page.getByLabel('Password').fill('${last}');` }] } }); }
    if (m.params.name === 'peek') return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `- textbox "Password": ${last}` }], structuredContent: { value: last } } });
  }
  if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: {} });
});
