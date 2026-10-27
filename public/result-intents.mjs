// Presentation hints only. The destination server always checks project ownership.
const jobs=new Set(['submit_nos3_job','get_nos3_job','wait_nos3_job','cancel_nos3_job','bind_nos3_results']);
const models=new Set(['query_system_model','validate_system_model','verify_system_model','import_system_model','prepare_nos3_model','export_system_model','bind_nos3_results']);
const geospatialJobs=new Set(['submit_geospatial_job','get_geospatial_job','wait_geospatial_job']);
const orbitJobs=new Set(['submit_orbit42_job','get_orbit42_job','wait_orbit42_job','cancel_orbit42_job']);
const groundJobs=new Set(['submit_orbit_ground_job','get_orbit_ground_job','wait_orbit_ground_job','cancel_orbit_ground_job']);
const name=value=>String(value||'').split('__').at(-1);
function object(value){if(typeof value==='string'&&value.length<1500000){try{return JSON.parse(value);}catch{return null;}}return value&&typeof value==='object'?value:null;}
/** The job manifest is a navigation hint only after the native service has
 * positively rechecked its persisted receipt and every referenced artifact.
 * Some runtimes wrap the tool payload in `result`; a false integrity result at
 * either level must override a positive value at the other level. */
export function nativeJobResultState(activity={}) {
  const tool=name(activity.tool);
  if(!geospatialJobs.has(tool)&&!orbitJobs.has(tool)&&!groundJobs.has(tool))return null;
  const direct=object(activity.result)||{},nested=object(direct.result);
  const payload=nested&&['jobId','status','artifacts','integrity','resultPath'].some(key=>Object.hasOwn(nested,key))?nested:direct;
  const status=payload.status||direct.status;
  const terminal=['completed','failed','cancelled','interrupted'].includes(status)||payload.ready===true||direct.ready===true;
  const compromised=direct.integrity?.verified===false||nested?.integrity?.verified===false;
  const verified=terminal&&!compromised&&payload.integrity?.verified===true;
  const resultExpected=payload!==direct||direct.integrity!=null||direct.ready===true||activity.args?.result===true||tool.startsWith('wait_')&&direct.waitTimedOut!==true;
  const reason=[payload.integrity?.reason,direct.integrity?.reason,nested?.integrity?.reason].find(value=>typeof value==='string'&&value.trim());
  return {payload,terminal,verified,compromised,resultExpected,reason:reason?.slice(0,200)||'',jobId:payload.jobId||payload.id||direct.jobId||direct.id||activity.args?.jobId};
}
export function toolResultPresentation(activity={}, {artifacts=[]}={}) {
  const tool=name(activity.tool),result=object(activity.result);
  if(!result)return null;
  const actions=[];
  if(['get_engineering_state','record_engineering_object','capture_configuration','propose_engineering_change','record_engineering_evidence'].includes(tool)&&!result.error)actions.push({action:'open-engineering-records',label:'查看工程记录'});
  if(['submit_professional_job','get_professional_job','wait_professional_job','cancel_professional_job'].includes(tool)){const id=result.jobId||result.id||activity.args?.jobId;if(/^professional_[a-f0-9]{32}$/.test(id||''))actions.push({action:'view-professional-job',id,label:'查看求解结果'});}
  if(['read_professional_model','save_professional_model'].includes(tool)){const path=result.path||activity.args?.path;if(typeof path==='string'&&/(?:\.(mo|sysml|cir|scad)|\.stf\.json)$/i.test(path))actions.push({action:'edit-native-model',path,label:'打开原生模型'});}
  if(jobs.has(tool)){
    const id=result.jobId||result.id||result.job?.id||activity.args?.jobId;
    if(/^nos3_[a-f0-9]{32}$/.test(id||''))actions.push({action:'view-nos3-job',id,label:'查看仿真'});
  }
  if(models.has(tool)){
    const path=result.model?.path||result.path||activity.args?.path;
    if(typeof path==='string'&&/\.sysml$/i.test(path))actions.push({action:'view-result-file',path,label:'查看模型'});
  }
  if(tool==='create_artifact'&&typeof result.id==='string'&&result.id.startsWith('artifact_'))actions.push({action:'read-artifact',id:result.id,label:'打开产物'});
  if(['run_engineering_model','get_engineering_run'].includes(tool)){
    const path=(Array.isArray(result.artifacts)?result.artifacts:[]).find(a=>a&&typeof a.path==='string'&&a.path.endsWith('/series.csv'))?.path;
    if(path)actions.push({action:'view-result-file',path,label:'查看曲线'});
    else if(result.truncated===true&&activity.runId){for(const a of artifacts.filter(a=>a.runId===activity.runId&&typeof a.path==='string'&&a.path.endsWith('/series.csv')).slice(0,8))actions.push({action:'view-result-file',path:a.path,label:'查看已保存曲线'});}
  }
  if(geospatialJobs.has(tool)||orbitJobs.has(tool)||groundJobs.has(tool)){
    const native=nativeJobResultState(activity),family=geospatialJobs.has(tool)?'geospatial':groundJobs.has(tool)?'orbit-ground':'orbit',prefix=family==='geospatial'?'geospatial':family==='orbit'?'orbit42':'orbitground',id=native.jobId;
    if(native.verified&&(family!=='orbit-ground'||native.payload.status==='completed'&&native.payload.executionSucceeded===true)&&new RegExp('^'+prefix+'_[a-f0-9]{32}$').test(id||'')){
      const root=`engineering/${family}/${id}/`,paths=(Array.isArray(native.payload.artifacts)?native.payload.artifacts:[]).map(item=>item?.path).filter(path=>typeof path==='string'&&path.startsWith(root));
      const output=family==='geospatial'?root+'outputs/preview.geojson':family==='orbit'?root+'trajectory.csv':root+'ground-track.geojson';
      if(paths.includes(output))actions.push({action:'view-result-file',path:output,label:family==='geospatial'?'查看地图预览':family==='orbit'?'查看轨迹曲线':'查看星下点轨迹地图'});
      if(family==='orbit-ground'&&paths.includes(root+'ground-samples.csv'))actions.push({action:'view-result-file',path:root+'ground-samples.csv',label:'查看地理采样分类'});
      if(family==='orbit-ground'&&paths.includes(root+'report.md'))actions.push({action:'view-result-file',path:root+'report.md',label:'查看交叉检查报告'});
      const report=root+'result.json';
      if(paths.includes(report))actions.push({action:'view-result-file',path:report,label:'查看作业结果'});
    }
  }
  if(tool==='call_external_tool'&&/^sysml_(query|validate|verify)$/.test(activity.args?.toolName||result.toolName||'')){
    const path=result.result?.structuredContent?.model?.path||result.structuredContent?.model?.path;
    if(typeof path==='string'&&/\.sysml$/i.test(path))actions.push({action:'view-result-file',path,label:'查看模型'});
  }
  const supported=jobs.has(tool)||models.has(tool)||geospatialJobs.has(tool)||orbitJobs.has(tool)||groundJobs.has(tool)||['call_external_tool','run_engineering_model','get_engineering_run'].includes(tool);
  const data=tool==='call_external_tool'?(result.result?.structuredContent??result.structuredContent??result.result??result):result;
  return {actions,data:supported?data:null};
}
