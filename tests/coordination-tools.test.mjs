import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStore} from '../server/store.mjs';
import {createToolRuntime,TOOL_DEFINITIONS} from '../server/tools.mjs';

async function fixture(t,options={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-coordination-tools-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=createStore({dataDir:path.join(root,'data'),seed:false}),project=store.createProject({name:'Task coordination'}),workspace=store.workspace(project.id),controller=new AbortController();
  const ctx={projectId:project.id,threadId:project.coordinatorThreadId,runId:'main-run',agentId:'main-agent',permissionMode:'auto',signal:controller.signal};
  return {store,project,workspace,ctx,controller,runtime:createToolRuntime({store,emit:()=>{},...options})};
}

test('coordination schemas describe real waiting, ownership and evidence review without a fixed worker count',()=>{
  for(const name of ['start_thread','delegate_task']){
    const definition=TOOL_DEFINITIONS.find(t=>t.name===name);assert.deepEqual(definition.parameters.required,['task']);
    for(const property of ['taskKey','scope','workKind','deliverables','ownedPaths','acceptanceCriteria'])assert.ok(definition.parameters.properties[property]);
    assert.match(definition.description,/active/);
  }
  const wait=TOOL_DEFINITIONS.find(t=>t.name==='wait_threads');assert.deepEqual(wait.parameters.properties.mode.enum,['all','any']);assert.equal(wait.parameters.properties.timeoutMs.maximum,1800000);
  const review=TOOL_DEFINITIONS.find(t=>t.name==='review_task_results');assert.deepEqual(review.parameters.required,['reviews']);assert.match(review.description,/evidence references/);
  assert.ok(TOOL_DEFINITIONS.find(t=>t.name==='get_task_assignments'));
});

test('legacy and explicit delegation pass normalized task contracts to the existing scheduler',async t=>{
  const calls=[],h=await fixture(t,{delegate:(args,ctx)=>{calls.push({args,ctx});return {thread:{id:'worker'},asynchronous:true};}});
  const legacy=await h.runtime.execute('start_thread',{task:' Read source '},h.ctx);assert.equal(legacy.thread.id,'worker');assert.equal(calls[0].ctx,h.ctx);assert.match(calls[0].args.taskKey,/^task:/);assert.equal(calls[0].args.scope,'Read source');
  await h.runtime.execute('delegate_task',{task:'Check units',taskKey:'units',ownedPaths:['./reports/units/'],deliverables:[' report.md ']},h.ctx);
  assert.deepEqual(calls[1].args.ownedPaths,['reports/units']);assert.deepEqual(calls[1].args.deliverables,['report.md']);
  await assert.rejects(h.runtime.execute('start_thread',{task:'Do not escape',ownedPaths:['../elsewhere']},h.ctx),/relative/);assert.equal(calls.length,2);
});

test('wait bridge awaits one cancellable callback instead of polling and preserves native context',async t=>{
  let calls=0,received;const h=await fixture(t,{waitThreads:(args,ctx)=>{calls++;received={args,ctx};return new Promise((resolve,reject)=>{ctx.signal.addEventListener('abort',()=>reject(new Error('Task wait cancelled')),{once:true});});}});
  const waiting=h.runtime.execute('wait_threads',{threadIds:[' worker ','worker'],mode:'any',timeoutMs:2000,reason:'Need source results'},h.ctx);
  assert.equal(calls,1);assert.equal(received.ctx,h.ctx);assert.deepEqual(received.args,{threadIds:['worker'],mode:'any',timeoutMs:2000,reason:'Need source results'});
  h.controller.abort();await assert.rejects(waiting,/cancelled/);assert.equal(calls,1);
});

test('registry and result-review bridges keep thread/run evidence references intact',async t=>{
  let reviewed;const h=await fixture(t,{taskAssignments:ctx=>({threadId:ctx.threadId,assignments:[{threadId:'w',scope:'Source'}]}),reviewTaskResults:(args,ctx)=>{reviewed={args,ctx};return {reviewed:1};}});
  assert.equal((await h.runtime.execute('get_task_assignments',{},h.ctx)).threadId,h.ctx.threadId);
  assert.deepEqual(await h.runtime.execute('review_task_results',{reviews:[{threadId:' w ',runId:' r ',outcome:'accepted',findings:' Checked ',evidence:[' artifact:design ']}]},h.ctx),{reviewed:1});
  assert.equal(reviewed.ctx,h.ctx);assert.deepEqual(reviewed.args.reviews,[{threadId:'w',runId:'r',outcome:'accepted',findings:'Checked',evidence:['artifact:design']}]);
  await assert.rejects(h.runtime.execute('review_task_results',{reviews:[{threadId:'w',runId:'r',outcome:'accepted',findings:'Claimed'}]},h.ctx),/evidence/);
});

test('ownership conflict blocks a main-thread write before approval or filesystem mutation',async t=>{
  let approvals=0,checks=0;const h=await fixture(t,{assertWriteOwnership:(file,ctx)=>{checks++;assert.equal(file,'source/owned.c');assert.equal(ctx.threadId,h.ctx.threadId);throw new Error('Owned by active worker');},requestApproval:async()=>{approvals++;return true;}});
  await assert.rejects(h.runtime.execute('write_file',{path:'source/owned.c',content:'overwrite'},h.ctx),/Owned by active worker/);
  assert.equal(checks,1);assert.equal(approvals,0);assert.equal(await fs.stat(path.join(h.workspace,'source')).catch(()=>null),null);
});

test('public-source ownership stops duplicate fetches before any network or approval',async t=>{
  let fetches=0,approvals=0,claimed=true;
  const h=await fixture(t,{assertWorkOwnership:(name,ctx)=>{assert.equal(ctx.threadId,h.ctx.threadId);if(claimed)throw new Error('Public source investigation is assigned to worker');},webFetcher:async()=>{fetches++;return {text:'Source'};},assetFetcher:async()=>{fetches++;return {bytes:Buffer.from('source')};},requestApproval:async()=>{approvals++;return true;}});
  await assert.rejects(h.runtime.execute('web_fetch',{url:'https://example.org/source'},h.ctx),/assigned to worker/);
  await assert.rejects(h.runtime.execute('fetch_public_asset',{url:'https://example.org/source.zip'},{...h.ctx,permissionMode:'manual'}),/assigned to worker/);
  assert.equal(fetches,0);assert.equal(approvals,0);
  claimed=false;assert.equal((await h.runtime.execute('web_fetch',{url:'https://example.org/source'},h.ctx)).text,'Source');assert.equal(fetches,1);
});

test('write ownership is rechecked after a Manual approval so a new conflicting assignment wins',async t=>{
  let claimed=false,checks=0;const h=await fixture(t,{assertWriteOwnership:()=>{checks++;if(claimed)throw new Error('New worker owns this scope');},requestApproval:async()=>{claimed=true;return true;}});
  await assert.rejects(h.runtime.execute('write_file',{path:'analysis/result.md',content:'stale write'},{...h.ctx,permissionMode:'manual'}),/New worker/);
  assert.equal(checks,2);assert.equal(await fs.stat(path.join(h.workspace,'analysis')).catch(()=>null),null);
});

test('legitimate task-local writes work while ownership checks do not restrict evidence reads',async t=>{
  const checks=[],h=await fixture(t,{assertWriteOwnership:(file,ctx)=>checks.push({file,threadId:ctx.threadId})});
  await h.runtime.execute('write_file',{path:'analysis/own.md',content:'Recorded source'},h.ctx);assert.equal(checks.length,2);
  assert.equal((await h.runtime.execute('read_file',{path:'analysis/own.md'},{...h.ctx,threadId:'reviewer'})).content,'Recorded source');assert.equal(checks.length,2);
});

test('aborted coordination calls never reach callbacks',async t=>{
  let calls=0;const h=await fixture(t,{waitThreads:()=>calls++,reviewTaskResults:()=>calls++,taskAssignments:()=>calls++});h.controller.abort();
  for(const [name,args]of [['wait_threads',{}],['get_task_assignments',{}],['review_task_results',{reviews:[]}]])await assert.rejects(h.runtime.execute(name,args,h.ctx),/Cancelled/);
  assert.equal(calls,0);
});
