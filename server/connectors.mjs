import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {safePath} from './sandbox.mjs';

const EFFECTS = new Set(['read', 'write', 'run']);
const PROJECT_ID = /^project_[a-f0-9-]+$/i;
const CONNECTOR_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const ENV_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const PRIVATE_ENV = /^MANTA_MCP_[A-Z0-9_]+$/;
const MANAGED_ENV = new Set(['HOME','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','LOGNAME','USER','USERNAME','PATH','SHELL','TERM','TMPDIR','TMP','TEMP','NODE_OPTIONS','NODE_PATH','LD_PRELOAD','DYLD_INSERT_LIBRARIES']);
const SECRET_NAME = /(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)/i;
const MAX_CONFIG_BYTES = 100_000;
const MAX_OUTPUT = 100_000;
const MAX_WIRE_BYTES = 4_000_000;

function plainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value) && [null,Object.prototype].includes(Object.getPrototypeOf(value)); }
function fail(message) { throw new Error(message); }
function text(value, label, maximum = 4096) { if(typeof value !== 'string' || !value.trim() || value.length > maximum || value.includes('\0'))fail(`Invalid ${label}`);return value.trim(); }
function checkSignal(signal) { if(signal?.aborted)fail('External MCP operation cancelled'); }
function awaitSignal(promise,signal) {
  checkSignal(signal);if(!signal)return promise;
  return new Promise((resolve,reject)=>{
    const abort=()=>{cleanup();reject(new Error('External MCP operation cancelled'));};
    const cleanup=()=>signal.removeEventListener('abort',abort);
    signal.addEventListener('abort',abort,{once:true});
    promise.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
  });
}
function requireUser(options) { if(options?.userInitiated !== true)fail('Connector configuration must be changed explicitly by the user'); }
function httpURL(value) {
  const url = new URL(text(value, 'MCP URL'));
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash)fail('MCP URL must be HTTP(S), without credentials or fragment');
  const host=url.hostname.replace(/^\[|\]$/g,'');
  if(url.protocol==='http:'&&!['127.0.0.1','::1','localhost'].includes(host))fail('Remote MCP endpoints require HTTPS; HTTP is allowed only for explicitly configured loopback endpoints');
  for(const key of url.searchParams.keys())if(SECRET_NAME.test(key)||/^auth/i.test(key))fail('Use a runtime key or accessTokenEnv, not credentials in the MCP URL');
  return url.href;
}
function normalizeConfig(input, existing) {
  if(!plainObject(input))fail('Connector configuration must be an object');
  const config={id:input.id===undefined?(existing?.id||`mcp_${randomUUID()}`):text(input.id,'connector identifier',80),name:text(input.name,'connector name',100),transport:input.transport,enabled:input.enabled===true,revision:randomUUID(),timeoutMs:Math.max(100,Math.min(300_000,Number(input.timeoutMs)||60_000)),toolPolicies:{}};
  if(!CONNECTOR_ID.test(config.id))fail('Invalid connector identifier');
  if(!['stdio','http'].includes(config.transport))fail('MCP transport must be stdio or http');
  if(input.toolPolicies!==undefined&&!plainObject(input.toolPolicies))fail('toolPolicies must be an object');
  for(const [name,effect]of Object.entries(input.toolPolicies||{})) {
    if(name.length>200||!name||!EFFECTS.has(effect))fail('Tool policies must map exact tool names to read, write or run');
    Object.defineProperty(config.toolPolicies,name,{value:effect,enumerable:true,configurable:true,writable:true});
  }
  if(config.transport==='http') {
    config.url=httpURL(input.url);
    if(input.accessTokenEnv) {
      config.accessTokenEnv=text(input.accessTokenEnv,'token environment reference',200);
      if(!PRIVATE_ENV.test(config.accessTokenEnv))fail('Credential references must use a dedicated MANTA_MCP_* environment variable');
    }
  } else {
    config.command=text(input.command,'MCP executable');
    if(!path.isAbsolute(config.command))fail('MCP executable must be an absolute path; Manta does not install servers');
    if(!Array.isArray(input.args||[])||(input.args||[]).length>100)fail('MCP args must be a bounded array');
    config.args=(input.args||[]).map(arg=>{
      if(typeof arg!=='string'||arg.length>16000||arg.includes('\0'))fail('Invalid MCP command argument');
      if(/^--?(?:api[-_]?key|token|password|secret|credential)(?:=|$)/i.test(arg))fail('Pass server credentials through envFrom instead of command arguments');
      return arg;
    });
    if(['npx','npm','yarn','pnpm','uvx','pip','pip3','brew'].includes(path.basename(config.command)))fail('Use an already installed MCP executable; automatic package installation is disabled');
    config.cwd=input.cwd===undefined?'.':text(input.cwd,'project-relative working directory');
    config.env={};config.envFrom={};
    for(const field of ['env','envFrom']) {
      if(input[field]!==undefined&&!plainObject(input[field]))fail(`${field} must be an object`);
      if(Object.keys(input[field]||{}).length>40)fail('Too many MCP environment variables');
      for(const [name,value]of Object.entries(input[field]||{})) {
        if(!ENV_NAME.test(name)||MANAGED_ENV.has(name)||typeof value!=='string'||value.length>16000||value.includes('\0'))fail(`Invalid or managed MCP environment variable: ${name}`);
        if(field==='envFrom'&&!PRIVATE_ENV.test(value))fail('Environment references must use dedicated MANTA_MCP_* names');
        if(field==='env'&&SECRET_NAME.test(name))fail('Store credential environment references in envFrom, not literal configuration');
        config[field][name]=value;
      }
    }
  }
  if(Buffer.byteLength(JSON.stringify(config))>MAX_CONFIG_BYTES)fail('Connector configuration is too large');
  return config;
}
function redactString(value, secrets) {
  let output=value;
  for(const secret of secrets)if(secret)output=output.split(secret).join('[REDACTED]');
  return output.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi,'Bearer [REDACTED]');
}
function bounded(value,secrets=[],maximum=MAX_OUTPUT) {
  const state={left:maximum,truncated:false};
  function visit(item,depth) {
    if(state.left<=0){state.truncated=true;return '[truncated]';}
    if(typeof item==='string') {
      const clean=redactString(item,secrets),limit=Math.min(state.left,32000);
      if(clean.length>limit)state.truncated=true;
      const result=clean.slice(0,limit);state.left-=result.length+8;return result;
    }
    if(item===null||typeof item==='boolean'||typeof item==='number') {state.left-=16;return item;}
    if(typeof item!=='object')return String(item);
    if(depth>12){state.truncated=true;return '[depth limit]';}
    if(Array.isArray(item)) {
      const result=[];
      for(const entry of item.slice(0,200)){if(state.left<=0)break;result.push(visit(entry,depth+1));}
      if(result.length<item.length)state.truncated=true;
      return result;
    }
    const result=Object.create(null),entries=Object.entries(item);
    for(const [key,entry]of entries.slice(0,200)) {
      if(state.left<=0)break;
      state.left-=key.length+8;
      // Binary screenshots/files are intentionally not copied into the model context.
      result[key]=key==='data'&&['image','audio'].includes(item.type)?'[binary content omitted]':visit(entry,depth+1);
    }
    if(entries.length>200)state.truncated=true;
    return result;
  }
  return {value:visit(value,0),truncated:state.truncated};
}
function publicConfig(config,status={}) {
  // Runtime keys and resolved environment values are never persisted or returned.
  return {...config,...status,hasRuntimeKey:!!status.hasRuntimeKey};
}

/** Project-scoped MCP connections. Configuration methods are for trusted UI routes,
 * never agent tools. Processes are explicit user-configured executables, not an OS
 * sandbox; remote isolated workers are preferred for engineering dependencies. */
export function createConnectorService({store,env=process.env,fetchImpl=globalThis.fetch,stdioTransportFactory=null}={}) {
  if(!store?.dataDir||typeof store.workspace!=='function')fail('Connector service requires a project store');
  const sessions=new Map(),connectionControllers=new Map(),runtimeKeys=new Map(),statuses=new Map();
  const configRoot=path.join(store.dataDir,'project-connectors');
  const keyFor=(projectId,connectorId)=>`${projectId}:${connectorId}`;
  function project(projectId) {
    if(!PROJECT_ID.test(projectId)||!store.get('projects',projectId))fail('Project not found');
    return store.workspace(projectId);
  }
  function configFile(projectId) { project(projectId);return safePath(store.dataDir,`project-connectors/${projectId}.json`); }
  function configs(projectId) {
    const file=configFile(projectId);if(!fs.existsSync(file))return [];
    if(fs.statSync(file).size>MAX_CONFIG_BYTES*30)fail('MCP configuration file is too large');
    const value=JSON.parse(fs.readFileSync(file,'utf8'));
    if(value.version!==1||!Array.isArray(value.connectors)||value.connectors.length>30)fail('Invalid project MCP configuration');
    return value.connectors;
  }
  function find(projectId,connectorId) {
    const config=configs(projectId).find(c=>c.id===connectorId);if(!config)fail('MCP connector not found');return config;
  }
  function persist(projectId,rows) {
    fs.mkdirSync(configRoot,{recursive:true,mode:0o700});
    const file=configFile(projectId),temporary=safePath(store.dataDir,`project-connectors/${projectId}.${randomUUID()}.tmp`);
    try{fs.writeFileSync(temporary,JSON.stringify({version:1,connectors:rows},null,2),{mode:0o600,flag:'wx'});fs.renameSync(temporary,file);}
    finally{try{fs.unlinkSync(temporary);}catch{}}
  }
  function metadata(projectId,config) {
    const key=keyFor(projectId,config.id);return publicConfig(config,{status:config.enabled?(statuses.get(key)?.status||'configured'):'disabled',...statuses.get(key),hasRuntimeKey:runtimeKeys.has(key)});
  }
  async function disconnect(projectId,connectorId) {
    const key=keyFor(projectId,connectorId),pending=sessions.get(key);sessions.delete(key);
    connectionControllers.get(key)?.abort();connectionControllers.delete(key);
    if(pending){const session=await pending.catch(()=>null);if(session){session.closed=true;await session.client.close().catch(()=>{});}}
  }
  function resolveSecrets(config,key) {
    const childEnv={},secrets=[];
    for(const [name,source]of Object.entries(config.envFrom||{})) {
      if(!PRIVATE_ENV.test(source))fail('Invalid dedicated MCP credential environment reference');
      const value=env[source];if(typeof value!=='string'||!value)fail(`Missing MCP environment variable: ${source}`);
      childEnv[name]=value;secrets.push(value);
    }
    const token=runtimeKeys.get(key)||(config.accessTokenEnv?env[config.accessTokenEnv]:undefined);
    if(config.accessTokenEnv&&!token)fail(`Missing MCP environment variable: ${config.accessTokenEnv}`);
    if(token)secrets.push(token);
    return {childEnv,secrets,token};
  }
  function lockedFetch(endpoint,token) {
    const origin=new URL(endpoint).origin;
    return async (input,init={})=>{
      const target=new URL(typeof input==='string'||input instanceof URL?input.href||input:input.url);
      if(target.origin!==origin)fail('MCP request changed origin');
      const headers=new Headers(init.headers);if(token)headers.set('Authorization',`Bearer ${token}`);
      const response=await fetchImpl(input,{...init,headers,redirect:'error'});
      if(response.status>=300&&response.status<400)fail('MCP redirects are disabled');
      if(!response.body)return response;
      let bytes=0;
      const stream=response.body.pipeThrough(new TransformStream({transform(chunk,controller){bytes+=chunk.byteLength;if(bytes>MAX_WIRE_BYTES){controller.error(new Error('MCP response exceeded wire size limit'));return;}controller.enqueue(chunk);}}));
      return new Response(stream,{status:response.status,statusText:response.statusText,headers:response.headers});
    };
  }
  async function connect(projectId,connectorId,{signal}={}) {
    checkSignal(signal);
    const config=find(projectId,connectorId),key=keyFor(projectId,connectorId);
    if(config.enabled!==true)fail('MCP connector is disabled; enable it in project settings first');
    if(sessions.has(key)){const cached=await awaitSignal(sessions.get(key),signal);checkSignal(signal);return cached;}
    const connectionController=new AbortController();connectionControllers.set(key,connectionController);
    const connectSignal=signal?AbortSignal.any([signal,connectionController.signal]):connectionController.signal;
    const pending=(async()=>{
      const workspace=project(projectId),{childEnv,secrets,token}=resolveSecrets(config,key),client=new Client({name:'manta-project-connector',version:'1.0.0'},{capabilities:{}});
      const session={client,config,secrets,closed:false,tools:[],stderr:''};
      try {
        let transport;
        if(config.transport==='stdio') {
          const cwd=safePath(workspace,config.cwd||'.');if(!fs.statSync(cwd).isDirectory())fail('MCP working directory is not a directory');
          if(!path.isAbsolute(config.command)||!fs.statSync(config.command).isFile())fail('Configured MCP executable is not an installed file');
          const runtimePath=safePath(store.dataDir,`connector-runtime/${projectId}/${connectorId}`);
          fs.mkdirSync(runtimePath,{recursive:true,mode:0o700});
          const home=safePath(store.dataDir,`connector-runtime/${projectId}/${connectorId}/home`),tmp=safePath(store.dataDir,`connector-runtime/${projectId}/${connectorId}/tmp`);
          fs.mkdirSync(home,{recursive:true,mode:0o700});fs.mkdirSync(tmp,{recursive:true,mode:0o700});
          const isolated={HOME:home,USERPROFILE:home,HOMEDRIVE:'',HOMEPATH:'',APPDATA:path.join(home,'AppData','Roaming'),LOCALAPPDATA:path.join(home,'AppData','Local'),LOGNAME:'',USER:'',USERNAME:'',PATH:`${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,SHELL:'/bin/sh',TERM:'dumb',TMPDIR:tmp,TMP:tmp,TEMP:tmp,LANG:'en_US.UTF-8',...config.env,...childEnv};
          // The SDK merges its default safe environment; override every default
          // identity/home field so no user-global MCP or tool configuration is read.
          const parameters={command:config.command,args:config.args,cwd,env:isolated,stderr:'pipe',maxBufferSize:MAX_WIRE_BYTES};
          transport=stdioTransportFactory?await stdioTransportFactory(parameters,{workspace}):new StdioClientTransport(parameters);
          transport.stderr?.on('data',chunk=>{if(session.stderr.length<8000)session.stderr+=redactString(chunk.toString(),secrets).slice(0,8000-session.stderr.length);});
        } else transport=new StreamableHTTPClientTransport(new URL(httpURL(config.url)),{requestInit:{redirect:'error'},fetch:lockedFetch(config.url,token),redirectPolicy:'same-origin',reconnectionOptions:{maxRetries:0}});
        client.onclose=()=>{session.closed=true;if(sessions.get(key)===pending){sessions.delete(key);connectionControllers.delete(key);}statuses.set(key,{status:'disconnected'});};
        client.onerror=()=>{};
        await client.connect(transport,{signal:connectSignal,timeout:config.timeoutMs});
        if(!client.getServerCapabilities()?.tools)fail('Configured MCP server does not advertise tools');
        let cursor,pages=0,catalogBytes=0;const seen=new Set();
        do {
          if(++pages>50)fail('MCP catalog pagination exceeds page limit');
          const page=await client.listTools(cursor?{cursor}:{},{signal:connectSignal,timeout:config.timeoutMs});
          for(const tool of page.tools) {
            if(!tool.name||tool.name.length>200||seen.has(tool.name))fail('Invalid or duplicate MCP tool name');
            const toolBytes=JSON.stringify(tool).length;catalogBytes+=toolBytes;
            if(session.tools.length>=500||toolBytes>64000||catalogBytes>500000)fail('MCP tool catalog exceeds size limits');
            seen.add(tool.name);session.tools.push(tool);
          }
          if(page.nextCursor===cursor&&cursor)fail('MCP catalog pagination did not advance');
          cursor=page.nextCursor;
        } while(cursor);
        statuses.set(key,{status:'connected',testedAt:new Date().toISOString(),toolCount:session.tools.length});
        return session;
      } catch(error) {
        session.closed=true;await client.close().catch(()=>{});
        statuses.set(key,{status:'error',error:redactString(String(error.message||error),secrets).slice(0,1000)});
        throw new Error(redactString(`MCP connection failed: ${error.message||error}`,secrets));
      }
    })();
    sessions.set(key,pending);
    try{return await pending;}catch(error){if(sessions.get(key)===pending){sessions.delete(key);connectionControllers.delete(key);}throw error;}
  }
  function describe(session,tool) {
    const configured=Object.hasOwn(session.config.toolPolicies||{},tool.name),effect=configured?session.config.toolPolicies[tool.name]:'write';
    return {...bounded(tool,session.secrets,70000).value,connectorId:session.config.id,connectorName:session.config.name,effect,policyConfigured:configured,requiresApproval:effect!=='read',untrusted:true};
  }
  const service={
    list(projectId){return configs(projectId).map(config=>metadata(projectId,config));},
    async save(projectId,input,options={}) {
      requireUser(options);project(projectId);const rows=configs(projectId),old=input?.id?rows.find(c=>c.id===input.id):undefined,config=normalizeConfig(input,old);
      if(!old&&rows.length>=30)fail('Maximum project MCP connector count reached');
      if(config.transport==='stdio')safePath(project(projectId),config.cwd);
      if(options.runtimeKey!==undefined&&options.runtimeKey!==null){if(config.transport!=='http')fail('Runtime access tokens are supported for HTTP connectors; use envFrom for stdio');if(typeof options.runtimeKey!=='string'||options.runtimeKey.length>16000||!options.runtimeKey.trim()||/[\r\n]/.test(options.runtimeKey))fail('Invalid MCP runtime key');}
      await disconnect(projectId,config.id);
      const key=keyFor(projectId,config.id);
      if(options.runtimeKey===null)runtimeKeys.delete(key);
      else if(options.runtimeKey!==undefined)runtimeKeys.set(key,options.runtimeKey);
      statuses.delete(key);const index=rows.findIndex(c=>c.id===config.id);if(index>=0)rows[index]=config;else rows.push(config);persist(projectId,rows);
      return metadata(projectId,config);
    },
    async remove(projectId,connectorId,options={}) {
      requireUser(options);const rows=configs(projectId);if(!rows.some(c=>c.id===connectorId))fail('MCP connector not found');
      await disconnect(projectId,connectorId);runtimeKeys.delete(keyFor(projectId,connectorId));statuses.delete(keyFor(projectId,connectorId));persist(projectId,rows.filter(c=>c.id!==connectorId));return {removed:true,id:connectorId};
    },
    async test(projectId,connectorId,options={}) {
      const session=await connect(projectId,connectorId,options);
      return {connector:metadata(projectId,session.config),server:bounded(session.client.getServerVersion(),session.secrets).value,capabilities:bounded(session.client.getServerCapabilities(),session.secrets).value,tools:session.tools.map(tool=>describe(session,tool))};
    },
    async tools(projectId,connectorId,options={}) {
      const chosen=connectorId?[find(projectId,connectorId)]:configs(projectId).filter(config=>config.enabled);
      const result=[];
      for(const config of chosen){const session=await connect(projectId,config.id,options);result.push(...session.tools.map(tool=>describe(session,tool)));}
      return result;
    },
    async describeTool(projectId,connectorId,toolName,options={}) {
      const session=await connect(projectId,connectorId,options),tool=session.tools.find(tool=>tool.name===toolName);if(!tool)fail('MCP tool not found in configured connector');return describe(session,tool);
    },
    async call(projectId,connectorId,toolName,args={},options={}) {
      checkSignal(options.signal);if(!plainObject(args)||JSON.stringify(args).length>MAX_CONFIG_BYTES)fail('MCP tool arguments must be a bounded object');
      const session=await connect(projectId,connectorId,options),tool=session.tools.find(tool=>tool.name===toolName);if(!tool)fail('MCP tool not found in configured connector');
      const info=describe(session,tool);
      if(info.requiresApproval&&options.approved!==true)fail('MCP tool requires approval through the current agent permission policy');
      try {
        const result=await session.client.callTool({name:toolName,arguments:args},undefined,{signal:options.signal,timeout:session.config.timeoutMs});
        const safe=bounded(result,session.secrets);
        return {connectorId,toolName,effect:info.effect,untrusted:true,result:safe.value,truncated:safe.truncated};
      } catch(error){
        // A cancelled/timed-out isolated process must not keep mutating the project.
        if(stdioTransportFactory&&session.config.transport==='stdio')await disconnect(projectId,connectorId);
        throw new Error(redactString(`MCP tool failed: ${error.message||error}`,session.secrets).slice(0,2000));
      }
    },
    async closeProject(projectId){project(projectId);for(const config of configs(projectId))await disconnect(projectId,config.id);},
    async close(){for(const key of [...sessions.keys()]){const split=key.indexOf(':');await disconnect(key.slice(0,split),key.slice(split+1));}runtimeKeys.clear();}
  };
  return service;
}
