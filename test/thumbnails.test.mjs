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
// 1.73.7: renderers run in their own process group. Before, the time budget signalled only the renderer itself and the job
// waited for its pipes to close, so a helper process it started (Chrome has several) held the job until it chose to exit.
test('Thumbnailer: the time budget and the renderer\'s exit end everything the renderer started',async()=>{
  const dir=tmp();const docsDir=path.join(dir,'docs');fs.mkdirSync(docsDir);
  fs.writeFileSync(path.join(docsDir,'a.html'),'<p>a</p>');fs.writeFileSync(path.join(docsDir,'b.html'),'<p>b</p>');
  const store=new DocumentStore(docsDir,path.join(dir,'documents.json'));store.scan();const by=f=>store.documents.find(d=>d.file===f);
  const pidFile=path.join(dir,'helper.pid'),alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
  const gone=async pid=>{for(let i=0;i<40&&alive(pid);i++)await sleep(50);return !alive(pid);};
  // A Chrome that starts a helper holding its stderr, then either hangs or writes the picture and exits.
  const chrome=hang=>{const p=path.join(dir,hang?'chrome-hang':'chrome-leave');fs.writeFileSync(p,'#!'+process.execPath+`\nconst fs=require('fs'),{spawn}=require('child_process');const h=spawn('sleep',['6'],{stdio:['ignore','ignore','inherit']});fs.writeFileSync(${JSON.stringify(pidFile)},String(h.pid));`+(hang?'setInterval(()=>{},1000);':`fs.writeFileSync(process.argv.find(a=>a.startsWith('--screenshot=')).slice(13),Buffer.from(${JSON.stringify([...PNG])}));process.exit(0);`));fs.chmodSync(p,0o700);return p;};
  let t0=Date.now();
  const hung=new Thumbnailer(store,{tools:{chrome:chrome(true),pdftoppm:null,convert:null},timeoutMs:400,log:()=>{}});
  assert.equal(await hung.get(by('a.html')),null,'over budget: no picture');assert.ok(Date.now()-t0<3000,`a hung renderer was given up in ${Date.now()-t0} ms`);
  assert.ok(await gone(Number(fs.readFileSync(pidFile,'utf8'))),'its helper was ended too');
  t0=Date.now();
  const left=new Thumbnailer(store,{tools:{chrome:chrome(false),pdftoppm:null,convert:null},timeoutMs:5000});
  assert.equal((await left.get(by('b.html'))).type,'image/png');assert.ok(Date.now()-t0<3000,`the picture came in ${Date.now()-t0} ms`);
  assert.ok(await gone(Number(fs.readFileSync(pidFile,'utf8'))),'a helper left behind by a finished renderer is ended');
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
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),POCKET_SKILLS:'0',PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_DOCUMENTS_DIR:docsDir,POCKET_CHROME:tools.chrome,POCKET_PDFTOPPM:'',POCKET_CONVERT:'',POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs')},stdio:['ignore','pipe','pipe']});
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
// 1.118 (PC-03): Chrome rendered an HTML document as a file:// page with script and network on, so a document from outside
// (an email attachment, a downloaded page) could frame another local file into its picture or make requests from the server.
// Real Chrome and ImageMagick: each hostile document paints red and tries to show a green local file, or to reach a local
// HTTP server that answers green; the picture's centre must stay red and the server must hear nothing.
const realChrome=findTools().chrome;
const realConvert=(()=>{for(const d of String(process.env.PATH||'').split(path.delimiter)){const p=path.join(d,'convert');if(fs.existsSync(p))return p;}return null;})();
test('PC-03 REAL: a hostile HTML document cannot picture another local file, run script or reach the network',{skip:(!realChrome&&'Chrome is not installed')||(!realConvert&&'ImageMagick convert is not installed'),timeout:180_000},async()=>{
  const {execFileSync}=await import('node:child_process');const http=await import('node:http');
  const dir=tmp();const docsDir=path.join(dir,'docs'),secret=path.join(dir,'elsewhere');fs.mkdirSync(docsDir);fs.mkdirSync(secret);
  const GREEN='<!doctype html><style>html,body{margin:0;height:100%;background:#00ff00}</style><p>marker</p>';
  fs.writeFileSync(path.join(secret,'marker.html'),GREEN);fs.writeFileSync(path.join(secret,'marker.css'),'html,body{background:#00ff00 !important}');
  execFileSync(realConvert,['-size','64x64','xc:#00ff00',path.join(secret,'marker.png')]);
  const hits=[];const srv=http.createServer((req,res)=>{hits.push(req.url);res.setHeader('content-type',req.url.includes('css')?'text/css':'text/html');res.end(req.url.includes('css')?'html,body{background:#00ff00 !important}':GREEN);});
  await new Promise(r=>srv.listen(0,'127.0.0.1',r));const port=srv.address().port;
  const full='position:fixed;left:0;top:0;width:100%;height:100%;border:0';
  const red=body=>`<!doctype html><html><head>${body.head||''}</head><body style="margin:0;height:100vh;background:#ff0000">${body.body||''}</body></html>`;
  const f=n=>'file://'+path.join(secret,n),h=n=>`http://127.0.0.1:${port}/${n}`;
  const cases={
    'iframe-file':red({body:`<iframe src="${f('marker.html')}" style="${full}"></iframe>`}),
    'object-file':red({body:`<object data="${f('marker.html')}" style="${full}"></object>`}),
    'img-file':red({body:`<img src="${f('marker.png')}" style="${full}">`}),
    'css-file':red({head:`<link rel="stylesheet" href="${f('marker.css')}">`}),
    'refresh-file':red({head:`<meta http-equiv="refresh" content="0;url=${f('marker.html')}">`}),
    'script':red({body:`<script>document.body.style.background='#00ff00'</script>`}),
    'net-img':red({body:`<img src="${h('img')}" style="${full}"><img src="http://localhost:${port}/named">`}),
    'net-css':red({head:`<link rel="stylesheet" href="${h('css')}">`}),
    'net-frame':red({body:`<iframe src="${h('frame')}" style="${full}"></iframe>`}),
    'net-refresh':red({head:`<meta http-equiv="refresh" content="0;url=${h('refresh')}">`}),
  };
  for(const [name,html] of Object.entries(cases))fs.writeFileSync(path.join(docsDir,name+'.html'),html);
  // The control: an ordinary report with inline styles and a data: image is still pictured as it looks.
  fs.writeFileSync(path.join(docsDir,'control.html'),'<!doctype html><title>Report</title><style>body{margin:0;height:100vh;background:#0000ff}</style><img alt="" src="data:image/png;base64,'+PNG.toString('base64')+'"><p>Quarterly</p>');
  const store=new DocumentStore(docsDir,path.join(dir,'documents.json'));store.scan();const by=n=>store.documents.find(d=>d.file===n);
  const logs=[];const t=new Thumbnailer(store,{tools:{chrome:realChrome,pdftoppm:null,convert:null},timeoutMs:30000,log:m=>logs.push(m)});
  const centre=file=>execFileSync(realConvert,['png:'+file,'-format','%[fx:int(255*p{240,150}.r)],%[fx:int(255*p{240,150}.g)],%[fx:int(255*p{240,150}.b)]','info:'],{encoding:'utf8'}).split(',').map(Number);
  try{
    const control=await t.get(by('control.html'));assert.ok(control,'the control is pictured: '+logs.join('; '));
    const [cr,cg,cb]=centre(control.path);assert.ok(cb>200&&cr<60&&cg<60,'the control keeps its own colour: '+[cr,cg,cb]);
    const leaked=[];
    for(const name of Object.keys(cases)){
      const pic=await t.get(by(name+'.html'));assert.ok(pic,name+' is pictured: '+logs.join('; '));
      const [r,g,b]=centre(pic.path);if(g>200&&r<60&&b<60)leaked.push(`${name}=${r},${g},${b}`); // a blocked frame may show Chrome's grey placeholder; green is the leak
    }
    assert.deepEqual(leaked,[],'no hostile document shows the green local file or server page in its picture');
    assert.deepEqual(hits,[],'no request reached the local server');
    // The network switch holds on its own, without the page's policy: a bare page of ours asking by address and by name.
    const work=fs.mkdtempSync(path.join(dir,'work-')),bare=path.join(work,'bare.html');
    fs.writeFileSync(bare,`<img src="${h('direct')}"><img src="http://localhost:${port}/direct-named"><link rel="stylesheet" href="${h('direct-css')}">`);
    assert.ok(await t.withChrome(work,'file://'+bare),'the bare page is pictured');
    assert.deepEqual(hits,[],'Chrome itself reaches nothing, by address or by name');
  }finally{srv.close();fs.rmSync(dir,{recursive:true,force:true});}
});
