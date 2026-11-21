// Casey's 1.88.1 batch, reader group: F-3, F-6, F-15, F-16, F-17, F-19. Each test drives the real daemon with the fake CLIs.
// Transcript lines are synthetic, in the shapes Claude Code 2.1.293–2.1.312 writes (checked against real transcripts).
// A line the CLI prints on stdout is appended to the runner's output file, which is the file the CLI's stdout is.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const msg=(text,extra={})=>({text,clientMessageId:randomUUID(),...extra});
const lines=f=>{try{return fs.readFileSync(f,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)}catch{return []}};

// One daemon per test on a temp HOME and data dir; start/stop restart it on the same data.
async function fixture(t,port,env={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-casey-reader-'));
 const home=path.join(dir,'home'),codexHome=path.join(dir,'codex-home');
 for(const d of [path.join(home,'pocket-uploads'),codexHome,path.join(dir,'sessions','test-workspace')])fs.mkdirSync(d,{recursive:true});
 const secret=randomUUID(),exp=Date.now()+3600000;
 const headers={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
 let child,logs='';
 const start=async()=>{
  child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),HOME:home,POCKET_SKILLS:'0',PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),CODEX_HOME:codexHome,...env},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
  for(let i=0;i<150;i++){if(child.exitCode!==null)break;try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)return;}catch{} await sleep(30);}
  if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=37;logs='';return start();}
  throw Error('Test server failed: '+logs);
 };
 const stop=async()=>{if(child&&child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}};
 const call=async(p,body,method)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:method||(body?'POST':'GET'),headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null)};};
 const until=async(fn,ms=6000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return true;await sleep(50)}return false;};
 const calls=()=>lines(path.join(dir,'calls'));
 const state=async id=>(await call('/sessions')).body.sessions.find(s=>s.id===id)?.state;
 const transcriptFile=id=>path.join(dir,'sessions','test-workspace',id+'.jsonl');
 const line=(id,o)=>fs.appendFileSync(transcriptFile(id),JSON.stringify({parentUuid:null,isSidechain:false,uuid:randomUUID(),timestamp:new Date().toISOString(),userType:'external',entrypoint:'sdk-cli',cwd:repo,sessionId:id,version:'2.1.312',gitBranch:'HEAD',...o})+'\n');
 // What the CLI prints on stdout lands in the runner's output file; the daemon tails that file.
 const stdout=(id,o)=>{const d=path.join(dir,'data','turnlogs');const f=fs.readdirSync(d).find(n=>n.startsWith(id+'.')&&n.endsWith('.out.ndjson'));fs.appendFileSync(path.join(d,f),JSON.stringify(o)+'\n');};
 const killAll=()=>{for(const pid of new Set(calls().map(c=>c.pid))){try{process.kill(-pid,'SIGKILL')}catch{try{process.kill(pid,'SIGKILL')}catch{}}}};
 t.after(async()=>{await stop();killAll();await sleep(300);fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});});
 await start();
 return {dir,home,start,stop,call,until,calls,state,line,stdout,transcriptFile,logs:()=>logs};
}
// A finished conversation to read transcript lines back from.
async function conversation(f){
 const id=(await f.call('/new',{cwd:repo,...msg('setup')})).body.id;
 assert.ok(await f.until(async()=>(await f.state(id))?.kind==='finished'));
 return id;
}
const userMsgs=async(f,id)=>(await f.call(`/session/${id}`)).body.messages.filter(m=>m.role==='user');

// F-3: the Codex Branch path awaits the fork and the first turn's start before it writes branchOf. A daemon restart
// (pm2 restart is SIGTERM, which exits at once) while turn/start is out leaves a saved fork that runs with no lineage.
test('F-3: a Codex branch whose daemon restarts before turn/start answers still names its parent',async t=>{
 const f=await fixture(t,19231,{POCKET_CODEX:'1',CODEX_BIN:path.join(repo,'test/casey-1881-slow-codex.mjs'),CASEY_SLOW_START_MS:'2500'});
 const parent=(await f.call('/new',{cwd:repo,provider:'codex',...msg('Plan the camera rollout')})).body.id;
 assert.match(parent,/^cx:/);
 assert.ok(await f.until(async()=>!(await f.call(`/session/${parent}`)).body?.active));
 const pending=f.call(`/session/${parent}/branch`,msg('Draft the rollout email __SLOWSTART__')).catch(e=>({error:e.message}));
 assert.ok(await f.until(()=>lines(path.join(f.dir,'calls.forks')).some(x=>!x.ephemeral)),'thread/fork answered: the new thread is saved');
 await sleep(300);
 await f.stop();await pending;
 let fork={};try{fork=JSON.parse(fs.readFileSync(path.join(f.dir,'data','session-meta.json'),'utf8'));}catch{}
 await f.start();
 // The fork was saved and its held first turn still reaches it (the app-server outlives the daemon by design).
 assert.ok(await f.until(()=>lines(path.join(f.dir,'calls.codex')).some(x=>/Draft the rollout email/.test(x.text)),5000),'the forked thread runs its first turn anyway');
 const child='cx:'+lines(path.join(f.dir,'calls.codex')).find(x=>/Draft the rollout email/.test(x.text)).threadId;
 assert.notEqual(child,parent);
 const c=(await f.call(`/session/${child}`)).body;
 assert.deepEqual({branchOf:c.branchOf?.id??null,saved:Boolean(fork[child]?.branchOf)},{branchOf:parent,saved:true},'the fork is recorded as a branch of its parent');
});

// F-6: Claude Code 2.1.199–2.1.312 write a background task's finish as a plain user line (no isMeta,
// origin.kind "task-notification"). Only the queued_command branch hides <task-notification>.
test('F-6: a background task\'s plain task-notification user line is not shown as an owner message on reload',async t=>{
 const f=await fixture(t,19232);
 const id=await conversation(f);
 const block='<task-notification>\n<task-id>a0b1c2d3e4f5a6b7c</task-id>\n<tool-use-id>toolu_01SyntheticSpawn</tool-use-id>\n<output-file>/tmp/claude-1000/test/tasks/a0b1c2d3e4f5a6b7c.output</output-file>\n<status>completed</status>\n<summary>Agent "Review imports" completed</summary>\n<result>No duplicate SKUs.</result>\n</task-notification>';
 f.line(id,{type:'user',message:{role:'user',content:block},origin:{kind:'task-notification',producer:'session-task',runId:'synthetic-run'},promptSource:'system',turnOrigin:'task_notification',queueSkipAttachments:true,permissionMode:'default'});
 f.line(id,{type:'assistant',message:{role:'assistant',model:'claude-test',content:[{type:'text',text:'The review agent found no duplicates.'}]}});
 // the same block steered in as a queued_command attachment is already hidden (server.mjs:971): the guard to match
 f.line(id,{type:'attachment',attachment:{type:'queued_command',prompt:block,commandMode:'task-notification',origin:{kind:'task-notification',producer:'session-task'}}});
 const shown=(await userMsgs(f,id)).filter(m=>/<task-notification>|<output-file>/.test(m.text||''));
 assert.deepEqual(shown.map(m=>m.text.slice(0,40)),[],'no owner message carries the raw notification block');
});

// F-15: after /compact (or an automatic compaction) the CLI writes the summary as a user line with isCompactSummary
// and no isMeta. cache.mjs:43 skips it for the prompt list; the conversation reader does not.
test('F-15: a compaction summary user line is not shown as a message the owner sent',async t=>{
 const f=await fixture(t,19233);
 const id=await conversation(f);
 const summary='This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n1. Primary Request and Intent:\n   - Synthetic request.\n'+'   - detail line\n'.repeat(200)+'\nPlease continue the conversation from where we left off without asking the user any further questions.';
 f.line(id,{type:'user',message:{role:'user',content:summary},isVisibleInTranscriptOnly:true,isCompactSummary:true,turnOrigin:'task_notification'});
 f.line(id,{type:'user',message:{role:'user',content:'and the next thing'}});
 const u=await userMsgs(f,id);
 assert.equal(u.at(-1).text,'and the next thing');
 const shown=u.filter(m=>/^This session is being continued/.test(m.text||''));
 assert.deepEqual(shown.map(m=>m.text.length),[],'the summary (and the instructions in it) is not an owner message');
});

// F-16: finalizeTurn collects a background agent's waiting request (carry) and clears the inboxes, but when an
// "After this reply" message is queued it starts that message and returns before carryRequests.
test('F-16: a background agent\'s request still waiting when a reply ends with a queued message stays answerable',async t=>{
 const f=await fixture(t,19234,{POCKET_TEST_BG_MS:'900'});
 const responses=()=>{try{return fs.readFileSync(path.join(f.dir,'calls.responses'),'utf8')}catch{return ''}};
 const id=(await f.call('/new',{cwd:repo,...msg('__BG_ASK_EARLY__ review the imports')})).body.id;
 // the agent asks while the reply is still running; the owner queues a message for after the reply
 assert.ok(await f.until(async()=>(await f.call(`/session/${id}/approvals`)).body?.requests?.length===1,3000),'the agent\'s request is shown');
 const q=await f.call(`/session/${id}/message`,msg('then summarise it',{mode:'queue'}));
 assert.equal(q.status,202);assert.equal(q.body.queued,true);
 assert.ok(await f.until(()=>f.calls().some(c=>c.text==='then summarise it'),5000),'the queued message starts when the reply ends');
 assert.ok(await f.until(async()=>!['running'].includes((await f.state(id))?.kind)&&(f.logs().match(/turn done session=/g)||[]).length>=2,6000),'and its reply ends');
 await sleep(500);
 const requests=(await f.call(`/session/${id}/approvals`)).body.requests;
 assert.deepEqual({requests:requests.map(r=>r.agent),answered:responses().includes('"request_id":"bg-ask"')},{requests:['Review imports'],answered:false},'the agent\'s request is still on the phone, unanswered');
});

// F-17: a steered message with an attachment goes to the CLI with Pocket's attachment block; the CLI saves it as a
// queued_command attachment line, whose reader branch keeps the block as text. The page's steered echo matches typed
// text only, so the echo stays beside the row while the reply runs.
test('F-17: a steered message with an attachment reads back as its text with file chips, and the page drops its echo',async t=>{
 const f=await fixture(t,19235);
 const id=await conversation(f);
 const file=path.join(f.home,'pocket-uploads','casey-f17.txt');fs.writeFileSync(file,'attached');
 assert.equal((await f.call(`/session/${id}/message`,msg('__SLOW__ check the logs'))).status,202);
 assert.ok(await f.until(async()=>(await f.state(id))?.kind==='running'));
 const s=await f.call(`/session/${id}/message`,msg('use this file',{attachments:[file]}));
 assert.equal(s.body.steered,true);
 assert.ok(await f.until(()=>f.calls().some(c=>c.text.startsWith('use this file'))));
 const sent=f.calls().find(c=>c.text.startsWith('use this file')).text;
 assert.match(sent,/\n\n\[Attached file — read as needed:\n/,'the CLI received the attachment block');
 // what Claude Code saves for a steered message: a queued_command attachment line holding the prompt as sent
 f.line(id,{type:'attachment',attachment:{type:'queued_command',prompt:[{type:'text',text:sent}],source_uuid:randomUUID(),delivery_id:randomUUID(),commandMode:'prompt'},rendered:[{content:sent}],renderedRole:'user'});
 const row=(await userMsgs(f,id)).at(-1);
 // the page's steered echo, run as the page runs it against these messages
 const src=fs.readFileSync(path.join(repo,'public','app.js'),'utf8');
 const fn=src.slice(src.indexOf('function steeredHTML('),src.indexOf('function openES('));
 const ctx={steeredEchoes:new Map([[id,[{text:'use this file',at:Date.now()}]]]),msgHTML:m=>'<echo>'+m.text+'</echo>'};
 vm.runInNewContext(fn+';out=steeredHTML(id,messages)',Object.assign(ctx,{id,messages:(await f.call(`/session/${id}`)).body.messages}));
 assert.deepEqual({text:row.text,files:(row.files||[]).map(x=>x.p),echo:ctx.out},{text:'use this file',files:[file],echo:''},'one row with file chips, no second copy from the echo');
});

// F-19: with no reply open, any assistant or stream_event line starts an agent-started turn, including a background
// subagent's lines (parent_tool_use_id set). Real Claude Code stdout prints those lines between replies.
test('F-19: a background subagent\'s output with no reply open keeps Working in background and does not take a steer',async t=>{
 const f=await fixture(t,19236);
 const id=(await f.call('/new',{cwd:repo,...msg('__BG__ __BG_LONG__ start a job')})).body.id;
 assert.ok(await f.until(async()=>(await f.state(id))?.kind==='background'),'the reply ended; the job runs');
 // a background subagent's step, in the shape Claude Code 2.1.312 prints it on stdout
 f.stdout(id,{type:'assistant',message:{id:'msg_synthetic_1',type:'message',role:'assistant',model:'claude-test',content:[{type:'text',text:'Checking the supplier files.'}],usage:{input_tokens:10,output_tokens:5}},parent_tool_use_id:'toolu_01SyntheticSpawn',agent_id:'a0b1c2d3e4f5a6b7c',subagent_type:'general-purpose',task_description:'Review imports',session_id:id,uuid:randomUUID(),request_id:'req_synthetic',timestamp:new Date().toISOString()});
 f.stdout(id,{type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Checking'}},parent_tool_use_id:'toolu_01SyntheticSpawn',session_id:id,uuid:randomUUID()});
 await sleep(1200); // the daemon tails the output file every 300 ms
 const st=(await f.state(id))?.kind,agentTurn=/turn start \(started by the agent\)/.test(f.logs());
 // the subagent then asks the owner a question; a message typed meanwhile must not skip it (1.82)
 f.stdout(id,{type:'control_request',request_id:'bg-question',request:{subtype:'can_use_tool',tool_name:'AskUserQuestion',input:{questions:[{header:'Scope',question:'Check last year too?',options:[{label:'Yes',description:''},{label:'No',description:''}],multiSelect:false}]},tool_use_id:'toolu_01SyntheticAsk'}});
 assert.ok(await f.until(async()=>(await f.call(`/session/${id}/questions`)).body.requests.length===1),'the question is shown');
 const typed=await f.call(`/session/${id}/message`,msg('carry on'));
 assert.deepEqual({state:st,agentTurn,skipped:typed.body.skippedQuestions??0},{state:'background',agentTurn:false,skipped:0},'still Working in background, no reply opened, the agent\'s question kept');
});
