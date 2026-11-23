// 1.118 security review: PC-05 (share links are stored only as a hash; the address is handed out once) and PC-04 (an agent
// holding the CLI token cannot make a file more exposed without the owner's Allow). Scratch folders, fake CLI only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {DocumentStore} from '../documents.mjs';
import {freePort} from './free-port.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pocket-share-publish-'));
const sha=t=>createHash('sha256').update(t).digest('hex');
const T1='legacyTokenOne_abcdefghijklmnopqrstuvwxyz0123456';
const T2='legacyTokenTwo_abcdefghijklmnopqrstuvwxyz0123456';

// A Pocket server on a scratch data dir with Files on; `seed` runs before start (a documents.json to migrate).
async function server(t,{seed}={}){
  const dir=tmp();let port=await freePort();
  const secret=randomUUID(),exp=Date.now()+3600000;
  const cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const owner={'content-type':'application/json',cookie:'pc_auth='+cookie};
  const docsDir=path.join(dir,'docs'),data=path.join(dir,'data');for(const d of [docsDir,data,path.join(dir,'sessions')])fs.mkdirSync(d,{recursive:true});
  fs.writeFileSync(path.join(data,'pocket-settings.json'),JSON.stringify({documents:true}));
  if(seed)seed({dir,docsDir,data});
  let child,logs='';
  const start=async()=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),POCKET_SKILLS:'0',PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:data,POCKET_DOCUMENTS_DIR:docsDir,CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs')},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<150;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
   if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<5){port+=37;logs='';return start();}
   throw Error('Test server failed: '+logs);
  };
  await start();
  t.after(async()=>{if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}fs.rmSync(dir,{recursive:true,force:true,maxRetries:30,retryDelay:100});});
  const base=`http://127.0.0.1:${port}`;
  const bearer={'content-type':'application/json',authorization:'Bearer '+fs.readFileSync(path.join(data,'cli-token'),'utf8').trim()};
  const call=async(p,body,h=owner)=>{const r=await fetch(base+p,{method:body?'POST':'GET',headers:h,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};};
  const raw=async p=>{const r=await fetch(base+p);return {status:r.status,text:await r.text()};};
  const onDisk=()=>fs.readFileSync(path.join(data,'documents.json'),'utf8');
  return {dir,docsDir,data,base,owner,bearer,call,raw,onDisk,logs:()=>logs};
}

test('PC-05 store: a minted link is in the answer only; documents.json holds the hash, never the token',()=>{
  const dir=tmp(),docsDir=path.join(dir,'documents'),meta=path.join(dir,'documents.json');
  const s=new DocumentStore(docsDir,meta);
  const a=s.addFromBuffer('report.md',Buffer.from('# Report'));
  const made=s.update(a.id,{visibility:'link',expiresAt:'2030-01-01T00:00:00Z'});
  assert.match(made.token,/^[A-Za-z0-9_-]{40,}$/);assert.deepEqual(made.share,{expiresAt:'2030-01-01T00:00:00Z'},'the view says a link exists and when it ends, nothing more');
  assert.equal(fs.readFileSync(meta,'utf8').includes(made.token),false,'the token is not on disk');assert.equal(JSON.parse(fs.readFileSync(meta,'utf8')).documents[0].shareHash,sha(made.token));
  assert.equal(s.list()[0].share.url,undefined);assert.equal(JSON.stringify(s.list()).includes(made.token),false,'nor in the listing');
  const again=s.update(a.id,{action:'reshare'});assert.equal(fs.readFileSync(meta,'utf8').includes(again.token),false);assert.equal(s.resolveShare(again.token).id,a.id);
  const b=s.addFromBuffer('direct.md',Buffer.from('# Direct'),{visibility:'link'});assert.match(b.token,/^[A-Za-z0-9_-]{40,}$/);assert.equal(fs.readFileSync(meta,'utf8').includes(b.token),false,'a record made as a link stores no token either');
  // An import's links: test/documents.test.mjs (the store test) checks their tokens are not on disk either.
  fs.rmSync(dir,{recursive:true,force:true});
});

test('PC-05 store: a pre-1.118 record loses its stored address on load, keeps its hash, and its link still opens; one with no hash gets it from the address',()=>{
  const dir=tmp(),docsDir=path.join(dir,'documents'),meta=path.join(dir,'documents.json');fs.mkdirSync(docsDir,{recursive:true});
  fs.writeFileSync(path.join(docsDir,'a.md'),'# A');fs.writeFileSync(path.join(docsDir,'b.md'),'# B');fs.writeFileSync(path.join(docsDir,'c.md'),'# C');
  const rec=(id,file,extra)=>({id,file,title:file,kind:'md',size:3,added:'2026-10-01T00:00:00Z',addedBy:'cli',updated:'2026-10-01T00:00:00Z',session:null,project:null,visibility:'link',trashedAt:null,...extra});
  fs.writeFileSync(meta,JSON.stringify({version:1,documents:[
    rec('aaaaaaaaaaaa','a.md',{shareHash:sha(T1),share:{expiresAt:null,url:'/share/'+T1}}),
    rec('bbbbbbbbbbbb','b.md',{share:{expiresAt:'2030-01-01T00:00:00Z',url:'/share/'+T2}}),          // an address and no hash at all
    rec('cccccccccccc','c.md',{shareHash:null,share:{expiresAt:null,url:'not a share path'}}),         // nothing to recover
  ]}));
  const s=new DocumentStore(docsDir,meta);
  assert.equal(s.migrated,3);
  const disk=fs.readFileSync(meta,'utf8');assert.equal(disk.includes(T1),false);assert.equal(disk.includes(T2),false);assert.equal(disk.includes('"url"'),false,'every stored address is gone from the file');
  assert.equal(s.resolveShare(T1).id,'aaaaaaaaaaaa','the link handed out before the upgrade still opens');
  assert.equal(s.resolveShare(T2).id,'bbbbbbbbbbbb','a record with an address and no hash: the hash comes from the address');
  assert.equal(s.get('bbbbbbbbbbbb').shareHash,sha(T2));assert.equal(s.get('bbbbbbbbbbbb').share.expiresAt,'2030-01-01T00:00:00Z','the expiry stays');
  assert.equal(s.get('cccccccccccc').shareHash,null,'an address that is not a share path recovers nothing and opens nothing');
  const again=new DocumentStore(docsDir,meta);assert.equal(again.migrated,0,'once written back, nothing is left to migrate');assert.equal(again.resolveShare(T2).id,'bbbbbbbbbbbb');
  fs.rmSync(dir,{recursive:true,force:true});
});

test('PC-05 HTTP: an upgraded install drops stored addresses at start and old links keep opening; the owner gets a new link once',async t=>{
  const rec=(id,file,extra)=>({id,file,title:file,kind:'md',size:3,added:'2026-10-01T00:00:00Z',addedBy:'cli',updated:'2026-10-01T00:00:00Z',session:null,project:null,visibility:'link',trashedAt:null,...extra});
  const s=await server(t,{seed:({docsDir,data})=>{
    fs.writeFileSync(path.join(docsDir,'a.md'),'# Alpha');fs.writeFileSync(path.join(docsDir,'b.md'),'# Bravo');
    fs.writeFileSync(path.join(data,'documents.json'),JSON.stringify({version:1,documents:[rec('aaaaaaaaaaaa','a.md',{shareHash:sha(T1),share:{expiresAt:null,url:'/share/'+T1}}),rec('bbbbbbbbbbbb','b.md',{share:{expiresAt:null,url:'/share/'+T2}})]}));
  }});
  assert.equal(s.onDisk().includes(T1)||s.onDisk().includes(T2),false,'the tokens left the disk at start');
  assert.match(s.logs(),/removed 2 stored share address\(es\) from documents\.json/);
  assert.match((await s.raw('/share/'+T1)).text,/Alpha/);assert.match((await s.raw('/share/'+T2)).text,/Bravo/,'both old links open');
  const lib=await s.call('/api/documents');assert.equal(JSON.stringify(lib.body).includes(T1),false);assert.deepEqual(lib.body.documents.find(d=>d.id==='aaaaaaaaaaaa').share,{expiresAt:null});
  const fresh=await s.call('/api/documents/aaaaaaaaaaaa',{action:'reshare'});assert.equal(fresh.status,200);assert.match(fresh.body.token,/^[A-Za-z0-9_-]{40,}$/,'the owner gets the new address in the answer');
  assert.equal(s.onDisk().includes(fresh.body.token),false,'and it is not written down');assert.equal((await s.raw('/share/'+T1)).status,404,'the old one stopped');assert.equal((await s.raw('/share/'+fresh.body.token)).status,200);
  assert.equal(JSON.stringify((await s.call('/api/documents')).body).includes(fresh.body.token),false,'the listing never repeats it');
});

// ---------- PC-04 ----------
const AGENT={actor:'terminal',session:null},OTHER={actor:'agent',session:'0b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d'};
test('PC-04 store: which changes expose a file more; Deny, timeout and a changed file change nothing; an approval is used once, by its raiser',async()=>{
  const dir=tmp(),docsDir=path.join(dir,'documents'),meta=path.join(dir,'documents.json');let clock=Date.parse('2030-01-01T00:00:00Z');
  const s=new DocumentStore(docsDir,meta,{now:()=>clock});
  const a=s.addFromBuffer('plan.md',Buffer.from('# Plan')),b=s.addFromBuffer('other.md',Buffer.from('# Other'));
  // What needs the owner.
  assert.deepEqual(s.exposureChange(a.id,{visibility:'link'}),{to:'link',expiresAt:null});
  assert.deepEqual(s.exposureChange(a.id,{visibility:'public'}),{to:'public',expiresAt:null});
  assert.equal(s.exposureChange(a.id,{visibility:'private'}),null);assert.equal(s.exposureChange(a.id,{title:'New'}),null);assert.equal(s.exposureChange(a.id,{expiresAt:'2031-01-01T00:00:00Z'}),null,'an expiry on a private file exposes nothing');
  assert.throws(()=>s.exposureChange(a.id,{visibility:'staff'}),/private, link or public/);
  const linked=s.update(a.id,{visibility:'link',expiresAt:'2030-02-01T00:00:00Z'}); // the owner's own change
  assert.deepEqual(s.exposureChange(a.id,{action:'reshare'}),{to:'link',reshare:true,expiresAt:'2030-02-01T00:00:00Z'},'a new link is more exposure');
  assert.deepEqual(s.exposureChange(a.id,{expiresAt:'2030-03-01T00:00:00Z'}),{to:'link',extend:true,expiresAt:'2030-03-01T00:00:00Z'},'a longer link is more exposure');
  assert.deepEqual(s.exposureChange(a.id,{expiresAt:null}),{to:'link',extend:true,expiresAt:null},'so is no expiry at all');
  assert.equal(s.exposureChange(a.id,{expiresAt:'2030-01-15T00:00:00Z'}),null,'a shorter one is not');
  assert.deepEqual(s.exposureChange(a.id,{visibility:'public'}),{to:'public',expiresAt:null},'link to public is more exposure');
  // Deny: nothing changes, and the raiser learns it.
  let row=await s.raiseRequest(a.id,{to:'public'},{caller:AGENT});
  assert.equal(row.size,6);assert.equal(row.sha256,sha('# Plan'));assert.equal(row.url,'/files/plan.md');assert.equal(s.pendingRequests().length,1);
  assert.equal(s.collectRequest(row.id,AGENT),null,'nothing to collect before the answer');
  await s.answerRequest(row.id,'deny');assert.equal(s.get(a.id).visibility,'link');assert.equal(s.resolvePublic('plan.md'),null);assert.equal(s.resolveShare(linked.token).id,a.id,'the existing link is untouched');
  assert.throws(()=>s.collectRequest(row.id,AGENT),e=>e.status===403&&e.code==='denied');
  await assert.rejects(s.answerRequest(row.id,'allow'),e=>e.status===409,'a denied request cannot be allowed later');
  // Timeout: unanswered after the request time, it ends as expired and changes nothing.
  row=await s.raiseRequest(b.id,{to:'link',expiresAt:null},{caller:AGENT});
  clock+=15*60*1000+1;assert.equal(s.pendingRequests().length,0);
  assert.throws(()=>s.collectRequest(row.id,AGENT),e=>e.status===403&&e.code==='expired');assert.equal(s.get(b.id).visibility,'private');
  await assert.rejects(s.answerRequest(row.id,'allow'),e=>e.status===409);assert.equal(s.get(b.id).shareHash,null);
  // The content changes between the request and the Allow: stale, nothing shared.
  row=await s.raiseRequest(b.id,{to:'public'},{caller:AGENT});
  fs.writeFileSync(path.join(docsDir,'other.md'),'# Other, but different');
  await assert.rejects(s.answerRequest(row.id,'allow'),e=>e.status===409&&e.code==='request_stale'&&/content changed/.test(e.message));
  assert.equal(s.get(b.id).visibility,'private');assert.throws(()=>s.collectRequest(row.id,AGENT),e=>e.code==='request_stale');
  // The sharing moves on before the Allow (the owner made it public): stale.
  row=await s.raiseRequest(b.id,{to:'link',expiresAt:null},{caller:AGENT});s.update(b.id,{visibility:'public'});
  await assert.rejects(s.answerRequest(row.id,'allow'),e=>e.code==='request_stale'&&/sharing changed/.test(e.message));assert.equal(s.get(b.id).visibility,'public');assert.equal(s.get(b.id).shareHash,null);
  s.update(b.id,{visibility:'private'});
  // The file swapped for a symlink to something outside the library: nothing to fingerprint, nothing raised.
  const outside=path.join(dir,'secret.md');fs.writeFileSync(outside,'# secret');fs.rmSync(path.join(docsDir,'other.md'));fs.symlinkSync(outside,path.join(docsDir,'other.md'));
  await assert.rejects(s.raiseRequest(b.id,{to:'public'},{caller:AGENT}),e=>e.status===409&&/not a regular file/.test(e.message));assert.equal(s.pendingRequests().length,0);
  // Allow: exactly the change; the address goes to the raiser once; never to another session; never twice.
  row=await s.raiseRequest(a.id,{to:'link',reshare:true,expiresAt:'2030-02-01T00:00:00Z'},{caller:AGENT});
  const two=await Promise.allSettled([s.answerRequest(row.id,'allow'),s.answerRequest(row.id,'allow')]);
  assert.deepEqual(two.map(x=>x.status).sort(),['fulfilled','rejected'],'two Allows at once: one is carried out');
  assert.equal(JSON.stringify(two.find(x=>x.status==='fulfilled').value).includes('token'),false,'the owner\'s answer does not carry the address either');
  assert.throws(()=>s.collectRequest(row.id,OTHER),e=>e.status===403&&e.code==='request_mismatch','another session cannot collect it');
  const got=s.collectRequest(row.id,AGENT);assert.match(got.token,/^[A-Za-z0-9_-]{40,}$/);assert.equal(s.resolveShare(got.token).id,a.id);assert.equal(s.resolveShare(linked.token),null,'the old link stopped');
  assert.equal(s.get(a.id).share.expiresAt,'2030-02-01T00:00:00Z');assert.equal(fs.readFileSync(meta,'utf8').includes(got.token),false);
  assert.throws(()=>s.collectRequest(row.id,AGENT),e=>e.status===409&&e.code==='request_used','an approval is used once');
  assert.equal(row.token,null,'nothing left behind in memory');
  fs.rmSync(dir,{recursive:true,force:true});
});

test('PC-04 HTTP: an agent asks, the owner answers; nothing is served before Allow; the CLI token cannot answer; an approval covers one document and one change',async t=>{
  const s=await server(t);
  const src=fs.mkdtempSync(path.join(os.homedir(),'pocket-share-publish-src-'));t.after(()=>fs.rmSync(src,{recursive:true,force:true}));
  fs.writeFileSync(path.join(src,'board-pack.md'),'# Board pack\n\nfigures');fs.writeFileSync(path.join(src,'notes.md'),'# Notes');fs.writeFileSync(path.join(src,'free.md'),'# Free');
  const answer=(id,decision,h={...s.owner,origin:s.base})=>s.call('/api/documents/requests/'+id+'/answer',{decision},h);
  // add --visibility public: kept private, a request, nothing at the public address.
  const asked=await s.call('/api/documents/add',{path:path.join(src,'board-pack.md'),visibility:'public'},s.bearer);
  assert.equal(asked.status,202);assert.equal(asked.body.pending,true);assert.match(asked.body.request,/^[0-9a-f]{16}$/);assert.equal(asked.body.document.visibility,'private');
  assert.match(asked.body.what,/^Make public at .*\/files\/board-pack\.md$/);
  assert.equal((await s.raw('/files/board-pack.md')).status,404,'nothing served before Allow');
  const docId=asked.body.document.id;
  // The owner's listing carries the card's facts; the agent's does not see the queue.
  const lib=await s.call('/api/documents');const q=lib.body.requests;assert.equal(q.length,1);
  assert.deepEqual([q[0].title,q[0].file,q[0].kind,q[0].size,q[0].path,q[0].change.to,q[0].fromVisibility],['Board pack','board-pack.md','md',21,path.join(src,'board-pack.md'),'public','private']);
  assert.equal('sha256' in q[0]||'caller' in q[0]||'token' in q[0],false);
  assert.equal((await s.call('/api/documents',null,s.bearer)).body.requests,undefined,'the agent does not see the queue');
  // The CLI token cannot answer, with or without an origin; another site cannot answer with the owner's cookie.
  assert.equal((await answer(asked.body.request,'allow',s.bearer)).status,401);
  assert.equal((await answer(asked.body.request,'allow',{...s.bearer,origin:s.base})).status,401);
  assert.equal((await answer(asked.body.request,'allow',{...s.owner,origin:'https://evil.example.com'})).status,403);
  assert.equal((await s.raw('/files/board-pack.md')).status,404);
  // Its own wait gets pending until the owner answers.
  let w=await s.call('/api/documents/requests/'+asked.body.request+'/wait',{wait:0},s.bearer);assert.equal(w.status,202);
  assert.equal((await answer(asked.body.request,'bogus')).status,400);
  assert.equal((await answer(asked.body.request,'allow')).status,200);
  assert.equal((await s.raw('/files/board-pack.md')).status,200,'Allow did the change');
  assert.equal((await answer(asked.body.request,'allow')).status,409,'answered once');assert.equal((await answer(asked.body.request,'deny')).status,409);
  w=await s.call('/api/documents/requests/'+asked.body.request+'/wait',{},s.bearer);assert.equal(w.status,200);assert.equal(w.body.visibility,'public');assert.equal(w.body.url,'/files/board-pack.md');
  assert.equal((await s.call('/api/documents/requests/'+asked.body.request+'/wait',{},s.bearer)).status,409,'collected once');
  // Making it less exposed needs nobody.
  assert.equal((await s.call('/api/documents/'+docId,{visibility:'private'},s.bearer)).status,200);assert.equal((await s.raw('/files/board-pack.md')).status,404);
  // PATCH to link: pending; Deny leaves it private; the raiser learns it was denied.
  let p=await s.call('/api/documents/'+docId,{visibility:'link',title:'Board pack (draft)'},s.bearer);assert.equal(p.status,202);
  assert.equal(p.body.document.title,'Board pack (draft)','the harmless part of the change is made now');assert.equal(p.body.document.visibility,'private');
  assert.equal((await answer(p.body.request,'deny')).status,200);
  w=await s.call('/api/documents/requests/'+p.body.request+'/wait',{},s.bearer);assert.equal(w.status,403);assert.equal(w.body.code,'denied');
  assert.equal((await s.call('/api/documents')).body.documents.find(d=>d.id===docId).visibility,'private');assert.match(s.onDisk(),/"shareHash": null/);
  // An approved link does not stretch to public: the PATCH raises a new request.
  p=await s.call('/api/documents/'+docId,{visibility:'link'},s.bearer);await answer(p.body.request,'allow');
  const link=(await s.call('/api/documents/requests/'+p.body.request+'/wait',{},s.bearer)).body;assert.match(link.token,/^[A-Za-z0-9_-]{40,}$/);assert.equal((await s.raw('/share/'+link.token)).status,200);
  assert.equal(s.onDisk().includes(link.token),false,'the token is not on disk');
  const up=await s.call('/api/documents/'+docId,{visibility:'public'},s.bearer);assert.equal(up.status,202);assert.notEqual(up.body.request,p.body.request);
  assert.equal((await s.raw('/files/board-pack.md')).status,404);
  assert.equal((await s.call('/api/documents/requests/'+p.body.request+'/wait',{},s.bearer)).status,409,'the used approval cannot be replayed');
  // A reshare and a longer expiry wait too; the old link keeps working meanwhile; a shorter expiry does not wait.
  await answer(up.body.request,'deny');
  const re=await s.call('/api/documents/'+docId,{action:'reshare'},s.bearer);assert.equal(re.status,202);assert.match(re.body.what,/^Replace its share link/);assert.equal((await s.raw('/share/'+link.token)).status,200);await answer(re.body.request,'deny');
  const soon=new Date(Date.now()+86400000).toISOString(),later=new Date(Date.now()+30*86400000).toISOString();
  assert.equal((await s.call('/api/documents/'+docId,{expiresAt:soon},s.bearer)).status,200,'a link with no expiry given one: shorter, no owner needed');
  const ext=await s.call('/api/documents/'+docId,{expiresAt:later},s.bearer);assert.equal(ext.status,202,'a longer one waits');assert.match(ext.body.what,/^Keep its share link open longer/);await answer(ext.body.request,'deny');
  assert.equal((await s.call('/api/documents')).body.documents.find(d=>d.id===docId).share.expiresAt,soon.replace(/\.\d{3}Z$/,'Z'));
  // The content changes between the request and the Allow: nothing shared.
  const nt=await s.call('/api/documents/add',{path:path.join(src,'notes.md'),visibility:'link'},s.bearer);
  fs.writeFileSync(path.join(s.docsDir,nt.body.document.file),'# Notes, swapped after asking');
  const st=await answer(nt.body.request,'allow');assert.equal(st.status,409);assert.equal(st.body.code,'request_stale');
  assert.equal((await s.call('/api/documents')).body.documents.find(d=>d.id===nt.body.document.id).visibility,'private');
  // An agent's import keeps everything private and says so.
  fs.writeFileSync(path.join(s.docsDir,'old-public.html'),'<title>Old</title>');
  const imp=await s.call('/api/documents/import',{'old-public.html':{visibility:'public'}},s.bearer);
  assert.deepEqual(imp.body.held.map(h=>[h.file,h.wanted]),[['old-public.html','public']]);assert.equal((await s.raw('/files/old-public.html')).status,404);assert.equal(imp.body.links.length,0);
  // The owner publishes directly, as before.
  const fr=await s.call('/api/documents/add',{path:path.join(src,'free.md'),visibility:'public'});assert.equal(fr.status,200);assert.equal((await s.raw('/files/free.md')).status,200);
  const own=await s.call('/api/documents/'+nt.body.document.id,{visibility:'link'});assert.equal(own.status,200);assert.match(own.body.token,/^[A-Za-z0-9_-]{40,}$/);
  // An unknown request.
  assert.equal((await answer('0123456789abcdef','allow')).status,404);assert.equal((await s.call('/api/documents/requests/0123456789abcdef/wait',{},s.bearer)).status,404);
});

test('PC-04 CLI: share and add --visibility print pending <id> and exit 6; wait continues; Deny exits 7; an agent\'s import says what it kept private',async t=>{
  const {execFile}=await import('node:child_process');
  const s=await server(t);
  const src=fs.mkdtempSync(path.join(os.homedir(),'pocket-share-publish-cli-'));t.after(()=>fs.rmSync(src,{recursive:true,force:true}));
  fs.writeFileSync(path.join(src,'summary.md'),'# Summary');
  const cli=args=>new Promise(r=>execFile(process.execPath,[path.join(repo,'scripts/pocket-docs.mjs'),...args],{cwd:src,env:{...cleanEnv(),POCKET_ENV_FILE:'',POCKET_URL:s.base,POCKET_DATA_DIR:s.data,POCKET_PUBLIC_URL:'https://pocket.example.com'}},(e,stdout,stderr)=>r({code:e?e.code:0,stdout,stderr})));
  const answer=(id,decision)=>s.call('/api/documents/requests/'+id+'/answer',{decision},{...s.owner,origin:s.base});
  let out=await cli(['add','summary.md','--visibility','public','--wait','0']);
  assert.equal(out.code,6,out.stderr);const id=/^pending ([0-9a-f]{16})$/m.exec(out.stderr)[1];
  assert.match(out.stderr,/Make public at \S*\/files\/summary\.md/);assert.match(out.stderr,/continue with: pocket-docs wait [0-9a-f]{16}/);
  assert.equal((await s.raw('/files/summary.md')).status,404);
  out=await cli(['wait',id,'--wait','0']);assert.equal(out.code,6,'still pending');
  await answer(id,'allow');
  out=await cli(['wait',id]);assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/^Allowed\. Published:\n[0-9a-f]{12}  public /);assert.match(out.stdout,/Public URL: https:\/\/pocket\.example\.com\/files\/summary\.md/);
  out=await cli(['wait',id]);assert.equal(out.code,7);assert.match(out.stderr,/already used/);
  const docId=(await s.call('/api/documents')).body.documents[0].id;
  assert.equal((await cli(['set',docId,'--visibility','private'])).code,0,'less exposure: no owner needed');
  out=await cli(['share',docId,'--wait','0']);assert.equal(out.code,6);const id2=/^pending ([0-9a-f]{16})$/m.exec(out.stderr)[1];assert.match(out.stderr,/Create a share link, no expiry/);
  await answer(id2,'deny');out=await cli(['wait',id2]);assert.equal(out.code,7);assert.match(out.stderr,/did not allow this\. The file was not shared/);
  out=await cli(['wait',id2,'--wait','301']);assert.equal(out.code,1);assert.match(out.stderr,/0 to 300/);
  fs.writeFileSync(path.join(s.docsDir,'legacy.html'),'<title>Legacy</title>');fs.writeFileSync(path.join(src,'meta.json'),JSON.stringify({'legacy.html':{visibility:'public'}}));
  out=await cli(['import','meta.json']);assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/Kept private \(an agent cannot share or publish on its own[^)]*\): legacy\.html \(public\)/);assert.equal((await s.raw('/files/legacy.html')).status,404);
});
