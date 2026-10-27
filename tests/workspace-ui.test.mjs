import test from 'node:test';
import assert from 'node:assert/strict';
import {projectRelativePath} from '../public/workspace-ui.mjs';

test('workspace links accept project files and normalize report-relative navigation within the selected project',()=>{
 assert.equal(projectRelativePath('/workspace/NOS3/models/attitude.sysml','/workspace/NOS3'),'models/attitude.sysml');
 assert.equal(projectRelativePath('artifacts/reviews/../report.md#L20','/workspace/NOS3'),'artifacts/report.md');
 assert.equal(projectRelativePath('./models/a.sysml'),'models/a.sysml');
 for(const path of ['/workspace/NOS3-other/secrets.txt','../other-project/file','models/../../outside','https://example.com','file:///private/secret','models\\a.sysml','x\0y'])assert.throws(()=>projectRelativePath(path,'/workspace/NOS3'));
});

import {createWorkspaceUI} from '../public/workspace-ui.mjs';

test('recorded result files and registered artifacts resolve into their project simulation, with a raw escape',async()=>{
 const requests=[],project={id:'p1',folderPath:'/work/nos3'},jobId='nos3_owned';
 const ui=createWorkspaceUI({getProject:()=>project,getArtifacts:()=>[{id:'a1',projectId:'p1',path:'engineering/run/result.json'}],api:async(route)=>{requests.push(route);if(route.includes('/resolve?'))return {kind:'simulation',projectId:'p1',jobId,caseId:'fixed'};if(route.includes('/simulations/'))return {id:jobId,cases:[]};return {path:'engineering/run/result.json',content:'{"passed":false}',type:'json'};}});
 await ui.openArtifact('a1');assert.equal(requests.length,2);assert.match(requests[0],/resolve\?path=engineering%2Frun%2Fresult.json/);assert.match(requests[1],/\/p1\/workspace\/simulations\/nos3_owned$/);
 await ui.openPath('engineering/run/result.json',{raw:true});assert.equal(requests.length,3);assert.match(requests[2],/\/file\?path=/);
 await ui.openPath('engineering/run/result.json');assert.equal(requests.length,3,'resolved tab is reused');
 await assert.rejects(ui.openArtifact('foreign'),/不属于当前项目/);
});

test('ordinary JSON is read as data; explicit source navigation bypasses resolver; integrity failures never fall back',async()=>{
 const routes=[];const ui=createWorkspaceUI({getProject:()=>({id:'p1',folderPath:'/work/nos3'}),api:async(route)=>{routes.push(route);if(route.includes('bad.json')){const error=new Error('integrity mismatch');error.status=409;throw error;}if(route.includes('/resolve?'))return {kind:'file'};return {path:'result.json',content:'{"value":2}'};}});
 await ui.openPath('result.json');assert.equal(routes.length,2);assert.match(routes[1],/\/file\?/);
 await ui.openPath('report.md',{line:8});assert.equal(routes.length,3);assert.match(routes[2],/\/file\?path=report.md/);
 await ui.openPath('bad.json');assert.equal(routes.length,4,'a failed integrity check must not fetch a generic file instead');
});

test('late resolution cannot open a job after the active project changed',async()=>{
 let project={id:'p1',folderPath:'/work/one'},finish;const calls=[];
 const ui=createWorkspaceUI({getProject:()=>project,api:async(route)=>{calls.push(route);if(route.includes('/p1/'))return new Promise(resolve=>finish=resolve);if(route.includes('/resolve?'))return {kind:'file'};return {content:'safe',path:'new.txt'};}});
 const old=ui.openPath('result.json');project={id:'p2',folderPath:'/work/two'};await ui.openPath('new.txt');finish({kind:'simulation',projectId:'p1',jobId:'old'});await old;
 assert.equal(calls.filter(route=>route.includes('/simulations/')).length,0);assert.ok(calls.some(route=>route.includes('/p2/workspace/file')));
});

import {workspaceFileTitle} from '../public/workspace-ui.mjs';
test('known artifact labels use exact project/path metadata while unregistered filenames remain unchanged',()=>{
 const artifact={projectId:'p1',path:'artifacts/artifact_id-report',name:'工程交付报告'};assert.equal(workspaceFileTitle(artifact.path,[artifact],'p1'),'工程交付报告');assert.equal(workspaceFileTitle(artifact.path,[artifact],'p2'),'artifact_id-report');assert.equal(workspaceFileTitle('docs/README.md',[],'p1'),'README.md');
});

test('document drafts survive tab and project navigation and only explicit Save mutates the original scoped file',async()=>{
 let project={id:'p1',folderPath:'/work/one'};const requests=[],file=(route)=>({path:'report.md',name:'report.md',type:'markdown',encoding:'utf8',previewable:true,editable:true,sha256:'a'.repeat(64),content:route.includes('/p1/')?'original one':'original two'});
 const ui=createWorkspaceUI({getProject:()=>project,api:async(route,options)=>{requests.push({route,options});if(options?.method==='PUT')return {...file(route),content:JSON.parse(options.body).content,sha256:'b'.repeat(64),saved:true};if(route.includes('/resolve?'))return {kind:'file'};return file(route);}});
 await ui.openPath('report.md');ui.beginEdit();ui.setEditContent('human draft');await ui.openPath('other.md');assert.equal(ui.editState(),null);await ui.openPath('report.md');assert.equal(ui.editState().content,'human draft');
 project={id:'p2',folderPath:'/work/two'};await ui.openPath('report.md');assert.equal(ui.editState(),null);project={id:'p1',folderPath:'/work/one'};await ui.openPath('report.md');assert.equal(ui.editState().content,'human draft');assert.equal(requests.filter(r=>r.options?.method==='PUT').length,0);
 await ui.saveEdit();const writes=requests.filter(r=>r.options?.method==='PUT');assert.equal(writes.length,1);assert.match(writes[0].route,/\/p1\/workspace\/file/);assert.deepEqual(JSON.parse(writes[0].options.body),{expectedSha256:'a'.repeat(64),content:'human draft'});assert.equal(ui.editState(),null);
});

test('conflicted save retains the human draft and Cancel discards it without an extra request',async()=>{
 let writes=0;const ui=createWorkspaceUI({getProject:()=>({id:'p1',folderPath:'/work/one'}),api:async(route,options)=>{if(options?.method==='PUT'){writes++;const error=Error('File revision conflict');error.status=409;throw error;}if(route.includes('/resolve?'))return {kind:'file'};return {path:'report.md',content:'original',type:'markdown',sha256:'a'.repeat(64),editable:true};}});
 await ui.openPath('report.md');ui.beginEdit();ui.setEditContent('unsaved work');await assert.rejects(ui.saveEdit(),/conflict/);assert.equal(ui.editState().content,'unsaved work');assert.match(ui.editState().error,/conflict/);ui.cancelEdit();assert.equal(ui.editState(),null);assert.equal(writes,1);
});

test('inline knowledge and protected files cannot enter text editing',async()=>{
 let writes=0;const ui=createWorkspaceUI({getProject:()=>({id:'p1',folderPath:'/work/one'}),getKnowledge:()=>[{id:'k',name:'knowledge.md',content:'imported'}],api:async(route,options)=>{if(options?.method==='PUT')writes++;if(route.includes('/resolve?'))return {kind:'file'};return {path:'result.json',content:'{}',type:'json',sha256:'a'.repeat(64),editable:false};}});
 ui.openKnowledge('k');assert.throws(()=>ui.beginEdit(),/只读/);await ui.openPath('engineering/professional/job/result.json',{raw:true});assert.throws(()=>ui.beginEdit(),/只读/);assert.equal(writes,0);
});
