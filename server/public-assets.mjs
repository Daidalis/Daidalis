import fs from 'node:fs/promises';
import {constants as FC} from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {safePath} from './sandbox.mjs';

export const PUBLIC_ASSET_MAX_BYTES=32*1024*1024;
const dataExtensions=new Set(['.zip','.geojson','.json','.csv','.kml','.xml','.pdf','.gpkg','.tif','.tiff','.nc','.fits']);
const unsupportedLinkCodes=new Set(['ENOTSUP','EOPNOTSUPP']);

export function classifyPublicAsset({url,contentType='',buffer}){
  if(!Buffer.isBuffer(buffer)||buffer.length===0||buffer.length>PUBLIC_ASSET_MAX_BYTES)throw new Error('Public asset is empty or exceeds the 32 MiB limit');
  const source=new URL(url);
  if(source.protocol!=='https:'||source.username||source.password||source.port)throw new Error('Public assets require credential-free HTTPS');
  const mime=String(contentType).split(';')[0].trim().toLowerCase();
  if(/html|javascript|ecmascript|x-executable|x-mach-binary|x-dosexec/.test(mime))throw new Error('This response is not an engineering data asset');
  let extension=path.posix.extname(source.pathname).toLowerCase();
  if(!extension&&/^(application\/json|application\/[^;]+\+json)$/.test(mime))extension='.json';
  if(!extension&&/^(application\/zip|application\/x-zip-compressed)$/.test(mime))extension='.zip';
  if(!dataExtensions.has(extension))throw new Error('Only recognized engineering data formats can be imported');
  if(extension==='.zip'&&!buffer.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04])))throw new Error('ZIP source does not have a ZIP file signature');
  if(extension==='.pdf'&&buffer.toString('ascii',0,5)!=='%PDF-')throw new Error('PDF source does not have a PDF file signature');
  if(extension==='.gpkg'&&buffer.toString('ascii',0,16)!=='SQLite format 3\0')throw new Error('GeoPackage source does not have a SQLite file signature');
  if(extension==='.json'||extension==='.geojson'){
    try{JSON.parse(buffer.toString('utf8'));}catch{throw new Error('JSON source is not valid JSON');}
  }
  return {extension,contentType:mime||'application/octet-stream'};
}

export async function savePublicAsset({url,workspace,assetFetcher,signal,assertWriteOwnership}){
  if(typeof assetFetcher!=='function')throw new Error('Public asset fetcher is unavailable');
  const requested=new URL(url),requestedHost=requested.hostname.replace(/^\[|\]$/g,'');
  if(requested.protocol!=='https:'||requested.username||requested.password||requested.port||net.isIP(requestedHost))throw new Error('Public assets require a credential-free HTTPS hostname');
  const response=await assetFetcher(url,{signal,maxBytes:PUBLIC_ASSET_MAX_BYTES,representation:'buffer'});
  if(response?.status!==200)throw new Error(`Public asset fetch returned HTTP ${response?.status??'unknown'}`);
  const {extension,contentType}=classifyPublicAsset(response);
  const sha256=createHash('sha256').update(response.buffer).digest('hex');
  // The isolated worker can mutate /work but cannot replace the bind-mount's
  // parent. Keep both names at that root: an intermediate `sources/` directory
  // could be swapped to a symlink between the ownership check and hardlink.
  const relative=`source-${sha256}${extension}`;
  await assertWriteOwnership?.(relative);
  if(signal?.aborted)throw new Error('Cancelled');
  const destination=safePath(workspace,relative,{write:true});
  const temporary=safePath(workspace,`.source-download-${randomUUID()}`,{write:true});
  let created=false;
  try{
    const handle=await fs.open(temporary,FC.O_WRONLY|FC.O_CREAT|FC.O_EXCL|FC.O_NOFOLLOW,0o600);
    try{await handle.writeFile(response.buffer);await handle.sync();}finally{await handle.close();}
    if(signal?.aborted)throw new Error('Cancelled');
    try{await fs.link(temporary,destination);created=true;}
    catch(error){
      if(error.code==='EEXIST')await verifyExistingWithRetry(destination,response.buffer,relative,signal);
      else if(unsupportedLinkCodes.has(error.code)){
        // NAS mounts may reject hardlinks. Create the final name exclusively,
        // then verify final bytes. This name is visible during the write, so
        // peers seeing EEXIST get a bounded chance to observe completion.
        let finalHandle;
        try{finalHandle=await fs.open(destination,FC.O_WRONLY|FC.O_CREAT|FC.O_EXCL|FC.O_NOFOLLOW,0o600);}
        catch(openError){if(openError.code!=='EEXIST')throw openError;await verifyExistingWithRetry(destination,response.buffer,relative,signal);}
        if(finalHandle){
          created=true;
          try{
            try{await finalHandle.writeFile(response.buffer);await finalHandle.sync();}
            catch(writeError){throw new Error(`Public source write failed at ${relative}; a partial file may remain and must be inspected before retry`,{cause:writeError});}
          }finally{await finalHandle.close();}
        }
      }else throw error;
    }
    // A peer with write access can race the final name too. This verifies the
    // returned import at this instant; every later engineering use must rehash.
    await verifyImportedFile(destination,response.buffer);
  }finally{await fs.rm(temporary,{force:true});}
  return {path:relative,sourceUrl:url,finalUrl:response.url,contentType,bytes:response.buffer.length,sha256,created,trust:'untrusted-public-source; no extraction or execution performed; rehash file bytes at every use and record the actual source hash for each run'};
}

async function verifyExistingWithRetry(destination,expected,relative,signal){
  let lastError;
  for(let attempt=0;attempt<20;attempt++){
    if(signal?.aborted)throw new Error('Cancelled');
    try{return await verifyImportedFile(destination,expected);}
    catch(error){
      if(error.code==='ELOOP'||error.code==='ENOTDIR')throw error;
      lastError=error;
      if(attempt<19)await new Promise(resolve=>setTimeout(resolve,100));
    }
  }
  throw new Error(`Existing source asset at ${relative} does not match its content hash after bounded retry; inspect it before retrying`,{cause:lastError});
}

async function verifyImportedFile(destination,expected){
  const handle=await fs.open(destination,FC.O_RDONLY|FC.O_NOFOLLOW);
  try{
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size!==expected.length)throw new Error('Existing source asset does not match its content hash');
    if(!(await handle.readFile()).equals(expected))throw new Error('Existing source asset does not match its content hash');
  }finally{await handle.close();}
}
