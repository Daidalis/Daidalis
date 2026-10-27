import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createProfessionalRunner} from '../server/professional-runner.mjs';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const source='model Test parameter Boolean enabled=true; Real x(start=1); equation der(x)=-x; end Test;';
const request=()=>({jobId:'modelica_test_001',operation:'simulate',modelName:'Test',sourceFiles:[{path:'models/Test.mo',content:source,sha256:sha(source)}],inputHash:sha(source),parameters:{enabled:true},simulation:{startTime:0,stopTime:10,numberOfIntervals:100,tolerance:1e-6}});
async function fixture(t,{running=true,runImpl,prepareImpl}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-modelica-runner-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'host'));await fs.mkdir(path.join(root,'worker'));
 for(const file of ['vm-status.sh','vm-exec.sh','vm-start.sh','vm-prepare.sh'])await fs.writeFile(path.join(root,'host',file),'#!/bin/sh\n');
 for(const file of ['prepare-native.sh','provision-worker.sh','professional-run.py','prepare-openmodelica.sh','prepare-design-tools.sh'])await fs.writeFile(path.join(root,'worker',file),'# fixture\n');
 const calls=[];const receipt={schema:'manta-openmodelica-ready-v1',ready:true,tool:{id:'openmodelica',version:'OpenModelica fixture'}};
 const execute=async(file,args,options)=>{assert.equal(file,'/bin/sh');const helper=path.basename(args[0]),command=args[1];calls.push({helper,command,args,options});
  if(helper==='vm-status.sh')return {code:0,stdout:JSON.stringify({state:running?'running':'stopped'})};
  if(helper==='vm-start.sh'){running=true;return {code:0,stdout:'ready'};}
  if(helper==='vm-prepare.sh')return {code:0,stdout:'prepared'};
  if(command==='cat /srv/manta/receipts/openmodelica-ready.json')return {code:0,stdout:JSON.stringify(receipt)};
  if(command==='cat /srv/manta/receipts/design-tools-ready.json')return {code:0,stdout:JSON.stringify({schema:'manta-design-tools-ready-v1',ready:true,tools:{ngspice:{ready:true,version:'ngspice-fixture'},openscad:{ready:true,version:'OpenSCAD fixture'}}})};
  if(command==='/usr/bin/ngspice --version')return {code:0,stdout:'ngspice-fixture'};
  if(command==='/usr/bin/openscad --version 2>&1')return {code:0,stdout:'OpenSCAD fixture'};
  if(command==='/usr/bin/omc --version')return {code:0,stdout:receipt.tool.version+'\n'};
  if(command==='bash /mnt/manta-transfer/worker/prepare-openmodelica.sh'||command==='bash /mnt/manta-transfer/worker/prepare-design-tools.sh'){if(prepareImpl)await prepareImpl(options);return {code:0,stdout:'ready'};}
  if(command==='python3 /mnt/manta-transfer/worker/professional-run.py'||command==='python3 /mnt/manta-transfer/worker/professional-design.py'){
   const req=JSON.parse(options.input);if(runImpl)return runImpl(req,options);
   return {code:0,stdout:JSON.stringify({success:true,exitCode:0,tool:receipt.tool,diagnostics:'actual compiler fixture',receipt:{inputHash:req.inputHash,sourceFiles:req.sourceFiles.map(({path,sha256})=>({path,sha256}))},files:[{path:'manta_result_res.csv',contentBase64:Buffer.from('time,x\n0,1\n10,0.0000454\n').toString('base64')}]})};
  }
  if(command.startsWith('python3 /mnt/manta-transfer/worker/professional-run.py --cancel '))return {code:0,stdout:'{}'};
  throw Error('Unexpected helper command '+command);
 };
 const runner=createProfessionalRunner({vmRoot:root,execute,hostPlatform:'darwin',hostArch:'arm64'});t.after(()=>runner.close());return {runner,calls,root};
}
test('runner stages exact project Modelica bytes via fixed guest stdin command, Boolean parameters and native CSV receipt',async t=>{
 const f=await fixture(t);const result=await f.runner.run(request());assert.equal(result.success,true);assert.match(result.tool.version,/OpenModelica/);assert.equal(Buffer.from(result.files[0].contentBase64,'base64').toString(),'time,x\n0,1\n10,0.0000454\n');
 const call=f.calls.find(c=>c.command==='python3 /mnt/manta-transfer/worker/professional-run.py');assert.deepEqual(JSON.parse(call.options.input).sourceFiles,request().sourceFiles);assert.equal(JSON.parse(call.options.input).parameters.enabled,true);assert.ok(call.options.maxOutputBytes>=24*1024*1024);assert.equal(f.calls.some(c=>c.helper==='vm-prepare.sh'||c.helper==='vm-start.sh'),false);
});
test('malformed paths, names, hashes, parameters and limits cannot reach guest helpers',async t=>{
 const f=await fixture(t);for(const change of [{jobId:'bad;id;xxx'},{modelName:'Test);system("touch x")'},{sourceFiles:[{...request().sourceFiles[0],path:'../escape.mo'}]},{sourceFiles:[{...request().sourceFiles[0],sha256:'0'.repeat(64)}]},{parameters:{enabled:'true;system(x)'}},{parameters:{'x);':1}},{simulation:{stopTime:1,numberOfIntervals:50001}},{operation:'shell'}])await assert.rejects(f.runner.run({...request(),...change}));assert.equal(f.calls.length,0);
});
test('pinned model receipt mismatch is rejected after native execution',async t=>{
 const f=await fixture(t,{runImpl:async()=>({code:0,stdout:JSON.stringify({success:true,exitCode:0,files:[],receipt:{inputHash:'f'.repeat(64),sourceFiles:[]}})})});await assert.rejects(f.runner.run(request()),/receipt differs/);
});
test('preparation starts only the fixed managed VM when necessary and never invokes a host package manager',async t=>{
 const f=await fixture(t,{running:false});assert.equal((await f.runner.prepare()).ready,true);assert.equal(f.calls.filter(c=>c.helper==='vm-start.sh').length,1);assert.equal(f.calls.filter(c=>c.helper==='vm-prepare.sh').length,1);assert.ok(f.calls.every(c=>c.args[0].startsWith(f.root+'/host/')));assert.equal(f.calls.some(c=>/brew|pip|npm|apt/.test(c.helper)),false);
});
test('execution cancellation sends a fixed guest process-group cancellation request',async t=>{
 let started;const active=new Promise(r=>{started=r;});const f=await fixture(t,{runImpl:async(req,options)=>new Promise((resolve,reject)=>{started();options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});})});const controller=new AbortController();const running=f.runner.run(request(),{signal:controller.signal});await active;controller.abort();await assert.rejects(running,/abort/i);assert.ok(f.calls.some(c=>c.command==='python3 /mnt/manta-transfer/worker/professional-run.py --cancel modelica_test_001'));
});
test('check-only operation and simulation settings are forwarded without automatic solves',async t=>{
 const f=await fixture(t);await f.runner.run({...request(),operation:'check'});const call=f.calls.find(c=>c.command==='python3 /mnt/manta-transfer/worker/professional-run.py');assert.equal(JSON.parse(call.options.input).operation,'check');
});

test('native circuit/CAD selection uses only the fixed design bridge and pinned project source',async t=>{
 for(const [toolId,extension] of [['ngspice','.cir'],['openscad','.scad']]){const f=await fixture(t),content=toolId==='ngspice'?'V1 in 0 5\nR1 in 0 1000\n.op\n.end':'cube([1,2,3]);';const sourceFiles=[{path:'models/main'+extension,content,sha256:sha(content)}];await f.runner.run({...request(),toolId,mainFile:sourceFiles[0].path,sourceFiles,parameters:{}});const call=f.calls.find(c=>c.command==='python3 /mnt/manta-transfer/worker/professional-design.py');assert.ok(call);assert.equal(JSON.parse(call.options.input).toolId,toolId);assert.deepEqual(JSON.parse(call.options.input).sourceFiles,sourceFiles);}
});

test('cancellation during a warm readiness probe never starts a native model',async t=>{
 const f=await fixture(t);await f.runner.prepare();const controller=new AbortController();const running=f.runner.run(request(),{signal:controller.signal});controller.abort();await assert.rejects(running,/abort/i);assert.equal(f.calls.some(c=>c.command==='python3 /mnt/manta-transfer/worker/professional-run.py'),false);
});

test('Modelica output selections are bounded identifiers and forwarded canonically, never raw regular expressions',async t=>{
 const f=await fixture(t);await f.runner.run({...request(),signals:['bus.T','x[1]','der(x)','bus.T']});const call=f.calls.find(c=>c.command==='python3 /mnt/manta-transfer/worker/professional-run.py');assert.deepEqual(JSON.parse(call.options.input).signals,['bus.T','der(x)','x[1]']);
 for(const signals of [['x.*'],['x); system(1)'],['x|other'],Array(101).fill('x')])await assert.rejects(f.runner.run({...request(),signals}),/Output signals/);
});
