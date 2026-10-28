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

async function server(t, port, extraEnv = {}) {
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
      POCKET_ACP_STORE: path.join(dir, 'acp-store'), ...extraEnv,
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
  // 1.84.1: each model carries the effort levels OpenCode offers for it (from the boot probe)
  for (const m of [...body.curated, ...body.experimental]) assert.ok(Array.isArray(m.efforts), 'efforts on ' + m.slug);
  const ds = body.curated.find(m => m.slug === 'openrouter/deepseek/deepseek-v4.1-flash-1017');
  if (ds) assert.deepEqual(ds.efforts, ['none', 'low', 'high', 'max']);
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

test('an OpenRouter conversation opens in the app: live (active, stream from 0), then finished (history + list row)', async t => {
  const s = await server(t, 18804);
  const id = (await s.call('/new', { provider: 'acp', cwd: repo, text: 'do the thing' })).body.id;
  const e = encodeURIComponent(id);
  // live: the chat view's GET works and points the stream at the start of the turn
  let live; for (let i = 0; i < 100; i++) { live = await s.call(`/session/${e}`); if (live.status === 200 && live.body.active) break; await sleep(50); }
  assert.equal(live.status, 200, 'GET /api/session/:id serves an OpenRouter conversation: ' + JSON.stringify(live.body));
  assert.equal(live.body.provider, 'acp'); assert.equal(live.body.active, true); assert.equal(live.body.turnEvents, 0);
  assert.equal(live.body.model, 'openrouter/deepseek/deepseek-v4.1-flash-1017');
  let card; for (let i = 0; i < 100 && !card; i++) { card = (await s.call(`/session/${e}/approvals`)).body?.requests?.[0]; if (!card) await sleep(50); }
  await s.call(`/session/${e}/approvals/${card.id}/decision`, { decision: 'allow' });
  for (let i = 0; i < 100; i++) { if (!(await s.call(`/session/${e}`)).body.active) break; await sleep(50); }
  // finished: history comes from session/load, user and assistant both
  const done = (await s.call(`/session/${e}`)).body;
  assert.equal(done.active, false);
  assert.deepEqual(done.messages.map(m => m.role), ['user', 'assistant']);
  assert.equal(done.messages[0].text, 'do the thing'); assert.match(done.messages[1].text, /echo of do the thing/);
  // the assistant message carries `blocks` so the UI (msgHTML) renders it (blank on reopen without them), with the
  // thinking and tool lines in the order the live turn showed them (1.84.2)
  assert.deepEqual(done.messages[1].blocks, [{ t: 'tool', name: 'Thinking', detail: 'Checking with a quick command.' }, { t: 'tool', name: 'Bash', detail: 'echo ACP_OK' }, { t: 'text', text: done.messages[1].text }]);
  assert.equal(done.messages[0].blocks, undefined, 'user messages render from text, no blocks');
  assert.equal(done.title, 'do the thing', 'titled from the agent');
  // and it is in the conversation list, labelled as OpenRouter
  let row; for (let i = 0; i < 60 && !row; i++) { row = (await s.call('/sessions')).body.sessions.find(x => x.id === id); if (!row) await sleep(100); }
  assert.ok(row, 'the finished conversation is in the list'); assert.equal(row.provider, 'acp'); assert.equal(row.title, 'do the thing');
  // an idle stream does not replay history the GET already returned
  const r = await fetch(`http://127.0.0.1:${s.port}/api/session/${e}/events`, { headers: s.headers });
  assert.match(await r.text(), /"type":"idle"/); 
  // the chat view's side panels return empty for OpenRouter instead of 404ing the console
  const ag = await s.call(`/session/${e}/agents`); assert.equal(ag.status, 200); assert.deepEqual(ag.body, { running: 0, agents: [] });
  const rs = await s.call(`/session/${e}/results`); assert.equal(rs.status, 200); assert.equal(rs.body.scannedMessages, 0);
  // unknown OpenRouter ids are a clean 404
  assert.equal((await s.call('/session/' + encodeURIComponent('acp:ses_nope'))).status, 404);
});

// 1.84.1: an OpenRouter conversation waiting on an approval said "Recent" (idle) in the list and the chat, so the
// phone showed Stop with no Allow card. It now reports Needs approval like Claude and Codex, and the turn runs on
// the model and effort the message asked for.
test('an OpenRouter approval shows as Needs approval; the turn runs on the chosen model and effort', async t => {
  const s = await server(t, 18805);
  const id = (await s.call('/new', { provider: 'acp', cwd: path.join(s.dir, 'cwd'), text: 'do the thing', effort: 'high' })).body.id;
  const e = encodeURIComponent(id);
  let card; for (let i = 0; i < 100 && !card; i++) { card = (await s.call(`/session/${e}/approvals`)).body?.requests?.[0]; if (!card) await sleep(50); }
  assert.ok(card, 'approval pending');
  const chat = (await s.call(`/session/${e}`)).body;
  assert.equal(chat.state.kind, 'input'); assert.equal(chat.state.label, 'Needs approval'); assert.equal(chat.state.approvals, 1);
  let row; for (let i = 0; i < 60 && !row; i++) { row = (await s.call('/sessions')).body.sessions.find(x => x.id === id); if (!row) await sleep(100); }
  assert.equal(row?.state.kind, 'input', 'the list row says it needs you: ' + JSON.stringify(row?.state));
  await s.call(`/session/${e}/approvals/${card.id}/decision`, { decision: 'allow' });
  for (let i = 0; i < 100; i++) { if (!(await s.call(`/session/${e}`)).body.active) break; await sleep(50); }
  const store = JSON.parse(fs.readFileSync(path.join(s.dir, 'acp-store', encodeURIComponent(id.slice(4)) + '.json'), 'utf8'));
  assert.deepEqual(store.ranOn, { model: 'openrouter/deepseek/deepseek-v4.1-flash-1017', effort: 'high' });
  assert.equal((await s.call(`/session/${e}`)).body.state.kind, 'finished');
  // an effort the model does not take is dropped by the server, so the model's default runs
  const again = await s.call(`/session/${e}/message`, { text: 'again', effort: 'xhigh' });
  assert.equal(again.status, 202, 'second message: ' + JSON.stringify(again.body));
  card = null; for (let i = 0; i < 100 && !card; i++) { card = (await s.call(`/session/${e}/approvals`)).body?.requests?.[0]; if (!card) await sleep(50); }
  await s.call(`/session/${e}/approvals/${card.id}/decision`, { decision: 'allow' });
  for (let i = 0; i < 100; i++) { if (!(await s.call(`/session/${e}`)).body.active) break; await sleep(50); }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.dir, 'acp-store', encodeURIComponent(id.slice(4)) + '.json'), 'utf8')).ranOn, { model: 'openrouter/deepseek/deepseek-v4.1-flash-1017', effort: 'default' });
});

// 1.84.2: Full access ran every tool call past an approval card (OpenCode is set to ask, and Pocket never passed the
// mode on), and no reply showed its cost. Now Full access answers OpenCode at once and each reply's result carries
// what it cost, kept across a restart of the session through the conversation's saved running total.
test('Full access over HTTP runs without approvals, and each reply reports its own cost', async t => {
  const s = await server(t, 18806, { FAKE_ACP_DELAY_MS: '2000' }); // a reply that waits for nobody must not end before the stream attaches
  const results = [];
  const runTurn = async (pathname, body) => {
    const r = await s.call(pathname, body); assert.equal(r.status, 202, JSON.stringify(r.body));
    const id = r.body.id || decodeURIComponent(pathname.split('/')[2]);
    await readSSE(`http://127.0.0.1:${s.port}/api/session/${encodeURIComponent(id)}/events`, s.headers, ev => { if (ev.type === 'result') results.push(ev); return ev.type === 'done'; });
    return id;
  };
  const id = await runTurn('/new', { provider: 'acp', cwd: path.join(s.dir, 'cwd'), text: 'do the thing', approvalMode: 'full' });
  assert.ok(results[0], 'a result on the stream; server log: ' + s.logs().slice(-1500));
  assert.equal(results[0].ok, true, 'finished with nobody answering: ' + JSON.stringify(results[0]));
  assert.equal(results[0].cost, 0.0021);
  assert.equal((await s.call(`/session/${encodeURIComponent(id)}/approvals`)).body.requests.length, 0);
  await runTurn(`/session/${encodeURIComponent(id)}/message`, { text: 'again', approvalMode: 'full' });
  assert.equal(results[1].cost, 0.0021, 'the second reply alone');
  const store = JSON.parse(fs.readFileSync(path.join(s.dir, 'acp-store', encodeURIComponent(id.slice(4)) + '.json'), 'utf8'));
  assert.equal(store.cost, 0.0042, 'OpenCode\'s running total');
  // and Pocket kept it, so the cost line is right after a restart reopens the session (OpenCode does not report it then)
  let meta; for (let i = 0; i < 40; i++) { try { meta = JSON.parse(fs.readFileSync(path.join(s.dir, 'data', 'session-meta.json'), 'utf8'))[id]; } catch { } if (meta?.acpCost) break; await sleep(50); }
  assert.equal(meta?.acpCost, 0.0042);
});
