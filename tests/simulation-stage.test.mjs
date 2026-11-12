import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bucketMinMax,matchSignals,recordedBanner,renderSimulationStage,stageInput,structureFromSource,tableFromCsv} from '../public/simulation-stage.mjs';

const source=readFileSync(new URL('./fixtures/model-visualization/connected-demo.sysml',import.meta.url),'utf8');

test('bucket sampling keeps an interior spike that uniform strides drop',()=>{
 const samples=Array.from({length:100},(_,index)=>({x:index,y:index===7?100:0}));
 const kept=bucketMinMax(samples,5);
 assert.equal(kept[0].x,0);
 assert.equal(kept.at(-1).x,99);
 assert.equal(kept.some(point=>point.y===100),true);
 const stride=samples.filter((_,index)=>index%20===0||index===99);
 assert.equal(stride.some(point=>point.y===100),false);
});

test('signal names bind only to identically named model elements',()=>{
 const structure=structureFromSource(source);
 assert.deepEqual(structure.edges.map(edge=>[edge.kind,edge.source,edge.target]),[
  ['connect','sensor.output','uart.input'],
  ['connect','uart.output','flightSoftware.input'],
  ['connect','flightSoftware.output','attitudeEstimator.input']
 ]);
 const bound=matchSignals(['value','batteryMillivolts'],structure.elements);
 assert.deepEqual(bound.map(item=>[item.column,item.name]),[['value','value']]);
 assert.equal(bound.some(item=>item.column==='batteryMillivolts'),false);
});

test('recorded evidence is labeled and is not presented as this run',()=>{
 assert.equal(recordedBanner('fmu-run'),'留存证据 · 非本次运行');
 assert.equal(recordedBanner('example'),'示例数据');
 const table={columns:['time','x'],rows:[[0,1],[1,0.37]],rowCount:2};
 const recorded=renderSimulationStage({recorded:true,provenance:'fmu-run',table,source,checks:[{variable:'x',passed:true}],receipt:{trajectoryMatchesVerdict:true}});
 assert.match(recorded,/data-recorded-provenance="fmu-run"/);
 assert.match(recorded,/留存证据 · 非本次运行/);
 assert.match(recorded,/与 analysis 返回值一致/);
 assert.match(recorded,/通过/);
 const example=renderSimulationStage({recorded:true,provenance:'example',note:'不是已核对的 FMI 轨迹',table,source});
 assert.match(example,/data-recorded-provenance="example"/);
 assert.match(example,/>示例数据</);
 assert.doesNotMatch(example,/不是已核对的 FMI 轨迹|非本次运行|留存证据/);
 assert.equal(stageInput({result:{integrity:{verified:false},table}}),null);
 assert.equal(renderSimulationStage(null),'');
});

test('a verified job table renders cards without calling the result a recording',()=>{
 const html=renderSimulationStage({table:{columns:['time','x'],rows:[[0,1],[0.5,2],[1,0.5]],rowCount:3},source,checks:[]});
 assert.match(html,/结果总览/);
 assert.match(html,/data-signal="x"/);
 assert.doesNotMatch(html,/留存证据|示例数据/);
 assert.match(html,/connect · 未绑定/);
});

test('parallel flow edges keep separate labels at a readable size',()=>{
 const source=readFileSync(new URL('../examples/physical-preview/PayloadBay.sysml',import.meta.url),'utf8');
 const html=renderSimulationStage({table:{columns:['time','sensor','controller'],rows:[[0,263,263],[1,287,294]],rowCount:2},source,checks:[]});
 const labels=[...html.matchAll(/<text data-flow-label="\d+" data-flow-lane="(\d+)" x="([\d.]+)" y="([\d.]+)">/g)].map(match=>[match[1],match[2],match[3]]);
 assert.equal(labels.length,4);
 assert.equal(new Set(labels.map(item=>item.slice(1).join(','))).size,labels.length);
 const size=html.match(/<svg class="pm-flow" viewBox="0 0 (\d+) (\d+)" width="(\d+)" height="(\d+)"/);
 assert.equal(size[1],size[3]);
 assert.equal(size[2],size[4]);
 assert.ok(Number(size[2])>=140);
 const flow=html.match(/data-flow-kind="flow"[^>]*d="M [\d.]+ (\d+) V (\d+)" marker-end="url\(#pm-flow-arrow\)"/);
 assert.ok(flow);
 assert.ok(Number(flow[2])-Number(flow[1])>24);
});

test('csv text becomes a numeric table and drops non-numeric cells',()=>{
 const table=tableFromCsv('time,x,phase\n0,1,startup\n1,0.5,done\n');
 assert.deepEqual(table.columns,['time','x','phase']);
 assert.deepEqual(table.rows,[[0,1,null],[1,0.5,null]]);
});
