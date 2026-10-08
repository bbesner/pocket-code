// 1.20: generated titles are a Settings choice (on/off; Automatic, Claude or Codex). Fake CLIs only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));

async function fixture(t,port,env){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-titles-'));let logs='',child;
  const secret=randomUUID(),exp=Date.now()+3600000;
  const headers={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
  const ws=path.join(dir,'sessions','test-workspace');fs.mkdirSync(ws,{recursive:true});
  child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,
    POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),
    CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),CODEX_BIN:path.join(repo,'test/fake-codex.mjs'),...env},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
  t.after(async()=>{if(child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}fs.rmSync(dir,{recursive:true,force:true});});
  for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)break;}catch{} await sleep(30);}
  if(child.exitCode!==null)throw Error('Test server failed: '+logs);
  const call=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
  const seed=text=>{const id=randomUUID();fs.writeFileSync(path.join(ws,id+'.jsonl'),JSON.stringify({type:'user',message:{role:'user',content:text},cwd:repo,sessionId:id,timestamp:new Date().toISOString()})+'\n');return id;};
  const titleCalls=()=>fs.existsSync(path.join(dir,'calls.titles'))?fs.readFileSync(path.join(dir,'calls.titles'),'utf8').trim().split('\n').filter(Boolean):[];
  const titleOf=async id=>(await call('/sessions')).body.sessions.find(s=>s.id===id)?.title;
  const waitTitle=async(id,want)=>{for(let i=0;i<60;i++){const t=await titleOf(id);if(t===want)return t;await sleep(100);}return titleOf(id);};
  return {dir,call,seed,titleCalls,titleOf,waitTitle};
}

test('Settings: titles on by default with Claude; off shows the request and makes no calls; Codex uses GPT-6-Luna',async t=>{
  const f=await fixture(t,18631,{});
  const s=(await f.call('/settings')).body;
  assert.equal(s.titles.enabled,true);assert.equal(s.titles.choice,'auto');assert.equal(s.titles.using,'claude');
  assert.equal(s.titles.claude.available,true);assert.equal(s.titles.models.claude,'haiku');assert.equal(s.titles.models.codex,'gpt-6-luna');

  const a=f.seed('Review the warehouse stock levels before ordering');
  assert.equal(await f.waitTitle(a,'Review the warehouse stock'),'Review the warehouse stock');
  assert.match(f.titleCalls()[0],/^claude: /);
  assert.equal((await f.call('/settings')).body.titles.last.model,'claude-haiku-test','Settings names the model that answered');

  // Off: generated titles are hidden (kept on disk) and nothing new is asked.
  const off=await f.call('/settings',{autoTitles:false});assert.equal(off.body.autoTitles,false);assert.equal(off.body.titles.using,null);
  assert.equal(await f.titleOf(a),'Review the warehouse stock levels before ordering');
  const b=f.seed('Check the camera firmware on the north gate');
  await f.call('/sessions');await sleep(600);await f.call('/sessions');
  assert.equal(f.titleCalls().length,1,'no calls while titles are off');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'data','session-meta.json'),'utf8'))[a].autoTitle,'Review the warehouse stock','the stored title is kept');

  // Codex: the next title comes from codex exec with GPT-6-Luna; earlier titles are not redone.
  const cx=await f.call('/settings',{autoTitles:true,titleProvider:'codex'});
  assert.equal(cx.body.titleProvider,'codex');assert.equal(cx.body.titles.using,'codex');
  assert.equal(await f.waitTitle(b,'Codex Check the camera'),'Codex Check the camera');
  assert.match(f.titleCalls().at(-1),/^codex gpt-6-luna: Check the camera/);
  assert.equal(await f.titleOf(a),'Review the warehouse stock');
  assert.equal(f.titleCalls().length,2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'data','pocket-settings.json'),'utf8')).titleProvider,'codex','the choice is saved');
  assert.equal((await f.call('/settings',{titleProvider:'gemini'})).body.titleProvider,'codex','unknown providers are ignored');
});

test('Settings: with no usable CLI, titles say why and nothing is attempted',async t=>{
  const f=await fixture(t,18661,{CLAUDE_BIN:'/nonexistent/claude',POCKET_CODEX:'0',PATH:'/usr/bin:/bin'});
  const s=(await f.call('/settings')).body.titles;
  assert.equal(s.enabled,true);assert.equal(s.using,null);
  assert.equal(s.claude.available,false);assert.match(s.claude.reason,/not installed/);
  assert.equal(s.codex.available,false);assert.match(s.codex.reason,/turned off/);
  const a=f.seed('Draft the quarterly maintenance letter for the HOA');
  await f.call('/sessions');await sleep(500);await f.call('/sessions');
  assert.equal(f.titleCalls().length,0);
  const meta=fs.existsSync(path.join(f.dir,'data','session-meta.json'))?JSON.parse(fs.readFileSync(path.join(f.dir,'data','session-meta.json'),'utf8')):{};
  assert.equal(meta[a]?.autoTitleFailedAt,undefined,'no failure is recorded, so nothing retries daily');
});
