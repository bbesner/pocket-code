/* Inbox (1.69): what Inbox Watch sent, kept beside sessions, projects, files and tasks. Off until Settings → Projects,
   files, tasks & vault turns it on (window.pocketFeatures.inbox). One view, the list (#/inbox), which opens like a
   session: as a tab, beside a conversation, in a window of its own, or full-screen on the phone. An entry is an alert,
   a morning digest or a look-ahead from the watcher: Open goes to the briefed conversation (the start link) or the
   Files document; X dismisses; the row menu records Resolved or Not useful, which the watcher reads back on its next
   run. Data comes from /api/inbox; every change goes through /api/inbox/act. */
const inboxOn=()=>Boolean(window.pocketFeatures?.inbox);
let inboxSnap=null,inboxAt=0,inboxLoading=null,inboxView=null,inboxFilter='all',inboxQuery='',inboxDismissed=null; // 1.69.2: the list opens on All; reading clears the dot, never the row
const inboxOpenState=e=>e.state==='new'||e.state==='opened'; // still on the owner's plate: not dismissed, resolved or marked not useful
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
// 1.70.1: a digest's "## Worth knowing" heading and "- " lines read as a heading and bullets, not as raw marks.
function inboxText(text){
 return esc(text||'').replace(/\[([^\]\n]{1,80})\]\(msg:([0-9a-f]{6,24})\)/g,(m,label,id)=>`<a href="${INBOX_GMAIL_MSG}${id}" target="_blank" rel="noopener">${label}</a>`)
  .replace(/^#{1,3}[ \t]+(.+)$/gm,'<strong>$1</strong>').replace(/^[ \t]*[-*][ \t]+/gm,'• ').replace(/\n/g,'<br>');
}
const inboxFirst=text=>{const t=String(text||'').replace(/\[([^\]\n]{1,80})\]\(msg:[0-9a-f]{6,24}\)/g,'$1').replace(/^#{1,3}[ \t]+.*$/gm,'').replace(/^[ \t]*[-*][ \t]+/gm,'').replace(/\s+/g,' ').trim();const m=/^(.{20,220}?[.!?])(\s|$)/.exec(t);return m?m[1]:t.slice(0,220);};
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
 main.querySelector('#inbox-watch')?.addEventListener('click',inboxWatchSheet);
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
 const empty=inboxFilter==='dismissed'?'Nothing dismissed.':inboxQuery.trim()?'Nothing matches.':inboxFilter==='new'?(inboxSnap.entries.length?'Nothing unread. All shows everything Inbox Watch has sent.':'Nothing from Inbox Watch yet. It sends an alert only when an email tells you something the email itself doesn’t.'):'Nothing from Inbox Watch yet. It sends an alert only when an email tells you something the email itself doesn’t.';
 return `<div class="session-home-head"><h2>Inbox</h2><span class="project-head-actions">${chip('all','All')}${chip('new',`Unread${n?` <span class="badge" data-inbox-badge>${n}</span>`:''}`)}${chip('dismissed','Dismissed')}</span></div>
  <div class="inbox-tools"><div class="inbox-tools-row"><input type="search" id="inbox-search" class="inbox-search" placeholder="Search titles and stories" value="${esc(inboxQuery)}" aria-label="Search the inbox"><button class="chip" id="inbox-watch" aria-label="Inbox Watch schedule${assistantMode()?'':', models and cost'}">${IC.sliders}Schedule</button></div>${stale&&!inboxSnap.paused?`<p class="sheet-help inbox-stale">Inbox Watch hasn’t reported since ${esc(inboxDay(inboxSnap.lastReportAt))} ${esc(inboxWhen(inboxSnap.lastReportAt))}.</p>`:''}</div>
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
 const rows=inboxSnap.entries.filter(inboxOpenState).sort((a,b)=>(a.state==='new'?0:1)-(b.state==='new'?0:1)||Date.parse(b.at)-Date.parse(a.at)),rest=inboxSnap.entries.length-rows.length;
 return `<div class="rail-projects rail-inbox"><div class="rail-project-actions"><a class="chip" href="${viewHref('inbox')}" data-view-link>All</a></div>
  ${rows.length?rows.slice(0,40).map(inboxRowHTML).join(''):'<p class="sheet-help">Nothing open from Inbox Watch.</p>'}
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
 return inboxSnap.entries.filter(e=>inboxOpenState(e)&&e.kind==='alert').slice(0,3).map(e=>`<a class="home-card inbox-card" href="#/inbox/${esc(e.id)}" data-inbox-card="${esc(e.id)}"><span class="home-card-title">${esc(e.title)}</span><span class="home-card-what">Inbox Watch · ${esc(inboxFirst(e.text)||'Open to read')}</span></a>`);
}
function inboxTick(){if(!inboxOn()||document.visibilityState!=='visible'||!(inboxView||railView()==='inbox'||document.querySelector('[data-inbox-home],[data-inbox-badge],.assistant-home')))return;loadInbox(true).then(()=>{paintInboxView();paintRailInbox();paintInboxBadges();if(typeof paintAssistantHome==='function')paintAssistantHome();if(typeof paintOpenSessions==='function')paintOpenSessions();}).catch(()=>{});}
setInterval(inboxTick,30000);onListsStale(inboxTick);

/* ---------- 1.70: Inbox Watch settings: when it checks, quiet hours and summaries, models, cost ----------
   One sheet, opened from Settings (Schedule, models and cost) or the Inbox header. The watcher's profile (its defaults,
   the choices it offers, what is in force, what it cost) arrives with its heartbeat; the owner's settings go to
   /api/inbox/watch and reach the watcher within a minute. Assistant mode shows the schedule only: no model names, no dollars. */
const WATCH_DAYS=[['M','Monday'],['T','Tuesday'],['W','Wednesday'],['T','Thursday'],['F','Friday'],['S','Saturday'],['S','Sunday']];
const watchEvery=n=>n===0?'Don’t check':n===1?'Every minute':n<60||n%60?`Every ${n} minutes`:n===60?'Every hour':`Every ${n/60} hours`;
const watchHour=h=>h===0?'12 AM':h<12?`${h} AM`:h===12?'12 PM':`${h-12} PM`;
let watchTZ; // the watcher's time zone, so the status reads in the same clock as the periods
const watchTime=iso=>{if(!iso)return '';try{return new Date(iso).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:watchTZ});}catch{return new Date(iso).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});}};
const watchTokens=n=>n>=1e6?(n/1e6).toFixed(n>=1e7?0:1)+'M':n>=1e3?Math.round(n/1e3)+'k':String(n||0);
const watchMoney=v=>v==null?'—':'$'+(v>=100?v.toFixed(0):v.toFixed(2));
const watchDay=d=>{const t=new Date(d+'T12:00:00');return `${t.toLocaleDateString('en-US',{weekday:'short'})} ${t.getDate()}`;};
function watchStatus(w){
 const p=w.profile,st=p?.status;
 if(!p)return 'Inbox Watch hasn’t reported its settings yet. It needs inbox-monitor 0.3 or later on the server.';
 const pending=w.settings&&p.applied?.revision!==w.revision?' Your last change reaches the watcher within a minute.':w.settings?'':' Using the watcher’s config file.';
 if(st?.paused)return 'Paused. Nothing is checked until you resume.'+pending;
 const now=st?st.every===0?'Not checking now':`Checking ${watchEvery(st.every).toLowerCase()} now`:'';
 return `${now}${st?.period?` (${st.period})`:''}.${st?.lastCheckAt?` Last check ${watchTime(st.lastCheckAt)}`:''}${st?.nextCheckAt?`, next about ${watchTime(st.nextCheckAt)}.`:st?.lastCheckAt?'.':''}${pending}`;
}
function watchSelect(id,label,values,current,word,extra=''){
 return `<label class="voice-field">${label}<select id="${id}" ${extra}>${values.map(v=>`<option value="${v===null?'off':v}"${v===current||(v===null&&current==null)?' selected':''}>${word(v)}</option>`).join('')}</select></label>`;
}
function watchPeriodHTML(p,i,everyChoices){
 const days=WATCH_DAYS.map(([l,name],d)=>`<button type="button" class="chip" data-day="${d}" aria-pressed="${p.days.includes(d)}" aria-label="${name}">${l}</button>`).join('');
 return `<div class="router-level watch-period" data-period="${i}">
  <div class="watch-period-head"><input class="watch-name" type="text" maxlength="40" value="${esc(p.name||'')}" placeholder="Name, e.g. Overnight" aria-label="Period ${i+1} name"><button type="button" class="chip" data-remove aria-label="Remove period ${i+1}">Remove</button></div>
  <div class="watch-days" role="group" aria-label="Days for period ${i+1}">${days}</div>
  <label class="voice-field">From<input type="time" step="900" data-from value="${esc(p.from)}"></label>
  <label class="voice-field">Until<input type="time" step="900" data-to value="${esc(p.to)}"></label>
  <label class="voice-field watch-wide">Interval<select data-every>${everyChoices.map(v=>`<option value="${v}"${v===p.every?' selected':''}>${watchEvery(v)}</option>`).join('')}</select></label></div>`;
}
function watchUsageHTML(u){
 const days=(u?.days||[]).slice(0,7);
 if(!days.length)return '<p class="title-note">No checks recorded yet.</p>';
 const since=u.since?Date.parse(u.since):0,rec=d=>since&&Date.parse(d.date+'T23:59:59')>=since;
 const tot=days.filter(rec).reduce((a,d)=>({skipped:a.skipped+(d.firstPass?.skipped||0),calls:a.calls+d.calls,tokens:a.tokens+d.inputTokens+d.outputTokens,cost:d.costUsd==null?a.cost:(a.cost||0)+d.costUsd}),{skipped:0,calls:0,tokens:0,cost:null});
 const bill=u.billing==='plan'?'Billed to your plan, not per call; the dollars are what the same tokens cost at API list prices.':u.billing==='api'?'Billed per token through an API key, at about these list prices.':'This watcher’s judge does not report a price.';
 return `<p class="title-note">${bill}</p><table class="watch-usage"><thead><tr><th scope="col">Day</th><th scope="col">Checks</th><th scope="col">Skipped</th><th scope="col">Calls</th><th scope="col">Tokens</th><th scope="col">Cost</th></tr></thead><tbody>
  ${days.map(d=>rec(d)?`<tr><th scope="row">${esc(watchDay(d.date))}</th><td>${d.checks}</td><td>${d.firstPass?.skipped||0}</td><td>${d.calls}</td><td>${watchTokens(d.inputTokens+d.outputTokens)}</td><td>${watchMoney(d.costUsd)}</td></tr>`:`<tr class="watch-unrecorded"><th scope="row">${esc(watchDay(d.date))}</th><td>${d.checks}</td><td colspan="4">Not recorded</td></tr>`).join('')}
  </tbody>${tot.calls?`<tfoot><tr><th scope="row">Total</th><td></td><td>${tot.skipped}</td><td>${tot.calls}</td><td>${watchTokens(tot.tokens)}</td><td>${watchMoney(tot.cost)}</td></tr></tfoot>`:''}</table>
  ${since?`<p class="title-note">Recorded since ${esc(new Date(since).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:watchTZ}))}.</p>`:''}`;
}
async function inboxWatchSheet(){
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet watch-sheet';
 sh.innerHTML='<h2>Inbox Watch</h2><div class="watch-body"><p class="title-note" role="status">Loading…</p></div>';
 mountSheet(scrim,sh);
 const holder=sh.querySelector('.watch-body');
 let w;
 try{w=await api('/inbox/watch',{signal:AbortSignal.timeout(8000)});}catch(e){if(sh.isConnected)holder.querySelector('[role=status]').textContent='The settings could not load: '+(e.message||'error');return;}
 if(!sh.isConnected)return;
 watchTZ=w.profile?.timezone||undefined;
 const dev=!assistantMode(),p=w.profile,opts=p?.options||{},everyChoices=opts.every||[0,1,2,3,5,10,15,20,30,45,60,90,120,180,240];
 let s=structuredClone(w.settings||p?.defaults||null);
 if(!s){holder.querySelector('[role=status]').textContent=watchStatus(w);return;}
 s.periods ||= [];
 const hours=[...Array(24).keys()],tz=p?.timezone&&p.timezone!==Intl.DateTimeFormat().resolvedOptions().timeZone?` Times are ${p.timezone.split('/').pop().replace(/_/g,' ')} time.`:'';
 const modelRow=(job,name,what)=>{const m=s.models?.[job]||{};const models=opts.models||[];return `<div class="router-level" data-job="${job}"><p class="router-level-name">${name}<span class="sub">${what}</span></p>
   <label class="voice-field">Model<select data-model>${models.map(x=>`<option value="${esc(x.id)}"${x.id===m.model?' selected':''}>${esc(x.label)}</option>`).join('')}</select></label>
   <label class="voice-field">Reasoning<select data-reasoning>${(opts.reasoning||[{id:'default',label:'Model default'}]).map(x=>`<option value="${esc(x.id)}"${x.id===m.reasoning?' selected':''}>${esc(x.label)}</option>`).join('')}</select></label></div>`;};
 const body=`<p class="title-note watch-status" role="status" id="w-status">${esc(watchStatus(w))}</p>
  <button class="opt" id="w-pause" aria-pressed="${Boolean(s.paused)}"><span class="dot${s.paused?' on':''}"></span><span>Pause Inbox Watch<span class="sub">No mail checks, digests or look-aheads until you turn this off</span></span></button>
  <div class="title-settings model-offer" role="group" aria-labelledby="w-sched-h"><p class="vault-set-head" id="w-sched-h">Schedule</p>
   <p class="title-note">How often it checks your mail. Inside a period, that period’s interval applies; the rest of the time, this one. When periods overlap, the first listed wins.${esc(tz)}</p>
   ${watchSelect('w-every','The rest of the time',everyChoices,s.every,watchEvery)}
   <div class="router-levels watch-periods" id="w-periods"></div>
   <span class="vault-set-actions"><button type="button" class="chip" id="w-add">${IC.plus}Add a period</button></span></div>
  <div class="title-settings model-offer" role="group" aria-labelledby="w-times-h"><p class="vault-set-head" id="w-times-h">Quiet hours and summaries</p>
   <div class="watch-pair">${watchSelect('w-quiet-from','Quiet from',hours,s.quietHours[0],watchHour)}${watchSelect('w-quiet-to','Until',hours,s.quietHours[1],watchHour)}</div>
   <p class="title-note">In quiet hours only critical alerts reach you; the rest wait for the morning digest.</p>
   <div class="watch-pair">${watchSelect('w-digest','Morning digest',hours,s.digestHour,watchHour)}</div>
   <div class="watch-pair">${watchSelect('w-la-morning','Morning look-ahead',[null,...hours],s.lookahead?.morning,v=>v===null?'Off':watchHour(v))}${watchSelect('w-la-evening','Evening look-ahead',[null,...hours],s.lookahead?.evening,v=>v===null?'Off':watchHour(v))}</div>
   <p class="title-note">The look-ahead checks what is coming due in the next few days and says so only when something needs you.</p></div>
  ${dev?`<div class="title-settings model-offer" role="group" aria-labelledby="w-models-h"><p class="vault-set-head" id="w-models-h">Models</p>
   <div class="router-levels" id="w-models">${modelRow('decisions','Decisions','Every check that finds new mail')}${modelRow('lookahead','Look-ahead','Twice a day')}</div>
   <p class="title-note">Model default lets the model decide how much to reason.</p></div>
  ${s.firstPass?`<div class="title-settings model-offer" role="group" aria-labelledby="w-fp-h"><p class="vault-set-head" id="w-fp-h">First pass</p>
   <p class="title-note">A fast classifier skips mail that is clearly routine (receipts, shipping, newsletters, marketing), so the model reads less. Threads you wrote in, threads that mattered before and anything close to a story it follows are always read, and a skipped email’s headline still reaches the model.</p>
   <button class="opt" id="w-fp" aria-pressed="${Boolean(s.firstPass.enabled)}"${opts.firstPass?.available===false?' aria-describedby="w-fp-nokey"':''}><span class="dot${s.firstPass.enabled?' on':''}"></span><span>Skip routine mail first<span class="sub">${opts.firstPass?.available===false?'The watcher has no classifier key, so everything is read until one is set':'A few cents a day, even for a busy inbox'}</span></span></button>
   <div class="watch-pair">${watchSelect('w-fp-provider','Classifier',(opts.firstPass?.providers||[{id:'jev'},{id:'openai'},{id:'both'}]).map(x=>x.id),s.firstPass.provider,v=>({jev:'Jev (TypeSafe)',openai:'OpenAI decision model',both:'Both must agree'})[v]||v)}${watchSelect('w-fp-threshold','Skip when at least',opts.firstPass?.thresholds||[0.95,0.9,0.8,0.7],s.firstPass.threshold,v=>`${Math.round(v*100)}% sure`)}</div>
   ${opts.firstPass?.available===false?'<p class="title-note" id="w-fp-nokey">Add an OpenRouter key to the watcher’s [firstpass] settings to use it.</p>':''}</div>`:''}
  <div class="title-settings model-offer" role="group" aria-labelledby="w-cost-h"><p class="vault-set-head" id="w-cost-h">Cost, last 7 days</p><div id="w-usage">${watchUsageHTML(p.usage)}</div></div>`:''}
  <p class="vault-field-error" id="w-error" role="alert"></p>
  <div class="watch-actions"><button class="primary" id="w-save">Save</button>${w.settings?'<button class="chip" id="w-reset">Use the config file’s settings</button>':''}</div>`;
 holder.innerHTML=body;
 const $w=q=>sh.querySelector(q);
 const paintPeriods=()=>{const el=$w('#w-periods');el.innerHTML=s.periods.map((x,i)=>watchPeriodHTML(x,i,everyChoices)).join('');el.hidden=!s.periods.length;$w('#w-add').disabled=s.periods.length>=(opts.maxPeriods||12);};
 const readPeriods=()=>{s.periods=[...sh.querySelectorAll('.watch-period')].map(row=>({name:row.querySelector('.watch-name').value.trim(),days:[...row.querySelectorAll('[data-day][aria-pressed="true"]')].map(b=>Number(b.dataset.day)),
   from:row.querySelector('[data-from]').value,to:row.querySelector('[data-to]').value,every:Number(row.querySelector('[data-every]').value)}));};
 paintPeriods();
 $w('#w-periods').addEventListener('click',e=>{
  const day=e.target.closest('[data-day]');if(day){day.setAttribute('aria-pressed',String(day.getAttribute('aria-pressed')!=='true'));return;}
  const rm=e.target.closest('[data-remove]');if(rm){readPeriods();const i=Number(rm.closest('.watch-period').dataset.period);s.periods.splice(i,1);paintPeriods();($w('.watch-period .watch-name')||$w('#w-add')).focus();}
 });
 $w('#w-add').onclick=()=>{readPeriods();s.periods.push({name:'',days:[0,1,2,3,4,5,6],from:'22:00',to:'07:00',every:Math.max(15,s.every||15)});paintPeriods();sh.querySelector('.watch-period:last-child .watch-name')?.focus();};
 $w('#w-fp')?.addEventListener('click',e=>{s.firstPass.enabled=!s.firstPass.enabled;e.currentTarget.setAttribute('aria-pressed',String(s.firstPass.enabled));e.currentTarget.querySelector('.dot').classList.toggle('on',s.firstPass.enabled);});
 $w('#w-pause').onclick=e=>{s.paused=!s.paused;e.currentTarget.setAttribute('aria-pressed',String(s.paused));e.currentTarget.querySelector('.dot').classList.toggle('on',s.paused);};
 const hourVal=id=>{const v=$w(id).value;return v==='off'?null:Number(v);};
 const collect=()=>{
  readPeriods();
  const out={paused:Boolean(s.paused),every:Number($w('#w-every').value),periods:s.periods,quietHours:[hourVal('#w-quiet-from'),hourVal('#w-quiet-to')],digestHour:hourVal('#w-digest'),
   lookahead:{morning:hourVal('#w-la-morning'),evening:hourVal('#w-la-evening')},models:structuredClone(s.models||{})};
  if(s.firstPass)out.firstPass={enabled:Boolean(s.firstPass.enabled),provider:$w('#w-fp-provider')?.value||s.firstPass.provider,threshold:Number($w('#w-fp-threshold')?.value||s.firstPass.threshold)};
  sh.querySelectorAll('#w-models [data-job]').forEach(row=>{out.models[row.dataset.job]={model:row.querySelector('[data-model]').value,reasoning:row.querySelector('[data-reasoning]').value};});
  const bad=out.periods.findIndex(x=>!x.days.length||!x.from||!x.to);
  if(bad>=0)throw new Error(`Period ${bad+1} needs at least one day and a start and end time.`);
  return out;
 };
 const save=async(settings,done)=>{
  const err=$w('#w-error');err.textContent='';const btn=$w('#w-save');btn.disabled=true;
  try{w={...w,...await api('/inbox/watch',{method:'POST',body:JSON.stringify({source:w.source,settings}),signal:AbortSignal.timeout(8000)})};toast(done);
   if(!settings){closeCurrentSheet?.();return inboxWatchSheet();}
   $w('#w-status').textContent=watchStatus(w);if(!$w('#w-reset'))$w('.watch-actions').insertAdjacentHTML('beforeend','<button class="chip" id="w-reset">Use the config file’s settings</button>'),bindReset();}
  catch(e){err.textContent=e.message||'Could not save';}finally{btn.disabled=false;}
 };
 $w('#w-save').onclick=()=>{let v;try{v=collect();}catch(e){$w('#w-error').textContent=e.message;return;}save(v,'Saved. Inbox Watch picks it up within a minute');};
 const bindReset=()=>{const r=$w('#w-reset');if(r)r.onclick=()=>save(null,'Back to the config file’s settings');};bindReset();
 // While the sheet is open, the status and the cost table keep up; the form is left as you have it.
 const poll=setInterval(async()=>{if(!sh.isConnected)return clearInterval(poll);try{const n=await api('/inbox/watch?source='+encodeURIComponent(w.source));w={...w,profile:n.profile,revision:n.revision};$w('#w-status').textContent=watchStatus(w);if(dev&&$w('#w-usage'))$w('#w-usage').innerHTML=watchUsageHTML(n.profile?.usage);}catch{}},20000);
}
