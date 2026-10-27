import test from 'node:test';
import assert from 'node:assert/strict';
import {toolResultPresentation} from '../public/result-intents.mjs';
import {renderToolHub} from '../public/tool-hub.mjs';
test('known job/model operations create bounded navigation hints, arbitrary JSON fields do not',()=>{
 const jobId='nos3_'+'a'.repeat(32);
 assert.equal(toolResultPresentation({tool:'wait_nos3_job',result:{jobId,status:'completed'}}).actions[0].id,jobId);
 assert.equal(toolResultPresentation({tool:'mcp__manta__get_nos3_job',args:{jobId},result:{ready:false}}).actions[0].id,jobId);
 assert.equal(toolResultPresentation({tool:'call_external_tool',result:{jobId}}).actions.length,0);
 assert.equal(toolResultPresentation({tool:'get_nos3_job',result:{jobId:'bad" onclick="'}}).actions.length,0);
 assert.equal(toolResultPresentation({tool:'query_system_model',args:{path:'models/a.sysml'},result:{valid:true}}).actions[0].path,'models/a.sysml');
});
test('MCP structuredContent is preserved for data display without interpreting instructions or executing UI',()=>{
 const content={rows:[{x:0,y:2},{x:1,y:5}],description:'<script>bad()</script>'};
 const r=toolResultPresentation({tool:'call_external_tool',result:{result:{structuredContent:content}}});
 assert.equal(r.data,content);assert.deepEqual(r.actions,[]);
});
test('tool hub keeps missing adapters separate, escapes external labels and restricts available actions',()=>{
 const registry={entries:[{id:'sysml',name:'SysML',stages:['architecture'],integrated:true,status:'ready',action:'open-model',views:['模型图']},{id:'mcp',name:'<img src=x>',stages:['integration'],integrated:true,status:'configured',action:'run-anything'},{id:'capella',name:'Capella',stages:['architecture'],integrated:false,status:'not-integrated'}]};
 const h=renderToolHub({registry});assert.match(h,/待接入 · 1/);assert.match(h,/&lt;img/);assert.doesNotMatch(h,/<img|data-action="run-anything"/);
 assert.doesNotMatch(renderToolHub({registry,stage:'simulation'}),/data-capability="sysml"/);
 assert.match(renderToolHub({error:'offline'}),/role="alert"/);
});

test('known external SysML operations link their returned model without trusting a claimed validation result',()=>{
 const r=toolResultPresentation({tool:'call_external_tool',args:{toolName:'sysml_validate'},result:{result:{structuredContent:{model:{path:'models/live.sysml'},valid:true}}}});
 assert.equal(r.actions[0].path,'models/live.sysml');assert.equal(r.actions[0].label,'查看模型');
});

test('malformed artifact outputs do not break chat; truncated historical results use exact recorded run attachments',()=>{
 assert.doesNotThrow(()=>toolResultPresentation({tool:'run_engineering_model',result:{artifacts:'truncated'}}));
 const a={tool:'run_engineering_model',runId:'run_a',result:{truncated:true,text:'not parsed'}};
 const r=toolResultPresentation(a,{artifacts:[{runId:'run_b',path:'engineering/other/series.csv'},{runId:'run_a',path:'engineering/real/series.csv'}]});
 assert.deepEqual(r.actions.map(v=>v.path),['engineering/real/series.csv']);
});


test('engineering record tools link the project surface without claiming engineering acceptance',()=>{
 const r=toolResultPresentation({tool:'record_engineering_evidence',result:{id:'evidence_1',result:'passed',provenance:'declared'}});
 assert.deepEqual(r.actions,[{action:'open-engineering-records',label:'查看工程记录'}]);assert.equal(r.data,null);
 assert.deepEqual(toolResultPresentation({tool:'record_engineering_evidence',result:{error:'Rejected'}}).actions,[]);
 const h=renderToolHub({registry:{entries:[{id:'engineering-records',name:'工程记录',integrated:true,status:'ready',action:'open-engineering-records'}]}});
 assert.match(h,/data-action="open-engineering-records"/);
});

test('native GIS and 42 results expose only recorded project file links, not guessed outputs',()=>{
 const geo='geospatial_'+'a'.repeat(32),orbit='orbit42_'+'b'.repeat(32);
 const geoRoot=`engineering/geospatial/${geo}/`,orbitRoot=`engineering/orbit/${orbit}/`;
 assert.deepEqual(toolResultPresentation({tool:'submit_geospatial_job',result:{jobId:geo,status:'queued'}}).actions,[]);
 const geoResult={jobId:geo,status:'completed',integrity:{verified:true},resultPath:geoRoot+'result.json',artifacts:[{path:geoRoot+'outputs/preview.geojson',sha256:'f'.repeat(64)},{path:geoRoot+'result.json'}]};
 assert.deepEqual(toolResultPresentation({tool:'wait_geospatial_job',result:geoResult}).actions.map(a=>[a.label,a.path]),[['查看地图预览',geoRoot+'outputs/preview.geojson'],['查看作业结果',geoRoot+'result.json']]);
 const orbitResult={jobId:orbit,status:'completed',integrity:{verified:true},resultPath:orbitRoot+'result.json',artifacts:[{path:orbitRoot+'trajectory.csv'},{path:orbitRoot+'result.json'}],frame:'42 N (Earth-centered)'};
 assert.deepEqual(toolResultPresentation({tool:'wait_orbit42_job',result:orbitResult}).actions.map(a=>[a.label,a.path]),[['查看轨迹曲线',orbitRoot+'trajectory.csv'],['查看作业结果',orbitRoot+'result.json']]);
 assert.deepEqual(toolResultPresentation({tool:'get_geospatial_job',result:{...geoResult,jobId:'geospatial_bad'}}).actions,[]);
 assert.deepEqual(toolResultPresentation({tool:'get_geospatial_job',result:{...geoResult,artifacts:[{path:'engineering/orbit/'+orbit+'/trajectory.csv'}],resultPath:'../../secret'}}).actions,[]);
});

test('native job links require positive integrity on direct get and nested wait payloads',()=>{
 const geo='geospatial_'+'c'.repeat(32),orbit='orbit42_'+'d'.repeat(32);
 const geoRoot=`engineering/geospatial/${geo}/`,orbitRoot=`engineering/orbit/${orbit}/`;
 const geoResult={jobId:geo,status:'completed',ready:true,integrity:{verified:false,reason:'GeoJSON hash mismatch'},resultPath:geoRoot+'result.json',artifacts:[{path:geoRoot+'outputs/preview.geojson'},{path:geoRoot+'result.json'}]};
 assert.deepEqual(toolResultPresentation({tool:'get_geospatial_job',result:geoResult}).actions,[]);
 const orbitResult={jobId:orbit,status:'completed',ready:true,integrity:{verified:false,reason:'Trajectory hash mismatch'},resultPath:orbitRoot+'result.json',artifacts:[{path:orbitRoot+'trajectory.csv'},{path:orbitRoot+'result.json'}]};
 assert.deepEqual(toolResultPresentation({tool:'wait_orbit42_job',result:{result:orbitResult}}).actions,[]);
 assert.deepEqual(toolResultPresentation({tool:'wait_orbit42_job',result:{integrity:{verified:false},result:{...orbitResult,integrity:{verified:true}}}}).actions,[]);
 const nestedVerified=toolResultPresentation({tool:'wait_orbit42_job',result:{result:{...orbitResult,integrity:{verified:true}}}});
 assert.deepEqual(nestedVerified.actions.map(a=>a.label),['查看轨迹曲线','查看作业结果']);
 assert.deepEqual(toolResultPresentation({tool:'get_geospatial_job',result:{...geoResult,integrity:undefined}}).actions,[]);
 assert.deepEqual(toolResultPresentation({tool:'get_geospatial_job',result:{...geoResult,integrity:{verified:true},artifacts:[]}}).actions,[]);
});

test('orbit-ground chat actions expose only verified bounded map, samples and report',()=>{
 const id='orbitground_'+'e'.repeat(32),root=`engineering/orbit-ground/${id}/`;
 const artifacts=['ground-track.geojson','ground-samples.csv','report.md','result.json'].map(name=>({path:root+name}));
 const response={jobId:id,status:'completed',executionSucceeded:true,integrity:{verified:true},artifacts};
 assert.deepEqual(toolResultPresentation({tool:'wait_orbit_ground_job',result:{result:response}}).actions.map(action=>action.path),artifacts.map(item=>item.path));
 assert.deepEqual(toolResultPresentation({tool:'get_orbit_ground_job',result:{...response,integrity:{verified:false}}}).actions,[]);
 assert.deepEqual(toolResultPresentation({tool:'get_orbit_ground_job',result:{...response,jobId:'orbitground_wrong'}}).actions,[]);
 assert.deepEqual(toolResultPresentation({tool:'get_orbit_ground_job',result:{...response,status:'failed',executionSucceeded:false}}).actions,[]);
});
