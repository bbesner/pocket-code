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
import { readAcpList } from '../acp.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE|OPENCODE|FAKE)_/.test(k)));

// The server runs in a folder of its own project (a folder holding a .git), with its data, and so the effort probe's
// folder, inside it: the layout of an install run from its checkout. `seed` writes sessions into the stand-in's store
// before the server starts.
// `outsideTmp`: the test's folders sit outside /tmp (in node_modules/.cache, ignored by git), so the list route's own
// rule that hides finished conversations in /tmp folders cannot hide a row the guard under test should hide.
// `homeInSrv`: home is a folder of the server's project, so the reader's {} (asked from home) covers that project,
// the probe's folder included. `env`: more settings for the server and the stand-in.
async function server(t, port, { seed = null, outsideTmp = false, homeInSrv = false, env = {} } = {}) {
  const base = outsideTmp ? path.join(repo, 'node_modules', '.cache') : os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'acp-list-')), srv = path.join(dir, 'srv'), home = homeInSrv ? path.join(srv, 'home') : path.join(dir, 'home'), store = path.join(dir, 'acp-store');
  fs.mkdirSync(path.join(srv, '.git'), { recursive: true }); fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(store, { recursive: true });
  const probe = path.join(srv, 'data', 'acp-probe');
  seed?.({ store, probe, srv, home });
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
      POCKET_ACP_STORE: store, FAKE_ACP_NO_ASK: '1', ...env,
    },
  });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  t.after(() => { try { child.kill('SIGKILL'); } catch { } fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  for (let i = 0; ; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { } if (i > 200) throw new Error('server did not start: ' + logs); await sleep(30); }
  const call = async (p, body) => { const r = await fetch(`http://127.0.0.1:${port}/api${p}`, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch { } return { status: r.status, body: j }; };
  const until = async (fn, ms = 15000, what = 'condition') => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}; log tail: ${logs.slice(-1500)}`); await sleep(50); } };
  const start = async (cwd, text = 'look around') => { const r = await call('/new', { provider: 'acp', cwd, text }); assert.equal(r.status, 202, JSON.stringify(r.body)); return r.body.id; };
  const idle = id => until(async () => { const b = (await call('/session/' + encodeURIComponent(id))).body; return b && b.active === false ? b : null; }, 15000, 'the reply to end');
  const list = async () => (await call('/sessions?limit=200')).body.sessions.filter(s => s.provider === 'acp');
  const probeSessions = () => fs.readdirSync(store).filter(f => f.endsWith('.json')).filter(f => JSON.parse(fs.readFileSync(path.join(store, f), 'utf8')).cwd === probe).length;
  return { dir, store, probe, srv, home, call, start, idle, list, until, probeSessions, logs: () => logs };
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

// ---------- hardened 2026-11-22: the guards the review found untested, and the list's time bounds ----------
test('the probe folder stays hidden, and a folder only the whole-project read can find is listed (folders outside /tmp)', async t => {
  const soon = Date.now() + 3600_000;
  const s = await server(t, 19052, { outsideTmp: true, homeInSrv: true, seed: ({ store, probe, srv }) => {
    for (let i = 0; i < 20; i++) seedSession(store, `ses_probe${String(i).padStart(4, '0')}`, probe, soon + i * 1000);
    const elsewhere = path.join(srv, 'elsewhere'); fs.mkdirSync(elsewhere, { recursive: true });
    seedSession(store, 'ses_found', elsewhere, soon - 1000, 'Found by the project read');
  } });
  assert.ok(!s.probe.startsWith('/tmp/'), 'the probe folder is outside /tmp');
  const rows = await s.until(async () => { const r = await s.list(); return r.some(x => x.id === 'acp:ses_found') ? r : null; }, 8000, 'the folder found by {} to be listed');
  assert.equal(rows.find(r => r.id === 'acp:ses_found').cwd, path.join(s.srv, 'elsewhere'));
  assert.ok(rows.every(r => r.cwd !== s.probe), 'no probe session is listed: ' + rows.filter(r => r.cwd === s.probe).length);
});

test('a reply ending makes the next list read the program again (no 15-second wait)', async t => {
  const s = await server(t, 19053);
  const a = await s.start(repo, 'look around __SLOW__'); // the reply runs about 1.5 s
  await s.list(); // the read a start triggers happens now, while the reply runs; the cache is fresh after it
  seedSession(s.store, 'ses_meanwhile', repo, Date.now(), 'Started elsewhere meanwhile');
  await s.idle(a);
  await s.until(async () => (await s.list()).some(r => r.id === 'acp:ses_meanwhile'), 5000, 'the conversation started meanwhile to be listed (the cache would hold for 15 s)');
});

test('the list never waits on a stuck OpenCode longer than its short bound, and the read ends at its deadline', async t => {
  // OpenCode's whole-project question never answers; the read's deadline is 4 s here (25 s by default)
  const s = await server(t, 19054, { env: { FAKE_ACP_LIST_HANG: '{}', POCKET_ACP_LIST_DEADLINE_MS: '4000' } });
  const a = await s.start(repo); await s.idle(a);
  const t0 = Date.now();
  const first = await s.list();
  const took = Date.now() - t0; t.diagnostic(`the list answered in ${took} ms`);
  assert.ok(took < 3500, `the list answered within the 2 s bound, not the read's 4 s: ${took} ms`);
  assert.ok(first.some(r => r.id === a), 'the conversation Pocket just ran is listed while the read is on its way');
  // the read gives up on {} at its deadline and uses the folders' answers: the row now comes from the program
  await s.until(async () => (await s.list()).find(r => r.id === a)?.title === 'look around', 12000, 'the folders\' answers to be used after the deadline');
  assert.match(s.logs(), /not everything answered in time/);
});

// ---------- 1.122.1: sessions that were never used ----------
// Found rolling out 1.122.0: another program on an install made empty OpenCode sessions in one folder (two every six
// hours, never used), and the per-folder read listed each as "(untitled conversation)" and spent a title call on it.
// OpenCode names a session "New session - <iso time>" until it titles it; an empty one is never updated, so its last
// update is within 1 ms of the time in its title, and a used one that kept the default title was updated at least
// 88 ms after it. These read the list straight from acp.readAcpList over the stand-in.
const FAKE = path.join(repo, 'test', 'fake-acp.mjs');
function unusedStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-unused-')), folder = path.join(dir, 'work'), store = path.join(dir, 'store');
  fs.mkdirSync(folder); fs.mkdirSync(store);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { folder, store };
}
// A session OpenCode never titled: its default title carries createdAt; `fields` may move its last update.
const seedUntitled = (store, sid, cwd, createdAt, fields = {}) => fs.writeFileSync(path.join(store, encodeURIComponent(sid) + '.json'), JSON.stringify({ updates: [], cwd, createdAt, updatedAt: createdAt, ...fields }));
const readList = (s, opts = {}) => readAcpList({ cmd: process.execPath, args: [FAKE], env: { ...cleanEnv(), POCKET_ACP_STORE: s.store }, cwd: s.folder, runtime: 'opencode', folders: [s.folder], ...opts });

test('1.122.1: a never-used session Pocket did not start is not listed', async t => {
  const s = unusedStore(t), T = Date.now() - 3600_000;
  seedUntitled(s.store, 'ses_empty', s.folder, T);
  seedSession(s.store, 'ses_real', s.folder, T + 1000, 'Real work');
  const { rows } = await readList(s);
  assert.ok(rows.some(r => r.id === 'acp:ses_real'), 'the folder was read: ' + JSON.stringify(rows.map(r => r.id)));
  assert.ok(!rows.some(r => r.id === 'acp:ses_empty'), 'the never-used session is left out');
});

test('1.122.1: a never-used session Pocket started is still listed', async t => {
  const s = unusedStore(t), T = Date.now() - 3600_000;
  seedUntitled(s.store, 'ses_empty', s.folder, T);
  const { rows } = await readList(s, { known: [{ id: 'acp:ses_empty', cwd: s.folder, at: T }] });
  const row = rows.find(r => r.id === 'acp:ses_empty');
  assert.ok(row, 'listed: ' + JSON.stringify(rows));
  assert.equal(row.title, '(untitled conversation)'); assert.equal(row.untitled, true); assert.equal(row.cwd, s.folder);
});

test('1.122.1: a used session that kept the default title is listed, untitled', async t => {
  const s = unusedStore(t), T = Date.now() - 3600_000;
  seedUntitled(s.store, 'ses_seconds', s.folder, T, { updatedAt: T + 4000 });
  seedUntitled(s.store, 'ses_quick', s.folder, T + 10_000, { updatedAt: T + 10_088 }); // the closest a used one came
  const { rows } = await readList(s);
  for (const id of ['acp:ses_seconds', 'acp:ses_quick']) {
    const row = rows.find(r => r.id === id);
    assert.ok(row, id + ' is listed: ' + JSON.stringify(rows.map(r => r.id)));
    assert.equal(row.title, '(untitled conversation)'); assert.equal(row.untitled, true);
  }
});

test('1.122.1: 100 never-used sessions do not use up the limit or crowd out the real one, and the last rows cannot bring them back', async t => {
  const s = unusedStore(t), T = Date.now() - 3600_000;
  for (let i = 0; i < 100; i++) seedUntitled(s.store, `ses_empty${String(i).padStart(4, '0')}`, s.folder, T + i * 1000);
  seedSession(s.store, 'ses_real', s.folder, T + 20_500, 'The real one'); // older than 79 of them: past a limit of 60
  // the rows 1.122.0 made from the same answer (its newest 100: the real one and 99 empties), as `previous`
  const previous = [{ id: 'acp:ses_real', title: 'The real one', untitled: false, cwd: s.folder, mtimeMs: T + 20_500 }];
  for (let i = 1; i < 100; i++) previous.push({ id: `acp:ses_empty${String(i).padStart(4, '0')}`, title: '(untitled conversation)', untitled: true, cwd: s.folder, mtimeMs: T + i * 1000 });
  for (const prev of [[], previous]) {
    const { rows } = await readList(s, { limit: 60, previous: prev });
    assert.deepEqual(rows.map(r => [r.id, r.title]), [['acp:ses_real', 'The real one']], 'only the real one, with ' + prev.length + ' previous rows');
  }
});

test('1.122.1: a default-titled session with a missing or unparsable last update is listed (fail open)', async t => {
  const s = unusedStore(t), T = Date.now() - 3600_000;
  seedUntitled(s.store, 'ses_notime', s.folder, T, { listUpdatedAt: null });
  seedUntitled(s.store, 'ses_badtime', s.folder, T, { listUpdatedAt: 'not a time' });
  const { rows } = await readList(s);
  for (const id of ['acp:ses_notime', 'acp:ses_badtime']) assert.ok(rows.some(r => r.id === id && r.untitled), id + ' is listed: ' + JSON.stringify(rows.map(r => r.id)));
});

test('1.122.1: a listed conversation with no message to title costs no title call', async t => {
  const calls = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-titles-')); t.after(() => fs.rmSync(calls, { recursive: true, force: true }));
  const T = Date.now() - 60_000, titles = () => { try { return fs.readFileSync(path.join(calls, 'c.titles'), 'utf8'); } catch { return ''; } };
  // used (updated 5 s after it was made) but never titled: listed as "(untitled conversation)", with nothing to title
  const s = await server(t, 19055, { env: { POCKET_AUTO_TITLES: '1', POCKET_TEST_CALLS: path.join(calls, 'c') }, seed: ({ store }) => seedUntitled(store, 'ses_quiet', repo, T, { updatedAt: T + 5000 }) });
  await s.until(async () => (await s.list()).some(r => r.id === 'acp:ses_quiet'), 8000, 'the untitled conversation to be listed');
  // a Claude conversation the titler does name, asked for after the row above: its call shows the queue has run past it
  const r = await s.call('/new', { cwd: repo, text: 'name this conversation please' }); assert.equal(r.status, 202, JSON.stringify(r.body));
  await s.until(async () => { await s.call('/sessions?limit=200'); return /name this conversation please/.test(titles()); }, 15000, 'the Claude conversation\'s title call');
  assert.doesNotMatch(titles(), /untitled conversation/, 'no title call for the placeholder');
  assert.equal((await s.list()).find(r => r.id === 'acp:ses_quiet')?.title, '(untitled conversation)');
});
