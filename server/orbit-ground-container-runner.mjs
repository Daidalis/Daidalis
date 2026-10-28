import {fileURLToPath} from 'node:url';
import {runContainerProcess} from './container-process.mjs';
export function createOrbitGroundContainerRunner({execute=runContainerProcess}={}){
 const script=fileURLToPath(new URL('../deploy/runner/orbit-ground-container.py',import.meta.url));
 const controllers=new Set();let closed=false;
 async function call(mode,input,options={}){if(closed)throw Error('Orbit-ground runner closed');const r=await execute('/usr/bin/python3',['-B',script,mode],{input,maxBytes:8*1024*1024,...options});if(r.code!==0)throw Error(r.stderr.slice(-2000)||'Orbit-ground worker failed');return JSON.parse(r.stdout);}
 return {requiresNativeFiles:true,async status(){try{return await call('status');}catch(error){return {ready:false,state:'unavailable',reason:error.message,isolated:false};}},async run(request,{signal,timeoutMs=180000}={}){
  const controller=new AbortController();controllers.add(controller);
  try{return await call('run',JSON.stringify(request),{signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal,timeoutMs});}finally{controllers.delete(controller);}
 },async close(){closed=true;for(const c of controllers)c.abort();}};
}
