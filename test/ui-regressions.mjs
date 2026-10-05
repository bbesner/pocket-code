// Browser regressions for the 1.7 audit. Uses the existing synthetic API server;
// no real credentials, transcripts, providers or production processes are involved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const axePath=require.resolve('axe-core/axe.min.js');
const pause=ms=>new Promise(r=>setTimeout(r,ms));

export async function runUIRegressions({browser,base,rows,out,setMode,received=[],voiceLog={transcribe:[],speak:[]}}) {
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
   await page.evaluate(id=>localStorage.removeItem('pc-seen-'+id),done.id);await page.reload();await page.waitForSelector(`[data-session-results] [data-id="${done.id}"]`);
   assert.deepEqual(await status(),{cls:'session-status state-finished',text:'Response readyNew'});
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
  await check('Voice: Settings saves preferences and lists voices',async()=>{
   await page.evaluate(()=>settingsSheet());await page.waitForSelector('#s-voice');
   await page.click('#s-voice > summary');
   await page.waitForFunction(()=>document.querySelector('#s-voice-state').textContent.includes('available'));
   assert.deepEqual(await page.$$eval('#s-voice-voice option',o=>o.map(x=>x.value)),['af_heart','bm_george']);
   await page.click('#s-voice-review');
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pc-voice')).review),true);
   assert.equal(await page.$eval('#s-voice-wait',e=>e.value),'120','waits 2 minutes for a reply by default');
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
  await check('A reply that finishes on screen stays Response ready until you engage with the page',async()=>{
   const done=rows.find(r=>r.state.kind==='finished')||rows[4];const saved=done.state;
   done.state={kind:'finished',label:'Response ready',at:Date.now()};
   await page.goto(base+'/#/chat/'+done.id);await page.waitForSelector('#box');
   await page.evaluate(id=>{localStorage.removeItem('pc-seen-'+id);awaitingEngagement.add(id);},done.id); // as if the turn ended while watching
   await page.evaluate(()=>refreshSessions());await pause(200);
   assert.equal(await page.evaluate(id=>localStorage.getItem('pc-seen-'+id),done.id),null,'an unattended screen does not mark it read');
   assert.equal(await page.evaluate(id=>isUnread(allSessions.find(s=>s.id===id)),done.id),true,'still New in the session list');
   await page.mouse.click(200,300);await page.evaluate(()=>refreshSessions());await pause(200);
   assert.equal(await page.evaluate(id=>localStorage.getItem('pc-seen-'+id),done.id),String(done.state.at),'engaging marks it read');
   done.state=saved;
  });
  await check('Voice: the mic is hidden when the server has no voice engine',async()=>{
   setMode({voice:false});await page.reload();await page.waitForSelector('#box');await pause(300);
   assert.equal(await page.$eval('#micb',e=>e.hidden),true);assert.equal(await page.$eval('#hfb',e=>e.hidden),true);
   setMode({voice:true});await page.reload();await page.waitForSelector('#micb:not([hidden])');
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
