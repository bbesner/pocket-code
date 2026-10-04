/* Daily workspace: local navigation preferences, shared session data. */
function readLocal(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function writeLocal(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
let workspaceFilter=readLocal('pc-workspace-filter',''), providerFilter=readLocal('pc-provider-filter','');
let hiddenSessions=readLocal('pc-hidden-sessions',{}), openSessions=readLocal('pc-open-sessions',[]);
if(typeof workspaceFilter!=='string')workspaceFilter='';
if(!['','claude','codex'].includes(providerFilter))providerFilter='';
if(!hiddenSessions||typeof hiddenSessions!=='object'||Array.isArray(hiddenSessions))hiddenSessions={};
openSessions=Array.isArray(openSessions)?openSessions.filter(s=>s&&typeof s.id==='string'&&/^(cx:)?[0-9a-f-]{36}$/.test(s.id)&&typeof s.title==='string').slice(-12):[];
let dockKind=readLocal('pc-dock-kind',''),dockSurface=null;
const hasDockRoom=()=>matchMedia('(min-width: 1280px)').matches;
function isHiddenSession(s){return hiddenSessions[s.id]>=Math.max(s.mtimeMs||0,s.state?.at||0)&&!['running','observed','waiting','input'].includes(rowState(s).kind);}
function workspaceFilterHTML(){
 const paths=[...new Set(allSessions.map(s=>s.cwd).filter(Boolean))].sort();
 if(workspaceFilter&&!paths.includes(workspaceFilter))paths.unshift(workspaceFilter);
 return `<div class="workspace-filters"><label>Workspace<select data-workspace-filter><option value="">All workspaces</option>${paths.map(p=>`<option value="${esc(p)}" ${workspaceFilter===p?'selected':''}>${esc(projShort(p))}</option>`).join('')}</select></label><label>Agent<select data-provider-filter><option value="">All agents</option><option value="claude" ${providerFilter==='claude'?'selected':''}>Claude</option><option value="codex" ${providerFilter==='codex'?'selected':''}>Codex</option></select></label></div>`;
}
function paintWorkspaceFilters(){
 document.querySelectorAll('[data-workspace-filters]').forEach(el=>{
  // Do not replace an open native select while background polling updates rows.
  if(el.contains(document.activeElement))return;
  el.innerHTML=workspaceFilterHTML();
  el.querySelector('[data-workspace-filter]').onchange=e=>{workspaceFilter=e.target.value;writeLocal('pc-workspace-filter',workspaceFilter);paintSessionPanels();};
  el.querySelector('[data-provider-filter]').onchange=e=>{providerFilter=e.target.value;writeLocal('pc-provider-filter',providerFilter);paintSessionPanels();};
 });
}
function rememberOpenSession(s){
 const row={id:s.id,title:s.title};
 const index=openSessions.findIndex(r=>r.id===s.id);
 if(index<0)openSessions.push(row);else openSessions[index]=row;
 if(openSessions.length>12)openSessions.shift();
 writeLocal('pc-open-sessions',openSessions);writeLocal('pc-last-session',s.id);paintOpenSessions();
}
function paintOpenSessions(){
 const el=document.getElementById('open-sessions');if(!el)return;
 el.innerHTML=openSessions.map(s=>`<span class="open-session ${s.id===chatId?'current':''}"><a href="#/chat/${encodeURIComponent(s.id).replaceAll('%3A',':')}" ${s.id===chatId?'aria-current="page"':''} title="${esc(s.title)}">${esc(s.title)}</a><button data-close-session="${esc(s.id)}" aria-label="Close tab for ${esc(s.title)}">${IC.x}</button></span>`).join('');
 el.querySelectorAll('[data-close-session]').forEach(b=>b.onclick=()=>{
  const id=b.dataset.closeSession,index=openSessions.findIndex(s=>s.id===id);openSessions=openSessions.filter(s=>s.id!==id);writeLocal('pc-open-sessions',openSessions);
  if(chatId===id)location.hash=openSessions.length?'#/chat/'+openSessions[Math.max(0,index-1)].id:'#/';else paintOpenSessions();
 });
 el.querySelector('[aria-current]')?.scrollIntoView({block:'nearest',inline:'nearest'});
}
function workspaceMount(scrim,sh,kind){
 dockSurface?.remove();dockSurface=null;
 if(!hasDockRoom()||!document.querySelector('.split'))return mountSheet(scrim,sh);
 closeCurrentSheet?.();dockKind=kind;writeLocal('pc-dock-kind',kind);
 sh.classList.remove('sheet');sh.classList.add('workspace-dock');sh.setAttribute('aria-label',kind==='git'?'Git workspace':kind==='queue'?'Queued instructions':'Session results');
 const actions=document.createElement('nav');actions.className='dock-tabs';actions.setAttribute('aria-label','Workspace panel');
 actions.innerHTML=[['results','Results'],['queue','Queue'],['git','Git']].map(([key,label])=>`<button class="chip" data-dock="${key}" aria-pressed="${kind===key}">${label}</button>`).join('')+`<button class="icon" data-close-dock aria-label="Close workspace panel">${IC.x}</button>`;
 sh.prepend(actions);document.querySelector('.split').append(sh);dockSurface=sh;
 actions.querySelectorAll('[data-dock]').forEach(b=>b.onclick=()=>openDock(b.dataset.dock,chatId));
 actions.querySelector('[data-close-dock]').onclick=()=>{sh.remove();dockSurface=null;dockKind='';writeLocal('pc-dock-kind','');$('#box')?.focus();};
 return ()=>{sh.remove();if(dockSurface===sh)dockSurface=null;};
}
function openDock(kind,id){if(kind==='results')return openResults(id);if(kind==='queue')return openQueue(id);if(kind==='git')return openGit(id);}
function restoreDock(){if(hasDockRoom()&&['results','queue','git'].includes(dockKind))openDock(dockKind,chatId);}
async function openGit(id){
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet git-sheet';
 sh.innerHTML='<h2>Git workspace</h2><p class="sheet-help">Current changes in this repository, including work from other sessions. Read only.</p><button class="chip" data-git-refresh>Refresh</button><div data-git-status role="status">Reading repository…</div><div data-git-files></div><div data-git-diff></div>';
 workspaceMount(scrim,sh,'git');let generation=0;
 const load=async()=>{
  const token=++generation;sh.querySelector('[data-git-diff]').replaceChildren();const btn=sh.querySelector('[data-git-refresh]');btn.disabled=true;
  try{
   const d=await api('/session/'+encodeURIComponent(id)+'/workspace');if(!sh.isConnected||token!==generation)return;
   sh.querySelector('[data-git-status]').textContent=d.branch+' · '+d.total+' changed '+(d.total===1?'file':'files')+' · '+new Date(d.checkedAt).toLocaleTimeString();
   sh.querySelector('[data-git-files]').innerHTML=d.files.map((f,i)=>`<button class="git-file" data-git-file="${i}" ${f.inspectable?'':'disabled'}><code>${esc(f.status)}</code><span>${esc(f.path)}${!f.inspectable?' · Preview unavailable':''}</span></button>`).join('')+(d.limited?'<p class="sheet-help">Showing the first 250 files.</p>':'');
   sh.querySelectorAll('[data-git-file]').forEach(b=>b.onclick=()=>showDiff(d.files[Number(b.dataset.gitFile)],'working'));
  }catch(e){if(sh.isConnected){sh.querySelector('[data-git-status]').textContent=e.message;sh.querySelector('[data-git-files]').replaceChildren();}}
  finally{btn.disabled=false;}
 };
 const showDiff=async(file,scope)=>{
  const token=++generation,target=sh.querySelector('[data-git-diff]');target.innerHTML=`<h3>${esc(file.path)}</h3><div class="git-scopes"><button class="chip" data-scope="working" aria-pressed="${scope==='working'}">Working tree</button><button class="chip" data-scope="staged" aria-pressed="${scope==='staged'}">Staged</button></div><pre tabindex="0" aria-label="File diff">Loading diff…</pre>`;
  target.querySelectorAll('[data-scope]').forEach(b=>b.onclick=()=>showDiff(file,b.dataset.scope));
  try{const d=await api('/session/'+encodeURIComponent(id)+'/workspace/diff?path='+encodeURIComponent(file.path)+'&scope='+scope);if(sh.isConnected&&token===generation)target.querySelector('pre').textContent=d.text;}
  catch(e){if(sh.isConnected&&token===generation)target.querySelector('pre').textContent=e.message;}
 };
 sh.querySelector('[data-git-refresh]').onclick=load;await load();
}
function keyboardHelp(){
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet';
 sh.innerHTML='<h2>Keyboard shortcuts</h2><dl class="shortcut-list"><dt>Ctrl / ⌘ K</dt><dd>Find a session</dd><dt>Ctrl / ⌘ Shift L</dt><dd>Start a session</dd><dt>Alt [ / Alt ]</dt><dd>Previous / next open session</dd><dt>Ctrl / ⌘ F</dt><dd>Find in the conversation</dd><dt>Escape</dt><dd>Close a dialog or search</dd></dl><p class="sheet-help">Open-session tabs and workspace filters are saved on this device. Closing a tab never stops an agent or deletes its conversation.</p>';
 mountSheet(scrim,sh);
}
document.addEventListener('keydown',e=>{
 if(!document.getElementById('app')?.querySelector('[data-session-search],#box,#first'))return;
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openSessionSwitcher();return;}
 if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='l'){e.preventDefault();location.hash='#/new';return;}
 if(e.altKey&&['[',']'].includes(e.key)&&chatId&&!closeCurrentSheet){const index=openSessions.findIndex(s=>s.id===chatId),next=openSessions[(index+(e.key===']'?1:-1)+openSessions.length)%openSessions.length];if(next){e.preventDefault();location.hash='#/chat/'+next.id;}}
});

async function refreshQuestions(id){
 try{const d=await api('/session/'+encodeURIComponent(id)+'/questions');if(chatId!==id)return;const b=$('#questions-open');if(b){b.hidden=!d.requests.length&&!d.interrupted;b.textContent=d.interrupted?'Question interrupted · Review':d.requests.length+' agent question'+(d.requests.length===1?'':'s')+' · Answer';}}
 catch{if(chatId===id&&$('#questions-open')&&!$('#questions-open').hidden)$('#questions-open').textContent='Question status unavailable · Retry';}
}
async function openQuestions(id){
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet question-sheet';sh.innerHTML='<h2>Agent questions</h2><div data-questions role="status">Loading…</div>';mountSheet(scrim,sh);
 try{
  const d=await api('/session/'+encodeURIComponent(id)+'/questions');if(!sh.isConnected)return;
  const target=sh.querySelector('[data-questions]');
  if(d.interrupted){target.innerHTML='<p class="sheet-help">The server restarted while Claude was waiting for an answer. The original question connection cannot be resumed. Stop this turn, then send your answer as a new message after reviewing the conversation.</p><button class="chip" data-stop-question>Stop interrupted turn</button>';target.querySelector('[data-stop-question]').onclick=async e=>{e.target.disabled=true;try{await api('/session/'+encodeURIComponent(id)+'/stop',{method:'POST',body:'{}'});closeCurrentSheet?.();toast('Stop requested. Send your answer after the turn stops.');}catch(err){toast(err.message);e.target.disabled=false;}};return;}
  if(!d.requests.length){target.textContent=d.supported?'No questions are waiting.':'Native questions are unavailable for this session.';return;}
  target.innerHTML='';
  for(const r of d.requests){
   const form=document.createElement('form');form.className='question-form';
   form.innerHTML=r.questions.map((q,i)=>`<fieldset><legend>${esc(q.question)}</legend>${q.options.map((o,j)=>`<label class="question-option"><input type="${q.multiple?'checkbox':'radio'}" name="q${i}" value="${j}"><span>${esc(o.label)}<small>${esc(o.description)}</small></span></label>`).join('')}<label class="question-custom">${q.options.length?'Or write an answer':'Your answer'}<input type="${q.isSecret?'password':'text'}" data-answer="${i}" autocomplete="off" maxlength="10000"></label></fieldset>`).join('')+'<p class="question-error" role="status"></p><button class="primary" type="submit">Send answers</button>';
   form.onsubmit=async e=>{
    e.preventDefault();const answers=Object.create(null),error=form.querySelector('.question-error'),b=form.querySelector('[type=submit]');
    for(let i=0;i<r.questions.length;i++){const q=r.questions[i],typed=form.querySelector(`[data-answer="${i}"]`).value.trim(),selected=[...form.querySelectorAll(`[name="q${i}"]:checked`)];const values=typed?[typed]:selected.map(option=>q.options[Number(option.value)].label);if(!values.length){error.textContent='Answer each question before sending.';return;}answers[q.id]=values;}
    b.disabled=true;
    try{await api('/session/'+encodeURIComponent(id)+'/questions/'+r.id+'/answer',{method:'POST',body:JSON.stringify({answers})});form.innerHTML='<p>Answers sent to the agent.</p>';refreshQuestions(id);refreshSessions();}
    catch(err){error.textContent=err.message;b.disabled=false;}
   };
   target.append(form);
  }
 }catch(e){if(sh.isConnected)sh.querySelector('[data-questions]').textContent=e.message;}
}
async function openEnvironment(){
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet';sh.innerHTML='<h2>Accounts & instance</h2><div data-environment role="status">Checking provider sign-ins…</div>';mountSheet(scrim,sh);
 try{const d=await api('/environment');if(!sh.isConnected)return;sh.querySelector('[data-environment]').innerHTML=`<p class="sheet-help">${esc(d.host)} · Checked ${esc(new Date(d.checkedAt).toLocaleTimeString())}</p>${d.providers.map(p=>`<section class="provider-account"><h3>${p.provider==='codex'?'Codex':'Claude Code'}</h3><p>${esc(p.email||p.method)}</p><p class="sheet-help">${esc([p.plan,p.method].filter(Boolean).join(' · '))}${p.signedIn===false?' · Not signed in':p.signedIn===null?' · Could not verify':''}</p></section>`).join('')}<p class="sheet-help">${esc(d.accountManagement)}</p><h3>Session controls</h3><p class="sheet-help">${esc(d.permissions)}. Codex Plan first can show native agent questions. Plan mode guides behavior; it does not change server permissions. Claude can show native questions during owned turns. Tool approval controls are not enabled in this release.</p><p class="sheet-help">MemStem and other tools follow each agent’s server configuration. This page does not change accounts, credentials or memory access.</p><button class="chip" data-env-refresh>Refresh status</button>`;sh.querySelector('[data-env-refresh]').onclick=openEnvironment;}
 catch(e){if(sh.isConnected)sh.querySelector('[data-environment]').textContent=e.message;}
}

matchMedia('(min-width: 1280px)').addEventListener('change',()=>{
 if(!hasDockRoom()&&dockSurface?.isConnected){
  const sh=dockSurface;dockSurface=null;sh.remove();sh.classList.remove('workspace-dock');sh.classList.add('sheet');sh.querySelector('.dock-tabs')?.remove();
  const scrim=document.createElement('div');scrim.className='scrim';mountSheet(scrim,sh);
 }
});
