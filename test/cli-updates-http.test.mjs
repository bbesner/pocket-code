import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHmac} from 'node:crypto';
test('CLI updater routes require browser authentication, reject cross-site writes, and refuse arbitrary install versions',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cli-updates-http-')),repo=path.resolve(import.meta.dirname,'..'),secret='test-only-signing',exp=String(Date.now()+3600000);
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX|CLAUDE)_/.test(k)));
 const child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...env,PORT:'0',POCKET_ENV_FILE:'',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_SKILLS:'0',POCKET_AUTO_TITLES:'0',POCKET_CODEX:'0',POCKET_DATA_DIR:dir,POCKET_SESSION_ROOT:path.join(dir,'sessions'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs')},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}fs.rmSync(dir,{recursive:true,force:true});});
 for(let i=0;i<200&&!output.includes('listening on');i++)await new Promise(r=>setTimeout(r,30));
 const port=output.match(/listening on 127\.0\.0\.1:(\d+)/)?.[1];assert.ok(port,output);const base='http://127.0.0.1:'+port+'/api/cli-updates';
 const headers={cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(exp).digest('hex'),'content-type':'application/json'};
 assert.equal((await fetch(base)).status,401);
 assert.equal((await fetch(base,{headers:{authorization:'Bearer '+fs.readFileSync(path.join(dir,'cli-token'),'utf8').trim()}})).status,401);
 assert.equal((await fetch(base+'/upgrade',{method:'POST',headers:{...headers,origin:'https://outside.test'},body:'{}'})).status,403);
 assert.equal((await fetch(base+'/switch',{method:'POST',headers:{...headers,origin:'https://outside.test'},body:'{}'})).status,403);
 assert.equal((await fetch(base+'/upgrade',{method:'POST',headers:{...headers,'content-type':'text/plain'},body:'{}'})).status,415);
 assert.equal((await fetch(base+'/upgrade',{method:'POST',headers,body:JSON.stringify({selections:[{key:'claude',version:'1.2.3; echo nope'}]})})).status,409);
 const s=await(await fetch(base,{headers})).json();assert.equal(s.hour,4);assert.equal(s.providers[0].canUpgrade,false);assert.equal(s.job,null);assert.equal(fs.existsSync(path.join(dir,'cli-runtimes','state.json')),false,'no automatic install or network check for custom runtime');
});

test('selected binaries survive restart; existing Claude and Codex processes are adopted and change only on the next turn',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cli-update-lifecycle-')),repo=path.resolve(import.meta.dirname,'..'),secret='lifecycle-signing',exp=String(Date.now()+3600000);
 const headers={cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(exp).digest('hex'),'content-type':'application/json'};
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX|CLAUDE)_/.test(k)));
 const runtime=path.join(dir,'data','cli-runtimes'),bin=path.join(dir,'.npm-global','bin');fs.mkdirSync(runtime,{recursive:true});fs.mkdirSync(bin,{recursive:true});
 for(const key of ['claude','codex']){fs.symlinkSync(path.join(repo,'test','fake-'+key+'.mjs'),path.join(bin,key));fs.copyFileSync(path.join(repo,'test','fake-'+key+'.mjs'),path.join(runtime,key+'.mjs'));fs.chmodSync(path.join(runtime,key+'.mjs'),0o700);}
 let child,base;
 const stop=async()=>{if(child?.exitCode===null){child.kill();await once(child,'exit');}};
 const boot=async()=>{let output='';child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...env,HOME:dir,PORT:'0',POCKET_ENV_FILE:'',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_SKILLS:'0',POCKET_AUTO_TITLES:'0',POCKET_CLI_UPDATES:'0',POCKET_DATA_DIR:path.join(dir,'data'),POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_TEST_CALLS:path.join(dir,'calls')},stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);for(let i=0;i<200&&!output.includes('listening on');i++)await new Promise(r=>setTimeout(r,30));const port=output.match(/listening on 127\.0\.0\.1:(\d+)/)?.[1];assert.ok(port,output);base='http://127.0.0.1:'+port;};
 const call=async(p,body)=>{const r=await fetch(base+'/api'+p,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});assert.ok(r.ok,await r.clone().text());return r.json();};
 const idle=async()=>{for(let i=0;i<200;i++){if((await call('/health')).active===0)return;await new Promise(r=>setTimeout(r,30));}assert.fail('not idle');};
 const metas=key=>{const folder=path.join(dir,'data',key==='claude'?'turnlogs':'turnlogs-codex');return fs.readdirSync(folder).filter(f=>f.endsWith(key==='claude'?'.runner.json':'.session.json')).map(f=>JSON.parse(fs.readFileSync(path.join(folder,f),'utf8')));};
 t.after(async()=>{await stop();for(const key of ['claude','codex']){try{for(const m of metas(key))for(const pid of [m.pid,m.keeperPid]){try{process.kill(-pid,'SIGKILL');}catch{}}}catch{}}fs.rmSync(dir,{recursive:true,force:true});});
 await boot();const sessions={};
 for(const key of ['claude','codex']){sessions[key]=(await call('/new',{cwd:dir,provider:key,text:'first message',clientMessageId:crypto.randomUUID()})).id;await idle();}
 const previous=Object.fromEntries(['claude','codex'].map(k=>[k,metas(k)[0]]));
 await call('/session/'+sessions.claude+'/message',{text:'__HANG__ working',clientMessageId:crypto.randomUUID()});
 await stop();
 fs.writeFileSync(path.join(runtime,'state.json'),JSON.stringify({providers:Object.fromEntries(['claude','codex'].map(key=>[key,{active:{bin:path.join(runtime,key+'.mjs'),version:'2.0.0'}}])),job:null}));
 await boot();
 for(const key of ['claude','codex']){
  assert.equal(metas(key)[0].pid,previous[key].pid,'restart must adopt the old process');
  const provider=(await call('/cli-updates')).providers.find(p=>p.key===key);
  assert.equal(provider.olderSessions,1);
  assert.equal(provider.older[0].id,sessions[key]);assert.equal(provider.older[0].busy,key==='claude');
  if(key==='claude'){
   assert.equal((await fetch(base+'/api/cli-updates/switch',{method:'POST',headers,body:JSON.stringify({key,id:sessions[key],interrupt:false})})).status,409,'idle action refuses a running turn');
   assert.equal((await fetch(base+'/api/cli-updates/switch',{method:'POST',headers,body:JSON.stringify({key,id:sessions[key],interrupt:true})})).status,202,'explicit stop interrupts only the selected turn');
   await idle();
  }else assert.equal((await fetch(base+'/api/cli-updates/switch',{method:'POST',headers,body:JSON.stringify({key,id:sessions[key],interrupt:false})})).status,202,'an explicit switch can release an idle process');
  for(let i=0;i<100&&metas(key).some(m=>m.pid===previous[key].pid);i++)await new Promise(r=>setTimeout(r,30));
  assert.equal((await call('/cli-updates')).providers.find(p=>p.key===key).olderSessions,0);
  await call('/session/'+sessions[key]+'/message',{text:'second message',clientMessageId:crypto.randomUUID()});await idle();
  const current=metas(key).find(m=>m.cliBin===path.join(runtime,key+'.mjs'));assert.ok(current,key+' wrote the selected binary to process metadata');assert.notEqual(current.pid,previous[key].pid,'next turn uses a new process');assert.equal(current.cliBin,path.join(runtime,key+'.mjs'));
 }
});
