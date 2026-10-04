// Current README assets, captured from the browser suite's synthetic API fixture.
import fs from 'node:fs';
import path from 'node:path';
export async function captureDocs({browser,base,rows,dir}) {
 fs.mkdirSync(dir,{recursive:true});
 for(const mobile of [false,true]){
  const context=await browser.createBrowserContext(),page=await context.newPage();
  try {
   await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
   await page.setViewport(mobile?{width:390,height:844,isMobile:true,hasTouch:true}:{width:1600,height:1000});
   await page.goto(base+'/#/chat/'+rows[3].id);await page.waitForSelector('#box');
   await page.type('#box','Check incoming stock before preparing the order.');
   if(!mobile){
    await page.click('#splitb');await page.click(`[data-v="${rows[0].id}"]`);
    await page.waitForSelector('#panes iframe');const frame=await(await page.$('#panes iframe')).contentFrame();
    await frame.waitForSelector('#box');
   }
   if(mobile)await page.evaluate(()=>{document.querySelector('#box').blur();document.querySelector('main.scroll').scrollTop=0;});
   await page.mouse.move(0,0);await page.evaluate(()=>{if(typeof hideTip==='function')hideTip();});
   await page.screenshot({path:path.join(dir,mobile?'mobile-workspace.png':'desktop-split.png')});
  } finally {await context.close();}
 }
}
