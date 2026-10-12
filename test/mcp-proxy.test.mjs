// 1.43 Typed by Pocket: pocket-mcp-proxy fills {{vault:…}} placeholders into a browser tool's arguments from the Vault
// (policy and approvals apply), scrubs the values from everything the tool sends back, and passes ordinary calls through.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {newKey} from '../vault.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const PASS='Pr0xy-P@ss "quoted" value';

test('MCP proxy: placeholders are filled from the Vault on the way in, scrubbed on the way out; ask policy, denial, off and pass-through',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-proxy-'));let port=19061;
  const secret=randomUUID(),exp=Date.now()+3600000,cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  let srv,logs='';const procs=[];
  const start=async()=>{
   srv=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SKILLS:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),POCKET_VAULT_KEY:newKey()},stdio:['ignore','pipe','pipe']});
   srv.stdout.on('data',b=>{logs+=b});srv.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<100;i++){if(srv.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
   if(srv.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=41;logs='';return start();}
   throw Error('Test server failed: '+logs);
  };
  t.after(async()=>{for(const p of procs)try{p.kill()}catch{};if(srv&&srv.exitCode===null){const e=new Promise(r=>srv.once('exit',r));srv.kill();await e;}fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  await start();
  const call=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};};
  assert.equal((await call('/settings',{vault:true})).body.vault,true);
  assert.equal((await call('/vault/act',{action:'add',name:'portal',kind:'login',values:{username:'brad@example.test',password:PASS},policy:'auto'})).status,200);
  assert.equal((await call('/vault/act',{action:'add',name:'bank',kind:'login',values:{username:'brad-bank',password:'bank-secret-123'}})).status,200,'follows the default: ask once');
  // One proxy in front of the fake browser tool, talking line-delimited JSON-RPC.
  const mcpLog=path.join(dir,'mcp.log');
  const open=()=>{
   const p=spawn(process.execPath,[path.join(repo,'scripts/pocket-mcp-proxy.mjs'),'--name','browser','--',process.execPath,path.join(repo,'test/fake-mcp.mjs')],{cwd:dir,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_DATA_DIR:path.join(dir,'data'),POCKET_VAULT_FILL_WAIT:'1',FAKE_MCP_LOG:mcpLog},stdio:['pipe','pipe','pipe']});procs.push(p);
   const waiting=new Map();let stderr='';p.stderr.on('data',b=>{stderr+=b;});
   readline.createInterface({input:p.stdout}).on('line',l=>{const m=JSON.parse(l);waiting.get(m.id)?.(m);});
   let n=0;const rpc=(method,params)=>new Promise(res=>{const id=++n;waiting.set(id,res);p.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
   return {p,rpc,stderr:()=>stderr};
  };
  const {rpc,stderr,p}=open();
  assert.equal((await rpc('initialize',{protocolVersion:'2025-06-18'})).result.serverInfo.name,'fake','initialize passes through');
  assert.deepEqual((await rpc('tools/list',{})).result.tools.map(x=>x.name),['type','peek']);
  // An ordinary call is untouched.
  let r=await rpc('tools/call',{name:'type',arguments:{text:'hello'}});assert.equal(r.result.content[0].text,"await page.getByLabel('Password').fill('hello');");
  // A placeholder: the tool gets the real value, the answer and later results carry only the placeholder.
  r=await rpc('tools/call',{name:'type',arguments:{text:'{{vault:portal.password}}'}});
  assert.equal(r.result.isError,undefined,JSON.stringify(r.result));
  assert.equal(r.result.content[0].text,"await page.getByLabel('Password').fill('{{vault:portal.password}}');");
  assert.equal(JSON.parse(fs.readFileSync(mcpLog,'utf8').trim().split('\n').at(-1)).text,PASS,'the browser tool received the real value');
  r=await rpc('tools/call',{name:'peek',arguments:{}});
  assert.equal(r.result.content[0].text,'- textbox "Password": {{vault:portal.password}}','a later snapshot is scrubbed too');assert.equal(r.result.structuredContent.value,'{{vault:portal.password}}');
  await sleep(100);assert.equal(stderr().includes(PASS),false,'and the tool\'s stderr');assert.match(stderr(),/typing \{\{vault:portal\.password\}\}/);
  // Two fields in one call, in a nested argument.
  r=await rpc('tools/call',{name:'type',arguments:{text:'{{vault:portal.username}} / {{vault:portal.password}}',extra:{n:['{{vault:portal.username}}']}}});
  const got=JSON.parse(fs.readFileSync(mcpLog,'utf8').trim().split('\n').at(-1));assert.equal(got.text,`brad@example.test / ${PASS}`);assert.deepEqual(got.extra.n,['brad@example.test']);
  // Ask policy: the first call is pending (an error the agent can act on), the owner allows, the same call then fills.
  r=await rpc('tools/call',{name:'type',arguments:{text:'{{vault:bank.password}}'}});
  assert.equal(r.result.isError,true);assert.match(r.result.content[0].text,/asking the owner to allow filling bank into type \(request ([0-9a-f]{12})\)/);
  const reqId=/request ([0-9a-f]{12})/.exec(r.result.content[0].text)[1];
  const reqs=(await call('/vault')).body.requests;assert.deepEqual(reqs[0].argv,['pocket-fill','browser','type']);assert.equal(reqs[0].id,reqId);
  assert.equal((await call('/vault/act',{action:'answer',request:reqId,decision:'once'})).status,200);
  r=await rpc('tools/call',{name:'type',arguments:{text:'{{vault:bank.password}}'}});assert.equal(r.result.isError,undefined,JSON.stringify(r.result));
  assert.equal(JSON.parse(fs.readFileSync(mcpLog,'utf8').trim().split('\n').at(-1)).text,'bank-secret-123');
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
  for(const v of [PASS,'bank-secret-123','brad@example.test'])assert.equal(audit.includes(v),false);
  assert.match(logs,/vault fill tool=type items=portal by terminal/);assert.equal(logs.includes(PASS),false);
  // With the Vault off, placeholder calls fail clearly and ordinary calls still work.
  assert.equal((await call('/settings',{vault:false})).body.vault,false);
  r=await rpc('tools/call',{name:'type',arguments:{text:'{{vault:portal.password}}'}});assert.equal(r.result.isError,true);assert.match(r.result.content[0].text,/The Vault is off/);
  r=await rpc('tools/call',{name:'type',arguments:{text:'plain'}});assert.match(r.result.content[0].text,/fill\('plain'\)/);
  // The proxy exits with its server.
  const exited=new Promise(res=>p.once('exit',res));p.stdin.end();assert.equal(await exited,0);
});
