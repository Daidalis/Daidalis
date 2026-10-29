// Explicit online acceptance: reads example.com using synthetic MCP code only.
// No API credentials, project source or connector token is sent to that site.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createConnectorService} from '../../server/connectors.mjs';
import {createBrokerStdioTransport} from '../../server/broker-connectors.mjs';
const base='http://127.0.0.1:'+process.env.PORT;
async function api(route,body){const r=await fetch(base+route,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const result=await r.json();assert.ok(r.ok,JSON.stringify(result));return result;}
assert.equal((await fetch(base+'/shared/mcp-network.mjs')).status,200);
const project=await api('/api/projects',{name:'Network stdio MCP acceptance'});
const other=await api('/api/projects',{name:'MCP egress unrelated project'});
await fs.writeFile(other.folderPath+'/private.txt','private fixture');
const store={dataDir:'/tmp/mcp-network-acceptance',workspace:id=>{assert.equal(id,project.id);return project.folderPath;},get:(kind,id)=>kind==='projects'&&id===project.id?project:null};
await fs.mkdir(store.dataDir,{recursive:true});
await fs.writeFile(project.folderPath+'/network-fixture.mjs',`
import {Server} from '/opt/manta/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js';
import {StdioServerTransport} from '/opt/manta/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '/opt/manta/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
import fs from 'node:fs';import net from 'node:net';import https from 'node:https';import http from 'node:http';import {execFileSync} from 'node:child_process';
const server=new Server({name:'network-fixture',version:'1'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,()=>({tools:['fetch','https','python','direct','local','environment','wait'].map(name=>({name,inputSchema:{type:'object'}}))}));
server.setRequestHandler(CallToolRequestSchema,async req=>{
 let result;try{
 const url=req.params.arguments?.url||'https://example.com/';
 if(req.params.name==='environment')result={uid:process.getuid(),connectorToken:process.env.API_TOKEN==='synthetic-connector-token',modelKey:!!process.env.OPENAI_API_KEY,otherProject:fs.existsSync(${JSON.stringify(other.folderPath+'/private.txt')}),dockerSocket:fs.existsSync('/run/task-docker.sock'),data:fs.readdirSync('/data')};
 else if(req.params.name==='local'){const local=http.createServer((_req,res)=>res.end('local fixture'));await new Promise(r=>local.listen(0,'127.0.0.1',r));try{const r=await fetch('http://127.0.0.1:'+local.address().port,{signal:AbortSignal.timeout(3000)});result={local:await r.text()};}finally{await new Promise(r=>local.close(r));}}
 else if(req.params.name==='direct')result=await new Promise(resolve=>{const s=net.connect({host:'1.1.1.1',port:443});const finish=ok=>{s.destroy();resolve({connected:ok});};s.setTimeout(1000,()=>finish(false));s.on('error',()=>finish(false));s.on('connect',()=>finish(true));});
 else if(req.params.name==='python')result={status:Number(execFileSync('/usr/bin/python3',['-c','import urllib.request; print(urllib.request.urlopen("https://example.com/",timeout=10).status)'],{encoding:'utf8',timeout:12000}).trim())};
 else if(req.params.name==='https')result=await new Promise((resolve,reject)=>{const r=https.get(url,{timeout:10000},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode}));});r.on('timeout',()=>r.destroy(Error('timeout')));r.on('error',reject);});
 else {const r=await fetch(url,{signal:AbortSignal.timeout(8000)});const text=await r.text();result={status:r.status,example:text.includes('Example Domain')};if(req.params.name==='wait'){fs.writeFileSync('/work/network-started','ready');await new Promise(r=>setTimeout(r,3000));fs.writeFileSync('/work/network-escaped','bad');}}
 }catch{result={denied:true};}
 return {content:[{type:'text',text:JSON.stringify(result)}]};
});await server.connect(new StdioServerTransport());
`);
const connectors=createConnectorService({store,env:{OPENAI_API_KEY:'must-not-be-inherited',MANTA_MCP_FIXTURE_TOKEN:'synthetic-connector-token'},stdioTransportFactory:createBrokerStdioTransport});
let config;
try{
 config=await connectors.save(project.id,{name:'Network fixture',transport:'stdio',command:process.execPath,args:['/work/network-fixture.mjs'],enabled:true,network:{allowedHosts:['example.com']},envFrom:{API_TOKEN:'MANTA_MCP_FIXTURE_TOKEN'},toolPolicies:{fetch:'read',https:'read',python:'read',direct:'read',local:'read',environment:'read',wait:'run'}},{userInitiated:true});
 await connectors.test(project.id,config.id);
 const call=async(name,args={})=>JSON.parse((await connectors.call(project.id,config.id,name,args)).result.content[0].text);
 assert.deepEqual(await call('environment'),{uid:1000,connectorToken:true,modelKey:false,otherProject:false,dockerSocket:false,data:[]});
 assert.deepEqual(await call('fetch'),{status:200,example:true});
 assert.deepEqual(await call('https'),{status:200});
 assert.deepEqual(await call('python'),{status:200});
 assert.deepEqual(await call('fetch',{url:'https://example.org/'}),{denied:true});
 assert.deepEqual(await call('fetch',{url:'https://127.0.0.1/'}),{denied:true});
 const plain=await call('fetch',{url:'http://example.com/'});assert.ok(plain.denied===true||plain.status===405);
 assert.deepEqual(await call('local'),{local:'local fixture'});
 assert.deepEqual(await call('direct'),{connected:false});
 console.log('Real Node fetch/https and Python HTTPS passed; unlisted host, loopback, plaintext HTTP, direct egress and credential/project boundaries enforced');
 const controller=new AbortController();
 const pending=connectors.call(project.id,config.id,'wait',{}, {approved:true,signal:controller.signal});const rejected=assert.rejects(pending,/cancel|abort/i);
 for(let i=0;i<160;i++){if(await fs.stat(project.folderPath+'/network-started').catch(()=>null))break;await new Promise(r=>setTimeout(r,100));}
 await fs.access(project.folderPath+'/network-started');controller.abort();await rejected;await new Promise(r=>setTimeout(r,3500));await assert.rejects(fs.access(project.folderPath+'/network-escaped'));
 config=await connectors.save(project.id,{...config,network:{allowedHosts:[]}},{userInitiated:true});
 assert.deepEqual(await call('fetch'),{denied:true});
 console.log('Cancellation killed the networked MCP worker; removing its host allowlist restored offline behavior');
}finally{await connectors.close();}
