// 1.117 security hardening (the 2026-11-21 authentication review), checked against the real daemon with the fake CLIs.
// PC-06 sign-out and revocation.
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
// A cookie signed the way Pocket signed every cookie before 1.117 (generation 0: the expiry alone).
const legacyCookie=(secret,ms=3600000)=>{const exp=Date.now()+ms;return 'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');};

async function server(t,port,env={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-hard-'));let logs='',child;
  const secret=randomUUID();
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  const s={dir,secret,env:{...env},port};
  s.start=async(extra={})=>{
    logs='';child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),POCKET_SKILLS:'0',PORT:String(s.port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',
      POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_DOCUMENTS_DIR:path.join(dir,'docs'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),...s.env,...extra},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
    for(let i=0;i<150;i++){if(child.exitCode!==null)break;try{if((await fetch(`http://127.0.0.1:${s.port}/api/health`)).ok)return;}catch{} await sleep(30);}
    if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(s.tries=(s.tries||0)+1)<4){s.port+=37;return s.start(extra);}
    throw Error('Test server failed: '+logs);
  };
  s.stop=async()=>{if(child&&child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}};
  t.after(async()=>{await s.stop();fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  await s.start();
  s.url=p=>`http://127.0.0.1:${s.port}${p}`;
  s.fetch=(p,{method='GET',headers={},body}={})=>fetch(s.url(p),{method,headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...headers},body:body!==undefined?JSON.stringify(body):undefined});
  s.me=async cookie=>(await (await s.fetch('/api/me',{headers:cookie?{cookie}:{}})).json()).ok;
  s.login=async(password='test-only',headers={})=>{const r=await s.fetch('/api/login',{method:'POST',headers,body:{password}});return {status:r.status,cookie:(r.headers.get('set-cookie')||'').split(';')[0]};};
  s.logs=()=>logs;
  return s;
}

test('PC-06: Sign out clears this browser\'s cookie, only from Pocket\'s own page',async t=>{
  const s=await server(t,20101);
  const {cookie}=await s.login();assert.equal(await s.me(cookie),true);
  const out=await s.fetch('/api/logout',{method:'POST',headers:{cookie},body:{}});
  assert.equal(out.status,200);assert.match(out.headers.get('set-cookie')||'',/^pc_auth=;.*Max-Age=0/,'the browser is told to drop the cookie');
  assert.equal((await s.fetch('/api/logout',{method:'POST',headers:{cookie,'sec-fetch-site':'cross-site'},body:{}})).status,403,'a cross-site sign-out is refused');
  assert.equal((await s.fetch('/api/logout',{method:'POST',headers:{cookie,origin:'https://elsewhere.example'},body:{}})).status,403,'another origin is refused');
  assert.equal((await fetch(s.url('/api/logout'),{method:'POST',headers:{cookie,'content-type':'text/plain'},body:'{}'})).status,415,'a form-like post is refused');
});

test('PC-06: Sign out everywhere ends every cookie, survives a restart, and a new sign-in works',async t=>{
  const s=await server(t,20141);
  const legacy=legacyCookie(s.secret);assert.equal(await s.me(legacy),true,'a cookie from before the upgrade still works until the first sign-out everywhere');
  const a=(await s.login()).cookie,b=(await s.login()).cookie;assert.equal(await s.me(a),true);assert.equal(await s.me(b),true);
  assert.equal((await s.fetch('/api/logout/everywhere',{method:'POST',body:{}})).status,401,'signed out callers cannot do it');
  assert.equal((await s.fetch('/api/logout/everywhere',{method:'POST',headers:{cookie:a,'sec-fetch-site':'cross-site'},body:{}})).status,403,'a cross-site request is refused');
  assert.equal((await fetch(s.url('/api/logout/everywhere'),{method:'POST',headers:{cookie:a,'content-type':'text/plain'},body:'{}'})).status,415);
  assert.equal(await s.me(a),true,'the refused requests changed nothing');
  const r=await s.fetch('/api/logout/everywhere',{method:'POST',headers:{cookie:a},body:{}});
  assert.equal(r.status,200);assert.match(r.headers.get('set-cookie')||'',/^pc_auth=;.*Max-Age=0/);
  for(const [name,c] of Object.entries({a,b,legacy}))assert.equal(await s.me(c),false,`cookie ${name} no longer signs in`);
  assert.equal((await s.fetch('/api/sessions',{headers:{cookie:b}})).status,401,'nor reaches the API');
  const fresh=(await s.login()).cookie;assert.equal(await s.me(fresh),true,'the password signs in again');
  assert.equal(fs.statSync(path.join(s.dir,'data','auth-state.json')).mode&0o777,0o600);
  await s.stop();await s.start();
  assert.equal(await s.me(fresh),true,'a cookie from after the sign-out survives a restart');
  assert.equal(await s.me(b),false,'and the ended ones stay ended');
  assert.equal(await s.me(legacyCookie(s.secret)),false,'the pre-upgrade form is not accepted any more');
});

test('PC-06: a changed POCKET_PASSWORD signs every browser out at the next start; an unreadable state file does too',async t=>{
  const s=await server(t,20181);
  const before=(await s.login()).cookie,legacy=legacyCookie(s.secret);
  await s.stop();await s.start();
  assert.equal(await s.me(before),true,'a restart with the same password keeps the browsers signed in');
  assert.equal(await s.me(legacy),true);
  await s.stop();s.env.POCKET_PASSWORD='a-new-password';await s.start();
  assert.equal(await s.me(before),false,'a cookie from before the password change is refused');
  assert.equal(await s.me(legacy),false);
  assert.match(s.logs(),/POCKET_PASSWORD changed since the last start/);
  assert.equal((await s.login('test-only')).status,403,'the old password is refused');
  const after=(await s.login('a-new-password')).cookie;assert.equal(await s.me(after),true);
  await s.stop();fs.writeFileSync(path.join(s.dir,'data','auth-state.json'),'{not json');await s.start();
  assert.equal(await s.me(after),false,'an unreadable state file does not fall back to accepting older cookies');
  assert.equal(await s.me(legacyCookie(s.secret)),false);
  assert.equal(await s.me((await s.login('a-new-password')).cookie),true);
});
