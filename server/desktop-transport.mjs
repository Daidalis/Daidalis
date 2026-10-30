import http from 'node:http';

export function desktopRequest(socketPath,route,payload,{signal}={}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(Error('Cancelled'));
    const data=JSON.stringify(payload);
    const req=http.request({socketPath,path:route,method:'POST',headers:{'content-type':'application/json','content-length':Buffer.byteLength(data)}},res=>{
      const chunks=[];let size=0;
      res.on('data',b=>{size+=b.length;if(size>32*1024*1024)req.destroy(Error('Runner response too large'));else chunks.push(b);});
      res.on('error',reject);
      res.on('end',()=>{try{const result=JSON.parse(Buffer.concat(chunks));if(res.statusCode!==200||result.error)throw Error(result.error||'Runner failed');resolve(result);}catch(e){reject(e);}});
    });
    const abort=()=>req.destroy(Error('Cancelled'));
    signal?.addEventListener('abort',abort,{once:true});
    req.on('close',()=>signal?.removeEventListener('abort',abort));
    req.on('error',reject);
    req.setTimeout((payload.timeoutMs||60000)+30000,()=>{req.destroy(Error('Runner transport timed out'));});
    req.end(data);
  });
}
