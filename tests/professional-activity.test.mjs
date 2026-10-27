import test from 'node:test';
import assert from 'node:assert/strict';
import {describeProfessionalActivity} from '../public/professional-activity.mjs';
import {visibleRunWork} from '../shared/run-presentation.mjs';
test('native Modelica card names the actual model/backend and separates execution from failed criteria',()=>{
 const activity={tool:'mcp__manta__wait_professional_job',status:'completed',result:{jobId:'professional_'+'a'.repeat(32),status:'completed',executionSucceeded:true,operation:'simulate',model:{path:'engineering/models/STFDataDelivery.mo'},tool:{id:'openmodelica',name:'OpenModelica',version:'1.27.1'},passed:false,verification:{status:'failed',checks:[{passed:true},{passed:true},{passed:false}]}}},before=JSON.stringify(activity),view=describeProfessionalActivity(activity);
 assert.equal(view.title,'仿真 · STFDataDelivery.mo');assert.match(view.detail,/OpenModelica · 1.27.1/);assert.equal(view.executionLabel,'执行完成');assert.equal(view.verificationLabel,'判据 2/3 通过 · 1 项未通过');assert.equal(view.attention,true);assert.equal(JSON.stringify(activity),before);assert.doesNotMatch(JSON.stringify(view),/项目完成|工程批准|场景/);
});
test('an ended tool call is not mistaken for finished solver execution or missing validation success',()=>{
 const queued=describeProfessionalActivity({tool:'submit_professional_job',status:'completed',result:{status:'queued',model:{path:'models/stf.mo'},ready:false}});assert.equal(queued.executionLabel,'排队中');assert.equal(queued.verificationLabel,'');
 const unchecked=describeProfessionalActivity({tool:'get_professional_job',status:'completed',result:{status:'completed',executionSucceeded:true,verification:{status:'not-requested',checks:[]}}});assert.equal(unchecked.executionLabel,'执行完成');assert.equal(unchecked.verificationLabel,'未设置判据');assert.equal(unchecked.attention,false);
 const missing=describeProfessionalActivity({tool:'wait_professional_job',status:'completed',result:{status:'completed'}});assert.equal(missing.executionLabel,'作业结束');assert.equal(missing.verificationLabel,'尚无判据结果');
 const model=describeProfessionalActivity({tool:'save_professional_model',status:'completed',result:{path:'engineering/models/Power.mo'}});assert.equal(model.title,'保存模型 · Power.mo');assert.equal(model.executionLabel,'已保存');
});
test('completed result cards are bounded while active and engineering failures remain visible',()=>{
 const activities=[...Array.from({length:71},(_,i)=>({id:'job'+i,kind:'tool',tool:'wait_professional_job',status:'completed',result:{jobId:'j'+i,executionSucceeded:true,verification:{status:i===0?'failed':'passed'}}})),{id:'active',kind:'tool',tool:'wait_professional_job',status:'running'}];
 const shown=visibleRunWork({status:'running',activities},{hasResult:a=>Boolean(a.result?.jobId),resultKey:a=>a.result?.jobId});
 assert.equal(shown.activities.length,8);assert.equal(shown.hiddenActivityCount,64);assert.ok(shown.activities.some(a=>a.id==='active'));assert.ok(shown.activities.some(a=>a.id==='job0'));assert.ok(shown.activities.some(a=>a.id==='job70'));
});

test('failed submit without an execution receipt says submission failed, not waiting',()=>{
 const view=describeProfessionalActivity({tool:'submit_professional_job',status:'failed',args:{path:'models/STF.mo'},result:{error:'Missing pinned source'}});
 assert.equal(view.executionLabel,'提交失败');assert.doesNotMatch(view.executionLabel,/等待/);
});

test('native GIS and 42 activity cards separate job state from engineering acceptance',()=>{
 const geo=describeProfessionalActivity({tool:'wait_geospatial_job',status:'completed',result:{jobId:'geospatial_'+'a'.repeat(32),status:'completed',integrity:{verified:true},targetCrs:'EPSG:4326'}});
 assert.equal(geo.title,'地理分析');assert.equal(geo.executionLabel,'作业结束');assert.equal(geo.verificationLabel,'');assert.match(geo.detail,/EPSG:4326/);
 const orbit=describeProfessionalActivity({tool:'wait_orbit42_job',status:'completed',result:{jobId:'orbit42_'+'b'.repeat(32),status:'completed',integrity:{verified:true},frame:'42 N (Earth-centered)'}});
 assert.equal(orbit.title,'42 轨道仿真');assert.match(orbit.detail,/42 N/);assert.doesNotMatch(JSON.stringify(orbit),/需求通过|工程批准|ECI/);
 const failed=describeProfessionalActivity({tool:'submit_geospatial_job',status:'failed',result:{error:'GDAL unavailable'}});assert.equal(failed.executionLabel,'调用失败');assert.equal(failed.attention,true);
});

test('tampered native evidence is marked for attention in chat, including nested wait receipts',()=>{
 const geo=describeProfessionalActivity({tool:'get_geospatial_job',status:'completed',result:{jobId:'geospatial_'+'a'.repeat(32),status:'completed',integrity:{verified:false,reason:'Preview hash mismatch'}}});
 assert.equal(geo.executionLabel,'证据完整性失败');assert.equal(geo.attention,true);assert.match(geo.verificationLabel,/结果与预览不可用/);assert.match(geo.detail,/Preview hash mismatch/);
 const orbit=describeProfessionalActivity({tool:'wait_orbit42_job',status:'completed',result:{result:{jobId:'orbit42_'+'b'.repeat(32),status:'completed',integrity:{verified:false,reason:'CSV hash mismatch'}}}});
 assert.equal(orbit.executionLabel,'证据完整性失败');assert.equal(orbit.attention,true);assert.match(orbit.verificationLabel,/结果与预览不可用/);
 const missing=describeProfessionalActivity({tool:'get_orbit42_job',status:'completed',args:{result:true},result:{jobId:'orbit42_'+'b'.repeat(32),status:'completed'}});
 assert.equal(missing.executionLabel,'证据完整性未确认');assert.equal(missing.attention,true);
 const statusOnly=describeProfessionalActivity({tool:'get_orbit42_job',status:'completed',args:{result:false},result:{jobId:'orbit42_'+'b'.repeat(32),status:'completed'}});
 assert.equal(statusOnly.executionLabel,'作业结束');assert.equal(statusOnly.attention,false);
});
