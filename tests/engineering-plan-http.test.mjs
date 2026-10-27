import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStudioServer} from '../server/index.mjs';

async function fixture(t){
 const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'manta-plan-http-')));
 const folder=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'manta-plan-project-')));
 let app,base;
 const f={get app(){return app;},async boot(){app=await createStudioServer({root:directory,dataDir:path.join(directory,'data'),seed:false,computer:false,evaluator:false,engineering:false,professionalModels:false,professionalRunner:false,connectors:false,nos3:false,modelBackend:false,localVm:false,stfCase:false});const address=await app.listen({port:0});base='http://127.0.0.1:'+address.port;},async request(route,method='GET',body,headers={}){const r=await fetch(base+route,{method,headers:{...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};},async restart(){await app.close();await f.boot();}};
 t.after(async()=>{await app?.close();await fs.rm(directory,{recursive:true,force:true});await fs.rm(folder,{recursive:true,force:true});});
 await f.boot();f.project=(await f.request('/api/projects','POST',{name:'STF planning HTTP',folderPath:folder})).data;
 return f;
}
const plan=()=>({expectedRevision:0,goal:'基于这些资料开发 STF',sources:['资料/NASA-STF.md'],openQuestions:['科学产品与实际地面交付标准尚待明确'],items:[{id:'mission',title:'任务定义',stage:'mission',status:'active',verification:{method:'任务场景审查',acceptanceCriteria:['目标与来源对应']}},{id:'eps',title:'电源设计',parentId:'mission',dependsOn:['mission'],stage:'design',status:'waiting',modelPaths:['models/EPS.mo']}]});

test('project engineering plan HTTP persists a candidate work graph with dependencies and no agent execution',async t=>{
 const f=await fixture(t),route='/api/projects/'+f.project.id+'/engineering-plan';
 const initial=await f.request(route);assert.equal(initial.status,200);assert.equal(initial.data.revision,0);
 const saved=await f.request(route,'POST',plan());assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.revision,1);assert.equal(saved.data.maturity,'candidate');assert.equal(saved.data.items[1].waitingFor[0],'mission');assert.equal(f.app.store.data.runs.length,0);
 await f.restart();const restored=await f.request(route);assert.equal(restored.data.revision,1);assert.deepEqual(restored.data.items,saved.data.items);assert.equal(restored.data.updatedBy.kind,'user');
});

test('engineering plan HTTP rejects stale writes, missing project and cross-origin mutation',async t=>{
 const f=await fixture(t),route='/api/projects/'+f.project.id+'/engineering-plan';
 assert.equal((await f.request(route,'POST',plan())).status,200);
 assert.equal((await f.request(route,'POST',plan())).status,409);
 assert.equal((await f.request('/api/projects/project_00000000-0000-0000-0000-000000000000/engineering-plan')).status,404);
 assert.equal((await f.request(route,'POST',{...plan(),expectedRevision:1},{origin:'https://unrelated.example'})).status,403);
 assert.equal((await f.request(route,'DELETE')).status,405);
 assert.equal((await f.request(route)).data.revision,1);
});
