import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {renderMarkdown,resolveDocumentLink,documentKind,normalizeSemanticGraph,layoutSemanticGraph,layoutCombinedSemanticGraph,renderDocumentViewer} from '../public/document-viewer.mjs';
import {projectModelStructure} from '../public/model-structure.mjs';
import {modelNavigation,openModelNavigation,parentModelNavigation,scopeModelGraph} from '../public/model-navigation.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = 'package ViewerExample { private import ScalarValues::*; attribute def Quaternion { attribute scalar : Real; } part def Sensor { port sample; } part sensor : Sensor; requirement def CorrectFrame; requirement contract : CorrectFrame; attribute residual : Real = 0.0024; assert constraint framePassed { residual < 0.02 } }';
function kernel(operation, content = source) {
  const result = spawnSync(process.execPath,[path.join(root,'server/model-backend/worker.mjs'),path.join(root,'toolchains/sysml/package')],{input:JSON.stringify({operation,sources:[{name:'models/example.sysml',text:content}]}),encoding:'utf8',maxBuffer:12_000_000});
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
  assert.match(html,/class="semantic-svg"/);assert.match(html,/sensor : Sensor/);assert.match(html,/data-document-element=/);
  assert.doesNotMatch(html,/Manta trace|JSON 追溯/);
  const definitions = renderDocumentViewer({file:{path:'models/example.sysml',content:source},model:semantic,filter:'all'});
  assert.match(definitions,/«part def»/);assert.match(definitions,/typing/);
});

test('kernel supplies structure and interconnection views with distinct usage-port endpoints',async () => {
  const content = await fs.readFile(path.join(root,'tests/fixtures/model-visualization/connected-demo.sysml'),'utf8');
  for (const operation of ['query','validate']) {
    const model = kernel(operation,content), structure = normalizeSemanticGraph(model), graph = normalizeSemanticGraph(model,{view:'interconnection'});
    assert.equal(model.valid,true);
    assert.ok(structure.nodes.some(node => node.metaclass === 'ConnectionUsage'));
    assert.ok(structure.edges.some(edge => edge.kind === 'typing'));
    const byId = new Map(graph.nodes.map(node => [node.id,node]));
    const connections = graph.edges.filter(edge => edge.kind === 'connect');
    assert.equal(connections.length,3);
    assert.deepEqual(connections.map(edge => [
      edge.label,byId.get(byId.get(edge.source).parent).label,byId.get(edge.source).label,
      byId.get(byId.get(edge.target).parent).label,byId.get(edge.target).label
    ]),[
      ['sensorToUart','sensor : Sensor','output : SamplePort','uart : Relay','input : ~SamplePort'],
      ['uartToSoftware','uart : Relay','output : SamplePort','flightSoftware : Relay','input : ~SamplePort'],
      ['softwareToEstimator','flightSoftware : Relay','output : SamplePort','attitudeEstimator : Estimator','input : ~SamplePort']
    ]);
    assert.notEqual(connections[0].target,connections[1].target);
    for (const [index,edge] of connections.entries()) {
      assert.ok(edge.id);
      assert.equal(edge.metaclass,'ConnectionUsage');
      assert.equal(edge.file,'models/example.sysml');
      assert.equal(edge.line,27 + index);
      assert.equal(edge.col,20);
      assert.equal(edge.qname,'VisualizationDemo::signalChain::' + edge.label);
    }
    const html = renderDocumentViewer({file:{path:'models/example.sysml',content},model});
    assert.match(html,/<option value="structure" selected>结构与互连<\/option>/);
    assert.doesNotMatch(html,/<option value="interconnection"/);
    assert.match(html,/semantic-container/);
    assert.equal((html.match(/class="semantic-edge semantic-edge-connect"/g) || []).length,3);
    assert.match(html,/data-document-edge=/);
    assert.match(html,/data-document-element="[^"]+"[^>]*transform="translate[^"]+"[^>]*>[\s\S]*sensor : Sensor/);
    assert.doesNotMatch(html,/marker-end="url\(#document-arrow\)"/);
  }
});

test('edge normalization preserves connection identity and location while escaping model text',() => {
  const edge = {id:'wire" onclick="bad',source:'a',target:'b',kind:'connect',label:'<wire>',metaclass:'ConnectionUsage',qname:'Demo::<wire>',file:'models/wire.sysml',line:7,col:12};
  const data = {nodes:[{id:'a',label:'A',metaclass:'PartUsage'},{id:'b',label:'B',metaclass:'PartUsage'}],edges:[edge]};
  const graph = normalizeSemanticGraph({data});
  for (const key of ['id','source','target','kind','label','metaclass','qname','file','line','col']) assert.equal(graph.edges[0][key],edge[key]);
  const html = renderDocumentViewer({file:{path:'models/wire.sysml'},model:{data}});
  assert.match(html,/wire&quot; onclick=&quot;bad/);
  assert.match(html,/&lt;wire&gt;/);
  assert.doesNotMatch(html,/<wire>|id="wire" onclick="bad/);
});

test('relationship markers distinguish connection, flow, composition and typing without invented directions',() => {
  const nodes = [{id:'a',label:'A',metaclass:'PartUsage'},{id:'b',label:'B',metaclass:'PartUsage'}];
  const render = edges => renderDocumentViewer({file:{path:'model.sysml'},model:{nodes,edges},filter:'all'});
  for (const [kind,sourceId,targetId] of [['connect','a','b'],['connect','b','a'],['membership','a','b'],['unknown','a','b']]) {
    const html = render([{source:sourceId,target:targetId,kind}]);
    assert.doesNotMatch(html,/marker-end=|marker-start=/);
    assert.doesNotMatch(html,/A — connect → B|B — connect → A/);
  }
  assert.match(render([{source:'a',target:'b',kind:'flow'}]),/marker-end="url\(#document-arrow\)"/);
  assert.match(render([{source:'a',target:'b',kind:'composition'}]),/marker-start="url\(#document-composition\)"/);
  assert.match(render([{source:'a',target:'b',kind:'typing'}]),/marker-end="url\(#document-typing\)"/);
});

test('reversing connect spelling preserves undirected rendering and owner-port placement',async () => {
  const content = await fs.readFile(path.join(root,'tests/fixtures/model-visualization/connected-demo.sysml'),'utf8');
  const reversed = content.replace('sensor.output to uart.input','uart.input to sensor.output');
  const models = [kernel('query',content),kernel('query',reversed)];
  const placements = models.map(model => {
    const html = renderDocumentViewer({file:{path:'models/example.sysml'},model});
    assert.equal((html.match(/class="semantic-edge semantic-edge-connect"/g) || []).length,3);
    assert.doesNotMatch(html,/marker-end=|marker-start=/);
    return [...html.matchAll(/data-document-element="([^"]+)" transform="([^"]+)"/g)].map(match => match.slice(1));
  });
  assert.deepEqual(placements[0],placements[1]);
});

test('real flow direction and source metadata survive normalization and rendering',async () => {
  const content = await fs.readFile(path.join(root,'tests/fixtures/model-visualization/connected-demo.sysml'),'utf8');
  for (const [start,end] of [['sensor.output','uart.input'],['uart.input','sensor.output']]) {
    const model = kernel('query',content.replace('connection sensorToUart connect sensor.output to uart.input;',`flow samples from ${start} to ${end};`));
    assert.equal(model.valid,true);
    const graph = normalizeSemanticGraph(model,{view:'interconnection'}), flow = graph.edges.find(edge => edge.kind === 'flow');
    const byId = new Map(graph.nodes.map(node => [node.id,node]));
    assert.equal(flow.directed,true);
    assert.equal(flow.metaclass,'FlowUsage');
    assert.equal(flow.label,'samples');
    assert.equal(flow.line,27);
    assert.match(byId.get(byId.get(flow.source).parent).label,new RegExp('^' + start.split('.')[0] + ' :'));
    assert.match(byId.get(byId.get(flow.target).parent).label,new RegExp('^' + end.split('.')[0] + ' :'));
    const html = renderDocumentViewer({file:{path:'models/example.sysml'},model});
    assert.equal((html.match(/marker-end="url\(#document-arrow\)"/g) || []).length,1);
    assert.equal((html.match(/class="semantic-edge semantic-edge-connect"/g) || []).length,2);
  }
});

test('combined normalization merges kernel identities without losing tree members or connection metadata',async () => {
  const content = await fs.readFile(path.join(root,'tests/fixtures/model-visualization/connected-demo.sysml'),'utf8');
  const model = kernel('query',content), tree = normalizeSemanticGraph(model), graph = normalizeSemanticGraph(model,{view:'combined'});
  assert.equal(new Set(graph.nodes.map(node => node.id)).size,graph.nodes.length);
  assert.equal(graph.edges.filter(edge => edge.kind === 'connect').length,3);
  for (const node of tree.nodes) assert.deepEqual(graph.nodes.find(item => item.id === node.id).rows,node.rows);
  for (const node of model.data.interconnection.nodes) if (node.parent) assert.equal(graph.nodes.find(item => item.id === node.id).parent,node.parent);
  const html = renderDocumentViewer({file:{path:'models/example.sysml'},model});
  const connection = tree.nodes.find(node => node.label === 'sensorToUart');
  assert.doesNotMatch(html,new RegExp('data-document-element="' + connection.id + '"'));
  assert.match(html,new RegExp('data-document-edge="' + connection.id + '"'));
});

test('combined layout nests multi-level parts and places distinct port IDs on owner boundaries',() => {
  const nodes = [
    {id:'system',label:'system',kind:'block',parent:null},
    {id:'subsystem',label:'subsystem',kind:'block',parent:'system'},
    {id:'sender',label:'sender : Relay',kind:'block',parent:'subsystem'},
    {id:'receiver',label:'receiver : Relay',kind:'block',parent:'system'},
    {id:'out',label:'output',kind:'port',parent:'sender'},
    {id:'in',label:'input',kind:'port',parent:'receiver'}
  ];
  const edges = [{id:'wire',source:'out',target:'in',kind:'connect'}];
  const layout = layoutCombinedSemanticGraph(nodes,edges), byId = new Map(layout.nodes.map(node => [node.id,node]));
  assert.equal(layout.nodes.length,nodes.length);
  for (const id of ['subsystem','sender','receiver']) {
    const node = byId.get(id), parent = byId.get(node.parent);
    assert.ok(node.x > parent.x && node.y > parent.y);
    assert.ok(node.x + node.width < parent.x + parent.width);
    assert.ok(node.y + node.height < parent.y + parent.height);
  }
  for (const id of ['out','in']) {
    const port = byId.get(id), parent = byId.get(port.parent), center = port.x + port.width / 2;
    assert.ok(center === parent.x || center === parent.x + parent.width);
    assert.ok(port.y > parent.y && port.y + port.height < parent.y + parent.height);
  }
  const reversed = layoutCombinedSemanticGraph(nodes,[{...edges[0],source:'in',target:'out'}]);
  assert.deepEqual(reversed.nodes,layout.nodes);
});

test('combined view remains useful for definitions-only models and never fabricates connections',() => {
  const model = kernel('query','package DefinitionsOnly { port def Signal; part def Device { port input : Signal; } }');
  const html = renderDocumentViewer({file:{path:'models/definitions.sysml'},model});
  assert.match(html,/«part def»/);assert.match(html,/Device/);assert.match(html,/input : Signal/);
  assert.doesNotMatch(html,/class="semantic-edge semantic-edge-connect"/);
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

test('an unresolved draft remains drawable but the main diagram warns that it is only a partial result',() => {
  const content = 'package Draft {\n    part sensor : MissingSensor;\n}', model = kernel('query',content);
  assert.equal(model.valid,false);
  assert.ok(model.findings.some(item => item.stage === 'referential'));
  assert.ok(normalizeSemanticGraph(model,{view:'combined'}).nodes.length > 0);
  for (const filter of ['structure','requirements','all']) {
    const html = renderDocumentViewer({file:{path:'models/draft.sysml',content},model,filter});
    assert.match(html,/部分结果/);
    assert.match(html,/未通过语义校验/);
    assert.match(html,/data-document-tab="diagnostics"[^>]*>查看诊断/);
    if (filter !== 'requirements') assert.match(html,/class="semantic-svg"/);
  }
  const diagnostics = renderDocumentViewer({file:{path:'models/draft.sysml',content},model,tab:'diagnostics'});
  assert.match(diagnostics,/MissingSensor/);
  assert.match(diagnostics,/data-document-source-line="2"/);
});

test('diagram and diagnostics distinguish checked, unchecked and unavailable semantic results',() => {
  const file = {path:'models/status.sysml',content:'part sensor;'}, data = {nodes:[{id:'sensor',metaclass:'PartUsage',label:'sensor'}],edges:[]};
  const checked = renderDocumentViewer({file,model:{valid:true,findings:[],data}});
  assert.doesNotMatch(checked,/部分结果|尚未取得语义校验结果|语义后端暂不可用/);
  for (const model of [undefined,{valid:null,findings:[]},{data}]) {
    const diagram = renderDocumentViewer({file,model}), diagnostics = renderDocumentViewer({file,model,tab:'diagnostics'});
    assert.match(diagram,/尚未取得语义校验结果/);
    assert.match(diagnostics,/尚未取得语义校验结果/);
    assert.doesNotMatch(diagnostics,/没有发现错误|校验通过|模型包含需要检查的诊断/);
  }
  for (const model of [{available:false,valid:null,error:'Toolchain unavailable'},{backend:{available:false},data},{error:'Query failed',valid:false,data}]) {
    const diagram = renderDocumentViewer({file,model});
    assert.match(diagram,/语义后端暂不可用/);
    assert.doesNotMatch(diagram,/部分结果|未通过语义校验/);
  }
  const empty = renderDocumentViewer({file,model:{valid:true,data:null}});
  assert.doesNotMatch(empty,/<svg|部分结果|语义后端暂不可用|尚未取得语义校验结果/);
});

test('normalization retains all relationships and only the diagram applies its rendering budget',() => {
  const nodes = [{id:'sender',metaclass:'PartUsage',label:'sender'},{id:'receiver',metaclass:'PartUsage',label:'receiver'}];
  for (const edgeCount of [4801,4800]) {
    const edges = Array.from({length:edgeCount},(_,index) => ({id:'wire-' + index,source:'sender',target:'receiver',kind:'connect'}));
    const data = {nodes,edges,interconnection:{nodes,edges}};
    for (const view of ['structure','interconnection','combined']) {
      const graph = normalizeSemanticGraph({data},{view});
      assert.equal(graph.edges.length,edgeCount);
      assert.equal(graph.truncated,false,view);
      assert.equal(graph.nodeCount,2);
      assert.equal(graph.edgeCount,edgeCount);
    }
    for (const filter of ['structure','all']) {
      const html = renderDocumentViewer({file:{path:'models/large.sysml'},model:{valid:true,data},filter});
      assert.match(html,/当前图/);
      assert.ok((html.match(/class="semantic-edge semantic-edge-connect"/g)||[]).length<=800);
      assert.doesNotMatch(html,/图数据已截断/);
    }
  }
});

test('a late system root remains searchable and can be rendered without the unrelated earlier nodes',() => {
  const nodes = [
    ...Array.from({length:1201},(_,index) => ({id:'part-' + index,metaclass:'PartUsage',label:'Part ' + index})),
    {id:'system',kind:'block',nodeKind:'def',metaclass:'PartDefinition',label:'MissionSystem',qname:'Mission::MissionSystem'},
    {id:'launcher',parent:'system',metaclass:'PartUsage',label:'launchVehicle'},
    {id:'craft',parent:'system',metaclass:'PartUsage',label:'spacecraft'},
    {id:'module',parent:'craft',metaclass:'PartUsage',label:'commandModule'}
  ];
  for (const edgeCount of [0,4801]) {
    const edges = Array.from({length:edgeCount},(_,index) => ({id:'wire-' + index,source:'part-0',target:'part-1',kind:'connect'}));
    const model = {valid:true,data:{nodes,edges}}, graph = normalizeSemanticGraph(model,{view:'combined'});
    assert.equal(graph.nodes.length,1205);
    assert.equal(graph.truncated,false);
    assert.equal(graph.nodeCount,1205);
    assert.equal(graph.edgeCount,edgeCount);
    const html = renderDocumentViewer({file:{path:'models/large.sysml'},model,navigation:{rootId:'system'}});
    assert.match(html,/data-document-element="system"/);
    assert.match(html,/data-document-element="launcher"/);
    assert.match(html,/data-document-element="craft"/);
    assert.doesNotMatch(html,/data-document-element="part-0"/);
    assert.match(html,/data-document-element="module"/);
    const expanded=renderDocumentViewer({file:{path:'models/large.sysml'},model,navigation:{rootId:'craft',trail:['system']}});
    assert.match(expanded,/data-document-element="module"/);
    const outline=renderDocumentViewer({file:{path:'models/large.sysml'},model,tab:'outline',navigation:{query:'MissionSystem'}});
    assert.match(outline,/data-document-element="system"/);
  }
});

test('viewer accepts file mime and JSON formats while bounding untrusted graph size',async () => {
  assert.equal(documentKind({mime:'text/markdown'}),'markdown');assert.equal(documentKind({path:'m.sysml'}),'sysml');
  assert.match(renderDocumentViewer({file:{name:'manifest.json',content:'{"a":1}'}}),/文件字段/);
  assert.match(renderDocumentViewer({file:{name:'manifest.json',content:'{"a":1}'},tab:'source'}),/data-source-line="3"/);
  const graph = normalizeSemanticGraph({nodes:Array.from({length:1300},(_,i) => ({id:'n' + i,label:'Part ' + i,metaclass:'PartUsage'})),edges:[]});
  assert.equal(graph.nodes.length,1300);assert.equal(graph.truncated,false);
  const vendor = await fs.readFile(path.join(root,'public/vendor/marked/NOTICE.md'),'utf8');assert.match(vendor,/15.0.12/);
});

test('multi-file diagnostics retain their source path rather than using the entry file line numbers',()=>{
  const model={valid:false,findings:[{severity:'error',stage:'referential',unit:'models/mission/parts.sysml',line:7,message:'Missing type'}]};
  const html=renderDocumentViewer({file:{path:'models/mission/root.sysml'},model,tab:'diagnostics'});
  assert.match(html,/data-document-source-path="models\/mission\/parts.sysml"/);
  assert.match(html,/data-document-source-line="7"/);
});

test('a package overview is a clickable diagram without scope filters or a successful-check banner',()=>{
  const file={path:'models/mission/MissionModel.sysml'};
  const model={valid:true,findings:[{severity:'warning',stage:'semantic',message:'Keep this warning'}],data:{nodes:[
    {id:'entry',kind:'package',label:'MissionModel',file:file.path},
    {id:'systems',kind:'package',label:'Systems',file:'models/mission/system.sysml'},
    {id:'system',parent:'systems',nodeKind:'def',metaclass:'PartDefinition',label:'System',file:'models/mission/system.sysml'}
  ],edges:[]}};
  const modelContext={mode:'project',name:'Mission',sourceRoot:'models/mission',entryPath:file.path,entryKind:'convention'};
  const html=renderDocumentViewer({file,model,modelContext});
  assert.match(html,/class="semantic-svg"/);
  assert.match(html,/data-document-element="systems"/);
  assert.doesNotMatch(html,/class="model-package-grid"/);
  assert.match(html,/data-document-up/);
  assert.doesNotMatch(html,/data-document-depth|显示层级|展开一层|收起一层/);
  assert.doesNotMatch(html,/data-document-source-root|data-document-navigation|document-model-notices|语义校验通过，保留/);
  assert.match(html,/data-document-tab="diagnostics"[^>]*>诊断 <span>1<\/span>/);
  const fileView=renderDocumentViewer({file:{path:'models/mission/system.sysml'},model,modelContext:{...modelContext,mode:'file'}});
  assert.match(fileView,/data-document-element="systems"/);
  assert.doesNotMatch(fileView,/data-document-element="entry"/);
});

test('file browsing never assigns unlocated generated elements from other units to the selected file',()=>{
  const file={path:'models/mission/system.sysml'};
  const model={valid:true,model:{sourceSet:{files:[{path:file.path},{path:'models/mission/other.sysml'}]}},data:{nodes:[
    {id:'systems',kind:'package',label:'Systems',file:file.path},
    {id:'generated',kind:'node',metaclass:'PortUsage',label:'(port)'}
  ],edges:[]}};
  const graph=normalizeSemanticGraph(model,{path:file.path,view:'combined'});
  assert.equal(graph.nodes.find(node=>node.id==='generated').file,'');
  const html=renderDocumentViewer({file,model,modelContext:{mode:'file',name:'Mission',sourceRoot:'models/mission',entryPath:'models/mission/main.sysml'}});
  assert.match(html,/data-document-element="systems"/);
  assert.doesNotMatch(html,/data-document-element="generated"/);
});

test('the project entry displays a system boundary, its components and their connection immediately',()=>{
  const file={path:'models/mission/main.sysml'};
  const model={valid:true,data:{nodes:[
    {id:'package',kind:'package',label:'Mission',file:file.path},
    {id:'system',parent:'package',kind:'block',metaclass:'PartDefinition',label:'MissionSystem'},
    {id:'sender',parent:'system',kind:'block',metaclass:'PartUsage',label:'sender'},
    {id:'receiver',parent:'system',kind:'block',metaclass:'PartUsage',label:'receiver'},
    {id:'output',parent:'sender',kind:'port',metaclass:'PortUsage',label:'output'},
    {id:'input',parent:'receiver',kind:'port',metaclass:'PortUsage',label:'input'}
  ],edges:[{id:'wire',source:'output',target:'input',kind:'connect',interconnection:true}]}};
  const html=renderDocumentViewer({file,model,modelContext:{mode:'project',entryPath:file.path}});
  assert.match(html,/semantic-container[^>]*data-document-element="system"/);
  assert.match(html,/data-document-element="sender"/);
  assert.match(html,/data-document-element="receiver"/);
  assert.match(html,/data-document-edge="[^"]*wire"/);
  assert.doesNotMatch(html,/data-document-toggle|收起内部|展开内部|data-document-depth/);
  assert.match(html,/data-document-packages/);
  assert.doesNotMatch(html,/model-package-card/);
});

test('navigation arrows match the available next scene and disappear on the current root',()=>{
  const model={valid:true,data:{nodes:[
    {id:'component',kind:'block',metaclass:'PartDefinition',label:'MassedComponent'},
    {id:'subcomponents',parent:'component',kind:'block',metaclass:'PartUsage',label:'subcomponents : MassedComponent [0..*]'}
  ],edges:[{source:'subcomponents',target:'component',kind:'typing'}]}};
  const render=rootId=>renderDocumentViewer({file:{path:'component.sysml'},model,navigation:{rootId,trail:[],depth:1}});
  const parent=render('component');
  const card=id=>parent.match(new RegExp(`<g\\b[^>]*data-document-element="${id}"[^>]*>([\\s\\S]*?)<\\/g>`))?.[1]||'';
  assert.doesNotMatch(card('component'),/class="semantic-expand"/);
  assert.match(card('subcomponents'),/class="semantic-expand"/);
  const child=render('subcomponents');
  assert.match(child,/data-document-element="subcomponents"/);
  assert.doesNotMatch(child,/class="semantic-expand"|data-document-depth/);
});

test('diagram metadata appears once in the top summary without either bottom information bar',()=>{
  const file={path:'models/main.sysml'},hash='a'.repeat(64);
  const model={valid:true,backend:{version:'0.10.10'},model:{sourceSet:{root:'models',sha256:hash,files:[{path:file.path},{path:'models/parts.sysml'}]}},
    data:{nodes:[{id:'system',kind:'block',metaclass:'PartDefinition',label:'System'}],edges:[]}};
  const html=renderDocumentViewer({file,model});
  const summary=html.match(/<div class="model-view-summary"[^>]*>([\s\S]*?)<\/div>/)?.[1]||'';
  assert.match(summary,/当前图 1 \/ 1 个元素 · 0 \/ 0 条关系/);
  assert.match(summary,/SysML v2 · 0\.10\.10/);
  assert.match(summary,/1 个语义元素 · 2 个源文件/);
  assert.match(summary,/源集合 SHA aaaaaaaaaaaa/);
  assert.match(summary,new RegExp(`title="${hash}"`));
  assert.doesNotMatch(html,/semantic-legend|<footer class="document-model-meta"/);
  assert.equal((html.match(/SysML v2 · 0\.10\.10/g)||[]).length,1);
  const source=renderDocumentViewer({file,model,tab:'source'});
  assert.match(source,/<footer class="document-model-meta"/);
  assert.doesNotMatch(source,/model-view-summary/);
});

test('empty diagrams keep their model metadata in the top summary',()=>{
  const html=renderDocumentViewer({file:{path:'empty.sysml'},model:{valid:true,backend:{version:'0.10.10'},data:{nodes:[],edges:[]}}});
  assert.match(html,/当前图 0 \/ 0 个元素 · 0 \/ 0 条关系/);
  assert.match(html,/model-summary-meta[\s\S]*SysML v2 · 0\.10\.10/);
  assert.doesNotMatch(html,/semantic-legend|<footer class="document-model-meta"/);
});

test('a standalone real single-package model shows the package contents, two part generations and all three connections',async()=>{
  const content=await fs.readFile(path.join(root,'tests/fixtures/model-visualization/connected-demo.sysml'),'utf8');
  const model=kernel('query',content),file={path:'models/example.sysml',content};
  assert.equal(model.valid,true);
  const graph=normalizeSemanticGraph(model,{path:file.path,view:'combined'});
  const modelContext={mode:'file',sourceRoot:null,entryKind:'file',entryPath:file.path,name:'connected-demo'};
  const navigation={origin:{...modelContext,filePath:file.path}};
  const scene=projectModelStructure(graph,navigation),visible=scopeModelGraph(scene,navigation);
  const expected=['VisualizationDemo','VisualizationDemo::Sensor','VisualizationDemo::Relay','VisualizationDemo::Estimator',
    'VisualizationDemo::signalChain','VisualizationDemo::signalChain::sensor','VisualizationDemo::signalChain::uart',
    'VisualizationDemo::signalChain::flightSoftware','VisualizationDemo::signalChain::attitudeEstimator'];
  for(const qname of expected)assert.ok(visible.nodes.some(node=>node.qname===qname),'Missing '+qname);
  assert.equal(modelNavigation(scene,navigation).byId.get(modelNavigation(scene,navigation).rootId).qname,'VisualizationDemo');
  assert.deepEqual(visible.edges.filter(edge=>edge.interconnection).map(edge=>edge.label).sort(),['sensorToUart','softwareToEstimator','uartToSoftware']);
  assert.equal(visible.nodes.filter(node=>node.kind==='port').length,6);
  const html=renderDocumentViewer({file,model,modelContext});
  assert.match(html,/aria-label="package VisualizationDemo"/);
  assert.equal((html.match(/class="semantic-edge semantic-edge-connect"/g)||[]).length,3);
  assert.doesNotMatch(html,/未完整定位|达到当前画布预算/);
  const chain=graph.nodes.find(node=>node.qname==='VisualizationDemo::signalChain');
  const focused=openModelNavigation(scene,navigation,chain.id);
  assert.equal(focused.rootId,chain.id);
  assert.equal(parentModelNavigation(projectModelStructure(graph,focused),focused).rootId,modelNavigation(scene,navigation).rootId);
});

test('package layout puts connected assemblies before type definitions and preserves the internal signal-chain order',()=>{
  const nodes=[
    {id:'pkg',kind:'package',label:'Package'},
    {id:'Sensor',parent:'pkg',kind:'block',metaclass:'PartDefinition',label:'Sensor'},
    {id:'Relay',parent:'pkg',kind:'block',metaclass:'PartDefinition',label:'Relay'},
    {id:'Estimator',parent:'pkg',kind:'block',metaclass:'PartDefinition',label:'Estimator'},
    {id:'chain',parent:'pkg',kind:'block',metaclass:'PartUsage',label:'signalChain'},
    {id:'sensor',parent:'chain',kind:'block',metaclass:'PartUsage',label:'sensor'},
    {id:'uart',parent:'chain',kind:'block',metaclass:'PartUsage',label:'uart'},
    {id:'software',parent:'chain',kind:'block',metaclass:'PartUsage',label:'software'},
    {id:'estimator',parent:'chain',kind:'block',metaclass:'PartUsage',label:'estimator'}
  ];
  const edges=[{source:'sensor',target:'uart',kind:'connect'},{source:'uart',target:'software',kind:'connect'},{source:'software',target:'estimator',kind:'connect'}];
  const result=layoutCombinedSemanticGraph(nodes,edges),byId=new Map(result.nodes.map(node=>[node.id,node]));
  for(const id of ['Sensor','Relay','Estimator'])assert.ok(byId.get(id).y>byId.get('chain').y+byId.get('chain').height);
  assert.ok(byId.get('sensor').x<byId.get('uart').x&&byId.get('uart').x<byId.get('software').x&&byId.get('software').x<byId.get('estimator').x);
  for(const node of result.nodes.filter(node=>node.parent==='pkg'))assert.ok(node.x+node.width<=byId.get('pkg').x+byId.get('pkg').width);
});

test('scoped interfaces show their actual endpoints without orphan descriptor ports',()=>{
  const nodes=[
    {id:'system',metaclass:'PartDefinition',nodeKind:'def',qname:'Mission::System',label:'System'},
    {id:'sender',parent:'system',metaclass:'PartUsage',label:'sender'},
    {id:'receiver',parent:'system',metaclass:'PartUsage',label:'receiver'},
    {id:'link',parent:'system',metaclass:'InterfaceUsage',label:'link'},
    {id:'end-a',parent:'link',metaclass:'PortUsage',label:'(port)'},
    {id:'end-b',parent:'link',metaclass:'PortUsage',label:'(port)'}
  ];
  const edges=[{id:'link',source:'sender',target:'receiver',kind:'connect'}];
  const html=renderDocumentViewer({file:{path:'mission.sysml'},model:{valid:true,data:{nodes,edges}},navigation:{rootId:'system',depth:2}});
  assert.match(html,/data-document-edge="[^"]*link"/);
  assert.doesNotMatch(html,/data-document-element="end-a"|data-document-element="end-b"/);
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
