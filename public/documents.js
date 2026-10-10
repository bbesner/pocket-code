/* Documents (1.30): the library of files that came out of the work, inside Pocket Code. Off until Settings →
   Projects & documents turns it on (window.pocketFeatures.documents). Views: the library (#/documents) and one document
   (#/documents/<id>); both open like a session (tab, beside a conversation, full-screen on the phone) and, since
   1.31, in a window of their own (?solo=1); a document also opens in the device's own viewer or downloads. HTML
   renders in a sandboxed frame: the server's policy denies it cookies, storage and the API; scripts in a dashboard
   still run. */
const documentsOn=()=>Boolean(window.pocketFeatures?.documents);
let docsSnap=null,docsAt=0,docsLoading=null,docView=null,docFilterProject='',docFilterVis='',docFilterKind='',docQuery='',railDocQuery='';
// 1.32: the library is a grid of previews on a wide screen (remembered per browser), a list on a phone.
const gridOn=()=>matchMedia('(min-width: 700px)').matches&&readLocal('pc-documents-layout','grid')==='grid';
const docById=id=>docsSnap?.documents.find(d=>d.id===id)||docsSnap?.trash.find(d=>d.id===id)||null;
async function loadDocs(force){
 if(!force&&docsSnap&&Date.now()-docsAt<4000)return docsSnap;
 if(docsLoading)return docsLoading;
 docsLoading=api('/documents',{signal:AbortSignal.timeout(8000)}).then(s=>{docsSnap=s;docsAt=Date.now();return s;}).finally(()=>{docsLoading=null;});
 return docsLoading;
}
function mergeDoc(d){
 if(!docsSnap)return;
 docsSnap.documents=docsSnap.documents.filter(x=>x.id!==d.id);docsSnap.trash=docsSnap.trash.filter(x=>x.id!==d.id);
 (d.trashedAt?docsSnap.trash:docsSnap.documents).unshift(d);
 docsSnap.documents.sort((a,b)=>Date.parse(b.added)-Date.parse(a.added));
}
async function docAct(id,body,done){
 try{const d=await api('/documents/'+encodeURIComponent(id),{method:'POST',body:JSON.stringify(body)});mergeDoc(d);if(done)toast(done);paintDocumentsView();paintRailDocuments();if(typeof paintProjectsView==='function')paintProjectsView();return d;}
 catch(e){toast(e.message||'Could not update the file');return null;}
}
const KIND_WORD={html:'HTML',pdf:'PDF',md:'MD',txt:'TXT',image:'IMG',table:'CSV',json:'JSON',office:'DOC',video:'MP4'};
// Library filter groups: a handful of chips, not one per extension.
const KIND_GROUP={html:'html',pdf:'pdf',image:'image',md:'text',txt:'text',table:'data',json:'data',office:'other',video:'other'};
const KIND_GROUPS=[['html','HTML reports'],['pdf','PDFs'],['image','Images'],['text','Markdown and text'],['data','CSV and JSON'],['other','Office and video']];
const visWord={private:'Private',link:'Link',public:'Public'};
const visLong={private:'Private',link:'Anyone with the link',public:'Public'};
const docRawUrl=(d,download)=>'/api/documents/'+encodeURIComponent(d.id)+'/raw'+(download?'?download=1':'');
const docShareUrl=d=>d.visibility==='public'&&d.url?location.origin+d.url:d.visibility==='link'&&d.share?.url?location.origin+d.share.url:'';
const docAppUrl=d=>location.origin+'/#/documents/'+d.id; // the in-app address: needs the Pocket login
const fmtSize=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?Math.round(n/1024)+' KB':n+' B';
const docViewTitle=id=>id==='documents'?'Files':docById(id.slice(10))?.title||'File';
const docProjectName=d=>d.project?(typeof projectById==='function'&&projectById(d.project)?.name)||d.project:'';
const docSessionName=d=>d.session?(typeof sessionName==='function'?sessionName(d.session):d.session):'';
const docWhere=d=>[...new Set([docProjectName(d),docSessionName(d)].filter(Boolean))].join(' · ');
// Search covers the title, file name, project, session, kind and visibility words.
const docSearchText=d=>[d.title,d.file,docWhere(d),KIND_WORD[d.kind],d.kind,visLong[d.visibility]].join(' ').toLowerCase();
async function copyLink(url,btn){
 try{
  if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(url);
  else{const ta=document.createElement('textarea');ta.value=url;document.body.append(ta);ta.select();document.execCommand('copy');ta.remove();}
  if(btn&&btn.isConnected){const was=btn.innerHTML;btn.innerHTML=IC.tick+(btn.classList.contains('chip')?'Copied':'');btn.classList.add('ok');setTimeout(()=>{if(btn.isConnected){btn.innerHTML=was;btn.classList.remove('ok');}},1400);}
  toast('Link copied');
 }catch{toast('Copy failed');}
}

/* ---------- the two views ---------- */
async function renderDocuments(view){
 Voice.onLeave?.();
 docView=view;if(typeof boardView!=='undefined')boardView=null;
 const kind=view==='documents'?'list':'doc';
 const col=`<header class="bar">
   ${PANE?`<button class="icon" id="pane-main" aria-label="Make this the main view">${IC.swap}</button>`:SOLO?'':`<button class="icon" id="back" aria-label="Back">${IC.back}</button><button class="icon desk" id="railtog" aria-label="Show or hide the session list">${IC.panel}</button>`}
   <h1><span class="one" id="dtitle">${esc(docViewTitle(view))}</span><span class="tag" id="dtag">${kind==='list'?'From your sessions':'File'}</span></h1>
   ${kind==='doc'?`<button class="icon" id="dmore" aria-label="File options">${IC.more}</button>`:''}
   ${SOLO?'':`<button class="icon" id="dwin" aria-label="Open in a new window" title="Open in a new window">${IC.external}</button>`}
   ${PANE||SOLO?'':`<button class="icon desk" id="splitb" aria-label="Split view">${IC.columns}</button>`}
   ${PANE?`<button class="icon" id="pane-close" aria-label="Close this pane">${IC.x}</button>`:''}
  </header>
  <main class="scroll documents-view" id="documents-main" data-kind="${kind}" tabindex="-1"><p class="sheet-help documents-loading">Loading files…</p></main>`;
 app.innerHTML=withShell(col);
 wireShell();
 if(PANE){$('#pane-main').onclick=()=>paneSay('main',{view});$('#pane-close').onclick=()=>paneSay('close');}
 else if(!SOLO){bindViewBack($('#back'), view);$('#splitb').onclick=chooseBeside;}
 $('#dmore')?.addEventListener('click',()=>documentOptions(view.slice(10)));
 $('#dwin')?.addEventListener('click',()=>openInWindow(view));
 const tog=$('#railtog');if(tog)tog.onclick=()=>{localStorage.setItem('pc-rail',railOpen()?'closed':'open');route();};
 try{await Promise.all([loadDocs(true),typeof refreshSessions==='function'?refreshSessions().catch(()=>{}):null,typeof projectsOn==='function'&&projectsOn()&&typeof loadBoard==='function'?loadBoard().catch(()=>{}):null]);}
 catch(e){if(docView!==view)return;const main=$('#documents-main');if(!main)return;if(docsSnap)paintDocumentsView();showLibraryError(main,e,'Files',()=>renderDocuments(view),Boolean(docsSnap));restoreViewPosition(view);return;}
 if(docView!==view)return;
 if(kind==='doc'&&!docById(view.slice(10))){$('#documents-main').innerHTML='<p class="sheet-help">That file does not exist. It may have been removed on another device.</p>';return;}
 if(PANE)paneSay('route',{id:view,title:docViewTitle(view)});else if(SOLO)document.title=docViewTitle(view)+' · Pocket Code';else rememberOpenView(view,docViewTitle(view));
 paintDocumentsView();
 restoreViewPosition(view);
}
function paintDocumentsView(){
 const main=$('#documents-main');if(!main||!docsSnap||!docView)return;
 const typing=main.contains(document.activeElement)&&document.activeElement.matches('input')?document.activeElement:null;
 if(typing&&typing.id==='doc-query')return;
 if(main.dataset.kind==='list'){main.innerHTML=libraryHTML();bindLibrary(main);}
 else{const d=docById(docView.slice(10));if(!d)return;main.innerHTML=documentHTML(d);bindDocument(main,d);const t=$('#dtitle');if(t)t.textContent=d.title;const g=$('#dtag');if(g)g.textContent=[KIND_WORD[d.kind],fmtSize(d.size),visWord[d.visibility],docProjectName(d)].filter(Boolean).join(' · ');}
 if(typeof paintOpenSessions==='function')paintOpenSessions();
}
function docRowHTML(d){
 const where=docWhere(d),url=docShareUrl(d);
 return `<div class="session-item document-item ${docView==='documents/'+d.id?'cur':''}" data-item="${esc(d.id)}">
  <a class="row" href="${viewHref('documents/'+d.id)}" data-document="${esc(d.id)}"><span class="body"><span class="title"><span class="doc-kind">${KIND_WORD[d.kind]||'FILE'}</span>${esc(d.title)}${d.missing?' <span class="due-label">(file missing)</span>':''}</span>
   <span class="meta">${esc(where||d.file)}</span>
   <span class="session-status"><span class="doc-vis vis-${esc(d.visibility)}">${visWord[d.visibility]}</span><span>${esc(rel(Date.parse(d.added)))}</span>${d.addedBy==='session'||d.session?'<span aria-hidden="true">·</span><span>from a session</span>':''}</span></span></a>
  ${url?`<button class="session-more icon" data-copy-link="${esc(d.id)}" aria-label="Copy the ${visWord[d.visibility].toLowerCase()} link for ${esc(d.title)}" title="Copy link">${IC.link}</button>`:''}
  <button class="session-more icon" data-document-more="${esc(d.id)}" aria-label="Options for ${esc(d.title)}">${IC.more}</button></div>`;
}
function docCardHTML(d){
 const where=docWhere(d),url=docShareUrl(d),pic=Boolean(docsSnap.thumbs?.[d.kind])&&!d.missing;
 return `<div class="doc-card ${docView==='documents/'+d.id?'cur':''}" data-item="${esc(d.id)}">
  <a class="doc-card-link" href="${viewHref('documents/'+d.id)}" data-document="${esc(d.id)}"><span class="doc-thumb" data-kind="${esc(d.kind)}">${pic?`<img src="/api/documents/${esc(d.id)}/thumb" alt="" loading="lazy" decoding="async">`:''}<span class="doc-thumb-kind"><span class="doc-kind">${KIND_WORD[d.kind]||'FILE'}</span></span></span>
   <span class="doc-card-body"><span class="doc-card-title">${esc(d.title)}${d.missing?' <span class="due-label">(file missing)</span>':''}</span><span class="doc-card-meta">${esc(where||d.file)}</span>
   <span class="session-status"><span class="doc-vis vis-${esc(d.visibility)}">${visWord[d.visibility]}</span><span>${esc(rel(Date.parse(d.added)))}</span></span></span></a>
  <span class="doc-card-actions">${url?`<button class="session-more icon" data-copy-link="${esc(d.id)}" aria-label="Copy the ${visWord[d.visibility].toLowerCase()} link for ${esc(d.title)}" title="Copy link">${IC.link}</button>`:''}<button class="session-more icon" data-document-more="${esc(d.id)}" aria-label="Options for ${esc(d.title)}">${IC.more}</button></span></div>`;
}
function libraryHTML(){
 const q=docQuery.trim().toLowerCase(),all=docsSnap.documents;
 const rows=all.filter(d=>(!docFilterProject||d.project===docFilterProject)&&(!docFilterVis||d.visibility===docFilterVis)&&(!docFilterKind||KIND_GROUP[d.kind]===docFilterKind)&&(!q||docSearchText(d).includes(q)));
 const projects=typeof boardSnap!=='undefined'&&boardSnap?boardSnap.projects:[];
 const count=v=>all.filter(d=>d.visibility===v).length;
 const chip=(v,label,n)=>`<button class="chip" data-vis="${v}" aria-pressed="${docFilterVis===v}">${label} <span>${n}</span></button>`;
 const filtered=docFilterProject||docFilterVis||docFilterKind||q;
 const heading=docFilterProject?projects.find(p=>p.id===docFilterProject)?.name||'Project':docFilterVis?visLong[docFilterVis]:docFilterKind?KIND_GROUPS.find(g=>g[0]===docFilterKind)[1]:q?'Matching':'All';
 const grid=gridOn();
 return `<div class="session-home-head"><h2>Files</h2><span class="project-head-actions"><span class="doc-layout" role="group" aria-label="Layout"><button class="icon" data-layout="list" aria-pressed="${!grid}" aria-label="List" title="List">${IC.list}</button><button class="icon" data-layout="grid" aria-pressed="${grid}" aria-label="Grid with previews" title="Grid with previews">${IC.grid}</button></span><button class="chip" id="doc-upload">${IC.up}Upload</button><input type="file" id="doc-file" multiple hidden></span></div>
  <div class="documents-tools"><div class="session-search">${IC.search}<input type="search" id="doc-query" placeholder="Search files" aria-label="Search files by title, file name, project or session" value="${esc(docQuery)}" autocomplete="off"></div>
   ${projects.length?`<label class="voice-field doc-project-filter">Project<select id="doc-project"><option value="">All projects</option>${projects.map(p=>`<option value="${esc(p.id)}" ${docFilterProject===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>`:''}
   <label class="voice-field doc-kind-filter">Kind<select id="doc-kind"><option value="">All kinds</option>${KIND_GROUPS.map(([v,label])=>`<option value="${v}" ${docFilterKind===v?'selected':''}>${label}</option>`).join('')}</select></label></div>
  <div class="doc-filters" role="group" aria-label="Show files by visibility">${chip('','All',all.length)}${chip('private','Private',count('private'))}${chip('link','Link',count('link'))}${chip('public','Public',count('public'))}${filtered?'<button class="chip" id="doc-clear">Clear</button>':''}</div>
  ${rows.length?`<section class="session-group document-group"><h2>${esc(heading)} <span>${rows.length}${rows.length!==all.length?' of '+all.length:''}</span></h2>${grid?`<div class="doc-grid">${rows.map(docCardHTML).join('')}</div>`:rows.map(docRowHTML).join('')}</section>`
   :`<p class="sheet-help project-empty">${filtered?'No files match.':'No files yet. Upload one, keep a result from a session\'s Results panel, or let an agent keep one with <code>pocket-docs add</code>. Files placed in the library\'s folder on the server appear here too.'}</p>`}
  ${docsSnap.trash.length?`<details class="session-group document-group settings-details"><summary><h2>Trash <span>${docsSnap.trash.length}</span></h2></summary><p class="sheet-help">Removed files stay here for ${docsSnap.limits?.trashDays||30} days, then are deleted.</p>${docsSnap.trash.map(d=>`<div class="session-item document-item" data-item="${esc(d.id)}"><span class="row"><span class="body"><span class="title"><span class="doc-kind">${KIND_WORD[d.kind]||'FILE'}</span>${esc(d.title)}</span><span class="meta">Removed ${esc(rel(Date.parse(d.trashedAt)))}</span></span></span><button class="chip" data-restore="${esc(d.id)}">Restore</button></div>`).join('')}</details>`:''}`;
}
function bindDocRows(root){
 root.querySelectorAll('[data-document-more]').forEach(b=>b.onclick=()=>documentOptions(b.dataset.documentMore));
 root.querySelectorAll('[data-copy-link]').forEach(b=>b.onclick=()=>{const d=docById(b.dataset.copyLink);if(d)copyLink(docShareUrl(d),b);});
 root.querySelectorAll('a[data-document]').forEach(a=>a.onclick=e=>{const id='documents/'+a.dataset.document;openViewPreferred(id,'pc-documents-open',e,isWide()&&docView!==id);});
}
function bindLibrary(main){
 main.querySelector('#doc-query').oninput=e=>{docQuery=e.target.value;paintDocumentsViewSoon();};
 main.querySelector('#doc-project')?.addEventListener('change',e=>{docFilterProject=e.target.value;paintDocumentsView();});
 main.querySelector('#doc-kind').onchange=e=>{docFilterKind=e.target.value;paintDocumentsView();};
 main.querySelectorAll('[data-vis]').forEach(b=>b.onclick=()=>{docFilterVis=b.dataset.vis;paintDocumentsView();});
 main.querySelector('#doc-clear')?.addEventListener('click',()=>{docFilterProject='';docFilterVis='';docFilterKind='';docQuery='';paintDocumentsView();main.querySelector('#doc-query')?.focus({preventScroll:true});});
 main.querySelectorAll('[data-layout]').forEach(b=>b.onclick=()=>{writeLocal('pc-documents-layout',b.dataset.layout);paintDocumentsView();});
 main.querySelectorAll('.doc-thumb img').forEach(img=>{const shown=()=>img.parentElement?.classList.add('loaded');img.onload=shown;img.onerror=()=>img.remove();if(img.complete&&img.naturalWidth)shown();});
 main.querySelector('#doc-upload').onclick=()=>main.querySelector('#doc-file').click();
 main.querySelector('#doc-file').onchange=e=>uploadDocuments([...e.target.files]);
 main.querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>docAct(b.dataset.restore,{action:'restore'},'Restored'));
 bindDocRows(main);
}
let docPaintT=null;
function paintDocumentsViewSoon(){clearTimeout(docPaintT);docPaintT=setTimeout(()=>{const main=$('#documents-main');if(!main||main.dataset.kind!=='list')return;const q=document.activeElement;const pos=q?.selectionStart;const scroll=main.scrollTop;main.innerHTML=libraryHTML();bindLibrary(main);main.scrollTop=scroll;const input=main.querySelector('#doc-query');if(input&&q?.id==='doc-query'){input.focus({preventScroll:true});try{input.setSelectionRange(pos,pos);}catch{}}},150);}
async function uploadDocuments(files){
 let added=0;
 for(const f of files){
  try{const r=await fetch('/api/documents',{method:'POST',headers:{'x-filename':f.name,'content-type':'application/octet-stream',...(docFilterProject?{'x-project':docFilterProject}:{})},body:f});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||r.statusText);mergeDoc(j);added++;}
  catch(e){toast(`${f.name}: ${e.message||'upload failed'}`);}
 }
 if(added){toast(added===1?'File added':added+' files added');paintDocumentsView();}
}
function documentHTML(d){
 const raw=docRawUrl(d),dl=docRawUrl(d,true),url=docShareUrl(d);
 const tools=`<div class="doc-tools"><a class="chip" href="${esc(raw)}" target="_blank" rel="noopener noreferrer">${IC.globe}Open in your viewer</a><a class="chip" href="${esc(dl)}" download="${esc(d.file)}">${IC.down}Download</a><button class="chip ${d.visibility!=='private'?'set':''}" data-share>${IC.share}${d.visibility==='private'?'Share':visWord[d.visibility]+' · Share'}</button>${url?`<button class="chip" data-copy-link="${esc(d.id)}">${IC.link}Copy link</button>`:''}${typeof projectsOn==='function'&&projectsOn()?`<button class="chip" data-project>${IC.folder}${d.project?esc(docProjectName(d)):'Project'}</button>`:''}${d.session?`<a class="chip" href="#/chat/${esc(d.session)}">${IC.term}Session</a>`:''}</div>`;
 let body;
 if(d.missing)body='<p class="sheet-help">This file is missing from the library\'s folder on the server.</p>';
 else if(!d.inline)body=`<p class="sheet-help doc-note">${d.kind==='office'?'Office files open in your own viewer.':d.kind==='video'?'Video opens in your own viewer.':'This file is too large to show here.'} Use Open in your viewer or Download.</p>${d.kind==='video'?`<video class="doc-media" controls preload="none" src="${esc(raw)}"></video>`:''}`;
 else if(d.kind==='html')body=`<iframe class="doc-frame" src="${esc(raw)}" sandbox="allow-scripts allow-popups allow-downloads allow-forms" title="${esc(d.title)}" referrerpolicy="no-referrer"></iframe>`;
 else if(d.kind==='pdf')body=`<iframe class="doc-frame" src="${esc(raw)}" title="${esc(d.title)}" referrerpolicy="no-referrer"></iframe>`;
 else if(d.kind==='image')body=`<div class="doc-media-wrap"><img class="doc-media" src="${esc(raw)}" alt="${esc(d.title)}"></div>`;
 else body=`<div class="doc-text" data-doc-text="${esc(d.kind)}"><p class="sheet-help">Loading…</p></div>`;
 return tools+body;
}
function bindDocument(main,d){
 main.querySelector('[data-share]').onclick=()=>shareSheet(d.id);
 main.querySelector('[data-copy-link]')?.addEventListener('click',e=>copyLink(docShareUrl(d),e.currentTarget));
 main.querySelector('[data-project]')?.addEventListener('click',()=>docProjectSheet(d.id));
 const text=main.querySelector('[data-doc-text]');
 if(text)fetch(docRawUrl(d),{credentials:'same-origin'}).then(r=>r.ok?r.text():Promise.reject(new Error(r.statusText))).then(src=>{if(!text.isConnected)return;
  if(d.kind==='md')text.innerHTML=`<div class="m-asst doc-md">${md(src)}</div>`;
  else if(d.kind==='table')text.innerHTML=tableHTML(src,d.file.endsWith('.tsv')?'\t':',');
  else text.innerHTML=`<pre class="doc-pre">${esc(d.kind==='json'?prettyJson(src):src)}</pre>`;
 }).catch(e=>{if(text.isConnected)text.innerHTML=`<p class="sheet-help">Could not load the file: ${esc(e.message)}</p>`;});
}
const prettyJson=s=>{try{return JSON.stringify(JSON.parse(s),null,2);}catch{return s;}};
// A small CSV/TSV reader: quoted fields with doubled quotes; the first row is the header. Capped at 2,000 rows.
function tableHTML(src,sep){
 const rows=[];let row=[],field='',q=false;
 for(let i=0;i<src.length&&rows.length<2001;i++){const c=src[i];
  if(q){if(c==='"'){if(src[i+1]==='"'){field+='"';i++;}else q=false;}else field+=c;}
  else if(c==='"')q=true;else if(c===sep){row.push(field);field='';}else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}else field+=c;}
 if(field||row.length){row.push(field);rows.push(row);}
 const [head,...body]=rows.filter(r=>r.length>1||r[0]);
 if(!head)return '<p class="sheet-help">Empty table.</p>';
 return `<div class="doc-table-wrap"><table class="doc-table"><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body.slice(0,2000).map(r=>`<tr>${head.map((_,i)=>`<td>${esc(r[i]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table>${body.length>2000?'<p class="sheet-help">Showing the first 2,000 rows.</p>':''}</div>`;
}
/* ---------- sheets ---------- */
function documentOptions(id){
 const d=docById(id);if(!d)return;
 const here=docView==='documents/'+id,url=docShareUrl(d),shared=d.visibility!=='private';
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet document-options';
 sh.innerHTML=`<h2>File options</h2><p class="sheet-name">${esc(d.title)}</p><p class="sheet-help">${esc([KIND_WORD[d.kind],fmtSize(d.size),d.file].join(' · '))}</p>
  ${d.trashedAt?`<button class="opt" data-restore>${IC.up}<span>Restore<span class="sub">Back to the library; links stay off until you share it again</span></span></button>`:
  optGroup('Open',[
   here?'':`<button class="opt" data-open>${IC.doc}<span>Open<span class="sub">${PANE?'In this pane':SOLO?'In this window':'As a tab, like a session'}</span></span></button>`,
   !PANE&&!SOLO&&isWide()&&!here&&typeof openBeside==='function'?`<button class="opt" data-beside>${IC.columns}<span>Open beside<span class="sub">In a pane next to the current view</span></span></button>`:'',
   `<button class="opt" data-window>${IC.external}<span>Open in a new window<span class="sub">A browser tab or app window of its own</span></span></button>`,
   `<a class="opt" href="${esc(docRawUrl(d))}" target="_blank" rel="noopener noreferrer">${IC.globe}<span>Open in your viewer<span class="sub">The file itself, in the app your device uses for it</span></span></a>`,
   `<a class="opt" href="${esc(docRawUrl(d,true))}" download="${esc(d.file)}">${IC.down}<span>Download</span></a>`])
  +optGroup('Share',[
   url?`<button class="opt" data-copy-link>${IC.link}<span>Copy link<span class="sub">${d.visibility==='link'?'The unguessable address':'The public address'}</span></span></button>`:'',
   `<button class="opt" data-share>${IC.share}<span>${shared?'Sharing: '+esc(visLong[d.visibility]):'Share'}<span class="sub">${shared?'Change who can open it, set an expiry, or make it private':'Private now. Make a link, or give it a public address'}</span></span></button>`])
  +optGroup('Organize',[
   typeof projectsOn==='function'&&projectsOn()?`<button class="opt" data-project>${IC.folder}<span>${d.project?'Project: '+esc(docProjectName(d)):'Add to a project'}</span></button>`:'',
   `<button class="opt" data-rename>${IC.pen}<span>Rename</span></button>`,
   `<button class="opt" data-trash>${IC.x}<span>Remove<span class="sub">To the trash for ${docsSnap?.limits?.trashDays||30} days; links stop working</span></span></button>`])}`;
 const close=()=>closeCurrentSheet?.();
 sh.querySelector('[data-open]')?.addEventListener('click',()=>{close();location.hash=viewHref('documents/'+id);});
 sh.querySelector('[data-beside]')?.addEventListener('click',()=>{close();openBeside('documents/'+id);});
 sh.querySelector('[data-window]')?.addEventListener('click',()=>{close();openInWindow('documents/'+id);});
 sh.querySelector('[data-restore]')?.addEventListener('click',()=>{close();docAct(id,{action:'restore'},'Restored');});
 sh.querySelector('[data-copy-link]')?.addEventListener('click',()=>{close();copyLink(url);});
 sh.querySelector('[data-share]')?.addEventListener('click',()=>{close();shareSheet(id);});
 sh.querySelector('[data-project]')?.addEventListener('click',()=>{close();docProjectSheet(id);});
 sh.querySelector('[data-rename]')?.addEventListener('click',()=>{close();textSheet('Rename file',d.title,200,title=>docAct(id,{title},'Renamed'));});
 sh.querySelector('[data-trash]')?.addEventListener('click',()=>{close();confirmSheet('Remove this file?',`It moves to the trash for ${docsSnap?.limits?.trashDays||30} days and any share or public link stops working. Restore it from the library's Trash.`,'Remove',async()=>{const r=await docAct(id,{action:'trash'},'Moved to the trash');if(r&&docView==='documents/'+id)location.hash=viewHref('documents');});});
 mountSheet(scrim,sh);
}
function shareSheet(id){
 const d=docById(id);if(!d)return;
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet share-sheet';
 const url=docShareUrl(d)||docAppUrl(d);
 const expires=d.share?.expiresAt?new Date(d.share.expiresAt).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'}):'';
 const note=d.visibility==='private'?'This address opens the file in Pocket Code after signing in. Choose Anyone with the link or Public to give it to someone else.':d.visibility==='link'?(expires?'Expires '+expires+'.':'No expiry.')+' A new link stops the old one working.':'A fixed address by file name. Anyone who has it can open the file.';
 sh.innerHTML=`<h2>Share</h2><p class="sheet-name">${esc(d.title)}</p>
  <div role="radiogroup" aria-label="Who can open it">
  <button class="opt ${d.visibility==='private'?'sel':''}" role="radio" aria-checked="${d.visibility==='private'}" data-v="private"><span class="dot"></span><span>Private<span class="sub">Only after signing in to Pocket Code</span></span></button>
  <button class="opt ${d.visibility==='link'?'sel':''}" role="radio" aria-checked="${d.visibility==='link'}" data-v="link"><span class="dot"></span><span>Anyone with the link<span class="sub">An unguessable address; you can set an expiry or make a new link</span></span></button>
  <button class="opt ${d.visibility==='public'?'sel':''}" role="radio" aria-checked="${d.visibility==='public'}" data-v="public"><span class="dot"></span><span>Public<span class="sub">At a fixed address by file name, for anyone</span></span></button>
  </div>
  <div class="share-url"><input readonly value="${esc(url)}" aria-label="${d.visibility==='private'?'Address in Pocket Code':'Share URL'}" id="share-url"><button class="chip" data-copy-share>${IC.copy}Copy</button></div>
  ${d.visibility==='link'?`<div class="share-controls"><label class="voice-field">Expires<select id="share-expiry"><option value="">Never</option><option value="7">In 7 days</option><option value="30">In 30 days</option></select></label><button class="chip" data-reshare>${IC.link}New link</button></div>`:''}
  <p class="sheet-help share-note">${esc(note)}</p>`;
 const close=()=>closeCurrentSheet?.();
 bindRadioGroup(sh.querySelector('[role="radiogroup"]'));
 sh.querySelectorAll('[data-v]').forEach(b=>b.onclick=async()=>{if(b.dataset.v===d.visibility)return;close();const r=await docAct(id,{visibility:b.dataset.v},b.dataset.v==='private'?'Private now; links no longer work':b.dataset.v==='link'?'Link made':'Public now');if(r&&r.visibility!=='private')shareSheet(id);});
 const input=sh.querySelector('#share-url');input.onfocus=()=>input.select();
 sh.querySelector('[data-copy-share]').onclick=e=>copyLink(url,e.currentTarget);
 const expiry=sh.querySelector('#share-expiry');if(expiry){expiry.value=d.share?.expiresAt?(Math.abs(Date.parse(d.share.expiresAt)-Date.now()-7*86400000)<86400000?'7':'30'):'';expiry.onchange=async()=>{close();await docAct(id,{expiresAt:expiry.value?new Date(Date.now()+Number(expiry.value)*86400000).toISOString():null},'Expiry set');shareSheet(id);};}
 sh.querySelector('[data-reshare]')?.addEventListener('click',async()=>{close();await docAct(id,{action:'reshare'},'New link made; the old one no longer works');shareSheet(id);});
 mountSheet(scrim,sh);
}
function docProjectSheet(id){
 const d=docById(id);if(!d||typeof boardSnap==='undefined')return;
 const go=()=>{const rows=[['','No project','Keep it unattached'],...boardSnap.projects.filter(p=>p.status!=='done').map(p=>[p.id,p.name,p.next||p.summary||''])];
  if(d.project)rows.splice(1,0,['__open','Open the project '+(projectById(d.project)?.name||d.project),'']);
  sheet('Project for this file',rows,d.project||'',v=>{if(v==='__open')return void(location.hash=viewHref('projects/'+d.project));if(v===(d.project||''))return;docAct(id,{project:v},v?'Added to '+(projectById(v)?.name||v):'Removed from the project');});};
 if(boardSnap)go();else loadBoard().then(go).catch(()=>toast('Projects could not load.'));
}
/* ---------- from a session: Keep as document ---------- */
async function keepResult(sessionId,target,button){
 if(button)button.disabled=true;
 try{
  const project=typeof boardSnap!=='undefined'&&boardSnap?boardSnap.projects.find(p=>p.status!=='done'&&p.sessions.includes(sessionId))?.id||'':'';
  const d=await api('/documents/keep',{method:'POST',body:JSON.stringify({session:sessionId,path:target,project})});
  mergeDoc(d);toast('Kept in Files: '+d.title);
  if(button){button.textContent='Kept · Open';button.disabled=false;delete button.dataset.keep;button.dataset.kept=d.id;button.onclick=()=>{closeCurrentSheet?.();location.hash=viewHref('documents/'+d.id);};}
 }catch(e){toast(e.message||'Could not keep the file');if(button)button.disabled=false;}
}
const keepableResult=r=>r.kind==='file'&&/\.(html?|pdf|md|txt|png|jpe?g|gif|webp|csv|tsv|json|docx|xlsx|pptx|mp4)$/i.test(r.target);
/* ---------- project card section, rail, home ---------- */
function projectDocumentsHTML(projectId){
 if(!documentsOn())return '';
 const rows=docsSnap?docsSnap.documents.filter(d=>d.project===projectId):null;
 return `<section class="project-documents"><h2>Files <span>${rows?rows.length||'':''}</span></h2>
  ${!rows?'<p class="project-empty">Loading…</p>':rows.length?rows.slice(0,8).map(d=>`<div class="session-item linked-session document-item" data-item="${esc(d.id)}"><a class="row" href="${viewHref('documents/'+d.id)}" data-document="${esc(d.id)}"><span class="body"><span class="title"><span class="doc-kind">${KIND_WORD[d.kind]||'FILE'}</span>${esc(d.title)}</span><span class="meta">${esc(rel(Date.parse(d.added)))} · ${visWord[d.visibility]}</span></span></a><button class="session-more icon" data-document-more="${esc(d.id)}" aria-label="Options for ${esc(d.title)}">${IC.more}</button></div>`).join('')+(rows.length>8?`<a class="rail-done-link" href="${viewHref('documents')}" data-project-docs="${esc(projectId)}">All ${rows.length} files</a>`:'')
  :'<p class="project-empty">No files yet. Keep one from a session\'s Results, or an agent keeps one with <code>pocket-docs add --project '+esc(projectId)+'</code>.</p>'}</section>`;
}
function bindProjectDocuments(main,projectId){
 if(!documentsOn())return;
 bindDocRows(main.querySelector('.project-documents')||main);
 main.querySelectorAll('[data-project-docs]').forEach(a=>a.onclick=()=>{docFilterProject=a.dataset.projectDocs;});
 if(!docsSnap)loadDocs().then(()=>{if(typeof paintProjectsView==='function')paintProjectsView();}).catch(()=>{});
}
function railDocumentsHTML(){
 if(!docsSnap)return '<p class="sheet-help">Loading files…</p>';
 const q=railDocQuery.trim().toLowerCase();
 const rows=(q?docsSnap.documents.filter(d=>docSearchText(d).includes(q)):docsSnap.documents).slice(0,q?40:20);
 return `<div class="rail-projects rail-documents"><div class="rail-project-actions"><a class="chip" href="${viewHref('documents')}" data-view-link>All files</a><button class="chip" id="rail-doc-upload">${IC.up}Upload</button><input type="file" id="rail-doc-file" multiple hidden></div>
  <div class="session-search rail-doc-search">${IC.search}<input type="search" id="rail-doc-query" placeholder="Search files" aria-label="Search files" value="${esc(railDocQuery)}" autocomplete="off"></div>
  <div id="rail-doc-list">${railDocListHTML(rows,q)}</div></div>`;
}
const railDocListHTML=(rows,q)=>rows.length?rows.map(docRowHTML).join(''):`<p class="sheet-help">${q?'No files match.':'No files yet.'}</p>`;
function paintRailDocuments(){
 const el=document.getElementById('rail');if(!el||railView()!=='documents')return;
 const typing=document.activeElement?.id==='rail-doc-query';
 if(typing){const list=el.querySelector('#rail-doc-list');if(list){const q=railDocQuery.trim().toLowerCase();list.innerHTML=railDocListHTML((q?docsSnap.documents.filter(d=>docSearchText(d).includes(q)):docsSnap.documents).slice(0,q?40:20),q);bindDocRows(list);}return;}
 el.innerHTML=railDocumentsHTML();
 el.querySelector('#rail-doc-upload')?.addEventListener('click',()=>el.querySelector('#rail-doc-file').click());
 el.querySelector('#rail-doc-file')?.addEventListener('change',e=>uploadDocuments([...e.target.files]).then(paintRailDocuments));
 el.querySelector('#rail-doc-query')?.addEventListener('input',e=>{railDocQuery=e.target.value;clearTimeout(docPaintT);docPaintT=setTimeout(paintRailDocuments,120);});
 bindDocRows(el);
 if(!docsSnap)loadDocs().then(paintRailDocuments).catch(()=>{const r=document.getElementById('rail');if(r&&railView()==='documents')r.innerHTML='<p class="sheet-help">Documents could not load.</p>';});
}
matchMedia('(min-width: 700px)').addEventListener('change',()=>{if(docView==='documents')paintDocumentsView();}); // a window dragged across the grid's width repaints
setInterval(()=>{if(!documentsOn()||document.visibilityState!=='visible'||!(docView||railView()==='documents'))return;loadDocs(true).then(()=>{paintDocumentsView();paintRailDocuments();}).catch(()=>{});},30000);
