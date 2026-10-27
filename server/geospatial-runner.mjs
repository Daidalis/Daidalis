import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {constants as FC} from 'node:fs';
import {executeLocalVm} from './local-linux-vm.mjs';

const HASH=/^[a-f0-9]{64}$/;
const JOB=/^geospatial_[a-f0-9]{32}$/;
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const cancelled=()=>Object.assign(Error('Geospatial job cancelled'),{name:'AbortError'});

/** Fixed GDAL/PROJ command in the managed VM. No model-controlled shell text. */
export function createGeospatialRunner({vmRoot,execute=executeLocalVm,hostPlatform=process.platform,hostArch=process.arch}={}){
  if(typeof vmRoot!=='string'||!path.isAbsolute(vmRoot))throw Error('Geospatial runner requires a fixed absolute VM root');
  const root=path.resolve(vmRoot);let preparing,closed=false;
  const controllers=new Set();
  async function helper(name,args=[],options={}){
    if(closed)throw Error('Geospatial runner is closed');
    const file=path.join(root,'host',name),stat=await fs.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink())throw Error('Managed Linux VM helper must be a regular file');
    return execute('/bin/sh',[file,...args],{cwd:root,timeoutMs:180000,maxOutputBytes:5*1024*1024,maxTotalBytes:8*1024*1024,...options});
  }
  async function command(value,options={}){return helper('vm-exec.sh',[value],options);}
  function parsed(output,label){if(output.code!==0)throw Error((label+': '+(output.stderr||output.stdout||output.code)).slice(-3000));try{return JSON.parse(output.stdout);}catch{throw Error(label+' did not return JSON');}}
  async function sourceScript(name){
    if(!['geospatial-run.py','geospatial-status.py','prepare-geospatial.sh'].includes(name))throw Error('Unknown managed GIS script');
    const file=path.join(root,'worker',name),handle=await fs.open(file,FC.O_RDONLY|FC.O_NOFOLLOW);
    let bytes;
    try{const before=await handle.stat();if(!before.isFile()||before.size>150000)throw Error('Managed GIS script exceeds limit');bytes=await handle.readFile();const after=await handle.stat();if(bytes.length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw Error('Managed GIS script changed during staging');}finally{await handle.close();}
    return bytes;
  }
  async function stageScript(name,{signal}={}){
    const bytes=await sourceScript(name);
    const digest=sha(bytes),target='/srv/manta/geospatial-worker/'+name,temporary=target+'.next-'+crypto.randomUUID().replaceAll('-','');
    const script=`sudo install -d -o manta -g manta -m 0700 /srv/manta/geospatial-worker && umask 077 && cat > ${temporary} && test "$(sha256sum ${temporary} | cut -d ' ' -f 1)" = ${digest} && mv ${temporary} ${target} && test "$(sha256sum ${target} | cut -d ' ' -f 1)" = ${digest} && printf '%s' ${digest}`;
    const staged=await command(script,{input:bytes,signal,timeoutMs:30000});
    if(staged.code!==0||staged.stdout.trim()!==digest)throw Error('Guest-local GIS script staging or digest verification failed: '+String(staged.stderr||staged.stdout).slice(-1500));
    return digest;
  }
  async function status(){
    if(closed)return {ready:false,status:'closed',isolated:true,hostGlobalChanges:false};
    try{
      const runtime=parsed(await helper('vm-status.sh',[],{timeoutMs:15000}),'VM status');
      if(runtime.state!=='running')return {ready:false,status:'not-prepared',reason:'Managed Linux VM is not running',isolated:true,hostGlobalChanges:false};
      const expected=sha(await sourceScript('geospatial-run.py'));
      const statusHash=sha(await sourceScript('geospatial-status.py'));
      const probe=parsed(await command('if test ! -f /srv/manta/geospatial-worker/geospatial-status.py; then printf \'{"ready":false,"reason":"Geospatial status script absent"}\'; elif test "$(sha256sum /srv/manta/geospatial-worker/geospatial-status.py | cut -d " " -f 1)" != '+statusHash+'; then if test ! -f /srv/manta/receipts/geospatial-ready.json; then printf \'{"ready":false,"reason":"Geospatial status script update available before readiness receipt"}\'; else printf \'{"ready":false,"reason":"Managed geospatial status script hash mismatch"}\'; fi; else python3 /srv/manta/geospatial-worker/geospatial-status.py '+expected+'; fi',{timeoutMs:25000}),'GIS status');
      const state=probe.ready?'ready':/absent/.test(probe.reason||'')?'not-prepared':['Reviewed managed worker update available','Geospatial status script update available before readiness receipt'].includes(probe.reason)?'update-available':'blocked';
      return {...probe,status:state,isolated:true,hostGlobalChanges:false};
    }catch(error){return {ready:false,status:'not-prepared',reason:String(error.message).slice(-2000),isolated:true,hostGlobalChanges:false};}
  }
  async function prepare({signal,onLog=()=>{}}={}){
    if(closed)throw Error('Geospatial runner is closed');if(signal?.aborted)throw signal.reason||cancelled();
    if(hostPlatform!=='darwin'||hostArch!=='arm64')throw Error('Managed GIS runner requires Apple Silicon macOS and its private Linux VM');
    if(!preparing){preparing=(async()=>{
      const runtime=parsed(await helper('vm-status.sh',[],{signal,timeoutMs:15000}),'VM status');
      if(runtime.state!=='running'){
        onLog('Preparing Manta isolated Linux VM for GDAL/PROJ.\n');
        for(const [name,timeoutMs] of [['vm-prepare.sh',1800000],['vm-start.sh',240000]]){
          const result=await helper(name,[],{signal,timeoutMs,onLog});if(result.code!==0)throw Error(('Isolated VM preparation failed: '+(result.stderr||result.stdout)).slice(-3000));
        }
      }
      const current=await status();if(current.ready)return current;
      if(!['not-prepared','update-available'].includes(current.status))throw Error('GIS tool integrity check failed; inspect the VM before explicit re-preparation: '+current.reason);
      await stageScript('geospatial-run.py',{signal});
      await stageScript('geospatial-status.py',{signal});
      await stageScript('prepare-geospatial.sh',{signal});
      onLog('Installing exact GDAL/PROJ packages inside the isolated Linux VM.\n');
      const installed=await command('bash /srv/manta/geospatial-worker/prepare-geospatial.sh',{signal,timeoutMs:1800000,onLog});
      if(installed.code!==0)throw Error(('Isolated GIS preparation failed: '+(installed.stderr||installed.stdout)).slice(-4000));
      const ready=await status();if(!ready.ready)throw Error('GDAL/PROJ readiness failed: '+ready.reason);return ready;
    })().finally(()=>{preparing=null;});preparing.catch(()=>{});}
    return preparing;
  }
  async function run(request,{signal,onLog=()=>{}}={}){
    if(!request||!JOB.test(request.jobId||'')||!HASH.test(request.inputHash||'')||!HASH.test(request.sourceHash||'')||!Buffer.isBuffer(request.sourceBytes)||request.sourceBytes.length>32*1024*1024||sha(request.sourceBytes)!==request.sourceHash)throw Error('GIS job requires a bounded ID and exact ZIP SHA-256');
    if(signal?.aborted)throw signal.reason||cancelled();
    let readiness=await status();if(!readiness.ready){if(readiness.status!=='not-prepared')throw Error('GIS tool is blocked: '+readiness.reason);readiness=await prepare({signal,onLog});}
    // Recheck package versions and binary/script digests for every job.
    readiness=await status();if(!readiness.ready)throw Error('GIS tool changed before execution: '+readiness.reason);
    const controller=new AbortController();controllers.add(controller);const abort=()=>controller.abort(signal?.reason||cancelled());signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    try{
      const input=JSON.stringify({schema:'manta-geospatial-job-v1',...request,sourceBytes:request.sourceBytes.length,sourceBase64:request.sourceBytes.toString('base64')});
      const cmd='test "$(sha256sum /srv/manta/geospatial-worker/geospatial-run.py | cut -d " " -f 1)" = '+readiness.workerSha256+' && bwrap --unshare-all --die-with-parent --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /bin /bin --ro-bind /etc /etc --ro-bind /srv/manta/geospatial-worker /srv/manta/geospatial-worker --dev /dev --proc /proc --tmpfs /tmp --chdir /tmp /usr/bin/python3 /srv/manta/geospatial-worker/geospatial-run.py';
      const output=parsed(await command(cmd,{input,signal:controller.signal,timeoutMs:180000,maxOutputBytes:5*1024*1024,maxTotalBytes:8*1024*1024}),'Isolated GIS worker');
      if(output.schema!=='manta-geospatial-runner-result-v1'||!Number.isInteger(output.exitCode)||typeof output.success!=='boolean'||!Array.isArray(output.files))throw Error('Malformed GIS worker result');
      if(output.success){
        if(output.receipt?.inputHash!==request.inputHash||output.receipt.sourceSha256!==request.sourceHash||output.receipt.workerSha256!==readiness.workerSha256||output.receipt.toolVersions?.gdal!==readiness.versions?.gdal||output.receipt.toolVersions?.proj!==readiness.versions?.proj)throw Error('GIS worker receipt differs from pinned inputs or toolchain');
      }
      if(output.diagnostics)onLog(String(output.diagnostics).slice(-3000));
      return {...output,readinessReceiptSha256:readiness.receiptSha256,toolchain:{schema:readiness.schema,packages:readiness.packages,versions:readiness.versions,binaryHashes:readiness.binaryHashes,workerSha256:readiness.workerSha256,receiptSha256:readiness.receiptSha256}};
    }finally{controllers.delete(controller);signal?.removeEventListener('abort',abort);}
  }
  return {status,prepare,run,async close(){for(const controller of controllers)controller.abort(cancelled());if(preparing)await preparing.catch(()=>{});closed=true;}};
}
