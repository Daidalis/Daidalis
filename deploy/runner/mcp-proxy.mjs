import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createSocketRelay} from '../../shared/socket-relay.mjs';

// The task still has --network none. Only this loopback CONNECT endpoint can
// reach the trusted, connector-scoped gateway through the existing session pipe.
export async function createMcpProxy({callback,send}={}){
 const relay=createSocketRelay({send}),sockets=new Set();let closed=false;
 const server=http.createServer((_req,res)=>{res.writeHead(405,{connection:'close'});res.end('Use HTTPS CONNECT');});
 server.maxConnections=16;server.headersTimeout=5000;server.requestTimeout=10000;
 server.on('connection',socket=>{sockets.add(socket);socket.setTimeout(15000,()=>socket.destroy());socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));});
 server.on('clientError',(_error,socket)=>socket.destroy());
 server.on('connect',async(req,socket,head)=>{
  const match=/^([a-zA-Z0-9.-]{1,253}):443$/.exec(req.url||'');
  if(closed||!match||relay.size>=8||head.length>65536){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  const id=randomUUID();socket.pause();
  try{
   const stream=relay.add(id,socket,{paused:true});
   await callback('egress.open',{id,host:match[1].toLowerCase(),port:443});
   if(socket.destroyed||closed){send({type:'egress.close',id});return;}
   socket.write('HTTP/1.1 200 Connection Established\r\n\r\n',()=>{if(head.length)socket.unshift(head);stream.start();});
  }catch{socket.destroy();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const url='http://127.0.0.1:'+server.address().port;
 return {handle:relay.handle,env:{HTTP_PROXY:url,HTTPS_PROXY:url,http_proxy:url,https_proxy:url,ALL_PROXY:url,all_proxy:url,NO_PROXY:'localhost,127.0.0.1,::1',no_proxy:'localhost,127.0.0.1,::1',NODE_USE_ENV_PROXY:'1'},
  async close(){closed=true;relay.close();for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));}};
}
