import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {connectorError,parseClaudeMcpList,claudeConnectorsOff,claudeConnectors,codexConnectors,codexConnectorRows,GOOGLE_CONNECTORS,CLAUDE_MANAGE_URL,CODEX_MANAGE_URL} from '../connectors.mjs';
const LIST=`Checking MCP server health…

claude.ai Claude Docs: https://api.anthropic.com/v1/pages/mcp - ✔ Connected
claude.ai Google Drive: https://drivemcp.googleapis.com/mcp/v1 - ✔ Connected
claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ! Needs authentication
claude.ai Google Calendar: https://calendarmcp.googleapis.com/mcp/v1 - ✘ Failed to connect
memstem: memstem mcp - ✘ Failed to connect — ENOENT`;
const tmp=()=>{const home=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-conn-'));return {home,managedDir:path.join(home,'managed')};};
test('claude mcp list lines map to connector states; other servers are ignored',()=>{
 const m=parseClaudeMcpList(LIST);
 assert.equal(m.get('claude.ai Google Drive'),'connected');assert.equal(m.get('claude.ai Gmail'),'needs-auth');
 assert.equal(m.get('claude.ai Google Calendar'),'failed');assert.equal(m.has('memstem'),false);
 assert.equal(parseClaudeMcpList('claude.ai Gmail: https://x - - Not configured').get('claude.ai Gmail'),'not-connected');
});
test('connectors switched off in user settings, managed policy or the environment are reported, not listed',async()=>{
 const {home,managedDir}=tmp();
 assert.equal(claudeConnectorsOff({home,managedDir,env:{}}),null);
 assert.equal(claudeConnectorsOff({home,managedDir,env:{ENABLE_CLAUDEAI_MCP_SERVERS:'false'}}),'ENABLE_CLAUDEAI_MCP_SERVERS');
 fs.mkdirSync(path.join(managedDir,'managed-settings.d'),{recursive:true});fs.writeFileSync(path.join(managedDir,'managed-settings.d','10-org.json'),'{"disableClaudeAiConnectors":true}');
 assert.match(claudeConnectorsOff({home,managedDir,env:{}}),/10-org\.json$/);
 fs.rmSync(managedDir,{recursive:true});fs.mkdirSync(path.join(home,'.claude'));fs.writeFileSync(path.join(home,'.claude','settings.json'),'{"disableClaudeAiConnectors":true}');
 let ran=false;const r=await claudeConnectors({bin:'claude',env:{},cwd:home,home,managedDir,identity:{signedIn:true,method:'claude.ai'},run:async()=>{ran=true;}});
 assert.equal(ran,false);assert.equal(r.available,false);assert.match(r.reason,/~\/\.claude\/settings\.json/);assert.deepEqual(r.items.map(i=>i.status),['off','off','off']);
});
test('Claude rows come from the CLI; API-key and signed-out installs are explained without running it',async()=>{
 const {home,managedDir}=tmp();let args;
 const r=await claudeConnectors({bin:'claude',env:{},cwd:home,home,managedDir,identity:{signedIn:true,method:'claude.ai'},run:async(_b,a)=>{args=a;return {stdout:LIST};}});
 assert.deepEqual(args,['mcp','list']);assert.equal(r.available,true);assert.equal(r.manageUrl,CLAUDE_MANAGE_URL);
 assert.deepEqual(Object.fromEntries(r.items.map(i=>[i.key,i.status])),{gmail:'needs-auth',calendar:'failed',drive:'connected'});
 const none=await claudeConnectors({bin:'claude',env:{},cwd:home,home,managedDir,identity:{signedIn:true,method:'claude.ai'},run:async()=>({stdout:'No MCP servers configured.'})});
 assert.deepEqual(none.items.map(i=>i.status),['not-connected','not-connected','not-connected']);
 for(const identity of [{signedIn:true,method:'api_key'},{signedIn:false,method:'none'}]){
  const r2=await claudeConnectors({bin:'claude',env:{},cwd:home,home,managedDir,identity,run:async()=>{throw Error('must not run');}});
  assert.equal(r2.available,false);assert.match(r2.reason,/subscription|Sign in/);
 }
 const slow=await claudeConnectors({bin:'claude',env:{},cwd:home,home,managedDir,identity:{signedIn:true,method:'claude.ai'},run:async()=>{throw Object.assign(Error('t'),{killed:true});}});
 assert.match(slow.reason,/too long/);
});
const app=(id,extra={})=>({id,name:id,installUrl:`https://chatgpt.com/apps/x/${id}`,toolSummaries:[{name:'read',isReadOnly:true},{name:'send',isReadOnly:false}],...extra});
test('Codex rows: connected apps come from the head of app/list, links only to chatgpt.com',async()=>{
 const [gmail,cal,drive]=GOOGLE_CONNECTORS.map(c=>c.codex);const calls=[];
 const pages=[{data:[{id:'a1',isAccessible:true},{id:gmail,isAccessible:true}],nextCursor:'p2'},{data:[{id:cal,isAccessible:true,isEnabled:false},{id:'x',isAccessible:false}],nextCursor:'p3'},{data:[{id:drive,isAccessible:true}],nextCursor:null}];
 const rpc=async(method,params)=>{calls.push([method,params]);if(method==='app/list')return pages[{p2:1,p3:2}[params.cursor]||0];
  return {apps:[app(gmail),app(cal),app(drive,{installUrl:'https://evil.example/apps'})],missingAppIds:[]};};
 const r=await codexConnectors({rpc,account:{signedIn:true,method:'chatgpt'},refresh:true});
 assert.equal(r.available,true);assert.equal(calls.filter(c=>c[0]==='app/list').length,2,'stops at the first app that is not connected');
 assert.equal(calls[0][1].forceRefetch,true);assert.equal(calls[1][1].forceRefetch,undefined);
 assert.deepEqual(Object.fromEntries(r.items.map(i=>[i.key,i.status])),{gmail:'connected',calendar:'off',drive:'not-connected'},'pages after the first unconnected app are not read');
 assert.equal(r.items[2].connectUrl,CODEX_MANAGE_URL,'a non-chatgpt.com link is never offered');
 assert.equal(r.items[0].writeTools,1);
 assert.deepEqual(calls.at(-1),['app/read',{appIds:[gmail,cal,drive],includeTools:true}]);
});
test('Codex explains API-key, signed-out and failed listings',async()=>{
 const never=async()=>{throw Error('must not call');};
 assert.match((await codexConnectors({rpc:never,account:{signedIn:true,method:'apiKey'}})).reason,/ChatGPT sign-in/);
 assert.match((await codexConnectors({rpc:never,account:{signedIn:false}})).reason,/Sign in to Codex/);
 const failed=await codexConnectors({rpc:async()=>{throw Error('boom');},account:{signedIn:true,method:'chatgpt'}});
 assert.equal(failed.available,false);assert.equal(failed.transient,true);assert.equal(failed.error,'boom');assert.doesNotMatch(failed.reason,/signed in/,'a failed read does not blame the sign-in');assert.deepEqual(failed.items.map(i=>i.status),['unavailable','unavailable','unavailable']);
 assert.deepEqual(codexConnectorRows({apps:[]}).map(i=>i.status),['unavailable','unavailable','unavailable'],'an app missing from the catalog is unavailable');
});
test('a Cloudflare bot check from chatgpt.com is named, never dumped; timeouts read as timeouts',async()=>{
 const page='<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><script>window._cf_chl_opt={cType:"managed"}</script></body></html>';
 const r=await codexConnectors({rpc:async()=>{throw Error('connectors/directory/list failed: 403 '+page);},account:{signedIn:true,method:'chatgpt'}});
 assert.match(r.reason,/bot check/);assert.equal(r.error,'chatgpt.com answered with a Cloudflare bot check');assert.doesNotMatch(JSON.stringify(r),/<html|cf_chl/);
 assert.match((await codexConnectors({rpc:async()=>{throw Error('app/list timed out');},account:{signedIn:true,method:'chatgpt'}})).reason,/too long/);
 assert.deepEqual(connectorError(Error('<b>bad</b>   gateway')),{challenge:false,timeout:false,detail:'bad gateway'});
 assert.equal(connectorError(Object.assign(Error('x'),{killed:true})).timeout,true);
});
