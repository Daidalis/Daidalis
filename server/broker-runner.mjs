import fs from 'node:fs/promises';
import path from 'node:path';
import {desktopRequest as request} from './desktop-transport.mjs';
import {createTaskRunner} from './container-task-runner.mjs';

export function createBrokerRunner({socketPath=process.env.MANTA_BROKER_SOCKET,projectsRoot=process.env.MANTA_PROJECTS_ROOT||'/projects',transport=request}={}){
  if(!socketPath)throw Error('Broker mode requires MANTA_BROKER_SOCKET; no shared execution fallback');
  const commands=new Map();
  const invoke=(payload,ctx={})=>transport(socketPath,'/task',payload,ctx);
  const runner=createTaskRunner({invoke,isolated:true});
  return {...runner,async command({workspace,command,timeoutMs=30000,signal}){
    const [base,root]=await Promise.all([fs.realpath(projectsRoot),fs.realpath(workspace)]);
    const project=path.relative(base,root);
    if(!/^project-[A-Za-z0-9_-]{1,100}$/.test(project))throw Error('Broker commands require a managed project directly under MANTA_PROJECTS_ROOT');
    const previous=commands.get(root)||Promise.resolve();
    const task=previous.catch(()=>{}).then(()=>invoke({kind:'command',project,command,timeoutMs}, {signal}));
    commands.set(root,task);
    try{return await task;}finally{if(commands.get(root)===task)commands.delete(root);}
  }};
}
