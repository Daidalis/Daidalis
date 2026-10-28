import path from 'node:path';
import {createBrokerSession} from './broker-session.mjs';
const managed=new Set(['HOME','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','LOGNAME','USER','USERNAME','PATH','SHELL','TERM','TMPDIR','TMP','TEMP','LANG']);
export function createBrokerStdioTransport(parameters,{workspace}){
 let session;
 const transport={onmessage:undefined,onclose:undefined,onerror:undefined,
  async start(){
   if(session)throw Error('Transport already started');
   const cwd=path.relative(workspace,parameters.cwd)||'.';
   session=createBrokerSession({runtime:'mcp',workspace,options:{command:parameters.command,args:parameters.args,cwd,env:Object.fromEntries(Object.entries(parameters.env).filter(([k])=>!managed.has(k)))},
    onMessage:m=>{if(m.type==='mcp')transport.onmessage?.(m.message);},onClose:error=>{transport.onerror?.(error);transport.onclose?.();}});
   await session.ready;
  },async send(message){if(!session)throw Error('Transport not started');session.send({type:'mcp',message});},async close(){session?.close();}
 };
 return transport;
}
