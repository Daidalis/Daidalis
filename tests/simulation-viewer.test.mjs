import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSimulation,simulationChannels,simulationPlot,renderSimulationViewer,mountSimulationViewer} from '../public/simulation-viewer.mjs';
const points=[
 {time:0,wallTime:1792722113.258607,channel:'gnc',sample:0,quaternion:[.23,-.2,.3,.9],valid:true},
 {time:.11,wallTime:1792722113.368607,channel:'gnc',sample:1,quaternion:[0,0,0,0],valid:false},
 {time:.32,wallTime:1792722113.578607,channel:'gnc',sample:2,quaternion:[-.23,.2,-.3,-.9],valid:true},
 {time:.4,wallTime:1792722113.658607,channel:'startracker',sample:0,quaternion:[.1,.2,.3,.9],valid:true}
];
const data={id:'nos3-1',title:'星敏输入链',scope:'integration',status:'completed',integrity:{verified:true},source:{revision:'abc123'},model:{path:'models/input.sysml',hash:'feedbeef'},cases:[{id:'fixed',status:'verified',engineering_requirement_satisfied:true,integrity:{verified:true},points,checks:[{name:'UDP_GNC_matches_sensor_frame_model',passed:true,max_error_deg:.000002,tolerance_deg:.02}],files:[{path:'engineering/fixed/telemetry-samples.jsonl',sha256:'deadbeef'}]}],unverified:['Physical sensor / hardware-in-the-loop validation']};

test('plots only actual channel samples, preserves q signs and gaps invalid quaternion samples',()=>{
 const selected=normalizeSimulation(data).cases[0];assert.deepEqual(simulationChannels(selected),['gnc','startracker']);
 const plot=simulationPlot(selected,{channel:'gnc'});assert.equal(plot.points.length,3);assert.equal(plot.timed,true);assert.deepEqual(plot.points[0].values,[.23,-.2,.3,.9]);assert.deepEqual(plot.points[1].values,[null,null,null,null]);assert.deepEqual(plot.points[2].values,[-.23,.2,-.3,-.9]);assert.equal(plot.invalid,1);
 const validity=simulationPlot(selected,{channel:'gnc',signal:'validity'});assert.deepEqual(validity.points.map(p=>p.values),[[1],[0],[1]]);
 const html=renderSimulationViewer(data);assert.match(html,/相对遥测接收时间 \/ s/);assert.match(html,/不是仿真时钟/);assert.match(html,/不代表完整轨迹/);assert.doesNotMatch(html,/<polyline/);assert.equal((html.match(/data-point=/g)||[]).length,8);
});

test('zoom filters recorded samples without resampling or interpolating',()=>{
 const selected=normalizeSimulation(data).cases[0];const plot=simulationPlot(selected,{channel:'gnc',range:[.2,.9]});assert.equal(plot.points.length,1);assert.equal(plot.points[0].sample,1);assert.deepEqual(plot.points[0].values,[null,null,null,null]);
 const html=renderSimulationViewer(data,{connect:true});assert.doesNotMatch(html,/<polyline/,'invalid sample must break line segments, so neither pair crosses the gap');
});

test('missing timestamps use sample axis, missing telemetry never fabricates a curve from maxima',()=>{
 const missing={...data,cases:[{id:'fixed',points:[],checks:[{passed:true,name:'max_rotation_error_deg',max_error_deg:.001}]}]};const html=renderSimulationViewer(missing);assert.match(html,/没有可展示的逐样本遥测/);assert.doesNotMatch(html,/<svg|<circle/);
 const plot=simulationPlot({points:[{channel:'ad',sample:7,quaternion:[1,0,0,0],valid:true}]},{channel:'ad'});assert.equal(plot.timed,false);assert.equal(plot.points[0].x,7);assert.match(plot.xLabel,/采样/);
});

test('defect reproduced does not imply engineering requirement satisfied; shows scoped values and limitations',()=>{
 const baseline={...data,cases:[{...data.cases[0],id:'baseline',status:'defect_reproduced',engineering_requirement_satisfied:false,checks:[{name:'sensor_to_body_rotation_applied_once_in_correct_order',passed:false,max_rotation_error_deg:102.1,tolerance_deg:.02}]}]};const html=renderSimulationViewer(baseline);
 assert.match(html,/缺陷已复现 · 工程需求未满足/);assert.match(html,/最大旋转差 102.1 °/);assert.match(html,/允许旋转差 0.02 °/);assert.match(html,/传感器总精度含义不同/);assert.match(html,/实物传感器与硬件在环（HIL）验证/);assert.match(html,/models\/input.sysml/);assert.match(html,/abc123/);assert.match(html,/feedbeef/);
});

test('tampered evidence has no plotted points and no verified badge; untrusted fields cannot inject markup',()=>{
 const attack='x"><img src=x onerror="alert(1)">';const html=renderSimulationViewer({...data,title:attack,integrity:{verified:false},model:{path:attack,hash:attack},cases:[{...data.cases[0],id:attack,label:attack,integrity:{verified:false},files:[{path:attack,sha256:attack}],checks:[{name:attack,reason:attack,passed:false}]}]});
 assert.doesNotMatch(html,/<img|onerror="alert|<circle/);assert.match(html,/&lt;img/);assert.match(html,/证据完整性校验未通过/);assert.doesNotMatch(html,/证据完整性校验通过/);
 assert.doesNotThrow(()=>renderSimulationViewer({...data,cases:[{...data.cases[0],points:[{...points[0],wallTime:1e300}]}]}));
});

test('mount keeps all file navigation inside host callbacks and cleans handlers on destroy',async()=>{
 const handlers=new Map(),opened=[];const container={innerHTML:'',addEventListener(type,fn){handlers.set(type,fn)},removeEventListener(type){handlers.delete(type)},contains(){return true},querySelector(){return null},replaceChildren(){this.innerHTML=''}};
 const instance=mountSimulationViewer(container,{simulation:data,onOpenPath:path=>opened.push(path)});assert.equal(handlers.size,3);assert.match(container.innerHTML,/星敏输入链/);
 const target={dataset:{sv:'evidence',fileIndex:'0'},closest(){return this}};await handlers.get('click')({target});assert.deepEqual(opened,['engineering/fixed/telemetry-samples.jsonl']);
 instance.update({...data,title:'新作业'});assert.match(container.innerHTML,/新作业/);instance.destroy();assert.equal(container.innerHTML,'');assert.equal(handlers.size,0);
});


test('individual quaternion signals preserve small measured components and result integrity gates every case',()=>{
 const selected=normalizeSimulation(data).cases[0],plot=simulationPlot(selected,{channel:'gnc',signal:'qy'});assert.deepEqual(plot.components,['qy']);assert.deepEqual(plot.points.map(p=>p.values),[[-.2],[null],[.2]]);
 const html=renderSimulationViewer({...data,integrity:{verified:false}});assert.doesNotMatch(html,/<circle/);assert.match(html,/证据完整性校验未通过/);
 const modelHtml=renderSimulationViewer({...data,model:{path:'engineering/job/models/0-input.sysml',hash:'originalhash',originalPath:'models/input.sysml'}});assert.match(modelHtml,/绑定快照/);assert.match(modelHtml,/查看当前模型/);
});
