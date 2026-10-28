import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
export async function runCliUpdateRegressions({browser,base,out}){
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let state,posts=[],offline=false;
 const reset=()=>{state={enabled:true,timeZone:'America/New_York',hour:4,checkedAt:Date.now(),checking:false,job:null,providers:[{key:'claude',name:'Claude Code',installed:'2.0.0',latest:'2.1.0',available:true,canUpgrade:true,notes:'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md'},{key:'codex',name:'Codex',installed:'0.150.0',latest:'0.151.0',available:true,canUpgrade:true,notes:'https://github.com/openai/codex/releases'}]};posts=[];};reset();
 await page.setRequestInterception(true);
 page.on('request',req=>{const url=new URL(req.url());if(!url.pathname.startsWith('/api/cli-updates'))return req.continue();
  if(offline)return req.respond({status:503,contentType:'application/json',body:'{"error":"Update status unavailable"}'});
  if(req.method()==='POST'){posts.push(JSON.parse(req.postData()));if(url.pathname.endsWith('/upgrade'))state.job={id:'job-one',running:true,phase:'testing',results:[]};}
  return req.respond({status:req.method()==='POST'?202:200,contentType:'application/json',body:JSON.stringify(state)});
 });
 try{
  for(const width of [390,1440]){
   reset();await page.setViewport({width,height:900,isMobile:width<700,hasTouch:width<700});await page.goto(base);await page.waitForSelector('[data-id]');
   await page.evaluate(()=>pollCliUpdates());await page.waitForSelector('.cli-update-notice:not([hidden])');assert.equal(posts.length,0,'discovery must never upgrade');
   await page.click('.cli-update-notice');await page.waitForSelector('#cli-upgrade:not([disabled])');await new Promise(r=>setTimeout(r,350));
   assert.match(await page.$eval('#cli-schedule',e=>e.textContent),/4:00 a.m. \(America\/New_York\)/);
   assert.equal(await page.$$eval('[data-cli-select]:checked',es=>es.length),2);
   await page.screenshot({path:path.join(out,`cli-updates-${width}.png`)});
   await page.addScriptTag({path:path.resolve('node_modules/axe-core/axe.min.js')});
   const axe=await page.evaluate(async()=>axe.run('.cli-updates-sheet',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));assert.deepEqual(axe.violations.map(x=>({id:x.id,nodes:x.nodes.map(n=>n.target)})),[]);
   await page.screenshot({path:path.join(out,`cli-updates-${width}.png`)});
   if(process.env.POCKET_DESIGN_SCANNER){await page.evaluate(()=>{window.__IMPECCABLE_CONFIG__={autoScan:false};});await page.addScriptTag({path:process.env.POCKET_DESIGN_SCANNER});fs.writeFileSync(path.join(out,`cli-updates-design-${width}.json`),JSON.stringify(await page.evaluate(()=>window.impeccableDetectAsync({scrollOffscreen:false})),null,2));}
   assert.ok(await page.$eval('.cli-updates-sheet',e=>e.getBoundingClientRect().width)<=width,'sheet fits');
   await page.click('[data-cli-select="codex"]');await page.click('#cli-upgrade');await page.waitForFunction(()=>document.querySelector('#cli-job').textContent.includes('Testing'));
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
  await page.click('[data-cli-interrupt="false"]');
  assert.deepEqual(posts.at(-1),{key:'claude',id:state.providers[0].older[0].id,interrupt:false});
  assert.deepEqual(errors,[]);console.log('CLI update browser checks passed: review, explicit selection, reconnect, failure, retry, success, accessibility at 390/1440.');
 }finally{await page.close();}
}
