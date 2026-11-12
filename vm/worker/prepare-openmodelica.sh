#!/bin/bash

# Paths and account are fixed by the host for existing VM disks.
export DAIDALIS_VM_ROOT=${DAIDALIS_VM_ROOT:-/srv/daidalis}
export DAIDALIS_VM_TRANSFER=${DAIDALIS_VM_TRANSFER:-/mnt/daidalis-transfer}
export DAIDALIS_VM_HOME=${DAIDALIS_VM_HOME:-/home/daidalis}
export DAIDALIS_VM_USER=${DAIDALIS_VM_USER:-daidalis}
set -euo pipefail
[[ $(uname -s) == Linux && $(uname -m) == aarch64 ]] || exit 2
export DEBIAN_FRONTEND=noninteractive
sudo install -d -m 0755 ${DAIDALIS_VM_ROOT}/professional ${DAIDALIS_VM_ROOT}/receipts
sudo chown ${DAIDALIS_VM_USER}:${DAIDALIS_VM_USER} ${DAIDALIS_VM_ROOT}/professional ${DAIDALIS_VM_ROOT}/receipts
exec 9>${DAIDALIS_VM_ROOT}/professional/provision.lock
flock -w 900 9
if ! command -v omc >/dev/null || ! command -v bwrap >/dev/null; then
  sudo apt-get update
  sudo apt-get -o DPkg::Lock::Timeout=600 install --no-install-recommends -y ca-certificates curl gnupg bubblewrap
  curl -fsSL https://build.openmodelica.org/apt/openmodelica.asc -o /tmp/daidalis-openmodelica.asc
  sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/daidalis-openmodelica.gpg /tmp/daidalis-openmodelica.asc
  printf '%s\n' 'deb [arch=arm64 signed-by=/usr/share/keyrings/daidalis-openmodelica.gpg] https://build.openmodelica.org/apt jammy stable' | sudo tee /etc/apt/sources.list.d/daidalis-openmodelica.list >/dev/null
  sudo apt-get update
  version=$(apt-cache policy omc | awk '/Candidate:/{print $2}')
  sudo apt-get -o DPkg::Lock::Timeout=600 install --no-install-recommends -y "omc=$version" "omlibrary=$version" bubblewrap
fi
omc --version
bwrap --unshare-all --die-with-parent --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /bin /bin --ro-bind /etc /etc --dev /dev --proc /proc --tmpfs /tmp /usr/bin/omc --version
python3 - <<'PY'

def _vm_name_path(value):
    # The SSH transport supplies roots from its fixed existing/new VM profiles.
    import os
    for prefix, key in (('/srv/daidalis', 'DAIDALIS_VM_ROOT'),
                        ('/mnt/daidalis-transfer', 'DAIDALIS_VM_TRANSFER'),
                        ('/home/daidalis', 'DAIDALIS_VM_HOME')):
        value = value.replace(prefix, os.environ.get(key, prefix))
    return value

import hashlib,json,pathlib,subprocess,datetime
version=subprocess.check_output(['omc','--version'],text=True).strip()
pkgs=subprocess.check_output(['dpkg-query','-W','-f=${Package}\t${Version}\n','omc','omlibrary','libomc','libomcsimulation','bubblewrap'],text=True).strip()
receipt={'schema':'daidalis-openmodelica-ready-v1','ready':True,'tool':{'id':'openmodelica','version':version},'packages':pkgs.splitlines(),'architecture':'aarch64','isolation':'Linux VM + per-job bubblewrap unshare-all','repository':'https://build.openmodelica.org/apt','installedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'hostGlobalChanges':False}
pathlib.Path(_vm_name_path('/srv/daidalis/receipts/openmodelica-ready.json')).write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
PY
