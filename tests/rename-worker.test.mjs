import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createNos3Service} from '../server/nos3.mjs';
import {spawnBounded} from '../server/sandbox.mjs';
import {sha256} from '../server/nos3/core.mjs';

async function fixture(t,scenario={}) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'daidalis-worker-rename-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const source=path.join(directory,'source');await fs.mkdir(source);
  async function git(...args) {
    const result=await spawnBounded('/usr/bin/git',['-c','core.hooksPath=/dev/null','-c','user.name=Rename fixture','-c','user.email=fixture@invalid','-C',source,...args],{env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'},timeoutMs:10000});
    assert.equal(result.code,0,result.stderr);
    return result.stdout.trim();
  }
  await git('init','-q');await fs.writeFile(path.join(source,'Makefile'),'all:\n\t@true\n');
  await git('add','Makefile');await git('commit','-qm','Source baseline');
  const commit=await git('rev-parse','HEAD');
  await git('update-index','--add','--cacheinfo',`160000,${commit},components/generic_adcs`);
  await git('commit','-qm','Pinned component');
  const store={workspace(id){assert.equal(id,'project');return source;},add(){}};
  const requests=[],submissions=[];let accepted;
  const service=await createNos3Service({store,dataDir:path.join(directory,'data'),pollIntervalMs:1,fetchImpl:async(url,options={})=>{
    requests.push({url,method:options.method,headers:options.headers});
    if(url.endsWith('/cancel'))return Response.json({status:'cancelled'});
    if(url.endsWith('/health')){
      if(scenario.healthError)throw Error('Health unavailable');
      return Response.json({schema:scenario.healthSchema,scopes:{component:true}});
    }
    if(url.endsWith('/jobs')&&options.method==='POST'){
      const input=JSON.parse(options.body);submissions.push(input);
      if(scenario.transportError)throw scenario.transportError;
      const legacy=scenario.healthSchema==='manta-nos3-worker-v1';
      if(scenario.status&&!(legacy&&input.schema==='manta-nos3-job-v1'))return Response.json({error:'Invalid NOS3 job'},{status:scenario.status});
      accepted=input;return Response.json({jobId:input.id},{status:202});
    }
    assert(accepted,'Only an acknowledged submission may be polled');
    if(url.endsWith('/result')){
      const log=Buffer.from('Recorded protocol fixture evidence\n');
      return Response.json({scope:accepted.scope,inputHash:accepted.inputHash,baselineHash:accepted.baseline.baselineHash,passed:true,checks:[{id:'protocol-fixture',criterion:'The acknowledged protocol fixture completed',passed:true}],files:[{file:'fixture.log',sha256:sha256(log),contentBase64:log.toString('base64')}]});
    }
    return Response.json({scope:accepted.scope,inputHash:accepted.inputHash,status:'completed'});
  }});
  t.after(()=>service.close());
  await service.configure({projectId:'project',worker:{type:'remote-https',endpoint:'https://worker.invalid'}});
  async function run() {
    const job=await service.submit({projectId:'project',scope:'component'});
    await service.wait({projectId:'project',jobId:job.id});
    return service.result({projectId:'project',jobId:job.id});
  }
  return {service,requests,submissions,run};
}

test('an acknowledged current worker submission keeps the ordinary request sequence',async t=>{
  const h=await fixture(t),result=await h.run();
  assert.equal(result.status,'completed');assert.equal(result.integrity.verified,true);
  assert.equal(h.submissions.length,1);assert.equal(h.submissions[0].schema,'daidalis-nos3-job-v1');
  assert.equal(h.requests.some(r=>r.url.endsWith('/health')),false);
});

test('an explicitly rejected request can use the exact advertised old worker schema with the same job identity',async t=>{
  const h=await fixture(t,{status:400,healthSchema:'manta-nos3-worker-v1'}),result=await h.run();
  assert.equal(result.status,'completed');assert.equal(result.integrity.verified,true);
  assert.equal(h.submissions.length,2);
  const [current,legacy]=h.submissions;
  assert.equal(current.schema,'daidalis-nos3-job-v1');assert.equal(legacy.schema,'manta-nos3-job-v1');
  assert.deepEqual({...legacy,schema:current.schema},current,'Only the protocol name changes; job IDs, hashes, sources and model snapshots remain identical');
  assert.deepEqual(h.requests.slice(0,3).map(r=>[r.method,new URL(r.url).pathname]),[['POST','/jobs'],['GET','/health'],['POST','/jobs']]);
});

for(const healthSchema of ['daidalis-nos3-worker-v1','unknown-nos3-worker-v1',undefined])test('ordinary rejection never resubmits for health schema '+String(healthSchema),async t=>{
  const h=await fixture(t,{status:400,healthSchema}),result=await h.run();
  assert.equal(result.status,'failed');assert.equal(h.submissions.length,1);
});

test('a rejected request with unavailable health is never resubmitted',async t=>{
  const h=await fixture(t,{status:400,healthError:true}),result=await h.run();
  assert.equal(result.status,'failed');assert.equal(h.submissions.length,1);
});

for(const status of [401,403,500,502])test('HTTP '+status+' never triggers legacy protocol negotiation or replay',async t=>{
  const h=await fixture(t,{status,healthSchema:'manta-nos3-worker-v1'}),result=await h.run();
  assert.equal(result.status,'failed');assert.equal(h.submissions.length,1);
  assert.equal(h.requests.some(r=>r.url.endsWith('/health')),false);
});

for(const transportError of [new TypeError('Network acknowledgement lost'),new DOMException('Request timed out','TimeoutError')])test(transportError.name+' never triggers legacy protocol negotiation or replay',async t=>{
  const h=await fixture(t,{transportError,healthSchema:'manta-nos3-worker-v1'}),result=await h.run();
  assert.equal(result.status,'failed');assert.equal(h.submissions.length,1);
  assert.equal(h.requests.some(r=>r.url.endsWith('/health')),false);
});
