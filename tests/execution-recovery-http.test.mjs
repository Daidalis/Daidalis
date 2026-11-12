import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStudioServer} from '../server/index.mjs';

const reply=message=>new Response(JSON.stringify({choices:[{message}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}}),{headers:{'content-type':'application/json'}});
const call=(id,name,args)=>reply({content:'',tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const blocked=signal=>new Promise((_,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
async function eventually(read,predicate,timeout=10000){const until=Date.now()+timeout;while(Date.now()<until){const value=await read();if(predicate(value))return value;await new Promise(r=>setTimeout(r,10));}assert.fail('Execution state not reached');}

async function fixture(t,fetchImpl,{maxRetries=0,resources={}}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'daidalis-recovery-http-')),workspace=path.join(root,'workspace');await fs.mkdir(workspace);
  const app=await createStudioServer({dataDir:path.join(root,'data'),seed:false,addDefaultCodexProvider:false,computer:false,evaluator:false,engineering:false,connectors:false,nos3:false,localVm:false,professionalModels:false,professionalRunner:false,modelBackend:false,geospatial:false,orbit42:false,orbitGround:false,stfCase:false,fetchImpl});
  const address=await app.listen({port:0}),base=`http://127.0.0.1:${address.port}`;
  t.after(async()=>{await app.close();await fs.rm(root,{recursive:true,force:true});});
  async function api(route,body,method=body===undefined?'GET':'POST'){
    const response=await fetch(base+route,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;
  }
  const provider=await api('/api/providers',{name:'Fault-injection API',type:'openai-compatible',model:'test',apiKey:'synthetic-key',requestTimeoutMs:1000,maxRetries});
  const project=await api('/api/projects',{name:'Recovery HTTP test',folderPath:workspace,resources:{maxAutoResumes:0,maxRunContinuations:0,...resources}});
  const detail=()=>api('/api/threads/'+project.coordinatorThreadId);
  const send=async content=>(await api('/api/threads/'+project.coordinatorThreadId+'/messages',{content,providerId:provider.id,permissionMode:'auto'})).run;
  const finish=(run,timeout)=>eventually(detail,d=>!['queued','running','waiting_approval'].includes(d.runs.find(r=>r.id===run.id)?.status),timeout);
  return {app,api,provider,project,workspace,detail,send,finish};
}

for(const failure of ['429','timeout'])test(`HTTP run recovers from ${failure} without replaying an already completed write`,async t=>{
  let attempts=0;const requests=[];
  const f=await fixture(t,async(_url,options)=>{
    attempts++;requests.push(JSON.parse(options.body));
    if(attempts===1)return call('write-once','write_file',{path:'once.txt',content:'actual saved work'});
    if(attempts===2)return failure==='timeout'?blocked(options.signal):new Response(JSON.stringify({error:{message:'temporary rate limit'}}),{status:429,headers:{'content-type':'application/json','retry-after':'0'}});
    return reply({content:'Finished from saved tool result'});
  },{maxRetries:1});
  const run=await f.send('Write a file and report the result'),detail=await f.finish(run),finished=detail.runs.find(r=>r.id===run.id);
  assert.equal(finished.status,'completed',finished.error);assert.equal(finished.modelRequests,2);assert.equal(finished.modelAttempts,3);
  assert.equal(detail.events.filter(e=>e.type==='tool.completed'&&e.data.tool==='write_file').length,1);
  assert.equal(detail.events.filter(e=>e.type==='model.request.retry').length,1);
  assert.deepEqual(requests[1],requests[2]);assert.ok(requests[2].messages.some(m=>m.role==='tool'&&m.tool_call_id==='write-once'));
  assert.equal(await fs.readFile(path.join(f.workspace,'once.txt'),'utf8'),'actual saved work');
});

test('HTTP timeout exhaustion preserves files and the same SDK session for manual continuation',async t=>{
  let attempts=0,recover=false;const requests=[];
  const f=await fixture(t,async(_url,options)=>{requests.push(JSON.parse(options.body));if(++attempts===1)return call('saved-write','write_file',{path:'saved.txt',content:'preserved'});return recover?reply({content:'Recovered in the same session'}):blocked(options.signal);});
  const first=await f.send('Save then inspect'),detail=await f.finish(first),interrupted=detail.runs.find(r=>r.id===first.id);
  assert.equal(interrupted.status,'interrupted');assert.equal(interrupted.stopReason,'model-request-timeout');assert.match(interrupted.error,/已尝试 1 次/);
  recover=true;const second=await f.send('Continue'),continued=await f.finish(second),finished=continued.runs.find(r=>r.id===second.id);
  assert.equal(finished.status,'completed');assert.equal(finished.runtimeSessionId,interrupted.runtimeSessionId);
  assert.equal(continued.events.filter(e=>e.type==='tool.completed'&&e.data.tool==='write_file').length,1);
  assert.ok(requests.at(-1).messages.some(m=>m.role==='tool'&&m.tool_call_id==='saved-write'));assert.equal(await fs.readFile(path.join(f.workspace,'saved.txt'),'utf8'),'preserved');
});

test('HTTP segment continuation keeps one run and stops when the total allowance is exhausted',async t=>{
  let calls=0,recover=false;
  const f=await fixture(t,async()=>recover?reply({content:'Manually resumed'}):call('budget_'+(++calls),'write_file',{path:'step'+calls+'.txt',content:'step '+calls}),{resources:{maxRunTurns:2,maxRunContinuations:1}});
  const first=await f.send('Execute bounded work'),detail=await f.finish(first),interrupted=detail.runs.find(r=>r.id===first.id);
  assert.equal(interrupted.status,'interrupted');assert.equal(interrupted.stopReason,'turn-limit');assert.equal(calls,4);assert.equal(interrupted.continuationCount,1);
  assert.equal(detail.events.filter(e=>e.type==='sdk.turn.continued').length,1);assert.equal(detail.runs.length,1);
  recover=true;const second=await f.send('Continue from saved results'),continued=await f.finish(second),finished=continued.runs.find(r=>r.id===second.id);
  assert.equal(finished.status,'completed');assert.equal(finished.runtimeSessionId,interrupted.runtimeSessionId);
  assert.equal(continued.events.filter(e=>e.type==='tool.completed'&&e.data.tool==='write_file').length,4);
});

test('HTTP cancellation during backoff ends the run without an automatic restart',async t=>{
  let attempts=0;
  const f=await fixture(t,async()=>{attempts++;return new Response(JSON.stringify({error:{message:'wait'}}),{status:503,headers:{'content-type':'application/json','retry-after':'60'}});},{maxRetries:2,resources:{maxRunContinuations:2}});
  const run=await f.send('Wait for a model');
  await eventually(f.detail,d=>d.events.some(e=>e.type==='model.request.retry'));
  await f.api('/api/runs/'+run.id+'/cancel',{});
  const detail=await f.finish(run),finished=detail.runs.find(r=>r.id===run.id);
  assert.equal(finished.status,'cancelled');assert.equal(attempts,1);assert.equal(detail.events.filter(e=>e.type==='sdk.turn.continued').length,0);
});

test('HTTP run recovers from three consecutive 502 responses on the real backoff clock without replaying a write',{timeout:60000},async t=>{
  const requests=[];let attempts=0;
  const f=await fixture(t,async(_url,options)=>{
    requests.push(JSON.parse(options.body));attempts++;
    if(attempts===1)return call('write-before-502','write_file',{path:'once-502.txt',content:'preserved through recovery'});
    if(attempts<=4)return new Response(JSON.stringify({error:{message:'connection_refused: upstream unavailable'}}),{status:502,headers:{'content-type':'application/json'}});
    return reply({content:'Recovered without repeating the completed write'});
  },{maxRetries:5});
  const started=Date.now(),run=await f.send('Save evidence and finish'),detail=await f.finish(run,55000),finished=detail.runs.find(r=>r.id===run.id);
  assert.equal(finished.status,'completed',finished.error);assert.equal(finished.modelRequests,2);assert.equal(finished.modelAttempts,5);
  assert.equal(attempts,5);assert.ok(Date.now()-started>=35000);
  assert.deepEqual(detail.events.filter(e=>e.type==='model.request.retry').map(e=>e.data.delayMs),[5000,10000,20000]);
  for(const request of requests.slice(2))assert.deepEqual(request,requests[1]);
  assert.equal(detail.events.filter(e=>e.type==='tool.completed'&&e.data.tool==='write_file').length,1);
  assert.equal(await fs.readFile(path.join(f.workspace,'once-502.txt'),'utf8'),'preserved through recovery');
});

test('HTTP recovery-budget exhaustion preserves the SDK session and completed tools for continuation',async t=>{
  let attempts=0,recover=false;
  const f=await fixture(t,async()=>{
    if(++attempts===1)return call('saved-before-budget','write_file',{path:'budget-saved.txt',content:'kept'});
    return recover?reply({content:'Continued from the saved result'}):new Response(JSON.stringify({error:{message:'temporarily unavailable'}}),{status:503,headers:{'content-type':'application/json','retry-after':'301'}});
  },{maxRetries:5});
  const first=await f.send('Save and continue'),detail=await f.finish(first),interrupted=detail.runs.find(r=>r.id===first.id);
  assert.equal(interrupted.status,'interrupted');assert.equal(interrupted.stopReason,'model-recovery-timeout');
  assert.match(interrupted.error,/等待时间超过/);assert.match(interrupted.error,/此线程继续/);assert.equal(attempts,2);
  recover=true;const next=await f.send('Continue'),continued=await f.finish(next),finished=continued.runs.find(r=>r.id===next.id);
  assert.equal(finished.status,'completed',finished.error);assert.equal(finished.runtimeSessionId,interrupted.runtimeSessionId);
  assert.equal(continued.events.filter(e=>e.type==='tool.completed'&&e.data.tool==='write_file').length,1);
  assert.equal(await fs.readFile(path.join(f.workspace,'budget-saved.txt'),'utf8'),'kept');
});

test('HTTP retry-count exhaustion reports all six attempts and keeps the completed work',async t=>{
  let attempts=0;
  const f=await fixture(t,async()=>{
    if(++attempts===1)return call('saved-before-exhaustion','write_file',{path:'exhausted-saved.txt',content:'kept'});
    return new Response(JSON.stringify({error:{message:'upstream refused'}}),{status:502,headers:{'content-type':'application/json','retry-after':'0'}});
  },{maxRetries:5});
  const run=await f.send('Save before the outage'),detail=await f.finish(run),finished=detail.runs.find(r=>r.id===run.id);
  assert.equal(finished.status,'failed');assert.match(finished.error,/已尝试 6 次/);assert.match(finished.error,/此线程继续/);
  assert.equal(finished.modelRequests,2);assert.equal(finished.modelAttempts,7);assert.equal(attempts,7);
  assert.equal(detail.events.filter(e=>e.type==='tool.completed'&&e.data.tool==='write_file').length,1);
  assert.equal(await fs.readFile(path.join(f.workspace,'exhausted-saved.txt'),'utf8'),'kept');
});
