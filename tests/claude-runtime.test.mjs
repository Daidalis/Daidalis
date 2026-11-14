import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import * as installedSdk from '@anthropic-ai/claude-agent-sdk';
import {z} from 'zod';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createClaudeRuntime} from '../server/runtimes/claude.mjs';
import {createRuntimeManager} from '../server/runtimes/index.mjs';
import {createStore} from '../server/store.mjs';
import {createEngine} from '../server/engine.mjs';
import {legacyToolNamespace} from '../shared/legacy-names.mjs';

const require=createRequire(import.meta.url),SID='c118ab5d-0832-4819-9db7-f6ba834105c7';
const success=(text='完成')=>({type:'result',subtype:'success',is_error:false,result:text,session_id:SID,uuid:'result-id',usage:{input_tokens:4,output_tokens:3},total_cost_usd:0});
const assistant=(text='完成',id='msg-final')=>({type:'assistant',uuid:'assistant-uuid',session_id:SID,message:{id,content:[{type:'text',text}]}});
async function workspace(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'daidalis-claude-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
function harness(run,runtimeOptions={}){const captures={queries:[],servers:[],messages:[],events:[],sessions:[],closed:0,interrupts:0};const sdk={...installedSdk,z,createSdkMcpServer(options){captures.servers.push(options);return installedSdk.createSdkMcpServer(options);},query(input){const index=captures.queries.length;captures.queries.push(input);const iterator=run(input,captures,index);iterator.close=()=>{captures.closed++;iterator.onClose?.();};iterator.interrupt=async()=>{captures.interrupts++;iterator.onInterrupt?.();};return iterator;}};return {captures,runtime:createClaudeRuntime({sdkLoader:async()=>sdk,...runtimeOptions}),options:{apiKey:'fixture-key-not-a-real-secret',input:'本地确定性测试，不调用模型。',tools:[],onMessage:m=>captures.messages.push(m),onEvent:e=>captures.events.push(e),onSession:id=>captures.sessions.push(id)}};}
const simple=async function*(input){yield {type:'system',subtype:'init',session_id:SID};yield assistant();yield success();};
async function promptText(query){const values=[];for await(const message of query.prompt)values.push(message.message.content);return values.join('\n');}
async function remoteFixture(t){
 const hostRoot=await fs.realpath(await workspace(t)),project=path.join(hostRoot,'project_abcdef12'),transportPath=path.join(hostRoot,'claude-remote.py');
 await fs.mkdir(project);await fs.writeFile(transportPath,'#!/usr/bin/env python3\n');await fs.chmod(transportPath,0o700);
 return {hostRoot,project,transportPath};
}

test('remote Claude SDK keeps native options and sends only a separate stdin secret frame',async t=>{
 const fixture=await remoteFixture(t),writes=[],spawns=[],secret='fixture-key-not-a-real-secret';
 const h=harness(async function*(q){
  assert.equal(q.options.cwd,'/work');assert.equal(q.options.env.HOME,'/home/daidalis');assert.equal(q.options.env.CLAUDE_CONFIG_DIR,'/home/daidalis/.claude');
  assert.equal(q.options.env.ANTHROPIC_API_KEY,undefined);assert.deepEqual(q.options.settingSources,[]);
  assert.deepEqual(q.options.settings,{apiKeyHelper:'/opt/claude/key-helper'});
  assert.deepEqual(q.options.disallowedTools,['Agent','Task','Bash','WebFetch','WebSearch']);
  assert.equal(typeof q.options.spawnClaudeCodeProcess,'function');
  assert.throws(()=>q.options.spawnClaudeCodeProcess({command:'/tmp/untrusted-claude',args:[],cwd:fixture.project,env:q.options.env}),/隔离启动参数/);
  assert.throws(()=>q.options.spawnClaudeCodeProcess({command:'ignored',args:['--token='+secret],cwd:'/work',env:q.options.env}),/启动参数包含所选凭据/);
  assert.throws(()=>q.options.spawnClaudeCodeProcess({command:'/tmp/untrusted-claude',args:[],cwd:'/work',env:{...q.options.env,ANTHROPIC_BASE_URL:'https://elsewhere.invalid/?key=secret'}}),/固定的隔离来宾环境/);
  assert.throws(()=>q.options.spawnClaudeCodeProcess({command:'ignored',args:[],cwd:'/work',env:{...q.options.env,CLAUDE_CODE_ENTRYPOINT:'untrusted'}}),/无效的内部来宾环境/);
  q.options.spawnClaudeCodeProcess({command:'/tmp/untrusted-claude',args:['--output-format','stream-json'],cwd:'/work',env:{...q.options.env,ANTHROPIC_API_KEY:'forged-key',CLAUDE_AGENT_SDK_VERSION:'0.3.307',CLAUDE_CODE_ENTRYPOINT:'sdk-ts',CLAUDE_CODE_SDK_READS_SESSION_STATE:'1'}});
  yield assistant();yield success();
 },{remoteWorkspace:{hostRoot:fixture.hostRoot,transportPath:fixture.transportPath},spawnImpl:(file,args,options)=>{spawns.push({file,args,options});return {stdin:{write:value=>{writes.push(Buffer.from(value));return true;}}};}});
 await h.runtime.startTurn({...h.options,workspace:fixture.project,apiKey:secret,configDir:path.join(fixture.project,'host-only-config')}).completion;
 assert.equal(spawns.length,1);assert.equal(spawns[0].file,fixture.transportPath);assert.deepEqual(spawns[0].args,[]);
 assert.equal(spawns[0].options.cwd,fixture.project);assert.deepEqual(Object.keys(spawns[0].options.env).sort(),['DAIDALIS_REMOTE_PROJECT_SLUG','HOME','LANG','PATH']);
 assert.equal(spawns[0].options.env.DAIDALIS_REMOTE_PROJECT_SLUG,path.basename(fixture.project));
 assert.ok(!JSON.stringify(spawns).includes(secret));assert.ok(!JSON.stringify(spawns).includes('forged-key'));
 const wire=Buffer.concat(writes),headerEnd=wire.indexOf(10)+1,header=wire.subarray(0,headerEnd).toString('utf8'),config=JSON.parse(header);
 assert.ok(headerEnd>1);assert.ok(!header.includes(secret));assert.ok(!header.includes('forged-key'));
  assert.deepEqual(config.args,['--output-format','stream-json']);assert.equal(config.env.HOME,undefined);
  assert.equal(config.env.CLAUDE_CONFIG_DIR,undefined);assert.equal(config.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,'1');
  assert.equal(config.env.CLAUDE_AGENT_SDK_VERSION,'0.3.307');assert.equal(config.env.CLAUDE_CODE_ENTRYPOINT,'sdk-ts');
  assert.equal(config.env.ANTHROPIC_API_KEY,undefined);assert.ok(!header.includes(fixture.project));
 const length=wire.readUInt32BE(headerEnd);assert.equal(length,Buffer.byteLength(secret));
 assert.equal(wire.subarray(headerEnd+4,headerEnd+4+length).toString('utf8'),secret);
 assert.equal(wire.length,headerEnd+4+length);
});

test('remote Claude denies native shell/network and host path or symlink escape before approval',async t=>{
 const fixture=await remoteFixture(t),outside=await workspace(t);await fs.symlink(outside,path.join(fixture.project,'escape'));
 let approvals=0;
 const h=harness(async function*(q){
  const pre=q.options.hooks.PreToolUse[0].hooks[0],deny=async(name,args)=>{
   const result=await pre({tool_name:name,tool_input:args},name);assert.equal(result.hookSpecificOutput.permissionDecision,'deny');
   assert.equal((await q.options.canUseTool(name,args)).behavior,'deny');
  };
  await deny('Bash',{command:'pwd',cwd:'/work'});await deny('WebFetch',{url:'https://example.com'});await deny('WebSearch',{query:'STF'});
  await deny('UnknownNativeTool',{filePath:'/run/secrets/api-key'});
  await deny('Read',{file_path:'/etc/hosts'});await deny('Read',{file_path:'/work/../etc/hosts'});
  await deny('Read',{file_path:'~/.claude/settings.json'});await deny('Read',{file_path:'$HOME/.claude/settings.json'});
  await deny('Glob',{pattern:'~/secrets/*'});
  await deny('Read',{file_path:'/work/escape/file.txt'});await deny('Glob',{pattern:'../**'});
  const allowed=await pre({tool_name:'Read',tool_input:{file_path:'/work/model.sysml'}},'read');assert.equal(allowed.hookSpecificOutput.permissionDecision,'allow');
  const write={file_path:'/work/review.txt',content:'reviewed'};
  assert.equal((await pre({tool_name:'Write',tool_input:write,tool_use_id:'write-1'},'write-1')).hookSpecificOutput.permissionDecision,'allow');
  assert.equal((await q.options.canUseTool('Write',write,{toolUseID:'write-1'})).behavior,'allow');
  yield assistant();yield success();
 },{remoteWorkspace:{hostRoot:fixture.hostRoot,transportPath:fixture.transportPath}});
 await h.runtime.startTurn({...h.options,workspace:fixture.project,permissionMode:'manual',requestApproval:async()=>{approvals++;return true;}}).completion;
 assert.equal(approvals,1);
});

test('remote Claude rejects URL-borne credentials and absorbs transport stdin EPIPE',async t=>{
 const fixture=await remoteFixture(t),input=new EventEmitter();input.write=()=>true;
 let spawned=false,stderrDrained=0;const h=harness(async function*(q){q.options.spawnClaudeCodeProcess({command:'ignored',args:[],cwd:'/work',env:q.options.env});yield assistant();yield success();},{remoteWorkspace:{hostRoot:fixture.hostRoot,transportPath:fixture.transportPath},spawnImpl:()=>{spawned=true;return {stdin:input,stderr:{resume:()=>{stderrDrained++;}}};}});
 await assert.rejects(h.runtime.startTurn({...h.options,workspace:fixture.project,baseUrl:'https://gateway.invalid/?api_key=secret'}).completion,/不接受查询参数或片段/);
 await assert.rejects(h.runtime.startTurn({...h.options,workspace:fixture.project,baseUrl:'https://gateway.invalid/#secret'}).completion,/不接受查询参数或片段/);
 assert.equal(spawned,false);
 await h.runtime.startTurn({...h.options,workspace:fixture.project}).completion;
 assert.equal(stderrDrained,1);assert.ok(input.listenerCount('error')>0);assert.doesNotThrow(()=>input.emit('error',Object.assign(new Error('broken pipe'),{code:'EPIPE'})));
});

test('remote Claude refuses symlink project and non-executable transport before SDK load',async t=>{
 const fixture=await remoteFixture(t),link=path.join(fixture.hostRoot,'project_linked12');await fs.symlink(fixture.project,link);
 let loaded=0;const runtime=createClaudeRuntime({remoteWorkspace:{hostRoot:fixture.hostRoot,transportPath:fixture.transportPath},sdkLoader:async()=>{loaded++;throw new Error('SDK should not load');}});
 await assert.rejects(runtime.startTurn({workspace:link,input:'test',apiKey:'fixture-key'}).completion,/符号链接/);
 await fs.chmod(fixture.transportPath,0o600);
 await assert.rejects(runtime.startTurn({workspace:fixture.project,input:'test',apiKey:'fixture-key'}).completion,/EACCES|permission denied|access/i);
 assert.equal(loaded,0);
});

test('isolation policy rejects Claude start, connection test, and delegated thread before state changes',async t=>{
 const root=await workspace(t),store=createStore({dataDir:path.join(root,'data'),seed:false,addDefaultCodexProvider:false});
 const project=store.createProject({name:'Guest boundary fixture'}),thread=store.get('threads',project.coordinatorThreadId);
 const providerId='claude-local',providers={redact:value=>String(value),list:()=>[{id:providerId,configured:true}]};
 let called=0;const manager=createRuntimeManager({providers,dataDir:store.dataDir,requireClaudeRemoteWorkspace:true,adapters:{'claude-agent-sdk':{startTurn(){called++;throw Error('Host Claude was invoked');}}}});
 assert.throws(()=>manager.startTurn({id:providerId,type:'claude-agent'},{workspace:store.workspace(project.id)}),/需要 Linux guest 传输/);
 assert.equal(called,0);
 const engine=createEngine({store,providers,emit:()=>{},requireClaudeRemoteWorkspace:true,runtimeAdapters:{'openai-agents-sdk':{startTurn:()=>({completion:Promise.resolve({content:'fixture'})})}},autoResumeDebounceMs:1000});
 await assert.rejects(engine.testProvider(providerId,{workspace:store.workspace(project.id)}),/需要 Linux guest 传输/);
 const originalRuns=store.data.runs.length,originalMessages=store.data.messages.length;
 assert.throws(()=>engine.start({threadId:thread.id,content:'Run Claude',providerId}),/需要 Linux guest 传输/);
 assert.equal(store.data.runs.length,originalRuns);assert.equal(store.data.messages.length,originalMessages);
 const coordinator=engine.start({threadId:thread.id,content:'Delegate',providerId:'demo'}),agent=store.data.agents.find(a=>a.runId===coordinator.run.id);
 const threadCount=store.data.threads.length;
 assert.throws(()=>engine.startThread({name:'Worker',task:'Inspect source',providerId},{runId:coordinator.run.id,threadId:thread.id,projectId:project.id,agentId:agent.id,signal:new AbortController().signal}),/需要 Linux guest 传输/);
 assert.equal(store.data.threads.length,threadCount);
 await new Promise(resolve=>setImmediate(resolve));await engine.close();await manager.close();
});

// These fixtures replace only query(); actual SDK tool/server and Zod are used.
test('synchronous handle uses native preset, session resume, fresh instructions and isolated env',async t=>{
 const folder=await workspace(t),h=harness(simple);const old=process.env.OTHER_MODEL_API_KEY;process.env.OTHER_MODEL_API_KEY='other-provider-secret';t.after(()=>{if(old===undefined)delete process.env.OTHER_MODEL_API_KEY;else process.env.OTHER_MODEL_API_KEY=old;});
 const turn=h.runtime.startTurn({...h.options,workspace:folder,sessionId:SID,maxTurns:8,baseUrl:'https://anthropic.example.invalid/proxy/',model:'custom-model',instructions:'最新工程快照',secretEnvNames:['OTHER_MODEL_API_KEY'],history:[{role:'user',content:'不能重放的旧历史'}]});assert.equal(typeof turn.steer,'function');assert.equal(typeof turn.cancel,'function');assert.ok(turn.completion instanceof Promise);const result=await turn.completion,q=h.captures.queries[0];assert.equal(result.sessionId,SID);assert.equal(q.options.resume,SID);assert.equal(q.options.cwd,await fs.realpath(folder));assert.equal(q.options.model,'custom-model');assert.equal(q.options.maxTurns,8);assert.deepEqual(q.options.tools,{type:'preset',preset:'claude_code'});assert.deepEqual(q.options.disallowedTools,['Agent','Task']);assert.equal(q.options.permissionMode,'default');assert.equal(q.options.allowDangerouslySkipPermissions,undefined);assert.deepEqual(q.options.settingSources,[]);assert.equal(q.options.systemPrompt.snapshot,false);assert.equal(q.options.systemPrompt.append,'最新工程快照');assert.equal(q.options.env.ANTHROPIC_BASE_URL,'https://anthropic.example.invalid/proxy');assert.equal(q.options.env.OTHER_MODEL_API_KEY,undefined);assert.equal(q.options.env.ANTHROPIC_AUTH_TOKEN,undefined);assert.equal(q.options.env.ANTHROPIC_API_KEY,h.options.apiKey);assert.ok(!(await promptText(q)).includes('不能重放'));assert.ok(h.captures.closed);
 assert.equal(q.options.env.ENABLE_TOOL_SEARCH,'false');
});

test('missing selected credential fails before SDK load; SDK load failure is honest',async t=>{const folder=await workspace(t);let loaded=false;const runtime=createClaudeRuntime({sdkLoader:async()=>{loaded=true;throw new Error('fixture dependency missing');}});await assert.rejects(runtime.startTurn({workspace:folder,input:'test'}).completion,/需要此连接的 Anthropic API Key/);assert.equal(loaded,false);await assert.rejects(runtime.startTurn({workspace:folder,input:'test',apiKey:'fixture'}).completion,/dependency missing/);});

test('public streaming text updates one stable id and never emits thinking blocks',async t=>{const folder=await workspace(t),h=harness(async function*(){yield {type:'system',subtype:'init',session_id:SID};yield {type:'stream_event',session_id:SID,event:{type:'message_start',message:{id:'msg-stream'}}};yield {type:'stream_event',session_id:SID,event:{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'PRIVATE_REASONING'}}};yield {type:'stream_event',session_id:SID,event:{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'PRIVATE_REASONING'}}};yield {type:'stream_event',session_id:SID,event:{type:'content_block_start',index:1,content_block:{type:'text',text:''}}};yield {type:'stream_event',session_id:SID,event:{type:'content_block_delta',index:1,delta:{type:'text_delta',text:'Hello'}}};yield {type:'stream_event',session_id:SID,event:{type:'content_block_delta',index:1,delta:{type:'text_delta',text:' world'}}};yield assistant('Hello world','msg-stream');yield success('Hello world');});const result=await h.runtime.startTurn({...h.options,workspace:folder}).completion;assert.equal(result.content,'Hello world');assert.equal(new Set(h.captures.messages.map(m=>m.id)).size,1);assert.ok(h.captures.messages.some(m=>m.partial));assert.equal(h.captures.messages.at(-1).phase,'final');assert.equal(h.captures.messages.at(-1).text,'Hello world');assert.ok(!JSON.stringify(h.captures.messages).includes('PRIVATE_REASONING'));assert.deepEqual(h.captures.sessions,[SID]);});

test('first native session imports only public history and captures session before text',async t=>{const folder=await workspace(t),h=harness(simple);await h.runtime.startTurn({...h.options,workspace:folder,history:[{role:'user',content:'历史问题'},{role:'assistant',content:'公开答复'},{role:'tool',content:'不要重放此内部结果'}]}).completion;const p=await promptText(h.captures.queries[0]);assert.match(p,/历史问题/);assert.match(p,/公开答复/);assert.doesNotMatch(p,/不要重放此内部结果/);assert.equal(h.captures.sessions[0],SID);});

test('Manual native write requires actual approval and canUseTool does not double prompt',async t=>{const folder=await workspace(t);let approvals=0;const h=harness(async function*(q){const input={hook_event_name:'PreToolUse',tool_name:'Write',tool_use_id:'write-1',tool_input:{file_path:path.join(folder,'file.txt'),content:'text'}};const pre=await q.options.hooks.PreToolUse[0].hooks[0](input,'write-1',{signal:new AbortController().signal});assert.equal(pre.hookSpecificOutput.permissionDecision,'allow');assert.equal((await q.options.canUseTool('Write',input.tool_input,{toolUseID:'write-1',signal:new AbortController().signal})).behavior,'allow');await q.options.hooks.PostToolUse[0].hooks[0]({...input,hook_event_name:'PostToolUse',tool_response:{ok:true}},'write-1');yield assistant();yield success();});await h.runtime.startTurn({...h.options,workspace:folder,permissionMode:'manual',requestApproval:async()=>{approvals++;return true;}}).completion;assert.equal(approvals,1);assert.deepEqual(h.captures.events.filter(e=>e.type.startsWith('tool.')).map(e=>e.type),['tool.started','tool.completed']);});

test('Auto delegates native reads, writes and compound Bash to SDK policy without pre-approval',async t=>{
 const folder=await workspace(t),asked=[];const h=harness(async function*(q){
  assert.equal(q.options.permissionMode,'auto');assert.equal(q.options.allowedTools,undefined);assert.equal(q.options.allowDangerouslySkipPermissions,undefined);
  yield {type:'system',subtype:'init',session_id:SID,permissionMode:'auto'};
  const pre=q.options.hooks.PreToolUse[0].hooks[0];
  for(const [name,id,args]of[['Read','r',{file_path:'existing.txt'}],['Write','w',{file_path:'within.txt',content:'ok'}],['Edit','e',{file_path:'within.txt',old_string:'ok',new_string:'changed'}],['Bash','b',{command:'pwd && rg --files'}]]){
   assert.deepEqual(await pre({tool_name:name,tool_use_id:id,tool_input:args},id,{signal:new AbortController().signal}),{});
   assert.equal(asked.length,0); // SDK resolves these next; the hook never short-circuits its classifier.
   await q.options.hooks.PostToolUse[0].hooks[0]({tool_name:name,tool_use_id:id,tool_response:{fixture:true}},id);
  }
  yield assistant();yield success();
 });
 await h.runtime.startTurn({...h.options,workspace:folder,permissionMode:'auto',requestApproval:async r=>{asked.push(r.tool);return true;}}).completion;
 assert.deepEqual(asked,[]);assert.equal(h.captures.events.filter(e=>e.type==='tool.started').length,4);assert.equal(h.captures.events.filter(e=>e.type==='tool.completed').length,4);
 const mode=h.captures.events.find(e=>e.type==='runtime.permission_mode');assert.equal(mode.data.effectivePermissionMode,'auto');assert.equal(mode.data.autoModeAvailable,true);assert.ok(!h.captures.events.some(e=>e.type==='runtime.warning'));
});

test('Auto unresolved native callbacks still ask and cannot reuse old blanket write or read allowances',async t=>{
 const folder=await workspace(t),asked=[];const h=harness(async function*(q){
  for(const [name,args]of[['Bash',{command:'some-unresolved-command'}],['Write',{file_path:'within.txt',content:'x'}],['Read',{file_path:'within.txt'}]]){
   assert.deepEqual(await q.options.hooks.PreToolUse[0].hooks[0]({tool_name:name,tool_input:args,tool_use_id:name},name),{});
   assert.equal((await q.options.canUseTool(name,args,{toolUseID:name,signal:new AbortController().signal})).behavior,'deny');
  }
  yield assistant();yield success();
 });
 await h.runtime.startTurn({...h.options,workspace:folder,permissionMode:'auto',requestApproval:async r=>{asked.push(r.tool);return false;}}).completion;
 assert.deepEqual(asked,['Bash','Write','Read']);
});

test('Auto reports native fallback and subsequent mode changes without silently bypassing permissions',async t=>{
 const folder=await workspace(t),asked=[];const h=harness(async function*(q){
  yield {type:'system',subtype:'init',session_id:SID,permissionMode:'default'};
  assert.equal((await q.options.canUseTool('Write',{file_path:'within.txt',content:'x'},{signal:new AbortController().signal})).behavior,'deny');
  yield {type:'system',subtype:'status',permissionMode:'auto'};
  yield {type:'system',subtype:'status',permissionMode:'default'};
  yield assistant();yield success();
 });
 await h.runtime.startTurn({...h.options,workspace:folder,permissionMode:'auto',requestApproval:async r=>{asked.push(r.tool);return false;}}).completion;
 assert.deepEqual(asked,['Write']);assert.deepEqual(h.captures.events.filter(e=>e.type==='runtime.permission_mode').map(e=>e.data.effectivePermissionMode),['default','auto','default']);
 assert.equal(h.captures.events.filter(e=>e.type==='runtime.warning').length,2);
 const legacy=harness(simple);await legacy.runtime.startTurn({...legacy.options,workspace:folder,permissionMode:'auto'}).completion;
 assert.ok(legacy.captures.events.some(e=>e.type==='runtime.warning'&&e.data.effectivePermissionMode===null));
 const unsafe=harness(async function*(){yield {type:'system',subtype:'init',permissionMode:'bypassPermissions'};yield success();});
 await assert.rejects(unsafe.runtime.startTurn({...unsafe.options,workspace:folder,permissionMode:'auto'}).completion,/未授权的 bypassPermissions/);
 const unavailable=harness(async function*(){throw new Error('Cannot set permission mode to auto: auto mode unavailable for this model');});
 await assert.rejects(unavailable.runtime.startTurn({...unavailable.options,workspace:folder,permissionMode:'auto'}).completion,/Claude Auto 不可用.*切换 Manual/);
});

test('Auto guard still denies outside paths, live and dangling symlink escapes, external MCP and hidden Agent/Task',async t=>{const folder=await workspace(t),outside=await fs.mkdtemp(path.join(os.tmpdir(),'daidalis-outside-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));await fs.symlink(outside,path.join(folder,'escape'));await fs.symlink(path.join(outside,'missing'),path.join(folder,'dangling'));let asked=0;const h=harness(async function*(q){for(const [name,args]of[['Read',{file_path:'/etc/hosts'}],['Write',{file_path:'escape/file.txt',content:'x'}],['Write',{file_path:'dangling',content:'x'}],['Glob',{pattern:'../**'}],['Bash',{command:'pwd',cwd:outside}],['mcp__external__read',{}],['Agent',{}],['Task',{}]]){const r=await q.options.hooks.PreToolUse[0].hooks[0]({tool_name:name,tool_input:args,tool_use_id:name},name,{signal:new AbortController().signal});assert.equal(r.hookSpecificOutput.permissionDecision,'deny');}yield assistant();yield success();});await h.runtime.startTurn({...h.options,workspace:folder,permissionMode:'auto',requestApproval:async()=>{asked++;return true;}}).completion;assert.equal(asked,0);});

test('Auto question callback preserves native options and returns actual user answers, never a default answer',async t=>{const folder=await workspace(t),questions=[{question:'选择方案',header:'方案',options:[{label:'A',description:'第一种'},{label:'B',description:'第二种'}],multiSelect:true}],seen=[];const h=harness(async function*(q){assert.deepEqual(await q.options.hooks.PreToolUse[0].hooks[0]({tool_name:'AskUserQuestion',tool_input:{questions}},'question'),{});const response=await q.options.canUseTool('AskUserQuestion',{questions},{signal:new AbortController().signal});assert.equal(response.behavior,'allow');assert.deepEqual(response.updatedInput.answers,{'选择方案':'B, 其他约束'});yield assistant();yield success();});await h.runtime.startTurn({...h.options,workspace:folder,permissionMode:'auto',requestUserInput:async q=>{seen.push(q);return {'选择方案':{answers:['B','其他约束']}};}}).completion;assert.deepEqual(seen,[questions]);const h2=harness(async function*(q){assert.equal((await q.options.canUseTool('AskUserQuestion',{questions},{signal:new AbortController().signal})).behavior,'deny');yield assistant();yield success();});await h2.runtime.startTurn({...h2.options,workspace:folder,permissionMode:'auto',requestUserInput:async()=>null}).completion;});

test('real SDK in-process MCP transports dynamic JSON schema, exact execution and image output',async t=>{const folder=await workspace(t),calls=[];const h=harness(async function*(q,c){const server=q.options.mcpServers.daidalis,[clientTransport,serverTransport]=InMemoryTransport.createLinkedPair(),client=new Client({name:'daidalis-test',version:'1.0.0'});try{await server.instance.connect(serverTransport);await client.connect(clientTransport);const list=await client.listTools();assert.equal(list.tools[0].name,'run_scan');assert.ok(list.tools[0].inputSchema.required.includes('model'));assert.deepEqual(list.tools[0].inputSchema.properties.model.enum||[list.tools[0].inputSchema.properties.model.const],['thermal']);const r=await client.callTool({name:'run_scan',arguments:{model:'thermal',scan:{steps:2}}});assert.equal(r.isError,undefined);assert.equal(r.content[1].type,'image');assert.equal(r.content[1].mimeType,'image/png');assert.ok(!r.content[0].text.includes('iVBOR'));}finally{await client.close();await server.instance.close();}yield assistant();yield success();});await h.runtime.startTurn({...h.options,workspace:folder,tools:[{name:'run_scan',description:'Fixture engineering tool',parameters:{type:'object',properties:{model:{type:'string',enum:['thermal']},scan:{type:'object',properties:{steps:{type:'integer',minimum:1}},required:['steps']}},required:['model'],additionalProperties:false}}],executeTool:async(name,args)=>{calls.push({name,args});return {ok:true,_image:{mediaType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8p0AAAAASUVORK5CYII='}};}}).completion;assert.deepEqual(calls,[{name:'run_scan',args:{model:'thermal',scan:{steps:2}}}]);});

test('MCP failures are truthful and untrusted MCP provenance is denied',async t=>{const folder=await workspace(t),h=harness(async function*(q,c){const tool=c.servers[0].tools[0];const r=await tool.handler({});assert.equal(r.isError,true);assert.match(r.content[0].text,/fixture error/);assert.equal((await q.options.canUseTool('mcp__daidalis__list_files',{}, {signal:new AbortController().signal,mcpServer:{name:'daidalis',source:'project'}})).behavior,'deny');yield assistant();yield success();});await h.runtime.startTurn({...h.options,workspace:folder,tools:[{name:'list_files',parameters:{type:'object',properties:{}}}],executeTool:async()=>{throw new Error('fixture error');}}).completion;});

test('Auto pre-hook approves only registered application MCP provenance and preserves application checks',async t=>{
 const folder=await workspace(t),calls=[];const h=harness(async function*(q,c){
  const pre=q.options.hooks.PreToolUse[0].hooks[0],name='mcp__daidalis__list_files';
  for(const server of [{name:'daidalis',source:'project'},{name:'other',source:'sdk'}]){
   const result=await pre({tool_name:name,tool_input:{},mcp_server:server},'untrusted');assert.equal(result.hookSpecificOutput.permissionDecision,'deny');
   assert.equal((await q.options.canUseTool(name,{}, {mcpServer:server})).behavior,'deny');
  }
  assert.equal((await pre({tool_name:'mcp__daidalis__unregistered',tool_input:{},mcp_server:{name:'daidalis',source:'sdk'}},'unregistered')).hookSpecificOutput.permissionDecision,'deny');
  assert.equal((await pre({tool_name:name,tool_input:{},mcp_server:{name:'daidalis',source:'sdk'}},'trusted')).hookSpecificOutput.permissionDecision,'allow');
  assert.equal((await c.servers[0].tools[0].handler({})).isError,true);
  yield assistant();yield success();
 });
 await h.runtime.startTurn({...h.options,workspace:folder,permissionMode:'auto',tools:[{name:'list_files',parameters:{type:'object',properties:{}}}],executeTool:async(name,args)=>{calls.push({name,args});throw new Error('application guard rejected fixture');},requestApproval:async()=>{assert.fail('Application MCP decisions must use the registered executor');}}).completion;
 assert.deepEqual(calls,[{name:'list_files',args:{}}]);
});

test('steering performs a real native interrupt then resumes the same session, not a fake immediate insertion',async t=>{const folder=await workspace(t);let wake,ready;const started=new Promise(r=>ready=r);const h=harness(function(q,c,index){const gen=(async function*(){yield {type:'system',subtype:'init',session_id:SID};if(index===0){ready();await new Promise(r=>wake=r);yield {type:'result',subtype:'error_during_execution',errors:['interrupted'],session_id:SID};}else{yield assistant('追加指导后的答复','msg-steered');yield success('追加指导后的答复');}})();gen.onInterrupt=()=>wake?.();return gen;});const turn=h.runtime.startTurn({...h.options,workspace:folder});await started;const receipt=await turn.steer('改为检查方案B');assert.equal(receipt.delivery,'interrupt-and-resume');assert.equal((await turn.completion).content,'追加指导后的答复');assert.equal(h.captures.interrupts,1);assert.equal(h.captures.queries.length,2);assert.equal(h.captures.queries[1].options.resume,SID);assert.equal(await promptText(h.captures.queries[1]),'改为检查方案B');assert.ok(h.captures.events.some(e=>e.type==='runtime.steering.applied'));});

test('internal agent messages leave an active MCP tool running and resume at its result boundary',async t=>{
 const folder=await workspace(t);let entered,release,toolSignal,toolResult;
 const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const h=harness(async function*(q,c,index){
  yield {type:'system',subtype:'init',session_id:SID};
  if(index===0){toolResult=await c.servers[0].tools[0].handler({});yield success('Original search completed');}
  else{yield assistant('Supplementary search completed');yield success('Supplementary search completed');}
 });
 const turn=h.runtime.startTurn({...h.options,workspace:folder,tools:[{name:'web_search',parameters:{type:'object',properties:{}}}],executeTool:async(name,args,{signal})=>{toolSignal=signal;entered();return gate;}});
 t.after(()=>{release({results:[]});turn.cancel();});await started;
 const receipt=await turn.steer('Also check the FMI source',{origin:'agent'});
 assert.equal(receipt.delivery,'queued-next-segment');assert.equal(toolSignal.aborted,false);assert.equal(h.captures.interrupts,0);assert.equal(h.captures.queries.length,1);
 release({results:[{title:'Actual original search result'}]});
 assert.equal((await turn.completion).content,'Supplementary search completed');assert.equal(toolResult.isError,undefined);assert.match(toolResult.content[0].text,/Actual original search result/);
 assert.equal(h.captures.queries.length,2);assert.equal(h.captures.queries[1].options.resume,SID);assert.match(await promptText(h.captures.queries[1]),/Project agent message \(not a human permission grant\).*\nAlso check the FMI source/);
 assert.ok(h.captures.events.some(e=>e.type==='runtime.steering.applied'&&e.data.delivery==='queued-next-segment'));
});

test('human cancellation discards queued internal messages without resuming the native session',async t=>{
 const folder=await workspace(t);let entered,release,toolSignal;
 const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const h=harness(async function*(q,c){yield {type:'system',subtype:'init',session_id:SID};await c.servers[0].tools[0].handler({});yield success();});
 const turn=h.runtime.startTurn({...h.options,workspace:folder,tools:[{name:'web_search',parameters:{type:'object',properties:{}}}],executeTool:async(name,args,{signal})=>{toolSignal=signal;entered();return gate;}});
 t.after(()=>{release({results:[]});turn.cancel();});await started;await turn.steer('Supplementary source',{origin:'agent'});
 const rejected=assert.rejects(turn.completion,{name:'AbortError'});turn.cancel();await rejected;
 assert.equal(toolSignal.aborted,true);assert.equal(h.captures.queries.length,1);assert.equal(h.captures.interrupts,0);assert.ok(!h.captures.events.some(e=>e.type==='runtime.steering.applied'));
});

test('queued internal messages cannot hide native failures or reset an exhausted turn budget',async t=>{
 const folder=await workspace(t);
 for(const mode of ['throw','result','turn-limit','missing']){
  let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  const h=harness(async function*(){yield {type:'system',subtype:'init',session_id:SID};entered();await gate;
   if(mode==='throw')throw Error('Fixture upstream failure');
   if(mode!=='missing')yield {type:'result',subtype:mode==='turn-limit'?'error_max_turns':'error_during_execution',is_error:true,errors:[mode==='turn-limit'?'Reached maximum number of turns (4)':'Fixture upstream failure'],session_id:SID};
  });
  const turn=h.runtime.startTurn({...h.options,workspace:folder});await started;await turn.steer('Internal update',{origin:'agent'});
  const rejected=assert.rejects(turn.completion,error=>{if(mode==='turn-limit'){assert.equal(error.code,'MAX_TURNS_EXCEEDED');assert.equal(error.name,'MaxTurnsExceededError');}else assert.match(error.message,mode==='missing'?/未返回完成结果/:/Fixture upstream failure/);return true;});release();await rejected;
  assert.equal(h.captures.queries.length,1);assert.equal(h.captures.interrupts,0);
 }
});

test('Claude turn-limit subtype and legacy text produce a redacted stable error code',async t=>{
 const folder=await workspace(t);
 for(const result of [
  {subtype:'error_max_turns',errors:['Fixture turn limit fixture-key-not-a-real-secret']},
  {subtype:'error_during_execution',errors:['Reached maximum number of turns (4) fixture-key-not-a-real-secret']}
 ]){
  const h=harness(async function*(){yield {type:'result',is_error:true,session_id:SID,...result};});
  await assert.rejects(h.runtime.startTurn({...h.options,workspace:folder}).completion,error=>{assert.equal(error.code,'MAX_TURNS_EXCEEDED');assert.equal(error.name,'MaxTurnsExceededError');assert.ok(!error.message.includes(h.options.apiKey));return true;});
 }
});

const exhaustedResult=limit=>({type:'result',subtype:'error_max_turns',is_error:true,session_id:SID,num_turns:limit+1,errors:[`Reached maximum number of turns (${limit})`]});
test('Claude continues an exhausted segment in the same saved session within the total turn budget',async t=>{
 const folder=await workspace(t),h=harness(async function*(q,c,index){yield {type:'system',subtype:'init',session_id:SID};yield index===0?exhaustedResult(2):{...success('Final report completed'),num_turns:1};});
 const result=await h.runtime.startTurn({...h.options,workspace:folder,maxTurns:2,maxContinuations:1}).completion;
 assert.equal(result.content,'Final report completed');assert.equal(result.modelTurns,3);assert.equal(result.continuations,1);
 assert.equal(h.captures.queries.length,2);assert.equal(h.captures.queries[1].options.resume,SID);assert.equal(h.captures.queries[1].options.maxTurns,2);
 const continuedPrompt=await promptText(h.captures.queries[1]);assert.doesNotMatch(continuedPrompt,/本地确定性测试/);assert.match(continuedPrompt,/do not replay completed work/);
 assert.equal(h.captures.queries[1].options.abortController,h.captures.queries[0].options.abortController);assert.equal(h.captures.queries[1].options.permissionMode,h.captures.queries[0].options.permissionMode);
 assert.deepEqual(h.captures.events.filter(e=>e.type==='runtime.turn.completed').map(e=>e.data.modelTurns),[2,3]);
 assert.equal(h.captures.events.find(e=>e.type==='sdk.turn.continued').data.continuations,1);
});

test('Claude cannot resume beyond the configured continuation count or cumulative turn budget',async t=>{
 const folder=await workspace(t);
 for(const maxContinuations of [0,1,3]){
  const h=harness(async function*(){yield {type:'system',subtype:'init',session_id:SID};yield exhaustedResult(2);});
  await assert.rejects(h.runtime.startTurn({...h.options,workspace:folder,maxTurns:2,maxContinuations}).completion,e=>e.code==='MAX_TURNS_EXCEEDED'&&e.message.includes(`Max turns (${2*(maxContinuations+1)})`));
  assert.equal(h.captures.queries.length,maxContinuations+1);assert.equal(h.captures.events.filter(e=>e.type==='sdk.turn.continued').length,maxContinuations);
 }
});

test('queued internal messages consume remaining Claude budget rather than resetting it',async t=>{
 const folder=await workspace(t);let ready,release;const entered=new Promise(r=>ready=r),gate=new Promise(r=>release=r);
 const h=harness(async function*(q,c,index){yield {type:'system',subtype:'init',session_id:SID};if(index===0){ready();await gate;yield {...success(),num_turns:3};}else yield exhaustedResult(1);});
 const turn=h.runtime.startTurn({...h.options,workspace:folder,maxTurns:3,maxContinuations:0});await entered;await turn.steer('Internal update',{origin:'agent'});
 const rejected=assert.rejects(turn.completion,e=>e.code==='MAX_TURNS_EXCEEDED');release();await rejected;
 assert.equal(h.captures.queries.length,1);assert.equal(h.captures.interrupts,0);
});

test('successful steering segments reduce the remaining Claude segment size',async t=>{
 const folder=await workspace(t);let ready,release;const entered=new Promise(r=>ready=r),gate=new Promise(r=>release=r);
 let turn;const h=harness(async function*(q,c,index){yield {type:'system',subtype:'init',session_id:SID};if(index===0){ready();await gate;yield {...success(),num_turns:1};}else if(index===1){await turn.steer('Second internal update',{origin:'agent'});yield {...success(),num_turns:2};}else yield {...success('Supplements processed'),num_turns:1};});
 turn=h.runtime.startTurn({...h.options,workspace:folder,maxTurns:2,maxContinuations:1});await entered;await turn.steer('Internal update',{origin:'agent'});release();
 const result=await turn.completion;assert.equal(result.modelTurns,4);assert.equal(result.continuations,0);assert.deepEqual(h.captures.queries.map(q=>q.options.maxTurns),[2,2,1]);
});

test('a Claude budget continuation delivers pending internal messages without interruption',async t=>{
 const folder=await workspace(t);let ready,release;const entered=new Promise(r=>ready=r),gate=new Promise(r=>release=r);
 const h=harness(async function*(q,c,index){yield {type:'system',subtype:'init',session_id:SID};if(index===0){ready();await gate;yield exhaustedResult(2);}else yield {...success(),num_turns:1};});
 const turn=h.runtime.startTurn({...h.options,workspace:folder,maxTurns:2,maxContinuations:1});await entered;await turn.steer('PENDING_INTERNAL_RECEIPT',{origin:'agent'});release();await turn.completion;
 assert.match(await promptText(h.captures.queries[1]),/Project agent message.*\nPENDING_INTERNAL_RECEIPT/);assert.equal(h.captures.interrupts,0);assert.ok(h.captures.events.some(e=>e.type==='runtime.steering.applied'&&e.data.delivery==='queued-next-segment'));
});

test('a real upstream error is never retried as a Claude budget continuation',async t=>{
 const folder=await workspace(t),h=harness(async function*(){yield {type:'system',subtype:'init',session_id:SID};yield {type:'result',subtype:'error_during_execution',is_error:true,errors:['Upstream unavailable'],num_turns:1};});
 await assert.rejects(h.runtime.startTurn({...h.options,workspace:folder,maxTurns:2,maxContinuations:1}).completion,/Upstream unavailable/);assert.equal(h.captures.queries.length,1);
});

test('cancellation at the Claude continuation boundary starts no new query',async t=>{
 const folder=await workspace(t),controller=new AbortController(),h=harness(async function*(){yield {type:'system',subtype:'init',session_id:SID};yield exhaustedResult(2);});
 await assert.rejects(h.runtime.startTurn({...h.options,workspace:folder,maxTurns:2,maxContinuations:1,signal:controller.signal,onEvent:event=>{h.captures.events.push(event);if(event.type==='sdk.turn.continued')controller.abort();}}).completion,{name:'AbortError'});
 assert.equal(h.captures.queries.length,1);
});

test('invalid Claude budgets fail before loading or executing native queries',async t=>{
 const folder=await workspace(t),h=harness(simple);
 for(const budget of [{maxTurns:0},{maxTurns:Infinity},{maxTurns:201},{maxContinuations:4},{maxContinuations:-1},{maxContinuations:true}])await assert.rejects(h.runtime.startTurn({...h.options,workspace:folder,...budget}).completion,/Invalid Claude execution budget/);
 assert.equal(h.captures.queries.length,0);
});

test('real Claude resumes after a native turn limit without replaying completed tools',{timeout:90000},async t=>{
 const folder=await workspace(t),bodies=[],queries=[],events=[],steps=[],sessions=[];
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  if(req.url.includes('count_tokens')){res.writeHead(200,{'content-type':'application/json'});res.end('{"input_tokens":100}');return;}
  if(!req.url.startsWith('/v1/messages')){res.writeHead(404);res.end();return;}
  const body=JSON.parse(raw);bodies.push(body);const round=bodies.length;
  const content=round<=2?{type:'tool_use',id:'continued-step-'+round,name:'mcp__daidalis__record_step',input:{step:round}}:{type:'text',text:'FINAL_REPORT_COMPLETE'};
  const message={id:'msg_continued_'+round,type:'message',role:'assistant',model:body.model,content:[content],stop_reason:content.type==='tool_use'?'tool_use':'end_turn',stop_sequence:null,usage:{input_tokens:100,output_tokens:20}};
  if(!body.stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(message));return;}
  res.writeHead(200,{'content-type':'text/event-stream'});
  const send=(type,data={})=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');
  send('message_start',{message:{...message,content:[],stop_reason:null}});send('content_block_start',{index:0,content_block:content.type==='tool_use'?{...content,input:{}}:{type:'text',text:''}});
  send('content_block_delta',{index:0,delta:content.type==='tool_use'?{type:'input_json_delta',partial_json:JSON.stringify(content.input)}:{type:'text_delta',text:content.text}});
  send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:message.stop_reason,stop_sequence:null},usage:{output_tokens:20}});send('message_stop');res.end();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const runtime=createClaudeRuntime({configDir:path.join(await fs.realpath(folder),'native-config'),sdkLoader:async()=>({...installedSdk,z,query:q=>{queries.push(q.options);return installedSdk.query(q);}})});
 const turn=runtime.startTurn({workspace:folder,apiKey:'local-regression-key',baseUrl:'http://127.0.0.1:'+server.address().port,model:'claude-sonnet-4-5-20250929',permissionMode:'manual',maxTurns:2,maxContinuations:1,input:'Record the two local steps, then provide the final report.',
  tools:[{name:'record_step',description:'Append one uniquely numbered receipt',parameters:{type:'object',properties:{step:{type:'integer'}},required:['step']}}],
  executeTool:async(_name,{step})=>{steps.push(step);await fs.appendFile(path.join(folder,'steps.txt'),step+'\n');return {recorded:step};},onEvent:e=>events.push(e),onSession:id=>sessions.push(id)});
 const timer=setTimeout(()=>turn.cancel(),75000);
 try{
  const result=await turn.completion;assert.equal(result.content,'FINAL_REPORT_COMPLETE');assert.equal(result.continuations,1);assert.equal(result.modelTurns,3);
  assert.deepEqual(steps,[1,2]);assert.equal(await fs.readFile(path.join(folder,'steps.txt'),'utf8'),'1\n2\n');assert.equal(bodies.length,3);assert.equal(queries.length,2);
  assert.equal(queries[1].resume,sessions[0]);assert.equal(new Set(sessions).size,1);assert.match(JSON.stringify(bodies[2].messages),/recorded/);assert.match(JSON.stringify(bodies[2].messages),/do not replay completed work/);
  assert.equal(events.filter(e=>e.type==='sdk.turn.continued').length,1);
 }finally{clearTimeout(timer);turn.cancel();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('real native SDK completes a slow tool and writes after queued internal steering', {timeout:160000},async t=>{
 const folder=await workspace(t),bodies=[],events=[];let entered,release,toolSignal,approvals=0;
 const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  if(req.url.includes('count_tokens')){res.writeHead(200,{'content-type':'application/json'});res.end('{"input_tokens":100}');return;}
  if(!req.url.startsWith('/v1/messages')){res.writeHead(404);res.end();return;}
  const body=JSON.parse(raw);bodies.push(body);const round=bodies.length;
  const call=round===1?{name:'mcp__daidalis__web_search',args:{}}:round===3?{name:'Write',args:{file_path:path.join(folder,'after-steering.txt'),content:'ORIGINAL_TOOL_AND_INTERNAL_MESSAGE_COMPLETED\n'}}:null;
  const text=round===2?'Original search finished.':'Internal steering completed.';
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
  const send=(event,data)=>res.write('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n');
  send('message_start',{type:'message_start',message:{id:'msg_internal_fixture_'+round,type:'message',role:'assistant',content:[],model:'claude-sonnet-4-5-20250929',stop_reason:null,stop_sequence:null,usage:{input_tokens:100,output_tokens:0}}});
  send('content_block_start',{type:'content_block_start',index:0,content_block:call?{type:'tool_use',id:'internal-tool-'+round,name:call.name,input:{}}:{type:'text',text:''}});
  send('content_block_delta',{type:'content_block_delta',index:0,delta:call?{type:'input_json_delta',partial_json:JSON.stringify(call.args)}:{type:'text_delta',text}});
  send('content_block_stop',{type:'content_block_stop',index:0});send('message_delta',{type:'message_delta',delta:{stop_reason:call?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:20}});send('message_stop',{type:'message_stop'});res.end();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const turn=createClaudeRuntime({configDir:path.join(await fs.realpath(folder),'native-config')}).startTurn({workspace:folder,apiKey:'sk-ant-local-fixture-not-real',baseUrl:'http://127.0.0.1:'+server.address().port,model:'claude-sonnet-4-5-20250929',permissionMode:'manual',maxTurns:12,input:'Complete the local search fixture.',
  tools:[{name:'web_search',description:'Local slow search fixture',parameters:{type:'object',properties:{}}}],executeTool:async(name,args,{signal})=>{toolSignal=signal;entered();await gate;return {results:[{title:'Original tool result retained'}]};},
  requestApproval:async({tool,args})=>{assert.equal(tool,'Write');assert.equal(args.file_path,path.join(folder,'after-steering.txt'));approvals++;return true;},onEvent:event=>events.push(event)});
 const timer=setTimeout(()=>turn.cancel(),140000);
 try{
  await Promise.race([started,turn.completion.then(()=>{throw Error('Native query ended before the slow tool');})]);
  const receipt=await turn.steer('Save the supplementary receipt',{origin:'agent'});assert.equal(receipt.delivery,'queued-next-segment');assert.equal(toolSignal.aborted,false);release();
  const result=await turn.completion;assert.equal(result.content,'Internal steering completed.');assert.equal(bodies.length,4);assert.equal(approvals,1);
  assert.equal(await fs.readFile(path.join(folder,'after-steering.txt'),'utf8'),'ORIGINAL_TOOL_AND_INTERNAL_MESSAGE_COMPLETED\n');
  const resumed=JSON.stringify(bodies[2].messages);assert.match(resumed,/Original tool result retained/);assert.match(resumed,/Project agent message/);assert.match(resumed,/Save the supplementary receipt/);
  assert.doesNotMatch(JSON.stringify(bodies),/The user doesn't want to proceed|Request interrupted by user/);
  assert.ok(events.some(event=>event.type==='runtime.steering.applied'&&event.data.delivery==='queued-next-segment'));
 }finally{clearTimeout(timer);release();turn.cancel();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('cancel closes native query and rejects completion; aborted approval cannot execute',async t=>{const folder=await workspace(t);let wake,ready;const started=new Promise(r=>ready=r);const h=harness(function(){const gen=(async function*(){ready();await new Promise(r=>wake=r);yield success();})();gen.onClose=()=>wake?.();return gen;});const turn=h.runtime.startTurn({...h.options,workspace:folder});await started;turn.cancel();await assert.rejects(turn.completion,{name:'AbortError'});assert.ok(h.captures.closed);const controller=new AbortController();controller.abort();await assert.rejects(h.runtime.startTurn({...h.options,workspace:folder,signal:controller.signal}).completion,{name:'AbortError'});});

test('native result errors and missing result fail; selected credential is redacted from public text',async t=>{const folder=await workspace(t);for(const stream of [async function*(){yield {type:'result',subtype:'error_during_execution',errors:['invalid fixture-key-not-a-real-secret'],session_id:SID};},async function*(){yield assistant('没有结果');}]){const h=harness(stream);await assert.rejects(h.runtime.startTurn({...h.options,workspace:folder}).completion,error=>!error.message.includes('fixture-key-not-a-real-secret'));}const h=harness(async function*(){yield assistant('fixture-key-not-a-real-secret');yield success('fixture-key-not-a-real-secret');});const r=await h.runtime.startTurn({...h.options,workspace:folder}).completion;assert.equal(r.content,'[REDACTED]');assert.ok(h.captures.messages.every(m=>!m.text.includes('fixture-key-not-a-real-secret')));});

test('installed SDK and bundled Claude binary exist: actual no-model startup probe',async()=>{assert.equal(typeof installedSdk.query,'function');assert.equal(typeof installedSdk.tool,'function');const binary=path.join(path.dirname(require.resolve('@anthropic-ai/claude-agent-sdk')),'..','claude-agent-sdk-'+process.platform+'-'+process.arch,process.platform==='win32'?'claude.exe':'claude');const stat=await fs.stat(binary);assert.ok(stat.isFile());const result=spawnSync(binary,['--version'],{encoding:'utf8',timeout:30000,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR}});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Claude Code/);});

test('actual native SDK loop executes builtin Write and in-process engineering MCP against local SSE fixture', {timeout:160000}, async t=>{
  const folder=await workspace(t),routes=[],names=new Set(),toolCalls=[],publicMessages=[],nativeEvents=[];let modelCalls=0,approvals=0;
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;routes.push(req.method+' '+req.url);
    if(req.url.includes('count_tokens')){res.writeHead(200,{'content-type':'application/json'});res.end('{"input_tokens":100}');return;}
    if(!req.url.startsWith('/v1/messages')){res.writeHead(404,{'content-type':'application/json'});res.end('{"error":{"type":"not_found_error","message":"Local fixture only"}}');return;}
    const body=JSON.parse(raw);for(const tool of body.tools||[])if(tool.name)names.add(tool.name);modelCalls++;
    const call=modelCalls===1?{name:'Write',args:{file_path:path.join(folder,'native-proof.txt'),content:'Actually written by Claude SDK builtin Write.'}}:modelCalls===2?{name:'mcp__daidalis__list_files',args:{}}:null;
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
    const send=(event,data)=>res.write('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n');
    send('message_start',{type:'message_start',message:{id:'msg_native_fixture_'+modelCalls,type:'message',role:'assistant',content:[],model:'claude-sonnet-4-5-20250929',stop_reason:null,stop_sequence:null,usage:{input_tokens:100,output_tokens:0}}});
    if(call){send('content_block_start',{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'native-tool-'+modelCalls,name:call.name,input:{}}});send('content_block_delta',{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(call.args)}});}
    else{send('content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}});send('content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Local native SDK fixture complete.'}});}
    send('content_block_stop',{type:'content_block_stop',index:0});send('message_delta',{type:'message_delta',delta:{stop_reason:call?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:20}});send('message_stop',{type:'message_stop'});res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const turn=createClaudeRuntime({configDir:path.join(await fs.realpath(folder),'native-config')}).startTurn({workspace:folder,apiKey:'sk-ant-local-fixture-not-real',baseUrl:'http://127.0.0.1:'+server.address().port,model:'claude-sonnet-4-5-20250929',permissionMode:'manual',instructions:'This is a deterministic local integration fixture. Work only inside the selected folder.',input:'Write the proof, read the engineering model, then finish. No paid model is used.',
    tools:[{name:'list_files',description:'List local fixture project files',parameters:{type:'object',properties:{}}}],executeTool:async(name,args)=>{toolCalls.push({name,args});return {files:[]};},
    requestApproval:async request=>{assert.equal(request.tool,'Write');await assert.rejects(fs.stat(path.join(folder,'native-proof.txt')));approvals++;return true;},onMessage:m=>publicMessages.push(m),onEvent:e=>nativeEvents.push(e)});
  const timer=setTimeout(()=>turn.cancel(),140000);
  try{const result=await turn.completion;assert.equal(result.content,'Local native SDK fixture complete.');assert.match(result.sessionId,/^[0-9a-f-]{36}$/);assert.equal(await fs.readFile(path.join(folder,'native-proof.txt'),'utf8'),'Actually written by Claude SDK builtin Write.');assert.equal(approvals,1);assert.equal(modelCalls,3);assert.deepEqual(toolCalls,[{name:'list_files',args:{}}]);assert.ok(routes.every(r=>r.startsWith('POST /v1/messages')));assert.ok(names.has('Write'));assert.ok(names.has('Read'));assert.ok(names.has('Bash'));assert.ok(names.has('mcp__daidalis__list_files'));assert.ok(!names.has('Agent')&&!names.has('Task'));assert.equal(new Set(publicMessages.map(m=>m.id)).size,1);assert.equal(publicMessages.at(-1).phase,'final');assert.ok(nativeEvents.some(e=>e.type==='tool.completed'&&e.data.tool==='Write'));}
  finally{clearTimeout(timer);turn.cancel();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});


test('native session config is private and factory/options directories reject symlink aliases',async t=>{
  const folder=await workspace(t),canonical=await fs.realpath(folder),config=path.join(canonical,'private','claude'),h=harness(simple);
  const runtime=createClaudeRuntime({sdkLoader:async()=>({...installedSdk,z,query:q=>{const gen=simple(q);gen.close=()=>{};h.captures.queries.push(q);return gen;}}),configDir:config});
  await runtime.startTurn({...h.options,workspace:folder}).completion;
  assert.equal(h.captures.queries[0].options.env.CLAUDE_CONFIG_DIR,config);assert.equal((await fs.stat(config)).mode&0o777,0o700);
  const alias=path.join(canonical,'alias');await fs.symlink(config,alias);await assert.rejects(runtime.startTurn({...h.options,workspace:folder,configDir:alias}).completion,/符号链接/);
});


test('Claude MCP wait uses invocation abort signal without publishing a late success',async t=>{
 const folder=await workspace(t);let entered,rejectLate,toolSignal,toolResult;
 const started=new Promise(r=>entered=r),gate=new Promise((_,r)=>rejectLate=r),invocation=new AbortController();
 const h=harness(async function*(q,c){yield {type:'system',subtype:'init',session_id:SID};toolResult=await c.servers[0].tools[0].handler({}, {signal:invocation.signal});yield assistant();yield success();});
 const turn=h.runtime.startTurn({...h.options,workspace:folder,tools:[{name:'wait_threads',parameters:{type:'object',properties:{}}}],executeTool:async(name,args,{signal})=>{toolSignal=signal;entered();return gate;}});
 await started;assert.equal(toolSignal.aborted,false);invocation.abort();await turn.completion;
 assert.equal(toolSignal.aborted,true);assert.equal(toolResult.isError,true);rejectLate(Error('late MCP rejection'));await new Promise(r=>setImmediate(r));assert.equal(toolResult.isError,true);
});

test('Claude cancel terminates a pending MCP wait even if its callback ignores cancellation',async t=>{
 const folder=await workspace(t);let entered,release,toolSignal,toolResult;
 const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const h=harness(async function*(q,c){yield {type:'system',subtype:'init',session_id:SID};toolResult=await c.servers[0].tools[0].handler({});yield success();});
 const turn=h.runtime.startTurn({...h.options,workspace:folder,tools:[{name:'wait_threads',parameters:{type:'object',properties:{}}}],executeTool:async(name,args,{signal})=>{toolSignal=signal;entered();return gate;}});
 await started;const rejected=assert.rejects(turn.completion,{name:'AbortError'});turn.cancel();await rejected;assert.equal(toolSignal.aborted,true);assert.equal(toolResult.isError,true);
 release({lateSuccess:true});await new Promise(r=>setImmediate(r));assert.equal(toolResult.isError,true);
});

test('Claude steering releases the old MCP wait and resumes the same session with a fresh invocation signal',async t=>{
 const folder=await workspace(t);let entered,rejectLate,oldSignal,oldResult,newSignal,calls=0;
 const started=new Promise(r=>entered=r),gate=new Promise((_,r)=>rejectLate=r);
 const h=harness(async function*(q,c,index){yield {type:'system',subtype:'init',session_id:SID};
  const result=await c.servers[0].tools[0].handler({});
  if(index===0){oldResult=result;yield {type:'result',subtype:'error_during_execution',errors:['interrupted'],session_id:SID};}
  else{assert.equal(result.isError,undefined);yield assistant('Resumed');yield success('Resumed');}
 });
 const turn=h.runtime.startTurn({...h.options,workspace:folder,tools:[{name:'wait_threads',parameters:{type:'object',properties:{}}}],executeTool:async(name,args,{signal})=>{if(++calls===1){oldSignal=signal;entered();return gate;}newSignal=signal;return {actual:'new result'};}});
 await started;await turn.steer('Use the new dependency');assert.equal((await turn.completion).content,'Resumed');
 assert.equal(oldSignal.aborted,true);assert.equal(oldResult.isError,true);assert.equal(h.captures.queries[1].options.resume,SID);assert.equal(calls,2);
 rejectLate(Error('old query settled late'));await new Promise(r=>setImmediate(r));assert.equal(oldResult.isError,true);assert.equal(newSignal.aborted,true);
});


for(const [label,sessionId,namespace,allowed] of [
 ['fresh thread',undefined,legacyToolNamespace,false],
 ['unmarked persisted thread',SID,undefined,false],
 ['validated previous-name thread',SID,legacyToolNamespace,true],
 ['unrecognized namespace marker',SID,'untrusted',false],
])test('previous Claude MCP namespace: '+label,async t=>{
 const folder=await workspace(t),calls=[];
 const h=harness(async function*(q,c){
  const name='mcp__'+legacyToolNamespace+'__list_files',provenance={name:legacyToolNamespace,source:'sdk'};
  const pre=await q.options.hooks.PreToolUse[0].hooks[0]({tool_name:name,tool_input:{},mcp_server:provenance},'previous-tool');
  assert.equal(pre.hookSpecificOutput.permissionDecision,allowed?'allow':'deny');
  assert.equal((await q.options.canUseTool(name,{}, {mcpServer:provenance})).behavior,allowed?'allow':'deny');
  assert.equal(Object.hasOwn(q.options.mcpServers,legacyToolNamespace),allowed);
  assert(Object.hasOwn(q.options.mcpServers,'daidalis'));
  if(allowed){
   // Even the valid alias must retain exact registration and SDK provenance.
   for(const [tool,server] of [[name,{...provenance,source:'project'}],[name,{name:'external',source:'sdk'}],['mcp__'+legacyToolNamespace+'__unregistered',provenance]]){
    assert.equal((await q.options.canUseTool(tool,{}, {mcpServer:server})).behavior,'deny');
   }
   const server=q.options.mcpServers[legacyToolNamespace],[clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
   const client=new Client({name:'daidalis-rename-test',version:'1.0.0'});
   try{
    await server.instance.connect(serverTransport);await client.connect(clientTransport);
    assert.equal((await client.callTool({name:'list_files',arguments:{}})).isError,undefined);
   }finally{await client.close();await server.instance.close();}
  }
  yield assistant();yield success();
 });
 await h.runtime.startTurn({...h.options,workspace:folder,sessionId,legacyToolNamespace:namespace,tools:[{name:'list_files',parameters:{type:'object',properties:{}}}],executeTool:async(name,args)=>{calls.push({name,args});return {files:['actual-fixture.sysml']};},requestApproval:async()=>assert.fail('Denied namespaces must never reach approval')}).completion;
 assert.equal(calls.length,allowed?1:0);
});
