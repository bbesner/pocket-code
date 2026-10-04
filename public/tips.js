/* Tooltips: a short explanation on mouse hover or keyboard focus. Touch never shows them.
   Text comes from data-tip; icon-only controls fall back to their accessible name. */
const TIPS = {
 back:'Back to all sessions',
 railtog:'Show or hide the session list',
 splitb:'Split view: open another session beside this one',
 chgb:'Changed files: the edits this session made, with diffs',
 findb:'Find text in this conversation (Ctrl+F)',
 chatmore:'Session options: rename, pin, permissions and text size',
 'session-switch':'Switch to another session',
 'results-open':'Results: reports, files and links this session produced',
 'queue-open':'Queue: instructions saved to run after the current turn',
 'git-open':'Git: read-only view of changed files in this repository',
 'pane-main':'Make this the main conversation. The two swap places.',
 'pane-close':'Close this pane. The session keeps running.',
 'close-main':'Close this session. It stays in your session list; asks first if a turn is running.',
 'c-att':'Attach files or paste a screenshot',
 'c-model':'Model for the next turn',
 'c-eff':'Reasoning effort for the next turn. Higher thinks longer.',
 'c-approval':'Permissions for the next turn. Review actions asks first; Full access runs without asking.',
 'c-mode':'Codex mode: plan the approach first, or work normally',
 'c-mute':'Turn-finished alerts for this session',
 muteb:'Turn-finished alerts for this session',
 stopb:'Stop the running turn',
 send:'Send (Enter)',
 railsettings:'App settings, version and notifications',
 railnew:'Start a new session',
 grip:'Drag to resize the session list',
 bell:'Turn-finished notifications on this device',
 settings:'App settings, version and notifications',
 new:'Start a new session',
 'refresh-sessions':'Reload the session list',
};
const tipEl=document.createElement('div');
tipEl.className='tip';tipEl.id='tip';tipEl.setAttribute('role','tooltip');tipEl.hidden=true;
document.body.append(tipEl);
let tipFor=null,tipTimer=null;
function tipText(el){
 if(el.dataset.tip)return el.dataset.tip;
 if(TIPS[el.id])return TIPS[el.id];
 if(el.textContent.trim())return ''; // labelled text buttons explain themselves
 return el.getAttribute('aria-label')||el.dataset.tipTitle||el.getAttribute('title')||'';
}
function tipTarget(node){
 const el=node?.closest?.('button,a[href],[role="separator"]');
 if(!el||el.closest('.tip,.sheet .opt')||el.disabled)return null;
 return tipText(el)?el:null;
}
function showTip(el){
 const text=tipText(el);if(!text||!el.isConnected)return;
 // the native title tooltip would stack on ours; park it while ours is up
 if(el.hasAttribute('title')){el.dataset.tipTitle=el.title;el.removeAttribute('title');}
 tipFor=el;tipEl.textContent=text;tipEl.hidden=false;
 el.setAttribute('aria-describedby','tip');
 const r=el.getBoundingClientRect(),t=tipEl.getBoundingClientRect(),gap=6;
 const below=r.bottom+gap+t.height<=innerHeight-8;
 tipEl.style.top=Math.round(below?r.bottom+gap:Math.max(8,r.top-gap-t.height))+'px';
 tipEl.style.left=Math.round(Math.min(innerWidth-t.width-8,Math.max(8,r.left+r.width/2-t.width/2)))+'px';
 // toolbars repaint under the pointer; a removed control takes its tip with it
 const watch=setInterval(()=>{if(tipFor!==el)clearInterval(watch);else if(!el.isConnected){clearInterval(watch);hideTip();}},400);
}
function hideTip(){
 clearTimeout(tipTimer);tipTimer=null;
 if(!tipFor)return;
 if(tipFor.dataset.tipTitle){tipFor.title=tipFor.dataset.tipTitle;delete tipFor.dataset.tipTitle;}
 if(tipFor.getAttribute('aria-describedby')==='tip')tipFor.removeAttribute('aria-describedby');
 tipFor=null;tipEl.hidden=true;
}
document.addEventListener('pointerover',e=>{
 if(e.pointerType!=='mouse')return;
 const el=tipTarget(e.target);
 if(el===tipFor||(!el&&!tipFor))return;
 hideTip();
 if(el)tipTimer=setTimeout(()=>showTip(el),350);
});
document.addEventListener('pointerout',e=>{if(tipFor&&!tipFor.contains(e.relatedTarget))hideTip();else if(tipTimer&&!e.relatedTarget?.closest?.('button,a[href],[role="separator"]'))hideTip();});
document.addEventListener('pointerdown',hideTip,true);
document.addEventListener('focusin',e=>{const el=tipTarget(e.target);hideTip();if(el?.matches(':focus-visible'))showTip(el);});
document.addEventListener('focusout',hideTip);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&tipFor)hideTip();},true);
addEventListener('scroll',hideTip,true);
addEventListener('hashchange',hideTip);
