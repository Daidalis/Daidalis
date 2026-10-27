import {Marked, Renderer} from './vendor/marked/marked.esm.js';
import {isGeoJSON,renderGeoJSONMap} from './geojson-viewer.mjs';

// All document text is untrusted. Markdown HTML is escaped, and only our own
// renderer may introduce links or images. No document scripts/SVG/HTML execute.
const MAX_TEXT = 2_000_000;
const MAX_GRAPH = 1200;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text = value => String(value ?? '').slice(0, MAX_TEXT);
const label = value => String(value ?? '').slice(0, 240);
const attr = esc;
const basename = value => String(value || '').split('/').pop();

export function resolveDocumentLink(href, sourcePath = '') {
  if (typeof href !== 'string' || !href.trim() || /[\u0000-\u001f\u007f]/.test(href)) return null;
  const value = href.trim();
  if (/^#[^\s]*$/.test(value)) return {kind:'anchor', href:value};
  if (/^https?:\/\//i.test(value)) {
    try { const url = new URL(value); return !url.username && !url.password ? {kind:'external', href:url.href} : null; } catch { return null; }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//') || value.includes('\\')) return null;
  // Decode before traversal checking; route builders must encode the resulting
  // path as a parameter rather than interpreting it as another URL.
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { return null; }
  if (/^[a-z][a-z\d+.-]*:/i.test(decoded) || /[\u0000-\u001f\u007f\\]/.test(decoded) || decoded.startsWith('//')) return null;
  const hashIndex = decoded.indexOf('#'), hash = hashIndex >= 0 ? decoded.slice(hashIndex) : '';
  const file = (hashIndex >= 0 ? decoded.slice(0, hashIndex) : decoded).split('?')[0];
  const absolute = file.startsWith('/');
  const parts = absolute ? [] : String(sourcePath).split('/').slice(0, -1).filter(Boolean);
  for (const part of file.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else parts.push(part);
  }
  if (!parts.length) return null;
  const match = /^#L?(\d+)(?::\d+)?$/.exec(hash);
  return {kind:'path', path:(absolute ? '/' : '') + parts.join('/'), ...(match ? {line:Number(match[1])} : {}), ...(hash ? {hash} : {})};
}

function linkAttributes(link) {
  if (!link) return null;
  if (link.kind === 'path') return `href="#" data-document-path="${attr(link.path)}"${link.line ? ` data-document-line="${link.line}"` : ''}`;
  if (link.kind === 'anchor') return `href="${attr(link.href)}" data-document-anchor="${attr(link.href)}"`;
  return `href="${attr(link.href)}" data-document-external="${attr(link.href)}" target="_blank" rel="noopener noreferrer"`;
}

function projectRasterURL(path, resolveImage) {
  if (typeof resolveImage !== 'function' || !/\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(path || '')) return null;
  const candidate = resolveImage(path);
  return typeof candidate === 'string' && /^\/api\//.test(candidate) && !/[\u0000-\u0020\\]/.test(candidate) ? candidate : null;
}

export function renderMarkdown(content, {path = '', resolveImage} = {}) {
  const renderer = new Renderer();
  renderer.html = token => esc(token.text);
  renderer.link = function(token) {
    const body = this.parser.parseInline(token.tokens);
    const attributes = linkAttributes(resolveDocumentLink(token.href, path));
    return attributes ? `<a ${attributes}${token.title ? ` title="${attr(token.title)}"` : ''}>${body}</a>` : body;
  };
  renderer.image = token => {
    const link = resolveDocumentLink(token.href, path), alt = token.text || basename(token.href);
    let imageURL;
    if (link?.kind === 'path' && typeof resolveImage === 'function') {
      // Only Manta-controlled image routes. SVG/HTML and network images are
      // opened explicitly via the document controller instead of embedded.
      imageURL = projectRasterURL(link.path,resolveImage);
    }
    if (imageURL) return `<figure class="document-image"><a ${linkAttributes(link)}><img src="${attr(imageURL)}" alt="${attr(alt)}" loading="lazy"></a>${alt ? `<figcaption>${esc(alt)}</figcaption>` : ''}</figure>`;
    const attributes = linkAttributes(link);
    return attributes ? `<a class="document-image-link" ${attributes}>▧ ${esc(alt || '查看图片')}</a>` : esc(alt);
  };
  renderer.code = token => `<pre><code${/^[a-z\d_+-]{1,32}$/i.test(token.lang || '') ? ` class="language-${attr(token.lang)}"` : ''}>${esc(token.text)}</code></pre>\n`;
  const parser = new Marked({renderer, gfm:true, breaks:false, async:false});
  const source = text(content);
  try { return parser.parse(source); } catch { return `<pre>${esc(source)}</pre>`; }
}

export function documentKind(file = {}) {
  const path = file.path || file.name || '', mime = file.mime || file.mimeType || file.type || '';
  if (file.type === 'image' || /^image\//i.test(mime) || /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(path)) return 'image';
  if (file.previewable === false || file.encoding === 'base64' || file.type === 'binary') return 'unsupported';
  if (/\.(sysml|kerml)$/i.test(path)) return 'sysml';
  if (/\.(md|markdown)$/i.test(path) || /markdown/i.test(mime)) return 'markdown';
  if (/\.(jsonl|ndjson)$/i.test(path) || /ndjson/i.test(mime)) return 'jsonl';
  if (/\.(csv|tsv)$/i.test(path) || /(?:csv|tab-separated)/i.test(mime)) return 'csv';
  if (/\.(json|geojson)$/i.test(path) || /json/i.test(mime)) return 'json';
  return 'text';
}

// Generic data previews describe the file as supplied. They never infer a solver,
// verification outcome or physical unit, and never turn summaries into telemetry.
const DATA_ROWS = 2000, DATA_COLUMNS = 40, DATA_TABLE_ROWS = 200;
const DATA_ROW_LIMIT = Symbol('limited data row');
const dataNumber = value => typeof value === 'number' && Number.isFinite(value);
const dataScalar = value => value == null || ['string','number','boolean'].includes(typeof value);
const dataObject = value => value && typeof value === 'object' && !Array.isArray(value);
const dataFormat = value => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);

export function parseDelimitedData(content, delimiter = ',') {
  const input = String(content || '').replace(/^\uFEFF/,''), records = [];
  let row = [], value = '', quoted = false, afterQuote = false;
  const cell = () => {row.push(value);value = '';afterQuote = false;};
  const record = () => {cell();if(row.some(v => v !== ''))records.push(row);row = [];};
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {if(char === '"'){if(input[i + 1] === '"'){value += '"';i++;}else{quoted = false;afterQuote = true;}}else value += char;continue;}
    if (char === '"') {if(value || afterQuote)throw Error('引号位置不正确');quoted = true;}
    else if (char === delimiter) cell();
    else if (char === '\n' || char === '\r') {if(char === '\r' && input[i + 1] === '\n')i++;record();}
    else {if(afterQuote)throw Error('引号后的字段分隔符不正确');value += char;}
  }
  if(quoted)throw Error('存在未闭合的引号');
  if(value || row.length || afterQuote)record();
  if(!records.length)return {headers:[],rows:[],rowCount:0,truncated:false};
  const header = records.shift(), used = new Set();
  const headers = header.slice(0,DATA_COLUMNS).map((h,i) => {const title=h.trim() || '列 ' + (i + 1);let next=title,n=2;while(used.has(next))next=title+' ('+(n++)+')';used.add(next);return next;});
  if(records.some(r=>r.length!==header.length))throw Error('部分行的列数与表头不一致，请查看原始数据');
  const parse = value => {
    if(!value.trim())return null;
    // Preserve opaque identifiers and integers that would lose precision.
    if(!/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value.trim()))return value;
    const number=Number(value);return Number.isFinite(number) && (!Number.isInteger(number)||Number.isSafeInteger(number)) ? number : value;
  };
  return {headers,rows:records.slice(0,DATA_ROWS).map(record => Object.fromEntries(headers.map((h,i)=>[h,parse(record[i])]))),rowCount:records.length,truncated:records.length>DATA_ROWS||header.length>DATA_COLUMNS};
}

function flattenDataRow(record) {
  const row=Object.create(null);
  function visit(value,prefix,depth) {
    if(Object.keys(row).length>=DATA_COLUMNS){row[DATA_ROW_LIMIT]=true;return;}
    if(dataScalar(value)){row[prefix || 'value']=value;return;}
    if(depth<3 && dataObject(value)){for(const [key,child] of Object.entries(value)){const quoted=/[.\[\]]/.test(key);visit(child,quoted?prefix+'['+JSON.stringify(key)+']':prefix ? prefix+'.'+key : key,depth+1);}return;}
    if(depth<3 && Array.isArray(value) && value.length>0 && value.length<=8 && value.every(dataScalar)){value.forEach((child,i)=>visit(child,prefix+'['+i+']',depth+1));return;}
    row[prefix || 'value']=value;
  }
  visit(record,'',0);return row;
}

export function parseDataDocument(file = {}) {
  const kind=documentKind(file), source=String(file.content || ''), datasets=[];
  if(source.length>MAX_TEXT)return {datasets,error:'数据超过预览大小上限，请缩小文件后重试。'};
  let value;
  try {
    if(kind==='csv') {
      const delimiter=/\.tsv$/i.test(file.path || file.name || '') || /tab-separated/i.test(file.mime || '') ? '\t' : ',';
      const parsed=parseDelimitedData(source,delimiter);
      return {datasets:parsed.headers.length?[{id:'$',label:'数据表',...parsed}]:[],root:null,kind};
    }
    value=kind==='jsonl'?source.split(/\r?\n/).filter(line=>line.trim()).map((line,index)=>{try{return JSON.parse(line);}catch{throw Error('第 '+(index+1)+' 条记录不是有效 JSON');}}):JSON.parse(source);
  } catch(error) {return {datasets,kind,error:kind==='csv'?'无法解析表格：'+error.message:'无法解析 JSON 数据：'+error.message};}
  let visited=0;
  function add(id,label,records,rowCount=records.length,truncated=false) {
    if(datasets.length>=24)return;
    const rows=records.slice(0,DATA_ROWS).map(flattenDataRow),headers=[...new Set(rows.flatMap(row=>Object.keys(row)))].slice(0,DATA_COLUMNS);
    if(headers.length)datasets.push({id,label,headers,rows,rowCount,truncated:truncated||rowCount>DATA_ROWS||rows.some(row=>row[DATA_ROW_LIMIT]||Object.keys(row).length>headers.length)});
  }
  function visit(item,path,depth) {
    if(++visited>5000 || depth>6 || datasets.length>=24)return;
    if(Array.isArray(item)) {
      if(item.length && item.every(dataObject))add(path,path==='$'?'记录':path,item);
      else if(item.length && item.every(dataScalar))add(path,path==='$'?'数值':path,item.map(value=>({value})));
      else if(item.length && item.every(Array.isArray) && item[0].every(v=>typeof v==='string') && item.slice(1).every(row=>row.length===item[0].length)) {
        const seen=new Set(),headers=item[0].slice(0,DATA_COLUMNS).map((v,i)=>{let name=v||'列 '+(i+1);while(seen.has(name))name+=' ('+(i+1)+')';seen.add(name);return name;});
        add(path,path,item.slice(1).map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i]]))));
      }
      // Nested tables inside records remain accessible, with a hard traversal bound.
      item.slice(0,50).forEach((child,index)=>{if(dataObject(child))for(const [key,next] of Object.entries(child))if(next&&typeof next==='object')visit(next,path+'['+index+'].'+key,depth+1);});
    } else if(dataObject(item)) {
      const columns=Object.entries(item).filter(([,values])=>Array.isArray(values)&&values.length>0&&values.every(dataScalar));
      if(columns.length>=2 && columns.every(([,values])=>values.length===columns[0][1].length)) {
        const count=columns[0][1].length;
        add(path,path==='$'?'数值序列':path,Array.from({length:Math.min(count,DATA_ROWS)},(_,index)=>Object.fromEntries(columns.slice(0,DATA_COLUMNS).map(([key,values])=>[key,values[index]]))),count,columns.length>DATA_COLUMNS);
        // Do not generate separate one-column duplicates of a columnar table.
        const claimed=new Set(columns.map(([key])=>key));for(const [key,child] of Object.entries(item))if(!claimed.has(key)&&child&&typeof child==='object')visit(child,path+'.'+key,depth+1);
      } else for(const [key,child] of Object.entries(item))if(child&&typeof child==='object')visit(child,path+'.'+key,depth+1);
    }
  }
  visit(value,'$',0);
  return {datasets,root:value,kind,limited:visited>5000||datasets.length>=24};
}

export function dataPlot(dataset, state = {}) {
  const columns=dataset?.headers?.filter(key=>dataset.rows.some(row=>dataNumber(row[key]))) || [];
  const xKey=state.xKey==='$index'?'$index':columns.includes(state.xKey)?state.xKey:columns.find(key=>/^(time|t|timestamp)(?:$|_|\[|\()/i.test(key)) || '$index';
  const yKey=columns.includes(state.yKey)&&state.yKey!==xKey?state.yKey:columns.find(key=>key!==xKey);
  const points=(dataset?.rows || []).map((row,index)=>({index,x:xKey==='$index'?index:row[xKey],y:row[yKey]})).filter(point=>dataNumber(point.x)&&dataNumber(point.y));
  const domain=key=>{if(!points.length)return [0,1];let lo=Math.min(...points.map(p=>p[key])),hi=Math.max(...points.map(p=>p[key]));if(lo===hi){const margin=Math.abs(lo)*.01 || 1;lo-=margin;hi+=margin;}return [lo,hi];};
  return {columns,xKey,yKey,points,xDomain:domain('x'),yDomain:domain('y'),omitted:(dataset?.rows.length || 0)-points.length};
}
function selectedDataSet(parsed,state={}) {return parsed.datasets.find(d=>d.id===state.datasetId)||parsed.datasets.find(d=>{const plot=dataPlot(d);return plot.xKey!=='$index'&&plot.points.length>=2;})||parsed.datasets.find(d=>dataPlot(d).points.length>=2)||parsed.datasets[0];}
const DATA_PLOT={width:800,height:320,left:86,right:26,top:20,bottom:55};
function dataScales(plot){const p=DATA_PLOT;return {x:value=>p.left+(value-plot.xDomain[0])/(plot.xDomain[1]-plot.xDomain[0])*(p.width-p.left-p.right),y:value=>p.height-p.bottom-(value-plot.yDomain[0])/(plot.yDomain[1]-plot.yDomain[0])*(p.height-p.top-p.bottom)};}
function axisNumber(value){return Number.isFinite(value)?Number(value.toPrecision(6)).toString():'—';}
function renderDataPlot(plot) {
  const {width,height,left,right,bottom}=DATA_PLOT,{x,y}=dataScales(plot);let grid='';
  for(let i=0;i<5;i++){const vx=plot.xDomain[0]+(plot.xDomain[1]-plot.xDomain[0])*i/4,vy=plot.yDomain[0]+(plot.yDomain[1]-plot.yDomain[0])*i/4;grid+=`<line x1="${left}" x2="${width-right}" y1="${y(vy)}" y2="${y(vy)}"/><text x="${left-10}" y="${y(vy)+4}" text-anchor="end">${esc(axisNumber(vy))}</text><text x="${x(vx)}" y="${height-bottom+22}" text-anchor="middle">${esc(axisNumber(vx))}</text>`;}
  return `<svg class="document-data-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(plot.yKey)} 对 ${esc(plot.xKey==='$index'?'记录序号':plot.xKey)} 的数据散点图"><g class="document-data-axes">${grid}<text x="${(width+left-right)/2}" y="${height-8}" text-anchor="middle">${esc(plot.xKey==='$index'?'记录序号（从 0 开始）':plot.xKey)}</text></g><g class="document-data-points">${plot.points.map((p,i)=>`<circle cx="${x(p.x).toFixed(2)}" cy="${y(p.y).toFixed(2)}" r="3" data-data-point="${i}"><title>${esc(plot.yKey)} = ${esc(p.y)} · ${esc(plot.xKey==='$index'?'记录序号':plot.xKey)} = ${esc(p.x)}</title></circle>`).join('')}</g></svg>`;
}
function renderDataSummary(value) {
  let remaining=250;
  function rows(item,depth) {
    if(remaining--<=0)return '<span class="document-data-muted">更多字段见原始数据</span>';
    if(dataScalar(item))return `<span class="document-data-value">${esc(dataFormat(item))}</span>`;
    if(Array.isArray(item))return `<span class="document-data-muted">${item.length} 条记录</span>`;
    if(depth>5)return '<span class="document-data-muted">嵌套对象 · 见原始数据</span>';
    return `<dl class="document-data-fields">${Object.entries(item).slice(0,Math.max(0,remaining)).map(([key,child])=>`<div><dt>${esc(key)}</dt><dd>${dataObject(child)?`<details ${depth===0?'open':''}><summary>${Object.keys(child).length} 个字段</summary>${rows(child,depth+1)}</details>`:rows(child,depth+1)}</dd></div>`).join('')}</dl>`;
  }
  return value==null?'':`<details class="document-data-summary" open><summary>文件字段</summary>${rows(value,0)}</details>`;
}
export function renderDataPreview(file = {}, state = {}, parsed = parseDataDocument(file)) {
  if(parsed.error)return `<div class="document-empty" role="alert">${esc(parsed.error)}<p>可切换到原始数据检查文件内容。</p></div>`;
  const dataset=selectedDataSet(parsed,state),plot=dataPlot(dataset,state);
  const mode=state.mode==='table'?'table':state.mode==='plot'?'plot':plot.points.length>=2?'plot':'table';
  const rowLimit=Math.min(dataset?.rows.length||0,DATA_TABLE_ROWS);
  return `<section class="document-data-preview" aria-label="数据预览">${dataset?`<div class="document-data-toolbar"><label>数据集<select data-document-data="dataset" aria-label="数据集">${parsed.datasets.map(d=>`<option value="${esc(d.id)}" ${d.id===dataset.id?'selected':''}>${esc(d.label)} · ${d.rowCount} 条</option>`).join('')}</select></label><div class="document-data-modes"><button type="button" data-document-data="plot" aria-pressed="${mode==='plot'}" ${!plot.columns.length?'disabled':''}>图表</button><button type="button" data-document-data="table" aria-pressed="${mode==='table'}">表格</button></div></div>${mode==='plot'?`<div class="document-data-axes-select"><label>横轴<select data-document-data="x" aria-label="数据横轴"><option value="$index" ${plot.xKey==='$index'?'selected':''}>记录序号</option>${plot.columns.map(key=>`<option value="${esc(key)}" ${key===plot.xKey?'selected':''}>${esc(key)}</option>`).join('')}</select></label><label>纵轴<select data-document-data="y" aria-label="数据纵轴">${plot.columns.filter(k=>k!==plot.xKey).map(key=>`<option value="${esc(key)}" ${key===plot.yKey?'selected':''}>${esc(key)}</option>`).join('')}</select></label></div>${plot.points.length>=2?renderDataPlot(plot):'<p class="document-data-note">所选字段少于两个有效数值点，无法绘图。</p>'}<p class="document-data-tooltip" role="status">移到数据点查看原始数值。</p><p class="document-data-note">按文件中的数值绘制散点，不插值。单位以字段名或文件说明为准；未声明时单位未知。${plot.omitted?' '+plot.omitted+' 行缺少所选数值，未绘制。':''}</p>`:`<div class="document-data-table-scroll"><table><thead><tr><th>#</th>${dataset.headers.map(key=>`<th>${esc(key)}</th>`).join('')}</tr></thead><tbody>${dataset.rows.slice(0,rowLimit).map((row,index)=>`<tr><th scope="row">${index+1}</th>${dataset.headers.map(key=>`<td>${esc(dataFormat(row[key]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${dataset.rows.length>rowLimit?`<p class="document-data-note">表格显示前 ${rowLimit} 行，完整内容见原始数据。</p>`:''}`}<p class="document-data-count">${dataset.rowCount} 条记录 · ${dataset.headers.length} 列${dataset.truncated?' · 预览最多 '+DATA_ROWS+' 行、'+DATA_COLUMNS+' 列，完整内容见原始数据':''}</p>`:'<p class="document-data-note">此文件包含字段信息，没有可绘制的数值序列。</p>'}${renderDataSummary(parsed.root)}${parsed.limited?'<p class="document-data-note">数据集数量或嵌套深度达到预览上限，完整内容见原始数据。</p>':''}</section>`;
}

function rawGraph(model) {
  let graph = model?.data?.graph || model?.data || model?.graph || model;
  if (graph?.graph) graph = graph.graph;
  return graph && Array.isArray(graph.nodes) && Array.isArray(graph.edges) ? graph : null;
}

export function normalizeSemanticGraph(model, {path = ''} = {}) {
  const raw = rawGraph(model);
  if (!raw) return {nodes:[], rows:[], edges:[], truncated:false};
  const nodes = [], rows = [], ids = new Set();
  for (const item of raw.nodes.slice(0, MAX_GRAPH)) {
    if (!item || typeof item.id !== 'string' || ids.has(item.id)) continue;
    ids.add(item.id);
    const node = {id:item.id, kind:label(item.kind || 'node'), label:label(item.label || item.qname || item.id), fullLabel:text(item.label), metaclass:label(item.metaclass || item.stereo || 'Element'), stereo:label(item.stereo || item.metaclass || 'element'), nodeKind:label(item.nodeKind), parent:typeof item.parent === 'string' ? item.parent : null, qname:label(item.qname || item.label), file:item.file || path, line:Number.isInteger(item.line) && item.line > 0 ? item.line : null, col:Number.isInteger(item.col) && item.col > 0 ? item.col : null, rows:[]};
    for (const member of (Array.isArray(item.rows) ? item.rows : []).slice(0, 200)) {
      if (typeof member?.id !== 'string') continue;
      const row = {id:member.id, label:label(member.label), fullLabel:text(member.label), qname:label(member.qname), metaclass:label(member.section || 'member'), stereo:label(member.section || 'member'), parent:node.id, file:member.file || node.file, line:Number.isInteger(member.line) && member.line > 0 ? member.line : null, col:member.col || null, member:true};
      node.rows.push(row); rows.push(row);
    }
    nodes.push(node);
  }
  const edges = raw.edges.slice(0, MAX_GRAPH * 4).filter(edge => edge && ids.has(edge.source) && ids.has(edge.target)).map(edge => ({source:edge.source,target:edge.target,kind:label(edge.kind || 'relationship'),composite:edge.composite}));
  return {nodes, rows, edges, truncated:raw.nodes.length > MAX_GRAPH, source:'SysML semantic backend'};
}

const structural = node => /Part|Port|Interface|Connection|Flow|Item|Action|State|Transition/i.test(node.metaclass);
const requirement = node => /Requirement|Constraint|Verification|Analysis|Case|Satisf/i.test(node.metaclass);
const classes = node => node.kind === 'package' ? 'package' : /Requirement/i.test(node.metaclass) ? 'requirement' : /Constraint/i.test(node.metaclass) ? 'constraint' : /Port|Interface/i.test(node.metaclass) ? 'port' : node.kind === 'note' ? 'note' : 'part';

function visibleGraph(graph, filter) {
  let nodes = graph.nodes.filter(node => node.kind !== 'package' && node.kind !== 'note' && (filter === 'all' || (filter === 'requirements' ? requirement(node) : structural(node))));
  if (!nodes.length && filter === 'structure') nodes = graph.nodes.filter(node => node.kind !== 'note' && node.kind !== 'package');
  const ids = new Set(nodes.map(node => node.id));
  return {nodes,edges:graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target))};
}

// Layer layout uses only semantic edges. Ownership in the outline is separate;
// no hand-written Manta trace relation is synthesized into this graph.
export function layoutSemanticGraph(nodes, edges) {
  const byId = new Map(nodes.map(node => [node.id,node])), incoming = new Map(nodes.map(node => [node.id,0])), outgoing = new Map(nodes.map(node => [node.id,[]]));
  for (const edge of edges) {
    if (edge.source === edge.target || !byId.has(edge.source) || !byId.has(edge.target)) continue;
    incoming.set(edge.target,incoming.get(edge.target) + 1); outgoing.get(edge.source).push(edge.target);
  }
  const rank = new Map(nodes.map(node => [node.id,0])), queue = nodes.filter(node => !incoming.get(node.id)).map(node => node.id);
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    for (const next of outgoing.get(id)) { rank.set(next,Math.min(7,Math.max(rank.get(next),rank.get(id) + 1))); incoming.set(next,incoming.get(next) - 1); if (!incoming.get(next)) queue.push(next); }
  }
  const layers = new Map();
  for (const node of nodes) { const level = rank.get(node.id); if (!layers.has(level)) layers.set(level,[]); layers.get(level).push(node); }
  const positioned = [], columnWidth = 304, rowHeight = 112;
  for (const [level, layer] of layers) for (const [index,node] of layer.entries()) positioned.push({...node,x:40 + level * columnWidth,y:34 + index * rowHeight,width:258,height:82});
  return {nodes:positioned,width:Math.max(560,...positioned.map(node => node.x + node.width + 40)),height:Math.max(360,...positioned.map(node => node.y + node.height + 34))};
}

// Opening a wide model should preserve readable labels; full-diagram fitting is
// an explicit action. Keep one SVG unit at least one CSS pixel in the initial view.
export function initialSemanticViewport(diagram, viewport) {
  const {width, height} = viewport;
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) return {...diagram};
  const scale = Math.max(1,Math.min(width / diagram.w,height / diagram.h));
  const w = width / scale, h = height / scale;
  return {x:w < diagram.w ? Math.min(20,diagram.w - w) : (diagram.w - w) / 2,
    y:h < diagram.h ? Math.min(14,diagram.h - h) : (diagram.h - h) / 2,w,h};
}

function wrapLabel(value, width = 28) {
  const source = String(value || ''), clip = part => part.length > width + 5 ? part.slice(0,width + 4) + '…' : part;
  if (source.length <= width + 3) return [source];
  const colon = source.indexOf(' : ');
  if (colon > 0 && colon < width) return [clip(source.slice(0,colon + 2)),clip(source.slice(colon + 3))];
  const space = source.lastIndexOf(' ',width);
  if (space > width / 3) return [source.slice(0,space),clip(source.slice(space + 1))];
  return [clip(source)];
}

function renderDiagram(graph, filter) {
  const visible = visibleGraph(graph, filter), layout = layoutSemanticGraph(visible.nodes,visible.edges), position = new Map(layout.nodes.map(node => [node.id,node]));
  if (!visible.nodes.length) return '<div class="document-empty">当前视图没有可展示的语义元素。可以查看大纲或源码。</div>';
  const edges = visible.edges.map(edge => {
    const source = position.get(edge.source), target = position.get(edge.target), x1 = source.x + source.width, y1 = source.y + source.height / 2, x2 = target.x, y2 = target.y + target.height / 2;
    const bend = Math.max(45,Math.abs(x2 - x1) * .5);
    return `<g class="semantic-edge semantic-edge-${attr(edge.kind.replace(/[^a-z-]/gi,''))}" data-edge-source="${attr(edge.source)}" data-edge-target="${attr(edge.target)}"><path d="M ${x1} ${y1} C ${x1 + bend} ${y1},${x2 - bend} ${y2},${x2} ${y2}" marker-end="url(#document-arrow)"></path><text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}">${esc(edge.kind)}</text><title>${esc(source.label)} — ${esc(edge.kind)} → ${esc(target.label)}</title></g>`;
  }).join('');
  const cards = layout.nodes.map(node => `<g role="button" tabindex="0" aria-label="${attr(node.stereo + ' ' + node.label)}" class="semantic-node semantic-${classes(node)}" data-document-element="${attr(node.id)}" transform="translate(${node.x} ${node.y})"><title>${esc(node.qname)}${node.line ? ' · L' + node.line : ''}</title><rect width="${node.width}" height="${node.height}" rx="8"></rect><text class="semantic-stereo" x="14" y="20">«${esc(node.stereo)}»</text>${wrapLabel(node.label).map((part,i) => `<text class="semantic-label" x="14" y="${43 + i * 17}">${esc(part)}</text>`).join('')}</g>`).join('');
  return `<div class="semantic-canvas" tabindex="0" aria-label="SysML 模型图，可拖动和缩放"><svg class="semantic-svg" role="img" aria-label="SysML 语义结构" viewBox="0 0 ${layout.width} ${layout.height}" data-diagram-width="${layout.width}" data-diagram-height="${layout.height}"><defs><marker id="document-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M1 1 L7 4 L1 7" fill="none" stroke="currentColor"></path></marker></defs>${edges}${cards}</svg></div><div class="semantic-legend"><span>实线 composition / membership</span><span>虚线 typing</span><span>${visible.nodes.length} 个元素 · ${visible.edges.length} 条语义关系</span></div>`;
}

function renderOutline(graph, query = '') {
  const search = query.toLocaleLowerCase(), rows = [...graph.nodes,...graph.rows], byQName = new Map(rows.filter(node => node.qname).map(node => [node.qname,node.id])), byId = new Map(rows.map(node => [node.id,node]));
  const depth = node => {
    let value = 0, current = node, visited = new Set();
    while (current && value < 12 && !visited.has(current.id)) {
      visited.add(current.id);const parentName = current.qname?.split('::').slice(0,-1).join('::');const parent = byQName.get(parentName) || current.parent;current = byId.get(parent);if(current)value++;
    }
    return value;
  };
  const filtered = rows.filter(node => !search || (node.label + ' ' + node.qname + ' ' + node.metaclass).toLocaleLowerCase().includes(search)).sort((a,b) => (a.line || Infinity) - (b.line || Infinity));
  return `<div class="semantic-outline" role="list">${filtered.map(node => `<button type="button" role="listitem" class="semantic-outline-row" data-document-element="${attr(node.id)}" style="--outline-depth:${search ? 0 : depth(node)}"><span class="semantic-kind">${esc(node.stereo)}</span><span>${esc(node.label)}</span>${node.line ? `<span class="semantic-line">${node.line}</span>` : ''}</button>`).join('') || '<div class="document-empty">没有匹配的模型元素。</div>'}</div>`;
}

function renderSource(content, kind) {
  let source = text(content);
  if (kind === 'json') try { source = JSON.stringify(JSON.parse(source),null,2); } catch {}
  return `<div class="document-source" tabindex="0"><pre><code>${source.split('\n').map((line,index) => `<span class="source-line" data-source-line="${index + 1}"><span class="source-number" aria-hidden="true">${index + 1}</span><span class="source-code">${esc(line) || ' '}</span></span>`).join('')}</code></pre></div>`;
}

function locationOf(item) { const line = item.line || item.location?.line || item.range?.start?.line; return Number.isInteger(line) && line > 0 ? line : null; }
function renderDiagnostics(model) {
  const findings = Array.isArray(model?.findings) ? model.findings : [];
  if (!model) return '<div class="document-empty">尚未读取语义校验结果。</div>';
  if (model.available === false || model.backend?.available === false || (model.error && model.valid !== true)) return `<div class="document-diagnostics"><p class="document-check-state has-findings">SysML 语义后端暂不可用</p><p>${esc(model.error || model.detail || model.backend?.detail || '尚未取得校验结果。')}</p><p class="document-scope">当前文件未完成本次语义校验，可以继续查看源码。</p></div>`;
  return `<div class="document-diagnostics"><p class="document-check-state ${model.valid === true ? 'is-valid' : 'has-findings'}">${model.valid === true ? '语法、引用及支持的语义规则校验通过' : '模型包含需要检查的诊断'}</p>${findings.length ? findings.map(item => `<article class="document-finding"><div><span class="document-status ${attr(item.severity === 'error' ? 'violated' : 'undecided')}">${esc(item.severity || 'finding')}</span><strong>${esc(item.message || item.detail || item.code || '模型诊断')}</strong></div><p>${esc(item.stage || '')}</p>${locationOf(item) ? `<button type="button" data-document-source-line="${locationOf(item)}">查看第 ${locationOf(item)} 行</button>` : ''}</article>`).join('') : '<p>没有发现错误或未解析的引用。</p>'}<p class="document-scope">Open-MBEE SysML v2 · 支持规则范围内的校验；仿真结果单独记录。</p></div>`;
}

function verificationData(verification, model) {
  const candidates = [verification?.data,verification,model?.verification?.data,model?.verification,model?.data];
  return candidates.find(item => Array.isArray(item?.constraints)) || null;
}

function renderConstraints(graph, verification, model) {
  const result = verificationData(verification,model), nodes = graph.nodes.filter(node => /Constraint/i.test(node.metaclass));
  const constraints = result?.constraints || nodes.map(node => ({name:node.label,line:node.line,status:'not-evaluated',detail:'尚未运行本次模型的静态约束求值'}));
  const status = value => ({satisfied:'通过',violated:'不满足',undecided:'未确定','not-evaluated':'未求值'}[value] || value || '未求值');
  return `<div class="document-constraints"><p class="document-scope">${result ? '后端静态约束求值。测量值来自模型中已绑定的数据。' : '以下约束来自 SysML 语义模型。打开文件不会启动仿真。'}</p>${result?.summary ? `<div class="constraint-summary"><span class="document-status satisfied">${Number(result.summary.satisfied) || 0} 通过</span><span class="document-status violated">${Number(result.summary.violated) || 0} 不满足</span><span class="document-status undecided">${Number(result.summary.undecided) || 0} 未确定</span></div>` : ''}<div class="document-table-scroll"><table><thead><tr><th>约束</th><th>结果</th><th>说明</th><th>源码</th></tr></thead><tbody>${constraints.map(item => `<tr><td>${esc(item.name || item.qname)}</td><td><span class="document-status ${['satisfied','violated','undecided'].includes(item.status) ? item.status : 'undecided'}">${esc(status(item.status))}</span></td><td>${esc(item.detail || item.method || '')}</td><td>${locationOf(item) ? `<button type="button" data-document-source-line="${locationOf(item)}">L${locationOf(item)}</button>` : '—'}</td></tr>`).join('') || '<tr><td colspan="4">模型中没有约束元素。</td></tr>'}</tbody></table></div></div>`;
}

function elementDetails(node, graph, file) {
  if (!node) return '<div class="document-empty">选择图中的元素查看属性和源码位置。</div>';
  const edges = graph.edges.filter(edge => edge.source === node.id || edge.target === node.id), byId = new Map(graph.nodes.map(item => [item.id,item]));
  const members = node.rows?.length ? '<h4>成员</h4>' + node.rows.map(row => `<button type="button" class="semantic-member" data-document-element="${attr(row.id)}"><span>${esc(row.label)}</span><small>${esc(row.metaclass)}</small></button>`).join('') : '';
  const relationships = edges.length ? '<h4>语义关系</h4>' + edges.map(edge => {
    const other = byId.get(edge.source === node.id ? edge.target : edge.source);
    return `<button type="button" class="semantic-member" data-document-element="${attr(other.id)}"><small>${esc(edge.kind)} ${edge.source === node.id ? '→' : '←'}</small><span>${esc(other.label)}</span></button>`;
  }).join('') : '';
  return `<div class="semantic-details-content"><span class="semantic-kind">${esc(node.stereo)}</span><h3>${esc(node.label)}</h3><p class="semantic-qualified-name">${esc(node.qname)}</p><dl><dt>类型</dt><dd>${esc(node.metaclass)}</dd>${node.line ? `<dt>位置</dt><dd><button type="button" data-document-source-line="${node.line}">${esc(file.path || node.file)}:${node.line}${node.col ? ':' + node.col : ''}</button></dd>` : ''}</dl>${members}${relationships}<details><summary>元素标识</summary><code>${esc(node.id)}</code></details></div>`;
}

export function renderDocumentViewer({file = {},model,verification,tab,filter = 'structure',resolveImage,dataState = {},parsedData} = {}) {
  const kind = documentKind(file), isData = ['json','jsonl','csv'].includes(kind), parsed = parsedData || (isData ? parseDataDocument(file) : null), isMap = kind === 'json' && isGeoJSON(parsed?.root), isModel = kind === 'sysml', graph = normalizeSemanticGraph(model,{path:file.path}), selectedTab = tab || (isModel ? 'diagram' : isMap ? 'map' : 'preview');
  const tabs = isModel ? [['diagram','模型图'],['outline','大纲'],['source','源码'],['diagnostics','诊断'],['constraints','约束']] : kind === 'markdown' ? [['preview','阅读'],['source','源码']] : isMap ? [['map','地图'],['preview','数据'],['source','原始数据']] : isData ? [['preview','数据'],['source','原始数据']] : [['preview','内容']];
  const effectiveTab = tabs.some(([key]) => key === selectedTab) ? selectedTab : tabs[0][0];
  let body;
  if (kind === 'image') {
    const imageURL = projectRasterURL(file.path || file.name,resolveImage);
    body = imageURL ? `<div class="document-raster-view"><img src="${attr(imageURL)}" alt="${attr(file.name || basename(file.path) || '工程图片')}" class="document-raster-image"><span>${esc(file.name || basename(file.path))}</span></div>` : '<div class="document-empty">暂时无法预览此图片。请检查文件是否存在或选择受支持的图片格式。</div>';
  }
  else if (kind === 'unsupported') body = '<div class="document-empty">此文件格式暂不支持应用内预览。请在文件列表中选择文档、SysML 模型或图片。</div>';
  else if (isModel && effectiveTab === 'diagram') body = graph.nodes.length ? renderDiagram(graph,filter) : `<div class="document-empty">${model?.valid === false ? '模型存在诊断，暂时无法生成语义图。请查看诊断或源码。' : '尚未加载 SysML 语义模型。请稍后重试或查看源码。'}</div>`;
  else if (isModel && effectiveTab === 'outline') body = renderOutline(graph);
  else if (isModel && effectiveTab === 'diagnostics') body = renderDiagnostics(model);
  else if (isModel && effectiveTab === 'constraints') body = renderConstraints(graph,verification,model);
  else if (isMap && effectiveTab === 'map') body = renderGeoJSONMap(parsed.root);
  else if (isData && effectiveTab !== 'source') body = renderDataPreview(file,dataState,parsed);
  else if (effectiveTab === 'source' || kind !== 'markdown') body = renderSource(file.content || '',kind);
  else body = `<article class="document-markdown">${renderMarkdown(file.content || '',{path:file.path,resolveImage})}</article>`;
  return `<section class="document-viewer" data-document-kind="${kind}" data-document-tab="${effectiveTab}"><header class="document-toolbar"><nav class="document-tabs" aria-label="文件视图">${tabs.map(([key,name]) => `<button type="button" data-document-tab="${key}" class="${effectiveTab === key ? 'active' : ''}" aria-pressed="${effectiveTab === key}">${name}${key === 'diagnostics' && model?.findings?.length ? ` <span>${model.findings.length}</span>` : ''}</button>`).join('')}</nav>${isModel && effectiveTab === 'diagram' ? `<div class="document-diagram-tools"><select aria-label="模型元素筛选" data-document-filter><option value="structure"${filter === 'structure' ? ' selected' : ''}>系统结构</option><option value="requirements"${filter === 'requirements' ? ' selected' : ''}>需求与约束</option><option value="all"${filter === 'all' ? ' selected' : ''}>全部元素</option></select><button type="button" data-document-zoom="out" title="缩小" aria-label="缩小">−</button><button type="button" data-document-zoom="in" title="放大" aria-label="放大">+</button><button type="button" data-document-fit>适合窗口</button></div>` : isModel && effectiveTab === 'outline' ? '<input type="search" class="document-outline-search" data-document-search placeholder="查找模型元素" aria-label="查找模型元素">' : ''}</header><div class="document-viewer-body${isModel && effectiveTab === 'diagram' ? ' has-model-details' : ''}"><div class="document-main">${body}</div>${isModel && effectiveTab === 'diagram' ? `<aside class="semantic-details" aria-label="元素详情">${elementDetails(null,graph,file)}</aside>` : ''}</div>${isModel ? `<footer class="document-model-meta"><span>SysML v2${model?.backend?.version ? ' · ' + esc(model.backend.version) : ''}</span><span>${graph.nodes.length} 个语义元素${graph.truncated ? '（展示已截断）' : ''}</span>${model?.model?.sha256 || file.sha256 ? `<span title="${attr(model?.model?.sha256 || file.sha256)}">SHA ${esc((model?.model?.sha256 || file.sha256).slice(0,12))}</span>` : ''}</footer>` : isData && /^[a-f0-9]{64}$/i.test(file.sha256||'') ? `<footer class="document-model-meta"><span>项目文件 · ${esc(file.path||file.name||'')}</span><span title="${attr(file.sha256)}">SHA-256 ${esc(file.sha256.slice(0,12))}</span></footer>` : ''}</section>`;
}

export function mountDocumentViewer(container, options = {}) {
  if (!container || typeof container.addEventListener !== 'function') throw new TypeError('Document viewer container required');
  let current = {...options,dataState:{...options.dataState}}, parsedFile = null, parsedData = null, destroyed = false, drag = null, viewBox, initialBox, cleanupCanvas, defaultViewport = true;
  const getGraph = () => normalizeSemanticGraph(current.model,{path:current.file?.path});
  const draw = () => {
    cleanupCanvas?.();if(parsedFile!==current.file){parsedFile=current.file;parsedData=['json','jsonl','csv'].includes(documentKind(current.file))?parseDataDocument(current.file):null;}container.innerHTML = renderDocumentViewer({...current,parsedData});setupCanvas();
  };
  const selectTab = tab => { if (destroyed) return;current.tab = tab;draw();current.onTabChange?.(tab); };
  const setBox = box => { viewBox = box;container.querySelector('.semantic-svg')?.setAttribute('viewBox',`${box.x} ${box.y} ${box.w} ${box.h}`); };
  const fit = () => {defaultViewport = false;if(initialBox)setBox({...initialBox});};
  const zoom = (factor, clientX, clientY) => {
    if (!viewBox || !initialBox) return;
    defaultViewport = false;
    const canvas = container.querySelector('.semantic-canvas'), rect = canvas?.getBoundingClientRect();
    const ratioX = rect?.width ? Math.min(1,Math.max(0,(clientX ?? rect.x + rect.width / 2) - rect.x) / rect.width) : .5;
    const ratioY = rect?.height ? Math.min(1,Math.max(0,(clientY ?? rect.y + rect.height / 2) - rect.y) / rect.height) : .5;
    const w = Math.max(180,Math.min(initialBox.w * 4,viewBox.w * factor)), h = w * viewBox.h / viewBox.w;
    setBox({x:viewBox.x + (viewBox.w - w) * ratioX,y:viewBox.y + (viewBox.h - h) * ratioY,w,h});
  };
  function setupCanvas() {
    const svg = container.querySelector('.semantic-svg'), canvas = container.querySelector('.semantic-canvas');
    if (!svg || !canvas) {initialBox = null;viewBox = null;return;}
    initialBox = {x:0,y:0,w:Number(svg.dataset.diagramWidth),h:Number(svg.dataset.diagramHeight)};defaultViewport = true;
    const readable = () => {if(defaultViewport)setBox(initialSemanticViewport(initialBox,canvas.getBoundingClientRect()));};
    readable();
    // A pane may be mounted before it has its final dimensions.
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(readable) : null;resize?.observe(canvas);
    const wheel = event => { if (!event.ctrlKey && !event.metaKey) return;event.preventDefault();zoom(event.deltaY > 0 ? 1.15 : .87,event.clientX,event.clientY); };
    const down = event => { if(event.button !== 0 || event.target.closest('[data-document-element]'))return;defaultViewport = false;drag = {id:event.pointerId,x:event.clientX,y:event.clientY,box:{...viewBox}};canvas.setPointerCapture?.(event.pointerId);canvas.classList.add('is-dragging'); };
    const move = event => { if(!drag || drag.id !== event.pointerId)return;const rect = svg.getBoundingClientRect();const scale = Math.min(rect.width / drag.box.w,rect.height / drag.box.h);if(scale > 0)setBox({...drag.box,x:drag.box.x - (event.clientX - drag.x) / scale,y:drag.box.y - (event.clientY - drag.y) / scale}); };
    const up = () => {drag = null;canvas.classList.remove('is-dragging');};
    canvas.addEventListener('wheel',wheel,{passive:false});canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);
    cleanupCanvas = () => {resize?.disconnect();canvas.removeEventListener('wheel',wheel);canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);drag = null;};
  }
  const sourceLine = line => {
    const value = Number(line);if(!Number.isInteger(value) || value < 1)return;
    selectTab('source');const source = container.querySelector(`[data-source-line="${value}"]`);source?.classList.add('is-highlighted');source?.scrollIntoView({block:'center'});
  };
  const selectElement = id => {
    const graph = getGraph(), node = [...graph.nodes,...graph.rows].find(item => item.id === id);if(!node)return;
    container.querySelectorAll('[data-document-element]').forEach(element => {const selected = element.dataset.documentElement === id;element.classList.toggle('is-selected',selected);element.setAttribute('aria-selected',String(selected));});
    container.querySelectorAll('.semantic-edge').forEach(edge => {edge.classList.toggle('is-connected',edge.dataset.edgeSource === id || edge.dataset.edgeTarget === id);});
    const details = container.querySelector('.semantic-details');if(details)details.innerHTML = elementDetails(node,graph,current.file || {});
    else if(node.line)sourceLine(node.line);
    current.onSelectElement?.(node);
  };
  const onClick = event => {
    const element = event.target.closest('button[data-document-tab],[data-document-fit],[data-document-zoom],[data-document-element],[data-document-source-line],[data-document-path],[data-document-external],[data-document-anchor],button[data-document-data]');
    if(!element || !container.contains(element))return;
    event.preventDefault();event.stopPropagation();
    if(element.hasAttribute('data-document-data')){const action=element.dataset.documentData;if(action==='table'||action==='plot'){current.dataState={...current.dataState,mode:action};draw();}return;}
    if(element.hasAttribute('data-document-tab'))selectTab(element.dataset.documentTab);
    else if(element.hasAttribute('data-document-fit'))fit();
    else if(element.dataset.documentZoom)zoom(element.dataset.documentZoom === 'in' ? .8 : 1.25);
    else if(element.dataset.documentElement)selectElement(element.dataset.documentElement);
    else if(element.dataset.documentSourceLine)sourceLine(element.dataset.documentSourceLine);
    else if(element.dataset.documentPath)current.onOpenPath?.(element.dataset.documentPath,{...(element.dataset.documentLine ? {line:Number(element.dataset.documentLine)} : {})});
    else if(element.dataset.documentExternal)current.onOpenExternal?.(element.dataset.documentExternal);
    else if(element.dataset.documentAnchor) {
      let target;try{target = decodeURIComponent(element.dataset.documentAnchor.slice(1));}catch{return;}
      const heading = [...container.querySelectorAll('.document-markdown h1,.document-markdown h2,.document-markdown h3,.document-markdown h4,.document-markdown h5,.document-markdown h6')].find(node => node.textContent.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu,'').replace(/\s/g,'-') === target);
      heading?.scrollIntoView({block:'start'});
    }
  };
  const onInput = event => {
    if(event.type==='change'&&event.target.matches('select[data-document-data]')){const action=event.target.dataset.documentData,value=event.target.value;current.dataState=action==='dataset'?{datasetId:value}:action==='x'?{...current.dataState,xKey:value}:action==='y'?{...current.dataState,yKey:value}:current.dataState;draw();return;}
    if(event.type === 'input' && event.target.matches('[data-document-search]'))container.querySelector('.document-main').innerHTML = renderOutline(getGraph(),event.target.value);
    if(event.type === 'change' && event.target.matches('[data-document-filter]')) {current.filter = event.target.value;draw();}
  };
  const onDataHover = event => {const point=event.target.closest?.('[data-data-point]');if(!point)return;const parsed=parsedData||parseDataDocument(current.file),selected=selectedDataSet(parsed,current.dataState),plot=dataPlot(selected,current.dataState),record=plot.points[Number(point.dataset.dataPoint)],out=container.querySelector('.document-data-tooltip');if(record&&out)out.textContent='记录 '+(record.index+1)+' · '+(plot.xKey==='$index'?'序号':plot.xKey)+' = '+record.x+' · '+plot.yKey+' = '+record.y;};
  const onKey = event => {if((event.key === 'Enter' || event.key === ' ') && event.target.matches('g[data-document-element]')) {event.preventDefault();selectElement(event.target.dataset.documentElement);}};
  container.addEventListener('click',onClick);container.addEventListener('input',onInput);container.addEventListener('change',onInput);container.addEventListener('keydown',onKey);container.addEventListener('pointerover',onDataHover);draw();if(current.sourceLine)sourceLine(current.sourceLine);
  return {selectTab,fit,selectElement,selectSourceLine:sourceLine,update:next => {current = {...current,...next};draw();if(next.sourceLine)sourceLine(next.sourceLine);},destroy:() => {destroyed = true;cleanupCanvas?.();container.removeEventListener('click',onClick);container.removeEventListener('input',onInput);container.removeEventListener('change',onInput);container.removeEventListener('keydown',onKey);container.removeEventListener('pointerover',onDataHover);}};
}
