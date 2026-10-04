import {randomUUID,createHash} from 'node:crypto';
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
// Pending questions belong to one live provider connection. Never infer them from prose.
export class QuestionInbox {
 constructor({threadId,write,onChange=()=>{}}){this.threadId=threadId;this.write=write;this.onChange=onChange;this.pending=new Map();this.answered=new Map();}
 receive(request,turnId){
  const p=request.params;
  if(request.method!=='item/tool/requestUserInput'||p?.threadId!==this.threadId()||!p.turnId||(turnId&&p.turnId!==turnId))return false;
  if(!Array.isArray(p.questions)||!p.questions.length||p.questions.length>10)return false;
  const ids=new Set();
  for(const q of p.questions){
   if(!q||typeof q.id!=='string'||!q.id||ids.has(q.id)||typeof q.question!=='string'||q.question.length>20000)return false;
   if(q.options!=null&&(!Array.isArray(q.options)||q.options.length>30||q.options.some(o=>typeof o.label!=='string'||typeof o.description!=='string')))return false;
   ids.add(q.id);
  }
  if([...this.pending.values()].some(r=>r.nativeId===request.id))return true;
  if(this.pending.size>=20)return false;
  const id=randomUUID();
  this.pending.set(id,{id,nativeId:request.id,turnId:p.turnId,createdAt:Date.now(),blocking:p.isBlocking!==false,questions:p.questions.map(q=>({id:q.id,header:String(q.header||''),question:q.question,isSecret:Boolean(q.isSecret),multiple:Boolean(q.multiple),options:q.options?.map(o=>({label:o.label,description:o.description}))||[]}))});
  this.onChange();return true;
 }
 list(){return [...this.pending.values()].map(({nativeId,...row})=>row);}
 answer(id,answers){
  const fingerprint=createHash('sha256').update(JSON.stringify(answers)).digest('hex');
  if(this.answered.has(id)){if(this.answered.get(id)!==fingerprint)throw fail('This question was already answered differently.');return {ok:true,duplicate:true};}
  const row=this.pending.get(id);if(!row)throw fail('This question is no longer waiting for an answer. Refresh the session.');
  if(!answers||typeof answers!=='object'||Array.isArray(answers)||Object.keys(answers).length!==row.questions.length)throw fail('Answer each question before sending.',400);
  const result=Object.create(null);
  for(const q of row.questions){const a=answers[q.id];if(!Array.isArray(a)||a.length<1||a.length>(q.multiple?30:1)||a.some(v=>typeof v!=='string'||!v.trim()||v.length>10000))throw fail('Answer each question before sending.',400);result[q.id]={answers:a};}
  // Write once; a lost HTTP response is a receipt check, never another provider reply.
  this.write({jsonrpc:'2.0',id:row.nativeId,result:{answers:result}});
  this.answered.set(id,fingerprint);this.pending.delete(id);if(this.answered.size>100)this.answered.delete(this.answered.keys().next().value);this.onChange();
  return {ok:true};
 }
 resolve(nativeId){for(const [id,row] of this.pending)if(row.nativeId===nativeId)this.pending.delete(id);this.onChange();}
 clear(){this.pending.clear();this.onChange();}
}
