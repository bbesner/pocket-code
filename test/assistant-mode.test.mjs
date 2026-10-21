// 1.60 Assistant mode: the per-instance switch (POCKET_ASSISTANT_MODE locked|on|off, Settings), /api/me, the installed
// app's name and the push wording. Fake CLIs only.
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

async function server(t,port,env){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-assistant-'));let logs='';
  const secret=randomUUID(),exp=Date.now()+3600000;
  const headers={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});
  const child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),POCKET_SKILLS:'0',PORT:String(port),POCKET_ENV_FILE:'',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,
    POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),CODEX_BIN:path.join(repo,'test/fake-codex.mjs'),...env},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
  t.after(async()=>{if(child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}fs.rmSync(dir,{recursive:true,force:true});});
  for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)break;}catch{} await sleep(30);}
  if(child.exitCode!==null)throw Error('Test server failed: '+logs);
  const base=`http://127.0.0.1:${port}`;
  const call=async(p,body,signedIn=true)=>{const r=await fetch(base+'/api'+p,{method:body?'POST':'GET',headers:signedIn?headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
  const manifest=async()=>{const r=await fetch(base+'/manifest.webmanifest');return {type:r.headers.get('content-type'),body:await r.json()};};
  return {dir,call,manifest};
}

test('Assistant mode off by default: features say so, the app is Pocket Code, Settings turns it on and off', async t => {
  const s = await server(t, 18675, {});
  const me = (await s.call('/me')).body;
  assert.equal(me.features.assistantMode, false); assert.equal(me.features.assistantLocked, false);
  assert.equal((await s.manifest()).body.name, 'Pocket Code');
  const on = await s.call('/settings', { assistantMode: true });
  assert.equal(on.status, 200); assert.equal(on.body.assistantMode, true);
  assert.equal((await s.call('/me')).body.features.assistantMode, true);
  const m = await s.manifest();
  assert.equal(m.body.name, 'Pocket Assistant'); assert.equal(m.body.short_name, 'Pocket Assistant');
  assert.match(m.type, /manifest\+json/); assert.ok(m.body.icons.length >= 2, 'the icons are kept');
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.dir, 'data', 'pocket-settings.json'), 'utf8')).assistantMode, true, 'the choice is saved');
  assert.equal((await s.call('/settings', { assistantMode: false })).body.assistantMode, false);
  assert.equal((await s.call('/settings', { assistantMode: 'yes' })).body.assistantMode, false, 'only true or false changes it');
  assert.equal((await s.call('/settings', { assistantMode: true }, false)).status, 401, 'signed out cannot change it');
});

test('POCKET_ASSISTANT_MODE=on starts it on; Settings can still turn it off', async t => {
  const s = await server(t, 18676, { POCKET_ASSISTANT_MODE: 'on' });
  assert.equal((await s.call('/me')).body.features.assistantMode, true);
  assert.equal((await s.call('/me')).body.features.assistantLocked, false);
  assert.equal((await s.call('/settings', { assistantMode: false })).body.assistantMode, false);
});

test('POCKET_ASSISTANT_MODE=locked: always on, Settings refuses to turn it off, the sign-in page knows the name', async t => {
  const s = await server(t, 18677, { POCKET_ASSISTANT_MODE: 'locked' });
  const signedOut = (await s.call('/me', null, false)).body;
  assert.equal(signedOut.ok, false); assert.equal(signedOut.features.assistantMode, true, 'the sign-in page can say Pocket Assistant');
  assert.deepEqual(Object.keys(signedOut.features), ['assistantMode'], '1.73.3: signed out, nothing else about the install is told');
  const off = await s.call('/settings', { assistantMode: false });
  assert.equal(off.status, 409); assert.match(off.body.error, /locked/);
  const st = (await s.call('/settings')).body;
  assert.equal(st.assistantMode, true); assert.equal(st.assistantLocked, true);
  assert.equal((await s.manifest()).body.name, 'Pocket Assistant');
});
