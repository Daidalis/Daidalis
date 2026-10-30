import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createSharedContainerRunner} from '../server/shared-container-runner.mjs';

const skip=process.platform!=='linux'||!existsSync('/.dockerenv')||process.getuid?.()===0||!existsSync('/usr/bin/python3');
async function workspace(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'shared-runner-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}

test('shared runner writes real output and honestly reports shared credentials/network',{skip},async t=>{
  const runner=createSharedContainerRunner(),root=await workspace(t);
  const status=await runner.status();assert.equal(status.ready,true);assert.equal(status.isolated,false);
  const result=await runner.command({workspace:root,command:'printf hello > output.txt; printf done'});
  assert.equal(result.stdout,'done');assert.equal(await fs.readFile(path.join(root,'output.txt'),'utf8'),'hello');
  assert.equal(result.isolation.kind,'shared-container');assert.equal(result.isolation.credentialsIsolated,false);
  assert.equal(result.isolation.network,'shared-with-application');
});

test('shared runner concurrent projects do not mix stdout or output files',{skip},async t=>{
  const runner=createSharedContainerRunner(),one=await workspace(t),two=await workspace(t);
  const results=await Promise.all([runner.command({workspace:one,command:'sleep .1; printf one; printf one > data.txt'}),runner.command({workspace:two,command:'printf two; printf two > data.txt'})]);
  assert.deepEqual(results.map(r=>r.stdout),['one','two']);
  assert.equal(await fs.readFile(path.join(one,'data.txt'),'utf8'),'one');assert.equal(await fs.readFile(path.join(two,'data.txt'),'utf8'),'two');
});

test('shared runner timeout and cancellation stop delayed writes',{skip},async t=>{
  const runner=createSharedContainerRunner(),root=await workspace(t);
  const marker=path.join(root,'escaped-delayed.txt');
  await assert.rejects(runner.command({workspace:root,command:`sleep 1; printf bad > '${marker}'`,timeoutMs:100}),/timed out/);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),150);
  try{await assert.rejects(runner.command({workspace:root,command:`sleep 1; printf bad > '${marker}'`,signal:controller.signal}),/Cancelled/);}finally{clearTimeout(timer);}
  await new Promise(resolve=>setTimeout(resolve,1100));await assert.rejects(fs.access(marker));

});

test('OpenModelica executes from a temporary workspace with bundled libraries and correct decay values',{
  skip:skip||!existsSync('/usr/bin/omc')||!existsSync('/opt/modelica-libraries'),timeout:120000,
},async()=>{
  const content='model Decay\n Real x(start=1, fixed=true);\n equation der(x)=-x;\nend Decay;\n';
  const sha=createHash('sha256').update(content).digest('hex');
  const result=await createSharedContainerRunner().run({toolId:'openmodelica',operation:'simulate',mainFile:'Decay.mo',modelName:'Decay',inputHash:sha,
    sourceFiles:[{path:'Decay.mo',content,sha256:sha}],simulation:{startTime:0,stopTime:1,numberOfIntervals:100,tolerance:1e-6}});
  assert.equal(result.success,true,result.diagnostics);
  const output=result.files.find(f=>f.path==='manta_result_res.csv');assert.ok(output);
  const lines=Buffer.from(output.contentBase64,'base64').toString().trim().split('\n');
  const columns=lines[0].replaceAll('"','').split(','),last=lines.at(-1).split(',');
  assert.ok(Math.abs(Number(last[columns.indexOf('x')])-Math.exp(-1))<1e-4);
  assert.equal(result.receipt.inputHash,sha);
});

test('shared commands preserve a real Git repository, executable bits, symlinks and large files',{skip},async t=>{
 const root=await workspace(t),runner=createSharedContainerRunner();
 await fs.writeFile(path.join(root,'large.bin'),Buffer.alloc(13*1024*1024));
 const result=await runner.command({workspace:root,command:'git init -q && printf "#!/bin/sh\\necho verified\\n" > run.sh && chmod +x run.sh && ln -s run.sh linked && git add run.sh linked && git -c user.name=Test -c user.email=test@example.invalid commit -qm initial && ./linked'});
 assert.equal(result.code,0,result.stderr);assert.equal(result.stdout.trim(),'verified');
 assert.equal((await fs.stat(path.join(root,'run.sh'))).mode&0o777,0o755);
 assert.equal(await fs.readlink(path.join(root,'linked')),'run.sh');
 assert.equal((await runner.command({workspace:root,command:'git status --porcelain'})).stdout.trim(),'?? large.bin');
});

test('second-order Modelica compiles within a constrained process budget',{
 skip:skip||!existsSync('/usr/bin/omc')||!existsSync('/opt/modelica-libraries'),timeout:120000,
},async()=>{
 const content='model MassSpring\n parameter Real m=1,c=4,k=25,F0=10;\n Real x(start=0,fixed=true),v(start=0,fixed=true);\n equation der(x)=v; m*der(v)+c*v+k*x=F0;\nend MassSpring;\n';
 const sha=createHash('sha256').update(content).digest('hex');
 const result=await createSharedContainerRunner().run({toolId:'openmodelica',operation:'simulate',mainFile:'MassSpring.mo',modelName:'MassSpring',inputHash:sha,sourceFiles:[{path:'MassSpring.mo',content,sha256:sha}],simulation:{startTime:0,stopTime:4,numberOfIntervals:400,tolerance:1e-8}});
 assert.equal(result.success,true,result.diagnostics);
 const rows=Buffer.from(result.files.find(f=>f.path==='manta_result_res.csv').contentBase64,'base64').toString().trim().split('\n');
 const names=rows[0].replaceAll('"','').split(','),last=rows.at(-1).split(',');
 assert.ok(Math.abs(Number(last[names.indexOf('x')])-.4)<.005);
 assert.ok(Math.abs(Number(last[names.indexOf('v')]))<.005);
});
