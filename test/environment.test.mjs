import test from 'node:test';import assert from 'node:assert/strict';import {claudeIdentity,agentEnv} from '../environment.mjs';
test('account status returns only whitelisted identity metadata',()=>{
 const row=claudeIdentity({loggedIn:true,authMethod:'claude.ai',email:'example@example.test',subscriptionType:'max',accessToken:'never return',refreshToken:'never return',apiKey:'never return',organization:{private:'data'}});
 assert.deepEqual(Object.keys(row).sort(),['provider','signedIn','method','email','plan'].sort());assert.doesNotMatch(JSON.stringify(row),/never return/);
});
test('agent turns never inherit the daemon login, cookie or push secrets',()=>{
 const env=agentEnv({PATH:'/bin',POCKET_PASSWORD:'p',POCKET_SECRET:'s',VAPID_PRIVATE:'v',VAPID_PUBLIC:'pub',POCKET_SESSION_ROOT:'/x'});
 assert.deepEqual(env,{PATH:'/bin',VAPID_PUBLIC:'pub',POCKET_SESSION_ROOT:'/x'});
});
