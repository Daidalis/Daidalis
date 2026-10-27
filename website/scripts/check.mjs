import {readFileSync,existsSync} from 'node:fs';
import {staticFiles} from './static-export.mjs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const args=process.argv.slice(2);
assert(!args.length||(args.length===2&&args[0]==='--root'),'Use check.mjs [--root <directory>]');
const root=path.resolve(args[1]||fileURLToPath(new URL('../dist/',import.meta.url)));
const files=staticFiles(root);
const read=p=>readFileSync(path.join(root,p));
const sha=b=>createHash('sha256').update(b).digest('hex');
const html=read('index.html').toString(),script=read('app.js').toString();
for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){const ref=match[1];if(/^(?:#|https?:|data:)/.test(ref))continue;assert(!ref.startsWith('/'),'Local assets must support a Pages subpath: '+ref);const target=path.resolve(root,ref.split(/[?#]/)[0]);assert(target.startsWith(root+path.sep),'Asset escapes export: '+ref);assert(existsSync(target),`Missing static asset ${ref}`);}
for(const match of html.matchAll(/href="#([^"]+)"/g))assert(html.includes('id="'+match[1]+'"'),`Missing anchor ${match[1]}`);
const data=JSON.parse(read('assets/evidence/recording.json'));
for(const [name,run] of Object.entries(data.runs)){
 const csv=read('assets/evidence/'+name+'.csv');assert.equal(sha(csv),run.telemetrySha256);
 const lines=csv.toString().trim().split(/\r?\n/),keys=lines.shift().split(',');assert.equal(lines.length,run.rowCount);assert.equal(run.samples.length,run.rowCount);
 lines.forEach((line,i)=>line.split(',').forEach((value,j)=>assert.equal(run.samples[i][keys[j]],value===''?null:keys[j]==='phase'?value:Number(value))));
 assert.equal(run.checks.length,5);assert.equal(run.checks.filter(c=>c.passed).length,name==='baseline'?3:5);assert.equal(run.executionSucceeded,true);
}
assert.equal(sha(read('assets/evidence/STFLowPower.stf.json')),data.runs.corrected.modelSha256);
assert.equal(data.runs.corrected.rowCount,473);assert.equal(data.runs.baseline.rowCount,479);
for(const {absolute:f} of files){const s=readFileSync(f).toString();assert(!/-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|sk-ant-api[A-Za-z0-9_-]{30,}|\/Users\/[^/\s]+\/|\/Volumes\/[^/\s]+\//.test(s),'Sensitive or host-specific content in '+f);}
assert(!script.includes('setInterval'),'Replay should not imply live activity');
console.log('PASS: static references, anchors, full CSV↔JSON equality, original data/model SHA-256, scoped check counts and export scan.');
