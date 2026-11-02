"""Explicit shared-container entry point; not a per-task sandbox."""
import json
import os
from pathlib import Path
import sys
import worker

try:
    if os.geteuid()==0 or not Path('/.dockerenv').exists():
        raise RuntimeError('Shared worker requires a non-root Docker container')
    worker.WORK=Path.cwd()
    worker.ISOLATION='shared application container; same user and filesystem access; no per-task credential isolation'
    (Path.home()/'.spiceinit').write_text('set filetype=ascii\nset noaskquit\n')
    raw=sys.stdin.buffer.readline(20*1024*1024+1)
    if len(raw)>20*1024*1024:raise ValueError('Request too large')
    request=json.loads(raw)
    if request.get('kind')=='shared-command':
        command=request.get('command')
        if not isinstance(command,str) or not command.strip() or len(command)>16000:
            raise ValueError('Invalid command')
        result=worker.run(['/bin/sh','-c',command],min(request.get('timeoutMs',30000)/1000,60))
        result['executionMode']='in-place'
    else:
        result=worker.main(request)
    print(json.dumps(result))
except Exception as error:
    print(str(error),file=sys.stderr)
    sys.exit(1)
