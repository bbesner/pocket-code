// 1.124.5: faults found by the flow tests (lane b) and fixed. Each test failed on the code before its fix.
// Servers listen on port 0 and every child is stopped at the end; every secret here is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const repo = path.resolve(import.meta.dirname, '..');
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// ---------- b-09a: the relay refuses the other capture tools after a fill ----------
async function relayCtx(t, extraEnv = {}) {
  const dir = tmp('pc-flowsb-relay-'), data = path.join(dir, 'data'); fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'cli-token'), 'sample-cli-token-0001\n');
  const daemon = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, values: Object.fromEntries((body.refs || []).map(r => [r, 'Made-up-Secret-77'])) }));
    });
  });
  await new Promise(ok => daemon.listen(0, '127.0.0.1', ok));
  const p = spawn(process.execPath, [path.join(repo, 'scripts/pocket-mcp-proxy.mjs'), '--name', 'browser', '--', process.execPath, path.join(repo, 'test/fake-mcp.mjs')],
    { cwd: dir, env: { PATH: process.env.PATH, POCKET_ENV_FILE: path.join(dir, 'absent.env'), POCKET_DATA_DIR: data, POCKET_URL: `http://127.0.0.1:${daemon.address().port}`, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map(); readline.createInterface({ input: p.stdout }).on('line', l => { const m = JSON.parse(l); waiting.get(m.id)?.(m); });
  let n = 0; const rpc = (method, params) => new Promise(res => { const id = ++n; waiting.set(id, res); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  t.after(async () => { if (p.exitCode === null) { const e = new Promise(r => p.once('exit', r)); p.kill('SIGKILL'); await e; } daemon.closeAllConnections(); await new Promise(ok => daemon.close(ok)); fs.rmSync(dir, { recursive: true, force: true }); });
  return { rpc };
}

test('b-09a: after a fill the relay refuses run_code, video, tracing and annotate like a screenshot; evaluate and snapshots still run', async t => {
  const { rpc } = await relayCtx(t, { POCKET_VAULT_PICTURE_TOOLS: 'shot' });
  const capture = ['browser_run_code_unsafe', 'browser_start_video', 'browser_stop_video', 'browser_start_tracing', 'browser_stop_tracing', 'browser_annotate'];
  // Before a fill they pass through (fake-mcp answers an unknown tool with an empty result).
  let r = await rpc('tools/call', { name: 'browser_start_video', arguments: {} }); assert.deepEqual(r.result, {}, 'passes before a fill');
  r = await rpc('tools/call', { name: 'type', arguments: { text: '{{vault:p}}' } }); assert.equal(r.result.isError, undefined, JSON.stringify(r.result));
  for (const tool of capture) {
    r = await rpc('tools/call', { name: tool, arguments: { code: 'async (page) => (await page.screenshot()).toString("base64")' } });
    assert.equal(r.result.isError, true, `${tool} refused after a fill`);
    assert.equal(r.result.content[0].text, `Pocket: ${tool} was not taken: a Vault value was typed into this browser session, so no screenshot, PDF or other picture of it is made for the rest of the session (a value cannot be scrubbed out of a picture, and the browser tool would save it to a file). Use text snapshots instead.`);
  }
  r = await rpc('tools/call', { name: 'shot', arguments: {} }); assert.equal(r.result.isError, true, 'POCKET_VAULT_PICTURE_TOOLS still adds to the list');
  r = await rpc('tools/call', { name: 'evaluate', arguments: { expression: 'document.title' } }); assert.equal(r.result.content[0].text, 'evaluated document.title', 'evaluate is not refused');
  r = await rpc('tools/call', { name: 'browser_snapshot', arguments: {} }); assert.equal(r.result.isError, undefined, 'a text snapshot is not refused');
  assert.match(r.result.content[0].text, /\{\{vault:p\}\}/, 'and the value in it is scrubbed');
});
