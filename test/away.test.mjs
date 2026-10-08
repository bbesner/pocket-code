// 1.21 While you were away: digest, summary cleanup, Codex turn times and the /away endpoint. Fake CLIs only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {awayDigest,awayWorthSummary,cleanSummary} from '../titles.mjs';
import {uuid7Time} from '../codex.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));

test('digest groups tool calls, clips long text and keeps the start and the end of a long span',()=>{
  const {digest,stats}=awayDigest([{role:'user',text:'Fix the login bug'},{role:'assistant',blocks:[{t:'tool',name:'Bash',detail:'npm test'},{t:'tool',name:'Edit',detail:'app.js'},{t:'tool',name:'Bash',detail:'npm test'},{t:'text',text:'Fixed it.'},{t:'choices',options:['Deploy','Wait']}]}]);
  assert.equal(digest,'Owner: Fix the login bug\nTools: Bash x2, Edit (last: Bash npm test)\nAgent: Fixed it.\nAgent asked the owner to choose: Deploy / Wait');
  assert.deepEqual(stats,{assistant:1,tools:3,chars:9});assert.equal(awayWorthSummary(stats),true);
  assert.equal(awayWorthSummary({assistant:1,tools:1,chars:40}),false,'a short exchange gets the divider only');
  assert.equal(awayWorthSummary({assistant:0,tools:0,chars:0}),false);
  const long=awayDigest(Array.from({length:60},(_,i)=>({role:'assistant',blocks:[{t:'text',text:'Step '+i+' '+'x'.repeat(300)}]}))).digest;
  assert.ok(long.length<7100&&long.startsWith('Agent: Step 0')&&long.includes('Step 59')&&long.includes('\n…\n'));
});

test('cleanSummary keeps up to four plain lines and rejects refusals',()=>{
  assert.equal(cleanSummary('## Summary\n- **Fixed** the login bug\n- Tests pass\n\n1. Waiting on you: deploy?'),'Summary\nFixed the login bug\nTests pass\nWaiting on you: deploy?');
  assert.equal(cleanSummary('a\nb\nc\nd\ne').split('\n').length,4);
  assert.equal(cleanSummary("Sorry, I can't help with that"),null);
  assert.ok(cleanSummary('x '.repeat(200)).length<=221);
});

test('Codex turn ids (UUIDv7) give the turn time; other ids give none',()=>{
  assert.equal(uuid7Time('01a11678-bcdb-7f20-a777-43dd5bbe9822'),new Date(parseInt('01a11678bcdb',16)).toISOString());
  assert.equal(uuid7Time('11111111-1111-4111-8111-111111111111'),undefined);
  assert.equal(uuid7Time(undefined),undefined);
});

test('HTTP: /away summarizes only new work, honours the setting and follows the chosen model',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-away-'));let port=18691,logs='';
  const secret=randomUUID(),exp=Date.now()+3600000;
  const headers={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
  const ws=path.join(dir,'sessions','test-workspace');fs.mkdirSync(ws,{recursive:true});
  const id=randomUUID(),base=Date.now()-3600000,at=m=>new Date(base+m*60000).toISOString();
  const line=(o,m)=>JSON.stringify({...o,cwd:repo,sessionId:id,timestamp:at(m)});
  fs.writeFileSync(path.join(ws,id+'.jsonl'),[
    line({type:'user',message:{role:'user',content:'Check the camera firmware versions'}},0),
    line({type:'assistant',message:{role:'assistant',content:[{type:'text',text:'Starting.'}]}},1),
    line({type:'user',message:{role:'user',content:'Then update the two that are behind'}},10),
    line({type:'assistant',message:{role:'assistant',content:[{type:'tool_use',id:'a',name:'Bash',input:{command:'ping cam1'}},{type:'tool_use',id:'b',name:'Bash',input:{command:'ping cam2'}},{type:'tool_use',id:'c',name:'Edit',input:{file_path:'/x/fw.txt'}},{type:'text',text:'Updated both cameras to 5.2.1.'}]}},12),
  ].join('\n')+'\n');
  const child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,
    POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),
    CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),CODEX_BIN:path.join(repo,'test/fake-codex.mjs')},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
  t.after(async()=>{if(child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}fs.rmSync(dir,{recursive:true,force:true});});
  for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)break;}catch{} await sleep(30);}
  const call=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
  const calls=()=>fs.existsSync(path.join(dir,'calls.away'))?fs.readFileSync(path.join(dir,'calls.away'),'utf8').trim().split('\n').filter(Boolean):[];

  const s=await call(`/session/${id}/away`,{since:base+5*60000});
  assert.equal(s.status,200);assert.equal(s.body.provider,'claude');assert.equal(s.body.model,'claude-haiku-test');
  assert.equal(s.body.summary,'Worked on: Then update the two that are behind\nNothing is waiting on you.');
  assert.equal(calls().length,1);assert.match(calls()[0],/^Owner: Then update the two that are behind \| Tools: Bash x2, Edit/,'only the messages after since');
  assert.equal((await call(`/session/${id}/away`,{since:base+5*60000})).body.summary,s.body.summary);assert.equal(calls().length,1,'cached');
  assert.equal((await call(`/session/${id}/away`,{since:base+11*60000})).body.summary,'Worked on: Tools: Bash x2, Edit (last: Edit /x/fw.t\nNothing is waiting on you.');
  assert.equal((await call(`/session/${id}/away`,{since:base+13*60000})).body.reason,'short','nothing new');
  assert.equal((await call(`/session/${id}/away`,{since:-1})).status,400);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/session/${id}/away`,{method:'POST',headers:{'content-type':'application/json'},body:'{"since":1}'})).status,401);
  // Codex as the helper model.
  assert.equal((await call('/settings',{titleProvider:'codex'})).body.titles.helper,'codex');
  assert.match((await call(`/session/${id}/away`,{since:base+5*60000})).body.summary,/^Codex summary: Owner: Then update/);
  // Off: no call.
  const n=calls().length;
  assert.equal((await call('/settings',{awaySummaries:false})).body.titles.awaySummaries,false);
  assert.equal((await call(`/session/${id}/away`,{since:base+5*60000})).body.reason,'off');assert.equal(calls().length,n);
});
