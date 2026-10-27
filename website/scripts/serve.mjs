import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {staticFiles} from './static-export.mjs';
const defaultRoot=fileURLToPath(new URL('../dist/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.csv':'text/csv; charset=utf-8','.md':'text/plain; charset=utf-8','.png':'image/png'};
export function createStaticPreview({root=defaultRoot,basePath='/'}={}){
 root=path.resolve(root);const files=new Map(staticFiles(root).map(f=>[f.relative,f.absolute]));
 if(!/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(basePath)||basePath.split('/').some(p=>p==='.'||p==='..'))throw Error('Use a trailing-slash URL prefix such as /Manta/');
 return http.createServer(async(req,res)=>{
  try{
   if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
   const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   if(basePath!=='/'&&pathname===basePath.slice(0,-1)){res.writeHead(308,{Location:basePath});res.end();return;}
   if(!pathname.startsWith(basePath))throw Error();
   let relative=pathname.slice(basePath.length);if(relative.endsWith('/')||!relative)relative+='index.html';
   const target=files.get(relative);if(!target)throw Error();
   const bytes=await readFile(target);
   res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   res.end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||4320),basePath=process.env.SITE_BASE_PATH||'/';
 const server=createStaticPreview({root:process.env.SITE_ROOT||defaultRoot,basePath});
 server.listen(port,'127.0.0.1',()=>console.log('Manta website: http://127.0.0.1:'+server.address().port+basePath));
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));
}
