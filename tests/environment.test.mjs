import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

test('checkout-local .env loads without executing shell text and inherited values win',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'manta-environment-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.mkdir(path.join(dir,'server'));const file=path.join(dir,'server/environment.mjs');await fs.copyFile(new URL('../server/environment.mjs',import.meta.url),file);
  await fs.writeFile(path.join(dir,'.env'),'MANTA_ENV_FIXTURE=in-file\nMANTA_ENV_TEXT="literal $(not-a-command)"\n');
  const result=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(pathToFileURL(file).href)});console.log(JSON.stringify({value:process.env.MANTA_ENV_FIXTURE,text:process.env.MANTA_ENV_TEXT}));`],{env:{...process.env,MANTA_ENV_FIXTURE:'inherited'},encoding:'utf8',cwd:os.tmpdir()});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{value:'inherited',text:'literal $(not-a-command)'});
});

test('missing optional .env does not prevent startup',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'manta-no-env-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.mkdir(path.join(dir,'server'));const file=path.join(dir,'server/environment.mjs');await fs.copyFile(new URL('../server/environment.mjs',import.meta.url),file);
  const result=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(pathToFileURL(file).href)});`],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
});

test('launcher config reads .env port and resolves a relative data directory from the checkout, not cwd',async t=>{
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'manta-launch-env-')));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.mkdir(path.join(dir,'server'));await fs.mkdir(path.join(dir,'scripts'));
  await fs.copyFile(new URL('../server/environment.mjs',import.meta.url),path.join(dir,'server/environment.mjs'));
  const script=path.join(dir,'scripts/launch-config.mjs');await fs.copyFile(new URL('../scripts/launch-config.mjs',import.meta.url),script);
  const marker=path.join(dir,'must-not-exist');
  await fs.writeFile(path.join(dir,'.env'),'PORT=5432\nMBSE_DATA_DIR="shared data/项目 $(touch '+marker+')"\n');
  const env={...process.env};delete env.PORT;delete env.MBSE_DATA_DIR;
  const launch=key=>spawnSync(process.execPath,[script,key],{cwd:os.tmpdir(),env,encoding:'utf8'});
  const port=launch('port'),data=launch('data');assert.equal(port.status,0,port.stderr);assert.equal(port.stdout,'5432');assert.equal(data.status,0,data.stderr);
  assert.equal(data.stdout,path.join(dir,'shared data/项目 $(touch '+marker+')'));
  await assert.rejects(fs.stat(marker),{code:'ENOENT'});
  const inherited=spawnSync(process.execPath,[script,'port'],{env:{...env,PORT:'6543'},encoding:'utf8'});assert.equal(inherited.stdout,'6543');
  const invalid=spawnSync(process.execPath,[script,'port'],{env:{...env,PORT:'0'},encoding:'utf8'});assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/PORT must be an integer/);
});
