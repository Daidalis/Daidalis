import http from 'node:http';
import fs from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {StringDecoder} from 'node:string_decoder';
import {pipeline} from 'node:stream/promises';

function redactStream(secret){
  const decoder=new StringDecoder('utf8');let pending='';
  return new Transform({transform(chunk,encoding,done){
    pending+=decoder.write(chunk);let output='';
    while(pending.length>=secret.length){
      const index=pending.indexOf(secret);
      if(index>=0){output+=pending.slice(0,index)+'[REDACTED]';pending=pending.slice(index+secret.length);}
      else{const length=pending.length-secret.length+1;output+=pending.slice(0,length);pending=pending.slice(length);break;}
    }
    done(null,output);
  },flush(done){done(null,(pending+decoder.end()).split(secret).join('[REDACTED]'));}});
}

// Tokens are scoped to one native turn and one operator-configured model endpoint.
// Tasks never receive the upstream API credential or choose the upstream URL.
export async function createModelGateway({socketPath,fetchImpl=fetch}={}){
  const grants=new Map();
  await fs.rm(socketPath,{force:true});
  const server=http.createServer(async(req,res)=>{
    const token=(req.headers.authorization||'').replace(/^Bearer /i,'')||req.headers['x-api-key'];
    const grant=grants.get(token),route=(req.url||'').split('?')[0];
    const allowed=grant?.runtime==='codex-app-server'?['/v1/responses']:['/v1/messages','/v1/messages/count_tokens'];
    if(!grant||Date.now()>grant.expires||req.method!=='POST'||!allowed.includes(route)||grant.active.size>=4||grant.calls>=256){res.writeHead(403);res.end('Model proxy request denied');req.resume();return;}
    const control=new AbortController();grant.active.add(control);grant.calls++;
    res.on('close',()=>{if(!res.writableEnded)control.abort();});
    try{
      let bytes=0;const chunks=[];
      for await(const chunk of req){bytes+=chunk.length;if(bytes>16*1024*1024)throw Error('Model request exceeds limit');chunks.push(chunk);}
      const body=JSON.parse(Buffer.concat(chunks));
      if(body.model!==grant.model)throw Error('Model differs from selected provider');
      const headers={'content-type':'application/json'};
      if(grant.runtime==='codex-app-server')headers.authorization='Bearer '+grant.apiKey;
      else{headers['x-api-key']=grant.apiKey;headers['anthropic-version']='2023-06-01';if(req.headers['anthropic-beta'])headers['anthropic-beta']=req.headers['anthropic-beta'];}
      const upstream=await fetchImpl(grant.baseUrl+route.slice(3),{method:'POST',headers,body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.any([control.signal,AbortSignal.timeout(180000)])});
      if(upstream.status>=300&&upstream.status<400)throw Error('Model redirects are not allowed');
      res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')||'application/json','cache-control':'no-store'});
      if(upstream.body)await pipeline(Readable.fromWeb(upstream.body),redactStream(grant.apiKey),res);else res.end();
    }catch(error){if(!res.headersSent){res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:control.signal.aborted?'Model request cancelled':'Model proxy request failed'}}));}else res.destroy();}
    finally{grant.active.delete(control);}
  });
  server.requestTimeout=190000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});await fs.chmod(socketPath,0o660);
  return {grant({runtime,baseUrl,apiKey,model}){
    if(!['codex-app-server','claude-agent-sdk'].includes(runtime)||typeof apiKey!=='string'||!apiKey||apiKey.length>16384||typeof model!=='string'||!model)throw Error('Isolated native Agents require an explicit API key and model');
    const url=new URL(baseUrl||(runtime==='codex-app-server'?'https://api.openai.com/v1':'https://api.anthropic.com/v1'));
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('Invalid native model endpoint');
    let base=url.href.replace(/\/$/,'').replace(/\/(responses|messages)$/,'');
    if(!base.endsWith('/v1'))base+='/v1';
    const token=randomBytes(32).toString('hex'),entry={runtime,apiKey,model,baseUrl:base,expires:Date.now()+3600000,calls:0,active:new Set()};grants.set(token,entry);
    return {token,baseUrl:'http://127.0.0.1:18765/v1',revoke(){grants.delete(token);for(const c of entry.active)c.abort();}};
  },async close(){for(const entry of grants.values())for(const c of entry.active)c.abort();grants.clear();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(socketPath,{force:true});}};
}
