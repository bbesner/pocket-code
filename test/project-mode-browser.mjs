// Project mode (conductor), 1.106: the card's switch and its disabled state, Done when and Works in, a step's "Passes when",
// the Conductor/Solo start on New, the conversation's chip and sheet, the model sheet's Default and note, the handoff offer
// size and the handoff card's project line. Nothing beyond the switch shows for a project with the mode off or a
// conversation without projectMode. Runs inside test/browser.mjs (or alone with POCKET_PROJECT_MODE_ONLY=1) on its fixtures.
// Screenshots go to `out`, plus /tmp/project-mode-shots when POCKET_PROJECT_MODE_SHOTS names a folder.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {clickControl} from './ui-controls.mjs';

const LINE='Conversations in this project start with the top model as lead. It plans, hands the work to cheaper models and checks the results.';
const NONE='Needs a top model (Fable or GPT Astra) offered on this server.';
const NOTE='Changing the model restarts the lead without its reasoning. A handoff carries the work over cleanly.';
const WAREHOUSE='warehouse-stock-report',SUPPLIER='supplier-inventory-import';

export async function runProjectModeRegressions({browser,base,rows,out,repo,settings,modes,boardActs,conversations}){
 const context=await browser.createBrowserContext(),page=await context.newPage();page.setDefaultTimeout(8000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 const shots=process.env.POCKET_PROJECT_MODE_SHOTS;if(shots)fs.mkdirSync(shots,{recursive:true});
 // POCKET_PROJECT_MODE_DOM=<dir>: each shot also saves the rendered page as static HTML (scripts out, app.css inline), for a detector URL scan.
 const dom=process.env.POCKET_PROJECT_MODE_DOM;if(dom)fs.mkdirSync(dom,{recursive:true});
 const css=fs.readFileSync(path.join(repo,'public/app.css'),'utf8');
 const saveDom=async name=>{if(!dom)return;const html=await page.evaluate(()=>{const d=document.documentElement.cloneNode(true);d.querySelectorAll('script,link[rel=stylesheet],link[rel=manifest]').forEach(e=>e.remove());return '<!doctype html>'+d.outerHTML;});fs.writeFileSync(path.join(dom,name+'.html'),html.replace('</head>','<style>'+css+'</style></head>'));};
 const shot=async (name,top)=>{if(top)await page.evaluate(()=>{const m=document.getElementById('projects-main');if(m)m.scrollTop=0;document.querySelectorAll('#toast').forEach(t=>t.hidden=true);});await page.screenshot({path:path.join(out,'project-mode-'+name+'.png')});if(shots)await page.screenshot({path:path.join(shots,name+'.png')});await saveDom(name);};
 const axe=async sel=>{const s=await page.addScriptTag({path:path.join(repo,'node_modules/axe-core/axe.min.js')});await s.evaluate(e=>e.remove());
  const r=await page.evaluate(sel=>axe.run(sel,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']}}),sel);
  assert.deepEqual(r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],'axe '+sel);};
 const noOverflow=async label=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no sideways scroll: '+label);
 const view=async(width)=>page.setViewport({width,height:width<900?844:900,isMobile:width<700,hasTouch:width<700});
 const reset=()=>page.evaluate(()=>fetch('/api/board/reset',{method:'POST'}));
 const lastAct=()=>boardActs.at(-1);
 const closeSheet=async()=>{await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.scrim'));};
 const card=async id=>{await page.goto(base+'/?pm='+Math.random().toString(36).slice(2)+'#/projects/'+id);await page.waitForSelector('.project-card [data-mode]');};
 const sections=()=>page.$$eval('.project-card .project-field h2',e=>e.map(h=>h.textContent.trim()));
 const prev={projects:settings.projects,handoffAt:settings.handoffAt,assistantMode:settings.assistantMode,conductor:modes.conductor,conductorStart:modes.conductorStart,projectMode:modes.projectMode,handoffs:modes.handoffs};
 settings.projects=true;modes.conductor={claude:'Fable 5.1',codex:'GPT-6 Astra'};
 const fourth=rows.find(r=>r.state.kind==='finished').id,idle=rows.find(r=>r.state.kind==='idle').id;
 let savedFourth=null;
 try{
  await page.goto(base+'/#/all');await page.waitForSelector('[data-id]');await reset();

  console.log('Project mode: the switch on a card with the mode off, and nothing else');
  await view(1440);await card(WAREHOUSE);
  assert.deepEqual(await page.$eval('[data-mode]',b=>({pressed:b.getAttribute('aria-pressed'),disabled:b.getAttribute('aria-disabled'),text:b.textContent.replace(/\s+/g,' ').trim()})),{pressed:'false',disabled:null,text:'Conductor mode'+LINE});
  assert.ok(!(await sections()).some(h=>/Done when|Works in/.test(h)),'mode off: no Done when or Works in');
  assert.equal(await page.$('.task-pass'),null,'no step checks yet');
  await axe('.project-card');await shot('card-off-1440',true);

  console.log('Project mode: toggling sends update with mode and the card revision');
  const rev=await page.evaluate(id=>projectById(id).revision,WAREHOUSE);
  await clickControl(page,'[data-mode]');await page.waitForFunction(()=>document.querySelector('[data-mode]')?.getAttribute('aria-pressed')==='true');
  assert.deepEqual(lastAct(),{action:'update',mode:'conductor',project:WAREHOUSE,expected_revision:rev});
  assert.deepEqual(await sections(),['Where we left off','Next','Done when','Works in']);
  assert.deepEqual(await page.$$eval('.project-card .project-field .project-empty',e=>e.map(x=>x.textContent)).then(x=>x.filter(t=>t==='Not set.')).then(x=>x.length),2,'unset Done when and Works in read Not set.');

  console.log('Project mode: Edit saves Done when and Works in');
  await clickControl(page,'.project-actions [data-edit]');await page.waitForSelector('.project-editor #pe-done');
  assert.equal(await page.$eval('#pe-done-help',e=>e.textContent),'What finished looks like, as something that can be checked.');
  assert.equal(await page.$eval('#pe-works-help',e=>e.textContent),"Folders and web addresses the lead may change without asking. The project's directory is always included.");
  assert.equal(await page.$eval('#pe-done',e=>e.maxLength),600);
  await page.type('#pe-done','Aisle 4 matches MOM and the adjustment is posted.');
  await page.type('#pe-works','/workspaces/warehouse-tools\n\n  https://staging.example.test/stock  \n');
  await axe('.project-editor');await shot('edit-form-1440');
  await clickControl(page,'.project-editor button.primary');await page.waitForFunction(()=>!document.querySelector('.project-editor'));
  const saved=lastAct();assert.equal(saved.action,'update');assert.equal(saved.doneWhen,'Aisle 4 matches MOM and the adjustment is posted.');
  assert.deepEqual(saved.worksIn,['/workspaces/warehouse-tools','https://staging.example.test/stock'],'one place per line, trimmed, blanks dropped');
  await page.waitForFunction(()=>document.querySelectorAll('.project-works .ledger').length===2);
  assert.match(await page.$eval('.project-card',e=>e.textContent),/Aisle 4 matches MOM and the adjustment is posted\./);
  assert.equal(await page.$eval('.project-works a.ledger',a=>a.getAttribute('href')),'https://staging.example.test/stock');

  console.log('Project mode: a step\'s Passes when shows and saves');
  const step=await page.evaluate(id=>projectById(id).tasks.find(t=>!t.done).id,WAREHOUSE);
  await clickControl(page,`[data-task-more="${step}"]`);await page.waitForSelector('.sheet [data-edit]');await clickControl(page,'.sheet [data-edit]');
  await page.waitForSelector('#step-check');await page.type('#step-check','The recount sheet totals match MOM');
  await axe('.sheet');await clickControl(page,'.sheet button.primary');
  await page.waitForSelector('.task-pass');
  assert.deepEqual((({action,task,check,text})=>({action,task,check,text}))(lastAct()),{action:'task-update',task:step,check:'The recount sheet totals match MOM',text:'Recount aisle 4 excluding Friday delivery'});
  assert.equal(await page.$eval('.task-pass',e=>e.textContent),'Passes when: The recount sheet totals match MOM');
  assert.match(await page.evaluate(id=>projectBriefing(projectById(id)),WAREHOUSE),/Done when: Aisle 4 matches MOM[^\n]*\nWorks in: \/workspaces\/warehouse-tools, https:\/\/staging\.example\.test\/stock[\s\S]*- Recount aisle 4 excluding Friday delivery \(step [a-z0-9]+; passes when: The recount sheet totals match MOM\)[\s\S]*--done-when[\s\S]*task add "…" --check/);
  await axe('.project-card');await noOverflow('card on 1440');await shot('card-on-1440',true);

  console.log('Project mode: the card at 360, 390 and 768');
  for(const w of [360,390,768]){await view(w);await card(WAREHOUSE);await page.waitForSelector('.task-pass');await noOverflow('card '+w);await axe('.project-card');
   assert.ok((await page.$eval('[data-mode]',b=>b.getBoundingClientRect().height))>=44,'44px switch at '+w);
   if(w===390){await shot('card-on-390',true);await clickControl(page,'.project-actions [data-edit]');await page.waitForSelector('.project-editor #pe-done');await noOverflow('edit 390');await shot('edit-form-390');await closeSheet();}}

  console.log('Project mode: no top model on the server turns the switch off, with the reason');
  modes.conductor={claude:null,codex:null};await view(1440);await card(SUPPLIER);
  assert.deepEqual(await page.$eval('[data-mode]',b=>({pressed:b.getAttribute('aria-pressed'),disabled:b.getAttribute('aria-disabled'),sub:b.querySelector('.sub').textContent})),{pressed:'false',disabled:'true',sub:NONE});
  const n=boardActs.length;await clickControl(page,'[data-mode]');await page.waitForFunction(()=>/needs a top model/.test(document.querySelector('#toast')?.textContent||''));
  assert.equal(boardActs.length,n,'nothing is sent');assert.ok(!(await sections()).some(h=>/Done when|Works in/.test(h)));
  await axe('.project-card');await shot('card-disabled-1440',true);
  await view(390);await card(SUPPLIER);await shot('card-disabled-390',true);await view(1440);
  modes.conductor={claude:'Fable 5.1',codex:'GPT-6 Astra'};

  console.log('Project mode: Start conversation on a Conductor project offers Conductor (default) and Solo');
  let started=null;await page.setRequestInterception(true);
  const onRequest=r=>{if(r.url().endsWith('/api/new')&&r.method()==='POST'){started=JSON.parse(r.postData());r.respond({status:202,contentType:'application/json',body:JSON.stringify({id:fourth})});}else r.continue();};
  page.on('request',onRequest);
  // A model and effort left picked on New from an earlier start: the Conductor start must not send them.
  const sticky=await page.evaluate(()=>{const m=MODELS.filter(x=>x[0]!=='default').at(-1)[0];localStorage.setItem('pc-prefs-new',JSON.stringify({model:m,effort:'medium'}));return {model:m,effort:'medium'};});
  await card(WAREHOUSE);await clickControl(page,'.project-actions [data-start]');await page.waitForSelector('#new-start-mode:not([hidden])');
  await page.waitForFunction(()=>tb?.prefs.model==='default'&&tb.prefs.effort==='default');
  assert.deepEqual(await page.evaluate(()=>(({model,effort})=>({model,effort}))(JSON.parse(localStorage.getItem('pc-prefs-new')))),sticky,'Default here is not saved over the picks');
  assert.match(await page.$eval('#task-context',e=>e.textContent),/Start Conductor · Fable 5\.1 leads/);
  // 1.106.1: the start shows as a chip beside the project chip, and Model and Effort name what it runs (Brad saw his
  // server default, Opus 5.5, here and took the start for an ordinary one).
  assert.equal(await page.$eval('#new-mode',e=>e.hidden?'hidden':e.textContent),'Conductor');
  assert.equal(await page.evaluate(()=>document.getElementById('new-project').nextElementSibling.id),'new-mode','beside the project chip');
  assert.match(await page.$eval('#c-model',e=>e.textContent),/Fable 5\.1/,'New: Default names the lead');
  assert.match(await page.$eval('#c-eff',e=>e.textContent),/High/,'New: Default effort is High');
  await shot('start-chips-1440');
  await clickControl(page,'#c-model');await page.waitForSelector('.sheet [data-v="default"]');
  assert.equal(await page.$eval('.sheet [data-v="default"] .sub',e=>e.textContent),"Fable 5.1 · this project's lead");
  assert.equal(await page.$eval('.sheet .sheet-note',e=>e.textContent),'Default is the lead. Another model here runs in its place, still as Conductor.');await closeSheet();
  await clickControl(page,'#c-eff');await page.waitForSelector('.sheet [data-v="default"]');
  assert.equal(await page.$eval('.sheet [data-v="default"] .sub',e=>e.textContent),"High · this project's Conductor start");await closeSheet();
  await clickControl(page,'#new-mode');await page.waitForSelector('.sheet [data-v="solo"]');
  assert.deepEqual(await page.$$eval('.sheet [data-v]',e=>e.map(o=>[o.dataset.v,o.classList.contains('sel'),o.querySelector('.sub').textContent])),
   [['conductor',true,'Fable 5.1 leads at high effort and hands out the work'],['solo',false,'Opus 5.5 does the work itself. For a small task.']]);
  await axe('.sheet');await shot('start-chip-sheet-1440');
  await clickControl(page,'.sheet [data-v="solo"]');await page.waitForFunction(()=>!document.querySelector('.scrim'));
  assert.equal(await page.$eval('#new-mode',e=>e.textContent),'Solo');
  assert.match(await page.$eval('#c-model',e=>e.textContent),/Opus 5\.5/,'Solo: Default names its model');assert.match(await page.$eval('#c-eff',e=>e.textContent),/High/);
  assert.match(await page.$eval('#task-context',e=>e.textContent),/Start Solo/,'the setup summary follows the chip');
  await clickControl(page,'#new-mode');await page.waitForSelector('.sheet [data-v="conductor"]');await clickControl(page,'.sheet [data-v="conductor"]');await page.waitForFunction(()=>!document.querySelector('.scrim'));
  assert.match(await page.$eval('#c-model',e=>e.textContent),/Fable 5\.1/);
  await clickControl(page,'#choose-workspace');await page.waitForSelector('#spick .row',{visible:true});
  assert.deepEqual(await page.$$eval('#spick .row',e=>e.map(r=>[r.dataset.s,r.getAttribute('aria-checked'),r.textContent.replace(/\s+/g,' ').trim()])),
   [['conductor','true','ConductorFable 5.1 leads at high effort and hands out the work'],['solo','false','SoloOne model does the work itself. For a small task.']]);
  await axe('#new-setup');await noOverflow('new 1440');await page.$eval('#new-setup',e=>e.scrollIntoView({block:'start'}));await shot('start-1440');
  console.log('Project mode: Codex names its own lead; an agent without one starts as usual');
  await clickControl(page,'[data-a="codex"]');assert.match(await page.$eval('#spick-lead',e=>e.textContent),/^GPT-6 Astra leads/);
  assert.match(await page.$eval('#c-model',e=>e.textContent),/GPT-6 Astra/,'Codex: Default names its lead');
  // New reads the card's mode and the leads again from the board, so the server's answer (no Codex lead) wins over the tap.
  modes.conductor={claude:'Fable 5.1',codex:null};
  await page.evaluate(()=>route());await page.waitForSelector('#new-start-mode:not([hidden])');await page.waitForFunction(()=>document.getElementById('spick').hidden);
  modes.conductor={claude:'Fable 5.1',codex:'GPT-6 Astra'};
  assert.equal(await page.$eval('#spick',e=>e.hidden),true);
  assert.equal(await page.$eval('#new-start-none',e=>e.textContent),'Codex has no top model on this server, so this conversation starts as usual.');
  assert.equal(await page.$eval('#new-mode',e=>e.hidden),true,'no start chip where the start does not apply');
  assert.doesNotMatch(await page.$eval('#c-model',e=>e.textContent),/Astra/,'and Default is the usual one');
  assert.doesNotMatch(await page.$eval('#task-context',e=>e.textContent),/Start/);
  await clickControl(page,'#choose-workspace');
  if(await page.$eval('[data-a="acp"]',e=>!e.hidden)){await clickControl(page,'[data-a="acp"]');
   assert.equal(await page.$eval('#new-start-none',e=>e.textContent),'OpenRouter conversations start as usual. Conductor mode runs on Claude Code and Codex.','the engine reports projectMode false');}
  await clickControl(page,'[data-a="claude"]');
  console.log('Project mode: Solo is sent as projectStart');
  await clickControl(page,'#spick [data-s="solo"]');assert.equal(await page.$eval('#spick [data-s="solo"]',e=>e.getAttribute('aria-checked')),'true');
  assert.match(await page.$eval('#task-context',e=>e.textContent),/Start Solo/);
  await clickControl(page,'#start');await page.waitForFunction(()=>location.hash.startsWith('#/chat/'));
  assert.equal(started.projectStart,'solo');assert.equal(started.project,WAREHOUSE);assert.equal(started.provider,'claude');
  assert.equal(started.model,undefined,'the sticky model is not sent');assert.equal(started.effort,undefined,'the sticky effort is not sent');
  // The saved effort stays underneath. (The Claude model was dropped earlier by the visit to Codex, which has always reset
  // a pick the other agent cannot run.)
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pc-prefs-new')).effort),sticky.effort,'the saved effort stays underneath');
  console.log('Project mode: a model and effort picked on that screen are sent');
  await card(WAREHOUSE);await clickControl(page,'.project-actions [data-start]');await page.waitForSelector('#new-start-mode:not([hidden])');
  await page.waitForFunction(()=>tb?.prefs.model==='default');
  await clickControl(page,'#c-model');await page.waitForSelector('.sheet [data-v="default"]');
  const picked=await page.$eval('.sheet [data-v]:not([data-v="default"])',e=>e.dataset.v);await clickControl(page,`.sheet [data-v="${picked}"]`);await page.waitForFunction(()=>!document.querySelector('.scrim'));
  await clickControl(page,'#c-eff');await page.waitForSelector('.sheet [data-v="high"]');await clickControl(page,'.sheet [data-v="high"]');await page.waitForFunction(()=>!document.querySelector('.scrim'));
  started=null;await clickControl(page,'#start');await page.waitForFunction(()=>location.hash.startsWith('#/chat/'));
  assert.equal(started.model,picked);assert.equal(started.effort,'high');assert.equal(started.projectStart,'conductor');

  console.log('Project mode: the Start control at 390, and removing the link removes it');
  await view(390);await card(WAREHOUSE);await clickControl(page,'.project-actions [data-start]');await page.waitForSelector('#new-start-mode:not([hidden])');
  await clickControl(page,'#choose-workspace');await page.waitForSelector('#spick .row',{visible:true});
  assert.equal(await page.$eval('#spick [data-s="conductor"]',e=>e.getAttribute('aria-checked')),'true','each start defaults to Conductor');
  await noOverflow('new 390');await axe('#new-setup');await page.$eval('#new-setup',e=>e.scrollIntoView({block:'start'}));await shot('start-390');
  await clickControl(page,'#new-project');await page.waitForSelector('.sheet [data-yes]');await clickControl(page,'.sheet [data-yes]');
  await page.waitForFunction(()=>document.querySelector('#new-start-mode').hidden);assert.doesNotMatch(await page.$eval('#task-context',e=>e.textContent),/Start/);
  console.log('Project mode: a project with the mode off gets no Start control');
  await view(1440);await card(SUPPLIER);await clickControl(page,'.project-actions [data-start]');await page.waitForSelector('#new-project:not([hidden])');
  assert.equal(await page.$eval('#new-start-mode',e=>e.hidden),true);
  assert.equal(await page.$eval('#new-mode',e=>e.hidden),true);
  await page.evaluate(()=>{localStorage.removeItem('pc-new-start');});
  page.off('request',onRequest);await page.setRequestInterception(false);

  console.log('Project mode: the project options sheet says how Start begins and switches the mode (1.106.1)');
  const options=async()=>{await page.goto(base+'/?pm='+Math.random().toString(36).slice(2)+'#/projects');await page.waitForSelector(`[data-project-more="${WAREHOUSE}"]`);
   await clickControl(page,`[data-project-more="${WAREHOUSE}"]`);await page.waitForSelector('.sheet [data-start]');
   return page.$$eval('.sheet [data-start],.sheet [data-mode]',e=>e.map(b=>[b.firstElementChild.nextElementSibling.firstChild.textContent,b.querySelector('.sub').textContent]));};
  assert.deepEqual(await options(),[['Start a conversation','Conductor: Fable 5.1 leads. Briefed on where the project stands, linked to it'],
   ['Turn off Conductor mode','Conversations here go back to your usual model at their next reply']]);
  await axe('.sheet');await shot('options-1440');
  await clickControl(page,'.sheet [data-mode]');await page.waitForFunction(()=>!document.querySelector('.scrim'));
  await page.waitForFunction(p=>projectById(p)?.mode!=='conductor',{},WAREHOUSE);assert.deepEqual([lastAct().action,lastAct().mode],['update','off']);
  assert.deepEqual(await options(),[['Start a conversation','A new conversation briefed on where the project stands, linked to it'],
   ['Turn on Conductor mode','New conversations here start with Fable 5.1 as lead, handing the work to cheaper models']]);
  await clickControl(page,'.sheet [data-mode]');await page.waitForFunction(()=>!document.querySelector('.scrim'));
  await page.waitForFunction(p=>projectById(p)?.mode==='conductor',{},WAREHOUSE);assert.deepEqual([lastAct().action,lastAct().mode],['update','conductor']);
  await clickControl(page,`[data-project-more="${WAREHOUSE}"]`);await page.waitForSelector('.sheet [data-start]');await clickControl(page,'.sheet [data-start]');
  await page.waitForSelector('#new-mode:not([hidden])');assert.match(await page.$eval('#c-model',e=>e.textContent),/Fable 5\.1/,'Start from the sheet is a Conductor start');
  await page.evaluate(()=>{localStorage.removeItem('pc-new-start');});

  console.log('Project mode: a start the server could not link says so');
  modes.projectLinkError='This project already has 50 conversations. Unlink one first.';
  try{
   await card(WAREHOUSE);await clickControl(page,'.project-actions [data-start]');await page.waitForSelector('#new-start-mode:not([hidden])');
   await clickControl(page,'#start');await page.waitForFunction(()=>location.hash.startsWith('#/chat/'));
   await page.waitForFunction(()=>/^Started, but not linked to /.test(document.querySelector('#toast')?.textContent||''));
   assert.match(await page.$eval('#toast',e=>e.textContent),/Started, but not linked to Warehouse stock report: This project already has 50 conversations\. Unlink one first\./);
  }finally{delete modes.projectLinkError;}

  console.log('Project mode: the conversation chip, its sheet, the model sheet and the handoff offer size');
  settings.handoffAt=0;
  // Earlier suites may leave this conversation ending on a sent message (no offer then); give it a finished reply here.
  savedFourth=conversations.get(fourth);conversations.set(fourth,[{role:'user',text:'Count the stock.'},{role:'assistant',blocks:[{t:'text',text:'Counted. The report is ready.'}]}]);
  modes.projectMode={[fourth]:{project:{id:WAREHOUSE,name:'Warehouse stock report'},start:'conductor',model:'claude-fable-5-1[1m]',modelLabel:'Fable 5.1',effort:'high',handoffAt:150000}};
  await page.evaluate(([p,s])=>fetch('/api/board/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'link-session',project:p,session:s})}),[WAREHOUSE,fourth]);
  await page.goto(base+'/?pm=chat#/chat/'+fourth);await page.waitForSelector('#mode-open:not([hidden])');
  assert.equal(await page.$eval('#mode-open',e=>e.textContent),'Conductor');
  assert.equal(await page.evaluate(()=>{const a=document.getElementById('project-open'),b=document.getElementById('mode-open');return a.nextElementSibling===b;}),true,'beside the project chip');
  assert.match(await page.$eval('#c-model',e=>e.textContent),/Fable 5\.1/,'Default names the lead');
  await page.waitForSelector('.handoff-offer');
  await shot('chip-1440');
  await clickControl(page,'#mode-open');await page.waitForSelector('.sheet .sheet-help');
  assert.deepEqual(await page.$eval('.sheet',s=>[s.querySelector('h2').textContent,s.querySelector('.sheet-name').textContent,s.querySelector('.sheet-help').textContent]),
   ['Conductor','Warehouse stock report','Fable 5.1 leads this conversation at high effort. It plans the work, hands each piece to a cheaper model and checks what comes back.']);
  await axe('.sheet');await shot('chip-sheet-1440');await closeSheet();
  await clickControl(page,'#c-model');await page.waitForSelector('.sheet [data-v="default"]');
  assert.equal(await page.$eval('.sheet [data-v="default"] .sub',e=>e.textContent),"Fable 5.1 · this project's lead");
  assert.equal(await page.$eval('.sheet .sheet-note',e=>e.textContent),NOTE);
  await axe('.sheet');await shot('model-sheet-1440');await closeSheet();
  await view(390);await page.goto(base+'/?pm=chat390#/chat/'+fourth);await page.waitForSelector('#mode-open:not([hidden])');await noOverflow('chat 390');
  await page.$eval('#mode-open',e=>e.scrollIntoView({inline:'center',block:'nearest'}));await shot('chip-390');
  await clickControl(page,'#mode-open');await page.waitForSelector('.sheet .sheet-help');await shot('chip-sheet-390');await closeSheet();
  await view(1440);

  console.log('Project mode: Solo names its model, and has no note');
  modes.projectMode[fourth]={...modes.projectMode[fourth],start:'solo',model:'claude-opus-5-5[1m]',modelLabel:'Opus 5.5'};
  await page.goto(base+'/?pm=solo#/chat/'+fourth);await page.waitForSelector('#mode-open:not([hidden])');
  assert.equal(await page.$eval('#mode-open',e=>e.textContent),'Solo');
  await clickControl(page,'#c-model');await page.waitForSelector('.sheet [data-v="default"]');
  assert.equal(await page.$eval('.sheet [data-v="default"] .sub',e=>e.textContent),"Opus 5.5 · this project's Solo model");
  assert.equal(await page.$('.sheet .sheet-note'),null);await closeSheet();

  console.log('Project mode: no projectMode, no chip, the usual Default, no offer below the server\'s size');
  modes.projectMode={};await page.goto(base+'/?pm=none#/chat/'+fourth);await page.waitForSelector('#c-model');await page.waitForFunction(()=>document.getElementById('ctx-ring')?.dataset.tip?.includes('tokens'));
  assert.equal(await page.$eval('#mode-open',e=>e.hidden),true);
  assert.equal(await page.$('.handoff-offer'),null,'the server offers none here (handoffAt 0)');
  await clickControl(page,'#c-model');await page.waitForSelector('.sheet [data-v="default"]');
  assert.doesNotMatch(await page.$eval('.sheet [data-v="default"] .sub',e=>e.textContent),/this project/);assert.equal(await page.$('.sheet .sheet-note'),null);await closeSheet();

  console.log('Project mode: linking or unlinking from the conversation repaints the chip, Default and the offer');
  await page.evaluate(([p,s])=>fetch('/api/board/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'unlink-session',project:p,session:s})}),[WAREHOUSE,fourth]);
  await page.goto(base+'/?pm=link#/chat/'+fourth);await page.waitForFunction(()=>/Add project/.test(document.getElementById('project-open')?.textContent||''));
  assert.equal(await page.$eval('#mode-open',e=>e.hidden),true);
  modes.projectMode={[fourth]:{project:{id:WAREHOUSE,name:'Warehouse stock report'},start:'conductor',model:'claude-fable-5-1[1m]',modelLabel:'Fable 5.1',effort:'high',handoffAt:150000}}; // what the server reports once linked
  await clickControl(page,'#project-open');await page.waitForSelector(`.sheet [data-v="${WAREHOUSE}"]`);await clickControl(page,`.sheet [data-v="${WAREHOUSE}"]`);
  await page.waitForSelector('#mode-open:not([hidden])');
  assert.match(await page.$eval('#c-model',e=>e.textContent),/Fable 5\.1/,'Default names the lead without a reload');
  await page.waitForSelector('.handoff-offer');
  modes.projectMode={};
  await page.evaluate(([p,s])=>boardAct({action:'unlink-session',project:p,expected_revision:projectById(p).revision,session:s}),[WAREHOUSE,fourth]);
  await page.waitForFunction(()=>document.getElementById('mode-open').hidden&&!document.querySelector('.handoff-offer'));

  console.log('Project mode: Assistant mode shows no switch, no Works in and no Start choice (1.106.1)');
  settings.assistantMode=true;
  await page.evaluate(p=>fetch('/api/board/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'update',project:p,mode:'conductor',doneWhen:'Aisle 4 reconciles.',worksIn:['/workspaces/warehouse']})}),WAREHOUSE);
  await page.goto(base+'/?pm=asst#/projects/'+WAREHOUSE);await page.waitForSelector('.project-card .project-field h2');
  assert.equal(await page.$('.project-card [data-mode]'),null,'Assistant mode: no Conductor switch');
  assert.deepEqual((await sections()).filter(h=>/Done when|Works in/.test(h)),['Done when'],'Assistant mode: Done when stays, Works in goes');
  await clickControl(page,'.project-actions [data-edit]');await page.waitForSelector('.project-editor #pe-done');
  assert.equal(await page.$('#pe-works'),null,'Assistant mode: no Works in field in Edit');
  await clickControl(page,'.project-editor button.primary');await page.waitForFunction(()=>!document.querySelector('.project-editor'));
  assert.equal('worksIn' in lastAct(),false,'saving Edit leaves the hidden Works in list alone');
  await page.goto(base+'/?pm=asst2#/projects/'+WAREHOUSE);await page.waitForSelector('.project-actions [data-start]');
  await clickControl(page,'.project-actions [data-start]');await page.waitForSelector('#new-project:not([hidden])');
  assert.equal(await page.$eval('#new-start-mode',e=>e.hidden),true,'Assistant mode: no Conductor or Solo choice on New');
  assert.equal(await page.$eval('#new-mode',e=>e.hidden),true,'Assistant mode: no start chip');
  await page.goto(base+'/?pm=asst3#/projects');await page.waitForSelector(`[data-project-more="${WAREHOUSE}"]`);
  await clickControl(page,`[data-project-more="${WAREHOUSE}"]`);await page.waitForSelector('.sheet [data-start]');
  assert.equal(await page.$('.sheet [data-mode]'),null,'Assistant mode: no Conductor option in the sheet');
  assert.equal(await page.$eval('.sheet [data-start] .sub',e=>e.textContent),'A new conversation briefed on where the project stands, linked to it');
  assert.doesNotMatch(await page.$eval('.sheet [data-edit] .sub',e=>e.textContent),/works in/);await closeSheet();
  await page.evaluate(()=>{localStorage.removeItem('pc-new-start');});
  settings.assistantMode=false;await reset();

  console.log('Project mode: a handoff card continues in the project');
  const hid='f00d000000a6';modes.handoffs={...(modes.handoffs||{}),[hid]:{projectName:'Warehouse stock report',projectStart:'conductor'}};
  const convo=conversations.get(idle);convo.push({role:'assistant',blocks:[{t:'text',text:'Ready for a fresh start.\n\n'+base+'/#/start/'+hid}]});
  await page.goto(base+'/?pm=handoff#/chat/'+idle);await page.waitForSelector(`[data-handoff="${hid}"] .handoff-meta`);
  assert.equal(await page.$eval(`[data-handoff="${hid}"] .handoff-meta`,e=>e.textContent),'warehouse · Claude · Review actions · Continues in Warehouse stock report · Conductor');
  convo.pop();delete modes.handoffs[hid];
  assert.deepEqual(errors,[]);
 }finally{
  if(savedFourth)conversations.set(fourth,savedFourth);
  Object.assign(settings,{projects:prev.projects,handoffAt:prev.handoffAt,assistantMode:prev.assistantMode});Object.assign(modes,{conductor:prev.conductor,conductorStart:prev.conductorStart,projectMode:prev.projectMode,handoffs:prev.handoffs});
  await page.evaluate(()=>fetch('/api/board/reset',{method:'POST'})).catch(()=>{});await context.close();
 }
}
