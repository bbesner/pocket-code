// F-21 (Casey 1.88.1): opens and closes one sheet on a long conversation in Chrome and times it, with app.inert as
// shipped and with the inert toggle made a no-op, at 1x and 4x CPU, with and without renderer accessibility.
// Open/close are timed two ways: sync (the call plus a forced style and layout) and frame (to the next frame's task).
import puppeteer from 'puppeteer-core';
const median=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)];};
export async function measureSheets({base,cookie,id,runs=5}){
 const out=[];
 for(const a11y of [false,true]){
  const browser=await puppeteer.launch({executablePath:'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox',...(a11y?['--force-renderer-accessibility']:[])]});
  try{
   const p=await browser.newPage();await p.setViewport({width:1280,height:900});
   await p.setCookie({name:'pc_auth',value:cookie,url:base});
   await p.goto(`${base}/#/chat/${id}`,{waitUntil:'networkidle2'});
   await p.waitForFunction(()=>document.querySelectorAll('#msgs > *').length>20,{timeout:30000});
   await new Promise(r=>setTimeout(r,1500));
   const cdp=await p.createCDPSession();await cdp.send('Performance.enable');
   const metric=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
   const elements=await p.evaluate(()=>document.getElementsByTagName('*').length);
   for(const rate of [1,4]){
    await cdp.send('Emulation.setCPUThrottlingRate',{rate});
    for(const inert of [true,false]){
     await p.evaluate(on=>{if(on)delete app.inert;else Object.defineProperty(app,'inert',{configurable:true,get(){return false},set(){}});},inert);
     const rows=[];
     for(let i=0;i<runs+1;i++){
      const m0=await metric();
      const r=await p.evaluate(async()=>{
       const frame=()=>new Promise(res=>requestAnimationFrame(()=>setTimeout(res,0)));
       await frame();
       let t=performance.now();sheet('Model',[['a','Default'],['b','Opus'],['c','Sonnet']],'a',()=>{});document.body.getBoundingClientRect();const openSync=performance.now()-t;
       await frame();const openFrame=performance.now()-t;
       await frame();
       t=performance.now();closeCurrentSheet();document.body.getBoundingClientRect();const closeSync=performance.now()-t;
       await frame();const closeFrame=performance.now()-t;
       return {openSync,openFrame,closeSync,closeFrame};
      });
      const m1=await metric();
      r.recalcMs=(m1.RecalcStyleDuration-m0.RecalcStyleDuration)*1000;r.layoutMs=(m1.LayoutDuration-m0.LayoutDuration)*1000;
      if(i)rows.push(r); // the first run warms up
     }
     const k=x=>median(rows.map(r=>r[x])).toFixed(1);
     out.push(`a11y=${a11y?'on ':'off'} cpu=${rate}x inert=${inert?'shipped':'no-op  '} elements=${elements}  open sync/frame ${k('openSync')}/${k('openFrame')} ms  close sync/frame ${k('closeSync')}/${k('closeFrame')} ms  style recalc ${k('recalcMs')} ms  layout ${k('layoutMs')} ms (per open+close, median of ${rows.length})`);
    }
   }
   await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  }finally{await browser.close();}
 }
 return out;
}
