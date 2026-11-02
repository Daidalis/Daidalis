import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createFlightContainerRunner} from '../../server/flight-container-runner.mjs';
import {createBrokerFlightRpc} from '../../server/broker-adapters.mjs';
const base='http://127.0.0.1:'+process.env.PORT,flight=createFlightContainerRunner(process.env.MANTA_EXECUTION_MODE==='broker'?{rpc:createBrokerFlightRpc()}:{});
async function api(route,body,method=body?'POST':'GET'){const r=await fetch(base+route,{method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const x=await r.json();assert.ok(r.ok,JSON.stringify(x));return x;}
async function project(name){return (await api('/api/bootstrap')).projects.find(p=>p.name===name)||api('/api/projects',{name});}
async function git(cwd,args){return new Promise((resolve,reject)=>{const p=spawn('git',args,{cwd,env:{PATH:process.env.PATH,HOME:'/tmp',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'},stdio:['ignore','pipe','pipe']});let text='';p.stdout.on('data',c=>text+=c);p.stderr.on('data',c=>text+=c);p.on('error',reject);p.on('close',code=>code?reject(Error(text.slice(-2000))):resolve(text));});}
try{
 const ready=await flight.status();assert.equal(ready.ready,true,ready.reason);if(process.env.MANTA_ACCEPT_STF!=='0')assert.equal(ready.tools['nos3-stf'].ready,true);
 if(process.env.MANTA_ACCEPT_NOS3==='1'){
  const p=await project('NOS3 container acceptance'),root=p.folderPath;
  if(!await fs.stat(root+'/.git').catch(()=>null))await git(root,['clone','--depth','1','--branch','v1_07_05','https://github.com/nasa/nos3.git','.']);
  assert.equal((await git(root,['rev-parse','HEAD'])).trim(),'5a3bdee6be9a2c67fdf994ae6db56d5c60395302');
  await git(root,['-c','protocol.file.allow=never','submodule','update','--init','--depth','1','components/generic_adcs']);
  const route='/api/projects/'+p.id+'/nos3';
  for(const scope of ['component','build','integration']){
  const job=await api(route+'/jobs',{scope});
  let result;const deadline=Date.now()+900000;
  while(Date.now()<deadline){result=await api(route+'/jobs/'+job.id+'/result');if(result.ready)break;await new Promise(r=>setTimeout(r,2000));}
  assert.equal(result?.passed,true,JSON.stringify(result));assert.equal(result.integrity.verified,true);if(scope==='integration'){assert.equal(result.fullNos3Simulation,true);assert.equal(result.checks.length,6);}if(scope==='component')assert.equal(result.metrics.cases,324);
  console.log(JSON.stringify({passed:true,type:'nos3-'+scope,projectId:p.id,jobId:job.id,checks:result.checks.map(c=>({id:c.id,passed:c.passed}))}));
  }
 }
 if(process.env.MANTA_ACCEPT_STF!=='0'){
  const p=await project('STF container acceptance'),route='/api/projects/'+p.id+'/professional',files=await flight.template();
  for(const file of files){const current=await api(route+'/model?path='+encodeURIComponent(file.path)).catch(()=>null);await api(route+'/model',{path:file.path,content:file.content,expectedHash:current?.sha256??null},'PUT');}
  const job=await api(route+'/jobs',{operation:'simulate',path:files[0].path,expectedHash:files[0].sha256,sourcePaths:files.slice(1).map(f=>f.path),parameters:{applyProtection:false}});
  await api(route+'/jobs/'+job.id+'/wait',{timeoutMs:480000});const result=await api(route+'/jobs/'+job.id+'/result');
  assert.equal(result.executionSucceeded,true,JSON.stringify(result));assert.equal(result.integrity.verified,true);assert.equal(result.passed,false,'Original protection defects must remain failed');
  for(const id of ['native:critical-safe-all-off','native:reentry-rearms'])assert.equal(result.verification.checks.find(c=>c.id===id)?.passed,false);
  console.log(JSON.stringify({passed:true,type:'stf-original-negative-control',projectId:p.id,jobId:job.id,checks:result.verification.checks.map(c=>({id:c.id,passed:c.passed}))}));
 }
}finally{await flight.close();}
