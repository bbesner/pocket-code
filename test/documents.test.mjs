// 1.30 documents: the store's rules, the routes (private raw, public files, share links, keep from results, import),
// the agent instruction following the setting, and the CLI. Fake CLI only; scratch folders.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {DocumentStore,safeName,titleFor,kindOf,LIMITS} from '../documents.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pocket-documents-'));
const S1='11111111-1111-4111-8111-111111111111';

test('documents: names, kinds and titles',()=>{
  assert.equal(safeName('/x/y/Stock report (Oct).html'),'Stock_report_Oct_.html');assert.equal(safeName('../../etc/passwd'),null);assert.equal(safeName('.hidden.html'),'hidden.html');assert.equal(safeName('notes.exe'),null);
  assert.equal(kindOf('a.PDF'),'pdf');assert.equal(kindOf('a.csv'),'table');assert.equal(kindOf('a.xlsx'),'office');assert.equal(kindOf('a.sh'),null);
  assert.equal(titleFor('r.html','<html><head><title> Inventory &amp; stock \n review </title>'),'Inventory & stock review');
  assert.equal(titleFor('r.md','intro\n\n## The *plan*\n'),'The plan');assert.equal(titleFor('stock_report-2026.pdf',''),'stock report 2026');
});

test('DocumentStore: adopt, add, share, revoke, trash, restore, purge and import',()=>{
  const dir=tmp(),docsDir=path.join(dir,'documents');let clock=Date.parse('2026-10-09T12:00:00Z');
  fs.mkdirSync(docsDir,{recursive:true});fs.writeFileSync(path.join(docsDir,'dropped.html'),'<title>Dropped report</title><script>alert(1)</script>');fs.writeFileSync(path.join(docsDir,'.secret.html'),'x');fs.writeFileSync(path.join(docsDir,'notes.exe'),'x');
  const s=new DocumentStore(docsDir,path.join(dir,'documents.json'),{now:()=>clock});
  const list=s.list();assert.deepEqual(list.map(d=>[d.file,d.title,d.visibility,d.addedBy,d.inline]),[['dropped.html','Dropped report','private','folder',true]],'files in the folder are adopted private; dot-files and unknown kinds are not');
  const src=path.join(dir,'Weekly summary.md');fs.writeFileSync(src,'# Weekly summary\n\ntext');
  const a=s.addFromPath(src,{project:'warehouse-stock-report',session:S1,addedBy:'cli'});
  assert.equal(a.file,'Weekly_summary.md');assert.equal(a.title,'Weekly summary');assert.equal(a.project,'warehouse-stock-report');assert.equal(a.session,S1);assert.equal(a.url,null);assert.equal(a.share,null);
  assert.ok(fs.existsSync(path.join(docsDir,'Weekly_summary.md')));assert.equal((fs.statSync(path.join(docsDir,'Weekly_summary.md')).mode&0o777),0o600);
  const b=s.addFromPath(src,{addedBy:'cli'});assert.equal(b.file,'Weekly_summary-2.md','a name clash gets a suffix');
  assert.throws(()=>s.addFromPath(path.join(dir,'nope.md')),/ENOENT/);assert.throws(()=>s.addFromBuffer('run.sh',Buffer.from('x')),/not kept/);assert.throws(()=>s.addFromBuffer('a.txt',Buffer.alloc(0)),/empty/);
  const up=s.addFromBuffer('photo.PNG',Buffer.from([1,2,3]),{addedBy:'ui'});assert.equal(up.kind,'image');assert.equal(up.size,3);
  const shared=s.update(a.id,{visibility:'link'});assert.match(shared.token,/^[A-Za-z0-9_-]{40,}$/);assert.equal(shared.share.url,'/share/'+shared.token);assert.equal(s.resolveShare(shared.token).id,a.id);
  assert.equal(s.resolveShare('short'),null);assert.equal(s.resolveShare(shared.token+'x'),null);
  const again=s.update(a.id,{action:'reshare'});assert.notEqual(again.token,shared.token);assert.equal(s.resolveShare(shared.token),null,'reshare revokes the old link');assert.equal(s.resolveShare(again.token).id,a.id);
  s.update(a.id,{expiresAt:'2026-10-10T12:00:00Z'});assert.equal(s.resolveShare(again.token).id,a.id);clock=Date.parse('2026-10-10T12:00:01Z');assert.equal(s.resolveShare(again.token),null,'expired');clock=Date.parse('2026-10-09T13:00:00Z');
  const pub=s.update(a.id,{visibility:'public'});assert.equal(pub.share,null);assert.equal(pub.url,'/files/Weekly_summary.md');assert.equal(s.resolveShare(again.token),null,'leaving link revokes it');assert.equal(s.resolvePublic('Weekly_summary.md').id,a.id);assert.equal(s.resolvePublic('Weekly_summary-2.md'),null);
  assert.throws(()=>s.update(a.id,{visibility:'staff'}),/private, link or public/);assert.throws(()=>s.update(a.id,{title:' '}),/title/);assert.throws(()=>s.update('nope',{title:'x'}),e=>e.status===404);
  assert.equal(s.update(a.id,{title:'Week 41',project:''}).project,null);
  const t=s.trash(a.id);assert.ok(t.trashedAt);assert.equal(t.visibility,'private');assert.equal(s.resolvePublic('Weekly_summary.md'),null,'trashed documents are reachable by nobody');
  assert.ok(fs.existsSync(path.join(docsDir,'.trash',a.id+'-Weekly_summary.md')));assert.equal(s.list().some(d=>d.id===a.id),false);assert.equal(s.list({trashed:true})[0].id,a.id);
  assert.throws(()=>s.update(a.id,{title:'x'}),e=>e.status===409);
  assert.equal(s.purge(Date.parse('2026-10-20T00:00:00Z')).length,0,'inside the 30 days');
  const r=s.restore(a.id);assert.equal(r.trashedAt,null);assert.equal(r.file,'Weekly_summary.md');assert.ok(fs.existsSync(path.join(docsDir,'Weekly_summary.md')));
  s.trash(b.id);assert.deepEqual(s.purge(Date.parse('2026-11-10T00:00:00Z')),[b.id]);assert.equal(fs.existsSync(path.join(docsDir,'.trash',b.id+'-Weekly_summary-2.md')),false);
  const reloaded=new DocumentStore(docsDir,path.join(dir,'documents.json'),{now:()=>clock});assert.equal(reloaded.documents.length,3);assert.equal(reloaded.get(a.id).title,'Week 41');
  // import of Mission Control's metadata: public stays public, staff becomes a link, private stays private; unknown names are reported
  fs.writeFileSync(path.join(docsDir,'pub.html'),'<title>Public one</title>');fs.writeFileSync(path.join(docsDir,'staff.pdf'),'%PDF');fs.writeFileSync(path.join(docsDir,'priv.png'),'x');fs.writeFileSync(path.join(docsDir,'extra.md'),'# Extra');
  const imp=reloaded.importMeta({'pub.html':{visibility:'public',updated:'2026-09-01T00:00:00Z'},'staff.pdf':{visibility:'private',access:'techpro'},'priv.png':{visibility:'private'},'gone.html':{visibility:'public'},'dropped.html':{visibility:'public'}});
  assert.deepEqual(imp.counts,{public:1,link:1,private:1,skipped:1});assert.deepEqual(imp.missing,['gone.html']);assert.equal(imp.links.length,1);assert.equal(imp.links[0].file,'staff.pdf');assert.equal(imp.adopted,1,'extra.md adopted from the folder');
  assert.equal(reloaded.resolvePublic('pub.html').title,'Public one');assert.equal(reloaded.resolvePublic('pub.html').added,'2026-09-01T00:00:00Z');
  assert.equal(reloaded.get('x'===1?'':reloaded.documents.find(d=>d.file==='dropped.html').id).visibility,'private','already-known files are left alone');
  assert.throws(()=>reloaded.importMeta([]),/metadata/);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('HTTP: documents are off until Settings turns them on; raw is sandboxed; public and share paths serve only what they should; keep, import, the agent line and the CLI',async t=>{
  const dir=tmp();let port=19011;
  const secret=randomUUID(),exp=Date.now()+3600000;
  const cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
  const docsDir=path.join(dir,'docs');fs.mkdirSync(docsDir,{recursive:true});fs.mkdirSync(path.join(dir,'sessions','test-workspace'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  fs.writeFileSync(path.join(docsDir,'dashboard.html'),'<!doctype html><title>Ops dashboard</title><script>document.title="ran"</script><p>hi</p>');
  let child,logs='';
  const start=async()=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_DOCUMENTS_DIR:docsDir,POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs')},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
   if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=41;logs='';return start();}
   throw Error('Test server failed: '+logs);
  };
  const stop=async()=>{if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}};
  t.after(async()=>{await stop();try{for(const line of fs.readFileSync(path.join(dir,'calls'),'utf8').trim().split('\n')){const pid=JSON.parse(line).pid;if(pid)try{process.kill(pid,'SIGKILL');}catch{}}}catch{}await sleep(50);fs.rmSync(dir,{recursive:true,force:true,maxRetries:30,retryDelay:100});});
  const base=()=>`http://127.0.0.1:${port}`;
  const call=async(p,body,h=headers,method)=>{const r=await fetch(base()+p,{method:method||(body?'POST':'GET'),headers:h,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({})),headers:r.headers};};
  const raw=async(p,h={})=>{const r=await fetch(base()+p,{headers:h});return {status:r.status,text:await r.text(),headers:r.headers};};
  await start();
  const token=fs.readFileSync(path.join(dir,'data','cli-token'),'utf8').trim(),bearer={'content-type':'application/json',authorization:'Bearer '+token};
  const calls=()=>fs.existsSync(path.join(dir,'calls'))?fs.readFileSync(path.join(dir,'calls'),'utf8').trim().split('\n').map(JSON.parse):[];
  assert.equal((await call('/api/documents')).body.code,'documents_off');assert.equal((await raw('/files/dashboard.html')).status,404,'nothing public while off');
  assert.equal((await call('/api/new',{cwd:repo,text:'Before',provider:'claude',clientMessageId:randomUUID()})).status,202);for(let i=0;i<50&&calls().length<1;i++)await sleep(50);
  assert.equal(calls().at(-1).documents,false);
  assert.equal((await call('/api/settings',{documents:true})).body.documents,true);assert.deepEqual((await call('/api/me')).body.features,{projects:false,documents:true});
  assert.equal((await call('/api/new',{cwd:repo,text:'After',provider:'claude',clientMessageId:randomUUID()})).status,202);for(let i=0;i<50&&calls().length<2;i++)await sleep(50);
  assert.equal(calls().at(-1).documents,true,'agents are told how to keep documents once the feature is on');
  let lib=await call('/api/documents');assert.equal(lib.status,200);assert.deepEqual(lib.body.documents.map(d=>[d.file,d.title,d.addedBy]),[['dashboard.html','Ops dashboard','folder']],'the folder was adopted');
  const dash=lib.body.documents[0];
  // Private raw: login required, inline, sandboxed, never cached.
  assert.equal((await raw('/api/documents/'+dash.id+'/raw')).status,401);
  const r1=await raw('/api/documents/'+dash.id+'/raw',{cookie:'pc_auth='+cookie});
  assert.equal(r1.status,200);assert.match(r1.headers.get('content-type'),/^text\/html/);assert.match(r1.headers.get('content-security-policy'),/^sandbox allow-scripts allow-popups allow-downloads allow-forms; frame-ancestors 'self'$/);
  assert.equal(r1.headers.get('cache-control'),'private, no-store');assert.equal(r1.headers.get('x-content-type-options'),'nosniff');assert.match(r1.headers.get('content-disposition'),/^inline; filename\*=UTF-8''dashboard\.html$/);assert.match(r1.text,/Ops dashboard/);
  const r1d=await raw('/api/documents/'+dash.id+'/raw?download=1',{cookie:'pc_auth='+cookie});assert.match(r1d.headers.get('content-disposition'),/^attachment/);
  // Upload from the UI.
  const up=await fetch(base()+'/api/documents',{method:'POST',headers:{cookie:'pc_auth='+cookie,'x-filename':'Count sheet.csv','x-project':'warehouse-stock-report','content-type':'application/octet-stream'},body:'a,b\n1,2\n'});
  const sheet=await up.json();assert.equal(up.status,200);assert.equal(sheet.file,'Count_sheet.csv');assert.equal(sheet.kind,'table');assert.equal(sheet.project,'warehouse-stock-report');assert.equal(sheet.addedBy,'ui');
  assert.equal((await fetch(base()+'/api/documents',{method:'POST',headers:{cookie:'pc_auth='+cookie,'x-filename':'virus.exe'},body:'x'})).status,400);
  // The CLI's add: a real file under the home directory, outside dot-directories; the token works here and nowhere else.
  const home=os.homedir(),srcDir=fs.mkdtempSync(path.join(home,'.pocket-doc-test-')),okDir=fs.mkdtempSync(path.join(home,'pocket-doc-test-'));
  t.after(()=>{fs.rmSync(srcDir,{recursive:true,force:true});fs.rmSync(okDir,{recursive:true,force:true});});
  fs.writeFileSync(path.join(srcDir,'hidden.md'),'# no');fs.writeFileSync(path.join(okDir,'report.md'),'# Quarterly report\n\nnumbers');
  assert.equal((await call('/api/documents/add',{path:path.join(srcDir,'hidden.md')},bearer)).status,403,'hidden directories are refused');
  assert.equal((await call('/api/documents/add',{path:'relative.md'},bearer)).status,400);assert.equal((await call('/api/documents/add',{path:path.join(okDir,'missing.md')},bearer)).status,404);
  const added=await call('/api/documents/add',{path:path.join(okDir,'report.md'),session:S1,visibility:'link'},bearer);
  assert.equal(added.status,200);assert.equal(added.body.addedBy,'cli');assert.equal(added.body.title,'Quarterly report');assert.match(added.body.token,/^[A-Za-z0-9_-]{40,}$/);assert.equal(added.body.session,S1);
  assert.equal((await call('/api/documents',null,{...bearer,'cf-connecting-ip':'203.0.113.5'})).status,401,'the token is refused through the tunnel');
  // Share and public paths: no login; the right file and nothing else; strict headers; revocation.
  const sh=await raw('/share/'+added.body.token);assert.equal(sh.status,200);assert.match(sh.text,/Quarterly report/);assert.match(sh.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(sh.headers.get('x-robots-tag'),'noindex, nofollow, noarchive, nosnippet');
  assert.equal((await raw('/share/'+added.body.token.slice(0,-1)+(added.body.token.endsWith('A')?'B':'A'))).status,404,'a token with one character changed is refused');assert.equal((await raw('/files/report.md')).status,404,'a link document is not public');
  assert.equal((await raw('/files/dashboard.html')).status,404,'private is private');
  const pub=await call('/api/documents/'+dash.id,{visibility:'public'});assert.equal(pub.body.url,'/files/dashboard.html');
  const pf=await raw('/files/dashboard.html');assert.equal(pf.status,200);assert.match(pf.headers.get('content-security-policy'),/^sandbox allow-scripts[^;]*; frame-ancestors 'none'$/);assert.match(pf.text,/<script>/,'the document is sent as itself');
  assert.equal((await raw('/files/../server.mjs')).status,404);assert.equal((await raw('/files/.trash')).status,404);
  const rev=await call('/api/documents/'+added.body.id,{visibility:'private'});assert.equal(rev.body.share,null);assert.equal((await raw('/share/'+added.body.token)).status,404,'revoked');
  // Keep as document from a session's Results: only a file the session referenced.
  const sid=(await call('/api/new',{cwd:okDir,text:'Write a report',provider:'claude',clientMessageId:randomUUID()})).body.id;
  await sleep(1500);
  fs.appendFileSync(path.join(dir,'sessions','test-workspace',sid+'.jsonl'),JSON.stringify({type:'assistant',message:{role:'assistant',content:[{type:'text',text:'Saved the report to `'+path.join(okDir,'report.md')+'` for review.'}]},timestamp:new Date().toISOString()})+'\n');
  assert.equal((await call('/api/documents/keep',{session:sid,path:path.join(okDir,'other.md')})).status,403);
  const kept=await call('/api/documents/keep',{session:sid,path:path.join(okDir,'report.md'),project:'warehouse-stock-report'});
  assert.equal(kept.status,200,JSON.stringify(kept.body));assert.equal(kept.body.addedBy,'session');assert.equal(kept.body.session,sid);assert.equal(kept.body.file,'report-2.md','a second copy of the same name gets a suffix');
  // Trash, restore and the listing.
  assert.ok((await call('/api/documents/'+sheet.id,{action:'trash'})).body.trashedAt);lib=await call('/api/documents');assert.equal(lib.body.trash.length,1);assert.equal(lib.body.documents.some(d=>d.id===sheet.id),false);
  assert.equal((await raw('/api/documents/'+sheet.id+'/raw',{cookie:'pc_auth='+cookie})).status,404);
  assert.equal((await call('/api/documents/'+sheet.id,{action:'restore'})).body.trashedAt,null);
  assert.equal((await call('/api/documents?project=warehouse-stock-report')).body.documents.length,2);assert.equal((await call('/api/documents?q=quarterly')).body.documents.length,2);
  // Import of Mission Control's metadata.
  fs.writeFileSync(path.join(docsDir,'old-public.html'),'<title>Old public</title>');fs.writeFileSync(path.join(docsDir,'old-staff.html'),'<title>Old staff</title>');
  const imp=await call('/api/documents/import',{'old-public.html':{visibility:'public'},'old-staff.html':{visibility:'private',access:'techpro'},'dashboard.html':{visibility:'private'},'nothere.pdf':{visibility:'public'}},bearer);
  assert.deepEqual(imp.body.counts,{public:1,link:1,private:0,skipped:1});assert.deepEqual(imp.body.missing,['nothere.pdf']);assert.equal((await raw('/files/old-public.html')).status,200);assert.equal((await raw(imp.body.links[0].url)).status,200);
  // The CLI.
  const cli=(args,cwd=okDir)=>new Promise(r=>execFile(process.execPath,[path.join(repo,'scripts/pocket-docs.mjs'),...args],{cwd,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_DATA_DIR:path.join(dir,'data'),POCKET_PUBLIC_URL:'https://pocket.example.test'}},(e,stdout,stderr)=>r({code:e?e.code:0,stdout,stderr})));
  let out=await cli(['list']);assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/Ops dashboard/);assert.match(out.stdout,/Quarterly report/);
  fs.writeFileSync(path.join(okDir,'memo.txt'),'memo');
  out=await cli(['add','memo.txt','--title','Memo to staff','--project','warehouse-stock-report']);assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/Kept as document:\n[0-9a-f]{12}  private txt    Memo to staff  \[warehouse-stock-report\]/);
  const memoId=/\n([0-9a-f]{12}) /.exec(out.stdout)[1];
  out=await cli(['share',memoId,'--expires','7d']);assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/^Share URL: https:\/\/pocket\.example\.test\/share\/[A-Za-z0-9_-]{40,}  \(expires /);
  const url=/\/share\/([A-Za-z0-9_-]+)/.exec(out.stdout)[1];assert.equal((await raw('/share/'+url)).status,200);
  out=await cli(['set',memoId,'--visibility','private']);assert.equal(out.code,0,out.stderr);assert.equal((await raw('/share/'+url)).status,404);
  out=await cli(['trash',memoId]);assert.match(out.stdout,/Moved to the trash/);out=await cli(['restore',memoId]);assert.match(out.stdout,/Restored: Memo to staff/);
  assert.equal((await call('/api/settings',{documents:false})).body.documents,false);
  out=await cli(['list']);assert.equal(out.code,3);assert.equal((await raw('/files/old-public.html')).status,404,'off again: nothing public');
});
