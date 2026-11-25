/* Sort and search for the Tasks and Vault lists (1.125, Damon's request), in the rail and on the full page.
   One order per list, kept in the server's settings (tasksOrder, vaultOrder): the order picked in a list is the order
   it opens in next time, on every device, and Settings → Features → Tasks › / Vault › shows the same choice. Search
   narrows what is loaded: every word must match, case does not matter, and the matched words are marked in the row.
   The rail gets one compact row (a search box and a sort button that opens a sheet), folded away by the rail's Filters
   toggle; the full page gets the search box and a Sort select. A phone has no rail: its full-screen list has both. */
const ListTools=(()=>{
 const SORT_ICON='<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3"/></svg>';
 const words=q=>String(q||'').toLowerCase().split(/\s+/).filter(Boolean);
 const matches=(text,ws)=>ws.every(w=>text.includes(w));
 // The text, escaped, with each matched word wrapped in <mark>. Where lower-casing changes the length (a few non-Latin
 // letters), the positions would not line up, so the text is shown unmarked rather than marked in the wrong place.
 function mark(text,ws){
  const s=String(text??'');if(!ws.length||!s)return esc(s);
  const low=s.toLowerCase();if(low.length!==s.length)return esc(s);
  const hit=new Uint8Array(s.length);
  for(const w of ws){let i=low.indexOf(w);while(i>=0){hit.fill(1,i,i+w.length);i=low.indexOf(w,i+w.length);}}
  let out='',open=false;
  for(let k=0;k<s.length;k++){const h=hit[k]===1;if(h!==open){out+=h?'<mark>':'</mark>';open=h;}out+=esc(s[k]);}
  return out+(open?'</mark>':'');
 }
 const searchHTML=({id,label,placeholder,value=''})=>`<div class="session-search list-search">${IC.search}<input type="search" id="${id}" placeholder="${esc(placeholder)}" aria-label="${esc(label)}" value="${esc(value)}" autocomplete="off" spellcheck="false" enterkeyhint="search"></div>`;
 // choices: [[value, label, sub, tag]]; tag is the short words for the header ("due first").
 const selectHTML=({id,choices,value})=>`<label class="voice-field list-order">Sort<select id="${id}">${choices.map(([v,l])=>`<option value="${esc(v)}"${v===value?' selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
 const sortButtonHTML=({id,choices,value})=>{const l=(choices.find(([v])=>v===value)||choices[0])[1];return `<button class="icon list-sort" id="${id}" aria-haspopup="dialog" aria-label="Sort: ${esc(l)}. Change the order" title="Sort: ${esc(l)}">${SORT_ICON}</button>`;};
 // The rail's line under the search box: how many match, and Clear. Reuses the conversation filters' summary line.
 const summaryHTML=({text,clearId})=>`<div class="rail-filter-summary list-summary" role="status"${text?'':' hidden'}><span>${esc(text||'')}</span><button id="${clearId}">Clear</button></div>`;
 function bindSearch(input,onChange){
  if(!input)return;
  input.oninput=()=>onChange(input.value);
  input.onkeydown=e=>{if(e.key==='Escape'&&input.value){e.preventDefault();e.stopPropagation();input.value='';onChange('');}};
 }
 // The sort sheet, for the rail's button; the note says where else the choice lives.
 function pickOrder({title,where,choices,value,onPick}){
  sheet(title,choices.map(([v,l,sub])=>[v,l,sub||'']),value,v=>{if(v!==value)onPick(v);},{note:`The ${where} opens in this order on every device. It is also in Settings → Features → ${where}.`});
 }
 // Save the order for every device. Returns true when the server took it.
 async function saveOrder(key,value){
  try{await api('/settings',{method:'POST',body:JSON.stringify({[key]:value}),signal:AbortSignal.timeout(8000)});return true;}
  catch(e){if(e.message!=='login')toast('Could not save the order: '+(e.message||'error'));return false;}
 }
 // Rebuilding a list must not take the cursor out of its search box: note it before, put it back after.
 function keepFocus(root,rebuild){
  const a=document.activeElement,id=a&&root.contains(a)&&a.id?a.id:'',caret=a&&a.tagName==='INPUT'?a.selectionStart:null;
  rebuild();
  if(!id)return;const el=root.querySelector('#'+CSS.escape(id));if(!el)return;
  el.focus({preventScroll:true});if(caret!==null&&el.tagName==='INPUT')try{el.setSelectionRange(caret,caret);}catch{}
 }
 return {words,matches,mark,searchHTML,selectHTML,sortButtonHTML,summaryHTML,bindSearch,pickOrder,saveOrder,keepFocus};
})();
