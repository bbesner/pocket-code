// Casey's 1.88.1 batch, group misc (F-1, F-7, F-13, F-18, F-20, F-21, F-22): one test per item.
// A REAL item's test fails on 1.88.1 and passes once fixed; a NOT-A-FAULT item's test passes and names the guard.
// F-21 is a speed claim: its browser measurement runs only with POCKET_PERF=1 and reports numbers, not a verdict.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {spawn,execFileSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {SideChats} from '../sidechat.mjs';
import {sessionState} from '../session-state.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const appJs=fs.readFileSync(path.join(repo,'public/app.js'),'utf8');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));

// A daemon on a temp data dir with the fake CLI; env adds or overrides (HOME for F-18).
async function daemon(t,port,env={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-c1881-'));
 const secret=randomUUID(),exp=Date.now()+3600000;
 const headers={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
 fs.mkdirSync(path.join(dir,'sessions','test-workspace'),{recursive:true});
 let child,logs='';
 const start=async()=>{
  child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),POCKET_SKILLS:'0',PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),...(typeof env==='function'?env(dir):env)},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
  for(let i=0;i<150;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
  if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=41;logs='';return start();}
  throw Error('Test server failed: '+logs);
 };
 t.after(async()=>{if(child&&child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
 const call=async(p,extra={})=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{headers:{...headers,...extra}});const raw=Buffer.from(await r.arrayBuffer());let body=null;try{body=JSON.parse(raw.toString('utf8'))}catch{}return {status:r.status,body,raw,headers:r.headers};};
 await start();
 const seed=(lines,id=randomUUID())=>{fs.writeFileSync(path.join(dir,'sessions','test-workspace',id+'.jsonl'),lines.map(l=>JSON.stringify(l)).join('\n')+'\n');return id;};
 return {dir,get port(){return port},headers,start,call,seed,logs:()=>logs};
}
const userLine=(text,cwd,id)=>({type:'user',message:{role:'user',content:text},cwd,sessionId:id,uuid:randomUUID(),timestamp:new Date().toISOString()});
const assistantLine=(text,cwd,id)=>({type:'assistant',message:{role:'assistant',model:'claude-test',content:[{type:'text',text}]},cwd,sessionId:id,uuid:randomUUID(),timestamp:new Date().toISOString()});

test('F-1 side chat: event ids keep counting past the 2,000-event window, and a Last-Event-ID reconnect replays exactly the missed events',()=>{
 const sc=new SideChats({bin:'unused',env:{},normalize:x=>x}),chat=sc.make('parent');
 const sse=()=>{const r={text:'',write(s){r.text+=s},end(){}};r.events=()=>[...r.text.matchAll(/id: (\d+)\ndata: (.*)\n\n/g)].map(m=>({id:Number(m[1]),n:JSON.parse(m[2]).n}));return r;};
 // A panel follows the side chat live, as the browser's EventSource does, through 2,100 streamed deltas.
 const live=sse();const off=sc.subscribe(chat,live,0);
 for(let n=0;n<2100;n++)sc.emit(chat,{type:'delta',n});
 const seen=live.events(),last=seen.at(-1);
 assert.equal(new Set(seen.map(e=>e.id)).size,seen.length,`every live event has its own id (ids after the window fills: ${seen.slice(-3).map(e=>e.id)})`);
 // The connection drops; three more events arrive; the browser reconnects with Last-Event-ID = the last id it saw.
 off();for(let n=2100;n<2103;n++)sc.emit(chat,{type:'delta',n});
 const again=sse();sc.subscribe(chat,again,last.id+1); // the route: from = Number(last-event-id) + 1 (server.mjs:3367)
 assert.deepEqual(again.events().map(e=>e.n),[2100,2101,2102],'the reconnect replays the three events it missed, no more and no fewer');
});

// public/app.js clipboardFile, evaluated as the page defines it (it uses only Date and File).
const clipboardFile=new Function(appJs.match(/function clipboardFile\(blob, index=0\) \{[\s\S]*?\n\}\n/)[0]+'return clipboardFile;')();
test('F-7 paste: a pasted image that is not PNG, JPEG, WebP or GIF is not named .png',()=>{
 assert.match(clipboardFile(new Blob(['x'],{type:'image/png'})).name,/\.png$/);assert.match(clipboardFile(new Blob(['x'],{type:'image/jpeg'}),1).name,/-1\.jpg$/);
 for(const type of ['image/heic','image/tiff','image/bmp','image/avif','image/svg+xml']){
  let f=null;try{f=clipboardFile(new Blob(['x'],{type}))}catch{} // refusing the type is an acceptable fix too
  assert.ok(!f||!/\.png$/.test(f.name),`${type} pasted as ${f?.name}: the name says PNG, the bytes are not`);
 }
});

test('F-13 delivery note: kept while the reply works in background (not finished, 1.64) and replaced by the next send',()=>{
 // The fact Casey reports: the note clears only on finished, failed, stopped or ended (public/app.js:1718).
 const clearOn=JSON.parse(appJs.match(/if\(current\?\.state\?\.confirmed&&(\[[^\]]+\])\.includes\(current\.state\.kind\)/)[1].replace(/'/g,'"'));
 assert.deepEqual(clearOn,['finished','failed','stopped','ended']);
 // Background means the reply is still working: the CLI starts a turn by itself when the job ends (session-state.mjs:1-4, server.mjs:1633),
 // and that turn ends finished, failed or stopped, which clears the note. Background outranks the earlier outcome.
 const bg=sessionState({outcome:{kind:'finished',label:'Response ready',at:Date.now()},background:[{task_type:'local_agent',description:'review'}]});
 assert.equal(bg.kind,'background');assert.equal(clearOn.includes(bg.kind),false);
 // The guard on "cannot tell whether a later message was delivered": sending clears the note first (app.js:3385) and sets the new outcome (:3407).
 const send=appJs.slice(appJs.indexOf('async function submitPending'),appJs.indexOf("deliveryNotices.set(id, result.queued"));
 assert.match(send,/sendsInFlight\.add\(id\); deliveryNotices\.delete\(id\); paintDelivery\(id\);[\s\S]*await api\(`\/session\/\$\{id\}\/message`/,'the old note is gone before the next message is sent');
});

test('F-18 Git control: a conversation whose repository is outside home is not offered a Git control that always fails',async t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-c1881-git-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const home=path.join(base,'home'),outside=path.join(base,'srv','app'),inside=path.join(home,'proj');
 for(const d of [home,outside,inside])fs.mkdirSync(d,{recursive:true});
 for(const d of [outside,inside]){execFileSync('git',['init','-q',d]);fs.writeFileSync(path.join(d,'a.txt'),'x\n');}
 const f=await daemon(t,19811,{HOME:home});
 const at=cwd=>{const id=randomUUID();f.seed([userLine('Look at the app',cwd,id),assistantLine('Done.',cwd,id)],id);return id;};
 const ok=at(inside),bad=at(outside);
 // Inside home: detail says repo, and the Git route answers (control shown, works).
 assert.equal((await f.call('/session/'+ok)).body.repo,true);assert.equal((await f.call(`/session/${ok}/workspace`)).status,200);
 const detail=(await f.call('/session/'+bad)).body,git=await f.call(`/session/${bad}/workspace`);
 assert.ok(detail.repo===false||git.status===200,`detail repo=${detail.repo} (public/app.js:2699 shows the Git control), but the Git route answers ${git.status} "${git.body?.error}"`);
});

test('F-20 / picker: a skill whose description is a YAML block or folded scalar is listed with its text, not the indicator',async t=>{
 const ws=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-c1881-skills-'));t.after(()=>fs.rmSync(ws,{recursive:true,force:true}));
 const skill=(name,front)=>{fs.mkdirSync(path.join(ws,'.claude','skills',name),{recursive:true});fs.writeFileSync(path.join(ws,'.claude','skills',name,'SKILL.md'),`---\nname: ${name}\n${front}\n---\n# ${name}\n`);};
 skill('plain','description: Rebrand vendor PDFs.');
 skill('literal','description: |\n  Audit an OpenClaw workspace for cost.\n  Then propose a plan.');
 skill('folded','description: >\n  SecurityCameraKing SEO audit,\n  monitoring and reporting.');
 skill('folded-strip','description: >-\n  Build a site map\n  from RTK exports.\nallowed-tools: Read');
 const f=await daemon(t,19851,{HOME:path.join(ws,'home')});
 const r=await f.call('/commands?cwd='+encodeURIComponent(ws));assert.equal(r.status,200);
 const desc=Object.fromEntries(r.body.commands.map(c=>[c.name,c.desc]));
 assert.equal(desc.plain,'Rebrand vendor PDFs.');
 for(const [name,words] of [['literal','Audit an OpenClaw workspace'],['folded','SecurityCameraKing SEO audit'],['folded-strip','Build a site map']])
  assert.ok(String(desc[name]).includes(words),`${name}: the picker shows ${JSON.stringify(desc[name])}`);
});

test('F-22 list: a conversation titled by a 200 KB first prompt is listed under a capped title, not the whole prompt',async t=>{
 const f=await daemon(t,19891);
 const prompt=Array.from({length:4000},(_,i)=>`Paste line ${i}: inventory row with quantities and notes.`).join(' ').slice(0,200_000);
 const ids=[];for(let i=0;i<10;i++){const id=randomUUID();f.seed([userLine(`Report ${i}. `+prompt,repo,id),assistantLine('Read it.',repo,id)],id);ids.push(id);}
 const t0=performance.now(),full=await f.call('/sessions?limit=200'),fullMs=performance.now()-t0;assert.equal(full.status,200);
 const etag=full.headers.get('etag'),t1=performance.now(),cached=await f.call('/sessions?limit=200',{'if-none-match':etag}),cachedMs=performance.now()-t1;
 const zipped=await f.call('/sessions?limit=200',{'accept-encoding':'gzip'});
 const titles=full.body.sessions.filter(s=>ids.includes(s.id)).map(s=>s.title.length);
 t.diagnostic(`10 conversations: titles ${titles[0]} chars each; list ${full.raw.length} bytes (gzip ${zlib.gzipSync(full.raw,{level:4}).length}); full poll ${fullMs.toFixed(0)} ms, 304 poll ${cachedMs.toFixed(0)} ms (status ${cached.status}); gzip header ${zipped.headers.get('content-encoding')}`);
 assert.equal(titles.length,10);
 assert.ok(Math.max(...titles)<=1000,`a list title is ${Math.max(...titles)} characters, the whole first prompt`);
});

// F-21 measures in Chrome; it starts the real daemon with one long conversation and opens and closes one sheet.
test('F-21 sheet open/close timing with and without app.inert (numbers only; POCKET_PERF=1)',{skip:!process.env.POCKET_PERF&&'set POCKET_PERF=1 to run the Chrome measurement',timeout:600_000},async t=>{
 const {measureSheets}=await import('./casey-1881-sheet-perf.mjs');
 const f=await daemon(t,19931);
 const id=randomUUID(),turns=Number(process.env.POCKET_PERF_TURNS||150),lines=[];
 for(let i=0;i<turns;i++){lines.push(userLine(`Question ${i}: what changed in the stock report for aisle ${i%12}?`,repo,id));
  lines.push(assistantLine(`## Aisle ${i%12}\n\nThe count moved by **${i}** units. Details:\n\n- Received ${i*3}\n- Shipped ${i*2}\n- Adjusted \`${i}\`\n\n| Item | Qty |\n|---|---|\n| A | ${i} |\n| B | ${i+1} |\n\n\`\`\`js\nconst total = ${i} + ${i*2};\n\`\`\`\n\nThat leaves the aisle reconciled.`,repo,id));}
 f.seed(lines,id);
 const rows=await measureSheets({base:`http://127.0.0.1:${f.port}`,cookie:f.headers.cookie.slice('pc_auth='.length),id,runs:Number(process.env.POCKET_PERF_RUNS||5)});
 for(const r of rows)t.diagnostic(r);
});
