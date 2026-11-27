import fs from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';

const fail=(message,status=409)=>Object.assign(new Error(message),{status});
export function approvalMode(value,defaultMode='review',allowFull=true){
 const mode=value??defaultMode;
 if(!['review','full'].includes(mode))throw fail('Choose Review actions or Full access.',400);
 if(mode==='full'&&!allowFull)throw fail('Full access is disabled on this instance.',403);
 return mode;
}
export function claudePermissionSettings(mode){
 return {permissionMode:mode==='full'?'bypassPermissions':'default',permissions:{ask:mode==='full'?['AskUserQuestion']:['AskUserQuestion','Bash','PowerShell','Edit','Write','NotebookEdit','Agent','Task','WebFetch','WebSearch','mcp__*']}};
}
export function codexPermissionSettings(mode){
 return mode==='full'?{sandbox:'danger-full-access',approvalPolicy:'never'}:{sandbox:'read-only',approvalPolicy:'untrusted',config:{approvals_reviewer:'user'}};
}
// Store only identifiers, hashes and decisions. Tool arguments may contain secrets.
// 1.124.4: a full disk or a file-size limit makes write(2) return a short count, not an error. A row cut short is not a
// record: the file goes back to the size it had before the row (no fragment for the next row to join) and the audit
// throws, so decide() answers 503 and autoAllow() shows a card. If the truncate fails too, it still throws.
export function approvalAudit(file){
 return record=>{
  const fd=fs.openSync(file,'a',0o600);
  try{
   const row=Buffer.from(JSON.stringify({at:new Date().toISOString(),...record})+'\n'),before=fs.fstatSync(fd).size;
   let written=0;
   try{written=fs.writeSync(fd,row);}finally{if(written!==row.length)try{fs.ftruncateSync(fd,before);}catch{}}
   if(written!==row.length)throw Object.assign(new Error(`approval record cut short (${written} of ${row.length} bytes written)`),{code:'EIO'});
   fs.fsyncSync(fd);
  }finally{fs.closeSync(fd);}
 };
}
export class ApprovalInbox {
 constructor({sessionId,turnId,write,audit=()=>{},onChange=()=>{},onAutoError=()=>{},onGone=()=>{}}){
  this.onGone=onGone;this.onAutoError=onAutoError;this.autoAnswered=new Set();this.sessionId=sessionId;this.turnId=turnId;this.write=write;this.audit=audit;this.onChange=onChange;this.pending=new Map();this.answered=new Map();this.closed=false;
 }
 // 1.82: `agent` names the subagent that asked, when the request came from one; it is shown, never fingerprinted.
 // 1.126: `facts`, what an engine saw in the request that the card's details leave out (acp.mjs approvalFacts), read by
 // approval-push.mjs; never listed, never fingerprinted. A row also gains `push` when its notification is sent.
 receive({nativeId,turnId,kind,title,details,allow,deny,canAllow=true,agent=null,facts=null}){
  if(this.closed||nativeId==null||!turnId||turnId!==this.turnId()||this.pending.size>=20)return false;
  const text=JSON.stringify(details,null,2);
  if(!text||text.length>200000)return false; // Never approve a truncated preview.
  const fingerprint=createHash('sha256').update(JSON.stringify({kind,title,details,allow,deny})).digest('hex');
  const prior=[...this.pending.values()].find(r=>r.nativeId===nativeId);
  if(prior)return prior.fingerprint===fingerprint;
  const row={id:randomUUID(),nativeId,turnId,kind,title,details:text,allow,deny,canAllow,fingerprint,createdAt:Date.now(),status:'pending',agent:typeof agent==='string'&&agent?agent.slice(0,240):null,...(facts&&typeof facts==='object'?{facts}:{})};
  try{this.audit({event:'requested',sessionId:this.sessionId(),turnId,requestId:row.id,kind,fingerprint});}catch{return false;}
  this.pending.set(row.id,row);this.onChange();return true;
 }
 // 1.56: a request matching one of the owner's trusted rules (trusted.mjs) is answered Allow without a
 // card. Same guarantees as a tapped Allow: bound to this live turn, recorded before the pipe is written.
 // Returns false (show the card instead) whenever it cannot do that: closed or old turn, an oversized
 // request, a card already open for it, or an audit that cannot be written.
 autoAllow({nativeId,turnId,kind,title,details,allow,deny,rule,tool}){
  if(this.closed||nativeId==null||!turnId||turnId!==this.turnId()||!rule)return false;
  if(this.autoAnswered.has(nativeId))return true;
  if([...this.pending.values()].some(r=>r.nativeId===nativeId))return false;
  const text=JSON.stringify(details,null,2);
  if(!text||text.length>200000)return false;
  const fingerprint=createHash('sha256').update(JSON.stringify({kind,title,details,allow,deny})).digest('hex');
  try{this.audit({event:'auto-allowed',sessionId:this.sessionId(),turnId,requestId:randomUUID(),kind,tool,fingerprint,decision:'allow',source:'auto-trusted',rule});}catch{return false;}
  this.autoAnswered.add(nativeId);
  if(this.autoAnswered.size>500)this.autoAnswered.delete(this.autoAnswered.values().next().value);
  // A failed write means the turn's input pipe is gone; nothing else can be sent on it either.
  Promise.resolve().then(()=>this.write(nativeId,allow)).catch(e=>this.onAutoError(e,{tool,rule}));
  return true;
 }
 list(){return [...this.pending.values()].map(({nativeId,allow,deny,fingerprint,facts,push,gone,...r})=>r);}
 // 1.126: the inbox's own row (for the notification rules), and whether an id was answered here and how.
 row(id){return this.pending.get(id)||null;}
 rows(){return [...this.pending.values()];}
 answeredAs(id){return this.answered.get(id)||null;}
 // 1.126: an answer from away from the app that was refused (notification-approvals.md, Part 7): ids, codes and where it
 // said it came from, never the command. Best effort: the refusal stands whether or not the line could be written.
 refuse(id,{source,device,pushService,reason,action}={}){
  const row=this.pending.get(id);
  try{this.audit({event:'refused',sessionId:this.sessionId(),turnId:row?.turnId||this.turnId(),requestId:id,...(row?{kind:row.kind}:{}),source,...(device?{device}:{}),...(pushService?{pushService}:{}),...(action?{action}:{}),reason});return true;}catch{return false;}
 }
 gone(rows,info){if(rows.length)try{this.onGone(rows,info);}catch{}}
 // 1.126: `meta` says where the answer came from ({source:'app'|'notification', device, pushService, action}); it is written
 // with the decision, and after an answer the onGone hook hears of it (to update the other devices' notifications).
 async decide(id,decision,meta={}){
  if(!['allow','deny'].includes(decision))throw fail("Choose Allow or Don't allow.",400); // 1.81: the buttons' current names
  const prior=this.answered.get(id);
  if(prior){if(prior!==decision)throw fail('This action was already answered differently.');return {ok:true,duplicate:true};}
  const row=this.pending.get(id);
  if(this.closed||!row||row.turnId!==this.turnId())throw fail('This action is no longer waiting. Refresh the approvals.');
  if(row.status!=='pending')throw fail('The decision was already sent or could not be confirmed. Refresh before continuing.');
  if(decision==='allow'&&!row.canAllow)throw fail('This request cannot be approved safely here. Deny it and ask for a supported action.',400);
  // Persist the decision before touching the native pipe. Failed transport is uncertain,
  // never permission to retry an Allow against another action or provider connection.
  const source=meta.source||'app',where=source==='app'?{}:{device:meta.device||'unknown',...(meta.pushService?{pushService:meta.pushService}:{}),...(meta.action?{action:meta.action}:{})};
  try{this.audit({event:'decision',sessionId:this.sessionId(),turnId:row.turnId,requestId:id,kind:row.kind,fingerprint:row.fingerprint,decision,source,...where});}
  catch{throw fail('Could not record this decision. Nothing was approved; try again.',503);}
  row.status='sending';this.onChange();
  try{await this.write(row.nativeId,decision==='allow'?row.allow:row.deny);}
  catch{row.status='uncertain';this.onChange();throw fail('Delivery of this decision is uncertain. Stop the reply and review the conversation; do not approve it again.',503);}
  this.pending.delete(id);this.answered.set(id,decision);
  if(this.answered.size>200)this.answered.delete(this.answered.keys().next().value);
  this.gone([row],{why:'answered',decision,source,device:meta.device||null,at:Date.now()});
  this.onChange();return {ok:true,decision};
 }
 resolve(nativeId){const out=[];for(const [id,r] of this.pending)if(r.nativeId===nativeId){this.pending.delete(id);out.push(r);}this.gone(out,{why:'withdrawn',at:Date.now()});this.onChange();}
 clear(){this.closed=true;const out=[...this.pending.values()];this.pending.clear();this.gone(out,{why:'ended',at:Date.now()});this.onChange();}
}

export function codexApproval(request,turn){
 const p=request.params;if(p?.threadId!==turn.threadId||!p.turnId||p.turnId!==turn.turnId)return null;
 const common={nativeId:request.id,turnId:p.turnId,deny:{decision:'decline'},allow:{decision:'accept'}};
 if(request.method==='item/commandExecution/requestApproval')return {...common,kind:p.networkApprovalContext?'network':'command',title:p.networkApprovalContext?'Allow network access?':'Run this command?',details:{command:p.command,cwd:p.cwd,reason:p.reason,network:p.networkApprovalContext,additionalPermissions:p.additionalPermissions,kind:p.kind||'command'},canAllow:Boolean(p.command||p.networkApprovalContext)&&(!p.availableDecisions||p.availableDecisions.includes('accept'))};
 if(request.method==='item/fileChange/requestApproval'){
  const item=turn.approvalItems.get(p.itemId);
  return {...common,kind:'fileChange',title:'Apply these file changes?',details:{cwd:turn.cwd,reason:p.reason,changes:item?.changes,grantRoot:p.grantRoot},canAllow:Boolean(item?.changes?.length)&&!p.grantRoot};
 }
 if(request.method==='item/permissions/requestApproval')return {...common,kind:'permissions',title:'Allow access for this reply?',details:{cwd:p.cwd,reason:p.reason,permissions:p.permissions},canAllow:Boolean(p.permissions&&typeof p.permissions==='object'&&!Array.isArray(p.permissions)),allow:{permissions:p.permissions,scope:'turn'},deny:{permissions:{},scope:'turn'}};
 return null;
}
