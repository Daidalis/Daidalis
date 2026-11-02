const str={type:'string'},obj=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
export const PROFESSIONAL_TOOL_DEFINITIONS=[
  {name:'professional_catalog',description:'Inspect project native models and actual professional solver readiness and execution isolation. Does not install dependencies.',parameters:obj()},
  {name:'prepare_professional_environment',description:'Prepare the configured professional runner. A Docker deployment checks tools already installed in its image; missing groups require rebuilding that image. Waits for actual readiness; do not duplicate preparation.',parameters:obj()},
  {name:'read_professional_model',description:'Read a project native Modelica, SysML, SPICE, OpenSCAD or tool-specific manifest and its exact content hash before controlled editing.',parameters:obj({path:str},['path'])},
  {name:'save_professional_model',description:'Save a native model draft in the project with optimistic content-hash checking. New files require expectedHash:null. Invalid drafts are allowed; use check to establish actual tool validity. Never overwrite a concurrent edit.',parameters:obj({path:str,content:str,expectedHash:{type:['string','null']}},['path','content','expectedHash'])},
  {name:'submit_professional_job',description:'Submit actual native solver check or simulation execution on exact project model sources. Returns job id immediately; call wait_professional_job when results are needed. Native models, parameters, tool version, diagnostics and results are frozen. Solver success does not establish complete system verification.',parameters:obj({path:str,expectedHash:str,sourcePaths:{type:'array',items:str},operation:{type:'string',enum:['check','simulate']},modelName:str,parameters:{type:'object',additionalProperties:{type:['number','boolean']}},simulation:{description:'Modelica time settings only. Other backends use their documented native source and bounded recipes.',...obj({startTime:{type:'number'},stopTime:{type:'number'},numberOfIntervals:{type:'integer',minimum:2,maximum:20000},tolerance:{type:'number',minimum:1e-12,maximum:0.1}})},signals:{type:'array',maxItems:100,items:{type:'string',maxLength:300},description:'Modelica output names only; omit or [] for all. Literal names; criterion variables automatically included.'},checks:{type:'array',items:obj({id:str,requirementId:str,variable:str,metric:{type:'string',enum:['initial','min','max','final','mean'],description:'initial checks the first recorded sample. For Modelica, its time must match simulation.startTime.'},operator:{type:'string',enum:['<=','>=','<','>','==']},expected:{type:'number'},tolerance:{type:'number'}},['id','variable','metric','operator','expected'])}},['path','expectedHash','operation'])},
  {name:'get_professional_job',description:'Read one project job or its actual normalized result and recorded evidence. Use wait_professional_job for pending results rather than repeated polling.',parameters:obj({jobId:str,result:{type:'boolean'}},['jobId'])},
  {name:'wait_professional_job',description:'Suspend this native tool call until actual professional solver execution ends. Cancellation does not invent a successful run; examine diagnostics, verification checks and exact source hash.',parameters:obj({jobId:str,timeoutMs:{type:'integer',minimum:1,maximum:1800000}},['jobId'])},
  {name:'cancel_professional_job',description:'Cancel only this project professional job, preserving logs, input sources and any partial output as unverified.',parameters:obj({jobId:str},['jobId'])},
];
export function createProfessionalRuntime({professionalModels,authorizeMutation,assertWriteOwnership,waitProfessionalJob,prepareProfessionalEnvironment}){
 const names=new Set(PROFESSIONAL_TOOL_DEFINITIONS.map(t=>t.name));
 const need=()=>{if(!professionalModels)throw Error('Professional model service unavailable');return professionalModels;};
 const compact=value=>{if(!value||typeof value!=='object')return value;const output={...value};if(output.result)output.result=compact(output.result);if(output.series)output.series=output.series.map(s=>({name:s.name,unit:s.unit,points:s.points?.length||0}));if(output.table)output.table={columns:output.table.columns,rowCount:output.table.rowCount,previewRows:output.table.rows?.slice(0,3),truncated:true,fullData:output.tableFile||output.resultPath};return output;};
 async function execute(name,args,ctx){
  // Some compatible gateways emit the nullable sentinel as a string. This means
 // create-only, never unconditional overwrite; saveModel still checks existence.
 if(name==='save_professional_model'&&args.expectedHash==='null')args={...args,expectedHash:null};
 const input={...args,projectId:ctx.projectId},meta={signal:ctx.signal,runId:ctx.runId,threadId:ctx.threadId,source:'agent'};
  if(name==='professional_catalog')return need().catalog(input);
  if(name==='read_professional_model')return need().readModel(input);
  if(name==='get_professional_job')return compact(await (args.result?need().result(input):need().status(input)));
  if(name==='wait_professional_job')return compact(await (waitProfessionalJob?waitProfessionalJob(input,ctx):need().wait(input,meta)));
  if(name==='save_professional_model'){if(args.expectedHash!==null&&(typeof args.expectedHash!=='string'||!/^[a-f0-9]{64}$/.test(args.expectedHash)))throw Error('Invalid expectedHash: new files require JSON null, not the string \"null\"; existing files require their SHA-256.');await assertWriteOwnership?.(args.path,ctx);await authorizeMutation(name,args,ctx);await assertWriteOwnership?.(args.path,ctx);return need().saveModel(input,meta);}
  if(name==='prepare_professional_environment'){await authorizeMutation(name,args,ctx);return prepareProfessionalEnvironment?prepareProfessionalEnvironment(input,ctx):need().prepare(input,meta);}
  if(name==='submit_professional_job'){await authorizeMutation(name,args,ctx);return need().submit(input,meta);}
  if(name==='cancel_professional_job'){await authorizeMutation(name,args,ctx);return need().cancel(input,meta);}
  throw Error('Unknown professional tool');
 }
 return {names,execute};
}
