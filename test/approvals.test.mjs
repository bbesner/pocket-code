import test from 'node:test';
import assert from 'node:assert/strict';
import {ApprovalInbox,approvalMode,claudePermissionSettings,codexPermissionSettings,codexApproval} from '../approvals.mjs';

const request={nativeId:'native-1',turnId:'turn-1',kind:'command',title:'Run command?',details:{command:'echo confidential'},allow:{decision:'accept'},deny:{decision:'decline'}};
function inbox(options={}){const writes=[],audit=[];return {writes,audit,box:new ApprovalInbox({sessionId:()=> 'session-1',turnId:()=> 'turn-1',write:async(id,result)=>writes.push({id,result}),audit:r=>audit.push(r),...options})};}
test('approvals are scoped, explicit, idempotent, and audit only hashes',async()=>{
 const {box,writes,audit}=inbox();assert.equal(box.receive({...request,turnId:'other'}),false);assert.equal(box.receive(request),true);assert.equal(box.receive(request),true);
 assert.equal(box.list().length,1);assert.equal(writes.length,0);
 const id=box.list()[0].id;assert.equal(box.list()[0].nativeId,undefined);
 await assert.rejects(box.decide(id,'acceptForSession'),{status:400});
 await box.decide(id,'allow');assert.deepEqual(writes,[{id:'native-1',result:{decision:'accept'}}]);
 assert.equal((await box.decide(id,'allow')).duplicate,true);assert.equal(writes.length,1);
 await assert.rejects(box.decide(id,'deny'),{status:409});
 assert.equal(JSON.stringify(audit).includes('confidential'),false);assert.equal(audit[1].decision,'allow');
});
test('concurrent or uncertain writes never send approval twice',async()=>{
 let release;let writes=0;const {box}=inbox({write:()=>{writes++;return new Promise(r=>release=r);}});box.receive(request);const id=box.list()[0].id;
 const first=box.decide(id,'deny');await assert.rejects(box.decide(id,'allow'),{status:409});release();await first;assert.equal(writes,1);
 const broken=inbox({write:async()=>{throw Error('pipe lost');}}).box;broken.receive(request);const bid=broken.list()[0].id;
 await assert.rejects(broken.decide(bid,'allow'),{status:503});assert.equal(broken.list()[0].status,'uncertain');await assert.rejects(broken.decide(bid,'allow'),{status:409});
});
test('audit failure, cancellation, closed turns and incomplete previews fail closed',async()=>{
 let unavailable=false;const {box,writes}=inbox({audit:()=>{if(unavailable)throw Error('disk full');}});box.receive(request);const id=box.list()[0].id;
 unavailable=true;await assert.rejects(box.decide(id,'allow'),{status:503});assert.equal(writes.length,0);assert.equal(box.list()[0].status,'pending');
 unavailable=false;box.resolve('native-1');await assert.rejects(box.decide(id,'allow'),{status:409});
 box.receive({...request,nativeId:'native-2',canAllow:false});const blocked=box.list()[0].id;await assert.rejects(box.decide(blocked,'allow'),{status:400});await box.decide(blocked,'deny');
 box.clear();assert.equal(box.receive(request),false);
 const limited=inbox().box;assert.equal(limited.receive({...request,details:{text:'x'.repeat(200001)}}),false);
});
test('review policies require provider permissions; instance can reject full access',()=>{
 assert.equal(approvalMode(undefined),'review');assert.throws(()=>approvalMode('typo'),{status:400});assert.throws(()=>approvalMode('full','review',false),{status:403});
 assert.equal(claudePermissionSettings('review').permissionMode,'default');assert.ok(claudePermissionSettings('review').permissions.ask.includes('Bash'));
 assert.equal(claudePermissionSettings('full').permissionMode,'bypassPermissions');assert.equal(codexPermissionSettings('review').sandbox,'read-only');assert.equal(codexPermissionSettings('review').approvalPolicy,'untrusted');
});
test('Codex previews are bound to native thread/item and grants never exceed request',()=>{
 const turn={threadId:'thread',turnId:'turn',cwd:'/work',approvalItems:new Map([['item',{changes:[{path:'/work/a',diff:'+new'}]}]])};
 const params={threadId:'thread',turnId:'turn',itemId:'item',command:'echo ok'};
 assert.equal(codexApproval({method:'item/commandExecution/requestApproval',params:{...params,threadId:'other'}},turn),null);
 assert.equal(codexApproval({method:'item/commandExecution/requestApproval',params:{...params,availableDecisions:['decline']}},turn).canAllow,false);
 assert.equal(codexApproval({method:'item/fileChange/requestApproval',params},turn).canAllow,true);
 assert.equal(codexApproval({method:'item/fileChange/requestApproval',params:{...params,itemId:'missing'}},turn).canAllow,false);
 const permissions={network:{enabled:true}};
 assert.deepEqual(codexApproval({method:'item/permissions/requestApproval',params:{...params,permissions}},turn).allow,{permissions,scope:'turn'});
});
