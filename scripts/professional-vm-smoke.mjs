import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createStudioServer} from '../server/index.mjs';

const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const configuredVmRoot=process.env.MANTA_NOS3_VM_ROOT;
if(!configuredVmRoot||!path.isAbsolute(configuredVmRoot))throw new Error('Set MANTA_NOS3_VM_ROOT to an explicitly provisioned absolute VM directory');
const vmRoot=path.resolve(configuredVmRoot);
const outputRoot=process.env.MANTA_STF_EVAL_OUTPUT_ROOT;
if(!outputRoot||!path.isAbsolute(outputRoot))throw new Error('Set MANTA_STF_EVAL_OUTPUT_ROOT to an absolute output directory');
const runRoot=path.join(outputRoot,`professional-api-smoke-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`);
const workspace=path.join(runRoot,'workspace'),dataDir=path.join(runRoot,'data');
for(const dir of [workspace,dataDir])fs.mkdirSync(dir,{recursive:true,mode:0o700});
const model=`model MantaLinearProbe
  Real x(start=0, fixed=true);
equation
  der(x) = 1;
end MantaLinearProbe;
`;
const modelHash=createHash('sha256').update(model).digest('hex');
const app=await createStudioServer({root:sourceRoot,dataDir,vmRoot,seed:false,stfCase:false,computer:false,connectors:false,localVm:false,nos3:false,professionalMode:'generic-only',evaluator:false});
try{
  const address=await app.listen({port:0});
  const api=async(route,method='GET',body)=>{
    const response=await fetch(`http://127.0.0.1:${address.port}${route}`,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    const value=await response.json();
    if(!response.ok)throw new Error(`${method} ${route}: ${response.status} ${JSON.stringify(value)}`);
    return value;
  };
  const project=await api('/api/projects','POST',{name:'Independent professional API smoke',folderPath:workspace});
  const base=`/api/projects/${project.id}/professional`;
  const saved=await api(`${base}/model`,'PUT',{path:'models/MantaLinearProbe.mo',content:model,expectedHash:null});
  if(saved.sha256!==modelHash)throw new Error('Manta did not preserve the model source revision');
  const submitted=await api(`${base}/jobs`,'POST',{path:'models/MantaLinearProbe.mo',expectedHash:modelHash,operation:'simulate',modelName:'MantaLinearProbe',simulation:{startTime:0,stopTime:2,numberOfIntervals:10}});
  await app.professionalModels.wait({projectId:project.id,jobId:submitted.jobId});
  const result=await api(`${base}/jobs/${submitted.jobId}/result`);
  fs.writeFileSync(path.join(runRoot,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  const rows=result.table?.rows||[],last=rows.at(-1),timeIndex=result.table?.columns?.indexOf('time')??-1,xIndex=result.table?.columns?.indexOf('x')??-1;
  const acceptance={projectId:project.id,jobId:submitted.jobId,sourceHash:modelHash,sourcePath:path.join(workspace,'models/MantaLinearProbe.mo'),resultPath:path.join(runRoot,'result.json'),executionSucceeded:result.executionSucceeded===true,integrityVerified:result.integrity?.verified===true,samples:rows.length,columns:result.table?.columns||[],lastSample:last||null,solver:result.tool||result.runner||null};
  fs.writeFileSync(path.join(runRoot,'acceptance.json'),JSON.stringify(acceptance,null,2)+'\n',{mode:0o600});
  process.stdout.write(JSON.stringify(acceptance)+'\n');
  if(!acceptance.executionSucceeded||!acceptance.integrityVerified||!last||timeIndex<0||xIndex<0||Math.abs(Number(last[timeIndex])-2)>1e-8||Math.abs(Number(last[xIndex])-2)>1e-6)process.exitCode=1;
}finally{await app.close();}
