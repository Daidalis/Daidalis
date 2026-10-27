import test from 'node:test';
import assert from 'node:assert/strict';
import {threadMentionView,resolveThreadMention,threadMentionHref,threadMentionMatches,enrichThreadMentions} from '../public/thread-mentions.mjs';
import {renderMarkdown} from '../public/document-viewer.mjs';
import {ENGINEERING_ENTRY_GUIDANCE} from '../server/engineering-entry-guidance.mjs';
const idA='thread_11111111-1111-1111-1111-111111111111';
const idB='thread_22222222-2222-2222-2222-222222222222';
const idC='thread_33333333-3333-3333-3333-333333333333';
const worker={id:idA,projectId:'p',kind:'worker',title:'星敏源码审查',executionStatus:'running',activeRunId:'run-real'};
const second={id:idB,projectId:'p',kind:'worker',title:'通信与数据交付',executionStatus:'waiting_tasks',activeRunId:'run-parent'};
const context={projectId:'p',threads:[worker,second]};
const href=id=>'#manta-thread:'+id;

test('explicit task references resolve only exact known same-project IDs',()=>{
 assert.equal(resolveThreadMention(href(idA),context)?.threadId,idA);
 assert.equal(threadMentionHref(idA,context),href(idA));
 for(const bad of [href(idC),href(idA)+'?q=1',href(idA)+'#extra',href(idA)+' ',href(idA)+'\n',href(idA.replace('thread_','thread%5F')),href('../'+idA),'manta-thread:'+idA,'https://example.test/'+href(idA),href('thread_guess')]){
  assert.equal(resolveThreadMention(bad,context),null,bad);
 }
 assert.equal(resolveThreadMention(href(idA),{...context,projectId:'other'}),null);
 assert.equal(resolveThreadMention(href(idA),{threads:context.threads}),null);
 assert.equal(resolveThreadMention(href(idA),{...context,threads:[worker,{...worker,projectId:'foreign'}]}),null);
 assert.equal(threadMentionHref(idC,context),null);
});

test('a duplicate title is ambiguous for prose matching but stable explicit IDs still work',()=>{
 const options={projectId:'p',threads:[worker,{...second,title:worker.title},{...worker,id:idC,projectId:'q'}]};
 assert.deepEqual(threadMentionMatches(worker.title,options),[]);
 assert.equal(resolveThreadMention(href(idB),options)?.threadId,idB);
 assert.deepEqual(threadMentionMatches('foreign',{projectId:'p',threads:[{...second,projectId:'q',title:'foreign'}]}),[]);
 assert.equal(resolveThreadMention(href(idA),{projectId:'p',threads:[{...worker,title:'unsafe\nname'}]}),null);
});

test('live indicators distinguish executing from all waits and missing active work',()=>{
 const view=(change={})=>threadMentionView({...worker,...change});
 assert.equal(view().indicator,'spinner');
 for(const [executionStatus,label,indicator]of [
  ['waiting_tasks','等待子任务','clock'],['waiting_job','等待工程作业','clock'],
  ['preparing_environment','准备工程环境','clock'],['queued','排队中','clock'],
  ['waiting_approval','等待批准','approval'],['awaiting_approval','等待批准','approval']
 ]){
  assert.deepEqual([view({executionStatus}).label,view({executionStatus}).indicator],[label,indicator]);
 }
 assert.equal(view({executionStatus:'running',executionPhase:'waiting_tasks'}).indicator,'clock');
 assert.equal(view({executionStatus:'running',executionPhase:'waiting_approval'}).indicator,'approval');
 assert.equal(view({executionStatus:'reviewing'}).indicator,'spinner');
 assert.equal(view({executionStatus:'summarizing'}).indicator,'spinner');
 for(const [executionStatus,label]of [['running','待执行'],['executing','待执行'],['reviewing','待复核'],['summarizing','待汇总']]){
  assert.deepEqual([view({executionStatus,activeRunId:null}).indicator,view({executionStatus,activeRunId:null}).label],['clock',label]);
 }
 const fixture={...worker};delete fixture.activeRunId;
 assert.equal(threadMentionView(fixture).indicator,'spinner');
 assert.equal(view({executionStatus:'completed',executionPhase:'executing'}).indicator,'check');
 assert.equal(view({executionStatus:'completed',reviewStatus:'unreviewed'}).label,'已交付，待复核');
 assert.equal(view({executionStatus:'completed',reviewStatus:'needs_work'}).indicator,'error');
 assert.equal(view({executionStatus:'completed',reviewStatus:'blocked'}).label,'复核受阻');
 assert.equal(view({executionStatus:'failed'}).label,'失败');
 assert.equal(view({executionStatus:'cancelled'}).indicator,'idle');
 assert.equal(threadMentionView({id:'invented'}),null);
});

test('unique exact title fallback protects code, existing links, URLs and email addresses',()=>{
 const options={projectId:'p',threads:[worker,{...second,title:'ADCS'}]};
 const source='已交给 星敏源码审查 复核。ADCS 将检查。\n'
  +'代码 '+String.fromCharCode(96)+'星敏源码审查'+String.fromCharCode(96)
  +'\n'+String.fromCharCode(96).repeat(3)+'text\n星敏源码审查\n'+String.fromCharCode(96).repeat(3)+'\n'
  +'[星敏源码审查](https://example.test) ![星敏源码审查](image.png) '
  +'https://example.test/ADCS www.example.test/ADCS ADCS@example.test '
  +'ADCS.mo prefix_ADCS xADCS ADCSuffix';
 const matches=threadMentionMatches(source,options);
 assert.deepEqual(matches.map(m=>m.text),['星敏源码审查','ADCS']);
 assert.equal(source.slice(matches[0].start,matches[0].end),worker.title);
 assert.deepEqual(threadMentionMatches(worker.title,{threads:options.threads}),[]);
 const tilde='~~~\n星敏源码审查\n~~~\n';
 assert.deepEqual(threadMentionMatches(tilde,options),[]);
});

test('title fallback chooses the longest overlapping known title and treats short generic titles conservatively',()=>{
 const options={projectId:'p',threads:[{...worker,title:'电源'},{...second,title:'电源与安全模式'},{...worker,id:idC,title:'电'}]};
 assert.deepEqual(threadMentionMatches('请 电源与安全模式 复核，另与“电源”讨论。电源故障。电',options).map(m=>m.text),['电源与安全模式','电源']);
});

test('canonical task references survive the existing safe Markdown renderer without enabling unsafe HTML',()=>{
 const html=renderMarkdown('[星敏源码审查]('+href(idA)+') <img src=x onerror=alert(1)>');
 assert.ok(html.includes('href="'+href(idA)+'"'));
 assert.ok(html.includes('data-document-anchor="'+href(idA)+'"'));
 assert.match(html,/&lt;img/);
 assert.doesNotMatch(html,/<img/);
 assert.match(ENGINEERING_ENTRY_GUIDANCE,/exact recorded ID only in the target/);
 assert.match(ENGINEERING_ENTRY_GUIDANCE,/do not write a fake spinner/);
 assert.doesNotMatch(ENGINEERING_ENTRY_GUIDANCE,/actual_thread_id/);
});

// Minimal DOM fixture exercises traversal, provenance boundaries and replacement
// through the real public API; no browser package or host environment is needed.
class Node {
 constructor(doc,type){this.ownerDocument=doc;this.nodeType=type;this.parentNode=null;this.children=[];}
 get parentElement(){return this.parentNode?.nodeType===1?this.parentNode:null;}
 append(...nodes){for(const node of nodes){if(node.nodeType===11){this.append(...[...node.children]);node.children=[];continue;}if(node.parentNode){const i=node.parentNode.children.indexOf(node);if(i>=0)node.parentNode.children.splice(i,1);}node.parentNode=this;this.children.push(node);}}
 replaceWith(node){const parent=this.parentNode;if(!parent)return;const i=parent.children.indexOf(this),nodes=node.nodeType===11?[...node.children]:[node];parent.children.splice(i,1,...nodes);for(const n of nodes)n.parentNode=parent;this.parentNode=null;if(node.nodeType===11)node.children=[];}
 get textContent(){return this.nodeType===3?this.nodeValue:this.children.map(n=>n.textContent).join('');}
 set textContent(value){if(this.nodeType===3){this.nodeValue=String(value);return;}for(const n of this.children)n.parentNode=null;this.children=[];if(value!=='')this.append(this.ownerDocument.createTextNode(String(value)));}
}
class Element extends Node {
 constructor(doc,tag){super(doc,1);this.tagName=tag.toLowerCase();this.className='';this.dataset={};this.attributes={};}
 setAttribute(k,v){this.attributes[k]=String(v);}
 getAttribute(k){if(k==='class')return this.className;if(k.startsWith('data-'))return this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]??this.attributes[k]??null;return this.attributes[k]??null;}
 matches(selector){return selector.split(',').some(part=>{part=part.trim();if(part.includes(' ')){const bits=part.split(/\s+/),last=bits.pop();if(!this.matches(last))return false;let p=this.parentElement;for(const bit of bits.reverse()){while(p&&!p.matches(bit))p=p.parentElement;if(!p)return false;p=p.parentElement;}return true;}const tag=/^[a-z][\w-]*/i.exec(part)?.[0];if(tag&&this.tagName!==tag)return false;for(const c of part.matchAll(/\.([\w-]+)/g))if(!this.className.split(/\s+/).includes(c[1]))return false;for(const a of part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)){const v=this.getAttribute(a[1]);if(v===null||a[2]!==undefined&&v!==a[2])return false;}return true;});}
 closest(selector){for(let n=this;n;n=n.parentElement)if(n.matches(selector))return n;return null;}
 querySelectorAll(selector){const result=[];const visit=n=>{for(const c of n.children){if(c.nodeType===1){if(c.matches(selector))result.push(c);visit(c);}}};visit(this);return result;}
}
class Document {
 createElement(tag){return new Element(this,tag);}
 createTextNode(value){const n=new Node(this,3);n.nodeValue=value;return n;}
 createDocumentFragment(){return new Node(this,11);}
 createTreeWalker(root,what){assert.equal(what,4);const nodes=[];const visit=n=>{for(const c of n.children){if(c.nodeType===3)nodes.push(c);else visit(c);}};visit(root);let i=0;return{nextNode:()=>nodes[i++]||null};}
}
function fixture(){
 const doc=new Document(),root=doc.createElement('main');
 const message=role=>{const article=doc.createElement('article');article.className='message '+role;const body=doc.createElement('div');body.className='message-body';article.append(body);root.append(article);return body;};
 const anchor=(dest,label)=>{const a=doc.createElement('a');a.setAttribute('href',dest);a.textContent=label;return a;};
 return{doc,root,message,anchor};
}

test('DOM enrichment is assistant-only, uses recorded titles and protects code, users and ordinary links',()=>{
 const {doc,root,message,anchor}=fixture(),assistant=message('assistant'),user=message('user');
 const ordinary=anchor('https://example.test',worker.title),code=doc.createElement('code');
 code.append(doc.createTextNode(worker.title),anchor(href(idA),worker.title));
 assistant.append(doc.createTextNode('交给 '+worker.title+' 复核。'),anchor(href(idA),'<img onerror=evil>'),ordinary,code);
 const unknown=anchor(href(idC),worker.title);assistant.append(unknown);
 user.append(doc.createTextNode(worker.title),anchor(href(idA),worker.title));
 const beforeUser=user.textContent,beforeCode=code.textContent,result=enrichThreadMentions(root,context);
 assert.deepEqual(result,{created:2,updated:0,invalid:1});
 const buttons=assistant.querySelectorAll('button.thread-mention[data-id]');
 assert.equal(buttons.length,2);assert.ok(buttons.every(b=>b.dataset.id===idA&&b.textContent===worker.title));
 assert.ok(buttons.every(b=>b.dataset.threadIndicator==='spinner'&&b.getAttribute('aria-label')===worker.title+' · 执行中'));
 assert.equal(user.textContent,beforeUser);assert.equal(user.querySelectorAll('button').length,0);
 assert.equal(code.textContent,beforeCode);assert.equal(code.querySelectorAll('a').length,1);
 assert.equal(ordinary.parentNode,assistant);
 assert.equal(assistant.querySelectorAll('[data-thread-mention-invalid]').length,1);
 assert.equal(assistant.querySelectorAll('img').length,0);
 assert.doesNotMatch(assistant.textContent,/<img/);
 const refreshed=enrichThreadMentions(root,{projectId:'p',threads:[{...worker,executionStatus:'waiting_tasks'},second]});
 assert.deepEqual(refreshed,{created:0,updated:2,invalid:0});
 assert.equal(assistant.querySelectorAll('button').length,2);
 assert.ok(assistant.querySelectorAll('button').every(b=>b.dataset.threadIndicator==='clock'));
});

test('DOM title fallback can be disabled and stale/foreign explicit references become inert',()=>{
 const {doc,root,message,anchor}=fixture(),assistant=message('assistant');
 assistant.append(doc.createTextNode(worker.title),anchor(href(idA),'an alias'),anchor(href(idB),'foreign title'));
 const first=enrichThreadMentions(root,{projectId:'p',threads:[worker,{...second,projectId:'q'}],allowTitleMatches:false});
 assert.deepEqual(first,{created:1,updated:0,invalid:1});
 assert.equal(assistant.querySelectorAll('button').length,1);
 assert.equal(assistant.children[0].nodeValue,worker.title);
 const next=enrichThreadMentions(root,{projectId:'q',threads:context.threads});
 assert.deepEqual(next,{created:0,updated:0,invalid:1});
 assert.equal(assistant.querySelectorAll('button').length,0);
 assert.equal(assistant.querySelectorAll('[data-thread-mention-invalid]').length,2);
});
