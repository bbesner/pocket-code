// Browser checks for what the 1.124.5 flow tests (lane b) found and fixed. Each one failed on the code before its fix.
// Runs on browser.mjs's synthetic server (fixtures only); the API answers a check needs are intercepted on its page.
//   POCKET_UIFIX_ONLY=1 [POCKET_CHECK=<part of a name>] node test/browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PHONE={width:390,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true};

export async function runFlowsBFixes({browser,base,rows,out,settingsState=()=>({}),coord=null}) {
 const checks=[],errors=[];
 // Each check gets its own browser context, and is drawn in dark and light at phone size (screenshots in `out`).
 const check=async(name,viewport,fn)=>{
  if(process.env.POCKET_CHECK&&!name.includes(process.env.POCKET_CHECK))return;
  for(const scheme of ['dark','light']){
   const context=await browser.createBrowserContext(),page=await context.newPage();
   page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(name+': '+e.message));
   await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:scheme}]);await page.setViewport(viewport);
   const shot=async tag=>page.screenshot({path:path.join(out,`flows-b-${tag}-${scheme}.png`)});
   try{await fn(page,shot);}
   catch(e){await page.screenshot({path:path.join(out,'flows-b-failure.png')}).catch(()=>{});e.message=`${name} (${scheme}): ${e.message}`;throw e;}
   finally{await context.close();}
  }
  checks.push(name);
 };
 const intercept=async(page,handler)=>{
  await page.setRequestInterception(true);
  page.on('request',async r=>{if(r.isInterceptResolutionHandled())return;const u=new URL(r.url());try{if(await handler(r,u)!==true)await r.continue();}catch{}});
 };
 const json=(r,body,status=200)=>r.respond({status,contentType:'application/json',body:JSON.stringify(body)});
 const withSettings=async(patch,fn)=>{const settings=settingsState(),saved={...settings};Object.assign(settings,patch);
  try{await fn();}finally{for(const k of Object.keys(settings))delete settings[k];Object.assign(settings,saved);}};
 const touchTargets=(page,sel)=>page.$$eval(sel,els=>els.map(e=>Math.round(e.getBoundingClientRect().height)));

 // b-18: a free name that still has a line, or was offered lately, shows in Coordination with who was told.
 if(coord)await check('Coordination: a free name with a line shows who was offered it, that its start is held, and who waits',PHONE,(page,shot)=>withSettings({coordination:true},async()=>{
  const now=Date.now();
  await intercept(page,async(r,u)=>{
   if(u.pathname==='/api/coordination'){await json(r,{now,seeds:[],holds:[],recent:[],free:[{name:'staging-db',offer:{session:rows[1].id,title:'Migrate staging DB',at:now-2*60000-5000,held:true},
    waiters:[{id:'w9',kind:'conversation',session:rows[2].id,title:'Seed demo data',at:now-5*60000,block:false}]}]});return true;}
  });
  await page.goto(base+'/#/coordination');await page.waitForSelector('.coord-free');
  const row=await page.$eval('.coord-free',e=>({name:e.querySelector('.coord-name').textContent,who:e.querySelector('.coord-who').textContent,why:e.querySelector('.coord-why').textContent.replace(/\s+/g,' ').trim(),time:e.querySelector('.coord-time').textContent,wait:e.querySelector('.coord-wait').textContent,button:Boolean(e.querySelector('button')),width:e.scrollWidth<=e.clientWidth}));
  assert.deepEqual(row,{name:'staging-db',who:'Free',why:'Offered to Migrate staging DB. Its start is held, so the next in line may have it.',time:'2m',wait:'1 waiting: "Seed demo data"',button:false,width:true});
  assert.ok(await page.$('.project-empty'),'"Nothing is held" still says nothing is held');
  for(const h of await touchTargets(page,'.coord-free .coord-who a, .coord-free .coord-why a'))assert.ok(h>=44,'the conversation link is a 44px target: '+h);
  await shot('coordination-free');
 }));

 assert.deepEqual(errors,[],'no page errors');
 fs.writeFileSync(path.join(out,'ui-flows-b.json'),JSON.stringify({checks},null,2));
 console.log(JSON.stringify({flowsBFixes:checks.length,ok:true}));
}
