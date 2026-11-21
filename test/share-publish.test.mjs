// 1.117 security review: PC-05 (share links are stored only as a hash; the address is handed out once) and PC-04 (an agent
// holding the CLI token cannot make a file more exposed without the owner's Allow). Scratch folders, fake CLI only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {DocumentStore} from '../documents.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pocket-share-publish-'));
const sha=t=>createHash('sha256').update(t).digest('hex');
const T1='legacyTokenOne_abcdefghijklmnopqrstuvwxyz0123456';
const T2='legacyTokenTwo_abcdefghijklmnopqrstuvwxyz0123456';

// A Pocket server on a scratch data dir with Files on; `seed` runs before start (a documents.json to migrate).
async function server(t,{seed}={}){
  const dir=tmp();let port=19431+Math.floor(Math.random()*400);
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
  fs.writeFileSync(path.join(docsDir,'staff.pdf'),'%PDF');
  const imp=s.importMeta({'staff.pdf':{visibility:'private',access:'techpro'}});const tok=imp.links[0].url.slice('/share/'.length);
  assert.equal(s.resolveShare(tok).file,'staff.pdf','the import hands the address out once');assert.equal(fs.readFileSync(meta,'utf8').includes(tok),false);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('PC-05 store: a pre-1.117 record loses its stored address on load, keeps its hash, and its link still opens; one with no hash gets it from the address',()=>{
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
