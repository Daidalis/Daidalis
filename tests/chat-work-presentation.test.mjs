import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRunPresentation,visibleRunWork,describeTaskDelivery} from '../shared/run-presentation.mjs';
const run={id:'r',threadId:'main',status:'running',startedAt:'2026-10-23T01:00:00Z'},events=[{id:'read',type:'tool.completed',runId:'r',data:{tool:'read_file',result:{content:'source'}}},{id:'job',type:'tool.started',runId:'r',data:{tool:'mcp__manta__submit_professional_job',args:{path:'model.mo'}}},{id:'fail',type:'tool.completed',runId:'r',data:{tool:'run_command',result:{code:2}}}];
test('active native tool and failures stay visible while routine file reads fold',()=>{
 const row=buildRunPresentation({runs:[run],events,messages:[{id:'p',runId:'r',threadId:'main',role:'assistant',content:'正在比较电源方案'}]})[0],shown=visibleRunWork(row);
 assert.deepEqual(shown.activities.map(a=>a.id),['job','fail']);assert.equal(shown.activities[0].label,'提交专业求解');assert.equal(shown.messages[0].content,'正在比较电源方案');
});
test('completion folds commentary but keeps result destinations and truthful failure states',()=>{
 const row={status:'completed',activities:[{id:'read',kind:'tool',tool:'read_file',status:'completed'},{id:'poll1',kind:'tool',result:{jobId:'one'},status:'completed'},{id:'poll2',kind:'tool',result:{jobId:'one'},status:'completed'},{id:'fail',kind:'tool',status:'failed'}],processMessages:[{id:'p'}]},shown=visibleRunWork(row,{hasResult:a=>Boolean(a.result?.jobId)});
 assert.deepEqual(shown.messages,[]);assert.deepEqual(shown.activities.map(a=>a.id).sort(),['fail','poll2']);
});
test('routed human instruction retains exact human authorship and receipt is separate from assistant final',()=>{
 const original='把负载降低到 3 W\n保留所有约束',messages=[{id:'u',role:'user',threadId:'main',runId:'r',content:original},{id:'route',role:'assistant',type:'thread.routed',threadId:'main',runId:'r',content:'已转交',metadata:{routeId:'route1',taskThreadId:'eps',sourceMessageId:'u',reason:'电源任务',delivery:'queued'}}];
 const row=buildRunPresentation({threadId:'main',runs:[run],messages})[0];assert.equal(row.userMessages[0].content,original);assert.equal(row.processMessages.length,0);assert.equal(row.activities[0].type,'thread.routed');assert.equal(visibleRunWork(row).routes[0].sourceMessageId,'u');
 const worker={id:'wr',threadId:'eps',source:'delegated',status:'running'},forwarded={id:'f',threadId:'eps',runId:'wr',role:'user',origin:'user',type:'user.forwarded',content:original,metadata:{origin:'user',sourceThreadId:'main',sourceMessageId:'u'}};
 const child=buildRunPresentation({threadId:'eps',runs:[worker],messages:[forwarded]})[0];assert.equal(child.userMessages[0].content,original);assert.equal(child.internalMessages.length,0);
});

test('result receipts reflect authoritative per-run review instead of stale creation metadata',()=>{
 const result={id:'delivery',type:'thread.result',role:'assistant',threadId:'main',runId:'child-r',content:'已交付',metadata:{taskThreadId:'child',runId:'child-r',status:'completed',reviewStatus:'unreviewed'}};
 for(const outcome of ['accepted','needs_work','blocked']){
  const runs=[{...run,lastHandoff:{reviewed:[{runId:'child-r',outcome:'accepted'}]}},{id:'child-r',threadId:'child',status:'completed',review:{outcome}}];
  const standalone=buildRunPresentation({threadId:'main',runs,messages:[result]}).find(r=>r.kind==='message');assert.equal(standalone.activity.reviewStatus,outcome);
  const bound=buildRunPresentation({threadId:'main',runs,messages:[{...result,runId:'r'}]}).find(r=>r.kind==='run');assert.equal(bound.activities[0].reviewStatus,outcome);
  assert.equal(result.metadata.reviewStatus,'unreviewed');
 }
});

test('a later successful plan CAS update folds the recovered operational failure but retains raw history',()=>{
 const activities=[{id:'stale',tool:'update_engineering_plan',kind:'tool',status:'failed',args:{expectedRevision:1},result:{error:'Revision conflict'}},{id:'plan-read',tool:'get_engineering_plan',kind:'tool',status:'completed',result:{revision:2}},{id:'saved',tool:'update_engineering_plan',kind:'tool',status:'completed',args:{expectedRevision:2},result:{revision:3}},{id:'model-fail',tool:'update_model',kind:'tool',status:'failed',args:{path:'models/a.sysml'},result:{error:'Conflict'}},{id:'other-model',tool:'update_model',kind:'tool',status:'completed',args:{path:'models/b.sysml'},result:{version:1}}],before=JSON.stringify(activities);
 const view=visibleRunWork({status:'completed',activities},{hasResult:()=>true});assert.equal(view.recoveredCount,1);assert.ok(!view.activities.some(a=>a.id==='stale'));assert.ok(view.activities.some(a=>a.id==='model-fail'));assert.equal(JSON.stringify(activities),before);
 const recoveredModel=visibleRunWork({status:'completed',activities:[...activities,{id:'model-saved',tool:'update_model',kind:'tool',status:'completed',args:{path:'models/a.sysml'},result:{version:2}}]},{hasResult:()=>true});assert.equal(recoveredModel.recoveredCount,2);
});
test('a later passing numerical case never hides a failed verification job',()=>{
 const activities=[{id:'failed-case',tool:'wait_professional_job',kind:'tool',status:'completed',result:{jobId:'first-job',executionSucceeded:true,verification:{status:'failed'}}},{id:'passed-case',tool:'wait_professional_job',kind:'tool',status:'completed',result:{jobId:'second-job',executionSucceeded:true,verification:{status:'passed'}}}];
 const view=visibleRunWork({status:'completed',activities},{hasResult:()=>true,resultKey:a=>a.result.jobId});assert.equal(view.recoveredCount,0);assert.deepEqual(new Set(view.activities.map(a=>a.id)),new Set(['failed-case','passed-case']));
});

test('current delivery review replaces stale waiting prose while preserving the original receipt in details',()=>{
 const receipt={type:'thread.result',reviewStatus:'accepted',status:'completed',detail:'任务「STF」已交付，等待复核。'},before=JSON.stringify(receipt),view=describeTaskDelivery(receipt,{taskTitle:'STF'});
 assert.equal(view.statusLabel,'已复核');assert.match(view.detail,/已由上级复核/);assert.doesNotMatch(view.detail,/等待/);assert.equal(view.rawMessage,receipt.detail);assert.equal(JSON.stringify(receipt),before);
 for(const [reviewStatus,label]of [['needs_work','需要补充'],['blocked','受阻'],['pending','待复核'],['unreviewed','待复核']])assert.equal(describeTaskDelivery({...receipt,reviewStatus}).statusLabel,label);
 assert.equal(describeTaskDelivery({...receipt,branchStatus:'blocked'}).statusLabel,'受阻');
});
test('compact returned-task preview is bounded and remains unreviewed or failed until accepted',()=>{
 const summary='来源审查报告：'+ '已核对姿态坐标来源。'.repeat(30),receipt={type:'thread.result',status:'completed',reviewStatus:'unreviewed',result:{summary}};
 const pending=describeTaskDelivery(receipt,{taskTitle:'来源审查'});
 assert.equal(pending.statusLabel,'待复核');assert.match(pending.preview,/来源审查报告/);assert.ok([...pending.preview].length<=101);assert.ok(pending.preview.endsWith('…'));
 assert.equal(describeTaskDelivery({...receipt,status:'failed'}).statusLabel,'执行失败 · 待处理');
 assert.equal(describeTaskDelivery({...receipt,reviewStatus:'accepted'}).statusLabel,'已复核');
});
