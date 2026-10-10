// 1.36 tasks: the store's rules, the /api/tasks routes (cookie and loopback token), due announcements through the hook, and the CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {TaskStore,LIMITS,taskInstructions} from '../tasks.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pocket-tasks-'));
const S1='11111111-1111-4111-8111-111111111111';
process.env.POCKET_TZ='America/New_York'; // the store reads the install zone per call; CI runs in UTC

test('TaskStore: adding, ordering, due, done, editing, stale edits, removal and persistence',()=>{
  const dir=tmp(),file=path.join(dir,'tasks.json');let clock=Date.parse('2026-10-10T12:00:00Z');
  const s=new TaskStore(file,{now:()=>clock});
  const plain=s.act({action:'add',text:'  Read the   firmware notes '});
  assert.equal(plain.text,'Read the firmware notes');assert.equal(plain.dueAt,null);assert.equal(plain.done,false);assert.equal(plain.due,false);assert.equal(plain.revision,1);assert.equal(plain.by,'ui');
  clock+=1000;const later=s.act({action:'add',text:'Chase the quote',dueAt:'2026-10-13T09:00',session:S1,sessionTitle:'Camera review',directory:'/w/cams/',summary:'Quotes collected.\nWaiting on the revised price.'},{actor:'cli'});
  assert.equal(later.dueAt,'2026-10-13T13:00:00Z','a time without an offset is the install zone');assert.equal(later.directory,'/w/cams');assert.equal(later.by,'cli');assert.deepEqual([later.session,later.sessionTitle],[S1,'Camera review']);
  clock+=1000;const past=s.act({action:'add',text:'Send the recount',dueAt:'2026-10-10T08:00:00Z',session:'cx:22222222-2222-4222-8222-222222222222'});
  assert.equal(past.due,true,'already due');
  clock+=1000;const newest=s.act({action:'add',text:'Book the forklift'});
  assert.throws(()=>s.act({action:'add',text:'  '}),/some text/);assert.throws(()=>s.act({action:'add',text:'x',dueAt:'tomorrow'}),/time like/);assert.throws(()=>s.act({action:'add',text:'x',session:'../etc'}),/session id/);assert.throws(()=>s.act({action:'add',text:'x',directory:'rel'}),/full path/);
  let snap=s.snapshot();
  assert.deepEqual(snap.tasks.map(t=>t.text),['Send the recount','Chase the quote','Book the forklift','Read the firmware notes'],'dated first (soonest first), then undated newest first');
  assert.equal(snap.openCount,4);assert.equal(snap.dueCount,1);
  assert.throws(()=>s.act({action:'update',task:plain.id,expected_revision:5,text:'x'}),e=>e.status===409&&e.task.revision===1,'a stale edit is refused with the current task');
  assert.throws(()=>s.act({action:'update',task:plain.id}),/Nothing to change/);assert.throws(()=>s.act({action:'update',task:'nope',done:true}),e=>e.status===404);assert.throws(()=>s.act({action:'explode',task:plain.id}),/Unknown action/);
  clock+=60000;const done=s.act({action:'update',task:past.id,expected_revision:1,done:true});
  assert.equal(done.done,true);assert.equal(done.doneAt,'2026-10-10T12:01:03Z');assert.equal(done.due,false,'a finished task is never due');assert.equal(done.revision,2);
  snap=s.snapshot();assert.equal(snap.tasks.at(-1).text,'Send the recount','finished tasks come last');assert.equal(snap.dueCount,0);
  const back=s.act({action:'update',task:past.id,done:false});assert.equal(back.done,false);assert.equal(back.doneAt,null);
  const edited=s.act({action:'update',task:plain.id,text:'Read the TVT firmware notes',dueAt:'2026-10-11T09:00:00Z',summary:'Context'});
  assert.deepEqual([edited.text,edited.dueAt,edited.summary],['Read the TVT firmware notes','2026-10-11T09:00:00Z','Context']);
  assert.equal(s.act({action:'update',task:plain.id,dueAt:null}).dueAt,null,'the date can be cleared');
  assert.equal(s.act({action:'update',task:plain.id,session:null}).session,null);
  const gone=s.act({action:'remove',task:newest.id});assert.equal(gone.removed,true);assert.throws(()=>s.get(newest.id),e=>e.status===404);
  const again=new TaskStore(file,{now:()=>clock});assert.equal(again.tasks.length,3);assert.equal(again.get(plain.id).revision,s.get(plain.id).revision,'persisted');
  assert.equal((fs.statSync(file).mode&0o777),0o600);
  assert.equal(s.act({action:'add',text:'x'.repeat(2000)}).text.length,LIMITS.text);
  assert.match(taskInstructions('/srv/pocket/scripts/pocket-tasks.mjs',S1),/node \/srv\/pocket\/scripts\/pocket-tasks\.mjs add "<text>" --session 11111111-1111-4111-8111-111111111111/);
  assert.match(taskInstructions('/srv/pocket/scripts/pocket-tasks.mjs',null),/skills\/pocket-tasks\/SKILL\.md/);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('TaskStore: a dated task is announced once, again after a new time, and never once done',()=>{
  const dir=tmp(),file=path.join(dir,'tasks.json');let clock=Date.parse('2026-10-10T12:00:00Z');
  const s=new TaskStore(file,{now:()=>clock});
  const a=s.act({action:'add',text:'Past',dueAt:'2026-10-10T11:00:00Z'}),b=s.act({action:'add',text:'Future',dueAt:'2026-10-10T13:00:00Z'});s.act({action:'add',text:'Undated'});
  let due=s.due();assert.deepEqual(due.map(t=>t.text),['Past']);
  s.markNotified(a.id);assert.equal(s.due().length,0,'announced once');assert.equal(s.snapshot().dueCount,1,'but still due in the list');
  assert.equal(new TaskStore(file,{now:()=>clock}).due().length,0,'the announcement survives a restart');
  clock=Date.parse('2026-10-10T13:30:00Z');assert.deepEqual(s.due().map(t=>t.text),['Future']);
  s.act({action:'update',task:a.id,dueAt:'2026-10-10T13:15:00Z'});assert.deepEqual(s.due().map(t=>t.text).sort(),['Future','Past'],'a new time is announced again');
  s.act({action:'update',task:a.id,done:true});s.act({action:'update',task:b.id,done:true});assert.equal(s.due().length,0);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('HTTP: tasks are off until Settings turns them on, the loopback token serves the CLI, a due task fires the hook once, agents are told, and the CLI works',async t=>{
  const dir=tmp();let port=18971;
  const secret=randomUUID(),exp=Date.now()+3600000;
  const cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
  const hookLog=path.join(dir,'hook.log'),hook=path.join(dir,'hook.mjs');
  fs.writeFileSync(hook,`import fs from 'node:fs';let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>fs.appendFileSync(${JSON.stringify(hookLog)},d+'\\n'));`);
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  let child,logs='';
  const start=async()=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SKILLS:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),POCKET_REMINDER_HOOK:`${process.execPath} ${hook}`,POCKET_REMINDER_CHECK_MS:'300',POCKET_TZ:'America/New_York'},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
   if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=41;logs='';return start();}
   throw Error('Test server failed: '+logs);
  };
  const stop=async()=>{if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}};
  t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  const call=async(p,body,h=headers,method)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:method||(body?'POST':'GET'),headers:h,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};};
  await start();
  const token=fs.readFileSync(path.join(dir,'data','cli-token'),'utf8').trim();
  const bearer={'content-type':'application/json',authorization:'Bearer '+token};
  assert.equal((await call('/tasks')).status,404,'off by default');assert.equal((await call('/tasks')).body.code,'tasks_off');
  assert.equal((await call('/tasks',null,{})).status,401,'and never reachable signed out');
  assert.equal((await call('/me')).body.features.tasks,false);
  const calls=()=>fs.existsSync(path.join(dir,'calls'))?fs.readFileSync(path.join(dir,'calls'),'utf8').trim().split('\n').map(JSON.parse):[];
  fs.mkdirSync(path.join(dir,'sessions','test-workspace'),{recursive:true});
  assert.equal((await call('/new',{cwd:repo,text:'Before',provider:'claude',clientMessageId:randomUUID()})).status,202);
  for(let i=0;i<50&&calls().length<1;i++)await sleep(50);
  assert.equal(calls().at(-1).tasks,false,'no tasks line while the feature is off');
  assert.equal((await call('/settings',{tasks:true})).body.tasks,true);assert.equal((await call('/me')).body.features.tasks,true);
  assert.equal((await call('/new',{cwd:repo,text:'After',provider:'claude',clientMessageId:randomUUID()})).status,202);
  for(let i=0;i<50&&calls().length<2;i++)await sleep(50);
  assert.equal(calls().at(-1).tasks,true,'the agent is told how to keep tasks once Tasks is on');
  let snap=await call('/tasks');assert.equal(snap.status,200);assert.deepEqual(snap.body.tasks,[]);assert.equal(snap.body.hook,true);
  assert.equal((await call('/tasks',null,bearer)).status,200,'the loopback token reads the list');
  assert.equal((await call('/tasks',null,{...bearer,'cf-connecting-ip':'203.0.113.5'})).status,401,'a request through the tunnel cannot use the token');
  assert.equal((await call('/sessions',null,bearer)).status,401,'the token opens nothing else');
  const made=await call('/tasks/act',{action:'add',text:'Send the recount',dueAt:'2027-07-04T09:00',session:S1});
  assert.equal(made.status,200);assert.equal(made.body.task.by,'ui');assert.equal(made.body.task.dueAt,'2027-07-04T13:00:00Z','server-side time zone');
  const viaCli=await call('/tasks/act',{action:'add',text:'From an agent',summary:'Context here'},bearer);assert.equal(viaCli.body.task.by,'cli');
  const stale=await call('/tasks/act',{action:'update',task:made.body.task.id,expected_revision:9,text:'x'});assert.equal(stale.status,409);assert.equal(stale.body.task.revision,1,'the 409 carries the current task');
  assert.equal((await call('/tasks/act',{action:'nope',task:made.body.task.id})).status,400);
  assert.equal((await call('/tasks/summary',{session:'bad'})).status,400);
  assert.equal((await call('/tasks/summary',{session:S1})).status,404,'a briefing needs a session that exists');
  // A task already due is announced once: the hook gets it as JSON with kind "task", the list still shows it due, and it is not sent again.
  const due=await call('/tasks/act',{action:'add',text:'Overdue',dueAt:new Date(Date.now()-60000).toISOString()});assert.equal(due.status,200);
  for(let i=0;i<40&&!fs.existsSync(hookLog);i++)await sleep(100);
  await sleep(700);
  const lines=fs.readFileSync(hookLog,'utf8').trim().split('\n');assert.equal(lines.length,1,'announced once');
  const payload=JSON.parse(lines[0]);assert.equal(payload.kind,'task');assert.equal(payload.text,'Overdue');assert.equal(payload.url,'/#/tasks');
  snap=await call('/tasks');assert.equal(snap.body.dueCount,1);assert.equal(snap.body.tasks[0].text,'Overdue');assert.equal(snap.body.tasks[0].due,true);
  assert.match(logs,/task due task=[0-9a-f]{12} push=off hook=yes/);
  // The CLI: add, list, show, done, edit, remove, and a clear message when the feature is off.
  const cli=args=>new Promise(r=>execFile(process.execPath,[path.join(repo,'scripts/pocket-tasks.mjs'),...args],{cwd:dir,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_DATA_DIR:path.join(dir,'data')}},(e,stdout,stderr)=>r({code:e?e.code:0,stdout,stderr})));
  let out=await cli(['add','Call ENS about aisle 4','--due','2026-12-01T09:00','--session',S1,'--summary','Counting aisle 4.\nFourteen units short.']);
  assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/^\[ \] Call ENS about aisle 4  \([0-9a-f]{12}\)  due /);assert.match(out.stdout,/Session: 1111/);assert.match(out.stdout,/Context: Counting aisle 4\.\n\s+Fourteen units short\./);assert.match(out.stdout,/by an agent/);
  const id=/\(([0-9a-f]{12})\)/.exec(out.stdout)[1];
  out=await cli(['list']);assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/^\[ \] Overdue .*DUE/m);assert.match(out.stdout,/Call ENS/);assert.doesNotMatch(out.stdout,/^\[x\]/m);
  out=await cli(['list','--json']);assert.equal(JSON.parse(out.stdout).length,4);
  out=await cli(['edit',id,'--clear-due','--text','Call ENS']);assert.match(out.stdout,/^\[ \] Call ENS  \(/);assert.doesNotMatch(out.stdout,/due /);
  out=await cli(['done',id]);assert.match(out.stdout,/^\[x\] Call ENS/);assert.match(out.stdout,/finished/);
  out=await cli(['list','--all']);assert.match(out.stdout,/\[x\] Call ENS/);
  out=await cli(['show',id,'--json']);assert.equal(JSON.parse(out.stdout).done,true);
  out=await cli(['remove',id]);assert.match(out.stdout,/^Removed: Call ENS/);
  out=await cli(['show',id]);assert.equal(out.code,5);
  out=await cli(['add']);assert.equal(out.code,1);assert.match(out.stderr,/needs the task text/);
  assert.equal((await call('/settings',{tasks:false})).body.tasks,false);
  out=await cli(['list']);assert.equal(out.code,3);assert.match(out.stderr,/Settings → Projects, files & tasks/);
  assert.equal((await call('/tasks')).status,404);
});
