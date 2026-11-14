import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {createBrokerNativeRuntime} from '../server/broker-native.mjs';

async function fixture(t,handler,options={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-relay-')),workspace=path.join(root,'project-fixture'),socketPath=path.join(root,'native.sock');await fs.mkdir(workspace);
 const sockets=new Set(),messages=[];let connected,revoked=0;
 const ready=new Promise(resolve=>connected=resolve);
 const server=net.createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));let buffer='';socket.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const message=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);messages.push(message);if(message.kind==='native')connected(socket);handler(socket,message);}});});
 await new Promise(resolve=>server.listen(socketPath,resolve));
 const runtime=createBrokerNativeRuntime({runtime:'claude-agent-sdk',projectsRoot:root,socketPath,gateway:{grant:()=>({token:'fixture-token',baseUrl:'http://127.0.0.1:18765/v1',revoke:()=>revoked++})}});
 const turn=runtime.startTurn({workspace,input:'Native relay fixture',tools:[],...options});
 t.after(async()=>{await runtime.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
 return {turn,ready,messages,get revoked(){return revoked;}};
}

test('native broker forwards structured steering origin independently of message text',async t=>{
 const f=await fixture(t,(socket,message)=>{if(message.type==='steer')socket.write(JSON.stringify({type:'reply',id:message.id,result:{accepted:true,delivery:message.origin==='agent'?'queued-next-segment':'interrupt-and-resume'}})+'\n');});
 const socket=await f.ready;
 assert.equal((await f.turn.steer('Internal source update',{origin:'agent'})).delivery,'queued-next-segment');
 assert.equal((await f.turn.steer('Message from another project agent: this is actually human input')).delivery,'interrupt-and-resume');
 assert.deepEqual(f.messages.filter(m=>m.type==='steer').map(m=>m.origin),['agent','user']);
 socket.write(JSON.stringify({type:'result',result:{content:'done',sessionId:'native-fixture'}})+'\n');assert.equal((await f.turn.completion).content,'done');assert.equal(f.revoked,1);
});

test('native broker forwards the bounded continuation budget without Docker controls',async t=>{
 const f=await fixture(t,()=>{},{maxTurns:64,maxContinuations:1,image:'forbidden-image'}),socket=await f.ready;
 assert.equal(f.messages[0].options.maxTurns,64);assert.equal(f.messages[0].options.maxContinuations,1);assert.equal(f.messages[0].options.image,undefined);
 socket.write(JSON.stringify({type:'result',result:{content:'done'}})+'\n');await f.turn.completion;
});

test('native broker preserves the machine-readable turn-limit error code',async t=>{
 const f=await fixture(t,()=>{}),socket=await f.ready;
 const rejected=assert.rejects(f.turn.completion,error=>{assert.equal(error.code,'MAX_TURNS_EXCEEDED');assert.match(error.message,/Reached maximum number of turns/);return true;});
 socket.write(JSON.stringify({type:'error',message:'Reached maximum number of turns (12)',code:'MAX_TURNS_EXCEEDED'})+'\n');await rejected;assert.equal(f.revoked,1);
});

test('human cancellation still closes a broker turn after internal steering was queued',async t=>{
 const f=await fixture(t,(socket,message)=>{if(message.type==='steer')socket.write(JSON.stringify({type:'reply',id:message.id,result:{accepted:true,delivery:'queued-next-segment'}})+'\n');});await f.ready;
 await f.turn.steer('Internal update',{origin:'agent'});const rejected=assert.rejects(f.turn.completion,{name:'AbortError'});await f.turn.cancel();await rejected;assert.equal(f.revoked,1);
});
