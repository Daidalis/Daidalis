import {nativeJobResultState} from './result-intents.mjs';
const jobTools=new Set(['submit_professional_job','get_professional_job','wait_professional_job','cancel_professional_job']);
const geoTools=new Set(['submit_geospatial_job','get_geospatial_job','wait_geospatial_job']);
const orbitTools=new Set(['submit_orbit42_job','get_orbit42_job','wait_orbit42_job','cancel_orbit42_job']);
const groundTools=new Set(['submit_orbit_ground_job','get_orbit_ground_job','wait_orbit_ground_job','cancel_orbit_ground_job']);
const modelTools=new Set(['read_professional_model','save_professional_model']);
function object(value){if(typeof value==='string'){try{return JSON.parse(value);}catch{return {};}}return value&&typeof value==='object'?value:{};}
/** Labels describe persisted native output only; execution success never substitutes
 * for checks, and neither check success nor task completion means project approval. */
export function describeProfessionalActivity(activity={}) {
 const name=String(activity.tool||'').split('__').at(-1);if(!jobTools.has(name)&&!modelTools.has(name)&&!geoTools.has(name)&&!orbitTools.has(name)&&!groundTools.has(name))return null;
 if(geoTools.has(name)||orbitTools.has(name)||groundTools.has(name)){
  const native=nativeJobResultState(activity),result=native.payload,geo=geoTools.has(name),status=result.status;
  const unverified=native.terminal&&!native.verified&&native.resultExpected;
  const executionLabel=native.compromised?'证据完整性失败':unverified?'证据完整性未确认':activity.status==='failed'||result.error?'调用失败':({queued:'排队中',running:'执行中',completed:'作业结束',failed:'作业失败',cancelled:'已停止',interrupted:'已中断'})[status]||(['running','started'].includes(activity.status)?'执行中':'等待作业回执');
  const frame=geo?result.targetCrs||result.crs||'':result.frame||'';
  return {title:geo?'地理分析':groundTools.has(name)?'轨道与地理边界交叉检查':'42 轨道仿真',detail:[native.jobId,frame,native.compromised&&native.reason].filter(Boolean).join(' · '),executionLabel,verificationLabel:unverified?'结果与预览不可用；请查看作业诊断并重新验证证据。':'',jobId:native.jobId||null,attention:unverified||activity.status==='failed'||Boolean(result.error)||['failed','cancelled','interrupted'].includes(status)};
 }
 const result=object(activity.result),path=result.model?.path||(typeof result.model==='string'?result.model:null)||result.path||activity.args?.path||'',basename=path.split('/').at(-1),modelSuffix=basename?' · '+basename:'';
 if(modelTools.has(name))return {title:(name==='save_professional_model'?'保存模型':'读取模型')+modelSuffix,detail:path,executionLabel:activity.status==='completed'?name==='save_professional_model'?'已保存':'已读取':activity.status==='failed'?'失败':'执行中',attention:activity.status==='failed',verificationLabel:'',modelPath:path};
 const operation=result.operation||activity.args?.operation,title=({simulate:'仿真',check:'模型校验',render:'生成几何'})[operation]||'专业求解',tool=result.tool||result.receipt?.tool||{},toolLabel=[tool.name||tool.id,tool.version].filter(v=>typeof v==='string'&&v).join(' · '),checks=Array.isArray(result.verification?.checks)?result.verification.checks:[],passed=checks.filter(c=>c.passed===true||c.passed==null&&c.status==='passed').length,failed=checks.filter(c=>c.passed===false||c.passed==null&&c.status==='failed').length,unknown=checks.length-passed-failed,criterionFailed=result.verification?.status==='failed'||failed>0;
 const executionLabel=(activity.status==='failed'||result.error)&&!result.jobId&&!result.id?(name==='submit_professional_job'?'提交失败':'调用失败'):result.executionSucceeded===false?'执行失败':result.executionSucceeded===true?'执行完成':({queued:'排队中',running:'执行中',failed:'作业失败',cancelled:'已停止',interrupted:'已中断',completed:'作业结束'})[result.status]||(['running','started'].includes(activity.status)?'执行中':'等待执行回执');
 const verificationLabel=checks.length?`判据 ${passed}/${checks.length} 通过${failed?' · '+failed+' 项未通过':''}${unknown?' · '+unknown+' 项未判定':''}`:result.verification?.status==='not-requested'?'未设置判据':result.verification?.status==='failed'?'判据未通过':result.ready===false||['queued','running'].includes(result.status)?'':'尚无判据结果';
 return {title:title+modelSuffix,detail:[path,toolLabel].filter(Boolean).join(' · '),executionLabel,verificationLabel,modelPath:path,jobId:result.jobId||result.id||activity.args?.jobId||null,toolLabel,checks:{total:checks.length,passed,failed,unknown},attention:activity.status==='failed'||Boolean(result.error)||result.executionSucceeded===false||criterionFailed||['failed','cancelled','interrupted'].includes(result.status)};
}
const writeTools=new Set(['Write','Edit','write_file','save_professional_model','codex.fileChange']);
const jobToolsForSlots=new Set(['submit_professional_job','get_professional_job','wait_professional_job']);
function toolLeaf(activity){return String(activity?.tool||'').split('__').at(-1);}
function activityPath(activity){
 const result=object(activity?.result);
 return String(result.model?.path||(typeof result.model==='string'?result.model:'')||result.path||activity?.args?.path||activity?.args?.file_path||'');
}
function slotKind(path){if(/\.scad$/i.test(path))return 'shape';if(/\.(sysml|mo)$/i.test(path))return 'source';return '';}
function jobLive(activity,result){return ['queued','running','started'].includes(result.status)||['queued','running','started'].includes(activity.status);}
/** Three sidebar slots from persisted tool records. A later write replaces only its own slot. */
export function modelingSnapshots(activities=[]){
 const slots={source:null,shape:null,simulation:null};
 for(const activity of activities){
  const name=toolLeaf(activity),path=activityPath(activity),result=object(activity.result);
  if(writeTools.has(name)&&activity.status==='completed'){
   const kind=slotKind(path);
   if(kind==='source')slots.source={kind,path,stage:'written',jobId:null};
   else if(kind==='shape')slots.shape={kind,path,stage:'pending',jobId:null};
   continue;
  }
  if(!jobToolsForSlots.has(name))continue;
  const jobId=result.jobId||result.id||activity.args?.jobId||null;
  const operation=result.operation||activity.args?.operation;
  if(/\.scad$/i.test(path)||operation==='render'||result.tool?.id==='openscad'){
   const ready=result.integrity?.verified===true&&activity.status==='completed'&&!jobLive(activity,result);
   slots.shape={kind:'shape',path,jobId,stage:jobLive(activity,result)?'running':ready?'ready':result.status==='failed'||activity.status==='failed'?'failed':'pending'};
  }else if(operation==='simulate'||/\.(mo|sysml)$/i.test(path)&&operation!=='check'){
   const ready=!jobLive(activity,result)&&result.integrity?.verified===true&&Array.isArray(result.table?.rows)&&result.table.rows.length>0;
   slots.simulation={kind:'simulation',path,jobId,stage:jobLive(activity,result)?'running':ready?'ready':result.status==='failed'||activity.status==='failed'?'failed':'pending'};
  }
 }
 return slots;
}
/** One persisted event refreshes one sidebar slot. Log lines do not redraw a card. */
export function modelingEventTarget(event={}){
 const type=String(event.type||''),data=event.data&&typeof event.data==='object'?event.data:{};
 if(type==='professional.log'||type==='professional.environment.log')return null;
 const path=String(data.path||data.modelPath||data.args?.path||data.args?.file_path||'');
 if(type==='professional.model.saved'||type==='tool.completed'&&writeTools.has(String(data.tool||'').split('__').at(-1))){
  if(/\.scad$/i.test(path))return {slot:'shape',path,stage:'running',jobId:data.jobId||null};
  if(/\.(sysml|mo)$/i.test(path))return {slot:'source',path,stage:'written',sha256:data.sha256||null};
  return null;
 }
 if(type==='professional.queued'||type==='professional.running'){
  if(/\.scad$/i.test(path))return {slot:'shape',path,stage:'running',jobId:data.jobId||null};
  if(/\.(mo|sysml)$/i.test(path))return {slot:'simulation',path,stage:'running',jobId:data.jobId||null};
  return null;
 }
 if(type==='professional.completed'||type==='professional.failed'){
  const stage=type.endsWith('failed')?'failed':'completed';
  if(/\.scad$/i.test(path))return {slot:'shape',path,stage,jobId:data.jobId||null};
  if(/\.(mo|sysml)$/i.test(path))return {slot:'simulation',path,stage,jobId:data.jobId||null};
 }
 return null;
}
