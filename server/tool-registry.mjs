const list=value=>Array.isArray(value)?value:[];
const label=(value,fallback)=>typeof value==='string'&&value.trim()?value.trim().slice(0,180):fallback;
const hasError=value=>!!value?.error;
const STAGES={openmodelica:['architecture','simulation','verification'],omsimulator:['simulation','verification'],capella:['requirements','architecture'],papyrus:['architecture'],matlab:['simulation','verification'],simulink:['architecture','simulation','verification'],dymola:['simulation','verification'],amesim:['simulation','verification']};
const PROFESSIONAL_NAMES={openmodelica:'OpenModelica / OMEdit',omsimulator:'OMSimulator / FMI',capella:'Capella / Arcadia',papyrus:'Papyrus',matlab:'MATLAB',simulink:'Simulink',dymola:'Dymola',amesim:'Amesim'};

/** Presentation contract built only from trusted service snapshots. It never
 * connects to software, imports native extensions, or interprets tool output as UI. */
export function buildEngineeringRegistry({projectId,engineering={},modelBackend={},nos3={},connectors=[],computer={},professional={},geospatial=null,orbit42=null,orbitGround=null}={}){
  const selected=typeof projectId==='string'&&!!projectId;
  const entry=value=>({operations:[],views:[],limitations:[],nextStep:'',...value});
  const backend=modelBackend?.backend||{},sysmlReady=backend.available===true&&!hasError(modelBackend);
  const numerical=list(engineering?.tools).find(tool=>tool.id==='scipy')||{};
  const scipyReady=numerical.available===true&&!hasError(engineering);
  const scipyState=scipyReady?'ready':['blocked','missing','error'].includes(numerical.status)||hasError(engineering)?'blocked':'unverified';
  const scipyReason=scipyReady?'隔离数值环境已检查，可运行热控配方。':hasError(engineering)?'无法读取数值运行环境状态。':numerical.status==='timeout'?'运行环境检查超时，尚不能确认可运行。':numerical.status==='checking'?'正在检查数值运行环境。':numerical.status==='blocked'?label(numerical.detail,'当前执行位置不支持加载数值依赖。'):numerical.status==='missing'?'当前隔离环境缺少解释器或数值依赖。':numerical.status==='error'?'数值依赖加载失败，尚不能运行。':'运行环境尚未检查。';
  const worker=nos3?.worker||{},environment=nos3?.environment||{},recognized=!!nos3?.revision;
  const nos3Ready=selected&&recognized&&!hasError(nos3)&&worker.type==='local-linux-vm'&&environment.workerReady===true;
  const nos3Status=nos3Ready?'ready':hasError(nos3)||['failed','unavailable'].includes(environment.state)?'blocked':worker.configured?'configured':'unverified';
  const nos3Reason=nos3Ready?'本地 Linux Worker 已就绪，可执行星敏链验证配方。':!selected?'选择 NOS3 项目后检查执行环境。':hasError(nos3)?'当前项目的 NOS3 源码或执行环境检查未完成。':!recognized?'当前项目尚未识别为 NOS3 源码。':worker.configured&&worker.type!=='local-linux-vm'?'已配置远程 Worker，目录读取不验证其执行状态。':environment.guestReady?'Linux 虚拟机已启动，工程 Worker 尚未就绪。':'完整仿真需要准备隔离 Linux 执行环境。';
  const browser=computer?.browser||{},desktop=computer?.desktop||{};
  // available only means dependencies/platform support, not a launched browser
  // or granted macOS permissions. Preserve that distinction in the UI.
  const computerReady=!hasError(computer)&&(browser.status==='running'||desktop.status==='permissions-verified');
  const computerStatus=computerReady?'ready':hasError(computer)||(!browser.available&&!desktop.available)?'blocked':'unverified';
  const rows=Array.isArray(connectors)?connectors:list(connectors?.connectors);
  const connected=rows.filter(row=>row?.enabled!==false&&row?.status==='connected'&&row?.toolCount!==0);
  const entries=[
    entry({id:'engineering-records',name:'工程记录',stages:['requirements','architecture','verification','delivery'],integrated:true,ready:selected,status:selected?'ready':'unverified',reason:selected?'对象版本、观察快照、变更影响与证据适用性。':'选择项目后查看工程记录。',operations:['get_engineering_state','record_engineering_object','capture_configuration','propose_engineering_change','record_engineering_evidence'],views:['对象与来源历史','选定文件配置快照','变更影响与证据复核'],limitations:['快照记录选定文件哈希，不是完整工作区备份或恢复。','声明证据未核实执行来源，不能自动证明需求满足。','用户确认记录不等于正式身份签署或独立工程接受。'],action:'open-engineering-records'}),
    entry({id:'traceability',name:'需求与追溯',stages:['requirements','architecture','verification'],integrated:true,ready:selected,status:selected?'ready':'unverified',reason:selected?'项目内维护需求、接口、验证与证据的关联。':'选择项目后查看需求与追溯。',operations:['get_model','update_model'],views:['追溯图','节点与关联表'],limitations:['Manta 追溯图独立于 SysML 源模型，结构关联不代表需求已验证。'],action:'open-traceability'}),
    entry({id:'sysml',name:'SysML v2',stages:['requirements','architecture','verification'],integrated:true,ready:sysmlReady,status:sysmlReady?'ready':hasError(modelBackend)||backend.available===false?'blocked':'unverified',reason:sysmlReady?'语义内核已就绪'+(backend.version?' · '+label(backend.version,''):'')+'。':'SysML 语义内核尚未就绪。',operations:['model_backend_catalog','import_system_model','query_system_model','validate_system_model','verify_system_model','export_system_model','prepare_nos3_model','bind_nos3_results'],views:['语义模型图与大纲','源码、诊断与静态约束'],limitations:['图形视图用于浏览；模型修改由 Agent 写入并校验。','不执行 SysML 动态行为；受支持规则检查不等于完整 OMG 符合性认证。'],action:'open-model',nextStep:sysmlReady?'打开 .sysml 文件或让 Agent 建立模型。':'在工程连接中检查模型后端。'}),
    entry({id:'scipy',name:'SciPy 热控',stages:['simulation','verification'],integrated:true,ready:scipyReady,status:scipyState,reason:scipyReason,operations:['engineering_catalog','run_engineering_model','get_engineering_run'],views:['参数与热网络','温度曲线、扫描表与判据'],limitations:['仅支持 thermal-control-v1 双节点热控配方，不是任意物理模型求解器。','数值结果尚未经过实物标定。'],action:numerical.status==='blocked'?'open-integrations':scipyReady?'open-engineering':'recheck-engineering',nextStep:numerical.status==='blocked'?'配置经过验证的隔离执行环境或本地依赖目录。':scipyReady?'修改热控参数并运行。':'检查运行环境；不会安装软件。'}),
    entry({id:'nos3',name:'NOS3 / cFS / 42',stages:['simulation','verification'],integrated:true,ready:nos3Ready,status:nos3Status,reason:nos3Reason,operations:['inspect_nos3','prepare_nos3_environment','submit_nos3_job','get_nos3_job','wait_nos3_job','cancel_nos3_job'],views:['场景与遥测曲线','验证判据、模型快照与证据'],limitations:['执行专用星敏软件链配方；不是任意 SysML 自动生成仿真。','SysML 仅绑定版本并回传结果；不包含硬件在环、硬实时或全设备任务验收。'],action:nos3Ready?'open-simulations':'open-integrations',nextStep:nos3Ready?'查看已有结果，或让 Agent 提交新的验证作业。':'在工程连接中准备本地 Linux 环境或配置远程 Worker。'}),
    entry({id:'documents',name:'项目文档',stages:['requirements','delivery'],integrated:true,ready:selected,status:selected?'ready':'unverified',reason:selected?'在 Manta 阅读项目报告与源文件。':'选择项目后查看文档。',operations:['list_files','read_file','write_file','create_artifact'],views:['Markdown 阅读与源码','栅格图片','JSON / CSV 表格与数值图'],limitations:['PDF、Office、CAD 和专业模型原生格式尚无完整查看器。'],action:'open-library'}),
    entry({id:'computer',name:'Computer Use',stages:['integration'],integrated:true,ready:computerReady,status:computerStatus,reason:computerReady?'已有可操作的浏览器或经过权限确认的桌面会话。':hasError(computer)?'无法读取 Computer 状态。':browser.available?'浏览器组件可用，尚未启动并验证会话。':desktop.available?'桌面桥可用，仍需授予系统权限。':'当前没有可用的浏览器组件或桌面桥。',operations:['computer_use'],views:['隔离浏览器截图与操作','macOS 桌面截图与操作'],limitations:['操作能力不代表工程软件已安装或许可证可用。','没有嵌入专业软件原生界面，macOS 桌面仍需系统授权。'],action:'open-computer',nextStep:'在 Computer 中打开操作会话。'}),
    entry({id:'external-mcp',name:'外部 MCP',stages:['integration'],integrated:true,ready:connected.length>0,status:hasError(connectors)?'blocked':connected.length?'ready':rows.length?'configured':'unverified',reason:hasError(connectors)?'无法读取项目 MCP 配置。':connected.length?'已有通过连接检查的服务；具体操作按工具结果确认。':rows.length?'项目已配置 MCP 服务，尚无可确认的连接。':'当前项目尚未配置外部 MCP 服务。',operations:['list_external_tools','call_external_tool'],views:['连接与工具说明','结构化工具结果'],limitations:['仅接入 tools/list 与 tools/call；不承诺第三方原生界面或 MCP Apps。'],action:'open-integrations',nextStep:'配置已有的 stdio 或 HTTP MCP 服务，再测试连接。'}),
  ];
  const modelica=list(professional?.tools).find(tool=>tool.id==='openmodelica');
  if(modelica){const environment=modelica.environment||{},ready=environment.ready===true||environment.state==='ready';entries.push(entry({id:'openmodelica',name:'OpenModelica',stages:STAGES.openmodelica,integrated:true,ready,status:ready?'ready':environment.state==='failed'?'blocked':'configured',reason:ready?'隔离 Linux 原生编译与求解环境已就绪。':environment.message||'已接入原生模型与执行适配器；准备隔离环境后运行。',operations:['professional_catalog','prepare_professional_environment','read_professional_model','save_professional_model','submit_professional_job','wait_professional_job','get_professional_job','cancel_professional_job'],views:['原生源码编辑与版本检查','参数、仿真、求解诊断与曲线'],limitations:['数值模型需要按用途审查和标定；求解成功不代表完整系统已验证。'],action:'open-professional',nextStep:'打开项目 .mo 模型，校验、修改参数并运行。'}));}
  if(geospatial){
    const env=geospatial.environment||{},ready=!hasError(geospatial)&&env.ready===true&&env.status==='ready';
    const blocked=hasError(geospatial)||['blocked','closed','unavailable','update-available'].includes(env.status);
    entries.push(entry({id:'gdal-proj',name:'GDAL / PROJ',stages:['verification'],integrated:true,ready,status:ready?'ready':blocked?'blocked':'configured',reason:ready?'隔离 Linux 中的 GDAL / PROJ 工具链已通过版本及哈希检查。':blocked?'GIS 工具链检查失败或版本已改变，需要在隔离环境中复核。':'GIS 作业服务已接入，隔离工具链尚未准备或验证。',operations:['geospatial_catalog','prepare_geospatial_environment','submit_geospatial_job','get_geospatial_job','wait_geospatial_job','cancel_geospatial_job'],views:['GeoJSON 地图预览','控制点判据与原始来源回执'],limitations:['仅对项目内 Shapefile ZIP 执行 CRS 与行政区几何控制点检查，不证明轨道覆盖、地面许可或 STF 任务满足。','地图预览经过简化与 EPSG:4326 转换，判定使用原始几何；WGS84 与 NAD83 转换误差需独立评估。'],action:'open-library',nextStep:ready?'让 Agent 对具有来源哈希和明确 CRS 的 Shapefile ZIP 运行控制点检查。':'让 Agent 显式准备或复核隔离 GIS 环境。'}));
  }
  if(orbit42){
    const env=orbit42.environment||{},ready=!hasError(orbit42)&&env.ready===true&&env.state==='ready';
    const blocked=hasError(orbit42)||env.state==='blocked';
    entries.push(entry({id:'nasa-42',name:'NASA 42 · 轨道动力学',stages:['simulation','verification'],integrated:true,ready,status:ready?'ready':blocked?'blocked':'configured',reason:ready?'隔离 Linux 中的 NASA 42 可执行文件哈希已核验；每次执行前仍须重新核验固定资产。':blocked?'NASA 42 环境检查失败，需要复核隔离执行环境。':'NASA 42 作业服务已接入，隔离可执行文件尚未准备或验证。',operations:['orbit42_catalog','read_orbit42_model','save_orbit42_model','submit_orbit42_job','get_orbit42_job','wait_orbit42_job','cancel_orbit42_job'],views:['轨迹 CSV 与数值曲线','原生输出、诊断与运行回执'],limitations:['仅支持有界短程参考轨道模型；结果没有建立经认证的坐标框架转换、星敏视场或地面覆盖。','单项轨道求解不代表 STF 系统级仿真、完整任务验证或实物验收。'],action:'open-library',nextStep:ready?'让 Agent 从有版本的 .orbit42.json 模型提交短程参考轨道作业。':'让 Agent 准备并校验隔离 Linux 中的 NASA 42。'}));
  }
  if(orbitGround){
    const env=orbitGround.environment||{},ready=!hasError(orbitGround)&&env.ready===true;
    entries.push(entry({id:'orbit-ground',name:'42 轨迹 × 地理边界交叉检查',stages:['verification'],integrated:true,ready,status:ready?'ready':env.state==='blocked'||hasError(orbitGround)?'blocked':'configured',reason:ready?'隔离交叉检查环境就绪；提交时仍核验原生 42 回执和项目数据哈希。':env.reason||'需要经过验证的 42 轨道作业和项目边界数据。',operations:['orbit_ground_catalog','submit_orbit_ground_job','get_orbit_ground_job','wait_orbit_ground_job','cancel_orbit_ground_job'],views:['地面轨迹 GeoJSON','采样分类 CSV 与哈希回执'],limitations:['仅分类星下点，不能推断传感器视场、覆盖、重访或任务验收。','源 ZIP 的字节哈希不单独证明官方来源。'],action:'open-library',nextStep:ready?'让 Agent 选择已验证的 42 作业和导入数据运行交叉检查。':'先准备并核验隔离工具和输入来源。'}));
  }
  for(const native of list(professional?.tools).filter(t=>['ngspice','openscad','nos3-stf'].includes(t.id))){const env=native.environment||{},ready=env.ready===true;entries.push(entry({id:native.id,name:native.name,stages:native.id==='openscad'?['architecture','verification']:['simulation','verification'],integrated:true,ready,status:ready?'ready':'configured',reason:ready?'原生工具与隔离执行环境已检查。':env.reason||env.message||'执行适配器已接入，环境尚未就绪。',operations:['read_professional_model','save_professional_model','submit_professional_job','wait_professional_job'],views:native.id==='openscad'?['原生参数化源码','真实 STL 三维网格']:['原生源码','执行、诊断与实际数据曲线'],limitations:['工具执行与当前模型的结果不代表完整系统或实物验证完成。'],action:'open-professional',nextStep:'打开原生模型并执行校验或仿真。'}));}
  for(const row of rows.slice(0,30)){
    if(!row||typeof row.id!=='string')continue;
    const enabled=row.enabled!==false,ready=enabled&&row.status==='connected'&&row.toolCount!==0;
    entries.push(entry({id:'mcp:'+label(row.id,'connection'),name:label(row.name,'MCP 服务'),stages:['integration'],integrated:true,ready,status:!enabled?'disabled':ready?'ready':['error','disconnected'].includes(row.status)?'blocked':'configured',reason:!enabled?'此连接已停用。':ready?'连接与工具发现已验证；单个工具执行仍需实际检查。':row.status==='connected'&&row.toolCount===0?'服务未返回可调用工具。':['error','disconnected'].includes(row.status)?'连接失败或已断开。':'已保存配置，尚未验证连接。',operations:['list_external_tools','call_external_tool'],views:['工具说明与输入格式','结构化结果'],limitations:['尚无此服务专用的图形编辑器或结果视图。'],action:'open-integrations',nextStep:enabled?'在工程连接中测试连接或查看工具。':'需要时重新启用连接。'}));
  }
  for(const tool of list(engineering?.tools)){
    if(!tool||(modelica&&tool.id==='openmodelica')||tool.id==='scipy'||tool.id==='sysml-v2'||!Object.hasOwn(PROFESSIONAL_NAMES,tool.id))continue;
    const detected=tool.detected===true||tool.installed===true;
    entries.push(entry({id:tool.id,name:PROFESSIONAL_NAMES[tool.id],stages:STAGES[tool.id],integrated:false,ready:false,status:'not-integrated',reason:detected?'检测到安装文件，但尚未接入执行接口。':'尚未接入执行接口；在已检查位置也未检测到软件。',operations:[],views:[],limitations:['检测不是版本、许可证或执行验收。','Computer Use 可辅助操作已有软件，但不等于原生工具集成。'],action:'open-integrations',nextStep:'接入已有 MCP 服务或实现版本明确的隔离执行适配器。'}));
  }
  return {schema:'manta-engineering-capabilities-v1',projectId:projectId||null,entries,observedAt:new Date().toISOString()};
}

/** Read each source once; one failed source cannot erase other capabilities.
 * recheck applies only to the explicit numerical runtime probe. No connector
 * is connected/tested and no GUI, VM, package manager or simulation is started. */
export async function collectEngineeringCatalog({projectId,engineering,professionalModels,geospatialJobs,orbit42Jobs,orbitGroundJobs,modelBackend,nos3,connectors,computer,recheck=false,signal}={}){
  if(signal?.aborted)throw Error('Cancelled');
  const sources={
    professional:()=>professionalModels?.catalog?professionalModels.catalog({projectId}):({}),
    engineering:()=>engineering?.catalog?engineering.catalog({recheck:recheck===true},{signal}):({tools:[],models:[],error:true}),
    modelBackend:()=>modelBackend?.catalog?modelBackend.catalog({projectId}):({error:true}),
    nos3:()=>projectId&&nos3?.inspect?nos3.inspect({projectId},{signal}):({error:!!projectId}),
    connectors:()=>projectId&&connectors?.list?connectors.list(projectId):[],
    computer:()=>computer?.status?computer.status():({error:true}),
    ...(geospatialJobs?{geospatial:()=>geospatialJobs.catalog({projectId})}:{}),
    ...(orbit42Jobs?{orbit42:()=>orbit42Jobs.catalog({projectId})}:{}),
    ...(orbitGroundJobs?{orbitGround:()=>orbitGroundJobs.catalog({projectId})}:{}),
  };
  const values=await Promise.allSettled(Object.values(sources).map(read=>Promise.resolve().then(read)));
  if(signal?.aborted)throw Error('Cancelled');
  const snapshots=Object.fromEntries(Object.keys(sources).map((key,i)=>[key,values[i].status==='fulfilled'?(values[i].value??{error:true}):{error:true}]));
  const legacy=snapshots.engineering;
  return {...legacy,tools:list(legacy?.tools),models:list(legacy?.models),registry:buildEngineeringRegistry({projectId,...snapshots})};
}
