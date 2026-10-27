import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const SDK_PACKAGE='@anthropic-ai/claude-agent-sdk';
const APP_SERVER='syspilot';
const DENIED_TOOLS=new Set(['Agent','Task']);
// The current guest shares the VM network to reach the configured model API.
// Until that network has an OS-enforced egress policy, these native tools could
// bypass Manta's project-scoped public-source allowlist.
const REMOTE_DENIED_TOOLS=new Set(['Bash','WebFetch','WebSearch']);
const REMOTE_ALLOWED_NATIVE_TOOLS=new Set(['Read','Write','Edit','MultiEdit','Glob','Grep','LS','NotebookRead','NotebookEdit','TodoRead','TodoWrite','TaskCreate','TaskUpdate','TaskGet','TaskList','AskUserQuestion']);
const READ_TOOLS=new Set(['Read','Glob','Grep','LS','WebFetch','WebSearch','TodoRead','TaskGet','TaskList']);
const INTERNAL_TOOLS=new Set(['TodoWrite','TaskCreate','TaskUpdate']);
const ENV_ALLOW=new Set(['PATH','HOME','USER','LOGNAME','SHELL','TMPDIR','TMP','TEMP','LANG','LC_ALL','LC_CTYPE','TERM','SystemRoot','WINDIR','COMSPEC','PATHEXT']);
const GUEST_WORKSPACE='/work';
const GUEST_HOME='/home/manta';
const GUEST_KEY_HELPER='/opt/claude/key-helper';
const GUEST_BASE_ENV_ALLOW=new Set(['PATH','HOME','USER','LOGNAME','TMPDIR','LANG','ANTHROPIC_BASE_URL','CLAUDE_CONFIG_DIR','CLAUDE_AGENT_SDK_CLIENT_APP','CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC']);
const GUEST_SDK_ENV_VALUES=Object.freeze({CLAUDE_AGENT_SDK_VERSION:'0.3.307',CLAUDE_CODE_ENTRYPOINT:'sdk-ts',CLAUDE_CODE_SDK_READS_SESSION_STATE:'1',CLAUDE_CODE_SDK_READS_STARTUP_MARKS:'1'});
const GUEST_HEADER_ENV_ALLOW=new Set(['ANTHROPIC_BASE_URL','CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC','CLAUDE_AGENT_SDK_CLIENT_APP',...Object.keys(GUEST_SDK_ENV_VALUES)]);
const MAX_REMOTE_HANDSHAKE_BYTES=4*1024*1024;

function cancelled(){return Object.assign(new Error('Claude Agent 运行已取消'),{name:'AbortError'});}
function checkAbort(signal){if(signal?.aborted)throw cancelled();}
function inFolder(root,file){return file===root||file.startsWith(root+path.sep);}
function checkedPath(root,value){
  if(typeof value!=='string'||!value||value.includes('\0'))throw new Error('原生文件工具需要有效工程路径');
  const resolved=path.resolve(root,value);
  let ancestor=resolved;
  while(true){try{fs.lstatSync(ancestor);break;}catch(error){if(error.code!=='ENOENT')throw error;const next=path.dirname(ancestor);if(next===ancestor)throw new Error('无法确认工程文件路径');ancestor=next;}}
  const canonical=path.resolve(fs.realpathSync(ancestor),path.relative(ancestor,resolved));
  if(!inFolder(root,canonical))throw new Error('原生文件工具路径或符号链接指向工程文件夹外');
  return canonical;
}
function mappedNativePath(value,guestWorkspace){
  if(!guestWorkspace)return value;
  if(value.split(/[\\/]/).some(segment=>segment.startsWith('~')||segment.startsWith('$'))||value.startsWith('file:'))throw new Error('隔离工程路径不能使用用户目录、环境变量或文件 URL');
  if(!path.isAbsolute(value))return value;
  if(value===guestWorkspace)return '.';
  if(!value.startsWith(guestWorkspace+'/'))throw new Error('原生文件工具路径必须位于隔离工程 /work 内');
  return '.'+value.slice(guestWorkspace.length);
}
function checkNativePaths(root,name,args,guestWorkspace){
  for(const key of ['file_path','notebook_path','path','cwd'])if(typeof args[key]==='string'&&args[key])checkedPath(root,mappedNativePath(args[key],guestWorkspace));
  if(name==='Glob'&&typeof args.pattern==='string'){
    if(args.pattern.split(/[\\/]/).includes('..'))throw new Error('文件匹配模式不能离开工程文件夹');
    const prefix=args.pattern.split(/[*?{\[]/,1)[0];if(prefix)checkedPath(root,mappedNativePath(prefix,guestWorkspace));
  }
}
function remoteBinding(config,workspace){
  if(!config)return null;
  if(typeof config.hostRoot!=='string'||typeof config.transportPath!=='string'||!path.isAbsolute(config.hostRoot)||!path.isAbsolute(config.transportPath))throw new Error('Claude 隔离传输需要固定的绝对路径');
  if(fs.lstatSync(workspace).isSymbolicLink()||fs.lstatSync(config.hostRoot).isSymbolicLink())throw new Error('Claude 隔离传输不允许工程根或项目目录为符号链接');
  const root=fs.realpathSync(config.hostRoot),project=fs.realpathSync(workspace),slug=path.basename(project);
  if(project===root||path.dirname(project)!==root||!/^[A-Za-z0-9_-]{8,100}$/.test(slug))throw new Error('Claude 隔离传输仅允许独立共享根下的单个真实项目目录');
  const transport=path.resolve(config.transportPath),stat=fs.lstatSync(transport);
  if(stat.isSymbolicLink()||!stat.isFile()||fs.realpathSync(transport)!==transport)throw new Error('Claude 隔离传输必须是固定的普通文件');
  fs.accessSync(transport,fs.constants.X_OK);
  return {root,project,slug,transport};
}
function remoteSpawn(binding,spawnOptions,apiKey,expectedEnv,spawnImpl){
  if(spawnOptions.cwd!==GUEST_WORKSPACE||!Array.isArray(spawnOptions.args)||spawnOptions.args.some(arg=>typeof arg!=='string'||arg.includes('\0')))throw new Error('Claude SDK 请求了无效的隔离启动参数');
  if(spawnOptions.args.some(arg=>arg.includes(apiKey)))throw new Error('Claude SDK 启动参数包含所选凭据，已阻止隔离启动');
  const guestEnv={};for(const name of [...GUEST_BASE_ENV_ALLOW,...Object.keys(GUEST_SDK_ENV_VALUES)])if(typeof spawnOptions.env?.[name]==='string')guestEnv[name]=spawnOptions.env[name];
  for(const name of GUEST_BASE_ENV_ALLOW)if(guestEnv[name]!==expectedEnv[name])throw new Error('Claude SDK 修改了固定的隔离来宾环境');
  for(const [name,value] of Object.entries(GUEST_SDK_ENV_VALUES))if(guestEnv[name]!==undefined&&guestEnv[name]!==value)throw new Error('Claude SDK 请求了无效的内部来宾环境');
  if(guestEnv.HOME!==GUEST_HOME||guestEnv.CLAUDE_CONFIG_DIR!==GUEST_HOME+'/.claude'||guestEnv.TMPDIR!=='/tmp'||guestEnv.PATH!=='/usr/bin:/bin')throw new Error('Claude SDK 请求了无效的隔离来宾环境');
  // The guest owns HOME, PATH and config locations; only bounded non-secret
  // model/SDK markers cross the wire. It never receives host paths in env.
  const headerEnv={};for(const name of GUEST_HEADER_ENV_ALLOW)if(typeof guestEnv[name]==='string')headerEnv[name]=guestEnv[name];
  const handshake=JSON.stringify({args:spawnOptions.args,env:headerEnv})+'\n';
  if(handshake.includes(apiKey))throw new Error('Claude 隔离握手包含所选凭据，已阻止隔离启动');
  if(Buffer.byteLength(handshake)>MAX_REMOTE_HANDSHAKE_BYTES)throw new Error('Claude 隔离启动握手超过 4 MiB');
  const secret=Buffer.from(apiKey,'utf8');if(secret.length<1||secret.length>10000)throw new Error('Claude 隔离凭据长度无效');
  const secretLength=Buffer.alloc(4);secretLength.writeUInt32BE(secret.length);
  const child=spawnImpl(binding.transport,[],{cwd:binding.project,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'C.UTF-8',HOME:os.homedir(),MANTA_REMOTE_PROJECT_SLUG:binding.slug},stdio:['pipe','pipe','pipe'],signal:spawnOptions.signal,windowsHide:true});
  // A failed SSH/guest handshake can close stdin before these writes flush.
  // The child exit/error is surfaced to the SDK; consume the stream EPIPE so
  // it cannot become an uncaught process-wide exception in Manta.
  child.stdin.on?.('error',()=>{});
  // The SDK custom-process interface reads stdout, not stderr. Drain stderr
  // without forwarding raw guest diagnostics into project events or logs:
  // remote launchers and CLIs must never leak a credential through the UI.
  child.stderr?.resume?.();
  // The first line has no credential. A separate length-prefixed stdin frame
  // carries the key; the transport must not log it or pass it via argv/env.
  child.stdin.write(handshake);child.stdin.write(secretLength);child.stdin.write(secret);
  return child;
}
function redactor(options){
  const secrets=[options.apiKey,...(options.secretEnvNames||[]).map(k=>process.env[k])].filter(v=>typeof v==='string'&&v.length>3);
  const text=value=>secrets.reduce((s,secret)=>s.split(secret).join('[REDACTED]'),String(value??''));
  const value=input=>{if(typeof input==='string')return text(input);if(Array.isArray(input))return input.map(value);if(input&&typeof input==='object')return Object.fromEntries(Object.entries(input).map(([k,v])=>[k,value(v)]));return input;};
  return {text,value};
}
function privateConfigDirectory(value){
  if(typeof value!=='string'||!path.isAbsolute(value)||value===path.parse(value).root||value.includes('\0'))throw new Error('Claude 会话配置目录必须是明确的绝对目录');
  const target=path.resolve(value);let current=path.parse(target).root;
  for(const part of target.slice(current.length).split(path.sep).filter(Boolean)){
    current=path.join(current,part);let stat;try{stat=fs.lstatSync(current);}catch(error){if(error.code!=='ENOENT')throw error;fs.mkdirSync(current,{mode:0o700});stat=fs.lstatSync(current);}
    if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Claude 会话配置目录不能包含符号链接或非目录节点');
  }
  if(fs.realpathSync(target)!==target)throw new Error('Claude 会话配置目录解析异常');fs.chmodSync(target,0o700);return target;
}
function sdkEnvironment(options){
  const remote=Boolean(options.remoteWorkspace),env={};
  if(remote)Object.assign(env,{PATH:'/usr/bin:/bin',HOME:GUEST_HOME,USER:'manta',LOGNAME:'manta',TMPDIR:'/tmp',LANG:'C.UTF-8',CLAUDE_CONFIG_DIR:GUEST_HOME+'/.claude'});
  else{for(const name of ENV_ALLOW)if(typeof process.env[name]==='string'&&!options.secretEnvNames?.includes(name))env[name]=process.env[name];env.ANTHROPIC_API_KEY=options.apiKey;if(options.configDir)env.CLAUDE_CONFIG_DIR=privateConfigDirectory(options.configDir);}
  if(options.baseUrl){const url=new URL(options.baseUrl);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||remote&&(url.search||url.hash))throw new Error('Claude Agent Base URL 必须是无内嵌凭证的 HTTP(S) 地址；隔离环境不接受查询参数或片段');env.ANTHROPIC_BASE_URL=url.href.replace(/\/v1\/?$/,'').replace(/\/$/,'');}
  env.CLAUDE_AGENT_SDK_CLIENT_APP='syspilot/0.5';
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1';
  return env;
}
async function withAbort(operation,signal){
  checkAbort(signal);let abort;
  try{return await Promise.race([Promise.resolve().then(()=>typeof operation==='function'?operation():operation),new Promise((_,reject)=>{abort=()=>reject(cancelled());signal.addEventListener('abort',abort,{once:true});})]);}
  finally{signal.removeEventListener('abort',abort);}
}
function hookDecision(behavior,message){return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:behavior,permissionDecisionReason:message}};}
function questionAnswers(questions,answers){
  if(!answers||typeof answers!=='object')return null;
  const result={};for(const [index,q] of questions.entries()){
    const entry=answers[q.id||q.question||q.header||'question-'+(index+1)]??answers[q.question]??answers[q.header];
    const raw=entry&&typeof entry==='object'&&!Array.isArray(entry)?entry.answers:entry;
    const value=Array.isArray(raw)?raw.map(v=>String(v)).join(', '):typeof raw==='string'?raw:'';
    if(!value.trim())return null;result[q.question||q.header||'question-'+(index+1)]=value;
  }return result;
}
function mcpResult(result,redact){
  const {_image,images,...body}=result&&typeof result==='object'&&!Array.isArray(result)?result:{value:result};
  const content=[{type:'text',text:JSON.stringify(redact.value(body))??'null'}];
  for(const img of [_image,...(Array.isArray(images)?images:[])].filter(Boolean)){
    const mimeType=img.mediaType||img.mimeType;if(typeof img.data==='string'&&/^image\/(png|jpeg|webp|gif)$/.test(mimeType||''))content.push({type:'image',mimeType,data:img.data});
  }
  return {content,...(body?.error||body?.isError?{isError:true}:{})};
}
async function defaultSdkLoader(){
  try{return {...await import(SDK_PACKAGE),z:(await import('zod')).z};}
  catch(error){throw new Error('Claude Agent SDK 依赖不可用，请安装项目依赖：'+error.message);}
}

/** Native Claude Code execution. Steering interrupts and resumes the native session;
 * it is never represented as immediate delivery into an executing tool. */
export function createClaudeRuntime({sdkLoader=defaultSdkLoader,configDir:factoryConfigDir,remoteWorkspace=null,spawnImpl=spawn}={}){
  return {startTurn(options={}){
    const controller=new AbortController(),redact=redactor(options),pendingSteers=[],decisions=new Map(),texts=new Map();
    let activeQuery=null,queryToolsController=null,sessionId=options.sessionId||null,closed=false,interrupting=false,lastAssistantId=null,binding=null;
    const requestedPermissionMode=options.permissionMode==='auto'?'auto':'default';
    let effectivePermissionMode=null;
    const emit=async(type,message,data={})=>options.onEvent?.({type,message:redact.text(message),data:redact.value({...data,runtime:'claude-agent-sdk'})});
    const publish=async(id,text,partial,phase='progress')=>{if(text)await options.onMessage?.({id,text:redact.text(text),partial,phase});};
    const abort=()=>{controller.abort();try{activeQuery?.close?.();}catch{}};
    if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});
    function appTool(name,provenance){return name.startsWith('mcp__'+APP_SERVER+'__')&&options.tools?.some(t=>'mcp__'+APP_SERVER+'__'+t.name===name)&&(!provenance||provenance.source==='sdk'&&provenance.name===APP_SERVER);}
    function guardDecision(name,args={},provenance){
      if(DENIED_TOOLS.has(name))return {behavior:'deny',message:'独立任务必须通过 Manta start_thread 创建，以保持任务与会话可见。'};
      if(binding&&REMOTE_DENIED_TOOLS.has(name))return {behavior:'deny',message:'隔离 STF 环境暂不开放原生 shell/网络工具；请使用 Manta 已登记的项目工程工具和公开资料获取工具。'};
      if(appTool(name,provenance))return {behavior:'allow',updatedInput:args}; // executeTool retains application guards.
      if(name.startsWith('mcp__'))return {behavior:'deny',message:'仅允许当前应用注册的工程 MCP 工具。'};
      if(binding&&!REMOTE_ALLOWED_NATIVE_TOOLS.has(name))return {behavior:'deny',message:'隔离工程仅开放项目文件、任务记录和 Manta 已登记的工程工具。'};
      try{checkNativePaths(fs.realpathSync(options.workspace),name,args,binding?GUEST_WORKSPACE:null);}catch(error){return {behavior:'deny',message:error.message};}
      return null;
    }
    async function decide(name,args={},ctx={}){
      const signal=ctx.signal?AbortSignal.any([controller.signal,ctx.signal]):controller.signal;checkAbort(signal);
      const guard=guardDecision(name,args,ctx.mcpServer);if(guard)return guard;
      if(name==='AskUserQuestion'){
        const questions=args.questions;if(!Array.isArray(questions)||!questions.length)return {behavior:'deny',message:'问题格式无效'};
        const response=options.requestUserInput?await withAbort(options.requestUserInput(questions),signal):null;
        const answers=questionAnswers(questions,response);
        return answers?{behavior:'allow',updatedInput:{...args,answers}}:{behavior:'deny',message:'用户未回答或已取消问题。'};
      }
      // In Auto, this callback sees only calls the native policy could not resolve.
      // Do not grant them our old blanket read/write allowance: the SDK may have
      // fallen back to Manual, or an explicit native ask rule may require a user.
      if(requestedPermissionMode!=='auto'&&(READ_TOOLS.has(name)||INTERNAL_TOOLS.has(name)))return {behavior:'allow',updatedInput:args};
      const approved=options.requestApproval?await withAbort(options.requestApproval({tool:name,args,signal}),signal):false;
      return approved?{behavior:'allow',updatedInput:args}:{behavior:'deny',message:'用户未批准此原生工具操作。'};
    }
    const canUseTool=async(name,args,ctx={})=>{
      try{const saved=ctx.toolUseID&&decisions.get(ctx.toolUseID);return saved||await decide(name,args,ctx);}
      catch(error){return {behavior:'deny',message:redact.text(error.message)};}
    };
    const preTool=async(input,toolUseID,ctx={})=>{
      const name=input.tool_name,args=input.tool_input||{},id=toolUseID||input.tool_use_id;
      if(appTool(name,input.mcp_server))return hookDecision('allow','工程工具使用 Manta 执行层的权限检查');
      try{
        await emit('tool.started',name,{tool:name,args,callId:id,native:true});
        const guard=guardDecision(name,args,input.mcp_server);
        if(guard?.behavior==='deny'){
          if(id)decisions.set(id,guard);
          await emit('tool.completed',name,{tool:name,callId:id,native:true,result:{error:guard.message}});
          return hookDecision('deny',guard.message);
        }
        if(name==='AskUserQuestion')return {}; // SDK asks through canUseTool; never invent an answer.
        // A PreToolUse allow short-circuits the native Auto classifier. Keep our
        // mandatory guards above, then let Claude Code make the permission decision.
        if(requestedPermissionMode==='auto')return {};
        const decision=await decide(name,args,{...ctx,mcpServer:input.mcp_server});if(id)decisions.set(id,decision);
        if(decision.behavior==='deny')await emit('tool.completed',name,{tool:name,callId:id,native:true,result:{error:decision.message}});
        return hookDecision(decision.behavior,decision.message||'已应用本轮工程权限');
      }catch(error){return hookDecision('deny',redact.text(error.message));}
    };
    async function reportPermissionMode(message){
      const mode=typeof message.permissionMode==='string'?message.permissionMode:null;
      if(mode==='bypassPermissions')throw new Error('Claude 返回了未授权的 bypassPermissions 模式，已停止会话。');
      if(mode===effectivePermissionMode&&message.subtype!=='init')return;
      effectivePermissionMode=mode;
      const autoModeAvailable=requestedPermissionMode==='auto'&&mode==='auto';
      await emit('runtime.permission_mode',mode==='auto'?'Claude Auto 权限检查已启用':mode?'Claude 当前权限模式：'+mode:'Claude 未报告实际权限模式',{
        requestedPermissionMode,effectivePermissionMode:mode,autoModeAvailable
      });
      if(requestedPermissionMode==='auto'&&!autoModeAvailable)await emit('runtime.warning',mode
        ?'Claude 未启用 Auto，当前使用 '+mode+' 模式；未自动批准的操作将继续请求确认。请检查所选模型和服务是否支持 Auto。'
        :'Claude 未报告实际权限模式，无法确认 Auto 已启用；未自动批准的操作将继续请求确认。',{
          requestedPermissionMode,effectivePermissionMode:mode,autoModeAvailable:false
        });
    }
    const postTool=async(input,toolUseID)=>{
      const name=input.tool_name,id=toolUseID||input.tool_use_id;if(id)decisions.delete(id);
      if(appTool(name,input.mcp_server))return {};
      await emit('tool.completed',name,{tool:name,callId:id,native:true,result:input.hook_event_name==='PostToolUseFailure'?{error:input.error,cancelled:Boolean(input.is_interrupt)}:input.tool_response});return {};
    };
    const completion=(async()=>{
      try{
        checkAbort(controller.signal);
        if(typeof options.apiKey!=='string'||!options.apiKey.trim())throw new Error('Claude Agent 需要此连接的 Anthropic API Key；不会复用 claude.ai 登录或其他模型密钥。');
        if(typeof options.workspace!=='string'||!fs.statSync(options.workspace).isDirectory())throw new Error('Claude Agent 需要有效工程文件夹');
        if(typeof options.input!=='string'||!options.input.trim())throw new Error('Claude Agent 输入不能为空');
        binding=remoteBinding(remoteWorkspace,options.workspace);
        const env=sdkEnvironment({...options,remoteWorkspace:binding,configDir:options.configDir||factoryConfigDir}),sdk=await sdkLoader();checkAbort(controller.signal);
        if(typeof sdk.query!=='function'||typeof sdk.tool!=='function'||typeof sdk.createSdkMcpServer!=='function')throw new Error('Claude Agent SDK 缺少 query/tool/createSdkMcpServer 接口');
        const z=sdk.z||(await import('zod')).z;
        const definitions=(options.tools||[]).map(def=>{
          if(!/^[A-Za-z0-9_-]{1,64}$/.test(def.name))throw new Error('工程工具名称无效：'+def.name);
          const schema=z.fromJSONSchema(def.parameters||{type:'object',properties:{}});if(!schema.shape)throw new Error('工程工具参数必须是 JSON object schema：'+def.name);
          return sdk.tool(def.name,def.description||def.name,schema.shape,async(args,extra)=>{
            const signal=AbortSignal.any([controller.signal,...(queryToolsController?[queryToolsController.signal]:[]),...(extra?.signal?[extra.signal]:[])]);
            try{checkAbort(signal);if(typeof options.executeTool!=='function')throw new Error('工程工具执行器不可用');const output=await withAbort(()=>options.executeTool(def.name,schema.parse(args),{signal}),signal);checkAbort(signal);return mcpResult(output,redact);}
            catch(error){return {isError:true,content:[{type:'text',text:redact.text(error.message)}]};}
          },{alwaysLoad:true});
        });
        let prompt=options.input;
        if(!sessionId&&options.history?.length){const history=options.history.filter(m=>['user','assistant'].includes(m.role)&&typeof m.content==='string').map(m=>({role:m.role,content:m.content}));if(history.length)prompt='以下为迁移的公开对话历史，仅作上下文：\n'+JSON.stringify(history)+'\n\n本次用户消息：\n'+prompt;}
        let result=null,streamId=null;
        while(true){
          checkAbort(controller.signal);
          if(pendingSteers.length)prompt+='\n\n用户追加指导：\n'+pendingSteers.splice(0).join('\n\n');
          const sdkOptions={cwd:binding?GUEST_WORKSPACE:fs.realpathSync(options.workspace),env,model:options.model||undefined,...(Number.isInteger(options.maxTurns)&&options.maxTurns>0?{maxTurns:options.maxTurns}:{}),...(sessionId?{resume:sessionId}:{}),abortController:controller,includePartialMessages:true,
            tools:{type:'preset',preset:'claude_code'},disallowedTools:[...DENIED_TOOLS,...(binding?REMOTE_DENIED_TOOLS:[])],permissionMode:requestedPermissionMode,settingSources:[],
            ...(binding?{settings:{apiKeyHelper:GUEST_KEY_HELPER}}:{}),
            systemPrompt:{type:'preset',preset:'claude_code',append:options.instructions||'',snapshot:false},canUseTool,
            hooks:{PreToolUse:[{hooks:[preTool]}],PostToolUse:[{hooks:[postTool]}],PostToolUseFailure:[{hooks:[postTool]}]},
            ...(binding?{spawnClaudeCodeProcess:spawnOptions=>remoteSpawn(binding,spawnOptions,options.apiKey,env,spawnImpl)}:{}),
            ...(definitions.length?{mcpServers:{[APP_SERVER]:sdk.createSdkMcpServer({name:APP_SERVER,version:'1.0.0',tools:definitions})}}:{})};
          const input={type:'user',uuid:randomUUID(),message:{role:'user',content:prompt},parent_tool_use_id:null};
          queryToolsController=new AbortController();activeQuery=sdk.query({prompt:(async function*(){yield input;})(),options:sdkOptions});interrupting=false;result=null;
          try{
            for await(const message of activeQuery){
              checkAbort(controller.signal);
              if(message.session_id&&message.session_id!==sessionId){sessionId=message.session_id;await options.onSession?.(sessionId);await emit('runtime.session','Claude 原生会话已连接',{sessionId});}
              if(message.type==='system'&&(message.subtype==='init'||message.subtype==='status'&&Object.hasOwn(message,'permissionMode')))await reportPermissionMode(message);
              if(message.type==='stream_event'){
                const e=message.event;if(e?.type==='message_start'){streamId=e.message?.id||message.uuid; if(!texts.has(streamId))texts.set(streamId,new Map());}
                const blocks=texts.get(streamId);if(!blocks)continue;
                if(e.type==='content_block_start'&&e.content_block?.type==='text')blocks.set(e.index,e.content_block.text||'');
                else if(e.type==='content_block_delta'&&e.delta?.type==='text_delta')blocks.set(e.index,(blocks.get(e.index)||'')+e.delta.text);
                else continue;
                const text=[...blocks.entries()].sort(([a],[b])=>a-b).map(([,value])=>value).join('\n\n');lastAssistantId='claude:'+streamId;await publish(lastAssistantId,text,true);
              }else if(message.type==='assistant'){
                const pieces=(message.message?.content||[]).filter(b=>b.type==='text').map(b=>b.text);if(!pieces.length)continue;
                const id=message.message?.id||message.uuid||randomUUID(),blocks=texts.get(id)||new Map(),existing=[...blocks.values()].join('\n\n');const text=pieces.join('\n\n');
                if(!existing)blocks.set(0,text);else if(text!==existing&&![...blocks.values()].includes(text))blocks.set(blocks.size,text);
                texts.set(id,blocks);lastAssistantId='claude:'+id;await publish(lastAssistantId,[...blocks.values()].join('\n\n'),false);
              }else if(message.type==='result'){result=message;break;}
              else if(message.type==='system'&&message.subtype==='compact_boundary')await emit('runtime.compacted','Claude 原生会话完成上下文压缩',{sessionId,trigger:message.compact_metadata?.trigger});
            }
          }catch(error){if(!pendingSteers.length||controller.signal.aborted)throw error;await emit('runtime.steering.interrupted','原生执行已中断，将恢复会话处理追加指导',{sessionId});}
          finally{queryToolsController?.abort();queryToolsController=null;try{activeQuery?.close?.();}catch{}activeQuery=null;}
          checkAbort(controller.signal);
          if(pendingSteers.length){if(!sessionId)throw new Error('Claude 尚未建立可恢复会话，无法应用追加指导');prompt=pendingSteers.splice(0).join('\n\n');await emit('runtime.steering.applied','已通过原生会话恢复追加指导',{sessionId,delivery:'interrupt-and-resume'});continue;}
          if(!result)throw new Error('Claude 原生会话结束但未返回完成结果');
          if(result.subtype!=='success'||result.is_error)throw new Error(redact.text(result.errors?.join('\n')||result.result||'Claude Agent 执行失败：'+result.subtype));
          const content=redact.text(result.result||'');if(content)await publish(lastAssistantId||'claude:result:'+result.uuid,content,false,'final');
          return {sessionId,content,usage:{usage:result.usage,modelUsage:result.modelUsage,totalCostUsd:result.total_cost_usd,durationMs:result.duration_ms}};
        }
      }catch(error){
        const message=redact.text(error.message);
        throw controller.signal.aborted?cancelled():new Error(requestedPermissionMode==='auto'&&/auto.{0,30}(unavailable|not supported|unsupported|not available)|cannot set permission mode to auto/i.test(message)
          ?'Claude Auto 不可用，请检查所选模型和服务是否支持 Auto，或切换 Manual。原始错误：'+message:message);
      }
      finally{closed=true;options.signal?.removeEventListener('abort',abort);try{activeQuery?.close?.();}catch{}activeQuery=null;}
    })();
    return {completion,async steer(text){
      if(closed)throw new Error('Claude 本轮已结束，请开始新一轮消息');
      if(typeof text!=='string'||!text.trim())throw new Error('追加指导不能为空');checkAbort(controller.signal);pendingSteers.push(text);
      await emit('runtime.steering.queued','追加指导已排入原生中断与恢复队列',{sessionId,delivery:'interrupt-and-resume'});
      queryToolsController?.abort();
      if(activeQuery&&!interrupting){interrupting=true;try{await activeQuery.interrupt();}catch(error){if(closed)throw error;}}
      return {accepted:true,delivery:'interrupt-and-resume',sessionId};
    },cancel:abort};
  }};
}
