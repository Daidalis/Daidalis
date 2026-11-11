// Convert the semantic kernel's instance tree into axis-aligned solids in mm.
// Composition, typing, source locations and attribute values all come from the model.
const standardShapes = new Map([
  ['RectangularCuboid','box'], ['Box','box'], ['Sphere','sphere'],
  ['RightCircularCylinder','cylinder'], ['RightCircularCone','cone'],
]);
const units = new Map([['mm',1],['cm',10],['dm',100],['m',1000],['km',1e6],['um',.001],['µm',.001],['μm',.001]]);
const lengthLiteral = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*\[\s*(?:SI::)?([\wµμ]+)\s*\]$/i;
const memberName = node => (node.qname || node.label).split('::').at(-1);
const isDefinition = node => /Definition$/.test(node.metaclass);
const axes = ['X','Y','Z'];

function millimetres(value) {
  const match = lengthLiteral.exec(value || '');
  if (!match || !units.has(match[2])) return NaN;
  return Number(match[1]) * units.get(match[2]);
}

function collectAttributes(chain) {
  const attributes = new Map();
  for (const node of chain) {
    for (const row of node.rows || []) {
      if (row.metaclass !== 'attributes') continue;
      const value = row.fullLabel || row.label;
      const separator = value.indexOf('=');
      attributes.set(memberName(row), {node, value:separator < 0 ? '' : value.slice(separator + 1).trim()});
    }
  }
  return attributes;
}

// toGraph() omits edges to standard-library elements. For a local definition
// specializing a library item, inspect only the header at the kernel's location.
function declaredStandardType(node, lines) {
  const first = lines[node.line - 1];
  if (!first || !node.col) return null;
  const header = [first.slice(node.col - 1), ...lines.slice(node.line, node.line + 5)].join('\n').split(/[;{]/, 1)[0];
  const match = /^(?:'([^']+)'|([\p{L}_][\p{L}\p{N}_]*))\s*(?::>|specializes|:)\s*ShapeItems\s*::\s*(\w+)\s*$/u.exec(header.trim());
  return match && (match[1] || match[2]) === memberName(node) ? match[3] : null;
}

function geometryOf(chain, attributes, lines) {
  const selector = attributes.get('shape');
  if (selector) {
    const shape = /^"(box|sphere|cylinder|cone)"$/.exec(selector.value)?.[1];
    return {shape, declaration:selector.node, unsupported:!shape};
  }
  for (const node of [...chain].reverse()) {
    const standard = declaredStandardType(node, lines);
    if (standard) return {shape:standardShapes.get(standard), declaration:node, unsupported:!standardShapes.has(standard)};
  }
  // With an imported library type, a usage label includes its resolved short
  // name. A local definition with that name is already represented in the chain.
  if (chain.length === 1 && !isDefinition(chain[0])) {
    const type = / : (\w+)(?: \[[^\]]+\])?$/.exec(chain[0].label)?.[1];
    if (standardShapes.has(type)) return {shape:standardShapes.get(type), declaration:chain[0]};
  }
  return null;
}

function dimensions(shape, attributes) {
  const read = name => millimetres(attributes.get(name)?.value);
  if (shape === 'box') return ['length','width','height'].map(read);
  const diameter = attributes.has('radius') ? 2 * read('radius') : read('diameter');
  return [diameter, diameter, shape === 'sphere' ? diameter : read('height')];
}

function translation(attributes) {
  const prefixes = ['center','position'].filter(prefix => axes.some(axis => attributes.has(prefix + axis)));
  if (!prefixes.length) return null;
  if (prefixes.length > 1) return [NaN,NaN,NaN];
  return axes.map(axis => millimetres(attributes.get(prefixes[0] + axis)?.value));
}

export function buildPhysicalModel(graph, source = '') {
  if (graph.truncated) return {parts:[], issues:['语义图已截断，无法可靠确定完整装配。请在较小的模型文件中预览。']};
  const parts = [], issues = new Set(), lines = source.split(/\r?\n/);
  const nodes = graph.nodes.filter(node => /^(Part|Item)(Usage|Definition)$/.test(node.metaclass));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const byQName = new Map(nodes.map(node => [node.qname, node]));
  const children = new Map(nodes.map(node => [node.id, []]));
  const bases = new Map(nodes.map(node => [node.id, []]));
  const owners = new Map(), usedTypes = new Set(), references = new Set();
  for (const edge of graph.edges) {
    const from = byId.get(edge.source), to = byId.get(edge.target);
    if (!from || !to) continue;
    if ((edge.kind === 'typing' || edge.kind === 'specialization') && isDefinition(to)) {
      bases.get(from.id).push(to);
      usedTypes.add(to.id);
    }
    if (edge.kind === 'composition' && !isDefinition(to)) {
      owners.set(to.id, from);
      if (edge.composite === false) references.add(to.id);
    }
  }
  for (const node of nodes) {
    if (/\bref\s+(?:part|item)\s+$/.test(lines[node.line - 1]?.slice(0,node.col - 1) || '')) references.add(node.id);
    // The diagram's parent may be the package even when the feature has an owner.
    const owner = owners.get(node.id) || byQName.get(node.qname.split('::').slice(0,-1).join('::'));
    if (owner && !isDefinition(node)) {
      owners.set(node.id, owner);
      children.get(owner.id).push(node);
    }
  }
  const description = new Map();
  function describe(node) {
    if (description.has(node.id)) return description.get(node.id);
    const chain = [], seen = new Set();
    let current = node, error;
    while (current) {
      if (seen.has(current.id) || bases.get(current.id).length > 1) {
        error = '类型继承存在循环或多个基类，无法唯一确定外形。';
        break;
      }
      seen.add(current.id);
      chain.unshift(current);
      current = bases.get(current.id)[0];
    }
    const attributes = collectAttributes(chain);
    const childByName = new Map();
    for (const ancestor of chain) for (const child of children.get(ancestor.id)) {
      if (!references.has(child.id)) childByName.set(memberName(child), child);
    }
    const geometry = geometryOf(chain, attributes, lines);
    const position = translation(attributes);
    if (position && !position.every(Number.isFinite)) error = '需同时给出三个中心坐标的长度字面量及单位。';
    if ([...attributes.keys()].some(name => /^(orientation|rotation[XYZ]?|yaw|pitch|roll|transformation|coordinateFrame)$/i.test(name))) error = '含有当前预览不支持的旋转或坐标变换。';
    const multiplicity = / \[([^\]]+)\]$/.exec(node.label)?.[1];
    if (multiplicity && multiplicity !== '1') error = '多个或可选实例的数量与各自位置尚未明确。';
    const model = {geometry, attributes, position, children:[...childByName.values()], error};
    description.set(node.id, model);
    return model;
  }

  const world = {children:[], name:'', path:'', position:null};
  let visited = 0, incomplete = false;
  function expand(node, parent, ancestry, instance) {
    if (visited >= 5000 || ancestry.size >= 64) {
      incomplete = true;
      issues.add('装配层级或实例数量超过预览上限。');
      return;
    }
    if (ancestry.has(node.id)) {incomplete = true;issues.add(node.qname + '：检测到循环装配。');return;}
    visited++;
    const model = describe(node);
    const name = memberName(node), path = parent.path + '/' + name;
    const frame = {node, model, name, path, position:model.position, instance, children:[], omitted:[]};
    const next = new Set(ancestry).add(node.id);
    for (const child of model.children) {
      // When a definition supplies a nested feature, preserve its usage as the
      // instance source even when several instances share that feature's ID.
      const inherited = owners.get(child.id)?.id !== node.id;
      if (!expand(child, frame, next, instance || (inherited ? node : null))) frame.omitted.push(memberName(child));
    }
    if (model.geometry || frame.children.length) {
      parent.children.push(frame);
      return true;
    }
    if (model.error && (bases.get(node.id).length > 1 || /循环/.test(model.error))) issues.add(path + '：' + model.error);
    return false;
  }
  const rootUsages = nodes.filter(node => !isDefinition(node) && !owners.has(node.id) && !references.has(node.id));
  const roots = rootUsages.length ? rootUsages : nodes.filter(node => isDefinition(node) && !usedTypes.has(node.id));
  for (const root of roots) expand(root, world, new Set(), null);
  if (world.children.length > 1) {
    issues.add('模型含有多个独立的物理根元素。请用一个装配部件声明它们的共同坐标系和相对位置。');
    incomplete = true;
  }
  if (incomplete) return {parts, issues:[...issues]};

  function place(parent, origin) {
    for (const frame of parent.children) {
      const {node, model, instance, path} = frame;
      if (model.error) {issues.add(path + '：' + model.error);continue;}
      for (const name of frame.omitted) issues.add(path + '/' + name + '：缺少支持的形状声明，已略过。');
      if (!frame.position && (parent.children.length > 1 || parent.omitted?.length || parent.model?.geometry)) {
        issues.add(path + '：缺少相对于父级的中心坐标 centerX、centerY、centerZ，无法定位。');
        continue;
      }
      // The common root is the local reference frame. A sole shape of a wrapper
      // uses that wrapper's origin. Never invent spacing between sibling parts.
      const position = frame.position ? origin.map((value, index) => value + frame.position[index]) : origin;
      if (!position.every(Number.isFinite)) {issues.add(path + '：中心坐标超出数值范围。');continue;}
      if (model.geometry) {
        const {shape, declaration, unsupported} = model.geometry;
        if (unsupported) issues.add(path + '：当前预览不支持此形状。');
        else {
          const size = dimensions(shape, model.attributes);
          if (size.every(value => Number.isFinite(value) && value > 0)) {
            parts.push({id:JSON.stringify([node.id, path]), nodeId:(instance || node).id,
              shapeNodeId:declaration.id, ownerNodeId:parent.node?.id,
              label:instance ? path.slice(1) : frame.name, path, shape, size, position,
              placement:frame.position ? 'explicit' : 'local-origin'});
          } else issues.add(path + '：缺少有效的形体尺寸，每个尺寸需要大于零的长度字面量及已支持的单位。');
        }
      }
      place(frame, position);
    }
  }
  place(world, [0,0,0]);
  return {parts, issues:[...issues]};
}
