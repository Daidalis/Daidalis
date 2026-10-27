import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createStudioServer} from '../server/index.mjs';
import {redactPublicValue} from '../server/public-redaction.mjs';

const syntheticKeys=()=>[['synthetic','known','credential','no-auth'].join('-'),['synthetic','quoted','"','\\','no-auth'].join('-')];
const contains=(value,keys)=>typeof value==='string'?keys.some(key=>value.includes(key)):Array.isArray(value)?value.some(item=>contains(item,keys)):value&&typeof value==='object'?Object.entries(value).some(([key,item])=>contains(key,keys)||contains(item,keys)):false;
async function eventually(check){const end=Date.now()+10000;while(Date.now()<end){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('Expected synthetic runtime state');}
async function fixture(t,options={}){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'manta-public-redaction-')),root=path.join(temp,'app'),folder=path.join(temp,'project');
  await fs.mkdir(path.join(root,'public'),{recursive:true});await fs.mkdir(folder);await fs.writeFile(path.join(root,'public/index.html'),'<html>Manta fixture</html>');
  const app=await createStudioServer({root,seed:false,computer:false,evaluator:false,engineering:false,engineeringState:false,engineeringPlan:false,professionalModels:false,professionalRunner:false,geospatial:false,orbit42:false,connectors:false,nos3:false,modelBackend:false,stfCase:false,...options});
  t.after(async()=>{await app.close();await fs.rm(temp,{recursive:true,force:true});});
  const address=await app.listen({port:0}),base=`http://127.0.0.1:${address.port}`,keys=syntheticKeys();
  const profiles=keys.map((apiKey,index)=>app.providers.create({name:'Synthetic probe '+index,type:'codex-app-server',apiKey}));
  const project=app.store.createProject({name:'Synthetic disclosure fixture',folderPath:folder,resources:{maxAutoResumes:0}});
  return {app,base,keys,profiles,project,folder,dataDir:path.join(root,'data'),async json(route,method='GET',body){const res=await fetch(base+route,{method,headers:body===undefined?{}:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});assert.equal(res.status,200);return res.json();}};
}
async function stream(t,base,lastEventId){
  const controller=new AbortController(),response=await fetch(base+'/api/events',{signal:controller.signal,headers:lastEventId?{'last-event-id':lastEventId}:{}});assert.equal(response.status,200);
  const reader=response.body.getReader(),events=[],decoder=new TextDecoder();let text='';
  const pumping=(async()=>{for(;;){const{done,value}=await reader.read();if(done)return;text+=decoder.decode(value,{stream:true});let at;while((at=text.indexOf('\n\n'))>=0){const block=text.slice(0,at);text=text.slice(at+2);const data=block.split('\n').find(line=>line.startsWith('data: '));if(data)events.push(JSON.parse(data.slice(6)));}}})().catch(error=>{if(!controller.signal.aborted)throw error;});
  t.after(async()=>{controller.abort();await reader.cancel().catch(()=>{});await pumping;});return {events};
}

test('public record redaction clones nested JSON strings and property names without changing execution input',()=>{
  const keys=syntheticKeys(),redact=value=>keys.reduce((text,key)=>text.split(key).join('[REDACTED]'),value);
  const input={text:'prefix '+keys[0],nested:[{value:keys[1],count:3},null,false],created:new Date('2026-01-01T00:00:00Z'),[keys[0]]:'keyed value'},original=structuredClone(input);
  const clean=redactPublicValue(input,redact);assert.equal(contains(clean,keys),false);assert.equal(clean.nested[0].value,'[REDACTED]');assert.equal(clean.nested[0].count,3);assert.equal(clean.created,'2026-01-01T00:00:00.000Z');assert.equal(clean['[REDACTED]'],'keyed value');assert.deepEqual(input,original);
});

test('one sanitized public event snapshot is persisted, sent over SSE, and returned in thread history',async t=>{
  const f=await fixture(t),live=await stream(t,f.base),data={nested:{values:[f.keys[0],{quoted:f.keys[1]}]},count:7},original=structuredClone(data);
  const event=f.app.emit({projectId:f.project.id,type:'fixture.public-event',message:'Message '+f.keys[0],data});
  await eventually(()=>live.events.some(row=>row.id===event.id));
  assert.deepEqual(data,original);assert.equal(contains(event,f.keys),false);assert.equal(event.data.nested.values[1].quoted,'[REDACTED]');
  const stored=JSON.parse(await fs.readFile(path.join(f.dataDir,'state.json'),'utf8')),persisted=stored.events.find(row=>row.id===event.id),wire=live.events.find(row=>row.id===event.id);
  assert.deepEqual(persisted,event);assert.deepEqual(wire,event);assert.equal(contains(stored,f.keys),false);
  const detail=await f.json(`/api/threads/${f.project.coordinatorThreadId}`);assert.deepEqual(detail.events.find(row=>row.id===event.id),event);
  data.nested.values[0]='mutated after emit';assert.equal(event.data.nested.values[0],'[REDACTED]','The record must not retain an execution-object reference');
});

test('manual approval records are sanitized while the approved executor receives original command arguments',async t=>{
  let executed,originalArgs;
  const adapter={startTurn(options){return {completion:(async()=>{options.onSession('synthetic-redaction-session');originalArgs={command:'synthetic command '+syntheticKeys()[0],metadata:{nested:[syntheticKeys()[1]]}};const result=await options.executeTool('run_command',originalArgs);assert.equal(result.code,0);return {content:'Synthetic command fixture completed',sessionId:'synthetic-redaction-session'};})(),cancel(){}};}};
  const f=await fixture(t,{engineOptions:{runtimeAdapters:{'codex-app-server':adapter}},commandExecutor:async args=>{executed=args;return {code:0,stdout:'Synthetic fixture only',stderr:''};}}),live=await stream(t,f.base);
  const {run}=f.app.engine.start({threadId:f.project.coordinatorThreadId,providerId:f.profiles[0].id,permissionMode:'manual',content:'Run only the injected command fixture.'});
  await eventually(()=>f.app.store.data.approvals.some(row=>row.status==='pending'));
  const approval=f.app.store.data.approvals.find(row=>row.status==='pending');assert.equal(contains(approval,f.keys),false);assert.equal(approval.args.metadata.nested[0],'[REDACTED]');assert.equal(executed,undefined);
  const bootstrap=await f.json('/api/bootstrap');assert.equal(contains(bootstrap.approvals,f.keys),false);
  const before=JSON.parse(await fs.readFile(path.join(f.dataDir,'state.json'),'utf8'));assert.equal(contains(before,f.keys),false);
  await f.json(`/api/approvals/${approval.id}`,'POST',{decision:'approve'});await eventually(()=>!f.app.engine.active.has(run.id));assert.equal(run.status,'completed',run.error);
  assert.equal(executed.command,originalArgs.command);assert.equal(executed.command.includes(f.keys[0]),true);assert.equal(originalArgs.metadata.nested[0],f.keys[1]);
  await eventually(()=>live.events.some(row=>row.type==='approval.decided'));
  assert.equal(contains(live.events,f.keys),false);const after=JSON.parse(await fs.readFile(path.join(f.dataDir,'state.json'),'utf8'));assert.equal(contains(after,f.keys),false);
});

test('legacy event and approval responses redact currently known keys without rewriting engineering file bytes',async t=>{
  const f=await fixture(t),anchor=f.app.emit({projectId:f.project.id,type:'fixture.anchor',message:'Replay anchor'});
  const legacy={id:'event_legacy_synthetic',projectId:f.project.id,runId:null,type:'fixture.legacy',message:f.keys[0],data:{nested:[f.keys[1]]},createdAt:new Date().toISOString()};
  f.app.store.data.events.push(legacy);f.app.store.data.approvals.push({id:'approval_legacy_synthetic',projectId:f.project.id,threadId:f.project.coordinatorThreadId,runId:null,tool:'fixture-only',args:{command:f.keys[0]},status:'pending'});f.app.store.save();
  f.app.store.data.runs.push({id:'run_legacy_synthetic',projectId:f.project.id,threadId:f.project.coordinatorThreadId,status:'completed',input:f.keys[0],result:f.keys[1]});f.app.store.message(f.project.coordinatorThreadId,'user',f.keys[0],'run_legacy_synthetic');f.app.store.save();
  const replay=await stream(t,f.base,anchor.id);await eventually(()=>replay.events.some(row=>row.id===legacy.id));assert.equal(contains(replay.events,f.keys),false);
  const detail=await f.json(`/api/threads/${f.project.coordinatorThreadId}`),bootstrap=await f.json('/api/bootstrap');assert.equal(contains(detail,f.keys),false);assert.equal(contains(bootstrap,f.keys),false);const messages=await f.json(`/api/threads/${f.project.coordinatorThreadId}/messages`);assert.equal(contains(messages,f.keys),false);assert.equal(legacy.data.nested[0],f.keys[1],'Reading legacy public history must not silently rewrite the underlying store');
  const content='Synthetic engineering source containing '+f.keys[0],file=path.join(f.folder,'review.md');await fs.writeFile(file,content);
  const preview=await f.json(`/api/projects/${f.project.id}/workspace/file?path=review.md`);assert.equal(preview.content,content);assert.equal(preview.sha256,createHash('sha256').update(content).digest('hex'));assert.equal(await fs.readFile(file,'utf8'),content);
});

for(const [type,runtime] of [['codex-app-server','codex-app-server'],['claude-agent','claude-agent-sdk'],['openai-responses','openai-agents-sdk']])test(type+' preserves private execution and steering while delegated task snapshots stay credential-free',async t=>{
  const keys=syntheticKeys(),task='Bounded task '+keys.join(' / '),human='Synthetic main instruction '+keys[0],steering='Synthetic follow-up '+keys[1],nativeSteers=[];let workerInput,coordinatorInput,workerInstructions,assignment,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const adapter={startTurn(options){return {completion:(async()=>{
    options.onSession('synthetic-'+options.input.length+'-'+runtime);
    if(options.instructions.includes('Role: coordinator')){
      coordinatorInput=options.input;
      const invalid=await options.executeTool('start_thread',{task:'Invalid controlled identifier',taskKey:keys[0]});assert.match(invalid.error,/identifiers.*credentials/);
      assignment=await options.executeTool('start_thread',{name:'Worker '+keys[0],task,scope:'Scope '+keys[1],taskKey:'credential-free-control',ownedPaths:['drafts'],acceptanceCriteria:['Inspect '+keys[0]]});assert.ok(assignment.thread?.id,assignment.error);
      await options.executeTool('wait_threads',{threadIds:[assignment.thread.id]});return {content:'Synthetic handoff received; no engineering completion claim.'};
    }
    workerInput=options.input;workerInstructions=options.instructions;
    let abort;try{await Promise.race([gate,new Promise(resolve=>{abort=resolve;options.signal.addEventListener('abort',abort,{once:true});})]);}finally{options.signal.removeEventListener('abort',abort);}
    return {content:'Synthetic worker result '+keys[0]};
  })(),async steer(text){nativeSteers.push(text);return {accepted:true,delivery:'synthetic-native'};},cancel(){release();}};}};
  const f=await fixture(t,{engineOptions:{runtimeAdapters:{[runtime]:adapter}}}),live=await stream(t,f.base);
  const profile=type==='codex-app-server'?f.profiles[0]:f.app.providers.create({name:'Synthetic '+type,type,apiKey:keys[0],...(type==='openai-responses'?{model:'synthetic-model'}:{})});
  const {run}=f.app.engine.start({threadId:f.project.coordinatorThreadId,providerId:profile.id,permissionMode:'auto',content:human});
  await eventually(()=>workerInput&&run.executionPhase==='waiting_tasks');assert.equal(coordinatorInput,human);assert.equal(workerInput,task);assert.ok(workerInstructions.includes(keys[1]));
  assert.equal(contains(f.app.store.data,keys),false);assert.equal(contains(await f.json('/api/bootstrap'),keys),false);
  const response=await fetch(f.base+`/api/threads/${assignment.thread.id}/steer`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:steering})});assert.equal(response.status,202);assert.equal(contains(await response.json(),keys),false);
  await eventually(()=>nativeSteers.length===1);assert.ok(nativeSteers[0].includes(steering));
  const detail=await f.json(`/api/threads/${assignment.thread.id}`);assert.equal(contains(detail,keys),false);assert.equal(detail.thread.taskContract.ownedPaths[0],'drafts');
  release();await eventually(()=>!f.app.engine.active.has(run.id));assert.equal(run.status,'completed',run.error);
  const stored=JSON.parse(await fs.readFile(path.join(f.dataDir,'state.json'),'utf8'));assert.equal(contains(stored,keys),false);assert.equal(contains(live.events,keys),false);assert.equal(workerInput,task);
});
