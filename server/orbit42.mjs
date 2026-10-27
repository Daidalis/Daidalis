import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {safePath} from './sandbox.mjs';
import {executeLocalVm,stageManagedWorkerBundle} from './local-linux-vm.mjs';

const ID=/^orbit42_[a-f0-9]{32}$/;
const HASH=/^[a-f0-9]{64}$/;
const RAW=['time.42','PosN.42','VelN.42','PosW.42'];
const NATIVE_FILES=['trajectory.csv','report.md','receipt.json',...RAW,'Inp_Sim.txt','Orb_LEO.txt','native-42.log'];
const WORKER_SHA256='56c6934a4f27dda30a5e040e18b27d65f140d7aab8b51563f0cbaffaedc75163';
const TEMPLATE_TREE_SHA256='9fc8eaffe24ccdaa702c943048f48c87934a733664376689b30c3fe53e72472e';
const GUEST_ADAPTER='/srv/manta/orbit42/adapter-'+WORKER_SHA256+'.py';
const BINARY_SHA256='a56f32e7a0ce8ec7e26749a5fb7aee673f24a190f444fc85083b3c63bd2b6c31';
const TERMINAL=new Set(['completed','failed','cancelled','interrupted']);
const MODEL_CONTRACT={
  schema:'manta-orbit42-v1',format:'.orbit42.json',source:{repository:'nasa-itc/42',revision:'dev_20260403'},
  requiredScenarioFields:['epochUtc','leapSeconds','periapsisAltitudeKm','apoapsisAltitudeKm','inclinationDeg','raanDeg','argumentOfPeriapsisDeg','trueAnomalyDeg','durationSeconds','stepSeconds','outputIntervalSeconds'],
  units:{epochUtc:'UTC ISO 8601 whole seconds, 2000–2040',leapSeconds:'s, explicit justified assumption',periapsisAltitudeKm:'km above Earth, 150–2000',apoapsisAltitudeKm:'km above Earth, >= periapsis and <=2000',inclinationDeg:'degrees, 0–180',raanDeg:'degrees, 0–360',argumentOfPeriapsisDeg:'degrees, 0–360',trueAnomalyDeg:'degrees, 0–360',durationSeconds:'s, 60–2000',stepSeconds:'s, 0.01–0.1',outputIntervalSeconds:'s, stepSeconds–300, exact step multiple'},
  limits:{maximumIntegrationSteps:20000,maximumOutputIntervals:2000,assumptions:'0–20 strings, each at most 500 characters'},
  referenceExample:{schema:'manta-orbit42-v1',source:{repository:'nasa-itc/42',revision:'dev_20260403'},scenario:{epochUtc:'2024-08-04T00:00:00Z',leapSeconds:37,periapsisAltitudeKm:400,apoapsisAltitudeKm:400,inclinationDeg:52,raanDeg:0,argumentOfPeriapsisDeg:0,trueAnomalyDeg:20,durationSeconds:600,stepSeconds:0.1,outputIntervalSeconds:60},assumptions:['Reference example only; replace with sourced mission inputs before engineering use']},
  output:'Native 42 Earth-centered N-frame SI trajectory, simulation seconds from declared epoch; no certified geodetic/J2000 transform or coverage claim'
};
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const now=()=>new Date().toISOString();
const clone=value=>JSON.parse(JSON.stringify(value));

function validTemplateReceipt(files){
  if(!Array.isArray(files)||files.length!==21)return false;
  if(files.some(file=>!file||Object.keys(file).sort().join(',')!=='path,sha256'||typeof file.path!=='string'||!HASH.test(file.sha256||'')))return false;
  const normalized=files.map(file=>({path:file.path,sha256:file.sha256})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  return sha(JSON.stringify(normalized))===TEMPLATE_TREE_SHA256;
}

function invalid(message,code='INVALID_INPUT'){
  const error=new Error(message);error.code=code;error.statusCode=code==='REVISION_CONFLICT'?409:400;return error;
}
function relativeModel(value){
  if(typeof value!=='string'||!value.endsWith('.orbit42.json')||value.length>240||value.includes('\\')||path.posix.isAbsolute(value)||value.split('/').some(part=>!part||part==='.'||part==='..'||part.startsWith('.')))throw invalid('Use a project-relative .orbit42.json model path');
  return value;
}
async function atomicJson(target,value){
  const temporary=target+'.'+crypto.randomUUID()+'.tmp';
  await fs.writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
  try{await fs.rename(temporary,target);}finally{await fs.rm(temporary,{force:true});}
}
const cancelled=()=>invalid('Orbit job wait cancelled; the job may continue','CANCELLED');

/** Native 42 jobs use the managed Linux VM, not a host Python/42 installation.
 * The project workspace holds immutable source snapshots and result evidence. */
export async function createOrbit42Service({
  dataDir,store,vmRoot,execute=executeLocalVm,stageBundle=stageManagedWorkerBundle,
  ensureVm,emit=()=>{},maxJobMs=180000
}={}){
  if(!dataDir||!store?.workspace||!vmRoot||!path.isAbsolute(vmRoot))throw Error('Orbit 42 service requires project store, dataDir and fixed absolute managed VM root');
  const disk=path.join(dataDir,'orbit42');
  await fs.mkdir(disk,{recursive:true,mode:0o700});
  const jobs=new Map(),queue=[],tasks=new Set(),controllers=new Map(),modelLocks=new Map(),events=new EventEmitter();
  events.setMaxListeners(100);
  let active=0,closed=false;
  const workspace=projectId=>{if(typeof projectId!=='string'||!projectId)throw invalid('projectId required');return store.workspace(projectId);};
  const scoped=args=>{workspace(args?.projectId);if(!ID.test(args?.jobId||''))throw invalid('Invalid orbit 42 job ID');const job=jobs.get(args.jobId);if(!job||job.projectId!==args.projectId)throw invalid('Orbit job does not belong to this project');return job;};
  const publicJob=job=>{const copy=clone(job);delete copy.artifactHashes;return copy;};
  const jobDir=job=>safePath(workspace(job.projectId),job.relative);
  async function exclusive(key,fn){
    const previous=modelLocks.get(key)||Promise.resolve();
    let release;
    const next=new Promise(resolve=>{release=resolve;});
    modelLocks.set(key,next);
    await previous;
    try{return await fn();}finally{release();if(modelLocks.get(key)===next)modelLocks.delete(key);}
  }
  async function readModel(args={}){
    const ws=workspace(args.projectId),relative=relativeModel(args.path),target=safePath(ws,relative);
    const stat=await fs.lstat(target);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw invalid('Orbit 42 model must be a regular file under 64 KiB');
    const content=await fs.readFile(target,'utf8');
    if(!content.trim()||content.includes('\0')||Buffer.byteLength(content)>65536)throw invalid('Orbit 42 model content must be nonempty UTF-8 under 64 KiB');
    const hash=sha(content);
    if(args.expectedHash&&args.expectedHash!==hash)throw invalid('Orbit model changed; reload before editing','REVISION_CONFLICT');
    return {path:relative,content,sha256:hash,bytes:Buffer.byteLength(content),language:'orbit42',validationStatus:'not-run'};
  }
  async function persist(job){
    await atomicJson(path.join(disk,job.id+'.json'),job);
    const view=publicJob(job);
    events.emit(job.id,view);
    emit({projectId:job.projectId,threadId:job.threadId,runId:job.runId,type:'orbit42.'+job.status,message:job.reason||'Native 42 orbit '+job.status,data:{jobId:job.id,status:job.status,resultPath:job.resultPath||null}});
  }
  for(const name of await fs.readdir(disk)){
    if(!/^orbit42_[a-f0-9]{32}\.json$/.test(name))continue;
    const job=JSON.parse(await fs.readFile(path.join(disk,name),'utf8'));
    if(!ID.test(job.id)||name!==job.id+'.json')throw Error('Invalid persisted orbit job');
    if(!TERMINAL.has(job.status)){job.status='interrupted';job.reason='Manta stopped before the native 42 receipt was committed; submit a new pinned run';job.finishedAt=now();await atomicJson(path.join(disk,name),job);}
    jobs.set(job.id,job);
  }
  async function artifact(job,relative,bytes,mimeType){
    if(typeof relative!=='string'||!relative||relative.includes('\\')||relative.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Invalid orbit artifact path');
    const target=safePath(jobDir(job),relative,{write:true});
    await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});
    await fs.writeFile(target,bytes,{mode:0o600});
    const entry={name:path.basename(relative),path:job.relative+'/'+relative,sha256:sha(bytes),bytes:Buffer.byteLength(bytes),mimeType};
    job.artifactHashes[relative]=entry;
    return entry;
  }
  async function vm(command,{input,signal,timeoutMs=120000,maxOutputBytes=26*1024*1024,maxTotalBytes=30*1024*1024}={}){
    const file=path.join(vmRoot,'host','vm-exec.sh');
    const info=await fs.lstat(file);
    if(!info.isFile()||info.isSymbolicLink())throw Error('Managed VM helper is not a regular application-owned file');
    return execute('/bin/sh',[file,command],{cwd:vmRoot,input,signal,timeoutMs,maxOutputBytes,maxTotalBytes});
  }
  async function readiness(projectId){
    workspace(projectId);
    try{
      const file=path.join(vmRoot,'host','vm-status.sh');
      const state=await execute('/bin/sh',[file],{cwd:vmRoot,timeoutMs:15000,maxOutputBytes:20000,maxTotalBytes:30000});
      if(state.code!==0||JSON.parse(state.stdout).state!=='running')return {ready:false,state:'not-prepared',reason:'Managed Linux VM is not running'};
      const probe=await vm('test -x /srv/manta/42/42 && sha256sum /srv/manta/42/42',{timeoutMs:15000,maxOutputBytes:500,maxTotalBytes:1000});
      if(probe.code!==0)return {ready:false,state:'not-prepared',reason:'Native 42 executable is not prepared in the isolated Linux VM'};
      const binarySha256=probe.stdout.trim().split(/\s+/)[0];
      if(binarySha256!==BINARY_SHA256)return {ready:false,state:'blocked',reason:'Native 42 executable hash differs from the pinned binary',isolated:true,hostGlobalChanges:false};
      return {ready:true,state:'ready',tool:{id:'nasa-42',repository:'nasa-itc/42',revision:'dev_20260403',binarySha256},isolated:true,hostGlobalChanges:false};
    }catch(error){return {ready:false,state:'blocked',reason:String(error.message).slice(0,1000),isolated:true,hostGlobalChanges:false};}
  }
  async function startStoppedFixedVm(signal){
    // This path only reboots an already prepared, application-owned VM. It
    // never calls vm-prepare, installs packages or exposes the general VM/NOS3
    // service to the isolated evaluation Agent.
    for(const relative of ['state/config.json','state/ubuntu.raw','host/manta-vm','host/vm-start.sh']){
      const info=await fs.lstat(path.join(vmRoot,relative));
      if(!info.isFile()||info.isSymbolicLink())throw Error('Fixed Orbit 42 VM startup requires a prepared regular file: '+relative);
    }
    const started=await execute('/bin/sh',[path.join(vmRoot,'host','vm-start.sh')],{cwd:vmRoot,signal,timeoutMs:240000,maxOutputBytes:1000,maxTotalBytes:3000});
    if(started.code!==0)throw Error(('Fixed Orbit 42 VM startup failed: '+(started.stderr||started.stdout||started.code)).slice(0,2000));
  }
  async function readSource(job){
    const target=safePath(jobDir(job),'source.orbit42.json');
    const content=await fs.readFile(target,'utf8');
    if(sha(content)!==job.inputHash)throw Error('Pinned orbit model snapshot integrity mismatch');
    return {path:job.model.path,content,sha256:job.inputHash};
  }
  async function finish(job,{native,reason}={}){
    if(native){
      if(native.schema!=='manta-orbit42-native-response-v1'||typeof native.success!=='boolean'||!Number.isInteger(native.exitCode)||!Array.isArray(native.files))throw Error('Invalid native 42 response');
      if(native.success){
        const receipt=native.receipt;
        if(native.exitCode!==0||receipt?.schema!=='manta-orbit42-receipt-v1'||receipt.jobId!==job.id||receipt.inputHash!==job.inputHash||receipt.sourceFile?.path!==job.model.path||receipt.sourceFile?.sha256!==job.inputHash||receipt.tool?.id!=='nasa-42'||receipt.tool?.repository!=='nasa-itc/42'||receipt.tool?.revision!=='dev_20260403'||receipt.tool?.binarySha256!=='a56f32e7a0ce8ec7e26749a5fb7aee673f24a190f444fc85083b3c63bd2b6c31'||receipt.adapterSha256!==WORKER_SHA256||native.tool?.binarySha256!==receipt.tool.binarySha256||receipt.assets?.fileCount!==220||receipt.assets?.treeSha256!=='d7d68ea74816d4c0bd78120adf02a982832727d34806c210b7b693f0028a8c48'||receipt.assets?.sourceIntegritySha256!=='fadfb8bd140f81a0488f4668ccb4e19f785bf12349fe42dcf872856ebf1c485d'||receipt.assets?.assetManifestSha256!=='de831c50047b3376e1fb5400bf062fc197b5edd536266a91172080ad3af19a61'||!validTemplateReceipt(receipt.templateFiles)||!Number.isInteger(native.metrics?.samples)||native.metrics.samples<2||native.metrics.samples>2001||!Array.isArray(native.metrics?.checks)||native.metrics.checks.some(check=>check.passed!==true))throw Error('Native 42 receipt or sanity checks do not match the pinned request');
      }
      if(native.files.length>16)throw Error('Native 42 returned too many artifacts');
      if(!native.success&&native.files.length)throw Error('Failed native 42 run cannot publish output artifacts');
      let total=0,receiptFile;
      const names=new Set(),verified=[];
      for(const file of native.files){
        const relative=file.path;
        if(typeof relative!=='string'||names.has(relative)||!NATIVE_FILES.includes(relative)||typeof file.contentBase64!=='string')throw Error('Unknown or duplicate native 42 artifact');
        names.add(relative);
        const bytes=Buffer.from(file.contentBase64,'base64');
        total+=bytes.length;
        if(total>24*1024*1024||!HASH.test(file.sha256||'')||sha(bytes)!==file.sha256)throw Error('Native 42 artifact integrity mismatch');
        if(relative==='receipt.json')receiptFile=bytes;
        verified.push({relative,bytes,mimeType:file.mimeType||'text/plain'});
      }
      if(native.success&&!NATIVE_FILES.every(name=>names.has(name)))throw Error('Native 42 successful response lacks required raw evidence');
      if(native.success){
        let recorded;try{recorded=JSON.parse(receiptFile);}catch{throw Error('Native 42 receipt artifact is invalid JSON');}
        if(JSON.stringify(recorded)!==JSON.stringify(native.receipt))throw Error('Native 42 receipt artifact differs from response receipt');
        const raw=native.receipt.rawOutputs;
        if(!Array.isArray(raw)||raw.length!==RAW.length||typeof native.receipt.epochUtc!=='string'||!Number.isInteger(native.receipt.leapSecondsAssumed))throw Error('Native 42 world-frame and clock receipt is incomplete');
        for(const name of RAW){const matches=raw.filter(item=>item?.path===name||item?.path==='InOut/'+name),file=verified.find(item=>item.relative===name);if(matches.length!==1||!HASH.test(matches[0].sha256||'')||sha(file.bytes)!==matches[0].sha256)throw Error('Native 42 raw output receipt hash mismatch: '+name);}
        const model=JSON.parse(await fs.readFile(safePath(jobDir(job),'source.orbit42.json'),'utf8'));
        if(native.receipt.epochUtc!==model.scenario?.epochUtc||native.receipt.leapSecondsAssumed!==model.scenario?.leapSeconds)throw Error('Native 42 clock receipt differs from model');
      }
      // Only after the complete native evidence and receipt validate do we
      // publish any worker-produced file or register it in the job manifest.
      try{for(const file of verified)await artifact(job,file.relative,file.bytes,file.mimeType);}
      catch(error){for(const file of verified){delete job.artifactHashes[file.relative];await fs.rm(safePath(jobDir(job),file.relative),{force:true}).catch(()=>{});}throw error;}
      job.status=native.success?'completed':'failed';
      job.reason=native.success?undefined:String(native.diagnostics||'Native 42 failed').slice(0,2000);
      job.finishedAt=now();
      job.result={
        schema:'manta-orbit42-result-v1',jobId:job.id,status:job.status,passed:native.success===true,
        model:job.model,inputHash:job.inputHash,tool:native.tool||null,
        executionSucceeded:native.success===true,exitCode:native.exitCode,
        metrics:native.metrics||null,scope:native.scope||'Native 42 short-run reference orbit only',
        frame:'42 Earth-centered N frame; no certified ITRF/J2000 transform',
        timeScale:'simulation seconds from model epochUtc',
        units:{position:'m',velocity:'m/s',time:'s'},
        receipt:native.receipt||null,diagnostics:String(native.diagnostics||'').slice(0,4000),
        resultPath:job.relative+'/result.json',
        trajectoryPath:native.success?job.relative+'/trajectory.csv':null,
        reportPath:native.success?job.relative+'/report.md':null,
        limitations:['No geodetic conversion, field of view, ground footprint, revisit, three-month operation, ground delivery or hardware verification is established.']
      };
    }else{
      job.status=job.cancelRequested?'cancelled':job.shutdown?'interrupted':'failed';
      job.reason=String(reason||'Orbit 42 execution did not commit a receipt').slice(0,2000);
      job.finishedAt=now();
      job.result={schema:'manta-orbit42-result-v1',jobId:job.id,status:job.status,passed:false,model:job.model,inputHash:job.inputHash,executionSucceeded:false,diagnostics:job.reason,resultPath:job.relative+'/result.json',trajectoryPath:null,reportPath:null};
    }
    const resultEntry=await artifact(job,'result.json',JSON.stringify(job.result,null,2)+'\n','application/json');
    job.resultSha256=resultEntry.sha256;
    job.resultPath=job.relative+'/result.json';
    job.artifacts=Object.values(job.artifactHashes);
    if(store.add)for(const entry of job.artifacts)store.add('artifacts',{id:'artifact_'+crypto.randomUUID(),projectId:job.projectId,threadId:job.threadId,runId:job.runId,name:job.id+' · '+entry.name,path:entry.path,type:entry.mimeType,createdAt:now()});
  }
  async function cancelGuest(jobId){
    if(!ID.test(jobId))return;
    await vm('python3 '+GUEST_ADAPTER+' --cancel '+jobId,{timeoutMs:15000,maxOutputBytes:1000,maxTotalBytes:2000}).catch(()=>{});
  }
  async function rollbackNativeArtifacts(job){
    for(const name of [...NATIVE_FILES,'result.json']){
      delete job.artifactHashes[name];
      await fs.rm(safePath(jobDir(job),name),{force:true}).catch(()=>{});
    }
    job.artifacts=Object.values(job.artifactHashes);
    delete job.resultSha256;delete job.resultPath;
  }
  async function run(job){
    const controller=new AbortController();
    controllers.set(job.id,controller);
    const timer=setTimeout(()=>{job.timedOut=true;controller.abort();},job.timeoutMs);
    timer.unref?.();
    try{
      if(job.cancelRequested)return;
      job.status='running';job.startedAt=now();await persist(job);
      let ready=await readiness(job.projectId);
      if(!ready.ready&&ensureVm){await ensureVm({projectId:job.projectId,signal:controller.signal});ready=await readiness(job.projectId);}
      else if(!ready.ready&&ready.state==='not-prepared'&&ready.reason==='Managed Linux VM is not running'){
        await startStoppedFixedVm(controller.signal);
        ready=await readiness(job.projectId);
      }
      if(!ready.ready)throw Error(ready.reason||'Pinned native 42 is unavailable in the managed Linux VM');
      await stageBundle(vmRoot,{signal:controller.signal});
      // VirtioFS/NAS reads can be inconsistent while the handoff is staged.
      // Copy reviewed bytes into private guest storage, then verify their exact
      // digest before Python parses or executes the adapter.
      const stage=await vm('mkdir -p /srv/manta/orbit42 && cp /mnt/manta-transfer/worker/orbit42-run.py '+GUEST_ADAPTER+' && sha256sum '+GUEST_ADAPTER,{signal:controller.signal,timeoutMs:15000,maxOutputBytes:1000,maxTotalBytes:2000});
      if(stage.code!==0||stage.stdout.trim().split(/\s+/)[0]!==WORKER_SHA256)throw Error('Reviewed orbit adapter did not stage with its pinned SHA-256');
      const sourceFile=await readSource(job);
      const request={jobId:job.id,inputHash:job.inputHash,sourceFile};
      const output=await vm('python3 '+GUEST_ADAPTER,{input:JSON.stringify(request),signal:controller.signal,timeoutMs:Math.min(job.timeoutMs,180000)});
      if(controller.signal.aborted)throw Error('Orbit 42 execution cancelled or timed out');
      if(output.code!==0)throw Error(('Native 42 adapter failed: '+(output.stderr||output.stdout)).slice(-2000));
      let native;
      try{native=JSON.parse(output.stdout);}catch{throw Error('Native 42 adapter returned invalid JSON');}
      await finish(job,{native});
    }catch(error){
      if(controller.signal.aborted)await cancelGuest(job.id);
      await rollbackNativeArtifacts(job);
      await finish(job,{reason:job.timedOut?'Orbit 42 job timed out':error.message});
    }finally{
      clearTimeout(timer);controllers.delete(job.id);await persist(job);
    }
  }
  function pump(){
    if(closed||active)return;
    const job=queue.shift();
    if(!job)return;
    if(TERMINAL.has(job.status)){queueMicrotask(pump);return;}
    active++;
    let task;
    task=run(job).catch(async error=>{job.status='failed';job.reason='Orbit result persistence failed: '+String(error.message).slice(0,1000);job.finishedAt=now();await persist(job);}).finally(()=>{active--;tasks.delete(task);pump();});
    tasks.add(task);
  }
  const service={
    async catalog({projectId}={}){return {environment:await readiness(projectId),tool:{id:'nasa-42',name:'NASA 42 orbit dynamics',nativeSource:'nasa-itc/42 dev_20260403',modelFormat:'.orbit42.json',operations:['read','save','submit','get','wait','cancel'],scope:'Bounded short-run reference orbit; not STF mission coverage or complete validation'},modelContract:clone(MODEL_CONTRACT)};},
    readModel,
    async saveModel(args={},ctx={}){
      const ws=workspace(args.projectId),relative=relativeModel(args.path);
      if(relative.startsWith('engineering/orbit/'))throw invalid('Recorded orbit job inputs and evidence are immutable; save a working model elsewhere');
      if(typeof args.content!=='string'||!args.content.trim()||args.content.includes('\0')||Buffer.byteLength(args.content)>65536)throw invalid('Orbit model content must be nonempty UTF-8 under 64 KiB');
      if(args.expectedHash!==null&&!HASH.test(args.expectedHash||''))throw invalid('New models require expectedHash:null; existing models require their exact SHA-256');
      if(ctx.signal?.aborted)throw invalid('Cancelled','CANCELLED');
      return exclusive(args.projectId+':'+relative,async()=>{
        const target=safePath(ws,relative,{write:true});let previous=null;
        try{const stat=await fs.lstat(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw invalid('Existing orbit model must be a regular file under 64 KiB');previous=await fs.readFile(target,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
        if(previous===null?args.expectedHash!==null:sha(previous)!==args.expectedHash)throw invalid('Orbit model changed; reload before editing','REVISION_CONFLICT');
        await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});safePath(ws,relative,{write:true});
        if(previous!==null){const history=safePath(ws,'.manta/orbit42-model-history/'+sha(previous)+'.orbit42.json',{write:true});await fs.mkdir(path.dirname(history),{recursive:true,mode:0o700});await fs.writeFile(history,previous,{mode:0o600,flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});}
        const temporary=target+'.'+crypto.randomUUID()+'.tmp';
        await fs.writeFile(temporary,args.content,{mode:0o600,flag:'wx'});
        try{
          safePath(ws,relative,{write:true});let current=null;
          try{current=await fs.readFile(target,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
          if(current!==previous)throw invalid('Orbit model changed during save','REVISION_CONFLICT');
          if(ctx.signal?.aborted)throw invalid('Cancelled','CANCELLED');
          await fs.rename(temporary,target);
        }finally{await fs.rm(temporary,{force:true});}
        const model=await readModel({projectId:args.projectId,path:relative});
        emit({projectId:args.projectId,threadId:ctx.threadId,runId:ctx.runId,type:'orbit42.model.saved',message:'Native 42 source saved',data:{path:relative,sha256:model.sha256}});
        return {...model,saved:true,previousSha256:previous===null?null:sha(previous)};
      });
    },
    async submit(args={},ctx={}){
      if(closed)throw Error('Orbit 42 service is closed');
      if(Object.keys(args).some(key=>!['projectId','path','expectedHash','timeoutMs'].includes(key)))throw invalid('Unknown orbit 42 submission field');
      const ws=workspace(args.projectId),relative=relativeModel(args.path);
      if(!HASH.test(args.expectedHash||''))throw invalid('Read the exact orbit model hash before submission');
      const target=safePath(ws,relative);
      const stat=await fs.lstat(target);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw invalid('Orbit 42 model must be a regular file under 64 KiB');
      const content=await fs.readFile(target,'utf8'),inputHash=sha(content);
      if(inputHash!==args.expectedHash)throw invalid('Orbit model changed; reload before submitting','REVISION_CONFLICT');
      let model;
      try{model=JSON.parse(content);}catch{throw invalid('Orbit model must be valid JSON');}
      if(model?.schema!=='manta-orbit42-v1')throw invalid('Expected manta-orbit42-v1 model');
      const jobId='orbit42_'+crypto.randomUUID().replaceAll('-',''),relativeDir='engineering/orbit/'+jobId;
      const job={id:jobId,jobId,projectId:args.projectId,threadId:ctx.threadId||null,runId:ctx.runId||null,status:'queued',createdAt:now(),relative:relativeDir,model:{path:relative,sha256:inputHash},inputHash,timeoutMs:Math.min(Math.max(Number.isFinite(args.timeoutMs)?args.timeoutMs:maxJobMs,30000),180000),artifactHashes:{}};
      await fs.mkdir(safePath(ws,relativeDir,{write:true}),{recursive:true,mode:0o700});
      await artifact(job,'source.orbit42.json',content,'application/json');
      await artifact(job,'input.json',JSON.stringify({schema:'manta-orbit42-input-v1',jobId,model:job.model,inputHash,submittedAt:job.createdAt},null,2)+'\n','application/json');
      jobs.set(job.id,job);await persist(job);queue.push(job);queueMicrotask(pump);return publicJob(job);
    },
    async status(args){return publicJob(scoped(args));},
    async result(args){
      const job=scoped(args);
      if(!TERMINAL.has(job.status))return {jobId:job.id,status:job.status,ready:false};
      if(!job.resultSha256)return {jobId:job.id,status:job.status,ready:true,integrity:{verified:false,reason:'No committed result'}};
      try{
        const bytes=await fs.readFile(safePath(jobDir(job),'result.json'));
        if(sha(bytes)!==job.resultSha256)throw Error('Orbit result hash mismatch');
        for(const [relative,entry] of Object.entries(job.artifactHashes))if(sha(await fs.readFile(safePath(jobDir(job),relative)))!==entry.sha256)throw Error('Orbit artifact hash mismatch: '+relative);
        return {...JSON.parse(bytes),ready:true,integrity:{verified:true},artifacts:clone(job.artifacts||[])};
      }catch(error){return {jobId:job.id,status:job.status,ready:true,integrity:{verified:false,reason:error.message},passed:null,artifacts:clone(job.artifacts||[])};}
    },
    async wait(args,{signal,timeoutMs=1800000}={}){
      const job=scoped(args);
      if(TERMINAL.has(job.status))return {...publicJob(job),result:await service.result(args)};
      if(signal?.aborted)throw cancelled();
      return new Promise((resolve,reject)=>{
        const cleanup=()=>{clearTimeout(timer);events.off(job.id,changed);signal?.removeEventListener('abort',abort);};
        const changed=async next=>{if(TERMINAL.has(next.status)){cleanup();try{resolve({...next,result:await service.result(args)});}catch(error){reject(error);}}};
        const abort=()=>{cleanup();reject(cancelled());};
        const timer=setTimeout(()=>{cleanup();resolve({...publicJob(job),waitTimedOut:true});},Math.min(Math.max(timeoutMs,1),1800000));
        events.on(job.id,changed);signal?.addEventListener('abort',abort,{once:true});
      });
    },
    async cancel(args){
      const job=scoped(args);
      if(TERMINAL.has(job.status))return publicJob(job);
      job.cancelRequested=true;
      if(controllers.has(job.id))controllers.get(job.id).abort();
      else{job.status='cancelled';job.reason='Cancelled before native 42 execution';job.finishedAt=now();await finish(job,{reason:job.reason});await persist(job);}
      return publicJob(job);
    },
    async close(){
      closed=true;
      for(const job of jobs.values())if(!TERMINAL.has(job.status)){job.shutdown=true;if(controllers.has(job.id))controllers.get(job.id).abort();else{job.status='interrupted';job.reason='Manta stopped before orbit execution';job.finishedAt=now();await persist(job);}}
      await Promise.allSettled([...tasks]);
    }
  };
  return service;
}
