import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {createBrokerSession} from '../server/broker-session.mjs';
async function fixture(t,handler){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'broker-session-')),workspace=path.join(root,'project-one'),socketPath=path.join(root,'broker.sock');await fs.mkdir(workspace);
 const sockets=new Set(),messages=[];
 const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer='';socket.on('data',chunk=>{buffer+=chunk;let pos;while((pos=buffer.indexOf('\n'))>=0){const m=JSON.parse(buffer.slice(0,pos));buffer=buffer.slice(pos+1);messages.push(m);handler(socket,m);}});});
 await new Promise(resolve=>server.listen(socketPath,resolve));
 const session=createBrokerSession({runtime:'mcp',workspace,projectsRoot:root,socketPath,options:{command:'/usr/bin/node',args:[],cwd:'.',env:{}}});
 t.after(async()=>{session.close();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});});
 return {session,messages,sockets,root,workspace,socketPath};
}
test('broker sessions send a managed project identity and reject use after close',async t=>{
 const f=await fixture(t,(socket,m)=>{if(m.kind)socket.write('{"type":"ready"}\n');else socket.write(JSON.stringify({type:'reply',id:m.id,result:'done'})+'\n');});
 let sent;assert.equal(await f.session.request('status',{}, {onSent:id=>{sent=id;}}),'done');assert.equal(sent,1);assert.equal(f.messages[0].project,'project-one');assert.equal(f.messages[0].kind,'service');assert.equal(JSON.stringify(f.messages).includes(f.root),false);
 f.session.close();await assert.rejects(f.session.request('status',{}),/closed/);
});
test('cancellation during session startup closes the broker connection',async t=>{
 const f=await fixture(t,()=>{}),controller=new AbortController();
 const pending=f.session.request('action',{}, {signal:controller.signal});
 const rejected=assert.rejects(pending,/Cancelled/);controller.abort();await rejected;assert.equal(f.session.closed,true);
});
test('malformed worker output rejects pending requests instead of escaping the relay',async t=>{
 const f=await fixture(t,(socket,m)=>{socket.write(m.kind?'{"type":"ready"}\n':'not JSON\n');});
 await assert.rejects(f.session.request('action',{}),/Invalid session response/);assert.equal(f.session.closed,true);
});
test('a sibling or symlinked external workspace cannot become a session mount',async t=>{
 const f=await fixture(t,()=>{});const outside=await fs.mkdtemp(path.join(os.tmpdir(),'outside-session-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));
 const link=path.join(f.root,'project-link');await fs.symlink(outside,link);
 for(const workspace of [outside,link])assert.throws(()=>createBrokerSession({runtime:'mcp',workspace,projectsRoot:f.root,socketPath:f.socketPath,options:{}}),/Managed project/);
});
