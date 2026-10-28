// An installer/probe may not outlive its owning daemon. The IPC channel closes even
// on SIGKILL, including the gap before the daemon has saved our pid. No work begins
// until the daemon sends the command after saving that identity.
import {spawn} from 'node:child_process';
function stop(){try{process.kill(-process.pid,'SIGKILL');}catch{process.exit(1);}}
process.on('disconnect',stop);
process.once('message',({bin,args,cwd})=>{
  const child=spawn(bin,args,{cwd,env:process.env,stdio:['pipe',1,2]});
  child.stdin.on('error',()=>{});
  process.stdin.pipe(child.stdin);
  child.on('error',()=>{if(process.connected)process.send({spawnError:true},()=>process.exit(127));else stop();});
  child.on('exit',code=>process.exit(code??1));
});
