// Public event/approval records are JSON snapshots, never execution arguments.
// Normalize first so escaped credential strings are redacted as actual values.
export function redactPublicValue(value,redact){
  const json=JSON.stringify(value);
  if(json===undefined)return undefined;
  const visit=item=>{
    if(typeof item==='string')return redact(item);
    if(Array.isArray(item))return item.map(visit);
    if(item&&typeof item==='object')return Object.fromEntries(Object.entries(item).map(([key,value])=>[redact(key),visit(value)]));
    return item;
  };
  return visit(JSON.parse(json));
}
