import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createStudioServer} from '../server/index.mjs';
import {stageManagedWorkerBundle} from '../server/local-linux-vm.mjs';
import {publicFetch} from '../server/sandbox.mjs';
import {PUBLIC_ASSET_MAX_BYTES} from '../server/public-assets.mjs';

const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const vmRoot=path.resolve(process.env.MANTA_NOS3_VM_ROOT||path.join(sourceRoot,'vm'));
const disabledAgentTools=Object.freeze(['run_command','list_external_tools','call_external_tool','prepare_nos3_model','bind_nos3_results','inspect_nos3','prepare_nos3_environment','submit_nos3_job','get_nos3_job','wait_nos3_job','cancel_nos3_job','computer_use']);
// Match the isolated instance's explicit source list. publicFetch pins DNS,
// checks every redirect, and permits proxy-mapped 198.18/15 only for these HTTPS hosts.
const proxyMappedPublicHosts=Object.freeze(['raw.githubusercontent.com','github.com','nos3.org','nasa.gov','www.nasa.gov','science.nasa.gov','ntrs.nasa.gov','nodis3.gsfc.nasa.gov','nos3.readthedocs.io','www.census.gov','www2.census.gov','www.usgs.gov']);
const expandedSourceHosts=Object.freeze([...proxyMappedPublicHosts,'api.github.com']);
const sameItems=(actual,expected)=>Array.isArray(actual)&&actual.length===expected.length&&actual.every((item,index)=>item===expected[index]);
// The frozen first-run boundary omitted the old implicit host list. Older
// records may also have null; only omitted/null or the exact historical list
// mean that pinned legacy set.
const isLegacySourceHosts=hosts=>hosts==null||sameItems(hosts,proxyMappedPublicHosts);
const contains=(parent,child)=>child.startsWith(parent+path.sep);
const sourceAmendmentName='boundary.v2.json';
const professionalAmendmentName='boundary.v3.json';
const claudeAmendmentName='boundary.v4.json';
const orbitGroundAmendmentName='boundary.v5.json';
const sourceAssetPolicy='https-exact-host-allowlist+project-root-content-addressed+no-extract-execute+rehash-on-use-v1';
const professionalToolPolicy='isolated-vm-native-gis-and-nasa42+project-scoped-hash-verified-receipts-v1';
const claudeRuntimePolicy='claude-agent-sdk-host-hooks+linux-bubblewrap-cli-stdio+single-project-read-v1';
const orbitGroundToolPolicy='isolated-vm-orbit-ground+project-scoped-hash-verified-receipts-v1';
const orbitGroundMaxNativeTurns=24;
const stfCensusStateZipSha256='ad00cbe66c7177091b668cee202e93d4a1ddcee271c28d1c9f9874af59c04b92';
const pinnedClaudeCliSha256='1c67968ab8410c9644e2f4867167a0dab1a8c6c9de9cc83fe78449e5ae8a3633';
const professionalAgentTools=Object.freeze(['geospatial_catalog','prepare_geospatial_environment','submit_geospatial_job','get_geospatial_job','wait_geospatial_job','cancel_geospatial_job','orbit42_catalog','read_orbit42_model','save_orbit42_model','submit_orbit42_job','get_orbit42_job','wait_orbit42_job','cancel_orbit42_job']);
const orbitGroundAgentTools=Object.freeze(['orbit_ground_catalog','submit_orbit_ground_job','get_orbit_ground_job','wait_orbit_ground_job','cancel_orbit_ground_job']);
const unsupportedLinkCodes=new Set(['ENOTSUP','EOPNOTSUPP']);

function validateSourceAmendment(manifest,manifestPath,{root,vm}){
  const originalPath=path.join(path.dirname(manifestPath),'boundary.json');
  if(!fs.existsSync(originalPath))throw new Error('Original boundary.json is missing');
  if(fs.lstatSync(originalPath).isSymbolicLink())throw new Error('Original boundary.json cannot be a symbolic link');
  const originalBytes=fs.readFileSync(originalPath),original=JSON.parse(originalBytes.toString('utf8'));
  validateResumeBoundary(original,originalPath,{root,vm});
  if(!isLegacySourceHosts(original.proxyMappedPublicHosts))throw new Error('Only the pinned legacy source boundary can be amended');
  const change=manifest?.sourceAmendment;
  if(!change||Object.keys(change).sort().join(',')!=='addedAgentTools,addedHosts,maxBytes,policy,previousBoundarySha256,rationale,recordedAt,revision'
    ||change.revision!==2||!sameItems(change.addedHosts,['api.github.com'])
    ||!sameItems(change.addedAgentTools,['fetch_public_asset'])
    ||change.maxBytes!==PUBLIC_ASSET_MAX_BYTES||change.policy!==sourceAssetPolicy
    ||change.previousBoundarySha256!==createHash('sha256').update(originalBytes).digest('hex')
    ||typeof change.rationale!=='string'||change.rationale.trim().length<10||change.rationale.length>500
    ||typeof change.recordedAt!=='string'||!Number.isFinite(Date.parse(change.recordedAt))||new Date(change.recordedAt).toISOString()!==change.recordedAt)throw new Error('Invalid or unpinned source boundary amendment');
  const expected={...original,proxyMappedPublicHosts:expandedSourceHosts};
  const candidate={...manifest};delete candidate.sourceAmendment;
  if(!isDeepStrictEqual(candidate,expected))throw new Error('Source boundary amendment changed fields beyond the exact host addition');
}

function validateProfessionalAmendment(manifest,manifestPath,{root,vm}){
  const previousPath=path.join(path.dirname(manifestPath),sourceAmendmentName);
  if(!fs.existsSync(previousPath))throw new Error('Previous source boundary amendment is missing');
  if(fs.lstatSync(previousPath).isSymbolicLink())throw new Error('Previous source boundary amendment cannot be a symbolic link');
  const previousBytes=fs.readFileSync(previousPath),previous=JSON.parse(previousBytes.toString('utf8'));
  validateResumeBoundary(previous,previousPath,{root,vm});
  const change=manifest?.professionalAmendment;
  if(!change||Object.keys(change).sort().join(',')!=='addedAgentTools,addedServices,policy,previousBoundarySha256,rationale,recordedAt,revision'
    ||change.revision!==3||!sameItems(change.addedServices,['geospatial','orbit42'])
    ||!sameItems(change.addedAgentTools,professionalAgentTools)||change.policy!==professionalToolPolicy
    ||change.previousBoundarySha256!==createHash('sha256').update(previousBytes).digest('hex')
    ||typeof change.rationale!=='string'||change.rationale.trim().length<10||change.rationale.length>500
    ||typeof change.recordedAt!=='string'||!Number.isFinite(Date.parse(change.recordedAt))||new Date(change.recordedAt).toISOString()!==change.recordedAt)throw new Error('Invalid or unpinned professional boundary amendment');
  const candidate={...manifest};delete candidate.professionalAmendment;
  if(!isDeepStrictEqual(candidate,previous))throw new Error('Professional boundary amendment changed fields beyond the exact isolated tool addition');
}

function validateClaudeAmendment(manifest,manifestPath,{root,vm}){
  const previousPath=path.join(path.dirname(manifestPath),professionalAmendmentName);
  if(!fs.existsSync(previousPath))throw new Error('Previous professional boundary amendment is missing');
  if(fs.lstatSync(previousPath).isSymbolicLink())throw new Error('Previous professional boundary amendment cannot be a symbolic link');
  const previousBytes=fs.readFileSync(previousPath),previous=JSON.parse(previousBytes.toString('utf8'));
  validateResumeBoundary(previous,previousPath,{root,vm});
  const change=manifest?.claudeAmendment;
  if(!change||Object.keys(change).sort().join(',')!=='addedAgentRuntime,policy,previousBoundarySha256,rationale,recordedAt,revision'
    ||change.revision!==4||change.addedAgentRuntime!=='claude-agent-sdk-guest'
    ||change.policy!==claudeRuntimePolicy
    ||change.previousBoundarySha256!==createHash('sha256').update(previousBytes).digest('hex')
    ||typeof change.rationale!=='string'||change.rationale.trim().length<10||change.rationale.length>500
    ||typeof change.recordedAt!=='string'||!Number.isFinite(Date.parse(change.recordedAt))||new Date(change.recordedAt).toISOString()!==change.recordedAt)throw new Error('Invalid or unpinned Claude runtime amendment');
  const candidate={...manifest};delete candidate.claudeAmendment;
  if(!isDeepStrictEqual(candidate,previous))throw new Error('Claude runtime amendment changed fields beyond the exact guest addition');
}

function validateOrbitGroundAmendment(manifest,manifestPath,{root,vm}){
  const previousPath=path.join(path.dirname(manifestPath),claudeAmendmentName);
  if(!fs.existsSync(previousPath))throw new Error('Previous Claude boundary amendment is missing');
  if(fs.lstatSync(previousPath).isSymbolicLink())throw new Error('Previous Claude boundary amendment cannot be a symbolic link');
  const previousBytes=fs.readFileSync(previousPath),previous=JSON.parse(previousBytes.toString('utf8'));
  validateResumeBoundary(previous,previousPath,{root,vm});
  const change=manifest?.orbitGroundAmendment;
  if(!change||Object.keys(change).sort().join(',')!=='addedAgentTools,addedServices,allowedCensusHashes,maxNativeTurns,policy,previousBoundarySha256,rationale,recordedAt,revision'
    ||change.revision!==5||!sameItems(change.addedServices,['orbitGround'])
    ||!sameItems(change.addedAgentTools,orbitGroundAgentTools)
    ||!sameItems(change.allowedCensusHashes,[stfCensusStateZipSha256])
    ||change.maxNativeTurns!==orbitGroundMaxNativeTurns||change.policy!==orbitGroundToolPolicy
    ||change.previousBoundarySha256!==createHash('sha256').update(previousBytes).digest('hex')
    ||typeof change.rationale!=='string'||change.rationale.trim().length<10||change.rationale.length>500
    ||typeof change.recordedAt!=='string'||!Number.isFinite(Date.parse(change.recordedAt))||new Date(change.recordedAt).toISOString()!==change.recordedAt)throw new Error('Invalid or unpinned orbit-ground boundary amendment');
  const candidate={...manifest};delete candidate.orbitGroundAmendment;
  if(!isDeepStrictEqual(candidate,previous))throw new Error('Orbit-ground boundary amendment changed fields beyond the exact isolated tool and turn-limit addition');
}

export function resumeCapabilitiesForBoundary(manifestPath){
  const amendment=path.basename(manifestPath);
  return {
    claudeGuestEnabled:[claudeAmendmentName,orbitGroundAmendmentName].includes(amendment),
    professionalAmended:[professionalAmendmentName,claudeAmendmentName,orbitGroundAmendmentName].includes(amendment),
    orbitGroundEnabled:amendment===orbitGroundAmendmentName,
    ...(amendment===orbitGroundAmendmentName?{maxTurns:orbitGroundMaxNativeTurns}:{})
  };
}

export function validateResumeBoundary(manifest,manifestPath,{root=sourceRoot,vm=vmRoot}={}) {
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))throw new Error('Invalid evaluation boundary');
  const basename=path.basename(manifestPath);
  if(!['boundary.json',sourceAmendmentName,professionalAmendmentName,claudeAmendmentName,orbitGroundAmendmentName].includes(basename)||!path.isAbsolute(manifestPath))throw new Error('Pass the absolute path to boundary.json or an explicit amendment');
  if(fs.lstatSync(manifestPath).isSymbolicLink())throw new Error('Evaluation boundary cannot be a symbolic link');
  const boundaryFile=fs.realpathSync(manifestPath),evalRoot=path.dirname(boundaryFile);
  if(basename===sourceAmendmentName)validateSourceAmendment(manifest,manifestPath,{root,vm});
  else if(basename===professionalAmendmentName)validateProfessionalAmendment(manifest,manifestPath,{root,vm});
  else if(basename===claudeAmendmentName)validateClaudeAmendment(manifest,manifestPath,{root,vm});
  else if(basename===orbitGroundAmendmentName)validateOrbitGroundAmendment(manifest,manifestPath,{root,vm});
  else if(manifest.sourceAmendment!==undefined||manifest.professionalAmendment!==undefined||manifest.claudeAmendment!==undefined||manifest.orbitGroundAmendment!==undefined)throw new Error('The original boundary cannot contain an amendment');
  if(manifest.schema!=='manta-requirements-first-eval-v1')throw new Error('Unsupported evaluation boundary schema');
  if(!/^project_[a-f0-9-]+$/i.test(manifest.projectId)||!/^thread_[a-f0-9-]+$/i.test(manifest.coordinatorThreadId))throw new Error('Invalid evaluation project or Coordinator ID');
  if(!Number.isInteger(manifest.port)||manifest.port<1024||manifest.port>65535)throw new Error('Invalid evaluation port');
  const canonicalRoot=fs.realpathSync(root),canonicalVm=fs.realpathSync(vm);
  if(fs.realpathSync(manifest.sourceRoot)!==canonicalRoot||fs.realpathSync(manifest.vmRoot)!==canonicalVm)throw new Error('The boundary targets another Manta source or Linux VM');
  const dataDir=path.join(evalRoot,'manta-data'),workspaceRoot=path.join(canonicalVm,'handoff','eval-workspaces');
  if(path.resolve(manifest.dataDir)!==dataDir||fs.realpathSync(dataDir)!==dataDir)throw new Error('The evaluation data directory changed');
  if(fs.lstatSync(dataDir).isSymbolicLink())throw new Error('Evaluation data directory cannot be a symbolic link');
  const workspace=fs.realpathSync(manifest.workspace),slug=path.basename(workspace);
  if(!/^stf[a-f0-9]{18}$/.test(slug)||!contains(fs.realpathSync(workspaceRoot),workspace)||workspace!==manifest.workspace||fs.lstatSync(workspace).isSymbolicLink())throw new Error('The isolated project workspace changed');
  if(manifest.guestWorkspace!=='/work'||manifest.guestSessionPath!==`/srv/manta/agent-eval/sessions/${slug}`)throw new Error('The guest workspace binding changed');
  if(!sameItems(manifest.initialWorkspaceEntries,[])||!sameItems(manifest.disabledAgentTools,disabledAgentTools))throw new Error('The original isolation boundary is incomplete');
  if(!isLegacySourceHosts(manifest.proxyMappedPublicHosts)&&!sameItems(manifest.proxyMappedPublicHosts,expandedSourceHosts))throw new Error('The source-fetch allowlist changed');
  if(!manifest.referenceImportDisabled||!manifest.externalMcpDisabled||!manifest.computerDisabled||!manifest.nos3Disabled||manifest.professionalRunnerMode!=='generic-only'||manifest.nativeRuntime!=='codex-app-server in Linux Bubblewrap'||manifest.nativeReadIsolation!=='guest default-deny mount namespace; one project bind')throw new Error('The original isolation services changed');
  if(!fs.statSync(path.join(dataDir,'state.json')).isFile())throw new Error('The original evaluation state is missing');
  return {evalRoot,dataDir,workspace,workspaceRoot,vmRoot:canonicalVm,sourceRoot:canonicalRoot,port:manifest.port};
}

export function createSourceBoundaryAmendment(manifestPath,{rationale,root=sourceRoot,vm=vmRoot}={}){
  if(!manifestPath||!path.isAbsolute(manifestPath)||path.basename(manifestPath)!=='boundary.json')throw new Error('Pass the absolute original boundary.json path');
  if(typeof rationale!=='string'||rationale.trim().length<10||rationale.length>500)throw new Error('A concise source-access rationale is required');
  if(fs.lstatSync(manifestPath).isSymbolicLink())throw new Error('Original boundary.json cannot be a symbolic link');
  const originalBytes=fs.readFileSync(manifestPath),original=JSON.parse(originalBytes.toString('utf8'));
  validateResumeBoundary(original,manifestPath,{root,vm});
  if(!isLegacySourceHosts(original.proxyMappedPublicHosts))throw new Error('Only the pinned legacy source boundary can be amended');
  const amended={...original,proxyMappedPublicHosts:expandedSourceHosts,sourceAmendment:{revision:2,previousBoundarySha256:createHash('sha256').update(originalBytes).digest('hex'),addedHosts:['api.github.com'],addedAgentTools:['fetch_public_asset'],maxBytes:PUBLIC_ASSET_MAX_BYTES,policy:sourceAssetPolicy,recordedAt:new Date().toISOString(),rationale:rationale.trim()}};
  const destination=path.join(path.dirname(manifestPath),sourceAmendmentName),temporary=path.join(path.dirname(manifestPath),`.source-boundary-${randomUUID()}`);
  const expectedBytes=Buffer.from(JSON.stringify(amended,null,2)+'\n');
  try{
    fs.writeFileSync(temporary,expectedBytes,{flag:'wx',mode:0o600});
    const tempFd=fs.openSync(temporary,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try{fs.fsyncSync(tempFd);}finally{fs.closeSync(tempFd);}
    try{fs.linkSync(temporary,destination);}
    catch(error){
      if(!unsupportedLinkCodes.has(error.code))throw error;
      // NAS may not support hardlinks. O_EXCL preserves an existing v2. A
      // failed partial write remains visible but cannot pass v2 validation;
      // never unlink it through a racy pathname check.
      const fd=fs.openSync(destination,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
      try{
        try{fs.writeFileSync(fd,expectedBytes);fs.fsyncSync(fd);}
        catch(writeError){throw new Error(`Source boundary write failed at ${destination}; a partial v2 file may remain and must be inspected before retry`,{cause:writeError});}
      }finally{fs.closeSync(fd);}
    }
    if(!fs.readFileSync(destination).equals(expectedBytes))throw new Error('Source boundary amendment bytes changed during creation');
    validateResumeBoundary(amended,destination,{root,vm});
  }finally{try{fs.unlinkSync(temporary);}catch{}}
  return {path:destination,previousBoundarySha256:amended.sourceAmendment.previousBoundarySha256,addedHosts:[...amended.sourceAmendment.addedHosts]};
}

export function createProfessionalBoundaryAmendment(manifestPath,{rationale,root=sourceRoot,vm=vmRoot}={}){
  if(!manifestPath||!path.isAbsolute(manifestPath)||path.basename(manifestPath)!==sourceAmendmentName)throw new Error('Pass the absolute boundary.v2.json path');
  if(typeof rationale!=='string'||rationale.trim().length<10||rationale.length>500)throw new Error('A concise isolated professional-tool rationale is required');
  if(fs.lstatSync(manifestPath).isSymbolicLink())throw new Error('Source boundary amendment cannot be a symbolic link');
  const previousBytes=fs.readFileSync(manifestPath),previous=JSON.parse(previousBytes.toString('utf8'));
  validateResumeBoundary(previous,manifestPath,{root,vm});
  const amended={...previous,professionalAmendment:{revision:3,previousBoundarySha256:createHash('sha256').update(previousBytes).digest('hex'),addedServices:['geospatial','orbit42'],addedAgentTools:[...professionalAgentTools],policy:professionalToolPolicy,recordedAt:new Date().toISOString(),rationale:rationale.trim()}};
  const destination=path.join(path.dirname(manifestPath),professionalAmendmentName),temporary=path.join(path.dirname(manifestPath),`.professional-boundary-${randomUUID()}`);
  const expectedBytes=Buffer.from(JSON.stringify(amended,null,2)+'\n');
  try{
    fs.writeFileSync(temporary,expectedBytes,{flag:'wx',mode:0o600});
    const tempFd=fs.openSync(temporary,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try{fs.fsyncSync(tempFd);}finally{fs.closeSync(tempFd);}
    try{fs.linkSync(temporary,destination);}
    catch(error){
      if(!unsupportedLinkCodes.has(error.code))throw error;
      const fd=fs.openSync(destination,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
      try{
        try{fs.writeFileSync(fd,expectedBytes);fs.fsyncSync(fd);}
        catch(writeError){throw new Error(`Professional boundary write failed at ${destination}; a partial v3 file may remain and must be inspected before retry`,{cause:writeError});}
      }finally{fs.closeSync(fd);}
    }
    if(!fs.readFileSync(destination).equals(expectedBytes))throw new Error('Professional boundary amendment bytes changed during creation');
    validateResumeBoundary(amended,destination,{root,vm});
  }finally{try{fs.unlinkSync(temporary);}catch{}}
  return {path:destination,previousBoundarySha256:amended.professionalAmendment.previousBoundarySha256,addedServices:[...amended.professionalAmendment.addedServices],addedAgentTools:[...amended.professionalAmendment.addedAgentTools]};
}

export function createClaudeBoundaryAmendment(manifestPath,{rationale,root=sourceRoot,vm=vmRoot}={}){
  if(!manifestPath||!path.isAbsolute(manifestPath)||path.basename(manifestPath)!==professionalAmendmentName)throw new Error('Pass the absolute boundary.v3.json path');
  if(typeof rationale!=='string'||rationale.trim().length<10||rationale.length>500)throw new Error('A concise Claude guest-isolation rationale is required');
  if(fs.lstatSync(manifestPath).isSymbolicLink())throw new Error('Professional boundary amendment cannot be a symbolic link');
  const previousBytes=fs.readFileSync(manifestPath),previous=JSON.parse(previousBytes.toString('utf8'));
  validateResumeBoundary(previous,manifestPath,{root,vm});
  const amended={...previous,claudeAmendment:{revision:4,previousBoundarySha256:createHash('sha256').update(previousBytes).digest('hex'),addedAgentRuntime:'claude-agent-sdk-guest',policy:claudeRuntimePolicy,recordedAt:new Date().toISOString(),rationale:rationale.trim()}};
  const destination=path.join(path.dirname(manifestPath),claudeAmendmentName),temporary=path.join(path.dirname(manifestPath),`.claude-boundary-${randomUUID()}`);
  const expectedBytes=Buffer.from(JSON.stringify(amended,null,2)+'\n');
  try{
    fs.writeFileSync(temporary,expectedBytes,{flag:'wx',mode:0o600});
    const tempFd=fs.openSync(temporary,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try{fs.fsyncSync(tempFd);}finally{fs.closeSync(tempFd);}
    try{fs.linkSync(temporary,destination);}
    catch(error){
      if(!unsupportedLinkCodes.has(error.code))throw error;
      const fd=fs.openSync(destination,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
      try{
        try{fs.writeFileSync(fd,expectedBytes);fs.fsyncSync(fd);}
        catch(writeError){throw new Error(`Claude boundary write failed at ${destination}; a partial v4 file may remain and must be inspected before retry`,{cause:writeError});}
      }finally{fs.closeSync(fd);}
    }
    if(!fs.readFileSync(destination).equals(expectedBytes))throw new Error('Claude boundary amendment bytes changed during creation');
    validateResumeBoundary(amended,destination,{root,vm});
  }finally{try{fs.unlinkSync(temporary);}catch{}}
  return {path:destination,previousBoundarySha256:amended.claudeAmendment.previousBoundarySha256,addedAgentRuntime:amended.claudeAmendment.addedAgentRuntime};
}

export function createOrbitGroundBoundaryAmendment(manifestPath,{rationale,root=sourceRoot,vm=vmRoot}={}){
  if(!manifestPath||!path.isAbsolute(manifestPath)||path.basename(manifestPath)!==claudeAmendmentName)throw new Error('Pass the absolute boundary.v4.json path');
  if(typeof rationale!=='string'||rationale.trim().length<10||rationale.length>500)throw new Error('A concise isolated orbit-ground tool rationale is required');
  if(fs.lstatSync(manifestPath).isSymbolicLink())throw new Error('Claude boundary amendment cannot be a symbolic link');
  const previousBytes=fs.readFileSync(manifestPath),previous=JSON.parse(previousBytes.toString('utf8'));
  validateResumeBoundary(previous,manifestPath,{root,vm});
  const amended={...previous,orbitGroundAmendment:{revision:5,previousBoundarySha256:createHash('sha256').update(previousBytes).digest('hex'),addedServices:['orbitGround'],addedAgentTools:[...orbitGroundAgentTools],allowedCensusHashes:[stfCensusStateZipSha256],maxNativeTurns:orbitGroundMaxNativeTurns,policy:orbitGroundToolPolicy,recordedAt:new Date().toISOString(),rationale:rationale.trim()}};
  const destination=path.join(path.dirname(manifestPath),orbitGroundAmendmentName),temporary=path.join(path.dirname(manifestPath),`.orbit-ground-boundary-${randomUUID()}`);
  const expectedBytes=Buffer.from(JSON.stringify(amended,null,2)+'\n');
  try{
    fs.writeFileSync(temporary,expectedBytes,{flag:'wx',mode:0o600});
    const tempFd=fs.openSync(temporary,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try{fs.fsyncSync(tempFd);}finally{fs.closeSync(tempFd);}
    try{fs.linkSync(temporary,destination);}
    catch(error){
      if(!unsupportedLinkCodes.has(error.code))throw error;
      const fd=fs.openSync(destination,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
      try{
        try{fs.writeFileSync(fd,expectedBytes);fs.fsyncSync(fd);}
        catch(writeError){throw new Error(`Orbit-ground boundary write failed at ${destination}; a partial v5 file may remain and must be inspected before retry`,{cause:writeError});}
      }finally{fs.closeSync(fd);}
    }
    if(!fs.readFileSync(destination).equals(expectedBytes))throw new Error('Orbit-ground boundary amendment bytes changed during creation');
    validateResumeBoundary(amended,destination,{root,vm});
  }finally{try{fs.unlinkSync(temporary);}catch{}}
  return {path:destination,previousBoundarySha256:amended.orbitGroundAmendment.previousBoundarySha256,addedServices:[...amended.orbitGroundAmendment.addedServices],addedAgentTools:[...amended.orbitGroundAmendment.addedAgentTools],allowedCensusHashes:[...amended.orbitGroundAmendment.allowedCensusHashes],maxNativeTurns:amended.orbitGroundAmendment.maxNativeTurns};
}

export function validateResumeState(state,manifest) {
  if(!state||!Array.isArray(state.projects)||state.projects.length!==1)throw new Error('Expected exactly one existing isolated project');
  const project=state.projects[0];
  if(project.id!==manifest.projectId||project.coordinatorThreadId!==manifest.coordinatorThreadId||project.folderPath!==manifest.workspace)throw new Error('The stored project no longer matches the boundary');
  if(!Array.isArray(state.threads)||!state.threads.some(t=>t.id===manifest.coordinatorThreadId&&t.projectId===project.id&&t.kind==='coordinator')||state.threads.some(t=>t.projectId!==project.id))throw new Error('The stored Coordinator or thread boundary changed');
  if(!Array.isArray(state.runs)||state.runs.some(r=>['queued','running','waiting_approval'].includes(r.status)))throw new Error('Wait for every STF run to finish before stopping and resuming the instance');
  if(!Array.isArray(state.providers))throw new Error('The isolated provider list is missing');
  if(new Set(state.providers.map(p=>p.id)).size!==state.providers.length)throw new Error('The isolated provider list contains duplicate IDs');
  const codex=state.providers.find(p=>p.id==='codex-local');
  if(manifest.claudeAmendment){
    const claude=state.providers.find(p=>p.id==='claude-local');
    if(state.providers.some(p=>!['demo','codex-local','claude-local'].includes(p.id)))throw new Error('The isolated Claude project has an unreviewed provider profile');
    if(state.providers.some(p=>p.id==='codex-local'&&p.type!=='codex-app-server'||p.id==='claude-local'&&p.type!=='claude-agent'||p.id==='demo'&&p.type!=='demo'))throw new Error('The isolated provider runtime type changed');
    if(claude?.type!=='claude-agent'||claude.keyEnv)throw new Error('The isolated native Claude connection must be explicit and must not inherit a host key environment variable');
    if(codex&&(codex.type!=='codex-app-server'||codex.keyEnv))throw new Error('The optional isolated Codex connection must not inherit a host key environment variable');
  }else if(codex?.type!=='codex-app-server'||codex.keyEnv)throw new Error('The isolated native Codex connection must not inherit a host key environment variable');
}

export function planClaudeProviderSwitch(state,manifest){
  validateResumeState(state,manifest);
  if(!manifest.claudeAmendment)throw new Error('Claude provider switch requires the explicit guest boundary amendment');
  const project=state.projects[0],threads=state.threads.filter(t=>t.projectId===project.id);
  const changed=project.coordinatorProviderId!=='claude-local'||project.lastProviderId!=='claude-local'||threads.some(t=>t.lastProviderId!=='claude-local'||t.providerId!=='claude-local');
  if(!changed)return {changed:false,state};
  if((state.messages||[]).some(m=>m.type==='thread.result'&&['pending','processing'].includes(m.metadata?.summaryStatus)))throw new Error('Review pending thread results before switching the Coordinator provider');
  const next=structuredClone(state),p=next.projects[0];p.coordinatorProviderId='claude-local';p.lastProviderId='claude-local';
  for(const thread of next.threads.filter(t=>t.projectId===p.id)){thread.lastProviderId='claude-local';thread.providerId='claude-local';}
  return {changed:true,state:next};
}

function commitClaudeProviderSwitch(statePath,plan){
  if(!plan.changed)return;
  const backup=path.join(path.dirname(statePath),'state.before-v4-claude-switch.json');
  fs.copyFileSync(statePath,backup,fs.constants.COPYFILE_EXCL);
  const temporary=`${statePath}.claude-switch-${randomUUID()}`;
  try{fs.writeFileSync(temporary,JSON.stringify(plan.state,null,2),{mode:0o600,flag:'wx'});fs.renameSync(temporary,statePath);}
  finally{try{fs.unlinkSync(temporary);}catch{}}
}

function probeClaudeGuest(boundary){
  const transport=path.join(boundary.vmRoot,'host/claude-remote.py'),stat=fs.lstatSync(transport);
  if(stat.isSymbolicLink()||!stat.isFile()||fs.realpathSync(transport)!==transport)throw new Error('The pinned Claude guest transport is unavailable');
  fs.accessSync(transport,fs.constants.X_OK);
  const options={cwd:boundary.workspace,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'C.UTF-8',HOME:os.homedir(),MANTA_REMOTE_PROJECT_SLUG:path.basename(boundary.workspace)},encoding:'utf8',timeout:120000,maxBuffer:1024*1024};
  const staged=spawnSync(transport,['--stage'],options);
  if(staged.error||staged.status!==0)throw new Error('The isolated Claude guest launcher could not be staged; project provider was not switched');
  const result=spawnSync(transport,['--probe'],options);
  if(result.error||result.status!==0)throw new Error('The isolated Claude guest readiness probe failed; project provider was not switched');
  let observation;try{observation=JSON.parse(result.stdout);}catch{throw new Error('The isolated Claude guest probe did not return a valid readiness receipt');}
  const hidden=observation.isolation?.hiddenPathsVisible;
  if(observation.ready!==true||observation.runtime!=='claude-agent-sdk'||observation.cliSha256!==pinnedClaudeCliSha256||observation.isolation?.cwd!=='/work'||observation.isolation?.projectVisible!==true||observation.isolation?.helperWorks!==true||observation.isolation?.privateSecretMode!=='0o600'||!hidden||Object.keys(hidden).length<5||Object.values(hidden).some(value=>value!==false))throw new Error('The isolated Claude guest probe returned an invalid boundary receipt');
  return observation;
}

async function assertPortVacant(port){
  const probe=net.createServer();
  try{await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(port,'127.0.0.1',resolve);});}
  catch(error){if(error.code==='EADDRINUSE')throw new Error(`Port ${port} is already in use; stop the old isolated instance only after its runs finish`);throw error;}
  finally{if(probe.listening)await new Promise(resolve=>probe.close(resolve));}
}

export async function resumeBoundary(manifestPath) {
  if(!manifestPath||!path.isAbsolute(manifestPath))throw new Error('Pass the absolute path to the original boundary.json');
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  const boundary=validateResumeBoundary(manifest,manifestPath);
  await assertPortVacant(boundary.port);
  // Keys entered in Manta exist only in the old process. This launcher does
  // not load a host Codex login, accept a key, or update a provider profile.
  const statePath=path.join(boundary.dataDir,'state.json');
  const state=JSON.parse(fs.readFileSync(statePath,'utf8'));
  validateResumeState(state,manifest);
  const lockPath=path.join(boundary.evalRoot,'.resume.lock');
  const lock=fs.openSync(lockPath,'wx',0o600);
  fs.writeSync(lock,`${process.pid}\n`);
  let app,closed=false;
  const release=()=>{try{fs.closeSync(lock);}catch{}try{fs.unlinkSync(lockPath);}catch{}};
  try{
    await assertPortVacant(boundary.port);
    await stageManagedWorkerBundle(boundary.vmRoot);
    const {claudeGuestEnabled,professionalAmended,orbitGroundEnabled,maxTurns}=resumeCapabilitiesForBoundary(manifestPath);
    if(claudeGuestEnabled){probeClaudeGuest(boundary);commitClaudeProviderSwitch(statePath,planClaudeProviderSwitch(state,manifest));}
    const sourceHosts=manifest.proxyMappedPublicHosts||proxyMappedPublicHosts;
    const webFetcher=(url,options)=>publicFetch(url,{...options,allowedHosts:sourceHosts,proxyMappedHosts:sourceHosts});
    const assetFetcher=(url,options)=>publicFetch(url,{...options,allowedHosts:sourceHosts,proxyMappedHosts:sourceHosts,requireHttps:true});
    app=await createStudioServer({root:boundary.sourceRoot,dataDir:boundary.dataDir,vmRoot:boundary.vmRoot,codexPath:path.join(boundary.vmRoot,'host/codex-remote.py'),seed:false,addDefaultCodexProvider:!claudeGuestEnabled,stfCase:false,computer:false,connectors:false,localVm:false,nos3:false,professionalMode:'generic-only',geospatial:professionalAmended,orbit42:professionalAmended,orbitGround:orbitGroundEnabled,...(orbitGroundEnabled?{orbitGroundAllowedCensusHashes:manifest.orbitGroundAmendment.allowedCensusHashes}:{}),evaluator:false,webFetcher,assetFetcher,engineOptions:{codexRemoteWorkspace:{hostRoot:boundary.workspaceRoot},requireClaudeRemoteWorkspace:true,...(claudeGuestEnabled?{claudeRemoteWorkspace:{hostRoot:boundary.workspaceRoot,transportPath:path.join(boundary.vmRoot,'host/claude-remote.py')}}:{}),...(maxTurns?{maxTurns}:{}),disabledTools:[...disabledAgentTools]}});
    if(app.store.data.projects.length!==1||app.store.get('projects',manifest.projectId)?.folderPath!==boundary.workspace||app.store.get('projects',manifest.projectId)?.coordinatorThreadId!==manifest.coordinatorThreadId)throw new Error('Loaded project does not match the evaluation boundary');
    const address=await app.listen({port:boundary.port});
    const close=async()=>{if(closed)return;closed=true;try{await app.close();}finally{release();}};
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await close();process.exit(0);});
    return {app,close,url:`http://127.0.0.1:${address.port}/?project=${manifest.projectId}`};
  }catch(error){try{await app?.close();}finally{release();}throw error;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv[2]==='--amend-source-hosts')process.stdout.write(JSON.stringify(createSourceBoundaryAmendment(process.argv[3],{rationale:process.argv.slice(4).join(' ')}))+'\n');
  else if(process.argv[2]==='--amend-professional-tools')process.stdout.write(JSON.stringify(createProfessionalBoundaryAmendment(process.argv[3],{rationale:process.argv.slice(4).join(' ')}))+'\n');
  else if(process.argv[2]==='--amend-claude-guest')process.stdout.write(JSON.stringify(createClaudeBoundaryAmendment(process.argv[3],{rationale:process.argv.slice(4).join(' ')}))+'\n');
  else if(process.argv[2]==='--amend-orbit-ground')process.stdout.write(JSON.stringify(createOrbitGroundBoundaryAmendment(process.argv[3],{rationale:process.argv.slice(4).join(' ')}))+'\n');
  else{
    const {url}=await resumeBoundary(process.argv[2]);
    process.stdout.write(JSON.stringify({url,providerAction:resumeCapabilitiesForBoundary(process.argv[2]).claudeGuestEnabled?'Reconfigure and test the isolated Claude Code connection in Manta; the previous API key was process-local and was not restored.':'Reconfigure the isolated Codex connection in Manta; the previous API key was process-local and was not restored.'})+'\n');
  }
}
