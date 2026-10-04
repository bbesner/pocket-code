import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
// A live instance's settings (inherited when run from a Pocket turn) must not leak into fixtures.
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID)_/.test(k)));

test('HTTP delivery, running state, completion and receipt recovery',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-api-')),port=18361;
 const secret=randomUUID(),exp=Date.now()+3600000;
 const cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
 const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
 let child,logs='';
 const start=async()=>{
  child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_ALLOW_FULL_ACCESS:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs')},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
  for(let i=0;i<100;i++){try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
  throw Error('Test server failed: '+logs);
 };
 const stop=async()=>{if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}};
 t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true});});
 const call=async(p,body,method)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:method||(body?'POST':'GET'),headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()}};
 const calls=()=>fs.existsSync(path.join(dir,'calls'))?fs.readFileSync(path.join(dir,'calls'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 fs.mkdirSync(path.join(dir,'sessions','test-workspace'),{recursive:true});
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
 assert.equal((await call(`/session/${id}`)).body.ext,false,'owned transcript writes are not external activity');
 fs.appendFileSync(path.join(dir,'sessions','test-workspace',id+'.jsonl'),JSON.stringify({type:'user',message:{role:'user',content:'External surface update'},timestamp:new Date(Date.now()-120000).toISOString()})+'\n');
 await sleep(100);assert.equal((await call(`/session/${id}`)).body.ext,true,'new external writes remain visible');
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
 // Saved follow-ups can be edited, paused by stop, and recovered after restart.
 const slow=await call('/new',{cwd:repo,text:'__SLOW__ queue test',clientMessageId:randomUUID()});
 const sid=slow.body.id;await sleep(250);
 const queuedBody={text:'Original follow-up',mode:'queue',clientMessageId:randomUUID()};
 const q1=await call(`/session/${sid}/message`,queuedBody);assert.equal(q1.body.queued,true);
 await call(`/session/${sid}/message`,queuedBody);
 let q=(await call(`/session/${sid}/queue`)).body.items;assert.equal(q.length,1);
 const qid=q[0].id;
 assert.equal((await call(`/session/${sid}/queue/${qid}`,{text:'Edited follow-up',revision:1},'PATCH')).status,200);
 assert.equal((await call(`/session/${sid}/queue/${qid}`,{text:'Stale overwrite',revision:1},'PATCH')).status,409);
 await call(`/session/${sid}/message`,{text:'Remove this',mode:'queue',clientMessageId:randomUUID()});
 q=(await call(`/session/${sid}/queue`)).body.items;assert.equal(q.length,2);
 await call(`/session/${sid}/queue/${q[1].id}`,{revision:q[1].revision},'DELETE');
 await call(`/session/${sid}/stop`,{});await sleep(300);await stop();await start();
 q=(await call(`/session/${sid}/queue`)).body.items;assert.equal(q.length,1);assert.equal(q[0].text,'Edited follow-up');assert.equal(q[0].approvalMode,'review');
 const started=await call(`/session/${sid}/queue/start`,{itemId:qid});assert.equal(started.status,200);assert.equal(started.body.started,true);
 await sleep(800);assert.equal((await call(`/session/${sid}/queue`)).body.items.length,0);
 assert.equal(calls().filter(x=>x.text==='Edited follow-up').length,1);assert.equal(calls().find(x=>x.text==='Edited follow-up').permissionMode,'default');
 assert.equal((await call(`/session/${sid}/queue/start`,{itemId:qid})).status,409);
 // Native Claude questions remain answerable after browser reconnect and fail
 // explicitly after a daemon restart severs the provider input connection.
 const question=await call('/new',{cwd:repo,text:'__QUESTION__',clientMessageId:randomUUID()});
 const qsid=question.body.id;let inbox;
 for(let i=0;i<40;i++){inbox=(await call(`/session/${qsid}/questions`)).body;if(inbox.requests.length)break;await sleep(50);}
 assert.equal(inbox.requests.length,1);assert.equal((await call(`/session/${qsid}`)).body.state.kind,'input');
 const requestId=inbox.requests[0].id;
 assert.equal((await call(`/session/${qsid}/questions/${requestId}/answer`,{answers:{}})).status,400);
 const answers={'question-0':['Blue']};assert.equal((await call(`/session/${qsid}/questions/${requestId}/answer`,{answers})).status,200);
 assert.equal((await call(`/session/${qsid}/questions/${requestId}/answer`,{answers})).body.duplicate,true);
 await sleep(600);assert.equal((await call(`/session/${qsid}`)).body.state.kind,'finished');
 const interrupted=await call('/new',{cwd:repo,text:'__QUESTION__ restart',clientMessageId:randomUUID()});
 const iid=interrupted.body.id;
 for(let i=0;i<40;i++){if((await call(`/session/${iid}/questions`)).body.requests.length)break;await sleep(50);}
 await stop();await start();assert.equal((await call(`/session/${iid}/questions`)).body.interrupted,true);
 assert.equal((await call(`/session/${iid}`)).body.state.kind,'input');
 assert.equal((await call(`/session/${iid}/questions/stale/answer`,{answers})).status,409);
 await call(`/session/${iid}/stop`,{});await sleep(1300);assert.equal((await call(`/session/${iid}`)).body.active,false);
 assert.equal((await fetch(`http://127.0.0.1:${port}/api/environment`)).status,401);
 assert.equal((await fetch(`http://127.0.0.1:${port}/api/session/${sid}/workspace`)).status,401);
 // Pending actions wait for explicit, session-bound decisions and are never replayed.
 const awaitApproval=async id=>{for(let i=0;i<60;i++){const d=(await call(`/session/${id}/approvals`)).body;if(d.requests.length)return d.requests[0];await sleep(50);}throw Error('Missing approval');};
 const held=await call('/new',{cwd:repo,text:'__APPROVAL__ allow',approvalMode:'review',clientMessageId:randomUUID()});const aid=held.body.id;
 const action=await awaitApproval(aid);assert.equal(fs.existsSync(path.join(dir,'calls.approved')),false);
 assert.equal(calls().find(r=>r.id===aid).permissionMode,'default');
 assert.equal((await call(`/session/${aid}`)).body.state.label,'Needs approval');
 assert.equal((await call(`/session/${sid}/approvals/${action.id}/decision`,{decision:'allow'})).status,409);
 assert.equal((await call(`/session/${aid}/approvals/${action.id}/decision`,{decision:'allow'})).status,200);
 assert.equal((await call(`/session/${aid}/approvals/${action.id}/decision`,{decision:'allow'})).body.duplicate,true);
 await sleep(600);assert.equal(fs.readFileSync(path.join(dir,'calls.approved'),'utf8').trim(),aid);
 const denied=await call('/new',{cwd:repo,text:'__APPROVAL__ deny',clientMessageId:randomUUID()});const deniedAction=await awaitApproval(denied.body.id);
 assert.equal((await call(`/session/${denied.body.id}/approvals/${deniedAction.id}/decision`,{decision:'deny'})).status,200);
 await sleep(600);assert.equal(fs.readFileSync(path.join(dir,'calls.approved'),'utf8').trim(),aid);
 const interruptedApproval=await call('/new',{cwd:repo,text:'__APPROVAL__ restart',clientMessageId:randomUUID()});const rid=interruptedApproval.body.id,staleAction=await awaitApproval(rid);
 await stop();await start();assert.equal((await call(`/session/${rid}/approvals`)).body.interrupted,true);
 assert.equal((await call(`/session/${rid}/approvals/${staleAction.id}/decision`,{decision:'allow'})).status,409);
 await call(`/session/${rid}/stop`,{});await sleep(1300);
 assert.equal(fs.readFileSync(path.join(dir,'calls.approved'),'utf8').trim(),aid);
 const audit=fs.readFileSync(path.join(dir,'data','approval-decisions.jsonl'),'utf8');assert.equal(audit.includes('fixture-only-secret'),false);assert.match(audit,/"decision":"deny"/);
 assert.equal((await fetch(`http://127.0.0.1:${port}/api/session/${aid}/approvals`)).status,401);
 assert.equal((await call('/new',{cwd:repo,text:'bad policy',approvalMode:'anything'})).status,400);
 assert.equal((await call('/new',{cwd:repo,text:'forbidden full access',approvalMode:'full'})).status,403);
 assert.equal((await call('/approval-policy')).body.allowFullAccess,false);
 // Linked report downloads are authenticated, session-bound and non-executable.
 const artifacts=fs.mkdtempSync(path.join(os.homedir(),'pocket-artifact-test-'));
 t.after(()=>fs.rmSync(artifacts,{recursive:true,force:true}));
 const html=path.join(artifacts,'report.html'),csv=path.join(artifacts,'stock.csv'),hidden=path.join(artifacts,'.private');
 fs.writeFileSync(html,'<script>danger()</script>');fs.writeFileSync(csv,'sku,count\nA,2');fs.mkdirSync(hidden);fs.writeFileSync(path.join(hidden,'secret.txt'),'not a report');
 const link=path.join(artifacts,'alias.txt');fs.symlinkSync(path.join(hidden,'secret.txt'),link);
 const transcript=path.join(dir,'sessions','test-workspace',sid+'.jsonl');
 fs.appendFileSync(transcript,JSON.stringify({type:'assistant',message:{content:[{type:'text',text:`[Report](${html}) [Stock](${csv}) [Alias](${link})`}]},timestamp:new Date().toISOString()})+'\n');
 const results=await call(`/session/${sid}/results`);assert.equal(results.status,200);assert.equal(results.body.results.filter(r=>r.kind==='file').length,3);
 const url=`http://127.0.0.1:${port}/api/session/${sid}/artifact?path=`;
 const download=await fetch(url+encodeURIComponent(html),{headers});assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/^attachment/);assert.match(download.headers.get('content-security-policy'),/sandbox/);
 assert.equal((await fetch(url+encodeURIComponent(csv))).status,401);
 assert.equal((await fetch(url+encodeURIComponent(link),{headers})).status,403);
 assert.equal((await fetch(url+encodeURIComponent(path.join(artifacts,'unknown.csv')),{headers})).status,403);

});
