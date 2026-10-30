import {fileURLToPath} from 'node:url';
import {runContainerProcess} from './container-process.mjs';
export function createOrbit42ContainerRunner({execute=runContainerProcess}={}){
 const script=fileURLToPath(new URL('../deploy/runner/orbit42-container.py',import.meta.url));
 async function call(mode,input,signal){const r=await execute('/usr/bin/python3',['-B',script,mode],{input,signal,timeoutMs:180000});if(r.code!==0)throw Error(r.stderr.slice(-2000)||'42 worker failed');return JSON.parse(r.stdout);}
 return {async status(){try{return await call('status');}catch(error){return {ready:false,state:'unavailable',reason:error.message,isolated:false,isolation:'shared-container'};}},async run(request,{signal}={}){return call('run',JSON.stringify(request),signal);}};
}
