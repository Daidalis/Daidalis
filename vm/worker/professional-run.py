#!/usr/bin/env python3
"""Fixed guest bridge. Model/compiler code runs in a networkless, filesystem-isolated bubblewrap."""
import base64, datetime, hashlib, json, math, os, pathlib, re, resource, signal, shutil, subprocess, sys, time
ROOT=pathlib.Path('/srv/manta/professional')
JOBS=ROOT/'jobs'; CANCEL=ROOT/'cancelled'
IDENT=re.compile(r'^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$')
JOB=re.compile(r'^[A-Za-z0-9_-]{8,100}$')
SHA=re.compile(r'^[a-f0-9]{64}$')
MAX_INPUT=8*1024*1024
SIGNAL_BASE=r'[A-Za-z_][A-Za-z0-9_]*(?:\[-?\d+(?:,-?\d+)*\])?(?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[-?\d+(?:,-?\d+)*\])?)*'
SIGNAL=re.compile(r'^(?:'+SIGNAL_BASE+r'|(?:der|pre)\('+SIGNAL_BASE+r'\))$')

def digest(b): return hashlib.sha256(b).hexdigest()
def valid_job(s):
 if not isinstance(s,str) or not JOB.fullmatch(s): raise ValueError('Invalid professional job identifier')
 return s

def stop(job):
 valid_job(job); CANCEL.mkdir(parents=True,exist_ok=True); (CANCEL/job).write_text('cancelled\n')
 file=JOBS/job/'process.json'
 if file.is_file():
  p=json.loads(file.read_text()); pid=p.get('pid')
  try:
   cmd=(pathlib.Path('/proc')/str(pid)/'cmdline').read_bytes()
   if b'/usr/bin/bwrap' in cmd and str(JOBS/job).encode() in cmd: os.killpg(pid,signal.SIGTERM)
  except ProcessLookupError: pass
  except FileNotFoundError: pass
 print(json.dumps({'jobId':job,'cancelled':True}))

def limits():
 resource.setrlimit(resource.RLIMIT_CPU,(600,605)); resource.setrlimit(resource.RLIMIT_FSIZE,(128*1024*1024,128*1024*1024));resource.setrlimit(resource.RLIMIT_NOFILE,(256,256))

def main(req):
 job=valid_job(req.get('jobId')); operation=req.get('operation','simulate'); model=req.get('modelName')
 if operation not in ('check','simulate') or not isinstance(model,str) or not IDENT.fullmatch(model): raise ValueError('Invalid operation or model name')
 input_hash=req.get('inputHash')
 if not isinstance(input_hash,str) or not SHA.fullmatch(input_hash): raise ValueError('A pinned input hash is required')
 files=req.get('sourceFiles')
 if not isinstance(files,list) or not 1<=len(files)<=100: raise ValueError('Expected 1 to 100 project Modelica sources')
 normalized=[]; seen=set(); total=0
 for item in files:
  rel=item.get('path'); content=item.get('content'); declared=item.get('sha256')
  if not isinstance(rel,str) or '\\' in rel or '\x00' in rel or pathlib.PurePosixPath(rel).is_absolute() or any(x in ('','..','.') for x in rel.split('/')) or not rel.endswith('.mo') or not re.fullmatch(r'[A-Za-z0-9_./ -]{1,240}',rel): raise ValueError('Invalid Modelica source path')
  if rel in seen or not isinstance(content,str): raise ValueError('Duplicate source path or invalid content')
  seen.add(rel); data=content.encode();total+=len(data)
  if len(data)>2*1024*1024 or total>5*1024*1024: raise ValueError('Source size limit exceeded')
  if declared!=digest(data): raise ValueError('Modelica source hash mismatch')
  normalized.append((rel,data,declared))
 signals=req.get('signals') or []
 if not isinstance(signals,list) or len(signals)>100 or any(not isinstance(name,str) or len(name)>300 or not SIGNAL.fullmatch(name) for name in signals):raise ValueError('Output signals require at most 100 dotted variable names with numeric array indices')
 signals=sorted(set(signals))
 parameters=req.get('parameters') or {}
 if not isinstance(parameters,dict) or len(parameters)>100: raise ValueError('Invalid parameter map')
 for name,value in parameters.items():
  if not IDENT.fullmatch(name) or not isinstance(value,(int,float,bool)) or not isinstance(value,bool) and not math.isfinite(value): raise ValueError('Parameters must be finite scalar numeric model identifiers')
 s=req.get('simulation') or {};start=s.get('startTime',0);stop_time=s.get('stopTime',100);intervals=s.get('numberOfIntervals',500);tolerance=s.get('tolerance',1e-6)
 if any(isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) for x in (start,stop_time,tolerance)) or start>=stop_time or stop_time-start>365*86400 or not 1e-12<=tolerance<=.1 or isinstance(intervals,bool) or not isinstance(intervals,int) or not 2<=intervals<=20000: raise ValueError('Invalid bounded simulation settings')
 JOBS.mkdir(parents=True,exist_ok=True);CANCEL.mkdir(parents=True,exist_ok=True)
 if (CANCEL/job).exists(): return {'exitCode':130,'success':False,'diagnostics':'Cancelled before execution','files':[]}
 directory=JOBS/job
 if directory.exists():
  previous=json.loads((directory/'request.json').read_text())
  if previous!=req: raise ValueError('Job identifier already belongs to different pinned input')
  if (directory/'result.json').is_file(): return json.loads((directory/'result.json').read_text())
  raise ValueError('Job is already running or was interrupted; use a new job identifier')
 directory.mkdir(mode=0o700); (directory/'request.json').write_text(json.dumps(req))
 work=directory/'work';work.mkdir(mode=0o700);(work/'home').mkdir()
 for rel,data,declared in normalized:
  dest=work/'sources'/rel;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
 # Data becomes only quoted loadFile paths or strict numeric identifier arguments, never shell text.
 lines=['setCommandLineOptions("--std=3.4");','loadModel(Modelica);','writeFile("library-errors.txt", getErrorString());']
 for rel,data,declared in sorted(normalized,key=lambda f:(f[0].count('/'),not f[0].endswith('package.mo'),f[0])):
  lines.append('loadFile('+json.dumps('/work/sources/'+rel)+');')
 lines+=['writeFile("load-errors.txt",getErrorString());','writeFile("check.txt",checkModel('+model+'));','writeFile("check-errors.txt",getErrorString());']
 if operation=='simulate':
  flags=','.join(k+'='+('true' if v else 'false') if isinstance(v,bool) else k+'='+repr(v) for k,v in sorted(parameters.items()))
  simflags='-override='+flags if flags else ''
  variable_filter='^(time|'+('|'.join(re.escape(name) for name in signals))+')$' if signals else '.*'
  lines+=['simulate('+model+', startTime='+repr(start)+', stopTime='+repr(stop_time)+', numberOfIntervals='+str(intervals)+', tolerance='+repr(tolerance)+', outputFormat="csv", fileNamePrefix="manta_result", variableFilter='+json.dumps(variable_filter)+', simflags='+json.dumps(simflags)+');','getErrorString();']
 (work/'run.mos').write_text('\n'.join(lines)+'\n')
 command=['/usr/bin/bwrap','--unshare-all','--die-with-parent','--new-session']
 for mount in ('/usr','/lib','/lib64','/bin','/etc'):
  if pathlib.Path(mount).exists():command+=['--ro-bind',mount,mount]
 command+=['--dev','/dev','--proc','/proc','--tmpfs','/tmp','--bind',str(work),'/work','--ro-bind',str(work/'sources'),'/work/sources','--chdir','/work','--setenv','HOME','/work/home','--setenv','PATH','/usr/bin:/bin','--setenv','LANG','C.UTF-8','/usr/bin/omc','run.mos']
 begin=datetime.datetime.now(datetime.timezone.utc).isoformat(); start_clock=time.monotonic()
 child=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'},preexec_fn=limits)
 (directory/'process.json').write_text(json.dumps({'pid':child.pid,'jobId':job}))
 def terminate(signum,frame):
  try: os.killpg(child.pid,signal.SIGTERM)
  except ProcessLookupError:pass
  raise RuntimeError('Professional job cancelled')
 signal.signal(signal.SIGTERM,terminate);signal.signal(signal.SIGHUP,terminate)
 try: out,err=child.communicate(timeout=660)
 except subprocess.TimeoutExpired:
  os.killpg(child.pid,signal.SIGKILL);out,err=child.communicate();err+=b'\nProfessional tool execution exceeded 660 seconds.'
 finally: (directory/'process.json').unlink(missing_ok=True)
 (work/'compiler.log').write_bytes(out+b'\n'+err)
 def txt(name):return (work/name).read_text(errors='replace') if (work/name).is_file() else ''
 check='completed successfully' in txt('check.txt')
 result_path=txt('simulation-result.txt').strip();csvfile=work/'manta_result_res.csv'
 success=child.returncode==0 and check and (operation=='check' or b'The simulation finished successfully.' in out and csvfile.is_file() and csvfile.stat().st_size>20)
 if (CANCEL/job).exists():success=False
 version=subprocess.check_output(['/usr/bin/omc','--version'],text=True).strip()
 receipt={'schema':'manta-professional-execution-v1','jobId':job,'inputHash':input_hash,'operation':operation,'modelName':model,'sourceFiles':[{'path':rel,'sha256':h} for rel,data,h in normalized],'parameters':parameters,'signals':signals,'variableFilter':variable_filter if operation=='simulate' else None,'simulation':{'startTime':start,'stopTime':stop_time,'numberOfIntervals':intervals,'tolerance':tolerance},'tool':{'id':'openmodelica','version':version},'startedAt':begin,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'durationSeconds':time.monotonic()-start_clock,'exitCode':child.returncode,'success':success,'isolation':'Linux VM; bubblewrap unshare-all; no network; host and other guest jobs inaccessible','argv':['omc','run.mos'],'checkSuccess':check}
 wanted=['run.mos','compiler.log','library-errors.txt','load-errors.txt','check.txt','check-errors.txt','simulation-result.txt','simulation-messages.txt','simulation-errors.txt']
 if csvfile.exists():wanted+=['manta_result_res.csv']
 accepted=[];omitted=[];total=0
 for rel in wanted:
  file=work/rel
  if not file.is_file():continue
  size=file.stat().st_size
  if size>12*1024*1024 or total+size>16*1024*1024-256*1024:omitted.append({'path':rel,'bytes':size});continue
  accepted.append(rel);total+=size
 export_message=''
 if omitted:
  export_message='Native OpenModelica finished, but result export exceeded the fixed 12 MB per-file / 16 MB total limit. Select explicit output signals (signals:["stateOfCharge","temperature"]) and rerun; criterion variables must be included. Full native outputs remain in the isolated job. Omitted: '+json.dumps(omitted)
  receipt['solverSucceeded']=success;success=False;receipt['success']=False;receipt['exportComplete']=False;receipt['omittedFiles']=omitted
  (work/'export-error.txt').write_text(export_message+'\n');accepted+=['export-error.txt']
 else:receipt['exportComplete']=True
 (work/'execution-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');accepted+=['execution-receipt.json']
 exported=[]
 for rel in accepted:
  b=(work/rel).read_bytes()
  exported.append({'path':rel,'sha256':digest(b),'contentBase64':base64.b64encode(b).decode(),'mimeType':'text/csv' if rel.endswith('.csv') else 'application/json' if rel.endswith('.json') else 'text/plain'})
 diagnostics='\n'.join(txt(n) for n in ('load-errors.txt','check.txt','check-errors.txt','simulation-messages.txt','simulation-errors.txt','compiler.log'))[-16000:]+('\n'+export_message if export_message else '')
 result={'exitCode':child.returncode,'success':success,'tool':receipt['tool'],'diagnostics':diagnostics,'receipt':receipt,'files':exported}
 (directory/'result.json').write_text(json.dumps(result))
 # The immutable input/result and native artifacts remain; avoid retaining a 154 MB extracted MSL copy for every job.
 home=work/'home'
 if home.is_symlink():home.unlink()
 elif home.is_dir():shutil.rmtree(home)
 return result

try:
 if len(sys.argv)==3 and sys.argv[1]=='--cancel':stop(sys.argv[2])
 else:
  data=sys.stdin.buffer.read(MAX_INPUT+1)
  if len(data)>MAX_INPUT:raise ValueError('Professional request exceeds input limit')
  print(json.dumps(main(json.loads(data))))
except Exception as error:
 print(json.dumps({'exitCode':1,'success':False,'diagnostics':str(error),'files':[]}));sys.exit(0)
