import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export function claudeIdentity(raw){
 return {provider:'claude',signedIn:raw.loggedIn===true,method:typeof raw.authMethod==='string'?raw.authMethod:'Unknown',email:typeof raw.email==='string'?raw.email:null,plan:typeof raw.subscriptionType==='string'?raw.subscriptionType:null};
}
export async function readClaudeIdentity(bin,env){
 try{const r=await exec(bin,['auth','status','--json'],{env,timeout:10000,maxBuffer:65536});return claudeIdentity(JSON.parse(r.stdout));}
 catch{return {provider:'claude',signedIn:null,method:'Status unavailable',email:null,plan:null};}
}
// Pocket's own secrets stay in the daemon: agent turns, their tools and subprocesses
// never need the login password, cookie-signing key or push private key.
const DAEMON_SECRETS=['POCKET_PASSWORD','POCKET_SECRET','VAPID_PRIVATE'];
export function agentEnv(env=process.env){
 const out={...env};
 for(const k of DAEMON_SECRETS)delete out[k];
 return out;
}
