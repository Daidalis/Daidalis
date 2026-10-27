import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createStore} from '../server/store.mjs';
import {createToolRuntime} from '../server/tools.mjs';
import {commandSandboxAvailable} from '../server/sandbox.mjs';

const quote=value=>"'"+value.replaceAll("'", "'\\''")+"'";
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-auto-policy-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=createStore({dataDir:path.join(root,'data'),seed:false});
  const project=store.createProject({name:'Sandbox Auto'}),workspace=store.workspace(project.id);
  return {root,store,project,workspace};
}

test('Auto executes a real compound command in the project OS sandbox without routine approval', {skip:!commandSandboxAvailable()},async t=>{
  const h=await fixture(t);let approvals=0;
  const runtime=createToolRuntime({store:h.store,emit:()=>{},requestApproval:async()=>{approvals++;return false;}});
  const result=await runtime.execute('run_command',{command:"pwd && printf '%s' verified > result.txt && cat result.txt"},{projectId:h.project.id,permissionMode:'auto'});
  assert.equal(result.code,0,result.stderr);assert.match(result.stdout,/verified/);assert.equal(await fs.readFile(path.join(h.workspace,'result.txt'),'utf8'),'verified');assert.equal(approvals,0);
});

test('Auto commands keep project-external reads, writes and network blocked', {skip:!commandSandboxAvailable()},async t=>{
  const h=await fixture(t),outside=path.join(h.root,'outside.txt');await fs.writeFile(outside,'HOST_SENTINEL');let approvals=0,requests=0;
  const server=http.createServer((_req,res)=>{requests++;res.end('outside network');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const runtime=createToolRuntime({store:h.store,emit:()=>{},requestApproval:async()=>{approvals++;return true;}}),ctx={projectId:h.project.id,permissionMode:'auto'};
  const read=await runtime.execute('run_command',{command:'cat '+quote(outside)},ctx);assert.notEqual(read.code,0);assert.equal(read.stdout.includes('HOST_SENTINEL'),false);
  const write=await runtime.execute('run_command',{command:'printf changed > '+quote(outside)},ctx);assert.notEqual(write.code,0);assert.equal(await fs.readFile(outside,'utf8'),'HOST_SENTINEL');
  const network=await runtime.execute('run_command',{command:'/usr/bin/curl --max-time 2 --silent --show-error http://127.0.0.1:'+server.address().port},ctx);assert.notEqual(network.code,0);assert.equal(requests,0);assert.equal(approvals,0);
});

test('A failed Auto sandbox is reported once and is never retried without isolation',async t=>{
  const h=await fixture(t);let executions=0,approvals=0;
  const runtime=createToolRuntime({store:h.store,emit:()=>{},requestApproval:async()=>{approvals++;return true;},commandExecutor:async()=>{executions++;throw new Error('No supported OS sandbox');}});
  await assert.rejects(runtime.execute('run_command',{command:'printf scoped'},{projectId:h.project.id,permissionMode:'auto'}),/No supported OS sandbox/);
  assert.equal(executions,1);assert.equal(approvals,0);
});

test('Manual shell approval cancellation cannot start the command',async t=>{
  const h=await fixture(t),controller=new AbortController();let executions=0;
  const runtime=createToolRuntime({store:h.store,emit:()=>{},requestApproval:async()=>{controller.abort();return true;},commandExecutor:async()=>{executions++;}});
  await assert.rejects(runtime.execute('run_command',{command:'printf scoped'},{projectId:h.project.id,permissionMode:'manual',signal:controller.signal}),/Cancelled/);assert.equal(executions,0);
});
