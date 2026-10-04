import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {collectResults,reference} from '../results.mjs';import {FollowupQueue} from '../queue.mjs';
test('results index assistant references, deduplicates and ignores user/tool HTML injection',()=>{
 const m=[{role:'user',text:'[private](https://example.com/private)'},{role:'assistant',blocks:[{t:'text',text:'[Inventory](https://example.com/report)\n[CSV](/home/test/reports/stock.csv)\n[bad](javascript:alert(1))\n[env](/home/test/.env)\n[hidden](/home/test/.config/token.json)\n\n`/home/test/reports/summary.pdf`'}]},{role:'assistant',blocks:[{t:'text',text:'[Latest inventory](https://example.com/report)'}]}];
 const {results}=collectResults(m);assert.equal(results.length,3);assert.equal(results[0].label,'Latest inventory');assert.equal(results.filter(r=>r.kind==='file').length,2);assert.equal(reference('//evil.com'),null);assert.equal(reference('https://user:pass@example.com'),null);
});
const make=t=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-queue-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));const file=path.join(d,'queue.json');return {file,q:new FollowupQueue(file)}};
test('queue survives restart; edits use revisions and stale removal cannot delete changed work',t=>{
 const {q,file}=make(t);const r=q.add('s',{text:'first'});q.edit('s',r.id,1,'edited');assert.throws(()=>q.remove('s',r.id,1),/changed|changing/);assert.equal(new FollowupQueue(file).list('s')[0].text,'edited');q.remove('s',r.id,2);assert.deepEqual(q.list('s'),[]);
});
test('queue dispatch claims before action; concurrent starts dispatch once',async t=>{
 const {q}=make(t);q.add('s',{text:'next'});let calls=0;let release;const gate=new Promise(r=>release=r);
 const a=q.dispatch('s',async()=>{calls++;await gate;return 'started'});const b=await q.dispatch('s',()=>assert.fail('duplicate'));assert.equal(b,null);release();assert.equal(await a,'started');assert.equal(calls,1);assert.deepEqual(q.list('s'),[]);
});
test('uncertain starts block the queue after restart; storage failure never dispatches',async t=>{
 const {q,file}=make(t);q.add('s',{text:'next'});await assert.rejects(q.dispatch('s',()=>{throw Error('interrupted')}));const restored=new FollowupQueue(file);assert.equal(restored.list('s')[0].status,'uncertain');assert.equal(await restored.dispatch('s',()=>assert.fail('ambiguous replay')),null);
 const row=restored.list('s')[0];restored.remove('s',row.id,row.revision);restored.add('s',{text:'new'});restored.save=()=>{throw Error('disk full')};await assert.rejects(restored.dispatch('s',()=>assert.fail('no storage, no dispatch')));
});

test('editing a queued instruction pauses dispatch and survives restart until saved',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-edit-'));const file=path.join(dir,'queue.json');
 try{
  let queue=new FollowupQueue(file);const row=queue.add('session',{text:'Original'});const editing=queue.beginEdit('session',row.id,1);
  let ran=0;assert.equal(await queue.dispatch('session',()=>{ran++;}),null);assert.equal(ran,0);
  queue=new FollowupQueue(file);assert.equal(queue.list('session')[0].status,'editing');
  assert.throws(()=>queue.edit('session',row.id,1,'Stale'),{status:409});
  queue.edit('session',row.id,editing.revision,'Saved');await queue.dispatch('session',r=>{assert.equal(r.text,'Saved');ran++;});assert.equal(ran,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
