// Casey's 1.88.1 review, group procA: side chat and Codex process lifecycles (F-2, F-4, F-12). Fake CLIs only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const lines=f=>{try{return fs.readFileSync(f,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)}catch{return []}};
const msg=(text,extra={})=>({text,clientMessageId:randomUUID(),...extra});

// A daemon on a temp data dir with the fake CLIs; `env` overrides (CLAUDE_BIN, side chat settings).
async function daemon(t,port,env={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-procA-'));
 const secret=randomUUID(),exp=Date.now()+3600000;
 const headers={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
 fs.mkdirSync(path.join(dir,'sessions','test-workspace'),{recursive:true});
 let child,logs='';const cleanup=[];
 const start=async()=>{
  child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),POCKET_SKILLS:'0',PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_VOICE:'off',POCKET_MEMSTEM:'0',
   POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),CODEX_BIN:path.join(repo,'test/fake-codex.mjs'),
   ...(typeof env==='function'?env(dir):env)},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
  for(let i=0;i<150;i++){if(child.exitCode!==null)break;try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)return;}catch{} await sleep(30);}
  if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=37;logs='';return start();} // never talk to a foreign server
  throw Error('Test server failed: '+logs);
 };
 t.after(async()=>{for(const f of cleanup)try{f();}catch{}if(child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}await sleep(300);fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});});
 await start();
 const call=async(p,body,method)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:method||(body?'POST':'GET'),headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null)};};
 const until=async(fn,ms=6000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return true;await sleep(100)}return false;};
 return {dir,call,until,cleanup,logs:()=>logs};
}

// F-2. A Codex side chat's Stop sends turn/interrupt and drops its failure (sidechat.mjs:121). When the side chat's own
// app-server hangs, the interrupt times out (60 s, the request default), nothing else happens, and the chat stays busy;
// the idle timer re-arms while busy (sidechat.mjs:143), so it is never idle-closed either. The fix ends the side chat's
// app-server on an interrupt error or timeout, so within the interrupt's timeout the chat is no longer busy.
test('F-2: Stop on a hung Codex side chat ends it when the interrupt goes unanswered, instead of leaving it busy for good',{timeout:120000},async t=>{
 const f=await daemon(t,21841,{POCKET_SIDE_CHAT_IDLE_MS:'1000'});
 const parent=(await f.call('/new',{cwd:repo,provider:'codex',...msg('Plan the camera rollout')})).body.id;
 assert.match(parent,/^cx:/);assert.ok(await f.until(async()=>!(await f.call(`/session/${parent}`)).body?.active));
 const s=await f.call(`/session/${parent}/side`,{text:'Long one __HANG__'});
 assert.equal(s.status,202);assert.equal(s.body.provider,'codex');
 await sleep(400);
 // The side chat's own app-server (the one that answered its ephemeral fork) hangs: it reads nothing and answers nothing.
 const pid=lines(path.join(f.dir,'calls.forks')).filter(x=>x.side).at(-1).pid;assert.ok(alive(pid));
 process.kill(pid,'SIGSTOP');f.cleanup.push(()=>{process.kill(pid,'SIGCONT');process.kill(pid,'SIGKILL');});
 assert.equal((await f.call(`/side/${s.body.side}/stop`,{})).status,200,'Stop is accepted');
 const t0=Date.now();
 const settled=await f.until(async()=>{const c=(await f.call(`/session/${parent}/side`)).body.chat;return !c||!c.busy;},75000);
 const chat=(await f.call(`/session/${parent}/side`)).body.chat;
 assert.ok(settled,`${Math.round((Date.now()-t0)/1000)} s after Stop, past the interrupt's 60 s timeout and dozens of 1 s idle periods, the side chat is still ${JSON.stringify(chat)}; its app-server pid ${pid} is still running: ${alive(pid)}`);
});

// F-4. A Claude side chat's CLI is spawned without its own process group (sidechat.mjs:73); closing it ends stdin and
// SIGTERMs that one pid after 3 s, only if it is still running (:133-135). A program the CLI started outlives the side chat.
// The CLI here is the fake behind a wrapper that starts a long-lived child first (the role a Grep's ripgrep or any helper
// plays), then execs the fake, so the child's parent is the side chat's process. The fix spawns it detached and signals
// the group on close, so the child is gone a few seconds after the side chat closes.
test('F-4: closing a Claude side chat also ends programs its CLI started',{timeout:60000},async t=>{
 const f=await daemon(t,21843,dir=>{
  const bin=path.join(dir,'claude-with-child.sh');
  fs.writeFileSync(bin,`#!/bin/sh\ncase " $* " in *" --fork-session "*"--no-session-persistence "*) sleep 300 </dev/null >/dev/null 2>&1 & echo $! >> "${path.join(dir,'side-children')}";; esac\nexec "${process.execPath}" "${path.join(repo,'test/fake-claude.mjs')}" "$@"\n`,{mode:0o755});
  return {CLAUDE_BIN:bin,POCKET_CODEX:'0'};
 });
 const ws=path.join(f.dir,'sessions','test-workspace'),id=randomUUID();
 const line=o=>JSON.stringify({...o,cwd:repo,sessionId:id,timestamp:new Date().toISOString()});
 fs.writeFileSync(path.join(ws,id+'.jsonl'),[line({type:'user',message:{role:'user',content:'Plan the camera upgrade'}}),line({type:'assistant',message:{role:'assistant',content:[{type:'text',text:'Here is the plan.'}]}})].join('\n')+'\n');
 const s=await f.call(`/session/${id}/side`,{text:'Why this plan?'});
 assert.equal(s.status,202);
 assert.ok(await f.until(async()=>(await f.call(`/session/${id}/side`)).body.chat?.busy===false),'the side chat answered');
 const kids=fs.readFileSync(path.join(f.dir,'side-children'),'utf8').trim().split('\n').map(Number);
 assert.equal(kids.length,1);const kid=kids[0];f.cleanup.push(()=>process.kill(kid,'SIGKILL'));
 assert.ok(alive(kid),'the CLI\'s child runs while the side chat is open');
 assert.equal((await f.call(`/side/${s.body.side}`,undefined,'DELETE')).status,200);
 assert.equal((await f.call(`/session/${id}/side`)).body.chat,null,'the side chat is closed');
 const gone=await f.until(()=>!alive(kid),6000); // the 3 s grace, then some
 assert.ok(gone,`6 s after the side chat closed, the program its CLI started (pid ${kid}) is still running`);
});

// F-12. closeCodexSession escalates to SIGKILL at 5 s and then resolves 2 s later whether or not the app-server has exited
// (codex.mjs:966); its only trace is a log line. A caller that awaits it (startCodexTurn's settings change, codex.mjs:1129)
// then starts a replacement. A process that outlives SIGKILL by seconds (stuck in uninterruptible I/O) cannot be produced by
// the fake, so this stands in a live process the group SIGKILL cannot reach: a `sleep` that is not a group leader, so
// kill(-pid) finds no group. The fix resolves only on a confirmed exit (or rejects); here the close must not report done
// while the process lives, and must complete once the session's exit hook fires.
test('F-12: closing a Codex session does not report it closed while its app-server is still running',{timeout:30000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-procA-close-'));
 const env={...cleanEnv(),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_TEST_CALLS:path.join(dir,'calls'),CODEX_BIN:path.join(repo,'test/fake-codex.mjs')};
 fs.mkdirSync(path.join(dir,'sessions'));
 const code=`import fs from 'node:fs';import {spawn} from 'node:child_process';
const c=await import(${JSON.stringify(path.join(repo,'codex.mjs'))});
const sleeper=spawn('sleep',['60'],{stdio:'ignore'});await new Promise(r=>sleeper.once('spawn',r));
const pgid=Number(fs.readFileSync('/proc/'+sleeper.pid+'/stat','utf8').split(') ')[1].split(' ')[2]);
if(!(sleeper.pid>1)||pgid===sleeper.pid){sleeper.kill('SIGKILL');throw Error('unsafe: the stand-in leads a group');}
const alive=p=>{try{process.kill(p,0);return true;}catch{return false;}};
const s={threadId:'f12-thread',conn:{pid:sleeper.pid,close(){}}};let state='pending';
c.closeCodexSession(s,'test').then(()=>{state='resolved';},()=>{state='rejected';});
await new Promise(r=>setTimeout(r,8500));
const at8s={state,alive:alive(sleeper.pid)};
sleeper.kill('SIGKILL');await new Promise(r=>sleeper.once('exit',r));
s.exited=true;s.exitResolve?.();await new Promise(r=>setTimeout(r,300));
process.stdout.write('\\nRESULT '+JSON.stringify({at8s,afterExit:state})+'\\n');process.exit(0);`;
 const out=await new Promise((resolve,reject)=>execFile(process.execPath,['--input-type=module','-e',code],{env,timeout:25000},(e,o,err)=>e?reject(new Error(err||e.message)):resolve(o)));
 fs.rmSync(dir,{recursive:true,force:true});
 const r=JSON.parse(/^RESULT (.*)$/m.exec(out)[1]);
 assert.match(out,/did not exit after SIGTERM; killing/);
 assert.equal(r.at8s.alive,true,'the stand-in is still running 3.5 s after the SIGKILL');
 assert.notEqual(r.at8s.state,'resolved',`the close resolved while the app-server pid was still running (${out.match(/still running after SIGKILL.*/)?.[0]||'no log'})`);
 assert.equal(r.afterExit,'resolved','the close completes once the process has exited');
});
