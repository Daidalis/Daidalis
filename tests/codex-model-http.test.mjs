import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createStudioServer} from '../server/index.mjs';

const catalogResult={models:[{id:'available-model',model:'available-model',displayName:'Available model',isDefault:true}],nextCursor:null};
async function eventually(check){const end=Date.now()+4000;while(Date.now()<end){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Timed out waiting for fixture run');}
async function fixture(t,{list}={}){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'manta-model-http-'))),dataDir=path.join(root,'data'),calls=[],turns=[],folders=[];
  let app,base,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const codexModelCatalog={async list(profile,options){calls.push({profile:structuredClone(profile),...options});return list?list(profile,options):structuredClone(catalogResult);}};
  const adapter={startTurn(options){
    const turn={options,steerings:[]};turns.push(turn);let cancel;
    const cancelled=new Promise(resolve=>{cancel=resolve;});options.signal?.addEventListener('abort',cancel,{once:true});
    const completion=(async()=>{options.onSession(options.sessionId||'native-fixture-session');if(options.input==='Hold this run')await Promise.race([gate,cancelled]);return {sessionId:'native-fixture-session',content:'Local runtime fixture completed.'};})();
    return {completion,cancel,async steer(text){turn.steerings.push(text);return {accepted:true,delivery:'native-fixture'};}};
  }};
  const f={root,dataDir,calls,turns,release,get app(){return app;},
    async boot(){app=await createStudioServer({root,dataDir,seed:false,computer:false,evaluator:false,engineering:false,codexModelCatalog,engineOptions:{runtimeAdapters:{'codex-app-server':adapter},runTimeoutMs:5000}});const address=await app.listen({port:0});base=`http://127.0.0.1:${address.port}`;return app;},
    async restart(){await app.close();return f.boot();},
    async api(route,method='GET',body,headers={}){const response=await fetch(base+route,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()};},
    async project(){const folder=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'manta-model-project-')));folders.push(folder);const response=await f.api('/api/projects','POST',{name:'NOS3 model selection fixture',folderPath:folder,resources:{maxAutoResumes:0}});assert.equal(response.status,201);return response.data;},
    async complete(id){await eventually(()=>!app.engine.active.has(id));const run=app.store.get('runs',id);assert.equal(run.status,'completed',run.error);return run;},
    async forgedHost(route){return new Promise((resolve,reject)=>http.get(base+route,{headers:{host:'evil.example'}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject));}
  };
  t.after(async()=>{release();if(app)await app.close();await fs.rm(root,{recursive:true,force:true});for(const folder of folders)await fs.rm(folder,{recursive:true,force:true});});
  await f.boot();return f;
}

test('Codex model discovery is explicit, project scoped and preserves native custom profile configuration',async t=>{
  const f=await fixture(t),project=await f.project();
  const custom=f.app.providers.create({name:'Custom Codex endpoint',type:'codex-app-server',baseUrl:'https://custom.example.test/v1',model:'custom-native-model',apiKey:'fixture-custom-key'});
  await f.api('/api/bootstrap');await f.api('/api/bootstrap');assert.equal(f.calls.length,0,'bootstrap must not start a catalog RPC');assert.equal(f.turns.length,0);
  const result=await f.api(`/api/providers/${custom.id}/models?projectId=${project.id}`);
  assert.equal(result.status,200);assert.deepEqual(result.data,catalogResult);assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].workspace,project.folderPath);assert.equal(f.calls[0].profile.id,custom.id);assert.equal(f.calls[0].profile.baseUrl,'https://custom.example.test/v1');assert.equal(f.calls[0].profile.model,'custom-native-model');assert.equal(f.calls[0].profile.apiKey,'fixture-custom-key');
  assert.ok(!JSON.stringify(result.data).includes('fixture-custom-key'));
  await f.api('/api/providers/codex-local/models');assert.equal(f.calls[1].workspace,f.root);assert.equal(f.turns.length,0);assert.equal(f.app.store.data.runs.length,0);
  f.app.store.add('providers',{id:'legacy-codex',name:'Legacy Codex',type:'codex-cli',model:'',baseUrl:''});assert.equal((await f.api('/api/providers/legacy-codex/models')).status,200);
});

test('model catalog routes validate provider/project and surface redacted native catalog failures',async t=>{
  const f=await fixture(t,{list(){throw Object.assign(new Error('Cannot list models: fixture-catalog-secret'),{status:503});}});
  f.app.providers.create({name:'Secret holder',type:'codex-app-server',apiKey:'fixture-catalog-secret'});
  for(const route of ['/api/providers/missing/models','/api/providers/codex-local/models?projectId=missing'])assert.equal((await f.api(route)).status,404);
  for(const route of ['/api/providers/demo/models','/api/providers/claude-local/models','/api/providers/codex-local/models?projectId='])assert.equal((await f.api(route)).status,400);
  assert.equal(f.calls.length,0);
  const failed=await f.api('/api/providers/codex-local/models');assert.equal(failed.status,503);assert.equal(failed.data.error,'Cannot list models: [REDACTED]');assert.equal(f.turns.length,0);
});

test('thread model preferences persist independently without starting a run or changing global connection defaults',async t=>{
  const f=await fixture(t),project=await f.project(),threadId=project.coordinatorThreadId;
  f.app.store.patch('providers','codex-local',{model:'connection-default'});
  const other=f.app.store.createThread(project.id,'Independent task',threadId),before=structuredClone(f.app.store.get('providers','codex-local'));
  const saved=await f.api(`/api/threads/${threadId}/model`,'PATCH',{providerId:'codex-local',model:'  selected-model  '});
  assert.equal(saved.status,200);assert.equal(saved.data.model,'selected-model');assert.equal(saved.data.modelEffective,'next-turn');assert.equal(saved.data.thread.modelPreferences['codex-local'],'selected-model');
  assert.equal((await f.api(`/api/threads/${other.id}/model`,'PATCH',{providerId:'codex-local',model:'worker-model'})).status,200);
  assert.equal(f.app.store.data.runs.length,0);assert.equal(f.app.store.data.messages.length,0);assert.equal(f.turns.length,0);assert.deepEqual(f.app.store.get('providers','codex-local'),before);
  await f.restart();
  assert.equal((await f.api(`/api/threads/${threadId}`)).data.thread.modelPreferences['codex-local'],'selected-model');assert.equal((await f.api(`/api/threads/${other.id}`)).data.thread.modelPreferences['codex-local'],'worker-model');assert.deepEqual(f.app.store.get('providers','codex-local'),before);
  const reset=await f.api(`/api/threads/${threadId}/model`,'PATCH',{providerId:'codex-local',model:''});assert.equal(reset.status,200);assert.equal(reset.data.model,'');assert.equal(f.turns.length,0);
});

test('message overrides and steering reach the native engine while live model changes apply to the next run',async t=>{
  const f=await fixture(t),project=await f.project(),threadId=project.coordinatorThreadId;
  const sent=await f.api(`/api/threads/${threadId}/messages`,'POST',{providerId:'codex-local',content:'Hold this run',model:'first-model',permissionMode:'auto'});
  assert.equal(sent.status,202);assert.equal(sent.data.run.model,'first-model');await eventually(()=>f.turns.length===1);assert.equal(f.turns[0].options.model,'first-model');
  const selected=await f.api(`/api/threads/${threadId}/model`,'PATCH',{providerId:'codex-local',model:'next-model'});assert.equal(selected.status,200);assert.equal(selected.data.modelEffective,'next-run');assert.equal(f.app.store.get('runs',sent.data.run.id).model,'first-model');
  const steer=await f.api(`/api/threads/${threadId}/steer`,'POST',{providerId:'codex-local',content:'Also inspect interfaces',model:'steered-model'});assert.equal(steer.status,202);assert.equal(steer.data.modelEffective,'next-run');assert.equal(steer.data.run.model,'first-model');assert.equal(f.app.store.get('threads',threadId).modelPreferences['codex-local'],'steered-model');await eventually(()=>f.turns[0].steerings.length===1);
  f.release();await f.complete(sent.data.run.id);
  const next=await f.api(`/api/threads/${threadId}/messages`,'POST',{providerId:'codex-local',content:'Continue investigation'});assert.equal(next.status,202);assert.equal(next.data.run.model,'steered-model');await f.complete(next.data.run.id);assert.equal(f.turns.at(-1).options.model,'steered-model');
  const explicitSteer=await f.api(`/api/threads/${threadId}/steer`,'POST',{providerId:'codex-local',content:'One more turn',model:'explicit-id'});assert.equal(explicitSteer.status,202);assert.equal(explicitSteer.data.run.model,'explicit-id');await f.complete(explicitSteer.data.run.id);assert.equal(f.turns.at(-1).options.model,'explicit-id');assert.equal(f.app.store.get('providers','codex-local').model,'');
});

test('invalid model values fail before messages, preferences or native executions are created',async t=>{
  const f=await fixture(t),project=await f.project(),threadId=project.coordinatorThreadId;
  const invalid=[null,42,false,{},[],['model'],'line\nbreak','null\0byte','escape\x1bmodel','x'.repeat(201)];
  for(const model of invalid){
    assert.equal((await f.api(`/api/threads/${threadId}/model`,'PATCH',{providerId:'codex-local',model})).status,400);
    for(const action of ['messages','steer'])assert.equal((await f.api(`/api/threads/${threadId}/${action}`,'POST',{providerId:'codex-local',model,content:'Inspect only'})).status,400);
  }
  for(const providerId of [null,42,false,{},[]])assert.equal((await f.api(`/api/threads/${threadId}/model`,'PATCH',{providerId,model:'valid'})).status,400);
  for(const providerId of ['demo','claude-local','missing'])assert.equal((await f.api(`/api/threads/${threadId}/model`,'PATCH',{providerId,model:'valid'})).status,400);
  assert.equal((await f.api(`/api/threads/${threadId}/model`,'PATCH',{providerId:'codex-local'})).status,400);assert.equal((await f.api('/api/threads/missing/model','PATCH',{providerId:'codex-local',model:'valid'})).status,404);
  assert.equal(f.turns.length,0);assert.equal(f.app.store.data.runs.length,0);assert.equal(f.app.store.data.messages.length,0);assert.equal(f.app.store.get('threads',threadId).modelPreferences,undefined);
});

test('new model routes keep same-origin, Host, fetch-site and JSON protection',async t=>{
  const f=await fixture(t),project=await f.project(),route=`/api/threads/${project.coordinatorThreadId}/model`,body={providerId:'codex-local',model:'untrusted'};
  assert.equal(await f.forgedHost('/api/providers/codex-local/models'),403);assert.equal((await f.api('/api/providers/codex-local/models','GET',undefined,{origin:'https://evil.example'})).status,403);
  assert.equal((await f.api(route,'PATCH',body,{origin:'https://evil.example'})).status,403);assert.equal((await f.api(route,'PATCH',body,{'sec-fetch-site':'cross-site'})).status,403);assert.equal((await f.api(route,'PATCH',body,{'content-type':'text/plain'})).status,415);assert.equal(f.calls.length,0);assert.equal(f.turns.length,0);assert.equal(f.app.store.get('threads',project.coordinatorThreadId).modelPreferences,undefined);
});
