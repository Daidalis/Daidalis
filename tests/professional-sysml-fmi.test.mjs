// SysML-driven FMI jobs: pinned FMU, analysis verdicts, restart replay.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createStore} from '../server/store.mjs';
import {createProfessionalModelsService} from '../server/professional-models.mjs';

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const SYML_MODEL=[
  'package FMUDecay {',
  ' private import ScalarValues::*;',
  ' private import AnalysisTooling::*;',
  ' calc def Decay {',
  '  metadata ToolExecution { toolName = "fmi"; uri = "file:///opt/fmus/SimpleDecay.fmu"; }',
  '  in stopTime : Real = 1.0 { @ToolVariable { name = "fmi:stopTime"; } }',
  '  return x : Real[1] { @ToolVariable { name = "x"; } }',
  ' }',
  ' analysis def CheckDecay {',
  '  return result : Real = Decay();',
  '  assert constraint { result > 0.30 and result < 0.45 }',
  ' }',
  '}',
  ''
].join('\n');
const FMU_BYTES=Buffer.from('PK\u0003\u0004fake-fmu-archive','binary');
const CSV='time,x\n0,1\n1,0.36751125485715913\n';

function fmiOutput(args,patch={}){
  const bytes=Buffer.from(CSV);
  return {
    exitCode:0,
    success:true,
    tool:{id:'sysml-fmi',version:'v0.12.1/opensysml-0.12.1/fmpy-0.3.32'},
    diagnostics:'',
    receipt:{
      inputHash:args.inputHash,
      sourceHashes:args.sourceFiles.map(({path,sha256})=>({path,sha256})),
      fmu:{path:args.fmuFiles[0].path,sha256:args.fmuFiles[0].sha256,platform:'linux64'}
    },
    files:[{path:'trajectory.csv',contentBase64:bytes.toString('base64'),sha256:hash(bytes),mimeType:'text/csv'}],
    verification:{checks:[{id:'result > 0.30 and result < 0.45',passed:true}]},
    outputKind:'data',
    ...patch
  };
}

async function fmiFixture(t,{run}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-sysml-fmi-'));
  const dataDir=path.join(root,'data');
  const store=createStore({dataDir,seed:false});
  const project=store.createProject({name:'SysML FMI'});
  const calls=[];
  const runner={
    status:async()=>({ready:true,state:'ready',tools:{'sysml-fmi':{ready:true,version:'fixture'}},isolated:true,brokerIsolation:{kind:'rootless-task-container',isolated:true}}),
    prepare:async()=>({ready:true,isolated:true}),
    run:async(args)=>{calls.push(args);return run?run(args):fmiOutput(args);}
  };
  const service=await createProfessionalModelsService({store,dataDir,runner});
  t.after(async()=>{await service.close();await fs.rm(root,{recursive:true,force:true});});
  const workspace=store.workspace(project.id);
  const sysml=await service.saveModel({projectId:project.id,path:'models/FMUDecay.sysml',content:SYML_MODEL});
  await fs.writeFile(path.join(workspace,'models/SimpleDecay.fmu'),FMU_BYTES);
  const args={
    projectId:project.id,
    path:sysml.path,
    expectedHash:sysml.sha256,
    operation:'simulate',
    modelName:'FMUDecay::CheckDecay',
    fmu:{path:'models/SimpleDecay.fmu',expectedHash:hash(FMU_BYTES)}
  };
  const runJob=async extra=>{
    const job=await service.submit({...args,...extra});
    const waited=await service.wait({projectId:project.id,jobId:job.id},{timeoutMs:10000});
    assert.equal(waited.waitTimedOut,undefined);
    return service.result({projectId:project.id,jobId:job.id});
  };
  return {service,projectId:project.id,workspace,calls,args,runJob,sysml,runner};
}

test('a SysML simulate job requires a pinned FMU and refuses one for a semantic check',async t=>{
  const f=await fmiFixture(t);
  await assert.rejects(f.service.submit({...f.args,fmu:undefined}),/requires fmu/);
  await assert.rejects(f.service.submit({...f.args,fmu:{path:'models/SimpleDecay.fmu'}}),/expectedHash/);
  await assert.rejects(f.service.submit({...f.args,fmu:{path:'../evil.fmu',expectedHash:hash(FMU_BYTES)}}),/relative/);
  await assert.rejects(f.service.submit({...f.args,fmu:{path:'models/SimpleDecay.mo',expectedHash:hash(FMU_BYTES)}}),/\.fmu/);
  await assert.rejects(f.service.submit({...f.args,fmu:{path:'models/SimpleDecay.fmu',expectedHash:'f'.repeat(64)}}),/revision conflict/);
  await assert.rejects(f.service.submit({...f.args,operation:'check'}),/takes no FMU/);
  await assert.rejects(f.service.submit({...f.args,sourcePaths:['models/extra.sysml']}),/exactly one SysML source/);
  assert.equal(f.calls.length,0,'no runner call may happen for a rejected submission');
});

test('a SysML FMI job snapshots the FMU, binds it in the receipt and merges the analysis verdicts',async t=>{
  const f=await fmiFixture(t),result=await f.runJob();
  assert.equal(result.status,'completed');
  assert.equal(result.executionSucceeded,true);
  assert.equal(result.passed,true);
  assert.equal(f.calls[0].toolId,'sysml-fmi');
  assert.equal(f.calls[0].fmuFiles[0].sha256,hash(FMU_BYTES));
  assert.deepEqual(f.calls[0].sourceFiles.map(s=>s.path),['models/FMUDecay.sysml']);
  assert.equal(f.calls[0].sourceFiles[0].content,SYML_MODEL);
  assert.equal(Buffer.from(f.calls[0].fmuFiles[0].contentBase64,'base64').toString('binary'),FMU_BYTES.toString('binary'));
  assert.equal(result.verification.checks[0].id,'native:result > 0.30 and result < 0.45');
  assert.equal(result.verification.checks[0].passed,true);
  assert.deepEqual(result.table.columns,['time','x']);
  assert.ok(result.artifacts.some(a=>a.path.endsWith('.fmu')),'the pinned FMU is retained as evidence');
  const receipt=JSON.parse((await f.service.readOutput({projectId:f.projectId,jobId:result.jobId,file:'receipt.json'})).buffer);
  assert.equal(receipt.runnerReceipt.fmu.sha256,hash(FMU_BYTES));
  assert.equal(receipt.runnerReceipt.fmu.platform,'linux64');
});

test('the FMU hash enters inputHash and a changed file is refused before execution',async t=>{
  const f=await fmiFixture(t),first=await f.service.submit(f.args);
  await f.service.cancel({projectId:f.projectId,jobId:first.id});
  const other=Buffer.from('PK\u0003\u0004other','binary');
  await fs.writeFile(path.join(f.workspace,'models/SimpleDecay.fmu'),other);
  await assert.rejects(f.service.submit(f.args),/revision conflict/);
  const changed=await f.service.submit({...f.args,fmu:{path:'models/SimpleDecay.fmu',expectedHash:hash(other)}});
  assert.notEqual(changed.inputHash,first.inputHash,'a different FMU must produce a different pinned input');
  await f.service.cancel({projectId:f.projectId,jobId:changed.id});
});

test('a failing analysis assertion fails the job and is reported as an unmet criterion',async t=>{
  const f=await fmiFixture(t,{run:args=>fmiOutput(args,{
    success:false,
    verification:{checks:[{id:'result > 0.9',passed:false}]},
    diagnostics:'Analysis assertions not satisfied: result > 0.9'
  })});
  const result=await f.runJob();
  assert.equal(result.status,'failed');
  assert.equal(result.passed,false);
  assert.equal(result.verification.status,'failed');
  assert.match(result.diagnostics,/result > 0\.9/);
});

test('a SysML FMI job restarts from its pinned FMU snapshot even after the working file changes',async t=>{
  const f=await fmiFixture(t),job=await f.service.submit(f.args);
  await f.service.wait({projectId:f.projectId,jobId:job.id},{timeoutMs:10000});
  await fs.writeFile(path.join(f.workspace,'models/SimpleDecay.fmu'),Buffer.from('PK\u0003\u0004changed','binary'));
  const restarted=await f.service.restart({projectId:f.projectId,jobId:job.id});
  assert.equal(restarted.inputHash,job.inputHash);
  await f.service.wait({projectId:f.projectId,jobId:restarted.id},{timeoutMs:10000});
  assert.equal(f.calls.at(-1).fmuFiles[0].sha256,hash(FMU_BYTES),'restart must replay the pinned FMU, not the changed file');
});

test('SysML FMI simulations refuse runners that are not the isolated rootless task service',async t=>{
  const f=await fmiFixture(t);
  f.runner.status=async()=>({ready:true,state:'ready',tools:{'sysml-fmi':{ready:true,version:'fixture'}},isolated:false});
  await assert.rejects(f.service.submit(f.args),/require the isolated rootless broker task runner/);
});

test('the catalog advertises the SysML FMI backend alongside the semantic kernel',async t=>{
  const f=await fmiFixture(t),catalog=await f.service.catalog({projectId:f.projectId});
  const entry=catalog.tools.find(tool=>tool.id==='sysml-fmi');
  assert.ok(entry,'sysml-fmi must appear in the tool catalog');
  assert.equal(entry.language,'sysml');
  assert.ok(entry.operations.includes('simulate'));
});
