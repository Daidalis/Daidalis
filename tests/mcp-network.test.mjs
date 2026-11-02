import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {normalizeMcpNetwork} from '../shared/mcp-network.mjs';
import {createMcpEgress,publicEgressAddress} from '../server/mcp-egress.mjs';
import {createMcpProxy} from '../deploy/runner/mcp-proxy.mjs';

test('network policy accepts exact DNS names and excludes broad/ambiguous destinations',()=>{
 assert.deepEqual(normalizeMcpNetwork({allowedHosts:[' API.Example.com ','api.example.com']}),{allowedHosts:['api.example.com']});
 for(const host of ['*.example.com','https://example.com','example.com:443','example.com.','127.0.0.1','localhost','host.local','metadata.google.internal','example.com/x','0x7f000001'])assert.throws(()=>normalizeMcpNetwork({allowedHosts:[host]}));
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','172.16.0.1','100.64.0.1','198.18.0.1','192.0.2.1','198.51.100.1','203.0.113.1','::1','::ffff:7f00:1','fd00::1','fe80::1','2001:db8::1','2002:7f00:1::','3fff::1'])assert.equal(publicEgressAddress(ip),false,ip);
 for(const ip of ['1.1.1.1','8.8.8.8','2606:4700::1111','2001:4860:4860::8888'])assert.equal(publicEgressAddress(ip),true,ip);
});

test('gateway rejects unlisted hosts and mixed/private DNS before opening a connection',async()=>{
 let lookups=0;
 const gateway=createMcpEgress({network:{allowedHosts:['api.example.com']},send:()=>{},resolver:async()=>{lookups++;return [{address:'1.1.1.1',family:4},{address:'127.0.0.1',family:4}];}});
 try{
  await assert.rejects(gateway.open({id:'one',host:'sub.api.example.com',port:443}),/not allowed/);
  await assert.rejects(gateway.open({id:'one',host:'api.example.com',port:80}),/not allowed/);assert.equal(lookups,0);
  await assert.rejects(gateway.open({id:'one',host:'api.example.com',port:443}),/private or reserved/);assert.equal(lookups,1);
 }finally{gateway.close();}
});

test('gateway cancellation during DNS never connects and releases the pending operation',async()=>{
 let finish;const resolving=new Promise(resolve=>{finish=resolve;});
 const gateway=createMcpEgress({network:{allowedHosts:['api.example.com']},send:()=>{},resolver:()=>resolving});
 const pending=gateway.open({id:'one',host:'api.example.com',port:443});const rejected=assert.rejects(pending,/abort|closed|cancel/i);
 gateway.close();finish([{address:'1.1.1.1',family:4}]);await rejected;
 await assert.rejects(gateway.open({id:'two',host:'api.example.com',port:443}),/not allowed/);
});

test('proxy relays large binary streams with pinned DNS, then closes active sockets on cancellation',async t=>{
 const sockets=new Set();const server=net.createServer(s=>{sockets.add(s);s.on('error',()=>{});s.on('close',()=>sockets.delete(s));s.on('data',bytes=>s.write(bytes));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let proxy,gateway,lookups=0;
 // Only the test dialer maps a checked public address to a loopback echo fixture.
 // Production uses net.connect with the checked lookup callback directly.
 gateway=createMcpEgress({network:{allowedHosts:['api.example.com']},send:m=>queueMicrotask(()=>proxy.handle(m)),resolver:async()=>{lookups++;return [{address:'1.1.1.1',family:4}];},connect:options=>{
  const socket=new net.Socket();options.lookup(options.host,{},(error,ip,family)=>{if(error)return socket.destroy(error);assert.equal(ip,'1.1.1.1');assert.equal(family,4);socket.connect(server.address().port,'127.0.0.1');});return socket;
 }});
 proxy=await createMcpProxy({send:m=>queueMicrotask(()=>gateway.handle(m)),callback:(_method,args)=>gateway.open(args)});
 t.after(async()=>{gateway.close();await proxy.close();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));});
 const target=new URL(proxy.env.HTTPS_PROXY),client=net.connect(Number(target.port),'127.0.0.1');t.after(()=>client.destroy());
 const payload=Buffer.alloc(512*1024);for(let i=0;i<payload.length;i++)payload[i]=i%251;
 await new Promise((resolve,reject)=>{
  let buffer=Buffer.alloc(0),connected=false;const timer=setTimeout(()=>reject(Error('relay timeout')),10000);
  client.on('error',reject);client.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);if(!connected){const pos=buffer.indexOf('\r\n\r\n');if(pos<0)return;assert.match(buffer.subarray(0,pos).toString(),/200 Connection Established/);buffer=buffer.subarray(pos+4);connected=true;client.write(payload);}if(connected&&buffer.length===payload.length){clearTimeout(timer);assert.deepEqual(buffer,payload);resolve();}});
  client.write('CONNECT api.example.com:443 HTTP/1.1\r\nHost: api.example.com:443\r\n\r\n');
 });
 assert.equal(lookups,1);
 const closed=new Promise(r=>client.once('close',r));gateway.close();await closed;
});
