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

// 1.73.8: a request whose write fails is rejected at once (it used to wait for its timeout, 30 s for a list); a usage file
// whose root is not an object reads as empty (it used to stop the daemon at start).
test('a failed write rejects its request at once; a malformed usage file does not stop the module loading', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-reader-')); fs.mkdirSync(path.join(dir, 'sessions')); fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data', 'codex-usage-state.json'), 'null');
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX)_/.test(k))), POCKET_DATA_DIR: path.join(dir, 'data'), POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_TEST_CALLS: path.join(dir, 'calls'), CODEX_BIN: path.join(repo, 'test/fake-codex.mjs'), FAKE_CODEX_CLOSE_STDIN: '1' };
  const code = `const c=await import(${JSON.stringify(path.join(repo, 'codex.mjs'))});const t0=Date.now();const e=await c.listCodexSessions(5).then(()=>null,e=>e);process.stdout.write('\\nRESULT '+JSON.stringify({ms:Date.now()-t0,error:e?.message||null})+'\\n');process.exit(0);`;
  const out = await new Promise((resolve, reject) => execFile(process.execPath, ['--input-type=module', '-e', code], { env, timeout: 40000 }, (e, o, err) => e ? reject(new Error(err || e.message)) : resolve(o)));
  fs.rmSync(dir, { recursive: true, force: true });
  const r = JSON.parse(/^RESULT (.*)$/m.exec(out)[1]);
  assert.match(String(r.error), /EPIPE|closed/, 'the request failed with the write error');
  assert.ok(r.ms < 5000, `rejected in ${r.ms} ms, not at the 30 s timeout`);
});

// 1.76.3: readCodexThread refreshes from the newest pages, and the cache is updated when a page's reply arrives. A turn's
// completed item noted (noteCodexItem) while that page was on its way used to be put back to the page's older state, and once
// newer items covered that page no later refresh reread it: a command stayed shown as running. Noted items now win over the page.
test('a completed item noted while a page is on its way is not undone by that page', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-reader-')); fs.mkdirSync(path.join(dir, 'data'));
  // A Codex app-server whose thread/items/list reads items.json when asked and, while a file named "hold" exists, keeps the answer back.
  fs.writeFileSync(path.join(dir, 'codex'), `#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import readline from 'node:readline';
const dir=process.env.FAKE_DIR,sleep=ms=>new Promise(r=>setTimeout(r,ms));fs.writeFileSync(path.join(dir,'pid'),String(process.pid));
const send=o=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...o})+'\\n');
readline.createInterface({input:process.stdin}).on('line',async line=>{
  const m=JSON.parse(line);if(m.id==null)return;
  if(m.method!=='thread/items/list')return send({id:m.id,result:{}});
  const p=m.params,all=JSON.parse(fs.readFileSync(path.join(dir,'items.json'),'utf8')).reverse();
  const from=p.cursor?Number(p.cursor):0,page=all.slice(from,from+p.limit);
  if(fs.existsSync(path.join(dir,'hold'))){fs.writeFileSync(path.join(dir,'asked'),'');while(fs.existsSync(path.join(dir,'hold')))await sleep(20);}
  send({id:m.id,result:{data:page,nextCursor:from+page.length<all.length?String(from+page.length):null}});
}).on('close',()=>process.exit(0));`, { mode: 0o755 });
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX)_/.test(k))), POCKET_DATA_DIR: path.join(dir, 'data'), CODEX_BIN: path.join(dir, 'codex'), FAKE_DIR: dir, CODEX_HOME: path.join(dir, 'codex-home') };
  const code = `import fs from 'node:fs';import path from 'node:path';
const {readCodexThread,noteCodexItem}=await import(${JSON.stringify(path.join(repo, 'codex.mjs'))});
const dir=${JSON.stringify(dir)},sleep=ms=>new Promise(r=>setTimeout(r,ms)),thread='019a0000-0000-7000-8000-000000000001';
const items=list=>fs.writeFileSync(path.join(dir,'items.json'),JSON.stringify(list));
const user={type:'userMessage',id:'u1',content:[{type:'text',text:'Run the build'}]},running={type:'commandExecution',id:'c1',command:'make build',exitCode:null};
items([user]);const first=(await readCodexThread(thread)).msgs.length;
items([user,running]);fs.writeFileSync(path.join(dir,'hold'),'');
const refresh=readCodexThread(thread);
let asked=false;for(let i=0;i<250&&!asked;i++){asked=fs.existsSync(path.join(dir,'asked'));if(!asked)await sleep(20);}
const finished={...running,exitCode:2};noteCodexItem(thread,null,finished);
fs.rmSync(path.join(dir,'hold'));const held=JSON.stringify((await refresh).msgs);
const replies=Array.from({length:40},(_,i)=>({type:'agentMessage',id:'a'+i,text:'Step '+i+' done.'}));
for(const r of replies)noteCodexItem(thread,null,r);items([user,finished,...replies]);
const later=JSON.stringify((await readCodexThread(thread)).msgs);
process.stdout.write('\\nRESULT '+JSON.stringify({first,asked,held,later})+'\\n');process.exit(0);`;
  const out = await new Promise((resolve, reject) => execFile(process.execPath, ['--input-type=module', '-e', code], { env, timeout: 40000 }, (e, o, err) => e ? reject(new Error(err || e.message)) : resolve(o)));
  try { process.kill(Number(fs.readFileSync(path.join(dir, 'pid'), 'utf8'))); } catch { }
  fs.rmSync(dir, { recursive: true, force: true });
  const r = JSON.parse(/^RESULT (.*)$/m.exec(out)[1]);
  assert.equal(r.first, 1, 'the conversation is cached');assert.equal(r.asked, true, 'the refresh reached the app-server');
  assert.match(r.held, /make build \(exit 2\)/, 'the refresh whose page was held shows the command completed');
  assert.match(r.later, /make build \(exit 2\)/, 'the command keeps its exit code once newer items cover its page');
});
