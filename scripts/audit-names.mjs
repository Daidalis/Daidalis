// Prevent active product code from reintroducing retired names. Compatibility
// adapters and immutable historical evidence are explicit exceptions.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const compatibility=new Map([
  ['scripts/audit-names.mjs','The audit must identify retired spellings.'],
  ['scripts/legacy-env.sh','Existing launcher configuration.'],
  ['shared/legacy-names.mjs','Existing runtime configuration, schemas and sessions.'],
  ['public/legacy-names.mjs','Persisted links, records and desktop shells.'],
  ['desktop/legacy-names.h','Existing native launcher configuration.'],
  ['deploy/docker/migrate-name.py','One-time deployment migration.'],
  ['deploy/runner/name_compat.py','Existing native volumes and virtual machines.'],
  ['vm/host/name_compat.py','Closed profiles for existing VM identities and folders.'],
  ['vm/host/name_compat.swift','Existing VM filesystem tags and socket identity.'],
  ['vm/host/test_name_compat.py','Existing VM profile regression fixtures.'],
  ['vm/worker/bundle/shared/legacy-names.mjs','Pinned copy of the runtime compatibility boundary.'],
  ['docs/rename-migration.md','Upgrade instructions identify old settings.'],
  ['tests/rename-compat.test.mjs','Real compatibility regression fixtures.'],
  ['tests/rename-migration.test.mjs','Deployment migration regression fixtures.'],
  ['tests/rename-worker.test.mjs','Worker wire compatibility regression fixtures.'],
  ['tests/rename-links.test.mjs','Saved conversation link compatibility fixtures.'],
]);
// Staged workers are standalone, source-pinned programs. Their only legacy
// literal is this exact input-schema adapter; all emitted schemas use new names.
const standaloneReaders=new Set(['claude-remote-launch.py','native-readiness.py','geospatial-run.py','orbit42-run.py','geospatial-status.py','provision-worker.py','stf-low-power-run.py','orbit-ground-run.py'].map(name=>'vm/worker/'+name));
const schemaAdapter="    return value == expected or (isinstance(value, str) and value.startswith('manta-') and 'daidalis-' + value[6:] == expected)";
const git=spawnSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8',maxBuffer:16*1024*1024});
if(git.status!==0)throw Error('Run the name audit inside a Git checkout');
const files=[...new Set(git.stdout.split('\0').filter(Boolean))];
const retired=/manta|syspilot|MBSE_[A-Z0-9_]+/i;
const violations=[];let inspected=0,preserved=0;
for(const file of files){
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())continue;
  if(compatibility.has(file)||file.startsWith('website/dist/assets/evidence/')){preserved++;continue;}
  if(retired.test(path.basename(file)))violations.push({file,line:0});
  const bytes=fs.readFileSync(file);
  if(bytes.subarray(0,8000).includes(0))continue;
  inspected++;
  for(const [index,line]of bytes.toString('utf8').split('\n').entries())if(retired.test(line)&&!(standaloneReaders.has(file)&&line===schemaAdapter))violations.push({file,line:index+1});
}
console.log(JSON.stringify({passed:violations.length===0,inspected,preserved,violations},null,2));
if(violations.length)process.exitCode=1;
