// Server-level integration of the ACP engine: boots the real server.mjs with the engine enabled
// and pointed at the fake ACP agent (no model/network), then drives the actual HTTP endpoints —
// /api/new (provider:'acp'), the SSE event stream, the approvals endpoint, and /api/acp/models.
// Proves the server wiring (dispatch, SSE bridge, ApprovalInbox via /approvals, picker) end to end.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';

const repo = path.resolve(import.meta.dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE)_/.test(k)));

async function server(t, port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-http-'));
  fs.mkdirSync(path.join(dir, 'cwd'), { recursive: true });
  const secret = 'sek-' + port;
  const exp = Date.now() + 3600_000;
  const headers = { 'content-type': 'application/json', cookie: 'pc_auth=' + exp + '.' + createHmac('sha256', secret).update(String(exp)).digest('hex') };
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: repo, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...cleanEnv(), PORT: String(port), POCKET_SKILLS: '0', POCKET_ENV_FILE: '', POCKET_AUTO_TITLES: '0',
      POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret, POCKET_CODEX: '0',
      POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: path.join(dir, 'data'),
      CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'),
      // ACP engine on, pointed at the fake agent
      POCKET_ACP_ENABLE: '1', POCKET_ACP_CMD: process.execPath, POCKET_ACP_ARGS: path.join(repo, 'test/fake-acp.mjs'),
      POCKET_ACP_STORE: path.join(dir, 'acp-store'),
    },
  });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  t.after(() => { try { child.kill('SIGKILL'); } catch { } fs.rmSync(dir, { recursive: true, force: true }); });
  for (let i = 0; ; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { } if (i > 150) throw new Error('server did not start: ' + logs); await sleep(30); }
  const call = async (p, body, method) => { const r = await fetch(`http://127.0.0.1:${port}/api${p}`, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch { } return { status: r.status, body: j }; };
  return { dir, port, headers, call, logs: () => logs };
}

// Read the SSE stream, calling onEvent for each parsed event; resolves when onEvent returns true or on timeout.
async function readSSE(url, headers, onEvent, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    let buf = '';
    for await (const chunk of r.body) {
      buf += Buffer.from(chunk).toString();
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = block.split('\n').find(l => l.startsWith('data:'));
        if (!line) continue;
        let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (await onEvent(ev)) { clearTimeout(timer); ctrl.abort(); return; }
      }
    }
  } catch { /* aborted */ } finally { clearTimeout(timer); }
}

test('/api/acp/models reports enabled + curated DeepSeek (catalog may be offline → tiers empty)', async t => {
  const s = await server(t, 18801);
  const { status, body } = await s.call('/acp/models');
  assert.equal(status, 200);
  assert.equal(body.enabled, true, 'engine reports enabled');
  assert.equal(body.defaultModel, 'openrouter/deepseek/deepseek-v4.1-flash-1017');
  assert.ok(Array.isArray(body.curated) && Array.isArray(body.experimental));
});

test('new acp session: start → SSE stream → approval card → allow → assistant reply → done', async t => {
  const s = await server(t, 18802);
  const start = await s.call('/new', { provider: 'acp', cwd: path.join(s.dir, 'cwd'), text: 'do the thing' });
  assert.equal(start.status, 202, 'started: ' + JSON.stringify(start.body));
  const id = start.body.id;
  assert.ok(id.startsWith('acp:'), 'got an acp session id');

  let decided = false, sawDelta = false, sawAssistant = false, result = null;
  await readSSE(`http://127.0.0.1:${s.port}/api/session/${encodeURIComponent(id)}/events`, s.headers, async ev => {
    if (ev.type === 'delta') sawDelta = true;
    if (ev.type === 'assistant') sawAssistant = true;
    if (ev.type === 'approvals' && !decided) {
      const list = await s.call(`/session/${encodeURIComponent(id)}/approvals`);
      const card = list.body?.requests?.[0];
      if (card) { decided = true; await s.call(`/session/${encodeURIComponent(id)}/approvals/${card.id}/decision`, { decision: 'allow' }); }
    }
    if (ev.type === 'result') result = ev;
    return ev.type === 'done';
  });
  assert.ok(decided, 'an approval card was surfaced and allowed over HTTP');
  assert.ok(sawDelta, 'streamed a delta over SSE');
  assert.ok(sawAssistant, 'assistant message streamed');
  assert.ok(result && result.stopReason === 'end_turn', 'turn finished end_turn: ' + JSON.stringify(result));
});

test('stop a running acp turn over HTTP', async t => {
  const s = await server(t, 18803);
  const start = await s.call('/new', { provider: 'acp', cwd: path.join(s.dir, 'cwd'), text: 'do the thing' });
  const id = start.body.id;
  // wait until the approval card is pending (turn is live), then stop
  let ok = false;
  for (let i = 0; i < 100; i++) { const l = await s.call(`/session/${encodeURIComponent(id)}/approvals`); if (l.body?.requests?.length) { ok = true; break; } await sleep(50); }
  assert.ok(ok, 'turn became live');
  const stop = await s.call(`/session/${encodeURIComponent(id)}/stop`, {});
  assert.equal(stop.status, 200);
  assert.equal(stop.body.ok, true);
});
