// 1.123: Pocket Code installs its own release when the owner opted in (POCKET_SELF_UPDATE=1).
// The module's guards, then scripts/pocket-self-update.sh end to end against a real git origin with release tags,
// a stand-in PM2 and a stand-in Pocket that serves release.json and /api/health.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {SelfUpdate} from '../self-update.mjs';

const repo=path.resolve(import.meta.dirname,'..');
const tmp=t=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'self-update-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;};
const HEAD='a'.repeat(40);

test('1.123: self-update is off unless the owner opted in, and says why an opted-in install cannot use it',t=>{
  const d=tmp(t);
  const off=new SelfUpdate({checkout:d,dataDir:d,env:{pm_id:'3'},port:1});
  assert.deepEqual(off.snapshot(),{enabled:false,available:false,reason:null,job:null});
  assert.throws(()=>off.begin({from:'1.0.0',to:'1.1.0',head:HEAD}),/whoever manages this server/);
  const noPm2=new SelfUpdate({checkout:d,dataDir:d,env:{POCKET_SELF_UPDATE:'1'},port:1});
  assert.match(noPm2.snapshot().reason,/not running under PM2/);
  const noGit=new SelfUpdate({checkout:d,dataDir:d,env:{POCKET_SELF_UPDATE:'1',pm_id:'3'},port:1});
  assert.match(noGit.snapshot().reason,/not a git checkout/);
  fs.mkdirSync(path.join(d,'.git'));
  assert.deepEqual(noGit.snapshot(),{enabled:true,available:true,reason:null,job:null});
});

test('1.123: begin refuses work in progress, bad versions and running replies, and gives the script no secrets',t=>{
  const d=tmp(t);fs.mkdirSync(path.join(d,'.git'));
  const calls=[];const spawner=(bin,args,opts)=>{calls.push({bin,args,opts});return {on(){},unref(){}};};
  const env={POCKET_SELF_UPDATE:'1',pm_id:'7',PATH:'/usr/bin:/bin',HOME:d,POCKET_PASSWORD:'hunter2',POCKET_SECRET:'s',OPENROUTER_API_KEY:'k'};
  const su=new SelfUpdate({checkout:d,dataDir:d,env,port:3610,spawner,node:'/usr/bin/node',setsid:true});
  assert.throws(()=>su.begin({from:'1.0.0',to:'nope',head:HEAD}),/No newer/);
  assert.throws(()=>su.begin({from:'1.0.0',to:'1.1.0',head:'main'}),/installed checkout/);
  assert.throws(()=>su.begin({from:'1.0.0',to:'1.1.0',head:HEAD,busy:1}),/Replies are running/);
  assert.throws(()=>su.begin({from:'1.0.0',to:'1.1.0',head:HEAD,otherJob:true}),/CLI update/);
  assert.equal(calls.length,0);
  const s=su.begin({from:'1.0.0',to:'1.1.0',head:HEAD});
  assert.equal(s.job.phase,'queued');assert.equal(s.job.running,true);assert.equal(s.job.to,'1.1.0');
  assert.equal(calls.length,1);
  const [c]=calls;
  assert.equal(c.bin,'setsid');assert.deepEqual(c.args.slice(0,2),['-f','bash'],'not a child of the daemon PM2 restarts');
  assert.deepEqual(c.args.slice(3),[d,'1.1.0',HEAD,'7','3610',path.join(d,'pocket-self-update.json'),'/usr/bin/node','bbesner/pocket-code','1.0.0']);
  assert.equal(c.opts.detached,true,'the script must outlive the restart it causes');
  assert.deepEqual(Object.keys(c.opts.env).sort(),['HOME','LANG','PATH']);
  assert.throws(()=>su.begin({from:'1.0.0',to:'1.1.0',head:HEAD}),/already running/);
  assert.match(fs.readFileSync(path.join(d,'pocket-self-update.log'),'utf8'),/update 1\.0\.0 -> 1\.1\.0/);
});

test('1.123: HEAD is read from .git without running git: detached, a loose branch, a packed branch',t=>{
  const d=tmp(t),g=path.join(d,'.git');fs.mkdirSync(path.join(g,'refs','heads'),{recursive:true});
  const su=new SelfUpdate({checkout:d,dataDir:d,env:{},port:1});
  fs.writeFileSync(path.join(g,'HEAD'),HEAD+'\n');assert.equal(su.head(),HEAD);
  fs.writeFileSync(path.join(g,'HEAD'),'ref: refs/heads/main\n');assert.equal(su.head(),'');
  fs.writeFileSync(path.join(g,'packed-refs'),'# pack-refs with: peeled\n'+'c'.repeat(40)+' refs/heads/main\n');assert.equal(su.head(),'c'.repeat(40));
  fs.writeFileSync(path.join(g,'refs','heads','main'),'b'.repeat(40)+'\n');assert.equal(su.head(),'b'.repeat(40),'a loose ref wins over packed-refs');
  fs.writeFileSync(path.join(g,'HEAD'),'ref: refs/heads/../../x\n');assert.equal(su.head(),'');
  // and it agrees with git on a real checkout
  assert.equal(new SelfUpdate({checkout:repo,dataDir:d,env:{},port:1}).head()||'skip',fs.existsSync(path.join(repo,'.git'))&&fs.statSync(path.join(repo,'.git')).isDirectory()?execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim():'skip');
});

test('1.123: a job that went quiet for 20 minutes shows as interrupted, not running forever',t=>{
  const d=tmp(t);let now=1_000_000;
  const su=new SelfUpdate({checkout:d,dataDir:d,env:{POCKET_SELF_UPDATE:'1',pm_id:'1'},port:1,now:()=>now});
  fs.writeFileSync(path.join(d,'pocket-self-update.json'),JSON.stringify({id:'x',from:'1.0.0',to:'1.1.0',phase:'installing',startedAt:now,updatedAt:now}));
  assert.equal(su.job().running,true);
  now+=21*60*1000;
  assert.equal(su.job().running,false);assert.equal(su.job().phase,'interrupted');
});

test('1.124.3: a job still beating its lock file is running, however long its step is quiet, and a second press is refused',t=>{
  const d=tmp(t);fs.mkdirSync(path.join(d,'.git'));
  const calls=[];const su=new SelfUpdate({checkout:d,dataDir:d,env:{POCKET_SELF_UPDATE:'1',pm_id:'1',PATH:'/usr/bin:/bin',HOME:d},port:1,spawner:()=>{calls.push(1);return {on(){},unref(){}};}});
  const file=path.join(d,'pocket-self-update.json'),quiet=Date.now()-25*60*1000;
  fs.writeFileSync(file,JSON.stringify({id:'x',from:'1.0.0',to:'1.1.0',phase:'backing-up',startedAt:quiet,updatedAt:quiet}));
  fs.writeFileSync(file+'.lock','');
  assert.equal(su.job().running,true,'a 25-minute backup whose script still beats is not interrupted');assert.equal(su.job().phase,'backing-up');
  assert.throws(()=>su.begin({from:'1.0.0',to:'1.1.0',head:HEAD}),/already running/);assert.equal(calls.length,0);
  fs.utimesSync(file+'.lock',new Date(quiet),new Date(quiet));
  assert.equal(su.job().phase,'interrupted','a script that stopped beating 25 minutes ago died with its server');
});

// ---- the script, end to end ----
const sh=(cwd,...a)=>execFileSync('git',a,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const pkg=(v,extra={})=>JSON.stringify({name:'pocket-code',version:v,private:true,scripts:{'check:release':'true'},...extra},null,1);
const lock=v=>JSON.stringify({name:'pocket-code',version:v,lockfileVersion:3,requires:true,packages:{'':{name:'pocket-code',version:v}}},null,1);
function release(src,v,extra){
  fs.writeFileSync(path.join(src,'package.json'),pkg(v,extra));fs.writeFileSync(path.join(src,'package-lock.json'),lock(v));
  fs.writeFileSync(path.join(src,'public','release.json'),JSON.stringify({version:v}));
  sh(src,'add','-A');sh(src,'commit','-qm',v);sh(src,'tag','v'+v);
}
// A stand-in Pocket: serves release.json from the checkout (as the daemon does, from disk) and /api/health. A release
// whose package.json has "broken": true exits at start, like a daemon that cannot boot.
// 1.124.3: /api/health's busy is the number in pm2/busy (99: a reply that never ends); each answer counts one down, a reply finishing.
const SERVER=`import http from 'node:http';import fs from 'node:fs';const [dir,port]=process.argv.slice(2);
if(JSON.parse(fs.readFileSync(dir+'/package.json','utf8')).broken)process.exit(1);
http.createServer((q,r)=>{if(q.url==='/release.json'){r.end(fs.readFileSync(dir+'/public/release.json'));}else if(q.url==='/api/health'){const f=import.meta.dirname+'/busy';let n=0;try{n=Number(fs.readFileSync(f,'utf8'))||0;}catch{}if(n>0&&n<99)fs.writeFileSync(f,String(n-1));r.end(JSON.stringify({ok:true,busy:n}));}else{r.statusCode=404;r.end();}}).listen(Number(port),'127.0.0.1');`;
// A stand-in PM2 for one app (pm_id 0): jlist, pid (empty for an id, as PM2 does), restart (stop the old process, start a new one), save.
const PM2=`#!/usr/bin/env bash
st="$FAKE_PM2_STATE"
case "$1" in
  pid) echo '' ;; # like the real one: pm2 pid takes a name, and prints nothing for an id
  jlist) p=$(cat "$st/pid" 2>/dev/null); if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then echo "[{\\"pm_id\\":0,\\"name\\":\\"pocket-claude\\",\\"pid\\":$p}]"; else echo '[{"pm_id":0,"name":"pocket-claude","pid":0}]'; fi ;;
  restart) p=$(cat "$st/pid" 2>/dev/null); [ -n "$p" ] && kill "$p" 2>/dev/null; sleep 0.3
    setsid node "$st/server.mjs" "$FAKE_PM2_DIR" "$FAKE_PM2_PORT" >/dev/null 2>&1 < /dev/null & echo $! > "$st/pid"; echo "$1 $2" >> "$st/calls" ;;
  save) echo save >> "$st/calls" ;;
esac`;

async function setup(t,{port}){
  const d=tmp(t),origin=path.join(d,'origin.git'),src=path.join(d,'src'),dir=path.join(d,'checkout'),st=path.join(d,'pm2'),bin=path.join(d,'bin'),data=path.join(dir,'data');
  for(const x of [src,st,bin,path.join(src,'public')])fs.mkdirSync(x,{recursive:true});
  sh(d,'init','-q','--bare','-b','main',origin);
  sh(src,'init','-q','-b','main');sh(src,'config','user.email','t@test');sh(src,'config','user.name','t');
  fs.writeFileSync(path.join(src,'.gitignore'),'node_modules/\ndata/\nsecret.json\n');
  release(src,'1.0.0');release(src,'1.1.0');release(src,'1.2.0',{broken:true});
  sh(src,'remote','add','origin',origin);sh(src,'push','-q','origin','main','--tags');
  sh(d,'clone','-q',origin,dir);sh(dir,'reset','-q','--hard','v1.0.0');sh(dir,'tag','-d','v1.1.0','v1.2.0');
  // The checkout believes it comes from GitHub; git fetches from the local origin.
  sh(dir,'config','remote.origin.url','https://github.com/test/pocket.git');sh(dir,'config','url.'+origin+'.insteadOf','https://github.com/test/pocket.git');
  fs.mkdirSync(data);fs.writeFileSync(path.join(dir,'secret.json'),'{"private":true}');
  fs.writeFileSync(path.join(st,'server.mjs'),SERVER);fs.writeFileSync(path.join(bin,'pm2'),PM2,{mode:0o755});
  const env={...process.env,PATH:bin+':'+process.env.PATH,HOME:d,FAKE_PM2_STATE:st,FAKE_PM2_DIR:dir,FAKE_PM2_PORT:String(port),POCKET_SELF_UPDATE_TRIES:'8',POCKET_SELF_UPDATE_SETTLE:'1'};
  spawnSync('pm2',['restart','0'],{env});
  t.after(()=>{try{process.kill(Number(fs.readFileSync(path.join(st,'pid'),'utf8')),'SIGKILL');}catch{}});
  for(let i=0;i<50;i++){try{if((await(await fetch(`http://127.0.0.1:${port}/release.json`)).json()).version==='1.0.0')break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const status=path.join(data,'pocket-self-update.json');
  const run=(to,from,head=sh(dir,'rev-parse','HEAD'))=>{
    fs.writeFileSync(status,JSON.stringify({id:'t',from,to,phase:'queued'}));
    const r=spawnSync('bash',[path.join(repo,'scripts','pocket-self-update.sh'),dir,to,head,'0',String(port),status,process.execPath,'test/pocket',from],{env,encoding:'utf8',timeout:120000});
    return {...r,job:JSON.parse(fs.readFileSync(status,'utf8'))};
  };
  const served=async()=>(await(await fetch(`http://127.0.0.1:${port}/release.json`)).json()).version;
  return {d,dir,st,bin,env,run,served};
}
// A stand-in for a real tool (tar, npm) that misbehaves the way the body says and otherwise is the real one.
const which=tool=>execFileSync('sh',['-c','command -v '+tool],{encoding:'utf8'}).trim();
const wrap=(bin,tool,body)=>fs.writeFileSync(path.join(bin,tool),`#!/bin/sh\n${body}\nexec '${which(tool)}' "$@"\n`,{mode:0o755});
const freePort=()=>20000+Math.floor(Math.random()*20000);

test('1.123: the script installs a release, backs up private state, restarts and confirms the new version',{timeout:120000},async t=>{
  const {d,dir,st,run,served}=await setup(t,{port:freePort()});
  const before=sh(dir,'rev-parse','HEAD');
  const r=run('1.1.0','1.0.0');
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal(r.job.phase,'complete');assert.ok(r.job.finishedAt);
  assert.equal(sh(dir,'rev-parse','HEAD'),sh(dir,'rev-parse','v1.1.0^{commit}'));
  assert.equal(sh(dir,'branch','--show-current'),'main','stays on main');
  assert.equal(await served(),'1.1.0');
  assert.match(fs.readFileSync(path.join(st,'calls'),'utf8'),/restart 0[\s\S]*save/);
  assert.ok(r.job.backup.startsWith(path.join(d,'backups','pocket-code-1.1.0-update-')));
  assert.equal(fs.readFileSync(path.join(r.job.backup,'prev-head.txt'),'utf8').trim(),before);
  const files=execFileSync('tar',['-tzf',path.join(r.job.backup,'private-state.tar.gz')],{encoding:'utf8'});
  assert.match(files,/^secret\.json$/m,'ignored private files are in the backup');
  assert.doesNotMatch(files,/node_modules/);
});

test('1.123: a release that does not start is rolled back to the version that was running',{timeout:120000},async t=>{
  const {dir,run,served}=await setup(t,{port:freePort()});
  assert.equal(run('1.1.0','1.0.0').job.phase,'complete');
  const before=sh(dir,'rev-parse','HEAD');
  const r=run('1.2.0','1.1.0');
  assert.equal(r.status,1);
  assert.equal(r.job.phase,'failed');assert.match(r.job.error,/1\.2\.0 did not start, so Pocket went back to 1\.1\.0/);
  assert.equal(sh(dir,'rev-parse','HEAD'),before,'checkout back where it was');
  assert.equal(await served(),'1.1.0');
});

test('1.123: a hand-edited checkout, a moved HEAD or an unknown origin is refused before anything changes',{timeout:60000},async t=>{
  const {dir,st,run}=await setup(t,{port:freePort()});
  const head=sh(dir,'rev-parse','HEAD');
  const moved=run('1.1.0','1.0.0','b'.repeat(40));
  assert.equal(moved.job.phase,'failed');assert.match(moved.job.error,/changed since the update started/);
  fs.appendFileSync(path.join(dir,'package.json'),'\n');
  const dirty=run('1.1.0','1.0.0');
  assert.equal(dirty.job.phase,'failed');assert.match(dirty.job.error,/changed by hand/);
  sh(dir,'checkout','--','package.json');
  sh(dir,'config','remote.origin.url','https://github.com/someone/else.git');
  const other=run('1.1.0','1.0.0');
  assert.equal(other.job.phase,'failed');assert.match(other.job.error,/does not come from github\.com\/test\/pocket/);
  assert.equal(sh(dir,'rev-parse','HEAD'),head);
  assert.ok(!fs.existsSync(path.join(st,'calls'))||!/save/.test(fs.readFileSync(path.join(st,'calls'),'utf8')),'never restarted for good');
});

test('1.124.2: a backup tar gives up on (exit 2, a full disk) is removed and nothing is installed',{timeout:60000},async t=>{
  const {d,dir,bin,run}=await setup(t,{port:freePort()});
  const head=sh(dir,'rev-parse','HEAD');
  // GNU tar on a disk that fills: part of an archive written, "Cannot write", "Error is not recoverable", status 2.
  wrap(bin,'tar',`case " $* " in *" -czf "*) prev=''; for a in "$@"; do [ "$prev" = -czf ] && out=$a; prev=$a; done
  head -c 65536 /dev/urandom > "$out"; echo "tar: $out: Cannot write: No space left on device" >&2; echo 'tar: Error is not recoverable: exiting now' >&2; exit 2 ;; esac`);
  const r=run('1.1.0','1.0.0');
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.equal(r.job.phase,'failed');assert.match(r.job.error,/backup could not be written/);assert.match(r.job.error,/Nothing was changed/);
  assert.equal(r.job.backup,undefined,'no backup is recorded');
  assert.deepEqual(fs.existsSync(path.join(d,'backups'))?fs.readdirSync(path.join(d,'backups')):[],[],'the partial archive does not stay on the disk');
  assert.equal(sh(dir,'rev-parse','HEAD'),head,'the checkout did not move');
});

test('1.124.2: when npm ci fails and putting the old packages back fails too, the job says Pocket will not start again, not that it stays',{timeout:120000},async t=>{
  const {d,dir,bin,run}=await setup(t,{port:freePort()});
  const head=sh(dir,'rev-parse','HEAD');
  // npm ci removes node_modules before it installs; the first FAIL_CI runs then fail (the registry is unreachable, the disk full).
  const n=path.join(d,'npm-ci-runs');
  const failCi=k=>wrap(bin,'npm',`if [ "$1" = ci ]; then c=$(cat '${n}' 2>/dev/null || echo 0); echo $((c+1)) > '${n}'; if [ "$c" -lt ${k} ]; then rm -rf node_modules; echo 'npm error network request failed' >&2; exit 1; fi; fi`);
  failCi(2);
  const r=run('1.1.0','1.0.0');
  assert.equal(r.status,1,r.stdout+r.stderr);assert.equal(r.job.phase,'failed');
  assert.doesNotMatch(r.job.error,/stays on/);
  assert.match(r.job.error,/Installing v1\.1\.0's packages failed, and putting 1\.0\.0's packages back failed too/);
  assert.ok(r.job.error.includes(`npm ci in ${dir}`),r.job.error);assert.ok(r.job.error.includes(r.job.backup),'the backup is named');
  assert.equal(sh(dir,'rev-parse','HEAD'),head,'the checkout itself went back');
  // when putting them back works, the job still says Pocket stays where it was
  fs.writeFileSync(n,'0');failCi(1);
  const ok=run('1.1.0','1.0.0');
  assert.equal(ok.job.phase,'failed');assert.equal(ok.job.error,"Installing v1.1.0's packages failed. Pocket stays on 1.0.0.");
});

test('1.124.3: without flock (macOS has none) the job says flock is missing, not that another update is running',{timeout:60000},async t=>{
  const {d,dir,env,run}=await setup(t,{port:freePort()});
  const head=sh(dir,'rev-parse','HEAD');
  // Every program on PATH but flock, as on a Mac.
  const farm=path.join(d,'no-flock');fs.mkdirSync(farm);
  for(const p of process.env.PATH.split(':'))try{for(const f of fs.readdirSync(p))if(f!=='flock'&&!fs.existsSync(path.join(farm,f)))fs.symlinkSync(path.join(p,f),path.join(farm,f));}catch{}
  env.PATH=env.PATH.split(':')[0]+':'+farm;
  const r=run('1.1.0','1.0.0');
  assert.equal(r.status,1,r.stdout+r.stderr);assert.equal(r.job.phase,'failed');
  assert.doesNotMatch(r.job.error,/Another Pocket Code update is running/);
  assert.equal(r.job.error,"flock is not on Pocket's PATH, so it cannot update itself. Update it from the server.");
  assert.equal(sh(dir,'rev-parse','HEAD'),head);
});

test('1.124.3: the backup needs GNU tar: a BSD tar is refused before anything changes, and GNU tar as gtar is used',{timeout:120000},async t=>{
  const {d,dir,bin,run,served}=await setup(t,{port:freePort()});
  const head=sh(dir,'rev-parse','HEAD');
  // macOS's tar is bsdtar: it does not take GNU tar's --warning or --ignore-failed-read.
  wrap(bin,'tar',`case "$*" in *--version*) echo 'bsdtar 3.5.3 - libarchive 3.5.3 zlib/1.2.11'; exit 0 ;; *--warning=*|*--ignore-failed-read*) echo 'tar: Option --warning=no-file-changed is not supported' >&2; exit 1 ;; esac`);
  const r=run('1.1.0','1.0.0');
  assert.equal(r.status,1,r.stdout+r.stderr);assert.equal(r.job.phase,'failed');
  assert.match(r.job.error,/needs GNU tar/);assert.match(r.job.error,/brew install gnu-tar/);
  assert.equal(sh(dir,'rev-parse','HEAD'),head,'nothing changed');
  assert.deepEqual(fs.existsSync(path.join(d,'backups'))?fs.readdirSync(path.join(d,'backups')):[],[]);
  // Homebrew's GNU tar is gtar: with it on PATH the update goes through.
  fs.writeFileSync(path.join(bin,'gtar'),`#!/bin/sh\nexec '${which('tar')}' "$@"\n`,{mode:0o755});
  const ok=run('1.1.0','1.0.0');
  assert.equal(ok.job.phase,'complete',ok.stdout+ok.stderr);assert.equal(await served(),'1.1.0');
});

test('1.124.3: the script beats its lock file while a step is quiet, and stops when it ends',{timeout:120000},async t=>{
  const {d,dir,bin,env,run}=await setup(t,{port:freePort()});
  env.POCKET_SELF_UPDATE_BEAT='1';
  const lock=path.join(dir,'data','pocket-self-update.json.lock'),mark=path.join(d,'ci-started'),seen=path.join(d,'beat-seen');
  // A quiet npm ci of 2.5 seconds: the lock file must be newer at its end than at its start.
  wrap(bin,'npm',`if [ "$1" = ci ]; then touch '${mark}'; sleep 2.5; [ '${lock}' -nt '${mark}' ] && echo yes > '${seen}'; fi`);
  const r=run('1.1.0','1.0.0');
  assert.equal(r.job.phase,'complete',r.stdout+r.stderr);
  assert.equal(fs.existsSync(seen),true,'the heartbeat touched the lock file during npm ci');
  const after=fs.statSync(lock).mtimeMs;await new Promise(res=>setTimeout(res,2500));
  assert.equal(fs.statSync(lock).mtimeMs,after,'no heartbeat outlives the script');
});

test('1.124.3: a reply started during the update holds the restart until it ends; one that does not end leaves Pocket where it was',{timeout:120000},async t=>{
  const {dir,st,env,run,served}=await setup(t,{port:freePort()});
  const head=sh(dir,'rev-parse','HEAD'),restarts=()=>(fs.readFileSync(path.join(st,'calls'),'utf8').match(/restart/g)||[]).length,before=restarts();
  env.POCKET_SELF_UPDATE_IDLE_TRIES='3';
  fs.writeFileSync(path.join(st,'busy'),'99');
  const r=run('1.1.0','1.0.0');
  assert.equal(r.status,1,r.stdout+r.stderr);assert.equal(r.job.phase,'failed');
  assert.equal(r.job.error,'Replies kept running while Pocket waited to restart, so it did not restart and stays on 1.0.0. Update again when they finish.');
  assert.equal(restarts(),before,'Pocket was not restarted under the reply');
  assert.equal(sh(dir,'rev-parse','HEAD'),head,'the checkout went back');assert.equal(await served(),'1.0.0');
  // A reply that ends while the script waits: the restart follows it.
  fs.writeFileSync(path.join(st,'busy'),'2');
  const ok=run('1.1.0','1.0.0');
  assert.equal(ok.job.phase,'complete',ok.stdout+ok.stderr);assert.match(ok.stdout,/waiting for 2 replies to finish/);assert.equal(await served(),'1.1.0');
});

test('1.124.3: when the new version does not start and putting the old one back fails too, the job says so, not that Pocket went back',{timeout:120000},async t=>{
  const {d,dir,bin,run}=await setup(t,{port:freePort()});
  assert.equal(run('1.1.0','1.0.0').job.phase,'complete');
  // 1.2.0 installs but does not start; then the npm ci that puts 1.1.0's packages back fails (the registry is unreachable).
  const n=path.join(d,'npm-ci-runs');
  wrap(bin,'npm',`if [ "$1" = ci ]; then c=$(cat '${n}' 2>/dev/null || echo 0); echo $((c+1)) > '${n}'; if [ "$c" -ge 1 ]; then rm -rf node_modules; echo 'npm error network request failed' >&2; exit 1; fi; fi`);
  const r=run('1.2.0','1.1.0');
  assert.equal(r.status,1,r.stdout+r.stderr);assert.equal(r.job.phase,'failed');
  assert.doesNotMatch(r.job.error,/went back to/);
  assert.match(r.job.error,/^1\.2\.0 did not start, and putting 1\.1\.0 back failed too\. Pocket may not be running/);
  assert.ok(r.job.error.includes(`npm ci in ${dir}`),r.job.error);assert.ok(r.job.error.includes(r.job.backup),'the backup is named');
});
