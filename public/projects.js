/* Projects (1.29): the tracked-project board inside Pocket Code. Off until Settings → Tools turns it on
   (window.pocketFeatures.projects, from /api/me). Views: the list (#/projects), one card (#/projects/<id>)
   and Scheduled (#/projects/scheduled). A view opens like a session: as a tab, beside a conversation, or
   full-screen on the phone. Data comes from /api/board; every change goes through /api/board/act and the
   returned card replaces the local one, so a stale edit shows the current card instead of overwriting it. */
const viewHref=id=>'#/'+id; // isViewId, tabHref: workspace.js
const projectsOn=()=>Boolean(window.pocketFeatures?.projects);
let boardSnap=null,boardAt=0,boardLoading=null,boardView=null;
const projectById=id=>boardSnap?.projects.find(p=>p.id===id)||null;
async function loadBoard(force){
 if(!force&&boardSnap&&Date.now()-boardAt<4000)return boardSnap;
 if(boardLoading)return boardLoading;
 boardLoading=api('/board').then(s=>{boardSnap=s;boardAt=Date.now();return s;}).finally(()=>{boardLoading=null;});
 return boardLoading;
}
function mergeProject(p){
 if(!boardSnap)return;const i=boardSnap.projects.findIndex(x=>x.id===p.id);
 if(i<0)boardSnap.projects.push(p);else boardSnap.projects[i]=p;
 const now=Date.now();
 boardSnap.scheduled=boardSnap.projects.flatMap(q=>q.reminders.map(r=>({...r,due:Date.parse(r.dueAt)<=now,project:q.id,projectName:q.name,projectStatus:q.status,taskText:r.task?q.tasks.find(t=>t.id===r.task)?.text||'':''}))).sort((a,b)=>Date.parse(a.dueAt)-Date.parse(b.dueAt));
 boardSnap.dueCount=boardSnap.scheduled.filter(r=>r.due).length;
}
async function boardAct(body,done){
 try{const r=await api('/board/act',{method:'POST',body:JSON.stringify(body)});mergeProject(r.project);if(done)toast(done);paintProjectsView();paintProjectBadges();return r.project;}
 catch(e){const cur=e.body?.project;if(e.status===409&&cur){mergeProject(cur);paintProjectsView();}toast(e.message||'Could not update the project');return null;}
}
const boardDueCount=()=>boardSnap?.dueCount||0;
const viewTitle=id=>id==='projects'?'Projects':id==='projects/scheduled'?'Scheduled':projectById(id.slice(9))?.name||'Project';
const fmtDue=iso=>{const d=new Date(iso),now=new Date();const sameYear=d.getFullYear()===now.getFullYear();return d.toLocaleDateString('en-US',{month:'short',day:'numeric',...(sameYear?{}:{year:'numeric'})})+' '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});};
const fmtStamp=iso=>rel(Date.parse(iso));
const statusWord={active:'Active',waiting:'Waiting',done:'Done'};

/* ---------- the three views ---------- */
async function renderProjects(view){
 Voice.onLeave?.();
 boardView=view;
 const kind=view==='projects'?'list':view==='projects/scheduled'?'scheduled':'card';
 const col=`<header class="bar">
   ${PANE?`<button class="icon" id="pane-main" aria-label="Make this the main view">${IC.swap}</button>`:`<button class="icon" id="back" aria-label="Back">${IC.back}</button><button class="icon desk" id="railtog" aria-label="Show or hide the session list">${IC.panel}</button>`}
   <h1><span class="one" id="ptitle">${esc(viewTitle(view))}</span><span class="tag" id="ptag">${kind==='list'?'Tracked work':kind==='scheduled'?'Reminders, due first':'Project'}</span></h1>
   ${kind==='card'?`<button class="icon" id="pmore" aria-label="Project options">${IC.more}</button>`:''}
   ${PANE?'':`<button class="icon desk" id="splitb" aria-label="Split view">${IC.columns}</button>`}
   ${PANE?`<button class="icon" id="pane-close" aria-label="Close this pane">${IC.x}</button>`:''}
  </header>
  <main class="scroll projects-view" id="projects-main" data-kind="${kind}" tabindex="-1"><p class="sheet-help projects-loading">Loading projects…</p></main>`;
 app.innerHTML=withShell(col);
 wireShell();
 if(PANE){$('#pane-main').onclick=()=>paneSay('main',{view});$('#pane-close').onclick=()=>paneSay('close');}
 else{$('#back').onclick=()=>{location.hash='#/';};$('#splitb').onclick=chooseBeside;}
 $('#pmore')?.addEventListener('click',()=>projectOptions(view.slice(9)));
 const tog=$('#railtog');if(tog)tog.onclick=()=>{localStorage.setItem('pc-rail',railOpen()?'closed':'open');route();};
 try{await Promise.all([loadBoard(true),typeof refreshSessions==='function'?refreshSessions().catch(()=>{}):null]);} // session names and marks for the linked list
 catch(e){const main=$('#projects-main');if(!main)return;main.innerHTML=`<p class="sheet-help">${esc(e.status===404?'Projects is off for this Pocket Code. Turn it on in Settings → Tools.':'Projects could not load: '+(e.message||'error'))}</p>`;return;}
 if(boardView!==view)return;
 if(kind==='card'&&!projectById(view.slice(9))){$('#projects-main').innerHTML='<p class="sheet-help">That project does not exist. It may have been removed on another device.</p>';return;}
 if(PANE)paneSay('route',{id:view,title:viewTitle(view)});else rememberOpenView(view,viewTitle(view)); // a pane's view is not a tab of the outer window
 paintProjectsView();
}
function paintProjectsView(){
 const main=$('#projects-main');if(!main||!boardSnap||!boardView)return;
 const kind=main.dataset.kind;
 // Never repaint under a typing user; an emptied form (just submitted) repaints and keeps its focus for the next entry.
 const typing=main.contains(document.activeElement)&&document.activeElement.matches('input,textarea')?document.activeElement:null;
 if(typing&&typing.value)return;
 const refocus=typing?(typing.closest('[data-task-add]')?'[data-task-add] input':typing.closest('[data-note-add]')?'[data-note-add] input':null):null;
 if(kind==='list')main.innerHTML=projectListHTML();
 else if(kind==='scheduled')main.innerHTML=scheduledHTML();
 else{const p=projectById(boardView.slice(9));if(!p)return;main.innerHTML=projectCardHTML(p);const t=$('#ptitle');if(t)t.textContent=p.name;const g=$('#ptag');if(g)g.textContent=statusWord[p.status]+(p.directory?' · '+projShort(p.directory):'');}
 bindProjectsView(main);
 if(refocus)main.querySelector(refocus)?.focus({preventScroll:true});
 paintProjectBadges();
 if(typeof paintOpenSessions==='function')paintOpenSessions();
}
const sessionMarkHTML=id=>{const st=typeof tabState==='function'?tabState(id):null;return st?`<span class="tab-state ${st.kind==='running'?'ember':'tab-'+st.kind}" role="img" aria-label="${esc(st.label)}"></span>`:'';};
const sessionName=id=>(typeof allSessions!=='undefined'&&allSessions.find(s=>s.id===id)?.title)||(typeof openSessions!=='undefined'&&openSessions.find(s=>s.id===id)?.title)||'Session '+id.replace(/^cx:/,'').slice(0,8);
function projectRowHTML(p){
 const due=p.dueCount?`<span class="due-label">${p.dueCount===1?'Reminder due':p.dueCount+' reminders due'}</span>`:p.reminders[0]?`<span>Reminder ${esc(fmtDue(p.reminders[0].dueAt))}</span>`:'';
 const steps=p.openTasks?`<span>${p.openTasks} open step${p.openTasks===1?'':'s'}</span>`:'';
 const marks=p.sessions.map(sessionMarkHTML).join('');
 return `<div class="session-item project-item ${boardView==='projects/'+p.id?'cur':''}" data-item="${esc(p.id)}">
  <a class="row" href="${viewHref('projects/'+p.id)}" data-project="${esc(p.id)}"><span class="body"><span class="title">${esc(p.name)}</span>
   <span class="meta">${esc(p.next||p.summary||(p.status==='waiting'&&p.waitingFor?'Waiting for '+p.waitingFor:'No next step yet'))}</span>
   <span class="session-status">${marks?`<span class="project-marks">${marks}</span>`:''}${[due,steps].filter(Boolean).join('<span aria-hidden="true">·</span>')}</span></span></a>
  <button class="session-more icon" data-project-more="${esc(p.id)}" aria-label="Options for ${esc(p.name)}">${IC.more}</button></div>`;
}
function projectListHTML(){
 const groups=[['active','Active'],['waiting','Waiting'],['done','Done']].map(([k,label])=>[k,label,boardSnap.projects.filter(p=>p.status===k)]);
 const due=boardDueCount();
 const body=groups.map(([k,label,rows])=>!rows.length?'':k==='done'
  ?`<details class="session-group project-group settings-details"><summary><h2>${label} <span>${rows.length}</span></h2></summary>${rows.map(projectRowHTML).join('')}</details>`
  :`<section class="session-group project-group"><h2>${label} <span>${rows.length}</span></h2>${rows.map(projectRowHTML).join('')}</section>`).join('');
 return `<div class="session-home-head"><h2>Projects</h2><span class="project-head-actions"><a class="chip ${due?'due':''}" href="${viewHref('projects/scheduled')}" data-view-link>Scheduled${due?' · '+due+' due':''}</a><button class="chip" id="pj-track">Track a project</button></span></div>
  ${boardSnap.projects.length?body:`<p class="sheet-help project-empty">No tracked projects yet. Track one here, or from a session's options, when there is work you want to keep a card for. Agents can keep a card current with <code>pocket-board</code>.</p>`}`;
}
function scheduledHTML(){
 const rows=boardSnap.scheduled;
 return `<div class="session-home-head"><h2>Scheduled</h2><a class="chip" href="${viewHref('projects')}" data-view-link>All projects</a></div>
  <p class="sheet-help">Every open reminder across your projects, due first. Only reminders Pocket Code itself keeps appear here${boardSnap.push?.enabled?'; each is sent to your devices once when it comes due':''}${boardSnap.hook?', and to this server\'s reminder hook':''}.</p>
  ${rows.length?rows.map(r=>`<div class="session-item reminder-item ${r.due?'due':''}" data-item="${esc(r.id)}">
   <a class="row" href="${viewHref('projects/'+r.project)}" data-project="${esc(r.project)}"><span class="body"><span class="title">${esc(r.label)}</span><span class="meta">${esc(r.projectName)}${r.taskText&&r.taskText!==r.label?' · '+esc(r.taskText):''}</span>
    <span class="session-status">${r.due?'<span class="due-label">Due</span>':''}<span>${esc(fmtDue(r.dueAt))}</span></span></span></a>
   <button class="session-more icon" data-reminder-more="${esc(r.project)}/${esc(r.id)}" aria-label="Options for reminder ${esc(r.label)}">${IC.more}</button></div>`).join('')
  :'<p class="sheet-help project-empty">No open reminders. Set one from a project card with Remind me.</p>'}`;
}
function projectCardHTML(p){
 const done=p.status==='done',tasksDone=p.tasks.filter(t=>t.done).length;
 const field=(label,text,empty)=>`<section class="project-field"><h2>${label}</h2>${text?`<p>${esc(text)}</p>`:`<p class="project-empty">${empty}</p>`}</section>`;
 return `<article class="project-card">
  <div class="project-head"><span class="project-status status-${p.status}">${statusWord[p.status]}</span><span class="project-meta">Updated ${esc(fmtStamp(p.updated))} · Verified ${esc(fmtStamp(p.verified))}${p.enrollment==='suggested'?' · Suggested by an agent':''}</span></div>
  ${field('Where we left off',p.summary,'No summary yet.')}
  ${field('Next',p.next,'No next step recorded.')}
  ${p.waitingFor||p.status==='waiting'?field('Waiting for',p.waitingFor,'Nothing recorded.'):''}
  ${p.directory||p.link?`<section class="project-field project-links">${p.directory?`<span class="ledger"><span class="name">Directory</span><span class="det">${esc(projShort(p.directory))}</span></span>`:''}${p.link?`<a class="ledger" href="${esc(p.link)}" target="_blank" rel="noopener noreferrer"><span class="name">Link</span><span class="det">${esc(p.link.replace(/^https?:\/\//,''))}</span></a>`:''}</section>`:''}
  <section class="project-tasks"><h2>Steps <span>${p.tasks.length?`${tasksDone} of ${p.tasks.length} done`:''}</span></h2>
   ${p.tasks.length?`<ul class="task-list">${p.tasks.map(t=>{const rem=p.reminders.find(r=>r.task===t.id);return `<li class="task-row ${t.done?'completed':''}"><label class="task-label"><input type="checkbox" data-task="${esc(t.id)}" ${t.done?'checked':''} ${done?'disabled':''}><span>${esc(t.text)}</span></label>${rem?`<small class="task-meta ${rem.due?'due-label':''}">${rem.due?'Due':'Reminder'} ${esc(fmtDue(rem.dueAt))}</small>`:''}${done?'':`<button class="icon task-more" data-task-more="${esc(t.id)}" aria-label="Options for step ${esc(t.text)}">${IC.more}</button>`}</li>`;}).join('')}</ul>`:''}
   ${done?'':`<form class="task-add" data-task-add><input name="text" maxlength="300" required placeholder="Add a remaining step" aria-label="New step" autocomplete="off"><button class="chip" type="submit">Add</button></form>`}</section>
  ${p.reminders.length?`<section class="project-reminders"><h2>Reminders</h2>${p.reminders.map(r=>`<div class="reminder ${r.due?'due':''}" data-reminder="${esc(r.id)}"><p class="reminder-title">${esc(r.label)}</p><p class="${r.due?'due-label':'project-meta'}">${r.due?'Due · ':''}${esc(fmtDue(r.dueAt))}${r.task?' · on a step':''}</p><div class="reminder-actions"><button class="chip" data-remind-later="${esc(r.id)}">Remind later</button><button class="chip" data-dismiss="${esc(r.id)}">Dismiss</button>${r.due&&p.status==='waiting'?'<button class="chip set" data-resume>Resume project</button>':''}</div></div>`).join('')}</section>`:''}
  <section class="project-sessions"><h2>Sessions <span>${p.sessions.length||''}</span></h2>
   ${p.sessions.length?p.sessions.map(id=>`<div class="session-item linked-session" data-item="${esc(id)}"><a class="row" href="#/chat/${esc(id)}"><span class="body"><span class="title">${sessionMarkHTML(id)}${esc(sessionName(id))}</span><span class="meta">${id.startsWith('cx:')?'Codex':'Claude'}${typeof tabState==='function'&&tabState(id)?' · '+esc(tabState(id).label):''}</span></span></a><button class="session-more icon" data-session-more="${esc(id)}" aria-label="Options for ${esc(sessionName(id))}">${IC.more}</button></div>`).join('')
   :'<p class="project-empty">No sessions linked. From a session\'s options, choose Add to project.</p>'}</section>
  <section class="project-notes"><form class="task-add" data-note-add><input name="text" maxlength="600" required placeholder="Add a note" aria-label="New note" autocomplete="off"><button class="chip" type="submit">Note</button></form></section>
  <details class="settings-details project-history"><summary>History<span class="summary-meta">${p.history.length}</span></summary><ul>${p.history.slice().reverse().map(h=>`<li><span class="ledger"><span class="name">${esc(fmtDue(h.at))}</span><span class="det">${esc(historyLine(h))}</span></span></li>`).join('')}</ul></details>
  <div class="project-actions">${done?'<button class="chip set" data-resume>Resume project</button>':`<button class="chip" data-edit>Edit</button><button class="chip" data-remind>Remind me</button><button class="chip" data-finish>Finish project</button>`}</div>
 </article>`;
}
function historyLine(h){
 const who=h.actor==='cli'?'agent':h.actor==='import'?'import':'you';
 let d=h.detail;try{const o=JSON.parse(d);if(o&&typeof o==='object')d=Object.entries(o).map(([k,v])=>`${k}: ${typeof v==='string'?v:JSON.stringify(v)}`).join('; ');}catch{}
 return `${h.action.replace(/-/g,' ')} (${who})${d?' · '+d:''}`;
}
function bindProjectsView(main){
 main.querySelector('#pj-track')?.addEventListener('click',()=>projectEditor(null));
 main.querySelectorAll('[data-project-more]').forEach(b=>b.onclick=()=>projectOptions(b.dataset.projectMore));
 main.querySelectorAll('[data-reminder-more]').forEach(b=>b.onclick=()=>{const [project,id]=b.dataset.reminderMore.split('/');reminderOptions(project,id);});
 main.querySelectorAll('a[data-project]').forEach(a=>a.onclick=e=>{if(!PANE&&isWide()&&readLocal('pc-projects-open','tab')==='beside'&&typeof openBeside==='function'&&boardView!=='projects/'+a.dataset.project&&e.button===0&&!e.metaKey&&!e.ctrlKey){e.preventDefault();openBeside('projects/'+a.dataset.project);}});
 const id=boardView?.startsWith('projects/')&&boardView!=='projects/scheduled'?boardView.slice(9):null;if(!id)return;
 const p=projectById(id);if(!p)return;
 const act=(body,msg)=>boardAct({...body,project:id,expected_revision:p.revision},msg);
 main.querySelectorAll('[data-task]').forEach(cb=>cb.onchange=async()=>{cb.disabled=true;if(!await act({action:'task-update',task:cb.dataset.task,done:cb.checked},cb.checked?'Step done':'Step reopened'))cb.checked=!cb.checked;cb.disabled=false;});
 main.querySelectorAll('[data-task-more]').forEach(b=>b.onclick=()=>taskOptions(id,b.dataset.taskMore));
 main.querySelector('[data-task-add]')?.addEventListener('submit',e=>{e.preventDefault();const input=e.target.elements.text;const text=input.value.trim();if(!text)return;input.value='';act({action:'task-add',text},'Step added').then(ok=>{if(!ok)input.value=text;});});
 main.querySelector('[data-note-add]')?.addEventListener('submit',e=>{e.preventDefault();const input=e.target.elements.text;const text=input.value.trim();if(!text)return;input.value='';act({action:'note',text},'Note added').then(ok=>{if(!ok)input.value=text;});});
 main.querySelectorAll('[data-remind-later]').forEach(b=>b.onclick=()=>reminderSheet(id,p.reminders.find(r=>r.id===b.dataset.remindLater)?.task||null));
 main.querySelectorAll('[data-dismiss]').forEach(b=>b.onclick=()=>confirmSheet('Dismiss this reminder?','Dismissing stops it. The project and its steps stay as they are.','Dismiss reminder',()=>act({action:'reminder-dismiss',reminder:b.dataset.dismiss},'Reminder dismissed')));
 main.querySelectorAll('[data-resume]').forEach(b=>b.onclick=()=>act({action:'update',status:'active'},'Project resumed'));
 main.querySelector('[data-edit]')?.addEventListener('click',()=>projectEditor(p));
 main.querySelector('[data-remind]')?.addEventListener('click',()=>reminderSheet(id,null));
 main.querySelector('[data-finish]')?.addEventListener('click',()=>confirmSheet('Finish this project?','It moves to Done and its reminders stop. Unchecked steps stay in its history; Resume brings it back without them.','Finish project',()=>act({action:'update',status:'done'},'Project finished')));
 main.querySelectorAll('[data-session-more]').forEach(b=>b.onclick=()=>linkedSessionOptions(id,b.dataset.sessionMore));
}
/* ---------- sheets ---------- */
function confirmSheet(title,help,yes,onYes){
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet';
 sh.innerHTML=`<h2>${esc(title)}</h2><p class="sheet-help">${esc(help)}</p><button class="opt" data-yes>${IC.tick}<span>${esc(yes)}</span></button><button class="opt" data-no>${IC.x}<span>Keep it as it is</span></button>`;
 sh.querySelector('[data-yes]').onclick=()=>{closeCurrentSheet?.();onYes();};sh.querySelector('[data-no]').onclick=()=>closeCurrentSheet?.();
 mountSheet(scrim,sh);
}
function projectOptions(id){
 const p=projectById(id);if(!p)return;
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet';
 const here=boardView==='projects/'+id;
 sh.innerHTML=`<h2>Project options</h2><p class="sheet-name">${esc(p.name)}</p>
  ${here?'':`<button class="opt" data-open>${IC.folder}<span>Open<span class="sub">Show the card here</span></span></button>`}
  ${!PANE&&isWide()&&!here&&typeof openBeside==='function'?`<button class="opt" data-beside>${IC.columns}<span>Open beside<span class="sub">Show the card next to the current view</span></span></button>`:''}
  ${p.status==='done'?`<button class="opt" data-resume>${IC.up}<span>Resume project<span class="sub">Back to Active, without its old reminders</span></span></button>`:`<button class="opt" data-edit>${IC.pen}<span>Edit<span class="sub">Name, summary, next step, waiting for, directory, link</span></span></button>
  <button class="opt" data-remind>${IC.hourglass}<span>Remind me<span class="sub">A reminder for the project, sent once when due</span></span></button>
  ${p.status==='waiting'?`<button class="opt" data-active>${IC.tick}<span>Mark active<span class="sub">No longer waiting on anyone</span></span></button>`:`<button class="opt" data-waiting>${IC.hourglass}<span>Mark waiting<span class="sub">Waiting on someone or something; say who in Edit</span></span></button>`}
  <button class="opt" data-finish>${IC.tick}<span>Finish project<span class="sub">Moves it to Done and stops its reminders</span></span></button>`}`;
 const close=()=>closeCurrentSheet?.();
 const act=(body,msg)=>boardAct({...body,project:id,expected_revision:p.revision},msg);
 sh.querySelector('[data-open]')?.addEventListener('click',()=>{close();location.hash=viewHref('projects/'+id);});
 sh.querySelector('[data-beside]')?.addEventListener('click',()=>{close();openBeside('projects/'+id);});
 sh.querySelector('[data-edit]')?.addEventListener('click',()=>{close();projectEditor(p);});
 sh.querySelector('[data-remind]')?.addEventListener('click',()=>{close();reminderSheet(id,null);});
 sh.querySelector('[data-active]')?.addEventListener('click',()=>{close();act({action:'update',status:'active'},'Project active');});
 sh.querySelector('[data-waiting]')?.addEventListener('click',()=>{close();act({action:'update',status:'waiting'},'Project waiting');});
 sh.querySelector('[data-resume]')?.addEventListener('click',()=>{close();act({action:'update',status:'active'},'Project resumed');});
 sh.querySelector('[data-finish]')?.addEventListener('click',()=>{close();confirmSheet('Finish this project?','It moves to Done and its reminders stop. Unchecked steps stay in its history.','Finish project',()=>act({action:'update',status:'done'},'Project finished'));});
 mountSheet(scrim,sh);
}
function reminderOptions(project,id){
 const p=projectById(project),r=p?.reminders.find(x=>x.id===id);if(!r)return;
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet';
 sh.innerHTML=`<h2>Reminder</h2><p class="sheet-name">${esc(r.label)}</p><p class="sheet-help">${esc(p.name)} · ${esc(fmtDue(r.dueAt))}</p>
  <button class="opt" data-open>${IC.folder}<span>Open project</span></button>
  <button class="opt" data-later>${IC.hourglass}<span>Remind later<span class="sub">Pick a new time; this reminder is replaced</span></span></button>
  <button class="opt" data-dismiss>${IC.x}<span>Dismiss<span class="sub">Stops this reminder. The project stays open</span></span></button>`;
 const close=()=>closeCurrentSheet?.();
 sh.querySelector('[data-open]').onclick=()=>{close();location.hash=viewHref('projects/'+project);};
 sh.querySelector('[data-later]').onclick=()=>{close();reminderSheet(project,r.task||null);};
 sh.querySelector('[data-dismiss]').onclick=()=>{close();boardAct({action:'reminder-dismiss',project,expected_revision:p.revision,reminder:id},'Reminder dismissed');};
 mountSheet(scrim,sh);
}
function taskOptions(project,taskId){
 const p=projectById(project),t=p?.tasks.find(x=>x.id===taskId);if(!t)return;
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet';
 sh.innerHTML=`<h2>Step</h2><p class="sheet-name">${esc(t.text)}</p>
  <button class="opt" data-remind>${IC.hourglass}<span>Remind me about this step</span></button>
  <button class="opt" data-edit>${IC.pen}<span>Edit the text</span></button>`;
 const close=()=>closeCurrentSheet?.();
 sh.querySelector('[data-remind]').onclick=()=>{close();reminderSheet(project,taskId);};
 sh.querySelector('[data-edit]').onclick=()=>{close();textSheet('Edit step',t.text,300,text=>boardAct({action:'task-update',project,expected_revision:p.revision,task:taskId,text},'Step updated'));};
 mountSheet(scrim,sh);
}
function linkedSessionOptions(project,sessionId){
 const p=projectById(project);if(!p)return;
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet';
 sh.innerHTML=`<h2>Linked session</h2><p class="sheet-name">${esc(sessionName(sessionId))}</p>
  <button class="opt" data-open>${IC.folder}<span>Open session</span></button>
  ${!PANE&&isWide()&&typeof openBeside==='function'?`<button class="opt" data-beside>${IC.columns}<span>Open beside<span class="sub">Show it next to this card</span></span></button>`:''}
  <button class="opt" data-unlink>${IC.x}<span>Unlink from this project<span class="sub">The session and its history are untouched</span></span></button>`;
 const close=()=>closeCurrentSheet?.();
 sh.querySelector('[data-open]').onclick=()=>{close();location.hash='#/chat/'+sessionId;};
 sh.querySelector('[data-beside]')?.addEventListener('click',()=>{close();openBeside(sessionId);});
 sh.querySelector('[data-unlink]').onclick=()=>{close();boardAct({action:'unlink-session',project,expected_revision:p.revision,session:sessionId},'Session unlinked');};
 mountSheet(scrim,sh);
}
function textSheet(title,value,max,onSave){
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet';
 sh.innerHTML=`<h2>${esc(title)}</h2><form class="project-form"><label class="voice-field">Text<input name="text" maxlength="${max}" required value="${esc(value)}"></label><button class="primary" type="submit">Save</button></form>`;
 sh.querySelector('form').onsubmit=e=>{e.preventDefault();const text=e.target.elements.text.value.trim();if(!text)return;closeCurrentSheet?.();onSave(text);};
 mountSheet(scrim,sh);
}
// Track (p = null) or edit a project. The directory defaults to the session's workspace when tracking from a session.
function projectEditor(p,{directory='',session=null,onDone}={}){
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet project-editor';
 const v=k=>esc(p?.[k]??'');
 sh.innerHTML=`<h2>${p?'Edit project':'Track a project'}</h2>
  ${p?'':'<p class="sheet-help">A card for work you want to keep track of: where you left off, the next step, remaining steps and reminders. Sessions can be linked to it.</p>'}
  <form class="project-form">
   <label class="voice-field">Name<input name="name" maxlength="120" required value="${v('name')}" autocomplete="off"></label>
   <label class="voice-field">Where we left off<textarea name="summary" maxlength="600" rows="3">${v('summary')}</textarea></label>
   <label class="voice-field">Next step<textarea name="next" maxlength="600" rows="2">${v('next')}</textarea></label>
   ${p?`<label class="voice-field">Waiting for<input name="waitingFor" maxlength="600" value="${v('waitingFor')}" placeholder="Who or what, if the project is waiting"></label>`:''}
   <label class="voice-field">Directory<input name="directory" maxlength="1024" value="${p?v('directory'):esc(directory)}" placeholder="/full/path, so agents working there find this card"></label>
   <label class="voice-field">Link<input name="link" maxlength="1024" type="url" value="${v('link')}" placeholder="https://"></label>
   <button class="primary" type="submit">${p?'Save changes':'Track project'}</button>
  </form>`;
 sh.querySelector('form').onsubmit=async e=>{
  e.preventDefault();const f=Object.fromEntries(new FormData(e.target));const btn=e.target.querySelector('button');btn.disabled=true;
  const body=p?{action:'update',project:p.id,expected_revision:p.revision,...f}:{action:'track',...f,requested:true,...(session?{session}:{})};
  const out=await boardAct(body,p?'Project updated':'Project tracked');
  btn.disabled=false;if(!out)return;closeCurrentSheet?.();
  if(onDone)onDone(out);else if(!p)location.hash=viewHref('projects/'+out.id);
 };
 mountSheet(scrim,sh);
}
// A reminder for the project (task = null) or one step. Quick picks are in this device's time zone; the
// time goes to the server as an exact instant, so the install's zone never changes it.
function reminderSheet(project,task){
 const p=projectById(project);if(!p)return;
 const at=(days,hour)=>{const d=new Date();d.setDate(d.getDate()+days);d.setHours(hour,0,0,0);return d;};
 const nextMonday=()=>{const d=at(((8-new Date().getDay())%7)||7,9);return d;};
 const picks=[['tomorrow','Tomorrow morning',at(1,9)],['three','In three days',at(3,9)],['monday','Next Monday',nextMonday()],['week','In a week',at(7,9)]];
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet';
 const t=task?p.tasks.find(x=>x.id===task):null;
 sh.innerHTML=`<h2>Remind me</h2><p class="sheet-name">${esc(t?t.text:p.name)}</p>
  ${picks.map(([k,label,d])=>`<button class="opt" data-pick="${k}"><span class="dot"></span><span>${label}<span class="sub">${esc(fmtDue(d.toISOString()))}</span></span></button>`).join('')}
  <form class="project-form reminder-form"><label class="voice-field">Another time<input type="datetime-local" name="when" required></label><label class="voice-field">Says<input name="text" maxlength="600" placeholder="${esc(t?t.text:'Revisit '+p.name)}" autocomplete="off"></label><button class="primary" type="submit">Set reminder</button></form>`;
 const send=(d,text)=>{closeCurrentSheet?.();boardAct({action:'remind',project,expected_revision:p.revision,at:d.toISOString(),task:task||undefined,text:text||''},'Reminder set for '+fmtDue(d.toISOString()));};
 sh.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>send(picks.find(x=>x[0]===b.dataset.pick)[2],sh.querySelector('[name=text]').value.trim()));
 sh.querySelector('form').onsubmit=e=>{e.preventDefault();const d=new Date(e.target.elements.when.value);if(Number.isNaN(d.getTime()))return toast('Pick a date and time.');if(d.getTime()<Date.now()-60000)return toast('That time has passed.');send(d,e.target.elements.text.value.trim());};
 mountSheet(scrim,sh);
}
// From a session's options: track a new project around this session, or add it to an existing one.
function addSessionToProject(s){
 if(!boardSnap)return loadBoard(true).then(()=>addSessionToProject(s)).catch(e=>toast(e.status===404?'Projects is off. Turn it on in Settings → Tools.':e.message));
 const open=boardSnap.projects.filter(p=>p.status!=='done'&&!p.sessions.includes(s.id));
 const rows=[['__new','Track a new project','A card around this session; its workspace becomes the directory'],...open.map(p=>[p.id,p.name,p.next||p.summary||statusWord[p.status]])];
 sheet('Add to project',rows,null,v=>{
  if(v==='__new')return projectEditor(null,{directory:s.cwd||'',session:s.id});
  const p=projectById(v);boardAct({action:'link-session',project:v,expected_revision:p.revision,session:s.id},'Added to '+p.name);
 });
}
// The conversation's Project control (1.29): the linked project's name, opening its card the way this browser
// opens projects, or "Project" offering Add to project. Hidden while the feature is off.
let chatSessionRow=null;
function paintChatProject(s){
 if(s)chatSessionRow=s;
 const b=$('#project-open');if(!b)return;
 if(!projectsOn()||!chatId){b.hidden=true;return;}
 b.hidden=false;
 const linked=boardSnap?.projects.find(p=>p.status!=='done'&&p.sessions.includes(chatId))||boardSnap?.projects.find(p=>p.sessions.includes(chatId))||null;
 b.textContent=linked?linked.name:'Project';b.title=linked?'Open the project '+linked.name:'Track this session as a project, or add it to one';
 b.classList.toggle('linked',Boolean(linked));
 b.onclick=()=>{
  const row=chatSessionRow||allSessions.find(r=>r.id===chatId)||{id:chatId,title:chatTitle,cwd:''};
  if(!linked)return addSessionToProject(row);
  if(!PANE&&isWide()&&readLocal('pc-projects-open','tab')==='beside'&&typeof openBeside==='function')openBeside('projects/'+linked.id);else location.hash=viewHref('projects/'+linked.id);
 };
 if(!boardSnap)loadBoard().then(()=>paintChatProject()).catch(()=>{});
}
/* ---------- tabs, rail, home and badges ---------- */
function rememberOpenView(id,title){
 if(typeof openSessions==='undefined')return;
 const row={id,title},index=openSessions.findIndex(r=>r.id===id);
 if(index<0)openSessions.push(row);else openSessions[index]=row;
 if(openSessions.length>12)openSessions.shift();
 writeLocal('pc-open-sessions',openSessions);paintOpenSessions();
}
const viewTabState=id=>{if(!boardSnap)return null;const p=id==='projects'||id==='projects/scheduled'?null:projectById(id.slice(9));const due=p?p.dueCount:boardDueCount();return due?{kind:'due',label:due===1?'A reminder is due':due+' reminders are due'}:null;};
function railProjectsHTML(){
 if(!boardSnap)return '<p class="sheet-help">Loading projects…</p>';
 const due=boardDueCount(),rows=boardSnap.projects.filter(p=>p.status!=='done');
 return `<div class="rail-projects"><div class="rail-project-actions"><a class="chip ${due?'due':''}" href="${viewHref('projects/scheduled')}" data-view-link>Scheduled${due?' · '+due:''}</a><button class="chip" id="rail-track">Track</button><a class="chip" href="${viewHref('projects')}" data-view-link>All</a></div>
  ${rows.length?rows.map(projectRowHTML).join(''):'<p class="sheet-help">No active projects. Track one to keep a card for it.</p>'}
  ${boardSnap.projects.some(p=>p.status==='done')?`<a class="rail-done-link" href="${viewHref('projects')}" data-view-link>${boardSnap.projects.filter(p=>p.status==='done').length} finished</a>`:''}</div>`;
}
function paintRailProjects(){
 const el=document.getElementById('rail');if(!el||railView()!=='projects')return;
 el.innerHTML=railProjectsHTML();
 el.querySelector('#rail-track')?.addEventListener('click',()=>projectEditor(null));
 el.querySelectorAll('[data-project-more]').forEach(b=>b.onclick=()=>projectOptions(b.dataset.projectMore));
 el.querySelectorAll('a[data-project]').forEach(a=>a.onclick=e=>{if(readLocal('pc-projects-open','tab')==='beside'&&typeof openBeside==='function'&&chatId&&e.button===0&&!e.metaKey&&!e.ctrlKey){e.preventDefault();openBeside('projects/'+a.dataset.project);}});
 if(!boardSnap)loadBoard().then(()=>{paintRailProjects();paintProjectBadges();}).catch(()=>{const r=document.getElementById('rail');if(r&&railView()==='projects')r.innerHTML='<p class="sheet-help">Projects could not load.</p>';});else paintProjectBadges();
}
function paintProjectBadges(){
 const due=boardDueCount();
 paintChatProject();
 document.querySelectorAll('[data-projects-badge]').forEach(el=>{el.textContent=due?String(due):'';el.hidden=!due;});
 document.querySelectorAll('[data-projects-home]').forEach(el=>{el.textContent='Projects'+(due?' · '+due+' due':'');el.classList.toggle('due',due>0);});
}
// Keep the due counts and an open view fresh without a reload; the list poll is cheap and private.
setInterval(()=>{if(!projectsOn()||document.visibilityState!=='visible'||!(boardView||railView()==='projects'||document.querySelector('[data-projects-home]')))return;loadBoard(true).then(()=>{paintProjectsView();paintRailProjects();paintProjectBadges();if(typeof paintOpenSessions==='function')paintOpenSessions();}).catch(()=>{});},30000);
