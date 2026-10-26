// The manual's drift check: page metadata, structure rules and git drift, in a throwaway repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseMeta,slug,anchors,checkStructure,drift} from '../scripts/check-manual.mjs';

const repo=path.resolve(import.meta.dirname,'..');
const meta=(checked,sources)=>`<!-- manual\nchecked: ${checked}\nsources: ${sources}\n-->\n`;
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-manual-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const put=(name,text)=>{fs.mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});fs.writeFileSync(path.join(dir,name),text);};
  put('package.json',JSON.stringify({version:'1.2.0'}));
  put('CHANGELOG.md','# Changelog\n\n## [1.2.0] — x\n\n## [1.1.0] — x\n\n## [1.0.0] — x\n');
  put('vault.mjs','v1\n');put('tasks.mjs','t1\n');
  put('docs/manual/README.md','# Manual\n\n- [Vault](vault.md)\n- [Tasks](tasks.md#add-a-task)\n');
  put('docs/manual/vault.md',meta('1.1.0','vault.mjs')+'# Vault\n\n## Turn it on\n\nSee [Tasks](tasks.md#add-a-task).\n');
  put('docs/manual/tasks.md',meta('1.2.0','tasks.mjs')+'# Tasks\n\n## Add a task\n');
  const git=(...a)=>execFileSync('git',a,{cwd:dir,encoding:'utf8'}).trim();
  git('init','-q','-b','main');git('config','user.email','t@example.com');git('config','user.name','t');git('config','commit.gpgsign','false');
  git('add','.');git('commit','-qm','start');
  return {dir,put,git};
}

test('parseMeta reads the block at the top of a page and nothing else',()=>{
  assert.deepEqual(parseMeta(meta('1.79.2','a.mjs, public/a.js ,skills/a/')+'# A\n'),{checked:'1.79.2',sources:['a.mjs','public/a.js','skills/a/']});
  assert.equal(parseMeta('# A\n\n'+meta('1.0.0','a.mjs')),null,'only as the opening lines');
});

test('heading anchors follow GitHub: punctuation dropped, repeats numbered, code fences ignored',()=>{
  assert.equal(slug('Turn it on'),'turn-it-on');
  assert.equal(slug('`pocket-board` reference'),'pocket-board-reference');
  assert.equal(slug('Voice mode (beta)'),'voice-mode-beta');
  assert.equal(slug('Settings → Connectors'),'settings--connectors');
  assert.deepEqual([...anchors('# A\n## Use it\n## Use it\n```\n## Not a heading\n```\n')],['a','use-it','use-it-1']);
});

test('structure: a clean manual passes and reports how old its oldest page is',t=>{
  const {dir}=fixture(t);
  const s=checkStructure(dir);
  assert.deepEqual(s.problems,[]);
  assert.equal(s.pages.length,2);
  assert.equal(s.oldest,1,'vault.md was checked one release back');
});

test('structure: missing block, unknown or future version, missing source, unlinked page and dead anchor are all caught',t=>{
  const {dir,put}=fixture(t);
  put('docs/manual/files.md','# Files\n');
  put('docs/manual/voice.md',meta('1.3.0','voice.mjs')+'# Voice\n');
  put('docs/manual/tasks.md',meta('1.1.5','tasks.mjs')+'# Tasks\n');
  put('docs/manual/vault.md',meta('1.1.0','vault.mjs')+'# Vault\n\nSee [Tasks](tasks.md#add-one).\n');
  const p=checkStructure(dir).problems.join('\n');
  assert.match(p,/files\.md: no <!-- manual --> block/);
  assert.match(p,/voice\.md: checked 1\.3\.0 is not in CHANGELOG/);
  assert.match(p,/voice\.md: source voice\.mjs does not exist/);
  assert.match(p,/README\.md does not link docs\/manual\/voice\.md/);
  assert.match(p,/tasks\.md: checked 1\.1\.5 is not in CHANGELOG/);
  assert.match(p,/vault\.md: link tasks\.md#add-one names no heading/);
  assert.match(p,/README\.md: link tasks\.md#add-a-task names no heading/,'the index link broke when the heading went');
});

test('drift: a source change behind the page flags it; editing or re-checking the page clears it',t=>{
  const {dir,put,git}=fixture(t);
  const pages=()=>checkStructure(dir).pages;
  assert.deepEqual(drift(dir,pages()).behind,[]);
  put('vault.mjs','v2\n');git('commit','-qam','1.3.0: vault change');
  let d=drift(dir,pages()).behind;
  assert.equal(d.length,1);assert.equal(d[0].file,'docs/manual/vault.md');
  assert.deepEqual(d[0].changed,['vault.mjs']);assert.match(d[0].commits[0],/1\.3\.0: vault change/);
  put('docs/manual/vault.md',meta('1.2.0','vault.mjs')+'# Vault\n\n## Turn it on\n\nSee [Tasks](tasks.md#add-a-task).\n');
  assert.deepEqual(drift(dir,pages()).behind,[],'an uncommitted edit counts as current');
  git('commit','-qam','re-check vault');
  assert.deepEqual(drift(dir,pages()).behind,[]);
  put('tasks.mjs','t2\n');
  assert.deepEqual(drift(dir,pages()).behind.map(p=>p.file),['docs/manual/tasks.md'],'uncommitted source changes count too');
});

test('drift --base: only what the branch changed, and the page changed alongside clears it',t=>{
  const {dir,put,git}=fixture(t);
  git('checkout','-qb','feature');
  put('vault.mjs','v2\n');put('tasks.mjs','t2\n');put('docs/manual/tasks.md',meta('1.2.0','tasks.mjs')+'# Tasks\n\n## Add a task\n\nNew.\n');
  git('commit','-qam','change both');
  const d=drift(dir,checkStructure(dir).pages,{base:'main'}).behind;
  assert.deepEqual(d.map(p=>[p.file,p.changed]),[['docs/manual/vault.md',['vault.mjs']]]);
  assert.match(drift(dir,checkStructure(dir).pages,{base:'nope'}).skipped,/no merge base/);
});

test('the repository manual itself passes the structure check',()=>{
  assert.deepEqual(checkStructure(repo).problems,[]);
});
