import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStore,id,now} from '../server/store.mjs';
import {createEngine} from '../server/engine.mjs';
import {createProviderManager} from '../server/providers.mjs';
const reply=message=>new Response(JSON.stringify({choices:[{message}]}),{headers:{'content-type':'application/json'}});
async function fixture(t,fetchImpl,options={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-recovery-')),store=createStore({dataDir:path.join(root,'data'),seed:false});
 const providers=createProviderManager({store,fetchImpl}),provider=providers.create({name:'Recovery fixture',type:'openai-compatible',model:'fixture',apiKey:'synthetic-fixture',maxRetries:1});
 const project=store.createProject({name:'Recovery',resources:{maxAutoResumes:0,...options.resources}});
 const engine=createEngine({store,providers,emit:event=>store.add('events',{id:id('event'),createdAt:now(),...event}),...options.engineOptions});
 t.after(async()=>{await engine.close();await fs.rm(root,{recursive:true,force:true});});
 const start=content=>engine.start({threadId:project.coordinatorThreadId,providerId:provider.id,permissionMode:'auto',content}).run;
 const finish=async run=>{await engine.active.get(run.id)?.done;return run;};
 return {root,store,engine,project,start,finish};
}

test('missing SDK file rebuilds within the same run using conversation and tool receipts',async t=>{
 let calls=0;const requests=[];
 const h=await fixture(t,async(_url,options)=>{requests.push(JSON.parse(options.body));if(++calls===1)return reply({content:'Saving actual evidence.',tool_calls:[{id:'saved-write',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'retained.txt',content:'Write exactly once'})}}]});return reply({content:'Actual evidence retained.'});});
 const first=await h.finish(h.start('ORIGINAL TASK: save evidence once'));assert.equal(first.status,'completed');
 await fs.unlink(path.join(h.store.dataDir,'sdk-sessions',first.runtimeSessionId+'.json'));
 const second=await h.finish(h.start('Continue after missing session'));assert.equal(second.status,'completed',second.error);assert.notEqual(second.runtimeSessionId,first.runtimeSessionId);
 const recovered=requests.at(-1),system=recovered.messages[0].content;
 assert.match(system,/SDK session recovery/);assert.match(system,/write_file/);assert.match(system,/recorded-result/);assert.match(system,/Write exactly once/);
 assert.ok(recovered.messages.some(m=>m.role==='user'&&m.content.includes('ORIGINAL TASK')));
 assert.equal(h.store.data.events.filter(e=>e.type==='tool.completed'&&e.data.tool==='write_file').length,1);
 assert.equal(await fs.readFile(path.join(h.store.workspace(h.project.id),'retained.txt'),'utf8'),'Write exactly once');
 assert.equal((await h.finish(h.start('Continue again'))).status,'completed');assert.equal(calls,4);
 assert.equal(h.store.get('threads',h.project.coordinatorThreadId).runtimeSessionHistory.at(-1).reason,'sdk-session-missing');
});

test('corrupted SDK files remain explicit failures rather than silently losing history',async t=>{
 let calls=0;const h=await fixture(t,async()=>{calls++;return reply({content:'Done'});});
 const first=await h.finish(h.start('First task')),file=path.join(h.store.dataDir,'sdk-sessions',first.runtimeSessionId+'.json');
 await fs.writeFile(file,'invalid-json');const second=await h.finish(h.start('Continue'));
 assert.equal(second.status,'failed');assert.equal(calls,1);assert.equal(await fs.readFile(file,'utf8'),'invalid-json');
 assert.equal(h.store.data.events.some(e=>e.type==='runtime.session.recovered'),false);
});

test('model retries consume attempts and execution time, while using only one logical model turn',async t=>{
 let attempts=0;const h=await fixture(t,async()=>{if(++attempts===1)return new Response(JSON.stringify({error:{message:'temporary rate limit'}}),{status:429,headers:{'content-type':'application/json','retry-after-ms':'1'}});return reply({content:'Recovered response'});},{resources:{maxRunContinuations:0},engineOptions:{maxTurns:1}});
 const run=await h.finish(h.start('One logical request'));assert.equal(run.status,'completed',run.error);assert.equal(run.modelRequests,1);assert.equal(run.modelAttempts,2);assert.equal(attempts,2);assert.equal(run.executionPolicy.maxModelTurns,1);
});

test('SDK missing-session rebuilding retries once and cannot loop forever',async t=>{
 let calls=0;const adapter={startTurn(){calls++;return {completion:Promise.reject(Object.assign(Error('Missing fixture'),{code:'SDK_SESSION_NOT_FOUND'}))};}};
 const h=await fixture(t,async()=>assert.fail('must not reach model'),{engineOptions:{runtimeAdapters:{'openai-agents-sdk':adapter}}});
 const run=await h.finish(h.start('Try recovery'));assert.equal(run.status,'failed');assert.equal(calls,2);
});

test('SDK preserves optional command timeout and applies the project default after tool parsing',async t=>{
 let calls=0,executions=0;
 const h=await fixture(t,async(_url,options)=>{
  const body=JSON.parse(options.body),schema=body.tools.find(t=>t.function.name==='run_command').function.parameters;
  assert.deepEqual(schema.required,['command']);
  if(++calls===1)return reply({tool_calls:[{id:'omitted-timeout',type:'function',function:{name:'run_command',arguments:JSON.stringify({command:'fixture-command'})}}]});
  assert.ok(body.messages.some(m=>m.role==='tool'&&m.content.includes('default-applied')));return reply({content:'Default command budget confirmed'});
 },{engineOptions:{commandExecutor:async options=>{executions++;assert.equal(options.timeoutMs,300000);assert.equal(options.command,'fixture-command');return {code:0,stdout:'default-applied'};}}});
 const run=await h.finish(h.start('Use the command default'));assert.equal(run.status,'completed',run.error);assert.equal(executions,1);assert.equal(run.modelRequests,2);
 const invocation=h.store.data.events.find(e=>e.type==='tool.started'&&e.data.tool==='run_command');assert.deepEqual(Object.keys(invocation.data.args),['command']);
});
