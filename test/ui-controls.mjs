// Follow the visible Settings category or session-setup disclosure before using a
// control. Existing behavior tests exercise the same controls through the new UI.
export async function clickControl(page, selector, options) {
 const section=await page.$eval(selector,e=>({category:e.closest('[data-settings-panel]')?.dataset.settingsPanel,setup:Boolean(e.closest('#new-setup')&&!e.closest('summary')&&!e.closest('#new-setup').open)})).catch(()=>null);
 if(section?.category){
  const hidden=await page.$eval(`[data-settings-panel="${section.category}"]`,e=>e.hidden);
  if(hidden){if(await page.$eval('.settings-index',e=>e.hidden))await page.click('#settings-back');await page.click(`[data-settings-category="${section.category}"]`);}
 }
 if(section?.setup)await page.click('#choose-workspace');
 return page.click(selector,options);
}
