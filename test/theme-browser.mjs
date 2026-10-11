// Theme acceptance uses the app's real frontend with synthetic APIs, never live sessions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {clickControl} from './ui-controls.mjs';
const require=createRequire(import.meta.url);
const luminance=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{a=luminance(a);b=luminance(b);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};

export async function runThemeRegressions({browser,base,rows,out,settings,modes,setRequests}){
 const saved={...settings},savedModes={...modes},records=[],checks=[],errors=[];
 const context=await browser.createBrowserContext(),page=await context.newPage();
 page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.stack||e.message));
 Object.assign(settings,{projects:true,documents:true,tasks:true});modes.voice=true;
 const idle=rows[4].id;
 const go=async(route,selector)=>{await page.goto(base+'/'+route);await page.waitForSelector(selector);};
 const chat=()=>go('#/chat/'+idle,'#box');
 const close=async()=>{if(await page.$('[data-close-dock]'))await page.click('[data-close-dock]');else await page.keyboard.press('Escape');};
 const set=async(mode,accent='clay')=>page.evaluate((mode,accent)=>{PocketTheme.setPreference(mode);PocketTheme.setAccent(accent);},mode,accent);
 const scan=async name=>{
  await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
  const axeScript=await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});await axeScript.evaluate(el=>el.remove());
  const violations=await page.evaluate(async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations);
  const record={name,violations};records.push(record);
  if(process.env.POCKET_DESIGN_SCANNER){
   await page.evaluate(()=>{window.__IMPECCABLE_CONFIG__={autoScan:false};});
   if(!await page.evaluate(()=>Boolean(window.impeccableDetectAsync))){const injected=await page.addScriptTag({path:process.env.POCKET_DESIGN_SCANNER});await injected.evaluate(el=>el.remove());}
   record.detector=await page.evaluate(()=>window.impeccableDetectAsync({scrollOffscreen:false}));
  }
  await page.mouse.move(0,0);await page.evaluate(()=>{if(typeof hideTip==='function')hideTip();});
  await page.screenshot({path:path.join(out,'theme-'+name+'.png')});
  assert.deepEqual(violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),[],name+' accessibility');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' viewport overflow');
 };
 try{
  await Promise.all(['/api/documents/reset','/api/board/reset','/api/tasks/reset'].map(route=>fetch(base+route).then(r=>assert.equal(r.ok,true))));
  await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:'light'},{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.setViewport({width:1440,height:900});
  await chat();assert.equal(await page.evaluate(()=>PocketTheme.preference),'system');
  assert.equal(await page.evaluate(()=>PocketTheme.resolved),'light');
  await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:'dark'},{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.waitForFunction(()=>PocketTheme.resolved==='dark');
  await set('light');await page.reload();await page.waitForSelector('#box');
  assert.equal(await page.evaluate(()=>PocketTheme.resolved),'light');
  checks.push('Fresh System default, live OS changes and explicit override after reload');

  await page.evaluate(()=>{localStorage.removeItem('pc-theme');localStorage.setItem('pc-accent','"purple"');});
  await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:'light'},{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.reload();await page.waitForSelector('#box');
  assert.equal(await page.evaluate(()=>PocketTheme.preference),'dark');assert.equal(await page.evaluate(()=>PocketTheme.accent),'purple');
  checks.push('Existing browser retains dark and its saved accent');

  // The preference must resolve before app.js (or any body) can paint.
  await set('light','blue');
  const early=await context.newPage();await early.setRequestInterception(true);
  early.on('request',async r=>{
   if(r.url().includes('/app.js?'))return r.abort();
   if(r.isNavigationRequest()&&r.frame()===early.mainFrame()){
    const response=await fetch(r.url());return r.respond({status:200,headers:{'content-type':'text/html',
     'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'"},body:await response.text()});
   }
   return r.continue();
  });
  await early.goto(base+'/');
  assert.equal(await early.evaluate(()=>document.documentElement.dataset.theme),'light');
  assert.equal(await early.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(250, 248, 245)');
  assert.equal(await early.evaluate(()=>document.querySelector('meta[name="theme-color"]').content),'#FAF8F5');
  await early.close();checks.push('Correct palette and browser chrome before app startup under same-origin script CSP');

  // Real same-origin split panes and separate windows, including changes made inside a pane.
  await page.type('#box','Keep this draft through appearance changes.');
  await clickControl(page,'#splitb');await page.waitForSelector(`[data-v="${rows[0].id}"]`);await clickControl(page,`[data-v="${rows[0].id}"]`);
  await page.waitForSelector('#panes iframe');const pane=await(await page.$('#panes iframe')).contentFrame();await pane.waitForSelector('#box');
  const other=await context.newPage();await other.goto(base+'/?solo=1#/chat/'+idle);await other.waitForSelector('#box');
  await page.evaluate(()=>settingsSheet({category:'appearance'}));await page.waitForSelector('#s-theme');
  await page.select('#s-theme','dark');
  await pane.waitForFunction(()=>PocketTheme.resolved==='dark');await other.waitForFunction(()=>PocketTheme.resolved==='dark');
  await pane.evaluate(()=>{PocketTheme.setPreference('light');PocketTheme.setAccent('purple');});
  await page.waitForFunction(()=>PocketTheme.resolved==='light'&&document.getElementById('s-theme').value==='light'&&document.querySelector('button[data-accent="purple"]').getAttribute('aria-pressed')==='true');
  await other.waitForFunction(()=>PocketTheme.accent==='purple');
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('#box',e=>e.value),'Keep this draft through appearance changes.');
  await page.screenshot({path:path.join(out,'theme-split-light.png')});
  await other.close();await page.evaluate(()=>{localStorage.removeItem('pc-panes');});
  // Isolate subsequent full-width screenshots from the user's saved pane layout.
  await page.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.includes('pane'))localStorage.removeItem(key);});
  await page.reload();await page.waitForSelector('#box');
  await page.evaluate(()=>{document.querySelector('#box').value='';clearDraft(chatId);});
  checks.push('Main window, split pane and separate window synchronize without losing draft');

  for(const mode of ['light','dark'])for(const accent of ['clay','blue','purple']){
   await set(mode,accent);await chat();
   // Token contrast is checked across all surfaces, including states absent from this transcript.
   const pairs=await page.evaluate(()=>{
    const probe=document.createElement('span');document.body.append(probe);
    const rgb=token=>{probe.style.color=`var(--${token})`;const c=getComputedStyle(probe).color;return c.match(/[\d.]+/g).slice(0,3).map(Number);};
    const out=[];
    for(const bg of ['bg','surface','raised','clay-deep'])for(const fg of ['text','dim','faint','clay','ok','err','warn','ice'])out.push({fg,bg,a:rgb(fg),b:rgb(bg)});
    out.push({fg:'on-accent',bg:'clay',a:rgb('on-accent'),b:rgb('clay')},{fg:'on-warn',bg:'warn',a:rgb('on-warn'),b:rgb('warn')},{fg:'bubble-text',bg:'clay-deep',a:rgb('bubble-text'),b:rgb('clay-deep')});
    probe.remove();return out;
   });
   for(const pair of pairs)assert.ok(contrast(pair.a,pair.b)>=4.5,`${mode}/${accent}: ${pair.fg} on ${pair.bg} is ${contrast(pair.a,pair.b).toFixed(2)}:1`);
   assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),mode);
   for(const width of [390,1440]){
    await page.setViewport({width,height:900,isMobile:width<700,hasTouch:width<700});
    await scan(`${mode}-${accent}-chat-${width}`);
   }
  }
  checks.push('Six palettes pass small-text token contrast and phone/desktop conversation accessibility');

  for(const mode of ['light','dark']){
   await set(mode);
   for(const width of [390,1440]){
    await page.setViewport({width,height:900,isMobile:width<700,hasTouch:width<700});
    for(const [name,route,selector] of [['sessions','#/','.session-item'],['new','#/new','#first'],['projects','#/projects','#projects-main'],['project','#/projects/warehouse-stock-report','.project-card'],['files','#/documents','#documents-main'],['tasks','#/tasks','#tasks-main']]){
     await go(route,selector);await scan(`${mode}-${name}-${width}`);
    }
    await chat();await page.evaluate(()=>settingsSheet({category:'appearance'}));await page.waitForSelector('#s-theme');
    await scan(`${mode}-appearance-${width}`);await page.keyboard.press('Escape');
    await page.evaluate(()=>openResults(chatId));await page.waitForSelector('.results-sheet');await scan(`${mode}-results-${width}`);await close();
    await page.evaluate(()=>openGit(chatId));await page.waitForSelector('.git-sheet');await scan(`${mode}-git-${width}`);await close();
    await page.evaluate(()=>openQueue(chatId));await page.waitForSelector('#queue-items');await scan(`${mode}-queue-${width}`);await close();
    await page.evaluate(()=>openUsagePanel());await page.waitForSelector('#usage-body');await scan(`${mode}-usage-${width}`);await page.keyboard.press('Escape');
    await page.evaluate(()=>settingsSheet({category:'notifications'}));await page.waitForSelector('#s-voice');
    await clickControl(page,'#s-voice > summary');await page.waitForSelector('#s-voice-voice option');
    await scan(`${mode}-voice-${width}`);await page.keyboard.press('Escape');
    setRequests({approvals:[{id:'theme-approval',title:'Run this command?',kind:'command',details:'npm run build',canAllow:true,status:'pending'}]});
    await page.evaluate(()=>openApprovals(chatId));await page.waitForSelector('.approval-card');await scan(`${mode}-approval-${width}`);await page.keyboard.press('Escape');
    setRequests({questions:[{id:'request-1',blocking:true,questions:[{id:'format',header:'Format',question:'Which format should the report use?',options:[{label:'CSV',description:'For spreadsheets'},{label:'PDF',description:'For reading'}]}]}]});
    await go('#/chat/'+rows[1].id,'#box');await page.evaluate(()=>openQuestions(chatId));await page.waitForSelector('.question-form');
    await scan(`${mode}-question-${width}`);await page.keyboard.press('Escape');setRequests({});
    await page.setRequestInterception(true);
    const loggedOut=r=>new URL(r.url()).pathname==='/api/me'?r.respond({status:200,contentType:'application/json',body:'{"ok":false}'}):r.continue();
    page.on('request',loggedOut);await page.reload();await page.waitForSelector('#pw');
    await page.evaluate(()=>{document.querySelector('#lerr').textContent='Wrong password.';});
    await scan(`${mode}-login-error-${width}`);
    page.off('request',loggedOut);await page.setRequestInterception(false);


   }
   // Pocket's document frame keeps the author's canvas; Markdown and CSV use Pocket's palette.
   await go('#/documents','#documents-main');
   const docs=await page.evaluate(async()=>await(await fetch('/api/documents')).json());
   for(const doc of docs.documents.filter(d=>['html','md','table'].includes(d.kind))){
    await go('#/documents/'+doc.id,'.doc-tools');
    if(doc.kind==='md')await page.waitForSelector('.doc-md');if(doc.kind==='table')await page.waitForSelector('.doc-table');
    await scan(`${mode}-document-${doc.kind}`);
    if(doc.kind==='html')assert.equal(await page.$eval('.doc-frame',e=>getComputedStyle(e).colorScheme),'light');
   }
  }
  checks.push('Core screens, settings and document viewers checked in both modes');

  // Exercise the actual service worker on a fresh context and then reopen offline.
  modes.realWorker=true;
  const offlineContext=await browser.createBrowserContext(),offline=await offlineContext.newPage();
  try{
   await offline.goto(base+'/');await offline.waitForSelector('.session-item');
   await offline.evaluate(async()=>{PocketTheme.setPreference('light');PocketTheme.setAccent('blue');await navigator.serviceWorker.ready;});
   await offline.reload();await offline.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
   await offline.setOfflineMode(true);await offline.reload({waitUntil:'domcontentloaded'});
   assert.equal(await offline.evaluate(()=>PocketTheme.resolved),'light');assert.equal(await offline.evaluate(()=>PocketTheme.accent),'blue');
   assert.equal(await offline.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(250, 248, 245)');
   checks.push('Actual service-worker shell preserves light mode and accent on offline reopen');
  }finally{await offlineContext.close();}
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({themeChecks:checks.length,themeAccessibilityScans:records.length,ok:true}));
 }finally{
  fs.writeFileSync(path.join(out,'theme-regressions.json'),JSON.stringify({checks,scans:records,errors},null,2));
  for(const key of Object.keys(settings))delete settings[key];Object.assign(settings,saved);
  for(const key of Object.keys(modes))delete modes[key];Object.assign(modes,savedModes);
  setRequests({});await context.close();
 }
}
