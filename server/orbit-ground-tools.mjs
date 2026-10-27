const str={type:'string'};
const object=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});

export const ORBIT_GROUND_TOOL_DEFINITIONS=[
  {name:'orbit_ground_catalog',description:'Inspect the bounded native NASA 42 world-frame/state-boundary cross-check available in the isolated Linux VM. Source provenance must be evidenced separately. This does not establish sensor footprint, revisit or mission acceptance.',parameters:object()},
  {name:'submit_orbit_ground_job',description:'Classify bounded samples from an exact completed, integrity-verified NASA 42 job against an imported, SHA-256-pinned state-boundary ZIP. Requires the orbit job ID and source-<hash>.zip filename. The ZIP hash proves byte identity, not official origin. Returns a job ID; wait for the actual result. This is a reference geometry cross-check, not coverage or permission verification.',parameters:object({orbit42JobId:str,censusPath:str,censusSha256:str,maxSamples:{type:'integer',minimum:2,maximum:201},timeoutMs:{type:'integer',minimum:30000,maximum:300000}},['orbit42JobId','censusPath','censusSha256'])},
  {name:'get_orbit_ground_job',description:'Read status or integrity-verified output of one project orbit-ground cross-check job.',parameters:object({jobId:str,result:{type:'boolean'}},['jobId'])},
  {name:'wait_orbit_ground_job',description:'Wait for a selected orbit-ground job without polling; inspect its actual scope and verified evidence before reporting a conclusion.',parameters:object({jobId:str,timeoutMs:{type:'integer',minimum:1,maximum:1800000}},['jobId'])},
  {name:'cancel_orbit_ground_job',description:'Cancel only a selected orbit-ground job. Partial output cannot become a successful result.',parameters:object({jobId:str},['jobId'])},
];

export function createOrbitGroundRuntime({orbitGroundJobs,authorizeMutation,waitOrbitGroundJob}={}){
  const names=new Set(ORBIT_GROUND_TOOL_DEFINITIONS.map(tool=>tool.name));
  const need=()=>{if(!orbitGroundJobs)throw Error('Orbit-ground service unavailable');return orbitGroundJobs;};
  async function execute(name,args,ctx){
    const input={...args,projectId:ctx.projectId};
    const meta={signal:ctx.signal,threadId:ctx.threadId,runId:ctx.runId,source:'agent'};
    if(name==='orbit_ground_catalog')return need().catalog(input);
    if(name==='get_orbit_ground_job')return args.result?need().result(input):need().status(input);
    if(name==='wait_orbit_ground_job')return waitOrbitGroundJob?waitOrbitGroundJob(input,ctx):need().wait(input,{signal:ctx.signal,timeoutMs:args.timeoutMs});
    if(name==='submit_orbit_ground_job'){await authorizeMutation(name,args,ctx);return need().submit(input,meta);}
    if(name==='cancel_orbit_ground_job'){await authorizeMutation(name,args,ctx);return need().cancel(input,meta);}
    throw Error('Unknown orbit-ground tool');
  }
  return {names,execute};
}
