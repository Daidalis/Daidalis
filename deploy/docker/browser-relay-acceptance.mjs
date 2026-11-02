// Real Chromium, synthetic HTTPS sites served in memory; no external requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createComputerService} from '../../server/computer.mjs';
import {relayBrowserRequest} from '../../server/browser-relay.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'browser-parity-'));
const baseUrl='http://127.0.0.1:4317';
const seen=[];
const oldHosts=process.env.MBSE_COMPUTER_HOSTS;process.env.MBSE_COMPUTER_HOSTS='example.com';
const service=await createComputerService({root,dataDir:root,browserFetch:args=>relayBrowserRequest(args,{baseUrl,allowedHosts:['example.com'],projectId:'project_one',context:{source:'user'},fetchImpl:async(url,opts)=>{
 const pathname=new URL(url).pathname;seen.push({url,method:opts.method,cookie:opts.headers.get('cookie'),body:opts.body,contentType:opts.headers.get('content-type'),auth:opts.headers.get('authorization')});
 if(pathname==='/login')return new Response(`<form method="post" action="/session"><input name="name" value="fixture"></form><script>document.forms[0].submit()</script>`,{headers:{'content-type':'text/html'}});
 if(pathname==='/session')return new Response(null,{status:303,headers:[['location','/account'],['set-cookie','session=synthetic; Secure; HttpOnly; Path=/'],['set-cookie','preference=dark; Secure; Path=/']]});
 if(pathname==='/account')return new Response(`<body>loading<script>fetch('/api',{method:'PATCH',headers:{'content-type':'application/octet-stream','authorization':'Bearer site-fixture'},body:new Uint8Array([0,255,128,1])}).then(r=>r.text()).then(t=>document.body.innerText=t)</script>`,{headers:{'content-type':'text/html'}});
 if(pathname==='/api')return new Response('ACCOUNT OK');
 if(pathname==='/blocked')return new Response(null,{status:302,headers:{location:'http://169.254.169.254/'}});
 if(pathname==='/redirect-auth')return new Response(`<script>fetch('/cross',{headers:{authorization:'Bearer must-stay-on-origin'}}).then(r=>r.text()).then(t=>document.body.innerText=t)</script>`,{headers:{'content-type':'text/html'}});
 if(pathname==='/cross')return new Response(null,{status:302,headers:{location:'https://other.example.com/destination'}});
 if(pathname==='/destination')return new Response('CROSS OK',{headers:{'access-control-allow-origin':'https://example.com'}});
 return new Response('<body>isolated fixture</body>',{headers:{'content-type':'text/html'}});
 }})});
service.setBaseUrl(baseUrl);
try{
 const action=(projectId,action,args={})=>service.action({projectId,action,args},{source:'user'});
 let result=await action('project_one','browser.navigate',{url:'https://example.com/login'});
 for(let i=0;i<50&&!result.text.includes('ACCOUNT OK');i++){await new Promise(r=>setTimeout(r,100));result=await action('project_one','browser.screenshot');}
 assert.match(result.text,/ACCOUNT OK/,JSON.stringify(seen));
 const post=seen.find(r=>r.url==='https://example.com/session');assert.equal(post.method,'POST');assert.match(post.contentType,/application\/x-www-form-urlencoded/);assert.equal(post.body.toString(),'name=fixture');
 const api=seen.find(r=>r.url==='https://example.com/api');assert.match(api.cookie,/session=synthetic/);assert.match(api.cookie,/preference=dark/);assert.equal(api.auth,'Bearer site-fixture');assert.deepEqual(api.body,Buffer.from([0,255,128,1]));assert.equal(api.method,'PATCH');
 await action('project_two','browser.navigate',{url:'https://example.com/other'});
 assert.equal(seen.find(r=>r.url==='https://example.com/other').cookie,null);
 result=await action('project_one','browser.navigate',{url:'https://example.com/redirect-auth'});
 for(let i=0;i<50&&!result.text.includes('CROSS OK');i++){await new Promise(r=>setTimeout(r,100));result=await action('project_one','browser.screenshot');}
 assert.match(result.text,/CROSS OK/);
 const cross=seen.find(r=>r.url==='https://other.example.com/destination');assert.equal(cross.auth,null);assert.equal(cross.cookie,null);
 await assert.rejects(action('project_one','browser.navigate',{url:'https://example.com/blocked'}));
 assert.equal(seen.some(r=>r.url.includes('169.254')),false);
 console.log('Chromium form login, redirect, multiple cookies, site authentication, binary PATCH and separate project cookie jars passed');
}finally{await service.close();await fs.rm(root,{recursive:true,force:true});if(oldHosts===undefined)delete process.env.MBSE_COMPUTER_HOSTS;else process.env.MBSE_COMPUTER_HOSTS=oldHosts;}
