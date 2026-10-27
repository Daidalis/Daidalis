import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStore} from '../server/store.mjs';
import {createEngine} from '../server/engine.mjs';
import {createEngineeringStateService} from '../server/engineering-state.mjs';
import {engineeringStatePage,ENGINEERING_STATE_TOOL_DEFINITIONS} from '../server/engineering-state-tools.mjs';
import {buildApprovalPresentation} from '../public/approval-presentation.mjs';

test('older engineering objects and evidence remain accessible through explicit IDs and record paging',()=>{
  const objects=Array.from({length:220},(_,n)=>({id:'R-'+n,title:'Requirement '+n,revision:n+1,history:[],historyCount:0}));
  const value={schema:'manta-engineering-state-v1',objects,relations:[],snapshots:[],changes:[],evidence:Array.from({length:80},(_,n)=>({id:'E-'+n,objectVersions:{['R-'+n]:n+1}})),issues:[]};
  const first=engineeringStatePage(value,{});assert.equal(first.objects[0].id,'R-0');assert.equal(first.page.hasMore,true);
  const next=engineeringStatePage(value,{offset:200,limit:50});assert.equal(next.objects.length,20);assert.equal(next.objects.at(-1).id,'R-219');assert.equal(next.page.hasMore,false);
  const exact=engineeringStatePage(value,{objectIds:['R-0','R-219','missing']});assert.deepEqual(exact.objects.map(o=>[o.id,o.revision]),[['R-0',1],['R-219',220]]);assert.deepEqual(exact.missingObjectIds,['missing']);
  const older=engineeringStatePage(value,{section:'evidence',offset:0,limit:5});assert.equal(older.evidence[0].id,'E-0');assert.equal(older.page.total,80);assert.equal(older.objects.length,0);
  assert.throws(()=>engineeringStatePage(value,{offset:-1}));assert.throws(()=>engineeringStatePage(value,{limit:1000}));
});

test('manual engineering requests display the selected configuration and declared execution associations',()=>{
  const view=buildApprovalPresentation({tool:'record_engineering_evidence',args:{title:'A declared check',scope:'Application input check only',result:'passed',objectIds:['R-1'],paths:['result.txt'],snapshotId:'snapshot-selected',runId:'run-declared',artifactId:'artifact-declared'}});
  assert.equal(view.title,'登记工程证据');
  for(const id of ['snapshot-selected','run-declared','artifact-declared'])assert.ok(view.fields.some(field=>field.value===id));
  const change=buildApprovalPresentation({tool:'propose_engineering_change',args:{title:'Proposed clarification',reason:'Still pending',baseSnapshotId:'snapshot-before',objectIds:['R-1']}});assert.ok(change.fields.some(field=>field.value==='snapshot-before'));
  assert.equal(ENGINEERING_STATE_TOOL_DEFINITIONS.some(t=>/approve/i.test(t.name)),false);
});

for(const [providerId,runtimeName] of [['codex-local','codex-app-server'],['claude-local','claude-agent-sdk']])test(`${runtimeName} receives and executes the same engineering tools without a replacement model loop`,async t=>{
  const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'manta-native-records-')));
  const store=createStore({dataDir:path.join(temp,'data'),seed:false});
  const project=store.createProject({name:'Native engineering tool bridge',resources:{maxAutoResumes:0}});
  const workspace=store.workspace(project.id);await fs.writeFile(path.join(workspace,'requirements.md'),'# Candidate requirement\nAcceptance remains TBD.\n');
  const engineeringState=createEngineeringStateService({store});let entered=false;
  const providers={getConfig:id=>store.get('providers',id),redact:v=>String(v),complete(){throw Error('Must reuse native runtime');}};
  const adapter={startTurn(options){
    entered=true;
    const completion=(async()=>{
      options.onSession('native-records-session');
      assert.match(options.instructions,/Versioned engineering records/);
      for(const tool of ENGINEERING_STATE_TOOL_DEFINITIONS)assert.ok(options.tools.some(t=>t.name===tool.name));
      const object=await options.executeTool('record_engineering_object',{id:'R-NATIVE',kind:'requirement',title:'Candidate native tool requirement',description:'Acceptance TBD; no mission result.',sources:['requirements.md'],dependsOn:[]});assert.equal(object.revision,1);
      const observed=await options.executeTool('capture_configuration',{name:'Native observation',paths:['requirements.md']});assert.equal(observed.kind,'observation');assert.equal(observed.approval,undefined);
      const record=await options.executeTool('record_engineering_evidence',{title:'Pending verification',scope:'No engineering verification executed.',result:'not_executed',objectIds:['R-NATIVE'],paths:['requirements.md'],snapshotId:observed.id});assert.equal(record.provenance,'declared');
      const current=await options.executeTool('get_engineering_state',{objectIds:['R-NATIVE']});assert.equal(current.objects[0].id,'R-NATIVE');assert.equal(current.evidence[0].applicability.status,'unknown');
      return {sessionId:'native-records-session',content:'Candidate objects recorded; verification remains pending.'};
    })();return {completion,cancel(){}};
  }};
  const engine=createEngine({store,providers,engineeringState,emit:()=>{},runtimeAdapters:{[runtimeName]:adapter},runTimeoutMs:10000});
  t.after(async()=>{await engine.close();await fs.rm(temp,{recursive:true,force:true});});
  const {run}=engine.start({threadId:project.coordinatorThreadId,providerId,content:'Record the existing candidate requirement.',permissionMode:'auto'});
  const until=Date.now()+5000;while(engine.active.has(run.id)&&Date.now()<until)await new Promise(r=>setTimeout(r,5));
  assert.ok(entered);assert.equal(run.status,'completed',run.error);assert.equal(store.data.approvals.length,0);
  const state=await engineeringState.get(project.id);assert.equal(state.objects.length,1);assert.equal(state.evidence[0].result,'not_executed');assert.equal(state.evidence[0].applicability.status,'unknown');
});
