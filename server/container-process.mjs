import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
// Bounded process transport for fixed application-owned workers, not shell input.
export function runContainerProcess(file,args,{input='',signal,timeoutMs=180000,maxBytes=32*1024*1024,cwd='/tmp'}={}){
 if(process.platform!=='linux'||!existsSync('/.dockerenv')||process.getuid?.()===0)throw Error('Worker requires a non-root Linux container');
 if(signal?.aborted)return Promise.reject(Error('Cancelled'));
 return new Promise((resolve,reject)=>{
  const child=spawn(file,args,{cwd,detached:true,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',PYTHONDONTWRITEBYTECODE:'1',PROJ_NETWORK:'OFF',OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'},stdio:['pipe','pipe','pipe']});
  let bytes=0,error,hard;const stdout=[],stderr=[];
  const kill=s=>{try{process.kill(-child.pid,s);}catch{}};
  const stop=message=>{error??=Error(message);kill('SIGTERM');hard??=setTimeout(()=>kill('SIGKILL'),1500);};
  const abort=()=>stop('Cancelled');signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const timer=setTimeout(()=>stop('Worker timed out'),timeoutMs);
  for(const [stream,target] of [[child.stdout,stdout],[child.stderr,stderr]])stream.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes)stop('Worker output exceeds limit');else target.push(chunk);});
  child.on('error',e=>{error=e;});child.stdin.on('error',e=>{if(e.code!=='EPIPE')error=e;});
  child.on('close',code=>{clearTimeout(timer);clearTimeout(hard);signal?.removeEventListener('abort',abort);kill('SIGKILL');if(error)return reject(error);resolve({code,stdout:Buffer.concat(stdout).toString(),stderr:Buffer.concat(stderr).toString()});});
  child.stdin.end(input);
 });
}
