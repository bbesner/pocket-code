import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {syncSkills,renderSkill,skillRoots,MARKER} from '../skills.mjs';
import {projectInstructions} from '../projects.mjs';
import {documentInstructions} from '../documents.mjs';

const repo=path.resolve(import.meta.dirname,'..');
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pocket-skills-'));
const commands={board:'/srv/pocket/scripts/pocket-board.mjs',docs:'/srv/pocket/scripts/pocket-docs.mjs'};

test('skills: installed while the feature is on, rewritten with this server\'s command, removed when off, never over a user\'s own skill',t=>{
  const dir=tmp();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const claude=path.join(dir,'claude'),codex=path.join(dir,'codex'),roots=[claude,codex],env={};
  let r=syncSkills({settings:{projects:true,documents:false},commands,env,roots});
  assert.deepEqual(r.installed.sort(),[path.join(claude,'pocket-projects'),path.join(codex,'pocket-projects')].sort());
  const body=fs.readFileSync(path.join(claude,'pocket-projects','SKILL.md'),'utf8');
  assert.match(body,/^---\nname: pocket-projects\n/);
  assert.match(body,/run `pocket-board` as `node \/srv\/pocket\/scripts\/pocket-board\.mjs`/);
  assert.doesNotMatch(body,/npx pocket-board/,'the repository wording is replaced');
  assert.ok(fs.existsSync(path.join(claude,'pocket-projects',MARKER)));
  assert.equal(fs.existsSync(path.join(claude,'pocket-files')),false);
  // Unchanged content is not rewritten; turning Files on adds its skill.
  assert.deepEqual(syncSkills({settings:{projects:true},commands,env,roots}).installed,[]);
  r=syncSkills({settings:{projects:true,documents:true},commands,env,roots});
  assert.equal(r.installed.length,2);
  assert.match(fs.readFileSync(path.join(codex,'pocket-files','SKILL.md'),'utf8'),/my documents/);
  // A user's own skill with the same name is left alone, both ways.
  fs.rmSync(path.join(codex,'pocket-files'),{recursive:true});fs.mkdirSync(path.join(codex,'pocket-files'));fs.writeFileSync(path.join(codex,'pocket-files','SKILL.md'),'mine');
  r=syncSkills({settings:{projects:true,documents:true},commands,env,roots});
  assert.deepEqual(r.skipped,[path.join(codex,'pocket-files')]);
  syncSkills({settings:{projects:false,documents:false},commands,env,roots});
  assert.equal(fs.readFileSync(path.join(codex,'pocket-files','SKILL.md'),'utf8'),'mine');
  assert.equal(fs.existsSync(path.join(claude,'pocket-projects')),false);
  assert.equal(fs.existsSync(path.join(claude,'pocket-files')),false);
  // POCKET_SKILLS=0 does nothing at all.
  assert.deepEqual(syncSkills({settings:{projects:true,documents:true},commands,env:{POCKET_SKILLS:'0'},roots}),{installed:[],removed:[],skipped:[]});
  assert.equal(fs.existsSync(path.join(claude,'pocket-projects')),false);
});

test('skills: roots follow HOME, CLAUDE_CONFIG_DIR and CODEX_HOME; Codex only where it exists',()=>{
  const dir=tmp();
  try{
   assert.deepEqual(skillRoots({HOME:dir}),[path.join(dir,'.claude','skills')]);
   fs.mkdirSync(path.join(dir,'.codex'));
   assert.deepEqual(skillRoots({HOME:dir}),[path.join(dir,'.claude','skills'),path.join(dir,'.codex','skills')]);
   assert.deepEqual(skillRoots({HOME:dir,CLAUDE_CONFIG_DIR:path.join(dir,'cc'),CODEX_HOME:path.join(dir,'none')}),[path.join(dir,'cc','skills')]);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('skills and agent lines: every name for the library maps to Files; projects ask little and remind only on request',()=>{
  const files=fs.readFileSync(path.join(repo,'skills','pocket-files','SKILL.md'),'utf8'),projects=fs.readFileSync(path.join(repo,'skills','pocket-projects','SKILL.md'),'utf8');
  for(const phrase of ['files','my files','documents','my documents','docs'])assert.ok(files.toLowerCase().includes(phrase),phrase);
  assert.match(files,/Settings → Projects & files → Files/);
  assert.match(projects,/at most one short question/);assert.match(projects,/Never add a reminder by default/);assert.match(projects,/--requested/);
  assert.match(renderSkill('a\n<!-- pocket:commands -->\nold\n<!-- /pocket:commands -->\nb','/x/c.mjs','pocket-docs'),/^a\n<!-- pocket:commands -->\nOn this server, run `pocket-docs` as `node \/x\/c\.mjs`\..*\n<!-- \/pocket:commands -->\nb$/s);
  const d=documentInstructions('/x/pocket-docs.mjs','s1');
  for(const phrase of ['files, my files, documents, my documents or docs','pocket-files skill','add <path> --session s1'])assert.ok(d.includes(phrase),phrase);
  const p=projectInstructions('/x/pocket-board.mjs','s1');
  for(const phrase of ['pocket-projects skill','status --all','track --requested','at most one question'])assert.ok(p.includes(phrase),phrase);
});

test('HTTP: turning Projects and Files on in Settings installs their skills for this user; off removes them',async t=>{
  const dir=tmp(),home=path.join(dir,'home');fs.mkdirSync(path.join(home,'.codex'),{recursive:true});fs.mkdirSync(path.join(dir,'data'));fs.mkdirSync(path.join(dir,'sessions'));
  const secret=randomUUID(),exp=Date.now()+3600000,cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET_|CLAUDE_CONFIG_DIR$|CODEX_HOME$)/.test(k)));
  let port=19511,child,logs='';
  const start=async()=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...env,HOME:home,PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data')}});
   child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)return;}catch{} await sleep(30);}
   if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=37;logs='';return start();}
   throw Error('Test server failed: '+logs);
  };
  t.after(async()=>{if(child?.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}fs.rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});});
  await start();
  const set=body=>fetch(`http://127.0.0.1:${port}/api/settings`,{method:'POST',headers:{'content-type':'application/json',cookie:'pc_auth='+cookie},body:JSON.stringify(body)}).then(r=>r.json());
  const has=(root,name)=>fs.existsSync(path.join(home,root,'skills',name,'SKILL.md'));
  assert.equal(has('.claude','pocket-projects'),false,'nothing while both features are off');
  await set({projects:true,documents:true});
  for(const root of ['.claude','.codex'])for(const name of ['pocket-projects','pocket-files'])assert.ok(has(root,name),root+'/'+name);
  assert.match(fs.readFileSync(path.join(home,'.claude','skills','pocket-files','SKILL.md'),'utf8'),new RegExp('node '+path.join(repo,'scripts','pocket-docs.mjs').replace(/[.*+?^${}()|[\]\\/]/g,'\\$&')));
  await set({documents:false});
  assert.equal(has('.claude','pocket-files'),false);assert.ok(has('.claude','pocket-projects'));
});
