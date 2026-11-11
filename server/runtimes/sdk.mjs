import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DEFAULT_EXECUTION_BUDGET} from '../../shared/execution-budget.mjs';

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
function interruptedHistory(items){
  const history=copy(items),completed=new Set(history.filter(i=>i.type==='function_call_result').map(i=>i.callId));
  for(const call of history.filter(i=>i.type==='function_call'&&!completed.has(i.callId)))history.push({type:'function_call_result',callId:call.callId,name:call.name,status:'incomplete',output:JSON.stringify({error:'Run interrupted before a tool result was recorded. Execution outcome is unknown; inspect actual project state before retrying. This is not success evidence.'})});
  return history;
}
export class JsonSdkSession {
  constructor({directory,id,providerId,workspace,history=[],resume=false}){if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw Error('Invalid SDK session identifier');Object.assign(this,{directory,id,providerId,workspace,history,resume});this.items=[];this.queue=Promise.resolve();this.revision=0;this.checkpointActive=false;}
  async read(file){
    try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unsafe SDK session file');const saved=JSON.parse(await fs.readFile(file,'utf8'));if(saved.providerId!==this.providerId||saved.workspace!==this.workspace||!Array.isArray(saved.items))throw Error('SDK session belongs to a different provider or workspace');return saved;}
    catch(error){if(error.code==='ENOENT')return null;throw error;}
  }
  async init(){
    await fs.mkdir(this.directory,{recursive:true,mode:0o700});this.file=path.join(this.directory,this.id+'.json');this.checkpointFile=path.join(this.directory,this.id+'.checkpoint.json');
    const primary=await this.read(this.file),checkpoint=await this.read(this.checkpointFile);
    this.revision=Math.max(primary?.revision||0,checkpoint?.revision||0);
    const saved=checkpoint&&(!primary||primary.pendingCheckpoint||(checkpoint.revision||0)>(primary.revision||0))?checkpoint:primary;
    if(!saved&&this.resume)throw Object.assign(Error('SDK session is unavailable: '+this.id),{code:'SDK_SESSION_NOT_FOUND'});
    this.items=saved?interruptedHistory(saved.items):messagesToItems(this.history);
    // Commit recovered progress before Runner imports it. The sidecar is separate
    // from Runner's append bookkeeping, so each tool can be durable mid-batch.
    await this.persist(this.items);await fs.unlink(this.checkpointFile).catch(error=>{if(error.code!=='ENOENT')throw error;});return this;
  }
  async persist(items,file=this.file,pendingCheckpoint=this.checkpointActive){const temp=path.join(this.directory,`.${this.id}-${randomUUID()}.tmp`);try{await fs.writeFile(temp,JSON.stringify({version:2,id:this.id,providerId:this.providerId,workspace:this.workspace,revision:++this.revision,...(file===this.file?{pendingCheckpoint}:{}),items}),{flag:'wx',mode:0o600});await fs.rename(temp,file);}finally{await fs.unlink(temp).catch(()=>{});}}
  enqueue(fn){const operation=this.queue.then(fn);this.queue=operation.catch(()=>{});return operation;}
  async checkpoint(items){const snapshot=copy(items);return this.enqueue(()=>{this.checkpointActive=true;return this.persist(snapshot,this.checkpointFile);});}
  async finish(items=this.items){const snapshot=copy(items);return this.enqueue(async()=>{await this.persist(snapshot,this.file,false);this.checkpointActive=false;this.items=snapshot;await fs.unlink(this.checkpointFile).catch(error=>{if(error.code!=='ENOENT')throw error;});});}
  async getSessionId(){return this.id;}
  async getItems(limit){await this.queue;const result=limit===undefined?this.items:limit<=0?[]:this.items.slice(-limit);return copy(result);}
  mutate(fn){return this.enqueue(async()=>{const {items,result}=fn(copy(this.items));await this.persist(items);this.items=items;return result;});}
  async addItems(items){const values=copy(items);return this.mutate(old=>({items:[...old,...values]}));}
  async popItem(){return this.mutate(items=>({result:items.pop(),items}));}
  async clearSession(){return this.mutate(()=>({items:[]}));}
  async replaceItems(items){const values=copy(items);return this.mutate(()=>({items:values}));}
  preserveReasoningItemIdsForPersistence(){return true;}
}
function checkpointOutput(value){if(value&&typeof value==='object'&&value._image){const {_image,...publicValue}=value;return [{type:'input_text',text:JSON.stringify(publicValue)},{type:'input_image',image:`data:${_image.mediaType};base64,${_image.data}`}];}return typeof value==='string'?value:JSON.stringify(value??null);}
function asToolOutput(value){if(value&&typeof value==='object'&&value._image){const {_image,...publicValue}=value;return [{type:'text',text:JSON.stringify(publicValue)}, {type:'image',image:{data:_image.data,mediaType:_image.mediaType}}];}return typeof value==='string'?value:JSON.stringify(value??null);}
async function withToolAbort(operation,signal){
  if(signal.aborted)throw Error('Cancelled');let abort;
  try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{abort=()=>reject(Error('Tool interrupted; incomplete execution is not success evidence'));signal.addEventListener('abort',abort,{once:true});})]);}
  finally{signal.removeEventListener('abort',abort);}
}
export function createSdkRuntime({providers,dataDir,loadAgents=()=>import('@openai/agents'),maxTurns=DEFAULT_EXECUTION_BUDGET.maxRunTurns}={}){
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
        const usageRecords=[];let checkpointItems=[],modelTurns=0;
        const turnBudget=options.maxTurns??maxTurns,continuationBudget=options.maxContinuations??0;
        if(!Number.isInteger(turnBudget)||turnBudget<1||!Number.isInteger(continuationBudget)||continuationBudget<0||continuationBudget>3)throw Error('Invalid SDK execution budget');
        const totalTurnBudget=turnBudget*(continuationBudget+1);
        const turnLimit=()=>Object.assign(Error(`Max turns (${totalTurnBudget}) exceeded across execution segments and queued steering`),{name:'MaxTurnsExceededError'});
        const saveTool=async(details,name,output)=>{const callId=details?.toolCall?.callId;if(!callId)throw Error('SDK tool invocation has no call identity');checkpointItems.push({type:'function_call_result',callId,name,status:'completed',output});await session.checkpoint(checkpointItems);};
        const model={async getResponse(request){
          if(signal.aborted)throw Error('Cancelled');
          checkpointItems=typeof request.input==='string'?messagesToItems([{role:'user',content:request.input}]):copy(request.input||[]);
          await session.checkpoint(checkpointItems);
          if(modelTurns>=totalTurnBudget)throw turnLimit();
          modelTurns++;
          event('sdk.model.started','Official Runner requested a model response',{modelTurns,totalTurnBudget});
          const response=await providers.complete(options.providerId,{messages:itemsToMessages(request.input,request.systemInstructions||''),tools:request.tools.map(t=>({name:t.name,description:t.description,parameters:t.parameters})),signal:request.signal||signal,workspace:options.workspace,onEvent:options.onEvent,...(options.model?{model:options.model}:{}),...(options.baseUrl?{baseUrl:options.baseUrl}:{}),...(options.apiKey?{apiKey:options.apiKey}:{})});
          if(signal.aborted)throw Error('Cancelled');
          event('sdk.model.completed','Model response received',{usage:response.usage||null});
          const output=[];if(response.content)output.push({id:'msg_'+randomUUID(),type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:response.content}]});
          output.push(...(response.toolCalls||[]).map(c=>({type:'function_call',callId:c.id||'call_'+randomUUID(),name:c.name,arguments:JSON.stringify(c.args||{}),status:'completed'})));
          if(response.responseItems?.length){if(!output.length)output.push({type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:''}]});output[0].providerData={syspilotResponseItems:copy(response.responseItems)};}
          checkpointItems.push(...copy(output));await session.checkpoint(checkpointItems);
          if(response.content)options.onMessage?.({id:output[0].id,text:response.content,phase:response.toolCalls?.length?'commentary':'final',partial:false});
          const usage=new Usage({requests:1,...response.usage});usageRecords.push(usage);
          return {usage,output};
        },async *getStreamedResponse(request){/* Event streaming only: API calls are non-token-streaming. */const response=await this.getResponse(request);yield {type:'response_done',response:{...response,id:response.responseId||'sdk_response_'+randomUUID()}};}};
        const sdkTools=(options.tools||[]).map(t=>tool({name:t.name,description:t.description||'',parameters:t.parameters||{type:'object',properties:{}},strict:false,errorFunction:(_context,error)=>JSON.stringify({error:providers.redact?.(error.message)||error.message}),execute:async(args,_context,details)=>{
          const invocation=new AbortController(),toolSignal=AbortSignal.any([signal,invocation.signal,...(details?.signal?[details.signal]:[])]);toolControllers.add(invocation);
          try{let value;try{value=await withToolAbort(()=>options.executeTool(t.name,args,{signal:toolSignal}),toolSignal);if(toolSignal.aborted)throw Error('Tool interrupted; execution outcome is unknown');}
            catch(error){await saveTool(details,t.name,JSON.stringify({error:providers.redact?.(error.message)||error.message}));throw error;}
            await saveTool(details,t.name,checkpointOutput(value));return asToolOutput(value);
          }finally{toolControllers.delete(invocation);}
        }}));
        const agent=new Agent({name:'Manta',instructions:options.instructions||'',model,tools:sdkTools});
        const runner=new Runner({tracingDisabled:true,traceIncludeSensitiveData:false,toolExecution:{maxFunctionToolConcurrency:1},toolNotFoundBehavior:'return_error_to_model',toolErrorFormatter:args=>{event('sdk.tool.rejected','Tool is not permitted for this agent role',{tool:args.toolName,callId:args.callId});return JSON.stringify({error:`Tool ${args.toolName} is not permitted for this agent role`});}});
        let input=options.input||'',result,continuations=0;
        // Runner owns each model/tool segment; budget continuations keep the
        // recorded history, and queued human instructions follow its completion.
        do{if(signal.aborted)throw Error('Cancelled');event('sdk.turn.started','Official Agents SDK turn started',{sessionId,maxTurns:turnBudget,continuations,continuationBudget});result=await runner.run(agent,input,{session,signal,maxTurns:turnBudget,stream:true});
          try{for await(const _event of result){/* Official SDK owns all model/tool scheduling. */}await result.completed;}
          catch(error){
            const history=copy(result.state.history),known=new Set(history.filter(i=>i.type==='function_call_result').map(i=>i.callId));
            // A batch may fail before Runner appends an already completed result.
            for(const item of checkpointItems.filter(i=>i.type==='function_call_result'&&!known.has(i.callId)))if(history.some(i=>i.type==='function_call'&&i.callId===item.callId))history.push(item);
            await session.finish(interruptedHistory(history));
            if(!signal.aborted&&(error.name==='MaxTurnsExceededError'||/Max turns \(\d+\) exceeded/.test(error.message))&&continuations<continuationBudget&&modelTurns<totalTurnBudget){
              continuations++;event('sdk.turn.continued','Execution segment budget reached; continuing the saved SDK session',{sessionId,maxTurns:turnBudget,continuations,continuationBudget});
              // Empty input resumes after the recorded tool outputs without
              // replaying the original user request or any completed tool.
              input=[];continue;
            }
            throw error;}
          await session.finish();
          if(signal.aborted)throw Error('Cancelled');const next=pending.shift();input=next?.input;if(next)event('sdk.steering.delivered','Queued user instruction delivered to the next official SDK turn',{sessionId,text:next.text});}while(input!==undefined);
        return {sessionId,content:typeof result.finalOutput==='string'?result.finalOutput:JSON.stringify(result.finalOutput??''),usage:usageRecords};
      }finally{settled=true;active.delete(sessionId);}
    })();
    return {completion,async steer(text){if(typeof text!=='string'||!text.trim())throw Error('Steering must be nonempty text');if(settled||signal.aborted)return {accepted:false,delivery:'not-running'};pending.push({text,input:text});for(const invocation of toolControllers)invocation.abort();event('sdk.steering.queued','User instruction queued for the next official SDK turn',{sessionId,text});return {accepted:true,delivery:'queued-next-turn'};},cancel(){controller.abort();}};
  }};
}
