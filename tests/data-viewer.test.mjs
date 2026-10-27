import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDelimitedData,parseDataDocument,dataPlot,renderDataPreview,renderDocumentViewer,documentKind} from '../public/document-viewer.mjs';
import {geoJSONSketch,renderGeoJSONMap} from '../public/geojson-viewer.mjs';

test('CSV handles quoted delimiters/newlines, duplicates, missing values and opaque identifiers',()=>{
 const parsed=parseDelimitedData('time_s,value,value,note,id\r\n0,1,2,"two, words",00023\r\n1,,4,"line one\nline ""two""",9007199254740993\r\n');
 assert.deepEqual(parsed.headers,['time_s','value','value (2)','note','id']);
 assert.equal(parsed.rows[0].note,'two, words');assert.equal(parsed.rows[1].note,'line one\nline "two"');
 assert.equal(parsed.rows[1].value,null);assert.equal(parsed.rows[0].id,'00023');assert.equal(parsed.rows[1].id,'9007199254740993');
 assert.throws(()=>parseDelimitedData('a,b\n1,2,3'),/列数/);assert.throws(()=>parseDelimitedData('a,b\n1,"unclosed'),/未闭合/);
 assert.throws(()=>parseDelimitedData('a,b\n1,"quoted"suffix'),/分隔符/);
 assert.equal(parseDelimitedData('time\tvalue\n0\t1','\t').rows[0].value,1);
});

test('tabular JSON and actual column-series data retain values without generating telemetry',()=>{
 const parsed=parseDataDocument({path:'result.json',content:JSON.stringify({solver:{name:'SciPy'},passed:false,series:{time:[0,10,20],payload:[2,3,4],heater:[5,5,0]},checks:[{name:'TRACK',actual:2.3,passed:false}]})});
 const series=parsed.datasets.find(d=>d.id==='$.series');assert.deepEqual({...series.rows[1]},{time:10,payload:3,heater:5});
 const plot=dataPlot(series);assert.equal(plot.xKey,'time');assert.equal(plot.yKey,'payload');assert.deepEqual(plot.points.map(p=>[p.x,p.y]),[[0,2],[10,3],[20,4]]);
 const html=renderDataPreview({path:'result.json'}, {}, parsed);assert.match(html,/document-data-chart/);assert.match(html,/false/);assert.doesNotMatch(html,/验证通过|遥测|已完成仿真/);assert.match(html,/单位未知/);
});

test('JSON null, numeric strings and booleans never become numeric points or zeros',()=>{
 const parsed=parseDataDocument({path:'trace.json',content:'[{"t":0,"v":4},{"t":1,"v":null},{"t":2,"v":"5"},{"t":3,"v":true},{"t":4,"v":8}]'});
 const plot=dataPlot(parsed.datasets[0],{xKey:'t',yKey:'v'});assert.equal(plot.points.length,2);assert.equal(plot.omitted,3);assert.deepEqual(plot.points.map(p=>p.y),[4,8]);
 const html=renderDataPreview({}, {}, parsed);assert.doesNotMatch(html,/<polyline|<path/);assert.match(html,/3 行缺少所选数值/);
});

test('unknown summaries stay fields and invalid data is reported without fake chart',()=>{
 const file={path:'result.json',content:'{"status":"failed","reason":"solver unavailable","count":3}'};
 const html=renderDocumentViewer({file});assert.match(html,/文件字段/);assert.match(html,/solver unavailable/);assert.doesNotMatch(html,/document-data-chart|class="source-line"/);
 assert.match(renderDocumentViewer({file,tab:'source'}),/data-source-line="3"/);
 assert.match(renderDocumentViewer({file:{path:'bad.json',content:'{broken'}}),/无法解析 JSON/);
 assert.doesNotMatch(renderDocumentViewer({file:{path:'bad.csv',content:'a,b\n1,2,3'}}),/document-data-chart/);
});

test('CSV/TSV/JSONL files get data tabs while arbitrary code stays source',()=>{
 for(const filename of ['data.csv','data.tsv','data.jsonl','data.ndjson'])assert.ok(['csv','jsonl'].includes(documentKind({name:filename})));
 assert.equal(documentKind({mime:'application/x-ndjson'}),'jsonl');assert.equal(documentKind({mime:'text/tab-separated-values'}),'csv');
 const parsed=parseDataDocument({path:'samples.jsonl',content:'{"time":0,"q":[0,1,2,3]}\n{"time":1,"q":[1,2,3,4]}\n'});
 assert.equal(parsed.datasets[0].rows[1]['q[3]'],4);assert.equal(dataPlot(parsed.datasets[0],{yKey:'q[2]'}).points[0].y,2);
 assert.match(parseDataDocument({path:'samples.jsonl',content:'{"x":1}\ninvalid'}).error,/第 2 条/);
 assert.equal(documentKind({name:'x.py'}),'text');
});

test('large datasets are bounded and truncation is visible, injected strings are escaped',()=>{
 const file={path:'unsafe.json',content:JSON.stringify({note:'<img src=x onerror="bad()">',samples:Array.from({length:2200},(_,i)=>({time:i,'<script>alert(1)</script>':i*.5}))})};
 const parsed=parseDataDocument(file),dataset=parsed.datasets[0];assert.equal(dataset.rows.length,2000);assert.equal(dataset.rowCount,2200);assert.equal(dataset.truncated,true);
 const html=renderDataPreview(file,{},parsed);assert.match(html,/预览最多 2000 行/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|<script/);
 const table=renderDataPreview(file,{mode:'table'},parsed);assert.equal((table.match(/<th scope="row">/g)||[]).length,200);assert.match(table,/表格显示前 200 行/);
});

test('mismatched column arrays are not padded or joined as observations',()=>{
 const parsed=parseDataDocument({path:'columns.json',content:'{"time":[0,1,2],"temperature":[5,6]}'});
 assert.equal(parsed.datasets.length,2);assert.ok(parsed.datasets.every(d=>d.headers.length===1));
 assert.equal(dataPlot(parsed.datasets[0]).xKey,'$index');
});

test('wide records disclose truncation and literal dotted keys cannot overwrite nested values',()=>{
 const wide=parseDataDocument({path:'wide.json',content:JSON.stringify([Object.fromEntries(Array.from({length:50},(_,i)=>['column'+i,i]))])});
 assert.equal(wide.datasets[0].headers.length,40);assert.equal(wide.datasets[0].truncated,true);
 const parsed=parseDataDocument({path:'fields.json',content:'[{"a.b":1,"a":{"b":2},"q[0]":3,"q":[4,5]}]'});
 const row=parsed.datasets[0].rows[0];assert.equal(row['["a.b"]'],1);assert.equal(row['a.b'],2);assert.equal(row['["q[0]"]'],3);assert.equal(row['q[0]'],4);
});

test('project GeoJSON opens a bounded map, data table and raw source without accepting a false CRS',()=>{
 const map={type:'FeatureCollection',features:[{type:'Feature',properties:{name:'<img src=x onerror=bad>'},geometry:{type:'Polygon',coordinates:[[[0,0],[3,0],[3,3],[0,3],[0,0]],[[1,1],[2,1],[2,2],[1,2],[1,1]]]}}]};
 const file={path:'engineering/geospatial/geospatial_'+'a'.repeat(32)+'/outputs/preview.geojson',content:JSON.stringify(map)};
 assert.equal(documentKind(file),'json');
 const sketch=geoJSONSketch(map);assert.equal(sketch.vertices,10);assert.equal(sketch.features,1);
 const html=renderDocumentViewer({file});assert.match(html,/data-document-tab="map"/);assert.match(html,/fill-rule="evenodd"/);assert.match(html,/EPSG:4326/);assert.match(html,/不计算面积、距离、拓扑/);
 assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
 assert.match(renderDocumentViewer({file,tab:'preview'}),/数据预览/);assert.match(renderDocumentViewer({file,tab:'source'}),/FeatureCollection/);
 const nad83={...map,crs:{type:'name',properties:{name:'EPSG:4269'}}};assert.match(renderGeoJSONMap(nad83),/请先由 GIS 工具完成坐标转换/);
 assert.doesNotMatch(renderGeoJSONMap(nad83),/geojson-polygon/);
 assert.match(renderGeoJSONMap({...map,features:[{...map.features[0],geometry:{type:'Point',coordinates:[999,1]}}]}),/无效经纬度/);
});

test('native 42 trajectory remains a file-derived curve/table with declared axis units, not an invented ground track',()=>{
 const file={path:'engineering/orbit/orbit42_'+'b'.repeat(32)+'/trajectory.csv',content:'time_seconds,x_n_m,y_n_m,z_n_m,vx_n_mps,vy_n_mps,vz_n_mps\n0,7000000,0,0,0,7500,0\n10,6999598,74999,0,-80,7499,0\n'};
 const curve=renderDocumentViewer({file});assert.match(curve,/document-data-chart/);assert.match(curve,/time_seconds/);assert.match(curve,/x_n_m/);assert.doesNotMatch(curve,/ECI|地面覆盖|需求通过/);
 assert.match(renderDocumentViewer({file,dataState:{mode:'table'}}),/<table>/);
});
