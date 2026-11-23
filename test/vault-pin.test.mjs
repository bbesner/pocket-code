// 1.118 (PC-02, independent review D-1 to D-4): what a Vault run executes is what was checked. The swap race, files Pocket
// cannot hash, a file the command writes, launchers, inline code, the Vault PATH warning, an item edited while a large file
// is hashed, and recipes saved before this change. The module is read through a namespace so each check fails on its own
// against a store that lacks a function, instead of the whole file failing to load.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import * as V from '../vault.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pocket-vault-pin-'));
const SECRET='sk-live-hunter2-0123456789abcdef';
const ROOT=process.getuid?.()===0;
const LINUX=process.platform==='linux';
const has=name=>['/usr/bin','/bin','/usr/local/bin'].some(d=>{try{fs.accessSync(path.join(d,name),fs.constants.X_OK);return true;}catch{return false;}});
const hex=s=>Buffer.from(s).toString('hex');

// A server of this tree on a private port, with the Vault on and one secret, deploy-key, that asks once per command.
// vaultPath: the folders POCKET_VAULT_PATH lists (default: shim/ and bin/ under the test folder, node's, /usr/bin, /bin).
async function vaultServer(t,{port=19981,vaultPath,policy}={}){
  const dir=tmp(),secret=randomUUID(),exp=Date.now()+3600000,key=V.newKey();
  const cookie='pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const headers={'content-type':'application/json',cookie};
  const s={dir,key,work:path.join(dir,'work'),shim:path.join(dir,'shim'),bin:path.join(dir,'bin'),logs:''};
  for(const d of ['sessions','data',s.shim,s.bin,s.work])fs.mkdirSync(path.resolve(dir,d),{recursive:true});
  const PATH=(vaultPath||[s.shim,s.bin,path.dirname(process.execPath),'/usr/bin','/bin']).join(':');
  let child;
  s.start=async()=>{
   s.logs='';
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SKILLS:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),POCKET_VAULT_KEY:key,POCKET_VAULT_PATH:PATH},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{s.logs+=b});child.stderr.on('data',b=>{s.logs+=b});
   for(let i=0;i<150;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)break;}catch{} await sleep(30)}
   if(child.exitCode!==null&&/EADDRINUSE/.test(s.logs)&&(s.tries=(s.tries||0)+1)<6){port+=53;return s.start();}
   if(child.exitCode!==null)throw Error('Test server failed: '+s.logs);
   s.bearer={'content-type':'application/json',authorization:'Bearer '+fs.readFileSync(path.join(dir,'data','cli-token'),'utf8').trim()};
  };
  s.stop=async()=>{if(child&&child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}};
  t.after(async()=>{await s.stop();fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  s.call=async(p,body,h=headers)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers:h,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};};
  s.stream=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:'POST',headers:s.bearer,body:JSON.stringify(body)});if(!r.ok)return {status:r.status,events:[],body:await r.json().catch(()=>({}))};const text=await r.text();return {status:r.status,events:text.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l))};};
  s.run=(argv,extra={})=>s.stream('/vault/run',{argv,cwd:s.work,env:{T:'deploy-key'},wait:1,...extra});
  s.out=r=>r.events.filter(e=>e.t==='out').map(e=>e.s).join('');
  s.asked=r=>r.events.find(e=>e.t==='request');
  s.answer=(id,decision,extra={})=>s.call('/vault/act',{action:'answer',request:id,decision,...extra});
  s.request=async id=>(await s.call('/vault')).body.requests.find(x=>x.id===id);
  // Run, expect a request, answer it, and return the continued run.
  s.allow=async(argv,decision,extra={})=>{const r=await s.run(argv);const q=s.asked(r);assert.ok(q,'expected a request: '+JSON.stringify(r.events));const a=await s.answer(q.id,decision,extra);assert.equal(a.status,200,JSON.stringify(a.body));return s.stream('/vault/wait',{request:q.id});};
  s.file=(name,text,mode=0o644)=>{const p=path.join(s.work,name);fs.writeFileSync(p,text,{mode});return p;};
  await s.start();
  assert.equal((await s.call('/settings',{vault:true})).body.vault,true);
  const add=await s.call('/vault/act',{action:'add',name:'deploy-key',kind:'token',values:{value:SECRET},...(policy?{policy}:{})});assert.equal(add.status,200);s.item=add.body.item.id;
  return s;
}

// The reviewer's D-1 scenario: an approved script is swapped for another while the run is being checked, at every delay from
// 0 to 20 ms after the run is asked for, 15 tries each. Before 1.118 about half of the tries ran the swapped script with the
// secret. Now none may: each try runs the approved script, asks the owner, or is refused.
const SWAPPER=`const {parentPort,workerData}=require('node:worker_threads');const fs=require('node:fs');const path=require('node:path');
parentPort.on('message',({delay})=>{const t0=performance.now();while(performance.now()-t0<delay){}
 const job=path.join(workerData.work,workerData.name),evil=path.join(workerData.work,'evil-ready');
 if(workerData.mode==='inplace')fs.writeFileSync(job,fs.readFileSync(evil));else fs.renameSync(evil,job);parentPort.postMessage('swapped');});`;
async function race(t,{port,argv,name,mode,shebang=''}){
  const s=await vaultServer(t,{port});
  const GOOD=shebang+'echo good\n',EVIL=shebang+'printf %s "$T" > loot\necho evil\n';
  const job=path.join(s.work,name),loot=path.join(s.work,'loot');
  const put=(f,c)=>{fs.writeFileSync(f+'.tmp',c,{mode:0o755});fs.renameSync(f+'.tmp',f);};
  put(job,GOOD);
  assert.equal(s.out(await s.allow(argv,'always')),'good\n');
  const w=new Worker(SWAPPER,{eval:true,workerData:{work:s.work,name,mode}});t.after(()=>w.terminate());
  const tally={evil:0,good:0,asked:0,refused:0};
  for(let delay=0;delay<=20;delay++)for(let k=0;k<15;k++){
    put(job,GOOD);fs.writeFileSync(path.join(s.work,'evil-ready'),EVIL,{mode:0o755});
    await sleep(5);
    const swapped=new Promise(r=>w.once('message',r));w.postMessage({delay});const r=await s.run(argv);await swapped;
    const q=s.asked(r);
    if(q){tally.asked++;await s.answer(q.id,'deny');}
    else if(/evil/.test(s.out(r)))tally.evil++;else if(/good/.test(s.out(r)))tally.good++;else tally.refused++;
  }
  t.diagnostic(`${argv.join(' ')} (${mode}), 315 tries: ${JSON.stringify(tally)}`);
  assert.equal(tally.evil,0,'the swapped script never ran: '+JSON.stringify(tally));
  assert.equal(fs.existsSync(loot),false,'the secret never reached the swapped script');
  assert.ok(tally.good>0,'the approved script still runs: '+JSON.stringify(tally));
}
test('D-1 race: an approved `sh job.sh` swapped by rename at 0-20 ms never runs the swapped script',{skip:!LINUX},t=>race(t,{port:19981,argv:['sh','job.sh'],name:'job.sh',mode:'rename'}));
test('D-1 race: an approved `sh job.sh` rewritten in place at 0-20 ms never runs the rewritten script',{skip:!LINUX},t=>race(t,{port:20031,argv:['sh','job.sh'],name:'job.sh',mode:'inplace'}));
test('D-1 race: an approved `./job.sh` (#!/bin/sh) swapped by rename at 0-20 ms never runs the swapped script',{skip:!LINUX},t=>race(t,{port:20081,argv:['./job.sh'],name:'job.sh',mode:'rename',shebang:'#!/bin/sh\n'}));

test('D-1: a native program starts from the handle it was hashed from, a shell script from a private copy; anything else is checked again just before the start',{skip:!LINUX},async()=>{
  const dir=tmp(),PATH=[path.dirname(process.execPath),'/usr/bin','/bin'].join(':');
  fs.writeFileSync(path.join(dir,'job.sh'),'echo good\n');fs.writeFileSync(path.join(dir,'job.js'),'console.log(1)\n');
  const sh=await V.prepareRun({argv:['sh','job.sh'],cwd:dir},{PATH,forRun:true});
  try{
    assert.match(sh.file,/^\/proc\/self\/fd\/\d+$/,'sh starts from its hashed handle');assert.match(sh.args[0],/^\/proc\/self\/fd\/\d+$/,'the script is a private copy');
    assert.equal(sh.argv0,'sh');assert.equal(sh.fds.length,2);
    fs.renameSync(path.join(dir,'job.sh'),path.join(dir,'old.sh'));fs.writeFileSync(path.join(dir,'job.sh'),'echo evil\n');
    assert.throws(()=>sh.verify(),e=>e.status===409&&/job\.sh changed just before the command started/.test(e.message));
  }finally{sh.close();}
  // A script that names its own path runs from that path, and is checked again instead.
  fs.writeFileSync(path.join(dir,'self.sh'),'cd "$(dirname "$0")"\n');
  const self=await V.prepareRun({argv:['sh','self.sh'],cwd:dir},{PATH,forRun:true});try{assert.equal(self.args[0],'self.sh');}finally{self.close();}
  const node=await V.prepareRun({argv:['node','job.js'],cwd:dir},{PATH,forRun:true});
  try{
    assert.equal(node.args[0],'job.js','node opens its script by path');node.verify();
    fs.writeFileSync(path.join(dir,'job.js'),'console.log(2)\n');
    assert.throws(()=>node.verify(),/job\.js changed just before the command started/,'an in-place change of the same size is caught');
  }finally{node.close();}
  fs.rmSync(dir,{recursive:true,force:true});
});

test('D-2: a file Pocket cannot hash runs on Allow once; Always compares its size and dates and names it when they change',async t=>{
  const s=await vaultServer(t,{port:20131});
  s.file('show.sh','echo "ok $T"\n');
  const big=s.file('big.bin','');fs.truncateSync(big,V.PIN_LIMITS.fileBytes+1024*1024); // sparse: over the limit, nothing to read
  let r=await s.allow(['sh','show.sh','big.bin'],'once');assert.equal(s.out(r),'ok {{vault:deploy-key}}\n','an over-limit file runs on Allow once');
  if(!ROOT){
    const locked=s.file('locked.txt','x',0o000);
    r=await s.allow(['sh','show.sh','locked.txt'],'once');assert.equal(s.out(r),'ok {{vault:deploy-key}}\n','an unreadable file runs on Allow once');
    const q=s.asked(await s.run(['sh','show.sh','locked.txt']));const row=await s.request(q.id);
    assert.equal(row.files.find(f=>f.path===locked).why,'unreadable','the card says it cannot read it');await s.answer(q.id,'deny');
  }
  // Always: the card says size and dates only; the same file runs unasked; new dates ask again, naming the file.
  r=await s.run(['sh','show.sh','big.bin']);let q=s.asked(r);assert.equal((await s.request(q.id)).files.find(f=>f.path===big).why,'large');
  assert.equal((await s.answer(q.id,'always')).status,200);assert.equal(s.out(await s.stream('/vault/wait',{request:q.id})),'ok {{vault:deploy-key}}\n');
  r=await s.run(['sh','show.sh','big.bin']);assert.equal(s.asked(r),undefined);assert.equal(s.out(r),'ok {{vault:deploy-key}}\n');
  fs.utimesSync(big,new Date(Date.now()-86400e3),new Date(Date.now()-86400e3));
  r=await s.run(['sh','show.sh','big.bin']);q=s.asked(r);assert.ok(q,'changed dates ask again');assert.equal(q.changed,'changed');
  assert.deepEqual((await s.request(q.id)).changedFiles,[{path:big,how:'changed'}]);
});

test('D-3: a file the command writes, marked by the owner, does not ask on every run; only an argument can be marked',async t=>{
  const s=await vaultServer(t,{port:20181});
  const script=s.file('write.sh','date +%s%N > "$1"\necho "wrote with $T"\n'),outFile=s.file('out.json','{}');
  const argv=['sh','write.sh','out.json'];
  // Always without marking: the next run asks, and the card names out.json as what changed.
  let r=await s.allow(argv,'always');assert.equal(s.out(r),'wrote with {{vault:deploy-key}}\n');
  r=await s.run(argv);let q=s.asked(r);assert.ok(q,'the output changed, so it asks');assert.equal(q.changed,'changed');
  let row=await s.request(q.id);assert.deepEqual(row.changedFiles,[{path:outFile,how:'changed'}]);
  assert.deepEqual(row.files.filter(f=>f.role==='argument').map(f=>f.path),[outFile],'the card lists the file it may untick');
  // The script decides what runs: it cannot be left unchecked; nor can a file the command does not name.
  assert.equal((await s.answer(q.id,'always',{data:[script]})).status,400);
  assert.match((await s.answer(q.id,'always',{data:[path.join(s.work,'other.json')]})).body.error,/Only a file the command names as an argument/);
  // The owner unticks out.json: three runs in a row, each rewriting it, ask nothing.
  assert.equal((await s.answer(q.id,'always',{data:[outFile]})).status,200);assert.match(s.out(await s.stream('/vault/wait',{request:q.id})),/wrote with/);
  const seen=new Set();
  for(let i=0;i<3;i++){r=await s.run(argv);assert.equal(s.asked(r),undefined,'run '+(i+1)+' asks nothing');assert.equal(s.out(r),'wrote with {{vault:deploy-key}}\n');seen.add(fs.readFileSync(outFile,'utf8'));}
  assert.equal(seen.size,3,'the command wrote out.json each time');
  // The script still counts: changing it asks, naming it alone, and the card keeps out.json unticked for the next Always.
  fs.appendFileSync(script,'echo extra\n');
  r=await s.run(argv);q=s.asked(r);assert.ok(q);row=await s.request(q.id);
  assert.deepEqual(row.changedFiles,[{path:script,how:'changed'}]);assert.deepEqual(row.data,[outFile]);
  const recipe=(await s.call('/vault')).body.items[0].recipes.find(x=>x.argv.join(' ')===argv.join(' '));
  assert.equal(recipe.pin.files.find(f=>f.path===outFile).data,true);assert.equal(recipe.pin.files.find(f=>f.path===outFile).sha256,undefined);
});

// Launchers: each pins the program it starts, found on the Vault PATH and handed to the launcher by full path.
test('D-4 launchers: env, timeout, nice, nohup, xargs, sudo, stdbuf, ionice, setsid, taskset, chrt, time and doas pin the program they start',async()=>{
  const dir=tmp(),bin=path.join(dir,'bin');fs.mkdirSync(bin);
  for(const n of ['env','timeout','nice','nohup','xargs','sudo','stdbuf','ionice','setsid','taskset','chrt','time','doas'])fs.writeFileSync(path.join(bin,n),'#!/bin/sh\nexec "$@"\n',{mode:0o755});
  fs.writeFileSync(path.join(dir,'job.sh'),'echo hi\n');
  const PATH=[bin,'/usr/bin','/bin'].join(':'),sh=V.findProgram('sh',dir,PATH),job=path.join(dir,'job.sh');
  const forms=[['env','sh','job.sh'],['env','-i','FOO=1','sh','job.sh'],['timeout','-s','KILL','10','sh','job.sh'],['timeout','5','nice','sh','job.sh'],['nice','-n','5','sh','job.sh'],['nohup','sh','job.sh'],
   ['xargs','-0','sh','job.sh'],['sudo','-n','-u','root','sh','job.sh'],['stdbuf','-oL','sh','job.sh'],['ionice','-c','3','sh','job.sh'],['setsid','-w','sh','job.sh'],['taskset','-c','0','sh','job.sh'],
   ['chrt','-o','0','sh','job.sh'],['time','-f','%e','sh','job.sh'],['doas','-u','root','sh','job.sh']];
  for(const argv of forms){
    const plan=await V.prepareRun({argv,cwd:dir},{PATH,forRun:true});
    try{
      const files=plan.pin.files;
      assert.ok(files.some(f=>f.role==='launched'&&f.path===sh),argv.join(' ')+': pins the sh it starts');
      assert.ok(files.some(f=>f.role==='script'&&f.path===job&&f.sha256),argv.join(' ')+': pins the script');
      assert.equal(plan.pin.unknown,undefined,argv.join(' '));
      assert.ok(plan.args.includes(sh)||plan.args.some(a=>/^\/proc\/self\/fd\//.test(a)),argv.join(' ')+': the launcher gets the full path: '+plan.args.join(' '));
    }finally{plan.close();}
  }
  // xargs with no command starts echo; a launcher option Pocket does not know makes the program unknown, and says so.
  const xa=await V.pinCommand({argv:['xargs'],cwd:dir},{PATH});assert.ok(xa.files.some(f=>f.role==='launched'&&path.basename(f.path)==='echo'));
  for(const [argv,unknown] of [[['env','-S','sh job.sh'],'env -S'],[['env','PATH=/tmp','sh','job.sh'],'env PATH='],[['sudo','-i'],'sudo -i'],[['sudo','-s'],'sudo -s'],[['nice','--bogus','sh','job.sh'],'nice --bogus']])
    assert.equal((await V.pinCommand({argv,cwd:dir},{PATH})).unknown,unknown,argv.join(' '));
  // The card carries what runs and what cannot be checked, without hashes.
  const view=V.VaultStore.prototype.requestView.call({},{action:'run',argv:['env','-S','x'],pin:await V.pinCommand({argv:['timeout','5','sh','job.sh'],cwd:dir},{PATH})});
  assert.equal(view.runs,sh);assert.equal(JSON.stringify(view).includes('sha256'),false);
  fs.rmSync(dir,{recursive:true,force:true});
});

// 1.124.4 (bug review DIV-1): a #! line is read the way Linux and env read it.
test('#! lines: env -S in a #! line is not offered Always; an interpreter that is itself a script has its own #! line pinned',async t=>{
  const dir=tmp(),bin=path.join(dir,'bin');fs.mkdirSync(bin);t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const exe=(name,text)=>{const p=path.join(dir,name);fs.writeFileSync(p,text,{mode:0o755});return p;};
  const tool=exe('bin/zz-tool','#!/bin/sh\necho tool\n'),PATH=['/usr/bin','/bin'].join(':');
  // The kernel hands env the rest of the line as one word; -S splits it and applies what it says (a PATH of its own here),
  // so the program that runs is not the one the Vault's PATH finds. Reached directly or through a launcher.
  for(const [i,arg] of [`-S PATH=${bin} zz-tool`,'-S zz-tool','-vS zz-tool','-iS PATH=/elsewhere zz-tool','--split-string=zz-tool','--s=zz-tool'].entries()){
    const job=exe('job'+i,`#!/usr/bin/env ${arg}\necho body\n`);
    for(const argv of [[job],['timeout','5',job],['env',job]]){
      const pin=await V.pinCommand({argv,cwd:dir},{PATH:[bin,PATH].join(':')});
      assert.equal(pin.unknown,'env -S',`${argv.join(' ')} with #!/usr/bin/env ${arg}`);
      assert.equal(V.VaultStore.unpinnable(pin),true);
    }
  }
  // Without -S, env looks its one word up on the Vault's PATH: that program is pinned and Always is offered.
  const plain=await V.pinCommand({argv:[exe('plain','#!/usr/bin/env sh\necho body\n')],cwd:dir},{PATH});
  assert.ok(plain.files.some(f=>f.role==='interpreter'&&f.path===V.findProgram('sh',dir,PATH)),JSON.stringify(plain.files));
  assert.equal(V.VaultStore.unpinnable(plain),false);
  // An interpreter that is itself a script: Linux runs that script's #! line too, so it is followed and pinned.
  const wrap=exe('wrap',`#!/usr/bin/env -S PATH=${bin} zz-tool\n`);
  assert.equal((await V.pinCommand({argv:[exe('nested',`#!${wrap}\necho body\n`)],cwd:dir},{PATH})).unknown,'env -S');
  const nested2=await V.pinCommand({argv:[exe('nested2',`#!${tool}\necho body\n`)],cwd:dir},{PATH});
  assert.deepEqual(nested2.files.filter(f=>f.role==='interpreter').map(f=>f.path),[tool,'/bin/sh']);assert.equal(V.VaultStore.unpinnable(nested2),false);
  // A #! line that names its own file (Linux gives up after a few levels) ends, and is not offered Always.
  const loop=path.join(dir,'loop');exe('loop',`#!${loop}\n`);
  assert.ok((await V.pinCommand({argv:[loop],cwd:dir},{PATH})).unknown);
});

test('D-4 launchers over HTTP: a shim for the program `env` starts asks again and does not run',async t=>{
  const s=await vaultServer(t,{port:20231});
  s.file('job.sh','echo "job with $T"\n');
  assert.equal(s.out(await s.allow(['env','sh','job.sh'],'always')),'job with {{vault:deploy-key}}\n');
  let r=await s.run(['env','sh','job.sh']);assert.equal(s.asked(r),undefined);
  fs.writeFileSync(path.join(s.shim,'sh'),'#!/bin/sh\ntouch "$PWD/ran"\necho shim\n',{mode:0o755});
  r=await s.run(['env','sh','job.sh']);const q=s.asked(r);assert.ok(q,'a new sh earlier on the PATH asks: '+JSON.stringify(r.events));assert.equal(q.changed,'changed');
  assert.equal(fs.existsSync(path.join(s.work,'ran')),false,'the shim did not run');
  const row=await s.request(q.id);assert.equal(row.runs,path.join(s.shim,'sh'),'the card shows the program env would start');
  assert.ok(row.changedFiles.some(f=>f.path===path.join(s.shim,'sh')));
});

test('D-4 inline code: sh -c, bash -c with a here-string, node -e, python3 -c and perl -e are marked; files they name plainly are pinned',async t=>{
  const dir=tmp(),PATH=[path.dirname(process.execPath),'/usr/bin','/bin'].join(':');fs.writeFileSync(path.join(dir,'deploy.sh'),'echo deploy\n');
  const forms=[[['sh','-c','sh deploy.sh'],'sh -c'],[['bash','-ec','bash <<< "$(cat deploy.sh)"'],'bash -c'],[['node','-e','require("child_process").execSync("sh deploy.sh")'],'node -e'],
   [['python3','-c','exec(open("deploy.sh").read())'],'python3 -c'],[['perl','-e','do "deploy.sh"'],'perl -e']];
  for(const [argv,how] of forms){
    if(argv[0]!=='node'&&!has(argv[0])){t.diagnostic(argv[0]+' is not installed; skipped');continue;}
    const pin=await V.pinCommand({argv,cwd:dir},{PATH});
    assert.equal(pin.inline,how,argv.join(' '));
    assert.ok(pin.files.some(f=>f.path===path.join(dir,'deploy.sh')&&f.sha256),argv.join(' ')+': deploy.sh is pinned');
  }
  fs.rmSync(dir,{recursive:true,force:true});
  // Over HTTP: the card says the code is inline, and a changed deploy.sh behind `sh -c 'sh deploy.sh'` asks again.
  const s=await vaultServer(t,{port:20281});
  s.file('deploy.sh','echo "deploy with $T"\n');
  const argv=['sh','-c','sh deploy.sh'];
  let r=await s.run(argv);let q=s.asked(r);assert.equal((await s.request(q.id)).inline,'sh -c');
  assert.equal((await s.answer(q.id,'always')).status,200);assert.equal(s.out(await s.stream('/vault/wait',{request:q.id})),'deploy with {{vault:deploy-key}}\n');
  s.file('deploy.sh','touch ran\necho "other with $T"\n');
  r=await s.run(argv);q=s.asked(r);assert.ok(q,'a changed deploy.sh asks again');assert.equal(fs.existsSync(path.join(s.work,'ran')),false);
  assert.deepEqual((await s.request(q.id)).changedFiles,[{path:path.join(s.work,'deploy.sh'),how:'changed'}]);
});

test('D-4 Vault PATH: one start-up warning for each folder this user could change, none for system folders',async t=>{
  const dir=tmp(),own=path.join(dir,'own');fs.mkdirSync(own);
  const missing=path.join(own,'not-yet'),readOnlyParent=path.join(dir,'ro'),sub=path.join(readOnlyParent,'bin');fs.mkdirSync(sub,{recursive:true});fs.chmodSync(sub,0o555);fs.chmodSync(readOnlyParent,0o555);
  t.after(()=>{fs.chmodSync(readOnlyParent,0o755);fs.chmodSync(sub,0o755);fs.rmSync(dir,{recursive:true,force:true});});
  const got=Object.fromEntries(V.exposedFolders([own,missing,sub,'/usr/bin','/bin'].join(':')).map(x=>[x.dir,x.why]));
  if(!ROOT){
    assert.equal(got[own],'writable');assert.equal(got[missing],'missing');
    assert.equal(got[sub],'parent','a read-only folder inside a folder this user can write can be renamed away and replaced');
    assert.equal(got['/usr/bin'],undefined);assert.equal(got['/bin'],undefined);
  }
  const s=await vaultServer(t,{port:20331,vaultPath:[own,'/usr/bin','/bin']});
  await sleep(100);
  const lines=s.logs.split('\n').filter(l=>/vault: warning: the Vault's PATH folder/.test(l));
  assert.equal(lines.length,1,'one warning: '+s.logs);assert.match(lines[0],new RegExp(own.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+' can be written by this user'));assert.match(lines[0],/POCKET_VAULT_PATH/);
  // Turning the Vault off and on again does not repeat it.
  await s.call('/settings',{vault:false});await s.call('/settings',{vault:true});await sleep(50);
  assert.equal(s.logs.split('\n').filter(l=>/the Vault's PATH folder/.test(l)).length,1);
});

test('D-4: an item edited or removed while a large file is hashed is not used with its old value',async t=>{
  const s=await vaultServer(t,{port:20381,policy:'auto'});
  s.file('peek.sh','printf %s "$T" | od -An -tx1 | tr -d " \\n" > got\necho done\n');
  const big=s.file('big.bin','');
  const NEW='sk-live-rotated-9876543210fedcba';
  for(const what of ['edit','remove']){
    fs.truncateSync(big,0);fs.truncateSync(big,V.PIN_LIMITS.fileBytes-12*1024*1024+(what==='edit'?0:4096)); // ~500 MB, sparse, not yet in the hash cache
    fs.rmSync(path.join(s.work,'got'),{force:true});
    const running=s.run(['sh','peek.sh','big.bin']);
    await sleep(30);
    if(what==='edit')assert.equal((await s.call('/vault/act',{action:'update',item:s.item,values:{value:NEW}})).status,200);
    else assert.equal((await s.call('/vault/act',{action:'remove',item:s.item})).status,200);
    const r=await running,end=r.events.at(-1)||{t:'error',message:String(r.body?.error)};
    const got=fs.existsSync(path.join(s.work,'got'))?fs.readFileSync(path.join(s.work,'got'),'utf8'):null;
    assert.notEqual(got,hex(SECRET),what+': the old value never reached the command');
    if(what==='edit')assert.ok(got===hex(NEW)||(end.t==='error'&&/changed while the command was being checked/.test(end.message)),'the new value or a refusal: '+JSON.stringify(r.events));
    else{assert.equal(got,null,'a removed item is not used');assert.equal(end.t,'error');}
  }
});

// Recipes saved before this change: none of them runs something that was not checked the way it is now.
test('recipes saved before 1.118: no pin asks once, a matching earlier pin runs, a narrower or unhashed one asks once; Always records the new form',async t=>{
  const s=await vaultServer(t,{port:20431});
  s.file('job.sh','echo "job with $T"\n');s.file('locked.txt','x');
  const sh=V.findProgram('sh',s.work,[s.shim,s.bin,'/usr/bin','/bin'].join(':')),job=path.join(s.work,'job.sh');
  const h=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  await s.stop();
  // Write recipes in the earlier forms straight into the store, as an older Pocket would have left them.
  const file=path.join(s.dir,'data','vault.enc'),k=V.parseKey(s.key),data=V.decryptStore([k],fs.readFileSync(file));
  const created=new Date().toISOString();let n=0;const recipe=(argv,pin)=>({id:'old'+(++n),argv,cwd:s.work,action:'run',...(pin?{pin}:{}),created});
  const env=V.findProgram('env',s.work,'/usr/bin:/bin');
  data.items[0].recipes=[
    recipe(['sh','job.sh']), // no pin at all
    recipe(['sh','-e','job.sh'],{v:1,program:sh,files:[{role:'program',path:sh,sha256:h(sh)},{role:'argument',path:job,sha256:h(job)}]}), // the first form, still true
    recipe(['env','sh','job.sh'],{v:1,program:env,files:[{role:'program',path:env,sha256:h(env)},{role:'argument',path:job,sha256:h(job)}]}), // the first form, without the sh env starts
    recipe(['sh','job.sh','locked.txt'],{v:1,program:sh,files:[{role:'program',path:sh,sha256:h(sh)},{role:'argument',path:job,sha256:h(job)},{role:'argument',path:path.join(s.work,'locked.txt'),sha256:null}]}), // a file it could not hash
  ];
  fs.writeFileSync(file,V.encryptStore(k,data));
  await s.start();
  const expect=async(argv,want)=>{const r=await s.run(argv);const q=s.asked(r);if(want==='runs'){assert.equal(q,undefined,argv.join(' ')+' runs unasked');assert.equal(s.out(r),'job with {{vault:deploy-key}}\n');return null;}assert.ok(q,argv.join(' ')+' asks');assert.equal(q.changed,want,argv.join(' '));return q;};
  let q=await expect(['sh','job.sh'],'unpinned');assert.equal((await s.answer(q.id,'deny')).status,200);
  // A matching earlier pin still has no record of which variable gets which item: it asks once more, then runs.
  q=await expect(['sh','-e','job.sh'],'unbound');
  assert.equal((await s.answer(q.id,'always')).status,200);assert.equal(s.out(await s.stream('/vault/wait',{request:q.id})),'job with {{vault:deploy-key}}\n');
  await expect(['sh','-e','job.sh'],'runs');
  q=await expect(['env','sh','job.sh'],'unpinned');
  // Always on that request records the current form in place; the next run is unasked.
  assert.equal((await s.answer(q.id,'always')).status,200);assert.equal(s.out(await s.stream('/vault/wait',{request:q.id})),'job with {{vault:deploy-key}}\n');
  await expect(['env','sh','job.sh'],'runs');
  const recipes=(await s.call('/vault')).body.items[0].recipes;
  assert.equal(recipes.filter(r=>r.argv.join(' ')==='env sh job.sh').length,1,'recorded in place, not doubled');
  assert.equal(recipes.find(r=>r.argv.join(' ')==='env sh job.sh').pin.v,V.PIN_VERSION);
  q=await expect(['sh','job.sh','locked.txt'],'unpinned');await s.answer(q.id,'deny');
  // A recipe whose script has changed since asks too, and nothing runs.
  fs.writeFileSync(job,'touch ran\necho "job with $T"\n');
  q=await expect(['sh','-e','job.sh'],'changed');assert.equal(fs.existsSync(path.join(s.work,'ran')),false);
});

test('a script that is not a regular file (a pipe here) has no content to compare: Always allow is not offered or saved',{skip:!LINUX},async()=>{
  const dir=tmp();spawnSync('mkfifo',[path.join(dir,'pipe')]);
  const PATH=['/usr/bin','/bin'].join(':'),pin=await V.pinCommand({argv:['sh','pipe'],cwd:dir},{PATH});
  assert.deepEqual(pin.files.filter(f=>f.role==='script').map(f=>f.kind),['pipe']);
  const s=new V.VaultStore(path.join(dir,'vault.enc'),{key:V.parseKey(V.newKey())});s.access=()=>'once';
  s.act({action:'add',name:'deploy-key',kind:'token',values:{value:SECRET}});
  const env={T:'deploy-key'},bound=s.resolveBindings(env),cmd={...s.checkCommand(['sh','pipe'],dir),pin};
  const r=s.request({bound,cmd,need:s.decide(bound,cmd),env});
  assert.equal(r.allowAlways,false);assert.equal(s.requestView(r).files.find(f=>f.role==='script').kind,'pipe','the card says it is a pipe');
  s.answer(r.id,'always');
  assert.equal(s.items[0].recipes.length,0,'nothing saved, so the next run asks again');
  fs.rmSync(dir,{recursive:true,force:true});
});
