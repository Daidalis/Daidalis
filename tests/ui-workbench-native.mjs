// Live workbench acceptance with self-contained models and real native tools.
// No model API calls or external engineering assets are required.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

const base=process.env.MANTA_ACCEPTANCE_URL;
const workRoot=process.env.MANTA_UI_WORK_ROOT;
if(!base||!workRoot||!path.isAbsolute(workRoot))throw Error('Set MANTA_ACCEPTANCE_URL and an absolute dedicated MANTA_UI_WORK_ROOT');
const folder=path.join(workRoot,'projects','workbench-native-'+Date.now());
const out=path.join(workRoot,'outputs','workbench-native');
await fs.mkdir(path.join(folder,'models'),{recursive:true});
await fs.mkdir(out,{recursive:true});
const models={
 'Decay.mo':'model Decay\n parameter Real rate=1;\n Real x(start=1,fixed=true);\nequation\n der(x)=-rate*x;\nend Decay;\n',
 'Circuit.cir':'RC transient\nV1 in 0 DC 1\nR1 in out 1000\nC1 out 0 1u IC=0\n.tran 0.0001 0.01 uic\n.end\n',
 'Cube.scad':'size = 10;\nassert(size > 0, "size must be positive");\ncube([size,size,size]);\n',
 'FMI.sysml':'package FMI {\n private import ScalarValues::*;\n private import AnalysisTooling::*;\n calc def Decay {\n metadata ToolExecution { toolName = "fmi"; uri = "file:///models/SimpleDecay.fmu"; }\n in stopTime : Real = 1.0 { @ToolVariable { name = "fmi:stopTime"; } }\n return x : Real[1] { @ToolVariable { name = "x"; } }\n }\n analysis def Check {\n return result : Real = Decay();\n assert constraint { result > 0.30 and result < 0.45 }\n }\n}\n'
};
for(const [name,source]of Object.entries(models))await fs.writeFile(path.join(folder,'models',name),source);
if(process.env.MANTA_UI_FMU)await fs.copyFile(process.env.MANTA_UI_FMU,path.join(folder,'models/SimpleDecay.fmu'));
const browser=await chromium.launch({headless:true,...(process.env.MBSE_CHROME_PATH?{executablePath:process.env.MBSE_CHROME_PATH}:{}),chromiumSandbox:process.env.MANTA_UI_NO_SANDBOX!=='1'});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(30000);
const errors=[],steps=[],jobs=[];
page.on('pageerror',e=>errors.push(e.message));
let projectId;
async function step(name,fn){await fn();steps.push(name);console.log('PASS',name);}
async function run(operation='simulate'){
 const responsePromise=page.waitForResponse(r=>r.request().method()==='POST'&&/\/professional\/jobs$/.test(new URL(r.url()).pathname));
 await page.locator(`button[type="submit"][value="${operation}"]`).click();
 const response=await responsePromise;
 assert.equal(response.status(),202,await response.text());
 const job=await response.json();jobs.push(job.jobId);
 await page.waitForFunction(id=>{const el=document.querySelector('[data-pm-result-job="'+id+'"]');return el&&['completed','failed','cancelled'].includes(el.dataset.pmResultStatus);},job.jobId,{timeout:180000});
 const result=await page.request.get(base+'/api/projects/'+projectId+'/professional/jobs/'+job.jobId+'/result');
 assert.ok(result.ok());return result.json();
}
async function model(name){await page.locator('[data-pm-action="model"][data-path="models/'+name+'"]').click();await page.waitForFunction(p=>document.querySelector('[data-pm-field="path"]')?.value===p,'models/'+name);}
try{
 await step('Create project through actual UI and preserve main chat draft',async()=>{
  const bootstrap=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/bootstrap');
  await page.goto(base);await bootstrap;await page.waitForFunction(()=>document.querySelector('.project-title')&&!document.querySelector('.api-offline'));
  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('#project-form [name="name"]').fill('Native workbench acceptance');
  await page.locator('#project-folder').fill(folder);
  const created=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/projects');
  await page.locator('[form="project-form"][type="submit"]').click();
  const response=await created;assert.ok(response.ok(),await response.text());projectId=(await response.json()).id;
  await page.waitForFunction(id=>new URL(location.href).searchParams.get('project')===id&&document.querySelector('.project-title')?.textContent.includes('Native workbench acceptance'),projectId);
  await page.locator('#project-form').waitFor({state:'detached'});await page.locator('#composer').fill('保留工作台验收草稿');
 });
 await step('Navigate Library to native model editor',async()=>{
  await page.locator('[data-action="toggle-overview"]').click();await page.locator('[data-action="open-library"]').click();
  await page.locator('[data-workspace-action="folder"][data-path="models"]').click();
  await page.locator('[data-workspace-action="file"][data-path="models/Decay.mo"]').click();
  await page.locator('.professional-workbench').waitFor();await page.locator('[data-pm-action="focus"]').click();
 });
 await step('Save and reopen exact native model revision',async()=>{
  await page.locator('[data-pm-field="source"]').fill(models['Decay.mo']+'// Saved via real browser.\n');
  await page.locator('[data-pm-action="save"]').click();await page.getByRole('status').filter({hasText:'原生模型已保存'}).waitFor();
  await model('Circuit.cir');await model('Decay.mo');assert.match(await page.locator('[data-pm-field="source"]').inputValue(),/Saved via real browser/);
 });
 await step('Actual OpenModelica check and numerical decay simulation',async()=>{
  const checked=await run('check');assert.equal(checked.executionSucceeded,true,checked.diagnostics);
  await page.locator('[data-pm-action="tab"][data-tab="model"]').click();
  await page.locator('[name="stopTime"]').fill('1');await page.locator('[name="numberOfIntervals"]').fill('500');
  const result=await run();assert.equal(result.executionSucceeded,true,result.diagnostics);assert.equal(result.integrity.verified,true);
  const x=result.table.columns.indexOf('x');assert.ok(x>=0);assert.ok(Math.abs(result.table.rows.at(-1)[x]-Math.exp(-1))<0.002);
  await page.locator('.document-data-chart').waitFor();await page.screenshot({path:out+'/01-modelica.png',fullPage:true});
 });
 await step('Actual ngspice circuit trajectory is displayed',async()=>{
  await model('Circuit.cir');const result=await run();assert.equal(result.executionSucceeded,true,result.diagnostics);assert.ok(result.table.rowCount>2);
  await page.locator('.document-data-chart').waitFor();await page.screenshot({path:out+'/02-circuit.png',fullPage:true});
 });
 await step('Actual OpenSCAD mesh and invalid geometry failure replace stale success',async()=>{
  await model('Cube.scad');const result=await run();assert.equal(result.executionSucceeded,true,result.diagnostics);
  await page.locator('.pm-geometry canvas').waitFor();await page.screenshot({path:out+'/03-geometry.png',fullPage:true});
  await page.locator('[data-pm-action="tab"][data-tab="model"]').click();await page.locator('[name="parameter:size"]').fill('-1');
  const failed=await run();assert.equal(failed.executionSucceeded,false);assert.equal(await page.locator('.pm-geometry canvas').count(),0);
 });
 await step('SysML FMI controls pin the project FMU and honor execution isolation',async()=>{
  await model('FMI.sysml');assert.equal(await page.locator('[name="modelName"]').inputValue(),'FMI::Check');
  await page.locator('[name="fmuPath"]').fill('models/SimpleDecay.fmu');
  if(process.env.MANTA_UI_FMU){
   const catalog=await page.request.get(base+'/api/projects/'+projectId+'/professional').then(r=>r.json());
   if(catalog.environment.isolated===true&&catalog.environment.brokerIsolation?.kind==='rootless-task-container'){
    const result=await run();assert.equal(result.passed,true,JSON.stringify(result));assert.equal(result.integrity.verified,true);
    await page.locator('.document-data-chart').waitFor();
   }else{
    const pending=page.waitForResponse(r=>r.request().method()==='POST'&&/\/professional\/jobs$/.test(new URL(r.url()).pathname));
    await page.locator('button[value="simulate"]').click();const response=await pending;assert.equal(response.status(),400);
    assert.match(await response.text(),/isolated rootless broker/);await page.locator('.pm-error').filter({hasText:'isolated rootless broker'}).waitFor();
   }
  }
  await page.screenshot({path:out+'/04-fmi.png',fullPage:true});
 });
 await step('Responsive workbench retains chat draft and has no page errors',async()=>{
  await page.setViewportSize({width:768,height:1000});await page.screenshot({path:out+'/05-workbench-768.png',fullPage:true});
  assert.equal(await page.locator('#composer').inputValue(),'保留工作台验收草稿');assert.deepEqual(errors,[]);
 });
 const report={base,projectId,folder,steps,jobs,errors,scope:'Real UI and native OpenModelica/ngspice/OpenSCAD. FMI runs only when rootless broker attestation exists; shared deployment must reject it.'};
 await fs.writeFile(out+'/acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){await page.screenshot({path:out+'/failure.png',fullPage:true});await fs.writeFile(out+'/failure.json',JSON.stringify({error:error.message,projectId,steps,jobs,errors},null,2));throw error;}finally{await browser.close();}
