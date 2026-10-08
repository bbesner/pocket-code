// 1.23 saved prompts: the store's rules and the HTTP routes, including recent starts from /api/new. Fake CLI only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {PromptStore,cleanPrompt,LIMITS} from '../prompts.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));

test('cleanPrompt keeps only known fields, trims them and rejects what cannot start a session',()=>{
  assert.deepEqual(cleanPrompt({name:'  Morning   NVR  check ',text:' Check the NVRs ',provider:'codex',cwd:'/home/x',model:'gpt-6-sol',effort:'default',approvalMode:'full',executionMode:'plan',evil:'x'}),
    {name:'Morning NVR check',text:'Check the NVRs',provider:'codex',cwd:'/home/x',model:'gpt-6-sol',effort:null,approvalMode:'full',executionMode:'plan'});
  assert.equal(cleanPrompt({name:'a',text:'b',provider:'gemini'}).provider,'claude');
  assert.equal(cleanPrompt({name:'a',text:'b',approvalMode:'yolo'}).approvalMode,null);
  assert.throws(()=>cleanPrompt({name:'',text:'x'}),/name/);assert.throws(()=>cleanPrompt({name:'x',text:'  '}),/no text/);
  assert.throws(()=>cleanPrompt({name:'x',text:'y',cwd:'relative/path'}),/full path/);
  assert.equal(cleanPrompt({name:'x'.repeat(100),text:'y'}).name.length,LIMITS.name);
  assert.deepEqual(cleanPrompt({name:'Renamed'},{partial:true}),{name:'Renamed'});
});

test('PromptStore saves, orders, edits, deletes, caps at 50 and keeps five recent starts',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-prompts-')),file=path.join(dir,'p.json');
  const s=new PromptStore(file);
  const a=s.create({name:'A',text:'one',cwd:'/w'}),b=s.create({name:'B',text:'two'}),c=s.create({name:'C',text:'three'});
  assert.deepEqual(new PromptStore(file).prompts.map(p=>p.name),['A','B','C'],'persisted');
  assert.equal(a.model,undefined,'empty optional fields are left out');
  assert.deepEqual(s.order([c.id,a.id]),[c.id,a.id,b.id],'unnamed prompts keep their place after the named ones');
  assert.equal(s.update(a.id,{name:'A2'}).text,'one');assert.equal(s.prompts.find(p=>p.id===a.id).name,'A2');
  assert.equal(s.update(a.id,{model:null}).model,undefined);
  s.remove(b.id);assert.throws(()=>s.remove(b.id),e=>e.status===404);assert.throws(()=>s.update('nope',{name:'x'}),e=>e.status===404);
  while(s.prompts.length<LIMITS.prompts)s.create({name:'x',text:'y'});
  assert.throws(()=>s.create({name:'x',text:'y'}),e=>e.status===409);
  for(const t of ['a','b','c','d','e','f'])s.recordRecent({text:t,cwd:'/w',provider:'claude'});
  s.recordRecent({text:'c',cwd:'/v',provider:'codex'});
  assert.deepEqual(s.recent.map(r=>r.text),['c','f','e','d','b'],'newest first, a repeat moves up, five kept');
  assert.equal(s.recent[0].provider,'codex');assert.equal(s.recent[0].cwd,'/v');
  fs.rmSync(dir,{recursive:true,force:true});
});

test('HTTP: prompts round-trip, need login, and a started session appears under Recent',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-prompts-http-'));let port=18801,logs='';
  const secret=randomUUID(),exp=Date.now()+3600000;
  const headers={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
  fs.mkdirSync(path.join(dir,'sessions','test-workspace'),{recursive:true});
  const child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,
    POCKET_CODEX:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs')},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
  t.after(async()=>{if(child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}fs.rmSync(dir,{recursive:true,force:true});});
  for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)break;}catch{} await sleep(30);}
  const call=async(p,method='GET',body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method,headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
  assert.deepEqual((await call('/prompts')).body,{prompts:[],recent:[]});
  const made=await call('/prompts','POST',{name:'Stock check',text:'Check stock levels',cwd:repo,provider:'claude',effort:'high'});
  assert.equal(made.status,201);assert.equal(made.body.prompt.name,'Stock check');assert.equal(made.body.prompts.length,1);
  const id=made.body.prompt.id;
  assert.equal((await call('/prompts/'+id,'PATCH',{name:'Morning stock check'})).body.prompt.name,'Morning stock check');
  const two=(await call('/prompts','POST',{name:'Second',text:'Two'})).body.prompt;
  assert.deepEqual((await call('/prompts/order','POST',{ids:[two.id,id]})).body.prompts.map(p=>p.name),['Second','Morning stock check']);
  assert.equal((await call('/prompts','POST',{name:'',text:'x'})).status,400);
  assert.equal((await call('/prompts/nope','DELETE')).status,404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/prompts`)).status,401);
  assert.deepEqual((await call('/prompts/'+two.id,'DELETE')).body.prompts.map(p=>p.name),['Morning stock check']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'data','saved-prompts.json'),'utf8')).prompts[0].effort,'high','saved on disk');
  // A started session is remembered as a recent start (once, even if the start request is retried).
  const start={cwd:repo,text:'Draft the order for low stock',provider:'claude',clientMessageId:randomUUID()};
  assert.equal((await call('/new','POST',start)).status,202);await call('/new','POST',start);
  const recent=(await call('/prompts')).body.recent;
  assert.equal(recent.length,1);assert.deepEqual([recent[0].text,recent[0].cwd,recent[0].provider],['Draft the order for low stock',repo,'claude']);
  assert.equal((await call('/new','POST',{cwd:'/nope',text:'x',provider:'claude',clientMessageId:randomUUID()})).status,400);
  assert.equal((await call('/prompts')).body.recent.length,1,'a start that failed is not remembered');
});
