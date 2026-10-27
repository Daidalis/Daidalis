import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createStudioServer} from '../server/index.mjs';

const DEFAULT={defaultPermissionMode:'manual',appearance:'system'};
const provider=complete=>({complete:(_id,options)=>complete(options),list:()=>[{id:'demo',configured:true,type:'demo'}],redact:v=>String(v),sanitize:v=>v});
async function eventually(predicate,timeoutMs=4000){const end=Date.now()+timeoutMs;while(Date.now()<end){if(predicate())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Expected asynchronous task state was not reached');}
function gate(){let open;const promise=new Promise(resolve=>{open=resolve;});return {promise,open};}
async function waitForGate(control,signal){if(signal?.aborted)return;let abort;try{await Promise.race([control.promise,new Promise(resolve=>{abort=resolve;signal?.addEventListener('abort',abort,{once:true});})]);}finally{signal?.removeEventListener('abort',abort);}}

async function fixture(t,options={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'syspilot-settings-http-')),dataDir=path.join(root,'data'),folders=[];
  await fs.mkdir(path.join(root,'public'));await fs.writeFile(path.join(root,'public/index.html'),'<html>Manta</html>');
  let app,base;
  t.after(async()=>{if(app)await app.close();await fs.rm(root,{recursive:true,force:true});for(const folder of folders)await fs.rm(folder,{recursive:true,force:true});});
  const f={
    get app(){return app;},
    dataDir,
    async boot(){app=await createStudioServer({root,dataDir,seed:false,computer:false,evaluator:false,engineering:false,providers:provider(async()=>({content:'Recorded analysis only.',toolCalls:[]})),...options});const address=await app.listen({port:0});base=`http://127.0.0.1:${address.port}`;return app;},
    async restart(){await app.close();return f.boot();},
    async api(route,method='GET',body,headers={}){const response=await fetch(base+route,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()};},
    async forgedHost(){return new Promise((resolve,reject)=>{http.get(base+'/api/settings',{headers:{host:'evil.example'}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject);});},
    async project(name){const folder=await fs.mkdtemp(path.join(os.tmpdir(),'syspilot-settings-project-'));folders.push(folder);const result=await f.api('/api/projects','POST',{name,folderPath:folder,resources:{maxAutoResumes:0}});assert.equal(result.status,201);return result.data;},
    async send(project,permissionMode){const result=await f.api(`/api/threads/${project.coordinatorThreadId}/messages`,'POST',{content:'Inspect the stated assumptions.',providerId:'demo',...(permissionMode===undefined?{}:{permissionMode})});assert.equal(result.status,202);return result.data;},
    async complete(run){await eventually(()=>!f.app.engine.active.has(run.id),20000);const result=f.app.store.get('runs',run.id);assert.equal(result.status,'completed',result.error||`Run ${run.id} did not complete`);return result;},
  };
  await f.boot();return f;
}

test('settings HTTP returns direct objects, rejects invalid updates and preserves values across restart',async t=>{
  const f=await fixture(t);
  assert.deepEqual((await f.api('/api/settings')).data,DEFAULT);
  assert.deepEqual((await f.api('/api/bootstrap')).data.settings,DEFAULT);
  const saved={defaultPermissionMode:'auto',appearance:'dark'};
  const update=await f.api('/api/settings','PATCH',saved);assert.equal(update.status,200);assert.deepEqual(update.data,saved);
  for(const invalid of [{appearance:'dark',usage:true},{defaultPermissionMode:'admin'},{appearance:'System'},{}]){
    assert.equal((await f.api('/api/settings','PATCH',invalid)).status,400);
    assert.deepEqual((await f.api('/api/settings')).data,saved);
  }
  await f.restart();
  assert.deepEqual((await f.api('/api/settings')).data,saved);
  assert.deepEqual((await f.api('/api/bootstrap')).data.settings,saved);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.dataDir,'settings.json'),'utf8')),saved);
  assert.equal((await fs.stat(path.join(f.dataDir,'settings.json'))).mode&0o777,0o600);
});

test('settings routes enforce Host, Origin, fetch-site and JSON content type protection',async t=>{
  const f=await fixture(t);
  assert.equal(await f.forgedHost(),403);
  assert.equal((await f.api('/api/settings','GET',undefined,{origin:'https://evil.example'})).status,403);
  assert.equal((await f.api('/api/settings','PATCH',{appearance:'dark'},{origin:'https://evil.example'})).status,403);
  assert.equal((await f.api('/api/settings','PATCH',{appearance:'dark'},{'sec-fetch-site':'cross-site'})).status,403);
  assert.equal((await f.api('/api/settings','PATCH',{appearance:'dark'},{'content-type':'text/plain'})).status,415);
  assert.deepEqual((await f.api('/api/settings')).data,DEFAULT);
});

test('auto default applies to newly created projects without elevating remembered or explicit manual sends',async t=>{
  const f=await fixture(t),old=await f.project('Existing manual project');
  const original=await f.send(old,'manual');assert.equal(original.run.permissionMode,'manual');await f.complete(original.run);
  assert.equal((await f.api('/api/settings','PATCH',{defaultPermissionMode:'auto'})).status,200);
  assert.equal(f.app.store.get('runs',original.run.id).permissionMode,'manual');
  const fresh=await f.project('Created under auto default');assert.equal(fresh.lastPermissionMode,'auto');
  const automatic=await f.send(fresh);assert.equal(automatic.run.permissionMode,'auto');await f.complete(automatic.run);
  const oldAgain=await f.send(old);assert.equal(oldAgain.run.permissionMode,'manual');await f.complete(oldAgain.run);
  const explicit=await f.send(fresh,'manual');assert.equal(explicit.run.permissionMode,'manual');await f.complete(explicit.run);
  const remembered=await f.send(fresh);assert.equal(remembered.run.permissionMode,'manual');await f.complete(remembered.run);
  await f.restart();
  const afterRestart=await f.send(old);assert.equal(afterRestart.run.permissionMode,'manual');await f.complete(afterRestart.run);
});

test('changing the global default leaves an active parent and its later child at the originating permission',async t=>{
  const parentGate=gate(),childGate=gate();let parentEntered=false,childEntered=false,parentCalls=0;
  const fake=provider(async options=>{
    const coordinator=options.messages[0].content.includes('Role: coordinator.');
    if(coordinator&&parentCalls++===0){parentEntered=true;await waitForGate(parentGate,options.signal);return {content:'Starting one independent analysis.',toolCalls:[{id:'inheritance-child',name:'start_thread',args:{name:'Inherited permission',task:'Inspect assumptions only.'}}]};}
    if(!coordinator){childEntered=true;await waitForGate(childGate,options.signal);}
    return {content:'Scope retained.',toolCalls:[]};
  });
  const f=await fixture(t,{providers:fake}),project=await f.project('Active manual task');
  const parent=await f.send(project,'manual');await eventually(()=>parentEntered);
  await f.api('/api/settings','PATCH',{defaultPermissionMode:'auto'});
  assert.equal(f.app.store.get('runs',parent.run.id).permissionMode,'manual');
  parentGate.open();await eventually(()=>childEntered);
  const child=f.app.store.data.runs.find(run=>run.parentRunId===parent.run.id);
  assert.ok(child);assert.equal(child.permissionMode,'manual');
  await f.api('/api/settings','PATCH',{defaultPermissionMode:'manual',appearance:'light'});
  assert.equal(child.permissionMode,'manual');
  assert.equal(f.app.store.get('runs',parent.run.id).permissionMode,'manual');
  childGate.open();await f.complete(child);await f.complete(parent.run);
});

test('createStudioServer accepts an injected settings service for routes and new-project defaults',async t=>{
  let current={defaultPermissionMode:'auto',appearance:'light'},patches=0;
  const settings={get:()=>({...current}),patch:async input=>{patches++;current={...current,...input};return {...current};}};
  const f=await fixture(t,{settings});
  assert.deepEqual((await f.api('/api/settings')).data,current);
  assert.deepEqual((await f.api('/api/bootstrap')).data.settings,current);
  const project=await f.project('Injected auto default');assert.equal(project.lastPermissionMode,'auto');
  const changed=await f.api('/api/settings','PATCH',{appearance:'dark'});
  assert.equal(changed.status,200);assert.equal(changed.data.appearance,'dark');assert.equal(patches,1);
});
