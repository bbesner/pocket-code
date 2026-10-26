// proctree (1.47): the /proc reader and its ps fallback for macOS agree, and the ps parsing is right.
import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {descendantCpu,commandLine,parseCpuTime,parsePsTable,HAS_PROC,startTime,bootedAt} from '../proctree.mjs';
import {sameBoot} from '../codex.mjs';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';

test('ps TIME in every shape becomes hundredths of a second',()=>{
 assert.equal(parseCpuTime('0:00.05'),5);assert.equal(parseCpuTime('0:01.50'),150);assert.equal(parseCpuTime('12:34'),75400);
 assert.equal(parseCpuTime('1:02:03'),372300);assert.equal(parseCpuTime('00:00:00'),0);assert.equal(parseCpuTime('2-01:00:00'),17640000);
 assert.equal(parseCpuTime('garbage'),0);assert.equal(parseCpuTime(''),0);
});
test('a ps table becomes a parent map and CPU per pid; descendants are walked through grandchildren',()=>{
 const table='  PID  PPID TIME\n    1     0 0:03.10\n  100     1 0:00.00\n  200   100 0:00.50\n  300   200 1:00.00\n  400     1 0:00.01\n';
 const {kids,cpu}=parsePsTable(table);assert.deepEqual(kids.get(100),[200]);assert.equal(cpu.get(300),6000);
 const r=descendantCpu(100,{proc:false,run:()=>table});assert.deepEqual([...r.pids].sort(),[200,300]);assert.equal(r.cpu.get(200),50);
 assert.equal(descendantCpu(999,{proc:false,run:()=>table}).pids.size,0);
 assert.equal(descendantCpu(100,{proc:false,run:()=>{throw new Error('no ps');}}).pids.size,0,'a failing ps means no descendants, not a crash');
});
test('commandLine uses ps when there is no /proc and is empty for a dead process',()=>{
 const calls=[];const run=args=>{calls.push(args);return 'node server.mjs --session abc-123\n';};
 assert.equal(commandLine(4242,{proc:false,run}),'node server.mjs --session abc-123');assert.deepEqual(calls[0],['-o','command=','-p','4242']);
 assert.equal(commandLine(4242,{proc:false,run:()=>{throw new Error('exit 1');}}),'');
});
test('the real ps fallback sees the same live child tree and command line as /proc',{skip:!HAS_PROC&&'needs a Linux box to compare against /proc'},async()=>{
 const child=spawn('sh',['-c','sleep 20 & wait'],{stdio:'ignore'});await new Promise(r=>setTimeout(r,300));
 try{
  const viaProc=descendantCpu(process.pid),viaPs=descendantCpu(process.pid,{proc:false});
  assert.ok(viaProc.pids.has(child.pid),'proc sees the shell');assert.ok(viaPs.pids.has(child.pid),'ps sees the shell');
  const sleepers=[...viaProc.pids].filter(p=>p!==child.pid);assert.ok(sleepers.length>=1,'proc sees the sleep under the shell');
  for(const p of sleepers)assert.ok(viaPs.pids.has(p),'ps sees the same grandchild '+p);
  assert.match(commandLine(child.pid,{proc:false}),/sleep 20/);assert.match(commandLine(child.pid),/sleep 20/);
 }finally{try{process.kill(-child.pid,'SIGTERM');}catch{}child.kill('SIGTERM');await once(child,'exit').catch(()=>{});}
});

// 1.81 (#171): on macOS a Codex session record was always treated as an earlier boot's (no boot id, no /proc/stat), so a
// daemon restart dropped it and left its app-server holding the writer lock. The start time now comes from ps there.
test('without /proc the start time is ps lstart in UTC and the C locale; the boot time comes from sysctl kern.boottime',()=>{
 const calls=[];const run=(args,env)=>{calls.push([args,env]);return 'Mon Oct 26 14:03:22 2026\n';};
 assert.equal(startTime(4242,{proc:false,run}),'Mon Oct 26 14:03:22 2026');
 assert.deepEqual(calls[0],[['-o','lstart=','-p','4242'],{TZ:'UTC',LC_ALL:'C'}]);
 assert.equal(startTime(4242,{proc:false,run:()=>{throw new Error('exit 1');}}),null,'a gone process has no start time');
 assert.equal(startTime(4242,{proc:false,run:()=>'\n'}),null);assert.equal(startTime(0,{proc:false,run}),null);
 assert.equal(bootedAt({proc:false,sysctl:()=>'{ sec = 1761480000, usec = 123456 } Sun Oct 26 12:00:00 2026\n'}),1761480000000);
 assert.equal(bootedAt({proc:false,sysctl:()=>{throw new Error('no sysctl');}}),null);
});
test('the real ps start time is stable for a live process and differs from another one',{skip:process.platform==='win32'},async()=>{
 const a=spawn('sleep',['20'],{stdio:'ignore'});await new Promise(r=>setTimeout(r,1100));const b=spawn('sleep',['20'],{stdio:'ignore'});await new Promise(r=>setTimeout(r,200));
 try{
  const s=startTime(a.pid,{proc:false});assert.match(String(s),/\d{2}:\d{2}:\d{2} \d{4}$/);
  assert.equal(startTime(a.pid,{proc:false}),s,'stable');assert.notEqual(startTime(b.pid,{proc:false}),s,'a later process has a later start');
  if(HAS_PROC)assert.match(String(startTime(a.pid)),/^\d+$/,'Linux keeps the /proc clock ticks');
 }finally{a.kill();b.kill();await Promise.all([once(a,'exit'),once(b,'exit')]).catch(()=>{});}
 assert.equal(startTime(a.pid,{proc:false}),null,'an ended process has none');
});
test('sameBoot: Linux compares boot ids as before; without /proc a recorded start time decides, else the mtime against the boot time',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-boot-'));const file=path.join(dir,'k.session.json');fs.writeFileSync(file,'{}');
 try{
  const linux={proc:true,bootId:'b1',bootedAt:Date.now()-60000};
  assert.equal(sameBoot({bootId:'b1',pidStart:'5'},file,linux),true);assert.equal(sameBoot({bootId:'b0',pidStart:'5'},file,linux),false);
  assert.equal(sameBoot({pidStart:'5'},file,linux),true,'pre-1.73.7 record newer than the boot');
  assert.equal(sameBoot({},file,{...linux,bootedAt:Date.now()+60000}),false);
  const mac={proc:false,bootId:null,bootedAt:null};
  assert.equal(sameBoot({bootId:null,pidStart:'Mon Oct 26 14:03:22 2026'},file,mac),true,'macOS: the start time is the proof (sameProcess checks it)');
  assert.equal(sameBoot({bootId:null,pidStart:null},file,mac),false,'no start time and no boot time: nothing is proved');
  assert.equal(sameBoot({bootId:null,pidStart:null},file,{...mac,bootedAt:Date.now()-60000}),true,'no start time: the mtime against kern.boottime');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
