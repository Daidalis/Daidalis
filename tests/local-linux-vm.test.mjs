import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createLocalLinuxVmService,executeLocalVm} from '../server/local-linux-vm.mjs';

async function fixture(t,{running=true,provision,healthy=true,hostPlatform='darwin'}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-local-linux-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'host'));await fs.mkdir(path.join(root,'worker'));
  for(const name of ['vm-prepare.sh','vm-start.sh','vm-status.sh','vm-exec.sh','vm-tunnel.sh','vm-stop.sh'])await fs.writeFile(path.join(root,'host',name),'#!/bin/sh\n',{mode:0o755});
  await fs.writeFile(path.join(root,'worker','provision-worker.sh'),'#!/bin/bash\n# Fixture is never executed.\n');
  await fs.writeFile(path.join(root,'worker','prepare-native.sh'),'#!/bin/bash\n# Fixture is never executed.\n');
  const calls=[],events=[],handles=[];
  let token,health=healthy;
  const execute=async(file,args,options={})=>{const name=path.basename(file);calls.push({name,args,options});
    if(name==='vm-status.sh')return {code:0,stdout:JSON.stringify({state:running?'running':'stopped',guestReady:running,hostFreeBytes:9*1024**3}),stderr:''};
    if(name==='vm-stop.sh'){running=false;return {code:0,stdout:'{}',stderr:''};}
    if(name==='vm-exec.sh'&&args[0]==='cat /srv/manta/receipts/native-ready.json')return {code:0,stdout:JSON.stringify({schema:'manta-nos3-native-ready-v1',ready:true,inputHash:'1'.repeat(64),binaries:Array.from({length:4},(_,i)=>({path:'/fixture/bin/'+i,sha256:'2'.repeat(64)})),privateAssetCount:220}),stderr:''};
    if(name==='vm-exec.sh'&&args[0].endsWith('/provision-worker.sh')){token=JSON.parse(options.input).token;if(provision)await provision(options);return {code:0,stdout:'{"ready":true}',stderr:''};}
    if(options.persistent){if(name==='vm-start.sh')running=true;let resolve;const handle={pid:1200+handles.length,ended:false,exited:new Promise(r=>{resolve=r;}),kill(signal){this.ended=true;resolve({code:0,signal});}};handles.push(handle);return handle;}
    return {code:0,stdout:'',stderr:''};
  };
  const service=createLocalLinuxVmService({vmRoot:root,store:{workspace(id){if(!['p','q','r'].includes(id))throw Error('Unknown project');return '/fixture/'+id;}},execute,emit:event=>events.push(event),fetchImpl:async(url,options)=>{assert.match(url,/^http:\/\/127\.0\.0\.1:48123\/health$/);assert.equal(options.headers.authorization,'Bearer '+token);return new Response(JSON.stringify(health?{schema:'manta-nos3-worker-v1',scopes:{component:true,build:true,integration:true}}:{ok:true}));},allocatePort:async()=>48123,hostPlatform,hostArch:'arm64',pollIntervalMs:2,maxReadyMs:30});
  t.after(()=>service.close());
  return {root,service,calls,events,handles,setHealthy(value){health=value;}};
}

test('managed VM preparation reuses an existing VM and exposes only a private authenticated loopback connection',async t=>{
  const f=await fixture(t);const status=await f.service.prepare({projectId:'p'});
  assert.equal(status.state,'ready');assert.equal(status.workerReady,true);assert.equal(status.hostGlobalChanges,false);
  assert.equal(f.calls.some(c=>c.name==='vm-start.sh'||c.name==='vm-prepare.sh'),false);
  const native=f.calls.find(c=>c.name==='vm-exec.sh'&&c.args[0].endsWith('/prepare-native.sh'));
  assert.deepEqual(native.args,['bash /mnt/manta-transfer/worker/prepare-native.sh']);
  assert.equal(native.options.input,undefined);
  const provision=f.calls.find(c=>c.name==='vm-exec.sh'&&c.args[0].endsWith('/provision-worker.sh'));
  assert.ok(f.calls.indexOf(native)<f.calls.indexOf(provision));
  assert.deepEqual(provision.args,['bash /mnt/manta-transfer/worker/provision-worker.sh']);
  const input=JSON.parse(provision.options.input);assert.match(input.token,/^[a-f0-9]{64}$/);assert.equal(input.port,8093);
  const connection=await f.service.connection({projectId:'p'});assert.equal(connection.endpoint,'http://127.0.0.1:48123');assert.equal(connection.token,input.token);
  assert.equal(JSON.stringify(status).includes(input.token),false);assert.equal(JSON.stringify(f.events).includes(input.token),false);
  assert.equal((await fs.stat(path.join(f.root,'state','worker-token'))).mode&0o777,0o600);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.root,'state','native-ready.json'),'utf8')).ready,true);
  await assert.rejects(f.service.connection({projectId:'q'}),/Prepare this project/);
});

test('cold preparation uses only fixed application helpers and foreground VM ownership',async t=>{
  const f=await fixture(t,{running:false});await f.service.prepare({projectId:'p'});
  assert.equal(f.calls.filter(c=>c.name==='vm-prepare.sh').length,1);
  assert.deepEqual(f.calls.find(c=>c.name==='vm-start.sh').args,['--foreground']);
  assert.equal(f.calls.find(c=>c.name==='vm-start.sh').options.persistent,true);
  await f.service.stop({projectId:'p'});assert.equal((await f.service.status({projectId:'p'})).state,'stopped');
  assert.ok(f.handles.every(h=>h.ended));
});

test('concurrent callers share preparation; cancelling one caller does not cancel another or authorize the cancelled project',async t=>{
  let begin,release;const started=new Promise(r=>{begin=r;}),gate=new Promise(r=>{release=r;});
  const f=await fixture(t,{provision:async()=>{begin();await gate;}}),abort=new AbortController();
  const first=f.service.prepare({projectId:'p'},{signal:abort.signal});const second=f.service.prepare({projectId:'q'});
  await started;abort.abort();await assert.rejects(first,/abort/i);release();assert.equal((await second).state,'ready');
  assert.equal(f.calls.filter(c=>c.name==='vm-exec.sh'&&c.args[0].endsWith('/provision-worker.sh')).length,1);
  assert.equal(f.calls.filter(c=>c.name==='vm-exec.sh'&&c.args[0].endsWith('/prepare-native.sh')).length,1);
  await assert.rejects(f.service.connection({projectId:'p'}),/Prepare this project/);
  assert.ok((await f.service.connection({projectId:'q'})).token);
});

test('cancelling all preparation callers cancels work without stopping an existing VM',async t=>{
  let begin;const started=new Promise(r=>{begin=r;});const f=await fixture(t,{provision:options=>new Promise((resolve,reject)=>{begin();options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});})});
  const abort=new AbortController();const preparing=f.service.prepare({projectId:'p'},{signal:abort.signal});await started;abort.abort();await assert.rejects(preparing,/abort/i);
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal((await f.service.status({projectId:'p'})).state,'cancelled');
  assert.equal(f.calls.some(c=>c.name==='vm-stop.sh'),false);
});

test('cancelling a later preparation does not stop the VM established by an earlier successful preparation',async t=>{
  let calls=0,begin;const started=new Promise(r=>{begin=r;});
  const f=await fixture(t,{running:false,provision:options=>{if(++calls===1)return;return new Promise((resolve,reject)=>{begin();options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});}});
  await f.service.prepare({projectId:'p'});const vm=f.handles[0];assert.equal(vm.ended,false);f.setHealthy(false);
  const abort=new AbortController(),preparing=f.service.prepare({projectId:'q'},{signal:abort.signal});await started;abort.abort();await assert.rejects(preparing,/abort/i);
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(vm.ended,false);
});

test('an arbitrary HTTP success cannot claim a ready integration worker; secrets are redacted from failures',async t=>{
  const f=await fixture(t,{healthy:false});await assert.rejects(f.service.prepare({projectId:'p'}),/health check failed/);
  assert.equal((await f.service.status({projectId:'p'})).workerReady,false);
  const secret=(await fs.readFile(path.join(f.root,'state','worker-token'),'utf8')).trim();assert.equal(JSON.stringify(f.events).includes(secret),false);
  assert.ok(f.handles.every(h=>h.ended));
});

test('managed environment rejects project/command/endpoint injection and symbolic worker files before execution',async t=>{
  const f=await fixture(t);for(const args of [{projectId:'missing'},{projectId:'p',endpoint:'http://evil.invalid'},{projectId:'p',command:'touch /tmp/escape'},{projectId:'p',vmRoot:'/'}])await assert.rejects(f.service.prepare(args));
  assert.equal(f.calls.length,0);
  await fs.symlink('/etc/passwd',path.join(f.root,'worker','untrusted-link'));
  await assert.rejects(f.service.prepare({projectId:'p'}),/symbolic links/);
  assert.equal(f.calls.some(c=>c.name==='vm-exec.sh'&&c.args[0].startsWith('bash ')),false);
});

test('unsupported hosts do not prepare, install, or start anything',async t=>{
  const f=await fixture(t,{hostPlatform:'linux'});await assert.rejects(f.service.prepare({projectId:'p'}),/Apple Silicon macOS/);assert.equal(f.calls.length,0);
});

test('loss of a managed worker is reflected in status and private connection access',async t=>{
  const f=await fixture(t);await f.service.prepare({projectId:'p'});f.setHealthy(false);
  assert.equal((await f.service.status({projectId:'p'})).state,'failed');await assert.rejects(f.service.connection({projectId:'p'}),/Prepare this project/);
});

test('host execution strips API/SSH environment and supports explicit input without a shell',async()=>{
  const previous=process.env.MANTA_TEST_SECRET;process.env.MANTA_TEST_SECRET='must-not-propagate';
  try{const result=await executeLocalVm('/usr/bin/env',[],{timeoutMs:5000});assert.equal(result.code,0);assert.doesNotMatch(result.stdout,/MANTA_TEST_SECRET|SSH_AUTH_SOCK|OPENAI_API_KEY|ANTHROPIC_API_KEY/);
    const input=await executeLocalVm('/bin/cat',[],{input:'isolated stdin',timeoutMs:5000});assert.equal(input.stdout,'isolated stdin');
  }finally{if(previous===undefined)delete process.env.MANTA_TEST_SECRET;else process.env.MANTA_TEST_SECRET=previous;}
});

test('explicitly prepared projects reattach an already running healthy worker after service restart without provisioning',async t=>{
 const f=await fixture(t);await f.service.prepare({projectId:'p'});const token=(await fs.readFile(path.join(f.root,'state','worker-token'),'utf8')).trim();await f.service.close();
 const calls=[];let handle;
 const execute=async(file,args,options={})=>{const name=path.basename(file);calls.push({name,args});if(name==='vm-status.sh')return {code:0,stdout:JSON.stringify({state:'running',guestReady:true})};if(name==='vm-tunnel.sh'){let resolve;handle={pid:9000,ended:false,exited:new Promise(r=>{resolve=r;}),kill(){this.ended=true;resolve({code:0});}};return handle;}throw Error('Unexpected preparation during reattach');};
 const service=createLocalLinuxVmService({vmRoot:f.root,store:{workspace(id){if(!['p','q'].includes(id))throw Error('Unknown project');return '/fixture/'+id;}},execute,allocatePort:async()=>48123,pollIntervalMs:1,maxReadyMs:30,fetchImpl:async(url,options)=>{assert.equal(options.headers.authorization,'Bearer '+token);return new Response(JSON.stringify({schema:'manta-nos3-worker-v1',scopes:{build:true,integration:true}}));}});t.after(()=>service.close());
 assert.equal((await service.status({projectId:'p'})).workerReady,true);assert.equal(calls.some(c=>c.name==='vm-exec.sh'||c.name==='vm-start.sh'||c.name==='vm-prepare.sh'),false);await assert.rejects(service.connection({projectId:'q'}),/Prepare this project/);assert.ok((await service.connection({projectId:'p'})).token);await service.stop({projectId:'p'}).catch(()=>{});
});
