import {validateBrowserRequest,validateBrowserUrl} from './computer.mjs';

const methods=new Set(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']);
const hopHeaders=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','host','content-length','accept-encoding']);
const maxBody=1024*1024;

// Only browser-supplied site credentials travel here. Never merge application env,
// provider keys or the HTTP client's cookie store into this request.
export async function relayBrowserRequest(args,{baseUrl,allowedHosts,projectId,fetchImpl=fetch,signal,approve=async()=>false,context={}}){
 if(!args||typeof args.url!=='string'||args.url.length>16000||!methods.has(args.method))throw Error('Invalid browser request');
 let body;
 if(args.bodyBase64!==undefined&&args.bodyBase64!==null){
  if(typeof args.bodyBase64!=='string'||args.bodyBase64.length>Math.ceil(maxBody/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(args.bodyBase64))throw Error('Invalid browser body');
  body=Buffer.from(args.bodyBase64,'base64');if(body.length>maxBody)throw Error('Browser request too large');
 }else if(args.body!==undefined&&args.body!==null){
  if(typeof args.body!=='string'||Buffer.byteLength(args.body)>maxBody)throw Error('Invalid browser body');body=Buffer.from(args.body);
 }
 if(body&&['GET','HEAD'].includes(args.method))throw Error('Unexpected browser body');
 const policy={baseUrl,allowedHosts,projectId};
 const url=validateBrowserRequest(args.url,{...policy,method:args.method,body:body?.toString('utf8')});
 const local=new URL(url).origin===new URL(baseUrl).origin;
 if(local&&args.method==='POST'&&context.source!=='user'&&context.permissionMode!=='auto'&&!await approve(body?.toString('utf8')))throw Error('Browser execution rejected');
 if(args.headers!==undefined&&(!args.headers||Array.isArray(args.headers)||typeof args.headers!=='object'))throw Error('Invalid browser headers');
 const headers=new Headers();let headerBytes=0;
 for(const [name,value] of Object.entries(args.headers||{})){
  if(typeof value!=='string'||!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)||/[\r\n\0]/.test(value))throw Error('Invalid browser header');
  headerBytes+=name.length+Buffer.byteLength(value);if(headerBytes>64000)throw Error('Browser headers too large');
  if(hopHeaders.has(name.toLowerCase())||(local&&['authorization','cookie'].includes(name.toLowerCase())))continue;
  headers.set(name,value);
 }
 const response=await fetchImpl(url,{method:args.method,headers,body,redirect:'manual',signal:AbortSignal.any([...(signal?[signal]:[]),...(context.signal?[context.signal]:[]),AbortSignal.timeout(30000)])});
 const chunks=[];let size=0;
 for await(const chunk of response.body||[]){size+=chunk.length;if(size>8*1024*1024)throw Error('Browser response too large');chunks.push(chunk);}
 const resultHeaders={};
 for(const [name,value] of response.headers){
  if(!hopHeaders.has(name)&&!['content-encoding','set-cookie'].includes(name))resultHeaders[name]=value;
 }
 // Playwright supports newline-separated Set-Cookie values. Preserve independent
 // cookies (including Expires commas); Chromium owns domain/path/SameSite policy.
 const cookies=response.headers.getSetCookie();if(cookies.length&&!local)resultHeaders['set-cookie']=cookies.join('\n');
 if(response.status>=300&&response.status<400&&resultHeaders.location)validateBrowserUrl(new URL(resultHeaders.location,url).href,policy);
 return {status:response.status,headers:resultHeaders,contentBase64:Buffer.concat(chunks).toString('base64')};
}
