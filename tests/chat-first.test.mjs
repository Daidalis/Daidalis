import test from 'node:test';
import assert from 'node:assert/strict';
import {chatDetailOrigin,chatTurnDisclosure,compactThreadHandoffs,detailPromptDraft,isRoutineReadFailure,resolveThreadExecutionStatus} from '../public/chat-navigation.mjs';
import {completedTurnEntries} from '../public/chat-assets.mjs';
test('a completed turn folds every execution card while preserving full inspectable process',()=>{
 const activities=Array.from({length:71},(_,i)=>({id:'operation'+i,kind:'tool',status:i===3?'failed':'completed'})),row={status:'completed',activities},visible={activities,routes:[],messages:[{id:'progress'}]},view=chatTurnDisclosure(row,visible);
 assert.equal(view.live,false);assert.deepEqual(view.publicActivities,[]);assert.deepEqual(view.messages,[]);assert.equal(view.processActivities.length,71);assert.ok(view.processActivities.some(a=>a.status==='failed'));assert.equal(activities.length,71);
});
test('active tool, wait, approval, and failure remain visible while successful tools fold during execution',()=>{
 const activities=[{id:'active',status:'running'},{id:'waiting',status:'waiting_job'},{id:'approval',status:'waiting_approval'},{id:'error',status:'failed'},{id:'done',status:'completed'}],view=chatTurnDisclosure({status:'running',activities},{activities,routes:[],messages:[{id:'progress'}]});
 assert.deepEqual(view.publicActivities.map(a=>a.id),['active','waiting','approval','error']);assert.deepEqual(view.processActivities.map(a=>a.id),['done']);assert.equal(view.messages.length,1);
});
test('routine source failures and thread receipts fold while engineering failures stay prominent',()=>{
 const activities=[{id:'source',kind:'tool',tool:'WebFetch',status:'failed'},{id:'file',kind:'tool',tool:'mcp__manta__read_file',status:'failed'},{id:'solver',kind:'tool',tool:'wait_professional_job',status:'failed'},{id:'task',kind:'thread',type:'thread.started',childThreadId:'worker',status:'queued'}];
 const view=chatTurnDisclosure({status:'running',activities},{activities,routes:[],messages:[]});
 assert.deepEqual(view.publicActivities.map(a=>a.id),['solver']);
 assert.deepEqual(view.processActivities.map(a=>a.id),['source','file','task']);
 assert.equal(view.foldedReadFailureCount,2);
 assert.equal(isRoutineReadFailure(activities[2]),false);
});
test('one compact task handoff supersedes the start receipt and explicit prose avoids duplicate start',()=>{
 const started={id:'start',kind:'thread',type:'thread.started',childThreadId:'worker',status:'queued'};
 const returned={id:'return',kind:'thread',type:'thread.result',childThreadId:'worker',status:'completed'};
 assert.deepEqual(compactThreadHandoffs({activities:[started,returned]}),[returned]);
 assert.deepEqual(compactThreadHandoffs({activities:[started],processMessages:[{content:'已分派 #manta-thread:worker 审查来源。'}]}),[]);
 assert.deepEqual(compactThreadHandoffs({activities:[started],processMessages:[{content:'正在审查来源。'}]}),[started]);
});
test('opening a model from a Thread retains that origin; opening Coordinator content is independent of open side Thread',()=>{
 const context={projectId:'p',mainThreadId:'main',sideThreadId:'eps',sideThreadTitle:'电源设计'};
 assert.deepEqual(chatDetailOrigin({...context,fromThread:true}),{projectId:'p',threadId:'eps',title:'电源设计'});
 assert.deepEqual(chatDetailOrigin({...context,fromThread:false}),{projectId:'p',threadId:'main',title:'Coordinator'});
});
test('completed report/model links and exact job counts survive folding with no raw file wall',()=>{
 const artifacts=Array.from({length:200},(_,i)=>({id:'raw'+i,projectId:'p',runId:'r',path:`engineering/professional/professional_${String(i%5).padStart(32,'0')}/compiler-${i}.log`}));
 artifacts.push({id:'report',projectId:'p',runId:'r',name:'验收报告',type:'markdown'});
 const row={runId:'r',activities:[{id:'model',tool:'save_professional_model',status:'completed',result:{path:'engineering/models/STFDataDelivery.mo'}},{id:'plan',tool:'update_engineering_plan',status:'completed',result:{revision:4}}]},view=completedTurnEntries(row,{artifacts,projectId:'p'});
 assert.deepEqual(view.counts,{reports:1,models:1,jobs:5});assert.equal(view.files.length,2);assert.equal(view.files[0].name,'验收报告');assert.equal(view.hasPlan,true);assert.doesNotMatch(JSON.stringify(view.files),/compiler-/);
 const seventyOne={runId:'r',activities:Array.from({length:71},(_,i)=>({tool:'wait_professional_job',result:{jobId:'professional_'+String(i).padStart(32,'0'),status:'completed',executionSucceeded:true,model:{path:'STF.mo'}}}))};
 assert.equal(completedTurnEntries(seventyOne,{projectId:'p'}).counts.jobs,71);
});

test('ask from Thread detail stages only its own draft and preserves prior user input without sending',()=>{
 const drafts={main:'Coordinator 草稿',eps:'Thread 未发送的修改意见'},before=JSON.stringify(drafts),staged=detailPromptDraft({origin:{projectId:'p',threadId:'eps'},projectId:'p',mainThreadId:'main',drafts,text:'请检查这个模型'});
 assert.deepEqual(staged,{threadId:'eps',side:true,draft:'Thread 未发送的修改意见\n\n请检查这个模型'});assert.equal(JSON.stringify(drafts),before);assert.equal(drafts.main,'Coordinator 草稿');
 const main=detailPromptDraft({origin:{projectId:'p',threadId:'main'},projectId:'p',mainThreadId:'main',drafts,text:'继续调研'});assert.equal(main.threadId,'main');assert.equal(main.side,false);assert.equal(main.draft,'Coordinator 草稿\n\n继续调研');
 const stale=detailPromptDraft({origin:{projectId:'old',threadId:'unrelated'},projectId:'p',mainThreadId:'main',drafts,text:'新项目问题'});assert.equal(stale.threadId,'main');
 assert.equal(detailPromptDraft({projectId:'p',mainThreadId:'main',drafts:{main:'same'},text:'same'}).draft,'same');
});

test('detached running inspector cannot override a fresh terminal, idle or summarizing server overview',()=>{
 const side={thread:{id:'eps',projectId:'p'},runs:[{id:'old',threadId:'eps',status:'running',executionPhase:'waiting_job'}]};
 for(const executionStatus of ['completed','idle','summarizing','reviewing','stopped']){
  const current={id:'eps',projectId:'p',executionStatus};
  assert.equal(resolveThreadExecutionStatus(current,{projectThreads:[current],sideDetail:side,sideThreadId:null}),executionStatus);
  assert.equal(resolveThreadExecutionStatus(current,{projectThreads:[current],sideDetail:side,sideThreadId:'eps'}),executionStatus);
  assert.equal(resolveThreadExecutionStatus({id:'eps',projectId:'p'},{projectThreads:[current],sideDetail:side,sideThreadId:null}),executionStatus);
 }
 assert.equal(resolveThreadExecutionStatus({id:'eps',projectId:'p'},{sideDetail:side,sideThreadId:null}),'idle');
 assert.equal(resolveThreadExecutionStatus({id:'eps',projectId:'p'},{sideDetail:side,sideThreadId:'eps'}),'waiting_job');
});

test('all views prefer the current project overview over a stale argument execution phase',()=>{
 const stale={id:'eps',projectId:'p',executionStatus:'waiting_tasks'},fresh={id:'eps',projectId:'p',executionStatus:'summarizing'};
 assert.equal(resolveThreadExecutionStatus(stale,{projectThreads:[fresh]}),'summarizing');
});
