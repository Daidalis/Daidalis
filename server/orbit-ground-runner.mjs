import fs from 'node:fs/promises';
import {constants as FC} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {executeLocalVm,stageManagedWorkerBundle} from './local-linux-vm.mjs';

const HASH=/^[a-f0-9]{64}$/;
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

/** One reviewed Python entrypoint, one fixed VM. No request field reaches a shell command. */
export function createOrbitGroundRunner({vmRoot,workerSha256,execute=executeLocalVm,stageBundle=stageManagedWorkerBundle}={}){
  if(typeof vmRoot!=='string'||!path.isAbsolute(vmRoot)||!HASH.test(workerSha256||''))throw Error('Orbit-ground runner requires a fixed VM root and reviewed worker SHA-256');
  const root=path.resolve(vmRoot),guest='/srv/manta/orbit-ground-worker/orbit-ground-run.py';
  let closed=false;
  async function scriptBytes(){
    const file=path.join(root,'worker','orbit-ground-run.py'),handle=await fs.open(file,FC.O_RDONLY|FC.O_NOFOLLOW);
    try{const before=await handle.stat();if(!before.isFile()||before.size<100||before.size>200000)throw Error('Reviewed orbit-ground worker size is invalid');const bytes=await handle.readFile();const after=await handle.stat();if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||sha(bytes)!==workerSha256)throw Error('Orbit-ground worker differs from its reviewed SHA-256');return bytes;}finally{await handle.close();}
  }
  async function helper(name,args=[],options={}){
    const file=path.join(root,'host',name),info=await fs.lstat(file);
    if(!info.isFile()||info.isSymbolicLink())throw Error('Managed VM helper must be a regular application-owned file');
    return execute('/bin/sh',[file,...args],{cwd:root,timeoutMs:180000,maxOutputBytes:8*1024*1024,maxTotalBytes:10*1024*1024,...options});
  }
  async function status(){
    if(closed)return {ready:false,state:'closed',isolated:true,hostGlobalChanges:false};
    try{await scriptBytes();const result=await helper('vm-status.sh',[],{timeoutMs:15000,maxOutputBytes:1000,maxTotalBytes:2000});if(result.code!==0||JSON.parse(result.stdout).state!=='running')return {ready:false,state:'not-prepared',reason:'Managed Linux VM is not running',isolated:true,hostGlobalChanges:false};return {ready:true,state:'ready',workerSha256,isolated:true,hostGlobalChanges:false};}
    catch(error){return {ready:false,state:'blocked',reason:String(error.message).slice(0,1000),isolated:true,hostGlobalChanges:false};}
  }
  async function run(request,{signal,timeoutMs=180000}={}){
    if(closed)throw Error('Orbit-ground runner is closed');
    if(signal?.aborted)throw signal.reason||Error('Cancelled');
    const bytes=await scriptBytes();
    await stageBundle(root,{signal});
    // Copy the already-pinned bundle into guest-private storage; VirtioFS is
    // never used as the live Python source during execution.
    const staged=await helper('vm-exec.sh',[`mkdir -p /srv/manta/orbit-ground-worker && cp /mnt/manta-transfer/worker/orbit-ground-run.py ${guest} && sha256sum ${guest}`],{signal,timeoutMs:30000,maxOutputBytes:1000,maxTotalBytes:2000});
    if(staged.code!==0||staged.stdout.trim().split(/\s+/)[0]!==workerSha256)throw Error('Reviewed orbit-ground worker did not stage with its pinned SHA-256');
    // Read-only binds constrain the native 42 receipt and worker; Census ZIP
    // is supplied through bounded stdin. No project text constructs commands.
    const command=`test "$(sha256sum ${guest} | cut -d ' ' -f 1)" = ${workerSha256} && bwrap --unshare-all --die-with-parent --new-session --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /bin /bin --ro-bind /etc /etc --ro-bind /srv/manta/orbit42/jobs /srv/manta/orbit42/jobs --ro-bind /srv/manta/orbit-ground-worker /srv/manta/orbit-ground-worker --dev /dev --proc /proc --tmpfs /tmp --chdir /tmp --clearenv --setenv PATH /usr/bin:/bin --setenv HOME /tmp --setenv LANG C.UTF-8 /usr/bin/python3 ${guest}`;
    const result=await helper('vm-exec.sh',[command],{input:JSON.stringify(request),signal,timeoutMs:Math.min(Math.max(timeoutMs,30000),300000),maxOutputBytes:8*1024*1024,maxTotalBytes:10*1024*1024});
    if(result.code!==0)throw Error(('Isolated orbit-ground worker failed: '+(result.stderr||result.stdout||result.code)).slice(-2000));
    let output;try{output=JSON.parse(result.stdout);}catch{throw Error('Isolated orbit-ground worker returned invalid JSON');}
    if(output?.schema!=='manta-orbit-ground-response-v1'||typeof output.success!=='boolean'||!Number.isInteger(output.exitCode)||!Array.isArray(output.files))throw Error('Invalid orbit-ground worker response');
    return {...output,workerSha256:sha(bytes)};
  }
  return {status,run,async close(){closed=true;}};
}
