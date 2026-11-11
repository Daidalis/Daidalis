import fs from 'node:fs/promises';
import path from 'node:path';
import {createSdkRuntime} from '../../server/runtimes/sdk.mjs';
const [directory,mode]=process.argv.slice(2);
const wait=()=>new Promise(()=>{});
let sessionId,calls=0;
const ready=()=>process.send({ready:true,sessionId});
const runtime=createSdkRuntime({dataDir:directory,providers:{complete:async()=>{
  if(++calls===1)return {toolCalls:[{id:'completed-write',name:'write_evidence',args:{}},...(mode==='mid-batch'?[{id:'unfinished-write',name:'write_evidence',args:{unfinished:true}}]:[])]};
  ready();return wait();
}}});
runtime.startTurn({providerId:'fixture',workspace:directory,input:'ORIGINAL TASK: preserve actual evidence',tools:[{name:'write_evidence',parameters:{type:'object',properties:{unfinished:{type:'boolean'}}}}],onSession:id=>sessionId=id,
  executeTool:async(_name,args)=>{if(args.unfinished){ready();return wait();}await fs.writeFile(path.join(directory,'evidence.txt'),'Actual write completed once');return {actualEvidence:'Recorded output',_image:{mediaType:'image/png',data:'YWN0dWFsLWltYWdl'}};}
}).completion.catch(error=>{console.error(error);process.exit(1);});
setInterval(()=>{},1000);
