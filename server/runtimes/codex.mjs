import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {codexReadIsolation} from './read-isolation.mjs';
import {resolveCodexExecutable,CODEX_MISSING_MESSAGE} from '../executable-paths.mjs';

const NAMESPACE='syspilot';
const REASONING_NOTIFICATIONS=['item/reasoning/summaryTextDelta','item/reasoning/summaryPartAdded','item/reasoning/textDelta'];
const TOOL_TYPES=new Set(['commandExecution','fileChange','dynamicToolCall','mcpToolCall','webSearch','imageView']);
const abortError=()=>Object.assign(new Error('Codex turn interrupted'),{name:'AbortError',code:'ABORT_ERR'});
function inWorkspace(workspace,value){
  if(typeof value!=='string'||!value)return false;
  const candidate=path.resolve(workspace,value);if(candidate!==workspace&&!candidate.startsWith(workspace+path.sep))return false;
  let current=workspace;for(const part of path.relative(workspace,candidate).split(path.sep).filter(Boolean)){current=path.join(current,part);try{if(fs.lstatSync(current).isSymbolicLink())return false;}catch(e){if(e.code!=='ENOENT')return false;}}
  return true;
}
function responseBase(value){
  if(!value)return null;let url;try{url=new URL(value);}catch{throw new Error('Codex custom endpoint must be a valid Responses API base URL');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('Codex custom endpoint must be HTTP(S), without credentials, query or fragment');
  if(/\/(chat(?:\/completions)?|messages|api\/chat|completions)\/?$/i.test(url.pathname))throw new Error('Codex app-server supports Responses endpoints only; Chat Completions and Anthropic Messages endpoints are unsupported');
  url.pathname=url.pathname.replace(/\/responses\/?$/,'').replace(/\/$/,'');return url.href.replace(/\/$/,'');
}
function stringify(value){try{return JSON.stringify(value);}catch{return JSON.stringify({error:'Tool returned a non-serializable result'});}}
// Only explicit missing-session errors from resume retire a saved session.
// Authentication, transport and turn failures must retain their own semantics.
function nativeRpcFailure(method,detail){
  const message=typeof detail?.message==='string'?detail.message:stringify(detail),error=new Error(`Codex ${method}: ${message}`),plain=message.trim();
  const missingRollout=/^no rollout found(?: for (?:thread|session)(?: id)?(?:\s*[:=]?\s*[\w-]+)?)?\.?$/i.test(plain);
  const missingSession=/^(?:(?:thread|session)(?:\s+(?:id\s+)?[\w-]+)?\s+(?:not found|(?:is\s+)?missing|does not exist)|missing (?:thread|session))(?:\s*:\s*[\w-]+)?\.?$/i.test(plain);
  if(method==='thread/resume'&&(missingRollout||missingSession))error.code='NATIVE_SESSION_NOT_FOUND';
  return error;
}
function nativeOutput(value){
  if(value&&Array.isArray(value.contentItems))return {contentItems:value.contentItems,success:value.success!==false};
  const {_image,...publicValue}=value&&typeof value==='object'&&!Array.isArray(value)?value:{value};
  const contentItems=[{type:'inputText',text:stringify(publicValue)}];
  if(_image?.data&&_image?.mediaType)contentItems.push({type:'inputImage',imageUrl:`data:${_image.mediaType};base64,${_image.data}`});
  return {contentItems,success:!publicValue.error};
}
function publicOutput(item){
  const text=(item.contentItems||[]).filter(x=>x.type==='inputText').map(x=>x.text).join('\n');let result;
  try{result=JSON.parse(text);}catch{result={text};}
  if(item.success===false&&!result?.error)result={...result,error:'Native dynamic tool reported failure'};
  return result;
}
function inputItems(input){
  if(typeof input==='string'&&input.trim())return [{type:'text',text:input}];
  if(Array.isArray(input)&&input.length)return input.map(item=>{if(item?.type==='text'&&typeof item.text==='string')return {type:'text',text:item.text};if(item?.type==='image'&&typeof item.url==='string')return {type:'image',url:item.url};throw new Error('Codex input supports public text and image URL items');});
  throw new Error('Codex turn requires nonempty user input');
}
function oldHistory(items){return (items||[]).filter(m=>['user','assistant'].includes(m.role)&&typeof m.content==='string'&&m.content).map(m=>({type:'message',role:m.role,...(m.role==='assistant'?{phase:'commentary'}:{}),content:[{type:m.role==='assistant'?'output_text':'input_text',text:m.content}]}));}

async function withToolAbort(operation,signal){
  if(signal.aborted)throw abortError();
  let abort;
  try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{abort=()=>reject(abortError());signal.addEventListener('abort',abort,{once:true});})]);}
  finally{signal.removeEventListener('abort',abort);}
}

/** Native app-server transport. Codex owns the agent loop, history, tools and streaming. */
export function createCodexRuntime({codexPath=resolveCodexExecutable(),spawnImpl=spawn,requestTimeoutMs=30000,readIsolation=null,remoteWorkspace=null}={}){
  const handles=new Set();
  function startTurn(options={}){
    if(!codexPath)throw new Error(CODEX_MISSING_MESSAGE);
    if(!['manual','auto',undefined].includes(options.permissionMode))throw new Error('Codex permissionMode must be manual or auto');
    if(options.model!==undefined&&options.model!==null&&(typeof options.model!=='string'||options.model.length>200||/[\x00-\x1f\x7f]/.test(options.model)))throw new Error('Codex model must be text up to 200 characters without control characters');
    if(options.wireApi&&options.wireApi!=='responses')throw new Error('Codex custom providers require the Responses wire API');
    const baseUrl=responseBase(options.baseUrl||(options.apiKey?'https://api.openai.com/v1':null)),workspace=fs.realpathSync(options.workspace||'');
    if(!fs.statSync(workspace).isDirectory()||workspace===path.parse(workspace).root||workspace===os.homedir())throw new Error('Codex requires a specific project directory');
    const input=inputItems(options.input),permissionMode=options.permissionMode||'manual',tools=options.tools||[];
    if(readIsolation&&remoteWorkspace)throw new Error('Choose one native read isolation transport');
    let nativeWorkspace=workspace,remoteSlug=null;
    if(remoteWorkspace){
      if(!options.apiKey&&!remoteWorkspace.allowGuestLogin)throw new Error('Isolated remote Codex requires a configured Responses API key before starting a turn');
      const hostRoot=fs.realpathSync(remoteWorkspace.hostRoot||'');
      if(workspace===hostRoot||!workspace.startsWith(hostRoot+path.sep)||path.dirname(workspace)!==hostRoot||!/^[A-Za-z0-9_-]{8,100}$/.test(path.basename(workspace)))throw new Error('Remote Codex requires one project folder under its isolated shared root');
      nativeWorkspace='/work';remoteSlug=path.basename(workspace);
    }
    const allowedTools=new Map();for(const t of tools){if(!/^[A-Za-z0-9_-]{1,64}$/.test(t.name||'')||allowedTools.has(t.name))throw new Error('Invalid or duplicate dynamic tool name');allowedTools.set(t.name,t);}
    let env={...process.env};const secretValues=[];for(const key of new Set([...(options.secretEnvNames||[]),'OPENAI_API_KEY','ANTHROPIC_API_KEY','AZURE_OPENAI_API_KEY','GEMINI_API_KEY','GOOGLE_API_KEY'])){if(env[key])secretValues.push(env[key]);delete env[key];}
    const isolation=readIsolation?codexReadIsolation({privateRoot:readIsolation.privateRoot,workspace,codexPath}):null;
    if(isolation)env=isolation.env;
    if(remoteSlug)env={PATH:'/opt/node/bin:/usr/bin:/bin',LANG:'C.UTF-8',TMPDIR:'/tmp',MANTA_REMOTE_PROJECT_SLUG:remoteSlug};
    const redact=value=>{let text=String(value??'');for(const secret of secretValues)if(secret&&secret.length>=6)text=text.split(secret).join('[REDACTED]');return text;};
    const safe=value=>JSON.parse(redact(stringify(value)));
    let customEnvName=null;if(options.apiKey){customEnvName='SYSPILOT_CODEX_KEY_'+randomUUID().replaceAll('-','').toUpperCase();env[customEnvName]=String(options.apiKey);secretValues.push(String(options.apiKey));}
    // These per-process overrides isolate unrelated host integrations, while keeping
    // the native programming tools enabled. No config file or credential file is read here.
    const args=['app-server','--stdio','--disable','apps','--disable','plugins','--disable','hooks','--disable','multi_agent','-c','mcp_servers={}','-c','apps._default.enabled=false','-c','approvals_reviewer="user"'];
    const control=new AbortController(),signal=control.signal,pending=new Map(),messages=new Map(),items=new Map(),toolControllers=new Set(),stdoutDecoder=new StringDecoder('utf8'),stderrDecoder=new StringDecoder('utf8');
    let child,buffer='',stderr='',seq=0,sessionId=options.sessionId||null,turnId=null,turnRequestSent=false,actualModel=null,settled=false,closing=false,cancelled=false,usage,lastFailure,resolveCompletion,rejectCompletion,resolveReady,rejectReady,toolQueue=Promise.resolve(),killTimer;
    const completion=new Promise((resolve,reject)=>{resolveCompletion=resolve;rejectCompletion=reject;});
    const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});ready.catch(()=>{});
    const emit=(type,message,data={})=>{if(!settled)options.onEvent?.({type,message:redact(message),data:safe({runtime:'codex-app-server',...data})});};
    function send(message){if(closing||!child?.stdin?.writable)return false;try{child.stdin.write(JSON.stringify(message)+'\n');return true;}catch(e){finish(e);return false;}}
    function request(method,params,timeoutMs=requestTimeoutMs){if(settled)return Promise.reject(new Error('Codex transport is closed'));return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Codex app-server timed out: ${method}`));},timeoutMs);timer.unref?.();pending.set(id,{resolve,reject,timer,method});if(!send({id,method,params})){clearTimeout(timer);pending.delete(id);reject(new Error('Codex transport is not writable'));}});}
    function reply(id,result){send({id,result});}
    function rpcError(id,message){send({id,error:{code:-32601,message:redact(message)}});}
    function setSession(id,metadata={}){if(typeof id!=='string'||!id)return;const model=typeof metadata.model==='string'&&metadata.model?metadata.model:null;if(sessionId!==id||!setSession.notified||model&&model!==actualModel){sessionId=id;setSession.notified=true;if(model)actualModel=model;options.onSession?.(id,...(model?[{model}]:[]));}}
    function finish(error,result){
      if(settled)return;settled=true;closing=true;clearTimeout(killTimer);options.signal?.removeEventListener('abort',externalAbort);control.abort();
      for(const p of pending.values()){clearTimeout(p.timer);p.reject(error||new Error('Codex turn finished'));}pending.clear();rejectReady(error||new Error('Codex turn finished'));
      handles.delete(handle);try{child?.stdin?.end();}catch{}const shutdown=setTimeout(()=>{try{child?.kill('SIGTERM');}catch{}},1000);shutdown.unref?.();child?.once?.('close',()=>clearTimeout(shutdown));
      if(error){error.message=redact(error.message);error.sessionId=sessionId;rejectCompletion(error);}else resolveCompletion(result);
    }
    function publicMessage(item,partial){
      const previous=messages.get(item.id)||{id:item.id,text:'',phase:null,done:false};
      const next={...previous,text:typeof item.text==='string'?item.text:previous.text,phase:item.phase??previous.phase,done:!partial};
      if(previous.done&&!partial&&previous.text===next.text&&previous.phase===next.phase)return;
      messages.set(item.id,next);options.onMessage?.(safe({id:item.id,text:next.text,phase:next.phase,partial}));
    }
    function toolRecord(item,ended){
      const native=item.type!=='dynamicToolCall',tool=item.type==='commandExecution'?'codex.commandExecution':item.type==='fileChange'?'codex.fileChange':item.type==='dynamicToolCall'?item.tool:`codex.${item.type}`;
      const args=item.type==='commandExecution'?{command:item.command,cwd:item.cwd}:item.type==='fileChange'?{changes:item.changes}:item.type==='dynamicToolCall'||item.type==='mcpToolCall'?{...(item.arguments&&typeof item.arguments==='object'?item.arguments:{arguments:item.arguments}),...(item.namespace?{namespace:item.namespace}:{})}:item.type==='webSearch'?{query:item.query,action:item.action}:{path:item.path};
      let result;if(ended){if(item.type==='commandExecution')result={code:item.exitCode??null,stdout:item.aggregatedOutput||'',status:item.status,durationMs:item.durationMs??null,...(item.status==='declined'?{error:'Command declined'}:{})};else if(item.type==='dynamicToolCall')result=publicOutput(item);else if(item.type==='fileChange')result={changes:item.changes,status:item.status,...(['failed','declined'].includes(item.status)?{error:`File change ${item.status}`}:{})};else if(item.type==='mcpToolCall')result={result:item.result,error:item.error,status:item.status};else result={query:item.query,results:item.results,status:item.status||'completed'};}
      emit(ended?'tool.completed':'tool.started',tool,{native,itemId:item.id,tool,args,...(ended?{result}:{}),nativeStatus:item.status||null});
    }
    function validScope(params){return Boolean(turnRequestSent&&turnId)&&(!params.threadId||params.threadId===sessionId)&&params.turnId===turnId;}
    async function nativeApproval(id,method,params){
      if(!validScope(params)){reply(id,{decision:'decline'});emit('runtime.approval.denied','Native approval did not match the active thread/turn',{method});return;}
      const item=items.get(params.itemId),isFile=method==='item/fileChange/requestApproval';
      const outside=isFile?(!item?.changes?.length||item.changes.some(c=>!inWorkspace(nativeWorkspace,c.path))||(params.grantRoot&&!inWorkspace(nativeWorkspace,params.grantRoot))):(params.cwd&&!inWorkspace(nativeWorkspace,params.cwd));
      const expanded=Boolean(params.networkApprovalContext)||Boolean(params.additionalPermissions&&Object.values(params.additionalPermissions).some(v=>v!==null&&v!==undefined));
      if(outside||expanded){reply(id,{decision:'decline'});emit('runtime.approval.denied',outside?'Native action outside the project was denied':'Native permission expansion was denied',{method,itemId:params.itemId});return;}
      const approved=await options.requestApproval?.({tool:isFile?'codex.fileChange':'codex.commandExecution',args:safe({...params,...(isFile?{changes:item.changes}:{}),native:true}),signal});
      reply(id,{decision:approved&&!signal.aborted?'accept':'decline'});
    }
    async function handleServerRequest(message){
      const {id,method,params={}}=message;
      if(method==='item/tool/call'){
        if(!validScope(params)||params.namespace&&params.namespace!==NAMESPACE||!allowedTools.has(params.tool)){reply(id,{success:false,contentItems:[{type:'inputText',text:'Unknown, stale or unauthorized Manta dynamic tool'}]});return;}
        const invocation=new AbortController(),invocationSignal=AbortSignal.any([signal,invocation.signal,...(options.signal?[options.signal]:[])]);toolControllers.add(invocation);
        const execute=()=>withToolAbort(()=>{if(typeof options.executeTool!=='function')throw new Error('Manta tool bridge is unavailable');return options.executeTool(params.tool,params.arguments,{signal:invocationSignal});},invocationSignal);
        const task=toolQueue.then(execute);toolQueue=task.catch(()=>{});
        try{const output=await withToolAbort(()=>task,invocationSignal);if(!signal.aborted&&!settled&&!cancelled)reply(id,nativeOutput(output));}
        catch(e){if(!signal.aborted&&!settled&&!cancelled)reply(id,{success:false,contentItems:[{type:'inputText',text:stringify({error:redact(e.message)})}]});}
        finally{toolControllers.delete(invocation);}return;
      }
      if(['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(method)){await nativeApproval(id,method,params);return;}
      if(method==='item/permissions/requestApproval'){reply(id,{permissions:{},scope:'turn'});emit('runtime.approval.denied','Additional native permissions are not granted by Manta',{method,itemId:params.itemId});return;}
      if(['item/tool/requestUserInput','tool/requestUserInput'].includes(method)){
        if(!validScope(params)){reply(id,{answers:{}});return;}
        const answers=await options.requestUserInput?.(params.questions||[]);reply(id,{answers:answers?.answers||answers||{}});return;
      }
      if(method==='mcpServer/elicitation/request'){reply(id,{action:'decline',content:null});emit('runtime.approval.denied','Unconfigured MCP elicitation was declined',{method});return;}
      rpcError(id,`Unsupported Codex server request: ${method}`);emit('runtime.unsupported-request',`Unsupported native request: ${method}`,{method});
      if(/approval|permission|auth|attestation/i.test(method))finish(new Error(`Codex requires unsupported native request ${method}; sign in/configure it through its supported client`));
    }
    function notification(method,p={}){
      if(settled||p.threadId&&p.threadId!==sessionId)return;
      if(method==='thread/started'){setSession(p.thread?.id);return;}
      if(method==='warning'||method==='configWarning'){emit('runtime.warning',p.message||p.summary||'Codex runtime warning',{});return;}
      if(method==='turn/started'){if(!turnRequestSent||!p.turn?.id||turnId&&turnId!==p.turn.id)return;turnId=p.turn.id;emit('runtime.turn.started','Codex native turn started',{sessionId,turnId});return;}
      // Resume and history injection may replay persisted notifications. They are
      // never new public replies: only this turn's item IDs can update the UI.
      const eventTurnId=p.turnId||p.turn?.id;if(!turnRequestSent||!turnId||eventTurnId&&eventTurnId!==turnId)return;
      if(!eventTurnId&&!['error'].includes(method))return;
      if(method.startsWith('item/reasoning/')||method.startsWith('codex/event/'))return;
      if(method==='thread/tokenUsage/updated'){usage=p.tokenUsage;return;}
      if(method==='item/agentMessage/delta'){const old=messages.get(p.itemId)||{id:p.itemId,text:'',phase:null};publicMessage({...old,text:old.text+(p.delta||'')},true);return;}
      if(method==='item/started'||method==='item/completed'){
        const item=p.item;if(!item?.id)return;items.set(item.id,item);
        if(item.type==='agentMessage'){if(method==='item/completed')publicMessage(item,false);else if(item.phase||item.text)publicMessage(item,true);}
        else if(TOOL_TYPES.has(item.type))toolRecord(item,method==='item/completed');
        else if(item.type==='contextCompaction')emit('runtime.context-compaction','Codex compacted native session context',{itemId:item.id});return;
      }
      if(method==='turn/completed'){
        const turn=p.turn||{};for(const item of turn.items||[])if(item.type==='agentMessage'&&item.id)publicMessage(item,false);
        if(turn.status==='interrupted'||cancelled){finish(abortError());return;}
        if(turn.status==='failed'){finish(new Error(turn.error?.message||lastFailure||'Codex native turn failed'));return;}
        if(turn.status!=='completed'){finish(new Error(`Unknown native turn completion status: ${turn.status}`));return;}
        const completed=[...messages.values()].filter(m=>m.done),final=completed.filter(m=>m.phase==='final_answer').at(-1)||completed.at(-1);
        emit('runtime.turn.completed','Codex native turn completed',{sessionId,turnId,status:turn.status});finish(null,{sessionId,content:final?.text||'',...(actualModel?{model:actualModel}:{}),...(usage?{usage:safe(usage)}:{})});return;
      }
      if(method==='error'){lastFailure=redact(p.error?.message||p.message||'Native runtime error');emit('runtime.error',lastFailure,{code:p.error?.codexErrorInfo||null});return;}
      if(method==='warning'||method==='configWarning')emit('runtime.warning',p.message||p.summary||'Codex runtime warning',{});
    }
    function incoming(message){
      if(message.method&&Object.hasOwn(message,'id')){handleServerRequest(message).catch(error=>{rpcError(message.id,error.message);finish(error);});return;}
      if(Object.hasOwn(message,'id')){const waiter=pending.get(message.id);if(!waiter)return;pending.delete(message.id);clearTimeout(waiter.timer);if(message.error)waiter.reject(nativeRpcFailure(waiter.method,message.error));else waiter.resolve(message.result);return;}
      if(message.method)notification(message.method,message.params||{});
    }
    function cancel(){
      if(settled||cancelled)return Promise.resolve();cancelled=true;control.abort();
      const interrupted=ready.then(()=>request('turn/interrupt',{threadId:sessionId,turnId})).catch(()=>{});
      killTimer=setTimeout(()=>finish(abortError()),2500);killTimer.unref?.();return interrupted;
    }
    const externalAbort=()=>{void cancel();};
    const handle={completion,steer:async(text)=>{const next=inputItems(text);await ready;if(settled||cancelled)throw abortError();for(const invocation of toolControllers)invocation.abort();return request('turn/steer',{threadId:sessionId,expectedTurnId:turnId,input:next});},cancel};handles.add(handle);
    if(options.signal?.aborted){cancelled=true;queueMicrotask(()=>finish(abortError()));return handle;}
    options.signal?.addEventListener('abort',externalAbort,{once:true});
    (async()=>{
      try{
        child=spawnImpl(isolation?.file||codexPath,[...(isolation?.args||[]),...args],{cwd:workspace,env,stdio:['pipe','pipe','pipe'],windowsHide:true});
        child.stdin?.on?.('error',e=>{if(!closing)finish(new Error(`Codex stdin: ${e.message}`));});
        child.stdout.on('data',chunk=>{if(settled)return;buffer+=stdoutDecoder.write(chunk);if(buffer.length>32*1024*1024){finish(new Error('Codex protocol line exceeded 32 MB'));return;}let newline;while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(!line.trim())continue;try{incoming(JSON.parse(line));}catch(e){finish(new Error(`Invalid Codex app-server message: ${e.message}`));return;}}});
        child.stderr.on('data',chunk=>{stderr=(stderr+stderrDecoder.write(chunk)).slice(-16000);});
        child.once('error',e=>finish(new Error(`Could not start Codex app-server: ${e.message}`)));
        child.once('close',(code)=>{if(!settled)finish(cancelled?abortError():new Error(`Codex app-server closed (${code})${stderr?': '+redact(stderr.slice(-2000)):''}`));});
        await request('initialize',{clientInfo:{name:'syspilot',title:'Manta',version:'0.5.0'},capabilities:{experimentalApi:true,optOutNotificationMethods:REASONING_NOTIFICATIONS}});send({method:'initialized',params:{}});
        if(cancelled)throw abortError();
        const config={'features.apps':false,'features.plugins':false,'features.hooks':false,'features.multi_agent':false,'mcp_servers':{},'sandbox_workspace_write.network_access':false,'sandbox_workspace_write.exclude_tmpdir_env_var':true,'sandbox_workspace_write.exclude_slash_tmp':true,shell_environment_policy:{inherit:'none',experimental_use_profile:false,ignore_default_excludes:false,set:{PATH:env.PATH||'/usr/bin:/bin',LANG:env.LANG||'en_US.UTF-8',TMPDIR:env.TMPDIR||os.tmpdir()}}};
        const threadParams={cwd:nativeWorkspace,sandbox:permissionMode==='auto'?'workspace-write':'read-only',approvalPolicy:'on-request',approvalsReviewer:'user',developerInstructions:String(options.instructions||''),config,...(options.model?{model:options.model}:{})};
        if(baseUrl){threadParams.modelProvider='syspilot_runtime';config.model_providers={syspilot_runtime:{name:'Manta Responses endpoint',base_url:baseUrl,wire_api:'responses',requires_openai_auth:false,...(customEnvName?{env_key:customEnvName}:{})}};}
        if(sessionId){const resumed=await request('thread/resume',{...threadParams,threadId:sessionId,excludeTurns:true});setSession(resumed.thread?.id||sessionId,{model:resumed.model});}
        else{const started=await request('thread/start',{...threadParams,ephemeral:false,serviceName:'syspilot',dynamicTools:tools.length?[{type:'namespace',name:NAMESPACE,description:'Manta project coordination, engineering and computer tools',tools:tools.map(t=>({type:'function',name:t.name,description:t.description||'',inputSchema:t.parameters||{type:'object',properties:{}}}))}]:[]});setSession(started.thread?.id,{model:started.model});if(!sessionId)throw new Error('Codex thread/start returned no session identifier');const history=oldHistory(options.history);if(history.length)await request('thread/inject_items',{threadId:sessionId,items:history});}
        if(cancelled)throw abortError();
        const sandboxPolicy=permissionMode==='auto'?{type:'workspaceWrite',writableRoots:[nativeWorkspace],networkAccess:false,excludeSlashTmp:true,excludeTmpdirEnvVar:true}:{type:'readOnly',networkAccess:false};
        // A remote guest can need extra time to initialize a native turn under VM contention.
        // Keep this bounded and leave local app-server request deadlines unchanged.
        const turnStartTimeoutMs=remoteWorkspace?Math.max(requestTimeoutMs,90000):requestTimeoutMs;
        turnRequestSent=true;const result=await request('turn/start',{threadId:sessionId,input,cwd:nativeWorkspace,approvalPolicy:'on-request',approvalsReviewer:'user',sandboxPolicy,...(options.model?{model:options.model}:{})},turnStartTimeoutMs);turnId=result.turn?.id||turnId;if(!turnId)throw new Error('Codex turn/start returned no turn identifier');resolveReady({sessionId,turnId});
        if(cancelled)await request('turn/interrupt',{threadId:sessionId,turnId});
      }catch(error){finish(cancelled?abortError():error);}
    })();
    return handle;
  }
  return {startTurn,async close(){const current=[...handles];await Promise.allSettled(current.map(h=>h.cancel()));await Promise.allSettled(current.map(h=>h.completion));}};
}
