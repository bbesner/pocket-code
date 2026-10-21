// 1.44 the Vault keeps its own key: switching it on with no key creates one and saves it to .env; the owner can
// download it, rotate it (saved, crash-safe) and restore it when it goes missing; a store is never recreated over.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {VaultStore,parseKey,decryptStore,newKey} from '../vault.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const keyLine=t=>(/^POCKET_VAULT_KEY=(.+)$/m.exec(t)||[])[1];

test('HTTP: the Vault creates its key on first switch-on, survives a restart, rotates crash-safely, and restores a missing key',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-vkey-'));let port=19101;
  const secret=randomUUID(),exp=Date.now()+3600000,cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
  const envFile=path.join(dir,'.env');fs.writeFileSync(envFile,'# test install\nSOMETHING_ELSE=1');
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  let child,logs='';
  const start=async()=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:envFile,POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SKILLS:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs')},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
   if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=41;logs='';return start();}
   throw Error('Test server failed: '+logs);
  };
  const stop=async()=>{if(child&&child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}};
  t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  const call=async(p,body,h=headers)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers:h,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};};
  await start();
  // Nothing yet: switching on is allowed and creates the key.
  let st=(await call('/settings')).body;assert.equal(st.vaultCanCreateKey,true);assert.equal(st.vaultNeedsKey,false);assert.equal(st.vaultKeyPresent,false);
  let on=await call('/settings',{vault:true});assert.equal(on.status,200,JSON.stringify(on.body));
  assert.equal(on.body.vault,true);assert.equal(on.body.vaultMode,'key');assert.equal(parseKey(on.body.recoveryKey).length,32,'the recovery key comes back once');
  const created=on.body.recoveryKey;
  let env=fs.readFileSync(envFile,'utf8');assert.equal(keyLine(env),created,'saved to .env');assert.match(env,/^SOMETHING_ELSE=1$/m,'the rest of .env is kept');
  assert.equal(fs.statSync(envFile).mode&0o777,0o600);assert.ok(fs.existsSync(path.join(dir,'data','vault.enc')),'an empty store is written');
  assert.equal((await call('/settings')).body.recoveryKey,undefined,'only in that one answer');
  assert.equal(logs.includes(created),false,'the key never reaches the log');
  assert.equal((await call('/vault/act',{action:'add',name:'zoho-books',kind:'api_key',values:{value:'zoho-secret-123456'}})).status,200);
  // The owner can take a copy; the CLI token cannot.
  const token=fs.readFileSync(path.join(dir,'data','cli-token'),'utf8').trim();
  assert.equal((await call('/vault/recovery-key',{},{'content-type':'application/json',authorization:'Bearer '+token})).status,401);
  const copy=await call('/vault/recovery-key',{});assert.equal(copy.status,200);assert.equal(copy.body.key,created);
  // A restart opens it from .env, with no manual step.
  await stop();await start();
  st=(await call('/settings')).body;assert.equal(st.vault,true);assert.equal(st.vaultReady,true);assert.equal(st.vaultCanCreateKey,false);
  assert.equal((await call('/vault')).body.items[0].name,'zoho-books');
  // Rotation saves the new key itself and leaves no previous key behind; the store opens only with the new one.
  const rot=await call('/vault/rotate',{});assert.equal(rot.status,200);assert.equal(rot.body.saved,true);
  env=fs.readFileSync(envFile,'utf8');assert.equal(keyLine(env),rot.body.key);assert.doesNotMatch(env,/POCKET_VAULT_KEY_PREVIOUS/);
  const buf=fs.readFileSync(path.join(dir,'data','vault.enc'));assert.throws(()=>decryptStore([parseKey(created)],buf),/cannot be opened/);
  assert.equal(decryptStore([parseKey(rot.body.key)],buf).items[0].name,'zoho-books');
  // 1.73.6: a rotation whose store write fails changes nothing: .env keeps the key the store is under, the recovery key is that key,
  // and the next ordinary save is still under it.
  fs.chmodSync(path.join(dir,'data'),0o500);
  try{const bad=await call('/vault/rotate',{});assert.equal(bad.status,500,JSON.stringify(bad.body));assert.match(bad.body.error,/EACCES/);}finally{fs.chmodSync(path.join(dir,'data'),0o700);}
  env=fs.readFileSync(envFile,'utf8');assert.equal(keyLine(env),rot.body.key,'.env is back to the key the store is under');assert.doesNotMatch(env,/POCKET_VAULT_KEY_PREVIOUS/);
  assert.equal((await call('/vault/recovery-key',{})).body.key,rot.body.key,'the recovery key is the one the store is under');
  assert.equal((await call('/vault/act',{action:'update',item:(await call('/vault')).body.items[0].id,tags:['after']})).status,200);
  assert.deepEqual(decryptStore([parseKey(rot.body.key)],fs.readFileSync(path.join(dir,'data','vault.enc'))).items[0].tags,['after'],'the next save is under the same key');
  // A crash between the two saves: .env has the new key and the previous one; the store, still under the old key, opens.
  const old=rot.body.key,next=parseKey(Buffer.alloc(32,7).toString('base64')).toString('base64');
  fs.writeFileSync(envFile,env.replace(`POCKET_VAULT_KEY=${old}`,`POCKET_VAULT_KEY=${next}\nPOCKET_VAULT_KEY_PREVIOUS=${old}`));
  await stop();await start();
  assert.equal((await call('/settings')).body.vaultReady,true,'opened through the previous key');assert.equal((await call('/vault')).body.items.length,1);
  fs.writeFileSync(envFile,env); // back to the real state
  // The key goes missing: the Vault is never recreated over the store; the owner restores it from the recovery key.
  fs.writeFileSync(envFile,'# test install\nSOMETHING_ELSE=1\n');await stop();await start();
  st=(await call('/settings')).body;assert.equal(st.vaultNeedsKey,true);assert.equal(st.vaultCanCreateKey,false);assert.equal(st.vaultReady,false);
  assert.equal((await call('/vault')).status,503);
  const off=await call('/settings',{vault:false});assert.equal(off.body.vault,false);
  const again=await call('/settings',{vault:true});assert.equal(again.status,409);assert.equal(again.body.code,'vault_needs_key');
  assert.equal((await call('/vault/restore-key',{key:created})).status,400,'the rotated-away key does not open it');
  assert.equal((await call('/vault/restore-key',{key:'nonsense'})).status,400);
  assert.equal((await call('/vault/restore-key',{key:old},{'content-type':'application/json',authorization:'Bearer '+token})).status,401,'owner only');
  const back=await call('/vault/restore-key',{key:`POCKET_VAULT_KEY=${old}`});assert.equal(back.status,200,JSON.stringify(back.body));
  assert.equal(keyLine(fs.readFileSync(envFile,'utf8')),old,'saved again');
  assert.equal((await call('/settings',{vault:true})).body.vault,true);assert.equal((await call('/vault')).body.items[0].name,'zoho-books','everything is back');
  assert.equal((await call('/vault/restore-key',{key:old})).status,409,'nothing to restore now');
  const audit=fs.readFileSync(path.join(dir,'data','vault-audit.jsonl'),'utf8');
  for(const a of ['key-created','recovery-key-view','rotate','key-restored'])assert.match(audit,new RegExp(`"action":"${a}"`));
  for(const k of [created,old])assert.equal(audit.includes(k),false,'no key in the audit');
  // Passphrase mode has no server key to hand out.
  assert.equal((await call('/vault/passphrase',{action:'set',passphrase:'correct horse battery',confirm:'correct horse battery'})).status,200);
  assert.equal((await call('/vault/recovery-key',{})).status,400);
});

// 1.73.6: a key set in the daemon's environment (not .env) cannot be rotated there; the route says so instead of leaving a store no key opens.
test('HTTP: a Vault key set in the process environment is not rotated',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-vkey-env-'));let port=19151;
  const secret=randomUUID(),exp=Date.now()+3600000,cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
  const envFile=path.join(dir,'.env');fs.writeFileSync(envFile,'# test install\n');
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  let child,logs='';const key=newKey();
  const start=async()=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:envFile,POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SKILLS:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),POCKET_VAULT_KEY:key},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
   if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=41;logs='';return start();}
   throw Error('Test server failed: '+logs);
  };
  t.after(async()=>{if(child&&child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  const call=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};};
  await start();
  assert.equal((await call('/settings',{vault:true})).body.vault,true);
  assert.equal((await call('/vault/act',{action:'add',name:'zoho-books',kind:'api_key',values:{value:'zoho-secret-123456'}})).status,200);
  const rot=await call('/vault/rotate',{});assert.equal(rot.status,409);assert.equal(rot.body.code,'vault_key_preset');assert.match(rot.body.error,/environment/);
  assert.doesNotMatch(fs.readFileSync(envFile,'utf8'),/POCKET_VAULT_KEY/,'.env was not written');
  assert.equal(decryptStore([parseKey(key)],fs.readFileSync(path.join(dir,'data','vault.enc'))).items[0].name,'zoho-books','the store is still under the environment key');
  assert.equal((await call('/vault/recovery-key',{})).body.key,key);
});