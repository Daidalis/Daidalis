import fs from 'node:fs';
import path from 'node:path';

// GitHub's Pages uploader dereferences links. Reject them before copying or uploading.
export function staticFiles(directory){
 const root=path.resolve(directory),files=[];let bytes=0;
 function visit(absolute,relative=''){
  const stat=fs.lstatSync(absolute);
  if(stat.isSymbolicLink()||(!stat.isDirectory()&&!stat.isFile()))throw Error('Static export requires regular files and directories: '+relative);
  if(relative.split('/').some(n=>n.startsWith('.'))&&relative!=='.nojekyll')throw Error('Hidden configuration cannot enter the website export: '+relative);
  if(stat.isDirectory())for(const name of fs.readdirSync(absolute).sort())visit(path.join(absolute,name),relative?relative+'/'+name:name);
  else{
   if(stat.nlink!==1)throw Error('Hard links cannot enter the website export: '+relative);
   if(relative==='.nojekyll'&&stat.size!==0)throw Error('.nojekyll must be an empty marker');
   bytes+=stat.size;
   if(bytes>8*1024*1024||files.length>=1000)throw Error('Static export exceeds its bounded file budget');
   files.push({absolute,relative,size:stat.size});
  }
 }
 visit(root);
 if(!files.some(f=>f.relative==='index.html'))throw Error('Static export needs index.html');
 return files;
}
