import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {alignmentReport,modelicaVariableNames,deriveBindings,deriveDrive,buildRecordedManifest,recordedManifestPath} from '../shared/recorded-manifest.mjs';
import {recordedProvenance,simulationStatus,unmatchedColumns,bucketMinMax,driveFlags,elementsFromGraph,flowEdgesFromGraph,formatClock,matchSignals,recordedBanner,renderSimulationStage,shortName,signalBindings,signalUnits,stageInput,structureFromSource,tableFromCsv} from '../public/simulation-stage.mjs';

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
 assert.equal(recordedBanner('fmu-run'),'');
 assert.equal(recordedBanner('example'),'示例数据');
 const table={columns:['time','x'],rows:[[0,1],[1,0.37]],rowCount:2};
 const recorded=renderSimulationStage({recorded:true,provenance:'fmu-run',note:'留存证据',table,source,checks:[{variable:'x',passed:true}],receipt:{trajectoryMatchesVerdict:true}});
 assert.match(recorded,/data-recorded-provenance="fmu-run"/);
 assert.doesNotMatch(recorded,/留存证据|非本次运行|pm-recorded/);
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
 const source=readFileSync(new URL('../examples/physical-preview/electric-vehicle.sysml',import.meta.url),'utf8');
 const html=renderSimulationStage({table:{columns:['time','battery','inverter'],rows:[[0,78,0],[1,77,15]],rowCount:2},source,checks:[]});
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

test('recorded quantities keep their declared units',()=>{
 assert.deepEqual(signalUnits({battery:' % ',inverter:'kW',motor:'km/h',bad:'<s>',time:'seconds and more than sixteen'}),{battery:'%',inverter:'kW',motor:'km/h'});
 const html=renderSimulationStage({table:{columns:['time','battery','inverter','motor'],rows:[[0,78,0,0],[60,67,12,50]],rowCount:2},source:'part battery {} part inverter {} part motor {}',units:{battery:'%',inverter:'kW',motor:'km/h'},recorded:true,provenance:'example'});
 assert.match(html,/data-signal="battery"[\s\S]*?<span class="pm-signal-unit">%/);
 assert.match(html,/data-signal="inverter"[\s\S]*?<span class="pm-signal-unit">kW/);
 assert.match(html,/data-signal="motor"[\s\S]*?<span class="pm-signal-unit">km\/h/);
});

test('playback clock stays the same width from the first sample to the last',()=>{
 const widths=new Set([0,0.5,9.5,10,60].map(value=>formatClock(value).length));
 assert.equal(widths.size,1);
 const html=renderSimulationStage({table:{columns:['time','motor'],rows:[[0,0],[60,50]],rowCount:2},source:'part motor {}',recorded:true,provenance:'example'});
 assert.match(html,/class="pm-time"/);
 assert.match(html,/data-pm-sample-unit/);
});

test('typed names, aliases, and flow names bind without a motor part',()=>{
 const source='part cell : Cell {}\npart load {}\nflow voltage from cell.out to load.in\nflow of current from load.in to cell.out\n';
 assert.equal(shortName('Pkg::battery'),'battery');
 assert.equal(shortName('battery : BatteryPack'),'battery');
 assert.equal(elementsFromGraph({nodes:[{id:'cell',label:'cell : Cell'}]})[0].name,'cell');
 const structure=structureFromSource(source);
 assert.deepEqual(structure.edges.filter(edge=>edge.kind==='flow').map(edge=>[edge.name,edge.source,edge.target]),[
  ['voltage','cell.out','load.in'],
  ['current','load.in','cell.out']
 ]);
 const elements=structure.elements.concat([{name:'load : Load',id:'load'}]);
 const bound=matchSignals(['voltage','cell','temp'],elements,{voltage:'cell',temp:'missing','not an id':'cell'});
 assert.deepEqual(bound.map(item=>[item.column,item.name]),[['voltage','cell'],['cell','cell']]);
 const plain=driveFlags(bound,'');
 assert.equal(plain.some(item=>item.drive),false);
 const driven=driveFlags(bound,'voltage');
 assert.deepEqual(driven.filter(item=>item.drive).map(item=>item.column),['voltage']);
 assert.equal(driven.find(item=>item.column==='cell').drive,false);
 const html=renderSimulationStage({table:{columns:['time','voltage','cell'],rows:[[0,12,1],[1,11,2]],rowCount:2},source,bindings:{voltage:'cell'}});
 assert.match(html,/data-flow-kind="flow"[^>]*data-flow-column="voltage"/);
 const graph=flowEdgesFromGraph({nodes:[{id:'a',label:'cell : Cell'},{id:'b',label:'load'}],edges:[{kind:'flow',label:'voltage',source:'a',target:'b'}]});
 assert.equal(graph[0].name,'voltage');
 assert.deepEqual(signalBindings({voltage:'cell',bad:1,' x ':'cell'}),{voltage:'cell'});
 const input=stageInput({recordedView:{provenance:'example',table:{columns:['time','voltage'],rows:[[0,1],[1,2]],rowCount:2},bindings:{voltage:'cell'},drive:' voltage '}});
 assert.deepEqual(input.bindings,{voltage:'cell'});
 assert.equal(input.drive,'voltage');
});

test('official template flow forms bind nested parts that are not the electric vehicle',()=>{
 const source=`part def Fuel;
part tankAssy : FuelTankAssembly {}
part eng : Engine {}
part autoFocus {}
part imager {}
flow of Fuel
  from tankAssy.fuelTankPort.fuelSupply
  to eng.engineFuelPort.fuelSupply;
flow supplierPort.fuelSupply to consumerPort.fuelSupply;
flow autoFocus.realImage to imager.focusedImage;`;
 const flows=structureFromSource(source).edges.filter(edge=>edge.kind==='flow');
 assert.deepEqual(flows.map(edge=>[edge.name,edge.source,edge.target]),[
  ['Fuel','tankAssy.fuelTankPort.fuelSupply','eng.engineFuelPort.fuelSupply'],
  ['','supplierPort.fuelSupply','consumerPort.fuelSupply'],
  ['','autoFocus.realImage','imager.focusedImage']
 ]);
 const html=renderSimulationStage({
  table:{columns:['time','fuelSupply','image'],rows:[[0,3,1],[1,4,2]],rowCount:2},
  source,
  bindings:{fuelSupply:'tankAssy',image:'autoFocus'}
 });
 assert.match(html,/data-flow-node="tankAssy"/);
 assert.match(html,/data-flow-node="eng"/);
 assert.doesNotMatch(html,/data-flow-node="fuelTankPort"/);
 assert.match(html,/data-flow-kind="flow"[^>]*data-flow-column="fuelSupply"/);
 assert.match(html,/data-flow-node="autoFocus"/);
 assert.match(html,/data-flow-kind="flow"[^>]*data-flow-column="image"/);
});

test('csv text becomes a numeric table and drops non-numeric cells',()=>{
 const table=tableFromCsv('time,x,phase\n0,1,startup\n1,0.5,done\n');
 assert.deepEqual(table.columns,['time','x','phase']);
 assert.deepEqual(table.rows,[[0,1,null],[1,0.5,null]]);
});

test('columns are aliased to model elements when names only share a prefix',()=>{
 const source='part def Plant{part tank;part pump;flow of Fuel from tank.out to pump.in;}';
 assert.deepEqual(deriveBindings(['time','tank_level','pump_speed','tank','mystery'],source),{tank_level:'tank',pump_speed:'pump'});
 assert.equal(deriveDrive(['time','mystery','pump_speed'],{pump_speed:'pump'},source),'pump_speed');
 assert.equal(deriveDrive(['time','mystery'],{},source),'');
});

test('a manifest rebuilt after a run keeps hand-written fields and records the run',()=>{
 const manifest=buildRecordedManifest({columns:['time','tank_level'],source:'part tank;',csv:'engineering/x/outputs/t.csv',jobId:'j1',checks:[{variable:'tank_level',passed:true},{id:'native'}],previous:{schema:'daidalis-recorded-trajectory-v1',bindings:{tank_level:'other'},drive:'tank_level',units:{tank_level:'L'}}});
 assert.equal(manifest.schema,'daidalis-recorded-trajectory-v1');
 assert.equal(manifest.provenance,'fmu-run');
 assert.deepEqual(manifest.bindings,{tank_level:'other'});
 assert.deepEqual(manifest.units,{tank_level:'L'});
 assert.deepEqual(manifest.checks,[{variable:'tank_level',passed:true}]);
 assert.equal(recordedManifestPath('models/a.sysml'),'models/a.recorded.json');
 assert.equal(recordedManifestPath('models/a.mo'),'');
});

test('stage lists signal columns that no element claims',()=>{
 const html=renderSimulationStage({table:{columns:['time','tank','mystery'],rows:[[0,1,5],[1,2,6]],rowCount:2},source:'part tank;'});
 assert.match(html,/data-unmatched-columns="mystery"/);
 const clean=renderSimulationStage({table:{columns:['time','tank'],rows:[[0,1],[1,2]],rowCount:2},source:'part tank;'});
 assert.doesNotMatch(clean,/data-unmatched-columns/);
 assert.deepEqual(unmatchedColumns(['time','a'],[{name:'b'}],{a:'b'}),[]);
});

test('provenance and workbench status distinguish replay, run and structure-only',()=>{
 assert.equal(recordedProvenance('agent-authored'),'agent-authored');
 assert.equal(recordedProvenance('anything'),'example');
 assert.match(recordedBanner('agent-authored'),/非仿真结果/);
 assert.equal(simulationStatus({manifest:{provenance:'fmu-run'},path:'m/a.sysml'}).state,'replay');
 const run=simulationStatus({siblings:{fmus:['m/b.fmu','m/a.fmu']},path:'m/a.sysml'});
 assert.deepEqual([run.state,run.fmu],['run','m/a.fmu']);
 assert.equal(simulationStatus({siblings:{fmus:['m/b.fmu','m/c.fmu']},path:'m/a.sysml'}).state,'structure');
 assert.equal(simulationStatus({siblings:{fmus:['m/b.fmu','m/named.fmu']},path:'m/a.sysml',source:'metadata ToolExecution { uri = "file:///work/m/named.fmu"; }'}).fmu,'m/named.fmu');
 assert.equal(simulationStatus({manifest:{provenance:'fmu-run'},siblings:{fmus:['m/a.fmu']},path:'m/a.sysml'}).fmu,'m/a.fmu');
 assert.match(simulationStatus({siblings:{fmus:[],csvs:[]},path:'m/a.sysml'}).message,/仅结构，无轨迹/);
});

test('modelica variable names are scanned without equations or comments',()=>{
 const mo='model Plant\n  parameter Real k=1 "gain";\n  Real tank_level(start=1);\n  Pump pump;\n  // Real ghost;\nequation\n  der(tank_level)=-k;\nend Plant;';
 assert.deepEqual(modelicaVariableNames(mo).sort(),['k','pump','tank_level']);
});

test('alignment reports matches, orphan signals and orphan elements',()=>{
 const report=alignmentReport({sysml:'part tank;part pump;part valve;',modelica:'model M\n Real tank;\n Real pump_speed;\n Real extra;\nequation\nend M;',aliases:{pump_speed:'pump'}});
 assert.equal(report.kind,'modelica');
 assert.deepEqual(report.matched,[{signal:'tank',element:'tank'},{signal:'pump_speed',element:'pump'}]);
 assert.deepEqual(report.signalsWithoutElement,['extra']);
 assert.deepEqual(report.elementsWithoutSignal,['valve']);
 assert.equal(report.aligned,false);
 const columns=alignmentReport({sysml:'part tank;',columns:['time','plant.tank']});
 assert.equal(columns.aligned,true);
 assert.equal(columns.kind,'columns');
});
