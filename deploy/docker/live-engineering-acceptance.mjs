// Opt-in real model workflow; credentials come only from runtime environment.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base='http://127.0.0.1:'+process.env.PORT;
async function api(route,body){const response=await fetch(base+route,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const result=await response.json();if(!response.ok)throw Error(String(result.error||response.status).split(process.env.OPENAI_API_KEY||'__missing__').join('[REDACTED]'));return result;}
assert.ok(process.env.OPENAI_API_KEY&&process.env.OPENAI_BASE_URL&&process.env.OPENAI_MODEL,'Runtime API environment required');
const provider=await api('/api/providers',{name:'Engineering workflow acceptance',type:'openai-responses',baseUrl:process.env.OPENAI_BASE_URL,model:process.env.OPENAI_MODEL,keyEnv:'OPENAI_API_KEY'});
const project=await api('/api/projects',{name:'Agent engineering workflow',resources:{maxAutoResumes:0},instructions:'Work only in this project. Do not delegate or use network tools. The requested example is explicitly a mass-spring model, not a vehicle.'});
const input='Create models/MassSpring.mo using save_professional_model with expectedHash set to JSON null. Model name MassSpring; parameters m=1,c=4,k=25,F0=10; Real x(start=0,fixed=true),v(start=0,fixed=true); equations der(x)=v and m*der(v)+c*v+k*x=F0. Read its hash, submit an OpenModelica simulation from 0 to 4 seconds with 400 intervals and tolerance 1e-8. Include final x==0.4 and final v==0 checks, each with tolerance 0.005. Wait for the actual result and report whether execution and checks passed. Use professional tools; no shell commands or delegation.';
const started=await api('/api/threads/'+project.coordinatorThreadId+'/messages',{content:input,providerId:provider.id,permissionMode:'auto'});
const runId=started.run?.id||started.runId||started.id;
let complete=false;
try{
 const deadline=Date.now()+360000;let detail,run;
 while(Date.now()<deadline){detail=await api('/api/threads/'+project.coordinatorThreadId);run=detail.runs.find(r=>r.id===runId);if(['completed','failed','cancelled','interrupted'].includes(run?.status))break;await new Promise(r=>setTimeout(r,1000));}
 assert.equal(run?.status,'completed',run?.error||'Run did not finish');
 const events=detail.events.filter(e=>e.runId===runId&&e.type==='tool.completed');
 assert.ok(events.some(e=>e.data.tool==='save_professional_model'&&e.data.result?.saved));
 const result=events.findLast(e=>e.data.tool==='wait_professional_job')?.data.result;
 assert.equal(result?.executionSucceeded,true,'No successful solver evidence');assert.equal(result?.verification?.status,'passed',JSON.stringify(result?.verification));
 assert.match(await fs.readFile(project.folderPath+'/models/MassSpring.mo','utf8'),/model MassSpring/);
 complete=true;console.log(JSON.stringify({passed:true,projectId:project.id,runId,checks:['Agent creates model with null hash','actual solver execution','numeric checks pass','source and artifacts persisted']}));
}finally{if(!complete)await api('/api/runs/'+runId+'/cancel',{}).catch(()=>{});}
