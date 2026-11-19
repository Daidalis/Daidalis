import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfessionalWorkbench,inferModelName,preferredModel,renderProfessionalWorkbench} from '../public/professional-workbench.mjs';
import {resolveBoundAnalysisUsage} from '../server/professional-models.mjs';

test('an example project opens the system SysML ahead of its appearance file',()=>{
 assert.equal(preferredModel({models:[{path:'sedan/Sedan.appearance.sysml'},{path:'sedan/Sedan.sysml'},{path:'sedan/Sedan.mo'}]}),'sedan/Sedan.sysml');
 assert.equal(preferredModel({models:[{path:'sedan/Sedan.mo'}]}),'sedan/Sedan.mo');
});

test('native model links from Agent replies resolve an absolute project path before the professional API',async()=>{
 const calls=[],project={id:'p1',folderPath:'/Volumes/NAS/STF 工程'};
 const ui=createProfessionalWorkbench({getProject:()=>project,api:async route=>{calls.push(route);return {path:'engineering/models/STF.mo',content:'model STF end STF;'};}});
 await ui.openPath('/Volumes/NAS/STF 工程/engineering/models/STF.mo');
 assert.deepEqual(calls,['/api/projects/p1/professional/model?path=engineering%2Fmodels%2FSTF.mo']);
 await ui.openPath('engineering/models/STF.mo');assert.equal(calls[1],calls[0]);
});

test('SysML FMI workbench exposes an analysis name, pinned FMU selection and simulation action',()=>{
 const source='package Decay { calc def Solve {} analysis def Check {} }';
 assert.equal(inferModelName(source),'Decay::Check');
 assert.equal(inferModelName('package P { calc def C {} }'),'P::C');
 assert.equal(inferModelName('package P model M end M; end P;'),'P.M');
 const sedan='package ElectricSedan { analysis def LaunchAnalysis { subject car; } analysis launch : LaunchAnalysis { subject car = vehicle; } }';
 assert.equal(inferModelName(sedan),'ElectricSedan::launch');
 assert.equal(resolveBoundAnalysisUsage(sedan,'ElectricSedan::LaunchAnalysis'),'ElectricSedan::launch');
 assert.equal(resolveBoundAnalysisUsage(sedan,'ElectricSedan::launch'),'ElectricSedan::launch');
 const html=renderProfessionalWorkbench({path:'models/Decay.sysml',draft:source,modelName:'Decay::Check',fmuPath:'models/Decay.fmu',expanded:'simulation'});
 assert.match(html,/name="modelName" value="Decay::Check"/);
 assert.match(html,/name="fmuPath"[^>]*value="models\/Decay\.fmu"/);
 assert.match(html,/value="simulate"[^>]*>运行 FMI 仿真/);
 assert.doesNotMatch(html,/name="numberOfIntervals"/);
 assert.match(html,/data-pm-action="tab" data-tab="source"/);assert.match(html,/data-pm-action="tab" data-tab="simulation"/);
 assert.doesNotMatch(html,/data-tab="shape"/,'a project without OpenSCAD context has no geometry tab');
 assert.doesNotMatch(html,/workbench-focus/);
});

test('the focus stage carries SysML solids and the tabs carry live status',()=>{
 // A running simulation shows progress in the chip; a .mo model has no stage.
 const running=renderProfessionalWorkbench({path:'models/A.mo',draft:'model A end A;',currentJob:{id:'job-1',status:'running',operation:'simulate',model:{path:'models/A.mo'}},result:{integrity:{verified:true},table:{columns:['time','speed'],rows:[[0,0],[1,2]]}}});
 assert.doesNotMatch(running,/pm-trajectory-thumb|pm-spark/);assert.doesNotMatch(running,/workbench-focus/);
 assert.match(running,/pm-chip-dot state-running/);assert.match(running,/>进行中</);
 assert.doesNotMatch(running,/pm-focus-stage/);
 const runningTab=renderProfessionalWorkbench({expanded:'simulation',path:'models/A.mo',draft:'model A end A;',currentJob:{id:'job-1',status:'running',operation:'simulate',model:{path:'models/A.mo'}},result:{integrity:{verified:true},table:{columns:['time','speed'],rows:[[0,0],[1,2]]}}});
 assert.match(runningTab,/仿真进行中/);assert.match(runningTab,/停止执行/);assert.doesNotMatch(runningTab,/pm-spark/);

 // A system SysML shows only source/diagram sub-tabs; the 实物预览 tab is gone and there is no stage without a mesh.
 const sysml=renderProfessionalWorkbench({expanded:'source',path:'sedan/ElectricSedan.sysml',draft:'package E {}',semanticGraph:{nodes:[{id:'vehicle',kind:'part',label:'vehicle'}],edges:[]}});
 assert.match(sysml,/data-source-view="code"/);assert.match(sysml,/data-source-view="diagram"/);assert.match(sysml,/模型图/);assert.doesNotMatch(sysml,/实物预览/);assert.match(sysml,/大纲/);assert.match(sysml,/诊断/);assert.match(sysml,/约束/);assert.match(sysml,/原生模型源码/);
 assert.doesNotMatch(sysml,/data-pm-stage-kind="physical"/);assert.doesNotMatch(sysml,/pm-focus-stage/,'no mesh means no stage');

 // The diagram sub-tab mounts the structure view in the detail region.
 const diagram=renderProfessionalWorkbench({expanded:'source',sourceView:'diagram',path:'sedan/ElectricSedan.sysml',draft:'package E {}'});
 assert.match(diagram,/data-pm-structure/);assert.doesNotMatch(diagram,/textarea/);

 // A non-simulation tab never renders the run form.
 const closedSim=renderProfessionalWorkbench({path:'models/A.mo',draft:'model A end A;',modelName:'A'});
 assert.doesNotMatch(closedSim,/仿真设置|运行仿真/);

 // The geometry tab is gone: the model tab hosts the OpenSCAD STL as its stage.
 const sysmlShape=renderProfessionalWorkbench({expanded:'source',path:'sedan/ElectricSedan.sysml',draft:'package E {}',shapeGeometryBytes:new Uint8Array(84),shapeGeometryName:'Body.stl'});
 assert.match(sysmlShape,/data-pm-stage-kind="shape"/);assert.match(sysmlShape,/data-pm-shape-geometry/);
 assert.doesNotMatch(sysmlShape,/data-tab="shape"/);assert.doesNotMatch(sysmlShape,/生成几何/);
 const scadContext=renderProfessionalWorkbench({expanded:'source',path:'sedan/Body.scad',shapePath:'sedan/Body.scad',jobs:[{id:'job-shape',status:'completed',operation:'simulate',model:{path:'sedan/Body.scad'}}]});
 assert.doesNotMatch(scadContext,/data-tab="shape"/,'even with OpenSCAD context there is no geometry tab');

 // The simulation tab keeps trajectory detail and shares the STL stage when a mesh exists.
 const staleSim=renderProfessionalWorkbench({expanded:'simulation',path:'sedan/ElectricSedan.sysml',draft:'package E {}',simulationStale:true,currentJob:{id:'job-sim',status:'completed',operation:'simulate',model:{path:'sedan/ElectricSedan.sysml',sha256:'old'}},result:{ready:true,integrity:{verified:true},executionSucceeded:true,table:{columns:['time','battery'],rows:[[0,80],[1,79]]}}});
 assert.match(staleSim,/上一版仿真/);assert.match(staleSim,/pm-spark|battery/);assert.doesNotMatch(staleSim,/data-pm-stage-kind="physical"/);
 const simWithMesh=renderProfessionalWorkbench({expanded:'simulation',path:'sedan/ElectricSedan.sysml',draft:'package E {}',shapeGeometryBytes:new Uint8Array(84),simulationStale:false,currentJob:{id:'job-sim',status:'completed',operation:'simulate',model:{path:'sedan/ElectricSedan.sysml'}},result:{ready:true,integrity:{verified:true},executionSucceeded:true,table:{columns:['time','battery'],rows:[[0,80],[1,79]]}}});
 assert.doesNotMatch(simWithMesh,/上一版仿真/);assert.match(simWithMesh,/>有轨迹</);assert.match(simWithMesh,/data-pm-stage-kind="shape"/,'the simulation tab shows the same OpenSCAD mesh stage');

 // A check result surfaces on the model tab.
 const checked=renderProfessionalWorkbench({expanded:'source',sourceView:'diagnostics',path:'sedan/ElectricSedan.sysml',draft:'package E {}',checkResult:{executionSucceeded:true,ready:true}});
 assert.match(checked,/校验通过/);
});

test('live events follow while the user has not taken the tab rail, then downgrade to a hint',async()=>{
 class Source{constructor(url){this.url=url;this.listeners={};Source.current=this;}addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}close(){this.closed=true;}}
 globalThis.EventSource=Source;
 const calls=[];let focused=0;
 const api=async route=>{calls.push(route);if(route.endsWith('/professional'))return {environment:{}};if(route.endsWith('/models'))return {models:[]};if(/\/jobs$/.test(route))return {jobs:[]};if(route.includes('/model?path='))return {path:decodeURIComponent(route.split('path=')[1]),content:'package A {}',sha256:'abc'};if(route.includes('/workspace/files'))return {entries:[]};if(route.includes('/workspace/model'))return {};if(route.includes('/jobs/job-shape/result'))return {ready:true,status:'completed',executionSucceeded:true,integrity:{verified:false},artifacts:[]};if(route.includes('/jobs/job-shape'))return {id:'job-shape',status:'completed',operation:'simulate',model:{path:'sedan/Body.scad'}};return {};};
 const host={isConnected:true,innerHTML:'',addEventListener(){},removeEventListener(){},querySelector(){return null;},contains(){return false;}};
 const ui=createProfessionalWorkbench({api,getProject:()=>({id:'p1',folderPath:'/work'}),onFocus:()=>{focused++;},onError(){}});
 ui.mount(host);
 await ui.refresh();
 assert.equal(ui.inspect().userFocus,false);assert.equal(ui.inspect().expanded,'source');
 const saved={data:JSON.stringify({type:'professional.model.saved',data:{path:'sedan/A.sysml',sha256:'abc'}})};
 Source.current.listeners.update[0](saved);
 await new Promise(resolve=>setImmediate(resolve));
 const before=calls.filter(route=>route.includes('/professional/model?path=')).length;
 Source.current.listeners.update[0](saved);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.filter(route=>route.includes('/professional/model?path=')).length,before);
 const done={data:JSON.stringify({type:'professional.completed',data:{jobId:'job-shape',modelPath:'sedan/Body.scad',status:'completed'}})};
 const jobsBefore=calls.filter(route=>route.includes('/jobs/job-shape')).length;
 Source.current.listeners.update[0](done);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.filter(route=>route.includes('/jobs/job-shape')).length,jobsBefore+2);
 assert.equal(ui.inspect().expanded,'source');
 assert.doesNotMatch(host.innerHTML,/data-tab="shape"/);
 assert.equal(focused,0);assert.doesNotMatch(host.innerHTML,/workbench-focus/);
 // The user takes the tab rail through the public entry point.
 await ui.selectJob('job-shape');
 assert.equal(ui.inspect().userFocus,true);assert.equal(ui.inspect().expanded,'source');
 // The next agent event still loads job data but no longer moves the view.
 const simDone={data:JSON.stringify({type:'professional.completed',data:{jobId:'job-sim',modelPath:'sedan/A.sysml',operation:'simulate',status:'completed'}})};
 const simCallsBefore=calls.filter(route=>route.includes('/jobs/job-sim')).length;
 Source.current.listeners.update[0](simDone);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.filter(route=>route.includes('/jobs/job-sim')).length,simCallsBefore+2);
 assert.equal(ui.inspect().expanded,'source');
 assert.equal(ui.inspect().followHint?.tab,'simulation');
 assert.match(host.innerHTML,/pm-follow-hint/);
 ui.detach();
 delete globalThis.EventSource;
});

test('native model links cannot fetch another project or a traversal path',async()=>{
 const calls=[];const ui=createProfessionalWorkbench({getProject:()=>({id:'p1',folderPath:'/work/STF'}),api:async route=>{calls.push(route);return {};}});
 for(const path of ['/work/STF-other/model.mo','/private/secret.mo','../other/model.mo','https://example.com/model.mo'])await assert.rejects(ui.openPath(path));
 assert.equal(calls.length,0);
});
