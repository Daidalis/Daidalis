import test from 'node:test';
import assert from 'node:assert/strict';
import {modelNavigation,openModelNavigation,parentModelNavigation,modelNavigationPath,scopeModelGraph} from '../public/model-navigation.mjs';

const graph={nodes:[
  {id:'package',kind:'package',label:'Mission',file:'models/main.sysml'},
  {id:'system',parent:'package',metaclass:'PartDefinition',label:'System',file:'models/main.sysml'},
  {id:'vehicle',parent:'system',metaclass:'PartUsage',label:'vehicle : Vehicle',file:'models/main.sysml'},
  {id:'types',kind:'package',label:'Components',file:'models/components.sysml'},
  {id:'definition',parent:'types',metaclass:'PartDefinition',label:'Vehicle',file:'models/components.sysml'},
  {id:'engine',parent:'definition',metaclass:'PartUsage',label:'engine',file:'models/components.sysml'}
],edges:[{source:'vehicle',target:'definition',kind:'typing'}],nodeCount:6};

test('click navigation expands a package, system and referenced type and returns through the visited path',()=>{
  const home={depth:1,origin:{mode:'project'}};
  const packageView=openModelNavigation(graph,home,'package');
  assert.equal(packageView.rootId,'package');
  const systemView=openModelNavigation(graph,packageView,'system');
  assert.deepEqual(modelNavigationPath(graph,systemView),['package','system']);
  const vehicleView=openModelNavigation(graph,systemView,'vehicle');
  assert.equal(vehicleView.rootId,'definition');
  assert.deepEqual(modelNavigationPath(graph,vehicleView),['package','system','definition']);
  const back=parentModelNavigation(graph,vehicleView);
  assert.equal(back.rootId,'system');
  assert.equal(parentModelNavigation(graph,parentModelNavigation(graph,back)).rootId,'');
  const engineView=openModelNavigation(graph,vehicleView,'engine');
  assert.equal(engineView.rootId,'engine');
  assert.deepEqual(scopeModelGraph(graph,engineView).nodes.map(node=>node.id),['engine']);
  assert.equal(openModelNavigation(graph,engineView,'engine'),null);
});

test('file package browsing only shows the chosen file and depth adds its children',()=>{
  const navigation={origin:{mode:'file',filePath:'models/main.sysml'},home:'packages',depth:1};
  assert.deepEqual(scopeModelGraph(graph,navigation).nodes.map(node=>node.id),['package']);
  assert.deepEqual(scopeModelGraph(graph,{...navigation,depth:2}).nodes.map(node=>node.id),['package','system']);
  const selected=openModelNavigation(graph,navigation,'package');
  assert.deepEqual(scopeModelGraph(graph,selected).nodes.map(node=>node.id),['package','system']);
});

test('a usage can expand structure inherited through an intermediate individual definition',()=>{
  const inherited={...graph,nodes:[...graph.nodes,{id:'individual',parent:'types',metaclass:'PartDefinition',label:'Vehicle-1'}],edges:[
    {source:'vehicle',target:'individual',kind:'typing'},
    {source:'individual',target:'definition',kind:'specialization'}
  ]};
  const navigation=openModelNavigation(inherited,{rootId:'system',trail:['package'],depth:1},'vehicle');
  assert.equal(navigation?.rootId,'definition');
  assert.equal(parentModelNavigation(inherited,navigation).rootId,'system');
});

const connectedGraph={nodes:[...graph.nodes,
  {id:'receiver',parent:'system',metaclass:'PartUsage',label:'receiver'},
  {id:'output',parent:'vehicle',kind:'port',metaclass:'PortUsage',label:'output'},
  {id:'input',parent:'receiver',kind:'port',metaclass:'PortUsage',label:'input'}
],edges:[...graph.edges,{id:'wire',source:'output',target:'input',kind:'connect',interconnection:true}]};

test('a project opens its unique connected system and includes boundary ports at one level',()=>{
  const home={depth:1,origin:{mode:'project',entryPath:'models/main.sysml'}};
  const scene=scopeModelGraph(connectedGraph,home);
  assert.equal(scene.scope.rootId,'system');
  assert.deepEqual(new Set(scene.nodes.map(node=>node.id)),new Set(['system','vehicle','receiver','output','input']));
  assert.equal(scene.edges.find(edge=>edge.id==='wire')?.source,'output');
  assert.equal(modelNavigation(connectedGraph,home).atHome,true);
  const next=openModelNavigation(connectedGraph,home,'vehicle');
  assert.equal(next.rootId,'definition');
  assert.equal(modelNavigation(connectedGraph,parentModelNavigation(connectedGraph,next)).rootId,'system');
});

test('root selection follows component types across files rather than the entry package or array order',()=>{
  const nested={nodes:[...connectedGraph.nodes,
    {id:'drive',parent:'definition',metaclass:'PartUsage'},
    {id:'wheel',parent:'definition',metaclass:'PartUsage'}
  ],edges:[...connectedGraph.edges,{id:'axle',source:'drive',target:'wheel',kind:'connect',interconnection:true}]};
  const origin={mode:'project',entryPath:'models/empty.sysml'};
  assert.equal(modelNavigation(nested,{origin}).rootId,'system');
  assert.equal(modelNavigation({...nested,nodes:[...nested.nodes].reverse()},{origin}).rootId,'system');
  assert.equal(modelNavigation(nested,{origin:{...origin,mode:'file',filePath:'models/components.sysml'}}).rootId,'types');
  assert.equal(modelNavigation(nested,{origin,home:'packages'}).rootId,'');
});

test('equally valid disconnected systems remain explicit choices instead of choosing an arbitrary root',()=>{
  const ambiguous={nodes:[...connectedGraph.nodes,
    {id:'other',metaclass:'PartDefinition'},
    {id:'first',parent:'other',metaclass:'PartUsage'},
    {id:'second',parent:'other',metaclass:'PartUsage'}
  ],edges:[...connectedGraph.edges,{source:'first',target:'second',kind:'connect',interconnection:true}]};
  assert.equal(modelNavigation(ambiguous,{origin:{mode:'project'}}).rootId,'');
});

test('a component with local refinements still opens its connected type structure',()=>{
  const refined={...connectedGraph,nodes:[...connectedGraph.nodes,
    {id:'refinement',parent:'vehicle',metaclass:'PartUsage'},
    {id:'drive',parent:'definition',metaclass:'PartUsage'}
  ]};
  assert.equal(openModelNavigation(refined,{rootId:'system'},'vehicle').rootId,'definition');
});

const recursiveGraph={nodes:[
  {id:'component',kind:'block',metaclass:'PartDefinition',label:'MassedComponent'},
  {id:'subcomponents',parent:'component',kind:'block',metaclass:'PartUsage',label:'subcomponents : MassedComponent [0..*]'}
],edges:[{source:'subcomponents',target:'component',kind:'typing'}]};

test('the current root does not navigate deeper or increase depth when clicked',()=>{
  const current={rootId:'component',trail:[],depth:1};
  assert.equal(openModelNavigation(recursiveGraph,current,'component'),null);
});

test('a recursive child opens its own single-part view instead of returning to the visible definition',()=>{
  const current={rootId:'component',trail:[],depth:1};
  const child=openModelNavigation(recursiveGraph,current,'subcomponents');
  assert.equal(child.rootId,'subcomponents');
  assert.deepEqual(modelNavigationPath(recursiveGraph,child),['component','subcomponents']);
  assert.deepEqual(scopeModelGraph(recursiveGraph,child).nodes.map(node=>node.id),['subcomponents']);
  assert.equal(openModelNavigation(recursiveGraph,child,'subcomponents'),null);
  assert.equal(parentModelNavigation(recursiveGraph,child).rootId,'component');
});

test('a part with no owned or inherited children can still be entered from its parent',()=>{
  const graph={nodes:[
    {id:'owner',metaclass:'PartDefinition'},
    {id:'leaf',parent:'owner',metaclass:'PartUsage'},
    {id:'emptyType',metaclass:'PartDefinition'}
  ],edges:[{source:'leaf',target:'emptyType',kind:'typing'}]};
  const leaf=openModelNavigation(graph,{rootId:'owner',trail:[]},'leaf');
  assert.equal(leaf.rootId,'leaf');
  assert.equal(openModelNavigation(graph,leaf,'leaf'),null);
});

test('an owning-element link opens that owner and reuses the visited parent path when available',()=>{
  const focused={rootId:'definition',trail:['package','system']};
  const owner=parentModelNavigation(graph,focused,'types');
  assert.equal(owner.rootId,'types');
  assert.deepEqual(owner.trail,[]);
  const back=parentModelNavigation(graph,{rootId:'vehicle',trail:['package','system']},'system');
  assert.equal(back.rootId,'system');
  assert.deepEqual(back.trail,['package']);
});

test('a standalone file starts at its unique package while a complete project retains the connected system entry',()=>{
  const origin={mode:'file',filePath:'models/main.sysml',entryPath:'models/main.sysml',sourceRoot:null,entryKind:'file'};
  assert.equal(modelNavigation(connectedGraph,{origin}).rootId,'package');
  assert.equal(modelNavigation(connectedGraph,{origin:{...origin,mode:'project'}}).rootId,'package');
  assert.equal(modelNavigation(connectedGraph,{origin:{...origin,mode:'project',sourceRoot:'models/mission',entryKind:'convention'}}).rootId,'system');
  assert.equal(modelNavigation(connectedGraph,{origin:{...origin,sourceRoot:'models/mission',entryKind:'convention'}}).rootId,'system');
});

test('a standalone file with multiple root packages keeps the package choice instead of selecting one connected system',()=>{
  const multiple={...connectedGraph,nodes:[...connectedGraph.nodes,{id:'other-package',kind:'package',file:'models/main.sysml',label:'Other'}]};
  const origin={mode:'file',filePath:'models/main.sysml',sourceRoot:null,entryKind:'file'};
  const home=modelNavigation(multiple,{origin});
  assert.equal(home.rootId,'');
  assert.deepEqual(new Set(home.homeNodes.map(node=>node.id)),new Set(['package','other-package']));
});
