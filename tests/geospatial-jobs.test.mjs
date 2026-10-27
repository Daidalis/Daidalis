import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createStore} from '../server/store.mjs';
import {createGeospatialJobsService} from '../server/geospatial-jobs.mjs';
import {GEOSPATIAL_TOOL_DEFINITIONS} from '../server/geospatial-tools.mjs';
import {createToolRuntime} from '../server/tools.mjs';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const SOURCE=Buffer.from('PK\x03\x04dummy-fixture-not-a-real-archive');
const GEOJSON=Buffer.from(JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{role:'control-point'},geometry:{type:'Point',coordinates:[-76,39]}}]}));
const CSV=Buffer.from('id,actual,expected,passed\ninside,inside,inside,true\n');
function file(path,bytes){return {path,sha256:hash(bytes),contentBase64:bytes.toString('base64')};}
function output(args){return {schema:'manta-geospatial-runner-result-v1',exitCode:0,success:true,receipt:{inputHash:args.inputHash,sourceSha256:args.sourceHash,sourceEpsgExpected:args.expectedSourceEpsg},tool:{id:'gdal-proj',version:'fixture'},toolchain:{packages:{'python3-gdal':'fixture'},binaryHashes:{ogrinfo:{sha256:hash('ogrinfo')}}},verification:{status:'passed',checks:[{id:'inside',actual:'inside',expected:'inside',passed:true}]},files:[file('preview.geojson',GEOJSON),file('checks.csv',CSV)]};}
async function fixture(t,{run}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-gis-test-')),dataDir=path.join(root,'data');
  const store=createStore({dataDir,seed:false}),project=store.createProject({name:'GIS unit test'}),workspace=store.workspace(project.id);
  await fs.writeFile(path.join(workspace,'source.zip'),SOURCE);
  const calls=[],runner={status:async()=>({ready:true,versions:{gdal:'fixture'}}),prepare:async()=>({ready:true}),run:async(args,ctx)=>{calls.push(args);return run?run(args,ctx):output(args);}};
  const service=await createGeospatialJobsService({dataDir,store,runner});
  t.after(async()=>{await service.close();await fs.rm(root,{recursive:true,force:true});});
  const args={projectId:project.id,path:'source.zip',expectedHash:hash(SOURCE),expectedSourceEpsg:4269,points:[{id:'inside',lon:-76,lat:39,featureId:'24',expected:'inside'}]};
  return {root,dataDir,store,project,workspace,service,args,calls};
}
async function run(f,extra={}){const job=await f.service.submit({...f.args,...extra});const done=await f.service.wait({projectId:f.project.id,jobId:job.id},{timeoutMs:5000});assert.equal(done.waitTimedOut,undefined);return f.service.result({projectId:f.project.id,jobId:job.id});}
test('project ZIP is hash-guarded, controls are bounded and projected CRS is explicitly unsupported',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.service.submit({...f.args,expectedHash:hash('different')}),/SHA-256 mismatch/);
  await assert.rejects(f.service.submit({...f.args,expectedSourceEpsg:3857}),/only geographic/);
  await assert.rejects(f.service.submit({...f.args,points:[{id:'projected',lon:200000,lat:5000000,crs:'EPSG:4269'}]}),/geographic longitude/);
  await assert.rejects(f.service.submit({...f.args,path:'../source.zip'}),/project-relative/);
  await assert.rejects(f.service.submit({...f.args,points:[{id:'x',lon:-76,lat:39,crs:'EPSG:3857'}]}),/WGS84/);
  assert.equal(f.calls.length,0);
  assert.deepEqual(GEOSPATIAL_TOOL_DEFINITIONS.find(t=>t.name==='submit_geospatial_job').parameters.properties.expectedSourceEpsg.enum,[4269,4326]);
});
test('durable job binds source hash and receipts, registers artifacts, and detects tampering before display',async t=>{
  const f=await fixture(t),result=await run(f);
  assert.equal(result.status,'completed');assert.equal(result.passed,true);assert.equal(result.integrity.verified,true);
  assert.equal(result.source.sha256,hash(SOURCE));assert.equal(result.receipt.runnerReceipt.inputHash,result.inputHash);
  assert.equal(result.receipt.toolchain.binaryHashes.ogrinfo.sha256,hash('ogrinfo'));
  assert.equal(f.calls.length,1);assert.equal(hash(f.calls[0].sourceBytes),hash(SOURCE));
  assert.ok(result.artifacts.some(a=>a.path===`engineering/geospatial/${result.jobId}/outputs/preview.geojson`));
  assert.ok(f.store.data.artifacts.some(a=>a.path===result.resultPath));
  const reloaded=await createGeospatialJobsService({dataDir:f.dataDir,store:f.store,runner:f.service.runner||{run:async()=>{throw Error('unused')}}});
  assert.equal((await reloaded.result({projectId:f.project.id,jobId:result.jobId})).integrity.verified,true);
  await reloaded.close();
  await fs.appendFile(path.join(f.workspace,result.artifacts.find(a=>a.path.endsWith('preview.geojson')).path),' ');
  assert.equal((await f.service.result({projectId:f.project.id,jobId:result.jobId})).integrity.verified,false);
  await assert.rejects(f.service.readOutput({projectId:f.project.id,jobId:result.jobId,file:'outputs/preview.geojson'}),/integrity mismatch/);
});
test('malformed-archive runner failure is recorded as failed with diagnostics and no preview',async t=>{
  const f=await fixture(t,{run:async()=>({schema:'manta-geospatial-runner-result-v1',exitCode:2,success:false,reason:'Shapefile ZIP has no members',diagnostics:'Shapefile ZIP has no members',files:[]})});
  const result=await run(f);assert.equal(result.status,'failed');assert.equal(result.integrity.verified,true);assert.equal(result.executionSucceeded,false);assert.match(result.diagnostics,/no members/);assert.equal(result.artifacts.some(a=>a.path.endsWith('preview.geojson')),false);
});
test('incomplete successful worker output is rejected before any preview is published',async t=>{
  const f=await fixture(t,{run:async args=>({...output(args),files:[file('preview.geojson',GEOJSON)]})});
  const result=await run(f);
  assert.equal(result.status,'failed');assert.equal(result.executionSucceeded,false);
  assert.match(result.diagnostics,/one preview and one check table/);
  assert.equal(result.artifacts.some(a=>a.path.endsWith('preview.geojson')),false);
});
test('cancel aborts active GIS worker and leaves a terminal unverified outcome',async t=>{
  let started;const begun=new Promise(resolve=>started=resolve);
  const f=await fixture(t,{run:async(_args,{signal})=>{started();await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason||Error('cancelled')),{once:true}));}});
  const queued=await f.service.submit(f.args);await begun;
  await f.service.cancel({projectId:f.project.id,jobId:queued.id});
  const result=(await f.service.wait({projectId:f.project.id,jobId:queued.id},{timeoutMs:5000})).result;
  assert.equal(result.status,'cancelled');assert.equal(result.executionSucceeded,false);assert.equal(result.integrity.verified,true);
});
test('Agent-facing GIS tools expose a native catalog and run a hash-bound job without bash',async t=>{
  const f=await fixture(t);
  const runtime=createToolRuntime({store:f.store,geospatialJobs:f.service,getPermissionMode:()=> 'auto',requestApproval:async()=>{throw Error('Auto mode unexpectedly requested approval');}});
  assert.ok(runtime.definitions.some(tool=>tool.name==='submit_geospatial_job'));
  const ctx={projectId:f.project.id,threadId:'thread-test',runId:'run-test',permissionMode:'auto'};
  const catalog=await runtime.execute('geospatial_catalog',{},ctx);
  assert.equal(catalog.environment.ready,true);
  const {projectId,...input}=f.args;
  const job=await runtime.execute('submit_geospatial_job',input,ctx);
  const finished=await runtime.execute('wait_geospatial_job',{jobId:job.jobId},ctx);
  assert.equal(finished.result.integrity.verified,true);
  assert.equal(finished.result.passed,true);
  assert.equal(f.calls.length,1);
});
