import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {staticFiles} from './static-export.mjs';
const defaultRoot=fileURLToPath(new URL('../dist/',import.meta.url));
const attribute=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');

export function preparePages({sourceRoot=defaultRoot,outputRoot,baseUrl}={}){
 const source=path.resolve(sourceRoot);
 if(!outputRoot||!path.isAbsolute(outputRoot))throw Error('Use a dedicated absolute --output directory');
 const output=path.resolve(outputRoot),relative=path.relative(source,output),reverse=path.relative(output,source);
 if(!relative||!reverse||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))||(!reverse.startsWith('..'+path.sep)&&reverse!=='..'&&!path.isAbsolute(reverse)))throw Error('Output and source directories must not contain each other');
 const base=new URL(baseUrl);
 if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw Error('Pages base URL must be HTTPS without credentials, query or fragment');
 base.pathname=base.pathname.replace(/\/?$/,'/');
 const files=staticFiles(source);
 if(fs.existsSync(output)){
  const stat=fs.lstatSync(output);
  if(stat.isSymbolicLink()||!stat.isDirectory()||fs.readdirSync(output).length)throw Error('Output must be a new or empty regular directory');
 }else fs.mkdirSync(output,{recursive:true});
 for(const file of files){
  const target=path.join(output,file.relative);fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.copyFileSync(file.absolute,target,fs.constants.COPYFILE_EXCL);
 }
 const index=path.join(output,'index.html');let html=fs.readFileSync(index,'utf8');
 html=html.replace(/(<meta property="og:image" content=")[^"]*(")/,(_,a,b)=>a+attribute(new URL('assets/readme-cover.svg',base).href)+b);
 html=html.replace('</head>','<meta property="og:url" content="'+attribute(base.href)+'"><link rel="canonical" href="'+attribute(base.href)+'"></head>');
 fs.writeFileSync(index,html);
 if(!fs.existsSync(path.join(output,'.nojekyll')))fs.writeFileSync(path.join(output,'.nojekyll'),'');
 staticFiles(output);
 return {output,baseUrl:base.href,files:files.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const values={};const args=process.argv.slice(2);
 for(let i=0;i<args.length;i+=2){if(!['--output','--base-url'].includes(args[i])||!args[i+1]||values[args[i]])throw Error('Usage: prepare-pages.mjs --output <absolute directory> --base-url <https URL>');values[args[i]]=args[i+1];}
 console.log(JSON.stringify(preparePages({outputRoot:values['--output'],baseUrl:values['--base-url']})));
}
