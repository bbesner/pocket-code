import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));

async function fixture(t,port,env={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-codex-'));
 const secret=randomUUID(),exp=Date.now()+3600000;
 const headers={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
 let child,logs='';
 const start=async()=>{
  child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:process.env.TEST_AUTO_TITLES??'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),CODEX_BIN:path.join(repo,'test/fake-codex.mjs'),...env},stdio:['ignore','pipe','pipe']});
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
 return {dir,call,calls,until,procs,idle,start,stop,logs:()=>logs};
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
