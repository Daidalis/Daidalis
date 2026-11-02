// Deterministic local model fixture. Exercises real native binaries, broker,
// model proxy, approval callbacks and filesystem effects without paid requests.
import http from 'node:http';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:'+process.env.PORT;
const command="test $(id -u) != 0 && test ! -S /run/task-docker.sock && test ! -d /broker-control && test -z \"$(ls -A /data)\" && printf 'export const answer = 42;\\n' > answer.mjs && node --check answer.mjs";
let count=0,cancelCase=false;
function event(res,type,data){res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');}
const model=http.createServer(async(req,res)=>{
 try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));
  const taskCommand=cancelCase?'touch cancel-started; sleep 10; touch cancel-escaped':command;
  const completed=JSON.stringify(body).includes('native_fixture_call');
  const tools=body.tools||[];
  if(req.url.startsWith('/v1/responses')){
   let name;
   for(const tool of tools){if(tool.name==='exec_command')name=tool.name;if(tool.type==='namespace')for(const child of tool.tools||[])if(child.name==='exec_command')name=tool.name+'.'+child.name;}
   const useTool=!!name&&!completed;
   const output=useTool?{type:'function_call',id:'fc_1',call_id:'native_fixture_call',name,arguments:JSON.stringify({cmd:taskCommand})}:{type:'message',id:'msg_1',role:'assistant',status:'completed',content:[{type:'output_text',text:'OK',annotations:[]}]};
   const response={id:'resp_'+(++count),object:'response',status:'completed',model:body.model,output:[output],usage:{input_tokens:10,output_tokens:10,total_tokens:20}};
   res.writeHead(200,{'content-type':'text/event-stream'});
   event(res,'response.created',{response:{...response,status:'in_progress',output:[]}});
   event(res,'response.output_item.added',{output_index:0,item:useTool?{...output,arguments:''}:{...output,content:[]}});
   if(useTool){event(res,'response.function_call_arguments.delta',{item_id:'fc_1',output_index:0,delta:output.arguments});event(res,'response.function_call_arguments.done',{item_id:'fc_1',output_index:0,arguments:output.arguments});}
   else{event(res,'response.content_part.added',{item_id:'msg_1',output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});event(res,'response.output_text.delta',{item_id:'msg_1',output_index:0,content_index:0,delta:'OK'});event(res,'response.output_text.done',{item_id:'msg_1',output_index:0,content_index:0,text:'OK'});}
   event(res,'response.output_item.done',{output_index:0,item:output});event(res,'response.completed',{response});res.end();
  }else if(req.url.startsWith('/v1/messages/count_tokens')){res.writeHead(200,{'content-type':'application/json'});res.end('{"input_tokens":10}');}
  else if(req.url.startsWith('/v1/messages')){
   const useTool=tools.some(t=>t.name==='Bash')&&!completed;
   const content=useTool?[{type:'tool_use',id:'native_fixture_call',name:'Bash',input:{command:taskCommand,description:'Write and verify the local fixture'}}]:[{type:'text',text:'OK'}];
   const message={id:'msg_'+(++count),type:'message',role:'assistant',model:body.model,content,stop_reason:useTool?'tool_use':'end_turn',stop_sequence:null,usage:{input_tokens:10,output_tokens:10}};
   if(!body.stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(message));return;}
   res.writeHead(200,{'content-type':'text/event-stream'});event(res,'message_start',{message:{...message,content:[],stop_reason:null}});
   event(res,'content_block_start',{index:0,content_block:useTool?{...content[0],input:{}}:{type:'text',text:''}});
   event(res,'content_block_delta',{index:0,delta:useTool?{type:'input_json_delta',partial_json:JSON.stringify(content[0].input)}:{type:'text_delta',text:'OK'}});
   event(res,'content_block_stop',{index:0});event(res,'message_delta',{delta:{stop_reason:message.stop_reason,stop_sequence:null},usage:{output_tokens:10}});event(res,'message_stop',{});res.end();
  }else{res.writeHead(404);res.end();}
 }catch{res.writeHead(500);res.end();}
});
async function api(route,body){const r=await fetch(base+route,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;}
await new Promise(resolve=>model.listen(18766,'127.0.0.1',resolve));
try{
 await Promise.all((process.env.MANTA_NATIVE_PARALLEL==='1'?['codex-app-server','claude-agent','claude-agent','claude-agent','claude-agent']:['codex-app-server','claude-agent']).map(async type=>{
  const provider=await api('/api/providers',{name:'Local broker protocol fixture '+type,type,baseUrl:'http://127.0.0.1:18766/v1',model:'mock-model',apiKey:'local-fixture-not-a-real-key'});
  const project=await api('/api/projects',{name:'Native broker fixture '+type,resources:{maxAutoResumes:0}});
  let sessionId;
  for(let turn=0;turn<2;turn++){
  const started=await api('/api/threads/'+project.coordinatorThreadId+'/messages',{providerId:provider.id,permissionMode:type==='codex-app-server'?'auto':'manual',content:'Write answer.mjs exporting answer=42 and verify it with Node. Use native shell tools.'});
  const runId=started.run?.id||started.runId||started.id;let done;
  for(let i=0;i<120;i++){
   const state=await api('/api/bootstrap');
   for(const approval of state.approvals.filter(a=>a.runId===runId)){
    const text=JSON.stringify(approval.args||{});
    const approved=text.includes('answer.mjs')&&!/\/data\/|\/proc\/|\.env|curl|wget/.test(text);
    await api('/api/approvals/'+approval.id,{decision:approved?'approve':'reject'});
   }
   const detail=await api('/api/threads/'+project.coordinatorThreadId);const run=detail.runs?.find(r=>r.id===runId);
   if(run&&['completed','failed','cancelled'].includes(run.status)){done=run;break;}
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  assert.equal(done?.status,'completed',JSON.stringify(done));
  assert.ok(done.runtimeSessionId,'Native session ID missing');
  if(turn===0)sessionId=done.runtimeSessionId;else assert.equal(done.runtimeSessionId,sessionId,'Second disposable container must resume the same native session');
  assert.equal(await fs.readFile(project.folderPath+'/answer.mjs','utf8'),'export const answer = 42;\n');
  console.log(JSON.stringify({passed:true,type,projectId:project.id,turn,scope:'real native binary, isolation controls and persisted session through disposable containers'}));
  }
 }));
 cancelCase=true;
 const provider=await api('/api/providers',{name:'Local cancellation fixture',type:'codex-app-server',baseUrl:'http://127.0.0.1:18766/v1',model:'mock-model',apiKey:'local-fixture-not-a-real-key'});
 const project=await api('/api/projects',{name:'Native broker cancellation',resources:{maxAutoResumes:0}});
 const started=await api('/api/threads/'+project.coordinatorThreadId+'/messages',{providerId:provider.id,permissionMode:'auto',content:'Run the cancellation test command.'});
 const runId=started.run?.id||started.runId||started.id;
 for(let i=0;i<60;i++){if(await fs.stat(project.folderPath+'/cancel-started').catch(()=>null))break;await new Promise(r=>setTimeout(r,1000));}
 await fs.access(project.folderPath+'/cancel-started');
 await api('/api/runs/'+runId+'/cancel',{});
 await new Promise(r=>setTimeout(r,11000));
 await assert.rejects(fs.access(project.folderPath+'/cancel-escaped'));
 const detail=await api('/api/threads/'+project.coordinatorThreadId);
 assert.equal(detail.runs.find(r=>r.id===runId).status,'cancelled');
 console.log(JSON.stringify({passed:true,type:'native cancellation removes executing child',projectId:project.id}));
}finally{model.closeAllConnections();await new Promise(resolve=>model.close(resolve));}
