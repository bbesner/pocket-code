// Regressions for the 1.7 code review (2026-10-04): daemon robustness, stream replay,
// setting validation, restart state, and the usage/receipt stores.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {DeliveryReceipts} from '../delivery.mjs';
import {UsageStore,pickMainModel} from '../usage.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID)_/.test(k)));

async function fixture(t,port,env={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-review-'));
 const secret=randomUUID(),exp=Date.now()+3600000;
 const cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
 const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
 let child,logs='';
 const start=async()=>{
  child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),...env},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
  for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
  if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=41;logs='';return start();} // the port was taken: move, never talk to a foreign server
  throw Error('Test server failed: '+logs);
 };
 const stop=async()=>{if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}};
 const call=async(p,body,extra={})=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers:{...headers,...extra},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null),headers:r.headers}};
 const calls=()=>fs.existsSync(path.join(dir,'calls'))?fs.readFileSync(path.join(dir,'calls'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 const health=async()=>(await call('/health')).body;
 const state=async id=>(await call('/sessions')).body.sessions.find(s=>s.id===id)?.state.kind;
 const until=async(fn,ms=5000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return true;await sleep(50)}return false;};
 const killAll=()=>{for(const pid of new Set(calls().map(c=>c.pid))){try{process.kill(-pid,'SIGKILL')}catch{try{process.kill(pid,'SIGKILL')}catch{}}}};
 // read a session's event stream for `ms`, return the data lines seen
 const streamFor=async(id,query,ms,extra={})=>{const ac=new AbortController();const r=await fetch(`http://127.0.0.1:${port}/api/session/${id}/events${query}`,{headers:{...headers,...extra},signal:ac.signal});
  let seen='';const reader=r.body.getReader();const read=(async()=>{try{for(;;){const {value,done}=await reader.read();if(done)break;seen+=new TextDecoder().decode(value);}}catch{}})();
  await sleep(ms);ac.abort();await read;return seen.split('\n').filter(l=>l.startsWith('data: ')).map(l=>l.slice(6));};
 t.after(async()=>{await stop();killAll();fs.rmSync(dir,{recursive:true,force:true});});
 fs.mkdirSync(path.join(dir,'sessions','test-workspace'),{recursive:true});
 await start();
 return {dir,port,start,stop,call,calls,health,state,until,streamFor,logs:()=>logs,alive:()=>child.exitCode===null};
}
const msg=text=>({text,clientMessageId:randomUUID()});

test('a rejected promise inside a route answers 503 and leaves the daemon up',async t=>{
 const f=await fixture(t,18411);
 // a directory where a transcript should be: every read of it rejects (EISDIR)
 const id=randomUUID();fs.mkdirSync(path.join(f.dir,'sessions','test-workspace',id+'.jsonl'));
 for(const p of [`/session/${id}/changes`,`/session/${id}/search?q=hello`,`/session/${id}`]){
  const r=await f.call(p);
  assert.equal(r.status,503,p);assert.match(r.body.error,/retry/i);
 }
 assert.ok(f.alive(),'daemon survived');
 assert.equal((await f.health()).ok,true);
 assert.match(f.logs(),/request failed GET/);
});

test('passwords with non-ASCII characters log in; wrong ones do not',async t=>{
 const f=await fixture(t,18412,{POCKET_PASSWORD:'pässwörd✓'});
 const ok=await f.call('/login',{password:'pässwörd✓'});
 assert.equal(ok.status,200);assert.match(ok.headers.get('set-cookie')||'',/pc_auth=/);
 assert.equal((await f.call('/login',{password:'pässwörd'})).status,403);
 assert.equal((await f.call('/login',{password:'pässwörd✓✓'})).status,403);
 assert.ok(f.alive());
});

test('a fresh stream connection starts after the events the transcript already covers',async t=>{
 const f=await fixture(t,18413);
 const id=(await f.call('/new',{cwd:repo,...msg('__QUESTION__')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='input'));
 const s=(await f.call(`/session/${id}`)).body;
 assert.equal(s.turnEvents,1,'the questions event has been broadcast once');
 // no cut (an old client): the event is replayed; with the cut: nothing to replay
 const replayed=await f.streamFor(id,'?offset=0',500);
 assert.ok(replayed.some(d=>d.includes('"questions"')),'legacy connection replays');
 const cut=(await f.streamFor(id,`?offset=0&from=${s.turnEvents}`,500)).filter(d=>!d.includes('"attach"'));
 assert.deepEqual(cut,[],'connection with the transcript cut gets no replay');
 // a browser reconnect still resumes from Last-Event-ID
 const resumed=await f.streamFor(id,'?offset=0',500);
 assert.ok(resumed.length>=1);
 const none=(await f.streamFor(id,'?offset=0',500).then(()=>f.streamFor(id,'?offset=0&from=99',300))).filter(d=>!d.includes('"attach"'));
 assert.deepEqual(none,[],'from beyond the end is clamped');
});

test('bad timer and mode settings fall back to defaults instead of breaking turns or boot',async t=>{
 const f=await fixture(t,18414,{POCKET_STALL_MS:'30m',POCKET_APPROVAL_MODE:''});
 assert.match(f.logs(),/POCKET_STALL_MS=30m is not a number/);
 assert.equal((await f.call('/approval-policy')).body.defaultMode,'review');
 const id=(await f.call('/new',{cwd:repo,...msg('__SLOW__ still fine')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='finished',6000),'slow turn finished normally');
 assert.doesNotMatch(f.logs(),/STALLED/);
});

test('a background job is remembered across a restart: no idle close, release asks first',async t=>{
 const f=await fixture(t,18415,{POCKET_IDLE_CLOSE_MS:'1000'});
 const id=(await f.call('/new',{cwd:repo,...msg('__BG_LONG__ long job')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='finished'));
 await f.stop();await f.start();
 assert.equal((await f.health()).processes,1,'process adopted');
 await sleep(1600);
 assert.equal((await f.health()).processes,1,'not idle-closed while its job runs');
 const r=await f.call(`/session/${id}/release`,{});
 assert.equal(r.status,409);assert.equal(r.body.background,true);
});

test('delivery receipts older than a week are pruned on load',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-receipts-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'receipts.json');
 fs.writeFileSync(file,JSON.stringify({old:{hash:'a',at:Date.now()-8*86400_000,response:{status:202,body:{}}},fresh:{hash:'b',at:Date.now(),response:{status:202,body:{}}}}));
 const store=new DeliveryReceipts(file);
 assert.deepEqual(Object.keys(store.records),['fresh']);
});

test('context meter: the result\'s cumulative modelUsage never replaces the last call\'s context',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-usage-'));
 const store=new UsageStore(path.join(dir,'usage-state.json'));
 store.observe('s',{type:'assistant',message:{model:'claude-opus-5-5',usage:{input_tokens:1000,cache_read_input_tokens:400000,cache_creation_input_tokens:0}}});
 // what CLI 2.1.281 reports after a 46-call turn: the sum of every call's input
 store.observe('s',{type:'result',modelUsage:{'claude-haiku-4-5-20251001':{inputTokens:900,contextWindow:200000},'claude-opus-5-5[1m]':{inputTokens:362,cacheReadInputTokens:43985886,cacheCreationInputTokens:413617,contextWindow:1000000}}});
 const c=store.sessionSummary('s');
 assert.equal(c.used,401000);assert.equal(c.window,1000000);assert.equal(c.model,'claude-opus-5-5[1m]');assert.equal(c.estimated,false);
 assert.equal(pickMainModel({'claude-haiku-4-5-20251001':{},'claude-sonnet-5':{},'claude-opus-5-5[1m]':{}},'claude-opus-5-5'),'claude-opus-5-5[1m]','matches across the [1m] suffix');
 fs.rmSync(dir,{recursive:true,force:true});
});

test('a tool request pending at a restart is denied on adoption so the turn carries on',async t=>{
 const f=await fixture(t,18416);
 const id=(await f.call('/new',{cwd:repo,...msg('__APPROVAL__ risky step')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='input'),'approval pending');
 await f.stop();await f.start();
 assert.ok(await f.until(async()=>await f.state(id)==='finished',6000),'turn finished after the restart');
 assert.match(f.logs(),/denied a pre-restart Bash request/);
 assert.ok(!fs.existsSync(path.join(f.dir,'calls.approved')),'nothing was approved');
});

test('the process cap closes the longest-idle process before a new one starts',async t=>{
 const f=await fixture(t,18417,{POCKET_MAX_PROCESSES:'1'});
 const a=(await f.call('/new',{cwd:repo,...msg('first')})).body.id;
 assert.ok(await f.until(async()=>await f.state(a)==='finished'));
 assert.equal((await f.health()).processes,1);
 const b=(await f.call('/new',{cwd:repo,...msg('second')})).body.id;
 assert.ok(await f.until(async()=>await f.state(b)==='finished'));
 assert.ok(await f.until(async()=>(await f.health()).processes===1,4000),'back to one process');
 assert.match(f.logs(),new RegExp(`closing session=${a}.*reason=process limit`));
 assert.equal(await f.state(a),'finished','the closed session is untouched');
});

test('watch mode numbers events by transcript offset so a reconnect resumes, and owned streams carry an attach key',async t=>{
 const f=await fixture(t,18418);
 const id=(await f.call('/new',{cwd:repo,...msg('first')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='finished'));
 const all=await f.streamFor(id,'?offset=0',600);
 const msgs=all.map(d=>JSON.parse(d)).filter(d=>d.offset);
 assert.ok(msgs.length>=2,'user and assistant lines replayed from offset 0');
 const last=msgs.at(-1).offset;
 const resumed=(await f.streamFor(id,'?offset=0',500,{'last-event-id':String(last)})).map(d=>JSON.parse(d)).filter(d=>d.offset);
 assert.deepEqual(resumed,[],'nothing before Last-Event-ID is replayed');
 const slow=(await f.call('/new',{cwd:repo,...msg('__SLOW__ running')})).body.id;
 const live=await f.streamFor(slow,'?offset=0',300);
 assert.match(live[0]||'',/"type":"attach"/);
 assert.match(live[0],/"key":"[0-9a-z]+:\d+"/);
});
