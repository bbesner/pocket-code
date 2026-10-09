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
if (process.argv[2]==='auth'&&process.argv[3]==='status') { console.log(JSON.stringify({loggedIn:process.env.FAKE_CLAUDE_SIGNED_OUT!=='1',authMethod:'claude.ai',email:'owner@example.test',subscriptionType:'max'})); process.exit(0); }
// Session titles (titles.mjs): a one-shot -p call with no saved session. Answer like the real CLI's json output.
if (process.argv.includes('--no-session-persistence')) {
  let input=''; process.stdin.on('data',c=>input+=c); process.stdin.on('end',()=>{
    const tr=input.match(/<transcript>\n([\s\S]*?)\n<\/transcript>/);
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
let working=false,questionKeepAlive;
const append=o=>fs.appendFileSync(file,JSON.stringify({sessionId:id,cwd:process.cwd(),timestamp:new Date().toISOString(),...o})+'\n');
lines.on('line',line=>{
  const obj=JSON.parse(line);
  if(obj.type==='control_response'){clearInterval(questionKeepAlive);if(obj.response.request_id==='native-approval'&&obj.response.response.behavior==='allow')fs.appendFileSync(process.env.POCKET_TEST_CALLS+'.approved',id+'\n');const msg={type:'assistant',message:{role:'assistant',content:[{type:'text',text:'Blue'}]}};append(msg);console.log(JSON.stringify(msg));console.log(JSON.stringify({type:'result',subtype:'success'}));return;}
  const text=obj.message.content[0].text;
  fs.appendFileSync(process.env.POCKET_TEST_CALLS,JSON.stringify({id,pid:process.pid,text,permissionMode:args[args.indexOf('--permission-mode')+1],model:args.includes('--model')?args[args.indexOf('--model')+1]:null,effort:JSON.parse(args[args.indexOf('--settings')+1]||'{}').effortLevel??null,choices:args.includes('--append-system-prompt')&&/```choices|`choices`/.test(args[args.indexOf('--append-system-prompt')+1]||''),projects:args.includes('--append-system-prompt')&&/pocket-board/.test(args[args.indexOf('--append-system-prompt')+1]||'')})+'\n');
  // like the real CLI, a message steered into a running turn reaches the transcript only at the next step
  // __LATEUSER__: like the real CLI under load, the user line reaches the transcript a moment after the turn starts
  if(!working){const line={type:'user',message:{role:'user',content:text}};if(text.includes('__LATEUSER__'))setTimeout(()=>append(line),900);else append(line);}
  if(text.includes('__APPROVAL__')){questionKeepAlive=setInterval(()=>{},1000);console.log(JSON.stringify({type:'control_request',request_id:'native-approval',request:{subtype:'can_use_tool',tool_name:'Bash',input:{command:'echo fixture-only-secret > approval.txt'}}}));return;}
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
    const assistantMsg={type:'assistant',message:{role:'assistant',content:[{type:'text',text:text.includes('__CHOICES__')?'Tests pass. Should I merge and deploy?\n\n```choices\nMerge and deploy\nDon\'t merge yet\n```':'Test response.'}],...(usage?{model,usage:{input_tokens:900,cache_read_input_tokens:800,cache_creation_input_tokens:300,cache_creation:{ephemeral_1h_input_tokens:300,ephemeral_5m_input_tokens:0}}}:{})}};
    append(assistantMsg);
    console.log(JSON.stringify(assistantMsg));
    const result={type:'result',subtype:text.includes('__FAIL__')?'error':'success',result:'Test result',duration_ms:300};
    if(usage)result.modelUsage={[model]:{inputTokens:1200,cacheReadInputTokens:800,cacheCreationInputTokens:0,contextWindow:1000000},'claude-haiku-4-5-20251001':{inputTokens:50,cacheReadInputTokens:0,cacheCreationInputTokens:0,contextWindow:200000}};
    console.log(JSON.stringify(result));
    working=false;
  },text.includes('__SLOW__')?1800:300);
});
}
