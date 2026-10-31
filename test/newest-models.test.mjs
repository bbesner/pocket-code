// 1.91: the pickers show only the newest version of each model family, Default and saved picks follow it forward,
// and new Claude models are found in Anthropic's model list without a Pocket update. Fake CLIs and a local
// stand-in for the model list only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {CLAUDE_MODELS,successorOf,replacedModels,resolveOffer} from '../models.mjs';
import {newModelsFrom,readClaudeCredential} from '../claude-catalog.mjs';
import {latestCodexModels,codexVersionOf} from '../codex.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX|ANTHROPIC)_/.test(k)&&k!=='CLAUDE_CONFIG_DIR'));
const CODEX_LIST=[{id:'gpt-6.1-sol',displayName:'GPT-6.1-Sol'},{id:'gpt-6-astra',displayName:'GPT-6-Astra'},{id:'gpt-6.1-terra',displayName:'GPT-6.1 Terra'},
  {id:'gpt-6-sol',displayName:'GPT-6-Sol'},{id:'gpt-6-luna',displayName:'GPT-6-Luna'},{id:'gpt-5.6-sol',displayName:'GPT-5.6-Sol'},{id:'gpt-5.6-terra',displayName:'GPT-5.6-Terra'},
  {id:'gpt-5.6-luna',displayName:'GPT-5.6-Luna'},{id:'o3',displayName:'o3'}];

test('Codex: the newest version of each family is kept, in Codex order; ids without a version stay',()=>{
  const {models,replaced}=latestCodexModels(CODEX_LIST.map(m=>({id:m.id,label:m.displayName})));
  assert.deepEqual(models.map(m=>m.id),['gpt-6.1-sol','gpt-6-astra','gpt-6.1-terra','gpt-6-luna','o3']);
  assert.deepEqual(replaced,{'gpt-6-sol':'gpt-6.1-sol','gpt-5.6-sol':'gpt-6.1-sol','gpt-5.6-terra':'gpt-6.1-terra','gpt-5.6-luna':'gpt-6-luna'});
  assert.deepEqual(codexVersionOf('gpt-5.1-codex-max'),{family:'gpt|codex-max',v:[5,1]});
  assert.deepEqual(latestCodexModels([{id:'gpt-5.1-codex-max'},{id:'gpt-5.2-codex-max'},{id:'gpt-5.2-codex'}]).replaced,{'gpt-5.1-codex-max':'gpt-5.2-codex-max'},'codex and codex-max are different families');
  assert.equal(codexVersionOf('codex-mini-latest'),null);
});

test('Claude: a newer version of a family replaces the older one unless the policy blocks it',()=>{
  assert.equal(successorOf('claude-sonnet-5',null),'claude-sonnet-5-5');
  assert.equal(successorOf('claude-haiku-4-5',null),'claude-haiku-5-5');
  assert.equal(successorOf('claude-sonnet-5-5',null),null);
  assert.equal(successorOf('claude-sonnet-5',{availableModels:['claude-sonnet-5'],availableModelsMatch:'exact'}),null,'Sonnet 5.5 blocked: Sonnet 5 stays');
  assert.deepEqual(replacedModels(null),{'claude-sonnet-5':'claude-sonnet-5-5','claude-haiku-4-5':'claude-haiku-5-5'});
  assert.deepEqual(resolveOffer({saved:null,envList:null,policy:null}).offered,['claude-fable-5-1[1m]','claude-opus-5-5[1m]','claude-sonnet-5-5','claude-haiku-5-5']);
});

const API_LIST=[{id:'claude-opus-6',display_name:'Claude Opus 6'},{id:'claude-opus-5-5',display_name:'Claude Opus 5.5'},{id:'claude-sonnet-5-5',display_name:'Claude Sonnet 5.5'},
  {id:'claude-haiku-5-5',display_name:'Claude Haiku 5.5'},{id:'claude-haiku-4-5-20251001',display_name:'Claude Haiku 4.5'},{id:'claude-fable-5-1',display_name:'Claude Fable 5.1'},
  {id:'claude-sonnet-5-7-20261201',display_name:'Claude Sonnet 5.7'},{id:'claude-sonnet-5-7',display_name:'Claude Sonnet 5.7'}];

test('Claude discovery: only models newer than the catalog, with the family\'s [1m] spelling; credentials from the CLI sign-in',()=>{
  assert.deepEqual(newModelsFrom(API_LIST,CLAUDE_MODELS,'2026-11-02'),[
    {id:'claude-opus-6[1m]',label:'Opus 6',sub:'Newest Opus · added by Pocket 2026-11-02',discovered:'2026-11-02'},
    {id:'claude-sonnet-5-7',label:'Sonnet 5.7',sub:'Newest Sonnet · added by Pocket 2026-11-02',discovered:'2026-11-02'}]);
  assert.deepEqual(newModelsFrom(API_LIST.slice(1,6),CLAUDE_MODELS),[],'nothing newer: nothing added');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-cred-'));
  try {
    assert.equal(readClaudeCredential({},home),null);
    assert.deepEqual(readClaudeCredential({ANTHROPIC_API_KEY:'k'},home),{apiKey:'k'});
    fs.mkdirSync(path.join(home,'.claude'));
    fs.writeFileSync(path.join(home,'.claude','.credentials.json'),JSON.stringify({claudeAiOauth:{accessToken:'t',expiresAt:Date.now()+60000}}));
    assert.deepEqual(readClaudeCredential({},home),{token:'t'});
    fs.writeFileSync(path.join(home,'.claude','.credentials.json'),JSON.stringify({claudeAiOauth:{accessToken:'t',expiresAt:Date.now()-1}}));
    assert.equal(readClaudeCredential({},home),null,'an expired token is skipped');
  } finally { fs.rmSync(home,{recursive:true,force:true}); }
});

async function server(t,env){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-newest-'));let logs='',child,port;
  const secret=randomUUID(),exp=Date.now()+3600000;
  const headers={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});fs.mkdirSync(path.join(dir,'policy'));
  const start=async()=>{
    logs='';
    child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),HOME:dir,POCKET_SKILLS:'0',PORT:'0',POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_CLI_UPDATES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,
      POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),POCKET_CLAUDE_MANAGED_DIR:path.join(dir,'policy'),
      CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),CODEX_BIN:path.join(repo,'test/fake-codex.mjs'),FAKE_CODEX_MODELS:JSON.stringify(CODEX_LIST),...env},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
    for(let i=0;i<200&&!/listening on 127\.0\.0\.1:\d+/.test(logs);i++)await sleep(30);
    port=logs.match(/listening on 127\.0\.0\.1:(\d+)/)?.[1];assert.ok(port,logs);
  };
  const stop=async()=>{if(child?.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}};
  t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true});});
  await start();
  const call=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null)};};
  const read=f=>fs.existsSync(path.join(dir,f))?fs.readFileSync(path.join(dir,f),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
  const until=async(fn,ms=6000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return true;await sleep(50);}return false;};
  return {dir,call,read,until,start,stop,logs:()=>logs};
}

test('HTTP Codex: the picker lists GPT-6.1 Sol, not GPT-6 Sol; Default and a saved GPT-6 Sol pick run GPT-6.1 Sol',async t=>{
  const s=await server(t,{POCKET_CODEX_MODEL:'gpt-6-sol',POCKET_CLAUDE_DISCOVERY:'0'});
  const cx=(await s.call('/codex/models')).body;
  assert.deepEqual(cx.models.map(m=>m.id),['gpt-6.1-sol','gpt-6-astra','gpt-6.1-terra','gpt-6-luna','o3']);
  assert.equal(cx.defaultModel,'gpt-6.1-sol','Default names the version it runs');assert.equal(cx.replaced['gpt-6-sol'],'gpt-6.1-sol');
  const a=await s.call('/new',{cwd:repo,provider:'codex',text:'default',clientMessageId:randomUUID()});assert.equal(a.status,202);
  assert.ok(await s.until(()=>s.read('calls.codex').length===1));
  assert.ok(await s.until(async()=>!(await s.call(`/session/${a.body.id}`)).body?.active));
  assert.equal((await s.call(`/session/${a.body.id}/message`,{text:'old pick',model:'gpt-6-sol',clientMessageId:randomUUID()})).status,202);
  assert.ok(await s.until(()=>s.read('calls.codex').length===2));
  assert.deepEqual(s.read('calls.codex').map(c=>c.model),['gpt-6.1-sol','gpt-6.1-sol']);
});

test('HTTP Claude: a newer model in Anthropic\'s list joins the picker, replaces its family\'s older one, moves Default with it, and is kept across a restart',async t=>{
  let hits=0,auth=null;
  const api=http.createServer((req,res)=>{hits++;auth=[req.headers.authorization,req.headers['anthropic-beta']];res.setHeader('content-type','application/json');res.end(JSON.stringify({data:API_LIST}));});
  await new Promise(r=>api.listen(0,'127.0.0.1',r));t.after(()=>api.close());
  const env={POCKET_CODEX:'0',POCKET_CLAUDE_MODEL:'claude-opus-5-5[1m]',POCKET_CLAUDE_DISCOVERY_DELAY_MS:'0',POCKET_ANTHROPIC_MODELS_URL:`http://127.0.0.1:${api.address().port}/v1/models`};
  const s=await server(t,env);
  // The fake HOME has no Claude sign-in yet: the check records that and adds nothing.
  assert.ok(await s.until(()=>fs.existsSync(path.join(s.dir,'data','claude-models.json'))));
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.dir,'data','claude-models.json'),'utf8')).error,'no Claude sign-in on this computer');assert.equal(hits,0);
  await s.stop();
  fs.mkdirSync(path.join(s.dir,'.claude'));fs.writeFileSync(path.join(s.dir,'.claude','.credentials.json'),JSON.stringify({claudeAiOauth:{accessToken:'tok',expiresAt:Date.now()+3600000}}));
  fs.rmSync(path.join(s.dir,'data','claude-models.json'));
  await s.start();
  assert.ok(await s.until(async()=>(await s.call('/claude/models')).body.models.some(m=>m.id==='claude-opus-6[1m]')));
  assert.deepEqual(auth,['Bearer tok','oauth-2025-04-20']);
  const m=(await s.call('/claude/models')).body;
  assert.deepEqual(m.models.map(x=>x.id),['claude-fable-5-1[1m]','claude-opus-6[1m]','claude-sonnet-5-7','claude-haiku-5-5']);
  assert.equal(m.defaultLabel,'Opus 6','POCKET_CLAUDE_MODEL=Opus 5.5 follows its family to Opus 6');
  assert.equal(m.replaced['claude-opus-5-5[1m]'],'claude-opus-6[1m]');
  assert.match(s.logs(),/claude catalog: Opus 6 \(claude-opus-6\[1m\]\) is new/);
  // Kept: a restart with the check off still offers it, and a turn on Opus 5.5 runs Opus 6.
  await s.stop();
  env.POCKET_CLAUDE_DISCOVERY='0';await s.start();
  const again=(await s.call('/claude/models')).body;assert.ok(again.models.some(x=>x.id==='claude-opus-6[1m]'));
  const r=await s.call('/new',{cwd:repo,text:'old pick',model:'claude-opus-5-5[1m]',clientMessageId:randomUUID()});
  assert.equal(r.status,202);assert.equal(r.body.modelFallback,undefined);
  assert.ok(await s.until(()=>s.read('calls').length>=1));
  assert.equal(s.read('calls')[0].model,'claude-opus-6[1m]');
});
