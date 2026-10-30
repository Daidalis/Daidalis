"""Engineering helpers invoked by the non-root shared-container worker."""
import base64
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import signal
import subprocess
import time
import tempfile

WORK = Path('/work')
MAX_BYTES = 12 * 1024 * 1024
ISOLATION = 'shared application container; same user and filesystem access; no per-task credential isolation'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def safe_name(name):
    if not isinstance(name, str) or not name or len(name) > 1024 or '\\' in name or '\0' in name:
        raise ValueError('Invalid relative file path')
    if PurePosixPath(name).is_absolute() or any(s in ('', '.', '..') for s in name.split('/')):
        raise ValueError('File path escapes workspace')
    return name


def materialize(files):
    if not isinstance(files, list) or len(files) > 1500:
        raise ValueError('Too many source files')
    seen = set()
    total = 0
    for entry in files:
        name = safe_name(entry['path'])
        if name in seen:
            raise ValueError('Duplicate source file')
        seen.add(name)
        content = base64.b64decode(entry['contentBase64'], validate=True)
        total += len(content)
        if total > MAX_BYTES or sha(content) != entry['sha256']:
            raise ValueError('Invalid source size or hash')
        target = WORK / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)


def collect(only=None):
    files = []
    total = 0
    for directory, dirs, names in os.walk(WORK, followlinks=False):
        for name in dirs + names:
            p = Path(directory) / name
            if p.is_symlink():
                raise ValueError('Symlink output is not exportable')
        for name in names:
            p = Path(directory) / name
            if only is not None and str(p.relative_to(WORK)) not in only:
                continue
            if not p.is_file():
                raise ValueError('Only regular file outputs are exportable')
            total += p.stat().st_size
            if total > MAX_BYTES or len(files) >= 1500:
                raise ValueError('Output snapshot exceeds limits')
            content = p.read_bytes()
            files.append({'path':str(p.relative_to(WORK)), 'sha256':sha(content),
                          'contentBase64':base64.b64encode(content).decode()})
    return files


def run(argv, timeout, stdin=None):
    # Regular files bound output growth; the shared-container caller also bounds time and output.
    import resource
    def limits():
        resource.setrlimit(resource.RLIMIT_FSIZE, (24 * 1024**2, 24 * 1024**2))
        resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        process = subprocess.Popen(argv, cwd=WORK, stdin=subprocess.PIPE, stdout=out, stderr=err,
                                   start_new_session=True, preexec_fn=limits)
        previous=signal.getsignal(signal.SIGTERM)
        def cancel(*args):
            try:os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:pass
            raise RuntimeError('Cancelled')
        signal.signal(signal.SIGTERM,cancel)
        try:
            process.communicate(stdin, timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise RuntimeError('Job timed out')
        finally:
            signal.signal(signal.SIGTERM,previous)
            try:os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:pass
            process.wait()
        out.seek(0);err.seek(0)
        stdout=out.read(200001);stderr=err.read(200001)
    if len(stdout) + len(stderr) > 200000:
        raise ValueError('Command output exceeded limit')
    return {'code':process.returncode, 'stdout':stdout.decode(errors='replace'), 'stderr':stderr.decode(errors='replace')}


def version(tool):
    commands = {'ngspice':['ngspice','--version'], 'openscad':['openscad','--version'],
                'openmodelica':['omc','--version'], 'gis':['gdalinfo','--version']}
    try:
        p = subprocess.run(commands[tool], capture_output=True, text=True, timeout=10)
        return {'ready':p.returncode == 0, 'version':(p.stdout + p.stderr).strip()[:2000]}
    except FileNotFoundError:
        return {'ready':False, 'reason':'Toolchain not installed in this image'}


def spice_csv(raw):
    text = raw.read_text()
    head, values = text.split('Values:\n', 1)
    count = int(re.search(r'No\. Variables:\s*(\d+)',head).group(1))
    points = int(re.search(r'No\. Points:\s*(\d+)',head).group(1))
    if not 1 <= count <= 1000 or not 1 <= points <= 100000 or 'complex' in head:
        raise ValueError('Unsupported ngspice output dimensions')
    names = [line.split()[1] for line in head.split('Variables:\n',1)[1].strip().splitlines()]
    tokens = values.split()
    rows = []
    cursor = 0
    for index in range(points):
        if int(tokens[cursor]) != index:
            raise ValueError('Invalid ngspice sample index')
        cursor += 1
        row = [float(x) for x in tokens[cursor:cursor+count]]
        if len(row) != count or any(not math.isfinite(x) for x in row):
            raise ValueError('Invalid ngspice sample')
        cursor += count
        rows.append(row)
    with (WORK/'manta_result.csv').open('w') as f:
        writer=csv.writer(f);writer.writerow(names);writer.writerows(rows)


def professional(request):
    tool = request.get('toolId')
    if tool not in ('ngspice','openscad','openmodelica'):
        raise ValueError('Unsupported professional tool')
    state = version(tool)
    if not state['ready']:
        raise ValueError(state.get('reason','Tool unavailable'))
    operation = request.get('operation')
    if operation not in ('check','simulate'):
        raise ValueError('Unsupported professional operation')
    sources = request['sourceFiles']
    materialize([{'path':f['path'],'sha256':f['sha256'],
                  'contentBase64':base64.b64encode(f['content'].encode()).decode()} for f in sources])
    main = safe_name(request['mainFile'])
    if main not in [s['path'] for s in sources]:
        raise ValueError('Main model absent from input snapshot')
    parameters = request.get('parameters') or {}
    if not isinstance(parameters,dict) or len(parameters)>100:
        raise ValueError('Invalid model parameters')
    for name,value in parameters.items():
        if not re.fullmatch(r'[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*',name) or not isinstance(value,(int,float,bool)) or not math.isfinite(value):
            raise ValueError('Parameters must be finite scalar values')
    stdin=None
    if tool == 'ngspice':
        if parameters:
            raise ValueError('Edit circuit .param source instead of passing parameters')
        # ngspice reads SPICE_ASCIIRAWFILE before writing its native raw output.
        os.environ['SPICE_ASCIIRAWFILE']='1'
        if operation=='check':
            argv=['ngspice','-p','-n',main];stdin=b'quit\n'
        else:
            argv=['ngspice','-b','-r','manta_result.raw',main]
    elif tool == 'openscad':
        argv=['openscad']
        for name,value in parameters.items():
            argv += ['-D',name+'='+json.dumps(value)]
        argv += ['-o','manta_geometry.stl' if operation=='simulate' else 'manta_geometry.csg',main]
    else:
        model=request.get('modelName','')
        if not re.fullmatch(r'[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*',model):
            raise ValueError('Invalid Modelica model name')
        sim=request.get('simulation') or {}
        start,stop,n,tol=(sim.get('startTime',0),sim.get('stopTime',100),sim.get('numberOfIntervals',500),sim.get('tolerance',1e-6))
        if not all(isinstance(x,(int,float)) and math.isfinite(x) for x in [start,stop,n,tol]) or not start<stop or not 2<=n<=20000 or not 1e-12<=tol<=.1:
            raise ValueError('Invalid simulation settings')
        library_root=Path('/opt/modelica-libraries')
        if library_root.is_dir():
            # OMC initializes its package manager even with explicit loadFile calls.
            # Seed each job's package registry without copying the large libraries.
            registry=Path.home()/'.openmodelica'/'libraries'
            registry.mkdir(parents=True,exist_ok=True)
            for entry in library_root.iterdir():
                target=registry/entry.name
                if not target.exists():
                    if entry.is_dir():
                        target.symlink_to(entry,target_is_directory=True)
                    else:
                        target.write_bytes(entry.read_bytes())
        standard=[library_root/(name+' 4.0.0+maint.om')/'package.mo' for name in ['Complex','ModelicaServices','Modelica']]
        lines=(['loadFile('+json.dumps(str(file))+');' for file in standard]
               if all(file.is_file() for file in standard) else ['loadModel(Modelica);'])
        lines += ['loadFile('+json.dumps(str(WORK/safe_name(s['path'])))+');' for s in sources]
        lines += ['print(checkModel('+model+'));','getErrorString();']
        if operation=='simulate':
            overrides=','.join(k+'='+json.dumps(v) for k,v in parameters.items())
            flags='-override='+overrides if overrides else ''
            lines += [f'simulate({model},startTime={start},stopTime={stop},numberOfIntervals={int(n)},tolerance={tol},outputFormat="csv",fileNamePrefix="manta_result",simflags={json.dumps(flags)});','getErrorString();']
        (WORK/'run.mos').write_text('\n'.join(lines))
        argv=['omc','-n=1','run.mos']
    started=time.time()
    result=run(argv,min(request.get('timeoutMs',600000)/1000,600),stdin)
    diagnostics=result['stdout']+result['stderr']
    success=result['code']==0
    if tool=='ngspice':
        success=success and not re.search(r'(?im)^\s*(error:|fatal:)',diagnostics)
        if operation=='simulate':
            success=success and (WORK/'manta_result.raw').is_file()
            if success:spice_csv(WORK/'manta_result.raw')
    elif tool=='openscad':
        output=WORK/('manta_geometry.stl' if operation=='simulate' else 'manta_geometry.csg')
        success=success and output.is_file() and output.stat().st_size>10 and 'ERROR:' not in diagnostics
    else:
        success=success and 'completed successfully' in diagnostics and 'Error:' not in diagnostics
        if operation=='simulate':success=success and (WORK/'manta_result_res.csv').is_file()
    receipt={'schema':'manta-professional-execution-v1','inputHash':request['inputHash'],
             'sourceFiles':[{'path':s['path'],'sha256':s['sha256']} for s in sources],
             'operation':operation,'tool':{'id':tool,'version':state['version']},
             'durationSeconds':time.time()-started,'exitCode':result['code'],'success':success,
             'isolation':ISOLATION}
    (WORK/'compiler.log').write_text(diagnostics)
    (WORK/'execution-receipt.json').write_text(json.dumps(receipt))
    files=collect(['compiler.log','execution-receipt.json','manta_result.csv','manta_result_res.csv','manta_geometry.stl','manta_geometry.csg'])
    geometry=None
    if tool=='openscad' and operation=='simulate' and success:
        points=[tuple(map(float,p)) for p in re.findall(r'vertex\s+([-+\deE.]+)\s+([-+\deE.]+)\s+([-+\deE.]+)',(WORK/'manta_geometry.stl').read_text())]
        if not points or len(points)%3 or any(not math.isfinite(v) for p in points for v in p):
            raise ValueError('Invalid native STL geometry')
        geometry={'triangles':len(points)//3,'boundingBox':{'min':[min(p[i] for p in points) for i in range(3)],'max':[max(p[i] for p in points) for i in range(3)]},'units':'source model units'}
    return {'exitCode':result['code'],'success':success,'tool':receipt['tool'],'receipt':receipt,
            'diagnostics':diagnostics,'files':files,'geometry':geometry,'outputKind':'geometry' if geometry else 'data'}


def main(request):
    if request['kind']=='probe':
        return {'ready':True,'tools':{tool:version(tool) for tool in ['ngspice','openscad','openmodelica','gis']}}
    if request['kind']=='professional':
        return professional(request)
    raise ValueError('Invalid engineering request kind')
