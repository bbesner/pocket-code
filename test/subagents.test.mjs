import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AgentActivity,ClaudeAgentFiles,SubagentIndex,subagentDir} from '../subagents.mjs';
const use=(id='tool-1',background=false)=>({type:'assistant',message:{content:[{type:'tool_use',id,name:'Agent',input:{description:'Review imports',prompt:'Check duplicate SKUs.',run_in_background:background}}]}});
const task=(subtype,patch={})=>({type:'system',subtype,task_type:'local_agent',task_id:'a1',tool_use_id:'tool-1',...patch});
test('Claude deduplicates tool/task ids, excludes Bash jobs and retains completed work',()=>{
 const a=new AgentActivity();a.claude(use());a.claude(task('task_started',{description:'Review imports',prompt:'Check duplicate SKUs.'}));
 a.claude(task('task_started',{task_type:'local_bash',task_id:'bash',tool_use_id:'shell',description:'npm test'}));
 a.claude(task('task_progress',{last_tool_name:'Read',usage:{tool_uses:3,total_tokens:400}}));
 assert.equal(a.snapshot({confirmed:true}).running,1);assert.equal(a.snapshot({confirmed:true}).total,1);
 assert.equal(a.snapshot({confirmed:true}).agents[0].latest,'Using Read');
 assert.equal(a.snapshot().agents[0].status,'unknown');
 a.claude(task('task_notification',{status:'completed',summary:'No duplicates.'}));
 a.claude(use());a.claude(task('task_started')); // transcript and runner replay overlap
 const s=a.snapshot({confirmed:true});assert.equal(s.running,0);assert.equal(s.total,1);assert.equal(s.agents[0].latest,'No duplicates.');
});
test('Claude background launch is not completion; parent can finish before the agent',()=>{
 const a=new AgentActivity();a.claude(use('tool-1',true));
 a.claude({type:'user',tool_use_result:{isAsync:true,agentId:'a1'},message:{content:[{type:'tool_result',tool_use_id:'tool-1',content:'Async agent launched successfully. agentId: a1'}]}});
 a.claude(task('task_started'));assert.equal(a.snapshot({backgroundIds:['a1']}).running,1);
 a.claude({type:'user',message:{content:'<task-notification><task-id>a1</task-id><status>completed</status><summary>Finished review.</summary></task-notification>'}});
 assert.equal(a.snapshot().agents[0].status,'completed');
 assert.equal(a.snapshot().agents[0].latest,'Finished review.');
 assert.equal(a.snapshot({confirmed:true}).total,1);assert.equal(a.snapshot({confirmed:true}).running,0);
});
test('Codex counts agents not collaboration calls, and tool completion is not agent completion',()=>{
 const a=new AgentActivity();
 a.codex({type:'collabAgentToolCall',tool:'spawnAgent',status:'completed',receiverThreadIds:['child'],agentsStates:{child:{status:'running'}},prompt:'Review tests',model:'test-model'});
 a.codex({type:'subAgentActivity',agentThreadId:'child',agentPath:'/root/review',kind:'started'});
 a.codex({type:'collabAgentToolCall',tool:'wait',status:'completed',receiverThreadIds:['child'],agentsStates:{child:{status:'running'}}});
 assert.equal(a.snapshot({confirmed:true}).running,1);assert.equal(a.snapshot().total,1);
 a.codex({type:'collabAgentToolCall',tool:'wait',status:'completed',receiverThreadIds:['child'],agentsStates:{child:{status:'completed',message:'Tests pass'}}});
 a.codex({type:'subAgentActivity',agentThreadId:'child',agentPath:'/root/review',kind:'interacted'});
 assert.equal(a.snapshot({confirmed:true}).running,0);assert.equal(a.snapshot().agents[0].task,'Review tests');
 a.codex({type:'collabAgentToolCall',tool:'followupTask',status:'completed',receiverThreadIds:['child'],prompt:'Also check errors',agentsStates:{child:{status:'running'}}});
 assert.equal(a.snapshot({confirmed:true}).running,1);assert.equal(a.snapshot().agents[0].task,'Also check errors');
});
test('File replay handles partial lines, appended completion, truncation and fresh daemon caches',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pocket-agents-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'events.ndjson'),cache=new ClaudeAgentFiles();
 const line=JSON.stringify(use());await fs.writeFile(file,line.slice(0,40));assert.equal((await cache.read(file)).events.length,0);
 await fs.appendFile(file,line.slice(40)+'\n');assert.equal((await cache.read(file)).events.length,1);
 await fs.appendFile(file,JSON.stringify({type:'user',message:{content:[{type:'tool_result',tool_use_id:'tool-1',content:'Reviewed ✓'}]}})+'\n');
 const a=new AgentActivity();for(const e of (await cache.read(file)).events)a.claude(e);
 assert.equal(a.snapshot().agents[0].status,'completed');assert.equal(a.snapshot().agents[0].latest,'Reviewed ✓');
 assert.deepEqual((await new ClaudeAgentFiles().read(file)).events,(await cache.read(file)).events);
 await fs.writeFile(file,'{}\n');assert.equal((await cache.read(file)).events.length,0);
});

test('A later parent turn does not revive an unfinished foreground agent',()=>{
 const a=new AgentActivity();a.claude(use());a.claude({type:'result'});
 a.claude(use());a.claude(task('task_started')); // a second source replays the same invocation
 a.claude(task('task_updated',{status:'running'}));
 a.claude(task('task_updated',{patch:{status:'pendingInit'}}));
 assert.equal(a.snapshot({confirmed:true}).running,0);
 assert.equal(a.snapshot({confirmed:true}).agents[0].status,'unknown');
 assert.equal(a.snapshot({confirmed:true}).total,1);
 assert.equal('runEnded' in a.snapshot().agents[0],false);
 a.claude(task('task_notification',{status:'completed',summary:'Delayed completion record'}));
 assert.equal(a.snapshot().agents[0].status,'completed');
});

// 1.82: the CLI's own subagent transcripts name the agent for a permission request and show what it has done.
test('SubagentIndex reads agent transcripts incrementally, names the agent for a tool call, and feeds the activity',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pocket-subagents-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'s1.jsonl');await fs.writeFile(file,'');
 const sub=subagentDir(file,'s1');assert.equal(sub,path.join(dir,'s1','subagents'));
 const index=new SubagentIndex();
 assert.deepEqual(index.summary(sub),[]);assert.equal(index.agentFor(sub,'toolu_x'),null); // no directory yet
 await fs.mkdir(sub,{recursive:true});
 await fs.writeFile(path.join(sub,'agent-a1.meta.json'),JSON.stringify({agentType:'general-purpose',description:'Review imports',toolUseId:'tool-1',requestShape:'background',model:'test-model'}));
 const line=o=>JSON.stringify({agentId:'a1',isSidechain:true,timestamp:'2026-10-27T12:00:00.000Z',...o})+'\n';
 const bash=line({type:'assistant',message:{content:[{type:'tool_use',id:'toolu_bash',name:'Bash',input:{command:'npm test'}}]}});
 await fs.writeFile(path.join(sub,'agent-a1.jsonl'),line({type:'user',message:{content:'Check duplicate SKUs.'}})+line({type:'assistant',message:{content:[{type:'text',text:'Looking at the imports ✓'}]}})+bash.slice(0,30));
 let [a]=index.summary(sub);
 assert.equal(a.name,'Review imports');assert.equal(a.kind,'general-purpose');assert.equal(a.model,'test-model');assert.equal(a.toolUseId,'tool-1');assert.equal(a.background,true);
 assert.equal(a.messages,1);assert.equal(a.steps,0);assert.equal(a.latest,'Looking at the imports ✓');assert.equal(index.agentFor(sub,'toolu_bash'),null,'a partial line is not read yet');
 await fs.appendFile(path.join(sub,'agent-a1.jsonl'),bash.slice(30));
 assert.equal(index.agentFor(sub,'toolu_bash')?.name,'Review imports');
 [a]=index.summary(sub);assert.equal(a.steps,1);assert.equal(a.latest,'Using Bash');
 assert.equal(index.file(sub,'a1').file,path.join(sub,'agent-a1.jsonl'));assert.equal(index.file(sub,'zz'),null);
 // The merge: the parent's Agent call becomes the agent the files describe, keyed by its id.
 const act=new AgentActivity();act.claude(use('tool-1',true));act.files(index.summary(sub));
 let s=act.snapshot({backgroundIds:['a1']});
 assert.equal(s.total,1);assert.equal(s.agents[0].id,'a1');assert.equal(s.agents[0].name,'Review imports');assert.equal(s.agents[0].latest,'Using Bash');assert.equal(s.agents[0].steps,1);assert.equal(s.agents[0].activity,true);assert.equal(s.agents[0].status,'running');
 act.claude(task('task_started',{task_id:'a1',tool_use_id:'tool-1'}));act.files(index.summary(sub));
 assert.equal(act.snapshot({backgroundIds:['a1']}).total,1,'a later task record does not duplicate the agent');
 // A finished agent keeps its reported result as the latest line.
 act.claude({type:'user',message:{content:'<task-notification><task-id>a1</task-id><status>completed</status><summary>No duplicates.</summary></task-notification>'}});
 act.files(index.summary(sub));s=act.snapshot();assert.equal(s.agents[0].status,'completed');assert.equal(s.agents[0].latest,'No duplicates.');
 // A rewritten file is read from the start again.
 await fs.writeFile(path.join(sub,'agent-a1.jsonl'),line({type:'assistant',message:{content:[{type:'text',text:'Fresh start'}]}}));
 [a]=index.summary(sub);assert.equal(a.steps,0);assert.equal(a.latest,'Fresh start');
});
