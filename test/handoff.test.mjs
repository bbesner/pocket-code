// 1.96 handoffs: the parent comes from the runner token, a handoff starts once, and it never gains permission.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {StartStore,handoffInstructions} from '../starts.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX|CLAUDE|OPENCODE)_/.test(k)));

test('StartStore: only the server sets the handoff fields; a started entry keeps its conversation',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'handoff-')),file=path.join(dir,'starts.json');
  const s=new StartStore(file);
  const plain=s.add({text:'x',kind:'handoff',from:'forged',approvalMode:'full'});
  assert.equal(plain.kind,undefined,'the body cannot make a handoff');assert.equal(plain.from,undefined);assert.equal(plain.approvalMode,undefined);
  const h=s.add({text:'y'},{handoff:{from:'abc',fromTitle:'Parent',approvalMode:'nonsense'}});
  assert.equal(h.kind,'handoff');assert.equal(h.from,'abc');assert.equal(h.approvalMode,'review','an unknown mode falls to the stricter one');
  assert.throws(()=>s.add({text:'z',provider:'acp'}),/claude or codex/);
  assert.equal(s.add({text:'z',provider:'acp'},{providers:['claude','codex','acp']}).provider,'acp');
  s.markStarted(h.id,'child');assert.equal(new StartStore(file).get(h.id).startedSession,'child','survives a restart');
  assert.match(handoffInstructions('/x/pocket-start.mjs'),/\/x\/pocket-start\.mjs add --handoff/);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('HTTP: parent, double start, permission and folder',{timeout:60_000},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'handoff-')),home=path.join(dir,'home'),work=path.join(home,'work');
  for(const d of [work,path.join(dir,'sessions')])fs.mkdirSync(d,{recursive:true});
  const port=18000+Math.floor(Math.random()*2000),secret='handoff-'+port,exp=Date.now()+3600_000;
  const headers={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
  const child=spawn(process.execPath,['server.mjs'],{cwd:repo,stdio:['ignore','pipe','pipe'],env:{...cleanEnv(),HOME:home,PORT:String(port),POCKET_SKILLS:'0',POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_APPROVAL_MODE:'full',
    POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs')}});
  let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  t.after(()=>{child.kill('SIGKILL');fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  for(let i=0;;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)break;}catch{} if(i>200)throw Error('no server: '+logs);await sleep(30);}
  const call=async(p,body,h=headers)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers:h,body:body?JSON.stringify(body):undefined});return{status:r.status,body:await r.json().catch(()=>null)};};
  const bearer={'content-type':'application/json',authorization:'Bearer '+fs.readFileSync(path.join(dir,'data','cli-token'),'utf8').trim()};
  const calls=()=>fs.readFileSync(path.join(dir,'calls'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
  const running=async(id)=>{for(let i=0;i<200;i++){const c=fs.existsSync(path.join(dir,'calls'))?calls().find(x=>x.id===id):null;if(c)return c;await sleep(30);}throw Error('no call: '+logs);};

  // A terminal (no runner token) has no parent, whatever it says, and gets Review actions.
  const forged=await call('/start',{text:'From a terminal',directory:work,kind:'handoff',from:'someone-else',approvalMode:'full'},bearer);
  assert.equal(forged.status,200,JSON.stringify(forged.body));
  const terminal=(await call('/start/'+forged.body.id)).body;
  assert.equal(terminal.kind,'handoff');assert.equal(terminal.from,'');assert.equal(terminal.approvalMode,'review');
  const bogus=await call('/start',{text:'Bad token',directory:work,kind:'handoff'},{...bearer,'x-pocket-runner':'not-a-token'});
  assert.equal((await call('/start/'+bogus.body.id)).body.from,'','an unknown runner token proves nothing');

  // A parent on Full access, with the default also Full access, passes Full access on, and the provider follows it.
  const parent=(await call('/new',{cwd:work,text:'__HANG__ parent',approvalMode:'full'})).body.id;
  const agent={...bearer,'x-pocket-runner':(await running(parent)).runnerToken};
  const made=await call('/start',{text:'Pick up the work',directory:work,kind:'handoff',title:'Next step'},agent);
  const entry=(await call('/start/'+made.body.id)).body;
  assert.equal(entry.from,parent);assert.equal(entry.approvalMode,'full');assert.equal(entry.provider,'claude');

  // Two starts at once, then a third: one conversation.
  const go=()=>call('/new',{text:entry.text,cwd:work,start:made.body.id,approvalMode:'full'});
  const both=await Promise.all([go(),go()]);
  assert.deepEqual(both.map(r=>r.status).sort(),[202,409],JSON.stringify(both.map(r=>r.body)));
  const childId=both.find(r=>r.status===202).body.id;
  const third=await go();assert.equal(third.status,409);assert.equal(third.body.code,'start_used');assert.equal(third.body.id,childId);
  const started=(await call('/start/'+made.body.id)).body;assert.equal(started.startedSession,childId);assert.ok(started.startedTitle);

  // Lineage on both sides.
  const kid=(await call('/session/'+childId)).body;assert.equal(kid.continuedFrom?.id,parent);
  assert.deepEqual((await call('/session/'+parent)).body.continuedIn?.map(x=>x.id),[childId]);

  // A parent on Review actions: the child can't ask for more.
  const strict=(await call('/new',{cwd:work,text:'__HANG__ strict',approvalMode:'review'})).body.id;
  const strictMade=await call('/start',{text:'Careful work',directory:work,kind:'handoff'},{...bearer,'x-pocket-runner':(await running(strict)).runnerToken});
  assert.equal((await call('/start/'+strictMade.body.id)).body.approvalMode,'review');
  const loose=await call('/new',{text:'Careful work',cwd:work,start:strictMade.body.id,approvalMode:'full'});
  assert.equal(loose.status,202);assert.equal((await running(loose.body.id)).permissionMode,'default','Review actions, whatever the request said');

  // The folder and the secret check.
  const gone=path.join(home,'gone');fs.mkdirSync(gone);
  const later=await call('/start',{text:'Folder test',directory:gone,kind:'handoff'},bearer);fs.rmdirSync(gone);
  assert.equal((await call('/start/'+later.body.id)).body.folderMissing,true);
  const key='sk-ant-'+'api03-'+'a1B2c3D4e5F6g7H8i9J0'.repeat(4);
  const secretBrief=await call('/start',{text:'Use '+key,directory:work,kind:'handoff'},bearer);
  assert.equal(secretBrief.status,422);assert.equal(secretBrief.body.code,'secret_detected');

  // The CLI: --handoff defaults to the folder it runs in and sends the runner token.
  const out=await new Promise(r=>execFile(process.execPath,[path.join(repo,'scripts/pocket-start.mjs'),'add','--handoff','--text','From the CLI','--json'],{cwd:work,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_DATA_DIR:path.join(dir,'data'),POCKET_RUNNER_TOKEN:agent['x-pocket-runner']}},(e,stdout,stderr)=>r({e,stdout,stderr})));
  assert.equal(out.e,null,out.stderr);
  const viaCli=(await call('/start/'+JSON.parse(out.stdout).id)).body;
  assert.equal(viaCli.directory,fs.realpathSync(work));assert.equal(viaCli.from,parent);

  // 1.115: a conversation started from an Inbox entry and then handed off gives the entry to the conversation that continues
  // it, and "separate subject" from there splits the newest mail off with a briefing of its own.
  assert.equal((await call('/settings',{inbox:true})).status,200);
  const brief=await call('/start',{text:'Harbor gate: the controller is offline. Check the vendor thread.',directory:work,title:'Harbor gate down'},bearer);
  const first=(await call('/inbox',{title:'Harbor gate down',text:'The gate controller is offline.',story:'harbor-gate',url:'/#/start/'+brief.body.id,push:false},bearer)).body.entry;
  const lead=(await call('/new',{cwd:work,text:'__HANG__ gate',start:brief.body.id,approvalMode:'full'})).body.id;
  const leadAgent={...bearer,'x-pocket-runner':(await running(lead)).runnerToken};
  const entryNow=async()=>(await call('/inbox?state=all')).body.entries.find(e=>e.id===first.id);
  assert.deepEqual((await entryNow()).sessions.map(x=>x.id),[lead]);
  const hand=await call('/start',{text:'Pick up the gate story',directory:work,kind:'handoff'},leadAgent);
  const next=(await call('/new',{text:'__HANG__ gate, continued',cwd:work,start:hand.body.id,approvalMode:'full'})).body.id;
  assert.deepEqual((await entryNow()).sessions.map(x=>[x.id,x.handed===true]),[[lead,true],[next,false]],'the entry now opens the conversation that took over');
  const quote=await call('/start',{text:'Harbor pool cameras: the board asks for a quote.',directory:work,title:'Harbor pool camera quote'},bearer);
  const upd=(await call('/inbox',{title:'Harbor pool camera quote',text:'The board asks for a quote on two pool cameras.',story:'harbor-gate',url:'/#/start/'+quote.body.id,push:false},bearer)).body;
  assert.deepEqual([upd.updated,upd.entry.id],[true,first.id]);
  assert.deepEqual((await call('/inbox/news?session='+lead)).body.news,[],'a handed-off conversation is offered nothing');
  const split=await call('/inbox/split',{session:next});
  assert.equal(split.status,200,JSON.stringify(split.body));
  assert.deepEqual([split.body.entry.title,split.body.entry.splitFrom,split.body.from.title,split.body.session],['Harbor pool camera quote',first.id,'Harbor gate down',null]);
  assert.match(split.body.start,/^\/#\/start\/[0-9a-f]{12}$/);assert.equal(split.body.entry.url,split.body.start);
  const own=(await call('/start/'+split.body.start.slice(9))).body;
  assert.match(own.text,/^Harbor pool cameras: the board asks for a quote\.\n\n---\nThe owner split this off the Inbox entry "Harbor gate down" as a separate subject\. Work it on its own, and do not merge this entry back into that one\.\nBackground only: the earlier conversation on that entry/);
  assert.deepEqual([own.directory,own.title,own.kind],[fs.realpathSync(work),'Harbor pool camera quote',undefined],'an ordinary briefing in the same folder; nothing starts until Start');
  assert.deepEqual((await call('/inbox/news?session='+next)).body.news,[]);
});
