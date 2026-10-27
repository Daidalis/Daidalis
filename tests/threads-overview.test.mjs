import test from 'node:test';
import assert from 'node:assert/strict';
import {renderThreadsOverview,threadOverviewGroups,threadPublicSummary,overviewActivityIndicator} from '../public/task-views.mjs';
const id=n=>'thread_'+String(n).padStart(8,'0')+'-1111-2222-3333-444444444444';
const t=(n,status,fields={})=>({id:id(n),projectId:'p',parentThreadId:id(0),title:'Thread '+n,executionStatus:status,...fields});
test('Overview groups actual execution, waits, approval, review outcomes and stopped threads without a primary task tree',()=>{
 const threads=[t(0,'running',{kind:'coordinator'}),t(1,'running',{activeRunId:'run1'}),t(2,'waiting_tasks'),t(3,'waiting_approval'),t(4,'blocked'),t(5,'completed',{reviewStatus:'needs_work'}),t(6,'idle'),t(7,'stopped'),t(8,'completed',{reviewStatus:'accepted'}),t(9,'completed',{projectId:'other'})],groups=threadOverviewGroups(threads,{projectId:'p',mainThreadId:id(0)});
 assert.deepEqual(groups.map(g=>[g.label,g.threads.length]),[['需要你处理',3],['进行中',2],['待命',2],['已完成',1]]);
 const html=renderThreadsOverview(threads,{projectId:'p',mainThreadId:id(0)});assert.doesNotMatch(html,/role="tree"|任务树|工程计划|progressbar/);assert.match(html,/data-thread-group="resolved" data-thread-project="p" >/);assert.match(html,/data-thread-group="working" data-thread-project="p" open/);assert.match(html,/data-id="thread_00000008/);
});
test('public summary belongs to this work; active waiting never borrows an old completion',()=>{
 const live=t(1,'waiting_tasks',{lastResult:'上次已经完成',dependencies:[{threadId:id(2),title:'星敏接口审查'},{threadId:id(3),title:'执行环境准备'}]});
 assert.equal(threadPublicSummary(live),'等待 星敏接口审查、执行环境准备');
 assert.equal(threadPublicSummary(t(2,'running',{lastResult:'Old completion'})),'执行中');
 assert.equal(threadPublicSummary(t(3,'running',{latestPublicSummary:{text:'正在检查真实 EPS 遥测',active:true}})),'正在检查真实 EPS 遥测');
 const html=renderThreadsOverview([t(1,'running',{activeRunId:'run1',latestPublicSummary:{text:'<script>not executable</script>'}})],{projectId:'p',mainThreadId:id(0)});assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
});
test('Overview shows peer threads without nesting and distinguishes active computation from passive waiting',()=>{
 const parent=t(1,'running',{activeRunId:'run1'}),child=t(2,'reviewing',{activeRunId:null,parentThreadId:parent.id,latestPublicSummary:null});
 const html=renderThreadsOverview([parent,child],{projectId:'p',mainThreadId:id(0)});assert.match(html,/indicator-spinner/);assert.match(html,/indicator-clock/);assert.doesNotMatch(html,/Thread 1 › /);assert.match(html,/Thread 1/);assert.match(html,/Thread 2/);assert.match(html,/待复核/);
 const expanded=renderThreadsOverview([t(3,'completed')],{projectId:'p',mainThreadId:id(0),openGroups:{resolved:true}});assert.match(expanded,/data-thread-group="resolved" data-thread-project="p" open/);
});

test('empty groups stay collapsed and attention uses a lock only for an actual approval request',()=>{
 const empty=renderThreadsOverview([],{projectId:'p',mainThreadId:id(0)});assert.doesNotMatch(empty,/data-thread-project="p" open/);
 const failed=threadOverviewGroups([t(1,'failed')],{projectId:'p',mainThreadId:id(0)});assert.equal(overviewActivityIndicator(failed),'error');
 const approval=threadOverviewGroups([t(1,'waiting_approval')],{projectId:'p',mainThreadId:id(0)});assert.equal(overviewActivityIndicator(approval),'approval');
 const waiting=threadOverviewGroups([t(2,'waiting_job')],{projectId:'p',mainThreadId:id(0)});assert.equal(overviewActivityIndicator(waiting),'clock');
 assert.equal(overviewActivityIndicator(threadOverviewGroups([t(3,'running',{activeRunId:'run'})],{projectId:'p',mainThreadId:id(0)})),'spinner');
});

test('spinner has no fake center dot and a missing public summary does not repeat the status',()=>{
 const html=renderThreadsOverview([t(1,'running',{activeRunId:'run1'})],{projectId:'p',mainThreadId:id(0)});
 assert.match(html,/indicator-spinner" aria-hidden="true"><\/span>/);assert.doesNotMatch(html,/overview-thread-summary/);assert.equal((html.match(/执行中/g)||[]).length,2);
 const withSummary=renderThreadsOverview([t(2,'running',{activeRunId:'run2',latestPublicSummary:{text:'正在检查电源预算',active:true}})],{projectId:'p',mainThreadId:id(0)});assert.match(withSummary,/overview-thread-summary/);assert.match(withSummary,/正在检查电源预算/);
});

test('a previously expanded group closes while empty without placeholders and its preference applies when populated again',()=>{
 const preference={working:true},empty=renderThreadsOverview([],{projectId:'p',mainThreadId:id(0),openGroups:preference});
 assert.doesNotMatch(empty,/data-thread-project="p" open/);assert.doesNotMatch(empty,/暂无|overview-group-empty/);assert.equal(preference.working,true);
 const populated=renderThreadsOverview([t(1,'running',{activeRunId:'new'})],{projectId:'p',mainThreadId:id(0),openGroups:preference});assert.match(populated,/data-thread-group="working" data-thread-project="p" open/);
});
