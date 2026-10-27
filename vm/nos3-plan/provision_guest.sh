#!/bin/bash
set -euo pipefail
# Run only inside the dedicated Ubuntu Jammy ARM64 VM.
if [[ $(uname -s) != Linux || $(uname -m) != aarch64 ]]; then
  echo 'This script only provisions the dedicated ARM64 Linux guest.' >&2
  exit 2
fi
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source_root=${1:-/srv/manta/source}
work_root=${2:-/srv/manta/nos3}
receipt_root=${3:-/srv/manta/receipts}
mkdir -p "$receipt_root"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends build-essential cmake python3 ca-certificates \
  libboost-dev libboost-system-dev libboost-program-options-dev libboost-filesystem-dev \
  libboost-thread-dev libboost-regex-dev libxerces-c-dev libelf-dev libncurses-dev libreadline-dev libsocketcan-dev
dpkg -i "$source_root/packages/itc-common-Release_1.10.2_arm64.deb" \
  "$source_root/packages/nos-engine-Release_1.6.2_arm64.deb"
# Upstream packages contain root-only SDK files; grant read/search only to
# package-owned paths inside this guest (the upstream Dockerfile uses 777 /usr).
while IFS= read -r package_path; do
  if [[ -e "$package_path" && "$package_path" == /usr/* ]]; then
    chmod a+rX "$package_path"
  fi
done < <(dpkg-query -L nos_engine itc-common)
ln -sf /usr/lib/libnos_engine_client.so /usr/lib/libnos_engine_client_cxx11.so
ldconfig
if ! grep -q '# Manta isolated NOS3 aliases' /etc/hosts; then
  echo '127.0.0.1 nos-engine-server sc01-nos-engine-server fortytwo truth42sim nos-fsw # Manta isolated NOS3 aliases' >> /etc/hosts
fi
# POSIX queues belong to this VM kernel only.
sysctl -w fs.mqueue.msg_max=10000
asset_archive="$(dirname -- "$source_root")/42-assets.tar.gz"
if [[ -f "$asset_archive" && ! -f /srv/manta/42-assets/.manta-assets-ready ]]; then
  mkdir -p /srv/manta/42-assets
  tar -xzf "$asset_archive" -C /srv/manta/42-assets
  touch /srv/manta/42-assets/.manta-assets-ready
  chown -R manta:manta /srv/manta/42-assets
fi
python3 "$script_dir/configure_native.py" --source "$source_root/nos3" \
  --fortytwo "$source_root/42" --work "$work_root"
dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\n' > "$receipt_root/guest-packages.tsv"
sha256sum "$source_root/packages/"*.deb > "$receipt_root/nasa-packages.sha256"
ldd /usr/bin/nos_engine_server_standalone > "$receipt_root/nosengine-linkage.txt"
uname -a > "$receipt_root/kernel.txt"
chown -R manta:manta "$work_root" "$work_root/../42" "$receipt_root"
echo 'Guest provisioned; no macOS packages or configuration modified.'
