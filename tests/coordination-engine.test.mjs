import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStore,id,now} from '../server/store.mjs';
import {createEngine} from '../server/engine.mjs';

const RUNTIMES=['codex-app-server','claude-agent-sdk','openai-agents-sdk'];
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function eventually(check,label='condition',timeout=3000){const end=Date.now()+timeout;while(Date.now()<end){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Timed out: '+label);}
function gate(promise,signal){let abort;return new Promise((resolve,reject)=>{abort=()=>reject(Object.assign(new Error('Native fixture interrupted'),{name:'AbortError'}));if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});promise.then(resolve,reject);}).finally(()=>signal.removeEventListener('abort',abort));}
async function fixture(t,handler,{resources={},runTimeoutMs=4000,autoResumeDebounceMs=5,webFetcher}={}){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'manta-coordination-engine-'))),dataDir=path.join(root,'data'),store=createStore({dataDir,seed:false}),calls=[],events=[];let sequence=0;
  store.add('providers',{id:'api-profile',name:'Custom API fixture',type:'openai-responses',baseUrl:'https://example.test/v1',model:'fixture'});
  const providers={getConfig:key=>structuredClone(store.get('providers',key)),list:()=>store.data.providers.map(p=>({...p,configured:true})),redact:value=>String(value),complete(){throw new Error('No inner Agent loop may replace native adapters');}};
  const adapters=Object.fromEntries(RUNTIMES.map(name=>[name,{startTurn(options){
    const sessionId=options.sessionId||name+'-session-'+(++sequence),call={name,options,sessionId,steerings:[]};calls.push(call);
    const completion=Promise.resolve().then(async()=>{options.onSession(sessionId);const result=await handler(call);return {sessionId,content:'Fixture finding',...result};});
    return {completion,async steer(text){call.steerings.push(text);return {accepted:true,delivery:'native-fixture'};},cancel(){call.cancelled=true;}};
  }}]));
  const engine=createEngine({store,providers,runtimeAdapters:adapters,autoResumeDebounceMs,runTimeoutMs,webFetcher,emit:event=>{const recorded={id:id('event'),createdAt:now(),...structuredClone(event)};events.push(recorded);store.data.events.push(recorded);store.save();}});
  const project=store.createProject({name:'Evidence handoff integration',resources:{maxAutoResumes:2,...resources}}),thread=store.get('threads',project.coordinatorThreadId);
  const h={root,dataDir,store,engine,project,thread,calls,events};
  t.after(async()=>{await engine.close();await fs.rm(root,{recursive:true,force:true});});return h;
}
function start(h,args={}){return h.engine.start({threadId:h.thread.id,providerId:'codex-local',permissionMode:'auto',content:'MAIN_TASK',...args});}
async function finished(h,run){await eventually(()=>!h.engine.active.has(run.id),'run '+run.id+' finishing');assert.equal(run.status,'completed',run.error);}
const main=call=>call.options.instructions.includes('Role: coordinator');
async function artifact(options,name='result.md'){const result=await options.executeTool('create_artifact',{name,content:'Recorded fixture source and analytical result'});assert.ok(result.id,result.error);return result;}
function review(result,evidence,outcome='accepted'){return {threadId:result.threadId,runId:result.runId,outcome,findings:outcome==='accepted'?'Inspected the recorded source and checked task acceptance criteria.':'The task did not complete; no successful verification is claimed.',evidence};}

for(const providerId of ['codex-local','claude-local'])test(providerId+' worker cannot create or coordinate another thread but returns a reviewable result to Coordinator',async t=>{
  let h,worker,workerTools;
  h=await fixture(t,async call=>{
    const {options}=call;
    if(!main(call)){
      workerTools=options.tools.map(tool=>tool.name);
      for(const name of ['start_thread','delegate_task','wait_threads','review_task_results','route_user_message'])assert.ok(!workerTools.includes(name),`Worker must not receive ${name}`);
      assert.ok(workerTools.includes('steer_thread'),'Worker can report to its Coordinator');
      await artifact(options,'direct-result.md');
      return {content:'Direct evidence for Coordinator review'};
    }
    worker=await options.executeTool('start_thread',{task:'DIRECT_WORKER',taskKey:'direct-worker'});
    assert.ok(worker.thread?.id,JSON.stringify(worker));
    const handoff=await options.executeTool('wait_threads',{threadIds:[worker.thread.id]});
    assert.equal(handoff.results[0].runId,worker.run.id);
    const result=await options.executeTool('review_task_results',{reviews:[review(handoff.results[0],[handoff.results[0].artifacts[0].id])]});
    assert.equal(result.reviews[0].outcome,'accepted',result.error);
    return {content:'Coordinator reviewed the worker evidence'};
  });
  const {run}=start(h,{providerId});await finished(h,run);
  assert.equal(h.store.get('threads',worker.thread.id).parentThreadId,h.thread.id);
  assert.equal(h.store.data.threads.filter(row=>row.kind==='worker').length,1);
  assert.ok(workerTools.includes('create_artifact'));
});

for(const providerId of ['codex-local','claude-local','api-profile'])test(providerId+' waits inside one native turn, reviews actual evidence and produces one synthesis',async t=>{
  const workerGate=deferred();let h,assignment,handoff,reviewed;
  h=await fixture(t,async call=>{
    const {options}=call;
    if(!main(call)){await gate(workerGate.promise,options.signal);await artifact(options);return {content:'Source-backed independent result'};}
    assignment=await options.executeTool('start_thread',{name:'Source investigation',task:'WORKER_SOURCE',taskKey:'source',scope:'Investigate only the delegated source',ownedPaths:['analysis/source'],acceptanceCriteria:['Return source references']});
    assert.ok(assignment.thread?.id,assignment.error);
    const registry=await options.executeTool('get_task_assignments',{});assert.equal(registry.assignments.length,1);assert.equal(registry.assignments[0].scope,'Investigate only the delegated source');
    handoff=await options.executeTool('wait_threads',{reason:'Need the source result before drawing conclusions'});
    assert.equal(handoff.status,'ready',handoff.error);assert.equal(handoff.pending.length,0);assert.equal(handoff.results.length,1);assert.equal(handoff.results[0].runId,assignment.run.id);assert.equal(handoff.results[0].artifacts.length,1);
    assert.equal(h.store.get('runs',assignment.run.parentRunId).executionPhase,'reviewing');
    reviewed=await options.executeTool('review_task_results',{reviews:[review(handoff.results[0],[handoff.results[0].artifacts[0].id])]});assert.equal(reviewed.reviews[0].outcome,'accepted',reviewed.error);
    assert.equal(h.store.get('runs',assignment.run.parentRunId).executionPhase,'summarizing');return {content:'Reviewed and synthesized the recorded source result.'};
  });
  const {run}=start(h,{providerId});await eventually(()=>run.executionPhase==='waiting_tasks','native Agent waiting state');
  assert.equal(h.calls.length,2);assert.equal(h.calls[0].options.signal.aborted,false);assert.equal(run.status,'running');
  workerGate.resolve();await finished(h,run);await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(h.calls.length,2,'Waiting must not add inference calls or trigger duplicate automatic summary turns');assert.equal(h.calls[0].name,h.calls[1].name);assert.equal(h.store.data.runs.filter(r=>r.source==='auto-summary').length,0);
  assert.equal(h.store.get('threads',assignment.thread.id).lastReview.reviewedByRunId,run.id);
  const saved=createStore({dataDir:h.dataDir,seed:false});assert.equal(saved.get('runs',assignment.run.id).review.outcome,'accepted');
  assert.ok(h.events.some(e=>e.type==='coordination.wait.started'&&e.runId===run.id));assert.ok(h.events.some(e=>e.type==='coordination.results.reviewed'&&e.runId===run.id));
});

test('any and all waits join the exact out-of-order worker runs without repeated synthesis',async t=>{
  const aGate=deferred(),bGate=deferred();let h,a,b,first,second;
  h=await fixture(t,async call=>{
    const {options}=call;if(!main(call)){await gate(options.input==='TASK_A'?aGate.promise:bGate.promise,options.signal);await artifact(options,options.input+'.md');return {content:'Returned '+options.input};}
    a=await options.executeTool('start_thread',{task:'TASK_A',taskKey:'a'});b=await options.executeTool('start_thread',{task:'TASK_B',taskKey:'b'});
    first=await options.executeTool('wait_threads',{threadIds:[a.thread.id,b.thread.id],mode:'any'});assert.equal(first.status,'ready',first.error);assert.deepEqual(first.results.map(r=>r.runId),[b.run.id]);assert.deepEqual(first.pending.map(r=>r.runId),[a.run.id]);
    await options.executeTool('review_task_results',{reviews:[review(first.results[0],[first.results[0].artifacts[0].id])]});
    second=await options.executeTool('wait_threads',{threadIds:[a.thread.id,b.thread.id],mode:'all'});assert.deepEqual(new Set(second.results.map(r=>r.runId)),new Set([a.run.id,b.run.id]));assert.equal(second.pending.length,0);
    const aResult=second.results.find(r=>r.runId===a.run.id);await options.executeTool('review_task_results',{reviews:[review(aResult,[aResult.artifacts[0].id])]});return {content:'Both exact task attempts reviewed.'};
  });const {run}=start(h);await eventually(()=>run.executionPhase==='waiting_tasks'&&h.calls.length===3);bGate.resolve();await eventually(()=>first?.status==='ready'&&run.executionPhase==='waiting_tasks','all wait after partial return');assert.equal(h.store.get('runs',a.run.id).status,'running');aGate.resolve();await finished(h,run);await new Promise(resolve=>setTimeout(resolve,30));assert.equal(h.calls.length,3);assert.equal(h.store.data.runs.filter(r=>r.source==='auto-summary').length,0);
});

test('an active task key is reused, overlapping scopes are rejected and parent writes respect ownership',async t=>{
  const workerGate=deferred();let h,assignment,reused,overlap,blocked;
  h=await fixture(t,async call=>{
    const {options}=call;if(!main(call)){await gate(workerGate.promise,options.signal);await artifact(options);return {content:'Owned source result'};}
    assignment=await options.executeTool('start_thread',{task:'OWNED_SOURCE',taskKey:'source',ownedPaths:['src/sensor']});reused=await options.executeTool('start_thread',{task:'Do not duplicate the source task',taskKey:'source',ownedPaths:['src/sensor']});assert.equal(reused.reused,true);assert.equal(reused.thread.id,assignment.thread.id);assert.equal(reused.run.id,assignment.run.id);
    overlap=await options.executeTool('start_thread',{task:'Conflicting work',taskKey:'conflict',ownedPaths:['src/sensor/transform.c']});assert.match(overlap.error,/owned|scope|assigned/i);
    blocked=await options.executeTool('write_file',{path:'src/sensor/transform.c',content:'Must not overwrite another active task'});assert.match(blocked.error,/assigned|owned/i);
    assert.equal((await options.executeTool('read_file',{path:'src/sensor/reference.c'})).content,'Source evidence');
    assert.equal((await options.executeTool('write_file',{path:'review/notes.md',content:'Independent reviewer notes'})).path,'review/notes.md');
    const handoff=await options.executeTool('wait_threads',{});await options.executeTool('review_task_results',{reviews:[review(handoff.results[0],[handoff.results[0].artifacts[0].id])]});
    assert.equal((await options.executeTool('write_file',{path:'src/sensor/transform.c',content:'Reviewed integration after worker completion'})).path,'src/sensor/transform.c');return {content:'No duplicate assignment or concurrent overwrite.'};
  });const folder=h.store.workspace(h.project.id);await fs.mkdir(path.join(folder,'src/sensor'),{recursive:true});await fs.writeFile(path.join(folder,'src/sensor/reference.c'),'Source evidence');const {run}=start(h);await eventually(()=>run.executionPhase==='waiting_tasks');assert.equal(run.tasksCreated,1);assert.equal(h.store.data.threads.filter(t=>t.kind==='worker').length,1);assert.equal(await fs.stat(path.join(folder,'src/sensor/transform.c')).catch(()=>null),null);workerGate.resolve();await finished(h,run);assert.equal(h.calls.length,2);
});

test('Coordinator source fetches wait for an owning thread and its handoff is a standalone chat receipt',async t=>{
  const workerGate=deferred();let h,assignment;const fetchedUrls=[];
  h=await fixture(t,async call=>{
    const {options}=call;
    if(!main(call)){
      const source=await options.executeTool('web_fetch',{url:'https://example.org/worker-source'});
      assert.equal(source.text,'Bounded source fixture');
      await gate(workerGate.promise,options.signal);
      return {content:'Worker returned source findings for review.'};
    }
    assignment=await options.executeTool('start_thread',{name:'Public sources',task:'Investigate primary public sources',taskKey:'source-investigation',workKind:'public_sources'});
    assert.equal(assignment.thread.taskContract.workKind,'public_sources');
    const blocked=await options.executeTool('web_fetch',{url:'https://example.org/duplicate'});
    assert.match(blocked.error,/assigned to Public sources/);
    assert.equal(fetchedUrls.includes('https://example.org/duplicate'),false,'Coordinator must not issue a network request while the worker owns source research');
    const handoff=await options.executeTool('wait_threads',{threadIds:[assignment.thread.id]});
    assert.equal(handoff.results[0].runId,assignment.run.id);
    const independent=await options.executeTool('web_fetch',{url:'https://example.org/review'});
    assert.equal(independent.text,'Bounded source fixture');
    return {content:'Source task handed off; independent review may proceed.'};
  },{resources:{maxAutoResumes:0},webFetcher:async url=>{fetchedUrls.push(url);return {text:'Bounded source fixture'};}});
  const {run}=start(h);await eventually(()=>run.executionPhase==='waiting_tasks'||!h.engine.active.has(run.id));
  assert.equal(run.executionPhase,'waiting_tasks',run.error||'Coordinator ended before waiting for public sources');
  workerGate.resolve();await finished(h,run);
  assert.deepEqual(fetchedUrls.sort(),['https://example.org/review','https://example.org/worker-source']);
  const receipt=h.store.data.messages.find(m=>m.threadId===h.thread.id&&m.type==='thread.result'&&m.metadata?.runId===assignment.run.id);
  assert.ok(receipt);
  assert.equal(Object.hasOwn(receipt,'runId'),false,'Worker handoff must not be folded into an old Coordinator run');
  assert.equal(receipt.metadata.parentRunId,run.id);
  assert.equal(receipt.metadata.result.summary,'Worker returned source findings for review.');
});

test('failed and cancelled tasks return as failures and cannot be accepted with unrelated successful evidence',async t=>{
  const hold=deferred();let h,failed,cancelled,received;
  h=await fixture(t,async call=>{
    const {options}=call;if(!main(call)){if(options.input==='FAIL_TASK')throw new Error('Actual solver fixture failure');await gate(hold.promise,options.signal);return {content:'Must not become a successful cancelled result'};}
    failed=await options.executeTool('start_thread',{task:'FAIL_TASK',taskKey:'failed'});cancelled=await options.executeTool('start_thread',{task:'CANCEL_TASK',taskKey:'cancelled'});received=await options.executeTool('wait_threads',{});
    assert.deepEqual(new Set(received.results.map(r=>r.status)),new Set(['failed','cancelled']));const ownEvidence=await artifact(options,'review-attempt.md');
    for(const result of received.results){const refusal=await options.executeTool('review_task_results',{reviews:[review(result,[ownEvidence.id])]});assert.match(refusal.error,/failed|cancelled|accepted/i);}
    const recorded=await options.executeTool('review_task_results',{reviews:received.results.map(r=>review(r,[],r.status==='failed'?'needs_work':'blocked'))});assert.equal(recorded.reviews.length,2,recorded.error);return {content:'Failures recorded without claiming passed validation.'};
  });const {run}=start(h);await eventually(()=>cancelled?.run&&run.executionPhase==='waiting_tasks');h.engine.cancel(cancelled.run.id);await finished(h,run);assert.equal(h.store.get('threads',failed.thread.id).lastReview.outcome,'needs_work');assert.equal(h.store.get('threads',cancelled.thread.id).lastReview.outcome,'blocked');
});

test('human steering releases a dependency wait and reaches the same native turn while workers continue',async t=>{
  const workerGate=deferred(),parentGate=deferred();let h,assignment,handoff;
  h=await fixture(t,async call=>{
    const {options}=call;if(!main(call)){await gate(workerGate.promise,options.signal);await artifact(options);return {content:'Background worker completed independently'};}
    assignment=await options.executeTool('start_thread',{task:'BACKGROUND_WORK',taskKey:'background'});handoff=await options.executeTool('wait_threads',{});assert.equal(handoff.status,'steering',handoff.error);assert.equal(handoff.pending.length,1);await gate(parentGate.promise,options.signal);return {content:'Handled the user steering without cancelling the worker.'};
  },{resources:{maxAutoResumes:0}});const {run}=start(h);await eventually(()=>run.executionPhase==='waiting_tasks');const result=h.engine.steer({threadId:h.thread.id,content:'Pause the synthesis and explain the dependency first'});await eventually(()=>handoff&&result.steering.status==='delivered');assert.equal(h.calls.length,2);assert.match(h.calls[0].steerings[0],/explain the dependency/);assert.equal(h.store.get('runs',assignment.run.id).status,'running');assert.equal(h.calls[1].options.signal.aborted,false);parentGate.resolve();await finished(h,run);workerGate.resolve();await eventually(()=>!h.engine.active.has(assignment.run.id));
});

test('cancelling the waiting parent settles its pending Promise without cancelling independent workers',async t=>{
  const workerGate=deferred();let h,assignment;
  h=await fixture(t,async call=>{
    const {options}=call;if(!main(call)){await gate(workerGate.promise,options.signal);return {content:'Independent task survived parent cancellation'};}
    assignment=await options.executeTool('start_thread',{task:'WORKER_UNDER_CANCELLED_PARENT',taskKey:'survivor'});await options.executeTool('wait_threads',{});return {content:'Must not claim cancelled synthesis succeeded'};
  },{resources:{maxAutoResumes:0}});const {run}=start(h);await eventually(()=>run.executionPhase==='waiting_tasks');h.engine.cancel(run.id);await eventually(()=>!h.engine.active.has(run.id),'cancelled wait settlement');assert.equal(run.status,'cancelled');assert.equal(h.calls[0].options.signal.aborted,true);assert.equal(h.calls[1].options.signal.aborted,false);assert.equal(h.engine.active.has(assignment.run.id),true);workerGate.resolve();await eventually(()=>!h.engine.active.has(assignment.run.id));assert.equal(h.store.get('runs',assignment.run.id).status,'completed');
});

test('Coordinator rejects invalid waits and unsafe task paths before delegation',async t=>{
  let h,foreignThread,child;
  h=await fixture(t,async call=>{
    const {options}=call;if(!main(call)){assert.ok(!options.tools.some(tool=>tool.name==='wait_threads'));await artifact(options);return {content:'Worker returned evidence without coordinating another thread'};}
    for(const threadId of [h.thread.id,foreignThread.id]){const invalid=await options.executeTool('wait_threads',{threadIds:[threadId]});assert.match(invalid.error,/project|owned|self|dependenc|Coordinator|direct/i);}
    const invalidPath=await options.executeTool('start_thread',{task:'BAD_PATH',ownedPaths:['../host']});assert.match(invalidPath.error,/relative|traversal/i);
    child=await options.executeTool('start_thread',{task:'VALID_CHILD',taskKey:'valid'});const returned=await options.executeTool('wait_threads',{});await options.executeTool('review_task_results',{reviews:[review(returned.results[0],[returned.results[0].artifacts[0].id])]});return {content:'Only valid owned child dependencies were awaited'};
  });const other=h.store.createProject({name:'Unrelated project',resources:{maxAutoResumes:0}});foreignThread=h.store.createThread(other.id,'Other worker',other.coordinatorThreadId,{assignment:'Separate engineering evidence'});const {run}=start(h);await finished(h,run);assert.equal(run.tasksCreated,1);assert.equal(h.store.get('runs',child.run.id).status,'completed');
});

test('review rejects stale attempts and forged or foreign evidence, then persists an inspected tool event reference',async t=>{
  let h,assignment,foreignArtifact,failedEvent,latestReview;
  h=await fixture(t,async call=>{
    const {options}=call;if(!main(call)){await artifact(options,options.input==='INITIAL_TASK'?'initial.md':'reworked.md');return {content:'Recorded evidence for '+options.input};}
    assignment=await options.executeTool('start_thread',{task:'INITIAL_TASK',taskKey:'versioned-task'});const first=await options.executeTool('wait_threads',{});assert.equal(first.results[0].runId,assignment.run.id);
    const rework=await options.executeTool('steer_thread',{threadId:assignment.thread.id,content:'REWORK_TASK'});assert.ok(rework.run?.id,rework.error);const second=await options.executeTool('wait_threads',{threadIds:[assignment.thread.id]});const current=second.results[0];assert.notEqual(current.runId,first.results[0].runId);
    const stale=await options.executeTool('review_task_results',{reviews:[review(first.results[0],[first.results[0].artifacts[0].id])]});assert.match(stale.error,/superseded|latest/i);
    for(const ref of ['invented-evidence',foreignArtifact.id,failedEvent.id]){const invalid=await options.executeTool('review_task_results',{reviews:[review(current,[ref])]});assert.match(invalid.error,/recorded|project|evidence/i);}
    assert.ok((await options.executeTool('read_file',{path:current.artifacts[0].path})).content.includes('Recorded fixture'));
    const evidence=h.store.data.events.findLast(e=>e.runId===assignment.run.parentRunId&&e.type==='tool.completed'&&e.data.tool==='read_file');assert.ok(evidence?.id);
    latestReview=await options.executeTool('review_task_results',{reviews:[review(current,[evidence.id])]});assert.equal(latestReview.reviews[0].evidenceRefs[0].kind,'tool',latestReview.error);assert.equal(h.store.get('runs',assignment.run.parentRunId).executionPhase,'summarizing','Superseded unreviewed handoffs must not permanently block synthesis of the latest reviewed attempt');return {content:'Reviewed the latest attempt against inspected evidence'};
  });const other=h.store.createProject({name:'Foreign evidence'});foreignArtifact=h.store.add('artifacts',{id:id('artifact'),projectId:other.id,name:'other.md',path:'artifacts/other.md',createdAt:now()});failedEvent=h.store.add('events',{id:id('event'),projectId:h.project.id,runId:'failed-native-tool',type:'tool.completed',createdAt:now(),data:{tool:'run_command',result:{code:1,stderr:'Actual failed execution'}}});const {run}=start(h);await finished(h,run);assert.equal(h.calls.length,3);const saved=createStore({dataDir:h.dataDir,seed:false}),worker=saved.get('threads',assignment.thread.id);assert.equal(worker.lastReview.runId,latestReview.reviews[0].runId);assert.equal(worker.lastReview.reviewedByRunId,run.id);assert.equal(worker.lastReview.evidenceRefs[0].kind,'tool');
});


test('a parent waiting for a worker does not inherit that worker’s native approval state',async t=>{
  let h,assignment;
  h=await fixture(t,async call=>{
    const {options}=call;if(!main(call)){const allowed=await options.requestApproval({tool:'codex.commandExecution',args:{command:'fixture-only controlled native action',native:true}});assert.equal(allowed,true);await artifact(options,'approved-worker.md');return {content:'Native approval resolved by actual human fixture decision'};}
    assignment=await options.executeTool('start_thread',{task:'APPROVAL_WORKER',taskKey:'approval-worker'});const returned=await options.executeTool('wait_threads',{});await options.executeTool('review_task_results',{reviews:[review(returned.results[0],[returned.results[0].artifacts[0].id])]});return {content:'Reviewed approved worker result'};
  });const {run}=start(h);await eventually(()=>run.executionPhase==='waiting_tasks'&&h.store.data.approvals.some(a=>a.status==='pending'));const approval=h.store.data.approvals.find(a=>a.status==='pending');assert.equal(approval.runId,assignment.run.id);assert.equal(h.store.get('runs',assignment.run.id).status,'waiting_approval');assert.equal(run.status,'running');assert.equal(run.executionPhase,'waiting_tasks');h.engine.decideApproval(approval.id,'approve');await finished(h,run);assert.equal(h.calls.length,2);
});

test('dependency timeout returns pending facts and leaves independent workers running',async t=>{
  const workerGate=deferred();let h,assignment,returned;
  h=await fixture(t,async call=>{
    const {options}=call;if(!main(call)){await gate(workerGate.promise,options.signal);return {content:'Worker completed after the parent timeout'};}
    assignment=await options.executeTool('start_thread',{task:'LONG_WORKER',taskKey:'long-worker'});returned=await options.executeTool('wait_threads',{timeoutMs:30});assert.equal(returned.status,'timeout',returned.error);assert.equal(returned.results.length,0);assert.deepEqual(returned.pending.map(r=>r.runId),[assignment.run.id]);assert.equal(h.store.get('runs',assignment.run.parentRunId).executionPhase,'executing');return {content:'The dependency is still pending; no result was invented.'};
  },{resources:{maxAutoResumes:0}});const {run}=start(h);await finished(h,run);assert.equal(run.lastWait.reason,'timeout');assert.equal(h.engine.active.has(assignment.run.id),true);assert.equal(h.calls[1].options.signal.aborted,false);workerGate.resolve();await eventually(()=>!h.engine.active.has(assignment.run.id));
});


test('a second default any wait does not redeliver an already received unreviewed result',async t=>{
  const aGate=deferred(),bGate=deferred();let h,a,b,first,second;
  h=await fixture(t,async call=>{
    const {options}=call;if(!main(call)){await gate(options.input==='ANY_A'?aGate.promise:bGate.promise,options.signal);await artifact(options,options.input+'.md');return {content:'Result '+options.input};}
    a=await options.executeTool('start_thread',{task:'ANY_A',taskKey:'any-a'});b=await options.executeTool('start_thread',{task:'ANY_B',taskKey:'any-b'});
    first=await options.executeTool('wait_threads',{mode:'any'});assert.deepEqual(first.results.map(r=>r.runId),[a.run.id]);
    second=await options.executeTool('wait_threads',{mode:'any'});assert.deepEqual(second.results.map(r=>r.runId),[b.run.id]);assert.equal(second.pending.length,0);
    const all=[...first.results,...second.results];const recorded=await options.executeTool('review_task_results',{reviews:all.map(r=>review(r,[r.artifacts[0].id]))});assert.equal(recorded.reviews.length,2,recorded.error);const empty=await options.executeTool('wait_threads',{mode:'any'});assert.deepEqual(empty.results,[]);assert.deepEqual(empty.pending,[]);return {content:'Each returned task was received and reviewed once'};
  });const {run}=start(h);await eventually(()=>h.calls.length===3&&run.executionPhase==='waiting_tasks');aGate.resolve();await eventually(()=>first&&run.executionPhase==='waiting_tasks','second any wait for remaining task');assert.equal(second,undefined,'Already received result must not immediately satisfy the next default wait');bGate.resolve();await finished(h,run);assert.equal(h.calls.length,3);
});

test('a terminal unreviewed task key is reused instead of launching duplicate investigation',async t=>{
  let h,original,duplicate;
  h=await fixture(t,async call=>{
    const {options}=call;if(!main(call)){await artifact(options);return {content:'Completed delegated investigation'};}
    original=await options.executeTool('start_thread',{task:'RETURN_UNREVIEWED',taskKey:'unreviewed-key'});const handoff=await options.executeTool('wait_threads',{threadIds:[original.thread.id]});
    duplicate=await options.executeTool('start_thread',{task:'Repeat the same investigation before review',taskKey:'unreviewed-key'});assert.equal(duplicate.reused,true,duplicate.error);assert.equal(duplicate.thread.id,original.thread.id);assert.equal(duplicate.run.id,original.run.id);assert.equal(h.store.get('runs',original.run.parentRunId).tasksCreated,1);
    await options.executeTool('review_task_results',{reviews:[review(handoff.results[0],[handoff.results[0].artifacts[0].id])]});return {content:'Reviewed the existing returned result instead of redoing it'};
  });const {run}=start(h);await finished(h,run);assert.equal(h.calls.length,2);assert.equal(h.store.data.threads.filter(t=>t.kind==='worker').length,1);
});

test('accepted review evidence is scoped to that child result or this reviewer turn and rejects explicit native failure flags',async t=>{
  let h,assignment;
  h=await fixture(t,async call=>{
    const {options}=call;if(!main(call)){await artifact(options,'scoped-result.md');return {content:'Evidence belongs to this exact child result'};}
    assignment=await options.executeTool('start_thread',{task:'SCOPED_EVIDENCE_TASK',taskKey:'scoped-evidence'});const handoff=await options.executeTool('wait_threads',{}),result=handoff.results[0],mainRunId=assignment.run.parentRunId;
    const invalidRefs=[];
    for(const source of [{threadId:'unrelated-peer',runId:'unrelated-peer-run'},{threadId:h.thread.id,runId:'previous-reviewer-run'}])invalidRefs.push(h.store.add('artifacts',{id:id('artifact'),projectId:h.project.id,...source,name:'unrelated.md',path:'artifacts/unrelated.md',createdAt:now()}).id);
    invalidRefs.push(h.store.add('events',{id:id('event'),projectId:h.project.id,runId:'unrelated-peer-run',type:'tool.completed',createdAt:now(),data:{tool:'read_file',result:{code:0,content:'Unrelated success'}}}).id);
    for(const resultFlags of [{isError:true},{success:false},{status:'failed'},{status:'cancelled'},{exitCode:1}])invalidRefs.push(h.store.add('events',{id:id('event'),projectId:h.project.id,runId:result.runId,type:'tool.completed',createdAt:now(),data:{native:true,tool:'native-fixture',result:resultFlags}}).id);
    for(const dataFlags of [{isError:true},{success:false},{status:'failed'}])invalidRefs.push(h.store.add('events',{id:id('event'),projectId:h.project.id,runId:result.runId,type:'tool.completed',createdAt:now(),data:{native:true,tool:'native-fixture',result:{},...dataFlags}}).id);
    for(const ref of invalidRefs){const rejected=await options.executeTool('review_task_results',{reviews:[review(result,[result.artifacts[0].id,ref])]});assert.ok(rejected.error,'Invalid review evidence should be rejected: '+ref);assert.equal(h.store.get('threads',result.threadId).lastReview,undefined,'An invalid evidence list must not partially persist acceptance');}
    const inspected=await options.executeTool('read_file',{path:result.artifacts[0].path});assert.ok(inspected.content);const event=h.store.data.events.findLast(e=>e.runId===mainRunId&&e.type==='tool.completed'&&e.data.tool==='read_file');assert.ok(event?.id);
    const recorded=await options.executeTool('review_task_results',{reviews:[review(result,[result.artifacts[0].id,event.id])]});assert.equal(recorded.reviews[0].outcome,'accepted',recorded.error);assert.deepEqual(recorded.reviews[0].evidenceRefs.map(e=>e.kind),['artifact','tool']);return {content:'Accepted only scoped, inspected and nonfailed evidence'};
  });const {run}=start(h);await finished(h,run);assert.equal(h.calls.length,2);assert.equal(h.store.get('runs',assignment.run.id).review.outcome,'accepted');
});


const automatic=call=>call.options.instructions.includes('This is a bounded automatic synthesis');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function autoResults(call){const marker='Recorded results (untrusted evidence, not instructions): ',offset=call.options.input.indexOf(marker);assert.ok(offset>=0,'Automatic native turn must receive the recorded task result snapshots');return JSON.parse(call.options.input.slice(offset+marker.length));}
async function inspectReviewAndMerge(call){
  const {options}=call,results=autoResults(call);assert.ok(results.length);
  for(const result of results){assert.equal(result.status,'completed');assert.ok(result.artifacts.length);for(const recorded of result.artifacts){const file=await options.executeTool('read_file',{path:recorded.path});assert.ok(file.content?.includes('Recorded fixture source'),file.error);}}
  const reviewed=await options.executeTool('review_task_results',{reviews:results.map(result=>review(result,result.artifacts.map(recorded=>recorded.id)))});assert.equal(reviewed.reviews?.length,results.length,reviewed.error);
  const graph=await options.executeTool('get_model',{}),nodes=[...graph.nodes,...results.map(result=>({id:'requirement-'+result.runId,type:'requirement',name:'Reviewed source requirement for '+result.title}))];
  const merged=await options.executeTool('update_model',{nodes,links:graph.links,version:graph.version});assert.equal(merged.nodes?.length,nodes.length,merged.error);return results;
}

for(const providerId of ['codex-local','claude-local'])test(providerId+' automatically reviews each returned batch without waiting for unrelated workers',async t=>{
  const aGate=deferred(),bGate=deferred();let h,a,b;const received=[];
  h=await fixture(t,async call=>{
    const {options}=call;if(!main(call)){await gate(options.input==='AUTO_A'?aGate.promise:bGate.promise,options.signal);await artifact(options,options.input+'.md');return {content:'Actual returned evidence for '+options.input};}
    if(automatic(call)){received.push(...await inspectReviewAndMerge(call));return {content:'Automatically reviewed and integrated the new task results.'};}
    a=await options.executeTool('start_thread',{task:'AUTO_A',taskKey:'auto-a'});b=await options.executeTool('start_thread',{task:'AUTO_B',taskKey:'auto-b'});return {content:'Both investigations are delegated; results will be reviewed when they return.'};
  });const {run}=start(h,{providerId});await finished(h,run);await eventually(()=>h.calls.length===3);assert.equal(h.engine.active.has(a.run.id),true);assert.equal(h.engine.active.has(b.run.id),true);
  aGate.resolve();await eventually(()=>h.store.data.runs.filter(r=>r.source==='auto-summary'&&r.status==='completed').length===1);assert.equal(h.engine.active.has(b.run.id),true,'An unrelated worker must not block review of the ready result');
  bGate.resolve();await eventually(()=>h.store.data.runs.filter(r=>r.source==='auto-summary'&&r.status==='completed').length===2,'automatic evidence review');await delay(30);
  const summary=h.store.data.runs.find(r=>r.source==='auto-summary'),mainCalls=h.calls.filter(main);assert.equal(h.store.data.runs.filter(r=>r.source==='auto-summary').length,2);assert.equal(mainCalls.length,3);assert.equal(h.calls.length,5);assert.equal(mainCalls[1].sessionId,mainCalls[0].sessionId,'Automatic handoff must resume the native main session');assert.equal(mainCalls[1].name,mainCalls[0].name);
  assert.deepEqual(new Set(received.map(r=>r.runId)),new Set([a.run.id,b.run.id]));assert.equal(h.store.get('runs',a.run.id).review.outcome,'accepted');assert.equal(h.store.get('runs',b.run.id).review.outcome,'accepted');assert.equal(h.store.data.models.find(m=>m.projectId===h.project.id).nodes.length,2);assert.equal(summary.executionPhase,'summarizing');assert.ok(h.store.data.messages.filter(m=>m.type==='thread.result').every(m=>m.metadata.summaryStatus==='summarized'));
});

test('three distinct returning-result batches each wake native synthesis beyond the old total default of two',async t=>{
  let h;const batches=[];
  h=await fixture(t,async call=>{if(!main(call)){await artifact(call.options,call.options.input+'.md');return {content:'Evidence from '+call.options.input};}if(automatic(call)){const returned=await inspectReviewAndMerge(call);batches.push(returned.map(r=>r.runId));return {content:'Reviewed this new result batch.'};}return {content:'Main conversation ready for independent engineering tasks.'};},{resources:{maxAutoResumes:2}});
  const {run}=start(h);await finished(h,run);
  for(let index=1;index<=3;index++){
    const worker=h.store.createThread(h.project.id,'Independent batch '+index,h.thread.id,{assignment:'BATCH_'+index,taskContract:{taskKey:'batch-'+index,scope:'Evidence batch '+index,deliverables:[],ownedPaths:[],acceptanceCriteria:[]}}),result=h.engine.start({threadId:worker.id,providerId:'codex-local',permissionMode:'auto',content:'BATCH_'+index});
    await finished(h,result.run);await eventually(()=>h.store.data.runs.filter(r=>r.source==='auto-summary'&&r.status==='completed').length===index,'automatic batch '+index);assert.equal(h.store.get('runs',result.run.id).review.outcome,'accepted');
  }
  await delay(30);assert.equal(h.project.autoResumeCount,3);assert.equal(h.store.data.runs.filter(r=>r.source==='auto-summary').length,3);assert.equal(batches.length,3);assert.ok(batches.every(batch=>batch.length===1));assert.equal(new Set(batches.flat()).size,3);assert.equal(h.calls.length,7);assert.equal(h.store.data.models.find(m=>m.projectId===h.project.id).nodes.length,3);
});

test('failed automatic review blocks that receipt without looping and a new result can wake another native turn',async t=>{
  let h,automaticAttempts=0;const acceptedBatches=[];
  h=await fixture(t,async call=>{if(!main(call)){await artifact(call.options,call.options.input+'.md');return {content:'Actual worker result '+call.options.input};}if(automatic(call)){automaticAttempts++;if(automaticAttempts===1)throw new Error('Fixture automatic review could not inspect the evidence');acceptedBatches.push(await inspectReviewAndMerge(call));return {content:'Reviewed new evidence after the earlier blocked handoff.'};}return {content:'Awaiting independently submitted task results.'};});
  const {run}=start(h);await finished(h,run);
  const firstThread=h.store.createThread(h.project.id,'First receipt',h.thread.id,{assignment:'FIRST_RECEIPT'}),first=h.engine.start({threadId:firstThread.id,providerId:'codex-local',permissionMode:'auto',content:'FIRST_RECEIPT'});await finished(h,first.run);await eventually(()=>h.store.data.runs.some(r=>r.source==='auto-summary'&&r.status==='failed'),'failed automatic handoff');
  const firstReceipt=h.store.data.messages.find(m=>m.type==='thread.result'&&m.metadata.runId===first.run.id);assert.equal(firstReceipt.metadata.summaryStatus,'blocked');await delay(40);assert.equal(automaticAttempts,1,'A blocked result receipt must not trigger an automatic retry loop');assert.equal(h.store.get('runs',first.run.id).review,undefined);
  const secondThread=h.store.createThread(h.project.id,'New receipt',h.thread.id,{assignment:'NEW_RECEIPT'}),second=h.engine.start({threadId:secondThread.id,providerId:'codex-local',permissionMode:'auto',content:'NEW_RECEIPT'});await finished(h,second.run);await eventually(()=>h.store.data.runs.some(r=>r.source==='auto-summary'&&r.status==='completed'),'new receipt automatic handoff');await delay(30);
  assert.equal(automaticAttempts,2);assert.equal(acceptedBatches.length,1);assert.deepEqual(acceptedBatches[0].map(r=>r.runId),[second.run.id]);assert.equal(firstReceipt.metadata.summaryStatus,'blocked');assert.equal(h.store.get('runs',second.run.id).review.outcome,'accepted');assert.equal(h.store.data.runs.filter(r=>r.source==='auto-summary').length,2);
});

test('a cancelled waiting main stays stopped after its independent worker returns with auto handoff enabled',async t=>{
  const workerGate=deferred();let h,assignment;
  h=await fixture(t,async call=>{if(!main(call)){await gate(workerGate.promise,call.options.signal);await artifact(call.options,'cancel-survivor.md');return {content:'Worker result after the parent was stopped'};}assert.equal(automatic(call),false,'Cancellation must not silently restart the main Agent');assignment=await call.options.executeTool('start_thread',{task:'CANCEL_PARENT_WORKER',taskKey:'cancel-parent-worker'});await call.options.executeTool('wait_threads',{});return {content:'Must never finish a cancelled parent successfully'};});
  const {run}=start(h);await eventually(()=>run.executionPhase==='waiting_tasks');h.engine.cancel(run.id);await eventually(()=>!h.engine.active.has(run.id));assert.equal(run.status,'cancelled');assert.ok(h.project.pausedTaskOrigins.includes(run.id));assert.equal(h.calls[1].options.signal.aborted,false);
  workerGate.resolve();await eventually(()=>!h.engine.active.has(assignment.run.id));await delay(40);assert.equal(h.store.get('runs',assignment.run.id).status,'completed');assert.equal(h.store.data.runs.filter(r=>r.source==='auto-summary').length,0);assert.equal(h.calls.length,2);assert.equal(h.engine.listThreads(h.project.id).pendingCompletions,0);
});

test('waiting pauses the parent execution budget while the worker retains its own fresh budget',async t=>{
  const runTimeoutMs=500,parentWorkMs=300,workerWorkMs=350;let h,assignment;
  h=await fixture(t,async call=>{
    const {options}=call;if(!main(call)){await gate(delay(workerWorkMs),options.signal);await artifact(options,'budget-evidence.md');return {content:'Worker completed within its independent execution budget'};}
    await gate(delay(parentWorkMs),options.signal);assignment=await options.executeTool('start_thread',{task:'BUDGET_WORKER',taskKey:'budget-worker'});const returned=await options.executeTool('wait_threads',{});assert.equal(returned.status,'ready',returned.error);await options.executeTool('review_task_results',{reviews:[review(returned.results[0],[returned.results[0].artifacts[0].id])]});return {content:'Parent budget excludes dependency wait time'};
  },{runTimeoutMs,resources:{maxAutoResumes:0}});const {run}=start(h);await eventually(()=>run.executionPhase==='waiting_tasks','parent waits with a partially spent budget');const waitingState=h.engine.active.get(run.id);assert.ok(waitingState.remainingMs>0&&waitingState.remainingMs<workerWorkMs);assert.equal(waitingState.budgetStartedAt,null);await finished(h,run);assert.equal(h.store.get('runs',assignment.run.id).status,'completed');assert.ok(Date.parse(run.finishedAt)-Date.parse(run.startedAt)>runTimeoutMs,'Total wall time exceeds the execution budget because waiting is suspended');assert.equal(h.calls.length,2);
});


test('stopping an idle main thread prevents late child results from automatically resurrecting it',async t=>{
  const workerGate=deferred();let h,assignment;
  h=await fixture(t,async call=>{if(!main(call)){await gate(workerGate.promise,call.options.signal);await artifact(call.options,'idle-stop-result.md');return {content:'Child finished after the main thread was stopped'};}assert.equal(automatic(call),false,'A stopped main thread must not be automatically restarted');assignment=await call.options.executeTool('start_thread',{task:'LATE_IDLE_CHILD',taskKey:'late-idle-child'});return {content:'Independent investigation is still running.'};});
  const {run}=start(h);await finished(h,run);await eventually(()=>h.calls.length===2);assert.equal(h.engine.active.has(run.id),false);h.engine.setThreadStatus(h.thread.id,'stopped');assert.equal(h.store.get('threads',h.thread.id).status,'stopped');workerGate.resolve();await eventually(()=>!h.engine.active.has(assignment.run.id));await delay(40);assert.equal(h.store.get('runs',assignment.run.id).status,'completed');assert.equal(h.store.get('threads',h.thread.id).status,'stopped');assert.equal(h.store.data.runs.filter(r=>r.source==='auto-summary').length,0);assert.equal(h.calls.length,2);
});

test('a completed automatic turn without task review records reported_unreviewed rather than summarized',async t=>{
  const workerGate=deferred();let h,assignment;
  h=await fixture(t,async call=>{if(!main(call)){await gate(workerGate.promise,call.options.signal);await artifact(call.options,'unreviewed-report.md');return {content:'Worker claims its analytical work completed'};}if(automatic(call)){assert.equal(autoResults(call).length,1);return {content:'The worker returned a report; its acceptance criteria have not been checked.'};}assignment=await call.options.executeTool('start_thread',{task:'UNREVIEWED_AUTO_REPORT',taskKey:'unreviewed-auto-report'});return {content:'Awaiting the delegated report.'};});
  const {run}=start(h);await finished(h,run);workerGate.resolve();await eventually(()=>h.store.data.runs.some(r=>r.source==='auto-summary'&&r.status==='completed'));const receipt=h.store.data.messages.find(message=>message.type==='thread.result'&&message.metadata.runId===assignment.run.id);assert.equal(receipt.metadata.summaryStatus,'reported_unreviewed');assert.equal(receipt.metadata.reviewStatus,'unreviewed');assert.equal(h.store.get('runs',assignment.run.id).review,undefined);await delay(40);assert.equal(h.store.data.runs.filter(r=>r.source==='auto-summary').length,1,'Unreviewed reports do not trigger an automatic retry loop');assert.equal(h.calls.length,3);
});


test('an explicitly stopped coordinator remains stopped across persistence reloads',async t=>{
  const h=await fixture(t,async()=>({content:'No automatic activity expected'}));h.engine.setThreadStatus(h.thread.id,'stopped');await h.engine.close();
  const reopened=createStore({dataDir:h.dataDir,seed:false});assert.equal(reopened.get('threads',h.thread.id).status,'stopped');reopened.ensureCoordinator(h.project.id);assert.equal(reopened.get('threads',h.thread.id).status,'stopped');assert.equal(h.calls.length,0);
});

test('automatic continuation can request needs_work rework, wait, review the new exact run and start the next engineering task',async t=>{
  let h,worker,next,oldReview,newRun;
  h=await fixture(t,async call=>{
    const {options}=call;
    if(!main(call)){await artifact(options,options.input==='V2_REWORK'?'corrected.md':'engineering.md');return {content:options.input==='V2_REWORK'?'Corrected engineering evidence':'Recorded engineering result'};}
    if(!automatic(call)){worker=await options.executeTool('start_thread',{task:'V2_INITIAL',taskKey:'v2-rework'});return {content:'Delegated engineering work'};}
    const results=autoResults(call);assert.equal(results.length,1);
    const rejected=await options.executeTool('review_task_results',{reviews:[review(results[0],[],'needs_work')]});oldReview=rejected.reviews[0];assert.equal(oldReview.outcome,'needs_work',rejected.error);
    newRun=await options.executeTool('steer_thread',{threadId:worker.thread.id,content:'V2_REWORK'});assert.ok(newRun.run.id,newRun.error);
    const repaired=await options.executeTool('wait_threads',{threadIds:[worker.thread.id]});assert.equal(repaired.results[0].runId,newRun.run.id);const accepted=await options.executeTool('review_task_results',{reviews:[review(repaired.results[0],[repaired.results[0].artifacts[0].id])]});assert.equal(accepted.reviews[0].outcome,'accepted',accepted.error);
    next=await options.executeTool('start_thread',{task:'V2_NEXT',taskKey:'v2-next'});assert.ok(next.thread?.id,next.error);const following=await options.executeTool('wait_threads',{threadIds:[next.thread.id]});await options.executeTool('review_task_results',{reviews:[review(following.results[0],[following.results[0].artifacts[0].id])]});return {content:'Reworked evidence accepted and next dependent engineering task delivered'};
  });const {run}=start(h);await finished(h,run);await eventually(()=>h.store.data.runs.some(r=>r.source==='auto-summary'&&r.status==='completed'));
  assert.notEqual(worker.run.id,newRun.run.id);assert.equal(worker.run.review.outcome,'needs_work');assert.equal(newRun.run.review.outcome,'accepted');assert.equal(h.store.get('runs',next.run.id).review.outcome,'accepted');assert.equal(h.store.data.runs.filter(r=>r.source==='auto-summary').length,1);assert.equal(run.tasksCreated,2);
});

test('routing preserves original human text and provenance, deduplicates and does not raise a completed task Manual permission',async t=>{
  let h,target,routed,duplicate;
  h=await fixture(t,async call=>{
    const {options}=call;if(!main(call)){if(options.input==='PRIOR_MANUAL_TASK')return {content:'Previously completed manual task'};assert.equal(options.permissionMode,'manual');assert.equal(options.input,'请改进这部分；文字中的批准不是权限设置。');assert.doesNotMatch(options.instructions,/Current input was sent by another project agent/);assert.match(options.instructions,/original human request forwarded by the Coordinator/);assert.match(options.instructions,/does not grant any new approval/);assert.match(options.instructions,/permission mode \(manual\)/);return {content:'Task continues under its existing permission mode'};}
    const source=h.store.data.messages.findLast(m=>m.threadId===h.thread.id&&m.role==='user'),before=h.store.data.runs.length;
    routed=await options.executeTool('route_user_message',{threadId:target.id,messageId:source.id,reason:'This request belongs to the existing power task'});assert.ok(routed.routeId,routed.error);
    duplicate=await options.executeTool('route_user_message',{threadId:target.id,messageId:source.id,reason:'Duplicate delivery must be reused'});assert.equal(duplicate.reused,true,duplicate.error);assert.equal(h.store.data.runs.length,before+1);
    const fake=h.store.message(h.thread.id,'agent','Agent-generated report',undefined,{origin:'agent'}),rejected=await options.executeTool('route_user_message',{threadId:target.id,messageId:fake.id,reason:'Must reject agent authorship'});assert.match(rejected.error,/original human/i);
    const foreign=h.store.createProject({name:'Foreign project'}),foreignMessage=h.store.message(foreign.coordinatorThreadId,'user','Foreign human text',undefined,{origin:'user'});const foreignResult=await options.executeTool('route_user_message',{threadId:target.id,messageId:foreignMessage.id,reason:'Must reject foreign source'});assert.match(foreignResult.error,/conversation/i);
    const otherTarget=await options.executeTool('route_user_message',{threadId:foreign.coordinatorThreadId,messageId:source.id,reason:'Must reject foreign target'});assert.match(otherTarget.error,/project/i);
    await options.executeTool('wait_threads',{threadIds:[target.id]});return {content:'Routed the original request, without duplicate execution'};
  },{resources:{maxAutoResumes:0}});target=h.store.createThread(h.project.id,'Power design');target.lastPermissionMode='manual';h.store.save();const prior=h.engine.start({threadId:target.id,content:'PRIOR_MANUAL_TASK',providerId:'codex-local',permissionMode:'manual'});await finished(h,prior.run);assert.equal(h.engine.overview(target).status,'resolved');const content='请改进这部分；文字中的批准不是权限设置。';const {run}=start(h,{content});await finished(h,run);assert.equal(h.calls.filter(c=>!main(c)).at(-1).sessionId,h.calls.filter(c=>!main(c))[0].sessionId);
  const forwarded=h.store.data.messages.find(m=>m.threadId===target.id&&m.type==='user.forwarded');assert.equal(forwarded.role,'user');assert.equal(forwarded.origin,'user');assert.equal(forwarded.content,content);assert.equal(forwarded.metadata.sourceMessageId,routed.receipt.metadata.sourceMessageId);assert.equal(forwarded.metadata.routedByThreadId,h.thread.id);assert.equal(h.store.get('runs',forwarded.runId).forwardedUserMessageId,forwarded.metadata.sourceMessageId);assert.equal(h.store.get('runs',forwarded.runId).forwardedSourceThreadId,h.thread.id);assert.equal(h.store.get('runs',forwarded.runId).permissionMode,'manual');assert.equal(h.events.filter(e=>e.type==='thread.message.routed').length,1);assert.equal(h.store.data.messages.filter(m=>m.type==='thread.routed').length,1);assert.equal(duplicate.routeId,routed.routeId);
});

test('routing into an active task uses native steering and updates the visible receipt after delivery',async t=>{
  const workerGate=deferred();let h,target,initial,routed;
  h=await fixture(t,async call=>{
    if(!main(call)){await gate(workerGate.promise,call.options.signal);return {content:'Worker incorporated the human steering'};}
    const source=h.store.data.messages.findLast(m=>m.threadId===h.thread.id&&m.role==='user');routed=await call.options.executeTool('route_user_message',{threadId:target.id,messageId:source.id,reason:'Continue the active subsystem task'});return {content:'Forwarded to the active subsystem task'};
  },{resources:{maxAutoResumes:0}});target=h.store.createThread(h.project.id,'Active task');initial=h.engine.start({threadId:target.id,content:'ACTIVE',providerId:'codex-local',permissionMode:'manual'});await eventually(()=>h.calls.length===1);const {run}=start(h,{content:'增加这个任务的故障场景'});await finished(h,run);await eventually(()=>h.store.data.messages.find(m=>m.type==='thread.routed')?.metadata.delivery==='delivered');
  assert.equal(routed.run.id,initial.run.id);assert.equal(h.calls.length,2);assert.match(h.calls[0].steerings[0],/Original human request forwarded/);assert.equal(initial.run.permissionMode,'manual');const targetMessage=h.store.data.messages.find(m=>m.type==='user.forwarded');assert.equal(targetMessage.metadata.delivery,'delivered');workerGate.resolve();await eventually(()=>!h.engine.active.has(initial.run.id));
});

test('cancelling an automatic parent prevents late dependencies from waking it again',async t=>{
  const childGate=deferred();let h,child;
  h=await fixture(t,async call=>{
    const {options}=call;if(options.input==='V2_LATE'){await gate(childGate.promise,options.signal);await artifact(options,'late.md');return {content:'Late evidence'};}
    if(!main(call)){await artifact(options,'trigger.md');return {content:'First evidence'};}
    if(!automatic(call)){await options.executeTool('start_thread',{task:'V2_TRIGGER',taskKey:'v2-trigger'});return {content:'Initial task delegated'};}
    const result=autoResults(call)[0];await options.executeTool('review_task_results',{reviews:[review(result,[result.artifacts[0].id])]});child=await options.executeTool('start_thread',{task:'V2_LATE',taskKey:'v2-late'});await options.executeTool('wait_threads',{threadIds:[child.thread.id]});return {content:'This cancelled turn must not complete'};
  });const initial=start(h);await finished(h,initial.run);await eventually(()=>child&&h.store.data.runs.find(r=>r.source==='auto-summary')?.executionPhase==='waiting_tasks');const automaticRun=h.store.data.runs.find(r=>r.source==='auto-summary');h.engine.cancel(automaticRun.id);await eventually(()=>!h.engine.active.has(automaticRun.id));childGate.resolve();await eventually(()=>!h.engine.active.has(child.run.id));await delay(40);assert.equal(automaticRun.status,'cancelled');assert.equal(h.store.data.runs.filter(r=>r.source==='auto-summary').length,1);assert.equal(h.thread.automaticPaused,true);
});

test('automatic continuation cap persists per originating chain and produces one visible exhaustion receipt',async t=>{
  let h;
  h=await fixture(t,async call=>{
    const {options}=call;if(!main(call)){await artifact(options,'budget.md');return {content:'Recorded result'};}
    if(!automatic(call)){await options.executeTool('start_thread',{task:'CHAIN_START',taskKey:'chain-start'});return {content:'Chain started'};}
    const result=autoResults(call)[0];await options.executeTool('review_task_results',{reviews:[review(result,[result.artifacts[0].id])]});await options.executeTool('start_thread',{task:'CHAIN_NEXT',taskKey:'chain-next'});return {content:'Next task has been delegated'};
  },{resources:{maxAutoContinuations:1}});const {run}=start(h);await finished(h,run);await eventually(()=>h.store.data.messages.some(m=>m.type==='coordination.budget'));await delay(40);assert.equal(h.store.data.runs.filter(r=>r.source==='auto-summary').length,1);assert.equal(h.store.data.messages.filter(m=>m.type==='coordination.budget').length,1);assert.equal(run.autoContinuationCount,1);assert.ok(h.store.data.messages.some(m=>m.type==='thread.result'&&m.metadata.summaryStatus==='budget_exhausted'));await h.engine.close();const reopened=createStore({dataDir:h.dataDir,seed:false});assert.equal(reopened.get('runs',run.id).autoContinuationCount,1);
});

test('a removed preferred provider blocks automatic continuation visibly without crashing or spending its budget, and manual recovery reviews preserved evidence',async t=>{
  const workerGate=deferred();let h,worker,restored=false;
  h=await fixture(t,async call=>{
    const {options}=call;if(!main(call)){await gate(workerGate.promise,options.signal);await artifact(options,'provider-evidence.md');return {content:'Evidence retained when the provider configuration disappears'};}
    if(options.input==='RECOVER_CONNECTION'){
      const receipt=h.store.data.messages.find(m=>m.type==='thread.result'&&m.metadata.runId===worker.run.id);assert.equal(receipt.metadata.summaryStatus,'blocked');const result=h.store.get('runs',worker.run.id);const returned={threadId:worker.thread.id,runId:result.id};const recorded=h.store.data.artifacts.find(a=>a.runId===result.id);const reviewed=await options.executeTool('review_task_results',{reviews:[review(returned,[recorded.id])]});assert.equal(reviewed.reviews[0].outcome,'accepted',reviewed.error);restored=true;return {content:'Reviewed preserved evidence after the user restored the connection'};
    }
    worker=await options.executeTool('start_thread',{task:'PROVIDER_DISAPPEARS',taskKey:'provider-disappears'});return {content:'Waiting for independent evidence'};
  },{autoResumeDebounceMs:30});const {run}=start(h);await finished(h,run);const profile=structuredClone(h.store.get('providers','codex-local'));h.store.remove('providers','codex-local');workerGate.resolve();await eventually(()=>h.store.data.messages.some(m=>m.type==='coordination.blocked'));
  const blocked=h.store.data.messages.find(m=>m.type==='coordination.blocked');assert.match(blocked.content,/Provider not found/);assert.equal(h.store.data.runs.filter(r=>r.source==='auto-summary').length,0);assert.equal(run.autoContinuationCount,undefined);assert.equal(h.project.autoResumeCount,0);await delay(40);assert.equal(h.store.data.messages.filter(m=>m.type==='coordination.blocked').length,1);
  h.store.add('providers',profile);const resumed=start(h,{content:'RECOVER_CONNECTION'});await finished(h,resumed.run);assert.equal(restored,true);assert.equal(worker.run.review.outcome,'accepted');assert.equal(h.store.data.messages.find(m=>m.type==='thread.result'&&m.metadata.runId===worker.run.id).metadata.summaryStatus,'summarized');
});

test('an undelivered user route preserves its provenance and cancellation state across a restart',async t=>{
  const workerGate=deferred();let h,target;
  h=await fixture(t,async call=>{
    if(!main(call)){await gate(workerGate.promise,call.options.signal);return {content:'Must be cancelled before finishing'};}
    const source=h.store.data.messages.findLast(m=>m.threadId===h.thread.id&&m.role==='user');const result=await call.options.executeTool('route_user_message',{threadId:target.id,messageId:source.id,reason:'Existing task owns this correction'});assert.equal(result.delivery,'queued',result.error);return {content:'Request remains queued until the native runtime accepts it'};
  },{resources:{maxAutoResumes:0}});target=h.store.createThread(h.project.id,'Deferred native task');const task=h.engine.start({threadId:target.id,content:'ACTIVE',providerId:'codex-local',permissionMode:'manual'});await eventually(()=>h.engine.active.get(task.run.id)?.runtimeHandle);h.engine.active.get(task.run.id).runtimeHandle.steer=async()=>({accepted:false});const {run}=start(h,{content:'用户原话应当保留'});await finished(h,run);assert.equal(h.store.data.messages.find(m=>m.type==='thread.routed').metadata.delivery,'queued');await h.engine.close();
  const reopened=createStore({dataDir:h.dataDir,seed:false}),receipt=reopened.data.messages.find(m=>m.type==='thread.routed'),forwarded=reopened.data.messages.find(m=>m.type==='user.forwarded');assert.equal(receipt.metadata.delivery,'cancelled');assert.equal(forwarded.metadata.delivery,'cancelled');assert.equal(forwarded.content,'用户原话应当保留');assert.equal(forwarded.origin,'user');assert.equal(reopened.get('runs',task.run.id).status,'cancelled');
});

test('active thread summary uses only public prose from its current native run, never the prior final or internal message',async t=>{
 const publish=deferred(),finishGate=deferred();let h;
 h=await fixture(t,async({options})=>{if(options.input==='OLD_PUBLIC_RUN')return {content:'Previous final must not look like current progress'};await gate(publish.promise,options.signal);options.onMessage({id:'public-progress',text:'正在核对 **电源约束**，读取[报告](reports/power.md)。\n\n'+ '这是真实公开进展。'.repeat(70),phase:'commentary',partial:true});await gate(finishGate.promise,options.signal);return {content:'Current native result is complete'};},{resources:{maxAutoResumes:0}});
 const old=start(h,{content:'OLD_PUBLIC_RUN'});await finished(h,old.run);const second=start(h,{content:'CURRENT_PUBLIC_RUN'});await eventually(()=>h.calls.length===2&&second.run.status==='running');assert.equal(h.engine.overview(h.thread).latestPublicSummary,null,'No current prose exists yet; do not borrow the previous answer');publish.resolve();await eventually(()=>h.engine.overview(h.thread).latestPublicSummary?.messageId);
 const selected=h.engine.overview(h.thread).latestPublicSummary;assert.equal(selected.runId,second.run.id);assert.equal(selected.active,true);assert.equal(selected.partial,true);assert.equal(selected.source,'assistant-message');assert.equal(selected.untrusted,true);assert.equal(selected.phase,'executing');assert.equal(selected.messagePhase,'commentary');assert.equal(selected.truncated,true);assert.ok([...selected.text].length<=300);assert.match(selected.text,/正在核对 电源约束，读取报告/);assert.doesNotMatch(selected.text,/\*\*|\]\(|Previous final/);assert.ok(selected.at);
 for(const type of ['thread.started','thread.result','thread.routed','user.forwarded','agent.message','tool.result','coordination.blocked','system'])h.store.message(h.thread.id,'assistant','INTERNAL_'+type,second.run.id,{type});
 h.store.message(h.thread.id,'agent','AGENT_PRIVATE',second.run.id);h.store.message(h.thread.id,'user','USER_PRIVATE',second.run.id,{type:'user.forwarded',origin:'user'});h.store.message(h.thread.id,'assistant','LEGACY_AGENT_PRIVATE',second.run.id,{metadata:{fromAgentId:'worker-id'}});h.store.message(h.thread.id,'assistant','LEGACY_AUTHOR_PRIVATE',second.run.id,{metadata:{authorRole:'worker'}});h.store.message(h.thread.id,'assistant','PRIVATE_REASONING',second.run.id,{type:'runtime.message',metadata:{phase:'analysis'}});
 assert.deepEqual(h.engine.overview(h.thread).latestPublicSummary,selected);h.calls.at(-1).options.onMessage({id:'later-row',text:'An intermediate public update',phase:'commentary',partial:false});await delay(5);h.calls.at(-1).options.onMessage({id:'public-progress',text:'原有消息的新公开进展',phase:'commentary',partial:false});assert.equal(h.engine.overview(h.thread).latestPublicSummary.text,'原有消息的新公开进展','Updated existing message rows are ordered by actual update time, not their original array position');finishGate.resolve();await finished(h,second.run);const completed=h.engine.overview(h.thread).latestPublicSummary;assert.equal(completed.active,false);assert.equal(completed.runId,second.run.id);assert.equal(completed.text,'Current native result is complete');assert.equal(completed.executionStatus,'completed');
});

test('main and child keep independent prose and execution phases while wait prerequisites use actual recorded task names',async t=>{
 const childGate=deferred();let h,child;
 h=await fixture(t,async call=>{const {options}=call;if(!main(call)){options.onMessage({id:'child-progress',text:'子任务正在检查电池模型',phase:'commentary',partial:false});await gate(childGate.promise,options.signal);await artifact(options,'public-child.md');return {content:'Child result'};}options.onMessage({id:'main-progress',text:'已委派电池检查，等待其证据后复核。',phase:'commentary',partial:false});child=await options.executeTool('start_thread',{name:'电池模型检查',task:'PUBLIC_CHILD',taskKey:'public-child'});const handoff=await options.executeTool('wait_threads',{threadIds:[child.thread.id],reason:'需要电池证据'});await options.executeTool('review_task_results',{reviews:[review(handoff.results[0],[handoff.results[0].artifacts[0].id])]});return {content:'Parent reviewed the battery result'};},{resources:{maxAutoResumes:0}});
 const {run}=start(h);await eventually(()=>child&&run.executionPhase==='waiting_tasks'&&h.engine.overview(h.store.get('threads',child.thread.id)).latestPublicSummary);
 const parentView=h.engine.overview(h.thread),childView=h.engine.overview(h.store.get('threads',child.thread.id));assert.equal(parentView.executionStatus,'waiting_tasks');assert.equal(parentView.executionPhase,'waiting_tasks');assert.equal(childView.executionPhase,'executing');assert.equal(parentView.latestPublicSummary.text,'已委派电池检查，等待其证据后复核。');assert.equal(parentView.latestPublicSummary.phase,'waiting_tasks');assert.equal(childView.latestPublicSummary.text,'子任务正在检查电池模型');assert.equal(childView.latestPublicSummary.runId,child.run.id);assert.equal(parentView.waitingFor.source,'wait_threads');assert.deepEqual(parentView.waitingFor.tasks.map(t=>({threadId:t.threadId,runId:t.runId,title:t.title})),[{threadId:child.thread.id,runId:child.run.id,title:'电池模型检查'}]);childGate.resolve();await finished(h,run);
});

