#!/bin/bash

# Paths and account are fixed by the host for existing VM disks.
export DAIDALIS_VM_ROOT=${DAIDALIS_VM_ROOT:-/srv/daidalis}
export DAIDALIS_VM_TRANSFER=${DAIDALIS_VM_TRANSFER:-/mnt/daidalis-transfer}
export DAIDALIS_VM_HOME=${DAIDALIS_VM_HOME:-/home/daidalis}
export DAIDALIS_VM_USER=${DAIDALIS_VM_USER:-daidalis}
set -euo pipefail
if [[ $(uname -s) != Linux || $(uname -m) != aarch64 ]]; then
  echo 'Native NOS3 preparation runs only inside the isolated ARM64 Linux guest.' >&2
  exit 2
fi
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if [[ $EUID -ne 0 ]]; then exec sudo -n --preserve-env=DAIDALIS_VM_ROOT,DAIDALIS_VM_TRANSFER,DAIDALIS_VM_HOME,DAIDALIS_VM_USER bash "$script_dir/prepare-native.sh"; fi
mkdir -p ${DAIDALIS_VM_ROOT}/receipts
exec 9>${DAIDALIS_VM_ROOT}/prepare.lock
flock -x 9
# Verification and preparation must never mutate the same mission concurrently.
touch ${DAIDALIS_VM_ROOT}/verification.lock
chown --no-dereference ${DAIDALIS_VM_USER}:${DAIDALIS_VM_USER} ${DAIDALIS_VM_ROOT}/verification.lock
exec 8>${DAIDALIS_VM_ROOT}/verification.lock
flock -x 8
# Queue capacity is a property of this disposable Linux kernel, never macOS.
sysctl -w fs.mqueue.msg_max=10000 >/dev/null
normalize_ownership() {
  chown --no-dereference ${DAIDALIS_VM_USER}:${DAIDALIS_VM_USER} ${DAIDALIS_VM_ROOT}
  for name in nos3 42 42-assets runs receipts worker campaign-results; do
    directory="${DAIDALIS_VM_ROOT}/$name"
    if [[ -L "$directory" ]]; then echo "Refusing shared/symlink work root: $directory" >&2; exit 2; fi
    mkdir -p "$directory"
    chown -R -P --no-dereference ${DAIDALIS_VM_USER}:${DAIDALIS_VM_USER} "$directory"
  done
  touch ${DAIDALIS_VM_ROOT}/verification.lock
  chown --no-dereference ${DAIDALIS_VM_USER}:${DAIDALIS_VM_USER} ${DAIDALIS_VM_ROOT}/verification.lock
}
if python3 "$script_dir/native-readiness.py" --check; then
  normalize_ownership
  exit 0
else
  check_status=$?
  if [[ $check_status -eq 3 ]]; then
    echo 'Existing runtime changed after its verification receipt; preserving it. Validate the current campaign before recording new readiness.' >&2
    exit 3
  fi
fi
python3 "$script_dir/native-readiness.py" --verify-inputs
python3 "$script_dir/native-readiness.py" --extract-source
bash "$script_dir/native/provision_guest.sh" ${DAIDALIS_VM_TRANSFER}/source ${DAIDALIS_VM_ROOT}/nos3 ${DAIDALIS_VM_ROOT}/receipts \
  > ${DAIDALIS_VM_ROOT}/receipts/provision.log 2>&1
DAIDALIS_BUILD_JOBS=4 bash "$script_dir/native/build_native.sh" ${DAIDALIS_VM_ROOT}/nos3 \
  > ${DAIDALIS_VM_ROOT}/receipts/build.log 2>&1
normalize_ownership
python3 "$script_dir/native-readiness.py" --record
