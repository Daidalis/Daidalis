import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTaskTree,taskAncestors,mergeTaskRecords} from '../shared/task-tree.mjs';
import {renderTaskTree,renderTaskBreadcrumb,renderEngineeringPlan,taskReviewPresentation} from '../public/task-views.mjs';
const main={id:'main',projectId:'p',kind:'coordinator',title:'Main'},eps={id:'eps',projectId:'p',parentThreadId:'main',title:'电源'},solver={id:'solver',projectId:'p',parentThreadId:'eps',title:'食期求解',executionStatus:'waiting_job'};
test('conversation list is flat even for historical nested records, with Coordinator first',()=>{
 const input=[solver,eps,main,{id:'other',projectId:'q',title:'private'}],before=JSON.stringify(input),tree=buildTaskTree(input,{projectId:'p',mainThreadId:'main'});
 assert.deepEqual(tree.map(row=>row.thread.id),['main','solver','eps']);assert.ok(tree.every(row=>row.children.length===0));assert.equal(JSON.stringify(input),before);assert.deepEqual(taskAncestors('solver',input,'main').map(t=>t.id),['main','solver']);
});
test('missing or cyclic historical parents never hide conversations',()=>{
 const tasks=[{id:'missing',parentThreadId:'gone'},{id:'a',parentThreadId:'b'},{id:'b',parentThreadId:'a'},{id:'self',parentThreadId:'self'}],tree=buildTaskTree(tasks);
 assert.deepEqual(tree.map(n=>n.thread.id),['missing','a','b','self']);assert.ok(tree.every(n=>n.children.length===0));assert.equal(taskAncestors('a',tasks).length,1);
});
test('every thread including delivered work opens its chat without expandable branches',()=>{
 const html=renderTaskTree([main,eps,{...solver,title:'<img src=x>',executionStatus:'completed',pendingResultCount:1}],{projectId:'p',mainThreadId:'main',selectedId:'solver',collapsed:{eps:true}});
 assert.match(html,/aria-label="项目对话"/);assert.match(html,/data-id="solver" aria-current="true"/);assert.match(html,/已交付 · 1 项结果待复核/);assert.doesNotMatch(html,/role="tree"|role="group"|toggle-task-branch/);assert.match(html,/&lt;img src=x&gt;/);assert.doesNotMatch(html,/<img|private/);
 const crumb=renderTaskBreadcrumb('solver',[main,eps,solver],'main');assert.match(crumb,/对话位置/);assert.match(crumb,/Coordinator/);assert.doesNotMatch(crumb,/data-id="eps"/);assert.match(crumb,/aria-current="location"/);
});
test('engineering work graph exposes dependencies and verification correspondence without implying approval',()=>{
 const html=renderEngineeringPlan({revision:4,goal:'STF',openQuestions:['<unknown>'],items:[{id:'need',title:'电量约束',stage:'requirements',status:'proposed'},{id:'design',title:'电源方案',stage:'design',status:'reviewed',dependsOn:['need'],threadId:'eps',modelPaths:['models/power.mo'],verification:{method:'仿真',requirementIds:['need'],acceptanceCriteria:['电量大于限值'],evidenceIds:[]}}]});
 assert.match(html,/依赖：电量约束/);assert.match(html,/对应需求/);assert.match(html,/尚未关联证据/);assert.match(html,/任务交付不等于工程批准/);assert.match(html,/data-action="select-thread" data-id="eps"/);assert.match(html,/data-path="models\/power.mo"/);assert.match(html,/&lt;unknown&gt;/);
 assert.match(renderEngineeringPlan({revision:0,items:[]}),/尚未建立工程计划/);assert.match(renderEngineeringPlan(null,{error:'unavailable'}),/role="alert"/);
});

test('new project can render overview while main and side details are not loaded',()=>{
 const records=mergeTaskRecords({globalThreads:[],detail:null,projectThreads:[main],sideThread:null});
 assert.deepEqual(records,[main]);assert.match(renderTaskTree(records,{projectId:'p',mainThreadId:'main'}),/Coordinator/);
 assert.deepEqual(mergeTaskRecords({globalThreads:null,detail:{childThreads:null},projectThreads:null}),[]);
 assert.deepEqual(mergeTaskRecords({globalThreads:[{...main,title:'old'}],detail:{childThreads:[eps]},projectThreads:[main]}),[main,eps]);
});

test('task-key plan assignments navigate the resolved thread without conflating work and runtime state',()=>{
 const html=renderEngineeringPlan({items:[{id:'eps',title:'电源设计',stage:'design',status:'active',threadId:null,taskKey:'eps',task:{threadId:'resolved-eps',executionPhase:'waiting_job'}}]});
 assert.match(html,/data-id="resolved-eps"/);assert.match(html,/打开负责线程 · 等待工程作业/);assert.match(html,/进行中/);
});

test('delivery review is separate from execution completion, with needs-work and blocked action visible',()=>{
 for(const [reviewStatus,label]of [['needs_work','需要补充'],['blocked','复核受阻'],['unreviewed','待上级复核'],['accepted','交付已复核']]){
  const task={...solver,executionStatus:'completed',reviewStatus},html=renderTaskTree([main,eps,task],{projectId:'p',mainThreadId:'main'});
  assert.match(html,new RegExp('已交付 · '+label));assert.equal(taskReviewPresentation(task).attention,['needs_work','blocked'].includes(reviewStatus));
 }
 assert.equal(taskReviewPresentation({...main,executionStatus:'completed',reviewStatus:'unreviewed'}).label,'');
 assert.equal(taskReviewPresentation({...solver,executionStatus:'running',reviewStatus:'unreviewed'}).label,'');
 assert.equal(taskReviewPresentation({...eps,executionStatus:'reviewing',pendingResultCount:2,reviewStatus:'needs_work'}).label,'需要补充 · 2 项结果待复核');
});

test('fresh project overview wins over stale side detail and a detached inspector adds no task state',()=>{
 const fresh={...eps,executionStatus:'completed'},stale={...eps,executionStatus:'waiting_job'};
 assert.equal(mergeTaskRecords({projectThreads:[fresh],sideThread:stale,sideThreadId:null})[0].executionStatus,'completed');
 assert.equal(mergeTaskRecords({projectThreads:[fresh],sideThread:stale,sideThreadId:eps.id})[0].executionStatus,'completed');
 assert.deepEqual(mergeTaskRecords({sideThread:stale,sideThreadId:null}),[]);
 assert.equal(mergeTaskRecords({sideThread:stale,sideThreadId:eps.id})[0].executionStatus,'waiting_job');
});
