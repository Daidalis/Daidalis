import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {safePath} from './sandbox.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function createFlightContainerRunner({socketPath=process.env.MANTA_FLIGHT_SOCKET,rpc:externalRpc}={}){
 if(!externalRpc&&(!socketPath||!path.isAbsolute(socketPath)))throw Error('Fixed flight socket required');
 const sockets=new Set();let closed=false;
 function rpc(method,payload,{signal,timeoutMs=960000}={}){
  if(externalRpc)return externalRpc(method,payload,{signal,timeoutMs});
  if(closed||signal?.aborted)return Promise.reject(Error('Flight runner closed or cancelled'));
  const body=JSON.stringify({method,payload})+'\n';if(Buffer.byteLength(body)>8*1024*1024)throw Error('Flight input exceeds bound');
  return new Promise((resolve,reject)=>{
   const socket=net.connect(socketPath);sockets.add(socket);let bytes=0,buffer='',done=false;
   const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);sockets.delete(socket);socket.destroy();error?reject(error):resolve(result);};
   const abort=()=>finish(Error('Flight job cancelled')),timer=setTimeout(()=>finish(Error('Flight job timed out')),timeoutMs);
   signal?.addEventListener('abort',abort,{once:true});socket.setEncoding('utf8');
   socket.on('close',()=>{if(!done)finish(Error('Flight transport closed'));});socket.on('connect',()=>socket.write(body));socket.on('error',error=>finish(error));socket.on('end',()=>{if(!done)finish(Error('Flight worker closed without a response'));});
   socket.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>40*1024*1024)return finish(Error('Flight output exceeds bound'));buffer+=chunk;if(!buffer.includes('\n'))return;try{const response=JSON.parse(buffer);if(!response.ok)throw Error(response.error);finish(null,response.result);}catch(error){finish(error);}});
   if(signal?.aborted)abort();
  });
 }
 return {async status(){try{return await rpc('status',null,{timeoutMs:30000});}catch(error){return {ready:false,workerReady:false,state:'unavailable',type:'container',reason:error.message,tools:{'nos3-stf':{ready:false,available:false,reason:error.message}}};}},
  template:()=>rpc('stf-template',null,{timeoutMs:30000}),
  async run(args,ctx={}){const output=await rpc('stf',args,ctx);if(output.receipt?.inputHash!==args.inputHash||JSON.stringify(output.receipt?.sourceFiles)!==JSON.stringify(args.sourceFiles.map(({path,sha256})=>({path,sha256}))))throw Error('STF receipt differs from submitted inputs');return output;},
  async nos3({job,dir,signal}){
   const report=await rpc('nos3',{scope:job.scope,inputHash:job.inputHash,baseline:job.baseline},{signal,timeoutMs:job.timeoutMs});
   if(report.inputHash!==job.inputHash||report.baselineHash!==job.baseline.baselineHash||report.scope!==job.scope||!Array.isArray(report.checks)||!report.checks.length||report.checks.some(c=>typeof c.passed!=='boolean'||!c.id||!c.criterion)||report.passed!==report.checks.every(c=>c.passed))throw Error('NOS3 receipt or acceptance criteria mismatch');
   if(job.scope==='integration'&&report.passed&&(!report.fullNos3Simulation||!report.telemetryFiles?.length))throw Error('NOS3 integration lacks live telemetry');
   if(!Array.isArray(report.files)||report.files.length>100)throw Error('Invalid NOS3 evidence files');
   let total=0;const names=new Set();
   for(const file of report.files){if(typeof file.path!=='string'||names.has(file.path)||! /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(file.path))throw Error('Invalid NOS3 artifact path');names.add(file.path);const bytes=Buffer.from(file.contentBase64,'base64');total+=bytes.length;if(total>2500000||sha(bytes)!==file.sha256)throw Error('NOS3 evidence hash mismatch');}
   const evidence=report.files.find(f=>f.path==='verification.json');if(!evidence)throw Error('NOS3 verification report missing');
   const verification=JSON.parse(Buffer.from(evidence.contentBase64,'base64'));if(verification.passed!==report.passed||JSON.stringify(verification.checks)!==JSON.stringify(report.checks))throw Error('NOS3 report differs from evidence');
   for(const file of report.files){const target=safePath(dir,'native/'+file.path,{write:true});await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,Buffer.from(file.contentBase64,'base64'),{flag:'wx'});}
   return {...report,files:undefined};
  },async close(){closed=true;for(const s of sockets)s.destroy();sockets.clear();}
 };
}
export function withFlightTools(numerical,flight){return {async status(){const [base,native]=await Promise.all([numerical.status(),flight.status()]);return {...base,tools:{...base.tools,...native.tools}};},prepare:ctx=>numerical.prepare(ctx),run:(args,ctx)=>args.toolId==='nos3-stf'?flight.run(args,ctx):numerical.run(args,ctx),async close(){await flight.close();await numerical.close();}};}
