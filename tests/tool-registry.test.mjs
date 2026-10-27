import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEngineeringRegistry,collectEngineeringCatalog} from '../server/tool-registry.mjs';
import {createIntegrationRoutes} from '../server/integration-routes.mjs';
const item=(catalog,id)=>catalog.entries.find(entry=>entry.id===id);
const base={projectId:'project_test',engineering:{tools:[{id:'scipy',available:false,status:'unverified'},{id:'matlab',detected:true,installed:true,available:true,integrated:true},{id:'sysml-v2',available:false}]},modelBackend:{backend:{available:true,version:'0.10.10'}},nos3:{revision:'a'.repeat(40),worker:{configured:true,type:'local-linux-vm'},environment:{workerReady:true}},connectors:[],computer:{browser:{available:true,status:'ready'},desktop:{available:true,status:'enabled-permissions-not-verified'}}};

test('installed software never becomes integrated and semantic views do not imply graphical editing or behavior execution',()=>{
  const result=buildEngineeringRegistry(base);
  assert.equal(item(result,'matlab').integrated,false);assert.equal(item(result,'matlab').ready,false);assert.equal(item(result,'matlab').status,'not-integrated');assert.deepEqual(item(result,'matlab').operations,[]);
  assert.equal(item(result,'sysml').ready,true);assert.match(item(result,'sysml').limitations.join(' '),/不执行 SysML 动态行为/);assert.match(item(result,'sysml').limitations.join(' '),/修改由 Agent/);
  assert.equal(item(result,'sysml-v2'),undefined,'remote REST placeholder must not contradict the actual WASM backend');
  assert.match(item(result,'nos3').limitations.join(' '),/专用星敏/);assert.match(item(result,'nos3').limitations.join(' '),/仅绑定版本/);
});

test('NOS3 only reports ready for recognized source and a ready managed worker, never a configured remote endpoint',()=>{
  assert.equal(item(buildEngineeringRegistry(base),'nos3').ready,true);
  for(const nos3 of [
    {revision:'abc',worker:{configured:true,type:'remote-https',endpoint:'https://example.invalid'},environment:{workerReady:true}},
    {...base.nos3,environment:{guestReady:true,workerReady:false}},
    {...base.nos3,revision:null},
    {...base.nos3,error:'source check failed'},
  ])assert.equal(item(buildEngineeringRegistry({...base,nos3}),'nos3').ready,false);
  const remote=item(buildEngineeringRegistry({...base,nos3:{revision:'abc',worker:{configured:true,type:'remote-https'}}}),'nos3');assert.equal(remote.status,'configured');assert.match(remote.reason,/不验证其执行状态/);
});

test('unverified, timed out and network-blocked numerical runtimes have honest states and actions',()=>{
  for(const status of ['unverified','checking','timeout']){
    const result=item(buildEngineeringRegistry({...base,engineering:{tools:[{id:'scipy',status,available:false}]}}),'scipy');assert.equal(result.status,'unverified');assert.equal(result.ready,false);assert.equal(result.action,'recheck-engineering');assert.doesNotMatch(result.reason,/未安装|缺少/);
  }
  const blocked=item(buildEngineeringRegistry({...base,engineering:{tools:[{id:'scipy',status:'blocked',available:false,detail:'网络磁盘依赖不在本机自动加载，请连接隔离执行环境。'}]}}),'scipy');
  assert.equal(blocked.status,'blocked');assert.equal(blocked.action,'open-integrations');assert.match(blocked.reason,/网络磁盘/);
  assert.equal(item(buildEngineeringRegistry({...base,engineering:{tools:[{id:'scipy',status:'available',available:true}]}}),'scipy').ready,true);
});

test('browser dependencies and desktop consent do not masquerade as exercised computer permissions',()=>{
  const unverified=item(buildEngineeringRegistry(base),'computer');assert.equal(unverified.ready,false);assert.equal(unverified.status,'unverified');
  assert.equal(item(buildEngineeringRegistry({...base,computer:{browser:{available:true,status:'running'}}}),'computer').ready,true);
});

test('MCP entries distinguish disabled/configured/connected and exclude endpoint credentials from presentation',()=>{
  const result=buildEngineeringRegistry({...base,connectors:[
    {id:'off',name:'Off',enabled:false,status:'connected',toolCount:2},
    {id:'new',name:'New',enabled:true,status:'configured',url:'https://server.invalid/private-secret',runtimeKey:'secret'},
    {id:'ok',name:'Connected',enabled:true,status:'connected',toolCount:2},
    {id:'empty',name:'No tools',enabled:true,status:'connected',toolCount:0},
  ]});
  assert.equal(item(result,'mcp:off').status,'disabled');assert.equal(item(result,'mcp:off').ready,false);
  assert.equal(item(result,'mcp:new').status,'configured');assert.equal(item(result,'mcp:new').ready,false);
  assert.equal(item(result,'mcp:ok').ready,true);assert.equal(item(result,'mcp:empty').ready,false);
  assert.match(item(result,'external-mcp').limitations.join(' '),/不承诺.*MCP Apps/);assert.doesNotMatch(JSON.stringify(result),/private-secret|runtimeKey/);
});

test('catalog collection reads each source once, isolates failures, and never starts tools or external connections',async()=>{
  const counts={},called=name=>{counts[name]=(counts[name]||0)+1;};
  const unexpected=()=>{throw Error('Must not execute a tool during catalog read');};
  const result=await collectEngineeringCatalog({projectId:base.projectId,
    engineering:{catalog:async options=>{called('engineering');assert.equal(options.recheck,false);return {tools:[],models:[{id:'thermal-control-v1'}],workflow:['existing']};},run:unexpected},
    modelBackend:{catalog:()=>{called('modelBackend');return base.modelBackend;}},
    nos3:{inspect:()=>{called('nos3');throw Error('private diagnostic');},prepareEnvironment:unexpected,submit:unexpected},
    connectors:{list:()=>{called('connectors');return [];},test:unexpected,tools:unexpected,call:unexpected},
    computer:{status:()=>{called('computer');return base.computer;},action:unexpected},
  });
  assert.deepEqual(counts,{engineering:1,modelBackend:1,nos3:1,connectors:1,computer:1});assert.deepEqual(result.workflow,['existing']);assert.equal(result.models[0].id,'thermal-control-v1');
  assert.equal(item(result.registry,'sysml').ready,true);assert.equal(item(result.registry,'nos3').status,'blocked');assert.doesNotMatch(JSON.stringify(result),/private diagnostic/);
});

test('only explicit recheck reaches numerical probing; cancelled collection does not start reads',async()=>{
  let checks=0;const controller=new AbortController();
  const engineering={catalog:async options=>{checks++;assert.equal(options.recheck,true);return {tools:[]};}};
  await collectEngineeringCatalog({engineering,recheck:true});assert.equal(checks,1);
  controller.abort();await assert.rejects(collectEngineeringCatalog({engineering,recheck:true,signal:controller.signal}),/Cancelled/);assert.equal(checks,1);
});

test('native GIS and NASA 42 appear only when their services exist and retain narrow, honest readiness',()=>{
  const missing=buildEngineeringRegistry(base);
  assert.equal(item(missing,'gdal-proj'),undefined);
  assert.equal(item(missing,'nasa-42'),undefined);
  const configured=buildEngineeringRegistry({...base,
    geospatial:{tool:{id:'gdal-proj'},environment:{ready:false,status:'not-prepared'}},
    orbit42:{tool:{id:'nasa-42'},environment:{ready:false,state:'not-prepared'}},
  });
  for(const id of ['gdal-proj','nasa-42']){
    assert.equal(item(configured,id).integrated,true);
    assert.equal(item(configured,id).ready,false);
    assert.equal(item(configured,id).status,'configured');
    assert.match(item(configured,id).limitations.join(' '),/STF/);
  }
  const ready=buildEngineeringRegistry({...base,
    geospatial:{environment:{ready:true,status:'ready'}},
    orbit42:{environment:{ready:true,state:'ready'}},
  });
  assert.equal(item(ready,'gdal-proj').ready,true);
  assert.equal(item(ready,'nasa-42').ready,true);
  assert.deepEqual(item(ready,'gdal-proj').operations.slice(0,2),['geospatial_catalog','prepare_geospatial_environment']);
  assert.equal(item(ready,'nasa-42').operations.includes('submit_orbit42_job'),true);
  const blocked=buildEngineeringRegistry({...base,
    geospatial:{environment:{ready:false,status:'update-available'}},
    orbit42:{error:true},
  });
  assert.equal(item(blocked,'gdal-proj').status,'blocked');
  assert.equal(item(blocked,'nasa-42').status,'blocked');
  assert.equal(item(buildEngineeringRegistry({...base,geospatial:{environment:{ready:false,status:'unavailable'}}}),'gdal-proj').status,'blocked');
  assert.equal(item(buildEngineeringRegistry({...base,geospatial:{environment:{ready:true,status:'blocked'}}}),'gdal-proj').ready,false);
  assert.equal(item(buildEngineeringRegistry({...base,orbit42:{environment:{ready:true,state:'blocked'}}}),'nasa-42').ready,false);
  assert.doesNotMatch(JSON.stringify(blocked),/private diagnostic/);
});

test('orbit-ground appears only for the dedicated service and never claims coverage',()=>{
 assert.equal(item(buildEngineeringRegistry(base),'orbit-ground'),undefined);
 const ready=item(buildEngineeringRegistry({...base,orbitGround:{environment:{ready:true,state:'ready'}}}),'orbit-ground');
 assert.equal(ready.ready,true);assert.ok(ready.operations.includes('submit_orbit_ground_job'));
 assert.match(ready.limitations.join(' '),/不能推断.*覆盖/);
});

test('catalog only observes present native services once and never prepares or submits jobs',async()=>{
  const counts={};const called=name=>{counts[name]=(counts[name]||0)+1;};
  const unexpected=()=>{throw Error('Catalog attempted to run or install a tool');};
  const result=await collectEngineeringCatalog({projectId:base.projectId,
    geospatialJobs:{catalog:async({projectId})=>{called('geospatial');assert.equal(projectId,base.projectId);return {environment:{ready:true,status:'ready'},tool:{id:'gdal-proj'}};},prepare:unexpected,submit:unexpected},
    orbit42Jobs:{catalog:async({projectId})=>{called('orbit42');assert.equal(projectId,base.projectId);return {environment:{ready:false,state:'not-prepared'},tool:{id:'nasa-42'}};},prepare:unexpected,submit:unexpected},
  });
  assert.deepEqual(counts,{geospatial:1,orbit42:1});
  assert.equal(item(result.registry,'gdal-proj').status,'ready');
  assert.equal(item(result.registry,'nasa-42').status,'configured');
  const absent=await collectEngineeringCatalog({projectId:base.projectId});
  assert.equal(item(absent.registry,'gdal-proj'),undefined);
  assert.equal(item(absent.registry,'nasa-42'),undefined);
});

test('project integrations registry uses the same native readiness without starting a job',async()=>{
  const calls={};const read=name=>{calls[name]=(calls[name]||0)+1;};
  const unexpected=()=>{throw Error('Integrations listing attempted a mutation');};
  let response;
  const route=createIntegrationRoutes({
    geospatialJobs:{catalog:async()=>{read('geospatial');return {environment:{ready:false,status:'not-prepared'}};},prepare:unexpected,submit:unexpected},
    orbit42Jobs:{catalog:async()=>{read('orbit42');return {environment:{ready:true,state:'ready'}};},prepare:unexpected,submit:unexpected},
    send:(_res,status,data)=>{response={status,data};},
  });
  assert.equal(await route({req:{method:'GET'},res:{},parts:['api','projects',base.projectId,'integrations'],project:{id:base.projectId}}),true);
  assert.deepEqual(calls,{geospatial:1,orbit42:1});
  assert.equal(response.status,200);
  assert.equal(item(response.data.registry,'gdal-proj').status,'configured');
  assert.equal(item(response.data.registry,'nasa-42').status,'ready');
  assert.match(item(response.data.registry,'nasa-42').limitations.join(' '),/STF/);
});

test('presentation uses only known actions, statuses and workflow stages',()=>{
  const actions=new Set(['open-engineering-records','open-model','open-simulations','open-engineering','open-traceability','open-library','open-computer','open-integrations','recheck-engineering']);
  const statuses=new Set(['ready','unverified','blocked','not-integrated','configured','disabled']);
  const stages=new Set(['requirements','architecture','simulation','verification','delivery','integration']);
  const result=buildEngineeringRegistry(base);assert.equal(result.schema,'manta-engineering-capabilities-v1');assert.equal(result.projectId,base.projectId);assert.ok(!Number.isNaN(Date.parse(result.observedAt)));
  for(const entry of result.entries){assert.ok(actions.has(entry.action));assert.ok(statuses.has(entry.status));assert.ok(entry.stages.every(stage=>stages.has(stage)));assert.equal(typeof entry.integrated,'boolean');assert.equal(typeof entry.ready,'boolean');}
});
