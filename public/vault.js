/* Vault (1.39): secrets agents use without seeing. Off until Settings → Projects, files, tasks & vault turns it on
   (window.pocketFeatures.vault), and it can only be turned on once POCKET_VAULT_KEY is set. One view, the list (#/vault,
   and #/vault/requests from a push), which opens like Tasks: as a tab, beside a conversation, in a window of its own, or
   full-screen on the phone. The list never carries a value: a value is fetched one field at a time when the owner taps
   Show, lives only in that sheet's DOM, and is wiped when the sheet closes or the app is hidden. Nothing here writes a
   value to storage, a draft, a toast or the console. Data comes from /api/vault; every change goes through
   /api/vault/act. Names, commands, notes and session titles are written by agents: always esc() them. */
const vaultOn=()=>Boolean(window.pocketFeatures?.vault);
let vaultSnap=null,vaultAt=0,vaultLoading=null,vaultView=null,vaultFocusRequests=false,vaultPainted='';
// Icons drawn in the app's stroke (IC lives in app.js, which loads after this file).
const VIC={
 key:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15.5" r="4"/><path d="M11 12.5l8.5-8.5M16.5 7l2.5 2.5M14 9.5l2 2"/></svg>',
 token:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="7" width="17" height="10" rx="2.5"/><path d="M8 12h.01M12 12h.01M16 12h.01" stroke-width="2.6"/></svg>',
 login:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/></svg>',
 note:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 15.5h5"/></svg>',
 lock:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5"/></svg>',
};
const VAULT_KINDS=[['api_key','API key'],['token','Token'],['login','Login'],['credentials','Credentials'],['note','Secure note']];
const VAULT_KIND_WORD=Object.fromEntries(VAULT_KINDS);
const VAULT_KIND_SUB={credentials:'Any set of named fields, such as a client ID and secret'};
// Each kind's fixed fields. Any item may also carry up to 20 custom fields (item.custom); Credentials has only those.
const VAULT_FIELDS={api_key:['value'],token:['value'],login:['username','password'],credentials:[],note:['text']};
const VAULT_FIELD_RE=/^[a-z][a-z0-9_]{0,31}$/,VAULT_CUSTOM_MAX=20;
const vaultFixedFields=kind=>VAULT_FIELDS[kind]||['value'];
// A fixed field reads as a word; a custom field is its own name.
const vaultFieldWord=(kind,f)=>!vaultFixedFields(kind).includes(f)?f:f==='value'?(kind==='token'?'Token':'Key'):f==='username'?'Username':f==='password'?'Password':'Note';
const vaultKindIcon=kind=>VIC[kind==='api_key'||kind==='credentials'?'key':kind]||VIC.lock;
const VAULT_POLICY={ask:['Agents ask','A new command needs your approval once; approved commands are remembered'],auto:['Agents may use','Any command runs and is recorded'],owner:['Only you','Agents cannot use it']};
const VAULT_NAME_RE=/^[a-z0-9-]{1,64}$/;
const vaultItemById=id=>vaultSnap?.items.find(i=>i.id===id)||vaultSnap?.trash.find(i=>i.id===id)||null;
const vaultTime=v=>typeof v==='number'?v:Date.parse(v);
const vaultHost=u=>{try{const x=new URL(u);return /^https?:$/.test(x.protocol)?x.host:'';}catch{return '';}};
const vaultSafeUrl=u=>vaultHost(u)?u:''; // only http(s) becomes a link; anything else (javascript:, data:) stays text
const vaultDate=iso=>{const d=new Date(iso);return d.toLocaleDateString('en-US',{month:'short',day:'numeric',...(d.getFullYear()===new Date().getFullYear()?{}:{year:'numeric'})});};
const vaultExpired=i=>Boolean(i.expiresAt)&&Date.parse(i.expiresAt)<=Date.now();
const vaultCmd=argv=>Array.isArray(argv)?argv.join(' '):String(argv||'');
// A run can bind several secrets: the server lists them as itemNames (itemName is accepted too).
const vaultRequestNames=r=>Array.isArray(r.itemNames)&&r.itemNames.length?r.itemNames.join(', '):r.itemName||'';
const vaultRequests=()=>(vaultSnap?.requests||[]).filter(r=>!r.answer&&!(r.expiresAt&&Date.parse(r.expiresAt)<=Date.now()));
const vaultRequestCount=()=>vaultRequests().length;
const vaultViewTitle=()=>'Vault';
async function loadVault(force){
 if(!force&&vaultSnap&&Date.now()-vaultAt<4000)return vaultSnap;
 if(vaultLoading)return vaultLoading;
 vaultLoading=api('/vault',{cache:'no-store',signal:AbortSignal.timeout(8000)}).then(s=>{s.items=s.items||[];s.trash=s.trash||[];s.requests=s.requests||[];vaultSnap=s;vaultAt=Date.now();return s;}).finally(()=>{vaultLoading=null;});
 return vaultLoading;
}
// Keep the local list in name order, removed items in the Removed section, newest removal first.
function mergeVaultItem(i){
 if(!vaultSnap||!i)return;
 vaultSnap.items=vaultSnap.items.filter(x=>x.id!==i.id);vaultSnap.trash=vaultSnap.trash.filter(x=>x.id!==i.id);
 (i.trashedAt?vaultSnap.trash:vaultSnap.items).push(i);
 vaultSnap.items.sort((a,b)=>a.name.localeCompare(b.name));
 vaultSnap.trash.sort((a,b)=>vaultTime(b.trashedAt)-vaultTime(a.trashedAt));
}
function repaintVault(){paintVaultView();paintRailVault();paintVaultBadges();if(typeof paintOpenSessions==='function')paintOpenSessions();}
// Every change; returns the response, or null after telling the owner why it failed. A stale revision merges the
// server's copy so the next attempt starts from it.
async function vaultAct(body,done){
 try{
  const r=await api('/vault/act',{method:'POST',body:JSON.stringify(body),cache:'no-store'});
  if(r.item)mergeVaultItem(r.item);
  if(body.action==='answer'&&vaultSnap){vaultSnap.requests=vaultSnap.requests.filter(x=>x.id!==body.request);vaultSnap.openRequests=vaultRequestCount();}
  if(done)toast(done);repaintVault();return r;
 }catch(e){
  if(e.status===409&&e.body?.item){mergeVaultItem(e.body.item);repaintVault();}
  if(body.action==='answer')loadVault(true).then(repaintVault).catch(()=>{}); // an expired or answered request leaves the list
  if(e.message!=='login')toast(e.message||'Could not update the Vault');
  return null;
 }
}

/* ---------- the list view ---------- */
async function renderVault(view){
 Voice.onLeave?.();
 vaultView=view;vaultPainted='';if(typeof boardView!=='undefined')boardView=null;if(typeof docView!=='undefined')docView=null;if(typeof taskView!=='undefined')taskView=null;
 const col=`<header class="bar">
   ${PANE?`<button class="icon" id="pane-main" aria-label="Make this the main view">${IC.swap}</button>`:SOLO?'':`<button class="icon" id="back" aria-label="Back">${IC.back}</button><button class="icon desk" id="railtog" aria-label="Show or hide the session list">${IC.panel}</button>`}
   <h1><span class="one" id="vtitle">Vault</span><span class="tag" id="vtag">Secrets agents use without seeing</span></h1>
   ${SOLO?'':`<button class="icon" id="vwin" aria-label="Open in a new window" title="Open in a new window">${IC.external}</button>`}
   ${PANE||SOLO?'':`<button class="icon desk" id="splitb" aria-label="Split view">${IC.columns}</button>`}
   ${PANE?`<button class="icon" id="pane-close" aria-label="Close this pane">${IC.x}</button>`:''}
  </header>
  <main class="scroll projects-view vault-view" id="vault-main" tabindex="-1"><p class="sheet-help projects-loading">Loading the Vault…</p></main>`;
 app.innerHTML=withShell(col);
 wireShell();
 if(PANE){$('#pane-main').onclick=()=>paneSay('main',{view});$('#pane-close').onclick=()=>paneSay('close');}
 else if(!SOLO){bindViewBack($('#back'),view);$('#splitb').onclick=chooseBeside;}
 $('#vwin')?.addEventListener('click',()=>openInWindow(view));
 const tog=$('#railtog');if(tog)tog.onclick=()=>{localStorage.setItem('pc-rail',railOpen()?'closed':'open');route();};
 try{await loadVault(true);}
 catch(e){if(vaultView!==view)return;const main=$('#vault-main');if(!main)return;if(vaultSnap)paintVaultView();showLibraryError(main,e,'The Vault',()=>renderVault(view),Boolean(vaultSnap));restoreViewPosition(view);return;}
 if(vaultView!==view)return;
 if(PANE)paneSay('route',{id:view,title:'Vault'});else if(SOLO)document.title='Vault · Pocket Code';else rememberOpenView(view,'Vault');
 paintVaultView();
 restoreViewPosition(view);
 if(vaultFocusRequests){vaultFocusRequests=false;const req=$('#vault-requests');if(req){req.scrollIntoView({block:'start'});req.querySelector('h2')?.focus({preventScroll:true});}}
}
function paintVaultView(){
 const main=$('#vault-main');if(!main||!vaultSnap||!vaultView)return;
 // The 30-second refresh must not rebuild the list under a finger or a focused button when nothing changed.
 const key=JSON.stringify([vaultSnap.ready,vaultSnap.items,vaultSnap.trash,vaultRequests()]);
 if(key===vaultPainted&&main.querySelector('.vault-list-head'))return paintVaultBadges();
 const focused=document.activeElement&&main.contains(document.activeElement)?[...main.querySelectorAll('button,a,summary')].indexOf(document.activeElement):-1;
 const open=[...main.querySelectorAll('details')].map(d=>d.open);
 vaultPainted=key;
 main.innerHTML=vaultListHTML();
 main.querySelectorAll('details').forEach((d,i)=>{if(open[i])d.open=true;});
 bindVaultRows(main);
 main.querySelector('#vt-add')?.addEventListener('click',()=>vaultEditor(null));
 if(focused>=0)main.querySelectorAll('button,a,summary')[focused]?.focus({preventScroll:true});
 paintVaultBadges();
 if(typeof paintOpenSessions==='function')paintOpenSessions();
}
// The kind is drawn as an icon; screen readers get the word instead.
function vaultFactsHTML(i){
 const host=vaultHost(i.url),tags=(i.tags||[]).join(', ');
 const facts=[host?`<span>${esc(host)}</span>`:'',tags?`<span>${esc(tags)}</span>`:'',`<span>${esc(VAULT_POLICY[i.policy]?.[0]||'Agents ask')}</span>`,
  i.lastUsedAt?`<span>Used ${esc(rel(vaultTime(i.lastUsedAt)))}</span>`:'',
  i.expiresAt?`<span class="${i.expiring||vaultExpired(i)?'due-label':''}">${vaultExpired(i)?'Expired':'Expires'} ${esc(vaultDate(i.expiresAt))}</span>`:''].filter(Boolean);
 return `<span class="vault-sr">${esc(VAULT_KIND_WORD[i.kind]||'Secret')}, </span>`+facts.join('<span aria-hidden="true">·</span>');
}
function vaultRowHTML(i){
 return `<div class="session-item vault-item ${i.expiring||vaultExpired(i)?'due':''}" data-item="${esc(i.id)}">
  <span class="vault-kind" aria-hidden="true">${vaultKindIcon(i.kind)}</span>
  <button class="row" data-vault-open="${esc(i.id)}"><span class="body"><span class="title vault-name">${esc(i.name)}</span><span class="session-status">${vaultFactsHTML(i)}</span></span></button>
  <button class="session-more icon" data-vault-more="${esc(i.id)}" aria-label="Options for ${esc(i.name)}">${IC.more}</button></div>`;
}
function vaultTrashRowHTML(i){
 const until=i.trashedAt?vaultDate(new Date(vaultTime(i.trashedAt)+30*86400e3).toISOString()):'';
 return `<div class="session-item vault-item finished" data-item="${esc(i.id)}">
  <span class="vault-kind" aria-hidden="true">${vaultKindIcon(i.kind)}</span>
  <span class="row"><span class="body"><span class="title vault-name">${esc(i.name)}</span><span class="session-status"><span>${esc(VAULT_KIND_WORD[i.kind]||'Secret')}</span>${until?`<span aria-hidden="true">·</span><span>Kept until ${esc(until)}</span>`:''}</span></span></span>
  <button class="chip vault-restore" data-vault-restore="${esc(i.id)}" aria-label="Restore ${esc(i.name)}">Restore</button></div>`;
}
// A request: which secret, the exact command, where it runs and who asked. Three answers, the approval card's look.
function vaultRequestHTML(r,where='main'){
 const hid=`vr-${where}-${r.id}`,who=r.session?(r.sessionTitle||(typeof sessionName==='function'?sessionName(r.session):'')||'A session'):'A terminal or code-server';
 return `<section class="vault-request" data-request="${esc(r.id)}" aria-labelledby="${esc(hid)}">
  <h3 id="${esc(hid)}"><span class="vault-name">${esc(vaultRequestNames(r))}</span><span class="vault-request-when">${esc(rel(vaultTime(r.created)))}</span></h3>
  <code class="vault-cmd" tabindex="0" title="${esc(vaultCmd(r.argv))}">${esc(vaultCmd(r.argv))}</code>
  <p class="vault-request-where">${r.cwd?`<span class="vault-path">${esc(projShort(r.cwd))}</span><span aria-hidden="true">·</span>`:''}<span>${esc(who)}</span></p>
  <div class="approval-actions vault-request-actions"><button class="chip" data-answer="deny">Deny</button><button class="chip" data-answer="always">Always allow</button><button class="chip approval-allow" data-answer="once">Allow once</button></div>
 </section>`;
}
function vaultListHTML(){
 if(vaultSnap.ready===false)return `<div class="session-home-head vault-list-head"><h2>Vault</h2></div><p class="sheet-help project-empty">The Vault cannot be opened. Check that POCKET_VAULT_KEY in .env is the key it was saved with, then restart Pocket Code.</p>`;
 const reqs=vaultRequests(),items=vaultSnap.items,trash=vaultSnap.trash;
 return `<div class="session-home-head vault-list-head"><h2>Vault</h2><span class="project-head-actions"><button class="chip" id="vt-add">${IC.plus}Add secret</button></span></div>
  ${reqs.length?`<section class="session-group project-group vault-requests" id="vault-requests"><h2 tabindex="-1">Requests <span>${reqs.length} waiting</span></h2><p class="sheet-help vault-requests-help">An agent wants to run a command with a secret. Always allow remembers this exact command and folder for that secret.</p>${reqs.map(r=>vaultRequestHTML(r)).join('')}</section>`:''}
  ${items.length?`<section class="session-group project-group"><h2>Secrets <span>${items.length}</span></h2>${items.map(vaultRowHTML).join('')}</section>`
   :'<p class="sheet-help project-empty">No secrets yet. Add one here, or from a conversation with Store in the Vault. Agents use them by name and never see the value.</p>'}
  ${trash.length?`<details class="session-group project-group settings-details"><summary><h2>Removed <span>${trash.length}</span></h2></summary><p class="sheet-help vault-requests-help">Kept for 30 days, then deleted. A removed name can't be reused until then.</p>${trash.map(vaultTrashRowHTML).join('')}</details>`:''}`;
}
function bindVaultRows(root){
 root.querySelectorAll('[data-vault-open]').forEach(b=>b.onclick=()=>vaultSheet(b.dataset.vaultOpen));
 root.querySelectorAll('[data-vault-more]').forEach(b=>b.onclick=()=>vaultSheet(b.dataset.vaultMore));
 root.querySelectorAll('[data-vault-restore]').forEach(b=>b.onclick=()=>{const i=vaultItemById(b.dataset.vaultRestore);if(i)vaultAct({action:'restore',item:i.id},'Restored '+i.name);});
 root.querySelectorAll('[data-request]').forEach(card=>card.querySelectorAll('[data-answer]').forEach(b=>b.onclick=async()=>{
  const r=vaultSnap?.requests.find(x=>x.id===card.dataset.request);if(!r)return;
  card.querySelectorAll('button').forEach(x=>x.disabled=true);
  const decision=b.dataset.answer;
  const out=await vaultAct({action:'answer',request:r.id,decision},decision==='deny'?'Denied':decision==='always'?'Allowed. This command is remembered for '+vaultRequestNames(r):'Allowed once');
  if(!out){if(card.isConnected)card.querySelectorAll('button').forEach(x=>x.disabled=false);return;}
  loadVault(true).then(repaintVault).catch(()=>{}); // recipes and last use come from the server
 }));
}

/* ---------- one secret: the sheet ---------- */
// Run fn once the sheet has left the page, however it closed (button, scrim, Escape, another sheet).
function onSheetGone(sh,fn){const mo=new MutationObserver(()=>{if(!sh.isConnected){mo.disconnect();fn();}});mo.observe(document.body,{childList:true});}
function vaultHideValue(row){
 const v=row.querySelector('.vault-value');if(v){v.classList.remove('shown');v.innerHTML='<span aria-hidden="true">••••••••</span><span class="vault-sr">Hidden</span>';}
 const show=row.querySelector('[data-show]');if(show)show.textContent='Show';
 const copy=row.querySelector('[data-copy-value]');if(copy)copy.hidden=true;
 delete row.dataset.shown;
}
// Hiding the app (screen off, another app) hides every shown value.
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')document.querySelectorAll('.vault-field[data-shown]').forEach(vaultHideValue);});
async function vaultCopy(text,btn,what){
 try{
  if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);
  else{const ta=document.createElement('textarea');ta.value=text;ta.setAttribute('aria-hidden','true');document.body.append(ta);ta.select();document.execCommand('copy');ta.remove();}
  if(btn?.isConnected){btn.innerHTML=IC.tick+'Copied';btn.classList.add('ok');setTimeout(()=>{if(btn.isConnected){btn.innerHTML=IC.copy+'Copy';btn.classList.remove('ok');}},1400);}
  toast(what+' copied');
 }catch{toast('Copy failed');}
}
function vaultHistoryLine(row){
 const by=row.by==='owner'?'by you':row.by==='terminal'?'from a terminal':'by an agent';
 const what={run:'Run '+by,'run-denied':'Run refused, '+by.replace(/^by /,'asked by '),request:'Asked to run '+by,'request-answered':row.decision==='deny'?'Request denied by you':row.decision==='always'?'Always allowed by you':row.decision==='once'?'Allowed once by you':'Request answered by you',
  'owner-view':'Viewed by you',put:'Stored '+by,update:row.decision==='recipe-removed'?'Approved command removed '+by:'Changed '+by,remove:'Removed '+by,restore:'Restored '+by,rotate:'Key rotated by you'}[row.action]||row.action;
 const parts=[what,row.session?(row.sessionTitle||(typeof sessionName==='function'?sessionName(row.session):'')):'',row.at?rel(vaultTime(row.at)):''].filter(Boolean);
 const cmd=row.argv&&row.argv.length?vaultCmd(row.argv):'';
 return `<li><span class="vault-history-what">${esc(parts.join(' · '))}</span>${cmd?`<code class="vault-cmd">${esc(cmd)}</code>`:''}</li>`;
}
function vaultRecipesHTML(i){
 const rs=i.recipes||[];
 if(!rs.length)return `<p class="project-empty">${i.policy==='ask'?'None yet. Always allow on a request adds one.':i.policy==='auto'?'Not needed: agents may run any command with it.':'Agents cannot use this secret.'}</p>`;
 return `<ul class="vault-recipes">${rs.map(r=>`<li><span class="vault-recipe-body"><code class="vault-cmd">${esc(vaultCmd(r.argv))}</code>${r.cwd?`<span class="vault-path">in ${esc(projShort(r.cwd))}</span>`:''}</span><button class="icon vault-recipe-remove" data-recipe="${esc(r.id)}" aria-label="Remove approved command: ${esc(vaultCmd(r.argv))}">${IC.x}</button></li>`).join('')}</ul>`;
}
function vaultSheet(id){
 const i=vaultItemById(id);if(!i||i.trashedAt)return;
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet task-sheet vault-sheet';
 const url=vaultSafeUrl(i.url),pol=VAULT_POLICY[i.policy]||VAULT_POLICY.ask;
 const used=i.lastUsedAt?`Used ${rel(vaultTime(i.lastUsedAt))}${i.lastUsedBy?(i.lastUsedBy.kind==='owner'?' by you':i.lastUsedBy.kind==='terminal'?' from a terminal':' by an agent')+(i.lastUsedBy.sessionTitle?' · '+i.lastUsedBy.sessionTitle:''):''}`:'Not used yet';
 const facts=[url?`<span><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(vaultHost(url))}</a></span>`:i.url?`<span>${esc(i.url)}</span>`:'',
  i.tags?.length?`<span>Tags: ${esc(i.tags.join(', '))}</span>`:'',
  i.expiresAt?`<span class="${i.expiring||vaultExpired(i)?'due-label':''}">${vaultExpired(i)?'Expired':'Expires'} ${esc(vaultDate(i.expiresAt))}</span>`:'',
  `<span>${esc(used)}</span>`,`<span>Added ${esc(rel(vaultTime(i.created)))}${i.updated&&i.updated!==i.created?' · Changed '+esc(rel(vaultTime(i.updated))):''}</span>`].filter(Boolean).join('');
 const fields=i.fields?.length?i.fields:vaultFixedFields(i.kind),fixed=vaultFixedFields(i.kind);
 // How an agent names it in a run: the item alone when it has one field, item.field for each when it has several.
 const use=fields.length>1?fields.map(f=>`<code class="vault-path">${esc(i.name+'.'+f)}</code>`).join(' '):`<code class="vault-path">${esc(i.name)}</code>`;
 sh.innerHTML=`<h2>${esc(VAULT_KIND_WORD[i.kind]||'Secret')}</h2><p class="task-text vault-name" id="vault-sheet-name">${esc(i.name)}</p><div class="task-facts">${facts}</div>
  <section class="vault-section"><h3>${fields.length>1?'Values':'Value'}</h3>${fields.map(f=>`<div class="vault-field" data-field="${esc(f)}">
    <span class="vault-field-label${fixed.includes(f)?'':' vault-field-custom'}" id="vf-${esc(f)}">${esc(vaultFieldWord(i.kind,f))}</span>
    <span class="vault-value"><span aria-hidden="true">••••••••</span><span class="vault-sr">Hidden</span></span>
    <span class="vault-field-actions"><button class="chip" data-copy-value aria-describedby="vf-${esc(f)}" hidden>${IC.copy}Copy</button><button class="chip" data-show aria-describedby="vf-${esc(f)}">Show</button></span></div>`).join('')}</section>
  <section class="vault-section"><h3>Agents</h3><p class="vault-policy"><strong>${esc(pol[0])}</strong>: ${esc(pol[1])}</p>${i.policy==='owner'?'':`<p class="vault-use">${fields.length>1?'Each field is used by name':'Used by name'} in a command: ${use}</p>`}</section>
  ${i.policy==='owner'?'':`<section class="vault-section"><h3>Approved commands <span>${(i.recipes||[]).length||''}</span></h3><div data-recipes>${vaultRecipesHTML(i)}</div></section>`}
  ${i.notes?`<div class="task-summary"><h3>Notes</h3>${esc(i.notes)}</div>`:''}
  <button class="opt" data-edit>${IC.pen}<span>Edit<span class="sub">Name, values, fields, website, tags, notes and expiry</span></span></button>
  <button class="opt" data-policy>${VIC.lock}<span>Change who can use it<span class="sub">${esc(pol[0])}</span></span></button>
  <button class="opt" data-remove>${IC.x}<span>Remove<span class="sub">Kept for 30 days, then deleted</span></span></button>
  <section class="vault-section vault-history-section"><h3>History</h3><div class="vault-history" data-history role="status">Loading history…</div></section>`;
 sh.querySelectorAll('.vault-field').forEach(row=>{
  const f=row.dataset.field,show=row.querySelector('[data-show]'),copy=row.querySelector('[data-copy-value]');
  show.onclick=async()=>{
   if(row.dataset.shown!==undefined)return vaultHideValue(row);
   show.disabled=true;show.textContent='Loading…';
   try{
    const r=await api('/vault/field',{method:'POST',body:JSON.stringify({item:i.id,field:f}),cache:'no-store'});
    if(!sh.isConnected)return;
    const v=row.querySelector('.vault-value');v.classList.add('shown');v.textContent=String(r.value??'');
    row.dataset.shown='';show.textContent='Hide';copy.hidden=false;
    vaultHistory(sh,i.id); // the view is recorded; show it
   }catch(e){if(sh.isConnected){show.textContent='Show';}if(e.message!=='login')toast(e.message||'Could not show the value');}
   finally{show.disabled=false;}
  };
  copy.onclick=()=>{const v=row.querySelector('.vault-value.shown');if(v)vaultCopy(v.textContent,copy,vaultFieldWord(i.kind,f));};
 });
 const bindRecipes=()=>sh.querySelectorAll('[data-recipe]').forEach(b=>b.onclick=async()=>{
  b.disabled=true;const cur=vaultItemById(i.id)||i;
  const r=await vaultAct({action:'recipe-remove',item:i.id,recipe:b.dataset.recipe},'Approved command removed');
  if(!sh.isConnected)return;const now=r?.item||vaultItemById(i.id)||cur;
  const box=sh.querySelector('[data-recipes]');if(!box)return;
  box.innerHTML=vaultRecipesHTML(now);const n=box.previousElementSibling?.querySelector('span');if(n)n.textContent=(now.recipes||[]).length||'';bindRecipes();
  const next=box.querySelector('button');if(next)next.focus();else{const h=box.previousElementSibling;h.tabIndex=-1;h.focus();}
 });
 bindRecipes();
 sh.querySelector('[data-edit]').onclick=()=>{closeCurrentSheet?.();vaultEditor(vaultItemById(i.id)||i);};
 sh.querySelector('[data-policy]').onclick=()=>vaultPolicySheet(vaultItemById(i.id)||i);
 sh.querySelector('[data-remove]').onclick=()=>{closeCurrentSheet?.();confirmSheet('Remove this secret?',`${i.name} goes to Removed for 30 days, then it is deleted. Agents can't use it once removed, and the name can't be reused until then.`,'Remove it',()=>vaultAct({action:'remove',item:i.id},'Removed '+i.name));};
 onSheetGone(sh,()=>sh.querySelectorAll('.vault-field').forEach(vaultHideValue)); // no value outlives its sheet
 mountSheet(scrim,sh);
 sh.setAttribute('aria-labelledby','sheet-title vault-sheet-name');
 vaultHistory(sh,i.id);
}
async function vaultHistory(sh,id){
 const box=sh.querySelector('[data-history]');if(!box)return;
 try{
  const r=await api('/vault/audit?item='+encodeURIComponent(id)+'&limit=50',{cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!sh.isConnected)return;
  const rows=(r.rows||[]).slice().sort((a,b)=>vaultTime(b.at)-vaultTime(a.at)).slice(0,20);
  box.innerHTML=rows.length?`<ul class="vault-history-list">${rows.map(vaultHistoryLine).join('')}</ul>`:'<p class="project-empty">Nothing recorded yet.</p>';
 }catch(e){if(sh.isConnected)box.innerHTML=`<p class="project-empty">History could not load. ${esc(e.message||'')}</p>`;}
}
function vaultPolicySheet(i){
 sheet('Who can use it',Object.entries(VAULT_POLICY).map(([v,[label,sub]])=>[v,label,sub]),i.policy,async v=>{
  if(v===i.policy)return vaultSheet(i.id);
  const r=await vaultAct({action:'update',item:i.id,expected_revision:i.revision,policy:v},VAULT_POLICY[v][0]+': '+i.name);
  if(r)vaultSheet(i.id);
 });
}

/* ---------- the editor: add or edit ---------- */
let vaultFieldSeq=0;
const VAULT_SECRET_ATTRS='autocomplete="off" spellcheck="false" autocapitalize="none" autocorrect="off" data-1p-ignore data-lpignore="true"';
const vaultRevealBtn=(id,label)=>`<button type="button" class="chip vault-reveal" data-reveal="${id}" aria-pressed="false" aria-describedby="${label}">Show</button>`;
function vaultSecretFieldsHTML(kind,editing){
 return vaultFixedFields(kind).map(f=>{
  const id='vs-'+(++vaultFieldSeq),label=vaultFieldWord(kind,f),ph=editing?'Unchanged':'';
  const common=`id="${id}" name="v-${f}" ${VAULT_SECRET_ATTRS} data-secret="${f}" placeholder="${ph}"`;
  if(f==='username')return `<label class="voice-field">${label}<input type="text" ${common}></label>`;
  if(f==='text')return `<div class="vault-secret"><label class="voice-field" for="${id}" id="${id}-l">${label}</label><div class="vault-secret-input"><textarea rows="4" class="vault-masked" ${common}></textarea>${vaultRevealBtn(id,id+'-l')}</div></div>`;
  return `<div class="vault-secret"><label class="voice-field" for="${id}" id="${id}-l">${label}</label><div class="vault-secret-input"><input type="password" ${common}>${vaultRevealBtn(id,id+'-l')}</div></div>`;
 }).join('');
}
// A custom field the item already has: its name is fixed (rename = remove and add), its value is replaced only when typed.
function vaultCustomRowHTML(name){
 const id='vs-'+(++vaultFieldSeq);
 return `<div class="vault-custom-row" data-custom="${esc(name)}">
  <span class="vault-custom-name" id="${id}-l">${esc(name)}</span>
  <div class="vault-secret-input"><input type="password" id="${id}" ${VAULT_SECRET_ATTRS} data-custom-value placeholder="Unchanged" aria-labelledby="${id}-l">${vaultRevealBtn(id,id+'-l')}</div>
  <button type="button" class="chip vault-field-remove" data-remove-field aria-pressed="false" aria-describedby="${id}-l">Remove</button>
  <p class="vault-hint vault-removing" hidden>Removed when you save.</p>
 </div>`;
}
// A field being added: a name and a value. A row left empty is ignored on save.
function vaultNewFieldHTML(){
 const id='vs-'+(++vaultFieldSeq);
 return `<div class="vault-custom-row new" data-new-field>
  <label class="voice-field vault-custom-key">Name<input type="text" data-custom-name maxlength="32" pattern="[a-z][a-z0-9_]{0,31}" placeholder="client_id" class="vault-name-input" ${VAULT_SECRET_ATTRS} aria-describedby="vault-field-hint ${id}-e"></label>
  <button type="button" class="icon vault-field-drop" data-drop-field aria-label="Remove this field">${IC.x}</button>
  <div class="vault-secret"><label class="voice-field" for="${id}" id="${id}-l">Value</label><div class="vault-secret-input"><input type="password" id="${id}" ${VAULT_SECRET_ATTRS} data-custom-value aria-describedby="${id}-e">${vaultRevealBtn(id,id+'-l')}</div></div>
  <p class="vault-field-error" id="${id}-e"></p>
 </div>`;
}
// insert: after saving, put {{vault:name}} into the open message box so the message refers to the secret by name.
function vaultEditor(t,{insert=null}={}){
 if(!vaultOn())return toast('The Vault is off. Turn it on in Settings → Projects, files, tasks & vault.');
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet vault-editor';
 let revision=t?.revision;
 const kind=t?.kind||'api_key',expires=t?.expiresAt?(d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`)(new Date(t.expiresAt)):'';
 const existing=t?(t.custom||[]):[];
 const customHead=k=>k==='credentials'?'Fields':'Custom fields';
 sh.innerHTML=`<h2>${t?'Edit secret':'Add to the Vault'}</h2>${t?`<p class="sheet-name vault-name">${esc(t.name)}</p>`:'<p class="sheet-help vault-editor-help">Stored encrypted on this server. Agents use it by name in commands and never see the value.</p>'}
  <form class="project-form vault-form" autocomplete="off" novalidate>
   <label class="voice-field">Name<input type="text" name="name" required maxlength="64" pattern="[a-z0-9\\-]{1,64}" value="${esc(t?.name||'')}" placeholder="zoho-books" autocomplete="off" spellcheck="false" autocapitalize="none" autocorrect="off" aria-describedby="vault-name-hint" class="vault-name-input"></label>
   <p class="vault-hint" id="vault-name-hint">Lowercase letters, numbers and hyphens. Agents use this name.</p>
   <label class="voice-field">Kind<select name="kind" aria-describedby="${t?'vault-kind-hint':'vault-kind-sub'}" ${t?'disabled':''}>${VAULT_KINDS.map(([v,l])=>`<option value="${v}" ${v===kind?'selected':''}>${l}</option>`).join('')}</select></label>
   ${t?'<p class="vault-hint" id="vault-kind-hint">The kind is fixed. For a different kind, add a new secret.</p>':`<p class="vault-hint" id="vault-kind-sub" data-kind-sub>${esc(VAULT_KIND_SUB[kind]||'')}</p>`}
   <div class="vault-secrets" data-secret-fields>${vaultSecretFieldsHTML(kind,Boolean(t))}</div>
   <div class="vault-custom" role="group" aria-labelledby="vault-custom-h">
    <h3 class="vault-custom-head" id="vault-custom-h">${customHead(kind)}</h3>
    <p class="vault-hint" id="vault-field-hint" hidden>Lowercase letters, digits and underscores, for example client_id</p>
    <div class="vault-custom-rows" data-custom-rows>${existing.map(vaultCustomRowHTML).join('')}</div>
    <button type="button" class="chip vault-add-field" data-add-field>${IC.plus}Add field</button>
   </div>
   ${t?'<p class="vault-hint">Leave a value empty to keep it as it is.</p>':''}
   <label class="voice-field">Website (optional)<input type="text" inputmode="url" name="url" value="${esc(t?.url||'')}" placeholder="https://" autocomplete="off" spellcheck="false" autocapitalize="none"></label>
   <label class="voice-field">Tags (optional)<input type="text" name="tags" value="${esc((t?.tags||[]).join(', '))}" placeholder="billing, zoho" autocomplete="off" autocapitalize="none" aria-describedby="vault-tags-hint"></label>
   <p class="vault-hint" id="vault-tags-hint">Separate tags with commas.</p>
   <label class="voice-field">Notes (optional)<textarea name="notes" rows="3" maxlength="4000" placeholder="Where it came from, what it's for">${esc(t?.notes||'')}</textarea></label>
   <label class="voice-field">Who can use it<select name="policy" aria-describedby="vault-policy-hint">${Object.entries(VAULT_POLICY).map(([v,[l]])=>`<option value="${v}" ${v===(t?.policy||'ask')?'selected':''}>${l}</option>`).join('')}</select></label>
   <p class="vault-hint" id="vault-policy-hint" data-policy-hint></p>
   <div class="task-due-row"><label class="voice-field">Expires (optional)<input type="date" name="expires" value="${esc(expires)}"></label><button class="chip" type="button" data-clear-exp>No date</button></div>
   <p class="vault-form-error" role="alert"></p>
   <button class="primary" type="submit">${t?'Save changes':'Save to the Vault'}</button>
  </form>`;
 const form=sh.querySelector('form'),err=sh.querySelector('.vault-form-error'),box=sh.querySelector('[data-secret-fields]');
 const rowsBox=sh.querySelector('[data-custom-rows]'),addBtn=sh.querySelector('[data-add-field]'),fieldHint=sh.querySelector('#vault-field-hint');
 const bindReveal=root=>root.querySelectorAll('[data-reveal]').forEach(b=>b.onclick=()=>{
  const el=document.getElementById(b.dataset.reveal),on=b.getAttribute('aria-pressed')!=='true';
  if(el.tagName==='TEXTAREA')el.classList.toggle('vault-masked',!on);else el.type=on?'text':'password';
  b.setAttribute('aria-pressed',String(on));
 });
 bindReveal(box);
 // Custom rows: the 20-field cap counts the fields kept plus the rows being added.
 const keptCount=()=>rowsBox.querySelectorAll('[data-custom]:not(.removing),[data-new-field]').length;
 const syncCustom=()=>{fieldHint.hidden=!rowsBox.querySelector('[data-new-field]');addBtn.disabled=keptCount()>=VAULT_CUSTOM_MAX;};
 const clearRowError=row=>{const e=row.querySelector('.vault-field-error');if(e)e.textContent='';row.querySelectorAll('[aria-invalid]').forEach(x=>x.removeAttribute('aria-invalid'));};
 const fieldError=(row,msg,input)=>{row.querySelector('.vault-field-error').textContent=msg;input.setAttribute('aria-invalid','true');input.focus();};
 const bindNewRow=row=>{
  bindReveal(row);
  const nIn=row.querySelector('[data-custom-name]');
  nIn.oninput=()=>{const v=nIn.value.toLowerCase().replace(/[\s-]/g,'_');if(v!==nIn.value){const p=nIn.selectionStart;nIn.value=v;nIn.setSelectionRange(p,p);}clearRowError(row);err.textContent='';};
  row.querySelector('[data-custom-value]').addEventListener('input',()=>{clearRowError(row);err.textContent='';});
  row.querySelector('[data-drop-field]').onclick=()=>{row.querySelector('[data-custom-value]').value='';row.remove();syncCustom();addBtn.focus();};
 };
 const addRow=focus=>{rowsBox.insertAdjacentHTML('beforeend',vaultNewFieldHTML());const row=rowsBox.lastElementChild;bindNewRow(row);syncCustom();if(focus)row.querySelector('[data-custom-name]').focus();return row;};
 rowsBox.querySelectorAll('[data-custom]').forEach(row=>{
  bindReveal(row);
  const rm=row.querySelector('[data-remove-field]'),val=row.querySelector('[data-custom-value]');
  rm.onclick=()=>{
   const on=rm.getAttribute('aria-pressed')!=='true';
   row.classList.toggle('removing',on);rm.setAttribute('aria-pressed',String(on));rm.textContent=on?'Undo':'Remove';
   row.querySelector('.vault-removing').hidden=!on;val.disabled=on;if(on)val.value='';
   syncCustom();
  };
 });
 addBtn.onclick=()=>addRow(true);
 if(!t&&kind==='credentials')addRow(false);
 syncCustom();
 if(!t)form.elements.kind.onchange=()=>{
  const k=form.elements.kind.value;
  box.innerHTML=vaultSecretFieldsHTML(k,false);bindReveal(box); // the custom rows typed so far stay
  sh.querySelector('#vault-custom-h').textContent=customHead(k);sh.querySelector('[data-kind-sub]').textContent=VAULT_KIND_SUB[k]||'';
  if(k==='credentials'&&!rowsBox.querySelector('[data-new-field]'))addRow(false);
 };
 const nameIn=form.elements.name;
 nameIn.oninput=()=>{const v=nameIn.value.toLowerCase().replace(/[\s_]/g,'-');if(v!==nameIn.value){const p=nameIn.selectionStart;nameIn.value=v;nameIn.setSelectionRange(p,p);}nameIn.removeAttribute('aria-invalid');err.textContent='';};
 const polHint=()=>{sh.querySelector('[data-policy-hint]').textContent=VAULT_POLICY[form.elements.policy.value][1]+'.';};
 form.elements.policy.onchange=polHint;polHint();
 sh.querySelector('[data-clear-exp]').onclick=()=>{form.elements.expires.value='';};
 const wipe=()=>form.querySelectorAll('[data-secret],[data-custom-value]').forEach(el=>{el.value='';});
 onSheetGone(sh,wipe); // typed values never outlive the sheet
 form.onsubmit=async e=>{
  e.preventDefault();err.textContent='';rowsBox.querySelectorAll('[data-new-field]').forEach(clearRowError);
  const name=nameIn.value.trim();
  if(!VAULT_NAME_RE.test(name)){nameIn.setAttribute('aria-invalid','true');err.textContent='Name: 1 to 64 lowercase letters, numbers or hyphens.';nameIn.focus();return;}
  const k=t?t.kind:form.elements.kind.value,fixed=vaultFixedFields(k),values={},removeFields=[];
  for(const el of box.querySelectorAll('[data-secret]')){const f=el.dataset.secret,v=f==='value'||f==='username'?el.value.trim():el.value;if(v)values[f]=v;}
  if(!t){const need=fixed.find(f=>!values[f]);if(need){err.textContent=vaultFieldWord(k,need)+' is required.';box.querySelector(`[data-secret="${need}"]`)?.focus();return;}} // the server needs every fixed field of the kind
  for(const row of rowsBox.querySelectorAll('[data-custom]')){
   if(row.classList.contains('removing')){removeFields.push(row.dataset.custom);continue;}
   const v=row.querySelector('[data-custom-value]').value.trim();if(v)values[row.dataset.custom]=v;
  }
  // New fields: refused here, beside the row, before anything is sent.
  const seen=new Set();
  for(const row of rowsBox.querySelectorAll('[data-new-field]')){
   const nIn=row.querySelector('[data-custom-name]'),vIn=row.querySelector('[data-custom-value]'),n=nIn.value.trim(),v=vIn.value.trim();
   if(!n&&!v)continue;
   const why=!n?'Give this field a name.'
    :!VAULT_FIELD_RE.test(n)?'Start with a letter, then up to 31 lowercase letters, digits or underscores.'
    :fixed.includes(n)?`${VAULT_KIND_WORD[k]} already has a field named ${n}.`
    :existing.includes(n)?`This secret already has a field named ${n}.`
    :seen.has(n)?`Two fields are named ${n}.`:'';
   if(why)return fieldError(row,why,nIn);
   if(!v)return fieldError(row,`Give ${n} a value, or remove this field.`,vIn);
   seen.add(n);values[n]=v;
  }
  if(rowsBox.querySelectorAll('[data-custom]:not(.removing)').length+seen.size>VAULT_CUSTOM_MAX){err.textContent=`A secret can have up to ${VAULT_CUSTOM_MAX} custom fields.`;return;}
  if(!t&&!Object.keys(values).length){err.textContent='Add at least one field with a value.';(rowsBox.querySelector('[data-new-field] [data-custom-name]')||addRow(false).querySelector('[data-custom-name]')).focus();return;}
  let url=form.elements.url.value.trim();if(url&&!/^[a-z][a-z0-9+.-]*:/i.test(url))url='https://'+url;
  const tags=[...new Set(form.elements.tags.value.split(',').map(s=>s.trim()).filter(Boolean))];
  let expiresAt=null;if(form.elements.expires.value){const d=new Date(form.elements.expires.value+'T23:59:59');if(Number.isNaN(d.getTime())){err.textContent='Pick an expiry date, or clear it.';return;}expiresAt=d.toISOString();}
  const meta={url,notes:form.elements.notes.value.trim(),tags,policy:form.elements.policy.value,expiresAt};
  const body=t?{action:'update',item:t.id,expected_revision:revision,...(name!==t.name?{name}:{}),...(Object.keys(values).length?{values}:{}),...(removeFields.length?{removeFields}:{}),...meta}:{action:'add',name,kind:k,values,...meta};
  const btn=form.querySelector('.primary');btn.disabled=true;
  try{
   const r=await api('/vault/act',{method:'POST',body:JSON.stringify(body),cache:'no-store'});
   mergeVaultItem(r.item);repaintVault();wipe();
   closeCurrentSheet?.();
   if(insert&&r.item)insert(r.item.name);
   toast(t?'Saved '+(r.item?.name||name):'Stored in the Vault as '+(r.item?.name||name));
  }catch(e2){
   if(e2.message==='login')return;
   const msg=e2.message||'Could not save.';
   if(e2.status===409&&e2.body?.item){mergeVaultItem(e2.body.item);revision=e2.body.item.revision;repaintVault();err.textContent='This secret changed on another device. Check the fields and save again.';return;}
   // A refused field name goes under the row that named it.
   const row=[...rowsBox.querySelectorAll('[data-new-field]')].find(r=>{const n=r.querySelector('[data-custom-name]').value.trim();return n&&new RegExp('(^|[^a-z0-9_])'+n+'($|[^a-z0-9_])').test(msg);});
   if(row)fieldError(row,msg,row.querySelector('[data-custom-name]'));
   else{err.textContent=msg;if(/name/i.test(msg)&&!/field/i.test(msg)){nameIn.setAttribute('aria-invalid','true');nameIn.focus();}}
  }finally{if(btn.isConnected)btn.disabled=false;}
 };
 mountSheet(scrim,sh);
}
// The composer's Store in the Vault: the add sheet, never the message. Once stored, the message box gets the name.
function addVaultItemFromComposer({insert=true}={}){
 const box=insert?(document.getElementById('box')||document.getElementById('first')):null;
 vaultEditor(null,{insert:box?name=>{
  if(!box.isConnected)return;
  const ref=`{{vault:${name}}}`,s=box.selectionStart??box.value.length,e=box.selectionEnd??s,before=box.value.slice(0,s),after=box.value.slice(e),pad=before&&!/\s$/.test(before)?' ':'';
  box.value=before+pad+ref+(after&&!/^\s/.test(after)?' ':'')+after;box.setSelectionRange(s+pad.length+ref.length,s+pad.length+ref.length);
  box.dispatchEvent(new Event('input',{bubbles:true}));box.focus({preventScroll:true});
 }:null});
}

/* ---------- Settings: rotate the key, shown once ---------- */
function rotateVaultKey(){
 confirmSheet('Rotate the Vault key?','Pocket re-encrypts the Vault under a new key and shows that key once. Backups made before now still need the old key, so keep it with them.','Rotate key',async()=>{
  try{const r=await api('/vault/rotate',{method:'POST',body:'{}',cache:'no-store'});vaultKeySheet(r.key);}
  catch(e){if(e.message!=='login')toast(e.message||'Could not rotate the key');}
 });
}
function vaultKeySheet(key){
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet vault-key-sheet';
 sh.innerHTML=`<h2>New Vault key</h2><p class="sheet-help">Put this in .env as POCKET_VAULT_KEY and restart Pocket Code. Until then the old key still works.</p>
  <code class="vault-key" tabindex="0" aria-label="New Vault key"></code>
  <p class="vault-hint">This is the only time it is shown.</p>
  <div class="vault-key-actions"><button class="chip" data-copy-key>${IC.copy}Copy</button><button class="primary" data-done>Done</button></div>`;
 const code=sh.querySelector('.vault-key');code.textContent=key||'';
 sh.querySelector('[data-copy-key]').onclick=e=>vaultCopy(code.textContent,e.currentTarget,'Key');
 sh.querySelector('[data-done]').onclick=()=>closeCurrentSheet?.();
 onSheetGone(sh,()=>{code.textContent='';});
 mountSheet(scrim,sh);
}

/* ---------- rail, home chip, badges, tabs ---------- */
function railVaultHTML(){
 if(!vaultSnap)return '<p class="sheet-help">Loading the Vault…</p>';
 const reqs=vaultRequests();
 return `<div class="rail-projects rail-vault"><div class="rail-project-actions"><button class="chip" id="rail-vault-add">${IC.plus}Add secret</button><a class="chip" href="${viewHref('vault')}" data-view-link>All</a></div>
  ${reqs.length?`<section class="vault-requests" aria-label="Requests waiting">${reqs.map(r=>vaultRequestHTML(r,'rail')).join('')}</section>`:''}
  ${vaultSnap.items.length?vaultSnap.items.slice(0,60).map(vaultRowHTML).join(''):'<p class="sheet-help">No secrets yet. Add one, or use Store in the Vault in a conversation.</p>'}
  ${vaultSnap.trash.length?`<a class="rail-done-link" href="${viewHref('vault')}" data-view-link>${vaultSnap.trash.length} removed</a>`:''}</div>`;
}
function paintRailVault(){
 const el=document.getElementById('rail');if(!el||railView()!=='vault')return;
 el.innerHTML=railVaultHTML();
 el.querySelector('#rail-vault-add')?.addEventListener('click',()=>vaultEditor(null));
 bindVaultRows(el);
 if(!vaultSnap)loadVault().then(()=>{paintRailVault();paintVaultBadges();}).catch(()=>{const r=document.getElementById('rail');if(r&&railView()==='vault')r.innerHTML='<p class="sheet-help">The Vault could not load.</p>';});else paintVaultBadges();
}
function paintVaultBadges(){
 const n=vaultRequestCount();
 document.querySelectorAll('[data-vault-badge]').forEach(el=>{el.textContent=n?String(n):'';el.hidden=!n;});
 document.querySelectorAll('[data-vault-home]').forEach(el=>{el.textContent='Vault'+(n?' · '+n+' waiting':'');el.classList.toggle('due',n>0);});
}
const vaultTabState=()=>{const n=vaultRequestCount();return n?{kind:'input',label:n===1?'A request is waiting':n+' requests are waiting'}:null;};
setInterval(()=>{if(!vaultOn()||document.visibilityState!=='visible'||!(vaultView||railView()==='vault'||document.querySelector('[data-vault-home],[data-vault-badge]')||openSessions?.some?.(s=>s.id==='vault')))return;loadVault(true).then(()=>{repaintVault();}).catch(()=>{});},30000);
