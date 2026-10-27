import './environment.mjs';
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createStore,id,now,DEFAULT_RESOURCES} from './store.mjs';
import {createProviderManager} from './providers.mjs';
import {redactPublicValue} from './public-redaction.mjs';
import {createEngine} from './engine.mjs';
import {createCodexModelCatalog} from './codex-models.mjs';
import {createSettingsService} from './settings.mjs';
import {checkGraph,sanitizeGraph,NODE_TYPES,LINK_TYPES} from './model.mjs';
import {safePath,commandSandboxAvailable} from './sandbox.mjs';
import {createConnectorService} from './connectors.mjs';
import {createNos3Service} from './nos3.mjs';
import {createLocalLinuxVmService} from './local-linux-vm.mjs';
import {createModelBackendService} from './model-backend.mjs';
import {createIntegrationRoutes} from './integration-routes.mjs';
import {createWorkspaceViewer,createWorkspaceViewerRoutes} from './workspace-viewer.mjs';
import {createEngineeringStateService} from './engineering-state.mjs';
import {createEngineeringStateRoutes} from './engineering-state-routes.mjs';
import {createEngineeringPlanService} from './engineering-plan.mjs';
import {createProfessionalDispatcher} from './professional-dispatcher.mjs';
import {createProfessionalRunnerService} from './professional-runner.mjs';
import {createProfessionalModelsService} from './professional-models.mjs';
import {createProfessionalRoutes} from './professional-routes.mjs';
import {createGeospatialRunner} from './geospatial-runner.mjs';
import {createGeospatialJobsService} from './geospatial-jobs.mjs';
import {createGeospatialRoutes} from './geospatial-routes.mjs';
import {createOrbit42Service} from './orbit42.mjs';
import {createOrbitGroundRunner} from './orbit-ground-runner.mjs';
import {createOrbitGroundService} from './orbit-ground.mjs';
import {createOrbitGroundRoutes} from './orbit-ground-routes.mjs';
import {createStfCaseService} from './stf-case.mjs';

const defaultRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ORBIT_GROUND_WORKER_SHA256='c7edd7901307227f2e2bda4a928c7db84925d2f8de4d7ef66665d99fa3e5ec08';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon'};
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
function textField(value,name,{required=false,max=100000}={}){if(value===undefined&&!required)return undefined;if(typeof value!=='string'||(required&&!value.trim())||value.length>max)throw new HttpError(400,`${name} must be ${required?'nonempty ':''}text up to ${max} characters`);return value;}
function resourceFields(value,current=DEFAULT_RESOURCES){if(value===undefined)return {...current};if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(400,'resources must be an object');const limits={maxConcurrentAgents:[1,32],maxTasksPerRun:[1,100],maxAutoResumes:[0,10],maxAutoTurns:[1,12],maxAutoRunMs:[1000,300000]};const result={...current};for(const [key,v]of Object.entries(value)){if(!limits[key])throw new HttpError(400,`Unknown resource setting: ${key}`);if(!Number.isInteger(v)||v<limits[key][0]||v>limits[key][1])throw new HttpError(400,`Invalid resource value: ${key}`);result[key]=v;}return result;}
async function jsonBody(req){if(req.headers['content-type']?.split(';')[0]!=='application/json')throw new HttpError(415,'Use application/json for API changes');let n=0,body='';for await(const chunk of req){n+=chunk.length;if(n>2*1024*1024)throw new HttpError(413,'Request exceeds 2 MB');body+=chunk;}try{const result=JSON.parse(body||'{}');if(!result||typeof result!=='object'||Array.isArray(result))throw Error();return result;}catch{throw new HttpError(400,'Invalid JSON object');}}
function publicTask(task){
  // Dataset evaluator/holdout sections are deliberately never copied through.
  const allowed=['id','project','projectName','projectId','title','name','repository','repositoryUrl','repo','url','issue','issueNumber','issueUrl','issueTitle','issueState','status','domain','category','difficulty','summary','problem','description','prompt','publicPrompt','inputs','limitations','evidenceLevel','executionStatus','environment','baselineCommit','hardwareRequired','hardwareScope','upstreamFacts','curatorAdditions','task','taskBrief','requestedChange','source','sources','sourceNotes','publicSources','evidenceStatus','verificationStatus','reproductionStatus','scope','tags','learningGoals','deliverables','expectedDeliverables','publicAcceptance','acceptanceCriteria','gates','publicGates','constraints','starterFiles','instructions','contractChallenge','createdAt','updatedAt','retrievedAt','researchDate','sourceVerifiedAt'];
  return Object.fromEntries(allowed.filter(k=>task[k]!==undefined).map(k=>[k,task[k]]));
}
async function optionalService(file,exportName,options){try{const module=await import(pathToFileURL(file));return await module[exportName](options);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&e.message.includes(file))return null;throw e;}}
export async function createStudioServer(options={}) {
  const root=path.resolve(options.root||defaultRoot),dataDir=path.resolve(root,options.dataDir||process.env.MBSE_DATA_DIR||'data'),workspacesDir=path.resolve(root,options.workspacesDir||path.join(dataDir,'workspaces'));
  const settings=options.settings||await createSettingsService({dataDir});
  const getDefaultPermissionMode=()=>settings.get().defaultPermissionMode;
  const store=options.store||createStore({dataDir,workspacesDir,root,seed:options.seed!==false,addDefaultCodexProvider:options.addDefaultCodexProvider!==false,getDefaultPermissionMode});
  const providers=options.providers||createProviderManager({store,fetchImpl:options.fetchImpl,codexPath:options.codexPath,codexRequiresApiKey:Boolean(options.engineOptions?.codexReadIsolation||options.engineOptions?.codexRemoteWorkspace)});
  const codexModelCatalog=options.codexModelCatalog||createCodexModelCatalog({codexPath:options.codexPath});
  const subscribers=new Set();let engine;
  function emit(input){const event={id:id('event'),projectId:input.projectId||null,runId:input.runId||null,type:input.type||'update',message:providers.redact(input.message||''),data:redactPublicValue(input.data||{},providers.redact),createdAt:now()};store.data.events.push(event);if(store.data.events.length>4000)store.data.events.splice(0,store.data.events.length-4000);store.save();for(const client of subscribers)if(!client.projectId||event.projectId===client.projectId){client.res.write(`id: ${event.id}\nevent: update\ndata: ${JSON.stringify(event)}\n\n`);}return event;}
  const requestApproval=input=>engine?engine.requestApproval(input):Promise.resolve(false);
  const serviceOptions={root,dataDir,workspacesDir,store,emit,requestApproval};
  const engineeringState=options.engineeringState===false?null:options.engineeringState||createEngineeringStateService(serviceOptions);
  const engineeringStateRoute=createEngineeringStateRoutes({service:engineeringState,jsonBody,send});
  const engineeringPlan=options.engineeringPlan===false?null:options.engineeringPlan||createEngineeringPlanService({store,emit});
  const computer=options.computer===false?null:options.computer||await optionalService(path.join(root,'server/computer.mjs'),'createComputerService',serviceOptions);
  const evaluator=options.evaluator===false?null:options.evaluator||await optionalService(path.join(root,'server/evaluator.mjs'),'createEvaluator',serviceOptions);
  const engineering=options.engineering===false?null:options.engineering||await optionalService(path.join(root,'server/engineering.mjs'),'createEngineeringService',serviceOptions);
  const connectors=options.connectors===false?null:options.connectors||await createConnectorService({store,env:options.connectorEnv||process.env});
  let vmRoot=options.vmRoot||process.env.MANTA_NOS3_VM_ROOT;
  if(!vmRoot){try{vmRoot=JSON.parse(await fsp.readFile(path.join(dataDir,'nos3/local-vm.json'),'utf8')).vmRoot;}catch(error){if(error.code!=='ENOENT')throw error;}}
  const localVm=options.localVm===false?null:options.localVm||(vmRoot?createLocalLinuxVmService({vmRoot,store,emit}):null);
  const nos3=options.nos3===false?null:options.nos3||await createNos3Service({...serviceOptions,fetchImpl:options.workerFetchImpl,localVm});
  const modelBackend=options.modelBackend===false?null:options.modelBackend||await createModelBackendService(serviceOptions);
  const professionalRunner=options.professionalRunner===false?null:options.professionalRunner||(vmRoot?(options.professionalMode==='generic-only'?createProfessionalRunnerService({vmRoot,store,dataDir,emit}):createProfessionalDispatcher({vmRoot,store,dataDir,emit})):null);
  const professionalModels=options.professionalModels===false?null:options.professionalModels||await createProfessionalModelsService({...serviceOptions,runner:professionalRunner,sysmlBackend:modelBackend});
  const geospatialEnabled=options.geospatial===true||(options.geospatial!==false&&options.professionalMode!=='generic-only');
  const geospatialRunner=!geospatialEnabled||options.geospatialRunner===false?null:options.geospatialRunner||(vmRoot?createGeospatialRunner({vmRoot}):null);
  const geospatialJobs=!geospatialEnabled||options.geospatialJobs===false?null:options.geospatialJobs||(geospatialRunner?await createGeospatialJobsService({...serviceOptions,runner:geospatialRunner}):null);
  const geospatialRoute=createGeospatialRoutes({geospatialJobs,jsonBody,send});
  const orbit42Enabled=options.orbit42===true||(options.orbit42!==false&&options.professionalMode!=='generic-only');
  const orbit42Jobs=!orbit42Enabled||options.orbit42Jobs===false?null:options.orbit42Jobs||(vmRoot?await createOrbit42Service({dataDir,store,vmRoot,emit,ensureVm:localVm?({projectId,signal})=>localVm.prepare({projectId},{signal}):undefined}):null);
  const orbitGroundEnabled=options.orbitGround===true;
  const orbitGroundRunner=!orbitGroundEnabled||options.orbitGroundRunner===false?null:options.orbitGroundRunner||(vmRoot?createOrbitGroundRunner({vmRoot,workerSha256:options.orbitGroundWorkerSha256||ORBIT_GROUND_WORKER_SHA256}):null);
  const orbitGroundJobs=!orbitGroundEnabled||options.orbitGroundJobs===false?null:options.orbitGroundJobs||(orbit42Jobs&&geospatialJobs&&orbitGroundRunner?await createOrbitGroundService({dataDir,store,orbit42Jobs,geospatialJobs,runner:orbitGroundRunner,emit,allowedCensusHashes:options.orbitGroundAllowedCensusHashes??null}):null);
  const orbitGroundRoute=createOrbitGroundRoutes({orbitGroundJobs,jsonBody,send});
  // Optional reference assets must be explicitly configured; never probe a sibling private workspace.
  const stfAssetsRoot=options.stfAssetsRoot||process.env.MANTA_STF_ASSETS_ROOT;
  const stfCase=options.stfCase===false?null:options.stfCase||(stfAssetsRoot?await createStfCaseService({root,assetsRoot:stfAssetsRoot}):null);
  const professionalRoute=createProfessionalRoutes({professionalModels,stfCase,store,jsonBody,send});
  const integrationRoute=createIntegrationRoutes({connectors,nos3,modelBackend,engineering,professionalModels,geospatialJobs,orbit42Jobs,orbitGroundJobs,computer,jsonBody,send,emit});
  const workspaceViewer=createWorkspaceViewer({store,modelBackend,nos3,professionalModels,geospatialJobs,orbit42Jobs,orbitGroundJobs,emit});
  const workspaceRoute=createWorkspaceViewerRoutes({viewer:workspaceViewer,send,jsonBody});
  engine=createEngine({store,providers,emit,computer,engineering,engineeringState,engineeringPlan,professionalModels,geospatialJobs,orbit42Jobs,orbitGroundJobs,connectors,nos3,modelBackend,commandExecutor:options.commandExecutor,webFetcher:options.webFetcher,assetFetcher:options.assetFetcher,getDefaultPermissionMode,codexPath:options.codexPath,...options.engineOptions});
  let server;
  async function readDataset(){try{const parsed=JSON.parse(await fsp.readFile(path.join(root,'datasets/real-issues.v1.json'),'utf8'));return {tasks:Array.isArray(parsed)?parsed:parsed.tasks||parsed.issues||[],summary:parsed.summary||{},meta:parsed.meta||{}};}catch(e){if(e.code==='ENOENT')return{tasks:[],summary:{count:0,status:'dataset-not-installed'},meta:{}};throw e;}}
  function requireRow(collection,key){const row=store.get(collection,key);if(!row)throw new HttpError(404,`${collection.slice(0,-1)} not found`);return row;}
  function graph(projectId){const m=store.data.models.find(m=>m.projectId===projectId);return m?{nodes:m.nodes,links:m.links,version:m.version}:{nodes:[],links:[],version:0};}
  function threadDetail(threadId){
    const thread=requireRow('threads',threadId),runs=store.data.runs.filter(x=>x.threadId===threadId),runIds=new Set(runs.map(r=>r.id));
    // The store already bounds retained public events to 4,000. Do not discard an
    // older run's tool history merely because this thread has many later runs.
    const events=[],byRun=new Map(runs.map(r=>[r.id,[]]));for(const event of store.data.events){if(runIds.has(event.runId)){events.push(event);byRun.get(event.runId).push(event);}else if(!event.runId&&event.projectId===thread.projectId)events.push(event);}
    const oldest=Date.parse(store.data.events[0]?.createdAt||''),perRun={};
    for(const run of runs){const recorded=byRun.get(run.id),types=new Set(recorded.map(e=>e.type)),terminal=['completed','failed','cancelled','interrupted'].includes(run.status),hasStart=types.has('run.started'),hasQueue=types.has('run.queued'),hasFinish=types.has('run.finished');
      const complete=terminal?hasFinish&&(hasStart||(!run.startedAt&&hasQueue)):(hasStart||(run.status==='queued'&&hasQueue));
      const began=Date.parse(run.startedAt||run.createdAt||''),truncated=!complete&&((recorded.length>0&&Boolean(run.startedAt)&&!hasStart)||(recorded.length===0&&Number.isFinite(oldest)&&Number.isFinite(began)&&began<oldest));
      perRun[run.id]={retainedCount:recorded.length,returnedCount:recorded.length,totalCount:null,complete,truncated,reason:complete?null:truncated?'retained-event-prefix-unavailable':recorded.length?'run-boundary-unavailable':'event-history-unavailable',detailLimit:4000};
    }
    const eventHistory={source:'retained-public-events',retainedCount:events.length,returnedCount:events.length,totalCount:null,retentionLimit:4000,detailLimit:4000,complete:Object.values(perRun).every(x=>x.complete),truncated:Object.values(perRun).some(x=>x.truncated),reason:Object.values(perRun).some(x=>x.truncated)?'retained-event-prefix-unavailable':null,perRun};
    return {thread:redactPublicValue(engine.overview(thread),providers.redact),coordinatorThreadId:store.get('projects',thread.projectId).coordinatorThreadId,childThreads:redactPublicValue(store.data.threads.filter(t=>t.parentThreadId===threadId).map(engine.overview),providers.redact),steerings:redactPublicValue(store.data.steerings.filter(s=>s.threadId===threadId),providers.redact),messages:redactPublicValue(store.data.messages.filter(x=>x.threadId===threadId),providers.redact),runs:redactPublicValue(runs,providers.redact),agents:redactPublicValue(store.data.agents.filter(x=>runIds.has(x.runId)||x.threadId===threadId),providers.redact),artifacts:store.data.artifacts.filter(x=>x.threadId===threadId),events:events.map(e=>redactPublicValue(e,providers.redact)),eventHistory,approvals:store.data.approvals.filter(x=>runIds.has(x.runId)).map(a=>redactPublicValue(a,providers.redact)),evaluations:store.data.evaluations.filter(x=>x.projectId===thread.projectId)};
  }
  function send(res,status,payload,headers={}){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});res.end(JSON.stringify(payload));}
  function sendRuntime(res,status,payload){return send(res,status,redactPublicValue(payload,providers.redact));}
  function protect(req){
    const port=server.address()?.port,host=req.headers.host;
    const allowed=new Set([`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`]);
    if(!allowed.has(host))throw new HttpError(403,'Invalid Host header');
    const origin=req.headers.origin;
    if(origin){let u;try{u=new URL(origin);}catch{throw new HttpError(403,'Invalid Origin');}if(u.protocol!=='http:'||!allowed.has(u.host)||u.pathname!=='/'||u.username||u.password)throw new HttpError(403,'Cross-origin requests are blocked');}
    if(req.headers['sec-fetch-site']==='cross-site')throw new HttpError(403,'Cross-site requests are blocked');
  }
  async function route(req,res){
    res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');res.setHeader('x-frame-options',req.url?.split('?')[0]==='/engineering.html'?'SAMEORIGIN':'DENY');
    protect(req);
    const url=new URL(req.url,`http://${req.headers.host}`),parts=url.pathname.split('/').filter(Boolean).map(p=>decodeURIComponent(p));
    if(parts[0]!=='api') {
      if(req.method!=='GET'&&req.method!=='HEAD')throw new HttpError(405,'Method not allowed');
      const sharedName={'/shared/run-presentation.mjs':'run-presentation.mjs','/shared/task-tree.mjs':'task-tree.mjs'}[url.pathname],sharedModule=Boolean(sharedName);if(url.pathname.startsWith('/shared/')&&!sharedModule)throw new HttpError(404,'Shared module not found');const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\//,'');const file=sharedModule?safePath(path.join(root,'shared'),sharedName):safePath(path.join(root,'public'),relative);let stat;
      try{stat=await fsp.stat(file);}catch{throw new HttpError(404,'File not found');}if(!stat.isFile())throw new HttpError(404,'File not found');
      res.writeHead(200,{'content-type':MIME[path.extname(file)]||'application/octet-stream','content-length':stat.size,'content-security-policy':`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors ${relative==='engineering.html'?"'self'":"'none'"}`});if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);return;
    }
    if(req.method==='OPTIONS')throw new HttpError(403,'Cross-origin API access is not enabled');
    const method=req.method;
    if(method==='GET'&&parts[1]==='health')return send(res,200,{app:'mbse-studio',displayName:'Manta',version:'0.5.0',ok:true});
    if(parts[1]==='settings'&&parts.length===2){
      if(method==='GET')return send(res,200,settings.get());
      if(method==='PATCH')return send(res,200,await settings.patch(await jsonBody(req)));
      throw new HttpError(405,'Method not allowed');
    }
    if(method==='GET'&&parts[1]==='bootstrap') {
      const dataset=await readDataset();return send(res,200,{settings:settings.get(),projects:store.data.projects,threads:redactPublicValue(store.data.threads.map(engine.overview),providers.redact),providers:providers.list(),runs:redactPublicValue(store.data.runs.slice(-100),providers.redact),agents:redactPublicValue(store.data.agents.slice(-200),providers.redact),artifacts:store.data.artifacts,approvals:store.data.approvals.filter(a=>a.status==='pending').map(a=>redactPublicValue(a,providers.redact)),capabilities:{tools:engine.runtime.definitions.map(t=>t.name),nodeTypes:NODE_TYPES,linkTypes:LINK_TYPES,computer:computer?.status()||{browser:{available:false,status:'module-unavailable'},desktop:{available:false,status:'module-unavailable'}},commandSandbox:commandSandboxAvailable(),knowledgeSearch:'keyword-text-search (not embeddings)',evaluation:evaluator?'explicit-scope-evaluator':'unavailable',agentRuntimes:['codex-app-server','claude-agent-sdk','openai-agents-sdk'],modelSDKs:['openai','@anthropic-ai/sdk'],visionProviders:['openai-compatible','openai-responses','anthropic','ollama','codex-app-server','claude-agent'],externalMcp:connectors?'project-scoped-mcp-sdk':'unavailable',modelBackend:modelBackend?'pinned-sysml-wasm':'unavailable',nos3:nos3?'component-and-managed-linux-or-remote-worker':'unavailable',engineering:engineering?'actual-numerical-models':'unavailable',threadCoordination:'durable-coordinator-and-asynchronous-workers',permissionModes:{default:getDefaultPermissionMode(),manual:'Project mutation tools require explicit approval',auto:'Project changes, engineering and OS-sandboxed commands run automatically; native desktop/remote computer still require approval',native:'Codex uses workspace-write plus on-request in Auto. Claude uses native SDK auto classification when available, with unresolved approvals forwarded; its classifier/hooks are not an OS sandbox.',scope:'Run mode is fixed; only explicit user requests can change a later run'},limits:{defaultResources:DEFAULT_RESOURCES,maxToolTurns:options.engineOptions?.maxTurns||12}},datasetSummary:{...dataset.summary,count:dataset.tasks.length}});
    }
    if(method==='GET'&&parts[1]==='events') {
      const projectId=url.searchParams.get('projectId');if(projectId)requireRow('projects',projectId);
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive','x-accel-buffering':'no'});res.write(': connected\n\n');
      const since=req.headers['last-event-id'];if(since){const at=store.data.events.findIndex(x=>x.id===since);if(at>=0)for(const e of store.data.events.slice(at+1))if(!projectId||e.projectId===projectId)res.write(`id: ${e.id}\nevent: update\ndata: ${JSON.stringify(redactPublicValue(e,providers.redact))}\n\n`);}
      const client={res,projectId};subscribers.add(client);const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);heartbeat.unref();req.on('close',()=>{subscribers.delete(client);clearInterval(heartbeat);});return;
    }
    if(parts[1]==='projects'&&parts.length===2&&method==='POST'){const body=await jsonBody(req);const p=store.createProject({folderPath:textField(body.folderPath,'folderPath',{required:true,max:4096}),name:textField(body.name,'name',{required:true,max:120}),description:textField(body.description,'description',{max:10000}),instructions:textField(body.instructions,'instructions',{max:50000}),resources:resourceFields(body.resources)});emit({projectId:p.id,type:'project.created',message:p.name,data:p});return send(res,201,p);}
    if(parts[1]==='projects'&&parts[2]) {
      const p=requireRow('projects',parts[2]);
      if(parts[3]==='engineering-plan'&&parts.length===4){
        if(!engineeringPlan)throw new HttpError(503,'工程计划不可用');
        if(method==='GET')return send(res,200,await engineeringPlan.get(p.id));
        if(method==='POST')return send(res,200,await engineeringPlan.update(p.id,await jsonBody(req),{actor:{kind:'user',id:'local-user'}}));
        throw new HttpError(405,'不支持此工程计划操作');
      }
      if(await professionalRoute({req,res,parts,project:p}))return;
      if(await geospatialRoute({req,res,parts,project:p}))return;
      if(await orbitGroundRoute({req,res,parts,project:p}))return;
      if(await engineeringStateRoute({req,res,parts,project:p}))return;
      if(await workspaceRoute({req,res,parts,project:p}))return;
      if(await integrationRoute({req,res,parts,project:p}))return;
      if(parts.length===3&&method==='GET')return send(res,200,p);
      if(parts.length===3&&method==='PATCH'){const b=await jsonBody(req),changes={updatedAt:now()};for(const key of ['name','description','instructions'])if(b[key]!==undefined)changes[key]=textField(b[key],key,{required:key==='name',max:key==='name'?120:key==='instructions'?50000:10000});if(b.folderPath!==undefined&&store.canonicalFolder(b.folderPath)!==p.folderPath)throw new HttpError(400,'项目绑定文件夹创建后不能直接更换；请新建项目绑定其他目录，原文件不会被移动。');if(b.resources!==undefined)changes.resources=resourceFields(b.resources,p.resources);store.patch('projects',p.id,changes);engine.pump(p.id);emit({projectId:p.id,type:'project.updated',message:p.name});return send(res,200,p);}
      if(parts[3]==='threads'&&method==='GET'&&parts.length===4)return sendRuntime(res,200,engine.listThreads(p.id));
      if(parts[3]==='threads'&&method==='POST'&&parts.length===4){const b=await jsonBody(req);if(b.kind==='coordinator')return sendRuntime(res,200,engine.overview(store.ensureCoordinator(p.id)));if(b.kind&&b.kind!=='worker')throw new HttpError(400,'kind must be worker or coordinator');const parentThreadId=b.parentThreadId||p.coordinatorThreadId;if(parentThreadId!==p.coordinatorThreadId)throw new HttpError(400,'Threads can only belong directly to the Coordinator');const thread=store.createThread(p.id,providers.redact(textField(b.title,'title',{max:200})||'新任务'),parentThreadId,{assignment:providers.redact(textField(b.assignment,'assignment',{max:30000})||'')});emit({projectId:p.id,type:'thread.created',message:thread.title,data:thread});return sendRuntime(res,201,engine.overview(thread));}
      if(parts[3]==='memory'&&parts.length===4){if(method==='GET')return send(res,200,{content:p.memory,version:p.memoryVersion});if(method==='PUT'){const b=await jsonBody(req);if(b.version!==p.memoryVersion)throw new HttpError(409,`Memory version conflict: current version ${p.memoryVersion}`);p.memory=textField(b.content,'content',{max:50000})||'';p.memoryVersion++;store.save();emit({projectId:p.id,type:'project.memory.updated',message:`Shared memory v${p.memoryVersion}`});return send(res,200,{content:p.memory,version:p.memoryVersion});}}
      if(parts[3]==='knowledge') {
        if(method==='GET'&&parts.length===4)return send(res,200,{files:store.data.knowledge.filter(x=>x.projectId===p.id).map(({projectId,...f})=>f)});
        if(method==='POST'&&parts.length===4){const b=await jsonBody(req),name=textField(b.name,'name',{required:true,max:200}),content=textField(b.content,'content',{required:true,max:500000});if(store.data.knowledge.filter(x=>x.projectId===p.id).length>=100)throw new HttpError(400,'Maximum 100 knowledge files per project');const file={id:id('knowledge'),projectId:p.id,name,content,size:Buffer.byteLength(content),createdAt:now()};store.add('knowledge',file);emit({projectId:p.id,type:'knowledge.created',message:name,data:{id:file.id,name,size:file.size}});const {projectId,...result}=file;return send(res,201,result);}
        if(method==='DELETE'&&parts[4]){const file=requireRow('knowledge',parts[4]);if(file.projectId!==p.id)throw new HttpError(404,'Knowledge file not found');store.remove('knowledge',file.id);emit({projectId:p.id,type:'knowledge.deleted',message:file.name});return send(res,200,{ok:true});}
      }
      if(parts[3]==='model') {
        if(method==='GET'&&parts.length===4)return send(res,200,graph(p.id));
        if(method==='POST'&&parts[4]==='validate'){await jsonBody(req);return send(res,200,checkGraph(graph(p.id)));}
        if(method==='PUT'&&parts.length===4){const b=await jsonBody(req),current=graph(p.id);if(b.version!==undefined&&b.version!==current.version)throw new HttpError(409,`Model version conflict: current version ${current.version}`);const result=checkGraph(b);if(!result.valid)throw new HttpError(400,result.errors.join('; '));let next;if(engineeringState)next=await engineeringState.commitGraph(p.id,b,{actor:{kind:'user',id:'local-user'},expectedVersion:current.version});else{next=sanitizeGraph(b,current.version+1);const at=store.data.models.findIndex(m=>m.projectId===p.id);if(at>=0)store.data.models[at]={projectId:p.id,...next};else store.data.models.push({projectId:p.id,...next});store.save();}emit({projectId:p.id,type:'model.updated',message:`Model v${next.version}`,data:{version:next.version}});return send(res,200,next);}
      }
    }
    if(parts[1]==='threads'&&parts[2]) {
      const t=requireRow('threads',parts[2]);
      if(method==='GET'&&parts.length===3)return send(res,200,threadDetail(t.id));
      if(method==='GET'&&parts[3]==='messages')return sendRuntime(res,200,{messages:store.data.messages.filter(m=>m.threadId===t.id),childThreads:store.data.threads.filter(child=>child.parentThreadId===t.id).map(engine.overview),coordinatorThreadId:store.get('projects',t.projectId).coordinatorThreadId});
      if(method==='PATCH'&&parts[3]==='model'&&parts.length===4){const b=await jsonBody(req),providerId=textField(b.providerId,'providerId',{required:b.providerId!==undefined,max:200})||t.lastProviderId||requireRow('projects',t.projectId).lastProviderId||'demo';const thread=engine.setThreadModelPreference({threadId:t.id,providerId,model:b.model});return send(res,200,{thread,providerId,model:thread.modelPreferences[providerId],modelEffective:thread.activeRunId?'next-run':'next-turn'});}
      if(method==='POST'&&parts[3]==='steer'){const b=await jsonBody(req);return sendRuntime(res,202,engine.steer({threadId:t.id,content:textField(b.content,'content',{required:true,max:100000}),providerId:b.providerId,model:b.model,permissionMode:b.permissionMode}));}
      if(method==='PATCH'&&parts.length===3){const b=await jsonBody(req);if(b.title!==undefined)t.title=providers.redact(textField(b.title,'title',{required:true,max:200}));const result=b.status?engine.setThreadStatus(t.id,b.status):engine.overview(t);store.save();return send(res,200,result);}
      if(method==='POST'&&parts[3]==='messages'){const b=await jsonBody(req),content=textField(b.content,'content',{required:true,max:100000});if(b.mode&&!['single','team'].includes(b.mode))throw new HttpError(400,'mode must be single or team');const result=engine.start({threadId:t.id,content,providerId:b.providerId,model:b.model,permissionMode:b.permissionMode,mode:b.mode||'single'});return sendRuntime(res,202,result);}
    }
    if(parts[1]==='runs'&&parts[2]&&parts[3]==='cancel'&&method==='POST'){await jsonBody(req);requireRow('runs',parts[2]);return sendRuntime(res,200,engine.cancel(parts[2]));}
    if(parts[1]==='approvals'&&parts[2]&&method==='POST'){const b=await jsonBody(req);if(!['approve','reject'].includes(b.decision))throw new HttpError(400,'decision must be approve or reject');return send(res,200,engine.decideApproval(parts[2],b.decision,b.answers));}
    if(parts[1]==='providers') {
      if(method==='GET'&&parts[2]&&parts[3]==='models'&&parts.length===4){const provider=requireRow('providers',parts[2]);if(!['codex-app-server','codex-cli'].includes(provider.type))throw new HttpError(400,'Model discovery is available for Codex providers only');const projectId=url.searchParams.has('projectId')?textField(url.searchParams.get('projectId'),'projectId',{required:true,max:200}):undefined;if(projectId)requireRow('projects',projectId);const workspace=projectId?store.workspace(projectId):root;return send(res,200,await codexModelCatalog.list(providers.getConfig(provider.id),{workspace}));}
      if(method==='PATCH'&&parts[2]&&parts.length===3){requireRow('providers',parts[2]);if(store.data.runs.some(r=>r.providerId===parts[2]&&['running','queued','waiting_approval'].includes(r.status)))throw new HttpError(409,'连接正在运行中，请完成或停止后再修改。');const value=providers.update(parts[2],await jsonBody(req));emit({type:'provider.updated',message:value.name});return send(res,200,value);}
      if(method==='POST'&&parts.length===2){const p=providers.create(await jsonBody(req));emit({type:'provider.created',message:p.name});return send(res,201,p);}
      if(method==='DELETE'&&parts[2]){const p=requireRow('providers',parts[2]);if(p.id==='demo')throw new HttpError(400,'The offline demo provider is required');if(store.data.runs.some(r=>r.providerId===p.id&&['running','queued','waiting_approval'].includes(r.status)))throw new HttpError(409,'Provider is used by an active run');providers.remove(p.id);return send(res,200,{ok:true});}
      if(method==='POST'&&parts[3]==='test'){await jsonBody(req);requireRow('providers',parts[2]);const testRoot=options.engineOptions?.codexRemoteWorkspace?.hostRoot||dataDir;const temporary=await fsp.mkdtemp(path.join(testRoot,'test-'));let result;try{result=await engine.testProvider(parts[2],{workspace:temporary});}catch(error){result={ok:false,message:providers.redact(error.message)};}finally{await fsp.rm(temporary,{recursive:true,force:true});}return send(res,200,result);}
    }
    if(parts[1]==='benchmarks') {
      const dataset=await readDataset();
      if(method==='GET'&&parts.length===2)return send(res,200,{tasks:dataset.tasks.map(publicTask),summary:{...dataset.summary,count:dataset.tasks.length}});
      const task=dataset.tasks.find(t=>t.id===parts[2]);if(!task)throw new HttpError(404,'Benchmark task not found');
      if(method==='GET'&&parts.length===3)return send(res,200,publicTask(task));
      if(method==='POST'&&parts[3]==='start') {
        const b=await jsonBody(req);const p=b.projectId?requireRow('projects',b.projectId):store.createProject({folderPath:textField(b.folderPath,'folderPath',{required:true,max:4096}),name:(task.title||task.name||task.id).slice(0,120),description:task.summary||task.description||'',instructions:'依据原始公开issue进行工程分析。公开资料已核查不代表问题已复现。严格区分假设、数字验证、上游复现和实测证据。'});
        const publicData=publicTask(task);const source={id:id('knowledge'),projectId:p.id,name:`benchmark-${task.id}.json`,content:JSON.stringify(publicData,null,2),createdAt:now()};source.size=Buffer.byteLength(source.content);store.add('knowledge',source);
        const workspace=store.workspace(p.id);await fsp.writeFile(safePath(workspace,'task.json',{write:true}),source.content,{encoding:'utf8',mode:0o600});
        const t=store.get('threads',p.coordinatorThreadId);let run;
        if(b.providerId){const prompt=task.publicPrompt||task.prompt||task.taskBrief||task.task||`Analyze and implement reviewable deliverables for the imported benchmark ${task.id}. Start by reading its source notes. Do not claim unexecuted upstream reproduction.`;run=engine.start({threadId:t.id,content:typeof prompt==='string'?prompt:JSON.stringify(prompt),providerId:b.providerId,permissionMode:b.permissionMode}).run;}
        else store.message(t.id,'assistant','基准题已导入。尚未启动 AI 或运行上游测试；选择模型并发送任务即可开始。');
        emit({projectId:p.id,type:'benchmark.imported',message:task.title||task.id,data:{taskId:task.id,threadId:t.id}});return send(res,201,{project:p,thread:t,...(run?{run}:{})});
      }
    }
    if(parts[1]==='evaluate'&&method==='POST') {
      if(!evaluator)throw new HttpError(503,'Evaluator module unavailable');const b=await jsonBody(req);requireRow('projects',b.projectId);const dataset=await readDataset(),task=dataset.tasks.find(t=>t.id===b.taskId);if(!task)throw new HttpError(404,'Benchmark task not found');
      if(b.submission?.kind==='quaternion-interface-v1') {const identity=JSON.stringify([task.id,task.repository,task.repositoryUrl,task.repo,task.issueUrl,task.issueNumber,task.issue,task.title]).toLowerCase();if(!identity.includes('nos3')||!identity.includes('351'))throw new HttpError(400,'The quaternion interface sub-evaluation is only available for NOS3 #351');}
      const report=await evaluator.evaluate({taskId:b.taskId,projectId:b.projectId,submission:b.submission},{source:'user'});store.add('evaluations',report);return send(res,200,report);
    }
    if(parts[1]==='evaluations'&&method==='GET') {
      if(parts.length===2){const projectId=url.searchParams.get('projectId');if(projectId)requireRow('projects',projectId);const reports=store.data.evaluations.filter(report=>!projectId||report.projectId===projectId).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));return send(res,200,{reports});}
      if(parts.length===3)return send(res,200,requireRow('evaluations',parts[2]));
    }
    if(parts[1]==='artifacts'&&parts[2]&&method==='GET') {
      const a=requireRow('artifacts',parts[2]);
      if(/^engineering\/(?:geospatial|orbit|orbit-ground)\//.test(a.path||'')){
        const checked=await workspaceViewer.read({projectId:a.projectId,path:a.path});
        if(checked.encoding!=='utf8')throw new HttpError(415,'Only text artifacts are available');
        if(Buffer.byteLength(checked.content,'utf8')>500000)throw new HttpError(413,'Artifact is too large');
        return send(res,200,{...a,content:checked.content});
      }
      const file=safePath(store.workspace(a.projectId),a.path),stat=await fsp.stat(file);if(!stat.isFile()||stat.size>500000)throw new HttpError(413,'Artifact is too large');const content=await fsp.readFile(file,'utf8');if(content.includes('\0'))throw new HttpError(415,'Only text artifacts are available');return send(res,200,{...a,content});
    }
    if(parts[1]==='engineering') {
      if(!engineering)throw new HttpError(503,'Engineering service unavailable');
      if(method==='GET'&&parts[2]==='catalog')return send(res,200,await engineering.catalog());
      if(method==='POST'&&parts[2]==='recheck'){await jsonBody(req);return send(res,200,await engineering.catalog({recheck:true}));}
      if(method==='POST'&&parts[2]==='run'){const b=await jsonBody(req);requireRow('projects',b.projectId);const result=await engineering.run(b,{source:'user',threadId:store.get('projects',b.projectId).coordinatorThreadId});return send(res,200,result);}
      if(method==='GET'&&parts[2]==='runs'&&parts[3]){const projectId=url.searchParams.get('projectId');requireRow('projects',projectId);return send(res,200,await engineering.getRun(parts[3],{projectId}));}
      if(method==='GET'&&parts[2]==='outputs'&&parts[3]&&parts[4]){const projectId=url.searchParams.get('projectId');requireRow('projects',projectId);const output=await engineering.readOutput(parts[3],parts[4],{projectId});res.writeHead(200,{'content-type':output.contentType,'cache-control':'no-store'});return res.end(output.buffer);}
    }
    if(parts[1]==='computer') {
      if(!computer)throw new HttpError(503,'Computer module unavailable');
      if(method==='GET'&&parts[2]==='status')return send(res,200,await computer.status());
      if(method==='POST'&&parts[2]==='action'){const b=await jsonBody(req);requireRow('projects',b.projectId);if(typeof b.action!=='string')throw new HttpError(400,'action is required');const result=await computer.action({projectId:b.projectId,action:b.action,args:b.args||{}},{source:'user'});return send(res,200,result);}
      if(method==='GET'&&parts[2]==='screenshots'&&parts[3]){const shot=await computer.readScreenshot(parts[3]);res.writeHead(200,{'content-type':shot.contentType,'cache-control':'no-store'});return res.end(shot.buffer);}
    }
    throw new HttpError(404,'API route not found');
  }
  server=http.createServer((req,res)=>route(req,res).catch(e=>{if(res.headersSent){res.destroy();return;}const message=providers.redact(e.message||'Internal server error');send(res,e.status||e.statusCode||(e.code==='ENOENT'?404:400),{error:message});}));
  server.requestTimeout=30000;server.headersTimeout=10000;
  return {server,store,settings,providers,engine,computer,evaluator,engineering,engineeringState,engineeringPlan,professionalModels,professionalRunner,geospatialJobs,geospatialRunner,orbit42Jobs,orbitGroundJobs,orbitGroundRunner,stfCase,connectors,nos3,modelBackend,localVm,emit,async listen({port=Number(process.env.PORT)||4317,host='127.0.0.1'}={}){if(!['127.0.0.1','::1'].includes(host))throw new Error('MBSE Studio must bind to a loopback address');await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});computer?.setBaseUrl?.(`http://${host==='::1'?'[::1]':host}:${server.address().port}`);return server.address();},async close(){for(const c of subscribers)c.res.end();subscribers.clear();await engine.close();await geospatialJobs?.close?.();await geospatialRunner?.close?.();await orbit42Jobs?.close?.();await orbitGroundJobs?.close?.();await orbitGroundRunner?.close?.();await professionalModels?.close?.();await professionalRunner?.close?.();await nos3?.close?.();await localVm?.close?.();await connectors?.close?.();await modelBackend?.close?.();await computer?.close?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=await createStudioServer();const address=await app.listen();process.stdout.write(`MBSE Studio is running at http://127.0.0.1:${address.port}\n`);
  let closing=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(closing)return;closing=true;await app.close();process.exit(0);});
}
