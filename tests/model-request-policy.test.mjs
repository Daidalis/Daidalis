import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStore} from '../server/store.mjs';
import {createProviderManager} from '../server/providers.mjs';
import {withModelRequestPolicy} from '../server/model-request-policy.mjs';

async function fixture(t,fetchImpl){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'manta-request-policy-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return createProviderManager({store:createStore({dataDir:dir,seed:false}),fetchImpl});}
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
const config={name:'Test API',type:'openai-compatible',model:'test',apiKey:'private-test-key'};
const request={messages:[{role:'user',content:'continue'}]};

test('request policy is configurable, validated, public and persisted without keys',async t=>{
  const manager=await fixture(t);const provider=manager.create(config);
  assert.equal(provider.requestTimeoutMs,300000);assert.equal(provider.maxRetries,2);
  const updated=manager.update(provider.id,{requestTimeoutMs:600000,maxRetries:0});
  assert.equal(updated.requestTimeoutMs,600000);assert.equal(updated.maxRetries,0);
  for(const patch of [{requestTimeoutMs:999},{requestTimeoutMs:1800001},{requestTimeoutMs:'300000'},{maxRetries:-1},{maxRetries:6},{maxRetries:1.5}])assert.throws(()=>manager.update(provider.id,patch));
  assert.equal(manager.getConfig(provider.id).requestTimeoutMs,600000);
  assert.ok(!JSON.stringify(manager.list()).includes(config.apiKey));
});

test('all API transports enforce the configured request timeout without hidden retries',async t=>{
  const keeper=setTimeout(()=>{},4000);t.after(()=>clearTimeout(keeper));
  const manager=await fixture(t,async(_url,{signal})=>new Promise((_,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});}));
  const outcomes=await Promise.allSettled(['openai-compatible','openai-responses','anthropic','ollama'].map(async type=>{
    const provider=manager.create({...config,type,name:type,requestTimeoutMs:1000,maxRetries:0}),events=[],started=Date.now();
    await assert.rejects(manager.complete(provider.id,{...request,onEvent:e=>events.push(e)}),error=>error.code==='MODEL_REQUEST_TIMEOUT'&&error.attempts===1&&error.requestTimeoutMs===1000);
    assert.ok(Date.now()-started>=900);assert.equal(events.filter(e=>e.type==='model.request.started').length,1);
    assert.equal(events.at(-1).data.category,'timeout');
  }));
  for(const result of outcomes)if(result.status==='rejected')throw result.reason;
});

test('request deadline also bounds a stalled body after response headers arrive',async t=>{
  const keeper=setTimeout(()=>{},4000);t.after(()=>clearTimeout(keeper));
  const manager=await fixture(t,async(_url,{signal})=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));if(signal.aborted)controller.error(signal.reason);else signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});}}),{headers:{'content-type':'application/json'}}));
  const outcomes=await Promise.allSettled(['openai-compatible','openai-responses','anthropic','ollama'].map(async type=>{
    const provider=manager.create({...config,type,name:'stalled '+type,requestTimeoutMs:1000,maxRetries:0});
    await assert.rejects(manager.complete(provider.id,request),error=>error.code==='MODEL_REQUEST_TIMEOUT'&&error.attempts===1);
  }));
  for(const result of outcomes)if(result.status==='rejected')throw result.reason;
});

test('429 honors Retry-After and retries the identical model request before returning a tool call',async t=>{
  const bodies=[],events=[];
  const manager=await fixture(t,async(_url,options)=>{bodies.push(options.body);return bodies.length===1?json({error:{message:'temporarily limited'}},429,{'retry-after':'0'}):json({choices:[{message:{content:'',tool_calls:[{id:'one-call',function:{name:'write_file',arguments:'{}'}}]}}]});});
  const provider=manager.create(config),result=await manager.complete(provider.id,{...request,onEvent:e=>events.push(e)});
  assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);assert.equal(result.toolCalls.length,1);assert.equal(result.toolCalls[0].id,'one-call');
  assert.equal(events.filter(e=>e.type==='model.request.retry').length,1);assert.equal(events.find(e=>e.type==='model.request.retry').data.delayMs,0);
});

test('authentication and invalid tool responses fail immediately instead of consuming retry budget',async t=>{
  for(const response of [()=>json({error:{message:'bad credential'}},401),()=>json({error:{message:'Invalid timeout parameter'}},400),()=>json({choices:[{message:{tool_calls:[{id:'invalid',function:{name:'x',arguments:'not JSON'}}]}}]})]){
    let calls=0;const manager=await fixture(t,async()=>{calls++;return response();}),provider=manager.create(config);
    await assert.rejects(manager.complete(provider.id,request));assert.equal(calls,1);
  }
});

test('cancellation during Retry-After stops promptly and never starts another request',async t=>{
  let calls=0;const controller=new AbortController(),events=[];
  const manager=await fixture(t,async()=>{calls++;return json({error:{message:'wait'}},503,{'retry-after':'60'});}),provider=manager.create(config);
  await assert.rejects(manager.complete(provider.id,{...request,signal:controller.signal,onEvent:event=>{events.push(event);if(event.type==='model.request.retry')controller.abort();}}),/Cancelled|abort/i);
  assert.equal(calls,1);assert.equal(events.filter(e=>e.type==='model.request.started').length,1);
});

test('retry exhaustion reports the actual number of attempts and timeout setting',async()=>{
  let calls=0;const events=[];
  await assert.rejects(withModelRequestPolicy(async()=>{calls++;throw Object.assign(Error('Request timed out.'),{headers:new Headers({'retry-after':'0'})});},{policy:{requestTimeoutMs:1000,maxRetries:2},onEvent:e=>events.push(e)}),error=>error.code==='MODEL_REQUEST_TIMEOUT'&&error.attempts===3&&error.requestTimeoutMs===1000);
  assert.equal(calls,3);assert.equal(events.filter(e=>e.type==='model.request.retry').length,2);
});

test('malformed Retry-After headers fall back to exponential backoff',async()=>{
  for(const headers of [{'retry-after':''},{'retry-after':'   '},{'retry-after':'-1'},{'retry-after':'1e3'},{'retry-after':'tomorrow'},{'retry-after-ms':'   '},{'retry-after-ms':'-1'},{'retry-after-ms':'bad','retry-after':'bad'}]){
    const controller=new AbortController();let delayMs,calls=0;
    await assert.rejects(withModelRequestPolicy(async()=>{calls++;throw Object.assign(Error('limited'),{status:429,headers:new Headers(headers)});},{policy:{requestTimeoutMs:1000,maxRetries:1},signal:controller.signal,onEvent:event=>{if(event.type==='model.request.retry'){delayMs=event.data.delayMs;controller.abort();}}}),/abort/i);
    assert.equal(delayMs,1000,JSON.stringify(headers));assert.equal(calls,1);
  }
});

test('Retry-After accepts numeric values and all HTTP date forms',async()=>{
  for(const [headers,expected] of [[{'retry-after-ms':'12.5'},12.5],[{'retry-after-ms':'bad','retry-after':'2'},2000],[{'retry-after':'0.5'},500],[{'retry-after':'Sun, 06 Nov 1994 08:49:37 GMT'},0],[{'retry-after':'Sunday, 06-Nov-94 08:49:37 GMT'},0],[{'retry-after':'Sun Nov  6 08:49:37 1994'},0]]){
    const controller=new AbortController();let delayMs;
    await assert.rejects(withModelRequestPolicy(async()=>{throw Object.assign(Error('limited'),{status:429,headers:new Headers(headers)});},{policy:{requestTimeoutMs:1000,maxRetries:1},signal:controller.signal,onEvent:event=>{if(event.type==='model.request.retry'){delayMs=event.data.delayMs;controller.abort();}}}),/abort/i);
    assert.equal(delayMs,expected,JSON.stringify(headers));
  }
  const retryAt=Date.now()+60000,controller=new AbortController();let delayMs;
  await assert.rejects(withModelRequestPolicy(async()=>{throw Object.assign(Error('limited'),{status:429,headers:new Headers({'retry-after':new Date(retryAt).toUTCString()})});},{policy:{requestTimeoutMs:1000,maxRetries:1},signal:controller.signal,onEvent:event=>{if(event.type==='model.request.retry'){delayMs=event.data.delayMs;controller.abort();}}}),/abort/i);
  assert.ok(delayMs>58000&&delayMs<=60000);
});

test('unrepresentable server deferrals stop with complete failure metadata',async()=>{
  for(const headers of [{'retry-after':'3000000'},{'retry-after-ms':'2147483648'},{'retry-after':'9'.repeat(400)}]){
    let calls=0;
    await assert.rejects(withModelRequestPolicy(async()=>{calls++;throw Object.assign(Error('Request timed out.'),{headers:new Headers(headers)});},{policy:{requestTimeoutMs:1000,maxRetries:1}}),error=>error.code==='MODEL_REQUEST_TIMEOUT'&&error.attempts===1&&error.requestTimeoutMs===1000);
    assert.equal(calls,1);
  }
});

test('network errors are retryable while a pre-cancelled request never reaches the API',async()=>{
  let calls=0;
  const result=await withModelRequestPolicy(async()=>{if(++calls===1)throw Object.assign(Error('connection reset'),{name:'APIConnectionError',headers:new Headers({'retry-after':'0'})});return 'recovered';},{policy:{requestTimeoutMs:1000,maxRetries:1}});
  assert.equal(result,'recovered');assert.equal(calls,2);
  const controller=new AbortController();controller.abort();
  await assert.rejects(withModelRequestPolicy(async()=>assert.fail('cancelled request sent'),{policy:{requestTimeoutMs:1000,maxRetries:1},signal:controller.signal}),/abort/i);
});
