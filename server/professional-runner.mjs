import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {executeLocalVm,stageManagedWorkerBundle} from './local-linux-vm.mjs';

const HASH=/^[a-f0-9]{64}$/;
const IDENT=/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const JOB=/^[A-Za-z0-9_-]{8,100}$/;
const SIGNAL_BASE='[A-Za-z_][A-Za-z0-9_]*(?:\\[-?\\d+(?:,-?\\d+)*\\])?(?:\\.[A-Za-z_][A-Za-z0-9_]*(?:\\[-?\\d+(?:,-?\\d+)*\\])?)*';
const SIGNAL=new RegExp('^(?:'+SIGNAL_BASE+'|(?:der|pre)\\('+SIGNAL_BASE+'\\))$');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const abortError=()=>Object.assign(Error('Professional tool operation cancelled'),{name:'AbortError'});

/** Only application-owned fixed VM helpers execute on macOS. Model code executes in guest bubblewrap. */
export function createProfessionalRunner({vmRoot,execute=executeLocalVm,hostPlatform=process.platform,hostArch=process.arch}={}) {
  if(!vmRoot||!path.isAbsolute(vmRoot))throw Error('Professional runner requires a fixed absolute managed VM root');
  const root=path.resolve(vmRoot);let closed=false,closing=false,ready=null,preparing=null;const activeJobs=new Set();
  const controllers=new Set();
  async function helper(name,args=[],options={}){
    if(closed)throw Error('Professional runner is closed');
    const file=path.join(root,'host',name),info=await fs.lstat(file);
    if(!info.isFile()||info.isSymbolicLink())throw Error('Managed VM helper must be a regular application-owned file');
    return execute('/bin/sh',[file,...args],{cwd:root,timeoutMs:180000,maxOutputBytes:32*1024*1024,maxTotalBytes:40*1024*1024,...options});
  }
  async function command(text,options={}){return helper('vm-exec.sh',[text],options);}
  function decode(result){
    if(result.code!==0)throw Error(('Managed Linux professional helper failed: '+(result.stderr||result.stdout||result.code)).slice(-4000));
    try{return JSON.parse(result.stdout);}catch{throw Error('Managed professional helper returned invalid JSON');}
  }
  async function status(){
    if(closed)return {available:false,ready:false,status:'closed',isolated:true,hostGlobalChanges:false};
    try{
      const runtime=decode(await helper('vm-status.sh',[],{timeoutMs:15000}));
      if(runtime.state!=='running')return {available:false,ready:false,status:'not-prepared',reason:'Managed Linux VM is not running',guestReady:false,isolated:true,hostGlobalChanges:false};
      const result=await command('cat /srv/manta/receipts/openmodelica-ready.json',{timeoutMs:15000});
      if(result.code!==0)return {available:false,ready:false,status:'not-prepared',reason:'OpenModelica has not been prepared inside the Linux VM',guestReady:true,isolated:true,hostGlobalChanges:false};
      const receipt=decode(result);
      if(receipt.schema!=='manta-openmodelica-ready-v1'||receipt.ready!==true||receipt.tool?.id!=='openmodelica'||typeof receipt.tool.version!=='string')throw Error('Invalid OpenModelica readiness receipt');
      // Readiness is a live probe, never a receipt alone.
      const version=await command('/usr/bin/omc --version',{timeoutMs:15000});
      if(version.code!==0||version.stdout.trim()!==receipt.tool.version)throw Error('Installed OpenModelica no longer matches its pinned readiness receipt');
      const tools={openmodelica:{ready:true,version:receipt.tool.version},ngspice:{ready:false},openscad:{ready:false}};try{const design=decode(await command('cat /srv/manta/receipts/design-tools-ready.json',{timeoutMs:15000}));if(design.schema==='manta-design-tools-ready-v1'&&design.ready===true){for(const id of ['ngspice','openscad'])if(design.tools?.[id]?.ready===true&&typeof design.tools[id].version==='string'){const probe=await command(id==='ngspice'?'/usr/bin/ngspice --version':'/usr/bin/openscad --version 2>&1',{timeoutMs:15000});if(probe.code===0&&probe.stdout.includes(design.tools[id].version))tools[id]={...design.tools[id]};}}}catch{}
      return {available:true,ready:true,status:'ready',guestReady:true,tool:receipt.tool,version:receipt.tool.version,tools,receipt,isolated:true,hostGlobalChanges:false};
    }catch(error){return {available:false,ready:false,status:'blocked',reason:String(error.message).slice(-2000),isolated:true,hostGlobalChanges:false};}
  }
  async function prepare({signal,onLog=()=>{}}={}){
    if(closed||closing)throw Error('Professional runner is closed');if(signal?.aborted)throw signal.reason||abortError();
    if(hostPlatform!=='darwin'||hostArch!=='arm64')throw Error('Managed professional Linux runner requires Apple Silicon macOS');
    if(ready){const current=await status();if(signal?.aborted)throw signal.reason||abortError();if(current.ready&&current.tools?.ngspice?.ready&&current.tools?.openscad?.ready)return current;ready=null;}
    if(!preparing){
      const controller=new AbortController();controllers.add(controller);
      preparing=(async()=>{
        const runtime=decode(await helper('vm-status.sh',[],{signal:controller.signal}));
        if(runtime.state!=='running'){
          onLog('Preparing and starting Manta’s isolated Linux VM.\n');
          let result=await helper('vm-prepare.sh',[],{signal:controller.signal,timeoutMs:1800000,onLog});
          if(result.code!==0)throw Error((result.stderr||result.stdout||'VM preparation failed').slice(-4000));
          result=await helper('vm-start.sh',[],{signal:controller.signal,timeoutMs:240000,onLog});
          if(result.code!==0)throw Error((result.stderr||result.stdout||'VM startup failed').slice(-4000));
        }
        await stageManagedWorkerBundle(root,{signal:controller.signal});
        onLog('Checking the official OpenModelica compiler and standard library inside Linux.\n');
        const result=await command('bash /mnt/manta-transfer/worker/prepare-openmodelica.sh',{signal:controller.signal,timeoutMs:1800000,onLog});
        if(result.code!==0)throw Error(('OpenModelica guest preparation failed: '+(result.stderr||result.stdout||result.code)).slice(-4000));
        const design=await command('bash /mnt/manta-transfer/worker/prepare-design-tools.sh',{signal:controller.signal,timeoutMs:1800000,onLog});if(design.code!==0)throw Error(('EDA/CAD guest preparation failed: '+(design.stderr||design.stdout||design.code)).slice(-4000));
        ready=await status();if(!ready.ready)throw Error(ready.reason||'OpenModelica preparation did not prove readiness');return ready;
      })().finally(()=>{controllers.delete(controller);preparing=null;});
      preparing.catch(()=>{});
    }
    // Cancellation ends only this caller’s wait. Shared dependency preparation is not silently aborted.
    if(!signal)return preparing;
    return new Promise((resolve,reject)=>{const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason||abortError());};signal.addEventListener('abort',abort,{once:true});preparing.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});});
  }
  function normalize(args){
    if(!args||!JOB.test(args.jobId||''))throw Error('Invalid professional job identifier');
    if(!['check','simulate'].includes(args.operation))throw Error('Invalid Modelica operation');
    const toolId=args.toolId||'openmodelica';if(!['openmodelica','ngspice','openscad'].includes(toolId))throw Error('Unsupported professional tool');
    if(toolId==='openmodelica'&&(typeof args.modelName!=='string'||!IDENT.test(args.modelName)))throw Error('Model name must be a dotted Modelica identifier');
    if(!HASH.test(args.inputHash||''))throw Error('A pinned input hash is required');
    const entries=args.sourceFiles||args.modelFiles?.map(f=>({...f,path:f.name}));
    if(!Array.isArray(entries)||entries.length<1||entries.length>100)throw Error('Expected 1 to 100 Modelica source files');
    let size=0;const seen=new Set();
    const sourceFiles=entries.map(f=>{
      const rel=f?.path;
      const allowed=toolId==='openmodelica'?['.mo']:toolId==='ngspice'?['.cir','.sp','.lib']:['.scad'];
      if(typeof rel!=='string'||!allowed.some(ext=>rel.endsWith(ext))||path.posix.isAbsolute(rel)||rel.includes('\\')||rel.includes('\0')||rel.split('/').some(s=>!s||s==='.'||s==='..')||!/^[A-Za-z0-9_./ -]{1,240}$/.test(rel))throw Error('Invalid project-relative Modelica source path');
      if(seen.has(rel)||typeof f.content!=='string')throw Error('Duplicate Modelica source or invalid content');seen.add(rel);
      const bytes=Buffer.from(f.content);size+=bytes.length;if(bytes.length>2*1024*1024||size>5*1024*1024)throw Error('Modelica source exceeds runner size limit');
      if(f.sha256!==sha(bytes))throw Error('Modelica source hash mismatch');return {path:rel,content:f.content,sha256:f.sha256};
    });
    const suppliedSignals=toolId==='openmodelica'?(args.signals??[]):[];if(!Array.isArray(suppliedSignals)||suppliedSignals.length>100||suppliedSignals.some(name=>typeof name!=='string'||name.length>300||!SIGNAL.test(name)))throw Error('Output signals must be at most 100 dotted variable names with numeric array indices');
    const signals=[...new Set(suppliedSignals)].sort();
    const parameters=args.parameters||{};
    if(!parameters||typeof parameters!=='object'||Array.isArray(parameters)||Object.keys(parameters).length>100||Object.entries(parameters).some(([k,v])=>!IDENT.test(k)||!(typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))))throw Error('Modelica parameters must be finite numbers or booleans');
    const simulation=args.simulation||{},start=simulation.startTime??0,stop=simulation.stopTime??100,intervals=simulation.numberOfIntervals??500,tolerance=simulation.tolerance??1e-6;
    if(![start,stop,tolerance].every(Number.isFinite)||start>=stop||stop-start>365*86400||!Number.isInteger(intervals)||intervals<2||intervals>20000||tolerance<1e-12||tolerance>.1)throw Error('Invalid bounded Modelica simulation settings');
    const mainFile=args.mainFile||sourceFiles[0].path;if(!sourceFiles.some(f=>f.path===mainFile))throw Error('Main source is not in the pinned source set');
    return {jobId:args.jobId,toolId,mainFile,operation:args.operation,inputHash:args.inputHash,modelName:args.modelName,sourceFiles,parameters,signals,simulation:{startTime:start,stopTime:stop,numberOfIntervals:intervals,tolerance}};
  }
  async function run(args,{signal,onLog=()=>{}}={}){
    const request=normalize(args);if(signal?.aborted)throw signal.reason||abortError();await prepare({signal,onLog});if(signal?.aborted)throw signal.reason||abortError();
    const controller=new AbortController();controllers.add(controller);activeJobs.add(request.jobId);const abort=()=>controller.abort(signal.reason||abortError());signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    try{
      const response=decode(await command(request.toolId==='openmodelica'?'python3 /mnt/manta-transfer/worker/professional-run.py':'python3 /mnt/manta-transfer/worker/professional-design.py',{input:JSON.stringify(request),signal:controller.signal,timeoutMs:720000,onLog:()=>{}}));
      if(!Number.isInteger(response.exitCode)||typeof response.success!=='boolean'||!Array.isArray(response.files))throw Error('Invalid professional execution response');
      if(response.receipt&&(response.receipt.inputHash!==request.inputHash||JSON.stringify(response.receipt.sourceFiles)!==JSON.stringify(request.sourceFiles.map(({path,sha256})=>({path,sha256})))))throw Error('Professional execution receipt differs from pinned model input');
      if(response.diagnostics)onLog(String(response.diagnostics).slice(-16000));return response;
    }catch(error){
      if(controller.signal.aborted){await command('python3 /mnt/manta-transfer/worker/professional-run.py --cancel '+request.jobId,{timeoutMs:15000}).catch(()=>{});throw controller.signal.reason||abortError();}
      throw error;
    }finally{controllers.delete(controller);activeJobs.delete(request.jobId);signal?.removeEventListener('abort',abort);}
  }
  return {status,prepare,run,execute(args){return run(args,{signal:args.signal,onLog:args.onLog});},async close(){closing=true;await Promise.allSettled([...activeJobs].map(jobId=>command('python3 /mnt/manta-transfer/worker/professional-run.py --cancel '+jobId,{timeoutMs:15000})));for(const controller of controllers)controller.abort(abortError());if(preparing)await preparing.catch(()=>{});closed=true;}};
}

export const createProfessionalRunnerService=createProfessionalRunner;
