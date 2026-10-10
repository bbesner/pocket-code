import {clickControl} from './ui-controls.mjs';
// Browser regressions for the 1.7 audit. Uses the existing synthetic API server;
// no real credentials, transcripts, providers or production processes are involved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const axePath=require.resolve('axe-core/axe.min.js');
const pause=ms=>new Promise(r=>setTimeout(r,ms));

export async function runUIRegressions({browser,base,rows,out,setMode,getMode=()=>({}),settingsState=()=>({}),received=[],voiceLog={transcribe:[],speak:[]},conversations=new Map(),pinOrders=[]}) {
 const context=await browser.createBrowserContext(),page=await context.newPage();
 page.setDefaultTimeout(8000);
 const errors=[],checks=[],scans=[];
 page.on('pageerror',e=>errors.push(e.message));
 const idle=rows[4].id;
 const check=async(name,fn)=>{await fn();checks.push(name);};
 const chat=async()=>{await page.goto(base+'/#/chat/'+idle);await page.waitForSelector('#box');};
 // Hash-only navigation keeps the old view for a moment; wait for the requested conversation to be loaded.
 const openChat=async id=>{await page.goto(base+'/#/chat/'+id);await page.waitForFunction(id=>chatId===id&&document.querySelector('#ctitle')?.textContent!=='Session'&&document.querySelector('#box'),{},id);};
 const scan=async name=>{
  // Measure final colors, not the translucent opening frame of a sheet animation.
  await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
  const axeScript=await page.addScriptTag({path:axePath});await axeScript.evaluate(el=>el.remove());
  const result=await page.evaluate(()=>axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']}}));
  const record={name,violations:result.violations};
  scans.push(record);
  if(process.env.POCKET_DESIGN_SCANNER){
   await page.evaluate(()=>{window.__IMPECCABLE_CONFIG__={autoScan:false};});
   if(!await page.evaluate(()=>Boolean(window.impeccableDetectAsync))){const injected=await page.addScriptTag({path:process.env.POCKET_DESIGN_SCANNER});await injected.evaluate(el=>el.remove());}
   record.detector=await page.evaluate(()=>window.impeccableDetectAsync({scrollOffscreen:false}));
  }
  assert.deepEqual(result.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[],name+' accessibility');
 };
 try {
  await page.setViewport({width:390,height:844});
  // A fresh profile and a real HTTP503 from sw.js reproduce the registration failure.
  setMode({workerFailed:true,aboutFailed:true});
  await page.goto(base+'/#/');await page.waitForSelector('#settings');
  await check('Settings usable when service worker fails; explicit notification fallback',async()=>{
   await clickControl(page,'#settings');await page.waitForSelector('#s-usage',{timeout:1000});
   assert.equal(await page.$$eval('.settings-index button',es=>es.filter(e=>e.checkVisibility()).length),6);
   assert.equal(await page.$eval('#s-notes',e=>e.open),false);
   await clickControl(page,'#s-chime');assert.equal(await page.$eval('#s-chime',e=>e.getAttribute('aria-pressed')),'false');
   await page.waitForFunction(()=>document.querySelector('#s-push-state').textContent.includes('Unavailable'));
   await clickControl(page,'#s-push');await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Notifications unavailable'));
   await page.screenshot({path:path.join(out,'fixed-settings-mobile.png')});
  });
  await check('Failed update check is honest and Retry recovers',async()=>{
   await clickControl(page,'#s-about > summary');
   await page.waitForFunction(()=>document.querySelector('#s-version-state').textContent.includes('Could not check'));
   assert.equal(await page.$eval('#s-refresh',e=>e.hidden),true);
   setMode({aboutFailed:false});await clickControl(page,'#s-check');
   await page.waitForFunction(()=>document.querySelector('#s-version-state').textContent==='Up to date');
   await clickControl(page,'#s-about > summary');
  });
  await check('Bugs & feature requests links open the GitHub issue forms with the version filled in',async()=>{
   assert.equal(await page.$eval('#s-feedback',e=>e.open),false);
   await clickControl(page,'#s-feedback > summary');
   const bug=await page.$eval('#s-report-bug',e=>({href:e.href,target:e.target,rel:e.rel}));
   assert.match(bug.href,/^https:\/\/github\.com\/bbesner\/pocket-code\/issues\/new\?template=bug_report\.yml&version=/);
   assert.match(decodeURIComponent(bug.href),/build \d+/);
   assert.equal(bug.target,'_blank');assert.ok(bug.rel.includes('noopener'));
   assert.match(await page.$eval('#s-request-feature',e=>e.href),/template=feature_request\.yml&version=/);
   await page.$eval('#s-feedback',e=>e.scrollIntoView({block:'end'}));await page.screenshot({path:path.join(out,'fixed-settings-feedback.png')});
   await clickControl(page,'#s-feedback > summary');
  });
  await check('Nested usage sheet returns focus to the Settings opener',async()=>{
   await clickControl(page,'#s-usage');await page.waitForSelector('#usage-body');await page.keyboard.press('Escape');
   assert.equal(await page.evaluate(()=>document.activeElement.id),'settings');
  });
  await check('Settings disclosures remain keyboard reachable and focus stays trapped',async()=>{
   await clickControl(page,'#settings');await page.waitForSelector('#s-sync:not(:disabled)');
   await clickControl(page,'[data-settings-category=help]');
   await page.focus('.sheet-close');const focused=new Set();
   for(let i=0;i<30;i++){ // the Tools rows (1.29, 1.30) added four stops before the disclosures
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(()=>document.querySelector('[role=dialog]').contains(document.activeElement)));
    focused.add(await page.evaluate(()=>document.activeElement.closest('details')?.id));
   }
   assert.ok(focused.has('s-about')&&focused.has('s-notes')&&focused.has('s-feedback'));
   await page.keyboard.press('Escape');
  });
  await check('Compact filters expose active selections and remember expansion',async()=>{
   assert.equal(await page.$eval('[data-more-filters]',e=>e.open),false);
   const firstTop=await page.$eval('[data-session-results] [data-id]',e=>e.getBoundingClientRect().top);
   assert.ok(firstTop<430,'first session should be visible above the fold');
   await clickControl(page,'[data-more-filters] > summary');
   await page.select('[data-provider-filter]','codex');
   await clickControl(page,'[data-more-filters] > summary');
   assert.match(await page.$eval('[data-filter-summary]',e=>e.textContent),/Codex/);
   await page.reload();await page.waitForSelector('[data-more-filters]');
   assert.equal(await page.$eval('[data-more-filters]',e=>e.open),false);
   await clickControl(page,'[data-clear-more-filters]');
   assert.equal(await page.$eval('[data-filter-summary]',e=>e.textContent),'');
   await clickControl(page,'[data-more-filters] > summary');await pause(30);await page.reload();
   await page.waitForSelector('[data-more-filters]');assert.equal(await page.$eval('[data-more-filters]',e=>e.open),true);
   await clickControl(page,'[data-more-filters] > summary');
   await page.screenshot({path:path.join(out,'fixed-sessions-mobile.png')});
  });
  await check('A finished reply reads Response ready until opened, then Recent',async()=>{
   const done=rows.find(r=>r.state?.kind==='finished'&&r.state.at);
   const status=()=>page.$eval(`[data-session-results] [data-id="${done.id}"] .session-status`,e=>({cls:e.className,text:e.textContent}));
   setMode({ignoreSeen:done.id});                             // an upload already in flight from the old page must not re-mark it (CI race)
   delete done.seenAt;await page.evaluate(id=>{localStorage.removeItem('pc-seen-'+id);serverSeen.delete(id);seenPending.delete(id);},done.id);await page.reload();await page.waitForSelector(`[data-session-results] [data-id="${done.id}"]`);
   assert.deepEqual(await status(),{cls:'session-status state-finished',text:'Response readyNew'});
   setMode({ignoreSeen:null});
   await page.evaluate(([id,at])=>localStorage.setItem('pc-seen-'+id,String(at)),[done.id,done.state.at]);await page.reload();await page.waitForSelector(`[data-session-results] [data-id="${done.id}"]`);
   assert.deepEqual(await status(),{cls:'session-status state-idle',text:'Recent'});
  });
  setMode({workerFailed:false});
  await page.setViewport({width:1440,height:900});
  await page.goto(base+'/#/new');await page.waitForSelector('#first');
  await check('New-session skip link targets the task field',async()=>{
   await page.focus('.skip-chat');await page.keyboard.press('Enter');
   assert.equal(await page.evaluate(()=>document.activeElement.id),'first');
  });
  await check('Agent and workspace radio groups support arrows, Home/End and roving Tab',async()=>{
   await clickControl(page,'#choose-workspace');await page.focus('[data-a=claude]');await page.keyboard.press('ArrowDown');
   assert.equal(await page.$eval('[data-a=codex]',e=>e.getAttribute('aria-checked')),'true');
   assert.equal(await page.$$eval('#apick [tabindex="0"]',es=>es.length),1);
   await page.keyboard.press('Home');assert.equal(await page.$eval('[data-a=claude]',e=>e.getAttribute('aria-checked')),'true');
   await page.focus('#plist [role=radio]');await page.keyboard.press('End');
   assert.equal(await page.$$eval('#plist [role=radio]',es=>es.at(-1).getAttribute('aria-checked')),'true');
   await page.keyboard.press('ArrowDown');
   assert.equal(await page.$eval('#plist [role=radio]',e=>e.getAttribute('aria-checked')),'true');
   assert.equal(await page.$$eval('#plist [tabindex="0"]',es=>es.length),1);
  });
  await scan('new-desktop');
  await chat();await page.type('#box','Main draft survives resizing.');
  await check('Process closing is a labelled session-menu action, not an adjacent X',async()=>{
   assert.equal(await page.$('#close-main'),null);
   assert.ok(await page.$('[data-close-session]'));
   await clickControl(page,'#chatmore');assert.match(await page.$eval('#so-close',e=>e.textContent),/Close session process/);
   await page.keyboard.press('Escape');
  });
  await check('Session menu names itself, shows the title as the conversation, and opens the version in one tap',async()=>{
   const release=JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname),'../public/release.json'),'utf8'));
   const vp=page.viewport();await page.setViewport({width:390,height:844});
   const settled=()=>page.waitForFunction(()=>document.getAnimations().every(a=>a.playState!=='running'));
   await clickControl(page,'#chatmore');await settled();
   assert.equal(await page.$eval('#sheet-title',e=>e.textContent),'Session options');
   assert.equal(await page.$eval('.sheet-name',e=>e.textContent),rows[4].title);
   await page.waitForFunction(v=>document.querySelector('#so-version-sub')?.textContent.includes(v),{},release.version);
   assert.equal(await page.$eval('#so-version-sub',e=>e.textContent),`Pocket Code ${release.version} · build ${release.assetV}`);
   await page.screenshot({path:path.join(out,'session-menu-version.png')});
   await page.$eval('#so-version',e=>e.scrollIntoView({block:'end'}));await page.screenshot({path:path.join(out,'session-menu-version-row.png')});
   await clickControl(page,'#so-version');await page.waitForSelector('.settings-sheet #s-about[open]');await settled();
   await page.waitForFunction(()=>document.querySelector('#s-about-version')?.textContent);
   assert.equal(await page.$eval('#s-about-version',e=>e.textContent),`${release.version} · build ${release.assetV}`);
   assert.ok(await page.$eval('#s-about',e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.top<innerHeight;}));
   await page.screenshot({path:path.join(out,'settings-about-open.png')});
   await page.keyboard.press('Escape');
   assert.equal(await page.evaluate(()=>document.activeElement.id),'chatmore');
   await page.setViewport(vp);
  });
  await clickControl(page,'#splitb');await clickControl(page,'[data-v=new]');await page.waitForSelector('#panes iframe');
  let pane=await(await page.$('#panes iframe')).contentFrame();await pane.waitForSelector('#first');
  await pane.type('#first','Beside draft survives resizing.');
  await pane.evaluate(()=>{window.originalInput=document.querySelector('#first');});
  await check('Split separators expose valid initial and resized bounds',async()=>{
   const get=()=>page.$eval('.pane-grip',e=>['aria-valuemin','aria-valuenow','aria-valuemax'].map(a=>Number(e.getAttribute(a))));
   let [min,now,max]=await get();assert.ok(min>=380&&now>=min&&now<=max);
   await page.focus('.pane-grip');await page.keyboard.press('ArrowLeft');
   [min,now,max]=await get();assert.ok(now>=min&&now<=max);
  });
  await check('Narrow split hides in place and restores exact draft DOM',async()=>{
   await page.setViewport({width:900,height:900});
   await page.waitForFunction(()=>document.getElementById('panes').hidden);
   assert.match(await page.$eval('#split-notice',e=>e.textContent),/1 pane is hidden/);
   assert.equal(await page.$eval('#box',e=>e.value),'Main draft survives resizing.');
   assert.ok(await page.$eval('#box',e=>e.getBoundingClientRect().right<=innerWidth));
   await page.screenshot({path:path.join(out,'fixed-split-900.png')});
   await page.setViewport({width:1440,height:900});
   await page.waitForFunction(()=>!document.getElementById('panes').hidden);
   assert.equal(await pane.$eval('#first',e=>e===window.originalInput),true);
   assert.equal(await pane.$eval('#first',e=>e.value),'Beside draft survives resizing.');
   assert.ok(await page.$eval('#panes iframe',e=>e.getBoundingClientRect().right<=innerWidth+1));
  });
  await check('Rail keyboard resizing re-evaluates pane capacity',async()=>{
   await page.setViewport({width:1150,height:900});await pause(150);
   await page.focus('#grip');for(let i=0;i<8;i++)await page.keyboard.press('ArrowRight');
   await page.waitForFunction(()=>document.getElementById('panes').hidden);
   for(let i=0;i<8;i++)await page.keyboard.press('ArrowLeft');
   await page.waitForFunction(()=>!document.getElementById('panes').hidden);
  });
  await page.setViewport({width:2560,height:900});
  await page.evaluate(ids=>ids.forEach(openBeside),[rows[0].id,rows[1].id]);
  await check('Multiple panes fit or hide without out-of-bounds controls',async()=>{
   await page.waitForFunction(()=>document.querySelectorAll('.split-pane:not([hidden])').length===3);
   for(const width of [1920,1440,1280,1100,900,840,390,2560]){
    await page.setViewport({width,height:900});await pause(150);
    const rects=await page.$$eval('.split-pane:not([hidden])',els=>els.map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})));
    assert.ok(rects.every(r=>r.width>=379&&r.left>=0&&r.right<=width+1),'pane bounds '+width+': '+JSON.stringify(rects));
   }
   assert.equal(await pane.$eval('#first',e=>e.value),'Beside draft survives resizing.');
  });
  await check('Dock width is included in split capacity',async()=>{
   await page.setViewport({width:1440,height:900});await pause(150);
   await clickControl(page,'#results-open');await page.waitForSelector('.workspace-dock');await pause(150);
   assert.ok(await page.$eval('.chatcol',e=>e.getBoundingClientRect().width>=379));
   assert.ok(await page.$$eval('.split-pane:not([hidden])',es=>es.every(e=>e.getBoundingClientRect().right<=innerWidth+1)));
   await scan('split-and-dock-desktop');
   await page.screenshot({path:path.join(out,'fixed-split-desktop.png')});
   await clickControl(page,'[data-close-dock]');
  });
  await check('New-session button stays in the main column and never covers a pane composer',async()=>{
   const back=await page.evaluate(()=>location.hash);
   await page.evaluate(()=>{location.hash='#/';});await page.waitForSelector('#new');
   await page.waitForFunction(()=>!document.getElementById('panes').hidden);
   const r=await page.evaluate(()=>{const f=document.getElementById('new').getBoundingClientRect(),a=document.getElementById('app').getBoundingClientRect(),
    p=document.querySelector('.split-pane:not([hidden])').getBoundingClientRect();return {fabRight:f.right,fabBottom:f.bottom,appRight:a.right,paneLeft:p.left,h:innerHeight};});
   assert.ok(r.fabRight<=r.appRight+1&&r.fabRight<=r.paneLeft+1,'button inside the main column: '+JSON.stringify(r));
   assert.ok(r.fabBottom<=r.h,'button on screen: '+JSON.stringify(r));
   await page.screenshot({path:path.join(out,'fab-beside-split.png')});
   await page.evaluate(h=>{location.hash=h;},back);await page.waitForSelector('#chatmore');
  });
  await check('Closing main promotes a new pane with its draft',async()=>{
   await clickControl(page,'#chatmore');await clickControl(page,'#so-close');await page.waitForSelector('#first');
   assert.equal(await page.$eval('#first',e=>e.value),'Beside draft survives resizing.');
  });
  await page.evaluate(()=>{for(const pane of [...splitPanes])closePane(pane.key);localStorage.removeItem('pc-dock-kind');});
  await page.setViewport({width:390,height:844});await chat();
  await check('Toolbar overflow offers working controls and preserves draft',async()=>{
   await page.waitForSelector('.toolbar-next:not([hidden])');
   const before=await page.$eval('#box',e=>e.value);
   await clickControl(page,'.toolbar-next');
   assert.ok(await page.$eval('#tbar',e=>e.scrollLeft>0));
   assert.equal(await page.$eval('.toolbar-previous',e=>e.disabled),false);
   await clickControl(page,'.toolbar-previous');assert.equal(await page.$eval('#tbar',e=>e.scrollLeft),0);
   await clickControl(page,'#composer-toggle');assert.equal(await page.$eval('.toolbar-scroll',e=>e.getClientRects().length),0);
   await clickControl(page,'#composer-toggle');
   assert.equal(await page.$eval('#box',e=>e.value),before);
   await page.screenshot({path:path.join(out,'fixed-toolbar-mobile.png')});
   await page.setViewport({width:1440,height:900});await page.waitForFunction(()=>document.querySelector('.toolbar-next').hidden);
  });
  await check('Voice: hold to talk records, transcribes and sends to the session',async()=>{
   setMode({voice:true,voiceText:'Please review the incoming quantities again.'});
   await page.setViewport({width:390,height:844});await chat();await page.waitForSelector('#micb:not([hidden])');
   const talk=async ms=>{const b=await (await page.$('#micb')).boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();
    await page.waitForFunction(()=>document.querySelector('#micb').getAttribute('aria-pressed')==='true');await pause(ms);await page.mouse.up();};
   const draft=await page.$eval('#box',e=>e.value.trim());assert.ok(draft,'fixture has a typed draft');
   let sentBefore=received.length;await talk(900);
   await page.waitForFunction(()=>/Added to your draft/.test(document.querySelector('#voice-strip').textContent));
   assert.equal(await page.$eval('#box',e=>e.value),draft+' Please review the incoming quantities again.');
   assert.equal(received.length,sentBefore,'a typed draft is never sent on the user\'s behalf');
   await page.$eval('#box',e=>{e.value='';e.dispatchEvent(new Event('input'));});
   const sent=received.length,heard=voiceLog.transcribe.length;
   const mic=await page.$('#micb'),box=await mic.boundingBox();
   assert.ok(box.width>=44&&box.height>=44,'mic target '+JSON.stringify(box));
   await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
   await page.waitForFunction(()=>document.querySelector('#micb').getAttribute('aria-pressed')==='true');
   assert.match(await page.$eval('#voice-strip',e=>e.textContent),/Release to send/);
   await pause(1400);await page.mouse.up();
   await page.waitForFunction(()=>/Sent:/.test(document.querySelector('#voice-strip').textContent));
   assert.equal(voiceLog.transcribe.length,heard+1);
   assert.ok(voiceLog.transcribe.at(-1).bytes>16000*2*.8,'about a second of 16 kHz PCM: '+voiceLog.transcribe.at(-1).bytes);
   assert.match(voiceLog.transcribe.at(-1).vocabulary,/Pocket Code/);
   for(let i=0;i<40&&received.length===sent;i++)await pause(100);
   assert.equal(received.at(-1).text,'Please review the incoming quantities again.');
   await page.screenshot({path:path.join(out,'voice-sent-mobile.png')});
  });
  await check('Voice: a quick command is answered on the device and nothing is sent',async()=>{
   setMode({voiceText:'Read it.'});const sent=received.length,spoken=voiceLog.speak.length;
   const box=await (await page.$('#micb')).boundingBox();
   await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
   await page.waitForFunction(()=>document.querySelector('#micb').getAttribute('aria-pressed')==='true');
   await pause(900);await page.mouse.up();
   for(let i=0;i<40&&voiceLog.speak.length===spoken;i++)await pause(100);
   assert.ok(voiceLog.speak.length>spoken,'reply spoken');
   const expected=await page.evaluate(()=>{const all=document.querySelectorAll('#msgs .m-asst');const c=all[all.length-1].cloneNode(true);
    c.querySelectorAll('.copybtn,.ledgerwrap,pre,table').forEach(n=>n.remove());return VoiceText.chunks(VoiceText.summary(c.innerText))[0];});
   assert.ok(expected,'latest reply has speakable text');
   assert.equal(voiceLog.speak[spoken].text,expected,'speaks the start of the latest reply');
   assert.equal(received.length,sent,'nothing sent to the session');
  });
  await check('Voice: tap starts listening, Cancel stops without sending',async()=>{
   const heard=voiceLog.transcribe.length;
   await clickControl(page,'#micb');
   await page.waitForFunction(()=>document.querySelector('#micb').getAttribute('aria-pressed')==='true');
   assert.match(await page.$eval('#voice-strip',e=>e.textContent),/Listening/);
   await scan('voice-listening-mobile');
   await clickControl(page,'#voice-cancel');
   await page.waitForFunction(()=>document.querySelector('#micb').getAttribute('aria-pressed')==='false');
   assert.equal(voiceLog.transcribe.length,heard);
  });
  await check('Tool calls: consecutive calls across messages fold into one summary that names the latest call',async()=>{
   const r=await page.evaluate(()=>{const c=document.createElement('div');
    c.innerHTML=[{role:'assistant',blocks:[{t:'text',text:'Checking.'},{t:'tool',name:'Bash',detail:'pm2 list'}]},{role:'assistant',blocks:[{t:'tool',name:'Edit',detail:'app.js'}]},{role:'assistant',blocks:[{t:'text',text:'Done.'}]}].map(msgHTML).join('');
    document.body.append(c);mergeToolFolds(c);const f=c.querySelectorAll('details.ledgerwrap');
    const out={folds:f.length,summary:f[0]?.querySelector('summary').textContent,lines:f[0]?.querySelectorAll('.ledger').length,msgs:c.querySelectorAll('.m-asst').length,open:f[0]?.open};c.remove();return out;});
   assert.equal(r.folds,1);assert.equal(r.lines,2);assert.equal(r.msgs,2,'a message that held only tool calls is absorbed');
   assert.match(r.summary,/2 tool calls/);assert.match(r.summary,/Edit app\.js/);assert.equal(r.open,false,'collapsed by default');
  });
  await check('Tool calls: a run stays one fold while streaming, across an empty live placeholder',async()=>{
   const r=await page.evaluate(()=>{const c=document.createElement('div');
    c.innerHTML=msgHTML({role:'assistant',blocks:[{t:'tool',name:'Read',detail:'a.js'}]})+'<div class="m-asst live enter"></div>'
     +msgHTML({role:'assistant',blocks:[{t:'tool',name:'Bash',detail:'npm test'}]});
    document.body.append(c);mergeToolFolds(c);const f=c.querySelectorAll('details.ledgerwrap');
    const out={folds:f.length,summary:f[0]?.querySelector('summary').textContent};c.remove();return out;});
   assert.equal(r.folds,1,'one fold for the run');assert.match(r.summary,/2 tool calls/);assert.match(r.summary,/Bash npm test/,'shows the latest call');
  });
  await check('Voice: the headset starts a hands-free conversation; the mic stays a single message',async()=>{
   const heard=voiceLog.transcribe.length;
   await page.$eval('#box',e=>{e.value='A typed draft';e.dispatchEvent(new Event('input'));});
   assert.equal(await page.$eval('#hfb',e=>getComputedStyle(e).display),'none','a typed draft hides the headset');
   assert.notEqual(await page.$eval('#micb',e=>getComputedStyle(e).display),'none','the mic still adds to a draft');
   await page.$eval('#box',e=>{e.value='';e.dispatchEvent(new Event('input'));});
   const hf=await page.$('#hfb'),box=await hf.boundingBox();
   assert.ok(box.width>=44&&box.height>=44,'headset target '+JSON.stringify(box));
   assert.match(await page.$eval('#hfb',e=>e.getAttribute('aria-label')),/Hands-free conversation/);
   await clickControl(page,'#hfb');
   await page.waitForFunction(()=>document.querySelector('#hfb').getAttribute('aria-pressed')==='true');
   assert.equal(await page.$eval('#micb',e=>e.getAttribute('aria-pressed')),'false','the plain mic is not the active control');
   await page.waitForFunction(()=>/Hands-free\. Listening/.test(document.querySelector('#voice-strip').textContent));
   await scan('voice-hands-free-mobile');await page.screenshot({path:path.join(out,'voice-hands-free-mobile.png')});
   await clickControl(page,'#voice-cancel');
   await page.waitForFunction(()=>document.querySelector('#hfb').getAttribute('aria-pressed')==='false');
   assert.equal(await page.evaluate(()=>Voice._test.handsFree()),null,'Cancel ends the conversation');
   assert.equal(voiceLog.transcribe.length,heard);
  });
  await check('Voice: only a hands-free reply listens again; replies and alerts outside it never open the mic',async()=>{
   const id=await page.evaluate(()=>chatId);
   const settle=async n=>{for(let i=0;i<60&&voiceLog.speak.length<n;i++)await pause(100);for(let i=0;i<60&&await page.evaluate(()=>Voice._test.state()==='speaking');i++)await pause(100);await pause(600);};
   // An old "Keep listening" preference must not reopen the mic any more.
   await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('pc-voice')||'{}');p.keepListening=true;p.speak=true;localStorage.setItem('pc-voice',JSON.stringify(p));});
   let n=voiceLog.speak.length;
   await page.evaluate(id=>{Voice._test.arm(id);Voice.onTurnEnd(id,true);},id);await settle(n+1);
   assert.ok(voiceLog.speak.length>n,'the reply to a plain-mic message is spoken');
   assert.equal(await page.evaluate(()=>Voice._test.state()),'idle','…and the mic stays off');
   // A notification never listens, even while a hands-free conversation is on.
   await page.evaluate(id=>Voice._test.setHandsFree(id),id);
   assert.match(await page.$eval('#voice-strip',e=>e.textContent),/Hands-free is on/);
   n=voiceLog.speak.length;await page.evaluate(()=>Voice.speak('Pocket Code. A session finished.'));await settle(n+1);
   assert.equal(await page.evaluate(()=>Voice._test.state()),'idle','an announcement does not open the mic');
   // The reply inside the hands-free conversation does listen for the answer.
   n=voiceLog.speak.length;await page.evaluate(id=>{Voice._test.arm(id);Voice.onTurnEnd(id,true);},id);
   await page.waitForFunction(()=>Voice._test.state()==='listening',{timeout:8000});
   assert.match(await page.$eval('#voice-strip',e=>e.textContent),/Hands-free\. Listening for your reply/);
   await clickControl(page,'#hfb');
   await page.waitForFunction(()=>Voice._test.state()==='idle'&&Voice._test.handsFree()===null);
   await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('pc-voice'));delete p.keepListening;localStorage.setItem('pc-voice',JSON.stringify(p));});
  });
  await check('Voice: the spoken reply follows the chosen length',async()=>{
   const id=await page.evaluate(()=>chatId);
   const said=async length=>{
    await page.evaluate(l=>{const p=JSON.parse(localStorage.getItem('pc-voice')||'{}');p.replyLength=l;p.speak=true;localStorage.setItem('pc-voice',JSON.stringify(p));},length);
    const n=voiceLog.speak.length;
    const expected=await page.evaluate((id,l)=>{const all=document.querySelectorAll('#msgs .m-asst:not(.live)');const c=all[all.length-1].cloneNode(true);
     c.querySelectorAll('.copybtn,.ledgerwrap,.choices,pre,table,.todo,.todos').forEach(n=>n.remove());
     const parts=VoiceText.chunks(VoiceText.reply((c.innerText||c.textContent).trim(),l));Voice._test.arm(id);Voice.onTurnEnd(id,true);return parts;},id,length);
    for(let i=0;i<80&&voiceLog.speak.length<n+expected.length;i++)await pause(100);
    for(let i=0;i<60&&await page.evaluate(()=>Voice._test.state()==='speaking');i++)await pause(100);
    return {expected,spoken:voiceLog.speak.slice(n).map(x=>x.text)};
   };
   const brief=await said('brief');assert.deepEqual(brief.spoken,brief.expected,'brief speaks one line');
   const detailed=await said('detailed');assert.deepEqual(detailed.spoken,detailed.expected,'detailed speaks the whole reply');
   assert.ok(detailed.expected.join(' ').length>=brief.expected.join(' ').length);
   await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('pc-voice'));delete p.replyLength;localStorage.setItem('pc-voice',JSON.stringify(p));});
  });
  await check('Reply suggestions: cards under the last reply send on tap; typing or X hides them',async()=>{
   const conv=conversations.get(idle),saved=conv.slice();await chat();
   conv.push({role:'assistant',blocks:[{t:'text',text:'Tests pass. Should I merge and deploy?'},{t:'choices',options:['Merge and deploy',"Don't merge yet"],rec:0}]});
   await page.evaluate(id=>{localStorage.removeItem('pc-choices-dismissed');localStorage.removeItem('pc-draft-'+id);},idle);
   await page.reload();await page.waitForSelector('#box');await page.$eval('#box',e=>{e.value='';e.dispatchEvent(new Event('input'));});
   await page.waitForSelector('.choices:not([hidden])');
   assert.deepEqual(await page.$$eval('.choices .choice',b=>b.map(x=>x.dataset.choice)),['Merge and deploy',"Don't merge yet"]);
   assert.deepEqual(await page.$$eval('.choices .choice',b=>b.map(x=>x.classList.contains('choice-rec'))),[true,false],'the marked option is the recommended one');
   assert.equal(await page.$eval('.choice-rec .choice-tag',e=>e.textContent),'Recommended');
   assert.equal(await page.$eval('.choice-rec',e=>e.textContent),'Merge and deployRecommended','the tag is in the accessible name');
   assert.ok(await page.$eval('.choice-rec',e=>{const s=getComputedStyle(e);return s.backgroundColor!==getComputedStyle(e.nextElementSibling).backgroundColor;}),'the recommended button is filled differently');
   assert.equal(await page.$eval('.choices',e=>e.closest('.m-asst')===[...document.querySelectorAll('#msgs .m-asst')].pop()),true,'under the latest reply');
   assert.ok(await page.$$eval('.choices button',b=>b.every(x=>{const r=x.getBoundingClientRect();return r.width>=44&&r.height>=44;})),'44px targets');
   assert.doesNotMatch(await page.$eval('#msgs',e=>e.textContent),/```|choices\n/,'the raw block never shows');
   await page.$eval('.choices',e=>e.scrollIntoView({block:'end'}));await pause(150);
   await scan('reply-suggestions-mobile');await page.screenshot({path:path.join(out,'reply-suggestions-mobile.png')});
   await page.type('#box','Something else');
   assert.equal(await page.$eval('.choices',e=>e.hidden),true,'typing your own answer hides them');
   await page.$eval('#box',e=>{e.value='';e.dispatchEvent(new Event('input'));});
   assert.equal(await page.$eval('.choices',e=>e.hidden),false);
   await clickControl(page,'.choice-x');
   assert.equal(await page.$eval('.choices',e=>e.hidden),true);
   assert.equal(await page.evaluate(()=>document.activeElement.id),'box','focus moves to the message box');
   await page.reload();await page.waitForSelector('#box');await pause(300);
   assert.equal(await page.$eval('.choices',e=>e.hidden),true,'a dismissal sticks for that reply');
   await page.evaluate(()=>localStorage.removeItem('pc-choices-dismissed'));await page.reload();await page.waitForSelector('#box');
   await page.waitForSelector('.choices:not([hidden])');
   const sent=received.length;await clickControl(page,'.choice');
   for(let i=0;i<40&&received.length===sent;i++)await pause(100);
   assert.equal(received.at(-1).text,'Merge and deploy','a tap sends the option as the next message');
   await page.waitForFunction(()=>!document.querySelector('.choices:not([hidden])'));
   await page.waitForFunction(()=>!loadOutbox(chatId)&&!sendsInFlight.has(chatId));      // delivered before the page reloads
   conv.splice(0,conv.length,...saved);await page.reload();await page.waitForSelector('#box');
  });
  await check('Context ring: fills with context use, explains itself on hover and opens the session usage',async()=>{
   await page.setViewport({width:1440,height:900});await page.reload();await page.waitForSelector('#box');
   await page.waitForFunction(()=>(document.querySelector('#ctx-ring')?.dataset.tip||'').includes('tokens used'));
   assert.ok(await page.$eval('#ctx-ring',e=>!!e.closest('.composer-actions')),'idle: beside the settings button');
   assert.equal(await page.$eval('#ctx-ring .ctx-fill',e=>e.getAttribute('stroke-dasharray')),'43.5 100');
   const tip=await page.$eval('#ctx-ring',e=>e.dataset.tip);
   assert.match(tip,/Opus 5\.5/);assert.match(tip,/435k of 1M tokens used \(44%\)/);
   assert.match(await page.$eval('#ctx-ring',e=>e.getAttribute('aria-label')),/Context window for Opus 5\.5: 435k of 1M tokens used \(44%\)/);
   assert.equal(await page.$('#ctx-meter'),null,'the old text meter is gone');
   await page.hover('#ctx-ring');await page.waitForFunction(()=>!document.getElementById('tip').hidden);
   assert.match(await page.$eval('#tip',e=>e.textContent),/435k of 1M tokens used/);
   await page.screenshot({path:path.join(out,'context-ring-hover.png')});
   await clickControl(page,'#ctx-ring');await page.waitForSelector('.usage-sheet #usage-body .usage-block');
   const sheet=await page.$eval('.usage-sheet',e=>e.textContent);
   assert.match(sheet,/This session · Opus 5\.5/);assert.match(sheet,/Context window/);assert.match(sheet,/Window1M tokens/);assert.match(sheet,/Used435k tokens/);assert.match(sheet,/Free565k tokens/);
   assert.match(sheet,/Claude Code/);assert.match(sheet,/5-hour/);
   await scan('context-usage-sheet');await page.screenshot({path:path.join(out,'context-usage-sheet.png')});
   await page.keyboard.press('Escape');
   assert.equal(await page.evaluate(()=>document.activeElement.id),'ctx-ring','focus returns to the ring');
   const run=rows.find(r=>r.state.kind==='running');
   await page.goto(base+'/#/chat/'+run.id);await page.waitForSelector('.workrow #ctx-ring');
   await page.setViewport({width:390,height:844});await chat();await page.waitForSelector('.composer-actions #ctx-ring');
   assert.ok(await page.$eval('#ctx-ring',e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.right<=innerWidth;}),'44px target on a phone');
  });
  await check('Hands-free: an instruction is read back and sent only after a yes or a tap on Send',async()=>{
   const id=await page.evaluate(()=>chatId);let sent=received.length;
   const spoken=()=>voiceLog.speak.map(x=>x.text).join(' | ');
   const tap=()=>page.evaluate(()=>document.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})));  // browsers allow sound after a tap
   await tap();
   await page.evaluate(id=>Voice._test.setHandsFree(id),id);
   await page.evaluate(()=>Voice._test.handle('Deploy the new build'));
   for(let i=0;i<40&&!/Ready to send: Deploy the new build/.test(spoken());i++)await pause(100);
   assert.match(spoken(),/Ready to send: Deploy the new build\./);
   for(let i=0;i<30&&!/Say send it, or cancel/.test(spoken());i++)await pause(100);
   assert.match(spoken(),/Say send it, or cancel\./);
   assert.equal(received.length,sent,'nothing sent before a yes');
   assert.deepEqual(await page.evaluate(()=>Voice._test.pending()),{id,text:'Deploy the new build'});
   await page.evaluate(()=>Voice._test.handle('Cancel'));
   assert.equal(await page.evaluate(()=>Voice._test.pending()),null);assert.equal(received.length,sent,'cancel sends nothing');
   await page.evaluate(()=>Voice._test.handle('Check the error logs'));
   await page.evaluate(()=>Voice._test.handle('Actually check the access logs'));
   assert.equal(await page.evaluate(()=>Voice._test.pending().text),'Actually check the access logs','a new instruction replaces the pending one');
   assert.equal(received.length,sent);
   await page.evaluate(()=>Voice._test.handle('Yes, send it'));
   for(let i=0;i<40&&received.length===sent;i++)await pause(100);
   assert.equal(received.at(-1).text,'Actually check the access logs','a yes sends it');
   sent=received.length;
   await page.evaluate(id=>{Voice.onLeave();Voice._test.setHandsFree(id);},id);await page.reload();await page.waitForSelector('#box');
   await tap();await page.evaluate(id=>Voice._test.setHandsFree(id),id);
   await page.evaluate(()=>Voice._test.handle('Summarize the queue'));
   await page.waitForFunction(()=>Voice._test.state()==='listening',{timeout:8000});
   await clickControl(page,'#voice-cancel');                                  // stop listening: the instruction waits with buttons
   await page.waitForSelector('#voice-send');
   assert.match(await page.$eval('#voice-strip',e=>e.textContent),/Send this\? “Summarize the queue”/);
   await scan('voice-confirm-mobile');await page.screenshot({path:path.join(out,'voice-confirm-mobile.png')});
   await clickControl(page,'#voice-send');
   for(let i=0;i<40&&received.length===sent;i++)await pause(100);
   assert.equal(received.at(-1).text,'Summarize the queue','tapping Send sends it');
   await page.evaluate(()=>Voice.onLeave());await page.reload();await page.waitForSelector('#box');
  });
  await check('Voice: Settings saves preferences and lists voices',async()=>{
   await page.evaluate(()=>settingsSheet());await page.waitForSelector('#s-voice');
   await clickControl(page,'#s-voice > summary');
   await page.waitForFunction(()=>document.querySelector('#s-voice-state').textContent.includes('available'));
   assert.deepEqual(await page.$$eval('#s-voice-voice option',o=>o.map(x=>x.value)),['af_heart','bm_george']);
   await clickControl(page,'#s-voice-review');
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pc-voice')).review),true);
   assert.equal(await page.$eval('#s-voice-wait',e=>e.value),'120','waits 2 minutes for a reply by default');
   assert.equal(await page.$eval('#s-voice-length',e=>e.value),'normal','spoken replies stay about two sentences by default');
   await page.select('#s-voice-length','detailed');
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pc-voice')).replyLength),'detailed');
   await page.select('#s-voice-length','normal');
   await page.select('#s-voice-wait','300');
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pc-voice')).replyWait),300);
   await page.select('#s-voice-voice','bm_george');
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pc-voice')).voice),'bm_george');
   await scan('settings-voice-mobile');
   await page.screenshot({path:path.join(out,'voice-settings-mobile.png')});
   await clickControl(page,'#s-voice-review');await page.keyboard.press('Escape');
  });
  await check('Voice: sessions that finish or need you are announced once; muted sessions stay quiet',async()=>{
   const saved=rows.map(r=>({state:r.state,muted:r.muted}));
   await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('pc-voice')||'{}');p.alerts='summary';localStorage.setItem('pc-voice',JSON.stringify(p));});
   await page.goto(base+'/#/');await page.waitForSelector('#settings');await page.mouse.click(5,5); // one tap unlocks audio
   await page.evaluate(()=>refreshSessions());await pause(300);await page.evaluate(()=>refreshSessions()); // status, then baseline
   const spoken=voiceLog.speak.length,at=Date.now();
   rows[1].state={kind:'finished',label:'Response ready',at};
   rows[2].state={kind:'input',label:'Needs approval',confirmed:true,approvals:1};
   rows[3].state={kind:'finished',label:'Response ready',at:at+1};rows[3].muted=true;
   await page.evaluate(()=>refreshSessions());
   const text=()=>voiceLog.speak.slice(spoken).map(x=>x.text).join(' | ');
   for(let i=0;i<120&&!(/finished\./.test(text())&&/needs your approval/.test(text()));i++)await pause(100);
   await pause(1500); // a summary is spoken as a second chunk
   const said=text(),settled=voiceLog.speak.length;
   assert.match(said,/finished\./,said);assert.match(said,/needs your approval\./,said);
   const short=t=>t.split(/\s+/).slice(0,3).join(' ');
   assert.ok(said.includes(short(rows[1].title)),said);assert.ok(!said.includes(short(rows[3].title)),'muted session stays quiet: '+said);
   await page.evaluate(()=>refreshSessions());await pause(1500);
   assert.equal(voiceLog.speak.length,settled,'each event is announced once: '+text());
   assert.equal((said.match(/finished\./g)||[]).length,1);assert.equal((said.match(/needs your approval/g)||[]).length,1);
   rows.forEach((r,i)=>{r.state=saved[i].state;if(saved[i].muted===undefined)delete r.muted;else r.muted=saved[i].muted;});
   await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('pc-voice'));p.alerts='off';localStorage.setItem('pc-voice',JSON.stringify(p));});
   await chat();
  });
  await check('Phone composer: the message box keeps a full row, idle and while a turn runs',async()=>{
   await page.setViewport({width:390,height:844});
   const run=rows.find(r=>r.state.kind==='running');
   for(const id of [idle,run.id]){
    await page.goto(base+'/#/chat/'+id);await page.waitForSelector('#box');await pause(200);
    const w=await page.$eval('#box',e=>e.getBoundingClientRect().width);
    assert.ok(w>=390*0.8,'box width '+w+' for '+id);
    const bad=await page.$$eval('.composer > .composer-actions button, .composer > .voice-mic:not([hidden]), .composer > .send, .composer > .send-mode button',b=>b.filter(x=>x.getClientRects().length).map(x=>{const r=x.getBoundingClientRect();return {id:x.id||x.className||x.textContent.trim().slice(0,20),right:Math.round(r.right),h:Math.round(r.height),w:Math.round(r.width)};}).filter(r=>r.right>innerWidth+1||r.h<40));
    assert.deepEqual(bad,[],'buttons on screen '+id);
   }
   // one row = every control's vertical centre within a few px of the others
   const spread=()=>page.$$eval('.composer > .voice-mic:not([hidden]), .composer > .send, .composer > .send-mode',els=>{const c=els.map(e=>{const r=e.getBoundingClientRect();return r.top+r.height/2;});return Math.max(...c)-Math.min(...c);});
   await page.screenshot({path:path.join(out,'composer-working-mobile.png')});
   assert.ok(await spread()<8,'steer choices, voice and Send share one row at 390px');
   await page.setViewport({width:360,height:800});await pause(200);
   await page.screenshot({path:path.join(out,'composer-working-360.png')});
   assert.ok(await spread()<8,'one row at 360px: '+await spread());
   await page.setViewport({width:390,height:844});
  });
  await check('Attention filter includes Response ready replies until they are opened',async()=>{
   const done=rows.find(r=>r.state.kind==='finished')||rows[4];const saved=done.state,at=Date.now();
   done.state={kind:'finished',label:'Response ready',at};
   await page.goto(base+'/#/');await page.waitForSelector('[data-filter="attention"]');
   delete done.seenAt;await page.evaluate(id=>{localStorage.removeItem('pc-seen-'+id);serverSeen.delete(id);seenPending.delete(id);},done.id);await page.evaluate(()=>refreshSessions());await pause(300);
   await clickControl(page,'[data-filter="attention"]');await pause(200);
   const listed=()=>page.evaluate(id=>filteredSessions().some(s=>s.id===id)&&[...document.querySelectorAll('.session-item .row')].some(b=>b.dataset.id===id),done.id);
   assert.equal(await listed(),true,'an unopened reply is in Attention');
   assert.match(await page.$eval('[data-filter="attention"]',e=>e.textContent),/Attention\s*\d+/,'counted');
   await page.evaluate(([id,at])=>{localStorage.setItem('pc-seen-'+id,String(at));},[done.id,at]);await page.evaluate(()=>refreshSessions());await pause(300);
   assert.equal(await listed(),false,'leaves Attention once opened');
   await clickControl(page,'[data-filter="all"]');done.state=saved;
  });
  await check('Mark reviewed clears Response ready without opening it, singly or all at once with Undo',async()=>{
   const done=rows.find(r=>r.state.kind==='finished')||rows[4];const saved=done.state,at=Date.now();
   done.state={kind:'finished',label:'Response ready',at};
   await page.goto(base+'/#/');await page.waitForSelector('[data-filter="attention"]');
   delete done.seenAt;await page.evaluate(id=>{localStorage.removeItem('pc-seen-'+id);serverSeen.delete(id);seenPending.delete(id);},done.id);await page.evaluate(()=>refreshSessions());await pause(300);
   await clickControl(page,'[data-filter="attention"]');await pause(200);
   const listed=()=>page.evaluate(id=>filteredSessions().some(s=>s.id===id),done.id);
   assert.equal(await listed(),true,'starts in Attention');
   await clickControl(page,`[data-more="${done.id}"]`);await page.waitForSelector('#so-reviewed');await page.screenshot({path:path.join(out,'review-option.png')});await clickControl(page,'#so-reviewed');await pause(200);
   assert.equal(await listed(),false,'single mark leaves Attention');
   assert.equal(await page.evaluate(()=>location.hash),'#/','did not open the conversation');
   delete done.seenAt;await page.evaluate(id=>{localStorage.removeItem('pc-seen-'+id);serverSeen.delete(id);seenPending.delete(id);},done.id);await page.evaluate(()=>paintSessionPanels());
   await page.waitForSelector('[data-mark-all-reviewed]');await page.screenshot({path:path.join(out,'review-bar.png')});
   await clickControl(page,'[data-mark-all-reviewed]');await pause(200);await page.screenshot({path:path.join(out,'review-bar-undo.png')});
   assert.equal(await listed(),false,'bulk mark leaves Attention');
   await pause(400);assert.equal(done.seenAt,at,'saved on the server for other devices');
   await clickControl(page,'[data-undo-reviewed]');await pause(400);
   assert.equal(await listed(),true,'Undo brings it back');
   assert.equal(done.seenAt,undefined,'Undo also clears it on the server');
   await page.evaluate(([id,at])=>localStorage.setItem('pc-seen-'+id,String(at)),[done.id,at]);
   await clickControl(page,'[data-filter="all"]');done.state=saved;delete done.seenAt;
  });
  await check('A reply reviewed on another device leaves Attention here, and one opened here is shared',async()=>{
   const done=rows.find(r=>r.state.kind==='finished')||rows[4];const saved=done.state,at=Date.now();
   done.state={kind:'finished',label:'Response ready',at};done.seenAt=at;
   await page.goto(base+'/#/');await page.waitForSelector('[data-filter="attention"]');
   await page.evaluate(id=>localStorage.removeItem('pc-seen-'+id),done.id);await page.evaluate(()=>refreshSessions());await pause(300);
   await clickControl(page,'[data-filter="attention"]');await pause(200);
   assert.equal(await page.evaluate(id=>filteredSessions().some(s=>s.id===id),done.id),false,'the other device\'s review counts here');
   delete done.seenAt;await page.evaluate(([id,at])=>localStorage.setItem('pc-seen-'+id,String(at)),[done.id,at]);
   await page.evaluate(()=>refreshSessions());await pause(600);
   assert.equal(done.seenAt,at,'a marker saved only in this browser is sent to the server');
   await clickControl(page,'[data-filter="all"]');done.state=saved;delete done.seenAt;
  });
  await check('A reply that finishes on screen stays Response ready until you engage with the page',async()=>{
   const done=rows.find(r=>r.state.kind==='finished')||rows[4];const saved=done.state;
   done.state={kind:'finished',label:'Response ready',at:Date.now()};
   await page.goto(base+'/#/chat/'+done.id);await page.waitForSelector('#box');
   delete done.seenAt;await page.evaluate(id=>{localStorage.removeItem('pc-seen-'+id);serverSeen.delete(id);seenPending.delete(id);awaitingEngagement.add(id);},done.id); // as if the turn ended while watching
   await page.evaluate(()=>refreshSessions());await pause(200);
   assert.equal(await page.evaluate(id=>localStorage.getItem('pc-seen-'+id),done.id),null,'an unattended screen does not mark it read');
   assert.equal(await page.evaluate(id=>isUnread(allSessions.find(s=>s.id===id)),done.id),true,'still New in the session list');
   await page.mouse.click(200,300);await page.evaluate(()=>refreshSessions());await pause(200);
   assert.equal(await page.evaluate(id=>localStorage.getItem('pc-seen-'+id),done.id),String(done.state.at),'engaging marks it read');
   done.state=saved;
  });
  await check('Subagents: live count, disclosure, safe details, refresh, failure and keyboard return',async()=>{
   const agents=[{id:'review',name:'Review imports',task:'Check duplicate SKUs <script>unsafe()</script>',latest:'Reading supplier.csv',status:'running',model:'Test model'},{id:'tests',name:'Check tests',task:'Run the import checks.',latest:'All checks passed.',status:'completed'}];
   setMode({agents});await page.setViewport({width:390,height:844});await chat();
   await page.waitForSelector('#agents-open:not([hidden])');
   assert.match(await page.$eval('#agents-open',e=>e.textContent),/1 subagent working/);
   await clickControl(page,'#agents-open');await page.waitForSelector('.agent-row');await clickControl(page,'.agent-row summary');
   assert.equal(await page.$$eval('.agent-copy script',es=>es.length),0);
   assert.match(await page.$eval('.agent-copy',e=>e.textContent),/<script>/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   agents[0].task='Check duplicate SKUs across supplier imports.';await page.evaluate(()=>refreshAgents(chatId));
   assert.equal(await page.$eval('.agents-retry',e=>getComputedStyle(e).display),'none');
   await scan('subagents-mobile');await page.screenshot({path:path.join(out,'subagents-mobile.png')});
   agents[0].latest='Checking duplicates now';await page.evaluate(()=>refreshAgents(chatId));
   assert.equal(await page.$eval('.agent-row',e=>e.open),true,'refresh preserves disclosure');
   assert.match(await page.$eval('.agent-detail',e=>e.textContent),/Checking duplicates now/);
   setMode({agentsFail:true});await page.evaluate(()=>refreshAgents(chatId));
   assert.match(await page.$eval('.agents-status',e=>e.textContent),/could not be confirmed/);
   assert.match(await page.$eval('.agent-state',e=>e.textContent),/unconfirmed/);
   setMode({agentsFail:false});agents[0].status='completed';agents[0].latest='No duplicates.';
   await clickControl(page,'.agents-retry');await page.waitForFunction(()=>document.querySelector('.agents-status').textContent.includes('0 working'));
   await page.setViewport({width:1440,height:900});await scan('subagents-desktop');await page.screenshot({path:path.join(out,'subagents-desktop.png')});
   await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'agents-open');
   await page.reload();await page.waitForSelector('#agents-open:not([hidden])');
   assert.match(await page.$eval('#agents-open',e=>e.textContent),/2 recorded/);
   setMode({agents:[]});await page.evaluate(()=>refreshAgents(chatId));
   assert.equal(await page.$eval('#agents-open',e=>e.hidden),true);
   await clickControl(page,'#chatmore');await clickControl(page,'#so-agents');await page.waitForFunction(()=>document.querySelector('.agents-status').textContent.includes('No subagents'));
   await page.keyboard.press('Escape');
  });
  await check('Pinned sessions: tabs carry the pin and follow the shared order; grip drag, arrow keys and Session options reorder',async()=>{
   await page.setViewport({width:1440,height:900});
   const a=rows[3].id,b=rows[4].id,clay='rgb(217, 119, 87)';
   await page.goto(base+'/#/chat/'+a);await page.waitForFunction(id=>chatId===id&&document.querySelector('#box'),{},a);
   await page.goto(base+'/#/chat/'+b);await page.waitForFunction(id=>chatId===id&&document.querySelector('#box'),{},b);
   assert.equal(await page.$$eval('#open-sessions .open-session.pinned',es=>es.length),0,'no pins yet');
   await clickControl(page,'#chatmore');await page.waitForSelector('#so-pin');await clickControl(page,'#so-pin');                       // pin the open session from its header
   await page.waitForSelector(`.session-item.pinned[data-item="${b}"] [data-grip]`);
   await clickControl(page,`[data-more="${a}"]`);await page.waitForSelector('#so-pin');await clickControl(page,'#so-pin');            // pin another from the rail
   await page.waitForSelector(`.session-item.pinned[data-item="${a}"]`);
   await page.waitForFunction(()=>document.querySelectorAll('#open-sessions .open-session.pinned').length===2);
   const tabs=()=>page.$$eval('#open-sessions .open-session',es=>es.map(e=>({pinned:e.classList.contains('pinned'),title:e.querySelector('a').textContent.replace(/^Pinned: /,'').trim(),color:getComputedStyle(e.querySelector('a')).color,mark:Boolean(e.querySelector('.pinmark'))})));
   let shown=await tabs();
   assert.deepEqual(shown.slice(0,2).map(t=>t.pinned),[true,true],'pinned tabs come first');assert.ok(shown.slice(2).every(t=>!t.pinned),'unpinned tabs after them');
   assert.deepEqual(shown.slice(0,2).map(t=>t.title),[rows[3].title,rows[4].title],'in the list order (recency) before any reorder');
   assert.ok(shown.slice(0,2).every(t=>t.mark&&t.color===clay),'pinned tabs show the pin in the accent: '+JSON.stringify(shown));
   const grip=await page.$(`[data-grip="${b}"]`),gb=await grip.boundingBox(),ab=await (await page.$(`.session-item[data-item="${a}"]`)).boundingBox();
   let n=pinOrders.length;
   await page.mouse.move(gb.x+gb.width/2,gb.y+gb.height/2);await page.mouse.down();await page.mouse.move(ab.x+ab.width/2,ab.y+4,{steps:8});
   assert.equal(await page.$eval(`.session-item[data-item="${a}"]`,e=>e.classList.contains('drop-before')),true,'drop target is marked while dragging');
   await page.mouse.up();
   for(let i=0;i<40&&pinOrders.length===n;i++)await pause(100);
   assert.deepEqual(pinOrders.at(-1),[b,a],'drag saves the order on the server');
   assert.deepEqual(await page.$$eval('.session-item.pinned',es=>es.map(e=>e.dataset.item)),[b,a],'the list moved at once');
   shown=await tabs();assert.deepEqual(shown.slice(0,2).map(t=>t.title),[rows[4].title,rows[3].title],'tabs follow the pinned order');
   n=pinOrders.length;await page.focus(`[data-grip="${b}"]`);await page.keyboard.press('ArrowDown');
   for(let i=0;i<40&&pinOrders.length===n;i++)await pause(100);
   assert.deepEqual(pinOrders.at(-1),[a,b],'arrow keys reorder too');
   assert.equal(await page.evaluate(()=>document.activeElement?.dataset.grip),b,'focus stays on the moved grip');
   assert.match(await page.$eval('#toast',e=>e.textContent),/Pinned 2 of 2/);
   await clickControl(page,`[data-more="${a}"]`);await page.waitForSelector('#so-pin-down');assert.equal(await page.$('#so-pin-up'),null,'the first pin cannot move up');
   n=pinOrders.length;await clickControl(page,'#so-pin-down');for(let i=0;i<40&&pinOrders.length===n;i++)await pause(100);
   assert.deepEqual(pinOrders.at(-1),[b,a],'Session options moves it too');
   await scan('pinned-tabs-desktop');await page.screenshot({path:path.join(out,'pinned-tabs-desktop.png')});
   for(const id of [a,b]){await clickControl(page,`[data-more="${id}"]`);await page.waitForSelector('#so-pin');await clickControl(page,'#so-pin');await page.waitForFunction(id=>!document.querySelector(`.session-item.pinned[data-item="${id}"]`),{},id);}
   await page.waitForFunction(()=>document.querySelectorAll('#open-sessions .open-session.pinned').length===0);
  });
  await check('Open-session tabs show each session status like its rail row; nothing when quiet or unconfirmed',async()=>{
   await page.setViewport({width:1440,height:900});
   const a=rows[3].id,b=rows[4].id;
   await page.goto(base+'/#/chat/'+a);await page.waitForFunction(id=>chatId===id&&document.querySelector('#box'),{},a);
   await page.goto(base+'/#/chat/'+b);await page.waitForFunction(id=>chatId===id&&document.querySelector('#box'),{},b);
   // One synchronous pass, so the list's background refresh cannot repaint between setting and reading.
   const r=await page.evaluate((a,b)=>{
    const sa=allSessions.find(s=>s.id===a),sb=allSessions.find(s=>s.id===b),saved=[sa.state,sb.state];
    const read=id=>{const tab=[...document.querySelectorAll('#open-sessions .open-session')].find(e=>e.querySelector('a').getAttribute('href').endsWith(id)),d=tab.querySelector('.tab-state'),cs=d&&getComputedStyle(d);
     return d?{cls:d.className,label:d.getAttribute('aria-label'),bg:cs.backgroundColor,border:cs.borderTopColor+' '+cs.borderTopWidth,anim:cs.animationName,w:d.getBoundingClientRect().width,tip:tab.querySelector('a').title,text:tab.querySelector('a').textContent}:null;};
    const out={};
    sa.state={kind:'running',label:'Running',confirmed:true};sb.state={kind:'input',label:'Needs your answer',confirmed:true};paintOpenSessions();out.running=read(a);out.input=read(b);
    sa.state={kind:'finished',label:'Response ready',at:Date.now()+1e9};sb.state={kind:'failed',label:'Turn failed',at:Date.now()+1e9};paintOpenSessions();out.finished=read(a);out.failed=read(b);
    sa.state={kind:'observed',label:'Activity elsewhere'};sb.state={kind:'idle',label:'Recent'};paintOpenSessions();out.observed=read(a);out.idle=read(b);
    sa.state={kind:'running',label:'Running',confirmed:true};sessionsStale=true;paintOpenSessions();out.stale=read(a);
    const probe=document.createElement('span');probe.className='session-status state-input';document.querySelector('.rail').append(probe);out.railInput=getComputedStyle(probe).color;probe.remove();
    sessionsStale=false;[sa.state,sb.state]=saved;paintOpenSessions();
    return out;
   },a,b);
   const clay='rgb(217, 119, 87)';
   assert.match(r.running.cls,/\bember\b/,'running reuses the ember');assert.equal(r.running.anim,'breathe');assert.equal(r.running.bg,clay);
   assert.equal(r.running.label,'Running');assert.match(r.running.tip,/ · Running$/);assert.equal(r.running.w,7,'small enough not to widen the tab');
   assert.equal(r.running.text,rows[3].title,'the status is not part of the tab text');
   assert.equal(r.input.bg,'rgb(217, 169, 78)','needs-you is amber, not the clay of a running turn');assert.equal(r.input.anim,'none','needs-you is a still dot, not the ember');assert.equal(r.input.label,'Needs your answer');assert.equal(r.railInput,'rgb(217, 169, 78)','the session list labels it in the same amber');
   assert.equal(r.finished.label,'Response ready');assert.notEqual(r.finished.bg,clay);
   assert.equal(r.failed.label,'Turn failed');assert.notEqual(r.failed.bg,r.finished.bg);
   assert.match(r.observed.border,/^rgb\(169, 158, 147\) [1-9]/,'activity elsewhere is a dim ring');
   assert.equal(r.idle,null,'quiet sessions show nothing');assert.equal(r.stale,null,'an unconfirmed list shows no status');
   await page.evaluate((a,b)=>{allSessions.find(s=>s.id===a).state={kind:'running',label:'Running',confirmed:true};allSessions.find(s=>s.id===b).state={kind:'input',label:'Needs your answer',confirmed:true};paintOpenSessions();},a,b);
   await scan('tab-status-desktop');await page.screenshot({path:path.join(out,'tab-status-desktop.png'),clip:{x:0,y:0,width:1440,height:160}});
  });
  await check('Prompt cache (1.28): the ring counts down, the usage sheet explains it, large expiring or cold tabs are marked',async()=>{
   await page.setViewport({width:1440,height:900});
   const id=rows[4].id,other=rows[3].id,min=60000;
   const cache=(ago,extra={})=>({at:Date.now()-ago*min,ttlMs:60*min,ttlKnown:true,cached:729000,lastTurn:{at:Date.now()-ago*min-2*min,read:707000,written:21000,input:4,hit:.97},...extra});
   const ring=()=>page.$eval('#ctx-ring',e=>({kind:e.dataset.cache||null,label:e.querySelector('.ctx-cache').textContent,tip:e.dataset.tip,aria:e.getAttribute('aria-label'),color:getComputedStyle(e.querySelector('.ctx-cache')).color,w:e.getBoundingClientRect().width}));
   const repaint=async kind=>{await page.evaluate(id=>paintContextMeter(id),id);await page.waitForFunction(k=>(document.querySelector('#ctx-ring')?.dataset.cache||null)===k,{},kind);};
   try{
    setMode({cache:cache(8)});
    await page.goto(base+'/#/chat/'+id);await page.waitForFunction(id=>chatId===id&&document.querySelector('#box'),{},id);
    await repaint('warm'); // already open from the previous check, so the hash change alone refetches nothing
    const warm=await ring();
    assert.match(warm.label,/^5[12]m$/,'minutes left beside the ring');assert.equal(warm.color,'rgb(169, 158, 147)','warm is dim, not a warning');
    assert.match(warm.tip,/435k of 1M tokens used \(44%\) · Prompt cache warm: about 5[12] min left, until .+ ET/);
    assert.match(warm.aria,/Context window for Opus 5\.5: 435k of 1M tokens used \(44%\)\. Prompt cache warm: about 5[12] min left, until .+ ET\. Open usage$/);
    await clickControl(page,'#ctx-ring');await page.waitForSelector('.usage-sheet .cache-block');
    let sheet=await page.$eval('.usage-sheet .cache-block',e=>e.textContent.replace(/\s+/g,' '));
    assert.match(sheet,/Prompt cache/);assert.match(sheet,/Status ?Warm · about 5[12] min left/);assert.match(sheet,/Expires ?([A-Z][a-z]{2} \d+, )?\d/);
    assert.match(sheet,/Cached ?729k tokens/);assert.match(sheet,/Lifetime ?1 hour/);assert.match(sheet,/The last turn, at .+ ET, started 97% from cache\./);
    assert.match(sheet,/Estimated from the last request at .+ ET; each request restarts the lifetime/);
    await page.waitForSelector('.usage-sheet #usage-body .usage-block');
    await scan('cache-usage-sheet');await page.screenshot({path:path.join(out,'cache-usage-sheet.png')});
    await page.keyboard.press('Escape');
    setMode({cache:cache(55)});await repaint('cooling');
    const cooling=await ring();assert.equal(cooling.label,'4m');assert.equal(cooling.color,'rgb(217, 169, 78)','the last stretch is amber');assert.match(cooling.tip,/Prompt cache cooling: about 4 min left/);
    await page.setViewport({width:390,height:844});await repaint('cooling');
    const phone=await page.evaluate(()=>{const r=document.getElementById('ctx-ring'),b=r.getBoundingClientRect(),row=r.parentElement.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,inRow:b.right<=row.right+0.5&&b.top>=row.top-0.5,h:b.height,x:b.x,y:b.y};});
    assert.equal(phone.overflow,false);assert.ok(phone.inRow,'the label stays inside the composer row');assert.ok(phone.h>=44,'still a 44px target');
    await scan('cache-ring-phone');await page.screenshot({path:path.join(out,'cache-ring-phone.png'),clip:{x:0,y:Math.max(0,phone.y-120),width:390,height:200}});
    await page.setViewport({width:1440,height:900});
    setMode({cache:cache(125,{lastTurn:{at:Date.now()-130*min,read:0,written:729000,input:4,hit:0}})});await repaint('cold');
    const cold=await ring();assert.equal(cold.label,'cold');assert.equal(cold.color,'rgb(159, 212, 240)','cold is ice blue');assert.equal(await page.$eval('#ctx-ring .ctx-fill',e=>getComputedStyle(e).stroke),'rgb(159, 212, 240)','the ring itself turns ice blue');assert.match(cold.aria,/Prompt cache expired at .+ ET; the next turn writes 729k tokens to cache again\. Open usage$/);
    const rr=await page.$eval('#ctx-ring',e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y};});
    await page.screenshot({path:path.join(out,'cache-ring-cold.png'),clip:{x:Math.max(0,rr.x-160),y:Math.max(0,rr.y-40),width:420,height:120}});
    await clickControl(page,'#ctx-ring');await page.waitForSelector('.usage-sheet .cache-block');
    sheet=await page.$eval('.usage-sheet .cache-block',e=>e.textContent.replace(/\s+/g,' '));
    assert.match(sheet,/Status ?Cold/);assert.match(sheet,/Expired ?([A-Z][a-z]{2} \d+, )?\d/);assert.match(sheet,/The last turn, at .+ ET, started cold: 729k tokens written to cache\./);assert.match(sheet,/The next turn writes the context to cache again/);
    await page.keyboard.press('Escape');
    setMode({cache:{...cache(8),ttlKnown:false,ttlMs:5*min,at:Date.now()-min}});await repaint('warm');
    await clickControl(page,'#ctx-ring');await page.waitForSelector('.usage-sheet .cache-block');
    assert.match(await page.$eval('.usage-sheet .cache-block',e=>e.textContent.replace(/\s+/g,' ')),/Lifetime ?5 minutes \(assumed\)/);
    await page.keyboard.press('Escape');
    setMode({cache:null});await repaint(null);
    const none=await ring();assert.equal(none.label,'');assert.equal(none.w,44,'no estimate: the ring alone, as before');assert.doesNotMatch(none.tip,/cache/i);
    // Tabs: only large sessions that are expiring or expired; warm, small and unconfirmed show nothing.
    await page.goto(base+'/#/chat/'+other);await page.waitForFunction(id=>chatId===id&&document.querySelector('#box'),{},other);
    await page.goto(base+'/#/chat/'+id);await page.waitForFunction(id=>chatId===id&&document.querySelector('#box'),{},id);
    const r=await page.evaluate((a,b)=>{
     const sa=allSessions.find(s=>s.id===a),sb=allSessions.find(s=>s.id===b),saved=[sa.cache,sb.cache],at=m=>Date.now()+serverSkew-m*60000;
     const read=id=>{const tab=[...document.querySelectorAll('#open-sessions .open-session')].find(e=>e.querySelector('a').getAttribute('href').endsWith(id)),m=tab.querySelector('.tab-cache');
      return m?{cls:m.className,label:m.getAttribute('aria-label'),role:m.getAttribute('role'),w:m.getBoundingClientRect().width,color:getComputedStyle(m).color,tip:tab.querySelector('a').title,text:tab.querySelector('a').textContent}:null;};
     const out={};
     sa.cache={at:at(125),ttlMs:3600000,cached:300000};sb.cache={at:at(55),ttlMs:3600000,cached:300000};paintOpenSessions();out.cold=read(a);out.cooling=read(b);
     sa.cache={at:at(5),ttlMs:3600000,cached:300000};sb.cache={at:at(125),ttlMs:3600000,cached:50000};paintOpenSessions();out.warm=read(a);out.small=read(b);
     sa.cache={at:at(125),ttlMs:3600000,cached:300000};sessionsStale=true;paintOpenSessions();out.stale=read(a);
     sessionsStale=false;[sa.cache,sb.cache]=saved;paintOpenSessions();
     return out;
    },other,id);
    assert.match(r.cold.cls,/tab-cache-cold/);assert.equal(r.cold.role,'img');assert.equal(r.cold.label,'Prompt cache expired: 300k tokens to write again');
    assert.match(r.cold.tip,/ · Prompt cache expired: 300k tokens to write again$/);assert.equal(r.cold.text,rows[3].title,'the mark adds no text to the tab');
    assert.ok(r.cold.w<=13,'small enough not to widen the tab');assert.equal(r.cold.color,'rgb(169, 158, 147)','dim, so it never reads as a session status colour');
    assert.match(r.cooling.cls,/tab-cache-cooling/);assert.equal(r.cooling.label,'Prompt cache expiring soon');
    assert.equal(r.warm,null,'a warm cache shows nothing');assert.equal(r.small,null,'a small session shows nothing');assert.equal(r.stale,null,'an unconfirmed list shows nothing');
    // The live list carries the estimate: both marks arrive with the next poll.
    rows[3].cache={at:Date.now()-125*min,ttlMs:60*min,cached:300000};rows[4].cache={at:Date.now()-55*min,ttlMs:60*min,cached:640000};
    await page.waitForFunction(()=>document.querySelectorAll('#open-sessions .tab-cache').length===2,{timeout:12000});
    await scan('cache-tabs-desktop');await page.screenshot({path:path.join(out,'cache-tabs-desktop.png'),clip:{x:0,y:0,width:1440,height:160}});
   }finally{setMode({cache:null});delete rows[3].cache;delete rows[4].cache;}
  });
  await check('Voice: one tap mutes replies and announcements on this device; settings mirror it; hands-free turns it back on',async()=>{
   await page.setViewport({width:390,height:844});await chat();await page.waitForSelector('#micb:not([hidden])');
   await page.waitForSelector('[data-voice-mute]:not([hidden])');
   assert.equal(await page.$eval('[data-voice-mute]',e=>e.getAttribute('aria-pressed')),'false');
   assert.match(await page.$eval('[data-voice-mute]',e=>e.textContent),/^Voice$/);
   await clickControl(page,'[data-voice-mute]');
   assert.equal(await page.evaluate(()=>Voice.isMuted()),true);
   assert.match(await page.$eval('[data-voice-mute]',e=>e.textContent),/Voice off/);
   assert.equal(await page.$eval('[data-voice-mute]',e=>e.getAttribute('aria-pressed')),'true');
   const spoken=voiceLog.speak.length;
   await page.evaluate(()=>Voice._test.handle('Read it.'));await pause(400);
   assert.equal(voiceLog.speak.length,spoken,'a quick command is answered on screen, not spoken');
   const strip=await page.$eval('#voice-strip',e=>e.textContent);assert.ok(strip.length>12&&!/^Heard:/.test(strip),'the strip shows the answer: '+strip);
   await page.evaluate(id=>{Voice._test.arm(id);Voice.onTurnEnd(id,true);},idle);await pause(400);
   assert.equal(voiceLog.speak.length,spoken,'a finished turn is not read aloud while muted');
   assert.equal(await page.evaluate(()=>Voice.replacesChime()),false,'the chime preference applies while muted');
   await page.evaluate(()=>settingsSheet());await page.waitForSelector('#s-voice-mute');
   assert.equal(await page.$eval('#s-voice-mute',e=>e.getAttribute('aria-pressed')),'true','Settings shows the same switch');
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.scrim'));
   await scan('voice-muted-mobile');await page.screenshot({path:path.join(out,'voice-muted-mobile.png')});
   await page.$eval('#box',e=>{e.value='';e.dispatchEvent(new Event('input'));});                                      // a saved draft would hide the headset
   await clickControl(page,'#hfb');await page.waitForFunction(()=>!Voice.isMuted());                                            // starting hands-free is asking to hear it
   await page.waitForSelector('#voice-cancel');await clickControl(page,'#voice-cancel');
   assert.equal(await page.$eval('[data-voice-mute]',e=>e.getAttribute('aria-pressed')),'false');
  });
  await check('Voice: the mic is hidden when the server has no voice engine',async()=>{
   setMode({voice:false});await page.reload();await page.waitForSelector('#box');await pause(300);
   assert.equal(await page.$eval('#micb',e=>e.hidden),true);assert.equal(await page.$eval('#hfb',e=>e.hidden),true);
   setMode({voice:true});await page.reload();await page.waitForSelector('#micb:not([hidden])');
  });
  // ---------- 1.19: fixes from the 2026-10-08 UI/UX audit ----------
  await check('1.19 Reading measure: prose stops near 68 characters on wide screens; tables keep the full width',async()=>{
   const target=rows[3].id,prose='Stock on hand covers the next three weeks for most products, but the outdoor camera line will run short before the incoming order lands, so we should move part of the recorder budget to cameras this month.';
   conversations.set(target,[{role:'user',text:'How does stock look?'},{role:'assistant',blocks:[{t:'text',text:prose+'\n\n- '+prose+'\n\n| Product | On hand | Incoming | Supplier reference | Notes |\n|---|---:|---:|---|---|\n| Outdoor camera | 24 | 12 | WAREHOUSE-LONG-REFERENCE-001 | '+prose+' |'}]}]);
   await page.setViewport({width:1440,height:900});await page.goto(base+'/#/chat/'+target);await page.waitForSelector('.m-asst .report-table');
   const m=await page.evaluate(()=>{const p=[...document.querySelectorAll('.m-asst :is(p,ul,ol,blockquote)')].find(e=>!e.closest('.report-table')),t=document.querySelector('.report-table'),size=parseFloat(getComputedStyle(p).fontSize);
    const probe=document.createElement('div');probe.style.width='68ch';p.parentElement.append(probe);const limit=probe.getBoundingClientRect().width;probe.remove();
    const para=[...document.querySelectorAll('.m-asst p')].find(e=>e.textContent.length>150),range=document.createRange();range.selectNodeContents(para);
    const lines=new Set([...range.getClientRects()].map(r=>Math.round(r.top))).size;
    return {p:p.getBoundingClientRect().width,t:t.getBoundingClientRect().width,limit,size,charsPerLine:Math.round(para.textContent.length/lines),msgs:document.querySelector('.msgs').getBoundingClientRect().width};});
   assert.ok(m.p<=m.limit+1,'prose width '+JSON.stringify(m));assert.ok(m.charsPerLine<=80,'line length '+JSON.stringify(m));assert.ok(m.t>m.p+100,'tables keep the wide frame '+JSON.stringify(m));
   await page.screenshot({path:path.join(out,'measure-desktop.png')});
  });
  await check('1.19 Phone header: the run status shares the title bar with the project, with no separate strip',async()=>{
   await page.setViewport({width:390,height:844});
   await page.evaluate(()=>{headerCollapsed=false;writeLocal('pc-header-collapsed',false);});await chat();await page.evaluate(()=>refreshSessions());
   const r=await page.evaluate(()=>{const c=document.getElementById('run-confirmation'),tag=document.getElementById('cproj');
    return {inHeader:Boolean(c.closest('header.bar h1')),inControls:document.getElementById('conversation-controls').contains(c),dy:Math.abs(c.getBoundingClientRect().bottom-tag.getBoundingClientRect().bottom),
     header:document.querySelector('.chatcol > header.bar').getBoundingClientRect().height,visible:c.getClientRects().length>0,label:c.textContent};});
   assert.ok(r.inHeader&&!r.inControls&&r.visible,JSON.stringify(r));
   assert.equal(await page.$eval('#run-confirmed-state',e=>e.textContent),'Idle','short words in the title bar');assert.ok(r.dy<6,'project and status on one line '+JSON.stringify(r));assert.ok(r.header<=60,JSON.stringify(r));
   await scan('status-in-header-mobile');await page.screenshot({path:path.join(out,'status-in-header-mobile.png')});
   await page.setViewport({width:1440,height:900});
   await page.waitForFunction(()=>document.getElementById('conversation-controls').contains(document.getElementById('run-confirmation')));
   await page.evaluate(()=>paintRunConfirmation());assert.equal(await page.$eval('#run-confirmed-state',e=>e.textContent),'No active run here','the strip keeps the full wording');
   await page.setViewport({width:390,height:844});
   await page.waitForFunction(()=>Boolean(document.getElementById('run-confirmation').closest('header.bar h1')));
  });
  await check('1.19 Automated runs: one collapsed group at the end of All; search shows them normally',async()=>{
   const extra={id:'77777777-7777-4777-8777-777777777777',title:'Nightly backup check',automated:true,cwd:'/workspaces/ops',provider:'codex',mtimeMs:Date.now()-50000,state:{kind:'idle',label:'Recent'}};
   rows.push(extra);
   try{
    await page.goto(base+'/#/');await page.evaluate(()=>{localStorage.removeItem('pc-automated-open');sessionFilter='all';sessionQuery='';refreshSessions();});
    await page.waitForSelector('[data-automated]');
    const g=await page.$eval('[data-automated]',(e,id)=>({open:e.open,last:e===e.parentElement.lastElementChild,has:Boolean(e.querySelector(`[data-id="${id}"]`)),label:e.querySelector('summary h2').textContent}),extra.id);
    assert.equal(g.open,false);assert.ok(g.last&&g.has,JSON.stringify(g));assert.equal(g.label,'Automated1');
    assert.equal(await page.$$eval('.session-group:not([data-automated]) [data-id="'+extra.id+'"]',e=>e.length),0,'not repeated in Recent');
    await clickControl(page,'[data-automated] > summary');await page.waitForFunction(()=>readLocal('pc-automated-open',false)===true);
    await page.evaluate(()=>refreshSessions());assert.equal(await page.$eval('[data-automated]',e=>e.open),true,'open state survives a refresh');
    await scan('automated-group-mobile');await page.screenshot({path:path.join(out,'automated-group-mobile.png')});
    await page.type('[data-session-search]','backup');
    assert.equal(await page.$('[data-automated]'),null);assert.ok(await page.$(`section.session-group [data-id="${extra.id}"]`));
   } finally {
    rows.splice(rows.indexOf(extra),1);
    await page.evaluate(()=>{localStorage.removeItem('pc-automated-open');sessionQuery='';document.querySelectorAll('[data-session-search]').forEach(i=>i.value='');refreshSessions();});
   }
  });
  await check('1.19 Session list: an unchanged list answers 304 and still counts as a fresh check',async()=>{
   await page.goto(base+'/#/');await page.waitForSelector('[data-id]');
   const before=getMode().notModified||0,t0=await page.evaluate(async()=>{await refreshSessions();return sessionCheckedAt;});
   await pause(20);await page.evaluate(()=>refreshSessions());
   assert.ok((getMode().notModified||0)>before,'a 304 was served');
   assert.ok(await page.evaluate(()=>sessionCheckedAt)>t0,'the check time advanced');
   assert.equal(await page.evaluate(()=>sessionsStale),false);
   assert.ok(await page.$$eval('[data-session-results] [data-id]',e=>e.length)>=rows.length,'the list is kept');
  });
  await check('1.19 Failed turn: the reason and Send again at the end of the conversation; a draft is never overwritten',async()=>{
   const failed=rows[2],prior=failed.state;
   failed.state={kind:'failed',label:'Turn failed',at:Date.now(),confirmed:true,error:'Tool crashed while reading the supplier file'};
   try{
    await page.goto(base+'/#/chat/'+failed.id);await page.waitForSelector('#box');await page.evaluate(()=>refreshSessions());
    await page.waitForSelector('#turn-failure');
    assert.match(await page.$eval('#turn-failure',e=>e.textContent),/This turn ended with an error: Tool crashed while reading the supplier file/);
    assert.equal(await page.$eval('#msgs',e=>e.lastElementChild.id),'turn-failure','shown where you are reading');
    await page.waitForFunction(()=>{const r=document.querySelector('[data-retry-turn]').getBoundingClientRect(),c=document.querySelector('.composerwrap').getBoundingClientRect();return r.bottom<=c.top;},{timeout:3000}); // Send again is above the composer, not behind it
    await scan('turn-failure-mobile');await page.screenshot({path:path.join(out,'turn-failure-mobile.png')});
    await page.$eval('#box',e=>{e.value='My own draft';e.dispatchEvent(new Event('input'));});
    const before=received.length;await clickControl(page,'[data-retry-turn]');await pause(300);
    assert.equal(await page.$eval('#box',e=>e.value),'My own draft');assert.equal(received.length,before,'nothing sent over a draft');
    await page.$eval('#box',e=>{e.value='';e.dispatchEvent(new Event('input'));});
    await clickControl(page,'[data-retry-turn]');
    for(let i=0;i<40&&received.length===before;i++)await pause(100);
    assert.equal(received.at(-1).text,'Review the stock report.');
    assert.equal(await page.$('#turn-failure'),null,'the row goes once you send');
   } finally {failed.state=prior;}
  });
  await check('1.19 Session options: grouped, with display settings last',async()=>{
   await chat();await clickControl(page,'#chatmore');await page.waitForSelector('.sheet .opt-group');
   const groups=await page.$$eval('.sheet .opt-group',gs=>gs.map(g=>({label:g.getAttribute('aria-label'),ids:[...g.querySelectorAll('button.opt')].map(b=>b.id),size:Boolean(g.querySelector('.chat-text-settings'))})));
   assert.deepEqual(groups.map(g=>g.label),['This conversation','Session','Server process','Display and version']);
   assert.deepEqual(groups[0].ids,['so-find','so-changes','so-agents','so-usage']);
   assert.ok(groups.at(-1).size&&groups.at(-1).ids.includes('so-version'));
   assert.ok(await page.$eval('#so-find',e=>e.getBoundingClientRect().bottom<innerHeight),'the first action is in view on a phone');
   await scan('session-options-grouped-mobile');await page.screenshot({path:path.join(out,'session-options-grouped-mobile.png')});
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.scrim'));
  });
  await check('1.19 New session: the most recent workspace is preselected; missing input is explained beside Start',async()=>{
   await page.evaluate(()=>{localStorage.removeItem('pc-lastproj');clearDraft(NEW_KEY);});
   await page.goto(base+'/#/new');await page.waitForSelector('#plist .row.sel');
   assert.equal(await page.$eval('#plist .row.sel',e=>e.dataset.p),'/workspaces/warehouse');
   assert.match(await page.$eval('#task-context',e=>e.textContent),/warehouse/);
   await page.$eval('#first',e=>{e.value='';e.dispatchEvent(new Event('input'));});await clickControl(page,'#start');
   assert.equal(await page.$eval('#start-hint',e=>e.hidden),false);assert.match(await page.$eval('#start-hint',e=>e.textContent),/Write what you would like done/);
   await scan('new-session-hint-mobile');
   await page.type('#first','x');assert.equal(await page.$eval('#start-hint',e=>e.hidden),true);
   await page.$eval('#first',e=>{e.value='';e.dispatchEvent(new Event('input'));});
  });
  await check('1.20 Settings: generated titles switch on and off, choose a model, and say why one is unavailable',async()=>{
   await page.setViewport({width:390,height:844});await page.goto(base+'/#/');await page.waitForSelector('#settings');
   await clickControl(page,'#settings');await page.waitForFunction(()=>!document.querySelector('#s-titles').disabled);
   assert.equal(await page.$eval('#s-titles',e=>e.getAttribute('aria-pressed')),'true');
   assert.match(await page.$eval('#s-titles-state',e=>e.textContent),/On, using Claude · Haiku/);
   assert.deepEqual(await page.$$eval('#s-title-model option',os=>os.map(o=>[o.value,o.disabled])),[['auto',false],['claude',false],['codex',true]],'an unavailable provider cannot be chosen');
   assert.match(await page.$eval('#s-title-model option[value="codex"]',o=>o.textContent),/unavailable/);
   assert.match(await page.$eval('#s-title-note',e=>e.textContent),/Last title by Haiku 4\.5/);
   await clickControl(page,'[data-settings-category=conversation]');
   assert.ok(await page.$eval('#s-titles',e=>e.getBoundingClientRect().height)>=44);
   await page.$eval('#s-titles',e=>e.scrollIntoView({block:'center'}));
   await scan('title-settings-mobile');await page.screenshot({path:path.join(out,'title-settings-mobile.png')});
   await clickControl(page,'#s-titles');await page.waitForFunction(()=>document.querySelector('#s-titles').getAttribute('aria-pressed')==='false');
   assert.equal(settingsState().autoTitles,false);assert.equal(await page.$eval('#s-title-model',e=>e.disabled),false,'the model choice stays available while summaries are on (1.21)');
   assert.match(await page.$eval('#s-titles-state',e=>e.textContent),/^Off\./);
   await clickControl(page,'#s-titles');await page.waitForFunction(()=>!document.querySelector('#s-title-model').disabled);
   await page.select('#s-title-model','claude');await page.waitForFunction(()=>!document.querySelector('#s-title-model').disabled);
   assert.equal(settingsState().titleProvider,'claude');
   await page.select('#s-title-model','auto');await page.waitForFunction(()=>!document.querySelector('#s-title-model').disabled);
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.scrim'));
  });
  await check('1.20.1 Polish: chip fade and short label, gauge track, home workspace, copy, Git, 44px targets, suggestion X',async()=>{
   await page.setViewport({width:390,height:844});
   await page.goto(base+'/#/');await page.waitForSelector('[data-id]');
   const meta=await page.$eval(`[data-id="${idle}"] .meta`,e=>e.textContent.trim());
   assert.equal(meta,'Claude','a session in the default workspace shows only the agent');
   assert.match(await page.$eval(`[data-id="${rows[0].id}"] .meta`,e=>e.textContent),/warehouse · Claude/,'other workspaces stay named');
   const summary=n=>page.evaluate(n=>{const saved=allSessions;allSessions=Array.from({length:n},(_,i)=>({id:'a'+i,state:{kind:'input',label:'Needs approval'}}));const s=sessionSummary();allSessions=saved;return s;},n);
   assert.match(await summary(1),/· 1 needs attention$/);assert.match(await summary(2),/· 2 need attention$/);
   rows[4].repo=false;
   try{
    await chat();await page.waitForSelector('#c-approval');
    assert.equal(await page.$eval('#git-open',e=>e.hidden),true,'no Git control outside a repository');
    const chip=await page.$eval('#c-approval',e=>({text:e.innerText.trim(),label:e.getAttribute('aria-label')}));
    assert.match(chip.text,/^(Full|Review)$/);assert.match(chip.label,/^Permissions for the next turn: (Full access|Review actions)$/);
    const fade=await page.$eval('#tbar',e=>({over:e.scrollWidth>e.clientWidth+1,end:e.classList.contains('fade-end')}));
    assert.equal(fade.end,fade.over,'the scrolling edge fades exactly when the row overflows');
    assert.match(await page.$eval('.ctx-ring .ctx-track',e=>getComputedStyle(e).strokeDasharray),/\d/,'dotted gauge track');
    const small=await page.$$eval('.copybtn.msgcopy, .toolbar-scroll > .icon:not([hidden])',es=>es.map(e=>e.getBoundingClientRect()).filter(r=>r.width&&(r.width<44||r.height<44)).length);
    assert.equal(small,0,'copy and scroll controls are 44px');
   } finally {delete rows[4].repo;}
   await openChat(rows[0].id);
   assert.equal(await page.$eval('#git-open',e=>e.hidden),false,'Git stays where the server does not say otherwise');
   // Suggested replies: two long options wrap, the X stays on the first line.
   const id=rows[3].id;conversations.set(id,[{role:'user',text:'Ready?'},{role:'assistant',blocks:[{t:'text',text:'Tests pass. What next?'},{t:'choices',options:['Merge the pull request and deploy it to both servers now','Hold the release until I have reviewed it']}]}]);
   await openChat(id);
   await page.$eval('#box',e=>{e.value='';e.dispatchEvent(new Event('input'));});
   await page.waitForSelector('.choices:not([hidden])');
   const pos=await page.$eval('.choices',c=>{const x=c.querySelector('.choice-x').getBoundingClientRect(),first=c.querySelector('.choice').getBoundingClientRect();return {xTop:Math.round(x.top),firstTop:Math.round(first.top)};});
   assert.ok(Math.abs(pos.xTop-pos.firstTop)<4,'dismiss X on the first line '+JSON.stringify(pos));
   await scan('polish-choices-mobile');await page.screenshot({path:path.join(out,'polish-choices-mobile.png')});
  });
  await check('1.21/1.25 While you were away: divider at the first new message, view opens at the end, away card above the choices, Read from there, none on re-render',async()=>{
   await page.setViewport({width:390,height:844});
   const id=rows[1].id,now=Date.now(),ts=m=>new Date(now-m*60000).toISOString(),long='Paragraph of earlier work that you already read. '.repeat(8);
   conversations.set(id,[
    ...Array.from({length:6},(_,i)=>[{role:'user',text:'Earlier question '+i,ts:ts(300-i*10)},{role:'assistant',blocks:[{t:'text',text:long}],ts:ts(299-i*10)}]).flat(),
    {role:'user',text:'Check stock and draft the order',ts:ts(60)},
    {role:'assistant',blocks:[{t:'tool',name:'Bash',detail:'stock --all'},{t:'tool',name:'Read',detail:'reorder.csv'},{t:'tool',name:'Bash',detail:'draft-order'},{t:'text',text:'Three products are below their reorder level. The order is drafted. '+'Details for each product follow in the table below. '.repeat(14)}],ts:ts(30)},
    {role:'assistant',blocks:[{t:'text',text:'Waiting for your approval before sending it. Send the order?'},{t:'choices',options:['Send the order','Hold it for now'],rec:0}],ts:ts(20)},
   ]);
   const since=now-45*60000;await page.evaluate((id,since)=>{viewedAt[id]=since;writeLocal('pc-viewed',viewedAt);},id,since);
   const before=(getMode().awayCalls||[]).length;
   await page.goto(base+'/#/');await page.waitForSelector('[data-id]');
   await page.evaluate(id=>{location.hash='#/chat/'+id;},id);await page.waitForSelector('#away-divider');
   await page.waitForFunction(()=>document.querySelector('#away-card .away-body li'));await pause(500);
   const r=await page.evaluate(()=>{const d=document.getElementById('away-divider'),c=document.getElementById('away-card'),s=d.closest('main.scroll'),last=[...document.querySelectorAll('#msgs > .m-asst')].pop();
    return {label:d.getAttribute('aria-label'),after:d.nextElementSibling?.dataset.ts,before:d.previousElementSibling?.dataset.ts,
     cardLabel:c.querySelector('#away-card-label').textContent,inLast:c.parentElement===last,beforeChoices:c.nextElementSibling?.classList.contains('choices')&&!c.nextElementSibling.hidden,
     gap:Math.round(s.scrollHeight-s.scrollTop-s.clientHeight),dividerAbove:d.getBoundingClientRect().bottom<s.getBoundingClientRect().top,anchored:Boolean(awayAnchor?.isConnected),following:awayFollow};});
   assert.match(r.label,/^New since (?:yesterday )?\d{1,2}:\d{2}/);
   assert.equal(r.after,ts(30),'the divider sits before the first message after you left');assert.equal(r.before,ts(60),'your message from before you left stays above');
   assert.ok(r.gap<40,'the view opens at the end '+JSON.stringify(r));assert.ok(r.dividerAbove,'the divider is up in the conversation, not on screen');
   assert.equal(r.cardLabel,r.label,'the card repeats the New since line');assert.ok(r.inLast&&r.beforeChoices,'the card sits in the latest reply above its suggested replies '+JSON.stringify(r));
   assert.ok(r.following&&!r.anchored,'the view follows the end while the page settles');
   assert.deepEqual(await page.$$eval('#away-card .away-body li',l=>l.map(x=>x.textContent)),['Checked stock for 24 products','Three are below their reorder level','Waiting on you: approve the order']);
   assert.match(await page.$eval('#away-card .away-source',e=>e.textContent),/^Summary by Haiku 5\.5\./);
   assert.equal((getMode().awayCalls||[]).length,before+1);assert.equal(getMode().awayCalls.at(-1),since);
   await scan('away-mobile');await page.screenshot({path:path.join(out,'away-mobile.png')});
   await page.setViewport({width:1440,height:900});await pause(200);await page.screenshot({path:path.join(out,'away-desktop.png')});await page.setViewport({width:390,height:844});await pause(200);
   // Read from there: the divider comes to the top and holds; a scroll releases it.
   await clickControl(page,'#away-jump');await pause(100);
   const j=await page.evaluate(()=>{const d=document.getElementById('away-divider'),s=d.closest('main.scroll');return {top:Math.round(d.getBoundingClientRect().top-s.getBoundingClientRect().top),anchored:Boolean(awayAnchor?.isConnected),following:awayFollow};});
   assert.ok(j.top>=0&&j.top<=24&&j.anchored&&!j.following,'Read from there moves to the divider and holds it '+JSON.stringify(j));
   await page.evaluate(()=>document.querySelector('main.scroll').dispatchEvent(new WheelEvent('wheel',{deltaY:40})));
   assert.equal(await page.evaluate(()=>awayAnchor),null,'a scroll releases the hold');
   // A resync of the conversation you are reading (turn end, rail toggle) never adds a divider or a card.
   await page.evaluate(id=>renderChat(id),id);await page.waitForSelector('#box');await pause(200);
   assert.equal(await page.$('#away-divider'),null);assert.equal(await page.$('#away-card'),null);
   // Coming back right after leaving: nothing new, no divider and no call.
   await page.goto(base+'/#/');await page.waitForSelector('[data-id]');await page.evaluate(id=>{location.hash='#/chat/'+id;},id);await page.waitForFunction(id=>chatId===id&&document.querySelector('#ctitle')?.textContent!=='Session',{},id);await pause(300);
   assert.equal(await page.$('#away-divider'),null);assert.equal((getMode().awayCalls||[]).length,before+1);
   // A short exchange whose divider is already on screen at the end gets the divider only: no summary, no card.
   await page.goto(base+'/#/');await page.waitForSelector('[data-id]');                     // leaving records a fresh viewed time, so set it from the list
   await page.evaluate((id,since)=>{viewedAt[id]=since;writeLocal('pc-viewed',viewedAt);},id,now-25*60000);
   await page.evaluate(id=>{location.hash='#/chat/'+id;},id);await page.waitForSelector('#away-divider');await pause(400);
   assert.equal(await page.$('#away-card'),null,'one short message with its divider on screen: no card');
   assert.equal((getMode().awayCalls||[]).length,before+1,'no summary call for a short exchange');
   assert.ok(await page.evaluate(()=>{const s=document.querySelector('main.scroll');return s.scrollHeight-s.scrollTop-s.clientHeight<40;}),'still opens at the end');
  });
  await check('1.21 Settings: Summarize what you missed switches summaries on and off',async()=>{
   await page.goto(base+'/#/');await page.waitForSelector('#settings');await clickControl(page,'#settings');
   await page.waitForFunction(()=>!document.querySelector('#s-away').disabled);
   assert.equal(await page.$eval('#s-away',e=>e.getAttribute('aria-pressed')),'true');
   assert.match(await page.$eval('#s-away-state',e=>e.textContent),/opens at the end with a New since card/);
   await clickControl(page,'#s-away');await page.waitForFunction(()=>document.querySelector('#s-away').getAttribute('aria-pressed')==='false');
   assert.equal(settingsState().awaySummaries,false);
   await page.$eval('#s-away',e=>e.scrollIntoView({block:'center'}));await scan('away-settings-mobile');
   await clickControl(page,'#s-away');await page.waitForFunction(()=>document.querySelector('#s-away').getAttribute('aria-pressed')==='true');
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.scrim'));
  });
  await check('1.24 Message times: a time on each timestamped message (with the date on other days), a divider per day, live dividers, setting hides both',async()=>{
   await page.setViewport({width:390,height:844});
   // Anchor fixture times at local noon so subtracting hours cannot cross midnight.
   const id=rows[3].id,now=new Date().setHours(12,0,0,0),day=86400000,ts=ms=>new Date(ms).toISOString();
   conversations.set(id,[
    {role:'user',text:'Start the stock review.',ts:ts(now-2*day-3600000)},{role:'assistant',blocks:[{t:'text',text:'Counting the warehouse shelves now.'}],ts:ts(now-2*day-3500000)},
    {role:'user',text:'Any surprises?',ts:ts(now-day-7200000)},{role:'assistant',blocks:[{t:'text',text:'Two recorders are missing from bay 4.'}],ts:ts(now-day-7100000)},
    {role:'user',text:'Draft the reorder.',ts:ts(now-600000)},{role:'assistant',blocks:[{t:'text',text:'The reorder is drafted and waiting for you.'}],ts:ts(now-540000)},
    {role:'user',text:'A message with no time yet.'},
   ]);
   await openChat(id);await pause(200);
   const r=await page.evaluate(()=>{const m=document.getElementById('msgs'),divs=[...m.querySelectorAll('.day-divider')],rows=[...m.querySelectorAll('[data-ts]')],asst=m.querySelector('.m-asst[data-time]'),user=m.querySelector('.m-user[data-time]');
    return {labels:divs.map(d=>d.getAttribute('aria-label')),firstIsDivider:m.firstElementChild?.classList.contains('day-divider'),times:rows.map(e=>e.dataset.time||null),
     noTime:[...m.querySelectorAll('.m-user:not([data-ts])')].map(e=>e.hasAttribute('data-time')),asstBefore:getComputedStyle(asst,'::before').content,userAfter:getComputedStyle(user,'::after').content,
     asstText:asst.textContent,asstColor:getComputedStyle(asst,'::before').color,userColor:getComputedStyle(user,'::after').color,userBg:getComputedStyle(user).backgroundColor};});
   assert.equal(r.labels.length,3,'one divider per day '+JSON.stringify(r.labels));assert.deepEqual(r.labels.slice(1),['Yesterday','Today']);
   assert.match(r.labels[0],/^([A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}|[A-Z][a-z]{2} \d{1,2}, \d{4})$/,'an older day is named by date');
   assert.ok(r.firstIsDivider,'the conversation opens with the first day');
   assert.equal(r.times.length,6);
   r.times.slice(4).forEach(t=>assert.match(t,/^\d{1,2}:\d{2} [AP]M$/,'today: time only'));
   r.times.slice(2,4).forEach(t=>assert.match(t,/^Yesterday \d{1,2}:\d{2} [AP]M$/,'yesterday is named'));
   r.times.slice(0,2).forEach(t=>assert.match(t,/^[A-Z][a-z]{2} \d{1,2}(, \d{4})?, \d{1,2}:\d{2} [AP]M$/,'older days carry the date'));
   assert.deepEqual(r.noTime,[false],'a message without a transcript time shows none');
   assert.equal(r.asstBefore,'"'+r.times[1]+'"');assert.equal(r.userAfter,'"'+r.times[0]+'"');
   assert.ok(!r.asstText.includes(r.times[1]),'the time is not part of the copied text');
   // Find never matches a time; the live stream adds a divider only when the day changes.
   await clickControl(page,'#findb');await page.type('#fq',r.times[1]);await pause(100);
   assert.equal(await page.$eval('#fcount',e=>e.textContent.trim()),'none','a time is not findable text');await clickControl(page,'#fclose');
   const live=await page.evaluate(()=>{const m=document.getElementById('msgs'),n=m.querySelectorAll('.day-divider').length;
    appendDayDivider(m,new Date().toISOString());const same=m.querySelectorAll('.day-divider').length;
    appendDayDivider(m,new Date(Date.now()+86400000).toISOString());return {same:same-n,next:m.querySelectorAll('.day-divider').length-same,last:m.lastElementChild.classList.contains('day-divider')};});
   assert.deepEqual(live,{same:0,next:1,last:true});
   await page.evaluate(()=>document.querySelector('#msgs .day-divider:last-child')?.remove());
   await scan('message-times-mobile');await page.screenshot({path:path.join(out,'message-times-mobile.png')});
   await page.setViewport({width:1440,height:900});await pause(200);await page.screenshot({path:path.join(out,'message-times-desktop.png')});await page.setViewport({width:390,height:844});
   await page.evaluate(()=>settingsSheet());await page.waitForSelector('#s-times');
   assert.equal(await page.$eval('#s-times',b=>b.getAttribute('aria-pressed')),'true');
   await clickControl(page,'#s-times');await pause(100);
   const off=await page.evaluate(()=>{const m=document.getElementById('msgs');return {cls:m.classList.contains('times-off'),div:getComputedStyle(m.querySelector('.day-divider')).display,t:getComputedStyle(m.querySelector('.m-asst[data-time]'),'::before').display,pressed:document.querySelector('#s-times').getAttribute('aria-pressed'),stored:readLocal('pc-times',true)};});
   assert.deepEqual(off,{cls:true,div:'none',t:'none',pressed:'false',stored:false});
   await clickControl(page,'#s-times');await pause(100);
   assert.equal(await page.$eval('#msgs',m=>m.classList.contains('times-off')),false);
   await page.keyboard.press('Escape');await pause(200);
  });
  await check('1.22 Search inside conversations: results under the box, marked words, related rows, open at the match',async()=>{
   await page.setViewport({width:390,height:844});
   conversations.set(rows[3].id,[{role:'user',text:'How is stock?'},{role:'assistant',blocks:[{t:'text',text:'Incoming stock is separate from the on-hand count for each recorder.'}]}]);
   await page.goto(base+'/#/');await page.waitForSelector('[data-session-search]');
   const before=(getMode().searchCalls||[]).length;
   await page.type('[data-session-search]','in');await pause(700);
   assert.equal(await page.$('.convo-group'),null,'two characters do not search inside conversations');
   assert.equal((getMode().searchCalls||[]).length,before);
   await page.type('[data-session-search]','coming stock');
   await page.waitForSelector('.convo-group .convo-item');
   assert.equal((getMode().searchCalls||[]).length,before+1,'one request after typing settles');
   assert.equal(getMode().searchCalls.at(-1),'incoming stock');
   const g=await page.$eval('.convo-group',e=>({h:e.querySelector('h2').textContent,note:e.querySelector('.convo-note').textContent,
     rows:[...e.querySelectorAll('.convo-item')].map(r=>({who:r.querySelector('.convo-who').textContent,marks:[...r.querySelectorAll('mark')].map(m=>m.textContent)}))}));
   assert.equal(g.h,'In conversations2');assert.match(g.note,/MemStem/);
   assert.equal(await page.$eval('[data-session-results]',e=>e.textContent.trim()),'No session titles match. Matches inside conversations are below.');
   assert.deepEqual(g.rows,[{who:'Claude:',marks:['Incoming','stock']},{who:'Related:',marks:[]}]);
   await scan('convo-search-mobile');await page.screenshot({path:path.join(out,'convo-search-mobile.png')});
   await clickControl(page,`.convo-item [data-convo-id="${rows[3].id}"]`);
   await page.waitForFunction(id=>chatId===id&&!document.querySelector('#findbar').hidden&&document.querySelector('#fq').value,{},rows[3].id);
   const find=await page.evaluate(()=>({q:document.querySelector('#fq').value,marks:fmarks.length}));
   assert.ok(find.marks>0,'Find lands on the match: '+JSON.stringify(find));assert.match(find.q,/incoming stock|incoming|stock/i);
   assert.equal(await page.$('#away-divider'),null,'a search result opens at the match, not at New since');
   await page.keyboard.press('Escape');
   // A failure says so and offers a retry; clearing the box removes the section.
   setMode({searchFail:true});
   await page.goto(base+'/#/');await page.waitForSelector('[data-session-search]');
   await page.type('[data-session-search]','recorder');await page.waitForSelector('[data-convo-retry]');
   setMode({searchFail:false});await clickControl(page,'[data-convo-retry]');await page.waitForSelector('.convo-group .convo-item');
   await page.$eval('[data-session-search]',e=>{e.value='';e.dispatchEvent(new Event('input'));});
   assert.equal(await page.$('.convo-group'),null);
   await page.evaluate(()=>{sessionQuery='';});
  });
  await check('1.23 Saved prompts: save what is on screen, start from a chip or Recent, manage, delete',async()=>{
   await page.setViewport({width:390,height:844});
   await page.evaluate(()=>{clearDraft(NEW_KEY);localStorage.removeItem('pc-lastproj');localStorage.setItem('pc-provider','claude');localStorage.removeItem('pc-recent-open');});
   await page.goto(base+'/#/new');await page.waitForSelector('#plist .row.sel');await page.waitForSelector('#starters .recent-starts');
   assert.equal(await page.$('.starter-chips'),null,'no saved prompts yet');
   assert.equal(await page.$eval('#save-prompt',e=>e.disabled),true,'nothing to save until there is a task');
   // Save as prompt from what is on screen (warehouse workspace, Claude, Full access).
   await page.$eval('#first',e=>{e.value='';});await page.type('#first','Check stock levels and draft the reorder list');
   await page.evaluate(()=>{tb.prefs.approvalMode='full';});
   assert.equal(await page.$eval('#save-prompt',e=>e.disabled),false);
   await clickControl(page,'#save-prompt');await page.waitForSelector('#pr-name');
   assert.equal(await page.$eval('#pr-name',e=>e.value),'Check stock levels and draft the');
   assert.match(await page.$eval('.prompt-summary',e=>e.textContent),/^warehouse · Claude Code/);
   await scan('save-prompt-sheet-mobile');
   await page.$eval('#pr-name',e=>{e.value='';});await page.type('#pr-name','Stock check');await clickControl(page,'#pr-save');
   await page.waitForSelector('.starter[aria-pressed="true"]');
   const saved=getMode().prompts.prompts[0];
   assert.deepEqual([saved.name,saved.text,saved.cwd,saved.provider],['Stock check','Check stock levels and draft the reorder list','/workspaces/warehouse','claude']);
   // Change everything, then the chip puts it back.
   await clickControl(page,'#apick [data-a="codex"]');await page.$eval('#first',e=>{e.value='Something else';e.dispatchEvent(new Event('input'));});
   assert.equal(await page.$eval('.starter',e=>e.getAttribute('aria-pressed')),'false','editing the text lets go of the chip');
   await clickControl(page,'.starter');
   const form=await page.evaluate(()=>({text:document.getElementById('first').value,agent:document.querySelector('#apick .row.sel')?.dataset.a,ws:document.querySelector('#plist .row.sel')?.dataset.p,ctx:document.getElementById('task-context').textContent}));
   assert.deepEqual(form,{text:'Check stock levels and draft the reorder list',agent:'claude',ws:'/workspaces/warehouse',ctx:'Workspace warehouseAgent Claude CodePermissions Full access'});
   await scan('saved-prompts-mobile');await page.screenshot({path:path.join(out,'saved-prompts-mobile.png')});
   // Recent fills from a start made on another device (Codex, products).
   await clickControl(page,'#starters .recent-starts > summary');await clickControl(page,'[data-recent="0"]');
   assert.deepEqual(await page.evaluate(()=>[document.getElementById('first').value,document.querySelector('#apick .row.sel')?.dataset.a,document.querySelector('#plist .row.sel')?.dataset.p]),
     ['Check incoming quantities before ordering','codex','/workspaces/products']);
   // Manage: a second prompt, reorder, rename through Edit, delete with a second tap.
   await clickControl(page,'#save-prompt');await page.waitForSelector('#pr-name');await page.$eval('#pr-name',e=>{e.value='';});await page.type('#pr-name','Incoming check');await clickControl(page,'#pr-save');
   await page.waitForFunction(()=>document.querySelectorAll('.starter').length===2);
   await clickControl(page,'#manage-prompts');await page.waitForSelector('.prompt-row');
   await scan('manage-prompts-mobile');await page.screenshot({path:path.join(out,'manage-prompts-mobile.png')});
   const second=getMode().prompts.prompts[1].id;
   await clickControl(page,`[data-up="${second}"]`);await page.waitForFunction(()=>document.querySelector('.prompt-row-name').textContent==='Incoming check');
   assert.deepEqual(await page.$$eval('.starter',e=>e.map(x=>x.textContent)),['Incoming check','Stock check'],'the chips follow the order');
   await clickControl(page,`[data-del="${second}"]`);assert.equal(await page.$eval(`[data-del="${second}"]`,e=>e.textContent),'Delete for good');
   assert.equal(getMode().prompts.prompts.length,2,'one tap does not delete');
   await clickControl(page,`[data-del="${second}"]`);await page.waitForFunction(()=>document.querySelectorAll('.prompt-row').length===1);
   const first=getMode().prompts.prompts[0].id;await clickControl(page,`[data-edit="${first}"]`);await page.waitForSelector('#pr-name');
   await page.$eval('#pr-name',e=>{e.value='';});await page.type('#pr-name','Morning stock check');await clickControl(page,'#pr-save');
   await page.waitForFunction(()=>document.querySelector('.starter')?.textContent==='Morning stock check');
   assert.equal(getMode().prompts.prompts[0].text,'Check stock levels and draft the reorder list','renaming keeps the wording');
   await page.$eval('#first',e=>{e.value='';e.dispatchEvent(new Event('input'));});await page.evaluate(()=>clearDraft(NEW_KEY));
  });
  await scan('chat-desktop');await page.setViewport({width:390,height:844});await scan('chat-mobile');
  await page.evaluate(()=>settingsSheet());await scan('settings-mobile');
  assert.deepEqual(errors,[]);

  await check('Projects (1.29): off by default, then the list, card, steps, reminders, finish and resume, tracking from a session, tabs, split pane, rail switch, settings and the phone',async()=>{
   await page.setViewport({width:1440,height:900});const sleep=ms=>new Promise(r=>setTimeout(r,ms));
   const settings=settingsState();settings.projects=false;
   await page.goto(base+'/#/projects');await page.waitForSelector('#projects-main');
   await page.waitForFunction(()=>/Projects is off/.test(document.querySelector('#projects-main')?.textContent||''));
   assert.equal(await page.$('.rail-switch'),null,'no rail switch while the feature is off');
   await openChat(rows[4].id);await clickControl(page,'#chatmore');await page.waitForSelector('.sheet');
   assert.equal(await page.$('#so-project'),null,'session options offer no project while it is off');await page.keyboard.press('Escape');
   assert.equal(await page.$eval('#project-open',e=>e.hidden),true,'no Project control while it is off');
   settings.projects=true;
   await page.evaluate(()=>fetch('/api/board/reset',{method:'POST'}));
   await page.goto(base+'/#/projects');await page.waitForSelector('.project-item');
   const list=await page.evaluate(()=>({groups:[...document.querySelectorAll('.project-group h2')].map(h=>h.textContent.replace(/\s+/g,' ').trim()),done:document.querySelector('details.project-group')?.open,chip:document.querySelector('[data-view-link]')?.textContent,tab:document.querySelector('.open-session.current a')?.textContent,badge:document.querySelector('[data-projects-badge]')?.textContent,switchOn:document.querySelector('[data-rail-view="projects"]')?.getAttribute('aria-pressed'),first:document.querySelector('.project-item .title')?.textContent}));
   assert.deepEqual(list.groups,['Active 2','Waiting 1','Done 1']);assert.equal(list.done,false,'finished projects start collapsed');
   assert.equal(list.chip,'Scheduled · 1 due');assert.equal(list.tab,'Projects','the list is a tab like a session');assert.equal(list.badge,'1','due count on the rail switch');assert.equal(list.switchOn,'false');
   assert.equal(list.first,'Warehouse stock report','the project with a due reminder comes first');
   await scan('projects-list-desktop');await page.screenshot({path:path.join(out,'projects-list-desktop.png')});
   // The card: steps, a reminder on a step that ends with the step, a new step, a reminder for the project, finish and resume.
   await clickControl(page,'.project-item a[data-project]');await page.waitForSelector('.project-card');
   const card=async()=>page.evaluate(()=>({title:document.querySelector('#ptitle').textContent,tag:document.querySelector('#ptag').textContent,status:document.querySelector('.project-status').textContent,steps:[...document.querySelectorAll('.task-row')].map(r=>[r.querySelector('.task-label span').textContent,r.classList.contains('completed'),r.querySelector('.task-meta')?.textContent||'']),reminders:[...document.querySelectorAll('.reminder-title')].map(e=>e.textContent),sessions:[...document.querySelectorAll('.linked-session .title')].map(e=>e.textContent.trim()),marks:[...document.querySelectorAll('.linked-session .tab-state')].map(e=>e.className),history:Number(document.querySelector('.project-history .summary-meta').textContent),actions:[...document.querySelectorAll('.project-actions .chip')].map(b=>b.textContent),tab:document.querySelector('.open-session.current a')?.textContent}));
   let c=await card();
   assert.equal(c.title,'Warehouse stock report');assert.match(c.tag,/^Active · \/workspaces\/warehouse$/);assert.equal(c.status,'Active');
   assert.deepEqual(c.steps.map(x=>x[1]),[true,false]);assert.match(c.steps[1][2],/^Due /,'the open step carries its due reminder');
   assert.deepEqual(c.reminders,['Recount aisle 4 excluding Friday delivery']);assert.deepEqual(c.sessions,[rows[0].title]);assert.match(c.marks[0],/ember/,'the linked session shows its live status');
   assert.equal(c.tab,'Warehouse stock report','the card is a tab');
   await scan('project-card-desktop');await page.screenshot({path:path.join(out,'project-card-desktop.png')});
   const before=c.history;
   await clickControl(page,'.task-row:not(.completed) input[data-task]');await page.waitForFunction(()=>document.querySelectorAll('.task-row.completed').length===2);
   c=await card();assert.deepEqual(c.reminders,[],'finishing the step stops its reminder');assert.equal(c.history,before+1);
   await page.type('[data-task-add] input','Post the inventory adjustment');await page.keyboard.press('Enter');
   await page.waitForFunction(()=>document.querySelectorAll('.task-row').length===3);c=await card();assert.deepEqual(c.steps[2],['Post the inventory adjustment',false,'']);
   await clickControl(page,'[data-remind]');await page.waitForSelector('.sheet [data-pick="tomorrow"]');
   const picks=await page.$$eval('.sheet [data-pick]',els=>els.map(e=>e.textContent.replace(/\s+/g,' ').trim()));assert.equal(picks.length,4);assert.match(picks[0],/^Tomorrow morning/);
   await clickControl(page,'.sheet [data-pick="tomorrow"]');await page.waitForFunction(()=>document.querySelectorAll('.reminder-title').length===1);
   c=await card();assert.deepEqual(c.reminders,['Revisit Warehouse stock report']);
   await clickControl(page,'[data-finish]');await page.waitForSelector('.sheet [data-yes]');await clickControl(page,'.sheet [data-yes]');
   await page.waitForFunction(()=>document.querySelector('.project-status')?.textContent==='Done');
   c=await card();assert.deepEqual(c.reminders,[],'finishing stops the reminders');assert.deepEqual(c.actions,['Resume project']);assert.equal(await page.$('[data-task-add]'),null,'a finished card takes no new steps');
   await clickControl(page,'[data-resume]');await page.waitForFunction(()=>document.querySelector('.project-status')?.textContent==='Active');
   c=await card();assert.deepEqual(c.reminders,[],'resuming does not restore them');assert.deepEqual(c.actions,['Edit','Remind me','Finish project']);
   // Track a project from a session: the editor takes the session's workspace, the card links the session.
   await openChat(rows[4].id);await page.waitForFunction(()=>document.querySelector('#project-open')?.hidden===false);
   assert.equal(await page.$eval('#project-open',e=>e.textContent),'Add to project','the conversation offers Add to project');
   await clickControl(page,'#project-open');await page.waitForSelector('.sheet [data-v="__new"]');await page.keyboard.press('Escape');
   await clickControl(page,'#chatmore');await page.waitForSelector('#so-project');await clickControl(page,'#so-project');
   await page.waitForSelector('.sheet [data-v="__new"]');
   const choices=await page.$$eval('.sheet .opt',els=>els.map(e=>e.dataset.v));assert.deepEqual(choices.slice(0,1),['__new']);assert.ok(choices.length>=3,'open projects are offered');
   await clickControl(page,'.sheet [data-v="__new"]');await page.waitForSelector('.project-editor');
   assert.equal(await page.$eval('.project-editor [name=directory]',e=>e.value),rows[4].cwd);
   await page.type('.project-editor [name=name]','Purchasing review');await clickControl(page,'.project-editor .primary');
   await page.waitForFunction(()=>location.hash==='#/projects/purchasing-review'&&document.querySelector('.project-card'));
   c=await card();assert.equal(c.title,'Purchasing review');assert.deepEqual(c.sessions,[rows[4].title]);
   await openChat(rows[4].id);await page.waitForFunction(()=>document.querySelector('#project-open')?.textContent==='Purchasing review');
   await clickControl(page,'#project-open');await page.waitForFunction(()=>location.hash==='#/projects/purchasing-review');await page.waitForSelector('.project-card');assert.match(c.tag,new RegExp(rows[4].cwd.replace(/[/]/g,'\\/')+'$'));
   // Tabs: project tabs sit beside sessions; closing the current one moves to its neighbour; Alt ] cycles through them.
   let tabs=await page.$$eval('#open-sessions .open-session a',els=>els.map(e=>e.textContent));
   assert.ok(tabs.includes('Projects')&&tabs.includes('Warehouse stock report')&&tabs.includes('Purchasing review'),'project tabs: '+tabs.join(' | '));
   await page.keyboard.down('Alt');await page.keyboard.press(']');await page.keyboard.up('Alt');await sleep(300);
   assert.notEqual(await page.evaluate(()=>location.hash),'#/projects/purchasing-review','Alt ] moved to another tab');
   await page.goto(base+'/#/projects/purchasing-review');await page.waitForSelector('.project-card');
   await clickControl(page,'[data-close-session="projects/purchasing-review"]');await page.waitForFunction(()=>location.hash!=='#/projects/purchasing-review'&&!document.querySelector('[data-close-session="projects/purchasing-review"]'));
   tabs=await page.$$eval('#open-sessions .open-session a',els=>els.map(e=>e.textContent));assert.ok(!tabs.includes('Purchasing review'));
   // Split: a project view beside a conversation; the pane is a full Pocket instance on that route.
   await openChat(rows[4].id);await clickControl(page,'#splitb');await page.waitForSelector('.sheet [data-v="projects/scheduled"]');
   await clickControl(page,'.sheet [data-v="projects/scheduled"]');await page.waitForSelector('#panes iframe');
   const pane=await page.$eval('#panes iframe',f=>({src:f.getAttribute('src'),title:f.title}));assert.match(pane.src,/#\/projects\/scheduled$/);assert.equal(pane.title,'Session beside: Scheduled');
   const frame=page.frames().find(f=>f.url().includes('#/projects/scheduled'));await frame.waitForSelector('.reminder-item');
   assert.equal(await frame.$eval('#ptitle',e=>e.textContent),'Scheduled');
   await scan('projects-split-desktop');await page.screenshot({path:path.join(out,'projects-split-desktop.png')});
   await frame.click('#pane-close');await page.waitForFunction(()=>!document.querySelector('#panes iframe'));
   // The rail switch: project rows in the rail open as a tab, or beside when this browser says so.
   await clickControl(page,'[data-rail-view="projects"]');await page.waitForSelector('#rail .rail-projects .project-item');
   assert.equal(await page.$eval('#rail-filter-toggle',e=>e.hidden),true,'session filters hide with the project list');
   await clickControl(page,'#rail .project-item a[data-project]');await page.waitForFunction(()=>location.hash.startsWith('#/projects/')&&document.querySelector('.project-card'));
   await page.evaluate(()=>localStorage.setItem('pc-projects-open',JSON.stringify('beside')));
   await openChat(rows[4].id);await page.waitForSelector('#rail .rail-projects .project-item');
   await clickControl(page,'#rail .project-item a[data-project]');await page.waitForSelector('#panes iframe');
   assert.match(await page.$eval('#panes iframe',f=>f.getAttribute('src')),/#\/projects\//,'beside: the card opens in a pane');
   await page.evaluate(()=>localStorage.setItem('pc-projects-open',JSON.stringify('tab')));
   await page.evaluate(()=>{document.querySelector('#panes iframe')&&closePane(splitPanes[0].key);});
   // Settings → Projects & documents turns the feature off and on for the whole install.
   await clickControl(page,'#railsettings');await page.waitForFunction(()=>document.querySelector('#s-projects')?.disabled===false);
   assert.equal(await page.$eval('#s-projects',e=>e.getAttribute('aria-pressed')),'true');
   await clickControl(page,'#s-projects');for(let i=0;i<30&&settings.projects;i++)await sleep(100);
   assert.equal(settings.projects,false,'the server setting changed');
   await page.goto(base+'/#/');await page.waitForSelector('.session-home');assert.equal(await page.$('[data-projects-home]'),null,'the home chip is gone while off');
   settings.projects=true;await clickControl(page,'[data-rail-view="sessions"]').catch(()=>{});
   // Phone: full-screen views, the home chip, no overflow.
   await page.setViewport({width:390,height:844});
   await page.evaluate(()=>fetch('/api/board/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'remind',project:'camera-ordering-review',at:new Date(Date.now()-60000).toISOString(),text:'Chase the revised quote'})})); // one due reminder for the badge
   await page.goto(base+'/?phone=1#/');await page.waitForSelector('[data-projects-home]'); // a fresh load picks up the restored setting
   await page.waitForFunction(()=>document.querySelector('[data-projects-home]')?.textContent==='Projects · 1 due');
   for(const [hash,sel] of [['#/projects','.project-item'],['#/projects/warehouse-stock-report','.project-card'],['#/projects/scheduled','.reminder-item']]){
    await page.goto(base+'/'+hash);await page.waitForSelector(sel);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow at 390: '+hash);
    assert.equal(await page.evaluate(()=>Boolean(document.querySelector('aside.rail')?.getClientRects().length)),false,'the rail is not shown on the phone');
   }
   await page.goto(base+'/#/projects/warehouse-stock-report');await page.waitForSelector('.project-card');
   await scan('project-card-phone');await page.screenshot({path:path.join(out,'project-card-phone.png')});
   await page.setViewport({width:1440,height:900});
  });

  await check('Documents (1.30): off by default, then the library, a sandboxed HTML document, Markdown and CSV views, sharing, keep from Results, the project section, tabs, split, rail, settings and the phone',async()=>{
   await page.setViewport({width:1440,height:900});const sleep=ms=>new Promise(r=>setTimeout(r,ms));
   const settings=settingsState();settings.documents=false;settings.projects=true;
   await page.evaluate(()=>fetch('/api/board/reset',{method:'POST'}));
   await page.goto(base+'/#/documents');await page.waitForFunction(()=>/Files is off/.test(document.querySelector('#documents-main')?.textContent||''));
   assert.equal(await page.$('[data-rail-view="documents"]'),null,'no Files segment while off');
   settings.documents=true;await page.evaluate(()=>fetch('/api/documents/reset',{method:'POST'}));
   await page.evaluate(()=>localStorage.setItem('pc-documents-layout','"list"')); // 1.32: the wide default is the grid; these checks read the rows
   await page.goto(base+'/?docs=1#/documents');await page.waitForSelector('.document-item');
   const lib=await page.evaluate(()=>({rows:[...document.querySelectorAll('.document-item .title')].map(e=>e.textContent.trim()),kinds:[...document.querySelectorAll('.document-item .doc-kind')].map(e=>e.textContent),tab:document.querySelector('.open-session.current a')?.textContent,seg:document.querySelector('[data-rail-view="documents"]')?.textContent,where:document.querySelector('.document-item .meta')?.textContent}));
   assert.deepEqual(lib.kinds.sort(),['CSV','HTML','MD']);assert.equal(lib.tab,'Files','the library is a tab');assert.equal(lib.seg,'Files');
   await scan('documents-list-desktop');await page.screenshot({path:path.join(out,'documents-list-desktop.png')});
   // Search narrows the list without losing the keyboard.
   await page.type('#doc-query','weekly');await page.waitForFunction(()=>document.querySelectorAll('.document-item').length===1);assert.equal(await page.evaluate(()=>document.activeElement.id),'doc-query');
   await page.evaluate(()=>{document.querySelector('#doc-query').value='';});await page.evaluate(()=>{docQuery='';});
   // 1.31: visibility and kind filters, badges, the grouped options sheet, the share address of a private document, a solo window.
   await page.goto(base+'/#/documents');await page.waitForSelector('.document-item');
   assert.deepEqual(await page.$$eval('.doc-filters [data-vis]',els=>els.map(e=>e.textContent.replace(/\s+/g,' ').trim())),['All 3','Private 3','Link 0','Public 0']);
   assert.deepEqual(await page.$$eval('.document-item .doc-vis',els=>els.map(e=>e.textContent)),['Private','Private','Private']);
   await page.select('#doc-kind','text');await page.waitForFunction(()=>document.querySelectorAll('.document-item').length===1);
   assert.match(await page.$eval('.document-group h2',e=>e.textContent.replace(/\s+/g,' ')),/^Markdown and text 1 of 3$/);
   await clickControl(page,'#doc-clear');await page.waitForFunction(()=>document.querySelectorAll('.document-item').length===3);
   await clickControl(page,'.document-item [data-document-more]');await page.waitForSelector('.sheet [data-window]');
   assert.equal(await page.$('.sheet [data-copy-link]'),null,'no Copy link while private');
   assert.equal(await page.$eval('.sheet a.opt',e=>getComputedStyle(e).textDecorationLine),'none','a link row is styled like the other rows');
   assert.deepEqual(await page.$$eval('.sheet .opt-group',els=>els.map(e=>e.getAttribute('aria-label'))),['Open','Share','Organize']);
   await clickControl(page,'.sheet [data-share]');await page.waitForSelector('.share-sheet #share-url');
   assert.match(await page.$eval('#share-url',e=>e.value),/\/#\/documents\/[0-9a-f]{12}$/,'a private document shows its in-app address');
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.scrim'));
   const soloId=await page.evaluate(()=>docsSnap.documents.find(d=>d.kind==='md').id);
   await page.goto(base+'/?solo=1#/documents/'+soloId);await page.waitForSelector('.doc-md');
   assert.equal(await page.$('aside.rail'),null,'a solo window has no rail');assert.equal(await page.$('#open-sessions'),null,'nor a tab strip');
   assert.equal(await page.$('#back'),null);assert.equal(await page.$('#dwin'),null);assert.equal(await page.title(),'Weekly summary · Pocket Code');
   await page.goto(base+'/?solo=1#/projects/warehouse-stock-report');await page.waitForSelector('.project-card');
   assert.equal(await page.$('aside.rail'),null);assert.equal(await page.$('#pwin'),null);assert.equal(await page.title(),'Warehouse stock report · Pocket Code');
   // 1.32: the grid of previews on a wide screen: a picture for the HTML report, the kind for the CSV, the choice remembered.
   await page.evaluate(()=>localStorage.removeItem('pc-documents-layout'));
   await page.goto(base+'/#/documents');await page.waitForSelector('.doc-card');
   assert.equal(await page.$eval('.doc-layout [data-layout="grid"]',e=>e.getAttribute('aria-pressed')),'true','the grid is the wide default');
   await page.waitForFunction(()=>document.querySelector('.doc-thumb.loaded img'));
   const cards=await page.$$eval('.doc-card',els=>els.map(c=>({kind:c.querySelector('.doc-kind').textContent,pic:Boolean(c.querySelector('.doc-thumb.loaded img')),title:c.querySelector('.doc-card-title').textContent})));
   assert.ok(cards.find(c=>c.kind==='HTML')?.pic,'the HTML report has a picture: '+JSON.stringify(cards));assert.equal(cards.find(c=>c.kind==='CSV')?.pic,false,'the CSV shows its kind');
   assert.equal(await page.$eval('.doc-card img',e=>e.getAttribute('loading')),'lazy');
   await scan('documents-grid-desktop');await page.screenshot({path:path.join(out,'documents-grid-desktop.png')});
   await clickControl(page,'.doc-card [data-document-more]');await page.waitForSelector('.sheet [data-window]');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.scrim'));
   await clickControl(page,'.doc-layout [data-layout="list"]');await page.waitForSelector('.document-item');assert.equal(await page.$('.doc-card'),null);
   await page.goto(base+'/#/documents');await page.waitForSelector('.document-item');assert.equal(await page.$('.doc-card'),null,'the list choice is remembered');
   // The HTML document renders in a sandboxed frame that cannot reach the app.
   await page.goto(base+'/#/documents');await page.waitForSelector('.document-item');
   const htmlRow=await page.$eval('.document-item .doc-kind',()=>null,[]).catch(()=>null);
   await page.evaluate(()=>{const a=[...document.querySelectorAll('.document-item')].find(r=>r.querySelector('.doc-kind').textContent==='HTML').querySelector('a');a.click();});
   await page.waitForSelector('iframe.doc-frame');
   const frame=await (await page.$('iframe.doc-frame')).contentFrame();await frame.waitForFunction(()=>/Sandboxed|isolated|REACHED/.test(document.getElementById('probe')?.textContent||''));
   const probe=await frame.$eval('#probe',e=>e.textContent);assert.match(probe,/^Sandboxed: SecurityError|isolated/,'the document\'s script cannot reach Pocket: '+probe);
   assert.equal(await page.$eval('iframe.doc-frame',f=>f.getAttribute('sandbox')),'allow-scripts allow-popups allow-downloads allow-forms');
   const tag=await page.$eval('#dtag',e=>e.textContent);assert.match(tag,/^HTML · /);assert.match(tag,/Private$/);
   const tools=await page.$$eval('.doc-tools .chip',els=>els.map(e=>[e.textContent,e.getAttribute('href')||'',e.getAttribute('download')||'',e.getAttribute('target')||'']));
   assert.equal(tools[0][0],'Open in your viewer');assert.match(tools[0][1],/\/api\/documents\/[0-9a-f]{12}\/raw$/);assert.equal(tools[0][3],'_blank');assert.equal(tools[1][0],'Download');assert.match(tools[1][1],/raw\?download=1$/);assert.equal(tools[1][2],'ops-dashboard.html');
   await scan('document-html-desktop');await page.screenshot({path:path.join(out,'document-html-desktop.png')});
   // Share: private → link (URL shown, copy), expiry, new link, → public, → private revokes. Coming back from a share
   // link restores the page from the back-forward cache with the sheet still open, as a browser would; close it first.
   const back=async()=>{await page.goBack();await page.waitForSelector('.doc-tools');if(await page.$('.scrim')){await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.scrim'));}};
   await clickControl(page,'.doc-tools [data-share]');await page.waitForSelector('.share-sheet');
   await clickControl(page,'.share-sheet [data-v="link"]');await page.waitForSelector('.share-sheet #share-url');
   const shareUrl=await page.$eval('#share-url',e=>e.value);assert.match(shareUrl,new RegExp('^'+base.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/share/[A-Za-z0-9_-]{40,}$'));
   const shared=await page.goto(shareUrl);assert.equal(shared.status(),200);assert.match(shared.headers()['content-security-policy'],/frame-ancestors 'none'/);
   await back();await clickControl(page,'.doc-tools [data-share]');await page.waitForSelector('.share-sheet [data-reshare]');
   await clickControl(page,'.share-sheet [data-reshare]');await page.waitForSelector('.share-sheet #share-url');const shareUrl2=await page.$eval('#share-url',e=>e.value);assert.notEqual(shareUrl2,shareUrl);
   assert.equal((await page.goto(shareUrl)).status(),404,'the old link no longer works');await back();
   await clickControl(page,'.doc-tools [data-share]');await page.waitForSelector('.share-sheet');await clickControl(page,'.share-sheet [data-v="public"]');await page.waitForFunction(()=>/\/files\//.test(document.querySelector('#share-url')?.value||''));
   const pubUrl=await page.$eval('#share-url',e=>e.value);assert.match(pubUrl,/\/files\/ops-dashboard\.html$/);assert.equal((await page.goto(pubUrl)).status(),200);await back();
   await clickControl(page,'.doc-tools [data-share]');await page.waitForSelector('.share-sheet');await clickControl(page,'.share-sheet [data-v="private"]');await page.waitForFunction(()=>!document.querySelector('.share-sheet'));
   assert.equal((await page.goto(pubUrl)).status(),404,'private again');await back();
   // Markdown and CSV render natively.
   await page.goto(base+'/#/documents');await page.waitForSelector('.document-item');
   await page.evaluate(()=>{[...document.querySelectorAll('.document-item')].find(r=>r.querySelector('.doc-kind').textContent==='MD').querySelector('a').click();});
   await page.waitForSelector('.doc-md strong');assert.equal(await page.$eval('.doc-md strong',e=>e.textContent),'reconciled');assert.equal(await page.$eval('#dtitle',e=>e.textContent),'Weekly summary');
   assert.equal(await page.$eval('.doc-tools [data-project]',e=>e.textContent),'Warehouse stock report','the document shows its project');assert.ok(await page.$('.doc-tools a[href^="#/chat/"]'),'and its session');
   await page.goto(base+'/#/documents');await page.waitForSelector('.document-item');
   await page.evaluate(()=>{[...document.querySelectorAll('.document-item')].find(r=>r.querySelector('.doc-kind').textContent==='CSV').querySelector('a').click();});
   await page.waitForSelector('.doc-table tbody tr');assert.deepEqual(await page.$$eval('.doc-table th',els=>els.map(e=>e.textContent)),['Aisle','On hand','Incoming']);
   // Keep as document from a session's Results.
   await openChat(rows[0].id);await clickControl(page,'#results-open');await page.waitForSelector('[data-keep]');
   assert.equal(await page.$eval('[data-keep]',e=>e.textContent),'Keep in Files');
   await clickControl(page,'[data-keep]');await page.waitForFunction(()=>document.querySelector('[data-kept]'));
   assert.equal(await page.$eval('[data-kept]',e=>e.textContent),'Kept · Open');await page.keyboard.press('Escape');
   // The project card lists its documents.
   await page.goto(base+'/#/projects/warehouse-stock-report');await page.waitForSelector('.project-documents .document-item');
   const pdocs=await page.$$eval('.project-documents .document-item .title',els=>els.map(e=>[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim()));assert.ok(pdocs.includes('Weekly summary'),pdocs.join('|'));assert.ok(pdocs.includes('Kept from a session'),pdocs.join('|'));
   // Tabs and split.
   let tabs=await page.$$eval('#open-sessions .open-session a',els=>els.map(e=>e.textContent));assert.ok(tabs.includes('Files')&&tabs.includes('Weekly summary'),tabs.join('|'));
   await openChat(rows[4].id);await page.evaluate(()=>{docsSnap=null;}); // 1.32.1: as on a fresh page, the list is fetched before the chooser opens
   await clickControl(page,'#splitb');await page.waitForSelector('.sheet [data-v^="documents/"]');
   const offered=await page.$$eval('.sheet [data-v^="documents/"]',els=>els.map(e=>e.textContent.replace(/\s+/g,' ').trim()));
   assert.ok(offered.some(t=>/^Weekly summary/.test(t)),'1.31.1: the chooser offers the open document tab: '+offered.join('|'));assert.ok(offered.length>=3,'and the recent documents');
   await clickControl(page,'.sheet [data-v="documents"]');
   await page.waitForSelector('#panes iframe');assert.match(await page.$eval('#panes iframe',f=>f.getAttribute('src')),/#\/documents$/);assert.equal(await page.$eval('#panes iframe',f=>f.title),'Session beside: Files');
   const pane=page.frames().find(f=>f.url().includes('#/documents'));await pane.waitForSelector('.document-item');await pane.click('#pane-close');await page.waitForFunction(()=>!document.querySelector('#panes iframe'));
   // Rail: Docs segment lists documents; the Project control is unaffected.
   await clickControl(page,'[data-rail-view="documents"]');await page.waitForSelector('#rail .rail-documents .document-item');
   assert.equal(await page.$eval('#rail-filter-toggle',e=>e.hidden),true);
   await clickControl(page,'[data-rail-view="sessions"]');await page.waitForSelector('#rail .session-panel');
   // Settings → Projects & documents.
   await clickControl(page,'#railsettings');await page.waitForFunction(()=>document.querySelector('#s-documents')?.disabled===false);
   assert.equal(await page.$eval('#s-documents',e=>e.getAttribute('aria-pressed')),'true');await page.keyboard.press('Escape');
   // Trash and restore from the library.
   await page.goto(base+'/#/documents');await page.waitForSelector('.document-item');
   await clickControl(page,'.document-item [data-document-more]');await page.waitForSelector('.sheet [data-trash]');await clickControl(page,'.sheet [data-trash]');await page.waitForSelector('.sheet [data-yes]');await clickControl(page,'.sheet [data-yes]');
   await page.waitForSelector('details.document-group [data-restore]');await clickControl(page,'details.document-group summary');await clickControl(page,'[data-restore]');await page.waitForFunction(()=>!document.querySelector('[data-restore]'));
   // Phone.
   await page.setViewport({width:390,height:844});
   await page.goto(base+'/?phone=2#/');await page.waitForSelector('a[href="#/documents"].chip');
   for(const [hash,sel] of [['#/documents','.document-item'],['#/documents/'+await page.evaluate(()=>docsSnap?.documents.find(d=>d.kind==='html')?.id||''),'iframe.doc-frame']]){
    if(hash.endsWith('/'))continue;
    await page.goto(base+'/'+hash);await page.waitForSelector(sel);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow at 390: '+hash);
   }
   await scan('document-html-phone');await page.screenshot({path:path.join(out,'document-html-phone.png')});
   await page.setViewport({width:1440,height:900});settings.documents=true;
  });

  fs.writeFileSync(path.join(out,'ui-regressions.json'),JSON.stringify({checks,scans,errors},null,2));
  console.log(JSON.stringify({uiRegressions:checks.length,accessibilityScans:scans.length,ok:true}));
 } catch(e) {
  await page.screenshot({path:path.join(out,'ui-regression-failure.png')});
  fs.writeFileSync(path.join(out,'ui-regressions.json'),JSON.stringify({checks,scans,errors,error:e.message},null,2));throw e;
 } finally {setMode({workerFailed:false,aboutFailed:false});await context.close();}
}
