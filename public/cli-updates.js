/* CLI updates: a quiet persistent notice, then an explicit review and upgrade. Operate; existing Pocket tokens. */
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
  const text=completed?'CLI upgrade complete. View results':s?.job?.running?'CLI upgrade in progress. View progress':failed?'CLI upgrade needs attention. View details':older?`${older} conversation${older===1?'':'s'} still using an older CLI. Review`:available.length?available.map(p=>p.name).join(' and ')+' update available. Review':'';
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
async function openCliUpdates(){
  const scrim=document.createElement('div');scrim.className='scrim';
  const sh=document.createElement('div');sh.className='sheet cli-updates-sheet';
  sh.innerHTML='<h2>CLI updates</h2><p class="sheet-help" id="cli-schedule">Loading update status…</p><div id="cli-update-rows"></div><p id="cli-job" role="status" aria-live="polite"></p><p class="title-note">Upgrades run on the server. You can close Pocket while they finish. Current conversations keep their version until they can safely reopen.</p><p class="title-note">Pocket checks that the CLI starts and connects correctly before switching. These checks do not cover every feature.</p><div class="cli-update-actions"><button class="primary" id="cli-upgrade" disabled>Upgrade selected</button><button class="chip" id="cli-check">Check now</button><button class="chip" id="cli-later">Later</button></div><p class="title-note" id="cli-update-error" role="alert"></p>';
  mountSheet(scrim,sh);
  let state=null,selection=new Set(),signature='',busy=false,fetching=false;
  const selected=()=>state?.providers.filter(p=>selection.has(p.key)&&p.available&&p.canUpgrade)||[];
  const buttons=()=>{sh.querySelector('#cli-upgrade').disabled=busy||state?.job?.running||state?.checking||!selected().length;sh.querySelector('#cli-check').disabled=busy||state?.job?.running||state?.checking||state?.enabled===false;};
  const render=s=>{
    state=s;cliUpdateState=s;if(s.job?.phase==='complete'){try{localStorage.setItem('pc-cli-update-seen',s.job.id);}catch{}}paintCliUpdateNotice();
    const stamp=s.checkedAt?new Date(s.checkedAt).toLocaleString(): 'Not checked yet';
    sh.querySelector('#cli-schedule').textContent=(s.enabled?`Checks daily at 4:00 a.m. (${s.timeZone}). Installs only when you choose Upgrade.`:'CLI update checks are disabled on this server.')+' Last check: '+stamp+'.';
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
  async function refresh(){if(fetching||busy||!sh.isConnected)return;fetching=true;try{const s=await api('/cli-updates',{signal:AbortSignal.timeout(10000)});if(sh.isConnected)render(s);}catch(e){if(sh.isConnected)sh.querySelector('#cli-update-error').textContent='Could not load updates. Use Check now to retry.';}finally{fetching=false;}}
  async function act(url,body){busy=true;sh.querySelectorAll('[data-cli-rollback],[data-cli-select],[data-cli-switch]').forEach(el=>el.disabled=true);buttons();sh.querySelector('#cli-update-error').textContent='';
    try{const s=await api(url,{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});if(sh.isConnected){if(Array.isArray(s.providers))render(s);else sh.querySelector('#cli-job').textContent=s.message||'';}}catch(e){if(sh.isConnected)sh.querySelector('#cli-update-error').textContent=e.message;}finally{busy=false;if(state){sh.querySelectorAll('[data-cli-rollback],[data-cli-select],[data-cli-switch]').forEach(el=>el.disabled=!!state.job?.running||!!state.checking);}buttons();}}
  sh.querySelector('#cli-check').onclick=()=>act('/cli-updates/check',{});
  sh.querySelector('#cli-upgrade').onclick=()=>act('/cli-updates/upgrade',{selections:selected().map(p=>({key:p.key,version:p.latest}))});
  sh.querySelector('#cli-later').onclick=()=>closeCurrentSheet?.();
  await refresh();
  const timer=setInterval(()=>{if(!sh.isConnected){clearInterval(timer);return;}refresh();},2000);
}
