#!/usr/bin/env python3
"""Fixed native STF LC/SC/EPS recipe. Untrusted table compilation and all mission
processes execute in a guest bubblewrap namespace without worker/home/NAS access.
The controller records only actual outputs; numerical/SIL checks are not hardware acceptance.
"""
import pathlib,sys,json,hashlib,os,signal,subprocess,base64,gzip,csv,time,re,fcntl,shutil,resource
ROOT=pathlib.Path('/srv/manta/stf-low-power');STATE=pathlib.Path('/srv/manta/stf-native-jobs');STATE.mkdir(exist_ok=True,mode=0o700)
sha=lambda b:hashlib.sha256(b).hexdigest()
CONTROLLER_SHA=sha(pathlib.Path(__file__).read_bytes())
children=[];cancelled=False

def stop(signum,frame):
 global cancelled;cancelled=True
 for child in children:
  try:os.killpg(child.pid,signal.SIGTERM)
  except ProcessLookupError:pass
 raise RuntimeError('Native STF job cancelled')
signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)

def valid_job(value):return isinstance(value,str) and re.fullmatch(r'[A-Za-z0-9_-]{8,100}',value)
if len(sys.argv)==3 and sys.argv[1]=='--cancel':
 job=sys.argv[2]
 if not valid_job(job):raise SystemExit(2)
 try:
  record=json.loads((STATE/(job+'.json')).read_text());pid=record['pid']
  if record['jobId']==job and record['uid']==os.getuid() and pid>1:os.kill(pid,signal.SIGTERM)
 except (FileNotFoundError,ProcessLookupError):pass
 print(json.dumps({'cancelRequested':True,'jobId':job}));raise SystemExit(0)
if len(sys.argv)==2 and sys.argv[1]=='--status':
 try:
  receipt=json.loads((ROOT/'ready.json').read_text());receipt['ready']=all(sha(pathlib.Path(f['path']).read_bytes())==f['sha256'] for f in receipt['binaries']);print(json.dumps(receipt))
 except Exception as error:print(json.dumps({'ready':False,'reason':str(error),'tool':{'id':'nos3-stf','version':'unprepared'}}))
 raise SystemExit(0)

request=json.load(sys.stdin)
job=request.get('jobId');input_hash=request.get('inputHash');source_files=request.get('sourceFiles')
if not valid_job(job) or not isinstance(input_hash,str) or not re.fullmatch(r'[a-f0-9]{64}',input_hash):raise RuntimeError('Invalid native STF job or input hash')
if request.get('operation') not in ['check','simulate']:raise RuntimeError('Unsupported native STF operation')
if not isinstance(source_files,list) or not 2<=len(source_files)<=20:raise RuntimeError('Expected manifest and native table sources')
seen=set();total=0
for source in source_files:
 name=source.get('path');content=source.get('content')
 if not isinstance(name,str) or not re.fullmatch(r'[A-Za-z0-9_./ -]{1,240}',name) or any(p in ['', '.', '..'] for p in name.split('/')) or name.startswith('/') or name in seen or not isinstance(content,str):raise RuntimeError('Invalid native source path')
 data=content.encode();total+=len(data)
 if len(data)>2000000 or total>5000000 or sha(data)!=source.get('sha256'):raise RuntimeError('Native input source hash mismatch')
 seen.add(name)
manifests=[f for f in source_files if f['path'].endswith('.stf.json')]
if len(manifests)!=1:raise RuntimeError('Exactly one native STF manifest required')
manifest=json.loads(manifests[0]['content'])
if manifest.get('schema')!='manta-stf-native-case-v1' or manifest.get('caseType')!='stf-low-power' or manifest.get('recipeVersion')!=1:raise RuntimeError('Unsupported native STF case manifest')
if manifest.get('upstream',{}).get('nos3')!='5a3bdee6be9a2c67fdf994ae6db56d5c60395302':raise RuntimeError('Unsupported native NOS3 source baseline')
apply=request.get('parameters',{}).get('applyProtection',True)
if not isinstance(apply,bool):raise RuntimeError('applyProtection must be boolean')
if set(request.get('parameters',{}))-{'applyProtection'}:raise RuntimeError('Unsupported native STF parameter')
variant='modified' if apply else 'original';expected={f['path']:f for f in manifest.get('sourceFiles',[]) if f.get('variant')==variant}
required={'lc_def_wdt.c','lc_def_adt.c','sc_rts003.c','sc_rts026.c','sc_rts029.c'}|({'sc_rts015.c'} if apply else set())
selected={}
for relative,item in expected.items():
 matches=[source for source in source_files if source['path']==relative or source['path'].endswith('/'+relative)]
 if len(matches)!=1 or matches[0]['sha256']!=item.get('sha256'):raise RuntimeError('Manifest/source mismatch: '+relative)
 name=pathlib.PurePosixPath(relative).name
 if name not in required or name in selected:raise RuntimeError('Unexpected native table source')
 selected[name]=matches[0]
if set(selected)!=required:raise RuntimeError('Native STF table set is incomplete')
if not apply:
 for name,source in selected.items():
  if sha((ROOT/'cfg/nos3_defs/tables'/name).read_bytes())!=source['sha256']:raise RuntimeError('Original baseline differs from pinned upstream source: '+name)
statefile=STATE/(job+'.json');statefile.write_text(json.dumps({'jobId':job,'pid':os.getpid(),'uid':os.getuid(),'inputHash':input_hash}));out=ROOT/'runs'/job
out.mkdir(parents=True,exist_ok=False);executions=[];files=[];diagnostics='';tool={'id':'nos3-stf','version':'NOS3 STF 5a3bdee6 / LC 5daef363 / SC 4ff66c2b / EPS 1aad1993'}

def file_entry(p,name=None):
 data=p.read_bytes();return {'path':name or p.name,'sha256':sha(data),'contentBase64':base64.b64encode(data).decode(),'mimeType':'text/csv' if p.suffix=='.csv' else 'application/json' if p.suffix=='.json' else 'application/gzip' if p.suffix=='.gz' else 'text/plain'}

def sandbox(command,runtime=False):
 args=['/usr/bin/bwrap','--unshare-all','--die-with-parent','--new-session','--ro-bind','/usr','/usr','--ro-bind','/bin','/bin','--ro-bind','/lib','/lib','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--dir','/etc','--ro-bind','/etc/ld.so.cache','/etc/ld.so.cache','--ro-bind',str(ROOT/'runtime-hosts'),'/etc/hosts','--ro-bind','/etc/nsswitch.conf','/etc/nsswitch.conf','--ro-bind','/etc/alternatives','/etc/alternatives','--bind',str(ROOT),str(ROOT),'--clearenv','--setenv','PATH','/usr/bin:/bin','--setenv','LANG','C.UTF-8','--setenv','HOME','/tmp','--setenv','TMPDIR','/tmp','--chdir',str(ROOT)]
 if runtime:args+=['--bind','/dev/mqueue','/dev/mqueue','--ro-bind','/srv/manta/42','/srv/manta/42','--ro-bind','/srv/manta/42-assets','/srv/manta/42-assets']
 else:args+=['--setenv','CFS_APP_PATH','../components','--setenv','MISSION_DEFS','../cfg/build/','--setenv','MISSIONCONFIG','../cfg/build/nos3']
 return args+command

def limits():
 resource.setrlimit(resource.RLIMIT_AS,(3*1024**3,3*1024**3));resource.setrlimit(resource.RLIMIT_CPU,(240,240));resource.setrlimit(resource.RLIMIT_FSIZE,(128*1024**2,128*1024**2));resource.setrlimit(resource.RLIMIT_NOFILE,(512,512))

def execute(label,command,runtime=False,timeout=180):
 log=out/(label+'.log');argv=sandbox(command,runtime)
 with log.open('wb') as handle:
  child=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=handle,stderr=subprocess.STDOUT,start_new_session=True,preexec_fn=limits);children.append(child)
  try:code=child.wait(timeout=timeout)
  except subprocess.TimeoutExpired:
   os.killpg(child.pid,signal.SIGTERM)
   try:child.wait(timeout=8)
   except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
   raise RuntimeError(label+' timed out')
  finally:children.remove(child)
 executions.append({'label':label,'argv':command,'exitCode':code,'log':log.name,'sandbox':'guest bubblewrap: private network/process/user/IPC namespaces; no host mounts, worker secrets or home'})
 if code:raise RuntimeError(label+' failed exit '+str(code)+': '+log.read_text(errors='replace')[-3000:])

checks=[];success=False;criteria_passed=None;exit_code=1
try:
 with (ROOT/'native-run.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  # The only mutable source locations are the exact six known mission table files.
  target=ROOT/'cfg/build/nos3_defs/tables'
  for name in required:(target/name).write_text(selected[name]['content'])
  if not apply and (target/'sc_rts015.c').exists():(target/'sc_rts015.c').unlink()
  tools=ROOT/'tools';tools.mkdir(exist_ok=True);campaign=pathlib.Path(__file__).with_name('stf-low-power-campaign.py');shutil.copyfile(campaign,tools/'campaign.py')
  sim_input=ROOT/'42run/InOut/Inp_Sim.txt';sim_text=sim_input.read_text();sim_text=re.sub(r'^120\.0\s+0\.01','180.0  0.01',sim_text,flags=re.M);sim_input.write_text(sim_text)
  (ROOT/'runtime-hosts').write_text('127.0.0.1 localhost fortytwo nos-engine-server sc01-nos-engine-server nos-fsw truth42sim\n::1 localhost\n')
  execute('isolation-probe',['python3','-c',"import os,json,socket; paths=['/home/manta/.ssh','/srv/manta/worker/config.json','/mnt/manta-transfer']; visible={p:os.path.exists(p) for p in paths}; assert not any(visible.values()); assert os.getuid()!=0; sock=socket.socket(); sock.settimeout(.3); code=sock.connect_ex(('127.0.0.1',8093)); assert code!=0; print(json.dumps({'uid':os.getuid(),'protectedPathsVisible':visible,'workerPortReachable':False,'networkNamespace':os.readlink('/proc/self/ns/net')}))"],runtime=True,timeout=15)
  execute('configure',['cmake','-S','fsw/cfe','-B','fsw/build'],timeout=120)
  execute('native-build',['cmake','--build','fsw/build','--target','mission-install','--parallel','4'],timeout=180)
  ready_file=ROOT/'ready.json';ready=json.loads(ready_file.read_text());
  for entry in ready['binaries']:entry['sha256']=sha(pathlib.Path(entry['path']).read_bytes())
  ready_file.write_text(json.dumps(ready,indent=2))
  table_hashes=[]
  for name in sorted(required):
   binary=ROOT/'fsw/build/exe/cpu1/cf'/name.replace('.c','.tbl');table_hashes.append({'source':name,'binary':binary.name,'sha256':sha(binary.read_bytes())})
  (out/'compiled-tables.json').write_text(json.dumps(table_hashes,indent=2))
  if request['operation']=='simulate':
   campaign_out=out/'campaign';execute('native-simulation',['python3',str(tools/'campaign.py'),'--output',str(campaign_out),'--duration','96'],runtime=True,timeout=150)
   rows=list(csv.DictReader((campaign_out/'eps-telemetry.csv').open()))
   for phase,lower_time,key in [('above_critical',32,'above-critical-preserved'),('below_critical',46,'critical-safe-all-off'),('reentry_above',77,'reentry-preserved'),('reentry_critical',91,'reentry-rearms')]:
    points=[r for r in rows if r['phase']==phase and float(r['time'])>=lower_time];last=points[-5:]
    if phase in ['above_critical','reentry_above']:passed=bool(len(last)>=3 and all(int(r['mode'])==3 and int(r['switch7'])==170 and int(r['batteryMillivolts'])>=23760 for r in last))
    else:passed=bool(len(last)>=3 and all(int(r['mode'])==1 and all(int(r['switch'+str(i)])==0 for i in range(8)) and int(r['batteryMillivolts'])<23760 for r in last))
    checks.append({'id':key,'criterion':next((c['criterion'] for c in manifest.get('expectedChecks',[]) if c['id']==key),key),'passed':passed,'samples':len(points),'actual':last[-1] if last else None,'scope':'Observed native EPS I2C telemetry and actual MGR mode in selected software integration scenario'})
   run=json.loads((campaign_out/'run.json').read_text());checks.insert(0,{'id':'native-data','criterion':'Actual EPS HK packets, MGR HK packets, 42 and EPS simulator/cFS processes executed','passed':run['rows']>=100 and run['counts'].get('0x91a',0)>=100 and run['counts'].get('0x8f8',0)>=50,'actual':{'rows':run['rows'],'counts':run['counts']}})
   criteria_passed=all(c['passed'] for c in checks);success=True
  else:success=True
  exit_code=0
except Exception as error:diagnostics=str(error);success=False
finally:
 statefile.unlink(missing_ok=True)
 for child in children:
  try:os.killpg(child.pid,signal.SIGKILL)
  except ProcessLookupError:pass
 scope='Actual selected NOS3 LC/SC/EPS/MGR/SAMPLE/42 software integration with CI test scheduling. Full mission scheduler, all-device integration and physical qualification remain unverified.'
 verification={'schema':'manta-stf-native-verification-v1','case':'stf-low-power','variant':variant,'passed':criteria_passed,'checks':checks,'scope':scope,'unverified':manifest.get('unverified',[]),'executions':executions}
 (out/'verification.json').write_text(json.dumps(verification,indent=2))
 for p in sorted(out.rglob('*')):
  if not p.is_file():continue
  relative=str(p.relative_to(out))
  if p.suffix=='.log' or p.name=='packets.jsonl':
   data=p.read_bytes();compressed=gzip.compress(data,mtime=0);files.append({'path':relative+'.gz','sha256':sha(compressed),'contentBase64':base64.b64encode(compressed).decode(),'mimeType':'application/gzip'})
   if p.suffix=='.log':files.append({'path':relative,'sha256':sha(data[-200000:]),'contentBase64':base64.b64encode(data[-200000:]).decode(),'mimeType':'text/plain'})
  else:files.append(file_entry(p,relative))
 receipt={'schema':'manta-stf-native-receipt-v1','jobId':job,'inputHash':input_hash,'sourceFiles':[{'path':f['path'],'sha256':f['sha256']} for f in source_files],'variant':variant,'tool':tool,'executions':executions,'scope':scope,'hardwareValidation':False,'fullStfMission':False,'controllerSha256':CONTROLLER_SHA,'campaignSha256':sha((ROOT/'tools/campaign.py').read_bytes()),'prepareRecipeSha256':json.loads((ROOT/'ready.json').read_text()).get('prepareRecipeSha256'),'unverified':manifest.get('unverified',[])}
 print(json.dumps({'exitCode':exit_code,'success':success,'tool':tool,'diagnostics':diagnostics or ('Native STF scenario completed; '+str(sum(c['passed'] for c in checks))+'/'+str(len(checks))+' observed checks passed'),'receipt':receipt,'verification':{'status':'passed' if criteria_passed is True else 'failed' if criteria_passed is False else 'not-requested' if success else 'unknown','checks':checks},'files':files}))
