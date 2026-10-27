import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStore,id,now} from '../server/store.mjs';
import {createEngine} from '../server/engine.mjs';
import {runExecutionStatus} from '../shared/run-presentation.mjs';
const defer=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function until(predicate){const end=Date.now()+3000;while(Date.now()<end){if(predicate())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Expected state was not reached');}
function gate(promise,signal){return new Promise((resolve,reject)=>{const abort=()=>reject(new Error('Cancelled waiting for engineering result'));if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});promise.then(x=>{signal.removeEventListener('abort',abort);resolve(x);},reject);});}
async function fixture(t,{providerId='codex-local',cancel=false,preparing=false}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-engineering-engine-')),store=createStore({dataDir:path.join(root,'data'),seed:false}),finished=defer(),calls=[];
  const project=store.createProject({name:'Engineering wait fixture',resources:{maxAutoResumes:0}});
  store.add('providers',{id:'custom',name:'Fixture SDK',type:'openai-responses',model:'fixture'});
  const providers={getConfig:key=>structuredClone(store.get('providers',key)),redact:x=>String(x)};
  const report={status:'completed',scope:'component',ready:true,jobId:'job',passed:true,checks:[{id:'fixture'}],fullNos3Simulation:false};
  let jobStatus='running',waitCancelled=false,received;
  const nos3={prepareEnvironment:async(_args,{signal})=>{await gate(finished.promise,signal);return {state:'ready'};},inspect:async()=>({localComponentReady:true}),submit:async()=>({jobId:'job',status:'queued'}),status:async()=>({jobId:'job',status:jobStatus,scope:'component'}),result:async()=>report,wait:async(_args,{signal})=>{try{await gate(finished.promise,signal);jobStatus='completed';return {status:jobStatus};}catch(error){waitCancelled=true;throw error;}}};
  const adapters=Object.fromEntries(['codex-app-server','claude-agent-sdk','openai-agents-sdk'].map(runtime=>[runtime,{startTurn(options){calls.push({runtime,options});const completion=(async()=>{options.onSession('native-fixture');assert.ok(options.tools.some(t=>t.name==='call_external_tool'));if(preparing)received=await options.executeTool('prepare_nos3_environment',{});else{await options.executeTool('submit_nos3_job',{scope:'component'});received=await options.executeTool('wait_nos3_job',{jobId:'job',timeoutMs:1000});}return {content:'Reviewed real tool result scope.'};})();return {completion,cancel(){},steer:async()=>true};}}]));
  const engine=createEngine({store,providers,nos3,runtimeAdapters:adapters,runTimeoutMs:150,emit:input=>{const event={id:id('event'),createdAt:now(),...input};store.data.events.push(event);return event;}});
  t.after(async()=>{finished.resolve();await engine.close();await fs.rm(root,{recursive:true,force:true});});
  const {run}=engine.start({threadId:project.coordinatorThreadId,providerId,permissionMode:'auto',content:'Run and inspect the engineering result'});
  await until(()=>run.executionPhase===(preparing?'preparing_environment':'waiting_job'));assert.equal(runExecutionStatus(run),preparing?'preparing_environment':'waiting_job');assert.equal(calls.length,1);if(!preparing)assert.equal(run.waitingJob.jobId,'job');
  return {engine,run,calls,finished,get received(){return received;},get waitCancelled(){return waitCancelled;},store};
}
for(const providerId of ['codex-local','claude-local','custom'])test(providerId+' retains one native turn while waiting for engineering evidence and resumes to review',async t=>{
  const f=await fixture(t,{providerId});await new Promise(r=>setTimeout(r,190));assert.equal(f.run.status,'running','Waiting time must not consume the native execution budget');assert.equal(f.calls[0].options.signal.aborted,false);
  f.finished.resolve();await until(()=>!f.engine.active.has(f.run.id));assert.equal(f.run.status,'completed',f.run.error);assert.equal(f.calls.length,1,'No outer model/tool loop or extra inference turn');assert.equal(f.received.ready,true);assert.equal(f.received.fullNos3Simulation,false);assert.equal(f.run.waitingJob,undefined);assert.equal(f.run.executionPhase,'reviewing');
});
test('user cancellation interrupts the same pending engineering tool call',async t=>{
  const f=await fixture(t);f.engine.cancel(f.run.id);await until(()=>!f.engine.active.has(f.run.id));assert.equal(f.run.status,'cancelled');assert.equal(f.waitCancelled,true);assert.equal(f.calls.length,1);assert.equal(f.run.result,undefined);
});

for(const providerId of ['codex-local','claude-local'])test(providerId+' automatic environment preparation pauses the native turn budget',async t=>{
  const f=await fixture(t,{providerId,preparing:true});await new Promise(r=>setTimeout(r,190));assert.equal(f.run.status,'running');assert.equal(f.calls[0].options.signal.aborted,false);
  f.finished.resolve();await until(()=>!f.engine.active.has(f.run.id));assert.equal(f.run.status,'completed',f.run.error);assert.equal(f.received.state,'ready');assert.equal(f.calls.length,1);
});
