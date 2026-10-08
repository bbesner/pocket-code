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
   await page.click('#settings');await page.waitForSelector('#s-usage',{timeout:1000});
   assert.ok(await page.$eval('#s-usage',e=>e.getBoundingClientRect().bottom<innerHeight));
   assert.equal(await page.$eval('#s-notes',e=>e.open),false);
   await page.click('#s-chime');assert.equal(await page.$eval('#s-chime',e=>e.getAttribute('aria-pressed')),'false');
   await page.waitForFunction(()=>document.querySelector('#s-push-state').textContent.includes('Unavailable'));
   await page.click('#s-push');await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Notifications unavailable'));
   await page.screenshot({path:path.join(out,'fixed-settings-mobile.png')});
  });
  await check('Failed update check is honest and Retry recovers',async()=>{
   await page.click('#s-about > summary');
   await page.waitForFunction(()=>document.querySelector('#s-version-state').textContent.includes('Could not check'));
   assert.equal(await page.$eval('#s-refresh',e=>e.hidden),true);
   setMode({aboutFailed:false});await page.click('#s-check');
   await page.waitForFunction(()=>document.querySelector('#s-version-state').textContent==='Up to date');
   await page.click('#s-about > summary');
  });
  await check('Bugs & feature requests links open the GitHub issue forms with the version filled in',async()=>{
   assert.equal(await page.$eval('#s-feedback',e=>e.open),false);
   await page.click('#s-feedback > summary');
   const bug=await page.$eval('#s-report-bug',e=>({href:e.href,target:e.target,rel:e.rel}));
   assert.match(bug.href,/^https:\/\/github\.com\/bbesner\/pocket-code\/issues\/new\?template=bug_report\.yml&version=/);
   assert.match(decodeURIComponent(bug.href),/build \d+/);
   assert.equal(bug.target,'_blank');assert.ok(bug.rel.includes('noopener'));
   assert.match(await page.$eval('#s-request-feature',e=>e.href),/template=feature_request\.yml&version=/);
   await page.$eval('#s-feedback',e=>e.scrollIntoView({block:'end'}));await page.screenshot({path:path.join(out,'fixed-settings-feedback.png')});
   await page.click('#s-feedback > summary');
  });
  await check('Nested usage sheet returns focus to the Settings opener',async()=>{
   await page.click('#s-usage');await page.waitForSelector('#usage-body');await page.keyboard.press('Escape');
   assert.equal(await page.evaluate(()=>document.activeElement.id),'settings');
  });
  await check('Settings disclosures remain keyboard reachable and focus stays trapped',async()=>{
   await page.click('#settings');await page.waitForSelector('#s-sync:not(:disabled)');
   await page.focus('.sheet-close');const focused=new Set();
   for(let i=0;i<24;i++){
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
   await page.click('[data-more-filters] > summary');
   await page.select('[data-provider-filter]','codex');
   await page.click('[data-more-filters] > summary');
   assert.match(await page.$eval('[data-filter-summary]',e=>e.textContent),/Codex/);
   await page.reload();await page.waitForSelector('[data-more-filters]');
   assert.equal(await page.$eval('[data-more-filters]',e=>e.open),false);
   await page.click('[data-clear-more-filters]');
   assert.equal(await page.$eval('[data-filter-summary]',e=>e.textContent),'');
   await page.click('[data-more-filters] > summary');await pause(30);await page.reload();
   await page.waitForSelector('[data-more-filters]');assert.equal(await page.$eval('[data-more-filters]',e=>e.open),true);
   await page.click('[data-more-filters] > summary');
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
   await page.click('#choose-workspace');await page.focus('[data-a=claude]');await page.keyboard.press('ArrowDown');
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
   await page.click('#chatmore');assert.match(await page.$eval('#so-close',e=>e.textContent),/Close session process/);
   await page.keyboard.press('Escape');
  });
  await check('Session menu names itself, shows the title as the conversation, and opens the version in one tap',async()=>{
   const release=JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname),'../public/release.json'),'utf8'));
   const vp=page.viewport();await page.setViewport({width:390,height:844});
   const settled=()=>page.waitForFunction(()=>document.getAnimations().every(a=>a.playState!=='running'));
   await page.click('#chatmore');await settled();
   assert.equal(await page.$eval('#sheet-title',e=>e.textContent),'Session options');
   assert.equal(await page.$eval('.sheet-name',e=>e.textContent),rows[4].title);
   await page.waitForFunction(v=>document.querySelector('#so-version-sub')?.textContent.includes(v),{},release.version);
   assert.equal(await page.$eval('#so-version-sub',e=>e.textContent),`Pocket Code ${release.version} · build ${release.assetV}`);
   await page.screenshot({path:path.join(out,'session-menu-version.png')});
   await page.$eval('#so-version',e=>e.scrollIntoView({block:'end'}));await page.screenshot({path:path.join(out,'session-menu-version-row.png')});
   await page.click('#so-version');await page.waitForSelector('.settings-sheet #s-about[open]');await settled();
   await page.waitForFunction(()=>document.querySelector('#s-about-version')?.textContent);
   assert.equal(await page.$eval('#s-about-version',e=>e.textContent),`${release.version} · build ${release.assetV}`);
   assert.ok(await page.$eval('#s-about',e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.top<innerHeight;}));
   await page.screenshot({path:path.join(out,'settings-about-open.png')});
   await page.keyboard.press('Escape');
   assert.equal(await page.evaluate(()=>document.activeElement.id),'chatmore');
   await page.setViewport(vp);
  });
  await page.click('#splitb');await page.click('[data-v=new]');await page.waitForSelector('#panes iframe');
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
   await page.click('#results-open');await page.waitForSelector('.workspace-dock');await pause(150);
   assert.ok(await page.$eval('.chatcol',e=>e.getBoundingClientRect().width>=379));
   assert.ok(await page.$$eval('.split-pane:not([hidden])',es=>es.every(e=>e.getBoundingClientRect().right<=innerWidth+1)));
   await scan('split-and-dock-desktop');
   await page.screenshot({path:path.join(out,'fixed-split-desktop.png')});
   await page.click('[data-close-dock]');
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
   await page.click('#chatmore');await page.click('#so-close');await page.waitForSelector('#first');
   assert.equal(await page.$eval('#first',e=>e.value),'Beside draft survives resizing.');
  });
  await page.evaluate(()=>{for(const pane of [...splitPanes])closePane(pane.key);localStorage.removeItem('pc-dock-kind');});
  await page.setViewport({width:390,height:844});await chat();
  await check('Toolbar overflow offers working controls and preserves draft',async()=>{
   await page.waitForSelector('.toolbar-next:not([hidden])');
   const before=await page.$eval('#box',e=>e.value);
   await page.click('.toolbar-next');
   assert.ok(await page.$eval('#tbar',e=>e.scrollLeft>0));
   assert.equal(await page.$eval('.toolbar-previous',e=>e.disabled),false);
   await page.click('.toolbar-previous');assert.equal(await page.$eval('#tbar',e=>e.scrollLeft),0);
   await page.click('#composer-toggle');assert.equal(await page.$eval('.toolbar-scroll',e=>e.getClientRects().length),0);
   await page.click('#composer-toggle');
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
   await page.click('#micb');
   await page.waitForFunction(()=>document.querySelector('#micb').getAttribute('aria-pressed')==='true');
   assert.match(await page.$eval('#voice-strip',e=>e.textContent),/Listening/);
   await scan('voice-listening-mobile');
   await page.click('#voice-cancel');
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
   await page.click('#hfb');
   await page.waitForFunction(()=>document.querySelector('#hfb').getAttribute('aria-pressed')==='true');
   assert.equal(await page.$eval('#micb',e=>e.getAttribute('aria-pressed')),'false','the plain mic is not the active control');
   await page.waitForFunction(()=>/Hands-free\. Listening/.test(document.querySelector('#voice-strip').textContent));
   await scan('voice-hands-free-mobile');await page.screenshot({path:path.join(out,'voice-hands-free-mobile.png')});
   await page.click('#voice-cancel');
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
   await page.click('#hfb');
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
   await page.click('.choice-x');
   assert.equal(await page.$eval('.choices',e=>e.hidden),true);
   assert.equal(await page.evaluate(()=>document.activeElement.id),'box','focus moves to the message box');
   await page.reload();await page.waitForSelector('#box');await pause(300);
   assert.equal(await page.$eval('.choices',e=>e.hidden),true,'a dismissal sticks for that reply');
   await page.evaluate(()=>localStorage.removeItem('pc-choices-dismissed'));await page.reload();await page.waitForSelector('#box');
   await page.waitForSelector('.choices:not([hidden])');
   const sent=received.length;await page.click('.choice');
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
   await page.click('#ctx-ring');await page.waitForSelector('.usage-sheet #usage-body .usage-block');
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
   await page.click('#voice-cancel');                                  // stop listening: the instruction waits with buttons
   await page.waitForSelector('#voice-send');
   assert.match(await page.$eval('#voice-strip',e=>e.textContent),/Send this\? “Summarize the queue”/);
   await scan('voice-confirm-mobile');await page.screenshot({path:path.join(out,'voice-confirm-mobile.png')});
   await page.click('#voice-send');
   for(let i=0;i<40&&received.length===sent;i++)await pause(100);
   assert.equal(received.at(-1).text,'Summarize the queue','tapping Send sends it');
   await page.evaluate(()=>Voice.onLeave());await page.reload();await page.waitForSelector('#box');
  });
  await check('Voice: Settings saves preferences and lists voices',async()=>{
   await page.evaluate(()=>settingsSheet());await page.waitForSelector('#s-voice');
   await page.click('#s-voice > summary');
   await page.waitForFunction(()=>document.querySelector('#s-voice-state').textContent.includes('available'));
   assert.deepEqual(await page.$$eval('#s-voice-voice option',o=>o.map(x=>x.value)),['af_heart','bm_george']);
   await page.click('#s-voice-review');
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
   await page.click('#s-voice-review');await page.keyboard.press('Escape');
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
   await page.click('[data-filter="attention"]');await pause(200);
   const listed=()=>page.evaluate(id=>filteredSessions().some(s=>s.id===id)&&[...document.querySelectorAll('.session-item .row')].some(b=>b.dataset.id===id),done.id);
   assert.equal(await listed(),true,'an unopened reply is in Attention');
   assert.match(await page.$eval('[data-filter="attention"]',e=>e.textContent),/Attention\s*\d+/,'counted');
   await page.evaluate(([id,at])=>{localStorage.setItem('pc-seen-'+id,String(at));},[done.id,at]);await page.evaluate(()=>refreshSessions());await pause(300);
   assert.equal(await listed(),false,'leaves Attention once opened');
   await page.click('[data-filter="all"]');done.state=saved;
  });
  await check('Mark reviewed clears Response ready without opening it, singly or all at once with Undo',async()=>{
   const done=rows.find(r=>r.state.kind==='finished')||rows[4];const saved=done.state,at=Date.now();
   done.state={kind:'finished',label:'Response ready',at};
   await page.goto(base+'/#/');await page.waitForSelector('[data-filter="attention"]');
   delete done.seenAt;await page.evaluate(id=>{localStorage.removeItem('pc-seen-'+id);serverSeen.delete(id);seenPending.delete(id);},done.id);await page.evaluate(()=>refreshSessions());await pause(300);
   await page.click('[data-filter="attention"]');await pause(200);
   const listed=()=>page.evaluate(id=>filteredSessions().some(s=>s.id===id),done.id);
   assert.equal(await listed(),true,'starts in Attention');
   await page.click(`[data-more="${done.id}"]`);await page.waitForSelector('#so-reviewed');await page.screenshot({path:path.join(out,'review-option.png')});await page.click('#so-reviewed');await pause(200);
   assert.equal(await listed(),false,'single mark leaves Attention');
   assert.equal(await page.evaluate(()=>location.hash),'#/','did not open the conversation');
   delete done.seenAt;await page.evaluate(id=>{localStorage.removeItem('pc-seen-'+id);serverSeen.delete(id);seenPending.delete(id);},done.id);await page.evaluate(()=>paintSessionPanels());
   await page.waitForSelector('[data-mark-all-reviewed]');await page.screenshot({path:path.join(out,'review-bar.png')});
   await page.click('[data-mark-all-reviewed]');await pause(200);await page.screenshot({path:path.join(out,'review-bar-undo.png')});
   assert.equal(await listed(),false,'bulk mark leaves Attention');
   await pause(400);assert.equal(done.seenAt,at,'saved on the server for other devices');
   await page.click('[data-undo-reviewed]');await pause(400);
   assert.equal(await listed(),true,'Undo brings it back');
   assert.equal(done.seenAt,undefined,'Undo also clears it on the server');
   await page.evaluate(([id,at])=>localStorage.setItem('pc-seen-'+id,String(at)),[done.id,at]);
   await page.click('[data-filter="all"]');done.state=saved;delete done.seenAt;
  });
  await check('A reply reviewed on another device leaves Attention here, and one opened here is shared',async()=>{
   const done=rows.find(r=>r.state.kind==='finished')||rows[4];const saved=done.state,at=Date.now();
   done.state={kind:'finished',label:'Response ready',at};done.seenAt=at;
   await page.goto(base+'/#/');await page.waitForSelector('[data-filter="attention"]');
   await page.evaluate(id=>localStorage.removeItem('pc-seen-'+id),done.id);await page.evaluate(()=>refreshSessions());await pause(300);
   await page.click('[data-filter="attention"]');await pause(200);
   assert.equal(await page.evaluate(id=>filteredSessions().some(s=>s.id===id),done.id),false,'the other device\'s review counts here');
   delete done.seenAt;await page.evaluate(([id,at])=>localStorage.setItem('pc-seen-'+id,String(at)),[done.id,at]);
   await page.evaluate(()=>refreshSessions());await pause(600);
   assert.equal(done.seenAt,at,'a marker saved only in this browser is sent to the server');
   await page.click('[data-filter="all"]');done.state=saved;delete done.seenAt;
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
   await page.click('#agents-open');await page.waitForSelector('.agent-row');await page.click('.agent-row summary');
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
   await page.click('.agents-retry');await page.waitForFunction(()=>document.querySelector('.agents-status').textContent.includes('0 working'));
   await page.setViewport({width:1440,height:900});await scan('subagents-desktop');await page.screenshot({path:path.join(out,'subagents-desktop.png')});
   await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'agents-open');
   await page.reload();await page.waitForSelector('#agents-open:not([hidden])');
   assert.match(await page.$eval('#agents-open',e=>e.textContent),/2 recorded/);
   setMode({agents:[]});await page.evaluate(()=>refreshAgents(chatId));
   assert.equal(await page.$eval('#agents-open',e=>e.hidden),true);
   await page.click('#chatmore');await page.click('#so-agents');await page.waitForFunction(()=>document.querySelector('.agents-status').textContent.includes('No subagents'));
   await page.keyboard.press('Escape');
  });
  await check('Pinned sessions: tabs carry the pin and follow the shared order; grip drag, arrow keys and Session options reorder',async()=>{
   await page.setViewport({width:1440,height:900});
   const a=rows[3].id,b=rows[4].id,clay='rgb(217, 119, 87)';
   await page.goto(base+'/#/chat/'+a);await page.waitForFunction(id=>chatId===id&&document.querySelector('#box'),{},a);
   await page.goto(base+'/#/chat/'+b);await page.waitForFunction(id=>chatId===id&&document.querySelector('#box'),{},b);
   assert.equal(await page.$$eval('#open-sessions .open-session.pinned',es=>es.length),0,'no pins yet');
   await page.click('#chatmore');await page.waitForSelector('#so-pin');await page.click('#so-pin');                       // pin the open session from its header
   await page.waitForSelector(`.session-item.pinned[data-item="${b}"] [data-grip]`);
   await page.click(`[data-more="${a}"]`);await page.waitForSelector('#so-pin');await page.click('#so-pin');            // pin another from the rail
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
   await page.click(`[data-more="${a}"]`);await page.waitForSelector('#so-pin-down');assert.equal(await page.$('#so-pin-up'),null,'the first pin cannot move up');
   n=pinOrders.length;await page.click('#so-pin-down');for(let i=0;i<40&&pinOrders.length===n;i++)await pause(100);
   assert.deepEqual(pinOrders.at(-1),[b,a],'Session options moves it too');
   await scan('pinned-tabs-desktop');await page.screenshot({path:path.join(out,'pinned-tabs-desktop.png')});
   for(const id of [a,b]){await page.click(`[data-more="${id}"]`);await page.waitForSelector('#so-pin');await page.click('#so-pin');await page.waitForFunction(id=>!document.querySelector(`.session-item.pinned[data-item="${id}"]`),{},id);}
   await page.waitForFunction(()=>document.querySelectorAll('#open-sessions .open-session.pinned').length===0);
  });
  await check('Voice: one tap mutes replies and announcements on this device; settings mirror it; hands-free turns it back on',async()=>{
   await page.setViewport({width:390,height:844});await chat();await page.waitForSelector('#micb:not([hidden])');
   await page.waitForSelector('[data-voice-mute]:not([hidden])');
   assert.equal(await page.$eval('[data-voice-mute]',e=>e.getAttribute('aria-pressed')),'false');
   assert.match(await page.$eval('[data-voice-mute]',e=>e.textContent),/^Voice$/);
   await page.click('[data-voice-mute]');
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
   await page.click('#hfb');await page.waitForFunction(()=>!Voice.isMuted());                                            // starting hands-free is asking to hear it
   await page.waitForSelector('#voice-cancel');await page.click('#voice-cancel');
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
    await page.click('[data-automated] > summary');await page.waitForFunction(()=>readLocal('pc-automated-open',false)===true);
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
    const before=received.length;await page.click('[data-retry-turn]');await pause(300);
    assert.equal(await page.$eval('#box',e=>e.value),'My own draft');assert.equal(received.length,before,'nothing sent over a draft');
    await page.$eval('#box',e=>{e.value='';e.dispatchEvent(new Event('input'));});
    await page.click('[data-retry-turn]');
    for(let i=0;i<40&&received.length===before;i++)await pause(100);
    assert.equal(received.at(-1).text,'Review the stock report.');
    assert.equal(await page.$('#turn-failure'),null,'the row goes once you send');
   } finally {failed.state=prior;}
  });
  await check('1.19 Session options: grouped, with display settings last',async()=>{
   await chat();await page.click('#chatmore');await page.waitForSelector('.sheet .opt-group');
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
   await page.$eval('#first',e=>{e.value='';e.dispatchEvent(new Event('input'));});await page.click('#start');
   assert.equal(await page.$eval('#start-hint',e=>e.hidden),false);assert.match(await page.$eval('#start-hint',e=>e.textContent),/Write what you would like done/);
   await scan('new-session-hint-mobile');
   await page.type('#first','x');assert.equal(await page.$eval('#start-hint',e=>e.hidden),true);
   await page.$eval('#first',e=>{e.value='';e.dispatchEvent(new Event('input'));});
  });
  await check('1.20 Settings: generated titles switch on and off, choose a model, and say why one is unavailable',async()=>{
   await page.setViewport({width:390,height:844});await page.goto(base+'/#/');await page.waitForSelector('#settings');
   await page.click('#settings');await page.waitForFunction(()=>!document.querySelector('#s-titles').disabled);
   assert.equal(await page.$eval('#s-titles',e=>e.getAttribute('aria-pressed')),'true');
   assert.match(await page.$eval('#s-titles-state',e=>e.textContent),/On, using Claude · Haiku/);
   assert.deepEqual(await page.$$eval('#s-title-model option',os=>os.map(o=>[o.value,o.disabled])),[['auto',false],['claude',false],['codex',true]],'an unavailable provider cannot be chosen');
   assert.match(await page.$eval('#s-title-model option[value="codex"]',o=>o.textContent),/unavailable/);
   assert.match(await page.$eval('#s-title-note',e=>e.textContent),/Last title by Haiku 4\.5/);
   assert.ok(await page.$eval('#s-titles',e=>e.getBoundingClientRect().height)>=44);
   await page.$eval('#s-titles',e=>e.scrollIntoView({block:'center'}));
   await scan('title-settings-mobile');await page.screenshot({path:path.join(out,'title-settings-mobile.png')});
   await page.click('#s-titles');await page.waitForFunction(()=>document.querySelector('#s-titles').getAttribute('aria-pressed')==='false');
   assert.equal(settingsState().autoTitles,false);assert.equal(await page.$eval('#s-title-model',e=>e.disabled),true,'the model choice waits until titles are on');
   assert.match(await page.$eval('#s-titles-state',e=>e.textContent),/^Off\./);
   await page.click('#s-titles');await page.waitForFunction(()=>!document.querySelector('#s-title-model').disabled);
   await page.select('#s-title-model','claude');await page.waitForFunction(()=>!document.querySelector('#s-title-model').disabled);
   assert.equal(settingsState().titleProvider,'claude');
   await page.select('#s-title-model','auto');await page.waitForFunction(()=>!document.querySelector('#s-title-model').disabled);
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.scrim'));
  });
  await scan('chat-desktop');await page.setViewport({width:390,height:844});await scan('chat-mobile');
  await page.evaluate(()=>settingsSheet());await scan('settings-mobile');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'ui-regressions.json'),JSON.stringify({checks,scans,errors},null,2));
  console.log(JSON.stringify({uiRegressions:checks.length,accessibilityScans:scans.length,ok:true}));
 } catch(e) {
  await page.screenshot({path:path.join(out,'ui-regression-failure.png')});
  fs.writeFileSync(path.join(out,'ui-regressions.json'),JSON.stringify({checks,scans,errors,error:e.message},null,2));throw e;
 } finally {setMode({workerFailed:false,aboutFailed:false});await context.close();}
}
