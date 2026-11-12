import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createStore}from '../server/store.mjs';
import {createModelBackendService}from '../server/model-backend.mjs';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const SIMPLE='package Demo { private import ScalarValues::*; part def Vehicle { attribute mass : Real = 1500.0; } part car : Vehicle; }';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'daidalis-model-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const store=createStore({dataDir:path.join(root,'data'),seed:false});const project=store.createProject({name:'Real SysML test'});const service=await createModelBackendService({store,dataDir:path.join(root,'backend')});return {root,store,service,projectId:project.id,workspace:store.workspace(project.id)};}

test('an explicit model source root resolves sibling packages and records the complete source revision',async t=>{
  const f=await fixture(t);
  await fs.mkdir(path.join(f.workspace,'models/mission/parts'),{recursive:true});
  await fs.writeFile(path.join(f.workspace,'models/mission/root.sysml'),'package Mission { private import Components::*; part vehicle : Vehicle; }');
  await fs.writeFile(path.join(f.workspace,'models/mission/parts/components.sysml'),'package Components { part def Vehicle; }');
  await fs.writeFile(path.join(f.workspace,'models/unrelated.sysml'),'package Components { part def Vehicle; }');
  const args={projectId:f.projectId,path:'models/mission/root.sysml'};
  assert.equal((await f.service.query(args)).valid,false);
  const result=await f.service.query({...args,sourceRoot:'models/mission'});
  assert.equal(result.valid,true,JSON.stringify(result.findings));
  assert.deepEqual(result.model.sourceSet.files.map(file=>file.path),['models/mission/parts/components.sysml','models/mission/root.sysml']);
  assert.equal(result.model.sourceSet.root,'models/mission');
  assert.match(result.model.sourceSet.sha256,/^[a-f0-9]{64}$/);
  assert.ok(result.data.nodes.some(node=>node.file==='models/mission/parts/components.sysml'&&node.label==='Vehicle'));
  const validation=await f.service.validate({...args,sourceRoot:'models/mission',expectedSourceSetHash:result.model.sourceSet.sha256});
  assert.equal(validation.valid,true);
  const receipt=JSON.parse(await fs.readFile(path.join(f.workspace,validation.evidence.path),'utf8'));
  assert.deepEqual(receipt.model.sourceSet,result.model.sourceSet);
  const verification=await f.service.verify({...args,sourceRoot:'models/mission',expectedSourceSetHash:result.model.sourceSet.sha256});
  assert.equal(verification.valid,true);
  assert.deepEqual(verification.model.sourceSet,result.model.sourceSet);
  const exported=await f.service.exportModel({...args,sourceRoot:'models/mission',format:'compact-json'});
  assert.match(exported.content,/Vehicle/);
  assert.deepEqual(exported.model.sourceSet,result.model.sourceSet);
  await fs.writeFile(path.join(f.workspace,'models/mission/parts/components.sysml'),'package Components { part def Renamed; }');
  await assert.rejects(f.service.validate({...args,sourceRoot:'models/mission',expectedSourceSetHash:result.model.sourceSet.sha256}),/source set revision conflict/i);
  assert.equal((await f.service.query({...args,sourceRoot:'models/mission'})).valid,false);
});

test('catalog reports pinned real WASM backend and explicit supported-rule limits without starting products',async t=>{const f=await fixture(t),r=await f.service.catalog({projectId:f.projectId});assert.equal(r.backend.available,true);assert.equal(r.backend.version,'0.10.10');assert.match(r.backend.archiveSha256,/^[a-f0-9]{64}$/);assert.equal(r.backend.isolated,true);assert.ok(r.limitations.some(s=>s.includes('not complete OMG')));assert.equal((await fs.readdir(f.workspace)).length,0);});

test('multi-source resolution preserves ambiguous and missing-reference diagnostics at their original file',async t=>{
  const f=await fixture(t);
  await fs.mkdir(path.join(f.workspace,'mission'),{recursive:true});
  await fs.writeFile(path.join(f.workspace,'mission/root.sysml'),'package Mission { private import A::*; private import B::*; part vehicle : Vehicle; }');
  await fs.writeFile(path.join(f.workspace,'mission/a.sysml'),'package A { part def Vehicle; }');
  await fs.writeFile(path.join(f.workspace,'mission/b.sysml'),'package B { part def Vehicle; }');
  const args={projectId:f.projectId,path:'mission/root.sysml',sourceRoot:'mission'};
  const ambiguous=await f.service.query(args);
  assert.equal(ambiguous.valid,false);
  assert.ok(ambiguous.findings.some(item=>item.unit==='mission/root.sysml'&&/ambiguous/.test(item.message)));
  await fs.rm(path.join(f.workspace,'mission/b.sysml'));
  const missing=await f.service.query(args);
  assert.equal(missing.valid,false);
  assert.ok(missing.findings.some(item=>item.unit==='mission/root.sysml'&&/unresolved reference `B`/.test(item.message)));
  await fs.writeFile(path.join(f.workspace,'mission/b.sysml'),'package A { part def Vehicle; }');
  await fs.writeFile(path.join(f.workspace,'mission/root.sysml'),'package Mission { private import A::*; part vehicle : Vehicle; }');
  const duplicate=await f.service.query(args);
  assert.equal(duplicate.valid,false);
  assert.ok(duplicate.findings.some(item=>item.stage==='referential'));
});

test('source roots reject traversal, unrelated entries, symlinks and oversized source collections',async t=>{
  const f=await fixture(t);
  await fs.mkdir(path.join(f.workspace,'mission'));
  await fs.writeFile(path.join(f.workspace,'mission/root.sysml'),'package Mission {}');
  const args={projectId:f.projectId,path:'mission/root.sysml'};
  for(const sourceRoot of ['../','/etc','.git','other'])await assert.rejects(f.service.query({...args,sourceRoot}));
  await fs.symlink(f.root,path.join(f.workspace,'mission/linked'));
  await assert.rejects(f.service.query({...args,sourceRoot:'mission'}),/Symbolic links/);
  await fs.rm(path.join(f.workspace,'mission/linked'));
  await fs.writeFile(path.join(f.workspace,'mission/large.sysml'),Buffer.alloc(500001,32));
  await assert.rejects(f.service.query({...args,sourceRoot:'mission'}),/500000/);
  await fs.rm(path.join(f.workspace,'mission/large.sysml'));
  await Promise.all(Array.from({length:128},(_,index)=>fs.writeFile(path.join(f.workspace,`mission/extra-${index}.sysml`),'package Extra {}')));
  await assert.rejects(f.service.query({...args,sourceRoot:'mission'}),/128 files/);
});

test('real standard-library semantic import, query and full interchange export are source linked',async t=>{const f=await fixture(t);await fs.writeFile(path.join(f.workspace,'upstream.c'),'// upstream evidence\n');const args={projectId:f.projectId,path:'models/demo.sysml',content:SIMPLE,sources:[{path:'upstream.c',lineStart:1,lineEnd:1}]};const r=await f.service.importModel(args,{runId:'run-real'});assert.equal(r.valid,true);assert.equal(r.imported,true);assert.deepEqual(r.findings,[]);assert.ok(r.data.elementCount>5);assert.equal(r.model.sha256,hash(SIMPLE));const record=JSON.parse(await fs.readFile(path.join(f.workspace,r.evidence.path),'utf8'));assert.equal(record.sources[0].sha256,hash('// upstream evidence\n'));assert.equal(record.operation,'import');assert.equal(f.store.data.artifacts[0].runId,'run-real');
  const query=await f.service.query({...args,query:'Demo::Vehicle::mass'});assert.equal(query.data,1500);const exported=await f.service.exportModel({...args,format:'full-json'});const elements=JSON.parse(exported.content);assert.ok(elements.some(e=>e['@type']==='PartDefinition'));assert.match(exported.content,/14c0aa22-5489-59b5-b438-ded26e83ba31/,'Real resolves to the normative library ID');const text=await f.service.exportModel({...args,format:'sysml'});assert.equal(text.content,SIMPLE);
});

test('real parser rejects malformed source and keeps target absent',async t=>{const f=await fixture(t),r=await f.service.importModel({projectId:f.projectId,path:'bad.sysml',content:'package X { part def ;'});assert.equal(r.valid,false);assert.equal(r.imported,false);assert.ok(r.findings.some(x=>x.stage==='parse'));await assert.rejects(fs.access(path.join(f.workspace,'bad.sysml')));});

test('real reference resolver rejects missing types, rather than accepting a syntactically plausible graph',async t=>{const f=await fixture(t),r=await f.service.importModel({projectId:f.projectId,path:'bad.sysml',content:'package X { part p : MissingDefinition; }'});assert.equal(r.valid,false);assert.equal(r.imported,false);assert.ok(r.findings.some(x=>x.stage==='referential'));});

test('real semantic checks reject a part typed by an attribute definition',async t=>{const f=await fixture(t),r=await f.service.importModel({projectId:f.projectId,path:'bad.sysml',content:'package X { attribute def Data; part p : Data; }'});assert.equal(r.valid,false);assert.ok(r.findings.some(x=>x.stage==='semantic'));});

test('optimistic revision guard prevents overwrites and concurrent lost updates',async t=>{const f=await fixture(t),args={projectId:f.projectId,path:'model.sysml',content:SIMPLE};await f.service.importModel(args);await assert.rejects(f.service.importModel({...args,content:SIMPLE+'\n'}),/revision conflict/);const outcomes=await Promise.allSettled([f.service.importModel({...args,content:SIMPLE+'\n',expectedHash:hash(SIMPLE)}),f.service.importModel({...args,content:SIMPLE+'\n\n',expectedHash:hash(SIMPLE)})]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.filter(r=>r.status==='rejected').length,1);});

test('invalid replacement preserves previously accepted source',async t=>{const f=await fixture(t),args={projectId:f.projectId,path:'model.sysml',content:SIMPLE};await f.service.importModel(args);const r=await f.service.importModel({...args,content:'package X { part p : Missing; }',expectedHash:hash(SIMPLE)});assert.equal(r.imported,false);assert.equal(await fs.readFile(path.join(f.workspace,args.path),'utf8'),SIMPLE);});

test('NOS3 fixture is a real semantically checked reconstruction and does not claim full simulation',async t=>{const f=await fixture(t),r=await f.service.generateNos3Model({projectId:f.projectId});assert.equal(r.valid,true);assert.equal(r.imported,true);assert.equal(r.upstreamEvidence,false);assert.match(r.origin,/not a NASA-issued/);assert.ok(r.requirementIds.includes('R-SENSOR-SEPARATION'));const q=await f.service.query({projectId:f.projectId,path:r.model.path,query:'NOS3AttitudeInterface::numericalTolerance'});assert.equal(q.data,1e-8);const verification=await f.service.verify({projectId:f.projectId,path:r.model.path});assert.match(verification.verificationScope,/no behavior\/simulation execution/);assert.ok(verification.data.summary.undecided>=1);assert.ok(verification.evidence.path);});

test('model validation records the exact current model revision and respects caller expectedHash',async t=>{const f=await fixture(t),args={projectId:f.projectId,path:'model.sysml',content:SIMPLE};await f.service.importModel(args);await fs.writeFile(path.join(f.workspace,args.path),SIMPLE+'\n');await assert.rejects(f.service.validate({...args,expectedHash:hash(SIMPLE)}),/revision conflict/);const r=await f.service.validate(args);assert.equal(r.valid,true);assert.equal(r.model.sha256,hash(SIMPLE+'\n'));assert.ok(r.evidence.path);});

test('model and evidence paths never escape project or follow symbolic links',async t=>{const f=await fixture(t);await assert.rejects(f.service.importModel({projectId:f.projectId,path:'../escape.sysml',content:SIMPLE}),/escapes/);await fs.symlink(f.root,path.join(f.workspace,'outside'));await assert.rejects(f.service.importModel({projectId:f.projectId,path:'outside/escape.sysml',content:SIMPLE}),/Symbolic/);await assert.rejects(f.service.importModel({projectId:f.projectId,path:'model.sysml',content:SIMPLE,sources:[{path:'../source.c'}]}),/escapes/);});

test('source revision mismatches and cancellation fail before a model is accepted',async t=>{const f=await fixture(t);await fs.writeFile(path.join(f.workspace,'source.c'),'new');await assert.rejects(f.service.importModel({projectId:f.projectId,path:'model.sysml',content:SIMPLE,sources:[{path:'source.c',sha256:hash('old')}]}),/Source revision/);const controller=new AbortController();controller.abort();await assert.rejects(f.service.importModel({projectId:f.projectId,path:'model.sysml',content:SIMPLE},{signal:controller.signal}),/Cancelled/);});

test('missing or modified backend returns unavailable and never substitutes a regex check',async t=>{const f=await fixture(t),bad=await createModelBackendService({store:f.store,runtimePath:path.join(f.root,'missing/package')});assert.equal((await bad.catalog()).backend.available,false);await assert.rejects(bad.importModel({projectId:f.projectId,path:'model.sysml',content:SIMPLE}),/unavailable/);await assert.rejects(fs.access(path.join(f.workspace,'model.sysml')));});

test('recorded NOS3 result values bind to the exact model revision and produce real static constraint verdicts',async t=>{
  const f=await fixture(t),model=await f.service.generateNos3Model({projectId:f.projectId});
  const result={status:'completed',scope:'component',fullNos3Simulation:false,modelBehaviorExecuted:false,modelEvidence:[{path:model.model.path,sha256:model.model.sha256}],metrics:{cases:324,tolerance:1e-12,compositionMaxError:4.44e-16,signMaxError:0,inverseMaxError:6.66e-16},pendingRequirements:[{id:'R-SENSOR-SEPARATION',status:'not-tested'}]};
  await fs.writeFile(path.join(f.workspace,'result.json'),JSON.stringify(result));
  const bound=await f.service.bindNos3Results({projectId:f.projectId,path:model.model.path,resultPath:'result.json',expectedHash:model.model.sha256});
  assert.equal(bound.bound,true);assert.equal(bound.valid,true);assert.equal(bound.previousModelSha256,model.model.sha256);assert.notEqual(bound.model.sha256,model.model.sha256);assert.ok(bound.data.summary.satisfied>=3);assert.ok(bound.data.summary.undecided>=1);assert.equal(bound.pendingRequirements[0].status,'not-tested');assert.match(bound.measurementScope,/no full simulation/);
  await assert.rejects(f.service.bindNos3Results({projectId:f.projectId,path:model.model.path,resultPath:'result.json',expectedHash:bound.model.sha256}),/exact model revision/);
});

test('result binding preserves measured violations instead of converting successful process exit to requirements passed',async t=>{
  const f=await fixture(t),model=await f.service.generateNos3Model({projectId:f.projectId});
  const result={status:'failed',scope:'component',fullNos3Simulation:false,modelBehaviorExecuted:false,modelEvidence:[{path:model.model.path,sha256:model.model.sha256}],metrics:{cases:12,tolerance:1e-12,compositionMaxError:1e-12,signMaxError:0,inverseMaxError:0},pendingRequirements:[{id:'R-SENSOR-SEPARATION',status:'not-tested'}]};
  await fs.writeFile(path.join(f.workspace,'result.json'),JSON.stringify(result));const bound=await f.service.bindNos3Results({projectId:f.projectId,path:model.model.path,resultPath:'result.json',expectedHash:model.model.sha256});assert.equal(bound.valid,true);assert.ok(bound.data.summary.violated>=1);assert.ok(bound.data.constraints.some(c=>c.status==='violated'));
});

test('a rewritten runtime manifest is rejected before any kernel is loaded',async t=>{const f=await fixture(t),tool=path.join(f.root,'tampered-toolchain');await fs.mkdir(path.join(tool,'package'),{recursive:true});const manifest=JSON.parse(await fs.readFile(new URL('../toolchains/sysml/manifest.json',import.meta.url),'utf8'));manifest.archiveSha256='0'.repeat(64);await fs.writeFile(path.join(tool,'manifest.json'),JSON.stringify(manifest));const altered=await createModelBackendService({store:f.store,runtimePath:path.join(tool,'package')});const catalog=await altered.catalog();assert.equal(catalog.backend.available,false);assert.match(catalog.backend.detail,/manifest integrity/);});

test('binding rechecks a protected result receipt at its own read boundary',async t=>{const f=await fixture(t),model=await f.service.generateNos3Model({projectId:f.projectId});await fs.writeFile(path.join(f.workspace,'result.json'),'{}');await assert.rejects(f.service.bindNos3Results({projectId:f.projectId,path:model.model.path,expectedHash:model.model.sha256,resultPath:'result.json',expectedResultHash:'0'.repeat(64)}),/integrity receipt changed/);assert.equal(await fs.readFile(path.join(f.workspace,model.model.path),'utf8'),await fs.readFile(new URL('../server/model-backend/nos3.sysml',import.meta.url),'utf8'));});

test('native live integration measurements bind to a distinct model with negative controls and preserve untested requirements',async t=>{
  const f=await fixture(t),model=await f.service.generateNos3Model({projectId:f.projectId,path:'live.sysml',scope:'integration'});
  assert.equal(model.imported,true,JSON.stringify(model.findings));assert.equal(model.requirementIds.includes('R-INVALID'),true);
  const result={status:'completed',scope:'integration',fullNos3Simulation:true,hardwareValidation:false,modelBehaviorExecuted:false,passed:true,
    modelEvidence:[{path:model.model.path,sha256:model.model.sha256}],
    metrics:{fixedAdcsRotationErrorDeg:.001,fixedGncRotationErrorDeg:.002,negativeSignGncRotationErrorDeg:.001,faultBounds:{rotationToleranceDeg:.02},negativeControls:{originalDoubleMountDefect:true,quaternionSign:true,invalidMeasurement:true}},
    checks:[{id:'fixed',criterion:'fixture live check',passed:true},{id:'biased-input',criterion:'sensor perturbation follows measurement',passed:true}],pendingRequirements:[{id:'R-HARDWARE',status:'not-tested'}]};
  const body=JSON.stringify(result);await fs.writeFile(path.join(f.workspace,'live-result.json'),body);
  const bound=await f.service.bindNos3Results({projectId:f.projectId,path:model.model.path,resultPath:'live-result.json',expectedHash:model.model.sha256,expectedResultHash:hash(body)});
  assert.equal(bound.bound,true,JSON.stringify(bound.findings));assert.ok(bound.data.summary.satisfied>=7);assert.equal(bound.data.summary.violated,0);assert.equal(bound.pendingRequirements[0].id,'R-HARDWARE');
});

test('live binding rejects absent data, preserves failed constraints and cannot imply sensor/truth separation without its negative control',async t=>{
  const f=await fixture(t),model=await f.service.generateNos3Model({projectId:f.projectId,path:'live.sysml',scope:'integration'});
  const result={status:'failed',scope:'integration',fullNos3Simulation:true,hardwareValidation:false,modelBehaviorExecuted:false,passed:false,
    modelEvidence:[{path:model.model.path,sha256:model.model.sha256}],metrics:{fixedAdcsRotationErrorDeg:10,fixedGncRotationErrorDeg:.002,negativeSignGncRotationErrorDeg:null,faultBounds:{rotationToleranceDeg:.02},negativeControls:{originalDoubleMountDefect:true,quaternionSign:true,invalidMeasurement:false}},checks:[{id:'invalid',criterion:'actual invalid check',passed:false}]};
  await fs.writeFile(path.join(f.workspace,'live-result.json'),JSON.stringify(result));
  const args={projectId:f.projectId,path:model.model.path,resultPath:'live-result.json',expectedHash:model.model.sha256};
  await assert.rejects(f.service.bindNos3Results(args),/Invalid live NOS3 metric/);
  result.metrics.negativeSignGncRotationErrorDeg=0;await fs.writeFile(path.join(f.workspace,'live-result.json'),JSON.stringify(result));
  const bound=await f.service.bindNos3Results(args);assert.equal(bound.bound,true);assert.ok(bound.data.summary.violated>=2);assert.ok(bound.pendingRequirements.some(x=>x.id==='R-SENSOR-SEPARATION'));
});
