import test from 'node:test';
import assert from 'node:assert/strict';
import {relayBrowserRequest} from '../server/browser-relay.mjs';
const policy={baseUrl:'http://127.0.0.1:4317',allowedHosts:['example.com'],projectId:'project_one'};
test('browser relay preserves site authentication, methods, binary bodies and response policy',async()=>{
 const bytes=Buffer.from([0,255,128,1]);let called=false;
 const result=await relayBrowserRequest({url:'https://example.com/api',method:'PATCH',bodyBase64:bytes.toString('base64'),headers:{authorization:'Bearer browser-site-token',cookie:'session=fixture','content-type':'application/octet-stream',host:'wrong',connection:'keep-alive'}},{...policy,fetchImpl:async(url,opts)=>{
  called=true;assert.equal(opts.redirect,'manual');assert.equal(opts.method,'PATCH');assert.deepEqual(opts.body,bytes);assert.equal(opts.headers.get('cookie'),'session=fixture');assert.equal(opts.headers.get('authorization'),'Bearer browser-site-token');assert.equal(opts.headers.has('host'),false);assert.equal(opts.headers.has('connection'),false);
  return new Response('decoded',{headers:[['set-cookie','a=1; Path=/; Secure'],['set-cookie','b=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Secure'],['content-encoding','gzip'],['content-length','999'],['content-security-policy',"default-src 'self'"]]});
 }});
 assert.equal(called,true);assert.match(result.headers['set-cookie'],/\nb=2/);assert.equal(result.headers['content-encoding'],undefined);assert.equal(result.headers['content-length'],undefined);assert.equal(result.headers['content-security-policy'],"default-src 'self'");assert.equal(Buffer.from(result.contentBase64,'base64').toString(),'decoded');
});
test('local engineering relay keeps project and approval boundaries and drops site credentials',async()=>{
 let calls=0;
 const opts={...policy,fetchImpl:async(_url,request)=>{calls++;assert.equal(request.headers.has('cookie'),false);assert.equal(request.headers.has('authorization'),false);return new Response('{}');}};
 const args={url:policy.baseUrl+'/api/engineering/run',method:'POST',body:JSON.stringify({projectId:policy.projectId}),headers:{cookie:'foreign-site=secret',authorization:'foreign-site-secret','content-type':'application/json'}};
 await assert.rejects(relayBrowserRequest(args,opts),/rejected/);
 await assert.rejects(relayBrowserRequest({...args,body:'{"projectId":"project_other"}'},opts),/remain/);
 assert.equal(calls,0);
 await relayBrowserRequest(args,{...opts,approve:async()=>true});assert.equal(calls,1);
});
test('relay blocks forbidden destinations, redirects and malformed input',async()=>{
 for(const patch of [{method:'CONNECT'},{headers:{foo:'bad\r\nvalue'}},{bodyBase64:'!!'},{body:'x'.repeat(1048577)},{url:policy.baseUrl+'/api/bootstrap'}]){
  await assert.rejects(relayBrowserRequest({url:'https://example.com/',method:'POST',...patch},{...policy,fetchImpl:()=>{assert.fail('must not fetch');}}));
 }
 await assert.rejects(relayBrowserRequest({url:'https://example.com/',method:'GET'},{...policy,fetchImpl:async()=>new Response(null,{status:302,headers:{location:'http://169.254.169.254/'}})}),/allowlist/);
});
