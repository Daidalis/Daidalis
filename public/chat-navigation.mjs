import {runExecutionStatus} from '../shared/run-presentation.mjs';
const routineReadTools=new Set(['read_file','list_files','search_files','search_knowledge','web_fetch','WebFetch','WebSearch','codex.webSearch','Read','Glob','Grep']);
/** Source and file discovery failures remain inspectable in the process record.
 * Solver, verification, write and approval failures are never treated as routine. */
export function isRoutineReadFailure(activity={}) {
 const tool=String(activity.tool||'').split('__').at(-1);
 return activity.kind==='tool'&&['failed','error','blocked'].includes(activity.status)&&routineReadTools.has(tool);
}
/** Chat authorship owns the detail, independently of whichever panel is open. */
export function chatDetailOrigin({projectId,mainThreadId,sideThreadId,sideThreadTitle,fromThread=false}={}) {
 const side=fromThread&&sideThreadId&&sideThreadId!==mainThreadId;
 return {projectId,threadId:side?sideThreadId:mainThreadId,title:side?sideThreadTitle||'Thread':'Coordinator'};
}
/** Completed turns show answers; public execution belongs to active turns. */
export function chatTurnDisclosure(row={},visible={activities:[],routes:[],messages:[]}) {
 const live=['running','queued','waiting_approval','awaiting_approval','pending','waiting'].includes(row.rawStatus||row.status);
 const important=a=>['running','started','queued','pending','waiting_approval','waiting_tasks','waiting_job','preparing_environment','failed','error','rejected','blocked'].includes(a.status)||a.result?.verification?.status==='failed';
 const publicActivities=live?(visible.activities||[]).filter(a=>a.kind!=='thread'&&!isRoutineReadFailure(a)&&important(a)):[];
 const routes=visible.routes||[],publicIds=new Set([...publicActivities,...routes].map(a=>a.id));
 return {live,publicActivities,routes,messages:live?visible.messages||[]:[],processActivities:(row.activities||[]).filter(a=>!publicIds.has(a.id)),foldedReadFailureCount:(row.activities||[]).filter(isRoutineReadFailure).length};
}

/** Keep one live entry per delegated task. A real result receipt supersedes its
 * earlier start receipt; an explicit assistant link already serves as a start entry. */
export function compactThreadHandoffs(row={}) {
 const byThread=new Map(),prose=[...(row.processMessages||[]),...(row.finalMessage?[row.finalMessage]:[])].map(m=>String(m.content||''));
 for(const activity of row.activities||[]) {
  if(activity.kind!=='thread'||!activity.childThreadId||activity.type==='thread.routed')continue;
  const previous=byThread.get(activity.childThreadId);
  if(!previous||activity.type==='thread.result'||previous.type!=='thread.result')byThread.set(activity.childThreadId,activity);
 }
 return [...byThread.values()].filter(a=>a.type==='thread.result'||!prose.some(text=>text.includes('#manta-thread:'+a.childThreadId)));
}

/** A detail's follow-up is a draft in its owning chat, never a sent instruction.
 * Preserve any text already typed there and leave every other chat draft intact. */
export function detailPromptDraft({origin,projectId,mainThreadId,drafts={},text=''}={}) {
 const threadId=origin?.projectId===projectId&&origin.threadId?origin.threadId:mainThreadId||projectId||'new',previous=String(drafts[threadId]||''),addition=String(text||'');
 return {threadId,side:threadId!==mainThreadId&&threadId!==projectId&&threadId!=='new',draft:!addition.trim()||previous===addition?previous:previous.trim()?previous+'\n\n'+addition:addition};
}

/** A current server overview is authoritative. Local fallback is only for the
 * currently displayed chat, never a detached inspector retained in memory. */
export function resolveThreadExecutionStatus(thread={}, {projectThreads=[],mainDetail=null,sideDetail=null,sideThreadId=null,approvals=[]}={}) {
 const current=projectThreads.find(t=>t.id===thread.id&&(!thread.projectId||t.projectId===thread.projectId));
 if(typeof current?.executionStatus==='string'&&current.executionStatus)return current.executionStatus;
 if(typeof thread.executionStatus==='string'&&thread.executionStatus)return thread.executionStatus;
 const details=[mainDetail?.thread?.id===thread.id?mainDetail:null,sideThreadId===thread.id&&sideDetail?.thread?.id===thread.id?sideDetail:null].filter(Boolean),local=details.flatMap(d=>d.runs||[]).filter(r=>r.threadId===thread.id).at(-1);
 if(local)return runExecutionStatus(local,{approvals});
 return thread.status==='resolved'?'completed':['stopped','cancelled','canceled'].includes(thread.status)?'stopped':'idle';
}
