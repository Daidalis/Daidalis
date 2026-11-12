import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {safePath} from '../sandbox.mjs';

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const MAX_FILE=500000,MAX_BYTES=2000000,MAX_FILES=128,MAX_ENTRIES=4096;
const SKIP=new Set(['node_modules','build','dist','target','venv']);
const conflict=()=>Object.assign(Error('Model source set revision conflict; reload the model'),{status:409});
const stamp=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');

function relativePath(value){
  if(typeof value!=='string'||!value||value.includes('\\')||value.split('/').includes('..')||value.split('/').some(segment=>segment.startsWith('.')&&segment!=='.'))throw Error('Use a visible project-relative model path');
  return path.posix.normalize(value);
}

async function sourceNames(workspace,root){
  const names=[];
  let count=0;
  async function walk(relative,depth){
    if(depth>16)throw Error('Model source root exceeds 16 directory levels');
    for await(const entry of await fs.opendir(safePath(workspace,relative))){
      if(++count>MAX_ENTRIES)throw Error('Model source root exceeds 4096 entries; select a smaller root');
      if(entry.name.startsWith('.')||SKIP.has(entry.name))continue;
      const name=path.posix.join(relative,entry.name);
      if(entry.isSymbolicLink())throw Error('Symbolic links are not allowed in model source roots');
      if(entry.isDirectory())await walk(name,depth+1);
      else if(entry.isFile()&&/\.(sysml|kerml)$/.test(entry.name)){
        names.push(name);
        if(names.length>MAX_FILES)throw Error('Model source root exceeds 128 files; select a smaller root');
      }
    }
  }
  await walk(root,0);
  return names.sort();
}

async function readSource(workspace,name){
  const target=safePath(workspace,name);
  const handle=await fs.open(target,constants.O_RDONLY|(constants.O_NOFOLLOW||0)|(constants.O_NONBLOCK||0));
  try{
    const before=await handle.stat();
    if(!before.isFile()||before.size>MAX_FILE)throw Error('Model must be a regular file under 500000 bytes');
    const bytes=await handle.readFile();
    if(bytes.length>MAX_FILE)throw Error('Model grew beyond 500000 bytes');
    safePath(workspace,name);
    if(stamp(before)!==stamp(await handle.stat())||stamp(before)!==stamp(await fs.lstat(target)))throw conflict();
    return {name,text:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),sha256:hash(bytes),bytes:bytes.length,stamp:stamp(before)};
  }finally{await handle.close();}
}

export async function readModelSnapshot(workspace,args={}){
  const relative=relativePath(args.path);
  if(!relative.endsWith('.sysml'))throw Error('Use a project-relative .sysml model path');
  const root=args.sourceRoot===undefined||args.sourceRoot===''?null:relativePath(args.sourceRoot);
  safePath(workspace,relative);
  if(root&&root!=='.'&&!relative.startsWith(root+'/'))throw Error('Model entry must be inside its source root');
  const names=root?await sourceNames(workspace,root):[relative];
  if(!names.includes(relative))throw Error('Model entry is missing from the source root');
  const sources=[];
  let totalBytes=0;
  for(const name of names){
    const source=await readSource(workspace,name);
    totalBytes+=source.bytes;
    if(totalBytes>MAX_BYTES)throw Error('Model source set exceeds 2000000 bytes; select a smaller root');
    sources.push(source);
  }
  for(const source of sources)if(stamp(await fs.lstat(safePath(workspace,source.name)))!==source.stamp)throw conflict();
  if(root&&JSON.stringify(names)!==JSON.stringify(await sourceNames(workspace,root)))throw conflict();
  const entry=sources.find(source=>source.name===relative);
  if(!entry.text.trim())throw Error('Model content must not be empty');
  if(args.expectedHash&&args.expectedHash!==entry.sha256)throw Error('Model revision conflict');
  const files=sources.map(source=>({path:source.name,sha256:source.sha256,bytes:source.bytes}));
  const sourceSet={root,files,totalBytes,sha256:hash(JSON.stringify({root,files}))};
  if(args.expectedSourceSetHash&&args.expectedSourceSetHash!==sourceSet.sha256)throw conflict();
  return {workspace,path:relative,content:entry.text,sha256:entry.sha256,sourceSet,sources:sources.map(({name,text})=>({name,text}))};
}
