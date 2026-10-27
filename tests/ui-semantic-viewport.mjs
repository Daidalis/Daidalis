import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = process.env.MANTA_VIEWPORT_EVIDENCE || await fs.mkdtemp(path.join(os.tmpdir(),'manta-readable-model-'));
await fs.mkdir(out,{recursive:true});
const nodes = Array.from({length:8},(_,i)=>({id:'part-'+i,kind:'part',metaclass:'PartUsage',stereo:'part',label:['Star tracker','Measurement input','Attitude transform','ADCS output'][i%4],line:i+1}));
let fixture={file:{path:'model.sysml',content:'// Presentation fixture'},model:{data:{graph:{nodes,edges:nodes.slice(1).map((node,i)=>({source:nodes[i].id,target:node.id,kind:'flow'}))}}}};
if(process.env.MANTA_VIEWPORT_MODEL_URL){
  const response=await fetch(process.env.MANTA_VIEWPORT_MODEL_URL);assert.equal(response.status,200);
  const payload=await response.json();fixture={file:payload.file,model:payload.semantic};
}
const server=http.createServer(async(req,res)=>{
  if(req.url==='/'){res.setHeader('content-type','text/html');return res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/document-viewer.css"><style>body{margin:0;font-family:system-ui;background:#f5f6f2}#viewer{width:550px;height:900px;margin:20px auto;background:white;border:1px solid #e1e4da}</style><div id="viewer"></div><script type="module">import{mountDocumentViewer}from"/document-viewer.mjs";window.fixture=await(await fetch("/fixture.json")).json();window.viewer=mountDocumentViewer(document.querySelector("#viewer"),fixture);window.ready=true;</script>');}
  if(req.url==='/fixture.json'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(fixture));}
  if(!['/document-viewer.mjs','/document-viewer.css','/vendor/marked/marked.esm.js'].includes(req.url)){res.writeHead(404);return res.end();}
  res.setHeader('content-type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(path.join(root,'public',req.url.slice(1))));
});
let browser;const errors=[];
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});
  const page=await browser.newPage({viewport:{width:1280,height:960}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
  const svg=page.locator('.semantic-svg');
  await page.waitForFunction(()=>document.querySelector('.semantic-label')?.getScreenCTM().a>=1);
  const before=await svg.getAttribute('viewBox');
  const labelPixels=await page.locator('.semantic-label').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)*el.getScreenCTM().a);
  assert.ok(labelPixels>=12,'initial labels must be at least 12 CSS pixels');
  const visibleNode=await page.locator('.semantic-node').evaluateAll(nodes=>{const canvas=document.querySelector('.semantic-canvas').getBoundingClientRect();return nodes.find(el=>{const r=el.getBoundingClientRect();return r.x>=canvas.x&&r.y>=canvas.y&&r.right<=canvas.right&&r.bottom<=canvas.bottom;})?.dataset.documentElement;});
  assert.ok(visibleNode,'initial viewport must show at least one entire node');
  await page.locator('[data-document-element="'+visibleNode+'"]').click();assert.match(await page.locator('.semantic-details').innerText(),/类型/);
  await page.screenshot({path:path.join(out,'08-sysml-readable-default.png')});
  const canvas=await page.locator('.semantic-canvas').boundingBox();await page.mouse.move(canvas.x+8,canvas.y+8);await page.mouse.down();await page.mouse.move(canvas.x+90,canvas.y+55);await page.mouse.up();assert.notEqual(await svg.getAttribute('viewBox'),before,'drag remains active');
  const dragged=await svg.getAttribute('viewBox');await page.locator('[data-document-zoom="in"]').click();assert.notEqual(await svg.getAttribute('viewBox'),dragged,'zoom remains active');
  await page.locator('[data-document-fit]').click();const fit=await svg.getAttribute('viewBox');const full=await svg.evaluate(el=>'0 0 '+el.dataset.diagramWidth+' '+el.dataset.diagramHeight);assert.equal(fit,full,'explicit fit must restore complete model bounds');assert.notEqual(fit,before);
  await page.screenshot({path:path.join(out,'09-sysml-explicit-fit.png')});
  await page.evaluate(()=>{document.querySelector('#viewer').style.width='680px';});await page.waitForTimeout(50);assert.equal(await svg.getAttribute('viewBox'),fit,'resize must not override explicit fit');
  await page.locator('[data-document-filter]').selectOption('all');await page.waitForFunction(()=>document.querySelector('.semantic-label').getScreenCTM().a>=1);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:5,labelPixels,realModel:!!process.env.MANTA_VIEWPORT_MODEL_URL,nodes:await page.locator('.semantic-node').count(),evidence:out,errors},null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
