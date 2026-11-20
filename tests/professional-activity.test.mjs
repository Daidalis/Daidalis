import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describeProfessionalActivity,followFile,modelingEventTarget,modelingSnapshots} from '../public/professional-activity.mjs';
import {visibleRunWork} from '../shared/run-presentation.mjs';
test('native Modelica card names the actual model/backend and separates execution from failed criteria',()=>{
 const activity={tool:'mcp__daidalis__wait_professional_job',status:'completed',result:{jobId:'professional_'+'a'.repeat(32),status:'completed',executionSucceeded:true,operation:'simulate',model:{path:'engineering/models/STFDataDelivery.mo'},tool:{id:'openmodelica',name:'OpenModelica',version:'1.27.1'},passed:false,verification:{status:'failed',checks:[{passed:true},{passed:true},{passed:false}]}}},before=JSON.stringify(activity),view=describeProfessionalActivity(activity);
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

test('sidebar slots keep the latest source, shape, and simulation independently',()=>{
 const activities=[
  {tool:'read_file',status:'completed',args:{path:'sedan/ElectricSedan.sysml'}},
  {tool:'Write',status:'completed',args:{path:'sedan/ElectricSedan.sysml'}},
  {tool:'save_professional_model',status:'completed',result:{path:'sedan/ElectricSedan.mo'}},
  {tool:'Write',status:'completed',args:{path:'sedan/Body.scad'}},
  {tool:'wait_professional_job',status:'running',args:{operation:'simulate',path:'sedan/ElectricSedan.mo'},result:{status:'running',jobId:'sim-1',operation:'simulate',model:{path:'sedan/ElectricSedan.mo'}}},
 ];
 const slots=modelingSnapshots(activities);
 assert.equal(slots.source.path,'sedan/ElectricSedan.mo');
 assert.equal(slots.shape.path,'sedan/Body.scad');
 assert.equal(slots.shape.stage,'pending');
 assert.equal(slots.simulation.stage,'running');
 assert.equal(slots.simulation.jobId,'sim-1');
});

test('a save event and a finished job each refresh one slot',()=>{
 const saved=modelingEventTarget({type:'professional.model.saved',data:{path:'sedan/ElectricSedan.sysml',sha256:'abc'}});
 const shape=modelingEventTarget({type:'professional.completed',data:{jobId:'job-shape',modelPath:'sedan/Body.scad',status:'completed'}});
 const log=modelingEventTarget({type:'professional.log',data:{jobId:'job-shape'}});
 assert.deepEqual(saved,{slot:'source',path:'sedan/ElectricSedan.sysml',stage:'written',sha256:'abc',role:'system'});
 assert.equal(shape.slot,'shape');
 assert.equal(shape.jobId,'job-shape');
 assert.equal(log,null);
});

test('a native write opens the source slot, and check stays off the simulation slot',()=>{
 const written=modelingEventTarget({type:'tool.completed',data:{tool:'Write',path:'sedan/ElectricSedan.sysml'}});
 assert.equal(written.slot,'source');assert.equal(written.role,'system');assert.equal(written.path,'sedan/ElectricSedan.sysml');
 assert.equal(modelingEventTarget({type:'tool.completed',data:{tool:'Write',path:'sedan/ElectricSedan.sysml',result:{error:'denied'}}}),null);
 const queued=modelingEventTarget({type:'professional.queued',data:{jobId:'check-1',operation:'check',modelPath:'sedan/ElectricSedan.sysml'}});
 assert.equal(queued,null);
 const checked=modelingEventTarget({type:'professional.completed',data:{jobId:'check-1',operation:'check',modelPath:'sedan/ElectricSedan.sysml',status:'completed'}});
 assert.equal(checked.slot,'source');assert.equal(checked.stage,'checked');assert.notEqual(checked.slot,'simulation');
 const simulated=modelingEventTarget({type:'professional.running',data:{jobId:'sim-2',operation:'simulate',modelPath:'sedan/ElectricSedan.sysml'}});
 assert.equal(simulated.slot,'simulation');assert.equal(simulated.stage,'running');
 const log=modelingEventTarget({type:'professional.log',data:{jobId:'sim-2',path:'sedan/ElectricSedan.sysml'}});
 assert.equal(log,null);
});

test('appearance and Modelica saves leave an open system SysML in place',()=>{
 const open={path:'sedan/ElectricSedan.sysml'};
 const appearance=modelingEventTarget({type:'professional.model.saved',data:{path:'sedan/Sedan.appearance.sysml',sha256:'app'}});
 assert.equal(appearance.role,'appearance');
 assert.equal(followFile(open,appearance).keep,true,'an appearance save never replaces the open system model');
 const followed=followFile({},appearance);
 assert.equal(followed.expand,'source');assert.equal(followed.sourceView,'code');assert.equal(followed.replaceSource,true);
 const modelica=modelingEventTarget({type:'tool.completed',data:{tool:'Write',path:'sedan/Sedan.mo'}});
 assert.equal(followFile(open,modelica).keep,true);
});

test('the system prompt builds geometry only in OpenSCAD and still runs each solver once',()=>{
 const source=readFileSync(new URL('../server/engine.mjs',import.meta.url),'utf8');
 assert.match(source,/floor and powertrain, then the front-left corner, the front-right corner, the rear wheels and suspension, then the body panels/);
 assert.match(source,/Save that structure file first with save_professional_model, then submit one check/);
 assert.match(source,/Put detailed geometry only in the sibling OpenSCAD \.scad; never create a \*\.appearance\.sysml and never put body solids in any SysML file/);
 assert.doesNotMatch(source,/\.appearance\.sysml\. Save the appearance/,'no SysML appearance modeling guidance remains');
 assert.match(source,/Use only a few solids on the structure diagram/);
 assert.match(source,/After each \.scad save, submit one OpenSCAD simulate job so the workbench stage reveals the mesh growing step by step/,'every drafting save is rendered live');
 assert.match(source,/Do not repeat the FMU export or the SysML simulate because the files were saved in steps; the OpenSCAD renders each follow their own save/);
 assert.match(source,/run one visual quality review before reporting completion/);
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
