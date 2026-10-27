import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStore,id,now} from '../server/store.mjs';

test('new conversations have exactly Coordinator and one thread level',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-flat-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=createStore({dataDir:path.join(root,'data'),seed:false});
  const project=store.createProject({name:'Flat engineering project'});
  const coordinator=store.get('threads',project.coordinatorThreadId);
  const worker=store.createThread(project.id,'Source review',coordinator.id);
  assert.equal(worker.parentThreadId,coordinator.id);
  assert.throws(()=>store.createThread(project.id,'Nested review',worker.id),/directly to the Coordinator/);
  assert.equal(store.data.threads.filter(row=>row.projectId===project.id).length,2);
});

test('historical nested threads become Coordinator peers without losing their chat or delivery',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-flat-legacy-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const dataDir=path.join(root,'data'),store=createStore({dataDir,seed:false});
  const project=store.createProject({name:'Existing engineering project'});
  const coordinator=store.get('threads',project.coordinatorThreadId);
  const parent=store.createThread(project.id,'Subsystem',coordinator.id);
  const leaf=store.createThread(project.id,'Sensor interface',coordinator.id);
  const userMessage=store.message(leaf.id,'user','Please inspect the sensor data path.');
  leaf.parentThreadId=parent.id;
  const run=store.add('runs',{id:id('run'),projectId:project.id,threadId:leaf.id,status:'completed',result:'Source-backed findings',finishedAt:now(),deferredToChildren:true});
  const oldReceipt=store.message(parent.id,'assistant','Sensor result',undefined,{type:'thread.result',metadata:{taskThreadId:leaf.id,runId:run.id,summaryStatus:'pending'}});
  store.save();
  const restored=createStore({dataDir,seed:false});
  assert.equal(restored.get('threads',leaf.id).parentThreadId,coordinator.id);
  assert.equal(restored.get('threads',leaf.id).legacyParentThreadId,parent.id);
  assert.equal(restored.get('messages',userMessage.id).content,userMessage.content);
  assert.equal(restored.get('messages',oldReceipt.id).metadata.summaryStatus,'migrated');
  const delivery=restored.data.messages.find(row=>row.threadId===coordinator.id&&row.type==='thread.result'&&row.metadata?.runId===run.id);
  assert.equal(delivery?.metadata.summaryStatus,'migrated');
  assert.equal(delivery?.metadata.legacyParentThreadId,parent.id);
  assert.equal(restored.get('runs',run.id).deferredToChildren,false);
  const again=createStore({dataDir,seed:false});
  assert.equal(again.data.messages.filter(row=>row.threadId===coordinator.id&&row.type==='thread.result'&&row.metadata?.runId===run.id).length,1);
});
