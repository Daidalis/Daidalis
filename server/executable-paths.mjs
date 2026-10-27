import fs from 'node:fs';
import path from 'node:path';

export const CODEX_MISSING_MESSAGE='Codex executable not found. Install Codex on PATH or set MBSE_CODEX_PATH to its executable. On Windows use a native .exe or run Manta in WSL; .cmd/.bat launchers are not executed.';

/** Resolve a launchable file without a shell, probing configuration and PATH only. */
export function resolveExecutable(command,{env=process.env,platform=process.platform,cwd=process.cwd(),isExecutable}={}) {
  if(typeof command!=='string'||!command.trim()||/[\0\r\n]/.test(command))return null;
  const value=command.trim(),paths=platform==='win32'?path.win32:path;
  const allowed=file=>platform!=='win32'||/\.(?:exe|com)$/i.test(file);
  const check=isExecutable||((file)=>{try{fs.accessSync(file,fs.constants.X_OK);return fs.statSync(file).isFile();}catch{return false;}});
  const candidates=[];
  if(paths.isAbsolute(value)||/[\/\\]/.test(value))candidates.push(paths.resolve(cwd,value));
  else {
    const key=platform==='win32'?Object.keys(env).find(k=>k.toLowerCase()==='path'):'PATH';
    const directories=(env[key]||'').split(platform==='win32'?';':path.delimiter).filter(Boolean);
    const names=platform==='win32'&&!paths.extname(value)?[value+'.exe',value+'.com']:[value];
    for(const dir of directories)for(const name of names)candidates.push(paths.resolve(cwd,dir.replace(/^"|"$/g,''),name));
  }
  return candidates.find(file=>allowed(file)&&check(file))||null;
}

/** Explicit configuration is authoritative; an invalid override never falls back. */
export function resolveCodexExecutable(options={}) {
  const env=options.env||process.env,platform=options.platform||process.platform;
  if(env.MBSE_CODEX_PATH)return resolveExecutable(env.MBSE_CODEX_PATH,{...options,env,platform});
  const found=resolveExecutable('codex',{...options,env,platform});if(found)return found;
  if(platform==='darwin')for(const candidate of [
    '/Applications/Codex.app/Contents/Resources/codex',
    '/Applications/Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
  ]){const executable=resolveExecutable(candidate,{...options,env,platform});if(executable)return executable;}
  return null;
}
