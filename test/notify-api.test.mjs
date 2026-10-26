// 1.58.1: POST /api/notify and scripts/pocket-notify.mjs — an alert from an agent or a job on the server, as a push and,
// when asked, an email. Push is off here (no VAPID keys), so the route reports push=null; the file transport records mail.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pocket-notify-api-'));

test('HTTP: /api/notify takes the token and the cookie, refuses the tunnel, signed-out, a missing title and a foreign link, mails when asked, and the CLI prints the result',async t=>{
  const dir=tmp();let port=19471;
  const secret=randomUUID(),exp=Date.now()+3600000;
  const cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
  const mailFile=path.join(dir,'mail.jsonl');
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  fs.writeFileSync(path.join(dir,'data','pocket-settings.json'),JSON.stringify({notifyEmail:'owner@example.test'}));
  let child,logs='';
  const start=async()=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SKILLS:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),POCKET_PUBLIC_URL:'https://pocket.example.test',POCKET_TZ:'America/New_York',POCKET_SMTP_URL:'file:'+mailFile,POCKET_SMTP_FROM:'pocket@example.test'},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
   if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=41;logs='';return start();}
   throw Error('Test server failed: '+logs);
  };
  const stop=async()=>{if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}};
  t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  const call=async(p,body,h=headers)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:'POST',headers:h,body:JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>({}))};};
  await start();
  const token=fs.readFileSync(path.join(dir,'data','cli-token'),'utf8').trim();
  const bearer={'content-type':'application/json',authorization:'Bearer '+token};
  const a=await call('/notify',{title:'Oakridge dispatch conflict',body:'Jordan is on the way for 9–10; Robin says it was last night.',url:'/#/start/0123456789ab',tag:'oakridge|abc'},bearer);
  assert.equal(a.status,200,JSON.stringify(a.body));assert.equal(a.body.ok,true);assert.equal(a.body.push,null,'push is off without VAPID keys');assert.equal(a.body.mail,false,'no email unless asked');assert.equal(a.body.url,'/#/start/0123456789ab');
  const m=await call('/notify',{title:'With mail',body:'Line one\nLine two',url:'https://pocket.example.test/#/tasks',email:true},bearer);
  assert.equal(m.status,200);assert.equal(m.body.mail,true);assert.equal(m.body.url,'/#/tasks','the public address is trimmed to a path');
  const line=JSON.parse(fs.readFileSync(mailFile,'utf8').trim().split('\n').pop());
  assert.equal(line.to,'owner@example.test');assert.equal(line.subject,'[Pocket Code] With mail');assert.match(line.text,/Line one\nLine two\n\nhttps:\/\/pocket\.example\.test\/#\/tasks/);assert.match(line.html,/Line one<br>Line two/);assert.match(line.html,/Open in Pocket Code/);
  assert.equal((await call('/notify',{title:'By cookie',body:'x'})).status,200,'the owner can send too');
  assert.equal((await call('/notify',{title:'x',body:'x'},{...bearer,'cf-connecting-ip':'203.0.113.5'})).status,401,'a request through the tunnel cannot use the token');
  assert.equal((await call('/notify',{title:'x',body:'x'},{'content-type':'application/json'})).status,401,'signed out cannot send');
  const noTitle=await call('/notify',{body:'x'},bearer);assert.equal(noTitle.status,400);assert.equal(noTitle.body.code,'no_title');
  const foreign=await call('/notify',{title:'x',body:'x',url:'https://evil.example/phish'},bearer);assert.equal(foreign.status,400);assert.equal(foreign.body.code,'bad_url');
  fs.writeFileSync(path.join(dir,'data','pocket-settings.json'),JSON.stringify({notifyEmail:''}));
  await stop();await start();
  const bearer2={'content-type':'application/json',authorization:'Bearer '+fs.readFileSync(path.join(dir,'data','cli-token'),'utf8').trim()}; // the daemon writes a new token at every start
  const off=await call('/notify',{title:'No address',body:'x',email:true},bearer2);assert.equal(off.status,200);assert.equal(off.body.mail,'off','asked for email with no address saved');
  const cli=(args,input)=>new Promise(r=>{const c=execFile(process.execPath,[path.join(repo,'scripts/pocket-notify.mjs'),...args],{cwd:dir,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_DATA_DIR:path.join(dir,'data')}},(e,stdout,stderr)=>r({code:e?e.code:0,stdout,stderr}));if(input!==undefined){c.stdin.end(input);}});
  const c=await cli(['--title','From the CLI','--file','-','--url','/#/start/0123456789ab'],'The body from stdin');
  assert.equal(c.code,0,c.stderr);assert.equal(c.stdout.trim(),'push=off mail=no');
  const j=await cli(['--title','JSON','--body','b','--json']);assert.equal(j.code,0,j.stderr);assert.equal(JSON.parse(j.stdout).ok,true);
  const bad=await cli(['--body','no title']);assert.equal(bad.code,1);assert.match(bad.stderr,/--title/);
  assert.match(logs,/notify "From the CLI" by cli push=off mail=false/);
});
