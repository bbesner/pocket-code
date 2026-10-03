import {marked} from 'marked';
import path from 'node:path';
export const REPORT_EXTENSIONS = new Set(['.pdf','.csv','.tsv','.xlsx','.docx','.pptx','.txt','.md','.html','.json','.zip','.png','.jpg','.jpeg','.gif','.webp']);
export function reference(href, label='') {
  const value=String(href || '').trim();
  if(/^https?:\/\//i.test(value)){
    try {const url=new URL(value);if(url.username||url.password)return null;
      return {kind:'link',target:url.href,label:String(label||url.hostname).slice(0,180),detail:url.hostname};
    }catch{return null;}
  }
  if(!/^\/(home|Users|root)\//.test(value) || value.split('/').some(x=>x.startsWith('.')) || !REPORT_EXTENSIONS.has(path.extname(value).toLowerCase()))return null;
  return {kind:'file',target:value,label:String(label||path.basename(value)).slice(0,180),detail:path.extname(value).slice(1).toUpperCase()+' file'};
}
export function collectResults(messages,{limit=200}={}){
  const found=new Map();let matched=0;
  const add=(r,ts)=>{if(!r)return;matched++;if(found.has(r.target))found.delete(r.target);found.set(r.target,{...r,at:ts||null});if(found.size>limit)found.delete(found.keys().next().value);};
  for(const msg of messages){
    if(msg.role!=='assistant')continue;
    for(const b of msg.blocks||[]){
      if(b.t==='tool' && ['Write','Edit','fileChange'].includes(b.name))add(reference(b.detail),msg.ts);
      if(b.t!=='text')continue;
      const text=String(b.text||'').slice(0,250000);
      try {marked.walkTokens(marked.lexer(text),token=>{
        if(token.type==='link'||token.type==='image')add(reference(token.href,token.text),msg.ts);
        if(token.type==='codespan' && /^\//.test(token.text))add(reference(token.text),msg.ts);
      });}catch{}
      for(const m of text.matchAll(/^\s*(\/(?:home|Users|root)\/[^\n`]+\.(?:pdf|csv|tsv|xlsx|docx|pptx|txt|md|html|json|zip|png|jpe?g|gif|webp))\s*$/gmi))add(reference(m[1]),msg.ts);
    }
  }
  return {results:[...found.values()].reverse(),limited:matched>limit};
}
