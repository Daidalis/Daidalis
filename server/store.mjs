import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

export const now = () => new Date().toISOString();
export const id = (prefix = 'id') => `${prefix}_${randomUUID()}`;
export const DEFAULT_RESOURCES = Object.freeze({maxConcurrentAgents:4,maxTasksPerRun:16,maxAutoResumes:2,maxAutoTurns:4,maxAutoRunMs:300000,maxAutoContinuations:24});
const collections = ['projects','threads','messages','runs','agents','artifacts','approvals','events','providers','knowledge','models','evaluations','steerings'];
const contains=(parent,child)=>child===parent||child.startsWith(parent+path.sep);
function existingDirectory(value){if(typeof value!=='string'||!value||value.includes('\0')||value.length>4096||!path.isAbsolute(value))throw new Error('项目文件夹必须是已存在目录的绝对路径。');let folder;try{folder=fs.realpathSync(value);if(!fs.statSync(folder).isDirectory())throw Error();}catch{throw new Error('项目文件夹不存在或不是目录，请先创建或选择工程文件夹。');}return folder;}
export function createStore({dataDir, workspacesDir = path.join(dataDir, 'workspaces'), root, protectedPaths = [], seed = true, addDefaultCodexProvider = true, getDefaultPermissionMode = () => 'manual'}) {
  fs.mkdirSync(dataDir, {recursive:true,mode:0o700});
  fs.mkdirSync(workspacesDir, {recursive:true,mode:0o700});
  const file = path.join(dataDir, 'state.json');
  const protectedFolders=[dataDir,root,...protectedPaths].filter(Boolean).map(p=>fs.realpathSync(p));
  const home=fs.realpathSync(os.homedir());
  const broadFolders=new Set([path.parse(home).root,home,path.dirname(home),os.tmpdir(),...['Documents','Desktop','Downloads','Library','Movies','Music','Pictures','Public'].map(n=>path.join(home,n)),...['/tmp','/var','/private','/private/var','/Users','/Volumes','/home','/opt'].filter(p=>fs.existsSync(p))].map(p=>{try{return fs.realpathSync(p);}catch{return p;}}));
  const systemTrees=['/System','/Applications','/Library','/usr','/bin','/sbin','/etc','/dev','/proc','/sys','/var/db','/private/var/db','/private/etc'].filter(p=>fs.existsSync(p)).map(p=>fs.realpathSync(p));
  let data;
  try { data = JSON.parse(fs.readFileSync(file,'utf8')); }
  catch (e) { if(e.code !== 'ENOENT') throw new Error('Persistence is unreadable; preserve state.json and repair it before restarting.'); data = {}; }
  for (const name of collections) if (!Array.isArray(data[name])) data[name] = [];
  const store = {
    data, dataDir, workspacesDir, id,
    canonicalFolder:existingDirectory,
    validateFolder(value) {
      const folder=existingDirectory(value);
      if(broadFolders.has(folder)||systemTrees.some(p=>contains(p,folder)))throw new Error('请选择具体工程文件夹，不能绑定磁盘根目录、个人主目录或系统文件夹。');
      if(protectedFolders.some(p=>contains(folder,p)||contains(p,folder)))throw new Error('项目文件夹不能包含 Manta 源码/服务数据，也不能位于这些受保护目录内，请另选工程文件夹。');
      return folder;
    },
    save() {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), {mode:0o600});
      fs.renameSync(tmp, file);
    },
    get(name,key) { return data[name]?.find(x=>x.id===key); },
    add(name,row) { data[name].push(row); store.save(); return row; },
    patch(name,key,fields) { const row=store.get(name,key); if(!row) return null; Object.assign(row, fields); store.save(); return row; },
    remove(name,key) { const at=data[name].findIndex(x=>x.id===key); if(at>=0) data[name].splice(at,1); store.save(); },
    workspace(projectId) {
      const project=store.get('projects',projectId);if(!project)throw new Error('Project not found');
      if(!/^project_[a-f0-9-]+$/i.test(projectId))throw new Error('Invalid workspace identifier');
      if(!project.folderPath){
        const legacy=path.join(workspacesDir,projectId);fs.mkdirSync(legacy,{recursive:true,mode:0o700});
        if(fs.lstatSync(legacy).isSymbolicLink()||!fs.realpathSync(legacy).startsWith(fs.realpathSync(workspacesDir)+path.sep))throw new Error('Unsafe legacy workspace');
        project.folderPath=fs.realpathSync(legacy);project.folderBinding='legacy-workspace';project.folderBoundAt=now();store.save();
      }
      let canonical;try{canonical=existingDirectory(project.folderPath);}catch{throw new Error('项目绑定文件夹不可用；请恢复原目录后继续，Manta 不会自动创建或移动工程文件。');}
      if(canonical!==project.folderPath)throw new Error('项目文件夹路径已改变或被符号链接替换，请恢复原目录后继续。');
      if(project.folderBinding!=='legacy-workspace')store.validateFolder(canonical);
      return canonical;
    },
    createProject(input) {
      const folderPath=input.folderPath===undefined?undefined:store.validateFolder(input.folderPath);
      const p={id:id('project'), ...(folderPath?{folderPath,folderBinding:'user-selected',folderBoundAt:now()}:{}),lastPermissionMode:getDefaultPermissionMode()==='auto'?'auto':'manual',name:input.name.trim(),description:input.description||'',instructions:input.instructions||'',memory:input.memory||'',memoryVersion:0,resources:{...DEFAULT_RESOURCES,...input.resources},createdAt:now(),updatedAt:now()};
      store.add('projects',p); store.workspace(p.id); store.ensureCoordinator(p.id); return p;
    },
    createThread(projectId,title='新任务',parentThreadId,fields={}) {
      const project=store.get('projects',projectId);if(!project)throw new Error('Project not found');
      const coordinator=fields.kind==='coordinator'?null:store.ensureCoordinator(projectId);
      if(fields.kind==='coordinator'&&parentThreadId)throw new Error('Coordinator cannot have a parent thread');
      if(coordinator&&parentThreadId&&parentThreadId!==coordinator.id)throw new Error('Threads can only belong directly to the Coordinator');
      const t={id:id('thread'),projectId,title,createdAt:now(),updatedAt:now(),status:'open',...fields,kind:coordinator?'worker':'coordinator',...(coordinator?{parentThreadId:coordinator.id}:{})};
      return store.add('threads',t);
    },
    ensureCoordinator(projectId) {
      const project=store.get('projects',projectId);if(!project)throw new Error('Project not found');
      let thread=store.get('threads',project.coordinatorThreadId);
      if(!thread||thread.projectId!==projectId)thread=data.threads.filter(t=>t.projectId===projectId&&!t.parentThreadId).sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')))[0];
      if(!thread)thread=store.createThread(projectId,'项目主对话',undefined,{kind:'coordinator'});
      thread.kind='coordinator';delete thread.parentThreadId;thread.status=thread.status==='stopped'?'stopped':'open';project.coordinatorThreadId=thread.id;
      for(const t of data.threads.filter(t=>t.projectId===projectId&&t.id!==thread.id)){
        t.kind='worker';t.status=t.status||'open';
        if(t.parentThreadId&&t.parentThreadId!==thread.id){
          // Keep historical conversation provenance while flattening the active ownership graph.
          t.legacyParentThreadId??=t.parentThreadId;
          const latest=data.runs.findLast(run=>run.threadId===t.id);
          if(latest?.deferredToChildren)latest.deferredToChildren=false;
          const oldReceipt=data.messages.findLast(message=>message.threadId===t.parentThreadId&&message.type==='thread.result'&&message.metadata?.runId===latest?.id);
          if(oldReceipt&&!data.messages.some(message=>message.threadId===thread.id&&message.type==='thread.result'&&message.metadata?.runId===latest.id)){
            data.messages.push({id:id('message'),threadId:thread.id,role:'assistant',content:`历史任务「${t.title}」的交付已归入 Coordinator，请在继续工程结论前复核。`,createdAt:now(),type:'thread.result',metadata:{...oldReceipt.metadata,parentThreadId:thread.id,legacyReceiptId:oldReceipt.id,legacyParentThreadId:t.parentThreadId,reviewStatus:'unreviewed',summaryStatus:'migrated'}});
          }
          for(const message of data.messages.filter(message=>message.threadId===t.parentThreadId&&message.type==='thread.result'&&message.metadata?.taskThreadId===t.id&&message.metadata?.summaryStatus==='pending'))message.metadata.summaryStatus='migrated';
        }
        t.parentThreadId=thread.id;
      }
      project.resources={...DEFAULT_RESOURCES,...project.resources};project.memory=typeof project.memory==='string'?project.memory:'';project.memoryVersion=Number.isInteger(project.memoryVersion)?project.memoryVersion:0;
      store.save();return thread;
    },
    message(threadId,role,content,runId,fields={}) { const thread=store.get('threads',threadId);if(thread)thread.updatedAt=now();return store.add('messages',{id:id('message'),threadId,role,content,createdAt:now(),...(runId?{runId}:{}),...fields}); }
  };
  // A process restart cannot resume an in-flight network or tool execution safely.
  for(const run of data.runs) if(['queued','running','waiting_approval'].includes(run.status)) Object.assign(run,{status:'interrupted',error:'Server restarted; start a new message to continue.'});
  for(const agent of data.agents) if(['queued','running','waiting_approval'].includes(agent.status)) agent.status='interrupted';
  for(const steering of data.steerings)if(steering.status==='queued'){steering.status='interrupted';const message=store.get('messages',steering.messageId);if(message)message.metadata={...message.metadata,delivery:'interrupted'};if(steering.routeId){const receipt=data.messages.find(m=>m.type==='thread.routed'&&m.metadata?.routeId===steering.routeId);if(receipt)receipt.metadata.delivery='interrupted';}}
  for(const message of data.messages)if(message.type==='thread.result'&&message.metadata?.summaryStatus==='processing'){message.metadata.summaryStatus='pending';delete message.metadata.summaryRunId;}
  for(const project of data.projects){if(!project.folderPath)store.workspace(project.id);project.lastPermissionMode=project.lastPermissionMode==='auto'?'auto':'manual';store.ensureCoordinator(project.id);}
  for(const approval of data.approvals) if(approval.status==='pending') approval.status='expired';
  if(!data.providers.some(x=>x.id==='demo')) data.providers.unshift({id:'demo',name:'离线演示 · 确定性示例（非实时 AI）',type:'demo',baseUrl:'',model:'deterministic-example',keyEnv:''});
  for(const provider of data.providers)if(provider.type==='codex-cli'){provider.type='codex-app-server';if(provider.id==='codex-local')provider.name='Codex · 本机 Agent';}
  if(addDefaultCodexProvider&&!data.providers.some(x=>x.id==='codex-local'))data.providers.push({id:'codex-local',name:'Codex · 本机 Agent',type:'codex-app-server',baseUrl:'',model:'',keyEnv:''});
  if(!data.providers.some(x=>x.id==='claude-local'))data.providers.push({id:'claude-local',name:'Claude Code · Agent SDK',type:'claude-agent',baseUrl:'',model:'',keyEnv:'ANTHROPIC_API_KEY'});
  if(seed && !data.projects.length) {
    const p=store.createProject({name:'离线示例 · 系统工程工作台',description:'明确标识的确定性演示。选择本机 Codex 或配置 API 后可运行真实 AI。',instructions:'区分事实、假设和待验证项；用可追溯模型连接需求、功能、部件与测试。'});
    const t=store.get('threads',p.coordinatorThreadId);
    store.message(t.id,'assistant','这是离线说明，不是实时 AI 输出。可导入工程资料、编辑系统模型，或在设置中选择本机 Codex / 配置模型 API。命令执行需要逐项批准。');
  }
  store.save(); return store;
}
