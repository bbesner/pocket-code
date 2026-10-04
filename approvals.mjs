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
export function approvalAudit(file){
 return record=>{
  const fd=fs.openSync(file,'a',0o600);
  try{fs.writeSync(fd,JSON.stringify({at:new Date().toISOString(),...record})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 };
}
export class ApprovalInbox {
 constructor({sessionId,turnId,write,audit=()=>{},onChange=()=>{}}){
  this.sessionId=sessionId;this.turnId=turnId;this.write=write;this.audit=audit;this.onChange=onChange;this.pending=new Map();this.answered=new Map();this.closed=false;
 }
 receive({nativeId,turnId,kind,title,details,allow,deny,canAllow=true}){
  if(this.closed||nativeId==null||!turnId||turnId!==this.turnId()||this.pending.size>=20)return false;
  const text=JSON.stringify(details,null,2);
  if(!text||text.length>200000)return false; // Never approve a truncated preview.
  const fingerprint=createHash('sha256').update(JSON.stringify({kind,title,details,allow,deny})).digest('hex');
  const prior=[...this.pending.values()].find(r=>r.nativeId===nativeId);
  if(prior)return prior.fingerprint===fingerprint;
  const row={id:randomUUID(),nativeId,turnId,kind,title,details:text,allow,deny,canAllow,fingerprint,createdAt:Date.now(),status:'pending'};
  try{this.audit({event:'requested',sessionId:this.sessionId(),turnId,requestId:row.id,kind,fingerprint});}catch{return false;}
  this.pending.set(row.id,row);this.onChange();return true;
 }
 list(){return [...this.pending.values()].map(({nativeId,allow,deny,fingerprint,...r})=>r);}
 async decide(id,decision){
  if(!['allow','deny'].includes(decision))throw fail('Choose Allow once or Deny.',400);
  const prior=this.answered.get(id);
  if(prior){if(prior!==decision)throw fail('This action was already answered differently.');return {ok:true,duplicate:true};}
  const row=this.pending.get(id);
  if(this.closed||!row||row.turnId!==this.turnId())throw fail('This action is no longer waiting. Refresh the approvals.');
  if(row.status!=='pending')throw fail('The decision was already sent or could not be confirmed. Refresh before continuing.');
  if(decision==='allow'&&!row.canAllow)throw fail('This request cannot be approved safely here. Deny it and ask for a supported action.',400);
  // Persist the decision before touching the native pipe. Failed transport is uncertain,
  // never permission to retry an Allow against another action or provider connection.
  try{this.audit({event:'decision',sessionId:this.sessionId(),turnId:row.turnId,requestId:id,kind:row.kind,fingerprint:row.fingerprint,decision});}
  catch{throw fail('Could not record this decision. Nothing was approved; try again.',503);}
  row.status='sending';this.onChange();
  try{await this.write(row.nativeId,decision==='allow'?row.allow:row.deny);}
  catch{row.status='uncertain';this.onChange();throw fail('Delivery of this decision is uncertain. Stop the turn and review the conversation; do not approve it again.',503);}
  this.pending.delete(id);this.answered.set(id,decision);
  if(this.answered.size>200)this.answered.delete(this.answered.keys().next().value);
  this.onChange();return {ok:true,decision};
 }
 resolve(nativeId){for(const [id,r] of this.pending)if(r.nativeId===nativeId)this.pending.delete(id);this.onChange();}
 clear(){this.closed=true;this.pending.clear();this.onChange();}
}

export function codexApproval(request,turn){
 const p=request.params;if(p?.threadId!==turn.threadId||!p.turnId||p.turnId!==turn.turnId)return null;
 const common={nativeId:request.id,turnId:p.turnId,deny:{decision:'decline'},allow:{decision:'accept'}};
 if(request.method==='item/commandExecution/requestApproval')return {...common,kind:p.networkApprovalContext?'network':'command',title:p.networkApprovalContext?'Allow network access?':'Run this command?',details:{command:p.command,cwd:p.cwd,reason:p.reason,network:p.networkApprovalContext,additionalPermissions:p.additionalPermissions,kind:p.kind||'command'},canAllow:Boolean(p.command||p.networkApprovalContext)&&(!p.availableDecisions||p.availableDecisions.includes('accept'))};
 if(request.method==='item/fileChange/requestApproval'){
  const item=turn.approvalItems.get(p.itemId);
  return {...common,kind:'fileChange',title:'Apply these file changes?',details:{cwd:turn.cwd,reason:p.reason,changes:item?.changes,grantRoot:p.grantRoot},canAllow:Boolean(item?.changes?.length)&&!p.grantRoot};
 }
 if(request.method==='item/permissions/requestApproval')return {...common,kind:'permissions',title:'Allow access for this turn?',details:{cwd:p.cwd,reason:p.reason,permissions:p.permissions},canAllow:Boolean(p.permissions&&typeof p.permissions==='object'&&!Array.isArray(p.permissions)),allow:{permissions:p.permissions,scope:'turn'},deny:{permissions:{},scope:'turn'}};
 return null;
}
