import {threadMentionView} from './thread-mentions.mjs';
import {buildTaskTree,taskAncestors} from '../shared/task-tree.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={running:'执行中',executing:'执行中',queued:'排队中',blocked:'受阻',waiting_tasks:'等待子任务',waiting_job:'等待工程作业',preparing_environment:'准备工程环境',reviewing:'复核结果',summarizing:'汇总结果',waiting_approval:'等待批准',awaiting_approval:'等待批准',completed:'已交付',resolved:'已交付',failed:'失败',cancelled:'已停止',interrupted:'已中断',idle:'就绪'};
export function taskStatusLabel(status){return labels[status]||'就绪';}
export function taskReviewPresentation(thread={},executionStatus=thread.executionStatus||thread.status) {
 const pending=Number.isSafeInteger(thread.pendingResultCount)&&thread.pendingResultCount>0?thread.pendingResultCount:0;
 const own=thread.reviewStatus,terminal=['completed','resolved','failed','blocked','cancelled','interrupted','stopped'].includes(executionStatus);
 const label=thread.parentThreadId?(own==='needs_work'?'需要补充':own==='blocked'?'复核受阻':own==='accepted'&&terminal?'交付已复核':['pending','unreviewed'].includes(own)&&terminal?'待上级复核':''):'';
 return {label:[label,pending?`${pending} 项结果待复核`:''].filter(Boolean).join(' · '),attention:['needs_work','blocked'].includes(own),status:own||null};
}
export function renderTaskTree(threads=[],{projectId,mainThreadId,selectedId,statusFor=t=>t.executionStatus||t.status||'idle',collapsed={}}={}){
 const rows=buildTaskTree(threads,{projectId,mainThreadId});
 const render=({thread:t})=>{const status=statusFor(t),review=taskReviewPresentation(t,status);return `<li class="task-node" data-task-id="${esc(t.id)}"><div class="task-node-line ${review.attention?'needs-review-action':''} ${t.id===selectedId?'selected':''}"><button class="task-node-button" data-action="select-thread" data-id="${esc(t.id)}"${t.id===selectedId?' aria-current="true"':''}><span class="task-state ${esc(status)}"></span><span class="task-node-copy"><strong>${esc(t.id===mainThreadId?'Coordinator':t.title||'Thread')}</strong><span>${esc(t.id===mainThreadId&&status==='completed'?'本轮已结束':taskStatusLabel(status))}${review.label?' · '+esc(review.label):''}</span></span><span class="task-open" aria-hidden="true">›</span></button></div></li>`;};
 return rows.length?`<ul class="task-tree" aria-label="项目对话">${rows.map(render).join('')}</ul>`:'<p class="work-empty">在主对话交代目标，工作展开后会出现在这里。</p>';
}
export function renderTaskBreadcrumb(threadId,threads=[],mainThreadId){const chain=taskAncestors(threadId,threads,mainThreadId);return `<nav class="task-breadcrumb" aria-label="对话位置">${chain.map((t,i)=>`${i?'<span aria-hidden="true">›</span>':''}<button data-action="select-thread" data-id="${esc(t.id)}" ${i===chain.length-1?'aria-current="location"':''}>${esc(t.id===mainThreadId?'Coordinator':t.title||'Thread')}</button>`).join('')}</nav>`;}
const stageNames={mission:'任务与场景',requirements:'需求',functions:'功能',architecture:'架构',design:'详细设计',implementation:'实现',integration:'集成',verification:'验证',validation:'确认',operations:'运行',crosscutting:'跨领域工作'};
const planStatus={proposed:'待明确',ready:'可开展',active:'进行中',waiting:'等待依赖',blocked:'受阻',delivered:'已交付，待复核',reviewed:'已复核'};
export function renderEngineeringPlan(plan,{status,error}={}){
 if(error)return `<p role="alert">${esc(error)}</p><button class="button compact" data-action="refresh-engineering-plan">重试</button>`;
 if(!plan)return '<p class="work-empty">正在读取工程计划…</p>';
 const items=Array.isArray(plan.items)?plan.items:[],byId=new Map(items.map(i=>[i.id,i]));
 if(!items.length)return '<p class="work-empty">尚未建立工程计划。可以直接在主对话交代开发目标，Agent 会根据资料展开工作与验证安排。</p>';
 const names=ids=>(Array.isArray(ids)?ids:[]).map(id=>byId.get(id)?.title||id);
 const list=values=>(Array.isArray(values)?values:values?[values]:[]).map(v=>typeof v==='string'?v:v?.description||v?.title||'').filter(Boolean);
 const text=value=>list(value).map(esc).join('；');
 return `<div class="engineering-plan" data-plan-revision="${esc(plan.revision)}">${plan.goal?`<p class="plan-goal">${esc(typeof plan.goal==='string'?plan.goal:plan.goal?.description||plan.goal?.title||'')}</p>`:''}<p class="plan-context">工作与验证对应持续更新；任务交付不等于工程批准。</p>${list(plan.openQuestions).length?`<details class="plan-questions" open><summary>待确定 · ${list(plan.openQuestions).length}</summary><ul>${list(plan.openQuestions).map(v=>`<li>${esc(v)}</li>`).join('')}</ul></details>`:''}${Object.entries(stageNames).map(([stage,label])=>{const group=items.filter(i=>i.stage===stage);return group.length?`<section class="plan-stage"><h3>${label}</h3>${group.map(item=>{const v=item.verification||{},parent=byId.get(item.parentId),needs=names(item.dependsOn);return `<article class="plan-item" data-plan-item="${esc(item.id)}"><div class="plan-item-heading"><strong>${esc(item.title||item.id)}</strong><span>${esc(planStatus[item.status]||'待明确')}</span></div>${parent?`<p>上级：${esc(parent.title)}</p>`:''}${needs.length?`<p>依赖：${needs.map(esc).join('、')}</p>`:''}${item.threadId||item.task?.threadId?`<button class="button ghost compact" data-action="select-thread" data-id="${esc(item.threadId||item.task.threadId)}">打开负责线程${item.task?' · '+esc(taskStatusLabel(item.task.executionPhase||item.task.executionStatus||item.task.status)):''}</button>`:''}<details><summary>交付与验证</summary><dl>${text(item.deliverables)?`<dt>交付</dt><dd>${text(item.deliverables)}</dd>`:''}${v.method?`<dt>验证方法</dt><dd>${esc(v.method)}</dd>`:''}${names(v.requirementIds).length?`<dt>对应需求</dt><dd>${names(v.requirementIds).map(esc).join('、')}</dd>`:''}${text(v.acceptanceCriteria)?`<dt>接受条件</dt><dd>${text(v.acceptanceCriteria)}</dd>`:''}<dt>证据</dt><dd>${v.evidenceIds?.length?`${v.evidenceIds.length} 项关联证据（有效性须复核）`:'尚未关联证据'}</dd></dl>${(item.artifactIds||[]).map(id=>`<button class="button compact" data-action="read-artifact" data-id="${esc(id)}">查看产物</button>`).join('')}${(item.modelPaths||[]).map(path=>`<button class="button compact" data-action="view-result-file" data-path="${esc(path)}">${esc(path.split('/').at(-1))}</button>`).join('')}</details></article>`;}).join('')}</section>`:'';}).join('')}</div>`;
}

export function threadOverviewGroup(thread={},status=thread.executionStatus||thread.status||'idle',{pendingApproval=false}={}) {
 if(pendingApproval||['waiting_approval','awaiting_approval','failed','error','blocked','interrupted'].includes(status))return 'attention';
 if(['running','executing','started','queued','waiting_tasks','waiting_job','preparing_environment','reviewing','summarizing','waiting','pending'].includes(status))return 'working';
 if(['completed','resolved'].includes(status))return ['needs_work','blocked'].includes(thread.reviewStatus)?'attention':'resolved';
 return 'idle';
}
function summaryText(value){return String(value||'').replace(/!?(\[[^\]]*\])\([^)]*\)/g,'$1').replace(/[`#*_]+/g,'').replace(/\s+/g,' ').trim().slice(0,180);}
export function threadPublicSummary(thread={},status=thread.executionStatus||thread.status||'idle'){
 const publicSummary=typeof thread.latestPublicSummary==='string'?thread.latestPublicSummary:thread.latestPublicSummary?.text;
 if(publicSummary)return summaryText(publicSummary);
 const waiting=Array.isArray(thread.waitingFor?.tasks)?thread.waitingFor.tasks:Array.isArray(thread.dependencies)?thread.dependencies:[];
 if(status==='waiting_tasks'&&waiting.length){const titles=waiting.map(t=>t.title).filter(Boolean);if(titles.length)return '等待 '+titles.slice(0,2).join('、')+(titles.length>2?`等 ${titles.length} 个 Thread`:'');}
 if(['completed','resolved','failed','interrupted','stopped','cancelled'].includes(status)&&thread.lastResult)return summaryText(thread.lastResult);
 return taskStatusLabel(status);
}
export function threadOverviewGroups(threads=[],{projectId,mainThreadId,statusFor=t=>t.executionStatus||t.status||'idle',pendingApprovalFor=()=>false}={}){
 const groups=[{id:'attention',label:'需要你处理',threads:[]},{id:'working',label:'进行中',threads:[]},{id:'idle',label:'待命',threads:[]},{id:'resolved',label:'已完成',threads:[]}];
 for(const thread of threads){if(!thread||thread.id===mainThreadId||thread.kind==='coordinator'||projectId&&thread.projectId!==projectId)continue;const status=statusFor(thread),view=threadMentionView({...thread,executionStatus:status}),group=threadOverviewGroup(thread,status,{pendingApproval:pendingApprovalFor(thread)});groups.find(g=>g.id===group).threads.push({thread,status,indicator:view?.indicator||'idle',label:view?.label||taskStatusLabel(status),summary:[view?.label||taskStatusLabel(status),taskStatusLabel(status)].includes(threadPublicSummary(thread,status))?'':threadPublicSummary(thread,status)});}
 return groups;
}
export function renderThreadsOverview(threads=[],{projectId,mainThreadId,statusFor,pendingApprovalFor,openGroups={}}={}){
 const groups=threadOverviewGroups(threads,{projectId,mainThreadId,statusFor,pendingApprovalFor});
 return `<div class="threads-overview" aria-label="Threads 状态概览">${groups.map(group=>{const open=group.threads.length>0&&(Object.hasOwn(openGroups,group.id)?openGroups[group.id]:group.id!=='resolved');return `<details class="thread-group overview-group" data-thread-count="${group.threads.length}" data-thread-group="${group.id}" data-thread-project="${esc(projectId)}" ${open?'open':''}><summary><span>${group.label}</span><small>${group.threads.length}</small></summary><div class="thread-group-body">${group.threads.map(({thread,indicator,label,summary})=>`<button class="overview-thread-row" data-action="select-thread" data-id="${esc(thread.id)}" title="${esc(thread.title+' · '+label)}"><span class="thread-mention-indicator indicator-${esc(indicator)}" aria-hidden="true">${({spinner:'',clock:'◷',approval:'!',check:'✓',error:'!',idle:'·'})[indicator]??'·'}</span><span class="overview-thread-copy"><span class="overview-thread-title"><strong>${esc(thread.title)}</strong></span>${summary?`<span class="overview-thread-summary">${esc(summary)}</span>`:''}</span><span class="overview-thread-status">${esc(label)}</span></button>`).join('')||''}</div></details>`;}).join('')}</div>`;
}

export function overviewActivityIndicator(groups=[]) {
 const working=groups.find(g=>g.id==='working')?.threads||[],attention=groups.find(g=>g.id==='attention')?.threads||[];
 return working.some(t=>t.indicator==='spinner')?'spinner':working.length?'clock':attention.some(t=>t.indicator==='approval')?'approval':attention.length?'error':'idle';
}
