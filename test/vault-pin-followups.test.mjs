// Follow-ups to the Vault's Always allow check, from a second independent review (its problems 3, 4 and 5):
// (1) the variables a value is bound to are part of an approved command, shown on the request, and names a program acts on
//     by itself are refused; (2) a script an interpreter opens by its path can still be swapped as the command starts: the
//     request says so when an agent could do it, and the docs say so plainly; (3) command forms that ran a changed file
//     unasked either pin the file that runs or are not offered Always allow.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import * as V from '../vault.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
// 1.124.4: every folder tmp() makes is removed when the file ends, also after a failed test (a test that removes its own
// folder only at its end left it in the temp folder when it failed).
const tmpDirs=[];after(()=>{for(const d of tmpDirs)try{fs.rmSync(d,{recursive:true,force:true,maxRetries:5});}catch{}});
const tmp=()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-vault-fu-'));tmpDirs.push(d);return d;};
const SECRET='sk-live-madeup-4b1d9e7c2a6f3085';
const ROOT=process.getuid?.()===0;
const LINUX=process.platform==='linux';
const PATH=[path.dirname(process.execPath),'/usr/local/bin','/usr/bin','/bin'].join(':');
const has=name=>['/usr/bin','/bin','/usr/local/bin'].some(d=>{try{fs.accessSync(path.join(d,name),fs.constants.X_OK);return true;}catch{return false;}});
const write=(dir,name,text,mode=0o644)=>{const p=path.join(dir,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text,{mode});return p;};

// A store with two token items that ask once per command, and the request an agent's run would raise.
function store(dir){
  const s=new V.VaultStore(path.join(dir,'vault.enc'),{key:V.parseKey(V.newKey())});s.access=()=>'once';
  s.act({action:'add',name:'deploy-key',kind:'token',values:{value:SECRET}});
  s.act({action:'add',name:'other-key',kind:'token',values:{value:'sk-live-madeup-other-77aa'}});
  s.act({action:'add',name:'portal',kind:'login',values:{username:'ops-user',password:'madeup-portal-pass-31'}});
  return s;
}
async function command(s,argv,cwd){return {...s.checkCommand(argv,cwd),action:'run',pin:await V.pinCommand({argv,cwd},{PATH})};}
function ask(s,env,cmd){const bound=s.resolveBindings(env),need=s.decide(bound,cmd);return need.length?s.request({bound,cmd,need,env}):null;}

// A server of this tree on a private port with the Vault on and deploy-key asking once per command.
async function vaultServer(t,{port}){
  const dir=tmp(),secret=randomUUID(),exp=Date.now()+3600000,key=V.newKey();
  const cookie='pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const headers={'content-type':'application/json',cookie};
  const s={dir,work:path.join(dir,'work'),logs:''};
  for(const d of ['sessions','data',s.work])fs.mkdirSync(path.resolve(dir,d),{recursive:true});
  let child;
  const start=async()=>{
   s.logs='';
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SKILLS:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),POCKET_VAULT_KEY:key,POCKET_VAULT_PATH:PATH},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{s.logs+=b});child.stderr.on('data',b=>{s.logs+=b});
   for(let i=0;i<150;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)break;}catch{} await sleep(30)}
   if(child.exitCode!==null&&/EADDRINUSE/.test(s.logs)&&(s.tries=(s.tries||0)+1)<6){port+=53;return start();}
   if(child.exitCode!==null)throw Error('Test server failed: '+s.logs);
   s.bearer={'content-type':'application/json',authorization:'Bearer '+fs.readFileSync(path.join(dir,'data','cli-token'),'utf8').trim()};
  };
  t.after(async()=>{if(child&&child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  s.call=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};};
  s.stream=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:'POST',headers:s.bearer,body:JSON.stringify(body)});if(!r.ok)return {status:r.status,events:[],body:await r.json().catch(()=>({}))};const text=await r.text();return {status:r.status,events:text.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l))};};
  s.run=(argv,env={T:'deploy-key'})=>s.stream('/vault/run',{argv,cwd:s.work,env,wait:1});
  s.out=r=>r.events.filter(e=>e.t==='out').map(e=>e.s).join('');
  s.asked=r=>r.events.find(e=>e.t==='request');
  s.answer=(id,decision)=>s.call('/vault/act',{action:'answer',request:id,decision});
  s.request=async id=>(await s.call('/vault')).body.requests.find(x=>x.id===id);
  s.file=(name,text,mode)=>write(s.work,name,text,mode);
  await start();
  assert.equal((await s.call('/settings',{vault:true})).body.vault,true);
  assert.equal((await s.call('/vault/act',{action:'add',name:'deploy-key',kind:'token',values:{value:SECRET}})).status,200);
  return s;
}

// ---------- (1) variables ----------
test('variables: names a program acts on by itself are refused; ordinary credential names are not',()=>{
  const dir=tmp(),s=store(dir);
  const refused=['NODE_V8_COVERAGE','NODE_OPTIONS','NODE_COMPILE_CACHE','NODE_REDIRECT_WARNINGS','NPM_CONFIG_SCRIPT_SHELL','PYTHONPYCACHEPREFIX','PYTHONSTARTUP','PYTHONPATH','PERL5OPT','PERL5LIB','RUBYOPT','RUBYLIB',
   'BASH_ENV','ENV','IFS','PS4','PROMPT_COMMAND','SHELLOPTS','BASHOPTS','GIT_SSH_COMMAND','GIT_ASKPASS','GIT_EXTERNAL_DIFF','GIT_PAGER','GIT_EDITOR','GIT_CONFIG_PARAMETERS','GIT_CONFIG_VALUE_0','GIT_PROXY_COMMAND',
   'PAGER','MANPAGER','EDITOR','VISUAL','LESSOPEN','LESSCLOSE','TMPDIR','TMP','TEMP','DYLD_INSERT_LIBRARIES','LD_PRELOAD','LD_LIBRARY_PATH','SSLKEYLOGFILE','JAVA_TOOL_OPTIONS','XDG_CONFIG_HOME',
   'LANG','LC_ALL','LC_SECRET','TZ','SHELL','PATH','HOME','POCKET_ANYTHING','SSH_ASKPASS','SUDO_ASKPASS','MAKEFLAGS','GNUPGHOME','DOCKER_CONFIG'];
  for(const v of refused)assert.throws(()=>s.resolveBindings({[v]:'deploy-key'}),new RegExp(`${v} cannot be bound`),v);
  const allowed=['T','TOKEN','GITHUB_TOKEN','GH_TOKEN','GITLAB_TOKEN','GIT_TOKEN','GIT_PASSWORD','AWS_SECRET_ACCESS_KEY','AWS_ACCESS_KEY_ID','NPM_TOKEN','NODE_AUTH_TOKEN','PGPASSWORD','OPENAI_API_KEY','ANTHROPIC_API_KEY',
   'SSH_KEY','SUDO_PW','HTTPS_PROXY','CRM_CLIENT_SECRET','STRIPE_KEY','MAILCHIMP_API_KEY','U','P','PW'];
  for(const v of allowed)assert.equal(s.resolveBindings({[v]:'deploy-key'})[0].v,v,v);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('variables: an approved command run with another variable name, or another item for a name, asks again and says so',async()=>{
  const dir=tmp(),s=store(dir);write(dir,'job.mjs','console.log("good")\n');
  const cmd=await command(s,['node','job.mjs'],dir);
  let r=ask(s,{T:'deploy-key'},cmd);assert.ok(r);
  assert.deepEqual(s.requestView(r).variables,[{v:'T',name:'deploy-key',field:'value'}],'the card shows each variable and the item it gets');
  s.answer(r.id,'always');
  assert.equal(ask(s,{T:'deploy-key'},cmd),null,'the approved command with the approved variable runs');
  r=ask(s,{OTHER_NAME:'deploy-key'},cmd);assert.ok(r,'another variable name asks again');
  assert.equal(r.changed,'variables');assert.deepEqual(s.requestView(r).was,[{v:'T',name:'deploy-key',field:'value'}],'the card says what was approved');
  r=ask(s,{T:'deploy-key',EXTRA:'deploy-key'},cmd);assert.ok(r,'the same value under a second name asks again');assert.equal(r.changed,'variables');
  r=ask(s,{T:'deploy-key',X:'other-key'},cmd);assert.ok(r,'another item added to the command asks again');
  // A login's fields: the field a name gets is part of it too.
  const c2=await command(s,['node','job.mjs','--login'],dir);
  r=ask(s,{U:'portal.username',P:'portal.password'},c2);s.answer(r.id,'always');
  assert.equal(ask(s,{U:'portal.username',P:'portal.password'},c2),null);
  r=ask(s,{U:'portal.password',P:'portal.username'},c2);assert.ok(r,'fields swapped between names asks again');
  assert.deepEqual(s.requestView(r).variables,[{v:'U',name:'portal',field:'password'},{v:'P',name:'portal',field:'username'}]);
  // A fill names no variables of its own; it is not affected.
  fs.rmSync(dir,{recursive:true,force:true});
});

test('variables: a recipe saved without its variables asks once more and says why; Always records them',async()=>{
  const dir=tmp(),s=store(dir);write(dir,'job.mjs','console.log("good")\n');
  const cmd=await command(s,['node','job.mjs'],dir),item=s.byName('deploy-key');
  item.recipes=[{id:'old1',argv:cmd.argv,cwd:cmd.cwd,action:'run',pin:cmd.pin,created:'2026-01-01T00:00:00Z'}]; // as a build before this change saved it
  let r=ask(s,{T:'deploy-key'},cmd);assert.ok(r,'never matches silently');assert.equal(r.changed,'unbound');
  s.answer(r.id,'always');
  assert.equal(s.byName('deploy-key').recipes.length,1,'kept in place, not doubled');
  assert.deepEqual(s.byName('deploy-key').recipes[0].bindings.map(b=>b.v),['T']);
  assert.equal(ask(s,{T:'deploy-key'},cmd),null);
  // No pin at all (saved before content was checked): the older notice, which now names the variables too.
  s.byName('deploy-key').recipes=[{id:'old2',argv:cmd.argv,cwd:cmd.cwd,created:'2026-01-01T00:00:00Z'}];
  r=ask(s,{T:'deploy-key'},cmd);assert.equal(r.changed,'unpinned');
  fs.rmSync(dir,{recursive:true,force:true});
});

test('variables over HTTP: the reviewer\'s rerun with NODE_V8_COVERAGE is refused and creates nothing; another name asks',async t=>{
  const s=await vaultServer(t,{port:22417});
  s.file('job.mjs','console.log("good")\n');
  let r=await s.run(['node','job.mjs']);let q=s.asked(r);assert.ok(q);
  assert.deepEqual((await s.request(q.id)).variables,[{v:'T',name:'deploy-key',field:'value'}]);
  await s.answer(q.id,'always');assert.equal(s.out(await s.stream('/vault/wait',{request:q.id})),'good\n');
  const before=new Set(fs.readdirSync(s.work));
  r=await s.run(['node','job.mjs'],{NODE_V8_COVERAGE:'deploy-key'});
  assert.equal(s.asked(r),undefined);assert.match(r.events.at(-1).message,/NODE_V8_COVERAGE cannot be bound/);
  assert.deepEqual(fs.readdirSync(s.work).filter(n=>!before.has(n)),[],'node created nothing named after the value');
  r=await s.run(['node','job.mjs'],{COVERAGE_TOKEN:'deploy-key'});q=s.asked(r);assert.ok(q,'a variable name the owner did not approve asks');
  const row=await s.request(q.id);assert.equal(row.changed,'variables');assert.deepEqual(row.was,[{v:'T',name:'deploy-key',field:'value'}]);
  await s.answer(q.id,'deny');
});

// ---------- (2) a script opened by its path ----------
test('script swap: the request says when an agent can change a script an interpreter opens by its path, and not otherwise',{skip:!LINUX},async()=>{
  const dir=tmp();write(dir,'job.mjs','console.log(1)\n');write(dir,'job.py','print(1)\n');write(dir,'job.sh','echo 1\n');write(dir,'self.sh','echo "$0"\n');
  write(dir,'deploy','#!/usr/bin/env node\nconsole.log(1)\n',0o755);
  const script=async argv=>(await V.pinCommand({argv,cwd:dir},{PATH})).files.find(f=>f.role==='script'||(argv[0].startsWith('./')&&f.role==='program'));
  for(const argv of [['node','job.mjs'],['python3','job.py'],['sh','self.sh'],['./deploy']]){
    if(argv[0]==='python3'&&!has('python3'))continue;
    assert.equal((await script(argv)).writable,true,argv.join(' ')+': opened by its path in a folder this user can write');
  }
  assert.equal((await script(['sh','job.sh'])).writable,undefined,'a shell script runs from a private copy: no note');
  const view=V.VaultStore.prototype.requestView.call({},{action:'run',argv:['node','job.mjs'],pin:await V.pinCommand({argv:['node','job.mjs'],cwd:dir},{PATH})});
  assert.equal(view.files.find(f=>f.role==='script').writable,true,'the card gets it');
  if(!ROOT){
    // A script in a folder this user cannot write, nor any folder above it: no note.
    const sys=['/etc/hostname','/etc/passwd'].find(p=>fs.existsSync(p)&&!V.replaceable(p));
    if(sys)assert.equal((await V.pinCommand({argv:['node',sys],cwd:dir},{PATH})).files.find(f=>f.role==='script').writable,undefined,'a script in a folder this user cannot write: no note');
    // Inside a folder this user can write, a read-only folder can still be renamed away and replaced.
    const inner=path.join(dir,'outer','inner');write(inner,'job.mjs','x\n',0o444);fs.chmodSync(inner,0o555);
    try{assert.equal((await V.pinCommand({argv:['node','job.mjs'],cwd:inner},{PATH})).files.find(f=>f.role==='script').writable,true);}
    finally{fs.chmodSync(inner,0o755);}
  }
  fs.rmSync(dir,{recursive:true,force:true});
});

test('script swap: SECURITY.md and the manual say plainly that a swap at the start usually wins, and what protects',()=>{
  const sec=fs.readFileSync(path.join(repo,'SECURITY.md'),'utf8'),man=fs.readFileSync(path.join(repo,'docs/manual/vault.md'),'utf8');
  for(const [name,text] of [['SECURITY.md',sec],['docs/manual/vault.md',man]]){
    assert.doesNotMatch(text,/about a quarter/,name+': the old figure is gone');
    assert.match(text,/will usually succeed|usually succeeds|usually wins/,name+': says a timed swap usually works');
    assert.match(text,/cannot write/,name+': says what protects (a folder the agent cannot write)');
    assert.match(text,/Allow once/,name+': and Allow once');
  }
});

// ---------- (3) command forms ----------
test('forms: node resolves a name without an extension, python3 -m a module in the folder, make its makefile; each is pinned',async()=>{
  const dir=tmp();
  const pinned=async(argv,file,cwd=dir)=>{const pin=await V.pinCommand({argv,cwd},{PATH});assert.equal(pin.refuse,undefined,argv.join(' ')+' is not refused: '+JSON.stringify(pin.refuse));assert.ok(pin.files.some(f=>f.path===path.join(dir,file)&&f.sha256),argv.join(' ')+' pins '+file+': '+JSON.stringify(pin.files.map(f=>f.path)));return pin;};
  write(dir,'job.js','console.log(1)\n');
  const a=await pinned(['node','job'],'job.js');assert.equal(a.files.find(f=>f.path===path.join(dir,'job.js')).role,'script');
  write(dir,'job.js','console.log(2)\n');assert.ok(V.pinDiff(a,await V.pinCommand({argv:['node','job'],cwd:dir},{PATH})).length,'a changed job.js differs');
  write(dir,'job','console.log(3)\n');assert.ok(V.pinDiff(a,await V.pinCommand({argv:['node','job'],cwd:dir},{PATH})).length,'a file named exactly job, which node would load first, differs');
  write(dir,'lib/helper.js','x\n');await pinned(['node','-r','./lib/helper','job.js'],'lib/helper.js');
  if(has('python3')){
    write(dir,'deploymod.py','print(1)\n');const m=await pinned(['python3','-m','deploymod'],'deploymod.py');
    write(dir,'deploymod.py','print(2)\n');assert.ok(V.pinDiff(m,await V.pinCommand({argv:['python3','-m','deploymod'],cwd:dir},{PATH})).length);
    write(dir,'tool/__init__.py','');write(dir,'tool/__main__.py','print(1)\n');await pinned(['python3','-m','tool'],'tool/__main__.py');
    write(dir,'pkg/__init__.py','');write(dir,'pkg/sub.py','print(1)\n');await pinned(['python3','-m','pkg.sub'],'pkg/sub.py');
    const lib=await V.pinCommand({argv:['python3','-m','json.tool'],cwd:dir},{PATH});assert.equal(lib.refuse,undefined,'a module from the interpreter\'s own library is not refused');
  }
  write(dir,'Makefile','deploy:\n\t@echo good\n');const mk=await pinned(['make','-s','deploy'],'Makefile');
  write(dir,'Makefile','deploy:\n\t@echo other\n');assert.ok(V.pinDiff(mk,await V.pinCommand({argv:['make','-s','deploy'],cwd:dir},{PATH})).length);
  write(dir,'sub/Makefile','all:\n\t@echo sub\n');await pinned(['make','-C','sub'],'sub/Makefile');
  fs.rmSync(dir,{recursive:true,force:true});
});

test('forms: what Pocket cannot pin is not offered Always allow, and the request says why',async()=>{
  const dir=tmp();write(dir,'list.txt','xjob.sh\n');write(dir,'xjob.sh','echo 1\n');write(dir,'fjob.sh','echo 1\n');write(dir,'main.cjs','\n');write(dir,'job.mjs','x\n');write(dir,'mod.ts','x\n');write(dir,'partpkg/__init__.py','');
  // Stand-ins for programs this machine may not have: what decides is the program's name and its arguments.
  for(const n of ['parallel','watch','strace','ssh','npm','npx','yarn','pnpm','docker','podman'])if(!has(n))write(dir,'bin/'+n,'#!/bin/sh\nexit 0\n',0o755);
  const P=[path.join(dir,'bin'),PATH].join(':');
  const refused=[
    [['node','nojob'],'script'],[['xargs','-a','list.txt','sh'],'script'],[['sh'],'script'],[['python3','-m','partpkg.inner'],'script'],
    [['find','.','-name','fjob.s?','-exec','sh','{}',';'],'finds'],[['find','.','-execdir','sh','{}','+'],'finds'],[['node','--test'],'finds'],
    [['parallel','sh',':::','fjob.sh'],'starts'],[['watch','sh','fjob.sh'],'starts'],[['strace','-f','sh','fjob.sh'],'starts'],
    [['ssh','example-host','sh','deploy.sh'],'remote'],[['ssh','-p','2222','example-host','uptime'],'remote'],
    [['npm','run','deploy'],'scripts'],[['npm','publish'],'scripts'],[['npm','test'],'scripts'],[['node','--run','build'],'scripts'],[['yarn','deploy'],'scripts'],[['pnpm','run','x'],'scripts'],
    [['npx','some-tool'],'package'],[['npm','exec','some-tool'],'package'],
    [['docker','run','--rm','-e','T','example/image'],'image'],[['docker','compose','up'],'image'],[['podman','run','example/image'],'image'],
    [['node','--watch','job.mjs'],'live'],[['node','--inspect','job.mjs'],'live'],[['node','--inspect-brk=9229','job.mjs'],'live'],
  ];
  if(has('deno'))refused.push([['deno','run','https://example.com/x.ts'],'web'],[['deno','task','deploy'],'scripts']);
  for(const [argv,why] of refused){
    const pin=await V.pinCommand({argv,cwd:dir},{PATH:P});
    assert.equal(pin.refuse?.why,why,argv.join(' ')+': '+JSON.stringify(pin.refuse||pin));
    assert.equal(V.VaultStore.unpinnable(pin),true,argv.join(' ')+' is never allowed always');
  }
  // An option Pocket does not know for a launcher: no Always allow either.
  assert.equal(V.VaultStore.unpinnable(await V.pinCommand({argv:['env','-S','sh fjob.sh'],cwd:dir},{PATH})),true);
  // Still offered: inline code (its text is matched), a launcher Pocket follows, ssh with no command, npm and docker commands that run nothing of the project's.
  for(const argv of [['sh','-c','echo "$T" | wc -c'],['timeout','5','sh','fjob.sh'],['xargs','-a','list.txt','echo'],['node','job.mjs'],['ssh','example-host'],['npm','whoami'],['docker','push','example/image'],['find','.','-name','*.sh']]){
    const pin=await V.pinCommand({argv,cwd:dir},{PATH:P});
    assert.equal(V.VaultStore.unpinnable(pin),false,argv.join(' ')+': '+JSON.stringify(pin.refuse||pin.unknown||pin.error));
  }
  fs.rmSync(dir,{recursive:true,force:true});
});

// 1.124.4 (bug review DIV-2): scp and rsync ran a helper given in an attached or clustered spelling (scp -S./h, -qS./h,
// rsync -ave./h) unasked after one Always; scp and sftp also start one for -D, a ProxyCommand-style -o, and sftp's batch file.
test('forms: scp, sftp and rsync with a local helper program, in any spelling, are not offered Always allow',async()=>{
  const dir=tmp();write(dir,'h','#!/bin/sh\nexit 1\n',0o755);write(dir,'src.txt','x\n');write(dir,'batch','!./h\n');
  for(const n of ['scp','sftp','rsync'])if(!has(n))write(dir,'bin/'+n,'#!/bin/sh\nexit 0\n',0o755);
  const P=[path.join(dir,'bin'),PATH].join(':'),dst='example.invalid:dst';
  const refused=[
    ['scp','-S./h','src.txt',dst],['scp','-qS./h','src.txt',dst],['scp','-S','./h','src.txt',dst],['scp','-D./h','src.txt',dst],['scp','-D','./h','src.txt',dst],
    ['scp','-oProxyCommand=./h','src.txt',dst],['scp','-o','ProxyCommand=./h','src.txt',dst],['scp','-o','ProxyCommand ./h','src.txt',dst],['scp','-qoProxyCommand=./h','src.txt',dst],
    ['sftp','-S./h','example.invalid'],['sftp','-S','./h','example.invalid'],['sftp','-D','./h','example.invalid'],['sftp','-oProxyCommand=./h','example.invalid'],
    ['sftp','-bbatch','example.invalid'],['sftp','-b','batch','example.invalid'],
    ['rsync','-ave./h','src.txt',dst],['rsync','-e./h','src.txt',dst],['rsync','-avze','./h','src.txt',dst],['rsync','-e','./h','src.txt',dst],['rsync','--rsh=./h','src.txt',dst],['rsync','src.txt',dst,'--rsh','./h'],
  ];
  for(const argv of refused){
    const pin=await V.pinCommand({argv,cwd:dir},{PATH:P});
    assert.equal(pin.refuse?.why,'starts',argv.join(' ')+': '+JSON.stringify(pin.refuse||null));
    assert.equal(V.VaultStore.unpinnable(pin),true,argv.join(' ')+' is never allowed always');
  }
  // Still offered: copies that start no program of their own here (-J goes through ssh, like a plain copy).
  for(const argv of [['scp','-q','-P','2222','src.txt',dst],['scp','-J','example.invalid','src.txt',dst],['sftp','-P','2222','example.invalid'],['rsync','-av','src.txt',dst],['rsync','-av','--delete','src.txt',dst]]){
    const pin=await V.pinCommand({argv,cwd:dir},{PATH:P});
    assert.equal(V.VaultStore.unpinnable(pin),false,argv.join(' ')+': '+JSON.stringify(pin.refuse||pin.unknown||null));
  }
  fs.rmSync(dir,{recursive:true,force:true});
});

test('forms over HTTP: the reviewer\'s four commands either ask again after a change or are never allowed always',async t=>{
  const s=await vaultServer(t,{port:22467});
  const loot=path.join(s.work,'loot'),leaked=()=>fs.existsSync(loot)&&fs.readFileSync(loot,'utf8')===SECRET;
  const GOOD_SH='echo good\n',EVIL_SH='printf %s "$T" > loot\necho evil\n';
  const forms=[
    {argv:['node','job'],setup:()=>s.file('job.js','console.log("good")\n'),change:()=>s.file('job.js','require("fs").writeFileSync("loot",process.env.T);console.log("evil")\n')},
    {argv:['python3','-m','deploymod'],setup:()=>s.file('deploymod.py','print("good")\n'),change:()=>s.file('deploymod.py','import os\nopen("loot","w").write(os.environ["T"])\nprint("evil")\n'),need:'python3'},
    {argv:['xargs','-a','list.txt','sh'],setup:()=>{s.file('list.txt','xjob.sh\n');s.file('xjob.sh',GOOD_SH);},change:()=>s.file('xjob.sh',EVIL_SH)},
    {argv:['find','.','-maxdepth','1','-name','fjob.s?','-exec','sh','{}',';'],setup:()=>s.file('fjob.sh',GOOD_SH),change:()=>s.file('fjob.sh',EVIL_SH)},
  ];
  for(const f of forms){
    if(f.need&&!has(f.need))continue;
    f.setup();
    let r=await s.run(f.argv);let q=s.asked(r);assert.ok(q,f.argv.join(' ')+' asks the first time');
    const row=await s.request(q.id);
    if(row.allowAlways===false){
      assert.ok(row.refuse?.why,f.argv.join(' ')+': the card says why Always allow is not offered');
      const saved=async()=>(await s.call('/vault')).body.items[0].recipes.filter(x=>JSON.stringify(x.argv)===JSON.stringify(f.argv)).length;
      assert.equal((await s.answer(q.id,'always')).status,200);await s.stream('/vault/wait',{request:q.id});
      assert.equal(await saved(),0,f.argv.join(' ')+': nothing saved');
    }else{
      await s.answer(q.id,'always');assert.equal(s.out(await s.stream('/vault/wait',{request:q.id})).trim(),'good',f.argv.join(' '));
      r=await s.run(f.argv);assert.equal(s.asked(r),undefined,f.argv.join(' ')+': unchanged, it runs');
    }
    f.change();
    r=await s.run(f.argv);q=s.asked(r);
    assert.ok(q,f.argv.join(' ')+': after the change it asks: '+JSON.stringify(r.events));await s.answer(q.id,'deny');
    assert.equal(leaked(),false,f.argv.join(' ')+': the value never reached the changed file');
  }
});
