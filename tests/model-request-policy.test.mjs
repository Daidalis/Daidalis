import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {createStore} from '../server/store.mjs';
import {createProviderManager} from '../server/providers.mjs';
import {DEFAULT_REQUEST_POLICY,MODEL_RECOVERY_BUDGET_MS,withModelRequestPolicy} from '../server/model-request-policy.mjs';

async function fixture(t,fetchImpl){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'daidalis-request-policy-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return createProviderManager({store:createStore({dataDir:dir,seed:false}),fetchImpl});}
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
const config={name:'Test API',type:'openai-compatible',model:'test',apiKey:'private-test-key'};
const request={messages:[{role:'user',content:'continue'}]};

test('request policy is configurable, validated, public and persisted without keys',async t=>{
  const manager=await fixture(t);const provider=manager.create(config);
  assert.equal(provider.requestTimeoutMs,300000);assert.equal(provider.maxRetries,5);
  const customized=manager.create({...config,maxRetries:2});assert.equal(customized.maxRetries,2);
  assert.equal(manager.update(customized.id,{name:'Keep existing policy'}).maxRetries,2);
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
    assert.equal(delayMs,5000,JSON.stringify(headers));assert.equal(calls,1);
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

test('server deferrals beyond the recovery budget stop without an early retry',async()=>{
  for(const headers of [{'retry-after':'300'},{'retry-after':'301'},{'retry-after-ms':'300001'},{'retry-after':'3000000'},{'retry-after-ms':'2147483648'},{'retry-after':'9'.repeat(400)}]){
    let calls=0;
    await assert.rejects(withModelRequestPolicy(async()=>{calls++;throw Object.assign(Error('Request timed out.'),{headers:new Headers(headers)});},{policy:{requestTimeoutMs:1000,maxRetries:1}}),error=>error.code==='MODEL_RECOVERY_TIMEOUT'&&error.recoveryStopReason==='retry-after-exceeds-budget'&&error.recoveryBudgetMs===300000&&error.attempts===1&&error.requestTimeoutMs===1000);
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

function virtualClock(t){
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000000});
  t.mock.method(performance,'now',()=>Date.now());
  return async milliseconds=>{await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(milliseconds);await new Promise(resolve=>setImmediate(resolve));};
}

test('default recovery performs six attempts with the complete 5/10/20/40/60 second schedule',async t=>{
  const advance=virtualClock(t),events=[],times=[];
  const result=withModelRequestPolicy(async()=>{times.push(performance.now());throw Object.assign(Error('upstream refused'),{status:502});},{policy:DEFAULT_REQUEST_POLICY,onEvent:e=>events.push(e)});
  const rejected=assert.rejects(result,error=>error.status===502&&error.attempts===6);
  await advance(0);
  for(const milliseconds of [5000,10000,20000,40000,60000])await advance(milliseconds);
  await rejected;
  assert.deepEqual(times.map(value=>value-times[0]),[0,5000,15000,35000,75000,135000]);
  assert.deepEqual(events.filter(e=>e.type==='model.request.retry').map(e=>e.data.delayMs),[5000,10000,20000,40000,60000]);
  assert.equal(events.filter(e=>e.type==='model.request.failed').length,6);
});

test('recovery budget includes backoff and bounds an uncooperative in-flight adapter, excluding the first request',async t=>{
  const advance=virtualClock(t),events=[];let calls=0,rejectLate;
  const result=withModelRequestPolicy(async()=>{
    if(++calls===1)return new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(Error('temporary failure'),{status:503})),240000));
    return new Promise((_,reject)=>{rejectLate=reject;});
  },{policy:DEFAULT_REQUEST_POLICY,onEvent:e=>events.push(e)});
  const rejected=assert.rejects(result,error=>error.code==='MODEL_RECOVERY_TIMEOUT'&&error.attempts===2&&error.recoveryBudgetMs===MODEL_RECOVERY_BUDGET_MS);
  await advance(0);await advance(240000);await advance(5000);
  const starts=events.filter(e=>e.type==='model.request.started');
  assert.equal(starts[0].data.attemptTimeoutMs,300000);assert.equal(starts[1].data.attemptTimeoutMs,295000);
  await advance(294999);assert.equal(events.some(e=>e.type==='model.request.recovery_exhausted'),false);
  await advance(1);await rejected;assert.equal(calls,2);
  rejectLate(Error('late adapter rejection'));await advance(0);
  assert.equal(events.filter(e=>e.type==='model.request.recovery_exhausted').length,1);
});

test('default backoff beyond the remaining budget is not attributed to a server Retry-After',async t=>{
  const advance=virtualClock(t),events=[];let calls=0;
  const result=withModelRequestPolicy(async()=>{
    if(++calls===1)throw Object.assign(Error('upstream unavailable'),{status:502});
    return new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(Error('still unavailable'),{status:503})),290000));
  },{policy:DEFAULT_REQUEST_POLICY,onEvent:e=>events.push(e)});
  const rejected=assert.rejects(result,error=>error.code==='MODEL_RECOVERY_TIMEOUT'&&error.recoveryStopReason==='backoff-exceeds-budget'&&error.attempts===2&&error.lastStatus===503);
  await advance(0);await advance(5000);await advance(290000);await rejected;
  assert.equal(calls,2);assert.equal(events.filter(e=>e.type==='model.request.retry').length,1);
  assert.equal(events.find(e=>e.type==='model.request.recovery_exhausted').data.reason,'backoff-exceeds-budget');
});

test('a nearly budget-sized Retry-After leaves only the remaining time for a stalled response body',async t=>{
  const advance=virtualClock(t),events=[];let calls=0;
  const result=withModelRequestPolicy(async signal=>{
    if(++calls===1)throw Object.assign(Error('wait'),{status:429,headers:new Headers({'retry-after':'299'})});
    return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});}})).json();
  },{policy:DEFAULT_REQUEST_POLICY,onEvent:e=>events.push(e)});
  const rejected=assert.rejects(result,error=>error.code==='MODEL_RECOVERY_TIMEOUT'&&error.attempts===2);
  await advance(0);await advance(299000);
  assert.equal(events.filter(e=>e.type==='model.request.started')[1].data.attemptTimeoutMs,1000);
  await advance(1000);await rejected;assert.equal(calls,2);
});

test('authentication, request errors and explicit quota exhaustion never retry on any API transport',async t=>{
  for(const type of ['openai-compatible','openai-responses','anthropic','ollama']){
    for(const [status,code,message] of [[401,'invalid_api_key','bad credential'],[403,'permission_denied','not permitted'],[400,'invalid_request_error','invalid parameter'],[429,'insufficient_quota','No remaining credits'],[429,'billing_hard_limit_reached','Billing limit'],[429,'credit_balance_too_low','Low credits'],[429,'rate_limit_error','Your token-plan quota has been exhausted.']]){
      let calls=0;const events=[];
      const manager=await fixture(t,async()=>{calls++;return json({error:{message,type:code,code}},status);});
      const provider=manager.create({...config,type});
      await assert.rejects(manager.complete(provider.id,{...request,onEvent:e=>events.push(e)}));
      assert.equal(calls,1,type+' '+code);assert.equal(events.some(e=>e.type==='model.request.retry'),false);
    }
  }
});

test('a successful response clears its timer and recovery time is fresh for the next logical request',async t=>{
  const advance=virtualClock(t),successfulSignals=[];let calls=0;
  const operation=async signal=>{if(++calls%2)throw Object.assign(Error('temporary failure'),{status:502,headers:new Headers({'retry-after':'0'})});successfulSignals.push(signal);return 'recovered';};
  const first=withModelRequestPolicy(operation,{policy:DEFAULT_REQUEST_POLICY});await advance(0);assert.equal(await first,'recovered');
  await advance(600000);
  assert.equal(successfulSignals[0].aborted,false);
  const second=withModelRequestPolicy(operation,{policy:DEFAULT_REQUEST_POLICY});await advance(0);assert.equal(await second,'recovered');assert.equal(calls,4);
});

test('cancellation during an in-flight retry settles even if the adapter ignores its signal',async t=>{
  const advance=virtualClock(t),controller=new AbortController();let calls=0;
  const result=withModelRequestPolicy(async()=>{if(++calls===1)throw Object.assign(Error('retry'),{status:504});return new Promise(()=>{});},{policy:DEFAULT_REQUEST_POLICY,signal:controller.signal});
  const rejected=assert.rejects(result,/Cancelled|abort/i);
  await advance(0);await advance(5000);assert.equal(calls,2);
  controller.abort();await advance(0);await rejected;
  await advance(600000);assert.equal(calls,2);
});
