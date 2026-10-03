import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');

test('HTTP delivery, running state, completion and receipt recovery',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-api-')),port=18361;
 const secret=randomUUID(),exp=Date.now()+3600000;
 const cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
 const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
 let child,logs='';
 const start=async()=>{
  child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...process.env,PORT:String(port),POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs')},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
  for(let i=0;i<100;i++){try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
  throw Error('Test server failed: '+logs);
 };
 const stop=async()=>{if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}};
 t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true});});
 const call=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()}};
 const calls=()=>fs.existsSync(path.join(dir,'calls'))?fs.readFileSync(path.join(dir,'calls'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 await start();
 for (const asset of ['/', '/sw.js']) {
  const response=await fetch(`http://127.0.0.1:${port}${asset}`);
  assert.equal(response.headers.get('cache-control'),'no-cache');
 }
 const request={cwd:repo,text:'__SLOW__ Inventory report',provider:'claude',clientMessageId:randomUUID()};
 const [a,b]=await Promise.all([call('/new',request),call('/new',request)]);
 assert.equal(a.status,202);assert.equal(a.body.id,b.body.id);
 const id=a.body.id;
 const list=await call('/sessions?limit=1');
 assert.equal(list.body.sessions.find(s=>s.id===id).state.kind,'running');
 await sleep(2400);
 assert.equal(calls().length,1);
 const finished=await call('/sessions');
 assert.equal(finished.body.sessions.find(s=>s.id===id).state.kind,'finished');
 const msg={text:'Follow-up with attachment metadata',clientMessageId:randomUUID()};
 const m=await call(`/session/${id}/message`,msg);assert.equal(m.status,202);
 await sleep(800);
 assert.equal(calls().length,2);
 await stop();await start();
 const retry=await call(`/session/${id}/message`,msg);assert.equal(retry.status,202);
 await sleep(100);assert.equal(calls().length,2,'receipt survives restart without another CLI turn');
 const conflict=await call(`/session/${id}/message`,{...msg,text:'changed'});assert.equal(conflict.status,409);
 const failed=await call(`/session/${id}/message`,{text:'__FAIL__',clientMessageId:randomUUID()});assert.equal(failed.status,202);
 await sleep(800);
 assert.equal((await call('/sessions')).body.sessions.find(s=>s.id===id).state.kind,'failed');
});
