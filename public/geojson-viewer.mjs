// A bounded, read-only sketch of a recorded GeoJSON file. This is deliberately
// not a GIS analysis engine: source CRS, geometry validity and coverage belong
// to the engineering job that produced the file.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MAX_FEATURES=500,MAX_VERTICES=12000,WIDTH=960,HEIGHT=500,PAD=30;
const geometryTypes=new Set(['Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon','GeometryCollection']);
export function isGeoJSON(value){return Boolean(value&&typeof value==='object'&&['FeatureCollection','Feature',...geometryTypes].includes(value.type));}

function crsName(value){
  const raw=value?.crs;
  if(raw==null)return 'EPSG:4326 (GeoJSON 默认)';
  const name=typeof raw==='string'?raw:raw?.properties?.name;
  if(!/^(?:EPSG:4326|OGC:CRS84|urn:ogc:def:crs:OGC:1\.3:CRS84)$/i.test(String(name||'')))throw Error('地图预览只接受明确的 EPSG:4326 / CRS84；请先由 GIS 工具完成坐标转换。');
  return String(name);
}

export function geoJSONSketch(value){
  if(!isGeoJSON(value))throw Error('文件不是 GeoJSON FeatureCollection、Feature 或几何对象。');
  const crs=crsName(value),features=value.type==='FeatureCollection'?value.features:value.type==='Feature'?[value]:[{type:'Feature',geometry:value,properties:{}}];
  if(!Array.isArray(features)||features.length>MAX_FEATURES)throw Error('地图预览最多显示 500 个要素；请保存一个有来源的简化预览文件。');
  const shapes=[],bounds={west:180,east:-180,south:90,north:-90};let vertices=0;
  function point(pair){
    if(!Array.isArray(pair)||pair.length<2||!Number.isFinite(pair[0])||!Number.isFinite(pair[1])||Math.abs(pair[0])>180||Math.abs(pair[1])>90)throw Error('存在无效经纬度；未绘制地图。');
    const [lon,lat]=pair;vertices++;if(vertices>MAX_VERTICES)throw Error('地图预览最多显示 12000 个顶点；请保存一个有来源的简化预览文件。');
    bounds.west=Math.min(bounds.west,lon);bounds.east=Math.max(bounds.east,lon);bounds.south=Math.min(bounds.south,lat);bounds.north=Math.max(bounds.north,lat);return [lon,lat];
  }
  function line(coords,minimum){if(!Array.isArray(coords)||coords.length<minimum)throw Error('GeoJSON 线或环的坐标数量不足。');return coords.map(point);}
  function geometry(g,label,depth=0){
    if(!g)return;
    if(depth>5||!geometryTypes.has(g.type))throw Error('不支持的 GeoJSON 几何类型或嵌套深度。');
    const c=g.coordinates;
    if(g.type==='GeometryCollection'){if(!Array.isArray(g.geometries))throw Error('GeometryCollection 缺少几何列表。');g.geometries.forEach(child=>geometry(child,label,depth+1));return;}
    if(g.type==='Point')shapes.push({kind:'point',parts:[[point(c)]],label});
    else if(g.type==='MultiPoint')shapes.push({kind:'point',parts:(Array.isArray(c)?c:[]).map(p=>[point(p)]),label});
    else if(g.type==='LineString')shapes.push({kind:'line',parts:[line(c,2)],label});
    else if(g.type==='MultiLineString')shapes.push({kind:'line',parts:(Array.isArray(c)?c:[]).map(part=>line(part,2)),label});
    else if(g.type==='Polygon')shapes.push({kind:'polygon',parts:(Array.isArray(c)?c:[]).map(ring=>line(ring,4)),label});
    else if(g.type==='MultiPolygon')shapes.push({kind:'polygon',parts:(Array.isArray(c)?c:[]).flatMap(polygon=>(Array.isArray(polygon)?polygon:[]).map(ring=>line(ring,4))),label});
  }
  features.forEach((feature,index)=>{
    if(!feature||feature.type!=='Feature')throw Error('GeoJSON 要素格式不正确。');
    const label=String(feature.properties?.name??feature.properties?.NAME??feature.id??`要素 ${index+1}`).slice(0,120);
    geometry(feature.geometry,label);
  });
  if(!vertices)throw Error('GeoJSON 没有可绘制的坐标。');
  return {crs,features:features.length,vertices,bounds,shapes};
}

export function renderGeoJSONMap(value){
  let sketch;try{sketch=geoJSONSketch(value);}catch(error){return `<div class="document-empty" role="alert">${esc(error.message)}<p>可切换到数据或原始数据查看完整文件。</p></div>`;}
  const {bounds,shapes}=sketch,dx=Math.max(bounds.east-bounds.west,.01),dy=Math.max(bounds.north-bounds.south,.01),scale=Math.min((WIDTH-2*PAD)/dx,(HEIGHT-2*PAD)/dy);
  const x0=(WIDTH-dx*scale)/2,y0=(HEIGHT-dy*scale)/2;
  const xy=point=>[x0+(point[0]-bounds.west)*scale,y0+(bounds.north-point[1])*scale];
  const p=point=>xy(point).map(n=>n.toFixed(2)).join(' ');
  const pathFor=part=>{
    if(!part.length)return '';
    // Split apparent antimeridian crossings instead of drawing a false line
    // across the entire world. The preview remains a sketch, not a topology test.
    let d='';part.forEach((point,index)=>{const jump=index&&Math.abs(point[0]-part[index-1][0])>180;d+=(index&&!jump?' L ':' M ')+p(point);});
    if(Math.abs(part.at(-1)[0]-part[0][0])<=180)d+=' Z';
    return d.trim();
  };
  const paths=shapes.flatMap(shape=>{
    if(shape.kind==='point')return shape.parts.map(part=>{const [cx,cy]=xy(part[0]);return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="3.5"><title>${esc(shape.label)}</title></circle>`;});
    if(shape.kind==='polygon')return [`<path d="${shape.parts.map(pathFor).join(' ')}" class="geojson-polygon" fill-rule="evenodd"><title>${esc(shape.label)}</title></path>`];
    return shape.parts.map(part=>`<path d="${pathFor(part).replace(/ Z$/,'')}" class="geojson-line"><title>${esc(shape.label)}</title></path>`);
  }).join('');
  return `<section class="document-geojson" aria-label="GeoJSON 地图预览"><div class="document-geojson-frame"><svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${esc(sketch.features)} 个要素的经纬度轮廓预览"><rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" class="geojson-background"/>${paths}</svg></div><dl class="document-geojson-meta"><div><dt>展示坐标系</dt><dd>${esc(sketch.crs)}</dd></div><div><dt>范围</dt><dd>${bounds.west.toFixed(4)}°–${bounds.east.toFixed(4)}° 经度 · ${bounds.south.toFixed(4)}°–${bounds.north.toFixed(4)}° 纬度</dd></div><div><dt>数据量</dt><dd>${sketch.features} 个要素 · ${sketch.vertices} 个顶点</dd></div></dl><p class="document-data-note">静态经纬度轮廓预览；不使用地图瓦片、不计算面积、距离、拓扑、轨道覆盖或需求通过率。若文件经过简化或坐标转换，以其工程作业回执为准；跨 180° 的轮廓在此示意图中可能分段。</p></section>`;
}
