import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {watch} from 'node:fs';
import {mkdir,open,readFile,readdir,unlink,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const local=path.join(root,'deploy/local'),stateFile=path.join(local,'lima-dev.json'),logFile=path.join(local,'lima-dev.log');
const instance=process.env.DAIDALIS_LIMA_INSTANCE||'daidalis',url='http://127.0.0.1:4317';
const sshConfig=path.join(homedir(),'.lima',instance,'ssh.config'),destination='lima-'+instance;
const sources=['public','shared','server','tests','scripts','deploy/docker'];
const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
const log=message=>console.log(new Date().toISOString()+' '+message);
let guestRoot;

async function run(command,args,{input}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd:root,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;});
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  child.on('error',reject);
  child.on('close',code=>code===0?resolve(stdout):reject(Error(`${command} exited ${code}: ${stderr.slice(-3000)||stdout.slice(-3000)}`)));
  child.stdin.end(input);
 });
}
const ssh=(command,input)=>run('ssh',['-F',sshConfig,'-o','BatchMode=yes',destination,command],{input});
async function connect(){
 const home=(await ssh('printf %s "$HOME"')).trim();
 guestRoot=process.env.DAIDALIS_LIMA_ROOT||home+'/Daidalis';
 if(!path.posix.isAbsolute(guestRoot))throw Error('DAIDALIS_LIMA_ROOT must be absolute');
 await ssh(`test -f ${quote(guestRoot+'/deploy/local/broker.env')}`);
}
function compose(args){return ssh(`cd ${quote(guestRoot)} && docker compose --env-file deploy/local/broker.env ${args}`);}
async function syncSource(){
 const transport=['ssh','-F',sshConfig,'-o','BatchMode=yes'].map(quote).join(' ');
 for(const source of sources)await run('rsync',['-rlt','--delete','--delay-updates','--exclude=._*','--exclude=__pycache__','-e',transport,source+'/',destination+':'+guestRoot+'/'+source+'/']);
}
async function tasksBusy(){
 try{
  const response=await fetch(url+'/api/bootstrap',{signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('Cannot inspect running tasks on '+url);
  const data=await response.json();
  return (data.runs||[]).some(run=>['queued','running','waiting_approval'].includes(run.status));
 }catch(error){
  const status=(await compose('ps --all --format "{{.State}}" daidalis')).trim();
  if(['exited','created'].includes(status))return false;
  throw error;
 }
}
async function fingerprint(){
 const files=[];
 async function visit(relative){
  for(const item of await readdir(path.join(root,relative),{withFileTypes:true})){
   if(item.name.startsWith('.')||item.name==='__pycache__')continue;
   const file=relative+'/'+item.name;
   if(item.isDirectory())await visit(file);else if(item.isFile())files.push(file);
  }
 }
 for(const source of sources)await visit(source);
 const hashes=await Promise.all(files.sort().map(async file=>[file,createHash('sha256').update(await readFile(path.join(root,file))).digest('hex')]));
 return new Map(hashes);
}
async function stamp(){
 const revision=Date.now().toString(36);
 await ssh(`cd ${quote(guestRoot)} && printf %s ${quote(revision)} > deploy/local/dev/revision.tmp && mv deploy/local/dev/revision.tmp deploy/local/dev/revision`);
 return revision;
}
async function saveState(extra={}){
 const previous=await readState();
 await writeFile(stateFile,JSON.stringify({...previous,...extra,pid:process.pid,url,instance,guestRoot},null,2));
}
async function readState(){try{return JSON.parse(await readFile(stateFile,'utf8'));}catch(error){if(error.code==='ENOENT')return {};throw error;}}
function alive(pid){if(!Number.isInteger(pid))return false;try{process.kill(pid,0);return true;}catch{return false;}}

async function configure(){
 await ssh(`cd ${quote(guestRoot)} && mkdir -p deploy/local/dev && python3 -`,`
from pathlib import Path
target=Path('deploy/local/broker.env')
lines=target.read_text().splitlines()
for index,line in enumerate(lines):
    if line.startswith('COMPOSE_FILE='):
        files=line.split('=',1)[1].split(':')
        if 'deploy/docker/compose.dev.yaml' not in files:
            lines[index]=line+':deploy/docker/compose.dev.yaml'
        break
else:
    raise RuntimeError('Saved deployment has no COMPOSE_FILE')
target.write_text('\\n'.join(lines)+'\\n')
`);
 await compose('config --quiet');
}
async function update({restart=false}={}){
 if(restart&&await tasksBusy())return false;
 await syncSource();
 if(restart)await compose('up -d --no-deps --force-recreate --no-build --wait --wait-timeout 60 daidalis');
 const revision=await stamp();
 await saveState({revision,syncedAt:new Date().toISOString(),ready:true});
 log(`Synced ${revision}${restart?' and restarted daidalis':''}`);
 return true;
}
async function watchSource(){
 await connect();
 if(await tasksBusy())throw Error('Wait until running tasks finish before enabling development mounts');
 await ssh(`cd ${quote(guestRoot)} && mkdir -p deploy/local/dev && (test -f deploy/local/lima-dev-before.tar.gz || (umask 077; tar -czf deploy/local/lima-dev-before.tar.gz ${sources.map(quote).join(' ')} deploy/local/broker.env deploy/local/magpie.env))`);
 await syncSource();
 await configure();
 const revision=await stamp();
 await compose('up -d --no-deps --force-recreate --no-build --wait --wait-timeout 60 daidalis');
 await saveState({ready:true,revision,startedAt:new Date().toISOString(),syncedAt:new Date().toISOString()});
 log('Watching '+root+' → '+url);
 let baseline=await fingerprint(),pending=false,processing=false,timer;
 const watchers=[];
 async function flush(){
  if(processing){pending=true;return;}
  processing=true;
  try{
   do{
    pending=false;
    const next=await fingerprint();
    const changed=[...new Set([...baseline.keys(),...next.keys()])].filter(file=>baseline.get(file)!==next.get(file));
    if(!changed.length)continue;
    const restart=changed.some(file=>file.startsWith('server/')||file.startsWith('shared/')||file==='deploy/docker/entrypoint.mjs');
    if(!await update({restart})){log('Backend changes waiting for active tasks');timer=setTimeout(flush,3000);return;}
    baseline=next;
   }while(pending);
  }catch(error){log(error.message);timer=setTimeout(flush,3000);}
  finally{processing=false;}
 }
 for(const source of sources)watchers.push(watch(path.join(root,source),{recursive:true},()=>{
  clearTimeout(timer);timer=setTimeout(flush,700);
 }));
 const periodic=setInterval(flush,5000);
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{
  clearTimeout(timer);clearInterval(periodic);for(const watcher of watchers)watcher.close();
  await saveState({ready:false});process.exit(0);
 });
}

await mkdir(local,{recursive:true});
const mode=process.argv[2]||'status';
if(mode==='watch'){
 try{await watchSource();}catch(error){await saveState({ready:false,error:error.message});log(error.stack);process.exitCode=1;}
}else if(mode==='start'){
 const state=await readState();
 if(alive(state.pid)){console.log(JSON.stringify(state,null,2));process.exit(0);}
 const file=await open(logFile,'a');
 const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'watch'],{cwd:root,detached:true,stdio:['ignore',file.fd,file.fd]});
 child.unref();await file.close();
 await writeFile(stateFile,JSON.stringify({pid:child.pid,ready:false,url}));
 for(let attempt=0;attempt<90;attempt++){
  await delay(1000);
  const current=await readState();
  if(!alive(child.pid))throw Error(current.error||'Watcher stopped; see '+logFile);
  if(current.ready){console.log(JSON.stringify(current,null,2));break;}
  if(attempt===89)throw Error('Setup is still running; see '+logFile);
 }
}else if(mode==='sync'){
 const state=await readState();
 if(alive(state.pid))throw Error('Watcher already synchronizes changes; check status or its log');
 await connect();if(!await update({restart:true}))throw Error('Running tasks prevent restart');
}else if(mode==='test'){
 const files=process.argv.slice(3);
 if(!files.length)throw Error('Pass Node test file paths or test options');
 await connect();
 const output=await compose('exec -T daidalis env -u DAIDALIS_DATA_DIR -u DAIDALIS_PROJECTS_ROOT -u DAIDALIS_DEV_REVISION_FILE -u DAIDALIS_EXECUTION_MODE node --test '+files.map(quote).join(' '));
 process.stdout.write(output);
}else if(mode==='stop'){
 const state=await readState();
 if(alive(state.pid))process.kill(state.pid,'SIGTERM');
 console.log('Stopped source synchronization; Daidalis remains running on '+url);
}else if(mode==='status'){
 const state=await readState();console.log(JSON.stringify({...state,running:alive(state.pid),logFile},null,2));
}else throw Error('Usage: node scripts/lima-dev.mjs {start|status|stop|sync|test <files>}');
