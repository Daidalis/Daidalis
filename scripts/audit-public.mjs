#!/usr/bin/env node
// Offline, heuristic source-disclosure checks. No matching values are printed.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const args=process.argv.slice(2);
if(args.some(arg=>arg!=='--history'&&arg!=='--help')||args.filter(arg=>arg==='--history').length>1){
  console.error('Usage: node scripts/audit-public.mjs [--history]');process.exit(2);
}
if(args.includes('--help')){
  console.log('Usage: node scripts/audit-public.mjs [--history]\nDefault: inspect tracked working-tree files, including edits and staged additions. Deleted files are skipped.\n--history: inspect every unique reachable Git blob and its recorded path. No network requests are made.\nThis heuristic audit does not inspect image pixels/OCR or prove that every secret is absent.');process.exit(0);
}
const history=args.includes('--history');
const findings=new Map(),errors=[];
const counters={paths:0,blobs:0,archives:0,expandedBytes:0};
const MAX_GIT_OUTPUT=256*1024*1024,MAX_EXPANDED=128*1024*1024,MAX_EXPANDED_TOTAL=256*1024*1024;
const archiveHashes=new Set();
const knownFake=['sk','ant','local','fixture','not','real'].join('-');
const authorPaths=/(?:\/Users\/|\/Volumes\/)([^/\\\s"'<>]+)/g;
const placeholderRoots=new Set(['example','person','fixture','test','runner','name','...','NAS','LocalDisk','RemoteDisk']);
const rules=[
  ['private-key',/-----BEGIN (?:[A-Z0-9]+ )*(?:PRIVATE KEY)-----/g],
  ['github-token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g],
  ['aws-access-key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['slack-token',/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ['api-token',/\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35})\b/g],
  ['jwt-token',/\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b/g],
  ['private-conversation-url',/https?:\/\/(?:claude\.ai\/(?:code|share)|chatgpt\.com\/(?:c|share))\/[A-Za-z0-9_-]{12,}/g],
  ['author-machine-path',authorPaths],
];

function git(argv,{input,encoding='utf8',maxBuffer=MAX_GIT_OUTPUT}={}){
  const result=spawnSync('git',argv,{input,encoding,maxBuffer,stdio:['pipe','pipe','pipe']});
  if(result.error||result.status!==0)throw new Error('Git inspection failed: '+argv[0]);
  return result.stdout;
}
function report(file,category,line){
  const item={file,category,...(line?{line}:{})};
  findings.set(JSON.stringify(item),item);
}
function bannedPath(file){
  const normalized=file.replaceAll('\\','/').replace(/^\.\//,'');
  if(normalized==='project-notes'||normalized.startsWith('project-notes/'))report(file,'private-project-notes-path');
  if(normalized==='website/.openai/hosting.json')report(file,'owner-hosting-identity');
  if(/^(?:data|\.local|work|outputs|vm\/(?:state|assets|handoff))\//.test(normalized))report(file,'private-runtime-path');
  if(normalized!=='.env.example'&&/(?:^|\/)(?:\.env(?:\..*)?|\.npmrc)$/.test(normalized))report(file,'local-secret-configuration');
}
function lineAt(text,index){let line=1;for(let i=0;i<index;i++)if(text.charCodeAt(i)===10)line++;return line;}
function entropy(value){const counts=new Map();for(const c of value)counts.set(c,(counts.get(c)||0)+1);let sum=0;for(const n of counts.values()){const p=n/value.length;sum-=p*Math.log2(p);}return sum;}
function inspectText(file,bytes){
  const text=bytes.toString('latin1');
  for(const [category,rule] of rules){
    rule.lastIndex=0;
    for(const match of text.matchAll(rule)){
      if(category==='api-token'&&match[0]===knownFake)continue;
      if(category==='author-machine-path'&&(placeholderRoots.has(match[1])||(file.startsWith('tests/')&&['Local','Unknown','a'].includes(match[1]))))continue;
      report(file,category,lineAt(text,match.index));
    }
  }
  const literal=/(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret|authorization)\s*["']?\s*[:=]\s*["']([^"'\r\n]{32,})["']/gi;
  for(const match of text.matchAll(literal)){
    const value=match[1];
    if(!/^[A-Za-z0-9+/_=.:;-]+$/.test(value)||/^https?:\/\//i.test(value))continue;
    if((/^[A-Fa-f0-9]{32,}$/.test(value)&&entropy(value)>=3)||(/[a-z]/.test(value)&&/[A-Z]/.test(value)&&/\d/.test(value)&&entropy(value)>=4.1))report(file,'secret-literal-candidate',lineAt(text,match.index));
  }
  const credentialUrl=/https?:\/\/([^\s/:"'<>]+):([^\s@/"'<>]+)@([^\s/"'<>]+)/g;
  for(const match of text.matchAll(credentialUrl)){
    let host;try{host=new URL(match[0]).hostname.toLowerCase();}catch{continue;}
    if(host==='localhost'||host==='127.0.0.1'||host==='::1'||/(?:^|\.)(?:example|test|invalid)$/.test(host)||/(?:^|\.)example\.(?:com|org|net)$/.test(host))continue;
    report(file,'credential-bearing-url',lineAt(text,match.index));
  }
}
function tarString(bytes){return bytes.toString('utf8').replace(/\0.*$/s,'');}
function inspectTar(file,tar,depth){
  let offset=0,longName=null,paxName=null;
  while(offset+512<=tar.length){
    const header=tar.subarray(offset,offset+512);if(header.every(byte=>byte===0))return;
    const sizeText=tarString(header.subarray(124,136)).trim();
    if(!/^[0-7]+$/.test(sizeText))throw new Error('Unsupported tar header');
    const size=parseInt(sizeText,8),start=offset+512,end=start+size;
    if(!Number.isSafeInteger(size)||size<0||end>tar.length)throw new Error('Invalid tar bounds');
    const prefix=tarString(header.subarray(345,500));
    let name=tarString(header.subarray(0,100));if(prefix)name=prefix+'/'+name;
    const type=String.fromCharCode(header[156]||48),body=tar.subarray(start,end);
    offset=start+Math.ceil(size/512)*512;
    if(type==='L'){longName=tarString(body).trimEnd();continue;}
    if(type==='x'){for(const entry of body.toString('utf8').split('\n')){const at=entry.indexOf(' path=');if(at>=0)paxName=entry.slice(at+6);}continue;}
    if(type!=='0'&&type!=='\0')continue;
    name=paxName||longName||name;paxName=null;longName=null;
    const member=file+'!'+name;
    if(name.startsWith('/')||name.split('/').includes('..'))report(member,'unsafe-archive-member-path');
    inspect(member,body,depth+1);
  }
  if(offset!==tar.length)throw new Error('Truncated tar archive');
}
function inspect(file,bytes,depth=0){
  inspectText(file,bytes);
  if(!/\.(?:tgz|gz)$/i.test(file))return;
  const hash=createHash('sha256').update(bytes).digest('hex');if(archiveHashes.has(hash))return;archiveHashes.add(hash);
  if(depth>=4)throw new Error('Archive nesting limit reached');
  const expanded=gunzipSync(bytes,{maxOutputLength:MAX_EXPANDED});
  counters.archives++;counters.expandedBytes+=expanded.length;
  if(counters.expandedBytes>MAX_EXPANDED_TOTAL)throw new Error('Archive inspection budget exceeded');
  if(/(?:\.tgz|\.tar\.gz)$/i.test(file))inspectTar(file,expanded,depth);
  else inspectText(file+'!gunzip',expanded);
}
function inspectSafely(file,bytes){try{inspect(file,bytes);}catch{errors.push({file,category:'archive-inspection-incomplete'});}}

try{
  const root=git(['rev-parse','--show-toplevel']).trim();
  if(history){
    const rows=git(['rev-list','--objects','--all']).trim().split('\n').filter(Boolean);
    const objects=new Map();
    for(const row of rows){const at=row.indexOf(' '),oid=at<0?row:row.slice(0,at),file=at<0?null:row.slice(at+1);if(!objects.has(oid))objects.set(oid,file);if(file){counters.paths++;bannedPath(file);}}
    if(objects.size){
      const output=git(['cat-file','--batch'],{input:[...objects.keys()].join('\n')+'\n',encoding:null});let cursor=0;
      for(const [oid,file] of objects){
        const newline=output.indexOf(10,cursor);if(newline<0)throw new Error('Incomplete Git object stream');
        const header=output.subarray(cursor,newline).toString('ascii').split(' ');const size=Number(header[2]);
        if(header[0]!==oid||!Number.isSafeInteger(size)||size<0)throw new Error('Invalid Git object stream');
        const start=newline+1,end=start+size;if(end>=output.length||output[end]!==10)throw new Error('Incomplete Git object body');cursor=end+1;
        if(header[1]==='blob'){counters.blobs++;inspectSafely(file||'(unlabelled Git blob)',output.subarray(start,end));}
      }
    }
  }else{
    const files=[...new Set(git(['ls-files','-z']).split('\0').filter(Boolean))];
    for(const file of files){
      const absolute=path.join(root,file);let stat;try{stat=fs.lstatSync(absolute);}catch(error){if(error.code==='ENOENT')continue;throw error;}
      counters.paths++;bannedPath(file);
      if(stat.isSymbolicLink()){counters.blobs++;inspectSafely(file,Buffer.from(fs.readlinkSync(absolute)));}
      else if(stat.isFile()){counters.blobs++;inspectSafely(file,fs.readFileSync(absolute));}
    }
  }
}catch(error){console.error('Audit could not complete: '+error.message);process.exit(2);}

console.log('Manta public-source audit: '+(history?'reachable Git history':'tracked working tree'));
for(const item of [...findings.values()].sort((a,b)=>a.file.localeCompare(b.file)||a.category.localeCompare(b.category)||(a.line||0)-(b.line||0)))console.log(JSON.stringify(item.file)+(item.line?':'+item.line:'')+' ['+item.category+']');
for(const error of errors)console.log(JSON.stringify(error.file)+' ['+error.category+']');
console.log(`Examined ${counters.paths} paths, ${counters.blobs} blobs, ${counters.archives} expanded archives (${counters.expandedBytes} expanded bytes). Findings: ${findings.size}. Incomplete inspections: ${errors.length}.`);
console.log('Heuristic checks only: no image-pixel/OCR inspection and no guarantee that all secrets are absent. Matching values are never printed.');
process.exitCode=errors.length?2:findings.size?1:0;
