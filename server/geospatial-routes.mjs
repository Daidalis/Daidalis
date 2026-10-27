export function createGeospatialRoutes({geospatialJobs,jsonBody,send}){
  return async ({req,res,parts,project})=>{
    if(parts[3]!=='geospatial')return false;
    if(!geospatialJobs)throw Object.assign(Error('Geospatial service unavailable'),{status:503});
    const done=(code,data)=>{send(res,code,data);return true;},projectId=project.id,action=parts[4],method=req.method;
    const ctx={source:'user',threadId:project.coordinatorThreadId};
    if(parts.length===4&&method==='GET')return done(200,await geospatialJobs.catalog({projectId}));
    if(action==='environment'&&parts.length===5&&method==='GET')return done(200,(await geospatialJobs.catalog({projectId})).environment);
    if(action==='environment'&&parts[5]==='prepare'&&parts.length===6&&method==='POST'){await jsonBody(req);return done(200,await geospatialJobs.prepare({projectId},ctx));}
    if(action==='jobs'){
      if(parts.length===5&&method==='GET')return done(200,await geospatialJobs.list({projectId}));
      if(parts.length===5&&method==='POST'){const body=await jsonBody(req);return done(202,await geospatialJobs.submit({...body,projectId},ctx));}
      const jobId=parts[5];
      if(parts.length===6&&method==='GET')return done(200,await geospatialJobs.status({projectId,jobId}));
      if(parts[6]==='result'&&parts.length===7&&method==='GET')return done(200,await geospatialJobs.result({projectId,jobId}));
      if(parts[6]==='wait'&&parts.length===7&&method==='POST'){const body=await jsonBody(req);return done(200,await geospatialJobs.wait({projectId,jobId},{timeoutMs:body.timeoutMs??1800000}));}
      if(parts[6]==='cancel'&&parts.length===7&&method==='POST'){await jsonBody(req);return done(200,await geospatialJobs.cancel({projectId,jobId},ctx));}
      if(parts[6]==='output'&&parts.length===7&&method==='GET'){const file=new URL(req.url,'http://localhost').searchParams.get('file'),data=await geospatialJobs.readOutput({projectId,jobId,file});return done(200,{file,contentBase64:data.buffer.toString('base64'),contentType:data.contentType,sha256:data.sha256});}
    }
    throw Object.assign(Error('Geospatial route not found'),{status:404});
  };
}
