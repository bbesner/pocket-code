// Casey's 1.88.1 review, group procB: the Claude runner lifecycle in server.mjs (F-8 to F-11).
// Each test drives a real daemon on a temp data dir with the fake CLI; test/casey-1881-stubborn-claude.mjs is
// fake-claude.mjs as a CLI that hangs when its input closes (and, if asked, ignores SIGTERM).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CASEY)_/.test(k)));
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const STUBBORN=path.join(repo,'test/casey-1881-stubborn-claude.mjs');

// The runner test fixture (test/runner.test.mjs), plus the turnlog dir and a log reset per daemon start.
async function fixture(t,port,env={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-procB-'));
 const secret=randomUUID(),exp=Date.now()+3600000;
 const cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
 const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
 let child,logs='';
 const start=async()=>{
  child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),POCKET_SKILLS:'0',PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),...env},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
  for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
  if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=41;logs='';return start();}
  throw Error('Test server failed: '+logs);
 };
 const stop=async()=>{if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}};
 const call=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()}};
 const calls=()=>fs.existsSync(path.join(dir,'calls'))?fs.readFileSync(path.join(dir,'calls'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 const state=async id=>(await call('/sessions')).body.sessions.find(s=>s.id===id)?.state.kind;
 const until=async(fn,ms=5000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return true;await sleep(50)}return false;};
 const pids=()=>new Set(calls().map(c=>c.pid));
 const transcriptFile=id=>path.join(dir,'sessions','test-workspace',id+'.jsonl');
 const transcript=id=>{try{return fs.readFileSync(transcriptFile(id),'utf8')}catch{return ''}};
 const killAll=()=>{for(const pid of pids()){try{process.kill(-pid,'SIGKILL')}catch{try{process.kill(pid,'SIGKILL')}catch{}}}};
 t.after(async()=>{await stop();killAll();fs.rmSync(dir,{recursive:true,force:true});});
 fs.mkdirSync(path.join(dir,'sessions','test-workspace'),{recursive:true});
 await start();
 return {dir,turnlogs:path.join(dir,'data','turnlogs'),start,stop,call,calls,state,until,pids,transcript,transcriptFile,logs:()=>logs};
}
const msg=text=>({text,clientMessageId:randomUUID()});
// Moves the last transcript line's timestamp two minutes back (same length, so recorded sizes stay valid): the
// other-app busy check (45 s) then lets a message through, as it would once that time had passed.
const ageLastLine=file=>{const lines=fs.readFileSync(file,'utf8').split('\n');const i=lines.findLastIndex(l=>l.trim());const o=JSON.parse(lines[i]);o.timestamp=new Date(Date.now()-120_000).toISOString();lines[i]=JSON.stringify(o);fs.writeFileSync(file,lines.join('\n'));};

// F-8: a process that cannot be reused is asked to close (EOF) and its replacement starts at once; the only fallback
// is SIGTERM after 30 s (closeRunner, signalTurn). A CLI that hangs and ignores TERM keeps running beside its
// replacement for good. Fixed: the replacement gets the prompt only once the old one has exited, and the close
// escalates to SIGKILL.
test('F-8: a replaced process has exited before its successor gets the prompt, and a TERM-proof one is killed',{timeout:120_000},async t=>{
 const f=await fixture(t,21381,{CLAUDE_BIN:STUBBORN,CASEY_STUBBORN:'hang-ignore-term'});
 const id=(await f.call('/new',{cwd:repo,...msg('first')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='finished'));
 const old=f.calls()[0].pid;
 const sentAt=Date.now();
 assert.equal((await f.call(`/session/${id}/message`,{...msg('second'),model:'claude-haiku-4-5'})).status,202);
 assert.ok(await f.until(()=>f.calls().length===2,70_000),'the replacement got the prompt');
 const overlap=alive(old); // both CLIs alive on one conversation
 await f.until(()=>!alive(old),Math.max(0,45_000-(Date.now()-sentAt)));
 assert.match(f.logs(),/reason=model changed/);
 assert.deepEqual({oldAliveWhenReplacementStarted:overlap,oldAlive45sAfterClose:alive(old)},{oldAliveWhenReplacementStarted:false,oldAlive45sAfterClose:false});
});

// F-9: reuse is refused as "continued in another app" when a user or assistant line follows the size recorded at
// our last finalized turn. A turn the CLI starts by itself while the daemon runs is finalized and recorded (guard,
// checked first). One it runs while the daemon is down (a restart while a background job runs) never is: adoption
// tails from the end of the output log, so the live CLI's own lines count as another app's and it is replaced.
test('F-9: lines Pocket\'s own live CLI wrote across a restart do not count as another app',{timeout:60_000},async t=>{
 const f=await fixture(t,21391,{POCKET_TEST_BG_MS:'2500'});
 const id=(await f.call('/new',{cwd:repo,...msg('__BG__ live')})).body.id;
 assert.ok(await f.until(()=>f.transcript(id).includes('The background job finished.'),8000));
 assert.ok(await f.until(async()=>(f.logs().match(/turn done session=/g)||[]).length===2&&await f.state(id)==='finished'));
 assert.equal((await f.call(`/session/${id}/message`,msg('after the live job'))).status,202);
 assert.ok(await f.until(async()=>f.calls().length===2&&await f.state(id)==='finished'));
 assert.equal(f.pids().size,1,'guard: a self-started turn with the daemon up moves the recorded size');
 // the same with the daemon down when the job finishes
 assert.equal((await f.call(`/session/${id}/message`,msg('__BG__ again'))).status,202);
 assert.ok(await f.until(async()=>f.calls().length===3&&await f.state(id)==='background'));
 await f.stop();
 assert.ok(await f.until(()=>(f.transcript(id).match(/The background job finished\./g)||[]).length===2,8000),'the live CLI reported its job while the daemon was down');
 ageLastLine(f.transcriptFile(id));
 await f.start();
 assert.ok(await f.until(()=>/adopted session process/.test(f.logs())));
 assert.equal((await f.call(`/session/${id}/message`,msg('after the restart'))).status,202);
 assert.ok(await f.until(async()=>f.calls().length===4&&await f.state(id)==='finished'));
 assert.deepEqual({processes:f.pids().size,replacedAs:(f.logs().match(/reason=(continued in another app)/)||[])[1]||null},{processes:1,replacedAs:null});
});

// F-10: adoption installs every live marker that names the session (runners.set, last in readdir order wins) and
// stops none. Two markers for one session exist whenever a closing process outlives its replacement's start
// (F-8's overlap) and the daemon restarts. Fixed: the newest is adopted and the others are stopped.
test('F-10: after a restart with two live processes for one session, the newer is adopted and the older stopped',{timeout:60_000},async t=>{
 const f=await fixture(t,21401,{CLAUDE_BIN:STUBBORN,CASEY_STUBBORN:'hang'});
 const id=(await f.call('/new',{cwd:repo,...msg('first')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='finished'));
 // Since F-8's fix a replacement starts only once its predecessor has exited, so the duplicate is made the way a 1.88.1
 // daemon could leave one: the first process's marker is set aside while a second process starts for the session.
 const markers=()=>fs.readdirSync(f.turnlogs).filter(n=>n.startsWith(id)&&n.endsWith('.runner.json'));
 const first=path.join(f.turnlogs,markers()[0]),aside=path.join(f.dir,'aside.runner');
 await f.stop();fs.renameSync(first,aside);await f.start();
 assert.equal((await f.call(`/session/${id}/message`,{...msg('second'),model:'claude-haiku-4-5'})).status,202);
 assert.ok(await f.until(async()=>f.calls().length===2&&await f.state(id)==='finished'));
 const [older,newer]=f.calls().map(c=>c.pid);
 assert.ok(alive(older)&&alive(newer),'the earlier process still runs beside the later one');
 await f.stop();fs.renameSync(aside,first);
 assert.equal(markers().length,2,'two markers for one session');
 await f.start();
 const adopted=[...f.logs().matchAll(new RegExp(`adopted session process session=${id} pid=(\\d+)`,'g'))].map(m=>Number(m[1]));
 await f.until(()=>!alive(older),10_000);
 assert.equal((await f.call(`/session/${id}/message`,{...msg('third'),model:'claude-haiku-4-5'})).status,202);
 await f.until(async()=>f.calls().length===3&&await f.state(id)==='finished',8000);
 assert.deepEqual({adopted,olderAlive:alive(older),thirdWentTo:f.calls()[2]?.pid===newer?'newer':f.calls()[2]?.pid===older?'older':String(f.calls()[2]?.pid)},
  {adopted:[newer],olderAlive:false,thirdWentTo:'newer'});
});

// F-11: writeRunnerMeta swallows a failed write and spawnRunner carries on, so the CLI runs with no marker and a
// restart can neither adopt nor stop it. The failure is forced by occupying the marker's path with a directory
// (rename onto a directory fails) for every key the next spawn could take. Fixed: the start is refused when the
// marker cannot be written, or a restart still finds the process.
test('F-11: a process whose marker could not be written is not left running unmanaged after a restart',{timeout:60_000},async t=>{
 const f=await fixture(t,21411);
 const id=(await f.call('/new',{cwd:repo,...msg('first')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='finished'));
 const now=Date.now(),squat=[];
 for(let k=now;k<now+8000;k++){const p=path.join(f.turnlogs,`${id}.${k.toString(36)}.runner.json`);fs.mkdirSync(p);squat.push(p);}
 const sent=await f.call(`/session/${id}/message`,{...msg('second'),model:'claude-haiku-4-5'});
 if(sent.status===202)await f.until(async()=>f.calls().length===2&&await f.state(id)==='finished');
 const started=f.calls()[1]?.pid;
 const markers=fs.readdirSync(f.turnlogs).filter(n=>n.startsWith(id)&&n.endsWith('.runner.json')&&fs.statSync(path.join(f.turnlogs,n)).isFile());
 for(const p of squat)fs.rmdirSync(p); // the disk recovers before the restart
 await f.stop();await f.start();
 await sleep(500);
 const adopted=started?new RegExp(`adopted session process session=${id} pid=${started}`).test(f.logs()):false;
 assert.deepEqual({status:sent.status,markerFiles:markers.length,unmanagedAfterRestart:Boolean(started&&alive(started)&&!adopted)},
  {status:sent.status,markerFiles:markers.length,unmanagedAfterRestart:false});
});

// 1.89 review finding 4: the short close steps (SIGTERM 3 s after EOF) are for a replacement only. An ordinary close
// (here idle) keeps its 30 s grace before SIGTERM, for SessionEnd hooks and MCP shutdowns.
test('F-8: an idle close still leaves a slow CLI its 30 s grace; only a replacement uses the short steps',{timeout:60_000},async t=>{
 const f=await fixture(t,21421,{CLAUDE_BIN:STUBBORN,CASEY_STUBBORN:'hang',POCKET_IDLE_CLOSE_MS:'500'});
 const id=(await f.call('/new',{cwd:repo,...msg('first')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='finished'));
 const old=f.calls()[0].pid;
 assert.ok(await f.until(()=>/reason=idle/.test(f.logs()),5000),'the idle close ran');
 await sleep(7500); // past the short steps (3 s + 3 s)
 assert.deepEqual({alive:alive(old),signalled:/session process still running after EOF; sending SIGTERM/.test(f.logs())},{alive:true,signalled:false});
});

// 1.89 review finding 6: the waiting reply was only in memory, and the closing process's marker says closing, so a restart
// in the wait stopped that process and nothing sent the user's text. It is now held in the follow-up queue and runs once
// the stopped process has gone.
test('F-8: a restart while a reply waits for the closing process runs that reply afterwards',{timeout:60_000},async t=>{
 const f=await fixture(t,21431,{CLAUDE_BIN:STUBBORN,CASEY_STUBBORN:'hang-ignore-term'});
 const id=(await f.call('/new',{cwd:repo,...msg('first')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='finished'));
 const old=f.calls()[0].pid;
 assert.equal((await f.call(`/session/${id}/message`,{...msg('second, after the restart'),model:'claude-haiku-4-5'})).status,202);
 assert.equal((await f.call(`/session/${id}/queue`)).body.items.length,0,'the waiting reply is not shown as a queued message');
 await sleep(300);
 await f.stop();
 const queued=JSON.parse(fs.readFileSync(path.join(f.dir,'data','followup-queue.json'),'utf8')).filter(r=>r.sessionId===id);
 assert.deepEqual(queued.map(r=>({text:r.text,held:r.held,model:r.model})),[{text:'second, after the restart',held:true,model:'claude-haiku-4-5'}]);
 assert.equal(f.calls().length,1,'the replacement had not started before the restart');
 await f.start();
 let oldAliveAtStart=null;
 assert.ok(await f.until(()=>{if(f.calls().length<2)return false;oldAliveAtStart??=alive(old);return true;},20_000),'the held reply ran after the restart: '+f.logs());
 assert.match(f.calls()[1].text,/second, after the restart/);
 assert.equal(f.calls()[1].model,'claude-haiku-4-5');
 assert.ok(await f.until(async()=>await f.state(id)==='finished',8000));
 assert.deepEqual({oldAliveAtStart,queue:JSON.parse(fs.readFileSync(path.join(f.dir,'data','followup-queue.json'),'utf8')).filter(r=>r.sessionId===id).length},{oldAliveAtStart:false,queue:0});
});
