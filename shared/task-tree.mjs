/** Flat conversation list. Historical nested parent IDs never produce a third UI level. */
export function buildTaskTree(threads=[],{projectId,mainThreadId}={}) {
 const records=[...new Map(threads.filter(thread=>thread&&typeof thread.id==='string'&&thread.id&&(!projectId||thread.projectId===projectId)).map(thread=>[thread.id,thread])).values()];
 return records.sort((a,b)=>Number(b.id===mainThreadId)-Number(a.id===mainThreadId)).map(thread=>({thread,children:[],detached:false}));
}
export function taskAncestors(threadId,threads=[],mainThreadId) {
 const byId=new Map(threads.map(thread=>[thread.id,thread])),thread=byId.get(threadId);
 if(!thread)return [];
 const coordinator=byId.get(mainThreadId)||threads.find(row=>row?.projectId===thread.projectId&&row.kind==='coordinator');
 return coordinator&&coordinator.id!==thread.id?[coordinator,thread]:[thread];
}

/** Merge public task records while a project/thread detail is still loading. */
export function mergeTaskRecords({globalThreads=[],detail=null,projectThreads=[],sideThread=null,sideThreadId=null}={}) {
 const list=value=>Array.isArray(value)?value:[];
 return [...new Map([...list(globalThreads),...list(detail?.childThreads),...(sideThread&&sideThread.id===sideThreadId?[sideThread]:[]),...list(projectThreads)].filter(t=>t&&typeof t.id==='string').map(t=>[t.id,t])).values()];
}
