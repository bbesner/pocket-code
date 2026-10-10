// 1.29 projects: the store's rules, the board routes (cookie and loopback token), reminders with the hook, and the CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {ProjectStore,parseWhen,LIMITS} from '../projects.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pocket-projects-'));
const S1='11111111-1111-4111-8111-111111111111';

test('ProjectStore: tracking, editing, stale edits, steps, reminders and finishing follow the board rules',()=>{
  const dir=tmp(),file=path.join(dir,'projects.json');let clock=Date.parse('2026-10-09T12:00:00Z');
  const s=new ProjectStore(file,{now:()=>clock});
  const a=s.act({action:'track',name:'  Warehouse   stock report ',summary:'Counting',next:'Order',directory:'/w/stock/',link:'https://example.com/x',session:S1});
  assert.equal(a.id,'warehouse-stock-report');assert.equal(a.name,'Warehouse stock report');assert.equal(a.revision,1);assert.equal(a.enrollment,'requested');
  assert.equal(a.directory,'/w/stock');assert.deepEqual(a.sessions,[S1]);assert.equal(a.history.at(-1).action,'tracked');
  assert.equal(s.act({action:'track',name:'Warehouse stock report'}).id,'warehouse-stock-report-2','a repeated name gets a distinct id');
  assert.throws(()=>s.act({action:'track',name:' '}),/name/);assert.throws(()=>s.act({action:'track',name:'x',link:'ftp://no'}),/http/);assert.throws(()=>s.act({action:'track',name:'x',directory:'rel'}),/full path/);
  assert.throws(()=>s.act({action:'update',project:a.id,expected_revision:7,next:'x'}),e=>e.status===409&&e.project.revision===1,'a stale edit is refused with the current card');
  clock+=60000;const b=s.act({action:'update',project:a.id,expected_revision:1,next:'Order from ENS',waitingFor:'Quote'});
  assert.equal(b.revision,2);assert.equal(b.next,'Order from ENS');assert.equal(b.verified,'2026-10-09T12:01:00Z','an update verifies the card');
  const t=s.act({action:'task-add',project:a.id,text:'Count aisle 4'}).tasks[0];assert.equal(t.done,false);
  const r1=s.act({action:'remind',project:a.id,at:'2026-10-10T09:00:00Z',task:t.id}).reminders[0];assert.equal(r1.label,'Count aisle 4');assert.equal(r1.task,t.id);
  const withNote=s.act({action:'note',project:a.id,text:'Spoke to ENS'});assert.equal(withNote.verified,'2026-10-09T12:01:00Z','a note does not verify');assert.equal(withNote.history.at(-1).detail,'Spoke to ENS');
  const r2=s.act({action:'remind',project:a.id,at:'2026-10-11T09:00:00Z',task:t.id}).reminders;assert.equal(r2.length,1);assert.notEqual(r2[0].id,r1.id,'a new reminder on the same step replaces the open one');
  s.act({action:'remind',project:a.id,at:'2026-10-12T09:00:00Z',text:'Check in'});assert.equal(s.view(s.get(a.id)).reminders.length,2,'one per project plus one per step');
  const done=s.act({action:'task-update',project:a.id,task:t.id,done:true});assert.equal(done.tasks[0].done,true);assert.equal(done.reminders.length,1,'finishing a step stops its reminder');
  assert.throws(()=>s.act({action:'remind',project:a.id,at:'2026-10-12T09:00',task:t.id}),e=>e.status===409);
  assert.throws(()=>s.act({action:'task-update',project:a.id,task:'nope',done:true}),e=>e.status===404);
  const fin=s.act({action:'update',project:a.id,status:'done'});assert.equal(fin.status,'done');assert.equal(fin.reminders.length,0,'finishing stops the reminders');
  assert.throws(()=>s.act({action:'task-add',project:a.id,text:'late'}),e=>e.status===409);
  const back=s.act({action:'update',project:a.id,status:'active'});assert.equal(back.reminders.length,0,'resuming does not restore them');
  s.act({action:'link-session',project:a.id,session:'cx:22222222-2222-4222-8222-222222222222'});s.act({action:'link-session',project:a.id,session:S1});
  assert.deepEqual(s.get(a.id).sessions,[S1,'cx:22222222-2222-4222-8222-222222222222']);assert.throws(()=>s.act({action:'link-session',project:a.id,session:'../etc'}),/session id/);
  s.act({action:'unlink-session',project:a.id,session:S1});assert.deepEqual(s.get(a.id).sessions,['cx:22222222-2222-4222-8222-222222222222']);
  assert.throws(()=>s.act({action:'explode',project:a.id}),/Unknown action/);assert.throws(()=>s.act({action:'note',project:'missing',text:'x'}),e=>e.status===404);
  for(let i=0;i<LIMITS.history+20;i++)s.act({action:'note',project:a.id,text:'n'+i});
  assert.equal(s.get(a.id).history.length,LIMITS.history,'history is capped');
  const again=new ProjectStore(file);assert.equal(again.projects.length,2);assert.equal(again.get(a.id).revision,s.get(a.id).revision,'persisted');
  assert.equal((fs.statSync(file).mode&0o777),0o600);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('ProjectStore: directory match, snapshot order, due reminders announced once, and times without an offset mean the install zone',()=>{
  const dir=tmp(),file=path.join(dir,'projects.json');let clock=Date.parse('2026-10-09T12:00:00Z');
  const s=new ProjectStore(file,{now:()=>clock});
  const p=s.act({action:'track',name:'Pocket',directory:'/home/u/projects'}),q=s.act({action:'track',name:'Pocket cache',directory:'/home/u/projects/pocket'}),z=s.act({action:'track',name:'Old',directory:'/home/u/projects/pocket/old'});
  s.act({action:'update',project:z.id,status:'done'});
  assert.equal(s.matchDirectory('/home/u/projects/pocket/src').id,q.id,'the deepest containing directory wins');
  assert.equal(s.matchDirectory('/home/u/projects/pocket/old').id,q.id,'finished projects do not match');
  assert.equal(s.matchDirectory('/home/u/projectsx'),null);assert.equal(s.snapshot({dir:'/home/u/projects/x'}).match,p.id);
  s.act({action:'remind',project:p.id,at:'2026-10-09T11:00:00Z',text:'Past'});s.act({action:'remind',project:q.id,at:'2026-10-09T13:00:00Z',text:'Future'});
  const snap=s.snapshot();assert.deepEqual(snap.projects.map(x=>x.id),[p.id,q.id,z.id],'active first, due first, done last');
  assert.deepEqual(snap.scheduled.map(r=>[r.projectName,r.due]),[['Pocket',true],['Pocket cache',false]]);assert.equal(snap.dueCount,1);
  const due=s.due();assert.equal(due.length,1);assert.equal(due[0].label,'Past');
  s.markNotified(due[0].project,due[0].reminder);assert.equal(s.due().length,0,'announced once');
  assert.equal(new ProjectStore(file,{now:()=>clock}).due().length,0,'the announcement survives a restart');
  assert.equal(s.snapshot().dueCount,1,'but the reminder stays due until it is dismissed');
  assert.equal(parseWhen('2026-07-04T09:00','America/New_York'),'2026-07-04T13:00:00Z');
  assert.equal(parseWhen('2026-01-15T09:00','America/New_York'),'2026-01-15T14:00:00Z');
  assert.equal(parseWhen('2026-01-15 09:30:15','Europe/London'),'2026-01-15T09:30:15Z');
  assert.equal(parseWhen('2026-01-15T09:00-05:00'),'2026-01-15T14:00:00Z');assert.equal(parseWhen('2026-01-15T09:00+0100'),'2026-01-15T08:00:00Z');
  assert.throws(()=>parseWhen('tomorrow'),/time like/);assert.throws(()=>parseWhen('2026-13-45T09:00'),/not valid/);
  fs.rmSync(dir,{recursive:true,force:true});
});

const snapshotFixture=()=>({version:2,generated_at:'2026-10-09T12:00:00+00:00',timezone:'America/New_York',projects:[
  {id:'nvr-review',name:'NVR review',summary:'Chunk 7 drafted',next_step:'Review RTSP redirect',waiting_for:'',status:'active',directory:'/home/u/nvr',link:'https://github.com/x/y/pull/1',created:'2026-09-30T20:00:00+00:00',updated:'2026-10-08T03:28:04+00:00',verified:'2026-10-08T03:28:04+00:00',revision:14,enrollment:'explicit-user-request',
   tasks:[{id:'06f35f99ed42',project:'nvr-review',text:'Decide retention',done:0,created:'2026-10-01T00:00:00+00:00',updated:'2026-10-01T00:00:00+00:00'},{id:'aa11',project:'nvr-review',text:'Old step',done:1,created:'2026-10-01T00:00:00+00:00',updated:'2026-10-02T00:00:00+00:00'}],
   reminders:[{id:'bc0d81efc253',project:'nvr-review',task:null,label:'Check-in',due_at:'2026-10-14T13:00:00+00:00',state:'open',version:2,notified_at:null,digest_date:null,updated:'2026-10-08T00:00:00+00:00'},{id:'dead',project:'nvr-review',task:'missing-task',label:'Orphan',due_at:'2026-10-14T13:00:00+00:00',state:'open',updated:'2026-10-08T00:00:00+00:00'}],
   due_count:0,history:[{id:1,project:'nvr-review',at:'2026-09-30T20:00:00+00:00',actor:'agent',action:'tracked',detail:'{"name": "NVR review"}'},{id:2,project:'nvr-review',at:'2026-10-08T03:28:04+00:00',actor:'agent',action:'updated',detail:{summary:'x'}}]},
  {id:'blog',name:'SCK blog cleanup',summary:'',next_step:'',waiting_for:'Brad to review',status:'waiting',directory:'',link:'',created:'2026-10-01T00:00:00+00:00',updated:'2026-10-01T00:00:00+00:00',verified:'2026-10-01T00:00:00+00:00',revision:3,enrollment:'explicit-user-request',tasks:[],reminders:[],due_count:0,history:[]},
  {id:'',name:'',status:'active',tasks:[],reminders:[],history:[]}],due_count:0,reminder_health:{},programs:[],alarms:[],events:[],unboarded:[],total_asks:0,blocked_brad:0});

test('ProjectStore: a Mission Control snapshot imports once, field for field',()=>{
  const dir=tmp(),s=new ProjectStore(path.join(dir,'projects.json'),{now:()=>Date.parse('2026-10-09T12:00:00Z')});
  const r=s.importSnapshot(snapshotFixture());
  assert.deepEqual(r.added,['nvr-review','blog']);assert.deepEqual(r.skipped,[{id:'project',reason:'no name'}]);
  const p=s.view(s.get('nvr-review'));
  assert.equal(p.next,'Review RTSP redirect');assert.equal(p.revision,14);assert.equal(p.enrollment,'requested');assert.equal(p.link,'https://github.com/x/y/pull/1');assert.equal(p.created,'2026-09-30T20:00:00Z');
  assert.deepEqual(p.tasks.map(t=>[t.id,t.done]),[['06f35f99ed42',false],['aa11',true]]);
  assert.deepEqual(p.reminders.map(x=>[x.id,x.dueAt,x.state,x.due]),[['bc0d81efc253','2026-10-14T13:00:00Z','open',false]],'a reminder on a missing step is dropped');
  assert.equal(p.history.length,3);assert.equal(p.history[1].detail,'{"summary":"x"}');assert.equal(p.history.at(-1).action,'imported');
  assert.equal(s.get('blog').waitingFor,'Brad to review');assert.equal(s.get('blog').status,'waiting');
  const again=s.importSnapshot(snapshotFixture());assert.deepEqual(again.added,[]);assert.equal(again.skipped.filter(x=>x.reason==='already here').length,2);
  assert.throws(()=>s.importSnapshot({nope:true}),/snapshot/);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('HTTP: the board is off until Settings turns it on, the loopback token serves only the CLI, reminders fire the hook once, and the CLI works',async t=>{
  const dir=tmp();let port=18911;
  const secret=randomUUID(),exp=Date.now()+3600000;
  const cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
  const hookLog=path.join(dir,'hook.log'),hook=path.join(dir,'hook.mjs');
  fs.writeFileSync(hook,`import fs from 'node:fs';let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>fs.appendFileSync(${JSON.stringify(hookLog)},d+'\\n'));`);
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  let child,logs='';
  const start=async()=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),POCKET_REMINDER_HOOK:`${process.execPath} ${hook}`,POCKET_REMINDER_CHECK_MS:'300',POCKET_TZ:'America/New_York'},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
   if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=41;logs='';return start();}
   throw Error('Test server failed: '+logs);
  };
  const stop=async()=>{if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}};
  t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  const call=async(p,body,h=headers,method)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:method||(body?'POST':'GET'),headers:h,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};};
  await start();
  const tokenFile=path.join(dir,'data','cli-token');assert.equal((fs.statSync(tokenFile).mode&0o777),0o600);
  const token=fs.readFileSync(tokenFile,'utf8').trim();assert.match(token,/^[0-9a-f]{64}$/);
  const bearer={'content-type':'application/json',authorization:'Bearer '+token};
  assert.equal((await call('/board')).status,404,'off by default');assert.equal((await call('/board')).body.code,'projects_off');
  assert.equal((await call('/board',null,{})).status,401,'and never reachable signed out');
  const calls=()=>fs.existsSync(path.join(dir,'calls'))?fs.readFileSync(path.join(dir,'calls'),'utf8').trim().split('\n').map(JSON.parse):[];
  fs.mkdirSync(path.join(dir,'sessions','test-workspace'),{recursive:true});
  assert.equal((await call('/new',{cwd:repo,text:'Before',provider:'claude',clientMessageId:randomUUID()})).status,202);
  for(let i=0;i<50&&calls().length<1;i++)await sleep(50);
  assert.equal(calls().at(-1).projects,false,'no projects line while the feature is off');
  assert.equal((await call('/settings',{projects:true})).body.projects,true);
  assert.equal((await call('/new',{cwd:repo,text:'After',provider:'claude',clientMessageId:randomUUID()})).status,202);
  for(let i=0;i<50&&calls().length<2;i++)await sleep(50);
  assert.equal(calls().at(-1).projects,true,'the agent is told how to track the session once Projects is on');assert.equal(calls().at(-1).choices,true,'and still gets the reply-suggestion line');
  let snap=await call('/board');assert.equal(snap.status,200);assert.deepEqual(snap.body.projects,[]);assert.equal(snap.body.hook,true);assert.equal(snap.body.push.enabled,false);
  assert.equal((await call('/board',null,bearer)).status,200,'the loopback token reads the board');
  assert.equal((await call('/board',null,{authorization:'Bearer '+'0'.repeat(64)})).status,401);
  assert.equal((await call('/board',null,{...bearer,'cf-connecting-ip':'203.0.113.5'})).status,401,'a request through the tunnel cannot use the token');
  assert.equal((await call('/board',null,{...bearer,'x-forwarded-for':'10.0.0.9'})).status,401);
  assert.equal((await call('/sessions',null,bearer)).status,401,'the token opens nothing else');
  const made=await call('/board/act',{action:'track',name:'Warehouse stock report',directory:'/w/stock',next:'Order'});
  assert.equal(made.status,200);assert.equal(made.body.project.history.at(-1).actor,'ui');
  const viaCli=await call('/board/act',{action:'note',project:made.body.project.id,text:'from an agent'},bearer);
  assert.equal(viaCli.body.project.history.at(-1).actor,'cli');
  const stale=await call('/board/act',{action:'update',project:made.body.project.id,expected_revision:1,next:'x'});
  assert.equal(stale.status,409);assert.equal(stale.body.project.revision,2,'the 409 carries the current card');
  assert.equal((await call('/board/act',{action:'remind',project:made.body.project.id,at:'2027-07-04T09:00',text:'Later'})).body.project.reminders[0].dueAt,'2027-07-04T13:00:00Z','server-side time zone');
  assert.equal((await call('/board/act',{action:'nope',project:made.body.project.id})).status,400);
  assert.match((await call('/board?dir=relative')).body.error,/full path/);
  const imp=await call('/board/import',snapshotFixture());assert.deepEqual(imp.body.added,['nvr-review','blog']);
  // A reminder already due is announced once: the hook gets it as JSON, the board still shows it due, and it is not sent again.
  const due=await call('/board/act',{action:'remind',project:'blog',at:new Date(Date.now()-60000).toISOString(),text:'Overdue'});assert.equal(due.status,200);
  for(let i=0;i<40&&!fs.existsSync(hookLog);i++)await sleep(100);
  await sleep(700);
  const lines=fs.readFileSync(hookLog,'utf8').trim().split('\n');assert.equal(lines.length,1,'announced once');
  const payload=JSON.parse(lines[0]);assert.equal(payload.project,'blog');assert.equal(payload.label,'Overdue');assert.equal(payload.url,'/#/projects/blog');
  snap=await call('/board');assert.equal(snap.body.dueCount,1);assert.equal(snap.body.scheduled[0].due,true);assert.equal(snap.body.scheduled[0].label,'Overdue');
  assert.match(logs,/reminder due project=blog .* push=off hook=yes/);
  // The CLI: status, track (only with --requested), the directory match, and a clear message when the feature is off.
  const cli=(args,cwd=dir)=>new Promise(r=>execFile(process.execPath,[path.join(repo,'scripts/pocket-board.mjs'),...args],{cwd,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_DATA_DIR:path.join(dir,'data')}},(e,stdout,stderr)=>r({code:e?e.code:0,stdout,stderr})));
  let out=await cli(['status','--all','--json']);assert.equal(out.code,0,out.stderr);assert.equal(JSON.parse(out.stdout).projects.length,3);
  out=await cli(['track','--name','No permission']);assert.equal(out.code,6);assert.match(out.stderr,/--requested/);
  fs.mkdirSync(path.join(dir,'work','sub'),{recursive:true});
  out=await cli(['track','--requested','--name','CLI project','--next','Write tests','--session',S1],path.join(dir,'work'));assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/CLI project  \[active\]  id cli-project/);assert.match(out.stdout,/Sessions: 1111/);
  out=await cli(['status'],path.join(dir,'work','sub'));assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/Next: Write tests/,'the current directory finds its project');
  out=await cli(['task','add','Ship it'],path.join(dir,'work'));assert.match(out.stdout,/\[ \] Ship it  \(/);
  const taskId=/\[ \] Ship it  \(([0-9a-f]+)\)/.exec(out.stdout)[1];
  out=await cli(['remind','--at','2026-12-01T09:00','--task',taskId],path.join(dir,'work'));assert.match(out.stdout,/Reminder .*Ship it/);
  out=await cli(['task','done',taskId],path.join(dir,'work'));assert.match(out.stdout,/\[x\] Ship it/);assert.doesNotMatch(out.stdout,/Reminder/);
  out=await cli(['scheduled']);assert.match(out.stdout,/DUE .*SCK blog cleanup: Overdue/);
  out=await cli(['context','--hook'],path.join(dir,'work','sub'));assert.equal(out.code,0,out.stderr);const ctx=JSON.parse(out.stdout);assert.equal(ctx.hookSpecificOutput.hookEventName,'SessionStart');assert.match(ctx.hookSpecificOutput.additionalContext,/Tracked project for this directory: CLI project/);assert.match(ctx.hookSpecificOutput.additionalContext,/Next: Write tests/);
  out=await cli(['context','--hook'],dir);assert.equal(out.code,0);assert.equal(out.stdout,'','no tracked project: silent');
  out=await cli(['status'],dir);assert.equal(out.code,0);assert.match(out.stdout,/No tracked project contains/);
  out=await cli(['note','x'],dir);assert.equal(out.code,5);
  assert.equal((await call('/settings',{projects:false})).body.projects,false);
  out=await cli(['status','--all']);assert.equal(out.code,3);assert.match(out.stderr,/Settings → Projects & files/);
  out=await cli(['context','--hook']);assert.equal(out.code,0);assert.equal(out.stdout,'','off: the hook stays silent');
  assert.equal((await call('/board')).status,404);
});
