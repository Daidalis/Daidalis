import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createStudioServer} from '../server/index.mjs';

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const jobId='orbit42_'+'a'.repeat(32);
const trajectoryPath=`engineering/orbit/${jobId}/trajectory.csv`;
const trajectory='time_seconds,x_n_m,y_n_m,z_n_m,vx_n_mps,vy_n_mps,vz_n_mps\n0,7000000,0,0,0,7500,0\n';
const waitFor=async(predicate)=>{const until=Date.now()+5000;while(Date.now()<until){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Native fixture run did not finish');};
function requestInMemory(server,url){
 return new Promise((resolve,reject)=>{
  const request={method:'GET',url,headers:{host:'127.0.0.1:41234'}};
  let status;
  const response={headersSent:false,setHeader(){},writeHead(code){status=code;this.headersSent=true;},end(body=''){try{resolve({status,data:JSON.parse(String(body))});}catch(error){reject(error);}},destroy:reject};
  server.emit('request',request,response);
 });
}

test('studio wires injected Orbit 42 tools into a native Agent turn and verifies workspace evidence',async t=>{
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'manta-orbit42-studio-'));
 let app;
 t.after(async()=>{await app?.close();await fs.rm(temporary,{recursive:true,force:true});});
 let owner,verified=true,expectedHash=sha(trajectory),status='queued',capturedTools=[],bridgeResults=[];
 const calls=[];
 const scoped=({projectId,jobId:requested})=>{assert.equal(projectId,owner);assert.equal(requested,jobId);};
 const jobResult=async args=>{scoped(args);calls.push(['result',args]);return {jobId,status:'completed',ready:true,integrity:{verified},artifacts:[{path:trajectoryPath,sha256:expectedHash,mimeType:'text/csv'}],trajectoryPath,frame:'42 N (Earth-centered)'};};
 const orbit42Jobs={
  async catalog(args){assert.equal(args.projectId,owner);calls.push(['catalog',args]);return {environment:{ready:true},fixture:true};},
  async submit(args,ctx){assert.equal(args.projectId,owner);assert.equal(ctx.source,'agent');calls.push(['submit',args,ctx]);status='queued';return {jobId,status};},
  async status(args){scoped(args);calls.push(['status',args]);return {jobId,status};},
  async wait(args,ctx){scoped(args);assert.ok(ctx.signal);calls.push(['wait',args,ctx]);status='completed';return {jobId,status,result:await jobResult(args)};},
  result:jobResult,
  async close(){calls.push(['close']);},
 };
 const adapter={startTurn(options){
  capturedTools=options.tools.map(tool=>tool.name);
  return {completion:(async()=>{
   bridgeResults.push(await options.executeTool('orbit42_catalog',{}));
   bridgeResults.push(await options.executeTool('submit_orbit42_job',{path:'models/Orbit.orbit42.json',expectedHash:'b'.repeat(64)}));
   bridgeResults.push(await options.executeTool('wait_orbit42_job',{jobId}));
   return {content:'Orbit 42 fixture returned; engineering acceptance remains open.'};
  })()};
 },async close(){}};
 app=await createStudioServer({dataDir:path.join(temporary,'state'),seed:false,computer:false,evaluator:false,engineering:false,engineeringState:false,engineeringPlan:false,professionalModels:false,professionalRunner:false,geospatial:false,nos3:false,connectors:false,modelBackend:false,localVm:false,stfCase:false,orbit42:true,orbit42Jobs,codexPath:process.execPath,engineOptions:{runtimeAdapters:{'codex-app-server':adapter},maxTurns:3}});
 assert.equal(app.orbit42Jobs,orbit42Jobs);
 const project=app.store.createProject({name:'Orbit integration fixture',resources:{maxAutoResumes:0}});owner=project.id;
 const workspace=app.store.workspace(owner),target=path.join(workspace,trajectoryPath);
 await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,trajectory);
 const run=app.engine.start({threadId:project.coordinatorThreadId,content:'Inspect the injected orbit tool bridge.',providerId:'codex-local',permissionMode:'auto'}).run;
 await waitFor(()=>!['queued','running','waiting_approval'].includes(app.store.get('runs',run.id)?.status));
 assert.equal(run.status,'completed');
 for(const name of ['orbit42_catalog','read_orbit42_model','save_orbit42_model','submit_orbit42_job','get_orbit42_job','wait_orbit42_job','cancel_orbit42_job'])assert.ok(capturedTools.includes(name),`Native Agent did not receive ${name}`);
 assert.equal(bridgeResults.length,3);assert.ok(bridgeResults.every(value=>!value.error),JSON.stringify(bridgeResults));
 assert.equal(bridgeResults[2].result.integrity.verified,true);
 assert.deepEqual(calls.filter(([name])=>['catalog','submit','status','wait'].includes(name)).map(([name])=>name),['catalog','submit','status','wait']);
 assert.ok(app.store.data.events.some(event=>event.runId===run.id&&event.type==='tool.completed'&&event.data.tool==='wait_orbit42_job'));

 // Exercise the actual HTTP router without opening a socket or touching a VM.
 app.server.address=()=>({port:41234});
 const url=`/api/projects/${owner}/workspace/file?path=${encodeURIComponent(trajectoryPath)}`;
 let response=await requestInMemory(app.server,url);assert.equal(response.status,200);let opened=response.data;
 assert.equal(opened.content,trajectory);assert.equal(opened.sha256,sha(trajectory));assert.equal(opened.editable,false);
 verified=false;response=await requestInMemory(app.server,url);assert.equal(response.status,409,'failed native integrity must block the workspace viewer');
 verified=true;expectedHash='c'.repeat(64);response=await requestInMemory(app.server,url);assert.equal(response.status,409,'recorded hash must match the actual file');
 expectedHash=sha(trajectory);await fs.writeFile(path.join(path.dirname(target),'unregistered.csv'),trajectory);
 response=await requestInMemory(app.server,url.replace('trajectory.csv','unregistered.csv'));assert.equal(response.status,403,'only listed native artifacts may open');
});
