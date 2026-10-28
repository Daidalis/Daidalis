import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
export function createBrokerSession({runtime,workspace,options,onCall=async()=>{throw Error('Unsupported callback');},onMessage=()=>{},onClose=()=>{},socketPath=process.env.MANTA_BROKER_NATIVE_SOCKET,projectsRoot=process.env.MANTA_PROJECTS_ROOT||'/projects'}){
 const project=path.relative(fs.realpathSync(projectsRoot),fs.realpathSync(workspace));
 if(!/^project-[A-Za-z0-9_-]{1,100}$/.test(project))throw Error('Managed project required');
 const socket=net.connect(socketPath);socket.setEncoding('utf8');
 let buffer='',done=false,seq=0;const pending=new Map(),control=new AbortController();
 let readyResolve,readyReject;const ready=new Promise((a,b)=>{readyResolve=a;readyReject=b;});ready.catch(()=>{});
 function send(message){if(done)throw Error('Isolated session closed');const data=JSON.stringify(message)+'\n';if(Buffer.byteLength(data)>24*1024*1024)throw Error('Session frame too large');socket.write(data);}
 function close(error=Error('Isolated session closed')){if(done)return;done=true;clearTimeout(startup);control.abort();socket.destroy();readyReject(error);for(const p of pending.values()){p.cleanup();p.reject(error);}pending.clear();onClose(error);}
 const startup=setTimeout(()=>close(Error('Session startup timed out')),60000);startup.unref();
 socket.on('connect',()=>send({kind:'service',runtime,project,options}));
 socket.on('data',chunk=>{
  buffer+=chunk;if(Buffer.byteLength(buffer)>32*1024*1024)return close(Error('Session frame too large'));
  let pos;while((pos=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,pos);buffer=buffer.slice(pos+1);if(!line)continue;
   let m;try{m=JSON.parse(line);}catch{return close(Error('Invalid session response'));}
   if(m.type==='ready'){clearTimeout(startup);readyResolve();}
   else if(m.type==='error')return close(Error(m.message||'Isolated session failed'));
   else if(m.type==='reply'){const p=pending.get(m.id);if(p){pending.delete(m.id);p.cleanup();m.error?p.reject(Error(m.error)):p.resolve(m.result);}}
   else if(m.type==='call')Promise.resolve().then(()=>onCall(m.method,m.args,control.signal)).then(result=>{if(!done)send({type:'reply',id:m.id,result});},error=>{if(!done)send({type:'reply',id:m.id,error:error.message});});
   else onMessage(m);
  }
 });
 socket.on('error',close);socket.on('close',()=>close());
 return {ready,get closed(){return done;},send,close,async request(method,args,{signal,timeoutMs=120000,onSent}={}){
  if(signal?.aborted)throw Error('Cancelled');const abortStartup=()=>close(Error('Cancelled'));signal?.addEventListener('abort',abortStartup,{once:true});try{await ready;}finally{signal?.removeEventListener('abort',abortStartup);}if(signal?.aborted)throw Error('Cancelled');if(done)throw Error('Isolated session closed');
  return new Promise((resolve,reject)=>{const id=++seq,abort=()=>close(Error('Cancelled')),timer=setTimeout(()=>close(Error('Session operation timed out')),timeoutMs);const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};pending.set(id,{resolve,reject,cleanup});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)return abort();try{onSent?.(id);send({type:'request',id,method,args});}catch(error){pending.delete(id);cleanup();reject(error);close(error);}});
 }};
}
