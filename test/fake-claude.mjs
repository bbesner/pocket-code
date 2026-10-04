#!/usr/bin/env node
// Integration-only CLI: never calls a model or executes the supplied message.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
if (process.argv.includes('--version')) { console.log('test-cli'); process.exit(0); }
const args=process.argv.slice(2);
const flag=args.includes('--resume')?'--resume':'--session-id';
const id=args[args.indexOf(flag)+1];
const root=process.env.POCKET_SESSION_ROOT;
if (!root || !process.env.POCKET_TEST_CALLS) throw Error('Test environment required');
const dir=path.join(root,'test-workspace');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,id+'.jsonl');
const lines=readline.createInterface({input:process.stdin});
let working=false,questionKeepAlive;
const append=o=>fs.appendFileSync(file,JSON.stringify({sessionId:id,cwd:process.cwd(),timestamp:new Date().toISOString(),...o})+'\n');
lines.on('line',line=>{
  const obj=JSON.parse(line);
  if(obj.type==='control_response'){clearInterval(questionKeepAlive);if(obj.response.request_id==='native-approval'&&obj.response.response.behavior==='allow')fs.appendFileSync(process.env.POCKET_TEST_CALLS+'.approved',id+'\n');const msg={type:'assistant',message:{role:'assistant',content:[{type:'text',text:'Blue'}]}};append(msg);console.log(JSON.stringify(msg));console.log(JSON.stringify({type:'result',subtype:'success'}));return;}
  const text=obj.message.content[0].text;
  fs.appendFileSync(process.env.POCKET_TEST_CALLS,JSON.stringify({id,text,permissionMode:args[args.indexOf('--permission-mode')+1],model:args.includes('--model')?args[args.indexOf('--model')+1]:null,effort:JSON.parse(args[args.indexOf('--settings')+1]||'{}').effortLevel??null})+'\n');
  // like the real CLI, a message steered into a running turn reaches the transcript only at the next step
  if(!working)append({type:'user',message:{role:'user',content:text}});
  if(text.includes('__APPROVAL__')){questionKeepAlive=setInterval(()=>{},1000);console.log(JSON.stringify({type:'control_request',request_id:'native-approval',request:{subtype:'can_use_tool',tool_name:'Bash',input:{command:'echo fixture-only-secret > approval.txt'}}}));return;}
  if(text.includes('__QUESTION__')){questionKeepAlive=setInterval(()=>{},1000);console.log(JSON.stringify({type:'control_request',request_id:'native-test',request:{subtype:'can_use_tool',tool_name:'AskUserQuestion',input:{questions:[{header:'Color',question:'Which color?',options:[{label:'Blue',description:'Cool'},{label:'Red',description:'Warm'}],multiSelect:false}]}}}));return;}
  if (working) return;
  working=true;
  setTimeout(()=>{
    const usage=text.includes('__USAGE__');
    const model='claude-opus-5-5[1m]';
    if(usage)console.log(JSON.stringify({type:'rate_limit_event',rate_limit_info:{status:'allowed',resetsAt:1791141000,rateLimitType:'five_hour',overageStatus:'rejected',overageDisabledReason:'out_of_credits',isUsingOverage:false,unifiedWindows:{five_hour:{utilization:0.07,resetsAt:1791141000},seven_day:{utilization:0.02,resetsAt:1791295200}}},session_id:id}));
    const assistantMsg={type:'assistant',message:{role:'assistant',content:[{type:'text',text:'Test response.'}],...(usage?{model,usage:{input_tokens:1200,cache_read_input_tokens:800,cache_creation_input_tokens:0}}:{})}};
    append(assistantMsg);
    console.log(JSON.stringify(assistantMsg));
    const result={type:'result',subtype:text.includes('__FAIL__')?'error':'success',result:'Test result',duration_ms:300};
    if(usage)result.modelUsage={[model]:{inputTokens:1200,cacheReadInputTokens:800,cacheCreationInputTokens:0,contextWindow:1000000},'claude-haiku-4-5-20251001':{inputTokens:50,cacheReadInputTokens:0,cacheCreationInputTokens:0,contextWindow:200000}};
    console.log(JSON.stringify(result));
  },text.includes('__SLOW__')?1800:300);
});
