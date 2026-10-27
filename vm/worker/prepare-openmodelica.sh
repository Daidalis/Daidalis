#!/bin/bash
set -euo pipefail
[[ $(uname -s) == Linux && $(uname -m) == aarch64 ]] || exit 2
export DEBIAN_FRONTEND=noninteractive
sudo install -d -m 0755 /srv/manta/professional /srv/manta/receipts
sudo chown manta:manta /srv/manta/professional /srv/manta/receipts
exec 9>/srv/manta/professional/provision.lock
flock -w 900 9
if ! command -v omc >/dev/null || ! command -v bwrap >/dev/null; then
  sudo apt-get update
  sudo apt-get -o DPkg::Lock::Timeout=600 install --no-install-recommends -y ca-certificates curl gnupg bubblewrap
  curl -fsSL https://build.openmodelica.org/apt/openmodelica.asc -o /tmp/manta-openmodelica.asc
  sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/manta-openmodelica.gpg /tmp/manta-openmodelica.asc
  printf '%s\n' 'deb [arch=arm64 signed-by=/usr/share/keyrings/manta-openmodelica.gpg] https://build.openmodelica.org/apt jammy stable' | sudo tee /etc/apt/sources.list.d/manta-openmodelica.list >/dev/null
  sudo apt-get update
  version=$(apt-cache policy omc | awk '/Candidate:/{print $2}')
  sudo apt-get -o DPkg::Lock::Timeout=600 install --no-install-recommends -y "omc=$version" "omlibrary=$version" bubblewrap
fi
omc --version
bwrap --unshare-all --die-with-parent --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /bin /bin --ro-bind /etc /etc --dev /dev --proc /proc --tmpfs /tmp /usr/bin/omc --version
python3 - <<'PY'
import hashlib,json,pathlib,subprocess,datetime
version=subprocess.check_output(['omc','--version'],text=True).strip()
pkgs=subprocess.check_output(['dpkg-query','-W','-f=${Package}\t${Version}\n','omc','omlibrary','libomc','libomcsimulation','bubblewrap'],text=True).strip()
receipt={'schema':'manta-openmodelica-ready-v1','ready':True,'tool':{'id':'openmodelica','version':version},'packages':pkgs.splitlines(),'architecture':'aarch64','isolation':'Linux VM + per-job bubblewrap unshare-all','repository':'https://build.openmodelica.org/apt','installedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'hostGlobalChanges':False}
pathlib.Path('/srv/manta/receipts/openmodelica-ready.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
PY
