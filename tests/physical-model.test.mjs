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

test('table geometry comes from standard library shapes, actual uses and centimetre literals', () => {
  const {parts, issues, graph} = preview(readFileSync(local('examples/physical-preview/table.sysml'), 'utf8'));
  assert.deepEqual(issues, []);
  assert.equal(parts.length, 5);
  const top = parts.find(part => part.label === 'tabletop');
  assert.deepEqual(top.size, [1200,700,30]);
  assert.deepEqual(top.position, [0,0,735]);
  const legs = parts.filter(part => part !== top);
  for (const leg of legs) {
    assert.equal(leg.shape, 'box');
    assert.deepEqual(leg.size, [60,60,720]);
    assert.equal(graph.nodes.find(node => node.id === leg.nodeId).metaclass, 'ItemUsage');
    assert.equal(graph.nodes.find(node => node.id === leg.shapeNodeId).qname, 'TableExample::TableLeg');
  }
  assert.deepEqual(legs.map(part => part.position), [[-520,-270,360],[520,-270,360],[-520,270,360],[520,270,360]]);
  assert.equal(new Set(legs.map(part => part.id)).size, 4);
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
