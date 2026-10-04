// Read-only Git inspection. All subprocess arguments are fixed or literal paths.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
const exec = promisify(execFile);
const MAX = 256 * 1024;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
async function git(cwd,args,maxBuffer=MAX){
 return (await exec('git',['--no-pager','-c','core.fsmonitor=false','-c','core.untrackedCache=false',...args],{
  cwd,env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',GIT_LITERAL_PATHSPECS:'1'},timeout:8000,maxBuffer,encoding:'utf8',
 })).stdout;
}
function safeFile(file){return typeof file==='string' && file.length>0 && !path.isAbsolute(file) && !file.split('/').some(p=>p==='..'||p.startsWith('.')) && !/(^|\/)(id_rsa|id_ed25519|credentials|secrets?)(\.|$)|\.(pem|key|p12|pfx)$/i.test(file);}
async function rootFor(cwd,home){
 if(!cwd)throw fail('This session has no workspace.',404);
 const real=await fs.realpath(cwd).catch(()=>null),allowed=await fs.realpath(home);
 if(!real||(real!==allowed&&!real.startsWith(allowed+path.sep)))throw fail('Workspace is outside this instance’s home directory.',403);
 let root;try{root=(await git(real,['rev-parse','--show-toplevel'])).trim();}catch{throw fail('This workspace is not an available Git repository.',404);}
 const rootReal=await fs.realpath(root);
 if(rootReal!==allowed&&!rootReal.startsWith(allowed+path.sep))throw fail('Repository is outside this instance’s home directory.',403);
 return rootReal;
}
export function parseStatus(raw){
 const fields=raw.split('\0'),rows=[];
 for(let i=0;i<fields.length;i++){
  const v=fields[i];if(!v)continue;
  const status=v.slice(0,2),file=v.slice(3);
  const original=/[RC]/.test(status)?fields[++i]:null;
  rows.push({path:file,status,original,inspectable:safeFile(file)&&(!original||safeFile(original)),untracked:status==='??'});
 }
 return rows;
}
export async function workspaceStatus(cwd,home){
 const root=await rootFor(cwd,home);
 const raw=await git(root,['status','--porcelain=v1','-z','--untracked-files=normal'],1024*1024);
 const rows=parseStatus(raw);
 const branch=(await git(root,['symbolic-ref','--quiet','--short','HEAD']).catch(()=>'' )).trim()||'Detached HEAD';
 return {root,branch,checkedAt:Date.now(),files:rows.slice(0,250),limited:rows.length>250,total:rows.length,readOnly:true};
}
export async function workspaceDiff(cwd,home,file,scope='working'){
 if(!['working','staged'].includes(scope)||!safeFile(file))throw fail('Choose a supported changed file.',403);
 const status=await workspaceStatus(cwd,home);
 const row=status.files.find(r=>r.path===file);
 if(!row||!row.inspectable)throw fail('File is no longer in the supported changed-file list.',409);
 if(row.untracked)return {text:'Untracked file. Git has no diff for this file until it is staged.',untracked:true,scope};
 // Refuse filesystem symlink escapes. Deleted paths are compared by Git itself.
 const candidate=path.join(status.root,file);
 const real=await fs.realpath(candidate).catch(()=>null);
 if(real&&!real.startsWith(status.root+path.sep))throw fail('File resolves outside this repository.',403);
 try{
  const text=await git(status.root,['diff','--no-ext-diff','--no-textconv','--no-color','--submodule=short','--unified=3',...(scope==='staged'?['--cached']:[]),'--',file]);
  return {text:text||'No '+scope+' diff for this file.',scope,checkedAt:Date.now()};
 }catch(e){if(e.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER')return {text:'This diff exceeds the 256 KB preview limit. Ask the agent for a summary or inspect it in your editor.',limited:true,scope};throw fail('Git could not read the diff. Refresh and try again.',503);}
}
