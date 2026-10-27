import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const quote=value=>JSON.stringify(value);
const within=(parent,child)=>child===parent||child.startsWith(parent+path.sep);

/** Optional OS read boundary for a requirements-first evaluation turn. */
export function codexReadIsolation({privateRoot,workspace,codexPath}) {
  if(process.platform!=='darwin'||!fs.existsSync('/usr/bin/sandbox-exec'))throw new Error('Codex read isolation requires macOS sandbox-exec');
  if(typeof privateRoot!=='string'||!path.isAbsolute(privateRoot))throw new Error('Read isolation requires an absolute private root');
  const root=fs.realpathSync(privateRoot),project=fs.realpathSync(workspace),binary=fs.realpathSync(codexPath);
  if(!fs.statSync(root).isDirectory()||!fs.statSync(project).isDirectory()||!fs.statSync(binary).isFile())throw new Error('Read isolation paths must exist');
  const broad=new Set([path.parse(root).root,os.homedir(),os.tmpdir(),'/Users','/Volumes','/private','/private/tmp','/tmp']);
  if(root!==path.resolve(privateRoot)||broad.has(root)||within(root,project)||within(project,root))throw new Error('Read isolation private root must be a specific separate directory');
  const appRoot=binary.startsWith('/Applications/ChatGPT.app/')?'/Applications/ChatGPT.app':path.dirname(binary);
  const codexHome=path.join(root,'codex-home'),tmp=path.join(root,'tmp');
  fs.mkdirSync(codexHome,{recursive:true,mode:0o700});fs.mkdirSync(tmp,{recursive:true,mode:0o700});
  const reads=['/System','/usr','/bin','/sbin','/Library/Apple','/Library/Developer/CommandLineTools','/private/etc','/private/var/select','/dev',appRoot,root,project].filter(fs.existsSync);
  const profile=`(version 1) (deny default) (allow process*) (allow signal (target same-sandbox)) (allow sysctl-read) (allow mach-lookup) (allow network*) (allow file-read-metadata) (allow file-read* (literal "/") ${reads.map(p=>`(subpath ${quote(p)})`).join(' ')}) (allow file-write* (subpath ${quote(root)}) (subpath ${quote(project)})) (allow file-read* file-write* (literal "/dev/null") (literal "/dev/urandom"))`;
  return {file:'/usr/bin/sandbox-exec',args:['-p',profile,binary],env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',HOME:root,CODEX_HOME:codexHome,TMPDIR:tmp,XDG_CACHE_HOME:root,XDG_CONFIG_HOME:root},profile};
}
