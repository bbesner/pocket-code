import test from 'node:test';import assert from 'node:assert/strict';import {claudeIdentity} from '../environment.mjs';
test('account status returns only whitelisted identity metadata',()=>{
 const row=claudeIdentity({loggedIn:true,authMethod:'claude.ai',email:'example@example.test',subscriptionType:'max',accessToken:'never return',refreshToken:'never return',apiKey:'never return',organization:{private:'data'}});
 assert.deepEqual(Object.keys(row).sort(),['provider','signedIn','method','email','plan'].sort());assert.doesNotMatch(JSON.stringify(row),/never return/);
});
