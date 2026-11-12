import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const exec=promisify(execFile),script=fileURLToPath(new URL('../deploy/docker/migrate-name.py',import.meta.url));
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'daidalis-name-migration-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'deploy/local'),{recursive:true});
  return {root,async run(args=[],extra={}){return exec('python3',[script,'--root',root,...args],{timeout:10000,env:{...process.env,...extra}});}};
}

async function dockerDouble(f,volumes){
  const bin=path.join(f.root,'bin'),log=path.join(f.root,'docker-calls.jsonl');
  await fs.mkdir(bin);
  const docker=path.join(bin,'docker');
  await fs.writeFile(docker,`#!/usr/bin/env python3
import json,os,sys
args=sys.argv[1:]
with open(os.environ['DAIDALIS_TEST_DOCKER_LOG'],'a') as f:f.write(json.dumps(args)+'\\n')
volumes=json.loads(os.environ['DAIDALIS_TEST_VOLUMES'])
if args[:2]==['volume','ls']:print('\\n'.join(v['Name'] for v in volumes))
elif args[:2]==['volume','inspect']:print(json.dumps(volumes))
else:sys.exit(3)
`);await fs.chmod(docker,0o755);
  return {PATH:bin+path.delimiter+process.env.PATH,DAIDALIS_TEST_DOCKER_LOG:log,DAIDALIS_TEST_VOLUMES:JSON.stringify(volumes)};
}

test('name migration previews without exposing values, applies once, and preserves backups and user content',async t=>{
  const f=await fixture(t),envFile=path.join(f.root,'.env');
  const original='MANTA_MAX_TOOL_TURNS=64\nMBSE_DATA_DIR="existing data"\nMANTA_MCP_TOKEN=fixture-private-token\n';
  const userContent='User model named Manta; never rewrite this file.\n';
  await fs.writeFile(envFile,original);await fs.writeFile(path.join(f.root,'model.sysml'),userContent);
  const preview=await f.run(['--skip-docker']);
  assert.equal(JSON.parse(preview.stdout).mode,'preview');assert(!preview.stdout.includes('fixture-private-token'));
  assert.equal(await fs.readFile(envFile,'utf8'),original);
  await f.run(['--skip-docker','--apply']);
  const changed=await fs.readFile(envFile,'utf8');
  assert.equal(changed,'DAIDALIS_MAX_TOOL_TURNS=64\nDAIDALIS_DATA_DIR="existing data"\nDAIDALIS_MCP_TOKEN=fixture-private-token\n');
  assert.equal(await fs.readFile(envFile+'.before-daidalis','utf8'),original);
  assert.equal((await fs.stat(envFile)).mode&0o777,0o600);
  const repeated=JSON.parse((await f.run(['--skip-docker','--apply'])).stdout);
  assert.deepEqual(repeated.files_to_write,[]);
  assert.equal(await fs.readFile(envFile+'.before-daidalis','utf8'),original);
  assert.equal(await fs.readFile(path.join(f.root,'model.sysml'),'utf8'),userContent);
});

test('migration conflicts fail before changing any saved configuration',async t=>{
  const f=await fixture(t),envFile=path.join(f.root,'.env'),install=path.join(f.root,'deploy/local/install.env');
  const original='MANTA_PORT=4317\n',conflict='MANTA_MAX_TOOL_TURNS=64\nDAIDALIS_MAX_TOOL_TURNS=96\n';
  await fs.writeFile(envFile,original);await fs.writeFile(install,conflict);
  await assert.rejects(f.run(['--skip-docker','--apply']),error=>/Conflicting configuration entries/.test(error.stderr));
  assert.equal(await fs.readFile(envFile,'utf8'),original);assert.equal(await fs.readFile(install,'utf8'),conflict);
  await assert.rejects(fs.stat(envFile+'.before-daidalis'),{code:'ENOENT'});
});

test('Docker migration reuses discovered volumes and preserves a custom broker owner without modifying Docker state',async t=>{
  const f=await fixture(t),log=path.join(f.root,'docker-calls.jsonl');
  const project='existing-project',volumes=['state','projects','home','model-control'].map(key=>({Name:'existing_'+key,Labels:{'com.docker.compose.project':project,'com.docker.compose.volume':key}}));
  const broker=path.join(f.root,'deploy/local/broker.env');
  await fs.writeFile(broker,'COMPOSE_PROJECT_NAME='+project+'\nCOMPOSE_FILE=compose.yaml:deploy/docker/compose.broker.yaml\nMANTA_BROKER_ID=custom-owner\nMANTA_TASK_PROJECTS_VOLUME=existing_projects\n');
  const extra=await dockerDouble(f,volumes);
  const preview=JSON.parse((await f.run([],extra)).stdout);
  assert.equal(preview.existing_volumes_reused.projects,'existing_projects');
  const result=JSON.parse((await f.run(['--apply'],extra)).stdout);
  assert.equal(result.containers_or_volumes_modified,false);
  const override=JSON.parse(await fs.readFile(path.join(f.root,'deploy/local/name-migration.compose.yaml'),'utf8'));
  assert.equal(override.volumes.projects.name,'existing_projects');assert.equal(override.volumes.projects.external,true);
  const owner=override.services?.broker?.environment?.DAIDALIS_BROKER_ID;
  assert(owner===undefined||owner==='custom-owner','A custom native-session owner must survive migration');
  assert.match(await fs.readFile(broker,'utf8'),/DAIDALIS_BROKER_ID=custom-owner/);
  const calls=(await fs.readFile(log,'utf8')).trim().split('\n').map(JSON.parse);
  assert(calls.every(args=>args[0]==='volume'&&['ls','inspect'].includes(args[1])));
  assert.deepEqual(JSON.parse((await f.run(['--apply'],extra)).stdout).files_to_write,[]);
});


test('an existing Compose installation with only .env loads the volume override automatically',async t=>{
  const f=await fixture(t),project='existing-project';
  const volumes=['state','projects','home'].map(key=>({Name:'existing_'+key,Labels:{'com.docker.compose.project':project,'com.docker.compose.volume':key}}));
  const extra=await dockerDouble(f,volumes),envFile=path.join(f.root,'.env');
  await fs.writeFile(envFile,'MANTA_PORT=4317\nSYSPILOT_MAX_TOOL_TURNS=64\n');
  await f.run(['--project',project,'--apply'],extra);
  const saved=await fs.readFile(envFile,'utf8');
  assert.match(saved,/^DAIDALIS_PORT=4317$/m);
  assert.match(saved,/^DAIDALIS_MAX_TOOL_TURNS=64$/m);
  assert.match(saved,/^COMPOSE_FILE=compose.yaml:deploy\/local\/name-migration.compose.yaml$/m);
  assert.match(saved,/^COMPOSE_PROJECT_NAME=existing-project$/m);
  const override=JSON.parse(await fs.readFile(path.join(f.root,'deploy/local/name-migration.compose.yaml'),'utf8'));
  assert.equal(override.volumes.state.name,'existing_state');
  assert.equal(override.services,undefined,'Shared Compose must not gain an unconfigured broker service');
  assert.deepEqual(JSON.parse((await f.run(['--apply'],extra)).stdout).files_to_write,[]);
});

test('a conflicting explicit volume is rejected before any configuration is rewritten',async t=>{
  const f=await fixture(t),project='existing-project';
  const volumes=[{Name:'existing_projects',Labels:{'com.docker.compose.project':project,'com.docker.compose.volume':'projects'}}];
  const extra=await dockerDouble(f,volumes),file=path.join(f.root,'deploy/local/broker.env');
  const saved='COMPOSE_PROJECT_NAME='+project+'\nMANTA_TASK_PROJECTS_VOLUME=another_projects\n';
  await fs.writeFile(file,saved);
  await assert.rejects(f.run(['--apply'],extra),error=>/Configured volume differs/.test(error.stderr));
  assert.equal(await fs.readFile(file,'utf8'),saved);
  await assert.rejects(fs.stat(file+'.before-daidalis'),{code:'ENOENT'});
  await assert.rejects(fs.stat(path.join(f.root,'deploy/local/name-migration.compose.yaml')),{code:'ENOENT'});
});
