import path from 'node:path';
import {createBrokerSession} from './broker-session.mjs';
import {createMcpEgress} from './mcp-egress.mjs';
import {normalizeMcpNetwork} from '../shared/mcp-network.mjs';
const managed=new Set(['HOME','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','LOGNAME','USER','USERNAME','PATH','SHELL','TERM','TMPDIR','TMP','TEMP','LANG']);
export function createBrokerStdioTransport(parameters,{workspace,network}){
 let session,gateway;const policy=normalizeMcpNetwork(network);
 const transport={onmessage:undefined,onclose:undefined,onerror:undefined,
  async start(){
   if(session)throw Error('Transport already started');
   const cwd=path.relative(workspace,parameters.cwd)||'.';
   gateway=createMcpEgress({network:policy,send:m=>session.send(m)});
   session=createBrokerSession({runtime:'mcp',workspace,options:{command:parameters.command,args:parameters.args,cwd,network:policy.allowedHosts.length>0,env:Object.fromEntries(Object.entries(parameters.env).filter(([k])=>!managed.has(k)))},
    onCall:(method,args,signal)=>{if(method!=='egress.open')throw Error('Unsupported MCP callback');return gateway.open(args,signal);},
    onMessage:m=>{if(gateway.handle(m))return;if(m.type==='mcp')transport.onmessage?.(m.message);},onClose:error=>{gateway.close();transport.onerror?.(error);transport.onclose?.();}});
   await session.ready;
  },async send(message){if(!session)throw Error('Transport not started');session.send({type:'mcp',message});},async close(){gateway?.close();session?.close();}
 };
 return transport;
}
