import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRunPresentation,formatDuration,runExecutionStatus} from '../shared/run-presentation.mjs';
const iso=seconds=>new Date(Date.UTC(2026,9,22,0,0,seconds)).toISOString();
const message=(id,role,content,runId,at,fields={})=>({id,role,content,threadId:'main',runId,createdAt:iso(at),...fields});
const event=(id,type,runId,at,data={})=>({id,type,runId,createdAt:iso(at),message:type,data});
const completed=(id,fields={})=>({id,threadId:'main',status:'completed',createdAt:iso(0),startedAt:iso(60),finishedAt:iso(70),result:'Final answer',...fields});

test('Completed turn exposes users and steering, folds process text, and uses the persisted final only once',()=>{
  const messages=[message('u','user','Initial task','r',0),message('p','assistant','I will check project evidence.','r',61),message('steer','user','Include a failure case.','r',62,{type:'thread.steering',metadata:{delivery:'delivered'}}),message('final','assistant','Final answer','r',69)];
  const input={threadId:'main',messages,runs:[completed('r')],events:[],agents:[],nowMs:Date.parse(iso(100))},before=JSON.stringify(input),rows=buildRunPresentation(input);
  assert.equal(rows.length,1);const row=rows[0];assert.equal(row.kind,'run');assert.deepEqual(row.userMessages.map(m=>m.id),['u','steer']);assert.deepEqual(row.processMessages.map(m=>m.id),['p']);assert.equal(row.finalMessage.id,'final');assert.equal(row.finalMessageMissing,false);assert.equal(row.durationMs,10000);assert.equal(row.queueDurationMs,60000);assert.equal(row.durationLive,false);assert.equal(formatDuration(row.durationMs),'10s');assert.equal(JSON.stringify(input),before);
});

test('Final output is never fabricated from run.result, process text or a system task notification',()=>{
  const runs=[completed('mismatch',{result:'Result not present as an assistant message'}),completed('notification'),completed('live',{status:'running',finishedAt:undefined}),completed('failed',{status:'failed',error:'Execution failed'}),completed('cancelled',{status:'cancelled'})];
  const messages=[message('m','assistant','A partial update','mismatch',61),message('n','assistant','Final answer','notification',69,{type:'thread.result',metadata:{taskThreadId:'worker',status:'completed',result:{summary:'Worker result'}}}),message('l','assistant','Final answer','live',69),message('f','assistant','Final answer','failed',69),message('c','assistant','Final answer','cancelled',69)];
  const rows=buildRunPresentation({threadId:'main',runs,messages});assert.ok(rows.every(r=>r.finalMessage===null));assert.equal(rows.find(r=>r.runId==='mismatch').finalMessageMissing,true);assert.equal(rows.find(r=>r.runId==='notification').processMessages.length,0);assert.equal(rows.find(r=>r.runId==='notification').activities[0].kind,'thread');assert.equal(rows.find(r=>r.runId==='failed').error,'Execution failed');
});

test('Main, worker and automatic-summary runs remain separate and result notifications do not become main finals',()=>{
  const runs=[completed('main-run',{result:'Main final',finishedAt:iso(65)}),completed('worker-run',{threadId:'worker',rootRunId:'main-run',result:'Worker final',startedAt:iso(61),finishedAt:iso(72)}),completed('auto-run',{source:'auto-summary',result:'Summary final',createdAt:iso(73),startedAt:iso(73),finishedAt:iso(75)})];
  const messages=[message('u','user','Do work','main-run',0),message('started','assistant','Task started','main-run',62,{type:'thread.started',metadata:{threadId:'worker',runId:'worker-run'}}),message('mf','assistant','Main final','main-run',64),message('wf','assistant','Worker final','worker-run',71,{threadId:'worker'}),message('returned','assistant','Worker final','worker-run',72,{type:'thread.result',metadata:{taskThreadId:'worker',runId:'worker-run',status:'completed',result:{summary:'Worker final',completedAt:iso(72)}}}),message('af','assistant','Summary final','auto-run',74)];
  const events=[event('result-event','thread.result','worker-run',72,{threadId:'worker',coordinatorThreadId:'main',message:messages.find(m=>m.id==='returned')})];
  const main=buildRunPresentation({threadId:'main',runs,messages,events});assert.equal(main.filter(r=>r.kind==='run').length,2);assert.equal(main.find(r=>r.runId==='main-run').finalMessage.id,'mf');assert.equal(main.find(r=>r.runId==='main-run').durationMs,5000);const returned=main.find(r=>r.id==='returned');assert.equal(returned.kind,'message');assert.equal(returned.activity.kind,'thread');assert.equal(returned.activity.runId,'worker-run');assert.equal(main.find(r=>r.runId==='auto-run').automatic,true);assert.equal(main.find(r=>r.runId==='auto-run').userMessages.length,0);
  const worker=buildRunPresentation({threadId:'worker',runs,messages,events});assert.equal(worker.length,1);assert.equal(worker[0].runId,'worker-run');assert.equal(worker[0].finalMessage.id,'wf');assert.equal(worker[0].activities.length,0);
  const all=buildRunPresentation({runs,messages,events});assert.equal(all.find(r=>r.id==='returned').kind,'message');assert.equal(all.find(r=>r.runId==='worker-run').activities.length,0);
});
test('new standalone and historical parent-bound task results both retain worker summary for handoff',()=>{
 const parent=completed('parent'),metadata={taskThreadId:'worker',runId:'worker-run',status:'completed',reviewStatus:'unreviewed',result:{summary:'已审查公开来源；证据不足处仍待核对。'}};
 const newReceipt=message('new-receipt','assistant','子任务已返回',undefined,72,{type:'thread.result',metadata});
 const oldReceipt=message('old-receipt','assistant','子任务已返回','parent',73,{type:'thread.result',metadata:{...metadata,runId:'older-worker-run'}});
 const rows=buildRunPresentation({threadId:'main',runs:[parent],messages:[newReceipt,oldReceipt]});
 const standalone=rows.find(r=>r.id==='new-receipt'),bound=rows.find(r=>r.kind==='run');
 assert.equal(standalone.kind,'message');assert.equal(standalone.activity.childThreadId,'worker');assert.equal(standalone.activity.result.summary,metadata.result.summary);
 assert.equal(bound.activities[0].type,'thread.result');assert.equal(bound.activities[0].result.summary,metadata.result.summary);
 assert.equal(bound.finalMessage,null);
});

test('Tool activity pairs repeated operations and preserves actual failures, pending approvals and solver scope',()=>{
  const run=completed('r',{status:'waiting_approval',finishedAt:undefined}),events=[event('s1','tool.started','r',61,{agentId:'a',tool:'read_file',args:{path:'a.md'}}),event('c1','tool.completed','r',62,{agentId:'a',tool:'read_file',result:{content:'Source'}}),event('s2','tool.started','r',63,{agentId:'a',tool:'read_file',args:{path:'b.md'}}),event('c2','tool.completed','r',64,{agentId:'a',tool:'read_file',result:{error:'File missing'}}),event('cmd','tool.completed','r',65,{agentId:'a',tool:'run_command',result:{code:2,stdout:'',stderr:'Failed command'}}),event('solver','tool.completed','r',66,{agentId:'a',tool:'run_engineering_model',result:{status:'completed',constraintStatus:'violations-found',scope:'declared-model-numerical-analysis'}}),event('w','tool.started','r',67,{agentId:'a',tool:'write_file',args:{path:'review.md',content:'Draft'}})];
  const approval={id:'approval',runId:'r',tool:'write_file',status:'pending'},row=buildRunPresentation({threadId:'main',runs:[run],events,approvals:[approval],nowMs:Date.parse(iso(80))})[0],tools=row.activities.filter(a=>a.kind==='tool');
  assert.equal(tools.length,5);assert.equal(tools[0].status,'completed');assert.equal(tools[0].args.path,'a.md');assert.deepEqual(tools[0].eventIds,['s1','c1']);assert.equal(tools[1].status,'failed');assert.equal(tools[1].args.path,'b.md');assert.equal(tools[2].status,'failed');assert.equal(tools[2].startMissing,true);assert.equal(tools[2].startedAt,null);assert.equal(tools[3].status,'completed');assert.equal(tools[3].result.constraintStatus,'violations-found');assert.equal(tools[4].status,'waiting_approval');assert.deepEqual(row.approvals,[approval]);assert.equal(row.durationMs,20000);
});

test('Missing completion records never imply a successful tool and no timestamps are invented',()=>{
  for(const status of ['completed','failed','cancelled','interrupted']){const run=completed('r',{status}),rows=buildRunPresentation({runs:[run],events:[event('open','tool.started','r',61,{tool:'run_command',args:{command:'recorded command'}})]});assert.equal(rows[0].activities[0].status,status==='completed'?'unknown':status);assert.equal(rows[0].activities[0].finishedAt,null);}
  const rows=buildRunPresentation({runs:[{id:'q',threadId:'main',status:'queued',createdAt:iso(0)},{id:'old',threadId:'main',status:'completed',result:'Old final'},{id:'bad',threadId:'main',status:'completed',startedAt:iso(70),finishedAt:iso(60)}],messages:[message('of','assistant','Old final','old',5)],nowMs:Date.parse(iso(120))});
  const queued=rows.find(r=>r.runId==='q');assert.equal(queued.status,'queued');assert.equal(queued.startedAt,null);assert.equal(queued.durationMs,null);assert.equal(queued.queueDurationMs,120000);assert.equal(formatDuration(queued.durationMs),'');const old=rows.find(r=>r.runId==='old');assert.equal(old.finalMessage.id,'of');assert.equal(old.startedAt,null);assert.equal(old.finishedAt,null);assert.equal(old.durationMs,null);assert.equal(rows.find(r=>r.runId==='bad').durationMs,null);assert.equal(rows.find(r=>r.runId==='bad').timingStatus,'invalid-order');
});

test('Only recorded start and finish timestamps determine elapsed execution time',()=>{
  const run=completed('r',{status:'running',finishedAt:undefined});assert.equal(buildRunPresentation({runs:[run]})[0].durationMs,null);assert.equal(buildRunPresentation({runs:[run],nowMs:Date.parse(iso(90))})[0].durationMs,30000);assert.equal(buildRunPresentation({runs:[completed('r')],nowMs:Date.parse(iso(900))})[0].durationMs,10000);assert.equal(formatDuration(0),'0s');assert.equal(formatDuration(61001),'1m 1s');assert.equal(formatDuration(3600000),'60m 0s');assert.equal(formatDuration(-1),'');assert.equal(formatDuration(undefined),'');
});

test('Public progress deduplicates repeated event IDs, never fabricates reasoning and preserves ungrouped users',()=>{
  const progress=event('public','agent.thinking','r',61,{agentId:'a',turn:2,reasoning:'DO_NOT_RENDER_PRIVATE_FIELD'});progress.message='Agent · turn 2';const rows=buildRunPresentation({threadId:'main',runs:[completed('r')],messages:[message('legacy-user','user','Unbound older question',undefined,-1),message('current','user','Bound question','r',0)],events:[progress,progress,event('private','reasoning.delta','r',62,{text:'DO_NOT_RENDER_REASONING'})]});assert.equal(rows[0].kind,'message');assert.equal(rows[0].message.id,'legacy-user');const row=rows.find(r=>r.kind==='run');assert.equal(row.activities.length,1);assert.equal(row.activities[0].label,'处理中');assert.equal(row.activities[0].turn,2);assert.equal(JSON.stringify(rows).includes('DO_NOT_RENDER'),false);assert.equal(row.userMessages[0].id,'current');
});

test('Event-history limits remain explicit and are not upgraded by a successful final message',()=>{
  const meta={retainedCount:3,returnedCount:3,totalCount:null,complete:false,truncated:true,reason:'retained-event-prefix-unavailable',detailLimit:4000},row=buildRunPresentation({runs:[completed('r')],messages:[message('final','assistant','Final answer','r',69)],eventHistory:{perRun:{r:meta}}})[0];assert.deepEqual(row.eventHistory,meta);assert.equal(row.finalMessage.id,'final');assert.equal(row.eventHistory.complete,false);assert.equal(row.eventHistory.totalCount,null);assert.notEqual(row.eventHistory,meta);
});

test('Concurrent native tool calls pair by their recorded call ID when they finish out of order',()=>{
  const run={id:'native-parallel',threadId:'main',status:'completed',createdAt:'2026-10-22T00:00:00Z',startedAt:'2026-10-22T00:00:00Z',finishedAt:'2026-10-22T00:00:03Z'};
  const events=[
    {id:'sa',type:'tool.started',runId:run.id,createdAt:'2026-10-22T00:00:00Z',data:{agentId:'native',tool:'Read',callId:'a',args:{path:'a.md'}}},
    {id:'sb',type:'tool.started',runId:run.id,createdAt:'2026-10-22T00:00:00Z',data:{agentId:'native',tool:'Read',callId:'b',args:{path:'b.md'}}},
    {id:'eb',type:'tool.completed',runId:run.id,createdAt:'2026-10-22T00:00:01Z',data:{agentId:'native',tool:'Read',callId:'b',result:{content:'B'}}},
    {id:'ea',type:'tool.completed',runId:run.id,createdAt:'2026-10-22T00:00:02Z',data:{agentId:'native',tool:'Read',callId:'a',result:{content:'A'}}}
  ];
  const row=buildRunPresentation({threadId:'main',runs:[run],events})[0],tools=row.activities.filter(a=>a.kind==='tool');
  assert.equal(tools.length,2);assert.equal(tools[0].args.path,'a.md');assert.equal(tools[0].result.content,'A');
  assert.equal(tools[1].args.path,'b.md');assert.equal(tools[1].result.content,'B');
});


test('Execution phases are explicit and real approval or terminal lifecycle takes precedence',()=>{
  const base={id:'main-run',status:'running',executionPhase:'executing'};
  assert.equal(runExecutionStatus(base),'running');
  for(const phase of ['waiting_tasks','reviewing','summarizing'])assert.equal(runExecutionStatus({...base,executionPhase:phase}),phase);
  assert.equal(runExecutionStatus({...base,source:'auto-summary'}),'summarizing');
  assert.equal(runExecutionStatus({...base,status:'queued',executionPhase:'waiting_tasks'}),'queued');
  assert.equal(runExecutionStatus({...base,executionPhase:'waiting_tasks'},{approvals:[{runId:'main-run',status:'pending'}]}),'waiting_approval');
  assert.equal(runExecutionStatus({...base,executionPhase:'reviewing'},{approvals:[{runId:'other',status:'pending'},{status:'pending'}]}),'reviewing');
  assert.equal(runExecutionStatus({...base,status:'waiting_approval',executionPhase:'waiting_tasks'}),'waiting_approval');
  for(const status of ['completed','failed','cancelled','interrupted'])assert.equal(runExecutionStatus({...base,status,executionPhase:'waiting_tasks'},{approvals:[{runId:'main-run',status:'pending'}]}),status);
});

test('Recorded waits expose named dependencies with current child status and preserve total turn timing',()=>{
  const run={id:'r',threadId:'main',status:'running',executionPhase:'waiting_tasks',createdAt:iso(0),startedAt:iso(0),waitingFor:{threadIds:['source','environment'],runIds:['source-run','env-run'],mode:'all',startedAt:iso(40),tasks:[{threadId:'source',runId:'source-run',title:'Old source title',status:'running'},{threadId:'environment',runId:'env-run',title:'Environment',status:'running'}]}},before=JSON.stringify(run);
  const row=buildRunPresentation({runs:[run],threadId:'main',childThreads:[{id:'source',title:'Coordinate source',executionStatus:'completed'},{id:'environment',title:'Execution environment',executionStatus:'waiting_approval'}],nowMs:Date.parse(iso(60))})[0];
  assert.equal(row.status,'running');assert.equal(row.executionStatus,'waiting_tasks');assert.equal(row.durationMs,60000);assert.equal(row.durationLive,true);assert.equal(row.waitingFor.startedAt,iso(40));
  assert.deepEqual(row.waitingFor.tasks,[{threadId:'source',runId:'source-run',title:'Coordinate source',status:'completed'},{threadId:'environment',runId:'env-run',title:'Execution environment',status:'waiting_approval'}]);
  assert.equal(JSON.stringify(run),before);
});

test('Running children never invent a wait and recorded dependencies survive missing child records',()=>{
  const base={id:'r',threadId:'main',status:'running',startedAt:iso(0)};
  const ordinary=buildRunPresentation({runs:[base],childThreads:[{id:'child',originRunId:'r',executionStatus:'running'}]})[0];assert.equal(ordinary.executionStatus,'running');assert.equal(ordinary.waitingFor,null);
  const waiting=buildRunPresentation({runs:[{...base,executionPhase:'waiting_tasks',waitingFor:{mode:'any',tasks:[{threadId:'missing',title:'Recorded task',status:'failed',runId:'recorded'}]}}]})[0];
  assert.equal(waiting.waitingFor.mode,'any');assert.deepEqual(waiting.waitingFor.tasks,[{threadId:'missing',title:'Recorded task',status:'failed',runId:'recorded'}]);
});


test('An in-flight wait tool is presented as waiting rather than model execution',()=>{
  const row=buildRunPresentation({runs:[{id:'r',threadId:'main',status:'running',executionPhase:'waiting_tasks',startedAt:iso(0),waitingFor:{threadIds:['worker']}}],events:[event('wait','tool.started','r',10,{tool:'wait_threads',args:{threadIds:['worker']}})],nowMs:Date.parse(iso(20))})[0];
  assert.equal(row.activities[0].status,'waiting_tasks');assert.equal(row.activities[0].label,'等待子任务结果');assert.equal(row.executionStatus,'waiting_tasks');
});


test('Task registry and evidence review tool records use the actual public tool names',()=>{
  const row=buildRunPresentation({runs:[{id:'r',threadId:'main',status:'completed',startedAt:iso(0),finishedAt:iso(20)}],events:[event('registry','tool.completed','r',1,{tool:'get_task_assignments',result:{assignments:[]}}),event('reviews','tool.completed','r',2,{tool:'review_task_results',result:{reviews:[]}})]})[0];
  assert.deepEqual(row.activities.map(a=>a.label),['查看任务分工','记录任务结果复核']);
});
