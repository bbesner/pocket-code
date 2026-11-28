/* Permission choices and pending native actions; never infer approval from chat text. */
let approvalPolicy={defaultMode:'review',allowFullAccess:false};
const permissionLabel=mode=>mode==='full'?'Full access':'Review actions';
async function loadApprovalPolicy(){
 try{const p=await api('/approval-policy');if(['review','full'].includes(p.defaultMode))approvalPolicy=p;}
 catch{approvalPolicy={defaultMode:'review',allowFullAccess:false};}
 adoptFullAccessDefault();
}
// Sessions recorded the old Review default when they were created. When the instance
// default becomes Full access, drop those recorded Reviews once so every session follows it;
// a Review picked after this point is kept.
function adoptFullAccessDefault(){
 if(approvalPolicy.defaultMode!=='full'||!approvalPolicy.allowFullAccess)return;
 try{
  if(localStorage.getItem('pc-full-default-adopted'))return;
  for(let i=0;i<localStorage.length;i++){
   const key=localStorage.key(i);if(!key?.startsWith('pc-prefs-'))continue;
   const p=JSON.parse(localStorage.getItem(key)||'null');
   if(p?.approvalMode==='review'&&p.approvalModeSource!=='user'){delete p.approvalMode;localStorage.setItem(key,JSON.stringify(p));}
  }
  localStorage.setItem('pc-full-default-adopted','1');
 }catch{}
}
function nextApprovalMode(prefs=tb?.prefs){
 const mode=prefs?.approvalMode||approvalPolicy.defaultMode;
 return mode==='full'&&approvalPolicy.allowFullAccess?'full':'review';
}
function chooseApprovalMode(key=tb?.key){
 if(typeof key!=='string')return;
 const prefs=getPrefs(key),provider=key===NEW_KEY?tb?.provider:(window.PocketEngines?.providerOf(key)||(key.startsWith('cx:')?'codex':'claude'));
 const choices=[['review','Review actions',provider==='antigravity'?'Ask before each command and file edit. Reading and searching files run without asking.':provider==='acp'?'Ask before each command, file edit and web fetch. Reading and searching files run without asking.':provider==='codex'?'Use a read-only sandbox and review native permission requests. Safe reads and previously allowed tools can run without asking.':'Ask before commands, file edits, delegated tasks and external tools. Ordinary file reads can run without asking.']];
 if(approvalPolicy.allowFullAccess)choices.push(['full','Full access','Run tools without routine permission prompts, using this server’s account access.']);
 sheet('Permissions for the next reply',choices,nextApprovalMode(prefs),mode=>{prefs.approvalMode=mode;prefs.approvalModeSource='user';setPrefs(key,prefs);if(tb?.key===key){tb.prefs=prefs;renderToolbar();}});
}
// 1.59: a request in plain words. Claude requests carry {tool,input}; Codex ones keep their own titles, which are
// already questions ("Run this command?"), with the command or the changed files shown under them.
function approvalPlain(r){
 let d=null;try{d=JSON.parse(r.details);}catch{}
 if(r.kind==='tool'&&d&&typeof d.tool==='string'&&window.PocketPhrase)return {title:PocketPhrase.ask(d.tool,d.input),where:PocketPhrase.where(d.tool,d.input)};
 if(r.kind==='command'&&d?.command)return {title:r.title,where:{mono:Array.isArray(d.command)?d.command.join(' '):String(d.command)}};
 if(r.kind==='fileChange'&&Array.isArray(d?.changes)&&d.changes.length){const paths=d.changes.map(c=>c?.path).filter(Boolean);if(paths.length)return {title:r.title,where:{text:paths.length===1?'1 file':paths.length+' files',mono:paths.join('\n')}};}
 return {title:r.title,where:null};
}
async function refreshApprovals(id){
 try{
  const d=await api('/session/'+encodeURIComponent(id)+'/approvals');if(chatId!==id)return;
  const b=$('#approvals-open');if(!b)return;
  b.hidden=!d.interrupted&&!d.requests.length;
  const n=d.requests.length,plain=!d.interrupted&&!d.requests.some(r=>r.status==='uncertain');
  // 1.82: one request answers from the banner: the question in plain words, the command or file it acts on, the
  // asking subagent, and Allow / Don't allow. Details opens the sheet. Several requests still go to the sheet.
  const one=n===1&&plain&&d.requests[0].status==='pending'?d.requests[0]:null;
  if(one){
   const words=approvalPlain(one),where=words.where||{};
   const note=where.mono||where.text||(one.kind==='permissions'?'Grants the listed access for the rest of this reply.':one.kind==='network'?'Can release several pending requests to the shown destination.':'');
   const actions=[{label:'Don’t allow',run:()=>decideFromBanner(id,one,'deny',b)}];
   if(one.canAllow)actions.push({label:allowLabel(one),primary:true,run:()=>decideFromBanner(id,one,'allow',b)});
   paintWaitBanner(b,{title:words.title,agent:one.agent||'',note,mono:Boolean(where.mono),cta:'Details',mark:IC.info,actions});
  } else paintWaitBanner(b,{title:d.interrupted?'Approval connection interrupted':!plain?'Approval delivery uncertain':n+' requests waiting for your OK',note:plain?'The reply is paused until you allow or deny them.':'',agent:plain&&d.requests.every(r=>r.agent)?[...new Set(d.requests.map(r=>r.agent))].join(', '):'',cta:'Review',mark:IC.info});
  const label=$('#work-label');if(label)label.textContent=!b.hidden?'Waiting for your OK':'Working';
 }catch{if(chatId===id&&$('#approvals-open')){$('#approvals-open').hidden=false;paintWaitBanner($('#approvals-open'),{title:'Approval status unavailable',cta:'Retry',mark:IC.info});}}
}
const allowLabel=r=>r.kind==='permissions'?'Allow for this reply':r.kind==='network'?'Allow network access':'Allow';
const decisionNote=decision=>decision==='allow'?'Allowed. Check the conversation for the result.':'Not allowed. The agent may try another approach.';
async function decideFromBanner(id,r,decision,banner){
 waitBannerBusy(banner,'Sending your decision…');
 try{await api('/session/'+encodeURIComponent(id)+'/approvals/'+encodeURIComponent(r.id)+'/decision',{method:'POST',body:JSON.stringify({decision})});toast(decisionNote(decision));}
 catch(e){toast(e.message);}
 refreshApprovals(id);refreshSessions();
}
async function openApprovals(id,focus=null){
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet approvals-sheet';
 sh.innerHTML='<h2>Waiting for your OK</h2><p class="sheet-help">Check what it wants to do, then allow it or not.</p><button class="chip" data-refresh-approvals>Refresh</button><div data-approval-list role="status">Loading…</div>';
 mountSheet(scrim,sh);
 const load=async()=>{
  const list=sh.querySelector('[data-approval-list]');
  // 1.126: a missed line stays through a reload (Refresh, or another card answered), and keeps focus if it had it
  const kept=list.querySelector(':scope > .approval-missed'),hadFocus=Boolean(kept)&&document.activeElement===kept;
  const keep=()=>{if(!kept)return;const c=[...list.querySelectorAll('.approval-card')].find(x=>x.dataset.approvalRequest===kept.dataset.request);if(c)c.before(kept);else list.prepend(kept);if(hadFocus)kept.focus({preventScroll:true});};
  try{
   const d=await api('/session/'+encodeURIComponent(id)+'/approvals');if(!sh.isConnected)return;
   if(d.interrupted){
    list.innerHTML='<p class="sheet-help">The server restarted and lost the permission connection to this reply. Old approvals cannot be replayed. Stop the reply, review what finished, then send a new instruction.</p><button class="chip" data-stop-approval>Stop interrupted reply</button>';
    list.querySelector('[data-stop-approval]').onclick=async e=>{e.target.disabled=true;try{await api('/session/'+encodeURIComponent(id)+'/stop',{method:'POST',body:'{}'});closeCurrentSheet?.();toast('Stop requested. Review the conversation before resuming.');}catch(err){toast(err.message);e.target.disabled=false;}};return;
   }
   if(!d.requests.length){list.textContent='No actions are waiting for approval.';keep();return;}
   list.replaceChildren();
   for(const r of d.requests){
    const card=document.createElement('section');card.className='approval-card';card.dataset.approvalRequest=r.id;
    const scope=r.kind==='permissions'?'This grants the listed access for the rest of this reply. Later actions within that access may run without another prompt.':r.kind==='network'?'This can release multiple pending requests to the displayed network destination.':'Allow applies to this request only.';
    const unavailable=r.status!=='pending',plain=approvalPlain(r);
    // 1.59: the request as a plain question, the whole command or path it acts on, then the full request behind
    // Show details. Broad grants (permissions, network) keep their scope line in view; a request Pocket can't
    // summarise shows its details open.
    card.innerHTML=`<h3>${esc(plain.title)}</h3>${r.agent?`<p class="approval-agent">From subagent: ${esc(r.agent)}</p>`:''}${plain.where?.text?`<p class="approval-where">${esc(plain.where.text)}</p>`:''}${plain.where?.mono?`<pre class="approval-what" tabindex="0" aria-label="What it runs or changes">${esc(plain.where.mono)}</pre>`:''}${r.kind==='permissions'||r.kind==='network'?`<p class="sheet-help">${esc(scope)}</p>`:''}<details class="approval-more"${plain.where?'':' open'}><summary>Show details</summary>${r.kind==='permissions'||r.kind==='network'?'':`<p class="sheet-help">${esc(scope)}</p>`}<pre tabindex="0" aria-label="Full action details">${esc(r.details)}</pre></details>${!r.canAllow?'<p class="approval-error">A complete, supported action preview is unavailable. Deny this request and ask for a different action.</p>':''}<p class="approval-outcome" role="status">${unavailable?'Decision sent or uncertain. Refresh and review the conversation before continuing.':''}</p><div class="approval-actions"><button class="chip" data-decision="deny" ${unavailable?'disabled':''}>Don’t allow</button><button class="chip approval-allow" data-decision="allow" ${unavailable||!r.canAllow?'disabled':''}>${r.kind==='permissions'?'Allow for this reply':r.kind==='network'?'Allow network access':'Allow'}</button></div>`;
    card.querySelectorAll('[data-decision]').forEach(button=>button.onclick=async()=>{
     const outcome=card.querySelector('.approval-outcome'),decision=button.dataset.decision;
     card.querySelectorAll('button').forEach(b=>b.disabled=true);outcome.textContent='Sending decision…';
     try{
      await api('/session/'+encodeURIComponent(id)+'/approvals/'+encodeURIComponent(r.id)+'/decision',{method:'POST',body:JSON.stringify({decision})});
      outcome.textContent=decision==='allow'?'Allow decision sent. Check the conversation for the result.':'Denied. The agent may continue with another approach.';
      refreshApprovals(id);refreshSessions();
      // 1.82: the sheet closes itself once nothing else is waiting; with more requests it shows what is left.
      let left=null;try{left=await api('/session/'+encodeURIComponent(id)+'/approvals');}catch{}
      if(!sh.isConnected)return;
      if(left&&!left.requests.length&&!left.interrupted){closeCurrentSheet?.();toast(decisionNote(decision));}
      else if(left)load();
     }
     catch(e){outcome.textContent=e.message+' Use Refresh to check the current request.';}
    });
    list.append(card);
   }
   keep();
  }catch(e){if(sh.isConnected){list.textContent=e.message+' Use Refresh to try again.';keep();}}
 };
 sh.querySelector('[data-refresh-approvals]').onclick=load;await load();
 if(focus&&sh.isConnected)await showApprovalFocus(sh,focus); // 1.126: once, after the first load
}

// 1.126 (notification-approvals.md, Part 3): an approval notification opens /#/chat/<session>?approval=<request> and, when an
// answer from it didn't go through, adds &missed=<why>&tap=allow|deny. route() hands the query here and drops it from the
// address (a reload doesn't repeat it). The conversation then opens its approvals with that request's card in view and,
// after a missed answer, one line above the card saying what happened, focused so a screen reader reads it out.
const APPROVAL_ID=/^[A-Za-z0-9:._-]{1,200}$/;
const APPROVAL_MISSED_LINES={
 signin:'This device was signed out of Pocket.',
 refused:'Pocket refused the answer from the address the notification used. Answer it here.',
 off:'Answering from notifications is turned off.',
 gone:'It was no longer waiting.',
 answered:'It was no longer waiting: it was answered in Pocket.',
 changed:'Pocket couldn\'t match it to what the notification showed, or a setting changed. Review it here.',
 old:'The notification was too old. Review it here.',
 uncertain:'Delivery of this decision is uncertain. Stop the reply and review the conversation; do not approve it again.',
 offline:'This device was offline.',
 error:'Pocket couldn\'t take the answer. Review it here.',
};
let approvalFocus=null;
function noteApprovalFocus(session,q){
 const request=q.get('approval')||'',missed=q.get('missed')||'';
 // an own-key lookup: ?missed=constructor (or any reason this build doesn't know) reads as Pocket couldn't take it
 approvalFocus=APPROVAL_ID.test(session)&&APPROVAL_ID.test(request)?{session,request,...(missed?{missed:Object.hasOwn(APPROVAL_MISSED_LINES,missed)?missed:'error',tap:q.get('tap')==='deny'?'deny':'allow'}:{}),at:Date.now()}:null;
}
// The 60-second rule counts from when Pocket can show the line: a sign-in on Pocket's own screen in between restarts it.
// (A sign-in that leaves the page, as Cloudflare Access's does, starts a new page, and the line is lost with it.)
function approvalFocusSignedIn(){if(approvalFocus)approvalFocus.at=Date.now();}
async function takeApprovalFocus(id){
 const f=approvalFocus;if(!f||f.session!==id)return;approvalFocus=null;
 if(Date.now()-f.at>60000)return;
 if(!f.missed){ // no answer was tried: open the card only if it still waits
  let d=null;try{d=await api('/session/'+encodeURIComponent(id)+'/approvals');}catch{return;}
  if(chatId!==id||!d.requests?.some(r=>r.id===f.request))return;
 }
 if(chatId===id)openApprovals(id,f);
}
// The answer from another device, when the record of answers away from the app has it ("allowed at 2:14 PM from Apple").
async function approvalAnsweredAway(request){
 try{
  const d=await api('/approval-push/answers'),a=(d.answers||[]).find(x=>x.requestId===request&&(x.result==='allowed'||x.result==='not_allowed'));
  if(!a)return '';
  const t=new Date(a.at),time=Number.isNaN(t.getTime())?'':' at '+t.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  return `It was no longer waiting: it was ${a.result==='allowed'?'allowed':'not allowed'}${time}${a.where&&a.where!=='unknown'?' from '+a.where:''}.`;
 }catch{return '';}
}
async function showApprovalFocus(sh,f){
 const list=sh.querySelector('[data-approval-list]');if(!list)return;
 const card=[...list.querySelectorAll('.approval-card')].find(c=>c.dataset.approvalRequest===f.request)||null;
 if(!f.missed){card?.scrollIntoView({block:'center'});return;}
 const text=(f.missed==='gone'&&await approvalAnsweredAway(f.request))||APPROVAL_MISSED_LINES[f.missed]||APPROVAL_MISSED_LINES.error;
 if(!sh.isConnected||!list.isConnected)return;
 // Read out once: focus moves to the line, and a screen reader reads what takes focus. The list it sits in is a
 // role="status" live region, which would read the new line a second time, and role="alert" a third; so the line is
 // aria-live="off" (it opts out of the list's announcement) and has no alert role. Focus also tells a sighted keyboard
 // user where it is.
 const line=document.createElement('p');line.className='approval-missed';line.tabIndex=-1;line.setAttribute('aria-live','off');line.dataset.request=f.request;
 line.textContent=`Your ${f.tap==='deny'?'Don\'t allow':'Allow'} didn't go through. ${text}`;
 if(card&&card.isConnected)card.before(line);else list.prepend(line);
 line.scrollIntoView({block:'center'});line.focus({preventScroll:true});
}
