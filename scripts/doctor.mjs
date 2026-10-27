import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import '../server/environment.mjs';
import {resolveCodexExecutable} from '../server/executable-paths.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),checks=[];
const add=(name,status,detail)=>checks.push({name,status,detail});
add('Node.js',(v=>v[0]>22||(v[0]===22&&v[1]>=13))(process.versions.node.split('.').map(Number))?'ok':'error',process.versions.node+' (requires 22.13+)');
for(const name of ['openai','@openai/agents','@anthropic-ai/sdk','@anthropic-ai/claude-agent-sdk','@modelcontextprotocol/sdk','zod']) {
  try{require.resolve(name==='@modelcontextprotocol/sdk'?'@modelcontextprotocol/sdk/client/index.js':name);add(name,'ok','Project dependency installed');}catch{add(name,'error','Missing dependency; run npm ci in this checkout');}
}
add('Codex',resolveCodexExecutable()?'ok':'optional',resolveCodexExecutable()?'Executable detected; authentication and protocol still need testing':'Install Codex on PATH or set MBSE_CODEX_PATH; Claude Code is an alternative');
try{require.resolve('playwright');add('Browser automation','optional','Playwright package detected; Chromium/Chrome installation must be checked separately');}catch{add('Browser automation','optional','Install optional Playwright dependencies only if needed');}
const kernel=path.join(root,'toolchains/sysml/package');add('SysML kernel',fs.existsSync(path.join(kernel,'package.json'))?'ok':'error','Pinned package must remain inside the checkout');
const vm=process.env.MANTA_NOS3_VM_ROOT;
if(!vm)add('Professional runners','optional','No VM configured. Basic chat, documents and SysML remain available; see docs/installation.md for runner limits.');
else {const missing=['host/vm-prepare.sh','worker/native-inputs.json',...Object.keys(JSON.parse(fs.readFileSync(path.join(root,'vm/worker/native-inputs.json'))).stagedFiles).map(x=>'handoff/'+x)].filter(x=>!fs.existsSync(path.join(vm,x)));add('Professional runners',missing.length?'optional':'ok',missing.length?'Configured VM lacks frozen input assets; use an explicitly provisioned runner. Missing: '+missing.join(', '):'Frozen input files detected; preparation and runtime integrity still need verification');}
for(const c of checks)console.log(c.status.toUpperCase().padEnd(8)+' '+c.name+': '+c.detail);
console.log('Doctor inspects dependencies and configuration only. It does not read keys, call a model, start a VM, or install software.');
if(checks.some(c=>c.status==='error'))process.exitCode=1;
