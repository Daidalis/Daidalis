import test from 'node:test';
import assert from 'node:assert/strict';
import {describeRunFailure,describeRuntimeFailure} from '../server/run-failure.mjs';
test('model timeout is distinguished from a solver or tool failure',()=>{
 const error=Error('Request timed out.');
 assert.match(describeRuntimeFailure(error,[{type:'sdk.model.started'}]),/等待模型服务回复超时/);
 assert.equal(describeRuntimeFailure(error,[]),error.message);
 assert.equal(describeRuntimeFailure(error,[{type:'sdk.model.started'},{type:'sdk.model.completed'}]),error.message);
 assert.equal(describeRuntimeFailure(Error('Solver failed'),[{type:'sdk.model.started'}]),'Solver failed');
});
test('turn-limit report retains concrete solver failure rather than hiding it behind budget exhaustion',()=>{
 const message=describeRunFailure(Error('Max turns (12) exceeded'),[{type:'tool.completed',data:{tool:'wait_professional_job',result:{executionSucceeded:false,diagnostics:'Check passed\n/bin/sh: Cannot fork\nmake failed'}}}]);
 assert.match(message,/Cannot fork/);assert.match(message,/wait_professional_job/);assert.match(message,/可在此线程继续/);
});

test('runtime rate limit explains recovery without claiming work was completed',()=>{
 assert.match(describeRuntimeFailure(Error('exceeded retry limit, last status: 429 Too Many Requests')),/限流或额度限制/);
});

test('recovery budget distinguishes an elapsed deadline from an excessive Retry-After',()=>{
 for(const [reason,expected] of [['deadline',/恢复时限/],['retry-after-exceeds-budget',/等待时间超过/],['backoff-exceeds-budget',/剩余恢复时间不足/]]){
  const error=Object.assign(Error('recovery stopped'),{code:'MODEL_RECOVERY_TIMEOUT',recoveryStopReason:reason,attempts:2});
  const message=describeRuntimeFailure(error);assert.match(message,expected);assert.match(message,/已尝试 2 次/);assert.match(message,/此线程继续/);
 }
});

test('server and connection failures explain the attempts and preserved work',()=>{
 for(const failure of [{status:502},{status:503},{code:'MODEL_CONNECTION_FAILED'},{name:'APIConnectionError'}]){
  const message=describeRuntimeFailure(Object.assign(Error('upstream unavailable'),{attempts:6,...failure}));
  assert.match(message,/模型服务暂时不可用/);assert.match(message,/已尝试 6 次/);assert.match(message,/此线程继续/);
 }
});
