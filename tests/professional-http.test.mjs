import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createStudioServer} from '../server/index.mjs';
import {createToolRuntime} from '../server/tools.mjs';
import {numericModelParameters,inferModelName,renderProfessionalWorkbench,parseOutputSignals} from '../public/professional-workbench.mjs';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
test('professional HTTP binds native edits and execution to project/source and preserves explicit failed checks',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'manta-prof-http-')),dataDir=path.join(folder,'data'),workspace=path.join(folder,'project');await fs.mkdir(workspace);
 const runner={status:async()=>({ready:true,state:'ready',version:'test-tool-only'}),prepare:async()=>({ready:true}),run:async input=>({exitCode:0,success:true,tool:{id:'openmodelica',version:'test-tool-only'},receipt:{inputHash:input.inputHash,sourceHashes:input.sourceFiles.map(({path,sha256})=>({path,sha256}))},files:[{path:'result_res.csv',contentBase64:Buffer.from('time,x\n0,1\n1,0.5\n2,0.25\n').toString('base64')}]})};
 const app=await createStudioServer({dataDir,seed:false,computer:false,engineering:false,nos3:false,connectors:false,modelBackend:false,localVm:false,professionalRunner:runner,stfCase:false});
 t.after(async()=>{await app.close();await fs.rm(folder,{recursive:true,force:true});});
 const address=await app.listen({port:0}),base='http://127.0.0.1:'+address.port;
 async function api(route,method='GET',body){const r=await fetch(base+route,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
 const p=(await api('/api/projects','POST',{name:'Professional HTTP fixture',folderPath:workspace})).data,route='/api/projects/'+p.id+'/professional';
 const content='model Decay\n parameter Real rate = 1;\n Real x(start=1,fixed=true);\nequation\n der(x)=-rate*x;\nend Decay;\n';
 const saved=await api(route+'/model','PUT',{path:'models/Decay.mo',content,expectedHash:null});assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.sha256,hash(content));
 assert.equal((await api(route+'/model','PUT',{path:'models/Decay.mo',content:content+'\n',expectedHash:hash('stale')})).status,409);
 assert.equal((await api(route+'/model?path=../outside.mo')).status,400);
 const misplaced=await api(route+'/jobs','POST',{path:'models/Decay.mo',expectedHash:hash(content),operation:'simulate',modelName:'Decay',stopTime:2});assert.equal(misplaced.status,400);assert.match(JSON.stringify(misplaced.data),/simulation/);
 const misspelled=await api(route+'/jobs','POST',{path:'models/Decay.mo',expectedHash:hash(content),operation:'simulate',modelName:'Decay',simulation:{stopTme:2}});assert.equal(misspelled.status,400);assert.match(JSON.stringify(misspelled.data),/stopTme/);
 const submitted=await api(route+'/jobs','POST',{path:'models/Decay.mo',expectedHash:hash(content),operation:'simulate',modelName:'Decay',checks:[{id:'deliberate-failure',variable:'x',metric:'max',operator:'<=',expected:0}]});assert.equal(submitted.status,202,JSON.stringify(submitted.data));
 await app.professionalModels.wait({projectId:p.id,jobId:submitted.data.jobId});
 const result=(await api(route+'/jobs/'+submitted.data.jobId+'/result')).data;assert.equal(result.executionSucceeded,true);assert.equal(result.verification.status,'failed');assert.equal(result.passed,false);assert.equal(result.integrity.verified,true);assert.deepEqual(result.table.rows,[[0,1],[1,.5],[2,.25]]);
 const other=path.join(folder,'other');await fs.mkdir(other);const p2=(await api('/api/projects','POST',{name:'Other',folderPath:other})).data;
 assert.equal((await api('/api/projects/'+p2.id+'/professional/jobs/'+submitted.data.jobId+'/result')).status,400);
 const registry=(await api('/api/projects/'+p.id+'/integrations')).data.registry;assert.equal(registry.entries.filter(row=>row.id==='openmodelica').length,1);assert.equal(registry.entries.find(row=>row.id==='openmodelica').ready,true);
});
test('native runtime professional mutations preserve Manual approvals and worker ownership',async()=>{
 const calls=[],service={saveModel:async a=>{calls.push(a);return a;},submit:async a=>a,prepare:async()=>({ready:true})};
 let approved=false,ownership=true;
 const runtime=createToolRuntime({store:{workspace:()=>'/tmp'},professionalModels:service,getPermissionMode:()=> 'manual',requestApproval:async()=>approved,assertWriteOwnership:async()=>{if(!ownership)throw Error('Another task owns model');}});
 const ctx={projectId:'p',runId:'r'},args={path:'models/A.mo',content:'model A end A;',expectedHash:null};
 await assert.rejects(runtime.execute('save_professional_model',args,ctx),/rejected/);assert.equal(calls.length,0);
 approved=true;ownership=false;await assert.rejects(runtime.execute('save_professional_model',args,ctx),/owns/);assert.equal(calls.length,0);
 ownership=true;await runtime.execute('save_professional_model',args,ctx);assert.equal(calls[0].projectId,'p');
});
test('evaluation tool policy hides and rejects prebuilt model import',async()=>{
 const runtime=createToolRuntime({store:{workspace:()=>'/tmp'},disabledTools:['prepare_nos3_model']});
 assert.equal(runtime.definitions.some(tool=>tool.name==='prepare_nos3_model'),false);
 await assert.rejects(runtime.execute('prepare_nos3_model',{}, {projectId:'test'}),/unavailable/);
 assert.equal(runtime.definitions.some(tool=>tool.name==='import_system_model'),true);
});
test('professional workbench identifies real source parameters and escapes source/diagnostics',()=>{
 const source='package STF\n model Mission\n parameter Real solarPower(unit="W")=24;\n parameter Integer count=4;\nend Mission; end STF;';
 assert.equal(inferModelName(source),'STF.Mission');assert.deepEqual(numericModelParameters(source),[{name:'solarPower',value:24},{name:'count',value:4}]);
 const html=renderProfessionalWorkbench({draft:'</textarea><img src=x onerror=alert(1)>',path:'models/A.mo',catalog:{tools:[{id:'openmodelica',environment:{ready:true,state:'ready'}}]}});
 assert.doesNotMatch(html,/<img src=x/);assert.match(html,/&lt;\/textarea&gt;/);assert.match(html,/运行仿真/);assert.match(html,/隔离求解环境 · 可用/);
});

test('native workbench time controls and output filters apply only to appropriate tools',()=>{assert.deepEqual(parseOutputSignals('a[1,2].x, temperature\nq[1]'),['a[1,2].x','temperature','q[1]']);const c=renderProfessionalWorkbench({path:'models/EPS.cir',catalog:{environment:{status:'ready'}}});assert.doesNotMatch(c,/name="stopTime"|name="signals"/);assert.match(c,/隔离求解环境 · 可用/);const s=renderProfessionalWorkbench({path:'models/System.sysml'});assert.doesNotMatch(s,/value="simulate"/);assert.match(renderProfessionalWorkbench({path:'models/Cube.scad'}),/生成几何/);});
