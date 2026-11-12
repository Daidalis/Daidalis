export const MODEL_VIEW_BUDGET={nodes:200,edges:800};

export function modelHierarchy(graph){
  const byId=new Map(graph.nodes.map(node=>[node.id,node]));
  const byName=new Map(graph.nodes.filter(node=>node.qname).map(node=>[node.qname,node]));
  const parent=new Map(),children=new Map();
  for(const node of graph.nodes){
    const explicit=byId.get(node.parent),named=byName.get(node.qname?.split('::').slice(0,-1).join('::'));
    const owner=explicit&&explicit.kind!=='package'?explicit.id:named?.id||explicit?.id;
    if(owner&&owner!==node.id&&byId.has(owner)){
      parent.set(node.id,owner);
      if(!children.has(owner))children.set(owner,[]);
      children.get(owner).push(node.id);
    }
  }
  const bases=new Map();
  for(const edge of graph.edges)if(['typing','specialization'].includes(edge.kind)){
    if(!bases.has(edge.source))bases.set(edge.source,[]);
    bases.get(edge.source).push(edge.target);
  }
  for(const [owner,nested] of graph.structure?.children||[])children.set(owner,nested);
  return {byId,parent,children,bases};
}

const modelInterconnection=edge=>edge.kind!=='note'&&(edge.interconnection||['connect','flow','interface'].includes(edge.kind));

function modelAncestors(parent,id){
  const result=[],seen=new Set();
  while(id&&!seen.has(id)){seen.add(id);result.push(id);id=parent.get(id);}
  return result;
}

function connectedModelOwners(graph,parent){
  const connected=new Set();
  for(const edge of graph.edges){
    if(!modelInterconnection(edge))continue;
    const target=new Set(modelAncestors(parent,edge.target));
    const owner=modelAncestors(parent,edge.source).find(id=>target.has(id));
    if(owner)connected.add(owner);
  }
  return connected;
}

function referencedModelStructure(hierarchy,id){
  const {children,bases}=hierarchy;
  const queue=[...(children.get(id)||[])],seen=new Set([id]),nested=new Set();
  for(let index=0;index<queue.length;index++){
    const current=queue[index];
    if(seen.has(current))continue;
    seen.add(current);nested.add(current);
    queue.push(...(children.get(current)||[]),...(bases.get(current)||[]));
  }
  return nested;
}

function modelSystemRoot(graph,hierarchy,origin){
  if(!origin)return '';
  const {byId,parent,children}=hierarchy;
  const composites=graph.nodes.filter(node=>/^(PartDefinition|PartUsage)$/.test(node.metaclass||'')&&
    (origin.mode!=='file'||node.file===origin.filePath)&&
    (children.get(node.id)||[]).some(id=>byId.get(id)?.metaclass==='PartUsage'));
  const connected=connectedModelOwners(graph,parent);
  const candidates=composites.filter(node=>connected.has(node.id));
  const nested=new Set(candidates.flatMap(node=>[...referencedModelStructure(hierarchy,node.id)]));
  const roots=candidates.filter(node=>!nested.has(node.id));
  if(roots.length===1)return roots[0].id;
  const entryPath=origin.filePath||origin.entryPath;
  const entry=entryPath?(roots.length?roots:composites).filter(node=>node.file===entryPath):[];
  return entry.length===1?entry[0].id:'';
}

function modelHomeRoot(graph,hierarchy,origin){
  if(origin&&!origin.sourceRoot&&(origin.mode==='file'||origin.entryKind==='file')){
    const filePath=origin.filePath||origin.entryPath;
    const packages=graph.nodes.filter(node=>node.kind==='package'&&node.file===filePath);
    const ids=new Set(packages.map(node=>node.id));
    const roots=packages.filter(node=>!ids.has(hierarchy.parent.get(node.id)));
    if(roots.length)return roots.length===1?roots[0].id:'';
  }
  return modelSystemRoot(graph,hierarchy,origin);
}

export function modelNavigation(graph,navigation={}){
  const hierarchy=modelHierarchy(graph),{byId,children}=hierarchy;
  const packages=graph.nodes.filter(node=>node.kind==='package');
  const homeRootId=navigation.home==='packages'?'':graph.structure?.homeRootId??modelHomeRoot(graph,hierarchy,navigation.origin);
  const rootId=byId.has(navigation.rootId)?navigation.rootId:homeRootId;
  const depth=Number.isInteger(Number(navigation.depth))&&Number(navigation.depth)>=1&&Number(navigation.depth)<=12?Number(navigation.depth):navigation.origin?1:2;
  const query=String(navigation.query||'').toLocaleLowerCase();
  const eligible=graph.nodes.filter(node=>node.kind!=='note'&&(!navigation.origin||navigation.origin.mode!=='file'||node.file===navigation.origin.filePath));
  const eligibleIds=new Set(eligible.map(node=>node.id));
  const homeNodes=eligible.filter(node=>!eligibleIds.has(hierarchy.parent.get(node.id)));
  const overview=!rootId&&(Boolean(navigation.origin)||graph.nodes.length>MODEL_VIEW_BUDGET.nodes);
  return {...hierarchy,packages,rootId,homeRootId,atHome:rootId===homeRootId,depth,query,overview,children,homeNodes,origin:navigation.origin};
}

export function modelNavigationPath(graph,navigation={},state=modelNavigation(graph,navigation)){
  if(Array.isArray(navigation.trail))return [...navigation.trail,state.rootId].filter(id=>state.byId.has(id));
  if(state.homeRootId&&state.atHome)return [state.rootId];
  const result=[],seen=new Set();
  let current=state.rootId;
  while(current&&!seen.has(current)){
    const node=state.byId.get(current);
    if(state.origin?.mode==='file'&&node?.file!==state.origin.filePath)break;
    seen.add(current);result.unshift(current);current=state.parent.get(current);
  }
  return result;
}

export function modelExpansionTarget(graph,id,hierarchy=modelHierarchy(graph)){
  const {byId,children,bases}=hierarchy,node=byId.get(id);
  if(!node)return null;
  const hasChildren=target=>(children.get(target)||[]).some(child=>byId.get(child).kind!=='note');
  if(node.kind==='package'||node.metaclass!=='PartUsage'&&hasChildren(id))return id;
  if(!/Part|Item|Action|State/.test(node.metaclass||''))return null;
  const queue=[id],seen=new Set(queue);
  for(let index=0;index<queue.length;index++){
    for(const target of bases.get(queue[index])||[]){
      if(seen.has(target))continue;
      seen.add(target);
      if(hasChildren(target))return target;
      queue.push(target);
    }
  }
  return hasChildren(id)?id:null;
}

export function openModelNavigation(graph,navigation,id,current=modelNavigation(graph,navigation)){
  const node=current.byId.get(id);
  if(!node||id===current.rootId)return null;
  if(graph.structure&&/Part|Item|Action|State/.test(node.metaclass||'')){
    return {...navigation,rootId:id,trail:modelNavigationPath(graph,navigation,current),depth:2,page:0};
  }
  const target=modelExpansionTarget(graph,id,current);
  if(!target&&!/Part|Item|Action|State/.test(node.metaclass||''))return null;
  const trail=modelNavigationPath(graph,navigation,current);
  const rootId=target&&!trail.includes(target)?target:id;
  return {...navigation,rootId,trail,depth:1,page:0};
}

export function parentModelNavigation(graph,navigation={},ownerId){
  const trail=modelNavigationPath(graph,navigation);
  if(ownerId&&modelHierarchy(graph).byId.has(ownerId)){
    const position=trail.lastIndexOf(ownerId);
    const parentPath=position>=0?trail.slice(0,position):modelNavigationPath(graph,{...navigation,rootId:ownerId,trail:undefined}).slice(0,-1);
    return {...navigation,rootId:ownerId,trail:parentPath,page:0};
  }
  trail.pop();
  const rootId=trail.at(-1)||'';
  return {...navigation,rootId,trail:rootId?trail.slice(0,-1):undefined,depth:!rootId&&navigation.origin?1:navigation.depth,page:0};
}

export function scopeModelGraph(graph,navigation={}){
  const state=modelNavigation(graph,navigation),{rootId,depth,children,parent}=state;
  if(graph.structure){
    const ids=graph.structure.visibleIds;
    return {...graph,nodes:graph.nodes.filter(node=>ids.has(node.id)),edges:graph.edges.filter(edge=>ids.has(edge.source)&&ids.has(edge.target)),scope:state};
  }
  let nodes=graph.nodes;
  if(state.overview&&depth===1)nodes=state.homeNodes;
  else if(rootId||state.overview){
    const roots=rootId?[rootId]:state.homeNodes.map(node=>node.id);
    const distance=new Map(roots.map(id=>[id,rootId?0:1])),queue=[...roots];
    for(let index=0;index<queue.length;index++){
      const id=queue[index],level=distance.get(id);
      if(level>=depth)continue;
      for(const child of children.get(id)||[])if(!distance.has(child)){distance.set(child,level+1);queue.push(child);}
    }
    nodes=nodes.filter(node=>distance.has(node.id));
  }
  const ids=new Set(nodes.map(node=>node.id));
  if(rootId){
    const visibleOwner=id=>{
      return modelAncestors(parent,id).find(owner=>ids.has(owner));
    };
    for(const edge of graph.edges){
      if(!modelInterconnection(edge))continue;
      const source=visibleOwner(edge.source),target=visibleOwner(edge.target);
      if(!source||!target||source===target)continue;
      for(const id of [edge.source,edge.target]){
        const endpoint=state.byId.get(id);
        if(endpoint?.kind==='port'&&ids.has(parent.get(id)))ids.add(id);
      }
    }
    nodes=graph.nodes.filter(node=>ids.has(node.id));
  }
  return {...graph,nodes:nodes.map(node=>({...node,parent:parent.get(node.id)||node.parent})),edges:graph.edges.filter(edge=>ids.has(edge.source)&&ids.has(edge.target)),scope:state};
}

export function budgetModelGraph(graph,page=0){
  const pages=Math.max(1,Math.ceil(graph.nodes.length/MODEL_VIEW_BUDGET.nodes));
  const current=Math.max(0,Math.min(pages-1,Number.isInteger(page)?page:0));
  const nodes=graph.nodes.slice(current*MODEL_VIEW_BUDGET.nodes,(current+1)*MODEL_VIEW_BUDGET.nodes);
  const ids=new Set(nodes.map(node=>node.id));
  const edges=graph.edges.filter(edge=>ids.has(edge.source)&&ids.has(edge.target)).slice(0,MODEL_VIEW_BUDGET.edges);
  return {nodes,edges,page:current,pages,totalNodes:graph.nodes.length,totalEdges:graph.edges.length};
}
