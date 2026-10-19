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
 const prefs=getPrefs(key),provider=key.startsWith('cx:')?'codex':key===NEW_KEY?tb?.provider:'claude';
 const choices=[['review','Review actions',provider==='codex'?'Use a read-only sandbox and review native permission requests. Safe reads and previously allowed tools can run without asking.':'Ask before commands, file edits, delegated tasks and external tools. Ordinary file reads can run without asking.']];
 if(approvalPolicy.allowFullAccess)choices.push(['full','Full access','Run tools without routine permission prompts, using this server’s account access.']);
 sheet('Permissions for the next turn',choices,nextApprovalMode(prefs),mode=>{prefs.approvalMode=mode;prefs.approvalModeSource='user';setPrefs(key,prefs);if(tb?.key===key){tb.prefs=prefs;renderToolbar();}});
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
  b.textContent=d.interrupted?'Approval connection interrupted · Review':d.requests.some(r=>r.status==='uncertain')?'Approval delivery uncertain · Review':d.requests.length===1?'Waiting for your OK · Review':d.requests.length+' requests waiting for your OK · Review';
  const label=$('#work-label');if(label)label.textContent=!b.hidden?'Waiting for your OK':'Working';
 }catch{if(chatId===id&&$('#approvals-open')){$('#approvals-open').hidden=false;$('#approvals-open').textContent='Approval status unavailable · Retry';}}
}
async function openApprovals(id){
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet approvals-sheet';
 sh.innerHTML='<h2>Waiting for your OK</h2><p class="sheet-help">Check what it wants to do, then allow it or not.</p><button class="chip" data-refresh-approvals>Refresh</button><div data-approval-list role="status">Loading…</div>';
 mountSheet(scrim,sh);
 const load=async()=>{
  const list=sh.querySelector('[data-approval-list]');
  try{
   const d=await api('/session/'+encodeURIComponent(id)+'/approvals');if(!sh.isConnected)return;
   if(d.interrupted){
    list.innerHTML='<p class="sheet-help">The server restarted and lost the permission connection to this turn. Old approvals cannot be replayed. Stop the turn, review what finished, then send a new instruction.</p><button class="chip" data-stop-approval>Stop interrupted turn</button>';
    list.querySelector('[data-stop-approval]').onclick=async e=>{e.target.disabled=true;try{await api('/session/'+encodeURIComponent(id)+'/stop',{method:'POST',body:'{}'});closeCurrentSheet?.();toast('Stop requested. Review the conversation before resuming.');}catch(err){toast(err.message);e.target.disabled=false;}};return;
   }
   if(!d.requests.length){list.textContent='No actions are waiting for approval.';return;}
   list.replaceChildren();
   for(const r of d.requests){
    const card=document.createElement('section');card.className='approval-card';
    const scope=r.kind==='permissions'?'This grants the listed access for the rest of this turn. Later actions within that access may run without another prompt.':r.kind==='network'?'This can release multiple pending requests to the displayed network destination.':'Allow applies to this request only.';
    const unavailable=r.status!=='pending',plain=approvalPlain(r);
    // 1.59: the request as a plain question, the whole command or path it acts on, then the full request behind
    // Show details. Broad grants (permissions, network) keep their scope line in view; a request Pocket can't
    // summarise shows its details open.
    card.innerHTML=`<h3>${esc(plain.title)}</h3>${plain.where?.text?`<p class="approval-where">${esc(plain.where.text)}</p>`:''}${plain.where?.mono?`<pre class="approval-what" tabindex="0" aria-label="What it runs or changes">${esc(plain.where.mono)}</pre>`:''}${r.kind==='permissions'||r.kind==='network'?`<p class="sheet-help">${esc(scope)}</p>`:''}<details class="approval-more"${plain.where?'':' open'}><summary>Show details</summary>${r.kind==='permissions'||r.kind==='network'?'':`<p class="sheet-help">${esc(scope)}</p>`}<pre tabindex="0" aria-label="Full action details">${esc(r.details)}</pre></details>${!r.canAllow?'<p class="approval-error">A complete, supported action preview is unavailable. Deny this request and ask for a different action.</p>':''}<p class="approval-outcome" role="status">${unavailable?'Decision sent or uncertain. Refresh and review the conversation before continuing.':''}</p><div class="approval-actions"><button class="chip" data-decision="deny" ${unavailable?'disabled':''}>Don’t allow</button><button class="chip approval-allow" data-decision="allow" ${unavailable||!r.canAllow?'disabled':''}>${r.kind==='permissions'?'Allow for this turn':r.kind==='network'?'Allow network access':'Allow'}</button></div>`;
    card.querySelectorAll('[data-decision]').forEach(button=>button.onclick=async()=>{
     const outcome=card.querySelector('.approval-outcome'),decision=button.dataset.decision;
     card.querySelectorAll('button').forEach(b=>b.disabled=true);outcome.textContent='Sending decision…';
     try{await api('/session/'+encodeURIComponent(id)+'/approvals/'+encodeURIComponent(r.id)+'/decision',{method:'POST',body:JSON.stringify({decision})});outcome.textContent=decision==='allow'?'Allow decision sent. Check the conversation for the result.':'Denied. The agent may continue with another approach.';refreshApprovals(id);refreshSessions();}
     catch(e){outcome.textContent=e.message+' Use Refresh to check the current request.';}
    });
    list.append(card);
   }
  }catch(e){if(sh.isConnected)list.textContent=e.message+' Use Refresh to try again.';}
 };
 sh.querySelector('[data-refresh-approvals]').onclick=load;await load();
}
