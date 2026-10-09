// 1.32 thumbnails: tool discovery from the environment, the cache key, one job per key, failure memory, and the
// route. Fake tools only: small scripts that write a picture where the real tool would.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {DocumentStore} from '../documents.mjs';
import {Thumbnailer,findTools,THUMB} from '../thumbnails.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pocket-thumbs-'));
// A 1x1 PNG and a 1x1 JPEG, enough for a content-type check.
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64');
const JPG=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==','base64');
// Fake tools: chrome writes a PNG to --screenshot=<path> and records its arguments; pdftoppm writes <prefix>.jpg; convert copies a JPEG to its last argument.
function fakeTools(dir,{chromeFails=false}={}){
  const w=(name,body)=>{const p=path.join(dir,name);fs.writeFileSync(p,'#!'+process.execPath+'\n'+body);fs.chmodSync(p,0o700);return p;};
  const png=JSON.stringify([...PNG]),jpg=JSON.stringify([...JPG]);
  return {
    chrome:w('chrome',`const fs=require('fs');fs.appendFileSync(${JSON.stringify(path.join(dir,'chrome.log'))},process.argv.slice(2).join(' ')+'\\n');${chromeFails?'process.exit(3);':''}const out=process.argv.find(a=>a.startsWith('--screenshot=')).slice(13);fs.writeFileSync(out,Buffer.from(${png}));`),
    pdftoppm:w('pdftoppm',`const fs=require('fs');fs.writeFileSync(process.argv[process.argv.length-1]+'.jpg',Buffer.from(${jpg}));`),
    convert:w('convert',`const fs=require('fs');fs.writeFileSync(process.argv[process.argv.length-1],Buffer.from(${jpg}));`),
  };
}
test('findTools: environment overrides win, an empty override turns a tool off, missing files are not tools',()=>{
  const dir=tmp();const t=fakeTools(dir);
  const found=findTools({POCKET_CHROME:t.chrome,POCKET_PDFTOPPM:'',POCKET_CONVERT:path.join(dir,'nope')});
  assert.equal(found.chrome,t.chrome);assert.equal(found.pdftoppm,null);assert.equal(found.convert,null);
  fs.rmSync(dir,{recursive:true,force:true});
});
test('Thumbnailer: capabilities follow the tools; one picture per file version; one job per key; failures are remembered; Chrome keeps its sandbox',async()=>{
  const dir=tmp();const docsDir=path.join(dir,'docs');fs.mkdirSync(docsDir);
  fs.writeFileSync(path.join(docsDir,'report.html'),'<title>Report</title><p>hi</p>');fs.writeFileSync(path.join(docsDir,'deck.pdf'),'%PDF-1.4');fs.writeFileSync(path.join(docsDir,'photo.jpg'),JPG);fs.writeFileSync(path.join(docsDir,'notes.md'),'# notes');
  const store=new DocumentStore(docsDir,path.join(dir,'documents.json'));store.scan();
  const by=f=>store.documents.find(d=>d.file===f);
  const tools=fakeTools(dir);
  const none=new Thumbnailer(store,{tools:{chrome:null,pdftoppm:null,convert:null}});
  assert.deepEqual(none.capabilities(),{html:false,pdf:false,image:false});assert.equal(await none.get(by('report.html')),null,'no tool, no picture');
  const t=new Thumbnailer(store,{tools,concurrency:1});
  assert.deepEqual(t.capabilities(),{html:true,pdf:true,image:true});
  assert.equal(await t.get(by('notes.md')),null,'Markdown has no picture');
  const [a,b]=await Promise.all([t.get(by('report.html')),t.get(by('report.html'))]);
  assert.equal(a.type,'image/png');assert.equal(a.path,b.path,'two requests share one job');
  assert.equal(fs.readFileSync(path.join(dir,'chrome.log'),'utf8').trim().split('\n').length,1,'Chrome ran once');
  const args=fs.readFileSync(path.join(dir,'chrome.log'),'utf8');
  assert.doesNotMatch(args,/--no-sandbox/,'Chrome keeps its sandbox');assert.match(args,/--headless=new/);assert.match(args,new RegExp(`--window-size=${THUMB.width*2},${THUMB.height*2}`));assert.match(args,/--force-device-scale-factor=0\.5/);assert.match(args,/file:\/\/.*report\.html$/m);
  assert.ok(a.path.startsWith(path.join(docsDir,'.thumbs')+path.sep));assert.equal(fs.statSync(a.path).mode&0o777,0o600);
  const again=await t.get(by('report.html'));assert.equal(again.path,a.path,'served from the cache');
  assert.equal(fs.readFileSync(path.join(dir,'chrome.log'),'utf8').trim().split('\n').length,1,'no second render');
  // An edited file gets a new picture and the old one goes.
  await sleep(20);fs.writeFileSync(path.join(docsDir,'report.html'),'<title>Report</title><p>hi there</p>');
  const edited=await t.get(by('report.html'));assert.notEqual(edited.path,a.path);assert.equal(fs.existsSync(a.path),false,'the old picture is removed');
  assert.equal((await t.get(by('deck.pdf'))).type,'image/jpeg');assert.equal((await t.get(by('photo.jpg'))).type,'image/jpeg');
  // Without convert, an image goes through Chrome and a wrapper page.
  fs.writeFileSync(path.join(docsDir,'photo2.jpg'),JPG);store.scan();
  const viaChrome=new Thumbnailer(store,{tools:{...tools,convert:null}});
  const pic=await viaChrome.get(by('photo2.jpg'));assert.equal(pic.type,'image/png');assert.match(fs.readFileSync(path.join(dir,'chrome.log'),'utf8'),/image\.html$/m);
  // A failure is remembered for a while, so a broken document does not run Chrome on every paint.
  fs.mkdirSync(path.join(dir,'f'));
  const broken=new Thumbnailer(store,{tools:fakeTools(path.join(dir,'f'),{chromeFails:true}),retryAfterMs:60000,log:()=>{}});
  fs.writeFileSync(path.join(docsDir,'bad.html'),'<p>bad</p>');store.scan();
  assert.equal(await broken.get(by('bad.html')),null);assert.equal(await broken.get(by('bad.html')),null);
  assert.equal(fs.readFileSync(path.join(dir,'f','chrome.log'),'utf8').trim().split('\n').length,1,'no retry inside the window');
  // Trashed documents have no picture.
  store.trash(by('deck.pdf').id);assert.equal(await t.get(by('deck.pdf')),null);
  fs.rmSync(dir,{recursive:true,force:true});
});
test('HTTP: /thumb needs the login, says which kinds it can picture, serves the picture with private caching, 404 for the rest',async t=>{
  const dir=tmp();let port=19311;
  const secret=randomUUID(),exp=Date.now()+3600000;const cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const docsDir=path.join(dir,'docs');fs.mkdirSync(docsDir);fs.mkdirSync(path.join(dir,'sessions'));fs.mkdirSync(path.join(dir,'data'));
  fs.writeFileSync(path.join(docsDir,'dashboard.html'),'<title>Dash</title><p>x</p>');fs.writeFileSync(path.join(docsDir,'notes.md'),'# n');
  fs.writeFileSync(path.join(dir,'data','pocket-settings.json'),JSON.stringify({documents:true}));
  const tools=fakeTools(dir);
  let child,logs='';
  const start=async()=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_DOCUMENTS_DIR:docsDir,POCKET_CHROME:tools.chrome,POCKET_PDFTOPPM:'',POCKET_CONVERT:'',POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs')},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
   if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=41;logs='';return start();}
   throw Error('Test server failed: '+logs);
  };
  t.after(async()=>{if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}await sleep(50);fs.rmSync(dir,{recursive:true,force:true,maxRetries:30,retryDelay:100});});
  await start();
  const base=`http://127.0.0.1:${port}`,auth={cookie:'pc_auth='+cookie};
  const list=await (await fetch(base+'/api/documents',{headers:auth})).json();
  assert.deepEqual(list.thumbs,{html:true,pdf:false,image:true},'capabilities: Chrome only');
  const dash=list.documents.find(d=>d.file==='dashboard.html'),md=list.documents.find(d=>d.file==='notes.md');
  assert.equal((await fetch(base+'/api/documents/'+dash.id+'/thumb')).status,401,'login required');
  const pic=await fetch(base+'/api/documents/'+dash.id+'/thumb',{headers:auth});
  assert.equal(pic.status,200);assert.equal(pic.headers.get('content-type'),'image/png');assert.equal(pic.headers.get('cache-control'),'private, max-age=86400');assert.equal(pic.headers.get('x-content-type-options'),'nosniff');
  assert.equal(Buffer.from(await pic.arrayBuffer()).length,PNG.length);
  assert.equal((await fetch(base+'/api/documents/'+md.id+'/thumb',{headers:auth})).status,404,'no picture for Markdown');
  assert.equal((await fetch(base+'/api/documents/000000000000/thumb',{headers:auth})).status,404);
  assert.ok(fs.existsSync(path.join(docsDir,'.thumbs')));
  const again=await (await fetch(base+'/api/documents',{headers:auth})).json();assert.equal(again.documents.length,2,'the .thumbs folder is not adopted as documents');
});
