// Browser checks for what the 1.124.5 UI/UX test found and fixed. Each one failed on the code before its fix.
// Runs on browser.mjs's synthetic server (fixtures only): no real agent, account or transcript is involved.
//   POCKET_UIFIX_ONLY=1 [POCKET_CHECK=<part of a name>] node test/browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const pause=ms=>new Promise(r=>setTimeout(r,ms));
const PHONE={width:390,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true};
const COVER={width:344,height:882,deviceScaleFactor:1,isMobile:true,hasTouch:true};
const DESKTOP={width:1440,height:900,deviceScaleFactor:1};

export async function runUiTestFixes({browser,base,rows,out,settingsState=()=>({}),coord=null}) {
 const checks=[],errors=[];
 // Each check gets its own browser context: a clean localStorage, and request interception that ends with it.
 const check=async(name,viewport,fn)=>{
  if(process.env.POCKET_CHECK&&!name.includes(process.env.POCKET_CHECK))return;
  const context=await browser.createBrowserContext(),page=await context.newPage();
  page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(name+': '+e.message));
  await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:'dark'}]);await page.setViewport(viewport);
  try{await fn(page);checks.push(name);}
  catch(e){await page.screenshot({path:path.join(out,'ui-test-fixes-failure.png')}).catch(()=>{});e.message=name+': '+e.message;throw e;}
  finally{await context.close();}
 };
 // Answer or delay chosen API calls; everything else goes to the fixture server.
 const intercept=async(page,handler)=>{
  await page.setRequestInterception(true);
  page.on('request',async r=>{if(r.isInterceptResolutionHandled())return;const u=new URL(r.url());try{if(await handler(r,u)!==true)await r.continue();}catch{}});
 };
 const openChat=async(page,id)=>{await page.goto(base+'/#/chat/'+id);await page.waitForFunction(id=>chatId===id&&document.querySelector('#ctitle')?.textContent!=='Conversation'&&document.querySelector('#box'),{},id);};
 const idle=rows[4],running=rows[0];

 await check('The sign-in box is drawn in the app\'s own style, is labelled, and a wrong password is announced on the field',PHONE,async page=>{
  await intercept(page,async(r,u)=>{
   if(u.pathname==='/api/me'){await r.respond({status:200,contentType:'application/json',body:'{"ok":false}'});return true;}
   if(u.pathname==='/api/login'){await r.respond({status:401,contentType:'application/json',body:'{"error":"Wrong password"}'});return true;}
  });
  await page.goto(base+'/#/');await page.waitForSelector('#pw');
  const box=await page.$eval('#pw',e=>{const cs=getComputedStyle(e),root=getComputedStyle(document.documentElement);const probe=document.createElement('i');probe.style.color='var(--surface)';document.body.append(probe);const surface=getComputedStyle(probe).color;probe.remove();
   return {height:e.getBoundingClientRect().height,bg:cs.backgroundColor,surface,radius:cs.borderTopLeftRadius,font:parseFloat(cs.fontSize),label:e.labels?.[0]?.textContent.trim()||'',describedby:e.getAttribute('aria-describedby'),invalid:e.getAttribute('aria-invalid')};});
  assert.ok(box.height>=44,`the box is a 44px target (was the browser's 21px): ${box.height}`);
  assert.equal(box.bg,box.surface,'the box is on --surface, not the browser\'s white');
  assert.equal(box.radius,'14px');assert.ok(box.font>=16,'16px or more, so iOS does not zoom the page');
  assert.equal(box.label,'Password','a visible label, not only a placeholder');assert.equal(box.describedby,'lerr');assert.equal(box.invalid,null);
  await page.type('#pw','not-the-password');await page.click('#go');
  await page.waitForFunction(()=>document.querySelector('#lerr')?.textContent.trim());
  assert.deepEqual(await page.evaluate(()=>({text:document.querySelector('#lerr').textContent,role:document.querySelector('#lerr').getAttribute('role'),invalid:document.querySelector('#pw').getAttribute('aria-invalid'),focus:document.activeElement?.id})),
   {text:'Wrong password.',role:'alert',invalid:'true',focus:'pw'});
 });

 await check('A report table keeps every column readable on a phone',PHONE,async page=>{
  await openChat(page,idle.id);await page.waitForSelector('.report-table td');
  const cells=await page.$$eval('.report-table th,.report-table td',els=>els.map(e=>({w:e.getBoundingClientRect().width,wrap:getComputedStyle(e).overflowWrap})));
  assert.ok(cells.length>=4);
  assert.ok(cells.every(c=>c.wrap==='break-word'),'a long word breaks only when it has to; "anywhere" let a column shrink to one letter a line');
  assert.ok(cells.every(c=>c.w>=109),'no column narrower than its 110px floor: '+JSON.stringify(cells.map(c=>Math.round(c.w))));
 });

 await check('Words typed while a message is still sending are kept, and survive a failed send',PHONE,async page=>{
  const sent=[];let mode='slow';
  await intercept(page,async(r,u)=>{
   if(r.method()==='POST'&&/^\/api\/session\/[^/]+\/message$/.test(u.pathname)){
    sent.push(JSON.parse(r.postData()).text);
    if(mode==='fail'){await pause(500);await r.abort('connectionreset');return true;}
    await pause(900);
   }
  });
  await openChat(page,idle.id);await page.evaluate(id=>{saveOutbox(id,null);clearDraft(id);},idle.id);
  await page.type('#box','First message');await page.click('#send');
  await page.waitForFunction(()=>document.querySelector('#delivery-status')?.textContent.includes('Sending'));
  assert.equal(await page.$eval('#box',e=>e.readOnly),false,'the box stays open while the message is on its way');
  assert.equal(await page.$eval('#box',e=>e.value),'','and is empty, ready for the next one');
  await page.type('#box','Second thought');
  await page.waitForFunction(()=>document.querySelector('#delivery-status')?.textContent==='Message delivered.');
  assert.deepEqual(sent,['First message'],'exactly the first message was sent');
  assert.equal(await page.$eval('#box',e=>e.value),'Second thought','nothing typed during the send was dropped');
  assert.equal(await page.evaluate(id=>loadDraft(id),idle.id),'Second thought','and it is saved as the draft');
  // A failed send puts the unsent message back in the box; what was typed since comes back when it is discarded.
  mode='fail';await page.$eval('#box',e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.type('#box','Third message');await page.click('#send');
  await page.waitForFunction(()=>document.querySelector('#delivery-status')?.textContent.includes('Sending'));
  await page.type('#box','typed later');
  await page.waitForSelector('#discard-message');
  assert.deepEqual(await page.evaluate(()=>({box:document.querySelector('#box').value,readOnly:document.querySelector('#box').readOnly,discard:document.querySelector('#discard-message').textContent})),
   {box:'Third message',readOnly:true,discard:'Discard message'},'the unsent message is shown and held; the button says what it does');
  await page.click('#discard-message');
  assert.deepEqual(await page.evaluate(id=>({box:document.querySelector('#box').value,readOnly:document.querySelector('#box').readOnly,outbox:loadOutbox(id),draft:loadDraft(id)}),idle.id),
   {box:'typed later',readOnly:false,outbox:null,draft:'typed later'});
  await page.evaluate(id=>{clearDraft(id);},idle.id);
 });

 await check('Undo after Mark all reviewed puts focus back on Mark all reviewed',PHONE,async page=>{
  const done=rows.find(r=>r.state.kind==='finished')||idle;const saved=done.state,seen=done.seenAt;
  done.state={kind:'finished',label:'Response ready',at:Date.now()};delete done.seenAt;
  try{
   await page.goto(base+'/#/');await page.waitForSelector('[data-filter="attention"]');
   await page.evaluate(id=>{localStorage.removeItem('pc-seen-'+id);serverSeen.delete(id);seenPending.delete(id);return refreshSessions();},done.id);
   await page.click('[data-filter="attention"]');await page.waitForSelector('[data-mark-all-reviewed]');
   await page.click('[data-mark-all-reviewed]');await page.waitForSelector('[data-undo-reviewed]');
   assert.equal(await page.evaluate(()=>document.activeElement?.hasAttribute('data-undo-reviewed')),true,'Mark all moves focus to Undo');
   await page.keyboard.press('Enter');await page.waitForSelector('[data-mark-all-reviewed]');
   assert.equal(await page.evaluate(()=>document.activeElement?.hasAttribute('data-mark-all-reviewed')),true,'Undo removed itself; focus is on the button it restored, not the page');
  }finally{done.state=saved;if(seen!==undefined)done.seenAt=seen;}
 });

 await check('The bell says whether notifications are on, and the All filter is a full-size target',PHONE,async page=>{
  await page.goto(base+'/#/');await page.waitForSelector('#bell');await page.waitForSelector('[data-filter="all"]');
  assert.deepEqual(await page.$eval('#bell',e=>({pressed:e.getAttribute('aria-pressed'),label:e.getAttribute('aria-label')})),{pressed:'false',label:'Notifications off for this device'});
  await page.evaluate(()=>paintBell(document.querySelector('#bell'),true));
  assert.deepEqual(await page.$eval('#bell',e=>({pressed:e.getAttribute('aria-pressed'),label:e.getAttribute('aria-label'),on:e.classList.contains('on')})),{pressed:'true',label:'Notifications on for this device',on:true});
  const all=await page.$eval('[data-filter="all"]',e=>{const r=e.getBoundingClientRect();return [r.width,r.height];});
  assert.ok(all[0]>=44&&all[1]>=44,'All is at least 44x44: '+all);
 });

 await check('On a 344px phone the header keeps the state word whole, in the working colour, and the counts stay readable',COVER,async page=>{
  await openChat(page,running.id);await page.waitForFunction(()=>/^Running/.test(document.querySelector('#run-confirmed-state')?.textContent||''));
  const head=await page.evaluate(()=>{const s=document.querySelector('.run-confirmation'),st=document.querySelector('#run-confirmed-state'),probe=document.createElement('i');probe.style.color='var(--clay)';document.body.append(probe);const clay=getComputedStyle(probe).color;probe.remove();
   const counts=document.querySelector('#session-switch .ss-counts'),sw=document.querySelector('#session-switch');
   return {cut:s.scrollWidth>s.clientWidth+1,color:getComputedStyle(st).color,clay,counts:counts?.textContent||'',countsWidth:counts?counts.getBoundingClientRect().width:0,name:sw.getAttribute('aria-label'),text:sw.textContent};});
  assert.equal(head.cut,false,'"Running" is not cut to "Ru…"');
  assert.equal(head.color,head.clay,'running is clay here as in the list row and the ember; green is for finished');
  assert.match(head.counts,/^\d+ running/);assert.ok(head.countsWidth>=50,'the counts have room for "1 running": '+head.countsWidth);
  assert.match(head.name,/^Conversations · \d+ running/,'the button keeps its full name');assert.match(head.text,/^Conversations · \d+ running/);
 });

 await check('On a 344px phone New conversation keeps Start on the icon row',COVER,async page=>{
  await page.goto(base+'/#/new');await page.waitForSelector('#first');await page.waitForSelector('#start');
  const tops=await page.evaluate(()=>{const top=s=>{const e=document.querySelector(s);return e&&e.getBoundingClientRect().width?Math.round(e.getBoundingClientRect().top+e.getBoundingClientRect().height/2):null;};return {start:top('#start'),attach:top('#comp .composer-actions .icon')};});
  assert.ok(tops.start!==null&&tops.attach!==null,JSON.stringify(tops));
  assert.ok(Math.abs(tops.start-tops.attach)<24,'Start sits on the same row as the other controls: '+JSON.stringify(tops));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'and the page does not scroll sideways');
 });

 await check('Open tabs shorten with an ellipsis, and a narrow main column gets the two-row composer',DESKTOP,async page=>{
  await openChat(page,idle.id);await page.waitForSelector('.open-session a');
  const tab=await page.$eval('.open-session a',e=>{const cs=getComputedStyle(e);return {display:cs.display,overflow:cs.textOverflow,height:e.getBoundingClientRect().height};});
  assert.equal(tab.display,'block','a flex link made the title an anonymous item that was cut mid-letter');assert.equal(tab.overflow,'ellipsis');assert.ok(tab.height>=44);
  // Narrow the conversation column the way a split pane does and the message box takes its own row.
  const rowOf=()=>page.evaluate(()=>{const b=document.querySelector('#box').getBoundingClientRect(),s=document.querySelector('#send').getBoundingClientRect();return {sameRow:Math.abs((b.top+b.height/2)-(s.top+s.height/2))<24,box:Math.round(b.width)};});
  const wide=await rowOf();assert.equal(wide.sameRow,true,'a wide column keeps the one-row composer');
  await page.evaluate(()=>{document.querySelector('.chatcol').style.maxWidth='470px';});await pause(150);
  const narrow=await rowOf();assert.equal(narrow.sameRow,false,'the box is on its own row');assert.ok(narrow.box>=400,'and is as wide as the column: '+narrow.box);
 });

 // ---------- the library screens ----------
 // Turn features on for one check, and put the fixture's settings back after.
 const withSettings=async(patch,fn)=>{const settings=settingsState(),saved={...settings};Object.assign(settings,patch);
  try{await fn();}finally{for(const k of Object.keys(settings))delete settings[k];Object.assign(settings,saved);}};
 const post=(page,url,body)=>page.evaluate((url,body)=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})}).then(r=>r.json().catch(()=>({}))),url,body);
 const ID='warehouse-stock-report',SHEET='.sheet[role=dialog]';

 await check('Edit project: a card changed elsewhere shows its new values in the sheet, and the second Save does not undo them',PHONE,page=>withSettings({projects:true},async()=>{
  await page.goto(base+'/#/');await page.waitForSelector('[data-filter="all"]');await post(page,'/api/board/reset');
  await page.goto(base+'/?ui-fix=1#/projects/'+ID);await page.waitForSelector('.project-card [data-edit]');
  await page.click('.project-card [data-edit]');await page.waitForSelector('.project-editor form');
  const OTHER='Changed on another device: aisle 4 recount finished.',MINE='Post the adjustment today.';
  await post(page,'/api/board/act',{action:'update',project:ID,summary:OTHER});
  await page.$eval('.project-editor [name=next]',e=>{e.value='';});await page.type('.project-editor [name=next]',MINE);
  await page.click('.project-editor .primary');
  await page.waitForFunction(()=>!document.querySelector('.project-editor [data-stale]')?.hidden);
  const after=await page.evaluate(()=>({summary:document.querySelector('.project-editor [name=summary]').value,next:document.querySelector('.project-editor [name=next]').value,note:document.querySelector('.project-editor [data-stale]').textContent}));
  assert.equal(after.summary,OTHER,'the field changed elsewhere now shows the new value (it kept the old one, and the next Save wrote it back)');
  assert.equal(after.next,MINE,'the field being edited keeps what was typed');
  assert.match(after.note,/changed while you were editing\. Now showing the new Where we left off\./);
  await page.click('.project-editor .primary');await page.waitForFunction(()=>!document.querySelector('.project-editor'));
  const saved=await page.evaluate(id=>fetch('/api/board').then(r=>r.json()).then(s=>s.projects.find(p=>p.id===id)),ID);
  assert.equal(saved.summary,OTHER,'the other device\'s change is still there');assert.equal(saved.next,MINE);
  await post(page,'/api/board/reset');
 }));

 await check('Edit project: a refused value is named in the sheet and its field is marked',PHONE,page=>withSettings({projects:true},async()=>{
  await page.goto(base+'/#/');await page.waitForSelector('[data-filter="all"]');await post(page,'/api/board/reset');
  await page.goto(base+'/?ui-fix=2#/projects/'+ID);await page.waitForSelector('.project-card [data-edit]');
  await page.click('.project-card [data-edit]');await page.waitForSelector('.project-editor form');
  // The answer the real server gives for a relative directory (projects.mjs), whatever the fixture's own check is.
  await intercept(page,async(r,u)=>{if(r.method()==='POST'&&u.pathname==='/api/board/act'){await r.respond({status:400,contentType:'application/json',body:JSON.stringify({error:'The directory must be a full path.'})});return true;}});
  await page.$eval('.project-editor [name=directory]',e=>{e.value='relative/folder';});
  await page.click('.project-editor .primary');
  await page.waitForFunction(()=>document.querySelector('.project-editor [data-error]')?.textContent);
  assert.deepEqual(await page.evaluate(()=>({line:document.querySelector('.project-editor [data-error]').textContent,role:document.querySelector('.project-editor [data-error]').getAttribute('role'),invalid:document.querySelector('.project-editor [name=directory]').getAttribute('aria-invalid'),focus:document.activeElement?.name,open:Boolean(document.querySelector('.project-editor'))})),
   {line:'The directory must be a full path.',role:'alert',invalid:'true',focus:'directory',open:true});
  await page.type('.project-editor [name=directory]','x');
  assert.deepEqual(await page.evaluate(()=>({line:document.querySelector('.project-editor [data-error]').textContent,invalid:document.querySelector('.project-editor [name=directory]').getAttribute('aria-invalid')})),{line:'',invalid:null},'typing clears the mark');
 }));

 await check('Reminder quick picks never offer the same time twice',PHONE,async page=>{
  await page.goto(base+'/#/');await page.waitForSelector('[data-filter="all"]');
  // A Monday, where "Next Monday" and "In a week" were the same morning; and a Wednesday, where all four differ.
  const picks=day=>page.evaluate(day=>{const Real=Date;try{const fixed=new Real(day).getTime();globalThis.Date=class extends Real{constructor(...a){a.length?super(...a):super(fixed);}static now(){return fixed;}};return quickPicks().map(p=>[p[1],p[2].getTime()]);}finally{globalThis.Date=Real;}},day);
  const monday=await picks('2026-11-23T10:00:00'),wednesday=await picks('2026-11-25T10:00:00');
  assert.deepEqual(monday.map(p=>p[0]),['Tomorrow morning','In three days','Next Monday']);assert.equal(new Set(monday.map(p=>p[1])).size,monday.length);
  assert.deepEqual(wednesday.map(p=>p[0]),['Tomorrow morning','In three days','Next Monday','In a week']);
 });

 if(coord)await check('Coordination: the empty line is inset, a link is a full-size target, and Release keeps the focus in the list',PHONE,page=>withSettings({coordination:true},async()=>{
  try{
   coord.reset();await page.goto(base+'/#/coordination');await page.waitForSelector('.coord-row [data-coord-release]');
   const link=await page.$eval('.coord-who a',e=>e.getBoundingClientRect().height).catch(()=>null);
   if(link!==null)assert.ok(link>=44,'the conversation link has a 44px tap area: '+link);
   const names=await page.$$eval('[data-coord-release]',bs=>bs.map(b=>b.dataset.coordRelease));assert.ok(names.length>=2,'the fixture holds two or more');
   await page.focus(`[data-coord-release="${names[0]}"]`);await page.keyboard.press('Enter');
   await page.waitForFunction(n=>!document.querySelector(`[data-coord-release="${n}"]`),{},names[0]);
   assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.coordRelease||document.activeElement?.tagName),names[1],'focus is on the next hold\'s Release, not the page');
   coord.reset([]);coord.recent=[];await page.goto(base+'/?ui-fix=3#/coordination');await page.waitForSelector('.project-empty');
   assert.equal(await page.$eval('.project-empty',e=>getComputedStyle(e).paddingLeft),'18px','"Nothing is held" lines up with the heading, off the screen edge');
  }finally{coord.reset();}
 }));

 await check('Library lists: one rule before a folded group, and a due step is amber',PHONE,page=>withSettings({projects:true,tasks:true},async()=>{
  await page.goto(base+'/#/');await page.waitForSelector('[data-filter="all"]');await post(page,'/api/board/reset');await post(page,'/api/tasks/reset');
  await page.goto(base+'/?ui-fix=4#/tasks');await page.waitForSelector('details.session-group.settings-details');
  assert.deepEqual(await page.$eval('details.session-group.settings-details',e=>{const cs=getComputedStyle(e);return [cs.borderTopWidth,cs.marginTop];}),['0px','0px'],'the group above already draws the rule');
  const colours=await page.evaluate(()=>{const mk=c=>{const e=document.createElement('small');e.className=c;document.body.append(e);const v=getComputedStyle(e).color;e.remove();return v;};const probe=document.createElement('i');probe.style.color='var(--warn)';document.body.append(probe);const warn=getComputedStyle(probe).color;probe.remove();return {due:mk('task-meta due-label'),warn};});
  assert.equal(colours.due,colours.warn,'a due reminder on a step reads in the due amber, as in Tasks');
 }));

 await check('Files: a change in the Share sheet keeps the keyboard focus on the file\'s Share button afterwards',PHONE,page=>withSettings({documents:true,projects:true},async()=>{
  await page.goto(base+'/#/');await page.waitForSelector('[data-filter="all"]');await post(page,'/api/documents/reset');
  const id=await page.evaluate(()=>fetch('/api/documents').then(r=>r.json()).then(s=>(s.documents||[]).find(d=>!d.trashedAt&&d.visibility==='private')?.id));assert.ok(id,'the fixture has a private file');
  await page.goto(base+'/?ui-fix=5#/documents/'+id);await page.waitForSelector('main [data-share]');
  await page.focus('main [data-share]');await page.keyboard.press('Enter');await page.waitForSelector(SHEET+' [data-v="link"]');
  await page.click(SHEET+' [data-v="link"]');await page.waitForSelector(SHEET+' #share-expiry');
  await page.select(SHEET+' #share-expiry','7');
  await page.waitForFunction(()=>document.querySelector('#share-expiry')?.value==='7'&&document.activeElement?.id==='share-expiry');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.sheet[role=dialog]'));
  assert.equal(await page.evaluate(()=>document.activeElement?.matches('main [data-share]')),true,'Escape returns to Share, not to the top of the page');
  await post(page,'/api/documents/reset');
 }));

 // ---- Settings, Updates, Automation and the Inbox --------------------------------------------------------------------
 const REASON='Pocket Code could not record the process on disk, so it did not start it. Check the free disk space, then send again.';
 await check('A message the server did not start says Not sent and gives the server\'s reason, in a chat and on New',PHONE,async page=>{
  await intercept(page,async(r,u)=>{
   if(r.method()==='POST'&&(/^\/api\/session\/[^/]+\/message$/.test(u.pathname)||u.pathname==='/api/new')){await r.respond({status:503,contentType:'application/json',body:JSON.stringify({error:REASON,code:'not_started'})});return true;}
  });
  await openChat(page,idle.id);await page.evaluate(id=>{saveOutbox(id,null);clearDraft(id);},idle.id);
  await page.type('#box','Count the pallets in aisle 4');await page.click('#send');
  await page.waitForFunction(()=>document.querySelector('#retry-message'));
  const chat=await page.evaluate(()=>({text:document.querySelector('#delivery-status p').textContent,edit:Boolean(document.querySelector('#edit-message')),review:Boolean(document.querySelector('#review-message')),box:document.querySelector('#box').value}));
  assert.equal(chat.text,'Not sent: '+REASON,'the server\'s own reason, not "Delivery not confirmed"');
  assert.deepEqual([chat.edit,chat.review,chat.box],[true,false,'Count the pallets in aisle 4'],'it can be edited (nothing was sent), and the words are back in the box');
  await page.click('#discard-message');
  await page.goto(base+'/?ui-fix=6#/new');await page.waitForSelector('#first');await page.waitForSelector('#start');
  await page.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('pc-outbox'))localStorage.removeItem(k);});
  await page.type('#first','Recount the cold room');await page.click('#start');
  await page.waitForFunction(()=>{const h=document.querySelector('#start-hint');return h&&!h.hidden&&h.textContent;});
  const fresh=await page.evaluate(()=>({hint:document.querySelector('#start-hint').textContent,note:document.querySelector('#new-delivery').hidden,first:document.querySelector('#first').value,start:document.querySelector('#start').disabled,route:location.hash}));
  assert.equal(fresh.hint,'Not sent: '+REASON);
  assert.deepEqual([fresh.note,fresh.first,fresh.start,fresh.route],[true,'Recount the cold room',false,'#/new'],'no "not yet confirmed" note; the draft stays and Start works again');
 });

 await check('Updates: a failed Pocket Code update shows the server\'s reason once',PHONE,async page=>{
  const error='The update did not start. Nothing was changed. The log is pocket-self-update.log in Pocket\'s data folder.';
  const state={enabled:true,timeZone:'America/New_York',hour:4,checkedAt:Date.now(),checking:false,job:null,providers:[],
   pocket:{key:'pocket',name:'Pocket Code',enabled:true,installed:'1.124.4',latest:'1.125.0',available:true,notes:'https://example.test/releases/tag/v1.125.0',guide:'https://example.test/docs/operations.md',
    self:{enabled:true,available:true,reason:null,job:{id:'self-x',running:false,phase:'failed',from:'1.124.4',to:'1.125.0',error}}}};
  await page.goto(base+'/#/all');await page.waitForSelector('.session-home');
  await intercept(page,async(r,u)=>{if(u.pathname.startsWith('/api/cli-updates')){await r.respond({status:200,contentType:'application/json',body:JSON.stringify(state)});return true;}});
  await page.evaluate(()=>pollCliUpdates());await page.evaluate(()=>openCliUpdates());
  await page.waitForFunction(()=>/did not start/.test(document.querySelector('#pocket-update-row')?.textContent||''));
  const text=await page.$eval('#pocket-update-row',e=>e.textContent);
  assert.ok(text.includes(error),'the reason is shown');assert.ok(!text.includes('did not finish'),'without "The update did not finish." in front of "The update did not start.": '+text.slice(0,200));
 });

 await check('Settings: a hidden chip is hidden, labels start at the heading\'s edge, and the email field names its own error',PHONE,async page=>{
  await page.goto(base+'/#/all');await page.waitForSelector('#settings');await page.waitForFunction(()=>typeof settingsSheet==='function');
  const edges=sel=>page.evaluate(sel=>{const edge=e=>Math.round(e.getBoundingClientRect().left+parseFloat(getComputedStyle(e).paddingLeft));const sh=document.querySelector('.sheet[role=dialog]');
   return {head:edge(sh.querySelector('h2')),lines:[...sh.querySelectorAll(sel)].filter(e=>e.getClientRects().length).map(edge)};},sel);
  await page.evaluate(()=>settingsSheet({category:'conversation'}));await page.waitForSelector('#s-titles',{visible:true});
  await page.waitForFunction(()=>!document.querySelector('#s-sync')?.disabled);
  assert.deepEqual(await page.$eval('#s-sync-retry',e=>[e.hidden,getComputedStyle(e).display]),[true,'none'],'"Retry name-sync setting" is not shown when nothing failed');
  const scope=await edges('.settings-scope');assert.ok(scope.lines.length>=2);
  assert.ok(scope.lines.every(x=>Math.abs(x-scope.head)<=1),'"This device" starts where the heading does: '+JSON.stringify(scope));
  // Accounts: the body is on the heading's inset, and every heading in it is one size
  await page.evaluate(()=>settingsSheet({category:'agents'}));await page.waitForSelector('#s-environment',{visible:true});await page.click('#s-environment');
  await page.waitForFunction(()=>document.querySelectorAll('.sheet[role=dialog] [data-environment] h3').length>=2);
  const env=await edges('[data-environment] > *');assert.ok(env.lines.every(x=>x>=env.head-1),'the Accounts body does not hang out to the left of its heading: '+JSON.stringify(env));
  assert.deepEqual([...new Set(await page.$$eval('.sheet[role=dialog] [data-environment] h3',hs=>hs.map(h=>getComputedStyle(h).fontSize)))],['16px'],'"Conversation controls" is the size of the account headings');
  // The email address: a wrong one is named under the field, by the page and by the server alike
  await page.evaluate(()=>settingsSheet({category:'notifications'}));await page.waitForSelector('#s-email',{visible:true});await page.waitForFunction(()=>!document.querySelector('#s-email').disabled);
  const state=()=>page.evaluate(()=>({err:document.querySelector('#s-email-err').textContent,role:document.querySelector('#s-email-err').getAttribute('role'),invalid:document.querySelector('#s-email').getAttribute('aria-invalid'),focus:document.activeElement?.id,value:document.querySelector('#s-email').value,novalidate:document.querySelector('#s-email-form').noValidate}));
  await page.$eval('#s-email',e=>{e.value='';});await page.type('#s-email','owner-at-example');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('#s-email-err').textContent);
  assert.deepEqual(await state(),{err:'That does not look like an email address.',role:'alert',invalid:'true',focus:'s-email',value:'owner-at-example',novalidate:true});
  await page.type('#s-email','x');assert.deepEqual(await page.evaluate(()=>[document.querySelector('#s-email-err').textContent,document.querySelector('#s-email').getAttribute('aria-invalid')]),['',null],'typing clears it');
  await page.$eval('#s-email',e=>{e.value='';});await page.type('#s-email','owner@example');await page.click('#s-email-save'); // the browser accepts this one; the server does not
  await page.waitForFunction(()=>document.querySelector('#s-email-err').textContent);
  assert.deepEqual(await state(),{err:'That does not look like an email address.',role:'alert',invalid:'true',focus:'s-email',value:'owner@example',novalidate:true},'a refusal from the server lands in the same place, and the address stays to be corrected');
 });

 await check('Settings in a split pane says where Automation is, not that the server lacks it',DESKTOP,async page=>{
  await page.setViewport({width:480,height:900,deviceScaleFactor:1});
  await page.goto(base+'/?pane=uifix#/all');await page.waitForFunction(()=>typeof settingsSheet==='function'&&window.pocketFeatures);
  assert.equal(await page.evaluate(()=>Boolean(window.pocketFeatures.automation)),true,'the fixture server offers automation');
  await page.evaluate(()=>settingsSheet({category:'automation'}));
  await page.waitForFunction(()=>document.querySelector('#s-automation-body')?.getAttribute('aria-busy')==='false');
  assert.equal(await page.$eval('#s-automation-body',e=>e.textContent.trim()),'Automation and Pause all are in the main window.');
 });

 await check('Inbox: after Dismiss or Resolved the focus is on the next entry, times read PM, and an item\'s buttons are full size on touch',PHONE,page=>withSettings({inbox:true},async()=>{
  await page.goto(base+'/#/');await page.waitForSelector('[data-filter="all"]');await post(page,'/api/inbox/reset');
  try{
   await page.goto(base+'/?ui-fix=7#/inbox');await page.waitForSelector('.inbox-view [data-inbox-open]');
   await page.evaluate(()=>{inboxFilter='open';paintInboxView();});
   const ids=()=>page.$$eval('#inbox-main [data-inbox-open]',bs=>bs.map(b=>b.dataset.inboxOpen));
   const before=await ids();assert.ok(before.length>=2,'the fixture has two or more open entries: '+before.length);
   await page.focus(`[data-inbox-dismiss="${before[0]}"]`);await page.keyboard.press('Enter');
   await page.waitForFunction(id=>!document.querySelector(`#inbox-main [data-inbox-open="${id}"]`),{},before[0]);
   assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.inboxOpen||document.activeElement?.tagName),before[1],'after the row\'s X, focus is on the entry now in its place');
   await page.keyboard.press('Enter');await page.waitForSelector(SHEET+' [data-resolve]');await page.focus(SHEET+' [data-resolve]');await page.keyboard.press('Enter');
   await page.waitForFunction(id=>!document.querySelector('.sheet[role=dialog]')&&!document.querySelector(`#inbox-main [data-inbox-open="${id}"]`),{},before[1]);
   assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.inboxOpen||document.activeElement?.tagName),before[2]||'H2','after Resolved in the sheet, too (the Inbox heading when it was the last entry)');
   assert.match(await page.evaluate(()=>inboxWhen('2026-11-23T21:48:00Z')),/\d:\d\d\s[AP]M$/,'"4:48 PM", as everywhere else in the app');
   const chip=await page.evaluate(()=>{const w=document.createElement('div');w.className='inbox-item-actions';w.innerHTML='<button class="chip">Resolved</button>';document.body.append(w);const h=w.firstChild.getBoundingClientRect().height;w.remove();return {h,coarse:matchMedia('(pointer: coarse)').matches};});
   assert.ok(!chip.coarse||chip.h>=44,'44px on a touch screen (was 36): '+JSON.stringify(chip));
  }finally{await post(page,'/api/inbox/reset');}
 }));

 await check('Resume on the home list leaves the focus on the More button, and Assistant mode\'s header has no stray dot',DESKTOP,async page=>{
  const {automationFixture:a}=await import('./automation-browser.mjs');
  a.paused={at:new Date().toISOString(),by:'owner'};
  try{
   await page.goto(base+'/#/all');await page.waitForSelector('.pause-banner button');
   const resume=await page.evaluateHandle(()=>[...document.querySelectorAll('.pause-banner button')].find(b=>/Resume/.test(b.textContent)));
   await resume.focus();await page.keyboard.press('Enter');
   await page.waitForFunction(()=>!document.querySelector('.pause-banner'));
   assert.equal(await page.evaluate(()=>document.activeElement?.id),'listmore','not the page: the next Tab would have started from the top');
  }finally{a.paused=null;}
  await withSettings({assistantMode:true},async()=>{
   await page.goto(base+'/?ui-fix=8#/chat/'+idle.id);await page.waitForFunction(id=>chatId===id&&document.querySelector('#box')&&document.documentElement.classList.contains('assistant'),{},idle.id);
   const head=await page.evaluate(()=>{const run=document.querySelector('header.bar h1 .run-confirmation'),tag=document.querySelector('header.bar h1 .tag');
    return {inHeader:Boolean(document.querySelector('.split.status-in-header:not(.compact-header)')),tag:Boolean(tag?.textContent.trim()),tagShown:tag?getComputedStyle(tag).display:'',dot:run?getComputedStyle(run,'::before').content:''};});
   assert.deepEqual([head.inHeader,head.tag,head.tagShown],[true,true,'none'],'the state is in the header and Assistant mode hides the folder beside it');assert.equal(head.dot,'none','so no separator is drawn before the state');
  });
 });

 // ---- What the flow tests found (front end) ---------------------------------------------------------------------------
 await check('Edit task: a task changed elsewhere shows its new values in the sheet, and the second Save does not undo them',PHONE,page=>withSettings({tasks:true},async()=>{
  await page.goto(base+'/#/');await page.waitForSelector('[data-filter="all"]');await post(page,'/api/tasks/reset');
  try{
   await page.goto(base+'/?ui-fix=9#/tasks');await page.waitForSelector('[data-task-open]');
   const id=await page.evaluate(()=>tasksSnap.tasks.find(t=>!t.done&&t.summary).id);
   await page.evaluate(id=>taskEditor(taskById(id)),id);await page.waitForSelector(SHEET+' .task-form [name=summary]');
   const OTHER='Agent added context: the supplier is Northwind.',MINE='Send the aisle 4 recount to purchasing today';
   await post(page,'/api/tasks/act',{action:'update',task:id,summary:OTHER});
   await page.$eval(SHEET+' [name=text]',e=>{e.value='';});await page.type(SHEET+' [name=text]',MINE);
   await page.click(SHEET+' .task-form .primary');
   await page.waitForFunction(()=>!document.querySelector('.task-form [data-stale]')?.hidden);
   const after=await page.evaluate(()=>({summary:document.querySelector('.task-form [name=summary]').value,text:document.querySelector('.task-form [name=text]').value,note:document.querySelector('.task-form [data-stale]').textContent,toasts:[...document.querySelectorAll('.toast')].map(t=>t.textContent)}));
   assert.equal(after.summary,OTHER,'the context changed elsewhere now shows the new value (it kept the old one, and the next Save wrote it back)');
   assert.equal(after.text,MINE,'the field being edited keeps what was typed');
   assert.match(after.note,/This task changed while you were editing\. Now showing the new context\./);
   assert.ok(!after.toasts.some(t=>/changed since/.test(t)),'the sheet explains it; no second message in a toast: '+JSON.stringify(after.toasts));
   await page.click(SHEET+' .task-form .primary');await page.waitForFunction(()=>!document.querySelector('.task-form'));
   const saved=await page.evaluate(id=>fetch('/api/tasks').then(r=>r.json()).then(s=>s.tasks.find(t=>t.id===id)),id);
   assert.deepEqual([saved.summary,saved.text],[OTHER,MINE],'the other side\'s change is still there, with the owner\'s');
  }finally{await post(page,'/api/tasks/reset');}
 }));

 await check('Sign-in runs out with a sheet open: the sign-in covers the sheet, and after Unlock the sheet still holds what was typed',PHONE,page=>withSettings({tasks:true},async()=>{
  let out=false,logins=0;
  await intercept(page,async(r,u)=>{
   if(u.pathname==='/api/login'){logins++;const ok=JSON.parse(r.postData()||'{}').password==='made-up-test-password';if(ok)out=false;await r.respond({status:ok?200:401,contentType:'application/json',body:ok?'{"ok":true}':'{"error":"Wrong password"}'});return true;}
   if(out&&u.pathname.startsWith('/api/')){await r.respond({status:401,contentType:'application/json',body:'{"error":"Unauthorized"}'});return true;}
  });
  await page.goto(base+'/#/');await page.waitForSelector('[data-filter="all"]');await post(page,'/api/tasks/reset');
  try{
   await page.goto(base+'/?ui-fix=10#/tasks');await page.waitForSelector('[data-task-open]');
   const id=await page.evaluate(()=>tasksSnap.tasks.find(t=>!t.done).id);
   await page.evaluate(id=>taskEditor(taskById(id)),id);await page.waitForSelector(SHEET+' .task-form [name=text]');
   const MINE='Count aisle 7 again before the order goes out';
   await page.$eval(SHEET+' [name=text]',e=>{e.value='';});await page.type(SHEET+' [name=text]',MINE);
   out=true;
   await page.click(SHEET+' .task-form .primary');
   await page.waitForSelector('.login-over #pw',{timeout:5000}).catch(()=>assert.fail('with a sheet open, the sign-in is shown above it (it was drawn under the sheet, where it cannot be reached)'));
   const state=()=>page.evaluate(()=>{const pw=document.querySelector('#pw'),r=pw.getBoundingClientRect(),top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return {focus:document.activeElement?.id,onTop:top===pw,sheet:Boolean(document.querySelector('.task-form')),sheetInert:document.querySelector('.sheet').inert,typed:document.querySelector('.task-form [name=text]').value,
     dialog:document.querySelector('.login-over').getAttribute('role'),title:document.querySelector('#login-title').textContent,toast:document.querySelector('#toast.show')?.textContent||''};});
   assert.deepEqual(await state(),{focus:'pw',onTop:true,sheet:true,sheetInert:true,typed:MINE,dialog:'dialog',title:'Sign in again',toast:''});
   await page.evaluate(()=>refreshSessions?.().catch(()=>{})); // a poll's 401 while the box is being typed into
   await page.type('#pw','wrong-one');await page.keyboard.press('Enter');
   await page.waitForFunction(()=>document.querySelector('.login-over #lerr')?.textContent.trim());
   assert.equal(await page.$eval('.login-over #lerr',e=>e.textContent),'Wrong password.');
   await page.keyboard.press('Escape');await pause(100);
   assert.ok(await page.$('.login-over')&&await page.$('.task-form'),'Escape closes neither the sign-in nor the sheet under it');
   await page.$eval('#pw',e=>{e.value='';});await page.type('#pw','made-up-test-password');await page.keyboard.press('Enter');
   await page.waitForFunction(()=>!document.querySelector('.login-over'));
   const after=await page.evaluate(()=>({typed:document.querySelector('.task-form [name=text]')?.value,inert:document.querySelector('.sheet')?.inert,inSheet:Boolean(document.activeElement?.closest('.sheet')),login:Boolean(document.querySelector('#app .login'))}));
   assert.deepEqual(after,{typed:MINE,inert:false,inSheet:true,login:false},'the sheet is as it was left, and the focus is back in it');
   assert.equal(logins,2);
   await page.click(SHEET+' .task-form .primary');await page.waitForFunction(()=>!document.querySelector('.task-form'));
   assert.equal(await page.evaluate(id=>fetch('/api/tasks').then(r=>r.json()).then(s=>s.tasks.find(t=>t.id===id).text),id),MINE,'Save after signing in keeps the edit');
   // a sheet that goes away under the cover leaves the ordinary sign-in screen, not a cover over nothing
   await page.evaluate(id=>taskEditor(taskById(id)),id);await page.waitForSelector(SHEET+' .task-form');
   out=true;await page.evaluate(()=>api('/tasks').catch(()=>{}));await page.waitForSelector('.login-over #pw');
   await page.evaluate(()=>closeCurrentSheet());
   await page.waitForFunction(()=>!document.querySelector('.login-over')&&document.querySelector('#app .login #pw')&&!document.querySelector('#app').inert);
  }finally{out=false;await post(page,'/api/tasks/reset');}
 }));

 await check('A reply started on another device shows as Working on a page already open on that conversation, with its question',PHONE,async page=>{
  let started=false,reads=0;
  const real=async u=>(await fetch(base+u.pathname+u.search)).json(),send=(r,j)=>r.respond({status:200,contentType:'application/json',body:JSON.stringify(j)});
  await intercept(page,async(r,u)=>{
   if(!started||r.method()!=='GET')return;
   if(u.pathname==='/api/sessions'){const j=await real(u),row=(j.sessions||j).find(s=>s.id===idle.id);row.state={kind:'input',label:'Needs your answer',confirmed:true,startedAt:Date.now()-2000,questions:1,queued:0};await send(r,j);return true;}
   if(u.pathname==='/api/session/'+idle.id){reads++;const j=await real(u);j.active=true;await send(r,j);return true;}
   if(u.pathname==='/api/session/'+idle.id+'/questions'){await send(r,{supported:true,requests:[{id:'request-9',blocking:true,questions:[{question:'Which colour should the label be?',options:[{label:'Blue'},{label:'Red'}]}]}]});return true;}
  });
  await openChat(page,idle.id);
  await page.waitForFunction(()=>document.querySelector('#tbar'));
  assert.equal(await page.evaluate(()=>composerWorking),false);
  started=true; // another device starts a reply, and it stops on a question
  await page.evaluate(()=>refreshSessions());
  await page.waitForFunction(()=>composerWorking&&document.querySelector('#stopb'),{timeout:6000}).catch(()=>assert.fail('the open page shows Working and Stop once the list reports the run (it stayed idle until a reload)'));
  await page.waitForFunction(()=>/Which colour/.test(document.querySelector('#questions-open')?.textContent||''),{timeout:6000}).catch(()=>assert.fail('the banner shows the question'));
  const banner=await page.$eval('#questions-open',e=>({hidden:e.hidden,text:e.textContent}));
  assert.ok(!banner.hidden&&!/0 questions/.test(banner.text),banner.text);
  const before=reads;await page.evaluate(()=>refreshSessions());await page.evaluate(()=>refreshSessions());await pause(400);
  assert.equal(reads,before,'a page that already shows the run does not read the conversation again on every list refresh');
 });

 await check('Inbox news: a conversation opened while another one\'s news is still loading asks for its own at once',PHONE,page=>withSettings({inbox:true},async()=>{
  const asked=[];const other=rows[3];
  await intercept(page,async(r,u)=>{
   if(u.pathname!=='/api/inbox/news')return;
   const id=u.searchParams.get('session');asked.push(id);
   if(id===other.id)await pause(2500); // the first conversation's answer is slow
   await r.respond({status:200,contentType:'application/json',body:'{"news":[]}'});return true;
  });
  await page.goto(base+'/?ui-fix=11#/chat/'+other.id);
  await page.waitForFunction(id=>chatId===id&&document.querySelector('#box'),{},other.id);
  const until=async(id,ms)=>{const end=Date.now()+ms;while(Date.now()<end&&!asked.includes(id))await pause(50);return asked.includes(id);};
  assert.ok(await until(other.id,2000),'the first conversation asks for its news');
  await page.evaluate(id=>{location.hash='#/chat/'+id;},idle.id);
  await page.waitForFunction(id=>chatId===id&&document.querySelector('#box'),{},idle.id);
  assert.ok(await until(idle.id,1500),'the second conversation asks for its own news while the first is still out (it waited for the 30 s refresh): '+JSON.stringify(asked));
 }));

 await check('Mark all reviewed, then Undo: a list answered before the Undo and arriving after it does not hide the rows again',PHONE,async page=>{
  let hold=0;
  await intercept(page,async(r,u)=>{
   if(u.pathname!=='/api/sessions'||!hold)return;
   const res=await fetch(r.url()),body=await res.text(),headers={};for(const k of ['etag','x-pocket-checked-at','content-type'])if(res.headers.get(k))headers[k]=res.headers.get(k);
   const ms=hold;hold=0;await pause(ms); // the server has answered; the browser gets it later
   await r.respond({status:res.status,headers,body});return true;
  });
  const done=rows.find(r=>r.state.kind==='finished')||idle;const saved=done.state,seen=done.seenAt;
  done.state={kind:'finished',label:'Response ready',at:Date.now()};delete done.seenAt;
  const unread=()=>page.evaluate(()=>allSessions.filter(canMarkReviewed).length);let n=0;
  try{
   await page.goto(base+'/?ui-fix=12#/');await page.waitForSelector('[data-filter="attention"]');
   await page.evaluate(id=>{localStorage.removeItem('pc-seen-'+id);serverSeen.delete(id);seenPending.delete(id);return refreshSessions();},done.id);
   await page.click('[data-filter="attention"]');await page.waitForSelector('[data-mark-all-reviewed]');
   n=await unread();assert.ok(n>=1,'the fixture has something to review');
   await page.click('[data-mark-all-reviewed]');await page.waitForSelector('[data-undo-reviewed]');
   await page.waitForFunction(()=>!seenPending.size&&!seenFlushing); // the marks are saved
   hold=1500;page.evaluate(()=>{sessionsEtag='';return refreshSessions();}).catch(()=>{});
   await pause(250);
   await page.click('[data-undo-reviewed]');
   await page.waitForFunction(()=>!seenRestore.size&&!seenFlushing);
   assert.equal(await unread(),n,'Undo puts them back');
   await pause(1700); // the held list has arrived
   assert.equal(hold,0);
   assert.equal(await unread(),n,'the older list does not mark them reviewed again');
   await page.evaluate(()=>refreshSessions());
   assert.equal(await unread(),n);
  }finally{done.state=saved;if(seen)done.seenAt=seen;else delete done.seenAt;}
 });

 await check('Projects: a second step entered before the first is saved is added too, not refused as a change from elsewhere',DESKTOP,page=>withSettings({projects:true},async()=>{
  const ID='warehouse-stock-report',ONE='Recount the cold room',TWO='Send the recount to purchasing';
  await page.goto(base+'/#/');await page.waitForSelector('[data-filter="all"]');await post(page,'/api/board/reset');
  await intercept(page,async(r,u)=>{if(u.pathname==='/api/board/act'&&r.method()==='POST'&&/task-add/.test(r.postData()||''))await pause(900);});
  try{
   await page.goto(base+'/?ui-fix=13#/projects/'+ID);await page.waitForSelector('.project-card [data-task-add] input');
   await page.type('[data-task-add] input',ONE);await page.keyboard.press('Enter');
   await page.type('[data-task-add] input',TWO);await page.keyboard.press('Enter'); // well inside the first one's round trip
   const steps=()=>page.evaluate(()=>[...document.querySelectorAll('.task-row .task-label span')].map(e=>e.textContent));
   const seen=[];const end=Date.now()+5000;
   while(Date.now()<end){const t=await page.$eval('#toast',e=>e.classList.contains('show')?e.textContent:'');if(t&&seen.at(-1)!==t)seen.push(t);const s=await steps();if(s.includes(ONE)&&s.includes(TWO))break;await pause(60);}
   const s=await steps();
   assert.ok(!seen.some(t=>/changed since you loaded it/.test(t)),'the owner\'s own step is not reported as a change from elsewhere: '+JSON.stringify(seen));
   assert.ok(s.includes(ONE)&&s.includes(TWO),'both steps are on the card: '+JSON.stringify(s));
   assert.ok(s.indexOf(ONE)<s.indexOf(TWO),'in the order they were entered');
   assert.equal(await page.$eval('[data-task-add] input',e=>e.value),'','and the box is empty');
  }finally{await post(page,'/api/board/reset');}
 }));

 await check('A code block keeps its first line clear of the Copy chip',PHONE,async page=>{
  await openChat(page,idle.id);
  const gaps=await page.evaluate(()=>{
   const out=[];
   for(const n of [38,44,48,60,90]){ // characters on the first line: from well short of the chip to far past it
    document.querySelector('#msgs').insertAdjacentHTML('beforeend',msgHTML({role:'assistant',blocks:[{t:'text',text:'```js\n'+'x'.repeat(n)+'\nshort();\n```'}]}));
    const wrap=[...document.querySelectorAll('#msgs .codewrap')].at(-1),pre=wrap.querySelector('pre'),chip=wrap.querySelector('.copybtn').getBoundingClientRect();
    pre.scrollLeft=pre.scrollWidth;
    const r=document.createRange(),t=pre.querySelector('code').firstChild;r.setStart(t,n-1);r.setEnd(t,n);
    out.push({n,scrolls:pre.scrollWidth>pre.clientWidth,clear:Math.round(chip.left-r.getBoundingClientRect().right)});
   }
   return out;});
  for(const g of gaps)assert.ok(g.clear>=0,`a ${g.n}-character first line can be read to its end (${-g.clear}px of it stayed under Copy${g.scrolls?', scrolled to the end':', with nothing to scroll'}): ${JSON.stringify(gaps)}`);
 });

 await check('One conversation in two windows: the box follows the shared draft, and a send from the other window is not offered for Retry',DESKTOP,async page=>{
  const boxOf=p=>p.$eval('#box',e=>e.value);let other=null;
  // Two tabs: only the front one runs animation frames, which waitForFunction polls on, so these waits poll from here.
  const until=async(p,fn,ms=3000)=>{const end=Date.now()+ms;for(;;){if(await p.evaluate(fn))return true;if(Date.now()>end)return false;await pause(60);}};
  // Coming to the front redraws the conversation (the page was away), so the box is waited for before it is used.
  const front=async p=>{await p.bringToFront();await pause(150);assert.ok(await until(p,()=>Boolean(document.querySelector('#box'))&&document.querySelector('#ctitle')?.textContent!=='Conversation'),'the conversation is drawn');};
  await intercept(page,async(r,u)=>{if(r.method()==='POST'&&u.pathname==='/api/session/'+idle.id+'/message'){await pause(1800);await r.respond({status:200,contentType:'application/json',body:'{"ok":true}'});return true;}});
  try{
   await openChat(page,idle.id);other=await page.browserContext().newPage();await other.setViewport(DESKTOP);await openChat(other,idle.id);
   await page.evaluate(id=>{localStorage.removeItem('pc-draft-'+id);localStorage.removeItem('pc-outbox-'+id);},idle.id);
   await front(page);await page.type('#box','Order the shelf labels');
   assert.ok(await until(other,()=>document.querySelector('#box').value==='Order the shelf labels'),'what is typed in one window shows in the other (it stayed empty until redrawn, then overwrote): '+JSON.stringify(await boxOf(other)));
   await front(other);await other.type('#box',' today');
   assert.ok(await until(page,()=>document.querySelector('#box').value==='Order the shelf labels today'),'and the other way, carrying on from the end: '+JSON.stringify(await boxOf(page)));
   await front(page);await page.click('#send'); // this window's send takes 1.8 s
   await pause(300);
   await other.evaluate(()=>{renderChat(chatId);}); // the other window is left and come back to
   assert.ok(await until(other,()=>Boolean(document.querySelector('#delivery-status')?.textContent)&&Boolean(document.querySelector('#box')),1200),'the other window says a send is on its way');
   const during=await other.evaluate(()=>({text:document.querySelector('#delivery-status').textContent,retry:Boolean(document.querySelector('#retry-message')),readOnly:document.querySelector('#box').readOnly}));
   assert.deepEqual(during,{text:'Sending from another window…',retry:false,readOnly:false},'a send on its way from the other window is not "Delivery was not confirmed"');
   assert.ok(await until(other,()=>!localStorage.getItem('pc-outbox-'+chatId)&&!document.querySelector('#retry-message')&&!/Sending/.test(document.querySelector('#delivery-status').textContent),5000),'the line goes when it is delivered');
   assert.equal(await boxOf(other),'','and the other window\'s box is empty too');
  }finally{await other?.close();await page.evaluate(id=>{localStorage.removeItem('pc-draft-'+id);localStorage.removeItem('pc-outbox-'+id);},idle.id);}
 });

 // Voice: count the microphone tracks the page holds, and answer the recogniser with silence so nothing is sent.
 const voicePage=async page=>{
  await page.evaluateOnNewDocument(()=>{const real=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.__mics=[];
   navigator.mediaDevices.getUserMedia=async c=>{const s=await real(c);window.__mics.push(s);return s;};
   window.__live=()=>window.__mics.flatMap(s=>s.getTracks()).filter(t=>t.readyState==='live').length;});
  await intercept(page,async(r,u)=>{if(u.pathname==='/api/voice/transcribe'){await r.respond({status:200,contentType:'application/json',body:'{"text":""}'});return true;}});
  await openChat(page,idle.id);await page.waitForSelector('#micb:not([hidden])');
 };
 const centre=async(page,sel)=>{const b=await (await page.$(sel)).boundingBox();return [b.x+b.width/2,b.y+b.height/2];};

 await check('Voice: a tap on the mic while it is listening finishes the recording',PHONE,async page=>{
  await voicePage(page);
  const [x,y]=await centre(page,'#micb');
  await page.touchscreen.tap(x,y);
  await page.waitForFunction(()=>Voice._test.state()==='listening');
  assert.match(await page.$eval('#voice-strip',e=>e.textContent),/Tap the mic when you.re done/);
  await page.touchscreen.tap(x,y); // well inside the first second, before silence could end it by itself
  await pause(250);
  assert.notEqual(await page.evaluate(()=>Voice._test.state()),'listening','a finger tap ends the recording (only the keyboard did)');
  await page.waitForFunction(()=>window.__live()===0);
 });

 await check('Voice: Mute closes a hands-free microphone, in this tab and in another one',PHONE,async page=>{
  await voicePage(page);
  const listening=async()=>{await page.click('#hfb');await page.waitForFunction(id=>Voice._test.state()==='listening'&&Voice._test.handsFree()===id,{},idle.id);assert.equal(await page.evaluate(()=>window.__live()),1);};
  const quiet=()=>page.evaluate(()=>({state:Voice._test.state(),handsFree:Voice._test.handsFree(),live:window.__live(),muted:Voice.isMuted()}));
  await listening();
  await page.evaluate(()=>Voice.setMuted(true)); // what the Voice chip does
  assert.deepEqual(await quiet(),{state:'idle',handsFree:null,live:0,muted:true},'muting ends the conversation and closes the microphone (it stayed open, "Listening")');
  await page.evaluate(()=>Voice.setMuted(false));
  await listening();
  const other=await page.browserContext().newPage();
  try{
   await other.goto(base+'/#/chat/'+idle.id);await other.waitForFunction(()=>typeof Voice!=='undefined'&&document.querySelector('#box'));
   await other.evaluate(()=>Voice.setMuted(true));
   await page.waitForFunction(()=>Voice._test.state()==='idle'&&window.__live()===0);
   assert.deepEqual(await quiet(),{state:'idle',handsFree:null,live:0,muted:true},'a mute from another tab reaches this one');
  }finally{await other.close();}
 });

 assert.deepEqual(errors,[],'no page errors');
 fs.writeFileSync(path.join(out,'ui-test-fixes.json'),JSON.stringify({checks},null,2));
 console.log(JSON.stringify({uiTestFixes:checks.length,ok:true}));
}
