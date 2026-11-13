// Convert the semantic kernel's instance tree into solids in millimetres, Z up.
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
  const text = String(value || '').trim().replace(/^"(.*)"$/, '$1');
  const match = lengthLiteral.exec(text) || /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(?:SI::)?([\wµμ]+)$/i.exec(text);
  const unit = match && match[2];
  if (!match || !units.has(unit)) return NaN;
  return Number(match[1]) * units.get(unit);
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
    const shape = /^(?:"|')?(box|sphere|cylinder|cone|loft)(?:"|')?$/.exec(selector.value.trim())?.[1];
    return {shape, declaration:selector.node, unsupported:!shape};
  }
  if (['length','width','height'].every(name => attributes.has(name))) {
    return {shape:'box', declaration:attributes.get('length').node};
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

// A station is a symmetric trapezoid in a plane perpendicular to local X.
// Lower and upper widths are full widths. Section positions are measured in the
// declaring item's local frame, while renderer coordinates use the solid centre.
function loftForm(records, describe) {
  if (records.length < 2) return {error:'放样形体至少需要两个不同 X 位置的截面 item。'};
  const sections = [];
  for (const record of records) {
    const model = describe(record);
    const section = {y:0};
    const keys = ['x','lowerZ','upperZ','lowerWidth','upperWidth'];
    if (model.attributes.has('y')) keys.push('y');
    const hasShoulder = model.attributes.has('shoulderZ') || model.attributes.has('shoulderWidth');
    if (hasShoulder) keys.push('shoulderZ','shoulderWidth');
    for (const key of keys) {
      section[key] = millimetres(model.attributes.get(key)?.value);
      if (!Number.isFinite(section[key])) return {error:memberName(record) + ' 的 ' + key + ' 需要含单位的长度。'};
    }
    if (model.geometry || model.position || model.error || model.children.length) {
      return {error:memberName(record) + ' 必须是单一截面记录，不能含额外实体或独立变换。'};
    }
    if (section.lowerWidth <= 0 || section.upperWidth <= 0 || section.lowerZ >= section.upperZ) {
      return {error:memberName(record) + ' 的两个宽度必须为正，且 upperZ 必须大于 lowerZ。'};
    }
    if (hasShoulder && (section.shoulderWidth <= 0 || section.shoulderZ <= section.lowerZ || section.shoulderZ >= section.upperZ)) {
      return {error:memberName(record) + ' 的肩部宽度必须为正，shoulderZ 必须位于上下截面高度之间。'};
    }
    sections.push(section);
  }
  if (sections.some(section => ('shoulderZ' in section) !== ('shoulderZ' in sections[0]))) {
    return {error:'各放样截面必须一致声明或省略 shoulderZ 和 shoulderWidth。'};
  }
  sections.sort((a,b) => a.x - b.x);
  if (sections.some((section, i) => i && section.x === sections[i - 1].x)) {
    return {error:'放样截面的 X 位置重复，请为各截面指定不同的位置。'};
  }
  const minX = sections[0].x, maxX = sections.at(-1).x;
  const minZ = Math.min(...sections.map(s => s.lowerZ)), maxZ = Math.max(...sections.map(s => s.upperZ));
  const halfWidth = s => Math.max(s.lowerWidth, s.upperWidth, s.shoulderWidth || 0) / 2;
  const minY = Math.min(...sections.map(s => s.y - halfWidth(s))), maxY = Math.max(...sections.map(s => s.y + halfWidth(s)));
  const size = [maxX - minX, maxY - minY, maxZ - minZ];
  const offset = [minX + size[0] / 2, minY + size[1] / 2, minZ + size[2] / 2];
  for (const section of sections) {
    section.x -= offset[0];
    section.y -= offset[1];
    section.lowerZ -= offset[2];
    section.upperZ -= offset[2];
    if ('shoulderZ' in section) section.shoulderZ -= offset[2];
  }
  return {size, sections, offset};
}

function primitiveForm(shape, attributes) {
  const read = name => millimetres(attributes.get(name)?.value);
  if (shape === 'box') return {size:['length','width','height'].map(read)};
  const diameter = attributes.has('radius') ? 2 * read('radius') : read('diameter');
  if (shape === 'sphere') return {size:[diameter,diameter,diameter]};
  const axis = attributes.has('axis') ? /^(?:"|')?([XYZ])(?:"|')?$/.exec(attributes.get('axis').value.trim())?.[1] : 'Z';
  if (!axis) return {error:'圆柱或圆锥的轴向 axis 必须是字符串 "X"、"Y" 或 "Z"。'};
  const size = axes.map(direction => direction === axis ? read('height') : diameter);
  return {size,axis};
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
    const members = [...childByName.values()];
    const sections = geometry?.shape === 'loft' ? members.filter(child => child.metaclass === 'ItemUsage') : [];
    const model = {geometry, attributes, position, sections, children:sections.length ? members.filter(child => child.metaclass !== 'ItemUsage') : members, error};
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
          const form = model.form ??= shape === 'loft' ? loftForm(model.sections, describe) : primitiveForm(shape, model.attributes);
          const {size, offset, ...fields} = form;
          const center = offset ? position.map((value, index) => value + offset[index]) : position;
          if (form.error) issues.add(path + '：' + form.error);
          else if (size.every(value => Number.isFinite(value) && value > 0) && center.every(Number.isFinite)) {
            const colorValue = model.attributes.get('color');
            const color = /^"(#[a-f0-9]{6})"$/i.exec(colorValue?.value)?.[1];
            if (colorValue && !color) issues.add(path + '：color 需要六位十六进制颜色字符串，本次使用默认颜色。');
            parts.push({id:JSON.stringify([node.id, path]), nodeId:(instance || node).id,
              shapeNodeId:declaration.id, ownerNodeId:parent.node?.id,
              label:instance ? path.slice(1) : frame.name, path, shape, size, position:center, ...fields, ...(color && {color}),
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
