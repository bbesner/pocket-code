// 1.64: a session whose reply ended but whose background jobs (Bash run in the background, subagents)
// are still running reads Working in background, ahead of Response ready and the transcript's age.
import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionState, backgroundSummary, prioritizeSessions} from '../session-state.mjs';

const bash={task_id:'b1',task_type:'local_bash',description:'Run the full test suites'};
const agent={task_id:'a1',task_type:'local_agent',subagent_type:'general-purpose',description:'Audit the images'};
const outcome={kind:'finished',label:'Response ready',at:1000};

test('background jobs outrank a finished outcome and transcript age, never a live turn or a usage wait',()=>{
  const bg=sessionState({turn:null,outcome,mtimeMs:1000,background:[bash]});
  assert.equal(bg.kind,'background');assert.equal(bg.confirmed,true);
  assert.equal(bg.label,'Working in background · 1 job');
  assert.deepEqual(bg.background,{count:1,summary:'1 job',jobs:[{kind:'job',description:'Run the full test suites'}]});
  assert.equal(sessionState({turn:null,outcome,mtimeMs:1000,background:[]}).kind,'finished');
  assert.equal(sessionState({turn:null,outcome,mtimeMs:1000}).kind,'finished');
  assert.equal(sessionState({turn:null,outcome,mtimeMs:99000,background:[bash],external:true}).kind,'background','transcript activity does not hide background work');
  assert.equal(sessionState({turn:{startedAt:5},background:[bash]}).kind,'running');
  assert.equal(sessionState({turn:null,retryAt:5,background:[bash]}).kind,'waiting');
});

test('the summary counts agents and jobs separately and never carries a long description',()=>{
  assert.equal(backgroundSummary([]),null);assert.equal(backgroundSummary(undefined),null);
  const two=backgroundSummary([agent,bash,{task_type:'local_agent',subagent_type:'Explore'}]);
  assert.equal(two.summary,'2 agents, 1 job');assert.equal(two.count,3);
  assert.equal(two.jobs[2].description,'Explore','a subagent without a description shows its type');
  assert.equal(sessionState({turn:null,background:[agent]}).label,'Working in background · 1 agent');
  assert.equal(backgroundSummary([{task_type:'local_bash',description:'x'.repeat(500)}]).jobs[0].description.length,120);
});

test('a session working in the background never ages out of the list',()=>{
  const rows=[{id:'a',state:{kind:'idle'}},{id:'b',state:{kind:'background'}},{id:'c',state:{kind:'idle'}}];
  assert.deepEqual(prioritizeSessions(rows,2).map(r=>r.id),['b','a']);
});

test('a transcript written after the outcome keeps it only when nothing but bookkeeping was added',()=>{
  assert.equal(sessionState({turn:null,outcome,mtimeMs:99000}).kind,'idle','a later write ends the outcome');
  assert.equal(sessionState({turn:null,outcome,mtimeMs:99000,external:true}).kind,'observed');
  assert.equal(sessionState({turn:null,outcome,mtimeMs:99000,quietSince:true}).kind,'finished','process-exit bookkeeping keeps it');
  assert.equal(sessionState({turn:null,outcome:null,mtimeMs:99000,quietSince:true}).kind,'idle','no outcome, nothing to keep');
  assert.equal(sessionState({turn:{startedAt:5},outcome,quietSince:true}).kind,'running','a live turn still leads');
});
