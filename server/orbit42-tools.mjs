const str={type:'string'};
const object=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});

export const ORBIT42_TOOL_DEFINITIONS=[
  {name:'orbit42_catalog',description:'Inspect actual pinned NASA 42 readiness in the managed Linux VM and the bounded orbit-model contract. This does not prepare or install software.',parameters:object()},
  {name:'read_orbit42_model',description:'Read a project .orbit42.json working model and its exact SHA-256 before changing or submitting it.',parameters:object({path:str},['path'])},
  {name:'save_orbit42_model',description:'Save a project .orbit42.json working model using an exact content hash; use expectedHash:null only for a new file. Saving is not model validation or mission acceptance.',parameters:object({path:str,content:str,expectedHash:{type:['string','null']}},['path','content','expectedHash'])},
  {name:'submit_orbit42_job',description:'Submit a pinned short-run NASA 42 orbital propagation in the isolated Linux VM. Requires the exact current .orbit42.json hash. Returns a job ID immediately; wait for the actual result. Its native Earth-centered N-frame trajectory does not establish ground coverage, revisit, three-month lifetime, delivery or complete STF validation.',parameters:object({path:str,expectedHash:str,timeoutMs:{type:'integer',minimum:30000,maximum:180000}},['path','expectedHash'])},
  {name:'get_orbit42_job',description:'Read an orbit job status or its completed result with exact source and artifact hashes. A submitted or running job is not a passed simulation.',parameters:object({jobId:str,result:{type:'boolean'}},['jobId'])},
  {name:'wait_orbit42_job',description:'Suspend this tool call until the native 42 job finishes or the declared wait timeout expires. Inspect the actual result and evidence before reporting a conclusion.',parameters:object({jobId:str,timeoutMs:{type:'integer',minimum:1,maximum:1800000}},['jobId'])},
  {name:'cancel_orbit42_job',description:'Cancel only the selected project orbit job. Partial outputs remain unverified; cancellation cannot create a successful result.',parameters:object({jobId:str},['jobId'])},
];

export function createOrbit42Runtime({orbit42Jobs,authorizeMutation,assertWriteOwnership,waitOrbit42Job}={}){
  const names=new Set(ORBIT42_TOOL_DEFINITIONS.map(tool=>tool.name));
  const need=()=>{if(!orbit42Jobs)throw Error('Orbit 42 service unavailable');return orbit42Jobs;};
  async function execute(name,args,ctx){
    const input={...args,projectId:ctx.projectId};
    const meta={signal:ctx.signal,runId:ctx.runId,threadId:ctx.threadId,source:'agent'};
    if(name==='orbit42_catalog')return need().catalog(input);
    if(name==='read_orbit42_model')return need().readModel(input);
    if(name==='get_orbit42_job')return args.result?need().result(input):need().status(input);
    if(name==='wait_orbit42_job')return waitOrbit42Job?waitOrbit42Job(input,ctx):need().wait(input,{signal:ctx.signal,timeoutMs:args.timeoutMs});
    if(name==='save_orbit42_model'){
      await assertWriteOwnership?.(args.path,ctx);
      await authorizeMutation(name,args,ctx);
      await assertWriteOwnership?.(args.path,ctx);
      return need().saveModel(input,meta);
    }
    if(name==='submit_orbit42_job'){
      await authorizeMutation(name,args,ctx);
      return need().submit(input,meta);
    }
    if(name==='cancel_orbit42_job'){
      await authorizeMutation(name,args,ctx);
      return need().cancel(input,meta);
    }
    throw Error('Unknown orbit 42 tool');
  }
  return {names,execute};
}
