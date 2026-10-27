export function createEngineeringStateRoutes({service,jsonBody,send}) {
  return async function route({req,res,parts,project}) {
    if(parts[3]!=='engineering-state')return false;
    if(!service)throw Object.assign(new Error('工程记录服务不可用'),{status:503});
    const method=req.method,actor={kind:'user',id:'local-user'};
    let result,status=201;
    if(method==='GET'&&parts.length===4){result=await service.get(project.id);status=200;}
    else if(method==='POST'){
      const body=await jsonBody(req);
      if(parts.length===5&&parts[4]==='objects')result=await service.upsertObject(project.id,body,{actor});
      else if(parts.length===5&&parts[4]==='snapshots')result=await service.captureSnapshot(project.id,body,{actor});
      else if(parts.length===7&&parts[4]==='snapshots'&&parts[6]==='approve'){result=await service.approveSnapshot(project.id,parts[5],body,{actor});status=200;}
      else if(parts.length===5&&parts[4]==='changes')result=await service.createChange(project.id,body,{actor});
      else if(parts.length===5&&parts[4]==='evidence')result=await service.registerEvidence(project.id,body,{actor});
      else throw Object.assign(new Error('工程记录操作不存在'),{status:404});
    }else throw Object.assign(new Error('不支持此工程记录操作'),{status:405});
    send(res,status,result);return true;
  };
}
