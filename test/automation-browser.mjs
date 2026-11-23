// 1.117 unattended work foundation, the app half: Pause all (the More menu, the switcher, the confirmation sheet, the
// banner and Resume, a second device catching up, a blocked own message keeping its draft), Settings → Automation
// rendered from the server's groups (save, range error, No limit and its warning, Reset to defaults, Advanced
// collapsed, usage and notices) and the origin label on a list row and in the chat. Runs inside test/browser.mjs, or
// alone with POCKET_AUTOMATION_ONLY=1. The settings half is built from automation.mjs itself (see below); the same flows run
// against the real server in test/automation-live-browser.mjs.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {clickControl} from './ui-controls.mjs';
import * as auto from '../automation.mjs';

const DAY=86400000;
// The settings, their effective values, the warnings, the range errors and the notice words come from automation.mjs,
// the module the server builds GET /api/automation and POST /api/automation/settings from, so this fixture cannot drift
// from the server. One env preset stands in for an install's own default (POCKET_AUTOMATION_LONGEST_REPLY).
const ENV={POCKET_AUTOMATION_LONGEST_REPLY:'60'};
export const automationFixture={
 paused:null,saved:{},posts:[],resumeInbox:null,
 // 1.119: heldCheckbacks (the banner's count), resumeCheckbacks (Resume's { run, missed }) and checkbackSummary (set by
 // test/checkback-browser.mjs: GET /api/automation's `checkbacks`).
 heldCheckbacks:0,resumeCheckbacks:null,checkbackSummary:null,
 would:{replies:{claude:2,codex:1,openrouter:0},background:2,retries:1,checkbacks:0,inboxWatch:true},
 reset(){this.paused=null;this.saved={};this.posts=[];this.resumeInbox=null;this.heldCheckbacks=0;this.resumeCheckbacks=null;this.would={...this.would,checkbacks:0};},
 value(group,key){return auto.groupValues(this.saved,group,ENV)[key];},
 me(){return this.paused?{at:this.paused.at}:null;},
 // GET /api/pause; banner() is the part /api/sessions carries (test/browser.mjs), as the server builds both
 banner(){return {paused:this.paused,held:this.paused?{retries:1,checkbacks:this.heldCheckbacks}:{retries:0,checkbacks:0},ownMessages:this.value('pause','ownMessages'),confirm:this.value('pause','confirm')};},
 pause(){const b=this.banner();return {paused:b.paused,would:this.would,held:b.held,ownMessages:b.ownMessages,confirm:b.confirm};},
 automation(){
  const now=Date.now(),d=auto.describe(this.saved,ENV);
  const days=Array.from({length:7},(_,i)=>({date:new Date(now-(6-i)*DAY).toISOString().slice(0,10),replies:[0,1,8,2,0,5,3][i],cost:[0,0.05,1.2,0.31,0,0.88,0.42][i],tokens:[0,12000,410000,90000,0,260000,120000][i]}));
  const n=auto.noticeFor({ok:false,reason:'plan_ceiling',engine:'claude',window:'weekly',used:83,ceiling:80});
  return {paused:this.paused,groups:d.groups,warnings:d.warnings,notices:[{reason:n.reason,engine:n.engine,at:new Date(now-2*3600000).toISOString(),text:n.text}],
   usage:{today:{replies:3,cost:0.42,tokens:120000},days},checkbacks:this.checkbackSummary?.()||{on:this.value('checkbacks','checkbacks')===true,pending:0,running:0}};
 },
 // The server's own all-or-nothing check: a refused value saves nothing and names the allowed range.
 save(body){const r=auto.applySave(this.saved,body);if(r.error)return {status:r.status||400,body:{error:r.error}};this.saved=r.automation;return {status:200};},
};
// Answers the 1.117 routes; false when the request is not one of them.
export async function automationRoute(req,url,json){
 const f=automationFixture,body=async()=>{let raw='';for await(const c of req)raw+=c;return JSON.parse(raw||'{}');};
 if(url.pathname==='/api/pause'&&req.method==='GET'){json(f.pause());return true;}
 if(url.pathname==='/api/pause'&&req.method==='POST'){await body();f.posts.push('pause');f.paused=f.paused||{at:new Date().toISOString(),by:'owner'};json({ok:true,paused:f.paused,stopped:f.would});return true;}
 if(url.pathname==='/api/resume'&&req.method==='POST'){await body();f.posts.push('resume');f.paused=null;json({ok:true,paused:null,rearmed:1,inboxWatch:f.resumeInbox,...(f.resumeCheckbacks?{checkbacks:f.resumeCheckbacks}:{})});return true;}
 if(url.pathname==='/api/automation'){json(f.automation());return true;}
 if(url.pathname==='/api/automation/settings'){const b=await body();f.posts.push(b);const r=f.save(b);json(r.status===200?f.automation():r.body,r.status);return true;}
 return false;
}
// An owner send while paused with own messages Blocked: 409, as /api/new and /api/session/:id/message answer.
export const pauseRefusal=()=>automationFixture.paused&&automationFixture.value('pause','ownMessages')==='blocked'?{error:'Pocket is paused. Resume to send.',paused:true}:null;

const axeCheck=async(p,repo,sel)=>{if(!await p.evaluate(()=>typeof axe!=='undefined'))await p.addScriptTag({path:path.join(repo,'node_modules/axe-core/axe.min.js')});assert.deepEqual(await p.evaluate(async s=>{const result=await axe.run(s);return result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));},sel),[]);};
const theme=(p,mode)=>p.evaluate(m=>PocketTheme.setPreference(m),mode);

export async function runAutomationRegressions({p,base,out,repo,rows,settings,scan}){
 const f=automationFixture;f.reset();
 const shots=process.env.POCKET_AUTOMATION_SHOTS||'/tmp/unattended-1.117-shots';fs.mkdirSync(shots,{recursive:true});
 const shot=async name=>{await p.screenshot({path:path.join(shots,name+'.png')});await p.screenshot({path:path.join(out,'automation-'+name+'.png')});if(scan)await scan('automation-'+name);};
 const home=async()=>{await p.goto(base+'/#/all');await p.waitForSelector('.session-home');};
 const bannerShown=()=>p.$eval('.pause-banner',()=>true).catch(()=>false);
 const openAutomation=async()=>{await clickControl(p,'#settings');await p.waitForSelector('.settings-sheet [data-settings-category="automation"]');await p.click('[data-settings-category="automation"]');await p.waitForSelector('[data-auto-group="limits"] [data-auto-key="claudeWeekly"]');};
 const input=key=>`[data-auto-key="${key}"]`;
 const setNumber=async(key,v)=>{await p.$eval(input(key),(e,v)=>{e.focus();e.value=String(v);e.dispatchEvent(new Event('change'));},v);};
 // The pause check with nothing changed, both ways it comes: the list refresh's own `pause` (no request) and the return
 // to the tab (GET /api/pause). The list rows, the banner, the header and the Pause all controls stay the same nodes,
 // nothing in the page is written, and the only requests are the three GET /api/pause. The app's own 5-second list
 // refresh is held still for the window, so only the checks run.
 const quietRefresh=()=>p.evaluate(async()=>{
  if(sessionFetch)await sessionFetch;
  const realRefresh=window.refreshSessions,realFetch=window.fetch,urls=[],listPause=sessionsPause;
  window.refreshSessions=async()=>{};window.fetch=(u,...a)=>{urls.push(new URL(String(u),location.href).pathname);return realFetch(u,...a);};
  const nodes=[...document.querySelectorAll('[data-item], [data-item] *, .pause-banner, .pause-banner *, header.bar, header.bar *, [data-pause-toggle], [data-pause-toggle] *')];
  const records=[],mo=new MutationObserver(r=>records.push(...r));
  mo.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});
  try{for(let i=0;i<3;i++){await Automation.fromList(listPause);await Automation.poll(true);}await new Promise(r=>setTimeout(r,60));records.push(...mo.takeRecords());}
  finally{mo.disconnect();window.fetch=realFetch;window.refreshSessions=realRefresh;}
  const ticking=n=>(n.nodeType===1?n:n.parentElement)?.closest?.('[data-run-age]');   // a running row's age ticks on its own
  return {nodes:nodes.length,kept:nodes.every(n=>n.isConnected),urls,listPause,
   writes:records.filter(r=>!ticking(r.target)).map(r=>`${r.type} ${r.target.nodeName}${r.target.id?'#'+r.target.id:''}${r.attributeName?' @'+r.attributeName:''}`)};
 });
 const assertQuiet=async(where)=>{const q=await quietRefresh();assert.ok(q.nodes>0,where);assert.equal(q.kept,true,`${where}: the same nodes stay`);
  assert.ok(q.listPause&&'paused' in q.listPause,`${where}: the list carried the pause state`);
  assert.deepEqual(q.writes,[],`${where}: nothing written`);assert.deepEqual(q.urls,['/api/pause','/api/pause','/api/pause'],`${where}: one request per return to the tab, none from the list, and no list or summary fetch`);};
 // The app's real list refresh asks for the list only: the banner's state comes with it, not from GET /api/pause.
 // (It waits out the 4.5 s a /api/pause check is held back for, so a refresh that still asked would show here.)
 const listOnlyRefresh=async(where)=>{
  await new Promise(r=>setTimeout(r,4600));
  const urls=await p.evaluate(async()=>{if(sessionFetch)await sessionFetch;const realFetch=window.fetch,urls=[];
   window.fetch=(u,...a)=>{urls.push(new URL(String(u),location.href).pathname);return realFetch(u,...a);};
   try{await refreshSessions();await new Promise(r=>setTimeout(r,100));}finally{window.fetch=realFetch;}return urls;});
  assert.ok(urls.includes('/api/sessions'),`${where}: the list was fetched`);assert.ok(!urls.includes('/api/pause'),`${where}: no separate pause request (${urls.join(', ')})`);};
 await p.setViewport({width:1440,height:900,isMobile:false,hasTouch:false});await home();
 const themeBefore=await p.evaluate(()=>PocketTheme.preference);await theme(p,'dark');

 // --- Settings → Automation renders the server's groups; a category in both modes ---
 await openAutomation();
 assert.deepEqual(await p.$$eval('[data-auto-group]',e=>e.map(x=>x.dataset.autoGroup)),['pause','limits','checkbacks','jobs']); // 1.119; job keys (test/jobkeys-browser.mjs): Check-backs (test/checkback-browser.mjs)
 assert.deepEqual(await p.$$eval('[data-auto-group] > h3',e=>e.map(x=>x.textContent)),['Pause all','Limits on unattended work','Check-backs','Job keys']);
 assert.match(await p.$eval('#s-automation [data-pause-toggle]',e=>e.textContent),/^Pause allRunning normally\./);
 assert.equal(await p.$eval('[data-auto-advanced="limits"]',e=>e.open),false,'Advanced starts collapsed');
 assert.equal(await p.$eval(input('staleHours'),e=>e.checkVisibility()),false,'an advanced setting is under Advanced');
 assert.equal(await p.$eval(input('confirm'),e=>e.getAttribute('aria-pressed')),'true');
 assert.equal(await p.$eval(input('ownMessages'),e=>e.value),'run');
 assert.match(await p.$eval('[data-auto-row="longestReply"] .title-note',e=>e.textContent),/5 min to 480 min, or No limit\. Preset on this server\./);
 assert.equal(await p.$$eval('.automation-usage tbody tr',e=>e.length),7);
 assert.deepEqual(await p.$$eval('.automation-usage tbody tr td:first-of-type',e=>e.map(x=>x.textContent)),['3','5','0','2','8','1','0'],'newest day first');
 assert.equal(await p.$eval('[data-auto-today]',e=>e.textContent),'Today: 3 replies · $0.42 · 120K tokens');
 assert.match(await p.$eval('.automation-notices li',e=>e.textContent),/Claude Code weekly window is at 83%, over the 80% ceiling\./);
 assert.ok((await p.$$eval('#s-automation button, #s-automation .automation-input',e=>e.filter(x=>x.checkVisibility()).map(x=>x.getBoundingClientRect().height))).every(h=>h>=44),'44px controls');
 await shot('settings-1440-dark');await axeCheck(p,repo,'.settings-sheet');
 // Saves a value.
 await setNumber('claudeWeekly',70);
 await p.waitForFunction(()=>document.querySelector('[data-auto-status="limits"]')?.textContent==='Saved.');
 assert.equal(f.saved.limits.claudeWeekly,70);assert.equal(await p.$eval(input('claudeWeekly'),e=>e.value),'70');
 assert.equal(await p.evaluate(()=>document.activeElement?.dataset.autoKey),'claudeWeekly','focus stays on the field across the repaint');
 // A value out of range: the server's message beside the field, the old value back, nothing saved.
 await setNumber('claudeWeekly',150);
 await p.waitForFunction(()=>document.querySelector('#auto-limits-claudeWeekly-err')?.textContent);
 assert.equal(await p.$eval('#auto-limits-claudeWeekly-err',e=>e.textContent),'Plan ceiling, weekly (Claude Code) must be 10% to 100%, or No limit.');
 assert.equal(await p.$eval(input('claudeWeekly'),e=>e.value),'70');assert.equal(await p.$eval(input('claudeWeekly'),e=>e.getAttribute('aria-invalid')),'true');
 assert.equal(f.saved.limits.claudeWeekly,70);
 await shot('settings-error-1440-dark');
 // No limit: the field empties, and the warning shows while it is off.
 assert.equal(await p.$('.automation-warning'),null);
 await p.click('[data-auto-off="dailyReplies"]');
 await p.waitForSelector('.automation-warning');
 assert.equal(f.saved.limits.dailyReplies,'off');
 assert.equal(await p.$eval('.automation-warning',e=>e.textContent),'Unattended replies per day has no limit.');
 assert.equal(await p.$eval(input('dailyReplies'),e=>e.disabled),true);assert.equal(await p.$eval('[data-auto-off="dailyReplies"]',e=>e.getAttribute('aria-pressed')),'true');
 await shot('settings-off-1440-dark');
 // A switch and a choice save too.
 await p.click(input('countOwnerWork'));await p.waitForFunction(()=>document.querySelector('[data-auto-key="countOwnerWork"]').getAttribute('aria-pressed')==='true');
 assert.equal(f.saved.limits.countOwnerWork,true);
 // Reset to defaults: every saved value in the group goes, and the warning with it.
 await p.click('[data-auto-reset="limits"]');
 await p.waitForFunction(()=>document.querySelector('[data-auto-status="limits"]')?.textContent==='Back to the defaults.');
 assert.equal(f.saved.limits,undefined);assert.equal(await p.$eval(input('claudeWeekly'),e=>e.value),'80');assert.equal(await p.$('.automation-warning'),null);
 assert.equal(await p.$eval(input('countOwnerWork'),e=>e.getAttribute('aria-pressed')),'false');
 await p.keyboard.press('Escape');

 // --- Origin labels: a list row and the chat say who started the newest reply ---
 const retryRow=rows[3],jobRow=rows[4];retryRow.lastOrigin='retry';jobRow.lastOrigin='job';jobRow.lastOriginRef='disk-alert';
 await home();await p.waitForFunction(id=>document.querySelector(`[data-item="${id}"] .origin-label`),{},retryRow.id);
 assert.equal(await p.$eval(`[data-item="${retryRow.id}"] .origin-label`,e=>e.textContent),'Continued after a usage limit');
 assert.equal(await p.$eval(`[data-item="${jobRow.id}"] .origin-label`,e=>e.textContent),'Started by job disk-alert');
 assert.equal(await p.$(`[data-item="${rows[0].id}"] .origin-label`),null,'owner work has no label');
 await p.goto(base+'/#/chat/'+retryRow.id);await p.waitForFunction(()=>document.querySelector('#origin-line')?.hidden===false);
 assert.equal(await p.$eval('#origin-line',e=>e.textContent),'Continued after a usage limit');

 // --- A pause check with nothing changed touches nothing (the list, then with the More menu open) ---
 await home();await p.waitForSelector('[data-item]');await assertQuiet('the list, not paused');await listOnlyRefresh('the list, not paused');

 // --- Pause all from the More menu: the confirmation lists what will stop; Keep running returns focus ---
 f.posts.length=0;await home();
 await p.click('#listmore');await p.waitForSelector('.more-menu [data-pause-toggle]');
 await assertQuiet('the More menu, not paused');
 await p.click('.more-menu [data-pause-toggle]');await p.waitForSelector('.pause-sheet [data-pause-would]');
 assert.equal(await p.$eval('[data-pause-would]',e=>e.textContent),'This stops 3 replies running (2 Claude, 1 Codex), 2 background jobs, Inbox Watch. It holds 1 usage-limit retry.');
 assert.match(await p.$eval('.pause-sheet .sheet-help',e=>e.textContent),/^Your own messages still run\./);
 assert.equal(await p.evaluate(()=>document.activeElement?.dataset.pauseGo!==undefined),true,'Pause all has focus');
 await shot('confirm-1440-dark');await axeCheck(p,repo,'.pause-sheet');
 await p.click('[data-pause-keep]');await p.waitForFunction(()=>!document.querySelector('.pause-sheet'));
 assert.equal(await p.evaluate(()=>document.activeElement?.id),'listmore','focus returns to the opener');
 assert.equal(f.paused,null);assert.equal(await bannerShown(),false);
 // Pausing: the banner across the top, and the composer does not move.
 await p.goto(base+'/#/chat/'+rows[4].id);await p.waitForSelector('#box');
 const composerBefore=await p.$eval('.composerwrap',e=>e.getBoundingClientRect().bottom);
 await p.keyboard.down('Control');await p.keyboard.press('k');await p.keyboard.up('Control');
 await p.waitForSelector('.session-switcher [data-pause-toggle]');
 assert.match(await p.$eval('.session-switcher [data-pause-toggle]',e=>e.textContent),/^Pause all/);
 await p.click('.session-switcher [data-pause-toggle]');await p.waitForSelector('[data-pause-go]');
 await p.click('[data-pause-go]');await p.waitForSelector('.pause-banner');
 assert.deepEqual(f.posts,['pause']);
 await p.waitForFunction(()=>document.querySelector('#toast')?.textContent==='Paused. Stopped 3 replies running (2 Claude, 1 Codex), 2 background jobs, Inbox Watch. Held 1 usage-limit retry.');
 assert.equal(await p.$eval('.pause-banner .pause-text',e=>e.textContent),'Pocket is paused. Your own messages still run. 1 usage-limit retry is held.');
 assert.equal(await p.$eval('.composerwrap',e=>e.getBoundingClientRect().bottom),composerBefore,'the composer stays put');
 assert.ok(await p.$eval('.pause-resume',e=>e.getBoundingClientRect().height>=44));
 assert.equal(await p.evaluate(()=>document.documentElement.scrollHeight<=innerHeight),true,'nothing pushed below the window');
 await shot('banner-1440-dark');await axeCheck(p,repo,'.pause-banner');
 // Every Pause all control reads Resume while paused.
 await p.keyboard.down('Control');await p.keyboard.press('k');await p.keyboard.up('Control');
 await p.waitForSelector('.session-switcher [data-pause-toggle]');assert.match(await p.$eval('.session-switcher [data-pause-toggle]',e=>e.textContent),/^Resume/);
 await p.keyboard.press('Escape');
 // Resume from the banner: it goes, and the server was told. Inbox Watch was changed while paused, so the toast says it
 // is still paused.
 f.resumeInbox='left_paused';
 const askedBeforeResume=await p.evaluate(()=>performance.now());
 await p.click('.pause-banner [data-resume]');await p.waitForFunction(()=>!document.querySelector('.pause-banner'));
 assert.deepEqual(f.posts,['pause','resume']);assert.equal(f.paused,null);
 await p.waitForFunction(()=>document.querySelector('#toast')?.textContent==='Resumed. 1 held retry runs again. Inbox Watch was changed while paused and is still paused.');
 // A list refresh asked for before Resume was answered still says paused: it is not applied, so the banner does not flicker back.
 assert.equal(await p.evaluate(async t=>{await Automation.fromList({paused:{at:new Date().toISOString(),by:'owner'},held:{retries:1,checkbacks:0},ownMessages:'run',confirm:true},t);return Boolean(document.querySelector('.pause-banner'));},askedBeforeResume),false,'a list asked for before Resume leaves the banner gone');
 await shot('resume-inbox-1440-dark');f.resumeInbox=null;
 // A second device paused it: this one catches up on its next check (return to the tab here).
 f.paused={at:new Date().toISOString(),by:'owner'};
 await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.waitForSelector('.pause-banner');
 await p.waitForFunction(()=>/1 usage-limit retry is held/.test(document.querySelector('.pause-banner .pause-text')?.textContent||''));
 await assertQuiet('a conversation with the banner, paused');
 await p.keyboard.down('Control');await p.keyboard.press('k');await p.keyboard.up('Control');
 await p.waitForSelector('.session-switcher [data-pause-toggle]');await p.waitForSelector('.session-switcher [data-item]');
 await assertQuiet('the switcher, paused');await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('.session-switcher'));
 // The list refresh alone brings a second device's Resume and Pause all (no return to the tab, no /api/pause).
 await listOnlyRefresh('paused');
 const pausedAt=f.paused;f.paused=null;await p.evaluate(()=>refreshSessions());await p.waitForFunction(()=>!document.querySelector('.pause-banner'));
 f.paused=pausedAt;await p.evaluate(()=>refreshSessions());await p.waitForSelector('.pause-banner');
 // Own messages Blocked: the banner says so, a send is refused with a clear message and the draft is kept.
 f.saved={...f.saved,pause:{...f.saved.pause,ownMessages:'blocked'}};await p.evaluate(()=>Automation.poll(true));
 await p.waitForFunction(()=>/wait until you resume/.test(document.querySelector('.pause-banner .pause-text')?.textContent||''));
 await p.$eval('#box',e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));}); // an earlier check's draft may still be here
 await p.type('#box','Recount aisle 4 while paused');await p.click('#send');
 await p.waitForFunction(()=>/Pocket is paused/.test(document.querySelector('#delivery-status')?.textContent||''));
 assert.equal(await p.$eval('#box',e=>e.value),'Recount aisle 4 while paused','the draft stays');
 await shot('blocked-1440-dark');
 // Resume, and with the confirmation switched off Pause all acts on one tap.
 await p.click('.pause-banner [data-resume]');await p.waitForFunction(()=>!document.querySelector('.pause-banner'));
 await p.$eval('#discard-message',e=>e.click()).catch(()=>{});
 f.saved={...f.saved,pause:{confirm:false}};
 await home();await p.click('#listmore');await p.waitForSelector('.more-menu [data-pause-toggle]');await p.click('.more-menu [data-pause-toggle]');
 await p.waitForSelector('.pause-banner');assert.equal(await p.$('.pause-sheet'),null,'no confirmation when it is off');
 await p.click('.pause-banner [data-resume]');await p.waitForFunction(()=>!document.querySelector('.pause-banner'));
 delete f.saved.pause;

 // --- The voice quick command opens the same confirmation ---
 await p.goto(base+'/#/chat/'+rows[4].id);await p.waitForSelector('#box');
 assert.equal(await p.evaluate(()=>VoiceText.intent('Pause everything.')),'pauseAll');

 // --- Screenshots at 390 and in light: banner, confirmation, Settings → Automation ---
 for(const mode of ['dark','light']){
  for(const [w,h,mobile] of [[1440,900,false],[390,844,true]]){
   await p.setViewport({width:w,height:h,isMobile:mobile,hasTouch:mobile});await theme(p,mode);
   if(!(w===1440&&mode==='dark')){
    await home();await openAutomation();await shot(`settings-${w}-${mode}`);await axeCheck(p,repo,'.settings-sheet');
    assert.equal(await p.$eval('.settings-sheet',e=>e.scrollWidth<=e.clientWidth),true,'no sideways scroll in Settings');
    await p.keyboard.press('Escape');
    await home();await p.click('#listmore');await p.waitForSelector('.more-menu [data-pause-toggle]');await p.click('.more-menu [data-pause-toggle]');await p.waitForSelector('[data-pause-go]');
    await shot(`confirm-${w}-${mode}`);await axeCheck(p,repo,'.pause-sheet');
    await p.click('[data-pause-go]');await p.waitForSelector('.pause-banner');
    await p.goto(base+'/#/chat/'+rows[4].id);await p.waitForSelector('#box');await p.waitForSelector('.pause-banner');
    await shot(`banner-${w}-${mode}`);await axeCheck(p,repo,'.pause-banner');
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no sideways scroll with the banner');
    assert.ok(await p.$eval('.pause-resume',e=>e.getBoundingClientRect().height>=44));
    await p.click('.pause-banner [data-resume]');await p.waitForFunction(()=>!document.querySelector('.pause-banner'));
   }
  }
 }
 // Assistant mode keeps the category (Pause all is never hidden).
 settings.assistantMode=true;await p.setViewport({width:1440,height:900,isMobile:false,hasTouch:false});await theme(p,'dark');
 await p.goto(base+'/#/all');await p.waitForSelector('#settings');await clickControl(p,'#settings');
 await p.waitForSelector('[data-settings-category="automation"]');await p.click('[data-settings-category="automation"]');
 await p.waitForSelector('#s-automation [data-pause-toggle]');assert.equal(await p.$eval('#s-automation',e=>e.checkVisibility()),true);
 await p.keyboard.press('Escape');settings.assistantMode=false;
 delete retryRow.lastOrigin;delete jobRow.lastOrigin;delete jobRow.lastOriginRef;f.reset();await theme(p,themeBefore);
}
