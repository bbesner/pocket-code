import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID)_/.test(k)));

// One server fixture per test; env tunes the idle/stall timers down to test speed.
async function fixture(t,port,env={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-runner-'));
 const secret=randomUUID(),exp=Date.now()+3600000;
 const cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
 const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
 let child,logs='';
 const start=async()=>{
  child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),POCKET_SKILLS:'0',PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:process.env.TEST_AUTO_TITLES??'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),...env},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
  for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
  if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=41;logs='';return start();} // the port was taken: move, never talk to a foreign server
  throw Error('Test server failed: '+logs);
 };
 const stop=async()=>{if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}};
 const call=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()}};
 const calls=()=>fs.existsSync(path.join(dir,'calls'))?fs.readFileSync(path.join(dir,'calls'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 const health=async()=>(await call('/health')).body;
 const state=async id=>(await call('/sessions')).body.sessions.find(s=>s.id===id)?.state.kind;
 const until=async(fn,ms=5000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return true;await sleep(50)}return false;};
 const pids=()=>new Set(calls().map(c=>c.pid));
 const transcript=id=>{try{return fs.readFileSync(path.join(dir,'sessions','test-workspace',id+'.jsonl'),'utf8')}catch{return ''}};
 const killAll=()=>{for(const pid of pids()){try{process.kill(-pid,'SIGKILL')}catch{try{process.kill(pid,'SIGKILL')}catch{}}}};
 t.after(async()=>{await stop();killAll();fs.rmSync(dir,{recursive:true,force:true});});
 fs.mkdirSync(path.join(dir,'sessions','test-workspace'),{recursive:true});
 await start();
 return {dir,start,stop,call,calls,health,state,until,pids,transcript,headers,logs:()=>logs,get port(){return port;}};
}
const msg=text=>({text,clientMessageId:randomUUID()});

test('one process carries a session across turns; a model change starts a new one',async t=>{
 const f=await fixture(t,18391);
 const id=(await f.call('/new',{cwd:repo,...msg('first')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='finished'));
 assert.equal((await f.health()).processes,1,'process stays up after the turn');
 assert.equal((await f.call(`/session/${id}/message`,msg('second'))).status,202);
 assert.ok(await f.until(async()=>f.calls().length===2&&await f.state(id)==='finished'));
 assert.equal(f.pids().size,1,'second turn reused the same process');
 assert.equal((await f.call(`/session/${id}/message`,{...msg('third'),model:'claude-haiku-4-5'})).status,202);
 assert.ok(await f.until(async()=>f.calls().length===3&&await f.state(id)==='finished'));
 assert.equal(f.pids().size,2,'model change started a fresh process');
 assert.ok(await f.until(async()=>(await f.health()).processes===1),'the replaced process closed');
});

test('a turn the agent starts by itself (finished background job) is streamed and recorded',async t=>{
 const f=await fixture(t,18392,{POCKET_TEST_BG_MS:'1500'});
 const id=(await f.call('/new',{cwd:repo,...msg('__BG__ start a job')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='background')); // 1.64: the reply ended, the job runs
 // A viewer mirroring the idle session is told to reattach when the agent starts a turn.
 const viewer=await fetch(`http://127.0.0.1:18392/api/session/${id}/events`,{headers:f.headers});
 const reader=viewer.body.getReader();let seen='';
 const read=(async()=>{for(;;){const {value,done}=await reader.read();if(done)break;seen+=new TextDecoder().decode(value);}})();
 assert.ok(await f.until(()=>seen.includes('"type":"done"')),'mirror viewer told to resync');
 await read;
 assert.ok(await f.until(()=>f.transcript(id).includes('The background job finished.')));
 assert.ok(await f.until(()=>/turn start \(started by the agent\)/.test(f.logs())),'server picked up the self-started turn');
 assert.ok(await f.until(()=>(f.logs().match(/turn done session=/g)||[]).length===2),'and finished it');
 assert.equal(await f.state(id),'finished');
 assert.equal(f.pids().size,1);
});

test('a reply that leaves a background job running reads Working in background until the job is done',async t=>{
 const f=await fixture(t,18396,{POCKET_TEST_BG_MS:'2000'});
 const row=async id=>(await f.call('/sessions')).body.sessions.find(s=>s.id===id);
 const id=(await f.call('/new',{cwd:repo,...msg('__BG__ start a job')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='background'),'the ended reply shows background work, not Response ready');
 const st=(await row(id)).state;
 assert.equal(st.confirmed,true);assert.equal(st.label,'Working in background · 1 job');
 assert.deepEqual(st.background,{count:1,summary:'1 job',jobs:[{kind:'job',description:'sleep'}]});
 assert.equal((await f.call(`/session/${id}`)).body.state.kind,'background','the conversation reads the same state');
 assert.match(f.logs(),new RegExp(`notification held: 1 background job\\(s\\) still running session=${id}`),'no Done push while the job runs');
 assert.ok(await f.until(()=>/turn start \(started by the agent\)/.test(f.logs()),6000),'the agent reports the finished job');
 assert.ok(await f.until(async()=>await f.state(id)==='finished',6000),'then the session is Response ready');
 assert.equal((await row(id)).state.background,undefined);
 assert.equal((f.logs().match(/notification held/g)||[]).length,1,'the finishing turn is not held');
});

test('idle processes close after the idle time, but not while a background job runs',async t=>{
 const f=await fixture(t,18393,{POCKET_IDLE_CLOSE_MS:'1200'});
 const a=(await f.call('/new',{cwd:repo,...msg('quick')})).body.id;
 const b=(await f.call('/new',{cwd:repo,...msg('__BG_LONG__ long job')})).body.id;
 assert.ok(await f.until(async()=>await f.state(a)==='finished'&&await f.state(b)==='background'));
 assert.equal((await f.health()).processes,2);
 assert.ok(await f.until(async()=>(await f.health()).processes===1,4000),'idle session closed');
 await sleep(1500);
 assert.equal((await f.health()).processes,1,'session with a running background job stays open');
 assert.match(f.logs(),new RegExp(`closing session=${a}.*reason=idle`));
 // a message after the idle close resumes the session in a new process
 assert.equal((await f.call(`/session/${a}/message`,msg('back again'))).status,202);
 assert.ok(await f.until(async()=>f.calls().filter(c=>c.id===a).length===2&&await f.state(a)==='finished'));
 assert.equal(new Set(f.calls().filter(c=>c.id===a).map(c=>c.pid)).size,2);
});

test('stall watchdog stops a silent turn but never one waiting on a background job',async t=>{
 const f=await fixture(t,18394,{POCKET_STALL_MS:'1200'});
 const stuck=(await f.call('/new',{cwd:repo,...msg('__HANG__')})).body.id;
 const waiting=(await f.call('/new',{cwd:repo,...msg('__BGHANG__')})).body.id;
 assert.ok(await f.until(async()=>await f.state(stuck)==='failed',6000),'silent turn stopped');
 assert.match(f.logs(),new RegExp(`turn STALLED session=${stuck}`));
 assert.equal(await f.state(waiting),'running','turn waiting on a background job keeps running');
 assert.doesNotMatch(f.logs(),new RegExp(`STALLED session=${waiting}`));
});

test('a restart reattaches to the live process through its input pipe',async t=>{
 const f=await fixture(t,18395);
 const id=(await f.call('/new',{cwd:repo,...msg('__SLOW__ survive a restart')})).body.id;
 await f.until(()=>f.calls().length===1);
 await f.stop();await f.start();
 assert.equal((await f.health()).processes,1,'process adopted');
 assert.ok(await f.until(async()=>await f.state(id)==='finished',5000),'in-flight turn completed after restart');
 assert.equal((await f.call(`/session/${id}/message`,msg('after restart'))).status,202);
 assert.ok(await f.until(async()=>f.calls().length===2&&await f.state(id)==='finished'));
 assert.equal(f.pids().size,1,'the restarted server wrote into the same process');
});

// 1.73.2: a recursive search of the data directory opened a session's pipe and swallowed its
// approvals, messages and stops, so pipes live outside it; pre-1.73.2 runners are still adopted.
test('input pipes live outside the data directory; a pre-1.73.2 pipe in turnlogs is still adopted',async t=>{
 const pipes=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-pipes-'));t.after(()=>fs.rmSync(pipes,{recursive:true,force:true}));
 const f=await fixture(t,18398,{POCKET_PIPE_DIR:pipes});
 const turnlogs=path.join(f.dir,'data','turnlogs'),fifos=d=>{try{return fs.readdirSync(d).filter(n=>n.endsWith('.in.fifo'))}catch{return []}};
 const id=(await f.call('/new',{cwd:repo,...msg('first')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='finished'));
 assert.deepEqual(fifos(turnlogs),[],'no pipe in the data directory');
 const [pipe]=fifos(path.join(pipes,'claude'));
 assert.ok(pipe?.startsWith(id+'.'),'the pipe is in the pipe directory');
 assert.equal(fs.statSync(path.join(pipes,'claude')).mode&0o777,0o700);
 // An older server left its runner's pipe in turnlogs/: move it there and restart.
 await f.stop();
 fs.renameSync(path.join(pipes,'claude',pipe),path.join(turnlogs,pipe));
 fs.writeFileSync(path.join(pipes,'claude','gone.0.in.fifo'),''); // a leftover nothing owns is swept
 await f.start();
 assert.equal((await f.health()).processes,1,'process adopted through the legacy pipe');
 assert.ok(!fs.existsSync(path.join(pipes,'claude','gone.0.in.fifo')),'unowned pipe swept');
 assert.equal((await f.call(`/session/${id}/message`,msg('after upgrade'))).status,202);
 assert.ok(await f.until(async()=>f.calls().length===2&&await f.state(id)==='finished'));
 assert.equal(f.pids().size,1,'the upgraded server wrote into the same process');
});

test('refuses while another app is mid-turn; a later message starts a fresh process',async t=>{
 const f=await fixture(t,18396);
 const id=(await f.call('/new',{cwd:repo,...msg('first')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='finished'));
 const file=path.join(f.dir,'sessions','test-workspace',id+'.jsonl');
 fs.appendFileSync(file,JSON.stringify({type:'user',message:{role:'user',content:'typed in code-server'},timestamp:new Date().toISOString()})+'\n');
 const busy=await f.call(`/session/${id}/message`,msg('from phone'));
 assert.equal(busy.status,409);assert.match(busy.body.error,/another app/);
 // the other app's turn finished a while ago: accepted, and the stale process is replaced
 fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/"timestamp":"[^"]+"}\n$/,`"timestamp":"${new Date(Date.now()-120000).toISOString()}"}\n`));
 assert.equal((await f.call(`/session/${id}/message`,msg('from phone later'))).status,202);
 assert.ok(await f.until(async()=>f.calls().length===2&&await f.state(id)==='finished'));
 assert.equal(f.pids().size,2,'process restarted to pick up the other app\'s turn');
 assert.match(f.logs(),/reason=continued in another app/);
});

test('release closes an idle process and asks before stopping a running turn',async t=>{
 const f=await fixture(t,18397);
 const id=(await f.call('/new',{cwd:repo,...msg('__SLOW__ running')})).body.id;
 const r1=await f.call(`/session/${id}/release`,{});
 assert.equal(r1.status,409);assert.equal(r1.body.running,true);
 assert.ok(await f.until(async()=>await f.state(id)==='finished'));
 const r2=await f.call(`/session/${id}/release`,{});
 assert.equal(r2.status,200);assert.equal(r2.body.released,true);
 assert.ok(await f.until(async()=>(await f.health()).processes===0),'process closed');
 const r3=await f.call(`/session/${id}/release`,{});
 assert.equal(r3.body.released,false);
});

test('turns carry the reply-suggestion instruction; a trailing choices block comes back as reply options',async t=>{
 const f=await fixture(t,18571);
 const id=(await f.call('/new',{cwd:repo,...msg('__CHOICES__ wrap up')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='finished'));
 assert.equal(f.calls()[0].choices,true,'the CLI was started with the instruction');
 assert.equal(f.calls()[0].google,true,'1.68: and the pocket-google line, which needs no feature switch');
 const last=(await f.call(`/session/${id}`)).body.messages.filter(m=>m.role==='assistant').at(-1);
 assert.deepEqual(last.blocks,[{t:'text',text:'Tests pass. Should I merge and deploy?'},{t:'choices',options:['Merge and deploy',"Don't merge yet"]}]);
 assert.equal((await f.call(`/session/${id}/search?q=${encodeURIComponent("don't merge")}`)).status<500,true);
});

test('POCKET_CHOICES=0 starts the CLI without the instruction',async t=>{
 const f=await fixture(t,18611,{POCKET_CHOICES:'0'});
 const id=(await f.call('/new',{cwd:repo,...msg('plain')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='finished'));
 assert.equal(f.calls()[0].choices,false);
 assert.equal(f.calls()[0].google,true,'the Google line does not depend on POCKET_CHOICES');
});

test('a just-sent message shows as pending until the CLI writes it, and never twice',async t=>{
 const f=await fixture(t,18751);
 const first=(await f.call('/new',{cwd:repo,...msg('setup')})).body.id;
 assert.ok(await f.until(async()=>await f.state(first)==='finished'));
 const text='__SLOW__ __LATEUSER__ please check the logs';
 assert.equal((await f.call(`/session/${first}/message`,msg(text))).status,202);
 const users=async()=>(await f.call(`/session/${first}`)).body.messages.filter(m=>m.role==='user');
 let u=await users();
 assert.deepEqual(u.at(-1),{role:'user',text,pending:true},'shown right away, marked pending');
 assert.ok(await f.until(async()=>{const x=await users();return x.at(-1).text===text&&!x.at(-1).pending;}),'replaced by the transcript line once written');
 u=await users();assert.equal(u.filter(m=>m.text===text).length,1,'never twice');
 // A steered message landing after the turn's own line must not re-add the turn's text.
 const file=fs.readdirSync(path.join(f.dir,'sessions','test-workspace')).find(n=>n.startsWith(first));
 fs.appendFileSync(path.join(f.dir,'sessions','test-workspace',file),JSON.stringify({type:'attachment',sessionId:first,timestamp:new Date().toISOString(),attachment:{type:'queued_command',prompt:'also check disk space'}})+'\n');
 u=await users();
 assert.equal(u.at(-1).text,'also check disk space');assert.equal(u.filter(m=>m.text===text).length,1,'steer after it does not duplicate the turn text');
 assert.ok(await f.until(async()=>await f.state(first)==='finished',6000));
 assert.equal((await users()).some(m=>m.pending),false,'nothing pending once the turn ends');
});

// 1.78.1: the CLI reports its process's running cost total; each reply shows only its own share, across a restart.
test('a reused process reports each turn\'s own cost, also after a daemon restart',async t=>{
 const f=await fixture(t,18473);
 // Reads a running turn's events until its result (the __SLOW__ turn is still going when this connects).
 const result=async id=>{
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),8000);
  try{
   const r=await fetch(`http://127.0.0.1:${f.port}/api/session/${id}/events?from=0`,{headers:f.headers,signal:ac.signal});
   const reader=r.body.getReader(),dec=new TextDecoder();let buf='';
   for(;;){const {value,done}=await reader.read();if(done)return null;buf+=dec.decode(value,{stream:true});
    let i;while((i=buf.indexOf('\n\n'))>=0){const d=buf.slice(0,i).split('\n').find(l=>l.startsWith('data: '));buf=buf.slice(i+2);if(!d)continue;const ev=JSON.parse(d.slice(6));if(ev.type==='result'){ac.abort();return ev;}}}
  }catch(e){if(e.name==='AbortError')return null;throw e;}finally{clearTimeout(timer);}
 };
 const id=(await f.call('/new',{cwd:repo,...msg('__COST__ __SLOW__ first')})).body.id;
 let r=await result(id);assert.equal(r.cost,0.4,'first turn: the whole total');
 assert.ok(await f.until(async()=>await f.state(id)==='finished'));
 assert.equal((await f.call(`/session/${id}/message`,msg('__COST__ __SLOW__ second'))).status,202);
 r=await result(id);assert.equal(r.cost,0.4,'second turn: only its own cost, not 0.80');
 assert.ok(await f.until(async()=>await f.state(id)==='finished'));
 assert.equal(f.pids().size,1,'the same process');
 // The process outlives the daemon; the restarted daemon keeps counting from the marker.
 await f.stop();await f.start();
 assert.ok(await f.until(async()=>(await f.health()).processes===1),'the process was adopted');
 assert.equal((await f.call(`/session/${id}/message`,msg('__COST__ __SLOW__ third'))).status,202);
 r=await result(id);assert.equal(r.cost,0.4,'after a restart: still its own cost, not 1.20');
 assert.equal(f.pids().size,1);
});

// 1.82: a background subagent's permission request arrives when no reply is running (or outlives the reply that
// started it). Before, the daemon dropped it and the agent waited forever behind a conversation that read "Working in
// background" with nothing to see. Now it opens a stand-in turn, shows the card named after the agent, and goes back
// to the background once answered.
test('a background subagent asking permission after the reply ended shows as a named approval, and the answer reaches it',async t=>{
 const f=await fixture(t,18411,{POCKET_TEST_BG_MS:'900'});
 const responses=()=>{try{return fs.readFileSync(path.join(f.dir,'calls.responses'),'utf8')}catch{return ''}};
 const id=(await f.call('/new',{cwd:repo,...msg('__BG_ASK__ review the imports')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='input',6000),'the request opens a waiting state after the reply ended');
 assert.match(f.logs(),/turn start \(a background job asked for permission\)/);
 const row=(await f.call('/sessions')).body.sessions.find(s=>s.id===id);assert.equal(row.state.label,'Needs approval');
 const {requests}=(await f.call(`/session/${id}/approvals`)).body;
 assert.equal(requests.length,1);assert.equal(requests[0].agent,'Review imports','the card names the agent that asked');assert.match(requests[0].details,/import:check/);
 // the subagent's activity is recorded as its steps stream in — wait for it to settle before reading,
 // rather than racing the first read against the background job's emission.
 assert.ok(await f.until(async()=>{const a=(await f.call(`/session/${id}/agents`)).body.agents?.[0];return a&&a.latest==='Using Bash'&&a.steps===2;},6000),'the agent activity is recorded');
 const agents=(await f.call(`/session/${id}/agents`)).body;
 assert.equal(agents.running,1);assert.equal(agents.agents[0].name,'Review imports');assert.equal(agents.agents[0].activity,true);assert.equal(agents.agents[0].latest,'Using Bash');assert.equal(agents.agents[0].steps,2);
 const activity=(await f.call(`/session/${id}/agents/${agents.agents[0].id}/activity`)).body;
 assert.equal(activity.agent.steps,2);assert.ok(activity.messages.some(m=>m.blocks?.some(b=>b.t==='tool'&&b.name==='Bash')),'the agent transcript reads as messages');
 assert.equal((await f.call(`/session/${id}/agents/nope/activity`)).status,404);
 assert.equal((await f.call(`/session/${id}/message`,msg('carry on'))).status,202,'a message typed meanwhile is not refused');
 assert.equal((await f.call(`/session/${id}/approvals`)).body.requests.length,1,'and does not skip the agent\'s request');
 const d=await f.call(`/session/${id}/approvals/${requests[0].id}/decision`,{decision:'allow'});assert.equal(d.status,200);
 assert.ok(await f.until(()=>responses().includes('"request_id":"bg-ask","behavior":"allow"')),'the allow reached the CLI');
 assert.ok(await f.until(async()=>['background','finished'].includes(await f.state(id))),'no stand-in turn is left running');
 assert.match(f.logs(),/turn done \(background job's request answered\)/);
 assert.ok(await f.until(async()=>await f.state(id)==='finished',6000),'the agent finishes and the CLI reports it');
 assert.ok(f.transcript(id).includes('The background agent finished.'));
 assert.equal(f.pids().size,1);
});

test('a request still waiting when the reply ends is carried to a stand-in turn instead of being withdrawn',async t=>{
 const f=await fixture(t,18412,{POCKET_TEST_BG_MS:'900'});
 const responses=()=>{try{return fs.readFileSync(path.join(f.dir,'calls.responses'),'utf8')}catch{return ''}};
 const id=(await f.call('/new',{cwd:repo,...msg('__BG_ASK_EARLY__ review the imports')})).body.id;
 assert.ok(await f.until(()=>/request\(s\) carried from the ended reply/.test(f.logs()),6000),'the ended reply hands its pending request over');
 assert.ok(await f.until(async()=>await f.state(id)==='input'));
 const {requests}=(await f.call(`/session/${id}/approvals`)).body;
 assert.equal(requests.length,1);assert.equal(requests[0].agent,'Review imports');
 assert.equal((await f.call(`/session/${id}/approvals/${requests[0].id}/decision`,{decision:'deny'})).status,200);
 assert.ok(await f.until(()=>responses().includes('"request_id":"bg-ask","behavior":"deny"')));
 assert.ok(await f.until(async()=>await f.state(id)==='finished',6000));
 assert.equal((f.logs().match(/turn done session=/g)||[]).length,2,'the stand-in turn records no outcome of its own');
});

// 1.83: the / picker offers the built-ins the CLI reports on its init line and its plugin skills; a slash command and its
// output read back after a reload as typed and as the reply, and a skill's own instructions are not shown as the message.
test('slash commands: the CLI\'s own list reaches the picker, and a command reads back as typed with its output',async t=>{
 const f=await fixture(t,18762);
 const before=(await f.call('/commands?provider=claude&cwd='+encodeURIComponent(repo))).body;
 assert.equal(before.available,null,'unknown until a reply has started');
 const id=(await f.call('/new',{cwd:repo,...msg('setup')})).body.id;
 assert.ok(await f.until(async()=>await f.state(id)==='finished'));
 const r=(await f.call('/commands?provider=claude&cwd='+encodeURIComponent(repo))).body;
 assert.deepEqual(r.available,['context','compact','init','anthropic-skills:pdf'],'internal names are left out');
 const pdf=r.commands.find(c=>c.name==='anthropic-skills:pdf');
 assert.ok(pdf,'a plugin skill that is not on disk is offered');assert.equal(pdf.label,'pdf');
 const file=path.join(f.dir,'sessions','test-workspace',fs.readdirSync(path.join(f.dir,'sessions','test-workspace')).find(n=>n.startsWith(id)));
 const ts=new Date().toISOString(),line=o=>fs.appendFileSync(file,JSON.stringify({sessionId:id,timestamp:ts,...o})+'\n');
 line({type:'user',isMeta:true,message:{role:'user',content:'<local-command-caveat>The command below was run directly.</local-command-caveat>'}});
 line({type:'user',message:{role:'user',content:'<command-name>/context</command-name>\n            <command-message>context</command-message>\n            <command-args></command-args>'}});
 line({type:'system',subtype:'local_command',content:'<local-command-stdout>## Context Usage\n\n**Tokens:** 31.8k / 1m</local-command-stdout>'});
 line({type:'user',message:{role:'user',content:'<command-message>hello</command-message>\n<command-name>/hello</command-name>\n<command-args>there</command-args>'}});
 line({type:'user',isMeta:true,message:{role:'user',content:[{type:'text',text:'Reply with exactly the word: hi\n\nARGUMENTS: there'}]}});
 line({type:'user',isMeta:true,message:{role:'user',content:'Another Claude session sent a message: check the build'}});
 const m=(await f.call(`/session/${id}`)).body.messages.slice(-4);
 assert.deepEqual(m.map(x=>x.role),['user','assistant','user','user']);
 assert.equal(m[0].text,'/context');
 assert.match(JSON.stringify(m[1].blocks),/Context Usage/,'the command\'s output is the reply');
 assert.equal(m[2].text,'/hello there','typed command with its arguments, not the skill body');
 assert.equal(m[3].text,'Another Claude session sent a message: check the build','a message from another session still shows');
});
