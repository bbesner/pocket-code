// 1.50 notifications: a device's push preferences, the notification settings (day-before notice, email address), and
// the announcements for due and day-before items through the hook and the mail transport, plus the test message.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {createMailer,dueMessage,looksLikeEmail} from '../mail.mjs';
import {TaskStore} from '../tasks.mjs';
import {ProjectStore} from '../projects.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pocket-notify-'));

test('mail.mjs: the transport is optional and checked, the messages name the item, the time and the link',async()=>{
  assert.equal(createMailer('').configured,false);
  assert.throws(()=>createMailer('not a url'),/expected smtps/);
  assert.throws(()=>createMailer('https://example.test'),/smtp:\/\//);
  assert.throws(()=>createMailer('smtps://smtp.example.test:465'),/POCKET_SMTP_FROM/,'no sender anywhere');
  assert.equal(createMailer('smtps://me%40example.test:pw@smtp.example.test:465').from,'me@example.test','the URL user is the sender when it is an address');
  assert.equal(createMailer('smtp://user:pw@smtp.example.test:587',{from:'pocket@example.test'}).describe(),'smtp.example.test:587, from pocket@example.test');
  const dir=tmp(),file=path.join(dir,'mail.jsonl'),m=createMailer('file:'+file,{from:'pocket@example.test'});
  await m.send({to:'me@example.test',subject:'Hi',text:'t',html:'<p>t</p>'});
  const line=JSON.parse(fs.readFileSync(file,'utf8').trim());assert.equal(line.to,'me@example.test');assert.equal(line.from,'pocket@example.test');
  assert.equal(looksLikeEmail('me@example.test'),true);assert.equal(looksLikeEmail('me@'),false);assert.equal(looksLikeEmail('no spaces@x.y'),false);assert.equal(looksLikeEmail(42),false);
  const task=dueMessage({kind:'task',task:'abc',text:'Check the refund',dueAt:'2026-10-23T13:00:00Z',url:'/#/tasks'},{base:'https://pocket.example.test/',tz:'America/New_York'});
  assert.equal(task.subject,'[Pocket Code] Task due: Check the refund');assert.match(task.text,/Due: Oct 23, 2026, 9:00 AM/);assert.match(task.text,/https:\/\/pocket\.example\.test\/#\/tasks/);assert.match(task.html,/Open Tasks/);
  const ahead=dueMessage({kind:'task',task:'abc',text:'Check the refund',dueAt:'2026-10-23T13:00:00Z'},{ahead:true});
  assert.equal(ahead.subject,'[Pocket Code] Task due tomorrow: Check the refund');assert.doesNotMatch(ahead.text,/https?:/,'no link without a public address');
  const rem=dueMessage({project:'p',projectName:'SCK blog cleanup',reminder:'r',label:'28-day traffic check',dueAt:'2026-10-28T13:00:00Z',task:'t',taskText:'Pull the Search Console export',url:'/#/projects/p'},{base:'https://pocket.example.test'});
  assert.equal(rem.subject,'[Pocket Code] Reminder: SCK blog cleanup — 28-day traffic check');assert.match(rem.text,/Project: SCK blog cleanup/);assert.match(rem.text,/Step: Pull the Search Console export/);assert.match(rem.html,/href="https:\/\/pocket\.example\.test\/#\/projects\/p"/);
  assert.equal(dueMessage({projectName:'P',label:'<b>x</b>',dueAt:'2026-10-28T13:00:00Z'},{ahead:true}).subject,'[Pocket Code] Reminder tomorrow: P — <b>x</b>');
  assert.match(dueMessage({projectName:'P',label:'<b>x</b>',dueAt:'2026-10-28T13:00:00Z'}).html,/&lt;b&gt;x&lt;\/b&gt;/,'HTML is escaped');
  fs.rmSync(dir,{recursive:true,force:true});
});

test('HTTP: push preferences per device, the notification settings, and due and day-before announcements by hook and mail',async t=>{
  const dir=tmp();let port=19371;
  const secret='notify-secret',exp=Date.now()+3600000;
  const cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
  const hookLog=path.join(dir,'hook.log'),hook=path.join(dir,'hook.mjs'),mailFile=path.join(dir,'mail.jsonl');
  fs.writeFileSync(hook,`import fs from 'node:fs';let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>fs.appendFileSync(${JSON.stringify(hookLog)},d+'\\n'));`);
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  // Seeded before the daemon starts: a task and a reminder set two days ago and due in two hours (the day-before notice
  // applies), and a task set an hour ago for tomorrow (set less than a day ahead: no notice). Settings start with Tasks
  // and Projects on, the notice on and an address saved.
  const now=Date.now(),twoDaysAgo=new Date(now-2*86400000).toISOString(),inTwoHours=new Date(now+2*3600000).toISOString(),anHourAgo=new Date(now-3600000).toISOString(),tomorrow=new Date(now+22*3600000).toISOString();
  const seedTasks=new TaskStore(path.join(dir,'data','tasks.json'),{now:()=>now-2*86400000});
  const soon=seedTasks.act({action:'add',text:'Soon, set long ago',dueAt:inTwoHours});
  seedTasks.now=()=>now-3600000;seedTasks.act({action:'add',text:'Tomorrow, set just now',dueAt:tomorrow});
  const seedBoard=new ProjectStore(path.join(dir,'data','projects.json'),{now:()=>now-2*86400000});
  const proj=seedBoard.act({action:'track',name:'Blog cleanup',summary:'Redirects done.',requested:true});
  seedBoard.act({action:'remind',project:proj.id,at:inTwoHours,text:'14-day traffic check'});
  seedBoard.now=()=>now-3600000;seedBoard.act({action:'remind',project:seedBoard.act({action:'track',name:'Quick',requested:true}).id,at:tomorrow,text:'Set an hour ago'});
  fs.writeFileSync(path.join(dir,'data','pocket-settings.json'),JSON.stringify({tasks:true,projects:true,remindAhead:24,notifyEmail:'owner@example.test'}));
  let child,logs='';
  const start=async(extra={})=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SKILLS:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),POCKET_REMINDER_HOOK:`${process.execPath} ${hook}`,POCKET_REMINDER_CHECK_MS:'300',POCKET_TZ:'America/New_York',POCKET_SMTP_URL:'file:'+mailFile,POCKET_SMTP_FROM:'pocket@example.test',...extra},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
   if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=41;logs='';return start(extra);}
   throw Error('Test server failed: '+logs);
  };
  const stop=async()=>{if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}};
  t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  const call=async(p,body,h=headers,method)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:method||(body?'POST':'GET'),headers:h,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};};
  const hookLines=()=>fs.existsSync(hookLog)?fs.readFileSync(hookLog,'utf8').trim().split('\n').map(JSON.parse):[];
  const mails=()=>fs.existsSync(mailFile)?fs.readFileSync(mailFile,'utf8').trim().split('\n').map(JSON.parse):[];
  await start();
  // The day-before notices go out at start for the two items set long enough ahead, once each; the items set an hour ago get none.
  for(let i=0;i<60&&hookLines().length<2;i++)await sleep(100);
  await sleep(800);
  let lines=hookLines();assert.equal(lines.length,2,'two notices, once each: '+JSON.stringify(lines));
  const taskNotice=lines.find(l=>l.kind==='task'),remNotice=lines.find(l=>l.kind!=='task');
  assert.equal(taskNotice.text,'Soon, set long ago');assert.equal(taskNotice.ahead,true);assert.equal(taskNotice.url,'/#/tasks');
  assert.equal(remNotice.label,'14-day traffic check');assert.equal(remNotice.ahead,true);assert.equal(remNotice.projectName,'Blog cleanup');
  let sent=mails();assert.equal(sent.length,2);
  assert.deepEqual(sent.map(m=>m.to),['owner@example.test','owner@example.test']);
  assert.ok(sent.some(m=>m.subject==='[Pocket Code] Task due tomorrow: Soon, set long ago'),JSON.stringify(sent.map(m=>m.subject)));
  assert.ok(sent.some(m=>m.subject==='[Pocket Code] Reminder tomorrow: Blog cleanup — 14-day traffic check'));
  assert.doesNotMatch(sent[0].text,/https?:\/\//,'no public address known yet: no link');
  assert.match(logs,/task due tomorrow task=[0-9a-f]{12} push=off hook=yes mail=yes/);assert.match(logs,/reminder due tomorrow project=blog-cleanup .* mail=yes/);
  // Settings: the email block, the notice switch, and an address that is checked.
  let s=await call('/settings');assert.equal(s.status,200);
  assert.deepEqual({configured:s.body.email.configured,from:s.body.email.from,to:s.body.email.to,on:s.body.email.on,hook:s.body.email.hook},{configured:true,from:'pocket@example.test',to:'owner@example.test',on:true,hook:true});
  assert.equal(s.body.remindAhead,24);assert.equal(s.body.email.base,'','the public address is not known yet');
  assert.equal((await call('/settings',{notifyEmail:'nope'})).status,400);
  assert.equal((await call('/settings',{remindAhead:25})).body.remindAhead,24,'only 0 or 24');
  assert.equal((await call('/settings',{remindAhead:0})).body.remindAhead,0);
  assert.equal((await call('/tasks')).body.email,true,'the list says email is on');assert.equal((await call('/board')).body.email,true);
  // The owner's address is learned from a signed-in request through the proxy, never from loopback, and env wins.
  assert.equal((await call('/me')).status,200);assert.equal((await call('/settings')).body.email.base,'','loopback is not a public address');
  assert.equal((await call('/me',null,{...headers,'x-forwarded-host':'pocket.example.test','x-forwarded-proto':'https'})).body.ok,true);
  assert.equal((await call('/settings')).body.email.base,'https://pocket.example.test');
  // The test message, and a due task: hook, mail with the link, once.
  const tested=await call('/notify/test-email',{});assert.equal(tested.status,200);assert.equal(tested.body.to,'owner@example.test');
  sent=mails();assert.equal(sent.at(-1).subject,'[Pocket Code] Test: reminders will arrive like this');assert.match(sent.at(-1).text,/https:\/\/pocket\.example\.test/);
  const due=await call('/tasks/act',{action:'add',text:'Overdue now',dueAt:new Date(Date.now()-60000).toISOString()});assert.equal(due.status,200);
  for(let i=0;i<60&&!hookLines().some(l=>l.text==='Overdue now');i++)await sleep(100);
  await sleep(700);
  lines=hookLines();assert.equal(lines.filter(l=>l.text==='Overdue now').length,1,'announced once');assert.equal(lines.find(l=>l.text==='Overdue now').ahead,undefined);
  sent=mails();const dueMail=sent.find(m=>m.subject==='[Pocket Code] Task due: Overdue now');assert.ok(dueMail,JSON.stringify(sent.map(m=>m.subject)));
  assert.match(dueMail.text,/https:\/\/pocket\.example\.test\/#\/tasks/);assert.match(dueMail.html,/Open Tasks/);
  // A due reminder: mail names the project and the step.
  const p=await call('/board/act',{action:'remind',project:proj.id,at:new Date(Date.now()-60000).toISOString(),text:'Overdue reminder'});assert.equal(p.status,200,JSON.stringify(p.body));
  for(let i=0;i<60&&!mails().some(m=>/Reminder: Blog cleanup — Overdue reminder/.test(m.subject));i++)await sleep(100);
  const remMail=mails().find(m=>/Reminder: Blog cleanup — Overdue reminder/.test(m.subject));assert.ok(remMail);assert.match(remMail.text,/Project: Blog cleanup/);assert.match(remMail.text,/\/#\/projects\/blog-cleanup/);
  // Clearing the address stops the mail but not the hook.
  assert.equal((await call('/settings',{notifyEmail:''})).body.email.on,false);
  const before=mails().length;
  assert.equal((await call('/tasks/act',{action:'add',text:'Quiet',dueAt:new Date(Date.now()-60000).toISOString()})).status,200);
  for(let i=0;i<60&&!hookLines().some(l=>l.text==='Quiet');i++)await sleep(100);
  assert.equal(mails().length,before,'no address, no mail');assert.equal((await call('/notify/test-email',{})).status,400);
  // Push preferences: saved with the subscription, read and changed per device; an old subscription gets everything.
  const ep='https://push.example.test/sub/1';
  let r=await call('/push/subscribe',{subscription:{endpoint:ep,keys:{p256dh:'k',auth:'a'}},prefs:{kinds:{turns:false},badge:false}});
  assert.equal(r.status,200);assert.deepEqual(r.body.prefs,{kinds:{turns:false,reminders:true,vault:true},badge:false});
  r=await call('/push/prefs?endpoint='+encodeURIComponent(ep));assert.deepEqual(r.body.prefs,{kinds:{turns:false,reminders:true,vault:true},badge:false});
  r=await call('/push/prefs',{endpoint:ep,kinds:{reminders:false,bogus:true},badge:true});assert.deepEqual(r.body.prefs,{kinds:{turns:false,reminders:false,vault:true},badge:true});
  assert.equal((await call('/push/prefs?endpoint=https://push.example.test/none')).status,404);
  assert.equal((await call('/push/prefs',{endpoint:'https://push.example.test/none',badge:false})).status,404);
  r=await call('/push/subscribe',{subscription:{endpoint:'https://push.example.test/old',keys:{}}});assert.deepEqual(r.body.prefs,{kinds:{turns:true,reminders:true,vault:true},badge:true},'no prefs given: everything, as before 1.50');
  const subs=JSON.parse(fs.readFileSync(path.join(dir,'data','push-subs.json'),'utf8'));assert.equal(subs.length,2);assert.deepEqual(subs[0].kinds,{turns:false,reminders:false,vault:true});
  assert.equal((await call('/push/prefs?endpoint='+encodeURIComponent(ep),null,{})).status,401,'signed out: nothing');
  assert.equal((await call('/push/unsubscribe',{endpoint:ep})).status,200);assert.equal((await call('/push/prefs?endpoint='+encodeURIComponent(ep))).status,404);
  // No notices without the setting, and the ones already sent stay sent across a restart.
  await stop();
  await start({POCKET_PUBLIC_URL:'https://env.example.test/'});
  assert.equal((await call('/settings')).body.email.base,'https://env.example.test','the environment wins over the learned address');
  await sleep(900);
  assert.equal(hookLines().filter(l=>l.ahead).length,2,'the day-before notices were not repeated');
});
