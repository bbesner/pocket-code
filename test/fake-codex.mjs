#!/usr/bin/env node
// Integration-only Codex app-server: JSON-RPC over stdio, never calls a model.
// Simulates the per-thread writer lock that a loaded thread holds until the process exits.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {randomUUID} from 'node:crypto';
const root=process.env.POCKET_SESSION_ROOT,calls=process.env.POCKET_TEST_CALLS;
if(!root||!calls)throw Error('Test environment required');
const lockDir=path.join(root,'codex-locks');fs.mkdirSync(lockDir,{recursive:true});
const held=new Set();
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}};
function takeLock(id){
  const f=path.join(lockDir,id);
  try{const pid=Number(fs.readFileSync(f,'utf8'));if(pid!==process.pid&&alive(pid))return false;}catch{}
  fs.writeFileSync(f,String(process.pid));held.add(id);return true;
}
process.on('exit',()=>{for(const id of held){try{fs.unlinkSync(path.join(lockDir,id))}catch{}}});
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>process.exit(0));
setInterval(()=>{if(!fs.existsSync(root))process.exit(0)},300).unref();
const send=o=>process.stdout.write(JSON.stringify(o)+'\n');
const notify=(method,params)=>send({jsonrpc:'2.0',method,params});
const reply=(id,result)=>send({jsonrpc:'2.0',id,result});
const fail=(id,message)=>send({jsonrpc:'2.0',id,error:{code:-32600,message}});
readline.createInterface({input:process.stdin}).on('line',line=>{
  let m;try{m=JSON.parse(line)}catch{return}
  if(m.id==null)return; // notifications and responses
  const p=m.params||{};
  if(m.method==='thread/start'||m.method==='thread/resume')fs.appendFileSync(calls+'.threads',JSON.stringify({method:m.method,choices:/`choices`/.test(p.developerInstructions||'')})+'\n');
  switch(m.method){
    case 'initialize':return reply(m.id,{});
    case 'thread/start':{const id=randomUUID();takeLock(id);return reply(m.id,{thread:{id},model:'gpt-test',reasoningEffort:null});}
    case 'thread/resume':
      if(!takeLock(p.threadId))return fail(m.id,`thread ${p.threadId} already has an active writer`);
      return reply(m.id,{model:'gpt-test',reasoningEffort:null,cwd:p.cwd||process.cwd()});
    case 'turn/start':{
      const text=p.input?.[0]?.text||'',turnId=randomUUID();
      fs.appendFileSync(calls+'.codex',JSON.stringify({threadId:p.threadId,pid:process.pid,text})+'\n');
      reply(m.id,{turn:{id:turnId}});
      notify('turn/started',{turnId});
      if(text.includes('__HANG__'))return;
      if(text.includes('__AGENTS__')){
        const item={id:'agent-spawn',type:'collabAgentToolCall',tool:'spawnAgent',status:'completed',receiverThreadIds:['child-agent'],agentsStates:{'child-agent':{status:'running'}},prompt:'Check parser failures',model:'gpt-test'};
        notify('item/completed',{item});
        fs.writeFileSync(path.join(root,p.threadId+'.items.json'),JSON.stringify([item]));
        setTimeout(()=>{
          const done={...item,id:'agent-wait',tool:'wait',agentsStates:{'child-agent':{status:'completed',message:'Parser checks passed.'}}};
          fs.writeFileSync(path.join(root,p.threadId+'.items.json'),JSON.stringify([item,done]));
          notify('item/completed',{item:done});
        },1000);
      }
      setTimeout(()=>{
        notify('item/agentMessage/delta',{delta:'Codex test '});
        notify('item/completed',{item:{type:'agentMessage',id:randomUUID(),text:'Codex test response.'}});
        notify('turn/completed',{turn:{id:turnId,status:'completed'}});
      },text.includes('__SLOW__')?1500:200);
      return;
    }
    case 'turn/interrupt':reply(m.id,{});return notify('turn/completed',{turn:{id:p.turnId,status:'interrupted'}});
    case 'thread/items/list':{
      let data=[];try{data=JSON.parse(fs.readFileSync(path.join(root,p.threadId+'.items.json'),'utf8'));}catch{}
      return reply(m.id,{data,nextCursor:null});
    }
    case 'thread/list':case 'model/list':case 'skills/list':return reply(m.id,{data:[],nextCursor:null});
    case 'thread/read':return reply(m.id,{thread:{id:p.threadId,turns:[],preview:'',cwd:process.cwd()}});
    default:return fail(m.id,'unsupported in fake codex: '+m.method);
  }
});
