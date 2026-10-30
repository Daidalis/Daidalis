import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runContainerProcess} from '../../server/container-process.mjs';
const base='http://127.0.0.1:'+process.env.PORT,checks=[];
async function api(route,body,method=body?'POST':'GET'){const response=await fetch(base+route,{method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;}
let project=(await api('/api/bootstrap')).projects.find(p=>p.name==='GIS and orbit acceptance');project??=await api('/api/projects',{name:'GIS and orbit acceptance'});
const route='/api/projects/'+project.id;
const fixture=await runContainerProcess('/usr/bin/python3',['deploy/runner/gis-fixture.py',project.folderPath+'/square.zip'],{cwd:process.cwd()});assert.equal(fixture.code,0,fixture.stderr);
const bytes=await fs.readFile(project.folderPath+'/square.zip');
const gis=await api(route+'/geospatial/jobs',{path:'square.zip',expectedHash:createHash('sha256').update(bytes).digest('hex'),expectedSourceEpsg:4326,points:[{id:'inside',lon:1,lat:1,expected:'inside'},{id:'edge',lon:0,lat:1,expected:'boundary'},{id:'outside',lon:3,lat:3,expected:'outside'}]});
await api(route+'/geospatial/jobs/'+gis.id+'/wait',{timeoutMs:120000});const result=await api(route+'/geospatial/jobs/'+gis.id+'/result');assert.equal(result.executionSucceeded,true,result.diagnostics);assert.equal(result.passed,true);assert.equal(result.integrity.verified,true);checks.push('GDAL real Shapefile classification and persisted integrity');
const model={schema:'manta-orbit42-v1',source:{repository:'nasa-itc/42',revision:'dev_20260403'},scenario:{epochUtc:'2024-08-04T00:00:00Z',leapSeconds:37,periapsisAltitudeKm:400,apoapsisAltitudeKm:400,inclinationDeg:52,raanDeg:0,argumentOfPeriapsisDeg:0,trueAnomalyDeg:20,durationSeconds:60,stepSeconds:.1,outputIntervalSeconds:10},assumptions:['Acceptance only, no mission claim']};
const path='models/acceptance.orbit42.json';const existing=await api(route+'/orbit42/model?path='+encodeURIComponent(path)).catch(()=>null);
const saved=await api(route+'/orbit42/model',{path,content:JSON.stringify(model),expectedHash:existing?.sha256??null},'PUT');
const orbit=await api(route+'/orbit42/jobs',{path,expectedHash:saved.sha256});await api(route+'/orbit42/jobs/'+orbit.id+'/wait',{timeoutMs:120000});const native=await api(route+'/orbit42/jobs/'+orbit.id+'/result');assert.equal(native.executionSucceeded,true,JSON.stringify(native));assert.equal(native.integrity.verified,true);checks.push('NASA 42 native trajectory and persisted evidence');
console.log(JSON.stringify({passed:true,projectId:project.id,checks}));
