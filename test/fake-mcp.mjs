#!/usr/bin/env node
// Test-only stdio MCP server: `type` records what it received (FAKE_MCP_LOG) and echoes it like Playwright's generated
// code does; `peek` returns the last typed text without being given it, like a page snapshot showing a filled field
// (and, 1.73.5, every text typed so far, the last one as a number and as an object key); `shot` returns an image and a
// blob resource, like a screenshot; `evaluate` echoes an expression, like browser_evaluate. The typed text goes to
// stderr in two chunks. `initialize` lists which Pocket variables the server inherited. FAKE_MCP_STUBBORN=1 ignores SIGTERM.
import fs from 'node:fs';
import readline from 'node:readline';
let last = ''; const history = [];
const send = o => process.stdout.write(JSON.stringify(o) + '\n');
if (process.env.FAKE_MCP_STUBBORN === '1') process.on('SIGTERM', () => {});
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fe0d7a0b5a0000000049454e44ae426082', 'hex').toString('base64');
readline.createInterface({ input: process.stdin }).on('line', l => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' }, env: Object.keys(process.env).filter(k => /^(POCKET_|VAPID_)/.test(k)).sort() } });
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'type', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }, { name: 'peek', inputSchema: { type: 'object' } }, { name: 'shot', inputSchema: { type: 'object' } }, { name: 'evaluate', inputSchema: { type: 'object', properties: { expression: { type: 'string' } } } }] } });
  if (m.method === 'tools/call') {
    if (m.params.name === 'type') {
      last = String(m.params.arguments?.text ?? ''); history.push(last);
      if (process.env.FAKE_MCP_LOG) fs.appendFileSync(process.env.FAKE_MCP_LOG, JSON.stringify(m.params.arguments) + '\n');
      process.stderr.write('typing ' + last.slice(0, 3)); setTimeout(() => process.stderr.write(last.slice(3) + '\n'), 30);
      return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `await page.getByLabel('Password').fill('${last}');` }] } });
    }
    if (m.params.name === 'peek') return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `- textbox "Password": ${last}` }], structuredContent: { value: last, history: [...history], asNumber: /^\d+$/.test(last) ? Number(last) : null, byText: { [last]: true } } } });
    if (m.params.name === 'shot') return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'image', data: PNG, mimeType: 'image/png' }, { type: 'resource', resource: { uri: 'file:///shot.png', mimeType: 'image/png', blob: PNG } }, { type: 'text', text: 'Took a screenshot' }] } });
    if (m.params.name === 'evaluate') { if (process.env.FAKE_MCP_LOG) fs.appendFileSync(process.env.FAKE_MCP_LOG, JSON.stringify(m.params.arguments) + '\n'); return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `evaluated ${m.params.arguments?.expression ?? ''}` }] } }); }
  }
  if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: {} });
});
