// Browser checks for what the 1.124.5 flow test of lane a found and fixed (review 2026-11-23, flows-a-findings.md). Each
// one failed on the code before its fix. Runs on browser.mjs's synthetic server; the calls each check is about are answered
// here, so no real agent, account or transcript is involved.
//   POCKET_UIFIX_ONLY=1 [POCKET_CHECK=<part of a name>] node test/browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PHONE={width:390,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true};

export async function runFlowsAFixes({browser,base,rows,out}) {
 const checks=[],errors=[];
 const check=async(name,viewport,fn)=>{
  if(process.env.POCKET_CHECK&&!name.includes(process.env.POCKET_CHECK))return;
  const context=await browser.createBrowserContext(),page=await context.newPage();
  page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(name+': '+e.message));
  await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:'dark'}]);await page.setViewport(viewport);
  try{await fn(page);checks.push(name);}
  catch(e){await page.screenshot({path:path.join(out,'flows-a-fixes-failure.png')}).catch(()=>{});e.message=name+': '+e.message;throw e;}
  finally{await context.close();}
 };
 const intercept=async(page,handler)=>{
  await page.setRequestInterception(true);
  page.on('request',async r=>{if(r.isInterceptResolutionHandled())return;const u=new URL(r.url());try{if(await handler(r,u)!==true)await r.continue();}catch{}});
 };
 const json=(r,body,status=200)=>r.respond({status,contentType:'application/json',body:JSON.stringify(body)}).then(()=>true);
 const openChat=async(page,id)=>{await page.goto(base+'/#/chat/'+id);await page.waitForFunction(id=>chatId===id&&document.querySelector('#ctitle')?.textContent!=='Conversation'&&document.querySelector('#box'),{},id);};
 const idle=rows[4];

 // a-05: during a usage-limit wait the queue read "Paused" and offered Run next instruction, which ran into the limit.
 await check('a-05: the queue sheet says the queue waits for the usage-limit retry, and offers no Run next instruction',PHONE,async page=>{
  let retryAt=Date.now()+40*60_000;
  await intercept(page,async(r,u)=>{
   if(r.method()==='GET'&&u.pathname===`/api/session/${idle.id}/queue`)return json(r,{items:[{id:'q-1',sessionId:idle.id,text:'Queued behind the limit',status:'pending',revision:1}],active:false,external:false,...(retryAt?{retryAt}:{})});
  });
  await openChat(page,idle.id);
  await page.evaluate(id=>{openQueue(id);},idle.id);await page.waitForSelector('#queue-retry-wait');
  const v=await page.evaluate(()=>({row:document.querySelector('.queue-item .result-detail')?.textContent||'',note:document.querySelector('#queue-retry-wait').textContent,start:Boolean(document.querySelector('#queue-start'))}));
  assert.match(v.row,/^1 · After the usage-limit retry/,'the row says what it waits for, not "Paused"');
  assert.match(v.note,/^Waiting for the usage limit to reset\. Pocket retries the reply at \d{1,2}:\d{2}.*, then runs the queue\.$/);
  assert.equal(v.start,false,'Run next instruction is not offered');
  await page.screenshot({path:path.join(out,'flows-a-queue-usage-wait-390.png')});
  // with no retry waiting the queue is paused as before, and Run next instruction is there
  retryAt=null;await page.click('#queue-refresh');await page.waitForSelector('#queue-start');
  assert.match(await page.$eval('.queue-item .result-detail',e=>e.textContent),/^1 · Paused/);
  assert.equal(await page.$('#queue-retry-wait'),null);
 });

 // a-x-http-2: the Pause all sheet named Inbox Watch among what it stops; the toast after it left it out.
 await check('a-x-http-2: the toast after Pause all names Inbox Watch, as the sheet did',PHONE,async page=>{
  const stops={replies:{claude:1,codex:0,openrouter:0},jobs:0,background:0,retries:0,checkbacks:0,inboxWatch:true};
  let paused=null;
  await intercept(page,async(r,u)=>{
   if(u.pathname!=='/api/pause')return;
   if(r.method()==='POST'){paused={at:new Date().toISOString(),by:'owner'};return json(r,{ok:true,paused,stopped:stops});}
   return json(r,{paused,would:stops,held:{retries:0,checkbacks:0},ownMessages:'run',confirm:true});
  });
  await openChat(page,idle.id);
  await page.evaluate(()=>{Automation.pauseAll();});await page.waitForSelector('.pause-sheet [data-pause-would]');
  assert.equal(await page.$eval('[data-pause-would]',e=>e.textContent),'This stops 1 reply running (1 Claude), Inbox Watch.');
  await page.click('[data-pause-go]');
  await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.startsWith('Paused.'));
  assert.equal(await page.$eval('#toast',e=>e.textContent),'Paused. Stopped 1 reply running (1 Claude), Inbox Watch.');
 });

 assert.deepEqual(errors,[],'no page errors');
 fs.writeFileSync(path.join(out,'flows-a-fixes.json'),JSON.stringify({checks},null,2));
 console.log(JSON.stringify({flowsAFixes:checks.length,ok:true}));
}
