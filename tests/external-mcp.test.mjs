import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {createConnectorService} from '../server/connectors.mjs';
import {createStore} from '../server/store.mjs';

const require=createRequire(import.meta.url);
const sdkURL=name=>pathToFileURL(require.resolve(`@modelcontextprotocol/sdk/${name}`)).href;
async function fixture(t,options={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-external-mcp-'));
  const store=createStore({dataDir:path.join(root,'data'),seed:false});
  const project=store.createProject({name:'External tool project'});
  const service=createConnectorService({store,...options});
  t.after(async()=>{await service.close();await fs.rm(root,{recursive:true,force:true});});
  return {root,store,project,service};
}
async function stdioFixture(t,options={}) {
  const h=await fixture(t,options),file=path.join(h.root,'fixture-server.mjs');
  await fs.writeFile(file,`
import {Server} from ${JSON.stringify(sdkURL('server/index.js'))};
import {StdioServerTransport} from ${JSON.stringify(sdkURL('server/stdio.js'))};
import {ListToolsRequestSchema,CallToolRequestSchema} from ${JSON.stringify(sdkURL('types.js'))};
let cancelled=false;
const server=new Server({name:'real-stdio-fixture',version:'1.0.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,()=>({tools:[
{name:'echo',description:'Fixture echo',inputSchema:{type:'object',properties:{text:{type:'string'}}},annotations:{readOnlyHint:true}},
{name:'environment',inputSchema:{type:'object'},annotations:{readOnlyHint:true}},
{name:'large',inputSchema:{type:'object'}},
{name:'wait',inputSchema:{type:'object'}},
{name:'cancelled',inputSchema:{type:'object'}}
]}));
server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
let value;
if(request.params.name==='echo')value=request.params.arguments.text||'';
else if(request.params.name==='environment')value=JSON.stringify({HOME:process.env.HOME,PATH:process.env.PATH,OPENAI_API_KEY:process.env.OPENAI_API_KEY||null,API_TOKEN:process.env.API_TOKEN||null,explicit:process.env.EXPLICIT||null});
else if(request.params.name==='large')value='z'.repeat(250000);
else if(request.params.name==='cancelled')value=String(cancelled);
else if(request.params.name==='wait')value=await new Promise(resolve=>{const timer=setTimeout(()=>resolve('late'),30000);extra.signal.addEventListener('abort',()=>{cancelled=true;clearTimeout(timer);resolve('cancelled');},{once:true});});
return {content:[{type:'text',text:value}]};
});
await server.connect(new StdioServerTransport());
`);
  const config={id:'fixture',name:'Fixture server',transport:'stdio',enabled:true,command:process.execPath,args:[file],toolPolicies:{echo:'read',environment:'read',cancelled:'read',wait:'run',large:'run'}};
  return {...h,file,config};
}

test('configuration is user initiated, disabled by default and scoped to one project',async t=>{
  const h=await fixture(t),config={name:'Disabled service',transport:'http',url:'http://127.0.0.1:9/mcp'};
  await assert.rejects(h.service.save(h.project.id,config),/explicitly by the user/);
  const row=await h.service.save(h.project.id,config,{userInitiated:true});
  assert.equal(row.enabled,false);assert.equal(row.status,'disabled');
  await assert.rejects(h.service.test(h.project.id,row.id),/disabled/);
  assert.deepEqual(await h.service.tools(h.project.id),[]);
  const second=h.store.createProject({name:'Other project'});
  assert.deepEqual(h.service.list(second.id),[]);
  const filename=path.join(h.store.dataDir,'project-connectors',`${h.project.id}.json`);
  assert.equal((await fs.stat(filename)).mode&0o777,0o600);
  const reloaded=createConnectorService({store:h.store});t.after(()=>reloaded.close());
  assert.equal(reloaded.list(h.project.id)[0].id,row.id);
  await assert.rejects(h.service.remove(h.project.id,row.id),/explicitly/);
  assert.deepEqual(await h.service.remove(h.project.id,row.id,{userInitiated:true}),{removed:true,id:row.id});
});

test('real stdio SDK handshake discovers tools and executes with an isolated environment',async t=>{
  const secret='test-connector-secret-72918';
  const h=await stdioFixture(t,{env:{MANTA_MCP_FIXTURE:secret,OPENAI_API_KEY:'must-not-inherit'}});
  await h.service.save(h.project.id,{...h.config,env:{EXPLICIT:'allowed'},envFrom:{API_TOKEN:'MANTA_MCP_FIXTURE'}},{userInitiated:true});
  const connected=await h.service.test(h.project.id,'fixture');
  assert.equal(connected.server.name,'real-stdio-fixture');assert.equal(connected.tools.length,5);assert.equal(connected.connector.status,'connected');
  const result=await h.service.call(h.project.id,'fixture','echo',{text:'from actual server'});
  assert.equal(result.result.content[0].text,'from actual server');assert.equal(result.untrusted,true);
  const environment=JSON.parse((await h.service.call(h.project.id,'fixture','environment')).result.content[0].text);
  assert.equal(environment.OPENAI_API_KEY,null);assert.equal(environment.API_TOKEN,'[REDACTED]');assert.equal(environment.explicit,'allowed');
  assert.notEqual(environment.HOME,os.homedir());assert.ok(environment.HOME.startsWith(await fs.realpath(h.store.dataDir)));assert.ok(!environment.PATH.includes('/opt/homebrew'));
  const disk=await fs.readFile(path.join(h.store.dataDir,'project-connectors',`${h.project.id}.json`),'utf8');
  assert.ok(!disk.includes(secret));assert.ok(!JSON.stringify(connected).includes(secret));
});

test('remote annotations do not grant read permission and unknown tools require approval',async t=>{
  const h=await stdioFixture(t);
  await h.service.save(h.project.id,{...h.config,toolPolicies:{}},{userInitiated:true});
  const tool=await h.service.describeTool(h.project.id,'fixture','echo');
  assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.effect,'write');assert.equal(tool.policyConfigured,false);assert.equal(tool.requiresApproval,true);
  await assert.rejects(h.service.call(h.project.id,'fixture','echo',{text:'deny'}),/requires approval/);
  const result=await h.service.call(h.project.id,'fixture','echo',{text:'approved'},{approved:true});
  assert.equal(result.result.content[0].text,'approved');
  await assert.rejects(h.service.call(h.project.id,'fixture','not-in-catalog',{}, {approved:true}),/not found/);
});

test('tool output is bounded and cancellation reaches the actual MCP server',async t=>{
  const h=await stdioFixture(t);
  await h.service.save(h.project.id,h.config,{userInitiated:true});
  const output=await h.service.call(h.project.id,'fixture','large',{}, {approved:true});
  assert.equal(output.truncated,true);assert.ok(JSON.stringify(output).length<101000);
  const controller=new AbortController();
  const waiting=h.service.call(h.project.id,'fixture','wait',{}, {approved:true,signal:controller.signal});
  setTimeout(()=>controller.abort(),100);
  await assert.rejects(waiting,/abort|cancel/i);
  // The cancelled notification and next request are ordered on the same stdio stream.
  const proof=await h.service.call(h.project.id,'fixture','cancelled');assert.equal(proof.result.content[0].text,'true');
  controller.abort();await assert.rejects(h.service.tools(h.project.id,'fixture',{signal:controller.signal}),/cancelled/);
});

test('unsafe configuration cannot install packages, escape workspace, inherit credentials or embed tokens',async t=>{
  const h=await fixture(t),base={name:'Safety checks',transport:'stdio',enabled:true,command:process.execPath,args:[]};
  for(const [input,pattern]of [
    [{...base,command:'node'},/absolute path/],
    [{...base,command:'/usr/bin/npx'},/installation/],
    [{...base,cwd:'../outside'},/escapes/],
    [{...base,env:{HOME:'/Users/person'}},/managed/],
    [{...base,env:{API_KEY:'persist-secret'}},/references/],
    [{...base,envFrom:{API_KEY:'OPENAI_API_KEY'}},/dedicated/],
    [{...base,args:['--token','argument-secret']},/envFrom/],
    [{name:'HTTP',transport:'http',url:'http://example.com/mcp'},/HTTPS/],
    [{name:'HTTP',transport:'http',url:'https://user:pass@example.com/mcp'},/without credentials/],
    [{name:'HTTP',transport:'http',url:'https://example.com/mcp?api_key=secret'},/runtime key/],
    [{name:'HTTP',transport:'http',url:'https://example.com/mcp',accessTokenEnv:'ANTHROPIC_API_KEY'},/dedicated/]
  ])await assert.rejects(h.service.save(h.project.id,input,{userInitiated:true}),pattern);
  assert.deepEqual(h.service.list(h.project.id),[]);
});

test('real streamable HTTP MCP uses runtime authentication without persisting or exposing the key',async t=>{
  const h=await fixture(t),connections=[],authorization=[],secret='runtime-http-secret-81631';
  const httpServer=http.createServer(async(req,res)=>{
    authorization.push(req.headers.authorization);
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    const server=new Server({name:'real-http-fixture',version:'2.0.0'},{capabilities:{tools:{}}});
    server.setRequestHandler(ListToolsRequestSchema,()=>({tools:[{name:'echo',inputSchema:{type:'object'}}]}));
    server.setRequestHandler(CallToolRequestSchema,()=>({content:[{type:'text',text:`Bearer ${secret}`}]}));
    connections.push({server,transport});
    try{await server.connect(transport);await transport.handleRequest(req,res);}catch(error){if(!res.headersSent)res.writeHead(500);res.end(String(error));}
  });
  await new Promise((resolve,reject)=>{httpServer.once('error',reject);httpServer.listen(0,'127.0.0.1',resolve);});
  t.after(async()=>{await Promise.all(connections.map(c=>c.server.close().catch(()=>{})));await new Promise(resolve=>{httpServer.close(resolve);httpServer.closeAllConnections();});});
  const address=httpServer.address(),url=`http://127.0.0.1:${address.port}/mcp`;
  await h.service.save(h.project.id,{id:'http',name:'Loopback worker',transport:'http',enabled:true,url,toolPolicies:{echo:'read'}},{userInitiated:true,runtimeKey:secret});
  const connected=await h.service.test(h.project.id,'http');assert.equal(connected.server.name,'real-http-fixture');
  const result=await h.service.call(h.project.id,'http','echo');assert.ok(!JSON.stringify(result).includes(secret));assert.match(result.result.content[0].text,/REDACTED/);
  assert.ok(authorization.length>=3);assert.ok(authorization.every(value=>value===`Bearer ${secret}`));
  const disk=await fs.readFile(path.join(h.store.dataDir,'project-connectors',`${h.project.id}.json`),'utf8');assert.ok(!disk.includes(secret));
  assert.equal(h.service.list(h.project.id)[0].hasRuntimeKey,true);
});

test('HTTP redirects cannot forward configured credentials to another origin',async t=>{
  const h=await fixture(t,{fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://elsewhere.example/mcp'}})});
  await h.service.save(h.project.id,{id:'redirect',name:'Redirect check',transport:'http',enabled:true,url:'https://worker.example/mcp'},{userInitiated:true,runtimeKey:'redirect-credential-secret'});
  await assert.rejects(h.service.test(h.project.id,'redirect'),/redirect/i);
  assert.ok(!JSON.stringify(h.service.list(h.project.id)).includes('redirect-credential-secret'));
});

test('missing dedicated credentials fail before a server is started and configuration replacement closes sessions',async t=>{
  const h=await stdioFixture(t,{env:{}});
  await h.service.save(h.project.id,{...h.config,envFrom:{API_TOKEN:'MANTA_MCP_MISSING'}},{userInitiated:true});
  await assert.rejects(h.service.test(h.project.id,'fixture'),/Missing MCP environment/);
  await h.service.save(h.project.id,h.config,{userInitiated:true});
  await h.service.test(h.project.id,'fixture');
  await h.service.save(h.project.id,{...h.config,enabled:false},{userInitiated:true});
  assert.equal(h.service.list(h.project.id)[0].status,'disabled');
  await assert.rejects(h.service.call(h.project.id,'fixture','echo',{}),/disabled/);
});
