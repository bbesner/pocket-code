// Casey's 1.88.1 security report, group secA: S-1 (Codex side chat MCP names), S-2 (Claude side chat WebSearch),
// S-3 (/api/notify network-path links and the service worker's click handler). Fake CLIs only; no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawn,execFile} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const flag=(args,f)=>args[args.indexOf(f)+1];
// A daemon on a temp data dir with the fake Claude CLI; retries the port when another test holds it.
async function daemon(t,{port,env={},setup=()=>{}}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-secA-'));let child,logs='';
  const secret=randomUUID(),exp=Date.now()+3600000;
  const cookie={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});setup(dir);
  for(let tries=0;;tries++){
    logs='';child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SKILLS:'0',
      POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),...env},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
    let up=false;for(let i=0;i<150&&!up;i++){if(child.exitCode!==null)break;try{up=(await fetch(`http://127.0.0.1:${port}/api/health`)).ok;}catch{} if(!up)await sleep(30);}
    if(up)break;
    if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&tries<4){port+=37;continue;}
    throw Error('Test server failed: '+logs);
  }
  t.after(async()=>{if(child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}await sleep(200);fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});});
  const bearer={'content-type':'application/json',authorization:'Bearer '+fs.readFileSync(path.join(dir,'data','cli-token'),'utf8').trim()};
  const call=async(p,body,h=cookie)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers:h,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};};
  return {dir,call,bearer,logs:()=>logs};
}

// ---------- S-1 ----------
// sideChatConfig reads $CODEX_HOME/config.toml at each call; CODEX_HOME is fixed when codex.mjs loads, so a child process
// imports it with CODEX_HOME pointing at a temp folder and reports what each config file gives (or the error it throws).
function sideConfigs(files){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-secA-codex-'));
  const code=`import fs from 'node:fs';const c=await import(${JSON.stringify(path.join(repo,'codex.mjs'))});const out=[];`
    +`for(const f of JSON.parse(process.env.SECA_FILES)){fs.writeFileSync(process.env.CODEX_HOME+'/config.toml',f);try{out.push({config:await c.sideChatConfig()});}catch(e){out.push({threw:String(e.message)});}}`
    +`process.stdout.write('\\nRESULT '+JSON.stringify(out)+'\\n');process.exit(0);`;
  return new Promise((resolve,reject)=>execFile(process.execPath,['--input-type=module','-e',code],{env:{...cleanEnv(),POCKET_DATA_DIR:path.join(home,'data'),CODEX_HOME:home,SECA_FILES:JSON.stringify(files)},timeout:20000},(e,o,err)=>{
    fs.rmSync(home,{recursive:true,force:true});if(e)return reject(new Error(err||e.message));resolve(JSON.parse(/^RESULT (.*)$/m.exec(o)[1]));}));
}
// A server is off when the config names it off: a dotted key (only for a name with no dot, since Codex splits override
// paths on dots) or a nested mcp_servers object. Refusing to start the side chat (a throw) is also safe.
const turnsOff=(r,name)=>Boolean(r.threw)||(!name.includes('.')&&r.config[`mcp_servers.${name}.enabled`]===false)||r.config.mcp_servers?.[name]?.enabled===false;

test('S-1: a Codex side chat turns off MCP servers written in every TOML form Codex accepts, or refuses to start',async()=>{
  // Codex 0.156.1 (`codex mcp list --json`) lists each of these as an enabled server; only the first form is caught today.
  const forms=[
    ['writer','[mcp_servers.writer]\ncommand = "/bin/true"\n'], // the form the pattern handles: the control
    ['writer','mcp_servers.writer.command = "/bin/true"\n'], // dotted keys at the top level
    ['writer','[mcp_servers]\nwriter = { command = "/bin/true" }\n'], // a bare table with an inline table
    ['writer',"[mcp_servers.'writer']\ncommand = \"/bin/true\"\n"], // a single-quoted name
    ['writer','[ mcp_servers.writer ]\ncommand = "/bin/true"\n'], // spaces inside the brackets
    ['writer','[mcp_servers.writer] # mail\ncommand = "/bin/true"\n'], // a comment after the header
    ['my.server','[mcp_servers."my.server"]\ncommand = "/bin/true"\n'], // a quoted name with a dot
  ];
  const results=await sideConfigs(forms.map(f=>f[1]));
  const left=forms.map(([name,toml],i)=>({name,header:toml.split('\n')[0],got:results[i]})).filter((f,i)=>!turnsOff(results[i],forms[i][0]));
  assert.ok(turnsOff(results[0],'writer'),'the plain header form is turned off');
  assert.deepEqual(left,[],'servers left on in a side chat that runs with approvalPolicy never');
  const {codexSideFork}=await import('../sidechat.mjs');
  assert.equal(codexSideFork('t').approvalPolicy,'never','context: the side chat asks nothing, so a server left on runs its tools unasked');
});

// The other half of S-1: when Codex cannot list its MCP servers, the side chat is refused with the reason, and no side
// chat process starts (the fake's `mcp list` fails with FAKE_CODEX_MCP_LIST=fail).
test('S-1: a Codex side chat is refused, with the reason, when Codex cannot list its MCP servers',async t=>{
  const codexHome=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-secA-codex-'));t.after(()=>fs.rmSync(codexHome,{recursive:true,force:true}));
  const d=await daemon(t,{port:19887,env:{POCKET_CODEX:'1',CODEX_BIN:path.join(repo,'test/fake-codex.mjs'),CODEX_HOME:codexHome,FAKE_CODEX_MCP_LIST:'fail'}});
  const parent=(await d.call('/new',{cwd:repo,provider:'codex',text:'Plan the camera rollout',clientMessageId:randomUUID()})).body.id;
  assert.match(String(parent),/^cx:/);
  for(let i=0;i<100&&(await d.call(`/session/${parent}`)).body?.active;i++)await sleep(50);
  const r=await d.call(`/session/${parent}/side`,{text:'Status?'});
  assert.equal(r.status,502,JSON.stringify(r.body));
  assert.match(r.body.error,/could not ask Codex which MCP servers it has.*codex mcp list failed/s);
  const forks=fs.existsSync(path.join(d.dir,'calls.forks'))?fs.readFileSync(path.join(d.dir,'calls.forks'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
  assert.deepEqual(forks.filter(f=>f.side),[],'no side chat app-server forked the thread');
  assert.equal((await d.call(`/session/${parent}/side`)).body.chat,null,'no side chat is open');
  assert.doesNotMatch(d.logs(),/side chat start/);
});

// ---------- S-2 ----------
test('S-2: a Claude side chat started while the conversation is in Review actions does not pre-approve WebSearch',async t=>{
  // POCKET_APPROVAL_MODE is unset, so the daemon's default (and this conversation's mode, with no live process) is review.
  const id=randomUUID();
  const d=await daemon(t,{port:19881,setup:dir=>{
    const ws=path.join(dir,'sessions','test-workspace');fs.mkdirSync(ws,{recursive:true});
    const line=o=>JSON.stringify({...o,cwd:repo,sessionId:id,timestamp:new Date().toISOString()});
    fs.writeFileSync(path.join(ws,id+'.jsonl'),[line({type:'user',message:{role:'user',content:'Summarise the page'}}),line({type:'assistant',message:{role:'assistant',content:[{type:'text',text:'Done.'}]}})].join('\n')+'\n');
  }});
  const modes=(await d.call(`/session/${id}/approvals`)).body;assert.equal(modes.defaultMode,'review');assert.equal(modes.activeMode,null,'no live process: the next message runs in review');
  const r=await d.call(`/session/${id}/side`,{text:'Status?'});assert.equal(r.status,202,JSON.stringify(r.body));
  const file=path.join(d.dir,'calls.side');for(let i=0;i<100&&!fs.existsSync(file);i++)await sleep(30);
  const [spawned]=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(spawned.parent,id);assert.equal(flag(spawned.args,'--permission-mode'),'default');
  assert.ok(!spawned.args.includes('--permission-prompt-tool'),'context: the side chat has no way to ask, so an allowed tool runs unasked');
  const allowed=spawned.args.includes('--allowedTools')?flag(spawned.args,'--allowedTools').split(','):[];
  assert.ok(allowed.includes('Read'),'reading stays pre-approved, as in the parent');
  assert.equal(allowed.includes('WebSearch'),false,`WebSearch is pre-approved in a Review actions side chat: --allowedTools ${allowed.join(',')}`);
});
// The page sends the conversation's next mode with the side chat (as with a message): Full access set in the browser, with
// no live process, still lets the side chat search the web.
test('S-2: a Claude side chat opened with approvalMode full from the page may search the web',async t=>{
  const id=randomUUID();
  const d=await daemon(t,{port:19893,setup:dir=>{
    const ws=path.join(dir,'sessions','test-workspace');fs.mkdirSync(ws,{recursive:true});
    const line=o=>JSON.stringify({...o,cwd:repo,sessionId:id,timestamp:new Date().toISOString()});
    fs.writeFileSync(path.join(ws,id+'.jsonl'),[line({type:'user',message:{role:'user',content:'Summarise the page'}}),line({type:'assistant',message:{role:'assistant',content:[{type:'text',text:'Done.'}]}})].join('\n')+'\n');
  }});
  assert.equal((await d.call(`/session/${id}/approvals`)).body.defaultMode,'review');
  const r=await d.call(`/session/${id}/side`,{text:'Status?',approvalMode:'full'});assert.equal(r.status,202,JSON.stringify(r.body));
  const file=path.join(d.dir,'calls.side');for(let i=0;i<100&&!fs.existsSync(file);i++)await sleep(30);
  const [spawned]=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(flag(spawned.args,'--allowedTools').split(','),['Read','Grep','Glob','WebSearch']);
});

// ---------- S-3 ----------
const BASE='https://pocket.example.test';
test('S-3: /api/notify refuses links that leave Pocket (//host, /\\host, a tab inside, the public address followed by //host)',async t=>{
  const d=await daemon(t,{port:19911,env:{POCKET_PUBLIC_URL:BASE}});
  const ok=await d.call('/notify',{title:'Pocket path',url:'/#/start/0123456789ab'},d.bearer);
  assert.equal(ok.status,200,'a Pocket path still works');assert.equal(ok.body.url,'/#/start/0123456789ab');
  assert.equal((await d.call('/notify',{title:'x',url:'https://evil.example/login'},d.bearer)).body.code,'bad_url','context: an absolute outside link is refused');
  // Each link either is refused, or the pushed url (echoed in the reply) resolves to Pocket's own origin, as the service worker resolves it.
  const leaks=[];
  for(const url of ['//evil.example/login','/\\evil.example/login','/\t/evil.example/login',BASE+'//evil.example/login']){
    const r=await d.call('/notify',{title:'Sign in again',url},d.bearer);
    if(r.status===200&&new URL(r.body.url||'/',BASE).origin!==BASE)leaks.push({sent:url,pushed:r.body.url,opens:new URL(r.body.url,BASE).href});
  }
  assert.deepEqual(leaks,[],'links pushed that open an outside site when tapped');
});

test('S-3: the service worker opens only Pocket\'s own origin when a notification is tapped',async()=>{
  const origin='https://pocket.example.test',opened=[],handlers={};
  const client={frameType:'top-level',url:origin+'/',focus:async()=>client,navigate:async u=>{opened.push(String(u));return client;}};
  const ctx={location:new URL(origin+'/sw.js'),registration:{scope:origin+'/',showNotification:async()=>{}},navigator:{},URL,fetch:async()=>({ok:true}),
    caches:{open:async()=>({addAll:async()=>{},put:async()=>{}}),keys:async()=>[],match:async()=>null},
    clients:{matchAll:async()=>[client],openWindow:async u=>{opened.push(String(u));return null;},claim:async()=>{}},
    addEventListener:(type,fn)=>{handlers[type]=fn;},skipWaiting:()=>{}};
  ctx.self=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(repo,'public/sw.js'),'utf8'),ctx);
  const tap=async url=>{let p;handlers.notificationclick({action:'',notification:{data:{url},close(){}},waitUntil:x=>{p=x;}});await p;return opened.at(-1);};
  assert.equal(new URL(await tap('/#/tasks'),origin).href,origin+'/#/tasks','context: a Pocket path opens');
  const leaks=[];
  for(const url of ['//evil.example/login','/\\evil.example/login','https://evil.example/login']){const went=await tap(url);if(new URL(went,origin).origin!==origin)leaks.push({url,opens:new URL(went,origin).href});}
  assert.deepEqual(leaks,[],'the worker navigates to an outside site');
});
