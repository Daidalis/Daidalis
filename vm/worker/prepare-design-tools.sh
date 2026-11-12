#!/bin/bash

# Paths and account are fixed by the host for existing VM disks.
export DAIDALIS_VM_ROOT=${DAIDALIS_VM_ROOT:-/srv/daidalis}
export DAIDALIS_VM_TRANSFER=${DAIDALIS_VM_TRANSFER:-/mnt/daidalis-transfer}
export DAIDALIS_VM_HOME=${DAIDALIS_VM_HOME:-/home/daidalis}
export DAIDALIS_VM_USER=${DAIDALIS_VM_USER:-daidalis}
set -euo pipefail
[[ $(uname -s) == Linux && $(uname -m) == aarch64 ]] || exit 2
sudo install -d -m 0755 ${DAIDALIS_VM_ROOT}/professional ${DAIDALIS_VM_ROOT}/receipts
sudo chown ${DAIDALIS_VM_USER}:${DAIDALIS_VM_USER} ${DAIDALIS_VM_ROOT}/professional ${DAIDALIS_VM_ROOT}/receipts
exec 9>${DAIDALIS_VM_ROOT}/professional/provision.lock
flock -w 900 9
if ! command -v ngspice >/dev/null || ! command -v openscad >/dev/null || ! command -v Xvfb >/dev/null; then
 sudo apt-get update
 sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=600 install --no-install-recommends -y ngspice openscad xvfb xauth
fi
sudo install -d -m 0755 ${DAIDALIS_VM_ROOT}/professional ${DAIDALIS_VM_ROOT}/receipts
sudo chown ${DAIDALIS_VM_USER}:${DAIDALIS_VM_USER} ${DAIDALIS_VM_ROOT}/professional ${DAIDALIS_VM_ROOT}/receipts
python3 - <<'PY'

def _vm_name_path(value):
    # The SSH transport supplies roots from its fixed existing/new VM profiles.
    import os
    for prefix, key in (('/srv/daidalis', 'DAIDALIS_VM_ROOT'),
                        ('/mnt/daidalis-transfer', 'DAIDALIS_VM_TRANSFER'),
                        ('/home/daidalis', 'DAIDALIS_VM_HOME')):
        value = value.replace(prefix, os.environ.get(key, prefix))
    return value

import datetime,json,pathlib,subprocess
spice=subprocess.check_output(['ngspice','--version'],text=True).strip()
cad=subprocess.run(['openscad','--version'],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,check=True).stdout.strip()
pkgs=subprocess.check_output(['dpkg-query','-W','-f=${Package}\t${Version}\n','ngspice','openscad','xvfb','xauth'],text=True).strip()
receipt={'schema':'daidalis-design-tools-ready-v1','ready':True,'tools':{'ngspice':{'ready':True,'version':next((x.strip('* ').strip() for x in spice.splitlines() if 'ngspice-' in x),'ngspice')},'openscad':{'ready':True,'version':cad}},'packages':pkgs.splitlines(),'repository':'Ubuntu 22.04 signed ARM64 packages','installedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'hostGlobalChanges':False,'isolation':'Linux VM + per-job bubblewrap unshare-all'}
pathlib.Path(_vm_name_path('/srv/daidalis/receipts/design-tools-ready.json')).write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
PY
