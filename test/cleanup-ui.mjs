import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {clickControl} from './ui-controls.mjs';
const require=createRequire(import.meta.url);
export async function runCleanupRegressions({browser,base,rows,out}) {
 const context=await browser.createBrowserContext(),page=await context.newPage();page.setDefaultTimeout(8000);
 const checks=[],scans=[],errors=[];let failure='',stall='',serial=0;
 page.on('pageerror',e=>errors.push(e.message));await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 await page.setRequestInterception(true);
 page.on('request',r=>{const endpoint=new URL(r.url()).pathname;if(endpoint===stall){setTimeout(()=>r.continue().catch(()=>{}),6000);return;}return endpoint===failure?r.respond({status:503,contentType:'application/json',body:'{"error":"Temporarily unavailable"}'}):r.continue();});
 const fresh=async(hash,selector)=>{await page.goto(base+'/?cleanup='+ ++serial+hash);await page.waitForSelector(selector);};
 const check=async(name,fn)=>{console.log('Cleanup check: '+name);await fn();checks.push(name);};
 const scan=async name=>{const s=await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});await s.evaluate(e=>e.remove());const r=await page.evaluate(()=>axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']}}));scans.push({name,violations:r.violations});assert.deepEqual(r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],name);await page.screenshot({path:path.join(out,'cleanup-'+name+'.png')});};
 try {
 await fetch(base+'/api/documents/reset',{method:'POST'});await fetch(base+'/api/board/reset',{method:'POST'});
 for(const width of [390,768,1440]){
  await page.setViewport({width,height:900});await fresh('#/','#settings');
  await check('Settings visible initial focus and six-category index at '+width,async()=>{
   await page.click('#settings');assert.equal(await page.evaluate(()=>document.activeElement.className),'sheet-close icon');
   assert.equal(await page.$$eval('.settings-index button',es=>es.filter(e=>e.checkVisibility()).length),6);
   assert.equal(await page.$eval('.settings-sheet',e=>e.scrollHeight<=e.clientHeight+1),true,'index fits without scrolling');
   await scan('settings-'+width);
  });
  await check('Settings category and parent return at '+width,async()=>{
   await page.click('[data-settings-category=agents]');await page.click('#s-usage');await page.waitForSelector('#usage-body');
   await page.click('.sheet-back');await page.waitForSelector('[data-settings-panel=agents]:not([hidden])');
   assert.match(await page.$eval('.settings-sheet h2',e=>e.textContent),/Agents/);
   await page.click('#settings-back');await page.click('[data-settings-category=notifications]');
   await page.click('#s-voice > summary');await page.waitForSelector('#s-voice-vocab');await scan('voice-'+width);
   await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'settings');
  });
  await fresh('#/new','#first');
  await check('New setup is labeled and preserves a draft at '+width,async()=>{
   await page.$eval('#first',e=>{e.value='';e.dispatchEvent(new Event('input'));});await page.type('#first','Do not lose this draft');assert.equal(await page.$eval('#new-setup',e=>e.open),false);
   const text=await page.$eval('#task-context',e=>e.textContent);for(const label of ['Workspace','Agent','Permissions'])assert.ok(text.includes(label));
   await page.click('#choose-workspace');await page.click('[data-a=codex]');await page.waitForFunction(()=>document.querySelector('#task-context').textContent.includes('Codex')&&CODEX_MODELS.length>1);
   await clickControl(page,'#c-model');await page.waitForSelector('[data-v="gpt-6-sol"]');await page.click('[data-v="gpt-6-sol"]');
   assert.equal(await page.$eval('#first',e=>e.value),'Do not lose this draft');
   assert.equal(await page.$eval('#tbar',e=>e.scrollWidth<=e.clientWidth+1),true,'setup choices wrap');
   await page.click('#choose-workspace');await scan('new-'+width);
  });
 }
 for(const width of [320,360,390,768,1024,1440]){
  await page.setViewport({width,height:900});await fresh('#/chat/'+rows[0].id,'#box');
  // 1.35: a running session's working row carries the project as a folder button, named for screen readers.
  await page.waitForFunction(()=>{const b=document.querySelector('#project-open');return b&&!b.hidden&&b.getAttribute('aria-label').includes('Warehouse');});
  assert.equal(await page.$eval('#project-open',b=>Boolean(b.closest('#comp .workrow'))),true,'the project control sits with the composer, not in a header row');
  await check('Readable chat navigation and targets at '+width,async()=>{
   const r=await page.evaluate(()=>{const p=document.querySelector('#project-open').getBoundingClientRect(),bar=document.querySelector('#chat-statebar').getBoundingClientRect(),s=document.querySelector('#session-switch').getBoundingClientRect();return {project:p.toJSON(),bar:bar.toJSON(),session:s.width,overflow:document.documentElement.scrollWidth>innerWidth,targets:[...document.querySelectorAll('.workrow button.wbell')].map(b=>{const r=b.getBoundingClientRect();return [r.width,r.height]})};});
   assert.equal(r.overflow,false);assert.ok(r.project.top>=r.bar.bottom-1);assert.ok(r.session>=82);r.targets.forEach(([w,h])=>assert.ok(w>=44&&h>=44));
   if([390,1440].includes(width))await scan('chat-'+width);
  });
 }
 await check('Leaving a page releases its stream and returning reconnects',async()=>{
  assert.equal(await page.evaluate(()=>Boolean(es)),true);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  assert.equal(await page.evaluate(()=>es),null);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  assert.equal(await page.evaluate(()=>Boolean(es)),true);
 });
 await check('Table overflow cue follows width and horizontal position',async()=>{
  await page.setViewport({width:390,height:900});await page.waitForSelector('.table-scroll-hint:not([hidden])');
  await page.$eval('.report-table',e=>e.scrollLeft=e.scrollWidth);await page.waitForFunction(()=>document.querySelector('.table-scroll-hint').textContent.includes('left'));
  await page.setViewport({width:1440,height:900});await page.waitForFunction(()=>document.querySelector('.table-scroll-hint').hidden);
 });
 await check('Rail button group supports arrow, Home and End without false tab roles',async()=>{
  await page.focus('[data-rail-view=sessions]');await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.railView),'projects');assert.equal(await page.$eval('[data-rail-view=projects]',e=>e.getAttribute('aria-pressed')),'true');
  assert.equal(await page.$eval('.rail-switch',e=>e.getAttribute('role')),'group');await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.dataset.railView),'documents');await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>document.activeElement.dataset.railView),'sessions');
 });
 await check('Resizable rail keeps New session and all header controls visible',async()=>{
  await page.addStyleTag({content:'.rail { overflow-y:scroll; scrollbar-gutter:stable; }'});
  await page.evaluate(()=>{const b=document.querySelector('[data-projects-badge]');b.hidden=false;b.textContent='2';});
  for(const zoom of [1,1.25,1.5,2])for(const width of [220,260,300,320,360,480]){
   await page.evaluate(({zoom,width})=>{document.body.style.zoom=zoom;document.querySelector('.rail').style.width=width+'px';}, {zoom,width});
   const clipped=await page.evaluate(()=>{
    const rail=document.querySelector('.rail'),r=rail.getBoundingClientRect(),scale=r.width/rail.offsetWidth,right=r.left+rail.clientWidth*scale;
    return [...document.querySelectorAll('.railhead button')].filter(e=>!e.hidden).filter(e=>{const b=e.getBoundingClientRect();return b.left<r.left||b.right>right+1||document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('button')!==e;}).map(e=>e.id||e.textContent);
   });
   assert.deepEqual(clipped,[],`rail ${width}px at ${zoom*100}% zoom`);
  }
  await page.evaluate(()=>{document.body.style.zoom='';document.querySelector('.rail').style.width='320px';});
  assert.equal(await page.evaluate(()=>document.querySelector('.rail-switch').offsetTop===document.querySelector('.rail-actions').offsetTop),true,'default rail stays in one row');
  await scan('rail-320');
  await page.setViewport({width:1440,height:900,hasTouch:true});
  for(const width of [220,320,480]){
   await page.$eval('.rail',(e,w)=>e.style.width=w+'px',width);
   assert.ok(await page.$$eval('.rail-actions button',es=>es.filter(e=>!e.hidden).every(e=>{const b=e.getBoundingClientRect(),r=e.closest('.rail');return b.width>=44&&b.height>=44&&b.right<=r.getBoundingClientRect().left+r.clientWidth;})));
  }
  await page.setViewport({width:1440,height:900,hasTouch:false});
  await page.click('#railnew');await page.waitForSelector('#first');assert.equal(new URL(page.url()).hash,'#/new');
  await fresh('#/chat/'+rows[0].id,'#box');
 });
 await check('Split chooser searches beyond recent items and groups results',async()=>{
  // Add a real scratch document, so this search exercises the fetched catalog.
  const r=await fetch(base+'/api/documents',{method:'POST',headers:{'x-filename':'zebra-search-target.md'},body:'# Zebra search target'});assert.equal(r.ok,true);
  await page.click('#splitb');await page.waitForSelector('#split-picker-search');await page.type('#split-picker-search','zebra');
  await page.waitForFunction(()=>document.querySelector('.split-choices').textContent.includes('Zebra search target'));
  assert.equal(await page.$$eval('.split-choices [data-v]',es=>es.length),1);assert.match(await page.$eval('.split-choices h3',e=>e.textContent),/Files/);
  await page.$eval('#split-picker-search',e=>{e.value='';e.dispatchEvent(new Event('input'))});await scan('split-desktop');await page.keyboard.press('Escape');
 });
 await check('A stalled document catalog does not block split-session choices',async()=>{
  stall='/api/documents';await page.click('#splitb');await page.waitForSelector('.split-choices [data-v=new]',{timeout:6500});
  assert.match(await page.$eval('.split-picker [role=status]',e=>e.textContent),/still loading/);
  await page.click('.split-choices [data-v=new]');await page.waitForSelector('#panes iframe');
  await page.evaluate(()=>{for(const p of [...splitPanes])closePane(p.key);});stall='';
 });
 await page.setViewport({width:390,height:844});
 await check('Document filters and list position survive opening a detail and Back',async()=>{
  // Long enough to exercise actual scroll restoration rather than only a zero offset.
  for(let i=0;i<16;i++)await fetch(base+'/api/documents',{method:'POST',headers:{'x-filename':`cleanup-${i}.md`},body:'# Cleanup document '+i});
  await fresh('#/documents','#doc-query');await page.type('#doc-query','Cleanup');await page.waitForFunction(()=>document.querySelectorAll('#documents-main [data-document]').length===16);
  await page.$eval('#documents-main',e=>e.scrollTop=230);const before=await page.$eval('#documents-main',e=>e.scrollTop);
  const link=await page.$eval('#documents-main [data-document]',e=>e.getAttribute('href'));await page.evaluate(h=>location.hash=h,link);await page.waitForSelector('#dmore');await page.click('#back');await page.waitForSelector('#doc-query');
  assert.equal(await page.$eval('#doc-query',e=>e.value),'Cleanup');await page.waitForFunction(top=>Math.abs(document.querySelector('#documents-main').scrollTop-top)<3,{},before);
  const sizes=await page.$$eval('.doc-filters button',es=>es.map(e=>[e.getBoundingClientRect().width,e.getBoundingClientRect().height]));sizes.forEach(([w,h])=>assert.ok(w>=44&&h>=44));
  await scan('documents-phone');
 });
 await check('Project detail Back restores its parent, including deep-link fallback',async()=>{
  await fresh('#/projects','.project-item');await page.click('.project-item a');await page.waitForSelector('#pmore');await page.click('#back');await page.waitForSelector('#pj-track');assert.equal(new URL(page.url()).hash,'#/projects');
  await fresh('#/projects/warehouse-stock-report','#pmore');await page.click('#back');await page.waitForSelector('#pj-track');assert.equal(new URL(page.url()).hash,'#/projects');
 });
 for(const [route,endpoint,selector] of [['projects','/api/board','#pj-track'],['documents','/api/documents','#doc-query']]){
  await check(route+' first-load and cached failure recover through Retry',async()=>{
   failure=endpoint;await fresh('#/'+route,'[data-library-retry]');assert.match(await page.$eval('.library-error',e=>e.textContent),/could not load/);
   failure='';await page.click('[data-library-retry]');await page.waitForSelector(selector);assert.equal(await page.$('.library-error'),null);
   failure=endpoint;await page.evaluate(()=>route());await page.waitForSelector('[data-library-retry]');assert.match(await page.$eval('.library-error',e=>e.textContent),/last loaded data/);assert.ok(await page.$(selector));
   failure='';await page.click('[data-library-retry]');await page.waitForFunction(()=>!document.querySelector('.library-error'));
  });
 }
 await check('Browser Back retains a detail’s original parent',async()=>{
  await fresh('#/documents','#doc-query');
  const id=await page.evaluate(()=>docsSnap.documents.find(d=>d.file==='weekly-summary.md').id);
  await page.evaluate(id=>location.hash='#/documents/'+id,id);await page.waitForSelector('#dmore');
  await page.evaluate(()=>location.hash='#/projects/warehouse-stock-report');await page.waitForSelector('#pmore');
  await page.goBack();await page.waitForSelector('#dmore');await page.click('#back');await page.waitForSelector('#doc-query');
  assert.equal(new URL(page.url()).hash,'#/documents');
 });
 await check('Document context deduplicates equal project/session names',async()=>{
  const where=await page.evaluate(()=>docWhere({project:'warehouse-stock-report',session:'11111111-1111-4111-8111-111111111111'}));assert.equal(where,'Warehouse stock report');
 });
 assert.deepEqual(errors,[]);console.log(JSON.stringify({cleanupRegressions:checks.length,cleanupAxeScans:scans.length,ok:true}));
 }catch(e){fs.writeFileSync(path.join(out,'cleanup-debug.json'),JSON.stringify(await page.evaluate(async()=>({apiDocs:await fetch('/api/documents',{signal:AbortSignal.timeout(3000)}).then(async r=>({status:r.status,text:(await r.text()).slice(0,180)})).catch(e=>e.message),snap:typeof docsSnap==='undefined'?null:docsSnap,hash:location.hash,features:window.pocketFeatures,docs:typeof docsSnap==='undefined'?null:docsSnap?.documents.map(d=>d.title),text:document.querySelector('.sheet')?.innerText})),null,2));await page.screenshot({path:path.join(out,'cleanup-failure.png')});throw e;}
 finally{fs.writeFileSync(path.join(out,'cleanup-regressions.json'),JSON.stringify({checks,scans,errors},null,2));await context.close();}
}
