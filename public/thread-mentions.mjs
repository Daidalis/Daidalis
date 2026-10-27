// Assistant prose references only. Membership and live state come from persisted
// thread records; message wording never invents a task, status or permission.
const ID = /^thread_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PREFIX = '#manta-thread:';
const protectedSelector = 'pre,code,a,button,input,textarea,select,option,script,style,[contenteditable],[data-thread-mention-invalid],.message.user,[data-message-origin="user"]';
function indexThreads(threads,projectId) {
  const all = new Map(), byTitle = new Map(), byId = new Map();
  if(typeof projectId!=='string'||!projectId.trim())return {byId,byTitle};
  for(const thread of Array.isArray(threads)?threads:[]) {
    if(!thread || typeof thread.id!=='string' || !ID.test(thread.id)) continue;
    const list=all.get(thread.id)||[];list.push(thread);all.set(thread.id,list);
  }
  for(const [id,rows] of all) {
    // Duplicate identities are ambiguous even if a stale copy has a familiar title.
    if(rows.length!==1)continue;
    const thread=rows[0],title=typeof thread.title==='string'?thread.title.trim():'';
    if(thread.projectId!==projectId||!title||title.length>500||/[\x00-\x1f\x7f]/.test(title))continue;
    byId.set(id,thread);const list=byTitle.get(title)||[];list.push(thread);byTitle.set(title,list);
  }
  return {byId,byTitle};
}
export function threadMentionView(thread) {
  if(!thread || !ID.test(thread.id||''))return null;
  const declared=thread.executionStatus||thread.status||'idle';
  const terminal=['completed','resolved','failed','error','blocked','interrupted','cancelled','canceled','stopped'];
  const phase=thread.executionPhase;
  // A precise native phase refines a generic live status, never a terminal result.
  const raw=!terminal.includes(declared)&&['idle','open','running','executing','started'].includes(declared)&&phase?phase:declared;
  const active=!Object.hasOwn(thread,'activeRunId')||Boolean(thread.activeRunId);
  let status=raw,indicator='idle',label='就绪';
  if(['executing','running','started','reviewing','summarizing'].includes(raw)) {
    indicator=active?'spinner':'clock';
    label=raw==='reviewing'?(active?'复核结果':'待复核'):raw==='summarizing'?(active?'汇总结果':'待汇总'):(active?'执行中':'待执行');
  } else if(['waiting_tasks','waiting_job','preparing_environment','queued','waiting','pending'].includes(raw)) {
    indicator='clock';label=({waiting_tasks:'等待子任务',waiting_job:'等待工程作业',preparing_environment:'准备工程环境',queued:'排队中'})[raw]||'等待中';
  } else if(['waiting_approval','awaiting_approval'].includes(raw)) {
    indicator='approval';label='等待批准';
  } else if(['completed','resolved'].includes(raw)) {
    indicator='check';label='已交付';
    if(thread.kind!=='coordinator'&&thread.reviewStatus==='unreviewed')label='已交付，待复核';
    if(thread.reviewStatus==='needs_work'){indicator='error';label='需要补充';}
    if(thread.reviewStatus==='blocked'){indicator='error';label='复核受阻';}
  } else if(['failed','error','blocked','interrupted'].includes(raw)) {
    indicator='error';label=({failed:'失败',error:'失败',blocked:'受阻',interrupted:'已中断'})[raw];
  } else if(['cancelled','canceled','stopped'].includes(raw)) {
    indicator='idle';label='已停止';
  } else status='idle';
  const title=String(thread.title||'Thread').trim();
  return {threadId:thread.id,title,executionStatus:status,label,indicator,ariaLabel:title+' · '+label};
}
export function resolveThreadMention(href,{threads=[],projectId}={}) {
  if(typeof href!=='string'||!href.startsWith(PREFIX))return null;
  const threadId=href.slice(PREFIX.length);
  if(!ID.test(threadId)||href!==PREFIX+threadId)return null;
  const thread=indexThreads(threads,projectId).byId.get(threadId);
  return thread?threadMentionView(thread):null;
}
export function threadMentionHref(threadId,{threads=[],projectId}={}) {
  return resolveThreadMention(PREFIX+threadId,{threads,projectId})?PREFIX+threadId:null;
}
function protectedRanges(source) {
  const ranges=[];
  // Conservative protection also makes this pure helper safe on unparsed prose.
  for(const pattern of [/(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1[^\n]*(?:\n|$)|$)/g,/(`+)[\s\S]*?\1/g,/!?\[[^\]\n]*\]\([^\n)]*\)/g,/(?:[a-z][a-z\d+.-]*:\/\/|www\.)[^\s<>]+/gi,/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi]) {
    for(const match of source.matchAll(pattern))ranges.push([match.index,match.index+match[0].length]);
  }
  return ranges;
}
function shortBoundary(source,start,end,title) {
  const before=source[start-1]||'',after=source[end]||'';
  // Latin fragments must not turn parts of filenames/identifiers into references.
  if(/^[a-z\d_]/i.test(title)&&/[a-z\d_./\\-]/i.test(before))return false;
  if(/[a-z\d_]$/i.test(title)&&/[a-z\d_./\\-]/i.test(after))return false;
  // Short generic names require a visible word/quotation boundary.
  if([...title].length<4&&(/[\p{L}\p{N}_]/u.test(before)||/[\p{L}\p{N}_]/u.test(after)))return false;
  return true;
}
export function threadMentionMatches(value,{threads=[],projectId}={}) {
  if(typeof value!=='string'||!value)return [];
  const {byTitle}=indexThreads(threads,projectId),ranges=protectedRanges(value),candidates=[];
  for(const [title,rows] of byTitle) {
    if(rows.length!==1||[...title].length<2)continue;
    let from=0;
    while(from<value.length) {
      const start=value.indexOf(title,from);if(start<0)break;
      const end=start+title.length;from=end;
      if(ranges.some(([a,b])=>start<b&&end>a)||!shortBoundary(value,start,end,title))continue;
      candidates.push({start,end,text:title,...threadMentionView(rows[0])});
    }
  }
  candidates.sort((a,b)=>a.start-b.start||b.end-a.end);
  const result=[];let end=-1;
  for(const match of candidates)if(match.start>=end){result.push(match);end=match.end;}
  return result;
}
function buttonFor(doc,view) {
  const button=doc.createElement('button');button.type='button';button.className='thread-mention';
  button.dataset.action='select-thread';button.dataset.id=view.threadId;
  button.dataset.threadIndicator=view.indicator;button.dataset.threadStatus=view.executionStatus;
  button.setAttribute('title',view.ariaLabel);button.setAttribute('aria-label',view.ariaLabel);
  const indicator=doc.createElement('span');indicator.className='thread-mention-indicator indicator-'+view.indicator;indicator.setAttribute('aria-hidden','true');
  indicator.textContent=({spinner:'',clock:'◷',approval:'!',check:'✓',error:'!',idle:'·'})[view.indicator];
  const title=doc.createElement('span');title.className='thread-mention-title';title.textContent=view.title;
  button.append(indicator,title);return button;
}
function inertText(doc,text) {const span=doc.createElement('span');span.dataset.threadMentionInvalid='true';span.textContent=text;return span;}
/** Call after rendering message HTML and after a thread-state refresh. This changes
 * only assistant message bodies, never users, source/code, existing ordinary links
 * or raw tool logs. Repeated calls refresh status without nesting references. */
export function enrichThreadMentions(root,{threads=[],projectId,allowTitleMatches=true}={}) {
  const doc=root?.ownerDocument;
  if(!root||!doc?.createElement||!root.querySelectorAll)return {created:0,updated:0,invalid:0};
  const options={threads,projectId},counts={created:0,updated:0,invalid:0};
  const bodies=[...(root.matches?.('.message.assistant .message-body')?[root]:[]),...root.querySelectorAll('.message.assistant .message-body')];
  const seen=new Set();
  for(const body of bodies) {
    if(seen.has(body)||body.closest('.message.user,[data-message-origin="user"]'))continue;seen.add(body);
    for(const button of body.querySelectorAll('button.thread-mention[data-id]')) {
      const view=resolveThreadMention(PREFIX+button.dataset.id,options);
      if(view){button.replaceWith(buttonFor(doc,view));counts.updated++;}
      else{button.replaceWith(inertText(doc,button.textContent));counts.invalid++;}
    }
    for(const anchor of body.querySelectorAll('a[href]')) {
      const href=anchor.getAttribute('href');if(!href?.startsWith(PREFIX))continue;
      if(anchor.closest('pre,code,.message.user,[data-message-origin="user"]'))continue;
      const view=resolveThreadMention(href,options);
      if(view){anchor.replaceWith(buttonFor(doc,view));counts.created++;}
      else{anchor.replaceWith(inertText(doc,anchor.textContent));counts.invalid++;}
    }
    if(!allowTitleMatches)continue;
    const walker=doc.createTreeWalker(body,4),nodes=[];let node;
    while((node=walker.nextNode()))if(!node.parentElement?.closest(protectedSelector))nodes.push(node);
    for(const textNode of nodes) {
      const value=textNode.nodeValue||'',matches=threadMentionMatches(value,options);if(!matches.length)continue;
      const fragment=doc.createDocumentFragment();let offset=0;
      for(const match of matches){if(match.start>offset)fragment.append(doc.createTextNode(value.slice(offset,match.start)));fragment.append(buttonFor(doc,match));offset=match.end;counts.created++;}
      if(offset<value.length)fragment.append(doc.createTextNode(value.slice(offset)));
      textNode.replaceWith(fragment);
    }
  }
  return counts;
}
