import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {safePath,spawnBounded} from './sandbox.mjs';

const DEFAULT_ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WORKER=fileURLToPath(new URL('./model-backend/worker.mjs',import.meta.url));
const TEMPLATE=fileURLToPath(new URL('./model-backend/nos3.sysml',import.meta.url));
const INTEGRATION_TEMPLATE=fileURLToPath(new URL('./model-backend/nos3-integration.sysml',import.meta.url));
const EXPECTED_VERSION='0.10.10';
const EXPECTED_MANIFEST='b74cc1ec0886820e01627c59adecf80c781ec19e15e8330bea67d1958e4e823d';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const MAX_MODEL=500000;
const LIMITATIONS=[
  'Checks use the Open-MBEE toolkit supported syntax, resolution and semantic rule inventory; this is not complete OMG conformance certification.',
  'The kernel does not execute SysML behaviors or NOS3 simulation. Constraint evaluation is separate from physical or integration verification.',
  'Unresolved referential findings fail the Manta acceptance gate even when the upstream toolkit labels them warnings.'
];
function requireModelPath(value){if(typeof value!=='string'||!value.endsWith('.sysml'))throw Error('Use a project-relative .sysml model path');return value;}
function abort(ctx){if(ctx.signal?.aborted)throw Error('Cancelled');}
function assertContent(content){if(typeof content!=='string'||!content.trim()||Buffer.byteLength(content)>MAX_MODEL)throw Error('Model content must be 1–500000 UTF-8 bytes');}

export async function createModelBackendService({root=DEFAULT_ROOT,dataDir,store,emit=()=>{},runtimePath}={}){
  if(!store?.workspace)throw Error('Project store required');
  // This service never installs packages, reads user runtime configuration or writes
  // outside the selected workspace. dataDir is accepted for service compatibility.
  const runtime=path.resolve(runtimePath||path.join(root,'toolchains/sysml/package'));
  const manifestPath=path.join(path.dirname(runtime),'manifest.json');
  let runtimeInfo={available:false,status:'missing',id:'sysml-wasm',name:'Open-MBEE SysML v2',version:EXPECTED_VERSION};
  async function probe(){
    try{
      const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
      if(sha(JSON.stringify(manifest))!==EXPECTED_MANIFEST)throw Error('Pinned SysML manifest integrity mismatch');
      if(manifest.version!==EXPECTED_VERSION||manifest.name!=='@sysml/wasm')throw Error('Pinned SysML toolchain manifest mismatch');
      if(!manifest.files||Object.keys(manifest.files).length<7)throw Error('Incomplete pinned SysML toolchain manifest');
      for(const [file,expected]of Object.entries(manifest.files)){
        const candidate=safePath(runtime,file);
        if(sha(await fs.readFile(candidate))!==expected)throw Error('SysML toolchain integrity mismatch: '+file);
      }
      runtimeInfo={id:'sysml-wasm',name:'Open-MBEE SysML v2',available:true,status:'ready',version:manifest.version,commit:manifest.commit,repository:manifest.repository,license:manifest.license,archiveSha256:manifest.archiveSha256,manifestSha256:sha(JSON.stringify(manifest)),standardLibrary:'bundled OMG SysML v2 / KerML, EPL-2.0',isolated:true};
    }catch(error){runtimeInfo={...runtimeInfo,available:false,status:'unavailable',detail:error.message};}
    return runtimeInfo;
  }
  await probe();
  const locks=new Map();
  async function exclusive(key,fn){const previous=locks.get(key)||Promise.resolve();let unlock;const current=new Promise(r=>{unlock=r;});locks.set(key,current);await previous;try{return await fn();}finally{unlock();if(locks.get(key)===current)locks.delete(key);}}
  function workspace(projectId){if(typeof projectId!=='string'||!projectId)throw Error('projectId required');return store.workspace(projectId);}
  async function readModel(args){
    const ws=workspace(args.projectId),relative=requireModelPath(args.path),target=safePath(ws,relative);
    const st=await fs.stat(target);if(!st.isFile()||st.size>MAX_MODEL)throw Error('Model must be a file under 500000 bytes');
    const content=await fs.readFile(target,'utf8');assertContent(content);
    if(args.expectedHash&&sha(content)!==args.expectedHash)throw Error('Model revision conflict');
    return {workspace:ws,path:relative,content,sha256:sha(content)};
  }
  async function execute(model,operation,args={},ctx={}){
    abort(ctx);await probe();if(!runtimeInfo.available)throw Error('SysML semantic backend unavailable: '+runtimeInfo.detail);
    // Node permissions restrict the host wrapper as well as the no-WASI kernel.
    // No model/project files, credentials or config are visible to the subprocess.
    const nodeArgs=[
      '--permission','--allow-fs-read='+WORKER,'--allow-fs-read='+runtime,
      '--max-old-space-size=512',WORKER,runtime
    ];
    let executable=process.execPath,argsForProcess=nodeArgs;
    if(process.platform==='darwin'&&fss.existsSync('/usr/bin/sandbox-exec')){
      const readRoots=['/System','/usr','/bin','/sbin','/Library/Apple','/private/etc','/dev',path.dirname(path.dirname(process.execPath)),runtime,path.dirname(WORKER)];
      const profile='(version 1) (deny default) (allow process*) (allow signal (target same-sandbox)) (allow sysctl-read) (allow mach-lookup) (allow file-read-metadata) (allow file-read* (literal "/") '+readRoots.filter(p=>fss.existsSync(p)).map(p=>'(subpath '+JSON.stringify(fss.realpathSync(p))+')').join(' ')+')';
      executable='/usr/bin/sandbox-exec';argsForProcess=['-p',profile,process.execPath,...nodeArgs];
    }
    const result=await spawnBounded(executable,argsForProcess,{cwd:runtime,env:{LANG:'en_US.UTF-8',NODE_NO_WARNINGS:'1'},timeoutMs:20000,maxBytes:12000000,signal:ctx.signal,input:JSON.stringify({operation,query:args.query,format:args.format,sources:[{name:model.path,text:model.content}]})});
    if(result.code!==0)throw Error('SysML backend failed: '+result.stderr.slice(-1500));
    const output=JSON.parse(result.stdout);
    if(output.version!==EXPECTED_VERSION)throw Error('Unexpected SysML kernel version');
    return {...output,backend:{...runtimeInfo},model:{path:model.path,sha256:model.sha256},limitations:LIMITATIONS};
  }
  async function sourceEvidence(ws,sources=[]){
    if(!Array.isArray(sources)||sources.length>16)throw Error('sources must contain at most 16 project-relative evidence files');
    const output=[];
    for(const source of sources){
      if(!source||typeof source.path!=='string')throw Error('Each source requires a project-relative path');
      const target=safePath(ws,source.path),st=await fs.stat(target);if(!st.isFile()||st.size>4000000)throw Error('Source evidence must be a file under 4 MB');
      const hash=sha(await fs.readFile(target));if(source.sha256&&source.sha256!==hash)throw Error('Source revision conflict: '+source.path);
      if(source.lineStart!==undefined&&(!Number.isInteger(source.lineStart)||source.lineStart<1))throw Error('Invalid source lineStart');
      if(source.lineEnd!==undefined&&(!Number.isInteger(source.lineEnd)||source.lineEnd<(source.lineStart||1)))throw Error('Invalid source lineEnd');
      output.push({path:source.path,sha256:hash,...(source.lineStart?{lineStart:source.lineStart}:{}),...(source.lineEnd?{lineEnd:source.lineEnd}:{})});
    }
    return output;
  }
  async function record(model,result,ctx={},extra={}){
    abort(ctx);
    const id='model_'+crypto.randomUUID().replaceAll('-',''),relative=`.manta/model-evidence/${id}.json`;
    const target=safePath(model.workspace,relative,{write:true});await fs.mkdir(path.dirname(target),{recursive:true});
    const doc={schema:'manta-model-evidence-v1',id,projectId:extra.projectId,createdAt:new Date().toISOString(),...result,...extra};
    await fs.writeFile(target,JSON.stringify(doc,null,2));
    const evidence={id,path:relative,sha256:sha(await fs.readFile(target))};
    if(store.add)store.add('artifacts',{id:'artifact_'+crypto.randomUUID(),projectId:extra.projectId,threadId:ctx.threadId||null,runId:ctx.runId||null,name:path.basename(model.path)+' · '+(extra.operation||'validation'),path:relative,type:'application/json',createdAt:doc.createdAt});
    emit({projectId:extra.projectId,runId:ctx.runId,type:'model.backend.completed',message:result.valid?'SysML model check completed':'SysML model findings recorded',data:{id,model:model.path,valid:result.valid}});
    return {...result,evidence};
  }
  const service={
    async catalog({projectId}={}){if(projectId)workspace(projectId);return {backend:{...runtimeInfo},operations:['import','query','validate','export','verify','generate-nos3','bind-nos3-results'],language:'SysML v2 / KerML',validationScope:'supported-rule-inventory-with-bundled-standard-library',limitations:LIMITATIONS};},
    async importModel(args={},ctx={}){
      const ws=workspace(args.projectId),relative=requireModelPath(args.path);assertContent(args.content);abort(ctx);
      return exclusive(args.projectId+':'+relative,async()=>{
        const target=safePath(ws,relative,{write:true});let previous=null;try{previous=await fs.readFile(target,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
        if(previous!==null&&(typeof args.expectedHash!=='string'||sha(previous)!==args.expectedHash))throw Error('Model revision conflict: pass expectedHash of the current model to replace it');
        if(previous===null&&args.expectedHash)throw Error('Model revision conflict: target does not exist');
        const sources=await sourceEvidence(ws,args.sources||[]),model={workspace:ws,path:relative,content:args.content,sha256:sha(args.content)};
        const result=await execute(model,'validate',args,ctx);
        if(!result.valid)return {...result,imported:false,reason:'Semantic acceptance gate failed; existing model preserved'};
        abort(ctx);safePath(ws,relative,{write:true});
        let current=null;try{current=await fs.readFile(target,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
        if(current!==previous)throw Error('Model revision conflict: file changed while semantic checking');
        await fs.mkdir(path.dirname(target),{recursive:true});
        const temporary=target+'.'+crypto.randomUUID()+'.tmp';
        try{await fs.writeFile(temporary,args.content,{flag:'wx'});await fs.rename(temporary,target);}finally{await fs.rm(temporary,{force:true});}
        return record(model,{...result,imported:true},ctx,{projectId:args.projectId,operation:'import',sources,previousSha256:previous===null?null:sha(previous)});
      });
    },
    async validate(args={},ctx={}){const model=await readModel(args);const result=await execute(model,'validate',args,ctx);return record(model,result,ctx,{projectId:args.projectId,operation:'validate'});},
    async query(args={},ctx={}){if(args.query!==undefined&&(typeof args.query!=='string'||args.query.length>4000))throw Error('Query must be a KerML expression under 4000 characters');const model=await readModel(args);return execute(model,'query',args,ctx);},
    async verify(args={},ctx={}){const model=await readModel(args),result=await execute(model,'verify',args,ctx);return record(model,{...result,verificationScope:'static constraint evaluation and interval propagation; no behavior/simulation execution'},ctx,{projectId:args.projectId,operation:'verify'});},
    async exportModel(args={},ctx={}){if(!['sysml','compact-json','full-json','plantuml'].includes(args.format))throw Error('Supported formats: sysml, compact-json, full-json, plantuml');const model=await readModel(args);if(args.format==='sysml')return {format:'sysml',content:model.content,model:{path:model.path,sha256:model.sha256},backend:{...runtimeInfo}};const result=await execute(model,'export',args,ctx);return {...result,format:args.format,content:result.data,data:undefined,...(args.format==='full-json'?{interchangeScope:'Upstream recovery-enabled full form; incomplete derived properties may be represented by recovery annotations. Prefer compact-json for stable source interchange.'}:{})};},
    async bindNos3Results(args={},ctx={}){
      if(typeof args.expectedHash!=='string')throw Error('expectedHash required when binding measured results');
      const model=await readModel(args),resultPath=safePath(model.workspace,args.resultPath);
      const st=await fs.stat(resultPath);if(!st.isFile()||st.size>1000000)throw Error('NOS3 result must be a JSON file under 1 MB');
      const resultText=await fs.readFile(resultPath,'utf8');
      if(args.expectedResultHash&&sha(resultText)!==args.expectedResultHash)throw Error('NOS3 result integrity receipt changed');
      const result=JSON.parse(resultText);
      if(result.scope==='integration') {
        if(!['completed','failed'].includes(result.status)||result.fullNos3Simulation!==true||result.hardwareValidation!==false||result.modelBehaviorExecuted!==false)throw Error('Only actual, explicitly scoped NOS3 live integration measurements can be bound');
        if(!result.modelEvidence?.some(e=>e.path===model.path&&e.sha256===model.sha256))throw Error('NOS3 result does not refer to this exact model revision');
        const m=result.metrics;
        for(const key of ['fixedAdcsRotationErrorDeg','fixedGncRotationErrorDeg','negativeSignGncRotationErrorDeg'])if(!Number.isFinite(m?.[key])||m[key]<0)throw Error('Invalid live NOS3 metric '+key);
        const tolerance=m.faultBounds?.rotationToleranceDeg;
        if(!Number.isFinite(tolerance)||tolerance<=0||tolerance>1)throw Error('Invalid live rotation tolerance');
        for(const key of ['originalDoubleMountDefect','quaternionSign','invalidMeasurement'])if(typeof m.negativeControls?.[key]!=='boolean')throw Error('Missing live negative control '+key);
        if(!Array.isArray(result.checks)||!result.checks.length||result.checks.some(c=>typeof c.passed!=='boolean')||result.passed!==result.checks.every(c=>c.passed))throw Error('Invalid live acceptance summary');
        if(model.content.includes('package NOS3LiveVerification'))throw Error('A live-result package is already present; use a fresh model revision for a new run');
        const bias=result.checks.find(c=>c.id==='biased-input'||c.id==='sensor-bias');
        const pending=[...(result.pendingRequirements||[])];
        if(!bias?.passed&&!pending.some(r=>r.id==='R-SENSOR-SEPARATION'))pending.push({id:'R-SENSOR-SEPARATION',status:'not-tested',reason:'A live sensor-bias negative control is required to rule out dynamics-truth substitution.'});
        const addition=`\npackage NOS3LiveVerification {\n    private import ScalarValues::*;\n    doc /* Recorded native live integration result SHA256 ${sha(resultText)}.\n           Values originate in actual sensor-chain telemetry and an independent\n           matrix oracle. Model behavior itself was not executed by SysML. */\n    attribute rotationToleranceDeg : Real = ${tolerance};\n    attribute fixedAdcsRotationErrorDeg : Real = ${m.fixedAdcsRotationErrorDeg};\n    attribute fixedGncRotationErrorDeg : Real = ${m.fixedGncRotationErrorDeg};\n    attribute negativeSignGncRotationErrorDeg : Real = ${m.negativeSignGncRotationErrorDeg};\n    attribute originalDefectObserved : Boolean = ${m.negativeControls.originalDoubleMountDefect};\n    attribute signControlPassed : Boolean = ${m.negativeControls.quaternionSign};\n    attribute invalidControlPassed : Boolean = ${m.negativeControls.invalidMeasurement};\n    assert constraint adcsFramePassed { fixedAdcsRotationErrorDeg <= rotationToleranceDeg }\n    assert constraint gncFramePassed { fixedGncRotationErrorDeg <= rotationToleranceDeg }\n    assert constraint signOrientationPassed { negativeSignGncRotationErrorDeg <= rotationToleranceDeg }\n    assert constraint originalDefectReproduced { originalDefectObserved }\n    assert constraint signRegressionPassed { signControlPassed }\n    assert constraint invalidMeasurementPassed { invalidControlPassed }\n${bias?`    attribute sensorBiasControlPassed : Boolean = ${bias.passed};\n    assert constraint sensorTruthSeparationPassed { sensorBiasControlPassed }\n`:''}}\n`;
        const imported=await service.importModel({...args,content:model.content+addition,sources:[{path:args.resultPath,sha256:sha(resultText)}]},ctx);
        if(!imported.imported)return imported;
        const verification=await service.verify({projectId:args.projectId,path:model.path,expectedHash:imported.model.sha256},ctx);
        return {...verification,bound:true,previousModelSha256:model.sha256,resultEvidence:{path:args.resultPath,sha256:sha(resultText)},pendingRequirements:pending,measurementScope:'Recorded native NOS3/cFS/42 selected star-tracker chain; hardware, timing and all-device mission remain unverified'};
      }
      if(!['completed','failed'].includes(result.status)||result.scope!=='component'||result.fullNos3Simulation!==false||result.modelBehaviorExecuted!==false)throw Error('Only completed executions with explicitly scoped NOS3 component measurements can be bound');
      if(!Array.isArray(result.modelEvidence)||!result.modelEvidence.some(e=>e.path===model.path&&e.sha256===model.sha256))throw Error('NOS3 result does not refer to this exact model revision');
      const metrics=result.metrics;
      for(const key of ['compositionMaxError','signMaxError','inverseMaxError','tolerance'])if(!Number.isFinite(metrics?.[key])||metrics[key]<0)throw Error('Invalid NOS3 metric '+key);
      if(metrics.tolerance===0||metrics.tolerance>1||!Number.isInteger(metrics.cases)||metrics.cases<1||metrics.cases>1000000)throw Error('Invalid NOS3 case count or tolerance');
      if(!Array.isArray(result.pendingRequirements)||!result.pendingRequirements.some(r=>r.id==='R-SENSOR-SEPARATION'&&r.status==='not-tested'))throw Error('Component result must preserve the untested sensor/truth requirement');
      if(model.content.includes('package NOS3ComponentVerification'))throw Error('A component-result package is already present; regenerate or explicitly edit the model before rebinding');
      const addition=`\npackage NOS3ComponentVerification {\n    private import ScalarValues::*;\n    doc /* Recorded component measurements from result SHA256 ${sha(resultText)}.\n           This binds declared result values, not an independent rerun.\n           R-SENSOR-SEPARATION and full NOS3 integration remain untested. */\n    attribute componentTolerance : Real = ${metrics.tolerance};\n    attribute compositionMaxError : Real = ${metrics.compositionMaxError};\n    attribute signMaxError : Real = ${metrics.signMaxError};\n    attribute inverseMaxError : Real = ${metrics.inverseMaxError};\n    assert constraint compositionPassed { compositionMaxError < componentTolerance }\n    assert constraint signEquivalencePassed { signMaxError < componentTolerance }\n    assert constraint inversePassed { inverseMaxError < componentTolerance }\n}\n`;
      const imported=await service.importModel({...args,content:model.content+addition,sources:[{path:args.resultPath,sha256:sha(resultText)}]},ctx);
      if(!imported.imported)return imported;
      const verification=await service.verify({projectId:args.projectId,path:model.path,expectedHash:imported.model.sha256},ctx);
      return {...verification,bound:true,previousModelSha256:model.sha256,resultEvidence:{path:args.resultPath,sha256:sha(resultText)},pendingRequirements:result.pendingRequirements,measurementScope:'Recorded vector-component residuals from upstream utility harness; no full simulation, no model behavior execution'};
    },
    async generateNos3Model(args={},ctx={}){
      const ws=workspace(args.projectId);let sources=args.sources;
      if(!sources){sources=[];for(const file of ['components/generic_adcs/fsw/shared/generic_adcs_utilities.c','components/generic_adcs/fsw/shared/generic_adcs_adac.c','components/generic_adcs/fsw/cfs/src/generic_adcs_ingest.c'])try{await fs.access(safePath(ws,file));sources.push({path:file});}catch{}}
      const result=await service.importModel({...args,path:args.path||'models/nos3-attitude-interface.sysml',content:await fs.readFile(args.scope==='integration'?INTEGRATION_TEMPLATE:TEMPLATE,'utf8'),sources},ctx);
      return {...result,origin:'Manta source-linked reconstruction; not a NASA-issued SysML model',upstreamEvidence:!!sources.length,requirementIds:args.scope==='integration'?['R-FRAME','R-SIGN','R-INVALID','R-SENSOR-SEPARATION']:['R-ROTATION','R-SIGN','R-SENSOR-SEPARATION'],executionScope:args.scope==='integration'?'Selected NOS3/cFS/42 star-tracker live chain, awaiting actual execution evidence':'NOS3 generic_adcs quaternion utility component; full input path/integration remains pending'};
    }
  };
  return service;
}
