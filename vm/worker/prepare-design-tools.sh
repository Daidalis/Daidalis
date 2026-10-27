#!/bin/bash
set -euo pipefail
[[ $(uname -s) == Linux && $(uname -m) == aarch64 ]] || exit 2
sudo install -d -m 0755 /srv/manta/professional /srv/manta/receipts
sudo chown manta:manta /srv/manta/professional /srv/manta/receipts
exec 9>/srv/manta/professional/provision.lock
flock -w 900 9
if ! command -v ngspice >/dev/null || ! command -v openscad >/dev/null || ! command -v Xvfb >/dev/null; then
 sudo apt-get update
 sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=600 install --no-install-recommends -y ngspice openscad xvfb xauth
fi
sudo install -d -m 0755 /srv/manta/professional /srv/manta/receipts
sudo chown manta:manta /srv/manta/professional /srv/manta/receipts
python3 - <<'PY'
import datetime,json,pathlib,subprocess
spice=subprocess.check_output(['ngspice','--version'],text=True).strip()
cad=subprocess.run(['openscad','--version'],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,check=True).stdout.strip()
pkgs=subprocess.check_output(['dpkg-query','-W','-f=${Package}\t${Version}\n','ngspice','openscad','xvfb','xauth'],text=True).strip()
receipt={'schema':'manta-design-tools-ready-v1','ready':True,'tools':{'ngspice':{'ready':True,'version':next((x.strip('* ').strip() for x in spice.splitlines() if 'ngspice-' in x),'ngspice')},'openscad':{'ready':True,'version':cad}},'packages':pkgs.splitlines(),'repository':'Ubuntu 22.04 signed ARM64 packages','installedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'hostGlobalChanges':False,'isolation':'Linux VM + per-job bubblewrap unshare-all'}
pathlib.Path('/srv/manta/receipts/design-tools-ready.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
PY
