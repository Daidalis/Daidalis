export function createOrbitGroundRoutes({orbitGroundJobs,jsonBody,send}){
  return async ({req,res,parts,project})=>{
    if(parts[3]!=='orbit-ground')return false;
    if(!orbitGroundJobs)throw Object.assign(Error('Orbit-ground service unavailable'),{status:503});
    const done=(code,data)=>{send(res,code,data);return true;},projectId=project.id,action=parts[4],method=req.method;
    const ctx={source:'user',threadId:project.coordinatorThreadId};
    if(parts.length===4&&method==='GET')return done(200,await orbitGroundJobs.catalog({projectId}));
    if(action==='jobs'){
      if(parts.length===5&&method==='GET')return done(200,await orbitGroundJobs.list({projectId}));
      if(parts.length===5&&method==='POST')return done(202,await orbitGroundJobs.submit({...await jsonBody(req),projectId},ctx));
      const jobId=parts[5];
      if(parts.length===6&&method==='GET')return done(200,await orbitGroundJobs.status({projectId,jobId}));
      if(parts.length===7&&parts[6]==='result'&&method==='GET')return done(200,await orbitGroundJobs.result({projectId,jobId}));
      if(parts.length===7&&parts[6]==='wait'&&method==='POST'){const body=await jsonBody(req);return done(200,await orbitGroundJobs.wait({projectId,jobId},{timeoutMs:body.timeoutMs??1800000}));}
      if(parts.length===7&&parts[6]==='cancel'&&method==='POST'){await jsonBody(req);return done(200,await orbitGroundJobs.cancel({projectId,jobId},ctx));}
    }
    throw Object.assign(Error('Orbit-ground route not found'),{status:404});
  };
}
