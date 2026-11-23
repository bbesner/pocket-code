// Layout sweep: every surface in test/sweep/*.mjs, at every layout, in light and dark, on the browser suite's
// synthetic server (no real sessions, credentials or model calls).
//
//   POCKET_SWEEP=all|<area>[,<area>]   which test/sweep/<area>.mjs files to run
//   POCKET_SWEEP_SURFACE=<part>[,…]    only surfaces whose name contains one of these (=name for an exact name)
//   POCKET_SWEEP_LAYOUTS=phone,desktop only these layouts (default: all six)
//   POCKET_SWEEP_THEMES=dark           only these themes (default: dark,light)
//   POCKET_SWEEP_STRICT=1              exit non-zero when any cell has a problem (default: report only)
//   POCKET_SCREENSHOTS=<dir>           where the pictures and the JSON go (<dir>/sweep/…)
//
// Run:  POCKET_SWEEP=all POCKET_SCREENSHOTS=/tmp/sweep node test/browser.mjs
//
// For each cell it opens the surface in a fresh browser context, waits for it, takes a picture and measures what
// a person would trip on: the page scrolling sideways, a control pushed off the screen, a touch target under 44 px
// (DESIGN.md), text cut off without an ellipsis, a control hidden under another element, an accessibility rule
// broken (axe, WCAG 2.2 AA, which includes contrast in both themes) and any page error.
//
// A surface module exports:
//   export const area = 'libraries';
//   export const surfaces = [{
//     name: 'projects-board',            // file-name safe
//     route: '#/projects',               // or a function (ctx, cell) => route
//     ready: '.project-card',            // selector to wait for after load
//     settings: {projects: true},        // patch on the fixture's settings for this surface (restored after)
//     modes: {…},                        // patch on the fixture's uiModes (restored after)
//     layouts: ['phone','desktop'],      // optional: only these layouts
//     before: async (ctx) => undo,       // optional: seed fixture state; may return an async undo
//     open: async (page, h) => {},       // optional: clicks that bring the surface up (a sheet, a menu, a state)
//     scope: '.sheet',                   // optional: measure only inside this element (a sheet over the page)
//     allow: {small: [/…/], cut: [/…/]}  // optional: known and accepted, matched against the described element
//   }];
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {clickControl} from './ui-controls.mjs';
const require=createRequire(import.meta.url);

export const LAYOUTS={
 cover:{width:344,height:882,isMobile:true,hasTouch:true,deviceScaleFactor:2},    // a folded phone's cover screen: the narrowest
 phone:{width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:2},
 fold:{width:690,height:829,isMobile:true,hasTouch:true,deviceScaleFactor:2},     // an open fold: just under the 700 px step
 tablet:{width:820,height:1180,isMobile:true,hasTouch:true,deviceScaleFactor:2},  // between the 700 and 900 px steps
 desktop:{width:1440,height:900},
 pane:{width:480,height:900,pane:true},                                          // a split pane: the app in its ?pane= frame
};
export const THEMES=['dark','light'];

// Runs in the page. Returns what it measured; decides nothing.
function measureInPage({touch,scope}){
 const vw=innerWidth,vh=innerHeight,root=(scope&&document.querySelector(scope))||document.body;
 const describe=e=>{if(!e||e.nodeType!==1)return '';const cls=[...e.classList].slice(0,3).map(c=>'.'+c).join('');
  const label=(e.getAttribute('aria-label')||e.getAttribute('title')||e.innerText||e.value||e.getAttribute('placeholder')||'').replace(/\s+/g,' ').trim().slice(0,48);
  return e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+cls+(label?' "'+label+'"':'');};
 const shown=e=>{if(!e.checkVisibility||!e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
 const inView=r=>r.bottom>0&&r.top<vh&&r.right>0&&r.left<vw;
 const scrollsSideways=e=>{for(let p=e.parentElement;p&&p!==document.documentElement;p=p.parentElement){const s=getComputedStyle(p);if(/(auto|scroll)/.test(s.overflowX)&&p.scrollWidth>p.clientWidth+1)return true;}return false;};
 const clippedBy=e=>{const r=e.getBoundingClientRect();for(let p=e.parentElement;p&&p!==document.documentElement;p=p.parentElement){const s=getComputedStyle(p);if(s.overflowX==='visible'&&s.overflowY==='visible')continue;const pr=p.getBoundingClientRect();
   if(r.right<=pr.left||r.left>=pr.right||r.bottom<=pr.top||r.top>=pr.bottom)return true;}return false;}; // scrolled out of its own scroller: not on screen now
 const out={viewport:[vw,vh],hash:location.hash,overflowX:Math.max(0,document.documentElement.scrollWidth-vw),bodyOverflowX:Math.max(0,document.body.scrollWidth-vw),offscreen:[],small:[],covered:[],cut:[],ellipsis:0,unnamed:[],controls:0};
 const controls=[...root.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=switch],[role=checkbox],[role=radio],[role=menuitem],[role=option],[tabindex]:not([tabindex="-1"])')];
 for(const e of controls){
  if(!shown(e)||e.disabled&&e.tagName!=='BUTTON')continue;
  let r=e.getBoundingClientRect();if(!inView(r)||clippedBy(e))continue;
  out.controls++;
  const sideways=scrollsSideways(e);
  if(!sideways&&(r.right>vw+1||r.left<-1))out.offscreen.push({el:describe(e),left:Math.round(r.left),right:Math.round(r.right)});
  if(touch){
   // The target is the control or the label wrapped around it, whichever is larger.
   let w=r.width,h=r.height;const lab=e.closest('label')||(e.id&&document.querySelector('label[for="'+CSS.escape(e.id)+'"]'));
   if(lab&&shown(lab)){const lr=lab.getBoundingClientRect();w=Math.max(w,lr.width);h=Math.max(h,lr.height);}
   const inline=e.tagName==='A'&&Boolean(e.closest('p,li,td,th,.msg,.prose'))&&getComputedStyle(e).display.startsWith('inline');
   if(!inline&&(w<43.5||h<43.5))out.small.push({el:describe(e),w:Math.round(w),h:Math.round(h)});
  }
  const cx=Math.min(vw-1,Math.max(0,r.left+r.width/2)),cy=Math.min(vh-1,Math.max(0,r.top+r.height/2)),hit=document.elementFromPoint(cx,cy);
  if(hit&&hit!==e&&!e.contains(hit)&&!hit.contains(e)){const lab=hit.closest('label');if(!(lab&&(lab.contains(e)||lab.htmlFor===e.id)))out.covered.push({el:describe(e),by:describe(hit)});}
  const named=(e.getAttribute('aria-label')||e.getAttribute('aria-labelledby')||e.getAttribute('title')||e.innerText||e.value||e.getAttribute('placeholder')||e.getAttribute('alt')||'').trim()||(e.id&&document.querySelector('label[for="'+CSS.escape(e.id)+'"]'))||e.closest('label');
  if(!named)out.unnamed.push(describe(e));
 }
 // Text that does not fit its box: an ellipsis is a choice, a hard cut is a fault.
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT);
 for(let e=walker.currentNode;e;e=walker.nextNode()){
  if(![...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;
  if(!shown(e))continue;const r=e.getBoundingClientRect();if(!inView(r)||clippedBy(e))continue;
  const s=getComputedStyle(e),hidX=/(hidden|clip)/.test(s.overflowX),hidY=/(hidden|clip)/.test(s.overflowY);
  if(hidX&&e.scrollWidth>e.clientWidth+1){if(s.textOverflow==='ellipsis')out.ellipsis++;else out.cut.push({el:describe(e),axis:'x',by:e.scrollWidth-e.clientWidth});}
  else if(hidY&&e.scrollHeight>e.clientHeight+2&&!(s.webkitLineClamp&&s.webkitLineClamp!=='none'))out.cut.push({el:describe(e),axis:'y',by:e.scrollHeight-e.clientHeight});
  if(!hidX&&!scrollsSideways(e)&&(r.right>vw+1)&&s.position!=='fixed')out.offscreen.push({el:describe(e),left:Math.round(r.left),right:Math.round(r.right),text:true});
 }
 // 1.124.5: a sheet's own text lines start where its heading does (14 px in); one that hangs out to the left, or is
 // inset twice, is measured against the heading's text edge.
 const sheet=document.querySelector('.sheet[role=dialog]'),head=sheet&&sheet.querySelector('h2');out.inset=[];
 if(sheet&&head&&shown(head)){const edge=e=>e.getBoundingClientRect().left+parseFloat(getComputedStyle(e).paddingLeft),want=edge(head);
  for(const e of sheet.querySelectorAll(':scope > .sheet-help, .settings-scope, :scope > [data-environment] > *')){if(!shown(e)||!inView(e.getBoundingClientRect()))continue;
   const by=Math.round(edge(e)-want);if(Math.abs(by)>3)out.inset.push({el:describe(e),by});}}
 return out;
}

const allowed=(list,text)=>Array.isArray(list)&&list.some(re=>re.test(text));
const problemsOf=(cell,allow={})=>{
 const m=cell.measure,p=[];if(!m)return ['did not open: '+(cell.error||'unknown')];
 if(m.overflowX>1)p.push(`page scrolls sideways by ${m.overflowX}px`);
 for(const o of m.offscreen)if(!allowed(allow.offscreen,o.el))p.push(`off screen (${o.left}..${o.right}): ${o.el}`);
 for(const s of m.small)if(!allowed(allow.small,s.el))p.push(`target ${s.w}x${s.h}: ${s.el}`);
 for(const c of m.cut)if(!allowed(allow.cut,c.el))p.push(`text cut (${c.axis}, ${c.by}px): ${c.el}`);
 for(const c of m.covered)if(!allowed(allow.covered,c.el))p.push(`covered by ${c.by}: ${c.el}`);
 for(const u of m.unnamed)p.push(`no accessible name: ${u}`);
 for(const i of m.inset||[])if(!allowed(allow.inset,i.el))p.push(`${Math.abs(i.by)}px ${i.by<0?'left':'right'} of the sheet heading: ${i.el}`);
 for(const v of cell.axe||[])for(const n of v.nodes)if(!allowed(allow.axe,v.id+' '+n.target.join(' ')))p.push(`axe ${v.id}: ${n.target.join(' ')}${n.summary?' — '+n.summary.replace(/\s+/g,' ').slice(0,140):''}`);
 for(const e of cell.errors||[])p.push('page error: '+e.slice(0,200));
 return [...new Set(p)];
};

export async function runLayoutSweep(ctx){
 const {browser,base,out}=ctx,want=String(process.env.POCKET_SWEEP||'all').split(',').map(s=>s.trim()).filter(Boolean);
 const dir=path.join(import.meta.dirname,'sweep'),files=fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>f.endsWith('.mjs')).sort():[];
 const layouts=(process.env.POCKET_SWEEP_LAYOUTS?process.env.POCKET_SWEEP_LAYOUTS.split(','):Object.keys(LAYOUTS)).filter(k=>LAYOUTS[k]);
 const themes=(process.env.POCKET_SWEEP_THEMES?process.env.POCKET_SWEEP_THEMES.split(','):THEMES).filter(t=>THEMES.includes(t));
 const only=process.env.POCKET_SWEEP_SURFACE||'',root=path.join(out,'sweep');fs.mkdirSync(root,{recursive:true});
 const axeSource=fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8');
 const totals={areas:0,surfaces:0,cells:0,withProblems:0,failedToOpen:0},summary=[];
 for(const file of files){
  const mod=await import(path.join(dir,file));
  if(!want.includes('all')&&!want.includes(mod.area))continue;
  totals.areas++;const cells=[],shots=path.join(root,mod.area);fs.mkdirSync(shots,{recursive:true});
  for(const surface of mod.surfaces){
   if(only&&!only.split(',').some(part=>part.startsWith('=')?surface.name===part.slice(1):surface.name.includes(part)))continue;
   totals.surfaces++;
   for(const layoutName of layouts){
    if(surface.layouts&&!surface.layouts.includes(layoutName))continue;
    for(const theme of themes){
     const layout=LAYOUTS[layoutName],cell={surface:surface.name,layout:layoutName,theme,errors:[]},started=Date.now();
     const settings=ctx.settingsState(),savedSettings={...settings},savedModes={...ctx.modes};
     let undo=null;const context=await browser.createBrowserContext(),page=await context.newPage();
     page.setDefaultTimeout(Number(process.env.POCKET_SWEEP_TIMEOUT||8000));
     page.on('pageerror',e=>cell.errors.push(String(e.message||e)));
     page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))cell.errors.push('console: '+m.text());});
     try{
      Object.assign(settings,surface.settings||{});Object.assign(ctx.modes,surface.modes||{});
      for(const reset of ['/api/documents/reset','/api/board/reset','/api/tasks/reset','/api/inbox/reset','/api/vault/reset'])await fetch(base+reset).catch(()=>{}); // each answers only while its feature is on
      if(surface.before)undo=await surface.before(ctx,{layout:layoutName,theme});
      await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'},{name:'prefers-color-scheme',value:theme}]);
      const {pane,...viewport}=layout;await page.setViewport(viewport);
      await page.evaluateOnNewDocument(t=>{try{localStorage.setItem('pc-theme',JSON.stringify(t));}catch{}},theme);
      const route=typeof surface.route==='function'?surface.route(ctx,{layout:layoutName,theme}):(surface.route||'#/');
      await page.goto(base+(pane?'/?pane=sweep':'/')+route);
      if(surface.ready)await page.waitForSelector(surface.ready,{visible:true});
      const h={base,ctx,layout:layoutName,theme,touch:Boolean(layout.hasTouch),pane:Boolean(pane),click:(sel,o)=>clickControl(page,sel,o),
       settle:async()=>{await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));await new Promise(r=>setTimeout(r,120));}};
      if(surface.open)await surface.open(page,h);
      await h.settle();await page.mouse.move(0,0);await page.evaluate(()=>{if(typeof hideTip==='function')hideTip();});
      cell.measure=await page.evaluate(measureInPage,{touch:Boolean(layout.hasTouch),scope:surface.scope||null});
      await page.evaluate(axeSource);
      cell.axe=await page.evaluate(async scope=>(await axe.run(scope&&document.querySelector(scope)||document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),surface.scope||null);
      cell.shot=path.join(mod.area,`${surface.name}--${layoutName}--${theme}.png`);
      await page.screenshot({path:path.join(root,cell.shot)});
     }catch(e){cell.error=String(e.message||e).split('\n')[0];totals.failedToOpen++;
      try{cell.shot=path.join(mod.area,`${surface.name}--${layoutName}--${theme}--FAILED.png`);await page.screenshot({path:path.join(root,cell.shot)});}catch{}
     }finally{
      try{if(typeof undo==='function')await undo();}catch(e){cell.errors.push('undo: '+e.message);}
      for(const k of Object.keys(settings))delete settings[k];Object.assign(settings,savedSettings);
      for(const k of Object.keys(ctx.modes))delete ctx.modes[k];Object.assign(ctx.modes,savedModes);
      await context.close().catch(()=>{});
     }
     cell.ms=Date.now()-started;cell.problems=problemsOf(cell,surface.allow);cells.push(cell);totals.cells++;
     if(cell.problems.length){totals.withProblems++;summary.push(`### ${mod.area} / ${surface.name} — ${layoutName}, ${theme}\n`+cell.problems.map(p=>'- '+p).join('\n')+(cell.shot?`\n- picture: ${cell.shot}`:''));}
    }
   }
  }
  fs.writeFileSync(path.join(root,mod.area+'.json'),JSON.stringify(cells,null,1));
 }
 fs.writeFileSync(path.join(root,'summary.md'),`# Layout sweep\n\n${JSON.stringify(totals)}\n\n`+summary.join('\n\n')+'\n');
 console.log(JSON.stringify({ok:true,sweep:totals,dir:root}));
 if(process.env.POCKET_SWEEP_STRICT&&(totals.withProblems||totals.failedToOpen))process.exitCode=1;
 return totals;
}
