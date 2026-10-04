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
// Session processes outlive their server by design; a fixture's process ends with its test dir.
setInterval(()=>{if(!fs.existsSync(root))process.exit(0)},300).unref();
let working=false,questionKeepAlive;
const append=o=>fs.appendFileSync(file,JSON.stringify({sessionId:id,cwd:process.cwd(),timestamp:new Date().toISOString(),...o})+'\n');
lines.on('line',line=>{
  const obj=JSON.parse(line);
  if(obj.type==='control_response'){clearInterval(questionKeepAlive);if(obj.response.request_id==='native-approval'&&obj.response.response.behavior==='allow')fs.appendFileSync(process.env.POCKET_TEST_CALLS+'.approved',id+'\n');const msg={type:'assistant',message:{role:'assistant',content:[{type:'text',text:'Blue'}]}};append(msg);console.log(JSON.stringify(msg));console.log(JSON.stringify({type:'result',subtype:'success'}));return;}
  const text=obj.message.content[0].text;
  fs.appendFileSync(process.env.POCKET_TEST_CALLS,JSON.stringify({id,pid:process.pid,text,permissionMode:args[args.indexOf('--permission-mode')+1],model:args.includes('--model')?args[args.indexOf('--model')+1]:null,effort:JSON.parse(args[args.indexOf('--settings')+1]||'{}').effortLevel??null})+'\n');
  // like the real CLI, a message steered into a running turn reaches the transcript only at the next step
  if(!working)append({type:'user',message:{role:'user',content:text}});
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
    reply('Test response.');
    working=false;
  },text.includes('__SLOW__')?1800:300);
});
