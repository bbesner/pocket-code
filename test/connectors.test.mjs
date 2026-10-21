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

// 1.73.8: an install link from the catalog with a user name, password or port is not offered; two status reads at once run
// one `claude mcp list`; a failed read logs Pocket's own reason, not the CLI's error text.
test('Codex install links with userinfo or a port fall back to the apps page',()=>{
 const [gmail,cal,drive]=GOOGLE_CONNECTORS.map(c=>c.codex);
 const rows=codexConnectorRows({apps:[app(gmail,{installUrl:'https://user:pw@chatgpt.com/apps/x'}),app(cal,{installUrl:'https://chatgpt.com:8443/apps/x'}),app(drive)],accessible:[]});
 assert.deepEqual(rows.map(r=>r.connectUrl),[CODEX_MANAGE_URL,CODEX_MANAGE_URL,`https://chatgpt.com/apps/x/${drive}`]);
});
test('HTTP: concurrent connector reads share one listing; a failed listing is logged without the CLI\'s words',async t=>{
 const {spawn}=await import('node:child_process');const {createHmac,randomUUID}=await import('node:crypto');
 const repo=path.resolve(import.meta.dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-conn-http-')),fail=path.join(dir,'fail');
 const secret=randomUUID(),exp=Date.now()+3600000,headers={cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
 fs.mkdirSync(path.join(dir,'sessions'));fs.mkdirSync(path.join(dir,'home'));
 let port=19511,child,logs='';
 const env=()=>({...Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k))),HOME:path.join(dir,'home'),POCKET_SKILLS:'0',PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),FAKE_CLAUDE_MCP_MS:'400',FAKE_CLAUDE_MCP_FAIL:fail});
 for(let tries=0;tries<4;tries++){
  child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:env(),stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
  let up=false;for(let i=0;i<100&&child.exitCode===null;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok){up=true;break;}}catch{}await new Promise(r=>setTimeout(r,30));}
  if(up)break;if(!/EADDRINUSE/.test(logs))throw Error('Test server failed: '+logs);port+=41;logs='';
 }
 t.after(async()=>{if(child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}fs.rmSync(dir,{recursive:true,force:true});});
 const get=q=>fetch(`http://127.0.0.1:${port}/api/connectors${q||''}`,{headers}).then(r=>r.json());
 const listings=()=>{try{return fs.readFileSync(path.join(dir,'calls.mcp'),'utf8').trim().split('\n').filter(Boolean).length;}catch{return 0;}};
 const [a,b]=await Promise.all([get(),get()]);
 assert.equal(listings(),1,'one listing for two reads');assert.deepEqual(a,b);assert.equal(a.providers[0].available,true);
 fs.writeFileSync(fail,'');
 const failed=await get('?refresh=1');assert.equal(failed.providers[0].available,false);
 await new Promise(r=>setTimeout(r,100));
 assert.match(logs,/connectors: claude read failed: Claude Code could not list its connectors\. Try again\./);
 assert.doesNotMatch(logs,/sk-fake-connector-secret|upstream said/,'the CLI\'s error text stays out of the log');
});
