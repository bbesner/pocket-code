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
  if(obj.type==='control_response'){clearInterval(questionKeepAlive);const msg={type:'assistant',message:{role:'assistant',content:[{type:'text',text:'Blue'}]}};append(msg);console.log(JSON.stringify(msg));console.log(JSON.stringify({type:'result',subtype:'success'}));return;}
  const text=obj.message.content[0].text;
  fs.appendFileSync(process.env.POCKET_TEST_CALLS,JSON.stringify({id,text})+'\n');
  append({type:'user',message:{role:'user',content:text}});
  if(text.includes('__QUESTION__')){questionKeepAlive=setInterval(()=>{},1000);console.log(JSON.stringify({type:'control_request',request_id:'native-test',request:{subtype:'can_use_tool',tool_name:'AskUserQuestion',input:{questions:[{header:'Color',question:'Which color?',options:[{label:'Blue',description:'Cool'},{label:'Red',description:'Warm'}],multiSelect:false}]}}}));return;}
  if (working) return;
  working=true;
  setTimeout(()=>{
    append({type:'assistant',message:{role:'assistant',content:[{type:'text',text:'Test response.'}]}});
    console.log(JSON.stringify({type:'assistant',message:{role:'assistant',content:[{type:'text',text:'Test response.'}]}}));
    console.log(JSON.stringify({type:'result',subtype:text.includes('__FAIL__')?'error':'success',result:'Test result',duration_ms:300}));
  },text.includes('__SLOW__')?1800:300);
});
