import fs from 'node:fs/promises';
import path from 'node:path';
import {safePath} from '../sandbox.mjs';

const identifier=value=>value.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const stem=value=>path.posix.basename(value,'.sysml');
function entryScore(file,root){
  const name=identifier(stem(file)),directory=identifier(path.posix.basename(root));
  if(name==='main')return 100;
  if(name===directory+'model')return 90;
  if(name===directory)return 80;
  return {model:60,index:50,root:40}[name]||0;
}
function preferredEntry(files,root){
  const ranked=files.filter(file=>path.posix.dirname(file)===root).map(file=>({file,score:entryScore(file,root)})).filter(item=>item.score>0).sort((left,right)=>right.score-left.score);
  return ranked.length&&ranked[0].score!==ranked[1]?.score?ranked[0].file:null;
}
function projectDescriptor(sourceRoot,entryPath,entryKind){
  const entryName=stem(entryPath),directory=sourceRoot&&sourceRoot!=='.'?path.posix.basename(sourceRoot):entryName;
  const name=entryKind==='convention'?/^(main|model|index|root)$/i.test(entryName)?directory:entryName.replace(/Model$/i,''):directory;
  return {sourceRoot,entryPath,entryKind,name};
}
function conventionalRoot(file){
  const parts=file.split('/');
  return parts[0]==='models'&&parts.length>2?parts.slice(0,2).join('/'):path.posix.dirname(file);
}
export function modelProjects(models){
  const groups=new Map();
  for(const item of models){
    if(!item.path?.endsWith('.sysml'))continue;
    const root=conventionalRoot(item.path);
    if(!groups.has(root))groups.set(root,[]);
    groups.get(root).push(item.path);
  }
  const projects=[];
  for(const [root,files] of groups){
    const entry=root==='models'?null:preferredEntry(files,root);
    if(entry)projects.push({...projectDescriptor(root,entry,'convention'),fileCount:files.length});
    else if(root.startsWith('models/')&&files.length>1)projects.push({...projectDescriptor(root,[...files].sort()[0],'collection'),fileCount:files.length});
    else for(const file of files)projects.push({...projectDescriptor(null,file,'file'),fileCount:1});
  }
  return projects.sort((left,right)=>left.entryPath.localeCompare(right.entryPath));
}
async function directorySources(workspace,root){
  const files=[];
  let count=0;
  for await(const entry of await fs.opendir(safePath(workspace,root))){
    if(++count>4096)throw Error('Model entry discovery exceeds 4096 entries');
    if(entry.isFile()&&!entry.name.startsWith('.')&&entry.name.endsWith('.sysml'))files.push(path.posix.join(root,entry.name));
  }
  return files.sort();
}
export async function resolveModelProject(workspace,relative,sourceRoot){
  if(sourceRoot==='')return projectDescriptor(null,relative,'file');
  if(sourceRoot!==undefined){
    const entry=preferredEntry(await directorySources(workspace,sourceRoot),sourceRoot);
    return projectDescriptor(sourceRoot,entry||relative,entry?'convention':'collection');
  }
  let root=path.posix.dirname(relative);
  while(true){
    if(root==='models')break;
    const entry=preferredEntry(await directorySources(workspace,root),root);
    if(entry)return projectDescriptor(root,entry,'convention');
    if(root==='.')break;
    root=path.posix.dirname(root);
  }
  const fallback=conventionalRoot(relative);
  return fallback.startsWith('models/')?projectDescriptor(fallback,relative,'collection'):projectDescriptor(null,relative,'file');
}
