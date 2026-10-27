import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngineeringPlanService,normalizeEngineeringPlan} from '../server/engineering-plan.mjs';
import {createEngineeringPlanRuntime} from '../server/engineering-plan-tools.mjs';
function fixture() {
 let saves=0;
 const store={data:{projects:[{id:'p1'},{id:'p2'}],threads:[{id:'thread1',projectId:'p1',title:'EPS',status:'active',taskContract:{taskKey:'eps'}},{id:'thread2',projectId:'p2',title:'Other'}],runs:[{id:'run1',threadId:'thread1',status:'waiting_tasks',executionPhase:'waiting_tasks'}],artifacts:[{id:'artifact1',projectId:'p1'},{id:'artifact2',projectId:'p2'}],events:[{id:'event1',projectId:'p1',type:'tool.completed'},{id:'event2',projectId:'p2',type:'tool.completed'}],engineeringStates:[{projectId:'p1',objects:[{id:'req1'},{id:'deleted',deletedAt:'before'}],evidence:[{id:'ev1',result:'inconclusive'}]}]},save(){saves++;}};
 return {store,service:createEngineeringPlanService({store}),saves:()=>saves};
}
const base=()=>({expectedRevision:0,goal:'基于资料开发完整 STF',sources:['sources/NASA-STF.md'],assumptions:['轨道参数待确认'],openQuestions:['科学产品定义 TBD'],items:[{id:'mission',title:'任务定义',stage:'mission',status:'active',verification:{method:'审查任务场景',acceptanceCriteria:['任务场景有来源']}},{id:'eps',title:'电源设计',parentId:'mission',dependsOn:['mission'],stage:'design',status:'waiting',taskKey:'eps',recordIds:['req1'],modelPaths:['models/EPS.mo'],deliverables:['功耗模型与能量预算']}]});
test('engineering plan survives service recreation and projects task execution separately from work review',()=>{
 const {service,store,saves}=fixture();assert.equal(service.get('p1').revision,0);assert.equal(saves(),0);
 const plan=service.update('p1',base());assert.equal(plan.revision,1);assert.equal(plan.maturity,'candidate');assert.equal(plan.items[1].task.threadId,'thread1');assert.equal(plan.items[1].task.executionStatus,'waiting_tasks');assert.deepEqual(plan.items[1].waitingFor,['mission']);assert.equal(plan.items[1].status,'waiting');
 const restored=createEngineeringPlanService({store}).get('p1');assert.equal(restored.goal,'基于资料开发完整 STF');assert.deepEqual(restored.openQuestions,['科学产品定义 TBD']);assert.equal(saves(),1);
});
test('concurrent stale edits fail CAS without dropping engineering work',()=>{
 const {service,saves}=fixture();service.update('p1',base());assert.throws(()=>service.update('p1',base()),e=>e.status===409);assert.equal(service.get('p1').items.length,2);assert.equal(saves(),1);
 const next=base();next.expectedRevision=1;next.items.push({id:'physical',title:'环境与寿命试验',stage:'validation',status:'blocked',description:'当前缺少实物与试验设施，适用要求保留'});assert.equal(service.update('p1',next).revision,2);assert.equal(service.get('p1').items[2].status,'blocked');
});
test('rejects hierarchy cycles, dependency cycles and missing references',()=>{
 for(const change of [p=>p.items[0].parentId='eps',p=>p.items[0].dependsOn=['eps'],p=>p.items[1].dependsOn=['missing'],p=>p.items.push({...p.items[0]})]){const {service}=fixture(),p=base();change(p);assert.throws(()=>service.update('p1',p),e=>e.status===400);assert.equal(service.get('p1').revision,0);}
});
test('plan review needs real evidence but never grants engineering authority',()=>{
 const {service}=fixture(),p=base();p.items[0].status='reviewed';assert.throws(()=>service.update('p1',p),/needs findings/);
 p.items[0].review={findings:'核对已记录需求来源；仍有未决参数',evidenceIds:['invented']};assert.throws(()=>service.update('p1',p),/Unknown recorded evidence/);
 p.items[0].review.evidenceIds=['artifact1','ev1','event1'];const plan=service.update('p1',p);assert.deepEqual(plan.items[1].waitingFor,[]);assert.equal(plan.items[0].maturity,'candidate');assert.equal(plan.maturity,'candidate');assert.equal(plan.items[0].verification.evidenceIds.length,0);assert.match(plan.scope,/do not approve requirements/);
 for(const status of ['verified','approved','complete']){const other=base();other.items[0].status=status;const {expectedRevision,...input}=other;assert.throws(()=>normalizeEngineeringPlan(input),e=>e.status===400);}
});
test('project ownership and existing ledger/artifact evidence references are enforced',()=>{
 for(const change of [p=>p.items[0].threadId='thread2',p=>p.items[0].recordIds=['missing'],p=>p.items[0].recordIds=['deleted'],p=>p.items[0].artifactIds=['artifact2'],p=>p.items[0].verification.evidenceIds=['event2'],p=>p.items[0].verification.requirementIds=['missing']]){const {service}=fixture(),p=base();change(p);assert.throws(()=>service.update('p1',p),e=>e.status===400);}
 const {service}=fixture();assert.throws(()=>service.get('unknown'),e=>e.status===404);
});
test('bounded safe navigation paths and unknown approval fields are rejected',()=>{
 for(const unsafe of ['../host','/tmp/model.mo','.env/key','models/../model.mo','node_modules/model.mo']){const p=base();p.items[0].modelPaths=[unsafe];const {expectedRevision,...input}=p;assert.throws(()=>normalizeEngineeringPlan(input),e=>e.status===400);}
 for(const change of [p=>p.approved=true,p=>p.items[0].approval='approved',p=>p.items[0].verification.result='passed']){const {service}=fixture(),p=base();change(p);assert.throws(()=>service.update('p1',p),e=>e.status===400);}
});
test('store write failure rolls back plan and does not emit successful update',()=>{
 const {store}=fixture(),events=[],service=createEngineeringPlanService({store,emit:e=>events.push(e)});store.save=()=>{throw new Error('disk unavailable');};assert.throws(()=>service.update('p1',base()),/disk unavailable/);assert.equal(service.get('p1').revision,0);assert.equal(events.length,0);
 store.save=()=>{};service.update('p1',base());store.save=()=>{throw new Error('disk unavailable');};const next=base();next.expectedRevision=1;next.goal='Changed';assert.throws(()=>service.update('p1',next),/disk unavailable/);assert.equal(service.get('p1').goal,base().goal);assert.equal(events.length,1);
});
test('Agent tools preserve coordinator ownership, approval order and cancellation',async()=>{
 const {service}=fixture();let approvals=0;const runtime=createEngineeringPlanRuntime({service,authorizeMutation:async()=>{approvals++;}}),ctx={projectId:'p1',isCoordinator:true,runId:'run1'};
 assert.equal((await runtime.execute('get_engineering_plan',{},ctx)).revision,0);assert.equal(approvals,0);
 await assert.rejects(runtime.execute('update_engineering_plan',base(),{...ctx,isCoordinator:false}),/Only the project coordinator/);assert.equal(approvals,0);
 const abort=new AbortController();abort.abort();await assert.rejects(runtime.execute('update_engineering_plan',base(),{...ctx,signal:abort.signal}),/Cancelled/);assert.equal(service.get('p1').revision,0);
 const result=await runtime.execute('update_engineering_plan',base(),ctx);assert.equal(result.revision,1);assert.equal(result.updatedBy.kind,'agent');assert.equal(approvals,2);
});

test('read-modify-write plan roundtrip accepts null links but never copies observed authority',()=>{
 const {service}=fixture();service.update('p1',base());const current=service.get('p1');current.expectedRevision=current.revision;current.items[0].description='Updated from current UI plan';const updated=service.update('p1',current);assert.equal(updated.revision,2);assert.equal(updated.items[0].parentId,null);assert.equal(updated.items[1].task.executionStatus,'waiting_tasks');
 const approved=service.get('p1');approved.expectedRevision=approved.revision;approved.items[0].maturity='approved';assert.throws(()=>service.update('p1',approved),e=>e.status===400);
 const cross=service.get('p1');cross.expectedRevision=cross.revision;cross.projectId='p2';assert.throws(()=>service.update('p1',cross),e=>e.status===400);
});

test('an explicit thread and task key must identify the same owned assignment',()=>{
 const {service,store}=fixture(),p=base();p.items[1].threadId='thread1';p.items[1].taskKey='another-task';assert.throws(()=>service.update('p1',p),e=>e.status===400&&/does not match/.test(e.message));
 p.items[1].taskKey='eps';assert.equal(service.update('p1',p).items[1].task.threadId,'thread1');
 store.data.threads.push({id:'unassigned',projectId:'p1',title:'Unassigned task'});const next=base();next.expectedRevision=1;next.items[1].threadId='unassigned';assert.throws(()=>service.update('p1',next),e=>e.status===400&&/does not match/.test(e.message));
 delete next.items[1].taskKey;assert.equal(service.update('p1',next).items[1].task.threadId,'unassigned');
});
