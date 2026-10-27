import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createStore} from '../server/store.mjs';
import {createWorkspaceViewer,createWorkspaceViewerRoutes} from '../server/workspace-viewer.mjs';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
async function fixture(t, extras={}) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'manta-viewer-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const store=createStore({dataDir:path.join(directory,'state'),seed:false});
  const project=store.createProject({name:'Viewer fixture'}), workspace=store.workspace(project.id);
  const put=async(relative,text)=>{await fs.mkdir(path.dirname(path.join(workspace,relative)),{recursive:true});await fs.writeFile(path.join(workspace,relative),text);};
  return {directory,store,project,workspace,put,viewer:createWorkspaceViewer({store,...extras})};
}

test('project browsing discovers unregistered models and Markdown, without traversing the repository or internal folders',async t=>{
  const f=await fixture(t);
  await Promise.all([f.put('models/live.sysml','package A {}'),f.put('reports/verification.md','# Real report'),f.put('README.md','# Readme'),f.put('components/deep/model.sysml','hidden from targeted discovery'),f.put('.env','DO_NOT_EXPOSE'),f.put('secrets.json','DO_NOT_EXPOSE'),f.put('.git/config','DO_NOT_EXPOSE'),f.put('node_modules/huge.md','DO_NOT_SCAN')]);
  const before=f.store.data.artifacts.length, list=await f.viewer.list({projectId:f.project.id});
  assert.deepEqual(list.discovered.models.map(x=>x.path),['models/live.sysml']);
  assert.ok(list.discovered.reports.some(x=>x.path==='reports/verification.md'));
  assert.ok(!list.entries.some(x=>x.name==='secrets.json'||x.name.startsWith('.')||x.name==='node_modules'));
  assert.equal(f.store.data.artifacts.length,before);
  assert.equal((await f.viewer.list({projectId:f.project.id,path:'models'})).entries[0].type,'sysml');
});

test('file presentation is bounded, content hashed and never turns HTML, SVG or scripts into active content',async t=>{
  const f=await fixture(t), projectId=f.project.id;
  const text='# Report\n\n<script>alert("unsafe")</script>';
  await f.put('report.md',text); await f.put('unsafe.html','<script>fetch("https://example.org")</script>'); await f.put('plot.svg','<svg onload="alert(1)"></svg>');
  const report=await f.viewer.read({projectId,path:'report.md'});
  assert.equal(report.content,text);assert.equal(report.sha256,sha(text));assert.equal(report.encoding,'utf8');assert.equal(report.type,'markdown');assert.equal(report.mime,'text/markdown');
  assert.equal((await f.viewer.read({projectId,path:'unsafe.html'})).mime,'text/plain');
  assert.equal((await f.viewer.read({projectId,path:'plot.svg'})).mime,'text/plain');
  await f.put('huge.md',Buffer.alloc(1500001,65));await assert.rejects(f.viewer.read({projectId,path:'huge.md'}),e=>e.status===413);
  await f.put('binary.txt',Buffer.from([1,0,3]));assert.equal((await f.viewer.read({projectId,path:'binary.txt'})).previewable,false);
  await f.put('invalid.txt',Buffer.from([0xff,0xfe]));await assert.rejects(f.viewer.read({projectId,path:'invalid.txt'}),/UTF-8/);
});

test('project paths reject cross-project traversal, symbolic links, credentials and hidden configuration',async t=>{
  const f=await fixture(t), projectId=f.project.id;
  await fs.writeFile(path.join(f.directory,'private.md'),'PRIVATE');await fs.symlink(f.directory,path.join(f.workspace,'escape'));
  for(const relative of ['../private.md','/etc/passwd','escape/private.md','.git/config','.ssh/id_ed25519','keys/client.pem','keys/service.json','api-key.json','secrets.json','.manta/worker.json','.Manta/worker.json','nested/.manta/worker.json','a/../private.md']) await assert.rejects(f.viewer.read({projectId,path:relative}),/path|workspace|configuration|Credential|Symbolic/i);
  await assert.rejects(f.viewer.list({projectId:'project_00000000-0000-0000-0000-000000000000'}),/not found/);
  await assert.rejects(f.viewer.read({projectId,path:'.'}),/regular file/);
});

test('only validated raster signatures produce image payloads; SVG is source text',async t=>{
  const f=await fixture(t), png=Buffer.from('89504e470d0a1a0a00000000','hex');
  await f.put('plot.png',png);await f.put('spoof.png','<script>alert(1)</script>');
  const r=await f.viewer.read({projectId:f.project.id,path:'plot.png'});
  assert.equal(r.mime,'image/png');assert.equal(r.encoding,'base64');assert.equal(r.content,png.toString('base64'));
  await assert.rejects(f.viewer.read({projectId:f.project.id,path:'spoof.png'}),/signature/);
});

test('semantic model view queries exact source revision without recording validation or modifying the workspace',async t=>{
  const calls=[], semantic={valid:true,findings:[],data:{nodes:[{id:'real',name:'Vehicle'}],edges:[]},backend:{name:'fixture backend'}};
  const f=await fixture(t,{modelBackend:{query:async args=>{calls.push(args);return semantic;}}});
  await f.put('models/model.sysml','package Demo {}');
  const r=await f.viewer.model({projectId:f.project.id,path:'models/model.sysml'});
  assert.deepEqual(r.graph,semantic.data);assert.equal(r.semantic.available,true);assert.equal(r.source,'package Demo {}');assert.equal(calls[0].expectedHash,sha(r.source));
  await f.viewer.model({projectId:f.project.id,path:'models/model.sysml'});assert.equal(calls.length,1,'same exact source revision may be cached');
  await f.put('models/model.sysml','package Revised {}');await f.viewer.model({projectId:f.project.id,path:'models/model.sysml'});assert.equal(calls.length,2);
  assert.equal(f.store.data.artifacts.length,0);
});

test('model source remains readable when semantic backend is unavailable or finds a parse error',async t=>{
  const f=await fixture(t,{modelBackend:{query:async()=>{throw Error('Backend unavailable');}}});await f.put('draft.sysml','package Draft {');
  const r=await f.viewer.model({projectId:f.project.id,path:'draft.sysml'});assert.equal(r.semantic.available,false);assert.match(r.semantic.error,/unavailable/);assert.equal(r.source,'package Draft {');assert.equal(r.graph,null);
});

async function simulationFixture(t) {
  let f, receipt, job;
  const nos3={list:async({projectId})=>projectId===f.project.id?[job]:[],status:async({projectId,jobId})=>{if(projectId!==f.project.id||jobId!==job.id)throw Error('NOS3 job does not belong to this project');return job;},result:async()=>receipt};
  f=await fixture(t,{nos3});
  const id='nos3_'+'a'.repeat(32),relative='engineering/nos3/'+id;
  const packet=Buffer.alloc(49);[.1,.2,.3,.9].forEach((v,i)=>packet.writeDoubleLE(v,16+i*8));packet[48]=1;
  const telemetry=JSON.stringify({wallTime:100,source:'telemetry',mid:'0x936',length:49,packetBase64:packet.toString('base64')})+'\n'+JSON.stringify({wallTime:100.5,source:'telemetry',mid:'0x936',length:49,packetBase64:packet.toString('base64')})+'\n';
  const summary=JSON.stringify({passed:true,checks:[{name:'actual packets',passed:true}],udp_telemetry:{compiler_layout:{byte_order:'little',packets:[{mid:2358,name:'startracker',size:49,q_offset:16,valid_offset:48}]}}});
  const files={'fixed/telemetry-samples.jsonl':telemetry,'fixed/verification-summary.json':summary};
  const result={scope:'integration',status:'completed',passed:true,fullNos3Simulation:true,checks:[{id:'fixed',passed:true}],pendingRequirements:[{id:'HARDWARE',status:'not-tested'}],telemetryFiles:Object.keys(files),artifacts:Object.entries(files).map(([p,s])=>({path:p,sha256:sha(s)})),modelEvidence:[{path:'models/live.sysml',sha256:'b'.repeat(64)}]};
  const resultText=JSON.stringify(result);await f.put(relative+'/result.json',resultText);
  for(const [name,value] of Object.entries(files))await f.put(relative+'/remote/telemetry/'+name,value);
  receipt={...result,jobId:id,ready:true,resultSha256:sha(resultText),artifacts:Object.keys(files).map(name=>({path:relative+'/remote/telemetry/'+name}))};
  job={id,jobId:id,relative,projectId:f.project.id,status:'completed',scope:'integration',baseline:{revision:'c'.repeat(40),baselineHash:'d'.repeat(64)}};
  return {...f,job,receipt,files,relative};
}

test('simulation view decodes actual packet bytes using recorded compiler layout and preserves sample and integrity provenance',async t=>{
  const f=await simulationFixture(t), r=await f.viewer.simulation({projectId:f.project.id,jobId:f.job.id});
  assert.equal(r.integrity.verified,true);assert.equal(r.cases.length,1);assert.equal(r.cases[0].points.length,2);
  assert.deepEqual(r.cases[0].points[0].quaternion,[.1,.2,.3,.9]);assert.equal(r.cases[0].points[1].time,.5);assert.equal(r.cases[0].points[0].valid,true);assert.equal(r.cases[0].points[0].channel,'startracker');
  assert.equal(r.cases[0].integrity.checks.every(c=>c.matched),true);assert.equal(r.unverified[0].id,'HARDWARE');assert.match(r.limitations[0],/not simulation time/);
  const other=f.store.createProject({name:'Other project'});await assert.rejects(f.viewer.simulation({projectId:other.id,jobId:f.job.id}),/does not belong/);
  assert.equal((await f.viewer.list({projectId:other.id})).discovered.simulations.length,0);
});

test('modified telemetry never produces a curve and a modified protected result is rejected',async t=>{
  const f=await simulationFixture(t);await f.put(f.relative+'/remote/telemetry/fixed/telemetry-samples.jsonl',f.files['fixed/telemetry-samples.jsonl']+'\n');
  const r=await f.viewer.simulation({projectId:f.project.id,jobId:f.job.id});assert.equal(r.integrity.verified,false);assert.equal(r.cases[0].points.length,0);assert.match(r.cases[0].integrity.error,/hash changed/);
  await f.put(f.relative+'/result.json','{}');await assert.rejects(f.viewer.simulation({projectId:f.project.id,jobId:f.job.id}),e=>e.status===409&&/integrity/.test(e.message));
});

test('workspace HTTP routes are project-scoped, explicit and read-only',async t=>{
  const f=await fixture(t);await f.put('report.md','# Report');const responses=[];
  const route=createWorkspaceViewerRoutes({viewer:f.viewer,send:(_res,status,data)=>responses.push({status,data})});
  const args={req:{method:'GET',url:'/api/projects/'+f.project.id+'/workspace/file?path=report.md'},res:{},parts:['api','projects',f.project.id,'workspace','file'],project:f.project};
  assert.equal(await route(args),true);assert.equal(responses[0].data.type,'markdown');
  assert.equal(await route({...args,parts:['api','projects',f.project.id,'other']}),false);
  await assert.rejects(route({...args,req:{method:'POST',url:args.req.url}}),e=>e.status===405);
  await assert.rejects(route({...args,parts:[...args.parts,'unexpected']}),e=>e.status===404);
});

test('inline image route serves only raster bytes through the project boundary with restrictive headers',async t=>{
  const f=await fixture(t),png=Buffer.from('89504e470d0a1a0a00000000','hex');await f.put('plot.png',png);await f.put('unsafe.svg','<svg onload="alert(1)"></svg>');
  let status,headers,body;
  const res={writeHead:(s,h)=>{status=s;headers=h;},end:value=>{body=value;}};
  const route=createWorkspaceViewerRoutes({viewer:f.viewer,send:()=>{throw Error('No JSON wrapper for image bytes');}});
  const parts=['api','projects',f.project.id,'workspace','image'];
  const args={req:{method:'GET',url:'/api/projects/'+f.project.id+'/workspace/image?path=plot.png'},res,parts,project:f.project};
  assert.equal(await route(args),true);assert.equal(status,200);assert.equal(headers['content-type'],'image/png');assert.equal(headers['x-content-type-options'],'nosniff');assert.equal(headers['cache-control'],'no-store');assert.match(headers['content-security-policy'],/sandbox/);assert.deepEqual(body,png);
  await assert.rejects(route({...args,req:{method:'GET',url:'/api/projects/'+f.project.id+'/workspace/image?path=unsafe.svg'}}),e=>e.status===415);
  await assert.rejects(route({...args,req:{method:'GET',url:'/api/projects/'+f.project.id+'/workspace/image?path=../outside.png'}}),/escapes/);
});

test('cancelled and interrupted jobs without a result file show an explicit non-result state without replay',async t=>{
  let calls=0;const id='nos3_'+'c'.repeat(32);
  const f=await fixture(t,{nos3:{status:async()=>{calls++;return {id,status:'cancelled',scope:'integration'};},result:async()=>({jobId:id,status:'cancelled',ready:true,passed:false,reason:'Cancelled before execution'})}});
  const r=await f.viewer.simulation({projectId:f.project.id,jobId:id});
  assert.equal(r.status,'cancelled');assert.deepEqual(r.cases,[]);assert.equal(r.integrity.verified,false);assert.match(r.integrity.error,/No completed result/);assert.equal(calls,1);
  await assert.rejects(f.viewer.read({projectId:f.project.id,path:'absent.md'}),e=>e.status===404);
});

test('bound model navigation targets the immutable checked snapshot, rather than a subsequently changed current model',async t=>{
  const f=await simulationFixture(t), snapshot='models/0-bound.sysml', source='package Bound {}';
  const text=await fs.readFile(path.join(f.workspace,f.relative,'result.json'),'utf8'), result=JSON.parse(text);
  result.modelEvidence=[{path:'models/live.sysml',snapshot,sha256:sha(source)}];
  await f.put(f.relative+'/'+snapshot,source);await f.put('models/live.sysml','package Changed {}');
  const next=JSON.stringify(result);await f.put(f.relative+'/result.json',next);f.receipt.resultSha256=sha(next);
  const r=await f.viewer.simulation({projectId:f.project.id,jobId:f.job.id});
  assert.equal(r.model.path,f.relative+'/'+snapshot);assert.equal(r.model.originalPath,'models/live.sysml');assert.equal(r.model.integrity.verified,true);assert.equal(r.integrity.verified,true);
  await f.put(f.relative+'/'+snapshot,'package Tampered {}');
  const changed=await f.viewer.simulation({projectId:f.project.id,jobId:f.job.id});assert.equal(changed.model.path,null);assert.equal(changed.integrity.verified,false);assert.equal(changed.cases[0].points.length,2,'intact telemetry remains available with its own separate receipt');
});

test('large directory presentation truncates explicitly',async t=>{
  const f=await fixture(t);await fs.mkdir(path.join(f.workspace,'many'));await Promise.all(Array.from({length:505},(_,i)=>f.put('many/'+i+'.txt','x')));
  const r=await f.viewer.list({projectId:f.project.id,path:'many'});assert.equal(r.entries.length,500);assert.equal(r.truncated,true);assert.equal(r.limits.scannedDirectoryEntries,2500);
});

// All UI entrypoints use the same protected job provenance, never a JSON field hint.
test('result intent resolves protected evidence and rejects foreign or changed jobs',async t=>{
  const f=await simulationFixture(t),pid=f.project.id;
  assert.deepEqual(await f.viewer.resolve({projectId:pid,path:f.relative+'/result.json'}),{kind:'simulation',jobId:f.job.id,path:f.relative+'/result.json'});
  assert.equal((await f.viewer.resolve({projectId:pid,path:f.relative+'/remote/telemetry/fixed/telemetry-samples.jsonl'})).caseId,'fixed');
  await f.put('result.json',JSON.stringify({jobId:f.job.id}));
  assert.equal((await f.viewer.resolve({projectId:pid,path:'result.json'})).kind,'file');
  const other=f.store.createProject({name:'Shared'}),originalWorkspace=f.store.workspace.bind(f.store);f.store.workspace=id=>id===other.id?f.workspace:originalWorkspace(id);
  await assert.rejects(f.viewer.resolve({projectId:other.id,path:f.relative+'/result.json'}),/does not belong/);
  await f.put(f.relative+'/result.json','{}');
  await assert.rejects(f.viewer.resolve({projectId:pid,path:f.relative+'/result.json'}),/integrity/);
});

test('bound model sources and logs stay documents instead of recursively opening the result viewer',async t=>{
 const f=await simulationFixture(t);await f.put(f.relative+'/models/snapshot.sysml','package Snapshot {}');
 assert.equal((await f.viewer.resolve({projectId:f.project.id,path:f.relative+'/models/snapshot.sysml'})).kind,'file');
 await f.put(f.relative+'/run.log','actual logs');assert.equal((await f.viewer.resolve({projectId:f.project.id,path:f.relative+'/run.log'})).kind,'file');
});

test('registered extensionless Markdown reports render as safe readable text using project metadata',async t=>{const f=await fixture(t);await f.put('artifacts/report-without-extension','# Actual review\n\n<script>unsafe()</script>');f.store.add('artifacts',{id:'artifact-report',projectId:f.project.id,path:'artifacts/report-without-extension',type:'markdown'});const file=await f.viewer.read({projectId:f.project.id,path:'artifacts/report-without-extension'});assert.equal(file.type,'markdown');assert.equal(file.mime,'text/markdown');assert.equal(file.previewable,true);assert.match(file.content,/# Actual review/);});

test('native GIS and 42 previews require exact project job receipts and current bytes, then stay read-only',async t=>{
 const geo='geospatial_'+'a'.repeat(32),orbit='orbit42_'+'b'.repeat(32),mapPath=`engineering/geospatial/${geo}/outputs/preview.geojson`,trackPath=`engineering/orbit/${orbit}/trajectory.csv`;
 const map='{"type":"FeatureCollection","features":[]}',track='time_seconds,x_n_m\n0,7000000\n';
 let owner,accepted=true;
 const result=(expectedId,relative,contents)=>async({projectId,jobId})=>{
  if(projectId!==owner||jobId!==expectedId)throw Object.assign(Error('Job does not belong to project'),{status:404});
  return {integrity:{verified:accepted},artifacts:[{path:relative,sha256:sha(contents)}]};
 };
 const f=await fixture(t,{geospatialJobs:{result:result(geo,mapPath,map)},orbit42Jobs:{result:result(orbit,trackPath,track)}});owner=f.project.id;
 await f.put(mapPath,map);await f.put(trackPath,track);
 assert.deepEqual(await f.viewer.resolve({projectId:owner,path:mapPath}),{kind:'file',path:mapPath});
 const opened=await f.viewer.read({projectId:owner,path:mapPath});assert.equal(opened.mime,'application/geo+json');assert.equal(opened.sha256,sha(map));assert.equal(opened.editable,false);
 const csv=await f.viewer.read({projectId:owner,path:trackPath});assert.equal(csv.type,'csv');assert.equal(csv.editable,false);
 await assert.rejects(f.viewer.save({projectId:owner,path:mapPath,expectedSha256:opened.sha256,content:'{}'}),e=>e.status===403);
 const foreign=f.store.createProject({name:'Foreign'}),original=f.store.workspace.bind(f.store);f.store.workspace=id=>id===foreign.id?f.workspace:original(id);
 await assert.rejects(f.viewer.read({projectId:foreign.id,path:mapPath}),/does not belong/);
 accepted=false;await assert.rejects(f.viewer.read({projectId:owner,path:mapPath}),e=>e.status===409);
 accepted=true;await f.put(mapPath,'{"type":"FeatureCollection","features":[1]}');await assert.rejects(f.viewer.read({projectId:owner,path:mapPath}),e=>e.status===409);
 await f.put(`engineering/geospatial/${geo}/outputs/unknown.geojson`,map);await assert.rejects(f.viewer.read({projectId:owner,path:`engineering/geospatial/${geo}/outputs/unknown.geojson`}),e=>e.status===403);
});


test('Library discovers nested native SysML through the bounded professional index while keeping viewer path restrictions', async t => {
  const f=await fixture(t,{professionalModels:{async listModels(){return {models:[{path:'stf-engineering/models/STFSystem.sysml'},{path:'.manta/private.sysml'},{path:'../private.sysml'},{path:'models/missing.sysml'}],truncated:false};}}});
  await f.put('stf-engineering/models/STFSystem.sysml','package STF {}');
  await f.put('.manta/private.sysml','package Private {}');
  const result=await f.viewer.list({projectId:f.project.id});
  assert.deepEqual(result.discovered.models.map(item=>item.path),['stf-engineering/models/STFSystem.sysml']);
  assert.equal((await f.viewer.read({projectId:f.project.id,path:result.discovered.models[0].path})).type,'sysml');
});

test('human text saves use exact hashes, preserve old bytes and permissions, and never rewrite the recorded artifact receipt',async t=>{
 const f=await fixture(t),projectId=f.project.id,relative='artifacts/source-report.md';await f.put(relative,'# Original engineering report\n');
 const artifact={id:'artifact-original',projectId,path:relative,name:'工程报告',runId:'run-original',sha256:sha('# Original engineering report\n'),content:'Recorded original cached content',createdAt:'2026-10-23T00:00:00Z'};f.store.add('artifacts',artifact);
 const opened=await f.viewer.read({projectId,path:relative});assert.equal(opened.editable,true);
 const saved=await f.viewer.save({projectId,path:relative,expectedSha256:opened.sha256,content:'# Human revision\n'});assert.equal(saved.saved,true);assert.equal(saved.sha256,sha('# Human revision\n'));assert.equal(saved.revision.actor.kind,'user');assert.equal(saved.revision.reviewApplicability,'not-revalidated');assert.equal(saved.registeredArtifact.receiptUnchanged,true);
 assert.equal(artifact.runId,'run-original');assert.equal(artifact.sha256,opened.sha256);assert.equal(artifact.content,'Recorded original cached content');assert.equal(artifact.workingFileRevision.sha256,saved.sha256);
 const previous=await f.viewer.history({projectId,editId:saved.editId});assert.equal(previous.content,opened.content);assert.equal(previous.editable,false);assert.equal(previous.sha256,opened.sha256);
 const other=f.store.createProject({name:'Other'});await assert.rejects(f.viewer.history({projectId:other.id,editId:saved.editId}),e=>e.status===404);
 const event=f.store.data.events.find(e=>e.type==='workspace.file.updated');assert.equal(event.data.actor.kind,'user');assert.equal(event.data.previousSha256,opened.sha256);assert.equal(event.data.sha256,saved.sha256);
 const count=f.store.data.documentEdits.length;assert.equal((await f.viewer.save({projectId,path:relative,expectedSha256:saved.sha256,content:saved.content})).noChanges,true);assert.equal(f.store.data.documentEdits.length,count);
 await f.put('scripts/run.sh','#!/bin/sh\ntrue\n');await fs.chmod(path.join(f.workspace,'scripts/run.sh'),0o751);const script=await f.viewer.read({projectId,path:'scripts/run.sh'});await f.viewer.save({projectId,path:script.path,expectedSha256:script.sha256,content:'#!/bin/sh\nprintf updated\n'});assert.equal((await fs.stat(path.join(f.workspace,script.path))).mode&0o777,0o751);
});

test('same physical folder saves serialize across projects and stale drafts cannot overwrite a newer revision',async t=>{
 const f=await fixture(t),folder=await fs.mkdtemp(path.join(os.tmpdir(),'manta-shared-document-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 const one=f.store.createProject({name:'Shared one',folderPath:folder}),two=f.store.createProject({name:'Shared two',folderPath:folder});await fs.writeFile(path.join(folder,'report.md'),'before');
 const hash=sha('before'),results=await Promise.allSettled([f.viewer.save({projectId:one.id,path:'report.md',expectedSha256:hash,content:'first'}),f.viewer.save({projectId:two.id,path:'report.md',expectedSha256:hash,content:'second'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);assert.equal(await fs.readFile(path.join(folder,'report.md'),'utf8'),'first');assert.equal(f.store.data.documentEdits.length,1);
 await assert.rejects(f.viewer.save({projectId:one.id,path:'report.md',expectedSha256:hash,content:'stale'}),e=>e.status===409);assert.equal(await fs.readFile(path.join(folder,'report.md'),'utf8'),'first');
});

test('recorded engineering evidence, native models, hidden paths, symlinks and oversized text remain uneditable',async t=>{
 const f=await fixture(t),projectId=f.project.id;
 const protectedFiles=['engineering/nos3/nos3_'+ 'a'.repeat(32)+'/result.json','engineering/professional/professional_'+ 'b'.repeat(32)+'/report.md','engineering/eng_'+ 'c'.repeat(32)+'/series.csv','.manta/model-evidence/a.sysml','models/a.sysml','models/plant.mo','models/test.stf.json'];
 for(const relative of protectedFiles){await f.put(relative,'{}');const file=await f.viewer.read({projectId,path:relative});assert.equal(file.editable,false,relative);await assert.rejects(f.viewer.save({projectId,path:relative,expectedSha256:sha('{}'),content:'tamper'}),e=>e.status===403);assert.equal(await fs.readFile(path.join(f.workspace,relative),'utf8'),'{}');}
 await f.put('report.md','safe');await f.put('.env','SECRET');await fs.symlink(f.directory,path.join(f.workspace,'escape'));await fs.symlink(path.join(f.workspace,'report.md'),path.join(f.workspace,'alias.md'));
 for(const relative of ['../outside.md','.env','escape/file.md','alias.md'])await assert.rejects(f.viewer.save({projectId,path:relative,expectedSha256:sha('safe'),content:'blocked'}),/path|workspace|configuration|Credential|Symbolic/i);
 await assert.rejects(f.viewer.save({projectId,path:'report.md',expectedSha256:'bad',content:'blocked'}),/SHA256/);await assert.rejects(f.viewer.save({projectId,path:'report.md',expectedSha256:sha('safe'),content:'a'.repeat(500001)}),e=>e.status===413);assert.equal(await fs.readFile(path.join(f.workspace,'report.md'),'utf8'),'safe');assert.equal(f.store.data.documentEdits.length,0);
});

test('real HTTP contextual save enforces CAS, JSON mutation boundary and protected evidence',async t=>{
 const f=await fixture(t);await f.put('report.md','before');await f.put('engineering/professional/professional_'+ 'd'.repeat(32)+'/result.json','{}');
 const {createStudioServer}=await import('../server/index.mjs'),app=await createStudioServer({store:f.store,dataDir:f.store.dataDir,seed:false,computer:false,evaluator:false,engineering:false,engineeringState:false,engineeringPlan:false,nos3:false,modelBackend:false,professionalModels:false,professionalRunner:false,connectors:false,stfCase:false});t.after(()=>app.close());const {port}=await app.listen({port:0}),base='http://127.0.0.1:'+port,route='/api/projects/'+f.project.id+'/workspace/file?path=report.md';
 const write=async(body,extra={})=>{const res=await fetch(base+route,{method:'PUT',headers:{'content-type':'application/json',...extra},body:JSON.stringify(body)});return {status:res.status,data:await res.json()};};
 const fresh=await (await fetch(base+route)).json();const saved=await write({expectedSha256:fresh.sha256,content:'after'});assert.equal(saved.status,200);assert.equal(saved.data.content,'after');assert.equal(saved.data.editable,true);
 assert.equal((await write({expectedSha256:fresh.sha256,content:'stale'})).status,409);assert.equal((await write({expectedSha256:saved.data.sha256,content:'cross-origin'},{origin:'https://example.test'})).status,403);
 const protectedRoute=base+'/api/projects/'+f.project.id+'/workspace/file?path='+encodeURIComponent('engineering/professional/professional_'+ 'd'.repeat(32)+'/result.json');assert.equal((await fetch(protectedRoute,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedSha256:sha('{}'),content:'tamper'})})).status,403);
 const history=await (await fetch(base+'/api/projects/'+f.project.id+'/workspace/file-history?editId='+saved.data.editId)).json();assert.equal(history.content,'before');assert.equal(history.editable,false);assert.equal(await fs.readFile(path.join(f.workspace,'report.md'),'utf8'),'after');
});

test('a post-commit state failure reports saved-with-warning and recovers human provenance and old bytes from the durable journal after restart',async t=>{
 const f=await fixture(t),projectId=f.project.id;await f.put('report.md','original');const opened=await f.viewer.read({projectId,path:'report.md'}),save=f.store.save;f.store.save=()=>{throw Error('State persistence unavailable');};
 const result=await f.viewer.save({projectId,path:'report.md',expectedSha256:opened.sha256,content:'saved human revision'});assert.equal(result.saved,true);assert.match(result.persistenceWarning,/文件已保存/);assert.equal(await fs.readFile(path.join(f.workspace,'report.md'),'utf8'),'saved human revision');f.store.save=save;
 const reopened=createStore({dataDir:f.store.dataDir,seed:false});assert.equal(reopened.data.documentEdits?.length||0,0,'The deliberately failed state save did not persist the edit index');const viewer=createWorkspaceViewer({store:reopened}),current=await viewer.read({projectId,path:'report.md'});assert.equal(current.revision.actor.kind,'user');assert.equal(current.revision.current,true);assert.equal(current.revision.persistence,'journal');assert.equal(current.revision.id,result.editId);const history=await viewer.history({projectId,editId:result.editId});assert.equal(history.content,'original');assert.equal(history.sha256,opened.sha256);
});
