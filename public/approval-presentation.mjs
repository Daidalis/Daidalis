// A display model only. Approval scope and permission decisions remain in the runtimes.
const COMMAND_TOOLS = new Set(['codex.commandExecution', 'run_command', 'Bash']);
const FILE_TOOLS = new Set(['codex.fileChange', 'write_file', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const CLAUDE_TOOLS = new Set(['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'TodoWrite', 'AskUserQuestion']);
const TITLES = {
  call_external_tool:'调用项目 MCP 工具',import_system_model:'保存 SysML 模型',prepare_nos3_model:'建立 NOS3 接口模型',validate_system_model:'检查 SysML 模型',verify_system_model:'求值模型约束',bind_nos3_results:'回填 NOS3 结果',submit_nos3_job:'运行 NOS3 作业',cancel_nos3_job:'停止 NOS3 作业',
  record_engineering_object:'记录工程对象', capture_configuration:'捕获观察快照', propose_engineering_change:'记录工程变更', record_engineering_evidence:'登记工程证据',
  update_model:'更新系统模型', create_artifact:'保存项目产物', update_project_memory:'更新项目记忆',
  save_professional_model:'保存原生模型',submit_professional_job:'运行专业求解',cancel_professional_job:'停止专业求解',prepare_professional_environment:'准备隔离求解环境',create_stf_case:'建立 STF 工程资产',
  run_engineering_model:'运行工程仿真', computer_use:'操作电脑', start_thread:'创建子线程',
  delegate_task:'创建子线程', steer_thread:'向子线程发送指令', web_fetch:'读取网页',
  read_file:'读取项目文件', read_thread:'读取子线程', search_files:'搜索项目文件',
};
const COMPUTER_TITLES = {
  'desktop.open_app':'打开桌面应用', 'desktop.screenshot':'读取桌面截图', 'desktop.click':'点击桌面',
  'desktop.type':'在桌面输入文字', 'desktop.key':'在桌面按键', 'browser.navigate':'打开网页',
  'browser.click':'点击网页', 'browser.type':'在网页输入文字', 'browser.key':'在网页按键',
  'browser.scroll':'滚动网页', 'browser.screenshot':'读取网页截图', 'browser.start':'启动浏览器',
  'browser.engineering':'打开工程工作面',
};
const TRANSPORT = new Set(['threadId', 'turnId', 'itemId', 'startedAtMs', 'environmentId', 'commandActions', 'native']);
const string = value => typeof value === 'string' ? value : '';
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
function json(value) { const result=JSON.stringify(value, null, 2); return result === undefined ? '' : result; }
function display(value) { return typeof value === 'string' ? value : value === undefined ? '' : json(value); }
function source(tool) { return tool.startsWith('codex.') ? 'Codex' : CLAUDE_TOOLS.has(tool) ? 'Claude Code' : 'Manta'; }
function remaining(args, omitted, native=false) {
  return Object.fromEntries(Object.entries(args).filter(([key])=>!omitted.has(key)&&!(native&&TRANSPORT.has(key))));
}

export function buildApprovalPresentation(approval={}) {
  const a=record(approval), tool=string(a.tool), args=record(a.args), native=tool.startsWith('codex.');
  const view={kind:'tool', title:TITLES[tool]||'使用工具', source:source(tool),
    reason:string(args.reason)||string(args.description), cwd:string(args.cwd),
    command:'', commandFormat:'shell', fields:[], blocks:[]};
  const field=(label,value)=>{if(value!==undefined&&value!==null&&value!=='')view.fields.push({label,value:display(value)});};
  const block=(label,content,format='text')=>{if(content!==undefined)view.blocks.push({label,content:display(content),format});};
  const extras=omitted=>{const rest=remaining(args,new Set(omitted),native);if(Object.keys(rest).length)block('其他参数',rest,'json');};

  if(COMMAND_TOOLS.has(tool)) {
    view.kind='command'; view.title='运行命令';
    if(Array.isArray(args.command)){view.command=json(args.command);view.commandFormat='argv';}
    else if(typeof args.command==='string')view.command=args.command;
    field('超时（毫秒）',args.timeoutMs??args.timeout);
    extras(['command','cwd','reason','description','timeoutMs','timeout',...(native?['kind','proposedExecpolicyAmendment','availableDecisions']:[])]);
    if(args.command!==undefined&&typeof args.command!=='string'&&!Array.isArray(args.command))block('命令参数',args.command,'json');
    return view;
  }

  if(FILE_TOOLS.has(tool)) {
    view.kind='files'; view.title=tool==='Write'||tool==='write_file'?'写入文件':'修改文件';
    if(tool==='codex.fileChange') {
      if(Array.isArray(args.changes))for(const change of args.changes){
        const c=record(change), kind=typeof c.kind==='string'?c.kind:string(c.kind?.type), file=string(c.path);
        const label=({add:'新增文件',update:'修改文件',delete:'删除文件'})[kind]||'文件';
        field(label,file||'未提供路径');
        if(kind&&!['add','update','delete'].includes(kind))field('变更类型',kind);
        if(c.kind&&typeof c.kind==='object'){
          field('移动到',c.kind.move_path??c.kind.movePath);
          const rest=remaining(c.kind,new Set(['type','move_path','movePath']));if(Object.keys(rest).length)block('变更属性',rest,'json');
        }
        if(c.diff!==undefined)block(file||'文件差异',c.diff,'diff');
        const rest=remaining(c,new Set(['path','kind','diff']));if(Object.keys(rest).length)block('文件变更参数',rest,'json');
      }
      else if(args.changes!==undefined)block('文件变更',args.changes,'json');
      field('授权目录',args.grantRoot);
      extras(['changes','cwd','reason','description','grantRoot','kind','proposedExecpolicyAmendment','availableDecisions']);
    } else {
      field('文件',args.file_path??args.path??args.notebook_path);
      if(args.content!==undefined)block('写入内容',args.content);
      if(args.old_string!==undefined)block('替换前',args.old_string);
      if(args.new_string!==undefined)block('替换后',args.new_string);
      if(args.replace_all!==undefined)field('替换所有匹配',args.replace_all?'是':'否');
      extras(['file_path','path','notebook_path','content','old_string','new_string','replace_all','cwd','reason','description']);
    }
    return view;
  }

  if(tool==='computer_use') {
    const action=string(args.action), nested=record(args.args), payload={...args,...nested}; delete payload.args;
    view.title=COMPUTER_TITLES[action]||'操作电脑';
    field('操作',action);field('网页',payload.url);field('应用',payload.toolId??payload.app);
    field('按键',payload.key);field('X 坐标',payload.x);field('Y 坐标',payload.y);
    field('水平滚动',payload.deltaX);field('垂直滚动',payload.deltaY);
    if(payload.text!==undefined)block('输入文字',payload.text);
    const rest=remaining(payload,new Set(['action','url','toolId','app','key','x','y','deltaX','deltaY','text','reason','description','cwd']));
    if(Object.keys(rest).length)block('操作参数',rest,'json');
    return view;
  }

  if(tool==='update_model') {
    field('模型版本',args.version);
    if(Array.isArray(args.nodes))field('模型元素',args.nodes.length);
    if(Array.isArray(args.links))field('模型关联',args.links.length);
    const content=remaining(args,new Set(['reason','description','cwd']),native);if(Object.keys(content).length)block('模型内容',content,'json');
    return view;
  }

  if(['record_engineering_object','capture_configuration','propose_engineering_change','record_engineering_evidence'].includes(tool)) {
    field('名称',args.title||args.name);field('对象 ID',args.id);
    field('对象版本',args.expectedRevision);field('对象类型',args.kind);
    field('参考快照',args.baseSnapshotId);field('受测配置',args.snapshotId);field('声明运行',args.runId);field('登记产物',args.artifactId);
    if(Array.isArray(args.objectIds))field('关联对象',args.objectIds.join('、'));
    if(Array.isArray(args.paths))field('选定文件',args.paths.join('\n'));
    field('证据范围',args.scope);field('原始结果',({passed:'登记为通过',failed:'登记为失败',inconclusive:'无法判定',not_executed:'未执行'})[args.result]);
    if(tool==='capture_configuration')view.reason='记录选定文件哈希和对象版本，形成未批准的观察快照。';
    else if(tool==='record_engineering_evidence')view.reason='登记声明证据；原始结果与当前适用性分开，不会自动批准需求。';
    if(args.description)block('对象说明',args.description);
    if(Array.isArray(args.sources)&&args.sources.length)field('来源',args.sources.join('\n'));
    if(Array.isArray(args.dependsOn)&&args.dependsOn.length)field('依赖对象',args.dependsOn.join('、'));
    return view;
  }

  if(tool==='call_external_tool') {
    field('连接',args.connectorName||args.connectorId);field('工具',args.toolName);
    field('操作类型',({read:'读取',write:'修改',run:'执行'})[args.effect]||args.effect);
    block('调用参数',args.arguments,'json');return view;
  }
  if(['import_system_model','prepare_nos3_model','validate_system_model','verify_system_model','bind_nos3_results'].includes(tool)) {
    field('模型文件',args.path||'models/nos3-attitude-interface.sysml');
    field('结果作业',args.jobId);
    if(tool==='bind_nos3_results')view.reason='将这次组件仿真的实际测量值写回模型，并检查约束。';
    if(args.content!==undefined)block('模型内容',args.content);
    return view;
  }
  if(['submit_nos3_job','cancel_nos3_job'].includes(tool)) {
    field('执行范围',({component:'NOS3 组件级仿真',build:'NOS3 构建',integration:'完整 NOS3/cFS/42 联合仿真'})[args.scope]);
    field('模型文件',args.modelFile);field('作业',args.jobId);
    if(tool==='submit_nos3_job')view.reason=args.scope==='component'?'在独立目录编译并运行已核对的 NOS3 组件源码，保留输入、日志和测量结果。':'提交到已配置的独立工程执行环境。';
    return view;
  }

  field('工具',tool);
  for(const [key,label]of [['path','文件'],['name','名称'],['model','工程模型'],['modelFile','模型文件'],['url','网页']])field(label,args[key]);
  if(['read_thread','steer_thread'].includes(tool))field('子线程',args.threadId);
  const omitted=['path','name','model','modelFile','url','reason','description','cwd'];
  if(['read_thread','steer_thread'].includes(tool))omitted.push('threadId');
  const content=remaining(args,new Set(omitted),native);if(Object.keys(content).length)block('操作内容',content,'json');
  if(a.args!==undefined&&(a.args===null||typeof a.args!=='object'||Array.isArray(a.args)))block('操作参数',a.args,'json');
  return view;
}
