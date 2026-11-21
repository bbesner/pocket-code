// 1.117 unattended work foundation, the app half: Pause all (the More menu, the switcher, the confirmation sheet, the
// banner and Resume, a second device catching up, a blocked own message keeping its draft), Settings → Automation
// rendered from the server's groups (save, range error, No limit and its warning, Reset to defaults, Advanced
// collapsed, usage and notices) and the origin label on a list row and in the chat. Runs inside test/browser.mjs, or
// alone with POCKET_AUTOMATION_ONLY=1. The synthetic responses follow the 1.117 server contract.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {clickControl} from './ui-controls.mjs';

const DAY=86400000;
// The groups as the server describes them (spec "Settings": the Pause all table and the Limits table, plus rule 3's
// second owner-rooted switch). Values are the defaults; saved values are kept beside them.
const GROUPS=[
 {key:'pause',title:'Pause all',settings:[
  {key:'ownMessages',label:'Your own messages while paused',type:'choice',default:'run',choices:[{value:'run',label:'Run, with a banner'},{value:'blocked',label:'Blocked until you resume'}]},
  {key:'pauseInboxWatch',label:'Pause all also pauses Inbox Watch',type:'bool',default:true},
  {key:'rearmRetries',label:'On Resume, re-arm held usage-limit retries',help:'Off keeps them held until you start them.',type:'bool',default:true},
  {key:'confirm',label:'Show what will stop before pausing',help:'Off pauses on one tap.',type:'bool',default:true}]},
 {key:'limits',title:'Limits on unattended work',settings:[
  {key:'claudeWeekly',label:'Plan ceiling, weekly · Claude',type:'number',default:80,min:10,max:100,step:1,unit:'%',offAllowed:true},
  {key:'codexWeekly',label:'Plan ceiling, weekly · Codex',type:'number',default:80,min:10,max:100,step:1,unit:'%',offAllowed:true},
  {key:'claudeFiveHour',label:'Plan ceiling, 5-hour · Claude',type:'number',default:90,min:10,max:100,step:1,unit:'%',offAllowed:true},
  {key:'codexFiveHour',label:'Plan ceiling, 5-hour · Codex',type:'number',default:90,min:10,max:100,step:1,unit:'%',offAllowed:true},
  {key:'dailyReplies',label:'Unattended replies per day',help:'Check-back and job replies that start in one day.',type:'number',default:40,min:1,max:1000,step:1,unit:'',offAllowed:true},
  {key:'countOwnerRooted',label:'Count queue drains, retries and coordination wakes toward the daily limit',type:'bool',default:false},
  {key:'ceilingsOwnerRooted',label:'Plan ceilings also hold queued messages, retries and coordination wakes',type:'bool',default:false},
  {key:'openrouterDaily',label:'OpenRouter spend per day',type:'number',default:5,min:0.5,max:500,step:0.5,unit:'$',offAllowed:true},
  {key:'longestReply',label:'Longest unattended reply',help:'A reply still running at this is stopped, and you get a push.',type:'number',default:60,min:5,max:480,step:5,unit:'min',offAllowed:true},
  {key:'countWaiting',label:'Count time waiting on an approval or question toward the longest reply',type:'bool',default:false},
  {key:'notice',label:'Notice when a limit is reached',type:'choice',default:'push',choices:[{value:'push',label:'Push and Settings, once per reason per day'},{value:'settings',label:'Settings only'}]},
  {key:'staleHours',label:'Treat a plan reading older than this as stale',type:'number',default:6,min:1,max:24,step:1,unit:'h',advanced:true}]}];

export const automationFixture={
 paused:null,saved:{pause:{},limits:{}},ownMessages:null,posts:[],
 would:{replies:{claude:2,codex:1,openrouter:0},retries:1,checkbacks:0,inboxWatch:true},
 reset(){this.paused=null;this.saved={pause:{},limits:{}};this.posts=[];},
 value(group,key){const s=GROUPS.find(g=>g.key===group).settings.find(x=>x.key===key);return key in this.saved[group]?this.saved[group][key]:s.default;},
 me(){return this.paused?{at:this.paused.at}:null;},
 pause(){return {paused:this.paused,would:this.would,held:this.paused?{retries:1,checkbacks:0}:{retries:0,checkbacks:0},ownMessages:this.value('pause','ownMessages'),confirm:this.value('pause','confirm')};},
 automation(){
  const now=Date.now(),groups=GROUPS.map(g=>({key:g.key,title:g.title,settings:g.settings.map(s=>({...s,value:this.value(g.key,s.key),saved:s.key in this.saved[g.key],preset:s.key==='longestReply'}))}));
  const warnings=groups.find(g=>g.key==='limits').settings.filter(s=>s.value==='off').map(s=>`No limit: ${s.label}. Unattended work can run until the plan's own limit.`);
  const days=Array.from({length:7},(_,i)=>({date:new Date(now-i*DAY).toISOString().slice(0,10),replies:[3,5,0,2,8,1,0][i],cost:[0.42,0.88,0,0.31,1.2,0.05,0][i],tokens:[120000,260000,0,90000,410000,12000,0][i]}));
  return {paused:this.paused,groups,warnings,notices:[{reason:'plan_ceiling',engine:'claude',at:new Date(now-2*3600000).toISOString(),text:'Claude weekly ceiling (80%) reached. Unattended Claude replies wait until the window resets.'}],
   usage:{today:{replies:3,cost:0.42,tokens:120000},days}};
 },
 // The server's all-or-nothing check: a refused value saves nothing and names the allowed range.
 save(body){
  const g=GROUPS.find(x=>x.key===body.group);if(!g)return {status:400,body:{error:'Unknown settings group.'}};
  if(body.reset){this.saved[g.key]={};return {status:200};}
  const next={};
  for(const [k,v] of Object.entries(body.values||{})){
   const s=g.settings.find(x=>x.key===k);if(!s)return {status:400,body:{error:`Unknown setting: ${k}.`}};
   const u=n=>s.unit==='$'?'$'+n:s.unit==='%'?n+'%':s.unit?n+' '+s.unit:String(n);
   if(s.type==='number'){if(v==='off'&&s.offAllowed){next[k]='off';continue;}if(typeof v!=='number'||!Number.isFinite(v)||v<s.min||v>s.max)return {status:400,body:{error:`${s.label} must be from ${u(s.min)} to ${u(s.max)}${s.offAllowed?', or Off':''}.`}};}
   if(s.type==='bool'&&typeof v!=='boolean')return {status:400,body:{error:`${s.label} is on or off.`}};
   if(s.type==='choice'&&!s.choices.some(c=>c.value===v))return {status:400,body:{error:`${s.label}: choose one of the listed options.`}};
   next[k]=v;
  }
  Object.assign(this.saved[g.key],next);return {status:200};
 },
};
// Answers the 1.117 routes; false when the request is not one of them.
export async function automationRoute(req,url,json){
 const f=automationFixture,body=async()=>{let raw='';for await(const c of req)raw+=c;return JSON.parse(raw||'{}');};
 if(url.pathname==='/api/pause'&&req.method==='GET'){json(f.pause());return true;}
 if(url.pathname==='/api/pause'&&req.method==='POST'){await body();f.posts.push('pause');f.paused=f.paused||{at:new Date().toISOString(),by:'owner'};json({ok:true,paused:f.paused,stopped:f.would});return true;}
 if(url.pathname==='/api/resume'&&req.method==='POST'){await body();f.posts.push('resume');f.paused=null;json({ok:true,paused:null,rearmed:1});return true;}
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
 await p.setViewport({width:1440,height:900,isMobile:false,hasTouch:false});await home();
 const themeBefore=await p.evaluate(()=>PocketTheme.preference);await theme(p,'dark');

 // --- Settings → Automation renders the server's groups; a category in both modes ---
 await openAutomation();
 assert.deepEqual(await p.$$eval('[data-auto-group]',e=>e.map(x=>x.dataset.autoGroup)),['pause','limits']);
 assert.deepEqual(await p.$$eval('[data-auto-group] > h3',e=>e.map(x=>x.textContent)),['Pause all','Limits on unattended work']);
 assert.match(await p.$eval('#s-automation [data-pause-toggle]',e=>e.textContent),/^Pause allRunning normally\./);
 assert.equal(await p.$eval('[data-auto-advanced="limits"]',e=>e.open),false,'Advanced starts collapsed');
 assert.equal(await p.$eval(input('staleHours'),e=>e.checkVisibility()),false,'an advanced setting is under Advanced');
 assert.equal(await p.$eval(input('confirm'),e=>e.getAttribute('aria-pressed')),'true');
 assert.equal(await p.$eval(input('ownMessages'),e=>e.value),'run');
 assert.match(await p.$eval('[data-auto-row="longestReply"] .title-note',e=>e.textContent),/5 min to 480 min, or no limit\. Preset on this server\./);
 assert.equal(await p.$$eval('.automation-usage tbody tr',e=>e.length),7);
 assert.equal(await p.$eval('[data-auto-today]',e=>e.textContent),'Today: 3 replies · $0.42 · 120K tokens');
 assert.match(await p.$eval('.automation-notices li',e=>e.textContent),/Claude weekly ceiling \(80%\) reached/);
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
 assert.equal(await p.$eval('#auto-limits-claudeWeekly-err',e=>e.textContent),'Plan ceiling, weekly · Claude must be from 10% to 100%, or Off.');
 assert.equal(await p.$eval(input('claudeWeekly'),e=>e.value),'70');assert.equal(await p.$eval(input('claudeWeekly'),e=>e.getAttribute('aria-invalid')),'true');
 assert.equal(f.saved.limits.claudeWeekly,70);
 await shot('settings-error-1440-dark');
 // No limit: the field empties, and the warning shows while it is off.
 assert.equal(await p.$('.automation-warning'),null);
 await p.click('[data-auto-off="dailyReplies"]');
 await p.waitForSelector('.automation-warning');
 assert.equal(f.saved.limits.dailyReplies,'off');
 assert.match(await p.$eval('.automation-warning',e=>e.textContent),/^No limit: Unattended replies per day\./);
 assert.equal(await p.$eval(input('dailyReplies'),e=>e.disabled),true);assert.equal(await p.$eval('[data-auto-off="dailyReplies"]',e=>e.getAttribute('aria-pressed')),'true');
 await shot('settings-off-1440-dark');
 // A switch and a choice save too.
 await p.click(input('countOwnerRooted'));await p.waitForFunction(()=>document.querySelector('[data-auto-key="countOwnerRooted"]').getAttribute('aria-pressed')==='true');
 assert.equal(f.saved.limits.countOwnerRooted,true);
 // Reset to defaults: every saved value in the group goes, and the warning with it.
 await p.click('[data-auto-reset="limits"]');
 await p.waitForFunction(()=>document.querySelector('[data-auto-status="limits"]')?.textContent==='Back to the defaults.');
 assert.deepEqual(f.saved.limits,{});assert.equal(await p.$eval(input('claudeWeekly'),e=>e.value),'80');assert.equal(await p.$('.automation-warning'),null);
 assert.equal(await p.$eval(input('countOwnerRooted'),e=>e.getAttribute('aria-pressed')),'false');
 await p.keyboard.press('Escape');

 // --- Origin labels: a list row and the chat say who started the newest reply ---
 const retryRow=rows[3],jobRow=rows[4];retryRow.lastOrigin='retry';jobRow.lastOrigin='job';jobRow.lastOriginRef='disk-alert';
 await home();await p.waitForFunction(id=>document.querySelector(`[data-item="${id}"] .origin-label`),{},retryRow.id);
 assert.equal(await p.$eval(`[data-item="${retryRow.id}"] .origin-label`,e=>e.textContent),'Continued after a usage limit');
 assert.equal(await p.$eval(`[data-item="${jobRow.id}"] .origin-label`,e=>e.textContent),'Started by job disk-alert');
 assert.equal(await p.$(`[data-item="${rows[0].id}"] .origin-label`),null,'owner work has no label');
 await p.goto(base+'/#/chat/'+retryRow.id);await p.waitForFunction(()=>document.querySelector('#origin-line')?.hidden===false);
 assert.equal(await p.$eval('#origin-line',e=>e.textContent),'Continued after a usage limit');

 // --- Pause all from the More menu: the confirmation lists what will stop; Keep running returns focus ---
 f.posts.length=0;await home();
 await p.click('#listmore');await p.waitForSelector('.more-menu [data-pause-toggle]');
 await p.click('.more-menu [data-pause-toggle]');await p.waitForSelector('.pause-sheet [data-pause-would]');
 assert.equal(await p.$eval('[data-pause-would]',e=>e.textContent),'This stops 3 replies running (2 Claude, 1 Codex), 1 usage-limit retry, Inbox Watch.');
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
 assert.equal(await p.$eval('.pause-banner .pause-text',e=>e.textContent),'Pocket is paused. Your own messages still run. 1 usage-limit retry is held.');
 assert.equal(await p.$eval('.composerwrap',e=>e.getBoundingClientRect().bottom),composerBefore,'the composer stays put');
 assert.ok(await p.$eval('.pause-resume',e=>e.getBoundingClientRect().height>=44));
 assert.equal(await p.evaluate(()=>document.documentElement.scrollHeight<=innerHeight),true,'nothing pushed below the window');
 await shot('banner-1440-dark');await axeCheck(p,repo,'.pause-banner');
 // Every Pause all control reads Resume while paused.
 await p.keyboard.down('Control');await p.keyboard.press('k');await p.keyboard.up('Control');
 await p.waitForSelector('.session-switcher [data-pause-toggle]');assert.match(await p.$eval('.session-switcher [data-pause-toggle]',e=>e.textContent),/^Resume/);
 await p.keyboard.press('Escape');
 // Resume from the banner: it goes, and the server was told.
 await p.click('.pause-banner [data-resume]');await p.waitForFunction(()=>!document.querySelector('.pause-banner'));
 assert.deepEqual(f.posts,['pause','resume']);assert.equal(f.paused,null);
 // A second device paused it: this one catches up on its next check (return to the tab here).
 f.paused={at:new Date().toISOString(),by:'owner'};
 await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.waitForSelector('.pause-banner');
 // Own messages Blocked: the banner says so, a send is refused with a clear message and the draft is kept.
 f.saved.pause.ownMessages='blocked';await p.evaluate(()=>Automation.poll(true));
 await p.waitForFunction(()=>/wait until you resume/.test(document.querySelector('.pause-banner .pause-text')?.textContent||''));
 await p.$eval('#box',e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));}); // an earlier check's draft may still be here
 await p.type('#box','Recount aisle 4 while paused');await p.click('#send');
 await p.waitForFunction(()=>/Pocket is paused/.test(document.querySelector('#delivery-status')?.textContent||''));
 assert.equal(await p.$eval('#box',e=>e.value),'Recount aisle 4 while paused','the draft stays');
 await shot('blocked-1440-dark');
 // Resume, and with the confirmation switched off Pause all acts on one tap.
 await p.click('.pause-banner [data-resume]');await p.waitForFunction(()=>!document.querySelector('.pause-banner'));
 await p.$eval('#discard-message',e=>e.click()).catch(()=>{});
 f.saved.pause={confirm:false};
 await home();await p.click('#listmore');await p.waitForSelector('.more-menu [data-pause-toggle]');await p.click('.more-menu [data-pause-toggle]');
 await p.waitForSelector('.pause-banner');assert.equal(await p.$('.pause-sheet'),null,'no confirmation when it is off');
 await p.click('.pause-banner [data-resume]');await p.waitForFunction(()=>!document.querySelector('.pause-banner'));
 f.saved.pause={};

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
