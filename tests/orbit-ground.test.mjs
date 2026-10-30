import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createOrbitGroundService} from '../server/orbit-ground.mjs';
import {createOrbitGroundRuntime,ORBIT_GROUND_TOOL_DEFINITIONS} from '../server/orbit-ground-tools.mjs';
import {createWorkspaceViewer} from '../server/workspace-viewer.mjs';
import {createStore} from '../server/store.mjs';

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const ORBIT_ID='orbit42_'+'a'.repeat(32),WORKER='b'.repeat(64),MODEL='c'.repeat(64);
const PROJECT_ONE='project_'+'1'.repeat(32),PROJECT_OTHER='project_'+'2'.repeat(32);

async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-orbit-ground-')),ws=path.join(root,'workspace'),dataDir=path.join(root,'data');
  await fs.mkdir(ws);const orbitRoot=`engineering/orbit/${ORBIT_ID}`;await fs.mkdir(path.join(ws,orbitRoot),{recursive:true});
  const rawBytes={ 'PosW.42':Buffer.from('0 6778137 0 0\n'), 'time.42':Buffer.from('0\n'), 'PosN.42':Buffer.from('0 6778137 0 0\n')};
  for(const [name,bytes] of Object.entries(rawBytes))await fs.writeFile(path.join(ws,orbitRoot,name),bytes);
  const receipt={schema:'manta-orbit42-receipt-v1',jobId:ORBIT_ID,inputHash:MODEL,epochUtc:'2024-08-04T00:00:00Z',leapSecondsAssumed:37,rawOutputs:Object.entries(rawBytes).map(([name,bytes])=>({path:name,sha256:sha(bytes)}))};
  const receiptBytes=Buffer.from(JSON.stringify(receipt));await fs.writeFile(path.join(ws,orbitRoot,'receipt.json'),receiptBytes);
  const artifacts=[{path:`${orbitRoot}/receipt.json`,sha256:sha(receiptBytes)},...Object.entries(rawBytes).map(([name,bytes])=>({path:`${orbitRoot}/${name}`,sha256:sha(bytes)}))];
  const orbitResult={status:'completed',executionSucceeded:true,inputHash:MODEL,integrity:{verified:true},receipt,artifacts};
  const zip=Buffer.from('PK\x03\x04bounded-state-zip'),zipHash=sha(zip),zipPath=`source-${zipHash}.zip`;await fs.writeFile(path.join(ws,zipPath),zip);
  const added=[];const store={workspace(id){if(![PROJECT_ONE,PROJECT_OTHER].includes(id))throw Error('Unknown project');return ws;},get(kind,id){return kind==='projects'&&[PROJECT_ONE,PROJECT_OTHER].includes(id)?{id}:null;},add(_kind,value){added.push(value);},data:{artifacts:added}};
  const orbit42Jobs={catalog:async()=>({environment:{ready:true}}),result:async({projectId,jobId})=>{if(projectId!==PROJECT_ONE||jobId!==ORBIT_ID)throw Error('Orbit job does not belong to this project');return orbitResult;}};
  const geospatialJobs={catalog:async()=>({environment:{ready:true}})};
  let mode='valid',requestSeen;
  const runner={status:async()=>({ready:true}),async run(request){requestSeen=request;const payloads={'ground-track.geojson':Buffer.from('{"type":"FeatureCollection","features":[]}'),'ground-samples.csv':Buffer.from('time_s,relation\n0,outside\n'),'report.md':Buffer.from('# Bounded cross-check\n')};
    const receipt={schema:'manta-orbit-ground-receipt-v1',jobId:request.jobId,inputHash:request.inputHash,workerSha256:WORKER,orbit:{jobId:request.orbit.jobId,receiptSha256:request.orbit.receiptSha256,modelSha256:request.orbit.modelSha256,posWSha256:sha(rawBytes['PosW.42']),timeSha256:sha(rawBytes['time.42']),epochUtc:'2024-08-04T00:00:00Z',leapSecondsAssumed:37},census:{path:zipPath,sha256:zipHash,expectedSourceEpsg:4269,featureIdField:'STATEFP'},outputSha256:Object.fromEntries(Object.entries(payloads).map(([name,bytes])=>[name,sha(bytes)]))};
    if(mode==='bad-receipt')receipt.orbit.posWSha256='0'.repeat(64);
    if(mode==='bad-output-hash')receipt.outputSha256['report.md']='0'.repeat(64);
    payloads['receipt.json']=Buffer.from(JSON.stringify(receipt));
    return {schema:'manta-orbit-ground-response-v1',success:true,exitCode:0,workerSha256:WORKER,receipt,metrics:{nativeSamples:11,selectedSamples:2},files:Object.entries(payloads).map(([name,bytes])=>({path:name,mimeType:name.endsWith('.md')?'text/markdown':'application/json',sha256:sha(bytes),contentBase64:bytes.toString('base64')})),diagnostics:'bounded only'};
  },async close(){}};
  const service=await createOrbitGroundService({dataDir,store,orbit42Jobs,geospatialJobs,runner,allowedCensusHashes:[zipHash]});
  return {root,ws,dataDir,store,orbit42Jobs,geospatialJobs,runner,service,orbitResult,zipHash,zipPath,added,getRequest:()=>requestSeen,setMode:value=>mode=value};
}

test('bounded native orbit-ground result is scoped, hash-verified and linked to reviewable artifacts',async()=>{
  const f=await fixture();try{
    assert.equal(ORBIT_GROUND_TOOL_DEFINITIONS.length,5);
    const runtime=createOrbitGroundRuntime({orbitGroundJobs:f.service,authorizeMutation:async()=>{}}),ctx={projectId:PROJECT_ONE,threadId:'thread_a',runId:'run_a',signal:new AbortController().signal};
    assert.equal((await runtime.execute('orbit_ground_catalog',{},ctx)).environment.ready,true);
    const queued=await runtime.execute('submit_orbit_ground_job',{orbit42JobId:ORBIT_ID,censusPath:f.zipPath,censusSha256:f.zipHash,maxSamples:2},ctx);
    const done=await runtime.execute('wait_orbit_ground_job',{jobId:queued.jobId},ctx);
    assert.equal(done.status,'completed');assert.equal(done.result.integrity.verified,true);assert.equal(done.result.passed,null);
    assert.equal(f.getRequest().maxSamples,2);assert.deepEqual(Object.keys(f.getRequest()).sort(),['census','inputHash','jobId','maxSamples','orbit','schema']);
    assert.ok(done.result.artifacts.some(item=>item.path===done.result.mapPath));
    const viewer=createWorkspaceViewer({store:f.store,orbitGroundJobs:f.service});
    const map=await viewer.read({projectId:PROJECT_ONE,path:done.result.mapPath});assert.equal(map.previewable,true);assert.equal(map.editable,false);
    await assert.rejects(f.service.result({projectId:PROJECT_OTHER,jobId:queued.jobId}),/does not belong/);
    await fs.appendFile(path.join(f.ws,done.result.mapPath),'tamper');
    assert.equal((await f.service.result({projectId:PROJECT_ONE,jobId:queued.jobId})).integrity.verified,false);
    await assert.rejects(viewer.read({projectId:PROJECT_ONE,path:done.result.mapPath}),/完整性/);
  }finally{await f.service.close();await fs.rm(f.root,{recursive:true,force:true});}
});

test('legacy Orbit42 and mismatched source/worker receipts cannot become cross-check evidence',async()=>{
  const f=await fixture();try{
    const args={projectId:PROJECT_ONE,orbit42JobId:ORBIT_ID,censusPath:f.zipPath,censusSha256:f.zipHash,maxSamples:2};
    await assert.rejects(f.service.submit({...args,censusSha256:'0'.repeat(64)}),/imported source|pinned source/);
    const original=f.orbitResult.receipt.rawOutputs;delete f.orbitResult.receipt.rawOutputs;
    await assert.rejects(f.service.submit(args),/PosW\/time\/clock receipt/);f.orbitResult.receipt.rawOutputs=original;
    for(const mode of ['bad-receipt','bad-output-hash']){
      f.setMode(mode);const queued=await f.service.submit(args,{threadId:'thread_a',runId:'run_a'}),done=await f.service.wait({projectId:PROJECT_ONE,jobId:queued.jobId});
      assert.equal(done.status,'failed');assert.equal(done.result.integrity.verified,true);assert.equal(done.result.executionSucceeded,false);
      assert.equal(done.result.artifacts.some(item=>/ground-track\.geojson|ground-samples\.csv|report\.md|receipt\.json/.test(item.path)),false);
      assert.equal(f.added.some(item=>item.path.includes(queued.jobId)&&/ground-track\.geojson|ground-samples\.csv|report\.md|receipt\.json/.test(item.path)),false);
    }
  }finally{await f.service.close();await fs.rm(f.root,{recursive:true,force:true});}
});

test('a persisted job/result status divergence blocks all successful previews after reopening',async()=>{
  const f=await fixture();let reopened;
  try{
    const args={projectId:PROJECT_ONE,orbit42JobId:ORBIT_ID,censusPath:f.zipPath,censusSha256:f.zipHash,maxSamples:2};
    const queued=await f.service.submit(args),done=await f.service.wait({projectId:PROJECT_ONE,jobId:queued.jobId});
    assert.equal(done.result.integrity.verified,true);await f.service.close();
    const index=path.join(f.dataDir,'orbit-ground-jobs',queued.jobId+'.json'),job=JSON.parse(await fs.readFile(index,'utf8'));
    job.status='failed';await fs.writeFile(index,JSON.stringify(job));
    reopened=await createOrbitGroundService({dataDir:f.dataDir,store:f.store,orbit42Jobs:f.orbit42Jobs,geospatialJobs:f.geospatialJobs,runner:f.runner,allowedCensusHashes:[f.zipHash]});
    const result=await reopened.result({projectId:PROJECT_ONE,jobId:queued.jobId});
    assert.equal(result.integrity.verified,false);assert.match(result.integrity.reason,/status differs/);
    const viewer=createWorkspaceViewer({store:f.store,orbitGroundJobs:reopened});
    await assert.rejects(viewer.read({projectId:PROJECT_ONE,path:done.result.mapPath}),/完整性/);
  }finally{await reopened?.close();await f.service.close();await fs.rm(f.root,{recursive:true,force:true});}
});

test('direct artifact HTTP route rechecks orbit-ground job hashes before returning text',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-orbit-ground-http-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=createStore({dataDir:path.join(root,'state'),seed:false}),project=store.createProject({name:'HTTP evidence'});
  const jobId='orbitground_'+'d'.repeat(32),relative=`engineering/orbit-ground/${jobId}/report.md`,target=path.join(store.workspace(project.id),relative),content='# Bounded result\n';
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,content);
  const artifact=store.add('artifacts',{id:'artifact_ground_route',projectId:project.id,name:'Bounded report',path:relative,type:'text/markdown',createdAt:new Date().toISOString()});
  const orbitGroundJobs={result:async()=>({status:'completed',integrity:{verified:true},artifacts:[{path:relative,sha256:sha(content)}]}),close:async()=>{}};
  const {createStudioServer}=await import('../server/index.mjs');
  const app=await createStudioServer({store,dataDir:store.dataDir,seed:false,computer:false,evaluator:false,engineering:false,engineeringState:false,engineeringPlan:false,nos3:false,modelBackend:false,professionalModels:false,professionalRunner:false,connectors:false,stfCase:false,geospatial:false,orbit42:false,orbitGround:true,orbitGroundRunner:false,orbitGroundJobs});
  t.after(()=>app.close());const {port}=await app.listen({port:0});const url=`http://127.0.0.1:${port}/api/artifacts/${artifact.id}`;
  assert.equal((await (await fetch(url)).json()).content,content);
  await fs.appendFile(target,'tampered\n');
  const blocked=await fetch(url);assert.equal(blocked.status,409);
});


test('container transport snapshots exact native evidence and rejects changed orbit bytes',async()=>{
 const f=await fixture();f.runner.requiresNativeFiles=true;
 try{
  const args={projectId:PROJECT_ONE,orbit42JobId:ORBIT_ID,censusPath:f.zipPath,censusSha256:f.zipHash,maxSamples:2};
  const job=await f.service.submit(args),done=await f.service.wait({projectId:PROJECT_ONE,jobId:job.id});
  assert.equal(done.status,'completed');
  assert.deepEqual(Object.keys(f.getRequest().nativeFiles).sort(),['PosN.42','PosW.42','receipt.json','time.42']);
  assert.equal(sha(Buffer.from(f.getRequest().nativeFiles['receipt.json'],'base64')),done.result.orbit.receiptSha256);
  await fs.appendFile(path.join(f.ws,`engineering/orbit/${ORBIT_ID}/PosW.42`),'tamper');
  await assert.rejects(f.service.submit(args),/Native orbit evidence changed/);
  assert.equal((await f.service.result({projectId:PROJECT_ONE,jobId:job.id})).integrity.verified,true);
  await fs.appendFile(path.join(f.ws,job.relative,'native-PosW.42'),'tamper');
  assert.equal((await f.service.result({projectId:PROJECT_ONE,jobId:job.id})).integrity.verified,false);
 }finally{await f.service.close();await fs.rm(f.root,{recursive:true,force:true});}
});
