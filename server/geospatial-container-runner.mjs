import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {runContainerProcess} from './container-process.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function createGeospatialContainerRunner({execute=runContainerProcess}={}){
 const script=fileURLToPath(new URL('../deploy/runner/geospatial-container.py',import.meta.url));
 const controllers=new Set();let closed=false;
 async function call(mode,input,signal){if(closed)throw Error('GIS runner closed');const result=await execute('/usr/bin/python3',['-B',script,mode],{input,signal,maxBytes:8*1024*1024});if(result.code!==0)throw Error(result.stderr.slice(-2000)||'GIS worker failed');return JSON.parse(result.stdout);}
 async function status(){try{return await call('status');}catch(error){return {ready:false,status:'unavailable',reason:error.message,isolated:false,isolation:'shared-container'};}}
 return {status,async prepare(){const state=await status();if(!state.ready)throw Error('GIS toolchain unavailable; rebuild with the gis group. '+state.reason);return state;},async run(request,{signal,onLog=()=>{}}={}){
  if(!/^geospatial_[a-f0-9]{32}$/.test(request?.jobId)||!Buffer.isBuffer(request.sourceBytes)||request.sourceBytes.length>32*1024*1024||sha(request.sourceBytes)!==request.sourceHash||!/^[a-f0-9]{64}$/.test(request.inputHash))throw Error('GIS requires bounded source bytes and exact hashes');
  const controller=new AbortController();controllers.add(controller);const merged=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  try{
   const ready=await status();if(!ready.ready)throw Error('GIS toolchain unavailable; rebuild with gis: '+ready.reason);
   const output=await call('run',JSON.stringify({...request,schema:'manta-geospatial-job-v1',sourceBytes:request.sourceBytes.length,sourceBase64:request.sourceBytes.toString('base64')}),merged);
   if(output.schema!=='manta-geospatial-runner-result-v1'||!Array.isArray(output.files)||typeof output.success!=='boolean')throw Error(output.reason||'Malformed GIS result');
   if(output.success&&(output.receipt?.inputHash!==request.inputHash||output.receipt.sourceSha256!==request.sourceHash||output.receipt.workerSha256!==ready.workerSha256||output.receipt.toolVersions.gdal!==ready.versions.gdal||output.receipt.toolVersions.proj!==ready.versions.proj))throw Error('GIS receipt differs from inputs or installed toolchain');
   onLog(output.diagnostics||'');return {...output,readinessReceiptSha256:ready.receiptSha256,toolchain:ready};
  }finally{controllers.delete(controller);}
 },async close(){closed=true;for(const c of controllers)c.abort();}};
}
