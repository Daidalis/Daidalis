import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnBounded,safePath} from '../sandbox.mjs';

export const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
export const SCOPES=['component','build','integration'];
export const TERMINAL=['completed','failed','blocked','cancelled','interrupted'];
export const UPSTREAM_ROOT='5a3bdee6be9a2c67fdf994ae6db56d5c60395302';
export const COMPONENT_FILES={
  'fsw/shared/generic_adcs_utilities.c':'9fd506529dc96b788752f9af2bf547e3b489ae5e243b16505736b2a55eb7f342',
  'fsw/shared/generic_adcs_utilities.h':'3e59990c8997b374ee4491b438b216de32972668485c78795ec48705b23e098c'
};
const harness=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../runners/nos3/quaternion-harness.c');
const gitEnv={PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',LANG:'C'};
export async function git(source,args,signal){const r=await spawnBounded('/usr/bin/git',['-c','core.hooksPath=/dev/null','-C',source,...args],{env:gitEnv,signal,timeoutMs:10000,maxBytes:1500000});if(r.code!==0)throw Error('NOS3 Git inspection failed: '+r.stderr.slice(0,500));return r.stdout;}
export async function inspectSource(workspace,{revision,signal}={}) {
  const root=await fs.realpath(workspace);const commit=(await git(root,['rev-parse','--verify','HEAD^{commit}'],signal)).trim();
  if(revision&&revision!==commit)throw Error('NOS3 revision changed; inspect and submit the exact current commit');
  const tree=await git(root,['ls-tree','-r','HEAD'],signal);const submodules=[];
  async function inspectLinks(repository,treeText,prefix='',depth=0) {
    if(depth>6)throw Error('NOS3 submodule nesting exceeds supported limit');
    for(const line of treeText.split('\n')) {const m=/^160000 commit ([a-f0-9]{40})\t(.+)$/.exec(line);if(!m)continue;if(submodules.length>=200)throw Error('Too many NOS3 submodules');const relative=prefix+m[2],item={path:relative,revision:m[1],available:false,actualRevision:null,dirty:null};
      try {const dir=safePath(root,relative),stat=await fs.stat(path.join(dir,'.git'));if(!stat.isFile()&&!stat.isDirectory())throw Error();item.actualRevision=(await git(dir,['rev-parse','--verify','HEAD^{commit}'],signal)).trim();item.available=item.actualRevision===item.revision;item.dirty=!!(await git(dir,['status','--porcelain','--untracked-files=no'],signal)).trim();}catch{}
      submodules.push(item);
      if(item.available)await inspectLinks(safePath(root,relative),await git(safePath(root,relative),['ls-tree','-r','HEAD'],signal),relative+'/',depth+1);
    }
  }
  await inspectLinks(root,tree);
  if(!tree.includes('\tMakefile')||!submodules.some(x=>x.path==='components/generic_adcs'))throw Error('Selected folder is not a supported NOS3 source repository');
  const component=submodules.find(x=>x.path==='components/generic_adcs');const sourceFiles=[];
  if(component?.available)for(const file of Object.keys(COMPONENT_FILES)){const bytes=await readCommitted(root,component,file,signal);sourceFiles.push({path:component.path+'/'+file,sha256:sha256(bytes),bytes:bytes.length,localExecutionAllowed:sha256(bytes)===COMPONENT_FILES[file]});}
  const dirty=!!(await git(root,['status','--porcelain','--untracked-files=no','--ignore-submodules=all'],signal)).trim();
  const result={schema:'manta-nos3-source-v1',revision:commit,dirty,submodules,sourceFiles,sourceMode:'committed-content-only',missingSubmodules:submodules.filter(x=>!x.available).map(x=>x.path),localComponentReady:component?.available===true&&sourceFiles.length===2&&sourceFiles.every(x=>x.localExecutionAllowed)};
  result.baselineHash=sourceFingerprint(result);return result;
}
export function sourceFingerprint(baseline){return sha256(JSON.stringify({revision:baseline.revision,submodules:baseline.submodules.map(({path,revision})=>({path,revision})),sourceFiles:baseline.sourceFiles.map(({path,sha256})=>({path,sha256}))}));}
export async function readCommitted(root,component,file,signal){const text=await git(safePath(root,component.path),['show',`${component.revision}:${file}`],signal);return Buffer.from(text);}
export async function executeComponent({workspace,dir,baseline,signal,compilerPath='/usr/bin/clang',onLog=()=>{}}) {
  if(!baseline.localComponentReady)return {status:'blocked',reason:'Local component runner only executes the reviewed NOS3 utility source hashes. Missing or changed sources require a configured isolated worker.'};
  if(!fss.existsSync(compilerPath))return {status:'blocked',reason:'Existing C compiler unavailable. No compiler will be installed automatically.'};
  const snapshot=path.join(dir,'source');await fs.mkdir(snapshot,{recursive:true});const component=baseline.submodules.find(x=>x.path==='components/generic_adcs');
  for(const file of Object.keys(COMPONENT_FILES)){const content=await readCommitted(workspace,component,file,signal);if(sha256(content)!==COMPONENT_FILES[file])throw Error('NOS3 source changed during snapshot');await fs.writeFile(path.join(snapshot,path.basename(file)),content);}
  const harnessBytes=await fs.readFile(harness);await fs.writeFile(path.join(snapshot,'quaternion-harness.c'),harnessBytes);
  const executable=path.join(dir,'quaternion-component');const env={PATH:'/usr/bin:/bin',HOME:dir,TMPDIR:dir,LANG:'C',LC_ALL:'C',CLANG_MODULE_CACHE_PATH:path.join(dir,'clang-cache')};
  const version=await spawnBounded(compilerPath,['--version'],{cwd:dir,env,signal,timeoutMs:5000,maxBytes:4000});
  const compileArgs=['-std=c99','-O1','-I',snapshot,path.join(snapshot,'generic_adcs_utilities.c'),path.join(snapshot,'quaternion-harness.c'),'-lm','-o',executable];
  onLog('Compiling pinned upstream NOS3 generic_adcs utility source');
  const compile=await spawnBounded(compilerPath,compileArgs,{cwd:dir,env,signal,timeoutMs:30000,maxBytes:100000});await fs.writeFile(path.join(dir,'build.log'),compile.stdout+compile.stderr);if(compile.code!==0)return {status:'failed',reason:'Component compilation failed',execution:{exitCode:compile.code},compiler:version.stdout.trim()};
  onLog('Executing quaternion scenario sweep against independent Rodrigues matrix oracle');
  const run=await spawnBounded(executable,[],{cwd:dir,env,signal,timeoutMs:10000,maxBytes:100000});await fs.writeFile(path.join(dir,'simulation.log'),run.stdout+run.stderr);
  let metrics;try{metrics=JSON.parse(run.stdout);}catch{throw Error('Component produced no valid verification result');}
  if(metrics.schema!=='manta-nos3-component-results-v1'||metrics.cases!==324||!Number.isFinite(metrics.compositionMaxError)||!Number.isFinite(metrics.signMaxError)||!Number.isFinite(metrics.inverseMaxError))throw Error('Invalid component result metrics');
  const checks=[{id:'V-ROTATION',requirement:'R-ROTATION',modelElement:'RotationComposition',criterion:'Quaternion rotation composition equals independently calculated passive Rodrigues matrices across 324 deterministic scenarios',passed:metrics.compositionMaxError<1e-12,actual:metrics.compositionMaxError,limit:1e-12,unit:'max absolute vector component error'},
    {id:'V-SIGN',requirement:'R-SIGN',modelElement:'QuaternionSignEquivalence',criterion:'q and -q produce identical vector rotations',passed:metrics.signMaxError<1e-12,actual:metrics.signMaxError,limit:1e-12,unit:'max absolute vector component error'},
    {id:'V-INVERSE',requirement:'R-ROTATION',criterion:'QTxV reverses QxV',passed:metrics.inverseMaxError<1e-12,actual:metrics.inverseMaxError,limit:1e-12,unit:'max absolute vector component error'}];
  return {status:run.code===0&&checks.every(x=>x.passed)?'completed':'failed',passed:run.code===0&&checks.every(x=>x.passed),scope:'component',fullNos3Simulation:false,hardwareValidation:false,modelBehaviorExecuted:false,metrics,checks,pendingRequirements:[{id:'R-SENSOR-SEPARATION',modelElement:'SensorTruthSeparation',status:'not-tested',reason:'This runner calls upstream quaternion primitives; it does not execute star-tracker telemetry parsing or substitute dynamics truth for measurements.'}],compiler:version.stdout.trim(),execution:{compileExitCode:compile.code,exitCode:run.code},harnessHash:sha256(harnessBytes),limitations:['Real upstream C component execution with a declared mathematical oracle; not full NOS3/cFS/42 integration.','Actual sensor-frame configuration, telemetry transport, timing, fault responses and hardware remain untested.','Dirty working-tree changes are not executed: source bytes come from the pinned Git commits.']};
}
export async function evidenceFiles(dir) {const files=[];async function walk(at,prefix=''){for(const e of await fs.readdir(at,{withFileTypes:true})){if(e.isSymbolicLink())throw Error('Evidence symlink rejected');const rel=prefix+e.name;if(e.isDirectory()){if(['clang-cache','checkout','home','tmp'].includes(e.name))continue;await walk(path.join(at,e.name),rel+'/');}else if(e.isFile()&&!['manifest.json','quaternion-component'].includes(rel)){const file=path.join(at,e.name),stat=await fs.stat(file);if(stat.size<=1500000){const content=await fs.readFile(file);files.push({file:rel,sha256:sha256(content),bytes:content.length});}}}}await walk(dir);return files;}
