// UI-only fixtures. Real MCP transports and engineering execution have separate
// integration suites. No production app, model runtime or engineering tool runs.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let playwright;try{playwright=require('playwright');}catch{playwright=require(path.join(process.env.MBSE_NODE_MODULES||path.join(root,'node_modules'),'playwright'));}
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'manta-ui-integrations-'));
const projects=[{id:'project_aaaa',name:'NOS3 UI fixture',coordinatorThreadId:'thread_a',folderPath:'/fixture/nos3'},{id:'project_bbbb',name:'Other project',coordinatorThreadId:'thread_b',folderPath:'/fixture/other'}];
const threads=projects.map(project=>({id:project.coordinatorThreadId,projectId:project.id,kind:'coordinator',title:'项目主对话',status:'open'}));
const artifacts=[{id:'artifact_manifest',projectId:projects[0].id,name:'manifest.json',path:'engineering/nos3/nos3_completed/manifest.json',type:'application/json'}];
const connectors=new Map(projects.map(project=>[project.id,[]])),workers=new Map();
const calls=[],errors=[],steps=[];let delayNext=false,releaseDelayed,delayedStarted;
const jobs=[{id:'nos3_completed',jobId:'nos3_completed',scope:'component',status:'completed',manifestPath:artifacts[0].path,artifacts:[artifacts[0]]},{id:'nos3_running',jobId:'nos3_running',scope:'integration',status:'running'}];
const tools=[{name:'inspect_model',description:'Explicit UI fixture <img src=x onerror="bad()">',effect:'write',policyConfigured:false,inputSchema:{type:'object',properties:{path:{type:'string'}}}}];
const json=(res,data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
const readBody=async req=>{let body='';for await(const chunk of req)body+=chunk;return body?JSON.parse(body):{};};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://fixture.invalid'),route=url.pathname,parts=route.split('/').filter(Boolean);
    if(route==='/api/bootstrap')return json(res,{projects,threads,providers:[],runs:[],agents:[],artifacts,approvals:[],settings:{defaultPermissionMode:'manual',appearance:'light'}});
    if(route==='/api/settings')return json(res,{defaultPermissionMode:'manual',appearance:'light'});
    if(route==='/api/health')return json(res,{version:'UI fixture'});
    if(route==='/api/computer/status')return json(res,{browser:{available:false},desktop:{available:false}});
    if(route==='/api/evaluations')return json(res,{reports:[]});
    if(route==='/api/artifacts/artifact_manifest')return json(res,{...artifacts[0],content:'{"scope":"component","fixture":true}'});
    if(parts[0]==='api'&&parts[1]==='threads'){
      const thread=threads.find(thread=>thread.id===parts[2]);
      const waiting=thread.id==='thread_a';
      return json(res,{thread,messages:waiting?[{id:'message_fixture',threadId:thread.id,runId:'run_fixture',role:'user',content:'Explicit UI fixture: wait for the NOS3 job.',createdAt:new Date(Date.now()-6000).toISOString()}]:[],runs:waiting?[{id:'run_fixture',threadId:thread.id,status:'running',executionPhase:'waiting_job',waitingJob:{jobId:'nos3_running',scope:'integration'},startedAt:new Date(Date.now()-5000).toISOString()}]:[],events:[],agents:[],approvals:[],artifacts:waiting?artifacts:[]});
    }
    if(parts[0]==='api'&&parts[1]==='projects'){
      const projectId=parts[2],project=projects.find(project=>project.id===projectId);
      if(!project)return json(res,{error:'Project not found'},404);
      if(parts[3]==='threads')return json(res,{threads:[threads.find(thread=>thread.projectId===projectId)],coordinatorThreadId:project.coordinatorThreadId});
      if(parts[3]==='model')return json(res,{nodes:[],links:[],version:0});
      if(parts[3]==='knowledge')return json(res,{files:[]});
      if(parts[3]==='integrations'){
        const response={projectId,connectors:structuredClone(connectors.get(projectId)),modelBackend:{backend:{name:'Open-MBEE SysML v2',available:true,version:'0.54.0',isolated:true}},nos3:{revision:'aaaaaaaa11111111',worker:workers.has(projectId)?{configured:true,...workers.get(projectId)}:{configured:false}},jobs:projectId===projects[0].id?structuredClone(jobs):[]};
        if(delayNext&&projectId===projects[0].id){delayNext=false;delayedStarted?.();await new Promise(resolve=>releaseDelayed=resolve);}
        return json(res,response);
      }
      if(parts[3]==='connectors'){
        if(req.method==='POST'&&parts.length===4){const body=await readBody(req);calls.push({kind:'connector-save',projectId,body});const {runtimeKey,...config}=body;config.id||='mcp_fixture';config.status=config.enabled?'configured':'disabled';config.hasRuntimeKey=!!runtimeKey;const rows=connectors.get(projectId),index=rows.findIndex(row=>row.id===config.id);if(index>=0)rows[index]=config;else rows.push(config);return json(res,config);}
        if(req.method==='DELETE'){calls.push({kind:'connector-delete',projectId,id:parts[4]});connectors.set(projectId,connectors.get(projectId).filter(row=>row.id!==parts[4]));return json(res,{ok:true});}
        if(parts[5]==='test'){calls.push({kind:'connector-test',projectId,id:parts[4]});connectors.get(projectId).find(row=>row.id===parts[4]).status='connected';return json(res,{server:{name:'Explicit UI MCP fixture',version:'1.0'},tools});}
        if(parts[5]==='tools'){calls.push({kind:'connector-discover',projectId,id:parts[4]});return json(res,tools);}
      }
      if(parts[3]==='nos3'&&parts[4]==='worker'){const body=await readBody(req);calls.push({kind:'worker-save',projectId,body});if(body.worker)workers.set(projectId,body.worker);else workers.delete(projectId);return json(res,{configured:!!body.worker,worker:body.worker});}
      if(parts[3]==='nos3'&&parts[4]==='jobs'){
        const job=jobs.find(job=>job.id===parts[5]);
        if(parts[6]==='cancel'){job.status='cancelled';calls.push({kind:'job-cancel',projectId,id:job.id});return json(res,job);}
        if(parts[6]==='result')return json(res,job.status==='running'?{jobId:job.id,status:job.status,ready:false}:{ready:true,scope:job.scope,artifacts:job.artifacts||[],checks:[{id:'V-FIXTURE',criterion:'Explicit UI fixture only',passed:true,actual:0,limit:1e-12,unit:'fixture units'}],pendingRequirements:[{id:'R-SENSOR-SEPARATION',status:'not-tested',reason:'Explicit UI fixture: telemetry path was not executed.'}]});
        return json(res,job);
      }
    }
    const files={'/':'public/index.html','/app.js':'public/app.js','/styles.css':'public/styles.css','/integrations-ui.mjs':'public/integrations-ui.mjs','/approval-card.mjs':'public/approval-card.mjs','/approval-presentation.mjs':'public/approval-presentation.mjs','/codex-model-choice.mjs':'public/codex-model-choice.mjs','/shared/run-presentation.mjs':'shared/run-presentation.mjs','/app-icon.svg':'public/app-icon.svg'};
    if(files[route]){const file=files[route];res.writeHead(200,{'content-type':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.svg')?'image/svg+xml':'text/javascript'});res.end(await fs.readFile(path.join(root,file)));return;}
    return json(res,{error:'Unknown UI fixture route '+route},404);
  }catch(error){json(res,{error:error.message},500);}
});
let browser;
try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  browser=await playwright.chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
  const click=action=>page.locator(`[data-action="${action}"]:visible`).first().click();
  const step=async(name,fn)=>{try{await fn();steps.push(name);console.log('PASS '+name);}catch(error){console.error(JSON.stringify({step:name,errors,body:(await page.locator('body').innerText()).slice(0,4000)}));await page.screenshot({path:path.join(temporary,'failure.png')});throw error;}};
  await page.goto('http://127.0.0.1:'+server.address().port);
  await step('waiting engineering job has a neutral clock and descriptive label, never a thinking pulse',async()=>{
    const run=page.locator('.run-turn[data-run-execution-status="waiting_job"]');await run.waitFor();assert.match(await run.locator('.run-clock').innerText(),/等待工程作业/);assert.equal(await run.locator('.run-summary-icon .pulse').count(),0);await run.locator('.run-process>summary').click();assert.match(await run.locator('.run-job-wait').innerText(),/结果返回后自动继续复核/);
  });
  await step('tool directory and settings expose one project-scoped engineering connection screen',async()=>{
    await click('toggle-overview');await click('open-tools');await click('open-integrations');await page.waitForFunction(()=>document.querySelector('#panel-content')?.textContent.includes('Open-MBEE SysML v2'));assert.match(await page.locator('#panel-content').innerText(),/Open-MBEE SysML v2/);
    await click('view-settings');await page.locator('[data-action="settings-category"][data-id="integrations"]').click();await page.locator('#integration-project-select').waitFor();assert.equal(await page.locator('#integration-project-select').inputValue(),projects[0].id);assert.equal(await page.locator('.integration-actions [data-action^="submit"]').count(),0);
  });
  await step('HTTP MCP add/test/discovery/edit/remove use real UI requests with explicit configuration',async()=>{
    await click('add-mcp-connector');await page.locator('#mcp-name').fill('UI test MCP');await page.locator('#mcp-url').fill('https://worker.example.org/mcp');await page.locator('#mcp-runtime-key').fill('ui-entered-token');await page.locator('#mcp-connector-form [name="enabled"]').check();await page.locator('[form="mcp-connector-form"]').click();await page.locator('#mcp-connector-form').waitFor({state:'detached'});
    assert.equal(calls.find(call=>call.kind==='connector-save').body.runtimeKey,'ui-entered-token');assert.ok(!(await page.content()).includes('ui-entered-token'));
    await click('test-mcp-connector');await page.locator('.integration-test-summary').waitFor();assert.match(await page.locator('.integration-tool-list').innerText(),/需要批准/);assert.equal(await page.locator('.integration-tool-list img').count(),0);await click('close-modal');
    await click('discover-mcp-tools');await page.locator('.integration-tool-list').waitFor();assert.match(await page.locator('.integration-tool-list').innerText(),/inspect_model/);await click('close-modal');
    await click('edit-mcp-connector');await page.locator('#mcp-transport').selectOption('stdio');assert.ok(await page.locator('#mcp-command').isVisible());assert.ok(!await page.locator('#mcp-url').isVisible());await page.locator('#mcp-command').fill('/already-installed/server');await page.locator('#mcp-args').fill('["--project", "."]');await page.locator('.integration-advanced>summary').click();await page.locator('#mcp-policies').fill('{"inspect_model":"read"}');await page.locator('[form="mcp-connector-form"]').click();await page.locator('#mcp-connector-form').waitFor({state:'detached'});
    const saved=calls.filter(call=>call.kind==='connector-save').at(-1).body;assert.equal(saved.transport,'stdio');assert.equal(saved.url,undefined);assert.equal(saved.runtimeKey,undefined);assert.deepEqual(saved.args,['--project','.']);assert.equal(saved.toolPolicies.inspect_model,'read');
    await click('delete-mcp-connector');await click('confirm-action');await page.waitForFunction(()=>document.querySelector('.settings-main').textContent.includes('尚未添加 MCP 连接'));
  });
  await step('NOS3 worker configuration and scoped results preserve evidence without claiming full simulation',async()=>{
    await click('edit-nos3-worker');await page.locator('#nos3-worker-endpoint').fill('https://engineering.example.org/nos3');await page.locator('#nos3-worker-token-env').fill('MANTA_NOS3_UI_TOKEN');await page.locator('[form="nos3-worker-form"]').click();await page.locator('#nos3-worker-form').waitFor({state:'detached'});assert.equal(calls.find(call=>call.kind==='worker-save').body.worker.tokenEnv,'MANTA_NOS3_UI_TOKEN');
    await page.locator('[data-action="view-nos3-job"][data-id="nos3_completed"]:visible').click();await page.locator('.integration-job-result').waitFor();assert.match(await page.locator('.integration-result-scope').innerText(),/未执行完整 NOS3/);assert.match(await page.locator('.integration-pending-requirements').innerText(),/R-SENSOR-SEPARATION · 未验证/);assert.match(await page.locator('.integration-pending-requirements').innerText(),/telemetry path was not executed/);assert.equal(await page.locator('.integration-pending-requirements').locator('xpath=ancestor::details').count(),0);assert.equal(await page.locator('.integration-result-files [data-action="read-artifact"]').count(),1);await click('close-modal');
    await page.locator('[data-action="cancel-nos3-job"][data-id="nos3_running"]:visible').click();await page.waitForFunction(()=>document.querySelector('.settings-main .integration-jobs')?.textContent.includes('已停止'));assert.ok(calls.some(call=>call.kind==='job-cancel'));
    await page.screenshot({path:path.join(temporary,'connections-desktop.png'),fullPage:true});
  });
  await step('late responses from the previous project cannot replace current connection state',async()=>{
    let started;const waitStarted=new Promise(resolve=>started=resolve);delayedStarted=started;delayNext=true;await click('refresh-integrations');await waitStarted;
    await page.locator('#integration-project-select').selectOption(projects[1].id);await page.waitForFunction(()=>document.querySelector('#integration-project-select')?.value==='project_bbbb'&&!document.querySelector('.settings-main')?.textContent.includes('正在读取项目连接'));
    releaseDelayed();await page.waitForTimeout(150);assert.equal(await page.locator('#integration-project-select').inputValue(),projects[1].id);assert.ok(!(await page.locator('.settings-main').innerText()).includes('engineering.example.org/nos3'));
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(temporary,'connections-mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
  });
  assert.deepEqual(errors,[]);console.log(JSON.stringify({scope:'UI-only HTTP fixtures; no engineering tool or model runtime executed',steps:steps.length,errors,screenshots:temporary}));
}finally{releaseDelayed?.();await browser?.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
