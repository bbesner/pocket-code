// Follow-ups to the 1.118 sign-in hardening (the independent review's D-5, D-6 and D-7), against the real daemon.
// D-5: a missing or older state file never revives a signed-out cookie; a password changed with the upgrade ends the old
// cookies; signing out removes push subscriptions. D-6: a "known device" cookie lets the owner past a flood of wrong
// passwords; the address key and the per-address limit hold. D-7: more proxy headers count as "came through a proxy".
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
// A cookie in the form Pocket signed before 1.118 (the expiry alone).
const legacyCookie=(secret,ms=3600000)=>{const exp=Date.now()+ms;return 'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');};
const mark=(secret,password)=>createHmac('sha256',secret).update('pocket-password\0'+password).digest('hex');

async function server(t,port,env={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-authfu-'));let logs='',child;
  const secret=randomUUID();
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  const s={dir,secret,env:{...env},port,state:path.join(dir,'data','auth-state.json')};
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
  s.login=async(password='test-only',headers={})=>{
    const r=await s.fetch('/api/login',{method:'POST',headers,body:{password}}),set=r.headers.getSetCookie();
    const pick=name=>(set.find(c=>c.startsWith(name+'='))||'').split(';')[0];
    return {status:r.status,code:(await r.json().catch(()=>({}))).code,cookie:pick('pc_auth'),device:pick('pc_device'),raw:set};
  };
  s.logs=()=>logs;
  s.subs=()=>{try{return JSON.parse(fs.readFileSync(path.join(dir,'data','push-subs.json'),'utf8'));}catch{return null;}};
  return s;
}

test('D-5.1: a deleted, corrupt or earlier-build state file never brings back a signed-out or pre-upgrade cookie',async t=>{
  const s=await server(t,22601);
  const a=(await s.login()).cookie,legacy=legacyCookie(s.secret);
  assert.equal(await s.me(a),true);assert.equal(await s.me(legacy),true,'a new install starts at generation 0, the pre-1.118 form');
  // The file is removed with no sign-out at all: the next start fails closed.
  await s.stop();fs.unlinkSync(s.state);await s.start();
  assert.equal(await s.me(a),false,'a cookie from before the file went missing signs in no more');
  assert.equal(await s.me(legacy),false);
  assert.match(s.logs(),/auth-state\.json is missing: a new sign-in generation starts/);
  // Sign out everywhere, then the file goes missing again: the revoked cookie stays revoked.
  const b=(await s.login()).cookie;
  assert.equal((await s.fetch('/api/logout/everywhere',{method:'POST',headers:{cookie:b},body:{}})).status,200);
  assert.equal(await s.me(b),false);
  await s.stop();fs.unlinkSync(s.state);await s.start();
  assert.equal(await s.me(b),false,'a cookie ended by Sign out everywhere is not revived by a missing file');
  // A state file written by the 1.118 release candidate (an integer generation 0) counts as an earlier build.
  const c=(await s.login()).cookie;
  await s.stop();fs.writeFileSync(s.state,JSON.stringify({generation:0,password:mark(s.secret,'test-only')}));await s.start();
  assert.equal(await s.me(c),false);assert.equal(await s.me(legacyCookie(s.secret)),false,'generation 0 does not come back');
  assert.match(s.logs(),/is from an earlier build/);
  // Unreadable (mode 000) and corrupt files: the same.
  const d=(await s.login()).cookie;
  await s.stop();fs.chmodSync(s.state,0);await s.start();
  assert.equal(await s.me(d),false,'an unreadable file starts a new generation');
  const e=(await s.login()).cookie;assert.equal(await s.me(e),true,'and the password signs in again');
  assert.equal(fs.statSync(s.state).mode&0o777,0o600,'the replacement file is 0600');
  await s.stop();fs.writeFileSync(s.state,JSON.stringify({v:2,generation:'x',password:mark(s.secret,'test-only')}));await s.start();
  assert.equal(await s.me(e),false,'a malformed generation is not trusted');
  // An ordinary restart keeps everyone signed in.
  const f=(await s.login()).cookie;await s.stop();await s.start();
  assert.equal(await s.me(f),true,'a restart with the state file in place keeps the browsers signed in');
});

test('D-5.1: a data folder restored from a copy taken before the upgrade (Pocket files, no auth-state.json) signs everyone in again',async t=>{
  const s=await server(t,22621);
  await s.stop();fs.unlinkSync(s.state);fs.unlinkSync(path.join(s.dir,'data','cli-url')); // a copy holds the files of a daemon that ran: cli-token at least
  await s.start();
  assert.equal(await s.me(legacyCookie(s.secret)),false,'a cookie from before the upgrade is refused');
  assert.equal(await s.me((await s.login()).cookie),true);
});

test('D-5.2: a password changed in the same restart as the upgrade ends the cookies issued before it',async t=>{
  const s=await server(t,22641);
  const legacy=legacyCookie(s.secret,80*24*3600*1000);
  await s.stop();fs.unlinkSync(s.state); // as before the first start on this version: no state file yet
  s.env.POCKET_PASSWORD='changed-with-the-upgrade';await s.start();
  assert.equal(await s.me(legacy),false,'the pre-upgrade cookie is refused');
  assert.equal((await s.login('test-only')).status,403);
  assert.equal(await s.me((await s.login('changed-with-the-upgrade')).cookie),true);
});

test('D-5.3: Sign out removes this browser\'s push subscription; Sign out everywhere removes every one',async t=>{
  const s=await server(t,22681);
  const a=(await s.login()).cookie,b=(await s.login()).cookie;
  const sub=n=>({endpoint:`https://push.example.test/device-${n}`,keys:{p256dh:'k'+n,auth:'a'+n}});
  for(const [c,n] of [[a,1],[b,2],[b,3]])assert.equal((await s.fetch('/api/push/subscribe',{method:'POST',headers:{cookie:c},body:{subscription:sub(n)}})).status,200);
  assert.equal(s.subs().length,3);
  // Signed out, the endpoint is ignored: only a signed-in browser can remove a subscription.
  assert.equal((await s.fetch('/api/logout',{method:'POST',body:{endpoint:sub(3).endpoint}})).status,200);
  assert.equal(s.subs().length,3,'a caller with no valid cookie removes nothing');
  const out=await s.fetch('/api/logout',{method:'POST',headers:{cookie:a},body:{endpoint:sub(1).endpoint}});
  assert.equal(out.status,200);assert.match(out.headers.get('set-cookie')||'',/^pc_auth=;.*Max-Age=0/);
  assert.deepEqual(s.subs().map(x=>x.endpoint),[sub(2).endpoint,sub(3).endpoint],'Sign out removed only this browser\'s subscription');
  const all=await s.fetch('/api/logout/everywhere',{method:'POST',headers:{cookie:b},body:{}});
  assert.equal(all.status,200);assert.equal((await all.json()).pushRemoved,2);
  assert.deepEqual(s.subs(),[],'Sign out everywhere removed every subscription');
  const c=(await s.login()).cookie;
  assert.equal((await (await s.fetch('/api/push/prefs?endpoint='+encodeURIComponent(sub(2).endpoint),{headers:{cookie:c}})).json()).code,'not_subscribed','a device that stays learns its subscription is gone');
  const page=await fetch(s.url('/app.js')).then(r=>r.text());
  assert.match(page,/endpoint: sub\.endpoint/,'the page sends its endpoint with Sign out');
  assert.match(page,/sub\?\.unsubscribe\(\)/,'and unsubscribes the browser');
  assert.match(page,/e\.code === 'not_subscribed'/,'and drops a subscription the server no longer has');
});

test('D-6: the known-device cookie: attributes, and it signs nothing in by itself',async t=>{
  const s=await server(t,22721);
  const plain=await s.login();
  assert.ok(plain.device,'a sign-in sets pc_device: '+plain.raw.join(' | '));
  const attrs=plain.raw.find(c=>c.startsWith('pc_device='));
  assert.match(attrs,/; HttpOnly;/);assert.match(attrs,/SameSite=Lax/);assert.match(attrs,/Path=\/api\/login/);assert.match(attrs,/Max-Age=31536000/);
  assert.doesNotMatch(attrs,/Secure/,'not Secure on a plain HTTP request');
  assert.match((await s.login('test-only',{'x-forwarded-proto':'https'})).raw.find(c=>c.startsWith('pc_device=')),/; Secure;/,'Secure over HTTPS');
  assert.equal((await s.login('wrong')).device,'','a wrong password sets none');
  const value=plain.device.slice('pc_device='.length);
  for(const cookie of [plain.device,'pc_auth='+value,`pc_auth=${value.slice(2)}`]){
    assert.equal(await s.me(cookie),false,'no sign-in with '+cookie.slice(0,24));
    assert.equal((await s.fetch('/api/sessions',{headers:{cookie}})).status,401);
    assert.deepEqual(await (await s.fetch('/api/health',{headers:{cookie,'x-forwarded-for':'203.0.113.7'}})).json(),{ok:true});
    assert.equal((await s.fetch('/api/logout/everywhere',{method:'POST',headers:{cookie},body:{}})).status,401);
  }
  // Malformed cookies are no cookie, not an error.
  for(const cookie of ['pc_auth=%E0%A4%A','pc_device=%','pc_auth=1.2.3','pc_device=d.1.'+'0'.repeat(64)]){
    const r=await s.fetch('/api/me',{headers:{cookie}});assert.equal(r.status,200,cookie);assert.equal((await r.json()).ok,false);
  }
  assert.equal((await s.login('test-only',{cookie:'pc_device=%E0%A4%A'})).status,200,'a malformed device cookie does not get in the way of the password');
});

test('D-6: during a flood of wrong passwords from many addresses, the owner\'s right password with the device cookie is accepted every time',async t=>{
  const s=await server(t,22761,{POCKET_TRUSTED_PROXY:'1',POCKET_LOGIN_BACKOFF_MS:'10'}); // gap cap 100 ms, longest wait 200 ms
  const owner={'cf-connecting-ip':'192.0.2.50'};
  const first=await s.login('test-only',owner),device=first.device,signedIn=first.cookie;
  assert.ok(device);
  const st=JSON.parse(fs.readFileSync(s.state,'utf8'));
  const craft=(exp,pwMark=st.password,gen=st.generation)=>`pc_device=d.${exp}.`+createHmac('sha256',s.secret).update(`pocket-known-device\0${exp}\0${gen}\0${pwMark}`).digest('hex');
  let n=0,stop=false;const statuses={};
  const wrong=()=>{n++;return s.login('wrong',{'cf-connecting-ip':`2001:db8:${(n>>16).toString(16)}:${(n&0xffff).toString(16)}::1`}).then(r=>{statuses[r.status]=(statuses[r.status]||0)+1;},()=>{statuses.err=(statuses.err||0)+1;});};
  for(let i=0;i<30;i++)await wrong();
  const pending=new Set();
  const flood=(async()=>{while(!stop){const p=wrong();pending.add(p);p.finally(()=>pending.delete(p));await sleep(4);}})();
  const end=async()=>{stop=true;await flood;await Promise.all(pending);};
  try {
  await sleep(4000); // the gap climbs to its cap and the queue stays full
  assert.ok(statuses[429]>0,'the flood is being turned away: '+JSON.stringify(statuses));
  const tries=async(cookie,k=12)=>{const out=[];for(let i=0;i<k;i++){out.push((await s.login('test-only',{...owner,...(cookie?{cookie}:{})})).status);await sleep(20);}return out;};
  const withDevice=await tries(device,20);
  assert.deepEqual(withDevice,Array(20).fill(200),'with the device cookie: accepted every time');
  const without=await tries(null);
  assert.ok(without.includes(429),'without it the old behaviour stays (turned away while the queue is full): '+without.join(','));
  assert.ok(without.includes(429)&&(await tries(craft(Date.now()+3600_000))).every(x=>x===200),'a cookie made with the right key, generation and password works (so the forgeries below are tested for the right reason)');
  const forged=`pc_device=d.${Date.now()+3600_000}.${'ab'.repeat(32)}`;
  for(const [name,cookie] of Object.entries({forged,expired:craft(Date.now()-1000),otherPassword:craft(Date.now()+3600_000,mark(s.secret,'not-the-password')),otherGeneration:craft(Date.now()+3600_000,st.password,'0'.repeat(32)),asAuthCookie:device.replace('pc_device=','pc_auth=')}))
    assert.ok((await tries(cookie)).includes(429),`a ${name} device cookie is ignored`);
  // A device cookie that carries five wrong passwords stops skipping the queue.
  const stolen=(await s.login('test-only',{...owner,cookie:device})).device;
  for(let i=0;i<5;i++)assert.equal((await s.login('guess '+i,{'cf-connecting-ip':`198.51.100.${i+1}`,cookie:stolen})).status,403);
  assert.ok((await tries(stolen)).includes(429),'after five wrong passwords it waits in the queue like any other');
  assert.ok((await tries(device)).every(x=>x===200),'other devices are unaffected');
  // Sign out everywhere ends every device cookie.
  assert.equal((await s.fetch('/api/logout/everywhere',{method:'POST',headers:{cookie:signedIn},body:{}})).status,200);
  assert.ok((await tries(device)).includes(429),'a device cookie replayed after Sign out everywhere is ignored');
  } finally { await end(); }
});

test('D-6: the device cookie still counts against its address; a queued burst stops at the per-address limit',async t=>{
  const s=await server(t,22801,{POCKET_TRUSTED_PROXY:'1',POCKET_LOGIN_BACKOFF_MS:'50'});
  const x={'cf-connecting-ip':'203.0.113.77'};
  const {device}=await s.login('test-only',x);
  for(let i=0;i<15;i++)assert.equal((await s.login('wrong',x)).status,403);
  for(let i=0;i<15;i++)assert.equal((await s.login('wrong',{'cf-connecting-ip':`198.51.100.${i+1}`})).status,403);
  // The instance budget is used up: 25 at once from one address with 15 wrong already queue one gap apart.
  const burst=await Promise.all(Array.from({length:25},()=>s.login('wrong',x).then(r=>r.status)));
  assert.equal(burst.filter(c=>c===403).length,5,'only five more are checked: '+burst.join(','));
  assert.equal(burst.filter(c=>c===429).length,20);
  assert.equal((await s.login('test-only',{...x,cookie:device})).status,429,'the device cookie does not lift the per-address limit');
});

test('D-6: addressKey reads every form of an IPv4-mapped address, and ::1 counts on its own',async t=>{
  const s=await server(t,22841,{POCKET_TRUSTED_PROXY:'1',POCKET_LOGIN_BACKOFF_MS:'2'});
  const wrong=ip=>s.login('wrong',{'cf-connecting-ip':ip}).then(r=>r.status);
  const forms=['::ffff:c000:232','::FFFF:192.0.2.50','0:0:0:0:0:ffff:c000:232','::ffff:192.0.2.50'];
  for(let i=0;i<20;i++)assert.equal(await wrong(forms[i%4]),403);
  assert.equal(await wrong('192.0.2.50'),429,'the hex and full forms count with the dotted IPv4 address');
  for(let i=0;i<20;i++){const r=await s.login('wrong',{'cf-connecting-ip':'::'+(i+2).toString(16)});assert.equal(r.status,403,`low address ${i}: ${r.code||''}`);}
  assert.equal(await wrong('::1'),403,'::1 is not in the all-zero /64 the other low addresses share');
  assert.equal(await wrong('::2'),429);
  for(const junk of ['1::2::3','::ffff:999.1.1.1','zz:zz','','x'.repeat(400)])assert.ok([403,429].includes(await wrong(junk)),'a malformed address is answered: '+junk.slice(0,20));
});

test('D-7: Forwarded and X-Real-IP count as "came through a proxy"',async t=>{
  const s=await server(t,22881);
  const health=async h=>(await s.fetch('/api/health',{headers:h})).json();
  for(const h of [{forwarded:'for=203.0.113.7;proto=https'},{'x-real-ip':'203.0.113.7'}])
    assert.deepEqual(await health(h),{ok:true},'signed out through a proxy: '+JSON.stringify(h));
  assert.equal(typeof (await health({})).uptime,'number','a direct request on the box still gets the counts');
  const token=fs.readFileSync(path.join(s.dir,'data','cli-token'),'utf8').trim();
  assert.equal((await s.fetch('/api/notify',{method:'POST',headers:{authorization:'Bearer '+token,'x-real-ip':'203.0.113.7'},body:{title:'t'}})).status,401,'the CLI token is refused through a proxy');
  assert.equal((await s.fetch('/api/notify',{method:'POST',headers:{authorization:'Bearer '+token},body:{title:'t'}})).status,200,'and accepted on the box');
});
