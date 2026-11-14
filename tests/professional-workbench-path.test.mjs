import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfessionalWorkbench,inferModelName,renderProfessionalWorkbench} from '../public/professional-workbench.mjs';
import {resolveBoundAnalysisUsage} from '../server/professional-models.mjs';

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
 assert.match(html,/data-pm-card="source"/);assert.match(html,/data-pm-card="shape"/);assert.match(html,/data-pm-card="simulation"/);
 assert.doesNotMatch(html,/workbench-focus/);
});

test('an unfinished simulation card does not draw a curve, and SysML solids stay on the source card',()=>{
 const running=renderProfessionalWorkbench({path:'models/A.mo',draft:'model A end A;',currentJob:{id:'job-1',status:'running',operation:'simulate',model:{path:'models/A.mo'}},result:{integrity:{verified:true},table:{columns:['time','speed'],rows:[[0,0],[1,2]]}}});
 assert.match(running,/仿真进行中/);assert.doesNotMatch(running,/pm-trajectory-thumb|pm-spark/);assert.doesNotMatch(running,/workbench-focus/);
 const html=renderProfessionalWorkbench({path:'sedan/ElectricSedan.sysml',draft:'package E {}',physicalParts:[{label:'battery',shape:'box'}],semanticGraph:{nodes:[{id:'vehicle',kind:'part',label:'vehicle'}],edges:[]}});
 const source=html.split('data-pm-card="source"')[1].split('data-pm-card="shape"')[0];
 const shape=html.split('data-pm-card="shape"')[1].split('data-pm-card="simulation"')[0];
 assert.doesNotMatch(source,/pm-structure-thumb|data-pm-structure|document-tabs/);assert.doesNotMatch(source,/battery|data-pm-physical/);assert.doesNotMatch(shape,/battery|pm-structure-thumb/);assert.match(shape,/几何尚未生成/);
 const opened=renderProfessionalWorkbench({expanded:'source',path:'sedan/ElectricSedan.sysml',draft:'package E {}',physicalParts:[{label:'battery',shape:'box'}],semanticGraph:{nodes:[{id:'vehicle',kind:'part',label:'vehicle'}],edges:[]}});
 const openedSource=opened.split('data-pm-card="source"')[1].split('data-pm-card="shape"')[0];
 assert.match(openedSource,/data-source-view="code"/);assert.match(openedSource,/data-source-view="diagram"/);assert.match(openedSource,/模型图/);assert.match(openedSource,/实物预览/);assert.match(openedSource,/大纲/);assert.match(openedSource,/诊断/);assert.match(openedSource,/约束/);assert.doesNotMatch(openedSource,/data-source-view="preview"/);assert.match(openedSource,/原生模型源码/);assert.doesNotMatch(openedSource,/battery|data-pm-physical|data-pm-structure/);
 const previewTab=renderProfessionalWorkbench({expanded:'source',sourceView:'diagram',path:'sedan/ElectricSedan.sysml',draft:'package E {}',physicalParts:[{label:'battery',shape:'box'}],semanticGraph:{nodes:[{id:'vehicle',kind:'part',label:'vehicle'}],edges:[]}});
 const previewSource=previewTab.split('data-pm-card="source"')[1].split('data-pm-card="shape"')[0];
 assert.match(previewSource,/data-pm-structure/);assert.match(previewSource,/data-source-view="preview3d"/);assert.doesNotMatch(previewSource,/textarea|class="document-tabs"/);
 const closedSim=renderProfessionalWorkbench({path:'models/A.mo',draft:'model A end A;',modelName:'A'});
 assert.doesNotMatch(closedSim.split('data-pm-card="simulation"')[1],/仿真设置|运行仿真/);
 const preview=renderProfessionalWorkbench({shapePreviewUrl:'blob:http://local/preview',shapeStage:'ready'});
 const previewShape=preview.split('data-pm-card="shape"')[1].split('data-pm-card="simulation"')[0];
 assert.match(previewShape,/data-expanded="false"/);assert.match(previewShape,/class="pm-shape-thumb"/);assert.doesNotMatch(preview,/alt="OpenSCAD 预览"/);
 const openedShape=renderProfessionalWorkbench({expanded:'shape',shapePath:'sedan/Body.scad',shapePreviewUrl:'data:image/png;base64,iV',shapeStage:'ready'});
 const openedShapeBody=openedShape.split('data-pm-card="shape"')[1].split('data-pm-card="simulation"')[0];
 assert.match(openedShapeBody,/data-pm-shape-geometry[\s\S]*pm-shape-thumb/);
});

test('live events refresh the matching card and do not enter workbench focus',async()=>{
 class Source{constructor(url){this.url=url;this.listeners={};Source.current=this;}addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}close(){this.closed=true;}}
 globalThis.EventSource=Source;
 const calls=[];let focused=0;
 const api=async route=>{calls.push(route);if(route.endsWith('/professional'))return {environment:{}};if(route.endsWith('/models'))return {models:[]};if(/\/jobs$/.test(route))return {jobs:[]};if(route.includes('/model?path='))return {path:decodeURIComponent(route.split('path=')[1]),content:'package A {}',sha256:'abc'};if(route.includes('/workspace/files'))return {entries:[]};if(route.includes('/workspace/model'))return {};if(route.includes('/jobs/job-shape/result'))return {ready:true,status:'completed',executionSucceeded:true,integrity:{verified:false},artifacts:[]};if(route.includes('/jobs/job-shape'))return {id:'job-shape',status:'completed',operation:'simulate',model:{path:'sedan/Body.scad'}};return {};};
 const host={isConnected:true,innerHTML:'',addEventListener(){},removeEventListener(){},querySelector(){return null;},contains(){return false;}};
 const ui=createProfessionalWorkbench({api,getProject:()=>({id:'p1',folderPath:'/work'}),onFocus:()=>{focused++;},onError(){}});
 ui.mount(host);
 await ui.refresh();
 const before=calls.filter(route=>route.includes('/professional/model?path=')).length;
 const saved={data:JSON.stringify({type:'professional.model.saved',data:{path:'sedan/A.sysml',sha256:'abc'}})};
 Source.current.listeners.update[0](saved);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.filter(route=>route.includes('/professional/model?path=')).length,before+1);
 Source.current.listeners.update[0](saved);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.filter(route=>route.includes('/professional/model?path=')).length,before+1);
 const done={data:JSON.stringify({type:'professional.completed',data:{jobId:'job-shape',modelPath:'sedan/Body.scad',status:'completed'}})};
 const jobsBefore=calls.filter(route=>route.includes('/jobs/job-shape')).length;
 Source.current.listeners.update[0](done);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.filter(route=>route.includes('/jobs/job-shape')).length,jobsBefore+2);
 assert.match(host.innerHTML,/data-pm-card="shape" data-expanded="true"/);assert.match(host.innerHTML,/data-pm-card="source" data-expanded="false"/);assert.match(host.innerHTML,/data-pm-card="simulation" data-expanded="false"/);
 assert.equal(focused,0);assert.doesNotMatch(host.innerHTML,/workbench-focus/);
 ui.detach();
 delete globalThis.EventSource;
});

test('native model links cannot fetch another project or a traversal path',async()=>{
 const calls=[];const ui=createProfessionalWorkbench({getProject:()=>({id:'p1',folderPath:'/work/STF'}),api:async route=>{calls.push(route);return {};}});
 for(const path of ['/work/STF-other/model.mo','/private/secret.mo','../other/model.mo','https://example.com/model.mo'])await assert.rejects(ui.openPath(path));
 assert.equal(calls.length,0);
});
