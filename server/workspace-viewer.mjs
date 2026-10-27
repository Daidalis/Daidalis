import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {id,now} from './store.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import {safePath} from './sandbox.mjs';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), {status});
const MAX_EDIT = 500000;
const MAX_TEXT = 1500000, MAX_IMAGE = 5000000, MAX_ENTRIES = 500;
const SKIP_SCAN = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'build', 'dist', 'target', '.cache', '.local']);
const MIME = {'.md':'text/markdown', '.markdown':'text/markdown', '.sysml':'text/plain', '.kerml':'text/plain', '.json':'application/json', '.geojson':'application/geo+json', '.jsonl':'application/x-ndjson', '.ndjson':'application/x-ndjson', '.csv':'text/csv', '.tsv':'text/tab-separated-values', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/gif', '.webp':'image/webp'};
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const TEXT = new Set(['.mo','.cir','.scad','.reqif','.md','.markdown','.sysml','.kerml','.json','.geojson','.jsonl','.ndjson','.csv','.tsv','.txt','.log','.patch','.diff','.c','.h','.cpp','.hpp','.py','.js','.mjs','.ts','.tsx','.jsx','.xml','.yaml','.yml','.toml','.ini','.cfg','.cmake','.sh','.bash','.zsh','.rst','.html','.htm','.svg']);
function safeRelative(value = '.') {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0') || value.includes('\\') || path.isAbsolute(value)) throw fail('Use a project-relative file path');
  const segments = value.split('/');
  if (segments.includes('..')) throw fail('Path escapes the project workspace');
  for (const segment of segments.filter(x => x && x !== '.')) {
    const lower = segment.toLowerCase();
    if ((lower.startsWith('.') && segment !== '.manta') || /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/.test(lower) || /\.(?:pem|key|p12|pfx|jks|keystore)$/.test(lower) || /^(?:credentials?|secrets?|tokens?|auth|keychain|keys)(?:[._-]|$)/.test(lower) || /^(?:api[._-]?keys?|access[._-]?tokens?)(?:[._-]|$)/.test(lower)) throw fail('Credential and internal configuration files are not available in the viewer', 403);
  }
  const normalized = path.posix.normalize(value);
  if (segments.includes('.manta') && !normalized.startsWith('.manta/model-evidence/')) throw fail('Internal configuration is not available in the viewer', 403);
  return normalized;
}
function kind(name) {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE.has(ext)) return 'image';
  if (['.md','.markdown'].includes(ext)) return 'markdown';
  if (['.sysml','.kerml'].includes(ext)) return 'sysml';
  if (['.json','.geojson','.jsonl','.ndjson'].includes(ext)) return 'json';
  if (['.csv','.tsv'].includes(ext)) return 'csv';
  return TEXT.has(ext) || /^(readme|license|makefile|dockerfile)$/i.test(name) ? 'text' : 'binary';
}
function imageMatches(buffer, ext) {
  if (ext === '.png') return buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (ext === '.jpg' || ext === '.jpeg') return buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if (ext === '.gif') return /^GIF8[79]a$/.test(buffer.subarray(0,6).toString());
  return ext === '.webp' && buffer.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WEBP';
}
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
async function directoryEntries(target, maximum) {
  const entries=[]; let truncated=false;
  for await (const entry of await fs.opendir(target)) {
    if (entries.length>=maximum) {truncated=true;break;}
    entries.push(entry);
  }
  return {entries,truncated};
}

// Contextual file presentation and explicit human text edits; no solver execution.
export function workspaceEditPolicy(file={}) {
  const relative=String(file.path||'');
  if(/^engineering\/(?:nos3|professional|geospatial|orbit|orbit-ground)(?:\/|$)/i.test(relative)||/^engineering\/eng_[a-f0-9]{32}(?:\/|$)/i.test(relative)||relative.startsWith('.manta/'))return {editable:false,readOnlyReason:'已记录的工程作业输入与证据只读'};
  if(/(?:\.(?:mo|sysml|kerml|cir|scad)|\.stf\.json)$/i.test(relative))return {editable:false,readOnlyReason:'请使用原生模型编辑与求解入口'};
  if(!['markdown','text','json','csv'].includes(file.type)||file.encoding!=='utf8'||!file.previewable)return {editable:false,readOnlyReason:'此文件不支持文本编辑'};
  if(file.size>MAX_EDIT)return {editable:false,readOnlyReason:'文本编辑上限为 500 KB'};
  return {editable:true,editLimitBytes:MAX_EDIT};
}

/** Safe file boundary. Editing requires an explicit human save and exact source hash. */
export function createWorkspaceViewer({store, modelBackend, nos3, professionalModels,geospatialJobs,orbit42Jobs,orbitGroundJobs,emit} = {}) {
  if (!store?.workspace) throw Error('Project store required');
  const modelCache = new Map(),saveQueues=new Map();
  store.data.documentEdits||=[];
  const exclusive=(key,operation)=>{const task=(saveQueues.get(key)||Promise.resolve()).catch(()=>{}).then(operation);saveQueues.set(key,task);return task.finally(()=>{if(saveQueues.get(key)===task)saveQueues.delete(key);});};
  async function readJournal(ws,relative){const target=safePath(ws,relative),handle=await fs.open(target,constants.O_RDONLY|(constants.O_NOFOLLOW||0));try{const stat=await handle.stat();if(!stat.isFile()||stat.size>20000)throw fail('修改日志不可读',409);const bytes=await handle.readFile();safePath(ws,relative);return JSON.parse(bytes.toString('utf8'));}finally{await handle.close();}}
  function validJournal(edit,projectId,relative){return edit?.projectId===projectId&&/^edit_[a-f0-9-]{36}$/i.test(edit.id)&&validHash(edit.sha256)&&validHash(edit.previousSha256)&&edit.historyPath==='.manta/document-history/'+edit.id+'.txt'&&(!relative||edit.path===relative);}
  const journalPointer=(projectId,relative)=>'.manta/document-history/path-'+sha(Buffer.from(projectId+':'+relative))+'.json';
  async function writeJournal(ws,relative,value){const target=safePath(ws,relative,{write:true}),temporary=target+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temporary,JSON.stringify(value),{mode:0o600,flag:'wx'});try{safePath(ws,relative,{write:true});await fs.rename(temporary,target);}finally{await fs.rm(temporary,{force:true});}}
  async function revisionFor(projectId,relative,hash){
    let edit=store.data.documentEdits.findLast(e=>e.projectId===projectId&&e.path===relative),persistence=edit?.indexStatus==='pending'?'journal':'state';
    try{const journal=await readJournal(workspace(projectId),journalPointer(projectId,relative));if(validJournal(journal,projectId,relative)&&(journal.status==='committed'||journal.sha256===hash)&&(!edit||journal.createdAt>edit.createdAt)){edit=journal;persistence='journal';}}catch{/* A missing journal never changes an ordinary file preview. */}
    return edit?{id:edit.id,actor:edit.actor,at:edit.createdAt,sha256:edit.sha256,previousSha256:edit.previousSha256,current:edit.sha256===hash,persistence,status:edit.status||'committed',reviewApplicability:'not-revalidated'}:null;
  }
  function recordedMetadata(projectId,relative){const artifact=(store.data?.artifacts||[]).find(a=>a.projectId===projectId&&a.path===relative);return artifact?{artifactId:artifact.id,name:artifact.name,runId:artifact.runId||null,recordedAt:artifact.createdAt||null,recordedSha256:artifact.sha256||null,receiptUnchanged:true}:null;}
  async function nativeJobEvidence(projectId,relative,currentHash){
    const match=/^engineering\/(geospatial|orbit|orbit-ground)\/((?:geospatial|orbit42|orbitground)_[a-f0-9]{32})\//.exec(relative);
    if(!match)return null;
    const [family,jobId]=match.slice(1),expectedPrefix=family==='geospatial'?'geospatial_':family==='orbit'?'orbit42_':'orbitground_';
    if(!jobId.startsWith(expectedPrefix))throw fail('作业目录与 ID 不匹配',409);
    const service=family==='geospatial'?geospatialJobs:family==='orbit'?orbit42Jobs:orbitGroundJobs;
    if(!service?.result)throw fail('专业作业结果服务尚未连接',503);
    const receipt=await service.result({projectId,jobId});
    if(receipt?.integrity?.verified!==true)throw fail('记录的专业作业证据完整性检查未通过',409);
    const artifact=(receipt.artifacts||[]).find(item=>item?.path===relative&&validHash(item.sha256));
    if(!artifact)throw fail('该文件不是已登记的专业作业证据',403);
    if(currentHash&&artifact.sha256!==currentHash)throw fail('专业作业文件与记录哈希不一致',409);
    return artifact;
  }
  function workspace(projectId) {
    if (typeof projectId !== 'string' || !/^project_[a-f0-9-]+$/i.test(projectId)) throw fail('Invalid project identifier');
    if (store.get && !store.get('projects', projectId)) throw fail('Project not found',404);
    return store.workspace(projectId);
  }
  async function bytesFor(projectId, relative, maximum = MAX_TEXT) {
    const ws = workspace(projectId), safe = safeRelative(relative), target = safePath(ws, safe);
    // O_NOFOLLOW also closes the final-component swap window after safePath.
    let handle;
    try {handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));}
    catch(error) {if(error.code==='ENOENT')throw fail('Project file not found',404);if(error.code==='EACCES'||error.code==='EPERM')throw fail('Project file is not readable',403);throw error;}
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw fail('Select a regular file');
      if (stat.size > maximum) throw fail(`File exceeds preview limit (${maximum} bytes)`,413);
      const buffer = await handle.readFile();
      if (buffer.length > maximum) throw fail('File grew beyond preview limit',413);
      // Recheck path components after the read; all symlinks are forbidden.
      safePath(ws, safe);
      const current = await fs.lstat(target), after = await handle.stat();
      if (current.dev!==stat.dev || current.ino!==stat.ino || current.isSymbolicLink() || after.size!==stat.size || after.mtimeMs!==stat.mtimeMs || after.ctimeMs!==stat.ctimeMs) throw fail('File changed while opening the preview; reopen the current revision',409);
      return {path:safe, name:path.basename(safe), buffer, size:buffer.length, modifiedAt:stat.mtime.toISOString(), sha256:sha(buffer)};
    } finally { await handle.close(); }
  }
  async function metadata(projectId, relative, dirent) {
    const safe = safeRelative(relative), target = safePath(workspace(projectId), safe);
    if (dirent?.isSymbolicLink()) return null;
    const st = await fs.lstat(target);
    if (!st.isDirectory() && !st.isFile()) return null;
    return {name:path.basename(safe), path:safe, kind:st.isDirectory()?'directory':'file', type:st.isDirectory()?'directory':kind(path.basename(safe)), size:st.isFile()?st.size:null, modifiedAt:st.mtime.toISOString()};
  }
  async function discover(projectId) {
    const found = {models:[], reports:[], simulations:[]};
    const seen = new Set();
    let scanned = 0, directories = 0;
    // Only conventional presentation directories, not a recursive repository crawl.
    for (const base of ['.', 'models', 'artifacts', 'reports', 'docs']) {
      const queue = [{relative:base, depth:0}];
      while (queue.length && directories < 40 && scanned < 2200) {
        const {relative, depth} = queue.shift();
        if (seen.has(relative)) continue;
        seen.add(relative); directories++;
        let entries;
        try { entries = (await directoryEntries(safePath(workspace(projectId), relative),2200-scanned)).entries; } catch { continue; }
        for (const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
          if (++scanned > 2200) break;
          if (entry.isSymbolicLink() || entry.name.startsWith('.') || SKIP_SCAN.has(entry.name)) continue;
          const rel = relative === '.' ? entry.name : relative + '/' + entry.name;
          if (entry.isDirectory()) {
            if (base !== '.' && depth < 2) queue.push({relative:rel, depth:depth+1});
            continue;
          }
          if (!['sysml','markdown'].includes(kind(entry.name))) continue;
          try {
            const item = await metadata(projectId, rel, entry);
            const collection = item.type === 'sysml' ? found.models : found.reports;
            if (!collection.some(x=>x.path===rel) && collection.length < 100) collection.push(item);
          } catch { /* Inaccessible or sensitive paths are absent from discovery. */ }
        }
      }
    }
    // Reuse the bounded native-model index so models under an imported
    // engineering namespace are discoverable without crawling every repository.
    if (professionalModels?.listModels) {
      const native = await professionalModels.listModels({projectId});
      for (const model of (native.models || []).slice(0,500)) {
        if (kind(model.path) !== 'sysml' || found.models.some(item => item.path === model.path) || found.models.length >= 100) continue;
        try { const item = await metadata(projectId, model.path); if (item?.kind === 'file') found.models.push(item); } catch { /* The viewer's path boundary still applies to the native index. */ }
      }
      if (native.truncated) found.nativeIndexLimited = true;
    }
    if (nos3?.list) found.simulations = (await nos3.list({projectId})).slice(0,100);
    found.limited = scanned >= 2200 || directories >= 40;
    return found;
  }
  const service = {
    async list({projectId, path:relative='.'} = {}) {
      const ws = workspace(projectId), safe = safeRelative(relative), target = safePath(ws, safe);
      if (!(await fs.stat(target)).isDirectory()) throw fail('Select a directory');
      const scan = await directoryEntries(target,2500), raw = scan.entries, entries = [];
      let eligible = 0;
      for (const entry of raw.sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||a.name.localeCompare(b.name))) {
        if (entry.isSymbolicLink() || entry.name.startsWith('.') || SKIP_SCAN.has(entry.name)) continue;
        const rel = safe === '.' ? entry.name : safe + '/' + entry.name;
        try {
          safeRelative(rel); eligible++;
          if (entries.length < MAX_ENTRIES) {const item = await metadata(projectId,rel,entry); if (item) entries.push(item);}
        } catch { /* Safe omission keeps names of credentials out of the UI. */ }
      }
      return {projectId, path:safe, entries, discovered:safe==='.'?await discover(projectId):null, truncated:scan.truncated||eligible>MAX_ENTRIES, limits:{entries:MAX_ENTRIES,scannedDirectoryEntries:2500,textBytes:MAX_TEXT,imageBytes:MAX_IMAGE}};
    },
    async resolve({projectId,path:relative} = {}) {
      const safe=safeRelative(relative);
      // Ownership is checked by the job service, even if two projects share a folder.
      // An apparent job-shaped filename is only a candidate, never evidence.
      const file=await metadata(projectId,safe);
      if(!file||file.kind!=='file')throw fail('Select a regular file');
      if(/^engineering\/(?:geospatial|orbit|orbit-ground)\//.test(safe)){await nativeJobEvidence(projectId,safe);return {kind:'file',path:safe};}
      const professional=/^engineering\/professional\/(professional_[a-f0-9]{32})\//.exec(safe);
      if(professional&&professionalModels){const result=await professionalModels.result({projectId,jobId:professional[1]});if(!result.integrity?.verified)throw fail('Recorded professional result integrity check failed',409);if(result.artifacts?.some(item=>item.path===safe))return {kind:'professional',jobId:professional[1],path:safe};}
      const match=/^engineering\/nos3\/(nos3_[a-f0-9]{32})\//.exec(safe);
      if(!match||!['json','csv'].includes(file.type)||!nos3?.status||!nos3?.result)return {kind:'file',path:safe};
      const simulation=await service.simulation({projectId,jobId:match[1]});
      const evidence=simulation.evidence.find(item=>item.path===safe);
      if(!evidence)return {kind:'file',path:safe};
      const checks=[...(simulation.integrity?.checks||[]),...simulation.cases.flatMap(c=>c.integrity?.checks||[])];
      if(!checks.some(c=>c.path===safe&&c.matched===true))throw fail('Recorded evidence integrity check failed',409);
      const selected=simulation.cases.find(c=>c.files?.some(f=>f.path===safe));
      return {kind:'simulation',jobId:match[1],path:safe,...(selected?{caseId:selected.id}:{})};
    },
    async read({projectId, path:relative} = {}) {
      const name=path.basename(String(relative||'')),registered=(store.data?.artifacts||[]).find(a=>a.projectId===projectId&&a.path===relative),declared=String(registered?.type||''),declaredType=/^(?:text\/)?markdown$/i.test(declared)?'markdown':declared==='application/json'||declared==='json'?'json':declared==='text/csv'||declared==='csv'?'csv':null,type=(!path.extname(name)&&declaredType)||kind(name),item=await bytesFor(projectId,relative,type==='image'?MAX_IMAGE:MAX_TEXT);
      await nativeJobEvidence(projectId,item.path,item.sha256);
      const {buffer,...file} = item, ext = path.extname(file.name).toLowerCase();
      if (type === 'image') {
        if (!imageMatches(buffer,ext)) throw fail('Image signature does not match its file type');
        return {projectId,...file,type,mime:MIME[ext],encoding:'base64',content:buffer.toString('base64'),previewable:true};
      }
      if (type === 'binary' || buffer.includes(0)) return {projectId,...file,type:'binary',mime:'application/octet-stream',encoding:null,content:null,previewable:false};
      let content;
      try { content = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer); } catch { throw fail('Text preview requires UTF-8'); }
      // HTML, SVG and scripts are deliberately plain source, never executable content.
      const value={projectId,...file,type,mime:MIME[ext]||(type==='markdown'?'text/markdown':type==='json'?'application/json':type==='csv'?'text/csv':'text/plain'),encoding:'utf8',content,previewable:true};
      return {...value,...workspaceEditPolicy(value),revision:await revisionFor(projectId,file.path,file.sha256),registeredArtifact:recordedMetadata(projectId,file.path)};
    },
    async save({projectId,path:relative,expectedSha256,content}={}) {
      const safe=safeRelative(relative);workspace(projectId);
      if(!validHash(expectedSha256))throw fail('保存需要打开文件时的 SHA256');
      if(typeof content!=='string'||content.includes('\0')||Buffer.byteLength(content,'utf8')>MAX_EDIT)throw fail('内容必须是 500 KB 内的 UTF-8 文本',413);
      return exclusive(workspace(projectId)+':'+safe,async()=>{
        const current=await service.read({projectId,path:safe});
        if(!current.editable)throw fail(current.readOnlyReason||'此文件只读',403);
        if(current.sha256!==expectedSha256)throw fail('文件已有更新；草稿已保留，请先查看当前版本再保存',409);
        const nextBytes=Buffer.from(content,'utf8'),nextHash=sha(nextBytes);
        if(nextHash===current.sha256)return {...current,saved:false,noChanges:true};
        const before=await bytesFor(projectId,safe,MAX_EDIT);
        if(before.sha256!==expectedSha256)throw fail('文件在保存前发生变化；草稿已保留',409);
        const ws=workspace(projectId),editId=id('edit'),historyRelative='.manta/document-history/'+editId+'.txt';
        const history=safePath(ws,historyRelative,{write:true});await fs.mkdir(path.dirname(history),{recursive:true,mode:0o700});safePath(ws,historyRelative,{write:true});await fs.writeFile(history,before.buffer,{mode:0o600,flag:'wx'});
        const edit={id:editId,projectId,path:safe,type:current.type,previousSha256:before.sha256,sha256:nextHash,bytes:nextBytes.length,historyPath:historyRelative,actor:{kind:'user',id:'local-user'},createdAt:now(),reviewApplicability:'not-revalidated',status:'prepared',indexStatus:'pending'};
        const journalRelative='.manta/document-history/'+editId+'.json',pointer=journalPointer(projectId,safe);await writeJournal(ws,journalRelative,edit);await writeJournal(ws,pointer,edit);
        const temporaryRelative=path.posix.join(path.posix.dirname(safe),'.manta-edit-'+crypto.randomUUID()+'.tmp'),temporary=safePath(ws,temporaryRelative,{write:true});
        await fs.writeFile(temporary,nextBytes,{mode:0o600,flag:'wx'});await fs.chmod(temporary,(await fs.stat(safePath(ws,safe))).mode&0o777);
        try{
          const unchanged=await bytesFor(projectId,safe,MAX_EDIT);
          if(unchanged.sha256!==expectedSha256)throw fail('文件在保存时发生变化；没有覆盖新版本，草稿已保留',409);
          safePath(ws,historyRelative);safePath(ws,temporaryRelative);const target=safePath(ws,safe,{write:true});
          await fs.rename(temporary,target);
        }finally{await fs.rm(temporary,{force:true});}
        let persistenceWarning='';edit.status='committed';
        try{await writeJournal(ws,journalRelative,edit);await writeJournal(ws,pointer,edit);}catch{persistenceWarning='文件已保存；修订日志尚未完全写入，修改前快照及预备日志已保留。';}
        store.data.documentEdits.push(edit);
        const artifact=(store.data.artifacts||[]).find(a=>a.projectId===projectId&&a.path===safe);
        if(artifact){artifact.workingFileRevision={editId,sha256:nextHash,previousSha256:before.sha256,updatedAt:edit.createdAt,actor:edit.actor,receiptUnchanged:true,reviewApplicability:'not-revalidated'};artifact.updatedAt=edit.createdAt;}
        try{edit.indexStatus='indexed';store.save();}catch{edit.indexStatus='pending';persistenceWarning='文件已保存；应用记录暂未写入，修订日志和修改前快照已保留，重新打开仍可查看。';}
        const event={projectId,type:'workspace.file.updated',message:'用户保存项目文件',data:{path:safe,editId,actor:edit.actor,previousSha256:before.sha256,sha256:nextHash,bytes:nextBytes.length,artifactId:artifact?.id||null,reviewApplicability:'not-revalidated'}};
        if(edit.indexStatus==='indexed')try{if(emit)emit(event);else store.add('events',{id:id('event'),createdAt:edit.createdAt,...event});}catch{persistenceWarning='文件已保存；活动事件暂未写入，修订日志已保留。';}
        return {...await service.read({projectId,path:safe}),saved:true,editId,previousSha256:before.sha256,...(persistenceWarning?{persistenceWarning}:{})};
      });
    },
    async history({projectId,editId}={}) {
      const ws=workspace(projectId);if(typeof editId!=='string'||!/^edit_[a-f0-9-]{36}$/i.test(editId))throw fail('修改记录无效',404);let edit=store.data.documentEdits.find(e=>e.id===editId&&e.projectId===projectId);
      if(!edit)try{const journal=await readJournal(ws,'.manta/document-history/'+editId+'.json');if(validJournal(journal,projectId))edit=journal;}catch{}
      if(!edit)throw fail('修改记录不属于当前项目',404);
      const expected='.manta/document-history/'+edit.id+'.txt';
      if(edit.historyPath!==expected||!/^edit_[a-f0-9-]{36}$/i.test(edit.id))throw fail('修改记录路径无效',409);
      const target=safePath(ws,expected),handle=await fs.open(target,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
      try{const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX_EDIT)throw fail('历史内容不可读',413);const bytes=await handle.readFile();safePath(ws,expected);if(sha(bytes)!==edit.previousSha256)throw fail('历史内容完整性校验失败',409);return {projectId,editId,path:edit.path,name:path.basename(edit.path)+' · 修改前版本',type:edit.type,encoding:'utf8',previewable:true,editable:false,sha256:edit.previousSha256,content:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),readOnlyReason:'修改前快照只读',actor:edit.actor,createdAt:edit.createdAt};}finally{await handle.close();}
    },
    async model({projectId,path:relative} = {}) {
      const file = await service.read({projectId,path:relative});
      if (file.type !== 'sysml') throw fail('Select a SysML or KerML source file');
      let semantic;
      if (path.extname(file.path).toLowerCase() !== '.sysml') semantic = {available:false,valid:null,findings:[],error:'The connected semantic backend currently accepts .sysml source files'};
      else if (!modelBackend?.query) semantic = {available:false,valid:null,findings:[],error:'SysML semantic backend unavailable'};
      else {
        const key = projectId + ':' + file.path + ':' + file.sha256;
        semantic = modelCache.get(key);
        if (!semantic) {
          try { semantic = {...await modelBackend.query({projectId,path:file.path,expectedHash:file.sha256}), available:true}; }
          catch (error) { semantic = {available:false,valid:null,findings:[],error:String(error.message).slice(0,1000)}; }
          if (semantic.available) {if(modelCache.size>=8)modelCache.delete(modelCache.keys().next().value);modelCache.set(key,semantic);}
        }
      }
      return {projectId,path:file.path,file,source:file.content,sha256:file.sha256,semantic,graph:semantic.data||null};
    },
    async simulation({projectId,jobId} = {}) {
      workspace(projectId);
      if (!nos3?.status || !nos3?.result) throw fail('NOS3 service unavailable',503);
      if (typeof jobId !== 'string' || !/^nos3_[a-f0-9]{32}$/.test(jobId)) throw fail('Invalid NOS3 job identifier');
      // The service enforces protected project ownership, even for shared folders.
      let job = await nos3.status({projectId,jobId});
      const receipt = await nos3.result({projectId,jobId});
      if(receipt.ready&&job.status!==receipt.status)job=await nos3.status({projectId,jobId});
      const response = {projectId,jobId,id:jobId,title:jobId,scope:job.scope,status:job.status,job,result:receipt,checks:receipt.checks||[],unverified:receipt.pendingRequirements||receipt.pending||[],model:receipt.modelEvidence?.[0]?{path:receipt.modelEvidence[0].path,hash:receipt.modelEvidence[0].sha256}:null,source:{revision:job.baseline?.revision,hash:job.baseline?.baselineHash},evidence:[],cases:[],integrity:{verified:false,checks:[]},limitations:['Charts show selected actual telemetry samples. Reception time is not simulation time. No additional simulation is executed by this view.']};
      if (!receipt.ready) return response;
      const relative = `engineering/nos3/${jobId}`;
      if (job.relative && job.relative !== relative) throw fail('Unexpected protected job evidence path',409);
      if (!validHash(receipt.resultSha256) && ['cancelled','interrupted','blocked'].includes(job.status)) {
        response.integrity.error='No completed result receipt was recorded for this stopped job';
        response.limitations.push('This job did not produce a recorded simulation result. No trace is displayed.');
        return response;
      }
      const resultFile = await bytesFor(projectId, relative + '/result.json');
      if (!validHash(receipt.resultSha256) || resultFile.sha256 !== receipt.resultSha256) throw fail('Recorded simulation result integrity check failed',409);
      const result = JSON.parse(resultFile.buffer.toString('utf8'));
      response.result = {...result,jobId,ready:true,resultPath:resultFile.path,resultSha256:resultFile.sha256};
      response.integrity.checks.push({path:resultFile.path,sha256:resultFile.sha256,expectedSha256:receipt.resultSha256,matched:true});
      response.evidence.push({path:resultFile.path,label:'Simulation result',sha256:resultFile.sha256});
      const boundModel=result.modelEvidence?.find(item=>typeof item.path==='string'&&item.path.endsWith('.sysml'));
      if (boundModel) {
        response.model={originalPath:boundModel.path,hash:boundModel.sha256,path:null};
        if(boundModel.snapshot) {
          const snapshotPath=relative+'/'+safeRelative(boundModel.snapshot);
          try {
            const snapshot=await bytesFor(projectId,snapshotPath),matched=validHash(boundModel.sha256)&&snapshot.sha256===boundModel.sha256;
            response.model={...response.model,path:matched?snapshotPath:null,snapshotPath,integrity:{verified:matched}};
            response.integrity.checks.push({path:snapshotPath,sha256:snapshot.sha256,expectedSha256:boundModel.sha256,matched});
            if(matched)response.evidence.push({path:snapshotPath,label:'Bound model snapshot',sha256:snapshot.sha256});
          } catch(error) {response.model.integrity={verified:false,error:String(error.message).slice(0,500)};response.integrity.checks.push({path:snapshotPath,expectedSha256:boundModel.sha256,matched:false});}
        }
      }
      const registered = new Set((receipt.artifacts||[]).map(a=>a.path));
      if (!Array.isArray(result.artifacts)) result.artifacts = [];
      const artifactHashes = new Map();
      for (const file of result.artifacts) if (typeof file?.path === 'string' && validHash(file.sha256)) {
        try { const safe = safeRelative(file.path); if (safe !== file.path) continue; artifactHashes.set('remote/telemetry/'+safe,file.sha256); artifactHashes.set('remote/'+safe,file.sha256); } catch {}
      }
      const sampleFiles = (Array.isArray(result.telemetryFiles)?result.telemetryFiles:[]).filter(rel=>typeof rel==='string'&&/^[a-z0-9_-]+\/telemetry-samples\.jsonl$/i.test(rel)).slice(0,16);
      for (const sample of sampleFiles) {
        const id = sample.split('/')[0], base = 'remote/telemetry/' + id;
        const current = {id,label:id,points:[],checks:[],metrics:{},files:[],integrity:{verified:false,checks:[]},units:{time:'s',quaternion:'1'},selection:'Selected actual raw packet samples; gaps are not interpolated.'};
        response.cases.push(current);
        try {
          const load = async name => {
            const rel = base + '/' + name, full = relative + '/' + rel;
            if (!registered.has(full)) throw fail('Telemetry evidence was not registered for this job',409);
            const file = await bytesFor(projectId,full), expected = artifactHashes.get(rel), matched = expected ? file.sha256 === expected : null;
            const check = {path:full,sha256:file.sha256,...(expected?{expectedSha256:expected}:{}),matched};
            current.integrity.checks.push(check); response.integrity.checks.push(check);
            current.files.push({path:full,label:name,sha256:file.sha256}); response.evidence.push({path:full,label:id+' · '+name,sha256:file.sha256});
            if (matched !== true) throw fail(matched===false?'Telemetry evidence hash changed':'Telemetry evidence lacks a protected hash receipt',409);
            return file.buffer.toString('utf8');
          };
          const summary = JSON.parse(await load('verification-summary.json'));
          current.status = summary.status;
          current.engineering_requirement_satisfied = summary.engineering_requirement_satisfied;
          current.checks = summary.checks||[]; current.metrics = {passed:summary.passed,status:summary.status,sensorBiasDeg:summary.sensor_bias_deg,sensorSign:summary.sensor_sign,packetCounts:summary.udp_telemetry?.packet_counts};
          const layouts = summary.udp_telemetry?.compiler_layout;
          if (!layouts || !['little','big'].includes(layouts.byte_order) || !Array.isArray(layouts.packets) || layouts.packets.length>16) throw fail('No compiler-recorded telemetry layout available');
          const layoutMap = new Map(layouts.packets.map(p=>[p.mid,p]));
          const text = await load('telemetry-samples.jsonl'), rows = text.split('\n').filter(x=>x.trim());
          if (rows.length>2000) throw fail('Telemetry sample count exceeds view limit');
          const counts = new Map();
          for (const row of rows) {
            const raw = JSON.parse(row), mid = typeof raw.mid === 'string' ? Number(raw.mid) : raw.mid, layout = layoutMap.get(mid);
            if (!layout || raw.source !== 'telemetry') continue;
            if (!['di','ad','gnc','startracker'].includes(layout.name)) continue;
            if (typeof raw.packetBase64 !== 'string' || raw.packetBase64.length>30000 || !Number.isFinite(raw.wallTime)) throw fail('Invalid telemetry sample');
            const buffer = Buffer.from(raw.packetBase64,'base64');
            const offset = layout.q_offset, valid = layout.valid_offset;
            if (!Number.isInteger(layout.size) || buffer.length!==layout.size || raw.length!==buffer.length || !Number.isInteger(offset)||offset<0||offset+32>buffer.length||!Number.isInteger(valid)||valid<0||valid>=buffer.length) throw fail('Telemetry packet does not match compiler layout');
            const number = at => layouts.byte_order === 'little' ? buffer.readDoubleLE(at) : buffer.readDoubleBE(at);
            const quaternion = Array.from({length:4},(_,i)=>number(offset+i*8));
            if (!quaternion.every(Number.isFinite) || ![0,1].includes(buffer[valid])) throw fail('Non-finite or invalid telemetry value');
            const sample = counts.get(layout.name)||0; counts.set(layout.name,sample+1);
            const point = {wallTime:raw.wallTime,channel:layout.name,quaternion,valid:buffer[valid]===1,sample};
            if (Number.isInteger(layout.mount_offset)&&layout.mount_offset>=0&&layout.mount_offset+32<=buffer.length) {const mount=Array.from({length:4},(_,i)=>number(layout.mount_offset+i*8));if(mount.every(Number.isFinite))point.mountQuaternion=mount;}
            current.points.push(point);
          }
          const start = Math.min(...current.points.map(p=>p.wallTime));
          current.points.sort((a,b)=>a.wallTime-b.wallTime||a.channel.localeCompare(b.channel));
          for (const point of current.points) point.time = point.wallTime-start;
          current.sampleCount = current.points.length;
          current.integrity.verified = current.integrity.checks.length===2 && current.integrity.checks.every(c=>c.matched===true);
        } catch (error) {current.points=[];current.integrity.error=String(error.message).slice(0,1000);current.integrity.verified=false;}
      }
      response.integrity.verified = response.integrity.checks.every(c=>c.matched===true) && response.cases.every(c=>c.integrity.verified);
      if (!response.cases.length) response.limitations.push('No supported recorded time series was returned for this job. Summary metrics do not constitute a time series.');
      return response;
    }
  };
  return service;
}

export function createWorkspaceViewerRoutes({viewer,send,jsonBody} = {}) {
  return async function route({req,res,parts,project}) {
    if (parts[3] !== 'workspace') return false;
    const url = new URL(req.url,'http://localhost'), projectId = project.id;
    if(req.method==='PUT'&&parts.length===5&&parts[4]==='file'){if(!jsonBody)throw fail('文本保存接口未连接',503);const body=await jsonBody(req);const data=await viewer.save({projectId,path:url.searchParams.get('path'),expectedSha256:body.expectedSha256,content:body.content});send(res,200,data);return true;}
    if(req.method!=='GET')throw fail('Unsupported workspace operation',405);
    let data;
    if(parts.length===5&&parts[4]==='file-history')data=await viewer.history({projectId,editId:url.searchParams.get('editId')});
    else if (parts.length===5 && parts[4]==='files') data = await viewer.list({projectId,path:url.searchParams.get('path')||'.'});
    else if (parts.length===5 && parts[4]==='resolve') data = await viewer.resolve({projectId,path:url.searchParams.get('path')});
    else if (parts.length===5 && parts[4]==='file') data = await viewer.read({projectId,path:url.searchParams.get('path')});
    else if (parts.length===5 && parts[4]==='image') {
      const file=await viewer.read({projectId,path:url.searchParams.get('path')});
      if(file.type!=='image'||file.encoding!=='base64'||!['image/png','image/jpeg','image/gif','image/webp'].includes(file.mime))throw fail('Only verified PNG, JPEG, GIF or WebP images can be displayed inline',415);
      const bytes=Buffer.from(file.content,'base64');
      res.writeHead(200,{'content-type':file.mime,'content-length':bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox",'content-disposition':'inline','referrer-policy':'no-referrer'});
      res.end(bytes);return true;
    }
    else if (parts.length===5 && parts[4]==='model') data = await viewer.model({projectId,path:url.searchParams.get('path')});
    else if (parts.length===6 && parts[4]==='simulations') data = await viewer.simulation({projectId,jobId:parts[5]});
    else throw fail('Workspace preview route not found',404);
    send(res,200,data);
    return true;
  };
}
