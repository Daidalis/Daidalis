import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createCodexModelCatalog} from '../server/codex-models.mjs';

const fixtureSource=String.raw`
import readline from 'node:readline';
const scenario=process.env.MANTA_CATALOG_CASE;
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const answer=(id,result)=>send({id,result});
const model=(id,extra={})=>({id,model:id,displayName:id,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium',description:'Balanced'},{reasoningEffort:'high',description:'More reasoning'}],inputModalities:['text','image'],isDefault:false,...extra});
if(scenario==='stubborn'){process.on('SIGTERM',()=>{});setInterval(()=>{},1000);}
readline.createInterface({input:process.stdin}).on('line',line=>{
  const message=JSON.parse(line);
  if(message.method==='initialize'){
    if(scenario==='timeout')return;
    if(scenario==='close'){process.stderr.write(process.env.MANTA_FIXTURE_SECRET);process.exit(7);}
    answer(message.id,{userAgent:'catalog-fixture'});
  }else if(message.method==='config/read'){
    if(scenario==='config-unsupported')send({id:message.id,error:{code:-32601,message:'Method not found'}});
    else answer(message.id,{config:{model:scenario==='config-default'?'configured-model':null,api_key:process.env.MANTA_FIXTURE_SECRET},layers:[{private:'must-not-leak'}]});
  }else if(message.method==='model/list'){
    if(scenario==='malformed-json'){process.stdout.write('{not valid json}\n');return;}
    if(scenario==='malformed-page'){answer(message.id,{data:{},nextCursor:null});return;}
    if(scenario==='malformed-model'){answer(message.id,{data:[{id:null}],nextCursor:null});return;}
    if(scenario==='malformed-effort'){answer(message.id,{data:[model('bad',{supportedReasoningEfforts:[{}]})],nextCursor:null});return;}
    if(scenario==='error'){send({id:message.id,error:{code:-32000,message:'Failure '+process.env.MANTA_FIXTURE_SECRET+' Bearer token-value'}});return;}
    if(scenario==='repeat'){answer(message.id,{data:[model('one')],nextCursor:'repeat'});return;}
    if(scenario==='stubborn'){answer(message.id,{data:[model('one',{isDefault:true})],nextCursor:null});return;}
    if(!message.params.cursor){send({id:9090,method:'item/commandExecution/requestApproval',params:{command:'must-not-run'}});answer(message.id,{data:[model('recommended-model',{isDefault:true}),model('hidden-model',{hidden:true})],nextCursor:'next-page'});}
    else{
      const encoded=Buffer.from(JSON.stringify({id:message.id,result:{data:[model('recommended-model'),model('unicode',{displayName:'工程模型',extraPrivate:process.env.MANTA_FIXTURE_SECRET})],nextCursor:null}})+'\n');
      const at=encoded.indexOf(Buffer.from('工程'))+1;process.stdout.write(encoded.subarray(0,at));setTimeout(()=>process.stdout.write(encoded.subarray(at)),10);
    }
  }else if(message.method&& !['initialized'].includes(message.method)){send({id:message.id,error:{code:-32601,message:'Unexpected RPC '+message.method}});}
});
`;
async function setup(t,scenario='happy',{timeoutMs=3000}={}){
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'manta-codex-catalog-')));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'fixture.mjs');await fs.writeFile(file,fixtureSource);const frames=[],spawns=[],children=[];
  const catalog=createCodexModelCatalog({codexPath:'/fixture/codex',timeoutMs,spawnImpl:(exe,args,options)=>{
    spawns.push({exe,args,options});
    const child=spawn(process.execPath,[file],{...options,env:{...options.env,MANTA_CATALOG_CASE:scenario,MANTA_FIXTURE_SECRET:'catalog-private-key-12345'}});children.push(child);
    const write=child.stdin.write.bind(child.stdin);child.stdin.write=(data,...rest)=>{for(const line of String(data).trim().split('\n'))frames.push(JSON.parse(line));return write(data,...rest);};return child;
  }});
  t.after(()=>{for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
  return {catalog,dir,frames,spawns,children};
}
function onlyCatalogFrames(frames){assert.ok(frames.every(frame=>!frame.method||['initialize','initialized','config/read','model/list'].includes(frame.method)));assert.equal(frames.some(frame=>frame.method?.startsWith('thread/')),false);assert.equal(frames.some(frame=>frame.method?.startsWith('turn/')),false);assert.equal(frames.some(frame=>frame.method?.includes('write')),false);}

test('Codex catalog reads all visible pages, rejects server actions and preserves UTF-8 without inference',async t=>{
  const h=await setup(t);const result=await h.catalog.list({},{workspace:h.dir});
  assert.deepEqual(result.models.map(model=>model.model),['recommended-model','unicode']);assert.equal(result.models[1].displayName,'工程模型');
  assert.equal(result.models[1].extraPrivate,undefined);assert.equal(JSON.stringify(result).includes('must-not-leak'),false);assert.equal(JSON.stringify(result).includes('catalog-private-key'),false);
  assert.equal(result.source,'codex-app-server');assert.equal(result.catalogOnly,true);assert.equal(result.defaultModel,'recommended-model');assert.equal(result.defaultSource,'catalog');assert.equal(result.configuredModel,'');
  assert.deepEqual(result.models[0].supportedReasoningEfforts,[{reasoningEffort:'medium',description:'Balanced'},{reasoningEffort:'high',description:'More reasoning'}]);assert.deepEqual(result.models[0].inputModalities,['text','image']);
  const lists=h.frames.filter(frame=>frame.method==='model/list');assert.equal(lists.length,2);assert.equal(lists[0].params.includeHidden,false);assert.equal(lists[1].params.cursor,'next-page');
  assert.equal(h.frames.find(frame=>frame.method==='config/read').params.includeLayers,false);assert.equal(h.frames.find(frame=>frame.method==='config/read').params.cwd,h.dir);
  assert.equal(h.frames.find(frame=>frame.id===9090).error.code,-32601);assert.equal(h.spawns[0].options.cwd,h.dir);assert.equal(h.spawns[0].args.includes('multi_agent'),true);assert.equal(h.frames[0].params.capabilities.experimentalApi,true);
  onlyCatalogFrames(h.frames);assert.notEqual(h.children[0].exitCode??h.children[0].signalCode,null);
});

test('Native configured model overrides catalog recommendation and old config/read versions fall back',async t=>{
  const configured=await setup(t,'config-default');const result=await configured.catalog.list({},{workspace:configured.dir});assert.equal(result.defaultModel,'configured-model');assert.equal(result.configuredModel,'configured-model');assert.equal(result.defaultSource,'config');
  const unsupported=await setup(t,'config-unsupported');const fallback=await unsupported.catalog.list({},{workspace:unsupported.dir});assert.equal(fallback.defaultModel,'recommended-model');assert.equal(fallback.defaultSource,'catalog');onlyCatalogFrames(configured.frames);onlyCatalogFrames(unsupported.frames);
});

test('Custom endpoints report configured model without spawning the official account catalog',async()=>{
  let called=false;const catalog=createCodexModelCatalog({spawnImpl:()=>{called=true;throw new Error('No spawn');}});
  const result=await catalog.list({baseUrl:'https://custom.example/v1',model:'custom-model'},{workspace:'/does-not-exist'});
  assert.deepEqual(result,{models:[],source:'custom-endpoint',catalogOnly:true,configuredModel:'custom-model',supportsDiscovery:false});assert.equal(called,false);
});

test('API-key-only profiles cannot discover through a different native login account',async()=>{
  let called=false;const catalog=createCodexModelCatalog({spawnImpl:()=>{called=true;throw new Error('No spawn');}});
  const result=await catalog.list({apiKey:'private-api-profile-key',model:'api-selected-model'},{workspace:'/does-not-exist'});
  assert.deepEqual(result,{models:[],source:'api-key',catalogOnly:true,configuredModel:'api-selected-model',supportsDiscovery:false});assert.equal(called,false);assert.equal(JSON.stringify(result).includes('private-api-profile-key'),false);
});

test('Malformed JSON/pages/models and repeated cursors fail with child cleanup',async t=>{
  for(const scenario of ['malformed-json','malformed-page','malformed-model','malformed-effort','repeat']){
    const h=await setup(t,scenario);await assert.rejects(h.catalog.list({},{workspace:h.dir}),/Invalid|invalid|repeated/);assert.notEqual(h.children[0].exitCode??h.children[0].signalCode,null);onlyCatalogFrames(h.frames);
  }
});

test('Discovery timeout, abort, premature exit and stubborn child all close transports',async t=>{
  const timeout=await setup(t,'timeout',{timeoutMs:150});await assert.rejects(timeout.catalog.list({},{workspace:timeout.dir}),/timed out/);assert.notEqual(timeout.children[0].exitCode??timeout.children[0].signalCode,null);
  const cancelled=await setup(t,'timeout');const controller=new AbortController();const promise=cancelled.catalog.list({},{workspace:cancelled.dir,signal:controller.signal});setTimeout(()=>controller.abort(),80);await assert.rejects(promise,error=>error.name==='AbortError'&&error.code==='ABORT_ERR');assert.notEqual(cancelled.children[0].exitCode??cancelled.children[0].signalCode,null);
  const priorExitSecret=process.env.MANTA_CATALOG_EXIT_SECRET;process.env.MANTA_CATALOG_EXIT_SECRET='catalog-private-key-12345';t.after(()=>{if(priorExitSecret===undefined)delete process.env.MANTA_CATALOG_EXIT_SECRET;else process.env.MANTA_CATALOG_EXIT_SECRET=priorExitSecret;});
  const ended=await setup(t,'close');await assert.rejects(ended.catalog.list({keyEnv:'MANTA_CATALOG_EXIT_SECRET'},{workspace:ended.dir}),error=>/closed \(7\)/.test(error.message)&&!error.message.includes('catalog-private-key-12345'));
  const stubborn=await setup(t,'stubborn');const result=await stubborn.catalog.list({},{workspace:stubborn.dir});assert.equal(result.models.length,1);assert.equal(stubborn.children[0].signalCode,'SIGKILL');
});

test('Secrets are excluded from the child environment, metadata and RPC errors',async t=>{
  const prior=process.env.MANTA_OTHER_PROVIDER_SECRET;process.env.MANTA_OTHER_PROVIDER_SECRET='catalog-private-key-12345';t.after(()=>{if(prior===undefined)delete process.env.MANTA_OTHER_PROVIDER_SECRET;else process.env.MANTA_OTHER_PROVIDER_SECRET=prior;});
  const h=await setup(t,'error');await assert.rejects(h.catalog.list({keyEnv:'MANTA_OTHER_PROVIDER_SECRET'},{workspace:h.dir}),error=>error.message.includes('[REDACTED]')&&!error.message.includes('catalog-private-key-12345')&&!error.message.includes('token-value'));
  assert.equal(h.spawns[0].options.env.MANTA_OTHER_PROVIDER_SECRET,undefined);assert.equal(h.spawns[0].options.env.ANTHROPIC_API_KEY,undefined);assert.equal(h.spawns[0].options.env.OPENAI_API_KEY,undefined);assert.equal(JSON.stringify(h.frames).includes('catalog-private-key-12345'),false);
});

test('Invalid directory and already-aborted requests cannot launch a subprocess',async()=>{
  let count=0;const catalog=createCodexModelCatalog({spawnImpl:()=>{count++;}});await assert.rejects(catalog.list({},{workspace:'/definitely-not-an-existing-manta-directory'}),/existing directory/);
  const controller=new AbortController();controller.abort();await assert.rejects(catalog.list({},{signal:controller.signal}),{name:'AbortError',code:'ABORT_ERR'});assert.equal(count,0);
});
