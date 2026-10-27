#!/usr/bin/env python3
"""Fixed ngspice/OpenSCAD native execution; all project code remains inside networkless bubblewrap."""
import base64,csv,datetime,hashlib,io,json,math,os,pathlib,re,resource,signal,subprocess,sys,time
ROOT=pathlib.Path('/srv/manta/professional');JOBS=ROOT/'jobs';CANCEL=ROOT/'cancelled'
IDENT=re.compile(r'^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$');JOB=re.compile(r'^[A-Za-z0-9_-]{8,100}$');HASH=re.compile(r'^[a-f0-9]{64}$')
def sha(b):return hashlib.sha256(b).hexdigest()
def limits():
 resource.setrlimit(resource.RLIMIT_CPU,(600,605));resource.setrlimit(resource.RLIMIT_FSIZE,(128*1024*1024,128*1024*1024));resource.setrlimit(resource.RLIMIT_NOFILE,(256,256))
def native_command(work,argv):
 args=['/usr/bin/bwrap','--unshare-all','--die-with-parent','--new-session']
 for mount in ('/usr','/lib','/lib64','/bin','/etc'):
  if pathlib.Path(mount).exists():args+=['--ro-bind',mount,mount]
 return args+['--dev','/dev','--proc','/proc','--tmpfs','/tmp','--bind',str(work),'/work','--ro-bind',str(work/'sources'),'/work/sources','--chdir','/work','--setenv','HOME','/work/home','--setenv','PATH','/usr/bin:/bin','--setenv','LANG','C.UTF-8','--setenv','QT_QPA_PLATFORM','offscreen','--setenv','LIBGL_ALWAYS_SOFTWARE','1']+argv

def wrdata_csv(file):
 text=file.read_text();lines=[line.split() for line in text.splitlines() if line.strip()]
 if len(lines)<2 or len(lines)>100001 or not lines[0]:raise ValueError('Missing bounded ngspice wrdata result')
 header=lines[0];rows=[]
 for row in lines[1:]:
  if len(row)!=len(header):raise ValueError('ngspice wrdata column mismatch')
  numbers=[float(v) for v in row]
  if any(not math.isfinite(v) for v in numbers):raise ValueError('Nonfinite ngspice wrdata result')
  rows.append(numbers)
 file.with_suffix('.native.dat').write_text(text)
 with file.open('w',newline='') as f:
  w=csv.writer(f);w.writerow(header);w.writerows(rows)
 return {'points':len(rows),'columns':header,'analysis':'native ngspice control wrdata'}

def raw_csv(source,target):
 text=source.read_text(errors='strict');head,values=text.split('Values:\n',1)
 nv=int(re.search(r'No\. Variables:\s*(\d+)',head).group(1));np=int(re.search(r'No\. Points:\s*(\d+)',head).group(1))
 if not 1<=nv<=1000 or not 1<=np<=100000 or 'complex' in head:raise ValueError('Unsupported or excessive ngspice result dimensions')
 names=[line.split()[1] for line in head.split('Variables:\n',1)[1].strip().splitlines()]
 if len(names)!=nv:raise ValueError('ngspice variable header mismatch')
 tokens=values.split();cursor=0;rows=[]
 for idx in range(np):
  if int(tokens[cursor])!=idx:raise ValueError('ngspice point index mismatch')
  cursor+=1;row=[float(x) for x in tokens[cursor:cursor+nv]];cursor+=nv
  if len(row)!=nv or any(not math.isfinite(v) for v in row):raise ValueError('Nonfinite ngspice result')
  rows.append(row)
 with target.open('w',newline='') as f:
  w=csv.writer(f);w.writerow(names);w.writerows(rows)
 return {'points':np,'columns':names,'analysis':re.search(r'Plotname:\s*(.+)',head).group(1)}

def main(req):
 job=req.get('jobId');tool=req.get('toolId');operation=req.get('operation');input_hash=req.get('inputHash')
 if not isinstance(job,str) or not JOB.fullmatch(job) or tool not in ('ngspice','openscad') or operation not in ('check','simulate') or not isinstance(input_hash,str) or not HASH.fullmatch(input_hash):raise ValueError('Invalid fixed professional tool request')
 files=req.get('sourceFiles');main_file=req.get('mainFile');parameters=req.get('parameters') or {}
 if not isinstance(files,list) or not 1<=len(files)<=100 or not isinstance(parameters,dict) or len(parameters)>100:raise ValueError('Invalid professional source set')
 normalized=[];seen=set();size=0;allowed=('.cir','.sp','.lib') if tool=='ngspice' else ('.scad',)
 for f in files:
  rel=f.get('path');content=f.get('content');digest=f.get('sha256')
  if not isinstance(rel,str) or not rel.endswith(allowed) or not re.fullmatch(r'[A-Za-z0-9_./ -]{1,240}',rel) or pathlib.PurePosixPath(rel).is_absolute() or any(p in ('','..','.') for p in rel.split('/')) or rel in seen or not isinstance(content,str):raise ValueError('Invalid professional source path')
  data=content.encode();size+=len(data)
  if len(data)>2*1024*1024 or size>5*1024*1024 or digest!=sha(data):raise ValueError('Professional source hash/size mismatch')
  seen.add(rel);normalized.append((rel,data,digest))
 if main_file not in seen:raise ValueError('Main source must be in the pinned source set')
 for name,value in parameters.items():
  if not IDENT.fullmatch(name) or not isinstance(value,(int,float,bool)) or not isinstance(value,bool) and not math.isfinite(value):raise ValueError('Parameters require finite scalar values')
 JOBS.mkdir(parents=True,exist_ok=True);CANCEL.mkdir(parents=True,exist_ok=True)
 if (CANCEL/job).exists():return {'success':False,'exitCode':130,'diagnostics':'Cancelled before execution','files':[]}
 directory=JOBS/job
 if directory.exists():
  if json.loads((directory/'request.json').read_text())!=req:raise ValueError('Job identifier already belongs to different pinned input')
  if (directory/'result.json').is_file():return json.loads((directory/'result.json').read_text())
  raise ValueError('Job already running or interrupted; use a new job identifier')
 directory.mkdir(mode=0o700);(directory/'request.json').write_text(json.dumps(req));work=directory/'work';work.mkdir();(work/'home').mkdir()
 for rel,data,digest in normalized:
  f=work/'sources'/rel;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(data)
 started=datetime.datetime.now(datetime.timezone.utc).isoformat();clock=time.monotonic();metadata={};logs=[];last_exit=0;active=None
 def terminate(signum,frame):
  if active:
   try:os.killpg(active.pid,signal.SIGTERM)
   except ProcessLookupError:pass
  raise RuntimeError('Professional tool cancelled')
 signal.signal(signal.SIGHUP,terminate);signal.signal(signal.SIGTERM,terminate)
 def execute(argv,input_data=None,timeout=600):
  nonlocal active,last_exit
  command=native_command(work,argv)
  active=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'},preexec_fn=limits)
  (directory/'process.json').write_text(json.dumps({'pid':active.pid,'jobId':job}))
  try:out,err=active.communicate(input=input_data,timeout=timeout)
  except subprocess.TimeoutExpired:
   os.killpg(active.pid,signal.SIGKILL);out,err=active.communicate();err+=b'\nProfessional tool timed out.'
  finally:(directory/'process.json').unlink(missing_ok=True)
  last_exit=active.returncode;logs.append(('ARGV '+json.dumps(argv)+'\n').encode()+out+b'\n'+err);active=None;return last_exit,out+err
 if tool=='ngspice':
  (work/'home'/'.spiceinit').write_text('set filetype=ascii\nset noaskquit\n')
  # Numeric circuit parameter changes use a reviewed .param include via a generated wrapper; the original source stays immutable.
  if parameters:raise ValueError('Change .param definitions in the versioned circuit source before running ngspice')
  if operation=='check':
   # Native source parsing. Embedded .control sections, if present, are part of the reviewed input and can execute.
   code,output=execute(['/usr/bin/xvfb-run','-a','-s','-screen 0 1024x768x24','/usr/bin/ngspice','-i','-n','/work/sources/'+main_file],b'quit\n')
   success=code==0 and not re.search(rb'(?im)^\s*(?:error(?:\s|:)|fatal(?:\s|:)|.*could not find a valid modelname|.*: no such command available)',output)
  else:
   code,output=execute(['/usr/bin/ngspice','-b','-r','/work/manta_result.raw','/work/sources/'+main_file])
   raw=work/'manta_result.raw';table=work/'manta_result.csv';success=code==0 and (raw.is_file() and raw.stat().st_size>30 or table.is_file() and table.stat().st_size>30) and b'No. of Data Rows' in output
   if success:
    try:metadata=raw_csv(raw,table) if raw.is_file() and raw.stat().st_size>30 else wrdata_csv(table)
    except Exception as error:logs.append(str(error).encode());success=False
  version=subprocess.check_output(['/usr/bin/ngspice','--version'],text=True).strip();version=next((x.strip('* ').strip() for x in version.splitlines() if 'ngspice-' in x),version[:100])
  wanted=['manta_result.csv','manta_result.native.dat','manta_result.raw']
 else:
  defines=[]
  for name,value in sorted(parameters.items()):defines+=['-D',name+'='+('true' if value else 'false') if isinstance(value,bool) else name+'='+repr(value)]
  # CSG syntax/parameter checks use the actual OpenSCAD interpreter; full rendering exports native triangles.
  output_name='manta_geometry.csg' if operation=='check' else 'manta_geometry.stl'
  code,output=execute(['/usr/bin/openscad',*defines,'-o','/work/'+output_name,'/work/sources/'+main_file])
  geometry=work/output_name;success=code==0 and geometry.is_file() and geometry.stat().st_size>10 and b'ERROR:' not in output
  if success and operation=='simulate':
   data=geometry.read_text(errors='replace');points=[tuple(float(v) for v in m) for m in re.findall(r'vertex\s+([-+\deE.]+)\s+([-+\deE.]+)\s+([-+\deE.]+)',data)]
   if not points or len(points)%3 or any(not math.isfinite(v) for p in points for v in p):success=False
   else:metadata={'triangles':len(points)//3,'boundingBox':{'min':[min(p[i] for p in points) for i in range(3)],'max':[max(p[i] for p in points) for i in range(3)]},'units':'source model units; no physical qualification implied'}
   if success:
    # Offscreen CPU rendering, still inside the same networkless private job sandbox.
    execute(['/usr/bin/xvfb-run','-a','-s','-screen 0 1024x768x24','/usr/bin/openscad',*defines,'--imgsize=960,720','--autocenter','--viewall','-o','/work/manta_preview.png','/work/sources/'+main_file],timeout=120)
    last_exit=code
  version=subprocess.run(['/usr/bin/openscad','--version'],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,check=True).stdout.strip()
  wanted=['manta_geometry.csg','manta_geometry.stl','manta_preview.png']
 (work/'compiler.log').write_bytes(b'\n'.join(logs))
 if (CANCEL/job).exists():success=False
 receipt={'schema':'manta-professional-execution-v1','jobId':job,'inputHash':input_hash,'operation':operation,'mainFile':main_file,'modelName':req.get('modelName'),'sourceFiles':[{'path':p,'sha256':h} for p,d,h in normalized],'parameters':parameters,'tool':{'id':tool,'version':version},'startedAt':started,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'durationSeconds':time.monotonic()-clock,'exitCode':last_exit,'success':success,'isolation':'Linux VM; bubblewrap unshare-all; read-only sources; no network; host/shared/other jobs inaccessible','outputKind':'geometry' if tool=='openscad' else 'time-series','metadata':metadata}
 (work/'execution-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');wanted+=['compiler.log','execution-receipt.json']
 exported=[];size=0
 for rel in wanted:
  f=work/rel
  if not f.is_file():continue
  b=f.read_bytes();size+=len(b)
  if len(b)>12*1024*1024 or size>16*1024*1024:raise RuntimeError('Professional result exceeds 16 MB export limit')
  mime='text/csv' if rel.endswith('.csv') else 'image/png' if rel.endswith('.png') else 'model/stl' if rel.endswith('.stl') else 'application/json' if rel.endswith('.json') else 'text/plain'
  exported.append({'path':rel,'sha256':sha(b),'contentBase64':base64.b64encode(b).decode(),'mimeType':mime})
 result={'success':success,'exitCode':last_exit,'tool':receipt['tool'],'receipt':receipt,'diagnostics':(work/'compiler.log').read_text(errors='replace')[-16000:],'outputKind':receipt['outputKind'],'geometry':metadata if tool=='openscad' else None,'files':exported}
 (directory/'result.json').write_text(json.dumps(result));return result
try:
 raw=sys.stdin.buffer.read(8*1024*1024+1)
 if len(raw)>8*1024*1024:raise ValueError('Professional request exceeds limit')
 print(json.dumps(main(json.loads(raw))))
except Exception as error:print(json.dumps({'success':False,'exitCode':1,'diagnostics':str(error),'files':[]}))
