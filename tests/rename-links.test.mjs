import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveThreadMention,threadMentionHref} from '../public/thread-mentions.mjs';
import {compactThreadHandoffs} from '../public/chat-navigation.mjs';
import {renderMarkdown} from '../public/document-viewer.mjs';
import {buildRecordedManifest} from '../shared/recorded-manifest.mjs';

const id='thread_11111111-1111-1111-1111-111111111111';
const foreignId='thread_22222222-2222-2222-2222-222222222222';
const thread={id,projectId:'project-a',kind:'worker',title:'Model 3 subsystem review',executionStatus:'completed'};
const options={projectId:'project-a',threads:[thread,{...thread,id:foreignId,projectId:'project-b'}]};
const prefixes=['#manta-thread:','#syspilot-thread:','#daidalis-thread:'];

test('persisted task links resolve through the real consumer and new links use only Daidalis',()=>{
  for(const prefix of prefixes){
    const resolved=resolveThreadMention(prefix+id,options);
    assert.equal(resolved?.threadId,id,prefix);
    assert.equal(resolved.title,thread.title);
    assert.equal(resolved.executionStatus,'completed');
    assert.equal(threadMentionHref(resolved.threadId,options),'#daidalis-thread:'+id);
  }
});

test('legacy task links retain project, identity and exact-link validation',()=>{
  for(const prefix of prefixes){
    for(const href of [
      prefix+foreignId,
      prefix+'thread_33333333-3333-3333-3333-333333333333',
      prefix+'thread_guess',
      prefix+id+'?q=1',
      prefix+id+'#extra',
      prefix+id+' ',
      prefix+id+'\n',
      prefix+id.replace('thread_','thread%5F'),
      prefix+'../'+id,
      prefix.slice(1)+id,
      'https://example.test/'+prefix+id,
    ])assert.equal(resolveThreadMention(href,options),null,href);
    assert.equal(resolveThreadMention(prefix+id,{...options,projectId:'project-b'}),null);
    assert.equal(resolveThreadMention(prefix+id,{threads:options.threads}),null);
    assert.equal(resolveThreadMention(prefix+id,{...options,threads:[thread,{...thread,projectId:'project-b'}]}),null);
  }
  assert.equal(threadMentionHref(foreignId,options),null);
});

test('the Markdown consumer preserves saved link targets without allowing embedded HTML',()=>{
  for(const prefix of prefixes){
    const href=prefix+id;
    const html=renderMarkdown('['+thread.title+']('+href+') <img src=x onerror=alert(1)>');
    assert.ok(html.includes('href="'+href+'"'));
    assert.ok(html.includes('data-document-anchor="'+href+'"'));
    assert.match(html,/&lt;img/);
    assert.doesNotMatch(html,/<img/);
    assert.equal(resolveThreadMention(href,options)?.threadId,id);
  }
});

test('saved handoff links still suppress duplicate start receipts while retaining actual results',()=>{
  const start={id:'start-receipt',kind:'thread',type:'thread.started',childThreadId:id};
  const result={id:'result-receipt',kind:'thread',type:'thread.result',childThreadId:id};
  for(const prefix of prefixes){
    const savedMessage={content:'['+thread.title+']('+prefix+id+')'};
    assert.deepEqual(compactThreadHandoffs({activities:[start],processMessages:[savedMessage]}),[]);
    assert.deepEqual(compactThreadHandoffs({activities:[start],finalMessage:savedMessage}),[]);
    assert.deepEqual(compactThreadHandoffs({activities:[start,result],finalMessage:savedMessage}),[result]);
  }
});

test('rebuilding a saved trajectory preserves hand-written fields across the schema rename',()=>{
  for(const schema of ['manta-recorded-trajectory-v1','daidalis-recorded-trajectory-v1']){
    const previous={schema,csv:'old-evidence.csv',provenance:'example',bindings:{tank_level:'manually_selected_part'},units:{tank_level:'L'},drive:'manually_selected_signal'};
    const original=structuredClone(previous);
    const manifest=buildRecordedManifest({previous,columns:['time','tank_level'],source:'part tank;',csv:'engineering/new-run/trajectory.csv',jobId:'new-run'});
    assert.equal(manifest.schema,'daidalis-recorded-trajectory-v1');
    assert.deepEqual(manifest.bindings,previous.bindings);
    assert.deepEqual(manifest.units,previous.units);
    assert.equal(manifest.drive,previous.drive);
    assert.equal(manifest.csv,'engineering/new-run/trajectory.csv');
    assert.equal(manifest.provenance,'fmu-run');
    assert.deepEqual(previous,original,'Reading the previous manifest must not rewrite historical evidence');
  }
});
