import test from 'node:test';
import assert from 'node:assert/strict';
import {LineBuffer,makeTransport} from '../codex.mjs';

// The app-server's stdout is framed line by line; chunk boundaries fall anywhere.
test('LineBuffer frames lines across any chunk boundary and keeps a partial tail', () => {
  const text = 'alpha\n\n{"id":1,"result":{"x":"a\\nb"}}\nlast-without-newline';
  const expected = ['alpha', '', '{"id":1,"result":{"x":"a\\nb"}}'];
  for (const size of [1, 2, 3, 5, 7, 11, 64 * 1024]) {
    const b = new LineBuffer(), got = [];
    for (let i = 0; i < text.length; i += size) got.push(...b.push(text.slice(i, i + size)));
    assert.deepEqual(got, expected, `chunk size ${size}`);
    assert.deepEqual(b.push('\n'), ['last-without-newline'], `tail completes at ${size}`);
    assert.deepEqual(b.push('x\ny'), ['x']);
    assert.deepEqual(b.push(''), []);
    assert.deepEqual(b.push('\n'), ['y']);
  }
});

// One 17 MB reply in 64 KB chunks took 3.9 s with the old rejoin-and-split reader (2026-10-16).
test('LineBuffer handles a multi-megabyte single line in small chunks in linear time', () => {
  const line = JSON.stringify({ id: 7, result: { data: Array.from({ length: 20000 }, (_, i) => ({ id: 'item-' + i, text: 'x'.repeat(400) })) } });
  assert.ok(line.length > 8_000_000, 'payload is over 8 MB');
  const payload = line + '\n{"id":8,"result":null}\n';
  const b = new LineBuffer(); let lines = [];
  const t0 = performance.now();
  for (let i = 0; i < payload.length; i += 4096) lines.push(...b.push(payload.slice(i, i + 4096)));
  const ms = performance.now() - t0;
  assert.equal(lines.length, 2);
  assert.equal(lines[0], line);
  assert.equal(JSON.parse(lines[1]).id, 8);
  assert.ok(ms < 1500, `framing took ${ms.toFixed(0)} ms`);
});

// 1.73.7: the shared reader is retired only by its own failure. Before, a failed initialize left the process running, and of
// two reads that both met an exited reader, the second threw away the replacement the first had just started (still alive,
// never closed). Each case runs in its own Node process, so the module's reader starts fresh.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
const repo = path.resolve(import.meta.dirname, '..');
async function readerCase(script, marker) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-reader-')), pids = path.join(dir, 'pids'), mark = path.join(dir, 'mark');
  fs.mkdirSync(path.join(dir, 'sessions')); if (marker === 'FAKE_CODEX_INIT_FAIL') fs.writeFileSync(mark, ''); // FAKE_CODEX_DIE_ON is armed by the script
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX)_/.test(k))), POCKET_DATA_DIR: path.join(dir, 'data'), POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_TEST_CALLS: path.join(dir, 'calls'), CODEX_BIN: path.join(repo, 'test/fake-codex.mjs'), FAKE_CODEX_PIDS: pids, [marker]: mark };
  // The script reports which readers are still running while it is (its children end with it, so that is the moment to look).
  const code = `import fs from 'node:fs';const c=await import(${JSON.stringify(path.join(repo, 'codex.mjs'))});${script}await new Promise(r=>setTimeout(r,700));`
    + `const live=fs.readFileSync(${JSON.stringify(pids)},'utf8').trim().split('\\n').map(Number).filter(p=>{try{process.kill(p,0);return true;}catch{return false;}});process.stdout.write('\\nLIVE '+JSON.stringify(live)+'\\n');process.exit(0);`;
  const out = await new Promise((resolve, reject) => execFile(process.execPath, ['--input-type=module', '-e', code], { env, timeout: 20000 }, (e, o, err) => e ? reject(new Error(err || e.message)) : resolve(o)));
  const started = fs.readFileSync(pids, 'utf8').trim().split('\n').map(Number), live = JSON.parse(/^LIVE (.*)$/m.exec(out)[1]);
  for (const pid of started) { try { process.kill(pid, 'SIGKILL'); } catch { } }
  fs.rmSync(dir, { recursive: true, force: true });
  return { started, live };
}
test('a reader whose initialize fails is closed; two reads meeting one exited reader share one replacement', async () => {
  let r = await readerCase(`await c.listCodexSessions(5).catch(()=>{});await c.listCodexSessions(5);`, 'FAKE_CODEX_INIT_FAIL');
  assert.equal(r.started.length, 2, 'the failed reader, then a working one');
  assert.deepEqual(r.live, [r.started[1]], 'only the working reader runs; the failed one was closed');
  r = await readerCase(`await c.listCodexSessions(5);fs.writeFileSync(process.env.FAKE_CODEX_DIE_ON,'');await Promise.all([c.listCodexSessions(5),c.listCodexSessions(5)]);`, 'FAKE_CODEX_DIE_ON');
  assert.equal(r.started.length, 2, `one reader exited and one replaced it, not two: ${r.started.length} started`);
  assert.deepEqual(r.live, [r.started[1]]);
});

// 1.73.7: a session log is drained at most 1 MiB per pass, cut on a character boundary. Before, a long unread tail (adoption
// after a long turn) was read in one synchronous call. Every line still arrives whole and in order.
test('the session transport drains a large backlog in bounded passes without breaking a character', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-drain-')), out = path.join(dir, 'x.out.ndjson');
  const lines = Array.from({ length: 30000 }, (_, i) => JSON.stringify({ i, text: 'é€😀'.repeat(i % 7) + 'x'.repeat(i % 50) }));
  fs.writeFileSync(out, lines.join('\n') + '\n');
  const t = makeTransport({ pid: 0, keeperPid: 0, key: 'x', files: { out, fifo: path.join(dir, 'f'), meta: path.join(dir, 'm') }, writer: { write() { }, destroy() { }, end() { } }, offset: 0 });
  clearInterval(t.timer);
  const got = []; t.onData = l => got.push(l.trimEnd());
  t.drain(); const first = got.length;
  assert.ok(first > 0 && first < lines.length, `one pass read ${first} of ${lines.length} lines`);
  for (let i = 0; i < 20 && got.length < lines.length; i++) t.drain();
  assert.deepEqual(got, lines, 'every line arrived intact and in order');
  fs.rmSync(dir, { recursive: true, force: true });
});
