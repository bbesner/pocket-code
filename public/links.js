/* Links (1.54): a link clicked in a conversation opens the way files do (Settings → Open files and links): as a
   tab, beside the conversation in a split pane, or in a new browser window. A Pocket address (#/documents/…,
   #/projects/…, a session) opens that view; a share or public link to one of your own files opens the file; a
   download stays a download; anything else shows in a link view (#/link/<address>) that frames the page. The
   page's own policy decides whether it will show inside another app; when it will not (GitHub, Google Drive,
   most sign-in pages), the view says so and offers the browser. On a phone an outside site opens in the browser,
   where it can be used; a file from this Pocket still opens in the app. */
let linkView=null;
const linkLabels=new Map(); // address → the text it was clicked by, for the tab title (this window only)
const LINK_ID_RE=/^link\/([A-Za-z0-9%._~!*'()-]{1,2000})$/;
const linkViewId=url=>'link/'+encodeURIComponent(url);
const linkSameOrigin=u=>u.origin===location.origin;
const linkImageUrl=u=>/\.(png|jpe?g|gif|webp)$/i.test(u.searchParams.get('path')||u.pathname);
function linkViewUrl(id){
 const m=LINK_ID_RE.exec(id||'');if(!m)return null;
 let u;try{u=new URL(decodeURIComponent(m[1]),location.origin);}catch{return null;}
 return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u:null;
}
function linkViewTitle(id){
 const u=linkViewUrl(id);if(!u)return 'Link';
 const label=linkLabels.get(u.href);if(label)return label;
 if(linkSameOrigin(u)){const p=u.searchParams.get('path')||'';let name='';try{name=decodeURIComponent((p||u.pathname).split('/').filter(Boolean).pop()||'');}catch{}return name||u.hostname;}
 return u.hostname.replace(/^www\./,'');
}
// The Pocket view a same-origin address names (#/documents/x, #/projects/x, #/tasks, #/vault, #/chat/<id>), else null.
function pocketViewOf(u){
 if(!linkSameOrigin(u)||!['/','/index.html'].includes(u.pathname))return null;
 const h=u.hash||'';
 if(h.startsWith('#/chat/')){let id='';try{id=decodeURIComponent(h.slice(7));}catch{}return /^(cx:)?[0-9a-f-]{36}$/.test(id)?id:null;}
 const id=h.slice(2);return isViewId(id)&&!id.startsWith('link/')?id:null;
}
// Open a session or view id the way the setting says. Unlike openViewPreferred, "tab" is done here too: the
// clicked link's own address (an absolute URL with target=_blank) is not the view's route.
function openIdPreferred(id,prefKey){
 const pref=readLocal(prefKey,'tab'),here=id===chatId||id===currentView();
 if(pref==='window')return openInWindow(id);
 if(pref==='beside'&&!here){
  if(PANE&&typeof paneSay==='function')return paneSay('beside',{id});
  if(!SOLO&&isWide()&&typeof openBeside==='function')return openBeside(id);
 }
 if(!here)location.hash=tabHref(id);
}
// Any other address: a link view in a tab, a pane or (the setting's "window") the browser's own new tab.
function openAddressPreferred(u,label){
 const pref=readLocal('pc-documents-open','tab');
 if(pref==='window')return false;                                   // the link's own target already opens the browser's window
 if(!PANE&&!isWide()&&!linkSameOrigin(u))return false;               // a phone: an outside site opens in the browser, where it can be used
 const id=linkViewId(u.href);if(!LINK_ID_RE.test(id))return false;   // too long an address to be a view
 if(label)linkLabels.set(u.href,label);
 if(pref==='beside'&&id!==currentView()){
  if(PANE&&typeof paneSay==='function'){paneSay('beside',{id});return true;}
  if(!SOLO&&isWide()&&typeof openBeside==='function'){openBeside(id);return true;}
 }
 if(id!==currentView())location.hash=tabHref(id);
 return true;
}
// A share or public link of one of your own files is that file.
async function resolveSharedLink(u){
 try{const s=await loadDocs();return (s?.documents||[]).find(d=>(d.url&&d.url===u.pathname)||(d.share?.url&&d.share.url===u.pathname))?.id||null;}catch{return null;}
}
// A plain click on a link in a conversation. Returns true when the click was handled here.
function openLinkPreferred(a,e){
 if(!plainClick(e))return false;
 let u;try{u=new URL(a.href,location.href);}catch{return false;}
 if(!['http:','https:'].includes(u.protocol))return false;
 const label=(a.textContent||'').trim().replace(/\s+/g,' ').slice(0,80);
 const viewId=pocketViewOf(u);
 if(viewId){e.preventDefault();openIdPreferred(viewId,viewId.startsWith('projects')?'pc-projects-open':'pc-documents-open');return true;}
 if(linkSameOrigin(u)){
  if(/^\/api\/session\/[^/]+\/artifact$/.test(u.pathname)||u.searchParams.get('download')==='1')return false; // a download stays a download
  if(/^\/(share|files)\/[^/]+$/.test(u.pathname)&&typeof documentsOn==='function'&&documentsOn()){
   if(readLocal('pc-documents-open','tab')==='window')return false;
   e.preventDefault();
   resolveSharedLink(u).then(id=>{if(id)openIdPreferred('documents/'+id,'pc-documents-open');else openAddressPreferred(u,label);});
   return true;
  }
 }
 if(!openAddressPreferred(u,label))return false;
 e.preventDefault();return true;
}
document.addEventListener('click',e=>{
 const a=e.target.closest?.('#msgs a[href], .result-row > a[href]');
 if(!a||e.defaultPrevented||a.closest('.choices, .away-card'))return;
 openLinkPreferred(a,e);
});

/* ---------- the view ---------- */
const linkToolsHTML=u=>`<div class="doc-tools"><a class="chip" href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">${IC.globe}Open in browser</a><button class="chip" data-copy-link>${IC.link}Copy link</button></div>`;
function linkBodyHTML(u,title){
 const same=linkSameOrigin(u);
 if(same&&linkImageUrl(u))return `<div class="doc-media-wrap"><img class="doc-media" src="${esc(u.href)}" alt="${esc(title)}"></div>`;
 // A file from this Pocket is framed with the file viewer's sandbox; another site is its own origin, isolated from the app.
 return `<iframe class="doc-frame link-frame" src="${esc(u.href)}" title="${esc(title)}" referrerpolicy="no-referrer"${same?' sandbox="allow-scripts allow-popups allow-downloads allow-forms"':''}></iframe>`;
}
const linkNoticeHTML=u=>`<div class="doc-note link-notice" role="status"><p><strong>${esc(u.hostname.replace(/^www\./,''))}</strong> does not let its pages show inside another app.</p><p>Open it in your browser instead. The address stays here.</p><p><a class="chip" href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">${IC.globe}Open in browser</a></p></div>`;
// The page's own policy (X-Frame-Options, frame-ancestors) cannot be read from the browser; the daemon checks it.
async function checkLinkFrameable(u,main){
 let r;try{r=await api('/link/frameable?url='+encodeURIComponent(u.href),{signal:AbortSignal.timeout(8000)});}catch{return;}
 if(!main.isConnected||r?.frameable!==false)return;
 const frame=main.querySelector('.link-frame');if(!frame)return;
 const tpl=document.createElement('template');tpl.innerHTML=linkNoticeHTML(u);frame.replaceWith(tpl.content);
}
async function renderLink(view){
 Voice.onLeave?.();
 linkView=view;
 const u=linkViewUrl(view),title=linkViewTitle(view);
 const col=`<header class="bar">
   ${PANE?`<button class="icon" id="pane-main" aria-label="Make this the main view">${IC.swap}</button>`:SOLO?'':`<button class="icon" id="back" aria-label="Back">${IC.back}</button><button class="icon desk" id="railtog" aria-label="Show or hide the session list">${IC.panel}</button>`}
   <h1><span class="one" id="ltitle">${esc(title)}</span><span class="tag" id="ltag">${esc(u?u.hostname.replace(/^www\./,''):'Link')}</span></h1>
   ${SOLO?'':`<button class="icon" id="lwin" aria-label="Open in a new window" title="Open in a new window">${IC.external}</button>`}
   ${PANE||SOLO?'':`<button class="icon desk" id="splitb" aria-label="Split view">${IC.columns}</button>`}
   ${PANE?`<button class="icon" id="pane-close" aria-label="Close this pane">${IC.x}</button>`:''}
  </header>
  <main class="scroll documents-view link-view" id="link-main" data-kind="doc" tabindex="-1"></main>`;
 app.innerHTML=withShell(col);
 wireShell();
 if(PANE){$('#pane-main').onclick=()=>paneSay('main',{view});$('#pane-close').onclick=()=>paneSay('close');}
 else if(!SOLO){bindViewBack($('#back'),view);$('#splitb').onclick=chooseBeside;}
 $('#lwin')?.addEventListener('click',()=>openInWindow(view));
 const tog=$('#railtog');if(tog)tog.onclick=()=>{localStorage.setItem('pc-rail',railOpen()?'closed':'open');route();};
 if(typeof refreshSessions==='function')refreshSessions().catch(()=>{}); // the rail's session list
 const main=$('#link-main');
 if(!u){main.innerHTML='<p class="sheet-help doc-note">That link cannot be opened here.</p>';return;}
 main.innerHTML=linkToolsHTML(u)+linkBodyHTML(u,title);
 main.querySelector('[data-copy-link]').onclick=e=>copyLink(u.href,e.currentTarget);
 if(PANE)paneSay('route',{id:view,title});else if(SOLO)document.title=title+' · Pocket Code';else rememberOpenView(view,title);
 if(!linkSameOrigin(u))checkLinkFrameable(u,main);
}
