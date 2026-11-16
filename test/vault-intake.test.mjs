// 1.110 intake links: someone outside types a credential into a one-time page and it lands in the Vault under a reserved
// name. The store's rules (reservation, one use, expiry, cancel, relink, only the asked fields, nothing readable on disk), the
// page and its headers, the per-address limits, the locked Vault, the owner's and the CLI token's routes, and the CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {VaultStore,parseKey,newKey,INTAKE} from '../vault.mjs';
import {renderIntake,intakeBrand,intakeWhen,contrast} from '../intake-page.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pocket-intake-'));
const PW='Qb-review-Pa55word!-7731';

test('store: a link reserves its name, takes only what it asked for, works once, expires, cancels and relinks',()=>{
  const dir=tmp(),file=path.join(dir,'vault.enc'),key=parseKey(newKey());let clock=Date.parse('2026-11-16T15:00:00Z');
  const s=new VaultStore(file,{key,now:()=>clock});
  s.act({action:'add',name:'existing',kind:'token',values:{value:'tok-0123456789'}});
  const {intake:r,token}=s.createIntake({name:'Acme-Books',kind:'login',for:'Pat Lee (Example IT)',note:'Accounting review login',fields:['windows_password']},{actor:'agent',session:'11111111-1111-4111-8111-111111111111',sessionTitle:'Acme build'});
  assert.match(token,/^[A-Za-z0-9_-]{43}$/);assert.equal(r.name,'acme-books');assert.equal(r.state,'pending');assert.equal(r.by,'agent');
  assert.deepEqual(r.fields,['username','password','windows_password']);assert.equal('tokenHash' in r,false);assert.equal('nonce' in r,false,'the view never carries the hash or the nonce');
  assert.equal(Date.parse(r.expiresAt)-clock,72*3600e3,'72 hours by default');
  // Reserved: no put, no second link, no rename onto it, no import into it.
  assert.throws(()=>s.act({action:'add',name:'acme-books',kind:'login',values:{username:'a',password:'b'}}),e=>e.code==='intake_reserved');
  assert.throws(()=>s.createIntake({name:'acme-books',kind:'login'}),e=>e.code==='intake_reserved');
  assert.throws(()=>s.act({action:'update',item:s.byName('existing').id,name:'acme-books'}),e=>e.code==='intake_reserved');
  assert.throws(()=>s.createIntake({name:'existing',kind:'token'}),/already exists/);
  assert.throws(()=>s.createIntake({name:'x',kind:'card'}),/kind must be/);
  assert.throws(()=>s.createIntake({name:'x',kind:'credentials'}),/Name the fields/);
  assert.throws(()=>s.createIntake({name:'x',kind:'login',fields:['Bad Field']}),/not a field name/);
  assert.throws(()=>s.createIntake({name:'x',kind:'login',fields:['password']}),/already a field/);
  assert.throws(()=>s.createIntake({name:'x',kind:'login',hours:24*8}),/7 days/);
  assert.throws(()=>s.createIntake({name:'x',kind:'login',note:'n'.repeat(INTAKE.note+1)}),/up to/);
  assert.throws(()=>s.createIntake({name:'x',kind:'login',for:'{{vault:existing}}'}),/cannot hold/);
  // Nothing about the link is readable on disk.
  const disk=fs.readFileSync(file,'latin1');assert.doesNotMatch(disk,/acme-books|Pat Lee/);
  // Lookup: any token shape that is not one of ours is null; ours resolves.
  assert.equal(s.resolveIntake('nope'),null);assert.equal(s.resolveIntake(token.slice(0,-1)+(token.endsWith('A')?'B':'A')),null);
  assert.equal(s.resolveIntake(token).intake.id,r.id);
  const nonce=s.intakes.find(x=>x.id===r.id).nonce;
  // The CSRF nonce, and required fields.
  assert.throws(()=>s.submitIntake(token,{nonce:'0'.repeat(32),values:{username:'u',password:PW}}),e=>e.code==='intake_nonce');
  assert.throws(()=>s.submitIntake(token,{nonce,values:{username:'pat'}}),e=>e.status===400&&e.field==='password'&&/password is required/.test(e.message));
  assert.throws(()=>s.submitIntake(token,{nonce,values:{username:'pat',password:'x'.repeat(64*1024+1)}}),/too long/);
  assert.equal(s.byName('acme-books'),null,'a refused submission stores nothing');
  // Filled: only the asked fields, default policy, owner-only notes, a record of who and how; the link is spent.
  const done=s.submitIntake(token,{nonce,values:{username:' pat@example.test ',password:PW,windows_password:'',extra_field:'ignored'},notes:'Use the RDP gateway.'});
  assert.equal(done.intake.state,'filled');assert.equal(done.item.name,'acme-books');assert.deepEqual(done.item.fields,['username','password']);assert.equal(done.item.policy,'default');
  const it=s.byName('acme-books');assert.equal(it.values.username,'pat@example.test');assert.equal(it.values.password,PW);assert.equal(it.notes,'Use the RDP gateway.');assert.equal(it.by,'intake');assert.equal(it.intake.for,'Pat Lee (Example IT)');
  assert.equal(it.addedIn.sessionTitle,'Acme build','the conversation that asked is where it was added');
  assert.equal(JSON.stringify(done).includes(PW),false,'no value comes back');
  assert.throws(()=>s.submitIntake(token,{nonce,values:{username:'again',password:'again-again'}}),e=>e.code==='intake_inactive');
  assert.equal(s.resolveIntake(token).state,'filled');
  const audit=fs.readFileSync(path.join(dir,'vault-audit.jsonl'),'utf8');assert.equal(audit.includes(PW),false);assert.equal(audit.includes(token),false);
  assert.match(audit,/"action":"intake-create"/);assert.match(audit,/"action":"put".*"by":"intake"/);
  // Relink: the old token stops working, the new one opens the same request. Cancel frees the name.
  const b=s.createIntake({name:'api-for-pat',kind:'api_key',hours:1});
  const b2=s.relinkIntake(b.intake.id);assert.equal(s.resolveIntake(b.token),null,'the old token opens nothing');assert.equal(s.resolveIntake(b2.token).intake.id,b.intake.id);assert.equal(b2.intake.links,2);
  assert.throws(()=>s.submitIntake(b.token,{nonce:s.intakes.find(x=>x.id===b.intake.id).nonce,values:{value:'v-123456'}}),e=>e.code==='intake_inactive','the old link is gone after a relink');
  // Expiry: an hour later the link is expired and the name is free.
  clock+=3600e3;assert.equal(s.resolveIntake(b2.token).state,'expired');assert.equal(s.pendingIntake('api-for-pat'),null);
  assert.throws(()=>s.relinkIntake(b.intake.id),/ended/);
  const c=s.createIntake({name:'api-for-pat',kind:'api_key'});s.cancelIntake(c.intake.id);
  assert.equal(s.resolveIntake(c.token).state,'cancelled');assert.equal(s.act({action:'add',name:'api-for-pat',kind:'api_key',values:{value:'mine-123456'}}).name,'api-for-pat');
  // The snapshot lists them without hashes; a reload keeps them; a lock forgets them; old ones are purged after 30 days.
  const snap=s.snapshot({owner:true});assert.equal(snap.intakes.length,3);assert.equal(JSON.stringify(snap.intakes).includes('tokenHash'),false);
  const again=new VaultStore(file,{key,now:()=>clock});assert.equal(again.intakes.length,3);assert.equal(again.resolveIntake(token).state,'filled');
  clock+=31*86400e3;again.purge();assert.equal(again.intakes.length,0);
});

test('page: the form, the states, escaping, the brand and its contrast',()=>{
  const brand=intakeBrand({POCKET_INTAKE_ORG:'Example <Security>',POCKET_INTAKE_ACCENT:'#ff6b00'});
  assert.ok(contrast([0xff,0x6b,0],brand.ink==='#ffffff'?[255,255,255]:[0x1a,0x17,0x15])>=4.5,'the button ink passes AA on the accent');
  const hex=brand.text.slice(1).match(/../g).map(h=>parseInt(h,16));assert.ok(contrast(hex,[255,255,255])>=4.5,'the accent as text passes AA on white');
  const r={id:'abc',name:'acme',kind:'login',fields:['tenant_id'],for:'Pat <script>',from:'',note:'Review login',nonce:'f'.repeat(32),expiresAt:'2026-11-19T20:00:00Z'};
  const html=renderIntake('form',{brand,r,token:'T'.repeat(43),expires:intakeWhen(r.expiresAt,'America/New_York'),error:'The password is required.',errorField:'password'});
  assert.match(html,/<h1>Review login<\/h1>/);assert.match(html,/Example &lt;Security&gt; asked Pat &lt;script&gt; for this\./);assert.doesNotMatch(html,/Pat <script>/);
  assert.match(html,/name="v_username"[^>]*required/);assert.match(html,/type="password" id="f-password"/);assert.match(html,/name="v_tenant_id"/);assert.match(html,/Tenant id <span class="opt">\(optional\)<\/span>/);
  assert.match(html,/id="f-password"[^>]*aria-invalid="true"/);assert.match(html,/Nothing you typed was kept/);
  assert.match(html,/expires Thursday, November 19 at 3:00 PM EST/);assert.match(html,/<input type="hidden" name="nonce" value="f{32}">/);
  assert.doesNotMatch(html,/style=|<script>|\son\w+=/,'no inline style, script or handler');assert.doesNotMatch(html,/acme/,'the Vault name is not shown to the submitter');
  for(const st of ['received','inactive','unavailable','busy'])assert.doesNotMatch(renderIntake(st,{brand}),/<form/);
  assert.match(renderIntake('unavailable',{brand,nothingSaved:true}),/nothing you entered was saved/);
  const plain=intakeBrand({});assert.equal(plain.org,'');assert.equal(plain.logo,null);assert.match(renderIntake('inactive',{brand:plain}),/ask the sender for a new link/);
});

test('HTTP: the routes, the page and its headers, one use, limits, a locked Vault, and the CLI',async t=>{
  const dir=tmp();let port=19611;
  const secret=randomUUID(),exp=Date.now()+3600000,key=newKey();
  const cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  let child,logs='';
  const start=async()=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SKILLS:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),POCKET_VAULT_KEY:key,POCKET_PUBLIC_URL:'https://pocket.example.test',POCKET_INTAKE_ORG:'Example Security',POCKET_INTAKE_ACCENT:'#ff6b00',POCKET_TZ:'America/New_York'},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
   if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=37;logs='';return start();}
   throw Error('Test server failed: '+logs);
  };
  t.after(async()=>{if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  const call=async(p,body,h=headers)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers:h,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};};
  const page=async(p,{form,h={}}={})=>{const r=await fetch(`http://127.0.0.1:${port}${p}`,{method:form?'POST':'GET',redirect:'manual',headers:{...(form?{'content-type':'application/x-www-form-urlencoded'}:{}),...h},body:form?new URLSearchParams(form).toString():undefined});return {status:r.status,headers:r.headers,text:await r.text()};};
  await start();
  // Off: the page says unavailable and keeps nothing; the API is off.
  let off=await page('/intake/'+'A'.repeat(43));assert.equal(off.status,503);assert.match(off.text,/Temporarily unavailable/);
  assert.equal((await call('/vault/intake',{action:'create',name:'x',kind:'login'})).body.code,'vault_off');
  assert.equal((await call('/settings',{vault:true})).status,200);
  const token=fs.readFileSync(path.join(dir,'data','cli-token'),'utf8').trim(),bearer={'content-type':'application/json',authorization:'Bearer '+token};
  await call('/vault/act',{action:'add',name:'other-secret',kind:'token',values:{value:'other-token-value-123'}});
  // Signed out, the API refuses; the owner and the CLI token may create.
  assert.equal((await call('/vault/intake',{action:'create',name:'x',kind:'login'},{'content-type':'application/json'})).status,401);
  const made=await call('/vault/intake',{action:'create',name:'acme-qb',kind:'login',for:'Pat Lee (Example IT)',note:'Accounting review login'},bearer);
  assert.equal(made.status,200);assert.match(made.body.url,/^https:\/\/pocket\.example\.test\/intake\/[A-Za-z0-9_-]{43}$/);assert.equal(made.body.intake.by,'terminal');
  const link=made.body.path,tok=link.split('/').pop();
  assert.equal((await call('/vault/act',{action:'add',name:'acme-qb',kind:'login',values:{username:'a',password:'bbbbbb'}})).body.code,'intake_reserved');
  // The page: the form, the right headers, nothing else from the Vault.
  const g=await page(link);assert.equal(g.status,200);
  assert.equal(g.headers.get('cache-control'),'no-store, max-age=0');assert.equal(g.headers.get('referrer-policy'),'same-origin');assert.equal(g.headers.get('x-frame-options'),'DENY');
  assert.match(g.headers.get('content-security-policy'),/default-src 'none'; script-src 'self'; style-src 'self'.*form-action 'self'.*frame-ancestors 'none'/);assert.match(g.headers.get('x-robots-tag'),/noindex/);
  assert.match(g.text,/Accounting review login/);assert.match(g.text,/Example Security asked Pat Lee \(Example IT\) for this/);assert.doesNotMatch(g.text,/other-secret|acme-qb/);
  const nonce=/name="nonce" value="([0-9a-f]{32})"/.exec(g.text)[1];
  assert.equal((await page('/intake/theme.css')).text.includes('--accent:#ff6b00'),true);assert.equal((await page('/intake/intake.css')).status,200);assert.equal((await page('/intake/intake.js')).status,200);
  assert.equal((await page('/intake/logo')).status,404,'no logo configured');
  // A post from another origin, or without the form's nonce, stores nothing.
  assert.equal((await page(link,{form:{nonce,v_username:'pat',v_password:PW},h:{origin:'https://evil.example'}})).status,403);
  const bad=await page(link,{form:{nonce:'0'.repeat(32),v_username:'pat',v_password:PW}});assert.equal(bad.status,403);assert.match(bad.text,/out of date/);
  // A missing field re-renders the form without echoing anything typed.
  assert.equal((await page(link,{form:{nonce,v_username:'pat',v_password:PW},h:{'sec-fetch-site':'cross-site'}})).status,403);
  // A browser that sends Origin: null (a no-referrer privacy setting) still reaches the form's own checks.
  const nul=await page(link,{form:{nonce,v_username:'pat',v_password:''},h:{origin:'null','sec-fetch-site':'same-origin'}});assert.equal(nul.status,400);assert.match(nul.text,/The password is required/);
  const miss=await page(link,{form:{nonce,v_username:'pat-typed-this',v_password:''}});assert.equal(miss.status,400);assert.match(miss.text,/The password is required/);assert.doesNotMatch(miss.text,/pat-typed-this/);
  // Filled: 303 to the received page; the link is dead; the item is in the Vault; the agent sees the name only.
  const ok=await page(link,{form:{nonce,v_username:'pat',v_password:PW,notes:'Through the VPN.'}});assert.equal(ok.status,303);assert.equal(ok.headers.get('location'),'/intake/done');
  assert.match((await page('/intake/done')).text,/Received\. Thank you\./);
  const dead=await page(link);assert.equal(dead.status,404);assert.match(dead.text,/This link is no longer active/);
  assert.equal((await page(link,{form:{nonce,v_username:'x',v_password:'yyyyyy'}})).status,404);
  const snap=await call('/vault',null,bearer);const it=snap.body.items.find(i=>i.name==='acme-qb');assert.ok(it);assert.equal(it.by,'intake');assert.equal(JSON.stringify(snap.body).includes(PW),false);
  assert.equal((await call('/vault/field',{item:it.id,field:'password'})).body.value,PW,'the owner can read it');
  assert.equal(snap.body.intakes.find(r=>r.name==='acme-qb').state,'filled');
  assert.equal(logs.includes(PW),false,'no value in the log');assert.equal(logs.includes(tok),false,'no token in the log');assert.match(logs,/vault intake filled name=acme-qb/);
  // The CLI: request prints the link; show on a reserved name says it is waiting; await answers; relink and cancel.
  const cliEnv={...cleanEnv(),POCKET_ENV_FILE:'',POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TZ:'America/New_York'};
  const cli=args=>new Promise(res=>execFile(process.execPath,[path.join(repo,'scripts/pocket-vault.mjs'),...args],{cwd:dir,env:cliEnv},(e,stdout,stderr)=>res({code:e?e.code:0,stdout,stderr})));
  let out=await cli(['request','pat-api','--kind','credentials','--fields','client_id,client_secret','--for','Pat Lee','--note','API pair','--expires','2d']);
  assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/^https:\/\/pocket\.example\.test\/intake\/[A-Za-z0-9_-]{43}\npat-api  \(credentials: client_id, client_secret\)  intake link waiting to be filled in, for Pat Lee  expires /);
  assert.match(out.stdout,/Never ask for the secret by email, chat or phone/);
  out=await cli(['show','pat-api']);assert.equal(out.code,4);assert.match(out.stdout,/waiting to be filled in/);
  out=await cli(['await','pat-api','--wait','1']);assert.equal(out.code,4);assert.match(out.stderr,/Still waiting/);
  out=await cli(['request','pat-api','--kind','login']);assert.equal(out.code,1);assert.match(out.stderr,/already waiting/);
  const first=/\/intake\/([A-Za-z0-9_-]{43})/.exec((await cli(['relink','pat-api'])).stdout)[1];
  const p2=await page('/intake/'+first);assert.equal(p2.status,200);const n2=/name="nonce" value="([0-9a-f]{32})"/.exec(p2.text)[1];
  const waiting=cli(['await','pat-api','--wait','20']);await sleep(400);
  assert.equal((await page('/intake/'+first,{form:{nonce:n2,v_client_id:'cid-12345',v_client_secret:'csecret-67890'}})).status,303);
  out=await waiting;assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/pat-api was filled in by Pat Lee/);assert.equal(out.stdout.includes('csecret-67890'),false);
  await cli(['request','gone-soon','--kind','token']);out=await cli(['cancel','gone-soon']);assert.equal(out.code,0);assert.match(out.stdout,/gone-soon is free again/);
  out=await cli(['requests']);assert.match(out.stdout,/gone-soon .*cancelled/);assert.match(out.stdout,/acme-qb .*filled in/);
  // Wrong links count against the address: after 20, even a right one waits.
  for(let i=0;i<20;i++)await page('/intake/'+String(i).padStart(43,'z'));
  const fresh=await call('/vault/intake',{action:'create',name:'after-limit',kind:'token'});
  const blocked=await page(fresh.body.path);assert.equal(blocked.status,429);assert.match(blocked.text,/Too many attempts/);
});

test('HTTP: a locked Vault keeps the link open and says so; nothing is held outside the store',async t=>{
  const dir=tmp();let port=19671;
  const secret=randomUUID(),exp=Date.now()+3600000,key=newKey();
  const cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const headers={'content-type':'application/json',cookie:'pc_auth='+cookie,origin:'http://127.0.0.1'};
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  let child,logs='';
  const start=async()=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SKILLS:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),POCKET_VAULT_KEY:key},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
   if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=37;logs='';return start();}
   throw Error('Test server failed: '+logs);
  };
  t.after(async()=>{if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  const call=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers:{...headers,origin:`http://127.0.0.1:${port}`},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};};
  const page=async(p,form)=>{const r=await fetch(`http://127.0.0.1:${port}${p}`,{method:form?'POST':'GET',redirect:'manual',headers:form?{'content-type':'application/x-www-form-urlencoded'}:{},body:form?new URLSearchParams(form).toString():undefined});return {status:r.status,text:await r.text()};};
  await start();
  assert.equal((await call('/settings',{vault:true})).status,200);
  const made=await call('/vault/intake',{action:'create',name:'locked-test',kind:'token'});assert.equal(made.status,200);
  const g=await page(made.body.path);const nonce=/name="nonce" value="([0-9a-f]{32})"/.exec(g.text)[1];
  assert.equal((await call('/vault/passphrase',{action:'set',passphrase:'a long passphrase here',confirm:'a long passphrase here'})).status,200);
  assert.equal((await call('/vault/lock',{})).status,200);
  const locked=await page(made.body.path);assert.equal(locked.status,503);assert.match(locked.text,/Your link still works/);
  const post=await page(made.body.path,{nonce,v_value:'tok-held-nowhere-123'});assert.equal(post.status,503);assert.match(post.text,/nothing you entered was saved/);
  assert.equal(fs.readFileSync(path.join(dir,'data','vault.enc'),'latin1').includes('tok-held-nowhere'),false);assert.equal(logs.includes('tok-held-nowhere'),false);
  assert.equal((await call('/vault/unlock',{passphrase:'a long passphrase here'})).status,200);
  assert.equal((await page(made.body.path,{nonce,v_value:'tok-after-unlock-123'})).status,303,'after the unlock the same link and form still work');
});
