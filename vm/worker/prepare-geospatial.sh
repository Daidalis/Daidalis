#!/bin/bash
set -euo pipefail
[[ $(uname -s) == Linux && $(uname -m) == aarch64 ]] || exit 2
sudo install -d -m 0755 /srv/manta/professional /srv/manta/receipts
sudo chown manta:manta /srv/manta/professional /srv/manta/receipts
exec 9>/srv/manta/professional/provision.lock
flock -w 900 9

# Exact Ubuntu 22.04 ARM64 package versions. This modifies only the private
# Linux VM, never macOS Python, Homebrew, global configuration or the NAS.
if ! dpkg-query -W -f='${Version}' python3-gdal 2>/dev/null | grep -Fxq '3.4.1+dfsg-1build4' ||
   ! dpkg-query -W -f='${Version}' gdal-bin 2>/dev/null | grep -Fxq '3.4.1+dfsg-1build4' ||
   ! dpkg-query -W -f='${Version}' proj-bin 2>/dev/null | grep -Fxq '8.2.1-1'; then
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=600 install --no-install-recommends -y \
    'python3-gdal=3.4.1+dfsg-1build4' \
    'gdal-bin=3.4.1+dfsg-1build4' \
    'proj-bin=8.2.1-1'
fi

python3 - <<'PY'
import datetime,hashlib,importlib.util,json,pathlib,sys
worker=pathlib.Path('/srv/manta/geospatial-worker/geospatial-run.py')
probe=pathlib.Path('/srv/manta/geospatial-worker/geospatial-status.py')
spec=importlib.util.spec_from_file_location('manta_geo_status',probe)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
from osgeo import gdal,osr
versions={'gdal':gdal.VersionInfo('--version'),'proj':'%d.%d.%d'%(osr.GetPROJVersionMajor(),osr.GetPROJVersionMinor(),osr.GetPROJVersionMicro())}
receipt={'schema':'manta-geospatial-ready-v1','ready':True,'repository':'Ubuntu 22.04 signed ARM64 packages','packages':module.packages(),'versions':versions,'binaryHashes':module.binaries(),'workerSha256':module.digest(worker),'installedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'isolation':'Linux VM + per-job bubblewrap unshare-all','hostGlobalChanges':False}
if any(receipt['packages'].get(k)!=v for k,v in module.PINNED.items()):raise RuntimeError('Pinned geospatial package version mismatch')
target=pathlib.Path('/srv/manta/receipts/geospatial-ready.json')
target.write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(module.status(receipt['workerSha256'])))
PY
