import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import { safePath, spawnBounded } from './sandbox.mjs';

const MODEL='thermal-control-v1';
const FILES=['model.json','model.py','parameters.json','result.json','series.csv','temperature.svg','manifest.json','requirements.json'];
export const parameterDefinitions=[
  ['payloadCapacity','载荷热容','J/K',240,20,20000],['chassisCapacity','机箱热容','J/K',800,20,50000],
  ['coupling','载荷—机箱热导','W/K',1.2,0.02,20],['loss','机箱—环境热导','W/K',0.5,0.02,20],
  ['ambientBefore','初始环境温度','°C',5,-60,60],['ambientAfter','扰动后环境温度','°C',-5,-60,60],
  ['initialTemperature','初始节点温度','°C',22,-50,80],['setpoint','设定温度','°C',25,0,60],
  ['internalHeat','载荷耗散','W',2,0,100],['heaterMax','加热器上限','W',18,0,150],
  ['kp','比例增益','W/K',4,0,100],['ki','积分增益','W/(K·s)',0.02,0,1],
  ['duration','仿真时长','s',3600,120,14400],['disturbanceTime','扰动时刻','s',1800,1,14399],
  ['minTemperature','需求温度下限','°C',20,-60,80],['maxTemperature','需求温度上限','°C',30,-50,100],
  ['finalTolerance','末段跟踪误差限','K',1,0.05,10],
].map(([key,label,unit,value,min,max])=>({key,label,unit,default:value,min,max}));
const DEFAULTS=Object.fromEntries(parameterDefinitions.map(p=>[p.key,p.default]));
export function validateParameters(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('parameters 必须是对象');
  for(const k of Object.keys(input))if(!Object.hasOwn(DEFAULTS,k))throw Error('未知参数 '+k);
  const p={...DEFAULTS,...input};
  for(const d of parameterDefinitions)if(!Number.isFinite(p[d.key])||p[d.key]<d.min||p[d.key]>d.max)throw Error(`${d.key} 超出边界 ${d.min}…${d.max} ${d.unit}`);
  if(p.disturbanceTime>=p.duration)throw Error('扰动时刻须小于仿真时长');
  if(p.minTemperature>=p.maxTemperature)throw Error('需求温度上下限次序错误');
  return p;
}
const PYTHON=String.raw`import sys,json,csv,platform,hashlib
from pathlib import Path
import numpy as np
import scipy
from scipy.integrate import solve_ivp
from scipy.linalg import expm
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

folder=Path(sys.argv[1]); cfg=json.loads((folder/'parameters.json').read_text()); p=cfg['parameters']
def solve(p):
    Cp,Cc,G,L=p['payloadCapacity'],p['chassisCapacity'],p['coupling'],p['loss']
    def ambient(t): return p['ambientBefore'] if t < p['disturbanceTime'] else p['ambientAfter']
    def heating(T,z): return float(np.clip(p['kp']*(p['setpoint']-T)+p['ki']*z,0,p['heaterMax']))
    def rhs(t,y,Ta):
        Tp,Tc,z,E=y; error=p['setpoint']-Tp; raw=p['kp']*error+p['ki']*z; h=heating(Tp,z)
        dz=error if ((raw>0 and raw<p['heaterMax']) or (raw>=p['heaterMax'] and error<0) or (raw<=0 and error>0)) else 0.0
        return [(p['internalHeat']+h-G*(Tp-Tc))/Cp,(G*(Tp-Tc)-L*(Tc-Ta))/Cc,dz,p['internalHeat']+h-L*(Tc-Ta)]
    y0=[p['initialTemperature'],p['initialTemperature'],0,0]; times=[]; states=[]; evaluations=0
    for a,b,Ta in [(0,p['disturbanceTime'],p['ambientBefore']),(p['disturbanceTime'],p['duration'],p['ambientAfter'])]:
        grid=np.linspace(a,b,max(3,int((b-a)/2)+1)); sol=solve_ivp(lambda t,y:rhs(t,y,Ta),(a,b),y0,method='RK45',t_eval=grid,rtol=1e-7,atol=1e-9,max_step=5)
        if not sol.success: raise RuntimeError(sol.message)
        evaluations+=sol.nfev
        if times: grid=grid[1:]; vals=sol.y[:,1:]
        else: vals=sol.y
        times.extend(grid.tolist()); states.extend(vals.T.tolist()); y0=sol.y[:,-1].tolist()
    t=np.asarray(times); y=np.asarray(states); heater=np.array([heating(a,b) for a,b in zip(y[:,0],y[:,2])]); Ta=np.where(t<p['disturbanceTime'],p['ambientBefore'],p['ambientAfter'])
    # Independent reference: constant ambient + constant heater linear system via matrix exponential.
    A=np.array([[-G/Cp,G/Cp],[G/Cc,-(G+L)/Cc]]); b=np.array([(p['internalHeat']+min(5,p['heaterMax']))/Cp,L*p['ambientBefore']/Cc]); equilibrium=np.linalg.solve(A,-b)
    oracle_t=np.linspace(0,600,61); reference=np.array([equilibrium+expm(A*x)@(np.array(y0[:2])-equilibrium) for x in oracle_t]); numeric=solve_ivp(lambda t,x:A@x+b,(0,600),y0[:2],t_eval=oracle_t,rtol=1e-9,atol=1e-11,max_step=5)
    oracle_error=float(np.max(np.abs(reference-numeric.y.T)))
    net=p['internalHeat']+heater-L*(y[:,1]-Ta); dt=np.diff(t)
    # Integrate separately per ambient segment to avoid treating the forcing step as a ramp.
    integral=0.0
    for i in range(len(dt)):
        env=p['ambientBefore'] if t[i]<p['disturbanceTime'] else p['ambientAfter']
        f0=p['internalHeat']+heater[i]-L*(y[i,1]-env);f1=p['internalHeat']+heater[i+1]-L*(y[i+1,1]-env)
        integral+=(f0+f1)*dt[i]/2
    stored=Cp*(y[-1,0]-p['initialTemperature'])+Cc*(y[-1,1]-p['initialTemperature']); balance=abs(stored-integral)/max(1,float(np.sum(np.abs(net[:-1])*dt)))
    last=t>=p['duration']*0.9; err=float(np.max(np.abs(y[last,0]-p['setpoint']))); E=float(np.sum((heater[:-1]+heater[1:])*dt/2))
    metrics={'minTemperature':float(y[:,0].min()),'maxTemperature':float(y[:,0].max()),'finalWindowError':err,'heaterEnergyWh':E/3600,'energyBalanceRelativeError':balance,'analyticOracleErrorK':oracle_error,'nfev':evaluations}
    checks=[{'id':'T-MIN','requirement':'R-TEMP-MIN','name':'全时域载荷温度下限','passed':metrics['minTemperature']>=p['minTemperature'],'actual':metrics['minTemperature'],'limit':p['minTemperature'],'unit':'°C'},
    {'id':'T-MAX','requirement':'R-TEMP-MAX','name':'全时域载荷温度上限','passed':metrics['maxTemperature']<=p['maxTemperature'],'actual':metrics['maxTemperature'],'limit':p['maxTemperature'],'unit':'°C'},
    {'id':'TRACK','requirement':'R-TRACK','name':'末10%时域跟踪误差','passed':err<=p['finalTolerance'],'actual':err,'limit':p['finalTolerance'],'unit':'K'},
    {'id':'ENERGY','requirement':'R-CONSERVATION','name':'独立梯形积分能量守恒','passed':balance<0.005,'actual':balance,'limit':0.005,'unit':'relative'},
    {'id':'ORACLE','requirement':'R-NUMERICS','name':'线性极限与矩阵指数解析解对照','passed':oracle_error<1e-5,'actual':oracle_error,'limit':1e-5,'unit':'K'}]
    for c in checks: c['passed']=bool(c['passed']); c['actual']=float(c['actual'])
    return {'parameters':p,'metrics':metrics,'constraints':checks,'passed':all(c['passed'] for c in checks),'series':{'time':t.tolist(),'payload':y[:,0].tolist(),'chassis':y[:,1].tolist(),'ambient':Ta.tolist(),'heater':heater.tolist()}}

nominal=solve(p); scenarios=[]
if cfg.get('scan'):
    for v in cfg['scan']['values']:
        pp=dict(p);pp[cfg['scan']['parameter']]=v; rr=solve(pp)
        scenarios.append({'parameter':cfg['scan']['parameter'],'value':v,'metrics':rr['metrics'],'constraints':rr['constraints'],'passed':rr['passed']})
result={'solver':{'name':'SciPy solve_ivp','method':'RK45','scipyVersion':scipy.__version__,'numpyVersion':np.__version__,'pythonVersion':platform.python_version(),'matplotlibVersion':matplotlib.__version__,'rtol':1e-7,'atol':1e-9,'maxStepSeconds':5},**nominal,'scenarios':scenarios}
(folder/'result.json').write_text(json.dumps(result,ensure_ascii=False,allow_nan=False))
s=nominal['series']
with (folder/'series.csv').open('w',newline='') as f:
    writer=csv.writer(f);writer.writerow(['time_s','payload_degC','chassis_degC','ambient_degC','heater_W']);writer.writerows(zip(s['time'],s['payload'],s['chassis'],s['ambient'],s['heater']))
fig,ax=plt.subplots(figsize=(10,4.3));ax.plot(s['time'],s['payload'],label='Payload');ax.plot(s['time'],s['chassis'],label='Chassis');ax.plot(s['time'],s['ambient'],label='Ambient',linestyle='--');ax.axhline(p['minTemperature'],color='#b85c46',ls=':',label='Temperature limits');ax.axhline(p['maxTemperature'],color='#b85c46',ls=':');ax.set(xlabel='Time [s]',ylabel='Temperature [degC]',title='Declared two-node thermal control model / SciPy');ax.grid(alpha=.2);ax.legend();fig.tight_layout();fig.savefig(folder/'temperature.svg');plt.close(fig)
print(json.dumps({'success':True,'scenarios':len(scenarios)+1,'scipyVersion':scipy.__version__}))
`;

function findExe(names){for(const n of names){const candidates=n.includes('/')?[n]:(process.env.PATH||'').split(path.delimiter).filter(Boolean).map(dir=>path.join(dir,n));for(const p of candidates)try{fss.accessSync(p,fss.constants.X_OK);if(fss.statSync(p).isFile())return p;}catch{}}return null;}
const listApplications=()=>{try{return fss.readdirSync('/Applications');}catch{return [];}};
const isDirectory=p=>{try{return fss.statSync(p).isDirectory();}catch{return false;}};
const resolveExecutable=p=>{try{return fss.realpathSync(p);}catch{return p;}};

// Detection is deliberately bounded: PATH, named launchers, and one /Applications listing.
// Never launch a product or check out a license merely to populate its catalog entry.
export function professionalToolCatalog({findExecutable=findExe,applicationNames=listApplications,directoryExists=isDirectory,realpath=resolveExecutable}={}){
  const matlabRoots=applicationNames().filter(name=>/^MATLAB[^/]*\.app$/i.test(name)).sort().reverse().map(name=>path.join('/Applications',name));
  const matlab=findExecutable(['matlab',...matlabRoots.flatMap(dir=>[path.join(dir,'bin/matlab'),path.join(dir,'Contents/MacOS/MATLAB')])]);
  if(matlab){const resolved=realpath(matlab);if(path.basename(resolved)==='matlab'&&path.basename(path.dirname(resolved))==='bin')matlabRoots.unshift(path.dirname(path.dirname(resolved)));}
  // MATLAB alone is not evidence of the optional Simulink product.
  const simulinkProduct=[...new Set(matlabRoots)].map(dir=>path.join(dir,'toolbox/simulink')).find(directoryExists)||null;
  const simulinkRoot=simulinkProduct?path.dirname(path.dirname(simulinkProduct)):null;
  const simulinkLauncher=simulinkRoot?findExecutable([path.join(simulinkRoot,'bin/matlab'),path.join(simulinkRoot,'Contents/MacOS/MATLAB')]):null;
  const tools=[
    {id:'openmodelica',name:'OpenModelica / OMEdit',role:'Modelica 方程建模与图形编辑',executable:findExecutable(['omc','/Applications/OpenModelica.app/Contents/MacOS/omc']),interface:'omc scripting loadFile/checkModel/simulate',source:'https://openmodelica.org/doc/OpenModelicaUsersGuide/latest/scripting_api.html'},
    {id:'omsimulator',name:'OMSimulator',role:'FMI/SSP 协同仿真',executable:findExecutable(['OMSimulator','omsimulator']),interface:'FMU/SSP + Python/C API',source:'https://github.com/OpenModelica/OMSimulator'},
    {id:'capella',name:'Eclipse Capella',role:'Arcadia 系统架构建模',executable:findExecutable(['/Applications/Capella.app/Contents/MacOS/capella','capella']),interface:'Python4Capella / EASE / Java EMF API',source:'https://github.com/labs4capella/python4capella'},
    {id:'papyrus',name:'Eclipse Papyrus',role:'UML/SysML 建模',executable:findExecutable(['/Applications/Papyrus.app/Contents/MacOS/papyrus','papyrus']),interface:'EMF UML2 model APIs / model transformations',source:'https://eclipse.dev/papyrus/'},
    {id:'matlab',name:'MATLAB',role:'数值计算、数据分析与控制设计；控制设计功能可能另需工具箱',executable:matlab,interface:'MATLAB batch / Engine API；需对应产品、工具箱、许可与版本适配，尚未集成',source:'https://www.mathworks.com/help/matlab/matlab_env/start-matlab-on-macintosh-platforms.html'},
    {id:'simulink',name:'Simulink',role:'框图与动态系统建模、离散采样与混合系统仿真；代码生成另需相应产品',executable:simulinkLauncher,productPath:simulinkProduct,hostToolId:'matlab',detected:!!simulinkProduct,interface:'MATLAB/Simulink model API；需 MATLAB、Simulink 产品与许可。C/C++ 代码生成另需 Simulink Coder 等相应产品及许可；尚未集成',source:'https://www.mathworks.com/help/simulink/ug/types-of-sample-time.html',sources:[{url:'https://www.mathworks.com/help/simulink/ug/types-of-sample-time.html',title:'Simulink sample times'},{url:'https://www.mathworks.com/help/rtw/',title:'Simulink Coder'}]},
    {id:'sysml-v2',name:'SysML v2 API 服务',role:'系统模型仓库与查询',executable:null,interface:'需显式配置已运行的 REST/HTTP endpoint；本轮未连接',source:'https://github.com/Systems-Modeling/SysML-v2-API-Services'},
    ...['Amesim','Dymola'].map(name=>({id:name.toLowerCase(),name,role:'专业行为/多物理仿真',executable:null,interface:'需用户已安装软件、许可证和版本适配；未配置',source:null}))
  ];
  return tools.map(t=>{const detected=t.detected??!!t.executable;return {...t,installed:detected,detected,integrated:false,available:false,status:detected?'detected-not-integrated':'missing',licenseVerified:false,versionVerified:false,launchVerified:false,detection:'仅检查 PATH、明确启动路径及 /Applications 顶层 MATLAB*.app；Simulink 另检查对应安装内的 toolbox/simulink 目录。未启动软件、验证版本或测试许可证；missing 仅表示在这些位置未检测到。'};});
}
// macOS native extensions on network volumes may trigger Gatekeeper. Do not
// load them automatically or remove quarantine; execution belongs in an isolated
// worker, or an explicitly configured local dependency directory.
export function dependencyLocationPolicy(dependencies,{platform=process.platform,resolvePath=resolveExecutable,readMounts=()=>{
  const result=spawnSync('/sbin/mount',[],{encoding:'utf8',timeout:3000,maxBuffer:200000});
  if(result.error||result.status!==0)throw Error('Mount inventory unavailable');
  return result.stdout;
}}={}){
  if(platform!=='darwin')return {blocked:false,kind:'local-or-worker'};
  const resolved=resolvePath(path.resolve(dependencies));
  try{
    const mounts=String(readMounts()).split('\n').map(line=>/ on (.+) \(([^)]+)\)$/.exec(line)).filter(Boolean)
      .map(match=>({path:match[1].replace(/\\040/g,' '),type:match[2].split(',')[0].trim()}))
      .filter(m=>resolved===m.path||resolved.startsWith(m.path==='/'?'/':m.path+'/')).sort((a,b)=>b.path.length-a.path.length);
    const filesystem=mounts[0]?.type;
    if(['smbfs','nfs','afpfs','webdav','cifs','sshfs','fuse.sshfs'].includes(filesystem))return {blocked:true,kind:'network',fileSystem:filesystem,reasonCode:'network-dependencies-blocked',detail:'网络磁盘依赖不在本机自动加载，请连接隔离执行环境。'};
    if(filesystem)return {blocked:false,kind:'local',fileSystem:filesystem};
  }catch{}
  if(resolved.startsWith('/Volumes/'))return {blocked:true,kind:'unverified-volume',reasonCode:'dependency-location-unverified',detail:'无法确认依赖所在磁盘类型，暂不加载本机扩展；请使用已确认的本地依赖或隔离执行环境。'};
  return {blocked:false,kind:'local'};
}
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const SCOPE='declared-model-numerical-analysis';
export async function createEngineeringService({root,dataDir,store,emit=()=>{},pythonPath,professionalCatalog=professionalToolCatalog,probeExecutor=spawnBounded,probeTimeoutMs=120000,locationPolicy=dependencyLocationPolicy}={}){
  root=root||process.cwd();dataDir=dataDir||path.join(root,'.local');
  const python=pythonPath||process.env.MBSE_PYTHON||findExe([path.join(root,'.venv',process.platform==='win32'?'Scripts':'bin',process.platform==='win32'?'python.exe':'python3'),'python3','python']);
  const dependencies=process.env.MBSE_ENGINEERING_DEPS||path.join(root,'.local','engineering-deps');
  const env={PATH:process.env.PATH||'/usr/bin:/bin',PYTHONPATH:dependencies,PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1',MPLCONFIGDIR:path.join(dataDir,'engineering-mpl')};
  // NAS dependencies can take longer to import on a cold mount. Listing tools
  // must remain cheap and must not turn a transient timeout into "not installed".
  const pythonDetected=!!python&&!!findExe([python]);
  let runtime={available:false,status:pythonDetected?'unverified':'missing',name:'SciPy numerical simulation',
    detail:pythonDetected?'尚未检查运行环境；首次求解前会自动检查。':'未找到配置的 Python 解释器。',
    reasonCode:pythonDetected?'not-checked':'missing-python',retryable:true,probedAt:null};
  const initialLocation=locationPolicy(dependencies);
  if(initialLocation.blocked)runtime={...runtime,status:'blocked',reasonCode:initialLocation.reasonCode,detail:initialLocation.detail,retryable:false,location:initialLocation};
  let probePromise;
  const probeLimit=Math.max(1000,Math.min(180000,Number(probeTimeoutMs)||120000));
  const snapshot=()=>({...runtime,...(runtime.versions?{versions:{...runtime.versions}}:{})});
  function waitForProbe(promise,signal){
    if(signal?.aborted)return Promise.reject(Error('Cancelled'));
    if(!signal)return promise;
    return new Promise((resolve,reject)=>{
      const abort=()=>{cleanup();reject(Error('Cancelled'));};
      const cleanup=()=>signal.removeEventListener('abort',abort);
      signal.addEventListener('abort',abort,{once:true});
      promise.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
    });
  }
  async function probeRuntime({force=false,signal}={}){
    if(signal?.aborted)throw Error('Cancelled');
    const location=locationPolicy(dependencies);
    if(location.blocked){runtime={available:false,status:'blocked',name:'SciPy numerical simulation',reasonCode:location.reasonCode,detail:location.detail,retryable:false,probedAt:null,location};return snapshot();}
    if(probePromise)return waitForProbe(probePromise,signal);
    if(runtime.available&&!force)return snapshot();
    const previous=snapshot();
    runtime={...runtime,available:false,status:'checking',detail:'正在检查数值运行环境…',reasonCode:'checking'};
    const pending=(async()=>{
      const at=new Date().toISOString();
      try{
        if(!python||!findExe([python])){
          runtime={available:false,status:'missing',name:'SciPy numerical simulation',reasonCode:'missing-python',detail:'未找到配置的 Python 解释器。',retryable:true,probedAt:at};
          return snapshot();
        }
        // Match the actual solver's isolated Python import path. A local check
        // must not accidentally succeed against unrelated user/site packages.
        const source=`import sys;sys.path.insert(0,${JSON.stringify(dependencies)});\nimport scipy,numpy,matplotlib,json;print(json.dumps({"python":sys.version.split()[0],"scipy":scipy.__version__,"numpy":numpy.__version__,"matplotlib":matplotlib.__version__}))`;
        const result=await probeExecutor(python,['-I','-c',source],{env,timeoutMs:probeLimit,maxBytes:64000});
        if(result.code!==0){
          const detail=String(result.stderr||result.stdout||'Python dependency check failed').slice(-1000);
          const missing=/ModuleNotFoundError|No module named/i.test(detail);
          runtime={available:false,status:missing?'missing':'error',name:'SciPy numerical simulation',reasonCode:missing?'missing-dependency':'import-failed',detail:missing?'数值依赖未安装到当前隔离环境。':'数值依赖加载失败，可重新检查。',diagnostic:detail,retryable:true,probedAt:at};
        } else {
          const versions=JSON.parse(result.stdout);
          if(!['python','scipy','numpy','matplotlib'].every(key=>typeof versions[key]==='string'&&versions[key]))throw Error('Invalid numerical runtime version response');
          runtime={available:true,status:'available',name:'SciPy numerical simulation',versions,executable:python,reasonCode:'ready',detail:'数值运行环境已就绪。',retryable:true,probedAt:at,lastSuccessfulAt:at};
        }
      }catch(error){
        const diagnostic=String(error?.message||error).slice(-1000),timedOut=/timed?\s*out|timeout/i.test(diagnostic);
        runtime={available:false,status:timedOut?'timeout':'error',name:'SciPy numerical simulation',reasonCode:timedOut?'probe-timeout':'probe-failed',detail:timedOut?'检查运行环境超时；NAS 冷启动可能较慢，可重试。':'无法检查数值运行环境，可重试。',diagnostic,retryable:true,probedAt:at,...(previous.lastSuccessfulAt?{lastSuccessfulAt:previous.lastSuccessfulAt}:{})};
      }
      return snapshot();
    })();
    probePromise=pending;
    pending.finally(()=>{if(probePromise===pending)probePromise=null;});
    return waitForProbe(pending,signal);
  }
  const disk=path.join(dataDir,'engineering-records');await fs.mkdir(disk,{recursive:true});
  const numericalTool=()=>({id:'scipy',name:'SciPy · 数值求解与分析',role:'ODE求解、参数扫描、约束与数值一致性检查',...snapshot(),installed:runtime.available?true:runtime.status==='missing'?false:null,detected:runtime.available,integrated:true,probeMode:'on-demand-cached',recheck:'on-demand',interface:'Python solve_ivp / linalg.expm',source:'https://docs.scipy.org/doc/scipy/reference/integrate.html'});
  const records=new Map();const queues=new Map();
  async function acquire(projectId,signal,runId){
    if(signal?.aborted)throw Error('Cancelled');
    const queued=queues.has(projectId);const previous=queues.get(projectId)||Promise.resolve();let unlock;
    const current=new Promise(resolve=>{unlock=resolve;});queues.set(projectId,current);
    const release=()=>{unlock();if(queues.get(projectId)===current)queues.delete(projectId);};
    if(queued)emit({projectId,runId,type:'engineering.queued',message:'仿真任务已排入项目队列'});
    let cancel;
    try{await Promise.race([previous,new Promise((_,reject)=>{cancel=()=>reject(Error('Cancelled while queued'));signal?.addEventListener('abort',cancel,{once:true});})]);if(signal?.aborted)throw Error('Cancelled');}
    catch(error){previous.then(release);throw error;}
    finally{signal?.removeEventListener('abort',cancel);}
    return release;
  }
  const service={
    async recheckRuntime(ctx={}){return probeRuntime({force:true,signal:ctx.signal});},
    async catalog(options={},ctx={}){if(options.recheck===true)await probeRuntime({force:true,signal:ctx.signal});const tools=[numericalTool(),...await professionalCatalog()];return {tools,runtime:{scipy:{probeMode:'on-demand-cached',probedAt:runtime.probedAt,status:runtime.status,recheck:'on-demand'},professionalTools:{probeMode:'each-catalog-call',checkedAt:new Date().toISOString(),scope:'PATH-and-explicit-application-paths-only',launchProducts:false}},models:[{id:MODEL,name:'双节点载荷温控系统',version:'1.0.0',scope:SCOPE,available:runtime.available,origin:'工作台声明的物理模型；非上游卫星设计',description:'热容—热导网络 + 带饱和/抗积分饱和的 PI 加热；环境温度阶跃。',equations:['Cp·dTp/dt = Qinternal + Qheater − Gpc·(Tp−Tc)','Cc·dTc/dt = Gpc·(Tp−Tc) − Gca·(Tc−Ta)','Qheater = clamp(Kp·(Tset−Tp) + Ki·z, 0, Qmax)'],parameters:parameterDefinitions,scanParameters:['ambientAfter','heaterMax','coupling','loss','internalHeat'],files:FILES}],workflow:['场景与利益相关方','可测需求与边界','结构/接口/行为模型','参数与输入基线','求解与扫描','独立约束/解析对照','证据回溯与设计变更'],limitations:['数值分析不是实物验证；热参数尚未用试验标定。','SciPy 是数值求解器，不是完整 SysML 建模器。','缺失的专业工具按实际探测标注，不以工作台界面代替其软件验收。']};},
    async run(args={},ctx={}){
      const {projectId}=args;if(!store)throw Error('Project store required');const workspace=store.workspace(projectId);
      if(ctx.signal?.aborted)throw Error('Cancelled');
      let model=args.model||MODEL,input=args.parameters||{};
      if(args.modelFile){const target=safePath(workspace,args.modelFile);const st=await fs.stat(target);if(!st.isFile()||st.size>64000)throw Error('模型JSON过大');const doc=JSON.parse(await fs.readFile(target,'utf8'));if(doc.schema!=='mbse-thermal-model-v1'||doc.model!==MODEL)throw Error('仅接受冻结物理模型的声明式JSON，不执行候选代码');model=doc.model;input={...doc.parameters,...input};}
      if(model!==MODEL)throw Error('未知或未集成的模型');const parameters=validateParameters(input);let scan=null;
      if(args.scan){const s=args.scan;if(!['ambientAfter','heaterMax','coupling','loss','internalHeat'].includes(s.parameter)||!Array.isArray(s.values)||!s.values.length||s.values.length>12)throw Error('参数扫描需1…12个有效值');s.values.forEach(v=>validateParameters({...parameters,[s.parameter]:v}));scan={parameter:s.parameter,values:s.values};}
      await probeRuntime({signal:ctx.signal});
      if(!runtime.available)throw Error('数值求解器不可用：'+runtime.detail);
      const release=await acquire(projectId,ctx.signal,ctx.runId);try{
      const id='eng_'+crypto.randomUUID().replaceAll('-','');const relative=`engineering/${id}`;const dir=safePath(workspace,relative,{write:true});await fs.mkdir(dir,{recursive:true});
      const specification={schema:'mbse-thermal-model-v1',model:MODEL,version:'1.0.0',parameters,units:Object.fromEntries(parameterDefinitions.map(p=>[p.key,p.unit])),assumptions:['双节点集中热容模型，节点内部温度均匀','恒定热容和线性热导，无辐射/真空热传递机理','理想传感器与加热器；连续PI，无通信延迟','边界工况由本次输入定义；参数未实测标定'],origin:'studio-declared-physical-model'};
      const requirements=[{id:'R-TEMP-MIN',text:`载荷全时域温度 ≥ ${parameters.minTemperature} °C`},{id:'R-TEMP-MAX',text:`载荷全时域温度 ≤ ${parameters.maxTemperature} °C`},{id:'R-TRACK',text:`末10%时域跟踪误差 ≤ ${parameters.finalTolerance} K`},{id:'R-CONSERVATION',text:'独立能量积分相对误差 < 0.005'},{id:'R-NUMERICS',text:'线性极限模型与矩阵指数解析解误差 < 1e-5 K'}];
      await Promise.all([fs.writeFile(path.join(dir,'model.py'),PYTHON),fs.writeFile(path.join(dir,'model.json'),JSON.stringify(specification,null,2)),fs.writeFile(path.join(dir,'parameters.json'),JSON.stringify({parameters,scan},null,2)),fs.writeFile(path.join(dir,'requirements.json'),JSON.stringify(requirements,null,2))]);
      emit({projectId,runId:ctx.runId,type:'engineering.started',message:'SciPy 热动力学仿真已启动',data:{id,model}});
      const execution=await spawnBounded(python,['-I','-c',`import sys;sys.path.insert(0,${JSON.stringify(dependencies)});\n${PYTHON}`,dir],{cwd:dir,env,timeoutMs:30000,maxBytes:12000,signal:ctx.signal});
        if(execution.code!==0)throw Error('求解失败：'+execution.stderr.slice(-1000));
        const result=JSON.parse(await fs.readFile(path.join(dir,'result.json'),'utf8'));
        const manifest={id,projectId,model:MODEL,modelVersion:'1.0.0',createdAt:new Date().toISOString(),scope:SCOPE,upstreamReproduction:false,hardwareValidation:false,solver:result.solver,parameters,scan,sourceHash:sha(PYTHON),inputHash:sha(JSON.stringify({parameters,scan})),execution:{exitCode:execution.code,stdout:execution.stdout},files:[]};
        for(const file of FILES.filter(f=>f!=='manifest.json'))manifest.files.push({file,sha256:sha(await fs.readFile(path.join(dir,file)))});
        await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2));
        const artifacts=FILES.map(file=>({name:file,path:`${relative}/${file}`,url:`/api/engineering/outputs/${id}/${file}?projectId=${encodeURIComponent(projectId)}`}));
        const report={...manifest,...result,status:'completed',constraintStatus:result.passed&&result.scenarios.every(s=>s.passed)?'satisfied-for-tested-scenarios':'violations-found',requirements,assumptions:specification.assumptions,artifacts,limitations:['仅验证当前声明模型与输入工况；不是NOS3复现或硬件验证。','输出采样约2秒，温度全时域门槛按采样点检查；未证明采样点间无极值。','参数与PI控制器为工作台示例设计，尚未标定或经实物验收。']};
        records.set(id,{projectId,dir,report});await fs.writeFile(path.join(disk,id+'.json'),JSON.stringify({projectId,relative,report},null,2));
        for(const a of artifacts)store.add('artifacts',{id:'artifact_'+crypto.randomUUID(),projectId,threadId:ctx.threadId||null,...(ctx.runId?{runId:ctx.runId}:{}),name:`${id}-${a.name}`,path:a.path,type:a.name.endsWith('.json')?'application/json':a.name.endsWith('.svg')?'image/svg+xml':'text/plain',createdAt:manifest.createdAt});
        emit({projectId,runId:ctx.runId,type:'engineering.completed',message:'数值仿真完成 · '+report.constraintStatus,data:{id,scope:SCOPE,artifacts:artifacts.length}});return report;
      }finally{release();}
    },
    async getRun(id,ctx={}){const item=await locate(id,ctx);return item.report;},
    async readOutput(id,file,ctx={}){if(!FILES.includes(file))throw Error('未知输出文件');const item=await locate(id,ctx);const candidate=safePath(item.dir,file);const buffer=await fs.readFile(candidate);return {buffer,contentType:file.endsWith('.svg')?'image/svg+xml':file.endsWith('.json')?'application/json; charset=utf-8':file.endsWith('.csv')?'text/csv; charset=utf-8':'text/plain; charset=utf-8'};}
  };
  async function locate(id,ctx){if(!/^eng_[a-f0-9]{32}$/.test(id))throw Error('无效运行ID');let item=records.get(id);if(!item){const saved=JSON.parse(await fs.readFile(path.join(disk,id+'.json'),'utf8'));const workspace=store.workspace(saved.projectId);item={projectId:saved.projectId,dir:safePath(workspace,saved.relative),report:saved.report};records.set(id,item);}if(!ctx.projectId||item.projectId!==ctx.projectId)throw Error('运行记录不属于当前项目');store.workspace(ctx.projectId);return item;}
  return service;
}
