import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {chromium} from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))), temporary = await fs.mkdtemp(path.join(os.tmpdir(),'manta-document-viewer-'));
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
const tablePath = 'examples/physical-preview/table.sysml';
const table = {path:tablePath,content:await fs.readFile(path.join(root,tablePath),'utf8')};
const widerTable = {...table,content:table.content.replace('length = 120 [cm]','length = 160 [cm]')};
assert.notEqual(widerTable.content,table.content);
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
  browser = await chromium.launch({headless:true,...(process.env.MBSE_CHROME_PATH ? {executablePath:process.env.MBSE_CHROME_PATH} : process.platform === 'darwin' ? {channel:'chrome'} : {})});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port);await page.waitForFunction(() => window.ready);
  assert.ok(await page.locator('.semantic-node').count() > 10);
  await page.locator('[data-document-fit]').click();
  await page.locator('.semantic-node').first().click();assert.match(await page.locator('.semantic-details').innerText(),/类型/);
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
  await openProduct(table);
  assert.match(await page.locator('.semantic-details').innerText(),/1200 × 700 × 750 mm/);
  const part = page.locator('select[data-physical-part]');
  const names = await part.locator('option').allTextContents();
  for(const name of ['tabletop','frontLeftLeg','frontRightLeg','rearLeftLeg','rearRightLeg'])
    assert.ok(names.some(label => label.includes(name)),name);
  await part.selectOption(await part.locator('option').filter({hasText:'frontLeftLeg'}).getAttribute('value'));
  assert.match(await page.locator('.semantic-details').innerText(),/frontLeftLeg/);
  assert.match(await page.locator('.semantic-details').innerText(),/60 × 60 × 720 mm/);
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
  assert.ok(!initialImage.equals(rotated),'drag should rotate the table');
  await page.keyboard.down('Shift');
  await page.mouse.down();await page.mouse.move(x+120,y+80,{steps:5});await page.mouse.up();
  await page.keyboard.up('Shift');await cameraFrame();
  assert.ok(!rotated.equals(await canvas.screenshot()),'shift-drag should pan the table');
  await page.setViewportSize({width:700,height:800});await cameraFrame();
  assert.ok((await canvas.boundingBox()).width < area.width);
  await page.setViewportSize({width:1440,height:1000});await cameraFrame();
  const location = page.locator('.semantic-details [data-document-source-line]').first();
  const sourceLine = Number(await location.getAttribute('data-document-source-line'));
  await location.click();
  assert.equal(await page.locator('.source-line.is-highlighted').getAttribute('data-source-line'),String(sourceLine));
  assert.ok(table.content.split(/\r?\n/)[sourceLine-1].includes('frontLeftLeg'));
  assert.equal(await canvas.count(),0);

  await openProduct(table);
  const originalTable = await canvas.screenshot({path:path.join(temporary,'table-3d.png')});
  await openProduct(widerTable);
  assert.match(await page.locator('.semantic-details').innerText(),/1600 × 700 × 750 mm/);
  assert.ok(!originalTable.equals(await canvas.screenshot()),'an edited tabletop length should change the solid assembly');
  steps.push('SysML solid table, dimension change, missing geometry, part selection, camera and source location');
  await page.evaluate(() => viewer.update({...fixture,tab:'diagram'}));
  await page.locator('button[data-document-tab="outline"]').click();await page.locator('[data-document-search]').fill('CorrectFrame');assert.match(await page.locator('.semantic-outline').innerText(),/CorrectFrame/);assert.ok(await page.locator('.semantic-outline-row').count() <= 3);
  await page.locator('.semantic-outline-row').first().click();assert.equal(await page.locator('.source-line.is-highlighted').count(),1,JSON.stringify({errors,tab:await page.locator('.document-viewer').getAttribute('data-document-tab'),body:(await page.locator('#viewer').innerText()).slice(0,1000)}));steps.push('searchable semantic outline jumps to original source');
  await page.evaluate(() => viewer.selectSourceLine(16));assert.equal(await page.locator('.source-line.is-highlighted').getAttribute('data-source-line'),'16');
  await page.evaluate(() => viewer.update({sourceLine:28}));assert.equal(await page.locator('.source-line.is-highlighted').getAttribute('data-source-line'),'28');
  await page.locator('button[data-document-tab="diagnostics"]').click();assert.match(await page.locator('.document-diagnostics').innerText(),/校验通过/);
  await page.locator('button[data-document-tab="constraints"]').click();assert.match(await page.locator('.document-constraints').innerText(),/后端静态约束求值/);steps.push('backend diagnostics and real static verification results');
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
