import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createEngineeringService} from '../server/engineering.mjs';
import {createStore} from '../server/store.mjs';

const success={code:0,stdout:JSON.stringify({python:'3.13.1',scipy:'1.18.1',numpy:'2.5.4',matplotlib:'3.11.2'}),stderr:''};
async function fixture(t,probeExecutor){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-runtime-probe-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=createStore({dataDir:path.join(root,'data'),seed:false});
  const project=store.createProject({name:'Isolated runtime probe'});
  const service=await createEngineeringService({root,dataDir:path.join(root,'service'),store,pythonPath:process.execPath,professionalCatalog:()=>[],probeExecutor});
  return {root,service,store,project};
}
const scipy=async service=>(await service.catalog()).tools[0];

test('startup and catalog never launch imports; concurrent explicit probes share one isolated command',async t=>{
  let count=0,finish;
  const f=await fixture(t,async(command,args,options)=>{count++;assert.equal(command,process.execPath);assert.equal(args[0],'-I');assert.match(args[2],/sys\.path\.insert\(0,/);assert.equal(options.timeoutMs,120000);return new Promise(resolve=>{finish=resolve;});});
  assert.equal(count,0);assert.equal((await scipy(f.service)).status,'unverified');assert.equal((await scipy(f.service)).installed,null);assert.equal(count,0);
  const first=f.service.recheckRuntime(),second=f.service.catalog({recheck:true});
  assert.equal((await scipy(f.service)).status,'checking');assert.equal(count,1);
  finish(success);
  const [runtime,catalog]=await Promise.all([first,second]);
  assert.equal(runtime.available,true);assert.equal(catalog.tools[0].available,true);assert.equal(catalog.tools[0].installed,true);
  await f.service.catalog();assert.equal(count,1,'reading catalog reuses successful runtime evidence');
});

test('timeout remains retryable and distinct from missing dependencies; explicit recheck recovers',async t=>{
  let count=0;
  const f=await fixture(t,async()=>{if(++count===1)throw Error('Command timed out');return success;});
  await f.service.recheckRuntime();
  const timedOut=await scipy(f.service);
  assert.equal(timedOut.status,'timeout');assert.equal(timedOut.reasonCode,'probe-timeout');assert.equal(timedOut.installed,null);assert.equal(timedOut.retryable,true);
  const ready=await f.service.catalog({recheck:true});
  assert.equal(count,2);assert.equal(ready.tools[0].status,'available');assert.equal(ready.tools[0].available,true);assert.ok(ready.tools[0].lastSuccessfulAt);
});

test('run automatically retries a previous timeout after validating its inputs',async t=>{
  let count=0;
  const f=await fixture(t,async()=>{if(++count===1)throw Error('Command timed out');return {code:1,stdout:'',stderr:"ModuleNotFoundError: No module named 'scipy'"};});
  await f.service.recheckRuntime();
  await assert.rejects(f.service.run({projectId:f.project.id,model:'unsupported'}),/未知或未集成/);
  assert.equal(count,1,'invalid task must not probe');
  await assert.rejects(f.service.run({projectId:f.project.id}),/数值依赖未安装到当前隔离环境/);
  assert.equal(count,2,'valid task must retry instead of repeating stale timeout');
  const missing=await scipy(f.service);assert.equal(missing.status,'missing');assert.equal(missing.reasonCode,'missing-dependency');assert.equal(missing.installed,false);
  assert.equal(f.store.data.artifacts.length,0);
});

test('cancelling one caller does not abort or poison another caller sharing the runtime probe',async t=>{
  let count=0,finish;
  const f=await fixture(t,()=>{count++;return new Promise(resolve=>{finish=resolve;});});
  const controller=new AbortController();
  const cancelled=f.service.recheckRuntime({signal:controller.signal});
  const other=f.service.recheckRuntime();
  controller.abort();await assert.rejects(cancelled,/Cancelled/);assert.equal(count,1);
  finish(success);assert.equal((await other).available,true);assert.equal((await scipy(f.service)).available,true);
});

test('loader errors and malformed version responses are not reported as missing installation',async t=>{
  let count=0;
  const f=await fixture(t,async()=>++count===1?{code:1,stdout:'',stderr:'ImportError: dlopen failed on a network volume'}:{code:0,stdout:'{}',stderr:''});
  await f.service.recheckRuntime();assert.equal((await scipy(f.service)).status,'error');assert.equal((await scipy(f.service)).reasonCode,'import-failed');assert.equal((await scipy(f.service)).installed,null);
  await f.service.recheckRuntime();assert.equal((await scipy(f.service)).reasonCode,'probe-failed');assert.equal((await scipy(f.service)).available,false);
});

test('network-volume policy blocks local native imports without treating all external volumes as network disks',async()=>{
  const {dependencyLocationPolicy}=await import('../server/engineering.mjs');
  const readMounts=()=>'/dev/disk1 on / (apfs, local)\n//nas/share on /Volumes/NAS (smbfs, nodev, quarantine)\n/dev/disk9 on /Volumes/Local Disk (apfs, local)';
  const opts={platform:'darwin',resolvePath:x=>x,readMounts};
  assert.equal(dependencyLocationPolicy('/Volumes/NAS/deps',opts).reasonCode,'network-dependencies-blocked');
  assert.equal(dependencyLocationPolicy('/Volumes/Local Disk/deps',opts).blocked,false);
  assert.equal(dependencyLocationPolicy('/private/tmp/local-deps',opts).blocked,false);
  assert.equal(dependencyLocationPolicy('/Users/a/deps',{...opts,resolvePath:()=>'/Volumes/NAS/deps'}).blocked,true);
  assert.equal(dependencyLocationPolicy('/Volumes/Unknown/deps',{...opts,readMounts:()=>{throw Error('unavailable');}}).reasonCode,'dependency-location-unverified');
});

test('network dependencies remain blocked for explicit recheck and automatic run; no import subprocess starts',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-network-runtime-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=createStore({dataDir:path.join(root,'data'),seed:false}),project=store.createProject({name:'Network block test'});let imports=0;
  const service=await createEngineeringService({root,dataDir:path.join(root,'service'),store,pythonPath:process.execPath,professionalCatalog:()=>[],probeExecutor:async()=>{imports++;return success;},locationPolicy:()=>({blocked:true,kind:'network',fileSystem:'smbfs',reasonCode:'network-dependencies-blocked',detail:'网络磁盘依赖不在本机自动加载，请连接隔离执行环境。'})});
  assert.equal((await scipy(service)).status,'blocked');assert.equal((await scipy(service)).retryable,false);
  assert.equal((await service.recheckRuntime()).status,'blocked');assert.equal((await service.catalog({recheck:true})).tools[0].status,'blocked');
  await assert.rejects(service.run({projectId:project.id}),/网络磁盘依赖不在本机自动加载/);assert.equal(imports,0);
});
