// 1.113.1 The conversation an Inbox entry started catches up when the entry gets more mail.
// 1.115 The news is a card in the Complete card's place (never both), with Bring it in, New conversation and Not now; the
// list row and tab read New mail instead of Complete; and the Inbox entry's sheet offers the three ways on before the
// conversation opens: continue it, a new conversation by hand-off, or a new conversation on a separate subject.
// Runs against browser.mjs's fixtures (/api/inbox/news-fixture). POCKET_INBOX_NEWS_ONLY=1 runs these checks alone.
// POCKET_DESIGN_SCANNER: the impeccable detector on each scanned view; its findings are written beside the screenshots.
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const SUMMARY='Told the gate vendor the controller is offline; nothing else open';
export async function runInboxNewsRegressions({browser,base,rows,out,settings,received,inboxStore,inboxCaughtUp,inboxSplits,conversations}) {
 const context=await browser.createBrowserContext(),page=await context.newPage();page.setDefaultTimeout(8000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 const row=rows.find(r=>r.state.kind==='finished'),sid=row.id,kept=[...(conversations.get(sid)||[])],saved={state:row.state,seenAt:row.seenAt,mtimeMs:row.mtimeMs};
 const scan=async(name,sel)=>{const s=await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});await s.evaluate(e=>e.remove());const r=await page.evaluate(sel=>axe.run(sel,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']}}),sel);assert.deepEqual(r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],name);await page.screenshot({path:path.join(out,'inbox-news-'+name+'.png')});if(process.env.POCKET_DESIGN_SCANNER){await page.evaluate(()=>{window.__IMPECCABLE_CONFIG__={autoScan:false};});if(!await page.evaluate(()=>Boolean(window.impeccableDetectAsync))){const t=await page.addScriptTag({path:process.env.POCKET_DESIGN_SCANNER});await t.evaluate(e=>e.remove());}const r=await page.evaluate(()=>window.impeccableDetectAsync({scrollOffscreen:false}));const fs=await import('node:fs');fs.writeFileSync(path.join(out,'inbox-news-design-'+name+'.json'),JSON.stringify(r,null,1));}};
 const fixture=(q)=>fetch(base+'/api/inbox/news-fixture?session='+encodeURIComponent(sid)+'&'+q).then(r=>r.json());
 let visit=0;const open=async(width,hash='#/chat/'+sid)=>{await page.setViewport({width,height:width<900?844:900});await page.goto(base+'/?news='+width+'-'+(++visit)+hash);if(hash.startsWith('#/chat/'))await page.waitForSelector('#msgs .m-asst');};
 const theme=async mode=>{await page.evaluate(m=>PocketTheme.setPreference(m),mode);await page.waitForFunction(m=>(document.documentElement.dataset.theme==='light')===(m==='light'),{},mode);};
 // The server's side of a reply that ended with a done block (as complete-browser.mjs): Complete in the outcome and the transcript.
 const complete=()=>{row.state={kind:'finished',label:'Complete',done:true,summary:SUMMARY,at:Date.now(),confirmed:true};delete row.seenAt;row.mtimeMs=row.state.at;
  conversations.set(sid,[{role:'user',text:'Tell the gate vendor.'},{role:'assistant',blocks:[{t:'text',text:'The vendor has the report and a tech is being scheduled.'},{t:'done',text:SUMMARY}]}]);};
 const card=()=>page.$eval('#msgs',m=>{const o=m.querySelector('.inbox-news');if(!o)return null;const t=o.querySelector('.news-title'),w=t.querySelector('.news-when');
  return {title:t.firstChild.textContent,when:w?w.textContent:'',sum:o.querySelector('.news-sum').textContent,size:o.querySelector('.news-size')?.textContent||'',
   buttons:[...o.querySelectorAll('button')].map(b=>b.textContent.trim()),
   afterReply:Boolean(o.previousElementSibling?.matches('.m-asst, .m-user, .try-harder'))&&![...m.querySelectorAll('.m-asst:not(.live), .m-user')].some(x=>o.compareDocumentPosition(x)&Node.DOCUMENT_POSITION_FOLLOWING)};});
 const doneShown=()=>page.$eval('#msgs',m=>Boolean(m.querySelector('.done-card:not([hidden])')));
 const listRow=()=>page.evaluate(id=>{const r=document.querySelector(`.session-item[data-item="${id}"]`);return r?{label:r.querySelector('.session-status').firstChild?.textContent||'',detail:r.querySelector('.activity-detail').textContent,tick:Boolean(r.querySelector('.done-close'))}:null;},sid);
 const tabLabel=()=>page.evaluate(id=>document.querySelector(`.open-session[data-tab="${id}"] .tab-state`)?.getAttribute('aria-label')||'',sid);
 const sentSince=(n,re)=>received.slice(n).find(b=>typeof b.text==='string'&&re.test(b.text));
 const until=async(fn,what)=>{for(let i=0;i<80&&!await fn();i++)await new Promise(r=>setTimeout(r,50));assert.ok(await fn(),what);};
 const prevInbox=settings.inbox;
 try{
  settings.inbox=true;
  await fetch(base+'/api/inbox/reset');
  console.log('Inbox news: no card while the entry has nothing new');
  await fixture('n=0&start=0123456789f0');
  await open(1440);await new Promise(r=>setTimeout(r,400));
  assert.equal(await card(),null,'started from it, nothing since: no card');

  console.log('Inbox news: more mail on the story shows the card under the latest reply, in the Complete card’s place');
  complete();
  await fixture('n=1&start=0123456789f0');
  await open(1440);await page.waitForSelector('.inbox-news');
  const c=await card();
  assert.equal(c.title,'New mail on this story');assert.match(c.when,/^ · \d{1,2}:\d\d\s[ap]m$/u);
  assert.equal(c.sum,'Kai is on site at 2 pm.','what the mail says, not the conversation’s own title');
  assert.deepEqual([c.afterReply,c.buttons,c.size],[true,['Bring it in','New conversation','Not now'],'']);
  assert.equal(await doneShown(),false,'a conversation with mail it has not read is not finished: no Complete card');
  const look=await page.$eval('.inbox-news',o=>{const probe=document.createElement('i');probe.style.color=getComputedStyle(document.documentElement).getPropertyValue('--clay').trim();document.body.append(probe);const clay=getComputedStyle(probe).color;probe.remove();
   return {badge:getComputedStyle(o.querySelector('.news-mark')).backgroundColor===clay,bring:getComputedStyle(o.querySelector('.news-bring')).backgroundColor===clay,chip:getComputedStyle(o.querySelector('[data-news-new]')).backgroundColor===clay};});
  assert.deepEqual(look,{badge:true,bring:true,chip:false},'clay: the badge and the one button that sends');
  const lr=await listRow();
  assert.deepEqual(lr,{label:'New mail',detail:'Harbor gate: tech on site at 2 pm',tick:false},'the list row says New mail, not Complete, and has no one-tap close');
  assert.equal(await page.$eval('#run-confirmed-state',e=>e.textContent),'New mail','the header does not say Complete either');
  assert.equal(await tabLabel(),'New mail','nor the tab');
  await theme('dark');await scan('card-1440','#msgs');
  await theme('light');await scan('card-1440-light','#msgs');await theme('dark');

  console.log('Inbox news: Not now puts the Complete card back until more mail comes');
  await page.click('[data-news-later]');await page.waitForFunction(()=>!document.querySelector('.inbox-news'));
  assert.equal(await doneShown(),true,'Complete again');
  await until(async()=>(await listRow())?.label!=='New mail','the list row stops saying New mail');
  await open(1440);await new Promise(r=>setTimeout(r,400));assert.equal(await card(),null,'still put off after a reload');
  await fixture('n=1&start=0123456789f0');
  await open(1440);await page.waitForSelector('.inbox-news');
  const two=await card();
  assert.equal(two.title,'2 new on this story');assert.match(two.when,/^ · latest \d{1,2}:\d\d\s[ap]m$/u);
  assert.equal(await doneShown(),false);

  console.log('Inbox news: Bring it in sends the news as the next message and marks the conversation caught up');
  let before=received.length;
  await page.click('[data-news-bring]');
  await page.waitForFunction(()=>!document.querySelector('.inbox-news'));
  await until(()=>sentSince(before,/^New on this Inbox story/),'the news went as a message');
  const sent=sentSince(before,/^New on this Inbox story/);
  assert.match(sent.text,/^New on this Inbox story since this conversation started \("Harbor gate: tech on site at 2 pm"\):\n\nUpdate, 2:14 PM EST: Harbor gate: tech on site at 2 pm\nMike is on site at 2 pm\. \[Kai\]\(msg:19b03\)\n/);
  assert.equal(sent.text.match(/^Update, /gm).length,2,'both updates, oldest first');
  assert.match(sent.text,/Read what is new, check it against what we have so far, and tell me in a few lines what it changes\.$/);
  const entry=inboxStore.entries.find(e=>e.story==='harbor-gate-0123456789f0');
  await until(()=>inboxCaughtUp.at(-1)?.id===entry.id,'caught-up told');
  assert.deepEqual(inboxCaughtUp.at(-1),{session:sid,id:entry.id,upTo:entry.newsN});
  assert.deepEqual(inboxStore.newsFor(sid),[],'caught up on the server');
  conversations.set(sid,[...kept]);

  console.log('Inbox news: the entry sheet offers the three ways on, before anything is sent');
  await fixture('n=2&start=0123456789f1');
  const second=inboxStore.entries.find(e=>e.story==='harbor-gate-0123456789f1');
  await open(1440,'#/inbox');await page.evaluate(async()=>{await loadInbox(true);});
  await page.evaluate(id=>inboxSheet(id),second.id);await page.waitForSelector('.inbox-sheet [data-continue]');
  const opts=await page.$eval('.inbox-sheet',s=>[...s.querySelectorAll('.opt')].slice(0,3).map(o=>({label:o.querySelector('span').firstChild.textContent,sub:o.querySelector('.sub').textContent})));
  assert.deepEqual(opts.map(o=>o.label),['Continue the conversation','New conversation, hand-off from the last one','New conversation, separate subject']);
  assert.match(opts[0].sub,/^Brings the new mail into it\. Started /);
  assert.equal(opts[1].sub,'The last one writes a briefing with the new mail in it, and a fresh conversation starts from that');
  assert.equal(opts[2].sub,'The new mail becomes its own Inbox entry with its own conversation, and the watcher keeps the two apart');
  assert.equal(await page.$('.inbox-sheet [data-go]'),null,'no fourth way to start one while the conversation is behind');
  await scan('sheet-1440','.inbox-sheet');
  await theme('light');await scan('sheet-1440-light','.inbox-sheet');await theme('dark');

  console.log('Inbox news: Continue the conversation opens it and brings the mail in');
  before=received.length;
  await page.click('.inbox-sheet [data-continue]');
  await page.waitForFunction(id=>location.hash==='#/chat/'+id,{},sid);
  await until(()=>sentSince(before,/^New on this Inbox story since this conversation started \("Harbor gate: fixed"\)/),'the choice on the sheet sent the news');
  await until(()=>inboxStore.newsFor(sid).length===0,'and the conversation is caught up');
  conversations.set(sid,[...kept]);

  console.log('Inbox news: hand-off from the sheet asks the conversation for a briefing with the new mail in it');
  await fixture('n=1&start=0123456789f2');
  const third=inboxStore.entries.find(e=>e.story==='harbor-gate-0123456789f2');
  await open(1440,'#/inbox');await page.evaluate(async()=>{await loadInbox(true);});
  await page.evaluate(id=>inboxSheet(id),third.id);await page.waitForSelector('.inbox-sheet [data-handoff]');
  before=received.length;
  await page.click('.inbox-sheet [data-handoff]');
  await until(()=>sentSince(before,/^New on this Inbox story/),'the hand-off request went as a message');
  const ask=sentSince(before,/^New on this Inbox story/).text;
  assert.match(ask,/Update, 2:14 PM EST: Harbor gate: tech on site at 2 pm\n/);
  assert.match(ask,/Do not work on this here\. Hand this off: write a briefing for a new conversation to pick up from here, with this new mail as the first thing it deals with, and give me the handoff card\.$/);
  await until(()=>inboxStore.newsFor(sid).length===0,'the mail is in its context, so it is not offered again');
  conversations.set(sid,[...kept]);
  // the conversation that continues it takes its place on the entry (the server calls linkHandoff when the card starts)
  inboxStore.linkHandoff(sid,'22222222-2222-4222-8222-222222222222');
  await until(()=>page.evaluate(async id=>{await loadInbox(true);return inboxSession(inboxById(id)).id==='22222222-2222-4222-8222-222222222222';},third.id),'the entry opens the conversation that took over');

  console.log('Inbox news: New conversation on the card offers hand-off or a separate subject; a separate subject splits the mail off');
  await fixture('n=1&start=0123456789f3');
  const fourth=inboxStore.entries.find(e=>e.story==='harbor-gate-0123456789f3');
  await open(1440);await page.waitForSelector('.inbox-news');
  await page.click('[data-news-new]');await page.waitForSelector('.sheet [data-split]');
  const two2=await page.$eval('.sheet',s=>[...s.querySelectorAll('.opt')].map(o=>o.querySelector('span').firstChild.textContent));
  assert.deepEqual(two2,['Hand-off from this one','Separate subject']);
  await scan('new-sheet-1440','.sheet');
  before=received.length;const splitsBefore=inboxSplits.length;
  await page.click('.sheet [data-split]');
  await until(()=>inboxSplits.length>splitsBefore,'the split was asked for');
  assert.deepEqual(inboxSplits.at(-1),{id:fourth.id,session:sid});
  const off=inboxStore.entries.find(e=>e.splitFrom===fourth.id);
  assert.ok(off,'the mail is an entry of its own');
  assert.deepEqual([off.title,off.state,off.url,fourth.title],['Harbor gate: tech on site at 2 pm','opened','/#/start/0123456789c5','Harbor HOA gate down'],'and the entry it left says what it said before');
  assert.notEqual(off.story,fourth.story);
  await page.waitForFunction(()=>/0123456789c5/.test(location.hash));
  assert.equal(sentSince(before,/Inbox story/),undefined,'nothing was sent to the old conversation');
  assert.deepEqual(inboxStore.newsFor(sid).filter(n=>n.id===fourth.id),[],'and it has nothing left to catch up on');

  console.log('Inbox news: an entry whose conversation is up to date offers Open, hand-off and Start another');
  await open(1440,'#/inbox');await page.evaluate(async()=>{await loadInbox(true);});
  await page.evaluate(id=>inboxSheet(id),fourth.id);await page.waitForSelector('.inbox-sheet [data-chat]');
  const calm=await page.$eval('.inbox-sheet',s=>[...s.querySelectorAll('.opt')].slice(0,3).map(o=>({label:o.querySelector('span').firstChild.textContent,sub:o.querySelector('.sub').textContent})));
  assert.deepEqual(calm.map(o=>o.label),['Open the conversation','New conversation, hand-off from the last one','Start another conversation']);
  assert.equal(calm[1].sub,'The last one writes a briefing, and a fresh conversation starts from that');
  assert.equal(calm[2].sub,'Briefed with this entry only; nothing from the conversation above');
  await page.keyboard.press('Escape');

  console.log('Inbox news: a phone stacks the card with 44px targets');
  complete();
  await fixture('n=2&start=0123456789f4');
  await open(390);await page.waitForSelector('.inbox-news');
  assert.equal((await card()).title,'2 new on this story');
  const fits=await page.$eval('.inbox-news',e=>{const r=e.getBoundingClientRect(),b=e.querySelector('.news-bring').getBoundingClientRect();return {inside:r.right<=innerWidth&&r.left>=0,tall:[...e.querySelectorAll('button')].every(x=>x.getBoundingClientRect().height>=44),wide:b.width>=r.width-40};});
  assert.deepEqual(fits,{inside:true,tall:true,wide:true},'inside the phone width, 44px targets, Bring it in full width');
  assert.equal(await doneShown(),false);
  await page.$eval('.inbox-news',e=>e.scrollIntoView({block:'center'}));await new Promise(r=>setTimeout(r,150));
  await scan('card-390','#msgs');
  await theme('light');await scan('card-390-light','#msgs');await theme('dark');

  console.log('Inbox news: what you are typing is never replaced');
  await page.type('#box','draft');const n=received.length;
  await page.click('[data-news-bring]');await new Promise(r=>setTimeout(r,300));
  assert.equal(received.length,n,'nothing sent over a draft');assert.ok(await page.$('.inbox-news'),'the card stays');
  assert.equal(await page.$eval('#box',e=>e.value),'draft');
  assert.deepEqual(errors,[]);
 }finally{settings.inbox=prevInbox;Object.assign(row,{state:saved.state,mtimeMs:saved.mtimeMs});if(saved.seenAt===undefined)delete row.seenAt;else row.seenAt=saved.seenAt;conversations.set(sid,kept);await fetch(base+'/api/inbox/reset').catch(()=>{});await context.close();}
}
