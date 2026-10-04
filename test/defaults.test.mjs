import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');

async function server(t,port,extraEnv){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-defaults-'));
 const secret=randomUUID(),exp=Date.now()+3600000;
 const headers={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
 let logs='';
 const child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...process.env,PORT:String(port),POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),...extraEnv(dir)},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
 t.after(async()=>{if(child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}fs.rmSync(dir,{recursive:true,force:true});});
 for(let i=0;;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)break;}catch{} if(i>100)throw Error('Test server failed: '+logs);await sleep(30);}
 const call=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()}};
 const calls=()=>fs.existsSync(path.join(dir,'calls'))?fs.readFileSync(path.join(dir,'calls'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 return {dir,call,calls,logs:()=>logs};
}

test('Pocket-only model, effort and workspace defaults',async t=>{
 const s=await server(t,18371,dir=>({POCKET_CLAUDE_MODEL:'claude-opus-5-5[1m]',POCKET_CLAUDE_EFFORT:'high',POCKET_CODEX_MODEL:'gpt-6-sol',POCKET_CODEX_EFFORT:'medium',POCKET_DEFAULT_CWD:dir}));
 const models=(await s.call('/claude/models')).body;
 assert.equal(models.defaultLabel,'Opus 5.5');assert.equal(models.defaultEffort,'high');assert.equal(models.pocketDefault,true);
 const cx=(await s.call('/codex/models')).body;
 assert.deepEqual([cx.defaultModel,cx.defaultEffort,cx.pocketDefault],['gpt-6-sol','medium',true]);
 const projects=(await s.call('/projects')).body;
 assert.equal(projects.defaultCwd,s.dir);assert.equal(projects.projects[0],s.dir,'default workspace is listed first');
 // Default turn gets the Pocket defaults; an explicit pick still wins.
 const a=await s.call('/new',{cwd:repo,text:'Default turn',clientMessageId:randomUUID()});assert.equal(a.status,202);
 await sleep(700);
 const b=await s.call(`/session/${a.body.id}/message`,{text:'Explicit turn',model:'claude-sonnet-5',effort:'low',clientMessageId:randomUUID()});assert.equal(b.status,202);
 await sleep(700);
 assert.deepEqual(s.calls().map(c=>[c.text,c.model,c.effort]),[['Default turn','claude-opus-5-5[1m]','high'],['Explicit turn','claude-sonnet-5','low']]);
});

test('Unset or invalid defaults fall back to the CLI configuration',async t=>{
 const s=await server(t,18372,()=>({POCKET_CLAUDE_MODEL:'opus-latest',POCKET_CLAUDE_EFFORT:'extreme',POCKET_DEFAULT_CWD:'/no/such/dir'}));
 const models=(await s.call('/claude/models')).body;
 assert.equal(models.defaultEffort,null);assert.equal(models.pocketDefault,false);
 assert.equal((await s.call('/projects')).body.defaultCwd,null);
 const a=await s.call('/new',{cwd:repo,text:'CLI default turn',clientMessageId:randomUUID()});assert.equal(a.status,202);
 await sleep(700);
 assert.deepEqual(s.calls().map(c=>[c.model,c.effort]),[[null,null]]);
 assert.match(s.logs(),/POCKET_CLAUDE_MODEL=opus-latest is not a supported value/);
});
