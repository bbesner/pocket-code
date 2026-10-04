import test from 'node:test';import assert from 'node:assert/strict';import {QuestionInbox} from '../questions.mjs';
const request={id:7,method:'item/tool/requestUserInput',params:{threadId:'thread',turnId:'turn',isBlocking:true,questions:[{id:'choice',header:'Choice',question:'Choose a color',options:[{label:'Blue',description:'Cool'}]}]}};
test('native questions are scoped to the owning turn and replies are validated/idempotent',()=>{
 const writes=[];const inbox=new QuestionInbox({threadId:()=> 'thread',write:r=>writes.push(r)});
 assert.equal(inbox.receive({...request,params:{...request.params,threadId:'other'}},'turn'),false);
 assert.equal(inbox.receive(request,'other'),false);assert.equal(inbox.receive(request,'turn'),true);assert.equal(inbox.receive(request,'turn'),true);assert.equal(inbox.list().length,1);
 const id=inbox.list()[0].id;assert.throws(()=>inbox.answer(id,{}),{status:400});
 assert.deepEqual(inbox.answer(id,{choice:['Blue']}),{ok:true});assert.equal(inbox.answer(id,{choice:['Blue']}).duplicate,true);assert.equal(writes.length,1);assert.equal(writes[0].id,7);assert.deepEqual(writes[0].result.answers.choice.answers,['Blue']);
 assert.throws(()=>inbox.answer(id,{choice:['Red']}),{status:409});assert.equal(inbox.list().length,0);
 inbox.receive({...request,id:8},'turn');const pending=inbox.list()[0].id;inbox.resolve(8);assert.throws(()=>inbox.answer(pending,{choice:['Blue']}),{status:409});
});
test('closed provider connections cannot acknowledge an answer',()=>{
 const inbox=new QuestionInbox({threadId:()=> 'thread',write:()=>{throw new Error('closed');}});inbox.receive(request,'turn');assert.throws(()=>inbox.answer(inbox.list()[0].id,{choice:['Blue']}),/closed/);assert.equal(inbox.list().length,1);
});
test('multiple choices are preserved and malformed requests are declined',()=>{
 const writes=[];const inbox=new QuestionInbox({threadId:()=> 'thread',write:r=>writes.push(r)});
 assert.equal(inbox.receive({...request,params:{...request.params,questions:[null]}},'turn'),false);
 inbox.receive({...request,params:{...request.params,questions:[{...request.params.questions[0],multiple:true}]}},'turn');
 inbox.answer(inbox.list()[0].id,{choice:['Blue','Red']});assert.deepEqual(writes[0].result.answers.choice.answers,['Blue','Red']);
});
