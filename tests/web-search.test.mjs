import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createWebSearchService,AGENT_REACH_VERSION} from '../server/web-search.mjs';
import {spawnBounded} from '../server/sandbox.mjs';

const version={schema_version:1,ok:true,result:{version:AGENT_REACH_VERSION}};
const output=items=>({schema_version:1,ok:true,channel:'web',action:'search',backend:'exa',items});
const processOutput=(value,code=value.ok?0:1)=>({code,stdout:JSON.stringify(value),stderr:''});
async function fixture(t,{answer=output([{title:'Model 3',url:'https://www.tesla.com/model3',text:'Public specifications'}]),script,timeoutMs=45000,execute,versionAnswer=version}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-web-search-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const binary=path.join(root,'reach with spaces');await fs.writeFile(binary,script||'#!/bin/sh\nexit 0\n',{mode:0o700});
  const calls=[],service=createWebSearchService({root,dataDir:root,command:binary,timeoutMs,env:{...process.env,OPENAI_API_KEY:'never-forward-model-key',ANTHROPIC_API_KEY:'never-forward-anthropic-key',UNRELATED_PROJECT_SECRET:'never-forward-project-secret',HTTPS_PROXY:'http://proxy.example:1234'},execute:execute||(async(file,args,options)=>{calls.push({file,args,options});return processOutput(args[0]==='version'?versionAnswer:answer);})});
  return {root,binary,service,calls};
}

test('search uses the pinned real CLI protocol, literal argv and an isolated credential-free environment',async t=>{
  const h=await fixture(t),before=h.service.catalog();assert.equal(before.installed,true);assert.equal(before.ready,false);assert.equal(h.calls.length,0);
  const query='--timeout 999 $(touch injected) Model 3',result=await h.service.search({query,limit:3});
  assert.deepEqual(h.calls[0].args,['version']);assert.deepEqual(h.calls[1].args.slice(0,5),['web','search','--limit','3','--timeout']);assert.deepEqual(h.calls[1].args.slice(-2),['--',query]);
  const childEnv=h.calls[1].options.env;assert.equal(childEnv.OPENAI_API_KEY,undefined);assert.equal(childEnv.ANTHROPIC_API_KEY,undefined);assert.equal(childEnv.UNRELATED_PROJECT_SECRET,undefined);assert.equal(childEnv.HTTPS_PROXY,'http://proxy.example:1234');assert.equal(childEnv.HOME,path.join(h.root,'agent-reach'));assert.equal(h.calls[1].options.signal,undefined);
  assert.equal(result.provider,'agent-reach');assert.equal(result.results[0].url,'https://www.tesla.com/model3');assert.equal(result.untrusted,true);assert.ok(result.retrievedAt);assert.equal(h.service.catalog().ready,true);
  await h.service.search({query:'next query'});assert.equal(h.calls.length,3,'successful local version check is reused');
});

test('search rejects invalid input before starting a process and hides no failures as empty success',async t=>{
  const h=await fixture(t);
  for(const input of [{},{query:''},{query:' '},{query:3},{query:'a\0b'},{query:'a'.repeat(1001)},{query:'x',limit:0},{query:'x',limit:11},{query:'x',limit:1.5},{query:'x',limit:'2'}])await assert.rejects(h.service.search(input),error=>error.code==='WEB_SEARCH_BAD_INPUT');
  assert.equal(h.calls.length,0);
  const invalid=await fixture(t,{answer:{schema_version:1,ok:true,channel:'web',action:'search',items:'not an array'}});
  await assert.rejects(invalid.service.search({query:'x'}),error=>error.code==='WEB_SEARCH_PROTOCOL');
});

test('search bounds text and counts omitted private, credential-bearing and non-web URLs',async t=>{
  const invalid=['http://127.0.0.1/private','http://[::1]/','https://localhost/','https://internal.local/','https://metadata.google.internal/','https://user:password@example.org/','file:///etc/passwd','javascript:alert(1)','not a URL'];
  const h=await fixture(t,{answer:output([{title:'T'.repeat(500),url:'https://www.tesla.com/model3',text:'X'.repeat(6000),published_at:'2026-11-10',author:'Tesla'},...invalid.map(url=>({url})),{url:'https://extra.example.org/'}])});
  const result=await h.service.search({query:'model',limit:10});assert.equal(result.results.length,1);assert.equal(result.omittedResults,9);assert.equal(result.results[0].title.length,300);assert.equal(result.results[0].snippet.length,2500);assert.equal(result.results[0].publishedAt,'2026-11-10');assert.equal(result.truncated,true);
});

test('empty or unusable public source lists never count as a successful search',async t=>{
  for(const items of [[],[{url:'file:///etc/passwd'},{url:'https://127.0.0.1/private'}],[{url:'http://localhost./private'},{url:'https://host.local./private'},{url:'https://metadata.google.internal./'}]]){
    const h=await fixture(t,{answer:output(items)});
    await assert.rejects(h.service.search({query:'Model 3'}),error=>error.code==='WEB_SEARCH_NO_PUBLIC_RESULTS');
    assert.equal(h.service.catalog().ready,false);assert.equal(h.service.catalog().status,'blocked');
  }
});

test('rate limits and upstream errors are explicit, update status, and never trigger a retry loop',async t=>{
  for(const code of ['RATE_LIMITED','TIMEOUT','NEED_SETUP','UPSTREAM_BROKEN']){
    const h=await fixture(t,{answer:{schema_version:1,ok:false,error:{code,message:'private upstream diagnostic'},items:[]}});
    await assert.rejects(h.service.search({query:'Model 3'}),error=>error.code==='WEB_SEARCH_'+code&&!error.message.includes('private upstream diagnostic'));
    assert.equal(h.calls.length,2);assert.equal(h.service.catalog().ready,false);assert.equal(h.service.catalog().lastErrorCode,'WEB_SEARCH_'+code);
  }
});

test('an unsupported installed version fails before a search and an invalid override never falls back',async t=>{
  const h=await fixture(t,{versionAnswer:{...version,result:{version:'1.5.0'}}});
  await assert.rejects(h.service.search({query:'Model 3'}),error=>error.code==='AGENT_REACH_VERSION');assert.equal(h.calls.length,1);
  const missing=createWebSearchService({root:h.root,dataDir:h.root,command:path.join(h.root,'missing'),execute:()=>assert.fail('missing binary launched')});
  assert.equal(missing.catalog().installed,false);await assert.rejects(missing.search({query:'x'}),error=>error.code==='AGENT_REACH_UNAVAILABLE');
});

test('malformed stdout and nonzero exits cannot produce successful source evidence',async t=>{
  for(const result of [{code:0,stdout:'not JSON',stderr:'do not leak this stderr'},{code:1,stdout:JSON.stringify(output([])),stderr:'do not leak this stderr'}]){
    const h=await fixture(t,{execute:async(_file,args)=>args[0]==='version'?processOutput(version):result});
    await assert.rejects(h.service.search({query:'x'}),error=>error.code==='WEB_SEARCH_PROTOCOL'&&!error.message.includes('do not leak'));
  }
});

const waitingScript='#!/usr/bin/env node\nif(process.argv[2]===\'version\')console.log('+JSON.stringify(JSON.stringify(version))+');else setInterval(()=>{},1000);\n';
test('cancellation kills an actual running search process and does not mark it as an upstream failure',async t=>{
  const controller=new AbortController();let calls=0;
  const h=await fixture(t,{script:waitingScript,execute:(file,args,options)=>{calls++;if(args[0]==='web')setTimeout(()=>controller.abort(),100);return spawnBounded(file,args,options);}});
  await assert.rejects(h.service.search({query:'cancelled query'},{signal:controller.signal}),/Cancelled/);assert.equal(calls,2);assert.equal(h.service.catalog().lastErrorCode,null);
  await assert.rejects(h.service.search({query:'already cancelled'},{signal:controller.signal}),/Cancelled/);assert.equal(calls,2);
});

test('the subprocess deadline bounds a stalled search and oversized output fails closed',async t=>{
  const h=await fixture(t,{script:waitingScript,timeoutMs:1000,execute:spawnBounded}),started=Date.now();
  await assert.rejects(h.service.search({query:'slow'}),error=>error.code==='WEB_SEARCH_TIMEOUT');assert.ok(Date.now()-started<4000);
  const loud=await fixture(t,{script:waitingScript.replace('setInterval(()=>{},1000)',"process.stdout.write('x'.repeat(1100000))"),execute:spawnBounded});
  await assert.rejects(loud.service.search({query:'large'}),error=>error.code==='WEB_SEARCH_PROCESS');
  const late=await fixture(t,{timeoutMs:1000,execute:async(_file,args)=>{if(args[0]==='version')return processOutput(version);await new Promise(resolve=>setTimeout(resolve,1100));return processOutput(output([]));}});
  await assert.rejects(late.service.search({query:'late completion'}),error=>error.code==='WEB_SEARCH_TIMEOUT');assert.equal(late.service.catalog().ready,false);
});
