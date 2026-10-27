import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStl} from '../public/native-geometry.mjs';
test('native STL preview derives actual geometry and rejects malformed output',()=>{
 const bytes=new TextEncoder().encode('solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 100 0 0\nvertex 0 100 340.5\nendloop\nendfacet\nendsolid x');
 const model=parseStl(bytes);assert.equal(model.triangleCount,1);assert.deepEqual(model.bounds.dimensions,[100,100,340.5]);
 assert.throws(()=>parseStl(new TextEncoder().encode('vertex 0 0 0')),/完整/);
 assert.throws(()=>parseStl(new TextEncoder().encode('vertex 1e99 0 0\nvertex 0 1 0\nvertex 0 0 1')),/无效/);
});
test('binary STL length and finite coordinates are checked',()=>{
 const bytes=new Uint8Array(134),v=new DataView(bytes.buffer);v.setUint32(80,1,true);v.setFloat32(84+12+12,4,true);v.setFloat32(84+12+24+4,3,true);const model=parseStl(bytes);assert.equal(model.triangleCount,1);assert.deepEqual(model.bounds.dimensions,[4,3,0]);v.setFloat32(96,NaN,true);assert.throws(()=>parseStl(bytes),/无效/);
});
