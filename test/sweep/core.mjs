// Layout sweep, area "core": sign-in, the session list, New conversation, a conversation in each state the fixture
// has, the composer and its menus, the conversation's sheets and docks, split view, side chat, voice and usage.
// Every surface runs on browser.mjs's synthetic server (fixtures only). Run:
//   POCKET_SWEEP=core POCKET_SCREENSHOTS=/tmp/pc-ui-core node test/browser.mjs
export const area='core';

// Each surface that changes the fixture keeps the rows and conversations it found and puts them back after.
const keep=ctx=>{
 const rows=ctx.rows.slice(),snap=rows.map(r=>({...r,state:{...r.state}})),conv=new Map([...ctx.conversations].map(([k,v])=>[k,v.slice()]));
 return async()=>{ // the same row objects, so the fixture's own references to them stay good
  rows.forEach((r,i)=>{for(const k of Object.keys(r))delete r[k];Object.assign(r,snap[i]);});ctx.rows.length=0;ctx.rows.push(...rows);
  for(const k of [...ctx.conversations.keys()])if(!conv.has(k))ctx.conversations.delete(k);for(const [k,v] of conv)ctx.conversations.set(k,v);ctx.setRequests({});};
};
const chat=i=>ctx=>'#/chat/'+ctx.rows[i].id;
const loaded='#msgs .m-asst';
const SHEET='.sheet[role=dialog]';
const wait=(page,sel,o)=>page.waitForSelector(sel,{visible:true,...o});
const iso=m=>new Date(Date.now()-m*60000).toISOString();

const list=[
 // ---------- Sign-in ----------
 {name:'login',route:'#/',ready:'body',open:async(page)=>{
  await page.setRequestInterception(true);
  page.on('request',r=>{if(r.isInterceptResolutionHandled())return;new URL(r.url()).pathname==='/api/me'?r.respond({status:200,contentType:'application/json',body:'{"ok":false}'}):r.continue();});
  await page.reload();await wait(page,'#pw');}},
 {name:'login-error',route:'#/',ready:'body',open:async(page)=>{
  await page.setRequestInterception(true);
  page.on('request',r=>{if(r.isInterceptResolutionHandled())return;new URL(r.url()).pathname==='/api/me'?r.respond({status:200,contentType:'application/json',body:'{"ok":false}'}):r.continue();});
  await page.reload();await wait(page,'#pw');await page.type('#pw','not-the-password');await page.click('#go');
  await page.waitForFunction(()=>document.querySelector('#lerr')?.textContent.trim());}},

 // ---------- Sessions home ----------
 {name:'home',route:'#/',ready:'[data-session-results] .session-item'},
 {name:'home-empty',route:'#/',ready:'[data-session-results]',before:ctx=>{const undo=keep(ctx);ctx.rows.splice(0);return undo;},
  open:async page=>{await page.waitForFunction(()=>document.querySelector('[data-session-results]')?.textContent.trim());}},
 {name:'home-search-hits',route:'#/',ready:'[data-session-search]',open:async page=>{
  await page.type('[data-session-search]','warehouse');await page.waitForSelector('[data-convo-results] .convo-item');}},
 {name:'home-search-none',route:'#/',ready:'[data-session-search]',open:async page=>{
  await page.setRequestInterception(true);
  page.on('request',r=>{if(r.isInterceptResolutionHandled())return;new URL(r.url()).pathname==='/api/search'?r.respond({status:200,contentType:'application/json',body:'{"backend":"pocket","results":[],"scanned":40,"total":40,"complete":true}'}):r.continue();});
  await page.type('[data-session-search]','zebra crossing');
  await page.waitForFunction(()=>/No matches inside/.test(document.querySelector('[data-convo-results]')?.textContent||''));}},
 {name:'home-filter-active',route:'#/',ready:'[data-filter="active"]',open:async page=>{await page.click('[data-filter-keys="all active attention"] [data-filter="active"]');}},
 {name:'home-filter-attention',route:'#/',ready:'[data-filter="attention"]',before:ctx=>{const undo=keep(ctx);delete ctx.rows[3].seenAt;return undo;},
  open:async page=>{await page.click('[data-filter-keys="all active attention"] [data-filter="attention"]');await wait(page,'.review-bar');}},
 {name:'home-reviewed-undo',route:'#/',ready:'[data-filter="attention"]',before:ctx=>{const undo=keep(ctx);delete ctx.rows[3].seenAt;return undo;},
  open:async page=>{await page.click('[data-filter-keys="all active attention"] [data-filter="attention"]');await wait(page,'[data-mark-all-reviewed]');
   await page.click('[data-mark-all-reviewed]');await wait(page,'[data-undo-reviewed]');}},
 {name:'home-filters-open',route:'#/',ready:'[data-more-filters] summary',open:async page=>{await page.click('[data-more-filters] summary');await wait(page,'[data-more-filters][open] select');}},
 {name:'home-row-more',route:'#/',ready:'[data-session-results] [data-more]',scope:SHEET,open:async page=>{
  await page.click('[data-session-results] [data-more]');await wait(page,'#so-ren');}},
 {name:'home-rename',route:'#/',ready:'[data-session-results] [data-more]',scope:SHEET,open:async page=>{
  await page.click('[data-session-results] [data-more]');await wait(page,'#so-ren');await page.click('#so-ren');await wait(page,'#rn');}},
 {name:'home-pinned',route:'#/',ready:'[data-session-results] [data-pin-toggle]',before:ctx=>{const undo=keep(ctx);return undo;},open:async(page,h)=>{
  const id=h.ctx.rows[4].id;await page.click(`[data-session-results] [data-pin-toggle="${id}"]`);
  await page.waitForSelector(`[data-session-results] [data-pin-toggle="${id}"][aria-pressed="true"]`);}},
 {name:'home-more-menu',route:'#/',ready:'#listmore',layouts:['cover','phone','fold','tablet','desktop'],scope:SHEET, // a pane's list has no header More menu
open:async page=>{await page.click('#listmore');await wait(page,SHEET+' h2');}},
 {name:'home-bell',route:'#/',ready:'#bell',open:async page=>{await page.click('#bell');await new Promise(r=>setTimeout(r,600));}},
 {name:'all-conversations',route:'#/all',ready:'[data-session-results] .session-item'},

 // ---------- Rail, tabs, switcher ----------
 {name:'rail-many-tabs',route:chat(3),ready:loaded,layouts:['desktop'], // the rail and its tabs start at 900 px
  before:ctx=>{const undo=keep(ctx);const base=ctx.rows[4];
   for(let i=0;i<8;i++){const id=`7777777${i}-7777-4777-8777-77777777777${i}`;ctx.rows.push({...base,id,title:['Quarterly tax filing prep','Dock door sensor audit','Vendor onboarding checklist','Price list import for the autumn catalogue','Shipping label reprint','Warehouse camera firmware','Returns backlog','Staff rota for the holiday weeks'][i],mtimeMs:Date.now()-400000-i*1000,state:{kind:'idle',label:'Recent'}});ctx.conversations.set(id,ctx.conversations.get(base.id).slice());}
   ctx.rows[0].pinned=true;ctx.rows[0].pinOrder=0;ctx.rows[4].pinned=true;ctx.rows[4].pinOrder=1;return undo;},
  open:async(page,h)=>{const tabs=h.ctx.rows.map(r=>({id:r.id,title:r.title,at:Date.now()}));
   await page.evaluate(t=>localStorage.setItem('pc-open-sessions',JSON.stringify(t)),tabs);await page.reload();await wait(page,loaded);await wait(page,'#open-sessions');}},
 {name:'phone-switcher',route:chat(3),ready:'#session-switch',scope:SHEET,open:async page=>{
  await page.evaluate(()=>openSessionSwitcher());await wait(page,'.session-switcher .session-item');}},

 // ---------- New conversation ----------
 {name:'new',route:'#/new',ready:'#first'},
 {name:'new-setup-open',route:'#/new',ready:'#first',open:async page=>{await page.click('#choose-workspace');await wait(page,'#apick');await wait(page,'#plist .row');}},
 {name:'new-agent-codex',route:'#/new',ready:'#first',open:async page=>{await page.click('#choose-workspace');await wait(page,'#apick [data-a="codex"]');await page.click('#apick [data-a="codex"]');await page.waitForSelector('#apick [data-a="codex"][aria-checked="true"]');}},
 {name:'new-model-picker',route:'#/new',ready:'#c-model',scope:SHEET,open:async page=>{await page.click('#c-model');await wait(page,SHEET+' .opt');}},
 {name:'new-skills',route:'#/new',ready:'#choose-skill',scope:SHEET,open:async page=>{await page.click('#choose-skill');await wait(page,SHEET+' h2');await new Promise(r=>setTimeout(r,300));}},
 {name:'new-saved-prompts',route:'#/new',ready:'#first',modes:{prompts:{prompts:[{id:'p1',name:'Stock check',text:'Check incoming quantities before ordering.',cwd:'/workspaces/warehouse',provider:'claude'},{id:'p2',name:'Weekly supplier summary with a long name',text:'Summarize supplier changes this week.',cwd:'/workspaces/products',provider:'codex'}],recent:[{text:'Check incoming quantities before ordering',cwd:'/workspaces/products',provider:'codex',at:Date.now()-3600000}]}},
  open:async page=>{await page.waitForFunction(()=>document.querySelector('#starters:not([hidden]) .chip'));}},
 {name:'new-manage-prompts',route:'#/new',ready:'#first',scope:SHEET,modes:{prompts:{prompts:[{id:'p1',name:'Stock check',text:'Check incoming quantities before ordering.',cwd:'/workspaces/warehouse',provider:'claude'},{id:'p2',name:'Weekly supplier summary',text:'Summarize supplier changes this week.',cwd:'/workspaces/products',provider:'codex'}],recent:[]}},
  open:async page=>{await wait(page,'#manage-prompts');await page.click('#manage-prompts');await wait(page,SHEET+' h2');}},
 {name:'new-missing-task',route:'#/new',ready:'#start',open:async page=>{await page.click('#start');await wait(page,'#start-hint');}},

 // ---------- A conversation in each state ----------
 {name:'chat-idle-report',route:chat(4),ready:loaded},
 {name:'chat-running',route:chat(0),ready:loaded,open:async page=>{await page.waitForFunction(()=>/Running/.test(document.querySelector('#run-confirmation')?.textContent||document.querySelector('#cproj')?.textContent||''));}},
 {name:'chat-failed',route:chat(2),ready:loaded,before:ctx=>{const undo=keep(ctx);ctx.rows[2].state={kind:'failed',label:'Turn failed',at:Date.now(),confirmed:true,error:'Tool crashed while reading the supplier file'};return undo;},
  open:async page=>{await wait(page,'#turn-failure');}},
 {name:'chat-watch',route:chat(1),ready:loaded},
 {name:'chat-queue',route:chat(0),ready:loaded,scope:'.queue-sheet',open:async page=>{await page.evaluate(()=>openQueue(chatId));await wait(page,'#queue-items .queue-item');}},
 {name:'chat-tool-ledger',route:chat(4),ready:'details.ledgerwrap',before:ctx=>{const undo=keep(ctx);ctx.conversations.set(ctx.rows[4].id,[
   {role:'user',text:'Import the supplier list and check for duplicates. The file is in the shared folder, and the old import from last month should be ignored entirely.'},
   {role:'assistant',blocks:[{t:'text',text:'Reading the supplier file first.'},{t:'tool',name:'Bash',detail:'ls -la /workspaces/inventory/imports/2026-11/supplier-feed-litware-proseware-combined.csv'},{t:'tool',name:'Read',detail:'/workspaces/inventory/imports/supplier.csv'},{t:'tool',name:'Edit',detail:'scripts/import-check.mjs'},{t:'tool',name:'Bash',detail:'node scripts/import-check.mjs --dry-run --supplier litware'},{t:'text',text:'Two duplicate SKUs: `LW-1180` and `PW-2207`. Nothing else changed.'}]}]);return undo;},
  open:async page=>{await page.click('details.ledgerwrap summary');await page.waitForSelector('details.ledgerwrap[open]');}},
 {name:'chat-subagents',route:chat(4),ready:loaded,scope:SHEET,
  modes:{agents:[{id:'review',name:'Review imports',task:'Check duplicate SKUs across supplier imports.',latest:'Reading supplier.csv',status:'running',model:'Test model',activity:true,steps:3,messages:1,background:true},{id:'tests',name:'Check tests',task:'Run the import checks.',latest:'All checks passed.',status:'completed'}],
   agentActivity:{agent:{id:'review',name:'Review imports',steps:3,messages:1},total:2,messages:[{role:'user',text:'Check duplicate SKUs across supplier imports.'},{role:'assistant',blocks:[{t:'text',text:'Looking at the imports.'},{t:'tool',name:'Read',detail:'supplier.csv'},{t:'tool',name:'Bash',detail:'npm run import:check'}]}]}},
  open:async page=>{await wait(page,'#agents-open');await page.click('#agents-open');await wait(page,'.agent-row summary');await page.click('.agent-row summary');
   await wait(page,'.agent-activity-open');await page.click('.agent-activity-open');await wait(page,'.agent-activity .ledger');}},
 {name:'chat-subagents-row',route:chat(4),ready:loaded,modes:{agents:[{id:'review',name:'Review imports',task:'Check duplicate SKUs.',latest:'Reading supplier.csv',status:'running',model:'Test model'}]},
  open:async page=>{await wait(page,'#agents-open');}},
 {name:'chat-background',route:chat(4),ready:loaded,before:ctx=>{const undo=keep(ctx);ctx.rows[4].state={kind:'background',label:'Working in background · 1 job',confirmed:true,background:{count:1,summary:'1 job',jobs:[{kind:'job',description:'Run the full test suites'}]}};return undo;},
  open:async page=>{await page.waitForFunction(()=>/Background/.test(document.querySelector('#run-confirmed-state')?.textContent||'')||document.querySelector('#hember .ember.dim'));}},
 {name:'chat-approval-banner',route:chat(4),ready:loaded,before:ctx=>{const undo=keep(ctx);ctx.setRequests({approvals:[{id:'sweep-approval',title:'Run this command?',kind:'command',details:'npm run build -- --filter warehouse-report --out /workspaces/warehouse/dist',canAllow:true,status:'pending'}]});return undo;},
  open:async page=>{await wait(page,'#approvals-open');}},
 {name:'chat-approval-card',route:chat(4),ready:loaded,scope:SHEET,before:ctx=>{const undo=keep(ctx);ctx.setRequests({approvals:[{id:'sweep-approval',title:'Run this command?',kind:'command',details:'npm run build -- --filter warehouse-report --out /workspaces/warehouse/dist',canAllow:true,status:'pending'}]});return undo;},
  open:async page=>{await page.evaluate(()=>openApprovals(chatId));await wait(page,'.approval-card');}},
 {name:'chat-question-banner',route:chat(1),ready:loaded,before:ctx=>{const undo=keep(ctx);ctx.setRequests({questions:[{id:'request-1',blocking:true,questions:[{id:'format',header:'Format',question:'Which format should the report use?',options:[{label:'CSV',description:'For spreadsheets'},{label:'PDF',description:'For reading'}]}]}]});return undo;},
  open:async page=>{await wait(page,'#questions-open');}},
 {name:'chat-question-form',route:chat(1),ready:loaded,scope:SHEET,before:ctx=>{const undo=keep(ctx);ctx.setRequests({questions:[{id:'request-1',blocking:true,questions:[{id:'format',header:'Format',question:'Which format should the report use?',options:[{label:'CSV',description:'For spreadsheets'},{label:'PDF',description:'For reading'}]},{id:'scope',header:'Scope',question:'Which aisles should be included in the stock report this week?',multiSelect:true,options:[{label:'Aisles 1-3',description:'Already reconciled'},{label:'Aisle 4',description:'Still 14 units short'}]}]}]});return undo;},
  open:async page=>{await page.evaluate(()=>openQuestions(chatId));await wait(page,'.question-form');}},
 {name:'chat-choices',route:chat(4),ready:'.choices:not([hidden])',before:ctx=>{const undo=keep(ctx);ctx.conversations.set(ctx.rows[4].id,[{role:'user',text:'Run the tests.'},{role:'assistant',blocks:[{t:'text',text:'Tests pass. Should I merge and deploy, or hold it until the warehouse team has signed off on the new totals?'},{t:'choices',options:['Merge and deploy','Hold it until the warehouse team signs off on the totals',"Don't merge yet"],rec:0}]}]);return undo;},
  open:async page=>{await page.$eval('.choices',e=>e.scrollIntoView({block:'end'}));}},
 {name:'chat-complete',route:chat(3),ready:'.done-card:not([hidden])',before:ctx=>{const undo=keep(ctx);const r=ctx.rows[3];r.state={kind:'finished',label:'Complete',done:true,summary:'Sent the September summary; totals checked against the ledger',at:Date.now(),confirmed:true};delete r.seenAt;
   ctx.conversations.set(r.id,[{role:'user',text:'Send the September summary.'},{role:'assistant',blocks:[{t:'text',text:'The summary went to the warehouse team and the totals match the ledger.'},{t:'done',text:'Sent the September summary; totals checked against the ledger'}]}]);return undo;},
  open:async page=>{await page.$eval('.done-card:not([hidden])',e=>e.scrollIntoView({block:'end'}));}},
 {name:'chat-handoff-card',route:chat(4),ready:'[data-handoff] [data-handoff-start]',modes:{handoffs:{f00d00000011:{},f00d00000012:{folderMissing:true}}},
  before:ctx=>{const undo=keep(ctx);ctx.conversations.set(ctx.rows[4].id,[{role:'user',text:'Hand this off.'},{role:'assistant',blocks:[{t:'text',text:'Here is the next step.\n\n'+ctx.base+'/#/start/f00d00000011\n\n'+ctx.base+'/#/start/f00d00000012'}]}]);return undo;},
  open:async page=>{await page.$eval('[data-handoff]',e=>e.scrollIntoView({block:'start'}));}},
 {name:'chat-handoff-offer',route:chat(4),ready:'.handoff-offer',settings:{handoffAt:200000},open:async page=>{await page.$eval('.handoff-offer',e=>e.scrollIntoView({block:'end'}));}},
 {name:'chat-away',route:'#/',ready:'[data-session-results] .session-item',before:ctx=>{const undo=keep(ctx);const long='Paragraph of earlier work that you already read. '.repeat(6);
   ctx.conversations.set(ctx.rows[1].id,[...Array.from({length:3},(_,i)=>[{role:'user',text:'Earlier question '+i,ts:iso(300-i*10)},{role:'assistant',blocks:[{t:'text',text:long}],ts:iso(299-i*10)}]).flat(),
    {role:'user',text:'Check stock and draft the order',ts:iso(60)},{role:'assistant',blocks:[{t:'tool',name:'Bash',detail:'stock --all'},{t:'text',text:'Three products are below their reorder level. The order is drafted.'}],ts:iso(30)},
    {role:'assistant',blocks:[{t:'text',text:'Waiting for your approval before sending it. Send the order?'},{t:'choices',options:['Send the order','Hold it for now'],rec:0}],ts:iso(20)}]);return undo;},
  open:async(page,h)=>{const id=h.ctx.rows[1].id;await page.evaluate((id,since)=>{const v=JSON.parse(localStorage.getItem('pc-viewed')||'{}');v[id]=since;localStorage.setItem('pc-viewed',JSON.stringify(v));},id,Date.now()-45*60000);
   await page.reload();await wait(page,'[data-session-results] .session-item');await page.evaluate(id=>{location.hash='#/chat/'+id;},id);
   await page.waitForSelector('#away-divider');await page.waitForFunction(()=>document.querySelector('#away-card .away-body li'));}},
 {name:'chat-times',route:chat(3),ready:loaded,before:ctx=>{const undo=keep(ctx);const day=86400000,noon=new Date().setHours(12,0,0,0),t=ms=>new Date(ms).toISOString();
   ctx.conversations.set(ctx.rows[3].id,[{role:'user',text:'Start the stock review.',ts:t(noon-2*day-3600000)},{role:'assistant',blocks:[{t:'text',text:'Counting the warehouse shelves now.'}],ts:t(noon-2*day-3500000)},
    {role:'user',text:'Any surprises?',ts:t(noon-day-7200000)},{role:'assistant',blocks:[{t:'text',text:'Two recorders are missing from bay 4.'}],ts:t(noon-day-7100000)},
    {role:'user',text:'Draft the reorder, and include the two missing recorders from bay 4 as a separate line so purchasing can see them.',ts:t(Date.now()-600000)},{role:'assistant',blocks:[{t:'text',text:'The reorder is drafted and waiting for you.'}],ts:t(Date.now()-540000)}]);return undo;}},
 {name:'chat-delivery-error',route:chat(4),ready:'#box',open:async page=>{
  await page.setRequestInterception(true);
  page.on('request',r=>{if(r.isInterceptResolutionHandled())return;r.method()==='POST'&&/\/api\/session\/[^/]+\/message$/.test(new URL(r.url()).pathname)?r.abort('failed'):r.continue();});
  await page.type('#box','Please recount aisle 4 before ordering.');await page.click('#send');
  await page.waitForFunction(()=>{const d=document.querySelector('#delivery-status');return d&&!d.hidden&&d.textContent.trim();},{timeout:15000});}},

 // ---------- Composer ----------
 {name:'composer-attach',route:chat(4),ready:'#box',scope:SHEET,open:async page=>{await wait(page,'#c-att');await page.click('#c-att');await wait(page,SHEET+' .opt');}},
 {name:'composer-slash',route:chat(4),ready:'#box',open:async page=>{await page.type('#box','/');await wait(page,'#slash');}},
 {name:'composer-model',route:chat(4),ready:'#c-model',scope:SHEET,open:async page=>{await page.evaluate(()=>document.querySelector('#c-model').click());await wait(page,SHEET+' .opt');}},
 {name:'composer-permissions',route:chat(4),ready:'#c-approval',scope:SHEET,open:async page=>{await page.evaluate(()=>document.querySelector('#c-approval').click());await wait(page,SHEET+' h2');}},
 {name:'composer-codex',route:chat(1),ready:'#c-model'},
 {name:'composer-collapsed',route:chat(4),ready:'#composer-toggle',open:async page=>{await page.click('#composer-toggle');await page.waitForFunction(()=>document.querySelector('#composer-toggle').getAttribute('aria-expanded')==='false');}},
 {name:'composer-draft-long',route:chat(4),ready:'#box',open:async page=>{ // set the value: typing a newline presses Enter, which sends on a desktop
  await page.$eval('#box',b=>{b.value='Recount aisle 4 against the Friday delivery, then post the adjustment.\nInclude the two missing recorders.\nUse the reorder sheet in results.\nThen tell me what changed.';b.dispatchEvent(new Event('input',{bubbles:true}));});}},
 {name:'usage-sheet',route:chat(4),ready:'#ctx-ring',scope:SHEET,open:async page=>{await page.click('#ctx-ring');await wait(page,'#usage-body');await new Promise(r=>setTimeout(r,300));}},
 {name:'plan-usage',route:chat(4),ready:'#box',scope:SHEET,open:async page=>{await page.evaluate(()=>openUsagePanel());await wait(page,'#usage-body');await new Promise(r=>setTimeout(r,300));}},

 // ---------- Conversation sheets and docks ----------
 {name:'session-options',route:chat(4),ready:'#chatmore',scope:SHEET,open:async page=>{await page.click('#chatmore');await wait(page,'#so-ren');}},
 {name:'find-in-conversation',route:chat(4),ready:loaded,open:async page=>{await page.evaluate(()=>findOpen(true));await wait(page,'#fq');await page.type('#fq','stock');await page.waitForFunction(()=>document.querySelector('#fcount')?.textContent.trim());}},
 {name:'results-panel',route:chat(4),ready:loaded,scope:'.results-sheet',open:async page=>{await page.evaluate(()=>openResults(chatId));await wait(page,'.results-sheet .result-row');}},
 {name:'git-panel',route:chat(4),ready:loaded,scope:'.git-sheet',open:async page=>{await page.evaluate(()=>openGit(chatId));await page.waitForFunction(()=>/changed/.test(document.querySelector('.git-sheet [data-git-status]')?.textContent||''));await page.waitForFunction(()=>document.querySelector('.git-sheet [data-git-trees-groups] details'));}},
 {name:'git-worktree-remove',route:chat(4),ready:loaded,scope:SHEET,open:async page=>{await page.evaluate(()=>openGit(chatId));await page.waitForFunction(()=>document.querySelector('.git-sheet [data-git-tree-group="ready"]'));
   await page.evaluate(()=>{const d=document.querySelector('[data-git-tree-group="ready"]');d.open=true;});await page.click('[data-git-tree-remove]');await new Promise(r=>setTimeout(r,500));}},

 // ---------- Split view and side chat ----------
 {name:'split-two-panes',route:chat(3),ready:'#splitb',layouts:['desktop'],open:async(page,h)=>{
  await page.click('#splitb');await wait(page,`[data-v="${h.ctx.rows[0].id}"]`);await page.click(`[data-v="${h.ctx.rows[0].id}"]`);
  await page.waitForSelector('#panes iframe');const frame=await(await page.$('#panes iframe')).contentFrame();await frame.waitForSelector('#msgs .m-asst');}},
 {name:'split-chooser',route:chat(3),ready:'#splitb',layouts:['desktop'],scope:SHEET,open:async(page,h)=>{await page.click('#splitb');await wait(page,`[data-v="${h.ctx.rows[0].id}"]`);}},
 {name:'side-chat',route:chat(4),ready:loaded,scope:'.side-sheet',before:ctx=>{ctx.sideFixture.live=false;return()=>{ctx.sideFixture.live=false;};},open:async page=>{await page.evaluate(()=>SideChat.open(chatId));await wait(page,'.side-sheet .side-compose textarea');
  await page.type('.side-sheet .side-compose textarea','What is in aisle 4?');await page.click('.side-sheet .side-send');
  await page.waitForFunction(()=>/Side answer/.test(document.querySelector('.side-sheet')?.textContent||''));}},
 {name:'side-chat-empty',route:chat(4),ready:loaded,scope:'.side-sheet',before:ctx=>{ctx.sideFixture.live=false;},open:async page=>{await page.evaluate(()=>SideChat.open(chatId));await wait(page,'.side-sheet .side-empty');}},
 {name:'branch-sheet',route:chat(0),ready:loaded,scope:'.branch-sheet',open:async page=>{await page.evaluate(()=>Branch.open(chatId));await wait(page,'#branch-text');}},

 // ---------- Voice ----------
 {name:'voice-listening',route:chat(4),ready:'#micb',open:async page=>{await page.click('#micb');await page.waitForFunction(()=>document.querySelector('#micb').getAttribute('aria-pressed')==='true');await wait(page,'#voice-strip');}},
 {name:'voice-handsfree',route:chat(4),ready:'#hfb',open:async page=>{await page.click('#hfb');await page.waitForFunction(()=>document.querySelector('#hfb').getAttribute('aria-pressed')==='true');await wait(page,'#voice-strip');}},
];

// Known and accepted, checked by eye in the 2026-11-23 sweep. Every one is the page's own scrolling, not a layering
// fault: what sits under the sticky header, the composer, the run strip or the New button at the moment of the picture
// scrolls clear (the last list row clears the New button at the bottom on every touch layout).
const SCROLLED={covered:[
 /^div\.report-table /,                 // the report table scrolled under the header, composer, run strip or a bar
 /^a "Open the report"/,                // the report's last link under the composer, the / panel or the delivery strip
 /^button#slash-o\d+ /,                 // a / picker row scrolled inside the picker's own list
 /^button#c-approval\.chip /,           // 344 px: the permissions chip half-scrolled under the toolbar's > arrow
 /^button\.chip "(Send again|Edit message)"/, // 344 px: the failed-turn chips under the jump-to-latest arrow mid-scroll
 /^button\.(pin-toggle|session-more)/,  // a list row's pin and ⋯ under the New button or the header mid-scroll
 /^button\.row "Warehouse stock report/, // desktop: the pinned row under the list header mid-scroll
 /^button\.row "products /,             // 344 px New: the workspace row under the toolbar until scrolled
 /^input#cpath /,                       // New: the custom path field under the composer until scrolled
],
 cut:[/^span\.vh /],                     // visually hidden text ("Pinned:") is meant to be clipped
 offscreen:[/^span\.tc-raw /],           // the ledger's raw command inside a summary that ends with an ellipsis
};
const merge=(a={},b={})=>{const o={...a};for(const [k,v] of Object.entries(b))o[k]=[...(o[k]||[]),...v];return o;};
export const surfaces=list.map(s=>({...s,allow:merge(s.allow,SCROLLED)}));
