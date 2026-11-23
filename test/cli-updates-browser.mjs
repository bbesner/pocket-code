import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
export async function runCliUpdateRegressions({browser,base,out}){
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let state,posts=[],offline=false;
 const reset=()=>{state={enabled:true,timeZone:'America/New_York',hour:4,checkedAt:Date.now(),checking:false,job:null,pocket:{key:'pocket',name:'Pocket Code',enabled:true,installed:'1.107.1',latest:'1.108.0',available:true,notes:'https://github.com/bbesner/pocket-code/releases/tag/v1.108.0',guide:'https://github.com/bbesner/pocket-code/blob/main/docs/operations.md#upgrade-an-existing-installation'},providers:[{key:'claude',name:'Claude Code',installed:'2.0.0',latest:'2.1.0',available:true,canUpgrade:true,notes:'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md'},{key:'codex',name:'Codex',installed:'0.150.0',latest:'0.151.0',available:true,canUpgrade:true,notes:'https://github.com/openai/codex/releases'}]};posts=[];};reset();
 await page.setRequestInterception(true);
 page.on('request',req=>{const url=new URL(req.url());if(!url.pathname.startsWith('/api/cli-updates'))return req.continue();
  if(offline)return req.respond({status:503,contentType:'application/json',body:'{"error":"Update status unavailable"}'});
  if(req.method()==='POST'){posts.push(JSON.parse(req.postData()));if(url.pathname.endsWith('/upgrade'))state.job={id:'job-one',running:true,phase:'testing',results:[]};if(url.pathname.endsWith('/pocket'))state.pocket.self.job={id:'self-one',running:true,phase:'restarting',from:state.pocket.installed,to:state.pocket.latest};}
  // 1.124.3: a POST answers as server.mjs does. Check now and Upgrade return the plain snapshot, without the older
  // conversations or Pocket's self-update (only GET adds those); /pocket adds self; /switch answers with a message.
  const {self,...pocket}=state.pocket||{},reply=url.pathname.endsWith('/switch')?{stopping:false,message:'Old process closing. The next turn will use the updated CLI.'}
   :{...state,pocket:state.pocket&&{...pocket,...(url.pathname.endsWith('/pocket')?{self}:{})},providers:state.providers.map(({older,olderSessions,...p})=>p)};
  return req.respond({status:req.method()==='POST'?202:200,contentType:'application/json',body:JSON.stringify(req.method()==='POST'?reply:state)});
 });
 try{
  for(const width of [390,1440]){
   reset();await page.setViewport({width,height:900,isMobile:width<700,hasTouch:width<700});await page.goto(base);await page.waitForSelector('[data-id]');
   await page.evaluate(()=>pollCliUpdates());await page.waitForSelector('.cli-update-notice:not([hidden])');assert.equal(posts.length,0,'discovery must never upgrade');
   assert.equal(await page.$eval('.cli-update-notice',e=>e.textContent),'Pocket Code, Claude Code and Codex updates available. Review');
   await page.click('.cli-update-notice');await page.waitForSelector('#cli-upgrade:not([disabled])');await new Promise(r=>setTimeout(r,350));
   assert.match(await page.$eval('#pocket-update-row',e=>e.textContent),/Installed: 1\.107\.1 · Available: 1\.108\.0/);
   assert.equal(await page.$eval('#pocket-update-row a[href*="operations.md"]',e=>e.textContent),'How to update');
   assert.equal(await page.$('#pocket-update-row input,#pocket-update-row button'),null,'Pocket Code is announced, not installed from the sheet');
   assert.match(await page.$eval('#cli-schedule',e=>e.textContent),/4:00 a.m. \(America\/New_York\)/);
   assert.equal(await page.$$eval('[data-cli-select]:checked',es=>es.length),2);
   await page.screenshot({path:path.join(out,`cli-updates-${width}.png`)});
   await page.addScriptTag({path:path.resolve('node_modules/axe-core/axe.min.js')});
   const axe=await page.evaluate(async()=>axe.run('.cli-updates-sheet',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));assert.deepEqual(axe.violations.map(x=>({id:x.id,nodes:x.nodes.map(n=>n.target)})),[]);
   await page.screenshot({path:path.join(out,`cli-updates-${width}.png`)});
   if(process.env.POCKET_DESIGN_SCANNER){await page.evaluate(()=>{window.__IMPECCABLE_CONFIG__={autoScan:false};});await page.addScriptTag({path:process.env.POCKET_DESIGN_SCANNER});fs.writeFileSync(path.join(out,`cli-updates-design-${width}.json`),JSON.stringify(await page.evaluate(()=>window.impeccableDetectAsync({scrollOffscreen:false})),null,2));}
   assert.ok(await page.$eval('.cli-updates-sheet',e=>e.getBoundingClientRect().width)<=width,'sheet fits');
   await page.$eval('[data-cli-select="codex"]',e=>e.scrollIntoView({block:'center'}));await page.click('[data-cli-select="codex"]');await page.click('#cli-upgrade');await page.waitForFunction(()=>document.querySelector('#cli-job').textContent.includes('Testing'));
   assert.deepEqual(posts,[{selections:[{key:'claude',version:'2.1.0'}]}]);assert.equal(await page.$eval('#cli-upgrade',e=>e.disabled),true);
   await page.click('#cli-later');await page.reload();await page.waitForSelector('[data-id]');await page.evaluate(()=>pollCliUpdates());await page.click('.cli-update-notice');await page.waitForFunction(()=>document.querySelector('#cli-job').textContent.includes('Testing'));
   state.job={id:'job-one',running:false,phase:'failed',results:[],error:'Compatibility check failed. Previous version retained.'};
   await page.waitForFunction(()=>document.querySelector('#cli-job').textContent.includes('Previous version retained.'));
   await page.keyboard.press('Escape');assert.equal(await page.$('.cli-updates-sheet'),null);
   assert.equal(posts.length,1,'reopening does not repeat installation');
  }
  // A failed first load still has a working retry. An explicit check populates selection.
  offline=true;await page.evaluate(()=>openCliUpdates());await page.waitForFunction(()=>document.querySelector('#cli-update-error').textContent.includes('Could not load'));
  assert.equal(await page.$eval('#cli-check',e=>e.disabled),false);offline=false;reset();await page.click('#cli-check');await page.waitForSelector('#cli-upgrade:not([disabled])');
  // The success notice is visible after a closed-browser completion and read only once.
  await page.keyboard.press('Escape');state.providers.forEach(p=>{p.installed=p.latest;p.available=false;});state.job={id:'success-job',running:false,phase:'complete',results:[{key:'claude',version:'2.1.0'}]};
  await page.evaluate(()=>pollCliUpdates());assert.match(await page.$eval('.cli-update-notice',e=>e.textContent),/complete/);await page.click('.cli-update-notice');await page.waitForFunction(()=>document.querySelector('#cli-job').textContent.includes('Upgrade complete'));
  await page.keyboard.press('Escape');state.job=null;
  // Pocket Code alone: the notice still appears, and goes once the server runs the release.
  await page.evaluate(()=>pollCliUpdates());assert.equal(await page.$eval('.cli-update-notice',e=>e.textContent),'Pocket Code update available. Review');
  state.pocket={...state.pocket,installed:'1.108.0',available:false};await page.evaluate(()=>pollCliUpdates());assert.equal(await page.$eval('.cli-update-notice',e=>e.hidden),true);
  state.providers[0].olderSessions=1;state.providers[0].older=[{key:'claude',id:'12345678-1234-1234-1234-123456789abc',title:'Review invoices',busy:false,version:'2.0.0'}];
  state.providers[1].olderSessions=1;state.providers[1].older=[{key:'codex',id:'cx:12345678-1234-1234-1234-123456789abd',title:'Build report',busy:true,version:'0.150.0'}];
  await page.evaluate(()=>pollCliUpdates());await page.waitForFunction(()=>document.querySelector('.cli-update-notice')?.textContent.includes('2 conversations'));
  await page.click('.cli-update-notice');await page.waitForSelector('[data-cli-switch]');
  assert.equal(await page.$$eval('[data-cli-switch]',es=>es.length),2);
  assert.match(await page.$eval('.cli-updates-sheet',e=>e.textContent),/Restarting Pocket keeps those processes/);
  assert.match(await page.$eval('[data-cli-interrupt="true"]',e=>e.textContent),/Stop work & switch/);
  await page.setViewport({width:390,height:900,isMobile:false,hasTouch:false});
  await new Promise(r=>setTimeout(r,350)); // let the sheet's entrance finish before contrast is measured
  assert.ok(await page.$eval('.cli-updates-sheet',e=>e.getBoundingClientRect().width)<=390);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'older session actions fit the phone');
  await page.addScriptTag({path:path.resolve('node_modules/axe-core/axe.min.js')});
  const olderAxe=await page.evaluate(async()=>axe.run('.cli-updates-sheet',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
  assert.deepEqual(olderAxe.violations.map(x=>({id:x.id,nodes:x.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),[]);
  await page.screenshot({path:path.join(out,'cli-updates-older-390.png')});
  if(process.env.POCKET_DESIGN_SCANNER){await page.addScriptTag({path:process.env.POCKET_DESIGN_SCANNER});fs.writeFileSync(path.join(out,'cli-updates-older-design-390.json'),JSON.stringify(await page.evaluate(()=>window.impeccableDetectAsync({scrollOffscreen:false})),null,2));}
  await page.$eval('[data-cli-interrupt="false"]',e=>e.scrollIntoView({block:'center'}));
  // The click handler posts asynchronously; wait for the request so a slow runner cannot read the earlier check's {}.
  const switched=page.waitForRequest(r=>r.method()==='POST'&&new URL(r.url()).pathname.endsWith('/api/cli-updates/switch'),{timeout:10000});
  await page.click('[data-cli-interrupt="false"]');await switched;
  assert.deepEqual(posts.at(-1),{key:'claude',id:state.providers[0].older[0].id,interrupt:false});
  // 1.123: an install whose owner opted in (POCKET_SELF_UPDATE=1) updates Pocket Code from the sheet.
  await page.keyboard.press('Escape');reset();state.providers.forEach(p=>{p.installed=p.latest;p.available=false;});
  state.pocket.self={enabled:true,available:true,reason:null,job:null};
  await page.evaluate(()=>pollCliUpdates());await page.click('.cli-update-notice');await page.waitForSelector('#pocket-self-update');
  assert.equal(await page.$eval('#pocket-self-update',e=>e.textContent),'Update to 1.108.0');
  assert.equal(await page.$('#pocket-update-row a[href*="operations.md"]'),null,'no operator guide when the owner installs it');
  assert.match(await page.$eval('#pocket-update-row',e=>e.textContent),/You install its updates here/);
  let asked='';const onDialog=d=>{asked=d.message();d.accept();};page.on('dialog',onDialog);
  const updated=page.waitForRequest(r=>r.method()==='POST'&&new URL(r.url()).pathname.endsWith('/api/cli-updates/pocket'),{timeout:10000});
  await page.$eval('#pocket-self-update',e=>e.scrollIntoView({block:'center'}));await page.click('#pocket-self-update');await updated;page.off('dialog',onDialog);
  assert.match(asked,/goes back to 1\.107\.1/);assert.deepEqual(posts.at(-1),{version:'1.108.0'});
  await page.waitForFunction(()=>document.querySelector('#pocket-self-status')?.textContent.includes('Restarting Pocket'));
  assert.equal(await page.$('#pocket-self-update'),null,'no second update while one runs');
  offline=true;await new Promise(r=>setTimeout(r,2500));
  assert.equal(await page.$eval('#cli-update-error',e=>e.textContent),'','the server going away mid-update is not shown as an error');offline=false;
  state.pocket={...state.pocket,installed:'1.108.0',available:false,self:{...state.pocket.self,job:{id:'self-one',running:false,phase:'complete',from:'1.107.1',to:'1.108.0'}}};
  await page.waitForFunction(()=>document.querySelector('#pocket-self-status')?.textContent==='Updated to 1.108.0.');
  await page.setViewport({width:390,height:900,isMobile:false,hasTouch:false});await new Promise(r=>setTimeout(r,350));
  await page.addScriptTag({path:path.resolve('node_modules/axe-core/axe.min.js')});
  const selfAxe=await page.evaluate(async()=>axe.run('.cli-updates-sheet',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
  assert.deepEqual(selfAxe.violations.map(x=>({id:x.id,nodes:x.nodes.map(n=>n.target)})),[]);
  state.pocket={...state.pocket,installed:'1.107.1',available:true,self:{...state.pocket.self,job:{id:'self-two',running:false,phase:'failed',from:'1.107.1',to:'1.108.0',error:'1.108.0 did not start, so Pocket went back to 1.107.1.'}}};
  await page.waitForFunction(()=>document.querySelector('#pocket-self-status')?.textContent.includes('went back to 1.107.1'));
  assert.ok(await page.$('#pocket-self-update'),'after a failure the owner can try again');
  await page.$eval('#pocket-update-row',e=>e.scrollIntoView({block:'center'}));await page.screenshot({path:path.join(out,'cli-updates-self-390.png')});
  if(process.env.POCKET_DESIGN_SCANNER){await page.addScriptTag({path:process.env.POCKET_DESIGN_SCANNER});fs.writeFileSync(path.join(out,'cli-updates-self-design-390.json'),JSON.stringify(await page.evaluate(()=>window.impeccableDetectAsync({scrollOffscreen:false})),null,2));}
  state.pocket.self={enabled:true,available:false,reason:'Pocket is not running under PM2 here, so it cannot restart itself. Update it from the server.',job:null};
  await page.waitForFunction(()=>document.querySelector('#pocket-update-row').textContent.includes('not running under PM2'));
  assert.equal(await page.$('#pocket-self-update'),null);
  // 1.124.3: Check now keeps the Update button and the older conversations on screen. The POST answers without them;
  // rendering that reply swapped the button for the operator's How to update and dropped the Switch now list.
  await page.keyboard.press('Escape');reset();state.pocket.self={enabled:true,available:true,reason:null,job:null};
  state.providers[0].olderSessions=1;state.providers[0].older=[{key:'claude',id:'12345678-1234-1234-1234-123456789abc',title:'Review invoices',busy:false,version:'2.0.0'}];
  await page.evaluate(()=>pollCliUpdates());await page.click('.cli-update-notice');await page.waitForSelector('#pocket-self-update');await page.waitForSelector('[data-cli-switch]');
  await page.evaluate(()=>{window.__cliLost=[];const sh=document.querySelector('.cli-updates-sheet');new MutationObserver(()=>{
   if(!sh.querySelector('#pocket-self-update'))window.__cliLost.push('Update button');if(sh.querySelector('#pocket-update-row a[href*="operations.md"]'))window.__cliLost.push('How to update');if(!sh.querySelector('[data-cli-switch]'))window.__cliLost.push('Switch now');}).observe(sh,{subtree:true,childList:true});});
  const checked=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/api/cli-updates/check'),{timeout:10000});
  await page.click('#cli-check');await checked;await page.waitForFunction(()=>!document.querySelector('#cli-check').disabled);await new Promise(r=>setTimeout(r,300));
  assert.deepEqual([...new Set(await page.evaluate(()=>window.__cliLost))],[],'nothing the GET view shows goes missing after Check now');
  assert.equal(await page.$eval('#pocket-self-update',e=>e.textContent),'Update to 1.108.0');
  await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);console.log('CLI update browser checks passed: review, explicit selection, reconnect, failure, retry, success, accessibility at 390/1440; Pocket Code self-update (button, confirm, restart, done, failure, unavailable).');
 }finally{await page.close();}
}
