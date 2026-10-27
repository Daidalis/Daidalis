import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createStudioServer} from '../server/index.mjs';
import {stageManagedWorkerBundle} from '../server/local-linux-vm.mjs';
import {publicFetch} from '../server/sandbox.mjs';

const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const vmRoot=path.resolve(process.env.MANTA_NOS3_VM_ROOT||path.join(sourceRoot,'vm'));
const outputRoot=process.env.MANTA_STF_EVAL_OUTPUT_ROOT;
if(!outputRoot||!path.isAbsolute(outputRoot))throw new Error('Set MANTA_STF_EVAL_OUTPUT_ROOT to a dedicated absolute output directory');
fs.mkdirSync(outputRoot,{recursive:true,mode:0o700});
const evalRoot=path.join(fs.realpathSync(outputRoot),`requirements-first-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`);
const shareRoot=path.join(vmRoot,'handoff','eval-workspaces'),slug='stf'+randomUUID().replaceAll('-','').slice(0,18);
const workspace=path.join(shareRoot,slug),dataDir=path.join(evalRoot,'manta-data');
for(const dir of [evalRoot,shareRoot,workspace,dataDir])fs.mkdirSync(dir,{recursive:true,mode:0o700});
await stageManagedWorkerBundle(vmRoot);
// Native Codex commands run inside the guest's project-only mount namespace.
// Manta's generic run_command executes on the host, so exclude it here.
const disabledAgentTools=['run_command','list_external_tools','call_external_tool','prepare_nos3_model','bind_nos3_results','inspect_nos3','prepare_nos3_environment','submit_nos3_job','get_nos3_job','wait_nos3_job','cancel_nos3_job','computer_use'];
// This instance alone may fetch public primary sources through the managed
// 198.18/15 egress mapping. The exact HTTPS hosts remain DNS-pinned and TLS-
// validated by publicFetch; redirects are checked again against this list.
const proxyMappedPublicHosts=Object.freeze(['raw.githubusercontent.com','github.com','nos3.org','nasa.gov','www.nasa.gov','science.nasa.gov','ntrs.nasa.gov','nodis3.gsfc.nasa.gov','nos3.readthedocs.io','www.census.gov','www2.census.gov','www.usgs.gov']);
const sourceHosts=Object.freeze([...proxyMappedPublicHosts,'api.github.com']);
const webFetcher=(url,options)=>publicFetch(url,{...options,allowedHosts:sourceHosts,proxyMappedHosts:sourceHosts});
const assetFetcher=(url,options)=>publicFetch(url,{...options,allowedHosts:sourceHosts,proxyMappedHosts:sourceHosts,requireHttps:true});
const app=await createStudioServer({root:sourceRoot,dataDir,vmRoot,codexPath:path.join(vmRoot,'host/codex-remote.py'),seed:false,stfCase:false,computer:false,connectors:false,localVm:false,nos3:false,professionalMode:'generic-only',evaluator:false,webFetcher,assetFetcher,engineOptions:{codexRemoteWorkspace:{hostRoot:shareRoot},disabledTools:disabledAgentTools}});
const key=process.env.MANTA_STF_EVAL_OPENAI_API_KEY;
app.providers.update('codex-local',{name:'Codex · 隔离 Linux Agent',...(key?{baseUrl:'https://api.openai.com/v1',apiKey:key}:{})});
if(key)delete process.env.MANTA_STF_EVAL_OPENAI_API_KEY;
const project=app.store.createProject({folderPath:workspace,name:'STF · 需求驱动隔离评测',description:'从空白项目按任务需求开发；参考答案不在 Agent 可读目录中。',instructions:'区分来源、工程假设、用户批准决定、工具执行证据及尚未验证的工作。不得把数字仿真等同于实物合格。'});
const port=Number(process.env.MANTA_STF_EVAL_PORT)||4319;
const address=await app.listen({port});
const manifest={schema:'manta-requirements-first-eval-v1',projectId:project.id,coordinatorThreadId:project.coordinatorThreadId,workspace,guestWorkspace:'/work',guestSessionPath:`/srv/manta/agent-eval/sessions/${slug}`,dataDir,sourceRoot,vmRoot,port:address.port,initialWorkspaceEntries:fs.readdirSync(workspace),disabledAgentTools,proxyMappedPublicHosts:sourceHosts,referenceImportDisabled:app.stfCase===null,externalMcpDisabled:app.connectors===null,computerDisabled:app.computer===null,nos3Disabled:app.nos3===null,professionalRunnerMode:'generic-only',nativeRuntime:'codex-app-server in Linux Bubblewrap',nativeReadIsolation:'guest default-deny mount namespace; one project bind',apiKeyConfigured:Boolean(key),createdAt:new Date().toISOString()};
fs.writeFileSync(path.join(evalRoot,'boundary.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
process.stdout.write(JSON.stringify({url:`http://127.0.0.1:${address.port}/?project=${project.id}`,manifest:path.join(evalRoot,'boundary.json'),workspace,apiKeyConfigured:Boolean(key)})+'\n');
let closing=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(closing)return;closing=true;await app.close();process.exit(0);});
