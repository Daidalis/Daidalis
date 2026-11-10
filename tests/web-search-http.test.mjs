import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStudioServer} from '../server/index.mjs';

test('HTTP Agent searches unknown URLs, fetches the discovered page and retains the source chain',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-web-search-http-')),workspace=path.join(root,'workspace');await fs.mkdir(workspace);
  const query='Model 3 公开规格 官方资料',url='https://www.tesla.com/model3',requests=[],searches=[],fetches=[];
  const reply=message=>new Response(JSON.stringify({choices:[{message}]}),{headers:{'content-type':'application/json'}});
  const call=(id,name,args)=>reply({content:'',tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  const app=await createStudioServer({dataDir:path.join(root,'data'),seed:false,addDefaultCodexProvider:false,computer:false,evaluator:false,engineering:false,connectors:false,nos3:false,localVm:false,professionalModels:false,professionalRunner:false,modelBackend:false,geospatial:false,orbit42:false,orbitGround:false,stfCase:false,
    webSearch:{catalog:()=>({provider:'agent-reach',installed:true,ready:searches.length>0,status:searches.length?'ready':'configured'}),async search(args,{signal}){assert.equal(signal.aborted,false);searches.push(args);return {provider:'agent-reach',query:args.query,results:[{title:'Model 3 official page',url,snippet:'Public page; inspect region and model year.'}],untrusted:true};}},
    webFetcher:async(found,{signal})=>{assert.equal(signal.aborted,false);fetches.push(found);return {url:found,text:'Read original page: regional specifications must be checked separately.'};},
    fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body);requests.push(body);assert.ok(body.tools.some(tool=>tool.function.name==='web_search'));return requests.length===1?call('search','web_search',{query,limit:3}):requests.length===2?call('fetch','web_fetch',{url:JSON.parse(body.messages.at(-1).content).results[0].url}):reply({content:'已找到官方来源；地区及车型口径需要分别核对。'});},
  });
  t.after(async()=>{await app.close();await fs.rm(root,{recursive:true,force:true});});
  const address=await app.listen({port:0}),base='http://127.0.0.1:'+address.port;
  const api=async(route,body)=>{const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});assert.ok(response.ok,await response.clone().text());return response.json();};
  const provider=await api('/api/providers',{name:'Local model fixture',type:'openai-compatible',model:'test',apiKey:'synthetic-key',maxRetries:0});
  const project=await api('/api/projects',{name:'Search sources',folderPath:workspace,resources:{maxAutoResumes:0}});
  assert.equal((await api('/api/bootstrap')).capabilities.webSearch.status,'configured');
  const {run}=await api('/api/threads/'+project.coordinatorThreadId+'/messages',{content:'查找 Model 3 公开规格资料，先搜索再读取原始网页。',providerId:provider.id,permissionMode:'manual'});
  let detail;
  for(let i=0;i<300;i++){detail=await api('/api/threads/'+project.coordinatorThreadId);if(detail.runs.find(item=>item.id===run.id)?.status==='completed')break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(detail.runs.find(item=>item.id===run.id).status,'completed');assert.deepEqual(searches,[{query,limit:3}]);assert.deepEqual(fetches,[url]);assert.equal(requests.length,3);
  assert.ok(requests[1].messages.some(message=>message.role==='tool'&&message.content.includes(url)));assert.ok(requests[2].messages.some(message=>message.role==='tool'&&message.content.includes('Read original page')));
  const completed=detail.events.filter(event=>event.runId===run.id&&event.type==='tool.completed');assert.deepEqual(completed.map(event=>event.data.tool),['web_search','web_fetch']);assert.equal(completed[0].data.result.results[0].url,url);
  assert.equal(detail.approvals.length,0);assert.equal((await api('/api/bootstrap')).capabilities.webSearch.status,'ready');
  const registry=await api('/api/projects/'+project.id+'/integrations');assert.equal(registry.registry.entries.find(item=>item.id==='web-search').ready,true);
});
