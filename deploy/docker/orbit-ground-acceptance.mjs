// Requires a caller-provided real state Shapefile ZIP, never a fabricated boundary.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const base='http://127.0.0.1:'+process.env.PORT;
async function api(route,body){const r=await fetch(base+route,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:undefined);const x=await r.json();assert.ok(r.ok,JSON.stringify(x));return x;}
assert.ok(process.env.MANTA_STATE_ZIP,'Set MANTA_STATE_ZIP to the supplied Census state ZIP');
const p=(await api('/api/bootstrap')).projects.find(p=>p.name==='GIS and orbit acceptance');assert.ok(p,'Run gis-orbit-acceptance first');
const route='/api/projects/'+p.id,bytes=await fs.readFile(process.env.MANTA_STATE_ZIP),hash=createHash('sha256').update(bytes).digest('hex'),name='source-'+hash+'.zip';
await fs.writeFile(p.folderPath+'/'+name,bytes);
const orbit=(await api(route+'/orbit42/jobs')).find(j=>j.status==='completed');assert.ok(orbit);
const job=await api(route+'/orbit-ground/jobs',{orbit42JobId:orbit.id,censusPath:name,censusSha256:hash,maxSamples:201});
await api(route+'/orbit-ground/jobs/'+job.id+'/wait',{timeoutMs:180000});
const result=await api(route+'/orbit-ground/jobs/'+job.id+'/result');
assert.equal(result.executionSucceeded,true,JSON.stringify(result));assert.equal(result.integrity.verified,true);
assert.equal(result.passed,null);assert.ok(result.metrics.controls.every(c=>c.passed));
assert.ok(result.artifacts.some(a=>a.path===result.mapPath));
console.log(JSON.stringify({passed:true,projectId:p.id,jobId:job.id,sourceSha256:hash,samples:result.metrics.selectedSamples,controls:result.metrics.controls,scope:result.scope}));
