import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
const script=fileURLToPath(new URL('../scripts/audit-public.mjs',import.meta.url));
const fake='ghp_'+'Ab9x'.repeat(10);
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'manta-source-audit-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0'};
 const git=(...args)=>{const r=spawnSync('git',args,{cwd:dir,env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r;};
 git('init','-q');
 return {dir,git,scan:(...args)=>spawnSync(process.execPath,[script,...args],{cwd:dir,env,encoding:'utf8',maxBuffer:1024*1024})};
}
test('public audit accepts a clean tracked tree without consulting the network',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.dir,'README.md'),'# Public source\n');f.git('add','.');
 const r=f.scan();assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Findings: 0/);
});
test('public audit reports token locations and ignored configuration without printing secret values',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.dir,'config.json'),JSON.stringify({apiKey:fake}));await fs.writeFile(path.join(f.dir,'.env'),'PORT=4317\n');f.git('add','.');
 const r=f.scan();assert.equal(r.status,1,r.stderr);assert.match(r.stdout,/config.json/);assert.match(r.stdout,/github-token/);assert.match(r.stdout,/local-secret-configuration/);assert(!r.stdout.includes(fake));assert(!r.stderr.includes(fake));
});
test('history audit still detects a credential removed from the working tree',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.dir,'old.txt'),fake);f.git('add','.');f.git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Fixture before deletion');f.git('rm','old.txt');f.git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Fixture after deletion');
 assert.equal(f.scan().status,0);const r=f.scan('--history');assert.equal(r.status,1,r.stderr);assert.match(r.stdout,/old.txt/);assert.match(r.stdout,/github-token/);assert(!r.stdout.includes(fake));
});
test('public audit expands compressed bytes rather than treating archives as opaque',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.dir,'sample.gz'),gzipSync(Buffer.from(fake)));f.git('add','.');
 const r=f.scan();assert.equal(r.status,1,r.stderr);assert.match(r.stdout,/gunzip/);assert.match(r.stdout,/github-token/);assert(!r.stdout.includes(fake));
});
