import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStudioServer} from '../server/index.mjs';

// This check never invokes a model, starts a solver, or uses a saved workspace.
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'manta-smoke-'));
let app;
const checks=[];
try {
  app=await createStudioServer({dataDir:path.join(temporary,'data'),seed:false,addDefaultCodexProvider:false});
  const address=await app.listen({port:0});
  const base='http://127.0.0.1:'+address.port;
  for(const route of ['/api/health','/','/app.js','/shared/run-presentation.mjs','/api/bootstrap']) {
    const response=await fetch(base+route);
    assert.equal(response.status,200,route+' should respond successfully');
    const body=await response.text();
    assert(body.length>0,route+' should have content');
    if(route==='/api/health')assert.equal(JSON.parse(body).ok,true);
    if(route==='/api/bootstrap') {
      const bootstrap=JSON.parse(body);
      assert.deepEqual(bootstrap.projects,[],'Smoke must not read an existing project');
      assert(bootstrap.capabilities.agentRuntimes.includes('codex-app-server'));
      assert(bootstrap.capabilities.agentRuntimes.includes('claude-agent-sdk'));
    }
    checks.push({route,status:response.status});
  }
  const crossOrigin=await fetch(base+'/api/health',{headers:{origin:'https://example.com'}});
  assert.equal(crossOrigin.status,403,'Cross-origin requests must be rejected');
  await crossOrigin.arrayBuffer();
  checks.push({route:'cross-origin protection',status:crossOrigin.status});
  // Node fetch can normalize Host. Use a raw HTTP request to test the guard.
  const invalidHost=await new Promise((resolve,reject)=>{
    const request=http.get(base+'/api/health',{headers:{Host:'invalid.example'}},response=>{
      response.resume();response.on('end',()=>resolve(response.statusCode));
    });
    request.setTimeout(5000,()=>request.destroy(new Error('Host check timed out')));
    request.on('error',reject);
  });
  assert.equal(invalidHost,403,'Invalid Host requests must be rejected');
  checks.push({route:'Host protection',status:invalidHost});
  console.log(JSON.stringify({passed:true,node:process.version,platform:process.platform,checks},null,2));
} catch(error) {
  console.error('Manta smoke failed: '+error.message);
  process.exitCode=1;
} finally {
  try {await app?.close();} finally {await fs.rm(temporary,{recursive:true,force:true});}
}
