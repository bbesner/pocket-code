// Current README assets, captured from the browser suite's synthetic API fixture (no real sessions or model calls).
// 1.37: the full set: the desktop split hero and phone conversation, plus Projects, Files, Tasks and the
// suggested-reply buttons with a task offer. Projects, Files and Tasks are switched on for the capture only.
import fs from 'node:fs';
import path from 'node:path';

export async function captureDocs({browser,base,rows,dir,conversations,settings}) {
 fs.mkdirSync(dir,{recursive:true});
 const savedSettings={...settings};
 if(settings)Object.assign(settings,{projects:true,documents:true,tasks:true});
 const offerId=rows[4].id,savedConversation=conversations?.get(offerId),savedRow={title:rows[4].title,cwd:rows[4].cwd};
 const shot=async(name,{mobile=false,width=1600,height=1000,url,prep,withoutRail=false})=>{
  const context=await browser.createBrowserContext(),page=await context.newPage();
  try {
   await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
   await page.setViewport(mobile?{width:390,height:844,isMobile:true,hasTouch:true}:{width,height});
   await page.goto(base+url);
   await prep(page);
   await page.mouse.move(0,0);await page.evaluate(()=>{if(typeof hideTip==='function')hideTip();document.activeElement?.blur?.();});
   await new Promise(r=>setTimeout(r,250));
   // Library shots leave out the session rail (the hero already shows it), so the content reads at half width.
   const clip=withoutRail?await page.evaluate(()=>{const r=document.querySelector('main.scroll')?.closest('.view,section,main')?.getBoundingClientRect()||document.querySelector('#projects-main,#documents-main')?.getBoundingClientRect();const x=Math.max(0,Math.round(r?.left??0));return {x,y:0,width:innerWidth-x,height:innerHeight};}):null;
   await page.screenshot({path:path.join(dir,name),...(clip&&clip.x>0?{clip}:{})});
  } finally {await context.close();}
 };
 try {
  // Hero: the session rail (Sessions | Projects | Files | Tasks) beside two conversations in split view.
  await shot('desktop-split.png',{url:'/#/chat/'+rows[3].id,prep:async page=>{
   await page.waitForSelector('#box');await page.type('#box','Check incoming stock before preparing the order.');
   await page.click('#splitb');await page.click(`[data-v="${rows[0].id}"]`);
   await page.waitForSelector('#panes iframe');const frame=await(await page.$('#panes iframe')).contentFrame();await frame.waitForSelector('#box');
  }});
  // Phone: one conversation with the composer.
  await shot('mobile-workspace.png',{mobile:true,url:'/#/chat/'+rows[3].id,prep:async page=>{
   await page.waitForSelector('#box');await page.type('#box','Check incoming stock before preparing the order.');
   await page.evaluate(()=>{document.querySelector('#box').blur();document.querySelector('main.scroll').scrollTop=0;});
  }});
  // Projects: the board with a project open.
  await shot('projects-desktop.png',{withoutRail:true,width:1440,height:900,url:'/#/projects/warehouse-stock-report',prep:async page=>{await page.waitForSelector('.project-card');}});
  // Files: the library as a list: kind, sharing state and the project or session each file came from.
  await shot('files-desktop.png',{withoutRail:true,width:1440,height:900,url:'/#/documents',prep:async page=>{
   await page.evaluate(()=>localStorage.setItem('pc-documents-layout','"list"'));await page.reload();await page.waitForSelector('.document-item');
  }});
  // Tasks on a phone: due first, the one from a session carries its briefing.
  await shot('tasks-mobile.png',{mobile:true,url:'/#/tasks',prep:async page=>{await page.waitForSelector('.task-item');}});
  // A reply that ends with suggested-reply buttons, one of them the agent's task offer (1.37).
  if(conversations){
   Object.assign(rows[4],{title:'Checkout page release',cwd:'/workspaces/storefront'});
   conversations.set(offerId,[{role:'user',text:'Deploy the new checkout page, then tell me where we are.'},
    {role:'assistant',blocks:[{t:'text',text:'The new checkout page is live and the cache has been re-warmed.\n\nSearch Console averages the last 28 days, so the speed improvement will show up gradually. Around **November 7** is a good time to recheck the mobile numbers.\n\nWant a reminder for then?'},
     {t:'choices',options:['Remind me Nov 7 to recheck the numbers','Check the cart page next','No reminder'],rec:0}]}]);
   await shot('task-offer-mobile.png',{mobile:true,url:'/#/chat/'+offerId,prep:async page=>{
    await page.evaluate(()=>{localStorage.removeItem('pc-choices-dismissed');});
    await page.waitForSelector('.choices:not([hidden])');await page.$eval('.choices',e=>e.scrollIntoView({block:'end'}));
   }});
  }
 } finally {
  if(settings){for(const k of Object.keys(settings))delete settings[k];Object.assign(settings,savedSettings);}
  if(conversations&&savedConversation)conversations.set(offerId,savedConversation);
  Object.assign(rows[4],savedRow);
 }
}
