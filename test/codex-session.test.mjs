import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {createHmac,createECDH,randomBytes,randomUUID} from 'node:crypto';
import webpush from 'web-push';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));

async function fixture(t,port,env={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-codex-'));
 const secret=randomUUID(),exp=Date.now()+3600000;
 const headers={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
 let child,logs='';
 const start=async()=>{
  child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),POCKET_SKILLS:'0',PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:process.env.TEST_AUTO_TITLES??'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),CODEX_BIN:path.join(repo,'test/fake-codex.mjs'),...env},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
  for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
  if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=41;logs='';return start();} // the port was taken: move, never talk to a foreign server
  throw Error('Test server failed: '+logs);
 };
 const stop=async()=>{if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}};
 const call=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null)}};
 const calls=()=>{try{return fs.readFileSync(path.join(dir,'calls.codex'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)}catch{return []}};
 const until=async(fn,ms=5000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return true;await sleep(50)}return false;};
 const procs=async()=>(await call('/health')).body.codexProcesses;
 const idle=async id=>!(await call(`/session/${id}`)).body?.active;
 t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true});});
 fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});
 await start();
 const events=(id,signal)=>fetch(`http://127.0.0.1:${port}/api/session/${id}/events`,{headers,signal}); // a browser with the conversation open
 return {dir,call,calls,until,procs,idle,start,stop,events,logs:()=>logs};
}
const msg=(text,extra={})=>({text,clientMessageId:randomUUID(),...extra});

test('cross-provider models are rejected before dispatch; Codex defaults and explicit selections reach both model fields', async t => {
 const fixtureServer = await fixture(t, 18431, { POCKET_CODEX_MODEL: 'gpt-6-sol' });
 const request = { cwd: repo, provider: 'codex', ...msg('model selection') };
 for (const model of ['claude-opus-5-5[1m]', 'opus', 'sonnet[1m]', 42]) {
  const rejected = await fixtureServer.call('/new', { ...request, model });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /Choose a Codex model/);
 }
 assert.equal(await fixtureServer.procs(), 0);
 assert.equal(fixtureServer.calls().length, 0);
 const created = await fixtureServer.call('/new', { ...request, model: 'default' });
 assert.equal(created.status, 202, 'a rejected request must not reserve the delivery receipt');
 const sessionId = created.body.id;
 assert.ok(await fixtureServer.until(async () => fixtureServer.calls().length === 1 && await fixtureServer.idle(sessionId)));
 for (const mode of ['auto', 'queue', 'steer']) {
  const rejected = await fixtureServer.call(`/session/${sessionId}/message`, msg('wrong model', { model: 'claude-opus-5-5[1m]', mode }));
  assert.equal(rejected.status, 400);
 }
 for (const model of ['gpt-6-sol', 'gpt-6-astra']) {
  const count = fixtureServer.calls().length;
  assert.equal((await fixtureServer.call(`/session/${sessionId}/message`, msg('explicit model', { model }))).status, 202);
  assert.ok(await fixtureServer.until(async () => fixtureServer.calls().length === count + 1 && await fixtureServer.idle(sessionId)));
 }
 assert.deepEqual(fixtureServer.calls().map(call => [call.model, call.collaborationModel]), [
  ['gpt-6-sol', 'gpt-6-sol'], ['gpt-6-sol', 'gpt-6-sol'], ['gpt-6-astra', 'gpt-6-astra'],
 ]);
 for (const model of ['gpt-6-sol', 'gpt-6-astra', 'o3', 'codex-mini-latest']) {
  assert.equal((await fixtureServer.call('/new', { cwd: repo, ...msg('wrong Claude model', { model }) })).status, 400);
  assert.equal((await fixtureServer.call('/session/11111111-1111-4111-8111-111111111111/message', msg('wrong Claude model', { model }))).status, 400);
 }
});

test('a Codex thread keeps one app-server across turns',async t=>{
 const f=await fixture(t,18401);
 const id=(await f.call('/new',{cwd:repo,provider:'codex',...msg('first')})).body.id;
 assert.ok(id?.startsWith('cx:'));
 assert.ok(await f.until(async()=>f.calls().length===1&&await f.idle(id)));
 assert.equal(await f.procs(),1,'process stays up after the turn');
 assert.equal((await f.call(`/session/${id}/message`,msg('second'))).status,202);
 assert.ok(await f.until(async()=>f.calls().length===2&&await f.idle(id)));
 assert.equal(new Set(f.calls().map(c=>c.pid)).size,1,'second turn reused the app-server');
 assert.match(f.logs(),/process=reused/);
});

test('Pocket holds the thread until it closes the session; then another app can open it',async t=>{
 const f=await fixture(t,18402);
 const id=(await f.call('/new',{cwd:repo,provider:'codex',...msg('first')})).body.id;
 assert.ok(await f.until(async()=>f.calls().length===1&&await f.idle(id)));
 // another surface (code-server) tries to open the same thread
 const other=async()=>{const p=spawn(process.execPath,[path.join(repo,'test/fake-codex.mjs')],{env:{...process.env,POCKET_SESSION_ROOT:path.join(f.dir,'sessions'),POCKET_TEST_CALLS:path.join(f.dir,'other')},stdio:['pipe','pipe','ignore']});
  const rl=readline.createInterface({input:p.stdout});const res=new Promise(r=>rl.once('line',l=>r(JSON.parse(l))));
  p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'thread/resume',params:{threadId:id.slice(3)}})+'\n');const out=await res;p.kill();return out;};
 assert.match((await other()).error?.message||'',/active writer/,'locked while Pocket has it open');
 const rel=await f.call(`/session/${id}/release`,{});
 assert.equal(rel.body.released,true);
 assert.ok(await f.until(async()=>await f.procs()===0));
 assert.ok((await other()).result,'free after Pocket closed it');
});

test('idle Codex sessions close; the next message reopens the thread',async t=>{
 const f=await fixture(t,18403,{POCKET_IDLE_CLOSE_MS:'1000'});
 const id=(await f.call('/new',{cwd:repo,provider:'codex',...msg('first')})).body.id;
 assert.ok(await f.until(async()=>f.calls().length===1&&await f.idle(id)));
 assert.ok(await f.until(async()=>await f.procs()===0,4000),'closed after the idle time');
 assert.match(f.logs(),/codex session closing .*reason=idle/);
 assert.equal((await f.call(`/session/${id}/message`,msg('again'))).status,202);
 assert.ok(await f.until(async()=>f.calls().length===2&&await f.idle(id)));
 assert.equal(new Set(f.calls().map(c=>c.pid)).size,2);
});

test('1.81: a Codex finished-reply push follows the Claude rules: none while the conversation is open or after Stop',async t=>{
 const vapid=webpush.generateVAPIDKeys();
 const f=await fixture(t,18433,{VAPID_PUBLIC:vapid.publicKey,VAPID_PRIVATE:vapid.privateKey});
 // One device whose push service never answers: the send fails, and a failure other than 404/410 still counts in "push sent".
 const device=createECDH('prime256v1');device.generateKeys();
 fs.mkdirSync(path.join(f.dir,'data'),{recursive:true});
 fs.writeFileSync(path.join(f.dir,'data','push-subs.json'),JSON.stringify([{endpoint:'https://127.0.0.1:9/push',keys:{p256dh:device.getPublicKey('base64url'),auth:randomBytes(16).toString('base64url')}}]));
 const pushes=id=>f.logs().split('\n').filter(l=>l.includes(`push sent (1 devices) session=${id}`)).length;
 const id=(await f.call('/new',{cwd:repo,provider:'codex',...msg('first')})).body.id;
 assert.ok(await f.until(async()=>f.calls().length===1&&await f.idle(id)));
 assert.ok(await f.until(()=>pushes(id)===1),'a reply nobody is watching pushes');
 // Open in a browser while the reply finishes: the chime plays there, no push.
 assert.equal((await f.call(`/session/${id}/message`,msg('__SLOW__ watched'))).status,202);
 const open=new AbortController(),stream=await f.events(id,open.signal);
 assert.ok(await f.until(async()=>f.calls().length===2&&await f.idle(id),6000));
 await sleep(500);open.abort();await stream.body?.cancel().catch(()=>{});
 assert.equal(pushes(id),1,'no push while the conversation is open');
 // Stopped by the user: no push.
 assert.equal((await f.call(`/session/${id}/message`,msg('__HANG__ stop me'))).status,202);
 assert.ok(await f.until(()=>f.calls().length===3));await sleep(200);
 assert.equal((await f.call(`/session/${id}/stop`,{})).status,200);
 assert.ok(await f.until(async()=>await f.idle(id),6000));
 await sleep(500);
 assert.equal(pushes(id),1,'no push for a stopped reply');
});

test('a permissions change reopens the app-server; a silent Codex turn is stopped by the stall watchdog',async t=>{
 const f=await fixture(t,18404,{POCKET_STALL_MS:'1200'});
 const id=(await f.call('/new',{cwd:repo,provider:'codex',approvalMode:'review',...msg('first')})).body.id;
 assert.ok(await f.until(async()=>f.calls().length===1&&await f.idle(id)));
 assert.equal((await f.call(`/session/${id}/message`,msg('full access now',{approvalMode:'full'}))).status,202);
 assert.ok(await f.until(async()=>f.calls().length===2&&await f.idle(id)));
 assert.equal(new Set(f.calls().map(c=>c.pid)).size,2,'new process for new permissions');
 assert.equal(await f.procs(),1,'old process closed');
 assert.equal((await f.call(`/session/${id}/message`,msg('__HANG__'))).status,202);
 assert.ok(await f.until(()=>/codex turn STALLED/.test(f.logs()),6000));
 assert.ok(await f.until(async()=>await f.idle(id),6000),'stalled turn ended');
});

test('a Pocket restart reattaches to the Codex process, mid-turn and between turns',async t=>{
 const f=await fixture(t,18405);
 const id=(await f.call('/new',{cwd:repo,provider:'codex',...msg('__SLOW__ survive a restart')})).body.id;
 assert.ok(await f.until(()=>f.calls().length===1));
 await f.stop();await f.start();
 assert.match(f.logs(),/adopted codex session thread=.* turn=true/);
 assert.equal(await f.procs(),1,'process adopted');
 assert.ok(await f.until(async()=>await f.idle(id),6000),'in-flight turn finished after the restart');
 assert.equal((await f.call(`/session/${id}/message`,msg('after restart'))).status,202);
 assert.ok(await f.until(async()=>f.calls().length===2&&await f.idle(id)));
 assert.equal(new Set(f.calls().map(c=>c.pid)).size,1,'the restarted server wrote into the same app-server');
 // and once more while idle
 await f.stop();await f.start();
 assert.match(f.logs(),/adopted codex session thread=.* turn=false/);
 assert.equal((await f.call(`/session/${id}/message`,msg('after idle restart'))).status,202);
 assert.ok(await f.until(async()=>f.calls().length===3&&await f.idle(id)));
 assert.equal(new Set(f.calls().map(c=>c.pid)).size,1);
});

const threadCalls=f=>{try{return fs.readFileSync(path.join(f.dir,'calls.threads'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)}catch{return []}};
test('Codex threads get the reply-suggestion instruction unless the Codex config sets its own',async t=>{
 const f=await fixture(t,18661);
 const id=(await f.call('/new',{cwd:repo,provider:'codex',...msg('first')})).body.id;
 assert.ok(await f.until(async()=>f.calls().length===1&&await f.idle(id)));
 assert.deepEqual(threadCalls(f).map(c=>c.choices),[true]);
 assert.deepEqual(threadCalls(f).map(c=>c.google),[true],'1.68: Codex threads carry the pocket-google line too');
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-codex-home-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 fs.writeFileSync(path.join(home,'config.toml'),'developer_instructions = "Operator rules"\n');
 const g=await fixture(t,18701,{CODEX_HOME:home});
 const id2=(await g.call('/new',{cwd:repo,provider:'codex',...msg('first')})).body.id;
 assert.ok(await g.until(async()=>g.calls().length===1&&await g.idle(id2)));
 assert.deepEqual(threadCalls(g).map(c=>c.choices),[false],'an operator\'s developer_instructions are never replaced');
});


test('Codex subagent projection survives reconnect and never resumes a child thread',async t=>{
 const f=await fixture(t,18419);
 const id=(await f.call('/new',{cwd:repo,provider:'codex',...msg('__AGENTS__ __SLOW__')})).body.id;
 assert.ok(await f.until(()=>f.calls().length===1));
 const running=(await f.call(`/session/${id}/agents`)).body;
 assert.equal(running.running,1);assert.equal(running.total,1);assert.equal(running.agents[0].task,'Check parser failures');
 await f.stop();await f.start();
 assert.ok(await f.until(async()=>await f.idle(id),6000));
 const done=(await f.call(`/session/${id}/agents`)).body;
 assert.equal(done.running,0);assert.equal(done.agents[0].status,'completed');assert.equal(done.agents[0].latest,'Parser checks passed.');
 const connections=fs.readFileSync(path.join(f.dir,'calls.threads'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(connections.length,1,'activity reads never start/resume an extra thread');
});

// 1.53.4: the agents poll runs every 5 s for the open conversation; after one walk of the thread it
// asks only for the newest page, and a completion that arrives later still reaches the panel.
test('a repeated Codex agents poll fetches one newest-first page, not the whole thread',async t=>{
 const f=await fixture(t,18841);
 const itemCalls=()=>{try{return fs.readFileSync(path.join(f.dir,'calls.items'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)}catch{return []}};
 const id=(await f.call('/new',{cwd:repo,provider:'codex',...msg('__AGENTS__ __SLOW__')})).body.id;
 assert.ok(await f.until(()=>f.calls().length===1));
 const first=(await f.call(`/session/${id}/agents`)).body;
 assert.equal(first.total,1);
 const walk=itemCalls();
 assert.ok(walk.length>=1&&walk.every(c=>!c.desc),'the first read walks the thread oldest-first');
 await sleep(4100); // the slow fake turn ends at 1.5 s; the route reuses its previous answer for 4 s. No session reads: those walk the thread too.
 const second=(await f.call(`/session/${id}/agents`)).body;
 const later=itemCalls().slice(walk.length);
 assert.deepEqual(later.map(c=>[c.desc,c.limit]),[[true,50]],'the second read asks for one newest-first page');
 assert.equal(second.running,0);assert.equal(second.agents[0].status,'completed');assert.equal(second.agents[0].latest,'Parser checks passed.');
});

// 1.53.5: a Codex conversation opens newest-first in small pages, keeps what it read per thread (memory and
// disk), and never carries an image payload past the parser.
test('a Codex conversation opens newest-first, caches the transcript across restarts and drops image bytes',async t=>{
 const f=await fixture(t,18881);
 const itemCalls=()=>{try{return fs.readFileSync(path.join(f.dir,'calls.items'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)}catch{return []}};
 const id=(await f.call('/new',{cwd:repo,provider:'codex',...msg('first')})).body.id,tid=id.slice(3);
 assert.ok(await f.until(()=>f.calls().length===1));await sleep(600); // the fake turn ends at 200 ms; no session read yet, so the first open builds the cache
 const itemsFile=path.join(f.dir,'sessions',tid+'.items.json');
 const img=()=>({turnId:'t1',item:{type:'imageGeneration',id:randomUUID(),prompt:'a diagram',data:'A'.repeat(3*1024*1024)}});
 const items=[{turnId:'t1',item:{type:'userMessage',id:randomUUID(),content:[{type:'text',text:'hello'}]}}];
 for(let i=0;i<125;i++)items.push(i===30||i===90?img():{turnId:'t1',item:{type:'agentMessage',id:randomUUID(),text:'m'+i}});
 items.push({turnId:'t1',item:{type:'agentMessage',id:randomUUID(),text:'latest'}});
 fs.writeFileSync(itemsFile,JSON.stringify(items));
 const before=itemCalls().length;
 const r1=await f.call(`/session/${id}`);
 assert.equal(r1.status,200);
 const texts=m=>m.messages.flatMap(x=>x.role==='user'?[x.text]:x.blocks.filter(b=>b.t==='text').map(b=>b.text));
 assert.equal(texts(r1.body)[0],'hello');assert.ok(texts(r1.body).at(-1).includes('latest'));
 assert.ok(JSON.stringify(r1.body).length<200_000,'no image bytes reach the response');
 const open=itemCalls().slice(before);
 assert.ok(open.length>=4&&open.every(c=>c.desc&&c.limit===40),'the open pages newest-first in 40s: '+JSON.stringify(open));
 const n1=itemCalls().length;
 const r2=await f.call(`/session/${id}`);
 assert.deepEqual(itemCalls().slice(n1).map(c=>[c.desc,c.limit,c.cursor]),[[true,40,null]],'a reopen fetches one newest page');
 assert.equal(texts(r2.body).length,texts(r1.body).length);
 items.push({turnId:'t2',item:{type:'agentMessage',id:randomUUID(),text:'newer'}});fs.writeFileSync(itemsFile,JSON.stringify(items));
 const r3=await f.call(`/session/${id}`);
 assert.ok(texts(r3.body).at(-1).includes('newer'),'news on the newest page is merged');
 await sleep(1300); // the cache file is written a second after a change
 await f.stop();await f.start();
 const n3=itemCalls().length;
 const r4=await f.call(`/session/${id}`);
 assert.deepEqual(itemCalls().slice(n3).map(c=>[c.desc,c.limit,c.cursor]),[[true,40,null]],'after a restart the disk cache needs one newest page');
 assert.deepEqual(texts(r4.body),texts(r3.body));
 assert.ok(fs.existsSync(path.join(f.dir,'data','codex-transcripts',tid+'.json')),'cache file in the data dir');
});

test('a just-sent Codex message shows as pending until the reader has it, and never twice',async t=>{
 const f=await fixture(t,18781);
 const id=(await f.call('/new',{cwd:repo,provider:'codex',...msg('setup')})).body.id;
 assert.ok(await f.until(()=>f.idle(id)));
 const users=async()=>(await f.call(`/session/${id}`)).body.messages.filter(m=>m.role==='user');
 for(const text of ['__SLOW__ __LATEUSER__ please check the logs','__SLOW__ __LATEUSER__ __ATTACHNOTE__ what is in this photo']){
  assert.equal((await f.call(`/session/${id}/message`,msg(text))).status,202);
  assert.deepEqual((await users()).at(-1),{role:'user',text,pending:true},'shown right away, marked pending');
  assert.ok(await f.until(async()=>{const x=await users();return x.at(-1).text.startsWith(text)&&!x.at(-1).pending;}),'replaced by the history item once the reader has it');
  assert.equal((await users()).filter(m=>m.text.startsWith(text)).length,1,'never twice, attachment note or not');
  assert.ok(await f.until(()=>f.idle(id)));
  assert.equal((await users()).some(m=>m.pending),false,'nothing pending once the turn ends');
 }
});

// 1.73.3: a line that parses as JSON but is not an object (a real app-server wrote a bare `null`) threw inside the reader's
// timer and took the whole daemon down.
test('a non-object JSON frame from the app-server is ignored; the daemon and the turn carry on',async t=>{
 const s=await fixture(t,19771);
 const made=await s.call('/new',{cwd:repo,provider:'codex',...msg('__NULLFRAME__ hello')});assert.equal(made.status,202);
 assert.ok(await s.until(async()=>s.calls().length===1&&await s.idle(made.body.id)),'the turn finished: '+s.logs().slice(-600));
 assert.equal((await s.call('/health')).status,200,'the daemon is still up');
 assert.doesNotMatch(s.logs(),/drain failed|TypeError/);
});

// 1.73.7: closing a session escalates. Before, a hung app-server that ignored SIGTERM kept running (and kept the thread's
// writer lock) after the close resolved.
test('closing a Codex session kills an app-server that ignores SIGTERM',async t=>{
 const f=await fixture(t,19781,{FAKE_CODEX_STUBBORN:'1'});
 const id=(await f.call('/new',{cwd:repo,provider:'codex',...msg('first')})).body.id;
 assert.ok(await f.until(async()=>f.calls().length===1&&await f.idle(id)));
 assert.equal((await f.call(`/session/${id}/release`,{})).body.released,true);
 await sleep(1500);assert.equal(await f.procs(),1,'it ignored SIGTERM');
 assert.ok(await f.until(async()=>await f.procs()===0,9000),'killed after the grace period');
 assert.match(f.logs(),/did not exit after SIGTERM; killing/);
});

// 1.73.7: the session record proves which process it names. Before, a stale record after a reboot made Pocket SIGTERM whatever
// process group now had the recorded pid; the keeper inherited the daemon's secrets; the record was rewritten in place.
const BOOT=(()=>{try{return fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();}catch{return null;}})();
test('adoption signals nothing it cannot prove is its own; the keeper gets the agent environment; the record is replaced whole',{skip:!BOOT&&'needs /proc'},async t=>{
 const f=await fixture(t,19791);
 const id=(await f.call('/new',{cwd:repo,provider:'codex',...msg('first')})).body.id;
 assert.ok(await f.until(async()=>f.calls().length===1&&await f.idle(id)));
 const logDir=path.join(f.dir,'data','turnlogs-codex'),metaFile=fs.readdirSync(logDir).find(n=>n.endsWith('.session.json'));
 const meta=()=>JSON.parse(fs.readFileSync(path.join(logDir,metaFile),'utf8'));
 const m=meta();assert.equal(m.bootId,BOOT);assert.match(String(m.pidStart),/^\d+$/);assert.match(String(m.keeperStart),/^\d+$/);
 const environ=fs.readFileSync(`/proc/${m.keeperPid}/environ`,'utf8').split('\0');
 assert.ok(!environ.some(e=>/^POCKET_(PASSWORD|SECRET)=/.test(e)),'the keeper does not carry the daemon secrets');
 const inode=fs.statSync(path.join(logDir,metaFile)).ino;
 assert.equal((await f.call(`/session/${id}/message`,msg('again'))).status,202);
 assert.ok(await f.until(async()=>f.calls().length===2&&await f.idle(id)));
 assert.notEqual(fs.statSync(path.join(logDir,metaFile)).ino,inode,'rewritten through a temporary file and a rename');
 assert.ok(!fs.readdirSync(logDir).some(n=>n.endsWith('.tmp')));
 // Stale records: from another boot, with the wrong start times, and a pre-1.73.7 record written before this boot.
 await f.stop();
 const live=[];const proc=tag=>{const p=spawn('sh',['-c','sleep 30; :',tag],{detached:true,stdio:'ignore'});live.push(p.pid);return p.pid;};
 t.after(()=>{for(const p of live){try{process.kill(-p,'SIGKILL');}catch{}}});
 const plant=(key,extra,old)=>{const file=path.join(logDir,key+'.session.json');fs.writeFileSync(file,JSON.stringify({threadId:'stale-'+key,pid:proc('app-server'),keeperPid:proc('pocket-keeper'),key,approvalMode:'review',cwd:repo,turn:null,...extra}));if(old)fs.utimesSync(file,new Date('2001-01-01'),new Date('2001-01-01'));};
 plant('aaa1',{bootId:'00000000-0000-0000-0000-000000000000'});
 plant('bbb2',{bootId:BOOT,pidStart:'1',keeperStart:'1'});
 plant('ccc3',{},true);
 await sleep(200);await f.start();
 await sleep(800);
 for(const p of live)assert.ok((()=>{try{process.kill(p,0);return true;}catch{return false;}})(),`process ${p} was not signalled`);
 assert.match(f.logs(),/thread=stale-aaa1 \(from an earlier boot; nothing signalled\)/);assert.match(f.logs(),/thread=stale-ccc3 \(from an earlier boot/);
 assert.match(f.logs(),/codex session ended while the server was down thread=stale-bbb2$/m);
 for(const k of ['aaa1','bbb2','ccc3'])assert.equal(fs.existsSync(path.join(logDir,k+'.session.json')),false,'stale records are removed');
 assert.equal(await f.procs(),1,'the real session was still adopted');
});

// 1.73.8: reads of one thread no longer interleave. Two opens at once each walked the thread into the same cache, and two
// agents polls each walked it, so an older walk could replace a newer merge; a hand-corrupted row in the transcript cache
// made the thread unopenable.
test('concurrent opens and agents polls of one Codex thread share the work; a null row in the cache file is dropped',async t=>{
 const f=await fixture(t,19821);
 const itemCalls=()=>{try{return fs.readFileSync(path.join(f.dir,'calls.items'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)}catch{return []}};
 const id=(await f.call('/new',{cwd:repo,provider:'codex',...msg('first')})).body.id,tid=id.slice(3);
 assert.ok(await f.until(()=>f.calls().length===1));await sleep(600);
 const items=[{turnId:'t1',item:{type:'userMessage',id:randomUUID(),content:[{type:'text',text:'hello'}]}}];
 for(let i=0;i<125;i++)items.push({turnId:'t1',item:{type:'agentMessage',id:randomUUID(),text:'m'+i}});
 fs.writeFileSync(path.join(f.dir,'sessions',tid+'.items.json'),JSON.stringify(items));
 let n=itemCalls().length;
 const [a,b]=await Promise.all([f.call(`/session/${id}`),f.call(`/session/${id}`)]);
 assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(a.body.messages.length,b.body.messages.length);
 assert.equal(itemCalls().length-n,5,'one walk of four pages, then one newest page for the second open');
 n=itemCalls().length;
 const [x,y]=await Promise.all([f.call(`/session/${id}/agents`),f.call(`/session/${id}/agents`)]);
 assert.equal(x.status,200);assert.equal(y.status,200);
 assert.equal(itemCalls().slice(n).filter(c=>!c.desc&&c.cursor==null).length,1,'one walk for two agents polls');
 await sleep(1300);await f.stop();
 const cache=path.join(f.dir,'data','codex-transcripts',tid+'.json'),o=JSON.parse(fs.readFileSync(cache,'utf8'));
 o.entries.splice(1,0,null);fs.writeFileSync(cache,JSON.stringify(o));
 await f.start();
 const after=await f.call(`/session/${id}`);assert.equal(after.status,200,'opens with a null row in its cache file');assert.equal(after.body.messages.length,a.body.messages.length);
});
