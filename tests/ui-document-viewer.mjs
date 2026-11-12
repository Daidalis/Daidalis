import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {chromium} from 'playwright';
import {createStore} from '../server/store.mjs';
import {createModelBackendService} from '../server/model-backend.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))), temporary = process.env.DAIDALIS_DOCUMENT_EVIDENCE || await fs.mkdtemp(path.join(os.tmpdir(),'daidalis-document-viewer-'));
await fs.mkdir(temporary,{recursive:true});
const source = await fs.readFile(path.join(root,'server/model-backend/nos3-integration.sysml'),'utf8');
function kernel(operation, file) {
  const result = spawnSync(process.execPath,[path.join(root,'server/model-backend/worker.mjs'),path.join(root,'toolchains/sysml/package')],{
    input:JSON.stringify({operation,sources:[{name:file.path,text:file.content}]}),encoding:'utf8',maxBuffer:12_000_000
  });
  assert.equal(result.status,0,result.stderr);
  const semantic = JSON.parse(result.stdout);
  assert.equal(semantic.valid,true,JSON.stringify(semantic.findings));
  return semantic;
}
const mission = {path:'models/mission.sysml',content:source};
const fixture = {file:mission,model:kernel('query',mission),verification:kernel('verify',mission)};
const carPath = 'examples/physical-preview/electric-vehicle.sysml';
const car = {path:carPath,content:await fs.readFile(path.join(root,carPath),'utf8')};
const editedCar = {...car,content:car.content.replace(/upperZ\s*=\s*1440\s*\[mm\]/g,'upperZ = 1470 [mm]')};
assert.notEqual(editedCar.content,car.content);
const threeModules = new Set(['/vendor/three/three.module.min.js','/vendor/three/three.core.min.js']);
const markdown = '# NOS3 验证报告\n\n> 本次真实软件链结果\n\n| 场景 | 判据 |\n|---|---|\n| 正常 | **误差 < 0.02°** |\n\n- 坐标\n  - 输入\n- [x] 复核\n\n```sysml\npart starTracker : Sensor;\n```\n\n[查看模型](../models/mission.sysml#L16)\n\n[官方文档](https://nos3.readthedocs.io/)\n\n<img src=x onerror="window.pwned=1">\n\n[恶意](javascript:window.pwned=2)';
const server = http.createServer(async(req,res) => {
  const route = new URL(req.url,'http://localhost').pathname;
  if(route === '/') {res.writeHead(200,{'content-type':'text/html'});return res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/document-viewer.css"><link rel="stylesheet" href="/physical-preview-3d.css"><style>body{margin:0;font-family:system-ui;height:100vh}#viewer{height:100vh}</style><div id="viewer"></div><script type="module">import{mountDocumentViewer}from"/document-viewer.mjs";window.opened=[];window.external=[];window.fixture=await(await fetch("/fixture.json")).json();window.viewer=mountDocumentViewer(document.querySelector("#viewer"),{...fixture,onOpenPath:(path,detail)=>opened.push({path,...detail}),onOpenExternal:url=>external.push(url)});window.ready=true;</script>');}
  if(route === '/fixture.json') {res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify(fixture));}
  if(route === '/api/test-image') {res.writeHead(200,{'content-type':'image/png'});return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yF9sAAAAASUVORK5CYII=','base64'));}
  const relative = route.slice(1);if(relative.includes('..')) {res.writeHead(404);return res.end();}
  const asset = threeModules.has(route) ? path.join(root,'node_modules','three','build',path.basename(route)) : path.join(root,'public',relative);
  try {const content = await fs.readFile(asset);res.writeHead(200,{'content-type':relative.endsWith('.css')?'text/css':'text/javascript'});res.end(content);}catch {res.writeHead(404);res.end();}
});
let browser;const errors = [],steps = [];
try {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  browser = await chromium.launch({headless:true,...(process.env.DAIDALIS_CHROME_PATH ? {executablePath:process.env.DAIDALIS_CHROME_PATH} : process.platform === 'darwin' ? {channel:'chrome'} : {})});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port);await page.waitForFunction(() => window.ready);
  assert.ok(await page.locator('.semantic-node').count() > 10);
  assert.equal(await page.locator('[data-document-filter]').inputValue(),'structure');
  assert.equal(await page.locator('[data-document-filter] option[value="interconnection"]').count(),0);
  await page.waitForFunction(() => document.querySelector('.semantic-label').getScreenCTM().a >= 1);
  await page.locator('[data-document-fit]').click();
  await page.locator('.semantic-node').first().locator('.semantic-label').first().click();assert.match(await page.locator('.semantic-details').innerText(),/selectedMission[\s\S]*类型/);
  const before = await page.locator('.semantic-svg').getAttribute('viewBox');await page.locator('[data-document-zoom="in"]').click();assert.notEqual(await page.locator('.semantic-svg').getAttribute('viewBox'),before);await page.locator('[data-document-fit]').click();assert.equal(await page.locator('.semantic-svg').getAttribute('viewBox'),before);
  await page.locator('[data-document-filter]').selectOption('requirements');assert.match(await page.locator('.semantic-svg').textContent(),/requirement/);
  await page.screenshot({path:path.join(temporary,'model.png')});steps.push('real semantic model diagram, element details, filter and zoom');
  await page.locator('button[data-document-tab="preview3d"]').click();
  assert.equal(await page.locator('[data-physical-preview] canvas').count(),0);
  assert.match(await page.locator('.document-main').innerText(),/几何|实体|外形/);

  const canvas = page.locator('[data-physical-preview] canvas');
  const cameraFrame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function openProduct(file) {
    await page.evaluate(options => viewer.update(options),{file,model:kernel('query',file),verification:null,tab:'preview3d'});
    await canvas.waitFor();
    await cameraFrame();
  }
  await openProduct(car);
  assert.match(await page.locator('.semantic-details').innerText(),/4720 × 2089 × 1440 mm/);
  const part = page.locator('select[data-physical-part]');
  const names = await part.locator('option').allTextContents();
  for(const name of ['bodyShell','panoramicGlass','frontLeftTyre','frontRightTyre','rearLeftTyre','rearRightTyre'])
    assert.ok(names.some(label => label.includes(name)),name);
  await part.selectOption(await part.locator('option').filter({hasText:'frontLeftTyre'}).getAttribute('value'));
  assert.match(await page.locator('.semantic-details').innerText(),/frontLeftTyre/);
  assert.match(await page.locator('.semantic-details').innerText(),/668\.7 × 235 × 668\.7 mm/);
  await cameraFrame();
  const initialImage = await canvas.screenshot();
  await page.locator('[data-document-zoom="in"]').click();
  await cameraFrame();
  assert.ok(!initialImage.equals(await canvas.screenshot()),'zoom should change the rendered model');
  await page.locator('[data-document-fit]').click();
  await cameraFrame();
  assert.ok(initialImage.equals(await canvas.screenshot()),'fit should restore the original view');
  const area = await canvas.boundingBox();
  const x = area.x + area.width / 2, y = area.y + area.height / 2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+70,y+30,{steps:5});await page.mouse.up();
  await cameraFrame();
  const rotated = await canvas.screenshot();
  assert.ok(!initialImage.equals(rotated),'drag should rotate the car');
  await page.keyboard.down('Shift');
  await page.mouse.down();await page.mouse.move(x+120,y+80,{steps:5});await page.mouse.up();
  await page.keyboard.up('Shift');await cameraFrame();
  assert.ok(!rotated.equals(await canvas.screenshot()),'shift-drag should pan the car');
  await page.setViewportSize({width:700,height:800});await cameraFrame();
  assert.ok((await canvas.boundingBox()).width < area.width);
  await page.setViewportSize({width:1440,height:1000});await cameraFrame();
  const location = page.locator('.semantic-details [data-document-source-line]').first();
  const sourceLine = Number(await location.getAttribute('data-document-source-line'));
  await location.click();
  assert.equal(await page.locator('.source-line.is-highlighted').getAttribute('data-source-line'),String(sourceLine));
  assert.ok(car.content.split(/\r?\n/)[sourceLine-1].includes('frontLeftTyre'));
  assert.equal(await canvas.count(),0);

  await openProduct(car);
  const originalCar = await canvas.screenshot({path:path.join(temporary,'electric-vehicle.png')});
  await openProduct(editedCar);
  assert.match(await page.locator('.semantic-details').innerText(),/4720 × 2089 × 1470 mm/);
  assert.ok(!originalCar.equals(await canvas.screenshot()),'editing the roof section height should change the solid assembly');
  steps.push('SysML electric vehicle assembly, dimension change, missing geometry, part selection, camera and source location');
  await page.evaluate(() => viewer.update({...fixture,tab:'diagram'}));
  await page.locator('button[data-document-tab="outline"]').click();await page.locator('[data-document-search]').fill('CorrectFrame');assert.match(await page.locator('.semantic-outline').innerText(),/CorrectFrame/);assert.ok(await page.locator('.semantic-outline-row').count() <= 3);
  await page.locator('.semantic-outline-row').first().click();assert.equal(await page.locator('.source-line.is-highlighted').count(),1,JSON.stringify({errors,tab:await page.locator('.document-viewer').getAttribute('data-document-tab'),body:(await page.locator('#viewer').innerText()).slice(0,1000)}));steps.push('searchable semantic outline jumps to original source');
  await page.evaluate(() => viewer.selectSourceLine(16));assert.equal(await page.locator('.source-line.is-highlighted').getAttribute('data-source-line'),'16');
  await page.evaluate(() => viewer.update({sourceLine:28}));assert.equal(await page.locator('.source-line.is-highlighted').getAttribute('data-source-line'),'28');
  await page.locator('button[data-document-tab="diagnostics"]').click();assert.match(await page.locator('.document-diagnostics').innerText(),/校验通过/);
  await page.locator('button[data-document-tab="constraints"]').click();assert.match(await page.locator('.document-constraints').innerText(),/后端静态约束求值/);steps.push('backend diagnostics and real static verification results');
  const store = createStore({dataDir:path.join(temporary,'project-data'),seed:false}), project = store.createProject({name:'Generated interconnection acceptance'});
  const service = await createModelBackendService({store}), modelPath = 'models/generated-chain.sysml';
  const generated = `package GeneratedChain {
    port def Signal;
    part def Device {
        port input : Signal;
        port output : Signal;
    }
    part system {
        part sensor : Device;
        part processing {
            part uart : Device;
            part flightSoftware : Device;
        }
        part estimator : Device;
        connection sensorToUart connect sensor.output to processing.uart.input;
        connection uartToSoftware connect processing.uart.output to processing.flightSoftware.input;
        connection softwareToEstimator connect processing.flightSoftware.output to estimator.input;
    }
}`;
  const args = {projectId:project.id,path:modelPath}, imported = await service.importModel({...args,content:generated});
  assert.equal(imported.imported,true);
  async function readGenerated() {
    const model = await service.query(args), content = await fs.readFile(path.join(store.workspace(project.id),modelPath),'utf8');
    return {file:{path:modelPath,content,sha256:model.model.sha256},model,verification:null,tab:'diagram',filter:'structure'};
  }
  const generatedFixture = await readGenerated();
  await fs.writeFile(path.join(temporary,'generated-model.json'),JSON.stringify(generatedFixture,null,2));
  await page.evaluate(options => viewer.update(options),generatedFixture);
  assert.equal(await page.locator('.semantic-container').count(),2);
  assert.equal(await page.locator('.semantic-edge-typing,.semantic-edge-composition').count(),0);
  const bounds = await page.locator('.semantic-node').evaluateAll(elements => elements.map(element => {
    const rect = element.querySelector('rect').getBoundingClientRect();
    return {id:element.dataset.documentElement,parent:element.dataset.documentParent,port:element.classList.contains('semantic-endpoint'),left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};
  }));
  for (const node of bounds) {
    const parent = bounds.find(item => item.id === node.parent);if(!parent)continue;
    assert.ok(node.top > parent.top && node.bottom < parent.bottom);
    if (node.port) assert.ok(Math.min(Math.abs((node.left + node.right)/2 - parent.left),Math.abs((node.left + node.right)/2 - parent.right)) < 1);
    else assert.ok(node.left > parent.left && node.right < parent.right);
  }
  await page.locator('[data-document-fit]').click();
  assert.equal(await page.locator('.semantic-edge-connect').count(),3);
  assert.equal(await page.locator('.semantic-edge-connect [marker-end],.semantic-edge-connect [marker-start]').count(),0);
  const endpoints = await page.locator('.semantic-endpoint').evaluateAll(elements => elements.map(element => ({id:element.dataset.documentElement,label:element.getAttribute('aria-label')})));
  const uartInput = endpoints.find(node => node.label.startsWith('uart : Device') && node.label.endsWith('input : Signal'));
  const softwareInput = endpoints.find(node => node.label.startsWith('flightSoftware : Device') && node.label.endsWith('input : Signal'));
  assert.ok(uartInput);assert.ok(softwareInput);assert.notEqual(uartInput.id,softwareInput.id);
  for (const [name,line] of [['sensorToUart',14],['uartToSoftware',15],['softwareToEstimator',16]]) {
    const edge = page.locator('.semantic-edge-connect').filter({has:page.locator('text', {hasText:new RegExp('^' + name + '$')})});
    await edge.locator('text').click();
    assert.match(await page.locator('.semantic-details').innerText(),new RegExp(name + '[\\s\\S]*ConnectionUsage'));
    assert.equal(await page.locator('.semantic-details [data-document-source-line]').getAttribute('data-document-source-line'),String(line));
    if (name === 'uartToSoftware') await page.screenshot({path:path.join(temporary,'combined-view.png')});
    await page.locator('.semantic-details [data-document-source-line]').click();
    assert.equal(await page.locator('.source-line.is-highlighted').getAttribute('data-source-line'),String(line));
    await page.locator('button[data-document-tab="diagram"]').click();await page.locator('[data-document-fit]').click();
  }
  await page.locator('.semantic-edge-connect').first().press('Enter');
  assert.equal(await page.locator('.semantic-edge-connect.is-selected').count(),1);
  await page.locator('.semantic-edge-connect').first().press(' ');
  assert.equal(await page.locator('.semantic-edge-connect.is-selected').count(),1);
  await page.locator(`.semantic-endpoint[data-document-element="${uartInput.id}"]`).click();
  assert.match(await page.locator('.semantic-details').innerText(),/所属元素[\s\S]*uart : Device/);
  assert.equal(await page.locator('.semantic-edge-connect.is-connected').count(),1);
  await page.locator('button[data-document-tab="outline"]').click();await page.locator('[data-document-search]').fill('flightSoftware');
  assert.ok(await page.locator('.semantic-outline-row').count() > 0);
  await page.locator('.semantic-outline-row').first().click();assert.equal(await page.locator('.source-line.is-highlighted').count(),1);
  await page.locator('button[data-document-tab="diagram"]').click();await page.locator('[data-document-fit]').click();
  const interconnectionBox = await page.locator('.semantic-svg').getAttribute('viewBox');
  await page.locator('[data-document-zoom="in"]').click();assert.notEqual(await page.locator('.semantic-svg').getAttribute('viewBox'),interconnectionBox);
  await page.locator('[data-document-fit]').click();assert.equal(await page.locator('.semantic-svg').getAttribute('viewBox'),interconnectionBox);
  const canvas = await page.locator('.semantic-canvas').boundingBox();
  await page.mouse.move(canvas.x+8,canvas.y+8);await page.mouse.down();await page.mouse.move(canvas.x+70,canvas.y+50);await page.mouse.up();
  assert.notEqual(await page.locator('.semantic-svg').getAttribute('viewBox'),interconnectionBox);
  await page.locator('[data-document-filter]').selectOption('all');assert.ok(await page.locator('.semantic-edge-typing').count() > 0);
  await page.locator('[data-document-filter]').selectOption('structure');assert.equal(await page.locator('.semantic-container').count(),2);
  steps.push('default combined view, nested composition, boundary ports, distinct usage identities, edge details, keyboard selection, source navigation, search, drag and zoom');
  const changed = generated.replace('part uart : Device;','part gateway : Device;').replaceAll('uart.input','gateway.input').replaceAll('uart.output','gateway.output').replace('connection sensorToUart connect sensor.output to processing.gateway.input;','connection sensorToGateway connect processing.gateway.input to sensor.output;');
  const saved = await service.importModel({...args,content:changed,expectedHash:imported.model.sha256});
  assert.equal(saved.imported,true);assert.notEqual(saved.model.sha256,imported.model.sha256);
  const refreshed = await readGenerated();
  await page.evaluate(options => viewer.update(options),refreshed);
  await page.locator('[data-document-fit]').click();
  assert.equal(await page.locator('.semantic-edge-connect').count(),3);
  assert.match(await page.locator('.semantic-svg').textContent(),/sensorToGateway/);
  assert.doesNotMatch(await page.locator('.semantic-svg').textContent(),/sensorToUart|uart : Device/);
  assert.equal(await page.locator('.semantic-edge-connect [marker-end],.semantic-edge-connect [marker-start]').count(),0);
  assert.match(await page.locator('.document-model-meta').innerText(),new RegExp(saved.model.sha256.slice(0,12)));
  await page.screenshot({path:path.join(temporary,'combined-view-refreshed.png')});
  await fs.writeFile(path.join(temporary,'refreshed-model.json'),JSON.stringify(refreshed,null,2));
  steps.push('hash-guarded node and connection edit, save, fresh backend query and updated undirected diagram');
  await page.setViewportSize({width:650,height:900});
  await page.locator('[data-document-filter]').selectOption('all');await page.locator('[data-document-filter]').selectOption('structure');
  await page.waitForFunction(() => document.querySelector('.semantic-label').getScreenCTM().a >= 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  const readablePort = await page.locator('.semantic-endpoint .semantic-label').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize)*element.getScreenCTM().a);
  assert.ok(readablePort >= 11);
  await page.locator('.semantic-edge-connect').first().press('Enter');
  assert.equal(await page.locator('.source-line.is-highlighted').count(),1);
  await page.locator('button[data-document-tab="diagram"]').click();
  assert.equal(await page.locator('.semantic-edge-connect').count(),3);
  steps.push('narrow combined view preserves readable scale, keyboard edge selection and source fallback');
  await page.setViewportSize({width:1440,height:1000});
  const draftPath = 'models/unresolved-draft.sysml', draftContent = 'package Draft {\n    part sensor : MissingSensor;\n}';
  await fs.writeFile(path.join(store.workspace(project.id),draftPath),draftContent);
  const draftModel = await service.query({projectId:project.id,path:draftPath});
  assert.equal(draftModel.valid,false);assert.ok(draftModel.findings.some(item => item.stage === 'referential'));
  const draftFixture = {file:{path:draftPath,content:draftContent},model:draftModel,verification:null,tab:'diagram',filter:'structure'};
  await fs.writeFile(path.join(temporary,'unresolved-draft.json'),JSON.stringify(draftFixture,null,2));
  await page.evaluate(options => viewer.update(options),draftFixture);
  assert.ok(await page.locator('.semantic-node').count() > 0);
  assert.match(await page.getByRole('status',{name:'模型图状态'}).innerText(),/部分结果[\s\S]*未通过语义校验/);
  const draftBox = await page.locator('.semantic-svg').getAttribute('viewBox');
  await page.locator('[data-document-zoom="in"]').click();assert.notEqual(await page.locator('.semantic-svg').getAttribute('viewBox'),draftBox);
  await page.locator('[data-document-filter]').selectOption('all');
  assert.match(await page.getByRole('status',{name:'模型图状态'}).innerText(),/部分结果/);
  await page.locator('[data-document-filter]').selectOption('structure');
  await page.screenshot({path:path.join(temporary,'partial-model.png')});
  await page.getByRole('button',{name:/^查看诊断/}).click();
  assert.match(await page.locator('.document-diagnostics').innerText(),/MissingSensor/);
  await page.getByRole('button',{name:'查看第 2 行',exact:true}).click();
  assert.equal(await page.locator('.source-line.is-highlighted').getAttribute('data-source-line'),'2');
  await page.locator('button[data-document-tab="diagram"]').click();
  await page.setViewportSize({width:650,height:900});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  const noticeBounds = await page.getByRole('status',{name:'模型图状态'}).boundingBox(), draftCanvas = await page.locator('.semantic-canvas').boundingBox();
  assert.ok(noticeBounds.y + noticeBounds.height <= draftCanvas.y);
  await page.screenshot({path:path.join(temporary,'partial-model-narrow.png')});
  steps.push('real unresolved draft stays drawable with a visible warning, diagnostic navigation, source location, zoom, view switching and narrow layout');
  await page.evaluate(options => viewer.update(options),refreshed);
  assert.equal(await page.locator('.document-model-notices').count(),0);
  await page.evaluate(() => viewer.update({model:null}));
  assert.match(await page.getByRole('status',{name:'模型图状态'}).innerText(),/尚未取得语义校验结果/);
  await page.evaluate(() => viewer.update({model:{available:false,valid:null,error:'Toolchain unavailable'}}));
  assert.match(await page.getByRole('status',{name:'模型图状态'}).innerText(),/语义后端暂不可用/);
  assert.doesNotMatch(await page.getByRole('status',{name:'模型图状态'}).innerText(),/部分结果|未通过语义校验/);
  await page.getByRole('button',{name:/^查看诊断/}).click();
  assert.match(await page.locator('.document-diagnostics').innerText(),/Toolchain unavailable/);
  steps.push('model updates clear old warnings and distinguish checked, unchecked and unavailable results');
  await page.setViewportSize({width:1440,height:1000});
  const limitNodes = [{id:'sender',label:'sender',metaclass:'PartUsage'},{id:'receiver',label:'receiver',metaclass:'PartUsage'}];
  const limitEdges = Array.from({length:4801},(_,index) => ({id:'wire-' + index,source:'sender',target:'receiver',kind:'connect',label:'wire-' + index}));
  await page.evaluate(options => viewer.update(options),{file:{path:'models/edge-limit.sysml'},model:{valid:true,data:{nodes:limitNodes,edges:limitEdges}},tab:'diagram',filter:'structure'});
  assert.equal(await page.locator('.semantic-edge-connect').count(),4800);
  assert.match(await page.getByRole('status',{name:'模型图状态'}).innerText(),/图数据已截断[\s\S]*4800\s*\/\s*4801/);
  await page.locator('.semantic-edge-connect').first().press('Enter');
  assert.match(await page.locator('.semantic-details').innerText(),/wire-0/);
  const limitedBox = await page.locator('.semantic-svg').getAttribute('viewBox');
  await page.locator('[data-document-zoom="in"]').click();assert.notEqual(await page.locator('.semantic-svg').getAttribute('viewBox'),limitedBox);
  await page.locator('[data-document-filter]').selectOption('all');
  assert.match(await page.getByRole('status',{name:'模型图状态'}).innerText(),/4800\s*\/\s*4801/);
  await page.locator('[data-document-filter]').selectOption('structure');
  await page.screenshot({path:path.join(temporary,'edge-limit.png')});
  await page.setViewportSize({width:650,height:900});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  const limitsNotice = await page.getByRole('status',{name:'模型图状态'}).boundingBox(), limitedCanvas = await page.locator('.semantic-canvas').boundingBox();
  assert.ok(limitsNotice.y + limitsNotice.height <= limitedCanvas.y);
  await page.evaluate(data => viewer.update({model:{valid:true,data}}),{nodes:limitNodes,edges:limitEdges.slice(0,4800)});
  assert.equal(await page.locator('.semantic-edge-connect').count(),4800);
  assert.equal(await page.locator('.document-model-notices').count(),0);
  steps.push('synthetic 4801-edge graph reports the 4800-edge cap, keeps selection and zoom, and clears the notice at the exact limit');
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(markdown => {viewer.update({file:{path:'reports/run.md',content:markdown,mime:'text/markdown'},model:null,verification:null,tab:'preview'});},markdown);
  assert.equal(await page.locator('.document-markdown table').count(),1);assert.equal(await page.locator('.document-markdown ul ul').count(),1);assert.equal(await page.locator('.document-markdown img,.document-markdown script,.document-markdown iframe,.document-markdown svg').count(),0);assert.equal(await page.evaluate(() => window.pwned),undefined);
  await page.locator('[data-document-path="models/mission.sysml"]').click();assert.deepEqual(await page.evaluate(() => opened.at(-1)),{path:'models/mission.sysml',line:16});
  await page.locator('[data-document-external]').click();assert.equal(await page.evaluate(() => external[0]),'https://nos3.readthedocs.io/');
  await page.screenshot({path:path.join(temporary,'markdown.png')});steps.push('GFM report rendering, safe HTML, relative files and explicit external navigation');
  await page.locator('button[data-document-tab="source"]').click();assert.match(await page.locator('.document-source').innerText(),/# NOS3/);await page.locator('button[data-document-tab="preview"]').click();
  await page.setViewportSize({width:650,height:900});assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);steps.push('source mode and narrow-window layout');
  await page.evaluate(() => viewer.update({file:{path:'plots/attitude.png',type:'image',mime:'image/png',encoding:'base64',content:'BINARY_BYTES_MUST_NOT_RENDER'},resolveImage:()=>'/api/test-image',tab:'preview'}));
  await page.waitForFunction(() => document.querySelector('.document-raster-image')?.naturalWidth === 1);assert.doesNotMatch(await page.locator('#viewer').innerText(),/BINARY_BYTES_MUST_NOT_RENDER/);steps.push('direct image files display through the project asset route');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:steps.length,steps,evidence:temporary,errors},null,2));
} finally {await browser?.close();await new Promise(resolve => server.close(resolve));}
