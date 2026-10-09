/* Split view (desktop): more sessions beside the main conversation, like editor groups.
   Each pane is a full Pocket Code instance in a same-origin frame (?pane=1), so it keeps
   its own stream, composer, draft and sheets. Panes never move in the DOM once created:
   moving a frame reloads it. */
const SPLIT_MIN=380,SPLIT_MAX_PANES=3,SPLIT_GRIP=5;
let splitRailObserver=null,observedSplitRail=null;
// id null = the pane is on its New session screen until that session starts
const validPane=p=>p&&typeof p.key==='string'&&/^[0-9a-f-]{36}$/.test(p.key)&&(p.id===null||typeof p.id==='string'&&(/^(cx:)?[0-9a-f-]{36}$/.test(p.id)||isViewId(p.id))); // 1.29: a pane may show a project view
let splitPanes=PANE?[]:readLocal('pc-split-panes',[]);
splitPanes=Array.isArray(splitPanes)?splitPanes.filter(validPane).slice(0,SPLIT_MAX_PANES).map(p=>({key:p.key,id:p.id,w:Number.isFinite(p.w)?p.w:null})):[];
const saveSplit=()=>writeLocal('pc-split-panes',splitPanes);
const paneSrc=(key,id)=>'/?pane='+key+(id?tabHref(id):'#/new');
const sessionTitle=id=>!id?'New session':isViewId(id)?(typeof viewTitle==='function'?viewTitle(id):'Projects'):allSessions.find(s=>s.id===id)?.title||openSessions.find(s=>s.id===id)?.title||'Session';
const railSpace=()=>{const rail=document.querySelector('aside.rail');if(!rail)return 0;const grip=document.getElementById('grip');return Math.round(rail.getBoundingClientRect().width+(grip?.getBoundingClientRect().width||0));};
const dockSpace=()=>Math.round(document.querySelector('.workspace-dock')?.getBoundingClientRect().width||0);
function splitHasRoom(){return innerWidth>=900 && innerWidth-railSpace()-dockSpace()>=(splitPanes.length+2)*SPLIT_MIN+(splitPanes.length+1)*SPLIT_GRIP;}
function paintSplit(){
 const host=document.getElementById('panes');if(!host)return;host.setAttribute('role','region');host.setAttribute('aria-label','Side conversations');
 for(const section of [...host.querySelectorAll('.split-pane')])if(!splitPanes.some(p=>p.key===section.dataset.key)){section.previousElementSibling?.remove();section.remove();}
 for(const p of splitPanes){
  let section=host.querySelector(`.split-pane[data-key="${CSS.escape(p.key)}"]`);
  if(!section){
   const grip=document.createElement('div');
   grip.className='pane-grip';grip.setAttribute('role','separator');grip.setAttribute('aria-orientation','vertical');grip.tabIndex=0;
   grip.setAttribute('aria-label','Resize pane');grip.dataset.tip='Drag to resize. Double-click to share space equally.';
   section=document.createElement('section');section.className='split-pane';section.dataset.key=p.key;section.id='pane-'+p.key;
   grip.setAttribute('aria-controls',section.id);grip.setAttribute('aria-valuemin',String(SPLIT_MIN));grip.setAttribute('aria-valuenow',String(SPLIT_MIN));grip.setAttribute('aria-valuemax',String(SPLIT_MIN));
   const frame=document.createElement('iframe');frame.src=paneSrc(p.key,p.id);
   section.append(frame);host.append(grip,section);bindPaneGrip(grip,section);
  }
  section.querySelector('iframe').title='Session beside: '+sessionTitle(p.id);
  section.style.flex=p.w?`0 1 ${p.w}px`:'';
 }
 host.hidden=!splitPanes.length;
 document.body.classList.toggle('has-panes',splitPanes.length>0);
 sizeMainForSplit();
}
// The main column holds the rail too; give its conversation the same share as a pane.
function sizeMainForSplit(){
 if(PANE)return;
 const app=document.getElementById('app'),host=document.getElementById('panes');if(!app||!host)return;
 const rail=railSpace(),reserved=rail+dockSpace(),available=innerWidth-reserved;
 const count=innerWidth<900?0:Math.max(0,Math.min(splitPanes.length,Math.floor((available-SPLIT_MIN)/(SPLIT_MIN+SPLIT_GRIP))));
 const sections=[...host.querySelectorAll('.split-pane')];
 sections.forEach((section,i)=>{
  // Hide in place: moving or recreating an iframe would lose its input and stream.
  const hide=i>=count;
  if(hide&&section.contains(document.activeElement))document.querySelector('#splitb,#box,#first')?.focus({preventScroll:true});
  section.hidden=hide;section.previousElementSibling.hidden=hide;
 });
 host.hidden=count===0;
 app.style.flexBasis=count?reserved+'px':'';
 app.style.minWidth=count?reserved+SPLIT_MIN+'px':'';
 const max=Math.max(SPLIT_MIN,available-count*SPLIT_GRIP-count*SPLIT_MIN);
 for(const section of sections.slice(0,count)){
  const pane=splitPanes.find(p=>p.key===section.dataset.key);
  section.style.flex=pane?.w?`0 1 ${Math.min(max,Math.max(SPLIT_MIN,pane.w))}px`:'';
 }
 // Layout has settled synchronously after the styles above; expose actual sizes, not saved preferences.
 for(const section of sections.slice(0,count)){
  const grip=section.previousElementSibling;
  grip.setAttribute('aria-valuemin',String(SPLIT_MIN));grip.setAttribute('aria-valuemax',String(max));
  grip.setAttribute('aria-valuenow',String(Math.round(section.getBoundingClientRect().width)));
 }
 const hidden=splitPanes.length-count;
 let notice=document.getElementById('split-notice');
 if(!notice&&hidden&&innerWidth>=900&&document.querySelector('.chatcol')){
  notice=document.createElement('p');notice.id='split-notice';notice.className='split-notice';notice.setAttribute('role','status');
  document.querySelector('.chatcol > header').after(notice);
 }
 if(notice){notice.hidden=!hidden||innerWidth<900;notice.textContent=hidden?`${hidden} ${hidden===1?'pane is':'panes are'} hidden at this width. Widen the window or hide the session list to restore split view.`:'';}
 const railElement=document.querySelector('aside.rail');
 if(railElement!==observedSplitRail){
  splitRailObserver?.disconnect();observedSplitRail=railElement;
  if(railElement){splitRailObserver=new ResizeObserver(sizeMainForSplit);splitRailObserver.observe(railElement);}
 }
}
function bindPaneGrip(grip,section){
 const setWidth=w=>{
  const p=splitPanes.find(x=>x.key===section.dataset.key);if(!p)return;
  const count=document.querySelectorAll('#panes .split-pane:not([hidden])').length;
  const max=innerWidth-railSpace()-dockSpace()-count*SPLIT_GRIP-count*SPLIT_MIN;
  p.w=Math.round(Math.max(SPLIT_MIN,Math.min(max,w)));section.style.flex=`0 1 ${p.w}px`;
  saveSplit();sizeMainForSplit();
 };
 grip.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();setWidth(section.getBoundingClientRect().width+(e.key==='ArrowLeft'?40:-40));};
 grip.ondblclick=()=>{const p=splitPanes.find(x=>x.key===section.dataset.key);if(p){p.w=null;saveSplit();paintSplit();}};
 grip.onpointerdown=e=>{
  grip.setPointerCapture(e.pointerId);document.body.classList.add('pane-resizing');
  const right=section.getBoundingClientRect().right;
  grip.onpointermove=ev=>setWidth(right-ev.clientX);
  grip.onpointerup=grip.onpointercancel=()=>{grip.onpointermove=grip.onpointerup=grip.onpointercancel=null;document.body.classList.remove('pane-resizing');};
 };
}
function openBeside(id){
 if(PANE)return;
 if(id&&id===chatId)return toast('That session is already the main conversation.');
 if(splitPanes.some(p=>p.id===id))return toast(id?'That session is already open beside.':'A new session is already waiting beside. Start it or close it first.');
 if(splitPanes.length>=SPLIT_MAX_PANES)return toast('Split view holds up to four sessions. Close a pane first.');
 if(!splitHasRoom())return toast('Not enough room for another pane. Hide the session list, close a pane or widen the window.');
 // a new group shares the width equally, like an editor split
 for(const p of splitPanes)p.w=null;
 splitPanes.push({key:crypto.randomUUID(),id,w:null});saveSplit();paintSplit();
}
function closePane(key){
 splitPanes=splitPanes.filter(p=>p.key!==key);saveSplit();paintSplit();
 // the pane's own New-session draft, attachments, choices and retry state go with it
 for(const k of ['pc-draft-','pc-attachments-','pc-prefs-','pc-outbox-'])try{localStorage.removeItem(k+'new-pane-'+key);}catch{}
}
// Close the MAIN conversation (never available inside a pane — panes use pane-close).
// Closing never deletes or hides the session; it only asks the server to end its live
// process, then either promotes the first beside pane into main or goes to New session.
async function closeMainPane(){
 if(PANE||!chatId)return;
 const id=chatId;
 const afterRelease=()=>{
  if(splitPanes.length){
   const p=splitPanes[0];
   splitPanes=splitPanes.filter(x=>x.key!==p.key);saveSplit();
   // a New-session pane becoming main brings its draft, attachments, choices and retry state
   if(!p.id)for(const k of ['pc-draft-','pc-attachments-','pc-prefs-','pc-outbox-'])try{const v=localStorage.getItem(k+'new-pane-'+p.key);if(v!=null)localStorage.setItem(k+'new',v);localStorage.removeItem(k+'new-pane-'+p.key);}catch{}
   location.hash=p.id?'#/chat/'+p.id:'#/new';
   paintSplit();
  }else location.hash='#/new';
 };
 try{
  await api(`/session/${id}/release`,{method:'POST',body:JSON.stringify({stop:false})});
  afterRelease();
 }catch(e){
  if(e.status!==409)return toast('Could not close: '+(e.message||'error'));
  sheet('A turn is still running',[
   ['keep','Keep it running in the background','Closes this view only; the turn keeps going on the server'],
   ['stop','Stop the turn','Ends it now, then closes this view'],
  ],null,async v=>{
   if(v==='stop'){
    try{await api(`/session/${id}/release`,{method:'POST',body:JSON.stringify({stop:true})});}
    catch(err){toast('Could not stop: '+(err.message||'error'));return;}
   }
   afterRelease();
  });
 }
}
function chooseBeside(){
 const taken=new Set([chatId,...splitPanes.map(p=>p.id)]);
 const seen=new Set(),rows=[];
 for(const s of [...openSessions.slice().reverse(),...allSessions.filter(s=>!isHiddenSession(s))]){
  if(taken.has(s.id)||seen.has(s.id)||isViewId(s.id))continue;seen.add(s.id); // project views are offered separately below
  const full=allSessions.find(r=>r.id===s.id)||s;
  rows.push([s.id,full.title||s.title,[projName(full.cwd),full.provider==='codex'?'Codex':full.provider==='claude'?'Claude':'',full.state?.label].filter(Boolean).join(' · ')]);
  if(rows.length>=12)break;
 }
 rows.unshift(['new','New session','Start a conversation in the new pane']);
 if(typeof projectsOn==='function'&&projectsOn()){ // 1.29: project views open beside like sessions
  const shown=new Set([currentView(),...splitPanes.map(p=>p.id)]);
  const views=[['projects','Projects','All tracked projects'],['projects/scheduled','Scheduled','Reminders, due first'],...((typeof boardSnap!=='undefined'&&boardSnap)?boardSnap.projects.filter(p=>p.status!=='done').slice(0,6).map(p=>['projects/'+p.id,p.name,p.next||p.summary||'Project']):[])].filter(r=>!shown.has(r[0]));
  rows.splice(1,0,...views);
 }
 if(typeof documentsOn==='function'&&documentsOn()&&![currentView(),...splitPanes.map(p=>p.id)].includes('documents'))rows.splice(1,0,['documents','Documents','The library of files from the work']);
 sheet('Open beside this conversation',rows,null,v=>openBeside(v==='new'?null:v));
}
if(PANE){
 document.documentElement.classList.add('in-pane');
 // Let the window around this pane track which session it shows.
 window.paneSay=(type,extra={})=>{if(parent!==window)parent.postMessage({pocketPane:type,...extra},location.origin);};
}else{
 addEventListener('message',e=>{
  if(e.origin!==location.origin||!e.data?.pocketPane)return;
  const frame=[...document.querySelectorAll('#panes iframe')].find(f=>f.contentWindow===e.source);
  const section=frame?.closest('.split-pane'),p=section&&splitPanes.find(x=>x.key===section.dataset.key);if(!p)return;
  const {pocketPane:type,id,title}=e.data;
  if(type==='route'&&typeof id==='string'&&validPane({key:p.key,id})){p.id=id;saveSplit();frame.title='Session beside: '+(typeof title==='string'?title:sessionTitle(id));}
  if(type==='close')closePane(p.key);
  if(type==='main'&&p.id){
   const mainId=chatId||currentView();location.hash=tabHref(p.id);
   if(mainId&&mainId!==p.id){p.id=mainId;saveSplit();frame.title='Session beside: '+sessionTitle(mainId);frame.contentWindow.location.hash=tabHref(mainId);}else closePane(p.key);
  }
 });
 addEventListener('resize',()=>{clearTimeout(window.splitResizeT);window.splitResizeT=setTimeout(sizeMainForSplit,100);});
 // Tabs opened in another window or pane show up here without a reload.
 addEventListener('storage',e=>{if(e.key==='pc-open-sessions'){openSessions=readLocal('pc-open-sessions',[]).filter(s=>s&&typeof s.id==='string');paintOpenSessions();}});
 paintSplit();
}
