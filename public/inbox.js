/* Inbox (1.69): what Inbox Watch sent, kept beside sessions, projects, files and tasks. Off until Settings → Projects,
   files, tasks & vault turns it on (window.pocketFeatures.inbox). One view, the list (#/inbox), which opens like a
   session: as a tab, beside a conversation, in a window of its own, or full-screen on the phone. An entry is an alert,
   a morning digest or a look-ahead from the watcher: Open goes to the briefed conversation (the start link) or the
   Files document; X dismisses; the row menu records Resolved or Not useful, which the watcher reads back on its next
   run. Data comes from /api/inbox; every change goes through /api/inbox/act. */
const inboxOn=()=>Boolean(window.pocketFeatures?.inbox);
let inboxSnap=null,inboxAt=0,inboxLoading=null,inboxView=null,inboxFilter='new',inboxQuery='',inboxDismissed=null;
const INBOX_GMAIL_MSG='https://mail.google.com/mail/u/0/#all/';
const inboxById=id=>inboxSnap?.entries.find(e=>e.id===id)||inboxDismissed?.entries.find(e=>e.id===id)||null;
async function loadInbox(force){
 if(!force&&inboxSnap&&Date.now()-inboxAt<4000)return inboxSnap;
 if(inboxLoading)return inboxLoading;
 inboxLoading=api('/inbox?state=all',{signal:AbortSignal.timeout(8000)}).then(s=>{inboxSnap=s;inboxAt=Date.now();return s;}).finally(()=>{inboxLoading=null;});
 return inboxLoading;
}
async function loadInboxDismissed(){inboxDismissed=await api('/inbox?state=dismissed',{signal:AbortSignal.timeout(8000)});return inboxDismissed;}
// Keep the local list in the server's order (newest first) after one entry changed.
function mergeInbox(e){
 for(const snap of [inboxSnap,inboxDismissed]){if(!snap)continue;snap.entries=snap.entries.filter(x=>x.id!==e.id);}
 const target=e.state==='dismissed'?inboxDismissed:inboxSnap;
 if(target){target.entries.push(e);target.entries.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));}
 if(inboxSnap)inboxSnap.newCount=inboxSnap.entries.filter(x=>x.state==='new').length;
}
async function inboxAct(body,done){
 try{const r=await api('/inbox/act',{method:'POST',body:JSON.stringify(body)});mergeInbox(r.entry);if(done)toast(done);paintInboxView();paintRailInbox();paintInboxBadges();if(typeof paintAssistantHome==='function')paintAssistantHome();return r.entry;}
 catch(e){toast(e.message||'Could not update the inbox');return null;}
}
const inboxNewCount=()=>inboxSnap?.newCount||0;
const inboxKindWord=e=>e.kind==='digest'?'digest':e.kind==='lookahead'?'look-ahead':'alert';
const inboxStateWord=e=>({resolved:'Resolved',not_useful:'Not useful',dismissed:'Dismissed'})[e.state]||'';
// The watcher writes citations as [label](msg:<gmail id>); they become Gmail links. Plain text otherwise.
function inboxText(text){
 return esc(text||'').replace(/\[([^\]\n]{1,80})\]\(msg:([0-9a-f]{6,24})\)/g,(m,label,id)=>`<a href="${INBOX_GMAIL_MSG}${id}" target="_blank" rel="noopener">${label}</a>`).replace(/\n/g,'<br>');
}
const inboxFirst=text=>{const t=String(text||'').replace(/\[([^\]\n]{1,80})\]\(msg:[0-9a-f]{6,24}\)/g,'$1').replace(/\s+/g,' ').trim();const m=/^(.{20,220}?[.!?])(\s|$)/.exec(t);return m?m[1]:t.slice(0,220);};
const inboxWhen=iso=>{const d=new Date(iso);return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).replace(' ',' ').toLowerCase();};
const inboxDay=iso=>{const d=new Date(iso),t=new Date();const same=(a,b)=>a.toDateString()===b.toDateString();const y=new Date(t);y.setDate(t.getDate()-1);return same(d,t)?'Today':same(d,y)?'Yesterday':d.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});};
// Where Open goes: the start link (a Pocket path or this Pocket's own address), the Files document, else the entry itself.
function inboxTarget(e){
 const u=e.url||'';
 if(u.startsWith('/#/'))return u.slice(1);
 if(u.startsWith(location.origin+'/#/'))return u.slice(location.origin.length+1);
 if(/^https?:\/\//.test(u))return u;
 if(e.doc)return '#/documents/'+e.doc;
 return '';
}
function inboxOpen(id){
 const e=inboxById(id);if(!e)return;
 if(e.state==='new')inboxAct({action:'open',id});
 const t=inboxTarget(e);
 if(!t)return inboxSheet(id);
 if(/^https?:\/\//.test(t))window.open(t,'_blank','noopener');else location.hash=t;
}

/* ---------- the list view ---------- */
async function renderInbox(view){
 Voice.onLeave?.();
 inboxView=view;if(typeof boardView!=='undefined')boardView=null;if(typeof docView!=='undefined')docView=null;if(typeof taskView!=='undefined')taskView=null;
 const col=`<header class="bar">
   ${PANE?`<button class="icon" id="pane-main" aria-label="Make this the main view">${IC.swap}</button>`:SOLO?'':`<button class="icon" id="back" aria-label="Back">${IC.back}</button><button class="icon desk" id="railtog" aria-label="Show or hide the conversation list">${IC.panel}</button>`}
   <h1><span class="one" id="ktitle">Inbox</span><span class="tag" id="ktag">What Inbox Watch sent · tap to read</span></h1>
   ${SOLO?'':`<button class="icon" id="kwin" aria-label="Open in a new window" title="Open in a new window">${IC.external}</button>`}
   ${PANE||SOLO?'':`<button class="icon desk" id="splitb" aria-label="Split view">${IC.columns}</button>`}
   ${PANE?`<button class="icon" id="pane-close" aria-label="Close this pane">${IC.x}</button>`:''}
  </header>
  <main class="scroll projects-view inbox-view" id="inbox-main" tabindex="-1"><p class="sheet-help projects-loading">Loading the inbox…</p></main>`;
 app.innerHTML=withShell(col);
 wireShell();
 if(PANE){$('#pane-main').onclick=()=>paneSay('main',{view});$('#pane-close').onclick=()=>paneSay('close');}
 else if(!SOLO){bindViewBack($('#back'),view);$('#splitb').onclick=chooseBeside;}
 if(!SOLO)$('#kwin').onclick=()=>openInWindow(view);
 try{await loadInbox(true);if(inboxFilter==='dismissed')await loadInboxDismissed();}catch(e){const m=$('#inbox-main');if(m)m.innerHTML=`<p class="sheet-help">The inbox could not load: ${esc(e.message||'error')}</p>`;return;}
 paintInboxView();
 const open=/^#\/inbox\/([0-9a-f]{12})$/.exec(location.hash);if(open)inboxSheet(open[1]);
 if(typeof paintOpenSessions==='function')paintOpenSessions();
}
let inboxPainted='';
function paintInboxView(){
 const main=$('#inbox-main');if(!main||!inboxSnap||!inboxView)return;
 const html=inboxListHTML();
 if(html===inboxPainted&&main.querySelector('[data-inbox-filter]')){paintInboxBadges();return;} // a repaint that changes nothing leaves the rows and chips alone
 inboxPainted=html;
 const q=main.querySelector('#inbox-search'),focus=q&&document.activeElement===q,pos=q?q.selectionStart:0;
 main.innerHTML=html;
 bindInboxRows(main);
 main.querySelectorAll('[data-inbox-filter]').forEach(b=>b.onclick=async()=>{inboxFilter=b.dataset.inboxFilter;if(inboxFilter==='dismissed'&&!inboxDismissed)try{await loadInboxDismissed();}catch{}paintInboxView();});
 const s=main.querySelector('#inbox-search');if(s){s.oninput=()=>{inboxQuery=s.value;paintInboxView();};if(focus){s.focus();s.setSelectionRange(pos,pos);}}
 paintInboxBadges();
}
function inboxRows(){
 const src=inboxFilter==='dismissed'?(inboxDismissed?.entries||[]):inboxSnap.entries.filter(e=>inboxFilter==='all'||e.state==='new');
 const q=inboxQuery.trim().toLowerCase();
 return q?src.filter(e=>(e.title+' '+(e.story||'')+' '+(e.text||'')).toLowerCase().includes(q)):src;
}
function inboxRowHTML(e){
 const facts=[`<span>${esc(inboxWhen(e.at))}</span>`,e.story?`<span>${esc(e.story.replace(/-/g,' '))}</span>`:'',`<span>${inboxKindWord(e)}${e.priority==='critical'?' · critical':''}</span>`,inboxStateWord(e)?`<span>${inboxStateWord(e)}</span>`:''].filter(Boolean).join('<span aria-hidden="true">·</span>');
 const first=inboxFirst(e.text);
 return `<div class="session-item task-item inbox-item state-${esc(e.state)} kind-${esc(e.kind)}" data-item="${esc(e.id)}">
  <button class="task-check inbox-mark" data-inbox-open="${esc(e.id)}" aria-label="Read: ${esc(e.title)}">${e.state==='new'?'<span class="inbox-dot" aria-hidden="true"></span>':e.kind==='alert'?IC.bell:IC.doc}</button>
  <button class="row" data-inbox-open="${esc(e.id)}"><span class="body"><span class="title">${esc(e.title)}</span>${first?`<span class="inbox-text">${esc(first)}</span>`:''}<span class="session-status">${facts}</span></span></button>
  ${e.state==='dismissed'?'':`<button class="session-more icon inbox-x" data-inbox-dismiss="${esc(e.id)}" aria-label="Dismiss: ${esc(e.title)}" title="Dismiss">${IC.x}</button>`}
  <button class="session-more icon" data-inbox-more="${esc(e.id)}" aria-label="Options for ${esc(e.title)}">${IC.more}</button></div>`;
}
function inboxListHTML(){
 const rows=inboxRows(),n=inboxNewCount(),last=inboxSnap.lastReportAt?Date.parse(inboxSnap.lastReportAt):0,stale=last&&Date.now()-last>24*3600000;
 const chip=(k,label)=>`<button class="chip" data-inbox-filter="${k}" aria-pressed="${inboxFilter===k}">${label}</button>`;
 const groups=[];let day='';
 for(const e of rows){const d=inboxDay(e.at);if(d!==day){day=d;groups.push({day:d,html:[]});}groups[groups.length-1].html.push(inboxRowHTML(e));}
 const empty=inboxFilter==='dismissed'?'Nothing dismissed.':inboxQuery.trim()?'Nothing matches.':inboxFilter==='new'?(inboxSnap.entries.length?'Nothing new. All shows everything Inbox Watch has sent.':'Nothing from Inbox Watch yet. It sends an alert only when an email tells you something the email itself doesn’t.'):'Nothing from Inbox Watch yet.';
 return `<div class="session-home-head"><h2>Inbox</h2><span class="project-head-actions">${chip('new',`New${n?` <span class="badge" data-inbox-badge>${n}</span>`:''}`)}${chip('all','All')}${chip('dismissed','Dismissed')}</span></div>
  <div class="inbox-tools"><input type="search" id="inbox-search" class="inbox-search" placeholder="Search titles and stories" value="${esc(inboxQuery)}" aria-label="Search the inbox">${stale?`<p class="sheet-help inbox-stale">Inbox Watch hasn’t reported since ${esc(inboxDay(inboxSnap.lastReportAt))} ${esc(inboxWhen(inboxSnap.lastReportAt))}.</p>`:''}</div>
  ${groups.length?groups.map(g=>`<section class="session-group project-group"><h2>${esc(g.day)} <span>${g.html.length}</span></h2>${g.html.join('')}</section>`).join(''):`<p class="sheet-help project-empty">${empty}</p>`}`;
}
function bindInboxRows(root){
 root.querySelectorAll('[data-inbox-open]').forEach(b=>b.onclick=()=>inboxSheet(b.dataset.inboxOpen)); // 1.69.1: read first; the sheet starts the conversation
 root.querySelectorAll('[data-inbox-dismiss]').forEach(b=>b.onclick=()=>inboxAct({action:'dismiss',id:b.dataset.inboxDismiss},'Dismissed'));
 root.querySelectorAll('[data-inbox-more]').forEach(b=>b.onclick=()=>inboxSheet(b.dataset.inboxMore));
}

/* ---------- one entry: the sheet with the whole text and the choices ---------- */
function inboxSheet(id){
 const e=inboxById(id);if(!e)return;
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet task-sheet inbox-sheet';
 const facts=[`<span>${esc(inboxDay(e.at))} ${esc(inboxWhen(e.at))}</span>`,e.story?`<span>${esc(e.story.replace(/-/g,' '))}</span>`:'',`<span>${inboxKindWord(e)}</span>`,e.priority&&e.priority!=='normal'?`<span>${esc(e.priority)}</span>`:'',inboxStateWord(e)?`<span>${inboxStateWord(e)}</span>`:''].filter(Boolean).join(''); // the sheet's facts stack one per line, as a task's do
 const target=inboxTarget(e),gone=['dismissed','resolved','not_useful'].includes(e.state);
 sh.innerHTML=`<h2>${e.kind==='alert'?'Alert':e.kind==='digest'?'Digest':'Look-ahead'}</h2><p class="task-text">${esc(e.title)}</p><div class="task-facts">${facts}</div>
  <div class="task-summary inbox-body">${inboxText(e.text)}</div>
  ${target?`<button class="opt" data-go>${e.doc&&!e.url?IC.doc:IC.plus}<span>${e.doc&&!e.url?'Open in Files':'Start a conversation'}<span class="sub">${e.doc&&!e.url?'The full text, kept in Files':'New conversation, already briefed with the story and the evidence; nothing starts until you press Start'}</span></span></button>`:''}
  ${e.gmail?`<a class="opt" href="${esc(e.gmail)}" target="_blank" rel="noopener">${IC.globe}<span>Open in Gmail</span></a>`:''}
  ${gone?`<button class="opt" data-restore>${IC.swap}<span>Restore<span class="sub">Back to the list; the watcher is told</span></span></button>`:`<button class="opt" data-resolve>${IC.tick}<span>Resolved<span class="sub">This situation is over; the watcher stops following it</span></span></button>
  <button class="opt" data-useless>${IC.bellOff}<span>Not useful<span class="sub">Don’t alert me about this kind of thing; the watcher adds it to your preferences</span></span></button>
  <button class="opt" data-dismiss>${IC.x}<span>Dismiss<span class="sub">Hide it here; nothing else changes</span></span></button>`}`;
 sh.querySelector('[data-go]')?.addEventListener('click',()=>{closeCurrentSheet?.();inboxOpen(id);});
 sh.querySelector('[data-resolve]')?.addEventListener('click',()=>{closeCurrentSheet?.();inboxAct({action:'resolve',id},'Marked resolved');});
 sh.querySelector('[data-useless]')?.addEventListener('click',()=>{closeCurrentSheet?.();inboxAct({action:'not_useful',id},'Noted: not useful');});
 sh.querySelector('[data-dismiss]')?.addEventListener('click',()=>{closeCurrentSheet?.();inboxAct({action:'dismiss',id},'Dismissed');});
 sh.querySelector('[data-restore]')?.addEventListener('click',()=>{closeCurrentSheet?.();inboxAct({action:'restore',id},'Restored');});
 if(e.state==='new')inboxAct({action:'open',id});
 mountSheet(scrim,sh);
}

/* ---------- rail, home, badges ---------- */
function railInboxHTML(){
 if(!inboxSnap)return '<p class="sheet-help">Loading the inbox…</p>';
 const rows=inboxSnap.entries.filter(e=>e.state==='new'),rest=inboxSnap.entries.length-rows.length;
 return `<div class="rail-projects rail-inbox"><div class="rail-project-actions"><a class="chip" href="${viewHref('inbox')}" data-view-link>All</a></div>
  ${rows.length?rows.slice(0,40).map(inboxRowHTML).join(''):'<p class="sheet-help">Nothing new from Inbox Watch.</p>'}
  ${rest?`<a class="rail-done-link" href="${viewHref('inbox')}" data-view-link>${rest} more in All</a>`:''}</div>`;
}
let railInboxPainted='';
function paintRailInbox(){
 const el=document.getElementById('rail');if(!el||railView()!=='inbox')return;
 const html=railInboxHTML();
 if(html!==railInboxPainted||!el.querySelector('.rail-inbox')){railInboxPainted=html;el.innerHTML=html;bindInboxRows(el);}
 if(!inboxSnap||Date.now()-inboxAt>4000)loadInbox(true).then(()=>{paintRailInbox();paintInboxBadges();}).catch(()=>{const r=document.getElementById('rail');if(!inboxSnap&&r&&railView()==='inbox')r.innerHTML='<p class="sheet-help">The inbox could not load.</p>';});
}
function paintInboxBadges(){
 const n=inboxNewCount();
 document.querySelectorAll('[data-inbox-badge]').forEach(el=>{el.textContent=n?String(n):'';el.hidden=!n;});
 document.querySelectorAll('[data-inbox-home]').forEach(el=>{el.innerHTML=(el.dataset.icon||'')+'<span class="chip-label">Inbox'+(n?' · '+n+' new':'')+'</span>';el.classList.toggle('due',n>0);});
}
// Assistant mode home (1.60): a new alert is a Waiting-for-you card, like a question from a conversation.
function inboxWaitingCards(){
 if(!inboxOn())return [];
 if(!inboxSnap){if(!inboxLoading)loadInbox().then(()=>{if(typeof paintAssistantHome==='function')paintAssistantHome();}).catch(()=>{});return [];} // first paint on a fresh page: fetch, then paint again
 return inboxSnap.entries.filter(e=>e.state==='new'&&e.kind==='alert').slice(0,3).map(e=>`<a class="home-card inbox-card" href="#/inbox/${esc(e.id)}" data-inbox-card="${esc(e.id)}"><span class="home-card-title">${esc(e.title)}</span><span class="home-card-what">Inbox Watch · ${esc(inboxFirst(e.text)||'Open to read')}</span></a>`);
}
function inboxTick(){if(!inboxOn()||document.visibilityState!=='visible'||!(inboxView||railView()==='inbox'||document.querySelector('[data-inbox-home],[data-inbox-badge],.assistant-home')))return;loadInbox(true).then(()=>{paintInboxView();paintRailInbox();paintInboxBadges();if(typeof paintAssistantHome==='function')paintAssistantHome();if(typeof paintOpenSessions==='function')paintOpenSessions();}).catch(()=>{});}
setInterval(inboxTick,30000);onListsStale(inboxTick);
