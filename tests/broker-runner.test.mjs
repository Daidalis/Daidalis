import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createBrokerRunner} from '../server/broker-runner.mjs';

test('broker runner rejects unmanaged roots and symlink escapes before transport',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'broker-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'project-one'));
  await fs.symlink('/tmp',path.join(root,'project-escape'));
  const calls=[];
  const runner=createBrokerRunner({socketPath:'/fake.sock',projectsRoot:root,transport:async(...args)=>{calls.push(args);return {code:0};}});
  await assert.rejects(runner.command({workspace:root,command:'true'}),/managed project/);
  await assert.rejects(runner.command({workspace:path.join(root,'project-escape'),command:'true'}),/managed project/);
  assert.equal(calls.length,0);
  await runner.command({workspace:path.join(root,'project-one'),command:'true'});
  assert.deepEqual(calls[0].slice(0,3),['/fake.sock','/task',{kind:'command',project:'project-one',command:'true',timeoutMs:30000}]);
});

test('unavailable broker stays unavailable; no shared runner fallback',async()=>{
  const runner=createBrokerRunner({socketPath:'/missing.sock',transport:async()=>{throw Error('offline');}});
  assert.equal((await runner.status()).available,false);
  await assert.rejects(runner.prepare(),/offline/);
  await assert.rejects(runner.run({toolId:'ngspice'}),/offline/);
});

test('concurrent status checks share one probe and respect an unready response',async()=>{
  let probes=0,finish;
  const runner=createBrokerRunner({socketPath:'/fake.sock',transport:()=>{probes++;return new Promise(resolve=>{finish=resolve;});}});
  const pending=Array.from({length:8},()=>runner.status());
  assert.equal(probes,1);
  finish({ready:false,reason:'Tool image unavailable'});
  const results=await Promise.all(pending);
  assert.ok(results.every(r=>r.ready===false&&r.isolated===false&&r.status==='unavailable'));
  assert.equal((await runner.status()).reason,'Tool image unavailable');assert.equal(probes,1);
});

test('disabled services are not offered to the model, while capability discovery remains',async()=>{
  const {createToolRuntime}=await import('../server/tools.mjs');
  const runtime=createToolRuntime({hideUnavailableTools:true,store:{workspace(){throw Error('Must not access a project');}},emit:()=>{}});
  const names=new Set(runtime.definitions.map(t=>t.name));
  for(const name of ['computer_use','run_engineering_model','get_engineering_run','call_external_tool','submit_nos3_job','bind_nos3_results']){
    assert.equal(names.has(name),false,name);
    await assert.rejects(runtime.execute(name,{},{}),/Tool unavailable/);
  }
  assert.equal(names.has('engineering_catalog'),true);
  assert.equal(names.has('run_command'),true);
});
