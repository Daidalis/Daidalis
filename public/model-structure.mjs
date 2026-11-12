import {modelHierarchy,modelNavigation,MODEL_VIEW_BUDGET} from './model-navigation.mjs';

const OCCURRENCE='::occ::';
const connection=edge=>edge.kind!=='note'&&(edge.interconnection||['connect','flow','interface'].includes(edge.kind));
const member=node=>node?.kind==='package'||/Part|Port|Item|Action|State|Transition/.test(node?.metaclass||'')&&node.kind!=='note';
const segment=node=>node.qname?.split('::').at(-1)?.replace(/^'|'$/g,'');

function ancestors(parent,id){
  const result=[],seen=new Set();
  while(id&&!seen.has(id)){seen.add(id);result.push(id);id=parent.get(id);}
  return result;
}

function structureIndex(graph){
  const hierarchy=modelHierarchy(graph),providers=new Map(),redefines=new Map(),links=new Map();
  for(const edge of graph.edges){
    if(edge.kind==='typing'||edge.kind==='specialization'&&['subclassification','redefinition'].includes(edge.rel)){
      if(!providers.has(edge.source))providers.set(edge.source,[]);
      providers.get(edge.source).push(edge.target);
    }
    if(edge.rel==='redefinition'){
      if(!redefines.has(edge.source))redefines.set(edge.source,[]);
      redefines.get(edge.source).push(edge.target);
    }
    if(!connection(edge))continue;
    const targetAncestors=new Set(ancestors(hierarchy.parent,edge.target));
    const owner=hierarchy.parent.get(edge.id)||ancestors(hierarchy.parent,edge.source).find(id=>targetAncestors.has(id));
    if(!owner)continue;
    if(!links.has(owner))links.set(owner,[]);
    links.get(owner).push(edge);
  }
  const closure=id=>{
    const seen=new Set(),queue=[id];
    for(let index=0;index<queue.length&&seen.size<4096;index++){
      const current=queue[index];
      if(seen.has(current))continue;
      seen.add(current);queue.push(...(providers.get(current)||[]));
    }
    return seen;
  };
  const aliases=id=>{
    const seen=new Set(),queue=[id];
    for(let index=0;index<queue.length&&seen.size<4096;index++){
      const current=queue[index];
      if(seen.has(current))continue;
      seen.add(current);queue.push(...(redefines.get(current)||[]));
    }
    return seen;
  };
  const cache=new Map();
  const members=id=>{
    if(cache.has(id))return cache.get(id);
    const declarations=new Map();
    for(const provider of closure(id))for(const child of hierarchy.children.get(provider)||[]){
      const node=hierarchy.byId.get(child);
      if(member(node)&&(!/^Part/.test(hierarchy.byId.get(id)?.metaclass)||/Part|Port/.test(node.metaclass))){
        declarations.set(child,{sourceId:child,aliases:aliases(child)});
      }
    }
    const ports=new Map();
    for(const candidate of declarations.values()){
      const node=hierarchy.byId.get(candidate.sourceId);
      if(node.kind!=='port'||!node.qname||!node.file||!node.line)continue;
      const key=JSON.stringify([node.qname,node.file,node.line,node.col]);
      const previous=ports.get(key);
      if(previous){
        const actualOwner=hierarchy.byId.get(hierarchy.parent.get(node.id));
        const declaredHere=node.qname.split('::').slice(0,-1).join('::')===actualOwner?.qname;
        const winner=declaredHere?candidate:previous,other=declaredHere?previous:candidate;
        winner.aliases=new Set([...winner.aliases,...other.aliases]);
        declarations.delete(other.sourceId);ports.set(key,winner);
      }else ports.set(key,candidate);
    }
    const candidates=[...declarations.values()];
    const result=candidates.filter(candidate=>!candidates.some(other=>other!==candidate&&other.aliases.has(candidate.sourceId)));
    for(const candidate of result)candidate.conflict=result.some(other=>other!==candidate&&[...candidate.aliases].some(id=>other.aliases.has(id)));
    cache.set(id,result);
    return result;
  };
  return {...hierarchy,closure,members,links};
}

export function projectModelStructure(graph,navigation={}){
  const initial=modelNavigation(graph,navigation),index=structureIndex(graph);
  const contexts=new Map(),nodes=new Map(graph.nodes.map(node=>[node.id,node])),children=new Map();
  const visibleIds=new Set(),unresolved=[];
  let limited=false;
  const create=(sourceId,parent,aliases=new Set([sourceId]),conflict=false)=>{
    const declaration=index.byId.get(sourceId);
    if(!declaration)return null;
    const id=!parent||index.parent.get(sourceId)===parent.id?sourceId:parent.id+OCCURRENCE+encodeURIComponent(sourceId);
    if(contexts.has(id))return contexts.get(id);
    if(contexts.size>=4096){limited=true;return null;}
    const slots=index.members(sourceId),signature=slots.map(slot=>slot.sourceId).sort().join('|');
    let current=parent,recursive=false,length=1;
    while(current){length++;if(signature&&current.signature===signature)recursive=true;current=current.parent;}
    const context={id,sourceId,parent,aliases,slots,signature,conflict};
    recursive=recursive||slots.some(slot=>slot.sourceId===sourceId);
    context.node={...declaration,id,sourceId,parent:parent?.id||declaration.parent,
      instancePath:parent?parent.node.instancePath+'::'+segment(declaration):declaration.qname||declaration.label,
      recursive,structureConflict:conflict,expandable:slots.length>0&&!recursive&&!conflict&&length<12,expanded:false};
    contexts.set(id,context);nodes.set(id,context.node);
    return context;
  };
  const resolve=id=>{
    if(contexts.has(id))return contexts.get(id);
    const declaration=index.byId.get(id);
    if(declaration){
      const parent=index.byId.get(index.parent.get(id));
      return create(id,parent&&member(parent)?resolve(parent.id):null);
    }
    const separator=id?.lastIndexOf(OCCURRENCE);
    if(!(separator>0))return null;
    if(id.split(OCCURRENCE).length>12)return null;
    const parent=resolve(id.slice(0,separator));
    let sourceId;
    try{sourceId=decodeURIComponent(id.slice(separator+OCCURRENCE.length));}catch{return null;}
    const slot=parent?.slots.find(slot=>slot.sourceId===sourceId);
    return slot?create(sourceId,parent,slot.aliases,slot.conflict):null;
  };
  for(const id of navigation.trail||[])resolve(id);
  const root=resolve(navigation.rootId||initial.rootId);
  if(!root)return graph;
  const descendants=context=>{
    if(!children.has(context.id)){
      const nested=context.slots.map(slot=>create(slot.sourceId,context,slot.aliases,slot.conflict)).filter(Boolean);
      children.set(context.id,nested.map(child=>child.id));
    }
    return children.get(context.id).map(id=>contexts.get(id));
  };
  const show=context=>{
    if(visibleIds.has(context.id))return true;
    if(visibleIds.size>=MODEL_VIEW_BUDGET.nodes){limited=true;return false;}
    visibleIds.add(context.id);return true;
  };
  show(root);
  const queue=[{context:root,level:0}];
  for(let position=0;position<queue.length;position++){
    const {context,level}=queue[position];
    const nested=descendants(context);
    context.node.expanded=context.node.expandable&&level<2;
    if(!context.node.expanded)continue;
    for(const child of nested){
      if(child.node.kind==='port')continue;
      if(!show(child))break;
      queue.push({context:child,level:level+1});
    }
  }
  const match=(context,predicate)=>{
    const matches=descendants(context).filter(child=>[...child.aliases].some(id=>predicate(index.byId.get(id))));
    return matches.length===1&&!matches[0].conflict?matches[0]:null;
  };
  const byPath=(owner,path)=>{
    const parts=path.match(/'(?:[^']|'')*'|[^.]+/g)||[];
    let current=owner;
    for(const part of parts){
      if(!current)return null;
      current=match(current,node=>segment(node)===part.replace(/^'|'$/g,''));
    }
    return current;
  };
  const byElement=(owner,id)=>{
    const providers=index.closure(owner.sourceId),route=[];
    let current=id;
    const seen=new Set();
    while(current&&!providers.has(current)&&!seen.has(current)){seen.add(current);route.unshift(current);current=index.parent.get(current);}
    if(!current)return null;
    let context=owner;
    for(const step of route){
      const source=index.byId.get(step);
      context=match(context,node=>node?.id===step||source?.kind==='port'&&node?.qname&&node.qname===source.qname);
      if(!context)return null;
    }
    return context;
  };
  const endpoint=(owner,edge,side)=>{
    const path=edge[side+'Path'];
    const resolved=path?byPath(owner,path):null;
    const anchored=resolved||byElement(owner,edge[side]);
    if(!anchored||path&&!resolved)unresolved.push({owner:owner.id,sourceId:edge.id,path:path||'',anchored:Boolean(anchored)});
    return anchored;
  };
  const boundary=context=>{
    if(context?.node.kind==='port'&&visibleIds.has(context.parent?.id))show(context);
    while(context&&!visibleIds.has(context.id))context=context.parent;
    return context;
  };
  const projectedEdges=[],edgeIds=new Set();
  for(const owner of [...visibleIds].map(id=>contexts.get(id))){
    if(!owner)continue;
    for(const provider of index.closure(owner.sourceId))for(const edge of index.links.get(provider)||[]){
      if(projectedEdges.length>=MODEL_VIEW_BUDGET.edges){limited=true;break;}
      const source=endpoint(owner,edge,'source'),target=endpoint(owner,edge,'target');
      const shownSource=boundary(source),shownTarget=boundary(target);
      if(!shownSource||!shownTarget||shownSource.id===shownTarget.id)continue;
      const id=owner.id+OCCURRENCE+encodeURIComponent(edge.id||JSON.stringify([provider,edge.source,edge.target,edge.kind]));
      if(edgeIds.has(id))continue;
      edgeIds.add(id);
      projectedEdges.push({...edge,id,sourceId:edge.id,source:shownSource.id,target:shownTarget.id,
        resolvedSourcePath:source.node.instancePath,resolvedTargetPath:target.node.instancePath,
        contextOwner:owner.id,interconnection:true});
    }
  }
  return {...graph,nodes:[...nodes.values()],edges:[...graph.edges.filter(edge=>!connection(edge)),...projectedEdges],
    structure:{visibleIds,children,limited,unresolved,homeRootId:initial.homeRootId,rootId:root.id}};
}
