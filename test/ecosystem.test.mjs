import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const eco=require('../ecosystem.config.cjs');
const {userPath}=eco;
const sep=path.delimiter;
const split=p=>p.split(sep).filter(Boolean);

test('PM2 sees one app with the daemon settings and a pinned PATH',()=>{
 assert.deepEqual(Object.keys(eco),['apps'],'only apps is enumerable');
 const app=eco.apps[0];
 assert.equal(app.name,'pocket-claude');assert.equal(app.script,'server.mjs');assert.equal(app.treekill,false);
 assert.equal(app.cwd,path.resolve(import.meta.dirname,'..'));
 const current=split(process.env.PATH||'');const pinned=split(app.env.PATH);
 assert.deepEqual(pinned.slice(0,current.length),current,'the current entries come first, in order');
 assert.ok(pinned.includes(path.dirname(process.execPath)),'the directory of the running node is on it');
 const added=pinned.slice(current.length);
 assert.equal(new Set(added).size,added.length,'nothing is added twice');
 for(const d of added)assert.ok(!current.includes(d),'nothing already present is added: '+d);
});

test('userPath appends the user bin directories that exist, after the current entries, in order',()=>{
 const home='/home/u';
 const exists=d=>['/home/u/.local/bin','/home/u/.npm-global/bin','/opt/node/bin'].includes(d);
 const got=userPath(['/usr/local/bin','/usr/bin','/bin'].join(sep),{home,execPath:'/opt/node/bin/node',exists});
 assert.deepEqual(split(got),['/usr/local/bin','/usr/bin','/bin','/home/u/.local/bin','/home/u/.npm-global/bin','/opt/node/bin']);
});

test('userPath leaves a complete PATH alone, skips missing directories and starts from nothing',()=>{
 const home='/home/u';const exists=d=>d!=='/home/u/bin';
 const complete=['/home/u/.local/bin','/home/u/.npm-global/bin','/usr/bin','/opt/node/bin'].join(sep);
 assert.equal(userPath(complete,{home,execPath:'/opt/node/bin/node',exists}),complete);
 assert.equal(userPath('',{home,execPath:'/opt/node/bin/node',exists}),['/home/u/.local/bin','/home/u/.npm-global/bin','/opt/node/bin'].join(sep));
 // the node directory is added once even when it is also the user's npm prefix
 const same=userPath('/usr/bin',{home,execPath:'/home/u/.npm-global/bin/node',exists:()=>true});
 assert.deepEqual(split(same),['/usr/bin','/home/u/.local/bin','/home/u/.npm-global/bin','/home/u/bin']);
});
