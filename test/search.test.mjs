// 1.22 search across conversations: helpers, MemStem-backed search with a stand-in MemStem, and Pocket's own
// fallback. Fake CLIs and a fake MemStem only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {sessionIdFromRef,bestSnippet,queryTerms,cleanMemstemSnippet} from '../search.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));

test('MemStem transcript refs map to Pocket session ids only inside Pocket\'s own stores',()=>{
  const roots={projectsRoot:'/h/.claude/projects',codexSessionsRoot:'/h/.codex/sessions'};
  const id='57292309-2ca2-4d91-aeaa-732ee83fe230',cx='01a112c7-9b28-7ff0-a6c5-f99ec55567da';
  assert.equal(sessionIdFromRef(`/h/.claude/projects/-home-ubuntu/${id}.jsonl`,roots),id);
  assert.equal(sessionIdFromRef(`/h/.codex/sessions/2026/10/06/rollout-2026-10-06T19-53-53-${cx}.jsonl`,roots),'cx:'+cx);
  assert.equal(sessionIdFromRef(`/h/.claude/projects/-home-ubuntu/${id}/subagents/agent-1.jsonl`,roots),null,'subagent transcripts are not sessions');
  assert.equal(sessionIdFromRef(`/h/ari/codex-home/sessions/2026/10/06/rollout-x-${cx}.jsonl`,roots),null,'another Codex home is not Pocket\'s');
  assert.equal(sessionIdFromRef('/etc/passwd',roots),null);assert.equal(sessionIdFromRef(undefined,roots),null);
});

test('bestSnippet picks the passage with the most query words and says who wrote it',()=>{
  const md='---\ntitle: x\n---\n\n**User:** please check the camera firmware\n\n**Assistant:** The Avigilon H6A cameras run firmware 5.2. The quote for Trump Towers is ready.\n\n**User:** thanks';
  assert.deepEqual(bestSnippet(md,'Avigilon quote Trump'),{role:'assistant',text:'The Avigilon H6A cameras run firmware 5.2. The quote for Trump Towers is ready.'});
  assert.equal(bestSnippet(md,'firmware').role,'user','the earliest best passage wins ties');
  assert.equal(bestSnippet(md,'reranker'),null,'no word in the text: the session matched by meaning');
  assert.deepEqual(queryTerms('a  Trump-Towers, quote!'),['trump-towers','quote']);
  assert.equal(cleanMemstemSnippet('**User:** hello **Assistant:** hi'),'hello hi');
  const long='**Assistant:** '+'word '.repeat(200)+'needle '+'word '.repeat(200);
  const s=bestSnippet(long,'needle');assert.ok(s.text.startsWith('…')&&s.text.endsWith('…')&&s.text.includes('needle')&&s.text.length<260);
});

async function fixture(t,port,env,{memstem}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-search-'));let logs='';
  const secret=randomUUID(),exp=Date.now()+3600000;
  const headers={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
  const ws=path.join(dir,'sessions','test-workspace');fs.mkdirSync(ws,{recursive:true});
  const seed=(lines)=>{const id=randomUUID();fs.writeFileSync(path.join(ws,id+'.jsonl'),lines.map((o,i)=>JSON.stringify({...o,cwd:repo,sessionId:id,timestamp:new Date(Date.now()-(lines.length-i)*60000).toISOString()})).join('\n')+'\n');return id;};
  const child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,
    POCKET_CODEX:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),
    CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),...env},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
  t.after(async()=>{if(child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}fs.rmSync(dir,{recursive:true,force:true});});
  for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)break;}catch{} await sleep(30);}
  const call=async p=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{headers});return {status:r.status,body:await r.json()};};
  return {dir,ws,seed,call,logs:()=>logs};
}

test('HTTP: MemStem-backed search maps hits to sessions, takes snippets from the vault and labels related matches',async t=>{
  const vault=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-vault-'));fs.mkdirSync(path.join(vault,'sessions'));
  let ms,queries=[];
  ms=http.createServer(async(req,res)=>{
    if(req.url==='/health'){res.end(JSON.stringify({status:'ok',vault}));return;}
    let raw='';for await(const c of req)raw+=c;queries.push(JSON.parse(raw));
    res.end(JSON.stringify(ms.hits||[]));
  });
  await new Promise(r=>ms.listen(0,'127.0.0.1',r));
  t.after(()=>{ms.close();fs.rmSync(vault,{recursive:true,force:true});});
  const f=await fixture(t,18741,{POCKET_MEMSTEM_URL:`http://127.0.0.1:${ms.address().port}/`});
  const a=f.seed([{type:'user',message:{role:'user',content:'Review the Avigilon quote for Trump Towers'}},{type:'assistant',message:{role:'assistant',content:[{type:'text',text:'The quote is ready.'}]}}]);
  const b=f.seed([{type:'user',message:{role:'user',content:'Plan the camera layout for the north lot'}}]);
  fs.writeFileSync(path.join(vault,'sessions',a+'.md'),'---\ntitle: x\n---\n\n**User:** Review the Avigilon quote for Trump Towers\n\n**Assistant:** The quote is ready.\n');
  fs.writeFileSync(path.join(vault,'sessions',b+'.md'),'**User:** Plan the camera layout for the north lot\n');
  const ref=id=>path.join(f.ws,id+'.jsonl');
  ms.hits=[
    {type:'session',path:`sessions/${a}.md`,snippet:'**User:** Review the Avigilon quote',frontmatter:{provenance:{ref:ref(a)}}},
    {type:'session',path:`sessions/${a}.md`,frontmatter:{provenance:{ref:ref(a)}}},                                   // a repeat of the same session
    {type:'session',path:'../../etc/passwd',snippet:'**User:** Plan the camera layout for the north lot',frontmatter:{provenance:{ref:ref(b)}}}, // unsafe vault path: use MemStem's snippet
    {type:'session',path:'sessions/other.md',frontmatter:{provenance:{ref:'/somewhere/else.jsonl'}}},
  ];
  const r=await f.call('/search?q='+encodeURIComponent('Avigilon quote'));
  assert.equal(r.status,200);assert.equal(r.body.backend,'memstem');
  assert.deepEqual(queries.at(-1),{query:'Avigilon quote',limit:30,types:['session']});
  assert.deepEqual(r.body.results.map(x=>x.id),[a,b],'MemStem order, one row per session, foreign transcripts dropped');
  assert.equal(r.body.results[0].role,'user');assert.match(r.body.results[0].snippet,/Avigilon quote for Trump Towers/);assert.equal(r.body.results[0].related,false);
  assert.equal(r.body.results[0].title,'Review the Avigilon quote for Trump Towers');
  assert.equal(r.body.results[1].related,true,'no word matched: shown as related');assert.equal(r.body.results[1].snippet,'Plan the camera layout for the north lot');
  assert.equal((await f.call('/search?q=ab')).status,400);
  assert.equal((await fetch(`http://127.0.0.1:18741/api/search?q=abc`)).status,401);
  // MemStem down: Pocket's own search answers instead.
  ms.close();ms.closeAllConnections?.();await sleep(100);
  const down=await f.call('/search?q='+encodeURIComponent('north lot'));
  assert.equal(down.body.backend,'pocket');assert.deepEqual(down.body.results.map(x=>x.id),[b]);
  assert.match(f.logs(),/memstem search failed, using Pocket's own/);
});

test('HTTP: without MemStem, Pocket finds an exact phrase in recent conversations and reports its scope',async t=>{
  const f=await fixture(t,18771,{POCKET_MEMSTEM:'0'});
  const a=f.seed([{type:'user',message:{role:'user',content:'Check the firmware'}},{type:'assistant',message:{role:'assistant',content:[{type:'text',text:'Camera 7 runs firmware 5.2.1 and needs the update.'}]}}]);
  f.seed([{type:'user',message:{role:'user',content:'Unrelated stock question'}}]);
  const r=await f.call('/search?q='+encodeURIComponent('firmware 5.2.1'));
  assert.equal(r.body.backend,'pocket');assert.equal(r.body.complete,true);assert.equal(r.body.scanned,2);assert.equal(r.body.total,2);
  assert.deepEqual(r.body.results.map(x=>[x.id,x.role]),[[a,'assistant']]);assert.match(r.body.results[0].snippet,/firmware 5\.2\.1/);
  assert.deepEqual((await f.call('/search?q='+encodeURIComponent('no such phrase anywhere'))).body.results,[]);
});
