import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createComputerService,validateBrowserUrl,validateBrowserRequest,browserActionNeedsApproval} from '../server/computer.mjs';
test('native control cannot be enabled by an agent or without consent',async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'mbse-computer-'));const service=await createComputerService({root,dataDir:root});try{assert.equal(service.status().desktop.status,'requires-consent');await assert.rejects(service.action({projectId:'p',action:'desktop.enable',args:{consent:true}},{source:'agent'}),/explicit user consent/);await assert.rejects(service.action({projectId:'p',action:'desktop.enable',args:{}},{source:'user'}),/explicit user consent/);}finally{await service.close();await fs.rm(root,{recursive:true,force:true});}});
test('screenshot file paths cannot escape screenshot storage',async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'mbse-computer-'));const service=await createComputerService({root,dataDir:root});try{await assert.rejects(service.readScreenshot('../../secrets.png'),/Invalid screenshot/);await assert.rejects(service.readScreenshot('/etc/passwd'),/Invalid screenshot/);}finally{await service.close();await fs.rm(root,{recursive:true,force:true});}});

test('isolated browser cannot turn its own UI into a user approval channel',()=>{const options={baseUrl:'http://127.0.0.1:4317',allowedHosts:['github.com']};assert.equal(validateBrowserUrl('http://127.0.0.1:4317/computer-fixture.html',options),'http://127.0.0.1:4317/computer-fixture.html');for(const url of ['http://127.0.0.1:4317/','http://127.0.0.1:4317/app.js','http://127.0.0.1:4317/api/computer/action','http://127.0.0.1:4317/computer-fixture.html?path=/api/','https://github.com:444/','https://github.com.attacker.example/','file:///etc/passwd','http://169.254.169.254/','wss://github.com/'])assert.throws(()=>validateBrowserUrl(url,options));assert.equal(validateBrowserUrl('https://github.com/nasa/nos3/issues/351',options),'https://github.com/nasa/nos3/issues/351');});

test('engineering computer use is scoped to its project and cannot call approval APIs',()=>{
const o={baseUrl:'http://127.0.0.1:4317',allowedHosts:[],projectId:'project_a'};
assert.equal(validateBrowserUrl(o.baseUrl+'/engineering.html?projectId=project_a',o),o.baseUrl+'/engineering.html?projectId=project_a');
assert.throws(()=>validateBrowserUrl(o.baseUrl+'/engineering.html?projectId=project_b',o),/does not match/);
assert.throws(()=>validateBrowserUrl(o.baseUrl+'/api/approvals/approval_a',o),/cannot access/);
assert.throws(()=>validateBrowserRequest(o.baseUrl+'/api/engineering/run',{...o,method:'POST',body:JSON.stringify({projectId:'project_b'})}),/remain/);
assert.throws(()=>validateBrowserRequest(o.baseUrl+'/api/engineering/runs/run_a?projectId=project_b',o),/does not match/);
assert.throws(()=>validateBrowserRequest(o.baseUrl+'/api/engineering/runs/run_a',{...o,method:'DELETE'}),/read operations/);
assert.equal(validateBrowserRequest(o.baseUrl+'/api/engineering/run',{...o,method:'POST',body:JSON.stringify({projectId:'project_a',model:'thermal-control-v1'})}),o.baseUrl+'/api/engineering/run');
});

test('browser permission mode distinguishes local automation, manual input and remote actions',()=>{
  const local='http://127.0.0.1:4317/engineering.html?projectId=project_a';
  const base={baseUrl:'http://127.0.0.1:4317',currentUrl:local,source:'agent',permissionMode:'auto'};
  assert.equal(browserActionNeedsApproval({...base,action:'browser.click'}),false);
  assert.equal(browserActionNeedsApproval({...base,action:'browser.click',permissionMode:'manual'}),true);
  assert.equal(browserActionNeedsApproval({...base,action:'browser.click',permissionMode:undefined}),true);
  assert.equal(browserActionNeedsApproval({...base,action:'browser.click',currentUrl:'https://github.com/nasa/nos3'}),true);
  assert.equal(browserActionNeedsApproval({...base,action:'browser.navigate',targetUrl:'https://github.com/nasa/nos3'}),true);
  assert.equal(browserActionNeedsApproval({...base,action:'browser.navigate',currentUrl:'https://github.com',targetUrl:local}),false);
  assert.equal(browserActionNeedsApproval({...base,action:'browser.navigate',targetUrl:local,permissionMode:'manual'}),true);
  assert.equal(browserActionNeedsApproval({...base,action:'browser.screenshot',permissionMode:'manual'}),false);
  assert.equal(browserActionNeedsApproval({...base,action:'browser.start',permissionMode:'manual'}),false);
  assert.equal(browserActionNeedsApproval({...base,action:'browser.click',source:'user',permissionMode:'manual'}),false);
});
