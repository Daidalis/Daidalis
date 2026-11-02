import {desktopRequest} from './desktop-transport.mjs';
const scripts=new Map([['geospatial-container.py','gis'],['orbit42-container.py','orbit42'],['orbit-ground-container.py','ground']]);
export function createBrokerProcess({socketPath=process.env.MANTA_BROKER_SOCKET}={}){
  return async(file,args,{input='',signal,timeoutMs=180000}={})=>{
    const adapter=scripts.get(args?.[1]?.split('/').at(-1));
    if(file!=='/usr/bin/python3'||args?.[0]!=='-B'||!adapter||!['status','run'].includes(args[2]))throw Error('Unsupported broker engineering entry point');
    const result=await desktopRequest(socketPath,'/task',{kind:'adapter',adapter,mode:args[2],input,timeoutMs},{signal});
    return {code:0,stdout:JSON.stringify({...result,isolated:true}),stderr:''};
  };
}
export function createBrokerFlightRpc({socketPath=process.env.MANTA_BROKER_SOCKET}={}){
  return async(method,payload,{signal,timeoutMs=960000}={})=>{
    if(!['status','nos3'].includes(method))throw Error('STF reference workflow is deferred');
    const result=await desktopRequest(socketPath,'/task',{kind:'adapter',adapter:'flight',mode:method,input:JSON.stringify(payload),timeoutMs},{signal});
    if(method==='status'&&result.tools?.['nos3-stf'])result.tools['nos3-stf']={ready:false,available:false,reason:'STF reference workflow is deferred in broker mode'};
    return result;
  };
}

export function createBrokerNumericalRunner({socketPath=process.env.MANTA_BROKER_SOCKET}={}){
  const call=(mode,input,ctx={})=>desktopRequest(socketPath,'/task',{kind:'adapter',adapter:'numerical',mode,input:JSON.stringify(input),timeoutMs:ctx.timeoutMs||120000},ctx);
  return {probe:ctx=>call('status',{},ctx),run:(input,ctx)=>call('run',input,ctx)};
}
