import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {safePath} from './sandbox.mjs';

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const now=()=>new Date().toISOString();
const TERMINAL=new Set(['completed','failed','cancelled','interrupted']);
const MAX_SOURCE=2_000_000,MAX_SOURCES=32,MAX_TOTAL=8_000_000,MAX_OUTPUT=24_000_000;
const SUBMIT_FIELDS=new Set(['projectId','path','expectedHash','sourcePaths','operation','modelName','parameters','simulation','signals','checks','timeoutMs']);
const ID=/^professional_[a-f0-9]{32}$/;
const languageOf=relative=>relative.endsWith('.stf.json')?'nos3-stf':relative.endsWith('.mo')?'modelica':relative.endsWith('.cir')?'spice':relative.endsWith('.scad')?'openscad':relative.endsWith('.sysml')?'sysml':'c-source';
const toolFor=language=>({modelica:'openmodelica',spice:'ngspice',openscad:'openscad','nos3-stf':'nos3-stf',sysml:'sysml-wasm'}[language]);
function fail(message,code='INVALID_INPUT'){const error=new Error(message);error.code=code;error.statusCode=code==='REVISION_CONFLICT'?409:400;return error;}
function modelPath(value){
  if(typeof value!=='string'||!value||value.includes('\\')||value.split('/').some(s=>s==='..'||s==='.'||s.startsWith('.'))||! /(?:\.(?:mo|sysml|cir|scad|c|h)|\.stf\.json)$/i.test(value))throw fail('Use a project-relative native model or source path without hidden or traversal segments');
  return value;
}
function sourceContent(content){if(typeof content!=='string'||!content.trim()||content.includes('\0')||Buffer.byteLength(content)>MAX_SOURCE)throw fail('Model source must contain 1–2000000 UTF-8 bytes');}
function aborted(signal){if(signal?.aborted)throw fail('Cancelled','CANCELLED');}
function filename(value){if(typeof value!=='string'||!value||value.includes('\\')||path.isAbsolute(value)||value.split('/').some(s=>!s||s==='.'||s==='..'||s.startsWith('.'))||value.length>500||/[\x00-\x1f]/.test(value))throw fail('Invalid runner artifact path');return value;}
function normalizeSimulation(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail('simulation must be an object');
  for(const field of Object.keys(input))if(!['startTime','stopTime','numberOfIntervals','tolerance'].includes(field))throw fail(`Unknown simulation setting: ${field}`);
  const simulation={startTime:input.startTime??0,stopTime:input.stopTime??100,numberOfIntervals:input.numberOfIntervals??1000,tolerance:input.tolerance??1e-6};
  if(!Number.isFinite(simulation.startTime)||!Number.isFinite(simulation.stopTime)||simulation.stopTime<=simulation.startTime||Math.abs(simulation.startTime)>1e10||Math.abs(simulation.stopTime)>1e10)throw fail('Simulation stopTime must be greater than startTime within ±1e10 seconds');
  if(simulation.stopTime-simulation.startTime>31536000)throw fail('Simulation duration must not exceed 365 days');
  if(!Number.isInteger(simulation.numberOfIntervals)||simulation.numberOfIntervals<2||simulation.numberOfIntervals>20000)throw fail('numberOfIntervals must be between 2 and 20000');
  if(!Number.isFinite(simulation.tolerance)||simulation.tolerance<1e-12||simulation.tolerance>0.1)throw fail('tolerance must be between 1e-12 and 0.1');
  return simulation;
}
function normalizeSignals(input,language,checks){
  if(input!==undefined&&(!Array.isArray(input)||input.length>100))throw fail('signals must contain at most 100 Modelica output names');
  if(language!=='modelica'){if(input?.length)throw fail('Output signal selection is available for Modelica only');return [];}
  if(!input?.length)return [];
  const part='[A-Za-z_][A-Za-z0-9_]*(?:\\[-?\\d+(?:,-?\\d+)*\\])?',base=part+'(?:\\.'+part+')*',pattern=new RegExp('^(?:'+base+'|(?:der|pre)\\('+base+'\\))$');
  const signals=[...new Set([...input,...checks.map(c=>c.variable)])].sort();
  if(signals.length>100||signals.some(name=>typeof name!=='string'||name.length>300||!pattern.test(name)))throw fail('Use up to 100 literal Modelica output names; criterion variables are included');
  return signals;
}
function normalizeParameters(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length>100)throw fail('parameters must be an object with at most 100 numeric or boolean values');
  const output=Object.create(null);for(const key of Object.keys(input).sort()){
    if(!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(key)||!(typeof input[key]==='boolean'||typeof input[key]==='number'&&Number.isFinite(input[key])&&Math.abs(input[key])<=1e100))throw fail('Parameter names must be dotted identifiers and values finite numbers or booleans');output[key]=input[key];
  }return output;
}
function normalizeChecks(input=[]){
  if(!Array.isArray(input)||input.length>100)throw fail('checks must be an array with at most 100 criteria');
  const ids=new Set();return input.map(check=>{
    if(!check||typeof check.id!=='string'||!check.id.trim()||check.id.length>150||ids.has(check.id)||typeof check.variable!=='string'||!check.variable||check.variable.length>300||!['initial','min','max','final','mean'].includes(check.metric)||!['<=','>=','<','>','=='].includes(check.operator)||!Number.isFinite(check.expected)||check.tolerance!==undefined&&(!Number.isFinite(check.tolerance)||check.tolerance<0))throw fail('Each check needs a unique id, variable, metric, operator and finite expected value');
    if(check.requirementId!==undefined&&(typeof check.requirementId!=='string'||check.requirementId.length>200))throw fail('Invalid requirementId');ids.add(check.id);return {id:check.id,...(check.requirementId?{requirementId:check.requirementId}:{}),variable:check.variable,metric:check.metric,operator:check.operator,expected:check.expected,...(check.tolerance!==undefined?{tolerance:check.tolerance}:{})};
  });
}
/** Parse actual OpenModelica CSV. Preview reduction never affects acceptance checks. */
export function parseProfessionalCsv(text,{maxRows=100002,maxColumns=512}={}){
  if(typeof text!=='string'||Buffer.byteLength(text)>MAX_OUTPUT)throw fail('CSV output exceeds allowed size');
  text=text.replace(/^\uFEFF/,'');const records=[];let row=[],field='',quoted=false,afterQuote=false;
  const pushField=()=>{row.push(field);field='';afterQuote=false;if(row.length>maxColumns)throw fail('CSV has too many columns');};
  const pushRow=()=>{pushField();if(row.some(v=>v!==''))records.push(row);row=[];if(records.length>maxRows)throw fail('CSV has too many rows');};
  for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;afterQuote=true;}}else field+=c;continue;}
    if(c==='"'){if(field||afterQuote)throw fail('Malformed CSV quote');quoted=true;}else if(c===',')pushField();else if(c==='\n')pushRow();else if(c==='\r'){if(text[i+1]==='\n')i++;pushRow();}else{if(afterQuote&&!/\s/.test(c))throw fail('Malformed CSV after quote');if(!afterQuote)field+=c;}}
  if(quoted)throw fail('Unclosed CSV quote');if(field||row.length||afterQuote)pushRow();
  if(!records.length)throw fail('CSV result contains no header');const columns=records.shift().map(x=>x.trim());
  if(columns.some(x=>!x)||new Set(columns).size!==columns.length)throw fail('CSV header must contain unique non-empty columns');
  const rows=records.map((record,index)=>{if(record.length!==columns.length)throw fail('CSV row '+(index+2)+' has a different column count');return record.map(value=>{const trimmed=value.trim();if(!trimmed)return null;const n=Number(trimmed);return Number.isFinite(n)?n:null;});});
  return {columns,rows,rowCount:rows.length};
}
function evaluatedChecks(checks,table,{startTime}={}){
  return checks.map(check=>{const column=table?.columns.indexOf(check.variable)??-1,values=column<0?[]:table.rows.map(row=>row[column]);const relevant=check.metric==='initial'?values.slice(0,1):values;if(!relevant.length||relevant.some(value=>!Number.isFinite(value)))return {...check,status:'unknown',passed:null,actual:null,reason:'Missing or nonfinite samples prevent this criterion from being decided: '+check.variable};
    if(check.metric==='initial'&&Number.isFinite(startTime)){
      const timeColumn=table.columns.findIndex(name=>name.toLowerCase()==='time'),sampleTime=timeColumn<0?null:table.rows[0]?.[timeColumn],timeTolerance=Math.max(1e-9,16*Number.EPSILON*Math.abs(startTime));
      if(!Number.isFinite(sampleTime)||Math.abs(sampleTime-startTime)>timeTolerance)return {...check,status:'unknown',passed:null,actual:null,reason:'No recorded sample at the requested simulation startTime'};
    }
    const actual=check.metric==='initial'?values[0]:check.metric==='final'?values.at(-1):check.metric==='mean'?values.reduce((sum,v)=>sum+v,0)/values.length:check.metric==='min'?values.reduce((m,v)=>Math.min(m,v),Infinity):values.reduce((m,v)=>Math.max(m,v),-Infinity);
    const tolerance=check.tolerance??0,expected=check.expected;
    const passed=check.operator==='<='?actual<=expected+tolerance:check.operator==='>='?actual>=expected-tolerance:check.operator==='<'?actual<expected:check.operator==='>'?actual>expected:Math.abs(actual-expected)<=tolerance;
    return {...check,status:passed?'passed':'failed',passed,actual,samples:relevant.length};
  });
}
function preview(table){
  if(!table)return {table:null,series:[]};const step=Math.max(1,Math.ceil(table.rows.length/5000)),rows=table.rows.filter((_,i)=>i%step===0||i===table.rows.length-1);
  const timeIndex=table.columns.findIndex(name=>name.toLowerCase()==='time'),xIndex=timeIndex>=0?timeIndex:-1;
  const series=table.columns.flatMap((name,column)=>column===timeIndex?[]:[{name,unit:null,xName:xIndex>=0?table.columns[xIndex]:'sample',xUnit:timeIndex>=0?'s':null,points:rows.flatMap((row,index)=>{const x=xIndex>=0?row[xIndex]:index*step;return Number.isFinite(x)&&Number.isFinite(row[column])?[[x,row[column]]]:[];})}]).filter(item=>item.points.length);
  return {table:{columns:table.columns,rows,rowCount:table.rowCount,truncated:rows.length<table.rowCount},series};
}
async function atomicJson(target,value){const temporary=target+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temporary,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});try{await fs.rename(temporary,target);}finally{await fs.rm(temporary,{force:true});}}

export async function createProfessionalModelsService({dataDir,store,runner,sysmlBackend,emit=()=>{},maxJobMs=600000}={}){
  if(!store?.workspace||!dataDir)throw Error('Professional models require a project store and private dataDir');
  const disk=path.join(dataDir,'professional-models');await fs.mkdir(disk,{recursive:true,mode:0o700});
  const jobs=new Map(),controllers=new Map(),events=new EventEmitter(),queue=[],tasks=new Set(),locks=new Map();events.setMaxListeners(100);
  let active=0,closed=false;
  const workspace=projectId=>{if(typeof projectId!=='string'||!projectId)throw fail('projectId required');return store.workspace(projectId);};
  const scoped=args=>{workspace(args?.projectId);if(!ID.test(args?.jobId))throw fail('Invalid professional job identifier');const job=jobs.get(args.jobId);if(!job||job.projectId!==args.projectId)throw fail('Job does not belong to this project');return job;};
  const publicJob=job=>{const output=clone(job);delete output.result;delete output.artifactHashes;return output;};
  async function exclusive(key,fn){const previous=locks.get(key)||Promise.resolve();let unlock;const next=new Promise(resolve=>unlock=resolve);locks.set(key,next);await previous;try{return await fn();}finally{unlock();if(locks.get(key)===next)locks.delete(key);}}
  async function persist(job){await atomicJson(path.join(disk,job.id+'.json'),job);events.emit(job.id,publicJob(job));emit({projectId:job.projectId,threadId:job.threadId,runId:job.runId,type:'professional.'+job.status,message:job.reason||`${job.operation} ${job.status}`,data:{jobId:job.id,status:job.status,modelPath:job.model.path}});}
  for(const name of await fs.readdir(disk)){
    if(!/^professional_[a-f0-9]{32}\.json$/.test(name))continue;
    const job=JSON.parse(await fs.readFile(path.join(disk,name),'utf8'));if(!ID.test(job.id)||job.id+'.json'!==name)throw Error('Invalid persisted professional job');
    if(!TERMINAL.has(job.status)){job.status='interrupted';job.reason='Manta restarted before an execution receipt was committed; restart explicitly to rerun pinned inputs';job.finishedAt=now();await atomicJson(path.join(disk,name),job);}jobs.set(job.id,job);
  }
  async function readModel(args={}){const ws=workspace(args.projectId),relative=modelPath(args.path),target=safePath(ws,relative),stat=await fs.stat(target);if(!stat.isFile()||stat.size>MAX_SOURCE)throw fail('Model must be a regular file under 2 MB');const content=await fs.readFile(target,'utf8');sourceContent(content);const hash=sha(content);if(args.expectedHash&&hash!==args.expectedHash)throw fail('Model revision conflict: reload the current model','REVISION_CONFLICT');return {path:relative,language:languageOf(relative.toLowerCase()),content,sha256:hash,bytes:Buffer.byteLength(content)};}
  async function snapshotSources(args){const main=await readModel(args);let paths=args.sourcePaths??[];if(!Array.isArray(paths)||paths.length>=MAX_SOURCES)throw fail('sourcePaths must contain at most 31 model dependencies');paths=[...new Set([main.path,...paths])];const sourceFiles=[];let total=0;for(const relative of paths){const source=relative===main.path?main:await readModel({projectId:args.projectId,path:relative});if(source.language!==main.language&&!(main.language==='nos3-stf'&&source.language==='c-source'))throw fail('Sources in one job must use the same model language, except explicit NOS3 C table dependencies');total+=source.bytes;if(total>MAX_TOTAL)throw fail('Combined model sources exceed 8 MB');sourceFiles.push(source);}return {main,sourceFiles};}
  function jobDirectory(job,{write=false}={}){return safePath(workspace(job.projectId),job.relative,{write});}
  async function artifact(job,file,bytes,mimeType){filename(file);const dir=jobDirectory(job),target=safePath(dir,file,{write:true});await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});await fs.writeFile(target,bytes,{mode:0o600});const entry={name:path.basename(file),path:job.relative+'/'+file,sha256:sha(bytes),bytes:Buffer.byteLength(bytes),mimeType:mimeType||'text/plain'};job.artifactHashes[file]=entry;return entry;}
  async function finish(job,result){
    const checks=evaluatedChecks(job.checks,result.fullTable,job.model.language==='modelica'?job.simulation:undefined);
    if(result.nativeVerification?.checks?.length){if(!Array.isArray(result.nativeVerification.checks)||result.nativeVerification.checks.length>100)throw Error('Invalid native verification checks');for(const check of result.nativeVerification.checks){if(!check||typeof check.id!=='string'||!['boolean','undefined'].includes(typeof check.passed)&&check.passed!==null)throw Error('Malformed native verification check');checks.push({...check,id:'native:'+check.id,source:'native-runner',status:check.passed===true?'passed':check.passed===false?'failed':'unknown',passed:check.passed??null});}}
    delete result.fullTable;
    const verification={status:checks.length?checks.some(check=>check.passed===false)?'failed':checks.some(check=>check.passed===null)?'unknown':'passed':'not-requested',checks};
    const receipt={schema:'manta-professional-execution-v1',jobId:job.id,inputHash:job.inputHash,model:job.model,sourceFiles:job.sourceFiles.map(({path,sha256})=>({path,sha256})),operation:job.operation,parameters:job.parameters,simulation:job.simulation,signals:job.signals||[],tool:result.tool||null,runnerReceipt:result.receipt||null,executionSucceeded:result.executionSucceeded===true,createdAt:job.createdAt,startedAt:job.startedAt||null,finishedAt:job.finishedAt,scope:'Digital model check / numerical simulation only; no physical, HIL, certification or project-completion claim'};
    const receiptEntry=await artifact(job,'receipt.json',JSON.stringify(receipt,null,2),'application/json');
    job.result={schema:'manta-professional-result-v1',jobId:job.id,status:job.status,ready:true,operation:job.operation,model:job.model,sourceFiles:job.sourceFiles.map(({path,sha256})=>({path,sha256})),inputHash:job.inputHash,...result,receipt,verification,passed:result.executionSucceeded===true&&verification.status==='passed'?true:verification.status==='failed'||result.executionSucceeded===false?false:null,receiptSha256:receiptEntry.sha256,resultPath:job.relative+'/result.json',limitations:['Simulation outcomes apply only to the exact recorded model, parameters, scenario and tool version.','Missing physical tests, independent review and applicable engineering work remain open.']};
    const resultEntry=await artifact(job,'result.json',JSON.stringify(job.result,null,2),'application/json');job.resultSha256=resultEntry.sha256;
    job.artifacts=Object.values(job.artifactHashes);
    if(store.add)for(const entry of job.artifacts)store.add('artifacts',{id:'artifact_'+crypto.randomUUID(),projectId:job.projectId,threadId:job.threadId,runId:job.runId,name:job.id+' · '+entry.name,path:entry.path,type:entry.mimeType,createdAt:now()});
  }
  async function execute(job){
    const controller=new AbortController();controllers.set(job.id,controller);const timer=setTimeout(()=>{job.timedOut=true;controller.abort();},job.timeoutMs);timer.unref?.();let logs='';
    try{
      if(job.cancelRequested)return;job.status='running';job.startedAt=now();await persist(job);
      const sourceFiles=[];for(const item of job.sourceFiles){const content=await fs.readFile(safePath(jobDirectory(job),item.snapshot),'utf8');if(sha(content)!==item.sha256)throw Error('Pinned source snapshot integrity mismatch: '+item.path);sourceFiles.push({path:item.path,content,sha256:item.sha256});}
      let output;
      const onLog=line=>{logs+=(String(line).slice(0,4000)+'\n');if(logs.length>500000)logs=logs.slice(-500000);emit({projectId:job.projectId,runId:job.runId,type:'professional.log',message:String(line).slice(0,4000),data:{jobId:job.id}});};
      if(job.model.language==='sysml'){
        if(!sysmlBackend?.validate)throw Error('SysML semantic backend unavailable');
        const checked=await sysmlBackend.validate({projectId:job.projectId,path:job.relative+'/'+job.sourceFiles[0].snapshot,expectedHash:job.model.sha256},{signal:controller.signal,threadId:job.threadId,runId:job.runId});
        output={exitCode:checked.valid?0:1,success:checked.valid===true,tool:{id:'sysml-wasm',name:'SysML semantic backend',...checked.backend},diagnostics:JSON.stringify(checked.findings||[]),receipt:{inputHash:job.inputHash,sourceHashes:job.sourceFiles.map(({path,sha256})=>({path,sha256}))},files:[{path:'sysml-validation.json',contentBase64:Buffer.from(JSON.stringify(checked,null,2)).toString('base64')}]};
      }else{
        if(!runner?.run)throw Error('Isolated OpenModelica runner is not configured');
        output=await runner.run({jobId:job.id,operation:job.operation,toolId:toolFor(job.model.language),mainFile:job.model.path,inputHash:job.inputHash,modelName:job.modelName,sourceFiles,parameters:job.parameters,simulation:job.simulation,signals:job.signals||[]},{signal:controller.signal,onLog});
      }
      aborted(controller.signal);if(job.cancelRequested)throw fail('Cancelled','CANCELLED');
      if(!output||!Number.isInteger(output.exitCode)||typeof output.success!=='boolean'||typeof output.tool?.version!=='string'||!output.receipt||output.receipt.inputHash!==job.inputHash)throw Error('Runner returned an incomplete or mismatched execution receipt');
      const recordedHashes=output.receipt.sourceHashes||output.receipt.sourceFiles;
      if(!Array.isArray(recordedHashes)||sourceFiles.some(item=>!recordedHashes.some(record=>(record.path||record.name)===item.path&&record.sha256===item.sha256)))throw Error('Runner receipt does not bind the exact submitted model sources');
      const files=output.files??[];if(!Array.isArray(files)||files.length>64)throw Error('Runner returned too many artifacts');let total=0,fullTable=null,tableFile=null;const seen=new Set();
      for(const file of files){const relative=filename(file.path||file.name);if(seen.has(relative))throw Error('Duplicate runner artifact path');seen.add(relative);if(typeof file.contentBase64!=='string')throw Error('Runner artifact lacks original bytes');const bytes=Buffer.from(file.contentBase64,'base64');total+=bytes.length;if(total>MAX_OUTPUT)throw Error('Runner output exceeds 24 MB');if(file.sha256&&sha(bytes)!==file.sha256)throw Error('Runner artifact integrity mismatch: '+relative);await artifact(job,'outputs/'+relative,bytes,file.mimeType||(relative.endsWith('.csv')?'text/csv':relative.endsWith('.json')?'application/json':'text/plain'));if(relative.endsWith('.csv')&&(!tableFile||relative.endsWith('_res.csv'))){fullTable=parseProfessionalCsv(bytes.toString('utf8'));tableFile=job.relative+'/outputs/'+relative;}}
      const geometry=output.outputKind==='geometry'&&output.geometry&&files.some(file=>/\.stl$/i.test(file.path||file.name))?output.geometry:null;
      const executionSucceeded=output.exitCode===0&&output.success===true&&(job.operation!=='simulate'||!!fullTable?.rowCount||!!geometry);
      job.status=executionSucceeded?'completed':'failed';job.reason=executionSucceeded?undefined:String(output.diagnostics||'Professional tool did not produce a successful '+job.operation+' result').slice(0,3000);job.finishedAt=now();
      await artifact(job,'execution.log',logs+(output.diagnostics||''),'text/plain');
      await finish(job,{executionSucceeded,tool:output.tool,exitCode:output.exitCode,diagnostics:String(output.diagnostics||'').slice(0,100000),receipt:output.receipt,nativeVerification:output.verification||null,geometry,outputKind:geometry?'geometry':'data',...preview(fullTable),fullTable,tableFile});
    }catch(error){
      job.status=job.cancelRequested?'cancelled':job.shutdown?'interrupted':'failed';job.reason=job.timedOut?'Professional model execution timed out':String(error.message).slice(0,3000);job.finishedAt=now();
      await artifact(job,'execution.log',logs+job.reason+'\n','text/plain');await finish(job,{executionSucceeded:false,reason:job.reason,diagnostics:job.reason,table:null,series:[]});
    }finally{clearTimeout(timer);controllers.delete(job.id);await persist(job);}
  }
  function pump(){if(closed||active)return;const job=queue.shift();if(!job)return;if(TERMINAL.has(job.status)){queueMicrotask(pump);return;}active++;let task;task=execute(job).catch(async error=>{job.status='failed';job.reason='Result persistence failed: '+String(error.message).slice(0,1000);job.finishedAt=now();await persist(job);}).finally(()=>{active--;tasks.delete(task);pump();});tasks.add(task);}
  async function enqueue(input,ctx={},restartedFrom){
    aborted(ctx.signal);if(closed)throw Error('Professional models service is closed');
    const jobId='professional_'+crypto.randomUUID().replaceAll('-',''),relative='engineering/professional/'+jobId;
    const config={model:{path:input.main.path,sha256:input.main.sha256,language:input.main.language},sourceFiles:input.sourceFiles.map(({path,sha256})=>({path,sha256})),modelName:input.modelName||null,operation:input.operation,parameters:input.parameters,simulation:input.simulation,signals:input.signals||[],checks:input.checks};
    const job={id:jobId,jobId,projectId:input.projectId,threadId:ctx.threadId||null,runId:ctx.runId||null,status:'queued',createdAt:now(),relative,...config,inputHash:sha(JSON.stringify(config)),sourceFiles:input.sourceFiles.map((source,index)=>({path:source.path,sha256:source.sha256,snapshot:`sources/${index}-${path.basename(source.path)}`})),timeoutMs:input.timeoutMs,...(restartedFrom?{restartedFrom}:{}),artifactHashes:{}};
    await fs.mkdir(safePath(workspace(job.projectId),relative,{write:true}),{recursive:true,mode:0o700});
    for(let i=0;i<input.sourceFiles.length;i++)await artifact(job,job.sourceFiles[i].snapshot,input.sourceFiles[i].content,'text/plain');
    await artifact(job,'input.json',JSON.stringify({schema:'manta-professional-input-v1',...config,inputHash:job.inputHash},null,2),'application/json');
    jobs.set(job.id,job);await persist(job);queue.push(job);queueMicrotask(pump);return publicJob(job);
  }
  const service={
    async catalog({projectId}={}){if(projectId)workspace(projectId);const state=runner?.status?await runner.status():{state:'unavailable',ready:false};return {environment:state,tools:[...Object.entries({openmodelica:['OpenModelica','modelica'],ngspice:['ngspice','spice'],openscad:['OpenSCAD','openscad'],'nos3-stf':['NOS3 STF low-power','nos3-stf']}).map(([id,[name,language]])=>({id,name,language,operations:['read','save','check','simulate'],environment:state.tools?.[id]||(id==='openmodelica'?state:{state:'unavailable',ready:false}),isolation:state.tools?.[id]?.isolation||state.isolation?.kind||'managed-linux-vm'})),{id:'sysml-wasm',name:'SysML v2 semantic kernel',language:'sysml',operations:['read','save','check'],environment:sysmlBackend?.catalog?await sysmlBackend.catalog({projectId}):{available:false},isolation:'no-WASI WebAssembly'}],operations:['listModels','readModel','saveModel','prepare','submit','list','status','result','cancel','restart'],scope:'Native source files and exact-revision numerical execution; project completion is not inferred'};},
    async prepare({projectId}={},ctx={}){workspace(projectId);if(!runner?.prepare)throw Error('Isolated professional runner unavailable');return runner.prepare({signal:ctx.signal,onLog:line=>emit({projectId,runId:ctx.runId,type:'professional.environment.log',message:String(line).slice(0,4000)})});},
    async environmentStatus({projectId}={}){if(projectId)workspace(projectId);return runner?.status?runner.status():{state:'unavailable',ready:false};},
    async listModels({projectId,path:relative='.'}={}){const ws=workspace(projectId),start=safePath(ws,relative),models=[];let scanned=0,truncated=false;async function walk(dir,depth){if(depth>12||scanned>=10000||models.length>=500){truncated=true;return;}for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(++scanned>10000||models.length>=500){truncated=true;return;}if(entry.isSymbolicLink()||entry.name.startsWith('.')||['node_modules','build','data','vendor','.git'].includes(entry.name))continue;const full=path.join(dir,entry.name);if(entry.isDirectory()&&entry.name==='engineering'){const nested=path.join(full,'models');try{const stat=await fs.lstat(nested);if(stat.isDirectory()&&!stat.isSymbolicLink())await walk(nested,depth+1);}catch(error){if(error.code!=='ENOENT')throw error;}continue;}if(entry.isDirectory())await walk(full,depth+1);else if(entry.isFile()&&/(?:\.(?:mo|sysml|cir|scad)|\.stf\.json)$/i.test(entry.name)){const stat=await fs.stat(full);models.push({path:path.relative(ws,full),language:languageOf(entry.name.toLowerCase()),bytes:stat.size,modifiedAt:stat.mtime.toISOString()});}}}if(!(await fs.stat(start)).isDirectory())throw fail('Model listing path must be a directory');await walk(start,0);return {models:models.sort((a,b)=>a.path.localeCompare(b.path)),truncated};},
    readModel,
    async saveModel(args={},ctx={}){if(args.expectedHash!==undefined&&args.expectedHash!==null&&(typeof args.expectedHash!=='string'||!/^[a-f0-9]{64}$/.test(args.expectedHash)))throw fail('Invalid expectedHash: use JSON null (not the string \"null\") for a new file, or the 64-character SHA-256 returned by read_professional_model','INVALID_HASH');const ws=workspace(args.projectId),relative=modelPath(args.path);if(relative.startsWith('engineering/professional/'))throw fail('Recorded execution inputs and evidence cannot be edited; save a new working model');sourceContent(args.content);aborted(ctx.signal);return exclusive(args.projectId+':'+relative,async()=>{
      const target=safePath(ws,relative,{write:true});let previous=null;try{const stat=await fs.stat(target);if(!stat.isFile()||stat.size>MAX_SOURCE)throw fail('Existing model must be a regular file under 2 MB');previous=await fs.readFile(target,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
      if(previous!==null&&(typeof args.expectedHash!=='string'||sha(previous)!==args.expectedHash)||previous===null&&args.expectedHash)throw fail('Model revision conflict: reload before saving','REVISION_CONFLICT');
      await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});safePath(ws,relative,{write:true});
      if(previous!==null){const history=safePath(ws,'.manta/professional-model-history/'+sha(previous)+path.extname(relative),{write:true});await fs.mkdir(path.dirname(history),{recursive:true,mode:0o700});await fs.writeFile(history,previous,{mode:0o600,flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});}
      const temporary=target+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temporary,args.content,{mode:0o600,flag:'wx'});try{safePath(ws,relative,{write:true});let current=null;try{current=await fs.readFile(target,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}if(current!==previous)throw fail('Model changed while saving','REVISION_CONFLICT');aborted(ctx.signal);await fs.rename(temporary,target);}finally{await fs.rm(temporary,{force:true});}
      const model=await readModel({projectId:args.projectId,path:relative});emit({projectId:args.projectId,runId:ctx.runId,type:'professional.model.saved',message:'Native model source saved',data:{path:relative,sha256:model.sha256}});return {...model,saved:true,previousSha256:previous===null?null:sha(previous),validationStatus:'not-checked'};
    });},
    async submit(args={},ctx={}){for(const field of Object.keys(args))if(!SUBMIT_FIELDS.has(field))throw fail(`Unknown professional job field: ${field}; Modelica time settings belong under simulation`);if(typeof args.expectedHash!=='string'||!/^[a-f0-9]{64}$/.test(args.expectedHash))throw fail('expectedHash of the current model is required before submission');const {main,sourceFiles}=await snapshotSources(args),operation=args.operation||'check';if(!['check','simulate'].includes(operation))throw fail('operation must be check or simulate');if(main.language==='c-source')throw fail('Execute C tables through a .stf.json mission manifest with explicit dependencies');if(main.language==='sysml'&&(operation!=='check'||sourceFiles.length!==1))throw fail('SysML supports single-source semantic check; behavior simulation is unavailable');if(main.language==='modelica'&&(typeof args.modelName!=='string'||! /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(args.modelName)||args.modelName.length>300))throw fail('modelName must be a dotted Modelica identifier');if(main.language!=='modelica'&&args.simulation&&Object.keys(args.simulation).length)throw fail('simulation time settings are Modelica-only; this tool uses its native source or fixed recipe');const checks=normalizeChecks(args.checks);return enqueue({projectId:args.projectId,main,sourceFiles,operation,modelName:args.modelName,parameters:normalizeParameters(args.parameters),simulation:main.language==='modelica'?normalizeSimulation(args.simulation):main.language==='nos3-stf'?{mode:'native-recipe',durationSeconds:operation==='simulate'?96:null}:{mode:'native-source'},signals:normalizeSignals(args.signals,main.language,checks),checks,timeoutMs:Math.min(Math.max(Number.isFinite(args.timeoutMs)?args.timeoutMs:maxJobMs,100),maxJobMs)},ctx);},
    async list({projectId}={}){workspace(projectId);return [...jobs.values()].filter(job=>job.projectId===projectId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(publicJob);},
    async status(args){return publicJob(scoped(args));},
    async result(args){const job=scoped(args);if(!TERMINAL.has(job.status))return {jobId:job.id,status:job.status,ready:false};if(!job.resultSha256)return {jobId:job.id,status:job.status,ready:true,executionSucceeded:false,reason:job.reason||'No committed result receipt',integrity:{verified:false,reason:'No committed result receipt'},series:[],table:null,verification:{status:'unknown',checks:[]}};
      let result;try{const bytes=await fs.readFile(safePath(jobDirectory(job),'result.json'));if(sha(bytes)!==job.resultSha256)throw Error('Result receipt integrity mismatch');result=JSON.parse(bytes);for(const [relative,entry]of Object.entries(job.artifactHashes)){if(sha(await fs.readFile(safePath(jobDirectory(job),relative)))!==entry.sha256)throw Error('Artifact integrity mismatch: '+relative);}return {...result,artifacts:clone(job.artifacts),integrity:{verified:true}};}catch(error){return {jobId:job.id,status:job.status,ready:true,executionSucceeded:false,passed:null,reason:error.message,integrity:{verified:false,reason:error.message},series:[],table:null,verification:{status:'unknown',checks:[]},artifacts:clone(job.artifacts||[])};}
    },
    async cancel(args){const job=scoped(args);if(TERMINAL.has(job.status))return publicJob(job);job.cancelRequested=true;if(controllers.has(job.id))controllers.get(job.id).abort();else{job.status='cancelled';job.reason='Cancelled before professional tool execution';job.finishedAt=now();await finish(job,{executionSucceeded:false,reason:job.reason,table:null,series:[]});await persist(job);}return publicJob(job);},
    async restart(args,ctx={}){const previous=scoped(args);if(!TERMINAL.has(previous.status))throw fail('Cancel or finish the existing job before restart');const sourceFiles=[];for(const source of previous.sourceFiles){const content=await fs.readFile(safePath(jobDirectory(previous),source.snapshot),'utf8');if(sha(content)!==source.sha256)throw Error('Pinned source snapshot integrity mismatch');sourceFiles.push({...source,content});}return enqueue({projectId:previous.projectId,main:{...previous.model},sourceFiles,operation:previous.operation,modelName:previous.modelName,parameters:previous.parameters,simulation:previous.simulation,signals:previous.signals||[],checks:previous.checks,timeoutMs:previous.timeoutMs},ctx,previous.id);},
    async wait(args,{signal,timeoutMs=1800000}={}){const job=scoped(args);if(TERMINAL.has(job.status))return {...publicJob(job),result:await service.result(args)};aborted(signal);return new Promise((resolve,reject)=>{const cleanup=()=>{clearTimeout(timer);events.off(job.id,changed);signal?.removeEventListener('abort',abort);};const changed=async next=>{if(TERMINAL.has(next.status)){cleanup();try{resolve({...next,result:await service.result(args)});}catch(error){reject(error);}}};const abort=()=>{cleanup();reject(fail('Cancelled waiting; the professional job continues','CANCELLED'));};const timer=setTimeout(()=>{cleanup();resolve({...publicJob(job),waitTimedOut:true});},Math.min(Math.max(timeoutMs,1),1800000));events.on(job.id,changed);signal?.addEventListener('abort',abort,{once:true});if(TERMINAL.has(job.status))changed(publicJob(job));});},
    async readOutput(args){const job=scoped(args);let file=args.file;if(typeof file==='string'&&file.startsWith(job.relative+'/'))file=file.slice(job.relative.length+1);const entry=job.artifactHashes[file];if(!entry)throw fail('Unknown professional job artifact');const buffer=await fs.readFile(safePath(jobDirectory(job),file));if(sha(buffer)!==entry.sha256)throw Error('Artifact integrity mismatch');return {buffer,contentType:entry.mimeType,sha256:entry.sha256};},
    async close(){closed=true;for(const job of jobs.values())if(!TERMINAL.has(job.status)){job.shutdown=true;if(controllers.has(job.id))controllers.get(job.id).abort();else{job.status='interrupted';job.reason='Manta stopped before execution';job.finishedAt=now();await persist(job);}}await Promise.allSettled([...tasks]);}
  };
  return service;
}
