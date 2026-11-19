// 1.113.1 The conversation an Inbox entry started catches up: the line under the latest reply when the entry got more mail,
// Bring it in (sends the news as the next message and marks the conversation caught up), Not now (until more mail), the
// count wording, a phone, and the entry sheet's sub-lines. Runs against browser.mjs's fixtures (/api/inbox/news-fixture).
// POCKET_DESIGN_SCANNER: the impeccable detector on each scanned view; its findings are written beside the screenshots.
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
export async function runInboxNewsRegressions({browser,base,rows,out,settings,received,inboxStore,inboxCaughtUp,conversations}) {
 const context=await browser.createBrowserContext(),page=await context.newPage();page.setDefaultTimeout(8000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 const sid=rows.find(r=>r.state.kind==='finished').id,kept=[...(conversations.get(sid)||[])];
 const scan=async(name,sel)=>{const s=await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});await s.evaluate(e=>e.remove());const r=await page.evaluate(sel=>axe.run(sel,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']}}),sel);assert.deepEqual(r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],name);await page.screenshot({path:path.join(out,'inbox-news-'+name+'.png')});if(process.env.POCKET_DESIGN_SCANNER){await page.evaluate(()=>{window.__IMPECCABLE_CONFIG__={autoScan:false};});if(!await page.evaluate(()=>Boolean(window.impeccableDetectAsync))){const t=await page.addScriptTag({path:process.env.POCKET_DESIGN_SCANNER});await t.evaluate(e=>e.remove());}const r=await page.evaluate(()=>window.impeccableDetectAsync({scrollOffscreen:false}));const fs=await import('node:fs');fs.writeFileSync(path.join(out,'inbox-news-design-'+name+'.json'),JSON.stringify(r,null,1));}};
 const fixture=(q)=>fetch(base+'/api/inbox/news-fixture?session='+encodeURIComponent(sid)+'&'+q).then(r=>r.json());
 let visit=0;const open=async(width)=>{await page.setViewport({width,height:width<900?844:900});await page.goto(base+'/?news='+width+'-'+(++visit)+'#/chat/'+sid);await page.waitForSelector('#msgs .m-asst');};
 const line=()=>page.$eval('#msgs',m=>{const o=m.querySelector('.inbox-news');return o?{text:o.querySelector('.handoff-offer-text').textContent,afterReply:Boolean(o.previousElementSibling?.matches('.m-asst, .try-harder, .handoff-offer')),bring:o.querySelector('[data-news-bring]').textContent.trim(),later:o.querySelector('[data-news-later]').textContent.trim()}:null;});
 const prevInbox=settings.inbox;
 try{
  settings.inbox=true;
  await fetch(base+'/api/inbox/reset');
  console.log('Inbox catch-up: no line while the entry has nothing new');
  await fixture('n=0&start=0123456789f0');
  await open(1440);await new Promise(r=>setTimeout(r,400));
  assert.equal(await line(),null,'started from it, nothing since: no line');

  console.log('Inbox catch-up: more mail on the story shows the line under the latest reply');
  await fixture('n=1&start=0123456789f0');
  await open(1440);await page.waitForSelector('.inbox-news');
  const l=await line();
  assert.match(l.text,/^New mail on this story since you started: Harbor gate: tech on site at 2 pm, \d{1,2}:\d\d\s[ap]m\.$/u);
  assert.deepEqual([l.afterReply,l.bring,l.later],[true,'Bring it in','Not now']);
  await scan('line-1440','#msgs');

  console.log('Inbox catch-up: Not now holds until more mail comes');
  await page.click('[data-news-later]');await page.waitForFunction(()=>!document.querySelector('.inbox-news'));
  await open(1440);await new Promise(r=>setTimeout(r,400));assert.equal(await line(),null,'still hidden after a reload');
  await fixture('n=1&start=0123456789f0');
  await open(1440);await page.waitForSelector('.inbox-news');
  assert.match((await line()).text,/^2 updates on this story since you started\. The latest: Harbor gate: tech on site at 2 pm, /,'more mail brings it back, counted');

  console.log('Inbox catch-up: Bring it in sends the news as the next message and marks the conversation caught up');
  const before=received.length;
  await page.click('[data-news-bring]');
  await page.waitForFunction(n=>document.querySelectorAll('#msgs .m-user').length>=n,{},1);
  await page.waitForFunction(()=>!document.querySelector('.inbox-news'));
  const sent=received.slice(before).find(b=>typeof b.text==='string'&&b.text.startsWith('New on this Inbox story'));
  assert.ok(sent,'the news went as a message');
  assert.match(sent.text,/^New on this Inbox story since this conversation started \("Harbor gate: tech on site at 2 pm"\):\n\nUpdate, 2:14 PM EST: Harbor gate: tech on site at 2 pm\nMike is on site at 2 pm\. \[Mike\]\(msg:19b03\)\n/);
  assert.equal(sent.text.match(/^Update, /gm).length,2,'both updates, oldest first');
  assert.match(sent.text,/Gmail: https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/19b0000000000000/);
  assert.match(sent.text,/Read what is new, check it against what we have so far, and tell me in a few lines what it changes\.$/);
  const entry=inboxStore.entries.find(e=>e.story==='harbor-gate-0123456789f0');
  assert.deepEqual(inboxCaughtUp.at(-1),{session:sid,id:entry.id,upTo:entry.newsN});
  assert.deepEqual(inboxStore.newsFor(sid),[],'caught up on the server');
  conversations.set(sid,[...kept]);

  console.log('Inbox catch-up: the entry sheet says the conversation is behind, and Start another is the second choice');
  await fixture('n=2&start=0123456789f1');
  const other=inboxStore.entries.find(e=>e.story==='harbor-gate-0123456789f1');
  await page.evaluate(async()=>{await loadInbox(true);});
  await page.evaluate(id=>inboxSheet(id),other.id);await page.waitForSelector('.inbox-sheet [data-chat]');
  const subs=await page.$eval('.inbox-sheet',s=>({open:s.querySelector('[data-chat] .sub').textContent,start:s.querySelector('[data-go] .sub')?.textContent||''}));
  assert.match(subs.open,/^Started .*\. New mail since then: it offers to bring it in$/);
  assert.equal(subs.start,'A separate conversation on the same story; the one above can catch up instead');
  await scan('sheet-1440','.inbox-sheet');
  await page.keyboard.press('Escape');

  console.log('Inbox catch-up: a phone wraps the line with 44px targets');
  await open(390);await page.waitForSelector('.inbox-news');
  assert.match((await line()).text,/^2 updates on this story since you started\. The latest: Harbor gate: fixed, /);
  const fits=await page.$eval('.inbox-news',e=>{const r=e.getBoundingClientRect();return r.right<=innerWidth&&[...e.querySelectorAll('button')].every(b=>b.getBoundingClientRect().height>=44);});
  assert.ok(fits,'inside the phone width, 44px targets');
  await page.$eval('.inbox-news',e=>e.scrollIntoView({block:'center'}));await new Promise(r=>setTimeout(r,150));
  await scan('line-390','#msgs');

  console.log('Inbox catch-up: what you are typing is never replaced');
  await page.type('#box','draft');const n=received.length;
  await page.click('[data-news-bring]');await new Promise(r=>setTimeout(r,300));
  assert.equal(received.length,n,'nothing sent over a draft');assert.ok(await page.$('.inbox-news'),'the line stays');
  assert.equal(await page.$eval('#box',e=>e.value),'draft');
  assert.deepEqual(errors,[]);
 }finally{settings.inbox=prevInbox;conversations.set(sid,kept);await fetch(base+'/api/inbox/reset').catch(()=>{});await context.close();}
}
