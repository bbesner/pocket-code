import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CliUpdates,localSlot,newer,version,cleanEnv,probe,runChild} from '../cli-updates.mjs';
function fixture(t,extra={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cli-updates-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const calls=[],activated=[],base=path.join(dir,'original');fs.writeFileSync(base,'original');
 const u=new CliUpdates({dir,bins:{claude:base,codex:base},zone:()=> 'America/New_York',now:()=>Date.parse('2026-10-28T08:00:00Z'),
  fetcher:async url=>({ok:true,text:async()=>JSON.stringify({name:decodeURIComponent(url.split('/').at(-2)),version:'2.0.0'})}),
  run:async(bin,args)=>{calls.push([bin,args]);if(args[0]==='--version')return '1.0.0';const dest=args[args.indexOf('--prefix')+1];fs.mkdirSync(path.join(dest,'node_modules','.bin'),{recursive:true});for(const key of ['claude','codex'])fs.writeFileSync(path.join(dest,'node_modules','.bin',key),'candidate');return '';},
  test:async()=> '2.0.0',onActivate:(...args)=>activated.push(args),...extra});
 return {u,dir,calls,activated,base};
}
test('4am follows Eastern DST and checks once per local date, including restart/catch-up',async t=>{
 assert.deepEqual(localSlot(Date.parse('2026-10-28T07:59:00Z'),'America/New_York'),{day:'2026-10-28',due:false});
 assert.equal(localSlot(Date.parse('2026-10-28T08:00:00Z'),'America/New_York').due,true);
 assert.equal(localSlot(Date.parse('2026-11-02T08:59:00Z'),'America/New_York').due,false);
 assert.equal(localSlot(Date.parse('2026-11-02T09:00:00Z'),'America/New_York').due,true);
 const {u,calls,dir,base}=fixture(t);await u.tick();assert.equal(calls.length,2);await u.tick();assert.equal(calls.length,2);
 const again=new CliUpdates({dir,bins:{claude:base,codex:base},zone:()=> 'America/New_York',now:u.now,run:()=>{throw Error('must not check twice');}});await again.tick();assert.equal(again.snapshot().checkedAt,u.now());
 assert.equal(calls.some(c=>c[1][0]==='install'),false,'scheduled checks never install');
});
test('only numeric regular releases; explicit matching versions, one running job',async t=>{
 assert.equal(version('1.2.3-alpha'),null);assert.equal(version('1.2.3;touch x'),null);assert.equal(newer('1.10.0','1.9.9'),true);assert.equal(newer('1.2.0','2.0.0'),false);
 let release;const waiting=new Promise(r=>release=r);const {u,activated}=fixture(t,{test:async()=>{await waiting;return '2.0.0';}});await u.check();
 assert.throws(()=>u.begin([{key:'claude',version:'9.0.0'}]),/no longer/);assert.throws(()=>u.begin([{key:'other',version:'2.0.0'}]),/no longer/);
 u.begin([{key:'claude',version:'2.0.0'}]);assert.throws(()=>u.begin([{key:'codex',version:'2.0.0'}]),/already running/);assert.equal(activated.length,0);
 release();await u.task;assert.equal(activated.length,1);assert.equal(u.snapshot().providers[0].installed,'2.0.0');assert.equal(u.snapshot().providers[0].previous,'1.0.0');
});
test('failed candidate and wrong version never change the live binary; successful activation survives restart',async t=>{
 const {u,base,dir,activated}=fixture(t,{test:async()=>{throw Error('protocol failure');}});await u.check();u.begin([{key:'claude',version:'2.0.0'}]);await u.task;
 assert.equal(u.binary('claude'),base);assert.equal(u.snapshot().job.phase,'failed');assert.equal(activated.length,0);
 u.test=async()=> '99.0.0';u.begin([{key:'claude',version:'2.0.0'}]);await u.task;assert.match(u.snapshot().job.error,/did not match/);assert.equal(u.binary('claude'),base);
 u.test=async()=> '2.0.0';u.begin([{key:'claude',version:'2.0.0'}]);await u.task;
 const restart=new CliUpdates({dir,bins:{claude:base,codex:base}});assert.equal(restart.binary('claude'),u.binary('claude'));assert.equal(restart.snapshot().job.phase,'complete');
});
test('partial two-provider upgrade reports completed version and retains failed provider',async t=>{
 const {u,base}=fixture(t,{test:async key=>{if(key==='codex')throw Error('bad codex');return '2.0.0';}});await u.check();u.begin([{key:'claude',version:'2.0.0'},{key:'codex',version:'2.0.0'}]);await u.task;
 assert.equal(u.snapshot().job.phase,'failed');assert.deepEqual(u.snapshot().job.results,[{key:'claude',version:'2.0.0'}]);assert.equal(u.binary('codex'),base);assert.notEqual(u.binary('claude'),base);
});
test('rollback is explicitly selected and tested, including original externally installed version',async t=>{
 const {u,base}=fixture(t);await u.check();u.begin([{key:'claude',version:'2.0.0'}]);await u.task;
 u.test=async()=> '1.0.0';u.begin([{key:'claude',version:'1.0.0'}],{rollback:true});await u.task;assert.equal(u.binary('claude'),base);assert.equal(u.snapshot().providers[0].previous,'2.0.0');
});
test('release check failure preserves previous discovery, exposes error; custom overrides cannot upgrade',async t=>{
 const {u}=fixture(t);await u.check();u.fetcher=async()=>{throw Error('offline');};await u.check();assert.equal(u.snapshot().providers[0].latest,'2.0.0');assert.match(u.snapshot().checkError,/failed/);
 u.overrides.claude=true;assert.throws(()=>u.begin([{key:'claude',version:'2.0.0'}]),/no longer/);
});
test('failed durable activation keeps previous binary, restart never retries interrupted work',async t=>{
 const {u,dir,base}=fixture(t);await u.check();const persist=u.persist;u.persist=(file,data)=>{if(data.job?.phase==='activated')throw Error('disk full');persist(file,data);};
 u.begin([{key:'claude',version:'2.0.0'}]);await u.task;assert.equal(u.binary('claude'),base);assert.equal(u.snapshot().job.phase,'failed');
 u.persist=persist;u.save({...u.state,job:{running:true,phase:'testing',results:[]}});
 const restart=new CliUpdates({dir,bins:{claude:base,codex:base}});assert.equal(restart.snapshot().job.phase,'interrupted');assert.equal(restart.binary('claude'),base);
});
test('installers and probes cannot inherit keys; command failure and timeout are bounded',async()=>{
 process.env.POCKET_TEST_SECRET='private';assert.equal(cleanEnv().POCKET_TEST_SECRET,undefined);delete process.env.POCKET_TEST_SECRET;
 await assert.rejects(runChild('/does-not-exist',[],{timeout:100}),/Could not start/);
 await assert.rejects(runChild(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:100}),/timed out/);
});
test('probe requires an actual protocol answer, not merely a zero exit',async t=>{
 const {dir}=fixture(t);const bin=path.join(dir,'fake');fs.writeFileSync(bin,'#!/usr/bin/env node\nif(process.argv.includes("--version"))console.log("2.0.0");\n',{mode:0o700});
 await assert.rejects(probe('claude',bin,{cwd:dir}),/exited before/);await assert.rejects(probe('codex',bin,{cwd:dir}),/exited before/);
});

test('installer worker exits if the daemon dies even before the worker identity is recorded',async t=>{
 const {spawn}=await import('node:child_process');const {once}=await import('node:events');
 const {dir}=fixture(t),marker=path.join(dir,'worker.json'),beats=path.join(dir,'beats');
 const moduleUrl=new URL('../cli-updates.mjs',import.meta.url).href;
 const source=`import fs from 'node:fs';import {runChild} from ${JSON.stringify(moduleUrl)};await runChild(process.execPath,['-e',${JSON.stringify(`require('fs').writeFileSync(${JSON.stringify(beats)},'started');setInterval(()=>require('fs').appendFileSync(${JSON.stringify(beats)},'.'),20);`)}],{onChild:c=>fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:c.pid})),timeout:10000});`;
 const parent=spawn(process.execPath,['--input-type=module','-e',source],{stdio:'ignore'});
 t.after(()=>{try{parent.kill('SIGKILL');}catch{}try{process.kill(-JSON.parse(fs.readFileSync(marker)).pid,'SIGKILL');}catch{}});
 for(let i=0;i<100&&!fs.existsSync(beats);i++)await new Promise(r=>setTimeout(r,20));assert.ok(fs.existsSync(beats),'command actually started');
 parent.kill('SIGKILL');await once(parent,'exit');await new Promise(r=>setTimeout(r,100));const before=fs.readFileSync(beats,'utf8');await new Promise(r=>setTimeout(r,150));assert.equal(fs.readFileSync(beats,'utf8'),before,'no surviving installer work after IPC owner dies');
});

test('only provider and version are persisted from an upgrade request; interrupted daily discovery catches up',async t=>{
 const {u,dir,base}=fixture(t);await u.check();u.begin([{key:'claude',version:'2.0.0',extra:'must-not-persist'}]);await u.task;
 assert.doesNotMatch(fs.readFileSync(u.file,'utf8'),/must-not-persist/);
 u.save({...u.state,day:'2026-10-27',pendingDay:'2026-10-28'});
 const again=new CliUpdates({dir,bins:{claude:base,codex:base},zone:u.zone,now:u.now,fetcher:u.fetcher,run:async()=> '2.0.0'});await again.tick();assert.equal(again.state.day,'2026-10-28');assert.equal(again.state.pendingDay,null);
});
