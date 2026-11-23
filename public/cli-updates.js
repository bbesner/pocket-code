/* Updates: a quiet persistent notice, then an explicit review. CLIs upgrade from here; Pocket Code is announced only,
   because the person who runs the server installs it. Operate; existing Pocket tokens. */
let cliUpdateState=null, cliUpdatePolling=false;
const cliUpdateNotice=document.createElement('button');
cliUpdateNotice.type='button';cliUpdateNotice.className='cli-update-notice';cliUpdateNotice.hidden=true;
cliUpdateNotice.onclick=()=>openCliUpdates();
function paintCliUpdateNotice(){
  const s=cliUpdateState, available=s?.providers?.filter(p=>p.available)||[];
  const older=s?.providers?.reduce((n,p)=>n+(p.olderSessions||0),0)||0;
  const failed=s?.job&&['failed','interrupted'].includes(s.job.phase);
  let acknowledged='';try{acknowledged=localStorage.getItem('pc-cli-update-seen')||'';}catch{}
  const completed=s?.job?.phase==='complete'&&s.job.id!==acknowledged;
  const names=[...(s?.pocket?.available?['Pocket Code']:[]),...available.map(p=>p.name)];
  const listed=names.length>1?names.slice(0,-1).join(', ')+' and '+names.at(-1):names[0];
  const text=completed?'CLI upgrade complete. View results':s?.job?.running?'CLI upgrade in progress. View progress':failed?'CLI upgrade needs attention. View details':older?`${older} conversation${older===1?'':'s'} still using an older CLI. Review`:names.length?`${listed} update${names.length>1?'s':''} available. Review`:'';
  cliUpdateNotice.textContent=text;cliUpdateNotice.hidden=!text;
  if(text&&!cliUpdateNotice.isConnected&&app?.isConnected)app.prepend(cliUpdateNotice);
}
new MutationObserver(paintCliUpdateNotice).observe(app,{childList:true});
async function pollCliUpdates(){
  if(cliUpdatePolling||document.visibilityState==='hidden')return;
  cliUpdatePolling=true;
  try{const r=await fetch('/api/cli-updates',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(r.status===401){cliUpdateState=null;paintCliUpdateNotice();return;}if(r.ok){const s=await r.json();if(Array.isArray(s.providers)){cliUpdateState=s;paintCliUpdateNotice();}}}catch{}finally{cliUpdatePolling=false;}
}
setTimeout(pollCliUpdates,5000);setInterval(pollCliUpdates,60000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')pollCliUpdates();});
// 1.123: one line for a Pocket Code update this install runs on itself.
function pocketPhase(j,installed){
  const to=j.to||'the release';
  const t={queued:'Preparing the update…',checking:'Checking the Pocket Code folder…','backing-up':'Backing up Pocket’s data…',installing:`Installing ${to}…`,restarting:'Restarting Pocket. This page reconnects by itself.','rolling-back':`${to} did not start. Going back to ${j.from}…`,
    complete:installed===j.to?`Updated to ${to}.`:`Updated to ${to}. Reload Pocket to use it.`,failed:j.error||'The update did not finish.',interrupted:j.error||'The update stopped without finishing.'};
  return t[j.phase]||j.phase;
}
let pocketRestart=false;
async function openCliUpdates(){
  const scrim=document.createElement('div');scrim.className='scrim';
  const sh=document.createElement('div');sh.className='sheet cli-updates-sheet';
  sh.innerHTML='<h2>Updates</h2><p class="sheet-help" id="cli-schedule">Loading update status…</p><div id="pocket-update-row"></div><div id="cli-update-rows"></div><p id="cli-job" role="status" aria-live="polite"></p><p class="title-note">Upgrades run on the server. You can close Pocket while they finish. Current conversations keep their version until they can safely reopen.</p><p class="title-note">Pocket checks that the CLI starts and connects correctly before switching. These checks do not cover every feature.</p><div class="cli-update-actions"><button class="primary" id="cli-upgrade" disabled>Upgrade selected</button><button class="chip" id="cli-check">Check now</button><button class="chip" id="cli-later">Later</button></div><p class="title-note" id="cli-update-error" role="alert"></p>';
  mountSheet(scrim,sh);
  let state=null,selection=new Set(),signature='',busy=false,fetching=false;
  const selected=()=>state?.providers.filter(p=>selection.has(p.key)&&p.available&&p.canUpgrade)||[];
  const buttons=()=>{sh.querySelector('#cli-upgrade').disabled=busy||state?.job?.running||state?.checking||!selected().length;sh.querySelector('#cli-check').disabled=busy||state?.job?.running||state?.checking||(state?.enabled===false&&!state?.pocket?.enabled);};
  const render=s=>{
    state=s;cliUpdateState=s;if(s.job?.phase==='complete'){try{localStorage.setItem('pc-cli-update-seen',s.job.id);}catch{}}paintCliUpdateNotice();
    const stamp=s.checkedAt?new Date(s.checkedAt).toLocaleString(): 'Not checked yet';
    sh.querySelector('#cli-schedule').textContent=(s.enabled||s.pocket?.enabled?`Checks daily at 4:00 a.m. (${s.timeZone}).`:'Update checks are disabled on this server.')+(s.enabled?' CLIs install only when you choose Upgrade.':' CLI update checks are disabled on this server.')+' Last check: '+stamp+'.';
    const pk=s.pocket,self=pk?.self,pj=self?.job,own=!!self?.enabled;
    pocketRestart=!!pj?.running; // the daemon goes away during the update; a failed poll then is expected, not an error
    // 1.123: with POCKET_SELF_UPDATE=1 the owner installs the release here; otherwise the operator does, as before.
    const pocketAction=!pk?.available?'<span class="title-note">No newer release found.</span>'
      :own&&self.available&&!pj?.running?`<button class="chip" id="pocket-self-update">Update to ${esc(pk.latest)}</button>`
      :own?'':`<a class="chip" href="${esc(pk.guide)}" target="_blank" rel="noopener noreferrer">How to update</a>`;
    sh.querySelector('#pocket-update-row').innerHTML=pk?.enabled?`<section class="cli-update-row" aria-labelledby="cli-name-pocket">
        <h3 id="cli-name-pocket">Pocket Code</h3>
        <p class="title-note">${own?'Runs Pocket itself. You install its updates here: Pocket backs up its data, installs the release and restarts. Conversations reconnect in about a minute.':'Runs Pocket itself. Whoever manages this server installs its updates; Pocket only lets you know.'}</p>
        <p>Installed: <b>${esc(pk.installed||'Unavailable')}</b> · Available: <b>${esc(pk.latest||'Not checked')}</b></p>
        ${pk.error?`<p class="title-note">${esc(pk.error)}</p>`:''}
        ${own&&self.reason?`<p class="title-note">${esc(self.reason)}</p>`:''}
        ${pj?`<p class="title-note" id="pocket-self-status">${esc(pocketPhase(pj,pk.installed))}</p>`:''}
        <div class="cli-update-actions"><a class="chip" href="${esc(pk.notes)}" target="_blank" rel="noopener noreferrer">Pocket Code release notes</a>${pocketAction}</div></section>`:'';
    const pb=sh.querySelector('#pocket-self-update');
    if(pb)pb.onclick=async()=>{
      if(!confirm(`Update Pocket Code to ${pk.latest}? Pocket backs up its data, installs the release and restarts. Open conversations reconnect in about a minute; if the new version does not start, Pocket goes back to ${pk.installed}.`))return;
      await act('/cli-updates/pocket',{version:pk.latest});
    };
    const sig=JSON.stringify(s.providers);
    if(sig!==signature){
      const first=!signature;signature=sig;
      if(first||!selection.size)selection=new Set(s.providers.filter(p=>p.available&&p.canUpgrade).map(p=>p.key));
      sh.querySelector('#cli-update-rows').innerHTML=s.providers.map(p=>`<section class="cli-update-row" aria-labelledby="cli-name-${p.key}">
        <h3 id="cli-name-${p.key}">${esc(p.name)}</h3>
        <p class="title-note">${p.key==='claude'?'Runs Claude conversations in Pocket.':'Runs Codex conversations in Pocket.'}</p>
        <p>Installed: <b>${esc(p.installed||'Unavailable')}</b> · Available: <b>${esc(p.latest||'Not checked')}</b></p>
        ${p.error?`<p class="title-note">${esc(p.error)}</p>`:''}
        ${p.olderSessions?`<p class="title-note">${p.olderSessions} conversation${p.olderSessions===1?'':'s'} on the earlier CLI. Idle ones switch on their next turn. Restarting Pocket keeps those processes.</p><div class="cli-older-list">${(p.older||[]).map(o=>`<div class="cli-older-session"><div><b>${esc(o.title)}</b><span class="title-note">${o.busy?(o.background?'Background work running':'Working now'):'Idle'}${o.version?' · '+esc(o.version):''}</span></div><button class="chip" data-cli-switch="${esc(o.id)}" data-cli-key="${p.key}" data-cli-interrupt="${o.busy?'true':'false'}">${o.busy?'Stop work & switch':'Switch now'}</button></div>`).join('')}</div>`:''}
        <div class="cli-update-actions"><a class="chip" href="${esc(p.notes)}" target="_blank" rel="noopener noreferrer">${esc(p.name)} release notes</a>
        ${p.available&&p.canUpgrade?`<label class="cli-update-choice"><input type="checkbox" data-cli-select="${p.key}" ${selection.has(p.key)?'checked':''}> Upgrade to ${esc(p.latest)}</label>`:!p.canUpgrade?'<span class="title-note">Managed outside Pocket or unavailable on this server.</span>':'<span class="title-note">No newer release found.</span>'}
        ${p.previous&&p.canUpgrade?`<button class="chip" data-cli-rollback="${p.key}">Restore ${esc(p.previous)}</button>`:''}</div></section>`).join('');
      sh.querySelectorAll('[data-cli-select]').forEach(el=>el.onchange=()=>{el.checked?selection.add(el.dataset.cliSelect):selection.delete(el.dataset.cliSelect);buttons();});
      sh.querySelectorAll('[data-cli-rollback]').forEach(el=>el.onclick=async()=>{
        const p=state.providers.find(p=>p.key===el.dataset.cliRollback);
        if(!confirm(`Restore ${p.name} ${p.previous}? Pocket will test it before switching new conversations.`))return;
        await act('/cli-updates/upgrade',{selections:[{key:p.key,version:p.previous}],rollback:true});
      });
      sh.querySelectorAll('[data-cli-switch]').forEach(el=>el.onclick=async()=>{
        const o=state.providers.find(p=>p.key===el.dataset.cliKey)?.older?.find(o=>o.id===el.dataset.cliSwitch);
        if(!o)return refresh();
        if(o.busy&&!confirm(`Stop the work in “${o.title}” now? Its current reply may be incomplete. The next turn will use the updated CLI.`))return;
        await act('/cli-updates/switch',{key:o.key,id:o.id,interrupt:o.busy});
        await refresh();
      });
    }
    const j=s.job,labels={queued:'Preparing upgrade…',installing:'Downloading and installing…',testing:'Testing CLI compatibility…',activated:'Version selected. Finishing…',complete:'Upgrade complete. New processes use the selected versions.',failed:'Upgrade failed.',interrupted:'Upgrade interrupted.'};
    sh.querySelector('#cli-job').textContent=(j?labels[j.phase]||j.phase:'')+(j?.results?.length?' Completed: '+j.results.map(r=>`${r.key==='claude'?'Claude Code':'Codex'} ${r.version}`).join(', ')+'.':'')+(j?.error?' '+j.error:'');
    sh.querySelector('#cli-update-error').textContent=s.checkError||'';
    sh.querySelectorAll('[data-cli-rollback],[data-cli-select],[data-cli-switch]').forEach(el=>el.disabled=busy||!!j?.running||!!s.checking);
    buttons();
  };
  async function refresh(){if(fetching||busy||!sh.isConnected)return;fetching=true;try{const s=await api('/cli-updates',{signal:AbortSignal.timeout(10000)});if(sh.isConnected)render(s);}catch(e){if(sh.isConnected)sh.querySelector('#cli-update-error').textContent=pocketRestart?'':'Could not load updates. Use Check now to retry.';}finally{fetching=false;}}
  // 1.124.3: a POST answers with the plain snapshot: the older conversations and Pocket's self-update come only with GET.
  // They are kept from the view on screen until the next refresh, so Update and Switch now do not vanish for a moment.
  const withView=s=>({...s,pocket:s.pocket&&state?.pocket&&!('self' in s.pocket)?{...s.pocket,self:state.pocket.self}:s.pocket,
    providers:s.providers.map(p=>{const o=state?.providers.find(x=>x.key===p.key);return o&&'older' in o&&!('older' in p)?{...p,older:o.older,olderSessions:o.olderSessions}:p;})});
  async function act(url,body){busy=true;sh.querySelectorAll('[data-cli-rollback],[data-cli-select],[data-cli-switch]').forEach(el=>el.disabled=true);buttons();sh.querySelector('#cli-update-error').textContent='';
    try{const s=await api(url,{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});if(sh.isConnected){if(Array.isArray(s.providers))render(withView(s));else sh.querySelector('#cli-job').textContent=s.message||'';}}catch(e){if(sh.isConnected)sh.querySelector('#cli-update-error').textContent=e.message;}finally{busy=false;if(state){sh.querySelectorAll('[data-cli-rollback],[data-cli-select],[data-cli-switch]').forEach(el=>el.disabled=!!state.job?.running||!!state.checking);}buttons();}}
  sh.querySelector('#cli-check').onclick=()=>act('/cli-updates/check',{});
  sh.querySelector('#cli-upgrade').onclick=()=>act('/cli-updates/upgrade',{selections:selected().map(p=>({key:p.key,version:p.latest}))});
  sh.querySelector('#cli-later').onclick=()=>closeCurrentSheet?.();
  await refresh();
  const timer=setInterval(()=>{if(!sh.isConnected){clearInterval(timer);return;}refresh();},2000);
}
