// 1.42 secret detection: the shared detector (public/secret-detect.js), and the server refusing a message that carries a
// secret before any delivery receipt, unless the owner sends it anyway.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import '../public/secret-detect.js';
const S=globalThis.PocketSecrets;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const kinds=(t,mode)=>S.scan(t,{mode}).map(h=>h.kind);
const found=(t,mode)=>S.scan(t,{mode}).map(h=>t.slice(h.start,h.end));

test('detector: known key formats, private keys, URL passwords, cards and assignments are found exactly',()=>{
  assert.deepEqual(kinds('here is sk-proj-abcDEF1234567890abcdefXYZ thanks'),['openai']);
  assert.deepEqual(found('here is sk-proj-abcDEF1234567890abcdefXYZ thanks'),['sk-proj-abcDEF1234567890abcdefXYZ']);
  assert.deepEqual(kinds('sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123'),['anthropic'],'an Anthropic key is not reported as OpenAI');
  assert.deepEqual(kinds('AKIAIOSFODNN7EXAMPLE then ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789'),['aws','github']);
  assert.deepEqual(kinds('stripe sk_live_51HxAbCdEfGhIjKlMnOp and whsec_AbCdEfGhIjKlMnOpQrStUvWx12'),['stripe','stripe']);
  assert.deepEqual(kinds('xoxb-1234567890-abcdefghij'),['slack']);
  assert.deepEqual(kinds('AIzaSyA1234567890abcdefghijklmnopqrstuv'),['google']);
  assert.deepEqual(kinds('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'),['jwt']);
  assert.deepEqual(kinds('-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAx1y2z3abcdefghijklmnopqrstuvwxyz0123456789\n-----END RSA PRIVATE KEY-----'),['private-key']);
  assert.deepEqual(found('postgres://admin:S3cretPass!@db.example.com/app'),['S3cretPass!'],'only the password inside the URL');
  assert.deepEqual(found('card 4111 1111 1111 1111 exp 12/29'),['4111 1111 1111 1111']);
  assert.deepEqual(found('password: hunter2!'),['hunter2!']);assert.deepEqual(found('my api key is 4f9a2c7e1b'),['4f9a2c7e1b']);
  assert.deepEqual(found('client_secret="Zx9_ab12cd34"'),['Zx9_ab12cd34']);assert.deepEqual(found('pass: hunter2!'),['hunter2!']);
  assert.deepEqual(S.scan('password: hunter2!')[0].vaultKind,'api_key');assert.equal(S.scan('-----BEGIN PRIVATE KEY-----\n'+'A'.repeat(60))[0].vaultKind,'note');
});

test('detector: ordinary text is left alone',()=>{
  for(const t of ['the password is required for login','set the token = true','export TOKEN=$GITHUB_TOKEN','password: <your password>','use {{vault:zoho-books}} for the call',
    'commit 3f2a1b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a fixed it','order 1234567812345670 shipped','call 561-206-4382','id 550e8400-e29b-41d4-a716-446655440000','the pass is open',
    'Xk9#mPq2Lw8vRt5zNb3yHc7d','api_key: ********','sk-short'])
    assert.deepEqual(kinds(t),[],t);
});

test('detector: paste mode also catches a lone random-looking token, but not URLs, paths, UUIDs, commits or words',()=>{
  assert.deepEqual(found('  Xk9#mPq2Lw8vRt5zNb3yHc7d  ','paste'),['Xk9#mPq2Lw8vRt5zNb3yHc7d']);
  assert.deepEqual(kinds('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08','paste'),['random'],'a 64-character hex key');
  for(const t of ['https://example.com/some/long/path/to/a/page?id=12345','/home/ubuntu/projects/pocket-claude/server.mjs','550e8400-e29b-41d4-a716-446655440000',
    '3f2a1b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a','hello world this is normal text','Supercalifragilisticexpialidocious','12345678901234567890','someone@example.com','{{vault:openai-api-key}}'])
    assert.deepEqual(kinds(t,'paste'),[],t);
});

test('detector: overlapping hits keep one, names are unique, and spans are replaced with placeholders',()=>{
  const t='key sk-proj-abcDEF1234567890abcdefXYZ and password: hunter2!';const h=S.scan(t);
  assert.equal(h.length,2);assert.ok(h[0].end<=h[1].start);
  assert.equal(S.uniqueName('openai-api-key',['openai-api-key','openai-api-key-2']),'openai-api-key-3');assert.equal(S.uniqueName('secret',[]),'secret');
  assert.equal(S.replaceSpans(t,h,['openai-api-key','portal-password']),'key {{vault:openai-api-key}} and password: {{vault:portal-password}}');
  assert.equal(S.scan(S.replaceSpans(t,h,['a','b'])).length,0,'the replaced text passes');
  const assign=S.scan('token: sk-proj-abcDEF1234567890abcdefXYZ');assert.equal(assign.length,1,'a key named in an assignment is one hit, not two');
  assert.equal(S.luhn('4111111111111111'),true);assert.equal(S.luhn('4111111111111112'),false);
});

test('HTTP: a message with a secret is held (422, no receipt) unless sent anyway; the guard can be turned off; the log names kinds only',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-secrets-'));let port=19021;
  const secret=randomUUID(),exp=Date.now()+3600000,cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
  fs.mkdirSync(path.join(dir,'sessions','test-workspace'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  let child,logs='';
  const start=async()=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SKILLS:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs')},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
   if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=41;logs='';return start();}
   throw Error('Test server failed: '+logs);
  };
  t.after(async()=>{if(child&&child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  await start();
  const call=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};};
  const calls=()=>fs.existsSync(path.join(dir,'calls'))?fs.readFileSync(path.join(dir,'calls'),'utf8').trim().split('\n').map(JSON.parse):[];
  const KEY='sk-proj-abcDEF1234567890abcdefXYZ';
  assert.equal((await call('/settings')).body.secretGuard,true,'on by default');
  const id=randomUUID();
  let r=await call('/new',{cwd:repo,text:`Use this key: ${KEY}`,provider:'claude',clientMessageId:id});
  assert.equal(r.status,422);assert.equal(r.body.code,'secret_detected');assert.deepEqual(r.body.matches.map(m=>m.kind),['openai']);
  assert.equal(JSON.stringify(r.body).includes(KEY),false,'the answer never echoes the value');
  assert.equal(r.body.matches[0].start,'Use this key: '.length);assert.equal(r.body.matches[0].name,'openai-api-key');
  await sleep(200);assert.equal(calls().length,0,'nothing reached the agent');
  assert.match(logs,/message held: looks like 1 secret\(s\) \(openai\) new session/);assert.equal(logs.includes(KEY),false,'the log never has the value');
  // The same client message id is still free: the placeholder version goes through on it.
  r=await call('/new',{cwd:repo,text:'Use this key: {{vault:openai-api-key}}',provider:'claude',clientMessageId:id});assert.equal(r.status,202,JSON.stringify(r.body));
  for(let i=0;i<60&&!calls().length;i++)await sleep(50);
  const sid=calls().at(-1).id;assert.equal(calls().at(-1).text,'Use this key: {{vault:openai-api-key}}');
  // In a running session too, then sent anyway.
  for(let i=0;i<60&&!/turn done/.test(logs);i++)await sleep(50);
  r=await call(`/session/${sid}/message`,{text:'password: hunter2!',clientMessageId:randomUUID()});assert.equal(r.status,422);assert.deepEqual(r.body.matches.map(m=>m.kind),['assignment']);
  r=await call(`/session/${sid}/message`,{text:'password: hunter2!',allowSecrets:true,clientMessageId:randomUUID()});assert.ok([200,202].includes(r.status),JSON.stringify(r.body));
  for(let i=0;i<60&&calls().length<2;i++)await sleep(50);assert.equal(calls().at(-1).text,'password: hunter2!','sent anyway, as the owner chose');
  // Ordinary text is not held; the setting turns the check off.
  for(let i=0;i<80&&(logs.match(/turn done/g)||[]).length<2;i++)await sleep(50);
  r=await call(`/session/${sid}/message`,{text:'the password is required for login',clientMessageId:randomUUID()});assert.ok([200,202].includes(r.status));
  assert.equal((await call('/settings',{secretGuard:false})).body.secretGuard,false);
  for(let i=0;i<80&&(logs.match(/turn done/g)||[]).length<3;i++)await sleep(50);
  r=await call(`/session/${sid}/message`,{text:`another ${KEY}`,clientMessageId:randomUUID()});assert.ok([200,202].includes(r.status),'with the guard off the message goes through');
  assert.equal((await call('/settings',{secretGuard:true})).body.secretGuard,true);
});
