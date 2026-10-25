// 1.78 Side chat: the forked, unsaved, read-only aside next to a Claude conversation. Fake CLI only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {sideChatArgs,SIDE_TOOLS} from '../sidechat.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const flag=(args,f)=>args[args.indexOf(f)+1];

test('side chat arguments: forked, unsaved, read-only, no MCP, no hooks, capped',()=>{
  const args=sideChatArgs({parentId:'p-1',model:'opus',budgetUsd:3});
  for(const f of ['--fork-session','--no-session-persistence','--strict-mcp-config'])assert.ok(args.includes(f),f);
  assert.equal(flag(args,'--resume'),'p-1');assert.equal(flag(args,'--model'),'opus');assert.equal(flag(args,'--max-budget-usd'),'3');
  assert.equal(flag(args,'--permission-mode'),'default');
  assert.deepEqual(flag(args,'--tools').split(','),SIDE_TOOLS);
  for(const t of ['Bash','Edit','Write','NotebookEdit','Agent','Task','WebFetch'])assert.equal(SIDE_TOOLS.includes(t),false,t);
  assert.deepEqual(JSON.parse(flag(args,'--settings')),{disableAllHooks:true});
  assert.equal(args.includes('--permission-prompt-tool'),false,'nothing to approve: anything else is unavailable');
  const bare=sideChatArgs({parentId:'p-2'});assert.equal(bare.includes('--model'),false);assert.equal(bare.includes('--max-budget-usd'),false);
});

test('HTTP: a side chat answers from the conversation without touching it',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-side-'));let port=18771,logs='';
  const secret=randomUUID(),exp=Date.now()+3600000;
  const headers={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
  const ws=path.join(dir,'sessions','test-workspace');fs.mkdirSync(ws,{recursive:true});
  const id=randomUUID(),file=path.join(ws,id+'.jsonl');
  const line=o=>JSON.stringify({...o,cwd:repo,sessionId:id,timestamp:new Date().toISOString()});
  fs.writeFileSync(file,[line({type:'user',message:{role:'user',content:'Plan the camera upgrade'}}),line({type:'assistant',message:{role:'assistant',content:[{type:'text',text:'Here is the plan.'}]}})].join('\n')+'\n');
  const before=fs.readFileSync(file);
  const child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),POCKET_SKILLS:'0',PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',
    POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),POCKET_SIDE_CHAT_BUDGET_USD:'2.5',
    CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs')},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
  t.after(async()=>{if(child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}await sleep(200);fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});});
  for(let i=0;i<150;i++){if(child.exitCode!==null)break;try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)break;}catch{} await sleep(30);}
  const call=async(p,body,method)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:method||(body?'POST':'GET'),headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};};
  const sideCalls=()=>fs.existsSync(path.join(dir,'calls.side'))?fs.readFileSync(path.join(dir,'calls.side'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
  // Reads the side chat's event stream from `from` until `until` matches an event (or the stream ends).
  const events=async(side,until,from=0)=>{
    const ac=new AbortController(),seen=[];const timer=setTimeout(()=>ac.abort(),5000);
    try{
      const r=await fetch(`http://127.0.0.1:${port}/api/side/${side}/events?from=${from}`,{headers,signal:ac.signal});
      if(r.status!==200)return {status:r.status,seen};
      const reader=r.body.getReader(),dec=new TextDecoder();let buf='';
      for(;;){const {value,done}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});
        let i;while((i=buf.indexOf('\n\n'))>=0){const chunk=buf.slice(0,i);buf=buf.slice(i+2);const d=chunk.split('\n').find(l=>l.startsWith('data: '));if(!d)continue;const ev=JSON.parse(d.slice(6));seen.push(ev);if(until(ev,seen)){ac.abort();return {status:200,seen};}}}
      return {status:200,seen};
    }catch(e){if(e.name==='AbortError')return {status:200,seen};throw e;}finally{clearTimeout(timer);}
  };
  const results=seen=>seen.filter(e=>e.type==='result');

  assert.equal((await fetch(`http://127.0.0.1:${port}/api/session/${id}/side`,{method:'POST',headers:{'content-type':'application/json'},body:'{"text":"hi"}'})).status,401);
  assert.equal((await call(`/session/cx:${randomUUID()}/side`,{text:'hi'})).status,400,'Codex: not yet');
  const none=await call(`/session/${randomUUID()}/side`,{text:'hi'});
  assert.equal(none.status,409);assert.match(none.body.error,/Send a message in the conversation first/);
  assert.equal((await call(`/session/${id}/side`,{text:'  '})).status,400);
  assert.equal((await call(`/session/${id}/side`,{text:'Use sk-proj-abcDEF1234567890abcdefXYZ here'})).body.code,'secret_detected','the secret guard covers side chats');
  assert.deepEqual((await call(`/session/${id}/side`)).body,{enabled:true,chat:null});

  // First question: starts the forked process in the conversation's folder, streams the answer.
  const first=await call(`/session/${id}/side`,{text:'Why this plan?'});
  assert.equal(first.status,202);assert.ok(first.body.side);const side=first.body.side;
  let ev=await events(side,e=>e.type==='result');
  assert.deepEqual(ev.seen.map(e=>e.type),['user','delta','assistant','result']);
  assert.equal(ev.seen[2].msg.blocks[0].text,'Side answer 1: Why this plan?');
  assert.equal(results(ev.seen)[0].ok,true);assert.equal(results(ev.seen)[0].cost,0.25);assert.equal(results(ev.seen)[0].total,0.25);
  const [spawned]=sideCalls();
  assert.equal(spawned.parent,id);assert.equal(fs.realpathSync(spawned.cwd),fs.realpathSync(repo),'runs in the conversation\'s folder');
  for(const f of ['--fork-session','--no-session-persistence','--strict-mcp-config'])assert.ok(spawned.args.includes(f),f);
  assert.equal(flag(spawned.args,'--max-budget-usd'),'2.5');

  // A follow-up goes to the same process, which remembers the earlier turn; the total adds up.
  assert.equal((await call(`/session/${id}/side`,{text:'And the cost?',side})).status,202);
  ev=await events(side,(e,s)=>results(s).length===2);
  assert.equal(ev.seen.filter(e=>e.type==='assistant').at(-1).msg.blocks[0].text,'Side answer 2: And the cost?');
  assert.equal(results(ev.seen)[1].total,0.5);assert.equal(sideCalls().length,1,'one process for the whole side chat');
  assert.equal((await call(`/session/${id}/side`)).body.chat.side,side,'a reopened panel finds it again');

  // While it answers, a second question waits; Stop interrupts the answer and keeps the side chat.
  assert.equal((await call(`/session/${id}/side`,{text:'Long one __SIDEHANG__',side})).status,202);
  await sleep(150);
  assert.equal((await call(`/session/${id}/side`,{text:'Another',side})).status,409);
  assert.equal((await call(`/side/${side}/stop`,{})).status,200);
  ev=await events(side,(e,s)=>results(s).length===3);
  assert.equal(results(ev.seen)[2].error,'Stopped');
  assert.equal((await call(`/side/${side}/stop`,{})).status,404,'nothing running');
  assert.equal((await call(`/session/${id}/side`,{text:'Still there?',side})).status,202);
  ev=await events(side,(e,s)=>results(s).length===4);assert.equal(results(ev.seen)[3].ok,true);
  // A reconnect resumes after the last event it saw.
  const n=ev.seen.length;
  assert.equal((await call(`/session/${id}/side`,{text:'Over budget __SIDEBUDGET__',side})).status,202);
  ev=await events(side,e=>e.type==='result',n);
  assert.deepEqual(ev.seen.map(e=>e.type),['user','delta','assistant','result']);
  assert.match(ev.seen.at(-1).error,/spending cap/);

  // The conversation itself is untouched, and nothing new was saved.
  assert.deepEqual(fs.readFileSync(file),before);
  assert.deepEqual(fs.readdirSync(ws),[id+'.jsonl']);

  // Opening another side chat for the conversation replaces this one; closing ends it.
  const second=await call(`/session/${id}/side`,{text:'Fresh start'});
  assert.equal(second.status,202);assert.notEqual(second.body.side,side);
  ev=await events(side,e=>e.type==='closed');assert.equal(ev.seen.at(-1).why,'replaced');
  assert.equal((await call(`/session/${id}/side`,{text:'Old one?',side})).body.side!==side,true,'an ended side chat starts a new one');
  const live=(await call(`/session/${id}/side`)).body.chat.side;
  assert.equal((await call(`/side/${live}`,undefined,'DELETE')).status,200);
  ev=await events(live,e=>e.type==='closed');assert.equal(ev.seen.at(-1).why,'closed');
  assert.equal((await call(`/session/${id}/side`)).body.chat,null);
  assert.equal((await call(`/side/${randomUUID()}/events`)).status,404);
  assert.match(logs,/side chat start side=/);assert.match(logs,/side chat close side=.* why=closed/);
});
