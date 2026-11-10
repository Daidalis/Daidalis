import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {resolveExecutable} from './executable-paths.mjs';
import {spawnBounded,isPrivateAddress} from './sandbox.mjs';

export const AGENT_REACH_VERSION='1.6.1';
export const DEFAULT_SEARCH_TIMEOUT_MS=45000;
const INSTALL_HINT='运行 python3 scripts/install-agent-reach.py 安装项目独立依赖，或设置 MANTA_AGENT_REACH_BIN 指向受支持的 agent-reach。';
const failure=(code,message)=>Object.assign(new Error(message),{code});
const text=(value,limit)=>typeof value==='string'?value.slice(0,limit):'';

function resultUrl(value){
  if(typeof value!=='string'||value.length>4096)return null;
  try{
    const url=new URL(value),host=url.hostname.replace(/^\[|\]$/g,'').replace(/\.+$/,'');
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||host==='localhost'||host==='metadata.google.internal'||/\.(?:localhost|local|internal)$/.test(host)||net.isIP(host)&&isPrivateAddress(host))return null;
    return url.href;
  }catch{return null;}
}

function jsonOutput(result){
  try{const value=JSON.parse(result.stdout);if(value&&typeof value==='object'&&!Array.isArray(value)&&value.schema_version===1)return value;}catch{}
  throw failure('WEB_SEARCH_PROTOCOL','Agent Reach 返回了无法识别的结果；请检查安装版本。');
}

// Only public keyword search is exposed. No arbitrary channel, shell, install,
// login or browser command can be selected by a model/tool argument.
export function createWebSearchService({root=process.cwd(),dataDir,command=process.env.MANTA_AGENT_REACH_BIN,execute=spawnBounded,env=process.env,timeoutMs=Number(process.env.MANTA_SEARCH_TIMEOUT_MS||DEFAULT_SEARCH_TIMEOUT_MS)}={}){
  if(!dataDir)throw Error('Web search needs an application data directory');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)throw Error('MANTA_SEARCH_TIMEOUT_MS must be an integer from 1000 to 120000');
  const runtimeDirectory=path.resolve(dataDir,'agent-reach');
  let checkedExecutable,lastSearchAt=null,lastErrorCode=null;
  const executable=()=>command?resolveExecutable(command,{env}):resolveExecutable(path.join(root,'.local','agent-reach',process.platform==='win32'?'Scripts/agent-reach.exe':'bin/agent-reach'),{env})||resolveExecutable('agent-reach',{env});
  const catalog=()=>{const installed=Boolean(executable());return {provider:'agent-reach',version:AGENT_REACH_VERSION,installed,ready:installed&&Boolean(lastSearchAt)&&!lastErrorCode,status:!installed?'unavailable':lastErrorCode?'blocked':lastSearchAt?'ready':'configured',lastSearchAt,lastErrorCode};};
  async function search({query,limit=5}={}, {signal}={}){
    if(signal?.aborted)throw Error('Cancelled');
    if(typeof query!=='string'||!query.trim()||query.length>1000||query.includes('\0'))throw failure('WEB_SEARCH_BAD_INPUT','搜索关键词须为 1–1000 字符的非空文本。');
    if(!Number.isInteger(limit)||limit<1||limit>10)throw failure('WEB_SEARCH_BAD_INPUT','搜索结果数量须为 1–10 的整数。');
    query=query.trim();
    const binary=executable();
    if(!binary)throw failure('AGENT_REACH_UNAVAILABLE','网页搜索依赖尚未安装。'+INSTALL_HINT);
    const started=Date.now(),deadline=started+timeoutMs;
    // Do not pass model keys, project environment variables, or personal Reach
    // configuration to this public search subprocess. Retain configured egress.
    const allowed=['PATH','SystemRoot','SYSTEMROOT','WINDIR','PATHEXT','LANG','LC_ALL','TMPDIR','TEMP','TMP','SSL_CERT_FILE','SSL_CERT_DIR','REQUESTS_CA_BUNDLE','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'];
    const childEnv={...Object.fromEntries(allowed.filter(key=>env[key]!==undefined).map(key=>[key,env[key]])),HOME:runtimeDirectory,USERPROFILE:runtimeDirectory,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'};
    const run=(args,maxBytes=1000000)=>{
      const remaining=deadline-Date.now();
      if(remaining<=0)throw failure('WEB_SEARCH_TIMEOUT','网页搜索达到执行时限。');
      return execute(binary,args,{cwd:runtimeDirectory,env:childEnv,signal,timeoutMs:remaining,maxBytes});
    };
    try{
      await fs.mkdir(runtimeDirectory,{recursive:true,mode:0o700});
      if(checkedExecutable!==binary){
        const result=await run(['version'],64000),version=jsonOutput(result);
        if(result.code!==0||version.ok!==true||version.result?.version!==AGENT_REACH_VERSION)throw failure('AGENT_REACH_VERSION','网页搜索需要 Agent Reach '+AGENT_REACH_VERSION+'。'+INSTALL_HINT);
        checkedExecutable=binary;
      }
      const seconds=Math.max(0.1,(deadline-Date.now()-500)/1000);
      const result=await run(['web','search','--limit',String(limit),'--timeout',String(seconds),'--',query]);
      const output=jsonOutput(result);
      if(output.ok!==true){
        const code=['RATE_LIMITED','TIMEOUT','BAD_INPUT','NEED_SETUP','UPSTREAM_BROKEN'].includes(output.error?.code)?output.error.code:'UPSTREAM_BROKEN';
        const message=code==='RATE_LIMITED'?'网页搜索服务暂时限流；请稍后再试。':code==='TIMEOUT'?'网页搜索服务响应超时。':code==='NEED_SETUP'?'网页搜索依赖需要检查。'+INSTALL_HINT:'网页搜索服务暂时不可用（'+code+'）。';
        throw failure('WEB_SEARCH_'+code,message);
      }
      if(result.code!==0||output.channel!=='web'||output.action!=='search'||!Array.isArray(output.items))throw failure('WEB_SEARCH_PROTOCOL','Agent Reach 返回的搜索结果格式不正确。');
      const results=[];let omittedResults=0,truncated=output.items.length>limit;
      for(const item of output.items.slice(0,limit)){
        const url=resultUrl(item?.url);if(!url){omittedResults++;continue;}
        if((item.text?.length||0)>2500||(item.title?.length||0)>300)truncated=true;
        results.push({title:text(item.title,300),url,snippet:text(item.text,2500),publishedAt:text(item.published_at,80)||null,author:text(item.author,200)||null});
      }
      if(signal?.aborted)throw Error('Cancelled');
      if(Date.now()>=deadline)throw failure('WEB_SEARCH_TIMEOUT','网页搜索达到执行时限。');
      if(!results.length)throw failure('WEB_SEARCH_NO_PUBLIC_RESULTS','搜索回执未包含可用的公开网页链接，尚未获取资料；可调整关键词后重试。');
      lastSearchAt=new Date().toISOString();lastErrorCode=null;
      return {provider:'agent-reach',backend:text(output.backend,80),query,results,omittedResults,truncated,retrievedAt:lastSearchAt,durationMs:Date.now()-started,untrusted:true};
    }catch(error){
      if(signal?.aborted)throw Error('Cancelled');
      const code=typeof error?.code==='string'?error.code:'';
      if(!code.startsWith('WEB_SEARCH_')&&!code.startsWith('AGENT_REACH_'))error=failure(/timed out/i.test(error?.message)?'WEB_SEARCH_TIMEOUT':'WEB_SEARCH_PROCESS',/timed out/i.test(error?.message)?'网页搜索达到执行时限。':'网页搜索进程执行失败；请检查 Agent Reach 安装及网络。');
      lastErrorCode=error.code;throw error;
    }
  }
  return {search,catalog};
}
