import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';

const NAMESPACE='stf-engineering';
const PIN='5a3bdee6be9a2c67fdf994ae6db56d5c60395302';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const fail=(message,status=400)=>Object.assign(Error(message),{status,statusCode:status});
const catalogItems=[
  {id:'from-zero',variant:'from-zero',name:'STF：从空目录建立工程项目',description:'从固定 NASA 来源建立候选需求、SysML、原生 Modelica、可执行任务控制分析与验证场景。完整任务的未完成项继续保留。',
    modelClass:'STFResourceMission.Mission',modelPath:NAMESPACE+'/models/STFResourceMission.mo',
    sysmlPath:NAMESPACE+'/models/STFSystem.sysml',approvalStatus:'candidate',engineeringComplete:false},
  {id:'existing-change',variant:'existing-change',name:'STF：既有任务的低电量保护变更',description:'复现 NASA Low Power 场景并生成 LC/SC 原生表变更，比较修复前后的能源、下传和故障响应。编译/联合执行状态单独记录。',
    modelClass:'STFResourceMission.Mission',modelPath:NAMESPACE+'/models/STFResourceMission.mo',
    sysmlPath:NAMESPACE+'/models/STFSystem.sysml',approvalStatus:'candidate',engineeringComplete:false,
    suggestedParameters:{initialSOC:0.65,faultPower:30,protectCritical:true}}
];

/** Only package-owned assets are copied. No installer, arbitrary command, user
 * JavaScript module or host-global configuration is executed by this service. */
export function createStfCaseService({root,assetsRoot}={}){
  if(!assetsRoot||!path.isAbsolute(assetsRoot))throw Error('STF requires a fixed application-owned asset directory');
  const assets=path.resolve(assetsRoot),locks=new Set();
  async function regular(file,max=2*1024*1024){const s=await fs.lstat(file);if(s.isSymbolicLink()||!s.isFile()||s.size>max)throw fail('STF asset must be a bounded regular file');return fs.readFile(file);}
  async function workspaceRoot(workspace){if(typeof workspace!=='string'||!path.isAbsolute(workspace))throw fail('Project workspace required');const s=await fs.stat(workspace);if(!s.isDirectory())throw fail('Project workspace is not a folder');return fs.realpath(workspace);}
  async function namespace(workspace){const base=await workspaceRoot(workspace),target=path.join(base,NAMESPACE);try{const s=await fs.lstat(target);if(!s.isDirectory()||s.isSymbolicLink())throw fail('STF engineering directory cannot be a symbolic link');}catch(e){if(e.code!=='ENOENT')throw e;}return {base,target};}
  async function assetFiles(){const collected=[];let bytes=0;async function walk(dir,relative=''){const s=await fs.lstat(dir);if(s.isSymbolicLink()||!s.isDirectory())throw fail('STF template directory must be regular');for(const ent of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){if(ent.name.startsWith('.')||ent.isSymbolicLink())throw fail('STF template contains unsupported hidden/symbolic entries');const rel=relative?relative+'/'+ent.name:ent.name;const file=path.join(dir,ent.name);if(ent.isDirectory())await walk(file,rel);else if(ent.isFile()){const content=await regular(file);bytes+=content.length;if(bytes>8*1024*1024||collected.length>=500)throw fail('STF template size limit exceeded');collected.push({path:rel,content,sha256:hash(content)});}else throw fail('Unsupported STF template entry');}}await walk(assets);if(!collected.some(f=>f.path==='models/STFResourceMission.mo')||!collected.some(f=>f.path==='models/STFSystem.sysml'))throw fail('STF native model assets are unavailable',503);return collected;}
  async function inspect(workspace){const {target}=await namespace(workspace);try{const manifest=JSON.parse(await regular(path.join(target,'manifest.json')));if(manifest.schema!=='manta-stf-project-v1'||!catalogItems.some(x=>x.variant===manifest.variant))throw fail('Unrecognized STF engineering project');return {...manifest,modelPath:NAMESPACE+'/models/STFResourceMission.mo',sysmlPath:NAMESPACE+'/models/STFSystem.sysml',readmePath:NAMESPACE+'/README.md',casePath:NAMESPACE,existing:true};}catch(e){if(e.code==='ENOENT')return null;throw e;}}
  async function create({workspace,variant='from-zero'}={}){
    if(!catalogItems.some(x=>x.variant===variant))throw fail('Unknown STF engineering workflow');
    const {base,target}=await namespace(workspace);if(locks.has(base))throw fail('STF project creation is already running',409);locks.add(base);
    let created=false,creationIdentity;
    try{const existing=await inspect(base);if(existing){if(existing.variant!==variant)throw fail('STF namespace already contains another workflow; use a separate project folder',409);return existing;}
      const files=await assetFiles();
      try{await fs.mkdir(target,{mode:0o700});created=true;creationIdentity=await fs.lstat(target);}catch(e){if(e.code==='EEXIST')throw fail('STF folder already exists; existing files will not be overwritten',409);throw e;}
      for(const f of files){if(f.path==='manifest.json')continue;const destination=path.join(target,...f.path.split('/'));await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});await fs.writeFile(destination,f.content,{flag:'wx',mode:0o600});}
      const manifest={schema:'manta-stf-project-v1',caseId:'nasa-nos3-stf',variant,createdAt:new Date().toISOString(),source:{repository:'https://github.com/nasa/nos3',revision:PIN},
        approvalStatus:'candidate-not-approved',engineeringComplete:false,modelClass:'STFResourceMission.Mission',files:files.filter(f=>f.path!=='manifest.json').map(({path,sha256,content})=>({path,sha256,bytes:content.length})),
        limitations:['This project is a traceable engineering reconstruction; creating files does not develop or qualify a complete flight system.',
          'All six L0 requirements and all 40 engineering work packages remain tracked; analysis results do not automatically close them.',
          'Periodic opportunities are test stimuli, not propagated coverage or RF availability; native NOS3 and physical evidence remain separate.']};
      await fs.writeFile(path.join(target,'manifest.json'),json(manifest),{flag:'wx',mode:0o600});return {...manifest,modelPath:NAMESPACE+'/models/STFResourceMission.mo',sysmlPath:NAMESPACE+'/models/STFSystem.sysml',readmePath:NAMESPACE+'/README.md',casePath:NAMESPACE,existing:false};
    }catch(e){if(created){const current=await fs.lstat(target).catch(()=>null);if(current?.ino===creationIdentity?.ino&&!current.isSymbolicLink())await fs.rm(target,{recursive:true,force:true});}throw e;}finally{locks.delete(base);}
  }
  async function verify({workspace,scenarioIds}={}){
    const current=await inspect(workspace);if(!current)throw fail('Create or import the STF engineering project first');
    const {target}=await namespace(workspace);const assetsList=await assetFiles();const source=assetsList.find(x=>x.path==='flight/mission.mjs');
    const candidate=await regular(path.join(target,'flight/mission.mjs'));if(hash(candidate)!==source?.sha256)throw fail('Modified controller code requires isolated execution; the host reference runner only executes the reviewed bundled version',409);
    const config=JSON.parse(await regular(path.join(target,'scenarios/scenarios.json')));if(!Array.isArray(config.scenarios)||config.scenarios.length>30)throw fail('Invalid STF scenario set');
    if(scenarioIds!==undefined&&(!Array.isArray(scenarioIds)||scenarioIds.some(x=>typeof x!=='string')))throw fail('Scenario identifiers must be a list');
    const selected=scenarioIds?.length?config.scenarios.filter(x=>scenarioIds.includes(x.id)):config.scenarios;
    if(!selected.length||scenarioIds?.some(id=>!selected.some(x=>x.id===id)))throw fail('Unknown STF scenario');
    // assetsRoot is fixed by application setup, never supplied by a model or API caller.
    const {simulateMission,rowsToCSV}=await import(pathToFileURL(path.join(assets,'flight/mission.mjs')).href);
    const inputs=[];for(const file of ['models/STFResourceMission.mo','models/STFSystem.sysml','flight/mission.mjs','scenarios/scenarios.json'])inputs.push({path:file,sha256:hash(await regular(path.join(target,...file.split('/'))))});
    const jobId='stf_reference_'+crypto.randomUUID(),relative=NAMESPACE+'/results/'+jobId,dir=path.join(target,'results',jobId);await fs.mkdir(dir,{recursive:true,mode:0o700});
    const results=[];
    for(const s of selected){if(!s||!/^[a-z0-9-]{1,80}$/.test(s.id)||!['pass','fail'].includes(s.expectation)||typeof s.overrides!=='object')throw fail('Invalid STF scenario');const r=simulateMission(s.overrides);
      const {rows,packets,...summary}=r;const report={...summary,scenarioId:s.id,name:s.name,expected:s.expectation,expectedBehaviorObserved:r.passed===(s.expectation==='pass')};
      await fs.writeFile(path.join(dir,s.id+'.json'),json(report),{flag:'wx',mode:0o600});await fs.writeFile(path.join(dir,s.id+'.csv'),rowsToCSV(rows),{flag:'wx',mode:0o600});results.push(report);}
    const acceptance={schema:'manta-stf-reference-verification-v1',jobId,createdAt:new Date().toISOString(),inputs,controllerSha256:source.sha256,
      status:results.every(x=>x.expectedBehaviorObserved)?'completed':'failed',scope:'packet-controller-and-proposed-energy-reference-analysis',
      nativeModelicaExecuted:false,nativeNos3Executed:false,engineeringComplete:false,
      results,files:results.flatMap(x=>[relative+'/'+x.scenarioId+'.json',relative+'/'+x.scenarioId+'.csv'])};
    await fs.writeFile(path.join(dir,'acceptance.json'),json(acceptance),{flag:'wx',mode:0o600});
    const lines=['# STF 任务控制分析验收','','此处执行的是候选控制器及独立资源参考分析；OpenModelica 与 NOS3 原生执行证据另行记录。完整工程尚未完成。','',
      '| 场景 | 原始判定 | 预期行为符合 | 最大已交付年龄(s) | 最低SOC |','|---|---|---|---:|---:|',
      ...results.map(r=>`| ${r.name} | ${r.passed?'通过':'失败'} | ${r.expectedBehaviorObserved?'是':'否'} | ${r.metrics.maxDeliveredAgeSeconds} | ${r.metrics.minSOC.toFixed(5)} |`),'',
      '无接触、容量不足和未修复低电量必须保留失败判定；这些反例的失败符合验证预期，不会改写成工程通过。','',
      '所有六条 L0、科学产品/覆盖、真实地面交付、三个月寿命、物理/HIL、环境、独立保证和任务接受继续保留未闭合状态。',''];
    await fs.writeFile(path.join(dir,'acceptance.md'),lines.join('\n'),{flag:'wx',mode:0o600});return {...acceptance,resultPath:relative+'/acceptance.json',reportPath:relative+'/acceptance.md'};
  }
  return {catalog:()=>({schema:'manta-stf-case-catalog-v1',cases:structuredClone(catalogItems),engineeringComplete:false}),create,inspect,verify};
}
