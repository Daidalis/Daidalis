import {buildEngineeringRegistry} from './tool-registry.mjs';
import {submitValidatedNos3Job} from './integration-tools.mjs';
export function createIntegrationRoutes({connectors,nos3,modelBackend,engineering,professionalModels,geospatialJobs,orbit42Jobs,orbitGroundJobs,computer,jsonBody,send,emit}){
  return async function route({req,res,parts,project}){
    const method=req.method,projectId=project.id,resource=parts[3];
    if(!['integrations','connectors','nos3','model-backend'].includes(resource))return false;
    const finish=(status,data)=>{send(res,status,data);return true;};
    const need=(service,label)=>{if(!service)throw Object.assign(new Error(label+' unavailable'),{status:503});return service;};
    if(resource==='integrations'&&parts.length===4&&method==='GET'){
      const results=await Promise.allSettled([connectors?.list(projectId),modelBackend?.catalog({projectId}),nos3?.inspect({projectId}),nos3?.list({projectId}),engineering?.catalog(),computer?.status(),professionalModels?.catalog({projectId}),geospatialJobs?.catalog({projectId}),orbit42Jobs?.catalog({projectId}),orbitGroundJobs?.catalog({projectId})]);
      const value=i=>results[i].status==='fulfilled'?results[i].value:{available:false,error:results[i].reason.message};
      const native=i=>results[i].status==='fulfilled'?results[i].value:{error:true};
      const data={projectId,connectors:value(0)||[],modelBackend:value(1)||{available:false},nos3:value(2)||{available:false},jobs:value(3)||[]};
      return finish(200,{...data,registry:buildEngineeringRegistry({...data,engineering:value(4),computer:value(5),professional:value(6),geospatial:native(7),orbit42:native(8),orbitGround:orbitGroundJobs?native(9):null})});
    }
    if(resource==='connectors'){
      const service=need(connectors,'MCP');
      if(parts.length===4&&method==='GET')return finish(200,await service.list(projectId));
      if(parts.length===4&&method==='POST'){
        const body=await jsonBody(req),{runtimeKey,...input}=body;
        const config=await service.save(projectId,input,{userInitiated:true,runtimeKey});
        emit({projectId,type:'connector.configured',message:'MCP connection updated',data:{id:config.id,name:config.name}});
        return finish(200,config);
      }
      const connectorId=parts[4];
      if(parts.length===5&&method==='DELETE'){await service.remove(projectId,connectorId,{userInitiated:true});return finish(200,{ok:true});}
      if(parts.length===6&&parts[5]==='test'&&method==='POST'){await jsonBody(req);return finish(200,await service.test(projectId,connectorId));}
      if(parts.length===6&&parts[5]==='tools'&&method==='GET')return finish(200,await service.tools(projectId,connectorId));
    }
    if(resource==='model-backend'){
      const service=need(modelBackend,'Model backend');
      if(parts.length===4&&method==='GET')return finish(200,await service.catalog({projectId}));
      const operations={'import':'importModel','prepare-nos3':'generateNos3Model','query':'query','validate':'validate','export':'exportModel','verify':'verify'};
      if(parts.length===5&&method==='POST'&&operations[parts[4]]){
        const body=await jsonBody(req);return finish(200,await service[operations[parts[4]]]({...body,projectId},{source:'user',threadId:project.coordinatorThreadId}));
      }
    }
    if(resource==='nos3'){
      const service=need(nos3,'NOS3');
      if(parts.length===4&&method==='GET')return finish(200,await service.inspect({projectId}));
      if(parts.length===5&&parts[4]==='environment'&&method==='GET')return finish(200,await service.environmentStatus({projectId}));
      if(parts.length===6&&parts[4]==='environment'&&parts[5]==='prepare'&&method==='POST'){await jsonBody(req);return finish(200,await service.prepareEnvironment({projectId}));}
      if(parts.length===6&&parts[4]==='environment'&&parts[5]==='stop'&&method==='POST'){await jsonBody(req);return finish(200,await service.stopEnvironment({projectId}));}
      if(parts.length===5&&parts[4]==='worker'&&method==='PUT'){const b=await jsonBody(req);return finish(200,await service.configure({projectId,worker:b.worker}));}
      if(parts[4]==='jobs'){
        if(parts.length===5&&method==='GET')return finish(200,await service.list({projectId}));
        if(parts.length===5&&method==='POST'){const b=await jsonBody(req);return finish(202,await submitValidatedNos3Job({nos3:service,modelBackend},{...b,projectId},{source:'user',threadId:project.coordinatorThreadId}));}
        const jobId=parts[5];
        if(parts.length===6&&method==='GET')return finish(200,await service.status({projectId,jobId}));
        if(parts.length===7&&parts[6]==='result'&&method==='GET')return finish(200,await service.result({projectId,jobId}));
        if(parts.length===7&&parts[6]==='cancel'&&method==='POST'){await jsonBody(req);return finish(200,await service.cancel({projectId,jobId}));}
      }
    }
    throw Object.assign(new Error('Engineering connection route not found'),{status:404});
  };
}
