import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStudioServer} from '../server/index.mjs';

test('container managed projects allocate unique persistent folders and still validate explicit paths',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-managed-'));
  const previous=process.env.MANTA_PROJECTS_ROOT;
  let app;
  try{
    const projects=path.join(root,'projects');await fs.mkdir(projects);process.env.MANTA_PROJECTS_ROOT=projects;
    const options={dataDir:path.join(root,'data'),seed:false,computer:false,evaluator:false,engineering:false,nos3:false,modelBackend:false,professionalModels:false,connectors:false};
    app=await createStudioServer(options);let address=await app.listen({port:0});
    const create=async body=>{const r=await fetch(`http://127.0.0.1:${address.port}/api/projects`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
    const first=await create({name:'One'}),second=await create({name:'Two',folderPath:''});
    assert.equal(first.status,201);assert.equal(second.status,201);
    assert.notEqual(first.body.folderPath,second.body.folderPath);
    assert.equal(path.dirname(first.body.folderPath),projects);
    assert.equal((await create({name:'Bad',folderPath:'/'})).status,400);
    const count=(await fs.readdir(projects)).length;
    assert.equal((await create({name:''})).status,400);assert.equal((await fs.readdir(projects)).length,count);
    await app.close();app=await createStudioServer(options);address=await app.listen({port:0});
    const bootstrap=await(await fetch(`http://127.0.0.1:${address.port}/api/bootstrap`)).json();
    assert.equal(bootstrap.capabilities.managedProjects,true);
    assert.equal(bootstrap.projects.find(p=>p.id===first.body.id).folderPath,first.body.folderPath);
  }finally{await app?.close();if(previous===undefined)delete process.env.MANTA_PROJECTS_ROOT;else process.env.MANTA_PROJECTS_ROOT=previous;await fs.rm(root,{recursive:true,force:true});}
});
