import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createIntegrationRuntime,submitValidatedNos3Job,bindRecordedNos3Results} from '../server/integration-tools.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const ctx={projectId:'project_fixture',runId:'run_fixture',permissionMode:'auto'};

for(const mode of ['manual','auto'])for(const effect of ['read','write','run'])test(`${mode} MCP ${effect} calls follow the configured project policy`,async()=>{
  const approvals=[],calls=[];
  const runtime=createIntegrationRuntime({store:{},getPermissionMode:()=>mode,requestApproval:async request=>{approvals.push(request);return true;},connectors:{describeTool:async()=>({effect,policyConfigured:true}),call:async(...args)=>{calls.push(args);return {result:{content:[]}};}}});
  await runtime.execute('call_external_tool',{connectorId:'c',toolName:'t',arguments:{}},ctx);
  assert.equal(approvals.length,effect==='read'||mode==='auto'?0:1);assert.equal(calls.length,1);assert.equal(calls[0][4].approved,true);
});
test('an unknown MCP tool effect still asks in Auto and denied tools are never called',async()=>{
  let asked=0,called=0;
  const runtime=createIntegrationRuntime({store:{},getPermissionMode:()=> 'auto',requestApproval:async()=>{asked++;return false;},connectors:{describeTool:async()=>({effect:'write',policyConfigured:false,annotations:{readOnlyHint:true}}),call:async()=>{called++;}}});
  await assert.rejects(runtime.execute('call_external_tool',{connectorId:'c',toolName:'t',arguments:{}},ctx),/rejected/);assert.equal(asked,1);assert.equal(called,0);
});
test('MCP execution errors are preserved as failed public tool evidence',async()=>{
  const runtime=createIntegrationRuntime({store:{},getPermissionMode:()=> 'auto',requestApproval:async()=>true,connectors:{describeTool:async()=>({effect:'read',policyConfigured:true}),call:async()=>({result:{isError:true,content:[{type:'text',text:'Actual failure'}]}})}});
  const result=await runtime.execute('call_external_tool',{connectorId:'c',toolName:'t',arguments:{}},ctx);assert.match(result.error,/execution error/);assert.equal(result.result.isError,true);
});
test('model-bound jobs require real semantic acceptance, exact revision and diagnostic evidence',async()=>{
  const calls=[],modelHash='a'.repeat(64),receiptHash='b'.repeat(64);
  const nos3={submit:async(input,context)=>{calls.push({input,context});return {status:'queued'};}};
  const modelBackend={validate:async input=>{assert.equal(input.expectedHash,modelHash);return {valid:true,model:{sha256:modelHash},evidence:{path:'.manta/check.json',sha256:receiptHash}};}};
  await assert.rejects(submitValidatedNos3Job({nos3,modelBackend},{...ctx,scope:'component',modelFile:'model.sysml'}),/expectedModelHash/);
  assert.equal(calls.length,0);
  await submitValidatedNos3Job({nos3,modelBackend},{...ctx,scope:'component',modelFile:'model.sysml',expectedModelHash:modelHash},ctx);
  assert.deepEqual(calls[0].input.modelEvidence,[{path:'.manta/check.json',sha256:receiptHash}]);
  await assert.rejects(submitValidatedNos3Job({nos3,modelBackend:{validate:async()=>({valid:false,model:{sha256:modelHash}})}},{...ctx,modelFile:'model.sysml',expectedModelHash:modelHash}),/semantic gate/);
  assert.equal(calls.length,1);
});
test('result handoff refuses edited measurements and unrelated model revisions',async t=>{
  const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'manta-result-integrity-'));t.after(()=>fs.rm(workspace,{recursive:true,force:true}));
  const modelHash='c'.repeat(64),body=JSON.stringify({metrics:{compositionMaxError:0}});await fs.writeFile(path.join(workspace,'result.json'),body);
  const report={ready:true,status:'completed',scope:'component',metrics:{compositionMaxError:0},modelEvidence:[{path:'model.sysml',sha256:modelHash}],resultPath:'result.json',resultSha256:hash(body)};
  let bound=0;const services={nos3:{result:async()=>report},store:{workspace:()=>workspace},modelBackend:{bindNos3Results:async args=>{bound++;return args;}}};
  const input={...ctx,jobId:'job',path:'model.sysml',expectedHash:modelHash};assert.equal((await bindRecordedNos3Results(services,input)).resultPath,'result.json');assert.equal(bound,1);
  await assert.rejects(bindRecordedNos3Results(services,{...input,expectedHash:'d'.repeat(64)}),/exact revision/);
  await fs.writeFile(path.join(workspace,'result.json'),JSON.stringify({metrics:{compositionMaxError:999}}));
  await assert.rejects(bindRecordedNos3Results(services,input),/evidence changed/);assert.equal(bound,1);
});
