// Read-only projection of provider events. Never starts, resumes or writes to an agent.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
const text = (v, n = 12000) => typeof v === 'string' ? v.slice(0, n) : '';
const bodyText = v => typeof v === 'string' ? v : Array.isArray(v) ? v.filter(x=>x.type==='text').map(x=>x.text).join('\n') : '';
const terminalStates = new Set(['completed','failed','interrupted','closed']);
const activeStates = new Set(['running', 'pending']);
const state = v => ({pendingInit:'pending',running:'running',completed:'completed',failed:'failed',errored:'failed',interrupted:'interrupted',stopped:'interrupted',shutdown:'closed',notFound:'unknown'}[v] || 'unknown');

export class AgentActivity {
  constructor() { this.agents = new Map(); this.aliases = new Map(); }
  put(id, patch) {
    if (!id) return;
    id = this.aliases.get(id) || id;
    const a = this.agents.get(id) || {id, name:'Subagent', status:'unknown', task:'', latest:''};
    for (const [k,v] of Object.entries(patch)) {
      // Replayed lifecycle records cannot revive a foreground invocation whose
      // parent run already ended; a later terminal result can still resolve it.
      if(k==='status' && a.runEnded && activeStates.has(v))continue;
      if (v !== undefined && v !== null && v !== '') a[k] = v;
    }
    this.agents.set(id, a); return a;
  }
  // The same agent under a new key (its task id once the CLI reports it); the old key becomes an alias.
  rekey(oldId, newId) {
    oldId = this.aliases.get(oldId) || oldId;
    if (!oldId || !newId || oldId === newId) return;
    const prev = this.agents.get(oldId);
    if (prev) { this.agents.delete(oldId); this.agents.set(newId, {...prev, id:newId}); }
    for (const [alias, target] of this.aliases) if (target === oldId) this.aliases.set(alias, newId);
    this.aliases.delete(newId);
    this.aliases.set(oldId, newId);
  }
  // 1.82: what the CLI's own subagent transcripts say (SubagentIndex.summary). They name the agent, its kind and
  // model, and carry every step it took, so an agent reads as working even when the parent reported nothing.
  // A finished agent keeps its reported result as its latest line.
  files(list) {
    for (const f of list || []) {
      if (!f?.id) continue;
      if (f.toolUseId) this.rekey(f.toolUseId, f.id);
      const a = this.agents.get(f.id);
      const finished = a && terminalStates.has(a.status);
      const newer = !a?.lastAt || !f.lastAt || Date.parse(f.lastAt) >= Date.parse(a.lastAt);
      this.put(f.id, {
        name: (!a || a.name === 'Subagent') ? text(f.name, 240) : undefined, kind: text(f.kind, 100), model: text(f.model, 100),
        latest: !finished && newer ? text(f.latest) : undefined, lastAt: newer ? f.lastAt : undefined,
        steps: f.steps, messages: f.messages, activity: true, background: f.background || undefined,
      });
    }
  }
  claude(o) {
    if(o.type==='result') {
      for(const a of this.agents.values())if(activeStates.has(a.status)&&!a.background){a.status='unknown';a.runEnded=true;}
      return;
    }
    const notification=bodyText(o.message?.content);
    if(o.type==='user' && notification.trim().startsWith('<task-notification>')) {
      const id=/<task-id>([^<]+)<\/task-id>/.exec(notification)?.[1];
      const target=this.aliases.get(id)||id;
      if(this.agents.has(target))this.put(target,{status:state(/<status>([^<]+)<\/status>/.exec(notification)?.[1]),latest:text(/<summary>([\s\S]*?)<\/summary>/.exec(notification)?.[1])});
    }
    if (o.type === 'progress' && o.data?.type === 'agent_progress') {
      const a = this.put(o.parentToolUseID, {lastAt:o.timestamp});
      if (!a) return;
      const m = o.data.message?.message || o.data.message;
      for (const b of m?.content || []) {
        if (b.type === 'text') a.latest = text(b.text);
        if (b.type === 'tool_use') a.latest = 'Using ' + text(b.name,100);
      }
      return;
    }
    if (o.type === 'system' && /^task_(started|progress|notification|updated)$/.test(o.subtype)) {
      const known = this.agents.has(this.aliases.get(o.tool_use_id) || o.tool_use_id) || this.agents.has(o.task_id);
      if (!known && !o.subagent_type && !/agent/.test(o.task_type || '')) return; // Bash jobs aren't agents.
      if (o.tool_use_id && o.task_id) {
        const oldId=this.aliases.get(o.tool_use_id)||o.tool_use_id;
        const prev=this.agents.get(oldId);
        if(prev && oldId!==o.task_id){
          this.agents.delete(oldId);this.agents.set(o.task_id,{...prev,id:o.task_id});
          for(const [alias,target] of this.aliases)if(target===oldId)this.aliases.set(alias,o.task_id);
        }
        this.aliases.delete(o.task_id);
        this.aliases.set(o.tool_use_id,o.task_id);
      }
      const patch = o.patch || {};
      this.put(o.task_id || o.tool_use_id, {
        name:o.subtype==='task_started'?text(o.description,240):undefined, task:text(o.prompt), kind:text(o.subagent_type,100),
        status:o.subtype==='task_started'?((this.agents.get(o.task_id||o.tool_use_id)?.runEnded||terminalStates.has(this.agents.get(o.task_id||o.tool_use_id)?.status))?undefined:'running'):o.status?state(o.status):patch.status?state(patch.status):undefined,
        latest:text(o.summary || (o.last_tool_name ? 'Using '+o.last_tool_name : o.subtype==='task_progress'?o.description:'')),
        lastAt:o.timestamp, background:o.is_backgrounded ?? patch.is_backgrounded,
        usage:o.usage ? {tokens:o.usage.total_tokens,tools:o.usage.tool_uses,durationMs:o.usage.duration_ms} : undefined,
      }); return;
    }
    for (const b of Array.isArray(o.message?.content) ? o.message.content : []) {
      if (b.type === 'tool_use' && ['Agent','Task'].includes(b.name)) this.put(b.id, {
        name:text(b.input?.description,240) || text(b.input?.name,240) || 'Subagent',
        task:text(b.input?.prompt), kind:text(b.input?.subagent_type,100), model:text(b.input?.model,100),
        status:(this.agents.get(this.aliases.get(b.id)||b.id)?.runEnded||terminalStates.has(this.agents.get(this.aliases.get(b.id)||b.id)?.status))?undefined:'running', background:Boolean(b.input?.run_in_background), lastAt:o.timestamp,
      });
      if (b.type === 'tool_result') {
        const id=this.aliases.get(b.tool_use_id)||b.tool_use_id, a=this.agents.get(id); if(!a)continue;
        const result = bodyText(b.content), launch=/agentId:\s*([\w-]+)/.exec(result);
        if (o.tool_use_result?.isAsync || (launch && /(?:launched|running).*background|async agent/i.test(result))) {
          const agentId=o.tool_use_result?.agentId||launch?.[1];if(agentId)this.aliases.set(agentId,id); a.background=true; continue;
        }
        this.put(id,{status:b.is_error?'failed':'completed',latest:text(result),lastAt:o.timestamp});
      }
    }
  }
  codex(it) {
    if (it.type === 'subAgentActivity') {
      const patch={name:text(it.agentPath,240),lastAt:it.timestamp};
      // "interacted" includes read-only messages: it does not prove a new run.
      if(it.kind!=='interacted')patch.status=({started:'running',completed:'completed',interrupted:'interrupted'})[it.kind]||'unknown';
      this.put(it.agentThreadId,patch); return;
    }
    if (it.type !== 'collabAgentToolCall') return;
    const ids=new Set([...(it.receiverThreadIds||[]),...Object.keys(it.agentsStates||{})]);
    for(const id of ids) {
      const s=it.agentsStates?.[id];
      const patch={lastAt:it.timestamp};
      if(['spawnAgent','spawn_agent','followupTask'].includes(it.tool)) {
        patch.task=text(it.prompt);patch.model=text(it.model,100);
        if(it.status!=='failed')patch.status='running';
      }
      // Tool completion is not agent completion. Only the agent's own state counts.
      if(s?.status)patch.status=state(s.status);
      if(s?.message)patch.latest=text(s.message);
      this.put(id,patch);
    }
  }
  snapshot({confirmed=false, backgroundIds=[]}={}) {
    const bg=new Set(backgroundIds);
    const agents=[...this.agents.values()].map(({runEnded,...a})=>({...a,
      status:activeStates.has(a.status)&&!confirmed&&!bg.has(a.id)?'unknown':a.status,
    })).reverse();
    agents.sort((a,b)=>Number(activeStates.has(b.status))-Number(activeStates.has(a.status)));
    return {agents:agents.slice(0,100), running:agents.filter(a=>activeStates.has(a.status)).length,
      total:agents.length,truncated:agents.length>100,checkedAt:Date.now()};
  }
}

// Cache only relevant records, incrementally reading complete lines. Reopening a browser
// or daemon reconstructs the same view from provider-owned transcripts and runner logs.
export class ClaudeAgentFiles {
  constructor(){this.files=new Map();}
  async read(file) {
    const st=await fs.stat(file);
    let c=this.files.get(file);
    if(!c||c.ino!==st.ino||st.size<c.offset)c={ino:st.ino,offset:0,events:[],tools:new Set(),truncated:false};
    if(st.size>c.offset) {
      const handle=await fs.open(file,'r');
      try {
        let pos=c.offset,rem=Buffer.alloc(0);
        while(pos<st.size) {
          const buf=Buffer.alloc(Math.min(262144,st.size-pos));
          const {bytesRead}=await handle.read(buf,0,buf.length,pos);if(!bytesRead)break;pos+=bytesRead;
          rem=Buffer.concat([rem,buf.subarray(0,bytesRead)]);
          let end;
          while((end=rem.indexOf(10))>=0){
            const line=rem.subarray(0,end);rem=rem.subarray(end+1);c.offset+=end+1;
            let o;try{o=JSON.parse(line.toString('utf8'));}catch{continue;}
            let event;
            if(o.type==='result')event={type:'result'};
            else if(o.type==='system'&&/^task_(started|progress|notification|updated)$/.test(o.subtype))event=o;
            else if(o.type==='progress'&&o.data?.type==='agent_progress')event=o;
            else if(o.type==='user' && bodyText(o.message?.content).trim().startsWith('<task-notification>'))event=o;
            else if(Array.isArray(o.message?.content)){
              const content=o.message.content.filter(b=>{
                if(b.type==='tool_use'&&['Agent','Task'].includes(b.name)){c.tools.add(b.id);return true;}
                return b.type==='tool_result'&&c.tools.has(b.tool_use_id);
              });
              if(content.length)event={type:o.type,timestamp:o.timestamp,tool_use_result:o.tool_use_result,message:{content}};
            }
            if(event){c.events.push(event);if(c.events.length>5000){c.events.shift();c.truncated=true;}}
          }
        }
      } finally {await handle.close();}
    }
    this.files.delete(file);this.files.set(file,c);
    if(this.files.size>80)this.files.delete(this.files.keys().next().value);
    return c;
  }
}

// 1.82: the CLI writes each subagent's own transcript beside the session's: <project>/<sessionId>/subagents/
// agent-<id>.jsonl, with agent-<id>.meta.json naming the task, kind, model and the Agent tool call that started it.
// Read incrementally and synchronously (small files, one directory listing a call), so a permission request can be
// matched to its agent the moment it arrives: the request names only the tool_use id, and the agent's transcript
// is the one place that id is recorded.
export const subagentDir = (sessionFile, sessionId) => path.join(path.dirname(sessionFile), sessionId, 'subagents');
export class SubagentIndex {
  constructor() { this.dirs = new Map(); }
  read(dir) {
    const d = this.dirs.get(dir) || {agents:new Map()};
    let names; try { names = fsSync.readdirSync(dir); } catch { return d.agents; }
    this.dirs.delete(dir); this.dirs.set(dir, d);
    if (this.dirs.size > 80) this.dirs.delete(this.dirs.keys().next().value);
    for (const n of names) {
      const m = /^agent-([\w-]{1,64})\.jsonl$/.exec(n); if (!m) continue;
      const id = m[1];
      const rec = d.agents.get(id) || {id, file:path.join(dir, n), offset:0, rem:Buffer.alloc(0), ino:null, tools:new Set(), steps:0, messages:0, latest:'', firstAt:null, lastAt:null, meta:null};
      if (!rec.meta) { try { rec.meta = JSON.parse(fsSync.readFileSync(path.join(dir, `agent-${id}.meta.json`), 'utf8')); } catch { } }
      let st; try { st = fsSync.statSync(rec.file); } catch { continue; }
      if (rec.ino != null && (rec.ino !== st.ino || st.size < rec.offset)) Object.assign(rec, {offset:0, rem:Buffer.alloc(0), tools:new Set(), steps:0, messages:0, latest:'', firstAt:null, lastAt:null});
      rec.ino = st.ino;
      if (st.size > rec.offset) {
        const fd = fsSync.openSync(rec.file, 'r');
        try {
          const buf = Buffer.alloc(st.size - rec.offset);
          const got = fsSync.readSync(fd, buf, 0, buf.length, rec.offset);
          let rem = Buffer.concat([rec.rem, buf.subarray(0, got)]), end;
          while ((end = rem.indexOf(10)) >= 0) {
            const line = rem.subarray(0, end); rem = rem.subarray(end + 1); rec.offset += end + 1;
            let o; try { o = JSON.parse(line.toString('utf8')); } catch { continue; }
            this.note(rec, o);
          }
          rec.rem = Buffer.from(rem); // the partial last line, kept as bytes so a split character survives
          rec.offset = st.size - rem.length;
        } finally { fsSync.closeSync(fd); }
      }
      d.agents.set(id, rec);
    }
    return d.agents;
  }
  note(rec, o) {
    if (typeof o.timestamp === 'string') { rec.lastAt = o.timestamp; rec.firstAt ||= o.timestamp; }
    if (o.type !== 'assistant') return;
    for (const b of Array.isArray(o.message?.content) ? o.message.content : []) {
      if (b.type === 'tool_use') { if (typeof b.id === 'string') rec.tools.add(b.id); rec.steps++; rec.latest = 'Using ' + text(b.name, 100); }
      else if (b.type === 'text' && b.text?.trim()) { rec.messages++; rec.latest = text(b.text); }
    }
  }
  // The agent whose transcript records this tool call, or null.
  agentFor(dir, toolUseId) {
    if (!dir || !toolUseId) return null;
    for (const rec of this.read(dir).values()) if (rec.tools.has(toolUseId)) return this.describe(rec);
    return null;
  }
  file(dir, id) { const rec = this.read(dir).get(id); return rec ? this.describe(rec) : null; }
  summary(dir) { return dir ? [...this.read(dir).values()].map(rec => this.describe(rec)) : []; }
  describe(rec) {
    return {id:rec.id, file:rec.file, name:text(rec.meta?.description, 240), kind:text(rec.meta?.agentType, 100), model:text(rec.meta?.model, 100),
      toolUseId:typeof rec.meta?.toolUseId === 'string' ? rec.meta.toolUseId : null, background:rec.meta?.requestShape === 'background',
      latest:rec.latest, steps:rec.steps, messages:rec.messages, firstAt:rec.firstAt, lastAt:rec.lastAt};
  }
}
