import net from 'node:net';
import fs from 'node:fs';
import {createStudioServer} from '../../server/index.mjs';

process.umask(0o077);
process.env.MANTA_EXECUTION_MODE??='shared-container';
process.env.MANTA_NATIVE_AGENTS??='enabled';
process.env.MANTA_PROJECTS_ROOT??='/projects';
if(fs.existsSync('/usr/bin/chromium'))process.env.MBSE_CHROME_PATH??='/usr/bin/chromium';
const port=Number(process.env.PORT||4317);
if(!Number.isInteger(port)||port<1024||port>65535||[8080,8081].includes(port))throw Error('Invalid PORT (8080 and 8081 are reserved)');
const maxTurns=Number(process.env.MANTA_MAX_TOOL_TURNS||32);
if(!Number.isInteger(maxTurns)||maxTurns<2||maxTurns>200)throw Error('MANTA_MAX_TOOL_TURNS must be an integer from 2 to 200');
const app=await createStudioServer({seed:false,addDefaultCodexProvider:false,engineOptions:{maxTurns}});
await app.listen({host:'127.0.0.1',port});
const sockets=new Set();
const relay=net.createServer(client=>{
  const upstream=net.connect({host:'127.0.0.1',port});
  for(const socket of [client,upstream]){sockets.add(socket);socket.on('close',()=>sockets.delete(socket));}
  client.on('error',()=>upstream.destroy());upstream.on('error',()=>client.destroy());
  client.on('close',()=>upstream.destroy());upstream.on('close',()=>client.destroy());
  client.pipe(upstream).pipe(client);
});
await new Promise((resolve,reject)=>{relay.once('error',reject);relay.listen(8080,'0.0.0.0',resolve);});
console.log(`Manta ready on port ${port} (Docker loopback publication)`);
// A fixed relay lets the user reach noVNC without giving the desktop an egress network.
const desktopRelay=net.createServer(async client=>{
  let upstream;try{upstream=app.computer?.openDesktopTunnel?await app.computer.openDesktopTunnel():net.connect({path:'/desktop-control/novnc.sock'});}catch{client.destroy();return;}
  if(client.destroyed){upstream.destroy();return;}
  for(const socket of [client,upstream]){sockets.add(socket);socket.on('close',()=>sockets.delete(socket));}
  client.on('error',()=>upstream.destroy());upstream.on('error',()=>client.destroy());
  client.on('close',()=>upstream.destroy());upstream.on('close',()=>client.destroy());
  client.pipe(upstream).pipe(client);
});
await new Promise((resolve,reject)=>{desktopRelay.once('error',reject);desktopRelay.listen(8081,'0.0.0.0',resolve);});
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{
  if(stopping)return;stopping=true;
  const timer=setTimeout(()=>process.exit(1),20000).unref();
  relay.close();desktopRelay.close();for(const socket of sockets)socket.destroy();
  await app.close();clearTimeout(timer);process.exit(0);
});
