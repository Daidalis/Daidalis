import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createModelGateway} from '../server/model-gateway.mjs';
function request(socketPath,token,route,body){return new Promise((resolve,reject)=>{
 const data=JSON.stringify(body),req=http.request({socketPath,path:route,method:'POST',headers:{authorization:'Bearer '+token,'content-length':Buffer.byteLength(data),'content-type':'application/json'}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text}));});req.on('error',reject);req.end(data);
});}
test('native model grants restrict endpoint, model and lifetime without forwarding task headers',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'model-gateway-')),socketPath=path.join(dir,'model.sock'),calls=[];
 const gateway=await createModelGateway({socketPath,fetchImpl:async(url,options)=>{calls.push({url,options});return new Response('data: {"ok":true,"echo":"actual-upstream-secret"}\n\n',{headers:{'content-type':'text/event-stream'}});}});
 t.after(async()=>{await gateway.close();await fs.rm(dir,{recursive:true,force:true});});
 const grant=gateway.grant({runtime:'codex-app-server',baseUrl:'https://example.invalid/v1',apiKey:'actual-upstream-secret',model:'selected-model'});
 assert.notEqual(grant.token,'actual-upstream-secret');
 const response=await request(socketPath,grant.token,'/v1/responses',{model:'selected-model'});assert.equal(response.status,200);assert.doesNotMatch(response.text,/actual-upstream-secret/);assert.match(response.text,/REDACTED/);
 assert.equal(calls[0].url,'https://example.invalid/v1/responses');assert.equal(calls[0].options.headers.authorization,'Bearer actual-upstream-secret');
 assert.equal((await request(socketPath,grant.token,'/v1/messages',{model:'selected-model'})).status,403);
 assert.equal((await request(socketPath,grant.token,'/v1/responses',{model:'other-model'})).status,502);
 grant.revoke();assert.equal((await request(socketPath,grant.token,'/v1/responses',{model:'selected-model'})).status,403);assert.equal(calls.length,1);
});
