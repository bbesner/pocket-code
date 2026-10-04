import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {workspaceStatus,workspaceDiff} from '../workspace.mjs';
test('read-only Git view handles staged/working/renamed files and refuses unsafe paths or external tools',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'pocket-git-')),repo=path.join(home,'project');await fs.mkdir(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8'});
 try {
  git('init','-q');git('config','user.email','test@example.com');git('config','user.name','Test');
  await fs.writeFile(path.join(repo,'sample.txt'),'original\n');await fs.writeFile(path.join(repo,'old name.txt'),'rename\n');
  git('add','.');git('commit','-qm','Fixture');
  await fs.writeFile(path.join(repo,'sample.txt'),'staged\n');git('add','sample.txt');await fs.writeFile(path.join(repo,'sample.txt'),'working\n');
  git('mv','old name.txt','new name.txt');await fs.writeFile(path.join(repo,'untracked.txt'),'new\n');await fs.writeFile(path.join(repo,'.env'),'DO_NOT_SHOW=fixture');
  const marker=path.join(home,'executed');git('config','diff.external',`touch ${marker}`);git('config','core.fsmonitor',`touch ${marker}`);
  const status=await workspaceStatus(repo,home);assert.equal(status.readOnly,true);assert.ok(status.files.some(r=>r.path==='new name.txt'&&r.original==='old name.txt'));
  assert.equal(status.files.find(r=>r.path==='.env').inspectable,false);
  assert.match((await workspaceDiff(repo,home,'sample.txt','working')).text,/\+working/);
  assert.match((await workspaceDiff(repo,home,'sample.txt','staged')).text,/\+staged/);
  assert.equal((await workspaceDiff(repo,home,'untracked.txt')).untracked,true);
  for(const file of ['.env','../outside','sample.txt\u0000','--output=evil'])await assert.rejects(()=>workspaceDiff(repo,home,file));
  await fs.mkdir(path.join(home,'elsewhere'));await assert.rejects(()=>workspaceStatus(repo,path.join(home,'elsewhere')),{status:403});
  await assert.rejects(()=>fs.access(marker));
 }finally{await fs.rm(home,{recursive:true,force:true});}
});
