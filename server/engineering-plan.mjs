// A durable engineering work graph. It references the engineering ledger and task
// registry; it is neither a second requirements database nor an approval system.
const SCHEMA = 'manta-engineering-plan-v1';
export const ENGINEERING_PLAN_STAGES = Object.freeze(['mission','requirements','functions','architecture','design','implementation','integration','verification','validation','operations','crosscutting']);
export const ENGINEERING_PLAN_STATUSES = Object.freeze(['proposed','ready','active','waiting','blocked','delivered','reviewed']);
const clone = value => JSON.parse(JSON.stringify(value));
const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
function text(value, name, max = 2000, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) fail(400, `${name} must be nonempty text up to ${max} characters.`);
  return value.trim();
}
function obj(value, name, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, `${name} must be an object.`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(400, `Unknown ${name} field: ${key}.`);
  return value;
}
function strings(value, name, maxItems = 50, maxLength = 2000) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) fail(400, `${name} must contain at most ${maxItems} entries.`);
  return [...new Set(value.map(v => text(v, name, maxLength)))];
}
function identifier(value, name, optional = false) {
  const v = text(value, name, 160, optional);
  if (v && !/^[\p{L}\p{N}][\p{L}\p{N}._:-]*$/u.test(v)) fail(400, `${name} must be a stable identifier.`);
  return v;
}
function paths(value) {
  return strings(value, 'modelPaths', 30, 1000).map(v => {
    if (/^(?:[\/\\~]|[A-Za-z]:)/.test(v) || v.includes('\\') || v.split('/').some(p => !p || p === '.' || p === '..') || v.split('/').some(p => /^(?:\.git|\.ssh|\.aws|\.codex|\.agents|node_modules|\.venv|venv)$/i.test(p) || /^\.env(?:\.|$)/i.test(p))) fail(400, 'modelPaths must be project-relative model paths without traversal, credentials or dependency folders.');
    return v;
  });
}
function graphCycle(items, next, label) {
  const byId = new Map(items.map(i => [i.id, i])), visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) fail(400, `${label} contains a cycle at ${id}. Rework is a new revision, not a cyclic prerequisite.`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const target of next(byId.get(id))) visit(target);
    visiting.delete(id); visited.add(id);
  }
  for (const item of items) visit(item.id);
}
export function normalizeEngineeringPlan(input) {
  obj(input, 'engineering plan', ['goal','sources','assumptions','openQuestions','items']);
  if (!Array.isArray(input.items) || input.items.length > 120) fail(400, 'items must be an array with at most 120 work items.');
  const items = input.items.map(raw => {
    obj(raw, 'work item', ['id','title','description','parentId','dependsOn','stage','status','taskKey','threadId','recordIds','artifactIds','modelPaths','deliverables','verification','review','maturity','task','waitingFor']);
    if (raw.maturity !== undefined && raw.maturity !== 'candidate') fail(400, 'Planning records remain candidate; work review is not engineering approval.');
    const item = {id:identifier(raw.id,'item id'),title:text(raw.title,'item title',500),description:text(raw.description,'description',6000,true),parentId:identifier(raw.parentId,'parentId',true)||null,dependsOn:strings(raw.dependsOn,'dependsOn',120,160),stage:raw.stage||'crosscutting',status:raw.status||'proposed',taskKey:identifier(raw.taskKey,'taskKey',true)||null,threadId:identifier(raw.threadId,'threadId',true)||null,recordIds:strings(raw.recordIds,'recordIds',100,160),artifactIds:strings(raw.artifactIds,'artifactIds',50,200),modelPaths:paths(raw.modelPaths),deliverables:strings(raw.deliverables,'deliverables',40,2000),verification:{method:'',acceptanceCriteria:[],requirementIds:[],evidenceIds:[]},review:null,maturity:'candidate'};
    if (!ENGINEERING_PLAN_STAGES.includes(item.stage)) fail(400, 'Unknown work item stage.');
    if (!ENGINEERING_PLAN_STATUSES.includes(item.status)) fail(400, 'Unknown work item status. Work delivery cannot be marked engineering-approved or verified.');
    if (raw.verification !== undefined) {
      const v = obj(raw.verification,'verification',['method','acceptanceCriteria','requirementIds','evidenceIds']);
      item.verification = {method:text(v.method,'verification method',2000,true),acceptanceCriteria:strings(v.acceptanceCriteria,'acceptanceCriteria',40,2000),requirementIds:strings(v.requirementIds,'requirementIds',100,160),evidenceIds:strings(v.evidenceIds,'evidenceIds',80,200)};
    }
    if (raw.review !== undefined && raw.review !== null) {
      const r = obj(raw.review,'review',['findings','evidenceIds']);
      item.review = {findings:text(r.findings,'review findings',6000),evidenceIds:strings(r.evidenceIds,'review evidenceIds',80,200)};
    }
    if (item.status === 'reviewed' && (!item.review?.findings || !item.review.evidenceIds.length)) fail(400, 'A reviewed work item needs findings and recorded evidence references. This is a work-product review, never engineering approval.');
    return item;
  });
  const ids = new Set(items.map(i=>i.id));
  if (ids.size !== items.length) fail(400, 'Work item IDs must be unique.');
  for (const item of items) {
    for (const target of [...(item.parentId?[item.parentId]:[]),...item.dependsOn]) if (!ids.has(target)) fail(400, `Work item ${item.id} references missing item ${target}.`);
  }
  graphCycle(items,i=>i.parentId?[i.parentId]:[],'Work hierarchy');
  graphCycle(items,i=>i.dependsOn,'Work dependencies');
  const plan = {goal:text(input.goal,'goal',6000),sources:strings(input.sources,'sources',80,2000),assumptions:strings(input.assumptions,'assumptions',80,2000),openQuestions:strings(input.openQuestions,'openQuestions',100,2000),items};
  if (JSON.stringify(plan).length > 240000) fail(413, 'Engineering plan is too large.');
  return plan;
}
export function createEngineeringPlanService({store,emit=()=>{}}) {
  if (!store?.data || typeof store.save !== 'function') throw new Error('Engineering plan requires a persistent project store.');
  if (!Array.isArray(store.data.engineeringPlans)) store.data.engineeringPlans = [];
  function project(projectId) { if (!store.data.projects?.some(p=>p.id===projectId)) fail(404,'Project not found.'); }
  function stored(projectId) { project(projectId); return store.data.engineeringPlans.find(p=>p.projectId===projectId); }
  function contextualize(plan) {
    const result = clone(plan), threads = store.data.threads||[], runs = store.data.runs||[];
    for (const item of result.items) {
      const thread = item.threadId ? threads.find(t=>t.projectId===plan.projectId&&t.id===item.threadId) : item.taskKey ? threads.find(t=>t.projectId===plan.projectId&&t.taskContract?.taskKey===item.taskKey) : null;
      const run = thread && runs.filter(r=>r.threadId===thread.id).at(-1);
      item.task = thread ? {threadId:thread.id,title:thread.title,status:thread.status,...(run?{runId:run.id,executionStatus:run.status,executionPhase:run.executionPhase||null}:{})} : null;
      item.waitingFor = item.dependsOn.filter(id=>result.items.find(p=>p.id===id)?.status!=='reviewed');
    }
    result.scope = 'Engineering work planning and work-product review. Candidate planning records do not approve requirements, validate a spacecraft or close physical evidence gaps.';
    return result;
  }
  function get(projectId) {
    const current = stored(projectId);
    return contextualize(current||{schema:SCHEMA,projectId,revision:0,goal:'',sources:[],assumptions:[],openQuestions:[],items:[],maturity:'candidate'});
  }
  function verifyReferences(projectId,plan) {
    const records=(store.data.engineeringStates||[]).find(s=>s.projectId===projectId), ids=new Set((records?.objects||[]).filter(o=>!o.deletedAt).map(o=>o.id));
    const evidenceIds=new Set([...(records?.evidence||[]).map(e=>e.id),...(store.data.events||[]).filter(e=>e.projectId===projectId&&e.type==='tool.completed').map(e=>e.id)]);
    const artifacts=new Set((store.data.artifacts||[]).filter(a=>a.projectId===projectId).map(a=>a.id));
    for(const item of plan.items) {
      if(item.threadId){
        const thread=(store.data.threads||[]).find(t=>t.projectId===projectId&&t.id===item.threadId);
        if(!thread)fail(400,`Unknown project thread: ${item.threadId}.`);
        if(item.taskKey&&thread.taskContract?.taskKey!==item.taskKey)fail(400,`Task key ${item.taskKey} does not match the referenced thread assignment.`);
      }
      for(const id of [...item.recordIds,...item.verification.requirementIds])if(!ids.has(id))fail(400,`Unknown engineering record: ${id}. Create or inspect the sourced record first.`);
      for(const id of item.artifactIds)if(!artifacts.has(id))fail(400,`Unknown project artifact: ${id}.`);
      for(const id of [...item.verification.evidenceIds,...(item.review?.evidenceIds||[])])if(!evidenceIds.has(id)&&!artifacts.has(id))fail(400,`Unknown recorded evidence: ${id}. A path or claimed pass is not an evidence ID.`);
    }
  }
  function update(projectId,input,{actor={kind:'agent'}}={}) {
    project(projectId);
    obj(input,'update',['expectedRevision','goal','sources','assumptions','openQuestions','items','schema','projectId','revision','maturity','createdAt','updatedAt','updatedBy','scope']);
    if (input.schema !== undefined && input.schema !== SCHEMA) fail(400,'Unknown engineering plan schema.');
    if (input.projectId !== undefined && input.projectId !== projectId) fail(400,'Engineering plan project mismatch.');
    if (input.maturity !== undefined && input.maturity !== 'candidate') fail(400,'Engineering plan cannot approve requirements or the system.');
    if (input.revision !== undefined && input.revision !== input.expectedRevision) fail(400,'Read revision and expectedRevision must agree.');
    if(!Number.isInteger(input.expectedRevision)||input.expectedRevision<0)fail(400,'expectedRevision must be a nonnegative integer (0 for a new plan).');
    if(!actor||!['agent','user','system'].includes(actor.kind))fail(400,'Invalid plan actor.');
    const previous=stored(projectId),revision=previous?.revision||0;
    if(input.expectedRevision!==revision)fail(409,'Engineering plan changed; read get_engineering_plan and merge before retrying.');
    const data=Object.fromEntries(['goal','sources','assumptions','openQuestions','items'].filter(key=>Object.hasOwn(input,key)).map(key=>[key,input[key]])),plan=normalizeEngineeringPlan(data);
    verifyReferences(projectId,plan);
    const at=new Date().toISOString(),current={schema:SCHEMA,projectId,...plan,revision:revision+1,maturity:'candidate',createdAt:previous?.createdAt||at,updatedAt:at,updatedBy:{kind:actor.kind,...(actor.id?{id:text(actor.id,'actor id',200)}:{})}};
    const index=store.data.engineeringPlans.findIndex(p=>p.projectId===projectId);
    if(index<0)store.data.engineeringPlans.push(current);else store.data.engineeringPlans[index]=current;
    try{store.save();}catch(e){if(index<0)store.data.engineeringPlans.pop();else store.data.engineeringPlans[index]=previous;throw e;}
    try{emit({projectId,type:'engineering.plan.updated',message:'工程计划已更新',data:{revision:current.revision,items:current.items.length}});}catch{/* Already persisted. */}
    return contextualize(current);
  }
  return {get,update};
}
