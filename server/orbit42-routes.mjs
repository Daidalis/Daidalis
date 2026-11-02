export function createOrbit42Routes({orbit42Jobs,jsonBody,send}){
 return async({req,res,parts,project})=>{
  if(parts[3]!=='orbit42')return false;
  if(!orbit42Jobs)throw Object.assign(Error('Orbit 42 service unavailable'),{status:503});
  const done=(code,value)=>{send(res,code,value);return true;},projectId=project.id,action=parts[4],method=req.method,ctx={source:'user',threadId:project.coordinatorThreadId};
  if(parts.length===4&&method==='GET')return done(200,await orbit42Jobs.catalog({projectId}));
  if(action==='model'&&parts.length===5){
   if(method==='GET')return done(200,await orbit42Jobs.readModel({projectId,path:new URL(req.url,'http://localhost').searchParams.get('path')}));
   if(method==='PUT')return done(200,await orbit42Jobs.saveModel({...await jsonBody(req),projectId},ctx));
  }
  if(action==='jobs'){
   if(parts.length===5&&method==='GET')return done(200,await orbit42Jobs.list({projectId}));
   if(parts.length===5&&method==='POST')return done(202,await orbit42Jobs.submit({...await jsonBody(req),projectId},ctx));
   const jobId=parts[5];
   if(parts.length===6&&method==='GET')return done(200,await orbit42Jobs.status({projectId,jobId}));
   if(parts.length===7&&method==='GET'&&parts[6]==='result')return done(200,await orbit42Jobs.result({projectId,jobId}));
   if(parts.length===7&&method==='POST'&&parts[6]==='wait'){const body=await jsonBody(req);return done(200,await orbit42Jobs.wait({projectId,jobId},{timeoutMs:body.timeoutMs??180000}));}
   if(parts.length===7&&method==='POST'&&parts[6]==='cancel'){await jsonBody(req);return done(200,await orbit42Jobs.cancel({projectId,jobId},ctx));}
  }
  throw Object.assign(Error('Orbit 42 route not found'),{status:404});
 };
}
