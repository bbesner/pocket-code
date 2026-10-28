// Daily discovery, explicit upgrades. The atomic state file is the sole activation record.
// Packages live in immutable, unique directories; a failed/interrupted job cannot replace a live CLI.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { BOOT_ID, startTime, signalGroup } from './proctree.mjs';

export const PROVIDERS = {
  claude: { name: 'Claude Code', pkg: '@anthropic-ai/claude-code', notes: 'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md' },
  codex: { name: 'Codex', pkg: '@openai/codex', notes: 'https://github.com/openai/codex/releases' },
};
const plain = o => o && typeof o === 'object' && !Array.isArray(o);
export const version = v => typeof v === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v) ? v : null;
export function newer(a, b) { if (!version(a) || !version(b)) return false; const x=a.split('.').map(Number), y=b.split('.').map(Number); for(let i=0;i<3;i++) if(x[i]!==y[i]) return x[i]>y[i]; return false; }
export function localSlot(now, zone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', hourCycle:'h23' }).formatToParts(now);
  const get = k => parts.find(p=>p.type===k).value;
  return { day: `${get('year')}-${get('month')}-${get('day')}`, due: Number(get('hour'))>=4 };
}
function write(file, data) {
  const tmp=file+'.tmp'; const fd=fs.openSync(tmp,'w',0o600);
  try { fs.writeFileSync(fd,JSON.stringify(data,null,2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp,file);
}
const fail = (message, status=409) => Object.assign(new Error(message), {status});
// No API keys, npm tokens, Pocket credentials or agent configuration reach installers/probes.
export function cleanEnv(home=os.homedir()) {
  return { PATH:process.env.PATH || '/usr/local/bin:/usr/bin:/bin', HOME:home, TMPDIR:os.tmpdir(), LANG:'C.UTF-8',
    DISABLE_AUTOUPDATER:'1', DISABLE_UPDATES:'1', DISABLE_TELEMETRY:'1', npm_config_userconfig:'/dev/null', npm_config_globalconfig:'/dev/null/pocket-global-npmrc' };
}
export function runChild(bin,args,{cwd,env=cleanEnv(),timeout=120000,onChild=()=>{},input,onLine}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(import.meta.dirname,'cli-update-worker.mjs')],{env,detached:true,stdio:['pipe','pipe','pipe','ipc']});
    let output='', pending='', stopping=false, outcome=null, timer;
    const stop=error=>{if(stopping)return;stopping=true;outcome=error||null;clearTimeout(timer);signalGroup(child.pid,'SIGKILL');};
    child.on('error',()=>stop(new Error('Could not start the update command.')));
    child.on('message',m=>{if(m?.spawnError)stop(new Error('Could not start the update command.'));});
    // The worker can exit before inherited stdout closes. Kill its group on exit,
    // then wait for close so the promise never publishes success before cleanup.
    child.on('exit',code=>stop(code===0?null:new Error('The update command failed. The previous version is still selected.')));
    child.on('close',code=>{if(!stopping)stop(code===0?null:new Error('The update command failed.'));outcome?reject(outcome):resolve(output);});
    child.stdin.on('error',()=>{});
    child.stderr.on('data',()=>{}); // provider diagnostics can contain account details
    child.stdout.on('data',buf=>{
      output+=buf.toString();if(output.length>512*1024)return stop(new Error('The update command returned too much output.'));
      if(onLine){pending+=buf.toString();let i;while((i=pending.indexOf('\n'))>=0){const line=pending.slice(0,i);pending=pending.slice(i+1);try{onLine(line,child,()=>stop());}catch(e){stop(e);}}}
    });
    timer=setTimeout(()=>stop(new Error('The update command timed out. Try again.')),timeout);
    try{onChild(child);child.send({bin,args,cwd},error=>{if(error)stop(new Error('Could not start the update command.'));});if(input!==undefined)child.stdin.end(input);else if(!onLine)child.stdin.end();}catch(e){stop(e);}
  });
}
export async function probe(provider,bin,{cwd,env,onChild}={}) {
  const output=await runChild(bin,['--version'],{cwd,env,onChild,timeout:15000});
  const found=output.match(/(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$)/)?.[1];
  if(!version(found))throw new Error('The CLI did not report a supported version.');
  let handshake=false;
  if(provider==='codex') {
    let stage=0;
    await runChild(bin,['app-server','--listen','stdio://'],{cwd,env,onChild,timeout:30000,
      onLine(line,child,finish){let m;try{m=JSON.parse(line);}catch{return;}
        if(m.error)throw new Error('Codex did not pass the app-server compatibility check.');
        if(m.id===1&&stage===0){if(!plain(m.result))throw new Error('Codex returned an invalid handshake.');stage=1;child.stdin.write(JSON.stringify({method:'initialized'})+'\n'+JSON.stringify({id:2,method:'model/list',params:{}})+'\n');}
        else if(m.id===2&&stage===1){if(!Array.isArray(m.result?.data))throw new Error('Codex returned an invalid model list.');handshake=true;finish();}
      },
      onChild(child){onChild?.(child);child.stdin.write(JSON.stringify({id:1,method:'initialize',params:{clientInfo:{name:'pocket-update-check',version:'1.0'},capabilities:{experimentalApi:true}}})+'\n');}
    });
  } else {
    await runChild(bin,['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--permission-prompt-tool','stdio','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','','--settings','{"disableAllHooks":true}','--no-session-persistence'],{cwd,env,onChild,timeout:30000,
      onLine(line,_child,finish){let m;try{m=JSON.parse(line);}catch{return;}
        if(m.type==='control_response'&&m.response?.request_id==='pocket-update-check'){
          if(m.response.subtype!=='success'||!plain(m.response.response))throw new Error('Claude Code did not pass the stream protocol check.');handshake=true;finish();
        }
      },
      onChild(child){onChild?.(child);child.stdin.write(JSON.stringify({type:'control_request',request_id:'pocket-update-check',request:{subtype:'initialize',hooks:{}}})+'\n');}
    });
  }
  if(!handshake)throw new Error('The CLI exited before completing its compatibility check.');
  return found;
}
export class CliUpdates {
  constructor({dir,bins,zone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone,enabled=true,overrides={},onActivate=()=>{},fetcher=fetch,run=runChild,test=probe,now=()=>Date.now(),persist=write}) {
    Object.assign(this,{bins,zone,enabled,overrides,onActivate,fetcher,run,test,now,persist});
    this.root=path.join(dir,'cli-runtimes');this.file=path.join(this.root,'state.json');this.busy=false;this.checking=false;this.children=new Set();
    fs.mkdirSync(this.root,{recursive:true,mode:0o700});
    try{this.state=JSON.parse(fs.readFileSync(this.file,'utf8'));if(!plain(this.state)||!plain(this.state.providers))throw Error();}
    catch(e){if(e.code!=='ENOENT'&&fs.existsSync(this.file))throw new Error('CLI update state is unreadable; restore it before starting Pocket.');this.state={providers:{},job:null};}
    // Activation is durable before any in-memory consumer changes. Recover an interrupted installer only, never re-run it.
    if(this.state.job?.running){const c=this.state.job.child;if(c?.boot===BOOT_ID&&c.start&&startTime(c.pid)===c.start)signalGroup(c.pid,'SIGKILL');this.state.job={...this.state.job,running:false,phase:'interrupted',error:'Pocket restarted during the upgrade. Check the selected versions, then retry.',child:null};this.save();}
    for(const key of Object.keys(PROVIDERS)){const row=this.state.providers[key];if(row?.active&&!this.validTarget(row.active))throw new Error('A selected CLI installation is missing; restore it before starting Pocket.');}
  }
  validTarget(target){return plain(target)&&version(target.version)&&typeof target.bin==='string'&&(target.bin.startsWith(this.root+path.sep)||(target.external===true&&Object.values(this.bins).includes(target.bin)))&&fs.existsSync(target.bin);}
  save(next=this.state){this.persist(this.file,next);this.state=next;}
  binary(key){return (this.overrides[key]?null:this.state.providers[key]?.active?.bin)||this.bins[key];}
  timezone(){try{const zone=this.zone()||Intl.DateTimeFormat().resolvedOptions().timeZone;localSlot(this.now(),zone);return zone;}catch{return 'UTC';}}
  async installed(key){try{const out=await this.run(this.binary(key),['--version'],{timeout:10000});return version(out.match(/(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$)/)?.[1]);}catch{return null;}}
  snapshot(){return {enabled:this.enabled,timeZone:this.timezone(),hour:4,checking:this.checking,checkedAt:this.state.checkedAt||null,checkError:this.state.checkError||null,job:this.state.job?{...this.state.job,child:undefined}:null,
    providers:Object.entries(PROVIDERS).map(([key,p])=>{const r=this.state.providers[key]||{},installed=r.active?.version||r.installed||null;return {key,name:p.name,installed,latest:r.latest||null,available:newer(r.latest,installed),managed:!!r.active,canUpgrade:this.enabled&&!!this.bins[key]&&!this.overrides[key]&&['linux','darwin'].includes(process.platform)&&['x64','arm64'].includes(process.arch),error:r.error||null,checkedAt:r.checkedAt||null,notes:key==='codex'&&version(r.latest)?`https://github.com/openai/codex/releases/tag/rust-v${r.latest}`:p.notes,previous:r.previous?.version||null};})};}
  async tick(){if(!this.enabled||this.busy||this.checking||!Object.keys(PROVIDERS).some(k=>this.bins[k]&&!this.overrides[k]))return;const {day,due}=localSlot(this.now(),this.timezone());if(!due||this.state.day===day)return;
    this.save({...this.state,pendingDay:day});await this.check();this.save({...this.state,day,pendingDay:null});}
  start(){if(!this.enabled)return;this.timer=setInterval(()=>this.tick().catch(()=>{}),60000);this.timer.unref();this.tick().catch(()=>{});}
  dispose(){clearInterval(this.timer);for(const child of this.children)signalGroup(child.pid,'SIGKILL');}
  async check(){if(!this.enabled)throw fail('CLI updates are disabled on this server.');if(this.checking||this.busy)throw fail('An update check or upgrade is already running.');this.checking=true;
    try{const providers=structuredClone(this.state.providers);let failed=false;
      for(const key of Object.keys(PROVIDERS)){
        const row=providers[key]||{};providers[key]=row;if(!this.bins[key])continue;
        row.installed=await this.installed(key);
        try{const r=await this.fetcher('https://registry.npmjs.org/'+encodeURIComponent(PROVIDERS[key].pkg)+'/latest',{signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)throw Error();const text=await r.text();if(text.length>1024*1024)throw Error();const data=JSON.parse(text);if(data.name!==PROVIDERS[key].pkg||!version(data.version))throw Error();row.latest=data.version;row.checkedAt=this.now();row.error=null;}
        catch{failed=true;row.error='Could not check the publisher. Try Check now.';}
      }
      this.save({...this.state,providers,checkedAt:this.now(),checkError:failed?'Some release checks failed. Previously found updates are still shown.':null});return this.snapshot();
    }finally{this.checking=false;}
  }
  begin(selections,{rollback=false}={}){
    if(this.busy||this.checking)throw fail('An update check or upgrade is already running.');
    if(!this.enabled)throw fail('CLI updates are disabled on this server.');
    if(!Array.isArray(selections)||!selections.length||selections.length>2||new Set(selections.map(x=>x?.key)).size!==selections.length)throw fail('Choose one or both CLIs.',400);
    for(const s of selections){const p=this.snapshot().providers.find(p=>p.key===s?.key),r=this.state.providers[s?.key];
      if(!p?.canUpgrade||!version(s.version)||s.version!==(rollback?r?.previous?.version:r?.latest)||(!rollback&&!newer(s.version,p.installed)))throw fail('The selected version is no longer available. Check again.');
      if(rollback&&!this.validTarget(r.previous))throw fail('The previous installation is unavailable.');
    }
    selections=selections.map(({key,version})=>({key,version}));
    this.save({...this.state,job:{id:randomUUID(),running:true,phase:'queued',startedAt:this.now(),selections,rollback,results:[],error:null}});
    this.busy=true;this.task=this.upgrade(selections,rollback).finally(()=>{this.busy=false;});this.task.catch(()=>{});return this.snapshot();
  }
  phase(phase,extra={}){this.save({...this.state,job:{...this.state.job,phase,...extra}});}
  track(child){this.children.add(child);child.once('close',()=>this.children.delete(child));this.phase(this.state.job.phase,{child:{pid:child.pid,boot:BOOT_ID,start:startTime(child.pid)}});}
  async upgrade(selections,rollback){
    try{for(const {key,version:target} of selections){
      this.phase('installing',{provider:key,child:null});
      const row=this.state.providers[key],old=row.active||{version:row.installed,bin:this.bins[key],external:true};
      let candidate;
      if(rollback)candidate=row.previous;
      else {
        const dest=path.join(this.root,key+'-'+target+'-'+randomUUID());fs.mkdirSync(dest,{mode:0o700});
        await this.run('npm',['install','--prefix',dest,'--registry=https://registry.npmjs.org','--ignore-scripts','--no-audit','--no-fund','--package-lock=false','--save-exact',PROVIDERS[key].pkg+'@'+target],{cwd:dest,timeout:5*60000,onChild:c=>this.track(c)});
        if(key==='claude'){
          const hook=path.join(dest,'node_modules',PROVIDERS[key].pkg,'install.cjs');
          if(fs.existsSync(hook))await this.run(process.execPath,[hook],{cwd:path.dirname(hook),timeout:120000,onChild:c=>this.track(c)});
        }
        candidate={version:target,bin:path.join(dest,'node_modules','.bin',key)};
      }
      this.phase('testing',{child:null});
      const scratch=fs.mkdtempSync(path.join(this.root,'probe-'));
      let got;try{const env={...cleanEnv(scratch),CODEX_HOME:path.join(scratch,'codex'),CLAUDE_CONFIG_DIR:path.join(scratch,'claude')};fs.mkdirSync(env.CODEX_HOME,{recursive:true});fs.mkdirSync(env.CLAUDE_CONFIG_DIR,{recursive:true});got=await this.test(key,candidate.bin,{cwd:scratch,env,onChild:c=>this.track(c)});}finally{fs.rmSync(scratch,{recursive:true,force:true});}
      if(got!==target)throw new Error('The downloaded CLI did not match the version you approved.');
      // One atomic record publishes the tested path and retains the prior managed installation.
      const next={...this.state,providers:{...this.state.providers,[key]:{...row,active:candidate,previous:old,installed:target}},job:{...this.state.job,phase:'activated',child:null,results:[...this.state.job.results,{key,version:target}]}};
      this.save(next);this.onActivate(key,candidate.bin);
    }
    this.phase('complete',{running:false,finishedAt:this.now(),child:null});
    // If even failure persistence fails, show an ephemeral error; selected binaries
    // still match the last committed record. Restart recovers its interrupted job.
    }catch(e){const job={...this.state.job,running:false,phase:'failed',finishedAt:this.now(),child:null,error:e.message};try{this.save({...this.state,job});}catch{this.state={...this.state,job:{...job,error:'Could not save update progress. Check the selected versions before retrying.'}};}}
  }
}
