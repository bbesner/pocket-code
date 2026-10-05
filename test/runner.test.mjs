import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID)_/.test(k)));

// One server fixture per test; env tunes the idle/stall timers down to test speed.
async function fixture(t,port,env={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-runner-'));
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
 const call=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()}};
 const calls=()=>fs.existsSync(path.join(dir,'calls'))?fs.readFileSync(path.join(dir,'calls'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 const health=async()=>(await call('/health')).body;
 const state=async id=>(await call('/sessions')).body.sessions.find(s=>s.id===id)?.state.kind;
 const until=async(fn,ms=5000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return true;await sleep(50)}return false;};
 const pids=()=>new Set(calls().map(c=>c.pid));
 const transcript=id=>{try{return fs.readFileSync(path.join(dir,'sessions','test-workspace',id+'.jsonl'),'utf8')}catch{return ''}};
 const killAll=()=>{for(const pid of pids()){try{process.kill(-pid,'SIGKILL')}catch{try{process.kill(pid,'SIGKILL')}catch{}}}};
 t.after(async()=>{await stop();killAll();fs.rmSync(dir,{recursive:true,force:true});});
 fs.mkdirSync(path.join(dir,'sessions','test-workspace'),{recursive:true});
 await start();
 return {dir,start,stop,call,calls,health,state,until,pids,transcript,headers,logs:()=>logs};
}
const msg=text=>({text,clientMessageId:randomUUID()});

test('one process carries a session across turns; a model change starts a new one',async t=>{
 const f=await fixture(t,18391);
 const id=(await f.call('/new',{cwd:repo,...msg('first')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='finished'));
 assert.equal((await f.health()).processes,1,'process stays up after the turn');
 assert.equal((await f.call(`/session/${id}/message`,msg('second'))).status,202);
 assert.ok(await f.until(async()=>f.calls().length===2&&await f.state(id)==='finished'));
 assert.equal(f.pids().size,1,'second turn reused the same process');
 assert.equal((await f.call(`/session/${id}/message`,{...msg('third'),model:'claude-haiku-4-5'})).status,202);
 assert.ok(await f.until(async()=>f.calls().length===3&&await f.state(id)==='finished'));
 assert.equal(f.pids().size,2,'model change started a fresh process');
 assert.ok(await f.until(async()=>(await f.health()).processes===1),'the replaced process closed');
});

test('a turn the agent starts by itself (finished background job) is streamed and recorded',async t=>{
 const f=await fixture(t,18392,{POCKET_TEST_BG_MS:'1500'});
 const id=(await f.call('/new',{cwd:repo,...msg('__BG__ start a job')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='finished'));
 // A viewer mirroring the idle session is told to reattach when the agent starts a turn.
 const viewer=await fetch(`http://127.0.0.1:18392/api/session/${id}/events`,{headers:f.headers});
 const reader=viewer.body.getReader();let seen='';
 const read=(async()=>{for(;;){const {value,done}=await reader.read();if(done)break;seen+=new TextDecoder().decode(value);}})();
 assert.ok(await f.until(()=>seen.includes('"type":"done"')),'mirror viewer told to resync');
 await read;
 assert.ok(await f.until(()=>f.transcript(id).includes('The background job finished.')));
 assert.ok(await f.until(()=>/turn start \(started by the agent\)/.test(f.logs())),'server picked up the self-started turn');
 assert.ok(await f.until(()=>(f.logs().match(/turn done session=/g)||[]).length===2),'and finished it');
 assert.equal(await f.state(id),'finished');
 assert.equal(f.pids().size,1);
});

test('idle processes close after the idle time, but not while a background job runs',async t=>{
 const f=await fixture(t,18393,{POCKET_IDLE_CLOSE_MS:'1200'});
 const a=(await f.call('/new',{cwd:repo,...msg('quick')})).body.id;
 const b=(await f.call('/new',{cwd:repo,...msg('__BG_LONG__ long job')})).body.id;
 assert.ok(await f.until(async()=>await f.state(a)==='finished'&&await f.state(b)==='finished'));
 assert.equal((await f.health()).processes,2);
 assert.ok(await f.until(async()=>(await f.health()).processes===1,4000),'idle session closed');
 await sleep(1500);
 assert.equal((await f.health()).processes,1,'session with a running background job stays open');
 assert.match(f.logs(),new RegExp(`closing session=${a}.*reason=idle`));
 // a message after the idle close resumes the session in a new process
 assert.equal((await f.call(`/session/${a}/message`,msg('back again'))).status,202);
 assert.ok(await f.until(async()=>f.calls().filter(c=>c.id===a).length===2&&await f.state(a)==='finished'));
 assert.equal(new Set(f.calls().filter(c=>c.id===a).map(c=>c.pid)).size,2);
});

test('stall watchdog stops a silent turn but never one waiting on a background job',async t=>{
 const f=await fixture(t,18394,{POCKET_STALL_MS:'1200'});
 const stuck=(await f.call('/new',{cwd:repo,...msg('__HANG__')})).body.id;
 const waiting=(await f.call('/new',{cwd:repo,...msg('__BGHANG__')})).body.id;
 assert.ok(await f.until(async()=>await f.state(stuck)==='failed',6000),'silent turn stopped');
 assert.match(f.logs(),new RegExp(`turn STALLED session=${stuck}`));
 assert.equal(await f.state(waiting),'running','turn waiting on a background job keeps running');
 assert.doesNotMatch(f.logs(),new RegExp(`STALLED session=${waiting}`));
});

test('a restart reattaches to the live process through its input pipe',async t=>{
 const f=await fixture(t,18395);
 const id=(await f.call('/new',{cwd:repo,...msg('__SLOW__ survive a restart')})).body.id;
 await f.until(()=>f.calls().length===1);
 await f.stop();await f.start();
 assert.equal((await f.health()).processes,1,'process adopted');
 assert.ok(await f.until(async()=>await f.state(id)==='finished',5000),'in-flight turn completed after restart');
 assert.equal((await f.call(`/session/${id}/message`,msg('after restart'))).status,202);
 assert.ok(await f.until(async()=>f.calls().length===2&&await f.state(id)==='finished'));
 assert.equal(f.pids().size,1,'the restarted server wrote into the same process');
});

test('refuses while another app is mid-turn; a later message starts a fresh process',async t=>{
 const f=await fixture(t,18396);
 const id=(await f.call('/new',{cwd:repo,...msg('first')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='finished'));
 const file=path.join(f.dir,'sessions','test-workspace',id+'.jsonl');
 fs.appendFileSync(file,JSON.stringify({type:'user',message:{role:'user',content:'typed in code-server'},timestamp:new Date().toISOString()})+'\n');
 const busy=await f.call(`/session/${id}/message`,msg('from phone'));
 assert.equal(busy.status,409);assert.match(busy.body.error,/another app/);
 // the other app's turn finished a while ago: accepted, and the stale process is replaced
 fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/"timestamp":"[^"]+"}\n$/,`"timestamp":"${new Date(Date.now()-120000).toISOString()}"}\n`));
 assert.equal((await f.call(`/session/${id}/message`,msg('from phone later'))).status,202);
 assert.ok(await f.until(async()=>f.calls().length===2&&await f.state(id)==='finished'));
 assert.equal(f.pids().size,2,'process restarted to pick up the other app\'s turn');
 assert.match(f.logs(),/reason=continued in another app/);
});

test('release closes an idle process and asks before stopping a running turn',async t=>{
 const f=await fixture(t,18397);
 const id=(await f.call('/new',{cwd:repo,...msg('__SLOW__ running')})).body.id;
 const r1=await f.call(`/session/${id}/release`,{});
 assert.equal(r1.status,409);assert.equal(r1.body.running,true);
 assert.ok(await f.until(async()=>await f.state(id)==='finished'));
 const r2=await f.call(`/session/${id}/release`,{});
 assert.equal(r2.status,200);assert.equal(r2.body.released,true);
 assert.ok(await f.until(async()=>(await f.health()).processes===0),'process closed');
 const r3=await f.call(`/session/${id}/release`,{});
 assert.equal(r3.body.released,false);
});

test('turns carry the reply-suggestion instruction; a trailing choices block comes back as reply options',async t=>{
 const f=await fixture(t,18571);
 const id=(await f.call('/new',{cwd:repo,...msg('__CHOICES__ wrap up')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='finished'));
 assert.equal(f.calls()[0].choices,true,'the CLI was started with the instruction');
 const last=(await f.call(`/session/${id}`)).body.messages.filter(m=>m.role==='assistant').at(-1);
 assert.deepEqual(last.blocks,[{t:'text',text:'Tests pass. Should I merge and deploy?'},{t:'choices',options:['Merge and deploy',"Don't merge yet"]}]);
 assert.equal((await f.call(`/session/${id}/search?q=${encodeURIComponent("don't merge")}`)).status<500,true);
});

test('POCKET_CHOICES=0 starts the CLI without the instruction',async t=>{
 const f=await fixture(t,18611,{POCKET_CHOICES:'0'});
 const id=(await f.call('/new',{cwd:repo,...msg('plain')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='finished'));
 assert.equal(f.calls()[0].choices,false);
});

test('a just-sent message shows as pending until the CLI writes it, and never twice',async t=>{
 const f=await fixture(t,18751);
 const first=(await f.call('/new',{cwd:repo,...msg('setup')})).body.id;
 assert.ok(await f.until(async()=>await f.state(first)==='finished'));
 const text='__SLOW__ __LATEUSER__ please check the logs';
 assert.equal((await f.call(`/session/${first}/message`,msg(text))).status,202);
 const users=async()=>(await f.call(`/session/${first}`)).body.messages.filter(m=>m.role==='user');
 let u=await users();
 assert.deepEqual(u.at(-1),{role:'user',text,pending:true},'shown right away, marked pending');
 assert.ok(await f.until(async()=>{const x=await users();return x.at(-1).text===text&&!x.at(-1).pending;}),'replaced by the transcript line once written');
 u=await users();assert.equal(u.filter(m=>m.text===text).length,1,'never twice');
 // A steered message landing after the turn's own line must not re-add the turn's text.
 const file=fs.readdirSync(path.join(f.dir,'sessions','test-workspace')).find(n=>n.startsWith(first));
 fs.appendFileSync(path.join(f.dir,'sessions','test-workspace',file),JSON.stringify({type:'attachment',sessionId:first,timestamp:new Date().toISOString(),attachment:{type:'queued_command',prompt:'also check disk space'}})+'\n');
 u=await users();
 assert.equal(u.at(-1).text,'also check disk space');assert.equal(u.filter(m=>m.text===text).length,1,'steer after it does not duplicate the turn text');
 assert.ok(await f.until(async()=>await f.state(first)==='finished',6000));
 assert.equal((await users()).some(m=>m.pending),false,'nothing pending once the turn ends');
});
