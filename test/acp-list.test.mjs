// OpenRouter conversations in the conversation list, over the real server.mjs and the OpenCode stand-in (fake-acp.mjs),
// which answers session/list the way OpenCode 1.19 does: {} lists only the project of the folder it runs in, { cwd }
// only that exact folder, and never more than the newest 100.
//
// The defect (found 2026-11-21): the list was one {} from the server's own folder. Pocket's effort probe makes its
// sessions in a folder inside that project, and once it had made 100 they were the whole answer, all hidden, so the
// list had no OpenRouter conversation at all; and a conversation in a folder of another project was never in it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';

const repo = path.resolve(import.meta.dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE|OPENCODE|FAKE)_/.test(k)));

// The server runs in a folder of its own project (a folder holding a .git), with its data, and so the effort probe's
// folder, inside it: the layout of an install run from its checkout. `seed` writes sessions into the stand-in's store
// before the server starts.
async function server(t, port, { seed = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-list-')), srv = path.join(dir, 'srv'), home = path.join(dir, 'home'), store = path.join(dir, 'acp-store');
  fs.mkdirSync(path.join(srv, '.git'), { recursive: true }); fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(store, { recursive: true });
  const probe = path.join(srv, 'data', 'acp-probe');
  seed?.({ store, probe });
  const secret = 'sek-' + port, exp = Date.now() + 3600_000;
  const headers = { 'content-type': 'application/json', cookie: 'pc_auth=' + exp + '.' + createHmac('sha256', secret).update(String(exp)).digest('hex') };
  const child = spawn(process.execPath, [path.join(repo, 'server.mjs')], {
    cwd: srv, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...cleanEnv(), HOME: home, PORT: String(port), POCKET_SKILLS: '0', POCKET_ENV_FILE: '', POCKET_AUTO_TITLES: '0',
      POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret, POCKET_CODEX: '0',
      POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: srv,
      CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'),
      POCKET_ACP_ENABLE: '1', POCKET_ACP_CMD: process.execPath, POCKET_ACP_ARGS: path.join(repo, 'test/fake-acp.mjs'),
      POCKET_ACP_STORE: store, FAKE_ACP_NO_ASK: '1',
    },
  });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  t.after(() => { try { child.kill('SIGKILL'); } catch { } fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  for (let i = 0; ; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { } if (i > 200) throw new Error('server did not start: ' + logs); await sleep(30); }
  const call = async (p, body) => { const r = await fetch(`http://127.0.0.1:${port}/api${p}`, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch { } return { status: r.status, body: j }; };
  const until = async (fn, ms = 15000, what = 'condition') => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}; log tail: ${logs.slice(-1500)}`); await sleep(50); } };
  const start = async cwd => { const r = await call('/new', { provider: 'acp', cwd, text: 'look around' }); assert.equal(r.status, 202, JSON.stringify(r.body)); return r.body.id; };
  const idle = id => until(async () => { const b = (await call('/session/' + encodeURIComponent(id))).body; return b && b.active === false ? b : null; }, 15000, 'the reply to end');
  const list = async () => (await call('/sessions?limit=200')).body.sessions.filter(s => s.provider === 'acp');
  const probeSessions = () => fs.readdirSync(store).filter(f => f.endsWith('.json')).filter(f => JSON.parse(fs.readFileSync(path.join(store, f), 'utf8')).cwd === probe).length;
  return { dir, store, probe, call, start, idle, list, probeSessions, logs: () => logs };
}
// A session in the stand-in's store, as OpenCode keeps one: its folder, title and last update.
const seedSession = (store, sid, cwd, updatedAt, title = '') => fs.writeFileSync(path.join(store, encodeURIComponent(sid) + '.json'), JSON.stringify({ updates: [], cwd, createdAt: updatedAt, updatedAt, ...(title ? { title, titled: true } : {}) }));

test('with 120 probe sessions in the server\'s folder, conversations in two other folders are both listed', async t => {
  const soon = Date.now() + 3600_000; // newer than anything the test starts, so they are the first 100 of their project
  const s = await server(t, 19050, { seed: ({ store, probe }) => { for (let i = 0; i < 120; i++) seedSession(store, `ses_probe${String(i).padStart(4, '0')}`, probe, soon + i * 1000); } });
  const a = await s.start(repo), b = await s.start(path.join(repo, 'test')); // two folders outside the server's project
  await s.idle(a); await s.idle(b);
  const rows = await s.list();
  assert.ok(rows.some(r => r.id === a && r.cwd === repo), 'the conversation in the first folder is listed: ' + JSON.stringify(rows.map(r => [r.id, r.cwd])));
  assert.ok(rows.some(r => r.id === b && r.cwd === path.join(repo, 'test')), 'the conversation in the second folder is listed');
  assert.ok(rows.every(r => r.cwd !== s.probe), 'no probe session is listed');
  assert.ok(rows.find(r => r.id === a).active === false, 'listed from the program\'s answer, not as a running reply');
  assert.equal(rows.find(r => r.id === b).title, 'look around', 'with the title the program gave it (so from its answer for that folder)');
  // the boot probe opened the newest probe session again instead of making a 121st
  assert.equal(s.probeSessions(), 120, 'the effort probe made no new session');
});

test('a conversation Pocket started stays listed when its folder\'s answer is full; one the program no longer has goes', async t => {
  const s = await server(t, 19051);
  const a = await s.start(repo), c = await s.start(path.join(repo, 'test'));
  await s.idle(a); await s.idle(c);
  // 110 newer conversations in the first folder, started elsewhere: OpenCode's answer for that folder is its newest
  // 100, and the conversation Pocket started is not among them
  const soon = Date.now() + 3600_000;
  for (let i = 0; i < 110; i++) seedSession(s.store, `ses_other${String(i).padStart(4, '0')}`, repo, soon + i * 1000, 'Elsewhere ' + i);
  // the second conversation is gone from the program's store (removed outside Pocket)
  fs.rmSync(path.join(s.store, encodeURIComponent(c.slice(4)) + '.json'));
  await s.idle(await s.start(path.join(repo, 'docs'))); // a reply ending makes the next list read the program again
  const rows = await s.list();
  assert.equal(rows.filter(r => r.cwd === repo && r.id !== a).length, 100, 'the folder\'s own answer, 100 newest');
  const mine = rows.find(r => r.id === a);
  assert.ok(mine, 'the conversation Pocket started is still listed: ' + rows.length + ' rows');
  assert.equal(mine.cwd, repo); assert.ok(mine.mtimeMs > 0, 'with the time Pocket saw it last');
  assert.ok(!rows.some(r => r.id === c), 'a conversation the program answered for in full and no longer has is not listed');
});
