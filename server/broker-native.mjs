import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export function createBrokerNativeRuntime({runtime,gateway,socketPath=process.env.MANTA_BROKER_NATIVE_SOCKET,projectsRoot=process.env.MANTA_PROJECTS_ROOT||'/projects'}={}){
  const active=new Set();
  return {startTurn(options){
    const root=fs.realpathSync(projectsRoot),workspace=fs.realpathSync(options.workspace),project=path.relative(root,workspace);
    if(!/^project-[A-Za-z0-9_-]{1,100}$/.test(project))throw Error('Native broker requires a managed project');
    const grant=gateway.grant({runtime,baseUrl:options.baseUrl,apiKey:options.apiKey,model:options.model});
    const controller=new AbortController(),calls=new Map();let done=false,buffer='',timer;
    const socket=net.connect(socketPath);socket.setEncoding('utf8');active.add(socket);
    let resolve,reject;
    const completion=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const send=message=>{if(!socket.destroyed)socket.write(JSON.stringify(message)+'\n');};
    const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);controller.abort();grant.revoke();options.signal?.removeEventListener('abort',cancel);active.delete(socket);socket.destroy();for(const c of calls.values())c.reject(error||Error('Native turn ended'));calls.clear();error?reject(error):resolve(result);};
    const cancel=()=>finish(Object.assign(Error('Native broker task cancelled'),{name:'AbortError'}));
    socket.on('connect',()=>{
      const safe={};for(const key of ['model','sessionId','input','history','instructions','tools','permissionMode','maxTurns'])if(options[key]!==undefined)safe[key]=options[key];
      if(safe.instructions)safe.instructions=safe.instructions.replace('Project folder: '+workspace,'Project folder: /work')+'\nNative tools run in /work. Manta tool file paths are project-relative.';
      send({kind:'native',runtime,project,options:{...safe,apiKey:grant.token,baseUrl:grant.baseUrl}});
    });
    socket.on('data',chunk=>{buffer+=chunk.toString();if(Buffer.byteLength(buffer)>32*1024*1024)return finish(Error('Native broker frame exceeds limit'));
      let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line)continue;
        let message;try{message=JSON.parse(line);}catch{return finish(Error('Invalid native broker protocol'));}
        if(message.type==='result')finish(null,message.result);
        else if(message.type==='error')finish(Object.assign(Error(message.message),{code:message.code}));
        else if(message.type==='event')options.onEvent?.(message.event);
        else if(message.type==='message')options.onMessage?.(message.message);
        else if(message.type==='session')options.onSession?.(message.sessionId,message.metadata);
        else if(message.type==='reply'){const call=calls.get(message.id);if(call){calls.delete(message.id);message.error?call.reject(Error(message.error)):call.resolve(message.result);}}
        else if(message.type==='call'){
          const methods={tool:()=>options.executeTool(message.name,message.args,{signal:controller.signal}),approval:()=>options.requestApproval?.({...message.args,signal:controller.signal})??false,question:()=>options.requestUserInput?.(message.args)??null};
          Promise.resolve().then(()=>{if(!methods[message.method])throw Error('Unsupported native request');return methods[message.method]();}).then(result=>send({type:'reply',id:message.id,result}),error=>send({type:'reply',id:message.id,error:error.message}));
        }
      }
    });
    socket.on('error',error=>finish(error));socket.on('close',()=>{if(!done)finish(Error('Native broker connection closed'));});
    timer=setTimeout(()=>finish(Error('Native task timed out')),3600000);timer.unref?.();
    options.signal?.addEventListener('abort',cancel,{once:true});if(options.signal?.aborted)cancel();
    return {completion,cancel:async()=>cancel(),steer:input=>new Promise((resolve,reject)=>{if(done)return reject(Error('Native turn ended'));const id=randomUUID();calls.set(id,{resolve,reject});send({type:'steer',id,input});})};
  },async close(){for(const socket of active)socket.destroy();active.clear();}};
}
