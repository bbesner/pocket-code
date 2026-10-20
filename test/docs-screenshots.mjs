// Current README assets, captured from the browser suite's synthetic API fixture (no real sessions or model calls).
// 1.37: the full set: the desktop split hero and phone conversation, plus Projects, Files, Tasks and the
// suggested-reply buttons with a task offer. Projects, Files and Tasks are switched on for the capture only.
// 1.70: Assistant mode's home and Inbox Watch (the list and its Schedule, models and cost sheet), with made-up entries.
import fs from 'node:fs';
import path from 'node:path';

export async function captureDocs({browser,base,rows,dir,conversations,settings,inboxStore}) {
 fs.mkdirSync(dir,{recursive:true});
 const savedSettings={...settings};
 if(settings)Object.assign(settings,{projects:true,documents:true,tasks:true,vault:true});
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
  // The Vault (1.39): a request waiting for the owner above the secrets, names in monospace.
  await shot('vault-desktop.png',{withoutRail:true,width:1440,height:900,url:'/#/vault',prep:async page=>{await page.waitForSelector('.vault-item');}});
  // 1.70: Inbox Watch and Assistant mode, with invented entries (the suite's own fixture stays as it is).
  if(inboxStore&&settings){
   const saved={entries:inboxStore.entries,watch:structuredClone(inboxStore.watch)};
   try{
    inboxStore.entries=[];
    const lk=inboxStore.add({kind:'lookahead',priority:'high',title:'Look-ahead · Tue 8 AM',text:'Two things worth catching today: the Lakeside quote expires at 5 p.m., and the insurance renewal form still needs a signature. [Quote](msg:3c4d5e6f7081) · [Renewal](msg:4d5e6f708192)',source:'inbox-monitor'},{actor:'cli'});
    const dg=inboxStore.add({kind:'digest',priority:'low',title:'Morning email digest · Tue Oct 20',text:'## Worth knowing\n- Harbor Supply: invoice 4471 for $1,240 is due Friday.\n- Two new website leads asked for quotes.\nIgnored since the last digest: 96 threads.',source:'inbox-monitor',doc:'0a1b2c3d4e5f'},{actor:'cli'});
    inboxStore.add({kind:'alert',priority:'high',title:'Northgate gate camera offline again',text:'The Northgate gate camera went offline at 6:12 a.m., the third time this week, and Tuesday’s service report says the power supply was replaced. [Offline notice](msg:1a2b3c4d5e6f) · [Service report](msg:2b3c4d5e6f70) Someone should check whether the new supply is failing before tonight.',story:'northgate-gate-camera',source:'inbox-monitor',url:'/#/start/0123456789ab'},{actor:'cli'});
    inboxStore.act({action:'open',id:lk.id});inboxStore.act({action:'open',id:dg.id});
    inboxStore.setWatch('inbox-monitor',{paused:false,every:10,periods:[{name:'Work hours',days:[0,1,2,3,4],from:'07:00',to:'19:00',every:5},{name:'Overnight',days:[0,1,2,3,4,5,6],from:'22:00',to:'07:00',every:30}],
     quietHours:[22,8],digestHour:8,lookahead:{morning:8,evening:17},models:{decisions:{model:'sonnet',reasoning:'medium'},lookahead:{model:'opus',reasoning:'medium'}},firstPass:{enabled:true,provider:'jev',threshold:0.8},tidy:{enabled:true,every:2}});
    const pr=inboxStore.profiles['inbox-monitor']?.profile;if(pr){pr.applied={from:'pocket',revision:inboxStore.watch['inbox-monitor'].revision};Object.assign(pr.status,{every:5,period:'Work hours'});}
    Object.assign(settings,{inbox:true});
    await shot('inbox-mobile.png',{mobile:true,url:'/#/inbox',prep:async page=>{await page.waitForSelector('.inbox-view .inbox-item');}});
    const sheet=async(page,scrollTo)=>{await page.waitForSelector('#inbox-watch');await page.click('#inbox-watch');await page.waitForSelector('.watch-sheet #w-save');
     await page.waitForFunction(()=>[...document.querySelectorAll('.watch-sheet')].every(e=>e.getAnimations({subtree:true}).every(a=>a.playState==='finished')));
     if(scrollTo)await page.evaluate(s=>{const sh=document.querySelector('.watch-sheet'),el=document.querySelector(s);sh.scrollTop=el.offsetTop-12;},scrollTo);};
    await shot('inbox-watch-schedule-mobile.png',{mobile:true,url:'/#/inbox',prep:page=>sheet(page,null)});
    await shot('inbox-watch-models-mobile.png',{mobile:true,url:'/#/inbox',prep:page=>sheet(page,'[aria-labelledby="w-fp-h"]')});
    settings.assistantMode=true;
    await shot('assistant-home-mobile.png',{mobile:true,url:'/#/',prep:async page=>{await page.waitForSelector('.assistant-home');await page.waitForSelector('#home-waiting .inbox-card');}});
    await shot('assistant-home-desktop.png',{width:1440,height:900,url:'/#/',prep:async page=>{await page.waitForSelector('.assistant-home');await page.waitForSelector('#home-waiting .inbox-card');}});
   } finally {inboxStore.entries=saved.entries;inboxStore.watch=saved.watch;inboxStore.save();settings.assistantMode=false;}
  }
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
