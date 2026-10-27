import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createEngineeringService,validateParameters} from '../server/engineering.mjs';
import {createStore} from '../server/store.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('engineering inputs reject nonnumeric values, unknown keys and contradictory boundaries',()=>{
  assert.equal(validateParameters({heaterMax:10}).heaterMax,10);
  for(const input of [{heaterMax:'10'},{heaterMax:NaN},{heaterMax:Infinity},{heaterMax:-1},{code:'print(1)'},{duration:120,disturbanceTime:120},{minTemperature:40,maxTemperature:30}])assert.throws(()=>validateParameters(input));
});

test('real SciPy execution, independent checks, project queue and scoped evidence', {timeout:120000},async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'mbse-engineering-'));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const store=createStore({dataDir:path.join(temp,'data'),seed:false});
  const project=store.createProject({name:'Engineering integration test'});
  const other=store.createProject({name:'Unrelated project'});
  const events=[];
  const service=await createEngineeringService({root,dataDir:path.join(temp,'service'),store,emit:e=>events.push(e)});
  const catalog=await service.catalog({recheck:true});
  const runtime=catalog.tools.find(x=>x.id==='scipy');
  if(!runtime.available){t.skip('Numerical runtime not ready ('+runtime.reasonCode+'): '+runtime.detail);return;}
  assert.equal(catalog.models[0].scope,'declared-model-numerical-analysis');
  assert.equal(catalog.tools.find(x=>x.id==='sysml-v2').available,false);
  const first=service.run({projectId:project.id,parameters:{heaterMax:30,ambientAfter:-20},scan:{parameter:'heaterMax',values:[0,10,30]}},{threadId:project.coordinatorThreadId,runId:'engineering-test-a'});
  const second=service.run({projectId:project.id,parameters:{heaterMax:10,ambientAfter:-20}},{threadId:project.coordinatorThreadId,runId:'engineering-test-b'});
  const abort=new AbortController();
  const cancelled=service.run({projectId:project.id,parameters:{heaterMax:25}},{signal:abort.signal}).then(()=>({ok:true}),error=>({error:error.message}));
  abort.abort();
  const [a,b,c]=await Promise.all([first,second,cancelled]);
  assert.match(c.error,/Cancelled/);
  assert.notEqual(a.id,b.id);
  assert.equal(a.status,'completed');
  assert.equal(a.scope,'declared-model-numerical-analysis');
  assert.equal(a.hardwareValidation,false);
  assert.equal(a.upstreamReproduction,false);
  assert.equal(a.constraintStatus,'violations-found','violating scan must prevent overall satisfaction');
  assert.equal(a.passed,true,'30 W nominal is feasible in the tested interval');
  assert.equal(b.passed,false,'10 W must expose the cold-boundary thermal deficit');
  assert.equal(a.scenarios.find(x=>x.value===0).passed,false);
  assert.equal(a.scenarios.find(x=>x.value===30).passed,true);
  assert.ok(a.metrics.energyBalanceRelativeError<0.005);
  assert.ok(a.metrics.analyticOracleErrorK<1e-5);
  assert.equal(a.series.time.length,a.series.payload.length);
  assert.ok(a.series.time.length>1000);
  assert.ok(events.some(x=>x.type==='engineering.queued'));
  assert.ok(events.filter(x=>x.type==='engineering.started').length===2,'cancelled queued task must never start');
  assert.equal(store.data.artifacts.filter(x=>x.runId==='engineering-test-a').length,8);
  assert.equal(store.data.artifacts.filter(x=>x.runId==='engineering-test-b').length,8);
  assert.equal((await service.getRun(a.id,{projectId:project.id})).id,a.id);
  await assert.rejects(service.getRun(a.id,{projectId:other.id}),/不属于当前项目/);
  await assert.rejects(service.getRun(a.id,{}),/不属于当前项目/);
  await assert.rejects(service.readOutput(a.id,'../state.json',{projectId:project.id}),/未知输出文件/);
  await assert.rejects(service.readOutput(a.id,'model.py',{projectId:other.id}),/不属于当前项目/);
  const svg=await service.readOutput(a.id,'temperature.svg',{projectId:project.id});
  assert.equal(svg.contentType,'image/svg+xml');
  assert.match(svg.buffer.toString(),/<svg/);
  const manifest=JSON.parse((await service.readOutput(a.id,'manifest.json',{projectId:project.id})).buffer);
  for(const entry of manifest.files){
    const output=await service.readOutput(a.id,entry.file,{projectId:project.id});
    assert.equal(crypto.createHash('sha256').update(output.buffer).digest('hex'),entry.sha256);
  }
  const reopened=await createEngineeringService({root,dataDir:path.join(temp,'service'),store});
  assert.equal((await reopened.getRun(a.id,{projectId:project.id})).id,a.id,'evidence must survive service restart');
  await assert.rejects(service.run({projectId:project.id,modelFile:'../../state.json'}),/outside|escape|Unsafe|Invalid|outside workspace/i);
  const malicious=path.join(store.workspace(project.id),'bad-model.json');
  await fs.writeFile(malicious,JSON.stringify({schema:'mbse-thermal-model-v1',model:'arbitrary-python',parameters:{}}));
  await assert.rejects(service.run({projectId:project.id,modelFile:'bad-model.json'}),/不执行候选代码/);
});
