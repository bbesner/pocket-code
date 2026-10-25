// 1.78 Side chat in the browser: the dock on a wide window, the sheet on a phone, /btw, the shortcut, a reopen that
// replays the side chat, side chat on Codex too, and (1.79) Branch: hover text that tells the two apart, the sheet, the
// cross-links and the Branch of … line. Runs against browser.mjs's scripted side chat and branch fixtures.
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
export async function runSideChatRegressions({browser,base,rows,out,side,conversations}) {
 const context=await browser.createBrowserContext(),page=await context.newPage();page.setDefaultTimeout(8000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 const id=rows.find(r=>r.state.kind==='finished').id,cx=rows.find(r=>r.provider==='codex').id;
 const scan=async(name,sel='.side-sheet')=>{const s=await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});await s.evaluate(e=>e.remove());const r=await page.evaluate(sel=>axe.run(sel,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']}}),sel);assert.deepEqual(r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],name);await page.screenshot({path:path.join(out,'side-chat-'+name+'.png')});};
 const answers=()=>page.$$eval('.side-msgs .m-asst:not(.live)',es=>es.map(e=>e.textContent.trim()));
 const open=async(width,hash)=>{await page.setViewport({width,height:width<900?844:900});await page.goto(base+'/?side='+width+'#/chat/'+hash);await page.waitForSelector('#msgs .m-asst');};
 try{
  console.log('Side chat: dock at 1440');
  await open(1440,id);
  const mainBefore=await page.$$eval('#msgs > *',es=>es.length);
  // 1.78.2: on a desktop the button sits with Add task and Add project; the header icon is for phones.
  assert.equal(await page.$eval('#sideb',e=>e.getClientRects().length),0,'no header icon on a desktop');
  assert.equal(await page.$eval('#side-open',e=>[e.textContent.trim(),e.getAttribute('aria-pressed')].join('|')),'Side chat|false');
  await page.click('#side-open');await page.waitForSelector('.workspace-dock.side-sheet');
  assert.equal(await page.$eval('#side-open',e=>e.getAttribute('aria-pressed')),'true','pressed while the side chat is open');
  assert.equal(await page.$eval('.dock-tabs [data-dock=side]',e=>e.getAttribute('aria-pressed')),'true','the dock names the side chat');
  assert.equal(await page.$eval('.side-empty',e=>!e.hidden),true,'an empty side chat says what it is for');
  assert.equal(await page.evaluate(()=>document.activeElement.matches('.side-compose textarea')),true,'focus goes to the question box');
  await page.type('.side-compose textarea','Why reorder the cameras?');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>/Side answer: Why reorder the cameras\?/.test(document.querySelector('.side-msgs')?.textContent||''));
  await page.waitForFunction(()=>/\$0\.25 so far/.test(document.querySelector('.side-status').textContent));
  assert.equal(side.posts.at(-1).path,'/api/session/'+id+'/side');assert.equal(side.posts.at(-1).side,undefined,'the first question starts a side chat');
  assert.equal(await page.$eval('.side-compose textarea',e=>e.value),'','the box clears');
  assert.equal(await page.$$eval('#msgs > *',es=>es.length),mainBefore,'nothing is added to the conversation');
  await page.type('.side-compose textarea','And the recorder?');await page.click('.side-send');
  await page.waitForFunction(()=>document.querySelectorAll('.side-msgs .m-asst:not(.live)').length===2);
  assert.equal(side.posts.at(-1).side,side.id,'a follow-up goes to the same side chat');
  assert.match(await page.$eval('.side-status',e=>e.textContent),/Opus 5\.5 · \$0\.50 so far/);
  await scan('dock-1440');
  console.log('Side chat: shortcut closes and reopens with the history');
  await page.keyboard.down('Control');await page.keyboard.press(';');await page.keyboard.up('Control');
  await page.waitForFunction(()=>!document.querySelector('.side-sheet'));
  await page.waitForFunction(()=>document.querySelector('#side-open').getAttribute('aria-pressed')==='false');
  await page.keyboard.down('Control');await page.keyboard.press(';');await page.keyboard.up('Control');
  await page.waitForFunction(()=>document.querySelectorAll('.side-msgs .m-asst:not(.live)').length===2);
  assert.deepEqual(await answers(),['Side answer: Why reorder the cameras?','Side answer: And the recorder?']);
  console.log('Side chat: a reload replays it from the server');
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.workspace-dock.side-sheet .side-msgs .m-asst:not(.live)').length===2);
  console.log('Side chat: New side chat clears it');
  await page.click('[data-side-new]');await page.waitForFunction(()=>!document.querySelector('.side-msgs').children.length);
  assert.equal(side.live,false,'the old side chat is ended on the server');
  assert.equal(await page.$eval('.side-empty',e=>!e.hidden),true);
  await page.click('.dock-tabs [data-close-dock]');

  console.log('Side chat: sheet at 390 from Conversation options, and /btw');
  await open(390,id);
  assert.ok(await page.$eval('#sideb',e=>e.getClientRects().length)>0,'a phone keeps the header icon');
  assert.equal(await page.$eval('#side-open',e=>e.getClientRects().length),0,'and no button in the scrolling chip row');
  assert.equal(await page.$eval('#branch-open',e=>e.getClientRects().length),0,'no Branch chip on a phone either');
  await page.click('#chatmore');await page.waitForSelector('#so-branch');
  const rows=await page.$$eval('#so-side .sub,#so-branch .sub',es=>es.map(e=>e.textContent));
  assert.deepEqual(rows,['Ask a quick question about this conversation. Nothing is saved and nothing changes.','Start a new saved conversation that carries on from here and can do work. This one stays as it is.'],'the menu says how they differ');
  await page.click('#so-side');await page.waitForSelector('.sheet.side-sheet');
  const box=await page.$eval('.sheet.side-sheet',e=>{const r=e.getBoundingClientRect();return {h:r.height,w:r.width};});
  assert.ok(box.h>=844-30&&box.w===390,'a phone gets a full-height sheet: '+JSON.stringify(box));
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.side-sheet'));
  await page.type('#box','/btw what changed?');await page.click('#send');
  await page.waitForFunction(()=>/Side answer: what changed\?/.test(document.querySelector('.side-msgs')?.textContent||''));
  assert.equal(side.posts.at(-1).text,'what changed?');assert.equal(await page.$eval('#box',e=>e.value),'','the message box clears');
  assert.equal(conversations.get(id).some(m=>/what changed/.test(m.text||'')),false,'/btw never reaches the conversation');
  await scan('sheet-390');
  await page.keyboard.press('Escape');

  console.log('Side chat and Branch: hover text tells them apart; Branch sheet; cross-links; Branch of');
  await page.setViewport({width:1440,height:900});await open(1440,id);
  const tipOf=async sel=>{await page.hover(sel);await page.waitForFunction(()=>!document.getElementById('tip').hidden);const t=await page.$eval('#tip',e=>e.textContent);await page.mouse.move(5,5);await page.waitForFunction(()=>document.getElementById('tip').hidden);return t;};
  assert.equal(await tipOf('#side-open'),'Side chat (Ctrl+;): Ask a quick question about this conversation. Nothing is saved and nothing changes.');
  assert.equal(await tipOf('#branch-open'),'Branch: Start a new saved conversation that carries on from here and can do work. This one stays as it is.');
  await page.click('#branch-open');await page.waitForSelector('.branch-sheet');
  assert.match(await page.$eval('.branch-sheet',e=>e.textContent),/carries on from here[\s\S]*Only want to ask something\?/);
  await page.type('#branch-text','Is the count right?');await page.click('[data-branch-side]');
  await page.waitForSelector('.workspace-dock.side-sheet');
  const asked=side.posts.length;
  await page.waitForFunction(()=>document.querySelector('.side-compose textarea').value==='Is the count right?');
  assert.equal(side.posts.length,asked,'moved over, not sent: you press Ask');
  await page.click('[data-side-branch]');await page.waitForSelector('.branch-sheet');
  assert.equal(await page.$eval('#branch-text',e=>e.value),'Is the count right?','and back to Branch');
  await scan('branch-1440','.branch-sheet');
  await page.$eval('#branch-text',e=>e.value='');await page.type('#branch-text','Write the export script');
  await page.click('[data-branch-start]');
  const child='55555555-5555-4555-8555-555555555555';
  await page.waitForFunction(c=>location.hash==='#/chat/'+c,{},child);
  assert.equal(side.branchPosts.at(-1).parent,id);assert.equal(side.branchPosts.at(-1).text,'Write the export script');assert.ok(side.branchPosts.at(-1).clientMessageId);
  await page.waitForSelector('#lineage:not([hidden])');
  assert.equal(await page.$eval('#lineage',e=>e.textContent),'Branch of '+side.lineage[child].branchOf.title);
  await page.click('#lineage a');await page.waitForFunction(i=>location.hash==='#/chat/'+i,{},id);
  await page.waitForFunction(()=>/Branch: Write the export script/.test(document.querySelector('#lineage:not([hidden])')?.textContent||''));

  console.log('Side chat and Branch: offered on Codex too');
  await page.goto(base+'/?side=cx#/chat/'+cx);await page.waitForSelector('#chatmore');
  assert.ok(await page.$eval('#side-open',e=>!e.hidden)&&await page.$eval('#branch-open',e=>!e.hidden),'both on a Codex conversation');
  assert.deepEqual(errors,[]);
 } finally { await context.close(); }
}
