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
let questionRequests=[];let questionAnswers=null;
let approvalRequests=[],approvalDecisions=[],approvalFail=false;
const queueRows=[{id:'q1',revision:1,text:'Check incoming quantities before placing an order.',status:'pending'}];
const report='## Inventory review\n\n| Product | On hand | Incoming | Supplier reference |\n|---|---:|---:|---|\n| Outdoor camera | 24 | 12 | WAREHOUSE-LONG-REFERENCE-001 |\n| Recorder | 8 | 4 | PURCHASE-ORDER-2026-10-03 |\n\n> Incoming stock is separate from the on-hand count.\n\n1. Review stock\n   - Exclude discontinued products\n   - Check expected delivery dates\n2. Confirm the order\n\n[Open the report](https://example.com/inventory)';
const conversations=new Map(rows.map(r=>[r.id,[{role:'user',text:'Review the stock report.'},{role:'assistant',blocks:[{t:'text',text:report}]}]]));
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 const json=(body,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
 if(url.pathname==='/api/me')return json({ok:true});
 if(url.pathname==='/api/approval-policy')return json({defaultMode:'review',allowFullAccess:true});
 if(url.pathname.endsWith('/approvals'))return json({requests:approvalRequests,interrupted:false,activeMode:'review',defaultMode:'review',allowFullAccess:true});
 if(/\/approvals\/[^/]+\/decision$/.test(url.pathname)){
  let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);
  if(approvalFail)return json({error:'Decision delivery is uncertain. Review the conversation.'},503);
  approvalDecisions.push(body.decision);approvalRequests=[];return json({ok:true});
 }
 if(url.pathname==='/api/sessions')return stale?json({error:'Fixture offline'},503):json({sessions:rows,warnings:[],checkedAt:Date.now()});
 if(url.pathname==='/api/projects')return json({projects:['/workspaces/warehouse','/workspaces/products']});
 if(url.pathname==='/api/commands')return json({commands:[{name:'inventory-report',label:'Inventory report',desc:'Review on-hand and incoming stock.',invocation:url.searchParams.get('provider')==='codex'?'Use the $inventory-report skill.':'Use the /inventory-report skill.'},{name:'product-listing',label:'Product listing',desc:'Prepare a new product listing.'}]});
 if(url.pathname==='/api/claude/models')return json({models:[{id:'test',label:'Test agent'}],defaultLabel:'Test agent'});
 if(url.pathname==='/api/codex/models')return json({models:[{id:'test',label:'Test agent'}]});
 if(url.pathname==='/api/push/key')return json({});
 if(url.pathname==='/api/settings')return json({});
 if(url.pathname==='/api/about')return json({assetV:21,notes:[],cli:'test',host:'preview'});
 if(url.pathname==='/api/environment')return json({host:'test-instance',checkedAt:Date.now(),providers:[{provider:'claude',email:'owner@example.test',plan:'max',method:'claude.ai',signedIn:true},{provider:'codex',email:'coder@example.test',plan:'pro',method:'chatgpt',signedIn:true}],accountManagement:'Sign-ins follow this instance.',permissions:'Unattended server permissions'});
 if(url.pathname.endsWith('/questions'))return json({supported:url.pathname.includes('cx:'),requests:questionRequests});
 if(url.pathname.endsWith('/questions/request-1/answer')){let raw='';for await(const c of req)raw+=c;questionAnswers=JSON.parse(raw).answers;questionRequests=[];return json({ok:true});}
 if(url.pathname.endsWith('/workspace'))return json({branch:'feature/inventory',total:2,checkedAt:Date.now(),files:[{path:'report.csv',status:' M',inspectable:true},{path:'.env',status:'??',inspectable:false}]});
 if(url.pathname.endsWith('/workspace/diff'))return json({text:url.searchParams.get('scope')==='staged'?'No staged diff for this file.':'-old quantity\n+new quantity\n+<script>unsafe-looking content is literal</script>'});
 if(url.pathname.endsWith('/events')){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});res.write(url.pathname.includes(rows[0].id)?': running\n\n':'data: {"type":"watch"}\n\n');const t=setInterval(()=>res.write(': keepalive\n\n'),1000);req.on('close',()=>clearInterval(t));return;}
 if(url.pathname==='/api/new'){
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);received.push(body);
  if(!receipts.has(body.clientMessageId)){
   dispatches++;const id='66666666-6666-4666-8666-666666666666';
   rows.push({...idle,id,title:body.text});conversations.set(id,[{role:'user',text:body.text}]);receipts.set(body.clientMessageId,{id});
  }
  if(failNext){req.socket.destroy();return;}return json(receipts.get(body.clientMessageId),202);
 }
 if(url.pathname.endsWith('/results'))return json({results:[{kind:'link',target:'https://example.com/inventory',label:'Inventory report',detail:'example.com'},{kind:'file',target:'/home/test/reports/stock.csv',label:'Stock CSV',detail:'CSV file'}]});
 if(url.pathname.includes('/queue')){
  if(req.method==='GET')return json({items:queueRows,active:true,external:false});
  let raw='';for await(const chunk of req)raw+=chunk;const b=JSON.parse(raw);const id=url.pathname.split('/').at(-1),idx=queueRows.findIndex(x=>x.id===id);
  if(req.method==='PATCH'){queueRows[idx]={...queueRows[idx],...(b.editing?{status:'editing'}:{text:b.text,status:'pending'}),revision:queueRows[idx].revision+1};return json({item:queueRows[idx]});}
  if(req.method==='DELETE'){queueRows.splice(idx,1);return json({ok:true});}
 }
 const match=url.pathname.match(/^\/api\/session\/([^/]+)(\/message)?$/);
 if(match){const id=decodeURIComponent(match[1]),r=rows.find(x=>x.id===id);
  if(!match[2])return json({...r,active:r.state.kind==='running',ext:false,messages:conversations.get(id),total:conversations.get(id).length});
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
  assert.equal(await p.$$eval('.report-table table',e=>e.length),1);assert.equal(await p.$$eval('blockquote',e=>e.length),1);assert.equal(await p.$$eval('ol li ul',e=>e.length)>0,true);
  await p.click('#results-open');await p.waitForSelector('.result-row');
  assert.equal(await p.$$eval('.result-row',e=>e.length),2);
  if(width===390)await p.screenshot({path:path.join(out,'results-mobile.png')});
  await p.type('#result-query','CSV');assert.equal(await p.$$eval('.result-row',e=>e.length),1);
  assert.match(await p.$eval('.result-row a',e=>e.getAttribute('href')),/artifact\?path=/);
  await p.keyboard.press('Escape');
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
 assert.equal(await p.$$eval('.state-unknown',els=>els.filter(e=>e.getClientRects().length).length)>0,false,'mobile chat has no rendered list until switcher opens');
 await p.click('#session-switch');await p.waitForSelector('.state-unknown');
 await p.keyboard.press('Escape');
 // New-session creation must recover the same server-issued session ID too.
 stale=false;await p.goto(base+'/#/new',{waitUntil:'domcontentloaded'});await p.waitForSelector('[data-p]');
 await p.click('#choose-workspace');await p.click('[data-p]');await p.type('#first','Prepare the weekly inventory.');failNext=true;await p.click('#start');
 await p.waitForFunction(()=>document.querySelector('#start')?.textContent==='Retry start');
 assert.equal(dispatches,2);await p.reload({waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>document.querySelector('#start')?.textContent==='Retry start');
 assert.equal(await p.$eval('#first',e=>e.value),'Prepare the weekly inventory.');
 failNext=false;await p.click('#start');await p.waitForSelector('#box');
 assert.equal(dispatches,2);assert.match(p.url(),/66666666-6666-4666-8666-666666666666/);
 assert.equal(await p.evaluate(()=>localStorage.getItem('pc-outbox-new')),null);
 // Reading position survives reopening a long conversation.
 conversations.get(idle.id).push({role:'assistant',blocks:[{t:'text',text:Array.from({length:60},(_,i)=>'Paragraph '+i+' in a long report.').join('\n\n')}]});
 await p.goto(base+'/#/chat/'+idle.id);await p.waitForSelector('#box');
 await p.evaluate(()=>{const m=document.querySelector('#msgs').closest('main.scroll');m.scrollTop=180;rememberReading();});
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForSelector('#box');
 assert.ok(Math.abs(await p.$eval('#msgs',e=>e.closest('main.scroll').scrollTop)-180)<4);
 // Agent-produced Markdown must not execute code or create active form controls.
 const security=await p.evaluate(()=>{
  const div=document.createElement('div');div.innerHTML=md('<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>\n\n[bad](javascript:alert(1))\n\n![bad](data:image/svg+xml;base64,AAAA)\n\n<input autofocus onfocus="window.__pwned=1">');
  return {danger:div.querySelectorAll('script,iframe,form,[onerror],[onfocus],a[href^="javascript:"],img[src^="data:"]').length,pwned:Boolean(window.__pwned)};
 });assert.deepEqual(security,{danger:0,pwned:false});
 await p.goto(base+'/#/chat/'+rows[0].id);await p.waitForSelector('[data-mode="queue"]');
 await p.click('[data-mode="queue"]');assert.equal(await p.$eval('[data-mode="queue"]',e=>e.getAttribute('aria-pressed')),'true');
 await p.click('#queue-open');await p.waitForSelector('[data-edit]');await p.click('[data-edit]');await p.waitForSelector('.queue-editor');
 await p.$eval('.queue-editor',e=>e.value='Only order current models.');await p.click('[data-save]');
 await p.waitForFunction(()=>document.querySelector('.queue-item p')?.textContent==='Only order current models.');
 await p.screenshot({path:path.join(out,'queue-mobile.png')});await p.click('[data-remove]');await p.waitForFunction(()=>document.querySelector('#queue-items')?.textContent.includes('No queued instructions'));await p.keyboard.press('Escape');
 for(const width of [390,1440]){
  await p.setViewport({width,height:900,isMobile:width<700,hasTouch:width<700});await p.goto(base+'/#/new');await p.waitForSelector('[data-p]');
  await p.click('#choose-skill');await p.waitForSelector('.skill-choice');await p.type('.skill-search','inventory');assert.equal(await p.$$eval('.skill-choice',e=>e.length),1);
  if(width===390)await p.screenshot({path:path.join(out,'skills-mobile.png')});await p.click('.skill-choice');
  assert.match(await p.$eval('#first',e=>e.value),/inventory-report/);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await p.screenshot({path:path.join(out,'new-'+width+'.png')});
 }
 // Daily workspace: filters, tabs, docking, read-only Git and native questions.
 await p.setViewport({width:1440,height:900});await p.goto(base);await p.waitForSelector('[data-workspace-filter]');
 await p.select('[data-workspace-filter]','/workspaces/warehouse');
 assert.equal(await p.$$eval('[data-id]',e=>e.length),2);
 await p.select('[data-provider-filter]','codex');assert.equal(await p.$$eval('[data-id]',e=>e.length),0);
 await p.select('[data-workspace-filter]','');await p.select('[data-provider-filter]','');
 await p.click(`[data-more="${idle.id}"]`);await p.click('#so-hide');assert.equal(await p.$(`[data-id="${idle.id}"]`),null);
 await p.click('[data-filter="hidden"]');await p.click(`[data-more="${idle.id}"]`);await p.click('#so-hide');await p.click('[data-filter="all"]');
 await p.click(`[data-id="${idle.id}"]`);await p.waitForSelector('#box');await p.click('#results-open');await p.waitForSelector('.workspace-dock .result-row');
 assert.equal(await p.$eval('#app',e=>e.inert),false);await p.type('#box','Desktop draft remains editable.');
 await p.click(`[data-id="${rows[0].id}"]`);await p.waitForFunction(id=>chatId===id&&document.querySelector('#box'),{},rows[0].id);
 await p.waitForSelector('.workspace-dock .result-row');assert.ok(await p.$$eval('#open-sessions a',e=>e.length)>=2);
 await p.click('#git-open');await p.waitForSelector('[data-git-file]');await p.click('[data-git-file="0"]');await p.waitForFunction(()=>document.querySelector('[data-git-diff] pre')?.textContent.includes('new quantity'));
 assert.equal(await p.$$eval('[data-git-diff] script',e=>e.length),0);await p.click('[data-scope="staged"]');await p.waitForFunction(()=>document.querySelector('[data-git-diff] pre')?.textContent.includes('No staged'));
 await p.screenshot({path:path.join(out,'workspace-desktop.png')});await scan('workspace-desktop');
 // Resizing preserves the open panel as a phone dialog rather than dropping its contents.
 await p.setViewport({width:390,height:844});await p.waitForSelector('.git-sheet[role="dialog"]');await p.keyboard.press('Escape');
 questionRequests=[{id:'request-1',blocking:true,questions:[{id:'format',header:'Format',question:'Which format should the report use?',options:[{label:'CSV',description:'For spreadsheets'},{label:'PDF',description:'For reading'}]}]}];
 rows[1].state={kind:'input',label:'Needs your answer',questions:1};
 await p.goto(base+'/#/chat/'+rows[1].id);await p.waitForSelector('#questions-open:not([hidden])');
 await p.click('#questions-open');await p.waitForSelector('.question-form');
 await p.screenshot({path:path.join(out,'native-question-mobile.png')});await scan('native-question-mobile');
 await p.click('.question-form [type=submit]');assert.match(await p.$eval('.question-error',e=>e.textContent),/Answer each/);
 await p.click('.question-option input');await p.click('.question-form [type=submit]');await p.waitForFunction(()=>document.querySelector('.question-form')?.textContent.includes('Answers sent'));
 assert.deepEqual(questionAnswers,{format:['CSV']});await p.keyboard.press('Escape');
 await p.click('#c-mode');await p.waitForSelector('[data-v="plan"]');await p.click('[data-v="plan"]');assert.match(await p.$eval('#c-mode',e=>e.textContent),/Plan first/);
 await p.evaluate(()=>openEnvironment());await p.waitForSelector('.provider-account');assert.match(await p.$eval('.provider-account',e=>e.textContent),/owner@example.test/);await p.keyboard.press('Escape');
 await p.keyboard.down('Control');await p.keyboard.press('k');await p.keyboard.up('Control');await p.waitForSelector('.session-switcher');await p.keyboard.press('Escape');
 // Desktop density controls act independently and do not remount the conversation.
 await p.setViewport({width:1440,height:800,isMobile:false,hasTouch:false});
 await p.goto(base+'/#/chat/'+idle.id);await p.waitForSelector('#box');
 await p.waitForSelector('#rail [data-workspace-filter]');
 await p.select('#rail [data-workspace-filter]','/workspaces/warehouse');
 await p.select('#rail [data-provider-filter]','claude');
 await p.type('#rail [data-session-search]','warehouse');
 await p.$eval('#box',e=>{e.value='Keep my draft while making room.';e.dispatchEvent(new Event('input',{bubbles:true}));});
 const expanded=await p.evaluate(()=>({chat:document.querySelector('#msgs').closest('main').clientHeight,rows:document.querySelector('#rail [data-session-results]').getBoundingClientRect().top}));
 await p.evaluate(()=>{window.densityComposer=document.querySelector('#box');document.querySelector('#msgs').closest('main').scrollTop=180;});
 await p.focus('#header-toggle');await p.keyboard.press('Enter');
 assert.equal(await p.$eval('#header-toggle',e=>e.getAttribute('aria-expanded')),'false');
 assert.equal(await p.$eval('#rail-filter-toggle',e=>e.getAttribute('aria-expanded')),'true');
 assert.equal(await p.$eval('#open-sessions',e=>e.getClientRects().length),0);
 assert.equal(await p.$eval('#cproj',e=>e.getClientRects().length),0);
 assert.ok(await p.$eval('#msgs',e=>Math.abs(e.closest('main').scrollTop-180)<4));
 await p.focus('#rail-filter-toggle');await p.keyboard.press('Enter');
 assert.equal(await p.$eval('#rail-filter-controls',e=>e.hidden),true);
 assert.match(await p.$eval('#rail-filter-summary',e=>e.textContent),/warehouse · Claude/);
 assert.equal(await p.$$eval('#rail [data-id]',e=>e.length),2);
 assert.equal(await p.$eval('#box',e=>e===window.densityComposer),true);
 assert.equal(await p.$eval('#box',e=>e.value),'Keep my draft while making room.');
 const collapsed=await p.evaluate(()=>({chat:document.querySelector('#msgs').closest('main').clientHeight,rows:document.querySelector('#rail [data-session-results]').getBoundingClientRect().top}));
 assert.ok(collapsed.chat-expanded.chat>=50,'header recovers at least 50px');
 assert.ok(expanded.rows-collapsed.rows>=120,'collapsed filters recover at least 120px');
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForSelector('#box');await p.waitForSelector('#rail [data-id]');
 assert.equal(await p.$eval('#header-toggle',e=>e.getAttribute('aria-expanded')),'false');
 assert.equal(await p.$eval('#rail-filter-toggle',e=>e.getAttribute('aria-expanded')),'false');
 assert.equal(await p.$eval('#box',e=>e.value),'Keep my draft while making room.');
 await p.click('#clear-rail-filters');assert.equal(await p.$eval('#rail-filter-summary',e=>e.hidden),true);
 await p.type('#rail [data-session-search]','warehouse');await p.click('#rail-filter-toggle');await p.click('#rail-filter-toggle');
 assert.equal(await p.$eval('#rail [data-session-search]',e=>e.value),'warehouse');
 await p.$eval('#rail [data-session-search]',e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));});
 await p.click('#results-open');await p.waitForSelector('.workspace-dock');
 await p.evaluate(()=>{window.densityDock=document.querySelector('.workspace-dock');});
 await p.click('#header-toggle');await p.click('#header-toggle');
 assert.equal(await p.$eval('.workspace-dock',e=>e===window.densityDock),true);
 await p.click('[data-close-dock]');
 for(const width of [900,1279,1280,1440,1536]){
  await p.setViewport({width,height:760});
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'compact desktop overflow '+width);
  for(const selector of ['#ctitle','#results-open','#queue-open','#git-open','#header-toggle','#rail-filter-toggle','#send']){
   assert.ok(await p.$eval(selector,e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;}),selector+' stays reachable at '+width);
  }
  if(width===1440){await p.screenshot({path:path.join(out,'compact-workspace-desktop.png')});await scan('compact-workspace-desktop');}
 }
 // Desktop preferences must not remove the phone subtitle or session controls.
 await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 assert.ok(await p.$eval('#cproj',e=>e.getClientRects().length)>0);
 assert.equal(await p.$eval('#header-toggle',e=>e.getClientRects().length),0);
 await p.screenshot({path:path.join(out,'compact-preference-mobile.png')});await scan('compact-preference-mobile');
 await p.setViewport({width:1440,height:760,isMobile:false,hasTouch:false});
 await p.click('#header-toggle');await p.click('#rail-filter-toggle');
 assert.ok(await p.$eval('#open-sessions',e=>e.getClientRects().length)>0);
 assert.equal(await p.$eval('#rail-filter-controls',e=>e.hidden),false);
 await p.screenshot({path:path.join(out,'expanded-workspace-desktop.png')});await scan('expanded-workspace-desktop');
 fs.writeFileSync(path.join(out,'density-metrics.json'),JSON.stringify({expanded,collapsed,conversationGain:collapsed.chat-expanded.chat,sessionListGain:expanded.rows-collapsed.rows},null,2));
 // Chat text scales independently of application chrome and keeps its value on reload.
 const chromeSize=await p.$eval('#results-open',e=>getComputedStyle(e).fontSize);
 await p.click('#chatmore');await p.waitForSelector('[data-text-larger]');
 assert.equal(await p.$eval('[data-text-size]',e=>e.textContent),'17px');
 await p.focus('[data-text-larger]');await p.keyboard.press('Enter');
 assert.equal(await p.$eval('.m-asst',e=>getComputedStyle(e).fontSize),'18px');
 assert.equal(await p.$eval('.m-user',e=>getComputedStyle(e).fontSize),'18px');
 assert.equal(await p.$eval('#results-open',e=>getComputedStyle(e).fontSize),chromeSize);
 assert.equal(await p.$eval('#box',e=>e.value),'Keep my draft while making room.');
 for(let i=0;i<6;i++)await p.click('[data-text-larger]');
 assert.equal(await p.$eval('[data-text-larger]',e=>e.disabled),true);
 assert.equal(await p.$eval('.chat-text-preview',e=>getComputedStyle(e).fontSize),'24px');
 assert.ok(await p.$eval('.m-asst h2',e=>Math.abs(parseFloat(getComputedStyle(e).fontSize)-24*22/17)<.01));
 assert.ok(await p.$eval('.report-table table',e=>Math.abs(parseFloat(getComputedStyle(e).fontSize)-24*15/17)<.01));
 await p.screenshot({path:path.join(out,'chat-text-size-desktop.png')});await scan('chat-text-size-desktop');
 await p.keyboard.press('Escape');assert.equal(await p.$eval('#chatmore',e=>e===document.activeElement),true);
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForSelector('#box');
 assert.equal(await p.$eval('.m-asst',e=>getComputedStyle(e).fontSize),'24px');
 await p.click('#chatmore');await p.waitForSelector('[data-text-smaller]');
 for(let i=0;i<10;i++)await p.click('[data-text-smaller]');
 assert.equal(await p.$eval('[data-text-smaller]',e=>e.disabled),true);
 assert.equal(await p.$eval('.m-asst',e=>getComputedStyle(e).fontSize),'14px');
 await p.click('[data-text-reset]');assert.equal(await p.$eval('[data-text-size]',e=>e.textContent),'17px');
 await p.keyboard.press('Escape');
 // Settings exposes the same preference and message anchors remain steady as text reflows.
 await p.click('#railsettings');await p.waitForSelector('[data-text-larger]');
 await p.click('[data-text-larger]');assert.equal(await p.$eval('.m-asst',e=>getComputedStyle(e).fontSize),'18px');
 await p.keyboard.press('Escape');
 const anchorShift=await p.evaluate(()=>{
  const m=document.querySelector('#msgs').closest('main'),anchor=[...m.querySelectorAll('.m-asst p')].find(e=>e.textContent==='Paragraph 12 in a long report.');
  m.scrollTop+=anchor.getBoundingClientRect().top-m.getBoundingClientRect().top;
  const top=anchor.getBoundingClientRect().top;setChatTextSize(24);return Math.abs(anchor.getBoundingClientRect().top-top);
 });assert.ok(anchorShift<4,'font changes retain the visible paragraph');
 for(const width of [360,390,768,1440]){
  await p.setViewport({width,height:844,isMobile:width<700,hasTouch:width<700});
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'large chat text overflow '+width);
  await p.click('#chatmore');await p.waitForSelector('[data-text-reset]');
  assert.equal(await p.$eval('[data-text-size]',e=>e.textContent),'24px');
  assert.ok(await p.$eval('[data-text-reset]',e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.right<=innerWidth;}));
  if(width===390){await p.screenshot({path:path.join(out,'chat-text-size-mobile.png')});await scan('chat-text-size-mobile');}
  await p.keyboard.press('Escape');
 }
 await p.evaluate(()=>{localStorage.setItem('pc-chat-text-size','999');});await p.reload({waitUntil:'domcontentloaded'});await p.waitForSelector('#box');
 assert.equal(await p.$eval('.m-asst',e=>getComputedStyle(e).fontSize),'17px','invalid saved sizes fall back to the default');
 await p.evaluate(()=>setChatTextSize(17));
 // Approvals show the exact escaped request; no decision is selected or sent on open.
 await p.goto(base+'/#/chat/'+idle.id);await p.waitForSelector('#c-approval');
 await p.click('#c-approval');await p.waitForSelector('[data-v="full"]');await p.click('[data-v="full"]');
 assert.match(await p.$eval('#c-approval',e=>e.textContent),/Full access/);
 await p.click('#c-approval');await p.click('[data-v="review"]');assert.equal(await p.evaluate(()=>turnOpts().approvalMode),'review');
 for(const width of [390,1440]){
  approvalRequests=[{id:'approval-1',title:'Run this command?',kind:'command',details:JSON.stringify({command:'printf "<script>window.__approvalXSS=1</script>" > report.txt',cwd:'/workspaces/reports'},null,2),canAllow:true,status:'pending'}];
  await p.setViewport({width,height:900,isMobile:width<700,hasTouch:width<700});await p.evaluate(()=>refreshApprovals(chatId));await p.waitForSelector('#approvals-open:not([hidden])');
  await p.click('#approvals-open');await p.waitForSelector('.approval-card');
  assert.equal(await p.evaluate(()=>Boolean(window.__approvalXSS)),false);assert.equal(await p.$$eval('.approval-card script',e=>e.length),0);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const before=approvalDecisions.length;await p.screenshot({path:path.join(out,'approval-'+width+'.png')});await scan('approval-'+width);
  assert.equal(approvalDecisions.length,before);await p.focus('[data-decision="deny"]');await p.keyboard.press('Enter');
  await p.waitForFunction(()=>document.querySelector('.approval-outcome')?.textContent.startsWith('Denied'));
  assert.equal(approvalDecisions.at(-1),'deny');await p.keyboard.press('Escape');
 }
 approvalRequests=[{id:'approval-2',title:'Apply file changes?',kind:'fileChange',details:'+new line',canAllow:true,status:'pending'}];
 await p.evaluate(()=>openApprovals(chatId));await p.waitForSelector('[data-decision="allow"]');approvalFail=true;
 await p.click('[data-decision="allow"]');await p.waitForFunction(()=>document.querySelector('.approval-outcome')?.textContent.includes('uncertain'));
 assert.equal(await p.$eval('[data-decision="allow"]',e=>e.disabled),true);
 approvalFail=false;approvalRequests=[{...approvalRequests[0],status:'uncertain'}];await p.click('[data-refresh-approvals]');
 await p.waitForFunction(()=>document.querySelector('.approval-outcome')?.textContent.includes('Decision sent or uncertain'));
 assert.equal(await p.$eval('[data-decision="allow"]',e=>e.disabled),true);await p.keyboard.press('Escape');
 approvalRequests=[];
 await p.goto(base);await p.waitForSelector('[data-more]');
 await p.click(`[data-more="${rows[0].id}"]`);await p.click('#so-permissions');await p.waitForSelector('[data-v="full"]');await p.click('[data-v="full"]');
 assert.equal(await p.evaluate(id=>getPrefs(id).approvalMode,rows[0].id),'full','home-list permissions target the selected session');
 assert.equal(await p.evaluate(id=>getPrefs(id).approvalMode,idle.id),'review','another session keeps its own policy');
 assert.deepEqual(errors,[]);
 if(scans.length)fs.writeFileSync(path.join(out,'design-scan.json'),JSON.stringify(scans,null,2));
 console.log(JSON.stringify({ok:true,viewports:[360,390,768,1440],dispatches,receiptReplay:true,newSessionRecovery:true,draftAndAttachmentRecovery:true,dialogFocus:true,staleStatus:true,markdownSafety:true,results:true,queueEditing:true,skillLauncher:true,screenshots:out}));
}catch(e){console.error('Page errors:',errors);console.error('Page URL:',p.url());throw e;}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
