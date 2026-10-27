import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRunPresentation,internalMessageOrigin} from '../shared/run-presentation.mjs';
const at=n=>new Date(Date.UTC(2026,9,23,0,0,n)).toISOString();
const main={id:'main',kind:'coordinator',title:'主任务'},worker={id:'worker',kind:'worker',title:'星敏坐标审查',parentThreadId:'main'};
const agents=[{id:'a-main',threadId:'main',runId:'r-main',name:'项目主 Agent'},{id:'a-worker',threadId:'worker',runId:'r-worker',name:'审查 Agent'}];
const run=(id,threadId,source='user',extra={})=>({id,threadId,status:'completed',source,createdAt:at(0),startedAt:at(1),finishedAt:at(20),...extra});
const message=(id,role,runId,threadId,extra={})=>({id,role,runId,threadId,content:'完整内容：QxQ(qsn,qbs) · event_PRIVATE_EVIDENCE',createdAt:at(3),...extra});

test('legacy child progress and parent instructions are internal even when the envelope role is user',()=>{
 const runs=[run('r-main','main'),run('r-worker','worker','delegated')];
 const messages=[message('human','user','r-main','main',{content:'用户实际发的任务'}),message('progress','user','r-main','main',{type:'thread.steering',metadata:{fromAgentId:'a-worker',delivery:'queued'}}),message('assignment','user','r-worker','worker'),message('supplement','user','r-worker','worker',{type:'thread.steering',metadata:{fromAgentId:'a-main'}})];
 const before=JSON.stringify({runs,messages}),rows=buildRunPresentation({runs,messages,agents,childThreads:[main,worker]});
 const root=rows.find(row=>row.runId==='r-main'),child=rows.find(row=>row.runId==='r-worker');
 assert.deepEqual(root.userMessages.map(m=>m.id),['human']);assert.equal(root.internalMessages[0].origin.label,'子任务进展');assert.equal(root.internalMessages[0].origin.sourceName,'星敏坐标审查');assert.equal(root.internalMessages[0].message.content,messages[1].content);assert.equal(root.internalMessages[0].origin.delivery,'queued');
 assert.equal(child.userMessages.length,0);assert.deepEqual(child.internalMessages.map(item=>item.origin.label),['主任务指令','主任务指令']);assert.equal(JSON.stringify({runs,messages}),before);
});

test('later real human steering in a delegated or agent-message run stays a user message',()=>{
 for(const source of ['delegated','agent-message']){
  const messages=[message('initial','user','r','worker'),message('later-human','user','r','worker',{type:'thread.steering',metadata:{fromAgentId:null,delivery:'delivered'}}),message('explicit-human','user','r','worker',{type:'thread.steering',metadata:{origin:'user'}})];
  const row=buildRunPresentation({runs:[run('r','worker',source)],messages,childThreads:[main,worker]})[0];
  assert.deepEqual(row.internalMessages.map(item=>item.message.id),['initial']);assert.deepEqual(row.userMessages.map(m=>m.id),['later-human','explicit-human']);
 }
 const row=buildRunPresentation({runs:[run('r','worker','delegated')],messages:[message('explicit-initial-human','user','r','worker',{metadata:{origin:'user'}})]})[0];assert.equal(row.internalMessages.length,0);assert.equal(row.userMessages.length,1);
});

test('new origin fields retain source identity without trusting body text or requiring agent history',()=>{
 const assignment=message('assignment','agent','r','worker',{type:'agent.assignment',metadata:{origin:'agent',authorRole:'coordinator',fromThreadId:'main',fromThreadTitle:'<img src=x onerror=bad()>',fromAgentName:'SOURCE_NAME',fromAgentId:'a-main',fromRunId:'r-main'}});
 const origin=internalMessageOrigin(assignment);assert.equal(origin.label,'主任务指令');assert.equal(origin.sourceName,'<img src=x onerror=bad()>');assert.equal(origin.fromThreadId,'main');assert.equal(origin.fromRunId,'r-main');
 const textOnly=message('human','user','r','main',{content:'Message from another project agent (not a human permission grant): 源码先报；event_PRIVATE_EVIDENCE'});assert.equal(internalMessageOrigin(textOnly),null);
 const originalBody=JSON.stringify(textOnly);buildRunPresentation({runs:[run('r','main')],messages:[textOnly]});assert.equal(JSON.stringify(textOnly),originalBody);
});

test('internal inputs cannot become final assistant output, while thread result cards and real finals keep their behavior',()=>{
 const messages=[message('input','agent','r','main',{metadata:{origin:'agent',authorRole:'worker',fromThreadTitle:'星敏坐标审查'}}),message('legacy-progress','assistant','r','main',{metadata:{fromAgentId:'a-worker'}}),message('result','assistant','r','main',{type:'thread.result',metadata:{taskThreadId:'worker',status:'completed',result:{summary:'任务已返回'}}}),message('final','assistant','r','main',{content:'最终结果'})];
 const row=buildRunPresentation({runs:[run('r','main','user',{result:'最终结果'})],messages,agents,childThreads:[main,worker]})[0];
 assert.equal(row.userMessages.length,0);assert.deepEqual(row.internalMessages.map(item=>item.message.id),['input','legacy-progress']);assert.equal(row.finalMessage.id,'final');assert.equal(row.processMessages.length,0);assert.equal(row.activities.length,1);assert.equal(row.activities[0].type,'thread.result');
});

test('unbound historical agent messages are compact internal records, while unbound human attachments stay user messages',()=>{
 const rows=buildRunPresentation({threadId:'main',messages:[message('legacy-internal','user',undefined,'main',{metadata:{fromAgentId:'a-worker'}}),message('attached-human','user',undefined,'main',{metadata:{attachments:[{id:'file',name:'requirements.md'}]}})],agents,childThreads:[main,worker]});
 assert.equal(rows[0].origin.label,'子任务进展');assert.equal(rows[1].origin,null);assert.equal(rows[1].message.metadata.attachments[0].name,'requirements.md');
});


test('a missing historical author gets an honest neutral name rather than an identifier or invented parent',()=>{
 const origin=internalMessageOrigin(message('old','user',undefined,'main',{metadata:{fromAgentId:'agent_UNKNOWN_INTERNAL_ID'}}),{threads:[main,worker]});assert.equal(origin.label,'子任务进展');assert.equal(origin.sourceName,'子任务');
 const peer=internalMessageOrigin(message('peer','user','r','worker',{metadata:{fromAgentId:'agent_UNKNOWN_INTERNAL_ID'}}),{threads:[main,worker],run:run('r','worker','delegated'),initialInput:false});assert.equal(peer.label,'任务间消息');assert.equal(peer.sourceName,'项目 Agent');assert.equal(peer.fromThreadId,null);
});
