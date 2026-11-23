// 1.118 security hardening (the 2026-11-21 authentication review), checked against the real daemon with the fake CLIs.
// PC-06 sign-out and revocation; PC-07 the login limit across addresses; PC-08 intake limits; PC-10 /api/health;
// PC-11 HSTS; PC-12 the time zone by POST; PC-13 upload modes;
// PC-09 the fixed dependency versions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {createHmac,randomUUID} from 'node:crypto';
import {newKey} from '../vault.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
// A cookie signed the way Pocket signed every cookie before 1.118 (generation 0: the expiry alone).
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

test('PC-08: wrong intake links from tunnelled callers never close a right link; past the instance cap they are only slowed',async t=>{
  const s=await server(t,20301,{POCKET_VAULT_KEY:newKey()});
  const owner=(await s.login()).cookie,json={cookie:owner};
  assert.equal((await s.fetch('/api/settings',{method:'POST',headers:json,body:{vault:true}})).status,200);
  const made=await s.fetch('/api/vault/intake',{method:'POST',headers:json,body:{action:'create',name:'pat-token',kind:'token'}});
  assert.equal(made.status,200);const link=(await made.json()).path;
  // Through a tunnel without POCKET_TRUSTED_PROXY or Access, every caller arrives as 127.0.0.1 and names any address it likes.
  const tunnel=i=>({'cf-connecting-ip':`198.51.100.${i%250+1}`,'x-forwarded-for':`198.51.100.${i%250+1}`});
  const get=(p,h={})=>fetch(s.url(p),{headers:h,redirect:'manual'}).then(r=>r.status);
  const miss=i=>get('/intake/'+String(i).padStart(43,'q'),tunnel(i));
  const first=[];for(let i=0;i<25;i++)first.push(await miss(i));
  assert.deepEqual(first,Array(25).fill(404),'twenty-five wrong links through the tunnel are each just not found');
  assert.equal(await get(link,tunnel(999)),200,'the client\'s right link still opens');
  for(let b=0;b<6;b++)await Promise.all(Array.from({length:50},(_,i)=>miss(1000+b*50+i)));
  let t0=Date.now();assert.equal(await miss(5000),404,'past the instance-wide cap a wrong link is still answered');
  assert.ok(Date.now()-t0>=1400,'but slowly: '+(Date.now()-t0)+' ms');
  t0=Date.now();assert.equal(await get(link,tunnel(7)),200,'and a right link is not turned away');
  assert.ok(Date.now()-t0<1000,'nor slowed: '+(Date.now()-t0)+' ms');
  // A caller Pocket can place (here a direct loopback request with no proxy headers) still has its own limit.
  const direct=[];for(let i=0;i<20;i++)direct.push(await get('/intake/'+String(i).padStart(43,'d')));
  assert.equal(await get(link),429,'after its own twenty wrong links a placed caller waits');
  assert.equal(await get(link,tunnel(8)),200,'which does not touch anyone else');
});

test('PC-10: /api/health tells a stranger only that Pocket answers; the counts are for the owner and for this box',async t=>{
  const s=await server(t,20341);
  const health=async h=>(await s.fetch('/api/health',{headers:h})).json();
  for(const h of [{'x-forwarded-for':'203.0.113.7'},{'cf-connecting-ip':'203.0.113.7'},{'cf-connecting-ip':'203.0.113.7','x-forwarded-for':'203.0.113.7'}])
    assert.deepEqual(await health(h),{ok:true},'a caller through a proxy, signed out: '+JSON.stringify(h));
  const direct=await health({});assert.equal(direct.ok,true);assert.equal(direct.active,0,'a direct loopback request (deploy scripts, pocket-init) gets the counts');assert.equal(direct.busy,0,'1.124.3: and the replies a restart would cut short, for the self-update script');
  assert.equal(typeof direct.uptime,'number');
  const owner=(await s.login()).cookie;
  const signedIn=await health({cookie:owner,'cf-connecting-ip':'203.0.113.7'});assert.equal(signedIn.active,0,'the signed-in owner through the tunnel gets them too');
  assert.equal((await s.fetch('/api/health',{headers:{'x-forwarded-for':'203.0.113.7'}})).headers.get('cache-control'),'no-store');
});

test('PC-11: Strict-Transport-Security only when the request reached the proxy over HTTPS',async t=>{
  const s=await server(t,20381);
  const hsts=async h=>(await s.fetch('/api/health',{headers:h})).headers.get('strict-transport-security');
  assert.equal(await hsts({}),null,'plain loopback HTTP');
  assert.equal(await hsts({'x-forwarded-proto':'http'}),null);
  assert.equal(await hsts({'x-forwarded-proto':'https'}),'max-age=31536000');
  assert.equal(await hsts({'x-forwarded-proto':'https, http'}),'max-age=31536000','the first proxy\'s scheme counts');
  assert.equal(await hsts({'cf-visitor':'{"scheme":"https"}'}),'max-age=31536000','Cloudflare\'s CF-Visitor');
  assert.equal((await s.fetch('/',{headers:{'x-forwarded-proto':'https'}})).headers.get('strict-transport-security'),'max-age=31536000','the app shell too');
});

test('PC-12: GET /api/me no longer stores a time zone; the owner\'s page POSTs it',async t=>{
  const s=await server(t,20421);
  const owner=(await s.login()).cookie,zone=()=>{try{return JSON.parse(fs.readFileSync(path.join(s.dir,'data','pocket-settings.json'),'utf8')).ownerTimezone;}catch{return undefined;}};
  assert.equal((await s.fetch('/api/me?tz=Pacific/Kiritimati',{headers:{cookie:owner}})).status,200);
  assert.equal(zone(),undefined,'a GET, which a link on another site can make with the cookie, changes nothing');
  assert.equal((await s.fetch('/api/timezone',{method:'POST',body:{tz:'Europe/Berlin'}})).status,401,'signed out');
  assert.equal((await s.fetch('/api/timezone',{method:'POST',headers:{cookie:owner,'sec-fetch-site':'cross-site'},body:{tz:'Europe/Berlin'}})).status,403,'cross-site');
  assert.equal(zone(),undefined);
  assert.equal((await s.fetch('/api/timezone',{method:'POST',headers:{cookie:owner},body:{tz:'Not/AZone'}})).status,200);assert.equal(zone(),undefined,'an unknown zone is ignored');
  assert.equal((await s.fetch('/api/timezone',{method:'POST',headers:{cookie:owner},body:{tz:'Europe/Berlin'}})).status,200);assert.equal(zone(),'Europe/Berlin');
  const app=await (await s.fetch('/app.js')).text();assert.doesNotMatch(app,/me\?tz=/,'the client no longer sends it on GET');assert.match(app,/api\('\/timezone'/);
});

test('PC-13: an upload is written 0600 in folders that are 0700, whatever the umask and an older folder\'s mode',async t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-hard-home-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  fs.mkdirSync(path.join(home,'pocket-uploads'),{mode:0o755});fs.chmodSync(path.join(home,'pocket-uploads'),0o755); // as an earlier release left it
  const s=await server(t,20461,{HOME:home});
  const owner=(await s.login()).cookie;
  const r=await fetch(s.url('/api/upload'),{method:'POST',headers:{cookie:owner,'x-filename':'notes.txt','content-type':'application/octet-stream'},body:'private notes'});
  assert.equal(r.status,200);const {path:dest}=await r.json();
  assert.ok(dest.startsWith(path.join(home,'pocket-uploads')+path.sep),dest);
  assert.equal(fs.readFileSync(dest,'utf8'),'private notes');
  assert.equal(fs.statSync(dest).mode&0o777,0o600,'the file');
  assert.equal(fs.statSync(path.dirname(dest)).mode&0o777,0o700,'the month folder');
  assert.equal(fs.statSync(path.join(home,'pocket-uploads')).mode&0o777,0o700,'the uploads folder');
});

// GET /api/me learns the owner's public address (for links in email) from the request's Host or X-Forwarded-Host. Only a
// signed-in request may set it: a stranger who names any host changes nothing. A link on another site that opens /api/me with
// the owner's cookie cannot choose those headers, so it records only Pocket's own address.
test('the public address is learned only from a signed-in request, never from a stranger\'s Host or X-Forwarded-Host',async t=>{
  const s=await server(t,20581);
  const saved=()=>{try{return JSON.parse(fs.readFileSync(path.join(s.dir,'data','pocket-settings.json'),'utf8')).publicUrl;}catch{return undefined;}};
  const me=(headers)=>new Promise((resolve,reject)=>{const r=http.request({host:'127.0.0.1',port:s.port,path:'/api/me',headers},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>resolve(JSON.parse(b)));});r.on('error',reject);r.end();});
  assert.equal((await me({host:'evil.example','x-forwarded-host':'evil.example','x-forwarded-proto':'https','x-forwarded-for':'203.0.113.9'})).ok,false);
  assert.equal((await me({host:'evil.example'})).ok,false);
  assert.equal(saved(),undefined,'a signed-out request names no address');
  const owner=(await s.login()).cookie;
  assert.equal((await me({cookie:owner,host:'127.0.0.1:'+s.port})).ok,true);
  assert.equal(saved(),undefined,'a request on the box itself is not a public address');
  assert.equal((await me({cookie:owner,host:'pocket.example.com','x-forwarded-proto':'https','x-forwarded-for':'203.0.113.9'})).ok,true);
  assert.equal(saved(),'https://pocket.example.com','the owner\'s own request through the proxy is');
  assert.equal((await me({host:'evil.example','x-forwarded-host':'evil.example','x-forwarded-for':'203.0.113.9'})).ok,false);
  assert.equal(saved(),'https://pocket.example.com','and a stranger cannot replace it');
});

// 1.124.2: the time zone and the public address are saved settings too. When Pocket cannot save them (a full disk, a data
// folder it can't write; here the save's temporary file is a folder), neither is kept in memory: the time zone answers 503
// (the page sends it again on its next load) and GET /api/me still answers. Before, /api/me never answered, and each value
// stayed in memory unsaved, so the next report found nothing to change and a restart lost it.
test('1.124.2: a time zone or public address that cannot be saved is not kept, /api/me still answers, and the next report saves it',async t=>{
  const s=await server(t,20621);
  const owner=(await s.login()).cookie,saved=k=>{try{return JSON.parse(fs.readFileSync(path.join(s.dir,'data','pocket-settings.json'),'utf8'))[k];}catch{return undefined;}};
  const tmp=path.join(s.dir,'data','pocket-settings.json.tmp');
  const zone=()=>s.fetch('/api/timezone',{method:'POST',headers:{cookie:owner},body:{tz:'Europe/Berlin'}});
  const me=()=>fetch(s.url('/api/me'),{headers:{cookie:owner,'x-forwarded-host':'pocket.example.com','x-forwarded-proto':'https'},signal:AbortSignal.timeout(5000)}).then(r=>r.status,e=>e.name);
  fs.mkdirSync(tmp);
  const z=await zone();
  assert.equal(z.status,503);assert.equal((await z.json()).error,'Pocket could not save the time zone. Check that its data folder has space and can be written; the page sends it again when it next loads.');
  assert.equal(await me(),200,'/api/me answers');
  assert.match(s.logs(),/owner time zone not saved: /);assert.match(s.logs(),/public address not saved: /);
  fs.rmdirSync(tmp);
  assert.equal((await zone()).status,200);assert.equal(saved('ownerTimezone'),'Europe/Berlin','the next report saves it');
  assert.equal(await me(),200);assert.equal(saved('publicUrl'),'https://pocket.example.com');
});

// CodeQL js/type-confusion-through-parameter-tampering: the pre-auth JSON parser hands these raw-body routes an array, whose length passed the check.
test('CodeQL: the upload routes refuse a JSON body instead of failing on it',async t=>{
  const s=await server(t,20501);
  const owner=(await s.login()).cookie;
  assert.equal((await s.fetch('/api/settings',{method:'POST',headers:{cookie:owner},body:{documents:true}})).status,200);
  for(const p of ['/api/upload','/api/documents']){
    const r=await s.fetch(p,{method:'POST',headers:{cookie:owner,'x-filename':'notes.txt'},body:[1,2,3]});
    assert.equal(r.status,400,p);assert.match((await r.json()).error,/empty/i,p);
  }
  const ok=await fetch(s.url('/api/documents'),{method:'POST',headers:{cookie:owner,'x-filename':'notes.txt','content-type':'application/octet-stream'},body:'kept'});
  assert.equal(ok.status,200,'a real upload still works');
});

// CodeQL js/path-injection (codex.mjs threadLocked) and js/command-line-injection (binVersion).
test('CodeQL: GET /api/session/:id checks the id, and the CLI version is read without a shell',async t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-hard-bin-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const bin=path.join(home,"it's here",'claude');fs.mkdirSync(path.dirname(bin));fs.copyFileSync(path.join(repo,'test/fake-claude.mjs'),bin);fs.chmodSync(bin,0o755);
  const s=await server(t,20541,{CLAUDE_BIN:bin});
  const owner=(await s.login()).cookie;
  for(const id of ['cx:..%2F..%2Fetc%2Fpasswd','cx:not-a-thread','..%2F..%2Fx'])assert.equal((await s.fetch('/api/session/'+id,{headers:{cookie:owner}})).status,400,id);
  assert.equal((await s.fetch('/api/session/11111111-1111-4111-8111-111111111111',{headers:{cookie:owner}})).status,404,'a well-formed id is looked up as before');
  assert.equal((await (await s.fetch('/api/about',{headers:{cookie:owner}})).json()).cli,'test-cli','a quote in the path does not break the version check');
});

test('PC-09: the installed and vendored dependencies are the fixed versions',()=>{
  const v=name=>JSON.parse(fs.readFileSync(path.join(repo,'node_modules',name,'package.json'),'utf8')).version.split('.').map(Number);
  const atLeast=(name,min)=>{const a=v(name);for(let i=0;i<3;i++)if(a[i]!==min[i])return assert.ok(a[i]>min[i],`${name} ${a.join('.')} is older than ${min.join('.')}`);};
  atLeast('body-parser',[1,20,9]);atLeast('dompurify',[3,4,18]);atLeast('nodemailer',[10,6,1]);atLeast('proxy-addr',[2,0,8]);atLeast('qs',[6,16,2]);
  const vendored=fs.readFileSync(path.join(repo,'public/vendor/purify.js'),'utf8').match(/DOMPurify (\d+\.\d+\.\d+)/)?.[1];
  assert.equal(vendored,v('dompurify').join('.'),'public/vendor/purify.js is the installed DOMPurify (npm run vendor)');
});
