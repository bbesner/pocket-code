#!/usr/bin/env node
// Integration-only CLI: never calls a model or executes the supplied message.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
if (process.argv.includes('--version')) { console.log('test-cli'); process.exit(0); }
if (process.argv[2]==='auth'&&process.argv[3]==='login') {
 console.log('Open https://claude.com/cai/oauth/authorize?state=test-state&code_challenge=test-challenge');
 await new Promise(()=>readline.createInterface({input:process.stdin}).once('line',code=>process.exit(code==='test-code#test-state'?0:1)));
}
// FAKE_CLAUDE_MCP_MS delays the listing; while the file FAKE_CLAUDE_MCP_FAIL exists it fails with a token-like line on stderr; each listing is recorded.
if (process.argv[2]==='mcp'&&process.argv[3]==='list') {
 if(process.env.POCKET_TEST_CALLS)fs.appendFileSync(process.env.POCKET_TEST_CALLS+'.mcp','list\n');
 if(process.env.FAKE_CLAUDE_MCP_MS)await new Promise(r=>setTimeout(r,Number(process.env.FAKE_CLAUDE_MCP_MS)));
 if(process.env.FAKE_CLAUDE_MCP_FAIL&&fs.existsSync(process.env.FAKE_CLAUDE_MCP_FAIL)){console.error('upstream said: token=sk-fake-connector-secret');process.exit(1);}
 console.log('Checking MCP server health…\n\nclaude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected\nclaude.ai Google Drive: https://drivemcp.googleapis.com/mcp/v1 - ! Needs authentication'); process.exit(0); }
if (process.argv[2]==='auth'&&process.argv[3]==='status') { console.log(JSON.stringify({loggedIn:process.env.FAKE_CLAUDE_SIGNED_OUT!=='1',authMethod:'claude.ai',email:'owner@example.test',subscriptionType:'max'})); process.exit(0); }
// 1.78: a side chat: a forked, unsaved session that keeps reading messages. Records its arguments, answers each
// message (with the CLI's running cost total), and with __SIDEHANG__ streams one word and waits for an interrupt. Never writes a transcript.
if (process.argv.includes('--fork-session')) {
  const args=process.argv.slice(2),parent=args[args.indexOf('--resume')+1],root=process.env.POCKET_SESSION_ROOT;
  if(process.env.POCKET_TEST_CALLS)fs.appendFileSync(process.env.POCKET_TEST_CALLS+'.side',JSON.stringify({parent,args,cwd:process.cwd()})+'\n');
  const found=root&&fs.readdirSync(root).some(d=>fs.existsSync(path.join(root,d,parent+'.jsonl')));
  if(!found){console.error('No conversation found with session ID: '+parent);process.exit(1);}
  if(root)setInterval(()=>{if(!fs.existsSync(root))process.exit(0)},300).unref();
  let n=0,spent=0,hanging=false;const out=o=>console.log(JSON.stringify(o));
  // like the real CLI, it exits when its input closes (the side chat ended or the daemon went away)
  readline.createInterface({input:process.stdin}).on('close',()=>process.exit(0)).on('line',line=>{
    const o=JSON.parse(line);
    if(o.type==='control_request'&&o.request?.subtype==='interrupt'){out({type:'control_response',response:{subtype:'success',request_id:o.request_id,response:{}}});if(hanging){hanging=false;out({type:'result',subtype:'error_during_execution',is_error:true,total_cost_usd:0});}return;}
    if(o.type!=='user')return;
    const text=o.message.content[0].text;n++;
    out({type:'system',subtype:'init',session_id:'fork-'+n});
    out({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'Side '}}});
    if(text.includes('__SIDEHANG__')){hanging=true;return;}
    setTimeout(()=>{const t='Side answer '+n+': '+text;out({type:'assistant',message:{role:'assistant',model:'claude-test',content:[{type:'text',text:t}]}});out({type:'result',subtype:text.includes('__SIDEBUDGET__')?'error_max_budget_usd':'success',is_error:false,result:t,total_cost_usd:(spent+=0.25),duration_ms:120});},150);
  });
} else
// Session titles (titles.mjs): a one-shot -p call with no saved session. Answer like the real CLI's json output.
if (process.argv.includes('--no-session-persistence')) {
  // 1.52: which --model each helper call named (titles, summaries), one per line.
  if(process.env.POCKET_TEST_CALLS)fs.appendFileSync(process.env.POCKET_TEST_CALLS+'.helper-models',(process.argv.includes('--model')?process.argv[process.argv.indexOf('--model')+1]:'')+'\n');
  let input=''; process.stdin.on('data',c=>input+=c); process.stdin.on('end',()=>{
    const tr=input.match(/<transcript>\n([\s\S]*?)\n<\/transcript>/);
    // Living titles (titles.mjs retitle): a digest of the whole session plus its current title. KEEPTITLE in the
    // digest keeps it; otherwise the title follows the last owner message. Recorded as "current => digest".
    const se=input.match(/<session>\n([\s\S]*?)\n<\/session>\n\nThe session is currently titled: (.*)\n/);
    if(se){if(process.env.POCKET_TEST_CALLS)fs.appendFileSync(process.env.POCKET_TEST_CALLS+'.live',se[2]+' => '+se[1].replace(/\n/g,' | ').slice(0,300)+'\n');
      const owners=se[1].split('\n').filter(l=>l.startsWith('Owner: '));const last=(owners.at(-1)||'').replace(/^Owner: /,'');
      console.log(JSON.stringify({type:'result',modelUsage:{'claude-haiku-test':{}},is_error:false,result:/KEEPTITLE/.test(se[1])?'KEEP':/__LIVEFAIL__/.test(se[1])?'I cannot title this session.':'Reply: Now '+last.split(/\s+/).filter(w=>!/^__/.test(w)).slice(0,3).join(' ')}));return;}
    if(tr){if(process.env.POCKET_TEST_CALLS)fs.appendFileSync(process.env.POCKET_TEST_CALLS+'.away',tr[1].replace(/\n/g,' | ')+'\n');
      console.log(JSON.stringify({type:'result',modelUsage:{'claude-haiku-test':{}},is_error:false,result:'- Worked on: '+tr[1].split('\n')[0].replace(/^Owner: /,'').slice(0,40)+'\n- Nothing is waiting on you.'}));return;}
    const req=(input.match(/<request>\n([\s\S]*?)\n<\/request>/)||[,input])[1];
    if(process.env.POCKET_TEST_CALLS)fs.appendFileSync(process.env.POCKET_TEST_CALLS+'.titles','claude: '+req.slice(0,200).replace(/\n/g,' ')+'\n');
    console.log(JSON.stringify({type:'result',modelUsage:{'claude-haiku-test':{}},is_error:/__TITLEFAIL__/.test(req),result:/__TITLEFAIL__/.test(req)?'Not logged in':'Title: '+req.split(/\s+/).filter(w=>!/^__/.test(w)).slice(0,4).join(' ')+'.'}));
  });
} else {
const args=process.argv.slice(2);
const flag=args.includes('--resume')?'--resume':'--session-id';
const id=args[args.indexOf(flag)+1];
const root=process.env.POCKET_SESSION_ROOT;
if (!root || !process.env.POCKET_TEST_CALLS) throw Error('Test environment required');
const dir=path.join(root,'test-workspace');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,id+'.jsonl');
const lines=readline.createInterface({input:process.stdin});
// Session processes outlive their server by design; a fixture's process ends with its test dir.
setInterval(()=>{if(!fs.existsSync(root))process.exit(0)},300).unref();
let working=false,questionKeepAlive,spent=0; // spent: the process's running cost, as the real CLI reports it
const append=o=>fs.appendFileSync(file,JSON.stringify({sessionId:id,cwd:process.cwd(),timestamp:new Date().toISOString(),...o})+'\n');
lines.on('line',line=>{
  const obj=JSON.parse(line);
  if(obj.type==='control_response'){clearInterval(questionKeepAlive);fs.appendFileSync(process.env.POCKET_TEST_CALLS+'.responses',JSON.stringify({id,request_id:obj.response.request_id,behavior:obj.response.response?.behavior})+'\n');if(obj.response.request_id==='native-approval'&&obj.response.response.behavior==='allow')fs.appendFileSync(process.env.POCKET_TEST_CALLS+'.approved',id+'\n');const msg={type:'assistant',message:{role:'assistant',content:[{type:'text',text:'Blue'}]}};append(msg);console.log(JSON.stringify(msg));console.log(JSON.stringify({type:'result',subtype:'success'}));return;}
  const text=obj.message.content[0].text;
  fs.appendFileSync(process.env.POCKET_TEST_CALLS,JSON.stringify({id,pid:process.pid,text,permissionMode:args[args.indexOf('--permission-mode')+1],model:args.includes('--model')?args[args.indexOf('--model')+1]:null,effort:JSON.parse(args[args.indexOf('--settings')+1]||'{}').effortLevel??null,choices:args.includes('--append-system-prompt')&&/```choices|`choices`/.test(args[args.indexOf('--append-system-prompt')+1]||''),projects:args.includes('--append-system-prompt')&&/pocket-board/.test(args[args.indexOf('--append-system-prompt')+1]||''),documents:args.includes('--append-system-prompt')&&/pocket-docs/.test(args[args.indexOf('--append-system-prompt')+1]||''),tasks:args.includes('--append-system-prompt')&&/pocket-tasks/.test(args[args.indexOf('--append-system-prompt')+1]||''),vault:args.includes('--append-system-prompt')&&/pocket-vault/.test(args[args.indexOf('--append-system-prompt')+1]||''),google:args.includes('--append-system-prompt')&&/pocket-google\/SKILL\.claude\.md/.test(args[args.indexOf('--append-system-prompt')+1]||''),runnerToken:process.env.POCKET_RUNNER_TOKEN||null,sessionEnv:process.env.POCKET_SESSION_ID||null,vaultKeySeen:'POCKET_VAULT_KEY' in process.env,daemonSecretsSeen:['POCKET_SMTP_URL','POCKET_SMTP_FROM','POCKET_ROUTER_KEY','POCKET_PASSWORD','POCKET_SECRET'].filter(k=>k in process.env)})+'\n');
  // like the real CLI, a message steered into a running turn reaches the transcript only at the next step
  // __LATEUSER__: like the real CLI under load, the user line reaches the transcript a moment after the turn starts
  if(!working){const line={type:'user',message:{role:'user',content:text}};if(text.includes('__LATEUSER__'))setTimeout(()=>append(line),900);else append(line);}
  if(text.includes('__APPROVAL__')){questionKeepAlive=setInterval(()=>{},1000);console.log(JSON.stringify({type:'control_request',request_id:'native-approval',request:{subtype:'can_use_tool',tool_name:'Bash',input:{command:'echo fixture-only-secret > approval.txt'}}}));return;}
  // 1.56: __TOOLREQ__ {"tool":…,"input":{…}}: ask permission for that tool call, then end the turn on the answer
  if(text.includes('__TOOLREQ__ ')){questionKeepAlive=setInterval(()=>{},1000);const req=JSON.parse(text.slice(text.indexOf('__TOOLREQ__ ')+12));console.log(JSON.stringify({type:'control_request',request_id:'native-tool-'+(req.n||0),request:{subtype:'can_use_tool',tool_name:req.tool,input:req.input}}));return;}
  if(text.includes('__QUESTION__')){questionKeepAlive=setInterval(()=>{},1000);console.log(JSON.stringify({type:'control_request',request_id:'native-test',request:{subtype:'can_use_tool',tool_name:'AskUserQuestion',input:{questions:[{header:'Color',question:'Which color?',options:[{label:'Blue',description:'Cool'},{label:'Red',description:'Warm'}],multiSelect:false}]}}}));return;}
  if (working) return;
  working=true;
  if(text.includes('__HANG__'))return; // a stuck turn: no output, no result
  // quiet but legitimately waiting on a background job: must not be treated as stuck
  if(text.includes('__BGHANG__')){console.log(JSON.stringify({type:'system',subtype:'background_tasks_changed',tasks:[{task_id:'bg2',task_type:'local_bash',description:'long build'}]}));return;}
  const reply=(t,more)=>{append({type:'assistant',message:{role:'assistant',content:[{type:'text',text:t}]}});console.log(JSON.stringify({type:'system',subtype:'init',session_id:id}));console.log(JSON.stringify({type:'assistant',message:{role:'assistant',content:[{type:'text',text:t}]}}));more?.();console.log(JSON.stringify({type:'result',subtype:text.includes('__FAIL__')?'error':'success',result:'Test result',duration_ms:300}));};
  setTimeout(()=>{
    // __BG__: start a background job, end the turn, then (like the real CLI) start a
    // turn by itself when the job finishes. __BG_LONG__ keeps the job running.
    if(text.includes('__BG')){
      reply('Started a background job.',()=>console.log(JSON.stringify({type:'system',subtype:'background_tasks_changed',tasks:[{task_id:'bg1',task_type:'local_bash',description:'sleep'}]})));
      working=false;
      if(!text.includes('__BG_LONG__'))setTimeout(()=>{console.log(JSON.stringify({type:'system',subtype:'background_tasks_changed',tasks:[]}));reply('The background job finished.');},Number(process.env.POCKET_TEST_BG_MS||600));
      return;
    }
    // __USAGE__: emit the rate-limit and context figures the real CLI reports
    const usage=text.includes('__USAGE__');
    const model='claude-opus-5-5[1m]';
    console.log(JSON.stringify({type:'system',subtype:'init',session_id:id}));
    if(usage)console.log(JSON.stringify({type:'rate_limit_event',rate_limit_info:{status:'allowed',resetsAt:1791141000,rateLimitType:'five_hour',overageStatus:'rejected',overageDisabledReason:'out_of_credits',isUsingOverage:false,unifiedWindows:{five_hour:{utilization:0.07,resetsAt:1791141000},seven_day:{utilization:0.02,resetsAt:1791295200}}},session_id:id}));
    const assistantMsg={type:'assistant',message:{role:'assistant',content:[{type:'text',text:text.includes('__CHOICES__')?'Tests pass. Should I merge and deploy?\n\n```choices\nMerge and deploy\nDon\'t merge yet\n```':text.includes('__FILE__ ')?'Here it is: [The deck]('+text.slice(text.indexOf('__FILE__ ')+9).split(/\s/)[0]+')':'Test response.'}],...(usage?{model,usage:{input_tokens:900,cache_read_input_tokens:800,cache_creation_input_tokens:300,cache_creation:{ephemeral_1h_input_tokens:300,ephemeral_5m_input_tokens:0}}}:{})}};
    append(assistantMsg);
    console.log(JSON.stringify(assistantMsg));
    const result={type:'result',subtype:text.includes('__FAIL__')?'error':'success',result:'Test result',duration_ms:300};
    if(text.includes('__COST__')){spent=Math.round((spent+0.4)*100)/100;result.total_cost_usd=spent;} // 1.78.1
    if(usage)result.modelUsage={[model]:{inputTokens:1200,cacheReadInputTokens:800,cacheCreationInputTokens:0,contextWindow:1000000},'claude-haiku-4-5-20251001':{inputTokens:50,cacheReadInputTokens:0,cacheCreationInputTokens:0,contextWindow:200000}};
    console.log(JSON.stringify(result));
    working=false;
  },text.includes('__SLOW__')?1800:300);
});
}
