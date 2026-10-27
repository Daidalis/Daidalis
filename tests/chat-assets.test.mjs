import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeChatArtifacts,completedTurnEntries} from '../public/chat-assets.mjs';
import {visibleRunWork} from '../shared/run-presentation.mjs';
test('200 native runner files become five distinct logical job entries, not a raw artifact wall',()=>{
 const raw=[];
 for(let job=0;job<5;job++)for(let file=0;file<40;file++)raw.push({id:`a-${job}-${file}`,projectId:'p',runId:'r',name:['compiler.log','load-errors.txt','input.json','receipt.json','snapshot.mo','samples.csv'][file%6],path:`engineering/professional/professional_${String(job).padStart(32,'0')}/file-${file}.${file%2?'json':'csv'}`});
 const before=JSON.stringify(raw),view=summarizeChatArtifacts(raw,{projectId:'p',runId:'r'});
 assert.equal(view.entries.length,5);assert.ok(view.entries.every(e=>e.kind==='job'&&e.action==='view-professional-job'&&e.rawCount===40));assert.equal(new Set(view.entries.map(e=>e.id)).size,5);assert.equal(view.rawCount,200);assert.doesNotMatch(JSON.stringify(view.entries),/compiler\.log|snapshot\.mo|samples\.csv|receipt\.json/);assert.equal(JSON.stringify(raw),before);
});
test('only user-facing models and Markdown appear outside job details, bounded by recent assets',()=>{
 const artifacts=Array.from({length:20},(_,i)=>({id:'a'+i,projectId:'p',runId:'r',path:`models/design${i}.mo`,name:`design${i}.mo`}));
 artifacts.push({id:'report',projectId:'p',runId:'r',name:'中文验收报告',type:'markdown'},{id:'raw',projectId:'p',runId:'r',path:'compiler.log'},{id:'json',projectId:'p',runId:'r',path:'input.json'},{id:'other',projectId:'q',runId:'r',path:'private.md'});
 const view=summarizeChatArtifacts(artifacts,{projectId:'p',runId:'r'});assert.equal(view.entries.length,8);assert.equal(view.hiddenEntryCount,13);assert.equal(view.entries[0].name,'中文验收报告');assert.ok(view.entries.every(e=>e.kind==='artifact'));assert.doesNotMatch(JSON.stringify(view.entries),/compiler.log|input.json|private.md/);
});
test('routine bookkeeping successes fold, active calls and failures stay visible with one result destination per job',()=>{
 const activities=[...Array.from({length:30},(_,i)=>({id:'state'+i,tool:i%2?'record_engineering_object':'get_engineering_state',kind:'tool',status:'completed',result:{id:'record'+i}})),{id:'current',tool:'get_engineering_state',kind:'tool',status:'running'},...Array.from({length:10},(_,i)=>({id:'poll'+i,tool:'get_professional_job',kind:'tool',status:'completed',result:{id:'receipt'+i},destination:'view-professional-job:job1'})),...Array.from({length:4},(_,i)=>({id:'failure'+i,tool:'submit_professional_job',kind:'tool',status:'failed',args:{path:'models/power.mo'},result:{error:'invalid source'}}))];
 const view=visibleRunWork({status:'running',activities},{hasResult:()=>true,resultKey:a=>a.destination});
 assert.equal(view.routineCount,30);assert.equal(view.activities.length,3);assert.ok(view.activities.some(a=>a.id==='current'));assert.equal(view.activities.find(a=>a.id.startsWith('failure')).repeatedFailureCount,4);assert.equal(view.activities.filter(a=>a.id.startsWith('poll')).length,1);
});

test('native GIS map and 42 curve appear as two chat-linked results while raw job files stay folded',()=>{
 const geo='geospatial_'+'a'.repeat(32),orbit='orbit42_'+'b'.repeat(32),geoPath=`engineering/geospatial/${geo}/outputs/preview.geojson`,orbitPath=`engineering/orbit/${orbit}/trajectory.csv`;
 const artifacts=[{id:'map',projectId:'p',runId:'r',path:geoPath},{id:'curve',projectId:'p',runId:'r',path:orbitPath},{id:'raw-geo',projectId:'p',runId:'r',path:`engineering/geospatial/${geo}/input.json`},{id:'raw-orbit',projectId:'p',runId:'r',path:`engineering/orbit/${orbit}/receipt.json`}];
 const activities=[{tool:'wait_geospatial_job',result:{jobId:geo,status:'completed',integrity:{verified:true},artifacts:[{path:geoPath}]}},{tool:'wait_orbit42_job',result:{jobId:orbit,status:'completed',integrity:{verified:true},artifacts:[{path:orbitPath}]}}];
 const summary=summarizeChatArtifacts(artifacts,{projectId:'p',runId:'r',activities});
 assert.deepEqual(summary.entries.map(a=>[a.name,a.action,a.id]),[['轨迹曲线','read-artifact','curve'],['地图预览','read-artifact','map']]);assert.equal(summary.rawCount,2);
 const row={runId:'r',activities};
 const completed=completedTurnEntries(row,{artifacts,projectId:'p'});assert.equal(completed.files.length,2);assert.ok(completed.files.some(a=>a.path===geoPath));assert.ok(completed.files.some(a=>a.path===orbitPath));
});

test('registered previews remain folded when a later native integrity check fails',()=>{
 const geo='geospatial_'+'a'.repeat(32),orbit='orbit42_'+'b'.repeat(32),geoPath=`engineering/geospatial/${geo}/outputs/preview.geojson`,orbitPath=`engineering/orbit/${orbit}/trajectory.csv`;
 const artifacts=[{id:'map',projectId:'p',runId:'r',path:geoPath},{id:'curve',projectId:'p',runId:'r',path:orbitPath}];
 const activities=[{tool:'get_geospatial_job',result:{jobId:geo,status:'completed',integrity:{verified:true},artifacts:[{path:geoPath}]}},{tool:'get_geospatial_job',result:{jobId:geo,status:'completed',integrity:{verified:false},artifacts:[{path:geoPath}]}},{tool:'wait_orbit42_job',result:{result:{jobId:orbit,status:'completed',integrity:{verified:false},artifacts:[{path:orbitPath}]}}}];
 assert.deepEqual(summarizeChatArtifacts(artifacts,{projectId:'p',runId:'r',activities}).entries,[]);
 assert.deepEqual(completedTurnEntries({runId:'r',activities},{artifacts,projectId:'p'}).files,[]);
});

test('orbit-ground map and report live in chat while raw evidence remains folded',()=>{
 const id='orbitground_'+'f'.repeat(32),root=`engineering/orbit-ground/${id}/`;
 const names=['ground-track.geojson','ground-samples.csv','report.md','receipt.json'];
 const artifacts=names.map((name,i)=>({id:'ground-'+i,projectId:'p',runId:'r',path:root+name}));
 const activities=[{tool:'wait_orbit_ground_job',result:{jobId:id,status:'completed',executionSucceeded:true,integrity:{verified:true},artifacts:artifacts.map(a=>({path:a.path}))}}];
 const summary=summarizeChatArtifacts(artifacts,{projectId:'p',runId:'r',activities});
 assert.deepEqual(summary.entries.map(entry=>entry.path).sort(),names.slice(0,3).map(name=>root+name).sort());
 assert.equal(summary.rawCount,1);
 const completed=completedTurnEntries({runId:'r',activities},{artifacts,projectId:'p'});
 assert.ok(completed.allFiles.some(file=>file.path===root+'ground-track.geojson'));
 assert.ok(completed.allFiles.some(file=>file.path===root+'report.md'));
 activities.push({tool:'get_orbit_ground_job',result:{jobId:id,status:'completed',integrity:{verified:false}}});
 assert.deepEqual(summarizeChatArtifacts(artifacts,{projectId:'p',runId:'r',activities}).entries,[]);
 assert.deepEqual(summarizeChatArtifacts(artifacts,{projectId:'p',runId:'r',activities:[{tool:'get_orbit_ground_job',result:{jobId:id,status:'failed',executionSucceeded:false,integrity:{verified:true}}}]}).entries,[]);
});
