import test from 'node:test';import assert from 'node:assert/strict';import {claudeIdentity,agentEnv,readClaudeIdentity} from '../environment.mjs';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
test('account status returns only whitelisted identity metadata',()=>{
 const row=claudeIdentity({loggedIn:true,authMethod:'claude.ai',email:'example@example.test',subscriptionType:'max',accessToken:'never return',refreshToken:'never return',apiKey:'never return',organization:{private:'data'}});
 assert.deepEqual(Object.keys(row).sort(),['provider','signedIn','method','email','plan'].sort());assert.doesNotMatch(JSON.stringify(row),/never return/);
});
test('agent turns never inherit the daemon login, cookie or push secrets',()=>{
 const env=agentEnv({PATH:'/bin',POCKET_PASSWORD:'p',POCKET_SECRET:'s',VAPID_PRIVATE:'v',POCKET_VAULT_KEY:'k',VAPID_PUBLIC:'pub',POCKET_SESSION_ROOT:'/x'});
 assert.deepEqual(env,{PATH:'/bin',VAPID_PUBLIC:'pub',POCKET_SESSION_ROOT:'/x'});
});
test('a signed-out CLI (exit 1 with a status) reads as signed out, not unknown',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-auth-'));const bin=path.join(dir,'claude');
 fs.writeFileSync(bin,'#!/bin/sh\necho \'{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}\'\nexit 1\n',{mode:0o755});
 assert.deepEqual(await readClaudeIdentity(bin,process.env),{provider:'claude',signedIn:false,method:'none',email:null,plan:null});
 fs.writeFileSync(bin,'#!/bin/sh\necho broken\nexit 1\n',{mode:0o755});
 assert.equal((await readClaudeIdentity(bin,process.env)).signedIn,null,'unreadable output stays unknown');
 fs.rmSync(dir,{recursive:true,force:true});
});
