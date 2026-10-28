// 1.86 Engine parity: one feature checklist, run against every engine. The real server.mjs, with Claude Code
// (test/fake-claude.mjs), Codex (test/fake-codex.mjs) and OpenRouter through OpenCode (test/fake-acp.mjs) all on,
// takes the same requests for each and must behave the same way. A feature added for one engine and not the others
// fails here; an engine that cannot do something lists it false in engines.mjs, and the app hides it there.
//
// Each fake takes the same prompt markers: __SLOW__ (the reply takes a while), __HANG__ (it runs until stopped),
// __CHOICES__ (it ends with a ```choices block), __QUESTION__ (it asks "Which color?" with Blue and Red).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const repo = path.resolve(import.meta.dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ENGINES = ['claude', 'codex', 'acp'];
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE|OPENCODE)_/.test(k)));

async function boot(t, port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-')), home = path.join(dir, 'home'), cwd = path.join(home, 'work'); // inside home: Pocket refuses workspaces outside it
  for (const d of [home, cwd, path.join(home, 'pocket-uploads'), path.join(dir, 'sessions')]) fs.mkdirSync(d, { recursive: true });
  const secret = 'parity-' + port, exp = Date.now() + 3600_000;
  const headers = { 'content-type': 'application/json', cookie: 'pc_auth=' + exp + '.' + createHmac('sha256', secret).update(String(exp)).digest('hex') };
  const child = spawn(process.execPath, ['server.mjs'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...cleanEnv(), HOME: home, PORT: String(port), POCKET_SKILLS: '0', POCKET_ENV_FILE: '', POCKET_AUTO_TITLES: '0', POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret,
    POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: path.join(dir, 'data'), POCKET_TEST_CALLS: path.join(dir, 'calls'),
    CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'), CODEX_BIN: path.join(repo, 'test/fake-codex.mjs'),
    POCKET_ACP_ENABLE: '1', POCKET_ACP_CMD: process.execPath, POCKET_ACP_ARGS: path.join(repo, 'test/fake-acp.mjs'), POCKET_ACP_STORE: path.join(dir, 'acp-store'), POCKET_ASK_POLL_MS: '100',
  } });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  t.after(() => { try { child.kill('SIGKILL'); } catch { } fs.rmSync(dir, { recursive: true, force: true }); });
  for (let i = 0; ; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { } if (i > 200) throw new Error('server did not start: ' + logs); await sleep(30); }
  const call = async (p, body, method) => { const r = await fetch(`http://127.0.0.1:${port}/api${p}`, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch { } return { status: r.status, body: j }; };
  const e = id => encodeURIComponent(id);
  const until = async (fn, ms = 12000, what = 'condition') => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}; log tail: ${logs.slice(-1200)}`); await sleep(60); } };
  const start = async (engine, text, extra = {}) => { const r = await call('/new', { provider: engine, cwd, text, approvalMode: 'full', ...extra }); assert.equal(r.status, 202, `${engine} start: ${JSON.stringify(r.body)}`); return r.body.id; };
  const session = id => call('/session/' + e(id)).then(r => r.body);
  const idle = id => until(async () => { const b = await session(id); return b && !b.active && !['running'].includes(b.state?.kind) ? b : null; }, 15000, 'the reply to end');
  // what the engine itself was given, from each fake's record
  const prompts = engine => {
    if (engine === 'claude') return fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    if (engine === 'codex') return fs.readFileSync(path.join(dir, 'calls.codex'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    return fs.readdirSync(path.join(dir, 'acp-store')).map(f => JSON.parse(fs.readFileSync(path.join(dir, 'acp-store', f), 'utf8'))).flatMap(s => (s.prompts || []).map(text => ({ text, seen: s.seen })));
  };
  const sse = (id, stopOn) => new Promise(resolve => {
    const ctrl = new AbortController(), evs = [], timer = setTimeout(() => { ctrl.abort(); resolve(evs); }, 15000);
    fetch(`http://127.0.0.1:${port}/api/session/${e(id)}/events`, { headers, signal: ctrl.signal }).then(async r => {
      let buf = '';
      for await (const c of r.body) { buf += Buffer.from(c).toString(); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const line = buf.slice(0, i).split('\n').find(l => l.startsWith('data:')); buf = buf.slice(i + 2); if (!line) continue; let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; } evs.push(ev); if (stopOn(ev)) { clearTimeout(timer); ctrl.abort(); return resolve(evs); } } }
    }).catch(() => { clearTimeout(timer); resolve(evs); });
  });
  return { dir, cwd, home, call, e, until, start, session, idle, prompts, sse, logs: () => logs };
}

test('engine parity: the same checklist on Claude Code, Codex and OpenRouter', { timeout: 240_000 }, async t => {
  const s = await boot(t, 18821);
  const features = (await s.call('/engines')).body.engines;
  assert.deepEqual(Object.keys(features).sort(), [...ENGINES].sort(), 'every engine is described');

  for (const engine of ENGINES) {
    await t.test(`${engine}: your message shows while its reply runs`, async () => {
      const id = await s.start(engine, `parity one ${engine} __SLOW__`);
      const live = await s.until(async () => { const b = await s.session(id); return b?.active ? b : null; }, 8000, 'the reply to start');
      assert.ok(live.messages.some(m => m.role === 'user' && m.text.startsWith(`parity one ${engine}`)), `${engine}: ${JSON.stringify(live.messages)}`);
      await s.idle(id);
    });

    await t.test(`${engine}: Pocket's instructions reach it`, async () => {
      if (engine === 'claude') assert.ok(s.prompts('claude').some(c => c.text.startsWith('parity one claude') && c.choices), 'Claude got the suggested-reply instructions');
      else if (engine === 'codex') assert.ok(fs.readFileSync(path.join(s.dir, 'calls.threads'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).some(c => c.choices), 'Codex got them');
      else { const p = s.prompts('acp').find(x => x.text.startsWith('parity one acp')); assert.match(p?.seen?.instructions || '', /choices/, 'OpenRouter got them in its instruction file'); }
    });

    await t.test(`${engine}: a choices block becomes reply buttons`, async () => {
      const id = await s.start(engine, `parity choices ${engine} __CHOICES__`);
      const evs = await s.sse(id, ev => ev.type === 'done' || ev.type === 'idle');
      const blocks = evs.filter(ev => ev.type === 'assistant').flatMap(ev => ev.msg?.blocks || []);
      assert.ok(blocks.some(b => b.t === 'choices' && b.options.includes('Merge and deploy')), `${engine}: ${JSON.stringify(blocks)}`);
      assert.ok(!blocks.some(b => b.t === 'text' && /```choices/.test(b.text)), 'the raw block is not shown as text');
      await s.idle(id);
    });

    await t.test(`${engine}: a queued message runs on the same engine`, async () => {
      const id = await s.start(engine, `parity slow ${engine} __SLOW__`);
      await s.until(async () => (await s.session(id))?.active, 8000, 'the reply to start');
      const q = await s.call(`/session/${s.e(id)}/message`, { text: `parity queued ${engine}`, mode: 'queue', approvalMode: 'full' });
      assert.equal(q.status, 202, JSON.stringify(q.body)); assert.equal(q.body.queued, true);
      await s.until(() => s.prompts(engine).some(c => c.text.startsWith(`parity queued ${engine}`)), 15000, `${engine} to receive the queued message`);
      await s.idle(id);
    });

    await t.test(`${engine}: Stop is a stop, and the queue waits`, async () => {
      const id = await s.start(engine, `parity stop ${engine} __HANG__`);
      await s.until(async () => (await s.session(id))?.active, 8000, 'the reply to start');
      await s.until(() => s.prompts(engine).some(c => c.text.startsWith(`parity stop ${engine}`)), 8000, 'the engine to have the message'); // stopped before it even read it, there is no conversation to keep
      await s.call(`/session/${s.e(id)}/message`, { text: `parity after stop ${engine}`, mode: 'queue', approvalMode: 'full' });
      assert.equal((await s.call(`/session/${s.e(id)}/stop`, {})).status, 200);
      const b = await s.idle(id);
      // stopped, with the queued message held: every engine says "Queue paused" until you start it
      assert.equal(b.state?.kind, 'waiting', `${engine}: ${JSON.stringify(b)}`); assert.equal(b.state.label, 'Queue paused');
      await sleep(800);
      assert.ok(!s.prompts(engine).some(c => c.text.startsWith(`parity after stop ${engine}`)), 'the queued message did not run after Stop');
    });

    await t.test(`${engine}: a question shows as a card and the answer reaches it`, async () => {
      const id = await s.start(engine, `parity question ${engine} __QUESTION__`);
      const q = await s.until(async () => (await s.call(`/session/${s.e(id)}/questions`)).body?.requests?.[0], 10000, 'the question card');
      assert.equal(q.questions[0].question, 'Which color?'); assert.deepEqual(q.questions[0].options.map(o => o.label), ['Blue', 'Red']);
      assert.equal((await s.session(id)).state.kind, 'input', 'the conversation says it needs you');
      const a = await s.call(`/session/${s.e(id)}/questions/${q.id}/answer`, { answers: { [q.questions[0].id]: ['Blue'] } });
      assert.equal(a.status, 200, JSON.stringify(a.body));
      const b = await s.idle(id);
      assert.equal(b.state.kind, 'finished', `${engine}: ${JSON.stringify(b.state)}`);
    });

    await t.test(`${engine}: attachments reach it`, async () => {
      const file = path.join(s.home, 'pocket-uploads', `parity-${engine}.txt`); fs.writeFileSync(file, 'attached');
      const id = await s.start(engine, `parity attach ${engine}`, { attachments: [file] });
      await s.idle(id);
      assert.ok(s.prompts(engine).some(c => c.text.startsWith(`parity attach ${engine}`) && c.text.includes(file)), `${engine} was given the file`);
    });

    await t.test(`${engine}: the Git panel, Results and Search answer`, async () => {
      if (!fs.existsSync(path.join(s.cwd, '.git'))) spawnSync('git', ['init', '-q', s.cwd]);
      const id = await s.start(engine, `parity panels ${engine}`);
      await s.idle(id);
      for (const p of ['workspace', 'results', 'search?q=parity']) { const r = await s.call(`/session/${s.e(id)}/${p}`); assert.equal(r.status, 200, `${engine} ${p}: ${JSON.stringify(r.body)}`); }
    });
  }
});
