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

export async function runUiTestFixes({browser,base,rows,out}) {
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

 assert.deepEqual(errors,[],'no page errors');
 fs.writeFileSync(path.join(out,'ui-test-fixes.json'),JSON.stringify({checks},null,2));
 console.log(JSON.stringify({uiTestFixes:checks.length,ok:true}));
}
