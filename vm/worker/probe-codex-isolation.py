#!/usr/bin/env python3
"""Check a project-only Linux filesystem view for the native Codex app-server."""
import json
import pathlib
import select
import subprocess

root=pathlib.Path('/srv/manta/agent-eval/probe')
workspace=root/'workspace'
home=root/'home'
workspace.mkdir(parents=True,exist_ok=True)
home.mkdir(parents=True,exist_ok=True)
(home/'.codex').mkdir(exist_ok=True)
node='/srv/manta/worker/node-v22.23.4-linux-arm64'
packages='/srv/manta/agent-eval/node_modules'
cmd=['/usr/bin/bwrap','--unshare-all','--share-net','--die-with-parent','--new-session']
for location in ['/usr','/lib','/lib64','/bin','/etc']:
 if pathlib.Path(location).exists():cmd+=['--ro-bind',location,location]
cmd+=['--ro-bind',node,'/opt/node','--ro-bind',packages,'/opt/codex/node_modules','--bind',str(workspace),'/work','--bind',str(home),'/home/manta','--dev','/dev','--proc','/proc','--tmpfs','/tmp','--chdir','/work','--setenv','HOME','/home/manta','--setenv','CODEX_HOME','/home/manta/.codex','--setenv','PATH','/opt/node/bin:/usr/bin:/bin','--setenv','LANG','C.UTF-8','/opt/node/bin/node','/opt/codex/node_modules/@openai/codex/bin/codex.js','app-server','--stdio','--disable','apps','--disable','plugins','--disable','hooks','--disable','multi_agent','-c','mcp_servers={}']
process=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'})
def request(number,method,params):
 process.stdin.write(json.dumps({'id':number,'method':method,'params':params})+'\n');process.stdin.flush()
 while True:
  ready,_,_=select.select([process.stdout],[],[],15)
  if not ready:raise RuntimeError(method+' timed out')
  line=process.stdout.readline()
  if not line:raise RuntimeError(method+' closed stdout')
  frame=json.loads(line)
  if frame.get('id')==number:return frame
try:
 init=request(1,'initialize',{'clientInfo':{'name':'manta-isolation-probe','title':'Manta isolation probe','version':'0.1'},'capabilities':{'experimentalApi':True}})
 process.stdin.write(json.dumps({'method':'initialized','params':{}})+'\n');process.stdin.flush()
 started=request(2,'thread/start',{'cwd':'/work','sandbox':'read-only','approvalPolicy':'on-request','developerInstructions':'Inspect only the blank project workspace.','config':{'features.apps':False,'features.plugins':False,'features.hooks':False,'features.multi_agent':False,'mcp_servers':{}},'ephemeral':True})
 check=subprocess.run(cmd[:cmd.index('/opt/node/bin/node')]+['/bin/sh','-c','test -r /srv/manta/stf-low-power && echo LEAK || echo HIDDEN; test -d /work && echo WORKSPACE'],capture_output=True,text=True,timeout=10)
 print(json.dumps({'initialize':bool(init.get('result')),'threadStarted':bool(started.get('result',{}).get('thread',{}).get('id')),'threadError':started.get('error',{}).get('message','')[:240],'filesystem':check.stdout.strip().splitlines(),'filesystemExit':check.returncode}))
finally:
 process.terminate()
 try:process.communicate(timeout=3)
 except subprocess.TimeoutExpired:process.kill();process.communicate()
