import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createSdkRuntime} from '../server/runtimes/sdk.mjs';
import {createStore} from '../server/store.mjs';
import {createConnectorService} from '../server/connectors.mjs';
import {createWorkspaceViewer} from '../server/workspace-viewer.mjs';

const exec=promisify(execFile),require=createRequire(import.meta.url);
const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function temporary(t){const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'daidalis-rename-')));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return directory;}

test('existing launcher configuration reaches the renamed entry point without sourcing shell input',async t=>{
  const directory=await temporary(t);
  for(const folder of ['scripts','server','shared'])await fs.mkdir(path.join(directory,folder));
  for(const name of ['scripts/launch-config.mjs','scripts/legacy-env.sh','server/environment.mjs','shared/legacy-names.mjs'])await fs.copyFile(path.join(root,name),path.join(directory,name));
  const data=path.join(directory,'existing-project-data');
  await fs.writeFile(path.join(directory,'.env'),'MBSE_DATA_DIR='+data+'\nPORT=14318\n');
  const options={env:{PATH:process.env.PATH},timeout:10000};
  assert.equal((await exec(process.execPath,[path.join(directory,'scripts/launch-config.mjs'),'data'],options)).stdout,data);
  assert.equal((await exec(process.execPath,[path.join(directory,'scripts/launch-config.mjs'),'port'],options)).stdout,'14318');
  const override=path.join(directory,'explicit-new-data');
  assert.equal((await exec(process.execPath,[path.join(directory,'scripts/launch-config.mjs'),'data'],{...options,env:{...options.env,DAIDALIS_DATA_DIR:override}})).stdout,override);
  const launched=await exec('/bin/sh',['-c','. "$1/scripts/legacy-env.sh"; exec "$2" "$1/scripts/launch-config.mjs" data','launcher',directory,process.execPath],options);
  assert.equal(launched.stdout,data,'An unset shell variable must not mask the saved .env directory');
});

test('saved SDK sessions retain opaque upstream history, user text and completed tool results after renaming',async t=>{
  const directory=await temporary(t),sessions=path.join(directory,'sdk-sessions');
  await fs.mkdir(sessions);
  const sessionId='sdk_before_rename',opaque=[{type:'reasoning',id:'reason_legacy',encrypted_content:'opaque-history-that-must-survive'}];
  const old={version:2,id:sessionId,providerId:'api',workspace:directory,revision:2,items:[
    {type:'message',role:'user',content:'My project and file are named MantaParts.sysml.'},
    {type:'function_call',callId:'completed_before_upgrade',name:'read_file',arguments:'{"path":"MantaParts.sysml"}',status:'completed',providerData:{syspilotResponseItems:opaque}},
    {type:'function_call_result',callId:'completed_before_upgrade',name:'read_file',status:'completed',output:'Existing actual model evidence'},
  ]};
  await fs.writeFile(path.join(sessions,sessionId+'.json'),JSON.stringify(old));
  let calls=0;
  const runtime=createSdkRuntime({dataDir:directory,providers:{complete:async(_id,request)=>{
    calls++;
    assert(request.messages.some(m=>m.content==='My project and file are named MantaParts.sysml.'));
    assert.deepEqual(request.messages.find(m=>m.responseItems)?.responseItems,opaque);
    assert(request.messages.some(m=>m.role==='tool'&&m.tool_call_id==='completed_before_upgrade'&&m.content==='Existing actual model evidence'));
    return {content:'Existing work resumed.',responseItems:[{type:'reasoning',encrypted_content:'new-opaque-history'}]};
  }}});
  const result=await runtime.startTurn({providerId:'api',workspace:directory,sessionId,input:'Continue',tools:[{name:'read_file',parameters:{type:'object',properties:{path:{type:'string'}}}}],executeTool:async()=>assert.fail('Completed tools must not replay during the rename')}).completion;
  assert.equal(result.content,'Existing work resumed.');assert.equal(calls,1);
  const saved=JSON.parse(await fs.readFile(path.join(sessions,sessionId+'.json'),'utf8'));
  assert(saved.items.some(item=>item.providerData?.daidalisResponseItems));
});

test('persisted MCP credential references still reach a real isolated tool server after the prefix changes',async t=>{
  const directory=await temporary(t),store=createStore({dataDir:path.join(directory,'data'),seed:false});
  const project=store.createProject({name:'Existing connector'}),serverFile=path.join(directory,'server.mjs');
  const sdk=part=>pathToFileURL(require.resolve('@modelcontextprotocol/sdk/'+part)).href;
  await fs.writeFile(serverFile,`import {Server} from ${JSON.stringify(sdk('server/index.js'))};
import {StdioServerTransport} from ${JSON.stringify(sdk('server/stdio.js'))};
import {ListToolsRequestSchema,CallToolRequestSchema} from ${JSON.stringify(sdk('types.js'))};
const server=new Server({name:'rename-credential-fixture',version:'1.0.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,()=>({tools:[{name:'credential_check',inputSchema:{type:'object'},annotations:{readOnlyHint:true}}]}));
server.setRequestHandler(CallToolRequestSchema,()=>({content:[{type:'text',text:JSON.stringify({received:process.env.API_TOKEN==='fixture-existing-secret',unrelatedInherited:!!process.env.OPENAI_API_KEY})}]}));
await server.connect(new StdioServerTransport());`);
  const configDirectory=path.join(store.dataDir,'project-connectors');await fs.mkdir(configDirectory);
  const config={version:1,connectors:[{id:'existing',name:'Existing MCP',transport:'stdio',enabled:true,command:process.execPath,args:[serverFile],envFrom:{API_TOKEN:'MANTA_MCP_EXISTING'},toolPolicies:{credential_check:'read'}}]};
  const configFile=path.join(configDirectory,project.id+'.json'),before=JSON.stringify(config);
  await fs.writeFile(configFile,before);
  const service=createConnectorService({store,env:{MANTA_MCP_EXISTING:'fixture-existing-secret',OPENAI_API_KEY:'must-stay-private'}});
  t.after(()=>service.close());
  await service.test(project.id,'existing');
  const result=await service.call(project.id,'existing','credential_check',{});
  assert.deepEqual(JSON.parse(result.result.content[0].text),{received:true,unrelatedInherited:false});
  assert.equal(await fs.readFile(configFile,'utf8'),before,'Reading existing configuration must not rewrite it');
});

test('old document history remains readable and byte-identical while new edits use the renamed internal directory',async t=>{
  const directory=await temporary(t),store=createStore({dataDir:path.join(directory,'data'),seed:false});
  const project=store.createProject({name:'Existing documents'}),workspace=store.workspace(project.id),viewer=createWorkspaceViewer({store});
  const editId='edit_12345678-1234-1234-1234-123456789abc',oldPath='.manta/document-history/'+editId+'.txt';
  const bytes=Buffer.from('Original engineering evidence: MantaParts.sysml\n'),current=Buffer.from('Current report\n');
  await fs.mkdir(path.dirname(path.join(workspace,oldPath)),{recursive:true});
  await fs.writeFile(path.join(workspace,oldPath),bytes);await fs.writeFile(path.join(workspace,'report.md'),current);
  store.data.documentEdits=[{id:editId,projectId:project.id,path:'report.md',historyPath:oldPath,previousSha256:sha(bytes),sha256:sha(current),status:'committed',indexStatus:'state'}];store.save();
  const history=await viewer.history({projectId:project.id,editId});
  assert.equal(history.content,bytes.toString());
  assert.equal(sha(await fs.readFile(path.join(workspace,oldPath))),sha(bytes));
  assert.equal((await viewer.read({projectId:project.id,path:'report.md'})).content,current.toString());
  await assert.rejects(viewer.read({projectId:project.id,path:'.manta/private.json'}),/configuration|Credential|not available|path/i);
});
