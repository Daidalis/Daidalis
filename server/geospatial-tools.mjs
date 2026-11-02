const str={type:'string'};
const object=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const point=object({id:str,lon:{type:'number',minimum:-180,maximum:180},lat:{type:'number',minimum:-90,maximum:90},crs:{type:'string',description:'EPSG:4326 or the explicitly expected source EPSG'},featureId:str,expected:{type:'string',enum:['inside','outside','boundary']}},['id','lon','lat']);

export const GEOSPATIAL_TOOL_DEFINITIONS=[
  {name:'geospatial_catalog',description:'Check configured GDAL/PROJ readiness and supported administrative GIS checks. No installation or execution.',parameters:object()},
  {name:'prepare_geospatial_environment',description:'Prepare version-pinned GDAL/PROJ packages only inside Manta’s configured runner; verify live package and binary hashes. Never changes host global dependencies.',parameters:object()},
  {name:'submit_geospatial_job',description:'Run a bounded GDAL/PROJ job against a project Shapefile ZIP. Requires the ZIP’s actual SHA-256 and explicitly expected geographic source EPSG:4269 or EPSG:4326. Classifies WGS84 or matching-source-CRS control points against full source polygons; the GeoJSON result is a simplified EPSG:4326 display copy only. Returns a durable job ID; wait for the result before claiming a check passed. This does not establish orbit coverage, sensor footprint, collection permission or STF completion.',parameters:object({path:str,expectedHash:str,expectedSourceEpsg:{type:'integer',enum:[4269,4326]},featureIdField:str,points:{type:'array',maxItems:100,items:point},timeoutMs:{type:'integer',minimum:1000,maximum:600000}},['path','expectedHash','expectedSourceEpsg'])},
  {name:'get_geospatial_job',description:'Read status or integrity-verified result of one project GIS job. The result contains exact source/tool hashes, CRS, bounded point checks and artifact paths.',parameters:object({jobId:str,result:{type:'boolean'}},['jobId'])},
  {name:'wait_geospatial_job',description:'Wait for the actual GIS job to finish without polling; verify the returned receipt and control checks. Waiting may be cancelled while the job continues.',parameters:object({jobId:str,timeoutMs:{type:'integer',minimum:1,maximum:1800000}},['jobId'])},
  {name:'cancel_geospatial_job',description:'Cancel only this project GIS job; preserve partial logs and mark unverified.',parameters:object({jobId:str},['jobId'])},
];

export function createGeospatialToolRuntime({geospatialJobs,authorizeMutation,waitGeospatialJob,prepareGeospatialEnvironment}){
  const names=new Set(GEOSPATIAL_TOOL_DEFINITIONS.map(item=>item.name));
  const need=()=>{if(!geospatialJobs)throw Error('Geospatial service unavailable');return geospatialJobs;};
  async function execute(name,args,ctx){
    const input={...args,projectId:ctx.projectId},meta={signal:ctx.signal,threadId:ctx.threadId,runId:ctx.runId,source:'agent'};
    if(name==='geospatial_catalog')return need().catalog(input);
    if(name==='get_geospatial_job')return args.result?need().result(input):need().status(input);
    if(name==='wait_geospatial_job')return waitGeospatialJob?waitGeospatialJob(input,ctx):need().wait(input,meta);
    if(name==='prepare_geospatial_environment'){await authorizeMutation(name,args,ctx);return prepareGeospatialEnvironment?prepareGeospatialEnvironment(input,ctx):need().prepare(input,meta);}
    if(name==='submit_geospatial_job'){await authorizeMutation(name,args,ctx);return need().submit(input,meta);}
    if(name==='cancel_geospatial_job'){await authorizeMutation(name,args,ctx);return need().cancel(input,meta);}
    throw Error('Unknown geospatial tool');
  }
  return {names,execute};
}
