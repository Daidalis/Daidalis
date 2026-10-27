import {buildApprovalPresentation} from './approval-presentation.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lock='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4"/></svg>';
const json=value=>{try{return JSON.stringify(value??{},null,2);}catch{return String(value??'');}};

export function approvalCommand(approval){return buildApprovalPresentation(approval).command;}

export function renderApprovalCard(approval,{threadTitle='',projectFolder='',technicalOpen=false,scope='inline'}={}){
  const a=approval||{},view=buildApprovalPresentation(a),id=String(a.id||''),titleId='approval-title-'+scope+'-'+id;
  const context=[view.source,threadTitle].filter(Boolean).join(' · ');
  const fields=[...(view.cwd?[{label:'工作目录',value:view.cwd}]:projectFolder?[{label:'项目文件夹',value:projectFolder}]:[]),...view.fields];
  const command=view.kind==='command'&&view.command?`<div class="approval-command"><div class="approval-code-heading"><span>${view.commandFormat==='argv'?'命令参数':'命令'}</span><button type="button" class="approval-copy" data-action="copy-approval-command" data-id="${esc(id)}" aria-label="复制完整命令">复制</button></div><pre class="approval-code" tabindex="0"><code>${esc(view.command)}</code></pre></div>`:'';
  const blocks=view.blocks.map(b=>`<div class="approval-block"><div class="approval-code-heading"><span>${esc(b.label)}</span></div><pre class="approval-code ${b.format==='diff'?'approval-diff':''}" tabindex="0"><code>${esc(b.content)}</code></pre></div>`).join('');
  return `<section class="inline-approval operation-approval" data-approval-id="${esc(id)}" aria-labelledby="${esc(titleId)}"><div class="approval-heading"><span class="approval-marker">${lock}</span><div><h3 id="${esc(titleId)}">${esc(view.title)}</h3><p class="approval-context">${esc(context)}</p></div><span class="approval-pending">待批准</span></div>${view.reason?`<p class="approval-reason">${esc(view.reason)}</p>`:''}${fields.length?`<dl class="approval-fields">${fields.map(f=>`<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join('')}</dl>`:''}${command}${blocks}<details class="approval-technical" data-approval-technical="${esc(id)}" ${technicalOpen?'open':''}><summary>技术详情</summary><pre class="approval-code" tabindex="0"><code>${esc(json(a.args))}</code></pre></details><div class="approval-actions"><button type="button" class="button compact" data-action="reject-approval" data-id="${esc(id)}">拒绝</button><button type="button" class="button primary compact" data-action="approve-approval" data-id="${esc(id)}">允许本次</button></div></section>`;
}
