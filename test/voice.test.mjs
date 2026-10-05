import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { VoiceService } from '../voice.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const fake = [process.execPath, path.join(repo, 'test/fake-voice.mjs')];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ctx = vm.createContext({}); vm.runInContext(fs.readFileSync(path.join(repo, 'public/voice-text.js'), 'utf8'), ctx);
const V = ctx.VoiceText;
const cleanups = []; const t_after = f => cleanups.push(f); test.after(() => cleanups.forEach(f => f()));

test('spoken text drops code, tables, URLs and long paths; summaries stay short', () => {
  const md = '**Done.** The root cause was an off-by-one in `vec_compact.py`, so the table never compacted.\n\n' +
    'I changed `/home/u/projects/memstem/src/memstem/search.py` and added a test. All 142 tests pass in 1.7.3.\n\n' +
    '| File | Change |\n|---|---|\n| a | b |\n\n```js\nconst secret = 1\n```\n\nSee https://example.com/x for details.';
  const spoken = V.speakable(md);
  assert.doesNotMatch(spoken, /secret|\||https?:|\/home|[*`#]/);
  assert.match(spoken, /search\.py/); assert.match(spoken, /1\.7\.3/);
  assert.equal(V.summary(md), 'Done. The root cause was an off-by-one in vec_compact.py, so the table never compacted. I changed search.py and added a test.');
  const parts = V.chunks('A'.repeat(50) + ', ' + 'b '.repeat(120) + 'end.');
  assert.ok(parts[0].length <= 120 && parts.every(p => p.length <= 221), JSON.stringify(parts.map(p => p.length)));
});

test('phantom phrases on short noise are ignored while waiting for a reply', () => {
  assert.equal(V.isNoise('Thank you.', 0.8), true);
  assert.equal(V.isNoise('you', 1.2), true);
  assert.equal(V.isNoise('Thank you.', 2.5), false, 'a longer, deliberate thank-you is kept');
  assert.equal(V.isNoise('Okay, run it', 0.9), false);
});

test('spoken alerts: who finished, a one-line summary, and what needs you', () => {
  const reply = '**Done.** Updated the reorder report: 42 products are below their reorder level. See the CSV.';
  assert.equal(V.alertText({ title: 'SCK inventory', kind: 'finished', reply }, 'summary'), 'The SCK inventory session finished. Updated the reorder report: 42 products are below their reorder level.');
  assert.equal(V.alertText({ title: 'SCK inventory', kind: 'finished', reply }, 'name'), 'The SCK inventory session finished.');
  assert.equal(V.alertText({ title: 'DAD bug 41 session', kind: 'input', approvals: 1 }, 'summary'), 'The DAD bug 41 session needs your approval.');
  assert.equal(V.alertText({ title: 'Footer refresh', kind: 'input' }, 'name'), 'The Footer refresh session has a question for you.');
  assert.equal(V.alertText({ title: 'Nightly import', kind: 'failed' }, 'summary'), 'The Nightly import session stopped with an error.');
  assert.equal(V.shortTitle('Review `/home/u/projects/x/src/very/long/path.py` and then fix the remaining flaky tests in CI'), 'Review path.py and then fix the remaining flaky…');
  assert.ok(V.oneLine('x '.repeat(200) + '.').length <= 161);
});

test('only short, specific phrases are local commands', () => {
  const cases = { 'Stop.': 'stop', 'Cancel that please': 'stop', "What's it doing right now?": 'status', 'status': 'status',
    'Okay, read me the result.': 'read', 'Read it all': 'readAll', 'Is anything waiting on me?': 'waiting', 'Be quiet': 'quiet',
    'Tell it to stop the memstem session and start over': null, 'Stop the build after the tests and then push': null,
    'what is it doing with the database migration in the other branch': null, '': null };
  for (const [said, kind] of Object.entries(cases)) assert.equal(V.intent(said), kind, said);
});

test('voice service: not installed, custom engine, transcribe, speak, idle stop and failed start', async () => {
  const missing = new VoiceService({ home: fs.mkdtempSync(path.join(os.tmpdir(), 'pv-')) });
  assert.equal(missing.status().available, false);
  assert.match(missing.status().reason, /voice-setup\.sh/);
  assert.equal(new VoiceService({ disabled: true, command: fake }).status().available, false);

  const v = new VoiceService({ command: fake, idleMs: 300 });
  t_after(() => v.stop());
  assert.equal(v.status().available, true);
  const [a, b] = await Promise.all([v.ensure(), v.ensure()]);
  assert.equal(a, b, 'concurrent first uses share one engine');
  const out = await v.transcribe(Buffer.alloc(32000), 'MemStem, Zoho — café ✓\nTechPro');
  assert.equal(out.text, 'tell it to run the unit tests');
  assert.equal(out.prompt, 'MemStem, Zoho caf TechPro', 'hint is single-line printable ASCII');
  await assert.rejects(v.transcribe(Buffer.alloc(100)), e => e.status === 400);
  const wav = await v.speak('Hello there.', 'not-a-voice');
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  await sleep(700);
  assert.equal(v.port, null, 'idle engine is stopped');
  assert.ok(await v.ensure(), 'and restarts on the next use');
  v.stop();

  process.env.FAKE_VOICE_FAIL = '1';
  try {
    const broken = new VoiceService({ command: fake });
    await assert.rejects(broken.ensure(), e => e.code === 'voice_start_failed' && /fake engine failed/.test(e.message));
    assert.match(broken.status().lastError, /exited during startup/);
  } finally { delete process.env.FAKE_VOICE_FAIL; }
});

test('HTTP: voice routes require login, report availability and round-trip audio', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-voice-')); let port = 18461, logs = '';
  const secret = randomUUID(), exp = Date.now() + 3600000;
  const cookie = 'pc_auth=' + exp + '.' + createHmac('sha256', secret).update(String(exp)).digest('hex');
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID)_/.test(k))), PORT: String(port), POCKET_ENV_FILE: '',
    POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret, POCKET_CODEX: '0', POCKET_DATA_DIR: dir, POCKET_SESSION_ROOT: path.join(dir, 'sessions'),
    POCKET_VOICE_COMMAND: JSON.stringify(fake), FAKE_VOICE_TEXT: 'what is it doing' };
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
  const child = spawn(process.execPath, ['server.mjs'], { cwd: repo, env });
  child.stdout.on('data', b => { logs += b; }); child.stderr.on('data', b => { logs += b; });
  t.after(async () => { if (child.exitCode === null) { const e = new Promise(r => child.once('exit', r)); child.kill(); await e; } fs.rmSync(dir, { recursive: true, force: true }); });
  for (let i = 0; i < 150; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { } await sleep(30); }
  const url = p => `http://127.0.0.1:${port}/api/voice${p}`;
  assert.equal((await fetch(url('/status'))).status, 401);
  const status = await (await fetch(url('/status'), { headers: { cookie } })).json();
  assert.equal(status.available, true); assert.equal(status.defaultVoice, 'af_heart');
  assert.ok(status.voices.some(v => v.id === 'bm_george'));
  const empty = await fetch(url('/transcribe'), { method: 'POST', headers: { cookie } });
  assert.equal(empty.status, 400);
  const heard = await fetch(url('/transcribe'), { method: 'POST', headers: { cookie, 'content-type': 'application/octet-stream', 'x-vocabulary': 'MemStem' }, body: Buffer.alloc(32000) });
  assert.equal(heard.status, 200, logs); assert.equal((await heard.json()).text, 'what is it doing');
  assert.equal(heard.headers.get('cache-control'), 'private, no-store');
  const spoken = await fetch(url('/speak'), { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Done.', voice: 'bm_george' }) });
  assert.equal(spoken.status, 200); assert.equal(spoken.headers.get('content-type'), 'audio/wav');
  assert.equal((await fetch(url('/speak'), { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' })).status, 400);
});
