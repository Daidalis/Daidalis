// Runs the existing native protocol adapters INSIDE the isolated task container.
import http from 'node:http';
import readline from 'node:readline';
import fs from 'node:fs';
import {createCodexRuntime} from '../../server/runtimes/codex.mjs';
import {createClaudeRuntime} from '../../server/runtimes/claude.mjs';
if(process.getuid()===0)throw Error('Native tasks require non-root execution');
const send=message=>process.stdout.write(JSON.stringify(message)+'\n');
const pending=new Map();let seq=0,handle,started=false;
const call=(method,args,name)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});send({type:'call',id,method,args,name});});
const proxy=http.createServer((req,res)=>{
  const upstream=http.request({socketPath:'/model-control/model.sock',path:req.url,method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);response.on('error',()=>res.destroy());});
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
});
await new Promise(resolve=>proxy.listen(18765,'127.0.0.1',resolve));
const lines=readline.createInterface({input:process.stdin});
lines.on('line',line=>{
  try{
    if(Buffer.byteLength(line)>24*1024*1024)throw Error('Native input exceeds limit');
    const message=JSON.parse(line);
    if(!started){started=true;void start(message);return;}
    if(message.type==='reply'){const p=pending.get(message.id);if(p){pending.delete(message.id);message.error?p.reject(Error(message.error)):p.resolve(message.result);}}
    else if(message.type==='steer')Promise.resolve(handle.steer(message.input)).then(result=>send({type:'reply',id:message.id,result}),error=>send({type:'reply',id:message.id,error:error.message}));
  }catch(error){send({type:'error',message:error.message});process.exit(1);}
});
async function start(message){
  try{
    const {runtime,options}=message;
    const adapter=runtime==='codex-app-server'?createCodexRuntime({externalSandbox:true}):createClaudeRuntime({configDir:'/task-home/.claude'});
    handle=adapter.startTurn({...options,workspace:'/work',
      onEvent:event=>send({type:'event',event}),onMessage:message=>send({type:'message',message}),onSession:(sessionId,metadata)=>send({type:'session',sessionId,metadata}),
      executeTool:(name,args)=>call('tool',args,name),requestApproval:({signal,...args})=>call('approval',args),requestUserInput:args=>call('question',args)});
    const result=await handle.completion;send({type:'result',result});await adapter.close();
  }catch(error){send({type:'error',message:error.message,code:error.code});}
  finally{proxy.closeAllConnections();proxy.close();process.stdout.write('',()=>process.exit(0));}
}
lines.on('close',()=>{handle?.cancel();setTimeout(()=>process.exit(1),500).unref();});
