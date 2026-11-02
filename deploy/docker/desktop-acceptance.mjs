// Real multi-project desktop/file workflow. Run only with explicit desktop acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base='http://127.0.0.1:'+process.env.PORT;
async function api(route,body){const response=await fetch(base+route,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;}
const projects=(await api('/api/bootstrap')).projects;
async function project(name){return projects.find(p=>p.name===name)||await api('/api/projects',{name});}
const one=await project('Desktop workflow A'),two=await project('Desktop workflow B');
for(const p of [one,two])await fs.writeFile(p.folderPath+'/private-boundary.txt','private project file');
async function action(p,name,args={}){return api('/api/computer/action',{projectId:p.id,action:'desktop.'+name,args});}
for(const [p,marker] of [[one,'FIRST'],[two,'SECOND']]){
 await fs.rm(p.folderPath+'/desktop-proof.txt',{force:true});
 await fs.writeFile(p.folderPath+'/desktop-model.scad','cube([2,3,4]);\n');
 await action(p,'enable',{consent:true});
 let shot=await action(p,'screenshot');
 await action(p,'open_app',{toolId:'openscad',path:'desktop-model.scad',screenVersion:shot.screenVersion});
 await new Promise(r=>setTimeout(r,800));
 shot=await action(p,'screenshot');
 await action(p,'open_app',{toolId:'terminal',screenVersion:shot.screenVersion});
 await new Promise(r=>setTimeout(r,800));
 shot=await action(p,'screenshot');
 await action(p,'type',{text:(process.env.MANTA_EXECUTION_MODE==='broker'?'test ! -r '+(p.id===one.id?two:one).folderPath+'/private-boundary.txt && test ! -S /run/task-docker.sock && ':'')+'printf '+marker+' > desktop-proof.txt',screenVersion:shot.screenVersion});
 shot=await action(p,'screenshot');await action(p,'key',{key:'Enter',screenVersion:shot.screenVersion});
 let content;for(let i=0;i<30;i++){content=await fs.readFile(p.folderPath+'/desktop-proof.txt','utf8').catch(()=>null);if(content===marker)break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(content,marker);
}
await action(one,'enable',{consent:true});assert.ok((await action(one,'screenshot')).imageUrl);
assert.equal((await api('/api/computer/status')).desktop.projectId,one.id);
assert.equal(await fs.readFile(two.folderPath+'/desktop-proof.txt','utf8'),'SECOND');
if(process.env.MANTA_EXECUTION_MODE==='broker'){
 const page=await fetch('http://127.0.0.1:8081/vnc.html');assert.equal(page.status,200);assert.match(await page.text(),/noVNC/);
 for(let i=0;i<24;i++){const asset=await fetch('http://127.0.0.1:8081/vnc.html',{headers:{connection:'close'}});assert.equal(asset.status,200);await asset.arrayBuffer();}
 let ws;
 await new Promise((resolve,reject)=>{ws=new WebSocket('ws://127.0.0.1:8081/websockify');ws.binaryType='arraybuffer';const timer=setTimeout(()=>{ws.close();reject(Error('VNC handshake timeout'));},15000);ws.onerror=()=>reject(Error('VNC websocket failed'));ws.onmessage=e=>{try{assert.match(Buffer.from(e.data).toString(),/^RFB 003/);clearTimeout(timer);ws.onmessage=null;resolve();}catch(error){reject(error);}};});
 const closed=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.close();reject(Error('Old desktop tunnel remained open after project switch'));},5000);ws.onclose=()=>{clearTimeout(timer);resolve();};});
 await action(two,'enable',{consent:true});await closed;
 await action(one,'enable',{consent:true});
 console.log('Per-project desktop boundaries, noVNC HTTP/RFB and old-tunnel cleanup passed');
}
await action(one,'disable');
console.log(JSON.stringify({passed:true,checks:['open project OpenSCAD source','GUI terminal writes persist into correct project','switch projects without closing prior session','return to first session']}));
