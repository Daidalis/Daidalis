import {createHash} from 'node:crypto';
import path from 'node:path';

const controlCharacters=/[\x00-\x1f\x7f]/;
function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${label} must be an object`);return value;}
function text(value,label,max,{multiline=false}={}){
  if(typeof value!=='string'||!value.trim()||value.length>max||(multiline?/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value):controlCharacters.test(value)))throw new Error(`${label} must be nonempty text up to ${max} characters${multiline?'':' without control characters'}`);
  return value.trim();
}
function textList(value,label,{maxItems=40,maxLength=2000}={}){
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>maxItems)throw new Error(`${label} must be an array with at most ${maxItems} entries`);
  return [...new Set(value.map((entry,index)=>text(entry,`${label}[${index}]`,maxLength,{multiline:true})))];
}
function ownedPath(value,index){
  const raw=text(value,`ownedPaths[${index}]`,500);
  if(path.posix.isAbsolute(raw)||path.win32.isAbsolute(raw)||/[\\:*?\[\]{}]/.test(raw)||raw.split('/').includes('..'))throw new Error('ownedPaths must be project-relative paths without traversal, backslashes or globs');
  const normalized=path.posix.normalize(raw).replace(/\/+$/,'');
  if(!normalized||normalized==='.'||normalized==='..'||normalized.startsWith('../'))throw new Error('ownedPaths cannot claim the project root');
  return normalized;
}

// Contracts describe task ownership and expected evidence; they do not grant permissions.
export function normalizeTaskContract(args){
  object(args,'Task arguments');
  const task=text(args.task,'Task',30000,{multiline:true});
  let taskKey;
  if(args.taskKey===undefined){const normalized=task.normalize('NFC').toLowerCase().replace(/\s+/gu,' ');taskKey='task:'+createHash('sha256').update(normalized).digest('hex').slice(0,24);}
  else {taskKey=text(args.taskKey,'taskKey',160);if(!/^[\p{L}\p{N}][\p{L}\p{N}._:-]*$/u.test(taskKey))throw new Error('taskKey must contain only letters, numbers, dots, underscores, colons or hyphens');}
  const scope=args.scope===undefined||(typeof args.scope==='string'&&!args.scope.trim())?task:text(args.scope,'scope',30000,{multiline:true});
  if(args.ownedPaths!==undefined&&(!Array.isArray(args.ownedPaths)||args.ownedPaths.length>40))throw new Error('ownedPaths must be an array with at most 40 entries');
  const workKind=args.workKind===undefined?undefined:text(args.workKind,'workKind',80);
  if(workKind!==undefined&&workKind!=='public_sources')throw new Error('workKind must be public_sources when specified');
  return {taskKey,scope,deliverables:textList(args.deliverables,'deliverables'),ownedPaths:[...new Set((args.ownedPaths||[]).map(ownedPath))],acceptanceCriteria:textList(args.acceptanceCriteria,'acceptanceCriteria'),...(workKind?{workKind}:{})};
}

export function overlappingTaskPaths(aPaths, bPaths) {
  if (!Array.isArray(aPaths) || !Array.isArray(bPaths)) {
    throw new Error('Task paths must be arrays');
  }
  return aPaths.some(a =>
    bPaths.some(b => a !== b || a.startsWith(b + '/') || b.startsWith(a + '/'))
  );
}

export function normalizeWaitThreadsArgs(args){
  object(args,'Wait arguments');
  const result={mode:args.mode===undefined?'all':args.mode};
  if(!['all','any'].includes(result.mode))throw new Error('mode must be all or any');
  if(args.threadIds!==undefined){
    if(!Array.isArray(args.threadIds)||!args.threadIds.length||args.threadIds.length>100)throw new Error('threadIds must contain 1–100 thread IDs, or be omitted for own assignments');
    result.threadIds=[...new Set(args.threadIds.map((entry,index)=>text(entry,`threadIds[${index}]`,200)))];
  }
  if(args.reason!==undefined)result.reason=text(args.reason,'reason',2000,{multiline:true});
  if(args.timeoutMs!==undefined){if(!Number.isInteger(args.timeoutMs)||args.timeoutMs<1||args.timeoutMs>1800000)throw new Error('timeoutMs must be an integer from 1 to 1800000');result.timeoutMs=args.timeoutMs;}
  return result;
}

export function normalizeReviewEntries(reviews){
  if(!Array.isArray(reviews)||!reviews.length||reviews.length>100)throw new Error('reviews must contain 1–100 result reviews');
  const seen=new Set();
  return reviews.map((entry,index)=>{
    object(entry,`reviews[${index}]`);
    const threadId=text(entry.threadId,`reviews[${index}].threadId`,200),runId=text(entry.runId,`reviews[${index}].runId`,200),key=threadId+'\0'+runId;
    if(seen.has(key))throw new Error('A task result can be reviewed only once in each review call');seen.add(key);
    if(!['accepted','needs_work','blocked'].includes(entry.outcome))throw new Error('Review outcome must be accepted, needs_work or blocked');
    const findings=text(entry.findings,`reviews[${index}].findings`,10000,{multiline:true}),evidence=textList(entry.evidence,`reviews[${index}].evidence`,{maxItems:100,maxLength:2000});
    if(entry.outcome==='accepted'&&!evidence.length)throw new Error('Accepted task results require at least one evidence reference');
    return {threadId,runId,outcome:entry.outcome,findings,evidence};
  });
}
