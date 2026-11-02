import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {runContainerProcess} from '../server/container-process.mjs';
import {createGeospatialContainerRunner} from '../server/geospatial-container-runner.mjs';
import {createOrbit42ContainerRunner} from '../server/orbit42-container-runner.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const skip=process.platform!=='linux'||!existsSync('/.dockerenv')||process.getuid?.()===0;
test('real GDAL classifies interior, boundary and exterior and rejects changed source hashes',{skip:skip||!existsSync('/usr/bin/ogrinfo')},async t=>{
 const dir=await fs.mkdtemp('/tmp/gis-test-');t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const fixture=await runContainerProcess('/usr/bin/python3',['deploy/runner/gis-fixture.py',dir+'/square.zip'],{cwd:process.cwd()});assert.equal(fixture.code,0,fixture.stderr);
 const bytes=await fs.readFile(dir+'/square.zip'),runner=createGeospatialContainerRunner();t.after(()=>runner.close());
 const points=[{id:'inside',lon:1,lat:1,expected:'inside'},{id:'boundary',lon:0,lat:1,expected:'boundary'},{id:'outside',lon:3,lat:3,expected:'outside'}];
 const request={jobId:'geospatial_'+randomUUID().replaceAll('-',''),sourceBytes:bytes,sourceHash:sha(bytes),inputHash:sha(JSON.stringify(points)),expectedSourceEpsg:4326,featureIdField:'STATEFP',points};
 const result=await runner.run(request);assert.equal(result.success,true,result.diagnostics);assert.equal(result.verification.status,'passed');assert.deepEqual(result.verification.checks.map(c=>c.actual),['inside','boundary','outside']);assert.equal(result.receipt.sourceSha256,sha(bytes));assert.equal(result.toolchain.isolated,false);
 await assert.rejects(runner.run({...request,sourceHash:'0'.repeat(64)}),/hash/);
 const mismatch=await runner.run({...request,expectedSourceEpsg:4269});assert.equal(mismatch.success,false);assert.match(mismatch.diagnostics,/CRS/);
});
export const orbitModel={schema:'manta-orbit42-v1',source:{repository:'nasa-itc/42',revision:'dev_20260403'},scenario:{epochUtc:'2024-08-04T00:00:00Z',leapSeconds:37,periapsisAltitudeKm:400,apoapsisAltitudeKm:400,inclinationDeg:52,raanDeg:0,argumentOfPeriapsisDeg:0,trueAnomalyDeg:20,durationSeconds:60,stepSeconds:.1,outputIntervalSeconds:10},assumptions:['Analytic acceptance scenario only']};
test('real NASA 42 produces native trajectory with verified asset and build receipts',{skip:skip||!existsSync('/opt/orbit42/build.json'),timeout:120000},async()=>{
 const runner=createOrbit42ContainerRunner(),ready=await runner.status();assert.equal(ready.ready,true,ready.reason);
 const content=JSON.stringify(orbitModel),hash=sha(content),request={jobId:'orbit42_'+randomUUID().replaceAll('-',''),inputHash:hash,sourceFile:{path:'models/test.orbit42.json',content,sha256:hash}};
 const result=await runner.run(request);assert.equal(result.success,true,result.diagnostics);assert.equal(result.receipt.tool.binarySha256,ready.tool.binarySha256);assert.equal(result.receipt.assets.fileCount,220);assert.ok(result.metrics.samples>=2);assert.ok(result.metrics.checks.every(c=>c.passed));assert.ok(result.files.some(f=>f.path==='PosW.42'));
 const bad=await runner.run({...request,inputHash:'0'.repeat(64)});assert.equal(bad.success,false);assert.match(bad.diagnostics,/hash mismatch/);
});
