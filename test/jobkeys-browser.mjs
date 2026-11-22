// Job keys, the app half against a fixture: the states the real server is slow or awkward to reach. Settings →
// Automation → Job keys with the feature off (no list, no call) and on (a running key, a key that is off with Full
// access), an unchanged refresh writing nothing in the list or the runs, a row changing state in place at the same
// height, a key that has run (Folder and Agent read-only with the server's reason; Full access kept for a key that has
// it even where the server no longer offers it), Recent runs in every status and failed outcome, and a Rotate whose key
// file could not be written (the server's fileError in plain words, the key gone from the page once closed). Runs
// inside test/browser.mjs, or alone with POCKET_JOBKEYS_ONLY=1. The jobs switch is the 1.117 automation fixture's, so
// what Settings saves is what /api/me reports. The real server runs the full flow in test/jobkeys-live-browser.mjs.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {elementShot} from './ui-controls.mjs';
import {automationFixture} from './automation-browser.mjs';

const MIN=60000;
const iso=ms=>new Date(Math.floor(ms/1000)*1000).toISOString();
const SECRET='pjk_'+'fixtureOnlyNotARealKey0123456789abcdefghij'.slice(0,43); // made up: the fixture's only key text

export const jobsFixture={
 keys:[],runs:{},posts:[],gets:0,fileError:null,
 on(){return automationFixture.value('jobs','jobs')===true;},
 defaults(){return {access:'ask',mayAddInstructions:false,pushWhenDone:true,limits:{perHour:6,perDay:24,atOnce:1},folder:'~/.config/pocket/jobs/',fullAccessAllowed:false,workspace:null,engines:['claude','codex']};},
 reset(){
  const now=Date.now();this.posts=[];this.gets=0;this.fileError={error:'Pocket could not write the key file: the folder is read-only.',code:'file_error'};
  const base={instruction:'Read the disk report in the data and say which volumes need attention. Change nothing.',mayAddInstructions:false,limits:{perHour:6,perDay:24,atOnce:1},pushWhenDone:true,createdAt:iso(now-3*24*60*MIN),rotatedAt:null};
  this.keys=[
   {...base,id:'jk-disk0001',name:'disk-check',title:'Disk check',workspace:'/home/owner/ops',engine:'claude',model:'default',effort:null,access:'ask',enabled:true,lastRunAt:iso(now-60*MIN),hasRun:true,running:1,keyFile:'/home/owner/.config/pocket/jobs/disk-check.key'},
   {...base,id:'jk-night001',name:'nightly-report',title:'Nightly report',workspace:'/home/owner/reports',engine:'codex',model:'default',effort:null,access:'full',enabled:false,lastRunAt:null,hasRun:false,running:0,instruction:'Summarise the nightly report in the data in five lines.'},
  ];
  const run=(n,status,ago,extra={})=>({run:'jr-fixture'+n,keyId:'jk-disk0001',name:'disk-check',conversation:'job-conv-'+n,status,startedAt:iso(now-ago*MIN),...extra});
  this.runs={'jk-disk0001':[
   run(1,'starting',1),
   run(2,'needs_you',20),
   run(3,'done',60,{endedAt:iso(now-59*MIN),reply:'Volume sda1 is at 91%; the others are fine.'}),
   run(4,'failed',120,{endedAt:iso(now-119*MIN),outcome:'interrupted'}),
   run(5,'failed',180,{endedAt:iso(now-179*MIN),outcome:'error',reply:'The disk report was empty.'}),
  ],'jk-night001':[]};
 },
 view(k){return {...k};},
};

// Answers /api/jobs/*; false when the request is not one of them.
export async function jobsRoute(req,url,json){
 const f=jobsFixture,body=async()=>{let raw='';for await(const c of req)raw+=c;return JSON.parse(raw||'{}');};
 if(!url.pathname.startsWith('/api/jobs/'))return false;
 if(!f.on()){json({error:'Job keys are switched off on this Pocket.',code:'jobs_off'},404);return true;}
 if(url.pathname==='/api/jobs/keys'&&req.method==='GET'){f.gets++;json({keys:f.keys.map(k=>f.view(k)),defaults:f.defaults()});return true;}
 const m=url.pathname.match(/^\/api\/jobs\/keys\/([^/]+)(?:\/(runs|enable|disable|rotate|delete))?$/);if(!m)return false;
 const k=f.keys.find(x=>x.id===m[1]);if(!k){json({error:'There is no job key with that id.',code:'not_found'},404);return true;}
 if(m[2]==='runs'){json({runs:(f.runs[k.id]||[]).map(r=>({...r}))});return true;}
 const b=req.method==='POST'?await body():{};f.posts.push({id:k.id,what:m[2]||'update',body:b});
 if(m[2]==='rotate'){k.rotatedAt=iso(Date.now());json({key:f.view(k),secret:SECRET,fileError:f.fileError,note:'This is the only time the key is shown. The old key stopped working.'});return true;}
 if(m[2]==='enable'||m[2]==='disable'){k.enabled=m[2]==='enable';json({key:f.view(k)});return true;}
 if(m[2]==='delete'){f.keys=f.keys.filter(x=>x!==k);json({ok:true});return true;}
 if(k.hasRun&&(('workspace' in b&&b.workspace!==k.workspace)||('engine' in b&&b.engine!==k.engine))){json({error:'This key has run, so its folder and agent stay as they are. Create a new key for another folder or agent.',code:'fixed_after_run'},409);return true;}
 const changed=Object.keys(b).filter(x=>JSON.stringify(b[x])!==JSON.stringify(k[x]));Object.assign(k,b);json({key:f.view(k),changed});return true;
}

const axeCheck=async(p,repo,sel)=>{if(!await p.evaluate(()=>typeof axe!=='undefined'))await p.addScriptTag({path:path.join(repo,'node_modules/axe-core/axe.min.js')});assert.deepEqual(await p.evaluate(async s=>{const result=await axe.run(s);return result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));},sel),[]);};
// Watches a node for `ms` and returns how many writes it saw.
const writesDuring=(p,sel,ms)=>p.evaluate(async(sel,ms)=>{const el=document.querySelector(sel),recs=[],mo=new MutationObserver(r=>recs.push(...r));mo.observe(el,{subtree:true,childList:true,attributes:true,characterData:true});await new Promise(r=>setTimeout(r,ms));recs.push(...mo.takeRecords());mo.disconnect();return recs.length;},sel,ms);

export async function runJobKeysRegressions({p,base,out,repo,scan}){
 const f=jobsFixture,a=automationFixture;a.reset();f.reset();
 const shots=process.env.POCKET_JOBKEYS_SHOTS||'/tmp/unattended-jobkeys-shots';fs.mkdirSync(shots,{recursive:true});
 const shot=async(name,el)=>{await p.evaluate(()=>document.querySelector('#toast')?.classList.remove('show'));if(el){await el.evaluate(e=>e.scrollIntoView({block:'center'}));await elementShot(el,{path:path.join(shots,'fixture-'+name+'.png')});}else await p.screenshot({path:path.join(shots,'fixture-'+name+'.png')});await p.screenshot({path:path.join(out,'jobkeys-'+name+'.png')});if(scan)await scan('jobkeys-'+name);};
 const automation=async()=>{await p.evaluate(()=>settingsSheet({category:'automation'}));await p.waitForSelector('[data-auto-group="jobs"] [data-auto-key="jobs"]');};
 const close=async()=>{await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('.sheet'));};
 const rowOf=name=>p.$$eval('[data-job-keys] .job-key-row',(rows,n)=>{const r=rows.find(r=>r.querySelector('.job-key-name').textContent===n);return r?[...r.querySelectorAll('.job-key-facts')].map(x=>x.textContent):null;},name);
 await p.setViewport({width:1440,height:900});
 await p.goto(base+'/#/all');await p.waitForSelector('.session-home');

 console.log('Job keys (fixture): off, the group shows and nothing else, and no key is asked for');
 assert.equal(await p.evaluate(()=>window.pocketFeatures.jobs),false);
 await automation();
 assert.equal(await p.$('[data-job-keys]'),null);
 assert.equal(f.gets,0,'no call to the key list while off');
 assert.equal(await p.$('[data-auto-dependent="jobs"]'),null,'off: only the switch and its help');
 assert.equal(await p.$('[data-auto-reset="jobs"]'),null,'off: no Reset either');

 console.log('Job keys (fixture): on, the list shows every key with its state');
 await p.click('[data-auto-key="jobs"]');
 await p.waitForFunction(()=>window.pocketFeatures.jobs===true);
 await p.waitForFunction(()=>document.querySelectorAll('[data-job-keys] .job-key-row').length===2);
 const ago=await p.evaluate(at=>CheckBacks.when(at),f.keys[0].lastRunAt);
 assert.deepEqual(await rowOf('disk-check'),['~/ops · Claude Code · Default model','Ask first · Running · Last run '+ago]);
 assert.deepEqual(await rowOf('nightly-report'),['~/reports · Codex · Default model','Full access · Off · Never ran']);
 assert.equal(await p.$eval('[data-job-keys] [data-job-empty]',e=>e.hidden),true,'no empty sentence with keys');
 assert.equal(await p.$eval('[data-auto-advanced="jobs"]',e=>e.open),false,'the settings wait under Advanced, closed');
 assert.equal(await p.$eval('[data-auto-key="jobKeyFolder"]',e=>e.type),'text','the folder setting is a text field');
 const targets=await p.$$eval('[data-job-keys] .job-key-row,[data-job-keys] [data-job-new]',x=>x.map(e=>Math.round(e.getBoundingClientRect().height)));
 assert.ok(targets.every(h=>h>=44),'44 px targets: '+targets);
 await shot('key-list',await p.$('[data-auto-group="jobs"]'));
 await axeCheck(p,repo,'[data-auto-group="jobs"]');

 console.log('Job keys (fixture): an unchanged refresh writes nothing; a change rewrites only its row, at the same height');
 assert.equal(await writesDuring(p,'[data-job-keys]',5600),0,'the list is not rewritten');
 const [rowA,rowB]=await p.$$('[data-job-keys] [data-job-list] > li');const hA=await rowA.evaluate(e=>e.getBoundingClientRect().height);
 await rowB.evaluate(e=>{window.__jobRowB=e;new MutationObserver(r=>{window.__jobRowBWrites=(window.__jobRowBWrites||0)+r.length;}).observe(e,{subtree:true,childList:true,attributes:true,characterData:true});});
 f.keys[0].running=0;
 await p.waitForFunction(()=>/Ask first · On · Last run /.test(document.querySelector('[data-job-keys] .job-key-row').innerText),{timeout:8000});
 assert.equal(await rowA.evaluate(e=>e.isConnected&&e.getBoundingClientRect().height),hA,'the same row, the same height');
 assert.equal(await p.evaluate(()=>(window.__jobRowBWrites||0)+(window.__jobRowB.isConnected?0:100)),0,'the other row is left alone');

 console.log('Job keys (fixture): a key that has run; Recent runs in every status');
 await p.click('[data-job-keys] [data-job-open]');await p.waitForSelector('.job-key-sheet [data-job-runs] > li');
 await p.waitForFunction(()=>document.querySelectorAll('[data-job-runs] > li').length===5);
 assert.equal(await p.$eval('.job-key-sheet input[name="workspace"]',e=>e.readOnly),true);
 assert.equal(await p.$eval('.job-key-sheet select[name="engine"]',e=>e.disabled),true);
 assert.equal(await p.$eval('#job-workspace-hint',e=>e.textContent),'This key has run, so its folder and agent stay as they are. Create a new key for another folder or agent.');
 assert.deepEqual(await p.$$eval('.job-key-sheet select[name="access"] option',x=>x.map(o=>o.textContent)),['Ask first'],'Full access is not offered where the server turned it off');
 assert.deepEqual(await p.$$eval('[data-job-runs] .job-run-status',x=>x.map(e=>e.textContent)),['Working','Needs you','Done','Failed','Failed']);
 assert.deepEqual(await p.$$eval('[data-job-runs] > li',x=>x.map(l=>l.querySelector('.job-run-reply')?.textContent||'')),['','','Volume sda1 is at 91%; the others are fine.','Cut off by a restart.','The disk report was empty.']);
 assert.equal(await p.$eval('[data-job-runs] > li a.job-run',e=>e.getAttribute('href')),'#/chat/job-conv-1');
 assert.equal(await writesDuring(p,'[data-job-runs]',5600),0,'the runs list is not rewritten');
 await p.$eval('.job-key-sheet',e=>{e.scrollTop=e.scrollHeight;});
 await shot('key-sheet-runs');
 await axeCheck(p,repo,'.job-key-sheet');

 console.log('Job keys (fixture): Rotate key when the key file could not be written');
 await p.$eval('.job-key-sheet',e=>{e.scrollTop=0;});
 await p.click('.job-key-sheet [data-job-rotate]');await p.waitForSelector('.job-confirm [data-yes]');
 assert.equal(await p.$eval('.job-confirm .sheet-help',e=>e.textContent),'The old key stops working at once. Pocket shows the new key once and writes it to the key file.');
 await p.click('.job-confirm [data-yes]');await p.waitForSelector('.job-key-once [data-job-secret]');
 assert.equal(await p.$eval('.job-key-once [data-job-secret]',e=>e.value),SECRET);
 assert.equal(await p.$eval('.job-key-once [data-job-file]',e=>e.textContent),'The key was not saved to a file: Pocket could not write the key file: the folder is read-only. Copy it now and keep it somewhere only you can read.');
 assert.equal(await p.$eval('#job-once-example',e=>e.value),'pocket-run --key-file <path> --data-file report.txt');
 await shot('key-shown-once-file-error');
 await axeCheck(p,repo,'.job-key-once');
 await close();
 assert.equal(await p.evaluate(k=>[document.documentElement.outerHTML,[...document.querySelectorAll('input,textarea')].map(e=>e.value).join(),JSON.stringify({...localStorage}),JSON.stringify({...sessionStorage}),location.href].some(s=>s.includes(k)),SECRET),false,'the key is nowhere once the sheet closed');

 console.log('Job keys (fixture): Full access stays offered for the key that has it');
 await automation();await p.waitForFunction(()=>document.querySelectorAll('[data-job-keys] .job-key-row').length===2);
 await (await p.$$('[data-job-keys] [data-job-open]'))[1].click();await p.waitForSelector('.job-key-sheet select[name="access"]');
 assert.deepEqual(await p.$$eval('.job-key-sheet select[name="access"] option',x=>x.map(o=>[o.textContent,o.selected])),[['Ask first',false],['Full access',true]]);
 assert.equal(await p.$eval('.job-key-sheet input[name="workspace"]',e=>e.readOnly),false,'a key that never ran can still move');
 assert.equal(await p.$eval('.job-key-sheet [data-job-toggle]',e=>e.textContent),'Turn on');
 await close();

 console.log('Job keys (fixture): switched off again, only the group');
 await automation();await p.click('[data-auto-key="jobs"]');
 await p.waitForFunction(()=>window.pocketFeatures.jobs===false);await p.waitForFunction(()=>!document.querySelector('[data-job-keys]'));
 await close();
 a.reset();f.reset();
}
