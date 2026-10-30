// Casey's 1.88.1 security report, items S-4, S-5 and S-6, checked against the real daemon with the fake CLIs.
// S-4: the artifact route checks a file's real path once, and the thumbnail queue reopens it by path later.
// S-5: thumbnails hand `file[0]` to ImageMagick with no decoder prefix, so the content picks the coder, not the extension.
// S-6: the login and Vault attempt limits are keyed on `cf-connecting-ip` whoever sends it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const CONVERT=(()=>{try{return execFileSync('sh',['-c','command -v convert'],{encoding:'utf8'}).trim()||null;}catch{return null;}})();

async function server(t,port,env={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-secB-'));let logs='',child;
  const secret=randomUUID(),exp=Date.now()+3600000;
  const headers={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  const envFile=path.join(dir,'.env');fs.writeFileSync(envFile,'# test install\n');
  const start=async()=>{
    logs='';child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),POCKET_SKILLS:'0',PORT:String(port),POCKET_ENV_FILE:envFile,POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',
      POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_DOCUMENTS_DIR:path.join(dir,'docs'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),...env},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
    for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)return;}catch{} await sleep(30);}
    if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=37;return start();}
    throw Error('Test server failed: '+logs);
  };
  const stop=async()=>{if(child&&child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}};
  t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  await start();
  const call=async(p,body,h=headers)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers:h,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null)};};
  const raw=(p,h=headers)=>fetch(`http://127.0.0.1:${port}/api${p}`,{headers:h});
  return {dir,call,raw,headers,secret,start,stop,logs:()=>logs};
}
const waitIdle=async(s,id)=>{for(let i=0;i<100;i++){const r=(await s.call('/sessions')).body.sessions.find(x=>x.id===id);if(r&&r.state?.kind!=='running')return r;await sleep(100);}};
// One conversation whose replies name each file by path, so the artifact route accepts them.
async function conversationNaming(s,files){
  let id=null;
  for(const f of files){
    const r=id?await s.call(`/session/${id}/message`,{text:'__FILE__ '+f,clientMessageId:randomUUID()}):await s.call('/new',{cwd:repo,text:'__FILE__ '+f,provider:'claude',clientMessageId:randomUUID()});
    assert.ok([200,202].includes(r.status),JSON.stringify(r.body));id=id||r.body.id;await waitIdle(s,id);
  }
  const named=(await s.call(`/session/${id}/results`)).body.results.map(r=>r.target);
  for(const f of files)assert.ok(named.includes(f),'the reply names '+f);
  return id;
}
const solid=(file,colour)=>execFileSync(CONVERT,['-size','40x40','xc:'+colour,file]);
// The centre pixel of a returned thumbnail, as [r,g,b].
const centre=buf=>{const out=execFileSync(CONVERT,['jpg:-','-format','%[fx:int(255*p{240,150}.r)],%[fx:int(255*p{240,150}.g)],%[fx:int(255*p{240,150}.b)]','info:'],{input:buf,encoding:'utf8'});return out.split(',').map(Number);};
const isGreen=([r,g,b])=>g>200&&r<60&&b<60;
// A convert that records its arguments, waits on the files named blocker-*, then runs the real ImageMagick.
function convertWrapper(dir){
  const p=path.join(dir,'convert-wrapper.sh');
  fs.writeFileSync(p,`#!/bin/sh\nprintf '%s\\n' "$*" >> '${path.join(dir,'convert-argv.log')}'\ncase "$1" in *blocker-*) sleep 3;; esac\nexec '${CONVERT}' "$@"\n`,{mode:0o755});
  return p;
}

test('S-4 REAL: a file swapped for a link after the artifact route\'s check is pictured through the link, while the thumbnail job waits in the queue',{skip:!CONVERT&&'ImageMagick convert is not installed'},async t=>{
  const tools=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-secB-tools-'));t.after(()=>fs.rmSync(tools,{recursive:true,force:true}));
  const s=await server(t,19581,{POCKET_CONVERT:convertWrapper(tools)});
  const work=fs.mkdtempSync(path.join(os.homedir(),'pocket-secB-s4-'));t.after(()=>fs.rmSync(work,{recursive:true,force:true}));
  fs.mkdirSync(path.join(work,'.private'));const secret=path.join(work,'.private','secret.png');solid(secret,'#00ff00');
  const [b1,b2,report,linked]=['blocker-1.png','blocker-2.png','report.png','linked.png'].map(n=>path.join(work,n));
  for(const f of [b1,b2,report])solid(f,'#ff0000');fs.symlinkSync(secret,linked);
  const id=await conversationNaming(s,[b1,b2,report,linked]);
  const thumb=f=>s.raw(`/session/${id}/artifact?path=${encodeURIComponent(f)}&thumb=1`);
  // The rule itself: a named file that is a link into a dot folder is refused at the check.
  assert.equal((await thumb(linked)).status,403,'a link into a dot folder is refused when it is already a link at the check');
  // Two slow jobs fill both slots (concurrency 2); report.png passes realpath, stat and the key stat, then waits in the queue.
  const slow=[thumb(b1),thumb(b2)];await sleep(500);
  const pending=thumb(report);await sleep(1200);
  // The swap: report.png becomes a link to the dot-folder picture before ImageMagick opens it by path (thumbnails.mjs:107).
  fs.unlinkSync(report);fs.symlinkSync(secret,report);
  const r=await pending;await Promise.all(slow);
  assert.notEqual(r.status,403,'the swap landed before the route\'s check; the window was not reached');
  if(r.status===200){
    const px=centre(Buffer.from(await r.arrayBuffer()));
    assert.equal(isGreen(px),false,`the thumbnail of report.png is the dot-folder file the route refuses (centre pixel ${px}); the check at server.mjs:2468-2470 did not hold for the open at thumbnails.mjs:107`);
  }
});

test('S-4 REAL: the inline and download sends reopen the checked path, so a racing swap serves a dot-folder file',async t=>{
  const s=await server(t,19601,{});
  const work=fs.mkdtempSync(path.join(os.homedir(),'pocket-secB-s4race-'));t.after(()=>fs.rmSync(work,{recursive:true,force:true}));
  fs.mkdirSync(path.join(work,'.private'));const secret=path.join(work,'.private','secret.txt');fs.writeFileSync(secret,'DOT-FOLDER SECRET\n');
  const report=path.join(work,'report.txt');fs.writeFileSync(report,'public report\n');fs.writeFileSync(path.join(work,'plain.tmp'),'public report\n');
  const id=await conversationNaming(s,[report]);
  // Another process flips report.txt between a regular file and a link into the dot folder, each by an atomic rename.
  const swapper=spawn(process.execPath,['-e',`const fs=require('fs'),w=${JSON.stringify(work)};for(;;){fs.copyFileSync(w+'/plain.tmp',w+'/p.tmp');fs.renameSync(w+'/p.tmp',w+'/report.txt');try{fs.unlinkSync(w+'/l.tmp')}catch{}fs.symlinkSync(w+'/.private/secret.txt',w+'/l.tmp');fs.renameSync(w+'/l.tmp',w+'/report.txt');}`],{stdio:'ignore'});
  t.after(()=>swapper.kill());
  const seen={};let leaked=null;
  for(let i=0;i<3000&&!leaked;i++){
    const mode=i%2?'&inline=1':'';const r=await s.raw(`/session/${id}/artifact?path=${encodeURIComponent(report)}${mode}`);const body=await r.text();
    const k=r.status+(body.includes('SECRET')?' secret':'');seen[k]=(seen[k]||0)+1;if(r.status===200&&body.includes('SECRET'))leaked={request:i+1,branch:mode?'inline':'download'};
  }
  swapper.kill();
  assert.equal(leaked,null,`a 200 carried the dot-folder file (${JSON.stringify(leaked)}; responses so far ${JSON.stringify(seen)}): realpath at server.mjs:2468 saw the file, sendFile/download at :2490/:2492 opened the link`);
});

test('S-5 REAL: a .png holding PostScript or SVG is decoded by its content, and an SVG pulls a dot-folder picture into the thumbnail',{skip:!CONVERT&&'ImageMagick convert is not installed'},async t=>{
  const tools=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-secB-tools-'));t.after(()=>fs.rmSync(tools,{recursive:true,force:true}));
  const s=await server(t,19621,{POCKET_CONVERT:convertWrapper(tools)});
  const work=fs.mkdtempSync(path.join(os.homedir(),'pocket-secB-s5-'));t.after(()=>fs.rmSync(work,{recursive:true,force:true}));
  fs.mkdirSync(path.join(work,'.private'));const secret=path.join(work,'.private','secret.png');solid(secret,'#00ff00');
  const [photo,ps,svg]=['photo.png','diagram.png','chart.png'].map(n=>path.join(work,n));
  solid(photo,'#ff0000');
  fs.writeFileSync(ps,'%!PS\n0 1 0 setrgbcolor 0 0 moveto 600 0 lineto 600 600 lineto 0 600 lineto closepath fill showpage\n');
  fs.writeFileSync(svg,`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="40" height="40"><image xlink:href="${secret}" width="40" height="40"/></svg>`);
  const id=await conversationNaming(s,[photo,ps,svg]);
  const thumb=f=>s.raw(`/session/${id}/artifact?path=${encodeURIComponent(f)}&thumb=1`);
  // A real PNG still gets its picture, so a 404 below is a refusal and not a broken renderer.
  const ok=await thumb(photo);assert.equal(ok.status,200);assert.equal(isGreen(centre(Buffer.from(await ok.arrayBuffer()))),false);
  const argv=()=>fs.readFileSync(path.join(tools,'convert-argv.log'),'utf8');
  const a=await thumb(ps),b=await thumb(svg),px=b.status===200?centre(Buffer.from(await b.arrayBuffer())):null;
  const ran=argv().split('\n').filter(l=>/diagram|chart/.test(l)).map(l=>l.split(' ')[0]).join(' and ');
  assert.deepEqual({postscript:a.status,svg:b.status},{postscript:404,svg:404},`both were pictured: convert was given ${ran} with no decoder prefix; chart.png's centre pixel ${px} is the dot-folder picture it links (green: ${px&&isGreen(px)})`);
});

test('S-5 REAL: the Files library pictures a .png that holds PostScript the same way',{skip:!CONVERT&&'ImageMagick convert is not installed'},async t=>{
  const s=await server(t,19661,{});
  await s.call('/settings',{documents:true});
  const docs=path.join(s.dir,'docs');fs.mkdirSync(docs,{recursive:true});
  fs.writeFileSync(path.join(docs,'diagram.png'),'%!PS\n0 1 0 setrgbcolor 0 0 moveto 600 0 lineto 600 600 lineto 0 600 lineto closepath fill showpage\n');
  const d=(await s.call('/documents')).body.documents.find(x=>x.file==='diagram.png');assert.ok(d,'the folder file is adopted');assert.equal(d.kind,'image');
  const r=await s.raw(`/documents/${d.id}/thumb`);
  assert.equal(r.status,404,`the library pictured PostScript named .png (${r.status} ${r.headers.get('content-type')})`);
});

test('S-6 REAL: 25 wrong logins from loopback, each with a new cf-connecting-ip, are never limited; without the header the 21st is',async t=>{
  const s=await server(t,19701,{});
  const login=h=>fetch(`http://127.0.0.1:${19701}/api/login`,{method:'POST',headers:{'content-type':'application/json',...h},body:JSON.stringify({password:'wrong'})}).then(r=>r.status);
  const varied=[];for(let i=0;i<25;i++)varied.push(await login({'cf-connecting-ip':`198.51.100.${i+1}`}));
  const plain=[];for(let i=0;i<21;i++)plain.push(await login({}));
  // The limiter works for a caller that sends no header (the control).
  assert.equal(plain.at(-1),429,'without the header the socket address is limited: '+plain.join(','));
  assert.ok(varied.slice(0,21).includes(429),'with a new cf-connecting-ip each try, 25 wrong logins from 127.0.0.1 got: '+varied.join(','));
});

test('S-6 REAL: wrong Vault passphrases from loopback, each with a new cf-connecting-ip, are never limited',async t=>{
  const s=await server(t,19741,{});
  assert.equal((await s.call('/settings',{vault:true})).status,200);
  const phrase='correct horse battery';
  assert.equal((await s.call('/vault/passphrase',{action:'set',passphrase:phrase,confirm:phrase})).status,200);
  assert.equal((await s.call('/vault/lock',{})).status,200);
  const varied=[];for(let i=0;i<13;i++)varied.push((await s.call('/vault/unlock',{passphrase:'wrong passphrase '+i},{...s.headers,'cf-connecting-ip':`198.51.100.${i+1}`})).status);
  assert.ok(varied.slice(0,11).includes(429),'ten wrong passphrases an hour per address; with a new header each try from 127.0.0.1: '+varied.join(','));
});

// 1.89 ruling: the per-session count can be dodged by whatever mints sessions without the login's limit (a replayed Access
// token), so the Vault also stops at fifty wrong tries an hour across the instance, unlock and restore-key together.
test('S-6 backstop: fifty wrong Vault tries an hour across all sessions, each under its own ten, then 429 for every session and for restore-key',async t=>{
  const s=await server(t,19861,{});
  assert.equal((await s.call('/settings',{vault:true})).status,200);
  const phrase='correct horse battery';
  assert.equal((await s.call('/vault/passphrase',{action:'set',passphrase:phrase,confirm:phrase})).status,200);
  assert.equal((await s.call('/vault/lock',{})).status,200);
  const session=i=>{const exp=Date.now()+3600000+i*1000;return {...s.headers,cookie:'pc_auth='+exp+'.'+createHmac('sha256',s.secret).update(String(exp)).digest('hex')};};
  const got=[];for(let i=0;i<6;i++){const h=session(i);for(let j=0;j<9;j++)got.push((await s.call('/vault/unlock',{passphrase:`wrong passphrase ${i}-${j}`},h)).status);}
  assert.deepEqual(got.slice(0,50),Array(50).fill(401),'six sessions, nine wrong tries each: the first fifty are answered');
  assert.deepEqual(got.slice(50),Array(4).fill(429),'the 51st wrong try overall and after it wait, though no session reached its own ten');
  assert.equal((await s.call('/vault/unlock',{passphrase:phrase},session(9))).status,429,'a new session waits too, even with the right passphrase');
  assert.equal((await s.call('/vault/restore-key',{key:'nonsense'},session(10))).status,429,'restore-key shares the count');
  assert.match(s.logs(),/vault: 50 wrong passphrases or keys within the hour across all sessions/);
});

// 1.89 review finding 1: checkCookie split on '.' and ignored anything after the second part, so `<cookie>.1` was signed in
// and hashed to a fresh per-session Vault count. A suffixed cookie is now not a session at all.
test('S-6: a session cookie with a trailing .1 is refused and does not get a fresh ten Vault tries',async t=>{
  const s=await server(t,19881,{});
  assert.equal((await s.call('/settings',{vault:true})).status,200);
  const phrase='correct horse battery';
  assert.equal((await s.call('/vault/passphrase',{action:'set',passphrase:phrase,confirm:phrase})).status,200);
  assert.equal((await s.call('/vault/lock',{})).status,200);
  const got=[];for(let i=0;i<11;i++)got.push((await s.call('/vault/unlock',{passphrase:'wrong passphrase '+i})).status);
  assert.deepEqual(got,[...Array(10).fill(401),429],'the session\'s own ten, then it waits');
  for(const suffix of ['.1','.2','.x']){
    const h={...s.headers,cookie:s.headers.cookie+suffix};
    const me=await s.call('/me',null,h);assert.equal(me.body.ok,false,'a suffixed cookie is not signed in ('+suffix+')');
    const r=await s.call('/vault/unlock',{passphrase:phrase},h);
    assert.equal(r.status,401,'the right passphrase under a suffixed cookie is refused, not given a fresh count ('+suffix+')');
    assert.equal(r.body.error,'unauthorized');
  }
  assert.equal((await s.call('/vault/unlock',{passphrase:phrase})).status,429,'the real session still waits');
});

// 1.89 review finding 2: the coder comes from the first bytes (png, jpeg, gif or webp), not the extension, so an ordinary
// JPEG saved under a .png name keeps its thumbnail while PostScript or SVG in a .png is still refused (the S-5 tests above).
test('S-5: a JPEG named .png gets a thumbnail, decoded as JPEG',{skip:!CONVERT&&'ImageMagick convert is not installed'},async t=>{
  const tools=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-secB-tools-'));t.after(()=>fs.rmSync(tools,{recursive:true,force:true}));
  const s=await server(t,19901,{POCKET_CONVERT:convertWrapper(tools)});
  const work=fs.mkdtempSync(path.join(os.homedir(),'pocket-secB-s5jpg-'));t.after(()=>fs.rmSync(work,{recursive:true,force:true}));
  const photo=path.join(work,'download.png');execFileSync(CONVERT,['-size','40x40','xc:#00ff00','jpeg:'+photo]);
  assert.deepEqual([...fs.readFileSync(photo).subarray(0,3)],[0xff,0xd8,0xff],'the file really is a JPEG');
  const id=await conversationNaming(s,[photo]);
  const r=await s.raw(`/session/${id}/artifact?path=${encodeURIComponent(photo)}&thumb=1`);
  assert.equal(r.status,200,'a JPEG under a .png name is pictured');
  assert.equal(isGreen(centre(Buffer.from(await r.arrayBuffer()))),true);
  assert.match(fs.readFileSync(path.join(tools,'convert-argv.log'),'utf8'),/^jpeg:\S*download\.png\[0\]/m,'convert is told the jpeg coder');
});

// 1.89 review finding 5: every login counted, so on a tunnel without Access (one shared 127.0.0.1) twenty requests of any
// kind closed the password page for an hour. Only wrong passwords count now, as the Vault's tries do.
test('S-6: correct logins do not use up the login limit; twenty wrong ones still close it',async t=>{
  const s=await server(t,19921,{});
  const login=password=>fetch(`http://127.0.0.1:${19921}/api/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password})}).then(r=>r.status);
  const right=[];for(let i=0;i<25;i++)right.push(await login('test-only'));
  assert.deepEqual(right,Array(25).fill(200),'twenty-five correct logins in a row');
  const wrong=[];for(let i=0;i<21;i++)wrong.push(await login('wrong '+i));
  assert.deepEqual(wrong,[...Array(20).fill(403),429],'twenty wrong passwords, then the limit');
  assert.equal(await login('test-only'),429,'once closed, the correct password waits out the hour too');
});
