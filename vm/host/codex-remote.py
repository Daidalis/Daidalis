#!/usr/bin/python3
"""Project-only SSH stdio transport for the native Linux Codex app-server."""
import os
import pathlib
import re
import subprocess
import sys
import json
import threading
import signal

base=pathlib.Path(__file__).resolve().parent.parent
state=base/'state'
slug=os.environ.get('MANTA_REMOTE_PROJECT_SLUG','')
if not re.fullmatch(r'[A-Za-z0-9_-]{8,100}',slug):raise SystemExit('Missing isolated project identifier')
if sys.argv[1:2]!=['app-server']:raise SystemExit('Only the native Codex app-server transport is supported')
socket=subprocess.check_output(['/usr/bin/python3',str(base/'host/vm-runtime.py'),str(state)],text=True).strip()
options=['-F','/dev/null','-T','-i',str(state/'id_ed25519'),'-o',f'ProxyCommand=/usr/bin/nc -U {socket}','-o',f'UserKnownHostsFile={state}/known_hosts','-o','GlobalKnownHostsFile=/dev/null','-o','HostKeyAlias=manta-nos3-local-vm','-o','StrictHostKeyChecking=yes','-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=10','-o','ServerAliveCountMax=3']
env={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','LANG':'en_US.UTF-8','HOME':os.path.expanduser('~')}
keys=[(name,value) for name,value in os.environ.items() if re.fullmatch(r'SYSPILOT_CODEX_KEY_[A-F0-9]{32}',name)]
if len(keys)>1:raise SystemExit('Only one native model key may be sent per turn')
handshake={'keyName':keys[0][0],'keyValue':keys[0][1]} if keys else {}
child=subprocess.Popen(['/usr/bin/ssh',*options,'manta@localhost',f'python3 /mnt/manta-transfer/worker/codex-remote-launch.py {slug}'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env)
def relay(source,target,close=False):
 try:
  while True:
   chunk=os.read(source.fileno(),65536)
   if not chunk:break
   target.write(chunk);target.flush()
 except (BrokenPipeError,OSError):pass
 finally:
  if close:
   try:target.close()
   except OSError:pass
def terminate(_signal,_frame):child.terminate()
signal.signal(signal.SIGTERM,terminate)
signal.signal(signal.SIGINT,terminate)
try:
 child.stdin.write(json.dumps(handshake,separators=(',',':')).encode()+b'\n');child.stdin.flush()
 incoming=threading.Thread(target=relay,args=(sys.stdin.buffer,child.stdin,True),daemon=True);incoming.start()
 errors=threading.Thread(target=relay,args=(child.stderr,sys.stderr.buffer),daemon=True);errors.start()
 relay(child.stdout,sys.stdout.buffer)
 child.wait()
 incoming.join(timeout=1);errors.join(timeout=1)
 raise SystemExit(child.returncode)
finally:
 if child.poll() is None:child.terminate()
