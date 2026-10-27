import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {StringDecoder} from 'node:string_decoder';
import {resolveCodexExecutable,CODEX_MISSING_MESSAGE} from './executable-paths.mjs';

const MAX_LINE_BYTES=2*1024*1024;
const MAX_PAGES=32;
const MAX_MODELS=2000;
const abortError=()=>Object.assign(new Error('Codex model discovery cancelled'),{name:'AbortError',code:'ABORT_ERR'});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function text(value,fallback='',max=1000){return typeof value==='string'?value.slice(0,max):fallback;}
function normalizeModel(row,redact){
  const clean=(value,fallback='',max=1000)=>redact(typeof value==='string'?value:fallback).slice(0,max);
  if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.id!=='string'||!row.id||row.id.length>200)throw new Error('Codex model/list returned an invalid model');
  if(row.supportedReasoningEfforts!==undefined&&!Array.isArray(row.supportedReasoningEfforts))throw new Error('Codex model/list returned invalid reasoning efforts');
  if(row.inputModalities!==undefined&&!Array.isArray(row.inputModalities))throw new Error('Codex model/list returned invalid input modalities');
  const efforts=(row.supportedReasoningEfforts||[]).map(entry=>{
    if(!entry||typeof entry.reasoningEffort!=='string'||!entry.reasoningEffort||entry.reasoningEffort.length>100)throw new Error('Codex model/list returned an invalid reasoning effort');
    return {reasoningEffort:redact(entry.reasoningEffort),description:clean(entry.description,'',1000)};
  });
  if((row.inputModalities||[]).some(value=>typeof value!=='string'||value.length>100))throw new Error('Codex model/list returned an invalid input modality');
  return {id:redact(row.id),model:clean(row.model,row.id,200),displayName:clean(row.displayName,typeof row.model==='string'?row.model:row.id,200),defaultReasoningEffort:clean(row.defaultReasoningEffort,'',100),supportedReasoningEfforts:efforts,inputModalities:[...new Set((row.inputModalities||[]).map(redact))],isDefault:row.isDefault===true};
}

/** Read the native catalog without creating a thread, generating tokens or writing config. */
export function createCodexModelCatalog({codexPath=resolveCodexExecutable(),spawnImpl=spawn,timeoutMs=15000}={}){
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new Error('Codex discovery timeout must be positive');
  return {async list(profile={},options={}){
    if(profile.baseUrl||profile.apiKey)return {models:[],source:profile.baseUrl?'custom-endpoint':'api-key',catalogOnly:true,configuredModel:text(profile.model,'',200),supportsDiscovery:false};
    const {workspace=process.cwd(),signal}=options;
    if(signal?.aborted)throw abortError();
    let cwd;try{cwd=fs.realpathSync(workspace);if(!fs.statSync(cwd).isDirectory())throw new Error();}catch{throw new Error('Codex model discovery requires an existing directory');}
    // Codex owns its normal local authentication. Do not forward other providers'
    // credentials or inspect any credential/config file in this catalog client.
    const secretNames=new Set(['OPENAI_API_KEY','ANTHROPIC_API_KEY','AZURE_OPENAI_API_KEY','GEMINI_API_KEY','GOOGLE_API_KEY',profile.keyEnv].filter(Boolean));
    const secrets=[profile.apiKey,...[...secretNames].map(name=>process.env[name])].filter(value=>typeof value==='string'&&value.length>=6);
    const redact=value=>{let result=String(value??'');for(const secret of secrets)result=result.split(secret).join('[REDACTED]');return result.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,'Bearer [REDACTED]');};
    const env={};for(const name of ['HOME','USERPROFILE','PATH','LANG','LC_ALL','LC_CTYPE','TMPDIR','TEMP','TMP','CODEX_HOME','SYSTEMROOT','WINDIR'])if(process.env[name]!==undefined&&!secretNames.has(name))env[name]=process.env[name];
    const args=['app-server','--stdio','--disable','apps','--disable','plugins','--disable','hooks','--disable','multi_agent','-c','mcp_servers={}','-c','apps._default.enabled=false','-c','approvals_reviewer="user"'];
    let child,closing=false,closed=false,buffer='',bytes=0,seq=0,timer,transportError;
    const pending=new Map(),decoder=new StringDecoder('utf8');
    let resolveClosed;const closedPromise=new Promise(resolve=>{resolveClosed=resolve;});
    function fail(error){if(closing||transportError)return;transportError=error;for(const waiter of pending.values())waiter.reject(error);pending.clear();}
    function send(message){if(closing||transportError||!child?.stdin?.writable)throw transportError||new Error('Codex model catalog transport is closed');child.stdin.write(JSON.stringify(message)+'\n');}
    function request(method,params){if(transportError)return Promise.reject(transportError);return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject,method});try{send({id,method,params});}catch(error){pending.delete(id);reject(error);}});}
    function incoming(message){
      if(!message||typeof message!=='object'||Array.isArray(message))throw new Error('Invalid Codex model catalog protocol message');
      if(typeof message.method==='string'&&Object.hasOwn(message,'id')){send({id:message.id,error:{code:-32601,message:'This catalog client cannot execute server requests'}});return;}
      if(!Object.hasOwn(message,'id'))return;
      const waiter=pending.get(message.id);if(!waiter)return;pending.delete(message.id);
      if(message.error){const error=new Error(`Codex ${waiter.method}: ${redact(typeof message.error.message==='string'?message.error.message:'Request failed').slice(0,1000)}`);error.rpcCode=message.error.code;waiter.reject(error);}
      else if(Object.hasOwn(message,'result'))waiter.resolve(message.result);
      else waiter.reject(new Error('Invalid Codex model catalog response'));
    }
    const onAbort=()=>fail(abortError());
    async function shutdown(){
      closing=true;clearTimeout(timer);signal?.removeEventListener('abort',onAbort);
      for(const waiter of pending.values())waiter.reject(new Error('Codex model discovery closed'));pending.clear();
      if(!child||closed)return;
      try{child.stdin?.end();}catch{}
      await Promise.race([closedPromise,delay(150)]);if(closed)return;
      try{child.kill('SIGTERM');}catch{}
      await Promise.race([closedPromise,delay(200)]);if(closed)return;
      try{child.kill('SIGKILL');}catch{}
      await Promise.race([closedPromise,delay(500)]);
    }
    try{
      const executable=profile.codexPath||codexPath;if(!executable)throw new Error(CODEX_MISSING_MESSAGE);
      child=spawnImpl(executable,args,{cwd,env,stdio:['pipe','pipe','pipe'],windowsHide:true});
      child.stdin?.on?.('error',error=>fail(new Error(`Codex model catalog stdin: ${redact(error.message)}`)));
      child.stdout.on('data',chunk=>{
        if(closing||transportError)return;
        bytes+=chunk.length;buffer+=decoder.write(chunk);
        if(bytes>16*1024*1024||Buffer.byteLength(buffer)>MAX_LINE_BYTES){fail(new Error('Codex model catalog exceeded protocol size limits'));return;}
        let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(!line.trim())continue;try{incoming(JSON.parse(line));}catch{fail(new Error('Invalid Codex model catalog protocol data'));return;}}
      });
      // Drain diagnostics without exposing arbitrary native stderr to the browser.
      child.stderr.on('data',()=>{});
      child.once('error',error=>fail(new Error(`Could not start Codex model catalog: ${redact(error.message)}`)));
      child.once('close',code=>{closed=true;resolveClosed();if(!closing)fail(new Error(`Codex model catalog closed (${code})`));});
      signal?.addEventListener('abort',onAbort,{once:true});
      timer=setTimeout(()=>fail(new Error('Codex model discovery timed out')),timeoutMs);
      if(signal?.aborted)throw abortError();
      await request('initialize',{clientInfo:{name:'syspilot',title:'Manta',version:'0.5.0'},capabilities:{experimentalApi:true}});
      send({method:'initialized',params:{}});
      let configuredModel='';
      try{const response=await request('config/read',{includeLayers:false,cwd});configuredModel=redact(typeof response?.config?.model==='string'?response.config.model:'').slice(0,200);}
      catch(error){if(error.rpcCode!==-32601)throw error;}
      const models=[],seenModels=new Set(),seenCursors=new Set();let cursor=null;
      for(let page=0;page<MAX_PAGES;page++){
        const result=await request('model/list',{includeHidden:false,...(cursor?{cursor}:{}),limit:100});
        if(!result||!Array.isArray(result.data)||!(result.nextCursor==null||typeof result.nextCursor==='string'))throw new Error('Codex model/list returned an invalid catalog page');
        for(const row of result.data){if(row?.hidden===true)continue;const model=normalizeModel(row,redact);if(seenModels.has(model.id))continue;seenModels.add(model.id);models.push(model);if(models.length>MAX_MODELS)throw new Error('Codex model catalog has too many models');}
        cursor=result.nextCursor;if(!cursor){const defaultModel=configuredModel||models.find(model=>model.isDefault)?.model;return {models,source:'codex-app-server',catalogOnly:true,configuredModel,defaultSource:configuredModel?'config':'catalog',...(defaultModel?{defaultModel}:{})};}
        if(cursor.length>8192||seenCursors.has(cursor))throw new Error('Codex model catalog returned a repeated or invalid cursor');seenCursors.add(cursor);
      }
      throw new Error('Codex model catalog exceeded pagination limit');
    }catch(error){const safe=new Error(redact(error?.message||'Codex model discovery failed'));safe.name=error?.name||'Error';if(error?.code==='ABORT_ERR')safe.code='ABORT_ERR';throw safe;}
    finally{await shutdown();}
  }};
}
