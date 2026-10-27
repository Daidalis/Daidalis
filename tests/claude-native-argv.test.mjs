import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {query} from '@anthropic-ai/claude-agent-sdk';

const worker=fileURLToPath(new URL('../vm/worker/claude-remote-launch.py',import.meta.url));
const python=`import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('manta_claude_worker',sys.argv[1])
worker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
data=json.load(sys.stdin)
worker.validate_args(data['args'])
worker.validate_env(data['env'])
print('accepted')`;

function checkGuest(args,env){
 return spawnSync('/usr/bin/python3',['-c',python,worker],{
  input:JSON.stringify({args,env}),encoding:'utf8',timeout:5000,
 });
}

test('pinned Linux launcher accepts actual Claude Agent SDK 0.3.307 argv and rejects injected options',async()=>{
 let captured=null;
 let sdk;
 try {
 sdk=query({prompt:'Local argv capture; no model request.',options:{
  cwd:'/work',model:'claude-haiku-5-5',maxTurns:12,
  tools:{type:'preset',preset:'claude_code'},
  disallowedTools:['Agent','Task','Bash','WebFetch','WebSearch'],
  settingSources:[],settings:{apiKeyHelper:'/opt/claude/key-helper'},
  permissionMode:'default',canUseTool:async()=>({behavior:'deny',message:'fixture'}),
  env:{PATH:'/usr/bin:/bin',HOME:'/home/manta',CLAUDE_CONFIG_DIR:'/home/manta/.claude',
   ANTHROPIC_BASE_URL:'http://127.0.0.1:9',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'},
  spawnClaudeCodeProcess(options){
   captured=options;
   const child=new EventEmitter();
   child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
   child.pid=12345;child.kill=()=>true;
   setImmediate(()=>{child.stdout.end();child.stderr.end();child.emit('exit',0);child.emit('close',0);});
   return child;
  },
 }});
 for await(const _ of sdk){/* This fake process returns no model messages. */}
 } catch {/* The closed fake stream is expected to stop the SDK iterator. */}
 finally {sdk?.close();}
 assert.ok(captured,'the installed SDK did not call the custom process spawner');
 const allowed=['ANTHROPIC_BASE_URL','CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'CLAUDE_AGENT_SDK_CLIENT_APP','CLAUDE_AGENT_SDK_VERSION','CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SDK_READS_SESSION_STATE','CLAUDE_CODE_SDK_READS_STARTUP_MARKS'];
 const env=Object.fromEntries(allowed.filter(name=>captured.env[name]!==undefined).map(name=>[name,captured.env[name]]));
 assert.equal(checkGuest(captured.args,env).status,0,'actual SDK argv was rejected by the VM');
 assert.equal(checkGuest([...captured.args,'--mcp-config','/etc/passwd'],env).status,1);
 assert.equal(checkGuest(captured.args,{...env,HOME:'/Users/example'}).status,1);
 assert.ok(!JSON.stringify({args:captured.args,env}).includes('not-a-real-api-key'));
});
