import fs from 'node:fs/promises';
import {constants as FC} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {safePath} from './sandbox.mjs';

const ID=/^orbitground_[a-f0-9]{32}$/;
const ORBIT_ID=/^orbit42_[a-f0-9]{32}$/;
const HASH=/^[a-f0-9]{64}$/;
const TERMINAL=new Set(['completed','failed','cancelled','interrupted']);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const now=()=>new Date().toISOString();
const clone=value=>JSON.parse(JSON.stringify(value));
const fail=(message,code='INVALID_INPUT')=>Object.assign(Error(message),{code,statusCode:code==='REVISION_CONFLICT'?409:400});
const aborted=signal=>{if(signal?.aborted)throw signal.reason||fail('Cancelled','CANCELLED');};

async function atomicJson(file,value){
  const temporary=file+'.'+crypto.randomUUID()+'.tmp';
  try{const handle=await fs.open(temporary,FC.O_WRONLY|FC.O_CREAT|FC.O_EXCL|FC.O_NOFOLLOW,0o600);try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}await fs.rename(temporary,file);}finally{await fs.rm(temporary,{force:true});}
}
async function readRegular(file,maximum){
  const handle=await fs.open(file,FC.O_RDONLY|FC.O_NOFOLLOW);
  try{const stat=await handle.stat();if(!stat.isFile()||stat.size>maximum)throw Error('Pinned evidence is not a bounded regular file');const bytes=await handle.readFile();if(bytes.length!==stat.size)throw Error('Pinned evidence changed during read');return bytes;}finally{await handle.close();}
}

/** A separate evidence job: never modifies the NASA 42 or GIS source jobs. */
export async function createOrbitGroundService({dataDir,store,orbit42Jobs,geospatialJobs,runner,allowedCensusHashes=null,emit=()=>{}}={}){
  if(!dataDir||!store?.workspace||!orbit42Jobs?.result||!geospatialJobs?.catalog||!runner?.run)throw Error('Orbit-ground service requires project store, native orbit/GIS services and isolated runner');
  if(allowedCensusHashes!==null&&(!Array.isArray(allowedCensusHashes)||allowedCensusHashes.length<1||allowedCensusHashes.some(value=>!HASH.test(value))))throw Error('Orbit-ground source policy requires SHA-256 hashes');
  const permitted=allowedCensusHashes===null?null:new Set(allowedCensusHashes);
  const disk=path.join(dataDir,'orbit-ground-jobs');await fs.mkdir(disk,{recursive:true,mode:0o700});
  const jobs=new Map(),events=new EventEmitter(),controllers=new Map(),queue=[],tasks=new Set();events.setMaxListeners(100);
  let active=false,closed=false;
  const workspace=projectId=>{if(typeof projectId!=='string'||!projectId)throw fail('projectId required');return store.workspace(projectId);};
  const scoped=args=>{workspace(args?.projectId);if(!ID.test(args?.jobId||''))throw fail('Invalid orbit-ground job ID');const job=jobs.get(args.jobId);if(!job||job.projectId!==args.projectId)throw fail('Orbit-ground job does not belong to this project');return job;};
  const folder=job=>safePath(workspace(job.projectId),job.relative);
  const publicJob=job=>{const copy=clone(job);delete copy.artifactHashes;delete copy.resultSha256;return copy;};
  async function persist(job){await atomicJson(path.join(disk,job.id+'.json'),job);const summary=publicJob(job);events.emit(job.id,summary);emit({projectId:job.projectId,threadId:job.threadId,runId:job.runId,type:'orbit-ground.'+job.status,message:job.reason||'Orbit-ground cross-check '+job.status,data:{jobId:job.id,status:job.status,resultPath:job.resultPath||null}});}
  async function artifact(job,name,bytes,mimeType){
    if(!/^[A-Za-z0-9_.-]+$/.test(name)||name.includes('..'))throw Error('Invalid orbit-ground artifact name');
    const target=safePath(folder(job),name,{write:true}),handle=await fs.open(target,FC.O_WRONLY|FC.O_CREAT|FC.O_EXCL|FC.O_NOFOLLOW,0o600);
    try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
    const entry={name,path:job.relative+'/'+name,sha256:sha(bytes),bytes:bytes.length,mimeType};job.artifactHashes[name]=entry;return entry;
  }
  for(const name of await fs.readdir(disk)){
    if(!/^orbitground_[a-f0-9]{32}\.json$/.test(name))continue;
    const job=JSON.parse(await fs.readFile(path.join(disk,name),'utf8'));
    if(!ID.test(job.id)||name!==job.id+'.json')throw Error('Invalid persisted orbit-ground job');
    if(!TERMINAL.has(job.status)){job.status='interrupted';job.reason='Manta stopped before the orbit-ground evidence receipt was committed';job.finishedAt=now();await atomicJson(path.join(disk,name),job);}
    jobs.set(job.id,job);
  }
  async function inputSource(job){
    const bytes=await readRegular(safePath(folder(job),'source.zip'),32*1024*1024);
    if(sha(bytes)!==job.census.sha256||bytes.length!==job.census.bytes)throw Error('Pinned Census source snapshot changed');
    return bytes;
  }
  async function finish(job,output){
    if(output?.schema&&output.schema!=='manta-orbit-ground-response-v1')throw Error('Orbit-ground worker response schema mismatch');
    const success=output?.success===true&&output.exitCode===0;
    const files=output?.files||[];
    if(!Array.isArray(files)||files.length>4)throw Error('Orbit-ground worker returned too many artifacts');
    const names=new Set(files.map(file=>file?.path)),required=['ground-track.geojson','ground-samples.csv','report.md','receipt.json'];
    if(success&&(files.length!==required.length||required.some(name=>!names.has(name))))throw Error('Successful orbit-ground job lacks a required output');
    if(!success&&files.length)throw Error('Failed orbit-ground job cannot publish map/result artifacts');
    let total=0,receiptFile=null;const verifiedFiles=[];
    for(const file of files){
      if(!required.includes(file.path)||typeof file.contentBase64!=='string'||!HASH.test(file.sha256||''))throw Error('Unexpected orbit-ground output');
      const bytes=Buffer.from(file.contentBase64,'base64');total+=bytes.length;
      if(total>4*1024*1024||sha(bytes)!==file.sha256)throw Error('Orbit-ground output hash mismatch');
      if(file.path==='receipt.json')receiptFile=bytes;
      verifiedFiles.push({name:file.path,bytes,mimeType:file.mimeType||'text/plain'});
    }
    if(success){
      const receipt=output.receipt;
      if(receipt?.schema!=='manta-orbit-ground-receipt-v1'||receipt.jobId!==job.id||receipt.inputHash!==job.inputHash||!HASH.test(output.workerSha256||'')||receipt.workerSha256!==output.workerSha256||receipt.orbit?.jobId!==job.orbit.jobId||receipt.orbit?.receiptSha256!==job.orbit.receiptSha256||receipt.orbit?.modelSha256!==job.orbit.modelSha256||receipt.orbit?.posWSha256!==job.orbit.posWSha256||receipt.orbit?.timeSha256!==job.orbit.timeSha256||receipt.orbit?.epochUtc!==job.orbit.epochUtc||receipt.orbit?.leapSecondsAssumed!==job.orbit.leapSecondsAssumed||receipt.census?.sha256!==job.census.sha256||receipt.census?.path!==job.census.path||receipt.census?.expectedSourceEpsg!==4269||receipt.census?.featureIdField!=='STATEFP')throw Error('Orbit-ground receipt does not bind the exact inputs and worker');
      if(!output.metrics||!Number.isInteger(output.metrics.selectedSamples)||output.metrics.selectedSamples<2||output.metrics.selectedSamples>job.maxSamples||!Number.isInteger(output.metrics.nativeSamples)||output.metrics.nativeSamples<output.metrics.selectedSamples)throw Error('Orbit-ground sample counts are invalid');
      for(const file of verifiedFiles.filter(item=>item.name!=='receipt.json'))if(receipt.outputSha256?.[file.name]!==sha(file.bytes))throw Error('Orbit-ground receipt output hash mismatch: '+file.name);
      let recorded;try{recorded=JSON.parse(receiptFile);}catch{throw Error('Orbit-ground receipt artifact is invalid JSON');}
      if(JSON.stringify(recorded)!==JSON.stringify(receipt))throw Error('Orbit-ground receipt artifact differs from worker response');
    }
    // No worker-produced artifact becomes visible until the complete file and
    // receipt set has passed every binding and hash check.
    try{for(const file of verifiedFiles)await artifact(job,file.name,file.bytes,file.mimeType);}
    catch(error){for(const name of required){delete job.artifactHashes[name];await fs.rm(safePath(folder(job),name),{force:true}).catch(()=>{});}throw error;}
    const result={schema:'manta-orbit-ground-result-v1',jobId:job.id,status:job.status,ready:true,executionSucceeded:success,passed:null,orbit:job.orbit,census:job.census,inputHash:job.inputHash,tool:output?.tool||null,metrics:success?output.metrics||null:null,receipt:success?output.receipt:null,diagnostics:String(output?.diagnostics||job.reason||'').slice(0,4000),resultPath:job.relative+'/result.json',mapPath:success?job.relative+'/ground-track.geojson':null,samplesPath:success?job.relative+'/ground-samples.csv':null,reportPath:success?job.relative+'/report.md':null,scope:'Bounded native 42 world-frame sub-satellite point classification against the supplied NAD83 state boundary; no sensor footprint or coverage assessment',limitations:['Earth-rotation/frame handling, datum operation and boundary proximity need independent engineering review before mission use.','Point classification is not sensor field of view, revisit, imaging opportunity, ground contact, 24-hour delivery, three-month operation or hardware verification.','No mission requirement is marked passed by this job.']};
    await artifact(job,'result.json',Buffer.from(JSON.stringify(result,null,2)+'\n'),'application/json');
    job.resultPath=result.resultPath;job.resultSha256=job.artifactHashes['result.json'].sha256;job.artifacts=Object.values(job.artifactHashes);
    if(store.add)for(const entry of job.artifacts)store.add('artifacts',{id:'artifact_'+crypto.randomUUID(),projectId:job.projectId,threadId:job.threadId,runId:job.runId,name:job.id+' · '+entry.name,path:entry.path,type:entry.mimeType,createdAt:now()});
  }
  async function execute(job){
    const controller=new AbortController();controllers.set(job.id,controller);const timer=setTimeout(()=>{job.timedOut=true;controller.abort();},job.timeoutMs);timer.unref?.();
    try{
      if(job.cancelRequested)return;
      job.status='running';job.startedAt=now();await persist(job);
      const ready=await service.catalog({projectId:job.projectId});
      if(!ready.environment.ready)throw Error(ready.environment.reason||'Orbit-ground environment is not ready');
      const source=await inputSource(job);
      const request={schema:'manta-orbit-ground-input-v1',jobId:job.id,inputHash:job.inputHash,orbit:{jobId:job.orbit.jobId,receiptSha256:job.orbit.receiptSha256,modelSha256:job.orbit.modelSha256},census:{path:job.census.path,sha256:job.census.sha256,base64:source.toString('base64'),expectedSourceEpsg:4269,featureIdField:'STATEFP'},maxSamples:job.maxSamples};
      const output=await runner.run(request,{signal:controller.signal,timeoutMs:job.timeoutMs});
      if(controller.signal.aborted)throw Error('Orbit-ground job cancelled or timed out');
      job.status=output.success?'completed':'failed';job.reason=output.success?undefined:String(output.diagnostics||'Isolated orbit-ground worker failed').slice(0,2000);job.finishedAt=now();
      await finish(job,output);
    }catch(error){
      // A publication error must not leave a successful map/report manifest in
      // a failed job. The failed result is committed only after cleanup.
      for(const name of ['ground-track.geojson','ground-samples.csv','report.md','receipt.json','result.json']){delete job.artifactHashes[name];await fs.rm(safePath(folder(job),name),{force:true}).catch(()=>{});}
      job.artifacts=Object.values(job.artifactHashes);delete job.resultPath;delete job.resultSha256;
      job.status=job.cancelRequested?'cancelled':job.shutdown?'interrupted':'failed';job.reason=job.timedOut?'Orbit-ground job timed out':String(error.message).slice(0,2000);job.finishedAt=now();
      try{await finish(job,{success:false,exitCode:2,files:[],diagnostics:job.reason});}catch(resultError){job.reason+='; result persistence failed: '+String(resultError.message).slice(0,500);}
    }finally{clearTimeout(timer);controllers.delete(job.id);await persist(job);}
  }
  function pump(){if(closed||active)return;const job=queue.shift();if(!job)return;if(TERMINAL.has(job.status)){queueMicrotask(pump);return;}active=true;let task;task=execute(job).catch(async error=>{job.status='failed';job.reason='Orbit-ground persistence failed: '+String(error.message).slice(0,1000);job.finishedAt=now();await persist(job);}).finally(()=>{active=false;tasks.delete(task);pump();});tasks.add(task);}
  const service={
    async catalog({projectId}={}){
      workspace(projectId);
      const [orbit,gis,worker]=await Promise.allSettled([orbit42Jobs.catalog({projectId}),geospatialJobs.catalog({projectId}),runner.status()]);
      const orbitReady=orbit.status==='fulfilled'&&orbit.value?.environment?.ready===true;
      const gisReady=gis.status==='fulfilled'&&gis.value?.environment?.ready===true;
      const workerReady=worker.status==='fulfilled'&&worker.value?.ready===true;
      const reasons=[!orbitReady&&'Pinned NASA 42 unavailable',!gisReady&&'Pinned GDAL/PROJ unavailable',!workerReady&&(worker.status==='fulfilled'?worker.value.reason:'Reviewed worker unavailable')].filter(Boolean);
      return {tool:{id:'orbit-ground',name:'NASA 42 × state-boundary ground-track cross-check',operations:['submit','get','wait','cancel'],scope:'Bounded point classification only, no footprint, coverage/revisit, approval or STF mission verification'},environment:{ready:orbitReady&&gisReady&&workerReady,state:orbitReady&&gisReady&&workerReady?'ready':'blocked',reason:reasons.join('; ')||null,isolated:true,hostGlobalChanges:false},inputContract:{orbit42Job:'completed, integrity-verified and native PosW/time receipt-pinned',census:'caller-provided source-<SHA256>.zip, EPSG:4269, STATEFP; source URL/provenance requires separate evidence',sourceHashAllowlist:permitted?[...permitted]:null,maxSamples:{min:2,max:201}}};
    },
    async submit(args={},ctx={}){
      if(closed)throw Error('Orbit-ground service is closed');aborted(ctx.signal);
      if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>!['projectId','orbit42JobId','censusPath','censusSha256','maxSamples','timeoutMs'].includes(key)))throw fail('Unknown orbit-ground submission field');
      const projectId=args.projectId,ws=workspace(projectId),orbit42JobId=args.orbit42JobId,censusSha256=args.censusSha256;
      if(!ORBIT_ID.test(orbit42JobId||''))throw fail('Exact NASA 42 job ID required');
      if(!HASH.test(censusSha256||'')||args.censusPath!==`source-${censusSha256}.zip`)throw fail('Use the imported source-<actual SHA256>.zip Census file');
      if(permitted&&!permitted.has(censusSha256))throw fail('This isolated run allows only the pinned source ZIP SHA-256');
      const maxSamples=args.maxSamples??201;
      if(!Number.isInteger(maxSamples)||maxSamples<2||maxSamples>201)throw fail('Orbit-ground samples must be 2–201');
      const timeoutMs=args.timeoutMs??180000;
      if(!Number.isInteger(timeoutMs)||timeoutMs<30000||timeoutMs>300000)throw fail('Orbit-ground timeout must be 30–300 seconds');
      const orbitResult=await orbit42Jobs.result({projectId,jobId:orbit42JobId});
      if(orbitResult?.status!=='completed'||orbitResult.integrity?.verified!==true||orbitResult.executionSucceeded!==true||!HASH.test(orbitResult.inputHash||''))throw fail('NASA 42 job must be completed and integrity-verified');
      const root=`engineering/orbit/${orbit42JobId}/`,receiptEntry=orbitResult.artifacts?.find(entry=>entry.path===root+'receipt.json'),posWEntry=orbitResult.artifacts?.find(entry=>entry.path===root+'PosW.42'),timeEntry=orbitResult.artifacts?.find(entry=>entry.path===root+'time.42');
      const native=orbitResult.receipt,raw=Array.isArray(native?.rawOutputs)?native.rawOutputs:[];
      const rawHash=name=>raw.find(entry=>entry?.path===name||entry?.path==='InOut/'+name)?.sha256;
      if(native?.schema!=='manta-orbit42-receipt-v1'||native.jobId!==orbit42JobId||native.inputHash!==orbitResult.inputHash||!HASH.test(receiptEntry?.sha256||'')||!HASH.test(posWEntry?.sha256||'')||!HASH.test(timeEntry?.sha256||'')||rawHash('PosW.42')!==posWEntry.sha256||rawHash('time.42')!==timeEntry.sha256||typeof native.epochUtc!=='string'||!Number.isInteger(native.leapSecondsAssumed))throw fail('NASA 42 native PosW/time/clock receipt is incomplete or not pinned; rerun with the reviewed adapter');
      // Result integrity checks every registered orbit artifact. Re-read the
      // exact receipt bytes to bind the SHA supplied to the separate worker.
      const receiptBytes=await readRegular(safePath(ws,root+'receipt.json'),4*1024*1024);
      if(sha(receiptBytes)!==receiptEntry.sha256)throw fail('NASA 42 receipt changed before cross-check','REVISION_CONFLICT');
      let receipt;try{receipt=JSON.parse(receiptBytes);}catch{throw fail('NASA 42 receipt is invalid JSON');}
      if(JSON.stringify(receipt)!==JSON.stringify(native))throw fail('NASA 42 receipt differs from verified result','REVISION_CONFLICT');
      const sourcePath=safePath(ws,args.censusPath),handle=await fs.open(sourcePath,FC.O_RDONLY|FC.O_NOFOLLOW);let source;
      try{const stat=await handle.stat();if(!stat.isFile()||stat.size<4||stat.size>32*1024*1024)throw fail('Census ZIP must be a regular file at most 32 MiB');source=await handle.readFile();if(source.length!==stat.size||!source.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04])))throw fail('Census source is not a complete ZIP');}finally{await handle.close();}
      safePath(ws,args.censusPath);if(sha(source)!==censusSha256)throw fail('Census ZIP changed; re-import exact bytes','REVISION_CONFLICT');aborted(ctx.signal);
      const orbit={jobId:orbit42JobId,receiptSha256:receiptEntry.sha256,modelSha256:orbitResult.inputHash,posWSha256:posWEntry.sha256,timeSha256:timeEntry.sha256,epochUtc:native.epochUtc,leapSecondsAssumed:native.leapSecondsAssumed};
      const census={path:args.censusPath,sha256:censusSha256,bytes:source.length,expectedSourceEpsg:4269,featureIdField:'STATEFP'};
      const inputHash=sha(JSON.stringify({orbit:{jobId:orbit.jobId,receiptSha256:orbit.receiptSha256,modelSha256:orbit.modelSha256},census:{path:census.path,sha256:census.sha256,expectedSourceEpsg:4269,featureIdField:'STATEFP'},maxSamples}));
      const jobId='orbitground_'+crypto.randomUUID().replaceAll('-',''),relative=`engineering/orbit-ground/${jobId}`;
      const job={id:jobId,jobId,projectId,threadId:ctx.threadId||null,runId:ctx.runId||null,status:'queued',createdAt:now(),relative,orbit,census,maxSamples,inputHash,timeoutMs,artifactHashes:{}};
      await fs.mkdir(safePath(ws,relative,{write:true}),{recursive:true,mode:0o700});
      await artifact(job,'source.zip',source,'application/zip');
      await artifact(job,'input.json',Buffer.from(JSON.stringify({schema:'manta-orbit-ground-input-record-v1',jobId,orbit,census,maxSamples,inputHash},null,2)+'\n'),'application/json');
      jobs.set(job.id,job);await persist(job);queue.push(job);queueMicrotask(pump);return publicJob(job);
    },
    async list({projectId}={}){workspace(projectId);return [...jobs.values()].filter(job=>job.projectId===projectId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(publicJob);},
    async status(args){return publicJob(scoped(args));},
    async result(args){const job=scoped(args);if(!TERMINAL.has(job.status))return {jobId:job.id,status:job.status,ready:false};if(!job.resultSha256)return {jobId:job.id,status:job.status,ready:true,integrity:{verified:false,reason:'No committed result'}};
      try{const bytes=await readRegular(safePath(folder(job),'result.json'),4*1024*1024);if(sha(bytes)!==job.resultSha256)throw Error('Orbit-ground result hash mismatch');const result=JSON.parse(bytes);if(result.status!==job.status||result.executionSucceeded!==(job.status==='completed'))throw Error('Orbit-ground persisted job status differs from result receipt');for(const [name,entry] of Object.entries(job.artifactHashes))if(sha(await readRegular(safePath(folder(job),name),name==='source.zip'?32*1024*1024:4*1024*1024))!==entry.sha256)throw Error('Orbit-ground artifact hash mismatch: '+name);return {...result,artifacts:clone(job.artifacts||[]),integrity:{verified:true}};}
      catch(error){return {jobId:job.id,status:job.status,ready:true,integrity:{verified:false,reason:error.message},artifacts:clone(job.artifacts||[])};}
    },
    async wait(args,{signal,timeoutMs=1800000}={}){const job=scoped(args);if(TERMINAL.has(job.status))return {...publicJob(job),result:await service.result(args)};aborted(signal);return new Promise((resolve,reject)=>{const cleanup=()=>{clearTimeout(timer);events.off(job.id,changed);signal?.removeEventListener('abort',abort);};const changed=async next=>{if(TERMINAL.has(next.status)){cleanup();try{resolve({...next,result:await service.result(args)});}catch(error){reject(error);}}};const abort=()=>{cleanup();reject(fail('Cancelled waiting; orbit-ground job continues','CANCELLED'));};const timer=setTimeout(()=>{cleanup();resolve({...publicJob(job),waitTimedOut:true});},Math.min(Math.max(timeoutMs,1),1800000));events.on(job.id,changed);signal?.addEventListener('abort',abort,{once:true});if(TERMINAL.has(job.status))changed(publicJob(job));});},
    async cancel(args){const job=scoped(args);if(TERMINAL.has(job.status))return publicJob(job);job.cancelRequested=true;if(controllers.has(job.id))controllers.get(job.id).abort(fail('Cancelled by user','CANCELLED'));else{job.status='cancelled';job.reason='Cancelled before orbit-ground execution';job.finishedAt=now();await finish(job,{success:false,exitCode:2,files:[],diagnostics:job.reason});await persist(job);}return publicJob(job);},
    async close(){closed=true;for(const job of jobs.values())if(!TERMINAL.has(job.status)){job.shutdown=true;if(controllers.has(job.id))controllers.get(job.id).abort(fail('Manta closing','INTERRUPTED'));else{job.status='interrupted';job.reason='Manta stopped before orbit-ground execution';job.finishedAt=now();await persist(job);}}await Promise.allSettled([...tasks]);await runner.close?.();},
  };
  return service;
}
