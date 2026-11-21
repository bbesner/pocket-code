// 1.69 Inbox Watch: the store's rules (inbox.mjs), the /api/inbox routes (cookie and loopback token, push and email on add,
// the act → feedback → ack loop, the heartbeat) and scripts/pocket-inbox.mjs. Push is off here (no VAPID keys), so the routes
// report push=null; the file mail transport records each email.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {InboxStore,LIMITS,KINDS,PRIORITIES,STATES,ACTIONS,WATCH,checkWatch,inboxInstructions} from '../inbox.mjs';
import {syncSkills} from '../skills.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pocket-inbox-'));
const DAY=86400000,GMAIL='https://mail.google.com/mail/u/0/#all/19a2b3c4d5e6f708';
const freshInbox=()=>{let clock=Date.parse('2026-11-07T13:00:00Z');return {s:new InboxStore(path.join(tmp(),'inbox.json'),{now:()=>clock+=1000})};};

test('InboxStore: the contract, normalizing input, limits and the instructions line',()=>{
  assert.deepEqual(LIMITS,{entries:500,text:2000,digestText:12000,title:160,story:120,source:60,items:200,itemText:1200,ref:40,keepDays:60,dismissedDays:30});
  assert.deepEqual(KINDS,['alert','digest','lookahead']);assert.deepEqual(PRIORITIES,['critical','high','normal','low']);
  assert.deepEqual(STATES,['new','opened','dismissed','resolved','not_useful']);assert.deepEqual(ACTIONS,['open','unread','dismiss','resolve','not_useful','restore']);
  const dir=tmp(),file=path.join(dir,'inbox.json');const clock=Date.parse('2026-10-19T12:00:00Z');
  const s=new InboxStore(file,{now:()=>clock});
  const e=s.add({title:'  Elmstead needs   dispatch\nattention ',text:'Jordan is on the way [Robin](msg:19a2b3) says it was last night.',story:'Elmstead service-call story',url:'/#/start/0123456789ab',gmail:GMAIL});
  assert.match(e.id,/^[0-9a-f]{12}$/);assert.equal(e.title,'Elmstead needs dispatch attention');assert.equal(e.text,'Jordan is on the way [Robin](msg:19a2b3) says it was last night.','citations are kept as-is');
  assert.deepEqual([e.kind,e.priority,e.source,e.state,e.new,e.by,e.revision],['alert','normal','inbox-monitor','new',true,'cli',1],'defaults');
  assert.deepEqual([e.at,e.seenAt,e.actedAt,e.ackedAt,e.note,e.doc,e.dedupe],['2026-10-19T12:00:00Z',null,null,null,'','','']);
  assert.equal(s.add({title:'x',url:'https://pocket.example.test/#/inbox'}).url,'https://pocket.example.test/#/inbox','an absolute web address is a link too');
  const d=s.add({title:'Morning digest',kind:'digest',priority:'low',doc:'abcdef012345',source:'nightly job'},{actor:'ui'});
  assert.deepEqual([d.kind,d.priority,d.doc,d.source,d.by],['digest','low','abcdef012345','nightly job','ui']);
  assert.throws(()=>s.add({text:'no title'}),e=>e.status===400&&e.code==='no_title');
  assert.throws(()=>s.add({title:'x',kind:'memo'}),e=>e.code==='bad_kind'&&/alert, digest, lookahead/.test(e.message));
  assert.throws(()=>s.add({title:'x',priority:'urgent'}),e=>e.code==='bad_priority');
  assert.throws(()=>s.add({title:'x',url:'javascript:alert(1)'}),e=>e.code==='bad_url');assert.throws(()=>s.add({title:'x',url:'//evil.example/x'}),e=>e.code==='bad_url','a protocol-relative link is refused');
  assert.throws(()=>s.add({title:'x',gmail:'https://evil.example/mail.google.com/'}),e=>e.code==='bad_gmail');
  assert.throws(()=>s.add({title:'x',doc:'ABCDEF012345'}),e=>e.code==='bad_doc');assert.throws(()=>s.add({title:'x',doc:'../etc'}),e=>e.code==='bad_doc');
  const long=s.add({title:'t'.repeat(400),text:'x'.repeat(5000),story:'s'.repeat(400),source:'q'.repeat(400)});
  assert.deepEqual([long.title.length,long.text.length,long.story.length,long.source.length],[LIMITS.title,LIMITS.text,LIMITS.story,LIMITS.source]);
  assert.equal(fs.statSync(file).mode&0o777,0o600,'written 0600');
  const again=new InboxStore(file,{now:()=>clock});assert.equal(again.entries.length,4);assert.deepEqual(again.get(e.id),s.get(e.id),'persisted as written');
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')).version,1);
  // A hand-edited or older file comes back with every field.
  fs.writeFileSync(file,JSON.stringify({version:1,entries:[{id:'aaaaaaaaaaaa',title:'Old',at:'2026-10-18T10:00:00Z',kind:'memo',url:'javascript:x'},{id:'bbbbbbbbbbbb'},null],sources:{w:{lastReportAt:'nope'}}}));
  const old=new InboxStore(file,{now:()=>clock});assert.equal(old.entries.length,1);
  assert.deepEqual([old.entries[0].kind,old.entries[0].state,old.entries[0].url,old.entries[0].revision],['alert','new','',1]);assert.deepEqual(old.sources,{});
  const line=inboxInstructions('/srv/pocket/scripts/pocket-inbox.mjs','11111111-1111-4111-8111-111111111111');
  assert.match(line,/Inbox Watch/);assert.match(line,/node \/srv\/pocket\/scripts\/pocket-inbox\.mjs list/);assert.match(line,/act <id> resolve\|not_useful\|dismiss/);
  assert.match(line,/act only when the user asks/);assert.match(line,/\/srv\/pocket\/skills\/pocket-inbox\/SKILL\.md/);
  // The pocket-inbox skill is installed while Inbox Watch is on, named for this server's command, and removed when it is off.
  const roots=[path.join(dir,'claude')],commands={inbox:'/srv/pocket/scripts/pocket-inbox.mjs'};
  const r=syncSkills({settings:{inbox:true},commands,env:{},roots,codexRoots:[]});assert.ok(r.installed.includes(path.join(dir,'claude','pocket-inbox')));
  const skill=fs.readFileSync(path.join(dir,'claude','pocket-inbox','SKILL.md'),'utf8');
  assert.match(skill,/^---\nname: pocket-inbox\n/);assert.match(skill,/run `pocket-inbox` as `node \/srv\/pocket\/scripts\/pocket-inbox\.mjs`/);
  assert.match(skill,/\*\*Act only when the user asks\*\*/);assert.match(skill,/Settings → Projects, files, tasks & vault → Inbox Watch/);
  syncSkills({settings:{inbox:false},commands,env:{},roots,codexRoots:[]});assert.equal(fs.existsSync(path.join(dir,'claude','pocket-inbox')),false);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('InboxStore: an entry remembers whether it pushed and why (1.105)',()=>{
  const {s}=freshInbox();
  const quiet=s.add({title:'Bug report',text:'A tenant reports a bug.',push:false});
  const loud=s.add({title:'Dispatch',text:'The gate is open.',why:'  The gate has been open since 7:10 p.m.\n'});
  const old=s.normalize({id:'x',kind:'alert',title:'Old',text:'t',at:'2026-11-07T13:00:00Z'});
  assert.equal(quiet.pushed,false);assert.equal(quiet.why,'');
  assert.equal(loud.pushed,true);assert.equal(loud.why,'The gate has been open since 7:10 p.m.');
  assert.equal(old.pushed,true,'an entry from before 1.105 counts as pushed, as it was');assert.equal(old.why,'');
  assert.equal(s.add({title:'Long',text:'t',why:'y'.repeat(400)}).why.length,200);
});

test('InboxStore: dedupe within 24 hours, the state machine with restore, feedback and ack, filters, the heartbeat',()=>{
  const dir=tmp(),file=path.join(dir,'inbox.json');let clock=Date.parse('2026-10-19T08:00:00Z');
  const s=new InboxStore(file,{now:()=>clock});
  const a=s.add({title:'Elmstead alert',dedupe:'elmstead:t1',story:'Elmstead'});
  clock+=3600000;const dup=s.add({title:'Elmstead alert again',dedupe:'elmstead:t1'});
  assert.equal(dup.duplicate,true);assert.equal(dup.id,a.id);assert.equal(dup.title,'Elmstead alert','nothing changes');assert.equal(s.entries.length,1);
  clock+=DAY;const later=s.add({title:'Elmstead next day',dedupe:'elmstead:t1'});assert.notEqual(later.id,a.id,'after 24 hours the key is fresh');assert.equal(later.duplicate,undefined);
  clock+=1000;const b=s.add({title:'Birchwood look-ahead',kind:'lookahead'});clock+=1000;const c=s.add({title:'Vendor newsletter'});
  // open: new → opened, seenAt, no actedAt; a second open changes nothing.
  clock+=1000;let r=s.act({action:'open',id:a.id});
  assert.deepEqual([r.state,r.new,r.seenAt,r.actedAt,r.revision],['opened',false,'2026-10-20T09:00:03Z',null,2]);
  clock+=1000;assert.equal(s.act({action:'open',id:a.id}).revision,2,'open is idempotent');
  assert.deepEqual(s.feedback(),[],'opening is not feedback');
  // dismiss / resolve / not_useful record a decision; repeating it changes nothing.
  r=s.act({action:'dismiss',id:b.id},{actor:'ui'});assert.deepEqual([r.state,r.actedAt,r.ackedAt,r.revision,r.seenAt],['dismissed','2026-10-20T09:00:04Z',null,2,null]);
  assert.equal(s.act({action:'dismiss',id:b.id}).revision,2,'the same decision twice is one decision');
  clock+=1000;r=s.act({action:'not_useful',id:c.id,note:'n'.repeat(500)});assert.equal(r.state,'not_useful');assert.equal(r.note.length,300);
  clock+=1000;r=s.act({action:'resolve',id:a.id,note:'Jordan arrived'});assert.deepEqual([r.state,r.note,r.revision],['resolved','Jordan arrived',3]);
  assert.throws(()=>s.act({action:'explode',id:a.id}),e=>e.status===400&&e.code==='bad_action');assert.throws(()=>s.act({action:'open',id:'nope'}),e=>e.status===404);
  let fb=s.feedback();
  assert.deepEqual(fb.map(f=>[f.id,f.action]),[[a.id,'resolved'],[c.id,'not_useful'],[b.id,'dismissed']],'newest decision first');
  assert.deepEqual(fb[0],{id:a.id,action:'resolved',at:'2026-10-20T09:00:06Z',note:'Jordan arrived',title:'Elmstead alert',story:'Elmstead',source:'inbox-monitor',kind:'alert'});
  assert.deepEqual(s.feedback({since:'2026-10-20T09:00:05Z'}).map(f=>f.id),[a.id,c.id],'since filters by when it was decided');
  assert.throws(()=>s.feedback({since:'yesterday'}),e=>e.code==='bad_since');
  assert.equal(s.ack([a.id,c.id,'unknown',later.id]),2,'only pending decisions count');assert.equal(s.ack([a.id]),0,'once');
  assert.deepEqual(s.feedback().map(f=>f.id),[b.id]);assert.throws(()=>s.ack('x'),e=>e.code==='bad_ids');
  // restore: back to opened and reported as a restore, so a worker that resolved a story can un-resolve it.
  clock+=1000;r=s.act({action:'restore',id:a.id});
  assert.deepEqual([r.state,r.actedAt,r.ackedAt,r.lastAction,r.revision],['opened','2026-10-20T09:00:07Z',null,'restore',4]);
  assert.deepEqual(s.feedback()[0],{id:a.id,action:'restore',at:'2026-10-20T09:00:07Z',note:'Jordan arrived',title:'Elmstead alert',story:'Elmstead',source:'inbox-monitor',kind:'alert'});
  assert.equal(s.act({action:'restore',id:a.id}).revision,4,'restoring an open entry does nothing');assert.equal(s.act({action:'restore',id:later.id}).state,'new');
  s.ack([a.id]);assert.deepEqual(s.feedback().map(f=>f.id),[b.id]);
  clock+=1000;s.act({action:'resolve',id:a.id});assert.deepEqual(s.feedback().map(f=>[f.id,f.action])[0],[a.id,'resolved'],'a new decision after an ack is feedback again');
  // Filters: new = unread, all = everything but dismissed, dismissed alone; newest first; since by when it came in.
  let snap=s.snapshot();assert.deepEqual(snap.entries.map(e=>e.id),[later.id]);assert.equal(snap.newCount,1);assert.equal(snap.version,1);assert.equal(snap.now,clock);
  snap=s.snapshot({state:'all'});assert.deepEqual(snap.entries.map(e=>e.title),['Vendor newsletter','Elmstead next day','Elmstead alert']);
  assert.deepEqual(s.snapshot({state:'dismissed'}).entries.map(e=>e.id),[b.id]);
  assert.deepEqual(s.snapshot({state:'all',since:'2026-10-20T09:00:00Z'}).entries.map(e=>e.id),[c.id,later.id]);
  assert.throws(()=>s.snapshot({state:'everything'}),e=>e.status===400&&e.code==='bad_state');
  // The heartbeat: per source, never moves back, never ahead of now.
  assert.equal(snap.lastReportAt,null);
  s.seen('inbox-monitor');s.seen('inbox-monitor','2026-10-01T00:00:00Z');s.seen('',clock+DAY);
  snap=s.snapshot();assert.deepEqual(snap.sources,{'inbox-monitor':{lastReportAt:new Date(clock).toISOString().replace(/\.\d{3}Z$/,'Z')}});assert.equal(snap.lastReportAt,snap.sources['inbox-monitor'].lastReportAt);
  clock+=60000;s.seen('nightly');assert.equal(s.snapshot().lastReportAt,s.sources.nightly.lastReportAt,'the latest source wins');
  assert.throws(()=>s.seen('x','not a date'),e=>e.code==='bad_at');
  assert.deepEqual(new InboxStore(file,{now:()=>clock}).sources,s.sources,'persisted');
  fs.rmSync(dir,{recursive:true,force:true});
});

// 1.77: marking unread, and the conversations started from an entry's start link.
test('InboxStore: unread takes an open back, and a session started from a start link is remembered on its entries',()=>{
  const dir=tmp(),file=path.join(dir,'inbox.json');let clock=Date.parse('2026-10-22T16:00:00Z');
  const s=new InboxStore(file,{now:()=>clock});
  const a=s.add({title:'PHP2 advisory',url:'/#/start/0123456789ab'}),b=s.add({title:'Churches images',url:'https://pocket.example/#/start/0123456789ab'});
  const c=s.add({title:'Digest',doc:'4897fe3220c8'}),d=s.add({title:'Other link',url:'/#/start/0123456789ac'});
  // unread: opened → new, seenAt kept; idempotent; a finished entry stays finished.
  s.act({action:'open',id:c.id});clock+=1000;let r=s.act({action:'unread',id:c.id});
  assert.deepEqual([r.state,r.new,r.revision,Boolean(r.seenAt)],['new',true,3,true]);
  assert.equal(s.act({action:'unread',id:c.id}).revision,3,'unread twice is once');
  assert.equal(s.act({action:'unread',id:d.id}).revision,1,'an unread entry stays as it is');
  s.act({action:'resolve',id:d.id});assert.equal(s.act({action:'unread',id:d.id}).state,'resolved','restore it first');
  assert.deepEqual(s.feedback().map(f=>f.id),[d.id],'unread is not feedback');
  // linkStart: every entry whose link ends in that start id, path or full address; it is read once started from.
  clock+=1000;let linked=s.linkStart('0123456789ab','5f0c1f8e-2d3b-4c5a-9e7f-0a1b2c3d4e5f');
  assert.deepEqual(linked.map(e=>e.id).sort(),[a.id,b.id].sort());
  assert.deepEqual(linked.map(e=>e.state),['opened','opened']);
  assert.deepEqual(s.get(a.id).sessions,[{id:'5f0c1f8e-2d3b-4c5a-9e7f-0a1b2c3d4e5f',at:'2026-10-22T16:00:02Z'}]);
  assert.deepEqual(s.get(c.id).sessions,[],'an entry without that link is untouched');
  assert.deepEqual(s.linkStart('0123456789ab','5f0c1f8e-2d3b-4c5a-9e7f-0a1b2c3d4e5f'),[],'the same session twice is once');
  for(const [start,sess] of [['nope','5f0c1f8e-2d3b-4c5a-9e7f-0a1b2c3d4e5f'],['0123456789ab','../etc'],['0123456789ab',''],['ffffffffffff','5f0c1f8e-2d3b-4c5a-9e7f-0a1b2c3d4e5f']])assert.deepEqual(s.linkStart(start,sess),[]);
  // At most five, newest last; Codex ids keep their prefix; it survives a reload and a hand-edited file.
  for(let i=0;i<6;i++){clock+=1000;s.linkStart('0123456789ab','cx:019a2b3c-4d5e-6f70-8192-a3b4c5d6e7f'+i);}
  assert.equal(s.get(a.id).sessions.length,5);assert.equal(s.get(a.id).sessions.at(-1).id,'cx:019a2b3c-4d5e-6f70-8192-a3b4c5d6e7f5');
  const raw=JSON.parse(fs.readFileSync(file,'utf8'));raw.entries.find(e=>e.id===b.id).sessions=[{id:'bad id!',at:'2026-10-22T16:00:00Z'},{id:'5f0c1f8e-2d3b-4c5a-9e7f-0a1b2c3d4e5f'},'x',{id:'cx:abcdef12-0000',at:'2026-10-22T16:00:00Z'}];
  raw.entries.find(e=>e.id===c.id).sessions=undefined;fs.writeFileSync(file,JSON.stringify(raw));
  const back=new InboxStore(file,{now:()=>clock});
  assert.deepEqual(back.get(b.id).sessions,[{id:'cx:abcdef12-0000',at:'2026-10-22T16:00:00Z'}],'only well-formed links come back');
  assert.deepEqual(back.get(c.id).sessions,[],'an older file reads as none');assert.equal(back.get(a.id).sessions.length,5);
  fs.rmSync(dir,{recursive:true,force:true});
});

// 1.70: the owner's Inbox Watch settings and the watcher's profile, kept per source.
const PROFILE={version:1,timezone:'America/New_York',defaults:{paused:false,every:5,periods:[],quietHours:[22,8],digestHour:8,lookahead:{morning:8,evening:17},models:{decisions:{model:'sonnet',reasoning:'medium'},lookahead:{model:'opus',reasoning:'medium'}}},
  options:{every:[0,5,10,15,30],models:[{id:'sonnet',label:'Sonnet 5.5'},{id:'opus',label:'Opus 5.5'}],reasoning:[{id:'default',label:'Model default'},{id:'medium',label:'Medium'}]},
  applied:{from:'config',revision:null},status:{paused:false,every:5,period:'',lastCheckAt:'2026-10-20T12:00:00+00:00',nextCheckAt:'2026-10-20T12:05:00+00:00'},
  usage:{billing:'plan',costBasis:'list',since:'2026-10-20T11:00:00+00:00',days:[{date:'2026-10-20',checks:30,threads:40,calls:12,failed:0,inputTokens:500000,cacheWriteTokens:0,cacheReadTokens:0,outputTokens:9000,costUsd:1.25,decisions:{calls:12,costUsd:1.25},lookahead:{calls:0,costUsd:null}}]}};
test('InboxStore: Inbox Watch settings, the watcher\'s profile, revisions and paused',()=>{
  assert.equal(checkWatch(null),null);
  const ok=checkWatch({paused:false,every:10,periods:[{name:' Overnight ',days:[6,0,0],from:'22:00',to:'07:00',every:30}],quietHours:[22,8],digestHour:8,lookahead:{morning:8,evening:null},models:{decisions:{model:'sonnet',reasoning:'low'}}});
  assert.deepEqual(ok.periods,[{name:'Overnight',days:[0,6],from:'22:00',to:'07:00',every:30}],'days deduplicated and sorted');
  assert.deepEqual(checkWatch({firstPass:{enabled:true,provider:'both',threshold:0.876}}).firstPass,{enabled:true,provider:'both',threshold:0.88});
  assert.deepEqual(checkWatch({tidy:{enabled:true,every:4}}).tidy,{enabled:true,every:4});
  assert.deepEqual(checkWatch({gmailLabel:{enabled:false}}).gmailLabel,{enabled:false},'1.75: the Pocket Inbox label in Gmail');
  assert.deepEqual(checkWatch({push:{mode:'urgent',kinds:['money','emergency'],perDay:5,repeat:'worse'}}).push,{mode:'urgent',kinds:['emergency','money'],perDay:5,repeat:'worse'},'1.105: which alerts push; kinds kept in the watcher\'s order');
  assert.deepEqual(checkWatch({push:{mode:'none'}}).push,{mode:'none'});
  for(const [bad,re] of [[{push:{mode:'loud'}},/push.mode is one of urgent, all, none/],[{push:{kinds:['panic']}},/push.kinds is a list of/],[{push:{perDay:4}},/push.perDay is one of/],[{push:{repeat:'never'}},/push.repeat is worse or every/],[{push:true},/push is \{mode/]])
    assert.throws(()=>checkWatch(bad),e=>e.status===400&&re.test(e.message),JSON.stringify(bad));
  assert.deepEqual(checkWatch({scope:{mode:'inbox_labels',labels:[' Clients ','Clients','Team/Ask first','']}}).scope,{mode:'inbox_labels',labels:['Clients','Team/Ask first']},'1.100: what the watcher reads; labels trimmed and deduplicated');
  assert.deepEqual(checkWatch({scope:{mode:'inbox'}}).scope,{mode:'inbox',labels:[]});assert.deepEqual(checkWatch({scope:{}}).scope,{mode:'all',labels:[]});
  assert.equal(checkWatch({rules:'- Never tell me about cameras.\r\n- Tell me about every sale.'}).rules,'- Never tell me about cameras.\n- Tell me about every sale.');assert.equal(ok.lookahead.evening,null);
  for(const [bad,re] of [[{every:-1},/every is whole minutes/],[{every:500},/to 240/],[{periods:[{days:[],from:'01:00',to:'02:00',every:5}]},/Period 1 needs at least one day/],
    [{periods:[{days:[1],from:'1am',to:'02:00',every:5}]},/start and an end time/],[{periods:Array(WATCH.periods+1).fill({days:[1],from:'01:00',to:'02:00',every:5})},/at most 12/],
    [{quietHours:[22]},/quietHours/],[{digestHour:24},/digestHour/],[{lookahead:{morning:'8'}},/morning look-ahead/],[{models:{decisions:{model:'sonnet',reasoning:'huge'}}},/Reasoning is one of/],
    [{paused:'yes'},/paused is true or false/],[{scope:{mode:'archive'}},/scope.mode is one of all, inbox, inbox_labels/],[{scope:{mode:'inbox_labels',labels:'Clients'}},/scope.labels is a list/],[{scope:{mode:'inbox_labels',labels:Array.from({length:21},(_,i)=>'L'+i)}},/at most 20 labels/],[{scope:'inbox'},/scope is \{mode, labels\}/],[{firstPass:{provider:'grok'}},/first pass is one of jev, openai, both/],[{firstPass:{threshold:0.3}},/between 0.5 and 0.99/],[{firstPass:{enabled:1}},/firstPass.enabled/],[{tidy:{every:3}},/Tidy runs every 1, 2, 4, 8, 12, 24 hours/],[{rules:5},/rules is text/],[{rules:'x'.repeat(12001)},/over 12,000 characters/],[{tidy:{enabled:'on'}},/tidy.enabled/],[{gmailLabel:{enabled:'yes'}},/gmailLabel is/],[{gmailLabel:true},/gmailLabel is/],['x',/settings must be an object/]])
    assert.throws(()=>checkWatch(bad),e=>e.status===400&&e.code==='bad_watch'&&re.test(e.message),JSON.stringify(bad));
  assert.throws(()=>checkWatch({models:{decisions:{model:'gpt-9'}}},PROFILE),/Choose one of the models/,'only what the watcher offers');
  const dir=tmp(),file=path.join(dir,'inbox.json');let clock=Date.parse('2026-10-20T12:00:00Z');
  const s=new InboxStore(file,{now:()=>clock});
  assert.deepEqual(s.watchView(),{source:'inbox-monitor',settings:null,revision:0,updatedAt:null,by:null,profile:null,profileAt:null,lastReportAt:null,checkRequestedAt:null});
  s.seen('inbox-monitor',undefined,PROFILE);assert.deepEqual(s.watchView().profile,PROFILE);assert.equal(s.paused(),false);
  assert.deepEqual(s.snapshot().sources,{'inbox-monitor':{lastReportAt:'2026-10-20T12:00:00Z'}},'the list stays lean: no profile in it');
  assert.throws(()=>s.seen('inbox-monitor',undefined,{big:'x'.repeat(WATCH.profileBytes)}),e=>e.code==='bad_profile');
  let v=s.setWatch('inbox-monitor',{every:15,paused:true});assert.deepEqual([v.revision,v.by,v.settings],[1,'ui',{every:15,paused:true}]);assert.equal(s.paused(),true,'paused as the owner set it');
  assert.equal(s.snapshot().paused,true);
  v=s.setWatch('inbox-monitor',{models:{decisions:{model:'opus',reasoning:'default'}}},{actor:'cli'});assert.deepEqual([v.revision,v.by],[2,'cli']);
  assert.throws(()=>s.setWatch('inbox-monitor',{models:{decisions:{model:'haiku'}}}),/Choose one of the models/);
  clock+=60000;s.seen('other-watcher',undefined,{...PROFILE,status:{paused:true}});assert.equal(s.watchSource(),'other-watcher','the latest profile is the one Settings shows');
  v=s.setWatch('inbox-monitor',null);assert.deepEqual([v.revision,v.settings],[3,null],'null goes back to the config file');
  // 1.75: Check now. One request until the watcher reports it done (or ten minutes pass); then a press is a new one.
  v=s.requestCheck('inbox-monitor');const first=v.checkRequestedAt;assert.equal(first,'2026-10-20T12:01:00Z');
  clock+=5000;assert.equal(s.requestCheck('inbox-monitor').checkRequestedAt,first,'a second press while it is on its way changes nothing');
  s.seen('inbox-monitor',undefined,{...PROFILE,status:{checkRequestDone:first}});
  assert.equal(s.requestCheck('inbox-monitor').checkRequestedAt,'2026-10-20T12:01:05Z','done: a new request');
  clock+=11*60000;assert.equal(s.requestCheck('inbox-monitor').checkRequestedAt,'2026-10-20T12:12:05Z','never taken up in ten minutes: a new request');
  assert.equal(s.watchView('inbox-monitor').checkRequestedAt,'2026-10-20T12:12:05Z');
  const again=new InboxStore(file,{now:()=>clock});assert.deepEqual(again.watchView('inbox-monitor'),s.watchView('inbox-monitor'),'persisted');assert.deepEqual(again.watchView('other-watcher').profile.status,{paused:true});
  fs.rmSync(dir,{recursive:true,force:true});
});

test('InboxStore: a look-ahead has cards too, in its own order, one status with the digest and the alert (owner request)',()=>{
  const {s}=freshInbox();const GM='https://mail.google.com/mail/u/0/#all/18f0aa01b2c3d4e5';
  const card=(ref,story,extra={})=>({ref,section:'ahead',title:'Item '+ref,text:'Bullet '+ref,story,...extra});
  const item=(id,ref)=>s.get(id).items.find(i=>i.ref===ref);
  // Its text is not cut at an alert's 2,000.
  assert.equal(s.add({kind:'lookahead',title:'Long',text:'x'.repeat(3000)}).text.length,3000);
  // A story on the list links to its entry, and the card keeps its place: a look-ahead is most pressing first.
  const alert=s.add({kind:'alert',title:'Pool pump',story:'pool-pump'});
  const la=s.add({kind:'lookahead',title:'Look-ahead',text:'Three things:\n- a\n- b\n- c',items:[card('c1.1','pool-pump'),card('c1.2','roof-leak',{gmail:GM,priority:'high'}),card('c1.3','')]});
  assert.deepEqual(s.get(la.id).items.map(i=>[i.ref,i.section]),[['c1.1','listed'],['c1.2','ahead'],['c1.3','ahead']]);assert.equal(item(la.id,'c1.1').url,'/#/inbox/'+alert.id);
  assert.throws(()=>s.act({action:'resolve',id:la.id,item:'c1.1'}),e=>e.code==='item_history','decided on its own entry');
  // A decision is feedback with what the watcher needs to alert: it has no alert row behind it.
  s.act({action:'alert',id:la.id,item:'c1.2'});
  assert.deepEqual(s.feedback().map(f=>[f.id,f.kind,f.action,f.text,f.gmail,f.priority]),[[la.id+'/c1.2','digest-item','alert','Bullet c1.2',GM,'high']]);s.ack([la.id+'/c1.2']);
  // An item on no story is decided alone.
  s.act({action:'dismiss',id:la.id,item:'c1.3'});assert.equal(item(la.id,'c1.3').state,'dismissed');assert.equal(item(la.id,'c1.2').state,'alerted');
  // One story, one status across a digest and a look-ahead, and an alert that arrives later keeps the look-ahead's order.
  const d=s.add({kind:'digest',title:'Digest',text:'x',items:[{ref:'a1',section:'worth',title:'Fence',text:'t',story:'fence'}]});
  const la2=s.add({kind:'lookahead',title:'Look-ahead 2',text:'- a\n- b',items:[card('c2.1','fence'),card('c2.2','gate')]});
  s.act({action:'resolve',id:la2.id,item:'c2.1'});assert.equal(item(d.id,'a1').state,'resolved','what is pressed on one shows on the other');
  s.add({kind:'alert',title:'Gate',story:'gate'});assert.deepEqual(s.get(la2.id).items.map(i=>i.ref),['c2.1','c2.2']);assert.equal(item(la2.id,'c2.2').section,'listed');
});

test('InboxStore: one status per item, between a digest card and its alert (owner request)',()=>{
  const {s}=freshInbox();const GM='https://mail.google.com/mail/u/0/#all/18f0aa01b2c3d4e5',START='/#/start/0123456789ab';
  const digest=(day,items)=>s.add({kind:'digest',title:'Digest '+day,text:'x',dedupe:'digest|'+day,items});
  const line=(ref,story,extra={})=>({ref,section:'worth',title:'Line '+ref,text:'t',story,...extra});
  const item=(id,ref)=>s.get(id).items.find(i=>i.ref===ref);
  // An alert that arrives after the digest takes over the open card, and the card keeps the conversation it started.
  const d=digest('mon',[line('a1','pool-pump',{url:START}),line('a2','roof-leak'),line('a3','fence',{gmail:GM}),line('a4','gate')]);
  assert.equal(s.linkStart('0123456789ab','sess-abc-123').length,1,'a start from a card is remembered');
  assert.deepEqual(item(d.id,'a1').sessions.map(x=>x.id),['sess-abc-123']);assert.equal(s.get(d.id).state,'opened','starting from a card reads the digest');
  const before=s.get(d.id).revision,alert=s.add({kind:'alert',title:'Pool pump',story:'pool-pump'});
  assert.deepEqual([item(d.id,'a1').section,item(d.id,'a1').url],['listed','/#/inbox/'+alert.id]);assert.equal(s.get(d.id).items.at(-1).ref,'a1','listed lines go last');
  assert.ok(s.get(d.id).revision>before);assert.deepEqual(s.get(alert.id).sessions.map(x=>x.id),['sess-abc-123'],'the conversation moves to the alert');
  assert.equal(digest('mon',[line('a9','roof-leak')]).duplicate,true);
  const dup=s.add({kind:'alert',title:'again',story:'roof-leak',dedupe:'k1'}),dup2=s.add({kind:'alert',title:'again',story:'gate',dedupe:'k1'});
  assert.equal(dup2.id,dup.id);assert.equal(item(d.id,'a4').section,'worth','a duplicate alert changes nothing');assert.equal(item(d.id,'a2').section,'listed');
  // A decision on the alert shows on its line at once; the watcher hears it once, from the alert. Restore brings both back.
  s.act({action:'resolve',id:alert.id});
  assert.equal(item(d.id,'a1').state,'resolved');assert.deepEqual(s.feedback().map(f=>f.id),[alert.id],'never a second feedback from the line');
  s.ack([alert.id]);s.act({action:'restore',id:alert.id});assert.deepEqual([item(d.id,'a1').state,item(d.id,'a1').section],['open','listed']);assert.deepEqual(s.feedback().map(f=>f.id),[alert.id]);s.ack([alert.id]);
  s.act({action:'dismiss',id:alert.id});assert.equal(item(d.id,'a1').state,'dismissed');s.ack([alert.id]);
  // A line that links to an alert takes no decision of its own, Undo included.
  assert.throws(()=>s.act({action:'restore',id:d.id,item:'a1'}),e=>e.code==='item_history');
  // A card decided before the alert stays decided: the alert is news since then.
  s.act({action:'not_useful',id:d.id,item:'a3'});s.ack([d.id+'/a3']);s.add({kind:'alert',title:'Fence',gmail:GM});assert.deepEqual([item(d.id,'a3').section,item(d.id,'a3').state],['worth','not_useful']);
  // Add to Inbox: the card waits, and the alert it asked for takes it over.
  s.act({action:'alert',id:d.id,item:'a4'});assert.equal(item(d.id,'a4').state,'alerted');
  const asked=s.add({kind:'alert',title:'Gate',story:'gate'});assert.deepEqual([item(d.id,'a4').section,item(d.id,'a4').url],['listed','/#/inbox/'+asked.id]);
  assert.deepEqual(s.feedback().map(f=>[f.id,f.action]),[[d.id+'/a4','alert']],'the request is still the watcher to ack');
  // An alert closed before the digest, then restored: the card that came meanwhile folds into it.
  const old=s.add({kind:'alert',title:'Old',story:'old'});s.act({action:'resolve',id:old.id});s.ack([old.id]);
  const d2=digest('tue',[line('b1','old')]);assert.equal(item(d2.id,'b1').section,'worth');
  s.act({action:'restore',id:old.id});assert.deepEqual([item(d2.id,'b1').section,item(d2.id,'b1').url],['listed','/#/inbox/'+old.id]);
});
test('InboxStore: the same story on two digests is one decision, and Dismiss on a card',()=>{
  const {s}=freshInbox();
  const mk=(day,ref)=>s.add({kind:'digest',title:day,text:'x',dedupe:day,items:[{ref,section:'worth',title:'Lift',story:'lift'},{ref:ref+'x',section:'tidied',title:'Lift gone',story:'lift'}]});
  const m=mk('mon','a1'),t=mk('tue','a2');const st=(id,ref)=>s.get(id).items.find(i=>i.ref===ref).state;
  s.act({action:'resolve',id:t.id,item:'a2'});
  assert.equal(st(m.id,'a1'),'resolved','the other morning follows');assert.equal(st(m.id,'a1x'),'open','a history line is left alone');
  assert.deepEqual(s.feedback().map(f=>f.id),[t.id+'/a2'],'the watcher hears it once');s.ack([t.id+'/a2']);
  s.act({action:'restore',id:t.id,item:'a2'});assert.equal(st(m.id,'a1'),'open');s.ack([t.id+'/a2']);
  s.act({action:'dismiss',id:m.id,item:'a1'});assert.deepEqual([st(m.id,'a1'),st(t.id,'a2')],['dismissed','dismissed']);
  assert.deepEqual(s.feedback().map(f=>[f.id,f.action]),[[m.id+'/a1','dismissed']]);
  // A card's conversation shows on the same story's other card too; the store keeps it across a reload.
  const d=s.add({kind:'digest',title:'wed',text:'x',dedupe:'wed',items:[{ref:'c1',section:'worth',title:'Lift',story:'lift',url:'/#/start/aaaaaaaaaaaa'}]});
  s.linkStart('aaaaaaaaaaaa','sess-xyz-789');assert.deepEqual(s.get(m.id).items[0].sessions.map(x=>x.id),['sess-xyz-789']);
  assert.equal(s.linkStart('aaaaaaaaaaaa','sess-xyz-789').length,0,'recorded once');
  const s2=new InboxStore(s.file,{now:s.now});assert.deepEqual(s2.get(d.id).items[0].sessions.map(x=>x.id),['sess-xyz-789']);
});
test('checkWatch: the morning digest can be off',()=>{
  assert.deepEqual(checkWatch({digestHour:null}),{digestHour:null});assert.deepEqual(checkWatch({digestHour:6}),{digestHour:6});
  assert.throws(()=>checkWatch({digestHour:24}),/digestHour/);assert.throws(()=>checkWatch({digestHour:'off'}),/digestHour/);
});
test('InboxStore: pruning after 60 days (dismissed after 30) and the 500-entry cap drop the oldest seen entries first',()=>{
  const dir=tmp(),file=path.join(dir,'inbox.json');let clock=Date.parse('2026-08-01T12:00:00Z');
  const s=new InboxStore(file,{now:()=>clock});
  const old=s.add({title:'Old new'}),seen=s.add({title:'Old opened'});s.act({action:'open',id:seen.id});
  clock=Date.parse('2026-09-01T12:00:00Z');const dis=s.add({title:'Dismissed early'});s.act({action:'dismiss',id:dis.id});
  const dis2=s.add({title:'Dismissed later'});
  clock=Date.parse('2026-09-20T12:00:00Z');s.act({action:'dismiss',id:dis2.id});
  clock=Date.parse('2026-10-01T13:00:00Z');assert.equal(s.prune(),3,'over 60 days old, and dismissed over 30 days ago');
  assert.deepEqual(s.entries.map(e=>e.title),['Dismissed later']);void old;
  clock=Date.parse('2026-10-21T13:00:00Z');s.snapshot();assert.equal(s.entries.length,0,'the snapshot prunes too');
  // The cap: 500 entries; one more drops the oldest seen entry, never an unread one while a seen one is left.
  const seed=[];const t0=Date.parse('2026-10-10T00:00:00Z');
  for(let i=0;i<LIMITS.entries;i++)seed.push({id:i.toString(16).padStart(12,'0'),kind:'alert',priority:'normal',title:'E'+i,text:'',story:'',source:'inbox-monitor',url:'',gmail:'',doc:'',dedupe:'',state:i%2?'opened':'new',at:new Date(t0+i*60000).toISOString(),seenAt:null,actedAt:null,ackedAt:null,note:'',by:'cli',revision:1});
  fs.writeFileSync(file,JSON.stringify({version:1,entries:seed,sources:{}}));
  clock=Date.parse('2026-10-19T00:00:00Z');const big=new InboxStore(file,{now:()=>clock});
  big.add({title:'One more'});assert.equal(big.entries.length,LIMITS.entries);
  assert.equal(big.entries.find(e=>e.title==='E1'),undefined,'the oldest opened entry went');assert.ok(big.entries.find(e=>e.title==='E0'),'the older unread one stayed');
  fs.rmSync(dir,{recursive:true,force:true});
});

test('HTTP: Inbox is off until Settings turns it on; token and cookie, tunnel refused; add pushes and mails; act → feedback → ack; seen; filters; and the CLI',async t=>{
  const dir=tmp();let port=19691;
  const secret=randomUUID(),exp=Date.now()+3600000;
  const cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
  const mailFile=path.join(dir,'mail.jsonl');
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  fs.writeFileSync(path.join(dir,'data','pocket-settings.json'),JSON.stringify({notifyEmail:'owner@example.test'}));
  let child,logs='';
  const start=async()=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SKILLS:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),POCKET_PUBLIC_URL:'https://pocket.example.test',POCKET_TZ:'America/New_York',POCKET_SMTP_URL:'file:'+mailFile,POCKET_SMTP_FROM:'pocket@example.test'},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
   if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=43;logs='';return start();}
   throw Error('Test server failed: '+logs);
  };
  const stop=async()=>{if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}};
  t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  const call=async(p,body,h=headers)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers:h,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({})),cache:r.headers.get('cache-control')};};
  const mails=()=>fs.existsSync(mailFile)?fs.readFileSync(mailFile,'utf8').trim().split('\n').map(JSON.parse):[];
  await start();
  const tokenOf=()=>fs.readFileSync(path.join(dir,'data','cli-token'),'utf8').trim();
  let bearer={'content-type':'application/json',authorization:'Bearer '+tokenOf()};
  // Off by default, for the owner and the token alike; never reachable signed out.
  let r=await call('/inbox');assert.equal(r.status,404);assert.equal(r.body.code,'inbox_off');assert.match(r.body.error,/Settings → Projects, files, tasks & vault/);
  assert.equal((await call('/inbox',{title:'x'},bearer)).body.code,'inbox_off');assert.equal((await call('/inbox/feedback',null,bearer)).status,404);
  assert.equal((await call('/inbox',null,{})).status,401);
  assert.equal((await call('/me')).body.features.inbox,false);
  r=await call('/settings',{inbox:true});assert.equal(r.status,200);assert.equal(r.body.inbox,true);assert.equal((await call('/me')).body.features.inbox,true);
  assert.match(logs,/settings updated: .* inbox=true/);
  r=await call('/inbox');assert.equal(r.status,200);assert.equal(r.cache,'private, no-store');
  assert.deepEqual(r.body.entries,[]);assert.equal(r.body.newCount,0);assert.equal(r.body.lastReportAt,null);assert.deepEqual(r.body.push,{enabled:false});assert.equal(r.body.email,true);
  assert.equal((await call('/inbox',null,bearer)).status,200,'the loopback token reads the list');
  assert.equal((await call('/inbox',null,{...bearer,'cf-connecting-ip':'203.0.113.5'})).status,401,'a request through the tunnel cannot use the token');
  assert.equal((await call('/inbox',null,{...bearer,'x-forwarded-for':'203.0.113.5'})).status,401,'nor one through a proxy');
  assert.equal((await call('/sessions',null,bearer)).status,401,'the token opens nothing else');
  // Add from the worker: the entry, no push (no VAPID keys), the email through the file transport, the heartbeat.
  const add=await call('/inbox',{title:'Elmstead needs dispatch attention before 9 a.m.',text:'Jordan is on the way for 9–10 [per Robin](msg:19a2b3c4). She says the call was last night. Check the board.',story:'Elmstead service-call story',priority:'high',url:'/#/start/0123456789ab',gmail:GMAIL,dedupe:'elmstead:t1',email:true},bearer);
  assert.equal(add.status,200,JSON.stringify(add.body));assert.equal(add.body.ok,true);assert.equal(add.body.push,null);assert.equal(add.body.mail,true);assert.equal(add.body.duplicate,false);
  const e=add.body.entry;assert.deepEqual([e.by,e.state,e.new,e.priority,e.kind,e.url],['cli','new',true,'high','alert','/#/start/0123456789ab']);
  const m=mails().at(-1);assert.equal(m.to,'owner@example.test');assert.equal(m.subject,'[Pocket Code] Elmstead needs dispatch attention before 9 a.m.');
  assert.match(m.text,/^Jordan is on the way for 9–10 per Robin\. She says/,'citations become their labels in mail');assert.match(m.text,/\n\nhttps:\/\/pocket\.example\.test\/#\/start\/0123456789ab/);assert.match(m.text,/Gmail: https:\/\/mail\.google\.com\//);
  assert.match(m.html,/Open in Pocket Code/);assert.match(m.html,/Open in Gmail/);
  assert.match(logs,new RegExp(`inbox add kind=alert id=${e.id} by=cli push=off mail=true`));
  r=await call('/inbox');assert.deepEqual(r.body.entries.map(x=>x.id),[e.id]);assert.equal(r.body.newCount,1);assert.ok(r.body.lastReportAt,'adding records the heartbeat');assert.ok(r.body.sources['inbox-monitor']);
  // A duplicate changes nothing and sends nothing; push:false sends no push; mail only when asked.
  const before=mails().length;
  const dup=await call('/inbox',{title:'Elmstead again',dedupe:'elmstead:t1',email:true},bearer);assert.equal(dup.body.duplicate,true);assert.equal(dup.body.entry.id,e.id);assert.equal(dup.body.mail,false);assert.equal(dup.body.push,null);
  assert.equal(mails().length,before,'no mail for a duplicate');assert.match(logs,/ duplicate/);
  const quiet=await call('/inbox',{title:'Morning look-ahead',kind:'lookahead',text:'Three visits today.',doc:'abcdef012345',push:false});
  assert.equal(quiet.status,200);assert.equal(quiet.body.entry.by,'ui','the owner can add too');assert.equal(quiet.body.mail,false);assert.equal(quiet.body.push,null);assert.equal(mails().length,before);
  assert.equal((await call('/inbox',{text:'no title'},bearer)).body.code,'no_title');
  assert.equal((await call('/inbox',{title:'x',gmail:'https://evil.example/'},bearer)).body.code,'bad_gmail');
  assert.equal((await call('/inbox',{title:'x',kind:'memo'},bearer)).status,400);
  // act → feedback → ack, through the owner's cookie and the worker's token.
  r=await call('/inbox/act',{action:'open',id:e.id});assert.equal(r.status,200);assert.equal(r.body.entry.state,'opened');assert.ok(r.body.entry.seenAt);
  r=await call('/inbox/act',{action:'not_useful',id:e.id,note:'Dispatch already knew'});assert.equal(r.body.entry.state,'not_useful');
  assert.equal((await call('/inbox/act',{action:'dismiss',id:'000000000000'})).status,404);
  r=await call('/inbox/act',{action:'explode',id:e.id});assert.equal(r.status,400);assert.equal(r.body.code,'bad_action');
  r=await call('/inbox/feedback',null,bearer);assert.equal(r.status,200);assert.equal(r.body.ok,true);
  assert.deepEqual(r.body.feedback.map(f=>[f.id,f.action,f.note,f.story]),[[e.id,'not_useful','Dispatch already knew','Elmstead service-call story']]);
  assert.deepEqual((await call('/inbox/feedback?since=2999-01-01T00:00:00Z',null,bearer)).body.feedback,[]);
  assert.equal((await call('/inbox/feedback?since=soon',null,bearer)).status,400);
  r=await call('/inbox/ack',{ids:[e.id]},bearer);assert.deepEqual(r.body,{ok:true,acked:1});
  assert.deepEqual((await call('/inbox/feedback',null,bearer)).body.feedback,[]);
  assert.equal((await call('/inbox/ack',{ids:'x'},bearer)).status,400);
  // seen: the heartbeat on its own.
  assert.deepEqual((await call('/inbox/seen',{source:'nightly-digest'},bearer)).body,{ok:true});
  assert.ok((await call('/inbox')).body.sources['nightly-digest']);assert.equal((await call('/inbox/seen',{at:'later'},bearer)).status,400);
  // Filters.
  await call('/inbox/act',{action:'dismiss',id:quiet.body.entry.id});
  assert.deepEqual((await call('/inbox')).body.entries,[],'nothing new');
  assert.deepEqual((await call('/inbox?state=all')).body.entries.map(x=>x.id),[e.id]);
  assert.deepEqual((await call('/inbox?state=dismissed')).body.entries.map(x=>x.id),[quiet.body.entry.id]);
  assert.deepEqual((await call('/inbox?state=all&since=2999-01-01T00:00:00Z')).body.entries,[]);
  assert.equal((await call('/inbox?state=bogus')).body.code,'bad_state');
  // 1.69: alerts is a push kind a device can turn off.
  r=await call('/push/subscribe',{subscription:{endpoint:'https://push.example.test/a',keys:{p256dh:'k',auth:'a'}},prefs:{kinds:{alerts:false}}});
  assert.deepEqual(r.body.prefs.kinds,{turns:true,reminders:true,vault:true,alerts:false});
  // The CLI.
  const cli=(args,input,extra={})=>new Promise(res=>{const c=execFile(process.execPath,[path.join(repo,'scripts/pocket-inbox.mjs'),...args],{cwd:dir,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_DATA_DIR:path.join(dir,'data'),...extra}},(err,stdout,stderr)=>res({code:err?err.code:0,stdout,stderr}));if(input!==undefined)c.stdin.end(input);});
  let out=await cli(['add','--title','Birchwood invoice question','--file','-','--story','Birchwood billing','--priority','critical','--gmail',GMAIL],'Their AP asks for the W-9 [AP](msg:abc).\n');
  assert.equal(out.code,0,out.stderr);const m2=/^([0-9a-f]{12}) push=off mail=no$/.exec(out.stdout.trim());assert.ok(m2,out.stdout);const cid=m2[1];
  out=await cli(['list','--json']);assert.equal(out.code,0,out.stderr);const rows=JSON.parse(out.stdout);assert.deepEqual(rows.map(x=>x.id),[cid]);assert.equal(rows[0].text,'Their AP asks for the W-9 [AP](msg:abc).');
  out=await cli(['list']);assert.match(out.stdout,new RegExp(`^\\* .*Birchwood invoice question  \\(${cid}\\)  alert · critical$`,'m'));
  out=await cli(['list','--state','all']);assert.match(out.stdout,/Elmstead needs dispatch .* · not useful/);
  out=await cli(['show',cid]);assert.match(out.stdout,/Story: Birchwood billing/);assert.match(out.stdout,/Their AP asks for the W-9 AP\./);assert.match(out.stdout,/Gmail: https:\/\/mail\.google\.com/);
  out=await cli(['act',cid,'resolve','--note','Sent the W-9']);assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/resolved/);assert.match(out.stdout,/Note: Sent the W-9/);
  out=await cli(['show',quiet.body.entry.id,'--json']);assert.equal(JSON.parse(out.stdout).state,'dismissed','show finds a dismissed entry too');
  // 1.113: add on an open story says "updated"; merge from the CLI
  out=await cli(['add','--title','Pier cameras','--text','Two cameras down.','--story','pier']);const pid=out.stdout.split(' ')[0];
  out=await cli(['add','--title','Pier cameras still down','--text','Still down.','--story','pier']);assert.match(out.stdout,new RegExp(`^${pid} .* updated$`,'m'));
  out=await cli(['add','--title','Pier storm','--text','Down since the storm.','--story','pier-storm']);const sid2=out.stdout.split(' ')[0];
  out=await cli(['merge',sid2]);assert.equal(out.code,1);assert.match(out.stderr,/--into <entry id> or --session/);
  out=await cli(['merge',sid2,'--into',pid]);assert.equal(out.code,0,out.stderr);assert.match(out.stdout,new RegExp(`Merged "Pier storm" \\(${sid2}\\) into "Pier cameras still down" \\(${pid}\\)`));
  out=await cli(['show',pid]);assert.match(out.stdout,/Updated 1 time with later mail/);assert.match(out.stdout,new RegExp(`Took in: Pier storm \\(${sid2}\\)`));
  await call('/inbox/act',{action:'dismiss',id:pid});await call('/inbox/ack',{ids:[pid,sid2]},bearer);
  // 1.113.1: a conversation's catch-up, read by the chat view and marked after Bring it in
  r=await call('/inbox/news?session=sess-none-0000');assert.equal(r.status,200);assert.equal(r.cache,'private, no-store');assert.deepEqual(r.body.news,[]);
  r=await call('/inbox/caught-up',{session:'sess-none-0000'});assert.deepEqual([r.status,r.body.caughtUp],[200,0]);
  r=await call('/inbox/caught-up',{session:'x'});assert.equal(r.status,400);
  // 1.115: a separate subject over HTTP and from the CLI; the entry that comes back out gets a briefing of its own
  out=await cli(['add','--title','Dock gate','--text','The dock gate is stuck.','--story','dock']);const dock=out.stdout.split(' ')[0];
  r=await call('/inbox/split',{id:dock});assert.deepEqual([r.status,r.body.code],[400,'bad_split']);assert.match(r.body.error,/Nothing new has come in/);
  r=await call('/inbox/split',{session:'sess-none-0000'});assert.deepEqual([r.status,r.body.code],[404,'inbox_missing']);
  r=await call('/inbox/split',{});assert.equal(r.status,400);
  out=await cli(['add','--title','Dock lights quote','--text','They ask for a quote on dock lights.','--story','dock-lights']);const lights=out.stdout.split(' ')[0];
  out=await cli(['merge',lights,'--into',dock]);assert.equal(out.code,0,out.stderr);
  out=await cli(['split']);assert.equal(out.code,1);assert.match(out.stderr,/split needs an entry id or --session/);
  out=await cli(['split',dock]);assert.equal(out.code,0,out.stderr);
  assert.match(out.stdout,new RegExp(`^Split "Dock lights quote" \\(${lights}\\) off "Dock gate" \\(${dock}\\) as a separate subject\\. Its briefing: /#/start/[0-9a-f]{12}$`,'m'));
  r=await call('/inbox?state=all');const lit=r.body.entries.find(e=>e.id===lights);
  assert.deepEqual([lit.state,lit.mergedInto,lit.splitFrom,lit.fromStory,lit.story],['opened','',dock,'dock','dock-lights']);assert.match(lit.url,/^\/#\/start\/[0-9a-f]{12}$/);
  r=await call('/start/'+lit.url.slice(9));assert.equal(r.status,200);
  assert.match(r.body.text,/^Dock lights quote\n\nThey ask for a quote on dock lights\.\n\n---\nThe owner split this off the Inbox entry "Dock gate" as a separate subject\. Work it on its own, and do not merge this entry back into that one\.$/);
  assert.equal(r.body.title,'Dock lights quote');
  out=await cli(['merge',lights,'--into',dock]);assert.equal(out.code,1);assert.match(out.stderr,/split these two apart/);
  out=await cli(['show',lights]);assert.match(out.stdout,new RegExp(`Split off entry ${dock} as a separate subject`));
  out=await cli(['feedback','--json']);const sp=JSON.parse(out.stdout).find(f=>f.action==='split');
  assert.deepEqual([sp.id,sp.entry,sp.story,sp.fromStory,sp.from],[lights+':split',lights,'dock-lights','dock',dock]);
  await call('/inbox/act',{action:'dismiss',id:dock});await call('/inbox/act',{action:'dismiss',id:lights});await call('/inbox/ack',{ids:[dock,lights,lights+':split']},bearer);
  out=await cli(['feedback','--json']);assert.deepEqual(JSON.parse(out.stdout).map(f=>[f.id,f.action]).sort(),[[cid,'resolved'],[quiet.body.entry.id,'dismissed']].sort(),'both decisions (they can share a second, so in either order)');
  out=await cli(['feedback']);assert.match(out.stdout,/resolved  Birchwood invoice question .*note: Sent the W-9/);
  out=await cli(['ack',cid,quiet.body.entry.id]);assert.equal(out.stdout.trim(),'acked 2');
  out=await cli(['feedback']);assert.equal(out.stdout.trim(),'No new feedback.');
  out=await cli(['help']);assert.match(out.stdout,/act <id> <open\|unread\|dismiss\|resolve\|not_useful\|restore>/,'1.81: the help lists act … unread, which the server accepts');
  out=await cli(['seen','--source','cli-test']);assert.equal(out.stdout.trim(),'ok');assert.ok((await call('/inbox')).body.sources['cli-test']);
  // 1.70: Inbox Watch settings. The watcher's heartbeat brings its profile; the owner (or an agent when asked) sets; the watcher reads.
  out=await cli(['watch']);assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/has not reported its settings yet/);
  out=await cli(['seen','--source','inbox-monitor','--profile','-'],JSON.stringify(PROFILE));assert.equal(out.code,0,out.stderr);
  r=await call('/inbox/watch');assert.equal(r.status,200);assert.equal(r.cache,'private, no-store');assert.deepEqual([r.body.source,r.body.settings,r.body.revision],['inbox-monitor',null,0]);assert.deepEqual(r.body.profile,PROFILE);
  assert.equal((await call('/inbox/watch',null,{...bearer,'cf-connecting-ip':'203.0.113.5'})).status,401,'the token stays on loopback here too');
  r=await call('/inbox/watch',{settings:{every:7.5}});assert.equal(r.status,400);assert.equal(r.body.code,'bad_watch');
  r=await call('/inbox/watch',{settings:{...PROFILE.defaults,every:10,periods:[{name:'Overnight',days:[0,1,2,3,4,5,6],from:'22:00',to:'07:00',every:30}]}});
  assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.revision,1);assert.equal(r.body.by,'ui');assert.match(logs,/inbox watch settings source=inbox-monitor revision=1 by=ui/);
  out=await cli(['watch','--json']);const wj=JSON.parse(out.stdout);assert.deepEqual([wj.revision,wj.settings.every,wj.settings.periods[0].every],[1,10,30]);
  out=await cli(['watch']);assert.match(out.stdout,/your settings \(revision 1\)/);assert.match(out.stdout,/Overnight: days 0,1,2,3,4,5,6 22:00–07:00, every 30 min/);assert.match(out.stdout,/Decisions: sonnet \(medium\)/);assert.match(out.stdout,/2026-10-20  30 checks  12 calls  509,000 tokens  \$1\.25/);
  out=await cli(['watch','set','--every','15']);assert.equal(out.code,0,out.stderr);assert.equal(out.stdout.trim(),'revision 2: saved');
  out=await cli(['watch','set','--pause']);assert.equal((await call('/inbox/watch')).body.settings.paused,true);assert.equal((await call('/inbox')).body.paused,true,'a paused watcher is not called silent');
  assert.deepEqual([(await call('/inbox/watch')).body.settings.every,(await call('/inbox/watch')).body.settings.periods.length],[15,1],'set changes one thing');
  out=await cli(['watch','set']);assert.equal(out.code,1);assert.match(out.stderr,/needs --file/);
  out=await cli(['watch','set','--file','-'],'{"models":{"decisions":{"model":"gpt-9"}}}');assert.equal(out.code,1);assert.match(out.stderr,/Choose one of the models/);
  out=await cli(['watch','reset']);assert.equal(out.stdout.trim(),"revision 4: back to the watcher's config file");assert.equal((await call('/inbox/watch')).body.settings,null);
  // 1.75: Check now, from the Inbox (cookie) and from the CLI; the watcher reads the request with its settings.
  r=await call('/inbox/check',{});assert.equal(r.status,200,JSON.stringify(r.body));assert.match(r.body.checkRequestedAt,/^\d{4}-\d\d-\d\dT/);assert.match(logs,/inbox check now source=inbox-monitor at=\S+ by=ui/);
  out=await cli(['watch','--json']);assert.equal(JSON.parse(out.stdout).checkRequestedAt,r.body.checkRequestedAt,'the watcher sees the request');
  out=await cli(['check']);assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/asked inbox-monitor to check now/);
  out=await cli(['act',cid,'explode']);assert.equal(out.code,1);assert.match(out.stderr,/Unknown action/);
  out=await cli(['add','--title','x']);assert.equal(out.code,1);assert.match(out.stderr,/--text/);
  out=await cli(['show','000000000000']);assert.equal(out.code,1);
  out=await cli(['list'],undefined,{POCKET_DATA_DIR:path.join(dir,'nowhere')});assert.equal(out.code,2,'not running here');
  fs.mkdirSync(path.join(dir,'stale'));fs.writeFileSync(path.join(dir,'stale','cli-token'),'0'.repeat(64));fs.writeFileSync(path.join(dir,'stale','cli-url'),`http://127.0.0.1:${port}`);
  out=await cli(['list'],undefined,{POCKET_DATA_DIR:path.join(dir,'stale')});assert.equal(out.code,2,'a refused token');
  // With no address saved, asking for email says off; after the restart the feature stays on.
  fs.writeFileSync(path.join(dir,'data','pocket-settings.json'),JSON.stringify({...JSON.parse(fs.readFileSync(path.join(dir,'data','pocket-settings.json'),'utf8')),notifyEmail:''}));
  // 1.77: a conversation started from an entry's start link is remembered on the entry; a bad link id starts it anyway.
  const begun=await call('/new',{cwd:repo,text:'Handle Elmstead',provider:'claude',start:'0123456789ab',clientMessageId:randomUUID()});assert.equal(begun.status,202,JSON.stringify(begun.body));
  r=await call('/inbox?state=all');assert.deepEqual(r.body.entries.find(x=>x.id===e.id).sessions.map(x=>x.id),[begun.body.id]);
  assert.match(logs,new RegExp(`inbox link-session id=${e.id} session=${begun.body.id}`));
  assert.equal((await call('/new',{cwd:repo,text:'No link',provider:'claude',start:'../x',clientMessageId:randomUUID()})).status,202,'a bad start id is ignored');
  await stop();await start();bearer={'content-type':'application/json',authorization:'Bearer '+tokenOf()};
  r=await call('/inbox',{title:'No address',text:'x',email:true},bearer);assert.equal(r.status,200);assert.equal(r.body.mail,'off');
  assert.equal((await call('/inbox?state=all')).body.entries.length,3,'kept across a restart');
  out=await cli(['add','--title','Via CLI','--text','t','--email','--no-push','--json']);assert.equal(out.code,0,out.stderr);const j=JSON.parse(out.stdout);assert.equal(j.mail,'off');assert.equal(j.push,null);
  // Off again: the routes and the CLI say so.
  assert.equal((await call('/settings',{inbox:false})).body.inbox,false);
  out=await cli(['list']);assert.equal(out.code,1);assert.match(out.stderr,/Inbox Watch is off/);
  assert.equal((await call('/inbox')).status,404);
});

// 1.95: a digest's items, each with its own decision (alert, resolve, not_useful, restore) that reaches the watcher as feedback.
test('InboxStore: digest items are checked on add, kept on reload, decided one at a time and reported as digest-item feedback',()=>{
  const dir=tmp(),file=path.join(dir,'inbox.json');let clock=Date.parse('2026-11-07T13:00:00Z');
  const s=new InboxStore(file,{now:()=>clock});
  const items=[{ref:'a317',section:'worth',title:'Robin website feedback and review',text:'Robin texted that business is up 25%. [Text](msg:1a1b398659576b53)',story:'robin-website-feedback',gmail:GMAIL,url:'/#/start/0123456789ab',priority:'low'},
    {ref:'a296',section:'held',title:'Copperleaf Wireless Google Ads keywords',text:'Steve asked for a keyword review.',story:'copperleaf-wireless-google-ads-keywords'},
    {ref:'t12',section:'tidied',title:'Harbor launch',text:'Resolved'}];
  const d=s.add({kind:'digest',title:'Morning email digest — Sat Nov 7',text:'## Worth knowing\n- Robin website feedback and review: business is up.\nIgnored since the last digest: 9 threads.',items,dedupe:'digest|2026-11-07'});
  assert.equal(d.items.length,3);assert.deepEqual(d.items[0],{ref:'a317',section:'worth',title:'Robin website feedback and review',text:items[0].text,story:'robin-website-feedback',gmail:GMAIL,url:'/#/start/0123456789ab',priority:'low',state:'open',actedAt:null,ackedAt:null,note:'',lastAction:null,sessions:[]});
  assert.deepEqual([d.items[1].priority,d.items[1].gmail,d.items[1].url,d.items[2].section],['normal','','','tidied'],'defaults');
  assert.throws(()=>s.add({title:'x',items:[{ref:'a1',title:'t',url:'javascript:alert(1)'}]}),e=>e.code==='bad_item','an item\'s start link is checked like an entry\'s');
  assert.equal(s.add({kind:'alert',title:'plain'}).items.length,0,'an alert has no items');
  assert.throws(()=>s.add({title:'x',items:'nope'}),e=>e.code==='bad_items');
  assert.throws(()=>s.add({title:'x',items:[{ref:'a1',title:'one'},{ref:'a1',title:'two'}]}),e=>e.code==='bad_item'&&/used twice/.test(e.message));
  assert.throws(()=>s.add({title:'x',items:[{ref:'bad ref',title:'one'}]}),e=>e.code==='bad_item');
  assert.throws(()=>s.add({title:'x',items:[{ref:'a1'}]}),e=>e.code==='bad_item'&&/title/.test(e.message));
  assert.throws(()=>s.add({title:'x',items:[{ref:'a1',title:'t',section:'misc'}]}),e=>e.code==='bad_section');
  assert.throws(()=>s.add({title:'x',items:[{ref:'a1',title:'t',gmail:'https://evil.example/'}]}),e=>e.code==='bad_item');
  assert.throws(()=>s.add({title:'x',items:Array.from({length:201},(_,i)=>({ref:'a'+i,title:'t'}))}),e=>e.code==='bad_items');
  // A digest's text may run long; an alert's is still cut at 2000.
  assert.equal(s.add({kind:'digest',title:'long',text:'x'.repeat(13000)}).text.length,LIMITS.digestText);assert.equal(s.add({title:'long alert',text:'x'.repeat(13000)}).text.length,LIMITS.text);
  // Deciding on an item reads the entry, records the decision on the item and is feedback of kind digest-item with id <entry>/<ref>.
  clock+=1000;let r=s.act({action:'alert',id:d.id,item:'a317'});
  assert.deepEqual([r.state,r.seenAt,r.revision,r.items[0].state,r.items[0].actedAt,r.items[0].lastAction],['opened','2026-11-07T13:00:01Z',2,'alerted','2026-11-07T13:00:01Z','alert']);
  assert.equal(s.act({action:'alert',id:d.id,item:'a317'}).revision,2,'the same decision twice is one decision');
  clock+=1000;r=s.act({action:'not_useful',id:d.id,item:'a296',note:'Steve texts me anyway'});assert.deepEqual([r.items[1].state,r.items[1].note],['not_useful','Steve texts me anyway']);
  assert.throws(()=>s.act({action:'open',id:d.id,item:'a317'}),e=>e.code==='bad_action');assert.throws(()=>s.act({action:'alert',id:d.id,item:'a999'}),e=>e.status===404&&e.code==='item_missing');
  let fb=s.feedback();
  assert.deepEqual(fb.map(f=>f.id),[`${d.id}/a296`,`${d.id}/a317`],'newest first, the entry itself undecided');
  assert.deepEqual(fb[1],{id:`${d.id}/a317`,entry:d.id,item:'a317',action:'alert',at:'2026-11-07T13:00:01Z',note:'',title:'Robin website feedback and review',story:'robin-website-feedback',text:s.get(d.id).items[0].text,gmail:s.get(d.id).items[0].gmail,priority:'low',source:'inbox-monitor',kind:'digest-item'});
  assert.equal(fb[0].action,'not_useful');
  assert.equal(s.ack([`${d.id}/a317`,d.id,'nope']),1,'the item is acked, the undecided entry is not');assert.deepEqual(s.feedback().map(f=>f.id),[`${d.id}/a296`]);
  // Restore undoes the item's decision and is feedback again; the entry's own decisions still work beside the items'.
  clock+=1000;r=s.act({action:'restore',id:d.id,item:'a317'});assert.deepEqual([r.items[0].state,r.items[0].lastAction,r.items[0].ackedAt],['open','restore',null]);
  assert.deepEqual(s.feedback().map(f=>[f.id,f.action]),[[`${d.id}/a317`,'restore'],[`${d.id}/a296`,'not_useful']]);
  clock+=1000;s.act({action:'dismiss',id:d.id});assert.deepEqual(s.feedback().map(f=>f.id),[d.id,`${d.id}/a317`,`${d.id}/a296`]);
  assert.equal(s.ack([d.id,`${d.id}/a317`,`${d.id}/a296`]),3);assert.deepEqual(s.feedback(),[]);
  // 1.95 (owner request): a line whose story already has an open alert on the list is not a new card: it is 'listed', links to that entry, and takes no decision.
  const open=s.add({kind:'alert',title:'Copperleaf Wireless Google Ads keywords',story:'copperleaf-wireless-google-ads-keywords',gmail:GMAIL});
  const gone=s.add({kind:'alert',title:'Old one',story:'old-story'});s.act({action:'resolve',id:gone.id});
  const d2=s.add({kind:'digest',title:'Morning email digest — Sun Nov 8',text:'## Worth knowing\n- a\n- b',dedupe:'digest|2026-11-08',items:[
    {ref:'a400',section:'worth',title:'Steve wants the keyword list',text:'Steve asked again.',story:'copperleaf-wireless-google-ads-keywords'},
    {ref:'a401',section:'held',title:'Same thread, other story',text:'x',story:'other',gmail:GMAIL},
    {ref:'a402',section:'worth',title:'Old story returns',text:'y',story:'old-story'},
    {ref:'a403',section:'worth',title:'Fresh',text:'z',story:'fresh'}]});
  assert.deepEqual(d2.items.map(i=>[i.ref,i.section,i.url]),[['a402','worth',''],['a403','worth',''],['a400','listed','/#/inbox/'+open.id],['a401','listed','/#/inbox/'+open.id]],'story or thread matches an open alert; a resolved one does not; listed lines go last, the rest keep their order');
  assert.throws(()=>s.act({action:'alert',id:d2.id,item:'a400'}),e=>e.code==='item_history'&&/already on your list/.test(e.message));
  assert.throws(()=>s.act({action:'resolve',id:d.id,item:'t12'}),e=>e.code==='item_history');
  // Reload: items come back; a hand-edited bad item is dropped, not fatal.
  const raw=JSON.parse(fs.readFileSync(file,'utf8'));raw.entries[0].items.push({ref:'bad ref',title:'x'},{ref:'a317',title:'dup'});fs.writeFileSync(file,JSON.stringify(raw));
  const s2=new InboxStore(file,{now:()=>clock});const e2=s2.get(d.id);
  assert.deepEqual(e2.items.map(i=>[i.ref,i.state]),[['a296','not_useful'],['t12','open'],['a317','open']],'a317 shares its Gmail thread with the alert added above, so it folded into that alert and went last');
});

test('1.103: the list says whether Dismiss takes the Gmail label off, and its name', () => {
  const dir=tmp(),file=path.join(dir,'inbox.json');let clock=Date.parse('2026-11-11T12:00:00Z');
  const s=new InboxStore(file,{now:()=>clock});
  assert.equal(s.snapshot().gmailLabel,null,'no watcher yet');
  const base={version:1,defaults:{gmailLabel:{enabled:true}},options:{gmailLabel:{available:true,name:'Pocket Inbox',reason:null}}};
  s.seen('inbox-monitor',undefined,base);assert.deepEqual(s.snapshot().gmailLabel,{name:'Pocket Inbox'},'on by the watcher\'s default');
  s.setWatch('inbox-monitor',{gmailLabel:{enabled:false}});assert.equal(s.snapshot().gmailLabel,null,'the owner turned it off');
  s.setWatch('inbox-monitor',{gmailLabel:{enabled:true}});assert.deepEqual(s.snapshot().gmailLabel,{name:'Pocket Inbox'});
  clock+=1000;s.seen('inbox-monitor',undefined,{...base,options:{gmailLabel:{available:false,name:'Pocket Inbox',reason:'read only'}}});
  assert.equal(s.snapshot().gmailLabel,null,'a watcher that can only read changes nothing in Gmail');
  clock+=1000;s.seen('inbox-monitor',undefined,{version:1,defaults:{},options:{}});assert.equal(s.snapshot().gmailLabel,null,'a watcher without the label');
});

test('1.113: one entry per story — a later alert updates the open entry; a conversation merges a duplicate; Restore undoes it',()=>{
  const {s}=freshInbox(),G=t=>'https://mail.google.com/mail/u/0/#all/'+t;
  const a=s.add({title:'Harbor HOA gate down',text:'The gate controller is offline.',story:'harbor-gate',url:'/#/start/aaaaaaaaaaa1',gmail:G('19a0000000000001'),dedupe:'harbor-gate|1'});
  s.act({action:'open',id:a.id});s.linkStart('aaaaaaaaaaa1','sess-1111-aaaa');
  const other=s.add({title:'Other story',text:'x',story:'other',gmail:G('19a00000000000ff')});
  // a later alert on the same story: the same entry, updated in place, unread again and on top
  const b=s.add({title:'Harbor HOA gate still down',text:'Update: the tech could not reach the site.',story:'harbor-gate',url:'/#/start/aaaaaaaaaaa2',gmail:G('19a0000000000002'),dedupe:'harbor-gate|2',priority:'high'});
  assert.equal(b.id,a.id);assert.equal(b.updated,true);assert.equal(s.entries.filter(e=>e.story==='harbor-gate').length,1);
  assert.deepEqual([b.state,b.title,b.priority,b.url,b.gmail,b.updates],['new','Harbor HOA gate still down','high','/#/start/aaaaaaaaaaa2',G('19a0000000000002'),1]);
  assert.equal(b.text,'Update: the tech could not reach the site.\n\nEarlier on this entry: The gate controller is offline.');
  assert.equal(s.snapshot({state:'all'}).entries[0].id,a.id,'moved to the top');
  assert.deepEqual(b.merged.map(m=>[m.gmail,m.url]),[[G('19a0000000000001'),'/#/start/aaaaaaaaaaa1']],'the earlier thread is taken in');
  assert.deepEqual(b.sessions.map(x=>x.id),['sess-1111-aaaa'],'conversations stay');
  // a lower priority does not lower it; one level of earlier text only; the thread coming back is the entry's own again
  const c=s.add({title:'Harbor HOA gate',text:'Third.',story:'harbor-gate',gmail:G('19a0000000000001'),priority:'low'});
  assert.deepEqual([c.id,c.priority,c.updates,c.gmail],[a.id,'high',2,G('19a0000000000001')]);
  assert.equal(c.text,'Third.\n\nEarlier on this entry: Update: the tech could not reach the site.');
  assert.deepEqual(c.merged.map(m=>m.gmail),[G('19a0000000000002')]);
  // a long earlier text is cut to fit
  const d=s.add({title:'Harbor',text:'y'.repeat(1900),story:'harbor-gate'});assert.ok(d.text.length<=LIMITS.text);
  // a duplicate dedupe key is still a duplicate; merge:false and a finished entry give a new one
  assert.equal(s.add({title:'again',story:'harbor-gate',dedupe:'harbor-gate|2'}).duplicate,true);
  const sep=s.add({title:'separate',story:'harbor-gate',merge:false});assert.notEqual(sep.id,a.id);s.act({action:'dismiss',id:sep.id});
  s.act({action:'resolve',id:other.id});const o2=s.add({title:'Other again',story:'other'});assert.notEqual(o2.id,other.id,'a finished entry is not reopened');
  // the old start link still finds the entry
  assert.deepEqual(s.linkStart('aaaaaaaaaaa2','sess-2222-bbbb').map(e=>e.id),[a.id]);
  // merge: from the conversation, a duplicate under another story key
  const dup=s.add({title:'Harbor gate storm outage',text:'Gate offline since the storm.',story:'harbor-storm',gmail:G('19a0000000000003'),url:'/#/start/aaaaaaaaaaa3'});
  const m=s.merge({id:dup.id,session:'sess-1111-aaaa'});
  assert.equal(m.into.id,a.id);assert.deepEqual([m.entry.state,m.entry.mergedInto,m.entry.note],['dismissed',a.id,`Merged into "${m.into.title}".`]);
  assert.ok(m.into.merged.some(x=>x.id===dup.id&&x.gmail===G('19a0000000000003')));
  const fb=s.feedback().find(f=>f.id===dup.id);assert.deepEqual([fb.action,fb.mergedInto,fb.intoStory],['dismissed',a.id,'harbor-gate']);
  assert.throws(()=>s.merge({id:dup.id,into:a.id}),e=>e.code==='bad_merge','already off the list');
  assert.throws(()=>s.merge({id:a.id,into:a.id}),e=>e.code==='bad_merge');
  assert.throws(()=>s.merge({id:o2.id,session:'sess-none-xxxx'}),e=>e.status===404);
  assert.throws(()=>s.merge({id:o2.id}),e=>e.code==='bad_merge');
  assert.throws(()=>s.merge({id:o2.id,into:sep.id}),e=>e.code==='bad_merge','into a finished entry');
  // Restore takes it back out
  s.act({action:'restore',id:dup.id});
  assert.equal(s.get(dup.id).mergedInto,'');assert.ok(!s.get(a.id).merged.some(x=>x.id===dup.id));
  // reload keeps every new field
  const again=new InboxStore(s.file,{now:s.now});assert.deepEqual(again.get(a.id),s.get(a.id));
  // the instructions line names the merge command with this conversation's id
  assert.match(inboxInstructions('/srv/p/scripts/pocket-inbox.mjs','11111111-1111-4111-8111-111111111111'),/merge <other id> --session 11111111-1111-4111-8111-111111111111/);
});
test('1.113.1: the conversation an entry started catches up — news after it started, merges both ways, older conversations',()=>{
  const {s}=freshInbox(),G=t=>'https://mail.google.com/mail/u/0/#all/'+t;
  const a=s.add({title:'Harbor HOA gate down',text:'The gate controller is offline.',story:'harbor-gate',url:'/#/start/bbbbbbbbbbb1',gmail:G('19b0000000000001')});
  // no conversation yet: an update records no news
  s.add({title:'Harbor HOA gate down',text:'Still offline.',story:'harbor-gate',gmail:G('19b0000000000002')});
  assert.deepEqual([s.get(a.id).newsN,s.get(a.id).news.length],[0,0]);
  s.linkStart('bbbbbbbbbbb1','sess-aaaa-1111');
  assert.deepEqual(s.newsFor('sess-aaaa-1111'),[],'a new conversation has everything');
  // an update after it started: the conversation is behind by that one, with the text it will be sent
  s.add({title:'Harbor gate: tech on site',text:'Mike is on site at 2 pm. [mail](msg:19b03)',story:'harbor-gate',gmail:G('19b0000000000003')});
  let n=s.newsFor('sess-aaaa-1111');
  assert.equal(n.length,1);assert.deepEqual([n[0].id,n[0].story,n[0].news.length,n[0].news[0].kind,n[0].newsN],[a.id,false,1,'update',1]);
  const text=s.catchUpText(s.get(a.id),n[0],{fmt:()=>'2:14 PM'});
  assert.match(text,/^New on this Inbox story since this conversation started \("Harbor gate: tech on site"\):/);
  assert.match(text,/Update, 2:14 PM: Harbor gate: tech on site\nMike is on site at 2 pm\. \[mail\]\(msg:19b03\)\nGmail: https:\/\/mail\.google\.com\//);
  assert.doesNotMatch(text,/Earlier on this entry/,'only what is new, not the earlier text again');
  assert.match(s.catchUpText(s.get(a.id),n[0],{running:true}),/When you reach a good point/);
  assert.deepEqual(s.behind(s.get(a.id)).map(x=>x.session),['sess-aaaa-1111']);
  // caught up to what the message carried; news arriving in between still shows
  s.add({title:'Harbor gate fixed',text:'Fixed.',story:'harbor-gate'});
  assert.equal(s.caughtUp({session:'sess-aaaa-1111',id:a.id,upTo:1}),1);
  n=s.newsFor('sess-aaaa-1111');assert.deepEqual(n[0].news.map(x=>x.title),['Harbor gate fixed']);
  assert.equal(s.caughtUp({session:'sess-aaaa-1111'}),1);assert.deepEqual(s.newsFor('sess-aaaa-1111'),[]);
  assert.equal(s.caughtUp({session:'sess-aaaa-1111'}),0,'nothing left');
  assert.throws(()=>s.caughtUp({session:'no'}),e=>e.code==='bad_session');
  // a duplicate with its own conversation merged in from another conversation: the merging one is not behind, the host's
  // other conversations get the merged entry, and the merged entry's conversation gets the host's story
  s.linkStart('bbbbbbbbbbb1','sess-bbbb-2222');
  const dup=s.add({title:'Harbor storm outage',text:'Gate offline since the storm.',story:'harbor-storm',url:'/#/start/bbbbbbbbbbb9',gmail:G('19b0000000000009')});
  s.linkStart('bbbbbbbbbbb9','sess-cccc-3333');
  s.merge({id:dup.id,session:'sess-aaaa-1111'});
  assert.deepEqual(s.newsFor('sess-aaaa-1111'),[],'the conversation that merged found it itself');
  n=s.newsFor('sess-bbbb-2222');assert.deepEqual([n[0].news.length,n[0].news[0].kind,n[0].news[0].title],[1,'merge','Harbor storm outage']);
  assert.match(s.catchUpText(s.get(a.id),n[0],{fmt:()=>'x'}),/Merged in, x: Harbor storm outage\nGate offline since the storm\./);
  n=s.newsFor('sess-cccc-3333');assert.deepEqual([n.length,n[0].id,n[0].story],[1,a.id,true]);
  const story=s.catchUpText(s.get(a.id),n[0]);
  assert.match(story,/^The Inbox entry this conversation started from was merged into "Harbor gate fixed"/);assert.match(story,/Fixed\./);
  // Restore on the merged entry: its conversation no longer waits for the other entry's story
  s.act({action:'restore',id:dup.id});assert.deepEqual(s.newsFor('sess-cccc-3333'),[]);assert.ok(!s.get(a.id).sessions.some(x=>x.id==='sess-cccc-3333'));
  s.merge({id:dup.id,into:a.id});assert.equal(s.newsFor('sess-cccc-3333')[0].story,true,'merged again: offered again');
  assert.equal(s.caughtUp({session:'sess-cccc-3333',id:a.id}),1);assert.deepEqual(s.newsFor('sess-cccc-3333'),[]);
  // a finished entry asks nothing of its conversations
  s.add({title:'Harbor again',text:'More.',story:'harbor-gate'});assert.deepEqual(s.newsFor('sess-bbbb-2222')[0].news.map(x=>x.kind),['merge','merge','update'],'both merges and the update');
  s.act({action:'resolve',id:a.id});assert.deepEqual(s.newsFor('sess-bbbb-2222'),[]);
  // only the last few news items are kept; reload keeps news, newsN, seen and story
  s.act({action:'restore',id:a.id});for(let i=0;i<9;i++)s.add({title:'n'+i,text:'t'+i,story:'harbor-gate'});
  assert.ok(s.get(a.id).news.length<=6);assert.equal(s.get(a.id).news.at(-1).n,s.get(a.id).newsN);
  const again=new InboxStore(s.file,{now:s.now});assert.deepEqual(again.get(a.id),s.get(a.id));
  // a conversation from before 1.113.1 (no `seen`) has seen none of the news, which only began then
  const raw=JSON.parse(JSON.stringify(s.get(a.id)));raw.sessions=[{id:'sess-dddd-4444',at:raw.at}];
  assert.equal(s.behindOf(raw,raw.sessions[0]).news.length,raw.news.length);
  // a conversation started from a start link the entry took in was briefed with older news: it catches up on the story
  const b2=s.add({title:'Pool cams',text:'Down.',story:'pool',url:'/#/start/ccccccccccc1'});
  s.add({title:'Pool cams still down',text:'Still.',story:'pool',url:'/#/start/ccccccccccc2'});
  s.linkStart('ccccccccccc1','sess-eeee-5555');
  assert.deepEqual(s.newsFor('sess-eeee-5555').map(x=>[x.id,x.story]),[[b2.id,true]]);
});

test('1.115: a handed-off conversation gives its place on the entry to the one that continues it',()=>{
  const {s}=freshInbox(),G=t=>'https://mail.google.com/mail/u/0/#all/'+t;
  const a=s.add({title:'Harbor HOA gate down',text:'The gate controller is offline.',story:'harbor-gate',url:'/#/start/ccccccccccc1',gmail:G('19c0000000000001')});
  s.linkStart('ccccccccccc1','sess-aaaa-1111');
  s.add({title:'Harbor gate: tech on site at 2 pm',text:'Mike is on site at 2 pm.',story:'harbor-gate',url:'/#/start/ccccccccccc2',gmail:G('19c0000000000001')});
  assert.equal(s.newsFor('sess-aaaa-1111').length,1);
  // the hand-off ask: the conversation is told not to work the mail, and to put it first in the briefing
  const ask=s.catchUpText(s.get(a.id),s.newsFor('sess-aaaa-1111')[0],{handoff:true});
  assert.match(ask,/^New on this Inbox story since this conversation started \("Harbor gate: tech on site at 2 pm"\):\n\nUpdate, /);
  assert.match(ask,/Do not work on this here\. Hand this off: write a briefing for a new conversation to pick up from here, with this new mail as the first thing it deals with, and give me the handoff card\.$/);
  // handed off before the news was brought in: the new conversation is behind by the same news, the old one is offered nothing
  const linked=s.linkHandoff('sess-aaaa-1111','sess-bbbb-2222');
  assert.deepEqual(linked.map(e=>e.id),[a.id]);
  assert.deepEqual(s.get(a.id).sessions.map(x=>[x.id,x.handed===true,x.seen]),[['sess-aaaa-1111',true,undefined],['sess-bbbb-2222',false,0]]);
  assert.deepEqual(s.newsFor('sess-aaaa-1111'),[],'the old one is done with this entry');
  assert.equal(s.newsFor('sess-bbbb-2222')[0].news.length,1,'the one that continues it has not had the news either');
  // the usual order: the news goes into the hand-off message (caught-up), then the card starts the new one
  s.caughtUp({session:'sess-bbbb-2222'});
  s.linkHandoff('sess-bbbb-2222','sess-cccc-3333');
  assert.deepEqual(s.newsFor('sess-cccc-3333'),[],'the briefing carried it');
  s.add({title:'Harbor gate: fixed',text:'Mike says it is fixed.',story:'harbor-gate',gmail:G('19c0000000000001')});
  assert.deepEqual([s.newsFor('sess-aaaa-1111').length,s.newsFor('sess-bbbb-2222').length,s.newsFor('sess-cccc-3333').length],[0,0,1],'later mail goes to the newest only');
  assert.deepEqual(s.behind(s.get(a.id)).map(x=>x.session),['sess-cccc-3333'],'and only it is steered');
  // twice, to itself or from a conversation no entry knows: nothing
  assert.deepEqual(s.linkHandoff('sess-bbbb-2222','sess-cccc-3333'),[]);assert.deepEqual(s.linkHandoff('sess-cccc-3333','sess-cccc-3333'),[]);assert.deepEqual(s.linkHandoff('sess-none-0000','sess-dddd-4444'),[]);
  // kept across a reload; a conversation that came with a merged entry hands on its whole-story catch-up
  const again=new InboxStore(s.file);
  assert.deepEqual(again.get(a.id).sessions.filter(x=>x.handed).map(x=>x.id),['sess-aaaa-1111','sess-bbbb-2222']);
  const b=s.add({title:'Harbor storm damage',text:'The storm took the gate arm.',story:'harbor-storm',url:'/#/start/ccccccccccc3',gmail:G('19c0000000000003')});
  s.linkStart('ccccccccccc3','sess-eeee-5555');
  s.merge({id:b.id,into:a.id});
  assert.equal(s.newsFor('sess-eeee-5555')[0].story,true);
  s.linkHandoff('sess-eeee-5555','sess-ffff-6666');
  assert.equal(s.newsFor('sess-ffff-6666')[0].story,true);assert.deepEqual(s.newsFor('sess-eeee-5555'),[]);
});

test('1.115: a separate subject — the newest mail leaves the entry as its own, the watcher is told, and it is never merged back',()=>{
  const {s}=freshInbox(),G=t=>'https://mail.google.com/mail/u/0/#all/'+t;
  const a=s.add({title:'Harbor HOA gate down',text:'The gate controller is offline.',story:'harbor-gate',url:'/#/start/ddddddddddd1',gmail:G('19d0000000000001'),priority:'normal'});
  s.act({action:'open',id:a.id});
  assert.throws(()=>s.split({id:a.id}),e=>e.code==='bad_split'&&/Nothing new has come in/.test(e.message));
  s.linkStart('ddddddddddd1','sess-aaaa-1111');
  const at0=s.get(a.id).at;
  // an update on another thread, which is really about something else
  s.add({title:'Harbor pool camera quote',text:'The board asks for a quote on two pool cameras.',story:'harbor-gate',url:'/#/start/ddddddddddd2',gmail:G('19d0000000000002'),priority:'high'});
  let host=s.get(a.id);
  assert.deepEqual([host.title,host.gmail,host.url,host.priority,host.state,host.updates],['Harbor pool camera quote',G('19d0000000000002'),'/#/start/ddddddddddd2','high','new',1]);
  const r=s.split({session:'sess-aaaa-1111'},{actor:'ui'});
  host=s.get(a.id);const off=s.get(r.entry.id);
  assert.deepEqual([host.title,host.text,host.gmail,host.url,host.priority,host.state,host.updates,host.at],['Harbor HOA gate down','The gate controller is offline.',G('19d0000000000001'),'/#/start/ddddddddddd1','normal','opened',0,at0],'the entry says what it said before');
  assert.deepEqual([host.merged,host.news],[[],[]],'and holds nothing of the mail that left');
  assert.deepEqual([off.kind,off.title,off.text,off.gmail,off.priority,off.state,off.source,off.splitFrom,off.fromStory,off.sessions.length],
    ['alert','Harbor pool camera quote','The board asks for a quote on two pool cameras.',G('19d0000000000002'),'high','opened',host.source,a.id,'harbor-gate',0]);
  assert.match(off.story,/^harbor-pool-camera-quote-[0-9a-f]{4}$/,'a story key of its own, in the watcher’s form');
  assert.deepEqual([r.briefUrl,r.session,r.from.id],['/#/start/ddddddddddd2','',a.id]);
  assert.deepEqual(s.newsFor('sess-aaaa-1111'),[],'the conversation has nothing to catch up on');
  // the server mints the split entry's briefing
  assert.equal(s.relink(off.id,'/#/start/ddddddddddd9').url,'/#/start/ddddddddddd9');
  // the watcher hears it once, under its own id, and a later decision on the entry does not replace it
  let fb=s.feedback();
  assert.deepEqual(fb.map(f=>[f.id,f.action,f.entry,f.story,f.fromStory,f.from,f.gmail,f.title]),[[off.id+':split','split',off.id,off.story,'harbor-gate',a.id,G('19d0000000000002'),'Harbor pool camera quote']]);
  s.act({action:'resolve',id:off.id});
  assert.deepEqual(s.feedback().map(f=>f.action).sort(),['resolved','split']);
  assert.equal(s.ack([off.id+':split']),1);assert.deepEqual(s.feedback().map(f=>f.action),['resolved']);
  s.act({action:'restore',id:off.id});s.ack([off.id]);
  // before the watcher has moved the thread, mail on it still arrives under the old story: it goes to the split entry
  const late=s.add({title:'Harbor pool cameras: two models',text:'They prefer the turret model.',story:'harbor-gate',gmail:G('19d0000000000002')});
  assert.deepEqual([late.id,late.updated,s.get(a.id).title],[off.id,true,'Harbor HOA gate down']);
  // and mail on the old story's own thread still goes to the old entry
  assert.equal(s.add({title:'Harbor gate: tech on site',text:'Mike is on site.',story:'harbor-gate',gmail:G('19d0000000000001')}).id,a.id);
  // the two are never merged back, either way round
  assert.throws(()=>s.merge({id:off.id,into:a.id}),e=>e.code==='bad_merge'&&/split these two apart/.test(e.message));
  assert.throws(()=>s.merge({id:a.id,into:off.id}),e=>e.code==='bad_merge');
  // kept across a reload
  const again=new InboxStore(s.file);
  assert.deepEqual([again.get(off.id).splitFrom,again.get(off.id).fromStory,again.get(off.id).splitAcked!=null],[a.id,'harbor-gate',true]);
  // an update on the same thread as the entry: the entry keeps its thread, the split entry shares it
  const c=s.add({title:'Marina dock lights',text:'Two dock lights are out.',story:'marina-lights',url:'/#/start/ddddddddddd5',gmail:G('19d0000000000005')});
  s.linkStart('ddddddddddd5','sess-bbbb-2222');
  s.add({title:'Marina slip fees',text:'They also ask about slip fees.',story:'marina-lights',url:'/#/start/ddddddddddd6',gmail:G('19d0000000000005')});
  const r2=s.split({id:c.id});
  assert.deepEqual([s.get(c.id).title,s.get(c.id).url,s.get(c.id).gmail,r2.entry.gmail,r2.briefUrl,s.get(c.id).merged],['Marina dock lights','/#/start/ddddddddddd5',G('19d0000000000005'),G('19d0000000000005'),'/#/start/ddddddddddd6',[]]);
  // not an alert, not open, or unknown
  const d=s.add({kind:'digest',title:'Morning digest',text:'x'});
  assert.throws(()=>s.split({id:d.id}),e=>e.code==='bad_split');
  assert.throws(()=>s.split({}),e=>e.status===400&&e.code==='bad_split');
  assert.throws(()=>s.split({session:'sess-none-0000'}),e=>e.status===404&&e.code==='inbox_missing');
  s.act({action:'resolve',id:c.id});assert.throws(()=>s.split({id:c.id}),e=>/no longer on the list/.test(e.message));
});

test('1.115: a merged entry split back out is its own entry again, with its conversation',()=>{
  const {s}=freshInbox(),G=t=>'https://mail.google.com/mail/u/0/#all/'+t;
  const a=s.add({title:'Harbor HOA gate down',text:'The gate controller is offline.',story:'harbor-gate',url:'/#/start/eeeeeeeeeee1',gmail:G('19e0000000000001')});
  s.linkStart('eeeeeeeeeee1','sess-aaaa-1111');
  const b=s.add({title:'Harbor storm damage',text:'The storm took the gate arm.',story:'harbor-storm',url:'/#/start/eeeeeeeeeee2',gmail:G('19e0000000000002')});
  s.linkStart('eeeeeeeeeee2','sess-bbbb-2222');
  s.merge({id:b.id,into:a.id});s.ack([b.id]);
  assert.deepEqual([s.newsFor('sess-aaaa-1111')[0].news[0].kind,s.newsFor('sess-bbbb-2222')[0].story],['merge',true]);
  // asked from the conversation that came with the merged entry: that entry comes back out, and it is its conversation
  const r=s.split({session:'sess-bbbb-2222'});
  const host=s.get(a.id),out=s.get(b.id);
  assert.deepEqual([r.entry.id,r.session,out.state,out.mergedInto,out.note,out.story,out.splitFrom,out.fromStory],[b.id,'sess-bbbb-2222','opened','','','harbor-storm',a.id,'harbor-gate']);
  assert.deepEqual([host.merged,host.news,host.sessions.map(x=>x.id)],[[],[],['sess-aaaa-1111']],'the entry it left holds nothing of it');
  assert.deepEqual([s.newsFor('sess-aaaa-1111'),s.newsFor('sess-bbbb-2222')],[[],[]]);
  assert.deepEqual(s.feedback().map(f=>[f.id,f.action,f.story,f.fromStory]),[[b.id+':split','split','harbor-storm','harbor-gate']],'the watcher hears the split, not a plain restore');
  assert.throws(()=>s.merge({id:b.id,session:'sess-aaaa-1111'}),e=>e.code==='bad_merge');
  // asked from the entry (its own conversation is behind by the merge): the same
  const c=s.add({title:'Pier cameras',text:'Two cameras down.',story:'pier',url:'/#/start/eeeeeeeeeee3'});
  s.linkStart('eeeeeeeeeee3','sess-cccc-3333');
  const d=s.add({title:'Pier storm',text:'Down since the storm.',story:'pier',merge:false});
  s.merge({id:d.id,into:c.id});
  const r2=s.split({id:c.id});
  assert.deepEqual([r2.entry.id,r2.session,s.get(d.id).state],[d.id,'','opened']);
  assert.notEqual(s.get(d.id).story,'pier','two entries on one story key would fold again, so it gets its own');
  assert.match(s.get(d.id).story,/^pier-storm-[0-9a-f]{4}$/);
});
