import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const FILES=['requirements.md','model.json','verification.json','change.md'];
const OPS=['sensor*conjugate(mount)','conjugate(mount)*sensor','sensor*mount','mount*sensor','sensor','conjugate(sensor)*mount'];
function finiteQuat(q){if(!Array.isArray(q)||q.length!==4||!q.every(Number.isFinite)||Math.hypot(...q)<1e-12)throw new Error('invalid quaternion');return q;}
function normal(q){finiteQuat(q);const n=Math.hypot(...q);return q.map(v=>v/n);}
function conj(q){return [-q[0],-q[1],-q[2],q[3]];}
function mul(a,b){const [x,y,z,w]=a,[X,Y,Z,W]=b;return [w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z];}
function mat(q){const [x,y,z,w]=normal(q);return [[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]];}
function matrixMultiply(a,b){return a.map(row=>b[0].map((_,j)=>row.reduce((sum,v,k)=>sum+v*b[k][j],0)));}
function transpose(m){return m[0].map((_,i)=>m.map(row=>row[i]));}
function matrixError(a,b){return Math.sqrt(a.flatMap((r,i)=>r.map((x,j)=>(x-b[i][j])**2)).reduce((s,x)=>s+x,0));}
function ordered(q,order){return order==='wxyz'?[q[3],q[0],q[1],q[2]]:q;}
function asXyzw(q,order){return order==='wxyz'?[q[1],q[2],q[3],q[0]]:q;}
export function applyQuaternionStrategy(config, sensorInput, mountInput){
  let s=asXyzw(sensorInput,config.order||'xyzw'),m=asXyzw(mountInput,config.order||'xyzw');finiteQuat(s);finiteQuat(m);if(config.normalize===true){s=normal(s);m=normal(m);}if(config.sensorDirection==='inertial-to-sensor')s=conj(s);if(config.mountDirection==='body-to-sensor')m=conj(m);
  let q;switch(config.operation){case 'sensor*conjugate(mount)':q=mul(s,conj(m));break;case 'conjugate(mount)*sensor':q=mul(conj(m),s);break;case 'sensor*mount':q=mul(s,m);break;case 'mount*sensor':q=mul(m,s);break;case 'sensor':q=s;break;case 'conjugate(sensor)*mount':q=mul(conj(s),m);break;default:throw new Error('Unsupported declarative operation');}return config.normalize===true?normal(q):q;
}

export function gradeQuaternionContract(config={}){
  const checks=[];let seed=20261022;const rand=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
  const quaternion=()=>{const axis=normal([rand()-.5,rand()-.5,rand()-.5,0]).slice(0,3),angle=(rand()*2-1)*Math.PI,s=Math.sin(angle/2);return [...axis.map(v=>v*s),Math.cos(angle/2)];};
  const schemaValid=config.kind==='quaternion-interface-v1'&&['xyzw','wxyz'].includes(config.order)&&OPS.includes(config.operation)&&['sensor-to-inertial','inertial-to-sensor'].includes(config.sensorDirection)&&['sensor-to-body','body-to-sensor'].includes(config.mountDirection);
  checks.push({id:'contract-schema',name:'声明式接口策略完整',passed:schemaValid,detail:'输入约定由题目冻结；该子评测不执行候选任意代码。'});
  if(!schemaValid)return {status:'failed',score:0,scoreLabel:'接口契约测试分数',scope:'interface-contract-only',upstreamReproduction:false,checks,limitations:['未运行NOS3上游仓库，不代表历史issue已经复现或修复。']};
  const id=[0,0,0,1],axis90=[Math.SQRT1_2,0,0,Math.SQRT1_2];const cases=[{sensor:id,mount:id,label:'单位姿态'},{sensor:axis90,mount:id,label:'绕X轴90度'},{sensor:id,mount:axis90,label:'非默认安装方向'}];
  for(let i=0;i<48;i++){const sensor=quaternion(),mount=quaternion();cases.push({sensor,mount,label:'独立旋转 '+(i+1)});if(i<12)cases.push({sensor:sensor.map(v=>-v),mount,label:'四元数双覆盖 '+(i+1)});}
  let correct=0,maxError=0;for(const c of cases){try{const candidate=applyQuaternionStrategy(config,c.sensor,c.mount);const expected=matrixMultiply(mat(c.sensor),transpose(mat(c.mount)));const error=matrixError(mat(candidate),expected);maxError=Math.max(maxError,error);if(error<1e-9)correct++;}catch{maxError=Infinity;}}
  checks.push({id:'rotation-oracle',name:'已知旋转、非单位安装与随机姿态',passed:correct===cases.length,detail:`${correct}/${cases.length}；独立旋转矩阵oracle，最大Frobenius误差 ${Number.isFinite(maxError)?maxError.toExponential(3):'invalid'}。`});
  let invalidRejected=0;for(const [s,m] of [[[0,0,0,0],id],[[NaN,0,0,1],id],[[0,0,1],id],[id,[0,0,0,0]]]){try{applyQuaternionStrategy(config,s,m);}catch{invalidRejected++;}}
  checks.push({id:'invalid-inputs',name:'零范数、缺项和非有限测量拒绝',passed:invalidRejected===4&&config.invalidPolicy==='reject',detail:`${invalidRejected}/4拒绝；声明策略 ${config.invalidPolicy||'missing'}。`});
  const convention=config.order==='xyzw'&&config.sensorDirection==='sensor-to-inertial'&&config.mountDirection==='sensor-to-body';checks.push({id:'frozen-convention',name:'保持题目冻结的坐标与排列约定',passed:convention,detail:'q_IS：sensor→inertial；q_BS：sensor→body；输出body→inertial；Hamilton xyzw。'});
  const scaled=applyQuaternionStrategy(config,[.3,.6,.9,2.7],[.8,.4,.2,1.6]);checks.push({id:'unit-output',name:'非单位输入显式归一化',passed:config.normalize===true&&Math.abs(Math.hypot(...scaled)-1)<1e-12,detail:'接收非零有限测量时按声明输出单位四元数。'});
  const passed=checks.every(c=>c.passed);return {status:passed?'passed':'failed',score:Math.round(checks.filter(c=>c.passed).length/checks.length*100),scoreLabel:'接口契约测试分数',scope:'interface-contract-only',upstreamReproduction:false,checks,samples:cases.length+5,limitations:['这是基于真实issue另建的声明式接口子题，只验证约定和变换策略。','未运行NOS3/cFS/42，不证明上游修复、时序、传感器误差或真实卫星性能。','测试用例由独立裁判生成；公开代码与固定种子不构成保密的发布级holdout。']};
}

async function safeRead(workspace,name){const root=await fs.realpath(workspace);const candidate=path.resolve(root,name);if(candidate!==root&&!candidate.startsWith(root+path.sep))throw new Error('Submission path escapes workspace');try{const real=await fs.realpath(candidate);if(real!==root&&!real.startsWith(root+path.sep))throw new Error('Submission symlink escapes workspace');const stat=await fs.stat(real);if(!stat.isFile()||stat.size>2*1024*1024)throw new Error('Submission file too large');return await fs.readFile(real,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function graphChecks(model){const checks=[];if(!model||!Array.isArray(model.nodes)||!Array.isArray(model.links))return[{id:'model-structure',name:'模型结构可读',passed:false,detail:'需要nodes与links数组'}];const ids=new Set(model.nodes.map(n=>n.id));const dangling=model.links.filter(e=>!ids.has(e.source??e.from)||!ids.has(e.target??e.to));checks.push({id:'model-structure',name:'模型节点与关系可读且无断链',passed:ids.size===model.nodes.length&&dangling.length===0&&ids.size>0,detail:`${model.nodes.length}节点，${model.links.length}关系，${dangling.length}条断链；只检查已声明图。`});const req=model.nodes.filter(n=>(n.type||n.kind)==='requirement');const tests=model.nodes.filter(n=>['test','verification'].includes(n.type||n.kind));const testIds=new Set(tests.map(n=>n.id)),covered=req.filter(n=>model.links.some(l=>(l.type||l.kind)==='verifies'&&testIds.has(l.source??l.from)&&(l.target??l.to)===n.id));checks.push({id:'model-trace',name:'每项需求具有验证节点的追溯关系',passed:req.length>0&&covered.length===req.length,detail:`${req.length}项需求，${tests.length}项验证，${covered.length}项有test→requirement关系；声明追溯不等于测试已运行。`});return checks;}

export async function createEvaluator({root,dataDir,workspacesDir,store,emit=()=>{}}={}){
  const dir=path.join(dataDir||path.join(root,'.local'),'evaluation-results');await fs.mkdir(dir,{recursive:true});
  return {async evaluate({taskId,projectId,submission},context={}){
    if(!/^[a-zA-Z0-9_-]+$/.test(projectId||''))throw new Error('Valid projectId required');const workspace=store?.workspace?store.workspace(projectId):path.join(workspacesDir||path.join(dataDir,'workspaces'),projectId);await fs.mkdir(workspace,{recursive:true});
    let result;if(submission?.kind==='quaternion-interface-v1'){if(taskId!=='nos3-351')throw new Error('Quaternion sub-evaluation is restricted to nos3-351');result=gradeQuaternionContract(submission);}else{
      const checks=[],files={};for(const name of FILES){let content=await safeRead(workspace,name);if(content===null){const candidates=(store?.data?.artifacts||[]).filter(a=>a.projectId===projectId&&a.name===name).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));if(candidates[0])content=await safeRead(workspace,candidates[0].path);}files[name]=content;checks.push({id:'file-'+name,name:'交付 '+name,passed:typeof content==='string'&&content.trim().length>20,detail:content===null?'缺少文件':'文件存在；内容仍需工程审阅'});}
      let model;try{model=JSON.parse(files['model.json']||'null');checks.push(...graphChecks(model));}catch{checks.push({id:'model-json',name:'模型JSON可解析',passed:false,detail:'model.json不是有效JSON'});}
      let verification;try{verification=JSON.parse(files['verification.json']||'null');checks.push({id:'verification-structure',name:'验证记录区分未运行与实际证据',passed:!!verification&&Array.isArray(verification.tests),detail:'记录中的passed是候选自述，不会自动升级为独立工程通过。'});}catch{checks.push({id:'verification-json',name:'验证记录JSON可解析',passed:false,detail:'verification.json不是有效JSON'});}
      result={status:checks.every(c=>c.passed)?'evidence-complete':'incomplete',score:Math.round(checks.filter(c=>c.passed).length/checks.length*100),scoreLabel:'交付完整性（非工程通过率）',scope:'deliverable-completeness',engineeringStatus:'not-evaluated',upstreamReproduction:false,checks,limitations:['未自动执行各上游项目的构建、仿真或实物测试。','文件与追溯完整性不等同于行为正确；上游行为验收仍为not-run。','可通过quaternion-interface-v1另行执行一个明确范围的接口契约子评测。']};
    }
    const report={id:'eval_'+crypto.randomUUID().replaceAll('-',''),taskId,projectId,createdAt:new Date().toISOString(),...result};await fs.writeFile(path.join(dir,report.id+'.json'),JSON.stringify(report,null,2));emit({projectId,type:'evaluation.completed',message:report.scoreLabel+': '+report.score,data:{id:report.id,status:report.status,scope:report.scope}});return report;
  }};
}

export const quaternionChallenge={kind:'quaternion-interface-v1',description:'NOS3 #351衍生的接口约定子评测；未复现上游。',inputConvention:'Hamilton xyzw. q_IS maps sensor coordinates to inertial. q_BS maps sensor coordinates to body. Return body to inertial.',schema:{kind:'quaternion-interface-v1',order:'xyzw',sensorDirection:'sensor-to-inertial',mountDirection:'sensor-to-body',operation:OPS,normalize:true,invalidPolicy:'reject'}};
