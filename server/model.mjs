export const NODE_TYPES = ['stakeholder','need','requirement','scenario','function','component','interface','risk','test','evidence','decision','assumption'];
export const LINK_TYPES = ['derives','derives_from','satisfies','verifies','allocates','allocated_to','depends_on','mitigates','traces_to','traces','contains','interfaces','realizes','supports','refines','addresses'];
export function checkGraph(graph) {
  const errors=[], warnings=[];
  if(!graph || !Array.isArray(graph.nodes)||!Array.isArray(graph.links)) return {valid:false,errors:['nodes and links must be arrays'],warnings,coverage:{requirements:0,verified:0,satisfied:0,percent:0}};
  if(graph.nodes.length>2000||graph.links.length>10000) errors.push('Graph exceeds 2000 nodes / 10000 links');
  const ids=new Set(), edgeIds=new Set();
  for(const node of graph.nodes) {
    if(!node || typeof node.id!=='string'||!node.id.trim()||node.id.length>150) {errors.push('Each node requires a nonempty id (max 150 characters)');continue;}
    if(ids.has(node.id)) errors.push(`Duplicate node id: ${node.id}`); ids.add(node.id);
    if(!NODE_TYPES.includes(node.type)) errors.push(`Unknown node type: ${node.type}`);
    if(typeof node.name!=='string'||!node.name.trim()||node.name.length>1000) errors.push(`Node ${node.id} requires a name (max 1000 characters)`);
    if(node.description!==undefined && (typeof node.description!=='string'||node.description.length>20000)) errors.push(`Invalid description: ${node.id}`);
  }
  for(const link of graph.links) {
    if(!link||!ids.has(link.source)||!ids.has(link.target)) errors.push(`Dangling edge: ${link?.source} -> ${link?.target}`);
    if(!LINK_TYPES.includes(link?.type)) errors.push(`Unknown link type: ${link?.type}`);
    if(link?.id) {if(edgeIds.has(link.id)) errors.push(`Duplicate link id: ${link.id}`);edgeIds.add(link.id);}
    if(link?.source===link?.target) warnings.push(`Self-link: ${link.source}`);
    const source=graph.nodes.find(n=>n.id===link?.source),target=graph.nodes.find(n=>n.id===link?.target);
    if(link?.type==='verifies'&&(source?.type!=='test'||target?.type!=='requirement'))errors.push(`verifies must connect test -> requirement: ${link?.source} -> ${link?.target}`);
    if(link?.type==='satisfies'&&(!['function','component','interface'].includes(source?.type)||target?.type!=='requirement'))errors.push(`satisfies must connect function/component/interface -> requirement: ${link?.source} -> ${link?.target}`);
  }
  const requirements=graph.nodes.filter(x=>x.type==='requirement');
  const verified=requirements.filter(n=>graph.links.some(l=>l.type==='verifies'&&l.target===n.id&&graph.nodes.some(s=>s.id===l.source&&s.type==='test'))).length;
  const satisfied=requirements.filter(n=>graph.links.some(l=>l.type==='satisfies'&&l.target===n.id&&graph.nodes.some(s=>s.id===l.source&&['function','component','interface'].includes(s.type)))).length;
  for(const n of requirements) {
    if(!graph.links.some(l=>l.type==='verifies'&&l.target===n.id&&graph.nodes.some(s=>s.id===l.source&&s.type==='test'))) warnings.push(`Requirement ${n.id} has no verification link`);
    if(!graph.links.some(l=>l.type==='satisfies'&&l.target===n.id&&graph.nodes.some(s=>s.id===l.source&&['function','component','interface'].includes(s.type)))) warnings.push(`Requirement ${n.id} has no satisfaction link`);
  }
  for(const n of graph.nodes.filter(n=>['assumption','risk'].includes(n.type))) if(!graph.links.some(l=>l.source===n.id||l.target===n.id)) warnings.push(`Unlinked ${n.type}: ${n.id}`);
  if(!requirements.length) warnings.push('No requirements captured');
  return {valid:!errors.length,errors,warnings,coverage:{requirements:requirements.length,verified,satisfied,percent:requirements.length?Math.round(100*verified/requirements.length):0,scope:'Structural traceability only; links do not prove physical compliance.'}};
}
export function sanitizeGraph(graph,version) {
  return {nodes:graph.nodes.map(n=>Object.fromEntries(['id','type','name','description','status'].filter(k=>n[k]!==undefined).map(k=>[k,n[k]]))),links:graph.links.map(l=>Object.fromEntries(['id','source','target','type'].filter(k=>l[k]!==undefined).map(k=>[k,l[k]]))),version};
}
