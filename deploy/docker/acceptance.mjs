// Run inside the application container. No model credentials or external calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createSharedContainerRunner} from '../../server/shared-container-runner.mjs';
import {createBrokerRunner} from '../../server/broker-runner.mjs';

const base='http://127.0.0.1:'+(process.env.PORT||4317),checks=[];
async function api(route,body){const r=await fetch(base+route,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const data=await r.json();if(!r.ok)throw Error(JSON.stringify(data));return data;}
assert.equal((await api('/api/health')).ok,true);
const bootstrap=await api('/api/bootstrap');
let project=bootstrap.projects.find(p=>p.name==='Docker acceptance');
project??=await api('/api/projects',{name:'Docker acceptance'});
const modelBase='/api/projects/'+project.id+'/model-backend';
const prior=await api(modelBase+'/validate',{path:'models/acceptance.sysml'}).catch(()=>null);
const valid=prior?.valid?prior:await api(modelBase+'/import',{path:'models/acceptance.sysml',content:'package Acceptance { part def Vehicle; part vehicle : Vehicle; }'});
assert.equal(valid.valid,true);checks.push('managed project and SysML');

if(['shared-container','broker'].includes(process.env.MANTA_EXECUTION_MODE)){
  const isolated=process.env.MANTA_EXECUTION_MODE==='broker';
  const runner=isolated?createBrokerRunner():createSharedContainerRunner();
  const status=await runner.status();assert.equal(status.ready,true,JSON.stringify(status));
  const workspace=await fs.mkdtemp(path.join(isolated?process.env.MANTA_PROJECTS_ROOT:os.tmpdir(),isolated?'project-':'manta-live-command-'));
  try{
    const result=await runner.command({workspace,command:'test ! -S /var/run/docker.sock && printf isolated > result.txt'});
    assert.equal(result.code,0);assert.equal(await fs.readFile(path.join(workspace,'result.txt'),'utf8'),'isolated');
    assert.equal(result.isolation.kind,isolated?'rootless-task-container':'shared-container');assert.equal(result.isolation.credentialsIsolated,isolated);assert.equal(bootstrap.capabilities.commandSandbox,isolated);
    await assert.rejects(runner.command({workspace,command:'sleep 10',timeoutMs:100}),/timed out|worker failed/);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),1500);
    try{await assert.rejects(runner.command({workspace,command:'sleep 20; printf bad > cancelled.txt',signal:controller.signal}),/Cancelled/);}finally{clearTimeout(timer);}
    await assert.rejects(fs.access(path.join(workspace,'cancelled.txt')));
    checks.push('commands, timeout, cancellation ('+process.env.MANTA_EXECUTION_MODE+')');
  }finally{await fs.rm(workspace,{recursive:true,force:true});}
  const examples={
    ngspice:{path:'model.cir',content:'RC transient\nV1 in 0 PULSE(0 1 0 1u 1u 5m 10m)\nR1 in out 1k\nC1 out 0 1u\n.tran 0.0001 0.01\n.end\n'},
    openscad:{path:'model.scad',content:'cube([2,3,4]);'},
    openmodelica:{path:'Decay.mo',content:'model Decay\n Real x(start=1, fixed=true);\n equation der(x)=-x;\nend Decay;\n',modelName:'Decay'},
  };
  for(const [toolId,example] of Object.entries(examples)){
    if(!status.tools?.[toolId]?.ready){checks.push(toolId+': not installed (not tested)');continue;}
    const source={path:example.path,content:example.content,sha256:createHash('sha256').update(example.content).digest('hex')};
    const result=await runner.run({jobId:'acceptance_'+Date.now(),toolId,operation:'simulate',mainFile:source.path,modelName:example.modelName,inputHash:source.sha256,sourceFiles:[source],simulation:{startTime:0,stopTime:1,numberOfIntervals:100,tolerance:1e-6}});
    assert.equal(result.success,true,JSON.stringify(result));assert.ok(result.files.length);assert.equal(result.receipt.inputHash,source.sha256);
    checks.push(toolId+': native execution and receipt');
    // Also exercise the actual application job queue and persisted artifacts.
    const route='/api/projects/'+project.id+'/professional';
    const modelPath='models/'+source.path;
    const existing=await api(route+'/model?path='+encodeURIComponent(modelPath)).catch(()=>null);
    const saved=await fetch(base+route+'/model',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({path:modelPath,content:source.content,expectedHash:existing?.sha256})});
    const savedBody=await saved.json();assert.ok(saved.ok,JSON.stringify(savedBody));
    const job=await api(route+'/jobs',{operation:'simulate',path:modelPath,expectedHash:savedBody.sha256,modelName:example.modelName,...(toolId==='openmodelica'?{simulation:{startTime:0,stopTime:1,numberOfIntervals:100,tolerance:1e-6}}:{})});
    await api(route+'/jobs/'+job.id+'/wait',{timeoutMs:180000});
    const persisted=await api(route+'/jobs/'+job.id+'/result');
    assert.equal(persisted.executionSucceeded,true,JSON.stringify(persisted));assert.ok(persisted.artifacts.length);
    checks.push(toolId+': application job and persisted artifacts');
  }
}else checks.push('runner disabled: command/solver tests not executed');

if(process.env.MANTA_ACCEPT_BROWSER==='1'){
  const result=await api('/api/computer/action',{projectId:project.id,action:'browser.start',args:{}});
  assert.ok(result.imageUrl);checks.push('live browser screenshot');
}
if(process.env.MANTA_ACCEPT_DESKTOP==='1'){
  const action=(name,args={})=>api('/api/computer/action',{projectId:project.id,action:'desktop.'+name,args});
  await action('enable',{consent:true});
  let shot=await action('screenshot');assert.ok(shot.imageUrl);
  await action('open_app',{toolId:'terminal',screenVersion:shot.screenVersion});
  await new Promise(resolve=>setTimeout(resolve,500));
  shot=await action('screenshot');
  await action('type',{text:'printf desktop-acceptance',screenVersion:shot.screenVersion});
  shot=await action('screenshot');await action('key',{key:'Enter',screenVersion:shot.screenVersion});
  await action('disable');checks.push('virtual desktop launch, screenshot, typing and key input');
}
console.log(JSON.stringify({passed:true,checks},null,2));
