// Follow the visible Settings category or session-setup disclosure before using a
// control. Existing behavior tests exercise the same controls through the new UI.
export async function clickControl(page, selector, options) {
 const section=await page.$eval(selector,e=>({category:e.closest('[data-settings-panel]')?.dataset.settingsPanel,setup:Boolean(e.closest('#new-setup')&&!e.closest('summary')&&!e.closest('#new-setup').open)})).catch(()=>null);
 if(section?.category){
  const hidden=await page.$eval(`[data-settings-panel="${section.category}"]`,e=>e.hidden);
  if(hidden)await openSettingsPage(page,section.category);
 }
 if(section?.setup)await page.click('#choose-workspace');
 return page.click(selector,options);
}

// Screenshot one element without resizing the page. Puppeteer captures an element "beyond the viewport" by default,
// and for that Chrome resizes the page for a moment (to 1x1 here) and back. Every media query flips with it, and the
// app answers: below 1280 px a docked Results panel becomes a sheet over the page (workspace.js), and it stays a
// sheet when the width comes back, so the next click lands on its scrim (the Files "Split" step, 1.119). An element
// that fits in the viewport is captured inside it, and the page must not see a resize; a taller one keeps the old way.
export async function elementShot(handle, options={}) {
 const fits=await handle.evaluate(e=>{const r=e.getBoundingClientRect();return r.width<=innerWidth&&r.height<=innerHeight;});
 if(!fits)return handle.screenshot(options);
 await handle.evaluate(()=>{window.__shotResizes=0;if(!window.__shotWatch){window.__shotWatch=true;addEventListener('resize',()=>{window.__shotResizes++;});}});
 const shot=await handle.screenshot({...options,captureBeyondViewport:false});
 const resizes=await handle.evaluate(()=>window.__shotResizes);
 if(resizes)throw new Error(`the element screenshot resized the page ${resizes} time(s)`);
 return shot;
}

// 1.124.9: open a Settings page from wherever the sheet is: back to the index, then the page (a feature page through
// Features, by its ›).
export async function openSettingsPage(page, key) {
 const parent=await page.$eval(`[data-settings-panel="${key}"]`,e=>e.dataset.settingsParent||'');
 if(!await page.$eval(`[data-settings-panel="${key}"]`,e=>e.hidden))return;
 while(!await page.$eval('.settings-index',e=>!e.hidden))await page.click('#settings-back');
 if(parent){await page.click(`.settings-index [data-settings-category="${parent}"]`);await page.waitForSelector(`[data-settings-panel="${parent}"]:not([hidden])`);}
 await page.click(`[data-settings-panel] [data-settings-category="${key}"], .settings-index [data-settings-category="${key}"]`);
 await page.waitForSelector(`[data-settings-panel="${key}"]:not([hidden])`);
}
