import {parseDelimitedData} from './document-viewer.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const timeName=name=>/^time(?:_seconds)?$/i.test(String(name||''));

export function tableFromDelimited(parsed={}){
 const columns=Array.isArray(parsed.headers)?parsed.headers:[];
 const rows=(parsed.rows||[]).map(row=>columns.map(name=>{const value=Number(row?.[name]);return Number.isFinite(value)?value:null;}));
 return {columns,rows,rowCount:rows.length};
}
export function tableFromCsv(content){return tableFromDelimited(parseDelimitedData(String(content||'')));}
export function formatSample(value){
 if(!finite(value))return '—';
 const abs=Math.abs(value);
 if(abs!==0&&(abs>=1e5||abs<1e-3))return value.toExponential(3);
 return String(Number(value.toPrecision(6)));
}
/** A fixed-width clock so playback does not resize the time control. */
export function formatClock(value){
 if(!finite(value))return '—'.padStart(6);
 const abs=Math.abs(value);
 const text=abs!==0&&(abs>=1e4||abs<1e-2)?value.toExponential(1):value.toFixed(1);
 return text.padStart(6);
}

/** Keep the first and last samples, plus the min and max inside each time bucket. */
export function bucketMinMax(samples,bucketCount=24){
 const points=(samples||[]).filter(point=>finite(point?.x)&&finite(point?.y));
 if(points.length<=2)return points;
 const first=points[0],last=points[points.length-1],span=last.x-first.x,buckets=Math.max(1,bucketCount|0);
 const chosen=new Map();
 const add=index=>{if(index>=0&&index<points.length)chosen.set(index,points[index]);};
 add(0);add(points.length-1);
 if(span!==0){
  const groups=Array.from({length:buckets},()=>[]);
  for(let index=0;index<points.length;index++){
   let bucket=Math.floor((points[index].x-first.x)/span*buckets);
   if(bucket>=buckets)bucket=buckets-1;
   if(bucket<0)bucket=0;
   groups[bucket].push(index);
  }
  for(const group of groups){
   if(!group.length)continue;
   let low=group[0],high=group[0];
   for(const index of group){
    if(points[index].y<points[low].y)low=index;
    if(points[index].y>points[high].y)high=index;
   }
   add(low);add(high);
  }
 }
 return [...chosen.keys()].sort((a,b)=>a-b).map(index=>points[index]);
}

function comparisonsOf(receipt){
 const pools=[receipt?.trajectoryComparison,receipt?.runnerReceipt?.trajectoryComparison];
 return pools.flatMap(items=>Array.isArray(items)?items:[]).filter(item=>item&&typeof item.trajectoryColumn==='string');
}

export function signalSummaries(table={}, {checks=[], receipt=null}={}){
 const columns=Array.isArray(table.columns)?table.columns:[],rows=Array.isArray(table.rows)?table.rows:[];
 const timeIndex=columns.findIndex(timeName);
 const comparisons=comparisonsOf(receipt);
 const wholeMatch=receipt?.trajectoryMatchesVerdict??receipt?.runnerReceipt?.trajectoryMatchesVerdict;
 const numeric=[];
 columns.forEach((name,column)=>{
  if(column===timeIndex)return;
  const samples=rows.flatMap((row,index)=>{
   const y=row?.[column],x=timeIndex>=0?row?.[timeIndex]:index;
   return finite(x)&&finite(y)?[{x,y,index}]:[];
  });
  if(samples.length<2)return;
  const first=samples[0],last=samples[samples.length-1];
  let min=first.y,max=first.y;
  for(const sample of samples){if(sample.y<min)min=sample.y;if(sample.y>max)max=sample.y;}
  const related=(checks||[]).filter(check=>check?.variable===name);
  const comparison=comparisons.find(item=>item.trajectoryColumn===name);
  const verdict=comparison?comparison.matches===true?'与 analysis 返回值一致':comparison.matches===false?'与 analysis 返回值有差异':null:null;
  numeric.push({name,samples,spark:bucketMinMax(samples),first:first.y,last:last.y,min,max,delta:last.y-first.y,checks:related,verdict});
 });
 if(numeric.length===1&&numeric[0].verdict==null&&typeof wholeMatch==='boolean')numeric[0].verdict=wholeMatch?'与 analysis 返回值一致':'与 analysis 返回值有差异';
 return {timeIndex,columns,rows,signals:numeric};
}

function ident(value){
 const token=String(value||'').split(/[.:]/).filter(Boolean).at(-1)||'';
 return /^[A-Za-z_]\w*$/.test(token)?token:'';
}

/** Bind a column only when its name, or its last identifier, equals an element name. */
export function matchSignals(columns=[], elements=[]){
 const names=elements.filter(element=>ident(element?.name));
 const bindings=[];
 for(const column of columns){
  if(timeName(column))continue;
  const tail=ident(column);
  const hits=names.filter(element=>element.name===column||ident(element.name)===column||(tail&&ident(element.name)===tail));
  for(const element of hits)bindings.push({column,name:element.name,id:element.id||null,kind:element.kind||'element'});
 }
 return bindings;
}

export function structureFromSource(source=''){
 const text=String(source||''),elements=[],edges=[];
 for(const match of text.matchAll(/\b(part|port|attribute)\s+(?:def\s+)?([A-Za-z_]\w*)/g))elements.push({name:match[2],kind:match[1]});
 for(const match of text.matchAll(/\bconnect\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+to\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/g))edges.push({kind:'connect',source:match[1],target:match[2]});
 for(const match of text.matchAll(/\bflow\s+(?:(?:of\s+)?[A-Za-z_]\w*\s+)?from\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+to\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/g))edges.push({kind:'flow',source:match[1],target:match[2]});
 return {elements,edges};
}

export function elementsFromGraph(graph){
 return (graph?.nodes||[]).filter(node=>node&&(node.label||node.qname)).map(node=>({name:node.label||node.qname,id:node.id,kind:node.kind||node.metaclass||'element'}));
}

export function flowEdgesFromGraph(graph){
 const byId=new Map((graph?.nodes||[]).filter(node=>node?.id).map(node=>[node.id,node]));
 return (graph?.edges||[]).filter(edge=>edge&&(edge.kind==='connect'||edge.kind==='flow')&&byId.has(edge.source)&&byId.has(edge.target)).map(edge=>({kind:edge.kind,source:byId.get(edge.source).label||edge.source,target:byId.get(edge.target).label||edge.target,sourceId:edge.source,targetId:edge.target}));
}

export function recordedBanner(provenance){
 return provenance==='fmu-run'?'留存证据 · 非本次运行':'示例数据';
}
export function signalUnits(units){
 const out={};
 if(!units||typeof units!=='object'||Array.isArray(units))return out;
 for(const [name,unit] of Object.entries(units)){
  if(!/^[A-Za-z_]\w*$/.test(name)||typeof unit!=='string')continue;
  const text=unit.trim();
  if(text&&text.length<=16&&!/[\r\n<>]/.test(text))out[name]=text;
 }
 return out;
}

function sparkline(samples){
 const width=168,height=46,pad=3;
 if(samples.length<2)return '';
 const xs=samples.map(point=>point.x),ys=samples.map(point=>point.y);
 const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
 const sx=x=>pad+(x-x0)/((x1-x0)||1)*(width-pad*2);
 const sy=y=>height-pad-(y-y0)/((y1-y0)||1)*(height-pad*2);
 const line=samples.map(point=>`${sx(point.x).toFixed(1)},${sy(point.y).toFixed(1)}`).join(' ');
 const end=samples[samples.length-1];
 return `<svg class="pm-spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="迷你曲线"><polyline points="${line}"></polyline><circle class="pm-spark-end" cx="${sx(end.x).toFixed(1)}" cy="${sy(end.y).toFixed(1)}" r="2.4"></circle><line class="pm-spark-cursor" x1="${sx(end.x).toFixed(1)}" x2="${sx(end.x).toFixed(1)}" y1="${pad}" y2="${height-pad}"></line></svg>`;
}

function endpoint(ref){
 const parts=String(ref||'').split('.').filter(Boolean);
 return {name:ident(parts.at(-1))||parts.at(-1)||'',owner:ident(parts.length>1?parts.at(-2):parts.at(-1))||parts.at(-1)||''};
}
function edgeColumn(from,to,bindings){
 for(const name of [from.owner,from.name,to.owner,to.name]){
  const hit=bindings.find(item=>item.name===name);
  if(hit)return hit.column;
 }
 return '';
}
function flowDiagram(edges,bindings){
 if(!edges.length)return '<p class="muted">当前模型没有 connect 或 flow 语句，不绘制流向。</p>';
 const order=[];
 const add=name=>{if(name&&!order.includes(name))order.push(name);};
 const ends=edges.map(edge=>({edge,from:endpoint(edge.source),to:endpoint(edge.target)}));
 for(const item of ends){add(item.from.owner);add(item.to.owner);}
 const between=new Map();
 const rails=[];
 for(const item of ends){
  const from=order.indexOf(item.from.owner),to=order.indexOf(item.to.owner);
  if(from<0||to<0||from===to)continue;
  const upper=Math.min(from,to),lower=Math.max(from,to);
  if(lower===upper+1){
   const key=order[upper]+'\0'+order[lower];
   if(!between.has(key))between.set(key,[]);
   between.get(key).push(item);
  }else rails.push(item);
 }
 if(!between.size&&!rails.length)return '<p class="muted">当前模型没有 connect 或 flow 语句，不绘制流向。</p>';
 const nodeW=Math.max(132,...order.map(name=>Math.min(200,name.length*8+36)));
 const nodeH=36;
 const nodeY=new Map();
 let y=16;
 for(let index=0;index<order.length;index++){
  nodeY.set(order[index],y);
  y+=nodeH;
  if(index===order.length-1)continue;
  const count=(between.get(order[index]+'\0'+order[index+1])||[]).length;
  y+=Math.max(40,14+count*16);
 }
 const width=Math.round(16+nodeW+154+(rails.length?28:0));
 const height=Math.round(y+16);
 const center=16+nodeW/2;
 const labelX=16+nodeW+14;
 let edgeIndex=0;
 const shafts=[];
 for(let index=0;index<order.length-1;index++){
  const group=between.get(order[index]+'\0'+order[index+1])||[];
  const yTop=nodeY.get(order[index])+nodeH,yBottom=nodeY.get(order[index+1]);
  group.forEach((item,lane)=>{
   const downward=order.indexOf(item.from.owner)<order.indexOf(item.to.owner);
   const x=center+(lane-(group.length-1)/2)*18;
   const flow=item.edge.kind==='flow';
   const yStart=downward?yTop:yBottom;
   const yEnd=downward?yBottom-2:yTop+2;
   const column=edgeColumn(item.from,item.to,bindings);
   const marker=flow?' marker-end="url(#pm-flow-arrow)"':'';
   const id=edgeIndex++;
   shafts.push(`<path data-flow-edge="${id}" data-flow-kind="${esc(item.edge.kind)}" data-flow-column="${esc(column)}" d="M ${x.toFixed(1)} ${yStart} V ${yEnd}"${marker}></path><text data-flow-label="${id}" data-flow-lane="${lane}" x="${labelX}" y="${yTop+16+lane*16}">${flow?'flow':'connect'} · 未绑定</text>`);
  });
 }
 const rail=rails.map(item=>{
  const y1=nodeY.get(item.from.owner)+nodeH/2,y2=nodeY.get(item.to.owner)+nodeH/2;
  const column=edgeColumn(item.from,item.to,bindings);
  const flow=item.edge.kind==='flow';
  const id=edgeIndex++;
  const x=width-24;
  return `<path data-flow-edge="${id}" data-flow-kind="${esc(item.edge.kind)}" data-flow-column="${esc(column)}" d="M ${nodeW+16} ${y1} H ${x} V ${y2-2}"${flow?' marker-end="url(#pm-flow-arrow)"':''}></path><text data-flow-label="${id}" data-flow-lane="1" x="${labelX}" y="${((y1+y2)/2).toFixed(1)}">${flow?'flow':'connect'} · 未绑定</text>`;
 }).join('');
 const nodes=order.map(name=>`<g class="pm-flow-node" data-flow-node="${esc(name)}" transform="translate(16 ${nodeY.get(name)})"><rect width="${nodeW}" height="${nodeH}" rx="8"></rect><text x="${nodeW/2}" y="23">${esc(name)}</text></g>`).join('');
 return `<div class="pm-flow-frame"><svg class="pm-flow" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="信号与连接流向"><defs><marker id="pm-flow-arrow" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M1 1 L9 5 L1 9 Z"></path></marker></defs>${shafts.join('')}${rail}${nodes}</svg></div>`;
}

export function stageInput(ui={}){
 if(ui.recordedView?.table?.rows?.length)return {recorded:true,provenance:ui.recordedView.provenance==='fmu-run'?'fmu-run':'example',note:ui.recordedView.note||'',units:signalUnits(ui.recordedView.units),table:ui.recordedView.table,checks:ui.recordedView.checks||[],receipt:ui.recordedView.receipt||null,source:ui.draft||ui.model?.content||'',graph:ui.semanticGraph||null};
 if(ui.result?.integrity?.verified===true&&ui.result.table?.rows?.length)return {recorded:false,table:ui.result.table,checks:ui.result.verification?.checks||[],receipt:ui.result.receipt||null,source:ui.draft||ui.model?.content||'',graph:ui.semanticGraph||null};
 return null;
}

export function renderSimulationStage(input){
 if(!input?.table?.rows?.length)return '';
 const summary=signalSummaries(input.table,{checks:input.checks,receipt:input.receipt});
 const structure=structureFromSource(input.source);
 const graphEdges=flowEdgesFromGraph(input.graph);
 const edges=graphEdges.length?graphEdges:structure.edges;
 const elements=structure.elements.concat(elementsFromGraph(input.graph));
 const bindings=matchSignals(summary.signals.map(signal=>signal.name),elements);
 const banner=input.recorded?`<p class="pm-recorded" data-recorded-provenance="${esc(input.provenance)}">${esc(recordedBanner(input.provenance))}${input.provenance==='fmu-run'&&input.note?` · ${esc(input.note)}`:''}</p>`:'';
 const units=signalUnits(input.units);
 const cards=summary.signals.map(signal=>{
  const status=signal.checks.length?signal.checks.map(check=>check.passed===true?'通过':check.passed===false?'未通过':'未判定').join('、'):'';
  const unit=units[signal.name]||'';
  const figure=(value,live)=>`<dd>${live?`<span data-signal-now="${esc(signal.name)}">${esc(formatSample(value))}</span>`:esc(formatSample(value))}${unit?`<span class="pm-signal-unit">${esc(unit)}</span>`:''}</dd>`;
  return `<article class="pm-signal-card" data-signal="${esc(signal.name)}"><header><strong>${esc(signal.name)}</strong>${unit?`<span class="pm-signal-unit">${esc(unit)}</span>`:''}${status?`<span class="pm-signal-status" data-status="${esc(status)}">${esc(status)}</span>`:''}</header>${sparkline(signal.spark)}<dl><div><dt>当前</dt>${figure(signal.last,true)}</div><div><dt>终值</dt>${figure(signal.last)}</div><div><dt>最小</dt>${figure(signal.min)}</div><div><dt>最大</dt>${figure(signal.max)}</div><div><dt>变化</dt>${figure(signal.delta)}</div></dl>${signal.verdict?`<p class="pm-verdict">${esc(signal.verdict)}</p>`:''}</article>`;
 }).join('');
 const last=Math.max(0,summary.rows.length-1);
 return `<section class="pm-stage" data-pm-stage>${banner}<div class="pm-stage-heading"><h3>${input.recorded?'记录轨迹':'结果总览'}</h3><span>${summary.rows.length} 行采样 · ${summary.signals.length} 个数值信号</span></div>${cards?`<div class="pm-signal-grid">${cards}</div>`:'<p class="muted">这条轨迹没有两个以上的数值采样，不绘制曲线。</p>'}<div class="pm-transport"><button type="button" class="button compact" data-pm-action="play">${input.playing?'暂停':'播放'}</button><div class="pm-time"><span class="pm-time-name">时间</span><input data-pm-sample type="range" min="0" max="${last}" value="${Math.min(last,Math.max(0,input.sampleIndex??last))}" aria-label="轨迹时间"><output data-pm-sample-label></output><span class="pm-time-unit" data-pm-sample-unit>s</span></div></div><div class="pm-stage-split"><div><h3>结构</h3><div data-pm-structure></div></div><div><h3>流向</h3>${flowDiagram(edges,bindings)}</div></div><div class="pm-physical-block"><h3>实物</h3><div class="pm-physical-stage"><div data-pm-physical></div><p class="pm-scene-readout" data-pm-scene-readout></p></div><div data-pm-geometry></div></div></section>`;
}

function columnValue(summary,name,index){
 const column=summary.columns.indexOf(name);
 const row=summary.rows[index];
 return column<0||!row?null:row[column];
}

export function applySimulationFrame(root,input,{preview}={}){
 if(!root||!input?.table)return;
 const summary=signalSummaries(input.table,{checks:input.checks,receipt:input.receipt});
 const index=Math.min(summary.rows.length-1,Math.max(0,input.sampleIndex??summary.rows.length-1));
 const row=summary.rows[index]||[];
 const time=summary.timeIndex>=0?row[summary.timeIndex]:index;
 const label=root.querySelector('[data-pm-sample-label]');
 const unit=root.querySelector('[data-pm-sample-unit]');
 if(label)label.textContent=summary.timeIndex>=0?formatClock(time):String(index).padStart(6);
 if(unit)unit.textContent=summary.timeIndex>=0?'s':'';
 const structure=structureFromSource(input.source);
 const bindings=matchSignals(summary.signals.map(signal=>signal.name),structure.elements.concat(elementsFromGraph(input.graph)));
 for(const signal of summary.signals){
  const now=root.querySelector(`[data-signal-now="${CSS.escape(signal.name)}"]`);
  if(now)now.textContent=formatSample(columnValue(summary,signal.name,index));
  const spark=root.querySelector(`[data-signal="${CSS.escape(signal.name)}"] .pm-spark`);
  const cursor=spark?.querySelector('.pm-spark-cursor');
  if(cursor&&signal.spark.length){
   const xs=signal.spark.map(point=>point.x),x0=Math.min(...xs),x1=Math.max(...xs),sample=[...signal.samples].reverse().find(item=>item.index<=index)||signal.samples[0];
   const px=3+(sample.x-x0)/((x1-x0)||1)*162;
   cursor.setAttribute('x1',px.toFixed(1));cursor.setAttribute('x2',px.toFixed(1));
  }
 }
 const levels=new Map();
 for(const binding of bindings){
  const signal=summary.signals.find(item=>item.name===binding.column);
  if(!signal)continue;
  const value=columnValue(summary,binding.column,index);
  const span=signal.max-signal.min;
  levels.set(binding.name,span?Math.min(1,Math.max(0,(value-signal.min)/span)):0.5);
  if(binding.id)levels.set(binding.id,levels.get(binding.name));
 }
 root.querySelectorAll('.semantic-node').forEach(node=>{
  const names=[...node.querySelectorAll('.semantic-label')].flatMap(item=>{
   const raw=item.textContent.trim();
   const declared=raw.split(/\s*:/)[0].trim();
   return [raw,declared,ident(raw),ident(declared)];
  });
  const level=names.map(name=>levels.get(name)).find(value=>value!=null);
  node.classList.toggle('is-signaled',level!=null);
  if(level!=null)node.style.setProperty('--level',String(level));else node.style.removeProperty('--level');
 });
 root.querySelectorAll('.pm-flow-node').forEach(node=>{
  const level=levels.get(node.dataset.flowNode);
  node.classList.toggle('is-signaled',level!=null);
  if(level!=null)node.style.setProperty('--level',String(level));
 });
 root.querySelectorAll('[data-flow-edge]').forEach(edge=>{
  const column=edge.dataset.flowColumn;
  const signal=summary.signals.find(item=>item.name===column);
  const value=signal?columnValue(summary,column,index):null;
  const scale=signal&&finite(value)?Math.min(1,Math.abs(value)/Math.max(Math.abs(signal.min),Math.abs(signal.max),1e-9)):0;
  edge.setAttribute('stroke-width',signal? (1.4+scale*4.6).toFixed(2):'1.4');
  const text=root.querySelector(`[data-flow-label="${edge.dataset.flowEdge}"]`);
  if(text)text.textContent=`${edge.dataset.flowKind==='flow'?'flow':'connect'} · ${signal&&finite(value)?formatSample(value):'未绑定'}`;
 });
 const emphasis=[];
 const seenParts=new Set();
 for(const binding of bindings){
  if(!levels.has(binding.name)||seenParts.has(binding.name))continue;
  seenParts.add(binding.name);
  const value=columnValue(summary,binding.column,index);
  const part=input.parts?.find(item=>item.label===binding.name||ident(item.label)===binding.name||item.label?.split('/').at(-1)===binding.name||item.path?.endsWith('/'+binding.name));
  const unit=signalUnits(input.units)[binding.column]||'';
  emphasis.push({id:part?.id,level:levels.get(binding.name),name:binding.name,value,unit,drive:binding.name==='motor'||binding.column==='motor'});
 }
 preview?.emphasize?.(emphasis.filter(item=>item.id));
 const readout=root.querySelector('[data-pm-scene-readout]');
 if(readout)readout.innerHTML=emphasis.slice(0,4).map(item=>`<span style="--level:${item.level}"><b>${esc(item.name)}</b><em>${esc(formatSample(item.value))}</em>${item.unit?`<i>${esc(item.unit)}</i>`:''}</span>`).join('');
}
