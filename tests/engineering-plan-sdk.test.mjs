import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {createStore} from '../server/store.mjs';
import {createEngineeringPlanService} from '../server/engineering-plan.mjs';
import {ENGINEERING_PLAN_TOOL_DEFINITIONS} from '../server/engineering-plan-tools.mjs';
import {createEngineeringStateService} from '../server/engineering-state.mjs';
import {ENGINEERING_STATE_TOOL_DEFINITIONS} from '../server/engineering-state-tools.mjs';
import {createToolRuntime} from '../server/tools.mjs';
import {createSdkRuntime} from '../server/runtimes/sdk.mjs';

const initialPlan=()=>({expectedRevision:0,goal:'Model 3 candidate model and verification demo',items:[
 {id:'model',title:'Save subsystem models',status:'active',modelPaths:['models/Vehicle.sysml'],review:null},
 {id:'check',title:'Check candidate requirements',status:'ready',dependsOn:['model'],verification:{method:'Inspect recorded result',acceptanceCriteria:['Retain actual result and its limits']},review:{findings:'',evidenceIds:[]}}
]});

test('native MCP schema conversion accepts nullable plan review and zero object creation revision',()=>{
 const planSchema=z.fromJSONSchema(ENGINEERING_PLAN_TOOL_DEFINITIONS.find(t=>t.name==='update_engineering_plan').parameters);
 assert.equal(planSchema.parse(initialPlan()).items[0].review,null);
 const objectSchema=z.fromJSONSchema(ENGINEERING_STATE_TOOL_DEFINITIONS.find(t=>t.name==='record_engineering_object').parameters);
 const object={id:'R05',kind:'requirement',title:'Candidate range requirement',sources:['requirements.md']};
 assert.equal(objectSchema.parse({...object,expectedRevision:0}).expectedRevision,0);
 assert.equal(objectSchema.parse(object).id,'R05');
 assert.throws(()=>objectSchema.parse({...object,expectedRevision:-1}));
 assert.throws(()=>planSchema.parse({...initialPlan(),items:[{id:'work',title:'Work',review:'done'}]}));
});

test('official SDK repairs rejected plan links, saves reviewed work and restores it from disk',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-plan-sdk-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const folder=path.join(root,'project');await fs.mkdir(folder);
 await fs.writeFile(path.join(folder,'requirements.md'),'R05: Candidate target; acceptance remains TBD.\n');
 await fs.writeFile(path.join(folder,'result.txt'),'Input inspected. Numerical verification not executed.\n');
 const options={dataDir:path.join(root,'state'),seed:false},store=createStore(options);
 const project=store.createProject({name:'Engineering plan SDK regression',folderPath:folder});
 const engineeringPlan=createEngineeringPlanService({store}),engineeringState=createEngineeringStateService({store});
 const tools=createToolRuntime({store,engineeringPlan,engineeringState,emit:()=>{}});
 const ctx={projectId:project.id,runId:'fixture-run',isCoordinator:true,permissionMode:'auto'};
 const object={id:'R05',kind:'requirement',title:'Candidate range target',sources:['requirements.md']};
 const linkedPlan=()=>{const plan=initialPlan();plan.expectedRevision=1;plan.items[1].verification.requirementIds=['R05'];return plan;};
 let evidenceId;
 const steps=[
  {name:'get_engineering_plan',args:()=>({}),check:r=>assert.equal(r.revision,0)},
  {name:'update_engineering_plan',args:initialPlan,check:r=>{assert.equal(r.revision,1);assert.ok(r.items.every(i=>i.review===null));}},
  {name:'update_engineering_plan',args:linkedPlan,check:r=>{assert.match(r.error,/items\[1\]\.verification.requirementIds/);assert.match(r.error,/record_engineering_object/);assert.equal(engineeringPlan.get(project.id).revision,1);}},
  {name:'get_engineering_state',args:()=>({objectIds:['R05']}),check:r=>assert.deepEqual(r.missingObjectIds,['R05'])},
  {name:'record_engineering_object',args:()=>({...object,expectedRevision:1}),check:r=>assert.match(r.error,/New objects.*expectedRevision 0/)},
  {name:'record_engineering_object',args:()=>({...object,expectedRevision:0}),check:r=>assert.equal(r.revision,1)},
  {name:'record_engineering_object',args:()=>({...object,id:'R06'}),check:r=>assert.equal(r.revision,1)},
  {name:'update_engineering_plan',args:()=>{const p=linkedPlan();p.items[0].artifactIds=['model_backend_id'];return p;},check:r=>{assert.match(r.error,/items\[0\]\.artifactIds/);assert.match(r.error,/use modelPaths/);assert.equal(engineeringPlan.get(project.id).revision,1);}},
  {name:'record_engineering_evidence',args:()=>({title:'Input review receipt',scope:'Fixture file inspection only; no numerical verification.',result:'not_executed',objectIds:['R05'],paths:['result.txt']}),check:r=>{assert.equal(r.result,'not_executed');assert.match(r.files[0].sha256,/^[a-f0-9]{64}$/);evidenceId=r.id;}},
  {name:'update_engineering_plan',args:()=>{const p=linkedPlan();p.items[0].status='delivered';p.items[1].status='reviewed';p.items[1].verification.evidenceIds=[evidenceId];p.items[1].review={findings:'Inspected the input report; numerical verification remains unexecuted.',evidenceIds:[evidenceId]};return p;},check:r=>{assert.equal(r.revision,2);assert.equal(r.items[1].status,'reviewed');}},
  {name:'update_engineering_plan',args:linkedPlan,check:r=>assert.match(r.error,/changed.*get_engineering_plan/)},
  {name:'get_engineering_plan',args:()=>({}),check:r=>{assert.equal(r.revision,2);assert.deepEqual(r.items[1].verification.requirementIds,['R05']);}}
 ];
 let phase=0;const calls=[];
 const providers={redact:v=>v,complete:async(_id,request)=>{
  if(phase){const result=request.messages.findLast(m=>m.role==='tool');assert.equal(result.tool_call_id,'plan-call-'+phase);steps[phase-1].check(JSON.parse(result.content));}
  if(phase===steps.length)return {content:'Plan saved; numerical verification remains pending.',toolCalls:[]};
  const step=steps[phase++];return {content:'',toolCalls:[{id:'plan-call-'+phase,name:step.name,args:step.args()}]};
 }};
 const sdk=createSdkRuntime({providers,dataDir:options.dataDir});
 const result=await sdk.startTurn({providerId:'fixture',workspace:folder,input:'Save and review the candidate engineering work plan.',maxTurns:20,tools:[...ENGINEERING_PLAN_TOOL_DEFINITIONS,...ENGINEERING_STATE_TOOL_DEFINITIONS],executeTool:async(name,args,{signal})=>{calls.push(name);return tools.execute(name,args,{...ctx,signal});}}).completion;
 assert.match(result.content,/Plan saved/);assert.equal(calls.length,steps.length);
 const reopened=createStore(options),plan=createEngineeringPlanService({store:reopened}).get(project.id);
 assert.equal(plan.revision,2);assert.deepEqual(plan.items[1].verification.requirementIds,['R05']);
 assert.deepEqual(plan.items[1].review.evidenceIds,[evidenceId]);assert.equal(plan.maturity,'candidate');
 const state=await createEngineeringStateService({store:reopened}).get(project.id);
 assert.deepEqual(state.objects.map(o=>[o.id,o.revision]),[['R05',1],['R06',1]]);
 assert.equal(state.evidence[0].result,'not_executed');assert.equal(state.evidence[0].applicability.status,'unknown');
});
