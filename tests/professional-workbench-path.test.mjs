import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfessionalWorkbench,inferModelName,renderProfessionalWorkbench} from '../public/professional-workbench.mjs';

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
 const html=renderProfessionalWorkbench({path:'models/Decay.sysml',draft:source,modelName:'Decay::Check',fmuPath:'models/Decay.fmu'});
 assert.match(html,/name="modelName" value="Decay::Check"/);
 assert.match(html,/name="fmuPath"[^>]*value="models\/Decay\.fmu"/);
 assert.match(html,/value="simulate"[^>]*>运行 FMI 仿真/);
 assert.doesNotMatch(html,/name="numberOfIntervals"/);
});

test('native model links cannot fetch another project or a traversal path',async()=>{
 const calls=[];const ui=createProfessionalWorkbench({getProject:()=>({id:'p1',folderPath:'/work/STF'}),api:async route=>{calls.push(route);return {};}});
 for(const path of ['/work/STF-other/model.mo','/private/secret.mo','../other/model.mo','https://example.com/model.mo'])await assert.rejects(ui.openPath(path));
 assert.equal(calls.length,0);
});
