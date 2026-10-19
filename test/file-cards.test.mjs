// 1.61 files in the conversation: results know a file was handed over in a reply (inText); the artifact route shows a
// readable file inline and pictures a PDF; a reply's files are kept in Files once when auto-keep (or Assistant mode)
// is on. Fake CLIs only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {collectResults} from '../results.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));

test('results: a file named in a reply is inText; one only written by a tool is not', () => {
  const msgs = [{ role: 'assistant', ts: 't1', blocks: [{ t: 'tool', name: 'Write', detail: '/home/u/work/draft.md' }, { t: 'tool', name: 'Write', detail: '/home/u/work/deck.pdf' }] },
    { role: 'assistant', ts: 't2', blocks: [{ t: 'text', text: 'Done: [the deck](/home/u/work/deck.pdf) and `/home/u/work/sheet.xlsx`\n/home/u/work/notes.md\n' }] }];
  const r = Object.fromEntries(collectResults(msgs).results.map(x => [x.target, x]));
  assert.equal(r['/home/u/work/draft.md'].inText, undefined);
  assert.equal(r['/home/u/work/deck.pdf'].inText, true); assert.equal(r['/home/u/work/deck.pdf'].at, 't2');
  assert.equal(r['/home/u/work/sheet.xlsx'].inText, true);
  assert.equal(r['/home/u/work/notes.md'].inText, true);
});

async function server(t, port, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-cards-')); let logs = '';
  const secret = randomUUID(), exp = Date.now() + 3600000;
  const headers = { 'content-type': 'application/json', cookie: 'pc_auth=' + exp + '.' + createHmac('sha256', secret).update(String(exp)).digest('hex') };
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
  const child = spawn(process.execPath, ['server.mjs'], { cwd: repo, env: { ...cleanEnv(), POCKET_SKILLS: '0', PORT: String(port), POCKET_ENV_FILE: '', POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret,
    POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: path.join(dir, 'data'), POCKET_DOCUMENTS_DIR: path.join(dir, 'docs'), POCKET_TEST_CALLS: path.join(dir, 'calls'),
    CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'), CODEX_BIN: path.join(repo, 'test/fake-codex.mjs'), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', b => { logs += b }); child.stderr.on('data', b => { logs += b });
  t.after(async () => { if (child.exitCode === null) { const e = new Promise(r => child.once('exit', r)); child.kill(); await e; } fs.rmSync(dir, { recursive: true, force: true }); });
  for (let i = 0; i < 100; i++) { if (child.exitCode !== null) break; try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { } await sleep(30); }
  if (child.exitCode !== null) throw Error('Test server failed: ' + logs);
  const base = `http://127.0.0.1:${port}`;
  const call = async (p, body) => { const r = await fetch(base + '/api' + p, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const raw = p => fetch(base + '/api' + p, { headers });
  return { dir, call, raw, logs: () => logs };
}
const waitIdle = async (s, id) => { for (let i = 0; i < 100; i++) { const r = (await s.call('/sessions')).body.sessions.find(x => x.id === id); if (r && r.state?.kind !== 'running') return r; await sleep(100); } };

test('a reply\'s file: inline view for readable files, a PDF picture or 404, and auto-keep once per file', async t => {
  const s = await server(t, 18678, {});
  const work = fs.mkdtempSync(path.join(os.homedir(), 'pocket-cards-test-')); t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const html = path.join(work, 'page.html'), doc = path.join(work, 'Village-deck.pptx');
  fs.writeFileSync(html, '<h1>Hi</h1><script>danger()</script>'); fs.writeFileSync(doc, 'not really a deck');
  await s.call('/settings', { documents: true, autoKeepFiles: true });
  assert.equal((await s.call('/settings')).body.autoKeepActive, true);

  const started = await s.call('/new', { cwd: repo, text: '__FILE__ ' + doc, provider: 'claude', clientMessageId: randomUUID() });
  assert.ok([200, 202].includes(started.status)); const id = started.body.id;
  await waitIdle(s, id); await sleep(500);
  const kept = () => s.call('/documents').then(r => r.body.documents.filter(d => d.session === id));
  let mine = await kept();
  assert.equal(mine.length, 1, 'the reply\'s file is kept'); assert.equal(mine[0].source, doc); assert.equal(mine[0].addedBy, 'session');
  const res = (await s.call(`/session/${id}/results`)).body.results.find(r => r.target === doc);
  assert.equal(res.inText, true);

  // A second reply naming the same file keeps nothing new.
  await s.call(`/session/${id}/message`, { text: '__FILE__ ' + doc, clientMessageId: randomUUID() });
  await waitIdle(s, id); await sleep(500);
  assert.equal((await kept()).length, 1, 'kept once');

  // Inline and picture: an Office file has neither; it stays a download.
  const url = p => `/session/${id}/artifact?path=${encodeURIComponent(p)}`;
  const office = await s.raw(url(doc) + '&inline=1'); assert.match(office.headers.get('content-disposition'), /^attachment/);
  assert.equal((await s.raw(url(doc) + '&thumb=1')).status, 404);

  // An HTML file handed over in another conversation: shown inline, still sandboxed; never pictured.
  const second = (await s.call('/new', { cwd: repo, text: '__FILE__ ' + html, provider: 'claude', clientMessageId: randomUUID() })).body.id;
  await waitIdle(s, second);
  const page = await s.raw(`/session/${second}/artifact?path=${encodeURIComponent(html)}&inline=1`);
  assert.equal(page.status, 200); assert.match(page.headers.get('content-disposition'), /^inline/); assert.match(page.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await s.raw(`/session/${second}/artifact?path=${encodeURIComponent(html)}&thumb=1`)).status, 404, 'an agent-made page is not rendered on the server');
  assert.equal((await s.raw(`/session/${id}/artifact?path=${encodeURIComponent(html)}&inline=1`)).status, 403, 'only files this conversation handed over');

  // Auto-keep off and not in Assistant mode: nothing new is kept.
  await s.call('/settings', { autoKeepFiles: false });
  const third = (await s.call('/new', { cwd: repo, text: '__FILE__ ' + doc, provider: 'claude', clientMessageId: randomUUID() })).body.id;
  await waitIdle(s, third); await sleep(500);
  assert.equal((await s.call('/documents')).body.documents.filter(d => d.session === third).length, 0);
});
