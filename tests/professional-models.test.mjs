import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createStore} from '../server/store.mjs';
import {createProfessionalModelsService,parseProfessionalCsv} from '../server/professional-models.mjs';
import {PROFESSIONAL_TOOL_DEFINITIONS} from '../server/professional-tools.mjs';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const MODEL='model Thermal\n parameter Real heater=10;\n Real temperature(start=290);\nequation der(temperature)=heater/100;\nend Thermal;\n';
const CSV='"time","temperature","heater"\n0,290,10\n1,290.1,10\n2,290.2,10\n';
function output(args,patch={}){const bytes=Buffer.from(CSV);return {exitCode:0,success:true,tool:{id:'openmodelica',name:'OpenModelica test fixture',version:'fixture-1'},diagnostics:'fixture execution',receipt:{inputHash:args.inputHash,sourceHashes:args.sourceFiles.map(({path,sha256})=>({path,sha256}))},files:args.operation==='check'?[]:[{path:'Thermal_res.csv',contentBase64:bytes.toString('base64'),sha256:hash(bytes),mimeType:'text/csv'}],...patch};}
async function fixture(t,{run,sysmlBackend,maxJobMs}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-professional-test-')),dataDir=path.join(root,'data'),store=createStore({dataDir,seed:false}),project=store.createProject({name:'Native models'}),ws=store.workspace(project.id);
 const calls=[],runner={status:async()=>({ready:true,state:'ready'}),prepare:async()=>({ready:true,isolated:true}),run:async(args,ctx)=>{calls.push(args);return run?run(args,ctx):output(args);}};
 const state={root,dataDir,store,projectId:project.id,workspace:ws,runner,calls};state.service=await createProfessionalModelsService({store,dataDir,runner,sysmlBackend,maxJobMs});
 t.after(async()=>{await state.service.close();await fs.rm(root,{recursive:true,force:true});});
 state.model=await state.service.saveModel({projectId:project.id,path:'models/Thermal.mo',content:MODEL});
 state.args={projectId:project.id,path:state.model.path,expectedHash:state.model.sha256,operation:'simulate',modelName:'Thermal'};
 state.run=async extra=>{const job=await state.service.submit({...state.args,...extra});const waited=await state.service.wait({projectId:state.projectId,jobId:job.id},{timeoutMs:10000});assert.equal(waited.waitTimedOut,undefined);return state.service.result({projectId:state.projectId,jobId:job.id});};return state;
}

test('native Modelica drafts save, reopen, list and preserve a prior revision without claiming validation',async t=>{
 const f=await fixture(t),saved=await f.service.saveModel({projectId:f.projectId,path:f.model.path,expectedHash:f.model.sha256,content:MODEL+'// design change\n'});
 assert.equal(saved.saved,true);assert.equal(saved.validationStatus,'not-checked');assert.equal(saved.previousSha256,hash(MODEL));assert.equal((await f.service.readModel({projectId:f.projectId,path:f.model.path})).content,MODEL+'// design change\n');
 assert.equal(await fs.readFile(path.join(f.workspace,'.manta/professional-model-history/'+hash(MODEL)+'.mo'),'utf8'),MODEL);assert.equal((await f.service.listModels({projectId:f.projectId})).models.length,1);
});

test('optimistic source guards prevent lost updates and missing submission hashes',async t=>{
 const f=await fixture(t);await assert.rejects(f.service.saveModel({projectId:f.projectId,path:f.model.path,content:MODEL+'a'}),/revision conflict/);
 const outcomes=await Promise.allSettled(['a','b'].map(s=>f.service.saveModel({projectId:f.projectId,path:f.model.path,expectedHash:f.model.sha256,content:MODEL+s})));assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 await assert.rejects(f.service.submit({...f.args,expectedHash:undefined}),/expectedHash/);await assert.rejects(f.service.submit(f.args),/revision conflict/);
});

test('model paths, dependencies and result reads cannot traverse project or symbolic links',async t=>{
 const f=await fixture(t);await fs.symlink(f.root,path.join(f.workspace,'outside'));
 for(const relative of ['../evil.mo','/tmp/evil.mo','.ssh/config.mo','outside/evil.mo'])await assert.rejects(f.service.saveModel({projectId:f.projectId,path:relative,content:MODEL}),/relative|Symbolic|hidden/);
 await assert.rejects(f.service.submit({...f.args,sourcePaths:['../stolen.mo']}),/relative/);
 const result=await f.run();await assert.rejects(f.service.readOutput({projectId:f.projectId,jobId:result.jobId,file:'../../state.json'}),/Unknown/);
});

test('native job snapshots exact sources and numeric configuration; successful solve alone never means requirements pass',async t=>{
 const f=await fixture(t),result=await f.run({parameters:{heater:20},simulation:{stopTime:2,numberOfIntervals:2}});
 assert.equal(result.status,'completed');assert.equal(result.executionSucceeded,true);assert.equal(result.passed,null);assert.equal(result.verification.status,'not-requested');assert.equal(result.model.sha256,hash(MODEL));assert.equal(result.integrity.verified,true);
 assert.equal(f.calls[0].sourceFiles[0].content,MODEL);assert.equal(f.calls[0].parameters.heater,20);assert.deepEqual(result.table.columns,['time','temperature','heater']);assert.equal(result.series[0].unit,null);assert.deepEqual(result.series[0].points,[[0,290],[1,290.1],[2,290.2]]);
 const receipt=JSON.parse((await f.service.readOutput({projectId:f.projectId,jobId:result.jobId,file:'receipt.json'})).buffer);assert.equal(receipt.runnerReceipt.inputHash,result.inputHash);assert.equal(receipt.sourceFiles[0].sha256,hash(MODEL));assert.match(receipt.scope,/no physical/);
});

test('source package dependencies are explicit, snapshotted and receipt-bound',async t=>{
 const f=await fixture(t);const dep=await f.service.saveModel({projectId:f.projectId,path:'models/Library.mo',content:'package Library end Library;'}),result=await f.run({sourcePaths:[dep.path]});
 assert.equal(result.sourceFiles.length,2);assert.equal(f.calls[0].sourceFiles[1].sha256,dep.sha256);assert.ok(result.artifacts.some(a=>a.path.endsWith('sources/1-Library.mo')));
});

test('verification uses actual full numeric output and retains negative and unknown findings',async t=>{
 const f=await fixture(t),result=await f.run({checks:[{id:'thermal-upper',requirementId:'REQ-T',variable:'temperature',metric:'max',operator:'<=',expected:290.15},{id:'thermal-final',variable:'temperature',metric:'final',operator:'==',expected:290.2,tolerance:1e-8},{id:'missing',variable:'nonexistent',metric:'mean',operator:'>=',expected:0}]});
 assert.equal(result.status,'completed');assert.equal(result.executionSucceeded,true);assert.equal(result.passed,false);assert.equal(result.verification.status,'failed');assert.equal(result.verification.checks[0].actual,290.2);assert.equal(result.verification.checks[0].passed,false);assert.equal(result.verification.checks[1].passed,true);assert.equal(result.verification.checks[2].passed,null);
});

test('initial criterion checks the first recorded sample and remains bound to the replayed job input',async t=>{
 const csv='time,science\n0,1\n1,0\n2,0\n',f=await fixture(t,{run:async args=>output(args,{files:[{path:'Thermal_res.csv',contentBase64:Buffer.from(csv).toString('base64')}]})});
 const checks=[{id:'science-off-at-start',requirementId:'REQ-START',variable:'science',metric:'initial',operator:'==',expected:0},{id:'science-off-at-end',variable:'science',metric:'final',operator:'==',expected:0}];
 const result=await f.run({checks});
 assert.equal(PROFESSIONAL_TOOL_DEFINITIONS.find(tool=>tool.name==='submit_professional_job').parameters.properties.checks.items.properties.metric.enum.includes('initial'),true);
 assert.equal(result.executionSucceeded,true);assert.equal(result.passed,false);assert.equal(result.verification.status,'failed');
 assert.deepEqual(result.verification.checks.map(({id,actual,passed,samples})=>({id,actual,passed,samples})),[
  {id:'science-off-at-start',actual:1,passed:false,samples:1},{id:'science-off-at-end',actual:0,passed:true,samples:3}
 ]);
 const input=JSON.parse((await f.service.readOutput({projectId:f.projectId,jobId:result.jobId,file:'input.json'})).buffer);
 assert.deepEqual(input.checks,checks);assert.equal(input.inputHash,result.inputHash);assert.equal(result.receipt.inputHash,result.inputHash);
 const replay=await f.service.restart({projectId:f.projectId,jobId:result.jobId});await f.service.wait({projectId:f.projectId,jobId:replay.id});
 const replayed=await f.service.result({projectId:f.projectId,jobId:replay.id});assert.equal(replayed.inputHash,result.inputHash);assert.deepEqual(replayed.verification.checks,result.verification.checks);
});

test('initial criterion is unknown when its first sample is missing, regardless of later valid values',async t=>{
 const csv='time,science\n0,NaN\n1,0\n',f=await fixture(t,{run:async args=>output(args,{files:[{path:'Thermal_res.csv',contentBase64:Buffer.from(csv).toString('base64')}]})});
 const result=await f.run({checks:[{id:'science-off-at-start',variable:'science',metric:'initial',operator:'==',expected:0}]});
 assert.equal(result.verification.status,'unknown');assert.equal(result.passed,null);assert.equal(result.verification.checks[0].actual,null);
});

test('Modelica initial criterion cannot pass when the first sample omits the requested start time',async t=>{
 const csv='time,science\n1,0\n2,0\n',f=await fixture(t,{run:async args=>output(args,{files:[{path:'Thermal_res.csv',contentBase64:Buffer.from(csv).toString('base64')}]})});
 const result=await f.run({simulation:{startTime:0,stopTime:2,numberOfIntervals:2},checks:[{id:'science-off-at-zero',variable:'science',metric:'initial',operator:'==',expected:0}]});
 assert.equal(result.executionSucceeded,true);assert.equal(result.verification.status,'unknown');assert.equal(result.passed,null);
 assert.match(result.verification.checks[0].reason,/startTime/);assert.equal(result.receipt.simulation.startTime,0);
});

test('actual compiler failures keep diagnostics and never render success',async t=>{
 const f=await fixture(t,{run:async args=>output(args,{exitCode:1,success:false,diagnostics:'Error: unknown class Sensor',files:[]})}),result=await f.run();
 assert.equal(result.status,'failed');assert.equal(result.executionSucceeded,false);assert.equal(result.passed,false);assert.match(result.diagnostics,/unknown class/);assert.equal(result.integrity.verified,true);assert.equal(result.series.length,0);
});

test('exit zero without a solver CSV, incorrect hashes or wrong receipt is rejected',async t=>{
 for(const kind of ['no-csv','wrong-input','wrong-source','wrong-output']){
  const f=await fixture(t,{run:async args=>{const result=output(args);if(kind==='no-csv')result.files=[];if(kind==='wrong-input')result.receipt.inputHash='0'.repeat(64);if(kind==='wrong-source')result.receipt.sourceHashes[0].sha256='0'.repeat(64);if(kind==='wrong-output')result.files[0].sha256='0'.repeat(64);return result;}}),result=await f.run();
  assert.equal(result.status,'failed',kind);assert.equal(result.executionSucceeded,false,kind);assert.equal(result.passed,false,kind);
 }
});

test('check-only operations do not demand simulation artifacts or imply a simulation ran',async t=>{
 const f=await fixture(t),result=await f.run({operation:'check'});assert.equal(result.status,'completed');assert.equal(result.operation,'check');assert.equal(result.table,null);assert.equal(result.series.length,0);assert.equal(result.passed,null);
});

test('a committed result is readable after restart, but tampered result or source bytes revoke displayed evidence',async t=>{
 const f=await fixture(t),result=await f.run();await f.service.close();f.service=await createProfessionalModelsService({store:f.store,dataDir:f.dataDir,runner:f.runner});
 assert.equal((await f.service.result({projectId:f.projectId,jobId:result.jobId})).integrity.verified,true);
 const source=result.artifacts.find(a=>a.path.includes('/sources/'));await fs.writeFile(path.join(f.workspace,source.path),'tampered');const rejected=await f.service.result({projectId:f.projectId,jobId:result.jobId});assert.equal(rejected.integrity.verified,false);assert.deepEqual(rejected.series,[]);assert.equal(rejected.passed,null);assert.equal(rejected.verification.status,'unknown');
});

test('restart explicitly reuses pinned sources even if the working model changed',async t=>{
 const f=await fixture(t),result=await f.run();await f.service.saveModel({projectId:f.projectId,path:f.model.path,expectedHash:f.model.sha256,content:MODEL+'// working source advanced'});
 const restarted=await f.service.restart({projectId:f.projectId,jobId:result.jobId});await f.service.wait({projectId:f.projectId,jobId:restarted.id});const next=await f.service.result({projectId:f.projectId,jobId:restarted.id});assert.equal(next.model.sha256,hash(MODEL));assert.equal(f.calls[1].sourceFiles[0].content,MODEL);assert.equal(next.inputHash,result.inputHash);assert.notEqual(next.jobId,result.jobId);assert.equal(restarted.restartedFrom,result.jobId);
});

test('cancel propagates to isolated runner and queued jobs do not execute',async t=>{
 let entered;const started=new Promise(resolve=>entered=resolve);
 const f=await fixture(t,{run:async(args,{signal})=>{entered();await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('isolated job cancelled')),{once:true});});}});
 const running=await f.service.submit(f.args);await started;const queued=await f.service.submit(f.args);await f.service.cancel({projectId:f.projectId,jobId:queued.id});await f.service.cancel({projectId:f.projectId,jobId:running.id});
 const done=await f.service.wait({projectId:f.projectId,jobId:running.id});assert.equal(done.status,'cancelled');assert.equal((await f.service.status({projectId:f.projectId,jobId:queued.id})).status,'cancelled');assert.equal(f.calls.length,1);
});

test('graceful stop records interrupted work and never automatically replays it on new service',async t=>{
 let entered;const started=new Promise(resolve=>entered=resolve);const f=await fixture(t,{run:async(args,{signal})=>{entered();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('stop')),{once:true}));}});
 const job=await f.service.submit(f.args);await started;await f.service.close();f.service=await createProfessionalModelsService({store:f.store,dataDir:f.dataDir,runner:f.runner});assert.equal((await f.service.status({projectId:f.projectId,jobId:job.id})).status,'interrupted');assert.equal(f.calls.length,1);
});

test('SysML native drafts use existing semantic backend with exact revision guard and no Modelica behavior claim',async t=>{
 const calls=[],f=await fixture(t,{sysmlBackend:{validate:async(args)=>{calls.push(args);return {valid:true,findings:[],backend:{id:'sysml-wasm',version:'0.10.10'}};}}}),model=await f.service.saveModel({projectId:f.projectId,path:'models/system.sysml',content:'package Satellite {}'});
 const result=await f.run({path:model.path,expectedHash:model.sha256,operation:'check',modelName:undefined});assert.equal(result.status,'completed');assert.equal(calls[0].expectedHash,model.sha256);assert.match(calls[0].path,/engineering\/professional\/professional_[a-f0-9]+\/sources\/0-system.sysml$/);assert.equal(result.tool.id,'sysml-wasm');await assert.rejects(f.service.submit({...f.args,path:model.path,expectedHash:model.sha256,operation:'simulate'}),/behavior simulation is unavailable/);
});

test('parameters and criteria reject model command injection and unsupported settings before runner',async t=>{
 const f=await fixture(t);
 for(const changed of [{modelName:'Thermal);system("touch /tmp/x")'},{parameters:{heater:'10; quit()'}},{parameters:{'a[1]':2}},{simulation:{stopTime:0}},{simulation:{numberOfIntervals:1e9}},{checks:[{id:'x',variable:'t',metric:'invented',operator:'<=',expected:10}]}])await assert.rejects(f.service.submit({...f.args,...changed}));assert.equal(f.calls.length,0);
});

test('CSV parser preserves finite samples, missing values and quoted variable names, rejecting malformed data',()=>{
 assert.deepEqual(parseProfessionalCsv('\uFEFF"time","component.a[1]"\r\n0,2\r\n1,NaN\r\n2,\r\n').rows,[[0,2],[1,null],[2,null]]);
 assert.deepEqual(parseProfessionalCsv('"a""b",time\n3,0\n').columns,['a"b','time']);
 for(const text of ['time,time\n0,1','time,x\n0','"time,x\n','time,"x"oops\n0,1'])assert.throws(()=>parseProfessionalCsv(text));
});

// Missing samples cannot be discarded to manufacture a passing final/min/max criterion.
test('missing or nonfinite samples preserve unknown verification',async t=>{
 for(const csv of ['time,temperature\n0,290\n1,\n','time,temperature\n0,NaN\n1,290\n']){
 const f=await fixture(t,{run:async args=>output(args,{files:[{path:'Thermal_res.csv',contentBase64:Buffer.from(csv).toString('base64')}]})});
 const result=await f.run({checks:[{id:'finite-final',variable:'temperature',metric:'final',operator:'<=',expected:300}]});assert.equal(result.executionSucceeded,true);assert.equal(result.verification.status,'unknown');assert.equal(result.passed,null);assert.equal(result.verification.checks[0].actual,null);
 }
});
test('explicit Modelica output signals include criterion variables, bind input hashes and replay unchanged',async t=>{
 const f=await fixture(t),checks=[{id:'guard',variable:'temperature',metric:'max',operator:'<=',expected:300}];
 const result=await f.run({signals:['x[1,2].a','heater','heater'],checks});assert.deepEqual(f.calls[0].signals,['heater','temperature','x[1,2].a']);assert.deepEqual(result.receipt.signals,f.calls[0].signals);
 const restarted=await f.service.restart({projectId:f.projectId,jobId:result.jobId});await f.service.wait({projectId:f.projectId,jobId:restarted.id});assert.deepEqual(f.calls[1].signals,f.calls[0].signals);assert.equal(restarted.inputHash,result.inputHash);
 for(const signals of [['.*'],['x);system(1)'],Array(101).fill('x')])await assert.rejects(f.service.submit({...f.args,signals}),/signal|output names/i);
 for(const simulation of [{numberOfIntervals:1},{numberOfIntervals:20001},{tolerance:1e-13},{tolerance:.2},{stopTime:31536001}])await assert.rejects(f.service.submit({...f.args,simulation}));
});
test('recorded execution sources are immutable through the editor',async t=>{const f=await fixture(t),result=await f.run(),source=result.artifacts.find(a=>a.path.includes('/sources/'));await assert.rejects(f.service.saveModel({projectId:f.projectId,path:source.path,expectedHash:hash(MODEL),content:MODEL+'// overwrite'}),/cannot be edited/);});

test('native integrated telemetry criteria remain distinct from software execution success',async t=>{const f=await fixture(t,{run:async args=>output(args,{verification:{status:'failed',checks:[{id:'safe-all-off',criterion:'Every native switch off',passed:false,actual:{mode:3,switch7:170}}]}})}),result=await f.run();assert.equal(result.status,'completed');assert.equal(result.executionSucceeded,true);assert.equal(result.passed,false);assert.equal(result.verification.status,'failed');assert.equal(result.verification.checks[0].id,'native:safe-all-off');assert.equal(result.verification.checks[0].actual.switch7,170);});

test('non-Modelica jobs bind source-defined settings and reject unapplied time requests',async t=>{const f=await fixture(t),model=await f.service.saveModel({projectId:f.projectId,path:'models/EPS.cir',content:'* Circuit\nV1 n 0 1\n.end\n'});const a={...f.args,path:model.path,expectedHash:model.sha256};await assert.rejects(f.service.submit({...a,simulation:{stopTime:10}}),/Modelica-only/);const job=await f.service.submit(a);await f.service.wait({projectId:f.projectId,jobId:job.id});assert.deepEqual(f.calls[0].simulation,{mode:'native-source'});});


test('native working models under engineering/models are indexed without treating immutable solver snapshots as editable models',async t=>{
 const f=await fixture(t);
 await f.service.saveModel({projectId:f.projectId,path:'engineering/models/STFDelivery.mo',content:MODEL});
 await fs.mkdir(path.join(f.workspace,'engineering/professional/professional_example/sources'),{recursive:true});
 await fs.writeFile(path.join(f.workspace,'engineering/professional/professional_example/sources/Old.mo'),MODEL);
 const indexed=(await f.service.listModels({projectId:f.projectId})).models;
 assert.ok(indexed.some(m=>m.path==='engineering/models/STFDelivery.mo'));
 assert.ok(!indexed.some(m=>m.path.includes('/professional/')));
 assert.ok(indexed.some(m=>m.path==='models/Thermal.mo'));
});

test('new model rejects a string null with actionable diagnostics and accepts JSON null',async t=>{
 const f=await fixture(t),args={projectId:f.projectId,path:'models/New.mo',content:'model New Real x=1; end New;'};
 await assert.rejects(f.service.saveModel({...args,expectedHash:'null'}),/JSON null/);
 await assert.rejects(fs.access(path.join(f.workspace,args.path)));
 const saved=await f.service.saveModel({...args,expectedHash:null});assert.equal(saved.saved,true);
 await assert.rejects(f.service.saveModel({...args,expectedHash:null}),/revision conflict/);
});
