import {setTimeout as sleep} from 'node:timers/promises';

export const DEFAULT_REQUEST_POLICY=Object.freeze({requestTimeoutMs:300000,maxRetries:2});
export const REQUEST_POLICY_LIMITS=Object.freeze({requestTimeoutMs:[1000,1800000],maxRetries:[0,5]});

export function requestPolicy(provider={}){
  return Object.fromEntries(Object.entries(DEFAULT_REQUEST_POLICY).map(([key,fallback])=>[key,provider[key]??fallback]));
}

export function validateRequestPolicy(input){
  for(const [key,[minimum,maximum]] of Object.entries(REQUEST_POLICY_LIMITS)){
    if(Object.hasOwn(input,key)&&(!Number.isInteger(input[key])||input[key]<minimum||input[key]>maximum))throw Error(`${key} must be an integer from ${minimum} to ${maximum}`);
  }
}

export function requestFailureKind(error){
  if(error.status===429)return 'rate-limit';
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
  if(/^\d+(?:\.\d+)?$/.test(milliseconds))return Number(milliseconds);
  const value=header('retry-after');
  if(/^\d+(?:\.\d+)?$/.test(value))return Number(value)*1000;
  // Date.parse also accepts negative numbers and partial dates. Only HTTP date
  // formats may supply a delay; malformed headers use exponential backoff.
  const httpDate=/^(?:[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]+, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]{3} [A-Za-z]{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4})$/;
  if(httpDate.test(value)){const date=Date.parse(value);if(Number.isFinite(date))return Math.max(0,date-Date.now());}
  return Math.min(30000,1000*2**(attempt-1));
}

// Retry only the outstanding model request. Agent/tool scheduling stays outside
// this boundary, so previously completed tools are never replayed by a retry.
export async function withModelRequestPolicy(operation,{policy,signal,onEvent,providerId}={}){
  const {requestTimeoutMs,maxRetries}=policy;
  for(let attempt=1;attempt<=maxRetries+1;attempt++){
    signal?.throwIfAborted();
    const started=Date.now(),data={providerId,attempt,maxAttempts:maxRetries+1,requestTimeoutMs};
    onEvent?.({type:'model.request.started',message:'Model API request started',data});
    // SDK fetch timeouts can stop at response headers. Keep a caller deadline
    // active through response-body reading and parsing as well.
    const deadline=AbortSignal.timeout(requestTimeoutMs),attemptSignal=signal?AbortSignal.any([signal,deadline]):deadline;
    try{
      const result=await operation(attemptSignal);attemptSignal.throwIfAborted();
      onEvent?.({type:'model.request.completed',message:'Model API response received',data:{...data,durationMs:Date.now()-started}});
      return result;
    }catch(error){
      if(signal?.aborted)throw Error('Cancelled');
      if(deadline.aborted)error=Object.assign(Error('Model request timed out.'),{name:'ModelRequestTimeoutError'});
      const category=requestFailureKind(error),retryable=category!=='request';
      onEvent?.({type:'model.request.failed',message:'Model API request failed',data:{...data,durationMs:Date.now()-started,category,...(Number.isInteger(error.status)?{status:error.status}:{})}});
      if(category==='timeout')error.code='MODEL_REQUEST_TIMEOUT';
      error.attempts=attempt;error.requestTimeoutMs=requestTimeoutMs;
      if(!retryable||attempt>maxRetries)throw error;
      const delayMs=retryDelay(error,attempt);
      // Node timers overflow above this value. Leave unusually long server
      // deferrals to the user instead of accidentally retrying immediately.
      if(delayMs>2147483647)throw error;
      onEvent?.({type:'model.request.retry',message:'Retrying the outstanding model API request',data:{...data,category,delayMs}});
      await sleep(delayMs,undefined,{signal});
    }
  }
}
