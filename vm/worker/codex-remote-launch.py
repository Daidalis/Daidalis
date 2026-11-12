#!/usr/bin/env python3
"""Run native Codex with only one shared project and a private session home visible."""

def _vm_name_path(value):
    # The SSH transport supplies roots from its fixed existing/new VM profiles.
    import os
    for prefix, key in (('/srv/daidalis', 'DAIDALIS_VM_ROOT'),
                        ('/mnt/daidalis-transfer', 'DAIDALIS_VM_TRANSFER'),
                        ('/home/daidalis', 'DAIDALIS_VM_HOME')):
        value = value.replace(prefix, os.environ.get(key, prefix))
    return value

import os
import pathlib
import re
import sys
import json

handshake=bytearray()
while len(handshake)<10000:
 byte=os.read(0,1)
 if not byte:raise SystemExit('Missing private transport handshake')
 if byte==b'\n':break
 handshake.extend(byte)
else:raise SystemExit('Private transport handshake exceeds limit')
secret=json.loads(handshake)
if not isinstance(secret,dict) or set(secret)-{'keyName','keyValue'}:raise SystemExit('Invalid private transport handshake')
key_name=secret.get('keyName','')
key_value=secret.get('keyValue','')
if key_name and (not re.fullmatch(r'DAIDALIS_CODEX_KEY_[A-F0-9]{32}',key_name) or not isinstance(key_value,str) or not key_value or len(key_value)>8000):raise SystemExit('Invalid private key channel')

if len(sys.argv)!=2 or not re.fullmatch(r'[A-Za-z0-9_-]{8,100}',sys.argv[1]):raise SystemExit('Invalid isolated project identifier')
slug=sys.argv[1]
shared=pathlib.Path(_vm_name_path('/mnt/daidalis-transfer/eval-workspaces')).resolve(strict=True)
workspace=shared/slug
if workspace.is_symlink() or workspace.resolve(strict=True)!=workspace or not workspace.is_dir():raise SystemExit('Project folder is unavailable or redirected')
session=pathlib.Path(_vm_name_path('/srv/daidalis/agent-eval/sessions'))/slug
session.mkdir(parents=True,mode=0o700,exist_ok=True)
if session.is_symlink() or session.resolve()!=session:raise SystemExit('Private session folder is redirected')
(session/'.codex').mkdir(mode=0o700,exist_ok=True)
node=_vm_name_path('/srv/daidalis/worker/node-v22.23.4-linux-arm64')
packages=_vm_name_path('/srv/daidalis/agent-eval/node_modules')
if not pathlib.Path(node+'/bin/node').is_file() or not pathlib.Path(packages+'/@openai/codex/bin/codex.js').is_file():raise SystemExit('Pinned native Codex runtime is unavailable')
env={'PATH':'/opt/node/bin:/usr/bin:/bin','LANG':'C.UTF-8','HOME':_vm_name_path('/home/daidalis'),'CODEX_HOME':_vm_name_path('/home/daidalis/.codex'),'TMPDIR':'/tmp'}
if key_name:env[key_name]=key_value
cmd=['/usr/bin/bwrap','--unshare-all','--share-net','--die-with-parent','--new-session']
for location in ['/usr','/lib','/lib64','/bin','/etc']:
 if pathlib.Path(location).exists():cmd+=['--ro-bind',location,location]
cmd+=['--ro-bind',node,'/opt/node','--ro-bind',packages,'/opt/codex/node_modules','--bind',str(workspace),'/work','--bind',str(session),_vm_name_path('/home/daidalis'),'--dev','/dev','--proc','/proc','--tmpfs','/tmp','--chdir','/work']
for name,value in env.items():
 if name.startswith('DAIDALIS_CODEX_KEY_'):continue
 cmd+=['--setenv',name,value]
cmd+=['/opt/node/bin/node','/opt/codex/node_modules/@openai/codex/bin/codex.js','app-server','--stdio','--disable','apps','--disable','plugins','--disable','hooks','--disable','multi_agent','-c','mcp_servers={}']
os.execve('/usr/bin/bwrap',cmd,env)
