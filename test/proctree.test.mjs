// proctree (1.47): the /proc reader and its ps fallback for macOS agree, and the ps parsing is right.
import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {descendantCpu,commandLine,parseCpuTime,parsePsTable,HAS_PROC} from '../proctree.mjs';

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
