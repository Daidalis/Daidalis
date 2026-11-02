import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createTaskRunner} from './container-task-runner.mjs';

// First-edition deployment: child processes share the app's container and UID.
// Temporary workspaces prevent accidental file collisions, not credential access.
export function createSharedContainerRunner(){
  if(process.platform!=='linux'||!existsSync('/.dockerenv')||process.getuid?.()===0)
    throw Error('Shared-container execution requires a non-root Linux Docker container');
  const script=fileURLToPath(new URL('../deploy/runner/shared-worker.py',import.meta.url));
  const isolation={kind:'shared-container',isolated:false,network:'shared-with-application',credentialsIsolated:false};
  let active=0;
  const commands=new Map();
  async function invoke(payload,{signal,workspace}={}){
    if(signal?.aborted)throw Error('Cancelled');
    if(active>=4)throw Error('Task concurrency limit reached');
    active++;
    let directory;
    try{
      directory=await fs.mkdtemp(path.join(os.tmpdir(),'manta-task-'));
      const home=path.join(directory,'home'),work=workspace||path.join(directory,'work');
      await fs.mkdir(home);if(!workspace)await fs.mkdir(work);
      const result=await new Promise((resolve,reject)=>{
        const child=spawn('/usr/bin/python3',['-B',script],{cwd:work,detached:true,
          env:{PATH:process.env.PATH,LANG:'C.UTF-8',HOME:home,TMPDIR:directory,
            QT_QPA_PLATFORM:'offscreen',LIBGL_ALWAYS_SOFTWARE:'1',OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1',MKL_NUM_THREADS:'1'},stdio:['pipe','pipe','pipe']});
        let failure=null,stdout=[],stderr=[],bytes=0,hard;
        const kill=signal=>{try{process.kill(-child.pid,signal);}catch{}};
        const stop=message=>{failure??=Error(message);kill('SIGTERM');hard??=setTimeout(()=>kill('SIGKILL'),2000);};
        const abort=()=>stop('Cancelled');
        signal?.addEventListener('abort',abort,{once:true});
        if(signal?.aborted)abort();
        const timer=setTimeout(()=>stop('Job timed out'),(payload.timeoutMs||60000)+1000);
        for(const [stream,chunks] of [[child.stdout,stdout],[child.stderr,stderr]])stream.on('data',data=>{
          bytes+=data.length;if(bytes>32*1024*1024)stop('Task output exceeds limit');else chunks.push(data);
        });
        child.on('error',error=>{failure=error;});
        child.stdin.on('error',error=>{if(error.code!=='EPIPE')failure=error;});
        child.on('close',code=>{
          clearTimeout(timer);clearTimeout(hard);signal?.removeEventListener('abort',abort);kill('SIGKILL');
          if(failure)return reject(failure);
          if(code!==0)return reject(Error('Task failed: '+Buffer.concat(stderr).toString().slice(-2000)));
          try{resolve({...JSON.parse(Buffer.concat(stdout)),isolation});}catch(error){reject(error);}
        });
        child.stdin.end(JSON.stringify(payload)+'\n');
      });
      return result;
    }finally{
      active--;
      if(directory)await fs.rm(directory,{recursive:true,force:true});
    }
  }
  const runner=createTaskRunner({invoke,isolated:false});
  return {...runner,async command({workspace,command,timeoutMs=30000,signal}){
    if(typeof command!=='string'||!command.trim()||command.length>16000)throw Error('Invalid command');
    if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('Invalid command timeout');
    const root=await fs.realpath(workspace),previous=commands.get(root)||Promise.resolve();
    const task=previous.catch(()=>{}).then(()=>invoke({kind:'shared-command',command,timeoutMs:Math.min(60000,timeoutMs)},{signal,workspace:root}));
    commands.set(root,task);
    try{return await task;}finally{if(commands.get(root)===task)commands.delete(root);}
  }};
}
