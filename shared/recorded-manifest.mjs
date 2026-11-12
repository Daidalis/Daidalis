// Pure helpers that turn a finished SysML FMI run into a `manta-recorded-trajectory-v1`
// manifest. Nothing here reads files or runs a model.
const identifier=/^[A-Za-z_]\w*$/;
const timeName=name=>/^time(?:_seconds)?$/i.test(String(name||''));

/** Names a trajectory column can bind to: parts, ports, attributes and named flows. */
export function sysmlElementNames(source=''){
 const text=String(source||''),names=new Set();
 for(const match of text.matchAll(/\b(?:part|port|attribute|item|action)\s+(?:def\s+)?([A-Za-z_]\w*)/g))names.add(match[1]);
 for(const match of text.matchAll(/\bflow\s+(?:of\s+)?([A-Za-z_]\w*)\s+from\b/g))names.add(match[1]);
 for(const match of text.matchAll(/\b(?:connect|flow)\s+(?:of\s+\w+\s+)?(?:from\s+)?([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+to\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/g)){
  for(const ref of [match[1],match[2]])for(const segment of ref.split('.'))names.add(segment);
 }
 names.delete('from');names.delete('to');names.delete('of');
 return [...names];
}

const tail=column=>String(column).split('.').filter(Boolean).at(-1)||'';

/**
 * Column-to-element aliases for columns that do not already share a name with an element.
 * Only identifier columns are aliased; dotted Modelica names are matched by their last
 * segment at playback and need no alias.
 */
export function deriveBindings(columns=[],source=''){
 const names=sysmlElementNames(source),known=new Set(names),out={};
 for(const column of columns){
  if(timeName(column)||!identifier.test(column)||known.has(column))continue;
  const parts=column.split('_').filter(Boolean);
  let hit='';
  for(let size=parts.length-1;size>=1&&!hit;size--){
   const prefix=parts.slice(0,size).join('_');
   if(known.has(prefix))hit=prefix;
  }
  if(!hit)hit=parts.find(part=>known.has(part))||'';
  if(hit)out[column]=hit;
 }
 return out;
}

/** The first numeric signal that is bound to a model element, or '' when none is. */
export function deriveDrive(columns=[],bindings={},source=''){
 const known=new Set(sysmlElementNames(source));
 for(const column of columns){
  if(timeName(column)||!identifier.test(column))continue;
  if(bindings[column]||known.has(column))return column;
 }
 return '';
}

export function recordedManifestPath(modelPath){
 return /\.sysml$/i.test(String(modelPath||''))?String(modelPath).replace(/\.sysml$/i,'.recorded.json'):'';
}

/**
 * Build the manifest. A previous manifest of the same schema keeps its hand-written
 * bindings, units and drive; everything that describes the run is replaced.
 */
export function buildRecordedManifest({columns=[],source='',csv,jobId,note='',checks=[],receipt=null,previous=null}){
 const keep=previous&&previous.schema==='manta-recorded-trajectory-v1'?previous:{};
 const bindings={...deriveBindings(columns,source),...(keep.bindings&&typeof keep.bindings==='object'&&!Array.isArray(keep.bindings)?keep.bindings:{})};
 const drive=typeof keep.drive==='string'&&keep.drive?keep.drive:deriveDrive(columns,bindings,source);
 return {
  schema:'manta-recorded-trajectory-v1',
  provenance:'fmu-run',
  note:String(note||`作业 ${jobId} 的 FMU 仿真轨迹。`).slice(0,300),
  csv,
  ...(keep.units&&typeof keep.units==='object'&&!Array.isArray(keep.units)?{units:keep.units}:{}),
  bindings,
  drive,
  checks:checks.filter(check=>check&&typeof check.variable==='string').slice(0,100).map(check=>({variable:check.variable,passed:check.passed===true?true:check.passed===false?false:null})),
  ...(receipt&&typeof receipt==='object'?{receipt}:{})
 };
}

const MODELICA_WORDS=new Set(['model','end','equation','algorithm','connect','der','extends','import','annotation','if','when','within','package','function','record','block','connector','class','initial','for','while','else','elseif','and','or','not','then','loop','protected','public','external','encapsulated','partial','expandable','type','operator']);

/**
 * Top-level component and variable names declared in a Modelica source. This is a name
 * scan for alignment only; it does not parse or validate Modelica.
 */
export function modelicaVariableNames(source=''){
 const names=new Set();
 const text=String(source||'').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'').replace(/"(?:[^"\\]|\\.)*"/g,'""');
 const body=text.split(/^\s*(?:initial\s+)?(?:equation|algorithm)\b/m)[0];
 const declaration=/^[ \t]*(?:(?:parameter|constant|input|output|flow|stream|discrete|final|inner|outer|replaceable)[ \t]+)*([A-Za-z_][\w.]*)[ \t]*(?:\([^)]*\))?(?:\[[^\]]*\])?[ \t]+([A-Za-z_]\w*)\b/gm;
 for(const match of body.matchAll(declaration)){
  if(MODELICA_WORDS.has(match[1])||MODELICA_WORDS.has(match[2]))continue;
  names.add(match[2]);
 }
 return [...names];
}

/**
 * Compare SysML element names with signal names (Modelica variables or CSV columns).
 * Dotted signals are compared by their last segment and `aliases` maps a signal to an
 * element. Nothing is inferred beyond names, so this only reports alignment.
 */
export function alignNames(elementNames=[],signalNames=[],aliases={}){
 const elements=[...new Set(elementNames)],signals=[...new Set(signalNames)].filter(name=>!timeName(name));
 const claimed=new Set(),matched=[],signalsWithoutElement=[];
 for(const signal of signals){
  const target=[aliases?.[signal],signal,tail(signal)].find(name=>name&&elements.includes(name));
  if(target){matched.push({signal,element:target});claimed.add(target);}
  else signalsWithoutElement.push(signal);
 }
 const elementsWithoutSignal=elements.filter(name=>!claimed.has(name));
 return {aligned:matched.length>0&&signalsWithoutElement.length===0,matched,signalsWithoutElement,elementsWithoutSignal};
}

/** Report for a SysML source against a sibling Modelica source, or against recorded columns. */
export function alignmentReport({sysml='',modelica=null,columns=null,aliases={}}){
 const elements=sysmlElementNames(sysml);
 const kind=columns?'columns':'modelica';
 const signals=columns??modelicaVariableNames(modelica||'');
 return {kind,...alignNames(elements,signals,aliases)};
}
