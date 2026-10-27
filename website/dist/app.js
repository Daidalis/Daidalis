const $ = (s,root=document)=>root.querySelector(s);
const $$ = (s,root=document)=>[...root.querySelectorAll(s)];
let chapter=1,pane='overview',threadId='power',artifact=null,artifactOrigin={pane:'overview',threadId:'power'},variant='corrected',recording=null,loadFailed=false,artifactOpener=null,intervened=false,forwarded=false;
const paneScroll={};
const threads={power:{name:'Power & flight software',brief:'Trace LC → SC → MGR / EPS and preserve the failed baseline.'},review:{name:'Verification & evidence',brief:'Compare both runs, check re-entry, and identify the limits of the evidence.'}};
const checkNames=['Native processes & telemetry observed','Above-critical behavior preserved','Critical power reaches Safe; all switches off','Science re-entry above critical preserved','Repeated critical condition reaches Safe'];
const followup='Also verify protection after the second Science entry.';
const artifactButton=(id,label,icon='◇')=>'<button class="artifact-link" data-artifact="'+id+'"><span aria-hidden="true">'+icon+'</span>'+label+'<span aria-hidden="true">↗</span></button>';
function stateFor(id){return chapter<2?(id==='power'?'working':'waiting'):chapter===2?(id==='power'?'resolved':'working'):'resolved';}
const stateName={working:'Working',waiting:'Waiting for a thread',resolved:'Resolved'};
function threadRef(id){const state=stateFor(id);return '<button class="inline-thread state-'+state+'" data-thread="'+id+'"><span class="thread-state-dot" aria-hidden="true"></span>'+threads[id].name+'<span class="inline-thread-status">'+stateName[state]+'</span><span aria-hidden="true">↗</span></button>';}
function message(body,user=false,who='Coordinator'){return '<div class="chat-message '+(user?'chat-user':'')+'"><div class="'+(user?'example-user':'assistant-name')+'">'+(user?'Illustrative request':who)+'</div>'+body+'</div>';}
function assignment(){return message('<p>I’ll give the protection-chain work to '+threadRef('power')+' and the comparison to '+threadRef('review')+'. I’ll keep the mission constraints here, then review what comes back.</p><div class="assignment-note">Two focused threads · both report to this Coordinator</div>');}
function coordinatorContent(){
 const intent=message('<p>When power becomes critical, enter Safe mode and turn off every EPS switch. Preserve normal operation above the threshold, and check that protection works again after returning to Science.</p>',true);
 let body=intent+assignment();
 if(chapter===0)body+=message('<p>Each thread has a bounded task and a clear handoff. You can open either one while keeping this project conversation in view.</p><div class="chat-artifacts">'+artifactButton('model','View the design map')+'</div>');
 if(chapter===1)body+=message('<div class="coord-wait"><span aria-hidden="true">◷</span><div><strong>Waiting for the protection-chain result</strong><p>Verification is waiting on that result too. I’ll resume the review when it is delivered.</p></div></div><button class="replay-action" data-route-followup>Try a follow-up routed to its thread <span aria-hidden="true">↗</span></button>');
 if(chapter===2)body+=message('<div class="handoff-receipt">↳ Delivered by Power & flight software</div><p>The thread returned the original <strong>3/5</strong> and corrected <strong>5/5</strong> selected check results. I’m checking their scope with '+threadRef('review')+' before summarizing.</p><div class="chat-artifacts">'+artifactButton('checks','Inspect the handed-off evidence','✓')+'</div>');
 if(chapter===3)body+=message('<div class="handoff-receipt">✓ Thread findings reviewed by Coordinator</div><p>The corrected native run passed <strong>5 of 5 selected checks</strong>, with <strong>473 EPS telemetry samples</strong>. The original failure remains available for comparison.</p><div class="review-box"><p><strong>What this establishes</strong><br>The selected low-power behavior in the NOS3 / cFS / NASA 42 / EPS software-integration regression.</p></div><div class="chat-artifacts">'+artifactButton('telemetry','View simulation','∿')+artifactButton('checks','Evidence & checks','✓')+artifactButton('report','Read the review','≡')+'</div><p class="small-scope">Still open: full mission scheduling and science delivery; hardware/HIL; environmental and lifetime qualification; independent acceptance.</p>');
 return body+'<div id="coord-intervention" class="coord-intervention" hidden></div>';
}
function updateInterventionReceipt(){
 const el=$('#coord-intervention');if(!el)return;
 el.hidden=!intervened;
 el.innerHTML=forwarded?message('<p>'+followup+'</p><span class="forwarded-label">↳ Sent to Power & flight software · scripted example</span>',true)+message('<p>I passed that follow-up to '+threadRef('power')+'. Its detailed exchange stays in the thread; the reviewed result returns here.</p>'):message('<div class="handoff-receipt">↳ Direct thread intervention</div><p>The illustrative follow-up is now in '+threadRef('power')+'. I’ll include its re-entry finding when reviewing the handoff.</p>');
}
function renderConversation(){
 $('#conversation-title').textContent='Coordinator';
 const states=['Delegating the work','Waiting for threads','Reviewing results','Summary ready'];
 $('#chapter-status').innerHTML='<span class="coordinator-state phase-'+chapter+'"><span aria-hidden="true">'+(chapter===1?'◷':chapter===3?'✓':'◉')+'</span>'+states[chapter]+'</span>';
 $('#conversation-content').innerHTML=coordinatorContent();updateInterventionReceipt();
}
function overview(){
 const rows=[['needs-user','Waiting on you'],['working','Working'],['idle','Idle'],['resolved','Resolved']];
 return '<div class="threads-overview"><div class="overview-intro"><h3>The project, at a glance.</h3><p>One Coordinator. Two parallel threads.</p><span class="replay-status-note">Status at this illustrative replay step</span></div>'+rows.map(([key,label])=>{
 const ids=Object.keys(threads).filter(id=>stateFor(id)===(key==='idle'?'waiting':key));
 return '<details class="thread-group" '+(ids.length&&key!=='resolved'?'open':'')+'><summary><span>'+label+'</span><span class="group-count">'+ids.length+'</span></summary>'+(!ids.length?'<p class="empty-thread-group">No threads in this group.</p>':ids.map(id=>'<button class="overview-thread state-'+key+'" data-thread="'+id+'"><span class="thread-state-dot" aria-hidden="true"></span><span class="thread-row-copy"><strong>'+threads[id].name+'</strong><small>'+(key==='idle'?'Waiting for Power & flight software':key==='resolved'?'Delivered · findings available':id==='power'?'Checking the protection chain':'Reviewing the scoped check outcomes')+'</small></span><span aria-hidden="true">›</span></button>').join(''))+'</details>';
 }).join('')+'<div class="overview-footnote">Open a thread here or from its reference in the Coordinator. The main conversation stays in place.</div></div>';
}
function threadContent(id){
 const t=threads[id],state=stateFor(id);
 let body='<div class="thread-detail"><div class="thread-detail-top"><span class="thread-role">Assigned by Coordinator</span><span class="thread-status state-'+state+'">'+stateName[state]+'</span></div><h3>'+t.name+'</h3><p class="thread-task">'+t.brief+'</p>';
 if(id==='power'){
 body+=message('<p>Inspect the selected power-protection chain. Keep normal above-critical behavior, verify Safe mode and all switches off below the threshold, and check repeated Science entry.</p>',true);
 body+=message('<p>I’ll keep the baseline and corrected configuration separate, and return the observed modes, switch states, and original telemetry.</p><div class="chat-artifacts">'+artifactButton('model','Design map')+artifactButton('recipe','Frozen test recipe','⌘')+'</div>',false,t.name);
 body+='<details class="replay-process"><summary>Source inspection & native run details</summary><p>The recorded study used the selected NOS3 / cFS / NASA 42 / EPS recipe. Process logs stay inside the task conversation. The recording is not running again in this website.</p></details>';
 if(intervened)body+=message('<p>'+followup+'</p><span class="forwarded-label">'+(forwarded?'↳ Forwarded from Coordinator':'Direct intervention · scripted example')+'</span>',true)+message('<p>I’ll include the re-entry condition in the handoff. In the retained recording, the original final sample stays in mode 3 with switch7 on; the corrected run reaches mode 1 with switch7 off.</p>',false,t.name);
 else if(chapter===1)body+='<div class="intervention-example"><p>You can guide a thread directly.</p><button class="replay-action" data-intervene>Try an illustrative follow-up <span aria-hidden="true">↗</span></button></div>';
 if(chapter>=2)body+=message('<div class="handoff-receipt">↳ Result returned to Coordinator</div><p>Original: <strong>3/5</strong> selected checks. Corrected: <strong>5/5</strong>. Original failures retained.</p><div class="chat-artifacts">'+artifactButton('telemetry','Telemetry comparison','∿')+artifactButton('checks','Check outcomes','✓')+'</div>',false,t.name);
 else body+='<p class="thread-wait-note">In this replay step, the thread is doing the assigned work. Choose “Review the handoff” above to see its delivery.</p>';
 } else {
 body+=message('<p>Review the power thread’s delivery against the assigned scope. Keep the failed baseline, inspect actual check observations, and preserve unverified mission requirements.</p>',true);
 if(chapter<2)body+='<div class="coord-wait"><span aria-hidden="true">◷</span><div><strong>Waiting for Power & flight software</strong><p>This thread needs the native result before it can review the comparison.</p></div></div>';
 else body+=message('<p>The recorded low-power evidence supports five selected software checks after correction. It does not establish complete mission coverage or physical qualification.</p><div class="chat-artifacts">'+artifactButton('checks','Review check evidence','✓')+artifactButton('report','Scope and open work','≡')+'</div><div class="handoff-receipt">'+(chapter===3?'↳ Review handed back to Coordinator':'Review in this illustrative stage')+'</div>',false,t.name);
 body+='<details class="replay-process"><summary>Review details</summary><p>Separate execution completion from check outcomes. Bind results to their recorded input/model hashes. Preserve the failed original run and the engineering work outside the tested scope.</p></details>';
 }
 return body+'<div class="thread-demo-note">Illustrative conversation · recorded evidence · no live Agent</div></div>';
}
function rememberPaneScroll(){paneScroll[pane==='thread'?threadId:pane]=$('#artifact-content').scrollTop;}
function renderRightPane(focus=false){
 $('#artifact-panel').hidden=false;
 const back=$('#pane-back'),close=$('#close-artifact');
 back.hidden=pane==='overview';close.hidden=pane==='overview';
 back.textContent=pane==='artifact'&&artifactOrigin.pane==='thread'?'← Thread':'← Threads';
 back.setAttribute('aria-label',pane==='artifact'&&artifactOrigin.pane==='thread'?'Back to thread':'Back to threads');
 close.setAttribute('aria-label',back.getAttribute('aria-label'));
 $('#overview-button').setAttribute('aria-pressed',String(pane==='overview'));
 if(pane==='artifact')renderArtifact();
 else{
 $('#artifact-title').textContent=pane==='overview'?'Threads':threads[threadId].name;
 $('#artifact-content').innerHTML=pane==='overview'?overview():threadContent(threadId);
 }
 $('#artifact-content').scrollTop=paneScroll[pane==='thread'?threadId:pane]||0;
 if(focus)$('#artifact-title').focus({preventScroll:true});
}
function showThread(id){if(!threads[id])return;rememberPaneScroll();pane='thread';threadId=id;artifact=null;renderRightPane(true);}
function showOverview(){rememberPaneScroll();pane='overview';artifact=null;renderRightPane(true);}
function openArtifact(name,trigger){
 rememberPaneScroll();
 if(trigger?.closest('#conversation-content'))artifactOrigin={pane:'overview',threadId};
 else if(pane!=='artifact')artifactOrigin={pane,threadId};
 artifactOpener=document.activeElement?.matches('[data-artifact]')?{id:name,origin:artifactOrigin.pane}:null;
 pane='artifact';artifact=name;renderRightPane(true);
 if(innerWidth<761)$('#artifact-panel').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'nearest'});
}
function closeArtifact(){
 if(pane==='artifact'){
 const origin=artifactOrigin;artifact=null;pane=origin.pane;threadId=origin.threadId;renderRightPane();
 const scope=pane==='thread'?$('#artifact-content'):$('#conversation-content');
 const opener=artifactOpener?scope.querySelector('[data-artifact="'+artifactOpener.id+'"]'):null;
 (opener||$('#artifact-title')).focus({preventScroll:true});
 } else showOverview();
}
function setChapter(index){
 chapter=(index+4)%4;pane='overview';artifact=null;intervened=false;forwarded=false;
 $$('[data-chapter]').forEach(b=>{const on=Number(b.dataset.chapter)===chapter;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;});
 $('#demo-stage').setAttribute('aria-labelledby','chapter-'+chapter);
 $('#next-chapter').innerHTML=['Next: work & waiting','Next: review the handoff','Next: the evidence','Back to the request'][chapter]+' <span aria-hidden="true">→</span>';
 renderConversation();renderRightPane();
}
function run(){return recording?.runs[variant];}
function variants(){return `<div class="variant-switch" role="group" aria-label="Recorded run"><button data-variant="baseline" aria-pressed="${variant==='baseline'}">Original · 3/5</button><button data-variant="corrected" aria-pressed="${variant==='corrected'}">Corrected · 5/5</button></div>`;}
function checks(){return `<div class="check-count"><strong>${run().checks.filter(c=>c.passed).length}<span style="font-size:15px;color:#a2af96"> / 5</span></strong><small>selected checks passed</small></div><ul class="check-list">${run().checks.map((c,i)=>`<li><span class="${c.passed?'pass':'fail'}" aria-label="${c.passed?'Passed':'Failed'}">${c.passed?'✓':'×'}</span><span>${checkNames[i]}</span></li>`).join('')}</ul>`;}
function chart(){const rows=run().samples,w=300,h=172,left=34,right=8,top=18,bottom=28,x=t=>left+(t/100)*(w-left-right),y=v=>top+(24500-v)/1100*(h-top-bottom);const path=rows.map((p,i)=>(i?'L':'M')+x(p.time).toFixed(2)+' '+y(p.batteryMillivolts).toFixed(2)).join(' ');return `<div class="chart-legend"><span><i></i>Battery voltage</span><span><i class="orange"></i>Critical threshold</span></div><svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Recorded battery voltage over 96 seconds. Hover or use the sample selector to inspect values.">${[23500,24000,24500].map(v=>`<line class="grid" x1="${left}" x2="${w-right}" y1="${y(v)}" y2="${y(v)}"/><text x="${left-6}" y="${y(v)+3}" text-anchor="end">${(v/1000).toFixed(1)}</text>`).join('')}${[0,25,50,75,100].map(t=>`<text x="${x(t)}" y="${h-8}" text-anchor="middle">${t}</text>`).join('')}<text x="2" y="10">V</text><text x="${w-3}" y="${h-8}" text-anchor="end">s</text><line class="limit" x1="${left}" x2="${w-right}" y1="${y(23760)}" y2="${y(23760)}"/><path class="voltage-line" d="${path}"/><circle id="chart-point" cx="${x(rows[0].time)}" cy="${y(rows[0].batteryMillivolts)}" r="3" fill="#b96f51"/><rect class="chart-hit" id="chart-hit" x="${left}" y="${top}" width="${w-left-right}" height="${h-top-bottom}"/></svg><label class="sample-range-label">Inspect sample <input id="sample-range" type="range" aria-label="Telemetry sample" min="0" max="${rows.length-1}" value="0"></label><div class="chart-caption" id="chart-caption" aria-live="polite"></div>`;}
function evidenceDetails(){const r=run();return `<details class="evidence-detail"><summary>Input & data provenance</summary><dl><dt>Native job</dt><dd>${r.jobId}</dd><dt>Model SHA-256</dt><dd>${r.modelSha256}</dd><dt>Input SHA-256</dt><dd>${r.inputSha256}</dd><dt>Telemetry SHA-256</dt><dd>${r.telemetrySha256}</dd></dl></details>`;}
function renderArtifact(){
 const labels={model:'Design map',telemetry:'Native simulation result',checks:'Verification evidence',recipe:'Frozen native recipe',report:'Engineering review'};$('#artifact-title').textContent=labels[artifact];let body='';
 if(artifact==='model')body='<p class="artifact-kicker">REQUIREMENT → DESIGN → CHECK</p><h3>Health before science.</h3><p>The selected protection chain, shown as an explanatory design map.</p><div class="diagram"><div class="diagram-node"><small>Candidate requirement</small>Critical power → Safe mode</div><div class="diagram-connector">↓</div><div class="diagram-node"><small>Flight software</small>LC monitor → SC sequence → MGR / EPS</div><div class="diagram-connector">↓</div><div class="diagram-node"><small>Observed behavior</small>Safe mode + eight switches off</div><div class="diagram-connector">↓</div><div class="diagram-node"><small>Verification</small>Native telemetry + repeated re-entry check</div></div>'+artifactButton('recipe','Open the native test recipe','⌘')+'<p class="artifact-note">This explanation is not a live SysML semantic model. The full Manta workspace includes SysML source, structural views, and semantic checks.</p>';
 else if(artifact==='recipe')body='<p class="artifact-kicker">NATIVE NOS3 / STF RECIPE</p><h3>The tested configuration.</h3><p>A frozen source snapshot from the corrected run. The download retains its recorded model hash.</p><pre class="artifact-code" id="recipe-source">Loading recorded source…</pre><a class="artifact-download" href="assets/evidence/STFLowPower.stf.json" download>Download source ↓</a><p class="artifact-note">Read-only replay. In the local application, source changes require another native job before new evidence can be claimed.</p>';
 else if(!recording)body='<p class="loading-message">'+(loadFailed?'Recorded evidence could not be loaded. Reload the page or download the demo guide below.':'Loading recorded evidence…')+'</p>';
 else if(artifact==='telemetry')body='<p class="artifact-kicker">RECORDED NATIVE EXECUTION · 23 OCT 2026</p><h3>Power protection, observed.</h3>'+variants()+chart()+checks()+'<a class="artifact-download" href="assets/evidence/'+variant+'.csv" download>Download all '+run().rowCount+' samples ↓</a>'+evidenceDetails()+'<p class="artifact-note">Raw sampled values, connected visually. Voltage alone does not establish a check outcome; the checks also inspect modes and switches.</p>';
 else if(artifact==='checks')body='<p class="artifact-kicker">SELECTED SOFTWARE INTEGRATION</p><h3>Keep the failed baseline.</h3><p>Execution completed in both runs. Verification outcomes differ.</p>'+variants()+checks()+evidenceDetails()+'<a class="artifact-download" href="assets/evidence/recording.json" download>Download curated evidence ↓</a><p class="artifact-note">Full STF mission behavior, hardware, environment, lifetime, and independent acceptance are not established by these five checks.</p>';
 else if(artifact==='report')body='<p class="artifact-kicker">CURATED REVIEW OF RECORDED EVIDENCE</p><h3>A tested increment.<br>With an explicit boundary.</h3><p><strong>Observed</strong><br>The corrected native run passed five selected low-power checks. The original run passed three. Actual modes and EPS switch telemetry support this comparison.</p><p><strong>Retained</strong><br>Input and model hashes, original failed results, native telemetry, and check-level observations.</p><p><strong>Still open</strong><br>Complete mission scheduling and science delivery; physical EPS calibration; hardware/HIL; environment and lifetime qualification; mission-authority acceptance.</p><a class="artifact-download" href="assets/demo-guide.md" download>Read the demo guide ↓</a><p class="artifact-note">No complete-STF, flight-readiness, or certification claim is made.</p>';
 $('#artifact-content').innerHTML='<div class="artifact-inner">'+body+'</div>';
 if(artifact==='telemetry'&&recording){updateSample(0);$('#sample-range').addEventListener('input',e=>updateSample(Number(e.target.value)));$('#chart-hit').addEventListener('pointermove',e=>{const svg=e.currentTarget.closest('svg'),p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const local=p.matrixTransform(svg.getScreenCTM().inverse()),t=Math.max(0,Math.min(100,(local.x-34)/258*100)),rows=run().samples;let best=0;for(let i=1;i<rows.length;i++)if(Math.abs(rows[i].time-t)<Math.abs(rows[best].time-t))best=i;updateSample(best);$('#sample-range').value=String(best);});}
 if(artifact==='recipe')fetch('assets/evidence/STFLowPower.stf.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(d=>{if(artifact==='recipe')$('#recipe-source').textContent=JSON.stringify({title:d.title,parameters:d.parameters,scenario:d.scenario,scope:d.scope},null,2);}).catch(()=>{if($('#recipe-source'))$('#recipe-source').textContent='Source unavailable. Please use the download link or reload.';});
}
function updateSample(i){const p=run().samples[i],node=$('#chart-point');if(!p||!node)return;node.setAttribute('cx',String(34+p.time/100*258));node.setAttribute('cy',String(18+(24500-p.batteryMillivolts)/1100*126));$('#chart-caption').textContent=`${p.time.toFixed(2)} s · ${(p.batteryMillivolts/1000).toFixed(3)} V · mode ${p.mode??'unreported'} · switch7 ${p.switch7} · ${p.phase}`;}
document.addEventListener('click',e=>{
 const a=e.target.closest('[data-artifact]');if(a)openArtifact(a.dataset.artifact,a);
 const t=e.target.closest('[data-thread]');if(t)showThread(t.dataset.thread);
 const ch=e.target.closest('[data-chapter]');if(ch)setChapter(Number(ch.dataset.chapter));
 const v=e.target.closest('[data-variant]');if(v){variant=v.dataset.variant;renderArtifact();}
 if(e.target.closest('[data-intervene]')){intervened=true;updateInterventionReceipt();renderRightPane();}
 if(e.target.closest('[data-route-followup]')){intervened=true;forwarded=true;updateInterventionReceipt();showThread('power');}
});
$('#overview-button').addEventListener('click',showOverview);
$('#pane-back').addEventListener('click',closeArtifact);
$('#close-artifact').addEventListener('click',closeArtifact);
$('#next-chapter').addEventListener('click',()=>setChapter(chapter+1));
$('.demo-chapters').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();setChapter(e.key==='Home'?0:e.key==='End'?3:chapter+(e.key==='ArrowRight'?1:-1));$('#chapter-'+chapter).focus();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&pane!=='overview')closeArtifact();});
$('#copy-install').addEventListener('click',async()=>{
 const commands='git clone https://github.com/MingxiYe/Manta.git\ncd Manta\nnpm ci\nnpm start';
 try{await navigator.clipboard.writeText(commands);$('#copy-install').textContent='Copied ✓';setTimeout(()=>$('#copy-install').innerHTML='Copy <span aria-hidden="true">⧉</span>',2200);}
 catch{const range=document.createRange();range.selectNodeContents($('.install-block code'));const s=getSelection();s.removeAllRanges();s.addRange(range);$('#toast').textContent='Commands selected — copy with ⌘C or Ctrl+C.';$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,4000);}
});
fetch('assets/evidence/recording.json').then(r=>{if(!r.ok)throw Error('Evidence unavailable');return r.json();}).then(d=>{recording=d;if(artifact)renderArtifact();}).catch(()=>{loadFailed=true;if(artifact)renderArtifact();});
setChapter(1);
