// Public execution records only. This module does not infer or expose model reasoning.
const LIVE = new Set(['queued', 'running', 'waiting_approval']);
const THREAD_MESSAGES = new Set(['thread.started', 'thread.result', 'thread.routed']);
const TOOL_LABELS = {
 'codex.commandExecution':'运行项目命令','codex.fileChange':'修改项目文件','codex.webSearch':'查找公开资料',Bash:'运行项目命令',Read:'读取项目文件',Write:'写入项目文件',Edit:'编辑项目文件',Glob:'查找项目文件',Grep:'检索项目源码',WebSearch:'查找公开资料',WebFetch:'读取公开资料',
  route_user_message:'转交你的消息',get_engineering_plan:'读取工程计划',update_engineering_plan:'更新工程计划',professional_catalog:'检查专业工具',prepare_professional_environment:'准备隔离求解环境',read_professional_model:'读取原生模型',save_professional_model:'保存原生模型',submit_professional_job:'提交专业求解',get_professional_job:'读取求解结果',wait_professional_job:'等待专业求解',cancel_professional_job:'停止专业求解',stf_case_catalog:'读取 STF 工程资产',create_stf_case:'建立 STF 工程起点',
  get_engineering_state:'读取工程记录',record_engineering_object:'记录工程对象',capture_configuration:'捕获观察快照',propose_engineering_change:'记录工程变更',record_engineering_evidence:'登记工程证据',
  list_external_tools:'发现项目 MCP 工具',call_external_tool:'调用外部 MCP 工具',model_backend_catalog:'检查模型后端',import_system_model:'导入 SysML 模型',prepare_nos3_model:'建立 NOS3 接口模型',query_system_model:'查询 SysML 模型',validate_system_model:'检查 SysML 语义',export_system_model:'导出 SysML 模型',verify_system_model:'求值模型约束',bind_nos3_results:'回填 NOS3 验证结果',inspect_nos3:'检查 NOS3 环境',submit_nos3_job:'提交 NOS3 作业',get_nos3_job:'读取 NOS3 结果',wait_nos3_job:'等待 NOS3 作业',cancel_nos3_job:'停止 NOS3 作业',
  read_file:'读取项目文件', write_file:'写入项目文件', list_files:'查看项目文件',
  search_files:'搜索项目文件', search_knowledge:'检索项目资料', web_fetch:'读取公开资料',
  run_command:'执行已审批命令', get_model:'读取系统模型', update_model:'更新系统模型',
  create_artifact:'保存工件', read_project_memory:'读取项目记忆', update_project_memory:'更新项目记忆',
  engineering_catalog:'检查工程工具', run_engineering_model:'运行工程分析', get_engineering_run:'读取工程分析结果',
  start_thread:'启动独立任务', delegate_task:'启动独立任务', list_threads:'查看任务状态',
  read_thread:'读取任务结果', steer_thread:'发送任务补充', wait_threads:'等待子任务结果', wait_for_tasks:'等待子任务结果', get_task_assignments:'查看任务分工', review_task_results:'记录任务结果复核', computer_use:'操作工程工作面',
};
const PROGRESS_LABELS = {
  'run.queued':'等待执行', 'run.started':'开始执行', 'run.finished':'执行结束',
  'run.cancelled':'已请求停止', 'agent.started':'开始任务', 'agent.thinking':'处理中',
  'agent.completed':'任务完成', 'agent.failed':'任务未完成',
  'engineering.queued':'工程分析排队中', 'engineering.started':'开始工程分析',
  'engineering.completed':'工程分析已返回', 'computer.action':'工程工作面操作',
  'coordination.waiting':'等待子任务', 'coordination.resumed':'子任务结果已交接',
  'coordination.reviewing':'复核子任务结果', 'coordination.summarizing':'汇总结果',
};
function time(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const n = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(n) ? n : null;
}
function elapsed(start, end) { return start !== null && end !== null && end >= start ? end - start : null; }
function statusOf(value) { return typeof value === 'string' && value ? value : 'unknown'; }
function failure(result) {
  if (!result || typeof result !== 'object') return false;
  return Boolean(result.error) || (typeof result.code === 'number' && result.code !== 0)
    || ['failed','cancelled','interrupted','rejected'].includes(result.status);
}
/** Resolve authorship from persisted transport records, never from message wording.
 * Native runtimes use user-role envelopes for some internal inputs; those envelopes
 * are not evidence that a human wrote the message. Historical runs lack origin.
 */
export function internalMessageOrigin(message={}, {run,initialInput=false,agents=[],threads=[]}={}) {
  if (THREAD_MESSAGES.has(message.type)||message.type==='user.forwarded'&&message.metadata?.origin==='user') return null;
  const metadata=message.metadata && typeof message.metadata==='object' ? message.metadata : {};
  const explicit=message.role==='agent'||message.origin==='agent'||metadata.origin==='agent'
    || ['agent.assignment','agent.message'].includes(message.type)||Boolean(metadata.fromAgentId||message.fromAgentId);
  const legacyInput=message.role==='user'&&initialInput&&['delegated','agent-message'].includes(run?.source)
    && message.origin!=='user'&&metadata.origin!=='user';
  if (!explicit&&!legacyInput) return null;
  const fromAgentId=metadata.fromAgentId||message.fromAgentId||null;
  const agent=agents.find(a=>a.id===fromAgentId);
  const fromRunId=metadata.fromRunId||agent?.runId||(legacyInput?run?.parentRunId:null)||null;
  const fromThreadId=metadata.fromThreadId||agent?.threadId||(legacyInput&&run?.source==='delegated'?threads.find(t=>t.id===message.threadId)?.parentThreadId:null)||null;
  const source=threads.find(t=>t.id===fromThreadId),target=threads.find(t=>t.id===message.threadId);
  const authorRole=metadata.authorRole||source?.kind;
  const assignment=message.type==='agent.assignment'||(legacyInput&&run?.source==='delegated')
    ||authorRole==='coordinator'||(fromThreadId&&target?.parentThreadId===fromThreadId);
  const progress=authorRole==='worker'||source?.parentThreadId===message.threadId
    ||(target?.kind==='coordinator'&&!assignment);
  return {kind:'agent',label:assignment?'主任务指令':progress?'子任务进展':'任务间消息',
    sourceName:String(metadata.fromThreadTitle||source?.title||metadata.fromAgentName||agent?.name||(assignment?'主任务':progress?'子任务':'项目 Agent')),
    fromAgentId,fromThreadId,fromRunId,delivery:metadata.delivery||null};
}
function messageActivity(message) {
  const metadata = message.metadata || {}, returned = message.type === 'thread.result',routed=message.type==='thread.routed';
  return {
    id:message.id || `thread-message:${metadata.runId || metadata.threadId || ''}`,
    kind:routed?'route':'thread', type:message.type, status:returned ? metadata.branchStatus==='blocked'?'blocked':statusOf(metadata.status) : routed?metadata.delivery==='queued'?'queued':'completed':'queued',
    label:returned ? '子任务已交付' : routed?'转交你的消息':'分派子任务', detail:message.content || '',routeId:metadata.routeId||null,sourceMessageId:metadata.sourceMessageId||null,reason:metadata.reason||'',delivery:metadata.delivery||null,reviewStatus:metadata.reviewStatus||null,branchStatus:metadata.branchStatus||null,openDependencies:Array.isArray(metadata.openDependencies)?metadata.openDependencies:[],
    threadId:message.threadId || null, childThreadId:metadata.taskThreadId || metadata.threadId || null,
    runId:metadata.runId || message.runId || null, result:returned ? metadata.result || null : null,
    artifacts:metadata.artifacts || [], startedAt:null,observedAt:message.createdAt || null,
    finishedAt:returned ? metadata.result?.completedAt || null : null,
    eventIds:[], messageId:message.id || null,
  };
}
function eventActivity(event) {
  const data = event.data || {};
  return {id:event.id || `event:${event.type}:${event.createdAt || ''}`, kind:'progress', type:event.type,
    status:event.type === 'agent.failed' ? statusOf(data.status || 'failed') : event.type === 'run.cancelled' ? 'cancelled'
      : event.type.endsWith('.completed') || event.type === 'run.finished' ? statusOf(data.status || 'completed') : 'observed',
    label:PROGRESS_LABELS[event.type] || event.type, detail:event.message || '', threadId:data.threadId || null,
    startedAt:event.createdAt || null, finishedAt:null, eventIds:event.id ? [event.id] : [], agentId:data.agentId || null,turn:typeof data.turn==='number'?data.turn:null};
}
function toolDetail(tool, args) {
  if (!args || typeof args !== 'object') return '';
  if (tool === 'computer_use') return String(args.action || '');
  return String(args.path || args.name || args.query || args.model || args.threadId || '').slice(0,200);
}
function collectActivities({run, messages, events, approvals}) {
  const activities = [], pending = new Map(), messageIds = new Set(messages.map(m=>m.id).filter(Boolean));
  for (const message of messages) if (THREAD_MESSAGES.has(message.type)) activities.push(messageActivity(message));
  const seen = new Set();
  for (const event of events) {
    if (event.id && seen.has(event.id)) continue;
    if (event.id) seen.add(event.id);
    const data = event.data || {};
    if (event.type === 'tool.started') {
      const tool = data.tool || 'unknown', key = `${data.agentId || ''}\0${tool}\0${data.callId || data.itemId || ''}`;
      const activity = {id:event.id || `tool:${activities.length}`, kind:'tool', type:'tool', status:'running',
        label:TOOL_LABELS[String(tool).split('__').at(-1)] || tool, detail:toolDetail(tool,data.args), tool, args:data.args || {}, result:null,
        threadId:data.threadId || run.threadId || null, startedAt:event.createdAt || null, finishedAt:null,
        eventIds:event.id ? [event.id] : [], startMissing:false};
      if (!pending.has(key)) pending.set(key,[]); pending.get(key).push(activity); activities.push(activity);
    } else if (event.type === 'tool.completed') {
      const tool = data.tool || 'unknown', key = `${data.agentId || ''}\0${tool}\0${data.callId || data.itemId || ''}`;
      let activity = pending.get(key)?.shift();
      if (!activity) {
        activity = {id:event.id || `tool:${activities.length}`, kind:'tool', type:'tool', label:TOOL_LABELS[String(tool).split('__').at(-1)] || tool,
          detail:toolDetail(tool,data.args), tool, args:data.args || null, threadId:data.threadId || run.threadId || null,
          startedAt:null, eventIds:[], startMissing:true}; activities.push(activity);
      }
      activity.status = failure(data.result) ? (['cancelled','interrupted'].includes(data.result?.status) ? data.result.status : 'failed') : 'completed';
      activity.result = data.result ?? null; activity.finishedAt = event.createdAt || null;
      if (event.id) activity.eventIds.push(event.id);
    } else if (['thread.created','thread.started','thread.result','thread.message.routed'].includes(event.type)) {
      const message = data.message;
      if (message && messageIds.has(message.id)) continue;
      // A result posted to the coordinator is not part of the worker's own chat history.
      if (message?.threadId && message.threadId !== run.threadId) continue;
      if (message && THREAD_MESSAGES.has(message.type)) { const activity=messageActivity(message);if(event.id)activity.eventIds.push(event.id);activities.push(activity); }
      else if (event.type !== 'thread.result') activities.push({
        id:event.id || `thread-event:${activities.length}`, kind:'thread', type:event.type, status:'queued',
        label:'启动独立任务', detail:event.message || '', threadId:run.threadId,
        childThreadId:data.thread?.id || data.threadId || null, runId:data.resultRunId || null,
        startedAt:event.createdAt || null, finishedAt:null, eventIds:event.id ? [event.id] : [],
      });
    } else if (Object.hasOwn(PROGRESS_LABELS,event.type)) activities.push(eventActivity(event));
  }
  for (const queue of pending.values()) for (const activity of queue) {
    if (approvals.some(a=>a.status === 'pending' && a.tool === activity.tool)) activity.status='waiting_approval';
    else if (run.status==='running' && run.executionPhase==='waiting_tasks' && ['wait_threads','wait_for_tasks'].includes(activity.tool)) activity.status='waiting_tasks';
    else if (run.status==='running' && run.executionPhase==='preparing_environment' && activity.tool==='prepare_nos3_environment') activity.status='preparing_environment';
    else if (run.status==='running' && run.executionPhase==='waiting_job' && activity.tool==='wait_nos3_job') activity.status='waiting_job';
    else if (['failed','cancelled','interrupted'].includes(run.status)) activity.status=run.status;
    else if (run.status === 'completed') activity.status='unknown'; // no recorded tool outcome
  }
  return activities.map((a,index)=>({a,index})).sort((a,b)=>{
    const ta=time(a.a.startedAt || a.a.finishedAt || a.a.observedAt),tb=time(b.a.startedAt || b.a.finishedAt || b.a.observedAt);
    return ta!==null&&tb!==null&&ta!==tb ? ta-tb : a.index-b.index;
  }).map(x=>({...x.a,runId:x.a.runId||run.id}));
}
function historyFor(runId, events, eventHistory) {
  const supplied=eventHistory?.perRun?.[runId];
  if (supplied) return {...supplied};
  return {retainedCount:events.length,returnedCount:events.length,totalCount:null,complete:false,truncated:false,
    reason:events.length?'completeness-not-recorded':'event-history-unavailable',detailLimit:null};
}
/** Format only a recorded/calculated duration. Missing timestamps do not become zero. */
export function formatDuration(durationMs) {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return '';
  const seconds=Math.floor(durationMs/1000),minutes=Math.floor(seconds/60);
  return minutes ? `${minutes}m ${seconds%60}s` : `${seconds}s`;
}
/** Public execution state is explicit; child activity alone never implies a parent wait. */
export function runExecutionStatus(run={}, {approvals=[]}={}) {
  const status=statusOf(run.status);
  if (!LIVE.has(status)) return status;
  if (status==='waiting_approval' || approvals.some(a=>a.status==='pending'&&a.runId&&a.runId===run.id)) return 'waiting_approval';
  if (status==='queued') return 'queued';
  if (['waiting_tasks','waiting_job','preparing_environment','reviewing','summarizing'].includes(run.executionPhase)) return run.executionPhase;
  return run.source==='auto-summary' ? 'summarizing' : 'running';
}
function waitingTasksFor(run, childThreads) {
  if (!run.waitingFor || typeof run.waitingFor!=='object') return null;
  const waiting=run.waitingFor, recorded=Array.isArray(waiting.tasks)?waiting.tasks:[], byThread=new Map(childThreads.map(t=>[t.id,t]));
  const ids=[...new Set([...(Array.isArray(waiting.threadIds)?waiting.threadIds:[]),...recorded.map(t=>t.threadId)].filter(id=>typeof id==='string'&&id))];
  const tasks=ids.map((threadId,index)=>{
    const task=recorded.find(t=>t.threadId===threadId)||{},thread=byThread.get(threadId),execution=thread?.executionStatus;
    const status=execution&&execution!=='idle'?execution:thread?.status==='resolved'?'completed':thread?.status==='stopped'?'cancelled':statusOf(task.status||execution);
    return {threadId,runId:task.runId||(Array.isArray(waiting.runIds)?waiting.runIds[index]:null)||null,title:thread?.title||task.title||'子任务',status};
  });
  return {mode:waiting.mode==='any'?'any':'all',startedAt:waiting.startedAt||null,tasks};
}

function deliveryReviews(runs) {
 const reviews=new Map();
 for(const run of runs)for(const review of Array.isArray(run.lastHandoff?.reviewed)?run.lastHandoff.reviewed:[])if(review.runId&&['accepted','needs_work','blocked'].includes(review.outcome))reviews.set(review.runId,review);
 for(const run of runs)if(['accepted','needs_work','blocked'].includes(run.review?.outcome))reviews.set(run.id,run.review);
 return reviews;
}
function withDeliveryReview(activity,reviews) {
 const review=activity?.type==='thread.result'?reviews.get(activity.runId):null;
 return review?{...activity,reviewStatus:review.outcome}:activity;
}
/** Build a chat timeline from public persisted records, without modifying any input. */
export function buildRunPresentation({messages=[],runs=[],events=[],agents=[],threadId,childThreads=[],approvals=[],eventHistory,nowMs=null}={}) {
  const reviews=deliveryReviews(runs);
  const selectedMessages=messages.filter(m=>!threadId || !m.threadId || m.threadId===threadId);
  const selectedRuns=runs.filter(r=>!threadId || r.threadId===threadId), byRun=new Map();
  for (const run of selectedRuns) if (run.id) byRun.set(run.id,{run,messages:[],events:[]});
  const standalone=[];
  for (const message of selectedMessages) {
    const bucket=byRun.get(message.runId);
    if (bucket && (!message.threadId || message.threadId===bucket.run.threadId)) bucket.messages.push(message);
    else standalone.push({kind:'message',id:message.id,message,origin:internalMessageOrigin(message,{agents,threads:childThreads}),...(THREAD_MESSAGES.has(message.type)?{activity:withDeliveryReview(messageActivity(message),reviews)}:{})});
  }
  for (const event of events) {const bucket=byRun.get(event.runId);if(bucket)bucket.events.push(event);}
  const rows=[];
  for (const {run,messages:ownMessages,events:ownEvents} of byRun.values()) {
    const initialInput=ownMessages.find(m=>m.role==='user'||m.role==='agent'),origins=new Map(ownMessages.map(m=>[m,internalMessageOrigin(m,{run,initialInput:m===initialInput,agents,threads:childThreads})]));
    const ordinaryAssistant=ownMessages.filter(m=>m.role==='assistant'&&!THREAD_MESSAGES.has(m.type)&&!origins.get(m));
    const lastAssistant=ordinaryAssistant.at(-1),result=typeof run.result==='string'?run.result.trim():'';
    const finalMessage=run.status==='completed'&&result&&lastAssistant&&String(lastAssistant.content||'').trim()===result?lastAssistant:null;
    const runApprovals=approvals.filter(a=>a.runId===run.id),start=time(run.startedAt),finish=time(run.finishedAt),queued=time(run.createdAt);
    const live=LIVE.has(run.status),end=finish!==null?finish:live&&typeof nowMs==='number'&&Number.isFinite(nowMs)?nowMs:null;
    const durationMs=elapsed(start,end),rawStatus=statusOf(run.status);
    const activities=collectActivities({run,messages:ownMessages,events:ownEvents,approvals:runApprovals}).map(a=>{if(a.type==='thread.result')return withDeliveryReview(a,reviews);if(a.kind!=='thread')return a;const task=childThreads.find(t=>t.id===a.childThreadId);return task?{...a,status:task.executionStatus&&task.executionStatus!=='idle'?task.executionStatus:task.status==='resolved'?'completed':task.status==='stopped'?'cancelled':a.status}:a;});
    rows.push({kind:'run',id:run.id,runId:run.id,threadId:run.threadId,run,
      source:run.source || null,automatic:run.source==='auto-summary',status:live&&start===null?'queued':rawStatus,rawStatus,
      executionStatus:runExecutionStatus(run,{approvals:runApprovals}),waitingFor:waitingTasksFor(run,childThreads),waitingJob:run.waitingJob?{...run.waitingJob}:null,
      queuedAt:queued===null?null:run.createdAt,startedAt:start===null?null:run.startedAt,finishedAt:finish===null?null:run.finishedAt,
      durationMs,durationLive:finish===null&&live&&start!==null,queueDurationMs:elapsed(queued,start!==null?start:rawStatus==='queued'?end:null),
      timingStatus:start===null?'start-unrecorded':end===null?'end-unrecorded':durationMs===null?'invalid-order':'recorded',
      userMessages:ownMessages.filter(m=>m.role==='user'&&!origins.get(m)),processMessages:ordinaryAssistant.filter(m=>m!==finalMessage),
      internalMessages:ownMessages.filter(m=>origins.get(m)).map(message=>({message,origin:origins.get(message)})),finalMessage,
      finalMessageMissing:run.status==='completed'&&Boolean(result)&&!finalMessage,
      activities,approvals:runApprovals,agents:agents.filter(a=>a.runId===run.id),
      childThreads:childThreads.filter(t=>t.originRunId===run.id||t.createdByRunId===run.id),
      eventHistory:historyFor(run.id,ownEvents,eventHistory),error:run.error || null,
    });
  }
  const order=new Map(selectedMessages.map((m,i)=>[m.id,i]));
  return [...rows,...standalone].map((row,index)=>{
    const anchor=row.kind==='message'?row.message.createdAt:row.userMessages[0]?.createdAt||row.run.createdAt||row.startedAt||row.internalMessages[0]?.message.createdAt||row.processMessages[0]?.createdAt||row.finalMessage?.createdAt;
    const firstMessage=row.kind==='message'?row.message:[...row.userMessages,...row.processMessages,...row.internalMessages.map(item=>item.message),...(row.finalMessage?[row.finalMessage]:[])].sort((a,b)=>(order.get(a.id)??0)-(order.get(b.id)??0))[0];
    return {row,index,at:time(anchor),position:firstMessage?order.get(firstMessage.id)??index:index};
  }).sort((a,b)=>a.at!==null&&b.at!==null&&a.at!==b.at?a.at-b.at:a.position-b.position||a.index-b.index).map(x=>x.row);
}

/** High-signal public work stays in chat. Repetitive reads and raw payloads remain
 * in the process disclosure; this never derives or displays private reasoning. */
export function visibleRunWork(row={}, {hasResult=()=>false,resultKey=()=>null,maxCompleted=6}={}) {
 const live=LIVE.has(row.rawStatus||row.status),activities=row.activities||[],routes=activities.filter(a=>a.type==='thread.routed');
 const name=a=>String(a.tool||'').split('__').at(-1),active=a=>['running','started','queued','pending','waiting_approval','waiting_tasks','waiting_job','preparing_environment'].includes(a.status),failed=a=>['blocked','failed','error','rejected'].includes(a.status)||['submit_professional_job','get_professional_job','wait_professional_job'].includes(name(a))&&(a.result?.executionSucceeded===false||a.result?.verification?.status==='failed');
 const controls=new Set(['wait_for_tasks','wait_threads','route_user_message','start_thread','delegate_task','get_task_assignments','review_task_results']);
 const routine=new Set(['get_engineering_state','record_engineering_object','get_engineering_plan','read_project_memory','update_project_memory']);
 const recoverable=new Set(['update_engineering_plan','update_model']),destination=a=>a.args?.path||a.args?.model?.path||a.args?.modelPath||'',recovered=new Set();
 for(let index=0;index<activities.length;index++){const a=activities[index];if(!recoverable.has(name(a))||!failed(a))continue;if(activities.slice(index+1).some(later=>name(later)===name(a)&&destination(later)===destination(a)&&later.status==='completed'&&!failed(later)&&!later.result?.error))recovered.add(a.id);}
 const important=activities.filter(a=>!recovered.has(a.id)&&a.type!=='thread.routed'&&(failed(a)||!controls.has(name(a))&&(live&&active(a)||!routine.has(name(a))&&(a.kind==='thread'||hasResult(a)))));
 // One logical destination per result, rather than one card per poll/file. Repeated
 // identical failed submits share a visible count; every raw attempt stays in logs.
 const byResult=new Map(),byFailure=new Map(),always=[];
 for(const a of important){
  const result=a.result&&typeof a.result==='object'?a.result:{};
  if(failed(a)){const signature=JSON.stringify([name(a),a.args?.path||a.args?.model||'',result.error||result.reason||a.detail||a.status,result.jobId||result.id||'']);const old=byFailure.get(signature);byFailure.set(signature,old?{...a,repeatedFailureCount:(old.repeatedFailureCount||1)+1}:a);continue;}
  const destination=resultKey(a),key=a.kind==='thread'?'thread:'+a.childThreadId:destination?'result:'+destination:hasResult(a)?'result:'+(result.jobId||result.id||a.args?.jobId||a.args?.path||a.id):null;
  if(key&&!active(a))byResult.set(key,a);else always.push(a);
 }
 const ordered=[...always,...byResult.values(),...byFailure.values()].sort((a,b)=>(a.startedAt||a.finishedAt||a.observedAt||'').localeCompare(b.startedAt||b.finishedAt||b.observedAt||''));
 const completed=ordered.filter(a=>!active(a)&&!failed(a)),keep=new Set(completed.slice(maxCompleted>0?-maxCompleted:completed.length).map(a=>a.id)),shown=ordered.filter(a=>active(a)||failed(a)||keep.has(a.id));
 return {activities:shown,recoveredCount:recovered.size,hiddenActivityCount:ordered.length-shown.length,routes,messages:live?(row.processMessages||[]).slice(-1):[],routineCount:activities.filter(a=>routine.has(name(a))&&!failed(a)&&!active(a)).length};
}

/** A receipt's original prose records its state at delivery time. Its current
 * review label comes from persisted review metadata, without rewriting history. */
export function describeTaskDelivery(activity={}, {taskTitle}={}) {
 if(activity.type!=='thread.result')return null;
 const failed=['failed','error','cancelled','canceled','interrupted'].includes(activity.status);
 const state=activity.branchStatus==='blocked'?'blocked':failed?'failed':activity.reviewStatus||'unreviewed',task=taskTitle?`任务「${taskTitle}」`:'子任务';
 const statusLabel=({accepted:'已复核',needs_work:'需要补充',blocked:'受阻',failed:'执行失败 · 待处理',pending:'待复核',unreviewed:'待复核'})[state]||'待复核';
 const detail=state==='accepted'?`${task}的交付已由上级复核。`:state==='needs_work'?`${task}的交付需要补充，详见复核记录。`:state==='blocked'?`${task}的交接受阻，仍有未闭合事项。`:state==='failed'?`${task}执行失败，不能作为已完成交付。`:`${task}已返回，等待上级复核。`;
 const summary=String(activity.result?.summary||'').replace(/```[\s\S]*?```/g,' [代码片段] ').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*_`~>#]+/g,' ').replace(/\s+/g,' ').trim();
 const characters=[...summary],preview=characters.slice(0,100).join('')+(characters.length>100?'…':'');
 return {title:'子任务交付',statusLabel,detail,preview,rawMessage:String(activity.detail||'')};
}
