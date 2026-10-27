export function createProfessionalRoutes({professionalModels,stfCase,store,jsonBody,send}){
 return async ({req,res,parts,project})=>{
  const resource=parts[3];if(!['professional','stf-case'].includes(resource))return false;
  const done=(code,data)=>{send(res,code,data);return true;},projectId=project.id;
  const ctx={source:'user',threadId:project.coordinatorThreadId};
  if(resource==='stf-case'){
   if(!stfCase)throw Object.assign(Error('STF case service unavailable'),{status:503});
   if(parts.length===4&&req.method==='GET')return done(200,await stfCase.catalog());
   if(parts.length===4&&req.method==='POST'){const body=await jsonBody(req);return done(201,await stfCase.create({workspace:store.workspace(projectId),variant:body.variant},ctx));}
  }
  const service=professionalModels;
  if(!service)throw Object.assign(Error('Professional model service unavailable'),{status:503});
  const action=parts[4],method=req.method;
  if(parts.length===4&&method==='GET')return done(200,await service.catalog({projectId}));
  if(action==='models'&&parts.length===5&&method==='GET')return done(200,await service.listModels({projectId}));
  if(action==='model'&&parts.length===5&&method==='GET')return done(200,await service.readModel({projectId,path:new URL(req.url,'http://localhost').searchParams.get('path')}));
  if(action==='model'&&parts.length===5&&method==='PUT'){const body=await jsonBody(req);return done(200,await service.saveModel({...body,projectId},ctx));}
  if(action==='environment'&&parts.length===5&&method==='GET')return done(200,await service.environmentStatus({projectId}));
  if(action==='environment'&&parts[5]==='prepare'&&parts.length===6&&method==='POST'){await jsonBody(req);return done(200,await service.prepare({projectId},ctx));}
  if(action==='jobs'){
   if(parts.length===5&&method==='GET')return done(200,await service.list({projectId}));
   if(parts.length===5&&method==='POST'){const body=await jsonBody(req);return done(202,await service.submit({...body,projectId},ctx));}
   const jobId=parts[5];
   if(parts.length===6&&method==='GET')return done(200,await service.status({projectId,jobId}));
   if(parts[6]==='output'&&parts.length===7&&method==='GET'){const file=new URL(req.url,'http://localhost').searchParams.get('file'),output=await service.readOutput({projectId,jobId,file});return done(200,{file,contentBase64:output.buffer.toString('base64'),contentType:output.contentType,sha256:output.sha256});}
   if(parts[6]==='wait'&&parts.length===7&&method==='POST'){const body=await jsonBody(req);return done(200,await service.wait({projectId,jobId},{timeoutMs:body.timeoutMs??1800000}));}
   if(parts[6]==='result'&&parts.length===7&&method==='GET')return done(200,await service.result({projectId,jobId}));
   if(parts[6]==='cancel'&&parts.length===7&&method==='POST'){await jsonBody(req);return done(200,await service.cancel({projectId,jobId},ctx));}
  }
  throw Object.assign(Error('Professional tool route not found'),{status:404});
 };
}
