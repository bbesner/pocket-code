import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export function claudeIdentity(raw){
 return {provider:'claude',signedIn:raw.loggedIn===true,method:typeof raw.authMethod==='string'?raw.authMethod:'Unknown',email:typeof raw.email==='string'?raw.email:null,plan:typeof raw.subscriptionType==='string'?raw.subscriptionType:null};
}
export async function readClaudeIdentity(bin,env){
 // 1.53.1: the CLI exits 1 when signed out but still prints its status, so read stdout either way.
 try{const r=await exec(bin,['auth','status','--json'],{env,timeout:10000,maxBuffer:65536});return claudeIdentity(JSON.parse(r.stdout));}
 catch(e){try{const raw=JSON.parse(e?.stdout||'');if(raw&&typeof raw==='object'&&typeof raw.loggedIn==='boolean')return claudeIdentity(raw);}catch{}
  return {provider:'claude',signedIn:null,method:'Status unavailable',email:null,plan:null};}
}
// Pocket's own secrets stay in the daemon: agent turns, their tools and subprocesses
// never need the login password, cookie-signing key or push private key.
export const DAEMON_SECRETS=['POCKET_PASSWORD','POCKET_SECRET','VAPID_PRIVATE','POCKET_VAULT_KEY','POCKET_VAULT_KEY_PREVIOUS','POCKET_SMTP_URL','POCKET_SMTP_FROM','POCKET_ROUTER_KEY']; // 1.39: the vault key is also removed from process.env at boot; 1.73.3: so are the SMTP address (its URL carries the mail password) and the router key
export function agentEnv(env=process.env){
 const out={...env};
 for(const k of DAEMON_SECRETS)delete out[k];
 return out;
}
