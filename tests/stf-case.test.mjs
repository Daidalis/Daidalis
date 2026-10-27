import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {createStfCaseService} from '../server/stf-case.mjs';
const assets=process.env.STF_TEST_ASSETS||path.join(os.tmpdir(),'manta-optional-stf-assets-not-installed');
const assetTest=(name,fn)=>test(name,{skip:!process.env.STF_TEST_ASSETS?'Set STF_TEST_ASSETS to an explicitly configured reference fixture':false},fn);
const service=createStfCaseService({assetsRoot:assets});
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'manta-stf-case-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}

test('catalog describes two workflows without promoting engineering completion',()=>{const c=service.catalog();assert.deepEqual(c.cases.map(x=>x.variant),['from-zero','existing-change']);assert.equal(c.engineeringComplete,false);assert.ok(c.cases.every(x=>x.modelPath.endsWith('.mo')&&x.engineeringComplete===false));});

assetTest('clean-folder materialization includes native assets, six L0 and all 40 work packages',async t=>{const workspace=await fixture(t),r=await service.create({workspace});assert.equal(r.existing,false);assert.equal(r.engineeringComplete,false);assert.match(await fs.readFile(path.join(workspace,r.modelPath),'utf8'),/Modelica\.Thermal\.HeatTransfer/);const q=JSON.parse(await fs.readFile(path.join(workspace,'stf-engineering/engineering/requirements.json')));assert.equal(q.requirements.filter(x=>x.id.startsWith('L0-')).length,6);assert.ok(q.requirements.every(x=>x.verificationStatus!=='passed'));const w=JSON.parse(await fs.readFile(path.join(workspace,'stf-engineering/engineering/full-case-work-packages.json')));assert.equal(w.workPackages.length,40);const x=await fs.readFile(path.join(workspace,'stf-engineering/engineering/STF-requirements.reqif'),'utf8');assert.match(x,/SPEC-OBJECTS/);assert.match(x,/candidate-not-approved/);});

assetTest('same workflow is idempotent and preserves a user model edit',async t=>{const workspace=await fixture(t),r=await service.create({workspace});const p=path.join(workspace,r.modelPath);await fs.appendFile(p,'\n// user edit\n');const again=await service.create({workspace});assert.equal(again.existing,true);assert.match(await fs.readFile(p,'utf8'),/user edit/);await assert.rejects(service.create({workspace,variant:'existing-change'}),/another workflow/);});

test('existing arbitrary files are never overwritten or deleted',async t=>{
 const workspace=await fixture(t),fixtureAssets=await fixture(t);
 // A bounded safety fixture, independent of the optional engineering reference bundle.
 await fs.mkdir(path.join(fixtureAssets,'models'));
 await fs.writeFile(path.join(fixtureAssets,'models/STFResourceMission.mo'),'model Fixture end Fixture;');
 await fs.writeFile(path.join(fixtureAssets,'models/STFSystem.sysml'),'package Fixture {}');
 const localService=createStfCaseService({assetsRoot:fixtureAssets}),target=path.join(workspace,'stf-engineering');
 await fs.mkdir(target);await fs.writeFile(path.join(target,'personal.txt'),'keep');
 await assert.rejects(localService.create({workspace}),/not be overwritten/);
 assert.equal(await fs.readFile(path.join(target,'personal.txt'),'utf8'),'keep');
});

test('namespace symlink cannot redirect the materializer into another directory',async t=>{const workspace=await fixture(t),external=await fixture(t);await fs.symlink(external,path.join(workspace,'stf-engineering'));await assert.rejects(service.create({workspace}),/symbolic link/);assert.deepEqual(await fs.readdir(external),[]);});

assetTest('existing-change assets retain exact original and changed cFS hashes',async t=>{const workspace=await fixture(t);await service.create({workspace,variant:'existing-change'});const change=JSON.parse(await fs.readFile(path.join(workspace,'stf-engineering/change-low-power/change.json')));for(const f of change.files){for(const [kind,expected] of [['original',f.originalSha256],['modified',f.modifiedSha256]]){if(expected===null)continue;const bytes=await fs.readFile(path.join(workspace,'stf-engineering/change-low-power',kind,f.path));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),expected);}}assert.equal(change.voltageMapping.thresholdRawMilliVolt,23760);assert.equal(change.integrationStatus,'not-yet-executed');});

assetTest('actual packet analysis preserves failures while checking all seven scenario expectations',async t=>{const workspace=await fixture(t);await service.create({workspace});const r=await service.verify({workspace});assert.equal(r.status,'completed');assert.equal(r.engineeringComplete,false);assert.equal(r.nativeModelicaExecuted,false);assert.equal(r.nativeNos3Executed,false);assert.equal(r.results.length,7);assert.ok(r.results.every(x=>x.expectedBehaviorObserved));const by=Object.fromEntries(r.results.map(x=>[x.scenarioId,x]));assert.equal(by['no-contact-infeasible'].passed,false);assert.equal(by['insufficient-storage'].passed,false);assert.equal(by['low-power-unpatched'].passed,false);assert.equal(by['low-power-patched'].passed,true);assert.equal(by['nominal-contact-limited'].metrics.deliveredBits,2250000000);assert.equal(by['nominal-contact-limited'].metrics.generatedBits,by['nominal-contact-limited'].metrics.deliveredBits);assert.equal(by['low-power-unpatched'].metrics.minSOC,0);assert.ok(by['low-power-patched'].metrics.minSOC>.25);assert.equal(by['low-power-patched'].metrics.safeEntries,1);assert.match(await fs.readFile(path.join(workspace,r.reportPath),'utf8'),/失败/);assert.match(await fs.readFile(path.join(workspace,r.files.find(x=>x.endsWith('nominal-contact-limited.csv'))),'utf8'),/^time,soc,/);});

assetTest('modified user JavaScript is not loaded or executed on the host',async t=>{const workspace=await fixture(t);await service.create({workspace});await fs.writeFile(path.join(workspace,'stf-engineering/flight/mission.mjs'),'throw Error("UNTRUSTED EXECUTED");');await assert.rejects(service.verify({workspace}),/requires isolated execution/);});

assetTest('unknown scenarios are rejected before a reference run',async t=>{const workspace=await fixture(t);await service.create({workspace});await assert.rejects(service.verify({workspace,scenarioIds:['../escape']}),/Unknown STF scenario/);});

assetTest('reference controller bounds duration/drain and rejects unknown parameters',async()=>{const {simulateMission}=await import(new URL('file://'+assets+'/flight/mission.mjs'));assert.throws(()=>simulateMission({drainAfterScience:1e12}),/size/);assert.throws(()=>simulateMission({execute:'curl'}),/Unknown/);assert.throws(()=>simulateMission({step:0}),/Invalid/);});
