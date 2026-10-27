#!/bin/bash
set -euo pipefail
if [[ $(uname -s) != Linux || $(uname -m) != aarch64 ]]; then
  echo 'Native NOS3 preparation runs only inside the isolated ARM64 Linux guest.' >&2
  exit 2
fi
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if [[ $EUID -ne 0 ]]; then exec sudo -n bash "$script_dir/prepare-native.sh"; fi
mkdir -p /srv/manta/receipts
exec 9>/srv/manta/prepare.lock
flock -x 9
# Verification and preparation must never mutate the same mission concurrently.
touch /srv/manta/verification.lock
chown --no-dereference manta:manta /srv/manta/verification.lock
exec 8>/srv/manta/verification.lock
flock -x 8
# Queue capacity is a property of this disposable Linux kernel, never macOS.
sysctl -w fs.mqueue.msg_max=10000 >/dev/null
normalize_ownership() {
  chown --no-dereference manta:manta /srv/manta
  for name in nos3 42 42-assets runs receipts worker campaign-results; do
    directory="/srv/manta/$name"
    if [[ -L "$directory" ]]; then echo "Refusing shared/symlink work root: $directory" >&2; exit 2; fi
    mkdir -p "$directory"
    chown -R -P --no-dereference manta:manta "$directory"
  done
  touch /srv/manta/verification.lock
  chown --no-dereference manta:manta /srv/manta/verification.lock
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
bash "$script_dir/native/provision_guest.sh" /mnt/manta-transfer/source /srv/manta/nos3 /srv/manta/receipts \
  > /srv/manta/receipts/provision.log 2>&1
MANTA_BUILD_JOBS=4 bash "$script_dir/native/build_native.sh" /srv/manta/nos3 \
  > /srv/manta/receipts/build.log 2>&1
normalize_ownership
python3 "$script_dir/native-readiness.py" --record
