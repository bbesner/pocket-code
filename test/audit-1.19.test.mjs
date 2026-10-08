// 1.19 audit fixes: generated titles, automated runs, conditional session lists and failure reasons.
// Uses the fake CLI only; no model, credentials or production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {automation,cleanTitle,createTitler} from '../titles.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID)_/.test(k)));

test('automation labels scheduled runs by job name and leaves ordinary requests alone',()=>{
  assert.deepEqual(automation('[cron:6bebd6e9-4c1a MemStem Fleet Health — Daily 6:20am ET] Run the report'),{automated:true,title:'MemStem Fleet Health — Daily 6:20am ET'});
  assert.equal(automation('OpenClaw runtime context for this turn: Treat this…').automated,true);
  assert.equal(automation('Review the cron schedule [cron:x y]').automated,false);
  assert.equal(automation('Fix the login page').automated,false);
});

test('cleanTitle keeps a short plain title and rejects errors and essays',()=>{
  assert.equal(cleanTitle('"Chunk 7 code review for TechPro Vision NVR."'),'Chunk 7 code review for TechPro Vision NVR');
  assert.equal(cleanTitle('Title: Warehouse stock report\n\nextra'),'Warehouse stock report');
  assert.equal(cleanTitle("I don't have access to:\n\n- Google Meet\n- Email"),null,'an answer is not a title');
  assert.equal(cleanTitle("I appreciate you reaching out, but I need to clarify my role"),null);
  assert.equal(cleanTitle('Here is a title for your session'),null);
  assert.equal(cleanTitle('one two three four five six seven eight nine ten eleven twelve thirteen'),null);
  assert.equal(cleanTitle('# Planning Phase: Email from Eric Wilson'),'Planning Phase: Email from Eric Wilson');
  assert.equal(cleanTitle('**Title:** Warehouse **stock** report'),'Warehouse stock report');
  assert.equal(cleanTitle('- `pocket-code` release check'),'pocket-code release check');
  assert.equal(cleanTitle('Not logged in · Please run /login'),null);
  assert.equal(cleanTitle('ok'),null);
  assert.equal(cleanTitle('x'.repeat(81)),null);
});

test('titler: one call at a time, newest first, never over a rename, backs off after a failure',async()=>{
  const meta={},calls=[];let active=0,peak=0;
  const t=createTitler({bin:'x',getMeta:id=>meta[id],setMeta:(id,p)=>{meta[id]={...meta[id],...p};for(const k in meta[id])if(meta[id][k]==null)delete meta[id][k];},
    generate:async text=>{active++;peak=Math.max(peak,active);calls.push(text);await sleep(20);active--;return text==='bad'?null:'T '+text;}});
  meta.renamed={name:'Mine'};
  t.request('a','first');t.request('b','second');t.request('c','third');t.request('renamed','x');t.request('a','first');
  while(t.pending)await sleep(10);
  assert.equal(peak,1);
  assert.deepEqual(calls,['first','third','second'],'the first starts at once; queued ones run newest first; duplicates and renames are skipped');
  assert.equal(meta.a.autoTitle,'T first');assert.equal(meta.renamed.autoTitle,undefined);
  t.request('f','bad');while(t.pending)await sleep(10);
  assert.ok(meta.f.autoTitleFailedAt);t.request('f','bad');assert.equal(t.pending,0,'a failure is not retried within the window');
  meta.old={autoTitleFailedAt:Date.now()};t.request('old','older failure');assert.equal(t.pending>0,true,'a failure from an older prompt is tried again');while(t.pending)await sleep(10);
  meta.md={autoTitle:"I don't have access to that"};t.request('md','redo');while(t.pending)await sleep(10);assert.equal(meta.md.autoTitle,'T redo','a stored answer-like title is redone');
});

test('HTTP: generated titles, automated runs, 304 session lists, gzip and failure reasons',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-audit-'));let port=18571,logs='';
  const secret=randomUUID(),exp=Date.now()+3600000;
  const headers={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
  const ws=path.join(dir,'sessions','test-workspace');fs.mkdirSync(ws,{recursive:true});
  const seed=(text,extra=[])=>{const id=randomUUID();fs.writeFileSync(path.join(ws,id+'.jsonl'),[{type:'user',message:{role:'user',content:text},cwd:repo,sessionId:id,timestamp:new Date().toISOString()},...extra].map(o=>JSON.stringify(o)).join('\n')+'\n');return id;};
  const cron=seed('[cron:abc123 Nightly backup check] Run the nightly backup verification.');
  const named=seed('Something the CLI already titled',[{type:'ai-title',aiTitle:'Backup verification'}]);
  const failing=seed('__TITLEFAIL__ please look at this');
  let child;
  const start=async()=>{
    child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'1',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs')},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
    for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)return;}catch{} await sleep(30);}
    if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=37;logs='';return start();}
    throw Error('Test server failed: '+logs);
  };
  t.after(async()=>{if(child?.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}fs.rmSync(dir,{recursive:true,force:true});});
  const call=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json(),headers:r.headers};};
  const titleCalls=()=>fs.existsSync(path.join(dir,'calls.titles'))?fs.readFileSync(path.join(dir,'calls.titles'),'utf8').trim().split('\n').filter(Boolean):[];
  const row=async id=>(await call('/sessions')).body.sessions.find(s=>s.id===id);
  await start();

  // A new session is titled once, from its opening request; the list shows it on the next refresh.
  const created=await call('/new',{cwd:repo,text:'Review the warehouse stock levels before the order',provider:'claude',clientMessageId:randomUUID()});
  assert.equal(created.status,202);const id=created.body.id;
  let titled;for(let i=0;i<60&&!titled;i++){await sleep(100);const r=await row(id);if(r?.title==='Review the warehouse stock')titled=r;}
  assert.ok(titled,'generated title appears in the list: '+JSON.stringify(await row(id)));
  assert.equal(titled.prompt,undefined,'the raw request is not sent with the list');
  assert.equal((await call(`/session/${id}`)).body.title,'Review the warehouse stock');
  // A rename wins; clearing it returns to the generated title. Neither asks the model again.
  await call(`/session/${id}/rename`,{name:'My stock check'});assert.equal((await row(id)).title,'My stock check');
  await call(`/session/${id}/rename`,{name:''});assert.equal((await row(id)).title,'Review the warehouse stock');

  // Scheduled runs show the job name and are marked automated; agent-titled sessions keep their title.
  const c=await row(cron);assert.equal(c.title,'Nightly backup check');assert.equal(c.automated,true);
  assert.equal((await row(named)).title,'Backup verification');
  // A failed title keeps the request as the title and is not retried on every refresh.
  for(let i=0;i<40&&!JSON.parse(fs.readFileSync(path.join(dir,'data','session-meta.json'),'utf8'))[failing]?.autoTitleFailedAt;i++)await sleep(100);
  assert.match((await row(failing)).title,/__TITLEFAIL__/);
  await call('/sessions');await call('/sessions');await sleep(300);
  assert.equal(titleCalls().length,2,'one call for the new session, one failed attempt; none for cron, ai-titled or renamed: '+titleCalls().join(' | '));

  // Conditional list: the same content answers 304 with a fresh check time in a header.
  const first=await fetch(`http://127.0.0.1:${port}/api/sessions?limit=200`,{headers});
  const etag=first.headers.get('etag');assert.ok(etag);assert.equal(first.headers.get('content-encoding'),'gzip');
  const firstBody=await first.json();assert.ok(firstBody.checkedAt>0);
  const again=await fetch(`http://127.0.0.1:${port}/api/sessions?limit=200`,{headers:{...headers,'if-none-match':etag},cache:'no-store'});
  assert.equal(again.status,304);assert.ok(Number(again.headers.get('x-pocket-checked-at'))>=firstBody.checkedAt);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/sessions`,{headers:{'if-none-match':etag}})).status,401,'the 304 path still requires login');
  await call(`/session/${cron}/pin`,{pinned:true});
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/sessions?limit=200`,{headers:{...headers,'if-none-match':etag}})).status,200,'a change returns the full list');

  // A failed turn keeps its reason in the session state, so a reload can still show it.
  assert.equal((await call(`/session/${id}/message`,{text:'__FAIL__',clientMessageId:randomUUID()})).status,202);
  let failed;for(let i=0;i<40&&!failed;i++){await sleep(100);const r=await row(id);if(r?.state.kind==='failed')failed=r;}
  assert.ok(failed);assert.equal(failed.state.error,'Test result');
});

test('Codex names that are just the opening request count as untitled (1.19.1)',async()=>{
  const {promptOnlyName}=await import('../codex.mjs');
  const ask='there was a previous session running doing chunk 7 code review for techpro vision nvr. I need you to continue';
  assert.equal(promptOnlyName({name:ask,preview:ask}),true);
  assert.equal(promptOnlyName({name:ask.slice(0,60),preview:ask}),true,'a clipped copy of the request');
  assert.equal(promptOnlyName({name:'x'.repeat(81),preview:''}),true,'a sentence-length name');
  assert.equal(promptOnlyName({name:null,preview:ask}),true);
  assert.equal(promptOnlyName({name:'NVR code review',preview:ask}),false,'a real name stays');
  assert.equal(promptOnlyName({name:'Fix login',preview:'Fix login'}),true,'identical to the request');
});
