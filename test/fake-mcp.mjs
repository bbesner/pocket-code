#!/usr/bin/env node
// Test-only stdio MCP server: `type` records what it received (FAKE_MCP_LOG) and echoes it like Playwright's generated
// code does; `peek` returns the last typed text without being given it, like a page snapshot showing a filled field
// (and, 1.73.5, every text typed so far, the last one as a number and as an object key); `shot` returns an image and a
// blob resource, like a screenshot; `evaluate` echoes an expression, like browser_evaluate. 1.124.2: `browser_take_screenshot`
// does what @playwright/mcp (0.0.86) does: it always saves the picture to a file (`filename`, else
// .playwright-mcp/page-<time>.png in its folder) and names the file in a text item, adding the image only without a filename. The typed text goes to
// stderr in two chunks. 1.124.3: `browser_snapshot` is the page's text (the last typed text in its field), like
// @playwright/mcp's: inline, or with `filename` saved to that file and only the file named in the answer. `initialize` lists which Pocket variables the server inherited. FAKE_MCP_STUBBORN=1 ignores SIGTERM.
// 1.124.4: FAKE_MCP_SLOW_SHOT=<ms> makes `browser_take_screenshot` take that long while other calls go on, as Playwright
// MCP runs calls side by side, and save the page as it is when it finishes (its text stands in for the pixels).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
let last = ''; const history = [];
const SLOW_SHOT = Number(process.env.FAKE_MCP_SLOW_SHOT) || 0;
const send = o => process.stdout.write(JSON.stringify(o) + '\n');
if (process.env.FAKE_MCP_STUBBORN === '1') process.on('SIGTERM', () => {});
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fe0d7a0b5a0000000049454e44ae426082', 'hex').toString('base64');
readline.createInterface({ input: process.stdin }).on('line', l => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' }, env: Object.keys(process.env).filter(k => /^(POCKET_|VAPID_)/.test(k)).sort() } });
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'type', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }, { name: 'peek', inputSchema: { type: 'object' } }, { name: 'shot', inputSchema: { type: 'object' } }, { name: 'evaluate', inputSchema: { type: 'object', properties: { expression: { type: 'string' } } } }, { name: 'browser_take_screenshot', inputSchema: { type: 'object', properties: { filename: { type: 'string' } } } }, { name: 'browser_snapshot', inputSchema: { type: 'object', properties: { filename: { type: 'string' } } } }] } });
  if (m.method === 'tools/call') {
    if (m.params.name === 'type') {
      last = String(m.params.arguments?.text ?? ''); history.push(last);
      if (process.env.FAKE_MCP_LOG) fs.appendFileSync(process.env.FAKE_MCP_LOG, JSON.stringify(m.params.arguments) + '\n');
      process.stderr.write('typing ' + last.slice(0, 3)); setTimeout(() => process.stderr.write(last.slice(3) + '\n'), 30);
      return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `await page.getByLabel('Password').fill('${last}');` }] } });
    }
    if (m.params.name === 'peek') return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `- textbox "Password": ${last}` }], structuredContent: { value: last, history: [...history], asNumber: /^\d+$/.test(last) ? Number(last) : null, byText: { [last]: true } } } });
    if (m.params.name === 'shot') return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'image', data: PNG, mimeType: 'image/png' }, { type: 'resource', resource: { uri: 'file:///shot.png', mimeType: 'image/png', blob: PNG } }, { type: 'text', text: 'Took a screenshot' }] } });
    if (m.params.name === 'browser_take_screenshot') {
      const name = m.params.arguments?.filename || path.join('.playwright-mcp', `page-${Date.now()}.png`);
      const take = () => {
        fs.mkdirSync(path.dirname(path.resolve(name)), { recursive: true }); fs.writeFileSync(name, SLOW_SHOT ? `- textbox "Password": ${last}\n` : Buffer.from(PNG, 'base64'));
        const link = { type: 'text', text: `### Result\n- [Screenshot of viewport](./${name})\n### Ran Playwright code\nawait page.screenshot({ path: '${name}' });` };
        send({ jsonrpc: '2.0', id: m.id, result: { content: m.params.arguments?.filename ? [link] : [link, { type: 'image', data: PNG, mimeType: 'image/png' }] } });
      };
      return void (SLOW_SHOT ? setTimeout(take, SLOW_SHOT) : take());
    }
    if (m.params.name === 'browser_snapshot') {
      const page = `- textbox "Password": ${last}`, name = m.params.arguments?.filename;
      if (name) { fs.writeFileSync(name, page + '\n'); return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `### Page\n- [Snapshot](./${name})` }] } }); }
      return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `### Snapshot\n${page}` }] } });
    }
    if (m.params.name === 'evaluate') { if (process.env.FAKE_MCP_LOG) fs.appendFileSync(process.env.FAKE_MCP_LOG, JSON.stringify(m.params.arguments) + '\n'); return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `evaluated ${m.params.arguments?.expression ?? ''}` }] } }); }
  }
  if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: {} });
});
