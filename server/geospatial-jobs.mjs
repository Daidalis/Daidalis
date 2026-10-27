import fs from 'node:fs/promises';
import {constants as FC} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {safePath} from './sandbox.mjs';

const HASH=/^[a-f0-9]{64}$/;
const ID=/^geospatial_[a-f0-9]{32}$/;
const TERMINAL=new Set(['completed','failed','cancelled','interrupted']);
const MAX_SOURCE=32*1024*1024;
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const now=()=>new Date().toISOString();
const clone=value=>JSON.parse(JSON.stringify(value));
const fail=(message,code='INVALID_INPUT')=>Object.assign(Error(message),{code,statusCode:code==='REVISION_CONFLICT'?409:400});
const aborted=signal=>{if(signal?.aborted)throw signal.reason||fail('Cancelled','CANCELLED');};

function normalize(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>!['projectId','path','expectedHash','expectedSourceEpsg','featureIdField','points','timeoutMs'].includes(key)))throw fail('Unknown geospatial job field');
  const relative=args.path;
  if(typeof relative!=='string'||relative.length>500||!relative.toLowerCase().endsWith('.zip')||relative.startsWith('.')||relative.includes('\\')||relative.split('/').some(part=>!part||part==='.'||part==='..'||part.startsWith('.')))throw fail('Use a project-relative Shapefile ZIP path');
  if(!HASH.test(args.expectedHash||''))throw fail('The actual ZIP SHA-256 is required');
  if(![4269,4326].includes(args.expectedSourceEpsg))throw fail('GIS v1 supports only geographic NAD83 EPSG:4269 or WGS84 EPSG:4326 source CRS');
  const featureIdField=args.featureIdField??'STATEFP';
  if(typeof featureIdField!=='string'||! /^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(featureIdField))throw fail('Invalid feature ID field name');
  const points=args.points??[];
  if(!Array.isArray(points)||points.length>100)throw fail('Use at most 100 bounded control points');
  const ids=new Set();
  const controls=points.map(point=>{
    if(!point||typeof point!=='object'||Array.isArray(point)||Object.keys(point).some(key=>!['id','lon','lat','crs','featureId','expected'].includes(key))||typeof point.id!=='string'||! /^[A-Za-z0-9_.-]{1,80}$/.test(point.id)||ids.has(point.id))throw fail('Invalid or duplicate control point ID');
    ids.add(point.id);
    if(!Number.isFinite(point.lon)||!Number.isFinite(point.lat)||Math.abs(point.lon)>180||Math.abs(point.lat)>90)throw fail('Control points need finite geographic longitude/latitude');
    const crs=point.crs??'EPSG:4326';
    if(crs!=='EPSG:4326'&&crs!==`EPSG:${args.expectedSourceEpsg}`)throw fail('Control coordinates must be WGS84 or the explicitly expected source CRS');
    if(point.featureId!==undefined&&(typeof point.featureId!=='string'||! /^[A-Za-z0-9_.-]{1,32}$/.test(point.featureId)))throw fail('Invalid feature ID');
    if(point.expected!==undefined&&!['inside','outside','boundary'].includes(point.expected))throw fail('Expected result must be inside, outside or boundary');
    return {id:point.id,lon:point.lon,lat:point.lat,crs,...(point.featureId?{featureId:point.featureId}:{}),...(point.expected?{expected:point.expected}:{})};
  });
  const timeoutMs=Math.min(Math.max(Number.isFinite(args.timeoutMs)?args.timeoutMs:180000,1000),600000);
  return {projectId:args.projectId,path:relative,expectedHash:args.expectedHash,expectedSourceEpsg:args.expectedSourceEpsg,featureIdField,points:controls,timeoutMs};
}

async function atomicJson(file,value){
  const temporary=file+'.'+crypto.randomUUID()+'.tmp';
  try{const handle=await fs.open(temporary,FC.O_WRONLY|FC.O_CREAT|FC.O_EXCL|FC.O_NOFOLLOW,0o600);try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}await fs.rename(temporary,file);}finally{await fs.rm(temporary,{force:true});}
}

/** Project-scoped, durable native GIS jobs. Source bytes never enter model text. */
export async function createGeospatialJobsService({dataDir,store,runner,emit=()=>{}}={}){
  if(!dataDir||!store?.workspace)throw Error('Geospatial jobs require private dataDir and project store');
  const disk=path.join(dataDir,'geospatial-jobs');await fs.mkdir(disk,{recursive:true,mode:0o700});
  const jobs=new Map(),events=new EventEmitter(),controllers=new Map(),queue=[],tasks=new Set();events.setMaxListeners(100);
  let active=false,closed=false;
  const workspace=projectId=>{if(typeof projectId!=='string'||!projectId)throw fail('projectId required');return store.workspace(projectId);};
  const scoped=args=>{workspace(args?.projectId);if(!ID.test(args?.jobId||''))throw fail('Invalid geospatial job ID');const job=jobs.get(args.jobId);if(!job||job.projectId!==args.projectId)throw fail('Job does not belong to this project');return job;};
  const publicJob=job=>{const copy=clone(job);delete copy.artifactHashes;delete copy.resultSha256;return copy;};
  const folder=job=>safePath(workspace(job.projectId),job.relative);
  async function persist(job){await atomicJson(path.join(disk,job.id+'.json'),job);const summary=publicJob(job);events.emit(job.id,summary);emit({projectId:job.projectId,threadId:job.threadId,runId:job.runId,type:'geospatial.'+job.status,message:job.reason||`GIS job ${job.status}`,data:{jobId:job.id,status:job.status,resultPath:job.resultPath||null}});}
  async function artifact(job,relative,bytes,mimeType){
    if(!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?$/.test(relative)||relative.includes('..'))throw Error('Invalid GIS artifact filename');
    const file=safePath(folder(job),relative,{write:true});await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
    const handle=await fs.open(file,FC.O_WRONLY|FC.O_CREAT|FC.O_EXCL|FC.O_NOFOLLOW,0o600);
    try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
    const entry={name:path.basename(relative),path:job.relative+'/'+relative,sha256:sha(bytes),bytes:Buffer.byteLength(bytes),mimeType};
    job.artifactHashes[relative]=entry;return entry;
  }
  for(const name of await fs.readdir(disk)){
    if(!/^geospatial_[a-f0-9]{32}\.json$/.test(name))continue;
    const job=JSON.parse(await fs.readFile(path.join(disk,name),'utf8'));
    if(!ID.test(job.id)||job.id+'.json'!==name)throw Error('Invalid persisted GIS job');
    if(!TERMINAL.has(job.status)){job.status='interrupted';job.reason='Manta stopped before the GIS execution receipt was committed';job.finishedAt=now();await atomicJson(path.join(disk,name),job);}jobs.set(job.id,job);
  }
  async function finish(job,output){
    const success=output.success===true&&output.exitCode===0;
    const files=output.files||[];if(!Array.isArray(files)||files.length>8)throw Error('GIS runner returned too many files');
    if(success&&(files.length!==2||new Set(files.map(file=>file.path)).size!==2||!files.some(file=>file.path==='preview.geojson')||!files.some(file=>file.path==='checks.csv')))throw Error('Successful GIS run must provide one preview and one check table');
    let total=0;const verifiedFiles=[];
    if(!success&&files.length)throw Error('Failed GIS run cannot publish preview artifacts');
    for(const file of files){
      if(!['preview.geojson','checks.csv'].includes(file.path)||typeof file.contentBase64!=='string')throw Error('Unsupported GIS output file');
      const bytes=Buffer.from(file.contentBase64,'base64');total+=bytes.length;
      if(total>3*1024*1024||sha(bytes)!==file.sha256)throw Error('GIS output integrity mismatch');
      verifiedFiles.push({path:file.path,bytes});
    }
    for(const file of verifiedFiles){
      const bytes=file.bytes;
      await artifact(job,'outputs/'+file.path,bytes,file.path.endsWith('.geojson')?'application/geo+json':'text/csv');
    }
    const receipt={schema:'manta-geospatial-execution-v1',jobId:job.id,inputHash:job.inputHash,source:{path:job.source.path,sha256:job.source.sha256,bytes:job.source.bytes},expectedSourceEpsg:job.expectedSourceEpsg,points:job.points,tool:output.tool||null,runnerReceipt:output.receipt||null,toolchain:output.toolchain||null,readinessReceiptSha256:output.readinessReceiptSha256||null,executionSucceeded:success,startedAt:job.startedAt,finishedAt:job.finishedAt,scope:'Administrative GIS geometry/CRS checks only; no orbit, footprint, collection approval, or STF completion claim'};
    await artifact(job,'receipt.json',Buffer.from(JSON.stringify(receipt,null,2)+'\n'),'application/json');
    const result={schema:'manta-geospatial-result-v1',jobId:job.id,status:job.status,ready:true,executionSucceeded:success,passed:success&&output.verification?.status==='passed'?true:output.verification?.status==='failed'?false:null,source:receipt.source,inputHash:job.inputHash,expectedSourceEpsg:job.expectedSourceEpsg,tool:output.tool||null,metadata:output.metadata||null,verification:output.verification||{status:'unknown',checks:[]},diagnostics:output.diagnostics||output.reason||'',receipt,resultPath:job.relative+'/result.json',limitations:['Point-in-administrative-polygon checks do not establish mission collection permission, sensor footprint, orbit coverage or ground delivery.','Display GeoJSON is simplified and transformed to EPSG:4326; all checks use the full original source geometry.','EPSG:4326 WGS84 controls are transformed to an EPSG:4269 NAD83 source by the installed GDAL/PROJ. The operation or grid choice and positional uncertainty are not independently quantified here; use source-CRS controls for exact boundary checks and review near-boundary WGS84 conclusions independently.']};
    await artifact(job,'result.json',Buffer.from(JSON.stringify(result,null,2)+'\n'),'application/json');
    job.resultPath=result.resultPath;job.resultSha256=job.artifactHashes['result.json'].sha256;job.artifacts=Object.values(job.artifactHashes);
    if(store.add)for(const entry of job.artifacts)store.add('artifacts',{id:'artifact_'+crypto.randomUUID(),projectId:job.projectId,threadId:job.threadId,runId:job.runId,name:job.id+' · '+entry.name,path:entry.path,type:entry.mimeType,createdAt:now()});
  }
  async function execute(job){
    const controller=new AbortController();controllers.set(job.id,controller);const timeout=setTimeout(()=>{job.timedOut=true;controller.abort(fail('GIS job timed out','TIMEOUT'));},job.timeoutMs);timeout.unref?.();
    let output,logs='';
    try{
      if(job.cancelRequested)return;
      job.status='running';job.startedAt=now();await persist(job);
      const handle=await fs.open(safePath(folder(job),'source.zip'),FC.O_RDONLY|FC.O_NOFOLLOW);
      let source;try{source=await handle.readFile();}finally{await handle.close();}
      if(source.length!==job.source.bytes||sha(source)!==job.source.sha256)throw Error('Pinned GIS source snapshot integrity mismatch');
      output=await runner.run({jobId:job.id,inputHash:job.inputHash,sourceHash:job.source.sha256,sourceBytes:source,expectedSourceEpsg:job.expectedSourceEpsg,featureIdField:job.featureIdField,points:job.points},{signal:controller.signal,onLog:line=>{logs=(logs+String(line).slice(0,3000)+'\n').slice(-100000);}});
      if(controller.signal.aborted||job.cancelRequested)throw fail('Cancelled','CANCELLED');
      if(output.success&&(!output.receipt||output.receipt.sourceSha256!==job.source.sha256||output.receipt.inputHash!==job.inputHash))throw Error('GIS runner receipt does not bind exact source and control inputs');
      job.status=output.success?'completed':'failed';job.reason=output.success?undefined:(output.reason||output.diagnostics||'GIS worker did not complete').slice(0,2000);job.finishedAt=now();
      await artifact(job,'execution.log',Buffer.from(logs+String(output.diagnostics||'')+'\n'),'text/plain');
      await finish(job,output);
    }catch(error){
      job.status=job.cancelRequested?'cancelled':job.shutdown?'interrupted':'failed';job.reason=job.timedOut?'GIS job timed out':String(error.message).slice(0,2000);job.finishedAt=now();
      await artifact(job,'execution.log',Buffer.from(logs+job.reason+'\n'),'text/plain').catch(()=>{});
      await finish(job,{success:false,exitCode:2,reason:job.reason,diagnostics:job.reason,files:[]});
    }finally{clearTimeout(timeout);controllers.delete(job.id);await persist(job);}
  }
  function pump(){if(closed||active)return;const job=queue.shift();if(!job)return;if(TERMINAL.has(job.status)){queueMicrotask(pump);return;}active=true;let task;task=execute(job).catch(async error=>{job.status='failed';job.reason='GIS result persistence failed: '+String(error.message).slice(0,1000);job.finishedAt=now();await persist(job);}).finally(()=>{active=false;tasks.delete(task);pump();});tasks.add(task);}
  const service={
    async catalog({projectId}={}){if(projectId)workspace(projectId);return {tool:{id:'gdal-proj',name:'GDAL / PROJ',operations:['classify-points'],sourceFormats:['Shapefile ZIP'],controlCrs:['EPSG:4326','matching source EPSG'],scope:'Administrative GIS geometry and CRS only'},environment:runner?.status?await runner.status():{ready:false,status:'unavailable'}};},
    async prepare({projectId}={},ctx={}){workspace(projectId);if(!runner?.prepare)throw Error('Isolated GIS runner unavailable');return runner.prepare({signal:ctx.signal,onLog:line=>emit({projectId,runId:ctx.runId,type:'geospatial.environment.log',message:String(line).slice(0,2000)})});},
    async submit(args={},ctx={}){
      const input=normalize(args),ws=workspace(input.projectId);if(!runner?.run)throw Error('Isolated GIS runner unavailable');aborted(ctx.signal);
      const file=safePath(ws,input.path),handle=await fs.open(file,FC.O_RDONLY|FC.O_NOFOLLOW);
      let source;try{const stat=await handle.stat();if(!stat.isFile()||stat.size<4||stat.size>MAX_SOURCE)throw fail('Shapefile ZIP must be a regular file up to 32 MiB');source=await handle.readFile();}finally{await handle.close();}
      if(sha(source)!==input.expectedHash)throw fail('Source ZIP SHA-256 mismatch; re-import or rehash the current bytes','REVISION_CONFLICT');
      aborted(ctx.signal);
      const jobId='geospatial_'+crypto.randomUUID().replaceAll('-',''),relative='engineering/geospatial/'+jobId;
      const config={source:{path:input.path,sha256:input.expectedHash,bytes:source.length},expectedSourceEpsg:input.expectedSourceEpsg,featureIdField:input.featureIdField,points:input.points};
      const job={id:jobId,jobId,projectId:input.projectId,threadId:ctx.threadId||null,runId:ctx.runId||null,status:'queued',createdAt:now(),relative,...config,inputHash:sha(JSON.stringify(config)),timeoutMs:input.timeoutMs,artifactHashes:{}};
      await fs.mkdir(safePath(ws,relative,{write:true}),{recursive:true,mode:0o700});
      await artifact(job,'source.zip',source,'application/zip');
      await artifact(job,'input.json',Buffer.from(JSON.stringify({schema:'manta-geospatial-input-v1',...config,inputHash:job.inputHash},null,2)+'\n'),'application/json');
      jobs.set(job.id,job);await persist(job);queue.push(job);queueMicrotask(pump);return publicJob(job);
    },
    async list({projectId}={}){workspace(projectId);return [...jobs.values()].filter(job=>job.projectId===projectId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(publicJob);},
    async status(args){return publicJob(scoped(args));},
    async result(args){const job=scoped(args);if(!TERMINAL.has(job.status))return {jobId:job.id,status:job.status,ready:false};if(!job.resultSha256)return {jobId:job.id,status:job.status,ready:true,integrity:{verified:false,reason:'No committed result receipt'}};
      try{const contents=await fs.readFile(safePath(folder(job),'result.json'));if(sha(contents)!==job.resultSha256)throw Error('GIS result hash mismatch');for(const [relative,entry] of Object.entries(job.artifactHashes)){const bytes=await fs.readFile(safePath(folder(job),relative));if(sha(bytes)!==entry.sha256)throw Error('GIS artifact hash mismatch: '+relative);}return {...JSON.parse(contents),artifacts:clone(job.artifacts||[]),integrity:{verified:true}};}catch(error){return {jobId:job.id,status:job.status,ready:true,integrity:{verified:false,reason:error.message},artifacts:clone(job.artifacts||[])};}
    },
    async wait(args,{signal,timeoutMs=1800000}={}){const job=scoped(args);if(TERMINAL.has(job.status))return {...publicJob(job),result:await service.result(args)};aborted(signal);return new Promise((resolve,reject)=>{const cleanup=()=>{clearTimeout(timer);events.off(job.id,changed);signal?.removeEventListener('abort',abort);};const changed=async next=>{if(TERMINAL.has(next.status)){cleanup();try{resolve({...next,result:await service.result(args)});}catch(error){reject(error);}}};const abort=()=>{cleanup();reject(fail('Cancelled waiting; GIS job continues','CANCELLED'));};const timer=setTimeout(()=>{cleanup();resolve({...publicJob(job),waitTimedOut:true});},Math.min(Math.max(timeoutMs,1),1800000));events.on(job.id,changed);signal?.addEventListener('abort',abort,{once:true});if(TERMINAL.has(job.status))changed(publicJob(job));});},
    async cancel(args){const job=scoped(args);if(TERMINAL.has(job.status))return publicJob(job);job.cancelRequested=true;if(controllers.has(job.id))controllers.get(job.id).abort(fail('Cancelled by user','CANCELLED'));else{job.status='cancelled';job.reason='Cancelled before GIS execution';job.finishedAt=now();await finish(job,{success:false,exitCode:2,reason:job.reason,files:[]});await persist(job);}return publicJob(job);},
    async readOutput(args){const job=scoped(args);let relative=args.file;if(typeof relative==='string'&&relative.startsWith(job.relative+'/'))relative=relative.slice(job.relative.length+1);const entry=job.artifactHashes[relative];if(!entry)throw fail('Unknown GIS output');const buffer=await fs.readFile(safePath(folder(job),relative));if(sha(buffer)!==entry.sha256)throw Error('GIS artifact integrity mismatch');return {buffer,contentType:entry.mimeType,sha256:entry.sha256};},
    async close(){closed=true;for(const job of jobs.values())if(!TERMINAL.has(job.status)){job.shutdown=true;if(controllers.has(job.id))controllers.get(job.id).abort(fail('Manta closing','INTERRUPTED'));else{job.status='interrupted';job.reason='Manta stopped before GIS execution';job.finishedAt=now();await persist(job);}}await Promise.allSettled([...tasks]);},
  };
  return service;
}
