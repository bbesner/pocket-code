// 1.99 holds: one holder, close names refused, a line of waiters woken once, and nothing half written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CoordStore,LIMITS,SEEDS,checkName,closeName,coordinationInstructions,parseTtl} from '../coordination.mjs';

const A={kind:'conversation',session:'a'},B={kind:'conversation',session:'b'},C={kind:'conversation',session:'c'},T={kind:'terminal',session:null};
const min=60_000;
function store(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coord-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const clock={t:1_000_000},file=path.join(dir,'coordination.json');
  return {s:new CoordStore(file,{now:()=>clock.t}),clock,file,dir};
}
const code=c=>e=>e.code===c;

test('names and times are checked',()=>{
  assert.equal(checkName(' Shop-Staging '),'shop-staging');
  for(const bad of ['','-x','a b','a/b','x'.repeat(65),null])assert.throws(()=>checkName(bad),/letters, numbers/);
  assert.equal(parseTtl('45m'),45*min);assert.equal(parseTtl('2h'),120*min);assert.equal(parseTtl(30),30*min);assert.equal(parseTtl(undefined),60*min);
  for(const bad of ['9h','0','soon','-5m'])assert.throws(()=>parseTtl(bad));
});

test('close names catch two names for one thing, and leave different things alone',()=>{
  const known=[...SEEDS,'shop-staging','shop-production','site-deploy'];
  assert.equal(closeName('staging',known),'shop-staging');
  assert.equal(closeName('shop-stagin',known),'shop-staging');
  assert.equal(closeName('shop-production-2',known),'shop-production');
  assert.equal(closeName('site-deplo',known),'site-deploy');
  assert.equal(closeName('pocket-mian',SEEDS),'pocket-main');
  for(const name of ['shop-live','web-cloud','memstem','shop'])assert.equal(closeName(name,['pocket-main','site-deploy','shop-production2']),name==='shop'?'shop-production2':null);
});

test('one holder: a clash names them, the same conversation renews, and a reason is required',t=>{
  const {s,clock}=store(t);
  assert.throws(()=>s.hold('shop-staging',{holder:A}),/needs a reason/);
  s.hold('shop-staging',{reason:'Build 1.168',ttl:'45m',holder:A});
  assert.throws(()=>s.hold('shop-staging',{reason:'mine',holder:B}),e=>e.status===409&&e.code==='held'&&e.hold.holder.session==='a'&&e.hold.reason==='Build 1.168');
  clock.t+=10*min;
  const again=s.hold('shop-staging',{holder:A});
  assert.equal(again.renewed,true);assert.equal(again.hold.reason,'Build 1.168','renewing without a reason keeps the reason');
  assert.equal(again.hold.expiresAt,clock.t+60*min);assert.equal(s.state.holds.length,1);
  s.hold('pocket-main',{reason:'Terminal job',holder:T});
  assert.throws(()=>s.hold('pocket-main',{reason:'Again',holder:T}),code('held'),'an unverified session cannot prove it is the same one');
});

test('close-name refusal, and --new records the name for next time',t=>{
  const {s}=store(t);
  s.hold('shop-staging',{reason:'first use',holder:A});s.release('shop-staging',{by:A}); // learned, so it stays known
  assert.throws(()=>s.hold('staging',{reason:'x',holder:A}),e=>e.code==='close_name'&&e.status===409&&/Use shop-staging/.test(e.message));
  s.hold('staging',{reason:'x',isNew:true,holder:A});s.release('staging',{by:A});
  assert.ok(s.state.names.includes('staging'));
  s.hold('staging',{reason:'y',holder:B});
  s.hold('shop-live',{reason:'z',holder:B});
  assert.throws(()=>s.hold('shop-livee',{reason:'x',holder:A}),e=>e.code==='close_name','a live hold counts as a known name');
});

// Seeds (1.118): a new install knows only pocket-main and learns the rest as they are held. An existing install keeps
// every name its file holds, and a name that used to be a seed but is not in the file is held without --new and saved.
test('seeds: a new install knows only pocket-main and writes nothing until a change',t=>{
  const {s,file}=store(t);
  assert.deepEqual(SEEDS,['pocket-main']);assert.deepEqual(s.known(),['pocket-main']);assert.deepEqual(s.snapshot().seeds,['pocket-main']);
  assert.equal(fs.existsSync(file),false);
});

test('seeds: an existing file keeps its names, holds and recent, known and unchanged on disk until the next change',t=>{
  const {file,clock}=store(t);
  const saved={version:1,holds:[{name:'acme-deploy',reason:'Rollout',holder:A,heldAt:clock.t-min,ttlMs:60*min,expiresAt:clock.t+59*min}],waits:{},offers:{},
    recent:[{name:'acme-production',reason:'Release',holder:B,heldAt:clock.t-30*min,ttlMs:60*min,expiresAt:clock.t+30*min,event:'released',endedAt:clock.t-10*min}],
    names:['acme-staging','acme-production','acme-deploy'],notices:{}};
  const bytes=JSON.stringify(saved,null,1);fs.writeFileSync(file,bytes);
  const s=new CoordStore(file,{now:()=>clock.t});
  for(const n of ['acme-staging','acme-production','acme-deploy','pocket-main'])assert.ok(s.known().includes(n),n);
  assert.deepEqual(s.state.names,saved.names);assert.deepEqual(s.state.holds,saved.holds);assert.deepEqual(s.state.recent,saved.recent);
  const snap=s.snapshot();assert.deepEqual(snap.holds.map(h=>h.name),['acme-deploy']);assert.deepEqual(snap.recent.map(r=>r.name),['acme-production']);
  assert.throws(()=>s.hold('acme-stagin',{reason:'x',holder:C}),e=>e.code==='close_name'&&/Use acme-staging/.test(e.message),'a saved name still counts as known');
  assert.equal(fs.readFileSync(file,'utf8'),bytes,'loading, listing and a refused hold leave the file as it was');
  s.hold('acme-staging',{reason:'Build',holder:C});
  const after=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.deepEqual(after.names,saved.names,'holding a saved name adds nothing');assert.deepEqual(after.recent,saved.recent);
  assert.deepEqual(after.holds.map(h=>h.name),['acme-deploy','acme-staging']);
});

test('seeds: a name that used to be a seed and is not in the file is held without --new and then saved',t=>{
  const {s,file}=store(t);
  fs.writeFileSync(file,JSON.stringify({version:1,holds:[],waits:{},offers:{},recent:[],names:['other-thing'],notices:{}}));
  const old=new CoordStore(file,{now:s.now});
  assert.equal(old.known().includes('acme-staging'),false);
  assert.equal(old.hold('acme-staging',{reason:'Build',holder:A}).hold.name,'acme-staging');
  assert.deepEqual(old.state.names,['other-thing','acme-staging']);
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')).names,['other-thing','acme-staging']);
  assert.ok(new CoordStore(file).known().includes('acme-staging'),'known after a restart');
});

test('who may release: the holder, or anyone for a terminal hold; the owner always',t=>{
  const {s}=store(t);
  s.hold('shop-staging',{reason:'x',holder:A});
  assert.throws(()=>s.release('shop-staging',{by:T}),e=>e.status===403&&e.code==='not_holder');
  assert.throws(()=>s.release('shop-staging',{by:B}),code('not_holder'));
  assert.deepEqual(s.release('shop-staging',{by:A,note:'  Clean  '}).note,'Clean');
  assert.throws(()=>s.release('shop-staging',{by:A}),e=>e.code==='not_held'&&e.status===404);
  s.hold('site-deploy',{reason:'x',holder:T});s.release('site-deploy',{by:T});
  assert.deepEqual(s.state.recent.map(r=>r.event),['released','released']);assert.equal(s.state.recent[1].note,'Clean');
  s.hold('pocket-main',{reason:'x',holder:A});s.ownerRelease('pocket-main');
  assert.equal(s.state.recent[0].event,'owner');
  assert.throws(()=>s.ownerRelease('pocket-main'),code('not_held'));
});

test('waiting: free answers at once, the holder cannot wait, and a terminal must block',t=>{
  const {s}=store(t);
  assert.deepEqual(s.wait('shop-staging',{waiter:B}),{free:true,name:'shop-staging'});
  s.hold('shop-staging',{reason:'x',holder:A});
  assert.throws(()=>s.wait('shop-staging',{waiter:A}),code('own_hold'));
  assert.throws(()=>s.wait('shop-staging',{waiter:T}),code('needs_block'));
  const first=s.wait('shop-staging',{waiter:B,run:{approvalMode:'full'}});
  assert.equal(first.free,false);assert.equal(first.position,1);assert.equal(first.hold.reason,'x');
  assert.equal(s.wait('shop-staging',{waiter:B}).id,first.id,'asking again keeps one place');
  assert.equal(s.wait('shop-staging',{waiter:C}).position,2);
  assert.equal(s.snapshot().holds[0].waiters.length,2);assert.equal(s.snapshot().holds[0].waiters[0].run,undefined);
  assert.equal(s.cancelWait('shop-staging',{id:first.id}),true);assert.equal(s.cancelWait('shop-staging',{id:first.id}),false);
});

test('release wakes the first in line once, with what it captured; the next gets it only after the grace',t=>{
  const {s,clock}=store(t);
  s.hold('shop-staging',{reason:'x',holder:A});
  s.wait('shop-staging',{waiter:B,run:{approvalMode:'full',model:'m'}});s.wait('shop-staging',{waiter:C});
  const {next}=s.release('shop-staging',{by:A});
  assert.equal(next.session,'b');assert.deepEqual(next.run,{approvalMode:'full',model:'m'});
  assert.deepEqual(s.sweep(),[],'inside the grace nobody else is woken');
  clock.t+=LIMITS.offerMs;
  assert.deepEqual(s.sweep().map(w=>w.session),['c'],'b had its turn and is not woken twice');
  clock.t+=LIMITS.offerMs;
  assert.deepEqual(s.sweep(),[]);assert.deepEqual(s.state.offers,{});
});

test('claiming ends the offer, and the woken one leaves the line for good',t=>{
  const {s,clock}=store(t);
  s.hold('shop-staging',{reason:'x',holder:A});
  s.wait('shop-staging',{waiter:B});s.wait('shop-staging',{waiter:C});
  s.release('shop-staging',{by:A});
  s.hold('shop-staging',{reason:'y',holder:B});
  assert.deepEqual(s.state.offers,{});
  clock.t+=LIMITS.offerMs*2;
  assert.deepEqual(s.sweep({running:new Set(['b'])}),[],'still held, so nobody is woken');
  assert.deepEqual(s.state.waits['shop-staging'].map(w=>w.session),['c']);
});

test('one that cannot be told passes to the next',t=>{
  const {s}=store(t);
  s.hold('shop-staging',{reason:'x',holder:A});
  s.wait('shop-staging',{waiter:B});s.wait('shop-staging',{waiter:C});
  s.release('shop-staging',{by:A});
  assert.equal(s.wakeNext('shop-staging').session,'c');assert.equal(s.wakeNext('shop-staging'),null);
});

test('blocking: first in line finds it free, an unseen one is dropped, and an offer is respected',t=>{
  const {s,clock}=store(t);
  s.hold('shop-staging',{reason:'x',holder:A});
  const w=s.wait('shop-staging',{waiter:T,block:true});
  const behind=s.wait('shop-staging',{waiter:T,block:true});
  assert.equal(behind.position,2);
  assert.equal(s.release('shop-staging',{by:A}).next,null,'a shell is not woken, it asks');
  assert.equal(s.wait('shop-staging',{waiter:T,block:true,id:behind.id}).free,false,'second in line waits');
  assert.equal(s.wait('shop-staging',{waiter:T,block:true,id:w.id}).free,true);
  assert.equal(s.wait('shop-staging',{waiter:T,block:true,id:behind.id}).free,false,'the first has a while to claim it');
  clock.t+=LIMITS.offerMs;
  assert.equal(s.wait('shop-staging',{waiter:T,block:true,id:behind.id}).free,true,'the grace is over and nobody is ahead');
  const again=s.wait('pocket-main',{waiter:T,block:true});
  assert.equal(again.free,true);
  s.hold('pocket-main',{reason:'x',holder:A});
  s.wait('pocket-main',{waiter:T,block:true});s.wait('pocket-main',{waiter:B});
  clock.t+=LIMITS.blockStaleMs+1;
  assert.equal(s.release('pocket-main',{by:A}).next.session,'b','the shell stopped asking, so the conversation behind it is first');
});

test('sweep: a running conversation keeps its hold, an idle one expires and is told once',t=>{
  const {s,clock,file}=store(t);
  s.hold('shop-staging',{reason:'x',ttl:'10m',holder:A});s.hold('site-deploy',{reason:'y',ttl:'10m',holder:B});s.hold('pocket-main',{reason:'z',ttl:'10m',holder:T});
  s.wait('site-deploy',{waiter:C});
  clock.t+=30_000;
  const before=fs.statSync(file).mtimeMs;let writes=0;const write=s.write;s.write=(...a)=>{writes++;write(...a);};
  s.sweep({running:new Set(['a'])});
  assert.equal(writes,0,'a renewal under a minute is not worth a write');assert.ok(before);
  clock.t+=10*min;
  const woken=s.sweep({running:new Set(['a'])});
  assert.deepEqual(woken.map(w=>w.session),['c']);
  assert.deepEqual(s.state.holds.map(h=>h.name),['shop-staging']);
  assert.equal(s.state.holds[0].expiresAt,clock.t+10*min);
  assert.deepEqual(s.state.recent.map(r=>[r.name,r.event]).sort(),[['pocket-main','expired'],['site-deploy','expired']]);
  assert.match(s.takeNotices('b')[0],/hold on site-deploy expired/);
  assert.deepEqual(s.takeNotices('b'),[],'told once');
  s.ownerRelease('shop-staging');
  assert.match(new CoordStore(file).takeNotices('a')[0],/owner released your hold on shop-staging/,'survives a restart');
});

test('recent is capped by count and age',t=>{
  const {s,clock}=store(t);
  for(let i=0;i<LIMITS.recent+5;i++){s.hold('shop-staging',{reason:'r'+i,holder:A});s.release('shop-staging',{by:A});}
  assert.equal(s.state.recent.length,LIMITS.recent);assert.equal(s.state.recent[0].reason,'r'+(LIMITS.recent+4));
  clock.t+=LIMITS.recentMs+1;
  s.hold('shop-staging',{reason:'last',holder:A});s.release('shop-staging',{by:A});
  assert.deepEqual(s.state.recent.map(r=>r.reason),['last']);
});

test('a failed write changes nothing, and a restart keeps everything',t=>{
  const {s,file}=store(t);
  s.hold('shop-staging',{reason:'x',holder:A});s.wait('shop-staging',{waiter:B,run:{model:'m'}});
  const write=s.write;s.write=()=>{throw new Error('disk full');};
  assert.throws(()=>s.release('shop-staging',{by:A}),/disk full/);
  assert.equal(s.state.holds.length,1);assert.equal(s.state.waits['shop-staging'].length,1);
  s.write=write;
  const back=new CoordStore(file);
  assert.equal(back.state.holds[0].reason,'x');assert.equal(back.state.waits['shop-staging'][0].run.model,'m');
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  fs.writeFileSync(file,'not json');
  assert.deepEqual(new CoordStore(file).state.holds,[]);
});

test('the instructions name the command and the skill, quoted when the path has a space',()=>{
  const line=coordinationInstructions('/srv/my pocket/scripts/pocket-coord.mjs');
  assert.match(line,/node '\/srv\/my pocket\/scripts\/pocket-coord\.mjs' hold <name>/);
  assert.match(line,/\/srv\/my pocket\/skills\/pocket-coord\/SKILL\.md/);
  assert.match(line,/stops nothing/);
});
