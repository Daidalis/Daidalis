import test from 'node:test';
import assert from 'node:assert/strict';
import {gradeQuaternionContract,applyQuaternionStrategy} from '../server/evaluator.mjs';
const correct={kind:'quaternion-interface-v1',order:'xyzw',sensorDirection:'sensor-to-inertial',mountDirection:'sensor-to-body',operation:'sensor*conjugate(mount)',normalize:true,invalidPolicy:'reject'};
test('contract oracle accepts known correct composition across rotations and signs',()=>{const result=gradeQuaternionContract(correct);assert.equal(result.status,'passed');assert.equal(result.upstreamReproduction,false);assert.equal(result.scope,'interface-contract-only');assert.ok(result.samples>60);});
test('identity-only or reversed-order shortcuts fail nontrivial mounting cases',()=>{for(const operation of ['sensor','sensor*mount','mount*sensor','conjugate(mount)*sensor']){const result=gradeQuaternionContract({...correct,operation});assert.equal(result.status,'failed',operation);assert.equal(result.checks.find(c=>c.id==='rotation-oracle').passed,false);}});
test('cannot change frozen input convention to make a result look correct',()=>{const result=gradeQuaternionContract({...correct,order:'wxyz'});assert.equal(result.status,'failed');assert.equal(result.checks.find(c=>c.id==='frozen-convention').passed,false);});
test('quaternion sign change preserves resulting orientation',()=>{const s=[.1,.2,.3,.9],m=[.3,.2,.1,.8];const a=applyQuaternionStrategy(correct,s,m),b=applyQuaternionStrategy(correct,s.map(x=>-x),m);for(let i=0;i<4;i++)assert.ok(Math.abs(a[i]+b[i])<1e-12);});
test('malformed and nonfinite measurements rejected',()=>{for(const q of [[0,0,0,0],[0,0,NaN,1],[0,1]])assert.throws(()=>applyQuaternionStrategy(correct,q,[0,0,0,1]));});
test('untrusted operation is an allowlist, never evaluated as code',()=>{assert.throws(()=>applyQuaternionStrategy({...correct,operation:'process.exit()'},[0,0,0,1],[0,0,0,1]));});

test('normalization is an explicit contract, not inferred from unit test inputs',()=>{const result=gradeQuaternionContract({...correct,normalize:false});assert.equal(result.status,'failed');assert.equal(result.checks.find(c=>c.id==='unit-output').passed,false);});
