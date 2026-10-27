import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTaskContract,overlappingTaskPaths,normalizeWaitThreadsArgs,normalizeReviewEntries} from '../server/task-contract.mjs';

test('legacy task calls gain stable contracts while whitespace and case do not duplicate a task',()=>{
  const a=normalizeTaskContract({task:' Read the source\n and return evidence. '}),b=normalizeTaskContract({task:'read THE source and return evidence.'});
  assert.equal(a.taskKey,b.taskKey);assert.match(a.taskKey,/^task:[a-f0-9]{24}$/);
  assert.equal(a.scope,'Read the source\n and return evidence.');
  assert.deepEqual(a.deliverables,[]);assert.deepEqual(a.ownedPaths,[]);assert.deepEqual(a.acceptanceCriteria,[]);
  assert.notEqual(a.taskKey,normalizeTaskContract({task:'Return different evidence.'}).taskKey);
  assert.equal(normalizeTaskContract({task:' Source check ',scope:'  '}).scope,'Source check');
});

test('task contract preserves explicit scope and normalizes exclusive file paths without mutating input',()=>{
  const args={task:'Investigate sensor frame',taskKey:'nos3:star_tracker-351',scope:' Read sensor frame conversion ',deliverables:[' report.md ',' report.md '],ownedPaths:['./analysis//sensor/','analysis/sensor/result.json'],acceptanceCriteria:[' Sources have line references ']},copy=structuredClone(args),contract=normalizeTaskContract(args);
  assert.deepEqual(args,copy);
  assert.deepEqual(contract,{taskKey:'nos3:star_tracker-351',scope:'Read sensor frame conversion',deliverables:['report.md'],ownedPaths:['analysis/sensor','analysis/sensor/result.json'],acceptanceCriteria:['Sources have line references']});
  assert.equal(normalizeTaskContract({task:'检查接口',taskKey:'接口:检查'}).taskKey,'接口:检查');
  assert.equal(normalizeTaskContract({task:'查证 NASA 来源',workKind:'public_sources'}).workKind,'public_sources');
  assert.throws(()=>normalizeTaskContract({task:'查证 NASA 来源',workKind:'unknown'}),/workKind/);
});

test('exclusive write scope rejects roots, absolute paths, traversal, globs and ambiguous path forms',()=>{
  for(const scope of ['.','./','/','/tmp/model','../model','src/../model','src/..','C:/data','C:\\data','\\\\host\\share','src\\file','src/*','src/a?','src/[abc]','src/{a,b}','src/\0x']){
    assert.throws(()=>normalizeTaskContract({task:'Validate',ownedPaths:[scope]}),undefined,scope);
  }
  assert.equal(normalizeTaskContract({task:'Validate',ownedPaths:['src/./file','src/folder/']}).ownedPaths.join(','),'src/file,src/folder');
});

test('ownership conflicts include ancestors and exact matches but exclude sibling and prefix names',()=>{
  assert.equal(overlappingTaskPaths(['src/sensor'],['src/sensor']),true);
  assert.equal(overlappingTaskPaths(['src/sensor'],['src/sensor/port.c']),true);
  assert.equal(overlappingTaskPaths(['src/sensor/port.c'],['src']),true);
  assert.equal(overlappingTaskPaths(['src/sensor'],['src/sensor2']),false);
  assert.equal(overlappingTaskPaths(['src/a'],['src/b']),false);
  assert.equal(overlappingTaskPaths([],['src']),false);
});

test('task contracts reject malformed fields and excessive unbounded work descriptions',()=>{
  for(const task of [null,undefined,{},'', ' ', 'x'.repeat(30001),'has\0null'])assert.throws(()=>normalizeTaskContract({task}));
  for(const taskKey of ['', 'has spaces','../escape','a/b','a\nkey','x'.repeat(161),4])assert.throws(()=>normalizeTaskContract({task:'Valid',taskKey}));
  for(const property of ['deliverables','ownedPaths','acceptanceCriteria']){
    assert.throws(()=>normalizeTaskContract({task:'Valid',[property]:'bad'}));
    assert.throws(()=>normalizeTaskContract({task:'Valid',[property]:new Array(41).fill('entry')}));
    assert.throws(()=>normalizeTaskContract({task:'Valid',[property]:['']}));
  }
});

test('wait contract keeps own-assignment selection implicit and constrains deadline',()=>{
  assert.deepEqual(normalizeWaitThreadsArgs({}),{mode:'all'});
  assert.deepEqual(normalizeWaitThreadsArgs({threadIds:[' worker-a ','worker-a','worker-b'],mode:'any',reason:' Need independent evidence ',timeoutMs:1800000}),{threadIds:['worker-a','worker-b'],mode:'any',reason:'Need independent evidence',timeoutMs:1800000});
  for(const timeoutMs of [0,-1,1800001,10.5,'10',NaN,Infinity])assert.throws(()=>normalizeWaitThreadsArgs({timeoutMs}));
  for(const threadIds of [[],null,'worker',[42],[' '],new Array(101).fill('w')])assert.throws(()=>normalizeWaitThreadsArgs({threadIds}));
  assert.throws(()=>normalizeWaitThreadsArgs({mode:'poll'}));
});

test('reviews identify exact result attempts and acceptance requires inspected evidence',()=>{
  const reviews=normalizeReviewEntries([{threadId:' worker-a ',runId:' run-2 ',outcome:'accepted',findings:' Checked units against source ',evidence:[' source:main.c:12 ','source:main.c:12']},{threadId:'worker-b',runId:'run-3',outcome:'needs_work',findings:'Wrong unit conversion'}]);
  assert.deepEqual(reviews,[{threadId:'worker-a',runId:'run-2',outcome:'accepted',findings:'Checked units against source',evidence:['source:main.c:12']},{threadId:'worker-b',runId:'run-3',outcome:'needs_work',findings:'Wrong unit conversion',evidence:[]}]);
  for(const evidence of [undefined,[],[' ']])assert.throws(()=>normalizeReviewEntries([{threadId:'w',runId:'r',outcome:'accepted',findings:'Checked',evidence}]));
  assert.throws(()=>normalizeReviewEntries([{threadId:'w',runId:'r',outcome:'accepted',findings:'Checked',evidence:['a']},{threadId:'w',runId:'r',outcome:'blocked',findings:'Cannot check'}]),/once/);
  assert.throws(()=>normalizeReviewEntries([{threadId:'w',runId:'r',outcome:'completed',findings:'Checked'}]),/outcome/);
  assert.throws(()=>normalizeReviewEntries([{threadId:'w',outcome:'blocked',findings:'Checked'}]),/runId/);
  assert.throws(()=>normalizeReviewEntries([]));
});
