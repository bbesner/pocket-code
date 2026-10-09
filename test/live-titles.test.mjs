// 1.29.1 Living titles: reply cleanup, the due rule, the check queue, and the turn-end path through the server. Fake CLIs only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {cleanRetitle,retitleDue,sessionGrowth,createRetitler,RETITLE_MIN_GAP_MS} from '../titles.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));

test('cleanRetitle: KEEP in any dress keeps, a repeat keeps, Markdown is stripped, answers are rejected',()=>{
  assert.deepEqual(cleanRetitle('KEEP','Fix the login bug'),{keep:true});
  assert.deepEqual(cleanRetitle('Reply: **keep**.','Fix the login bug'),{keep:true});
  assert.deepEqual(cleanRetitle('fix the LOGIN bug','Fix the login bug'),{keep:true});
  assert.deepEqual(cleanRetitle('Title: "Login bug, then password reset"','Fix the login bug'),{title:'Login bug, then password reset'});
  assert.equal(cleanRetitle('I cannot continue this work.','x'),null);
  assert.equal(cleanRetitle('Login bug\nThen the reset flow\nAnd more','x'),null,'a paragraph is an answer');
  assert.equal(cleanRetitle('','x'),null);
});

test('retitleDue: four owner turns or 8k characters, not within the gap, never for a renamed session',()=>{
  const user=t=>({role:'user',text:t}),agent=t=>({role:'assistant',blocks:[{t:'text',text:t}]});
  assert.equal(retitleDue({},[user('a'),user('b'),user('c')]),false);
  assert.equal(retitleDue({},[user('a'),user('b'),user('c'),user('d')]),true);
  assert.equal(retitleDue({},[user('a'),agent('x'.repeat(8000))]),true);
  assert.deepEqual(sessionGrowth([user('ab'),agent('cde'),{role:'assistant',blocks:[{t:'tool',name:'Bash'}]}]),{turns:1,chars:5});
  const four=[user('a'),user('b'),user('c'),user('d')],now=Date.now();
  assert.equal(retitleDue({liveTitleAt:now-RETITLE_MIN_GAP_MS/2},four,now),false,'checked recently');
  assert.equal(retitleDue({liveTitleAt:now-RETITLE_MIN_GAP_MS-1},four,now),true);
  assert.equal(retitleDue({liveTitleAt:now-1000},four,now,0),true,'gap can be shortened');
  assert.equal(retitleDue({name:'My name'},four),false,'a rename is never touched');
});

test('createRetitler: stamps a kept title, replaces a stale one and remembers the old, swallows failures, one at a time',async()=>{
  const meta={},log=[],titled=[];
  const msgs=n=>Array.from({length:n},(_,i)=>({role:'user',text:'turn '+i,ts:new Date(i*1000).toISOString()}));
  let reply={title:'Something new',model:'m'};const gen=[];
  const r=createRetitler({getMeta:id=>meta[id],setMeta:(id,p)=>{meta[id]={...meta[id],...p};for(const k of Object.keys(meta[id]))if(meta[id][k]==null)delete meta[id][k];},
    load:async id=>({msgs:msgs(id==='short'?2:5),total:id==='short'?2:5}),currentTitle:async id=>id==='renamed'?null:'Old title',
    generate:async(digest,current)=>{gen.push({digest,current});await sleep(20);return reply;},log:l=>log.push(l),onTitled:x=>titled.push(x),gapMs:0});
  r.request('short');await sleep(60);
  assert.equal(gen.length,0,'two turns is not enough');assert.equal(meta.short,undefined);
  r.request('a');r.request('b');assert.equal(r.pending,2);await sleep(150);
  assert.equal(gen.length,2);assert.match(gen[0].digest,/^Owner: turn 0/);assert.equal(gen[0].current,'Old title');
  assert.equal(meta.a.autoTitle,'Something new');assert.equal(meta.a.autoTitleLive,true);assert.deepEqual(meta.a.titleHistory,['Old title']);assert.equal(meta.a.liveTitleMsgs,5);
  assert.deepEqual(titled[0],{id:'a',title:'Something new',from:'Old title',model:'m'});
  reply={keep:true,model:'m'};meta.a.liveTitleAt=0;meta.a.liveTitleMsgs=0;r.request('a');await sleep(60);
  assert.equal(meta.a.autoTitle,'Something new','KEEP leaves the title');assert.match(log.at(-1),/title kept/);
  reply=null;meta.a.liveTitleAt=0;meta.a.liveTitleMsgs=0;r.request('a');await sleep(60);
  assert.match(log.at(-1),/title check failed/);assert.equal(meta.a.liveTitleMsgs,5,'a failure is stamped, so it is not retried at once');
  meta.a.liveTitleAt=0;meta.a.liveTitleMsgs=0;r.request('a');await sleep(60);
  assert.equal(gen.length,5,'the next check waits for the gap only');
  r.request('renamed');await sleep(60);assert.equal(gen.length,5,'no model call without a current title');
});

async function fixture(t,port,env={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-live-'));let logs='',child;
  const secret=randomUUID(),exp=Date.now()+3600000;
  const headers={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
  const ws=path.join(dir,'sessions','test-workspace');fs.mkdirSync(ws,{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  if(env.__meta){fs.writeFileSync(path.join(dir,'data','session-meta.json'),JSON.stringify(env.__meta));delete env.__meta;}
  child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',
    POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),POCKET_LIVE_TITLE_GAP_MS:'1',
    CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),CODEX_BIN:path.join(repo,'test/fake-codex.mjs'),...env},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
  const calls=()=>fs.existsSync(path.join(dir,'calls'))?fs.readFileSync(path.join(dir,'calls'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
  const killAll=()=>{for(const pid of new Set(calls().map(c=>c.pid))){try{process.kill(-pid,'SIGKILL')}catch{try{process.kill(pid,'SIGKILL')}catch{}}}};
  t.after(async()=>{if(child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}killAll();fs.rmSync(dir,{recursive:true,force:true});});
  for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)break;}catch{} await sleep(30);}
  if(child.exitCode!==null)throw Error('Test server failed: '+logs);
  const call=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
  const live=()=>fs.existsSync(path.join(dir,'calls.live'))?fs.readFileSync(path.join(dir,'calls.live'),'utf8').trim().split('\n').filter(Boolean):[];
  const row=async id=>(await call('/sessions')).body.sessions.find(s=>s.id===id);
  const until=async(fn,ms=8000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return true;await sleep(80)}return false;};
  const finished=async id=>(await row(id))?.state?.kind==='finished';
  const turn=async(id,text)=>{assert.equal((await call(`/session/${id}/message`,{text,clientMessageId:randomUUID()})).status,202);assert.ok(await until(async()=>await finished(id)&&calls().filter(c=>c.id===id).length>=0),'turn ended: '+text);await sleep(150);};
  const meta=()=>JSON.parse(fs.readFileSync(path.join(dir,'data','session-meta.json'),'utf8'));
  return {dir,call,live,row,until,turn,meta,logs:()=>logs,seedDir:ws};
}

test('HTTP: after the fourth turn the title is checked and rewritten; KEEP keeps it; the setting and the model choice apply',async t=>{
  const f=await fixture(t,18721);
  const s=(await f.call('/settings')).body.titles;
  assert.equal(s.live,true);assert.equal(s.liveUsing,'claude');assert.equal(s.lastLive,null);
  const id=(await f.call('/new',{cwd:repo,text:'Review the warehouse stock levels before ordering',clientMessageId:randomUUID()})).body.id;
  assert.ok(await f.until(async()=>(await f.row(id))?.state?.kind==='finished'));
  assert.ok(await f.until(async()=>(await f.row(id))?.title==='Review the warehouse stock'),'first title from the opening request');
  await f.turn(id,'Check the TVT models too');await f.turn(id,'And the Dahua ones');
  assert.equal(f.live().length,0,'three turns: no check yet');
  await f.turn(id,'Plan the pole survey for the Oaks');
  assert.ok(await f.until(async()=>(await f.row(id))?.title==='Now Plan the pole'),'fourth turn: the title follows the session; got '+JSON.stringify((await f.row(id))?.title)+' '+f.logs().split('\n').filter(l=>/title/.test(l)).join(' / '));
  assert.equal(f.live().length,1);assert.match(f.live()[0],/^Review the warehouse stock => Owner: Review the warehouse stock levels before ordering \| Agent: Test response\./,'the whole session and the current title');
  const m=f.meta()[id];assert.equal(m.autoTitle,'Now Plan the pole');assert.equal(m.autoTitleLive,true);assert.deepEqual(m.titleHistory,['Review the warehouse stock']);assert.equal(m.liveTitleMsgs,8);
  assert.equal((await f.call(`/session/${id}`)).body.title,'Now Plan the pole','the open conversation shows it too');
  const after=(await f.call('/settings')).body.titles.lastLive;assert.equal(after.title,'Now Plan the pole');assert.equal(after.model,'claude-haiku-test');
  // KEEP: the model confirms the title; the check is stamped and the title stays.
  for(const x of ['KEEPTITLE a','KEEPTITLE b','KEEPTITLE c'])await f.turn(id,x);
  assert.equal(f.live().length,1,'not due before the fourth new turn');
  await f.turn(id,'KEEPTITLE d');
  assert.ok(await f.until(async()=>f.live().length===2));await sleep(200);
  assert.equal((await f.row(id)).title,'Now Plan the pole');assert.equal(f.meta()[id].liveTitleMsgs,16);
  // Off: turns end, nothing is checked. The title already made stays.
  assert.equal((await f.call('/settings',{liveTitles:false})).body.titles.live,false);
  for(const x of ['Next topic one','Next topic two','Next topic three','Next topic four'])await f.turn(id,x);
  await sleep(300);assert.equal(f.live().length,2,'no checks while off');assert.equal((await f.row(id)).title,'Now Plan the pole');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'data','pocket-settings.json'),'utf8')).liveTitles,false,'saved');
  // Generated titles off hides live titles too and reports no helper for them.
  const off=(await f.call('/settings',{autoTitles:false,liveTitles:true})).body.titles;assert.equal(off.live,true);assert.equal(off.liveUsing,null);
  assert.equal((await f.row(id)).title,'Review the warehouse stock levels before ordering');
  assert.equal((await f.call('/settings',{autoTitles:true})).body.titles.liveUsing,'claude');
  // A rename is never touched, even when the session has moved on.
  assert.equal((await f.call(`/session/${id}/rename`,{name:'My warehouse session'})).status,200);
  for(const x of ['Renamed one','Renamed two','Renamed three','Renamed four'])await f.turn(id,x);
  await sleep(300);assert.equal(f.live().length,2);assert.equal((await f.row(id)).title,'My warehouse session');
  assert.equal((await f.call(`/session/${id}/rename`,{name:''})).status,200);
  assert.equal((await f.row(id)).title,'Now Plan the pole','clearing the rename returns to the updated title');
});

test('HTTP: Codex as the helper checks titles too; an updated title outranks the agent\'s own ai-title but not a rename',async t=>{
  const aiId=randomUUID(),liveId=randomUUID();
  const f=await fixture(t,18722,{POCKET_CODEX:'1',__meta:{[liveId]:{autoTitle:'Pole survey, then invoicing',autoTitleLive:true},[aiId]:{autoTitle:'Pocket first title'}}});
  const line=(id,o)=>JSON.stringify({...o,cwd:repo,sessionId:id,timestamp:new Date().toISOString()});
  for(const id of [aiId,liveId])fs.writeFileSync(path.join(f.seedDir,id+'.jsonl'),[line(id,{type:'user',message:{role:'user',content:'Survey the poles at the Oaks'}}),line(id,{type:'ai-title',aiTitle:'Oaks pole survey'})].join('\n')+'\n');
  assert.equal((await f.row(aiId)).title,'Oaks pole survey','Claude Code\'s own title ahead of a first title');
  assert.equal((await f.row(liveId)).title,'Pole survey, then invoicing','an updated title ahead of Claude Code\'s own');
  assert.equal((await f.call(`/session/${liveId}/rename`,{name:'Renamed'})).status,200);assert.equal((await f.row(liveId)).title,'Renamed');
  assert.equal((await f.call('/settings',{titleProvider:'codex'})).body.titles.liveUsing,'codex');
  const id=(await f.call('/new',{cwd:repo,text:'Check the camera firmware on the north gate',clientMessageId:randomUUID()})).body.id;
  assert.ok(await f.until(async()=>(await f.row(id))?.state?.kind==='finished'));
  for(const x of ['two','three','Then the south gate'])await f.turn(id,x);
  assert.ok(await f.until(async()=>(await f.row(id))?.title==='Codex now Then the south'),'got '+JSON.stringify((await f.row(id))?.title));
  assert.match(f.live().at(-1),/^codex /);
});
