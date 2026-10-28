import fs from 'node:fs/promises';
import path from 'node:path';
import {Duplex} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {createBrokerSession} from './broker-session.mjs';
import {validateBrowserRequest} from './computer.mjs';
export async function createBrokerComputer({root,dataDir,store,requestApproval=async()=>false,fetchImpl=fetch}={}){
 const shots=path.join(dataDir,'computer-screenshots');await fs.mkdir(shots,{recursive:true});
 const sessions=new Map(),locks=new Map();
 let activeDesktop=null,desktopState={};
 let baseUrl='http://127.0.0.1:'+ (process.env.PORT||4317);
 const allowedHosts=(process.env.MBSE_COMPUTER_HOSTS||'docs.px4.io,github.com,raw.githubusercontent.com,nos3.readthedocs.io,emanual.robotis.com,bitcraze.io,www.bitcraze.io,example.com').split(',').map(s=>s.trim()).filter(Boolean);
 const installed=async p=>Boolean(await fs.stat(p).catch(()=>null));
 const browserAvailable=await installed('/usr/bin/chromium'),desktopAvailable=await installed('/usr/bin/Xvfb');
 async function session(projectId){
  let item=sessions.get(projectId);if(item&&!item.channel.closed)return item;
  const workspace=store.workspace(projectId);item={ctx:{},payload:null,tunnels:new Map(),early:new Map()};
  item.channel=createBrokerSession({runtime:'computer',workspace,options:{projectId,baseUrl,allowedHosts},onMessage:m=>{
   if(!['vnc-data','vnc-close'].includes(m.type))return;const tunnel=item.tunnels.get(m.id);
   if(tunnel){if(m.type==='vnc-data'){if(tunnel.readableLength>8*1024*1024)tunnel.destroy();else tunnel.push(Buffer.from(m.data,'base64'));}else tunnel.destroy();}
   else{const entries=item.early.get(m.id);if(entries){if(entries.length>=16)return item.channel.close(Error('Too many pending tunnel frames'));entries.push(m);}}
  },onClose:()=>{for(const tunnel of item.tunnels.values())tunnel.destroy();item.tunnels.clear();if(activeDesktop===projectId){activeDesktop=null;desktopState={};}},onCall:async(method,args,signal)=>{
   if(method==='approval')return requestApproval({projectId,runId:item.ctx.runId,tool:'computer_use',args:{action:item.payload?.action,...item.payload?.args},signal:item.ctx.signal||signal});
   if(method!=='fetch')throw Error('Unsupported computer callback');
   if(!args||typeof args.url!=='string'||args.url.length>16000||!['GET','POST'].includes(args.method)||String(args.body||'').length>64000)throw Error('Invalid browser request');
   const url=validateBrowserRequest(args.url,{baseUrl,allowedHosts,projectId,method:args.method,body:args.body});
   if(args.method==='POST'&&item.ctx.source!=='user'&&item.ctx.permissionMode!=='auto'){
    const approved=await requestApproval({projectId,runId:item.ctx.runId,tool:'computer_use',args:{action:'browser.engineering.run',body:args.body},signal:item.ctx.signal||signal});if(!approved)throw Error('Browser execution rejected');
   }
   const response=await fetchImpl(url,{method:args.method,headers:args.body?{'content-type':'application/json'}:undefined,body:args.method==='POST'?args.body:undefined,redirect:'manual',signal:AbortSignal.any([signal,...(item.ctx.signal?[item.ctx.signal]:[]),AbortSignal.timeout(30000)])});
   const chunks=[];let size=0;for await(const chunk of response.body||[]){size+=chunk.length;if(size>8*1024*1024)throw Error('Browser response too large');chunks.push(chunk);}
   const headers={};for(const name of ['content-type','location']){const value=response.headers.get(name);if(value)headers[name]=value;}
   return {status:response.status,headers,contentBase64:Buffer.concat(chunks).toString('base64')};
  }});
  sessions.set(projectId,item);await item.channel.ready;return item;
 }
 return {
  setBaseUrl(value){if(sessions.size)throw Error('Computer sessions already active');const url=new URL(value);if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Local origin required');baseUrl=url.origin;},
  async openDesktopTunnel(){
   if(!activeDesktop)throw Error('Enable a project desktop first');const item=await session(activeDesktop);
   let opening;let id;try{({id}=await item.channel.request('vnc.open',{}, {onSent:value=>{opening=value;item.early.set(value,[]);}}));}catch(error){item.early.delete(opening);throw error;}
   const tunnel=new Duplex({read(){},write(chunk,_encoding,done){try{item.channel.send({type:'vnc-data',id,data:chunk.toString('base64')});done();}catch(error){done(error);}},destroy(error,done){item.tunnels.delete(id);item.early.delete(id);if(!item.channel.closed)item.channel.send({type:'vnc-close',id});done(error);}});
   item.tunnels.set(id,tunnel);for(const m of item.early.get(id)||[]){if(m.type==='vnc-data')tunnel.push(Buffer.from(m.data,'base64'));else tunnel.destroy();}item.early.delete(id);return tunnel;
  },
  async refresh(){},
  status(){return {browser:{available:browserAvailable,status:browserAvailable?'ready':'missing-browser',width:1120,height:760},desktop:{...desktopState,scope:'container-desktop',isolated:true,available:desktopAvailable,status:activeDesktop?'enabled':'requires-consent',projectId:activeDesktop,requiresPermissions:true,tools:desktopState.tools||[]},engineeringUrl:baseUrl+'/engineering.html',defaultUrl:baseUrl+'/engineering.html',allowedHosts,notes:['Each project uses a separate offline rootless computer container. Browser HTTP is relayed through the application allowlist. Desktop access requires user consent; sessions expire after one hour.']};},
  async action(payload,ctx={}){
   const {projectId}=payload;store.workspace(projectId);
   const previous=locks.get(projectId)||Promise.resolve();
   const pending=previous.catch(()=>{}).then(async()=>{
    if(ctx.signal?.aborted)throw Error('Cancelled');const item=await session(projectId);item.ctx=ctx;item.payload=payload;
    const {signal,...safeCtx}=ctx;
    const result=await item.channel.request('action',{payload,ctx:{source:safeCtx.source,permissionMode:safeCtx.permissionMode,runId:safeCtx.runId}},{signal});
    if(result.contentBase64){const bytes=Buffer.from(result.contentBase64,'base64');if(bytes.length>8*1024*1024||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid screenshot');const name=randomUUID()+'.png';await fs.writeFile(path.join(shots,name),bytes,{flag:'wx',mode:0o600});delete result.contentBase64;result.imageUrl='/api/computer/screenshots/'+name;}
    if(payload.action==='desktop.enable'){if(activeDesktop&&activeDesktop!==projectId)for(const tunnel of sessions.get(activeDesktop)?.tunnels.values()||[])tunnel.destroy();activeDesktop=projectId;desktopState=(await item.channel.request('status',{})).desktop;desktopState.connectionPassword=(await item.channel.request('vnc.password',{})).password;}if(payload.action==='desktop.disable'&&activeDesktop===projectId){activeDesktop=null;desktopState={};for(const tunnel of item.tunnels.values())tunnel.destroy();}
    return {...result,scope:'rootless-project-computer'};
   });locks.set(projectId,pending);try{return await pending;}finally{if(locks.get(projectId)===pending)locks.delete(projectId);}
  },async readScreenshot(name){if(!/^[a-f0-9-]+\.png$/.test(name))throw Error('Invalid screenshot');return {buffer:await fs.readFile(path.join(shots,name)),contentType:'image/png'};},
  async close(){for(const item of sessions.values())item.channel.close();sessions.clear();}
 };
}
