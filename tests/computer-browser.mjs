// Explicit integration check: starts an ephemeral loopback application and real Chrome.
// Run with a normal local process (the Codex outer sandbox cannot launch Chrome).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStudioServer} from '../server/index.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'mbse-browser-'));
const app=await createStudioServer({root,dataDir,seed:false});
let report;
try{
  const address=await app.listen({port:0});
  const project=app.store.createProject({name:'Browser integration fixture'});
  const action=(action,args={},source='agent')=>app.computer.action({projectId:project.id,action,args},{source,permissionMode:'auto'});
  await action('browser.start');const before=await action('browser.navigate',{url:`http://127.0.0.1:${address.port}/computer-fixture.html`},'user');
  assert.equal(new URL(before.url).port,String(address.port));
  assert(before.text.includes('尚未记录需求'));
  assert(before.imageUrl.endsWith('.png'));
  await assert.rejects(action('browser.type',{text:'stale',screenVersion:-1}),/Stale/);
  const clicked=await action('browser.click',{x:350,y:301,screenVersion:before.screenVersion});
  const typed=await action('browser.type',{text:'可追溯的接口需求',screenVersion:clicked.screenVersion});
  const submitted=await action('browser.click',{x:209,y:374,screenVersion:typed.screenVersion});
  assert(submitted.text.includes('已记录：可追溯的接口需求'));
  const png=await app.computer.readScreenshot(submitted.imageUrl.split('/').at(-1));
  assert.equal(png.buffer.subarray(1,4).toString(),'PNG');
  const manual=app.computer.action({projectId:project.id,action:'browser.key',args:{key:'Enter',screenVersion:submitted.screenVersion}},{source:'agent',permissionMode:'manual'});
  const rejected=assert.rejects(manual,/Browser action rejected/);
  for(let n=0;n<100&&!app.store.data.approvals.some(a=>a.status==='pending');n++)await new Promise(resolve=>setTimeout(resolve,10));
  const approval=app.store.data.approvals.find(a=>a.status==='pending');assert.ok(approval,'Manual browser input must ask before acting');
  app.engine.decideApproval(approval.id,'reject');await rejected;
  const unchanged=await action('browser.screenshot');assert.equal(unchanged.screenVersion,submitted.screenVersion);
  await assert.rejects(action('browser.navigate',{url:`http://127.0.0.1:${address.port}/`,screenVersion:submitted.screenVersion}),/cannot access/);
  await assert.rejects(action('browser.navigate',{url:'http://169.254.169.254/',screenVersion:submitted.screenVersion}),/allowlist/);
  report={passed:true,checks:['ephemeral app origin','real PNG screenshot','stale frame rejection','screenshot coordinates click','Chinese keyboard input','form submission','manual browser approval required','rejected action leaves screen version unchanged','Manta approval UI blocked','private host blocked'],nativeDesktop:'not-exercised'};
  await fs.mkdir(path.join(root,'work'),{recursive:true});
  await fs.writeFile(path.join(root,'work/browser-integration.json'),JSON.stringify(report,null,2));
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
} finally{await app.close();await fs.rm(dataDir,{recursive:true,force:true});}
