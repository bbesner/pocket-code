// 1.119 check-backs, the app half: the card under the reply that set it (every state, placement, Cancel in place, a run
// turning it to Checking back now and then Checked back), the clock on a list row, the Tasks group, Settings → Automation's
// Check-backs group (switch, the rest inactive while off, save, range error, Reset, Cancel all), Pause all counting
// check-backs, the per-device push toggle, the feature switched off, and an unchanged refresh writing nothing. Runs
// inside test/browser.mjs, or alone with POCKET_CHECKBACK_ONLY=1. The settings come from automation.mjs through the 1.117
// fixture (automationFixture), so the switch saved there is what /api/me reports; the real server runs the same flows in
// test/checkback-live-browser.mjs.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {clickControl,elementShot} from './ui-controls.mjs';
import {automationFixture} from './automation-browser.mjs';

const HOUR=3600000;
const iso=ms=>new Date(Math.floor(ms/1000)*1000).toISOString().replace(/\.\d{3}Z$/,'Z'); // the server keeps times to the second
// Today at hh:mm UTC (the check runs the page in UTC, so the words are fixed).
const todayAt=(h,m)=>{const d=new Date();d.setUTCHours(h,m,0,0);return d.getTime();};
const ACTIVE=new Set(['pending','held','running']);

export const checkbackFixture={
 list:[],posts:[],push:null,showInTasks:true,
 reset(){this.list=[];this.posts=[];this.push=null;},
 on(){return automationFixture.value('checkbacks','checkbacks')===true;},
 active(){return this.list.filter(c=>ACTIVE.has(c.status));},
 summary(){const a=this.active();return {on:this.on(),pending:a.filter(c=>c.status!=='running').length,running:a.filter(c=>c.status==='running').length};},
 // A list row's field, built as the server's checkbackRows() does.
 row(r){
  if(!this.on())return r;let cb=null;
  for(const c of this.active().filter(c=>c.sessionId===r.id)){cb??={pending:0,running:false,nextAt:null};if(c.status==='running')cb.running=true;else{cb.pending++;if(!cb.nextAt||Date.parse(c.dueAt)<Date.parse(cb.nextAt))cb.nextAt=c.dueAt;}}
  return cb?{...r,checkback:cb}:r;
 },
 session(id){return this.on()?{checkbacks:this.list.filter(c=>c.sessionId===id).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)).map(c=>({...c}))}:{};},
 tasks(title){
  if(!this.on()||!this.showInTasks)return {};
  return {checkbacks:this.active().sort((a,b)=>Date.parse(a.dueAt)-Date.parse(b.dueAt)).map(c=>({id:c.id,dueAt:c.dueAt,sessionId:c.sessionId,title:title(c.sessionId),note:c.note,status:c.status,...(c.held?{held:{reason:c.held.reason}}:{})}))};
 },
};
automationFixture.checkbackSummary=()=>checkbackFixture.summary();

// Answers /api/checkbacks*, and push prefs while a check has a fake subscription; false when it is not one of them.
export async function checkbackRoute(req,url,json,title){
 const f=checkbackFixture,body=async()=>{let raw='';for await(const c of req)raw+=c;return JSON.parse(raw||'{}');};
 if(f.push&&url.pathname==='/api/push/prefs'){
  if(req.method==='GET')return json({prefs:f.push.prefs}),true;
  const b=await body();f.posts.push({push:b});f.push.prefs={...f.push.prefs,kinds:{...f.push.prefs.kinds,...(b.kinds||{})}};json({ok:true,prefs:f.push.prefs});return true;
 }
 if(!url.pathname.startsWith('/api/checkbacks'))return false;
 if(!f.on()){json({error:'Check-backs are switched off on this Pocket.',code:'checkbacks_off'},404);return true;}
 if(url.pathname==='/api/checkbacks'&&req.method==='GET'){json({checkbacks:f.list.map(c=>({...c,title:title(c.sessionId)})),...f.summary()});return true;}
 if(url.pathname==='/api/checkbacks/cancel'&&req.method==='POST'){
  const b=await body();f.posts.push({cancel:b.id});const c=f.list.find(x=>x.id===b.id);
  if(!c){json({error:'That check-back is gone.',code:'not_found'},404);return true;}
  if(c.status==='running'){json({error:'It is checking back now; stop the reply instead.',code:'running'},409);return true;}
  if(!ACTIVE.has(c.status)){json({error:'That check-back already finished.',code:'finished'},409);return true;}
  c.status='cancelled';delete c.held;c.outcome={kind:'cancelled',at:iso(Date.now())};json({ok:true,checkback:{...c}});return true;
 }
 if(url.pathname==='/api/checkbacks/cancel-all'&&req.method==='POST'){
  await body();f.posts.push('cancel-all');let n=0;
  for(const c of f.list)if(c.status==='pending'||c.status==='held'){c.status='cancelled';delete c.held;c.outcome={kind:'cancelled',at:iso(Date.now())};n++;}
  json({ok:true,cancelled:n,...f.summary()});return true;
 }
 return false;
}

const axeCheck=async(p,repo,sel)=>{if(!await p.evaluate(()=>typeof axe!=='undefined'))await p.addScriptTag({path:path.join(repo,'node_modules/axe-core/axe.min.js')});assert.deepEqual(await p.evaluate(async s=>{const result=await axe.run(s);return result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));},sel),[]);};
const theme=(p,mode)=>p.evaluate(m=>PocketTheme.setPreference(m),mode);

export async function runCheckbackRegressions({p,base,out,repo,rows,conversations,settings,scan}){
 const f=checkbackFixture,a=automationFixture;f.reset();a.reset();
 const shots=process.env.POCKET_CHECKBACK_SHOTS||'/tmp/unattended-1.119-shots';fs.mkdirSync(shots,{recursive:true});
 const shot=async(name,el)=>{await p.evaluate(()=>document.querySelector('#toast')?.classList.remove('show'));if(el){await el.evaluate(e=>e.scrollIntoView({block:'center'}));await elementShot(el,{path:path.join(shots,name+'.png')});}else await p.screenshot({path:path.join(shots,name+'.png')});await p.screenshot({path:path.join(out,'checkback-'+name+'.png')});if(scan)await scan('checkback-'+name);}; // el: just that element
 await p.goto(base+'/#/all');await p.waitForSelector('.session-home');
 const themeBefore=await p.evaluate(()=>PocketTheme.preference),tasksBefore=settings.tasks;
 await p.emulateTimezone('UTC');
 const reload=async hash=>{await p.goto(base+'/'+hash);await p.reload();await p.waitForFunction(()=>window.pocketFeatures&&typeof CheckBacks!=='undefined');};
 const turnOn=async on=>{a.saved={...a.saved,checkbacks:{...a.saved.checkbacks,checkbacks:on}};};

 // The conversation: three owner messages, each answered; check-backs set during each reply.
 const host=rows[3],other=rows[4],T0=Date.now()-3*HOUR,T1=Date.now()-2*HOUR,T2=Date.now()-HOUR;
 const convoBefore=conversations.get(host.id);
 conversations.set(host.id,[
  {role:'user',ts:iso(T0),text:'Publish the stock report, then check that the status page shows the new version.'},
  {role:'assistant',ts:iso(T0+20000),blocks:[{t:'text',text:'Published. The status page updates within the hour, so I set check-backs to confirm it.'}]},
  {role:'user',ts:iso(T1),text:'Also watch the supplier feed import tonight.'},
  {role:'assistant',ts:iso(T1+20000),blocks:[{t:'text',text:'Set. If the import is still running I will wait for it.'}]},
  {role:'user',ts:iso(T2),text:'Thanks. One more for tomorrow morning.'},
  {role:'assistant',ts:iso(T2+20000),blocks:[{t:'text',text:'Done: one for 2:30 PM today and one for tomorrow at 9.'}]},
 ]);
 const due230=iso(todayAt(14,30)),tomorrow9=iso(todayAt(9,0)+24*HOUR),past=iso(T0+40*60000);
 const cb=(id,set,status,extra={})=>({id,sessionId:host.id,engine:'claude',note:'Check the status page shows the new version ('+id+')',dueAt:due230,createdAt:iso(set),status,chainDepth:0,turnStartedAt:iso(set-5000),...extra});
 const gallery=()=>[
  cb('cb-done',T0+5000,'done',{dueAt:past,startedAt:due230,outcome:{kind:'done',at:due230}}),
  cb('cb-failed',T0+6000,'done',{dueAt:past,startedAt:due230,outcome:{kind:'failed',at:due230}}),
  cb('cb-missed',T0+7000,'missed',{dueAt:past,outcome:{kind:'late',at:past,summary:'Pocket was down until 4:10 PM'}}),
  cb('cb-cancelled',T0+8000,'cancelled',{outcome:{kind:'cancelled',at:past}}),
  cb('cb-paused',T1+5000,'held',{held:{reason:'paused',since:iso(T1+6000)}}),
  cb('cb-busy',T1+6000,'held',{held:{reason:'busy',since:iso(T1+7000)}}),
  cb('cb-ceiling',T1+7000,'held',{held:{reason:'plan_ceiling',since:iso(T1+8000)}}),
  cb('cb-daily',T1+8000,'held',{held:{reason:'daily_limit',since:iso(T1+9000)}}),
  cb('cb-running',T1+9000,'running',{startedAt:iso(Date.now()-60000)}),
  cb('cb-today',T2+5000,'pending'),
  cb('cb-tomorrow',T2+6000,'pending',{dueAt:tomorrow9,note:'Check <b>the</b> feed & "stock" counts'}),
 ];
 const texts=()=>p.$$eval('#msgs > [data-checkback]',e=>e.map(x=>[x.dataset.checkback,x.querySelector('.checkback-text').textContent]));
 const openChat=async(id=host.id)=>{await p.goto(base+'/#/chat/'+id);await p.waitForSelector('#msgs .m-asst');};
 const cardOf=id=>`#msgs > [data-checkback="${id}"]`;
 await p.setViewport({width:1440,height:900,isMobile:false,hasTouch:false});await theme(p,'dark');

 // --- Feature off (the default): nothing shows but the settings group and Pause all ---
 f.list=gallery();await reload('#/all');
 assert.equal(await p.evaluate(()=>window.pocketFeatures.checkbacks),false);
 assert.equal(await p.$('.checkback-clock'),null,'no clock while off');
 await openChat();assert.equal(await p.$('#msgs > [data-checkback]'),null,'no card while off');
 settings.tasks=true;await reload('#/tasks');await p.waitForSelector('#tasks-main');assert.equal(await p.$('.checkback-group'),null,'no Tasks group while off');
 await p.evaluate(()=>settingsSheet({category:'notifications'}));await p.waitForSelector('#s-push-alerts');
 assert.equal(await p.$eval('#s-push-automation',e=>e.hidden),false,'the push toggle shows while off (it also carries the limit notices)');await p.keyboard.press('Escape');
 await p.evaluate(()=>settingsSheet({category:'automation'}));await p.waitForSelector('[data-auto-group="checkbacks"]');
 assert.deepEqual(await p.$$eval('[data-auto-group]',e=>e.map(x=>x.dataset.autoGroup)),['pause','limits','checkbacks','jobs']);
 assert.equal(await p.$eval('[data-auto-group="checkbacks"] > h3',e=>e.textContent),'Check-backs');
 assert.equal(await p.$eval('[data-auto-group="checkbacks"]',e=>e.classList.contains('automation-group-off')),true,'reads inactive while off');
 assert.equal(await p.$eval('[data-auto-group="checkbacks"] .automation-inactive-note',e=>e.textContent),'These apply when Check-backs is on.');
 assert.equal(await p.$eval('[data-auto-key="checkbacks"]',e=>e.getAttribute('aria-pressed')),'false');
 assert.equal(await p.$eval('[data-auto-group="checkbacks"] [data-auto-key]',e=>e.dataset.autoKey),'checkbacks','the switch comes first');
 assert.equal(await p.$eval('[data-auto-group="checkbacks"] [data-auto-key="perConversation"]',e=>e.disabled),false,'the rest can be set up before it is turned on');
 assert.equal(await p.$('[data-checkbacks-cancel-all]'),null,'no Cancel all while off');
 assert.ok(await p.$('[data-auto-key="runOverdue"]'),'On Resume, run overdue check-backs is in the Pause all group');
 assert.equal(await p.$eval('[data-auto-key="runOverdue"]',e=>e.closest('[data-auto-group]').dataset.autoGroup),'pause');
 await p.$eval('[data-auto-group="checkbacks"]',e=>e.scrollIntoView({block:'start'}));
 await shot('settings-off-1440-dark');await axeCheck(p,repo,'.settings-sheet');

 // --- The switch: saved, the page follows without a reload ---
 await p.click('[data-auto-key="checkbacks"]');
 await p.waitForFunction(()=>document.querySelector('[data-auto-key="checkbacks"]')?.getAttribute('aria-pressed')==='true');
 assert.equal(a.saved.checkbacks.checkbacks,true);
 await p.waitForFunction(()=>window.pocketFeatures.checkbacks===true&&!document.querySelector('[data-auto-group="checkbacks"]').classList.contains('automation-group-off'));
 assert.equal(await p.$('[data-auto-group="checkbacks"] .automation-inactive-note'),null,'the inactive note goes');
 assert.equal(await p.$eval('[data-auto-advanced="checkbacks"]',e=>e.open),false,'Advanced starts collapsed');
 assert.equal(await p.$eval('[data-auto-key="spacingSec"]',e=>e.checkVisibility()),false,'an advanced setting is under Advanced');
 // N waiting and Cancel all (8: four held, two waiting, the rest finished or running)
 await p.waitForSelector('[data-checkbacks-waiting]');
 assert.equal(await p.$eval('[data-checkbacks-waiting] .automation-waiting-count',e=>e.textContent),'6 waiting');
 assert.equal(await p.$eval('[data-checkbacks-cancel-all]',e=>e.textContent),'Cancel all');
 assert.ok((await p.$$eval('[data-auto-group="checkbacks"] button, [data-auto-group="checkbacks"] .automation-input',e=>e.filter(x=>x.checkVisibility()).map(x=>x.getBoundingClientRect().height))).every(h=>h>=44),'44px controls');
 await p.$eval('[data-auto-group="checkbacks"]',e=>e.scrollIntoView({block:'start'}));
 await shot('settings-on-1440-dark');await axeCheck(p,repo,'.settings-sheet');
 await p.$eval('[data-checkbacks-waiting]',e=>e.scrollIntoView({block:'center'}));await shot('settings-waiting-1440-dark');
 // Saves a value; a value out of range is refused with the server's words and nothing saved; Reset.
 const setNumber=async(key,v)=>{await p.$eval(`[data-auto-key="${key}"]`,(e,v)=>{e.focus();e.value=String(v);e.dispatchEvent(new Event('change'));},v);};
 await setNumber('perConversation',12);
 await p.waitForFunction(()=>document.querySelector('[data-auto-status="checkbacks"]')?.textContent==='Saved.');
 assert.equal(a.saved.checkbacks.perConversation,12);
 await setNumber('perConversation',99);
 await p.waitForFunction(()=>document.querySelector('#auto-checkbacks-perConversation-err')?.textContent);
 assert.match(await p.$eval('#auto-checkbacks-perConversation-err',e=>e.textContent),/^Pending check-backs per conversation must be 1 to 50/);
 assert.equal(await p.$eval('[data-auto-key="perConversation"]',e=>e.value),'12');assert.equal(a.saved.checkbacks.perConversation,12);
 await shot('settings-error-1440-dark');
 await p.click('[data-auto-reset="checkbacks"]');
 await p.waitForFunction(()=>document.querySelector('[data-auto-status="checkbacks"]')?.textContent==='Back to the defaults. Check-backs are off.');
 assert.equal(a.saved.checkbacks,undefined,'Reset clears the group');
 assert.equal(await p.$eval('[data-auto-key="checkbacks"]',e=>e.getAttribute('aria-pressed')),'false','Reset turns the switch back off (its default)');
 await p.waitForFunction(()=>window.pocketFeatures.checkbacks===false);
 // already off: the plain words
 await p.click('[data-auto-reset="checkbacks"]');
 await p.waitForFunction(()=>document.querySelector('[data-auto-status="checkbacks"]')?.textContent==='Back to the defaults.');
 await p.keyboard.press('Escape');await turnOn(true);

 // --- The card under the reply that set it, every state, with the exact words ---
 await reload('#/chat/'+host.id);await p.waitForSelector(cardOf('cb-tomorrow'));
 const words=Object.fromEntries(await texts());
 assert.deepEqual(words,{
  'cb-done':'Checked back 2:30 PM','cb-failed':'Checked back 2:30 PM · the reply didn’t finish',
  'cb-missed':'Missed: Pocket was down until 4:10 PM','cb-cancelled':'Cancelled',
  'cb-paused':'Will check back at 2:30 PM · held while Pocket is paused','cb-busy':'Will check back at 2:30 PM · waiting for the conversation to finish',
  'cb-ceiling':'Will check back at 2:30 PM · held by a plan ceiling','cb-daily':'Will check back at 2:30 PM · held by the daily limit',
  'cb-running':'Checking back now','cb-today':'Will check back at 2:30 PM','cb-tomorrow':words['cb-tomorrow']});
 assert.match(words['cb-tomorrow'],/^Will check back [A-Z][a-z]{2} \d{1,2}(, \d{4})?, 9:00 AM$/,'another day names the date');
 // The other outcomes' words, from the same module the card uses.
 assert.deepEqual(await p.evaluate(()=>['stopped','limit','interrupted'].map(kind=>CheckBacks.lineOf({status:'done',dueAt:'2026-01-01T14:30:00Z',startedAt:new Date(new Date().setUTCHours(14,30,0,0)).toISOString(),outcome:{kind}}))),
  ['Checked back 2:30 PM · stopped','Checked back 2:30 PM · hit a usage limit','Checked back 2:30 PM · cut off by a restart']);
 // Cancel where it can still be cancelled; the full date in a title.
 assert.deepEqual(await p.$$eval('#msgs > [data-checkback]',e=>e.filter(x=>x.querySelector('[data-checkback-cancel]')).map(x=>x.dataset.checkback)),['cb-paused','cb-busy','cb-ceiling','cb-daily','cb-today','cb-tomorrow']);
 assert.match(await p.$eval(cardOf('cb-today')+' time',e=>e.title),/2:30 PM UTC$/);
 assert.match(await p.$eval(cardOf('cb-today')+' .checkback-text',e=>e.title),/^Will check back at 2:30 PM\. Due [A-Z][a-z]+day, [^\n]+\nWhat to check: Check the status page shows the new version \(cb-today\)$/);
 // The note: in the tooltip and the accessible description, escaped, never shown.
 const note=await p.$eval(cardOf('cb-tomorrow'),e=>{const d=document.getElementById(e.getAttribute('aria-describedby'));return {title:e.querySelector('.checkback-text').title,desc:d.textContent,inside:e.contains(d),hidden:getComputedStyle(d).position==='absolute'&&d.getBoundingClientRect().width<=1,tags:d.querySelector('b')!==null};});
 assert.match(note.title,/\nWhat to check: Check <b>the<\/b> feed & "stock" counts$/);
 assert.deepEqual([note.desc,note.inside,note.hidden,note.tags],['What to check: Check <b>the</b> feed & "stock" counts',true,true,false]);
 assert.equal(await p.evaluate(due=>CheckBacks.lineOf({status:'held',dueAt:due,held:{reason:'usage_reset'}}),due230),'Will check back at 2:30 PM · waiting for a usage limit to reset');
 // Placement: the first reply's four, then the second owner message; the second reply's five before the third; the
 // last two under the newest reply.
 const order=await p.$$eval('#msgs > :is(.m-user,.m-asst,[data-checkback])',e=>e.map(x=>x.dataset.checkback||(x.classList.contains('m-user')?'U':'A')));
 assert.deepEqual(order,['U','A','cb-done','cb-failed','cb-missed','cb-cancelled','U','A','cb-paused','cb-busy','cb-ceiling','cb-daily','cb-running','U','A','cb-today','cb-tomorrow']);
 assert.equal(await p.$eval(cardOf('cb-today'),e=>e.previousElementSibling.classList.contains('m-asst')),true,'directly under the reply');
 // Heights: one line; a card without Cancel is as tall as one with it (no shift when the state changes).
 const heights=await p.$$eval('#msgs > [data-checkback]',e=>[...new Set(e.map(x=>Math.round(x.getBoundingClientRect().height)))]);
 assert.equal(heights.length,1,`every card the same height (${heights})`);
 assert.ok(await p.$$eval('#msgs > [data-checkback] .checkback-text',e=>e.every(x=>x.scrollHeight<=x.clientHeight+1)),'one line each');
 await p.$eval(cardOf('cb-done'),e=>e.scrollIntoView({block:'start'}));await shot('cards-1440-dark');await axeCheck(p,repo,'#msgs');

 // --- An unchanged refresh writes nothing: the cards, the row's clock, and (later) the Tasks group ---
 const quiet=(sel)=>p.evaluate(async sel=>{
  if(sessionFetch)await sessionFetch;
  const nodes=[...document.querySelectorAll(sel)].flatMap(n=>[n,...n.querySelectorAll('*')]);
  const set=new Set(nodes),records=[],mo=new MutationObserver(r=>records.push(...r));
  mo.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});
  try{for(let i=0;i<3;i++){await refreshSessions();await CheckBacks.refresh();if(typeof paintTasksView==='function'&&document.getElementById('tasks-main')){await loadTasks(true);paintTasksView();}}await new Promise(r=>setTimeout(r,80));records.push(...mo.takeRecords());}
  finally{mo.disconnect();}
  const ticking=n=>(n.nodeType===1?n:n.parentElement)?.closest?.('[data-run-age]');
  const touched=records.filter(r=>!ticking(r.target)&&(set.has(r.target)||[...r.addedNodes,...r.removedNodes].some(n=>set.has(n)||n.nodeType===1&&n.matches?.(sel))));
  return {nodes:nodes.length,kept:nodes.every(n=>n.isConnected),writes:touched.map(r=>`${r.type} ${r.target.nodeName}.${(r.target.className?.baseVal??r.target.className??'')}${r.attributeName?' @'+r.attributeName:''}`)};
 },sel);
 const assertQuiet=async(where,sel)=>{const q=await quiet(sel);assert.ok(q.nodes>0,where+': something to watch');assert.equal(q.kept,true,where+': the same nodes stay');assert.deepEqual(q.writes,[],where+': nothing written');};
 await assertQuiet('the cards','#msgs > [data-checkback]');

 // --- Cancel on the card: Cancelled in place, the same node, focus kept on the card ---
 const before=await p.$(cardOf('cb-today'));
 await p.focus(cardOf('cb-today')+' [data-checkback-cancel]');await p.keyboard.press('Enter');
 await p.waitForFunction(s=>document.querySelector(s+' .checkback-text')?.textContent==='Cancelled',{},cardOf('cb-today'));
 assert.equal(await p.evaluate((a,b)=>a===b,before,await p.$(cardOf('cb-today'))),true,'the same card, changed in place');
 assert.equal(await p.$eval(cardOf('cb-today'),e=>e.dataset.state),'cancelled');
 assert.equal(await p.$(cardOf('cb-today')+' [data-checkback-cancel]'),null,'no Cancel once cancelled');
 assert.equal(await p.evaluate(s=>document.activeElement===document.querySelector(s),cardOf('cb-today')),true,'focus stays on the card');
 await p.waitForFunction(()=>document.querySelector('#toast')?.textContent==='Check-back cancelled.');
 assert.deepEqual(f.posts.filter(x=>x.cancel),[{cancel:'cb-today'}]);

 // --- A run: Checking back now, then Checked back, in place (the list refresh brings it) ---
 f.list=f.list.filter(c=>!['cb-paused','cb-busy','cb-ceiling','cb-daily','cb-running'].includes(c.id));
 const run=f.list.find(c=>c.id==='cb-tomorrow');
 await p.evaluate(()=>refreshSessions());
 const runCard=await p.$(cardOf('cb-tomorrow'));const h0=await runCard.evaluate(e=>e.getBoundingClientRect().height);
 run.status='running';run.startedAt=iso(Date.now());
 await p.evaluate(()=>refreshSessions());
 await p.waitForFunction(s=>document.querySelector(s+' .checkback-text')?.textContent==='Checking back now',{timeout:8000},cardOf('cb-tomorrow'));
 assert.equal(await runCard.evaluate(e=>e.isConnected&&e.dataset.state),'running');
 assert.equal(await runCard.evaluate(e=>e.getBoundingClientRect().height),h0,'no shift: running is as tall as waiting');
 await shot('card-running-1440-dark');
 run.status='done';run.startedAt=due230;run.outcome={kind:'done',at:iso(Date.now())};
 await p.evaluate(()=>refreshSessions());
 await p.waitForFunction(s=>document.querySelector(s+' .checkback-text')?.textContent==='Checked back 2:30 PM',{timeout:8000},cardOf('cb-tomorrow'));
 assert.equal(await runCard.evaluate(e=>e.isConnected),true,'the same card');
 assert.equal(await runCard.evaluate(e=>e.getBoundingClientRect().height),h0,'no shift: done is as tall as waiting');
 // A held one the list cannot show (busy) still updates while the conversation is open.
 f.list.push(cb('cb-late',T2+7000,'pending'));
 await p.evaluate(()=>refreshSessions());await p.waitForSelector(cardOf('cb-late'));
 f.list.find(c=>c.id==='cb-late').status='held';f.list.find(c=>c.id==='cb-late').held={reason:'busy',since:iso(Date.now())};
 await p.waitForFunction(s=>/waiting for the conversation to finish$/.test(document.querySelector(s+' .checkback-text')?.textContent||''),{timeout:12000},cardOf('cb-late'));

 // --- The list row's clock: appears with a waiting check-back, labelled, and goes ---
 await p.goto(base+'/#/all');await p.waitForSelector(`.session-home [data-item="${host.id}"]`); // the list, not the rail row of the conversation just left
 await p.waitForSelector(`.session-home [data-item="${host.id}"] .checkback-clock`);
 assert.equal(await p.$eval(`[data-item="${host.id}"] .checkback-clock`,e=>e.getAttribute('aria-label')),'Check-back at 2:30 PM');
 assert.equal(await p.$(`[data-item="${other.id}"] .checkback-clock`),null,'no clock without one');
 f.list.push({...cb('cb-other1',T2,'pending'),sessionId:other.id,dueAt:iso(todayAt(16,0)+24*HOUR)},{...cb('cb-other2',T2+1000,'pending'),sessionId:other.id,dueAt:due230});
 await p.evaluate(()=>refreshSessions());await p.waitForSelector(`[data-item="${other.id}"] .checkback-clock`);
 assert.equal(await p.$eval(`[data-item="${other.id}"] .checkback-clock`,e=>e.getAttribute('aria-label')),'2 check-backs, next at 2:30 PM');
 assert.equal(await p.evaluate(()=>CheckBacks.rowLabel({pending:1,running:true,nextAt:new Date(new Date().setUTCHours(14,30,0,0)).toISOString()})),'2 check-backs, one running now, next at 2:30 PM');
 assert.equal(await p.evaluate(()=>CheckBacks.rowLabel({pending:0,running:true,nextAt:null})),'Checking back now');
 await assertQuiet('the row clocks','.checkback-clock');
 await assertQuiet('the rows with a clock',`[data-item="${host.id}"], [data-item="${other.id}"]`);
 const rowEl=await p.$(`[data-item="${other.id}"]`);await shot('row-1440-dark',rowEl);
 // ...and goes when none is left.
 f.list.find(c=>c.id==='cb-late').status='cancelled';delete f.list.find(c=>c.id==='cb-late').held;
 await p.evaluate(()=>refreshSessions());await p.waitForFunction(id=>!document.querySelector(`[data-item="${id}"] .checkback-clock`),{},host.id);

 // --- Tasks: the read-only group, its link and Cancel ---
 f.list.push(cb('cb-t1',T2+8000,'pending',{note:'Confirm the supplier feed imported overnight'}),cb('cb-t2',T2+9000,'held',{note:'Recount aisle 4 after the delivery',dueAt:iso(todayAt(15,0)),held:{reason:'paused',since:iso(Date.now())}}));
 await p.goto(base+'/#/tasks');await p.waitForSelector('.checkback-group');
 assert.equal(await p.$eval('#tk-checkbacks-h',e=>e.textContent),'Check-backs 4');
 const items=await p.$$eval('.checkback-item',e=>e.map(x=>({title:x.querySelector('.title').textContent,status:x.querySelector('.session-status').textContent,href:x.querySelector('a.row').getAttribute('href'),cancel:Boolean(x.querySelector('[data-checkback-cancel]'))})));
 assert.equal(items.length,4);
 const t2=items.find(x=>x.title==='Recount aisle 4 after the delivery');
 assert.match(t2.status,/·Monthly warehouse summary·Held while Pocket is paused$/);assert.equal(t2.href,'#/chat/'+host.id);assert.equal(t2.cancel,true);
 assert.equal(await p.$$eval('.checkback-group :is(input,[data-task-done],[data-remind])',e=>e.length),0,'not editable, not completable, no reminders');
 const groupOrder=await p.$$eval('#tasks-main section h2',e=>e.map(x=>x.id||x.textContent));
 assert.ok(groupOrder.includes('tk-checkbacks-h'),groupOrder.join());
 await assertQuiet('the Tasks group','.checkback-group');
 const group=await p.$('.checkback-group');await shot('tasks-1440-dark',group);await axeCheck(p,repo,'.checkback-group');
 await p.click('[data-checkback-item="cb-t1"] [data-checkback-cancel]');
 await p.waitForFunction(()=>!document.querySelector('[data-checkback-item="cb-t1"]'));
 assert.equal(f.list.find(c=>c.id==='cb-t1').status,'cancelled');
 assert.equal(await p.$eval('#tk-checkbacks-h',e=>e.textContent),'Check-backs 3');
 // The link opens the conversation.
 await p.click('[data-checkback-item="cb-t2"] a.row');await p.waitForFunction(id=>location.hash==='#/chat/'+id,{},host.id);await p.waitForSelector(cardOf('cb-t2'));

 // --- Pause all counts check-backs: the sheet, the toast, the banner, and Resume's toast ---
 a.would={...a.would,checkbacks:3};
 await p.goto(base+'/#/all');await p.waitForSelector('.session-home [data-item]');await p.waitForSelector('#listmore'); // the rail rows of the page just left carry data-item too
 await p.click('#listmore');await p.waitForSelector('.more-menu [data-pause-toggle]');await p.click('.more-menu [data-pause-toggle]');await p.waitForSelector('.pause-sheet [data-pause-would]');
 assert.equal(await p.$eval('[data-pause-would]',e=>e.textContent),'This stops 3 replies running (2 Claude, 1 Codex), 2 background jobs, Inbox Watch. It holds 1 usage-limit retry, 3 check-backs.');
 await shot('pause-sheet-1440-dark');
 a.heldCheckbacks=3;await p.click('[data-pause-go]');await p.waitForSelector('.pause-banner');
 await p.waitForFunction(()=>document.querySelector('#toast')?.textContent==='Paused. Stopped 3 replies running (2 Claude, 1 Codex), 2 background jobs. Held 1 usage-limit retry, 3 check-backs.');
 await p.waitForFunction(()=>document.querySelector('.pause-banner .pause-text')?.textContent==='Pocket is paused. Your own messages still run. 1 usage-limit retry and 3 check-backs are held.');
 a.heldCheckbacks=0;a.resumeCheckbacks={run:2,missed:1};
 await p.click('.pause-banner [data-resume]');await p.waitForFunction(()=>!document.querySelector('.pause-banner'));
 await p.waitForFunction(()=>document.querySelector('#toast')?.textContent==='Resumed. 1 held retry runs again. 2 overdue check-backs run now. 1 check-back was marked missed.');
 a.resumeCheckbacks=null;a.would={...a.would,checkbacks:0};

 // --- The push toggle: shown whether check-backs are on or off, on by default, saves ---
 f.push={endpoint:'https://push.example.test/device-1',prefs:{kinds:{turns:true,reminders:true,vault:true,alerts:true,automation:true},badge:true}};
 await p.evaluate(ep=>{window.pushRegistration=async()=>({pushManager:{getSubscription:async()=>({endpoint:ep})}});},f.push.endpoint);
 await p.evaluate(()=>settingsSheet({category:'notifications'}));await p.waitForFunction(()=>document.querySelector('#s-push-automation')?.disabled===false);
 assert.equal(await p.$eval('#s-push-automation',e=>e.hidden),false);
 assert.equal(await p.$eval('#s-push-automation',e=>e.textContent),'Check-backs and job resultsWhen a check-back has checked back or was missed, and when a limit holds unattended work');
 assert.equal(await p.$eval('#s-push-automation',e=>e.getAttribute('aria-pressed')),'true','on by default');
 await p.click('#s-push-automation');await p.waitForFunction(()=>document.querySelector('#s-push-automation').getAttribute('aria-pressed')==='false');
 assert.deepEqual(f.posts.at(-1),{push:{endpoint:f.push.endpoint,kinds:{automation:false}}});
 await p.waitForFunction(()=>document.querySelector('#toast')?.textContent==='Check-backs and job results off for this device');
 const pushEl=await p.$('#s-push-kinds');await shot('push-1440-dark',pushEl);
 await p.keyboard.press('Escape');

 // --- Cancel all from Settings: confirm first, then the count goes ---
 await p.evaluate(()=>settingsSheet({category:'automation'}));await p.waitForSelector('[data-checkbacks-waiting]');
 const waiting=f.summary().pending;assert.equal(await p.$eval('.automation-waiting-count',e=>e.textContent),`${waiting} waiting`);
 // Keep it as it is: back to Settings → Automation, nothing cancelled.
 await p.click('[data-checkbacks-cancel-all]');await p.waitForSelector('.sheet [data-yes]');
 assert.equal(await p.$eval('.sheet:has([data-yes]) h2',e=>e.textContent),`Cancel ${waiting} check-backs?`);
 assert.equal(await p.$eval('.sheet:has([data-yes]) .sheet-help',e=>e.textContent),'They won’t run. One that is running now finishes.');
 assert.equal(await p.$eval('.sheet:has([data-yes]) [data-yes]',e=>e.textContent),'Cancel all');
 assert.equal(await p.$eval('.sheet:has([data-yes]) [data-no]',e=>e.textContent),'Keep it as it is');
 assert.equal(await p.evaluate(()=>document.activeElement?.matches('[data-yes]')),true,'Cancel all has focus');
 assert.ok(await p.$('.sheet:has([data-yes]) .sheet-back'),'Back to Settings is offered');
 await shot('cancel-all-confirm-1440-dark');await axeCheck(p,repo,'.sheet');
 await p.click('.sheet [data-no]');await p.waitForSelector('[data-checkbacks-waiting]');
 assert.equal(await p.$eval('.automation-waiting-count',e=>e.textContent),`${waiting} waiting`,'nothing cancelled');assert.ok(!f.posts.includes('cancel-all'));
 // Cancel all: back to Settings → Automation, reloaded, with the line gone.
 await p.click('[data-checkbacks-cancel-all]');await p.waitForSelector('.sheet [data-yes]');
 await p.click('.sheet [data-yes]');
 await p.waitForFunction(n=>document.querySelector('#toast')?.textContent===`Cancelled ${n} check-backs.`,{},waiting);
 assert.equal(f.summary().pending,0);assert.ok(f.posts.includes('cancel-all'));
 await p.waitForSelector('.settings-sheet [data-auto-group="checkbacks"]');
 assert.equal(await p.$('[data-checkbacks-waiting]'),null,'gone with nothing waiting');
 await p.keyboard.press('Escape');

 // --- Screenshots: every state at 1440 and 390, light and dark; Settings on and off; the row, Tasks, the pause sheet ---
 f.list=gallery();f.push=null;
 for(const mode of ['dark','light']){
  for(const [w,h,mobile] of [[1440,900,false],[390,844,true]]){
   await p.setViewport({width:w,height:h,isMobile:mobile,hasTouch:mobile});await theme(p,mode);
   await openChat();await p.waitForSelector(cardOf('cb-tomorrow'));
   const sizes=await p.$$eval('#msgs > [data-checkback]',e=>e.map(x=>{const t=x.querySelector('.checkback-text');return {id:x.dataset.checkback,sh:t.scrollHeight,ch:t.clientHeight,h:Math.round(x.getBoundingClientRect().height),w:x.scrollWidth<=x.clientWidth,whole:t.scrollHeight<=t.clientHeight+1,b:[...x.querySelectorAll('button')].map(b=>b.getBoundingClientRect().height)};}));
   assert.equal(new Set(sizes.map(s=>s.h)).size,1,`${w} ${mode}: the cards are one height`);assert.ok(sizes.every(s=>s.w),'no sideways overflow');
   assert.deepEqual(sizes.filter(s=>!s.whole),[],`${w} ${mode}: every line shows whole (what holds it may wrap to a second line on a phone)`);
   if(mobile)assert.ok(sizes.every(s=>s.b.every(h=>h>=44)),'44px Cancel on the phone');
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no sideways scroll');
   await p.$eval(cardOf('cb-done'),e=>e.scrollIntoView({block:'start'}));await shot(`cards-a-${w}-${mode}`);
   await p.$eval(cardOf('cb-paused'),e=>e.scrollIntoView({block:'start'}));await shot(`cards-b-${w}-${mode}`);
   // the newest cards with the transcript at its end, as the owner sees it: they clear the composer
   await p.$eval('#msgs',e=>{let s=e;while(s&&!(s.scrollHeight>s.clientHeight&&/auto|scroll/.test(getComputedStyle(s).overflowY)))s=s.parentElement;if(s)s.scrollTop=s.scrollHeight;});
   assert.equal(await p.$eval(cardOf('cb-tomorrow'),e=>{const r=e.getBoundingClientRect(),c=document.querySelector('.composerwrap')?.getBoundingClientRect();return !c||r.bottom<=c.top+1;}),true,`${w} ${mode}: the newest card clears the composer`);
   await shot(`cards-c-${w}-${mode}`);
   await axeCheck(p,repo,'#msgs');
   for(const on of [true,false]){
    await turnOn(on);await reload('#/all');await p.waitForSelector('[data-item]');
    await p.evaluate(()=>settingsSheet({category:'automation'}));await p.waitForSelector('[data-auto-group="checkbacks"]');
    await p.$eval('[data-auto-group="checkbacks"]',e=>e.scrollIntoView({block:'start'}));
    await shot(`settings-${on?'on':'off'}-${w}-${mode}`);await axeCheck(p,repo,'.settings-sheet');
    assert.equal(await p.$eval('.settings-sheet',e=>e.scrollWidth<=e.clientWidth),true,'no sideways scroll in Settings');
    await p.keyboard.press('Escape');
   }
   await turnOn(true);await reload('#/all');await p.waitForSelector(`[data-item="${host.id}"] .checkback-clock`);
   if(mode==='dark'){
    const r=await p.$(`[data-item="${host.id}"]`);await shot(`row-${w}-${mode}`,r);
    await p.goto(base+'/#/tasks');await p.waitForSelector('.checkback-group');
    const g=await p.$('.checkback-group');await g.evaluate(e=>e.scrollIntoView({block:'start'}));await shot(`tasks-${w}-${mode}`);
    a.would={...a.would,checkbacks:3};await p.goto(base+'/#/all');await p.waitForSelector('.session-home [data-item]');await p.waitForSelector('#listmore'); // Tasks rows carry data-item too
    await p.click('#listmore');await p.waitForSelector('.more-menu [data-pause-toggle]');await p.click('.more-menu [data-pause-toggle]');await p.waitForSelector('[data-pause-would]');
    await shot(`pause-sheet-${w}-${mode}`);await p.click('[data-pause-keep]');await p.waitForFunction(()=>!document.querySelector('.pause-sheet'));a.would={...a.would,checkbacks:0};
   }
  }
 }

 // --- Feature off again: the cards, clocks, Tasks group and push toggle go ---
 await p.setViewport({width:1440,height:900,isMobile:false,hasTouch:false});await theme(p,'dark');
 await turnOn(false);await reload('#/chat/'+host.id);await p.waitForSelector('#msgs .m-asst');
 assert.equal(await p.$('#msgs > [data-checkback]'),null);assert.equal(await p.$('.checkback-clock'),null);
 await p.goto(base+'/#/tasks');await p.waitForSelector('#tasks-main');assert.equal(await p.$('.checkback-group'),null);

 conversations.set(host.id,convoBefore);f.reset();a.reset();settings.tasks=tasksBefore;
 await p.emulateTimezone();await theme(p,themeBefore);await reload('#/all');
}
