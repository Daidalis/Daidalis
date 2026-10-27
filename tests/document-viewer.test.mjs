import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {renderMarkdown,resolveDocumentLink,documentKind,normalizeSemanticGraph,layoutSemanticGraph,renderDocumentViewer} from '../public/document-viewer.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = 'package ViewerExample { private import ScalarValues::*; attribute def Quaternion { attribute scalar : Real; } part def Sensor { port sample; } part sensor : Sensor; requirement def CorrectFrame; requirement contract : CorrectFrame; attribute residual : Real = 0.0024; assert constraint framePassed { residual < 0.02 } }';
function kernel(operation) {
  const result = spawnSync(process.execPath,[path.join(root,'server/model-backend/worker.mjs'),path.join(root,'toolchains/sysml/package')],{input:JSON.stringify({operation,sources:[{name:'models/example.sysml',text:source}]}),encoding:'utf8',maxBuffer:12_000_000});
  assert.equal(result.status,0,result.stderr);
  return JSON.parse(result.stdout);
}

test('Markdown renders GFM tables, nested lists, blockquotes, code and task lists',() => {
  const html = renderMarkdown('# 工程报告\n\n> 核对测量\n\n- 架构\n  - 输入接口\n- [x] 仿真\n\n| 场景 | 误差 |\n|---|---:|\n| 正常 | **0.0024°** |\n\n```sysml\npart sensor : Sensor;\n```');
  assert.match(html,/<h1>工程报告<\/h1>/);
  assert.match(html,/<blockquote>/);assert.match(html,/<ul>[\s\S]*<ul>/);assert.match(html,/type="checkbox"/);
  assert.match(html,/<table>/);assert.match(html,/<strong>0.0024°<\/strong>/);assert.match(html,/class="language-sysml"/);
});

test('untrusted Markdown HTML and URLs never introduce executable markup',() => {
  const html = renderMarkdown('<script>globalThis.pwned=1</script>\n\n<img src=x onerror=alert(1)>\n\n<svg onload=alert(2)>\n\n[x](javascript:alert(1)) [y](data:text/html,bad) [z](JaVaScRiPt:bad)\n\n```html\n</code><iframe src=x>\n```');
  assert.doesNotMatch(html,/<script|<img|<svg|<iframe|href="javascript|href="data:/i);
  assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;iframe/);
});

test('relative report links resolve to project files and never escape the project root',() => {
  assert.deepEqual(resolveDocumentLink('../models/demo.sysml#L23','reports/result.md'),{kind:'path',path:'models/demo.sysml',line:23,hash:'#L23'});
  assert.equal(resolveDocumentLink('../../secret','reports/result.md'),null);
  for(const href of ['javascript:alert(1)','data:text/html,x','file:///etc/passwd','//evil.example/a','%2e%2e/%2e%2e/secret','java\nscript:x','\\host\\a','javascript%3Aalert(1)'])assert.equal(resolveDocumentLink(href,'reports/a.md'),null,href);
  assert.deepEqual(resolveDocumentLink('https://example.org/docs','a.md'),{kind:'external',href:'https://example.org/docs'});
  assert.equal(resolveDocumentLink('https://user:pass@example.org'),null);
  assert.match(renderMarkdown('[模型](../models/demo.sysml#L23)',{path:'reports/result.md'}),/data-document-path="models\/demo.sysml" data-document-line="23"/);
});

test('images require Manta project routes and remote images stay explicit file links',() => {
  const html = renderMarkdown('![曲线](../plots/result.png)\n\n![远程](https://example.org/tracker.png)',{path:'reports/test.md',resolveImage:file => '/api/project/image?path=' + encodeURIComponent(file)});
  assert.match(html,/<img src="\/api\/project\/image\?path=plots%2Fresult.png"/);
  assert.equal((html.match(/<img /g) || []).length,1);
  assert.match(html,/data-document-external="https:\/\/example.org\/tracker.png"/);
  assert.doesNotMatch(renderMarkdown('![svg](image.svg)',{resolveImage:() => '/api/image'}),/<img/);
  assert.doesNotMatch(renderMarkdown('![bad](image.png)',{resolveImage:() => 'https://evil.example/p.png'}),/<img/);
});

test('model diagram maps the real SysML kernel graph, includes typed members and source positions',() => {
  const semantic = kernel('query');assert.equal(semantic.valid,true);
  const graph = normalizeSemanticGraph(semantic,{path:'models/example.sysml'});
  assert.ok(graph.nodes.some(node => node.metaclass === 'PartDefinition' && node.label === 'Sensor'));
  assert.ok(graph.rows.some(node => /scalar/.test(node.label) && node.parent && node.line === 1));
  assert.ok(graph.edges.some(edge => edge.kind === 'typing'));
  const layout = layoutSemanticGraph(graph.nodes,graph.edges);
  assert.equal(layout.nodes.length,graph.nodes.length);assert.ok(layout.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
  const html = renderDocumentViewer({file:{path:'models/example.sysml',content:source},model:semantic});
  assert.match(html,/class="semantic-svg"/);assert.match(html,/«part def»/);assert.match(html,/data-document-element=/);
  assert.match(html,/typing/);assert.doesNotMatch(html,/Manta trace|JSON 追溯/);
});

test('constraints display kernel evaluation results and do not invent satisfaction',() => {
  const semantic = kernel('query'), verification = kernel('verify');
  assert.equal(verification.data.summary.satisfied,1);
  const html = renderDocumentViewer({file:{path:'models/example.sysml',content:source},model:semantic,verification,tab:'constraints'});
  assert.match(html,/framePassed/);assert.match(html,/1 通过/);assert.match(html,/后端静态约束求值/);
  const unevaluated = renderDocumentViewer({file:{path:'models/example.sysml',content:source},model:semantic,tab:'constraints'});
  assert.match(unevaluated,/未求值/);assert.doesNotMatch(unevaluated,/class="document-status satisfied"/);
});

test('invalid models retain source and structured diagnostics without synthesizing a graph',() => {
  const options = {file:{path:'models/broken.sysml',content:'part <img onerror=bad> ;'},model:{valid:false,data:null,findings:[{severity:'error',stage:'parse',line:1,message:'Expected <name>'}]}};
  assert.doesNotMatch(renderDocumentViewer(options),/<svg/);
  const diagnostics = renderDocumentViewer({...options,tab:'diagnostics'});
  assert.match(diagnostics,/Expected &lt;name&gt;/);assert.match(diagnostics,/data-document-source-line="1"/);
  assert.match(renderDocumentViewer({...options,tab:'source'}),/part &lt;img onerror=bad&gt;/);
});

test('viewer accepts file mime and JSON formats while bounding untrusted graph size',async () => {
  assert.equal(documentKind({mime:'text/markdown'}),'markdown');assert.equal(documentKind({path:'m.sysml'}),'sysml');
  assert.match(renderDocumentViewer({file:{name:'manifest.json',content:'{"a":1}'}}),/文件字段/);
  assert.match(renderDocumentViewer({file:{name:'manifest.json',content:'{"a":1}'},tab:'source'}),/data-source-line="3"/);
  const graph = normalizeSemanticGraph({nodes:Array.from({length:1300},(_,i) => ({id:'n' + i,label:'Part ' + i,metaclass:'PartUsage'})),edges:[]});
  assert.equal(graph.nodes.length,1200);assert.equal(graph.truncated,true);
  const vendor = await fs.readFile(path.join(root,'public/vendor/marked/NOTICE.md'),'utf8');assert.match(vendor,/15.0.12/);
});

test('direct raster images use the project asset route and never display base64 as text',() => {
  const file = {path:'plots/attitude.png',type:'image',mime:'image/png',encoding:'base64',content:'UNTRUSTED_BASE64_BYTES'};
  const html = renderDocumentViewer({file,resolveImage:()=>'/api/projects/project/images?path=plots%2Fattitude.png'});
  assert.match(html,/document-raster-image/);assert.match(html,/src="\/api\/projects\/project\/images/);assert.doesNotMatch(html,/UNTRUSTED_BASE64_BYTES/);
  assert.doesNotMatch(renderDocumentViewer({file,resolveImage:()=> 'data:image/svg+xml,bad'}),/<img/);
  const unsupported = renderDocumentViewer({file:{path:'model.bin',previewable:false,encoding:'base64',content:'SECRET_BYTES'}});
  assert.match(unsupported,/暂不支持应用内预览/);assert.doesNotMatch(unsupported,/SECRET_BYTES/);
});

test('an unavailable semantic backend is distinguished from successful checking or model diagnostics',() => {
  const html = renderDocumentViewer({file:{path:'model.sysml',content:'part def X;'},model:{available:false,valid:null,error:'Toolchain unavailable'},tab:'diagnostics'});
  assert.match(html,/语义后端暂不可用/);assert.match(html,/Toolchain unavailable/);assert.doesNotMatch(html,/没有发现错误|校验通过|模型包含需要检查的诊断/);
});
