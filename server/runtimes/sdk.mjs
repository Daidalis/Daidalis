import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const copy=value=>structuredClone(value);
const textOf=content=>typeof content==='string'?content:!Array.isArray(content)?(content?.text||JSON.stringify(content??'')):(content||[]).filter(x=>['input_text','output_text','text'].includes(x.type)).map(x=>x.text||'').join('\n');
function imageOf(value){const image=typeof value==='string'?value:value?.image;const match=typeof image==='string'&&/^data:([^;]+);base64,([\s\S]+)$/.exec(image);return match?{mediaType:match[1],data:match[2]}:null;}
export function itemsToMessages(items,instructions=''){
  const messages=[{role:'system',content:instructions}];
  for(const item of typeof items==='string'?[{role:'user',content:items}]:items||[]){
    if(item.type==='function_call'){
      let previous=messages.at(-1);if(previous?.role!=='assistant'){previous={role:'assistant',content:'',tool_calls:[]};messages.push(previous);}
      (previous.tool_calls??=[]).push({id:item.callId,type:'function',function:{name:item.name,arguments:item.arguments}});
      if(item.providerData?.syspilotResponseItems)previous.responseItems=copy(item.providerData.syspilotResponseItems);
    }else if(item.type==='function_call_result'){
      const images=(Array.isArray(item.output)?item.output:[]).filter(x=>['image','input_image'].includes(x.type)).map(imageOf).filter(Boolean);
      messages.push({role:'tool',tool_call_id:item.callId,content:typeof item.output==='string'?item.output:textOf(item.output),...(images.length?{images}:{})});
    }else if(['user','assistant','system','developer'].includes(item.role)){
      const images=(Array.isArray(item.content)?item.content:[]).filter(x=>['image','input_image'].includes(x.type)).map(imageOf).filter(Boolean);
      const m={role:item.role==='developer'?'system':item.role,content:textOf(item.content),...(images.length?{images}:{})};
      if(item.providerData?.syspilotResponseItems)m.responseItems=copy(item.providerData.syspilotResponseItems);
      messages.push(m);
    }
  }
  return messages;
}
export function messagesToItems(messages=[]){
  return messages.flatMap(m=>{
    if(m.type==='function_call'||m.type==='function_call_result')return [copy(m)];
    if(m.role==='system')return [];
    if(m.role==='tool')return [{type:'function_call_result',name:m.name||'tool',callId:m.tool_call_id,status:'completed',output:m.images?.length?[{type:'input_text',text:m.content||''},...m.images.map(i=>({type:'input_image',image:`data:${i.mediaType};base64,${i.data}`}))]:m.content||''}];
    if(!['assistant','user'].includes(m.role))return [];
    const output=[];
    if(m.role==='assistant'){
      if(m.content||!m.tool_calls?.length)output.push({type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:String(m.content||'')}]});
      output.push(...(m.tool_calls||[]).map(c=>({type:'function_call',callId:c.id,name:c.function.name,arguments:c.function.arguments,status:'completed'})));
      if(m.responseItems&&output.length)output[0].providerData={syspilotResponseItems:copy(m.responseItems)};
    }else output.push({type:'message',role:'user',content:m.images?.length?[{type:'input_text',text:m.content||''},...m.images.map(i=>({type:'input_image',image:`data:${i.mediaType};base64,${i.data}`}))]:String(m.content||'')});
    return output;
  });
}
export class JsonSdkSession {
  constructor({directory,id,providerId,workspace,history=[],resume=false}){if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw Error('Invalid SDK session identifier');Object.assign(this,{directory,id,providerId,workspace,history,resume});this.items=[];this.queue=Promise.resolve();}
  async init(){await fs.mkdir(this.directory,{recursive:true,mode:0o700});this.file=path.join(this.directory,this.id+'.json');
    try{const stat=await fs.lstat(this.file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unsafe SDK session file');const saved=JSON.parse(await fs.readFile(this.file,'utf8'));if(saved.providerId!==this.providerId||saved.workspace!==this.workspace||!Array.isArray(saved.items))throw Error('SDK session belongs to a different provider or workspace');this.items=saved.items;}
    catch(error){if(error.code!=='ENOENT'||this.resume)throw error;this.items=messagesToItems(this.history);await this.persist(this.items);}return this;}
  async persist(items){const temp=path.join(this.directory,`.${this.id}-${randomUUID()}.tmp`);try{await fs.writeFile(temp,JSON.stringify({version:1,id:this.id,providerId:this.providerId,workspace:this.workspace,items}),{flag:'wx',mode:0o600});await fs.rename(temp,this.file);}finally{await fs.unlink(temp).catch(()=>{});}}
  async getSessionId(){return this.id;}
  async getItems(limit){await this.queue;const result=limit===undefined?this.items:limit<=0?[]:this.items.slice(-limit);return copy(result);}
  mutate(fn){const operation=this.queue.then(async()=>{const {items,result}=fn(copy(this.items));await this.persist(items);this.items=items;return result;});this.queue=operation.catch(()=>{});return operation;}
  async addItems(items){const values=copy(items);return this.mutate(old=>({items:[...old,...values]}));}
  async popItem(){return this.mutate(items=>({result:items.pop(),items}));}
  async clearSession(){return this.mutate(()=>({items:[]}));}
  async replaceItems(items){const values=copy(items);return this.mutate(()=>({items:values}));}
  preserveReasoningItemIdsForPersistence(){return true;}
}
function asToolOutput(value){if(value&&typeof value==='object'&&value._image){const {_image,...publicValue}=value;return [{type:'text',text:JSON.stringify(publicValue)}, {type:'image',image:{data:_image.data,mediaType:_image.mediaType}}];}return typeof value==='string'?value:JSON.stringify(value??null);}
async function withToolAbort(operation,signal){
  if(signal.aborted)throw Error('Cancelled');let abort;
  try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{abort=()=>reject(Error('Tool interrupted; incomplete execution is not success evidence'));signal.addEventListener('abort',abort,{once:true});})]);}
  finally{signal.removeEventListener('abort',abort);}
}
export function createSdkRuntime({providers,dataDir,loadAgents=()=>import('@openai/agents'),maxTurns=12}={}){
  if(!providers?.complete||!dataDir)throw Error('SDK runtime needs providers.complete and dataDir');
  const active=new Set();let modulePromise;
  return {kind:'agents-sdk',startTurn(options={}){
    const sessionId=options.sessionId||'sdk_'+randomUUID().replaceAll('-','');
    const controller=new AbortController(),signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
    const pending=[],toolControllers=new Set();let settled=false;
    const event=(type,message,data={})=>options.onEvent?.({type,message,data});
    const completion=(async()=>{
      if(active.has(sessionId))throw Error('SDK session already has an active turn');active.add(sessionId);
      try{
        const {Agent,Runner,tool,Usage,setTracingDisabled}=await(modulePromise??=loadAgents());setTracingDisabled?.(true);
        let workspace=options.workspace||'';if(workspace){try{workspace=fss.realpathSync(workspace);}catch{workspace=path.resolve(workspace);}}
        const session=await new JsonSdkSession({directory:path.join(dataDir,'sdk-sessions'),id:sessionId,providerId:options.providerId,workspace,history:options.history||[],resume:!!options.sessionId}).init();
        options.onSession?.(sessionId);
        const model={async getResponse(request){
          if(signal.aborted)throw Error('Cancelled');
          event('sdk.model.started','Official Runner requested a model response');
          const response=await providers.complete(options.providerId,{messages:itemsToMessages(request.input,request.systemInstructions||''),tools:request.tools.map(t=>({name:t.name,description:t.description,parameters:t.parameters})),signal:request.signal||signal,workspace:options.workspace,onEvent:options.onEvent,...(options.model?{model:options.model}:{}),...(options.baseUrl?{baseUrl:options.baseUrl}:{}),...(options.apiKey?{apiKey:options.apiKey}:{})});
          if(signal.aborted)throw Error('Cancelled');
          event('sdk.model.completed','Model response received');
          const output=[];if(response.content)output.push({id:'msg_'+randomUUID(),type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:response.content}]});
          output.push(...(response.toolCalls||[]).map(c=>({type:'function_call',callId:c.id||'call_'+randomUUID(),name:c.name,arguments:JSON.stringify(c.args||{}),status:'completed'})));
          if(response.responseItems?.length){if(!output.length)output.push({type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:''}]});output[0].providerData={syspilotResponseItems:copy(response.responseItems)};}
          if(response.content)options.onMessage?.({id:output[0].id,text:response.content,phase:response.toolCalls?.length?'commentary':'final',partial:false});
          return {usage:new Usage({requests:1,...response.usage}),output};
        },async *getStreamedResponse(request){/* Event streaming only: API calls are non-token-streaming. */const response=await this.getResponse(request);yield {type:'response_done',response:{...response,id:response.responseId||'sdk_response_'+randomUUID()}};}};
        const sdkTools=(options.tools||[]).map(t=>tool({name:t.name,description:t.description||'',parameters:t.parameters||{type:'object',properties:{}},strict:false,errorFunction:(_context,error)=>JSON.stringify({error:providers.redact?.(error.message)||error.message}),execute:async(args,_context,details)=>{const invocation=new AbortController(),toolSignal=AbortSignal.any([signal,invocation.signal,...(details?.signal?[details.signal]:[])]);toolControllers.add(invocation);try{return asToolOutput(await withToolAbort(()=>options.executeTool(t.name,args,{signal:toolSignal}),toolSignal));}finally{toolControllers.delete(invocation);}}}));
        const agent=new Agent({name:'Manta',instructions:options.instructions||'',model,tools:sdkTools});
        const runner=new Runner({tracingDisabled:true,traceIncludeSensitiveData:false,toolExecution:{maxFunctionToolConcurrency:1},toolNotFoundBehavior:'return_error_to_model',toolErrorFormatter:args=>{event('sdk.tool.rejected','Tool is not permitted for this agent role',{tool:args.toolName,callId:args.callId});return JSON.stringify({error:`Tool ${args.toolName} is not permitted for this agent role`});}});
        let input=options.input||'',result;
        // Each iteration is a new queued USER turn. All model/tool iterations belong to Runner.run.
        do{if(signal.aborted)throw Error('Cancelled');event('sdk.turn.started','Official Agents SDK turn started',{sessionId});result=await runner.run(agent,input,{session,signal,maxTurns:options.maxTurns||maxTurns,stream:true});
          try{for await(const _event of result){/* Official SDK owns all model/tool scheduling. */}await result.completed;}
          catch(error){const history=copy(result.state.history),completed=new Set(history.filter(i=>i.type==='function_call_result').map(i=>i.callId));for(const call of history.filter(i=>i.type==='function_call'&&!completed.has(i.callId)))history.push({type:'function_call_result',callId:call.callId,name:call.name,status:'incomplete',output:JSON.stringify({error:'Run interrupted before a tool result was recorded. Execution outcome is unknown; this is not success evidence.'})});await session.replaceItems(history);throw error;}
          if(signal.aborted)throw Error('Cancelled');const next=pending.shift();input=next?.input;if(next)event('sdk.steering.delivered','Queued user instruction delivered to the next official SDK turn',{sessionId,text:next.text});}while(input!==undefined);
        return {sessionId,content:typeof result.finalOutput==='string'?result.finalOutput:JSON.stringify(result.finalOutput??''),usage:result.rawResponses?.map(x=>x.usage)};
      }finally{settled=true;active.delete(sessionId);}
    })();
    return {completion,async steer(text){if(typeof text!=='string'||!text.trim())throw Error('Steering must be nonempty text');if(settled||signal.aborted)return {accepted:false,delivery:'not-running'};pending.push({text,input:text});for(const invocation of toolControllers)invocation.abort();event('sdk.steering.queued','User instruction queued for the next official SDK turn',{sessionId,text});return {accepted:true,delivery:'queued-next-turn'};},cancel(){controller.abort();}};
  }};
}
