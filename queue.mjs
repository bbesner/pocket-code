import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export class FollowupQueue {
  constructor(file){
    this.file=file;
    try{this.rows=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(this.rows)||this.rows.some(r=>!r||typeof r.id!=='string'||typeof r.sessionId!=='string'||typeof r.text!=='string'||!Number.isInteger(r.revision)||!['pending','dispatching','uncertain'].includes(r.status)))throw Error('Invalid queue');}
    catch(e){if(e.code!=='ENOENT')throw e;this.rows=[];}
    // A crash may have happened after dispatch; never run an uncertain item again.
    for(const row of this.rows)if(row.status==='dispatching')row.status='uncertain';
  }
  save(next){
    fs.mkdirSync(path.dirname(this.file),{recursive:true});const tmp=this.file+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(next),{mode:0o600});fs.renameSync(tmp,this.file);this.rows=next;
  }
  list(sessionId){return this.rows.filter(r=>r.sessionId===sessionId).map(r=>({...r}));}
  pending(id){return this.list(id).filter(r=>r.status==='pending');}
  add(sessionId,data){
    if(this.list(sessionId).length>=10)throw Object.assign(Error('Queue is full (10 messages).'),{status:429});
    const row={...data,sessionId,id:randomUUID(),revision:1,status:'pending',createdAt:Date.now()};
    this.save([...this.rows,row]);return row;
  }
  edit(sessionId,id,revision,text){
    const r=this.rows.find(x=>x.id===id&&x.sessionId===sessionId);
    if(!r)throw Object.assign(Error('This message already started or was removed.'),{status:409});
    if(r.revision!==revision||r.status!=='pending')throw Object.assign(Error('The queue changed. Refresh before editing.'),{status:409});
    const next={...r,text,revision:r.revision+1};this.save(this.rows.map(x=>x===r?next:x));return next;
  }
  remove(sessionId,id,revision){
    const r=this.rows.find(x=>x.id===id&&x.sessionId===sessionId);if(!r)return;
    if(r.revision!==revision||r.status==='dispatching')throw Object.assign(Error('This message is changing or already starting. Refresh the queue.'),{status:409});
    this.save(this.rows.filter(x=>x!==r));
  }
  async dispatch(sessionId,action){
    // Uncertainty blocks later work as well; preserve explicit order.
    const row=this.list(sessionId)[0];if(!row||row.status!=='pending')return null;
    this.save(this.rows.map(x=>x.id===row.id?{...x,status:'dispatching',revision:x.revision+1}:x));
    try{
      const result=await action(row);
      this.save(this.rows.filter(x=>x.id!==row.id));return result;
    }catch(e){
      try{this.save(this.rows.map(x=>x.id===row.id?{...x,status:'uncertain',error:'Start was not confirmed. Review the conversation before removing this item and sending again.'}:x));}catch{}
      throw e;
    }
  }
}
