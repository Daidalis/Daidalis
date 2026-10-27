#!/usr/bin/env python3
import hashlib,json,os,pathlib,shutil,subprocess,sys,tarfile,time,urllib.request
root=pathlib.Path('/srv/manta/worker'); root.mkdir(mode=0o700,exist_ok=True)
if not pathlib.Path('/srv/manta/nos3/fsw/build/exe/cpu1/core-cpu1').is_file():
 raise RuntimeError('Native NOS3 build is not ready. Run the fixed guest provisioning/build recipe first.')
request=json.loads(sys.stdin.read(4096))
token=request.get('token'); port=request.get('port',8093)
if not isinstance(token,str) or len(token)<32 or len(token)>128 or port!=8093:
 raise RuntimeError('Invalid private worker configuration')
lock=root/'node-provenance.json'
if lock.exists():
 provenance=json.loads(lock.read_text()); version=provenance['version'];archive='node-v'+version+'-linux-arm64.tar.xz';expected=provenance['sha256']
else:
 checks=urllib.request.urlopen('https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt',timeout=40).read().decode()
 selected=next(line.split() for line in checks.splitlines() if line.split()[-1].endswith('-linux-arm64.tar.xz'))
 expected,archive=selected;version=archive.removeprefix('node-v').removesuffix('-linux-arm64.tar.xz')
 if not version.startswith('22.'):raise RuntimeError('Unexpected Node major version')
node=root/('node-v'+version+'-linux-arm64')/'bin/node'
if not node.is_file():
 base='https://nodejs.org/dist/v'+version+'/'
 target=root/archive
 with urllib.request.urlopen(base+archive,timeout=120) as incoming,target.open('wb') as output: shutil.copyfileobj(incoming,output)
 actual=hashlib.sha256(target.read_bytes()).hexdigest()
 if actual!=expected: target.unlink();raise RuntimeError('Official Node archive integrity mismatch')
 with tarfile.open(target) as tar:
  for item in tar.getmembers():
   resolved=(root/item.name).resolve()
   if not resolved.is_relative_to(root):raise RuntimeError('Unsafe runtime archive path')
  tar.extractall(root)
 target.unlink()
 lock.write_text(json.dumps({'version':version,'url':base+archive,'sha256':actual},indent=2))
source=pathlib.Path('/mnt/manta-transfer/worker/bundle')
app=root/'bundle'
# Copy only the reviewed runtime bundle; no npm install or global Node setup.
for rel in ['runners/nos3/worker.mjs','runners/nos3/native-worker.mjs','runners/nos3/native-adapter.mjs','server/nos3/core.mjs','server/sandbox.mjs','runners/nos3/quaternion-harness.c']:
 destination=app/rel; destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source/rel,destination)
inventoryHash=hashlib.sha256(pathlib.Path('/mnt/manta-transfer/source/integrity.json').read_bytes()).hexdigest()
bundleHash=hashlib.sha256(b''.join((app/rel).read_bytes() for rel in ['runners/nos3/worker.mjs','runners/nos3/native-worker.mjs','runners/nos3/native-adapter.mjs','server/nos3/core.mjs','server/sandbox.mjs'])).hexdigest()
config={'runtimeBundleSha256':bundleHash,'sourceInventorySha256':inventoryHash,'token':token,'sourceRoot':'/mnt/manta-transfer/source','toolRoot':'/mnt/manta-transfer','workRoot':'/srv/manta/nos3'}
configfile=root/'config.json';previous=json.loads(configfile.read_text()) if configfile.exists() else {}
if previous.get('sourceInventorySha256') and previous['sourceInventorySha256']!=inventoryHash:raise RuntimeError('Source inventory changed after provisioning; refusing to silently repin the source')
def health():
 try:
  req=urllib.request.Request('http://127.0.0.1:8093/health',headers={'Authorization':'Bearer '+token})
  with urllib.request.urlopen(req,timeout=3) as response:return json.load(response)
 except Exception:return None
if previous==config and health():
 print(json.dumps({'ready':True,'reused':True,'schema':'manta-nos3-worker-v1','port':8093}));sys.exit(0)
pidfile=root/'worker.pid'
if pidfile.exists():
 pid=int(pidfile.read_text())
 try:
  command=pathlib.Path('/proc')/str(pid)/'cmdline'
  if str(app/'runners/nos3/native-worker.mjs') not in command.read_bytes().decode(errors='replace'):raise RuntimeError('Recorded worker PID belongs to another process')
  os.kill(pid,15)
  for unused in range(30):
   if not command.exists():break
   time.sleep(.1)
 except FileNotFoundError:pass
configfile.write_text(json.dumps(config));configfile.chmod(0o600)
(root/'home').mkdir(exist_ok=True);(root/'tmp').mkdir(exist_ok=True)
with (root/'worker.log').open('ab',buffering=0) as output:
 child=subprocess.Popen([str(node),str(app/'runners/nos3/native-worker.mjs')],cwd=root,env={'PATH':'/usr/bin:/bin','HOME':str(root/'home'),'TMPDIR':str(root/'tmp'),'LANG':'C.UTF-8'},stdin=subprocess.DEVNULL,stdout=output,stderr=output,start_new_session=True)
pidfile.write_text(str(child.pid))
for unused in range(80):
 result=health()
 if result and result.get('schema')=='manta-nos3-worker-v1' and result.get('scopes',{}).get('integration'):
  print(json.dumps({'ready':True,'reused':False,'schema':result['schema'],'port':8093}));sys.exit(0)
 if child.poll() is not None:raise RuntimeError('Native NOS3 worker exited; see guest /srv/manta/worker/worker.log')
 time.sleep(.25)
raise RuntimeError('Native NOS3 worker readiness timeout')
