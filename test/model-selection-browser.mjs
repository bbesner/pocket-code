import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);

export async function runModelSelectionRegressions({browser, base, rows, out, received}) {
 const context = await browser.createBrowserContext();
 const page = await context.newPage();
 const errors = [], scans = [];
 page.on('pageerror', error => errors.push(error.message));
 const codexId = rows.find(row => row.id.startsWith('cx:')).id;
 const claudeId = rows[4].id;
 const openNew = async () => {
  await page.goto(base + '/#/new');
  await page.waitForSelector('#first');
  await page.waitForFunction(() => document.querySelector('#plist [data-p]'));
 };
 const selectAgent = async provider => {
  await page.$eval('#new-setup', element => { element.open = true; });
  await page.click(`[data-a="${provider}"]`);
 };
 const pickModel = async model => {
  await page.locator('#c-model').click();
  await page.locator(`[data-v="${model}"]`).click();
 };
 const scan = async label => {
  const axeScript = await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
  await axeScript.evaluate(element => element.remove());
  const accessibility = await page.evaluate(() => axe.run(document, {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']}}));
  assert.deepEqual(accessibility.violations.map(violation => violation.id), [], label);
  const record = {label, accessibility:accessibility.violations};
  if (process.env.POCKET_DESIGN_SCANNER) {
   await page.evaluate(() => { window.__IMPECCABLE_CONFIG__ = {autoScan:false}; });
   const detectorScript = await page.addScriptTag({path:process.env.POCKET_DESIGN_SCANNER});
   await detectorScript.evaluate(element => element.remove());
   record.detector = await page.evaluate(() => window.impeccableDetectAsync({scrollOffscreen:false}));
  }
  scans.push(record);
  await page.screenshot({path:path.join(out, label + '.png')});
 };
 try {
  for (const width of [390, 1440]) {
   await page.setViewport({width,height:900});
   await page.goto(base);
   await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('pc-provider', 'codex');
    localStorage.setItem('pc-prefs-' + NEW_KEY, JSON.stringify({model:'claude-opus-5-5[1m]',effort:'high'}));
   });
   await openNew();
   await page.waitForFunction(() => document.querySelector('#c-model').textContent.includes('GPT-6 Sol'));
   assert.equal(await page.evaluate(() => tb.prefs.model), 'default');
   assert.equal(await page.evaluate(() => getPrefs(NEW_KEY).model), 'default');
   assert.equal(await page.evaluate(() => turnOpts().model), undefined);
   await selectAgent('claude');
   await page.waitForFunction(() => MODELS.some(model => model[0] === 'claude-opus-5-5[1m]'));
   await pickModel('claude-opus-5-5[1m]');
   await selectAgent('codex');
   assert.equal(await page.evaluate(() => tb.prefs.model), 'default');
   for (const model of ['gpt-6-sol', 'gpt-6-astra']) {
    await pickModel(model);
    assert.equal(await page.evaluate(() => turnOpts().model), model);
   }
   await pickModel('gpt-6-sol');
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForSelector('#first');
   assert.equal(await page.evaluate(() => tb.prefs.model), 'gpt-6-sol', 'reopening New preserves a valid Codex choice');
   await selectAgent('claude');
   assert.equal(await page.evaluate(() => tb.prefs.model), 'default');
   await selectAgent('codex');
   await pickModel('gpt-6-sol');
   await page.type('#first', 'Check the selected model');
   await page.type('#cpath', '/workspaces/warehouse');
   await scan('model-selection-' + width);
   const sent = received.length;
   await page.click('#start');
   await page.waitForSelector('#box');
   assert.equal(received.length, sent + 1);
   assert.equal(received.at(-1).provider, 'codex');
   assert.equal(received.at(-1).model, 'gpt-6-sol');
  }
  for (const [id, model] of [[codexId, 'claude-opus-5-5[1m]'], [claudeId, 'gpt-6-sol']]) {
   await page.evaluate(({id, model}) => localStorage.setItem('pc-prefs-' + id, JSON.stringify({model,effort:'high'})), {id,model});
   await page.goto(base + '/#/chat/' + id);
   await page.waitForFunction(id => tb?.key === id && document.querySelector('#box'), {}, id);
   assert.equal(await page.evaluate(() => tb.prefs.model), 'default', 'repair an already affected session');
   assert.equal(await page.evaluate(() => turnOpts().model), undefined);
  }
  await page.evaluate(() => { tb.prefs.model = 'custom-model-not-in-menu'; renderToolbar(); });
  assert.equal(await page.$eval('#c-model', element => element.textContent), 'custom-model-not-in-menu');
  assert.equal(await page.evaluate(() => turnOpts().model), 'custom-model-not-in-menu');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'model-selection-scans.json'), JSON.stringify(scans, null, 2));
  console.log('Model selection: agent switches, saved picks, session repair, explicit Sol/Astra, full model list, request payloads and accessibility pass.');
 } finally {
  await context.close();
 }
}
