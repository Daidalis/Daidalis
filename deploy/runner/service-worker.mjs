import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createComputerService} from '../../server/computer.mjs';
import {createContainerDesktop} from '../../server/container-desktop.mjs';
import {safePath} from '../../server/sandbox.mjs';
if(process.getuid()===0||process.env.MANTA_BROKER_TASK!=='1')throw Error('Broker task required');
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
let seq=0,service,transport,started=false,desktop,desktopSeq=0;const calls=new Map(),desktopCalls=new Map(),tunnels=new Map();
const callback=(method,args)=>new Promise((resolve,reject)=>{const id=++seq;calls.set(id,{resolve,reject});send({type:'call',id,method,args});});
function desktopRequest(_socket,_route,payload){
 if(!desktop){
  desktop=spawn('/usr/bin/python3',['-B','/opt/manta/deploy/runner/desktop-session.py'],{stdio:['pipe','pipe','pipe']});
  const output=readline.createInterface({input:desktop.stdout});
  output.on('line',line=>{try{const m=JSON.parse(line),p=desktopCalls.get(m.id);if(p){desktopCalls.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.result);}}catch{desktop.kill();}});
  const fail=()=>{for(const p of desktopCalls.values())p.reject(Error('Desktop service stopped'));desktopCalls.clear();desktop=null;};
  desktop.on('error',fail);desktop.on('close',fail);desktop.stderr.resume();
 }
 return new Promise((resolve,reject)=>{const id=++desktopSeq;desktopCalls.set(id,{resolve,reject});desktop.stdin.write(JSON.stringify({id,payload})+'\n');});
}
async function start({runtime,options}){
 if(runtime==='computer'){
  process.env.MBSE_COMPUTER_HOSTS=options.allowedHosts.join(',');
  process.env.MBSE_CHROME_PATH='/usr/bin/chromium';
  service=await createComputerService({root:'/opt/manta',dataDir:'/tmp/computer-state',store:{workspace:id=>{if(id!==options.projectId)throw Error('Wrong project');return '/work';}},
   requestApproval:args=>callback('approval',args),browserFetch:args=>callback('fetch',args),
   desktopAdapter:shots=>createContainerDesktop({socketPath:'local',shots,request:desktopRequest})});
  service.setBaseUrl(options.baseUrl);
 }else if(runtime==='mcp'){
  const cwd=safePath('/work',options.cwd||'.');
  if(!path.isAbsolute(options.command))throw Error('Absolute installed executable required');
  const env={...options.env,HOME:'/task-home',USERPROFILE:'/task-home',APPDATA:'/task-home',LOCALAPPDATA:'/task-home',USER:'',LOGNAME:'',PATH:'/opt/codex/bin:/usr/local/bin:/usr/bin:/bin',SHELL:'/bin/sh',TMPDIR:'/tmp',TMP:'/tmp',TEMP:'/tmp',LANG:'C.UTF-8'};
  for(const key of ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','DYLD_INSERT_LIBRARIES'])delete env[key];
  transport=new StdioClientTransport({command:options.command,args:options.args,cwd,env,stderr:'pipe',maxBufferSize:4000000});
  transport.onmessage=message=>send({type:'mcp',message});transport.onclose=()=>process.exit(0);transport.onerror=()=>send({type:'error',message:'MCP transport failed'});
  await transport.start();transport.stderr?.resume();
 }else throw Error('Unknown service');
 send({type:'ready'});
}
let queue=Promise.resolve();
const lines=readline.createInterface({input:process.stdin});
lines.on('line',line=>{
 try{
  if(Buffer.byteLength(line)>24*1024*1024)throw Error('Session frame too large');const m=JSON.parse(line);
  if(!started){started=true;queue=start(m).catch(error=>{send({type:'error',message:error.message});process.exitCode=1;});return;}
  if(m.type==='vnc-data'){const tunnel=tunnels.get(m.id);if(tunnel)tunnel.write(Buffer.from(m.data,'base64'));return;}
  if(m.type==='vnc-close'){tunnels.get(m.id)?.destroy();return;}
  if(m.type==='reply'){const p=calls.get(m.id);if(p){calls.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.result);}return;}
  queue=queue.then(async()=>{
   if(m.type==='mcp'){if(!transport)throw Error('MCP not running');return transport.send(m.message);}
   if(m.type!=='request')throw Error('Invalid session request');
   try{
    let result;
    if(m.method==='vnc.open'){
     if(!service||!desktop||tunnels.size>=16)throw Error('Desktop tunnel unavailable');
     const tunnel=net.connect(6080,'127.0.0.1');tunnels.set(m.id,tunnel);tunnel.setTimeout(1800000,()=>tunnel.destroy());
     tunnel.on('data',data=>send({type:'vnc-data',id:m.id,data:data.toString('base64')}));
     tunnel.on('error',()=>tunnel.destroy());tunnel.on('close',()=>{tunnels.delete(m.id);send({type:'vnc-close',id:m.id});});
     result={id:m.id};
    }else if(m.method==='vnc.password'){if(!desktop)throw Error('Desktop unavailable');result={password:(await fs.readFile('/desktop-data/vnc-password.txt','utf8')).trim()};}
    else if(m.method==='status')result=service.status();
    else if(m.method==='action'){
     result=await service.action(m.args.payload,m.args.ctx);
     if(result.imageUrl){const name=result.imageUrl.split('/').at(-1);const {buffer}=await service.readScreenshot(name);result={...result,contentBase64:buffer.toString('base64')};delete result.imageUrl;await fs.unlink('/tmp/computer-state/computer-screenshots/'+name);}
    }else throw Error('Unsupported service method');
    send({type:'reply',id:m.id,result});
   }catch(error){send({type:'reply',id:m.id,error:error.message});}
  }).catch(error=>send({type:'error',message:error.message}));
 }catch(error){send({type:'error',message:error.message});}
});
lines.on('close',()=>process.exit(0));
