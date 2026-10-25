// 1.79 Branch (a new saved conversation that carries on from another) and Codex side chat. Fake CLIs only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const msg=(text,extra={})=>({text,clientMessageId:randomUUID(),...extra});
const lines=f=>{try{return fs.readFileSync(f,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)}catch{return []}};

async function fixture(t,port){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-branch-'));
 const secret=randomUUID(),exp=Date.now()+3600000;
 const headers={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
 // Codex config with two MCP servers (one quoted) and a nested tools table: a side chat turns off the two servers.
 const codexHome=path.join(dir,'codex-home');fs.mkdirSync(codexHome);
 fs.writeFileSync(path.join(codexHome,'config.toml'),'model = "gpt-test"\n\n[mcp_servers.memstem]\ncommand = "memstem"\n\n[mcp_servers.memstem.tools.memstem_search]\napproval_mode = "approve"\n\n[mcp_servers."web-tools"]\ncommand = "x"\n');
 let child,logs='';
 child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),POCKET_SKILLS:'0',PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),CODEX_BIN:path.join(repo,'test/fake-codex.mjs'),CODEX_HOME:codexHome},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
 t.after(async()=>{if(child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}await sleep(300);fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});});
 for(let i=0;i<150;i++){if(child.exitCode!==null)break;try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)break;}catch{} await sleep(30);}
 const call=async(p,body,method)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:method||(body?'POST':'GET'),headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null)};};
 const until=async(fn,ms=6000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return true;await sleep(50)}return false;};
 const idle=async id=>!(await call(`/session/${id}`)).body?.active;
 // Reads a side chat's events until `stop` matches one.
 const events=async(side,stop)=>{
  const ac=new AbortController(),seen=[],timer=setTimeout(()=>ac.abort(),6000);
  try{const r=await fetch(`http://127.0.0.1:${port}/api/side/${side}/events?from=0`,{headers,signal:ac.signal});const reader=r.body.getReader(),dec=new TextDecoder();let buf='';
   for(;;){const {value,done}=await reader.read();if(done)return seen;buf+=dec.decode(value,{stream:true});let i;
    while((i=buf.indexOf('\n\n'))>=0){const d=buf.slice(0,i).split('\n').find(l=>l.startsWith('data: '));buf=buf.slice(i+2);if(!d)continue;const ev=JSON.parse(d.slice(6));seen.push(ev);if(stop(ev,seen)){ac.abort();return seen;}}}
  }catch(e){if(e.name==='AbortError')return seen;throw e;}finally{clearTimeout(timer);}
 };
 fs.mkdirSync(path.join(dir,'sessions','test-workspace'),{recursive:true});
 return {dir,call,until,idle,events,logs:()=>logs};
}

test('Claude: a branch is a new saved conversation that starts with the parent, which is only read',async t=>{
 const f=await fixture(t,18815);
 const parent=(await f.call('/new',{cwd:repo,...msg('Review the camera export')})).body.id;
 assert.ok(await f.until(()=>f.idle(parent)));
 const pfile=path.join(f.dir,'sessions','test-workspace',parent+'.jsonl'),before=fs.readFileSync(pfile);
 assert.equal((await f.call(`/session/${randomUUID()}/branch`,msg('x'))).status,409,'nothing to branch from yet');
 assert.equal((await f.call(`/session/${parent}/branch`,msg('  '))).status,400);
 assert.equal((await f.call(`/session/${parent}/branch`,msg('use sk-proj-abcDEF1234567890abcdefXYZ'))).body.code,'secret_detected');
 const req=msg('Write the export script');
 const r=await f.call(`/session/${parent}/branch`,req);
 assert.equal(r.status,202);const child=r.body.id;assert.notEqual(child,parent);
 assert.equal((await f.call(`/session/${parent}/branch`,req)).body.id,child,'a repeated send is the same branch');
 assert.ok(await f.until(()=>f.idle(child)));
 assert.deepEqual(lines(path.join(f.dir,'calls.forks')),[{id:child,forkOf:parent}],'one fork, from the parent');
 assert.deepEqual(fs.readFileSync(pfile),before,'the parent transcript is untouched');
 const cfile=fs.readFileSync(path.join(f.dir,'sessions','test-workspace',child+'.jsonl'),'utf8');
 assert.match(cfile,/Review the camera export/);assert.match(cfile,/Write the export script/);
 // Both ways: the branch names its parent; the parent lists the branch; the list shows both.
 const c=(await f.call(`/session/${child}`)).body,p=(await f.call(`/session/${parent}`)).body;
 assert.equal(c.branchOf.id,parent);assert.equal(c.title,'Branch: Write the export script');
 assert.deepEqual(p.branches.map(b=>[b.id,b.title]),[[child,'Branch: Write the export script']]);assert.equal(p.branchOf,null);
 const ids=(await f.call('/sessions')).body.sessions.map(s=>s.id);
 assert.ok(ids.includes(parent)&&ids.includes(child),'the branch is not folded into its parent as a duplicate');
 // Later messages continue the branch itself.
 assert.equal((await f.call(`/session/${child}/message`,msg('and test it'))).status,202);
 assert.ok(await f.until(async()=>/and test it/.test(fs.readFileSync(path.join(f.dir,'sessions','test-workspace',child+'.jsonl'),'utf8'))&&await f.idle(child)));
 assert.equal(lines(path.join(f.dir,'calls.forks')).length,1,'no second fork');
 assert.deepEqual(fs.readFileSync(pfile),before);
 assert.match(f.logs(),new RegExp(`branch session=${child} from=${parent}`));
});

test('Codex: Branch forks a saved thread; side chat forks an unsaved, read-only one with MCP off',async t=>{
 const f=await fixture(t,18855);
 const parent=(await f.call('/new',{cwd:repo,provider:'codex',...msg('Plan the camera rollout')})).body.id;
 assert.match(parent,/^cx:/);assert.ok(await f.until(()=>f.idle(parent)));
 const bare=parent.slice(3);
 // Branch
 const r=await f.call(`/session/${parent}/branch`,msg('Draft the rollout email'));
 assert.equal(r.status,202);const child=r.body.id;assert.match(child,/^cx:/);assert.notEqual(child,parent);
 assert.ok(await f.until(()=>f.idle(child)));
 let forks=lines(path.join(f.dir,'calls.forks'));
 assert.equal(forks.length,1);assert.equal(forks[0].threadId,bare);assert.equal(forks[0].ephemeral,false);assert.equal(forks[0].side,false);
 const turns=lines(path.join(f.dir,'calls.codex'));
 assert.equal(turns.at(-1).threadId,child.slice(3));assert.equal(turns.at(-1).text,'Draft the rollout email');
 const c=(await f.call(`/session/${child}`)).body;assert.equal(c.branchOf.id,parent);assert.equal(c.title,'Branch: Draft the rollout email');
 assert.deepEqual((await f.call(`/session/${parent}`)).body.branches.map(b=>b.id),[child]);
 // Side chat
 const s=await f.call(`/session/${parent}/side`,{text:'Why this order?'});
 assert.equal(s.status,202);assert.equal(s.body.provider,'codex');assert.equal(s.body.total,null,'Codex shows no cost');
 let ev=await f.events(s.body.side,e=>e.type==='result');
 assert.deepEqual(ev.map(e=>e.type),['user','delta','assistant','result']);
 assert.equal(ev[2].msg.blocks[0].text,'Codex test response.');assert.equal(ev[3].ok,true);assert.equal(ev[3].cost,null);
 forks=lines(path.join(f.dir,'calls.forks'));const side=forks.at(-1);
 assert.equal(side.threadId,bare);assert.equal(side.ephemeral,true);assert.equal(side.sandbox,'read-only');assert.equal(side.approvalPolicy,'never');assert.equal(side.side,true);
 assert.deepEqual(side.config,{'features.apps':false,'mcp_servers.memstem.enabled':false,'mcp_servers.web-tools.enabled':false},'MCP servers and apps off, nested tables untouched');
 assert.notEqual(side.pid,forks[0].pid,'its own app-server, not the conversation\'s');
 // A follow-up reuses it; Stop interrupts and keeps it.
 assert.equal((await f.call(`/session/${parent}/side`,{text:'Long one __HANG__',side:s.body.side})).status,202);
 await sleep(150);
 assert.equal((await f.call(`/side/${s.body.side}/stop`,{})).status,200);
 ev=await f.events(s.body.side,(e,all)=>all.filter(x=>x.type==='result').length===2);
 assert.equal(ev.filter(e=>e.type==='result')[1].error,'Stopped');
 assert.equal(lines(path.join(f.dir,'calls.forks')).length,2,'one fork for the whole side chat');
 assert.equal((await f.call(`/side/${s.body.side}`,undefined,'DELETE')).status,200);
 assert.equal((await f.call(`/session/${parent}/side`)).body.chat,null);
 // Nothing was added to the parent conversation by either.
 assert.equal(lines(path.join(f.dir,'calls.codex')).filter(x=>x.threadId===bare).length,1,'the parent only ever ran its own first turn');
});
