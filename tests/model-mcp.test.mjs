import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createStore} from '../server/store.mjs';
import {createModelBackendService} from '../server/model-backend.mjs';
import {createConnectorService} from '../server/connectors.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SOURCE='package MCPExample { private import ScalarValues::*; attribute mass : Real = 1500.0; assert constraint positiveMass { mass > 0.0 } }';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-real-model-mcp-'));
  const store=createStore({dataDir:path.join(root,'data'),seed:false}),project=store.createProject({name:'Real SysML MCP'}),workspace=store.workspace(project.id);
  const backend=await createModelBackendService({store,root:ROOT});
  await backend.importModel({projectId:project.id,path:'models/example.sysml',content:SOURCE});
  const connectors=createConnectorService({store,env:{MANTA_MCP_TEST_TOKEN:'not-exposed',OPENAI_API_KEY:'not-inherited'}});
  t.after(async()=>{await connectors.close();await fs.rm(root,{recursive:true,force:true});});
  const config=await connectors.save(project.id,{id:'real_sysml',name:'Pinned real SysML kernel',transport:'stdio',command:process.execPath,args:[path.join(ROOT,'runners/sysml-mcp.mjs'),'--workspace',workspace],enabled:true,toolPolicies:{sysml_catalog:'read',sysml_query:'read',sysml_validate:'run',sysml_verify:'run'},timeoutMs:15000},{userInitiated:true});
  return {root,store,projectId:project.id,workspace,backend,connectors,config};
}
function value(response){assert.equal(response.truncated,false);assert.notEqual(response.result?.isError,true,JSON.stringify(response.result));assert.ok(response.result.structuredContent);return response.result.structuredContent;}

test('real project-scoped stdio MCP discovers actual kernel schemas and evaluates a model query',{timeout:30000},async t=>{
  const before={HOME:process.env.HOME,PATH:process.env.PATH,NODE_OPTIONS:process.env.NODE_OPTIONS},f=await fixture(t),tested=await f.connectors.test(f.projectId,f.config.id);
  assert.equal(tested.server.name,'manta-sysml');assert.ok(tested.tools.some(x=>x.name==='sysml_query'&&x.inputSchema.properties.query));assert.equal(tested.tools.find(x=>x.name==='sysml_validate').effect,'run');
  const catalog=value(await f.connectors.call(f.projectId,f.config.id,'sysml_catalog',{}));assert.equal(catalog.backend.version,'0.10.10');assert.equal(catalog.backend.available,true);
  const queried=value(await f.connectors.call(f.projectId,f.config.id,'sysml_query',{path:'models/example.sysml',query:'MCPExample::mass'}));assert.equal(queried.valid,true);assert.equal(queried.data,1500);assert.equal(queried.model.sha256,sha(SOURCE));assert.match(queried.backend.archiveSha256,/^[a-f0-9]{64}$/);
  assert.deepEqual({HOME:process.env.HOME,PATH:process.env.PATH,NODE_OPTIONS:process.env.NODE_OPTIONS},before);
  const isolated=path.join(f.store.dataDir,'connector-runtime',f.projectId,f.config.id,'home');assert.ok((await fs.stat(isolated)).isDirectory());assert.notEqual(isolated,process.env.HOME);assert.equal(JSON.stringify(f.connectors.list(f.projectId)).includes('not-exposed'),false);
});

test('actual MCP validation saves hashed evidence and static verification returns supported constraint verdicts',{timeout:30000},async t=>{
  const f=await fixture(t);
  await assert.rejects(f.connectors.call(f.projectId,f.config.id,'sysml_validate',{path:'models/example.sysml'}),/requires approval/);
  const validated=value(await f.connectors.call(f.projectId,f.config.id,'sysml_validate',{path:'models/example.sysml'},{approved:true}));assert.equal(validated.valid,true);assert.deepEqual(validated.findings,[]);assert.equal(validated.model.sha256,sha(SOURCE));const bytes=await fs.readFile(path.join(f.workspace,validated.evidence.path));assert.equal(sha(bytes),validated.evidence.sha256);assert.equal(JSON.parse(bytes).model.sha256,sha(SOURCE));
  const verified=value(await f.connectors.call(f.projectId,f.config.id,'sysml_verify',{path:'models/example.sysml'},{approved:true}));assert.equal(verified.valid,true);assert.ok(verified.data.summary.satisfied>=1);assert.equal(verified.data.summary.violated,0);assert.match(verified.verificationScope,/no behavior\/simulation execution/);
});

test('real MCP reports unresolved draft references and rejects project escapes without silently accepting a model',{timeout:30000},async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.workspace,'draft.sysml'),'package Draft { part p : MissingType; }');
  const invalid=value(await f.connectors.call(f.projectId,f.config.id,'sysml_validate',{path:'draft.sysml'},{approved:true}));assert.equal(invalid.valid,false);assert.ok(invalid.findings.some(x=>x.stage==='referential'));assert.ok(invalid.evidence.path);
  const escaped=await f.connectors.call(f.projectId,f.config.id,'sysml_query',{path:'../outside.sysml'});assert.equal(escaped.result.isError,true);assert.match(escaped.result.content[0].text,/escapes|relative/i);
  await assert.rejects(f.connectors.call('project_00000000-0000-0000-0000-000000000000',f.config.id,'sysml_catalog',{}),/Project not found/);
});

test('abort reaches the actual native MCP request and leaves the existing model unchanged',{timeout:30000},async t=>{
  const f=await fixture(t);await f.connectors.test(f.projectId,f.config.id);const controller=new AbortController();
  const call=f.connectors.call(f.projectId,f.config.id,'sysml_verify',{path:'models/example.sysml'},{approved:true,signal:controller.signal});const timer=setTimeout(()=>controller.abort(),10);try{await assert.rejects(call,/cancel|abort/i);}finally{clearTimeout(timer);}
  assert.equal(await fs.readFile(path.join(f.workspace,'models/example.sysml'),'utf8'),SOURCE);
});
