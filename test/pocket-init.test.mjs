// pocket-init (1.46): the one-command setup. Runs the real script against a temporary .env with a fake claude
// and a fake pm2 on PATH, so nothing here touches the machine's PM2, its .env or a model.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const run=promisify(execFile);
const root=path.resolve(import.meta.dirname,'..');const script=path.join(root,'scripts','pocket-init.mjs');
function sandbox(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-init-'));const bin=path.join(dir,'bin');fs.mkdirSync(bin);
 fs.writeFileSync(path.join(bin,'claude'),`#!/usr/bin/env node
if(process.argv.includes('--version')){console.log('9.9.9 (Claude Code)');process.exit(0);}
if(process.argv[2]==='auth'){console.log(JSON.stringify({loggedIn:process.env.FAKE_SIGNED_OUT!=='1',email:'owner@example.test'}));process.exit(0);}
process.exit(1);`,{mode:0o755});
 fs.writeFileSync(path.join(bin,'pm2'),`#!/usr/bin/env node
const fs=require('node:fs');fs.appendFileSync(process.env.FAKE_PM2_LOG,process.argv.slice(2).join(' ')+'\\n');
if(process.argv[2]==='jlist'){const cwd=process.env.FAKE_PM2_RUNNING;console.log(JSON.stringify(cwd?[{name:'pocket-claude',pm2_env:{status:'online',pm_cwd:cwd}}]:[]));}
process.exit(0);`,{mode:0o755});
 const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET_|CLAUDE_BIN|CODEX|VAPID_|PORT$)/.test(k))),HOME:dir,PATH:bin+path.delimiter+path.dirname(process.execPath),POCKET_ENV_FILE:path.join(dir,'.env'),FAKE_PM2_LOG:path.join(dir,'pm2.log')};
 return {dir,env,envFile:path.join(dir,'.env'),pm2Log:()=>{try{return fs.readFileSync(path.join(dir,'pm2.log'),'utf8');}catch{return '';}}};
}
const init=async(sb,args,extraEnv={})=>{try{const r=await run(process.execPath,[script,...args],{env:{...sb.env,...extraEnv},timeout:60000});return {code:0,out:r.stdout,err:r.stderr};}catch(e){return {code:e.code,out:e.stdout||'',err:e.stderr||''};}};
const freePort=()=>new Promise(r=>{const s=http.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const parseEnv=file=>Object.fromEntries(fs.readFileSync(file,'utf8').split('\n').map(l=>/^([A-Z0-9_]+)=(.*)$/.exec(l)).filter(Boolean).map(m=>[m[1],m[2]]));

test('a dry run reports every check and writes nothing',async()=>{
 const sb=sandbox();const r=await init(sb,['--dry-run','--contact','ops@example.test','--port',String(await freePort())]);
 assert.equal(r.code,0,r.out+r.err);assert.match(r.out,/would create it with: PORT, POCKET_PASSWORD, POCKET_SECRET, VAPID_PUBLIC, VAPID_PRIVATE, VAPID_CONTACT/);
 assert.match(r.out,/Claude Code: 9\.9\.9 \(Claude Code\), signed in as owner@example\.test/);assert.match(r.out,/Dry run complete/);
 assert.ok(!fs.existsSync(sb.envFile));assert.doesNotMatch(sb.pm2Log(),/start|save/);
});
test('a first run writes a complete .env with mode 0600 and keeps the password off a non-terminal stdout',async()=>{
 const sb=sandbox();const r=await init(sb,['--no-start','--contact','ops@example.test','--port','4321']);
 assert.equal(r.code,0,r.out+r.err);
 assert.equal(fs.statSync(sb.envFile).mode&0o777,0o600);
 const e=parseEnv(sb.envFile);
 assert.equal(e.PORT,'4321');assert.ok(e.POCKET_PASSWORD.length>=20);assert.match(e.POCKET_SECRET,/^[0-9a-f]{64}$/);
 assert.match(e.VAPID_PUBLIC,/^[A-Za-z0-9_-]{80,90}$/);assert.match(e.VAPID_PRIVATE,/^[A-Za-z0-9_-]{40,50}$/);assert.equal(e.VAPID_CONTACT,'ops@example.test');
 assert.ok(!r.out.includes(e.POCKET_PASSWORD),'password printed');assert.match(r.out,/not printed here because this is not a terminal/);assert.match(r.out,/grep '\^POCKET_PASSWORD='/);
 assert.match(r.out,/not started \(--no-start\)/);assert.doesNotMatch(sb.pm2Log(),/start/);
 // run again: nothing changes
 const before=fs.readFileSync(sb.envFile,'utf8');const r2=await init(sb,['--no-start']);
 assert.equal(r2.code,0,r2.out);assert.match(r2.out,/already has every required setting/);assert.equal(fs.readFileSync(sb.envFile,'utf8'),before);assert.match(r2.out,/Password: unchanged/);
});
test('--show-password prints a generated password once; POCKET_PASSWORD in the environment chooses it',async()=>{
 const sb=sandbox();const r=await init(sb,['--no-start','--contact','x@example.test','--show-password','--port',String(await freePort())],{POCKET_PASSWORD:'chosen-by-owner-123'});
 assert.equal(r.code,0,r.out+r.err);assert.equal(parseEnv(sb.envFile).POCKET_PASSWORD,'chosen-by-owner-123');assert.match(r.out,/\n\s+chosen-by-owner-123\n/);
});
test('placeholder values from .env.example are replaced in place and other lines are kept',async()=>{
 const sb=sandbox();fs.writeFileSync(sb.envFile,'# mine\nPORT=3999\nPOCKET_PASSWORD=change-me\nPOCKET_SECRET=change-me\nVAPID_PUBLIC=\nVAPID_PRIVATE=\nVAPID_CONTACT=you@example.com\nPOCKET_TZ=America/New_York\n',{mode:0o644});
 const r=await init(sb,['--no-start','--contact','ops@example.test']);
 assert.equal(r.code,0,r.out+r.err);const text=fs.readFileSync(sb.envFile,'utf8');const e=parseEnv(sb.envFile);
 assert.equal(e.PORT,'3999');assert.equal(e.POCKET_TZ,'America/New_York');assert.notEqual(e.POCKET_PASSWORD,'change-me');assert.equal(e.VAPID_CONTACT,'ops@example.test');
 assert.equal((text.match(/^POCKET_PASSWORD=/gm)||[]).length,1);assert.match(text,/^# mine$/m);
 assert.equal(fs.statSync(sb.envFile).mode&0o777,0o600);assert.match(r.out,/Port: 127\.0\.0\.1:3999 is free/);
});
test('a port in use fails before anything is written',async()=>{
 const sb=sandbox();const srv=http.createServer((_q,s)=>s.end('x'));await new Promise(r=>srv.listen(0,'127.0.0.1',r));const port=srv.address().port;
 try{const r=await init(sb,['--port',String(port),'--contact','x@example.test']);assert.equal(r.code,1);assert.match(r.out,/FAIL\s+Port: 127\.0\.0\.1:\d+ is in use/);assert.match(r.out,/--port/);assert.ok(!fs.existsSync(sb.envFile));assert.match(r.out,/not written because a check failed/);}
 finally{srv.close();}
});
test('--port cannot silently move an install whose .env already has a different PORT',async()=>{
 const sb=sandbox();fs.writeFileSync(sb.envFile,'PORT=3610\nPOCKET_PASSWORD=p\nPOCKET_SECRET=s\nVAPID_PUBLIC=a\nVAPID_PRIVATE=b\nVAPID_CONTACT=c@example.test\n');
 const r=await init(sb,['--port','4000','--no-start']);assert.equal(r.code,1);assert.match(r.out,/already sets PORT=3610/);
});
test('a daemon already running from this checkout is left alone and its health is checked',async()=>{
 const sb=sandbox();const srv=http.createServer((_q,s)=>{s.setHeader('content-type','application/json');s.end(JSON.stringify({ok:true,processes:2}));});await new Promise(r=>srv.listen(0,'127.0.0.1',r));const port=srv.address().port;
 fs.writeFileSync(sb.envFile,`PORT=${port}\nPOCKET_PASSWORD=p\nPOCKET_SECRET=s\nVAPID_PUBLIC=a\nVAPID_PRIVATE=b\nVAPID_CONTACT=c@example.test\n`,{mode:0o600});
 try{const r=await init(sb,[],{FAKE_PM2_RUNNING:root});assert.equal(r.code,0,r.out+r.err);assert.match(r.out,/PM2 app: pocket-claude is online from this checkout/);assert.match(r.out,/Health: http:\/\/127\.0\.0\.1:\d+\/api\/health answers ok \(2 session processes\)/);assert.doesNotMatch(sb.pm2Log(),/start|restart/);assert.match(r.out,/Pocket Code is running at/);}
 finally{srv.close();}
});
test('a pocket-claude process from another checkout is a hard stop',async()=>{
 const sb=sandbox();const r=await init(sb,['--no-start','--contact','x@example.test','--port',String(await freePort())],{FAKE_PM2_RUNNING:'/somewhere/else'});
 assert.equal(r.code,1);assert.match(r.out,/already runs from \/somewhere\/else, not this checkout/);assert.ok(!fs.existsSync(sb.envFile));
});
test('a first start runs pm2 start then pm2 save',async()=>{
 const sb=sandbox();const r=await init(sb,['--contact','x@example.test','--port','4567']);
 // the fake pm2 starts nothing, so health fails; the start and save calls are what this checks
 assert.equal(r.code,1,r.out);assert.match(sb.pm2Log(),/^start ecosystem\.config\.cjs\nsave$/m);assert.match(r.out,/Health: .* did not answer within 30 s; see: pm2 logs pocket-claude/);
 assert.equal(fs.statSync(sb.envFile).mode&0o777,0o600);
});
test('--json gives a machine-readable report without the password',async()=>{
 const sb=sandbox();const r=await init(sb,['--no-start','--contact','x@example.test','--json','--port',String(await freePort())]);
 assert.equal(r.code,0,r.out+r.err);const j=JSON.parse(r.out);
 assert.equal(j.ok,true);assert.equal(j.passwordGenerated,true);assert.equal(j.passwordFile,sb.envFile);assert.ok(Array.isArray(j.steps)&&j.steps.length>5);assert.ok(Array.isArray(j.https)&&j.https[0].text);
 assert.ok(!r.out.includes(parseEnv(sb.envFile).POCKET_PASSWORD));
});
test('a signed-out Claude Code is a warning, not a stop; unknown arguments exit 2',async()=>{
 const sb=sandbox();const port=String(await freePort());const r=await init(sb,['--dry-run','--contact','x@example.test','--port',port],{FAKE_SIGNED_OUT:'1'});assert.equal(r.code,0,r.out);assert.match(r.out,/warn\s+Claude Code: .* not signed in/);
 const bad=await init(sb,['--bogus']);assert.equal(bad.code,2);assert.match(bad.err,/Unknown argument: --bogus/);
});
