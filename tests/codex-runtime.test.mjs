import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createCodexRuntime} from '../server/runtimes/codex.mjs';
const fixtureSource=String.raw`
import readline from 'node:readline';
const scenario=process.env.SYSPILOT_PROTOCOL_CASE;let threadId,turnId='native-turn',workspace,approvalResponse;
const send=m=>process.stdout.write(JSON.stringify(m)+'\n'),note=(method,params)=>send({method,params:{threadId,turnId,...params}}),response=(id,result)=>send({id,result});
function item(item,ended=false){note(ended?'item/completed':'item/started',{item});}
function final(text){item({type:'reasoning',id:'hidden',summary:[{text:'PRIVATE_REASONING'}],content:[{text:'PRIVATE_REASONING'}]},true);note('item/reasoning/textDelta',{itemId:'hidden',delta:'PRIVATE_REASONING'});item({type:'agentMessage',id:'answer',text:'',phase:'final_answer'});note('item/agentMessage/delta',{itemId:'answer',delta:text.slice(0,8)});note('item/agentMessage/delta',{itemId:'answer',delta:text.slice(8)});item({type:'agentMessage',id:'answer',text,phase:'final_answer'},true);note('thread/tokenUsage/updated',{tokenUsage:{last:{totalTokens:42,inputTokens:30,outputTokens:12},total:{totalTokens:42}}});note('turn/completed',{turn:{id:turnId,status:'completed',items:[{type:'agentMessage',id:'answer',text,phase:'final_answer'}],error:null}});}
function fileStep(){const file={type:'fileChange',id:'patch',changes:[{path:scenario==='outside'?'/outside-project/design.md':workspace+'/design.md',kind:{type:'add'},diff:'+ actual proposed design'}],status:'inProgress'};item(file);send({id:9002,method:'item/fileChange/requestApproval',params:{threadId,turnId,itemId:'patch',startedAtMs:Date.now(),reason:'Review proposed changes'}});}
function dynamicStep(){const tool={type:'dynamicToolCall',id:'dynamic-call',namespace:'syspilot',tool:'project_snapshot',arguments:{question:'show model'},status:'inProgress'};item(tool);send({id:9003,method:'item/tool/call',params:{threadId,turnId,callId:'dynamic-call',namespace:'syspilot',tool:'project_snapshot',arguments:tool.arguments}});}
function start(){note('turn/started',{turn:{id:turnId,status:'inProgress'}});if(scenario==='utf8'){const raw=Buffer.from(JSON.stringify({method:'item/completed',params:{threadId,turnId,item:{type:'agentMessage',id:'unicode',phase:'final_answer',text:'工程模型验证'}}})+'\n'),split=raw.indexOf(Buffer.from('工程'))+1;process.stdout.write(raw.subarray(0,split));setTimeout(()=>{process.stdout.write(raw.subarray(split));note('turn/completed',{turn:{id:turnId,status:'completed',items:[]}});},15);return;}if(scenario==='steer')return;if(scenario.startsWith('tool-wait')){dynamicStep();return;}item({type:'agentMessage',id:'progress',text:'',phase:'commentary'});note('item/agentMessage/delta',{itemId:'progress',delta:'Checking '});note('item/agentMessage/delta',{itemId:'progress',delta:'declared model.'});item({type:'agentMessage',id:'progress',text:'Checking declared model.',phase:'commentary'},true);
if(scenario==='permissions'){send({id:9010,method:'item/permissions/requestApproval',params:{threadId,turnId,itemId:'permission',cwd:workspace,permissions:{network:{enabled:true}},startedAtMs:Date.now()}});return;}
if(scenario==='unknown'){send({id:9011,method:'item/unknown/requestApproval',params:{threadId,turnId}});return;}
if(scenario==='outside'){fileStep();return;}
item({type:'commandExecution',id:'command',command:'printf checked',cwd:workspace,status:'inProgress',commandActions:[]});send({id:9001,method:'item/commandExecution/requestApproval',params:{threadId,turnId,itemId:'command',command:'printf checked',cwd:workspace,startedAtMs:Date.now(),...(scenario==='expanded'?{additionalPermissions:{network:{enabled:true}}}:{})}});}
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')response(m.id,{userAgent:'fixture-app-server'});else if(m.method==='initialized'){}else if(m.method==='thread/start'&&scenario==='start-missing'){send({id:m.id,error:{code:-32000,message:'no rollout found for thread id native-session'}});}else if(m.method==='thread/start'){threadId='native-session';workspace=m.params.cwd;response(m.id,{thread:{id:threadId},...(scenario==='resolved-model'?{model:'native-resolved-model'}:{})});note('thread/started',{thread:{id:threadId}});}else if(m.method==='thread/resume'&&scenario.startsWith('resume-')){const errors={'resume-rollout':'no rollout found for thread id persisted-native-id','resume-session':'session missing','resume-thread':'thread persisted-native-id not found','resume-auth':'authentication failed: session missing access token','resume-network':'network connection failed','resume-permission':'permission denied'};send({id:m.id,error:{code:-32000,message:errors[scenario]}});}else if(m.method==='thread/resume'){threadId=m.params.threadId;workspace=m.params.cwd;response(m.id,{thread:{id:threadId},...(scenario==='resolved-model'?{model:'native-resolved-model'}:{})});send({method:'item/completed',params:{threadId,turnId:'prior-turn',item:{type:'agentMessage',id:'historical',text:'HISTORICAL_RESPONSE',phase:'final_answer'}}});send({method:'turn/completed',params:{threadId,turn:{id:'prior-turn',status:'completed',items:[]}}});}else if(m.method==='thread/inject_items'){response(m.id,{});send({method:'item/completed',params:{threadId,turnId:'injected-old-turn',item:{type:'agentMessage',id:'injected',text:'HISTORICAL_INJECTION',phase:'commentary'}}});}else if(m.method==='turn/start'&&scenario==='delayed-turn-start'){setTimeout(()=>{response(m.id,{turn:{id:turnId,status:'inProgress'}});final('Delayed remote turn started');},600);}else if(m.method==='turn/start'){response(m.id,{turn:{id:turnId,status:'inProgress'}});start();}else if(m.method==='turn/steer'){if(m.params.expectedTurnId!==turnId)send({id:m.id,error:{message:'Wrong turn'}});else{response(m.id,{turnId});final('Steered: '+m.params.input[0].text);}}else if(m.method==='turn/interrupt'){response(m.id,{});note('turn/completed',{turn:{id:turnId,status:'interrupted',items:[],error:null}});}else if(m.id===9001){approvalResponse=m.result;if(scenario==='cancel')return;if(scenario==='expanded'){final('Expansion declined: '+m.result.decision);return;}item({type:'commandExecution',id:'command',command:'printf checked',cwd:workspace,status:m.result.decision==='accept'?'completed':'declined',commandActions:[],aggregatedOutput:m.result.decision==='accept'?'checked':'',exitCode:m.result.decision==='accept'?0:1},true);fileStep();}else if(m.id===9002){if(scenario==='outside'){final('Outside declined: '+m.result.decision);return;}item({type:'fileChange',id:'patch',changes:[{path:workspace+'/design.md',kind:{type:'add'},diff:'+ actual proposed design'}],status:m.result.decision==='accept'?'completed':'declined'},true);dynamicStep();}else if(m.id===9003){if(scenario.startsWith('tool-wait')){final('Tool completed: '+m.result.success);return;}item({type:'dynamicToolCall',id:'dynamic-call',namespace:'syspilot',tool:'project_snapshot',arguments:{question:'show model'},status:m.result.success?'completed':'failed',...m.result},true);send({id:9004,method:'item/tool/requestUserInput',params:{threadId,turnId,itemId:'question',isBlocking:true,questions:[{id:'choice',header:'Model',question:'Keep this model?',options:[{label:'Keep',description:'Retain the declared model'}]}]}});}else if(m.id===9004)final('Accepted evidence: '+(m.result.answers.choice?.answers?.[0]||'cancelled'));else if(m.id===9010)final('Permissions returned: '+JSON.stringify(m.result));});
`;
async function setup(t,scenario='happy'){
 const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'syspilot-native-codex-')));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const fixture=path.join(dir,'app-server-fixture.mjs');await fs.writeFile(fixture,fixtureSource);const frames=[],spawns=[];
 const runtime=createCodexRuntime({codexPath:process.execPath,requestTimeoutMs:3000,spawnImpl:(exe,args,opts)=>{spawns.push({exe,args,opts});const child=spawn(process.execPath,[fixture],{...opts,env:{...opts.env,SYSPILOT_PROTOCOL_CASE:scenario}});const write=child.stdin.write.bind(child.stdin);child.stdin.write=(data,...rest)=>{for(const line of String(data).trim().split('\n'))frames.push(JSON.parse(line));return write(data,...rest);};return child;}});t.after(()=>runtime.close());return {dir,runtime,frames,spawns};
}
const tool={name:'project_snapshot',description:'Read project evidence',parameters:{type:'object',properties:{question:{type:'string'}}}};
function options(dir,extra={}){return {workspace:dir,input:'Analyze the project',instructions:'Preserve engineering evidence boundaries',tools:[tool],executeTool:async()=>({actual:'recorded solver output',_image:{mediaType:'image/png',data:Buffer.from('actual image pixels').toString('base64')}}),requestApproval:async()=>true,requestUserInput:async()=>({choice:{answers:['keep']}}),...extra};}

test('Codex native protocol owns turns, streams public messages, executes dynamic tools/images and preserves usage',async t=>{
 const h=await setup(t),messages=[],events=[],sessions=[],approvals=[],calls=[];const handle=h.runtime.startTurn(options(h.dir,{history:[{role:'user',content:'Prior user request'},{role:'assistant',content:'Prior public answer'}],onSession:id=>sessions.push(id),onMessage:m=>messages.push(m),onEvent:e=>events.push(e),requestApproval:async p=>{approvals.push(p);return true;},executeTool:async(name,args)=>{calls.push({name,args});return {actual:'recorded solver output',_image:{mediaType:'image/png',data:Buffer.from('actual image pixels').toString('base64')}};}}));assert.ok(handle.completion instanceof Promise);assert.equal(typeof handle.steer,'function');const result=await handle.completion;
 assert.equal(result.sessionId,'native-session');assert.equal(result.content,'Accepted evidence: keep');assert.equal(result.usage.last.totalTokens,42);assert.deepEqual(sessions,['native-session']);assert.deepEqual(calls,[{name:'project_snapshot',args:{question:'show model'}}]);assert.deepEqual(approvals.map(a=>a.tool),['codex.commandExecution','codex.fileChange']);assert.ok(messages.some(m=>m.partial&&m.text==='Checking '));assert.equal(messages.filter(m=>!m.partial&&m.id==='answer').length,1);assert.equal(messages.find(m=>!m.partial&&m.id==='answer').phase,'final_answer');assert.equal(JSON.stringify({messages,events,result}).includes('PRIVATE_REASONING'),false);assert.equal(JSON.stringify(messages).includes('HISTORICAL_'),false);
 const start=h.frames.find(m=>m.method==='thread/start').params;assert.equal(start.sandbox,'read-only');assert.equal(start.approvalPolicy,'on-request');assert.equal(start.approvalsReviewer,'user');assert.equal(start.dynamicTools[0].name,'syspilot');assert.equal(start.dynamicTools[0].tools[0].inputSchema.type,'object');assert.equal(h.frames.find(m=>m.method==='thread/inject_items').params.items.length,2);assert.ok(!h.frames.some(m=>m.method==='config/value/write'));const dynamic=h.frames.find(m=>m.id===9003).result;assert.equal(dynamic.success,true);assert.equal(dynamic.contentItems[1].type,'inputImage');assert.match(dynamic.contentItems[1].imageUrl,/^data:image\/png;base64,/);assert.equal(events.filter(e=>e.type==='tool.started').length,3);assert.equal(events.find(e=>e.type==='tool.completed'&&e.data.tool==='codex.commandExecution').data.result.stdout,'checked');assert.equal(events.find(e=>e.type==='tool.completed'&&e.data.tool==='project_snapshot').data.result.actual,'recorded solver output');
 assert.ok(h.spawns[0].args.includes('multi_agent'));assert.ok(!h.spawns[0].args.includes('shell_tool'));assert.ok(!h.spawns[0].args.includes('unified_exec'));assert.ok(!h.spawns[0].args.includes('--output-schema'));assert.equal(h.frames.find(m=>m.method==='turn/start').params.sandboxPolicy.type,'readOnly');
});

test('Codex resumes a persisted native session without replaying old public history and steers its active turn',async t=>{
 const h=await setup(t,'steer'),messages=[];const handle=h.runtime.startTurn(options(h.dir,{sessionId:'persisted-native-id',history:[{role:'user',content:'Must not replay'}],onMessage:m=>messages.push(m)}));const steering=await handle.steer('Focus on the interface');assert.equal(steering.turnId,'native-turn');const result=await handle.completion;assert.equal(result.sessionId,'persisted-native-id');assert.equal(result.content,'Steered: Focus on the interface');assert.equal(h.frames.some(m=>m.method==='thread/start'),false);assert.equal(h.frames.some(m=>m.method==='thread/inject_items'),false);assert.equal(h.frames.find(m=>m.method==='thread/resume').params.excludeTurns,true);assert.equal(h.frames.find(m=>m.method==='turn/steer').params.expectedTurnId,'native-turn');assert.ok(messages.some(m=>m.partial));assert.equal(JSON.stringify(messages).includes('HISTORICAL_'),false);
});

test('Codex native policies use on-request for new and resumed Manual/Auto sessions, preserving project sandbox boundaries',async t=>{
 for(const permissionMode of ['manual','auto'])for(const resumed of [false,true]){
  const h=await setup(t),approvals=[],sessionId=resumed?'persisted-native-id':undefined;
  await h.runtime.startTurn(options(h.dir,{permissionMode,sessionId,requestApproval:async p=>{approvals.push(p);return true;}})).completion;
  const thread=h.frames.find(m=>m.method===(resumed?'thread/resume':'thread/start')).params,turn=h.frames.find(m=>m.method==='turn/start').params;
  assert.equal(thread.approvalPolicy,'on-request');assert.equal(turn.approvalPolicy,'on-request');assert.equal(thread.approvalsReviewer,'user');assert.equal(turn.approvalsReviewer,'user');
  assert.ok(h.spawns[0].args.includes('approvals_reviewer="user"'));assert.equal(thread.cwd,h.dir);assert.equal(turn.cwd,h.dir);
  assert.equal(thread.config['sandbox_workspace_write.network_access'],false);assert.equal(thread.config['sandbox_workspace_write.exclude_tmpdir_env_var'],true);assert.equal(thread.config['sandbox_workspace_write.exclude_slash_tmp'],true);
  if(permissionMode==='auto'){assert.equal(thread.sandbox,'workspace-write');assert.deepEqual(turn.sandboxPolicy,{type:'workspaceWrite',writableRoots:[h.dir],networkAccess:false,excludeSlashTmp:true,excludeTmpdirEnvVar:true});}
  else{assert.equal(thread.sandbox,'read-only');assert.deepEqual(turn.sandboxPolicy,{type:'readOnly',networkAccess:false});}
  // Actual native requests remain approval decisions even when a turn has Auto's
  // workspace-write sandbox. Ordinary sandboxed actions need no such requests.
  assert.deepEqual(approvals.map(p=>p.tool),['codex.commandExecution','codex.fileChange']);assert.equal(h.frames.find(m=>m.id===9001).result.decision,'accept');assert.equal(h.frames.find(m=>m.id===9002).result.decision,'accept');
 }
});

test('Native Auto forwards actual command and file approval requests and honors denial',async t=>{
 const h=await setup(t),approvals=[];await h.runtime.startTurn(options(h.dir,{permissionMode:'auto',requestApproval:async p=>{approvals.push(p);return false;}})).completion;
 assert.deepEqual(approvals.map(p=>p.tool),['codex.commandExecution','codex.fileChange']);assert.equal(h.frames.find(m=>m.id===9001).result.decision,'decline');assert.equal(h.frames.find(m=>m.id===9002).result.decision,'decline');
});

test('Native approval denial has a real declined result instead of fabricated execution output',async t=>{
 const h=await setup(t),events=[];await h.runtime.startTurn(options(h.dir,{requestApproval:async()=>false,onEvent:e=>events.push(e)})).completion;assert.equal(h.frames.find(m=>m.id===9001).result.decision,'decline');assert.equal(h.frames.find(m=>m.id===9002).result.decision,'decline');const command=events.find(e=>e.type==='tool.completed'&&e.data.tool==='codex.commandExecution');assert.equal(command.data.result.status,'declined');assert.equal(command.data.result.stdout,'');assert.match(command.data.result.error,/declined/i);
});

test('Permission expansion and out-of-project native changes fail closed without an approval shortcut',async t=>{
 for(const scenario of ['permissions','outside','expanded']){const h=await setup(t,scenario),events=[];let approvals=0;await h.runtime.startTurn(options(h.dir,{permissionMode:'auto',requestApproval:async()=>{approvals++;return true;},onEvent:e=>events.push(e)})).completion;assert.equal(approvals,0);assert.ok(events.some(e=>e.type==='runtime.approval.denied'));if(scenario==='permissions')assert.deepEqual(h.frames.find(m=>m.id===9010).result,{permissions:{},scope:'turn'});else assert.equal(h.frames.find(m=>m.id===(scenario==='outside'?9002:9001)).result.decision,'decline');}
});

test('Unknown native permission requests terminate explicitly rather than being auto-approved',async t=>{
 const h=await setup(t,'unknown');await assert.rejects(h.runtime.startTurn(options(h.dir)).completion,/unsupported native request/i);assert.equal(h.frames.find(m=>m.id===9011).error.code,-32601);
});

test('Cancellation uses native turn interrupt while a real approval is pending',async t=>{
 const h=await setup(t,'cancel');let seenApproval;const pendingApproval=new Promise(r=>{seenApproval=r;});const handle=h.runtime.startTurn(options(h.dir,{requestApproval:({signal})=>{seenApproval();return new Promise(resolve=>signal.addEventListener('abort',()=>resolve(false),{once:true}));}}));await pendingApproval;const completed=assert.rejects(handle.completion,{name:'AbortError'});await handle.cancel();await completed;assert.equal(h.frames.find(m=>m.method==='turn/interrupt').params.turnId,'native-turn');assert.equal(h.frames.find(m=>m.method==='turn/interrupt').params.threadId,'native-session');
});

test('Custom Responses config is process-local, uses a unique key env and strips other provider secrets',async t=>{
 const h=await setup(t);process.env.SYSPILOT_OTHER_PROVIDER_SECRET='must-not-reach-native';t.after(()=>delete process.env.SYSPILOT_OTHER_PROVIDER_SECRET);await h.runtime.startTurn(options(h.dir,{model:'custom-responses-model',baseUrl:'https://api.example.test/v1/responses',apiKey:'actual-custom-private-key',secretEnvNames:['SYSPILOT_OTHER_PROVIDER_SECRET']})).completion;const config=h.frames.find(m=>m.method==='thread/start').params.config,provider=config.model_providers.syspilot_runtime;assert.equal(provider.wire_api,'responses');assert.equal(provider.base_url,'https://api.example.test/v1');assert.match(provider.env_key,/^SYSPILOT_CODEX_KEY_[A-F0-9]+$/);assert.equal(h.spawns[0].opts.env[provider.env_key],'actual-custom-private-key');assert.equal(h.spawns[0].opts.env.SYSPILOT_OTHER_PROVIDER_SECRET,undefined);assert.equal(JSON.stringify(h.frames).includes('actual-custom-private-key'),false);assert.equal(config.shell_environment_policy.inherit,'none');assert.equal(JSON.stringify(config.shell_environment_policy).includes('actual-custom-private-key'),false);assert.ok(!h.frames.some(m=>m.method?.startsWith('config/')));
 assert.throws(()=>h.runtime.startTurn(options(h.dir,{baseUrl:'https://api.example.test/v1/chat/completions'})),/Responses/);assert.throws(()=>h.runtime.startTurn(options(h.dir,{wireApi:'chat'})),/Responses/);
});

test('Optional native read isolation launches under a default-deny OS profile with a private Codex home',async t=>{
 if(process.platform!=='darwin')return t.skip('macOS sandbox profile');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'manta-read-isolation-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const workspace=path.join(root,'project'),privateRoot=path.join(root,'private');await fs.mkdir(workspace);await fs.mkdir(privateRoot);
 const fixture=path.join(workspace,'app-server-fixture.mjs');await fs.writeFile(fixture,fixtureSource);
 const spawns=[];const runtime=createCodexRuntime({codexPath:process.execPath,readIsolation:{privateRoot},requestTimeoutMs:3000,spawnImpl:(exe,args,opts)=>{spawns.push({exe,args,opts});return spawn(process.execPath,[fixture],{...opts,env:{...opts.env,SYSPILOT_PROTOCOL_CASE:'happy'}});}});t.after(()=>runtime.close());
 await runtime.startTurn(options(workspace,{baseUrl:'https://api.example.test/v1/responses',apiKey:'private-evaluation-key'})).completion;
 const {exe,args,opts}=spawns[0],profile=args[1];assert.equal(exe,'/usr/bin/sandbox-exec');assert.equal(args[0],'-p');assert.match(profile,/\(deny default\)/);assert.ok(profile.includes(`(subpath "${workspace}")`));assert.ok(profile.includes(`(subpath "${privateRoot}")`));assert.ok(!profile.includes('(allow default)'));
 assert.equal(opts.env.HOME,privateRoot);assert.equal(opts.env.CODEX_HOME,path.join(privateRoot,'codex-home'));assert.equal(opts.env.OPENAI_API_KEY,undefined);assert.equal(opts.env.SYSPILOT_CODEX_KEY_,undefined);assert.ok(Object.keys(opts.env).some(key=>key.startsWith('SYSPILOT_CODEX_KEY_')));
 assert.equal(args[2],process.execPath);
});

test('Remote native Codex maps exactly one shared project into the Linux guest',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'manta-remote-codex-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const hostRoot=path.join(root,'shared'),workspace=path.join(hostRoot,'evalproject123');await fs.mkdir(hostRoot);await fs.mkdir(workspace);
 const fixture=path.join(workspace,'app-server-fixture.mjs');await fs.writeFile(fixture,fixtureSource);const spawns=[],frames=[];
 const runtime=createCodexRuntime({codexPath:process.execPath,remoteWorkspace:{hostRoot},requestTimeoutMs:3000,spawnImpl:(exe,args,opts)=>{spawns.push({exe,args,opts});const child=spawn(process.execPath,[fixture],{...opts,env:{...opts.env,SYSPILOT_PROTOCOL_CASE:'happy'}});const write=child.stdin.write.bind(child.stdin);child.stdin.write=(data,...rest)=>{for(const line of String(data).trim().split('\n'))frames.push(JSON.parse(line));return write(data,...rest);};return child;}});t.after(()=>runtime.close());
 await runtime.startTurn(options(workspace,{permissionMode:'auto',baseUrl:'https://api.example.test/v1/responses',apiKey:'private-test-key'})).completion;
 assert.equal(spawns[0].opts.env.MANTA_REMOTE_PROJECT_SLUG,'evalproject123');assert.equal(spawns[0].opts.env.PATH,'/opt/node/bin:/usr/bin:/bin');assert.equal(spawns[0].opts.env.HOME,undefined);
 assert.equal(frames.find(m=>m.method==='thread/start').params.cwd,'/work');assert.equal(frames.find(m=>m.method==='turn/start').params.cwd,'/work');assert.deepEqual(frames.find(m=>m.method==='turn/start').params.sandboxPolicy.writableRoots,['/work']);
 assert.throws(()=>runtime.startTurn(options(root,{apiKey:'private-test-key'})),/Remote Codex requires one project folder/);
 assert.throws(()=>runtime.startTurn(options(workspace)),/requires a configured Responses API key/);
});


test('Remote native turn/start allows bounded VM startup delay without relaxing local deadlines',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'manta-remote-timeout-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const hostRoot=path.join(root,'shared'),workspace=path.join(hostRoot,'evalproject123');await fs.mkdir(hostRoot);await fs.mkdir(workspace);
 const fixture=path.join(workspace,'app-server-fixture.mjs');await fs.writeFile(fixture,fixtureSource);
 const spawnFixture=(exe,args,opts)=>spawn(process.execPath,[fixture],{...opts,env:{...opts.env,SYSPILOT_PROTOCOL_CASE:'delayed-turn-start'}});
 const remote=createCodexRuntime({codexPath:process.execPath,remoteWorkspace:{hostRoot},requestTimeoutMs:300,spawnImpl:spawnFixture});t.after(()=>remote.close());
 const result=await remote.startTurn(options(workspace,{baseUrl:'https://api.example.test/v1/responses',apiKey:'private-test-key'})).completion;
 assert.equal(result.content,'Delayed remote turn started');
 const local=createCodexRuntime({codexPath:process.execPath,requestTimeoutMs:300,spawnImpl:spawnFixture});t.after(()=>local.close());
 await assert.rejects(local.startTurn(options(workspace)).completion,/Codex app-server timed out: turn\/start/);
});

test('Native stdout preserves Chinese text split across UTF-8 pipe chunks',async t=>{const h=await setup(t,'utf8'),messages=[];const result=await h.runtime.startTurn(options(h.dir,{onMessage:m=>messages.push(m)})).completion;assert.equal(result.content,'工程模型验证');assert.equal(messages.at(-1).text,'工程模型验证');});


test('Only explicit native resume missing-session RPC failures receive the recoverable error code, without retrying',async t=>{
 for(const [scenario,missing]of [['resume-rollout',true],['resume-session',true],['resume-thread',true],['resume-auth',false],['resume-network',false],['resume-permission',false],['start-missing',false]]){
   const h=await setup(t,scenario),sessionId=scenario==='start-missing'?undefined:'persisted-native-id';
   await assert.rejects(h.runtime.startTurn(options(h.dir,{sessionId})).completion,error=>{assert.equal(error.code,missing?'NATIVE_SESSION_NOT_FOUND':undefined,scenario);assert.equal(error.sessionId,sessionId||null);assert.match(error.message,/^Codex thread\/(?:resume|start): /);if(scenario==='resume-auth')assert.match(error.message,/authentication failed: session missing access token/);return true;});
   assert.equal(h.frames.some(m=>m.method==='turn/start'),false);assert.equal(h.frames.filter(m=>m.method==='thread/resume').length,sessionId?1:0);assert.equal(h.frames.filter(m=>m.method==='thread/start').length,sessionId?0:1);assert.equal(h.frames.find(m=>m.method==='initialize').params.clientInfo.version,'0.5.0');
 }
});


test('Codex sends model selections to new and resumed native turns without changing global configuration',async t=>{
  for(const resumed of [false,true])for(const model of ['selected-codex-model',null]){
    const h=await setup(t);await h.runtime.startTurn(options(h.dir,{model,...(resumed?{sessionId:'persisted-native-id'}:{})})).completion;
    const thread=h.frames.find(m=>m.method===(resumed?'thread/resume':'thread/start')).params,turn=h.frames.find(m=>m.method==='turn/start').params;
    if(model){assert.equal(thread.model,model);assert.equal(turn.model,model);}else{assert.equal(Object.hasOwn(thread,'model'),false);assert.equal(Object.hasOwn(turn,'model'),false);}
    assert.equal(h.frames.some(m=>m.method?.startsWith('config/')),false);
  }
});

test('Codex reports actual native model metadata only when the runtime provides it',async t=>{
  for(const resumed of [false,true]){
    const h=await setup(t,'resolved-model'),sessions=[];const result=await h.runtime.startTurn(options(h.dir,{model:'requested-model',...(resumed?{sessionId:'persisted-native-id'}:{}),onSession:(id,metadata)=>sessions.push({id,metadata})})).completion;
    assert.equal(result.model,'native-resolved-model');assert.equal(sessions.at(-1).metadata.model,'native-resolved-model');assert.equal(sessions.at(-1).id,resumed?'persisted-native-id':'native-session');
  }
  const h=await setup(t),sessions=[];const result=await h.runtime.startTurn(options(h.dir,{model:'requested-only-model',onSession:(id,metadata)=>sessions.push({id,metadata})})).completion;assert.equal(Object.hasOwn(result,'model'),false);assert.equal(sessions.some(s=>s.metadata?.model),false);
});


test('pending Codex dynamic tool pauses the same native turn until actual result, without extra requests',async t=>{
 const h=await setup(t,'tool-wait');let entered,release,completed=false,toolSignal;
 const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const handle=h.runtime.startTurn(options(h.dir,{executeTool:async(name,args,{signal})=>{toolSignal=signal;entered();return gate;}}));
 handle.completion.then(()=>{completed=true;},()=>{});await started;await new Promise(r=>setImmediate(r));
 assert.equal(completed,false);assert.equal(toolSignal.aborted,false);assert.equal(h.frames.some(f=>f.id===9003),false);assert.equal(h.frames.filter(f=>f.method==='turn/start').length,1);
 release({evidence:'actual child result'});assert.equal((await handle.completion).content,'Tool completed: true');assert.equal(h.frames.find(f=>f.id===9003).result.success,true);
});

test('Codex cancellation aborts pending dynamic callback and never sends late success or rejection',async t=>{
 const h=await setup(t,'tool-wait');let entered,rejectLate,toolSignal;
 const started=new Promise(r=>entered=r),gate=new Promise((_,r)=>rejectLate=r);
 const handle=h.runtime.startTurn(options(h.dir,{executeTool:async(name,args,{signal})=>{toolSignal=signal;entered();return gate;}}));await started;
 const rejected=assert.rejects(handle.completion,{name:'AbortError'});await handle.cancel();await rejected;assert.equal(toolSignal.aborted,true);
 rejectLate(Error('late callback rejection'));await new Promise(r=>setImmediate(r));assert.equal(h.frames.some(f=>f.id===9003),false);
 assert.equal(h.frames.filter(f=>f.method==='turn/interrupt').length,1);
});

test('Codex native steering interrupts pending dynamic callback and retains the native turn',async t=>{
 const h=await setup(t,'tool-wait-steer');let entered,release,toolSignal;
 const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const handle=h.runtime.startTurn(options(h.dir,{executeTool:async(name,args,{signal})=>{toolSignal=signal;entered();return gate;}}));await started;
 await handle.steer('Change the dependency');assert.equal(toolSignal.aborted,true);assert.equal((await handle.completion).content,'Steered: Change the dependency');
 release({lateSuccess:true});await new Promise(r=>setImmediate(r));assert.ok(!h.frames.some(f=>f.id===9003&&f.result?.success));
 assert.equal(h.frames.filter(f=>f.method==='turn/start').length,1);assert.equal(h.frames.filter(f=>f.method==='turn/steer').length,1);
});
