// Antigravity over the real server.mjs and its HTTP API, against the stand-in for `agy acp` (fake-agy.mjs): off unless
// the server turns it on, the model menu (the plan's models, the plan's name, signed in or not), a reply from start to
// history and the conversation list, how agy was started (no API key, as Pocket Code, the CLI's own MCP servers), a
// reply that waits for a background command, and Pause all. What it shares with every engine is in engine-parity.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';

const repo = path.resolve(import.meta.dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE|OPENCODE|GEMINI|GOOGLE)_/.test(k)));

async function server(t, port, extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-http-')), home = path.join(dir, 'home'), cwd = path.join(home, 'work');
  fs.mkdirSync(cwd, { recursive: true });
  const secret = 'sek-' + port, exp = Date.now() + 3600_000;
  const headers = { 'content-type': 'application/json', cookie: 'pc_auth=' + exp + '.' + createHmac('sha256', secret).update(String(exp)).digest('hex') };
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: repo, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...cleanEnv(), HOME: home, PORT: String(port), POCKET_SKILLS: '0', POCKET_ENV_FILE: '', POCKET_AUTO_TITLES: '0',
      POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret, POCKET_CODEX: '0',
      POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: path.join(dir, 'data'),
      CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'),
      POCKET_AGY_ENABLE: '1', POCKET_AGY_CMD: path.join(repo, 'test/fake-agy.mjs'), FAKE_AGY_STORE: path.join(dir, 'agy-store'),
      FAKE_AGY_SIGNED_OUT: path.join(dir, 'signed-out'), ...extraEnv,
    },
  });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  t.after(() => { try { child.kill('SIGKILL'); } catch { } fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }); // an agy process may still be writing as it exits
  for (let i = 0; ; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { } if (i > 200) throw new Error('server did not start: ' + logs); await sleep(30); }
  const call = async (p, body, method) => { const r = await fetch(`http://127.0.0.1:${port}/api${p}`, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch { } return { status: r.status, body: j }; };
  const until = async (fn, ms = 12000, what = 'condition') => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}; log tail: ${logs.slice(-1500)}`); await sleep(50); } };
  const session = id => call('/session/' + encodeURIComponent(id)).then(r => r.body);
  const idle = id => until(async () => { const b = await session(id); return b && b.active === false ? b : null; }, 15000, 'the reply to end');
  const stored = id => JSON.parse(fs.readFileSync(path.join(dir, 'agy-store', `session-${id.slice(4)}.json`), 'utf8'));
  const launch = () => JSON.parse(fs.readFileSync(path.join(dir, 'agy-store', 'launch.json'), 'utf8'));
  return { dir, home, cwd, port, headers, call, until, session, idle, stored, launch, logs: () => logs };
}

test('off unless the server turns it on: no agent, no model menu, no start', async t => {
  const s = await server(t, 18861, { POCKET_AGY_ENABLE: '' });
  assert.deepEqual((await s.call('/antigravity/models')).body, { enabled: false, signedIn: false, models: [] });
  const r = await s.call('/new', { provider: 'antigravity', cwd: s.cwd, text: 'hello' });
  assert.equal(r.status, 400); assert.equal(r.body.error, 'the Antigravity engine is not enabled on this box');
  assert.equal((await s.call('/session/' + encodeURIComponent('agy:0b9c2a44-6a51-4c0e-9d6e-3f1a1d7c9e10'))).status, 404);
  assert.ok(!('antigravity' in (await s.call('/pause')).body.would.replies), 'Pause all does not count an agent this server does not run');
  assert.ok(!fs.existsSync(path.join(s.dir, 'agy-store')), 'agy was never started');
});

test('the model menu: the plan\'s models and name; the server\'s default model; not signed in says how to sign in', async t => {
  const s = await server(t, 18862, { POCKET_AGY_MODEL: 'gemini-3.8-flash' });
  const m = (await s.call('/antigravity/models')).body;
  assert.equal(m.enabled, true); assert.equal(m.signedIn, true); assert.equal(m.plan, 'Google AI Pro');
  assert.equal(m.defaultModel, 'gemini-3.8-flash', 'POCKET_AGY_MODEL, since the plan lists it');
  assert.deepEqual(m.models.map(x => [x.id, x.label, x.efforts]), [
    ['gemini-4-neon', 'Gemini 4 Neon', ['low', 'medium', 'high', 'xhigh']], ['gemini-3.8-flash', 'Gemini 3.8 Flash', ['low', 'medium', 'high']], ['claude-opus-5-5', 'Claude Opus 5.5', []]]);
  // a reply on Default runs the server's model
  const id = (await s.call('/new', { provider: 'antigravity', cwd: s.cwd, text: 'hello __NOASK__' })).body.id;
  await s.idle(id);
  assert.equal(s.stored(id).ranOn.model, 'gemini-3.8-flash');
  // signed out on the server: the menu says so, a start is refused with the same instruction, and nothing is queued
  fs.writeFileSync(path.join(s.dir, 'signed-out'), '');
  const out = (await s.call('/antigravity/models?fresh=1')).body;
  assert.equal(out.enabled, true); assert.equal(out.signedIn, false); assert.equal(out.signInCommand, 'agy acp --login'); assert.match(out.message, /not signed in on this server/);
  const refused = await s.call('/new', { provider: 'antigravity', cwd: s.cwd, text: 'hello again' });
  assert.equal(refused.status, 409, JSON.stringify(refused.body)); assert.equal(refused.body.code, 'signin'); assert.match(refused.body.error, /agy acp --login/);
  // signed in again: the next look notices without a restart
  fs.rmSync(path.join(s.dir, 'signed-out'));
  assert.equal((await s.call('/antigravity/models?fresh=1')).body.signedIn, true);
  const back = await s.call('/new', { provider: 'antigravity', cwd: s.cwd, text: 'hello once more __NOASK__' });
  assert.equal(back.status, 202, JSON.stringify(back.body));
  await s.idle(back.body.id);
});

test('a reply from start to history: approval card, the list row, and how agy was started', async t => {
  const mcp = path.join(os.tmpdir(), `agy-mcp-${process.pid}.json`);
  fs.writeFileSync(mcp, JSON.stringify({ mcpServers: { memory: { command: '/usr/bin/mem', args: ['mcp'] } } }));
  t.after(() => fs.rmSync(mcp, { force: true }));
  const s = await server(t, 18863, { GEMINI_API_KEY: 'test-key-not-real', GOOGLE_API_KEY: 'test-key-not-real', POCKET_AGY_MCP_CONFIG: mcp,
    POCKET_AGY_ARGS: '--disable-telemetry --dangerously-skip-permissions --override_user_agent_name codex-cli' });
  assert.match(s.logs(), /POCKET_AGY_ARGS: ignored --dangerously-skip-permissions --override_user_agent_name/);
  const start = await s.call('/new', { provider: 'antigravity', cwd: repo, text: 'do the thing', model: 'gemini-4-neon', effort: 'high', executionMode: 'plan' }); // the list leaves out conversations in /tmp
  assert.equal(start.status, 202, JSON.stringify(start.body));
  const id = start.body.id, e = encodeURIComponent(id);
  assert.match(id, /^agy:[0-9a-f-]{36}$/);
  const card = await s.until(async () => (await s.call(`/session/${e}/approvals`)).body?.requests?.[0], 8000, 'the approval card');
  assert.equal(card.kind, 'command'); assert.equal(JSON.parse(card.details).command, 'echo AGY_OK');
  const live = await s.session(id);
  assert.equal(live.provider, 'antigravity'); assert.equal(live.active, true); assert.equal(live.model, 'gemini-4-neon');
  assert.equal(live.state.kind, 'input'); assert.equal(live.state.label, 'Needs approval');
  assert.equal((await s.call(`/session/${e}/approvals/${card.id}/decision`, { decision: 'allow' })).status, 200);
  const done = await s.idle(id);
  assert.equal(done.state.kind, 'finished');
  assert.deepEqual(done.messages.map(m => m.role), ['user', 'assistant']);
  assert.match(done.messages[1].text, /ran it; heard: do the thing/);
  assert.ok(done.messages[1].blocks.some(b => b.t === 'tool' && b.name === 'Bash' && b.detail === 'echo AGY_OK'), JSON.stringify(done.messages[1].blocks));
  assert.equal(done.projectMode, null);
  const row = await s.until(async () => (await s.call('/sessions')).body.sessions.find(x => x.id === id), 8000, 'the list row');
  assert.equal(row.provider, 'antigravity'); assert.equal(row.title, 'do the thing');
  // how agy was started, and what it was given
  const l = s.launch();
  assert.deepEqual(l.argv, ['acp', '--disable-telemetry'], 'only `agy acp` and the harmless flag');
  assert.deepEqual([l.env.GEMINI_API_KEY, l.env.GOOGLE_API_KEY], [false, false], 'the server\'s Gemini API key did not reach agy');
  assert.equal(l.clientInfo.name, 'pocket-code');
  const st = s.stored(id);
  assert.deepEqual(st.ranOn, { model: 'gemini-4-neon', effort: 'high', mode: 'plan' });
  assert.deepEqual(st.mcpServers, [{ name: 'memory', command: '/usr/bin/mem', args: ['mcp'], env: [] }]);
  assert.match(st.append, /choices/, 'Pocket\'s instructions came with the session');
  assert.ok(st.runnerToken, 'the process knows which conversation it is');
  // the engine config kept with the conversation
  const meta = JSON.parse(fs.readFileSync(path.join(s.dir, 'data', 'session-meta.json'), 'utf8'))[id];
  assert.deepEqual(meta.engineConfig, { engine: 'antigravity', inferenceProvider: 'google', model: 'gemini-4-neon' });
  // a thinking level the model does not take is left out, and the next message runs in work mode again
  assert.equal((await s.call(`/session/${e}/message`, { text: 'again __NOASK__', model: 'gemini-3.8-flash', effort: 'xhigh' })).status, 202);
  await s.until(async () => s.stored(id).prompts.length === 2 && (await s.session(id)).active === false, 8000, 'the second reply');
  assert.deepEqual(s.stored(id).ranOn, { model: 'gemini-3.8-flash', effort: 'low', mode: 'default' });
  // its own commands, without the one that would start work later; no subagents
  const cmds = (await s.call('/commands?provider=antigravity')).body.commands.map(c => c.name);
  assert.ok(cmds.includes('goal') && !cmds.includes('schedule'), JSON.stringify(cmds));
  assert.deepEqual((await s.call(`/session/${e}/agents`)).body, { running: 0, agents: [] });
  assert.equal((await s.call('/session/' + encodeURIComponent('agy:0b9c2a44-6a51-4c0e-9d6e-3f1a1d7c9e10'))).status, 404, 'a conversation agy does not have');
  assert.equal((await s.call('/session/' + encodeURIComponent('agy:ses_nope'))).status, 400, 'not an Antigravity id');
});

test('a background command keeps the reply open until it ends; Pause all counts and stops an Antigravity reply', async t => {
  const s = await server(t, 18864);
  const id = (await s.call('/new', { provider: 'antigravity', cwd: s.cwd, text: 'long job __BG__', approvalMode: 'full' })).body.id;
  const done = await s.idle(id);
  assert.equal(done.state.kind, 'finished');
  assert.match(done.messages.filter(m => m.role === 'assistant').map(m => m.text).join('\n'), /Started it in the background\.[\s\S]*The background command finished: BG_DONE\./);
  // Pause all
  const hang = (await s.call('/new', { provider: 'antigravity', cwd: s.cwd, text: 'wait __HANG__', approvalMode: 'full' })).body.id;
  await s.until(async () => (await s.session(hang))?.active, 8000, 'the reply to start');
  assert.equal((await s.call('/pause')).body.would.replies.antigravity, 1);
  const p = await s.call('/pause', {});
  assert.equal(p.status, 200); assert.equal(p.body.stopped.replies.antigravity, 1);
  const stopped = await s.idle(hang);
  assert.equal(stopped.state.kind, 'stopped');
  assert.match(s.logs(), new RegExp(`stop requested \\(Pause all\\) session=${hang}`));
});

test('a reply that ends while its conversation is being read: the read says it ended, with the reply in it', async t => {
  // The app reads the conversation again right after a message goes into a running reply. That read asks the CLI for
  // the history, which takes a moment; a reply that ended meanwhile used to come back as still running, with the
  // history cut before it, and the app then showed neither the reply nor that it was over.
  const s = await server(t, 18865, { FAKE_AGY_HISTORY_DELAY_MS: '2500' });
  const start = await s.call('/new', { provider: 'antigravity', cwd: repo, text: 'a look __SLOW__ __NOASK__' });
  assert.equal(start.status, 202, JSON.stringify(start.body));
  const id = start.body.id;
  const read = await s.session(id); // begun while the reply runs (1.5 s); the history takes 2.5 s
  assert.equal(read.active, false, 'the reply ended during the read, and the read says so');
  assert.ok(read.messages.some(m => m.role === 'assistant' && /ran it; heard: a look/.test(m.text || '')), 'the reply is in what was read: ' + JSON.stringify(read.messages.map(m => [m.role, (m.text || '').slice(0, 40)])));
  assert.equal(read.messages.filter(m => m.role === 'user').length, 1, 'your message shows once');
  // and what is kept for the next read is the whole conversation
  const again = await s.session(id);
  assert.equal(again.active, false); assert.equal(again.messages.length, read.messages.length);
});

test('a list read that began before a conversation did is not kept as the current list', async t => {
  // The list is asked of the CLI and kept for 15 seconds. A read on its way when a conversation begins answers
  // without it; kept as current, the list went without the new conversation until the 15 seconds were up.
  const s = await server(t, 18867, { FAKE_AGY_LIST_DELAY_MS: '2000' });
  const early = s.call('/sessions'); // asks the CLI now; the answer (nothing yet) comes in two seconds
  await sleep(700);
  const start = await s.call('/new', { provider: 'antigravity', cwd: repo, text: 'quick one __NOASK__' });
  assert.equal(start.status, 202, JSON.stringify(start.body));
  const id = start.body.id;
  await early;
  await s.idle(id);
  const list = (await s.call('/sessions')).body.sessions;
  assert.ok(list.some(x => x.id === id), 'the next read of the list has the conversation: ' + JSON.stringify(list.map(x => x.id)));
});
