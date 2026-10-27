import fs from 'node:fs';
import {createRequire} from 'node:module';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import {id} from './store.mjs';
import {resolveCodexExecutable,CODEX_MISSING_MESSAGE} from './executable-paths.mjs';

export const CODEX_PATH=resolveCodexExecutable();
export const PROVIDER_TYPES=['demo','openai-compatible','openai-responses','anthropic','ollama','codex-app-server','claude-agent','codex-cli'];
const require=createRequire(import.meta.url);
const NATIVE=new Set(['codex-cli','codex-app-server','claude-agent']);
function executableAvailable(file){try{fs.accessSync(file,fs.constants.X_OK);return fs.statSync(file).isFile();}catch{return false;}}
function dependencyAvailable(name){try{require.resolve(name);return true;}catch{return false;}}
function endpoint(base,route){return `${base.replace(/\/+$/,'')}/${route}`;}
function parseArgs(value){if(value&&typeof value==='object')return value;try{return JSON.parse(value||'{}');}catch{throw new Error('Provider returned malformed tool arguments');}}
function callsChat(message){return (message.tool_calls||[]).map(c=>({id:c.id||id('call'),name:c.function.name,args:parseArgs(c.function.arguments)}));}
export function createProviderManager({store,fetchImpl=globalThis.fetch,codexPath=CODEX_PATH,nativeProbe,codexRequiresApiKey=false}) {
  const secrets=new Map();
  const key=p=>secrets.get(p.id)||(p.keyEnv?process.env[p.keyEnv]:'')||'';
  function redact(value){let out=String(value??'');for(const s of [...secrets.values(),...store.data.providers.map(key)])if(s&&s.length>=6)out=out.split(s).join('[REDACTED]');return out;}
  function sanitize(p){
    const native=NATIVE.has(p.type),codex=p.type==='codex-cli'||p.type==='codex-app-server';
    const available=codex?executableAvailable(codexPath):p.type==='claude-agent'?dependencyAvailable('@anthropic-ai/claude-agent-sdk'):true;
    return {id:p.id,name:p.name,type:p.type,baseUrl:p.baseUrl||'',model:p.model||'',keyEnv:p.keyEnv||'',configured:p.type==='demo'||(native?(available&&(codex?(!codexRequiresApiKey||!!key(p)):!!key(p))):p.type==='ollama'||!!key(p)),dependencyAvailable:available,runtime:native?(codex?'codex-app-server':'claude-agent-sdk'):'openai-agents-sdk',sdk:native?(codex?'Codex app-server protocol':'@anthropic-ai/claude-agent-sdk'):p.type==='anthropic'?'@anthropic-ai/sdk + @openai/agents':(p.type||'').startsWith('openai')?'openai + @openai/agents':'@openai/agents custom model',capabilities:{nativeSession:native,persistentSession:true,tokenStreaming:native,officialAgentLoop:true,authenticationVerified:false},...(p.type==='demo'?{notice:'Deterministic offline example. Not live AI.'}:codex&&!available?{notice:CODEX_MISSING_MESSAGE}:codex&&codexRequiresApiKey&&!key(p)?{notice:'This isolated Codex runtime needs a project-local Responses API key; the host Codex login is intentionally unavailable.'}:native?{notice:'Runtime dependency detection only; authentication and a real native turn must be tested separately.'}:{})};
  }
  function getConfig(providerId){const p=store.get('providers',providerId);if(!p)throw new Error('Provider not found');return {...structuredClone(p),apiKey:key(p),...(NATIVE.has(p.type)?{runtime:p.type==='claude-agent'?'claude-agent-sdk':'codex-app-server',codexPath}:{})};}

  function validateInput(input){if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Provider must be an object');for(const field of Object.keys(input))if(!['name','type','baseUrl','model','keyEnv','apiKey','clearApiKey'].includes(field))throw Error('Unknown provider field: '+field);for(const field of ['name','type','baseUrl','model','keyEnv'])if(Object.hasOwn(input,field)&&typeof input[field]!=='string')throw Error('Invalid provider field: '+field);if(input.model?.length>200)throw Error('Invalid model name');if(input.apiKey!==undefined&&typeof input.apiKey!=='string')throw Error('Invalid API key');if(input.clearApiKey!==undefined&&typeof input.clearApiKey!=='boolean')throw Error('clearApiKey must be boolean');if(input.clearApiKey&&input.apiKey)throw Error('Cannot set and clear an API key together');}
  function create(input) {
    validateInput(input);
    if(!PROVIDER_TYPES.includes(input.type)) throw new Error('Unsupported provider type');
    if(typeof input.name!=='string'||!input.name.trim()||input.name.length>120)throw new Error('Provider name is required (max 120 characters)');
    if(input.keyEnv && !/^[A-Za-z_][A-Za-z0-9_]{0,100}$/.test(input.keyEnv))throw new Error('Invalid environment variable name');
    let baseUrl=input.baseUrl||({ 'openai-compatible':'https://api.openai.com/v1','openai-responses':'https://api.openai.com/v1',anthropic:'https://api.anthropic.com/v1',ollama:'http://127.0.0.1:11434'}[input.type]||'');
    if(baseUrl){const u=new URL(baseUrl);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw new Error('Provider URL must be HTTP(S), without credentials, query or fragment');baseUrl=u.href.replace(/\/$/,'');}
    const p={id:id('provider'),name:input.name.trim(),type:input.type,baseUrl,model:String(input.model||'').slice(0,200),keyEnv:input.keyEnv||''};
    if(!['demo',...NATIVE].includes(p.type)&&!p.model)throw new Error('A model name is required');
    if(input.apiKey){if(typeof input.apiKey!=='string'||input.apiKey.length>10000)throw new Error('Invalid API key');secrets.set(p.id,input.apiKey);}
    store.add('providers',p);return sanitize(p);
  }
  function update(providerId,input){
    const previous=store.get('providers',providerId);if(!previous)throw Error('Provider not found');validateInput(input);
    const next={...previous};
    for(const field of ['name','type','baseUrl','model','keyEnv'])if(Object.hasOwn(input,field))next[field]=input[field];
    if(!PROVIDER_TYPES.includes(next.type))throw Error('Unsupported provider type');
    if(typeof next.name!=='string'||!next.name.trim()||next.name.length>120)throw Error('Provider name is required (max 120 characters)');next.name=next.name.trim();
    if(typeof next.model!=='string'||next.model.length>200)throw Error('Invalid model name');
    if(!['demo',...NATIVE].includes(next.type)&&!next.model)throw Error('A model name is required');
    if(typeof next.keyEnv!=='string'||(next.keyEnv&&!/^[A-Za-z_][A-Za-z0-9_]{0,100}$/.test(next.keyEnv)))throw Error('Invalid environment variable name');
    if(typeof next.baseUrl!=='string')throw Error('Invalid provider URL');
    if(next.baseUrl){const u=new URL(next.baseUrl);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('Provider URL must be HTTP(S), without credentials, query or fragment');next.baseUrl=u.href.replace(/\/$/,'');}
    if(input.apiKey&&input.apiKey.length>10000)throw Error('Invalid API key');
    if(input.clearApiKey)next.keyEnv='';
    store.patch('providers',providerId,next);
    if(input.clearApiKey)secrets.delete(providerId);else if(input.apiKey)secrets.set(providerId,input.apiKey);
    return sanitize(next);
  }
  async function post(p,route,body,{signal,headers={}}={}) {
    const timeout=AbortSignal.timeout(120000), merged=signal?AbortSignal.any([signal,timeout]):timeout;
    let res;
    try {res=await fetchImpl(endpoint(p.baseUrl,route),{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body),signal:merged});}
    catch(e){throw new Error(redact(e.name==='TimeoutError'?'Model request timed out':e.name==='AbortError'?'Cancelled':`Model connection failed: ${e.message}`));}
    let text='';if(res.body?.getReader){const reader=res.body.getReader();let bytes=0;const decoder=new TextDecoder();try{for(;;){const{done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2000000){await reader.cancel();throw new Error('Model response exceeded 2 MB');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}}else{text=await res.text();if(text.length>2000000)throw new Error('Model response exceeded 2 MB');}
    if(!res.ok){let message='';try{const err=JSON.parse(text);message=err.error?.message||err.error||err.message||'';}catch{}throw new Error(redact(`Provider HTTP ${res.status}${message?`: ${String(message).slice(0,400)}`:''}`));}
    try{return JSON.parse(text);}catch{throw new Error('Provider returned invalid JSON');}
  }
  async function requestComplete(providerId,{messages,tools=[],signal,workspace,onEvent,model,baseUrl,apiKey}={}) {
    const stored=store.get('providers',providerId);if(!stored)throw new Error('Provider not found');
    const p={...stored,...(model?{model}:{}),...(baseUrl?{baseUrl}:{})};const resolvedKey=apiKey||key(stored);
    if(p.type==='demo')return demo(messages);
    if(NATIVE.has(p.type))throw new Error('Native profiles require the Codex app-server or Claude Agent runtime; complete() never invokes exec JSON.');
    if(p.type!=='ollama'&&!resolvedKey)throw new Error(`Provider is not configured. Set ${p.keyEnv||'an API key in Settings'}.`);
    if(p.type==='openai-compatible') {
      const response=await new OpenAI({apiKey:resolvedKey,organization:null,project:null,baseURL:p.baseUrl,fetch:fetchImpl,maxRetries:0,timeout:120000}).chat.completions.create({model:p.model,messages:messages.flatMap(m=>[toChat(m),...(m.images?.length?[{role:'user',content:[{type:'text',text:'Actual screenshot returned by the preceding computer tool.'},...m.images.map(i=>({type:'image_url',image_url:{url:`data:${i.mediaType};base64,${i.data}`}}))]}]:[])]),...(tools.length?{tools:tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.parameters}})),tool_choice:'auto'}:{})},{signal});
      const message=response.choices?.[0]?.message;if(!message)throw new Error('Provider returned no assistant message');
      return {content:typeof message.content==='string'?redact(message.content):'',toolCalls:callsChat(message),...(response.usage?{usage:{inputTokens:response.usage.prompt_tokens,outputTokens:response.usage.completion_tokens,totalTokens:response.usage.total_tokens}}:{})};
    }
    if(p.type==='openai-responses') {
      const instructions=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
      const input=messages.filter(m=>m.role!=='system').flatMap(m=>{
        if(m.role==='tool')return [{type:'function_call_output',call_id:m.tool_call_id,output:m.content},...(m.images?.length?[{role:'user',content:[{type:'input_text',text:'Actual screenshot from the preceding computer tool.'},...m.images.map(i=>({type:'input_image',image_url:`data:${i.mediaType};base64,${i.data}`}))]}]:[])];
        if(m.role==='assistant'&&Array.isArray(m.responseItems))return m.responseItems;
        if(m.role==='assistant'&&m.tool_calls?.length)return [...(m.content?[{role:'assistant',content:m.content}]:[]),...m.tool_calls.map(c=>({type:'function_call',call_id:c.id,name:c.function.name,arguments:c.function.arguments}))];
        return [{role:m.role,content:m.content}];
      });
      const response=await new OpenAI({apiKey:resolvedKey,organization:null,project:null,baseURL:p.baseUrl,fetch:fetchImpl,maxRetries:0,timeout:120000}).responses.create({model:p.model,instructions,input,store:false,include:['reasoning.encrypted_content'],...(tools.length?{tools:tools.map(t=>({type:'function',name:t.name,description:t.description,parameters:t.parameters,strict:false}))}:{})},{signal});
      const output=response.output||[];
      return {content:redact(output.filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n')),toolCalls:output.filter(x=>x.type==='function_call').map(c=>({id:c.call_id||c.id,name:c.name,args:parseArgs(c.arguments)})),responseItems:output,...(response.usage?{usage:response.usage}:{})};
    }
    if(p.type==='anthropic') {
      const am=[];
      for(const m of messages.filter(m=>m.role!=='system')) {
        let role=m.role,content;
        if(role==='tool'){role='user';content=[{type:'tool_result',tool_use_id:m.tool_call_id,content:[{type:'text',text:m.content},...(m.images||[]).map(i=>({type:'image',source:{type:'base64',media_type:i.mediaType,data:i.data}}))]}];}
        else if(role==='assistant'){content=[...(m.content?[{type:'text',text:m.content}]:[]),...(m.tool_calls||[]).map(c=>({type:'tool_use',id:c.id,name:c.function.name,input:parseArgs(c.function.arguments)}))];}
        else content=[{type:'text',text:m.content}];
        const previous=am.at(-1);if(previous?.role===role)previous.content.push(...content);else am.push({role,content});
      }
      const response=await new Anthropic({apiKey:resolvedKey,openTelemetry:false,baseURL:p.baseUrl.replace(/\/v1\/?$/,''),fetch:fetchImpl,maxRetries:0,timeout:120000,defaultHeaders:{'anthropic-version':'2023-06-01','x-api-key':resolvedKey,authorization:null}}).messages.create({model:p.model,max_tokens:4096,system:messages.filter(m=>m.role==='system').map(m=>m.content).join('\n'),messages:am,...(tools.length?{tools:tools.map(t=>({name:t.name,description:t.description,input_schema:t.parameters}))}:{})},{signal});
      return {content:redact((response.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n')),toolCalls:(response.content||[]).filter(c=>c.type==='tool_use').map(c=>({id:c.id,name:c.name,args:c.input})),...(response.usage?{usage:{inputTokens:response.usage.input_tokens,outputTokens:response.usage.output_tokens,totalTokens:(response.usage.input_tokens||0)+(response.usage.output_tokens||0)}}:{})};
    }
    if(p.type==='ollama') {
      const response=await post(p,'api/chat',{model:p.model,stream:false,messages:messages.map(m=>({...toChat(m),...(m.images?.length?{images:m.images.map(i=>i.data)}:{})})),...(tools.length?{tools:tools.map(t=>({type:'function',function:t}))}:{})},{signal,headers:key(p)?{authorization:`Bearer ${key(p)}`}:{}});
      return {content:redact(response.message?.content||''),toolCalls:callsChat(response.message||{})};
    }
    throw new Error('Unsupported provider type');
  }
  async function complete(...args){try{return await requestComplete(...args);}catch(error){const safe=new Error(redact(error.message||'Provider request failed'));safe.name=error.name||'Error';if(Number.isInteger(error.status))safe.status=error.status;throw safe;}}
  async function test(providerId,options={}) {
    const p=store.get('providers',providerId);if(!p)throw new Error('Provider not found');
    if(p.type==='demo')return {ok:true,message:'离线确定性示例可用；这不是实时 AI 连接。'};
    if(NATIVE.has(p.type)){if(nativeProbe)return nativeProbe(getConfig(providerId),options);return {ok:false,dependencyAvailable:sanitize(p).dependencyAvailable,authenticationVerified:false,message:'Native runtime dependency detected; configure the runtime authentication probe to verify an actual session.'};}
    const response=await complete(providerId,{messages:[{role:'system',content:'Connection test. Return a brief greeting only. Do not call tools.'},{role:'user',content:'Reply with OK.'}],...options});
    return {ok:true,message:`连接成功 · ${p.type}${response.content?` · ${response.content.slice(0,120)}`:''}`};
  }
  return {create,update,sanitize,getConfig,list:()=>store.data.providers.map(sanitize),complete,test,redact,remove(providerId){secrets.delete(providerId);store.remove('providers',providerId);}};
}
function toChat(m){const result={role:m.role,content:m.content};if(m.tool_call_id)result.tool_call_id=m.tool_call_id;if(m.tool_calls)result.tool_calls=m.tool_calls;return result;}
function demo(messages) {
  const last=messages.at(-1);
  if(last?.role==='tool') return {content:'【离线确定性演示 · 非实时 AI】\n已执行项目工具，工具结果保存在活动记录中。模型中的假设与测试关系只用于演示；不构成真实工程验证。请切换本机 Codex 或 API 模型开展实际分析。',toolCalls:[]};
  return {content:'【离线确定性演示 · 非实时 AI】\n我将读取本项目的知识资料，以展示真实工具调用和事件记录。',toolCalls:[{id:id('call'),name:'search_knowledge',args:{query:''}}]};
}
