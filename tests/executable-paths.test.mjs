import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolveExecutable,resolveCodexExecutable,CODEX_MISSING_MESSAGE} from '../server/executable-paths.mjs';
import {createCodexModelCatalog} from '../server/codex-models.mjs';
import {createCodexRuntime} from '../server/runtimes/codex.mjs';

const exec=promisify(execFile);
const supportsPosix=process.platform!=='win32';

test('Codex discovery honors explicit configuration before PATH and bounded macOS bundles',()=>{
 const existing=new Set(['/custom/codex','/bin/codex','/Applications/Codex.app/Contents/Resources/codex']);
 const probe={platform:'darwin',cwd:'/',isExecutable:file=>existing.has(file)};
 assert.equal(resolveCodexExecutable({...probe,env:{PATH:'/bin',MBSE_CODEX_PATH:'/custom/codex'}}),'/custom/codex');
 assert.equal(resolveCodexExecutable({...probe,env:{PATH:'/bin'}}),'/bin/codex');
 assert.equal(resolveCodexExecutable({...probe,env:{PATH:'/missing'}}),'/Applications/Codex.app/Contents/Resources/codex');
 assert.equal(resolveCodexExecutable({...probe,platform:'linux',env:{PATH:'/missing'}}),null);
});

test('an invalid configured executable does not silently select another installation',()=>{
 const seen=[];const found=resolveCodexExecutable({env:{MBSE_CODEX_PATH:'/missing/codex',PATH:'/working'},platform:'darwin',cwd:'/',isExecutable:file=>{seen.push(file);return file==='/working/codex';}});
 assert.equal(found,null);assert.deepEqual(seen,['/missing/codex']);
});

test('Windows lookup accepts native executable paths and rejects command-shell shims',()=>{
 const existing=new Set(['C:\\tools\\codex.cmd','C:\\native\\codex.exe','C:\\tools with spaces\\codex.exe']);
 const options={platform:'win32',cwd:'C:\\work',isExecutable:file=>existing.has(file)};
 assert.equal(resolveCodexExecutable({...options,env:{Path:'C:\\tools;C:\\native'}}),'C:\\native\\codex.exe');
 assert.equal(resolveCodexExecutable({...options,env:{Path:'"C:\\tools with spaces"'}}),'C:\\tools with spaces\\codex.exe');
 assert.equal(resolveCodexExecutable({...options,env:{PATH:'C:\\native',MBSE_CODEX_PATH:'C:\\tools\\codex.cmd'}}),null);
 assert.equal(resolveCodexExecutable({...options,env:{PATH:'C:\\tools'}}),null);
});

test('PATH discovery treats executable names as file names rather than shell programs',()=>{
 const seen=[];const options={env:{PATH:'/first:/second'},platform:'linux',cwd:'/',isExecutable:file=>{seen.push(file);return false;}};
 assert.equal(resolveExecutable('codex; touch marker',options),null);
 assert.deepEqual(seen,['/first/codex; touch marker','/second/codex; touch marker']);
 assert.equal(resolveExecutable('codex\nother',options),null);
});

test('real executable detection rejects directories and non-executable files',{skip:!supportsPosix},async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'manta-executable-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
 const first=path.join(temp,'first'),second=path.join(temp,'second with spaces');await fs.mkdir(first);await fs.mkdir(second);
 await fs.mkdir(path.join(first,'codex'));const candidate=path.join(second,'codex');await fs.writeFile(candidate,'#!/bin/sh\nexit 0\n',{mode:0o600});
 const options={platform:'linux',env:{PATH:[first,second].join(path.delimiter)}};assert.equal(resolveCodexExecutable(options),null);
 await fs.chmod(candidate,0o700);assert.equal(resolveCodexExecutable(options),candidate);
});

test('missing Codex reports setup instructions without starting any native process',async()=>{
 let calls=0;const spawnImpl=()=>{calls++;throw Error('Unexpected spawn');};
 const catalog=createCodexModelCatalog({codexPath:null,spawnImpl});
 await assert.rejects(catalog.list({},{workspace:process.cwd()}),error=>error.message.includes(CODEX_MISSING_MESSAGE));
 const runtime=createCodexRuntime({codexPath:null,spawnImpl});assert.throws(()=>runtime.startTurn({}),error=>error.message===CODEX_MISSING_MESSAGE);await runtime.close();
 assert.equal(calls,0);
});

test('custom API model configuration does not require querying a local Codex catalog',async()=>{
 const catalog=createCodexModelCatalog({codexPath:null,spawnImpl:()=>{throw Error('Unexpected spawn');}});
 const result=await catalog.list({baseUrl:'https://model.example/v1',model:'configured'});
 assert.equal(result.supportsDiscovery,false);assert.equal(result.configuredModel,'configured');
});

test('POSIX foreground launcher resolves a spaced Node path and shares the data default',{skip:!supportsPosix},async t=>{
 const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'manta-launcher-')));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
 const source=path.join(temp,'application with spaces'),bin=path.join(temp,'tools with spaces');await fs.mkdir(path.join(source,'scripts'),{recursive:true});await fs.mkdir(path.join(source,'server'));await fs.mkdir(bin);
 await fs.copyFile(new URL('../scripts/start.sh',import.meta.url),path.join(source,'scripts/start.sh'));
 await fs.copyFile(new URL('../scripts/launch-config.mjs',import.meta.url),path.join(source,'scripts/launch-config.mjs'));
 await fs.copyFile(new URL('../server/environment.mjs',import.meta.url),path.join(source,'server/environment.mjs'));
 await fs.symlink(process.execPath,path.join(bin,'node'));await fs.writeFile(path.join(bin,'curl'),'#!/bin/sh\nexit 1\n',{mode:0o700});
 await fs.writeFile(path.join(source,'server/index.mjs'),'process.stdout.write(JSON.stringify({cwd:process.cwd(),node:process.env.MBSE_NODE,data:process.env.MBSE_DATA_DIR}));');
 const env={PATH:[bin,'/usr/bin','/bin'].join(path.delimiter),MBSE_NODE:path.join(bin,'node'),MBSE_FOREGROUND:'1',MBSE_NO_OPEN:'1',PORT:'1'};
 const result=await exec('/bin/sh',[path.join(source,'scripts/start.sh')],{env,timeout:10000});
 assert.deepEqual(JSON.parse(result.stdout),{cwd:source,node:process.execPath,data:path.join(source,'data')});
 await assert.rejects(exec('/bin/sh',[path.join(source,'scripts/start.sh')],{env:{...env,MBSE_NODE:path.join(temp,'missing')},timeout:10000}),error=>/valid MBSE_NODE executable/.test(error.stderr));
});
