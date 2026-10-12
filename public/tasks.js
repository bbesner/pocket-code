/* Tasks (1.36): to-dos kept beside sessions, projects and files. Off until Settings → Projects, files, tasks & vault turns
   it on (window.pocketFeatures.tasks). One view, the list (#/tasks), which opens like a session: as a tab, beside a
   conversation, in a window of its own, or full-screen on the phone. A task is a line of text with an optional due
   time, the session it came from and, when asked for, a briefing on that session; Start opens a New session with the
   task as its first message, ready to send. Data comes from /api/tasks; every change goes through /api/tasks/act. */
const tasksOn=()=>Boolean(window.pocketFeatures?.tasks);
let tasksSnap=null,tasksAt=0,tasksLoading=null,taskView=null;
const taskById=id=>tasksSnap?.tasks.find(t=>t.id===id)||null;
async function loadTasks(force){
 if(!force&&tasksSnap&&Date.now()-tasksAt<4000)return tasksSnap;
 if(tasksLoading)return tasksLoading;
 tasksLoading=api('/tasks',{signal:AbortSignal.timeout(8000)}).then(s=>{tasksSnap=s;tasksAt=Date.now();return s;}).finally(()=>{tasksLoading=null;});
 return tasksLoading;
}
// Keep the local list in the server's order: open tasks due first then newest, finished ones last.
function mergeTask(t){
 if(!tasksSnap)return;
 tasksSnap.tasks=tasksSnap.tasks.filter(x=>x.id!==t.id);
 if(!t.removed)tasksSnap.tasks.push(t);
 const now=Date.now();
 for(const x of tasksSnap.tasks)x.due=!x.done&&Boolean(x.dueAt)&&Date.parse(x.dueAt)<=now;
 tasksSnap.tasks.sort((a,b)=>a.done!==b.done?(a.done?1:-1):a.done?Date.parse(b.doneAt)-Date.parse(a.doneAt):(a.dueAt&&b.dueAt)?Date.parse(a.dueAt)-Date.parse(b.dueAt):a.dueAt?-1:b.dueAt?1:Date.parse(b.created)-Date.parse(a.created));
 tasksSnap.openCount=tasksSnap.tasks.filter(x=>!x.done).length;tasksSnap.dueCount=tasksSnap.tasks.filter(x=>x.due).length;
}
async function taskAct(body,done){
 try{const r=await api('/tasks/act',{method:'POST',body:JSON.stringify(body)});mergeTask(r.task);if(done)toast(done);paintTasksView();paintRailTasks();paintTaskBadges();return r.task;}
 catch(e){const cur=e.body?.task;if(e.status===409&&cur){mergeTask(cur);paintTasksView();paintRailTasks();}toast(e.message||'Could not update the task');return null;}
}
const taskDueCount=()=>tasksSnap?.dueCount||0;
const taskViewTitle=()=>'Tasks';
const taskWhen=t=>t.dueAt?(t.due?'Due ':'')+fmtDue(t.dueAt):'';

/* ---------- the list view ---------- */
async function renderTasks(view){
 Voice.onLeave?.();
 taskView=view;if(typeof boardView!=='undefined')boardView=null;if(typeof docView!=='undefined')docView=null;
 const col=`<header class="bar">
   ${PANE?`<button class="icon" id="pane-main" aria-label="Make this the main view">${IC.swap}</button>`:SOLO?'':`<button class="icon" id="back" aria-label="Back">${IC.back}</button><button class="icon desk" id="railtog" aria-label="Show or hide the session list">${IC.panel}</button>`}
   <h1><span class="one" id="ktitle">Tasks</span><span class="tag" id="ktag">To do, due first</span></h1>
   ${SOLO?'':`<button class="icon" id="kwin" aria-label="Open in a new window" title="Open in a new window">${IC.external}</button>`}
   ${PANE||SOLO?'':`<button class="icon desk" id="splitb" aria-label="Split view">${IC.columns}</button>`}
   ${PANE?`<button class="icon" id="pane-close" aria-label="Close this pane">${IC.x}</button>`:''}
  </header>
  <main class="scroll projects-view tasks-view" id="tasks-main" tabindex="-1"><p class="sheet-help projects-loading">Loading tasks…</p></main>`;
 app.innerHTML=withShell(col);
 wireShell();
 if(PANE){$('#pane-main').onclick=()=>paneSay('main',{view});$('#pane-close').onclick=()=>paneSay('close');}
 else if(!SOLO){bindViewBack($('#back'),view);$('#splitb').onclick=chooseBeside;}
 $('#kwin')?.addEventListener('click',()=>openInWindow(view));
 const tog=$('#railtog');if(tog)tog.onclick=()=>{localStorage.setItem('pc-rail',railOpen()?'closed':'open');route();};
 try{await Promise.all([loadTasks(true),typeof refreshSessions==='function'?refreshSessions().catch(()=>{}):null]);} // session names for the rows
 catch(e){if(taskView!==view)return;const main=$('#tasks-main');if(!main)return;if(tasksSnap)paintTasksView();showLibraryError(main,e,'Tasks',()=>renderTasks(view),Boolean(tasksSnap));restoreViewPosition(view);return;}
 if(taskView!==view)return;
 if(PANE)paneSay('route',{id:view,title:'Tasks'});else if(SOLO)document.title='Tasks · Pocket Code';else rememberOpenView(view,'Tasks');
 paintTasksView();
 restoreViewPosition(view);
}
function paintTasksView(){
 const main=$('#tasks-main');if(!main||!tasksSnap||!taskView)return;
 main.innerHTML=taskListHTML();
 bindTaskRows(main);
 main.querySelector('#tk-add')?.addEventListener('click',()=>taskEditor(null));
 paintTaskBadges();
 if(typeof paintOpenSessions==='function')paintOpenSessions();
}
function taskRowHTML(t){
 const where=t.session?esc(t.sessionTitle||sessionName(t.session)):'';
 const facts=[t.dueAt?`<span class="${t.due?'due-label':''}">${esc(taskWhen(t))}</span>`:'',where?`<span>${where}</span>`:'',t.summary?'<span>With context</span>':''].filter(Boolean).join('<span aria-hidden="true">·</span>');
 return `<div class="session-item task-item ${t.done?'finished':''} ${t.due?'due':''}" data-item="${esc(t.id)}">
  <button class="task-check" data-task-check="${esc(t.id)}" aria-label="${t.done?'Reopen':'Mark done'}: ${esc(t.text)}" aria-pressed="${t.done}">${t.done?IC.tick:IC.task}</button>
  <button class="row" data-task-open="${esc(t.id)}"><span class="body"><span class="title">${esc(t.text)}</span>${facts?`<span class="session-status">${facts}</span>`:''}</span></button>
  <button class="session-more icon" data-task-more="${esc(t.id)}" aria-label="Options for ${esc(t.text)}">${IC.more}</button></div>`;
}
function taskListHTML(){
 const open=tasksSnap.tasks.filter(t=>!t.done),done=tasksSnap.tasks.filter(t=>t.done),due=taskDueCount();
 return `<div class="session-home-head"><h2>Tasks</h2><span class="project-head-actions"><button class="chip" id="tk-add">${IC.plus}Add task</button></span></div>
  ${tasksSnap.tasks.length?`${open.length?`<section class="session-group project-group"><h2>To do <span>${open.length}${due?` · ${due} due`:''}</span></h2>${open.map(taskRowHTML).join('')}</section>`:'<p class="sheet-help project-empty">Nothing to do. Add a task here, or from a session with Add task.</p>'}
   ${done.length?`<details class="session-group project-group settings-details"><summary><h2>Done <span>${done.length}</span></h2></summary>${done.map(taskRowHTML).join('')}</details>`:''}`
  :`<p class="sheet-help project-empty">No tasks yet. Add one here, from a session's Add task chip, or by telling an agent "create a task to …". A task can carry a date and the context of the session it came from, and Start opens a new session with it.</p>`}`;
}
function bindTaskRows(root){
 root.querySelectorAll('[data-task-check]').forEach(b=>b.onclick=()=>{const t=taskById(b.dataset.taskCheck);if(t)taskAct({action:'update',task:t.id,expected_revision:t.revision,done:!t.done},t.done?'Task reopened':'Task done');});
 root.querySelectorAll('[data-task-open]').forEach(b=>b.onclick=()=>taskSheet(b.dataset.taskOpen));
 root.querySelectorAll('[data-task-more]').forEach(b=>b.onclick=()=>taskMenu(b.dataset.taskMore));
}

/* ---------- one task: the sheet, options, editor, start ---------- */
function taskSheet(id){
 const t=taskById(id);if(!t)return;
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet task-sheet';
 const facts=[t.dueAt?`<span class="${t.due?'due-label':''}">${esc(taskWhen(t))}</span>`:'<span>No date</span>',t.session?`<span>From ${esc(t.sessionTitle||sessionName(t.session))}</span>`:'',t.directory?`<span>${esc(projName(t.directory))}</span>`:'',`<span>Added ${esc(rel(Date.parse(t.created)))}${t.by==='cli'?' by an agent':''}${t.done?' · Done '+esc(rel(Date.parse(t.doneAt))):''}</span>`].filter(Boolean).join('');
 sh.innerHTML=`<h2>Task</h2><p class="task-text">${esc(t.text)}</p><div class="task-facts">${facts}</div>
  ${t.summary?`<div class="task-summary"><h3>Context</h3>${esc(t.summary)}</div>`:''}
  ${t.done?'':`<button class="opt" data-start>${IC.plus}<span>Start<span class="sub">A new session with this task as its first message, ready to send</span></span></button>`}
  ${t.session?`<button class="opt" data-session>${IC.term}<span>Open the session<span class="sub">${esc(t.sessionTitle||sessionName(t.session))}</span></span></button>`:''}
  <button class="opt" data-done>${t.done?IC.swap:IC.tick}<span>${t.done?'Reopen':'Mark done'}</span></button>
  <button class="opt" data-edit>${IC.pen}<span>Edit<span class="sub">Text, date and context</span></span></button>
  <button class="opt" data-remove>${IC.x}<span>Remove</span></button>`;
 sh.querySelector('[data-start]')?.addEventListener('click',()=>{closeCurrentSheet?.();startTask(t);});
 sh.querySelector('[data-session]')?.addEventListener('click',()=>{closeCurrentSheet?.();location.hash='#/chat/'+t.session;});
 sh.querySelector('[data-done]').onclick=()=>{closeCurrentSheet?.();taskAct({action:'update',task:t.id,expected_revision:t.revision,done:!t.done},t.done?'Task reopened':'Task done');};
 sh.querySelector('[data-edit]').onclick=()=>{closeCurrentSheet?.();taskEditor(t);};
 sh.querySelector('[data-remove]').onclick=()=>{closeCurrentSheet?.();confirmSheet('Remove this task?',t.text,'Remove it',()=>taskAct({action:'remove',task:t.id},'Task removed'));};
 mountSheet(scrim,sh);
}
const taskMenu=taskSheet;
// Start: a New session in the task's workspace with the task as the draft, so one tap of Send begins the work.
function startTask(t){
 const lines=[t.text];
 if(t.summary)lines.push('','Context from the earlier session:',t.summary);
 lines.push('',`(Pocket task ${t.id}. When it is finished, mark it done with pocket-tasks done ${t.id}.)`);
 saveDraft(NEW_KEY,lines.join('\n'));
 try{if(t.directory)localStorage.setItem('pc-lastproj',t.directory);if(t.session)localStorage.setItem('pc-provider',t.session.startsWith('cx:')?'codex':'claude');}catch{}
 location.hash='#/new';
}
// New task, or edit one. From a session the editor can include a briefing on that session, written by the titles helper.
function taskEditor(t,{session=null,sessionTitle='',directory=''}={}){
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet';
 const local=iso=>{if(!iso)return '';const d=new Date(iso);const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;};
 const fromSession=!t&&session;
 sh.innerHTML=`<h2>${t?'Edit task':'New task'}</h2>${fromSession?`<p class="sheet-name">${esc(sessionTitle||'This session')}</p>`:''}
  <form class="project-form task-form">
   <label class="voice-field">Task<textarea name="text" maxlength="600" rows="2" required placeholder="What needs doing">${esc(t?.text||'')}</textarea></label>
   <div class="task-due-row"><label class="voice-field">Date and time (optional)<input type="datetime-local" name="when" value="${esc(local(t?.dueAt))}"></label><button class="chip" type="button" data-clear-when>No date</button></div>
   ${fromSession?`<button type="button" class="opt" data-summarize aria-pressed="true"><span class="dot on"></span><span>Include a summary of this session<span class="sub">A few lines on what this session is doing, written by the titles helper, kept with the task</span></span></button><p class="task-writing" role="status" hidden>Writing the summary…</p>`
    :t?`<label class="voice-field">Context<textarea name="summary" maxlength="2000" rows="4" placeholder="What someone picking this up later needs to know">${esc(t.summary||'')}</textarea></label>`:''}
   <button class="primary" type="submit">${t?'Save changes':'Add task'}</button>
  </form>`;
 const form=sh.querySelector('form');
 sh.querySelector('[data-clear-when]').onclick=()=>{form.elements.when.value='';};
 const sum=sh.querySelector('[data-summarize]');if(sum)sum.onclick=()=>{const on=sum.getAttribute('aria-pressed')!=='true';sum.setAttribute('aria-pressed',String(on));sum.querySelector('.dot').classList.toggle('on',on);};
 form.onsubmit=async e=>{
  e.preventDefault();
  const text=form.elements.text.value.trim();if(!text)return;
  let dueAt=null;
  if(form.elements.when.value){const d=new Date(form.elements.when.value);if(Number.isNaN(d.getTime()))return toast('Pick a date and time, or clear it.');dueAt=d.toISOString();}
  const btn=form.querySelector('.primary');btn.disabled=true;
  let summary=t?form.elements.summary?.value.trim()||'':'';
  if(fromSession&&sum?.getAttribute('aria-pressed')==='true'){
   const note=sh.querySelector('.task-writing');note.hidden=false;
   try{const r=await api('/tasks/summary',{method:'POST',body:JSON.stringify({session,text}),signal:AbortSignal.timeout(100000)});summary=r.summary||'';if(!summary)toast(r.reason==='short'?'The session is too short to summarize; task added without context.':'No summary could be written; task added without context.');}
   catch{toast('No summary could be written; task added without context.');}
   note.hidden=true;
  }
  const body=t?{action:'update',task:t.id,expected_revision:t.revision,text,dueAt,summary}:{action:'add',text,dueAt,summary,...(session?{session,sessionTitle}:{}),directory};
  const out=await taskAct(body,t?'Task updated':dueAt?'Task added for '+fmtDue(dueAt):'Task added');
  btn.disabled=false;if(!out)return;closeCurrentSheet?.();
 };
 mountSheet(scrim,sh);
}
// From a session's toolbar chip or options: a task that remembers this session and can carry its briefing.
function addTaskFromSession(s){
 if(!tasksOn())return;
 taskEditor(null,{session:s.id,sessionTitle:s.title||'',directory:s.cwd||''});
}
// The conversation's Add task control: a chip in the message toolbar, an icon in the working row (1.36).
function paintChatTask(){
 const b=$('#task-open');if(!b)return;
 if(!tasksOn()||!chatId){b.hidden=true;return;}
 b.hidden=false;
 b.innerHTML=b.classList.contains('icon')?IC.task:IC.task+'<span>Add task</span>';
 b.setAttribute('aria-label','Add a task from this session');b.title='Add a task: a to-do with an optional date, kept with this session';
 b.onclick=()=>addTaskFromSession((typeof chatSessionRow!=='undefined'&&chatSessionRow)||allSessions.find(r=>r.id===chatId)||{id:chatId,title:chatTitle,cwd:''});
}

/* ---------- rail, home chip, badges, tabs ---------- */
function railTasksHTML(){
 if(!tasksSnap)return '<p class="sheet-help">Loading tasks…</p>';
 const open=tasksSnap.tasks.filter(t=>!t.done),done=tasksSnap.tasks.length-open.length;
 return `<div class="rail-projects rail-tasks"><div class="rail-project-actions"><button class="chip" id="rail-task-add">${IC.plus}Add task</button><a class="chip" href="${viewHref('tasks')}" data-view-link>All</a></div>
  ${open.length?open.slice(0,40).map(taskRowHTML).join(''):'<p class="sheet-help">Nothing to do. Add a task, or ask an agent to create one.</p>'}
  ${done?`<a class="rail-done-link" href="${viewHref('tasks')}" data-view-link>${done} done</a>`:''}</div>`;
}
function paintRailTasks(){
 const el=document.getElementById('rail');if(!el||railView()!=='tasks')return;
 el.innerHTML=railTasksHTML();
 el.querySelector('#rail-task-add')?.addEventListener('click',()=>taskEditor(null));
 bindTaskRows(el);
 if(!tasksSnap)loadTasks().then(()=>{paintRailTasks();paintTaskBadges();}).catch(()=>{const r=document.getElementById('rail');if(r&&railView()==='tasks')r.innerHTML='<p class="sheet-help">Tasks could not load.</p>';});else paintTaskBadges();
}
function paintTaskBadges(){
 const due=taskDueCount();
 paintChatTask();
 document.querySelectorAll('[data-tasks-badge]').forEach(el=>{el.textContent=due?String(due):'';el.hidden=!due;});
 document.querySelectorAll('[data-tasks-home]').forEach(el=>{el.textContent='Tasks'+(due?' · '+due+' due':'');el.classList.toggle('due',due>0);});
}
const taskTabState=()=>{const due=taskDueCount();return due?{kind:'due',label:due===1?'A task is due':due+' tasks are due'}:null;};
setInterval(()=>{if(!tasksOn()||document.visibilityState!=='visible'||!(taskView||railView()==='tasks'||document.querySelector('[data-tasks-home]')))return;loadTasks(true).then(()=>{paintTasksView();paintRailTasks();paintTaskBadges();if(typeof paintOpenSessions==='function')paintOpenSessions();}).catch(()=>{});},30000);
