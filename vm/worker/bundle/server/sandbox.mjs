import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {lookup} from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export function safePath(workspace,relative='.',{write=false}={}) {
  if(typeof relative!=='string'||relative.includes('\0')||relative.length>4096||path.isAbsolute(relative)) throw new Error('Use a project-relative path');
  const root=fs.realpathSync(workspace), target=path.resolve(root,relative);
  if(target!==root&&!target.startsWith(root+path.sep)) throw new Error('Path escapes the project workspace');
  let current=root;
  for(const segment of path.relative(root,target).split(path.sep).filter(Boolean)) {
    current=path.join(current,segment);
    if(fs.existsSync(current)||isLink(current)) {
      if(fs.lstatSync(current).isSymbolicLink()) throw new Error('Symbolic links are not allowed in project tools');
      const real=fs.realpathSync(current); if(real!==root&&!real.startsWith(root+path.sep)) throw new Error('Path escapes the workspace');
    }
  }
  if(write&&target===root) throw new Error('Cannot replace the workspace root');
  return target;
}
function isLink(p){try{return fs.lstatSync(p).isSymbolicLink();}catch{return false;}}
export async function listWorkspace(workspace,relative='.') {
  const start=safePath(workspace,relative),output=[];
  async function walk(dir,depth) {
    if(depth>10||output.length>=1500) return;
    for(const entry of await fsp.readdir(dir,{withFileTypes:true})) {
      if(output.length>=1500) break;
      if(entry.isSymbolicLink()) continue;
      const full=path.join(dir,entry.name),p=path.relative(workspace,full);
      if(entry.isDirectory()) {output.push({path:p,type:'directory'}); if(!['.git','node_modules','.venv'].includes(entry.name)) await walk(full,depth+1);}
      else if(entry.isFile()) output.push({path:p,type:'file',size:(await fsp.stat(full)).size});
    }
  }
  if(!(await fsp.stat(start)).isDirectory()) throw new Error('Path is not a directory');
  await walk(start,0); return output;
}
export const commandSandboxAvailable=()=>process.platform==='darwin'&&fs.existsSync('/usr/bin/sandbox-exec');
export async function sandboxCommand({workspace,command,timeoutMs=30000,signal}) {
  if(!commandSandboxAvailable()) throw new Error('Command execution unavailable: no supported OS sandbox. No unsandboxed fallback is allowed.');
  if(typeof command!=='string'||!command.trim()||command.length>16000) throw new Error('Invalid command');
  const temporary=await fsp.mkdtemp(path.join(workspace,'.command-'));
  const quote=s=>JSON.stringify(fs.realpathSync(s));
  // No host home, runtime credentials, network access or project-external writes.
  const reads=['/System','/usr','/bin','/sbin','/Library/Apple','/private/etc','/private/var/select','/dev','/Library/Developer/CommandLineTools'];
  const runtime=path.dirname(path.dirname(process.execPath)); if(!reads.some(p=>runtime.startsWith(p))) reads.push(runtime);
  // Apple's installed dyld-support.sb explicitly requires opening the root directory
  // itself as an openat(2) descriptor. `literal` matches only '/', not descendants;
  // unlike `subpath`, it grants no reads of /Users, /private/tmp or credentials.
  // Metadata is needed for getcwd; file contents still follow the allowlist below.
  const profile=`(version 1) (deny default) (allow process*) (allow signal (target same-sandbox)) (allow sysctl-read) (allow mach-lookup) (allow file-read-metadata) (allow file-read* (literal "/") ${reads.filter(fs.existsSync).map(p=>`(subpath ${quote(p)})`).join(' ')} (subpath ${quote(workspace)})) (allow file-write* (subpath ${quote(workspace)})) (allow file-read* file-write* (literal "/dev/null") (literal "/dev/urandom"))`;
  try {
    return await spawnBounded('/usr/bin/sandbox-exec',['-p',profile,'/bin/sh','-c',command],{cwd:workspace,signal,timeoutMs:Math.min(Math.max(timeoutMs,100),60000),env:{PATH:`${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,HOME:temporary,TMPDIR:temporary,LANG:'en_US.UTF-8'},maxBytes:200000});
  } finally {await fsp.rm(temporary,{recursive:true,force:true});}
}
export function spawnBounded(file,args,{cwd,signal,timeoutMs=120000,env,maxBytes=1000000,onLine,input,killGraceMs=1000}={}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted) return reject(new Error('Cancelled'));
    const child=spawn(file,args,{cwd,env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
    let stdout='',stderr='',bytes=0,pending='',settled=false,timedOut=false;
    const stop=()=>{try{if(child.pid&&process.platform!=='win32')process.kill(-child.pid,'SIGTERM');else child.kill('SIGTERM');}catch{};const hard=setTimeout(()=>{try{if(child.pid&&process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}},Math.min(Math.max(killGraceMs,1000),30000));hard.unref();};
    const timer=setTimeout(()=>{timedOut=true;stop();},timeoutMs);
    const abort=()=>stop(); signal?.addEventListener('abort',abort,{once:true});
    function finish(error,result){if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);}
    const consume=(kind,chunk)=>{bytes+=chunk.length;if(bytes>maxBytes){stop();return;}const s=chunk.toString();if(kind==='stdout'){stdout+=s;if(onLine){pending+=s;let at;while((at=pending.indexOf('\n'))>=0){const line=pending.slice(0,at);pending=pending.slice(at+1);onLine(line);}}}else stderr+=s;};
    child.stdout.on('data',c=>consume('stdout',c));child.stderr.on('data',c=>consume('stderr',c));
    child.on('error',e=>finish(e));
    child.on('close',(code,terminationSignal)=>finish(signal?.aborted?new Error('Cancelled'):timedOut?new Error('Command timed out'):bytes>maxBytes?new Error('Command output exceeded limit'):null,{code,signal:terminationSignal,stdout,stderr}));
    child.stdin.on('error',()=>{});
    child.stdin.end(input||'');
  });
}
export function isPrivateAddress(address) {
  if(net.isIPv4(address)) {const a=address.split('.').map(Number);return a[0]===0||a[0]===10||a[0]===127||a[0]>=224||(a[0]===169&&a[1]===254)||(a[0]===172&&a[1]>=16&&a[1]<=31)||(a[0]===192&&(a[1]===168||a[1]===0))||(a[0]===100&&a[1]>=64&&a[1]<=127)||(a[0]===198&&(a[1]===18||a[1]===19));}
  if(net.isIPv6(address)) {const a=address.toLowerCase();if(a.startsWith('::ffff:'))return isPrivateAddress(a.slice(7));return a==='::'||a==='::1'||a.startsWith('fc')||a.startsWith('fd')||/^fe[89ab]/.test(a)||a.startsWith('ff')||a.startsWith('2001:db8');}return true;
}
export async function publicFetch(raw,{signal,redirects=3,maxBytes=500000}={}) {
  const url=new URL(raw); if(!['https:','http:'].includes(url.protocol)||url.username||url.password) throw new Error('Only public HTTP(S) URLs without credentials are allowed');
  const hostname=url.hostname.replace(/^\[|\]$/g,'');
  if(['localhost','metadata.google.internal'].includes(hostname)||hostname.endsWith('.localhost')||hostname.endsWith('.local')) throw new Error('Private network addresses are blocked');
  const addresses=net.isIP(hostname)?[{address:hostname,family:net.isIP(hostname)}]:await lookup(hostname,{all:true});
  if(!addresses.length||addresses.some(x=>isPrivateAddress(x.address))) throw new Error('Private network addresses are blocked');
  const picked=addresses[0];
  return new Promise((resolve,reject)=>{
    const request=(url.protocol==='https:'?https:http).get(url,{signal,timeout:20000,lookup:(_host,options,callback)=>{if(typeof options==='function')callback=options;if(options?.all) callback(null,[picked]);else callback(null,picked.address,picked.family);}},response=>{
      if([301,302,303,307,308].includes(response.statusCode)&&response.headers.location){response.resume();if(redirects<=0)return reject(new Error('Too many redirects'));return publicFetch(new URL(response.headers.location,url).href,{signal,redirects:redirects-1,maxBytes}).then(resolve,reject);}
      if(response.statusCode>=400){response.resume();return reject(new Error(`Fetch failed: HTTP ${response.statusCode}`));}
      const contentType=response.headers['content-type']||'';
      if(!/text\/|json|xml|javascript/.test(contentType)){response.resume();return reject(new Error('Only text responses are supported'));}
      let bytes=0,text='';response.on('data',c=>{bytes+=c.length;if(bytes>maxBytes){request.destroy(new Error('Response exceeds size limit'));return;}text+=c.toString('utf8');});
      response.on('end',()=>resolve({url:url.href,status:response.statusCode,contentType,text}));response.on('error',reject);
    }); request.on('timeout',()=>request.destroy(new Error('Web request timed out')));request.on('error',reject);
  });
}
