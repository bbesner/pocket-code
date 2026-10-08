import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ClaudeLogin,loginUrl} from '../claude-login.mjs';

const url='https://claude.com/cai/oauth/authorize?state=test-state&code_challenge=test-challenge';
const identity={provider:'claude',signedIn:true,method:'claude.ai',email:'new@example.test',plan:'max'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}) {
  const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null,signalCode:null});
  const calls=[],writes=[];
  child.kill=signal=>{calls.push(signal);child.signalCode=signal;return true;};
  child.stdin.on('data',data=>writes.push(data.toString()));
  const login=new ClaudeLogin({bin:'test-cli',env:{},cwd:'/tmp',identify:async()=>identity,spawnProcess:(...args)=>{calls.push(args);return child;},...options});
  return {login,child,calls,writes};
}

test('login URLs must be complete, provider-owned OAuth authorization URLs',()=>{
  assert.equal(loginUrl('Open '+url+'\n'),url);
  assert.equal(loginUrl('Open '+url),null);
  for(const invalid of [url.replace('claude.com','claude.com.evil.test'),url.replace('claude.com','evil@claude.com'),url.replace('/cai/oauth/authorize','/redirect'),url.replace('https:','http:'),url.replace('state=','other=')]) assert.equal(loginUrl(invalid+'\n'),null);
});

test('one flow handles split output, passes codes only over stdin and verifies identity',async()=>{
  let prepared=0,completed=0;
  const {login,child,calls,writes}=fixture({prepare:()=>prepared++,onSuccess:()=>completed++});
  const started=login.start();assert.equal(login.start().id,started.id);assert.equal(prepared,1);assert.equal(calls.length,1);
  child.stdout.write('Open '+url.slice(0,35));assert.equal(login.snapshot().status,'starting');
  child.stdout.write(url.slice(35)+'\nPrivate terminal output');assert.equal(login.snapshot().status,'waiting');
  assert.throws(()=>login.submit('stale','code'),/no longer/);
  assert.throws(()=>login.submit(started.id,'one\ntwo'),/only the code/);
  assert.throws(()=>login.submit(started.id,url),/only the code/);
  login.submit(started.id,'  test-code#test-state  ');
  assert.deepEqual(writes,['test-code#test-state\n']);assert.equal(login.snapshot().url,null);
  assert.throws(()=>login.submit(started.id,'duplicate'),/no longer/);
  child.exitCode=0;child.emit('close',0);await tick();
  assert.equal(login.snapshot().status,'success');assert.deepEqual(login.snapshot().account,identity);assert.equal(completed,1);
  assert.doesNotMatch(JSON.stringify(login.snapshot()),/test-code|Private terminal|output/);
});

test('busy work is preserved, cancellation invalidates old codes and expiry kills the child',async()=>{
  const busy=fixture({busy:()=>true});assert.throws(()=>busy.login.start(),/still working/);assert.equal(busy.calls.length,0);
  const {login,child,calls}=fixture({timeoutMs:20});const started=login.start();child.stdout.write(url+'\n');
  login.cancel(started.id);assert.equal(login.active,false);assert.equal(login.snapshot().url,null);assert.ok(calls.includes('SIGTERM'));
  assert.throws(()=>login.submit(started.id,'code'),/no longer/);
  const fresh=login.start();assert.notEqual(fresh.id,started.id);assert.throws(()=>login.cancel(started.id),/already ended/);
  await new Promise(resolve=>setTimeout(resolve,35));assert.equal(login.snapshot().status,'expired');
});

test('errors never expose CLI output and zero exit without verified login is not success',async()=>{
  const {login,child}=fixture({identify:async()=>({...identity,signedIn:false})});
  login.start();child.stderr.write('accessToken=do-not-expose\n');child.exitCode=0;child.emit('close',0);await tick();
  assert.equal(login.snapshot().status,'error');assert.doesNotMatch(JSON.stringify(login.snapshot()),/do-not-expose/);
  const broken=fixture();broken.login.start();broken.child.emit('error',new Error('private path or credential'));
  assert.equal(broken.login.snapshot().status,'error');assert.doesNotMatch(JSON.stringify(broken.login.snapshot()),/private path/);
  const apiKey=fixture({identify:async()=>({...identity,method:'api_key'})});apiKey.login.start();apiKey.child.exitCode=0;apiKey.child.emit('close',0);await tick();
  assert.equal(apiKey.login.snapshot().status,'error');assert.match(apiKey.login.snapshot().message,/API credentials/);
});

test('a late verification result cannot complete a cancelled or replacement flow',async()=>{
  let resolveIdentity;
  const {login,child}=fixture({identify:()=>new Promise(resolve=>{resolveIdentity=resolve;})});
  const started=login.start();child.exitCode=0;child.emit('close',0);login.cancel(started.id);resolveIdentity(identity);await tick();
  assert.equal(login.snapshot().status,'cancelled');assert.equal(login.snapshot().account,null);
});

test('authenticated HTTP login: CSRF, privacy, reconnect, turn gate, completion and cancellation',async context=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-login-test-'));
  const repo=path.resolve(import.meta.dirname,'..'),secret=randomUUID(),expires=Date.now()+3600000;
  const cookie='pc_auth='+expires+'.'+createHmac('sha256',secret).update(String(expires)).digest('hex');
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('POCKET_')&&!key.startsWith('VAPID_')&&!key.startsWith('ANTHROPIC_')&&!key.startsWith('CLAUDE_')));
  let child,logs='',base;
  const boot=async()=>{
    let startup='';
    child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...env,PORT:'0',POCKET_ENV_FILE:'',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_AUTO_TITLES:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_CONFIG_DIR:path.join(dir,'config'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs')},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',data=>{logs+=data;startup+=data;});child.stderr.on('data',data=>{logs+=data;startup+=data;});
    for(let attempt=0;attempt<150&&!startup.includes('listening on');attempt++)await new Promise(resolve=>setTimeout(resolve,40));
    const port=startup.match(/listening on 127\.0\.0\.1:(\d+)/)?.[1];assert.ok(port,startup);base='http://127.0.0.1:'+port;
  };
  context.after(async()=>{child.kill('SIGTERM');if(child.exitCode===null&&child.signalCode===null)await once(child,'exit');fs.rmSync(dir,{recursive:true,force:true,maxRetries:10});});
  await boot();
  const request=async(route,body,headers={})=>fetch(base+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{cookie,'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const waitIdle=async()=>{for(let attempt=0;attempt<150;attempt++){const health=await (await request('health')).json();if(health.active===0)return;await new Promise(resolve=>setTimeout(resolve,40));}assert.fail('turn did not finish');};
  assert.equal((await fetch(base+'/api/claude/login')).status,401);
  assert.equal((await request('claude/login/start',{}, {cookie:''})).status,401);
  assert.equal((await request('claude/login/start',{}, {'sec-fetch-site':'cross-site'})).status,403);
  assert.equal((await request('claude/login/start',{}, {'content-type':'text/plain'})).status,403);
  const background=await (await request('new',{cwd:dir,text:'__BG_LONG__ __SLOW__'})).json();assert.ok(background.id);
  assert.equal((await request('claude/login/start',{})).status,409);
  await waitIdle();
  const runnerFile=()=>path.join(dir,'data','turnlogs',fs.readdirSync(path.join(dir,'data','turnlogs')).find(file=>file.startsWith(background.id)&&file.endsWith('.runner.json')));
  const originalRunner=JSON.parse(fs.readFileSync(runnerFile(),'utf8'));assert.equal(originalRunner.bgTasks.length,1);
  const started=await (await request('claude/login/start',{})).json();assert.ok(started.id);
  assert.equal(JSON.parse(fs.readFileSync(runnerFile(),'utf8')).accountStale,true);process.kill(originalRunner.pid,0);
  assert.equal((await (await request('claude/login/start',{})).json()).id,started.id);
  let state;
  for(let attempt=0;attempt<100;attempt++){const response=await request('claude/login');assert.match(response.headers.get('cache-control'),/no-store/);state=await response.json();if(state.status==='waiting')break;await new Promise(resolve=>setTimeout(resolve,20));}
  assert.equal(state.status,'waiting');assert.equal(state.id,started.id);
  const blocked=await request('new',{cwd:dir,text:'Should not reach a model',provider:'claude'});assert.equal(blocked.status,409);
  assert.equal((await request('claude/login/code',{id:started.id,code:'one\ntwo'})).status,400);
  const invalid=await fetch(base+'/api/claude/login/code',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{"code":"private-test-code",bad-json}'});assert.equal(invalid.status,400);
  assert.equal((await request('claude/login/code',{id:started.id,code:'test-code#test-state'})).status,200);
  for(let attempt=0;attempt<100;attempt++){state=await (await request('claude/login')).json();if(state.status==='success')break;await new Promise(resolve=>setTimeout(resolve,20));}
  assert.equal(state.status,'success');assert.equal(state.account.email,'owner@example.test');assert.equal(state.url,null);
  const previous=child,exited=once(previous,'exit');previous.kill('SIGTERM');await exited;await boot();
  const adopted=JSON.parse(fs.readFileSync(runnerFile(),'utf8'));assert.equal(adopted.pid,originalRunner.pid);assert.equal(adopted.accountStale,true);process.kill(originalRunner.pid,0);
  const held=await request('session/'+background.id+'/message',{text:'Use the new account'});assert.equal(held.status,409);assert.match((await held.json()).error,/background jobs/);
  assert.equal((await request('new',{cwd:dir,text:'A fresh session can use the new account'})).status,202);await waitIdle();
  fs.appendFileSync(runnerFile().replace('.runner.json','.out.ndjson'),JSON.stringify({type:'system',subtype:'background_tasks_changed',tasks:[]})+'\n');
  for(let attempt=0;attempt<100&&JSON.parse(fs.readFileSync(runnerFile(),'utf8')).bgTasks.length;attempt++)await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal((await request('session/'+background.id+'/message',{text:'Background job finished; refresh this session login'})).status,202);await waitIdle();
  const refreshed=JSON.parse(fs.readFileSync(runnerFile(),'utf8'));assert.notEqual(refreshed.pid,originalRunner.pid);assert.equal(refreshed.accountStale,false);
  const next=await (await request('claude/login/start',{})).json();assert.notEqual(next.id,started.id);
  assert.equal((await request('claude/login/code',{id:started.id,code:'old'})).status,409);
  const cancel=await (await request('claude/login/cancel',{id:next.id})).json();assert.equal(cancel.status,'cancelled');
  assert.equal((await request('session/'+background.id+'/release',{stop:true})).status,200);
  assert.doesNotMatch(logs,/test-code|private-test-code|code_challenge/);
});
