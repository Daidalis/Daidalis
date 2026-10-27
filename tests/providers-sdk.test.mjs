import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStore} from '../server/store.mjs';
import {createProviderManager} from '../server/providers.mjs';
import {createStudioServer} from '../server/index.mjs';
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'syspilot-provider-sdk-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return {dir,store:createStore({dataDir:dir,seed:false})};}
const json=body=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
const messages=[{role:'system',content:'rules'},{role:'user',content:'look'},{role:'assistant',content:'',tool_calls:[{id:'c',type:'function',function:{name:'computer_use',arguments:'{}'}}]},{role:'tool',tool_call_id:'c',content:'screenshot',images:[{mediaType:'image/png',data:'YWN0dWFs'}]}];

test('official OpenAI and Anthropic clients retain URLs, image/tool formats and stateless Responses reasoning',async t=>{
 const {store}=await fixture(t),requests=[];
 const output=[{type:'reasoning',id:'r1',encrypted_content:'encrypted-state',summary:[]},{type:'function_call',id:'f1',call_id:'call_1',name:'read_file',arguments:'{}'}];
 let responseCalls=0;
 const manager=createProviderManager({store,fetchImpl:async(url,options)=>{const request={url:String(url),body:JSON.parse(options.body),headers:new Headers(options.headers)};requests.push(request);if(request.url.endsWith('/responses'))return json({output:responseCalls++? [{type:'message',content:[{type:'output_text',text:'done'}]}]:output});if(request.url.endsWith('/messages'))return json({content:[{type:'text',text:'Anthropic'}]});return json({choices:[{message:{content:'Chat'}}]});}});
 for(const type of ['openai-compatible','anthropic']){const p=manager.create({name:type,type,model:'test-model',apiKey:'private-sdk-key'});await manager.complete(p.id,{messages});}
 assert.equal(requests[0].url,'https://api.openai.com/v1/chat/completions');assert.equal(requests[0].body.messages.at(-1).content[1].image_url.url,'data:image/png;base64,YWN0dWFs');assert.equal(requests[0].headers.get('authorization'),'Bearer private-sdk-key');
 assert.equal(requests[1].url,'https://api.anthropic.com/v1/messages');assert.equal(requests[1].body.messages.at(-1).content[0].content[1].source.data,'YWN0dWFs');assert.equal(requests[1].headers.get('x-api-key'),'private-sdk-key');
 const p=manager.create({name:'Responses',type:'openai-responses',model:'test',apiKey:'private-sdk-key'}),first=await manager.complete(p.id,{messages:[{role:'user',content:'read'}]});
 await manager.complete(p.id,{messages:[{role:'user',content:'read'},{role:'assistant',content:'',responseItems:first.responseItems},{role:'tool',tool_call_id:'call_1',content:'ok'}]});
 assert.deepEqual(requests[3].body.input.slice(1,3),output);assert.equal(requests[3].body.store,false);assert.deepEqual(requests[3].body.include,['reasoning.encrypted_content']);
 assert.ok(requests.every(r=>!r.url.includes('traces')));
});

test('provider updates preserve memory-only keys unless explicitly cleared; public data never includes resolved keys',async t=>{
 const {store,dir}=await fixture(t),manager=createProviderManager({store});
 const p=manager.create({name:'Claude native',type:'claude-agent',apiKey:'native-private-secret'});assert.equal(p.runtime,'claude-agent-sdk');assert.equal(p.model,'');
 manager.update(p.id,{name:'Renamed',apiKey:''});assert.equal(manager.getConfig(p.id).apiKey,'native-private-secret');manager.update(p.id,{model:'chosen'});assert.equal(manager.getConfig(p.id).apiKey,'native-private-secret');
 const clone=manager.getConfig(p.id);clone.name='changed';assert.equal(manager.getConfig(p.id).name,'Renamed');
 assert.ok(!JSON.stringify(manager.list()).includes('native-private-secret'));assert.ok(!(await fs.readFile(path.join(dir,'state.json'),'utf8')).includes('native-private-secret'));
 manager.update(p.id,{clearApiKey:true});assert.equal(manager.getConfig(p.id).apiKey,'');assert.equal(manager.list().find(x=>x.id===p.id).configured,false);
 for(const invalid of [{model:7},{baseUrl:'file:///tmp'},{unknown:true},{type:'openai-compatible',model:''},{apiKey:5}])assert.throws(()=>manager.update(p.id,invalid));
 assert.equal(manager.getConfig(p.id).type,'claude-agent');
});

test('legacy Codex profiles are native-only and native test never executes the old JSON transport',async t=>{
 const {store}=await fixture(t);const manager=createProviderManager({store,codexPath:'/no/codex'});
 const p=manager.create({name:'Native',type:'codex-app-server'});assert.equal(p.configured,false);assert.equal(p.runtime,'codex-app-server');
 await assert.rejects(manager.complete('codex-local',{messages:[]}),/Native profiles require/);
 const probe=await manager.test(p.id);assert.equal(probe.ok,false);assert.equal(probe.authenticationVerified,false);
});

test('read-isolated Codex needs an explicitly configured Responses key',async t=>{
 const {store}=await fixture(t),manager=createProviderManager({store,codexPath:process.execPath,codexRequiresApiKey:true});
 assert.equal(manager.list().find(p=>p.id==='codex-local').configured,false);
 manager.update('codex-local',{baseUrl:'https://api.openai.com/v1',apiKey:'local-test-key'});
 assert.equal(manager.list().find(p=>p.id==='codex-local').configured,true);
 manager.update('codex-local',{clearApiKey:true});
 assert.equal(manager.list().find(p=>p.id==='codex-local').configured,false);
});

test('isolated Codex connection test uses a disposable folder inside the VM shared root',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-isolated-provider-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const shared=path.join(root,'shared'),dataDir=path.join(root,'data');await fs.mkdir(shared);
 let testedWorkspace;
 const app=await createStudioServer({dataDir,seed:false,computer:false,engineering:false,nos3:false,connectors:false,modelBackend:false,localVm:false,professionalRunner:false,professionalModels:false,stfCase:false,codexPath:process.execPath,engineOptions:{codexRemoteWorkspace:{hostRoot:shared},runtimeAdapters:{'codex-app-server':{startTurn(options){testedWorkspace=options.workspace;return {completion:Promise.resolve({content:'OK'})};},close:async()=>{}}}}});
 t.after(()=>app.close());const address=await app.listen({port:0});
 const response=await fetch(`http://127.0.0.1:${address.port}/api/providers/codex-local/test`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 assert.equal(response.status,200);const result=await response.json();assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(path.dirname(testedWorkspace),shared);assert.match(path.basename(testedWorkspace),/^test-[A-Za-z0-9_-]+$/);
 assert.deepEqual(await fs.readdir(shared),[]);
});

test('official SDK errors are redacted before returning to the application',async t=>{
 const {store}=await fixture(t);const manager=createProviderManager({store,fetchImpl:async()=>new Response(JSON.stringify({error:{message:'rejected secret-to-redact',type:'invalid_request_error'}}),{status:401,headers:{'content-type':'application/json'}})});
 const p=manager.create({name:'API',type:'openai-compatible',model:'test',apiKey:'secret-to-redact'});
 await assert.rejects(manager.complete(p.id,{messages:[{role:'user',content:'test'}]}),e=>!e.message.includes('secret-to-redact')&&e.message.includes('[REDACTED]'));
});
