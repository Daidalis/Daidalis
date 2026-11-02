// Synthetic local fixtures only; no model credentials or external MCP endpoints.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createConnectorService} from '../../server/connectors.mjs';
import {createBrokerStdioTransport} from '../../server/broker-connectors.mjs';
import {createBrokerComputer} from '../../server/broker-computer.mjs';
const base='http://127.0.0.1:'+process.env.PORT;
async function api(route,body){const r=await fetch(base+route,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const result=await r.json();assert.ok(r.ok,JSON.stringify(result));return result;}
const project=await api('/api/projects',{name:'Broker services acceptance'}),other=await api('/api/projects',{name:'Broker other project boundary'});
await fs.writeFile(other.folderPath+'/private.txt','unrelated project');
const store={dataDir:'/tmp/broker-services-fixture',workspace:id=>{assert.equal(id,project.id);return project.folderPath;},get:(kind,id)=>kind==='projects'&&id===project.id?project:null};
await fs.mkdir(store.dataDir,{recursive:true});
const result=await api('/api/engineering/run',{projectId:project.id,parameters:{duration:120,disturbanceTime:60},scan:{parameter:'heaterMax',values:[10,20]}});
assert.equal(result.status,'completed');assert.equal(result.execution.isolation.daemonRootless,true);assert.equal(result.scenarios.length,2);
for(const file of result.files){const bytes=await fs.readFile(project.folderPath+'/engineering/'+result.id+'/'+file.file);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
console.log('SciPy isolated solver, parameter scan and artifact hashes passed');
const evaluation=await api('/api/evaluate',{projectId:project.id,taskId:'nos3-351',submission:{kind:'quaternion-interface-v1',order:'xyzw',sensorDirection:'sensor-to-inertial',mountDirection:'sensor-to-body',operation:'sensor*conjugate(mount)',normalize:true,invalidPolicy:'reject'}});
assert.equal(evaluation.status,'passed');assert.equal(evaluation.scope,'interface-contract-only');assert.equal(evaluation.upstreamReproduction,false);
console.log('Explicit-scope evaluator route restored');
await fs.writeFile(project.folderPath+'/connector.mjs',`
import {Server} from '/opt/manta/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js';
import {StdioServerTransport} from '/opt/manta/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '/opt/manta/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
import fs from 'node:fs';
const server=new Server({name:'isolated-fixture',version:'1'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,()=>({tools:[{name:'boundary',inputSchema:{type:'object'}},{name:'wait',inputSchema:{type:'object'}}]}));
server.setRequestHandler(CallToolRequestSchema,async(request)=>{if(request.params.name==='wait'){fs.writeFileSync('/work/mcp-started','started');await new Promise(r=>setTimeout(r,5000));fs.writeFileSync('/work/mcp-escaped','bad');}return {content:[{type:'text',text:JSON.stringify({uid:process.getuid(),key:process.env.OPENAI_API_KEY||null,private:fs.existsSync(${JSON.stringify(other.folderPath+'/private.txt')}),socket:fs.existsSync('/run/task-docker.sock'),data:fs.readdirSync('/data'),cwd:process.cwd()})}]};});
await server.connect(new StdioServerTransport());
`);
const connectors=createConnectorService({store,env:{OPENAI_API_KEY:'must-not-be-inherited'},stdioTransportFactory:createBrokerStdioTransport});
try{
 const config=await connectors.save(project.id,{name:'Isolated local fixture',transport:'stdio',command:process.execPath,args:['/work/connector.mjs'],enabled:true,toolPolicies:{boundary:'read',wait:'run'}},{userInitiated:true});
 await connectors.test(project.id,config.id);const response=await connectors.call(project.id,config.id,'boundary',{});const info=JSON.parse(response.result.content[0].text);
 assert.deepEqual(info,{uid:1000,key:null,private:false,socket:false,data:[],cwd:'/work'});
 const controller=new AbortController();
 const pending=connectors.call(project.id,config.id,'wait',{}, {approved:true,signal:controller.signal});
 const rejected=assert.rejects(pending,/cancel|abort/i);
 for(let i=0;i<100;i++){if(await fs.stat(project.folderPath+'/mcp-started').catch(()=>null))break;await new Promise(r=>setTimeout(r,50));}
 await fs.access(project.folderPath+'/mcp-started');controller.abort();await rejected;
 await new Promise(r=>setTimeout(r,5500));await assert.rejects(fs.access(project.folderPath+'/mcp-escaped'));
 console.log('Actual MCP SDK catalog/call, boundaries and non-cooperative cancellation passed');
}finally{await connectors.close();}
const computer=await createBrokerComputer({root:'/opt/manta',dataDir:'/tmp/broker-computer-fixture',store,requestApproval:async()=>false});computer.setBaseUrl(base);
try{
 const call=(action,args={},ctx={source:'user'})=>computer.action({projectId:project.id,action,args},ctx);
 await assert.rejects(call('desktop.enable',{consent:true},{permissionMode:'auto'}),/consent/);
 const started=await call('browser.start');assert.ok(started.imageUrl);
 await assert.rejects(call('browser.navigate',{url:base+'/api/bootstrap'}),/Studio|allowlist/);
 await assert.rejects(call('browser.navigate',{url:base+'/computer-fixture.html',screenVersion:started.screenVersion},{permissionMode:'manual'}),/rejected/);
 const page=await call('browser.navigate',{url:base+'/computer-fixture.html'});assert.ok(page.text);assert.ok(page.imageUrl);
 console.log('Actual browser screenshots, protected API denial and Manual approval passed');
}finally{await computer.close();}
