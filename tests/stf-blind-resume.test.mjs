import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateResumeBoundary,validateResumeState,planClaudeProviderSwitch,createSourceBoundaryAmendment,createProfessionalBoundaryAmendment,createClaudeBoundaryAmendment,createOrbitGroundBoundaryAmendment,resumeCapabilitiesForBoundary} from '../scripts/stf-blind-resume.mjs';
import {createStore} from '../server/store.mjs';

const legacyHosts=['raw.githubusercontent.com','github.com','nos3.org','nasa.gov','www.nasa.gov','science.nasa.gov','ntrs.nasa.gov','nodis3.gsfc.nasa.gov','nos3.readthedocs.io','www.census.gov','www2.census.gov','www.usgs.gov'];

function fixture(t){
  const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'manta-stf-resume-')));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const root=path.join(base,'studio'),vm=path.join(base,'linux-vm'),evalRoot=path.join(base,'eval');
  const slug='stf0123456789abcdef01',workspace=path.join(vm,'handoff','eval-workspaces',slug),dataDir=path.join(evalRoot,'manta-data');
  for(const dir of [root,workspace,dataDir])fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dataDir,'state.json'),'{}');
  const manifestPath=path.join(evalRoot,'boundary.json');
  const manifest={schema:'manta-requirements-first-eval-v1',projectId:'project_01234567',coordinatorThreadId:'thread_01234567',workspace,guestWorkspace:'/work',guestSessionPath:`/srv/manta/agent-eval/sessions/${slug}`,dataDir,sourceRoot:root,vmRoot:vm,port:4319,initialWorkspaceEntries:[],disabledAgentTools:['run_command','list_external_tools','call_external_tool','prepare_nos3_model','bind_nos3_results','inspect_nos3','prepare_nos3_environment','submit_nos3_job','get_nos3_job','wait_nos3_job','cancel_nos3_job','computer_use'],referenceImportDisabled:true,externalMcpDisabled:true,computerDisabled:true,nos3Disabled:true,professionalRunnerMode:'generic-only',nativeRuntime:'codex-app-server in Linux Bubblewrap',nativeReadIsolation:'guest default-deny mount namespace; one project bind'};
  fs.writeFileSync(manifestPath,JSON.stringify(manifest));
  const state={projects:[{id:manifest.projectId,coordinatorThreadId:manifest.coordinatorThreadId,folderPath:workspace}],threads:[{id:manifest.coordinatorThreadId,projectId:manifest.projectId,kind:'coordinator'}],runs:[],providers:[{id:'codex-local',type:'codex-app-server',keyEnv:''}]};
  return {root,vm,evalRoot,workspace,manifestPath,manifest,state};
}

test('resume validates the existing single-project boundary without requiring an empty workspace',t=>{
  const f=fixture(t);
  fs.writeFileSync(path.join(f.workspace,'model.sysml'),'existing work');
  const result=validateResumeBoundary(f.manifest,f.manifestPath,{root:f.root,vm:f.vm});
  assert.equal(result.workspace,f.workspace);
  assert.doesNotThrow(()=>validateResumeState(f.state,f.manifest));
});

test('resume rejects changed isolation, a different project, and in-flight work',t=>{
  const f=fixture(t),boundary=(manifest)=>validateResumeBoundary(manifest,f.manifestPath,{root:f.root,vm:f.vm});
  assert.throws(()=>boundary({...f.manifest,computerDisabled:false}),/isolation services/);
  assert.throws(()=>boundary({...f.manifest,disabledAgentTools:f.manifest.disabledAgentTools.filter(x=>x!=='run_command')}),/isolation boundary/);
  assert.throws(()=>boundary({...f.manifest,proxyMappedPublicHosts:['internal.example']}),/allowlist/);
  assert.throws(()=>validateResumeState({...f.state,projects:[{...f.state.projects[0],id:'project_other'}]},f.manifest),/stored project/);
  assert.throws(()=>validateResumeState({...f.state,runs:[{status:'waiting_approval'}]},f.manifest),/every STF run/);
  assert.throws(()=>validateResumeState({...f.state,providers:[{id:'codex-local',type:'codex-app-server',keyEnv:'OPENAI_API_KEY'}]},f.manifest),/host key/);
});

test('resume accepts the pinned legacy and expanded source boundaries without arbitrary host additions',t=>{
  const f=fixture(t),boundary=(hosts)=>validateResumeBoundary({...f.manifest,proxyMappedPublicHosts:hosts},f.manifestPath,{root:f.root,vm:f.vm});
  assert.equal(boundary(legacyHosts).workspace,f.workspace);
  assert.equal(boundary([...legacyHosts,'api.github.com']).workspace,f.workspace);
  assert.throws(()=>boundary([...legacyHosts,'api.github.com','internal.example']),/allowlist/);
});

function withLegacyBoundary(t){
  const f=fixture(t);f.manifest.proxyMappedPublicHosts=[...legacyHosts];
  fs.writeFileSync(f.manifestPath,JSON.stringify(f.manifest,null,2)+'\n');
  return f;
}

test('legacy null and omitted host fields retain the original pinned defaults',t=>{
  for(const form of ['null','omitted']){
    const f=fixture(t);
    if(form==='null')f.manifest.proxyMappedPublicHosts=null;
    fs.writeFileSync(f.manifestPath,JSON.stringify(f.manifest));
    assert.equal(validateResumeBoundary(f.manifest,f.manifestPath,{root:f.root,vm:f.vm}).workspace,f.workspace);
    const change=createSourceBoundaryAmendment(f.manifestPath,{rationale:'Official GitHub API NOS3 revision metadata.',root:f.root,vm:f.vm});
    const v2=JSON.parse(fs.readFileSync(change.path,'utf8'));
    assert.deepEqual(v2.proxyMappedPublicHosts,[...legacyHosts,'api.github.com']);
    assert.equal(validateResumeBoundary(v2,change.path,{root:f.root,vm:f.vm}).workspace,f.workspace);
  }
});

test('the actual frozen STF boundary shape creates a valid v2 only in a temporary read-only fixture', {skip:!fs.existsSync((process.env.MANTA_TEST_STF_BOUNDARY||''))}, t=>{
  const livePath=(process.env.MANTA_TEST_STF_BOUNDARY||'');
  const liveBytes=fs.readFileSync(livePath),liveHash=createHash('sha256').update(liveBytes).digest('hex');
  assert.equal(liveHash,'74f5be0c38d49f247652dc0570e45b33d70f1a36eef2edd8cd90805b5b519c4f');
  const f=fixture(t),original=JSON.parse(liveBytes.toString('utf8'));
  const copy={...original,sourceRoot:f.root,vmRoot:f.vm,dataDir:path.join(f.evalRoot,'manta-data'),workspace:f.workspace,guestSessionPath:f.manifest.guestSessionPath};
  fs.writeFileSync(f.manifestPath,JSON.stringify(copy,null,2)+'\n');
  assert.equal(copy.proxyMappedPublicHosts,undefined);
  const change=createSourceBoundaryAmendment(f.manifestPath,{rationale:'Pin official NOS3 commit metadata from the GitHub API.',root:f.root,vm:f.vm});
  const v2=JSON.parse(fs.readFileSync(change.path,'utf8'));
  assert.equal(validateResumeBoundary(v2,change.path,{root:f.root,vm:f.vm}).workspace,f.workspace);
  assert.equal(createHash('sha256').update(fs.readFileSync(livePath)).digest('hex'),liveHash,'the actual frozen manifest remains untouched');
});

test('a separate v2 amendment pins the original bytes and changes only the exact public host',t=>{
  const f=withLegacyBoundary(t),before=fs.readFileSync(f.manifestPath);
  const change=createSourceBoundaryAmendment(f.manifestPath,{rationale:'Official GitHub API commit metadata for a versioned NOS3 source.',root:f.root,vm:f.vm});
  assert.equal(path.basename(change.path),'boundary.v2.json');
  assert.deepEqual(fs.readFileSync(f.manifestPath),before,'the frozen first-run boundary stays byte-for-byte unchanged');
  assert.equal(change.previousBoundarySha256,createHash('sha256').update(before).digest('hex'));
  const v2=JSON.parse(fs.readFileSync(change.path,'utf8'));
  assert.deepEqual(v2.proxyMappedPublicHosts,[...legacyHosts,'api.github.com']);
  assert.deepEqual(v2.sourceAmendment.addedHosts,['api.github.com']);
  assert.deepEqual(v2.sourceAmendment.addedAgentTools,['fetch_public_asset']);
  assert.equal(v2.sourceAmendment.maxBytes,33554432);
  assert.equal(v2.sourceAmendment.policy,'https-exact-host-allowlist+project-root-content-addressed+no-extract-execute+rehash-on-use-v1');
  assert.equal(validateResumeBoundary(v2,change.path,{root:f.root,vm:f.vm}).workspace,f.workspace);
  assert.equal(validateResumeBoundary(f.manifest,f.manifestPath,{root:f.root,vm:f.vm}).workspace,f.workspace,'default legacy boundary remains valid');
  assert.throws(()=>createSourceBoundaryAmendment(f.manifestPath,{rationale:'Official metadata remains necessary.',root:f.root,vm:f.vm}),/EEXIST/);
});

test('NAS hardlink ENOTSUP creates v2 exclusively and keeps the frozen original unchanged',t=>{
  const f=withLegacyBoundary(t),before=fs.readFileSync(f.manifestPath),originalLink=fs.linkSync;
  fs.linkSync=()=>{const error=new Error('operation not supported');error.code='ENOTSUP';throw error;};
  try{
    const change=createSourceBoundaryAmendment(f.manifestPath,{rationale:'Official public NOS3 metadata and engineering data.',root:f.root,vm:f.vm});
    assert.deepEqual(fs.readFileSync(f.manifestPath),before);
    assert.equal(validateResumeBoundary(JSON.parse(fs.readFileSync(change.path,'utf8')),change.path,{root:f.root,vm:f.vm}).workspace,f.workspace);
    const first=fs.readFileSync(change.path);
    assert.throws(()=>createSourceBoundaryAmendment(f.manifestPath,{rationale:'Official public NOS3 metadata and engineering data.',root:f.root,vm:f.vm}),/EEXIST/);
    assert.deepEqual(fs.readFileSync(change.path),first);
    assert.equal(fs.readdirSync(f.evalRoot).some(name=>name.startsWith('.source-boundary-')),false);
  }finally{fs.linkSync=originalLink;}
});

test('failed NAS boundary write leaves a partial v2 that cannot be resumed or overwritten',t=>{
  const f=withLegacyBoundary(t),before=fs.readFileSync(f.manifestPath);
  const originalLink=fs.linkSync,originalWrite=fs.writeFileSync;
  fs.linkSync=()=>{const error=new Error('operation not supported');error.code='ENOTSUP';throw error;};
  fs.writeFileSync=(target,...args)=>{
    if(typeof target==='number'){originalWrite(target,Buffer.from('{'));throw new Error('simulated NAS write failure');}
    return originalWrite(target,...args);
  };
  try{
    assert.throws(()=>createSourceBoundaryAmendment(f.manifestPath,{rationale:'Official source import needs a pinned host.',root:f.root,vm:f.vm}),/partial v2 file may remain/);
  }finally{fs.linkSync=originalLink;fs.writeFileSync=originalWrite;}
  const v2Path=path.join(f.evalRoot,'boundary.v2.json');
  assert.deepEqual(fs.readFileSync(f.manifestPath),before);
  assert.equal(fs.readFileSync(v2Path,'utf8'),'{');
  assert.throws(()=>JSON.parse(fs.readFileSync(v2Path,'utf8')),SyntaxError);
  assert.throws(()=>createSourceBoundaryAmendment(f.manifestPath,{rationale:'Official source import needs a pinned host.',root:f.root,vm:f.vm}),/EEXIST/);
});

test('v2 rejects altered originals, hosts, tool/cap/policy, projects, symlinks and missing originals',t=>{
  for(const alteration of ['original','extra-host','tool','cap','policy','project','symlink','missing-original']){
    const f=withLegacyBoundary(t),change=createSourceBoundaryAmendment(f.manifestPath,{rationale:'Pin the public NASA NOS3 commit source.',root:f.root,vm:f.vm});
    const v2=JSON.parse(fs.readFileSync(change.path,'utf8'));
    if(alteration==='original')fs.appendFileSync(f.manifestPath,'\n');
    if(alteration==='extra-host'){v2.proxyMappedPublicHosts.push('internal.example');fs.writeFileSync(change.path,JSON.stringify(v2));}
    if(alteration==='tool'){v2.sourceAmendment.addedAgentTools.push('run_command');fs.writeFileSync(change.path,JSON.stringify(v2));}
    if(alteration==='cap'){v2.sourceAmendment.maxBytes*=2;fs.writeFileSync(change.path,JSON.stringify(v2));}
    if(alteration==='policy'){v2.sourceAmendment.policy='https-any-host';fs.writeFileSync(change.path,JSON.stringify(v2));}
    if(alteration==='project'){v2.projectId='project_other';fs.writeFileSync(change.path,JSON.stringify(v2));}
    if(alteration==='symlink'){const moved=change.path+'.real';fs.renameSync(change.path,moved);fs.symlinkSync(moved,change.path);}
    if(alteration==='missing-original')fs.unlinkSync(f.manifestPath);
    assert.throws(()=>validateResumeBoundary(v2,change.path,{root:f.root,vm:f.vm}),/amendment|symbolic link|missing/,alteration);
  }
});

test('v3 enables only pinned project-scoped GIS and NASA 42 tools while preserving earlier boundaries',t=>{
  const f=withLegacyBoundary(t),original=fs.readFileSync(f.manifestPath);
  const v2Path=createSourceBoundaryAmendment(f.manifestPath,{rationale:'Pin official public NOS3 and Census inputs.',root:f.root,vm:f.vm}).path;
  const v2Bytes=fs.readFileSync(v2Path),change=createProfessionalBoundaryAmendment(v2Path,{rationale:'Validate real Census geometry and bounded NASA 42 propagation inside the managed VM.',root:f.root,vm:f.vm});
  const v3=JSON.parse(fs.readFileSync(change.path,'utf8'));
  assert.equal(path.basename(change.path),'boundary.v3.json');
  assert.deepEqual(fs.readFileSync(f.manifestPath),original);
  assert.deepEqual(fs.readFileSync(v2Path),v2Bytes);
  assert.equal(v3.professionalAmendment.previousBoundarySha256,createHash('sha256').update(v2Bytes).digest('hex'));
  assert.deepEqual(v3.professionalAmendment.addedServices,['geospatial','orbit42']);
  assert.equal(v3.professionalAmendment.addedAgentTools.length,13);
  assert.equal(validateResumeBoundary(v3,change.path,{root:f.root,vm:f.vm}).workspace,f.workspace);
  assert.doesNotThrow(()=>validateResumeState(f.state,v3));
  assert.throws(()=>createProfessionalBoundaryAmendment(v2Path,{rationale:'Recreate a pinned professional boundary.',root:f.root,vm:f.vm}),/EEXIST/);
});

test('v3 refuses changed parent bytes, tool scopes, project, symlinks and missing source amendment',t=>{
  for(const alteration of ['parent','tool','service','project','symlink','missing-parent']){
    const f=withLegacyBoundary(t);
    const v2Path=createSourceBoundaryAmendment(f.manifestPath,{rationale:'Pin official public engineering inputs.',root:f.root,vm:f.vm}).path;
    const change=createProfessionalBoundaryAmendment(v2Path,{rationale:'Run isolated native professional checks with pinned receipts.',root:f.root,vm:f.vm});
    const v3=JSON.parse(fs.readFileSync(change.path,'utf8'));
    if(alteration==='parent')fs.appendFileSync(v2Path,'\n');
    if(alteration==='tool'){v3.professionalAmendment.addedAgentTools.push('run_command');fs.writeFileSync(change.path,JSON.stringify(v3));}
    if(alteration==='service'){v3.professionalAmendment.addedServices.push('nos3');fs.writeFileSync(change.path,JSON.stringify(v3));}
    if(alteration==='project'){v3.projectId='project_other';fs.writeFileSync(change.path,JSON.stringify(v3));}
    if(alteration==='symlink'){const moved=change.path+'.real';fs.renameSync(change.path,moved);fs.symlinkSync(moved,change.path);}
    if(alteration==='missing-parent')fs.unlinkSync(v2Path);
    assert.throws(()=>validateResumeBoundary(v3,change.path,{root:f.root,vm:f.vm}),/amendment|symbolic link|missing/,alteration);
  }
});

test('v4 pins only a guest Claude native runtime and permits the explicit Claude provider without Codex',t=>{
  const f=withLegacyBoundary(t),original=fs.readFileSync(f.manifestPath);
  const v2Path=createSourceBoundaryAmendment(f.manifestPath,{rationale:'Pin official public STF source assets.',root:f.root,vm:f.vm}).path;
  const v3Path=createProfessionalBoundaryAmendment(v2Path,{rationale:'Use verified native engineering tools in the isolated Linux guest.',root:f.root,vm:f.vm}).path;
  const v3Bytes=fs.readFileSync(v3Path),change=createClaudeBoundaryAmendment(v3Path,{rationale:'Run Claude Code only inside the same one-project Linux Bubblewrap namespace.',root:f.root,vm:f.vm});
  const v4=JSON.parse(fs.readFileSync(change.path,'utf8'));
  assert.equal(path.basename(change.path),'boundary.v4.json');
  assert.deepEqual(fs.readFileSync(f.manifestPath),original);
  assert.deepEqual(fs.readFileSync(v3Path),v3Bytes);
  assert.equal(v4.claudeAmendment.previousBoundarySha256,createHash('sha256').update(v3Bytes).digest('hex'));
  assert.equal(v4.claudeAmendment.addedAgentRuntime,'claude-agent-sdk-guest');
  assert.equal(validateResumeBoundary(v4,change.path,{root:f.root,vm:f.vm}).workspace,f.workspace);
  const claudeState={...f.state,providers:[{id:'claude-local',type:'claude-agent',keyEnv:''}]};
  assert.doesNotThrow(()=>validateResumeState(claudeState,v4));
  assert.throws(()=>validateResumeState({...claudeState,providers:[{id:'claude-local',type:'claude-agent',keyEnv:'ANTHROPIC_API_KEY'}]},v4),/host key/);
  assert.throws(()=>validateResumeState({...claudeState,providers:[...claudeState.providers,{id:'other',type:'claude-agent',keyEnv:''}]},v4),/unreviewed provider/);
  assert.throws(()=>validateResumeState({...claudeState,providers:[...claudeState.providers,...claudeState.providers]},v4),/duplicate IDs/);
  assert.throws(()=>validateResumeState(claudeState,JSON.parse(v3Bytes.toString('utf8'))),/Codex connection/);
  assert.throws(()=>createClaudeBoundaryAmendment(v3Path,{rationale:'Do not overwrite the exact guest runtime boundary.',root:f.root,vm:f.vm}),/EEXIST/);
});

test('explicit v4 switch updates future Agent selection without rewriting historical runs or pending handoffs',t=>{
  const f=withLegacyBoundary(t);
  const v2Path=createSourceBoundaryAmendment(f.manifestPath,{rationale:'Pin public STF source references.',root:f.root,vm:f.vm}).path;
  const v3Path=createProfessionalBoundaryAmendment(v2Path,{rationale:'Pin GIS and NASA 42 engineering tools.',root:f.root,vm:f.vm}).path;
  const v4Path=createClaudeBoundaryAmendment(v3Path,{rationale:'Run Claude Code in a single-project Linux guest.',root:f.root,vm:f.vm}).path;
  const v4=JSON.parse(fs.readFileSync(v4Path,'utf8'));
  const original={...f.state,projects:[{...f.state.projects[0],lastProviderId:'codex-local',coordinatorProviderId:'codex-local'}],threads:[{...f.state.threads[0],lastProviderId:'codex-local',providerId:'codex-local'}],providers:[{id:'claude-local',type:'claude-agent',keyEnv:''}],runs:[{id:'run_old',status:'completed',providerId:'codex-local'}],messages:[]};
  const switched=planClaudeProviderSwitch(original,v4);
  assert.equal(switched.changed,true);
  assert.equal(switched.state.projects[0].coordinatorProviderId,'claude-local');
  assert.equal(switched.state.threads[0].lastProviderId,'claude-local');
  assert.deepEqual(switched.state.runs,original.runs);
  assert.equal(original.projects[0].coordinatorProviderId,'codex-local');
  assert.equal(planClaudeProviderSwitch(switched.state,v4).changed,false);
  const pending={...original,messages:[{type:'thread.result',metadata:{summaryStatus:'pending'}}]};
  assert.throws(()=>planClaudeProviderSwitch(pending,v4),/pending thread results/);
});

test('isolated Claude bootstrap does not re-add a deleted Codex provider',t=>{
  const f=fixture(t),dataDir=path.join(f.evalRoot,'manta-data');
  const store=createStore({dataDir,root:f.root,seed:false,addDefaultCodexProvider:false});
  assert.deepEqual(store.data.providers.map(provider=>provider.id),['demo','claude-local']);
  const ordinary=createStore({dataDir,root:f.root,seed:false});
  assert.ok(ordinary.data.providers.some(provider=>provider.id==='codex-local'),'ordinary projects still retain Codex as a built-in choice');
});

test('v4 rejects tampered parent, provider capability, project, symlink and missing v3',t=>{
  for(const alteration of ['parent','runtime','policy','project','symlink','missing-parent']){
    const f=withLegacyBoundary(t);
    const v2Path=createSourceBoundaryAmendment(f.manifestPath,{rationale:'Pin public STF source references.',root:f.root,vm:f.vm}).path;
    const v3Path=createProfessionalBoundaryAmendment(v2Path,{rationale:'Pin GIS and NASA 42 engineering tools.',root:f.root,vm:f.vm}).path;
    const change=createClaudeBoundaryAmendment(v3Path,{rationale:'Keep Claude Code inside the single project Linux guest.',root:f.root,vm:f.vm});
    const v4=JSON.parse(fs.readFileSync(change.path,'utf8'));
    if(alteration==='parent')fs.appendFileSync(v3Path,'\n');
    if(alteration==='runtime'){v4.claudeAmendment.addedAgentRuntime='claude-agent-sdk-host';fs.writeFileSync(change.path,JSON.stringify(v4));}
    if(alteration==='policy'){v4.claudeAmendment.policy='host-auto';fs.writeFileSync(change.path,JSON.stringify(v4));}
    if(alteration==='project'){v4.projectId='project_other';fs.writeFileSync(change.path,JSON.stringify(v4));}
    if(alteration==='symlink'){const moved=change.path+'.real';fs.renameSync(change.path,moved);fs.symlinkSync(moved,change.path);}
    if(alteration==='missing-parent')fs.unlinkSync(v3Path);
    assert.throws(()=>validateResumeBoundary(v4,change.path,{root:f.root,vm:f.vm}),/amendment|symbolic link|missing/,alteration);
  }
});

test('v5 pins only isolated orbit-ground tools and a 24-turn native worker budget without changing v1-v4',t=>{
  const f=withLegacyBoundary(t),original=fs.readFileSync(f.manifestPath);
  const v2Path=createSourceBoundaryAmendment(f.manifestPath,{rationale:'Pin public STF source references.',root:f.root,vm:f.vm}).path;
  const v3Path=createProfessionalBoundaryAmendment(v2Path,{rationale:'Pin GIS and NASA 42 engineering tools.',root:f.root,vm:f.vm}).path;
  const v4Path=createClaudeBoundaryAmendment(v3Path,{rationale:'Keep Claude Code inside the single project Linux guest.',root:f.root,vm:f.vm}).path;
  const older=new Map([f.manifestPath,v2Path,v3Path,v4Path].map(file=>[file,fs.readFileSync(file)]));
  const change=createOrbitGroundBoundaryAmendment(v4Path,{rationale:'Check STF orbit and official ground geometry in the isolated Linux guest.',root:f.root,vm:f.vm});
  const v5=JSON.parse(fs.readFileSync(change.path,'utf8'));
  assert.equal(path.basename(change.path),'boundary.v5.json');
  assert.deepEqual(fs.readFileSync(f.manifestPath),original);
  for(const [file,bytes] of older){
    assert.deepEqual(fs.readFileSync(file),bytes,`${path.basename(file)} stays byte-for-byte unchanged`);
    assert.equal(validateResumeBoundary(JSON.parse(bytes),file,{root:f.root,vm:f.vm}).workspace,f.workspace);
  }
  assert.equal(v5.orbitGroundAmendment.previousBoundarySha256,createHash('sha256').update(older.get(v4Path)).digest('hex'));
  assert.deepEqual(v5.orbitGroundAmendment.addedServices,['orbitGround']);
  assert.deepEqual(v5.orbitGroundAmendment.addedAgentTools,['orbit_ground_catalog','submit_orbit_ground_job','get_orbit_ground_job','wait_orbit_ground_job','cancel_orbit_ground_job']);
  assert.deepEqual(v5.orbitGroundAmendment.allowedCensusHashes,['ad00cbe66c7177091b668cee202e93d4a1ddcee271c28d1c9f9874af59c04b92']);
  assert.equal(v5.orbitGroundAmendment.maxNativeTurns,24);
  assert.deepEqual(v5.disabledAgentTools,f.manifest.disabledAgentTools);
  assert.equal(v5.externalMcpDisabled,true);
  assert.equal(v5.computerDisabled,true);
  assert.equal(v5.nos3Disabled,true);
  assert.equal(v5.guestWorkspace,'/work');
  assert.equal(validateResumeBoundary(v5,change.path,{root:f.root,vm:f.vm}).workspace,f.workspace);
  assert.doesNotThrow(()=>validateResumeState({...f.state,providers:[{id:'claude-local',type:'claude-agent',keyEnv:''}]},v5));
  assert.deepEqual(resumeCapabilitiesForBoundary(change.path),{claudeGuestEnabled:true,professionalAmended:true,orbitGroundEnabled:true,maxTurns:24});
  assert.deepEqual(resumeCapabilitiesForBoundary(v4Path),{claudeGuestEnabled:true,professionalAmended:true,orbitGroundEnabled:false});
  assert.deepEqual(resumeCapabilitiesForBoundary(v3Path),{claudeGuestEnabled:false,professionalAmended:true,orbitGroundEnabled:false});
  assert.deepEqual(resumeCapabilitiesForBoundary(v2Path),{claudeGuestEnabled:false,professionalAmended:false,orbitGroundEnabled:false});
  assert.deepEqual(resumeCapabilitiesForBoundary(f.manifestPath),{claudeGuestEnabled:false,professionalAmended:false,orbitGroundEnabled:false});
  assert.throws(()=>createOrbitGroundBoundaryAmendment(v4Path,{rationale:'Never overwrite an existing v5 boundary.',root:f.root,vm:f.vm}),/EEXIST/);
});

test('the actual isolated STF v4 bytes still match the previously recorded SHA-256',{
  skip:!fs.existsSync((process.env.MANTA_TEST_STF_BOUNDARY_V4||''))
},()=>{
  const livePath=(process.env.MANTA_TEST_STF_BOUNDARY_V4||'');
  const bytes=fs.readFileSync(livePath);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'06c4a4c62e4325d098959c6569852f77464f869cd46454c61eb88acd6fc7c9f0');
  assert.equal(validateResumeBoundary(JSON.parse(bytes),livePath).workspace.includes('/eval-workspaces/stf'),true);
});

test('v5 refuses changed v4 bytes, source hash, tool/service scope, turn limit, isolation, project and symlinks',t=>{
  for(const alteration of ['parent','tool','service','source-hash','turns','policy','project','disabled','external-mcp','symlink','missing-parent']){
    const f=withLegacyBoundary(t);
    const v2Path=createSourceBoundaryAmendment(f.manifestPath,{rationale:'Pin public STF source references.',root:f.root,vm:f.vm}).path;
    const v3Path=createProfessionalBoundaryAmendment(v2Path,{rationale:'Pin GIS and NASA 42 engineering tools.',root:f.root,vm:f.vm}).path;
    const v4Path=createClaudeBoundaryAmendment(v3Path,{rationale:'Keep Claude Code inside the single project Linux guest.',root:f.root,vm:f.vm}).path;
    const change=createOrbitGroundBoundaryAmendment(v4Path,{rationale:'Run bounded orbit-ground checks inside the same isolated Linux guest.',root:f.root,vm:f.vm});
    const v5=JSON.parse(fs.readFileSync(change.path,'utf8'));
    if(alteration==='parent')fs.appendFileSync(v4Path,'\n');
    if(alteration==='tool')v5.orbitGroundAmendment.addedAgentTools.push('run_command');
    if(alteration==='service')v5.orbitGroundAmendment.addedServices.push('connectors');
    if(alteration==='source-hash')v5.orbitGroundAmendment.allowedCensusHashes=['0'.repeat(64)];
    if(alteration==='turns')v5.orbitGroundAmendment.maxNativeTurns=240;
    if(alteration==='policy')v5.orbitGroundAmendment.policy='host-unrestricted';
    if(alteration==='project')v5.projectId='project_other';
    if(alteration==='disabled')v5.disabledAgentTools=v5.disabledAgentTools.filter(name=>name!=='run_command');
    if(alteration==='external-mcp')v5.externalMcpDisabled=false;
    if(['tool','service','source-hash','turns','policy','project','disabled','external-mcp'].includes(alteration))fs.writeFileSync(change.path,JSON.stringify(v5));
    if(alteration==='symlink'){const moved=change.path+'.real';fs.renameSync(change.path,moved);fs.symlinkSync(moved,change.path);}
    if(alteration==='missing-parent')fs.unlinkSync(v4Path);
    assert.throws(()=>validateResumeBoundary(v5,change.path,{root:f.root,vm:f.vm}),/amendment|symbolic link|missing/,alteration);
  }
});

test('NAS hardlink ENOTSUP creates v5 exclusively and preserves the complete v1-v4 chain',t=>{
  const f=withLegacyBoundary(t);
  const v2Path=createSourceBoundaryAmendment(f.manifestPath,{rationale:'Pin public STF source references.',root:f.root,vm:f.vm}).path;
  const v3Path=createProfessionalBoundaryAmendment(v2Path,{rationale:'Pin GIS and NASA 42 engineering tools.',root:f.root,vm:f.vm}).path;
  const v4Path=createClaudeBoundaryAmendment(v3Path,{rationale:'Keep Claude Code inside the single project Linux guest.',root:f.root,vm:f.vm}).path;
  const older=new Map([f.manifestPath,v2Path,v3Path,v4Path].map(file=>[file,fs.readFileSync(file)]));
  const originalLink=fs.linkSync;
  fs.linkSync=()=>{const error=new Error('operation not supported');error.code='ENOTSUP';throw error;};
  try{
    const change=createOrbitGroundBoundaryAmendment(v4Path,{rationale:'Run bounded orbit-ground checks inside the same isolated Linux guest.',root:f.root,vm:f.vm});
    for(const [file,bytes] of older)assert.deepEqual(fs.readFileSync(file),bytes);
    assert.equal(validateResumeBoundary(JSON.parse(fs.readFileSync(change.path,'utf8')),change.path,{root:f.root,vm:f.vm}).workspace,f.workspace);
    const first=fs.readFileSync(change.path);
    assert.throws(()=>createOrbitGroundBoundaryAmendment(v4Path,{rationale:'Do not overwrite the v5 boundary.',root:f.root,vm:f.vm}),/EEXIST/);
    assert.deepEqual(fs.readFileSync(change.path),first);
    assert.equal(fs.readdirSync(f.evalRoot).some(name=>name.startsWith('.orbit-ground-boundary-')),false);
  }finally{fs.linkSync=originalLink;}
});
