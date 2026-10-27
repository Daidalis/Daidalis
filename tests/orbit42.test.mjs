import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createOrbit42Service} from '../server/orbit42.mjs';
import {createOrbit42Runtime,ORBIT42_TOOL_DEFINITIONS} from '../server/orbit42-tools.mjs';

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const BINARY='a56f32e7a0ce8ec7e26749a5fb7aee673f24a190f444fc85083b3c63bd2b6c31';
const WORKER='56c6934a4f27dda30a5e040e18b27d65f140d7aab8b51563f0cbaffaedc75163';
const workerPath=fileURLToPath(new URL('../vm/worker/orbit42-run.py',import.meta.url));
const templatesProbe=spawnSync('/usr/bin/python3',['-c',`import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('orbit42_worker',sys.argv[1])
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
print(json.dumps([{'path':name,'sha256':digest} for name,digest in sorted(mod.EXPECTED_TEMPLATE_SHA256.items())]))`,workerPath],{encoding:'utf8',timeout:10000,env:{PATH:'/usr/bin:/bin',PYTHONDONTWRITEBYTECODE:'1',LC_ALL:'C'}});
assert.equal(templatesProbe.status,0,templatesProbe.stderr||templatesProbe.stdout);
const PINNED_TEMPLATES=JSON.parse(templatesProbe.stdout);
const model=JSON.stringify({schema:'manta-orbit42-v1',source:{repository:'nasa-itc/42',revision:'dev_20260403'},scenario:{epochUtc:'2024-08-04T00:00:00Z',leapSeconds:37,periapsisAltitudeKm:400,apoapsisAltitudeKm:400,inclinationDeg:52,raanDeg:0,argumentOfPeriapsisDeg:0,trueAnomalyDeg:20,durationSeconds:600,stepSeconds:0.1,outputIntervalSeconds:60},assumptions:['A bounded reference orbit']},null,2)+'\n';
function native(request){
  const receipt={schema:'manta-orbit42-receipt-v1',jobId:request.jobId,inputHash:request.inputHash,sourceFile:{path:request.sourceFile.path,sha256:request.inputHash},tool:{id:'nasa-42',repository:'nasa-itc/42',revision:'dev_20260403',binarySha256:BINARY},adapterSha256:WORKER,assets:{fileCount:220,treeSha256:'d7d68ea74816d4c0bd78120adf02a982832727d34806c210b7b693f0028a8c48',sourceIntegritySha256:'fadfb8bd140f81a0488f4668ccb4e19f785bf12349fe42dcf872856ebf1c485d',assetManifestSha256:'de831c50047b3376e1fb5400bf062fc197b5edd536266a91172080ad3af19a61'},templateFiles:PINNED_TEMPLATES,epochUtc:'2024-08-04T00:00:00Z',leapSecondsAssumed:37,rawOutputs:['time.42','PosN.42','VelN.42','PosW.42'].map(name=>({path:name,sha256:hash(name+'\n')}))};
  const required=['trajectory.csv','report.md','receipt.json','time.42','PosN.42','VelN.42','PosW.42','Inp_Sim.txt','Orb_LEO.txt','native-42.log'];
  const files=required.map(name=>{const bytes=Buffer.from(name==='receipt.json'?JSON.stringify(receipt):name==='trajectory.csv'?'time_seconds,x_n_m\n0,6778145\n':name+'\n');return {path:name,sha256:hash(bytes),contentBase64:bytes.toString('base64'),mimeType:name.endsWith('.json')?'application/json':name.endsWith('.csv')?'text/csv':'text/plain'};});
  return {schema:'manta-orbit42-native-response-v1',success:true,exitCode:0,tool:receipt.tool,receipt,metrics:{samples:2,checks:[{id:'sample',passed:true}]},files};
}
function fakeExecute(file,args,options={}){
  if(file!=='/bin/sh')throw Error('Only managed VM helper expected');
  if(args[0].endsWith('/vm-status.sh'))return {code:0,stdout:JSON.stringify({state:'running'}),stderr:''};
  if(!args[0].endsWith('/vm-exec.sh'))throw Error('Unexpected helper');
  const command=args[1];
  if(command.startsWith('test -x'))return {code:0,stdout:`${BINARY}  /srv/manta/42/42\n`,stderr:''};
  if(command.startsWith('mkdir -p /srv/manta/orbit42'))return {code:0,stdout:`${WORKER}  adapter.py\n`,stderr:''};
  if(command.startsWith('python3 /srv/manta/orbit42/adapter-')&&!command.includes('--cancel'))return {code:0,stdout:JSON.stringify(native(JSON.parse(options.input))),stderr:''};
  if(command.includes('--cancel'))return {code:0,stdout:'{}',stderr:''};
  throw Error('Unexpected VM command: '+command);
}

test('orbit model CAS, isolated job tool lifecycle, retained evidence and project scoping',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-orbit42-test-'));
  const ws=path.join(root,'project'),dataDir=path.join(root,'data'),vmRoot=path.join(root,'vm');
  await fs.mkdir(ws);
  const artifacts=[];
  const store={workspace(id){assert.ok(['p','other'].includes(id));return ws;},add(kind,value){assert.equal(kind,'artifacts');artifacts.push(value);}};
  const events=[];
  let corruptTemplate=false;
  const scopedExecute=(file,args,options)=>{
    const output=fakeExecute(file,args,options);
    if(corruptTemplate&&args[1]?.startsWith('python3 /srv/manta/orbit42/adapter-')&&!args[1].includes('--cancel')){
      const response=JSON.parse(output.stdout);
      response.receipt.templateFiles[0].sha256='b'.repeat(64);
      return {...output,stdout:JSON.stringify(response)};
    }
    return output;
  };
  const create=()=>createOrbit42Service({dataDir,store,vmRoot,execute:scopedExecute,stageBundle:async()=>({changed:0}),emit:event=>events.push(event)});
  await fs.mkdir(path.join(vmRoot,'host'),{recursive:true});
  await fs.writeFile(path.join(vmRoot,'host','vm-exec.sh'),'#!/bin/sh\n');
  await fs.writeFile(path.join(vmRoot,'host','vm-status.sh'),'#!/bin/sh\n');
  const service=await create();
  const approved=[];
  const runtime=createOrbit42Runtime({orbit42Jobs:service,authorizeMutation:async name=>approved.push(name),assertWriteOwnership:async()=>{}});
  const ctx={projectId:'p',threadId:'thread',runId:'run',signal:new AbortController().signal};
  try{
    assert.equal(ORBIT42_TOOL_DEFINITIONS.length,7);
    const catalog=await runtime.execute('orbit42_catalog',{},ctx);
    assert.equal(catalog.environment.ready,true);
    assert.equal(catalog.modelContract.schema,'manta-orbit42-v1');
    assert.deepEqual(catalog.modelContract.referenceExample.scenario,JSON.parse(model).scenario);
    assert.equal(catalog.modelContract.limits.maximumIntegrationSteps,20000);
    const saved=await runtime.execute('save_orbit42_model',{path:'models/Orbit.orbit42.json',content:model,expectedHash:null},ctx);
    assert.equal(saved.sha256,hash(model));
    assert.equal((await runtime.execute('read_orbit42_model',{path:saved.path},ctx)).content,model);
    await assert.rejects(runtime.execute('save_orbit42_model',{path:saved.path,content:model,expectedHash:null},ctx),{code:'REVISION_CONFLICT'});
    await assert.rejects(runtime.execute('submit_orbit42_job',{path:saved.path,expectedHash:'0'.repeat(64)},ctx),{code:'REVISION_CONFLICT'});
    const queued=await runtime.execute('submit_orbit42_job',{path:saved.path,expectedHash:saved.sha256},ctx);
    assert.match(queued.jobId,/^orbit42_[a-f0-9]{32}$/);
    const done=await runtime.execute('wait_orbit42_job',{jobId:queued.jobId},ctx);
    assert.equal(done.status,'completed');
    assert.equal(done.result.integrity.verified,true);
    assert.equal(done.result.passed,true);
    assert.equal(done.result.frame,'42 Earth-centered N frame; no certified ITRF/J2000 transform');
    assert.ok(done.result.artifacts.some(item=>item.path===done.result.trajectoryPath));
    assert.ok(done.result.artifacts.some(item=>item.path.endsWith('/PosW.42')));
    corruptTemplate=true;
    const forged=await runtime.execute('submit_orbit42_job',{path:saved.path,expectedHash:saved.sha256},ctx);
    const rejected=await runtime.execute('wait_orbit42_job',{jobId:forged.jobId},ctx);
    assert.equal(rejected.status,'failed');
    assert.match(rejected.result.diagnostics,/Native 42 receipt or sanity checks/);
    corruptTemplate=false;
    assert.ok(artifacts.length>=10);
    assert.deepEqual([...new Set(approved)],['save_orbit42_model','submit_orbit42_job']);
    await assert.rejects(service.result({projectId:'other',jobId:queued.jobId}),/does not belong/);
    const reopened=await create();
    assert.equal((await reopened.result({projectId:'p',jobId:queued.jobId})).integrity.verified,true);
    await reopened.close();
    await fs.appendFile(path.join(ws,done.result.trajectoryPath),'tamper\n');
    const tampered=await service.result({projectId:'p',jobId:queued.jobId});
    assert.equal(tampered.integrity.verified,false);
    assert.match(tampered.integrity.reason,/hash mismatch/);
    assert.ok(events.some(event=>event.type==='orbit42.completed'));
  }finally{await service.close();await fs.rm(root,{recursive:true,force:true});}
});

test('isolated Orbit 42 restarts only its prepared fixed VM and rejects a changed native binary',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-orbit42-cold-test-'));
  const ws=path.join(root,'project'),dataDir=path.join(root,'data'),vmRoot=path.join(root,'vm');
  await fs.mkdir(ws);await fs.mkdir(path.join(vmRoot,'host'),{recursive:true});await fs.mkdir(path.join(vmRoot,'state'));
  for(const relative of ['state/config.json','state/ubuntu.raw','host/manta-vm','host/vm-start.sh','host/vm-status.sh','host/vm-exec.sh'])await fs.writeFile(path.join(vmRoot,relative),'prepared\n');
  const calls=[];let running=false,changedBinary=false;
  const execute=(file,args,options={})=>{
    assert.equal(file,'/bin/sh');calls.push({helper:path.basename(args[0]),command:args[1]||null});
    if(args[0].endsWith('/vm-status.sh'))return {code:0,stdout:JSON.stringify({state:running?'running':'stopped'}),stderr:''};
    if(args[0].endsWith('/vm-start.sh')){running=true;return {code:0,stdout:'started',stderr:''};}
    if(args[0].endsWith('/vm-exec.sh')&&args[1]?.startsWith('test -x')&&changedBinary)return {code:0,stdout:'0'.repeat(64)+'  /srv/manta/42/42\n',stderr:''};
    return fakeExecute(file,args,options);
  };
  const store={workspace(id){assert.equal(id,'p');return ws;},add(){}};
  const service=await createOrbit42Service({dataDir,store,vmRoot,execute,stageBundle:async()=>({changed:0})});
  try{
    const saved=await service.saveModel({projectId:'p',path:'models/Cold.orbit42.json',content:model,expectedHash:null});
    const first=await service.submit({projectId:'p',path:saved.path,expectedHash:saved.sha256},{threadId:'thread',runId:'run'});
    const completed=await service.wait({projectId:'p',jobId:first.jobId});
    assert.equal(completed.status,'completed');
    assert.equal(completed.result.integrity.verified,true);
    assert.equal(calls.filter(call=>call.helper==='vm-start.sh').length,1);
    assert.equal(calls.some(call=>call.helper==='vm-prepare.sh'||call.command?.includes('prepare-native')||call.command?.includes('geospatial')),false);

    running=false;changedBinary=true;
    const nativeCallsBefore=calls.filter(call=>call.command?.startsWith('python3 /srv/manta/orbit42/adapter-')).length;
    const second=await service.submit({projectId:'p',path:saved.path,expectedHash:saved.sha256},{threadId:'thread',runId:'run'});
    const rejected=await service.wait({projectId:'p',jobId:second.jobId});
    assert.equal(rejected.status,'failed');
    assert.match(rejected.result.diagnostics,/pinned binary/);
    assert.equal(calls.filter(call=>call.helper==='vm-start.sh').length,2);
    assert.equal(calls.filter(call=>call.command?.startsWith('python3 /srv/manta/orbit42/adapter-')).length,nativeCallsBefore);
    const catalog=await service.catalog({projectId:'p'});
    assert.equal(catalog.environment.ready,false);
    assert.equal(catalog.environment.state,'blocked');
  }finally{await service.close();await fs.rm(root,{recursive:true,force:true});}
});

test('pinned native 42 template inventory rejects edited and added files before execution',()=>{
  const worker=fileURLToPath(new URL('../vm/worker/orbit42-run.py',import.meta.url));
  const script=`import importlib.util,hashlib,pathlib,sys,tempfile
spec=importlib.util.spec_from_file_location('orbit42_worker',sys.argv[1])
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
assert len(mod.EXPECTED_TEMPLATE_SHA256)==21
assert len(mod.EXPECTED_ASSET_SHA256)==220
assert mod.digest(__import__('json').dumps(mod.EXPECTED_ASSET_SHA256,sort_keys=True,separators=(',',':')).encode())==mod.EXPECTED_ASSET_TREE_SHA256
with tempfile.TemporaryDirectory() as temporary:
    root=pathlib.Path(temporary)
    (root/'A.txt').write_text('reviewed')
    (root/'B.txt').write_text('unchanged')
    expected={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in ('A.txt','B.txt')}
    assert len(mod.verified_templates(root,expected))==2
    (root/'A.txt').write_text('tampered')
    try: mod.verified_templates(root,expected)
    except ValueError as error: assert 'hash mismatch' in str(error)
    else: raise AssertionError('Changed template was accepted')
    (root/'A.txt').write_text('reviewed')
    (root/'C.txt').write_text('added')
    try: mod.verified_templates(root,expected)
    except ValueError as error: assert 'inventory mismatch' in str(error)
    else: raise AssertionError('Added template was accepted')
with tempfile.TemporaryDirectory() as temporary:
    root=pathlib.Path(temporary)
    (root/'Model').mkdir(); (root/'World').mkdir()
    (root/'Model'/'A.obj').write_text('reviewed geometry')
    (root/'World'/'B.txt').write_text('reviewed world')
    expected={item.relative_to(root).as_posix():hashlib.sha256(item.read_bytes()).hexdigest() for item in root.rglob('*') if item.is_file()}
    assert mod.verified_assets(root,expected)['fileCount']==2
    (root/'World'/'B.txt').write_text('tampered world')
    try: mod.verified_assets(root,expected)
    except ValueError as error: assert 'hash mismatch' in str(error)
    else: raise AssertionError('Changed asset was accepted')
    (root/'World'/'B.txt').write_text('reviewed world')
    (root/'Model'/'C.obj').write_text('extra')
    try: mod.verified_assets(root,expected)
    except ValueError as error: assert 'inventory mismatch' in str(error)
    else: raise AssertionError('Added asset was accepted')
print('native template and asset tamper guards passed')`;
  const run=spawnSync('/usr/bin/python3',['-c',script,worker],{encoding:'utf8',timeout:10000,env:{PATH:'/usr/bin:/bin',PYTHONDONTWRITEBYTECODE:'1',LC_ALL:'C'}});
  assert.equal(run.status,0,run.stderr||run.stdout);
  assert.match(run.stdout,/template and asset tamper guards passed/);
});
