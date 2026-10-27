import fs from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {spawn} from 'node:child_process';

const sleep=(ms,signal)=>new Promise((resolve,reject)=>{if(signal?.aborted)return reject(signal.reason||Error('Cancelled'));const timer=setTimeout(done,ms);function done(){signal?.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason||Error('Cancelled'));}signal?.addEventListener('abort',abort,{once:true});});
const cancelled=()=>Object.assign(Error('Linux environment preparation cancelled'),{name:'AbortError'});
const alive=processHandle=>!!processHandle&&!processHandle.ended;

/** Project-scoped process runner: no shell interpolation or inherited API keys. */
export function executeLocalVm(file,args,{cwd,input,signal,timeoutMs=120000,persistent=false,onLog=()=>{},maxOutputBytes=1024*1024,maxTotalBytes=8*1024*1024}={}) {
  if(signal?.aborted)return Promise.reject(signal.reason||cancelled());
  return new Promise((resolve,reject)=>{
    const child=spawn(file,args,{cwd,shell:false,stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',PYTHONDONTWRITEBYTECODE:'1'}});
    let stdout='',stderr='',size=0,timer,settled=false,exitResolve;
    const handle={pid:null,ended:false,kill:signal=>child.kill(signal||'SIGTERM'),exited:new Promise(r=>{exitResolve=r;})};
    const abort=()=>child.kill('SIGTERM');
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    signal?.addEventListener('abort',abort,{once:true});
    function read(which,chunk){size+=chunk.length;if(size>maxTotalBytes){child.kill('SIGTERM');return;}const text=chunk.toString();if(which==='stdout')stdout=(stdout+text).slice(-maxOutputBytes);else stderr=(stderr+text).slice(-maxOutputBytes);onLog(text);}
    child.stdout.on('data',chunk=>read('stdout',chunk));child.stderr.on('data',chunk=>read('stderr',chunk));
    child.stdin.on('error',()=>{});
    child.once('error',error=>{cleanup();handle.ended=true;exitResolve({code:-1,error:error.message,stdout,stderr});if(!settled){settled=true;reject(error);}});
    child.once('spawn',()=>{handle.pid=child.pid;if(input!==undefined)child.stdin.end(input);else child.stdin.end();if(persistent){settled=true;resolve(handle);}else{timer=setTimeout(()=>child.kill('SIGTERM'),timeoutMs);timer.unref();}});
    child.once('exit',(code,terminationSignal)=>{cleanup();handle.ended=true;const result={code:code??-1,signal:terminationSignal,stdout,stderr};exitResolve(result);if(!settled){settled=true;if(signal?.aborted)reject(signal.reason||cancelled());else resolve(result);}});
  });
}

/** Incrementally stage reviewed files without removing a live VirtioFS share. */
export async function stageManagedWorkerBundle(root,{signal}={}) {
  root=path.resolve(root);
  const source=path.join(root,'worker'),handoff=path.join(root,'handoff'),target=path.join(handoff,'worker');
  const files=[],directories=[];let bytes=0;
  const check=()=>{if(signal?.aborted)throw signal.reason||cancelled();};
  async function regularBytes(file,expected){
    const handle=await fs.open(file,fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW);
    try{
      const before=await handle.stat();
      if(!before.isFile()||before.ino!==expected.ino||before.size!==expected.size||before.mtimeMs!==expected.mtimeMs)throw Error('Managed worker file changed during staging');
      const content=await handle.readFile(),after=await handle.stat();
      if(content.length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw Error('Managed worker file changed during staging');
      return content;
    }finally{await handle.close();}
  }
  async function scan(from,relative=''){
    check();const entry=await fs.lstat(from);
    if(entry.isSymbolicLink())throw Error('Managed worker bundle cannot contain symbolic links');
    if(entry.isDirectory()){
      directories.push(relative);if(directories.length>2000)throw Error('Managed worker bundle exceeds its size limit');
      for(const name of (await fs.readdir(from)).sort())await scan(path.join(from,name),relative?path.join(relative,name):name);
    }else if(entry.isFile()){
      bytes+=entry.size;if(files.length>=2000||bytes>64*1024*1024)throw Error('Managed worker bundle exceeds its size limit');
      files.push({relative,content:await regularBytes(from,entry)});
    }else throw Error('Unsupported file in managed worker bundle');
  }
  await scan(source);
  for(const entry of ['provision-worker.sh','prepare-native.sh'])if(!files.some(file=>file.relative===entry))throw Error('Managed worker bundle is missing its fixed entry script: '+entry);
  async function existing(file){try{return await fs.lstat(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
  async function directory(file,create=false){
    let info=await existing(file);
    if(!info&&create){try{await fs.mkdir(file,{mode:0o755});}catch(error){if(error.code!=='EEXIST')throw error;}info=await fs.lstat(file);}
    if(!info?.isDirectory()||info.isSymbolicLink())throw Error('Managed worker target directory cannot be a symbolic link or non-directory');
  }
  async function parents(relative){
    await directory(root);await directory(handoff,true);await directory(target,true);
    if(relative){let current=target;for(const part of relative.split(path.sep)){current=path.join(current,part);await directory(current,true);}}
  }
  for(const relative of directories){check();await parents(relative);}
  let changed=0,unchanged=0;
  for(const file of files){
    check();await parents(path.dirname(file.relative)==='.'?'':path.dirname(file.relative));
    const to=path.join(target,file.relative),before=await existing(to);
    if(before&&(!before.isFile()||before.isSymbolicLink()))throw Error('Managed worker target file must be regular and cannot be a symbolic link');
    if(before?.size===file.content.length&&(await regularBytes(to,before)).equals(file.content)){unchanged++;continue;}
    const temporary=path.join(path.dirname(to),'.manta-stage-'+crypto.randomUUID());let handle;
    try{
      handle=await fs.open(temporary,'wx',0o644);await handle.writeFile(file.content);await handle.sync();await handle.close();handle=null;
      check();await parents(path.dirname(file.relative)==='.'?'':path.dirname(file.relative));
      const current=await existing(to);
      if(current&&(!current.isFile()||current.isSymbolicLink()))throw Error('Managed worker target file must be regular and cannot be a symbolic link');
      if(Boolean(current)!==Boolean(before)||(current&&(current.ino!==before.ino||current.size!==before.size||current.mtimeMs!==before.mtimeMs)))throw Error('Managed worker target changed during staging');
      await fs.rename(temporary,to);changed++;
    }finally{if(handle)await handle.close();await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
  return {fileCount:files.length,bytes,changed,unchanged};
}

async function unusedLoopbackPort(){const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}

/**
 * Owns only a fixed, project-local VM backend. No model-controlled host path,
 * endpoint, shell command, token environment variable, or global configuration.
 * `connection()` is private infrastructure and must never be exposed as an API tool.
 */
export function createLocalLinuxVmService({vmRoot,store,emit=()=>{},execute=executeLocalVm,fetchImpl=globalThis.fetch,allocatePort=unusedLoopbackPort,hostPlatform=process.platform,hostArch=process.arch,pollIntervalMs=1000,maxReadyMs=180000}={}) {
  if(!vmRoot||!path.isAbsolute(vmRoot)||!store?.workspace)throw Error('Local Linux VM requires a fixed absolute vmRoot and project store');
  const root=path.resolve(vmRoot),stateDir=path.join(root,'state');
  let phase='not-prepared',message='Linux 工程环境尚未准备',operation,token,endpoint,vmProcess,tunnelProcess,closed=false;
  const projects=new Set(),authorized=new Set();
  let runtime={},restoring;
  const remembered=new Set();let rememberedLoaded=false;
  const authorizedFile=path.join(stateDir,'authorized-projects.json');
  async function loadRemembered(){
    if(rememberedLoaded)return;rememberedLoaded=true;
    try{const info=await fs.lstat(authorizedFile);if(!info.isFile()||info.isSymbolicLink()||info.size>65536)throw Error('Invalid managed VM authorization record');const data=JSON.parse(await fs.readFile(authorizedFile,'utf8'));if(data.schema!=='manta-vm-project-authorizations-v1'||!Array.isArray(data.projectIds)||data.projectIds.some(id=>typeof id!=='string'||id.length>200))throw Error('Invalid managed VM authorization record');for(const id of data.projectIds){try{store.workspace(id);remembered.add(id);}catch{}}}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  async function remember(projectId){await loadRemembered();remembered.add(projectId);await fs.mkdir(stateDir,{recursive:true,mode:0o700});const temporary=authorizedFile+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temporary,JSON.stringify({schema:'manta-vm-project-authorizations-v1',projectIds:[...remembered].sort()},null,2)+'\n',{mode:0o600,flag:'wx'});await fs.rename(temporary,authorizedFile);}finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}}
  async function forget(){remembered.clear();rememberedLoaded=true;await fs.unlink(authorizedFile).catch(error=>{if(error.code!=='ENOENT')throw error;});}

  const secrets=()=>token?[token]:[];
  const redact=value=>secrets().reduce((text,secret)=>text.replaceAll(secret,'[redacted]'),String(value)).slice(-4000);
  function project(args){if(!args||typeof args.projectId!=='string'||Object.keys(args).some(key=>key!=='projectId'))throw Error('Only a project identifier is accepted for the managed Linux environment');store.workspace(args.projectId);return args.projectId;}
  function view(projectId){return {projectId,type:'local-linux-vm',state:phase,message,configured:authorized.has(projectId),guestReady:runtime.guestReady===true,workerReady:phase==='ready'&&authorized.has(projectId),resources:{cpu:4,memoryMiB:4096,diskVirtualGiB:10,hostFreeReserveGiB:5},hostGlobalChanges:false,...(runtime.hostFreeBytes!==undefined?{hostFreeBytes:runtime.hostFreeBytes}:{}),...(runtime.diskAllocatedBytes!==undefined?{diskAllocatedBytes:runtime.diskAllocatedBytes}:{}),...(runtime.guestDistribution?{guestDistribution:runtime.guestDistribution}:{})};}
  function update(next,text){phase=next;message=redact(text);for(const projectId of projects)emit({projectId,type:'nos3.environment',message,data:view(projectId)});}
  async function script(name,args=[],options={}) {
    const file=path.join(root,'host',name),stat=await fs.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink())throw Error('Managed VM helper must be a regular application-owned file');
    const result=await execute(file,args,{cwd:root,...options,onLog:text=>{if(options.onLog)options.onLog(redact(text));}});
    if(!options.persistent&&result.code!==0)throw Error(redact(`Linux environment helper failed: ${name}: ${result.stderr||result.stdout||result.code}`));
    return result;
  }
  async function readRuntime(){try{const result=await script('vm-status.sh');const data=JSON.parse(result.stdout);runtime={guestReady:data.guestReady===true,guestDistribution:data.guestDistribution,hostFreeBytes:data.hostFreeBytes,diskAllocatedBytes:data.diskAllocatedBytes,state:data.state};return runtime;}catch(error){if(error.code==='ENOENT')return {state:'not-prepared'};throw error;}}
  async function loadToken(){await fs.mkdir(stateDir,{recursive:true,mode:0o700});await fs.chmod(stateDir,0o700);const file=path.join(stateDir,'worker-token');try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>256)throw Error('Invalid managed worker credential file');token=(await fs.readFile(file,'utf8')).trim();if(!/^[a-f0-9]{64}$/.test(token))throw Error('Invalid managed worker credential');await fs.chmod(file,0o600);}catch(error){if(error.code!=='ENOENT')throw error;token=crypto.randomBytes(32).toString('hex');await fs.writeFile(file,token+'\n',{mode:0o600,flag:'wx'});}}
  async function guestReady(signal){const deadline=Date.now()+maxReadyMs;let last;while(Date.now()<deadline){if(signal.aborted)throw signal.reason||cancelled();if(vmProcess?.ended)throw Error('Local Linux VM stopped while booting');try{await script('vm-exec.sh',['test -e /var/lib/cloud/instance/boot-finished && mountpoint -q /mnt/manta-transfer'],{signal,timeoutMs:15000});runtime.guestReady=true;const file=path.join(stateDir,'runtime.json');try{const saved=JSON.parse(await fs.readFile(file,'utf8'));await fs.writeFile(file,JSON.stringify({...saved,guestReady:true,guestBootState:'ready',guestDistribution:'Ubuntu 22.04',updatedAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});}catch(error){if(error.code!=='ENOENT')throw error;}return;}catch(error){last=error;}await sleep(pollIntervalMs,signal);}throw Error(`Linux guest readiness timed out: ${redact(last?.message||'SSH unavailable')}`);}
  async function healthy(signal){if(!endpoint||!token)return false;try{const response=await fetchImpl(endpoint+'/health',{headers:{authorization:'Bearer '+token,accept:'application/json'},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000)});if(!response.ok)return false;const text=await response.text();if(text.length>64000)return false;const data=JSON.parse(text);return data.schema==='manta-nos3-worker-v1'&&data.scopes?.build===true&&data.scopes?.integration===true;}catch{return false;}}
  async function terminate(handle){if(!alive(handle))return;handle.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(resolve,22000);handle.exited.then(()=>{clearTimeout(timer);resolve();});});if(alive(handle))handle.kill('SIGKILL');}
  async function prepareEnvironment(signal,onVmStarted=()=>{}){
    if(hostPlatform!=='darwin'||hostArch!=='arm64')throw Error('This local Linux VM backend requires Apple Silicon macOS');
    await loadToken();
    update('preparing','正在检查隔离的 Linux 工程环境');
    const existing=await readRuntime();
    if(existing.state!=='running'){
      update('preparing','正在准备项目独立的 Ubuntu 镜像与虚拟机');
      await script('vm-prepare.sh',[],{signal,timeoutMs:1800000});
      update('starting','正在启动 Linux 虚拟机');
      vmProcess=await script('vm-start.sh',['--foreground'],{signal,persistent:true});
      onVmStarted(vmProcess);
    }
    await guestReady(signal);
    if(signal.aborted)throw signal.reason||cancelled();
    await stageManagedWorkerBundle(root,{signal});
    update('building','正在虚拟机内检查和准备 NOS3/cFS/42');
    await script('vm-exec.sh',['bash /mnt/manta-transfer/worker/prepare-native.sh'],{signal,timeoutMs:1800000});
    const readiness=await script('vm-exec.sh',['cat /srv/manta/receipts/native-ready.json'],{signal,timeoutMs:30000});
    if(Buffer.byteLength(readiness.stdout)>1024*1024)throw Error('Native readiness receipt exceeds limit');
    const nativeReceipt=JSON.parse(readiness.stdout);
    if(nativeReceipt.schema!=='manta-nos3-native-ready-v1'||nativeReceipt.ready!==true||!/^[a-f0-9]{64}$/.test(nativeReceipt.inputHash)||!Array.isArray(nativeReceipt.binaries)||nativeReceipt.binaries.length<4)throw Error('Native preparation did not return a valid build receipt');
    await fs.writeFile(path.join(stateDir,'native-ready.json'),JSON.stringify(nativeReceipt,null,2)+'\n',{mode:0o600});
    update('provisioning','正在虚拟机内准备 NOS3 执行服务');
    await script('vm-exec.sh',['bash /mnt/manta-transfer/worker/provision-worker.sh'],{input:JSON.stringify({token,port:8093})+'\n',signal,timeoutMs:1800000});
    update('connecting','正在连接并验证 NOS3 执行服务');
    if(alive(tunnelProcess))await terminate(tunnelProcess);
    const port=await allocatePort();
    if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid allocated loopback port');
    endpoint=`http://127.0.0.1:${port}`;
    tunnelProcess=await script('vm-tunnel.sh',[String(port)],{persistent:true,signal});
    const deadline=Date.now()+Math.min(maxReadyMs,30000);
    while(Date.now()<deadline){if(signal.aborted)throw signal.reason||cancelled();if(tunnelProcess.ended)throw Error('Managed worker SSH tunnel closed');if(await healthy(signal))return;await sleep(pollIntervalMs,signal);}
    throw Error('NOS3 worker health check failed; full integration capability was not confirmed');
  }
  async function restoreConnection(projectId){
    await loadRemembered();if(!remembered.has(projectId)||closed)return false;
    if(restoring){await restoring;return phase==='ready'&&authorized.has(projectId);}
    restoring=(async()=>{
      // Reattach only to an already-running, previously prepared worker. No VM/package installation from status.
      const credential=path.join(stateDir,'worker-token');let info;try{info=await fs.lstat(credential);}catch(error){if(error.code==='ENOENT')return false;throw error;}
      if(!info.isFile()||info.isSymbolicLink()||info.size>256)throw Error('Invalid managed worker credential file');
      const restoredToken=(await fs.readFile(credential,'utf8')).trim();if(!/^[a-f0-9]{64}$/.test(restoredToken))throw Error('Invalid managed worker credential');token=restoredToken;
      if(alive(tunnelProcess))await terminate(tunnelProcess);
      const port=await allocatePort();if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid allocated loopback port');
      endpoint=`http://127.0.0.1:${port}`;tunnelProcess=await script('vm-tunnel.sh',[String(port)],{persistent:true});
      const deadline=Date.now()+Math.min(maxReadyMs,15000);
      while(Date.now()<deadline){if(closed||tunnelProcess.ended)break;if(await healthy()){for(const id of remembered)authorized.add(id);update('ready','已重新连接隔离 Linux 执行服务');return true;}await sleep(pollIntervalMs);}
      await terminate(tunnelProcess);tunnelProcess=undefined;endpoint=undefined;return false;
    })().finally(()=>{restoring=undefined;});
    return restoring;
  }
  async function waitForOperation(op,projectId,signal){if(signal?.aborted)throw signal.reason||cancelled();const waiter={};op.waiters.add(waiter);return new Promise((resolve,reject)=>{let settled=false;function finish(error,result){if(settled)return;settled=true;op.waiters.delete(waiter);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);}function abort(){finish(signal.reason||cancelled());if(op.waiters.size===0&&!op.done)op.controller.abort(cancelled());}signal?.addEventListener('abort',abort,{once:true});op.promise.then(async()=>{if(settled)return;await remember(projectId);if(settled)return;authorized.add(projectId);finish(null,view(projectId));}).catch(error=>finish(error));});}
  const service={
    async prepare(args,ctx={}){
      const projectId=project(args);if(closed)throw Error('Local Linux VM service is closed');if(ctx.signal?.aborted)throw ctx.signal.reason||cancelled();projects.add(projectId);
      if(phase==='ready'&&alive(tunnelProcess)&&await healthy(ctx.signal)){await remember(projectId);authorized.add(projectId);return view(projectId);}
      if(ctx.signal?.aborted)throw ctx.signal.reason||cancelled();
      if(!operation){const controller=new AbortController(),op={controller,waiters:new Set(),done:false,startedVM:null};operation=op;op.promise=Promise.resolve().then(()=>prepareEnvironment(controller.signal,handle=>{op.startedVM=handle;})).then(()=>{update('ready','Linux 工程环境已就绪');}).catch(async error=>{endpoint=undefined;await terminate(tunnelProcess);tunnelProcess=undefined;if(op.startedVM&&vmProcess===op.startedVM){await terminate(vmProcess);vmProcess=undefined;}if(controller.signal.aborted)update('cancelled','Linux 工程环境准备已取消');else update('failed',error.message);throw Error(redact(error.message));}).finally(()=>{op.done=true;if(operation===op)operation=undefined;});op.promise.catch(()=>{});}
      return waitForOperation(operation,projectId,ctx.signal);
    },
    async status(args){const projectId=project(args);projects.add(projectId);if(!operation){const current=await readRuntime();if(current.state==='stopped'&&phase==='ready'){phase='stopped';message='Linux 虚拟机已停止';authorized.clear();endpoint=undefined;}else if(['not-prepared','available'].includes(phase)&&current.state==='running'){if(!await restoreConnection(projectId)){phase='available';message='Linux 虚拟机正在运行，执行服务尚未连接';}}else if(phase==='ready'&&(!alive(tunnelProcess)||!await healthy())){phase='failed';message='NOS3 执行服务连接已断开';authorized.clear();endpoint=undefined;}}return view(projectId);},
    async connection(args){const projectId=project(args);if(phase!=='ready'||!authorized.has(projectId)||!endpoint||!token)throw Error('Prepare this project’s local Linux environment before requesting its private connection');if(!await healthy())throw Error('Managed NOS3 worker is no longer healthy');return {endpoint,token};},
    async stop(args){const projectId=project(args);projects.add(projectId);operation?.controller.abort(cancelled());if(operation)await operation.promise.catch(()=>{});await terminate(tunnelProcess);tunnelProcess=undefined;await script('vm-stop.sh',[],{timeoutMs:35000});await terminate(vmProcess);vmProcess=undefined;endpoint=undefined;authorized.clear();await forget();runtime.guestReady=false;update('stopped','Linux 虚拟机已停止');return view(projectId);},
    async close(){closed=true;operation?.controller.abort(cancelled());if(operation)await operation.promise.catch(()=>{});await terminate(tunnelProcess);tunnelProcess=undefined;await terminate(vmProcess);vmProcess=undefined;authorized.clear();endpoint=undefined;},
  };
  return service;
}
