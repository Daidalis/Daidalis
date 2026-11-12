import timers from 'node:timers/promises';
import {performance} from 'node:perf_hooks';

export const DEFAULT_REQUEST_POLICY=Object.freeze({requestTimeoutMs:300000,maxRetries:5});
export const REQUEST_POLICY_LIMITS=Object.freeze({requestTimeoutMs:[1000,1800000],maxRetries:[0,5]});
export const MODEL_RECOVERY_BUDGET_MS=300000;
const RETRY_DELAYS_MS=[5000,10000,20000,40000,60000];

export function requestPolicy(provider={}){
  return Object.fromEntries(Object.entries(DEFAULT_REQUEST_POLICY).map(([key,fallback])=>[key,provider[key]??fallback]));
}

export function validateRequestPolicy(input){
  for(const [key,[minimum,maximum]] of Object.entries(REQUEST_POLICY_LIMITS)){
    if(Object.hasOwn(input,key)&&(!Number.isInteger(input[key])||input[key]<minimum||input[key]>maximum))throw Error(`${key} must be an integer from ${minimum} to ${maximum}`);
  }
}

export function requestFailureKind(error){
  if(error.code==='MODEL_RECOVERY_TIMEOUT')return 'recovery-timeout';
  if(error.status===429){
    const details=[error,error.error,error.error?.error];
    const quotaCodes=new Set(['insufficient_quota','billing_hard_limit_reached','credit_balance_too_low']);
    if(details.some(value=>value&&[value.code,value.type].some(code=>quotaCodes.has(code)))
      ||/insufficient[_ ]quota|credit balance is too low|token[- ]plan quota[^\n]*exhausted/i.test(error.message||''))return 'request';
    return 'rate-limit';
  }
  if(error.status===408||error.status===409)return 'transient';
  if(error.status>=400&&error.status<500)return 'request';
  if(/timeout|timed out/i.test(`${error.name||''} ${error.message||''}`))return 'timeout';
  if(error.status>=500&&error.status<=599)return 'server';
  if(error.name==='APIConnectionError'||error.code==='MODEL_CONNECTION_FAILED')return 'network';
  return 'request';
}

function retryDelay(error,attempt){
  const header=name=>String(error.headers?.get?.(name)??error.headers?.[name]??'').trim();
  const milliseconds=header('retry-after-ms');
  if(/^\d+(?:\.\d+)?$/.test(milliseconds))return {delayMs:Number(milliseconds),serverDirected:true};
  const value=header('retry-after');
  if(/^\d+(?:\.\d+)?$/.test(value))return {delayMs:Number(value)*1000,serverDirected:true};
  // Date.parse also accepts negative numbers and partial dates. Only HTTP date
  // formats may supply a delay; malformed headers use exponential backoff.
  const httpDate=/^(?:[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]+, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]{3} [A-Za-z]{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4})$/;
  if(httpDate.test(value)){const date=Date.parse(value);if(Number.isFinite(date))return {delayMs:Math.max(0,date-Date.now()),serverDirected:true};}
  return {delayMs:RETRY_DELAYS_MS[Math.min(attempt-1,RETRY_DELAYS_MS.length-1)],serverDirected:false};
}

// Also bound adapters that fail to settle after their signal is aborted. The race
// observes late rejections, and the listener is removed on every exit path.
async function abortable(operation,signal){
  signal.throwIfAborted();
  let onAbort;
  try{
    return await Promise.race([
      Promise.resolve().then(()=>{signal.throwIfAborted();return operation(signal);}),
      new Promise((_,reject)=>{onAbort=()=>reject(signal.reason);signal.addEventListener('abort',onAbort,{once:true});}),
    ]);
  }finally{signal.removeEventListener('abort',onAbort);}
}

// Retry only the outstanding model request. Agent/tool scheduling stays outside
// this boundary, so previously completed tools are never replayed by a retry.
export async function withModelRequestPolicy(operation,{policy,signal,onEvent,providerId}={}){
  const {requestTimeoutMs,maxRetries}=policy;
  let recoveryDeadline,lastError,attempts=0;
  const recoveryError=reason=>{
    const error=Object.assign(Error(reason==='retry-after-exceeds-budget'?'Server retry delay exceeds the model recovery budget.':reason==='backoff-exceeds-budget'?'Next retry delay exceeds the remaining model recovery budget.':'Model API recovery budget exhausted.'),{
      name:'ModelRecoveryTimeoutError',code:'MODEL_RECOVERY_TIMEOUT',attempts,requestTimeoutMs,
      recoveryBudgetMs:MODEL_RECOVERY_BUDGET_MS,recoveryStopReason:reason,
      ...(Number.isInteger(lastError?.status)?{lastStatus:lastError.status}:{}),
    });
    onEvent?.({type:'model.request.recovery_exhausted',message:'模型连接恢复未完成，可在当前对话继续',data:{providerId,attempts,recoveryBudgetMs:MODEL_RECOVERY_BUDGET_MS,reason}});
    return error;
  };
  for(let attempt=1;attempt<=maxRetries+1;attempt++){
    signal?.throwIfAborted();
    const remainingMs=recoveryDeadline===undefined?null:recoveryDeadline-performance.now();
    if(remainingMs!==null&&remainingMs<=0)throw recoveryError('deadline');
    const attemptTimeoutMs=Math.max(1,Math.ceil(Math.min(requestTimeoutMs,remainingMs??requestTimeoutMs)));
    const recoveryLimited=remainingMs!==null&&remainingMs<=requestTimeoutMs;
    const started=performance.now(),data={providerId,attempt,maxAttempts:maxRetries+1,requestTimeoutMs,attemptTimeoutMs};
    onEvent?.({type:'model.request.started',message:'Model API request started',data});
    signal?.throwIfAborted();
    attempts=attempt;
    // SDK fetch timeouts can stop at response headers. Keep a caller deadline
    // active through response-body reading and parsing, capped by recovery time.
    const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(new DOMException('Model request timed out.','TimeoutError')),attemptTimeoutMs);
    timer.unref?.();
    const attemptSignal=signal?AbortSignal.any([signal,deadline.signal]):deadline.signal;
    try{
      const result=await abortable(operation,attemptSignal);attemptSignal.throwIfAborted();
      if(recoveryDeadline!==undefined&&performance.now()>=recoveryDeadline)throw Object.assign(Error('Model recovery deadline reached.'),{code:'MODEL_RECOVERY_TIMEOUT'});
      onEvent?.({type:'model.request.completed',message:'Model API response received',data:{...data,durationMs:Math.round(performance.now()-started)}});
      return result;
    }catch(error){
      clearTimeout(timer);
      if(signal?.aborted)throw Error('Cancelled');
      if(recoveryDeadline!==undefined&&(performance.now()>=recoveryDeadline||deadline.signal.aborted&&recoveryLimited))error=recoveryError('deadline');
      else if(deadline.signal.aborted)error=Object.assign(Error('Model request timed out.'),{name:'ModelRequestTimeoutError'});
      const category=requestFailureKind(error),retryable=!['request','recovery-timeout'].includes(category);
      onEvent?.({type:'model.request.failed',message:'Model API request failed',data:{...data,durationMs:Math.round(performance.now()-started),category,...(Number.isInteger(error.status)?{status:error.status}:{})}});
      if(category==='timeout')error.code='MODEL_REQUEST_TIMEOUT';
      error.attempts=attempt;error.requestTimeoutMs=requestTimeoutMs;
      if(!retryable||attempt>maxRetries)throw error;
      lastError=error;
      recoveryDeadline??=performance.now()+MODEL_RECOVERY_BUDGET_MS;
      const {delayMs,serverDirected}=retryDelay(error,attempt);
      const recoveryRemainingMs=Math.max(0,recoveryDeadline-performance.now());
      // Never shorten a server-mandated delay to squeeze in another request.
      if(delayMs>=recoveryRemainingMs)throw recoveryError(serverDirected?'retry-after-exceeds-budget':'backoff-exceeds-budget');
      onEvent?.({type:'model.request.retry',message:'连接暂时异常，正在重试',data:{...data,category,delayMs,recoveryBudgetMs:MODEL_RECOVERY_BUDGET_MS,recoveryRemainingMs:Math.floor(recoveryRemainingMs)}});
      await timers.setTimeout(delayMs,undefined,{signal});
    }finally{clearTimeout(timer);}
  }
}
