import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {normalizeSemanticGraph} from '../public/document-viewer.mjs';
import {buildPhysicalModel} from '../public/physical-model.mjs';

const local = path => fileURLToPath(new URL('../' + path, import.meta.url));
function preview(text) {
  const result = spawnSync(process.execPath, [local('server/model-backend/worker.mjs'), local('toolchains/sysml/package')], {
    input:JSON.stringify({operation:'query',sources:[{name:'model.sysml',text}]}), encoding:'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const semantic = JSON.parse(result.stdout);
  assert.equal(semantic.valid, true, JSON.stringify(semantic.findings));
  const graph = normalizeSemanticGraph(semantic);
  return {...buildPhysicalModel(graph, text), graph};
}

test('typed rectangular solids use the definition dimensions and instance placements', () => {
  const {parts, issues, graph} = preview(`package Example {private import SI::*;
    item def Block :> ShapeItems::RectangularCuboid {
      attribute :>> length = 12 [cm]; attribute :>> width = 4 [cm]; attribute :>> height = 3 [cm];
    }
    part assembly {
      item one : Block { attribute centerX = -10 [cm]; attribute centerY = 2 [cm]; attribute centerZ = 5 [cm]; }
      item two : Block { attribute centerX = 10 [cm]; attribute centerY = 2 [cm]; attribute centerZ = 5 [cm]; }
    }
  }`);
  assert.deepEqual(issues, []);
  assert.equal(parts.length, 2);
  for (const part of parts) {
    assert.equal(part.shape, 'box');
    assert.deepEqual(part.size, [120,40,30]);
    assert.equal(graph.nodes.find(node => node.id === part.nodeId).metaclass, 'ItemUsage');
    assert.equal(graph.nodes.find(node => node.id === part.shapeNodeId).qname, 'Example::Block');
  }
  assert.deepEqual(parts.map(part => part.position), [[-100,20,50],[100,20,50]]);
  assert.notEqual(parts[0].id, parts[1].id);
});

test('repeated part uses expand their own inherited shape with parent-relative offsets', () => {
  const {parts, issues} = preview(`package Example {
    private import SI::*;
    part def Wheel {
      item tyre : ShapeItems::RightCircularCylinder {
        attribute :>> radius = 20 [cm]; attribute :>> height = 8 [cm];
        attribute centerX = 1 [cm]; attribute centerY = 1 [cm]; attribute centerZ = 0 [mm];
      }
    }
    part pair {
      part left : Wheel { attribute centerX = -0.5 [m]; attribute centerY = 2 [mm]; attribute centerZ = 0 [mm]; }
      part right : Wheel { attribute centerX = 50 [cm]; attribute centerY = 2 [mm]; attribute centerZ = 0 [mm]; }
    }
  }`);
  assert.deepEqual(issues, []);
  assert.deepEqual(parts.map(part => part.shape), ['cylinder','cylinder']);
  assert.deepEqual(parts[0].size, [400,400,80]);
  assert.deepEqual(parts.map(part => part.position), [[-490,12,0],[510,12,0]]);
  assert.notEqual(parts[0].nodeId, parts[1].nodeId);
  assert.equal(parts[0].shapeNodeId, parts[1].shapeNodeId);
});

test('missing coordinates and units are reported; a length evaluated by the kernel is usable', () => {
  const {parts, issues} = preview(`package Example {
    private import SI::*; private import ScalarValues::*;
    part assembly {
      item ball : ShapeItems::Sphere { attribute :>> radius = 2 [cm]; }
      item cap : ShapeItems::RightCircularCone {
        attribute :>> radius = 6 [mm]; attribute :>> height = 2 [cm];
        attribute centerX = 0 [m]; attribute centerY = 0 [m]; attribute centerZ = 5 [cm];
      }
      part malformed {
        attribute shape : String = "box"; attribute length = 10 [mm];
        attribute width = 5; attribute height = 8 [mm];
        attribute centerX = 1 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
      }
      item partial : ShapeItems::Sphere {
        attribute :>> radius = 3 [cm]; attribute centerX = 8 [mm];
      }
      item expression : ShapeItems::Sphere {
        attribute :>> radius = 2 [mm] + 3 [mm];
        attribute centerX = 8 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
      }
      part controller;
    }
  }`);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].shape, 'cone');
  assert.deepEqual(parts[0].size, [12,12,20]);
  assert.deepEqual(parts[1].size, [10,10,10]);
  for (const name of ['ball','malformed','partial','controller']) assert.ok(issues.some(issue => issue.includes(name)));
});

test('a single shape can be inspected in its own frame; a semantic-only model supplies no geometry', () => {
  const result = preview('package Example {private import SI::*; item ball : ShapeItems::Sphere { attribute :>> radius = 4 [cm]; }}');
  assert.deepEqual(result.parts[0].size, [80,80,80]);
  assert.deepEqual(result.parts[0].position, [0,0,0]);
  assert.equal(result.parts[0].placement, 'local-origin');
  const semantic = preview(readFileSync(local('server/model-backend/nos3-integration.sysml'), 'utf8'));
  assert.deepEqual(semantic.parts, []);
  assert.deepEqual(semantic.issues, []);
});

test('independent roots and truncated graphs have no established common assembly', () => {
  const result = preview(`package Example { private import SI::*;
    item a : ShapeItems::Sphere {attribute :>> radius = 2 [mm];}
    item b : ShapeItems::Sphere {attribute :>> radius = 3 [mm];}
  }`);
  assert.deepEqual(result.parts, []);
  assert.match(result.issues.join(), /多个独立/);
  const clipped = buildPhysicalModel({...result.graph, truncated:true});
  assert.deepEqual(clipped.parts, []);
  assert.match(clipped.issues.join(), /截断/);
});

test('non-composite references do not create a second body, and unsupported transforms are reported', () => {
  const result = preview(`package Example { private import SI::*;
    part product {
      item body : ShapeItems::Sphere {
        attribute :>> radius = 2 [cm];
        attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
      }
      ref item pointer : ShapeItems::Sphere {attribute :>> radius = 2 [cm];}
      item tilted : ShapeItems::RectangularCuboid {
        attribute :>> length = 1 [m]; attribute :>> width = 20 [cm]; attribute :>> height = 3 [cm];
        attribute centerX = 2 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm]; attribute yaw = 1;
      }
    }
  }`);
  assert.deepEqual(result.parts.map(part => part.label), ['body']);
  assert.deepEqual(result.issues.length, 1);
  assert.match(result.issues[0], /tilted.*旋转/);
});

function station(name, fields) {
  return 'item ' + name + ' { ' + Object.entries(fields).map(([key,value]) => 'attribute ' + key + ' = ' + value + ';').join(' ') + ' }';
}
function loft(stations) {
  return `package Example {private import SI::*; private import ScalarValues::*;
    item def Casing {
      attribute shape : String = "loft"; attribute color : String = "#4172AB";
      ${stations.join('\n')}
    }
    part product {item casing : Casing {attribute centerX=1[m];attribute centerY=50[mm];attribute centerZ=20[mm];}}
  }`;
}
const first = {x:'30 [mm]',y:'-4 [mm]',lowerZ:'5 [mm]',upperZ:'42 [mm]',lowerWidth:'4 [cm]',upperWidth:'1 [cm]'};
const last = {x:'0.13 [m]',lowerZ:'8 [mm]',upperZ:'62 [mm]',lowerWidth:'52 [mm]',upperWidth:'32 [mm]'};

test('loft uses source station widths, optional shoulders, offsets and colour', () => {
  const {parts,issues} = preview(loft([
    station('aft',{...last,shoulderZ:'40 [mm]',shoulderWidth:'60 [mm]'}),
    station('fore',{...first,shoulderZ:'20 [mm]',shoulderWidth:'70 [mm]'}),
  ]));
  assert.deepEqual(issues, []);
  assert.equal(parts.length, 1);
  const [body] = parts;
  assert.equal(body.shape, 'loft');
  assert.equal(body.color, '#4172AB');
  // X 30..130, Y -39..31, Z 5..62 relative to the model origin (1000,50,20).
  assert.deepEqual(body.size, [100,70,57]);
  assert.deepEqual(body.position, [1080,46,53.5]);
  assert.deepEqual(body.sections, [
    {x:-50,y:0,lowerZ:-28.5,upperZ:8.5,lowerWidth:40,upperWidth:10,shoulderZ:-13.5,shoulderWidth:70},
    {x:50,y:4,lowerZ:-25.5,upperZ:28.5,lowerWidth:52,upperWidth:32,shoulderZ:6.5,shoulderWidth:60},
  ]);
});

test('invalid or repeated stations invalidate the loft instead of connecting across the gap', () => {
  const invalid = [
    [{...last,x:'3 [cm]'}, /X 位置重复/],
    [{...last,upperWidth:'5'}, /upperWidth.*长度/],
    [{...last,lowerZ:'65 [mm]'}, /upperZ 必须大于 lowerZ/],
    [{...last,shoulderZ:'30 [mm]'}, /shoulderWidth.*长度/],
    [{...last,shoulderZ:'30 [mm]',shoulderWidth:'55 [mm]'}, /一致声明/],
  ];
  for (const [fields, expected] of invalid) {
    const {parts,issues} = preview(loft([station('fore',first),station('aft',fields)]));
    assert.deepEqual(parts, []);
    assert.match(issues.join(), expected);
  }
});

test('source axis gives rotational solids their world-axis dimensions', () => {
  const cylinders = ['X','Y','Z','bad'].map((axis, index) => `item n${index} : ShapeItems::RightCircularCylinder {
    attribute :>> radius=3[cm]; attribute :>> height=7[mm]; attribute axis : String="${axis}";
    attribute centerX=${index * 100}[mm]; attribute centerY=0[mm]; attribute centerZ=0[mm];}`);
  const {parts, issues} = preview('package E {private import SI::*; private import ScalarValues::*; part root {' + cylinders.join('\n') + '}}');
  assert.deepEqual(parts.map(part => [part.axis,part.size]), [['X',[7,60,60]],['Y',[60,7,60]],['Z',[60,60,7]]]);
  assert.equal(issues.length,1);
  assert.match(issues[0],/n3.*axis/);
});

test('electric vehicle exterior matches its declared overall bounds, body width and wheel positions', () => {
  const {parts,issues} = preview(readFileSync(local('examples/physical-preview/electric-vehicle.sysml'), 'utf8'));
  assert.deepEqual(issues, []);
  const bounds = [0,1,2].map(i => [
    Math.min(...parts.map(p => p.position[i] - p.size[i] / 2)),
    Math.max(...parts.map(p => p.position[i] + p.size[i] / 2)),
  ]);
  assert.deepEqual(bounds, [[-2360,2360],[-1044.5,1044.5],[0,1440]]);
  assert.equal(parts.find(part => part.label === 'bodyShell').size[1], 1850);
  const tyres = parts.filter(part => part.label.endsWith('Tyre'));
  assert.deepEqual(Object.fromEntries(tyres.map(part => [part.label,part.position])), {
    frontLeftTyre:[1492,792,334.35], frontRightTyre:[1492,-792,334.35],
    rearLeftTyre:[-1383,792,334.35], rearRightTyre:[-1383,-792,334.35],
  });
  for (const tyre of tyres) {
    assert.equal(tyre.axis, 'Y');
    assert.deepEqual(tyre.size, [668.7,235,668.7]);
  }
});
