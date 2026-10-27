#!/bin/sh
set -eu
export PYTHONDONTWRITEBYTECODE=1
base=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
exec /usr/bin/python3 - "$base/state" <<'PY'
import json, os, sys, shutil, importlib.util
from pathlib import Path
state=Path(sys.argv[1]); path=state/'runtime.json'
data=json.loads(path.read_text()) if path.exists() else {'state':'not-prepared','guestReady':False}
pid=data.get('pid')
helper=state.parent/'host/vm-runtime.py'
spec=importlib.util.spec_from_file_location('manta_vm_runtime',helper)
runtime=importlib.util.module_from_spec(spec);spec.loader.exec_module(runtime)
try:
    if pid:
        os.kill(pid,0)
        if not runtime.owns_process(state,pid): data.update(state='stopped',guestReady=False)
    elif data.get('state') in ('running','starting','stopping'): data.update(state='stopped',guestReady=False)
except ProcessLookupError:
    data.update(state='stopped',guestReady=False)
except PermissionError:
    data['processProbe']='restricted-by-command-sandbox'
data['hostFreeBytes']=shutil.disk_usage(state).free
disk=state/'ubuntu.raw'
if disk.exists(): data['diskAllocatedBytes']=disk.stat().st_blocks*512
print(json.dumps(data,indent=2))
PY
