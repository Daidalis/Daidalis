import {nativeJobResultState,toolResultPresentation} from './result-intents.mjs';
import {describeProfessionalActivity} from './professional-activity.mjs';
/** Chat shows engineering deliverables, not the runner's file manifest. Raw files
 * remain attached to their actual job and available in Library/job details. */
export function summarizeChatArtifacts(artifacts=[],{projectId,runId,limit=8,activities=[]}={}) {
 const entries=new Map(),verifiedJobs=new Set(),unverifiedJobs=new Set();let rawCount=0;
 for(const activity of activities){const native=nativeJobResultState(activity);if(!native?.terminal||!native.jobId)continue;const ground=native.jobId.startsWith('orbitground_');if(native.verified&&(!ground||native.payload.status==='completed'&&native.payload.executionSucceeded===true))verifiedJobs.add(native.jobId);else if(native.compromised||native.resultExpected||ground)unverifiedJobs.add(native.jobId);}
 for(const artifact of artifacts){
  if(!artifact||projectId&&artifact.projectId!==projectId||runId&&artifact.runId!==runId)continue;
  const path=String(artifact.path||''),job=/(?:^|\/)engineering\/(professional|nos3)\/((?:professional|nos3)_[a-f0-9]{32})(?:\/|$)/.exec(path);
  if(job){const key='job:'+job[2];if(!entries.has(key))entries.set(key,{kind:'job',id:job[2],action:job[1]==='professional'?'view-professional-job':'view-nos3-job',name:job[1]==='professional'?'专业求解结果':'NOS3 仿真结果',createdAt:artifact.createdAt,rawCount:0});entries.get(key).rawCount++;rawCount++;continue;}
  const nativePreview=/^engineering\/geospatial\/(geospatial_[a-f0-9]{32})\/outputs\/preview\.geojson$/.exec(path)||/^engineering\/orbit\/(orbit42_[a-f0-9]{32})\/trajectory\.csv$/.exec(path)||/^engineering\/orbit-ground\/(orbitground_[a-f0-9]{32})\/ground-track\.geojson$/.exec(path);
  if(nativePreview){const jobId=nativePreview[1];if(artifact.id&&verifiedJobs.has(jobId)&&!unverifiedJobs.has(jobId)){const geo=jobId.startsWith('geospatial_'),ground=jobId.startsWith('orbitground_');entries.set('artifact:'+path,{kind:geo||ground?'map':'curve',id:artifact.id,action:'read-artifact',name:geo?'地图预览':ground?'星下点轨迹地图':'轨迹曲线',path,createdAt:artifact.createdAt});}else rawCount++;continue;}
  const groundFile=/^engineering\/orbit-ground\/(orbitground_[a-f0-9]{32})\/(ground-samples\.csv|report\.md)$/.exec(path);
  if(groundFile){const jobId=groundFile[1];if(artifact.id&&verifiedJobs.has(jobId)&&!unverifiedJobs.has(jobId))entries.set('artifact:'+path,{kind:groundFile[2].endsWith('.md')?'report':'table',id:artifact.id,action:'read-artifact',name:groundFile[2].endsWith('.md')?'交叉检查报告':'地理采样分类',path,createdAt:artifact.createdAt});else rawCount++;continue;}
  const display=String(artifact.name||path.split('/').at(-1)||'产物'),native=/(?:\.(?:md|markdown|sysml|kerml|mo|cir|scad)|\.stf\.json)$/i.test(path)||/(?:\.(?:md|markdown|sysml|kerml|mo|cir|scad)|\.stf\.json)$/i.test(display),markdown=['markdown','text/markdown'].includes(artifact.type);
  if(!native&&!markdown){rawCount++;continue;}
  if(!artifact.id)continue;entries.set('artifact:'+(path||artifact.id),{kind:'artifact',id:artifact.id,action:'read-artifact',name:display,path,createdAt:artifact.createdAt});
 }
 const ordered=[...entries.values()].map((entry,index)=>({entry,index})).sort((a,b)=>String(b.entry.createdAt||'').localeCompare(String(a.entry.createdAt||''))||b.index-a.index).map(v=>v.entry);
 return {allEntries:ordered,entries:ordered.slice(0,Math.max(0,Math.min(30,limit))),hiddenEntryCount:Math.max(0,ordered.length-limit),rawCount};
}

export function completedTurnEntries(row={}, {artifacts=[],projectId}={}) {
 const files=new Map(),jobs=new Map(),model=path=>/(?:\.(?:sysml|kerml|mo|cir|scad)|\.stf\.json)$/i.test(path||'');
 const deniedNativeJobs=new Set((row.activities||[]).map(nativeJobResultState).filter(state=>state?.terminal&&!state.verified&&state.jobId&&(state.compromised||state.resultExpected)).map(state=>state.jobId));
 const raw=summarizeChatArtifacts(artifacts,{projectId,runId:row.runId,activities:row.activities||[]}).allEntries;
 for(const entry of raw){if(entry.kind==='job')jobs.set(entry.id,entry);else files.set(entry.path||entry.id,{...entry,kind:model(entry.path||entry.name)?'model':'report'});}
 for(const activity of row.activities||[])for(const action of toolResultPresentation(activity,{artifacts})?.actions||[]){
  if(['view-professional-job','view-nos3-job'].includes(action.action)&&action.id){const descriptor=describeProfessionalActivity(activity),previous=jobs.get(action.id)||{};jobs.set(action.id,{...previous,kind:'job',id:action.id,action:action.action,name:descriptor?.title||previous.name||'仿真结果',state:descriptor?.executionLabel||'',verification:descriptor?.verificationLabel||'',attention:descriptor?.attention||false});}
  else if(['edit-native-model','view-result-file'].includes(action.action)&&model(action.path))files.set(action.path,{kind:'model',action:action.action,path:action.path,name:action.path.split('/').at(-1)});
  else if(action.action==='view-result-file'&&/^engineering\/(?:geospatial\/(?:geospatial_[a-f0-9]{32})\/(?:outputs\/preview\.geojson|result\.json)|orbit\/(?:orbit42_[a-f0-9]{32})\/(?:trajectory\.csv|result\.json)|orbit-ground\/(?:orbitground_[a-f0-9]{32})\/(?:ground-track\.geojson|ground-samples\.csv|report\.md|result\.json))$/.test(action.path||'')&&!deniedNativeJobs.has(action.path.split('/')[2]))files.set(action.path,{kind:'result',action:action.action,path:action.path,name:action.label});
 }
 const rank={result:0,report:1,map:1,curve:1,model:2};
 const allFiles=[...files.values()].sort((a,b)=>(rank[a.kind]??3)-(rank[b.kind]??3));
 return {files:allFiles.slice(0,3),allFiles,jobs:[...jobs.values()],counts:{reports:allFiles.filter(f=>f.kind==='report').length,models:allFiles.filter(f=>f.kind==='model').length,jobs:jobs.size},hasPlan:(row.activities||[]).some(a=>['get_engineering_plan','update_engineering_plan'].includes(String(a.tool||'').split('__').at(-1)))};
}
