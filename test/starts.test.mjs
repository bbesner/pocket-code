// 1.57 start links: the store's rules, the routes (token write, cookie read), and the CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {StartStore,LIMITS} from '../starts.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pocket-starts-'));

test('StartStore: text, directory, agent and lifetime rules; ids; expiry; the cap; persistence',()=>{
  const dir=tmp(),file=path.join(dir,'starts.json');let clock=Date.parse('2026-10-17T12:00:00Z');
  const s=new StartStore(file,{now:()=>clock});
  const a=s.add({text:'  Reply to Suzanne about the Polo Club camera.  ',directory:'/home/u/work/',provider:'claude',title:'Email: Polo Club'},{actor:'cli'});
  assert.match(a.id,/^[0-9a-f]{12}$/);assert.equal(a.text,'Reply to Suzanne about the Polo Club camera.');assert.equal(a.directory,'/home/u/work');
  assert.equal(a.provider,'claude');assert.equal(a.by,'cli');assert.equal(a.createdAt,'2026-10-17T12:00:00Z');assert.equal(a.expiresAt,'2026-10-24T12:00:00Z','7 days by default');
  assert.throws(()=>s.add({text:'  '}),/briefing text/);assert.throws(()=>s.add({text:'x',directory:'rel/path'}),/full path/);
  assert.throws(()=>s.add({text:'x',provider:'gemini'}),/claude or codex/);assert.throws(()=>s.add({text:'x',ttlDays:0}),/1 to 30/);assert.throws(()=>s.add({text:'x',ttlDays:31}),/1 to 30/);
  assert.throws(()=>s.add({text:'x'.repeat(LIMITS.text+1)}),/too long/);
  const b=s.add({text:'Short',ttlDays:'2'});assert.equal(b.expiresAt,'2026-10-19T12:00:00Z');assert.equal(b.directory,'');assert.equal(b.provider,'');
  assert.equal(s.get(a.id).text,a.text);assert.equal(s.get('nope'),null);assert.equal(s.get(a.id.toUpperCase()),null,'ids are lowercase hex');
  clock=Date.parse('2026-10-20T12:00:00Z');assert.equal(s.get(b.id),null,'expired');assert.ok(s.get(a.id),'still good');
  assert.equal(s.purge(),1,'purge drops the expired entry');assert.equal(s.entries.length,1);
  for(let i=0;i<LIMITS.entries+5;i++)s.add({text:'n'+i});
  assert.equal(s.entries.length,LIMITS.entries,'the file keeps at most LIMITS.entries');assert.equal(s.get(a.id),null,'oldest dropped first');
  const again=new StartStore(file,{now:()=>clock});assert.equal(again.entries.length,LIMITS.entries,'persisted');
  assert.equal((fs.statSync(file).mode&0o777),0o600);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('HTTP: the token and the cookie write and read over loopback, the tunnel and signed-out are refused, unknown ids 404, and the CLI prints the link',async t=>{
  const dir=tmp();let port=18991;
  const secret=randomUUID(),exp=Date.now()+3600000;
  const cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  let child,logs='';
  const start=async()=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SKILLS:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),POCKET_PUBLIC_URL:'https://pocket.example.test',POCKET_TZ:'America/New_York'},stdio:['ignore','pipe','pipe']});
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
  const made=await call('/start',{text:'Email alert: Polo Club camera.\nReply to Suzanne.',directory:'/home/u',provider:'claude',title:'Email: Polo Club'},bearer);
  assert.equal(made.status,200);assert.match(made.body.id,/^[0-9a-f]{12}$/);assert.equal(made.body.path,'/#/start/'+made.body.id);
  assert.equal(made.body.url,'https://pocket.example.test/#/start/'+made.body.id,'the public address makes the link');
  const byCookie=await call('/start',{text:'From the UI'});assert.equal(byCookie.status,200,'the owner can write too');
  assert.equal((await call('/start',{text:'x'},{...bearer,'cf-connecting-ip':'203.0.113.5'})).status,401,'a request through the tunnel cannot use the token');
  assert.equal((await call('/start',{text:'x'},{'content-type':'application/json'})).status,401,'signed out cannot write');
  assert.equal((await call('/start',{text:''},bearer)).status,400,'an empty briefing is refused');
  assert.equal((await call('/start',{text:'x',directory:'rel'},bearer)).status,400);
  const got=await call('/start/'+made.body.id);assert.equal(got.status,200);assert.equal(got.body.text,'Email alert: Polo Club camera.\nReply to Suzanne.');
  assert.equal(got.body.directory,'/home/u');assert.equal(got.body.provider,'claude');assert.equal(got.body.title,'Email: Polo Club');assert.equal(got.body.by,'cli');
  assert.equal((await call('/start/'+made.body.id,null,bearer)).status,200,'the loopback token reads a briefing (the CLI\'s show)');
  assert.equal((await call('/start/'+made.body.id,null,{...bearer,'cf-connecting-ip':'203.0.113.5'})).status,401,'not through the tunnel');
  assert.equal((await call('/start/'+made.body.id,null,{})).status,401,'signed out cannot read');
  assert.equal((await call('/start/0123456789ab')).status,404);assert.equal((await call('/start/0123456789ab')).body.code,'start_missing');
  assert.equal((await call('/start/not-an-id')).status,404);
  const saved=JSON.parse(fs.readFileSync(path.join(dir,'data','starts.json'),'utf8'));assert.equal(saved.entries.length,2);
  const cli=(args,input)=>new Promise(r=>{const c=execFile(process.execPath,[path.join(repo,'scripts/pocket-start.mjs'),...args],{cwd:dir,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_DATA_DIR:path.join(dir,'data')}},(e,stdout,stderr)=>r({code:e?e.code:0,stdout,stderr}));if(input!==undefined){c.stdin.end(input);}});
  const a=await cli(['add','--text','From the CLI','--dir','/home/u/proj','--title','CLI link']);
  assert.equal(a.code,0,a.stderr);assert.match(a.stdout.trim(),/^https:\/\/pocket\.example\.test\/#\/start\/[0-9a-f]{12}$/);
  const id=a.stdout.trim().split('/').pop();
  const shown=await cli(['show',id,'--json']);assert.equal(shown.code,0,shown.stderr);const j=JSON.parse(shown.stdout);assert.equal(j.text,'From the CLI');assert.equal(j.directory,'/home/u/proj');
  const piped=await cli(['add','--file','-','--provider','codex'],'Piped briefing\nline two');
  assert.equal(piped.code,0,piped.stderr);const id2=piped.stdout.trim().split('/').pop();
  const j2=JSON.parse((await cli(['show',id2,'--json'])).stdout);assert.equal(j2.text,'Piped briefing\nline two');assert.equal(j2.provider,'codex');
  const bad=await cli(['add','--text','x','--provider','gemini']);assert.notEqual(bad.code,0);assert.match(bad.stderr,/claude or codex/);
  assert.equal((await cli(['show','0123456789ab'])).code,2,'an unknown id exits 2');
  assert.match(logs,/start link [0-9a-f]{12} by cli/);
});
