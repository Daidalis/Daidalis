import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSemanticGraph} from '../public/document-viewer.mjs';
import {scopeModelGraph,openModelNavigation,parentModelNavigation} from '../public/model-navigation.mjs';
import {projectModelStructure} from '../public/model-structure.mjs';

const part=(id,parent,metaclass='PartUsage')=>({id,parent,kind:'block',metaclass,label:id,qname:parent?parent+'::'+id:id,file:'models/parts.sysml',line:12});
const graph={nodes:[
  part('system',null,'PartDefinition'),part('spacecraft','system'),part('ApolloSpacecraft',null,'PartDefinition'),
  part('csm','spacecraft'),part('lm','spacecraft'),part('commandServiceModule','ApolloSpacecraft'),part('lunarModule','ApolloSpacecraft'),
  part('escapeSystem','ApolloSpacecraft'),part('adapter','ApolloSpacecraft'),
  part('CSM107',null,'PartDefinition'),part('CommandServiceModule',null,'PartDefinition'),
  part('commandModule','CommandServiceModule'),part('serviceModule','CommandServiceModule'),
  {...part('docking','ApolloSpacecraft','InterfaceUsage'),label:'cmLMDocking'}
],edges:[
  {source:'spacecraft',target:'ApolloSpacecraft',kind:'typing'},
  {source:'csm',target:'commandServiceModule',kind:'specialization',rel:'redefinition'},
  {source:'lm',target:'lunarModule',kind:'specialization',rel:'redefinition'},
  {source:'csm',target:'CSM107',kind:'typing'},
  {source:'CSM107',target:'CommandServiceModule',kind:'specialization',rel:'subclassification'},
  {id:'docking',source:'commandServiceModule',target:'lunarModule',kind:'interface',interconnection:true,label:'cmLMDocking',file:'models/parts.sysml',line:18}
]};
const members=(scene,parent)=>scene.nodes.filter(node=>scene.structure.visibleIds.has(node.id)&&node.parent===parent&&node.metaclass==='PartUsage');

test('normalization retains explicit redefinition and connection endpoint paths',()=>{
  const normalized=normalizeSemanticGraph({data:{nodes:graph.nodes,edges:[
    ...graph.edges,{id:'path',source:'spacecraft',target:'csm',kind:'interface',interconnection:true,sourcePath:'spacecraft.adapter.port',targetPath:'csm.commandModule.port'}
  ]}},{view:'combined'});
  assert.equal(normalized.edges.find(edge=>edge.source==='csm'&&edge.target==='commandServiceModule').rel,'redefinition');
  assert.equal(normalized.edges.find(edge=>edge.id==='path').sourcePath,'spacecraft.adapter.port');
});

test('a usage has the same effective members when nested and focused, with explicit overrides replacing inherited slots',()=>{
  const navigation={rootId:'system',trail:[],depth:2};
  const scene=projectModelStructure(graph,navigation);
  const nested=members(scene,'spacecraft');
  assert.deepEqual(new Set(nested.map(node=>node.label)),new Set(['csm','lm','escapeSystem','adapter']));
  const next=openModelNavigation(scene,navigation,'spacecraft');
  assert.equal(next.rootId,'spacecraft');
  const focused=projectModelStructure(graph,next);
  assert.deepEqual(new Set(members(focused,'spacecraft').map(node=>node.id)),new Set(nested.map(node=>node.id)));
  const connection=focused.edges.find(edge=>edge.sourceId==='docking');
  assert.equal(connection.source,'csm');
  assert.equal(connection.target,'lm');
  assert.equal(connection.file,'models/parts.sysml');
  assert.equal(connection.line,18);
  assert.equal(parentModelNavigation(focused,next).rootId,'system');
  assert.equal(graph.nodes.length,14);
});

test('intermediate individual definitions contribute deeper nested members without replacing the usage identity',()=>{
  const scene=projectModelStructure(graph,{rootId:'spacecraft',trail:[]});
  assert.deepEqual(new Set(members(scene,'csm').map(node=>node.label)),new Set(['commandModule','serviceModule']));
  const navigation=openModelNavigation(scene,{rootId:'spacecraft',trail:[]},'csm');
  assert.equal(navigation.rootId,'csm');
  assert.deepEqual(new Set(members(projectModelStructure(graph,navigation),'csm').map(node=>node.label)),new Set(['commandModule','serviceModule']));
});

test('two usages of one type get separate member and connection occurrences',()=>{
  const paired={...graph,nodes:[...graph.nodes,part('secondCraft','system')],edges:[...graph.edges,{source:'secondCraft',target:'ApolloSpacecraft',kind:'typing'}]};
  const scene=projectModelStructure(paired,{rootId:'system',trail:[]});
  const first=members(scene,'spacecraft').find(node=>node.label==='escapeSystem');
  const second=members(scene,'secondCraft').find(node=>node.label==='escapeSystem');
  assert.notEqual(first.id,second.id);
  assert.equal(first.sourceId,second.sourceId);
  const links=scene.edges.filter(edge=>edge.sourceId==='docking');
  assert.equal(links.length,2);
  assert.notEqual(links[0].id,links[1].id);
});

test('subsetting is not treated as redefinition',()=>{
  const subset={...graph,edges:graph.edges.map(edge=>edge.source==='csm'&&edge.rel==='redefinition'?{...edge,rel:'subsetting'}:edge)};
  const scene=projectModelStructure(subset,{rootId:'spacecraft',trail:[]});
  assert.ok(members(scene,'spacecraft').some(node=>node.sourceId==='commandServiceModule'));
  assert.ok(members(scene,'spacecraft').some(node=>node.sourceId==='csm'));
});

test('clicking reveals another generation and the top back action restores the previous nested preview',()=>{
  const navigation={rootId:'system',trail:[]},scene=projectModelStructure(graph,navigation);
  assert.equal(members(scene,'csm').length,0);
  const focused=openModelNavigation(scene,navigation,'spacecraft');
  assert.ok(members(projectModelStructure(graph,focused),'csm').some(node=>node.label==='commandModule'));
  const back=parentModelNavigation(projectModelStructure(graph,focused),focused);
  assert.equal(members(projectModelStructure(graph,back),'csm').length,0);
});

test('recursive members stop automatically and repeated focus cannot reset their recursion boundary',()=>{
  const recursive={nodes:[part('MassedComponent',null,'PartDefinition'),part('subcomponents','MassedComponent')],edges:[{source:'subcomponents',target:'MassedComponent',kind:'typing'}]};
  const scene=projectModelStructure(recursive,{rootId:'MassedComponent',trail:[]});
  assert.equal(scene.nodes.find(node=>node.id==='subcomponents').recursive,true);
  const next=openModelNavigation(scene,{rootId:'MassedComponent',trail:[]},'subcomponents');
  const focused=scopeModelGraph(projectModelStructure(recursive,next),next);
  assert.deepEqual(focused.nodes.map(node=>node.id),['subcomponents']);
});

test('projection obeys the visible node budget before recursive materialization',()=>{
  const wide={nodes:[part('wide',null,'PartDefinition'),...Array.from({length:500},(_,index)=>part('member'+index,'wide'))],edges:[]};
  const scene=projectModelStructure(wide,{rootId:'wide',trail:[]});
  assert.ok(scene.structure.visibleIds.size<=200);
  assert.equal(scene.structure.limited,true);
  for(const node of scopeModelGraph(scene,{rootId:'wide'}).nodes)if(node.parent)assert.ok(scene.structure.visibleIds.has(node.parent));
});

test('kernel materialized ports and inherited declaration ports bind as one proven endpoint, not conflicting duplicates',()=>{
  const port=(id,parent,name)=>({...part(id,parent,'PortUsage'),kind:'port',qname:'Device::'+name,file:'device.sysml',line:name==='output'?3:4});
  const fixture={nodes:[part('Pair',null,'PartDefinition'),part('left','Pair'),part('right','Pair'),
    part('Device',null,'PartDefinition'),port('output','Device','output'),port('input','Device','input'),
    port('leftOutput','left','output'),port('rightInput','right','input'),part('wire','Pair','ConnectionUsage')
  ],edges:[
    {source:'left',target:'Device',kind:'typing'},{source:'right',target:'Device',kind:'typing'},
    {id:'wire',source:'leftOutput',target:'rightInput',kind:'connect',interconnection:true,sourcePath:'left.output',targetPath:'right.input'}
  ]};
  const projected=projectModelStructure(fixture,{rootId:'Pair',trail:[]});
  const edge=projected.edges.find(edge=>edge.sourceId==='wire');
  assert.ok(edge);
  assert.equal(projected.structure.unresolved.length,0);
  assert.equal(projected.nodes.find(node=>node.id===edge.source).sourceId,'output');
  assert.equal(projected.nodes.find(node=>node.id===edge.target).sourceId,'input');
});

test('conflicting redefinitions never pick an arbitrary endpoint',()=>{
  const conflict={nodes:[...graph.nodes,part('otherCsm','spacecraft')],edges:[...graph.edges,
    {source:'otherCsm',target:'commandServiceModule',kind:'specialization',rel:'redefinition'}
  ]};
  const scene=projectModelStructure(conflict,{rootId:'spacecraft',trail:[]});
  assert.equal(scene.nodes.find(node=>node.id==='csm').structureConflict,true);
  assert.equal(scene.edges.some(edge=>edge.sourceId==='docking'),false);
  assert.ok(scene.structure.unresolved.some(issue=>issue.sourceId==='docking'));
});
