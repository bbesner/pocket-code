// Layout sweep, area `settings`: Settings (index and every category), the CLI and Pocket Code updates, Automation
// (Pause all, the banner, limits, check-backs, job keys), the Inbox, Assistant mode, the start and link pages, and the
// home header's More menu and bell. Fixtures only (test/browser.mjs and the automation, check-back and job-key
// fixtures it imports); every surface undoes what it seeds. Run:
//   POCKET_SWEEP=settings POCKET_SCREENSHOTS=/tmp/pc-ui-settings node test/browser.mjs
import {automationFixture} from '../automation-browser.mjs';
import {checkbackFixture} from '../checkback-browser.mjs';
import {jobsFixture} from '../jobkeys-browser.mjs';
import {openSettingsPage} from '../ui-controls.mjs';

export const area='settings';

const HOUR=3600000,MIN=60000;
const iso=ms=>new Date(Math.floor(ms/1000)*1000).toISOString().replace(/\.\d{3}Z$/,'Z');
const a=automationFixture,cbf=checkbackFixture,jf=jobsFixture;

// ---- helpers -----------------------------------------------------------------------------------------------------
// Settings at a category, the way the app opens it from a link (the index when category is '').
// 1.124.9: the page is the one that holds `ready` (rows moved between pages), reached the way a person would.
const openSettings=(category='',ready='.settings-sheet')=>async page=>{
 await page.waitForFunction(()=>typeof settingsSheet==='function');
 await page.evaluate(c=>settingsSheet({category:c}),category);
 await page.waitForSelector(ready);
 const key=await page.$eval(ready,e=>e.closest('[data-settings-panel]')?.dataset.settingsPanel||'');
 if(key)await openSettingsPage(page,key);
 await page.waitForSelector(ready,{visible:true});
};
// Bring an element in a sheet into view (top of the sheet), so the picture shows it.
const scrollTo=async(page,sel,block='start')=>{await page.$eval(sel,(e,b)=>e.scrollIntoView({block:b}),block);};
const automationOn=(patch)=>async()=>{const saved=a.saved;a.saved={...a.saved,...patch};return async()=>{a.saved=saved;};};

// The CLI updates endpoint is not in the fixture server: answer it from the page (as test/cli-updates-browser.mjs does).
const cliState=(pocketSelf=null,extra={})=>({enabled:true,timeZone:'America/New_York',hour:4,checkedAt:Date.now(),checking:false,job:null,
 pocket:{key:'pocket',name:'Pocket Code',enabled:true,installed:'1.124.4',latest:'1.125.0',available:true,notes:'https://example.test/releases/tag/v1.125.0',guide:'https://example.test/docs/operations.md#upgrade-an-existing-installation',...(pocketSelf?{self:pocketSelf}:{})},
 providers:[{key:'claude',name:'Claude Code',installed:'2.0.0',latest:'2.1.0',available:true,canUpgrade:true,notes:'https://example.test/claude-code/CHANGELOG.md'},{key:'codex',name:'Codex',installed:'0.150.0',latest:'0.151.0',available:true,canUpgrade:true,notes:'https://example.test/codex/releases'}],...extra});
const answerCli=async(page,state)=>{
 await page.setRequestInterception(true);
 page.on('request',req=>{const u=new URL(req.url());if(req.isInterceptResolutionHandled?.())return;
  if(!u.pathname.startsWith('/api/cli-updates'))return req.continue();
  return req.respond({status:200,contentType:'application/json',body:JSON.stringify(state)});});
};
const openCli=(state,after)=>async(page,h)=>{
 await answerCli(page,state);
 await page.evaluate(()=>pollCliUpdates());
 await page.evaluate(()=>openCliUpdates());
 await page.waitForSelector('.cli-updates-sheet #cli-check',{visible:true});
 await page.waitForFunction(()=>!document.querySelector('.cli-updates-sheet #cli-check')?.disabled);
 if(after)await after(page,h);
};
const selfJob=(phase,extra={})=>({enabled:true,available:false,reason:null,job:{id:'self-x',running:['queued','checking','backing-up','installing','restarting','rolling-back'].includes(phase),phase,from:'1.124.4',to:'1.125.0',...extra}});

// Check-backs: a conversation with one of each state (as test/checkback-browser.mjs's gallery).
const checkbackGallery=ctx=>{
 const host=ctx.rows[3],T0=Date.now()-3*HOUR,T1=Date.now()-2*HOUR,T2=Date.now()-HOUR,soon=iso(Date.now()+40*MIN),tomorrow=iso(Date.now()+20*HOUR),past=iso(T0+40*MIN);
 const cb=(id,set,status,extra={})=>({id,sessionId:host.id,engine:'claude',note:'Check the status page shows the new version ('+id+')',dueAt:soon,createdAt:iso(set),status,chainDepth:0,turnStartedAt:iso(set-5000),...extra});
 return {host,convo:[
  {role:'user',ts:iso(T0),text:'Publish the stock report, then check that the status page shows the new version.'},
  {role:'assistant',ts:iso(T0+20000),blocks:[{t:'text',text:'Published. The status page updates within the hour, so I set check-backs to confirm it.'}]},
  {role:'user',ts:iso(T1),text:'Also watch the supplier feed import tonight.'},
  {role:'assistant',ts:iso(T1+20000),blocks:[{t:'text',text:'Set. If the import is still running I will wait for it.'}]},
  {role:'user',ts:iso(T2),text:'One more for tomorrow morning.'},
  {role:'assistant',ts:iso(T2+20000),blocks:[{t:'text',text:'Done: one for later today and one for tomorrow.'}]},
 ],list:[
  cb('cb-done',T0+5000,'done',{dueAt:past,startedAt:past,outcome:{kind:'done',at:past}}),
  cb('cb-failed',T0+6000,'done',{dueAt:past,startedAt:past,outcome:{kind:'failed',at:past}}),
  cb('cb-missed',T0+7000,'missed',{dueAt:past,outcome:{kind:'late',at:past,summary:'Pocket was down until 4:10 PM'}}),
  cb('cb-cancelled',T0+8000,'cancelled',{outcome:{kind:'cancelled',at:past}}),
  cb('cb-paused',T1+5000,'held',{held:{reason:'paused',since:iso(T1+6000)}}),
  cb('cb-busy',T1+6000,'held',{held:{reason:'busy',since:iso(T1+7000)}}),
  cb('cb-ceiling',T1+7000,'held',{held:{reason:'plan_ceiling',since:iso(T1+8000)}}),
  cb('cb-daily',T1+8000,'held',{held:{reason:'daily_limit',since:iso(T1+9000)}}),
  cb('cb-running',T1+9000,'running',{startedAt:iso(Date.now()-60000)}),
  cb('cb-today',T2+5000,'pending'),
  cb('cb-tomorrow',T2+6000,'pending',{dueAt:tomorrow,note:'Check the feed and stock counts'}),
 ]};
};
const withCheckbacks=async ctx=>{
 const g=checkbackGallery(ctx),before=ctx.conversations.get(g.host.id),saved=a.saved;
 a.saved={...a.saved,checkbacks:{checkbacks:true}};cbf.list=g.list;ctx.conversations.set(g.host.id,g.convo);
 return async()=>{a.saved=saved;cbf.reset();ctx.conversations.set(g.host.id,before);};
};

// Job keys: the fixture's two keys and runs; a request waiting, answered from the page.
const REQUEST={id:'jr-req0001',session:'44444444-4444-4444-8444-444444444444',sessionTitle:'Monthly warehouse summary',proposedAt:iso(Date.now()-12*MIN),expiresAt:iso(Date.now()+24*HOUR),
 fields:{name:'disk-alert',workspace:'/home/owner/ops',engine:'claude',model:'default',effort:null,access:'full',limits:{perHour:6,perDay:24,atOnce:1},mayAddInstructions:false,pushWhenDone:true,
  instruction:'When the disk monitor calls, read the report in the data.\nSay which volumes are above 85% and what grew in the last day.\nChange nothing on the server; only report.\nA very long path that must wrap rather than run off the card: /home/owner/ops/monitoring/reports/disk-usage/volumes/archive/2026/11/weekly-rollup-and-detail.csv'}};
const withJobs=(opts={})=>async()=>{
 const saved=a.saved;a.saved={...a.saved,jobs:{jobs:true}};jf.reset();if(opts.empty)jf.keys=[];
 return async()=>{a.saved=saved;jf.reset();};
};
const answerJobs=async(page,{requests=[],create=false,createError=false}={})=>{
 await page.setRequestInterception(true);
 page.on('request',req=>{const u=new URL(req.url());
  // the server's answer to a bad name (server.mjs jobFail 'bad_name')
  if(u.pathname==='/api/jobs/keys'&&req.method()==='POST'&&createError)return req.respond({status:400,contentType:'application/json',body:JSON.stringify({error:'A job key\'s name is 1 to 48 lowercase letters, digits, - or _, starting with a letter or digit, like disk-check.',code:'bad_name'})});
  if(u.pathname==='/api/jobs/keys'&&req.method()==='GET')return req.respond({status:200,contentType:'application/json',body:JSON.stringify({keys:jf.keys.map(k=>jf.view(k)),defaults:jf.defaults(),requests,answered:[]})});
  if(u.pathname==='/api/jobs/keys'&&req.method()==='POST'&&create){const b=JSON.parse(req.postData()||'{}');const k={id:'jk-new00001',name:b.name||'new-key',title:b.name,workspace:b.workspace||'/home/owner/ops',engine:b.engine||'claude',model:b.model||'default',effort:null,access:b.access||'ask',enabled:true,lastRunAt:null,hasRun:false,running:0,instruction:b.instruction||'',limits:b.limits||{perHour:6,perDay:24,atOnce:1},pushWhenDone:true,mayAddInstructions:false,createdAt:iso(Date.now())};
   jf.keys.push(k);return req.respond({status:200,contentType:'application/json',body:JSON.stringify({key:k,secret:'pjk_sweepFixtureOnlyNotARealKey0123456789abcdefgh',file:'/home/owner/.config/pocket/jobs/'+k.name+'.key',note:'This is the only time the key is shown.'})});}
  if(/^\/api\/jobs\/requests\/[^/]+\/answer$/.test(u.pathname)){const b=JSON.parse(req.postData()||'{}');return req.respond({status:200,contentType:'application/json',body:JSON.stringify(b.answer==='allow'?{ok:true,answer:'allow',file:'/home/owner/.config/pocket/jobs/disk-alert.key',session:REQUEST.session}:{ok:true,answer:'deny',session:REQUEST.session})});}
  return req.continue();});
};
const openJobs=(opts={},after)=>async(page,h)=>{
 await answerJobs(page,opts);
 await openSettings('f-jobs','#s-jobs-auto [data-auto-group="jobs"]')(page);
 await page.waitForSelector(opts.empty?'[data-job-empty]':opts.requests?.length?'[data-job-request]':'[data-job-keys] .job-key-row',{visible:true});
 if(after)await after(page,h);
};

// Approvals for Assistant mode's conversation (the fixture route answers every session's /approvals).
const APPROVAL={id:'approval-sweep',title:'Run: Convert the deck to PDF?',kind:'tool',details:JSON.stringify({tool:'Bash',cwd:'/workspaces/reports',input:{command:'soffice --headless --convert-to pdf "Quarterly review.pptx"',description:'Convert the deck to PDF'}},null,2),canAllow:true,status:'pending'};
const stepsConvo=[{role:'user',text:'Make a PDF of the quarterly deck and save it with the proposal.'},
 {role:'assistant',blocks:[{t:'text',text:'Checking the folder first.'},{t:'tool',name:'Bash',detail:'List the reports folder'},{t:'tool',name:'Read',detail:'/workspaces/reports/Proposal.md'},{t:'tool',name:'Write',detail:'/workspaces/reports/Proposal.pdf'},{t:'text',text:'Saved Proposal.pdf. Converting the deck next; that needs your OK.'}]}];

// ---- surfaces ----------------------------------------------------------------------------------------------------
const list=[
 // Settings, Developer mode ---------------------------------------------------------------------------------------
 {name:'settings-index',route:'#/all',ready:'#settings',open:async(page,h)=>{await h.click('#settings');await page.waitForSelector('.settings-index',{visible:true});},scope:'.settings-sheet'},
 {name:'settings-appearance',route:'#/all',ready:'#settings',open:async(page,h)=>{await h.click('#settings');await page.waitForSelector('[data-settings-category="display"]');await page.click('[data-settings-category="display"]');await page.waitForSelector('#s-theme',{visible:true});},scope:'.settings-sheet'},
 {name:'settings-appearance-large-text',route:'#/all',ready:'#settings',open:async page=>{await openSettings('display','#s-theme')(page);
   // a much larger text size, with its live sample (each context is fresh, so the saved size does not leak)
   for(let i=0;i<6;i++){const b=await page.$('[data-text-larger]:not([disabled])');if(!b)break;await b.click();}
   await scrollTo(page,'.chat-text-settings','center');},scope:'.settings-sheet'},
 {name:'settings-conversation',route:'#/all',ready:'#settings',open:openSettings('conversation','#s-titles'),scope:'.settings-sheet'},
 {name:'settings-conversation-titles',route:'#/all',ready:'#settings',open:async page=>{await openSettings('conversation','#s-titles')(page);await scrollTo(page,'#s-titles');},scope:'.settings-sheet'},
 {name:'settings-agents',route:'#/all',ready:'#settings',open:openSettings('agents','#s-environment'),scope:'.settings-sheet'},
 {name:'settings-agents-models',route:'#/all',ready:'#settings',open:async page=>{await openSettings('agents','#s-models')(page);await page.waitForSelector('#s-models-list .opt');await scrollTo(page,'#s-models');},scope:'.settings-sheet'},
 {name:'settings-agents-trusted-error',route:'#/all',ready:'#settings',open:async page=>{await openSettings('agents','#s-trusted')(page);await scrollTo(page,'#s-trusted');
   await page.type('#s-trusted-input','Edit');await page.click('#s-trusted-add');await page.waitForFunction(()=>document.querySelector('#s-trusted-error')?.textContent.trim());},scope:'.settings-sheet'},
 {name:'settings-agents-router',route:'#/all',ready:'#settings',open:async page=>{await openSettings('agents','#s-router')(page);await page.waitForSelector('#s-router-levels *');await scrollTo(page,'#s-router');},scope:'.settings-sheet'},
 {name:'settings-agents-access',route:'#/all',ready:'#settings',open:async page=>{await openSettings('agents','#s-access')(page);await scrollTo(page,'#s-access');},scope:'.settings-sheet'},
 {name:'accounts-sheet',route:'#/all',ready:'#settings',open:async page=>{await openSettings('agents','#s-environment')(page);await page.click('#s-environment');await page.waitForFunction(()=>/Claude/.test(document.querySelector('.sheet')?.textContent||'')&&!document.querySelector('.settings-sheet'));},scope:'.sheet'},
 {name:'accounts-stop-claude',route:'#/all',ready:'#settings',before:ctx=>{ctx.modes.claudeActive=2;return async()=>{ctx.modes.claudeActive=0;};},
  open:async page=>{await openSettings('agents','#s-environment')(page);await page.click('#s-environment');await page.waitForFunction(()=>[...document.querySelectorAll('.sheet button')].some(b=>/Stop all Claude/.test(b.textContent)&&!b.disabled));
   await page.evaluate(()=>[...document.querySelectorAll('.sheet button')].find(b=>/Stop all Claude/.test(b.textContent)).click());await new Promise(r=>setTimeout(r,200));},scope:'.sheet'},
 {name:'connectors-sheet',route:'#/all',ready:'#settings',open:async page=>{await openSettings('agents','#s-connectors')(page);await page.click('#s-connectors');await page.waitForFunction(()=>/Gmail/.test(document.querySelector('.sheet')?.textContent||'')&&!document.querySelector('.settings-sheet'));},scope:'.sheet'},
 {name:'settings-libraries',route:'#/all',ready:'#settings',settings:{coordination:false},open:openSettings('libraries','#s-projects'),scope:'.settings-sheet'},
 {name:'settings-libraries-on',route:'#/all',ready:'#settings',settings:{projects:true,documents:true,tasks:true,inbox:true,vault:true,coordination:true},open:openSettings('libraries','#s-projects'),scope:'.settings-sheet'},
 {name:'settings-notifications',route:'#/all',ready:'#settings',open:openSettings('notifications','#s-email-wrap'),scope:'.settings-sheet'},
 {name:'settings-notifications-email-error',route:'#/all',ready:'#settings',open:async page=>{await openSettings('notifications','#s-email')(page);await scrollTo(page,'#s-email-wrap');
   await page.type('#s-email','not-an-address');await page.click('#s-email-save');await new Promise(r=>setTimeout(r,300));},scope:'.settings-sheet'},
 {name:'settings-notifications-email-sent',route:'#/all',ready:'#settings',settings:{notifyEmail:'owner@example.test'},open:async page=>{await openSettings('notifications','#s-email-test')(page);await scrollTo(page,'#s-email-wrap');
   await page.click('#s-email-test');await new Promise(r=>setTimeout(r,400));},scope:'.settings-sheet'},
 {name:'settings-help',route:'#/all',ready:'#settings',open:openSettings('help','#s-about'),scope:'.settings-sheet'},
 {name:'settings-help-notes',route:'#/all',ready:'#settings',open:async page=>{await openSettings('help','#s-notes')(page);await page.$eval('#s-notes',e=>{if(e.tagName==='DETAILS')e.open=true;else e.click();});await scrollTo(page,'#s-notes');},scope:'.settings-sheet'},
 {name:'settings-help-about-failed',route:'#/all',ready:'#settings',modes:{aboutFailed:true},open:openSettings('help','#s-about'),scope:'.settings-sheet'},

 // Assistant mode -------------------------------------------------------------------------------------------------
 {name:'assistant-home',route:'#/',ready:'.assistant-home',settings:{assistantMode:true,inbox:true}},
 {name:'assistant-settings-index',route:'#/',ready:'.assistant-home',settings:{assistantMode:true},open:openSettings('','.settings-index'),scope:'.settings-sheet'},
 {name:'assistant-features',route:'#/',ready:'.assistant-home',settings:{assistantMode:true},open:openSettings('features','#s-features-lead'),scope:'.settings-sheet'},
 {name:'assistant-features-locked',route:'#/',ready:'.assistant-home',settings:{assistantMode:true,assistantLocked:true,projects:true,tasks:true},open:openSettings('features','#s-features-lead'),scope:'.settings-sheet'},
 {name:'assistant-appearance-mode',route:'#/',ready:'.assistant-home',settings:{assistantMode:true},open:openSettings('display','#s-theme'),scope:'.settings-sheet'},
 {name:'assistant-chat-steps-approval',route:ctx=>'#/chat/'+ctx.rows[4].id,ready:'#box',settings:{assistantMode:true},
  before:ctx=>{const id=ctx.rows[4].id,prev=ctx.conversations.get(id),st=ctx.rows[4].state;ctx.conversations.set(id,stepsConvo);ctx.rows[4].state={kind:'approval',label:'Waiting for your OK',confirmed:true};ctx.setRequests({approvals:[APPROVAL]});
   return async()=>{ctx.conversations.set(id,prev);ctx.rows[4].state=st;ctx.setRequests({});};},
  open:async page=>{await page.waitForSelector('#msgs .m-asst');await new Promise(r=>setTimeout(r,600));}},
 {name:'assistant-new-model',route:'#/new',ready:'#first',settings:{assistantMode:true}},

 // Updates --------------------------------------------------------------------------------------------------------
 {name:'updates-notice',route:'#/all',ready:'[data-id], .session-home',open:async page=>{await answerCli(page,cliState());await page.evaluate(()=>pollCliUpdates());await page.waitForSelector('.cli-update-notice:not([hidden])',{visible:true});}},
 {name:'updates-sheet',route:'#/all',ready:'.session-home',open:openCli(cliState()),scope:'.sheet'},
 {name:'updates-self-available',route:'#/all',ready:'.session-home',open:openCli(cliState({enabled:true,available:true,reason:null,job:null})),scope:'.sheet'},
 {name:'updates-self-running',route:'#/all',ready:'.session-home',open:openCli(cliState(selfJob('installing'))),scope:'.sheet'},
 {name:'updates-self-failed',route:'#/all',ready:'.session-home',open:openCli(cliState({...selfJob('failed',{error:'1.125.0 did not start, so Pocket went back to 1.124.4. The log is pocket-self-update.log in Pocket\'s data folder.'}),available:true})),scope:'.sheet'},
 {name:'updates-self-not-started',route:'#/all',ready:'.session-home',open:openCli(cliState({...selfJob('failed',{error:'The update did not start. Nothing was changed. The log is pocket-self-update.log in Pocket\'s data folder.'}),available:true})),scope:'.sheet'},
 {name:'updates-self-interrupted',route:'#/all',ready:'.session-home',open:openCli(cliState({...selfJob('interrupted',{error:'The update stopped without finishing, probably because the server restarted. Check the version shown here before you try again.'}),available:true})),scope:'.sheet'},
 {name:'updates-self-unavailable',route:'#/all',ready:'.session-home',open:openCli(cliState({enabled:true,available:false,reason:'Pocket is not running under PM2 here, so it cannot restart itself. Update it from the server.',job:null})),scope:'.sheet'},
 {name:'updates-cli-failed',route:'#/all',ready:'.session-home',open:openCli(cliState(null,{job:{id:'job-one',running:false,phase:'failed',results:[],error:'Compatibility check failed. Previous version retained.'}})),scope:'.sheet'},
 {name:'updates-older',route:'#/all',ready:'.session-home',open:openCli((()=>{const s=cliState();s.providers.forEach(p=>{p.installed=p.latest;p.available=false;});s.pocket.available=false;s.pocket.installed=s.pocket.latest;
   s.providers[0].olderSessions=1;s.providers[0].older=[{key:'claude',id:'12345678-1234-1234-1234-123456789abc',title:'Review invoices for the north warehouse and the long-named supplier account',busy:false,version:'2.0.0'}];
   s.providers[1].olderSessions=1;s.providers[1].older=[{key:'codex',id:'cx:12345678-1234-1234-1234-123456789abd',title:'Build report',busy:true,version:'0.150.0'}];return s;})()),scope:'.sheet'},

 // Automation -----------------------------------------------------------------------------------------------------
 {name:'more-menu',route:'#/all',ready:'#listmore',open:async page=>{await page.click('#listmore');await page.waitForSelector('.more-menu [data-pause-toggle]');},scope:'.sheet'},
 {name:'pause-confirm',route:'#/all',ready:'#listmore',before:async()=>{const w=a.would;a.would={replies:{claude:2,codex:1,openrouter:0},jobs:1,background:2,retries:1,checkbacks:3,inboxWatch:true};return async()=>{a.would=w;};},
  open:async page=>{await page.click('#listmore');await page.waitForSelector('.more-menu [data-pause-toggle]');await page.click('.more-menu [data-pause-toggle]');await page.waitForSelector('.pause-sheet [data-pause-go]');},scope:'.sheet'},
 {name:'pause-confirm-nothing',route:'#/all',ready:'#listmore',before:async()=>{const w=a.would;a.would={replies:{},background:0,retries:0,checkbacks:0,inboxWatch:false};return async()=>{a.would=w;};},
  open:async page=>{await page.click('#listmore');await page.waitForSelector('.more-menu [data-pause-toggle]');await page.click('.more-menu [data-pause-toggle]');await page.waitForSelector('.pause-sheet [data-pause-go]');},scope:'.sheet'},
 {name:'paused-banner-home',route:'#/all',ready:'.pause-banner',before:async()=>{a.paused={at:new Date().toISOString(),by:'owner'};a.heldCheckbacks=3;const s=a.saved;a.saved={...a.saved,checkbacks:{checkbacks:true}};return async()=>{a.paused=null;a.heldCheckbacks=0;a.saved=s;};}},
 {name:'paused-banner-chat',route:ctx=>'#/chat/'+ctx.rows[4].id,ready:'.pause-banner',before:async()=>{a.paused={at:new Date().toISOString(),by:'owner'};return async()=>{a.paused=null;};},open:async page=>{await page.waitForSelector('#box');}},
 {name:'paused-banner-blocked',route:ctx=>'#/chat/'+ctx.rows[4].id,ready:'.pause-banner',before:async()=>{a.paused={at:new Date().toISOString(),by:'owner'};const s=a.saved;a.saved={...a.saved,pause:{ownMessages:'blocked'}};return async()=>{a.paused=null;a.saved=s;};},
  open:async page=>{await page.waitForSelector('#box');await page.type('#box','Recount aisle 4 while paused');await page.click('#send');await page.waitForFunction(()=>/Pocket is paused/.test(document.querySelector('#delivery-status')?.textContent||''));},
  after:null},
 {name:'paused-banner-new',route:'#/new',ready:'.pause-banner',before:async()=>{a.paused={at:new Date().toISOString(),by:'owner'};return async()=>{a.paused=null;};}},
 {name:'paused-banner-inbox',route:'#/inbox',ready:'.pause-banner',settings:{inbox:true},before:async()=>{a.paused={at:new Date().toISOString(),by:'owner'};return async()=>{a.paused=null;};},open:async page=>{await page.waitForSelector('.inbox-item');}},
 {name:'paused-settings-automation',route:'#/all',ready:'.pause-banner',before:async()=>{a.paused={at:new Date().toISOString(),by:'owner'};return async()=>{a.paused=null;};},open:openSettings('automation','[data-auto-group="limits"]'),scope:'.settings-sheet'},
 {name:'automation-settings',route:'#/all',ready:'#settings',open:openSettings('automation','[data-auto-group="limits"] [data-auto-key="claudeWeekly"]'),scope:'.settings-sheet'},
 {name:'automation-limits',route:'#/all',ready:'#settings',open:async page=>{await openSettings('automation','[data-auto-group="limits"] [data-auto-key="claudeWeekly"]')(page);await scrollTo(page,'[data-auto-group="limits"]');},scope:'.settings-sheet'},
 {name:'automation-range-error',route:'#/all',ready:'#settings',before:async()=>{const s=a.saved;return async()=>{a.saved=s;};},open:async page=>{await openSettings('automation','[data-auto-key="claudeWeekly"]')(page);
   await page.$eval('[data-auto-key="claudeWeekly"]',e=>{e.focus();e.value='150';e.dispatchEvent(new Event('change'));});await page.waitForFunction(()=>document.querySelector('#auto-limits-claudeWeekly-err')?.textContent);await scrollTo(page,'[data-auto-row="claudeWeekly"]','center');},scope:'.settings-sheet'},
 {name:'automation-no-limit',route:'#/all',ready:'#settings',before:async()=>{const s=a.saved;a.saved={...a.saved,limits:{dailyReplies:'off'}};return async()=>{a.saved=s;};},open:openSettings('automation','.automation-warning'),scope:'.settings-sheet'},
 {name:'automation-counts-unsaved',route:'#/all',ready:'#settings',before:async()=>{const orig=a.automation;a.automation=function(){const r=orig.call(this);return {...r,warnings:[...r.warnings,"Today's counts of unattended replies and OpenRouter spend could not be saved, so after a restart they may be lower than they are and the daily limits could be passed. Check that Pocket's data folder has space and can be written."]};};return async()=>{a.automation=orig;};},
  open:openSettings('automation','.automation-warning'),scope:'.settings-sheet'},
 {name:'automation-advanced-open',route:'#/all',ready:'#settings',open:async page=>{await openSettings('automation','[data-auto-advanced="limits"]')(page);await page.click('[data-auto-advanced="limits"] summary');await scrollTo(page,'[data-auto-advanced="limits"]');},scope:'.settings-sheet'},
 {name:'automation-usage',route:'#/all',ready:'#settings',open:async page=>{await openSettings('automation','.automation-usage')(page);await scrollTo(page,'.automation-usage');},scope:'.settings-sheet'},
 // Check-backs
 {name:'checkbacks-settings-off',route:'#/all',ready:'#settings',open:async page=>{await openSettings('f-checkbacks','#s-checkbacks-auto [data-auto-group="checkbacks"]')(page);await scrollTo(page,'#s-checkbacks-auto');},scope:'.settings-sheet'},
 {name:'checkbacks-settings-on',route:'#/all',ready:'#settings',before:withCheckbacks,open:async page=>{await openSettings('automation','[data-checkbacks-waiting]')(page);await scrollTo(page,'[data-auto-group="checkbacks"]');},scope:'.settings-sheet'},
 {name:'checkbacks-cancel-all',route:'#/all',ready:'#settings',before:withCheckbacks,open:async page=>{await openSettings('automation','[data-checkbacks-cancel-all]')(page);await page.click('[data-checkbacks-cancel-all]');await page.waitForFunction(()=>/Cancel \d+ check-back/.test(document.querySelector('.sheet h2')?.textContent||''));},scope:'.sheet'},
 {name:'checkbacks-cards',route:ctx=>'#/chat/'+ctx.rows[3].id,ready:'#msgs > [data-checkback]',before:withCheckbacks,open:async page=>{await page.$eval('#msgs > [data-checkback]',e=>e.scrollIntoView({block:'start'}));}},
 {name:'checkbacks-cards-end',route:ctx=>'#/chat/'+ctx.rows[3].id,ready:'#msgs > [data-checkback]',before:withCheckbacks,open:async page=>{await page.$$eval('#msgs > [data-checkback]',e=>e.at(-1).scrollIntoView({block:'end'}));}},
 {name:'checkbacks-row-clock',route:'#/all',ready:'.checkback-clock',before:withCheckbacks},
 // Job keys
 {name:'jobkeys-off',route:'#/all',ready:'#settings',open:async page=>{await openSettings('f-jobs','#s-jobs-auto [data-auto-group="jobs"]')(page);await scrollTo(page,'[data-auto-group="jobs"]');},scope:'.settings-sheet'},
 {name:'jobkeys-empty',route:'#/all',ready:'#settings',before:withJobs({empty:true}),open:openJobs({empty:true},async page=>{await scrollTo(page,'[data-auto-group="jobs"]');}),scope:'.settings-sheet'},
 {name:'jobkeys-list',route:'#/all',ready:'#settings',before:withJobs(),open:openJobs({},async page=>{await scrollTo(page,'[data-auto-group="jobs"]');}),scope:'.settings-sheet'},
 {name:'jobkeys-request',route:'#/all',ready:'#settings',before:withJobs(),open:openJobs({requests:[REQUEST]},async page=>{await scrollTo(page,'[data-job-request]');}),scope:'.settings-sheet'},
 {name:'jobkeys-request-buttons',route:'#/all',ready:'#settings',before:withJobs(),open:openJobs({requests:[REQUEST]},async page=>{await scrollTo(page,'[data-jr-allow]','end');}),scope:'.settings-sheet'},
 {name:'jobkeys-request-allowed',route:'#/all',ready:'#settings',before:withJobs(),open:openJobs({requests:[REQUEST]},async page=>{await page.$eval('[data-jr-allow]',e=>e.scrollIntoView({block:'center'}));await page.click('[data-jr-allow]');await page.waitForSelector('[data-job-outcome]');await scrollTo(page,'[data-job-outcome]','center');}),scope:'.settings-sheet'},
 {name:'jobkeys-request-edit',route:'#/all',ready:'#settings',before:withJobs(),open:openJobs({requests:[REQUEST]},async page=>{await page.$eval('[data-jr-edit]',e=>e.scrollIntoView({block:'center'}));await page.click('[data-jr-edit]');await page.waitForSelector('.job-request-edit');}),scope:'.sheet'},
 {name:'jobkeys-new-sheet',route:'#/all',ready:'#settings',before:withJobs(),open:openJobs({},async page=>{await page.click('[data-job-new]');await page.waitForSelector('.job-key-sheet');}),scope:'.sheet'},
 {name:'jobkeys-new-error',route:'#/all',ready:'#settings',before:withJobs(),open:openJobs({createError:true},async page=>{await page.click('[data-job-new]');await page.waitForSelector('.job-key-sheet');
   const submit=await page.$('.job-key-sheet button[type=submit], .job-key-sheet [data-job-save]');if(submit)await submit.click();else await page.keyboard.press('Enter');await new Promise(r=>setTimeout(r,400));}),scope:'.sheet'},
 {name:'jobkeys-shown-once',route:'#/all',ready:'#settings',before:withJobs(),open:openJobs({create:true},async page=>{await page.click('[data-job-new]');await page.waitForSelector('.job-key-sheet');
   await page.$eval('.job-key-sheet input[name=name]',e=>{e.value='weekly-backup';e.dispatchEvent(new Event('input',{bubbles:true}));});
   await page.$eval('.job-key-sheet textarea',e=>{e.value='Read the backup report in the data and say whether last night\'s backup finished.';e.dispatchEvent(new Event('input',{bubbles:true}));});
   const submit=await page.$('.job-key-sheet button[type=submit]');await submit.click();await page.waitForSelector('.job-key-once',{visible:true});}),scope:'.sheet'},
 {name:'jobkeys-key-sheet',route:'#/all',ready:'#settings',before:withJobs(),open:openJobs({},async page=>{await page.click('[data-job-keys] .job-key-row');await page.waitForSelector('.job-key-sheet [data-job-run]');}),scope:'.sheet'},
 {name:'jobkeys-key-runs',route:'#/all',ready:'#settings',before:withJobs(),open:openJobs({},async page=>{await page.click('[data-job-keys] .job-key-row');await page.waitForSelector('.job-key-sheet [data-job-run]');await scrollTo(page,'[data-job-runs]');}),scope:'.sheet'},
 {name:'jobkeys-rotate-confirm',route:'#/all',ready:'#settings',before:withJobs(),open:openJobs({},async page=>{await page.click('[data-job-keys] .job-key-row');await page.waitForSelector('.job-key-sheet [data-job-rotate]');await page.click('[data-job-rotate]');await page.waitForSelector('.job-confirm');}),scope:'.sheet'},
 {name:'jobkeys-rotated-file-error',route:'#/all',ready:'#settings',before:withJobs(),open:openJobs({},async page=>{await page.click('[data-job-keys] .job-key-row');await page.waitForSelector('.job-key-sheet [data-job-rotate]');await page.click('[data-job-rotate]');await page.waitForSelector('.job-confirm');
   await page.evaluate(()=>[...document.querySelectorAll('.job-confirm button')].find(b=>/Rotate/.test(b.textContent)&&!b.classList.contains('sheet-close')).click());await page.waitForSelector('.job-key-once');}),scope:'.sheet'},
 {name:'jobkeys-delete-confirm',route:'#/all',ready:'#settings',before:withJobs(),open:openJobs({},async page=>{await page.click('[data-job-keys] .job-key-row');await page.waitForSelector('.job-key-sheet [data-job-delete]');await page.click('[data-job-delete]');await page.waitForSelector('.job-confirm');}),scope:'.sheet'},

 // Inbox ----------------------------------------------------------------------------------------------------------
 {name:'inbox-list',route:'#/inbox',ready:'.inbox-view .inbox-item',settings:{inbox:true}},
 {name:'inbox-empty',route:'#/inbox',ready:'.inbox-view',settings:{inbox:true},before:async ctx=>{ctx.inboxStore.entries.length=0;ctx.inboxStore.save?.();},open:async page=>{await page.waitForFunction(()=>!document.querySelector('.inbox-view [aria-busy=true]')&&/./.test(document.querySelector('.inbox-view')?.textContent||''));await new Promise(r=>setTimeout(r,300));}},
 {name:'inbox-done-filter',route:'#/inbox',ready:'.inbox-view .inbox-item',settings:{inbox:true},open:async page=>{await page.evaluate(()=>[...document.querySelectorAll('.inbox-view .chip, .inbox-view button')].find(b=>/^Done/.test(b.textContent.trim()))?.click());await new Promise(r=>setTimeout(r,400));}},
 {name:'inbox-entry-alert',route:'#/inbox',ready:'.inbox-view .inbox-item',settings:{inbox:true},open:async page=>{await page.evaluate(()=>[...document.querySelectorAll('.inbox-view .inbox-item')].find(e=>/Elmstead/.test(e.textContent)).querySelector('[data-inbox-open]')?.click());await page.waitForSelector('.inbox-sheet');},scope:'.sheet'},
 {name:'inbox-entry-digest',route:'#/inbox',ready:'.inbox-view .inbox-item',settings:{inbox:true},before:async ctx=>{await fetch(ctx.base+'/api/inbox/digest-cards');},
  open:async page=>{await page.reload();await page.waitForSelector('.inbox-view .inbox-item');await page.evaluate(()=>[...document.querySelectorAll('.inbox-view .inbox-item')].find(e=>/Sat Nov 7/.test(e.textContent)).querySelector('[data-inbox-open]')?.click());await page.waitForSelector('.inbox-sheet');},scope:'.sheet'},
 {name:'inbox-entry-lookahead',route:'#/inbox',ready:'.inbox-view .inbox-item',settings:{inbox:true},before:async ctx=>{await fetch(ctx.base+'/api/inbox/lookahead-cards');},
  open:async page=>{await page.reload();await page.waitForSelector('.inbox-view .inbox-item');await page.evaluate(()=>[...document.querySelectorAll('.inbox-view .inbox-item')].find(e=>/Look-ahead/.test(e.textContent)).querySelector('[data-inbox-open]')?.click());await page.waitForSelector('.inbox-sheet');},scope:'.sheet'},
 {name:'inbox-merged',route:'#/inbox',ready:'.inbox-view .inbox-item',settings:{inbox:true},before:async ctx=>{const s=ctx.inboxStore;s.add({kind:'alert',title:'Harbor gate down',text:'The gate controller is offline.',story:'harbor-gate-sweep',source:'inbox-monitor'},{actor:'cli'});s.add({kind:'alert',title:'Harbor gate: tech on site at 2 pm',text:'Kai is on site at 2 pm.',story:'harbor-gate-sweep',source:'inbox-monitor'},{actor:'cli'});s.add({kind:'alert',title:'Harbor gate: fixed',text:'Kai says it is fixed.',story:'harbor-gate-sweep',source:'inbox-monitor'},{actor:'cli'});},
  open:async page=>{await page.reload();await page.waitForSelector('.inbox-view .inbox-item');await page.evaluate(()=>[...document.querySelectorAll('.inbox-view .inbox-item')].find(e=>/Harbor gate/.test(e.textContent)).querySelector('[data-inbox-open]')?.click());await page.waitForSelector('.inbox-sheet');},scope:'.sheet'},
 // Resolved from the entry's sheet: the sheet closes, the row leaves Open and a toast says so (there is no Undo; Done › Restore).
 {name:'inbox-resolved',route:'#/inbox',ready:'.inbox-view .inbox-item',settings:{inbox:true},open:async page=>{await page.evaluate(()=>[...document.querySelectorAll('.inbox-view .inbox-item')].find(e=>/Elmstead/.test(e.textContent)).querySelector('[data-inbox-open]')?.click());await page.waitForSelector('.inbox-sheet');
   await page.evaluate(()=>[...document.querySelectorAll('.inbox-sheet button')].find(b=>/^Resolved/.test(b.textContent.trim()))?.click());await page.waitForFunction(()=>/Marked resolved/.test(document.querySelector('#toast')?.textContent||''));}},
 {name:'inbox-watch-rules',route:'#/inbox',ready:'#inbox-watch',settings:{inbox:true},open:async page=>{await page.click('#inbox-watch');await page.waitForSelector('.watch-sheet #w-save');},scope:'.sheet'},
 {name:'inbox-watch-schedule',route:'#/inbox',ready:'#inbox-watch',settings:{inbox:true},open:async page=>{await page.click('#inbox-watch');await page.waitForSelector('.watch-sheet #w-save');await scrollTo(page,'[aria-labelledby="w-sched-h"]');},scope:'.sheet'},
 {name:'inbox-watch-models',route:'#/inbox',ready:'#inbox-watch',settings:{inbox:true},open:async page=>{await page.click('#inbox-watch');await page.waitForSelector('.watch-sheet #w-save');await scrollTo(page,'[aria-labelledby="w-fp-h"]');},scope:'.sheet'},
 {name:'inbox-watch-cost',route:'#/inbox',ready:'#inbox-watch',settings:{inbox:true},open:async page=>{await page.click('#inbox-watch');await page.waitForSelector('.watch-sheet #w-save');await scrollTo(page,'.watch-sheet #w-save','end');},scope:'.sheet'},
 {name:'inbox-news-card',route:ctx=>'#/chat/'+ctx.rows[3].id,ready:'.inbox-news',settings:{inbox:true},
  before:async ctx=>{await fetch(ctx.base+'/api/inbox/news-fixture?session='+encodeURIComponent(ctx.rows[3].id)+'&n=1&start=0123456789f1');},open:async page=>{await page.$eval('.inbox-news',e=>e.scrollIntoView({block:'end'}));}},

 // Start pages, the link page and the home header -------------------------------------------------------------------
 {name:'start-link',route:'#/start/0123456789ab',ready:'#first, .start-card, main'},
 {name:'start-handoff',route:'#/start/f00d00000001',ready:'main',before:ctx=>{ctx.modes.handoffs={f00d00000001:{}};return async()=>{delete ctx.modes.handoffs;};},open:async page=>{await new Promise(r=>setTimeout(r,400));}},
 {name:'start-missing',route:'#/start/0123456789zz',ready:'main',open:async()=>{await new Promise(r=>setTimeout(r,400));}},
 // The fixture's document store has no public file, so the page answers it and reloads the frame.
 {name:'link-page',route:'#/link/'+encodeURIComponent('/files/ops-dashboard.html'),ready:'.link-frame',open:async page=>{
  await page.setRequestInterception(true);
  page.on('request',req=>{if(req.isInterceptResolutionHandled?.())return;if(!new URL(req.url()).pathname.startsWith('/files/'))return req.continue();
   return req.respond({status:200,contentType:'text/html',body:'<!doctype html><title>Ops dashboard</title><h1>Ops dashboard</h1><p>Disk 61% used. Backups ran at 2:00.</p>'});});
  await page.evaluate(()=>{const f=document.querySelector('.link-frame');f.src=f.getAttribute('src');});
  const frame=await (await page.waitForSelector('.link-frame')).contentFrame();
  await frame.waitForSelector('h1',{timeout:5000});
 }},
 {name:'home-header',route:'#/all',ready:'#bell'},
];

// Automation is off in a split pane by design (automation.js `on()`), and a pane opens a conversation, not Assistant
// mode's home, so these surfaces do not exist there.
const NO_PANE=['cover','phone','fold','tablet','desktop'];
const AUTOMATION=/^(more-menu|pause|paused|automation|checkbacks|jobkeys|assistant-(home|settings-index|features|appearance-mode))/;
// Accepted measurements, the same on every surface (each checked by looking at the picture or the DOM):
const ALLOW={
 // The home list's "All" filter chip (41 px wide) belongs to the sessions area, not this one.
 small:[/^button "All"$/,
  // The number inputs are 42 px inside a 44 px bordered box (.automation-input) that is the real target.
  /^input#(auto-limits|auto-checkbacks|job-limit)-/,
  // The conversation's name inside the request's sentence ("<name> asks for a job key named …"): an inline link.
  /^a\.vault-request-who\.job-request-from /],
 // Visually hidden screen-reader notes (.vh) are clipped on purpose.
 cut:[/^span#checkback-note-[^ ]+\.vh /],
 covered:[
  // Check-back cards scrolled under the sticky composer toolbar or the chat header: they scroll clear.
  /^button\.chip\.checkback-cancel /,
  // A report table's own sideways scroller in the fixture conversation, under the header or a status line.
  /^div\.report-table /,
  // Content scrolled above or below the visible part of a sheet, where the scrim is hit: it scrolls back into view.
  /^button#s-usage\.opt /,/^button#s-router-reset\.chip /,/^button\.chip "Reset to defaults"$/,/^button#s-(push-|vault|router-on|inbox-watch)/,
  /^button#auto-(pause|jobs)-/,/^input#(auto-checkbacks|job-limit)-/,/^select "(Model default|Haiku)/,/^textarea "/,/^button "(Developer|Assistant) mode"$/,/^button\.opt "Not useful/,
  // Rows under the Updates sheet's sticky action bar: the bar is the sheet's last child, so they scroll clear
  // (checked: scrolled to the end, nothing in view is covered).
  /^input "on"$/,/^a\.chip "(Claude Code|Codex) release notes"$/,/^button\.chip "Switch now"$/,
  // The composer toolbar's own sideways scroller: its arrow sits over the chip it scrolls to.
  /^button#c-approval\.chip /,
  // The home list behind a sheet or under the New conversation button, and the Assistant home's See all under the
  // fixed composer: all scroll clear (the sessions area's own surfaces cover the list).
  /^button\.session-more\.icon "Options for /,/^button\.pin-toggle /,/^a\.home-all /,/^button\.copybtn\.msgcopy /]};
const merge=(own={})=>Object.fromEntries(Object.keys({...ALLOW,...own}).map(k=>[k,[...(ALLOW[k]||[]),...(own[k]||[])]]));
export const surfaces=list.map(s=>({...s,...(AUTOMATION.test(s.name)&&!s.layouts?{layouts:NO_PANE}:{}),allow:merge(s.allow)}));
