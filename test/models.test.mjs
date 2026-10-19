// 1.52: which Claude models the picker offers. The catalog, the owner's choice (Settings, else
// POCKET_CLAUDE_MODELS), and this computer's Claude Code managed policy (availableModels / deniedModels),
// read from a temporary POCKET_CLAUDE_MANAGED_DIR. Fake CLIs only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {CLAUDE_MODELS,managedDir,readManagedPolicy,policyAllows,parseSelection,resolveOffer,helperModel,POLICY_REASON} from '../models.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const ids=CLAUDE_MODELS.map(m=>m.id);
const policy=(o)=>({availableModels:null,deniedModels:null,availableModelsMatch:'prefix',...o});
const allowed=p=>ids.filter(id=>policyAllows(id,p));

test('catalog: Sonnet 5.5 and Haiku 5.5 are known; ids are unique',()=>{
  assert.ok(ids.includes('claude-sonnet-5-5'));assert.ok(ids.includes('claude-haiku-5-5'));
  assert.equal(new Set(ids).size,ids.length);
});

test('policy matching follows the Claude Code rules',()=>{
  assert.deepEqual(allowed(null),ids,'no policy: everything');
  assert.deepEqual(allowed(policy({})),ids,'a policy without model keys: everything');
  // Family aliases permit the whole family; [1m] is the same model in another spelling.
  assert.deepEqual(allowed(policy({availableModels:['sonnet','haiku']})),['claude-sonnet-5-5','claude-sonnet-5','claude-haiku-5-5','claude-haiku-4-5']);
  assert.deepEqual(allowed(policy({availableModels:['opus[1m]']})),['claude-opus-5-5[1m]']);
  // A version prefix permits the versions that extend it; a minor version names that version only.
  assert.deepEqual(allowed(policy({availableModels:['claude-sonnet-5']})),['claude-sonnet-5-5','claude-sonnet-5']);
  assert.deepEqual(allowed(policy({availableModels:['claude-sonnet-5-5']})),['claude-sonnet-5-5']);
  assert.deepEqual(allowed(policy({availableModels:['claude-sonnet-5'],availableModelsMatch:'exact'})),['claude-sonnet-5'],'exact: Sonnet 5 only');
  // A specific version disables its family's wildcard.
  assert.deepEqual(allowed(policy({availableModels:['sonnet','claude-sonnet-5-5','haiku']})),['claude-sonnet-5-5','claude-haiku-5-5','claude-haiku-4-5']);
  // Dated, provider-specific and 1M spellings of an entry.
  assert.deepEqual(allowed(policy({availableModels:['claude-haiku-4-5-20251001','us.anthropic.claude-opus-5-5-v1:0','claude-fable-5-1[1m]']})),['claude-fable-5-1[1m]','claude-opus-5-5[1m]','claude-haiku-4-5']);
  // An empty list blocks every named model; default/best/opusplan entries are ignored.
  assert.deepEqual(allowed(policy({availableModels:[]})),[]);
  assert.deepEqual(allowed(policy({availableModels:['default','best','opusplan']})),[]);
  // deniedModels wins over availableModels, blocks every spelling, and without a minor version blocks later minors.
  assert.deepEqual(allowed(policy({availableModels:['opus','sonnet'],deniedModels:['claude-opus-5-5']})),['claude-sonnet-5-5','claude-sonnet-5']);
  assert.deepEqual(allowed(policy({deniedModels:['claude-sonnet-5']})),['claude-fable-5-1[1m]','claude-opus-5-5[1m]','claude-haiku-5-5','claude-haiku-4-5']);
  assert.deepEqual(allowed(policy({deniedModels:['claude-sonnet-5-0']})),['claude-fable-5-1[1m]','claude-opus-5-5[1m]','claude-sonnet-5-5','claude-haiku-5-5','claude-haiku-4-5'],'-0 blocks Sonnet 5 alone');
  assert.deepEqual(allowed(policy({deniedModels:['fable','claude-opus-5-5[1m]']})),['claude-sonnet-5-5','claude-sonnet-5','claude-haiku-5-5','claude-haiku-4-5']);
  // An alias (the helper's 'haiku') is allowed while any version of its family is.
  assert.equal(policyAllows('haiku',policy({availableModels:['claude-haiku-4-5']})),true);
  assert.equal(policyAllows('haiku',policy({availableModels:['sonnet']})),false);
  assert.equal(policyAllows('haiku',policy({deniedModels:['haiku']})),false);
});

test('managed settings: base file plus managed-settings.d drop-ins, merged like the CLI',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-policy-'));
  try {
    assert.deepEqual(readManagedPolicy(dir).files,[],'no files: no policy');
    fs.writeFileSync(path.join(dir,'managed-settings.json'),JSON.stringify({availableModels:['claude-sonnet-5-5'],model:'claude-sonnet-5-5'}));
    fs.mkdirSync(path.join(dir,'managed-settings.d'));
    fs.writeFileSync(path.join(dir,'managed-settings.d','20-more.json'),JSON.stringify({availableModels:['haiku',7],deniedModels:['claude-haiku-4-5']}));
    fs.writeFileSync(path.join(dir,'managed-settings.d','10-first.json'),JSON.stringify({availableModelsMatch:'exact',model:'haiku'}));
    fs.writeFileSync(path.join(dir,'managed-settings.d','.hidden.json'),JSON.stringify({deniedModels:['claude-sonnet-5-5']}));
    fs.writeFileSync(path.join(dir,'managed-settings.d','notes.txt'),'not json');
    const p=readManagedPolicy(dir);
    assert.deepEqual(p.availableModels,['claude-sonnet-5-5','haiku'],'lists combine, non-strings dropped');
    assert.deepEqual(p.deniedModels,['claude-haiku-4-5'],'hidden and non-.json files ignored');
    assert.equal(p.availableModelsMatch,'exact');assert.equal(p.model,'haiku','later file replaces a single value');
    assert.equal(p.files.length,3);assert.equal(p.error,null);
    assert.deepEqual(allowed(p),['claude-sonnet-5-5','claude-haiku-5-5']);
    // availableModels present but not a list: enforced as empty.
    fs.writeFileSync(path.join(dir,'managed-settings.d','30-bad.json'),JSON.stringify({availableModels:'sonnet'}));
    assert.deepEqual(allowed(readManagedPolicy(dir)),['claude-sonnet-5-5','claude-haiku-5-5'],'a bad value adds nothing to a list already set');
    fs.writeFileSync(path.join(dir,'managed-settings.d','40-broken.json'),'{');
    assert.match(readManagedPolicy(dir).error,/40-broken\.json is not valid JSON/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
  assert.equal(managedDir({},'linux'),'/etc/claude-code');
  assert.equal(managedDir({},'darwin'),'/Library/Application Support/ClaudeCode');
  assert.equal(managedDir({POCKET_CLAUDE_MANAGED_DIR:'/tmp/x'},'linux'),'/tmp/x');
});

test('selection, offer and helper fallback',()=>{
  assert.deepEqual(parseSelection('claude-sonnet-5-5, claude-opus-5-5[1m] claude-opus-5-5 nope'),{ids:['claude-sonnet-5-5','claude-opus-5-5[1m]'],unknown:['nope']});
  assert.deepEqual(parseSelection(['haiku']).ids,['claude-haiku-5-5','claude-haiku-4-5'],'a family alias picks the family');
  const p=policy({availableModels:['sonnet','haiku'],deniedModels:['claude-sonnet-5-0']});
  const all=resolveOffer({saved:null,envList:null,policy:p});
  assert.equal(all.source,'all');assert.deepEqual(all.offered,['claude-sonnet-5-5','claude-haiku-5-5','claude-haiku-4-5']);
  assert.deepEqual(all.models.filter(m=>m.blocked).map(m=>[m.id,m.reason]),[['claude-fable-5-1[1m]',POLICY_REASON],['claude-opus-5-5[1m]',POLICY_REASON],['claude-sonnet-5',POLICY_REASON]]);
  const env=resolveOffer({saved:null,envList:['claude-opus-5-5[1m]','claude-sonnet-5-5'],policy:p});
  assert.equal(env.source,'env');assert.deepEqual(env.offered,['claude-sonnet-5-5']);
  const saved=resolveOffer({saved:['claude-haiku-4-5'],envList:['claude-sonnet-5-5'],policy:null});
  assert.equal(saved.source,'settings','a saved choice outranks the environment');assert.deepEqual(saved.offered,['claude-haiku-4-5']);
  // Helper: the configured model while allowed; else the cheapest offered model the policy allows.
  assert.equal(helperModel('haiku',{policy:p,offered:all.offered}),'haiku');
  const sonnetOnly=policy({availableModels:['sonnet']});
  assert.equal(helperModel('haiku',{policy:sonnetOnly,offered:['claude-sonnet-5-5','claude-sonnet-5']}),'claude-sonnet-5');
  assert.equal(helperModel('haiku',{policy:sonnetOnly,offered:['claude-sonnet-5-5']}),'claude-sonnet-5-5');
  assert.equal(helperModel('haiku',{policy:sonnetOnly,offered:[]}),'claude-sonnet-5','nothing offered: cheapest allowed');
  assert.equal(helperModel('haiku',{policy:policy({availableModels:[]}),offered:[]}),'haiku','nothing allowed: leave it to the CLI');
});

async function server(t,port,env){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-models-'));let logs='';
  const policyDir=path.join(dir,'policy');fs.mkdirSync(policyDir);
  const secret=randomUUID(),exp=Date.now()+3600000;
  const headers={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
  const ws=path.join(dir,'sessions','test-workspace');fs.mkdirSync(ws,{recursive:true});
  if(env.policy)fs.writeFileSync(path.join(policyDir,'managed-settings.json'),JSON.stringify(env.policy));
  const extra={...env};delete extra.policy;
  const child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),POCKET_SKILLS:'0',PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',
    POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),POCKET_CLAUDE_MANAGED_DIR:policyDir,
    CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),...extra},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
  t.after(async()=>{if(child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}fs.rmSync(dir,{recursive:true,force:true});});
  for(let i=0;;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)break;}catch{} if(i>100)throw Error('Test server failed: '+logs);await sleep(30);}
  const call=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
  const read=f=>fs.existsSync(path.join(dir,f))?fs.readFileSync(path.join(dir,f),'utf8').trim().split('\n').filter(Boolean):[];
  const calls=()=>read('calls').map(JSON.parse);
  const waitCalls=async n=>{for(let i=0;i<80&&calls().length<n;i++)await sleep(50);return calls();};
  const writePolicy=p=>fs.writeFileSync(path.join(policyDir,'managed-settings.json'),JSON.stringify(p));
  const seed=text=>{const id=randomUUID();fs.writeFileSync(path.join(ws,id+'.jsonl'),JSON.stringify({type:'user',message:{role:'user',content:text},cwd:repo,sessionId:id,timestamp:new Date().toISOString()})+'\n');return id;};
  return {dir,call,calls,waitCalls,read,writePolicy,seed,logs:()=>logs};
}

test('HTTP: the managed policy and POCKET_CLAUDE_MODELS shape the picker, Settings and every turn',async t=>{
  const s=await server(t,18746,{POCKET_CLAUDE_MODELS:'claude-sonnet-5-5,claude-opus-5-5[1m],claude-haiku-4-5,claude-mystery-9',POCKET_CLAUDE_MODEL:'claude-opus-5-5[1m]',
    policy:{availableModels:['sonnet','haiku'],deniedModels:['claude-sonnet-5-0'],model:'claude-sonnet-5-5'}});
  assert.match(s.logs(),/POCKET_CLAUDE_MODELS: claude-mystery-9 is not in the model catalog; ignored/);
  assert.match(s.logs(),/POCKET_CLAUDE_MODEL=claude-opus-5-5\[1m\] is not offered/);
  // Picker: offered = env ∩ policy; Default names the managed model, since the Pocket default is blocked.
  const m=(await s.call('/claude/models')).body;
  assert.deepEqual(m.models.map(x=>x.id),['claude-sonnet-5-5','claude-haiku-4-5']);
  assert.equal(m.defaultLabel,'Sonnet 5.5');assert.equal(m.pocketDefault,false);assert.equal(m.limited,true);
  // Settings: every catalog model, blocked ones marked with the reason.
  const cm=(await s.call('/settings')).body.claudeModels;
  assert.equal(cm.source,'env');assert.equal(cm.saved,false);assert.equal(cm.policy.limits,true);
  assert.deepEqual(cm.models.map(x=>[x.id,x.selected,x.blocked,x.offered]),[
    ['claude-fable-5-1[1m]',false,true,false],['claude-opus-5-5[1m]',true,true,false],['claude-sonnet-5-5',true,false,true],
    ['claude-sonnet-5',false,true,false],['claude-haiku-5-5',false,false,false],['claude-haiku-4-5',true,false,true]]);
  assert.equal(cm.models[1].reason,"Blocked by this computer's Claude Code policy");
  assert.deepEqual(cm.pocketDefault,{configured:'claude-opus-5-5[1m]',used:null,label:'Sonnet 5.5'});

  // Turns: an offered pick runs; a blocked pick and an unoffered pick never reach the CLI, and the response says so.
  const a=await s.call('/new',{cwd:repo,text:'Offered pick',model:'claude-haiku-4-5',clientMessageId:randomUUID()});
  assert.equal(a.status,202);assert.equal(a.body.modelFallback,undefined);
  await s.waitCalls(1);for(let i=0;i<100&&(await s.call('/health')).body.active;i++)await sleep(50); // the first turn has ended
  const b=await s.call(`/session/${a.body.id}/message`,{text:'Blocked pick',model:'claude-opus-5-5[1m]',clientMessageId:randomUUID()});
  assert.equal(b.status,202);
  assert.deepEqual([b.body.modelFallback.requested,b.body.modelFallback.reason,b.body.modelFallback.used],['claude-opus-5-5[1m]','policy','default']);
  assert.equal(b.body.modelFallback.message,"Opus 5.5 is blocked by this computer's Claude Code policy, so this reply uses the default model (Sonnet 5.5).");
  await s.waitCalls(2);
  const c=await s.call('/new',{cwd:repo,text:'Unoffered pick',model:'claude-haiku-5-5',clientMessageId:randomUUID()});
  assert.equal(c.body.modelFallback.reason,'not-offered');assert.match(c.body.modelFallback.message,/Haiku 5\.5 is not offered in Settings/);
  await s.waitCalls(3);
  const d=await s.call('/new',{cwd:repo,text:'Unknown pick',model:'claude-made-up-1',clientMessageId:randomUUID()});
  assert.equal(d.body.modelFallback.reason,'unknown');
  const e=await s.call('/new',{cwd:repo,text:'Default pick',clientMessageId:randomUUID()});assert.equal(e.body.modelFallback,undefined);
  assert.equal((await s.call('/new',{cwd:repo,text:'Wrong provider',model:'gpt-6-sol',clientMessageId:randomUUID()})).status,400,'a Codex model is still refused');
  const got=await s.waitCalls(5);
  assert.deepEqual(Object.fromEntries(got.map(x=>[x.text,x.model])),{'Offered pick':'claude-haiku-4-5','Blocked pick':null,'Unoffered pick':null,'Unknown pick':null,'Default pick':null});
  assert.match(s.logs(),/model fallback session=\S+ requested=claude-opus-5-5\[1m\] reason=policy using=default/);

  // Settings choice: saved outside git, outranks the environment, still filtered by the policy.
  const bad=await s.call('/settings',{offeredClaudeModels:['claude-opus-5-5[1m]']});
  assert.equal(bad.status,400,'only blocked models: nothing would be offered');assert.equal(bad.body.code,'no_models');
  assert.equal((await s.call('/settings',{offeredClaudeModels:[]})).status,400);
  assert.equal((await s.call('/settings',{offeredClaudeModels:['claude-nope']})).body.code,'bad_models');
  const saved=await s.call('/settings',{offeredClaudeModels:['claude-haiku-5-5','claude-opus-5-5[1m]','claude-sonnet-5-5']});
  assert.equal(saved.status,200);assert.equal(saved.body.claudeModels.source,'settings');
  assert.deepEqual(saved.body.claudeModels.offered,['claude-sonnet-5-5','claude-haiku-5-5']);
  assert.deepEqual(saved.body.offeredClaudeModels,['claude-opus-5-5[1m]','claude-sonnet-5-5','claude-haiku-5-5'],'stored in catalog order, blocked choices kept');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.dir,'data','pocket-settings.json'),'utf8')).offeredClaudeModels,['claude-opus-5-5[1m]','claude-sonnet-5-5','claude-haiku-5-5']);
  assert.deepEqual((await s.call('/claude/models')).body.models.map(x=>x.id),['claude-sonnet-5-5','claude-haiku-5-5']);
  // The admin lifts the policy: the saved choice applies in full, without a restart.
  s.writePolicy({});await sleep(3200);
  assert.deepEqual((await s.call('/claude/models')).body.models.map(x=>x.id),['claude-opus-5-5[1m]','claude-sonnet-5-5','claude-haiku-5-5']);
  const pd=(await s.call('/claude/models')).body;assert.equal(pd.defaultLabel,'Opus 5.5','the Pocket default counts again once offered');assert.equal(pd.pocketDefault,true);
  // Back to the server's list.
  const reset=await s.call('/settings',{offeredClaudeModels:null});
  assert.equal(reset.body.claudeModels.source,'env');assert.equal(reset.body.offeredClaudeModels,null);
});

test('HTTP: unset means every model; helper calls never name a model the policy blocks',async t=>{
  const s=await server(t,18747,{POCKET_AUTO_TITLES:'1',policy:{availableModels:['claude-sonnet-5'],availableModelsMatch:'prefix'}});
  const cm=(await s.call('/settings')).body;
  assert.equal(cm.claudeModels.source,'all');assert.deepEqual(cm.claudeModels.offered,['claude-sonnet-5-5','claude-sonnet-5']);
  assert.equal(cm.titles.configuredModels.claude,'haiku');assert.equal(cm.titles.models.claude,'claude-sonnet-5','haiku is blocked: the cheapest offered model it allows');
  assert.equal(cm.titles.claudeModelLabel,'Sonnet 5');
  const id=s.seed('Review the warehouse stock levels before ordering');
  for(let i=0;i<60&&!s.read('calls.helper-models').length;i++){await s.call('/sessions');await sleep(100);}
  const used=s.read('calls.helper-models');
  assert.ok(used.length>=1,'a title was requested');assert.ok(used.every(m=>m==='claude-sonnet-5'),'every helper call named an allowed model: '+used.join(','));
  // No policy file: everything offered, the helper keeps its configured alias.
  s.writePolicy({});await sleep(3200);
  const open=(await s.call('/settings')).body;
  assert.equal(open.claudeModels.offered.length,CLAUDE_MODELS.length);assert.equal(open.claudeModels.policy.limits,false);
  assert.equal(open.titles.models.claude,'haiku');
  assert.ok(id);
});
