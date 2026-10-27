import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {executeLocalVm,stageManagedWorkerBundle} from './local-linux-vm.mjs';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const HASH=/^[a-f0-9]{64}$/;
const JOB=/^[A-Za-z0-9_-]{8,100}$/;
const abortError=()=>Object.assign(Error('Native STF operation cancelled'),{name:'AbortError'});
/** Fixed application-owned NOS3 recipe; model C and all mission processes stay inside guest bubblewrap. */
export function createStfLowPowerRunner({vmRoot,execute=executeLocalVm}={}){
 if(typeof vmRoot!=='string'||!path.isAbsolute(vmRoot))throw Error('Native STF runner requires a fixed absolute managed VM root');
 const root=path.resolve(vmRoot),controllers=new Set(),jobs=new Set();let closed=false,preparing;
 async function helper(command,options={}){if(closed)throw Error('Native STF runner is closed');const script=path.join(root,'host/vm-exec.sh'),stat=await fs.lstat(script);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Managed VM helper must be a regular file');return execute('/bin/sh',[script,command],{cwd:root,timeoutMs:300000,maxOutputBytes:32*1024*1024,maxTotalBytes:40*1024*1024,...options});}
 function decode(output){if(output.code!==0)throw Error(('Native STF guest helper failed: '+(output.stderr||output.stdout||output.code)).slice(-5000));try{return JSON.parse(output.stdout);}catch{throw Error('Native STF helper did not return a structured execution receipt');}}
 async function status(){try{const result=decode(await helper('python3 /srv/manta/stf-tools/stf-low-power-run.py --status',{timeoutMs:15000}));if(result.prepareRecipeSha256!==sha(await fs.readFile(path.join(root,'worker/stf-low-power-prepare.py'))))result.ready=false;return {...result,id:'nos3-stf',available:result.ready===true,state:result.ready?'ready':'not-prepared',isolated:true,hostGlobalChanges:false};}catch(error){return {id:'nos3-stf',available:false,ready:false,state:'unavailable',reason:error.message,isolated:true,hostGlobalChanges:false};}}
 async function stage({signal}={}){
  const files=[];for(const name of ['stf-low-power-run.py','stf-low-power-prepare.py','stf-low-power-campaign.py']){const source=path.join(root,'worker',name),stat=await fs.lstat(source);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>200000)throw Error('Invalid managed STF script');const content=await fs.readFile(source,'utf8');files.push({name,content,sha256:sha(content)});}
  const code="import sys,json,pathlib,hashlib,os; data=json.load(sys.stdin); root=pathlib.Path('/srv/manta/stf-tools'); root.mkdir(exist_ok=True,mode=448)\nfor item in data['files']:\n name=item['name']\n if name not in ['stf-low-power-run.py','stf-low-power-prepare.py','stf-low-power-campaign.py'] or hashlib.sha256(item['content'].encode()).hexdigest()!=item['sha256']:raise RuntimeError('Managed script integrity mismatch')\n target=root/name; temporary=root/(name+'.tmp'); temporary.write_text(item['content']); temporary.chmod(448); os.replace(temporary,target)\nprint('{}')";
  const encoded=Buffer.from(code).toString('base64');const command='python3 -c \'exec(__import__("base64").b64decode("'+encoded+'"))\'';const result=await helper(command,{input:JSON.stringify({files}),signal,timeoutMs:30000});if(result.code!==0)throw Error(('STF private script staging failed: '+result.stderr).slice(-3000));
 }
 async function ensureVm({signal,onLog}){
  async function host(name,timeoutMs){const file=path.join(root,'host',name),info=await fs.lstat(file);if(!info.isFile()||info.isSymbolicLink())throw Error('Invalid managed VM helper');return execute('/bin/sh',[file],{cwd:root,signal,onLog,timeoutMs,maxOutputBytes:1000000,maxTotalBytes:4000000});}
  const state=decode(await host('vm-status.sh',15000));if(state.state!=='running'){onLog('Preparing and starting Manta isolated Linux VM.');for(const [name,timeout]of [['vm-prepare.sh',1800000],['vm-start.sh',240000]]){const result=await host(name,timeout);if(result.code!==0)throw Error(('Managed VM preparation failed: '+(result.stderr||result.stdout)).slice(-4000));}}
  const base=await helper('test -f /srv/manta/nos3/fsw/cfe/CMakeLists.txt',{signal,timeoutMs:15000});if(base.code!==0){onLog('Preparing pinned native NOS3 prerequisites inside Linux.');await stageManagedWorkerBundle(root,{signal});const native=await helper('bash /mnt/manta-transfer/worker/prepare-native.sh',{signal,onLog,timeoutMs:1800000});if(native.code!==0)throw Error(('Native NOS3 prerequisite preparation failed: '+(native.stderr||native.stdout)).slice(-4000));}
 }
 async function prepare({signal,onLog=()=>{}}={}){
  if(closed)throw Error('Native STF runner is closed');if(signal?.aborted)throw signal.reason||abortError();
  if(!preparing){preparing=(async()=>{await ensureVm({signal,onLog});await stage({signal});const current=await status();if(current.ready)return current;onLog('Preparing actual LC/SC/EPS/MGR/SAMPLE and 42 in the isolated Linux guest.');const built=await helper('python3 /srv/manta/stf-tools/stf-low-power-prepare.py',{signal,onLog,timeoutMs:900000});if(built.code!==0)throw Error(('Native STF preparation failed: '+(built.stderr||built.stdout||built.code)).slice(-5000));const result=await status();if(!result.ready)throw Error(result.reason||'Native STF readiness was not proven');return result;})().finally(()=>{preparing=null;});preparing.catch(()=>{});}return preparing;
 }
 function normalize(args){
  if(!args||!JOB.test(args.jobId||'')||!HASH.test(args.inputHash||''))throw Error('Native STF requires a bounded job identifier and exact input hash');if(!['check','simulate'].includes(args.operation))throw Error('Native STF supports check or simulate');
  if(!Array.isArray(args.sourceFiles)||args.sourceFiles.length<2||args.sourceFiles.length>20)throw Error('Native STF requires a manifest and original/modified C table sources');let bytes=0;const seen=new Set();
  const sourceFiles=args.sourceFiles.map(source=>{if(!source||typeof source.path!=='string'||! /^[A-Za-z0-9_./ -]{1,240}$/.test(source.path)||source.path.startsWith('/')||source.path.split('/').some(part=>!part||part==='.'||part==='..')||! /\.(stf\.json|c)$/.test(source.path)||seen.has(source.path)||typeof source.content!=='string')throw Error('Invalid native STF source path');seen.add(source.path);bytes+=Buffer.byteLength(source.content);if(Buffer.byteLength(source.content)>2000000||bytes>5000000||source.sha256!==sha(source.content))throw Error('Native STF source integrity mismatch');return {path:source.path,content:source.content,sha256:source.sha256};});
  if(sourceFiles.filter(source=>source.path.endsWith('.stf.json')).length!==1)throw Error('One native STF manifest required');const parameters=args.parameters||{};if(!parameters||typeof parameters!=='object'||Array.isArray(parameters)||Object.keys(parameters).some(key=>key!=='applyProtection')||parameters.applyProtection!==undefined&&typeof parameters.applyProtection!=='boolean')throw Error('Only boolean applyProtection is supported');
  return {jobId:args.jobId,inputHash:args.inputHash,operation:args.operation,sourceFiles,parameters:{applyProtection:parameters.applyProtection??true}};
 }
 async function run(args,{signal,onLog=()=>{}}={}){
  const request=normalize(args);if(signal?.aborted)throw signal.reason||abortError();await prepare({signal,onLog});if(signal?.aborted)throw signal.reason||abortError();
  const controller=new AbortController();controllers.add(controller);jobs.add(request.jobId);const abort=()=>controller.abort(signal.reason||abortError());signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  try{const response=decode(await helper('python3 /srv/manta/stf-tools/stf-low-power-run.py',{input:JSON.stringify(request),signal:controller.signal,timeoutMs:480000}));if(!Number.isInteger(response.exitCode)||typeof response.success!=='boolean'||typeof response.tool?.version!=='string'||!Array.isArray(response.files)||response.receipt?.inputHash!==request.inputHash||JSON.stringify(response.receipt.sourceFiles)!==JSON.stringify(request.sourceFiles.map(({path,sha256})=>({path,sha256}))))throw Error('Native STF execution receipt differs from pinned inputs');onLog(String(response.diagnostics||'').slice(-5000));return response;
  }catch(error){if(controller.signal.aborted){await helper('python3 /srv/manta/stf-tools/stf-low-power-run.py --cancel '+request.jobId,{timeoutMs:20000}).catch(()=>{});throw controller.signal.reason||abortError();}throw error;
  }finally{controllers.delete(controller);jobs.delete(request.jobId);signal?.removeEventListener('abort',abort);}
 }
 return {status,prepare,run,async close(){await Promise.allSettled([...jobs].map(jobId=>helper('python3 /srv/manta/stf-tools/stf-low-power-run.py --cancel '+jobId,{timeoutMs:20000})));for(const controller of controllers)controller.abort(abortError());if(preparing)await preparing.catch(()=>{});closed=true;}};
}
