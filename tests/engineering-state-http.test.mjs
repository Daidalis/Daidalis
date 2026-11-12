import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {createStudioServer} from '../server/index.mjs';
import {createToolRuntime} from '../server/tools.mjs';

const fixturePath=fileURLToPath(new URL('./fixtures/engineering-state-stf.json',import.meta.url));
const stf=JSON.parse(await fs.readFile(fixturePath,'utf8'));
const resultScope='The test harness read six source-attributed L0 fixture rows. This is an application input-format check, not science, simulation, physical, or STF mission acceptance.';

async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'daidalis-engineering-state-http-')));
  const dataDir=path.join(root,'data'),folder=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'daidalis-stf-engineering-project-'))),otherFolder=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'daidalis-other-engineering-project-')));
  await fs.mkdir(path.join(folder,'source'));await fs.mkdir(path.join(folder,'analysis'));
  await fs.writeFile(path.join(folder,'source/stf-conops-extract.md'),stf.sourceExtract,'utf8');
  await fs.writeFile(path.join(folder,'source/stf-fixture.json'),JSON.stringify(stf,null,2),'utf8');
  // Produce actual fixture-processing evidence; never manufacture a NOS3 result.
  const parsed=JSON.parse(await fs.readFile(path.join(folder,'source/stf-fixture.json'),'utf8'));
  assert.deepEqual(parsed.requirements.map(row=>row.id),['L0-01','L0-02','L0-03','L0-04','L0-05','L0-06']);
  await fs.writeFile(path.join(folder,'analysis/input-shape-check.txt'),resultScope+'\nRows: 6\n','utf8');
  await fs.writeFile(path.join(otherFolder,'outside.txt'),'Another project: must not be captured.\n','utf8');
  let app,base;
  const f={root,dataDir,folder,otherFolder,get app(){return app;},
    async boot(){
      app=await createStudioServer({root,dataDir,seed:false,computer:false,evaluator:false,engineering:false,nos3:false,localVm:false,connectors:false,modelBackend:false});
      const address=await app.listen({port:0});base=`http://127.0.0.1:${address.port}`;return app;
    },
    async restart(){await app.close();return f.boot();},
    async api(route,method='GET',body,headers={}){
      const response=await fetch(base+route,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
      return {status:response.status,data:await response.json()};
    },
    async create(name='STF existing engineering fixture',folderPath=folder){
      const response=await f.api('/api/projects','POST',{name,folderPath,resources:{maxAutoResumes:0}});assert.equal(response.status,201,JSON.stringify(response.data));return response.data;
    },
    async state(project){const r=await f.api(`/api/projects/${project.id}/engineering-state`);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;},
    async post(project,action,body,status=201){const r=await f.api(`/api/projects/${project.id}/engineering-state/${action}`,'POST',body);assert.equal(r.status,status,JSON.stringify(r.data));return r.data;},
    async forgedHost(route){return new Promise((resolve,reject)=>{http.get(base+route,{headers:{host:'unrelated.example'}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject);});}
  };
  t.after(async()=>{if(app)await app.close();for(const temporary of [root,folder,otherFolder])await fs.rm(temporary,{recursive:true,force:true});});
  await f.boot();return f;
}

async function saveObject(f,project,input){
  const current=(await f.state(project)).objects.find(row=>row.id===input.id);
  return f.post(project,'objects',{...input,...(current?{expectedRevision:current.revision}: {})});
}

async function importObjects(f,project){
  for(const row of stf.requirements) await saveObject(f,project,{id:row.id,kind:'requirement',title:row.summary,description:row.original+'\nCandidate objective; acceptance pending.',sources:['source/stf-conops-extract.md']});
  await saveObject(f,project,{id:'T-DATA-SHAPE',kind:'test',title:'Fixture input shape only',description:resultScope,sources:['source/stf-fixture.json'],dependsOn:['L0-05']});
  await saveObject(f,project,{id:'C-DOWNLINK',kind:'component',title:'Candidate downlink and storage chain',dependsOn:['L0-05']});
  return f.state(project);
}

async function observedAndEvidence(f,project){
  await importObjects(f,project);
  const snapshot=await f.post(project,'snapshots',{name:'Observed STF fixture; approval is separate',paths:['source/stf-conops-extract.md','source/stf-fixture.json','analysis/input-shape-check.txt']});
  const evidence=await f.post(project,'evidence',{title:'Actual input fixture row check',scope:resultScope,result:'passed',objectIds:['T-DATA-SHAPE'],paths:['analysis/input-shape-check.txt'],snapshotId:snapshot.id});
  return {snapshot,evidence};
}

function recordedEvidence(state,id){const row=state.evidence.find(item=>item.id===id);assert.ok(row,'Recorded evidence is retained');return row;}
function applicability(state,id){const value=recordedEvidence(state,id).applicability?.status;assert.ok(['current','needs_review','invalid','unknown'].includes(value),`Invalid evidence applicability: ${value}`);return value;}

test('STF fixture preserves original objectives and unresolved real engineering conditions',()=>{
  assert.equal(stf.schema,'daidalis-stf-engineering-takeover-fixture-v1');assert.equal(stf.caseCompleted,false);assert.equal(stf.simulationExecuted,false);
  assert.equal(stf.baselineCommit,'5a3bdee6be9a2c67fdf994ae6db56d5c60395302');assert.equal(stf.requirements.length,6);
  for(const row of stf.requirements){assert.equal(row.approval,'not_approved');assert.equal(row.verification,'not_executed');assert.ok(row.original);assert.ok(row.gaps.length);}
  for(const topic of ['hardware','HIL','environment','lifetime','science-quality','contact-limited-downlink'])assert.ok(stf.unfinishedConditions.some(row=>row.topic===topic));
  assert.ok(stf.unfinishedConditions.every(row=>row.status!=='not_applicable'&&row.status!=='passed'));
});

test('explicit records retain IDs, dependencies and candidate maturity without running any agent or simulator',async t=>{
  const f=await fixture(t),project=await f.create(),state=await importObjects(f,project);
  assert.equal(typeof state.schema,'string');assert.ok(Number.isInteger(state.revision));
  for(const key of ['objects','relations','snapshots','changes','evidence','issues'])assert.ok(Array.isArray(state[key]),key);
  for(const row of stf.requirements)assert.ok(state.objects.some(object=>object.id===row.id),'Stable imported objective '+row.id);
  assert.ok(state.objects.some(object=>object.id==='T-DATA-SHAPE'));
  assert.deepEqual(state.relations,[]);assert.deepEqual(state.objects.find(object=>object.id==='C-DOWNLINK').dependsOn,['L0-05']);
  assert.equal(state.snapshots.length,0);assert.equal(state.evidence.length,0);assert.equal(f.app.store.data.runs.length,0);
  assert.equal(f.app.computer,null);assert.equal(f.app.nos3,null);assert.equal(f.app.localVm,null);assert.equal(f.app.engineering,null);
});

test('observation, explicit user approval and historic evidence survive restart as distinct records',async t=>{
  const f=await fixture(t),project=await f.create(),{snapshot,evidence}=await observedAndEvidence(f,project);
  let state=await f.state(project);const before=state.snapshots.find(row=>row.id===snapshot.id);assert.ok(before);
  assert.equal(before.kind,'observation');assert.equal(before.approval,undefined,'Observation must not silently approve a baseline');
  for(const body of [{},{reason:''},{reason:'  '}]){
    const rejected=await f.api(`/api/projects/${project.id}/engineering-state/snapshots/${snapshot.id}/approve`,'POST',body);assert.equal(rejected.status,400,JSON.stringify(rejected.data));
  }
  const reason='Accept this observed temporary fixture configuration for application testing only; no STF engineering acceptance.';
  const approved=await f.post(project,`snapshots/${snapshot.id}/approve`,{reason},200);assert.ok(approved);
  state=await f.state(project);const accepted=state.snapshots.find(row=>row.id===snapshot.id);assert.equal(accepted.approval?.actor?.kind,'user');assert.ok(JSON.stringify(accepted).includes(reason));
  assert.equal(recordedEvidence(state,evidence.id).result,'passed');assert.equal(recordedEvidence(state,evidence.id).scope,resultScope);assert.equal(applicability(state,evidence.id),'unknown');
  await f.restart();state=await f.state(project);assert.equal(state.snapshots.find(row=>row.id===snapshot.id).approval?.actor?.kind,'user');assert.equal(recordedEvidence(state,evidence.id).result,'passed');assert.equal(applicability(state,evidence.id),'unknown');
  assert.equal(state.objects.filter(row=>row.id==='L0-05').length,1,'Reopening does not duplicate engineering identities');assert.equal(f.app.store.data.runs.length,0);
});

test('a changed dependency requires evidence review while unrelated edits preserve declared evidence uncertainty',async t=>{
  const f=await fixture(t),project=await f.create(),{snapshot,evidence}=await observedAndEvidence(f,project);
  assert.equal(applicability(await f.state(project),evidence.id),'unknown');
  await saveObject(f,project,{id:'L0-06',kind:'requirement',title:'Health before science',description:'Candidate health acceptance detail remains unresolved.',sources:['source/stf-conops-extract.md'],dependsOn:[]});
  let state=await f.state(project);assert.equal(applicability(state,evidence.id),'unknown','Independent health edit must not add a change impact to declared evidence');assert.ok(recordedEvidence(state,evidence.id).applicability.reasons.every(row=>!['object_changed','file_changed','dependency_relation_changed','ambiguous_relation_changed'].includes(row.code)));
  const change=await f.post(project,'changes',{title:'Candidate clarification of downlink delivery',reason:'Expose pending delivery endpoint and contact limits, not a newly approved NASA objective.',objectIds:['L0-05'],baseSnapshotId:snapshot.id});assert.ok(change.id);
  await saveObject(f,project,{id:'L0-05',kind:'requirement',title:'Data delivered within 24 hours',description:'Candidate delivery endpoint and integrity definition changed; mission acceptance still pending.',sources:['source/stf-conops-extract.md'],dependsOn:[]});
  state=await f.state(project);assert.equal(applicability(state,evidence.id),'needs_review');assert.equal(recordedEvidence(state,evidence.id).result,'passed','Historical operation result is immutable');assert.ok(state.changes.some(row=>row.id===change.id));
});

test('current file contents and model revisions affect applicability without rewriting recorded results',async t=>{
  const f=await fixture(t),project=await f.create(),{evidence}=await observedAndEvidence(f,project);
  await fs.appendFile(path.join(f.folder,'analysis/input-shape-check.txt'),'File was changed after the check.\n','utf8');
  let state=await f.state(project);assert.notEqual(applicability(state,evidence.id),'current');assert.equal(recordedEvidence(state,evidence.id).result,'passed');
  const snapshot=await f.post(project,'snapshots',{name:'New observation after explicit file edit',paths:['analysis/input-shape-check.txt']});
  const modelEvidence=await f.post(project,'evidence',{title:'Reference for subsequent model change',scope:'Configuration bookkeeping only; no new numerical or mission acceptance result.',result:'not_executed',objectIds:['L0-05'],paths:['analysis/input-shape-check.txt'],snapshotId:snapshot.id});
  await saveObject(f,project,{id:'L0-05',description:'Proposed receiving endpoint clarification.'});
  state=await f.state(project);assert.equal(applicability(state,modelEvidence.id),'needs_review');assert.equal(recordedEvidence(state,modelEvidence.id).result,'not_executed');
  assert.equal(state.objects.filter(row=>row.id==='L0-05').length,1,'Explicit updates revise the same object identity');
});

test('engineering state rejects missing objects, stale revisions and cross-project or escaping file paths',async t=>{
  const f=await fixture(t),project=await f.create();await importObjects(f,project);const other=await f.create('Other isolated project',f.otherFolder);
  const state=await f.state(project);
  const conflict=await f.api(`/api/projects/${project.id}/engineering-state/objects`,'POST',{id:'L0-05',kind:'requirement',title:'Stale edit',description:'Must not overwrite newer state.',sources:[],dependsOn:[],expectedRevision:Math.max(0,state.objects.find(row=>row.id==='L0-05').revision-1)});assert.equal(conflict.status,409,JSON.stringify(conflict.data));
  const escapedPaths=['../other-workspace/outside.txt',path.join(f.otherFolder,'outside.txt'),'/etc/hosts','source/../../other-workspace/outside.txt'];
  await fs.symlink(path.join(f.otherFolder,'outside.txt'),path.join(f.folder,'source/cross-project-link.txt'));escapedPaths.push('source/cross-project-link.txt');
  for(const badPath of escapedPaths){
    for(const [route,body] of [['snapshots',{name:'Must reject escaping path',paths:[badPath]}],['evidence',{title:'Must reject outside evidence',scope:'No cross-project capture.',result:'not_executed',objectIds:['L0-05'],paths:[badPath]}]] ){
      const rejected=await f.api(`/api/projects/${project.id}/engineering-state/${route}`,'POST',body);assert.ok([400,403].includes(rejected.status),`${route} ${badPath}: ${JSON.stringify(rejected)}`);
    }
  }
  for(const [route,body] of [['evidence',{title:'Dangling object',scope:'Must reject missing object.',result:'not_executed',objectIds:['NONEXISTENT'],paths:[]}],['changes',{title:'Dangling change',reason:'Must reject missing object.',objectIds:['NONEXISTENT']}]]){
    const rejected=await f.api(`/api/projects/${project.id}/engineering-state/${route}`,'POST',body);assert.ok([400,404].includes(rejected.status),JSON.stringify(rejected));
  }
  const unresolved=await f.post(project,'objects',{id:'X-DANGLING',kind:'test',title:'Imported unresolved dependency',sources:[stf.source.pinned_source_url],dependsOn:['NONEXISTENT']});assert.ok(unresolved.id);assert.ok((await f.state(project)).issues.some(row=>row.kind==='missing_dependency'&&row.objectId==='X-DANGLING'));
  assert.equal((await f.state(other)).evidence.length,0);assert.equal((await f.api('/api/projects/missing/engineering-state')).status,404);
});

test('engineering state mutations retain existing origin and JSON protections',async t=>{
  const f=await fixture(t),project=await f.create(),route=`/api/projects/${project.id}/engineering-state`,body={id:'R-FORGED',kind:'requirement',title:'Must not create',sources:[],dependsOn:[]};
  assert.equal(await f.forgedHost(route),403);assert.equal((await f.api(route,'GET',undefined,{origin:'https://unrelated.example'})).status,403);
  for(const headers of [{origin:'https://unrelated.example'},{'sec-fetch-site':'cross-site'}])assert.equal((await f.api(route+'/objects','POST',body,headers)).status,403);
  assert.equal((await f.api(route+'/objects','POST',body,{'content-type':'text/plain'})).status,415);
  assert.equal((await f.state(project)).objects.length,0);
});


test('native runtime tools cannot self-approve or let a worker commit shared engineering objects',async t=>{
  const f=await fixture(t),project=await f.create(),ctx={projectId:project.id,threadId:project.coordinatorThreadId,runId:'fixture-run',agentId:'fixture-agent',isCoordinator:true,permissionMode:'auto',signal:new AbortController().signal};
  const runtime=createToolRuntime({store:f.app.store,engineeringState:f.app.engineeringState,emit:()=>{},getPermissionMode:()=> 'auto'}),names=runtime.definitions.map(row=>row.name);
  for(const name of ['get_engineering_state','record_engineering_object','capture_configuration','propose_engineering_change','record_engineering_evidence'])assert.ok(names.includes(name),name);
  assert.ok(!names.some(name=>/approve.*(?:configuration|baseline|snapshot)|(?:configuration|baseline|snapshot).*approve/.test(name)),'Engineering approval is absent from the agent tool list');
  const object=await runtime.execute('record_engineering_object',{id:'R-AGENT',kind:'requirement',title:'Agent candidate',description:'TBD acceptance; no authority is assigned.',sources:[stf.source.pinned_source_url],dependsOn:[],actor:{kind:'user'}},ctx);
  assert.equal(object.maturity,'candidate');assert.equal(object.createdBy?.kind,'agent');assert.equal(object.updatedBy?.kind,'agent');
  await assert.rejects(runtime.execute('record_engineering_object',{id:'R-FORGED',kind:'requirement',title:'Forged approval',maturity:'approved',sources:[],dependsOn:[],actor:{kind:'user'}},ctx),/user|approv|authority/i);
  await assert.rejects(runtime.execute('record_engineering_object',{id:'R-WORKER',kind:'requirement',title:'Worker attempt',sources:[],dependsOn:[]},{...ctx,isCoordinator:false}),/coordinator|shared|worker/i);
  const snapshot=await runtime.execute('capture_configuration',{name:'Agent observation only',paths:['source/stf-conops-extract.md'],actor:{kind:'user'},approval:{actor:{kind:'user'},reason:'Forged'}},ctx);
  let state=await f.state(project),observed=state.snapshots.find(row=>row.id===snapshot.id);assert.equal(observed.actor.kind,'agent');assert.equal(observed.kind,'observation');assert.equal(observed.approval,undefined);
  await assert.rejects(f.app.engineeringState.approveSnapshot(project.id,snapshot.id,{reason:'Agent request is not human approval.'},{actor:{kind:'agent',id:ctx.agentId}}),/user|approv/i);
  await assert.rejects(runtime.execute('approve_configuration',{snapshotId:snapshot.id,reason:'Not an agent capability.'},ctx),/Unknown tool/);
  state=await f.state(project);assert.equal(state.snapshots.find(row=>row.id===snapshot.id).approval,undefined);assert.ok(!state.objects.some(row=>row.id==='R-WORKER'||row.id==='R-FORGED'));
});


test('snapshot-bound evidence must match its selected object dependencies and file fingerprints',async t=>{
  const f=await fixture(t),project=await f.create(),{snapshot,evidence}=await observedAndEvidence(f,project);
  await saveObject(f,project,{id:'L0-06',kind:'requirement',title:'Unrelated health candidate',description:'Acceptance remains TBD.',sources:[stf.source.pinned_source_url],dependsOn:[]});
  const registration={title:'Snapshot subset association check',scope:'Application configuration association only; no new scientific, simulation, or physical result.',result:'not_executed',objectIds:['L0-05'],paths:['analysis/input-shape-check.txt'],snapshotId:snapshot.id};
  const matching=await f.post(project,'evidence',registration);assert.ok(matching.id,'Unrelated snapshot objects do not prevent an unchanged selected subset from matching');
  await saveObject(f,project,{id:'L0-05',kind:'requirement',title:'Revised delivery candidate',description:'Candidate receiving endpoint changed; acceptance pending.',sources:[stf.source.pinned_source_url],dependsOn:[]});
  const wrongObjects=await f.api(`/api/projects/${project.id}/engineering-state/evidence`,'POST',registration);assert.equal(wrongObjects.status,409,JSON.stringify(wrongObjects.data));
  const fresh=await f.post(project,'snapshots',{name:'Fresh reference before output mutation',paths:['analysis/input-shape-check.txt']});
  await fs.appendFile(path.join(f.folder,'analysis/input-shape-check.txt'),'A later edit must not be bound to the earlier configuration.\n','utf8');
  const wrongFile=await f.api(`/api/projects/${project.id}/engineering-state/evidence`,'POST',{...registration,snapshotId:fresh.id});assert.equal(wrongFile.status,409,JSON.stringify(wrongFile.data));
  const state=await f.state(project);assert.equal(recordedEvidence(state,evidence.id).result,'passed');assert.equal(state.evidence.length,2,'Rejected mixed configurations do not leave evidence records');
});


test('HTTP engineering object saves roll back ledger and disk on persistence failure',async t=>{
  const f=await fixture(t),project=await f.create();await importObjects(f,project);
  const beforeState=await f.state(project), beforeLedger=structuredClone(f.app.store.data.engineeringStates);
  const diskPath=path.join(f.dataDir,'state.json'), beforeDisk=await fs.readFile(diskPath,'utf8');
  const realSave=f.app.store.save;let attempts=0,response;
  f.app.store.save=()=>{attempts++;throw new Error('Synthetic engineering persistence failure');};
  try{response=await f.api(`/api/projects/${project.id}/engineering-state/objects`,'POST',{id:'L0-05',title:'Must not persist',expectedRevision:1});}finally{f.app.store.save=realSave;}
  assert.equal(response.status,400);assert.match(response.data.error,/Synthetic engineering persistence failure/);assert.equal(attempts,1);
  assert.deepEqual(f.app.store.data.engineeringStates,beforeLedger);assert.equal(await fs.readFile(diskPath,'utf8'),beforeDisk);
  await f.restart();const state=await f.state(project);assert.equal(state.revision,beforeState.revision);assert.deepEqual(state.objects,beforeState.objects);
});
