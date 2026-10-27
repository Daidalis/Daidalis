import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createSdkRuntime,JsonSdkSession} from '../server/runtimes/sdk.mjs';
const tool={name:'read_spec',description:'Read selected project specification',parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}};
async function temp(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'syspilot-official-sdk-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}

test('official Runner executes real tool loop and persisted native history resumes with call identities and images',async t=>{
 const dir=await temp(t),calls=[],messages=[],events=[];let phase=0,sessionId;
 const providers={complete:async(_id,request)=>{calls.push(request);if(phase++===0)return {content:'Reading evidence.',toolCalls:[{id:'native_call_1',name:'read_spec',args:{path:'spec.md'}}],responseItems:[{id:'reason_1',type:'reasoning',encrypted_content:'opaque-reasoning'},{type:'function_call',id:'f1',call_id:'native_call_1',name:'read_spec',arguments:'{"path":"spec.md"}'}]};return {content:'Evidence checked.',toolCalls:[]};},redact:s=>s};
 const runtime=createSdkRuntime({providers,dataDir:dir});let executions=0;
 const first=runtime.startTurn({providerId:'api',workspace:dir,instructions:'Role: worker. Retain exact evidence.',input:'Read specification',tools:[tool],executeTool:async(name,args)=>{executions++;assert.equal(name,'read_spec');assert.equal(args.path,'spec.md');return {ok:true,_image:{mediaType:'image/png',data:'YWN0dWFsLWltYWdl'}};},onSession:id=>sessionId=id,onMessage:m=>messages.push(m),onEvent:e=>events.push(e)});
 const result=await first.completion;assert.equal(result.content,'Evidence checked.');assert.equal(executions,1);assert.equal(calls.length,2);assert.match(calls[1].messages[0].content,/Role: worker/);
 const output=calls[1].messages.find(m=>m.role==='tool');assert.equal(output.tool_call_id,'native_call_1');assert.equal(output.images[0].data,'YWN0dWFsLWltYWdl');
 assert.equal(calls[1].messages.find(m=>m.responseItems).responseItems[0].encrypted_content,'opaque-reasoning');
 assert.equal(messages.length,2);assert.ok(events.some(e=>e.type==='sdk.turn.started'));
 const file=path.join(dir,'sdk-sessions',sessionId+'.json'),saved=JSON.parse(await fs.readFile(file,'utf8'));assert.ok(saved.items.some(i=>i.type==='function_call_result'));assert.equal((await fs.stat(file)).mode&0o777,0o600);
 const resumed=createSdkRuntime({providers,dataDir:dir}).startTurn({providerId:'api',workspace:dir,sessionId,instructions:'Role: worker. Updated.',input:'Continue',tools:[tool],executeTool:async()=>{throw Error('must not replay tool execution');}});await resumed.completion;
 assert.ok(calls[2].messages.some(m=>m.role==='tool'&&m.tool_call_id==='native_call_1'));assert.equal(calls[2].messages.filter(m=>m.content==='Continue').length,1);
 await assert.rejects(createSdkRuntime({providers,dataDir:dir}).startTurn({providerId:'other',workspace:dir,sessionId,input:'Read'}).completion,/different provider/);
});

test('queued steering uses next official user turn and does not silently discard it',async t=>{
 const dir=await temp(t);let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let calls=0;const inputs=[];
 const runtime=createSdkRuntime({dataDir:dir,providers:{complete:async(_id,{messages})=>{calls++;inputs.push(messages);if(calls===1){entered();await gate;}return {content:'answer '+calls,toolCalls:[]};}}});
 const turn=runtime.startTurn({providerId:'fake',workspace:dir,input:'First'});await started;
 assert.deepEqual(await turn.steer('Add units'),{accepted:true,delivery:'queued-next-turn'});release();const done=await turn.completion;
 assert.equal(calls,2);assert.equal(done.content,'answer 2');assert.ok(inputs[1].some(m=>m.content.includes('Add units')));assert.equal((await turn.steer('Too late')).accepted,false);
});

test('cancellation aborts official Runner model request before tool execution',async t=>{
 const dir=await temp(t);let entered;const started=new Promise(r=>entered=r);let executions=0;
 const runtime=createSdkRuntime({dataDir:dir,providers:{complete:async(_id,{signal})=>{entered();await new Promise(r=>signal.addEventListener('abort',r,{once:true}));return {content:'',toolCalls:[{id:'forbidden',name:'read_spec',args:{path:'x'}}]};}}});
 const turn=runtime.startTurn({providerId:'fake',workspace:dir,input:'Wait',tools:[tool],executeTool:async()=>executions++});await started;turn.cancel();await assert.rejects(turn.completion,/Cancelled|abort/i);assert.equal(executions,0);
});

test('native session rejects traversal and implements pop/clear without dropping earlier tool items',async t=>{
 const dir=await temp(t);assert.throws(()=>new JsonSdkSession({directory:dir,id:'../leak'}),/identifier/);
 const session=await new JsonSdkSession({directory:dir,id:'sdk_test',providerId:'p',workspace:dir}).init();await session.addItems([{role:'user',content:'first'},{type:'function_call',callId:'c',name:'tool',arguments:'{}'}]);
 assert.equal((await session.popItem()).callId,'c');assert.equal((await session.getItems()).length,1);await session.clearSession();assert.deepEqual(await session.getItems(),[]);
});


test('failed model request preserves actual official native tool history for restart',async t=>{
 const dir=await temp(t);let count=0,sessionId;const requests=[];
 const runtime=createSdkRuntime({dataDir:dir,providers:{complete:async(_id,request)=>{requests.push(request);if(++count===1)return {content:'',toolCalls:[{id:'recorded_call',name:'read_spec',args:{path:'spec.md'}}]};throw Error('Transport interrupted');}}});
 await assert.rejects(runtime.startTurn({providerId:'p',workspace:dir,input:'Read',tools:[tool],executeTool:async()=>({actualEvidence:42}),onSession:id=>sessionId=id}).completion,/Transport interrupted/);
 const saved=JSON.parse(await fs.readFile(path.join(dir,'sdk-sessions',sessionId+'.json'),'utf8'));assert.ok(saved.items.some(i=>i.type==='function_call_result'&&i.callId==='recorded_call'));
 let replay;
 await createSdkRuntime({dataDir:dir,providers:{complete:async(_id,r)=>{replay=r;return {content:'Recovered',toolCalls:[]};}}}).startTurn({providerId:'p',workspace:dir,sessionId,input:'Continue',tools:[tool],executeTool:async()=>assert.fail('completed tool must not execute again')}).completion;
 assert.ok(replay.messages.some(m=>m.role==='tool'&&m.content.includes('actualEvidence')));
});


test('official SDK waits inside one tool call until dependency result without polling inference',async t=>{
 const dir=await temp(t);let entered,release,calls=0,toolSignal;
 const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const runtime=createSdkRuntime({dataDir:dir,providers:{complete:async()=>++calls===1?{content:'',toolCalls:[{id:'wait',name:'read_spec',args:{path:'spec.md'}}]}:{content:'Joined actual result',toolCalls:[]}}});
 const turn=runtime.startTurn({providerId:'p',workspace:dir,input:'Join dependency',tools:[tool],executeTool:async(name,args,{signal})=>{toolSignal=signal;entered();return gate;}});
 await started;await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.equal(toolSignal.aborted,false);
 release({actual:'dependency returned'});assert.equal((await turn.completion).content,'Joined actual result');assert.equal(calls,2);
});

test('official SDK cancellation aborts pending callback and observes its late rejection',async t=>{
 const dir=await temp(t);let entered,rejectLate,calls=0,toolSignal;
 const started=new Promise(r=>entered=r),gate=new Promise((_,r)=>rejectLate=r);
 const runtime=createSdkRuntime({dataDir:dir,providers:{complete:async()=>{calls++;return {content:'',toolCalls:[{id:'wait',name:'read_spec',args:{path:'spec.md'}}]};}}});
 const turn=runtime.startTurn({providerId:'p',workspace:dir,input:'Wait',tools:[tool],executeTool:async(name,args,{signal})=>{toolSignal=signal;entered();return gate;}});
 await started;const rejected=assert.rejects(turn.completion,/Cancelled|abort/i);turn.cancel();await rejected;assert.equal(toolSignal.aborted,true);assert.equal(calls,1);
 rejectLate(Error('late SDK rejection'));await new Promise(r=>setImmediate(r));assert.equal(calls,1);
});

test('official SDK steering releases pending wait and delivers the queued next user turn',async t=>{
 const dir=await temp(t);let entered,release,calls=0,executions=0,toolSignal;const requests=[];
 const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const runtime=createSdkRuntime({dataDir:dir,providers:{complete:async(_id,request)=>{requests.push(request);if(++calls===1)return {content:'',toolCalls:[{id:'wait',name:'read_spec',args:{path:'spec.md'}}]};return {content:calls===2?'Interrupted dependency':'Steering received',toolCalls:[]};}}});
 const turn=runtime.startTurn({providerId:'p',workspace:dir,input:'Wait',tools:[tool],executeTool:async(name,args,{signal})=>{executions++;toolSignal=signal;entered();return gate;}});
 await started;assert.equal((await turn.steer('Change dependency')).delivery,'queued-next-turn');assert.equal((await turn.completion).content,'Steering received');
 assert.equal(toolSignal.aborted,true);assert.equal(executions,1);assert.equal(calls,3);assert.ok(requests[1].messages.some(m=>m.role==='tool'&&m.content.includes('interrupted')));assert.ok(requests[2].messages.some(m=>m.role==='user'&&m.content.includes('Change dependency')));
 release({lateSuccess:true});await new Promise(r=>setImmediate(r));assert.equal(calls,3);
});
