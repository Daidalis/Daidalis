import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStore} from '../server/store.mjs';
import {createEngine} from '../server/engine.mjs';
import {TOOL_DEFINITIONS} from '../server/tools.mjs';

const NAMES=['codex-app-server','claude-agent-sdk','openai-agents-sdk'];
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function eventually(check,label='condition',timeout=3000){const end=Date.now()+timeout;while(Date.now()<end){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Timed out: '+label);}
function waitForGate(gate,signal){return new Promise((resolve,reject)=>{const aborted=()=>reject(Object.assign(new Error('Native fixture interrupted'),{name:'AbortError'}));if(signal.aborted)return aborted();signal.addEventListener('abort',aborted,{once:true});gate.then(resolve,reject).finally(()=>signal.removeEventListener('abort',aborted));});}
async function fixture(t,handler,options={}){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'syspilot-native-engine-'))),dataDir=path.join(root,'data');
  const calls=[],events=[],engines=[],cancellations=[];let sequence=0;
  const adapters=Object.fromEntries(NAMES.map(name=>[name,{startTurn(options){
    const sessionId=options.sessionId||name+'-session-'+(++sequence),call={name,options,sessionId,tools:structuredClone(options.tools),steerings:[]};calls.push(call);
    const completion=(async()=>{options.onSession(sessionId);const result=await handler(call);return {sessionId,content:result?.content??'Native fixture answer',...result};})();
    options.signal.addEventListener('abort',()=>cancellations.push(call),{once:true});
    return {completion,async steer(text){call.steerings.push(text);return {accepted:true,delivery:'native-fixture'};},cancel(){call.cancelled=true;}};
  }}]));
  function open(){
    const store=createStore({dataDir,seed:false});
    if(!store.get('providers','api-profile'))store.add('providers',{id:'api-profile',name:'Custom Responses fixture',type:'openai-responses',baseUrl:'https://example.test/v1',model:'fixture-model'});
    const providers={getConfig:id=>structuredClone(store.get('providers',id)),list:()=>store.data.providers.map(p=>({...p,configured:true})),redact:value=>String(value),complete(){throw new Error('The engine must use the runtime adapter, never a custom inner model loop');}};
    const engine=createEngine({store,providers,emit:e=>events.push(e),runtimeAdapters:adapters,autoResumeDebounceMs:5,runTimeoutMs:options.runTimeoutMs??5000});engines.push(engine);return {store,engine};
  }
  const initial=open(),project=initial.store.createProject({name:'Native runtime integration',resources:{maxAutoResumes:0}}),thread=initial.store.get('threads',project.coordinatorThreadId);
  t.after(async()=>{await Promise.allSettled(engines.map(e=>e.close()));await fs.rm(root,{recursive:true,force:true});});
  return {...initial,root,dataDir,project,thread,calls,events,cancellations,open};
}
async function completed(h,args={}){const result=h.engine.start({threadId:h.thread.id,providerId:'codex-local',content:'Analyze the engineering requirement',permissionMode:'auto',...args});await eventually(()=>!h.engine.active.has(result.run.id),'native run completion');assert.equal(result.run.status,'completed',result.run.error);return result;}

test('Native sessions persist per provider and thread; server restart resumes without importing public history again',async t=>{
  const h=await fixture(t,async call=>({content:'Answer to: '+call.options.input}));
  h.store.message(h.thread.id,'user','PRIOR_PUBLIC_CONTEXT');h.store.message(h.thread.id,'assistant','Prior public finding.');
  await completed(h,{content:'MAIN_ONLY_CONTEXT'});const first=h.calls.at(-1);assert.ok(first.options.history.some(m=>m.content==='PRIOR_PUBLIC_CONTEXT'));assert.equal(first.options.sessionId,undefined);
  await completed(h,{content:'Second native turn'});assert.equal(h.calls.at(-1).options.sessionId,first.sessionId);assert.deepEqual(h.calls.at(-1).options.history,[]);
  await completed(h,{providerId:'claude-local',content:'Use another native provider'});const claude=h.calls.at(-1);assert.equal(claude.name,'claude-agent-sdk');assert.equal(claude.options.sessionId,undefined);assert.ok(claude.options.history.some(m=>m.content==='MAIN_ONLY_CONTEXT'));
  await completed(h,{providerId:'api-profile',content:'Use official Agents SDK'});const sdk=h.calls.at(-1);assert.equal(sdk.name,'openai-agents-sdk');assert.equal(sdk.options.sessionId,undefined);
  const worker=h.store.createThread(h.project.id,'Independent worker',h.thread.id,{assignment:'Check the independent interface'});await completed(h,{threadId:worker.id,content:'Independent worker request'});const workerCall=h.calls.at(-1);assert.notEqual(workerCall.sessionId,first.sessionId);assert.equal(JSON.stringify(workerCall.options.history).includes('MAIN_ONLY_CONTEXT'),false);assert.equal(workerCall.tools.some(t=>t.name==='update_model'),false);
  const saved=h.store.get('threads',h.thread.id).runtimeSessions;assert.deepEqual(Object.keys(saved).sort(),['api-profile','claude-local','codex-local']);assert.equal(saved['codex-local'].sessionId,first.sessionId);
  await h.engine.close();const restarted=h.open();await completed({...h,...restarted},{content:'Continue after restarting Manta'});const resumed=h.calls.at(-1);assert.equal(resumed.options.sessionId,first.sessionId);assert.deepEqual(resumed.options.history,[]);assert.equal(restarted.store.get('threads',worker.id).runtimeSessions['codex-local'].sessionId,workerCall.sessionId);
});

test('Cumulative partial messages update one public row, final answers are not duplicated, and reasoning events stay private',async t=>{
  const h=await fixture(t,async({options})=>{
    options.onMessage({id:'progress',text:'Checking',partial:true,phase:'commentary'});options.onMessage({id:'progress',text:'Checking the evidence.',partial:true,phase:'commentary'});options.onMessage({id:'progress',text:'Checking the evidence.',partial:false,phase:'commentary'});
    options.onEvent({type:'item.reasoning.delta',message:'PRIVATE_REASONING',data:{text:'PRIVATE_REASONING'}});options.onEvent({type:'thinking',message:'PRIVATE_REASONING'});
    const model=await options.executeTool('get_model',{});assert.equal(model.version,0);
    options.onEvent({type:'tool.started',message:'duplicate bridge',data:{native:false,tool:'get_model'}});options.onEvent({type:'tool.completed',message:'duplicate bridge',data:{native:false,tool:'get_model',result:{version:0}}});
    options.onEvent({type:'tool.started',message:'Native read',data:{native:true,tool:'codex.commandExecution',itemId:'native-read'}});options.onEvent({type:'tool.completed',message:'Native read',data:{native:true,tool:'codex.commandExecution',itemId:'native-read',result:{stdout:'actual native output',code:0}}});
    options.onMessage({id:'final',text:'Evidence',partial:true,phase:'final_answer'});options.onMessage({id:'final',text:'Evidence remains analytical.',partial:false,phase:'final_answer'});options.onMessage({id:'final',text:'Evidence remains analytical.',partial:false,phase:'final_answer'});return {content:'Evidence remains analytical.',usage:{outputTokens:4}};
  });
  const {run}=await completed(h),rows=h.store.data.messages.filter(m=>m.runId===run.id&&m.type==='runtime.message');assert.equal(rows.length,2);assert.equal(rows.filter(m=>m.content==='Evidence remains analytical.').length,1);assert.ok(rows.every(m=>m.metadata.partial===false));assert.equal(run.usage.outputTokens,4);assert.equal(JSON.stringify({rows,events:h.events}).includes('PRIVATE_REASONING'),false);assert.equal(h.events.filter(e=>e.type==='tool.started'&&e.data.tool==='get_model').length,1);assert.equal(h.events.filter(e=>e.type==='tool.completed'&&e.data.tool==='get_model').length,1);assert.equal(h.events.find(e=>e.type==='tool.completed'&&e.data.native===true).data.result.stdout,'actual native output');
});

test('Rejected bridge writes and native approval requests preserve real denial instead of success evidence',async t=>{
  const observations=[];const h=await fixture(t,async({options})=>{observations.push(await options.executeTool('write_file',{path:'declined.md',content:'Must never be written'}));observations.push(await options.requestApproval({tool:'codex.commandExecution',args:{command:'native-fixture-operation',native:true}}));return {content:'Both operations were denied; no execution evidence exists.'};});
  const {run}=h.engine.start({threadId:h.thread.id,providerId:'codex-local',content:'Propose a controlled edit',permissionMode:'manual'});await eventually(()=>h.store.data.approvals.length===1,'manual bridge approval');assert.equal(run.status,'waiting_approval');assert.equal(h.store.data.approvals[0].tool,'write_file');h.engine.decideApproval(h.store.data.approvals[0].id,'reject');await eventually(()=>h.store.data.approvals.length===2,'native command approval');h.engine.decideApproval(h.store.data.approvals[1].id,'reject');await eventually(()=>!h.engine.active.has(run.id));
  assert.match(observations[0].error,/rejected/);assert.equal(observations[1],false);assert.ok(h.store.data.approvals.every(a=>a.status==='rejected'));await assert.rejects(fs.access(path.join(h.store.workspace(h.project.id),'declined.md')),{code:'ENOENT'});assert.ok(h.events.some(e=>e.type==='tool.completed'&&e.data.tool==='write_file'&&e.data.result.error));assert.equal(run.result,'Both operations were denied; no execution evidence exists.');
});

test('Native questions return validated human answers; rejected questions do not invent choices',async t=>{
  const questions=[{id:'architecture',header:'Architecture',question:'Which interface should the model use?',isOther:false,options:[{label:'CAN',description:'Use the declared CAN interface'},{label:'Ethernet',description:'Use Ethernet'}]}],answers=[];
  const h=await fixture(t,async({options})=>{answers.push(await options.requestUserInput(questions));return {content:'Recorded the actual human response.'};});
  const first=h.engine.start({threadId:h.thread.id,providerId:'codex-local',content:'Resolve an interface choice'});await eventually(()=>h.store.data.approvals.some(a=>a.status==='pending'));const approval=h.store.data.approvals.at(-1);assert.equal(approval.kind,'question');assert.throws(()=>h.engine.decideApproval(approval.id,'approve',{architecture:{answers:['Invented answer']}}),/选项/);assert.equal(approval.status,'pending');h.engine.decideApproval(approval.id,'approve',{architecture:{answers:['CAN']}});await eventually(()=>!h.engine.active.has(first.run.id));assert.deepEqual(answers[0],{architecture:{answers:['CAN']}});
  const second=h.engine.start({threadId:h.thread.id,providerId:'codex-local',content:'Ask again'});await eventually(()=>h.store.data.approvals.at(-1)?.status==='pending');h.engine.decideApproval(h.store.data.approvals.at(-1).id,'reject');await eventually(()=>!h.engine.active.has(second.run.id));assert.equal(answers[1]||null,null);
});

test('Cross-runtime workers start asynchronously with independent sessions and inherited, non-elevatable permission',async t=>{
  const gate=deferred(),results=[];const h=await fixture(t,async call=>{
    const {options}=call;if(options.instructions.includes('Role: coordinator')){for(const providerId of ['claude-local','api-profile'])results.push(await options.executeTool('start_thread',{name:'Worker '+providerId,task:'Independent interface analysis for '+providerId,providerId,permissionMode:'auto'}));return {content:'The two independent tasks are running.'};}
    assert.equal(options.permissionMode,'manual');assert.equal(JSON.stringify(options.history).includes('MAIN_ONLY_PRIVATE_CONTEXT'),false);assert.equal(call.tools.some(t=>t.name==='update_model'),false);await assert.rejects(options.executeTool('update_model',{nodes:[],links:[],version:0}),/not permitted/);await waitForGate(gate.promise,options.signal);return {content:'Actual independent fixture finding from '+call.name};
  });
  t.after(()=>gate.resolve());const {run}=await completed(h,{content:'MAIN_ONLY_PRIVATE_CONTEXT dispatch tasks',permissionMode:'manual'});await eventually(()=>h.calls.length===3,'both worker runtimes');assert.equal(run.status,'completed');assert.equal(h.store.data.runs.filter(r=>r.source==='delegated'&&r.status==='running').length,2);assert.equal(results.length,2);assert.ok(results.every(r=>r.asynchronous&&r.run.permissionMode==='manual'));assert.deepEqual(new Set(h.calls.map(c=>c.name)),new Set(NAMES));assert.equal(new Set(h.calls.map(c=>c.sessionId)).size,3);
  gate.resolve();await eventually(()=>h.store.data.runs.filter(r=>r.source==='delegated'&&r.status==='completed').length===2);const returned=h.store.data.messages.filter(m=>m.threadId===h.thread.id&&m.type==='thread.result');assert.equal(returned.length,2);assert.ok(returned.every(m=>m.metadata.result.summary.includes('Actual independent fixture finding')));
});

test('Native steering is delivered to the live handle; permission changes apply only to the next run and cancellation aborts the runtime',async t=>{
  const gate=deferred();const h=await fixture(t,async call=>{if(call.options.input==='Hold this native turn')await waitForGate(gate.promise,call.options.signal);return {content:'The next instruction was completed.'};});t.after(()=>gate.resolve());
  const {run}=h.engine.start({threadId:h.thread.id,providerId:'codex-local',content:'Hold this native turn',permissionMode:'manual'});await eventually(()=>h.calls.length===1,'native active turn');const call=h.calls[0],steered=h.engine.steer({threadId:h.thread.id,content:'Also compare fault detection',permissionMode:'auto'});await eventually(()=>steered.steering.status==='delivered','runtime steering acknowledgement');assert.match(call.steerings[0],/User steering.*fault detection/);assert.equal(run.permissionMode,'manual');assert.equal(call.options.permissionMode,'manual');assert.equal(steered.nextPermissionMode,'auto');assert.equal(steered.permissionModeEffective,'next-run');
  h.engine.cancel(run.id);await eventually(()=>!h.engine.active.has(run.id),'cancelled native turn');assert.equal(run.status,'cancelled');assert.equal(call.options.signal.aborted,true);assert.ok(h.cancellations.includes(call));assert.equal(run.result,undefined);
  await completed(h,{content:'Continue with the revised permission',permissionMode:undefined});const next=h.calls.at(-1);assert.equal(next.options.permissionMode,'auto');assert.equal(next.options.sessionId,call.sessionId);assert.deepEqual(next.options.history,[]);
});

test('Cancelling a pending native approval rejects the action and clears its real pending state',async t=>{
  let approvalResult;const h=await fixture(t,async({options})=>{approvalResult=await options.requestApproval({tool:'codex.fileChange',args:{native:true,changes:[{path:'draft.md',diff:'+ proposed'}]}});if(options.signal.aborted)throw new Error('Cancelled');return {content:'Must not become a successful completion'};});const {run}=h.engine.start({threadId:h.thread.id,providerId:'codex-local',content:'Request a native edit',permissionMode:'manual'});await eventually(()=>h.store.data.approvals.length===1);h.engine.cancel(run.id);await eventually(()=>!h.engine.active.has(run.id));assert.equal(approvalResult,false);assert.equal(h.store.data.approvals[0].status,'cancelled');assert.equal(run.status,'cancelled');assert.equal(run.result,undefined);assert.equal(h.store.data.messages.some(m=>m.content==='Must not become a successful completion'),false);
});

test('Automatic continuation reuses stable native registration and requires evidence review before spawning',async t=>{
  let forbidden;const h=await fixture(t,async({options})=>{
    if(options.instructions.includes('Role: worker'))return {content:'A documented worker result.'};
    if(options.instructions.includes('This is a bounded automatic synthesis')){assert.ok(options.tools.some(t=>t.name==='start_thread'));forbidden=(await options.executeTool('start_thread',{task:'Must not start before review'})).error;return {content:'Synthesized the actual worker result without starting more work.'};}
    await options.executeTool('start_thread',{task:'Analyze one bounded interface'});return {content:'One worker is running independently.'};
  });h.project.resources.maxAutoResumes=1;h.store.save();await completed(h);await eventually(()=>h.store.data.runs.some(r=>r.source==='auto-summary'&&r.status==='completed'),'bounded auto synthesis');const mainCalls=h.calls.filter(c=>c.options.instructions.includes('Role: coordinator'));assert.equal(mainCalls.length,2);assert.equal(mainCalls[1].options.sessionId,mainCalls[0].sessionId);assert.deepEqual(mainCalls[1].tools.map(t=>t.name),mainCalls[0].tools.map(t=>t.name));assert.deepEqual(mainCalls[1].options.history,[]);assert.equal(mainCalls[1].options.maxTurns,h.project.resources.maxAutoTurns);assert.match(forbidden,/Review.*received/i);assert.equal(h.store.data.threads.filter(t=>t.kind==='worker').length,1);assert.equal(h.project.autoResumeCount,1);assert.ok(h.store.data.messages.filter(m=>m.type==='thread.result').every(m=>m.metadata.summaryStatus==='reported_unreviewed'&&m.metadata.reviewStatus==='unreviewed'));
});

test('All three runtime tool bridges enforce project path and symlink boundaries while retaining legitimate project writes',async t=>{
  const observations=[];const h=await fixture(t,async({options})=>{observations.push(await options.executeTool('read_file',{path:'../outside.txt'}));observations.push(await options.executeTool('read_file',{path:'escape/outside.txt'}));observations.push(await options.executeTool('write_file',{path:'/tmp/out-of-project.md',content:'blocked'}));observations.push(await options.executeTool('write_file',{path:'local-result.md',content:'Actual scoped result'}));return {content:'Project-scoped evidence saved.'};});await fs.writeFile(path.join(h.root,'outside.txt'),'HOST_SENTINEL');await fs.symlink(h.root,path.join(h.store.workspace(h.project.id),'escape'));
  for(const providerId of ['codex-local','claude-local','api-profile'])await completed(h,{providerId});assert.equal(observations.length,12);for(let i=0;i<observations.length;i+=4){assert.ok(observations[i].error);assert.ok(observations[i+1].error);assert.ok(observations[i+2].error);assert.equal(observations[i+3].path,'local-result.md');}assert.equal(JSON.stringify(observations).includes('HOST_SENTINEL'),false);assert.equal(await fs.readFile(path.join(h.store.workspace(h.project.id),'local-result.md'),'utf8'),'Actual scoped result');
});

test('Codex sessions survive model changes and retain endpoint and tool contract isolation',async t=>{
  const h=await fixture(t,async()=>({content:'Configuration recorded.'}));await completed(h);const first=h.calls.at(-1);h.store.patch('providers','codex-local',{model:'another-model'});await completed(h);assert.equal(h.calls.at(-1).options.sessionId,first.sessionId);assert.equal(h.calls.at(-1).options.model,'another-model');h.store.patch('providers','codex-local',{baseUrl:'https://new-responses.example.test/v1'});await completed(h);const changed=h.calls.at(-1);assert.equal(changed.options.sessionId,undefined);assert.notEqual(changed.sessionId,first.sessionId);assert.ok(changed.options.history.length>0);assert.equal(h.thread.runtimeSessionHistory.at(-1).sessionId,first.sessionId);
  const definition=TOOL_DEFINITIONS.find(t=>t.name==='computer_use'),original=definition.description;t.after(()=>{definition.description=original;});definition.description=original+' Updated coordinate semantics for this controlled test.';await completed(h);const contractChanged=h.calls.at(-1);assert.equal(contractChanged.options.sessionId,undefined,'Persisted native dynamic tool descriptions must be refreshed by creating a new session');assert.notEqual(contractChanged.sessionId,changed.sessionId);assert.equal(h.thread.runtimeSessionHistory.at(-1).sessionId,changed.sessionId);
});

test('An explicitly missing native rollout retires only that provider session and the next human turn imports preserved public history',async t=>{
  const h=await fixture(t,async call=>{if(call.options.input==='Trigger an explicit missing native rollout')throw Object.assign(new Error('Codex thread/resume: no rollout found for thread id '+call.sessionId),{code:'NATIVE_SESSION_NOT_FOUND',sessionId:call.sessionId});return {content:'Public engineering finding retained.'};});
  await completed(h,{content:'Original public engineering request'});const missingId=h.calls.at(-1).sessionId;await completed(h,{providerId:'claude-local',content:'Independent provider session'});const otherId=h.calls.at(-1).sessionId,before=h.calls.length;
  const {run}=h.engine.start({threadId:h.thread.id,providerId:'codex-local',content:'Trigger an explicit missing native rollout',permissionMode:'auto'});await eventually(()=>!h.engine.active.has(run.id),'missing native rollout handling');assert.equal(run.status,'failed');assert.equal(run.result,undefined);assert.equal(h.calls.length,before+1,'A failed native resume must not silently call a new model turn');assert.equal(h.thread.runtimeSessions['codex-local'],undefined);assert.equal(h.thread.runtimeSessions['claude-local'].sessionId,otherId);assert.ok(h.thread.runtimeSessionHistory.some(s=>s.sessionId===missingId));assert.ok(h.events.some(e=>e.type==='runtime.session.missing'&&e.runId===run.id));assert.ok(h.store.data.messages.some(m=>m.content==='Original public engineering request'));
  await completed(h,{content:'Continue after the missing native rollout'});const next=h.calls.at(-1);assert.equal(next.options.sessionId,undefined);assert.notEqual(next.sessionId,missingId);assert.ok(next.options.history.some(m=>m.content==='Original public engineering request'));assert.ok(next.options.history.some(m=>m.content==='Public engineering finding retained.'));assert.ok(h.store.data.messages.some(m=>m.content==='Trigger an explicit missing native rollout'));
});


test('Successful workers complete and return results automatically; a direct follow-up reopens the same session',async t=>{
  const gate=deferred();const h=await fixture(t,async({options})=>{if(options.input==='Continue the completed task')await waitForGate(gate.promise,options.signal);return {content:'Recorded result for '+options.input};});t.after(()=>gate.resolve());
  const worker=h.store.createThread(h.project.id,'Automatic completion',h.thread.id,{assignment:'Complete one independent task'});
  const first=await completed(h,{threadId:worker.id,content:'Finish the initial task'}),session=h.calls.at(-1).sessionId;
  assert.equal(worker.status,'resolved');assert.equal(h.engine.overview(worker).status,'resolved');assert.equal(h.engine.overview(worker).executionStatus,'completed');assert.equal(h.engine.listThreads(h.project.id).counts.resolved,1);
  assert.equal(h.thread.status,'open','The durable main conversation never auto-resolves');
  const results=()=>h.store.data.messages.filter(m=>m.type==='thread.result'&&m.metadata.taskThreadId===worker.id);
  assert.equal(results().length,1);assert.equal(results()[0].metadata.runId,first.run.id);assert.equal(results()[0].metadata.status,'completed');assert.equal(results()[0].metadata.result.summary,'Recorded result for Finish the initial task');
  h.engine.cancel(first.run.id);assert.equal(results().length,1,'Repeated terminal actions must not repost a returned result');
  const second=h.engine.steer({threadId:worker.id,content:'Continue the completed task',providerId:'codex-local'});
  assert.equal(second.thread.status,'open');assert.equal(worker.status,'open');assert.equal(h.engine.listThreads(h.project.id).counts.resolved,0);await eventually(()=>h.calls.length===2);assert.equal(h.calls.at(-1).options.sessionId,session);
  gate.resolve();await eventually(()=>!h.engine.active.has(second.run.id));assert.equal(second.run.status,'completed');assert.equal(worker.status,'resolved');assert.equal(results().length,2);assert.equal(new Set(results().map(m=>m.metadata.runId)).size,2);assert.equal(h.events.filter(e=>e.type==='thread.result'&&e.data.threadId===worker.id).length,2);
  await completed(h,{content:'Main conversation remains available'});assert.equal(h.thread.status,'open');assert.equal(h.engine.overview(h.thread).status,'open');
});

test('A failed or cancelled follow-up supersedes previous worker success, and a retry can complete normally',async t=>{
  const gate=deferred();const h=await fixture(t,async({options})=>{if(options.input==='Fail this attempt')throw new Error('Recorded fixture failure');if(options.input==='Cancel this attempt')await waitForGate(gate.promise,options.signal);return {content:'Successful fixture task'};});t.after(()=>gate.resolve());
  const worker=h.store.createThread(h.project.id,'Retryable worker',h.thread.id);
  await completed(h,{threadId:worker.id});assert.equal(worker.status,'resolved');
  const failed=h.engine.start({threadId:worker.id,providerId:'codex-local',content:'Fail this attempt'});await eventually(()=>!h.engine.active.has(failed.run.id));assert.equal(failed.run.status,'failed');assert.equal(worker.status,'open');assert.equal(h.engine.overview(worker).status,'open');assert.equal(h.engine.overview(worker).executionStatus,'failed');assert.equal(h.engine.listThreads(h.project.id).counts.resolved,0);
  await completed(h,{threadId:worker.id,content:'Retry the failed attempt'});assert.equal(worker.status,'resolved');
  const cancelled=h.engine.start({threadId:worker.id,providerId:'codex-local',content:'Cancel this attempt'});await eventually(()=>h.calls.at(-1)?.options.input==='Cancel this attempt');h.engine.cancel(cancelled.run.id);await eventually(()=>!h.engine.active.has(cancelled.run.id));assert.equal(cancelled.run.status,'cancelled');assert.equal(worker.status,'open');assert.equal(h.engine.overview(worker).status,'open');assert.equal(h.engine.overview(worker).executionStatus,'cancelled');
  const returns=h.store.data.messages.filter(m=>m.type==='thread.result'&&m.metadata.taskThreadId===worker.id);assert.deepEqual(returns.map(m=>m.metadata.status),['completed','failed','completed','cancelled']);assert.equal(new Set(returns.map(m=>m.metadata.runId)).size,4);
  await completed(h,{threadId:worker.id,content:'Retry after cancellation'});assert.equal(worker.status,'resolved');assert.equal(h.engine.overview(worker).status,'resolved');
});

test('Persisted worker overview derives completion from the latest run without rewriting historical thread state',async t=>{
  const h=await fixture(t,async()=>({content:'unused fixture response'}));const workers=[];
  for(const [index,status]of ['completed','failed','cancelled','interrupted'].entries()){
    const worker=h.store.createThread(h.project.id,'Historical '+status,h.thread.id);worker.status=status==='completed'?'open':'resolved';workers.push(worker);
    h.store.data.runs.push({id:'historical-success-'+index,threadId:worker.id,projectId:h.project.id,status:'completed',createdAt:'2026-01-01T00:00:00.000Z',finishedAt:'2026-01-01T00:01:00.000Z'});
    if(status!=='completed')h.store.data.runs.push({id:'historical-latest-'+index,threadId:worker.id,projectId:h.project.id,status,createdAt:'2026-01-01T00:02:00.000Z',finishedAt:'2026-01-01T00:03:00.000Z'});
  }
  h.store.save();await h.engine.close();const restarted=h.open(),before=JSON.stringify(restarted.store.data.threads),view=restarted.engine.listThreads(h.project.id);
  assert.equal(view.threads.find(x=>x.id===workers[0].id).status,'resolved');for(const worker of workers.slice(1))assert.equal(view.threads.find(x=>x.id===worker.id).status,'open');assert.equal(view.counts.resolved,1);assert.equal(JSON.stringify(restarted.store.data.threads),before,'Read-only overview must not migrate or rewrite saved conversations');assert.equal(restarted.store.data.messages.some(m=>m.type==='thread.result'),false,'Reading historical completion must not replay notifications or create new model work');
});


test('Claude effective permission fallback is persisted without changing the authorized run mode',async t=>{
  let actual='default';const h=await fixture(t,async({options})=>{
    options.onEvent({type:'runtime.permission_mode',message:'Native permissions',data:{requestedPermissionMode:'auto',effectivePermissionMode:actual,autoModeAvailable:actual==='auto'}});
    return {content:'Native permissions recorded'};
  });
  const first=await completed(h,{providerId:'claude-local'});assert.equal(first.run.permissionMode,'auto');assert.equal(first.run.nativePermissionMode,'default');assert.equal(first.run.nativeAutoAvailable,false);assert.match(first.run.permissionNotice,/未启用 Auto/);
  const saved=JSON.parse(await fs.readFile(path.join(h.dataDir,'state.json'),'utf8')).runs.find(r=>r.id===first.run.id);assert.equal(saved.nativePermissionMode,'default');assert.equal(saved.permissionNotice,first.run.permissionNotice);
  actual=null;const unknown=await completed(h,{providerId:'claude-local'});assert.equal(unknown.run.nativePermissionMode,null);assert.equal(unknown.run.nativeAutoAvailable,false);assert.match(unknown.run.permissionNotice,/尚未确认/);
  actual='auto';const available=await completed(h,{providerId:'claude-local'});assert.equal(available.run.nativePermissionMode,'auto');assert.equal(available.run.nativeAutoAvailable,true);assert.equal(available.run.permissionNotice,null);
});


test('Codex model choices persist per thread and provider without changing shared profiles',async t=>{
  const h=await fixture(t,async({options})=>({content:'Selected '+options.model}));
  h.store.patch('providers','codex-local',{model:'profile-default'});
  const alternate={id:'codex-custom',name:'Custom Codex fixture',type:'codex-app-server',model:'custom-default'};h.store.add('providers',alternate);
  const initial=await completed(h,{model:'  model-for-main  '});assert.equal(initial.run.model,'model-for-main');assert.equal(h.calls.at(-1).options.model,'model-for-main');assert.equal(h.thread.modelPreferences['codex-local'],'model-for-main');assert.equal(h.store.get('providers','codex-local').model,'profile-default');
  const session=h.calls.at(-1).sessionId;await completed(h);assert.equal(h.calls.at(-1).options.model,'model-for-main');assert.equal(h.calls.at(-1).options.sessionId,session);
  await completed(h,{providerId:'codex-custom',model:'alternate-model'});assert.equal(h.thread.modelPreferences['codex-custom'],'alternate-model');assert.equal(h.store.get('providers','codex-custom').model,'custom-default');
  const worker=h.store.createThread(h.project.id,'Another thread',h.thread.id);await completed(h,{threadId:worker.id});assert.equal(h.calls.at(-1).options.model,'profile-default');assert.equal(worker.modelPreferences,undefined);
  await h.engine.close();const reopened=h.open(),main=reopened.store.get('threads',h.thread.id);assert.deepEqual(main.modelPreferences,{'codex-local':'model-for-main','codex-custom':'alternate-model'});
  await completed({...h,...reopened});assert.equal(h.calls.at(-1).options.model,'model-for-main');assert.equal(h.calls.at(-1).options.sessionId,session);
  await completed({...h,...reopened},{providerId:'codex-custom'});assert.equal(h.calls.at(-1).options.model,'alternate-model');
  const preference=reopened.engine.setThreadModelPreference({threadId:h.thread.id,providerId:'codex-local',model:''});assert.equal(preference.modelPreferences['codex-local'],'');
  const reset=await completed({...h,...reopened});assert.equal(reset.run.model,'profile-default');assert.equal(h.calls.at(-1).options.model,'profile-default');assert.equal(h.calls.at(-1).options.sessionId,session);
});

test('Codex selections validate input, preserve run snapshots and apply active steering choices on the next run',async t=>{
  const gate=deferred(),h=await fixture(t,async call=>{if(call.options.input==='Hold model snapshot')await waitForGate(gate.promise,call.options.signal);return {content:'Snapshot completed'};});t.after(()=>gate.resolve());
  h.store.patch('providers','codex-local',{model:'profile-model'});
  for(const model of [null,12,{},'x'.repeat(201),'model\nline','bad\x00model'])assert.throws(()=>h.engine.start({threadId:h.thread.id,providerId:'codex-local',content:'Invalid model',model}),/model must/);
  assert.throws(()=>h.engine.start({threadId:h.thread.id,providerId:'claude-local',content:'Invalid runtime override',model:'cannot-override'}),/Codex providers only/);
  assert.throws(()=>h.engine.setThreadModelPreference({threadId:h.thread.id,providerId:'api-profile',model:'cannot-override'}),/Codex providers only/);
  const {run}=h.engine.start({threadId:h.thread.id,providerId:'codex-local',model:'model-at-start',content:'Hold model snapshot'});
  h.store.patch('providers','codex-local',{model:'profile-changed-after-queue'});h.engine.setThreadModelPreference({threadId:h.thread.id,providerId:'codex-local',model:'changed-before-launch'});
  await eventually(()=>h.calls.length===1);assert.equal(run.model,'model-at-start');assert.equal(h.calls[0].options.model,'model-at-start');
  const steered=h.engine.steer({threadId:h.thread.id,content:'Also inspect timing',model:'model-next-run'});await eventually(()=>steered.steering.status==='delivered');assert.equal(steered.modelEffective,'next-run');assert.equal(run.model,'model-at-start');assert.equal(h.calls[0].options.model,'model-at-start');assert.equal(h.thread.modelPreferences['codex-local'],'model-next-run');
  gate.resolve();await eventually(()=>!h.engine.active.has(run.id));await completed(h);assert.equal(h.calls.at(-1).options.model,'model-next-run');assert.equal(h.calls.at(-1).options.sessionId,h.calls[0].sessionId);
});

test('Workers inherit their origin run model snapshot and other providers keep independent defaults',async t=>{
  const models=[],h=await fixture(t,async({options})=>{
    if(options.instructions.includes('Role: coordinator')){
      h.engine.setThreadModelPreference({threadId:h.thread.id,providerId:'codex-local',model:'main-next-model'});
      await options.executeTool('start_thread',{name:'Inherited model worker',task:'Read inherited model'});
      await options.executeTool('start_thread',{name:'Different Codex provider',task:'Read separate profile',providerId:'codex-custom'});
      await options.executeTool('start_thread',{name:'Claude worker',task:'Read Claude profile',providerId:'claude-local'});
    }else models.push({providerId:options.providerId,model:options.model});
    return {content:'Worker model checked'};
  });h.store.add('providers',{id:'codex-custom',name:'Separate Codex fixture',type:'codex-app-server',model:'separate-default'});
  const main=await completed(h,{model:'origin-model'});await eventually(()=>models.length===3);assert.equal(main.run.model,'origin-model');
  assert.deepEqual(models.find(m=>m.providerId==='codex-local'),{providerId:'codex-local',model:'origin-model'});assert.deepEqual(models.find(m=>m.providerId==='codex-custom'),{providerId:'codex-custom',model:'separate-default'});assert.equal(h.store.data.runs.find(r=>r.source==='delegated'&&r.providerId==='codex-custom').model,'separate-default');assert.equal(h.thread.modelPreferences['codex-local'],'main-next-model');
  assert.equal(models.find(m=>m.providerId==='claude-local').model,h.store.get('providers','claude-local').model);assert.ok(h.store.data.runs.filter(r=>r.source==='delegated'&&r.providerId==='codex-local').every(r=>r.model==='origin-model'));const worker=h.store.data.threads.find(t=>t.title==='Inherited model worker');assert.equal(worker.modelPreferences['codex-local'],'origin-model');await completed(h,{threadId:worker.id,content:'Continue independently'});assert.equal(h.calls.at(-1).options.model,'origin-model');
});

test('Automatic result synthesis uses the main thread preference instead of a worker model',async t=>{
  const h=await fixture(t,async({options})=>{
    if(options.instructions.includes('Role: worker'))return {content:'Actual worker evidence'};
    if(options.instructions.includes('This is a bounded automatic synthesis'))return {content:'Summary on main preference'};
    await options.executeTool('start_thread',{task:'Bounded worker evidence'});
    h.engine.setThreadModelPreference({threadId:h.thread.id,providerId:'codex-local',model:'main-summary-model'});return {content:'Worker dispatched'};
  });h.project.resources.maxAutoResumes=1;h.store.save();await completed(h,{model:'initial-model'});await eventually(()=>h.store.data.runs.some(r=>r.source==='auto-summary'&&r.status==='completed'));
  const summary=h.store.data.runs.find(r=>r.source==='auto-summary');assert.equal(summary.model,'main-summary-model');const main=h.calls.filter(c=>c.options.instructions.includes('Role: coordinator'));assert.equal(main.at(-1).options.model,'main-summary-model');assert.equal(main.at(-1).options.sessionId,main[0].sessionId);
});

test('Clearing a specific Codex model restores native defaults without silently inheriting the old model',async t=>{
  const h=await fixture(t,async()=>({content:'Native default checked'}));h.store.patch('providers','codex-local',{model:''});
  const first=await completed(h,{model:'explicit-selection'}),firstSession=first.run.runtimeSessionId;assert.equal(h.calls.at(-1).options.model,'explicit-selection');
  const next=await completed(h,{model:''});assert.equal(next.run.model,null);assert.equal(h.calls.at(-1).options.model,null);assert.equal(h.calls.at(-1).options.sessionId,undefined);assert.notEqual(next.run.runtimeSessionId,firstSession);assert.ok(h.calls.at(-1).options.history.length);assert.equal(h.thread.runtimeSessionHistory.at(-1).reason,'native-model-default-reset');
  const session=next.run.runtimeSessionId;await completed(h);assert.equal(h.calls.at(-1).options.sessionId,session);assert.equal(h.calls.at(-1).options.model,null);
});

test('Other runtime session signatures still replace sessions when their profile model changes',async t=>{
  const h=await fixture(t,async()=>({content:'Non Codex model checked'}));await completed(h,{providerId:'claude-local'});const first=h.calls.at(-1).sessionId;h.store.patch('providers','claude-local',{model:'different-claude-model'});await completed(h,{providerId:'claude-local'});assert.equal(h.calls.at(-1).options.model,'different-claude-model');assert.equal(h.calls.at(-1).options.sessionId,undefined);assert.notEqual(h.calls.at(-1).sessionId,first);
});


test('Native model response metadata is saved separately from the selected model snapshot',async t=>{
  let report=true;const h=await fixture(t,async call=>{if(report)call.options.onSession(call.sessionId,{model:'native-resolved-model'});return {content:'Actual model metadata recorded'};});
  const first=await completed(h,{model:'requested-model'});assert.equal(first.run.model,'requested-model');assert.equal(first.run.resolvedModel,'native-resolved-model');assert.equal(h.thread.runtimeSessions['codex-local'].model,'native-resolved-model');assert.equal(h.thread.runtimeSessions['codex-local'].requestedModel,'requested-model');assert.equal(h.events.findLast(e=>e.type==='runtime.session').data.model,'native-resolved-model');
  report=false;const next=await completed(h,{model:'different-request'});assert.equal(next.run.model,'different-request');assert.equal(next.run.resolvedModel,undefined);assert.equal(h.thread.runtimeSessions['codex-local'].model,undefined);assert.equal(h.events.findLast(e=>e.type==='runtime.session').data.model,undefined);
});


test('Existing Codex sessions migrate their matching legacy signature and survive a model selection upgrade',async t=>{
  const h=await fixture(t,async()=>({content:'Legacy conversation preserved'}));h.store.patch('providers','codex-local',{model:'old-profile-model'});await completed(h);const session=h.thread.runtimeSessions['codex-local'],sessionId=session.sessionId;
  session.signature=createHash('sha256').update(JSON.stringify({runtime:'codex-app-server',workspace:h.store.workspace(h.project.id),model:'old-profile-model',baseUrl:'',tools:h.engine.runtime.definitions.map(t=>({name:t.name,description:t.description,parameters:t.parameters}))})).digest('hex');delete session.requestedModel;h.store.save();
  await h.engine.close();const restarted=h.open();await completed({...h,...restarted},{model:'new-turn-model'});assert.equal(h.calls.at(-1).options.sessionId,sessionId);assert.deepEqual(h.calls.at(-1).options.history,[]);assert.equal(h.calls.at(-1).options.model,'new-turn-model');assert.equal(restarted.store.get('threads',h.thread.id).runtimeSessionHistory,undefined);
});

test('execution budget expiry is interrupted with the application reason, preserving the native session',async t=>{const gate=deferred(),h=await fixture(t,async({options})=>{await waitForGate(gate.promise,options.signal);return {content:'unreachable'};},{runTimeoutMs:30});const {run}=h.engine.start({threadId:h.thread.id,providerId:'codex-local',content:'Long native task',permissionMode:'auto'});await eventually(()=>!h.engine.active.has(run.id));assert.equal(run.status,'interrupted');assert.equal(run.stopReason,'execution-time-limit');assert.match(run.error,/执行时限/);assert.ok(h.store.get('threads',h.thread.id).runtimeSessions['codex-local'].sessionId);assert.ok(h.store.data.messages.some(m=>m.runId===run.id&&m.content.includes('运行已中断')));});
