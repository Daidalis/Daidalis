import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSnapshotPaths,renderEngineeringState,createEngineeringStateUI} from '../public/engineering-state-ui.mjs';

const emptyState=(projectId,extra={})=>({projectId,revision:1,objects:[],relations:[],snapshots:[],changes:[],evidence:[],issues:[],...extra});
const makeHost=()=>({isConnected:true,innerHTML:'',ownerDocument:{activeElement:null},handlers:{},contains:()=>false,querySelectorAll:()=>[],addEventListener(name,fn){this.handlers[name]=fn;},removeEventListener(name,fn){if(this.handlers[name]===fn)delete this.handlers[name];}});

test('snapshot selection accepts only explicit project-relative paths and removes duplicate lines',()=>{
 assert.deepEqual(parseSnapshotPaths(' docs/requirements.md \nmodels/system.sysml\ndocs/requirements.md\n'),['docs/requirements.md','models/system.sysml']);
 for(const value of ['','/private/secret','../outside','models/../../outside','models\\outside','https://example.com/x','C:/outside','~/secret','a\0b','models/./a','models//a'])assert.throws(()=>parseSnapshotPaths(value));
});

test('historical passed result remains distinct from current evidence applicability',()=>{
 const html=renderEngineeringState(emptyState('p',{evidence:[{id:'e1',title:'Old run',result:'passed',scope:'component only',provenance:'declared',objectVersions:{R1:1},applicability:{status:'needs_review',reasons:[{code:'object_changed',message:'R1 changed',objectId:'R1',recordedRevision:1,currentRevision:2}]},files:[{path:'results/old.json',sha256:'abc123',size:6}]}]}),{tab:'evidence',hasData:true});
 assert.match(html,/data-es-original-result="passed">通过/);
 assert.match(html,/data-es-applicability="needs_review">需要复核/);
 assert.match(html,/R1 changed/);assert.match(html,/v1 → v2/);assert.doesNotMatch(html,/&quot;code&quot;/);
 assert.match(html,/已登记 · 未由本记录独立执行/);
 assert.match(html,/data-path="results\/old.json"/);
 assert.doesNotMatch(html,/需求已验证|工程完成|符合 NASA/);
 const unknown=renderEngineeringState(emptyState('p',{evidence:[{id:'e2',title:'No applicability',result:'passed'}]}),{tab:'evidence',hasData:true});
 assert.match(unknown,/data-es-applicability="unknown">适用性未知/);
});

test('observation snapshots never silently appear approved and require an explicit reason',()=>{
 const html=renderEngineeringState(emptyState('p',{snapshots:[{id:'s1',kind:'observation',name:'Imported files',files:[],objectVersions:{R1:1}}]}),{tab:'snapshots',hasData:true});
 assert.match(html,/观察 · 未批准/);
 assert.match(html,/不是已批准的工程基线/);
 assert.match(html,/data-es-form="approve"/);
 assert.match(html,/name="reason" required/);
 assert.match(html,/不备份整个工作区/);
 assert.doesNotMatch(html,/data-es-action="(?:restore|branch)"/);
 const approved=renderEngineeringState(emptyState('p',{snapshots:[{id:'s2',name:'Reviewed',files:[],approval:{actor:{kind:'user',id:'reviewer'},reason:'Checked scope',approvedAt:'2026-10-23T12:00:00Z'}}]}),{tab:'snapshots',hasData:true});
 assert.match(approved,/用户已批准/);assert.match(approved,/Checked scope/);assert.match(approved,/reviewer/);assert.doesNotMatch(approved,/\[object Object\]/);assert.doesNotMatch(approved,/data-es-form="approve"/);
});

test('source identities, versions and errors render as text, with unsafe external links excluded',()=>{
 const html=renderEngineeringState(emptyState('p',{objects:[{id:'R1',kind:'requirement',revision:3,title:'<script>bad</script>',authority:'inferred',maturity:'draft',sources:['docs/original.md','https://example.com/requirements',{url:'javascript:alert(1)',title:'<img onerror=bad>'},{path:'docs/r.md',revision:'abc',line:4}],history:[{revision:2,title:'prior'}]}]}),{hasData:true,error:'<img src=x onerror=bad>'});
 assert.match(html,/R1 · 需求 · v3/);assert.match(html,/推导候选/);assert.match(html,/版本历史 · 1/);assert.match(html,/data-path="docs\/r.md"/);assert.match(html,/data-path="docs\/original.md"/);assert.match(html,/href="https:\/\/example.com\/requirements"/);assert.match(html,/&lt;script&gt;bad&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>|<img |href="javascript:/);
});

test('late project reads cannot replace the newly selected project and mounting does not write',async()=>{
 let project={id:'old'},resolveOld;const requests=[],host=makeHost();
 const ui=createEngineeringStateUI({getProject:()=>project,api:async(path,options)=>{requests.push({path,options});if(path.includes('/old/'))return new Promise(resolve=>{resolveOld=resolve;});return emptyState('new',{objects:[{id:'NEW',title:'Current project',revision:1}]});}});
 ui.mount(host);project={id:'new'};ui.mount(host);await new Promise(resolve=>setTimeout(resolve,0));
 resolveOld(emptyState('old',{objects:[{id:'OLD',title:'Old project secret',revision:1}]}));await new Promise(resolve=>setTimeout(resolve,0));
 assert.match(host.innerHTML,/Current project/);assert.doesNotMatch(host.innerHTML,/Old project secret/);assert.ok(requests.every(({options})=>!options?.method),'read-only mounting must never capture or approve');
});

test('manual capture, explicit user approval and change creation preserve the API contracts',async()=>{
 let project={id:'project/a'};const requests=[],current=emptyState(project.id,{objects:[{id:'R1',title:'Requirement',revision:1}]});
 const ui=createEngineeringStateUI({getProject:()=>project,api:async(path,options)=>{requests.push({path,options});return options?.method?{id:'created'}:current;}});
 await ui.refresh();
 await ui.captureSnapshot({name:' First observation ',paths:'docs/r.md\nmodels/m.sysml'});
 assert.equal(requests[1].path,'/api/projects/project%2Fa/engineering-state/snapshots');
 assert.deepEqual(JSON.parse(requests[1].options.body),{name:'First observation',paths:['docs/r.md','models/m.sysml']});
 assert.throws(()=>ui.approveSnapshot('s1',{reason:' '}),/批准理由/);
 await ui.approveSnapshot('s1',{reason:'Reviewed selected files only'});
 const approval=requests.find(({path})=>path.endsWith('/approve'));assert.deepEqual(JSON.parse(approval.options.body),{reason:'Reviewed selected files only'});
 assert.throws(()=>ui.createChange({title:'New budget',reason:'Update need',objectIds:['foreign']}),/不在当前工程记录/);
 await ui.createChange({title:'New budget',reason:'Update need',objectIds:'R1\nR1',baseSnapshotId:'s1'});
 const change=requests.find(({path})=>path.endsWith('/changes'));assert.deepEqual(JSON.parse(change.options.body),{title:'New budget',reason:'Update need',objectIds:['R1'],baseSnapshotId:'s1'});
});

test('a failed registration reports the failure without claiming a snapshot was captured',async()=>{
 const host=makeHost(),ui=createEngineeringStateUI({getProject:()=>({id:'p'}),api:async(path,options)=>{if(options?.method)throw Error('File changed while hashing');return emptyState('p');}});
 ui.mount(host);await new Promise(resolve=>setTimeout(resolve,0));
 await assert.rejects(ui.captureSnapshot({name:'race',paths:'r.md'}),/changed while hashing/);
 assert.match(host.innerHTML,/File changed while hashing/);assert.doesNotMatch(host.innerHTML,/观察快照已保存/);
});

test('unsent snapshot drafts survive refresh and panel navigation without leaking into another project',async()=>{
 let project={id:'one'};const host=makeHost();host.contains=value=>Boolean(value);
 const ui=createEngineeringStateUI({getProject:()=>project,api:async()=>emptyState(project.id)});
 ui.mount(host);await new Promise(resolve=>setTimeout(resolve,0));
 const clickTab=()=>host.handlers.click({target:{closest:()=>({dataset:{esAction:'tab',tab:'snapshots'}})}});
 await clickTab();
 const form={dataset:{esForm:'snapshot'}};
 host.handlers.input({target:{name:'name',value:'Unsent observation',closest:()=>form}});
 host.handlers.input({target:{name:'paths',value:'models/payload.sysml',closest:()=>form}});
 await ui.refresh();assert.match(host.innerHTML,/Unsent observation/);assert.match(host.innerHTML,/models\/payload.sysml/);
 ui.detach();project={id:'two'};ui.mount(host);await new Promise(resolve=>setTimeout(resolve,0));await clickTab();assert.doesNotMatch(host.innerHTML,/Unsent observation|models\/payload.sysml/);
 ui.detach();project={id:'one'};ui.mount(host);assert.match(host.innerHTML,/Unsent observation/);assert.match(host.innerHTML,/models\/payload.sysml/);
});

test('recorded source files and artifacts open through the shared project viewer callbacks',async()=>{
 const host=makeHost();host.contains=value=>Boolean(value);const opened=[];
 const ui=createEngineeringStateUI({getProject:()=>({id:'p'}),api:async()=>emptyState('p'),onOpenPath:async(...args)=>opened.push(['file',...args]),onOpenArtifact:async id=>opened.push(['artifact',id])});
 ui.mount(host);await new Promise(resolve=>setTimeout(resolve,0));
 await host.handlers.click({target:{closest:()=>({dataset:{esAction:'file',path:'docs/icd.md',line:'42'}})}});
 await host.handlers.click({target:{closest:()=>({dataset:{esAction:'artifact',id:'artifact_1'}})}});
 assert.deepEqual(opened,[['file','docs/icd.md',{line:42}],['artifact','artifact_1']]);
});
