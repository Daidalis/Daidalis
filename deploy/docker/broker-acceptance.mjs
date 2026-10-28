// Run inside an otherwise idle broker-mode Manta test deployment.
// Creates temporary managed projects; never reads real credentials or projects.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createBrokerRunner} from '../../server/broker-runner.mjs';
import {createToolRuntime} from '../../server/tools.mjs';

assert.equal(process.env.MANTA_EXECUTION_MODE,'broker');
const runner=createBrokerRunner(),base=process.env.MANTA_PROJECTS_ROOT||'/projects';
const one=await fs.mkdtemp(path.join(base,'project-')),two=await fs.mkdtemp(path.join(base,'project-'));
const sentinel=path.join('/data',`broker-test-${randomUUID()}`);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function command(command,options={}){
  const result=await runner.command({workspace:one,command,...options});
  assert.equal(result.code,0,result.stderr);return result;
}
try{
  await fs.writeFile(sentinel,'private application sentinel');
  await fs.writeFile(path.join(two,'private.txt'),'other project sentinel');
  await fs.writeFile(path.join(one,'own.txt'),'current project');
  process.env.MANTA_ACCEPTANCE_PRIVATE_SENTINEL='must-not-reach-task';
  const status=await runner.prepare();
  assert.equal(status.isolated,true);assert.equal(status.isolation.daemonRootless,true);
  console.log('Broker ready:',JSON.stringify(status.isolation));
  const script=`import os, socket\nfrom pathlib import Path\nassert os.getuid()==1000\nassert Path('/work/own.txt').read_text()=='current project'\nfor p in ${JSON.stringify([sentinel,path.join(two,'private.txt'),'/run/task-docker.sock','/var/run/docker.sock','/broker-control/broker.sock'])}:\n assert not Path(p).exists(), p\nassert 'MANTA_ACCEPTANCE_PRIVATE_SENTINEL' not in os.environ\nassert 'OPENAI_API_KEY' not in os.environ\nassert 'ANTHROPIC_API_KEY' not in os.environ\nassert Path('/sys/fs/cgroup/memory.max').read_text().strip()=='2147483648'\nassert Path('/sys/fs/cgroup/pids.max').read_text().strip()=='256'\ntry:\n Path('/etc/manta-test').write_text('bad')\n raise AssertionError('root filesystem writable')\nexcept (PermissionError, OSError): pass\ns=socket.socket(); s.settimeout(.3)\nassert s.connect_ex(('1.1.1.1',443))!=0\nprint('filesystem, credentials, network, UID, memory and PID isolation passed')`;
  console.log((await command(`python3 - <<'PY'\n${script}\nPY`)).stdout.trim());
  await fs.symlink(path.join(two,'private.txt'),path.join(one,'escape'));
  await command('test ! -r escape && test ! -e ../private.txt');
  await fs.writeFile(path.join(one,'large.bin'),Buffer.alloc(13*1024*1024));
  await command('git init -q && printf "#!/bin/sh\\necho ok\\n" > run.sh && chmod +x run.sh && ln -s run.sh linked && git add run.sh linked && git -c user.name=Test -c user.email=test@example.invalid commit -qm initial && ./linked');
  assert.equal((await command('git log -1 --format=%s')).stdout.trim(),'initial');
  assert.equal((await fs.stat(path.join(one,'run.sh'))).mode&0o777,0o755);
  assert.equal(await fs.readlink(path.join(one,'linked')),'run.sh');
  assert.equal((await fs.stat(path.join(one,'large.bin'))).size,13*1024*1024);
  console.log('Git, executable permissions, symlinks and large files preserved');
  let approvals=0;
  const runtime=createToolRuntime({store:{workspace:()=>one},emit:()=>{},requestApproval:async()=>{approvals++;return false;},commandExecutor:args=>runner.command(args)});
  const ctx={projectId:'acceptance',permissionMode:'auto'};
  const compound=await runtime.execute('run_command',{command:'printf verified > auto-policy.txt && cat auto-policy.txt'},ctx);
  assert.equal(compound.stdout,'verified');assert.equal(approvals,0);
  for(const cmd of ['cat '+sentinel,'printf bad > '+sentinel]){
    const result=await runtime.execute('run_command',{command:cmd},ctx);assert.notEqual(result.code,0);
  }
  assert.equal(await fs.readFile(sentinel,'utf8'),'private application sentinel');
  assert.equal(approvals,0);console.log('Linux Auto command policy and external read/write denial passed');

  await assert.rejects(command('sleep 2; touch timeout-escaped',{timeoutMs:100}),/timed out/);
  const controller=new AbortController();
  const pending=runner.command({workspace:one,command:'touch started; sleep 2; touch cancel-escaped',signal:controller.signal});
  // Attach a rejection handler before cancellation, then await its assertion below.
  const rejected=assert.rejects(pending,/Cancelled/);
  for(let i=0;i<200;i++){try{await fs.access(path.join(one,'started'));break;}catch{await delay(50);}}
  await fs.access(path.join(one,'started'));controller.abort();await rejected;
  await command("setsid sh -c 'sleep 2; touch background-escaped' >/dev/null 2>&1 &");
  await delay(2300);
  for(const name of ['timeout-escaped','cancel-escaped','background-escaped'])await assert.rejects(fs.access(path.join(one,name)));
  console.log('Timeout, cancellation and detached child cleanup passed');
  const parallel=await Promise.all([
    runner.command({workspace:one,command:'printf one > parallel; printf one'}),
    runner.command({workspace:two,command:'printf two > parallel; printf two'}),
  ]);
  assert.deepEqual(parallel.map(r=>r.stdout),['one','two']);
  const cases=[
    {toolId:'ngspice',mainFile:'RC.cir',content:'RC step\nV1 in 0 PULSE(0 1 0 1n 1n 10m 20m)\nR1 in out 1k\nC1 out 0 1u\n.tran 10u 5m\n.end\n'},
    {toolId:'openscad',mainFile:'cube.scad',content:'cube([1,2,3]);\n'},
    {toolId:'openmodelica',mainFile:'Decay.mo',modelName:'Decay',content:'model Decay\nReal x(start=1,fixed=true);\nequation der(x)=-x;\nend Decay;\n',simulation:{startTime:0,stopTime:1,numberOfIntervals:100,tolerance:1e-6}},
  ];
  for(const item of cases){
    if(!status.tools[item.toolId]?.ready){console.log('Not installed:',item.toolId);continue;}
    const {content,...args}=item,sha=createHash('sha256').update(content).digest('hex');
    const result=await runner.run({...args,operation:'simulate',inputHash:sha,jobId:'broker-acceptance',signals:[],sourceFiles:[{path:item.mainFile,content,sha256:sha}]});
    assert.equal(result.success,true,result.diagnostics);assert.equal(result.isolation.isolated,true);
    assert.ok(result.files.length);assert.equal(result.receipt.inputHash,sha);
    if(item.toolId==='openmodelica'){
      const csv=Buffer.from(result.files.find(f=>f.path==='manta_result_res.csv').contentBase64,'base64').toString().trim().split('\n');
      const index=csv[0].replaceAll('"','').split(',').indexOf('x');
      assert.ok(Math.abs(Number(csv.at(-1).split(',')[index])-Math.exp(-1))<1e-4);
    }
    console.log(item.toolId,'actual isolated simulation passed');
  }
  console.log('Broker acceptance passed');
}finally{
  delete process.env.MANTA_ACCEPTANCE_PRIVATE_SENTINEL;
  await fs.rm(one,{recursive:true,force:true});await fs.rm(two,{recursive:true,force:true});await fs.rm(sentinel,{force:true});
}
