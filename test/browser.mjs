// Deterministic frontend acceptance checks. This serves fixtures only: no real
// sessions, credentials, CLI, or production service is involved.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const repo=path.resolve(import.meta.dirname,'..');
const out=process.env.POCKET_SCREENSHOTS || fs.mkdtempSync(path.join(os.tmpdir(),'pocket-browser-'));
fs.mkdirSync(out,{recursive:true});
const now=Date.now();
const rows=[
 {id:'11111111-1111-4111-8111-111111111111',title:'Warehouse stock report',cwd:'/workspaces/warehouse',provider:'claude',mtimeMs:now,state:{kind:'running',label:'Running',startedAt:now-240000,queued:1}},
 {id:'cx:22222222-2222-4222-8222-222222222222',title:'Product photos and listing updates',cwd:'/workspaces/products',provider:'codex',mtimeMs:now-30000,state:{kind:'observed',label:'Activity elsewhere'}},
 {id:'33333333-3333-4333-8333-333333333333',title:'Supplier inventory import',cwd:'/workspaces/inventory',provider:'claude',mtimeMs:now-100000,state:{kind:'failed',label:'Turn failed',at:now-100000}},
 {id:'44444444-4444-4444-8444-444444444444',title:'Monthly warehouse summary',cwd:'/workspaces/warehouse',provider:'claude',mtimeMs:now-200000,state:{kind:'finished',label:'Response ready',at:now-200000}},
 {id:'55555555-5555-4555-8555-555555555555',title:'Camera ordering review with a deliberately long title that remains readable on a narrow phone',cwd:'/workspaces/purchasing',provider:'claude',mtimeMs:now-300000,state:{kind:'idle',label:'Recent'}},
];
const idle=rows.at(-1);let dispatches=0,failNext=false,stale=false;const receipts=new Map();const received=[];
const conversations=new Map(rows.map(r=>[r.id,[{role:'user',text:'Review the stock report.'},{role:'assistant',blocks:[{t:'text',text:'The report is ready to review.\n\n**Next step**\nCheck the incoming quantities before you finalize the order.'}]}]]));
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 const json=(body,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
 if(url.pathname==='/api/me')return json({ok:true});
 if(url.pathname==='/api/sessions')return stale?json({error:'Fixture offline'},503):json({sessions:rows,warnings:[],checkedAt:Date.now()});
 if(url.pathname==='/api/projects')return json({projects:['/workspaces/warehouse','/workspaces/products']});
 if(url.pathname==='/api/commands')return json({commands:[]});
 if(url.pathname==='/api/claude/models')return json({models:[{id:'test',label:'Test agent'}],defaultLabel:'Test agent'});
 if(url.pathname==='/api/codex/models')return json({models:[{id:'test',label:'Test agent'}]});
 if(url.pathname==='/api/push/key')return json({});
 if(url.pathname==='/api/settings')return json({});
 if(url.pathname==='/api/about')return json({assetV:20,notes:[],cli:'test',host:'preview'});
 if(url.pathname.endsWith('/events')){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});res.write('data: {"type":"watch"}\n\n');const t=setInterval(()=>res.write(': keepalive\n\n'),1000);req.on('close',()=>clearInterval(t));return;}
 if(url.pathname==='/api/new'){
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);received.push(body);
  if(!receipts.has(body.clientMessageId)){
   dispatches++;const id='66666666-6666-4666-8666-666666666666';
   rows.push({...idle,id,title:body.text});conversations.set(id,[{role:'user',text:body.text}]);receipts.set(body.clientMessageId,{id});
  }
  if(failNext){req.socket.destroy();return;}return json(receipts.get(body.clientMessageId),202);
 }
 const match=url.pathname.match(/^\/api\/session\/([^/]+)(\/message)?$/);
 if(match){const id=decodeURIComponent(match[1]),r=rows.find(x=>x.id===id);
  if(!match[2])return json({...r,active:false,ext:false,messages:conversations.get(id),total:conversations.get(id).length});
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);received.push(body);
  if(!receipts.has(body.clientMessageId)){dispatches++;receipts.set(body.clientMessageId,{ok:true});conversations.get(id).push({role:'user',text:body.text});}
  if(failNext){req.socket.destroy();return;}
  return json(receipts.get(body.clientMessageId),202);
 }
 if(url.pathname==='/sw.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end('// Fixture worker: no caching.');return;}
 const rel=url.pathname==='/'?'index.html':url.pathname.slice(1);const file=path.join(repo,'public',rel);
 if(!file.startsWith(path.join(repo,'public')+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'content-type':rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':rel.endsWith('.html')?'text/html':'application/octet-stream'});res.end(fs.readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await puppeteer.launch({executablePath:process.env.PUPPETEER_EXECUTABLE_PATH||'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
const errors=[];const p=await browser.newPage();await p.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);p.on('pageerror',e=>errors.push(e.message));
const scans=[];
const scan=async label=>{
 if(!process.env.POCKET_DESIGN_SCANNER)return;
 await p.evaluate(()=>{window.__IMPECCABLE_CONFIG__={autoScan:false};});
 if(!await p.evaluate(()=>Boolean(window.impeccableDetectAsync))){const injected=await p.addScriptTag({path:process.env.POCKET_DESIGN_SCANNER});await injected.evaluate(el=>el.remove());}
 scans.push({label,result:await p.evaluate(()=>window.impeccableDetectAsync({scrollOffscreen:false}))});
};
try{
 for(const width of [360,390,768,1440]){
  await p.setViewport({width,height:900,isMobile:width<700,hasTouch:width<700});
  await p.goto(base,{waitUntil:'domcontentloaded'});await p.waitForSelector('[data-id]');
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'list overflow '+width);
  assert.match(await p.$eval('[data-session-summary]',el=>el.textContent),/1 running/);
  await p.click('[data-filter="active"]');assert.equal(await p.$$eval('[data-session-results] [data-id]',els=>els.length),2);
  await p.click('[data-filter="attention"]');assert.equal(await p.$$eval('[data-session-results] [data-id]',els=>els.length),1);
  await p.click('[data-filter="all"]');await p.screenshot({path:path.join(out,`sessions-${width}.png`)});
  if([390,1440].includes(width))await scan('sessions-'+width);
  await p.click(`[data-id="${idle.id}"]`);await p.waitForSelector('#box');
  await p.type('#box','Keep this draft while switching sessions.');
  await p.click('#session-switch');await p.waitForSelector('[role="dialog"]');
  assert.equal(await p.evaluate(()=>document.querySelector('[role="dialog"]').contains(document.activeElement)),true);
  await p.keyboard.press('Escape');assert.equal(await p.$('[role="dialog"]'),null);
  assert.equal(await p.$eval('#box',e=>e.value),'Keep this draft while switching sessions.');
  await p.click('#c-model');await p.waitForSelector('[role="dialog"]');
  for(let i=0;i<8;i++){await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.querySelector('[role="dialog"]').contains(document.activeElement)),true);}
  await p.keyboard.press('Escape');assert.equal(await p.$eval('#c-model',e=>e===document.activeElement),true);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'chat overflow '+width);
  await p.screenshot({path:path.join(out,`chat-${width}.png`)});
  if([390,1440].includes(width))await scan('chat-'+width);
  await p.evaluate(()=>{clearDraft(chatId);document.querySelector('#box').value='';});
 }
 // Response lost after server dispatch: draft + attachment survive reload;
 // replaying the identical client ID confirms it without dispatching again.
 await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 await p.goto(base+'/#/chat/'+idle.id,{waitUntil:'domcontentloaded'});await p.waitForSelector('#box');
 await p.evaluate(()=>{tb.attachments=[{path:'/fixture/stock.csv',name:'stock.csv'}];stashAttachments();renderToolbar();});
 await p.type('#box','Exclude discontinued products.');failNext=true;await p.click('#send');
 await p.waitForSelector('#retry-message');
 assert.equal(await p.$eval('#box',e=>e.value),'Exclude discontinued products.');
 assert.equal(dispatches,1);
 assert.equal(await p.evaluate(id=>JSON.parse(localStorage.getItem('pc-attachments-'+id)).length,idle.id),1);
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForSelector('#retry-message');
 assert.equal(await p.$eval('#box',e=>e.value),'Exclude discontinued products.');
 await p.screenshot({path:path.join(out,'delivery-recovery.png')});
 failNext=false;await p.click('#retry-message');await p.waitForFunction(id=>!localStorage.getItem('pc-outbox-'+id),{},idle.id);await p.waitForSelector('#box');
 assert.equal(dispatches,1);assert.equal(received[0].clientMessageId,received[1].clientMessageId);
 assert.deepEqual(received[0].attachments,['/fixture/stock.csv']);
 assert.equal(await p.$eval('#box',e=>e.value),'');
 assert.equal(await p.$$eval('.m-user',els=>els.filter(e=>e.textContent==='Exclude discontinued products.').length),1);
 // A failed list refresh retains the last list but removes any implied live status.
 stale=true;await p.evaluate(()=>refreshSessions());
 assert.match(await p.$eval('#session-switch',e=>e.textContent),/unavailable/);
 assert.equal(await p.$$eval('.state-unknown',els=>els.length)>0,false,'mobile chat has no rendered list until switcher opens');
 await p.click('#session-switch');await p.waitForSelector('.state-unknown');
 await p.keyboard.press('Escape');
 // New-session creation must recover the same server-issued session ID too.
 stale=false;await p.goto(base+'/#/new',{waitUntil:'domcontentloaded'});await p.waitForSelector('[data-p]');
 await p.click('[data-p]');await p.type('#first','Prepare the weekly inventory.');failNext=true;await p.click('#start');
 await p.waitForFunction(()=>document.querySelector('#start')?.textContent==='Retry start');
 assert.equal(dispatches,2);await p.reload({waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>document.querySelector('#start')?.textContent==='Retry start');
 assert.equal(await p.$eval('#first',e=>e.value),'Prepare the weekly inventory.');
 failNext=false;await p.click('#start');await p.waitForSelector('#box');
 assert.equal(dispatches,2);assert.match(p.url(),/66666666-6666-4666-8666-666666666666/);
 assert.equal(await p.evaluate(()=>localStorage.getItem('pc-outbox-new')),null);
 assert.deepEqual(errors,[]);
 if(scans.length)fs.writeFileSync(path.join(out,'design-scan.json'),JSON.stringify(scans,null,2));
 console.log(JSON.stringify({ok:true,viewports:[360,390,768,1440],dispatches,receiptReplay:true,newSessionRecovery:true,draftAndAttachmentRecovery:true,dialogFocus:true,staleStatus:true,screenshots:out}));
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
