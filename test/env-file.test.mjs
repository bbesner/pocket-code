// 1.81 (#185): one .env parser for the daemon, the commands and pocket-init. The parser's rules, that nothing else parses
// the file its own way, and a daemon started from a .env with a quoted password and an indented PORT line.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {parseEnv, readEnvFile} from '../env-file.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_|^PORT$/.test(k)));

test('parseEnv: names with digits, leading spaces, quotes stripped, comments and blanks skipped, first non-empty value wins',()=>{
 const e=parseEnv([
  '# a comment','','POCKET_PUBLIC_URL="https://pocket.example.test"',"  POCKET_TZ='America/Chicago'",'VAR_2=two',
  'PORT = 4100 ','POCKET_SECRET=abc=def==','POCKET_NOTE=keep # this','POCKET_SPACED="  padded  "','POCKET_MIXED="half\'',
  'lower=ignored','#POCKET_OFF=1','POCKET_EMPTY=','VAPID_PUBLIC=','VAPID_PUBLIC=later','PORT=9999','CRLF_VALUE=x\r',
 ].join('\n'));
 assert.equal(e.POCKET_PUBLIC_URL,'https://pocket.example.test');assert.equal(e.POCKET_TZ,'America/Chicago');assert.equal(e.VAR_2,'two');
 assert.equal(e.PORT,'4100','spaces around = and value; the first value wins');assert.equal(e.POCKET_SECRET,'abc=def==');
 assert.equal(e.POCKET_NOTE,'keep # this','no inline comments, as before');assert.equal(e.POCKET_SPACED,'  padded  ','quotes keep inner spaces');
 assert.equal(e.POCKET_MIXED,'"half\'','unmatched quotes stay');assert.equal(e.POCKET_EMPTY,'');assert.equal(e.VAPID_PUBLIC,'later','an empty line does not hide a later value');
 assert.equal(e.CRLF_VALUE,'x');assert.ok(!('lower' in e)&&!('POCKET_OFF' in e));
 assert.deepEqual(readEnvFile(''),{});assert.deepEqual(readEnvFile(path.join(os.tmpdir(),'pocket-no-such-env-file')),{});
});

test('the daemon, every command and pocket-init read .env through env-file.mjs and nothing else',()=>{
 const files=['server.mjs',...fs.readdirSync(path.join(repo,'scripts')).filter(f=>/^pocket-.*\.mjs$/.test(f)).map(f=>'scripts/'+f)];
 for(const f of files){
  const src=fs.readFileSync(path.join(repo,f),'utf8');if(!/POCKET_ENV_FILE/.test(src))continue;
  assert.match(src,/from '\.\.?\/env-file\.mjs'/,f+' imports the shared parser');
  assert.doesNotMatch(src,/\[A-Z(0-9)?_\]\+\)\\s\*=|\[A-Z_\]\+\)=/,f+' has no .env regex of its own');
 }
});

test('server: a quoted password and an indented PORT line in .env mean what the commands read',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-envfile-'));const port=18731;let logs='';
 fs.mkdirSync(path.join(dir,'sessions'));
 fs.writeFileSync(path.join(dir,'.env'),`# test install\n  PORT=${port}\nPOCKET_PASSWORD="quoted test pass"\nPOCKET_SECRET='${'a'.repeat(64)}'\n`);
 assert.equal(readEnvFile(path.join(dir,'.env')).POCKET_PASSWORD,'quoted test pass');
 const child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),POCKET_SKILLS:'0',POCKET_ENV_FILE:path.join(dir,'.env'),POCKET_AUTO_TITLES:'0',POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',
  POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs')},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
 t.after(async()=>{if(child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}fs.rmSync(dir,{recursive:true,force:true});});
 for(let i=0;i<150;i++){if(child.exitCode!==null)break;try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)break;}catch{}await sleep(30);}
 assert.equal(child.exitCode,null,'server started on the indented PORT: '+logs);
 const login=pw=>fetch(`http://127.0.0.1:${port}/api/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:pw})}).then(r=>r.status);
 assert.equal(await login('quoted test pass'),200,'the quotes are not part of the password');
 assert.equal(await login('"quoted test pass"'),403);
});
