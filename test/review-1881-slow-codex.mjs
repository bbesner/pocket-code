#!/usr/bin/env node
// Fixture for test/casey-1881-reader.test.mjs (F-3): the fake Codex app-server behind a pass-through that holds a
// turn/start whose text has __SLOWSTART__ for CASEY_SLOW_START_MS (default 2000), as a slow real turn/start would.
// Every other request and every reply passes through unchanged, in order.
import {spawn} from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
const child=spawn(process.execPath,[path.join(import.meta.dirname,'fake-codex.mjs'),...process.argv.slice(2)],{stdio:['pipe','inherit','inherit']});
child.on('exit',code=>process.exit(code??0));
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{try{child.kill(sig)}catch{}});
let chain=Promise.resolve();
const hold=Number(process.env.CASEY_SLOW_START_MS||2000);
readline.createInterface({input:process.stdin}).on('line',line=>{
  let slow=false;try{const m=JSON.parse(line);slow=m.method==='turn/start'&&JSON.stringify(m.params?.input||'').includes('__SLOWSTART__');}catch{}
  chain=chain.then(()=>slow?new Promise(r=>setTimeout(r,hold)):null).then(()=>{try{child.stdin.write(line+'\n')}catch{}});
}).on('close',()=>{chain.then(()=>child.stdin.end());});
