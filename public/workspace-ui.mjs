import {mountDocumentViewer} from './document-viewer.mjs';
import {mountSimulationViewer} from './simulation-viewer.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labelStatus=value=>({queued:'排队中',running:'执行中',completed:'已完成',failed:'失败',blocked:'受阻',cancelled:'已停止',interrupted:'已中断'}[value]||value||'未开始');
const size=value=>value==null?'文件夹':value>1048576?(value/1048576).toFixed(1)+' MB':value>1024?(value/1024).toFixed(1)+' KB':value+' B';
const button=(action,label,extra='')=>`<button type="button" data-workspace-action="${action}" ${extra}>${esc(label)}</button>`;
const glyph=type=>type==='directory'?'▸':type==='sysml'?'◇':type==='markdown'?'≡':type==='image'?'▧':'·';

// Display paths always remain inside the selected project. The server rechecks
// the actual filesystem boundary, including every symlink component.
export function projectRelativePath(input,folder='') {
  let value=String(input||'').trim();
  if(!value||/[\u0000-\u001f]/.test(value)||value.includes('\\'))throw Error('请选择项目内的文件');
  const hash=value.indexOf('#');if(hash>=0)value=value.slice(0,hash);
  if(value.startsWith('/')){
    const base=String(folder).replace(/\/+$/,'');
    if(!base||!value.startsWith(base+'/'))throw Error('文件不在当前项目文件夹内');
    value=value.slice(base.length+1);
  }
  if(/^[a-z][a-z0-9+.-]*:/i.test(value))throw Error('请选择项目内的文件');
  const parts=[];
  for(const part of value.split('/')){if(!part||part==='.')continue;if(part==='..'){if(!parts.length)throw Error('文件超出当前项目文件夹');parts.pop();}else parts.push(part);}
  return parts.join('/')||'.';
}

export function workspaceFileTitle(relative,artifacts,projectId,source=false){return (artifacts.find(a=>a.projectId===projectId&&a.path===relative)?.name||String(relative).split('/').at(-1))+(source?' · 原始数据':'');}

export function createWorkspaceUI({api,getProject,getArtifacts=()=>[],getKnowledge=()=>[],onError=()=>{},onFocus=()=>{},onEditModel=()=>{},onProfessionalJob=()=>{},onAskAgent=()=>{},onOpenExternal=url=>window.open(url,'_blank','noopener,noreferrer')}={}) {
  let projectId=null,host=null,shell=null,viewer=null,tabs=[],active='browser',section='files',listing=null,listError='',listBusy=false,folder='.',filter='',revision=0,rootDiscovery=null,contentSignature='';
  const base=()=>'/api/projects/'+encodeURIComponent(projectId)+'/workspace';
  const current=()=>tabs.find(t=>t.id===active),drafts=new Map();
  const draftKey=tab=>projectId+'::'+tab.id;
  const keepDraft=tab=>{if(tab?.edit)drafts.set(draftKey(tab),{...tab.edit,saving:false});};
  function ensureProject(){const p=getProject();if(!p)throw Error('请先选择项目');if(p.id!==projectId){projectId=p.id;tabs=[];active='browser';folder='.';listing=null;rootDiscovery=null;listError='';listBusy=false;filter='';revision++;}return p;}
  function destroyViewer(){viewer?.destroy?.();viewer=null;}
  function imageUrl(path){try{return base()+'/image?path='+encodeURIComponent(projectRelativePath(path,getProject()?.folderPath));}catch{return '';}}
  function draw(){
    if(!host?.isConnected)return;
    ensureProject();destroyViewer();
    host.innerHTML=`<section class="manta-workbench"><div class="workbench-tabbar" role="tablist" aria-label="打开的文件"><button role="tab" aria-selected="${active==='browser'}" data-workspace-action="browser">文件</button>${tabs.map(t=>`<span class="workbench-tab ${active===t.id?'active':''}"><button role="tab" aria-selected="${active===t.id}" data-workspace-action="tab" data-tab="${esc(t.id)}" title="${esc(t.path||t.title)}">${esc(t.title)}</button><button data-workspace-action="close-tab" data-tab="${esc(t.id)}" aria-label="关闭 ${esc(t.title)}">×</button></span>`).join('')}<span class="workbench-tab-space"></span><button data-workspace-action="focus" title="切换展开工作区" aria-label="切换展开工作区">⤢</button></div><div class="workbench-content"></div></section>`;
    shell=host.firstElementChild;
    const content=shell.querySelector('.workbench-content');
    if(active==='browser'){content.innerHTML=browser();return;}
    const tab=current();if(!tab){active='browser';draw();return;}
    if(tab.loading){content.innerHTML='<p class="workbench-loading" role="status">正在读取…</p>';return;}
    if(tab.error){content.innerHTML=`<div class="workbench-error" role="alert"><strong>无法打开</strong><p>${esc(tab.error)}</p>${button('reload','重试')}</div>`;return;}
    const viewerHost=document.createElement('div');viewerHost.className='workbench-viewer';content.append(viewerHost);
    if(tab.kind==='simulation'){
      viewer=mountSimulationViewer(viewerHost,{simulation:tab.simulation,caseId:tab.caseId,onOpenPath:(path,detail)=>openPath(path,detail).catch(onError),onOpenModel:path=>openPath(path||tab.simulation?.model?.path).catch(onError),onRerun:()=>onAskAgent(`请根据工程作业 ${tab.jobId} 的模型和场景配置重新运行仿真，复核结果，并在 Manta 中提供模型、曲线与证据入口。`),onStop:()=>stopJob(tab)});
    }else if(tab.edit){
      const dirty=tab.edit.content!==tab.edit.originalContent;viewerHost.innerHTML=`<section class="workbench-document-editor"><div class="workbench-editor-state" role="status">${tab.edit.saving?'正在保存…':dirty?'有未保存的修改':'编辑文件'}</div><textarea data-workspace-editor aria-label="编辑文件内容" spellcheck="false" ${tab.edit.saving?'disabled':''}>${esc(tab.edit.content)}</textarea>${tab.edit.error?`<p role="alert" class="workbench-editor-error">${esc(tab.edit.error)}</p>`:''}</section>`;viewerHost.querySelector('[data-workspace-editor]').value=tab.edit.content;
    }else{
      viewer=mountDocumentViewer(viewerHost,{file:tab.file,model:tab.model?.semantic,verification:tab.model?.verification,tab:tab.documentTab,sourceLine:tab.sourceLine,resolveImage:imageUrl,onOpenPath:(path,detail)=>openPath(path,detail).catch(onError),onOpenExternal,onTabChange:value=>{tab.documentTab=value;}});
    }
    const header=document.createElement('div');header.className='workbench-file-actions';
    header.innerHTML=`<span title="${esc(tab.path||tab.jobId)}">${esc(tab.path||tab.jobId)}${tab.file?.revision?` · ${tab.file.revision.current?'用户修订 · 未重新复核':'当前文件已变化'}`:tab.file?.registeredArtifact?' · 当前文件':''}</span>${tab.edit?button('save-file',tab.edit.saving?'保存中…':'保存',tab.edit.saving?'disabled':'')+button('cancel-edit','取消',tab.edit.saving?'disabled':''):button('reload','刷新')+(tab.file?.editable&&!tab.inline?button('edit-file','编辑'):'')+(tab.file?.revision?.id?button('file-history','修改前版本'):'')}${/(?:\.(mo|sysml|cir|scad)|\.stf\.json)$/i.test(tab.path||'')?button('edit-native','编辑与求解'):''}${tab.file?.type==='sysml'?button('verify-model',tab.verifying?'校验中…':'校验模型',tab.verifying?'disabled':''):''}${tab.kind==='simulation'?((tab.path||tab.simulation?.result?.resultPath)?button('raw-result','原始数据'):''):button('ask-file',tab.file?.type==='sysml'?'让 Agent 修改模型':'让 Agent 处理')}`;
    content.prepend(header);
    if(tab.file?.persistenceWarning){const notice=document.createElement('p');notice.className='workbench-editor-error';notice.setAttribute('role','alert');notice.textContent=tab.file.persistenceWarning;header.after(notice);}
  }
  function browser(){
    const discovered=rootDiscovery||listing?.discovered||{},rows=section==='models'?discovered.models||[]:section==='reports'?discovered.reports||[]:listing?.entries||[];
    const selected=filter.trim().toLowerCase(),visible=rows.filter(r=>(r.name||r.path||'').toLowerCase().includes(selected));
    const crumbs=folder==='.'?[]:folder.split('/');
    const nav=`<div class="workbench-browser-heading"><h2>Library</h2>${button('refresh','刷新')}</div><div class="workbench-sections" role="tablist" aria-label="项目内容">${[['files','文件'],['models','SysML 模型'],['reports','报告'],['simulations','仿真'],['registered','项目资料']].map(([id,label])=>`<button role="tab" aria-selected="${section===id}" data-workspace-action="section" data-section="${id}">${label}</button>`).join('')}</div>`;
    if(listBusy&&!listing)return nav+'<p class="workbench-loading" role="status">正在读取项目文件…</p>';
    if(listError)return nav+`<div class="workbench-error" role="alert"><p>${esc(listError)}</p>${button('refresh','重试')}</div>`;
    if(section==='simulations'){
      const jobs=discovered.simulations||[];
      return nav+`<div class="workbench-job-list">${jobs.map(j=>`<button data-workspace-action="job" data-job="${esc(j.id||j.jobId)}"><span><strong>${esc(j.name||({component:'组件验证',build:'工程构建',integration:'NOS3 集成仿真'}[j.scope]||'仿真作业'))}</strong><small>${esc(j.id||j.jobId)}</small><small>${esc((j.completedAt||j.updatedAt||j.createdAt||'').replace('T',' ').slice(0,19))}</small></span><span class="workbench-job-status">${esc(labelStatus(j.status))} ›</span></button>`).join('')||'<p class="workbench-empty">此项目尚无仿真作业。</p>'}</div>`;
    }
    if(section==='registered'){
      const artifacts=getArtifacts().filter(a=>a.projectId===projectId),knowledge=getKnowledge();
      return nav+`<div class="workbench-file-list">${knowledge.map(a=>`<button data-workspace-action="knowledge" data-id="${esc(a.id)}"><span>≡</span><strong>${esc(a.name)}</strong><small>项目资料</small></button>`).join('')}${artifacts.map(a=>`<button data-workspace-action="artifact" data-id="${esc(a.id)}"><span>${glyph(a.path?.endsWith('.sysml')?'sysml':'markdown')}</span><strong>${esc(a.name||a.path)}</strong><small>产物</small></button>`).join('')||(!knowledge.length?'<p class="workbench-empty">尚无登记的项目资料。文件页可直接查看项目目录。</p>':'')}</div>`;
    }
    return nav+`<div class="workbench-browser-tools">${section==='files'?`<nav class="workbench-breadcrumbs" aria-label="文件路径">${button('folder','项目根目录','data-path="."')}${crumbs.map((c,i)=>`<span>/</span>${button('folder',c,`data-path="${esc(crumbs.slice(0,i+1).join('/'))}"`)}`).join('')}</nav>`:'<span></span>'}<input type="search" data-workspace-filter aria-label="筛选文件" placeholder="筛选文件" value="${esc(filter)}"></div><div class="workbench-file-list">${visible.map(f=>`<button data-workspace-action="${f.kind==='directory'?'folder':'file'}" data-path="${esc(f.path)}"><span class="workbench-file-glyph">${glyph(f.kind==='directory'?'directory':f.type)}</span><strong>${esc(section==='files'?f.name:f.path)}</strong><small>${esc(size(f.size))}</small></button>`).join('')||'<p class="workbench-empty">'+(selected?'没有匹配文件。':section==='models'?'尚无 SysML 文件。让 Agent 将模型保存到项目的 models 目录后，即可在这里查看。':section==='reports'?'尚无 Markdown 报告。':'此目录没有可显示的文件。')+'</p>'}</div>${listing?.truncated||discovered.limited?'<p class="workbench-limits">当前列表已达到显示上限，请进入具体文件夹查看。</p>':''}`;
  }
  async function loadList(){
    ensureProject();const id=projectId,request=++revision;listBusy=true;listError='';if(active==='browser')draw();
    try{const [value,root]=await Promise.all([api(base()+'/files?path='+encodeURIComponent(folder)),folder!=='.'&&!rootDiscovery?api(base()+'/files?path=.'):null]);if(projectId!==id||request!==revision)return;listing=value;if(value.discovered||root?.discovered)rootDiscovery=value.discovered||root.discovered;}
    catch(e){if(projectId===id&&request===revision)listError=e.message;}
    finally{if(projectId===id&&request===revision){listBusy=false;if(active==='browser')draw();}}
  }
  async function loadTab(tab){
    const id=projectId,route=base();tab.loading=true;tab.error='';draw();
    try{
      if(tab.kind!=='simulation'&&!tab.inline&&!tab.raw){
        // The server resolves only recorded results belonging to this project.
        // Names such as result.json alone never imply a simulation or a job.
        let destination;
        try{destination=await api(route+'/resolve?path='+encodeURIComponent(tab.path));}
        catch(error){if(error.status!==404&&error.statusCode!==404)throw error;}
        if(id!==projectId||!tabs.includes(tab))return;
        if(destination?.kind==='professional'){await onProfessionalJob(destination.jobId);return;}
        if(destination?.kind==='simulation'){
          if(destination.projectId&&destination.projectId!==id)throw Error('结果不属于当前项目');
          if(typeof destination.jobId!=='string'||!destination.jobId)throw Error('仿真结果缺少作业关联');
          tab.kind='simulation';tab.jobId=destination.jobId;tab.caseId=destination.caseId;
        }
      }
      if(tab.kind==='simulation')tab.simulation=await api(route+'/simulations/'+encodeURIComponent(tab.jobId));
      else if(tab.path?.match(/\.(sysml|kerml)$/i)){tab.model=await api(route+'/model?path='+encodeURIComponent(tab.path));tab.file=tab.model.file;}
      else if(!tab.inline)tab.file=await api(route+'/file?path='+encodeURIComponent(tab.path));
      if(tab.file?.editable&&!tab.edit&&drafts.has(draftKey(tab)))tab.edit={...drafts.get(draftKey(tab)),saving:false};
    }catch(e){tab.error=e.message;}
    finally{tab.loading=false;if(id===projectId&&tabs.includes(tab)&&active===tab.id)draw();}
  }
  async function openPath(path,{line,raw=false}={}){
    const artifact=/^\/api\/artifacts\/([^/]+)$/.exec(String(path));if(artifact)return openArtifact(artifact[1]);
    const p=ensureProject(),relative=projectRelativePath(path,p.folderPath),source=raw||(Number.isInteger(line)&&line>0),tabId=(source?'raw:':'file:')+relative;
    let tab=tabs.find(t=>t.id===tabId);
    if(!tab){tab={id:tabId,kind:'file',path:relative,raw:source,title:workspaceFileTitle(relative,getArtifacts(),p.id,source)};tabs.push(tab);}
    if(source){tab.documentTab='source';tab.sourceLine=Number.isInteger(line)&&line>0?line:undefined;}else tab.sourceLine=undefined;
    active=tab.id;if(!tab.file&&!tab.simulation&&!tab.loading)await loadTab(tab);else draw();
  }
  async function openJob(jobId,{caseId}={}){
    ensureProject();let tab=tabs.find(t=>t.kind==='simulation'&&t.jobId===jobId);
    if(!tab){tab={id:'job:'+jobId,kind:'simulation',jobId,title:'仿真 · '+jobId.slice(-8)};tabs.push(tab);}
    if(caseId)tab.caseId=caseId;
    active=tab.id;if(!tab.simulation&&!tab.loading)await loadTab(tab);else draw();
  }
  function inlineFile({id,name,path,content,type}){
    ensureProject();let tab=tabs.find(t=>t.id===id);
    const file={path:path||name,name:name||path,content,type:type||(/\.sysml$/i.test(name||path)?'sysml':/\.md$/i.test(name||path)?'markdown':'text'),mime:type==='json'?'application/json':type==='markdown'?'text/markdown':/\.md$/i.test(name||path)?'text/markdown':'text/plain'};
    if(!tab){tab={id,kind:'file',inline:true,title:name||path,path,file};tabs.push(tab);}else{tab.file=file;tab.title=name||path;tab.path=path;}
    active=tab.id;draw();
  }
  function openResult({id,title,data}={}){
    ensureProject();
    if(data===undefined)throw Error('此工具尚未返回可展示的数据');
    let content;try{content=JSON.stringify(data,null,2);}catch{throw Error('此工具结果无法转换为数据视图');}
    const name=String(title||'工具结果').replace(/\.json$/i,'')+'.json';
    inlineFile({id:'result:'+String(id||name),name,content,type:'json'});
  }
  async function openArtifact(id){ensureProject();const pid=projectId,metadata=getArtifacts().find(a=>a.id===id&&a.projectId===pid);if(!metadata)throw Error('产物不属于当前项目');if(metadata.path)return openPath(metadata.path);const a=await api('/api/artifacts/'+encodeURIComponent(id));if(pid!==projectId||getProject()?.id!==pid)return;if(a.projectId&&a.projectId!==pid)throw Error('产物不属于当前项目');inlineFile({id:'artifact:'+id,name:a.name,content:a.content||'',type:/markdown/i.test(a.type||'')||/\.(md|markdown)$/i.test(a.name)?'markdown':undefined});}
  function openKnowledge(id){const f=getKnowledge().find(f=>f.id===id);if(!f)throw Error('资料未找到');inlineFile({id:'knowledge:'+id,name:f.name,content:f.content||'',type:/\.(md|markdown)$/i.test(f.name)?'markdown':undefined});}
  function beginEdit(){
    ensureProject();const tab=current();if(!tab?.file?.editable||tab.inline||tab.kind==='simulation')throw Error('此文件只读');
    tab.edit=tab.edit||drafts.get(draftKey(tab))||{content:tab.file.content,originalContent:tab.file.content,expectedSha256:tab.file.sha256,error:'',saving:false};keepDraft(tab);draw();return {...tab.edit};
  }
  function setEditContent(content){const tab=current();if(!tab?.edit||tab.edit.saving||typeof content!=='string')return;tab.edit.content=content;tab.edit.error='';keepDraft(tab);}
  async function saveEdit(){
    ensureProject();const tab=current(),pid=projectId,route=base(),edit=tab?.edit;if(!edit||edit.saving)return;
    edit.saving=true;edit.error='';draw();
    try{
      const value=await api(route+'/file?path='+encodeURIComponent(tab.path),{method:'PUT',body:JSON.stringify({expectedSha256:edit.expectedSha256,content:edit.content})});
      drafts.delete(pid+'::'+tab.id);tab.file=value;tab.model=null;tab.edit=null;tab.saved=true;
      for(const other of (pid===projectId?tabs:[]))if(other!==tab&&other.path===tab.path&&!other.edit){other.file=value;other.model=null;}
      if(pid===projectId){listing=null;rootDiscovery=null;if(active===tab.id)draw();}
      return value;
    }catch(error){edit.saving=false;edit.error=error.message;drafts.set(pid+'::'+tab.id,{...edit});if(pid===projectId&&tabs.includes(tab)&&active===tab.id)draw();throw error;}
  }
  function cancelEdit(){const tab=current();if(!tab?.edit||tab.edit.saving)return;drafts.delete(draftKey(tab));tab.edit=null;draw();}
  async function openHistory(){const tab=current(),pid=projectId;if(!tab?.file?.revision?.id)return;const file=await api(base()+'/file-history?editId='+encodeURIComponent(tab.file.revision.id));if(pid!==projectId)return;inlineFile({id:'history:'+file.editId,name:file.name,content:file.content,type:file.type});}
  async function stopJob(tab){await api('/api/projects/'+encodeURIComponent(projectId)+'/nos3/jobs/'+encodeURIComponent(tab.jobId)+'/cancel',{method:'POST',body:'{}'});await loadTab(tab);}
  async function act(event){
    const el=event.target.closest('[data-workspace-action]');if(!el||!host?.contains(el))return;event.preventDefault();
    try{switch(el.dataset.workspaceAction){
      case 'edit-file':beginEdit();break;
      case 'save-file':await saveEdit();break;
      case 'cancel-edit':cancelEdit();break;
      case 'file-history':await openHistory();break;
      case 'edit-native':await onEditModel(current()?.path);break;
      case 'browser':active='browser';draw();if(!listing)await loadList();break;
      case 'section':section=el.dataset.section;filter='';active='browser';draw();if(!listing)await loadList();break;
      case 'folder':folder=el.dataset.path;filter='';listing=null;await loadList();break;
      case 'file':if(/(?:\.(mo|cir|scad)|\.stf\.json)$/i.test(el.dataset.path))await onEditModel(el.dataset.path);else await openPath(el.dataset.path);break;
      case 'job':await openJob(el.dataset.job);break;
      case 'artifact':await openArtifact(el.dataset.id);break;
      case 'knowledge':openKnowledge(el.dataset.id);break;
      case 'tab':active=el.dataset.tab;draw();break;
      case 'close-tab':{const index=tabs.findIndex(t=>t.id===el.dataset.tab);if(index>=0){keepDraft(tabs[index]);tabs.splice(index,1);}if(active===el.dataset.tab)active=tabs[index]?.id||tabs[index-1]?.id||'browser';draw();break;}
      case 'refresh':listing=null;rootDiscovery=null;await loadList();break;
      case 'reload':if(current()?.edit){throw Error('请先保存或取消当前编辑');}if(current())await loadTab(current());else await loadList();break;
      case 'verify-model':{const tab=current(),pid=projectId;if(!tab?.model||tab.verifying)break;const model=tab.model,hash=tab.file.sha256;tab.verifying=true;draw();try{const verification=await api('/api/projects/'+encodeURIComponent(pid)+'/model-backend/verify',{method:'POST',body:JSON.stringify({path:tab.path,expectedHash:hash})});if(projectId!==pid||!tabs.includes(tab)||tab.model!==model||tab.file.sha256!==hash)return;if(verification.model?.sha256!==hash)throw Error('模型版本已变化，请刷新后重新校验');model.verification=verification;tab.documentTab='constraints';}finally{tab.verifying=false;if(pid===projectId&&tabs.includes(tab))draw();}break;}
      case 'focus':onFocus();break;
      case 'raw-result':{const tab=current(),path=tab?.path||tab?.simulation?.result?.resultPath;if(path)await openPath(path,{raw:true});break;}
      case 'ask-file':onAskAgent(`请查看项目文件 ${current()?.path||current()?.title}。`);break;
    }}catch(error){onError(error);}
  }
  function input(event){if(event.target.matches('[data-workspace-editor]')){setEditContent(event.target.value);const status=host?.querySelector('.workbench-editor-state');if(status)status.textContent=current()?.edit?.content===current()?.edit?.originalContent?'编辑文件':'有未保存的修改';return;}if(!event.target.matches('[data-workspace-filter]'))return;filter=event.target.value;const start=event.target.selectionStart;draw();const next=host.querySelector('[data-workspace-filter]');next?.focus();if(next?.type!=='search')next?.setSelectionRange(start,start);}
  const controller={
    mount(container){const previous=projectId;ensureProject();if(host!==container){host?.removeEventListener('click',act);host?.removeEventListener('input',input);destroyViewer();host=container;host.addEventListener('click',act);host.addEventListener('input',input);}if(previous!==projectId||!shell?.isConnected||!host.contains(shell))draw();const signature=JSON.stringify([projectId,getArtifacts().filter(a=>a.projectId===projectId).map(a=>[a.id,a.updatedAt]),getKnowledge().map(f=>f.id)]);if(signature!==contentSignature){contentSignature=signature;listing=null;rootDiscovery=null;}if(!listing&&!listBusy)loadList();},
    openPath,openJob,openArtifact,openKnowledge,openResult,beginEdit,setEditContent,saveEdit,cancelEdit,openHistory,editState(){ensureProject();const tab=current();return tab?.edit?{path:tab.path,...tab.edit}:null;},
    showSection(value='files'){ensureProject();section=value;active='browser';draw();if(!listing)loadList();},
    detach(){destroyViewer();host?.removeEventListener('click',act);host?.removeEventListener('input',input);host=null;shell=null;},
    destroy(){revision++;destroyViewer();host?.removeEventListener('click',act);host?.removeEventListener('input',input);host=null;},
  };
  return controller;
}
