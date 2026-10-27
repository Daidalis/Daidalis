import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createGeospatialRunner} from '../server/geospatial-runner.mjs';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
async function fixture(t,initialReason){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-geo-runner-'));
  await fs.mkdir(path.join(root,'host'));await fs.mkdir(path.join(root,'worker'));
  for(const name of ['vm-exec.sh','vm-status.sh'])await fs.writeFile(path.join(root,'host',name),'#!/bin/sh\n');
  for(const name of ['geospatial-run.py','geospatial-status.py','prepare-geospatial.sh','provision-worker.sh','prepare-native.sh'])await fs.writeFile(path.join(root,'worker',name),name+' fixture\n');
  let reason=initialReason,stageCount=0,prepareCount=0;
  const calls=[];
  const execute=async(_file,args,options={})=>{
    const command=args[1]||'';calls.push({helper:path.basename(args[0]),command,input:options.input});
    if(path.basename(args[0])==='vm-status.sh')return {code:0,stdout:JSON.stringify({state:'running'}),stderr:''};
    if(command.startsWith('if test ! -f /srv/manta/geospatial-worker/geospatial-status.py'))return {code:0,stdout:JSON.stringify(reason?{ready:false,reason}:{ready:true,workerSha256:hash(await fs.readFile(path.join(root,'worker','geospatial-run.py'))),versions:{gdal:'fixture',proj:'fixture'},receiptSha256:hash('receipt')}),stderr:''};
    if(command.startsWith('sudo install -d -o manta')){
      stageCount++;
      const digest=command.match(/cut -d ' ' -f 1\)" = ([a-f0-9]{64})/)[1];
      assert.equal(hash(options.input),digest);
      return {code:0,stdout:digest,stderr:''};
    }
    if(command==='bash /srv/manta/geospatial-worker/prepare-geospatial.sh'){prepareCount++;reason=null;return {code:0,stdout:'prepared',stderr:''};}
    throw Error('Unexpected guest operation: '+command);
  };
  const runner=createGeospatialRunner({vmRoot:root,execute,hostPlatform:'darwin',hostArch:'arm64'});
  t.after(async()=>{await runner.close();await fs.rm(root,{recursive:true,force:true});});
  return {runner,calls,get stageCount(){return stageCount;},get prepareCount(){return prepareCount;}};
}
test('GIS catalog readiness is read-only and does not stage scripts or install packages',async t=>{
  const f=await fixture(t,'Geospatial status script absent');
  const status=await f.runner.status();
  assert.equal(status.ready,false);assert.equal(status.status,'not-prepared');assert.equal(f.stageCount,0);assert.equal(f.prepareCount,0);
  assert.equal(f.calls.filter(c=>c.helper==='vm-exec.sh').length,1);
});
test('explicit prepare permits a reviewed worker upgrade, stages verified guest-local scripts, then rechecks readiness',async t=>{
  const f=await fixture(t,'Reviewed managed worker update available');
  const ready=await f.runner.prepare();
  assert.equal(ready.ready,true);assert.equal(f.stageCount,3);assert.equal(f.prepareCount,1);
  assert.equal((await f.runner.status()).ready,true);assert.equal(f.stageCount,3);
});
test('interrupted first preparation may restage a changed status script only before any readiness receipt exists',async t=>{
  const f=await fixture(t,'Geospatial status script update available before readiness receipt');
  assert.equal((await f.runner.status()).status,'update-available');
  assert.equal(f.stageCount,0);
  const ready=await f.runner.prepare();
  assert.equal(ready.ready,true);assert.equal(f.stageCount,3);assert.equal(f.prepareCount,1);
  const blocked=await fixture(t,'Managed geospatial status script hash mismatch');
  await assert.rejects(blocked.runner.prepare(),/integrity check failed/);
  assert.equal(blocked.stageCount,0);assert.equal(blocked.prepareCount,0);
});
test('binary mismatch blocks re-preparation and leaves guest untouched',async t=>{
  const f=await fixture(t,'GDAL, PROJ or sandbox binary hash changed');
  await assert.rejects(f.runner.prepare(),/integrity check failed/);
  assert.equal(f.stageCount,0);assert.equal(f.prepareCount,0);
});
