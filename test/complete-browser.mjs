// 1.111 The Complete card in the browser: the card under a reply that ended with a done block, the tap that closes the
// conversation (reviewed, process released, tab or pane closed), Undo, the list row's label, outcome line and one-tap
// close, and the cases where the card must not show. Runs against browser.mjs's fixtures.
// POCKET_COMPLETE_ONLY=1 runs these checks alone.
// POCKET_DESIGN_SCANNER: the impeccable detector on each scanned view; its findings are written beside the screenshots.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const SUMMARY='Sent the September summary; totals checked against the ledger';
export async function runCompleteRegressions({browser,base,rows,out,conversations,releases,settings}) {
 const context=await browser.createBrowserContext(),page=await context.newPage();page.setDefaultTimeout(8000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 const row=rows.find(r=>r.state.kind==='finished'),other=rows.find(r=>r.state.kind==='idle'),id=row.id;
 const saved={state:row.state,seenAt:row.seenAt,messages:conversations.get(id)};
 const scan=async(name,sel)=>{const s=await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});await s.evaluate(e=>e.remove());const r=await page.evaluate(sel=>axe.run(sel,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}),sel);assert.deepEqual(r.violations.map(v=>v.id+': '+v.nodes.map(n=>n.target.join(' ')).join(', ')),[],'axe '+name);
  if(process.env.POCKET_DESIGN_SCANNER){await page.evaluate(()=>{window.__IMPECCABLE_CONFIG__={autoScan:false};});if(!await page.evaluate(()=>Boolean(window.impeccableDetectAsync))){const t=await page.addScriptTag({path:process.env.POCKET_DESIGN_SCANNER});await t.evaluate(e=>e.remove());}fs.writeFileSync(path.join(out,'complete-design-'+name+'.json'),JSON.stringify(await page.evaluate(()=>window.impeccableDetectAsync({scrollOffscreen:false})),null,1));}
 };
 // The server's side of a reply that ended with a done block: the block in the transcript, Complete in the outcome.
 const complete=(text=SUMMARY)=>{
  row.state={kind:'finished',label:'Complete',done:true,...(text?{summary:text}:{}),at:Date.now(),confirmed:true};delete row.seenAt;row.mtimeMs=row.state.at;
  conversations.set(id,[{role:'user',text:'Send the September summary.'},{role:'assistant',blocks:[{t:'text',text:'The summary went to the warehouse team and the totals match the ledger.'},{t:'done',text}]}]);
 };
 let visit=0;const open=async(width,chat)=>{await page.setViewport({width,height:width<900?844:900});await page.goto(base+'/?complete='+width+'-'+(++visit)+'#/chat/'+chat);await page.waitForSelector('#msgs .m-asst');};
 const card=()=>page.$eval('#msgs',m=>{const c=m.querySelector('.done-card:not([hidden])');if(!c)return null;const r=c.getBoundingClientRect();return {title:c.querySelector('.done-title').textContent,sum:c.querySelector('.done-sum').textContent,act:c.querySelector('.done-act').textContent,name:c.getAttribute('aria-label'),tall:r.height>=44,inside:r.right<=innerWidth&&r.left>=0,last:c.closest('.m-asst')===[...m.querySelectorAll('.m-asst')].pop()};});
 const toastText=()=>page.$eval('#toast',t=>t.classList.contains('show')?t.textContent:null);
 const released=()=>releases.filter(p=>p.includes(id)).length;
 const until=async(fn,what)=>{for(let i=0;i<80&&!fn();i++)await new Promise(r=>setTimeout(r,50));assert.ok(fn(),what);}; // the seen marker uploads a moment after the tap
 try{
  console.log('Complete: the card under the latest reply, on a computer and a phone');
  for(const width of [1440,390]){
   complete();await open(width,id);await page.waitForSelector('.done-card:not([hidden])');
   assert.deepEqual(await card(),{title:'Complete',sum:SUMMARY,act:'Close conversation',name:'Complete: '+SUMMARY+'. Close conversation',tall:true,inside:true,last:true});
   assert.equal(await page.$('[data-choices]:not([hidden])'),null,'never beside reply buttons');
   await scan('card-'+width,'#msgs');
   await page.screenshot({path:path.join(out,'complete-card-'+width+'.png')});
  }
  console.log('Complete: the dark workbench');
  await page.evaluate(()=>PocketTheme.setPreference('dark'));await page.waitForFunction(()=>document.documentElement.dataset.theme!=='light');
  await scan('card-dark','#msgs');await page.screenshot({path:path.join(out,'complete-card-dark-390.png')});
  await page.evaluate(()=>PocketTheme.setPreference('light'));await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  console.log('Complete: no handoff offer under a finished conversation, however large');
  const prevAt=settings.handoffAt;settings.handoffAt=200000;
  try{complete();await open(1440,id);await page.waitForSelector('.done-card:not([hidden])');await page.waitForFunction(()=>document.getElementById('ctx-ring')?.dataset.tip?.includes('tokens'));
   await new Promise(r=>setTimeout(r,300));assert.equal(await page.$('.handoff-offer'),null);}finally{settings.handoffAt=prevAt;}
  await open(390,id);await page.waitForSelector('.done-card:not([hidden])');
  console.log('Complete: typing hides it, clearing brings it back');
  await page.type('#box','x');await page.waitForFunction(()=>!document.querySelector('.done-card:not([hidden])'));
  await page.$eval('#box',e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForSelector('.done-card:not([hidden])');

  console.log('Complete: a tap on a phone closes it and returns to the list');
  let before=released();
  await page.click('.done-card');await page.waitForFunction(()=>location.hash==='#/'||location.hash==='');
  assert.equal(released(),before+1,'its process is released');
  await until(()=>row.seenAt>=row.state.at,'reviewed on the server, so out of Attention on every device');
  assert.equal(await toastText(),'Conversation closedUndo');

  console.log('Complete: a tap on a computer closes the tab and opens New; Undo brings the conversation back');
  complete();await open(1440,id);await page.waitForSelector('.done-card:not([hidden])');
  await page.waitForSelector(`[data-close-session="${id}"]`);
  before=released();
  await page.click('.done-card');await page.waitForFunction(()=>location.hash==='#/new');
  assert.equal(released(),before+1);
  assert.equal(await page.$(`[data-close-session="${id}"]`),null,'its tab is gone');
  await page.waitForFunction(()=>document.querySelector('#toast.show .toast-act'));
  assert.ok(await page.$eval('#toast .toast-act',b=>b.getBoundingClientRect().height>=44),'Undo is a 44px target');
  await new Promise(r=>setTimeout(r,300));await page.screenshot({path:path.join(out,'complete-closed-1440.png')});
  await page.click('#toast .toast-act');await page.waitForFunction(h=>location.hash===h,{},'#/chat/'+id);
  await page.waitForSelector('.done-card:not([hidden])');
  assert.equal(await page.$('#toast .toast-act'),null,'the action leaves with the toast');

  console.log('Complete: no summary reads Nothing left to do');
  complete('');await open(1440,id);await page.waitForSelector('.done-card:not([hidden])');
  assert.equal((await card()).sum,'Nothing left to do');

  console.log('Complete: background work, or a newer message, means no card');
  complete();row.state={...row.state,kind:'background',label:'Working in background · 1 job',background:{count:1,summary:'1 job',jobs:[{kind:'job',description:'tests'}]}};
  await open(1440,id);await page.waitForFunction(()=>document.querySelector('[data-done]'));
  await new Promise(r=>setTimeout(r,400));assert.equal(await card(),null,'hidden while background jobs run');
  complete();conversations.get(id).push({role:'user',text:'One more thing.'},{role:'assistant',blocks:[{t:'text',text:'Looking at it now.'}]});
  await open(1440,id);await page.waitForFunction(()=>document.querySelector('[data-done]'));
  await new Promise(r=>setTimeout(r,400));assert.equal(await card(),null,'an earlier reply never shows its card');

  console.log('Complete: the list row says Complete with the outcome line, and closes in one tap');
  complete();await open(1440,other.id);
  const item=`.rail [data-item="${id}"]`;await page.waitForSelector(item+' [data-done-close]');
  assert.deepEqual(await page.$eval(item,e=>({status:e.querySelector('.session-status').textContent,detail:e.querySelector('.activity-detail').textContent,target:e.querySelector('[data-done-close]').getBoundingClientRect().height>=36})),{status:'CompleteNew',detail:SUMMARY,target:true});
  await page.evaluate(i=>rememberOpenSession({id:i,title:'Monthly warehouse summary'}),id);
  assert.match(await page.$eval(`.open-session a[href="#/chat/${id}"]`,a=>a.title),/· Complete$/,'the tab says Complete too');
  await scan('row-1440',item);
  await page.screenshot({path:path.join(out,'complete-row-1440.png')});
  before=released();
  await page.click(item+' [data-done-close]');
  await page.waitForFunction(i=>!document.querySelector(i+' [data-done-close]'),{},item);
  assert.equal(released(),before+1);await until(()=>row.seenAt>=row.state.at,'reviewed');
  assert.equal(await page.$(`[data-close-session="${id}"]`),null,'its tab closes with it');
  assert.equal(await page.evaluate(()=>location.hash),'#/chat/'+other.id,'the conversation you are in stays');
  assert.equal(await page.$eval(item+' .session-status',e=>e.textContent),'Recent','read: an ordinary recent conversation');
  console.log('Complete: Undo puts it back in Attention');
  await page.click('#toast .toast-act');await page.waitForSelector(item+' [data-done-close]');
  await until(()=>!(row.seenAt>=row.state.at),'the review is undone on the server');

  console.log('Complete: an ordinary finished reply has no close button and still says Response ready');
  row.state={kind:'finished',label:'Response ready',at:Date.now(),confirmed:true};delete row.seenAt;row.mtimeMs=row.state.at;
  await open(1440,other.id);await page.waitForFunction(i=>document.querySelector(i+' .session-status')?.textContent==='Response readyNew',{},item);
  assert.equal(await page.$(item+' [data-done-close]'),null);

  console.log('Complete: tapped inside a pane, the pane closes and the main conversation stays');
  complete();await open(1440,other.id);
  await page.evaluate(i=>openBeside(i),id);await page.waitForSelector('#panes iframe');
  const pane=await(await page.$('#panes iframe')).contentFrame();await pane.waitForSelector('.done-card:not([hidden])');
  before=released();
  await pane.click('.done-card');await page.waitForFunction(()=>!document.querySelector('#panes iframe'));
  assert.equal(released(),before+1);
  assert.equal(await page.evaluate(()=>location.hash),'#/chat/'+other.id);
  assert.equal(await toastText(),'Conversation closedUndo');
  await page.click('#toast .toast-act');await page.waitForSelector('#panes iframe');

  assert.deepEqual(errors,[]);
 } finally {
  row.state=saved.state;if(saved.seenAt)row.seenAt=saved.seenAt;else delete row.seenAt;conversations.set(id,saved.messages);
  await context.close();
 }
}
