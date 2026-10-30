"""One request per disposable, offline task container."""
import json
import os
from pathlib import Path
import sys
import subprocess
import tempfile
import worker

try:
    if os.geteuid() == 0 or not Path('/.dockerenv').exists():
        raise RuntimeError('Task worker requires a non-root container')
    worker.WORK = Path('/work')
    worker.ISOLATION = 'dedicated rootless Docker task container; network disabled; no application credentials'
    (Path.home()/'.spiceinit').write_text('set filetype=ascii\nset noaskquit\n')
    raw = sys.stdin.buffer.readline(72*1024*1024+1)
    if len(raw) > 72*1024*1024:
        raise ValueError('Request too large')
    request = json.loads(raw)
    if request['kind'] == 'adapter':
        adapters={'gis':'geospatial-container.py','orbit42':'orbit42-container.py','ground':'orbit-ground-container.py','flight':'flight-task.py','numerical':'numerical-task.mjs'}
        script=Path(__file__).with_name(adapters[request['adapter']])
        with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
            argv=['node',str(script),request['mode']] if request['adapter']=='numerical' else ['/usr/bin/python3','-B',str(script),request['mode']]
            p=subprocess.run(argv,input=request.get('input','').encode(),stdout=out,stderr=err,timeout=request['timeoutMs']/1000)
            out.seek(0);err.seek(0);data=out.read(32*1024*1024+1)
            if len(data)>32*1024*1024:raise ValueError('Adapter output exceeds limit')
            if p.returncode:raise RuntimeError(err.read(4000).decode(errors='replace'))
            result=json.loads(data)
    elif request['kind'] == 'command':
        result = worker.run(['/bin/sh', '-c', request['command']], request['timeoutMs']/1000)
        result['executionMode'] = 'in-place'
    else:
        result = worker.main(request)
    print(json.dumps(result))
except Exception as error:
    print(str(error), file=sys.stderr)
    sys.exit(1)
