// 1.83 The / picker: typing / lists Pocket's actions, the Claude Code commands this CLI reports and the skills, grouped,
// with the best match selected; arrow keys, Enter, Tab and Escape on a computer, a tap on a phone. Commands that need
// nothing more are sent when picked; the rest are typed in. New conversation offers it too. Runs against browser.mjs.
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
export async function runSlashRegressions({browser,base,rows,received,out}) {
 const context=await browser.createBrowserContext(),page=await context.newPage();page.setDefaultTimeout(8000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 const id=rows.find(r=>r.state.kind==='finished'&&r.provider!=='codex').id,cx=rows.find(r=>r.provider==='codex').id;
 const scan=async name=>{const s=await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});await s.evaluate(e=>e.remove());const r=await page.evaluate(()=>axe.run('.composerwrap',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));assert.deepEqual(r.violations.map(v=>v.id+': '+v.nodes.map(n=>n.target.join(' ')).join(', ')),[],'axe '+name);};
 // POCKET_DESIGN_SCANNER: the impeccable detector on the open picker; findings inside it are written out
 const design=async name=>{if(!process.env.POCKET_DESIGN_SCANNER||!out)return;await page.evaluate(()=>{window.__IMPECCABLE_CONFIG__={autoScan:false};});if(!await page.evaluate(()=>Boolean(window.impeccableDetectAsync))){const t=await page.addScriptTag({path:process.env.POCKET_DESIGN_SCANNER});await t.evaluate(e=>e.remove());}const r=await page.evaluate(()=>window.impeccableDetectAsync({scrollOffscreen:false}));const fs=await import('node:fs');fs.writeFileSync(path.join(out,'slash-design-'+name+'.json'),JSON.stringify(r,null,1));};
 const groups=()=>page.$$eval('#slash .slash-h',es=>es.map(e=>e.textContent));
 const names=()=>page.$$eval('#slash [role=option]',es=>es.map(e=>e.dataset.n));
 const selected=()=>page.$eval('#slash [aria-selected="true"]',e=>e.dataset.n);
 const clear=()=>page.$eval('#box',e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));});
 // Typing can be swallowed while the composer finishes re-rendering (e.g. right after a send); re-type
 // until the picker shows the expected option rather than racing a single keystroke against the re-render.
 // Set the text in one step (focus, value, input event) rather than key by key: the composer can re-render while a
 // reply the page is tracking settles, and keystrokes typed into the old box are lost. Re-set until the picker shows
 // the option; if it never does, say what the page looked like so a CI failure explains itself.
 const typeUntil=async(text,dataN)=>{for(let i=0;i<4;i++){await page.$eval('#box',(e,v)=>{e.focus();e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));},text);try{await page.waitForSelector(`#slash:not([hidden]) [data-n="${dataN}"]`,{timeout:3000});return;}catch{}}
  const seen=await page.evaluate(()=>({box:document.querySelector('#box')?.value,disabled:document.querySelector('#box')?.disabled,slashHidden:document.querySelector('#slash')?.hidden,options:[...document.querySelectorAll('#slash [data-n]')].map(e=>e.dataset.n),focus:document.activeElement?.id||document.activeElement?.tagName}));
  throw new Error(`/${dataN} never offered for "${text}": ${JSON.stringify(seen)}`);};
 try{
  console.log('Slash picker: / on a computer');
  await page.setViewport({width:1440,height:900});
  await page.goto(base+'/?slash=1440#/chat/'+id);await page.waitForSelector('#msgs .m-asst');
  assert.match(await page.$eval('#box',e=>e.placeholder),/\/ for commands/,'the box says / is there');
  await page.type('#box','/');await page.waitForSelector('#slash:not([hidden]) [data-n="inventory-report"]');
  assert.deepEqual(await groups(),['Claude Code','Pocket','Skills']);
  const all=await names();
  for(const n of ['btw','branch','new','model','effort','usage','compact','context','recap','init','code-review','inventory-report'])assert.ok(all.includes(n),n+' is offered');
  assert.ok(!all.includes('security-review')&&!all.includes('mcp'),'a built-in this CLI did not report is left out');
  assert.equal(await page.$eval('#box',e=>e.getAttribute('aria-activedescendant')),await page.$eval('#slash [aria-selected="true"]',e=>e.id));
  await scan('picker-1440');if(out)await page.screenshot({path:path.join(out,'slash-1440.png')});await design('1440');
  await page.type('#box','co');
  assert.deepEqual(await names(),['compact','context','code-review'],'names that match, not descriptions that mention it');
  assert.equal(await selected(),'compact');
  await page.keyboard.press('ArrowDown');assert.equal(await selected(),'context');
  await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowUp');assert.equal(await selected(),'code-review','wraps around');
  await page.type('#box','nt');assert.deepEqual(await names(),['context'],'narrows as you type');
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('#slash',e=>e.hidden),true,'Escape closes it');assert.equal(await page.$eval('#box',e=>e.value),'/cont','and keeps the text');
  await clear();await page.type('#box','/comp');await page.keyboard.press('Tab');
  assert.equal(await page.$eval('#box',e=>e.value),'/compact ','a command that takes more is typed in');
  assert.equal(await page.$eval('#slash',e=>e.hidden),true);
  await clear();await page.type('#box','/inv');await page.keyboard.press('Enter');
  assert.equal(await page.$eval('#box',e=>e.value),'/inventory-report ','Enter picks a skill rather than sending /inv');
  const sent=received.length;
  await clear();await page.type('#box','/context');await page.keyboard.press('Enter');
  for(let i=0;i<80&&received.length===sent;i++)await new Promise(r=>setTimeout(r,50));
  await page.waitForFunction(()=>[...document.querySelectorAll('#msgs .m-user')].some(e=>e.textContent.includes('/context')));
  assert.equal(received.at(-1).text,'/context','a command that needs nothing more is sent at once');
  // a fresh page: the send above re-renders the composer (it starts a reply), which can swallow the next typing
  await page.goto(base+'/?slash=usage#/chat/'+id);await page.waitForSelector('#msgs .m-asst');await page.waitForSelector('#box:not([disabled])');
  await typeUntil('/usa','usage');await page.keyboard.press('Enter');
  await page.waitForSelector('.usage-sheet');assert.equal(await page.$eval('#box',e=>e.value),'','a Pocket action runs here and sends nothing');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.usage-sheet'));
  await clear();await page.type('#box','/stock');assert.deepEqual(await names(),['inventory-report'],'with no name match, descriptions are searched');
  await clear();await page.type('#box','/zzz');assert.equal(await page.$eval('#slash',e=>e.hidden),true,'no match, no list');
  await clear();await page.type('#box','/inventory-report check');assert.equal(await page.$eval('#slash',e=>e.hidden),true,'gone once the message goes on');
  await clear();

  console.log('Slash picker: a tap on a phone');
  await page.setViewport({width:390,height:844});
  await page.goto(base+'/?slash=390#/chat/'+id);await page.waitForSelector('#msgs .m-asst');
  await page.type('#box','/');await page.waitForSelector('#slash:not([hidden]) [data-n="inventory-report"]');if(out)await page.screenshot({path:path.join(out,'slash-390.png')});await design('390');
  const box=await page.$eval('#slash [data-n="effort"]',e=>{const r=e.getBoundingClientRect();return {h:r.height,w:r.width};});
  assert.ok(box.h>=44&&box.w>=300,'a full-width target at least 44px tall: '+JSON.stringify(box));
  await page.tap('#slash [data-n="effort"]');
  await page.waitForFunction(()=>/Reasoning effort/.test(document.querySelector('.sheet h2')?.textContent||''));
  assert.equal(await page.$eval('#box',e=>e.value),'','/effort opens the effort choice');
  await page.keyboard.press('Escape');
  await scan('picker-390');

  console.log('Slash picker: Codex and New conversation');
  await page.setViewport({width:1440,height:900});
  await page.goto(base+'/?slash=cx#/chat/'+cx);await page.waitForSelector('#box');
  await page.type('#box','/');await page.waitForSelector('#slash:not([hidden]) [data-n="inventory-report"]');
  // 1.87: Codex has its own counterparts of Claude Code's commands (run as Codex's own turns), not Claude's
  assert.deepEqual(await groups(),['Codex','Pocket','Skills'],'Codex commands in a Codex conversation');
  for(const n of ['compact','review','recap','context'])assert.ok((await names()).includes(n),n+' is offered on Codex');
  assert.ok(!(await names()).includes('init'),'a Claude-only command is not');
  await page.type('#box','inv');await page.keyboard.press('Enter');
  assert.equal(await page.$eval('#box',e=>e.value),'Use the $inventory-report skill. ','a Codex skill is typed as its skill line');
  await page.$eval('#box',e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.goto(base+'/?slash=new#/new');await page.waitForSelector('#first');
  await page.evaluate(()=>{const r=document.querySelector('#apick [data-a="claude"]');r?.click();});
  await page.type('#first','/');await page.waitForSelector('#slash:not([hidden]) [role=option]');
  await page.waitForSelector('#slash [data-n="inventory-report"]'); // skills fill in once the folder's list arrives
  const fresh=await names();
  assert.ok(fresh.includes('init')&&fresh.includes('inventory-report')&&fresh.includes('model'),'New offers /init, skills and the model choice');
  assert.ok(!fresh.includes('compact')&&!fresh.includes('btw')&&!fresh.includes('context'),'but nothing that needs a conversation');
  await page.type('#first','init');await page.keyboard.press('Enter');
  assert.equal(await page.$eval('#first',e=>e.value),'/init ','picked in New it is typed in, not started');
  await page.$eval('#first',e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.deepEqual(errors,[]);
 } finally { await context.close(); }
}
