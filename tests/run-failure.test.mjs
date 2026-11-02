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
