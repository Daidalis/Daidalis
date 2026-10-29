import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-installer-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'deploy/docker'),{recursive:true});
  await fs.mkdir(path.join(root,'bin'));
  await fs.copyFile(new URL('../deploy/docker/install-broker.sh',import.meta.url),path.join(root,'deploy/docker/install-broker.sh'));
  await fs.writeFile(path.join(root,'.env.example'),'');
  // A recording Docker double: these tests must never contact a real daemon.
  await fs.writeFile(path.join(root,'bin/docker'),`#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_LOG"
case "$*" in
 'info --format {{json .SecurityOptions}}') echo '["name=rootless"]' ;;
 'info --format {{.CgroupVersion}} {{.CgroupDriver}} {{.MemoryLimit}} {{.PidsLimit}}') echo '2 systemd true true' ;;
 'info --format {{.CPUCfsQuota}}') echo "\${TEST_CPU_QUOTA:-true}" ;;
 'info --format {{.ServerVersion}}') echo "$TEST_ENGINE_VERSION" ;;
 run*) echo 999 ;;
esac
`,{mode:0o755});
  const env={TEST_ENGINE_VERSION:'29.4.1',PATH:path.join(root,'bin')+':'+process.env.PATH,DOCKER_HOST:'unix:///tmp/test-rootless.sock',TEST_LOG:path.join(root,'calls.log')};
  return {root,env,run:(extra,start=false)=>exec('/bin/sh',['deploy/docker/install-broker.sh',...(start?[]:['--no-start'])],{cwd:root,env:{...env,...extra}})};
}
test('broker installer retains minimal tool choices and does not start with --no-start',async t=>{
  const f=await fixture(t);await f.run({MANTA_TOOLS:'',MANTA_MODELICA:'0',MANTA_ORBIT42:'0'});
  const saved=await fs.readFile(path.join(f.root,'deploy/local/broker.env'),'utf8');
  assert.match(saved,/^MANTA_TOOLS=$/m);assert.match(saved,/^MANTA_MODELICA=0$/m);assert.match(saved,/^MANTA_ORBIT42=0$/m);
  assert.match(saved,/MANTA_ROOTLESS_SOCKET_GID=999/);
  const calls=await fs.readFile(f.env.TEST_LOG,'utf8');
  assert.match(calls,/compose config --quiet/);assert.match(calls,/compose build manta broker/);assert.doesNotMatch(calls,/compose up/);
});
test('invalid ports, tools and unsupported Engine fail before building or saving',async t=>{
  for(const extra of [{MANTA_PORT:'8080'},{MANTA_PORT:'4320',MANTA_DESKTOP_PORT:'4320'},{MANTA_TOOLS:'bogus'},{TEST_ENGINE_VERSION:'25.0.0'}]){
    const f=await fixture(t);await assert.rejects(f.run(extra));
    assert.doesNotMatch(await fs.readFile(f.env.TEST_LOG,'utf8'),/compose build/);
    await assert.rejects(fs.access(path.join(f.root,'deploy/local/broker.env')));
  }
});
test('broker installer preserves independently selected engineering desktop groups',async t=>{
  const f=await fixture(t);await f.run({MANTA_TOOLS:'desktop,freecad,scilab',MANTA_MODELICA:'1',MANTA_ORBIT42:'0'});
  const saved=await fs.readFile(path.join(f.root,'deploy/local/broker.env'),'utf8');
  assert.match(saved,/^MANTA_TOOLS=desktop,freecad,scilab$/m);
  assert.match(saved,/^MANTA_MODELICA=1$/m);
  assert.doesNotMatch(await fs.readFile(f.env.TEST_LOG,'utf8'),/compose up/);
});

test('upgrading tool images recreates the broker that pins task image IDs',async t=>{
  const f=await fixture(t);await f.run({},true);
  assert.match(await fs.readFile(f.env.TEST_LOG,'utf8'),/compose up -d --force-recreate --wait/);
});

test('missing CPU delegation requires explicit opt-out before installation', async t => {
 const f = await fixture(t);
 await assert.rejects(f.run({TEST_CPU_QUOTA: 'false'}), /CPU quota is unavailable/);
 assert.doesNotMatch(await fs.readFile(f.env.TEST_LOG, 'utf8'), /compose build/);
 await f.run({TEST_CPU_QUOTA: 'false', MANTA_TASK_CPUS: '0'});
 assert.match(await fs.readFile(path.join(f.root, 'deploy/local/broker.env'), 'utf8'), /^MANTA_TASK_CPUS=0$/m);
});
