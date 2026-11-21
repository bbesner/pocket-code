// 1.117 security hardening (the 2026-11-21 authentication review), checked against the real daemon with the fake CLIs.
// PC-06 sign-out and revocation; PC-07 the login limit across addresses.
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

test('PC-07: an IPv6 caller counts as its /64; another /64 and IPv4-mapped addresses count as expected',async t=>{
  const s=await server(t,20221,{POCKET_TRUSTED_PROXY:'1',POCKET_LOGIN_BACKOFF_MS:'20'});
  const wrong=ip=>s.login('wrong',{'cf-connecting-ip':ip}).then(r=>r.status);
  const got=[];for(let i=1;i<=21;i++)got.push(await wrong(`2001:db8:1:2:${i.toString(16)}::${i}`));
  assert.deepEqual(got,[...Array(20).fill(403),429],'twenty wrong passwords from one /64, each from a new address, then the limit');
  assert.equal(await wrong('2001:db8:1:2::ffff'),429,'the compressed form of the same /64');
  assert.equal(await wrong('2001:db8:1:3::1'),403,'the next /64 has its own count');
  const v4=[];for(let i=0;i<20;i++)v4.push(await wrong(i%2?'::ffff:203.0.113.9':'203.0.113.9'));
  assert.equal(await wrong('203.0.113.9'),429,'an IPv4-mapped address counts with its IPv4 one: '+v4.join(','));
});

test('PC-07: past a budget across all addresses, wrong passwords are checked one at a time; a flood is turned away at once; the owner still gets in and a signed-in browser is untouched',async t=>{
  const s=await server(t,20261,{POCKET_TRUSTED_PROXY:'1',POCKET_LOGIN_BACKOFF_MS:'100'});
  const signedIn=(await s.login()).cookie;
  const wrong=i=>s.login('wrong '+i,{'cf-connecting-ip':`198.51.${100+Math.floor(i/200)}.${i%200+1}`});
  let t0=Date.now();const free=[];for(let i=0;i<30;i++)free.push((await wrong(i)).status);
  assert.deepEqual(free,Array(30).fill(403),'thirty wrong passwords from thirty addresses, nothing slowed');
  assert.ok(Date.now()-t0<3000,'the free budget is not slowed: '+(Date.now()-t0)+' ms');
  t0=Date.now();const flood=await Promise.all(Array.from({length:60},(_,i)=>wrong(100+i).then(r=>({status:r.status,ms:Date.now()-t0}))));
  const checked=flood.filter(r=>r.status===403),busy=flood.filter(r=>r.status===429);
  assert.equal(checked.length+busy.length,60,'every request is answered 403 or 429: '+flood.map(r=>r.status).join(','));
  assert.ok(busy.length>=30,`most of sixty parallel guesses are turned away unchecked (${busy.length} were)`);
  assert.ok(checked.length<=25,`only about twenty are checked (${checked.length} were)`);
  assert.ok(Math.max(...checked.map(r=>r.ms))>=1500,'and those were checked one gap apart: the last after '+Math.max(...checked.map(r=>r.ms))+' ms');
  assert.ok(Math.max(...busy.map(r=>r.ms))<1000,'turned-away guesses are answered at once');
  assert.equal(await s.me(signedIn),true,'a signed-in browser is untouched');
  t0=Date.now();const owner=await s.login('test-only',{'cf-connecting-ip':'192.0.2.50'});
  assert.equal(owner.status,200,'the owner\'s right password works once the flood has been answered');
  assert.ok(Date.now()-t0<=1500,'after at most one gap: '+(Date.now()-t0)+' ms');
  const page=await fetch(s.url('/app.js')).then(r=>r.text());
  assert.match(page,/e\.code === 'busy'/,'the sign-in page tells a busy answer from the hour limit');
});
