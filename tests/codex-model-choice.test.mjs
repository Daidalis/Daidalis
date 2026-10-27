import test from 'node:test';
import assert from 'node:assert/strict';
import {isCodexProvider,modelCatalogKey,resolveCodexModel,codexModelOptions} from '../public/codex-model-choice.mjs';

const provider={id:'codex-local',type:'codex-app-server',model:'connection-model',baseUrl:''};
const catalog={defaultModel:'native-default',models:[{id:'one',model:'native-default',displayName:'Native default'},{id:'two',model:'another-model',displayName:'Another model'}]};

test('Only native Codex providers have per-thread native model selection',()=>{
  assert.equal(isCodexProvider(provider),true);assert.equal(isCodexProvider({...provider,type:'codex-cli'}),true);
  for(const type of ['claude-agent','openai-responses','openai-compatible','anthropic','ollama','demo'])assert.equal(resolveCodexModel({provider:{...provider,type},catalog,choice:'explicit'}),undefined);
  assert.equal(isCodexProvider(undefined),false);
});

test('Explicit local choice wins over saved thread preference, previous run and all defaults',()=>{
  const thread={modelPreferences:{'codex-local':'saved-model'}},runs=[{providerId:'codex-local',model:'previous-model'}];
  assert.equal(resolveCodexModel({provider,thread,runs,catalog,choice:'selected-model'}),'selected-model');
  assert.equal(resolveCodexModel({provider,thread,runs,catalog}),'saved-model');
  assert.deepEqual(thread.modelPreferences,{'codex-local':'saved-model'});
});

test('Legacy workers reuse their most recent matching provider model and ignore other providers',()=>{
  const runs=[{providerId:'codex-local',model:'older-model'},{providerId:'codex-local',model:'worker-inherited-model'},{providerId:'other-codex',model:'unrelated-model'}];
  assert.equal(resolveCodexModel({provider,thread:{},runs,catalog}),'worker-inherited-model');
  assert.equal(resolveCodexModel({provider,thread:{modelPreferences:{'other-codex':'unrelated-choice'}},runs,catalog}),'worker-inherited-model');
  assert.equal(resolveCodexModel({provider,thread:{modelPreferences:{'codex-local':'saved-main-model'}},runs,catalog}),'saved-main-model');
});

test('An explicit default reset suppresses previous worker models and follows connection or native default',()=>{
  const runs=[{providerId:'codex-local',model:'previous-worker-model'}];
  assert.equal(resolveCodexModel({provider,thread:{},runs,catalog,choice:''}),'connection-model');
  assert.equal(resolveCodexModel({provider,thread:{modelPreferences:{'codex-local':''}},runs,catalog}),'connection-model');
  const native={...provider,model:''};
  assert.equal(resolveCodexModel({provider:native,thread:{modelPreferences:{'codex-local':''}},runs,catalog}),'native-default');
  assert.equal(resolveCodexModel({provider:native,thread:{},runs:[],catalog}),'native-default');
  assert.equal(resolveCodexModel({provider:native,thread:{},runs:[]}),'');
});

test('Custom endpoint and uncatalogued stored model IDs stay selectable without invented models',()=>{
  const custom={...provider,id:'custom',baseUrl:'https://custom.example/v1',model:'custom-profile-model'};
  const customCatalog={models:[],supportsDiscovery:false,configuredModel:'custom-profile-model'};
  assert.equal(resolveCodexModel({provider:custom,thread:{},catalog:customCatalog}),'custom-profile-model');
  assert.equal(resolveCodexModel({provider:custom,thread:{modelPreferences:{custom:'custom-thread-model'}},catalog:customCatalog}),'custom-thread-model');
  assert.deepEqual(codexModelOptions(customCatalog,'custom-thread-model'),[{value:'custom-thread-model',label:'custom-thread-model'}]);
  assert.deepEqual(codexModelOptions(catalog,'retired-or-private-model'),[{value:'retired-or-private-model',label:'retired-or-private-model'},{value:'native-default',label:'Native default'},{value:'another-model',label:'Another model'}]);
  assert.deepEqual(codexModelOptions(undefined,''),[]);assert.equal(codexModelOptions(catalog,'native-default').length,2);
});

test('Catalog cache keys isolate project-scoped configuration and provider endpoint/default changes',()=>{
  const base=modelCatalogKey(provider,'project-a');
  assert.notEqual(base,modelCatalogKey(provider,'project-b'));
  for(const change of [{id:'other'},{type:'codex-cli'},{model:'new-profile-model'},{baseUrl:'https://custom.example/v1'}])assert.notEqual(base,modelCatalogKey({...provider,...change},'project-a'));
  assert.equal(base,modelCatalogKey({...provider,name:'Display rename'},'project-a'));
});
