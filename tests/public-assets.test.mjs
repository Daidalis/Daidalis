import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createHash} from 'node:crypto';
import {publicFetch,lookupBeforeDeadline} from '../server/sandbox.mjs';
import {savePublicAsset,PUBLIC_ASSET_MAX_BYTES} from '../server/public-assets.mjs';
import {createToolRuntime,TOOL_DEFINITIONS} from '../server/tools.mjs';

async function workspace(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-public-asset-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
const zip=Buffer.from([0x50,0x4b,0x03,0x04,0x01,0x02,0x03,0x04]);

test('project-only public ZIP import is content-addressed, repeatable and never extracted',async t=>{
  const root=await workspace(t),url='https://www2.census.gov/geo/tiger/TIGER2025/STATE/tl_2025_us_state.zip';
  const assetFetcher=async(target,options)=>{assert.equal(target,url);assert.equal(options.maxBytes,PUBLIC_ASSET_MAX_BYTES);assert.equal(options.representation,'buffer');return {url,status:200,contentType:'application/octet-stream',buffer:zip};};
  const first=await savePublicAsset({url,workspace:root,assetFetcher});
  assert.equal(first.sha256,createHash('sha256').update(zip).digest('hex'));
  assert.equal(first.path,`source-${first.sha256}.zip`);assert.equal(first.created,true);
  assert.deepEqual(await fs.readFile(path.join(root,first.path)),zip);
  assert.deepEqual(await fs.readdir(root),[first.path]);
  assert.match(first.trust,/rehash file bytes at every use/);
  const repeated=await savePublicAsset({url,workspace:root,assetFetcher});assert.equal(repeated.created,false);
  await fs.writeFile(path.join(root,first.path),'mutated after import');
  await assert.rejects(savePublicAsset({url,workspace:root,assetFetcher}),/does not match its content hash/);
});

test('small GitHub ref metadata can be imported as valid JSON without a URL file extension',async t=>{
  const root=await workspace(t),url='https://api.github.com/repos/nasa/nos3/commits/master';
  const buffer=Buffer.from('{"sha":"abc123"}');
  const result=await savePublicAsset({url,workspace:root,assetFetcher:async()=>({url,status:200,contentType:'application/vnd.github+json; charset=utf-8',buffer})});
  assert.match(result.path,/^source-[a-f0-9]{64}\.json$/);
  assert.equal(result.finalUrl,url);assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,result.path),'utf8')),{sha:'abc123'});
});

test('the Agent tool honors Manual approval, disabled-tool boundaries and Auto project writes',async t=>{
  const root=await workspace(t),url='https://www2.census.gov/data.zip';let fetches=0;
  const assetFetcher=async()=>{fetches++;return {url,status:200,contentType:'application/zip',buffer:zip};};
  assert.ok(TOOL_DEFINITIONS.some(item=>item.name==='fetch_public_asset'));
  const options={store:{workspace:()=>root},emit:()=>{},assetFetcher,requestApproval:async()=>false};
  const manual=createToolRuntime(options);
  await assert.rejects(manual.execute('fetch_public_asset',{url},{projectId:'project_a',permissionMode:'manual'}),/rejected/);
  assert.equal(fetches,0);
  const disabled=createToolRuntime({...options,disabledTools:['fetch_public_asset']});
  await assert.rejects(disabled.execute('fetch_public_asset',{url},{projectId:'project_a',permissionMode:'auto'}),/unavailable/);
  assert.equal(fetches,0);
  const ordinary=createToolRuntime({...options,assetFetcher:undefined});
  assert.equal(ordinary.definitions.some(item=>item.name==='fetch_public_asset'),false);
  await assert.rejects(ordinary.execute('fetch_public_asset',{url},{projectId:'project_a',permissionMode:'auto'}),/unavailable/);
  const auto=createToolRuntime(options);
  const result=await auto.execute('fetch_public_asset',{url},{projectId:'project_a',permissionMode:'auto'});
  assert.equal(fetches,1);assert.deepEqual(await fs.readFile(path.join(root,result.path)),zip);
});

test('HTTP errors, oversized or malformed binary, wrong MIME and ownership denial leave no imported file',async t=>{
  const root=await workspace(t),url='https://www2.census.gov/data.zip';
  await assert.rejects(savePublicAsset({url:'http://www2.census.gov/data.zip',workspace:root,assetFetcher:async()=>{throw new Error('must not fetch');}}),/HTTPS/);
  for(const response of [
    {url,status:403,contentType:'application/zip',buffer:zip},
    {url,status:206,contentType:'application/zip',buffer:zip},
    {url,status:200,contentType:'application/zip',buffer:Buffer.alloc(PUBLIC_ASSET_MAX_BYTES+1)},
    {url,status:200,contentType:'application/zip',buffer:Buffer.from('not a zip')},
    {url,status:200,contentType:'text/html',buffer:zip},
  ])await assert.rejects(savePublicAsset({url,workspace:root,assetFetcher:async()=>response}));
  await assert.rejects(savePublicAsset({url,workspace:root,assetFetcher:async()=>({url,status:200,contentType:'application/zip',buffer:zip}),assertWriteOwnership:()=>{throw new Error('owned by another thread');}}),/owned/);
  assert.deepEqual(await fs.readdir(root),[]);
});

test('an unrelated mutable sources directory cannot redirect the root-level asset write',async t=>{
  const root=await workspace(t),outside=await workspace(t),url='https://www2.census.gov/data.zip';
  await fs.symlink(outside,path.join(root,'sources'));
  const result=await savePublicAsset({url,workspace:root,assetFetcher:async()=>({url,status:200,contentType:'application/zip',buffer:zip})});
  assert.match(result.path,/^source-[a-f0-9]{64}\.zip$/);
  assert.deepEqual(await fs.readdir(outside),[]);
  assert.deepEqual(await fs.readFile(path.join(root,result.path)),zip);
});

test('NAS hardlink ENOTSUP falls back to exclusive source creation without replacing existing bytes',async t=>{
  const root=await workspace(t),url='https://www2.census.gov/data.zip';
  const originalLink=fs.link;
  fs.link=async()=>{const error=new Error('operation not supported');error.code='ENOTSUP';throw error;};
  try{
    const assetFetcher=async()=>({url,status:200,contentType:'application/zip',buffer:zip});
    const first=await savePublicAsset({url,workspace:root,assetFetcher});
    assert.equal(first.created,true);assert.deepEqual(await fs.readFile(path.join(root,first.path)),zip);
    const repeated=await savePublicAsset({url,workspace:root,assetFetcher});
    assert.equal(repeated.created,false);assert.deepEqual(await fs.readFile(path.join(root,first.path)),zip);
    assert.equal((await fs.readdir(root)).some(name=>name.startsWith('.source-download-')),false);
  }finally{fs.link=originalLink;}
});

test('two concurrent NAS fallback imports agree on bytes; a preexisting wrong hash name still fails closed',async t=>{
  const root=await workspace(t),wrongRoot=await workspace(t),url='https://www2.census.gov/data.zip';
  const payload=Buffer.concat([zip,Buffer.alloc(1024*1024,0x52)]);
  const expectedHash=createHash('sha256').update(payload).digest('hex');
  const assetFetcher=async()=>({url,status:200,contentType:'application/zip',buffer:payload});
  const originalLink=fs.link;
  fs.link=async()=>{const error=new Error('operation not supported');error.code='ENOTSUP';throw error;};
  try{
    const results=await Promise.all([savePublicAsset({url,workspace:root,assetFetcher}),savePublicAsset({url,workspace:root,assetFetcher})]);
    assert.deepEqual(results.map(result=>result.path),[`source-${expectedHash}.zip`,`source-${expectedHash}.zip`]);
    assert.deepEqual(results.map(result=>result.created).sort(),[false,true]);
    assert.deepEqual(await fs.readFile(path.join(root,results[0].path)),payload);
    const wrongPath=path.join(wrongRoot,`source-${expectedHash}.zip`);
    await fs.writeFile(wrongPath,Buffer.from('preexisting different bytes'));
    await assert.rejects(savePublicAsset({url,workspace:wrongRoot,assetFetcher}),/does not match its content hash/);
    assert.equal((await fs.readFile(wrongPath)).toString(),'preexisting different bytes');
  }finally{fs.link=originalLink;}
});

test('an EEXIST peer can finish a partial NAS fallback write before bounded verification',async t=>{
  const root=await workspace(t),url='https://www2.census.gov/data.zip';
  const payload=Buffer.concat([zip,Buffer.alloc(4096,0x51)]);
  const filename=`source-${createHash('sha256').update(payload).digest('hex')}.zip`;
  await fs.writeFile(path.join(root,filename),payload.subarray(0,4));
  const originalLink=fs.link;
  fs.link=async()=>{const error=new Error('operation not supported');error.code='ENOTSUP';throw error;};
  try{
    const pending=savePublicAsset({url,workspace:root,assetFetcher:async()=>({url,status:200,contentType:'application/zip',buffer:payload})});
    await new Promise(resolve=>setTimeout(resolve,30));
    await fs.writeFile(path.join(root,filename),payload);
    const result=await pending;
    assert.equal(result.created,false);assert.deepEqual(await fs.readFile(path.join(root,filename)),payload);
  }finally{fs.link=originalLink;}
});

test('failed NAS fallback write leaves an explicit fail-closed partial source for isolated recovery',async t=>{
  const root=await workspace(t),url='https://www2.census.gov/data.zip';
  const filename=`source-${createHash('sha256').update(zip).digest('hex')}.zip`,destination=path.join(await fs.realpath(root),filename);
  const originalLink=fs.link,originalOpen=fs.open;
  fs.link=async()=>{const error=new Error('operation not supported');error.code='ENOTSUP';throw error;};
  fs.open=async(file,...args)=>{
    const handle=await originalOpen(file,...args);
    if(file!==destination)return handle;
    return {writeFile:async()=>{await handle.writeFile(Buffer.from('partial'));throw new Error('simulated NAS write failure');},sync:()=>handle.sync(),close:()=>handle.close()};
  };
  try{
    await assert.rejects(savePublicAsset({url,workspace:root,assetFetcher:async()=>({url,status:200,contentType:'application/zip',buffer:zip})}),/partial file may remain/);
    assert.equal((await fs.readFile(destination)).toString(),'partial');
    assert.equal((await fs.readdir(root)).some(name=>name.startsWith('.source-download-')),false);
  }finally{fs.link=originalLink;fs.open=originalOpen;}
});

test('the exact HTTPS host list rejects other hosts and private redirects before a socket is opened',async()=>{
  const allowedHosts=['api.github.com','www2.census.gov'];
  for(const url of ['http://api.github.com/repos/nasa/nos3','https://api.github.com:444/repos/nasa/nos3','https://api.github.com.evil.test/x','https://127.0.0.1/private','https://api.github.com@evil.test/x']){
    await assert.rejects(publicFetch(url,{allowedHosts}),/allowlist|credentials/);
  }
});

test('bounded binary fetch rejects oversized headers, incomplete bodies and midstream overrun',async()=>{
  const original=https.get;
  try{
    https.get=(_url,_options,callback)=>{
      const request=new EventEmitter();request.destroy=error=>queueMicrotask(()=>request.emit('error',error));
      const response=new PassThrough();response.statusCode=200;response.headers={'content-type':'application/zip'};
      queueMicrotask(()=>{callback(response);response.write(zip);response.end(Buffer.from('extra'));});
      return request;
    };
    await assert.rejects(publicFetch('https://8.8.8.8/data.zip',{representation:'buffer',maxBytes:zip.length}),/size limit/);
    https.get=(_url,_options,callback)=>{
      const request=new EventEmitter();request.destroy=error=>queueMicrotask(()=>request.emit('error',error));
      const response=new PassThrough();response.statusCode=200;response.headers={'content-type':'application/zip','content-length':'100'};
      queueMicrotask(()=>{callback(response);response.end(zip);});return request;
    };
    await assert.rejects(publicFetch('https://8.8.8.8/data.zip',{representation:'buffer',maxBytes:8}),/size limit/);
    https.get=(_url,_options,callback)=>{
      const request=new EventEmitter();request.destroy=error=>queueMicrotask(()=>request.emit('error',error));
      const response=new PassThrough();response.statusCode=200;response.headers={'content-type':'application/zip','content-length':'100'};
      queueMicrotask(()=>{callback(response);response.end(zip);});return request;
    };
    await assert.rejects(publicFetch('https://8.8.8.8/data.zip',{representation:'buffer',maxBytes:200}),/length mismatch/);
    https.get=(_url,_options,callback)=>{
      const request=new EventEmitter();request.destroy=error=>queueMicrotask(()=>request.emit('error',error));
      const response=new PassThrough();response.statusCode=200;response.headers={'content-type':'application/zip'};
      queueMicrotask(()=>{callback(response);response.write(zip);response.destroy();});return request;
    };
    await assert.rejects(publicFetch('https://8.8.8.8/data.zip',{representation:'buffer',maxBytes:200}),/before completion/);
  }finally{https.get=original;}
});

test('total public fetch deadline spans redirects even when the socket keeps trickling',async()=>{
  const original=https.get;let calls=0,interval;
  try{
    https.get=(_url,_options,callback)=>{
      calls++;
      const request=new EventEmitter();request.destroy=error=>queueMicrotask(()=>request.emit('error',error));
      if(calls===1){
        const response=new PassThrough();response.statusCode=302;response.headers={location:'https://8.8.8.8/second.zip'};
        setTimeout(()=>{callback(response);response.end();},5);
      }else{
        const response=new PassThrough();response.statusCode=200;response.headers={'content-type':'application/zip'};
        queueMicrotask(()=>{callback(response);interval=setInterval(()=>response.write(Buffer.from('x')),5);});
      }
      return request;
    };
    await assert.rejects(publicFetch('https://8.8.8.8/first.zip',{representation:'buffer',maxBytes:1000,totalTimeoutMs:35}),/deadline exceeded/);
    assert.equal(calls,2);
  }finally{clearInterval(interval);https.get=original;}
});

test('the public fetch deadline also bounds DNS resolution',async()=>{
  await assert.rejects(lookupBeforeDeadline('example.org',Date.now()+15,undefined,{resolver:()=>new Promise(()=>{})}),/deadline exceeded/);
});

test('malformed redirect Location rejects the Promise and does not crash subsequent fetches',async()=>{
  const original=https.get;let calls=0;
  try{
    https.get=(_url,_options,callback)=>{
      calls++;
      const request=new EventEmitter();request.destroy=error=>queueMicrotask(()=>request.emit('error',error));
      const response=new PassThrough();
      response.statusCode=calls===1?302:200;
      response.headers=calls===1?{location:'http://['}:{'content-type':'application/json'};
      queueMicrotask(()=>{callback(response);response.end(calls===1?'':'{}');});
      return request;
    };
    await assert.rejects(publicFetch('https://8.8.8.8/a',{representation:'buffer'}),/Invalid public redirect URL/);
    const next=await publicFetch('https://8.8.8.8/b',{representation:'buffer'});
    assert.equal(next.buffer.toString(),'{}');
  }finally{https.get=original;}
});

test('binary asset redirects cannot downgrade from HTTPS to HTTP',async()=>{
  const originalHttps=https.get,originalHttp=http.get;let contactedHttp=false;
  try{
    https.get=(_url,_options,callback)=>{
      const request=new EventEmitter();request.destroy=error=>queueMicrotask(()=>request.emit('error',error));
      const response=new PassThrough();response.statusCode=302;response.headers={location:'http://9.9.9.9/data.zip'};
      queueMicrotask(()=>{callback(response);response.end();});return request;
    };
    http.get=()=>{contactedHttp=true;throw new Error('HTTP socket must not open');};
    await assert.rejects(publicFetch('https://8.8.8.8/data.zip',{representation:'buffer',requireHttps:true}),/remain HTTPS/);
    assert.equal(contactedHttp,false);
  }finally{https.get=originalHttps;http.get=originalHttp;}
});
