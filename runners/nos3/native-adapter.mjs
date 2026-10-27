import fs from 'node:fs/promises';
import path from 'node:path';
import {sha256,sourceFingerprint} from '../../server/nos3/core.mjs';
import {safePath,spawnBounded} from '../../server/sandbox.mjs';

// Operator-configured adapter for the disposable Linux guest. Models cannot
// choose executables, source directories or provisioning commands.
export function createNativeNos3Adapter({sourceRoot,toolRoot,workRoot='/srv/manta/nos3',expectedInventoryHash,execute=spawnBounded}={}) {
  if(![sourceRoot,toolRoot,workRoot].every(x=>typeof x==='string'&&path.isAbsolute(x)))throw Error('Native worker requires absolute, administrator-selected paths');
  async function validateSource(baseline,signal) {
    if(signal?.aborted)throw Error('Cancelled');
    if(sourceFingerprint(baseline)!==baseline.baselineHash)throw Error('Inconsistent source baseline');
    const raw=await fs.readFile(path.join(sourceRoot,'integrity.json'),'utf8'),inventory=JSON.parse(raw);
    if(!/^[a-f0-9]{64}$/.test(expectedInventoryHash||'')||sha256(raw)!==expectedInventoryHash)throw Error('Native source inventory differs from its provisioned integrity receipt');
    const manifest=JSON.parse(await fs.readFile(path.join(sourceRoot,'manifest.json'),'utf8'));
    if(inventory.schema!=='manta-nos3-native-source-v1'||inventory.manifestSha256!==sha256(JSON.stringify(manifest))||!Array.isArray(inventory.files)||!inventory.files.length)throw Error('Native source inventory is missing or inconsistent');
    const root=manifest.find(x=>x.repo==='nasa/nos3'&&!x.path);
    if(root?.revision!==baseline.revision)throw Error('Native NOS3 root revision mismatch');
    for(const entry of manifest.filter(x=>x.path&&x.path!=='42')) {
      const requested=baseline.submodules.find(x=>x.path===entry.path);
      if(!requested||requested.revision!==entry.revision)throw Error('Native source/submodule pin mismatch: '+entry.path);
    }
    const observed=new Map();let verifiedFiles=0,verifiedBytes=0;
    // GUI assets and documentation are not inputs to this headless mission.
    // Active physics assets are verified against the pinned per-file inventory
    // in the guest readiness receipt instead of rereading unused cloud files.
    const usedFiles=inventory.files.filter(e=>e.path.startsWith('nos3/')?!e.path.startsWith('nos3/docs/'):e.path.startsWith('packages/')||['42/Source/','42/Include/','42/Kit/'].some(prefix=>e.path.startsWith(prefix))||e.path==='42/Makefile');
    for(const entry of usedFiles) {
      if(signal?.aborted)throw Error('Cancelled');
      const file=safePath(sourceRoot,entry.path),stat=await fs.lstat(file);
      if(!stat.isFile()||stat.size!==entry.bytes||sha256(await fs.readFile(file))!==entry.sha256)throw Error('Native source integrity mismatch: '+entry.path);
      observed.set(entry.path,entry.sha256);verifiedFiles++;verifiedBytes+=stat.size;
    }
    for(const entry of baseline.sourceFiles)if(observed.get('nos3/'+entry.path)!==entry.sha256)throw Error('Native inspected source hash mismatch: '+entry.path);
    return {manifestSha256:inventory.manifestSha256,inventorySha256:sha256(raw),rootRevision:root.revision,archives:manifest,verifiedFiles,verifiedBytes,unusedFilesExcluded:inventory.files.length-verifiedFiles,physicsAssetVerification:'Pinned guest readiness receipt; active Model/World files checked individually',scope:'Task-specific native mission: cFE/OSAL/PSP, CI/TO/SCH, ADCS, star tracker, NOSengine and 42. Unrelated default devices and ground GUIs are excluded.'};
  }
  const adapter=async({job,dir,signal,maxJobMs})=>{
    if(process.platform!=='linux')throw Error('Native NOS3 adapter must execute inside Linux');
    if(!['build','integration'].includes(job.scope))return {scope:job.scope,status:'blocked',passed:false,reason:'This native worker handles build and integration; component checks use the separate reviewed component runner.'};
    const provenance=await validateSource(job.baseline,signal);
    await fs.writeFile(path.join(dir,'native-source.json'),JSON.stringify(provenance,null,2));
    const checkArgs=[path.join(toolRoot,'worker/native-readiness.py'),'--check'];
    const readiness=await execute('/usr/bin/python3',checkArgs,{cwd:workRoot,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},signal,timeoutMs:120000,maxBytes:10000});
    await fs.writeFile(path.join(dir,'native-readiness.log'),JSON.stringify({argv:['/usr/bin/python3',...checkArgs],exitCode:readiness.code})+'\n'+readiness.stdout+readiness.stderr);
    if(readiness.code!==0)throw Error('Native build or active physics asset readiness receipt is stale; preserving the runtime for review');
    const native=path.join(dir,'native');await fs.mkdir(native,{recursive:true});await fs.mkdir(path.join(dir,'home'),{recursive:true});await fs.mkdir(path.join(dir,'tmp'),{recursive:true});
    const commands=job.scope==='integration'
      ? [['/usr/bin/python3',path.join(toolRoot,'verification/verify_all.py'),'--out',native]]
      : [['/bin/bash',path.join(toolRoot,'nos3-plan/build_native.sh'),workRoot]];
    const executions=[{argv:['/usr/bin/python3',...checkArgs],exitCode:readiness.code,log:'native-readiness.log'}];
    for(let i=0;i<commands.length;i++) {
      const argv=commands[i],r=await execute(argv[0],argv.slice(1),{cwd:workRoot,env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:path.join(dir,'home'),TMPDIR:path.join(dir,'tmp'),LANG:'C.UTF-8',MANTA_NOS3_JOB_DIR:dir,MANTA_NOS3_INPUT:path.join(dir,'input.json')},signal,killGraceMs:15000,timeoutMs:Math.min(job.timeoutMs,maxJobMs),maxBytes:1000000});
      const log=`step-${i}.log`;
      await fs.writeFile(path.join(dir,log),JSON.stringify({argv,exitCode:r.code})+'\n'+r.stdout+r.stderr);
      executions.push({argv,exitCode:r.code,log});
      if(r.code!==0&&(job.scope!=='integration'||r.code!==1||!await fs.stat(path.join(native,'verification.json')).then(x=>x.isFile(),()=>false)))throw Error('Native NOS3 execution failed; inspect '+log);
    }
    let report;
    if(job.scope==='integration')report=JSON.parse(await fs.readFile(path.join(native,'verification.json'),'utf8'));
    else {
      const binaries=['fsw/build/exe/cpu1/core-cpu1','sims/build/bin/nos3-single-simulator','../42/42'];
      const hashes=await Promise.all(binaries.map(async file=>({path:file,sha256:sha256(await fs.readFile(path.resolve(workRoot,file)))})));
      report={schema:'manta-nos3-verification-v1',scope:'build',passed:true,fullNos3Simulation:false,checks:hashes.map(x=>({id:'BUILD-'+path.basename(x.path),criterion:'Native Linux ARM64 executable exists after successful upstream build',passed:true,sha256:x.sha256})),binaries:hashes,pendingRequirements:[{id:'R-LIVE-CHAIN',status:'not-tested',reason:'Build-only job does not execute the simulator.'}]};
    }
    if(report.schema!=='manta-nos3-verification-v1'||report.scope!==job.scope||!Array.isArray(report.checks)||!report.checks.length||report.checks.some(x=>typeof x.passed!=='boolean'||!x.id||!x.criterion)||report.passed!==report.checks.every(x=>x.passed))throw Error('Invalid native verification report');
    if(job.scope==='integration'&&report.passed&&(report.fullNos3Simulation!==true||!report.telemetryFiles?.length))throw Error('Native integration did not identify live telemetry');
    let evidenceBytes=0;
    for(const rel of report.telemetryFiles||[]) {
      const source=safePath(native,rel),stat=await fs.lstat(source);
      if(!stat.isFile()||stat.size===0||stat.size>1000000)throw Error('Missing or oversized native telemetry: '+rel);
      evidenceBytes+=stat.size;if(evidenceBytes>1700000)throw Error('Native telemetry exceeds bounded transfer; retain full capture in VM and provide complete bounded verification samples');
      const target=safePath(dir,'telemetry/'+rel,{write:true});await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(source,target);
    }
    if(report.passed){const argv=['/usr/bin/python3',path.join(toolRoot,'worker/native-readiness.py'),'--record'];const r=await execute(argv[0],argv.slice(1),{cwd:workRoot,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},signal,timeoutMs:120000,maxBytes:10000});await fs.writeFile(path.join(dir,'runtime-restoration.log'),JSON.stringify({argv,exitCode:r.code})+'\n'+r.stdout+r.stderr);executions.push({argv,exitCode:r.code,log:'runtime-restoration.log'});if(r.code!==0)throw Error('Verified runtime could not be signed off for reuse; inspect runtime-restoration.log');}
    await fs.writeFile(path.join(dir,'verification.json'),JSON.stringify(report,null,2));
    return {...report,pendingRequirements:report.pendingRequirements||(['R-HARDWARE','R-TIMING','R-ALL-DEVICES','R-STALE-DATA'].map((id,i)=>({id,status:'not-tested',reason:(report.pending||[])[i]||'Outside the selected software integration verification scope'}))),status:report.passed?'completed':'failed',executions,sourceProvenance:provenance,hardwareValidation:false,modelBehaviorExecuted:false,environment:'local-isolated-ubuntu-22.04-arm64-vm'};
  };
  adapter.scopes={component:false,build:true,integration:true};
  adapter.validateSource=validateSource;
  return adapter;
}
