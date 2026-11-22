// 1.122.2: the daemon's default data folder is the checkout, so every store it writes there must be git-ignored; a
// careless `git add -A` would otherwise stage private state in a public repository, and update scripts that back up
// ignored files would skip it. The names come from the code (each path.join(DATA_DIR, '<name>') in server.mjs and
// codex.mjs), plus the few built elsewhere, listed below.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const repo=path.resolve(import.meta.dirname,'..');
const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']});
let checkout=false;try{checkout=git('rev-parse','--is-inside-work-tree').trim()==='true';}catch{}

// Written under the data folder by other modules: vault.mjs (audit log next to vault.enc), inbox-runner.mjs, cli-updates.mjs,
// atomic writes' temp files, and local backups of the environment file.
const ELSEWHERE=['vault-audit.jsonl','vault.enc.tmp','router-key.tmp','inbox-watch-data','cli-runtimes','checkbacks.json.tmp','.env','.env.tmp','.env.bak-before-change'];
function fromCode(){
  const names=new Set();
  for(const f of ['server.mjs','codex.mjs'])for(const m of fs.readFileSync(path.join(repo,f),'utf8').matchAll(/path\.join\(DATA_DIR,\s*'([^']+)'/g))names.add(m[1]);
  return [...names];
}

test('1.122.2: every file and folder the daemon writes in its data folder is git-ignored',{skip:!checkout&&'not a git checkout'},()=>{
  const names=[...fromCode(),...ELSEWHERE];
  for(const n of ['job-keys.json','checkbacks.json','automation-state.json','automation-audit.jsonl','cli-token'])assert.ok(names.includes(n),'the list from the code has '+n);
  const ignored=n=>{for(const p of [n,n+'/x']){try{git('check-ignore','-q','--no-index','--',p);return true;}catch{}}return false;}; // a folder's rule matches what is in it
  assert.deepEqual(names.filter(n=>!ignored(n)),[],'add these to .gitignore');
  assert.equal(git('ls-files','-i','-c','--exclude-standard').trim(),'','no tracked file matches an ignore rule');
});
