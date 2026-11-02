import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {desktopRequest} from './desktop-transport.mjs';

export function createContainerDesktop({socketPath,shots,request=desktopRequest}){
  let state={available:false,status:'unavailable',tools:[]};
  async function refresh(){try{state=await request(socketPath,'/action',{action:'status',timeoutMs:5000});}catch(error){state={available:false,status:'unavailable',tools:[],reason:error.message};}return state;}
  return {refresh,status:()=>state,async action(payload,ctx={}){
    const result=await request(socketPath,'/action',payload,{signal:ctx.signal});
    if(result.contentBase64){
      const bytes=Buffer.from(result.contentBase64,'base64');
      if(bytes.length>8*1024*1024||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid desktop screenshot');
      const name=randomUUID()+'.png';await fs.writeFile(path.join(shots,name),bytes,{flag:'wx',mode:0o600});
      delete result.contentBase64;result.imageUrl='/api/computer/screenshots/'+name;
    }
    return result;
  }};
}
