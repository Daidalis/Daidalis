import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createFlightContainerRunner} from '../server/flight-container-runner.mjs';
async function fixture(t,respond){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'flight-rpc-')),socketPath=path.join(dir,'worker.sock'),sockets=new Set();const server=net.createServer(s=>{sockets.add(s);s.on('error',()=>{});s.on('close',()=>sockets.delete(s));let b='';s.on('data',c=>{b+=c;if(b.endsWith('\n'))respond(JSON.parse(b),s);});});await new Promise(r=>server.listen(socketPath,r));const runner=createFlightContainerRunner({socketPath});t.after(async()=>{await runner.close();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});return runner;}
test('flight runner rejects STF receipts for different sources',async t=>{const runner=await fixture(t,(_r,s)=>s.end(JSON.stringify({ok:true,result:{receipt:{inputHash:'a',sourceFiles:[]}}})+'\n'));await assert.rejects(runner.run({inputHash:'a',sourceFiles:[{path:'table.c',sha256:'b'}]}),/differs/);});
test('flight cancellation closes the worker connection while a native job is pending',async t=>{let entered,closed;const start=new Promise(r=>entered=r),end=new Promise(r=>closed=r);const runner=await fixture(t,(_r,s)=>{s.on('end',closed);entered();});const c=new AbortController(),pending=runner.run({sourceFiles:[]},{signal:c.signal});const rejected=assert.rejects(pending,/cancelled/);await start;c.abort();await rejected;await end;});
test('flight reports unavailable without claiming a missing socket is ready',async()=>{const r=createFlightContainerRunner({socketPath:'/tmp/manta-missing-flight-'+process.pid+'.sock'});try{const status=await r.status();assert.equal(status.ready,false);assert.equal(status.tools['nos3-stf'].ready,false);}finally{await r.close();}});
