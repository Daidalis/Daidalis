import test from 'node:test';
import assert from 'node:assert/strict';
import {initialSemanticViewport} from '../public/document-viewer.mjs';

test('wide models open at readable scale in a narrow side pane', () => {
  const diagram = {x:0,y:0,w:2466,h:570};
  const view = initialSemanticViewport(diagram,{width:282,height:760});
  assert.equal(Math.min(282/view.w,760/view.h),1);
  assert.equal(view.x,20);
  assert.ok(40 >= view.x && 40 + 258 <= view.x + view.w, 'first column card remains fully visible');
  assert.ok(view.w < diagram.w, 'full diagram is reserved for explicit fit');
});

test('a model that fits stays completely visible without shrinking labels', () => {
  const diagram = {x:0,y:0,w:560,h:360};
  const view = initialSemanticViewport(diagram,{width:1100,height:700});
  assert.ok(Math.min(1100/view.w,700/view.h)>=1);
  assert.ok(view.x<=0 && view.y<=0 && view.x+view.w>=diagram.w && view.y+view.h>=diagram.h);
});

test('hidden panes keep valid diagram bounds until measurement is available', () => {
  const diagram = {x:0,y:0,w:2466,h:570};
  for (const width of [0,NaN,undefined]) assert.deepEqual(initialSemanticViewport(diagram,{width,height:760}),diagram);
});
