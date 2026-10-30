// Opt-in real-provider acceptance. Credentials come from the runtime environment,
// never CLI arguments. Creates visible test projects; outputs only redacted summaries.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
async function command(cwd,args){return new Promise((resolve,reject)=>{const child=spawn(args[0],args.slice(1),{cwd,env:{PATH:process.env.PATH,HOME:'/tmp',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'},stdio:['ignore','pipe','pipe']});let text='';child.stdout.on('data',b=>text+=b);child.stderr.on('data',b=>text+=b);child.on('error',reject);child.on('close',code=>resolve({code,text}));});}
const config=process.env;
const base='http://127.0.0.1:'+(process.env.PORT||4317);
const key=config.OPENAI_API_KEY;
if(!key||!config.OPENAI_BASE_URL||!config.OPENAI_MODEL)throw Error('OPENAI_API_KEY, OPENAI_BASE_URL and OPENAI_MODEL are required');
const redact=text=>String(text).split(key).join('[REDACTED]');
async function api(route,body,method=body?'POST':'GET'){
  const response=await fetch(base+route,{method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(180000)});
  const result=await response.json();if(!response.ok)throw Error(redact(result.error||'HTTP '+response.status));return result;
}
const types=(process.env.MANTA_TEST_TYPES||'codex-app-server,claude-agent').split(',');
for(const type of types){
  let active;
  try{
    const bootstrap=await api('/api/bootstrap'),name='Repository acceptance · '+type;
    const existing=bootstrap.providers.find(p=>p.name===name);
    const profile={name,type,baseUrl:config.OPENAI_BASE_URL,model:config.OPENAI_MODEL,keyEnv:'OPENAI_API_KEY',apiKey:key};
    const provider=await api('/api/providers'+(existing?'/'+existing.id:''),profile,existing?'PATCH':'POST');
    const connection=await api('/api/providers/'+provider.id+'/test',{});
    if(!connection.ok)throw Error(redact(connection.message));
    console.log(JSON.stringify({type,connection:'passed'}));
    const project=await api('/api/projects',{name,instructions:'Acceptance project: do not delegate, inspect credentials, access outside the project, or make network requests.',resources:{maxAutoResumes:0}});
    await fs.mkdir(project.folderPath+'/src');await fs.mkdir(project.folderPath+'/test');
    const filename='src/clamp.mjs',original='export function clamp(value,min,max){return Math.min(value,max); }\n';
    const tests=`import test from 'node:test';import assert from 'node:assert/strict';import {clamp} from '../src/clamp.mjs';
    test('clamps both ends and retains values inside the interval',()=>{for(const [v,a,b,w] of [[-5,0,10,0],[50,0,10,10],[3,0,10,3],[-8,-10,-3,-8],[-20,-10,-3,-10]])assert.equal(clamp(v,a,b),w);});
    test('rejects reversed limits',()=>assert.throws(()=>clamp(1,5,0),RangeError));`;
    await fs.writeFile(project.folderPath+'/'+filename,original);await fs.writeFile(project.folderPath+'/test/clamp.test.mjs',tests);
    await fs.writeFile(project.folderPath+'/package.json',JSON.stringify({type:'module',scripts:{test:'node --test'}}));
    assert.equal((await command(project.folderPath,['git','init','-q'])).code,0);
    assert.equal((await command(project.folderPath,['git','add','.'])).code,0);
    assert.notEqual((await command(project.folderPath,['node','--test'])).code,0,'Fixture must fail before the repair');
    const content='Use your native code and shell tools to fix src/clamp.mjs: clamp to both limits, preserve in-range values, and throw RangeError when min > max. Inspect and run the existing tests, make the smallest source fix, rerun npm test, and review git diff. Do not change tests or package.json. Do not delegate, access outside this project, inspect credentials or use network. Report actual test results.';
    const started=await api('/api/threads/'+project.coordinatorThreadId+'/messages',{content,providerId:provider.id,permissionMode:'auto'});
    active=started.run?.id||started.runId||started.id;
    assert.ok(active,'Run ID missing');
    const deadline=Date.now()+240000;
    let final,detail;
    while(Date.now()<deadline){
      detail=await api('/api/threads/'+project.coordinatorThreadId);
      const run=detail.runs?.find(r=>r.id===active);
      if(run&&['completed','failed','cancelled','interrupted'].includes(run.status)){final=run;break;}
      const state=await api('/api/bootstrap');
      for(const approval of state.approvals.filter(a=>a.runId===active)){
        // Only approve the known acceptance-file operation, never broader access.
        const args=JSON.stringify(approval.args||approval.input||{});
        const allowed=(args.includes(filename)||/npm test|node --test|git diff|git status|clamp.test.mjs/.test(args))&&!/(\.env|\/data\/|\/home\/|\/proc\/|curl |wget )/.test(args);
        await api('/api/approvals/'+approval.id,{decision:allowed?'approve':'reject'});
      }
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    assert.ok(final,'Live run timed out');assert.equal(final.status,'completed',redact(final.error||final.status));
    assert.notEqual(await fs.readFile(project.folderPath+'/'+filename,'utf8'),original);
    assert.equal(await fs.readFile(project.folderPath+'/test/clamp.test.mjs','utf8'),tests);
    const independentlyChecked=await command(project.folderPath,['node','--test']);assert.equal(independentlyChecked.code,0,independentlyChecked.text);
    const diff=await command(project.folderPath,['git','diff','--name-only']);assert.equal(diff.text.trim(),filename);
    const evidence=(detail.events||[]).filter(e=>e.runId===active&&e.type==='tool.completed');
    assert.ok(evidence.length,'No tool execution evidence');
    if(type!=='openai-responses')assert.ok(evidence.some(e=>e.data?.native),'Native tool evidence missing');
    console.log(JSON.stringify({type,workflow:'native repository repair and independent tests passed',projectId:project.id,runId:active,tools:evidence.map(e=>e.data?.tool)}));
    active=null;
  }catch(error){
    if(active)await api('/api/runs/'+active+'/cancel',{}).catch(()=>{});
    console.log(JSON.stringify({type,passed:false,error:redact(error.message).slice(0,1500)}));
    process.exitCode=1;
  }
}
